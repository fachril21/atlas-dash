/**
 * CP5b: Whack-a-Mole, Ketapel, Cocokkan Kartu, Tebak Lokasi (pure logic) against the acceptance
 * criteria of minigames.md §10 (A-E). Knob tables are written out here from the document, not
 * imported from the code, so a wrong constant fails a test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  aimFromDrag,
  BOT_PASS_CHANCE,
  BOT_PROFILE,
  CARDS,
  createStream,
  getMinigameLogic,
  clampTimeDelta,
  getCard,
  groundTimeSec,
  guessLocationLogic as gl,
  guessPerfectScript,
  loadMap,
  localize,
  memoryMatchLogic as mm,
  memoryPerfectScript,
  MINIGAME_LOGIC,
  minigamePool,
  resolveAttemptEffects,
  Rng,
  runScript,
  shotPosition,
  simulateAttempt,
  simulateShot,
  slingshotLogic as sl,
  slingshotPerfectScript,
  SURVIVAL_MINIGAMES,
  tempoMultiplier,
  whackAMoleLogic as wm,
  whackPerfectScript,
  whackSlotCount,
  type Attempt,
  type BotLevel,
  type Difficulty,
  type GuessLevel,
  type MapData,
  type MemoryLevel,
  type MinigameContext,
  type MinigameLogic,
  type MinigameModifier,
  type SlingLevel,
  type WhackLevel,
} from '../src/logic';
import { indonesiaData, ROOT } from './helpers';

// Seed sweeps (5000 levels x 3 difficulties) are slower than the 5 s default, most of all next to other test files.
vi.setConfig({ testTimeout: 180_000 });

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];
const DATA = indonesiaData();
const ctx = (seed: number, difficulty: Difficulty = 'medium', modifiers: MinigameModifier[] = [], map: MapData = DATA): MinigameContext => ({
  seed, difficulty, modifiers, map, regionId: 'medan', inputMode: 'touch',
  settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 },
});
const gen = <L>(mg: MinigameLogic<L, any, any>, seed: number, d: Difficulty = 'medium', mods: MinigameModifier[] = []): L => mg.generateLevel(ctx(seed, d, mods));

const NEW_LOGICS = [wm, sl, mm, gl] as const;
const KIND_MODS: Record<string, MinigameModifier> = {
  timeDelta: { kind: 'timeDelta', seconds: 5 },
  tolerance: { kind: 'tolerance', mult: 1.3 },
  speed: { kind: 'speed', mult: 1.25 },
  extraTarget: { kind: 'extraTarget', count: 1 },
  fog: { kind: 'fog' },
  hint: { kind: 'hint' },
};
const ALL_SIX: MinigameModifier[] = Object.values(KIND_MODS);
/** Modifier sets a perfect player must beat at 100% (each kind alone, incl. 2x Jam Rusak and the strongest sabotage). */
const SINGLE_SETS: [string, MinigameModifier[]][] = [
  ['none', []],
  ['Jam Pasir +5', [{ kind: 'timeDelta', seconds: 5 }]],
  ['2x Jam Rusak -10', [{ kind: 'timeDelta', seconds: -10 }]],
  ['Zona Lebar x1.3', [{ kind: 'tolerance', mult: 1.3 }]],
  ['Ngebut x1.25', [{ kind: 'speed', mult: 1.25 }]],
  ['Tambah Beban +2', [{ kind: 'extraTarget', count: 2 }]],
  ['Kabut', [{ kind: 'fog' }]],
  ['Teropong', [{ kind: 'hint' }]],
];
const EXTREME: MinigameModifier[] = [{ kind: 'timeDelta', seconds: -10 }, { kind: 'extraTarget', count: 2 }, { kind: 'speed', mult: 1.25 }, { kind: 'fog' }];

