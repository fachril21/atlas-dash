/**
 * QA test hooks (docs/qa/test-plan.md §0), installed only with ?debug=1:
 *   window.__atlasTest = { getState, dispatch, forceMinigameResult, setTimeScale, events, exportLog, ... }
 * plus (CP5b) forceMinigame / openMinigame / getMinigame / minigameInput for the 7 minigames, and the
 * URL param ?minigame=<id> that forces every draw of the human's minigame (debug only).
 * plus a small panel with the seed, time scale and an "export log" button.
 */
import { SlingScene } from './minigames/slingScene';
import { getCard, sabotageSlotsUsed, type MinigameModifier, type MinigameResult, type GameAction, type GameEvent, type GameSession, type GameState, type LoggedEvent, type RejectReason } from '../logic';

export interface DebugDeps {
  getSession(): GameSession;
  getSeed(): number;
  setTimeScale(x: number): void;
  getTimeScale(): number;
  /** Resolve the human's current attempt (starting one first if allowed). False if impossible. */
  forceMinigameResult(passed: boolean): boolean;
  setPaused(paused: boolean): void;
  /** CP5b minigame hooks (implemented by main.ts, which owns the host). */
  minigame: {
    info(): { id: string; phase: string; level: unknown; playMs: number; state: unknown; finished: boolean } | null;
    input(input: unknown): boolean;
    gpu(): { geometries: number; textures: number; calls: number } | null;
    /** Open a minigame on its own (not part of the match): result goes to lastResult(). */
    open(id: string, opts: SandboxOptions): boolean;
    lastResult(): MinigameResult | null;
  };
  /** Player id of the human (card hooks act on this player). */
  human: string;
  extra: Record<string, unknown>;
}

export interface SandboxOptions {
  difficulty?: 'easy' | 'medium' | 'hard';
  modifiers?: MinigameModifier[];
  seed?: number;
  /** Intro length; default 300 ms so tests do not wait 3 s. */
  introMs?: number;
}

export interface AtlasTestApi {
  getState(): GameState;
  dispatch(action: GameAction): GameEvent[];
  forceMinigameResult(passed: boolean): boolean;
  setTimeScale(x: number): void;
  events(): LoggedEvent[];
  exportLog(): string;
  pause(): void;
  resume(): void;
  seed(): number;
  /** Put a card in the human's hand (hand > 5 opens the discard screen). */
  giveCard(cardId: string): boolean;
  /** The human's hand: uid, card id and handSeq, left to right. */
  getHand(): { uid: string; id: string; seq: number }[];
  /** Empty the human's hand (closes the discard screen if open). */
  clearHand(): boolean;
  /** Open the pick screen now. `ids` fixes the offered cards; `pick` the N (default 2). */
  forceOffer(ids?: string[], pick?: number): boolean;
  /** Resolve whichever card screen is open with the auto-pick / auto-discard rule. */
  autoResolveCards(): boolean;
  /** CP4b: put a card in any player's hand (bots included; a bot drops extra cards at once). */
  giveCardTo(playerId: string, cardId: string): boolean;
  /** CP4b: any player's hand, left to right (uid, card id, handSeq). */
  getHandOf(playerId: string): { uid: string; id: string; seq: number }[];
  /**
   * CP4b: everything in a player's `pending` zone: card id, type, who sent it (`source`, set for
   * sabotage and reflections) and whether a running attempt has snapshotted it.
   */
  getPending(playerId: string): { uid: string; id: string; type: string; source: string | null; inAttempt: boolean }[];
  /**
   * CP5b: make the human's next minigame on the current target `id` (must be in the pool and a
   * target must be selected). `?minigame=<id>` does this for every draw of the whole match.
   */
  forceMinigame(id: string): boolean;
  /**
   * CP5b: open one minigame on its own, outside the match (no cards, no race state): returns false
   * when one is already open or `id` is unknown. The result is kept for lastMinigameResult().
   */
  openMinigame(id: string, opts?: SandboxOptions): boolean;
  /** CP5b: the open minigame's id, phase, generated `level` (incl. targets[i].ideal for Ketapel), play time and pure state. */
  getMinigame(): { id: string; phase: string; level: unknown; playMs: number; state: unknown; finished: boolean } | null;
  /** CP5b: feed a pure-logic input ({hole}, {card}/{peek}, {choice}, {yawDeg,power}) at the current play time. */
  minigameInput(input: unknown): boolean;
  /** CP5b: renderer.info counters of the open 3D minigame (null if none or 2D). */
  minigameGpu(): { geometries: number; textures: number; calls: number } | null;
  /** CP5b: GPU counters read right after the last 3D minigame was disposed (must be 0). */
  lastDisposedGpu(): { geometries: number; textures: number; calls: number } | null;
  /** CP5b: result of the last sandbox minigame. */
  lastMinigameResult(): MinigameResult | null;
  /** CP4b: sabotage slots in use (0-2) for any player. */
  getSabotageSlots(playerId: string): number;
  /**
   * CP4b: play a card from `playerId`'s hand (default: the human), by card id (first copy in hand)
   * or uid, aimed at `targetId` for single-target sabotage. Goes through the normal reducer
   * validation; on failure nothing changes and `reason` says why (e.g. "bad-target").
   */
  playCard(cardIdOrUid: string, targetId?: string, playerId?: string): { ok: boolean; reason?: RejectReason };
  /** CP4b: alias of playCard for sabotage: the human sends `cardId` at `targetId`. */
  playSabotage(cardIdOrUid: string, targetId?: string, playerId?: string): { ok: boolean; reason?: RejectReason };
}

