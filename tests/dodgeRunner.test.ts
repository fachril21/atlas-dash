import { describe, expect, it } from 'vitest';
import {
  DODGE_KNOBS,
  dodgeRequires,
  dodgeRunnerLogic as mg,
  laneAt,
  tempoMultiplier,
  type Difficulty,
  type DodgeLevel,
  type DodgeRow,
  type DodgeState,
  type Lane,
  type MinigameContext,
  type MinigameModifier,
} from '../src/logic';
import { indonesiaData } from './helpers';

const ctx = (seed: number, difficulty: Difficulty = 'medium', modifiers: MinigameModifier[] = []): MinigameContext => ({
  seed,
  difficulty,
  modifiers,
  map: indonesiaData(),
  regionId: 'medan',
  inputMode: 'touch',
  settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 },
});
const SEEDS = [1, 42, 1337, 0xdeadbeef, 4294967295];

/** A hand-made level for collision tests: given rows, 3 lives, 1000 ms i-frames. */
function custom(rows: { t: number; blocked: Lane[] }[], over: Partial<DodgeLevel> = {}): DodgeLevel {
  const base = mg.generateLevel(ctx(1, 'medium'));
  return {
    ...base,
    durationMs: 20_000,
    lives: 3,
    iFrameMs: 1000,
    hitHalfWindowMs: 150,
    rows: rows.map((r): DodgeRow => ({ tHitMs: r.t, blocked: r.blocked, props: r.blocked.map(() => 'x') })),
    ...over,
  };
}
const move = (level: DodgeLevel, s: DodgeState, dir: -1 | 1, t: number) => mg.step(level, s, { dir }, t);

