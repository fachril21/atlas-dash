import { describe, expect, it } from 'vitest';
import {
  applyAction,
  COOLDOWN_MS,
  createInitialState,
  GameSession,
  INTRO_MS,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  PlaceholderBotController,
  ranking,
  replay,
  RETRY_INTRO_MS,
  selectableTargets,
  streamSeed,
  type GameAction,
  type GameEvent,
  type GameState,
  type MapGraph,
} from '../src/logic';
import { indonesiaData } from './helpers';

const map = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);
const SEED = 42;

const newGame = (players = ['p1', 'p2'], seed = SEED, m: MapGraph = map, pl: string[] = pool): GameState =>
  createInitialState(m, players.map((id) => ({ id, name: id, kind: 'human' as const })), seed, pl);

const select = (playerId: string, targetId: string): GameAction => ({ type: 'selectTarget', playerId, targetId });
const start = (playerId: string): GameAction => ({ type: 'startAttempt', playerId });
const result = (playerId: string, passed: boolean): GameAction => ({ type: 'minigameResult', playerId, passed });
const tick = (dtMs: number): GameAction => ({ type: 'tick', dtMs });
const win = (id: string): GameAction[] => [start(id), result(id, true)];
const conquer = (id: string, target: string): GameAction[] => [select(id, target), ...win(id), ...win(id)];

function run(state: GameState, actions: GameAction[], m: MapGraph = map): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = applyAction(m, state, a);
    const rej = r.events.find((e) => e.type === 'actionRejected');
    if (rej) throw new Error(`rejected ${JSON.stringify(a)}: ${JSON.stringify(rej)}`);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}
function rejection(state: GameState, a: GameAction): string | undefined {
  const r = applyAction(map, state, a);
  const e = r.events[0];
  if (e?.type === 'actionRejected') {
    expect(r.state).toBe(state); // rejected actions never change state
    return e.reason;
  }
  return undefined;
}
const P = (s: GameState, id = 'p1') => s.players.find((p) => p.id === id)!;

describe('start (race_start_no_minigame)', () => {
  it('everyone starts on the start region, idle, no target, remainingWins 8', () => {
    const s = newGame(['a', 'b', 'c', 'd']);
    for (const p of s.players) {
      expect(p).toMatchObject({ nodeId: 'sabang', targetId: null, winsAtTarget: 0, phase: 'idle', remainingWins: 8 });
    }
    expect(rejection(s, start('a'))).toBe('no-target');
  });

  it('start and finish can never be a target', () => {
    let { state } = run(newGame(), [...conquer('p1', 'medan')]);
    expect(rejection(state, select('p1', 'sabang'))).toBe('not-adjacent');
    expect(rejection(state, select('p1', 'merauke'))).toBe('finish-not-playable');
    ({ state } = run(state, [...conquer('p1', 'jakarta'), ...conquer('p1', 'toraja')]));
    expect(selectableTargets(map, state, P(state))).toEqual(['labuan_bajo', 'raja_ampat']);
  });
});

describe('targets (race_target_adjacent_only)', () => {
  it('only outgoing neighbours are accepted', () => {
    const s = newGame();
    expect(selectableTargets(map, s, P(s)).sort()).toEqual(['medan', 'padang']);
    expect(rejection(s, select('p1', 'jakarta'))).toBe('not-adjacent');
    expect(rejection(s, select('p1', 'atlantis'))).toBe('unknown-region');
    expect(rejection(s, select('nobody', 'medan'))).toBe('unknown-player');
  });

  it('no backtracking: previous regions are not targets', () => {
    const { state } = run(newGame(), [...conquer('p1', 'medan'), ...conquer('p1', 'jakarta')]);
    expect(rejection(state, select('p1', 'medan'))).toBe('not-adjacent');
    expect(rejection(state, select('p1', 'padang'))).toBe('not-adjacent');
    expect(P(state).path).toEqual(['sabang', 'medan', 'jakarta']);
  });

  it('cannot change target while a minigame is running', () => {
    const { state } = run(newGame(), [select('p1', 'medan'), start('p1')]);
    expect(rejection(state, select('p1', 'padang'))).toBe('busy');
    expect(rejection(state, start('p1'))).toBe('busy');
  });
});

describe('two wins to enter (race_two_wins_to_enter)', () => {
  it('win 1 keeps the pawn, win 2 moves it and resets winsAtTarget', () => {
    let { state, events } = run(newGame(), [select('p1', 'medan'), ...win('p1')]);
    expect(P(state)).toMatchObject({ nodeId: 'sabang', targetId: 'medan', winsAtTarget: 1, remainingWins: 7 });
    ({ state, events } = run(state, win('p1')));
    expect(P(state)).toMatchObject({ nodeId: 'medan', targetId: null, winsAtTarget: 0, remainingWins: 6 });
    expect(events).toContainEqual({ type: 'regionConquered', playerId: 'p1', from: 'sabang', to: 'medan' });
  });
});

