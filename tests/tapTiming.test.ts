import { describe, expect, it } from 'vitest';
import {
  MAX_ZONE_WIDTH,
  MIN_ZONE_CENTER_GAP,
  needleAt,
  pingPong,
  TAP_LOCK_MS,
  TAP_TIMING_BASE_MS,
  TAP_TIMING_KNOBS,
  tapTimingLogic as mg,
  ZONE_MAX,
  ZONE_MIN,
  zoneAt,
  type Difficulty,
  type MinigameContext,
  type MinigameModifier,
  type TapTimingLevel,
  type TapTimingState,
} from '../src/logic';
import { indonesiaData } from './helpers';

const ctx = (seed: number, difficulty: Difficulty = 'medium', modifiers: MinigameModifier[] = []): MinigameContext => ({
  seed,
  difficulty,
  modifiers,
  map: indonesiaData(),
  regionId: 'medan',
  inputMode: 'mouse',
  settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 },
});
const SEEDS = [1, 42, 1337, 0xdeadbeef, 4294967295];

/** Earliest time >= from (1 ms resolution) where the needle is inside (or outside) the current zone. */
function findTime(level: TapTimingLevel, s: TapTimingState, from: number, inside: boolean): number {
  for (let t = from; t < level.durationMs; t++) {
    const z = zoneAt(level, s, t);
    const p = needleAt(level, t);
    const isIn = z.start <= p && p <= z.start + level.zoneWidth;
    if (isIn === inside) return t;
  }
  throw new Error('no such time');
}
const tap = (level: TapTimingLevel, s: TapTimingState, t: number) => mg.step(level, s, { kind: 'tap' }, t);

describe('tap_timing generateLevel', () => {
  it.each(['easy', 'medium', 'hard'] as const)('%s knobs match the spec table (mg_tap_timing_knobs_match_spec)', (d) => {
    const level = mg.generateLevel(ctx(1, d));
    const k = TAP_TIMING_KNOBS[d];
    expect(level.durationMs).toBe(TAP_TIMING_BASE_MS);
    expect(level.hitsRequired).toBe(k.hitsRequired);
    expect(level.missesAllowed).toBe(k.missesAllowed);
    expect(level.zoneWidth).toBe(k.zoneWidth);
    expect(level.zoneMoveSpeed).toBe(k.zoneMoveSpeed);
    expect(level.needleSpeed / k.needleSpeed).toBeGreaterThanOrEqual(0.9);
    expect(level.needleSpeed / k.needleSpeed).toBeLessThanOrEqual(1.1);
    expect(level.fog).toEqual([]);
    expect(level.hint).toBe(false);
  });

  it('spec table values', () => {
    expect(TAP_TIMING_KNOBS).toEqual({
      easy: { hitsRequired: 3, missesAllowed: 2, zoneWidth: 0.22, needleSpeed: 0.8, zoneMoveSpeed: 0 },
      medium: { hitsRequired: 3, missesAllowed: 1, zoneWidth: 0.15, needleSpeed: 1.2, zoneMoveSpeed: 0 },
      hard: { hitsRequired: 3, missesAllowed: 0, zoneWidth: 0.09, needleSpeed: 1.7, zoneMoveSpeed: 0.15 },
    });
  });

  it('is deterministic per seed and varies across seeds (mg_tap_timing_deterministic)', () => {
    for (const seed of SEEDS) expect(mg.generateLevel(ctx(seed))).toEqual(mg.generateLevel(ctx(seed)));
    const unique = new Set(Array.from({ length: 100 }, (_, i) => JSON.stringify(mg.generateLevel(ctx(i + 1)))));
    expect(unique.size).toBeGreaterThanOrEqual(95);
  });

  it('zones fit the bar and successive centres are >= 0.25 apart (seeds 1..500, all difficulties)', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      for (let seed = 1; seed <= 500; seed++) {
        const l = mg.generateLevel(ctx(seed, d));
        expect(l.zoneStarts.length).toBe(l.hitsRequired + 2);
        expect([0, 1]).toContain(l.needleStart);
        l.zoneStarts.forEach((z, i) => {
          expect(z).toBeGreaterThanOrEqual(ZONE_MIN);
          expect(z + l.zoneWidth).toBeLessThanOrEqual(ZONE_MAX + 1e-9);
          if (i > 0) expect(Math.abs(z - l.zoneStarts[i - 1]!)).toBeGreaterThanOrEqual(MIN_ZONE_CENTER_GAP - 1e-9);
        });
      }
    }
  });

  it('applies modifiers per the table; unknown ones become warnings', () => {
    const base = mg.generateLevel(ctx(9, 'hard'));
    const l = mg.generateLevel(ctx(9, 'hard', [
      { kind: 'timeDelta', seconds: -10 },
      { kind: 'tolerance', mult: 10 },
      { kind: 'speed', mult: 1.5 },
      { kind: 'extraTarget', count: 5 },
      { kind: 'hint' },
      { kind: 'fog' },
      { kind: 'mystery' } as unknown as MinigameModifier,
    ]));
    expect(l.durationMs).toBe(10_000);
    expect(l.zoneWidth).toBe(MAX_ZONE_WIDTH);
    expect(l.needleSpeed).toBeCloseTo(base.needleSpeed * 1.5);
    expect(l.zoneMoveSpeed).toBeCloseTo(base.zoneMoveSpeed * 1.5);
    expect(l.hitsRequired).toBe(5); // +2 max
    expect(l.hint).toBe(true);
    expect(l.fog.length).toBe(5); // one layout per 2 s
    expect(l.warnings).toHaveLength(1);
  });
});

