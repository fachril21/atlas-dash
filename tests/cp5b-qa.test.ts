/**
 * CP5b QA (independent of tests/cp5b.test.ts). Adds, against minigames.md §10 A-F:
 *   S1  the sweeps the Engineer ran at reduced size, at the size §10 asks for (1000 seeds x modifier sets, 2000 seeds per single set)
 *   S2  pure-logic fuzz: random inputs at random times never break the invariants (A7), step never mutates its input
 *   S3  solvability: DR-15 under every modifier mix, Ketapel under every modifier mix, `requires` on synthetic maps
 *   S4  card x minigame matrix: direction (boost eases, sabotage hardens) by structure AND by a noisy-player model
 *   S5  pool and pick: distribution, no-repeat through the real reducer, synthetic pools
 *   S6  Ketapel aiming precision (measurement) and the placement rule (interpretation 1, 2)
 *   S7  zone / replay fuzz with the 7-minigame pool, smart bots and a human seat that plays the REAL minigame logic
 * Numbers that go into docs/qa/cp5b-report.md are printed with a "[CP5b-QA]" prefix.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  aimFromDrag,
  applyAction,
  BOT_PROFILE,
  CARDS,
  createInitialState,
  GameSession,
  getCard,
  groundTimeSec,
  guessLocationLogic as gl,
  guessPerfectScript,
  HUMAN_PROFILE,
  loadMap,
  memoryMatchLogic as mm,
  memoryPerfectScript,
  MINIGAME_LOGIC,
  minigamePool,
  outgoing,
  pickMinigame,
  replay,
  resolveAttemptEffects,
  Rng,
  runScript,
  shotPosition,
  simulateShot,
  sabotageSlotsUsed,
  SLING_MIN_SPACING_M,
  SLING_YAW_MAX_DEG,
  slingshotLogic as sl,
  slingshotPerfectScript,
  SmartBotController,
  streamSeed,
  validateMap,
  whackAMoleLogic as wm,
  whackPerfectScript,
  type BotLevel,
  type Difficulty,
  type GameAction,
  type GameState,
  type GuessInput,
  type GuessLevel,
  type MapData,
  type MapGraph,
  type MemoryLevel,
  type MinigameContext,
  type MinigameLogic,
  type MinigameModifier,
  type PlayerController,
  type SimSeat,
  type SlingAim,
  type SlingLevel,
  type TimedInput,
  type WhackInput,
  type WhackLevel,
} from '../src/logic';
import { indonesiaData } from './helpers';

vi.setConfig({ testTimeout: 600_000 });

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];
const DATA = indonesiaData();
const ctx = (seed: number, difficulty: Difficulty = 'medium', modifiers: MinigameModifier[] = [], map: MapData = DATA): MinigameContext => ({
  seed, difficulty, modifiers, map, regionId: 'medan', inputMode: 'touch',
  settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 },
});
const gen = <L>(mg: MinigameLogic<L, any, any>, seed: number, d: Difficulty = 'medium', mods: MinigameModifier[] = []): L => mg.generateLevel(ctx(seed, d, mods));
const say = (s: string): void => console.log(`[CP5b-QA] ${s}`);

const NEW: readonly MinigameLogic<any, any, any>[] = [wm, sl, mm, gl];
const SINGLE: [string, MinigameModifier[]][] = [
  ['none', []],
  ['Jam Pasir +5', [{ kind: 'timeDelta', seconds: 5 }]],
  ['2x Jam Pasir +10', [{ kind: 'timeDelta', seconds: 10 }]],
  ['Jam Rusak -5', [{ kind: 'timeDelta', seconds: -5 }]],
  ['2x Jam Rusak -10', [{ kind: 'timeDelta', seconds: -10 }]],
  ['Zona Lebar x1.3', [{ kind: 'tolerance', mult: 1.3 }]],
  ['Ngebut x1.25', [{ kind: 'speed', mult: 1.25 }]],
  ['Tambah Beban +1', [{ kind: 'extraTarget', count: 1 }]],
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

/** Modifier mixes a player can actually meet: every card has maxStacks 1 except Jam Pasir / Jam Rusak (2), so tolerance is 1.3, speed 1.25, extraTarget <= 1. */
function reachableMods(rng: Rng): MinigameModifier[] {
  const out: MinigameModifier[] = [];
  if (rng.chance(0.5)) out.push({ kind: 'timeDelta', seconds: rng.pick([-10, -5, 5, 10]) });
  if (rng.chance(0.4)) out.push({ kind: 'tolerance', mult: 1.3 });
  if (rng.chance(0.4)) out.push({ kind: 'speed', mult: 1.25 });
  if (rng.chance(0.4)) out.push({ kind: 'extraTarget', count: 1 });
  if (rng.chance(0.4)) out.push({ kind: 'fog' });
  if (rng.chance(0.4)) out.push({ kind: 'hint' });
  return out;
}

const SCRIPT: Record<string, (lv: any) => TimedInput<any>[]> = {
  whack_a_mole: whackPerfectScript,
  slingshot: slingshotPerfectScript,
  memory_match: memoryPerfectScript,
  guess_location: guessPerfectScript,
};
const endOf = (id: string, lv: any): number => (id === 'memory_match' ? lv.previewMs + lv.durationMs + 1000 : id === 'slingshot' ? lv.durationMs + 4000 : lv.durationMs + 1000);

// ============================================================================================
// S1. Sweeps at the size §10 asks for
// ============================================================================================
describe('S1 A2/A5 at full size', () => {
  it('A2: 1000 seeds x 3 difficulties x {empty, 6 singles, all six} + 20 random sets: same ctx twice deepEqual, reversed modifier order identical', () => {
    for (const mg of NEW) {
      const rng = new Rng(4242);
      const sets: MinigameModifier[][] = [[], [{ kind: 'timeDelta', seconds: 5 }], [{ kind: 'tolerance', mult: 1.3 }], [{ kind: 'speed', mult: 1.25 }], [{ kind: 'extraTarget', count: 1 }], [{ kind: 'fog' }], [{ kind: 'hint' }],
        [{ kind: 'timeDelta', seconds: -5 }, { kind: 'tolerance', mult: 1.3 }, { kind: 'speed', mult: 1.25 }, { kind: 'extraTarget', count: 1 }, { kind: 'fog' }, { kind: 'hint' }]];
      let n = 0;
      for (let seed = 1; seed <= 1000; seed++) {
        for (const d of DIFFS) {
          for (const mods of [...sets, ...Array.from({ length: 20 }, () => randomMods(rng))]) {
            const a = mg.generateLevel(ctx(seed, d, mods));
            expect(mg.generateLevel(ctx(seed, d, mods)), `${mg.id} ${d} ${seed}`).toEqual(a);
            if (mods.length > 1) expect(mg.generateLevel(ctx(seed, d, mods.slice().reverse())), `${mg.id} ${d} ${seed} reversed`).toEqual(a);
            n++;
          }
        }
      }
      say(`A2 ${mg.id}: ${n} level pairs identical`);
    }
  });

  for (const mg of NEW) {
    it(`A5 ${mg.id}: perfect player passes 100% over 2000 seeds x 3 difficulties x each single modifier set; extreme combo >= 95% (failures listed)`, () => {
      const script = SCRIPT[mg.id] as (lv: any) => TimedInput<any>[];
      const failures: string[] = [];
      const extreme: Record<string, number> = {};
      for (const d of DIFFS) {
        for (const [name, mods] of SINGLE) {
          for (let seed = 1; seed <= 2000; seed++) {
            const lv: any = gen(mg, seed, d, mods);
            const r = runScript(mg, lv, script(lv), endOf(mg.id, lv)).result;
            if (!r?.passed && failures.length < 20) failures.push(`${d}/${name}/seed ${seed}: ${r?.reason}`);
          }
        }
        let ok = 0;
        for (let seed = 1; seed <= 2000; seed++) {
          const lv: any = gen(mg, seed, d, EXTREME);
          if (runScript(mg, lv, script(lv), endOf(mg.id, lv)).result?.passed) ok++;
        }
        extreme[d] = ok / 2000;
      }
      say(`A5 ${mg.id}: single-set failures ${failures.length}; extreme combo pass (perfect player) ${JSON.stringify(extreme)}`);
      expect(failures).toEqual([]);
      for (const d of DIFFS) expect(extreme[d], `${mg.id} extreme ${d}`).toBeGreaterThanOrEqual(0.95);
    });
  }
});