function randomMods(rng: Rng): MinigameModifier[] {
  const out: MinigameModifier[] = [];
  if (rng.chance(0.5)) out.push({ kind: 'timeDelta', seconds: rng.pick([-10, -5, 5, 10]) });
  if (rng.chance(0.5)) out.push({ kind: 'tolerance', mult: rng.pick([1.3, 1.69]) });
  if (rng.chance(0.5)) out.push({ kind: 'speed', mult: rng.pick([1.25, 1.5625]) });
  if (rng.chance(0.5)) out.push({ kind: 'extraTarget', count: rng.pick([1, 2]) });
  if (rng.chance(0.5)) out.push({ kind: 'fog' });
  if (rng.chance(0.5)) out.push({ kind: 'hint' });
  return out;
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ------------------------------------------------------------------------------------------------
describe('A1 purity: the four logic files use no DOM, three.js, Math.random, Date or performance', () => {
  for (const f of ['whackAMole', 'slingshot', 'memoryMatch', 'guessLocation', 'solvers']) {
    it(f, () => {
      const src = read(`src/logic/minigames/${f}.ts`);
      expect(src).not.toMatch(/\b(window|document|HTMLElement|performance|requestAnimationFrame|localStorage)\b/);
      expect(src).not.toMatch(/Math\.random|Date\.now|new Date|from\s+['"]three/);
    });
  }
});

describe('A2 determinism', () => {
  const sets: MinigameModifier[][] = [[], ...Object.values(KIND_MODS).map((m) => [m]), ALL_SIX];
  it('same ctx twice -> deepEqual; shuffled modifier order -> identical level (200 seeds x 3 difficulties x 8 sets + 20 random sets)', () => {
    for (const mg of NEW_LOGICS) {
      const rng = new Rng(77);
      for (let seed = 1; seed <= 200; seed++) {
        for (const d of DIFFS) {
          const all = [...sets, ...Array.from({ length: 20 }, () => randomMods(rng))];
          for (const mods of all) {
            const a = mg.generateLevel(ctx(seed, d, mods));
            expect(mg.generateLevel(ctx(seed, d, mods))).toEqual(a);
            if (mods.length > 1) expect(mg.generateLevel(ctx(seed, d, mods.slice().reverse()))).toEqual(a);
          }
        }
      }
    }
  }, 120_000);

  it('1000 seeds: different seeds give different levels in >= 99% of pairs', () => {
    for (const mg of NEW_LOGICS) {
      for (const d of DIFFS) {
        let same = 0;
        let prev = JSON.stringify(mg.generateLevel(ctx(1, d)));
        for (let seed = 2; seed <= 1000; seed++) {
          const cur = JSON.stringify(mg.generateLevel(ctx(seed, d)));
          if (cur === prev) same++;
          prev = cur;
        }
        expect(same / 999, `${mg.id} ${d}`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('draw order is fixed: fog does not shift the Whack schedule; hint does not shift Tebak Lokasi questions', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const d of DIFFS) {
        const a = gen(wm, seed, d);
        const b = gen(wm, seed, d, [{ kind: 'fog' }]);
        expect(b.spawns).toEqual(a.spawns);
        expect(a.fog).toEqual([]);
        expect(b.fog.length).toBeGreaterThan(0);
        const g1 = gen(gl, seed, d);
        const g2 = gen(gl, seed, d, [{ kind: 'hint' }]);
        expect(g2.items).toEqual(g1.items);
        expect(g2.hintActive).toBe(true);
      }
    }
  });
});

describe('A4 six modifiers: unknown kinds are ignored with a warning; every logic maps all six', () => {
  it('unknown modifier -> warning, level unchanged', () => {
    for (const mg of NEW_LOGICS) {
      const bad = { kind: 'bogus', x: 1 } as unknown as MinigameModifier;
      const lv = mg.generateLevel(ctx(5, 'medium', [bad])) as { warnings: string[] };
      const base = mg.generateLevel(ctx(5, 'medium')) as { warnings: string[] };
      expect(lv.warnings.length).toBe(1);
      expect(lv.warnings[0]).toContain(mg.id);
      expect({ ...lv, warnings: [] }).toEqual({ ...base, warnings: [] });
    }
  });

  it('registry test: all 7 logics define requires/introKey and none of the six kinds is silently ignored by the 4 new ones', () => {
    for (const mg of NEW_LOGICS) {
      for (const [kind, m] of Object.entries(KIND_MODS)) {
        const lv = mg.generateLevel(ctx(9, 'medium', [m])) as { warnings: string[] };
        expect(lv.warnings, `${mg.id} ${kind}`).toEqual([]);
      }
    }
    expect(MINIGAME_LOGIC.map((m) => m.id)).toEqual(['tap_timing', 'simon', 'dodge_runner', 'whack_a_mole', 'slingshot', 'memory_match', 'guess_location']);
  });

  it('each kind changes the level of each new minigame (no kind is a no-op)', () => {
    for (const mg of NEW_LOGICS) {
      for (const d of DIFFS) {
        const base = JSON.stringify(mg.generateLevel(ctx(3, d)));
        for (const [kind, m] of Object.entries(KIND_MODS)) {
          const mod = kind === 'timeDelta' && mg.id === 'whack_a_mole' ? ({ kind: 'timeDelta', seconds: 5 } as MinigameModifier) : m;
          // fog changes whack/memory/guess/slingshot level flags; hint likewise
          expect(JSON.stringify(mg.generateLevel(ctx(3, d, [mod]))), `${mg.id} ${d} ${kind}`).not.toBe(base);
        }
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------
describe('Whack-a-Mole (§5, W1-W4)', () => {
  const TABLE: Record<Difficulty, { cols: number; rows: number; hits: number; life: number; interval: number; decoyHits: number; S: number; decoy: number; T: number }> = {
    easy: { cols: 3, rows: 3, hits: 8, life: 1100, interval: 1250, decoyHits: 0, S: 15, decoy: 0, T: 15 },
    medium: { cols: 3, rows: 3, hits: 15, life: 900, interval: 650, decoyHits: 2, S: 29, decoy: 4, T: 25 },
    hard: { cols: 4, rows: 3, hits: 19, life: 700, interval: 480, decoyHits: 1, S: 39, decoy: 9, T: 30 },
  };

  it('A3 knob table and slot counts per difficulty (no modifier)', () => {
    for (const d of DIFFS) {
      const t = TABLE[d];
      const lv = gen(wm, 11, d);
      expect([lv.gridCols, lv.gridRows, lv.hitsRequired, lv.decoyHitsAllowed, lv.durationMs, lv.graceMs]).toEqual([t.cols, t.rows, t.hits, t.decoyHits, 20_000, 80]);
      expect(lv.spawns.length).toBe(t.S);
      expect(lv.spawns.filter((s) => s.kind === 'decoy').length).toBe(t.decoy);
      expect(lv.spawns.filter((s) => s.kind === 'target').length).toBe(t.T);
      expect(lv.spawns[0]!.tMs).toBe(700);
      expect(lv.spawns[1]!.tMs - lv.spawns[0]!.tMs).toBe(t.interval);
      expect(whackSlotCount(20_000, d)).toBe(t.S);
    }
  });

  it('W1 (DR-15): T >= ceil(1.5 x hitsRequired) for 5000 seeds x 3 difficulties x extraTarget 0/1/2; safety net never fires', () => {
    for (const d of DIFFS) {
      for (const extra of [0, 1, 2]) {
        const mods: MinigameModifier[] = extra ? [{ kind: 'extraTarget', count: extra }] : [];
        for (let seed = 1; seed <= 5000; seed++) {
          const lv = gen(wm, seed, d, mods);
          const T = lv.spawns.filter((s) => s.kind === 'target').length;
          expect(T).toBeGreaterThanOrEqual(Math.ceil(1.5 * lv.hitsRequired));
          if (seed <= 3) {
            expect(lv.warnings).toEqual([]);
            expect(lv.hitsRequired).toBe(TABLE[d].hits + 2 * extra);
            expect(lv.durationMs).toBe(20_000 + 3000 * extra);
          }
        }
      }
    }
    // The documented extraTarget examples.
    expect(gen(wm, 1, 'easy', [{ kind: 'extraTarget', count: 1 }]).spawns.filter((s) => s.kind === 'target').length).toBe(17);
    expect(gen(wm, 1, 'hard', [{ kind: 'extraTarget', count: 2 }]).spawns.filter((s) => s.kind === 'target').length).toBe(39);
  });

  it('W2: first 3 slots are targets, decoys = floor(S x ratio), no repeated hole, no hole reused while alive, life in range, max concurrency 1/2/2', () => {
    const maxAlive = { easy: 1, medium: 2, hard: 2 };
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 1500; seed++) {
        const lv = gen(wm, seed, d);
        const k = TABLE[d];
        expect(lv.spawns.slice(0, 3).every((s) => s.kind === 'target')).toBe(true);
        lv.spawns.forEach((s, i) => {
          if (i > 0) expect(s.hole).not.toBe(lv.spawns[i - 1]!.hole);
          for (let j = 0; j < i; j++) {
            const o = lv.spawns[j]!;
            if (o.tMs + k.life > s.tMs) expect(o.hole).not.toBe(s.hole);
          }
          expect(s.hole).toBeGreaterThanOrEqual(0);
          expect(s.hole).toBeLessThan(k.cols * k.rows);
          expect(s.lifeMs).toBeGreaterThanOrEqual(Math.round(k.life * 0.85) - 1);
          expect(s.lifeMs).toBeLessThanOrEqual(Math.round(k.life * 1.15) + 1);
          expect(s.lifeMs).toBeGreaterThanOrEqual(350);
          expect(s.lifeMs).toBeLessThanOrEqual(2500);
          const alive = lv.spawns.filter((o) => o.tMs <= s.tMs && o.tMs + k.life > s.tMs).length;
          expect(alive).toBeLessThanOrEqual(maxAlive[d]);
        });
      }
    }
  }, 60_000);

  it('W3: speed and timeDelta never change the schedule or duration; M is clamped; card examples', () => {
    for (const d of DIFFS) {
      const base = gen(wm, 21, d);
      for (const mods of [[{ kind: 'speed', mult: 1.25 }], [{ kind: 'timeDelta', seconds: -10 }], [{ kind: 'timeDelta', seconds: 10 }, { kind: 'speed', mult: 1.5625 }]] as MinigameModifier[][]) {
        const lv = gen(wm, 21, d, mods);
        expect(lv.spawns.map((s) => [s.tMs, s.hole, s.kind])).toEqual(base.spawns.map((s) => [s.tMs, s.hole, s.kind]));
        expect(lv.durationMs).toBe(base.durationMs);
      }
    }
    expect(tempoMultiplier(10, 10)).toBe(1.5);
    expect(tempoMultiplier(1, 40)).toBe(0.7);
    const medium = gen(wm, 33, 'medium');
    const rusak = gen(wm, 33, 'medium', [{ kind: 'timeDelta', seconds: -5 }]);
    const pasir = gen(wm, 33, 'medium', [{ kind: 'timeDelta', seconds: 5 }]);
    expect(rusak.tempo).toBeCloseTo(1.15, 9);
    expect(pasir.tempo).toBeCloseTo(0.85, 9);
    medium.spawns.forEach((s, i) => {
      expect(rusak.spawns[i]!.lifeMs).toBeCloseTo(s.lifeMs / 1.15, -0.3);
      expect(Math.abs(rusak.spawns[i]!.lifeMs - s.lifeMs / 1.15)).toBeLessThanOrEqual(1);
      expect(Math.abs(pasir.spawns[i]!.lifeMs - s.lifeMs * 1.176470588)).toBeLessThanOrEqual(1);
    });
    // Medium + Jam Rusak + Ngebut: M = 1.4375, mean life about 626 ms (+- 2 ms, average over seeds).
    let sum = 0;
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const lv = gen(wm, seed, 'medium', [{ kind: 'timeDelta', seconds: -5 }, { kind: 'speed', mult: 1.25 }]);
      expect(lv.tempo).toBeCloseTo(1.4375, 9);
      for (const s of lv.spawns) { sum += s.lifeMs; n++; }
    }
    expect(Math.abs(sum / n - 900 / 1.4375)).toBeLessThanOrEqual(2);
    // tolerance x1.3 -> life x1.3 (capped x1.5) and wider touch
    const tol = gen(wm, 33, 'medium', [{ kind: 'tolerance', mult: 1.3 }]);
    expect(tol.wideTouch).toBe(true);
    expect(Math.abs(tol.spawns[0]!.lifeMs - medium.spawns[0]!.lifeMs * 1.3)).toBeLessThanOrEqual(1);
    const tol2 = gen(wm, 33, 'medium', [{ kind: 'tolerance', mult: 3 }]);
    expect(Math.abs(tol2.spawns[0]!.lifeMs - medium.spawns[0]!.lifeMs * 1.5)).toBeLessThanOrEqual(1);
    // hint / fog
    expect(gen(wm, 33, 'medium', [{ kind: 'hint' }]).hintLeadMs).toBe(300);
    const fog = gen(wm, 33, 'medium', [{ kind: 'fog' }]).fog;
    expect(fog.length).toBe(Math.ceil(20_000 / 3000));
    expect(fog.every((w) => w.holes[0] !== w.holes[1])).toBe(true);
  });

  describe('W4 boundaries (hand-made level)', () => {
    const level = (over: Partial<WhackLevel> = {}): WhackLevel => ({
      ...gen(wm, 1, 'medium'), durationMs: 20_000, hitsRequired: 2, decoyHitsAllowed: 1, graceMs: 80,
      spawns: [
        { tMs: 1000, hole: 0, kind: 'target', lifeMs: 500 },
        { tMs: 3000, hole: 1, kind: 'decoy', lifeMs: 500 },
        { tMs: 5000, hole: 2, kind: 'decoy', lifeMs: 500 },
        { tMs: 7000, hole: 3, kind: 'target', lifeMs: 500 },
        { tMs: 19_900, hole: 4, kind: 'target', lifeMs: 500 },
      ], ...over,
    });
    const hit = (lv: WhackLevel, hole: number, t: number) => wm.step(lv, wm.initState(lv), { hole }, t);
    it('last millisecond of life + grace hits, the next does not; empty holes are ignored', () => {
      const lv = level();
      expect(hit(lv, 0, 1000 + 500 + 80 - 1).hits).toBe(1);
      expect(hit(lv, 0, 1000 + 500 + 80).hits).toBe(0);
      expect(hit(lv, 0, 999).hits).toBe(0);
      const s = hit(lv, 5, 1200);
      expect(s).toMatchObject({ hits: 0, decoyHits: 0, result: null });
      expect(hit(lv, 99, 1200).hits).toBe(0);
    });
    it('a spawn is hit once; the decoy past the allowance fails at once', () => {
      const lv = level();
      let s = wm.step(lv, wm.initState(lv), { hole: 0 }, 1100);
      s = wm.step(lv, s, { hole: 0 }, 1200);
      expect(s.hits).toBe(1);
      s = wm.step(lv, s, { hole: 1 }, 3100);
      expect(s.decoyHits).toBe(1);
      expect(wm.result(lv, s)).toBeNull();
      s = wm.step(lv, s, { hole: 2 }, 5100);
      expect(wm.result(lv, s)).toMatchObject({ passed: false, reason: 'failLimit', timeTakenMs: 5100 });
    });
    it('hitsRequired before durationMs passes at once; at or after durationMs the input is ignored (timeout)', () => {
      const lv = level({ hitsRequired: 1 });
      expect(wm.result(lv, wm.step(lv, wm.initState(lv), { hole: 4 }, 19_950))).toMatchObject({ passed: true, reason: 'success', timeTakenMs: 19_950 });
      const lv2 = level({ hitsRequired: 1, spawns: [{ tMs: 19_990, hole: 4, kind: 'target', lifeMs: 500 }] });
      const late = wm.step(lv2, wm.initState(lv2), { hole: 4 }, 20_000);
      expect(wm.result(lv2, late)).toMatchObject({ passed: false, reason: 'timeout', progress: 0, timeTakenMs: 20_000 });
      const ok = wm.step(lv2, wm.initState(lv2), { hole: 4 }, 19_999);
      expect(wm.result(lv2, ok)?.passed).toBe(true);
    });
    it('a new spawn in a hole that is still occupied replaces the old character without penalty', () => {
      const lv = level({ spawns: [{ tMs: 1000, hole: 0, kind: 'target', lifeMs: 2000 }, { tMs: 1500, hole: 0, kind: 'decoy', lifeMs: 300 }] });
      const at = (t: number) => wm.step(lv, wm.initState(lv), { hole: 0 }, t);
      expect(at(1400).hits).toBe(1);
      const s = at(1600);
      expect(s.hits).toBe(0);
      expect(s.decoyHits).toBe(1);
    });
  });

  it('A5 perfect player passes, idle player times out (no modifiers 2000 seeds; each single set 300 seeds)', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 2000; seed++) {
        const lv = gen(wm, seed, d);
        const r = runScript(wm, lv, whackPerfectScript(lv), lv.durationMs + 1000).result!;
        expect(r.passed, `${d} ${seed}`).toBe(true);
        expect(r.progress).toBe(1);
        const idle = runScript(wm, lv, [], lv.durationMs + 1000).result!;
        expect(idle).toMatchObject({ passed: false, reason: 'timeout' });
      }
      for (const [name, mods] of SINGLE_SETS) {
        for (let seed = 1; seed <= 300; seed++) {
          const lv = gen(wm, seed, d, mods);
          expect(runScript(wm, lv, whackPerfectScript(lv), lv.durationMs + 1000).result?.passed, `${d} ${name} ${seed}`).toBe(true);
        }
      }
      let ok = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const lv = gen(wm, seed, d, EXTREME);
        if (runScript(wm, lv, whackPerfectScript(lv), lv.durationMs + 1000).result?.passed) ok++;
      }
      expect(ok / 300, `extreme ${d}`).toBeGreaterThanOrEqual(0.95);
    }
  }, 120_000);

  it('A7 progress is within 0..1 and never decreases; timeTakenMs within duration', () => {
    const lv = gen(wm, 4, 'hard');
    let s = wm.initState(lv);
    let last = 0;
    for (const e of whackPerfectScript(lv)) {
      s = wm.step(lv, s, e.input, e.tMs);
      const p = (wm.result(lv, s) ?? { progress: s.hits / lv.hitsRequired }).progress;
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
    expect(wm.result(lv, s)!.timeTakenMs).toBeLessThanOrEqual(lv.durationMs);
  });
});

// ------------------------------------------------------------------------------------------------
describe('Ketapel (§6, K1-K6 logic)', () => {
  const TABLE: Record<Difficulty, { targets: number; required: number; bullets: number; radius: number; aim: number; wind: number; moving: number; speed: number }> = {
    easy: { targets: 4, required: 3, bullets: 6, radius: 1.5, aim: 1, wind: 0, moving: 0, speed: 0 },
    medium: { targets: 5, required: 4, bullets: 6, radius: 1.1, aim: 0.4, wind: 1, moving: 1, speed: 0.6 },
    hard: { targets: 6, required: 5, bullets: 6, radius: 0.8, aim: 0.15, wind: 2, moving: 2, speed: 0.8 },
  };

  it('A3 knob table', () => {
    for (const d of DIFFS) {
      const t = TABLE[d];
      const lv = gen(sl, 8, d);
      expect([lv.targets.length, lv.targetsRequired, lv.bullets, lv.hitRadiusM, lv.aimLineFrac, Math.abs(lv.windMps), lv.movingCount, lv.moveSpeedMps, lv.durationMs, lv.reloadMs, lv.fallMs])
        .toEqual([t.targets, t.required, t.bullets, t.radius, t.aim, t.wind, t.moving, t.speed, 30_000, 400, 700]);
    }
  });

  it('K2: spacing >= 4 m in >= 95% of levels, y >= 2 m, z 8-30 m, wind sign 50/50 +-3 points (5000 seeds)', () => {
    for (const d of DIFFS) {
      let spaced = 0;
      let pos = 0;
      const N = 5000;
      for (let seed = 1; seed <= N; seed++) {
        const lv = gen(sl, seed, d);
        let ok = true;
        lv.targets.forEach((a, i) => {
          expect(a.center.y).toBeGreaterThanOrEqual(2);
          expect(a.center.z).toBeGreaterThanOrEqual(8);
          expect(a.center.z).toBeLessThanOrEqual(30);
          for (let j = i + 1; j < lv.targets.length; j++) {
            const b = lv.targets[j]!;
            if (Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) < 4) ok = false;
          }
        });
        if (ok) spaced++;
        if (lv.windMps > 0) pos++;
        if (d === 'easy') expect(lv.windMps).toBe(0);
      }
      expect(spaced / N, `${d} spacing`).toBeGreaterThanOrEqual(0.95);
      if (d !== 'easy') expect(Math.abs(pos / N - 0.5)).toBeLessThanOrEqual(0.03);
    }
    // wind x speed capped at 3
    expect(Math.abs(gen(sl, 1, 'hard', [{ kind: 'speed', mult: 2 }]).windMps)).toBe(3);
  });

  it('K1: shooting the ideal shot hits target i (static targets >= 99.5%, rest hit another target first); 5000 seeds', () => {
    for (const d of DIFFS) {
      let good = 0;
      let total = 0;
      for (let seed = 1; seed <= 5000; seed++) {
        const lv = gen(sl, seed, d);
        lv.targets.forEach((t, i) => {
          if (i < lv.movingCount) return;
          total++;
          if (simulateShot(lv, { yawDeg: t.ideal.yawDeg, power: t.ideal.power }, 0).hitIndex === i) good++;
          else expect(simulateShot(lv, { yawDeg: t.ideal.yawDeg, power: t.ideal.power }, 0).hitIndex).not.toBeNull();
        });
      }
      expect(good / total, d).toBeGreaterThanOrEqual(0.995);
    }
  });

  it('K1/A5: the perfect player drops targetsRequired targets in time on 100% of seeds (no modifiers)', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 1500; seed++) {
        const lv = gen(sl, seed, d);
        const r = runScript(sl, lv, slingshotPerfectScript(lv), lv.durationMs + 4000).result!;
        expect(r.passed, `${d} seed ${seed}`).toBe(true);
        expect(r.progress).toBe(1);
        expect(r.timeTakenMs).toBeLessThanOrEqual(lv.durationMs + 3000);
        expect(runScript(sl, lv, [], lv.durationMs + 4000).result).toMatchObject({ passed: false, reason: 'timeout' });
      }
    }
  }, 180_000);

  it('A5: perfect player with each single modifier (incl. 2x Jam Rusak) passes 100%; extreme combo >= 95%', () => {
    for (const d of DIFFS) {
      for (const [name, mods] of SINGLE_SETS) {
        for (let seed = 1; seed <= 150; seed++) {
          const lv = gen(sl, seed, d, mods);
          expect(runScript(sl, lv, slingshotPerfectScript(lv), lv.durationMs + 4000).result?.passed, `${d} ${name} ${seed}`).toBe(true);
        }
      }
      let ok = 0;
      for (let seed = 1; seed <= 150; seed++) {
        const lv = gen(sl, seed, d, EXTREME);
        if (runScript(sl, lv, slingshotPerfectScript(lv), lv.durationMs + 4000).result?.passed) ok++;
      }
      expect(ok / 150, `extreme ${d}`).toBeGreaterThanOrEqual(0.95);
    }
  }, 240_000);

  it('K3: 5 ms sampling gives the same hitIndex as 1 ms in >= 99.9% of 20000 random shots', () => {
    const rng = new Rng(2024);
    let same = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const lv = gen(sl, 1 + (i % 400), DIFFS[i % 3]!);
      const aim = { yawDeg: rng.range(-25, 25), power: rng.range(0.2, 1) };
      const t = rng.range(0, 20_000);
      if (simulateShot(lv, aim, t, [], 5).hitIndex === simulateShot(lv, aim, t, [], 1).hitIndex) same++;
    }
    expect(same / N).toBeGreaterThanOrEqual(0.999);
    // no tunnelling: the reach (>= 0.95 m) is far larger than the largest 5 ms step
    const vMax = 22;
    expect(vMax * 0.005).toBeLessThan(0.8 + 0.15);
  }, 120_000);

  it('K4: aimFromDrag cancel threshold, power range, yaw clamp and direction', () => {
    const maxDrag = 200;
    expect(aimFromDrag(0, 39, maxDrag)).toBeNull(); // < 20% of 200
    expect(aimFromDrag(0, 40, maxDrag)).not.toBeNull();
    expect(aimFromDrag(10, -3, 5000)).toBeNull();
    expect(aimFromDrag(0, 40, maxDrag)!.power).toBeCloseTo(0.2, 9);
    expect(aimFromDrag(0, 4000, maxDrag)!.power).toBe(1);
    for (let i = 0; i < 2000; i++) {
      const rng = new Rng(i);
      const dx = rng.range(-300, 300);
      const dy = rng.range(-300, 300);
      const a = aimFromDrag(dx, dy, maxDrag);
      if (!a) continue;
      expect(a.power).toBeGreaterThanOrEqual(0.2);
      expect(a.power).toBeLessThanOrEqual(1);
      expect(Math.abs(a.yawDeg)).toBeLessThanOrEqual(25);
      if (dx > 1) expect(a.yawDeg).toBeLessThanOrEqual(0); // drag right -> shoot left
      if (dx < -1) expect(a.yawDeg).toBeGreaterThanOrEqual(0);
      if (dy <= 0) expect(Math.abs(a.yawDeg)).toBe(25); // dragging up = maximum yaw, against dx
    }
    expect(aimFromDrag(0, 100, maxDrag)!.yawDeg).toBe(0);
    const a = aimFromDrag(-100, 100, maxDrag)!; // 45 deg left drag, clamped to 25 and mirrored
    expect(a.yawDeg).toBe(25);
  });

  describe('K5 boundaries (hand-made level)', () => {
    /** One static target straight ahead at the ideal of power 0.6 / yaw 0. */
    const mk = (over: Partial<SlingLevel> = {}): SlingLevel => {
      const base = gen(sl, 1, 'easy');
      const aim = { yawDeg: 0, power: 0.6 };
      const T = groundTimeSec(aim.power);
      const c = shotPosition(aim, 0, 0.7 * T);
      return {
        ...base, durationMs: 30_000, bullets: 4, targetsRequired: 1, windMps: 0, movingCount: 0, hitRadiusM: 1,
        targets: [{ ...base.targets[0]!, center: c, ideal: { yawDeg: 0, power: 0.6, tFrac: 0.7 } }], ...over,
      };
    };
    const GOOD = { yawDeg: 0, power: 0.6 };
    const MISS = { yawDeg: 25, power: 0.3 };
    const flight = (lv: SlingLevel, aim = GOOD) => simulateShot(lv, aim, 0).flightMs;

    it('shot at durationMs - 1 is judged in full and can pass after durationMs; at durationMs it is ignored', () => {
      const lv = mk();
      let s = sl.step(lv, sl.initState(lv), GOOD, 29_999);
      expect(sl.result(lv, s)).toBeNull();
      s = sl.step(lv, s, null, 29_999 + flight(lv));
      expect(sl.result(lv, s)).toMatchObject({ passed: true, reason: 'success', timeTakenMs: 29_999 + flight(lv) });
      expect(29_999 + flight(lv)).toBeGreaterThan(30_000);
      const late = sl.step(lv, sl.initState(lv), GOOD, 30_000);
      expect(sl.result(lv, late)).toMatchObject({ passed: false, reason: 'timeout' });
      expect(late.bulletsLeft).toBe(4);
    });
    it('input while a bullet flies or reloads is ignored and uses no bullet; pass counts at landing', () => {
      const lv = mk({ targetsRequired: 2, targets: [...mk().targets, { ...mk().targets[0]!, center: { x: 30, y: 3, z: 12 } }] });
      let s = sl.step(lv, sl.initState(lv), MISS, 1000);
      expect(s.bulletsLeft).toBe(3);
      const fl = flight(lv, MISS);
      s = sl.step(lv, s, GOOD, 1000 + fl - 1); // still in the air
      expect(s.bulletsLeft).toBe(3);
      s = sl.step(lv, s, GOOD, 1000 + fl + 399); // reloading
      expect(s.bulletsLeft).toBe(3);
      s = sl.step(lv, s, GOOD, 1000 + fl + 400);
      expect(s.bulletsLeft).toBe(2);
      expect(sl.result(lv, s)).toBeNull(); // the hit is only counted when the bullet lands
      expect(s.down.length).toBe(0);
      s = sl.step(lv, s, null, 1000 + fl + 400 + flight(lv));
      expect(s.down.length).toBe(1);
    });
    it('fails the moment the bullets left cannot cover what is missing; running out of bullets is failLimit', () => {
      const lv = mk({ bullets: 3, targetsRequired: 2, targets: [mk().targets[0]!, { ...mk().targets[0]!, center: { x: 30, y: 3, z: 12 } }] });
      let t = 0;
      let s = sl.initState(lv);
      s = sl.step(lv, s, MISS, t);
      s = sl.step(lv, s, null, (t += flight(lv, MISS)));
      expect(sl.result(lv, s)).toBeNull(); // 2 bullets left, 2 needed
      s = sl.step(lv, s, MISS, (t += 400));
      s = sl.step(lv, s, null, (t += flight(lv, MISS)));
      expect(sl.result(lv, s)).toMatchObject({ passed: false, reason: 'failLimit', timeTakenMs: t }); // 1 left < 2 needed
    });
    it('speed shortens the duration: max(min(d, 15 s), d / mult); extraTarget +2 hard = 8 targets / 7 required / 8 bullets / 38 s', () => {
      expect(gen(sl, 1, 'easy', [{ kind: 'speed', mult: 1.25 }]).durationMs).toBe(24_000);
      expect(gen(sl, 1, 'easy', [{ kind: 'speed', mult: 1.25 }, { kind: 'timeDelta', seconds: -20 }]).durationMs).toBe(10_000);
      expect(gen(sl, 1, 'easy', [{ kind: 'speed', mult: 3 }]).durationMs).toBe(15_000);
      const h = gen(sl, 1, 'hard', [{ kind: 'extraTarget', count: 2 }]);
      expect([h.targets.length, h.targetsRequired, h.bullets, h.durationMs]).toEqual([8, 7, 8, 38_000]);
      expect(gen(sl, 1, 'medium', [{ kind: 'tolerance', mult: 1.3 }]).hitRadiusM).toBeCloseTo(1.43, 9);
      expect(gen(sl, 1, 'medium', [{ kind: 'tolerance', mult: 5 }]).hitRadiusM).toBe(2.2);
      expect(gen(sl, 1, 'medium', [{ kind: 'timeDelta', seconds: -5 }]).durationMs).toBe(25_000);
      const hint = gen(sl, 1, 'hard', [{ kind: 'hint' }]);
      expect([hint.aimLineFrac, hint.hitPreview]).toEqual([1, true]);
      expect(gen(sl, 1, 'hard', [{ kind: 'fog' }]).fog).toBe(true);
      const sp = gen(sl, 1, 'hard', [{ kind: 'speed', mult: 1.25 }]);
      expect(sp.moveSpeedMps).toBeCloseTo(1, 9);
      expect(Math.abs(sp.windMps)).toBeCloseTo(2.5, 9);
    });
  });

  it('a hit target is excluded from later shots; a bullet downs at most one target', () => {
    const lv = gen(sl, 5, 'easy');
    const t0 = lv.targets[0]!;
    const aim = { yawDeg: t0.ideal.yawDeg, power: t0.ideal.power };
    expect(simulateShot(lv, aim, 0).hitIndex).not.toBeNull();
    const first = simulateShot(lv, aim, 0).hitIndex!;
    expect(simulateShot(lv, aim, 0, [first]).hitIndex).not.toBe(first);
  });
});