describe('tap_timing scoring (mg_tap_timing_scoring)', () => {
  it('needle bounces between 0 and 1, starting towards the centre', () => {
    expect(pingPong(0, 1, 1, 0.25, 0, 1).pos).toBeCloseTo(0.25);
    expect(pingPong(0, 1, 1, 1.25, 0, 1)).toEqual({ pos: 0.75, dir: -1 });
    expect(pingPong(1, -1, 1, 0.25, 0, 1).pos).toBeCloseTo(0.75);
    expect(pingPong(1, -1, 1, 1.5, 0, 1)).toEqual({ pos: 0.5, dir: 1 });
  });

  it.each(['easy', 'medium', 'hard'] as const)('%s: three hits pass with reason success', (d) => {
    for (const seed of SEEDS) {
      const level = mg.generateLevel(ctx(seed, d));
      let s = mg.initState(level);
      let t = 0;
      for (let i = 0; i < 3; i++) {
        t = findTime(level, s, t + TAP_LOCK_MS, true);
        s = tap(level, s, t);
      }
      expect(mg.result(level, s)).toEqual({ passed: true, timeTakenMs: t, progress: 1, reason: 'success' });
    }
  });

  it('misses up to missesAllowed are fine, one more fails immediately (failLimit)', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const level = mg.generateLevel(ctx(3, d));
      let s = mg.initState(level);
      let t = 0;
      for (let i = 0; i < level.missesAllowed; i++) {
        t = findTime(level, s, t + TAP_LOCK_MS, false);
        s = tap(level, s, t);
        expect(mg.result(level, s)).toBeNull();
      }
      t = findTime(level, s, t + TAP_LOCK_MS, false);
      s = tap(level, s, t);
      expect(mg.result(level, s)).toEqual({ passed: false, timeTakenMs: t, progress: 0, reason: 'failLimit' });
    }
  });

  it('taps inside the 250 ms lock are ignored (not misses)', () => {
    const level = mg.generateLevel(ctx(5, 'hard')); // 0 misses allowed
    let s = mg.initState(level);
    const t = findTime(level, s, 0, true);
    s = tap(level, s, t);
    expect(s.hits).toBe(1);
    s = tap(level, s, t + 10);
    s = tap(level, s, t + TAP_LOCK_MS - 1);
    expect(s.misses).toBe(0);
    expect(mg.result(level, s)).toBeNull();
  });

  it('zone edges are inclusive', () => {
    const level: TapTimingLevel = { ...mg.generateLevel(ctx(1, 'easy')), needleStart: 0, needleSpeed: 1, zoneStarts: [0.5, 0.1, 0.6, 0.2, 0.7], zoneWidth: 0.2 };
    let s = mg.initState(level);
    s = tap(level, s, 500); // needle exactly at 0.5 = zone start
    expect(s.hits).toBe(1);
    s = tap(level, s, 1000 + 700); // needle back at 0.3 = edge of zone [0.1, 0.3]
    expect(s.hits).toBe(2);
  });

  it('times out at the duration with progress = hits / required', () => {
    const level = mg.generateLevel(ctx(8, 'easy'));
    let s = mg.initState(level);
    const t = findTime(level, s, 0, true);
    s = tap(level, s, t);
    s = mg.step(level, s, null, level.durationMs);
    expect(mg.result(level, s)).toEqual({ passed: false, timeTakenMs: level.durationMs, progress: 1 / 3, reason: 'timeout' });
    // Finished state is final.
    expect(tap(level, s, level.durationMs + 1)).toBe(s);
  });

  it('same inputs and times give the same result (deterministic step)', () => {
    const level = mg.generateLevel(ctx(77, 'hard'));
    const times = [400, 900, 1500, 2600, 3100];
    const play = () => times.reduce((s, t) => tap(level, s, t), mg.initState(level));
    expect(play()).toEqual(play());
  });
});