// ============================================================================================
// S2. Pure logic fuzz: random input at random times
// ============================================================================================
describe('S2 random-input fuzz of the four step functions', () => {
  const randomInput = (id: string, lv: any, rng: Rng): unknown => {
    switch (id) {
      case 'whack_a_mole': return { hole: rng.int(-1, lv.gridCols * lv.gridRows) };
      case 'memory_match': return rng.chance(0.08) ? { peek: true } : { card: rng.int(-1, lv.cards.length) };
      case 'guess_location': return { choice: rng.int(-1, 4) };
      default: return { yawDeg: rng.range(-40, 40), power: rng.range(-0.2, 1.3) };
    }
  };
  for (const mg of NEW) {
    it(`${mg.id}: 600 seeds x 3 difficulties x random modifiers: time never goes back, a finished run never changes, step does not mutate its input, progress/timeTaken stay in range, result appears by the end`, () => {
      const rng = new Rng(91);
      let finished = 0;
      let passed = 0;
      for (let seed = 1; seed <= 600; seed++) {
        for (const d of DIFFS) {
          const lv: any = gen(mg, seed, d, randomMods(rng));
          let s: any = mg.initState(lv);
          const end = endOf(mg.id, lv);
          let t = 0;
          let lastProgress = 0;
          let done: ReturnType<typeof mg.result> = null;
          while (t <= end) {
            t += rng.int(1, 400);
            const input = rng.chance(0.5) ? randomInput(mg.id, lv, rng) : null;
            const before = JSON.stringify(s);
            const next = mg.step(lv, s, input, t);
            expect(JSON.stringify(s), `${mg.id} mutated its input state`).toBe(before);
            expect(next.tMs, 'time went back').toBeGreaterThanOrEqual(s.tMs);
            const r = mg.result(lv, next);
            if (done) expect(r, 'result changed after the run ended').toEqual(done);
            if (r) {
              done = r;
              expect(r.progress).toBeGreaterThanOrEqual(lastProgress - 1e-9);
              expect(r.progress).toBeGreaterThanOrEqual(0);
              expect(r.progress).toBeLessThanOrEqual(1);
              const cap = mg.id === 'slingshot' ? lv.durationMs + 3000 : mg.id === 'memory_match' ? lv.previewMs + lv.durationMs : lv.durationMs;
              expect(r.timeTakenMs, `${mg.id} ${d} ${seed} timeTaken`).toBeLessThanOrEqual(cap);
              expect(r.timeTakenMs).toBeGreaterThanOrEqual(0);
              expect(r.passed ? r.reason === 'success' : r.reason !== 'success').toBe(true);
            }
            s = next;
          }
          // Past the end with no flight left the run must be decided.
          s = mg.step(lv, s, null, end + 5000);
          const final = mg.result(lv, s);
          expect(final, `${mg.id} ${d} ${seed}: still running long after the end`).not.toBeNull();
          finished++;
          if (final?.passed) passed++;
          lastProgress = final?.progress ?? 0;
        }
      }
      say(`S2 ${mg.id}: ${finished} random-input runs, ${passed} passed by luck`);
    });
  }
});

// ============================================================================================
// S3. Solvability
// ============================================================================================
describe('S3 solvability (DR-15 and Ketapel), `requires` on synthetic maps', () => {
  it('DR-15 Whack: under 12 random modifier mixes x 3000 seeds x 3 difficulties the schedule equals the no-modifier one (except for extraTarget), T >= ceil(1.5 x hits), no warning, safety net never fires', () => {
    const rng = new Rng(8);
    let checked = 0;
    let minRatio = Infinity;
    for (let seed = 1; seed <= 3000; seed++) {
      for (const d of DIFFS) {
        const base = gen(wm, seed, d);
        for (let k = 0; k < 12; k++) {
          const mods = randomMods(rng);
          const lv = gen(wm, seed, d, mods);
          const hasExtra = mods.some((m) => m.kind === 'extraTarget');
          if (!hasExtra) {
            expect(lv.spawns.map((s) => [s.tMs, s.hole, s.kind]), `${d} ${seed} ${JSON.stringify(mods)}`).toEqual(base.spawns.map((s) => [s.tMs, s.hole, s.kind]));
            expect(lv.durationMs).toBe(base.durationMs);
            expect(lv.hitsRequired).toBe(base.hitsRequired);
          }
          const T = lv.spawns.filter((s) => s.kind === 'target').length;
          expect(T, `${d} ${seed} ${JSON.stringify(mods)}`).toBeGreaterThanOrEqual(Math.ceil(1.5 * lv.hitsRequired));
          expect(lv.warnings).toEqual([]);
          minRatio = Math.min(minRatio, T / lv.hitsRequired);
          checked++;
        }
      }
    }
    say(`DR-15 Whack: ${checked} levels with modifiers, min T/hitsRequired = ${minRatio.toFixed(3)} (floor 1.5)`);
  });

  it('Whack: how often a long-lived spawn is cut short by a later spawn in the same hole (Jam Pasir x2 + Zona Lebar, the longest lives)', () => {
    for (const d of DIFFS) {
      let cut = 0;
      let total = 0;
      for (let seed = 1; seed <= 500; seed++) {
        const lv = gen(wm, seed, d, [{ kind: 'timeDelta', seconds: 10 }, { kind: 'tolerance', mult: 1.3 }]);
        lv.spawns.forEach((s, i) => {
          total++;
          let natural = s.tMs + s.lifeMs + lv.graceMs;
          for (let j = i + 1; j < lv.spawns.length; j++) {
            const n = lv.spawns[j]!;
            if (n.tMs >= natural) break;
            if (n.hole === s.hole) { natural = -1; break; }
          }
          if (natural === -1) cut++;
        });
      }
      say(`Whack ${d}: with 2x Jam Pasir + Zona Lebar ${(100 * cut / total).toFixed(2)}% of spawns are replaced by a later spawn before their life ends`);
    }
  });

  it('Ketapel: under reachable modifier mixes (1500 seeds x 3 difficulties x 8 mixes) a static target is hit by its own ideal shot (>= 99%; the rest are blocked by another target that is still up), every moving target is hittable on a timed ideal shot; no warning; the perfect player passes whenever the clock allows', () => {
    const rng = new Rng(17);
    let staticBad = 0;
    let staticTotal = 0;
    let movingBad = 0;
    let movingBlocked = 0;
    let movingTotal = 0;
    const perfectFail: string[] = [];
    for (let seed = 1; seed <= 1500; seed++) {
      for (const d of DIFFS) {
        for (let k = 0; k < 8; k++) {
          const mods = reachableMods(rng);
          const lv = gen(sl, seed, d, mods);
          expect(lv.warnings).toEqual([]);
          lv.targets.forEach((tg, i) => {
            const aim: SlingAim = { yawDeg: tg.ideal.yawDeg, power: tg.ideal.power };
            if (i >= lv.movingCount) {
              staticTotal++;
              if (simulateShot(lv, aim, 0).hitIndex !== i) staticBad++;
            } else if (seed <= 250) {
              movingTotal++;
              let ok = false;
              let hitsAnything = false;
              for (let t = 0; t < 12_000 && !ok; t += 40) {
                const h = simulateShot(lv, aim, t).hitIndex;
                ok = h === i;
                if (h !== null) hitsAnything = true;
              }
              if (!ok) movingBlocked++; // its ideal shot always meets another target first (that one is shot first, see perfect-player result)
              if (!ok && !hitsAnything) movingBad++;
            }
          });
          const r = runScript(sl, lv, slingshotPerfectScript(lv), lv.durationMs + 4000).result;
          if (!r?.passed && perfectFail.length < 10) perfectFail.push(`${d} seed ${seed} ${JSON.stringify(mods)} -> ${r?.reason}, down ${(r?.progress ?? 0) * lv.targetsRequired}/${lv.targetsRequired}, duration ${lv.durationMs}`);
        }
      }
    }
    say(`Ketapel with modifiers: static ideal shot hits its target ${staticTotal - staticBad}/${staticTotal}; moving target hit by its own ideal shot at some release time ${movingTotal - movingBlocked}/${movingTotal} (the rest are blocked by another target, none is unreachable: ${movingBad}); perfect-player failures ${perfectFail.length}`);
    for (const f of perfectFail) say(`  perfect-player failure: ${f}`);
    expect(staticBad / staticTotal).toBeLessThanOrEqual(0.01);
    expect(movingBad).toBe(0);
    expect(perfectFail.length).toBe(0);
  });

  it('Ketapel: the ideal aim of every target survives a round trip through aimFromDrag at 3 screen sizes (a real drag can express it) and stays inside the yaw clamp and the power range', () => {
    for (const heightPx of [844, 720, 390]) {
      const maxDrag = 0.25 * heightPx;
      let worst = 0;
      for (let seed = 1; seed <= 400; seed++) {
        for (const d of DIFFS) {
          for (const tg of gen(sl, seed, d).targets) {
            const { yawDeg, power } = tg.ideal;
            expect(Math.abs(yawDeg)).toBeLessThanOrEqual(SLING_YAW_MAX_DEG);
            expect(power).toBeGreaterThanOrEqual(0.2);
            expect(power).toBeLessThanOrEqual(1);
            const len = power * maxDrag;
            const a = (-yawDeg * Math.PI) / 180; // atan2(dx, dy) = -yaw
            const back = aimFromDrag(len * Math.sin(a), len * Math.cos(a), maxDrag)!;
            worst = Math.max(worst, Math.abs(back.yawDeg - yawDeg), Math.abs(back.power - power) * 100);
          }
        }
      }
      expect(worst).toBeLessThan(1e-6);
    }
  });

  it('interpretation 4, independent check: Tebak Lokasi over 3000 seeds x 3 difficulties x extra 0/1/2: choices hold the right region once, no duplicate, distractors favour regions that have not appeared (spread <= 2), the removed option is a wrong one, answer position is even, hint never reshuffles', () => {
    const regionIds = DATA.regions.map((r) => r.id);
    const slot = new Map<string, number[]>();
    let worstSpread = 0;
    let n = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      for (const d of DIFFS) {
        for (const extra of [0, 1, 2]) {
          const mods: MinigameModifier[] = extra ? [{ kind: 'extraTarget', count: extra }] : [];
          const lv = gen(gl, seed, d, mods) as GuessLevel;
          const withHint = gen(gl, seed, d, [...mods, { kind: 'hint' }]) as GuessLevel;
          expect(withHint.items).toEqual(lv.items);
          const seen = new Map<string, number>(regionIds.map((id) => [id, 0]));
          lv.items.forEach((it, q) => {
            expect(it.choices.filter((c) => c === it.correctRegionId).length).toBe(1);
            expect(new Set(it.choices).size).toBe(it.choices.length);
            expect(it.choices.length).toBe(lv.choiceCount);
            expect(it.choices[it.hintRemovedIndex]).not.toBe(it.correctRegionId);
            for (const c of it.choices) seen.set(c, (seen.get(c) as number) + 1);
            const key = `${d}|${extra}|${q}`;
            const arr = slot.get(key) ?? new Array(it.choices.length).fill(0);
            arr[it.choices.indexOf(it.correctRegionId)]++;
            slot.set(key, arr);
          });
          const counts = [...seen.values()].filter((v) => v > 0);
          worstSpread = Math.max(worstSpread, Math.max(...counts) - Math.min(...counts));
          n++;
        }
      }
    }
    let worstSlot = 0;
    for (const [, arr] of slot) {
      const total = arr.reduce((a: number, b: number) => a + b, 0);
      for (const c of arr) worstSlot = Math.max(worstSlot, Math.abs((100 * c) / total - 100 / arr.length));
    }
    say(`Tebak Lokasi independent T3/T4: ${n} levels; largest appearance spread among regions that appeared ${worstSpread} (limit 2); worst deviation of the answer position from uniform ${worstSlot.toFixed(1)} points`);
    expect(worstSpread).toBeLessThanOrEqual(2);
    expect(worstSlot).toBeLessThan(3);
  });

  it('requires on synthetic maps: Whack (target/decoy missing or empty), Ketapel (< 2 skins, platforms optional), Dodge (< 3 obstacles), Memory (11 icons, groups of another length), Guess; the pool keeps registry order', () => {
    const mk = (f: (m: MapData) => void): MapData => {
      const m = indonesiaData();
      f(m);
      return m;
    };
    const pool = (m: MapData): string[] => minigamePool(m);
    expect(pool(DATA)).toEqual(['tap_timing', 'simon', 'dodge_runner', 'whack_a_mole', 'slingshot', 'memory_match', 'guess_location']);
    const themes = (m: MapData) => m.minigameThemes as Record<string, Record<string, unknown>>;
    expect(pool(mk((m) => { delete themes(m)['whack_a_mole']!['decoy']; }))).not.toContain('whack_a_mole');
    expect(pool(mk((m) => { delete themes(m)['whack_a_mole']!['target']; }))).not.toContain('whack_a_mole');
    expect(pool(mk((m) => { themes(m)['whack_a_mole']!['decoy'] = ''; }))).not.toContain('whack_a_mole');
    expect(pool(mk((m) => { delete themes(m)['whack_a_mole']; }))).not.toContain('whack_a_mole');
    expect(pool(mk((m) => { themes(m)['slingshot']!['targets'] = ['prop_kelapa']; }))).not.toContain('slingshot');
    expect(pool(mk((m) => { themes(m)['slingshot']!['targets'] = ['a', 'b']; delete themes(m)['slingshot']!['platforms']; }))).toContain('slingshot');
    expect(pool(mk((m) => { delete themes(m)['slingshot']; }))).not.toContain('slingshot');
    expect(pool(mk((m) => { themes(m)['dodge_runner']!['obstacles'] = ['a', 'b']; }))).not.toContain('dodge_runner');
    expect(pool(mk((m) => { themes(m)['memory_match']!['icons'] = (themes(m)['memory_match']!['icons'] as string[]).slice(0, 11); }))).not.toContain('memory_match');
    expect(pool(mk((m) => { themes(m)['memory_match']!['iconGroups'] = (themes(m)['memory_match']!['iconGroups'] as string[]).slice(0, 13); }))).not.toContain('memory_match');
    expect(pool(mk((m) => { delete themes(m)['memory_match']!['iconGroups']; }))).not.toContain('memory_match');
    expect(pool(mk((m) => { m.places = m.places.slice(0, 9); }))).not.toContain('guess_location');
    // all four themes gone: still a valid map with the three generic ones, in registry order
    const bare = mk((m) => { for (const k of ['whack_a_mole', 'slingshot', 'memory_match', 'dodge_runner']) delete themes(m)[k]; m.places = []; });
    expect(pool(bare)).toEqual(['tap_timing', 'simon']);
    expect(validateMap(bare, MINIGAME_LOGIC)).toEqual([]);
    // a map without a minigame that is always usable is rejected (tap_timing is the fallback)
    expect(validateMap(bare, MINIGAME_LOGIC.filter((m) => m.id !== 'tap_timing' && m.id !== 'simon')).length).toBeGreaterThan(0);
  });

  it('a minigame that is out of the pool is never drawn: 4000 draws on maps missing each theme, and the other minigames still come up about evenly', () => {
    const themes = (m: MapData) => m.minigameThemes as Record<string, Record<string, unknown>>;
    for (const drop of ['whack_a_mole', 'slingshot', 'memory_match']) {
      const m = indonesiaData();
      delete themes(m)[drop];
      const p = minigamePool(m);
      expect(p).not.toContain(drop);
      expect(p.length).toBe(6);
      let rng = new Rng(5).getState();
      let last: string | null = null;
      const count = new Map<string, number>();
      for (let i = 0; i < 4000; i++) {
        const r = pickMinigame(p, rng, last);
        rng = r.rng;
        expect(r.id).not.toBe(last);
        expect(p).toContain(r.id);
        count.set(r.id, (count.get(r.id) ?? 0) + 1);
        last = r.id;
      }
      for (const id of p) expect(Math.abs((count.get(id) ?? 0) / 4000 - 1 / 6), `${drop} ${id}`).toBeLessThan(0.02);
    }
  });
});