describe('cooldown and retry (race_cooldown_by_difficulty, DR-02, DR-05)', () => {
  it.each([
    ['yogyakarta', 'easy'],
    ['jakarta', 'medium'],
    ['toraja', 'hard'],
  ] as const)('fail at %s (%s) -> cooldown, Mulai rejected until it ends', (target, diff) => {
    const path: Record<string, string[]> = {
      yogyakarta: ['medan', 'jakarta'],
      jakarta: ['medan'],
      toraja: ['medan', 'jakarta'],
    };
    let { state } = run(newGame(), path[target]!.flatMap((r) => conquer('p1', r)));
    ({ state } = run(state, [select('p1', target), start('p1'), result('p1', false)]));
    expect(P(state).cooldownUntilMs - state.timeMs).toBe(COOLDOWN_MS[diff]);
    ({ state } = run(state, [tick(COOLDOWN_MS[diff] - 1)]));
    expect(rejection(state, start('p1'))).toBe('cooldown');
    ({ state } = run(state, [tick(1)]));
    // No automatic restart: still idle until Mulai.
    expect(P(state).phase).toBe('idle');
    ({ state } = run(state, [start('p1')]));
    expect(P(state).phase).toBe('playing');
  });

  it('after a fail: same minigame, new seed, 1.5 s intro; first attempt: 3 s intro', () => {
    let { state, events } = run(newGame(), [select('p1', 'medan'), start('p1')]);
    const first = P(state).attempt!;
    expect(first.introMs).toBe(INTRO_MS);
    expect(first.attemptIndex).toBe(0);
    expect(first.seed).toBe(streamSeed(SEED, 'p1', 'minigameParams:medan:0'));
    ({ state } = run(state, [result('p1', false), tick(COOLDOWN_MS.medium), start('p1')]));
    const retry = P(state).attempt!;
    expect(retry.minigameId).toBe(first.minigameId);
    expect(retry.introMs).toBe(RETRY_INTRO_MS);
    expect(retry.attemptIndex).toBe(1);
    expect(retry.seed).not.toBe(first.seed);
    // After a win the next attempt is a fresh draw (3 s intro).
    ({ state, events } = run(state, [result('p1', true), start('p1')]));
    expect(P(state).attempt!.introMs).toBe(INTRO_MS);
    expect(events.some((e) => e.type === 'attemptStarted')).toBe(true);
  });

  it('after a win the next minigame differs from the last one when the pool allows it', () => {
    const twoPool = ['tap_timing', 'other_game'];
    let state = newGame(['p1'], 7, map, twoPool);
    const played: string[] = [];
    for (const r of ['medan', 'jakarta', 'toraja']) {
      ({ state } = run(state, [select('p1', r)]));
      for (let i = 0; i < 2; i++) {
        ({ state } = run(state, [start('p1')]));
        played.push(P(state).attempt!.minigameId);
        ({ state } = run(state, [result('p1', true)]));
      }
    }
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
  });

  it('attemptIndex is cumulative per target and survives switching away and back', () => {
    let { state } = run(newGame(), [select('p1', 'medan'), start('p1'), result('p1', false)]);
    ({ state } = run(state, [select('p1', 'padang'), tick(COOLDOWN_MS.medium), select('p1', 'medan'), start('p1')]));
    expect(P(state).attempt!.attemptIndex).toBe(1);
  });
});

describe('switching target (race_switch_target_rules)', () => {
  it('allowed without partial wins', () => {
    const { state } = run(newGame(), [select('p1', 'medan'), select('p1', 'padang')]);
    expect(P(state).targetId).toBe('padang');
  });

  it('partial wins are lost when switching', () => {
    const { state, events } = run(newGame(), [select('p1', 'medan'), ...win('p1'), select('p1', 'padang')]);
    expect(P(state)).toMatchObject({ targetId: 'padang', winsAtTarget: 0, remainingWins: 8 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'targetSelected', targetId: 'padang', lostWins: 1 }));
  });

  it('switching during cooldown is allowed but the cooldown keeps running', () => {
    let { state } = run(newGame(), [select('p1', 'padang'), start('p1'), result('p1', false)]);
    const until = P(state).cooldownUntilMs;
    ({ state } = run(state, [tick(1000), select('p1', 'medan')]));
    expect(P(state).cooldownUntilMs).toBe(until);
    expect(rejection(state, start('p1'))).toBe('cooldown');
    ({ state } = run(state, [tick(COOLDOWN_MS.hard - 1000), start('p1')]));
    expect(P(state).attempt!.targetId).toBe('medan');
  });

  it('re-selecting the current target is rejected', () => {
    const { state } = run(newGame(), [select('p1', 'medan')]);
    expect(rejection(state, select('p1', 'medan'))).toBe('already-target');
  });
});

