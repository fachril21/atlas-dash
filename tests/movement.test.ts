import { describe, expect, it } from 'vitest';
import placeholder from '../src/data/maps/placeholder.json';
import {
  GameSession,
  PlaceholderBotController,
  applyAction,
  COOLDOWN_MS,
  createInitialState,
  legalMoves,
  loadMap,
  MapValidationError,
  validateMove,
  type GameAction,
  type GameEvent,
  type GameState,
  type MapData,
} from '../src/logic';

const map = loadMap(placeholder);
const twoPlayers = (): GameState =>
  createInitialState(
    map,
    [
      { id: 'p1', name: 'You', kind: 'human' },
      { id: 'b1', name: 'Bot', kind: 'bot', botLevel: 'normal' },
    ],
    1,
  );

/** Apply actions in order, failing the test if any is rejected. */
function run(state: GameState, actions: GameAction[]): { state: GameState; events: GameEvent[] } {
  const all: GameEvent[] = [];
  for (const a of actions) {
    const r = applyAction(map, state, a);
    const rej = r.events.find((e) => e.type === 'actionRejected');
    if (rej) throw new Error(`rejected ${JSON.stringify(a)}: ${JSON.stringify(rej)}`);
    state = r.state;
    all.push(...r.events);
  }
  return { state, events: all };
}
const move = (playerId: string, toNodeId: string): GameAction => ({ type: 'move', playerId, toNodeId });
const win = (playerId: string): GameAction => ({ type: 'challengeResult', playerId, success: true });
const p1 = (s: GameState) => s.players[0]!;

describe('map loading', () => {
  it('loads the placeholder map with 2+ branch points', () => {
    expect(map.nodes.size).toBe(10);
    const branches = [...map.adjacency.values()].filter((n) => n.length >= 2).length;
    expect(branches).toBeGreaterThanOrEqual(2);
  });

  it('rejects edges to unknown nodes', () => {
    const bad = structuredClone(placeholder) as MapData;
    bad.edges.push({ from: 'r1', to: 'nowhere' });
    expect(() => loadMap(bad)).toThrow(MapValidationError);
  });

  it('rejects unknown region types and dead ends', () => {
    const badType = structuredClone(placeholder) as MapData;
    badType.nodes[1]!.type = 'lava-lake';
    expect(() => loadMap(badType)).toThrow(/unknown type/);
    const deadEnd = structuredClone(placeholder) as MapData;
    deadEnd.nodes.push({ id: 'cul', name: 'Cul-de-sac', type: 'beach', pos: { x: 0, y: 5 } });
    deadEnd.edges.push({ from: 'r1', to: 'cul' });
    expect(() => loadMap(deadEnd)).toThrow(/dead end/);
  });
});