// ============================================================================================
// S4. Card x minigame matrix
// ============================================================================================
const modsOf = (ids: string[], base: Difficulty, baseMs: number) => resolveAttemptEffects(ids.map(getCard), base, baseMs);

/** "How hard is this level": larger = harder. Each is a named, document-derived knob; only comparisons between a card level and the plain level matter. */
const EASE: Record<string, Record<string, (lv: any) => number>> = {
  whack_a_mole: {
    tempo: (lv: WhackLevel) => lv.tempo,
    touchArea: (lv: WhackLevel) => (lv.wideTouch ? -1 : 0),
    visibility: (lv: WhackLevel) => lv.fog.length,
    warning: (lv: WhackLevel) => -lv.hintLeadMs,
  },
  slingshot: {
    secondsPerBullet: (lv: SlingLevel) => -lv.durationMs / lv.bullets,
    radius: (lv: SlingLevel) => -lv.hitRadiusM,
    required: (lv: SlingLevel) => lv.targetsRequired / lv.bullets,
    moving: (lv: SlingLevel) => lv.moveSpeedMps * lv.movingCount,
    wind: (lv: SlingLevel) => Math.abs(lv.windMps),
    aimLine: (lv: SlingLevel) => -lv.aimLineFrac,
    preview: (lv: SlingLevel) => (lv.hitPreview ? -1 : 0),
    fog: (lv: SlingLevel) => (lv.fog ? 1 : 0),
  },
  memory_match: {
    secondsPerPair: (lv: MemoryLevel) => -lv.durationMs / lv.pairs,
    preview: (lv: MemoryLevel) => -lv.previewMs,
    pairs: (lv: MemoryLevel) => lv.pairs,
    peek: (lv: MemoryLevel) => (lv.peekAvailable ? -1 : 0),
    fog: (lv: MemoryLevel) => (lv.fog ? 1 : 0),
    // NOT a monotone "ease": a longer mismatch window shows the wrong pair for longer (information) but a quick player skips it by peek-ahead.
  },
  guess_location: {
    time: (lv: GuessLevel) => -lv.timePerQuestionMs,
    required: (lv: GuessLevel) => lv.correctRequired / lv.questions,
    questions: (lv: GuessLevel) => lv.questions,
    options: (lv: GuessLevel) => (lv.hintActive ? lv.choiceCount - 1 : lv.choiceCount),
    fog: (lv: GuessLevel) => lv.fogBlurPx,
  },
};

