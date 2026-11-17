/**
 * Composition root: loads the map, wires logic (session) -> render (board, pawns) and UI
 * (HUD, minigame host, input). Logic never imports from here; render/UI read state and
 * submit actions through the human controller.
 *
 * URL params: ?seed=<uint32|0xhex>  ?debug=1  ?minigame=<id> (with debug)  ?bots=1..3  ?botLevel=easy|normal|hard
 * (with ?bots or ?botLevel the Setup Bot screen is skipped; without them it opens first, preselected 3 bots / Normal)
 */
import {
  canStartAttempt,
  createInitialState,
  GameSession,
  HumanController,
  loadMap,
  LOGIC_STEP_MS,
  MapValidationError,
  minigamePool,
  MINIGAME_LOGIC,
  SmartBotController,
  selectableTargets,
  type BotLevel,
  type GameEvent,
  type GameState,
  type MapGraph,
  type MinigameContext,
  type MinigameResult,
  type PlayerController,
  type PlayerState,
} from './logic';
import { BoardView } from './render/board';
import { PawnsView } from './render/pawns';
import { NodePicker } from './render/picking';
import { Stage } from './render/stage';
import { installDebug, type SandboxOptions } from './ui/debug';
import { CardsUi } from './ui/cardsUi';
import { Hud } from './ui/hud';
import { MinigameHost } from './ui/minigameHost';
import { PointerInput, type InputIntent } from './ui/pointerInput';
import { SetupScreen } from './ui/setup';
import './style.css';

const HUMAN_ID = 'p1';
const MAP_URL = `${import.meta.env.BASE_URL}maps/indonesia/map.json`;
/** Real seconds to wait after the win before the results screen (finish walk is 2 s). */
const RESULTS_DELAY_S = 2.4;
/** Safety cap on logic steps per frame (high debug time scales). */
const MAX_STEPS_PER_FRAME = 2000;

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const FORCE_MINIGAME = DEBUG ? params.get('minigame') : null; // ?debug=1&minigame=<id>: every draw of the human's minigame
const SEED_PARAM = parseSeed(params.get('seed'));
const BOT_COUNT = clampInt(Number(params.get('bots') ?? 3), 1, 3);
const BOT_LEVEL: BotLevel = (['easy', 'normal', 'hard'] as const).find((l) => l === params.get('botLevel')) ?? 'normal';
/** The Setup Bot screen (B1/B3) opens first unless the URL already fixes the bots (tests, shared links). */
const SKIP_SETUP = params.has('bots') || params.has('botLevel');

function parseSeed(s: string | null): number | null {
  if (s === null || s.trim() === '') return null;
  const n = s.trim().toLowerCase().startsWith('0x') ? parseInt(s, 16) : Number(s);
  return Number.isFinite(n) ? Math.floor(n) >>> 0 : null;
}
function clampInt(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : hi;
}
function newMatchSeed(): number {
  // DR-21: the only allowed use of Math.random is creating the matchSeed.
  const matchSeed = SEED_PARAM ?? (Math.random() * 2 ** 32) >>> 0;
  return matchSeed;
}