describe('movement rules (R6.1)', () => {
  it('allows moving to an adjacent region from a cleared region', () => {
    const s = twoPlayers();
    expect(validateMove(map, p1(s), 'r1')).toEqual({ ok: true });
    expect(legalMoves(map, p1(s))).toEqual(['r1']);
  });

  it('rejects non-adjacent regions', () => {
    const s = twoPlayers();
    expect(validateMove(map, p1(s), 'r2a')).toEqual({ ok: false, reason: 'not-adjacent' });
    expect(validateMove(map, p1(s), 'finish')).toEqual({ ok: false, reason: 'not-adjacent' });
  });

  it('rejects unknown regions', () => {
    expect(validateMove(map, p1(twoPlayers()), 'atlantis')).toEqual({ ok: false, reason: 'unknown-node' });
  });

  it('no skipping: must win the current region before moving on', () => {
    let { state } = run(twoPlayers(), [move('p1', 'r1')]);
    expect(p1(state).phase).toBe('challenge');
    expect(validateMove(map, p1(state), 'r2a')).toEqual({ ok: false, reason: 'region-not-cleared' });
    ({ state } = run(state, [win('p1')]));
    expect(validateMove(map, p1(state), 'r2a')).toEqual({ ok: true });
  });

  it('no backtracking: directed edges cannot be travelled backwards', () => {
    const { state } = run(twoPlayers(), [move('p1', 'r1'), win('p1')]);
    expect(validateMove(map, p1(state), 'start')).toEqual({ ok: false, reason: 'not-adjacent' });
  });

  it('no backtracking: a visited region cannot be re-entered even over a two-way link', () => {
    const { state } = run(twoPlayers(), [
      move('p1', 'r1'), win('p1'),
      move('p1', 'r2a'), win('p1'),
      move('p1', 'r3a'), win('p1'),
      move('p1', 'r3b'), win('p1'), // lateral two-way link r3a <-> r3b
    ]);
    expect(validateMove(map, p1(state), 'r3a')).toEqual({ ok: false, reason: 'already-visited' });
    expect(legalMoves(map, p1(state))).toEqual(['r4']);
  });

  it('multiple players may occupy the same region', () => {
    const { state } = run(twoPlayers(), [move('p1', 'r1'), move('b1', 'r1')]);
    expect(state.players.map((p) => p.nodeId)).toEqual(['r1', 'r1']);
  });

  it('a rejected move leaves state unchanged and reports the reason', () => {
    const s = twoPlayers();
    const r = applyAction(map, s, move('p1', 'r4'));
    expect(r.state).toBe(s);
    expect(r.events).toEqual([{ type: 'actionRejected', action: move('p1', 'r4'), reason: 'not-adjacent' }]);
  });

  it('losing starts a cooldown scaled by difficulty, then the retry opens', () => {
    let { state, events } = run(twoPlayers(), [
      move('p1', 'r1'), win('p1'),
      move('p1', 'r2b'), // mountain = hard
      { type: 'challengeResult', playerId: 'p1', success: false },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'challengeResolved', success: false, cooldownMs: COOLDOWN_MS.hard });
    expect(p1(state).phase).toBe('cooldown');
    expect(validateMove(map, p1(state), 'r4')).toEqual({ ok: false, reason: 'region-not-cleared' });
    ({ state } = run(state, [{ type: 'tick', dtMs: COOLDOWN_MS.hard - 1 }]));
    expect(p1(state).phase).toBe('cooldown');
    ({ state } = run(state, [{ type: 'tick', dtMs: 1 }]));
    expect(p1(state).phase).toBe('challenge');
  });

  it('reaching the finish wins the game (R1)', () => {
    const { state, events } = run(twoPlayers(), [
      move('p1', 'r1'), win('p1'),
      move('p1', 'r2b'), win('p1'),
      move('p1', 'r4'), win('p1'),
      move('p1', 'r5a'), win('p1'),
      move('p1', 'finish'),
    ]);
    expect(state.status).toBe('finished');
    expect(state.winnerId).toBe('p1');
    expect(events.at(-1)).toEqual({ type: 'gameOver', winnerId: 'p1' });
    expect(applyAction(map, state, move('b1', 'r1')).events[0]).toMatchObject({ reason: 'game-over' });
  });
});

describe('session with placeholder bots', () => {
  function simulate(seed: number): { log: string[]; state: GameState } {
    const initial = createInitialState(
      map,
      [1, 2, 3].map((i) => ({ id: `b${i}`, name: `Bot ${i}`, kind: 'bot' as const, botLevel: 'normal' as const })),
      seed,
    );
    const bots = initial.players.map((p) => new PlaceholderBotController(p.id, seed, 'normal'));
    const session = new GameSession(map, initial, bots);
    const log: string[] = [];
    session.subscribe((_s, events) => {
      for (const e of events) log.push(JSON.stringify(e));
    });
    for (let i = 0; i < 20_000 && session.state.status === 'running'; i++) session.update(50);
    return { log, state: session.state };
  }

  it('is fully deterministic for a seed and a bot eventually wins', () => {
    const a = simulate(1234);
    const b = simulate(1234);
    expect(a.log).toEqual(b.log);
    expect(a.state.status).toBe('finished');
    expect(a.log.some((l) => l.includes('actionRejected'))).toBe(false);
  });
});