describe('S4 card x minigame matrix', () => {
  const cardMods = (id: string, d: Difficulty, mg: MinigameLogic<any, any, any>) => modsOf([id], d, mg.baseDurationMs);

  it('every boost and sabotage card, on every difficulty, resolves with no warning on the 4 new minigames, and the ones that carry a modifier change the level (nothing is ignored)', () => {
    let rows = 0;
    for (const mg of NEW) {
      for (const d of DIFFS) {
        for (const card of CARDS) {
          const eff = cardMods(card.id, d, mg);
          const plain = JSON.stringify(gen(mg, 321, d));
          const lv: any = mg.generateLevel(ctx(321, eff.difficulty, eff.modifiers));
          expect(lv.warnings, `${mg.id} ${card.id}`).toEqual([]);
          if (eff.modifiers.length > 0 && eff.difficulty === d) {
            // a modifier card must visibly change the level (fixed seed, deep compare)
            expect(JSON.stringify(lv), `${mg.id}/${d}/${card.id} left the level unchanged`).not.toBe(plain);
          }
          rows++;
        }
      }
    }
    say(`matrix: ${rows} card x minigame x difficulty cells resolved, none warned, every modifier card changed its level`);
  });

  it('boost never makes a level harder, sabotage never makes it easier: on every named knob of every minigame (2 seeds per difficulty)', () => {
    const offenders: string[] = [];
    const table: string[] = [];
    for (const mg of NEW) {
      const knobs = EASE[mg.id] as Record<string, (lv: any) => number>;
      for (const d of DIFFS) {
        for (const seed of [11, 12]) {
          const plain: any = gen(mg, seed, d);
          for (const card of CARDS) {
            const eff = cardMods(card.id, d, mg);
            if (eff.modifiers.length === 0) continue;
            const lv: any = mg.generateLevel(ctx(seed, eff.difficulty, eff.modifiers));
            for (const [name, f] of Object.entries(knobs)) {
              const delta = f(lv) - f(plain);
              // delta > 0 = harder. Boosts must not raise it, sabotage must not lower it.
              if (card.type === 'boost' && delta > 1e-9) offenders.push(`${mg.id}/${d}/${card.id}: boost made "${name}" harder by ${delta.toFixed(3)}`);
              if (card.type === 'sabotage' && delta < -1e-9) offenders.push(`${mg.id}/${d}/${card.id}: sabotage made "${name}" easier by ${(-delta).toFixed(3)}`);
              if (seed === 11 && Math.abs(delta) > 1e-9 && d === 'medium') table.push(`${mg.id} ${card.id} ${name}: ${delta > 0 ? 'harder' : 'easier'}`);
            }
          }
        }
      }
    }
    say(`matrix directions (medium): ${table.join(' | ')}`);
    expect(offenders).toEqual([]);
  });

  /** Share of the target spawns that must be hit, and hits per second: how demanding Whack is. */
  const whackLoad = (lv: WhackLevel) => ({
    ratio: lv.hitsRequired / lv.spawns.filter((x) => x.kind === 'target').length,
    perSecond: lv.hitsRequired / (lv.durationMs / 1000),
  });

  it('QA-CP5b-02 evidence: Tambah Beban on Whack asks for a LOWER share of the target spawns on medium and hard (60 -> 58.6%, 63 -> 60%) and a lower hit rate per second', () => {
    const rows: string[] = [];
    for (const d of DIFFS) {
      const a = whackLoad(gen(wm, 5, d));
      const b = whackLoad(gen(wm, 5, d, [{ kind: 'extraTarget', count: 1 }]));
      rows.push(`${d}: share ${(100 * a.ratio).toFixed(1)}% -> ${(100 * b.ratio).toFixed(1)}%, hits/s ${a.perSecond.toFixed(3)} -> ${b.perSecond.toFixed(3)}`);
    }
    say(`Whack Tambah Beban load: ${rows.join(' | ')}`);
  });

  // Desired behaviour (a sabotage must not ask for less). It fails today (QA-CP5b-02), so `fails` keeps the suite green and turns red when the numbers are fixed.
  it.fails('QA-CP5b-02: Tambah Beban never lowers the required share of target spawns or the required hits per second on any difficulty (Whack)', () => {
    for (const d of DIFFS) {
      const a = whackLoad(gen(wm, 5, d));
      const b = whackLoad(gen(wm, 5, d, [{ kind: 'extraTarget', count: 1 }]));
      expect(b.ratio, `${d} share`).toBeGreaterThanOrEqual(a.ratio);
      expect(b.perSecond, `${d} per second`).toBeGreaterThanOrEqual(a.perSecond);
    }
  });

  it('stacking and cancelling: Jam Pasir + Jam Rusak = no timeDelta (level equals the plain one); 2x Jam Rusak + Ngebut hits the clamps and stays solvable; Ngebut + Ngebut (not allowed by maxStacks) is not reachable', () => {
    for (const mg of NEW) {
      for (const d of DIFFS) {
        const eff = modsOf(['jam_pasir', 'jam_rusak'], d, mg.baseDurationMs);
        expect(eff.modifiers).toEqual([]);
        expect(JSON.stringify(mg.generateLevel(ctx(5, eff.difficulty, eff.modifiers)))).toBe(JSON.stringify(gen(mg, 5, d)));
      }
    }
    expect(getCard('ngebut').maxStacks).toBe(1);
    expect(getCard('jam_rusak').maxStacks).toBe(2);
    expect(getCard('jam_pasir').maxStacks).toBe(2);
    // M clamp on Whack: 2x Jam Rusak + Ngebut = 1.3 x 1.25 -> 1.5 (clamped)
    const lv = gen(wm, 1, 'medium', [{ kind: 'timeDelta', seconds: -10 }, { kind: 'speed', mult: 1.25 }]);
    expect(lv.tempo).toBe(1.5);
  });

  // ---------------------------------------------------------------------------------------
  // noisy-player models: do the modifiers move a human-like pass rate the right way?
  // ---------------------------------------------------------------------------------------
  const gauss = (rng: Rng): number => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());

  function whackPlayer(lv: WhackLevel, rng: Rng): TimedInput<WhackInput>[] {
    const out: TimedInput<WhackInput>[] = [];
    for (const s of lv.spawns) {
      const r = Math.max(200, 650 + 170 * gauss(rng));
      if (s.kind === 'target' && rng.chance(0.96)) out.push({ tMs: s.tMs + r, input: { hole: s.hole } });
      else if (s.kind === 'decoy' && rng.chance(0.1)) out.push({ tMs: s.tMs + r, input: { hole: s.hole } });
    }
    return out.sort((a, b) => a.tMs - b.tMs);
  }

  const KNOW = { easy: 0.9, medium: 0.72, hard: 0.5 } as const;
  function guessPlayer(lv: GuessLevel, rng: Rng, d: Difficulty): TimedInput<GuessInput>[] {
    const out: TimedInput<GuessInput>[] = [];
    let qStart = 0;
    for (let q = 0; q < lv.questions; q++) {
      const it = lv.items[q]!;
      const think = Math.max(900, 3800 + 1300 * gauss(rng));
      const correctIdx = it.choices.indexOf(it.correctRegionId);
      if (think >= lv.timePerQuestionMs) { qStart += lv.timePerQuestionMs + lv.gapMs; continue; }
      let choice = correctIdx;
      if (!rng.chance(KNOW[d])) {
        const options = it.choices.map((_, i) => i).filter((i) => !(lv.hintActive && i === it.hintRemovedIndex));
        choice = options[rng.int(0, options.length - 1)] as number;
      }
      out.push({ tMs: qStart + think, input: { choice } });
      qStart += think + lv.gapMs;
    }
    return out;
  }

  /**
   * Casual memory player, closed loop on the REAL step function: it reads which cards are open after
   * every tap. A tap on a card that is still face up (the wrong pair waiting to close) is ignored by the
   * rules, the player notices and taps again one tap later. Returns the outcome and how many taps were ignored.
   */
  function memoryPlay(lv: MemoryLevel, rng: Rng): { passed: boolean; ignored: number; mismatches: number; taps: number; finishMs: number } {
    const n = lv.cards.length;
    let st = mm.initState(lv);
    const known = new Set<number>();
    const pPrev = lv.previewMs > 0 ? 1 - Math.exp(-lv.previewMs / (350 * n)) : 0;
    for (let i = 0; i < n; i++) if (rng.chance(pPrev)) known.add(i);
    let t = lv.previewMs + 500;
    const endMs = lv.previewMs + lv.durationMs + 1500;
    let ignored = 0;
    let taps = 0;
    let peeked = false;
    const tap = (c: number): void => {
      for (let tries = 0; tries < 4 && !mm.result(lv, st); tries++) {
        taps++;
        const wasOpen = st.open.includes(c) && !(st.closing && t >= st.closing.closeAtMs);
        st = mm.step(lv, st, { card: c }, t);
        t += Math.max(350, 860 + 170 * gauss(rng));
        if (!wasOpen && (st.open.includes(c) || st.matched.includes(c))) return;
        ignored++;
      }
    };
    const unmatched = (): number[] => [...Array(n).keys()].filter((i) => !st.matched.includes(i));
    let guard = 0;
    while (!mm.result(lv, st) && t < endMs && guard++ < 500) {
      for (const k of [...known]) if (rng.chance(0.05)) known.delete(k);
      const um = unmatched();
      const pairA = [...known].filter((a) => um.includes(a)).find((a) => [...known].some((b) => b !== a && um.includes(b) && lv.cards[a] === lv.cards[b]));
      if (pairA !== undefined) {
        const pairB = [...known].find((b) => b !== pairA && um.includes(b) && lv.cards[b] === lv.cards[pairA]) as number;
        const [first, second] = rng.chance(0.5) ? [pairA, pairB] : [pairB, pairA];
        tap(first); tap(second);
        for (const c of [pairA, pairB]) known.delete(c);
        continue;
      }
      const fresh = um.filter((i) => !known.has(i));
      if (fresh.length === 0) { st = mm.step(lv, st, null, t); t += 300; continue; }
      const a = fresh[rng.int(0, fresh.length - 1)] as number;
      tap(a);
      const partner = [...known].find((k) => um.includes(k) && lv.cards[k] === lv.cards[a]);
      if (partner !== undefined) { tap(partner); known.delete(partner); continue; }
      const rest = fresh.filter((i) => i !== a);
      if (rest.length === 0) break;
      const b = rest[rng.int(0, rest.length - 1)] as number;
      tap(b);
      if (st.matched.includes(a)) continue; // lucky pair
      if (rng.chance(0.8)) known.add(a);
      if (rng.chance(0.8)) known.add(b);
      if (lv.peekAvailable && !peeked && !mm.result(lv, st)) {
        peeked = true;
        st = mm.step(lv, st, { peek: true }, t);
        const left = unmatched().length;
        const p = Math.min(0.95, 1 - Math.exp(-lv.peekMs / (350 * left)));
        for (const i of unmatched()) if (rng.chance(p)) known.add(i);
        t += lv.peekMs + 200;
      }
    }
    st = mm.step(lv, st, null, Math.max(t, endMs));
    return { passed: !!mm.result(lv, st)?.passed, ignored, mismatches: st.mismatches, taps, finishMs: mm.result(lv, st)?.timeTakenMs ?? 0 };
  }

  /** A thumb with Gaussian error `sigmaPx` aims the IDEAL shot of the next target (static first); moving targets are shot at a random phase. */
  function slingPlayer(lv: SlingLevel, rng: Rng, sigmaPx: number, heightPx: number): TimedInput<SlingAim>[] {
    const maxDrag = 0.25 * heightPx;
    const out: TimedInput<SlingAim>[] = [];
    const down: number[] = [];
    let ready = 0;
    const order = lv.targets.map((_, i) => i).sort((a, b) => Number(a < lv.movingCount) - Number(b < lv.movingCount) || a - b);
    for (let bullet = 0; bullet < lv.bullets && down.length < lv.targetsRequired; bullet++) {
      const i = order.find((k) => !down.includes(k));
      if (i === undefined) break;
      const tg = lv.targets[i]!;
      const len = tg.ideal.power * maxDrag;
      const a = (-tg.ideal.yawDeg * Math.PI) / 180;
      const aim = aimFromDrag(len * Math.sin(a) + sigmaPx * gauss(rng), len * Math.cos(a) + sigmaPx * gauss(rng), maxDrag);
      let t = ready + 2300 + 700 * Math.abs(gauss(rng));
      if (i < lv.movingCount) t += rng.range(0, 4 * tg.halfM / Math.max(0.1, lv.moveSpeedMps) * 1000); // moving: wait for a random phase
      if (!aim) continue;
      out.push({ tMs: t, input: aim });
      const shot = simulateShot(lv, aim, t, down);
      if (shot.hitIndex !== null) down.push(shot.hitIndex);
      ready = t + shot.flightMs + 400;
    }
    return out;
  }

  function passRate(n: number, f: (seed: number) => boolean): number {
    let ok = 0;
    for (let seed = 1; seed <= n; seed++) if (f(seed)) ok++;
    return ok / n;
  }
  const z = (a: number, b: number, n: number): number => (a - b) / Math.sqrt(Math.max(1e-9, (a * (1 - a) + b * (1 - b)) / n));

  const SETS: [string, 'boost' | 'sabotage', MinigameModifier[]][] = [
    ['Jam Pasir +5', 'boost', [{ kind: 'timeDelta', seconds: 5 }]],
    ['Zona Lebar', 'boost', [{ kind: 'tolerance', mult: 1.3 }]],
    ['Teropong', 'boost', [{ kind: 'hint' }]],
    ['Jam Rusak -5', 'sabotage', [{ kind: 'timeDelta', seconds: -5 }]],
    ['Ngebut', 'sabotage', [{ kind: 'speed', mult: 1.25 }]],
    ['Tambah Beban', 'sabotage', [{ kind: 'extraTarget', count: 1 }]],
    ['Kabut', 'sabotage', [{ kind: 'fog' }]],
  ];

  const N = 3000;
  const runModel = (id: string, d: Difficulty, mods: MinigameModifier[], seedBase = 0): number => {
    switch (id) {
      case 'whack_a_mole':
        return passRate(N, (s) => { const lv = gen(wm, s, d, mods); const rng = new Rng(s + 7000 + seedBase); return !!runScript(wm, lv, whackPlayer(lv, rng), lv.durationMs + 500).result?.passed; });
      case 'guess_location':
        return passRate(N, (s) => { const lv = gen(gl, s, d, mods); const rng = new Rng(s + 9000 + seedBase); return !!runScript(gl, lv, guessPlayer(lv, rng, d), lv.durationMs + 500).result?.passed; });
      case 'memory_match':
        return passRate(N, (s) => memoryPlay(gen(mm, s, d, mods), new Rng(s + 3000 + seedBase)).passed);
      default:
        return passRate(1200, (s) => { const lv = gen(sl, s, d, mods); const rng = new Rng(s + 5000 + seedBase); return !!runScript(sl, lv, slingPlayer(lv, rng, 7, 844), lv.durationMs + 4000).result?.passed; });
    }
  };

  for (const id of ['whack_a_mole', 'guess_location', 'memory_match', 'slingshot']) {
    it(`${id}: a noisy human-like player passes MORE with every boost and LESS with every sabotage (z-test, ${id === 'slingshot' ? 1200 : N} runs per cell)`, () => {
      const lines: string[] = [];
      const wrong: string[] = [];
      const n = id === 'slingshot' ? 1200 : N;
      for (const d of DIFFS) {
        const base = runModel(id, d, []);
        let line = `${id} ${d} base ${(100 * base).toFixed(1)}%`;
        for (const [name, kind, mods] of SETS) {
          const p = runModel(id, d, mods);
          const zz = z(p, base, n);
          line += ` | ${name} ${(100 * p).toFixed(1)}% (z=${zz.toFixed(1)})`;
          // saturated cells (both ~0 or ~100) cannot show a direction
          const informative = base > 0.03 && base < 0.97;
          if (informative && kind === 'boost' && zz < -2.5) wrong.push(`${id}/${d}/${name}: boost LOWERED pass rate ${(100 * base).toFixed(1)} -> ${(100 * p).toFixed(1)}`);
          if (informative && kind === 'sabotage' && zz > 2.5 && !(id === 'memory_match' && name === 'Ngebut')) wrong.push(`${id}/${d}/${name}: sabotage RAISED pass rate ${(100 * base).toFixed(1)} -> ${(100 * p).toFixed(1)}`);
        }
        lines.push(line);
      }
      for (const l of lines) say(`model ${l}`);
      expect(wrong).toEqual([]);
    });
  }

  it('Cocokkan Kartu: what Ngebut really does (closed-loop player): pass rate, and taps lost to the open wrong pair, with and without Ngebut; preview is 0 on hard so Ngebut only shortens the wrong-pair window there', () => {
    for (const d of DIFFS) {
      const row: string[] = [];
      for (const [name, mods] of [['plain', []], ['Ngebut', [{ kind: 'speed', mult: 1.25 }]], ['Jam Rusak', [{ kind: 'timeDelta', seconds: -5 }]]] as [string, MinigameModifier[]][]) {
        let ok = 0;
        let ign = 0;
        let mis = 0;
        let taps = 0;
        let fin = 0;
        const n = 3000;
        for (let s = 1; s <= n; s++) {
          const r = memoryPlay(gen(mm, s, d, mods), new Rng(s + 3000));
          if (r.passed) { ok++; fin += r.finishMs; }
          ign += r.ignored;
          mis += r.mismatches;
          taps += r.taps;
        }
        row.push(`${name} pass ${(100 * ok / n).toFixed(1)}% ignored taps/run ${(ign / n).toFixed(2)} mismatches/run ${(mis / n).toFixed(1)} taps/run ${(taps / n).toFixed(1)} mean finish ${(fin / Math.max(1, ok) / 1000).toFixed(1)} s`);
      }
      const lv = gen(mm, 1, d, [{ kind: 'speed', mult: 1.25 }]);
      say(`memory ${d}: ${row.join(' | ')} | Ngebut level: preview ${lv.previewMs} ms (plain ${gen(mm, 1, d).previewMs}), wrong-pair window ${lv.mismatchDelayMs} ms (plain ${gen(mm, 1, d).mismatchDelayMs})`);
    }
    expect(gen(mm, 1, 'hard', [{ kind: 'speed', mult: 1.25 }]).previewMs).toBe(0);
  });

  it('measured fog effect: share of Whack spawns whose hole is fogged when the character appears, share of Ketapel targets deeper than 20 m', () => {
    for (const d of DIFFS) {
      let fogged = 0;
      let tot = 0;
      let deep = 0;
      let targets = 0;
      for (let seed = 1; seed <= 500; seed++) {
        const lv = gen(wm, seed, d, [{ kind: 'fog' }]);
        for (const s of lv.spawns) {
          tot++;
          const w = lv.fog[Math.min(lv.fog.length - 1, Math.floor(s.tMs / 3000))]!;
          if (w.holes.includes(s.hole)) fogged++;
        }
        const sk = gen(sl, seed, d, [{ kind: 'fog' }]);
        for (const tg of sk.targets) { targets++; if (tg.center.z >= sk.fogDepthM) deep++; }
      }
      say(`fog ${d}: Whack ${(100 * fogged / tot).toFixed(1)}% of spawns under fog; Ketapel ${(100 * deep / targets).toFixed(1)}% of targets beyond ${20} m`);
      expect(fogged).toBeGreaterThan(0);
      expect(deep).toBeGreaterThan(0);
    }
  });
});