declare global {
  interface Window {
    __atlasTest?: AtlasTestApi;
    atlas?: Record<string, unknown>;
  }
}

function isRejected(events: GameEvent[]): boolean {
  return events.length === 1 && events[0]?.type === 'actionRejected';
}

export function installDebug(deps: DebugDeps): AtlasTestApi {
  const exportLog = (): string => {
    const s = deps.getSession();
    return JSON.stringify({
      format: 'atlas-dash-match-log@1',
      exportedAt: new Date().toISOString(),
      matchSeed: deps.getSeed(),
      mapId: s.state.mapId,
      presetId: s.state.presetId,
      players: s.state.players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, botLevel: p.botLevel ?? null })),
      finalState: s.state,
      actions: s.actionLog,
      events: s.eventLog,
    }, null, 2);
  };

  const api: AtlasTestApi = {
    getState: () => structuredClone(deps.getSession().state) as GameState,
    dispatch: (action) => deps.getSession().dispatch(action),
    forceMinigameResult: (passed) => deps.forceMinigameResult(passed),
    setTimeScale: (x) => { deps.setTimeScale(x); render(); },
    events: () => structuredClone(deps.getSession().eventLog),
    exportLog,
    pause: () => deps.setPaused(true),
    resume: () => deps.setPaused(false),
    seed: () => deps.getSeed(),
    giveCard: (cardId) => !isRejected(deps.getSession().dispatch({ type: 'debugGrantCard', playerId: deps.human, cardId })),
    getHand: () => (deps.getSession().state.players.find((p) => p.id === deps.human)?.hand ?? []).map((c) => ({ uid: c.uid, id: getCard(c.defId).id, seq: c.seq })),
    clearHand: () => !isRejected(deps.getSession().dispatch({ type: 'debugClearHand', playerId: deps.human })),
    forceOffer: (ids, pick) => {
      const action: GameAction = { type: 'debugForceOffer', playerId: deps.human, ...(ids ? { cardIds: ids } : {}), ...(pick !== undefined ? { pick } : {}) };
      return !isRejected(deps.getSession().dispatch(action));
    },
    autoResolveCards: () => !isRejected(deps.getSession().dispatch({ type: 'autoCards', playerId: deps.human })),
    giveCardTo: (playerId, cardId) => !isRejected(deps.getSession().dispatch({ type: 'debugGrantCard', playerId, cardId })),
    getHandOf: (playerId) => (deps.getSession().state.players.find((p) => p.id === playerId)?.hand ?? []).map((c) => ({ uid: c.uid, id: getCard(c.defId).id, seq: c.seq })),
    getPending: (playerId) => {
      const p = deps.getSession().state.players.find((q) => q.id === playerId);
      const inAttempt = new Set(p?.attempt?.cardUids ?? []);
      return (p?.pending ?? []).map((c) => ({ uid: c.uid, id: getCard(c.defId).id, type: getCard(c.defId).type, source: c.source ?? null, inAttempt: inAttempt.has(c.uid) }));
    },
    getSabotageSlots: (playerId) => {
      const p = deps.getSession().state.players.find((q) => q.id === playerId);
      return p ? sabotageSlotsUsed(p) : 0;
    },
    forceMinigame: (id) => !isRejected(deps.getSession().dispatch({ type: 'debugForceMinigame', playerId: deps.human, minigameId: id })),
    openMinigame: (id, opts = {}) => deps.minigame.open(id, opts),
    getMinigame: () => deps.minigame.info(),
    minigameInput: (input) => deps.minigame.input(input),
    minigameGpu: () => deps.minigame.gpu(),
    lastDisposedGpu: () => SlingScene.lastDisposedStats,
    lastMinigameResult: () => deps.minigame.lastResult(),
    playCard: (cardIdOrUid, targetId, playerId = deps.human) => playCardHook(cardIdOrUid, targetId, playerId),
    playSabotage: (cardIdOrUid, targetId, playerId = deps.human) => playCardHook(cardIdOrUid, targetId, playerId),
  };
  function playCardHook(cardIdOrUid: string, targetId: string | undefined, playerId: string): { ok: boolean; reason?: RejectReason } {
    const p = deps.getSession().state.players.find((q) => q.id === playerId);
    const card = p?.hand.find((c) => c.uid === cardIdOrUid) ?? p?.hand.find((c) => c.defId === cardIdOrUid);
    if (!card) return { ok: false, reason: 'no-card' };
    const events = deps.getSession().dispatch({ type: 'playCard', playerId, cardUid: card.uid, ...(targetId ? { targetId } : {}) });
    const first = events[0];
    return first?.type === 'actionRejected' && events.length === 1 ? { ok: false, reason: first.reason } : { ok: true };
  }
  window.__atlasTest = api;
  window.atlas = { ...deps.extra, get session() { return deps.getSession(); } };

  const panel = document.createElement('div');
  panel.className = 'debug-panel';
  panel.dataset.testid = 'debug-panel';
  document.body.appendChild(panel);
  const render = (): void => {
    panel.innerHTML = `<span data-testid="debug-seed">seed ${deps.getSeed()}</span>
      <button data-scale="1">×1</button><button data-scale="10">×10</button>
      <span>now ×${deps.getTimeScale()}</span>
      <button data-testid="btn-export-log">log</button>`;
  };
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.scale) api.setTimeScale(Number(b.dataset.scale));
    else {
      const blob = new Blob([exportLog()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `atlas-log-${deps.getSeed()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  });
  render();
  setInterval(() => { if (!panel.textContent?.includes(`seed ${deps.getSeed()}`)) render(); }, 1000);
  return api;
}