describe('dodge_runner generateLevel', () => {
  it.each(['easy', 'medium', 'hard'] as const)('%s knobs and row counts match the spec table (mg_dodge_knobs_match_spec)', (d) => {
    const level = mg.generateLevel(ctx(1, d));
    const k = DODGE_KNOBS[d];
    expect(level).toMatchObject({
      durationMs: 20_000, lives: k.lives, iFrameMs: k.iFrameMs, speedMps: k.speedMps, intervalMs: k.intervalMs,
      firstRowMs: 2000, hitHalfWindowMs: 150, laneChangeMs: 120, visibleDistanceM: 40, hintLeadMs: 0, tempo: 1,
    });
    expect(level.rows).toHaveLength({ easy: 15, medium: 20, hard: 28 }[d]);
    level.rows.forEach((r, i) => {
      expect(r.tHitMs).toBe(2000 + i * k.intervalMs);
      expect(r.tHitMs + 150).toBeLessThanOrEqual(20_000);
    });
    // No further row would fit.
    expect(2000 + level.rows.length * k.intervalMs + 150).toBeGreaterThan(20_000);
  });

  it('spec table values', () => {
    expect(DODGE_KNOBS).toEqual({
      easy: { lives: 3, speedMps: 6, intervalMs: 1200, twoLaneChance: 0, iFrameMs: 1000 },
      medium: { lives: 2, speedMps: 8, intervalMs: 900, twoLaneChance: 0.2, iFrameMs: 1000 },
      hard: { lives: 1, speedMps: 10, intervalMs: 650, twoLaneChance: 0.4, iFrameMs: 0 },
    });
  });

  it('is deterministic from the seed', () => {
    expect(mg.generateLevel(ctx(42, 'hard'))).toEqual(mg.generateLevel(ctx(42, 'hard')));
    expect(mg.generateLevel(ctx(42, 'hard')).rows).not.toEqual(mg.generateLevel(ctx(43, 'hard')).rows);
    // Pinned: a change means the draw order changed.
    expect(mg.generateLevel(ctx(7, 'medium')).rows.slice(0, 4).map((r) => [r.blocked, r.props])).toMatchInlineSnapshot(`
      [
        [
          [
            -1,
            1,
          ],
          [
            "prop_durian",
            "prop_durian",
          ],
        ],
        [
          [
            0,
          ],
          [
            "prop_durian",
          ],
        ],
        [
          [
            -1,
            1,
          ],
          [
            "prop_becak",
            "prop_durian",
          ],
        ],
        [
          [
            -1,
          ],
          [
            "prop_bajaj",
          ],
        ],
      ]
    `);
  });

  it('lanes: every row has 1 or 2 blocked lanes, always >= 1 free lane (500 seeds, mg_dodge_specifics)', () => {
    const obstacles = indonesiaData().minigameThemes['dodge_runner']!['obstacles'] as string[];
    for (let seed = 1; seed <= 500; seed++) {
      for (const d of ['easy', 'medium', 'hard'] as const) {
        for (const r of mg.generateLevel(ctx(seed, d)).rows) {
          expect(r.blocked.length).toBeGreaterThanOrEqual(1);
          expect(r.blocked.length).toBeLessThanOrEqual(2);
          expect(new Set(r.blocked).size).toBe(r.blocked.length);
          expect(r.blocked.every((l) => l === -1 || l === 0 || l === 1)).toBe(true);
          expect(r.props).toHaveLength(r.blocked.length);
          expect(r.props.every((p) => obstacles.includes(p))).toBe(true);
        }
      }
    }
  }, 30_000); // QA-CP4b-05: 2 s alone, 5+ s when the suite runs in parallel on a busy machine

  it('easy never has 2-lane rows; medium/hard have roughly 20% / 40%', () => {
    const share = (d: Difficulty) => {
      let two = 0, all = 0;
      for (let seed = 1; seed <= 300; seed++) for (const r of mg.generateLevel(ctx(seed, d)).rows) { all++; if (r.blocked.length === 2) two++; }
      return two / all;
    };
    expect(share('easy')).toBe(0);
    expect(share('medium')).toBeGreaterThan(0.16);
    expect(share('medium')).toBeLessThan(0.24);
    expect(share('hard')).toBeGreaterThan(0.36);
    expect(share('hard')).toBeLessThan(0.44);
  }, 30_000);

  it('fairness: consecutive 2-lane rows have free lanes at most 1 lane apart (500 seeds)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const rows = mg.generateLevel(ctx(seed, 'hard')).rows;
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1]!, b = rows[i]!;
        if (a.blocked.length === 2 && b.blocked.length === 2) {
          const free = (r: DodgeRow) => ([-1, 0, 1] as Lane[]).find((l) => !r.blocked.includes(l))!;
          expect(Math.abs(free(a) - free(b))).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('requires: >= 3 obstacle ids on the map (DR-44)', () => {
    expect(dodgeRequires(indonesiaData())).toBe(true);
    const few = indonesiaData();
    few.minigameThemes['dodge_runner'] = { obstacles: ['a', 'b'] };
    expect(dodgeRequires(few)).toBe(false);
    const none = indonesiaData();
    delete none.minigameThemes['dodge_runner'];
    expect(dodgeRequires(none)).toBe(false);
  });
});

describe('dodge_runner tempo multiplier M and modifiers (mg_dodge_specifics, DR-16)', () => {
  it('M = speed x (1 - 0.03 x sum timeDelta), clamped to 0.70..1.50', () => {
    expect(tempoMultiplier(1, 0)).toBe(1);
    expect(tempoMultiplier(1, -5)).toBeCloseTo(1.15, 10);
    expect(tempoMultiplier(1, -10)).toBeCloseTo(1.3, 10);
    expect(tempoMultiplier(1, 5)).toBeCloseTo(0.85, 10);
    expect(tempoMultiplier(1.25, -5)).toBeCloseTo(1.4375, 10);
    expect(tempoMultiplier(2, -10)).toBe(1.5);
    expect(tempoMultiplier(1, 40)).toBe(0.7);
  });

  it('timeDelta -5 s: speed +15%, interval / M, duration unchanged; -10 s -> M 1.30', () => {
    const base = mg.generateLevel(ctx(1, 'medium'));
    const a = mg.generateLevel(ctx(1, 'medium', [{ kind: 'timeDelta', seconds: -5 }]));
    expect(a.durationMs).toBe(20_000);
    expect(a.tempo).toBeCloseTo(1.15, 10);
    expect(a.speedMps).toBeCloseTo(8 * 1.15, 10);
    expect(a.intervalMs).toBeCloseTo(900 / 1.15, 8);
    expect(a.rows.length).toBeGreaterThan(base.rows.length); // rows come more often
    expect(a.firstRowMs).toBe(2000);
    const b = mg.generateLevel(ctx(1, 'medium', [{ kind: 'timeDelta', seconds: -10 }]));
    expect(b.tempo).toBeCloseTo(1.3, 10);
    expect(b.durationMs).toBe(20_000);
  });

  it('speed x1.25 on medium: 10 m/s and a 720 ms interval; speed and timeDelta combine', () => {
    const a = mg.generateLevel(ctx(1, 'medium', [{ kind: 'speed', mult: 1.25 }]));
    expect(a.speedMps).toBeCloseTo(10, 10);
    expect(a.intervalMs).toBeCloseTo(720, 8);
    const c = mg.generateLevel(ctx(1, 'medium', [{ kind: 'speed', mult: 1.25 }, { kind: 'timeDelta', seconds: -5 }]));
    expect(c.tempo).toBeCloseTo(1.4375, 10);
  });

  it('extraTarget: absorbed by lives first, the rest becomes +5 s each (hard +2 -> 30 s, medium +2 -> 25 s, easy +2 -> 20 s)', () => {
    const e = (d: Difficulty, n: number) => mg.generateLevel(ctx(1, d, [{ kind: 'extraTarget', count: n }]));
    expect(e('hard', 2)).toMatchObject({ lives: 1, durationMs: 30_000 });
    expect(e('medium', 2)).toMatchObject({ lives: 1, durationMs: 25_000 });
    expect(e('easy', 2)).toMatchObject({ lives: 1, durationMs: 20_000 });
    expect(e('easy', 1)).toMatchObject({ lives: 2, durationMs: 20_000 });
    expect(e('hard', 9)).toMatchObject({ lives: 1, durationMs: 30_000 }); // capped at +2
    // rows are generated for the longer duration
    expect(e('hard', 2).rows.length).toBeGreaterThan(mg.generateLevel(ctx(1, 'hard')).rows.length);
  });

  it('tolerance, fog, hint, unknown modifiers', () => {
    expect(mg.generateLevel(ctx(1, 'medium', [{ kind: 'tolerance', mult: 1.5 }]))).toMatchObject({ hitHalfWindowMs: 100, iFrameMs: 1500 });
    expect(mg.generateLevel(ctx(1, 'medium', [{ kind: 'tolerance', mult: 10 }])).hitHalfWindowMs).toBe(60);
    expect(mg.generateLevel(ctx(1, 'medium', [{ kind: 'fog' }])).visibleDistanceM).toBeCloseTo(24, 10);
    expect(mg.generateLevel(ctx(1, 'medium', [{ kind: 'hint' }])).hintLeadMs).toBe(500);
    expect(mg.generateLevel(ctx(1, 'medium', [{ kind: 'bogus' } as unknown as MinigameModifier])).warnings).toHaveLength(1);
  });
});

describe('dodge_runner collision (time based)', () => {
  it('a row is graded only once its window is over: tHit + hw', () => {
    const level = custom([{ t: 1000, blocked: [0] }]);
    const s0 = mg.initState(level);
    expect(mg.step(level, s0, null, 1149).lives).toBe(3);
    const s = mg.step(level, s0, null, 1150);
    expect(s.lives).toBe(2);
    expect(s.hits).toEqual([{ row: 0, atMs: 850 }]);
    expect(s.result).toBeNull();
  });

  it('standing in a free lane takes no hit', () => {
    const level = custom([{ t: 1000, blocked: [-1, 1] }]);
    const s = mg.step(level, mg.initState(level), null, 1150);
    expect(s).toMatchObject({ lives: 3, dodged: 1, nextRow: 1 });
  });

  it('the logical lane switches 60 ms after the input; the dodge must finish before the window starts (inclusive)', () => {
    const level = custom([{ t: 1000, blocked: [0] }]); // window 850..1150
    const dodge = (t: number) => {
      let s = move(level, mg.initState(level), 1, t);
      expect(s.moves[0]).toMatchObject({ inputMs: t, atMs: t + 60, from: 0, to: 1 });
      s = mg.step(level, s, null, 1150);
      return s.lives;
    };
    expect(dodge(790)).toBe(3); // atMs 850 = window start: already in lane 1
    expect(dodge(791)).toBe(2); // atMs 851: lane 0 still blocked at 850
  });

  it('moving into a blocked lane inside the window is a hit; after the window it is not', () => {
    const level = custom([{ t: 1000, blocked: [1] }]);
    const into = (t: number) => mg.step(level, move(level, mg.initState(level), 1, t), null, 1200).lives;
    expect(into(1000)).toBe(2); // atMs 1060 inside the window
    expect(into(1090)).toBe(2); // atMs 1150 = window end, inclusive
    expect(into(1091)).toBe(3); // atMs 1151: row already passed
  });

  it('lane changes are relative to the last target; clamped to -1..+1; no input lock', () => {
    const level = custom([]);
    let s = mg.initState(level);
    s = move(level, s, 1, 100);
    s = move(level, s, 1, 110); // already at +1: no-op
    expect(s.targetLane).toBe(1);
    expect(s.moves).toHaveLength(1);
    s = move(level, s, -1, 120);
    s = move(level, s, -1, 130);
    expect(s.targetLane).toBe(-1);
    expect(s.moves.map((m) => m.to)).toEqual([1, 0, -1]);
    expect(laneAt(s.moves, 159)).toBe(0);
    expect(laneAt(s.moves, 160)).toBe(1); // 100 + 60
    expect(laneAt(s.moves, 180)).toBe(0);
    expect(laneAt(s.moves, 190)).toBe(-1);
    s = move(level, s, -1, 200);
    expect(s.targetLane).toBe(-1);
  });

  it('i-frames: a row whose window starts inside the i-frame is not counted', () => {
    // First hit collides at 850 (window start) -> i-frame until 1850. Row 2 window starts 1350: ignored.
    // Row 3 window starts 2850 -> counted.
    const level = custom([{ t: 1000, blocked: [0] }, { t: 1500, blocked: [0] }, { t: 3000, blocked: [0] }]);
    let s = mg.step(level, mg.initState(level), null, 1650);
    expect(s).toMatchObject({ lives: 2, dodged: 1, iFrameUntilMs: 1850 });
    s = mg.step(level, s, null, 3150);
    expect(s.lives).toBe(1);
    expect(s.hits.map((h) => h.row)).toEqual([0, 2]);
  });

  it('a window that starts exactly when the i-frame ends is counted', () => {
    const level = custom([{ t: 1000, blocked: [0] }, { t: 2000, blocked: [0] }]); // i-frame 850..1850, row 2 window starts 1850
    const s = mg.step(level, mg.initState(level), null, 2150);
    expect(s.lives).toBe(1);
  });

  it('lives 0 fails at once with failLimit; timeTaken = collision time; progress = t / duration', () => {
    const level = custom([{ t: 1000, blocked: [0] }, { t: 3000, blocked: [0] }], { lives: 2, iFrameMs: 0 });
    let s = mg.step(level, mg.initState(level), null, 1150);
    expect(s.result).toBeNull();
    s = mg.step(level, s, null, 3150);
    expect(mg.result(level, s)).toEqual({ passed: false, timeTakenMs: 2850, progress: 2850 / 20_000, reason: 'failLimit' });
    expect(mg.step(level, s, { dir: 1 }, 3200)).toBe(s); // final
  });

  it('hard (1 life): the first hit fails', () => {
    const level = mg.generateLevel(ctx(5, 'hard'));
    const first = level.rows[0]!;
    const s = mg.step(level, mg.initState(level), null, first.tHitMs + 150);
    // The pawn stands in lane 0; row 0 either blocks lane 0 (fail) or not (still running).
    expect(s.result?.reason ?? 'running').toBe(first.blocked.includes(0) ? 'failLimit' : 'running');
  });

  it('survives to the duration: success, progress 1, timeTaken = duration, all rows graded', () => {
    const level = mg.generateLevel(ctx(3, 'easy'));
    // A bot that always stands in a lane free in the next row would pass; here: do nothing on a level with a free lane 0.
    const free = { ...level, rows: level.rows.map((r) => ({ ...r, blocked: [1 as Lane], props: ['x'] })) };
    const s = mg.step(free, mg.initState(free), null, free.durationMs);
    expect(mg.result(free, s)).toEqual({ passed: true, timeTakenMs: free.durationMs, progress: 1, reason: 'success' });
    expect(s.nextRow).toBe(free.rows.length);
    expect(s.lives).toBe(free.lives);
  });

  it('a hit just before the end still fails (no row left ungraded at the deadline)', () => {
    const level = custom([{ t: 19_800, blocked: [0] }], { lives: 1 });
    const s = mg.step(level, mg.initState(level), null, 20_000);
    expect(mg.result(level, s)).toMatchObject({ passed: false, reason: 'failLimit' });
  });

  it('result does not depend on frame rate (16 ms steps = one big step)', () => {
    for (const seed of SEEDS) {
      const level = mg.generateLevel(ctx(seed, 'medium'));
      // Scripted inputs: weave lanes every 700 ms.
      const inputs: [number, -1 | 1][] = [];
      for (let t = 1500, d: -1 | 1 = 1; t < 19_000; t += 700, d = (d === 1 ? -1 : 1)) inputs.push([t, d]);
      const run = (stepMs: number) => {
        let s = mg.initState(level);
        let t = 0;
        let i = 0;
        while (!s.result && t <= level.durationMs) {
          t = Math.min(t + stepMs, level.durationMs);
          while (i < inputs.length && inputs[i]![0] <= t) {
            s = mg.step(level, s, { dir: inputs[i]![1] }, inputs[i]![0]);
            i++;
          }
          s = mg.step(level, s, null, t);
          if (t >= level.durationMs) break;
        }
        return { result: s.result, lives: s.lives, hits: s.hits };
      };
      expect(run(16)).toEqual(run(250));
    }
  });

  it('step is pure and replays identically', () => {
    const level = mg.generateLevel(ctx(9, 'medium'));
    const s0 = mg.initState(level);
    const frozen = structuredClone(s0);
    const play = () => mg.step(level, mg.step(level, s0, { dir: 1 }, 700), null, 5000);
    expect(play()).toEqual(play());
    expect(s0).toEqual(frozen);
  });
});