// ============================================================================================
// S5. Pool and pick
// ============================================================================================
const map: MapGraph = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const POOL = minigamePool(map.data);

describe('S5 pool distribution and the no-repeat rule with 7 minigames', () => {
  it('pool is the 7 ids in registry order; 10,000 draws with `last` cycling: never equal to last, each of the 6 candidates 16.7% +-1.5 (conditional), one rng draw per pick', () => {
    expect(POOL).toEqual(['tap_timing', 'simon', 'dodge_runner', 'whack_a_mole', 'slingshot', 'memory_match', 'guess_location']);
    let rng = new Rng(2026).getState();
    const picked = new Map<string, number>();
    const asCandidate = new Map<string, number>();
    const mirror = Rng.fromState(rng);
    for (let i = 0; i < 10_000; i++) {
      const last = POOL[i % 7] as string;
      const r = pickMinigame(POOL, rng, last);
      mirror.next(); // exactly one draw per pick
      expect(r.rng).toEqual(mirror.getState());
      rng = r.rng;
      expect(r.id).not.toBe(last);
      picked.set(r.id, (picked.get(r.id) ?? 0) + 1);
      for (const id of POOL) if (id !== last) asCandidate.set(id, (asCandidate.get(id) ?? 0) + 1);
    }
    const shares = POOL.map((id) => (100 * (picked.get(id) ?? 0)) / (asCandidate.get(id) ?? 1));
    say(`pick share when a candidate (target 16.67%): ${POOL.map((id, i) => `${id} ${(shares[i] as number).toFixed(2)}`).join(', ')}`);
    for (const s of shares) expect(Math.abs(s - 16.667)).toBeLessThan(1.5);
  });

  it('every (last -> next) cell over 70,000 draws is 16.7% +-1.5 (no hidden correlation with the previous minigame)', () => {
    let rng = new Rng(77).getState();
    const cell = new Map<string, number>();
    const rowTotal = new Map<string, number>();
    let last: string | null = null;
    for (let i = 0; i < 70_000; i++) {
      const r = pickMinigame(POOL, rng, last);
      rng = r.rng;
      if (last) {
        cell.set(`${last}>${r.id}`, (cell.get(`${last}>${r.id}`) ?? 0) + 1);
        rowTotal.set(last, (rowTotal.get(last) ?? 0) + 1);
      }
      last = r.id;
    }
    let worst = 0;
    for (const a of POOL) for (const b of POOL) {
      if (a === b) { expect(cell.get(`${a}>${b}`) ?? 0).toBe(0); continue; }
      const p = (100 * (cell.get(`${a}>${b}`) ?? 0)) / (rowTotal.get(a) as number);
      worst = Math.max(worst, Math.abs(p - 16.667));
    }
    say(`pick transition matrix: worst cell deviation ${worst.toFixed(2)} points (n per row about 10,000)`);
    expect(worst).toBeLessThan(1.5);
  });

  it('through the real reducer in 400 bot matches (2 bots + a human seat, all levels): a fresh draw never equals the last minigame played (failed attempts count), a retry keeps it, the second win in a region differs from the first, and the 7 ids are used about evenly', () => {
    const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
    const used = new Map<string, number>();
    let draws = 0;
    let retries = 0;
    let secondWins = 0;
    let started = 0;
    for (let i = 0; i < 400; i++) {
      const seed = 60_000 + i * 13;
      const seats: SimSeat[] = [
        { id: 'p1', kind: 'human', profile: HUMAN_PROFILE[(['casual', 'attentive', 'expert'] as const)[i % 3] as 'casual'] },
        { id: 'bot1', kind: 'bot', profile: BOT_PROFILE[LEVELS[i % 3] as BotLevel], botLevel: LEVELS[i % 3] as BotLevel },
        { id: 'bot2', kind: 'bot', profile: BOT_PROFILE[LEVELS[(i + 1) % 3] as BotLevel], botLevel: LEVELS[(i + 1) % 3] as BotLevel },
      ];
      const session = new GameSession(map, createInitialState(map, seats.map((s) => ({ id: s.id, name: s.id, kind: s.kind, ...(s.botLevel ? { botLevel: s.botLevel } : {}) })), seed, POOL), seats.map((s) => new SmartBotController(s.id, seed, s.profile)));
      const prevNext = new Map<string, string | null>();
      const lastWinMg = new Map<string, string>(); // `${player}|${target}` -> minigame of the 1st win
      session.subscribe((state, evs) => {
        for (const p of state.players) {
          const before = prevNext.get(p.id) ?? null;
          if (p.nextMinigameId !== before && p.nextMinigameId !== null) {
            if (!p.retry) {
              draws++;
              expect(p.nextMinigameId, `${p.id} seed ${seed}: fresh draw equals the last played`).not.toBe(p.lastMinigameId);
            }
          }
          if (p.retry && p.nextMinigameId) expect(p.nextMinigameId, `${p.id} retry after a fail must replay the same minigame`).toBe(p.lastMinigameId);
          prevNext.set(p.id, p.nextMinigameId);
        }
        for (const e of evs) {
          if (e.type === 'attemptResolved' && !e.passed) retries++;
          if (e.type === 'attemptStarted') { started++; used.set(e.attempt.minigameId, (used.get(e.attempt.minigameId) ?? 0) + 1); }
          if (e.type === 'attemptResolved' && e.passed) {
            const key = `${e.playerId}|${e.targetId}`;
            if (e.winsAtTarget === 1) lastWinMg.set(key, e.minigameId);
            else if (e.winsAtTarget >= 2 && lastWinMg.has(key)) {
              secondWins++;
              expect(e.minigameId, `${key}: the 2nd win used the same minigame as the 1st`).not.toBe(lastWinMg.get(key));
            }
          }
        }
      });
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 60_000) session.stepToNextWake();
      expect(session.state.status).toBe('finished');
    }
    const shares = POOL.map((id) => (100 * (used.get(id) ?? 0)) / started);
    say(`400 matches: ${started} attempts, ${draws} fresh draws, ${retries} retries, ${secondWins} 2nd wins checked; attempt share per minigame ${POOL.map((id, k) => `${id} ${(shares[k] as number).toFixed(1)}%`).join(', ')}`);
    // Retries repeat a minigame, so shares are not exactly 1/7; they must still be even within a few points.
    for (const s of shares) expect(Math.abs(s - 100 / 7)).toBeLessThan(3.5);
  });
});