async function boot(): Promise<void> {
  let map: MapGraph;
  try {
    const raw: unknown = await (await fetch(MAP_URL)).json();
    map = loadMap(raw, 'standard', MINIGAME_LOGIC);
  } catch (err) {
    console.error(err instanceof MapValidationError ? err.message : err);
    document.body.insertAdjacentHTML('beforeend', `<p class="boot-error">Peta gagal dimuat.</p>`);
    return;
  }
  const pool = minigamePool(map.data);

  const appEl = document.getElementById('app') as HTMLElement;
  const hudEl = document.getElementById('hud') as HTMLElement;
  const stage = new Stage(appEl);
  const sky = map.data.theme?.palette?.sky;
  if (sky) {
    stage.setSky(sky);
    document.body.style.background = sky;
  }

  const board = new BoardView(map, (regionId) => requestTarget(regionId));
  stage.scene.add(board.root);
  stage.setFitBox(board.bounds());
  const picker = new NodePicker(stage.camera, stage.renderer.domElement, board.pickables);
  const host = new MinigameHost(document.body);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Per-match objects.
  let matchSeed = 0;
  let session!: GameSession;
  let human!: HumanController;
  let pawns!: PawnsView;
  let hud!: Hud;
  let cardsUi!: CardsUi;
  let botCount = BOT_COUNT;
  let botLevel: BotLevel = BOT_LEVEL;
  /** True while the Setup Bot screen is up: the logic clock is held. */
  let setupOpen = !SKIP_SETUP;
  const setup = new SetupScreen(document.getElementById('hud') as HTMLElement, { botCount, botLevel }, (choice) => {
    botCount = choice.botCount;
    botLevel = choice.botLevel;
    setupOpen = false;
    newMatch();
  });
  let accumulatorMs = 0;
  let timeScale = 1;
  let paused = false;
  let gameOverAgo: number | null = null;
  let lastPointerType: 'touch' | 'mouse' = 'mouse';
  let unsubscribe: (() => void) | null = null;

  const me = (): PlayerState | undefined => session.state.players.find((p) => p.id === HUMAN_ID);

  function newMatch(): void {
    unsubscribe?.();
    host.close();
    pawns?.dispose();
    hud?.dispose();
    cardsUi?.dispose();
    setPaused(false);
    matchSeed = newMatchSeed();
    if (DEBUG) console.info(`[atlas] matchSeed=${matchSeed}`);
    const initial = createInitialState(
      map,
      [
        { id: HUMAN_ID, name: 'Kamu', kind: 'human' },
        ...Array.from({ length: botCount }, (_, i) => ({ id: `bot${i + 1}`, name: `Bot ${i + 1}`, kind: 'bot' as const, botLevel })),
      ],
      matchSeed,
      pool,
    );
    human = new HumanController(HUMAN_ID);
    const controllers: PlayerController[] = [
      human,
      ...initial.players.filter((p) => p.kind === 'bot').map((p) => new SmartBotController(p.id, matchSeed, p.botLevel)),
    ];
    session = new GameSession(map, initial, controllers);
    pawns = new PawnsView(board, map);
    stage.scene.add(pawns.root);
    hud = new Hud(hudEl, map, HUMAN_ID, {
      onSelectTarget: (regionId) => human.submit({ type: 'selectTarget', playerId: HUMAN_ID, targetId: regionId }),
      onStart: () => human.submit({ type: 'startAttempt', playerId: HUMAN_ID }),
      onPause: () => setPaused(true),
      onResume: () => setPaused(false),
      onQuit: () => (SKIP_SETUP ? newMatch() : openSetup()),
      activityOf: (id) => session.activityOf(id),
      onPlayAgain: () => newMatch(),
    });
    cardsUi = new CardsUi(hudEl, map, HUMAN_ID, {
      onPlay: (uid, targetId) => human.submit({ type: 'playCard', playerId: HUMAN_ID, cardUid: uid, ...(targetId ? { targetId } : {}) }),
      onMark: (uid) => human.submit({ type: 'markCard', playerId: HUMAN_ID, cardUid: uid }),
      onConfirm: () => human.submit({ type: 'confirmCards', playerId: HUMAN_ID }),
    });
    accumulatorMs = 0;
    gameOverAgo = null;
    unsubscribe = session.subscribe(onSessionEvents);
    onStateChanged(session.state);
  }

  function openSetup(): void {
    setupOpen = true;
    setPaused(false);
    host.close();
    setup.show();
  }

  function onSessionEvents(state: Readonly<GameState>, events: readonly GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'attemptStarted' && e.playerId === HUMAN_ID) openMinigame(e.attempt);
      if (e.type === 'gameOver') {
        // DR-06: the match is decided; lock all input and close anything still open.
        hud.lock();
        if (host.isOpen) host.close();
        human.clear();
        gameOverAgo = 0;
      }
    }
    if (FORCE_MINIGAME) forceHumanMinigame();
    hud.showEvents(state, events);
    cardsUi.onEvents(state, events);
    for (const e of events) if (e.type === 'actionRejected') cardsUi.onRejected(state, e.action, e.reason);
    onStateChanged(state);
  }

  /** ?minigame=<id> (debug): the human's next minigame is always `FORCE_MINIGAME` once a target is set. */
  function forceHumanMinigame(): void {
    const p = me();
    if (!p || !FORCE_MINIGAME || p.phase === 'playing' || !p.targetId || p.nextMinigameId === FORCE_MINIGAME) return;
    if (!pool.includes(FORCE_MINIGAME)) {
      console.warn(`[atlas] ?minigame=${FORCE_MINIGAME} is not in the pool [${pool.join(', ')}]`);
      return;
    }
    session.dispatch({ type: 'debugForceMinigame', playerId: HUMAN_ID, minigameId: FORCE_MINIGAME });
  }

  /** Debug sandbox: one minigame outside the match (no cards, no race state). */
  let sandboxResult: MinigameResult | null = null;
  function openSandbox(id: string, o: SandboxOptions): boolean {
    if (host.isOpen || !pool.includes(id)) return false;
    const difficulty = o.difficulty ?? 'medium';
    const modifiers = (o.modifiers ?? []).slice();
    const attempt: NonNullable<PlayerState['attempt']> = {
      minigameId: id, targetId: [...map.regions.keys()][1] as string, baseDifficulty: difficulty, modifiers, cardUids: [],
      onFail: { noCooldown: false, cooldownDeltaMs: 0 }, onWin: { pickDelta: 0, winMultiplier: 1 },
      seed: (o.seed ?? 1) >>> 0, difficulty, attemptIndex: 0, introMs: o.introMs ?? 300, startedAtMs: 0,
    };
    const ctx: MinigameContext = {
      seed: attempt.seed, difficulty, modifiers, map: map.data, regionId: attempt.targetId,
      inputMode: lastPointerType, settings: { reducedMotion, reducedFlash: false, sfxVolume: 1 },
    };
    sandboxResult = null;
    host.open(attempt, ctx, (r) => { sandboxResult = r; });
    if (paused) host.pause();
    return true;
  }

  function onStateChanged(state: Readonly<GameState>): void {
    pawns.sync(state);
    const p = me();
    board.setSelection(p ? selectableTargets(map, state, p) : [], p?.phase === 'idle' ? p.targetId : null);
    hud.render(state);
    cardsUi.render(state);
  }

  function openMinigame(attempt: NonNullable<PlayerState['attempt']>): void {
    const ctx: MinigameContext = {
      seed: attempt.seed,
      difficulty: attempt.difficulty,
      modifiers: attempt.modifiers.slice(), // snapshot from pending cards at Mulai (DR-48)
      map: map.data,
      regionId: attempt.targetId,
      inputMode: lastPointerType,
      settings: { reducedMotion, reducedFlash: false, sfxVolume: 1 },
    };
    host.open(attempt, ctx, (r) => {
      human.submit({ type: 'minigameResult', playerId: HUMAN_ID, passed: r.passed, timeTakenMs: r.timeTakenMs });
    });
    if (paused) host.pause();
  }

  function requestTarget(regionId: string): void {
    const p = me();
    if (!p || paused || host.isOpen) return;
    if (!selectableTargets(map, session.state, p).includes(regionId) || p.targetId === regionId) return;
    hud.requestTarget(session.state, regionId);
  }

  function setPaused(value: boolean): void {
    if (session && session.state.status !== 'running') value = false;
    paused = value;
    session?.setPaused(value);
    if (value) host.pause();
    else host.resume();
    hud?.setPaused(value);
  }

  function handleInput(intent: InputIntent): void {
    if (paused || host.isOpen || setupOpen) return;
    const p = me();
    if (!p) return;
    if (intent.type === 'select' || intent.type === 'hover') {
      if (intent.type === 'select') lastPointerType = intent.pointerType === 'touch' ? 'touch' : 'mouse';
      const regionId = picker.pick(intent.clientX, intent.clientY);
      if (intent.type === 'select') {
        if (regionId) requestTarget(regionId);
      } else {
        board.setHovered(regionId);
        const ok = regionId !== null && selectableTargets(map, session.state, p).includes(regionId);
        stage.renderer.domElement.style.cursor = ok ? 'pointer' : '';
      }
    } else if (intent.type === 'selectIndex') {
      const target = selectableTargets(map, session.state, p)[intent.index];
      if (target) requestTarget(target);
    } else if (intent.type === 'hoverEnd') {
      board.setHovered(null);
    }
  }
  new PointerInput(stage.renderer.domElement, handleInput);
  window.addEventListener('pointerdown', (e) => { lastPointerType = e.pointerType === 'touch' ? 'touch' : 'mouse'; }, { capture: true });
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Escape' && session.state.status === 'running' && !setupOpen) {
      // Esc closes a card popover (detail, picker, confirmation) first; only then does it pause.
      if (!paused && cardsUi.closeCardPopovers()) return;
      setPaused(!paused);
    }
    else if (e.code === 'Enter' && !paused && !host.isOpen && !setupOpen) {
      const p = me();
      if (p && canStartAttempt(session.state, p) === null) human.submit({ type: 'startAttempt', playerId: HUMAN_ID });
    }
  });
  // ui-flow §9: auto-pause when the tab is hidden (solo).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session.state.status === 'running' && !setupOpen) setPaused(true);
  });

  stage.onFrame((dt) => {
    const gameDtMs = paused || setupOpen ? 0 : dt * 1000 * timeScale;
    accumulatorMs += gameDtMs;
    let steps = 0;
    while (accumulatorMs >= LOGIC_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      session.step(LOGIC_STEP_MS);
      accumulatorMs -= LOGIC_STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulatorMs = 0;
    host.advance(gameDtMs);
    stage.renderEnabled = !host.coversRace;
    board.update(dt);
    pawns.setActivity((id) => session.activityOf(id));
    pawns.update(dt);
    hud.render(session.state);
    cardsUi.render(session.state);
    if (gameOverAgo !== null) {
      gameOverAgo += dt;
      if (gameOverAgo >= RESULTS_DELAY_S && !pawns.animating) hud.showResults(session.state);
    }
  });

  newMatch();
  if (setupOpen) setup.show();
  stage.start();

  if (DEBUG) {
    installDebug({
      getSession: () => session,
      getSeed: () => matchSeed,
      setTimeScale: (x) => { timeScale = Math.max(0, x); },
      getTimeScale: () => timeScale,
      forceMinigameResult: (passed) => {
        if (host.isOpen) return host.force(passed);
        const p = me();
        if (!p || canStartAttempt(session.state, p) !== null) return false;
        session.dispatch({ type: 'startAttempt', playerId: HUMAN_ID }); // opens the host via the event
        return host.force(passed);
      },
      setPaused,
      minigame: {
        info: () => host.debugInfo(),
        input: (i) => host.debugInput(i),
        gpu: () => host.debugGpuStats(),
        open: openSandbox,
        lastResult: () => sandboxResult,
      },
      human: HUMAN_ID,
      extra: { renderer: stage.renderer, scene: stage.scene, stage },
    });
  }
}

void boot();