describe('finish (race_final_auto_finish, DR-06)', () => {
  const toToraja = [...conquer('p1', 'medan'), ...conquer('p1', 'jakarta'), ...conquer('p1', 'toraja')];

  it.each(['raja_ampat', 'labuan_bajo'])('2nd win at final %s -> playerFinished + gameOver in the same action', (finalRegion) => {
    let { state } = run(newGame(), [...toToraja, select('p1', finalRegion), ...win('p1'), start('p1')]);
    expect(state.status).toBe('running');
    const r = run(state, [result('p1', true)]);
    state = r.state;
    const types = r.events.map((e) => e.type);
    expect(types).toContain('playerFinished');
    expect(types.at(-1)).toBe('gameOver');
    expect(state).toMatchObject({ status: 'finished', winnerId: 'p1' });
    expect(P(state)).toMatchObject({ phase: 'finished', nodeId: 'merauke', place: 1, remainingWins: 0 });
    expect(P(state).path.slice(-2)).toEqual([finalRegion, 'merauke']);
    // All input is locked for everyone from that event on.
    expect(rejection(state, select('p2', 'medan'))).toBe('game-over');
    expect(rejection(state, start('p1'))).toBe('game-over');
  });

  it('first finisher in the same tick wins (race_first_finisher_wins)', () => {
    const both = (id: string) => [...conquer(id, 'medan'), ...conquer(id, 'jakarta'), ...conquer(id, 'toraja'), select(id, 'raja_ampat'), ...win(id), start(id)];
    let { state } = run(newGame(), [...both('p1'), ...both('p2')]);
    ({ state } = run(state, [result('p2', true)]));
    expect(state.winnerId).toBe('p2');
    expect(rejection(state, result('p1', true))).toBe('game-over');
    expect(ranking(state).map((p) => p.id)).toEqual(['p2', 'p1']);
  });
});

describe('shared regions (race_shared_regions)', () => {
  it('several players target and stand on the same region independently', () => {
    const { state } = run(newGame(['a', 'b', 'c', 'd']), [
      ...conquer('a', 'medan'), ...conquer('b', 'medan'), select('c', 'medan'), select('d', 'medan'), start('c'), start('d'),
    ]);
    expect(state.players.map((p) => p.nodeId)).toEqual(['medan', 'medan', 'sabang', 'sabang']);
    expect(state.players.map((p) => p.phase)).toEqual(['idle', 'idle', 'playing', 'playing']);
  });
});

describe('ranking', () => {
  it('orders by remainingWins, ties by who reached it first', () => {
    let { state } = run(newGame(['a', 'b', 'c']), [select('b', 'medan'), ...win('b'), tick(100), select('a', 'medan'), ...win('a')]);
    expect(ranking(state).map((p) => p.id)).toEqual(['b', 'a', 'c']);
    ({ state } = run(state, win('a')));
    expect(ranking(state).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('RNG streams (rng_streams_independent, DR-04)', () => {
  it("another player's actions do not change my minigame seeds or draws", () => {
    const mine = [select('p1', 'medan'), start('p1')];
    const alone = run(newGame(), mine).state;
    const busy = run(newGame(), [select('p2', 'padang'), start('p2'), result('p2', false), select('p2', 'medan'), ...mine]).state;
    expect(P(busy).attempt).toEqual({ ...P(alone).attempt, startedAtMs: P(busy).attempt!.startedAtMs });
    expect(P(busy).pickRng).toEqual(P(alone).pickRng);
  });
});

describe('session with placeholder bots', () => {
  function simulate(seed: number) {
    const initial = createInitialState(
      map,
      ['b1', 'b2', 'b3'].map((id) => ({ id, name: id, kind: 'bot' as const, botLevel: 'normal' as const })),
      seed,
      pool,
    );
    const bots = initial.players.map((p) => new PlaceholderBotController(p.id, seed, 'normal'));
    const session = new GameSession(map, initial, bots);
    for (let i = 0; i < 200_000 && session.state.status === 'running'; i++) session.step();
    return { session, initial };
  }

  it('is deterministic per seed, ends with a winner, and replays from the action log (race_deterministic_replay)', () => {
    const a = simulate(1337);
    const b = simulate(1337);
    expect(a.session.eventLog).toEqual(b.session.eventLog);
    expect(a.session.state.status).toBe('finished');
    expect(a.session.eventLog.some((e) => e.event.type === 'actionRejected')).toBe(false);
    const replayed = replay(map, a.initial, a.session.actionLog.map((l) => l.action));
    expect(replayed).toEqual(a.session.state);
  });

  it('pause freezes the logic clock and bots', () => {
    const { session } = simulate(1);
    const initial = createInitialState(map, [{ id: 'b1', name: 'b1', kind: 'bot', botLevel: 'normal' }], 5, pool);
    const s = new GameSession(map, initial, [new PlaceholderBotController('b1', 5)]);
    for (let i = 0; i < 100; i++) s.step();
    const frozen = structuredClone(s.state);
    s.setPaused(true);
    for (let i = 0; i < 1000; i++) s.step();
    expect(s.state).toEqual(frozen);
    s.setPaused(false);
    s.step();
    expect(s.state.timeMs).toBe(frozen.timeMs + 50);
    expect(session.state.status).toBe('finished');
  });
});