// ============================================================================================
// S6. Ketapel: placement (interpretation 1), nearest hit (2), aim precision (measurement)
// ============================================================================================
describe('S6 Ketapel placement and aiming', () => {
  it('interpretation 1: reproduce the Engineer\'s claim (10 tries of spacing alone: 96/83/57% clean levels); the shipped rule (200 tries + clear-path) leaves < 0.6% unclean levels without modifiers and < 3% under reachable mixes', () => {
    // Independent re-implementation of the spec: same draw order, 10 tries, spacing only.
    const spacingOnly = (seed: number, d: Difficulty, tries: number): boolean => {
      const lv = gen(sl, seed, d);
      const rng = new Rng(seed);
      const knob = { easy: 4, medium: 5, hard: 6 }[d];
      rng.int(0, 1); // wind sign
      const centers: { x: number; z: number }[] = [];
      for (let i = 0; i < knob; i++) {
        let made = { x: 0, z: 0 };
        for (let a = 0; a < tries; a++) {
          const yaw = -18 + 36 * rng.next();
          const power = 0.45 + 0.45 * rng.next();
          const tFrac = 0.55 + 0.3 * rng.next();
          rng.int(0, 2); rng.int(0, 2); rng.next();
          const p = shotPosition({ yawDeg: yaw, power }, lv.windMps, tFrac * groundTimeSec(power));
          made = { x: p.x, z: p.z };
          if (centers.every((o) => Math.hypot(o.x - made.x, o.z - made.z) >= SLING_MIN_SPACING_M)) break;
        }
        centers.push(made);
      }
      return centers.every((a, i) => centers.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.z - b.z) >= SLING_MIN_SPACING_M));
    };
    for (const d of DIFFS) {
      let clean10 = 0;
      for (let seed = 1; seed <= 2000; seed++) if (spacingOnly(seed, d, 10)) clean10++;
      say(`placement ${d}: 10 tries, spacing only -> ${(clean10 / 20).toFixed(1)}% of levels have every target >= 4 m apart (Engineer claimed 96/83/57)`);
    }
    const rng = new Rng(3);
    const bad = { none: 0, reachable: 0 };
    const total = { none: 0, reachable: 0 };
    for (let seed = 1; seed <= 5000; seed++) {
      for (const d of DIFFS) {
        const group = seed % 2 ? 'none' : 'reachable';
        const mods = group === 'none' ? [] : reachableMods(rng);
        const lv = gen(sl, seed, d, mods);
        total[group]++;
        let ok = true;
        for (let i = 0; i < lv.targets.length; i++) for (let j = i + 1; j < lv.targets.length; j++) {
          const a = lv.targets[i]!.center;
          const b = lv.targets[j]!.center;
          if (Math.hypot(a.x - b.x, a.z - b.z) < SLING_MIN_SPACING_M - 1e-9) ok = false;
        }
        lv.targets.forEach((tg, i) => {
          if (tg.center.y < 2 - 1e-9 || tg.center.z < 8 || tg.center.z > 30) ok = false;
          if (i >= lv.movingCount && simulateShot(lv, { yawDeg: tg.ideal.yawDeg, power: tg.ideal.power }, 0).hitIndex !== i) ok = false;
        });
        if (!ok) bad[group]++;
      }
    }
    say(`placement shipped rule (200 tries): no modifiers ${bad.none}/${total.none} levels fall short of spacing / height / depth / own-ideal-hits; reachable modifier mixes ${bad.reachable}/${total.reachable}`);
    expect(bad.none / total.none).toBeLessThan(0.006);
    expect(bad.reachable / total.reachable).toBeLessThan(0.03);
  });

  it('interpretation 2: when one sample is inside two targets the NEAREST is hit, and the result does not depend on the array order of the targets', () => {
    let tested = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const lv = gen(sl, seed, 'easy', [{ kind: 'tolerance', mult: 1.8 }]);
      // Build a level whose first two targets overlap around the first one's ideal point.
      const a = lv.targets[0]!;
      const b = { ...lv.targets[1]!, center: { x: a.center.x + 0.6, y: a.center.y, z: a.center.z } };
      const crowd: SlingLevel = { ...lv, targets: [a, b], movingCount: 0, moveSpeedMps: 0 };
      const swapped: SlingLevel = { ...crowd, targets: [b, a] };
      const aim = { yawDeg: a.ideal.yawDeg, power: a.ideal.power };
      const s1 = simulateShot(crowd, aim, 0);
      const s2 = simulateShot(swapped, aim, 0);
      if (s1.hitIndex === null) continue;
      tested++;
      const c1 = crowd.targets[s1.hitIndex]!.center;
      const c2 = swapped.targets[s2.hitIndex as number]!.center;
      expect([c1.x, c1.z]).toEqual([c2.x, c2.z]);
      expect(s1.flightMs).toBe(s2.flightMs);
    }
    expect(tested).toBeGreaterThan(200);
  });

  it('measurement: how much finger error the ideal shot tolerates, in pixels, per difficulty and screen size (1 px steps in the drag vector around the ideal)', () => {
    for (const [label, heightPx] of [['390x844 portrait', 844], ['1280x720 desktop', 720], ['844x390 landscape', 390]] as const) {
      const maxDrag = 0.25 * heightPx;
      const row: string[] = [];
      for (const d of DIFFS) {
        const widths: number[] = [];
        for (let seed = 1; seed <= 150; seed++) {
          const lv = gen(sl, seed, d);
          lv.targets.forEach((tg, i) => {
            if (i >= lv.movingCount) {
              // along the drag-length axis and the sideways axis, find the half-width (px) where the shot still hits target i
              const len = tg.ideal.power * maxDrag;
              const a = (-tg.ideal.yawDeg * Math.PI) / 180;
              const ux = Math.sin(a), uy = Math.cos(a);
              const hits = (dx: number, dy: number): boolean => {
                const aim = aimFromDrag(len * ux + dx, len * uy + dy, maxDrag);
                return !!aim && simulateShot(lv, aim, 0).hitIndex === i;
              };
              let along = 0;
              while (along < 80 && hits(ux * (along + 1), uy * (along + 1)) && hits(-ux * (along + 1), -uy * (along + 1))) along++;
              let side = 0;
              while (side < 80 && hits(uy * (side + 1), -ux * (side + 1)) && hits(-uy * (side + 1), ux * (side + 1))) side++;
              widths.push(Math.min(along, side));
            }
          });
        }
        widths.sort((x, y) => x - y);
        row.push(`${d}: median +-${widths[Math.floor(widths.length / 2)]} px, p10 +-${widths[Math.floor(widths.length * 0.1)]} px`);
      }
      say(`ideal-shot tolerance on ${label} (drag max ${maxDrag.toFixed(0)} px): ${row.join(' | ')}`);
    }
  });

  it('measurement: pass rate of a player who knows the ideal aim but has a thumb with Gaussian error sigma (px), per screen size', () => {
    const rows: string[] = [];
    for (const [label, heightPx] of [['portrait 844', 844], ['desktop 720', 720], ['landscape 390', 390]] as const) {
      for (const sigma of [2, 4, 6, 9, 14]) {
        const out: string[] = [];
        for (const d of DIFFS) {
          let ok = 0;
          const n = 800;
          for (let seed = 1; seed <= n; seed++) {
            const lv = gen(sl, seed, d);
            const rng = new Rng(seed * 31 + sigma);
            const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
            const maxDrag = 0.25 * heightPx;
            const script: TimedInput<SlingAim>[] = [];
            const down: number[] = [];
            let ready = 0;
            const order = lv.targets.map((_, i) => i).sort((a, b) => Number(a < lv.movingCount) - Number(b < lv.movingCount) || a - b);
            for (let b = 0; b < lv.bullets && down.length < lv.targetsRequired; b++) {
              const i = order.find((k) => !down.includes(k));
              if (i === undefined) break;
              const tg = lv.targets[i]!;
              const len = tg.ideal.power * maxDrag;
              const a = (-tg.ideal.yawDeg * Math.PI) / 180;
              const aim = aimFromDrag(len * Math.sin(a) + sigma * gauss(), len * Math.cos(a) + sigma * gauss(), maxDrag);
              let t = ready + 1500;
              if (i < lv.movingCount) t += rng.range(0, 4000);
              if (!aim) continue;
              script.push({ tMs: t, input: aim });
              const sh = simulateShot(lv, aim, t, down);
              if (sh.hitIndex !== null) down.push(sh.hitIndex);
              ready = t + sh.flightMs + 400;
            }
            if (runScript(sl, lv, script, lv.durationMs + 4000).result?.passed) ok++;
          }
          out.push(`${d} ${(100 * ok / n).toFixed(0)}%`);
        }
        rows.push(`${label} sigma ${sigma}px: ${out.join(', ')}`);
      }
    }
    for (const r of rows) say(`thumb-noise pass (ideal aim known, moving targets timed at random) ${r}`);
  });
});