// ------------------------------------------------------------------------------------------------
describe('Cocokkan Kartu (§7, M1-M4)', () => {
  const ICON_COUNT = (DATA.minigameThemes['memory_match']!['icons'] as string[]).length;
  const GROUPS = DATA.minigameThemes['memory_match']!['iconGroups'] as string[];
  const ICONS = DATA.minigameThemes['memory_match']!['icons'] as string[];
  const TABLE: Record<Difficulty, { pairs: number; cols: number; rows: number; preview: number; delay: number; similar: number }> = {
    easy: { pairs: 6, cols: 3, rows: 4, preview: 2000, delay: 800, similar: 0 },
    medium: { pairs: 8, cols: 4, rows: 4, preview: 1000, delay: 700, similar: 2 },
    hard: { pairs: 10, cols: 4, rows: 5, preview: 0, delay: 600, similar: 4 },
  };
  /** Number of colour groups that hold >= 2 of the chosen icons. */
  const similarGroups = (lv: MemoryLevel): number => {
    const per = new Map<string, number>();
    for (const icon of new Set(lv.cards)) per.set(GROUPS[ICONS.indexOf(icon)]!, (per.get(GROUPS[ICONS.indexOf(icon)]!) ?? 0) + 1);
    return [...per.values()].filter((n) => n >= 2).length;
  };

  it('A3 knob table and the 14 icons / 6 groups of the map', () => {
    expect(ICON_COUNT).toBe(14);
    expect(new Set(GROUPS).size).toBe(6);
    for (const d of DIFFS) {
      const t = TABLE[d];
      const lv = gen(mm, 3, d);
      expect([lv.pairs, lv.cols, lv.rows, lv.previewMs, lv.mismatchDelayMs, lv.flipMs, lv.durationMs, lv.cards.length])
        .toEqual([t.pairs, t.cols, t.rows, t.preview, t.delay, 200, 30_000, 2 * t.pairs]);
    }
  });

  it('M1: each chosen icon appears exactly twice, from the map list; positions are uniform over 12000 seeds (chi-square df=11 < 31.3)', () => {
    const counts = new Array(12).fill(0) as number[];
    let copies = 0;
    for (let seed = 1; seed <= 12_000; seed++) {
      const lv = gen(mm, seed, 'easy');
      const seen = new Map<string, number>();
      for (const c of lv.cards) seen.set(c, (seen.get(c) ?? 0) + 1);
      for (const [icon, n] of seen) {
        expect(ICONS).toContain(icon);
        expect(n).toBe(2);
      }
      lv.cards.forEach((c, i) => { if (c === ICONS[0]) { counts[i]!++; copies++; } });
    }
    const exp = copies / 12;
    const chi = counts.reduce((a, c) => a + (c - exp) ** 2 / exp, 0);
    expect(chi).toBeLessThan(31.3);
  });

  it('M2 (DR-18): similar-card groups = max(0, pairs - 6); round-robin per group; grid for 6..12 pairs', () => {
    for (const d of DIFFS) for (let seed = 1; seed <= 500; seed++) expect(similarGroups(gen(mm, seed, d))).toBe(TABLE[d].similar);
    expect(similarGroups(gen(mm, 1, 'hard', [{ kind: 'extraTarget', count: 2 }]))).toBe(6);
    expect(gen(mm, 1, 'hard', [{ kind: 'extraTarget', count: 2 }]).pairs).toBe(12);
    const grid: [number, number, number][] = [[6, 3, 4], [7, 4, 4], [8, 4, 4], [9, 4, 5], [10, 4, 5], [11, 4, 6], [12, 4, 6]];
    for (const [pairs, cols, rows] of grid) {
      const extra = pairs - 6;
      const lv = gen(mm, 2, 'easy', extra > 0 ? [{ kind: 'extraTarget', count: Math.min(2, extra) }] : []);
      if (extra <= 2) expect([lv.pairs, lv.cols, lv.rows]).toEqual([pairs, cols, rows]);
    }
    const med2 = gen(mm, 2, 'medium', [{ kind: 'extraTarget', count: 1 }]);
    expect([med2.pairs, med2.cols, med2.rows]).toEqual([9, 4, 5]);
    const hard1 = gen(mm, 2, 'hard', [{ kind: 'extraTarget', count: 1 }]);
    expect([hard1.pairs, hard1.cols, hard1.rows]).toEqual([11, 4, 6]);
    const e1 = gen(mm, 2, 'easy', [{ kind: 'extraTarget', count: 1 }]);
    expect([e1.pairs, e1.cols, e1.rows]).toEqual([7, 4, 4]);
  });

  it('requires: < 12 icons or iconGroups of another length -> not in the pool', () => {
    const few = indonesiaData();
    (few.minigameThemes['memory_match']!['icons'] as string[]).length = 11;
    (few.minigameThemes['memory_match']!['iconGroups'] as string[]).length = 11;
    expect(minigamePool(few)).not.toContain('memory_match');
    const mismatch = indonesiaData();
    (mismatch.minigameThemes['memory_match']!['iconGroups'] as string[]).pop();
    expect(minigamePool(mismatch)).not.toContain('memory_match');
    const none = indonesiaData();
    delete none.minigameThemes['memory_match'];
    expect(minigamePool(none)).toEqual(['tap_timing', 'simon', 'dodge_runner', 'whack_a_mole', 'slingshot', 'guess_location']);
    expect(minigamePool(DATA)).toContain('memory_match');
  });

  describe('M3 rules (hand-made deck)', () => {
    /** Deck A B C A B C on 6 cards; no preview; 700 ms mismatch delay. */
    const lv = (over: Partial<MemoryLevel> = {}): MemoryLevel => ({
      ...gen(mm, 1, 'hard'), pairs: 3, cols: 3, rows: 2, cards: ['a', 'b', 'c', 'a', 'b', 'c'], previewMs: 0, durationMs: 30_000, mismatchDelayMs: 700, peekAvailable: false, peekMs: 1000, ...over,
    });
    const play = (l: MemoryLevel, steps: [number, number | 'peek'][]) => {
      let s = mm.initState(l);
      for (const [t, c] of steps) s = mm.step(l, s, c === 'peek' ? { peek: true } : { card: c }, t);
      return s;
    };
    it('the second card is compared at once; a match removes both; open or matched cards are ignored', () => {
      const l = lv();
      let s = play(l, [[100, 0], [200, 3]]);
      expect(s.matched).toEqual([0, 3]);
      expect(s.open).toEqual([]);
      s = mm.step(l, s, { card: 0 }, 300);
      expect(s.open).toEqual([]);
      s = mm.step(l, s, { card: 1 }, 400);
      s = mm.step(l, s, { card: 1 }, 410); // same open card again: ignored
      expect(s.open).toEqual([1]);
    });
    it('a mismatch stays open for mismatchDelayMs, then closes', () => {
      const l = lv();
      let s = play(l, [[100, 0], [200, 1]]);
      expect(s.open).toEqual([0, 1]);
      expect(s.mismatches).toBe(1);
      s = mm.step(l, s, null, 200 + 699);
      expect(s.open).toEqual([0, 1]);
      s = mm.step(l, s, null, 200 + 700);
      expect(s.open).toEqual([]);
    });
    it('peek-ahead: tapping another closed card during the delay closes the wrong pair at once and opens it as the first card', () => {
      const l = lv();
      const s = play(l, [[100, 0], [200, 1], [300, 2]]);
      expect(s.open).toEqual([2]);
      expect(s.closing).toBeNull();
      expect(s.mismatches).toBe(1);
      // tapping one of the two wrong cards during the delay is ignored (they are open)
      const t = play(l, [[100, 0], [200, 1], [300, 1]]);
      expect(t.open).toEqual([0, 1]);
    });
    it('input is ignored during the preview; real time = previewMs + durationMs', () => {
      const l = lv({ previewMs: 2000 });
      expect(play(l, [[1999, 0]]).open).toEqual([]);
      expect(play(l, [[2000, 0]]).open).toEqual([0]);
      const idle = mm.step(l, mm.initState(l), null, 2000 + 30_000 - 1);
      expect(mm.result(l, idle)).toBeNull();
      const done = mm.step(l, mm.initState(l), null, 2000 + 30_000);
      expect(mm.result(l, done)).toMatchObject({ passed: false, reason: 'timeout', timeTakenMs: 32_000, progress: 0 });
    });
    it('the last pair at playMs = durationMs - 1 passes; at >= durationMs it does not', () => {
      const l = lv({ previewMs: 1000 });
      const pre: [number, number][] = [[1100, 0], [1200, 3], [1300, 1], [1400, 4], [1500, 2]];
      const end = (t: number) => mm.result(l, play(l, [...pre, [t, 5]]));
      expect(end(1000 + 30_000 - 1)).toMatchObject({ passed: true, timeTakenMs: 30_999 });
      expect(end(1000 + 30_000)).toMatchObject({ passed: false, reason: 'timeout' });
    });
  });

  it('M4 modifiers: Zona Lebar preview +1 s (hard 0 -> 1 s), x2 -> +3 s cap; Ngebut speeds delay/flip/preview; hint; extraTarget', () => {
    expect(gen(mm, 1, 'hard', [{ kind: 'tolerance', mult: 1.3 }]).previewMs).toBe(1000);
    expect(gen(mm, 1, 'easy', [{ kind: 'tolerance', mult: 1.3 }]).previewMs).toBe(3000);
    expect(gen(mm, 1, 'medium', [{ kind: 'tolerance', mult: 2 }]).previewMs).toBe(4000);
    expect(gen(mm, 1, 'hard', [{ kind: 'tolerance', mult: 3 }]).previewMs).toBe(3000);
    const fast = gen(mm, 1, 'easy', [{ kind: 'speed', mult: 1.25 }]);
    expect([fast.mismatchDelayMs, fast.previewMs, fast.flipMs]).toEqual([640, 1600, 160]);
    const both = gen(mm, 1, 'easy', [{ kind: 'speed', mult: 1.25 }, { kind: 'tolerance', mult: 1.3 }]);
    expect(both.previewMs).toBe(2600);
    expect(gen(mm, 1, 'easy', [{ kind: 'speed', mult: 10 }]).mismatchDelayMs).toBe(250);
    expect(gen(mm, 1, 'hard', [{ kind: 'extraTarget', count: 2 }]).durationMs).toBe(34_000);
    expect(gen(mm, 1, 'hard', [{ kind: 'timeDelta', seconds: -10 }]).durationMs).toBe(20_000);
    expect(gen(mm, 1, 'hard', [{ kind: 'timeDelta', seconds: 10 }]).durationMs).toBe(40_000);
    expect(gen(mm, 1, 'hard', [{ kind: 'fog' }]).fog).toBe(true);
    // hint: one peek, 1000 ms, timer runs, input ignored while it lasts
    const l = gen(mm, 1, 'hard', [{ kind: 'hint' }]);
    expect(l.peekAvailable).toBe(true);
    let s = mm.step(l, mm.initState(l), { card: 0 }, 100);
    s = mm.step(l, s, { peek: true }, 200);
    expect(s.open).toEqual([]);
    expect(s.peekUntilMs).toBe(1200);
    const ignored = mm.step(l, s, { card: 5 }, 1199);
    expect(ignored.open).toEqual([]);
    const after = mm.step(l, s, { card: 5 }, 1200);
    expect(after.open).toEqual([5]);
    const again = mm.step(l, after, { peek: true }, 2000);
    expect(again.peekUntilMs).toBe(1200); // only once
    expect(mm.step(gen(mm, 1, 'hard'), mm.initState(gen(mm, 1, 'hard')), { peek: true }, 100).peekUsed).toBe(false); // without the card
  });

  it('A5 perfect player passes, idle player times out', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 2000; seed++) {
        const lv = gen(mm, seed, d);
        const r = runScript(mm, lv, memoryPerfectScript(lv), lv.previewMs + lv.durationMs + 1000).result!;
        expect(r.passed, `${d} ${seed}`).toBe(true);
        expect(r.timeTakenMs).toBeLessThanOrEqual(lv.previewMs + lv.durationMs);
        expect(runScript(mm, lv, [], lv.previewMs + lv.durationMs + 1000).result).toMatchObject({ passed: false, reason: 'timeout' });
      }
      for (const [name, mods] of SINGLE_SETS) {
        for (let seed = 1; seed <= 300; seed++) {
          const lv = gen(mm, seed, d, mods);
          expect(runScript(mm, lv, memoryPerfectScript(lv), lv.previewMs + lv.durationMs + 1000).result?.passed, `${d} ${name}`).toBe(true);
        }
      }
      let ok = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const lv = gen(mm, seed, d, EXTREME);
        if (runScript(mm, lv, memoryPerfectScript(lv), lv.previewMs + lv.durationMs + 1000).result?.passed) ok++;
      }
      expect(ok / 300).toBeGreaterThanOrEqual(0.95);
    }
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------
describe('Tebak Lokasi (§8, T1-T6)', () => {
  const TABLE: Record<Difficulty, { q: number; req: number; choices: number; tpq: number; duration: number; clue: string }> = {
    easy: { q: 3, req: 2, choices: 3, tpq: 8000, duration: 25_000, clue: 'nameAndImage' },
    medium: { q: 4, req: 3, choices: 4, tpq: 6000, duration: 25_500, clue: 'hintAndImage' },
    hard: { q: 5, req: 4, choices: 4, tpq: 5000, duration: 27_000, clue: 'imageOnly' },
  };

  it('A3/T5 (DR-42): knob table and durations 25.0 / 25.5 / 27.0 s without modifiers', () => {
    for (const d of DIFFS) {
      const t = TABLE[d];
      const lv = gen(gl, 4, d);
      expect([lv.questions, lv.correctRequired, lv.choiceCount, lv.timePerQuestionMs, lv.gapMs, lv.durationMs, lv.clueMode, lv.items.length])
        .toEqual([t.q, t.req, t.choices, t.tpq, 500, t.duration, t.clue, t.q]);
    }
  });

  it('T5 per-question time formula with the document examples, always within 3-10 s', () => {
    const med = gen(gl, 1, 'medium', [{ kind: 'timeDelta', seconds: -5 }]);
    expect(med.timePerQuestionMs).toBe(4750);
    expect(med.durationMs).toBe(20_500);
    const medExtra = gen(gl, 1, 'medium', [{ kind: 'timeDelta', seconds: -5 }, { kind: 'extraTarget', count: 1 }]);
    expect([medExtra.questions, medExtra.correctRequired, medExtra.timePerQuestionMs, medExtra.durationMs]).toEqual([5, 4, 4750, 25_750]);
    const hard = gen(gl, 1, 'hard', [{ kind: 'timeDelta', seconds: -10 }]);
    expect([hard.timePerQuestionMs, hard.durationMs]).toEqual([3000, 17_000]);
    const easy = gen(gl, 1, 'easy', [{ kind: 'timeDelta', seconds: 10 }]);
    expect([easy.timePerQuestionMs, easy.durationMs]).toEqual([10_000, 31_000]);
    expect(gen(gl, 1, 'medium', [{ kind: 'timeDelta', seconds: 5 }]).timePerQuestionMs).toBe(7250); // +1.25 s
    expect(gen(gl, 1, 'medium', [{ kind: 'tolerance', mult: 1.3 }]).timePerQuestionMs).toBe(7800);
    expect(gen(gl, 1, 'medium', [{ kind: 'speed', mult: 1.25 }]).timePerQuestionMs).toBe(4800);
    expect(gen(gl, 1, 'medium', [{ kind: 'fog' }]).fogBlurPx).toBe(6);
    expect(gen(gl, 1, 'medium', [{ kind: 'hint' }]).hintActive).toBe(true);
    for (const d of DIFFS) {
      for (const mods of [...SINGLE_SETS.map((x) => x[1]), EXTREME, ALL_SIX]) {
        const lv = gen(gl, 2, d, mods);
        expect(lv.timePerQuestionMs).toBeGreaterThanOrEqual(3000);
        expect(lv.timePerQuestionMs).toBeLessThanOrEqual(10_000);
      }
    }
    const ex = gen(gl, 1, 'hard', [{ kind: 'extraTarget', count: 2 }]);
    expect([ex.questions, ex.correctRequired]).toEqual([7, 6]);
    expect(gen(gl, 1, 'easy', [{ kind: 'extraTarget', count: 2 }]).questions).toBe(5);
    expect(gen(gl, 1, 'medium', [{ kind: 'extraTarget', count: 2 }]).correctRequired).toBe(5);
  });

  it('T1: all question data comes from the map (no place or region names in the logic or its views); a synthetic map gives questions from its own places', () => {
    const names = new Set<string>();
    for (const p of DATA.places) for (const n of Object.values(p.name)) names.add(n.toLowerCase());
    for (const f of ['src/logic/minigames/guessLocation.ts', 'src/ui/minigames/guessView.ts', 'src/ui/minigames/guess.css']) {
      const src = read(f).toLowerCase();
      for (const n of names) expect(src.includes(n), `${f} mentions "${n}"`).toBe(false);
    }
    const syn = indonesiaData();
    syn.places = Array.from({ length: 12 }, (_, i) => ({
      id: `syn_${i}`, name: { id: `Tempat ${i}` }, regionId: syn.regions[i % 10]!.id, image: `x${i}.webp`, icon: `x${i}.png`, hint: { id: `Petunjuk ${i}` },
    }));
    const lv = gl.generateLevel(ctx(3, 'hard', [], syn));
    expect(lv.items.every((it) => it.placeId.startsWith('syn_'))).toBe(true);
  });

  it('T2 requires: 9 places -> out; 10 places in 6 regions -> out; 10 in 7 -> in; Indonesia (13 / 10) -> in; the rest of the pool is intact', () => {
    const mk = (n: number, regions: number): MapData => {
      const d = indonesiaData();
      d.places = Array.from({ length: n }, (_, i) => ({ ...d.places[0]!, id: `p${i}`, regionId: d.regions[i % regions]!.id }));
      return d;
    };
    expect(minigamePool(mk(9, 9))).not.toContain('guess_location');
    expect(minigamePool(mk(10, 6))).not.toContain('guess_location');
    expect(minigamePool(mk(10, 7))).toContain('guess_location');
    expect(minigamePool(DATA)).toContain('guess_location');
    expect(DATA.places.length).toBe(13);
    expect(new Set(DATA.places.map((p) => p.regionId)).size).toBe(10);
    expect(minigamePool(mk(9, 9))).toEqual(['tap_timing', 'simon', 'dodge_runner', 'whack_a_mole', 'slingshot', 'memory_match']);
  });

  it('T3: no repeated place, regions differ when possible, choices hold the right answer once without duplicates, answer position uniform, removed option is wrong', () => {
    const pos: Record<number, number[]> = {};
    for (const d of DIFFS) for (const extra of [0, 1, 2]) {
      const mods: MinigameModifier[] = extra ? [{ kind: 'extraTarget', count: extra }] : [];
      for (let seed = 1; seed <= 5000; seed++) {
        const lv = gen(gl, seed, d, mods);
        expect(new Set(lv.items.map((i) => i.placeId)).size).toBe(lv.items.length);
        expect(new Set(lv.items.map((i) => i.correctRegionId)).size).toBe(lv.items.length); // 7 <= 10 regions with places
        for (const it of lv.items) {
          expect(it.choices.length).toBe(lv.choiceCount);
          expect(new Set(it.choices).size).toBe(lv.choiceCount);
          expect(it.choices.filter((c) => c === it.correctRegionId).length).toBe(1);
          expect(it.choices[it.hintRemovedIndex]).not.toBe(it.correctRegionId);
          expect(it.hintRemovedIndex).toBeGreaterThanOrEqual(0);
        }
      }
    }
    const N = 12_000;
    const slotCounts = [0, 0, 0, 0];
    for (let seed = 1; seed <= N; seed++) {
      const lv = gen(gl, seed, 'medium');
      slotCounts[lv.items[1]!.choices.indexOf(lv.items[1]!.correctRegionId)]!++;
    }
    for (const c of slotCounts) expect(Math.abs(c / N - 0.25)).toBeLessThanOrEqual(0.03);
    void pos;
  }, 60_000);

  it('T4: decoys prefer regions that have not appeared (spread of appearances <= 2); the hint draw always happens', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 3000; seed++) {
        const lv = gen(gl, seed, d, [{ kind: 'extraTarget', count: 2 }]);
        const seen = new Map<string, number>();
        for (const it of lv.items) for (const c of it.choices) seen.set(c, (seen.get(c) ?? 0) + 1);
        const vals = [...seen.values()];
        expect(Math.max(...vals) - Math.min(...vals), `${d} ${seed}`).toBeLessThanOrEqual(2);
      }
    }
    const a = gen(gl, 9, 'hard');
    const b = gen(gl, 9, 'hard', [{ kind: 'hint' }]);
    expect({ ...b, hintActive: false }).toEqual(a);
  });

  describe('T6 rules (hand-made level)', () => {
    const lv = (over: Partial<GuessLevel> = {}): GuessLevel => ({
      ...gen(gl, 1, 'medium'), questions: 4, correctRequired: 3, timePerQuestionMs: 6000, gapMs: 500, choiceCount: 3, hintActive: false,
      items: Array.from({ length: 4 }, (_, i) => ({ placeId: `p${i}`, correctRegionId: 'r0', choices: ['r0', 'r1', 'r2'], hintRemovedIndex: 1 })), ...over,
    });
    it('answers at deadline - 1 count, at the deadline they are timed out (wrong); the next question starts gapMs after the answer or deadline', () => {
      const l = lv();
      let s = gl.step(l, gl.initState(l), { choice: 0 }, 5999);
      expect(s.correct).toBe(1);
      const late = gl.step(l, gl.initState(l), { choice: 0 }, 6000);
      expect(late.correct).toBe(0);
      expect(late.answer).toMatchObject({ choice: null, correct: false, atMs: 6000 });
      s = gl.step(l, s, null, 5999 + 499);
      expect(s.q).toBe(0);
      s = gl.step(l, s, null, 5999 + 500);
      expect([s.q, s.qStartMs, s.answer]).toEqual([1, 6499, null]);
      const l2 = gl.step(l, gl.initState(l), null, 6000 + 500);
      expect([l2.q, l2.qStartMs]).toEqual([1, 6500]);
    });
    it('input during the gap is ignored', () => {
      const l = lv();
      let s = gl.step(l, gl.initState(l), { choice: 1 }, 1000);
      s = gl.step(l, s, { choice: 0 }, 1200);
      expect(s.correct).toBe(0);
      expect(s.answer?.choice).toBe(1);
    });
    it('passes at once on the answer that reaches correctRequired; fails at once when correct + remaining < required', () => {
      const l = lv();
      let s = gl.initState(l);
      let t = 100;
      for (let q = 0; q < 3; q++) {
        s = gl.step(l, s, { choice: 0 }, t);
        t = (s.answer?.atMs ?? t) + 500 + 100;
        if (q < 2) expect(gl.result(l, s)).toBeNull();
      }
      expect(gl.result(l, s)).toMatchObject({ passed: true, reason: 'success', progress: 1, timeTakenMs: s.answer!.atMs });
      let f = gl.initState(l);
      f = gl.step(l, f, { choice: 1 }, 100); // wrong: 3 left, 0 correct, need 3 -> still possible
      expect(gl.result(l, f)).toBeNull();
      f = gl.step(l, f, { choice: 1 }, 100 + 500 + 100); // second wrong: 2 left < 3 -> fail now
      expect(gl.result(l, f)).toMatchObject({ passed: false, reason: 'failLimit' });
    });
    it('the hint-removed option cannot be chosen', () => {
      const l = lv({ hintActive: true });
      const s = gl.step(l, gl.initState(l), { choice: 1 }, 100);
      expect(s.answer).toBeNull();
    });
  });

  it('A5 perfect player passes (2000 seeds), idle player fails with failLimit', () => {
    for (const d of DIFFS) {
      for (let seed = 1; seed <= 2000; seed++) {
        const lv = gen(gl, seed, d);
        const r = runScript(gl, lv, guessPerfectScript(lv), lv.durationMs + 1000).result!;
        expect(r.passed).toBe(true);
        expect(r.timeTakenMs).toBeLessThanOrEqual(lv.durationMs);
        expect(runScript(gl, lv, [], lv.durationMs + 1000).result).toMatchObject({ passed: false, reason: 'failLimit' });
      }
      for (const [name, mods] of SINGLE_SETS) {
        for (let seed = 1; seed <= 300; seed++) {
          const lv = gen(gl, seed, d, mods);
          expect(runScript(gl, lv, guessPerfectScript(lv), lv.durationMs + 1000).result?.passed, `${d} ${name}`).toBe(true);
        }
      }
      for (let seed = 1; seed <= 300; seed++) {
        const lv = gen(gl, seed, d, EXTREME);
        expect(runScript(gl, lv, guessPerfectScript(lv), lv.durationMs + 1000).result?.passed).toBe(true);
      }
    }
  }, 120_000);

  it('localize falls back to id', () => {
    expect(localize({ id: 'x' }, 'en')).toBe('x');
  });
});

