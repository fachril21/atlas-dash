/**
 * Composition root: wires logic (session) -> render (board, pawns) and UI (HUD, input).
 * Logic never imports from here; render/UI only read state and submit actions.
 */
import placeholderMap from './data/maps/placeholder.json';
import {
  GameSession,
  HumanController,
  PlaceholderBotController,
  createInitialState,
  legalMoves,
  loadMap,
  type GameState,
  type PlayerController,
} from './logic';
import { BoardView } from './render/board';
import { PawnsView } from './render/pawns';
import { NodePicker } from './render/picking';
import { Stage } from './render/stage';
import { Hud } from './ui/hud';
import { PointerInput, type InputIntent } from './ui/pointerInput';
import './style.css';

/** Logic runs at a fixed 20 Hz step (same as a future server tick), rendering at display rate. */
const LOGIC_STEP_MS = 50;
const HUMAN_ID = 'p1';
const BOT_COUNT = 3;

const map = loadMap(placeholderMap);
const stage = new Stage(document.getElementById('app') as HTMLElement);
const board = new BoardView(map);
const pawns = new PawnsView(board);
stage.scene.add(board.root, pawns.root);
stage.setFitBox(board.bounds());
const picker = new NodePicker(stage.camera, stage.renderer.domElement, board.pickables);

let session: GameSession;
let human: HumanController;
let accumulatorMs = 0;

function newGame(seed: number): void {
  const initial = createInitialState(
    map,
    [
      { id: HUMAN_ID, name: 'Kamu', kind: 'human' },
      ...Array.from({ length: BOT_COUNT }, (_, i) => ({
        id: `bot${i + 1}`,
        name: `Bot ${i + 1}`,
        kind: 'bot' as const,
        botLevel: 'normal' as const,
      })),
    ],
    seed,
  );
  human = new HumanController(HUMAN_ID);
  const controllers: PlayerController[] = [
    human,
    ...initial.players.filter((p) => p.kind === 'bot').map((p) => new PlaceholderBotController(p.id, seed, p.botLevel)),
  ];
  session = new GameSession(map, initial, controllers);
  session.subscribe((state, events) => {
    onStateChanged(state);
    hud.showEvents(state, events);
  });
  pawns.clear();
  accumulatorMs = 0;
  onStateChanged(session.state);
}

function onStateChanged(state: Readonly<GameState>): void {
  pawns.sync(state);
  const me = state.players.find((p) => p.id === HUMAN_ID);
  board.setHighlighted(me && state.status === 'running' ? legalMoves(map, me) : []);
  hud.render(state);
}

const hud = new Hud(document.getElementById('hud') as HTMLElement, map, HUMAN_ID, {
  onMoveTo: (nodeId) => human.submit({ type: 'move', playerId: HUMAN_ID, toNodeId: nodeId }),
  onChallengeResult: (success) => human.submit({ type: 'challengeResult', playerId: HUMAN_ID, success }),
  onRestart: () => newGame((Math.random() * 2 ** 32) >>> 0),
});

function handleInput(intent: InputIntent): void {
  const state = session.state;
  const me = state.players.find((p) => p.id === HUMAN_ID);
  if (!me) return;
  switch (intent.type) {
    case 'select': {
      const nodeId = picker.pick(intent.clientX, intent.clientY);
      // Only legal targets become actions; the reducer re-validates anyway.
      if (nodeId && legalMoves(map, me).includes(nodeId)) {
        human.submit({ type: 'move', playerId: HUMAN_ID, toNodeId: nodeId });
      }
      break;
    }
    case 'selectIndex': {
      const target = legalMoves(map, me)[intent.index];
      if (target) human.submit({ type: 'move', playerId: HUMAN_ID, toNodeId: target });
      break;
    }
    case 'hover': {
      const nodeId = picker.pick(intent.clientX, intent.clientY);
      board.setHovered(nodeId);
      stage.renderer.domElement.style.cursor = nodeId && legalMoves(map, me).includes(nodeId) ? 'pointer' : '';
      break;
    }
    case 'hoverEnd':
      board.setHovered(null);
      break;
  }
}
new PointerInput(stage.renderer.domElement, handleInput);

stage.onFrame((dt) => {
  accumulatorMs += dt * 1000;
  while (accumulatorMs >= LOGIC_STEP_MS) {
    session.update(LOGIC_STEP_MS);
    accumulatorMs -= LOGIC_STEP_MS;
  }
  board.update(dt);
  pawns.update(dt);
  hud.render(session.state); // cooldown countdowns; DOM only changes when text changes
});

newGame(Date.now() >>> 0);
stage.start();

if (import.meta.env.DEV) {
  Object.assign(window, { atlas: { stage, renderer: stage.renderer, scene: stage.scene, get session() { return session; } } });
}