// ============================================================================================
// S7. Zone / replay fuzz with 7 minigames, smart bots, and a human who plays the REAL logic
// ============================================================================================
function allUids(s: Readonly<GameState>): string[] {
  const out: string[] = [];
  for (const p of s.players) {
    out.push(...p.hand.map((c) => c.uid), ...p.pending.map((c) => c.uid), ...p.discarded.map((c) => c.uid));
    if (p.offer) out.push(...p.offer.cards.map((c) => c.uid));
  }
  return out;
}
function invariants(s: Readonly<GameState>, label: string): void {
  const all = allUids(s);
  if (new Set(all).size !== all.length) throw new Error(`${label}: a card is in two zones`);
  if (all.length !== s.nextCardUid - 1) throw new Error(`${label}: a card is in no zone`);
  for (const p of s.players) {
    if (sabotageSlotsUsed(p) > 2) throw new Error(`${label} ${p.id}: > 2 sabotage slots`);
    if ((p.phase === 'playing') !== (p.attempt !== null)) throw new Error(`${label} ${p.id}: phase vs attempt`);
    if (p.phase === 'playing' && (p.offer || p.discard)) throw new Error(`${label} ${p.id}: card screen while playing`);
    if (p.hand.length > 11) throw new Error(`${label} ${p.id}: hand ${p.hand.length}`);
    if (p.nextMinigameId !== null && !POOL.includes(p.nextMinigameId)) throw new Error(`${label} ${p.id}: next minigame ${p.nextMinigameId} not in pool`);
    if (p.attempt && !POOL.includes(p.attempt.minigameId)) throw new Error(`${label} ${p.id}: attempt minigame not in pool`);
  }
}