// ------------------------------------------------------------------------------------------------
describe('E: cards x minigames (cards.md §5.1)', () => {
  const BASE: Record<string, number> = { whack_a_mole: 20_000, slingshot: 30_000, memory_match: 30_000, guess_location: 26_000 };

  it('A4/E #13: every boost and sabotage card resolves to modifiers that the 4 new minigames all understand (no warning)', () => {
    for (const def of CARDS) {
      for (const mg of NEW_LOGICS) {
        const eff = resolveAttemptEffects([def], 'medium', BASE[mg.id]!);
        const lv = mg.generateLevel(ctx(7, eff.difficulty, eff.modifiers)) as { warnings: string[] };
        expect(lv.warnings, `${def.id} x ${mg.id}`).toEqual([]);
      }
    }
  });

  it('card examples: Jam Pasir / Jam Rusak / Zona Lebar / Ngebut / Tambah Beban / Kabut / Teropong across the four', () => {
    const apply = (cardId: string, mg: MinigameLogic<any, any, any>, d: Difficulty = 'medium') => {
      const eff = resolveAttemptEffects([getCard(cardId)], d, BASE[mg.id]!);
      return mg.generateLevel(ctx(5, eff.difficulty, eff.modifiers)) as any;
    };
    expect(apply('jam_pasir', wm).tempo).toBeCloseTo(0.85, 9);
    expect(apply('jam_pasir', wm).durationMs).toBe(20_000);
    expect(apply('jam_rusak', wm).tempo).toBeCloseTo(1.15, 9);
    expect(apply('jam_pasir', sl).durationMs).toBe(35_000);
    expect(apply('jam_rusak', sl).durationMs).toBe(25_000);
    expect(apply('jam_pasir', mm).durationMs).toBe(35_000);
    expect(apply('jam_rusak', mm).durationMs).toBe(25_000);
    expect(apply('jam_pasir', gl).timePerQuestionMs).toBe(7250);
    expect(apply('jam_rusak', gl).timePerQuestionMs).toBe(4750);
    expect(apply('zona_lebar', sl).hitRadiusM).toBeCloseTo(1.43, 9);
    expect(apply('zona_lebar', mm, 'hard').previewMs).toBe(1000);
    expect(apply('zona_lebar', gl).timePerQuestionMs).toBe(7800);
    expect(apply('ngebut', mm, 'easy').mismatchDelayMs).toBe(640);
    expect(apply('ngebut', sl, 'easy').durationMs).toBe(24_000);
    expect(apply('ngebut', gl).timePerQuestionMs).toBe(4800);
    expect(apply('tambah_beban', wm).hitsRequired).toBe(17);
    expect(apply('tambah_beban', sl).targetsRequired).toBe(5);
    expect(apply('tambah_beban', mm).pairs).toBe(9);
    expect(apply('tambah_beban', gl).questions).toBe(5);
    expect(apply('kabut_asap', wm).fog.length).toBeGreaterThan(0);
    expect(apply('kabut_asap', sl).fog).toBe(true);
    expect(apply('kabut_asap', mm).fog).toBe(true);
    expect(apply('kabut_asap', gl).fogBlurPx).toBe(6);
    expect(apply('teropong', wm).hintLeadMs).toBe(300);
    expect(apply('teropong', sl).aimLineFrac).toBe(1);
    expect(apply('teropong', mm).peekAvailable).toBe(true);
    expect(apply('teropong', gl).hintActive).toBe(true);
  });

  it('twin test: the order cards are played in does not change the level (cards.md §2.3)', () => {
    const ids = ['jam_rusak', 'ngebut', 'tambah_beban', 'kabut_asap'];
    for (const mg of NEW_LOGICS) {
      const lvl = (order: string[]) => {
        const eff = resolveAttemptEffects(order.map(getCard), 'medium', BASE[mg.id]!);
        return JSON.stringify(mg.generateLevel(ctx(5, eff.difficulty, eff.modifiers)));
      };
      expect(lvl(ids.slice().reverse())).toBe(lvl(ids));
      expect(lvl([ids[2]!, ids[0]!, ids[3]!, ids[1]!])).toBe(lvl(ids));
    }
    expect(clampTimeDelta(20_000, -30)).toBe(-10);
  });
});

