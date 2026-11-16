import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  COOLDOWN_MS,
  createInitialState,
  createStream,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  pickMinigame,
  Rng,
  type GameAction,
  type GameState,
} from '../src/logic';
import { indonesiaData, ROOT } from './helpers';

const map = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);
const REGISTRY = ['tap_timing', 'simon', 'dodge_runner'];

describe('registry and pool (DR-02, §1.3 steps 1-2)', () => {
  it('registry order is fixed: tap_timing, simon, dodge_runner', () => {
    expect(MINIGAME_LOGIC.map((m) => m.id)).toEqual(REGISTRY);
  });

  it('pool keeps registry order and holds all three on the Indonesia map', () => {
    expect(pool).toEqual(REGISTRY);
  });

  it('a minigame whose requires() fails is not in the pool; order of the rest is kept', () => {
    const data = indonesiaData();
    data.minigameThemes['dodge_runner'] = { obstacles: ['only_one'] };
    expect(minigamePool(data)).toEqual(['tap_timing', 'simon']);
  });
});

describe('pickMinigame algorithm (§1.3 steps 3-5)', () => {
  const start = createStream(42, 'p1', 'minigamePick').getState();
  const afterOneDraw = (state = start) => {
    const r = Rng.fromState(state);
    r.next();
    return r.getState();
  };

  it('with last = simon the candidates are [tap_timing, dodge_runner], indexed by the draw', () => {
    // Mirror the spec: pick = kandidat[rng.int(kandidat.length)].
    for (let i = 0; i < 50; i++) {
      let st = start;
      for (let k = 0; k < i; k++) st = afterOneDraw(st);
      const expected = ['tap_timing', 'dodge_runner'][Rng.fromState(st).int(0, 1)];
      expect(pickMinigame(pool, st, 'simon').id).toBe(expected);
    }
  });

  it('never returns the last minigame while others exist; last = null or foreign leaves the pool whole', () => {
    for (const last of REGISTRY) {
      let st = start;
      for (let i = 0; i < 200; i++) {
        const r = pickMinigame(pool, st, last);
        expect(r.id).not.toBe(last);
        st = r.rng;
      }
    }
    const seen = new Set<string>();
    let st = start;
    for (let i = 0; i < 200; i++) {
      const r = pickMinigame(pool, st, null);
      seen.add(r.id);
      st = r.rng;
    }
    expect([...seen].sort()).toEqual([...REGISTRY].sort());
    // last not in the pool: candidates = pool
    const seen2 = new Set<string>();
    st = start;
    for (let i = 0; i < 200; i++) {
      const r = pickMinigame(pool, st, 'guess_location');
      seen2.add(r.id);
      st = r.rng;
    }
    expect(seen2.size).toBe(3);
  });

  it('always draws exactly one number, even with a single candidate', () => {
    expect(pickMinigame(pool, start, 'simon').rng).toEqual(afterOneDraw());
    expect(pickMinigame(['tap_timing'], start, null).rng).toEqual(afterOneDraw());
    expect(pickMinigame(['tap_timing'], start, 'tap_timing').rng).toEqual(afterOneDraw()); // empty candidates -> pool
    expect(pickMinigame(['tap_timing', 'simon'], start, 'tap_timing')).toMatchObject({ id: 'simon', rng: afterOneDraw() });
  });

  it('pool of 1 repeats it; pool of 2 alternates strictly', () => {
    let st = start;
    for (let i = 0; i < 10; i++) {
      const r = pickMinigame(['tap_timing'], st, 'tap_timing');
      expect(r.id).toBe('tap_timing');
      st = r.rng;
    }
    let last: string | null = null;
    const seq: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = pickMinigame(['tap_timing', 'simon'], st, last);
      seq.push(r.id);
      last = r.id;
      st = r.rng;
    }
    expect(seq.every((id, i) => i === 0 || id !== seq[i - 1])).toBe(true);
  });

  it('pool of 3: each of the two candidates has about 50% chance', () => {
    let st = start;
    const counts: Record<string, number> = { tap_timing: 0, simon: 0, dodge_runner: 0 };
    for (let i = 0; i < 4000; i++) {
      const r = pickMinigame(pool, st, 'simon');
      counts[r.id]!++;
      st = r.rng;
    }
    expect(counts['simon']).toBe(0);
    expect(counts['tap_timing']! / 4000).toBeGreaterThan(0.46);
    expect(counts['tap_timing']! / 4000).toBeLessThan(0.54);
  });

  it('does not mutate its input and throws on an empty pool', () => {
    const copy = [...start] as typeof start;
    pickMinigame(pool, start, null);
    expect(start).toEqual(copy);
    expect(() => pickMinigame([], start, null)).toThrow();
  });
});