/** Wraps a smart-bot "human": when it submits a result, the pass/fail and time come from a noisy player on the REAL generated level. */
class RealLogicHuman implements PlayerController {
  readonly playerId: string;
  readonly stats = new Map<string, { n: number; pass: number }>();
  warnings = 0;
  constructor(private readonly inner: SmartBotController) {
    this.playerId = inner.playerId;
  }
  wakeAtMs(state: Readonly<GameState>): number { return this.inner.wakeAtMs(state); }
  activity() { return this.inner.activity?.() ?? null; }
  nextAction(state: Readonly<GameState>, m: MapGraph): GameAction | null {
    const a = this.inner.nextAction(state, m);
    if (!a || a.type !== 'minigameResult') return a;
    const me = state.players.find((p) => p.id === this.playerId)!;
    const at = me.attempt!;
    const mg = MINIGAME_LOGIC.find((x) => x.id === at.minigameId)!;
    const lv: any = mg.generateLevel({ seed: at.seed, difficulty: at.difficulty, modifiers: at.modifiers, map: m.data, regionId: at.targetId, inputMode: 'touch', settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 } });
    this.warnings += (lv.warnings ?? []).length;
    const rng = new Rng(at.seed ^ 0x5bd1e995);
    const g = (): number => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
    let script: TimedInput<any>[] = [];
    let end = 0;
    if (mg.id === 'whack_a_mole') {
      for (const s of lv.spawns) {
        const r = Math.max(180, 470 + 120 * g());
        if (s.kind === 'target' ? rng.chance(0.96) : rng.chance(0.08)) script.push({ tMs: s.tMs + r, input: { hole: s.hole } });
      }
      end = lv.durationMs + 500;
    } else if (mg.id === 'guess_location') {
      let qs = 0;
      for (let q = 0; q < lv.questions; q++) {
        const it = lv.items[q];
        const think = Math.max(700, 2300 + 900 * g());
        if (think >= lv.timePerQuestionMs) { qs += lv.timePerQuestionMs + lv.gapMs; continue; }
        const idx = it.choices.indexOf(it.correctRegionId);
        const options = it.choices.map((_: unknown, i: number) => i).filter((i: number) => !(lv.hintActive && i === it.hintRemovedIndex));
        script.push({ tMs: qs + think, input: { choice: rng.chance(0.7) ? idx : options[rng.int(0, options.length - 1)] } });
        qs += think + lv.gapMs;
      }
      end = lv.durationMs + 500;
    } else if (mg.id === 'slingshot') {
      const off = rng.int(0, 120);
      script = slingshotPerfectScript(lv).map((e) => ({ tMs: e.tMs + off, input: { yawDeg: e.input.yawDeg + 0.3 * g(), power: Math.min(1, e.input.power + 0.004 * g()) } }));
      script.sort((x, y) => x.tMs - y.tMs);
      end = lv.durationMs + 4000;
    } else if (mg.id === 'memory_match') {
      script = memoryPerfectScript(lv, 700 + rng.int(0, 500)).filter(() => rng.chance(0.97));
      end = lv.previewMs + lv.durationMs + 500;
    }
    if (['whack_a_mole', 'guess_location', 'slingshot', 'memory_match'].includes(mg.id)) {
      const r = runScript(mg, lv, script, end).result;
      const st = this.stats.get(mg.id) ?? { n: 0, pass: 0 };
      st.n++;
      if (r?.passed) st.pass++;
      this.stats.set(mg.id, st);
      if (r) return { ...a, passed: r.passed, timeTakenMs: r.timeTakenMs };
    }
    return a;
  }
}

describe('S7 zone and replay fuzz with the 7-minigame pool', () => {
  const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
  const humans = [HUMAN_PROFILE.casual, HUMAN_PROFILE.attentive, HUMAN_PROFILE.expert];
  const seatsFor = (i: number): SimSeat[] => {
    const k = (i % 3) + 1;
    const out: SimSeat[] = [{ id: 'p1', kind: 'human', profile: humans[i % 3] as typeof humans[0] }];
    for (let b = 0; b < k; b++) out.push({ id: `bot${b + 1}`, kind: 'bot', profile: BOT_PROFILE[LEVELS[(i + b) % 3] as BotLevel], botLevel: LEVELS[(i + b) % 3] as BotLevel });
    return out;
  };
  const initial = (seats: SimSeat[], seed: number): GameState => createInitialState(map, seats.map((s) => ({ id: s.id, name: s.id, kind: s.kind, ...(s.botLevel ? { botLevel: s.botLevel } : {}) })), seed, POOL);

  it('300 matches where the human seat plays the real minigame logic with noisy models: 0 rejected, no ignored-modifier warning, zone invariants after every action, replay(actionLog) = live state', () => {
    const agg = new Map<string, { n: number; pass: number }>();
    let warnings = 0;
    let cardsInAttempts = 0;
    for (let i = 0; i < 300; i++) {
      const seed = 880_000 + i * 11;
      const seats = seatsFor(i);
      const human = new RealLogicHuman(new SmartBotController('p1', seed, seats[0]!.profile));
      const ctls: PlayerController[] = seats.map((s) => (s.id === 'p1' ? human : new SmartBotController(s.id, seed, s.profile)));
      const session = new GameSession(map, initial(seats, seed), ctls);
      session.subscribe((state, evs) => {
        for (const e of evs) {
          if (e.type === 'actionRejected') throw new Error(`match ${i} seed ${seed}: rejected ${JSON.stringify(e.action)} (${e.reason})`);
          if (e.type === 'attemptStarted' && e.attempt.modifiers.length > 0) cardsInAttempts++;
        }
        invariants(state, `match ${i} seed ${seed} t=${state.timeMs}`);
      });
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 60_000) session.stepToNextWake();
      expect(session.state.status, `match ${i} finished`).toBe('finished');
      warnings += human.warnings;
      for (const [id, v] of human.stats) {
        const a = agg.get(id) ?? { n: 0, pass: 0 };
        a.n += v.n; a.pass += v.pass;
        agg.set(id, a);
      }
      const replayed = replay(map, initial(seats, seed), session.actionLog.map((l) => l.action));
      expect(JSON.stringify(replayed), `match ${i} replay`).toBe(JSON.stringify(session.state));
    }
    say(`S7: 300 matches, ${cardsInAttempts} attempts started with card modifiers, level warnings ${warnings}; human attempts on the real logic: ${[...agg].map(([id, v]) => `${id} ${v.pass}/${v.n}`).join(', ')}`);
    expect(warnings).toBe(0);
    for (const id of ['whack_a_mole', 'slingshot', 'memory_match', 'guess_location']) expect(agg.get(id)?.n ?? 0, `${id} was played`).toBeGreaterThan(20);
  });

  it('disruption fuzz on the 7-pool: random grants, forced offers, forced minigames, target switches, long ticks; no rejected bot action, invariants hold, every match finishes', () => {
    const ids = CARDS.map((c) => c.id);
    let injected = 0;
    let botRejects = 0;
    for (let i = 0; i < 120; i++) {
      const seed = 990_000 + i * 17;
      const seats = seatsFor(i + 1);
      const session = new GameSession(map, initial(seats, seed), seats.map((s) => new SmartBotController(s.id, seed, s.profile)));
      const mine = new Set<GameAction>();
      session.subscribe((state, evs) => {
        for (const e of evs) if (e.type === 'actionRejected' && !mine.has(e.action)) botRejects++;
        invariants(state, `fuzz ${i}`);
      });
      const r = new Rng(seed);
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 40_000) {
        session.stepToNextWake();
        if (r.chance(0.05)) {
          const target = r.pick(session.state.players);
          const roll = r.int(0, 9);
          let a: GameAction;
          if (roll <= 3) a = { type: 'debugGrantCard', playerId: target.id, cardId: r.pick(ids) };
          else if (roll <= 5 && !target.offer && !target.discard) a = { type: 'debugForceOffer', playerId: target.id, cardIds: [r.pick(ids), r.pick(ids), r.pick(ids)], pick: r.int(1, 3) };
          else if (roll === 6 && target.phase === 'idle' && target.targetId) a = { type: 'debugForceMinigame', playerId: target.id, minigameId: r.pick(POOL) };
          else if (roll === 7) a = { type: 'debugClearHand', playerId: target.id };
          else a = { type: 'tick', dtMs: r.pick([777, 5000, 14_999, 15_001, 33_333]) };
          mine.add(a);
          session.dispatch(a);
          injected++;
        }
      }
      expect(session.state.status, `fuzz ${i}`).toBe('finished');
      const replayed = replay(map, initial(seats, seed), session.actionLog.map((l) => l.action));
      expect(JSON.stringify(replayed), `fuzz ${i} replay`).toBe(JSON.stringify(session.state));
    }
    say(`S7 fuzz: ${injected} injected actions over 120 matches, bot rejects ${botRejects}`);
    expect(botRejects).toBe(0);
  });

  it('streams stay independent: a different pool order or a forced minigame for p1 does not change the pick stream of p2', () => {
    const a = createInitialState(map, [{ id: 'p1', name: 'p1', kind: 'human' }, { id: 'p2', name: 'p2', kind: 'bot', botLevel: 'easy' }], 123, POOL);
    const b = applyAction(map, a, { type: 'selectTarget', playerId: 'p1', targetId: outgoing(map, a.players[0]!.nodeId)[0] as string }).state;
    expect(b.players[1]!.pickRng).toEqual(a.players[1]!.pickRng);
    expect(streamSeed(123, 'p1', 'minigamePick')).not.toBe(streamSeed(123, 'p2', 'minigamePick'));
  });
});