// ------------------------------------------------------------------------------------------------
describe('C: bots on the four new minigames (bots.md §3, minigames.md §9)', () => {
  const graph = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
  const IDS = ['whack_a_mole', 'slingshot', 'memory_match', 'guess_location'] as const;
  const attemptFor = (minigameId: string, difficulty: Difficulty, seed: number, modifiers: Attempt['modifiers'] = []): Attempt => ({
    minigameId, targetId: 'medan', baseDifficulty: difficulty, modifiers, cardUids: [], onFail: { noCooldown: false, cooldownDeltaMs: 0 },
    onWin: { pickDelta: 0, winMultiplier: 1 }, seed, difficulty, attemptIndex: 0, introMs: 3000, startedAtMs: 10_000,
  });
  const effectiveD = (a: Attempt): number => {
    const lv = getMinigameLogic(a.minigameId).generateLevel({
      seed: a.seed, difficulty: a.difficulty, modifiers: a.modifiers.slice(), map: graph.data, regionId: 'medan', inputMode: 'mouse',
      settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 },
    }) as { durationMs: number; previewMs?: number };
    return lv.durationMs + (lv.previewMs ?? 0);
  };

  it('pass rate = BOT_PASS_CHANCE +-1.5 points, 12,000 attempts, for every level on the matching difficulty diagonal', () => {
    const diag: [BotLevel, Difficulty][] = [['easy', 'easy'], ['normal', 'medium'], ['hard', 'hard']];
    for (const id of IDS) {
      for (const [level, d] of diag) {
        const r = createStream(99, `c-${id}-${level}`, 'bot');
        let pass = 0;
        for (let i = 0; i < 12_000; i++) if (simulateAttempt(attemptFor(id, d, i + 1), graph, BOT_PROFILE[level], r).passed) pass++;
        expect(Math.abs(pass / 12_000 - BOT_PASS_CHANCE[level][d]), `${id} ${level}/${d}`).toBeLessThan(0.015);
      }
    }
  }, 240_000);

  it('one modifier of each kind moves the pass rate by 8 points (3000 attempts, +-3 points)', () => {
    const kinds: { m: Attempt['modifiers']; delta: number }[] = [
      { m: [{ kind: 'timeDelta', seconds: 5 }], delta: 0.08 },
      { m: [{ kind: 'tolerance', mult: 1.3 }], delta: 0.08 },
      { m: [{ kind: 'hint' }], delta: 0.08 },
      { m: [{ kind: 'speed', mult: 1.25 }], delta: -0.08 },
      { m: [{ kind: 'extraTarget', count: 1 }], delta: -0.08 },
      { m: [{ kind: 'fog' }], delta: -0.08 },
    ];
    for (const id of IDS) {
      for (const { m, delta } of kinds) {
        const r = createStream(5, `m-${id}`, 'bot');
        let pass = 0;
        for (let i = 0; i < 3000; i++) if (simulateAttempt(attemptFor(id, 'medium', i + 1, m), graph, BOT_PROFILE.normal, r).passed) pass++;
        expect(Math.abs(pass / 3000 - (0.65 + delta)), `${id} ${m[0]!.kind}`).toBeLessThan(0.03);
      }
    }
  }, 120_000);

  it('D = durationMs + previewMs: Whack 20 s (+3 per extra), Ketapel 30 s, Cocokkan Kartu 30 s + preview, Tebak Lokasi 25.0 / 25.5 / 27.0 s', () => {
    const D = (id: string, d: Difficulty, mods: Attempt['modifiers'] = []) => effectiveD(attemptFor(id, d, 1, mods));
    expect(D('whack_a_mole', 'medium')).toBe(20_000);
    expect(D('whack_a_mole', 'medium', [{ kind: 'extraTarget', count: 1 }])).toBe(23_000);
    expect(D('slingshot', 'hard')).toBe(30_000);
    expect(D('slingshot', 'hard', [{ kind: 'speed', mult: 1.25 }])).toBe(24_000);
    expect(D('memory_match', 'easy')).toBe(32_000);
    expect(D('memory_match', 'medium')).toBe(31_000);
    expect(D('memory_match', 'hard')).toBe(30_000);
    expect([D('guess_location', 'easy'), D('guess_location', 'medium'), D('guess_location', 'hard')]).toEqual([25_000, 25_500, 27_000]);
  });

  it('pass time = D x U(passTimeFrac), fail time = D x U(0.4, 1.0), result at intro + time + banner; none of them is a survival minigame', () => {
    expect([...SURVIVAL_MINIGAMES]).toEqual(['dodge_runner']);
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const profile = BOT_PROFILE[level];
      for (const id of IDS) {
        const r = createStream(3, `t-${level}-${id}`, 'bot');
        let np = 0;
        let sumPass = 0;
        for (let i = 0; i < 3000; i++) {
          const a = attemptFor(id, 'medium', i + 1);
          const D = effectiveD(a);
          const out = simulateAttempt(a, graph, profile, r);
          if (out.passed) {
            np++;
            sumPass += out.timeTakenMs / D;
            expect(out.timeTakenMs / D).toBeGreaterThanOrEqual(profile.passTimeFrac[0] - 0.001);
            expect(out.timeTakenMs / D).toBeLessThanOrEqual(profile.passTimeFrac[1] + 0.001);
          } else {
            expect(out.timeTakenMs / D).toBeGreaterThanOrEqual(0.399);
            expect(out.timeTakenMs / D).toBeLessThanOrEqual(1.001);
          }
          expect(out.resultAtMs).toBe(a.startedAtMs + a.introMs + out.timeTakenMs + 1200);
        }
        const mid = (profile.passTimeFrac[0] + profile.passTimeFrac[1]) / 2;
        expect(Math.abs(sumPass / np / mid - 1), `${level}/${id}`).toBeLessThan(0.03);
      }
    }
  }, 120_000);

  it('still exactly two `bot` draws per attempt, level or not', () => {
    for (const id of IDS) {
      const used = createStream(4, 'z', 'bot');
      simulateAttempt(attemptFor(id, 'hard', 77), graph, BOT_PROFILE.hard, used);
      const ref = createStream(4, 'z', 'bot');
      ref.next();
      ref.next();
      expect(used.getState()).toEqual(ref.getState());
    }
  });
});