describe('pick inside the reducer (DR-02)', () => {
  const sel = (playerId: string, targetId: string): GameAction => ({ type: 'selectTarget', playerId, targetId });
  const start = (playerId: string): GameAction => ({ type: 'startAttempt', playerId });
  const res = (playerId: string, passed: boolean): GameAction => ({ type: 'minigameResult', playerId, passed });
  const tick = (dtMs: number): GameAction => ({ type: 'tick', dtMs });
  const run = (state: GameState, actions: GameAction[]): GameState => {
    for (const a of actions) {
      const r = applyAction(map, state, a);
      const rej = r.events.find((e) => e.type === 'actionRejected');
      if (rej) throw new Error(`rejected ${JSON.stringify(a)}: ${JSON.stringify(rej)}`);
      state = r.state;
    }
    return state;
  };
  const game = (ids = ['p1', 'p2'], seed = 42) => createInitialState(map, ids.map((id) => ({ id, name: id, kind: 'human' as const })), seed, pool);
  const P = (s: GameState, id = 'p1') => s.players.find((p) => p.id === id)!;
  const draws = (s: GameState, id = 'p1') => {
    // How many draws were taken from the player's stream so far.
    const r = createStream(s.matchSeed, id, 'minigamePick');
    for (let n = 0; n < 1000; n++) {
      if (JSON.stringify(r.getState()) === JSON.stringify(P(s, id).pickRng)) return n;
      r.next();
    }
    throw new Error('stream not found');
  };

  it('one draw per target selection and per win 1 -> 2; none after a fail, none after the 2nd win', () => {
    let s = game();
    expect(draws(s)).toBe(0);
    s = run(s, [sel('p1', 'medan')]);
    expect(draws(s)).toBe(1);
    const first = P(s).nextMinigameId;
    s = run(s, [start('p1'), res('p1', false)]);
    expect(draws(s)).toBe(1); // fail replays without a draw
    expect(P(s).nextMinigameId).toBe(first);
    expect(P(s).retry).toBe(true);
    s = run(s, [tick(COOLDOWN_MS.medium), start('p1')]);
    expect(P(s).attempt!.minigameId).toBe(first);
    s = run(s, [res('p1', true)]);
    expect(draws(s)).toBe(2); // win 1 -> 2 draws
    s = run(s, [start('p1'), res('p1', true)]); // 2nd win conquers; no draw
    expect(draws(s)).toBe(2);
    expect(P(s)).toMatchObject({ nodeId: 'medan', nextMinigameId: null });
  });

  it('the draw after win 1 differs from the minigame just played; a failed one counts as played', () => {
    for (let seed = 1; seed <= 60; seed++) {
      let s = run(game(['p1'], seed), [sel('p1', 'medan'), start('p1')]);
      const a = P(s).attempt!.minigameId;
      s = run(s, [res('p1', false), tick(COOLDOWN_MS.medium)]);
      expect(P(s).lastMinigameId).toBe(a); // failed attempt counts as played
      s = run(s, [start('p1'), res('p1', true)]);
      expect(P(s).nextMinigameId).not.toBe(a);
    }
  });

  it('last is per player, survives switching target and new regions, and is only set by playing', () => {
    let s = run(game(), [sel('p1', 'medan'), start('p1'), res('p1', true)]);
    const played = P(s).lastMinigameId!;
    expect(P(s, 'p2').lastMinigameId).toBeNull();
    // Switching target (partial win lost) does not reset last, and the new draw avoids it.
    s = run(s, [sel('p1', 'padang')]);
    expect(P(s).lastMinigameId).toBe(played);
    expect(P(s).nextMinigameId).not.toBe(played);
    // A new region after two wins: last is still tracked across regions.
    s = run(s, [start('p1'), res('p1', true), start('p1'), res('p1', true)]);
    const lastAtPadang = P(s).lastMinigameId!;
    expect(P(s).nodeId).toBe('padang');
    s = run(s, [sel('p1', 'jakarta')]);
    expect(P(s).nextMinigameId).not.toBe(lastAtPadang);
    // p2's draws do not shift p1's stream
    const before = P(s).pickRng;
    s = run(s, [sel('p2', 'medan'), sel('p2', 'padang')]);
    expect(P(s).pickRng).toEqual(before);
  });

  it('the same minigame is never drawn twice in a row over a whole run (3-pool)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = game(['p1'], seed);
      const played: string[] = [];
      for (const target of ['medan', 'jakarta', 'toraja']) {
        s = run(s, [sel('p1', target)]);
        for (let i = 0; i < 2; i++) {
          s = run(s, [start('p1')]);
          played.push(P(s).attempt!.minigameId);
          s = run(s, [res('p1', true)]);
        }
      }
      played.forEach((id, i) => { if (i > 0) expect(id).not.toBe(played[i - 1]); });
    }
  });

  it('the drawn minigame stays hidden in the UI until Mulai (no minigame id in the HUD source)', () => {
    const hud = readFileSync(join(ROOT, 'src/ui/hud.ts'), 'utf8');
    expect(hud).not.toMatch(/nextMinigameId|minigameId/);
  });
});

describe('cooldown values (R2, CP3b: 8/6/4 s)', () => {
  it('COOLDOWN_MS is 8000 / 6000 / 4000 and stays inverse to difficulty', () => {
    expect(COOLDOWN_MS).toEqual({ easy: 8000, medium: 6000, hard: 4000 });
    expect(COOLDOWN_MS.easy).toBeGreaterThan(COOLDOWN_MS.medium);
    expect(COOLDOWN_MS.medium).toBeGreaterThan(COOLDOWN_MS.hard);
  });
});
