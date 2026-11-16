import { describe, expect, it } from 'vitest';
import {
  playbackPad,
  playbackMs,
  roundLength,
  SIMON_BASE_MS,
  SIMON_KNOBS,
  simonLogic as mg,
  totalRounds,
  type Difficulty,
  type MinigameContext,
  type MinigameModifier,
  type SimonInput,
  type SimonLevel,
  type SimonState,
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
const pad = (p: number): SimonInput => ({ kind: 'pad', pad: p });

/** Time at which the input phase of round r starts (no mistakes before): delay + playbacks. */
function inputStart(level: SimonLevel, round: number): number {
  let t = 0;
  for (let r = 0; r <= round; r++) t += level.roundDelayMs + playbackMs(level, r) + (r < round ? 400 * roundLength(level, r) : 0);
  return t;
}

/** Perfect play with `think` ms between inputs. Returns the final state and the last input time. */
function perfect(level: SimonLevel, think = 400): { s: SimonState; lastT: number } {
  let s = mg.initState(level);
  let t = 0;
  let lastT = 0;
  while (!s.result && t < level.durationMs) {
    if (s.phase !== 'input') {
      t += 50;
      s = mg.step(level, s, null, t);
    } else {
      t += think;
      s = mg.step(level, s, pad(level.sequence[s.inputIndex] as number), t);
      lastT = t;
    }
  }
  return { s, lastT };
}

describe('simon generateLevel', () => {
  it.each(['easy', 'medium', 'hard'] as const)('%s knobs match the spec table (mg_simon_knobs_match_spec)', (d) => {
    const level = mg.generateLevel(ctx(1, d));
    const k = SIMON_KNOBS[d];
    expect(level).toMatchObject({
      durationMs: SIMON_BASE_MS,
      padCount: k.padCount,
      startLength: 3,
      targetLength: k.targetLength,
      flashMs: k.flashMs,
      gapMs: 150,
      roundDelayMs: 800,
      idleTimeoutMs: 3000,
      mistakesAllowed: k.mistakesAllowed,
      replayAvailable: false,
      fog: false,
    });
    expect(level.sequence).toHaveLength(k.targetLength);
  });

  it('spec table values', () => {
    expect([SIMON_KNOBS.easy, SIMON_KNOBS.medium, SIMON_KNOBS.hard].map((k) => [k.padCount, k.targetLength, k.flashMs, k.mistakesAllowed]))
      .toEqual([[4, 4, 700, 2], [4, 5, 550, 1], [6, 6, 400, 0]]);
  });

  it('is deterministic from the seed and pinned for fixed seeds', () => {
    expect(mg.generateLevel(ctx(42, 'medium'))).toEqual(mg.generateLevel(ctx(42, 'medium')));
    expect(mg.generateLevel(ctx(42, 'medium')).sequence).not.toEqual(mg.generateLevel(ctx(43, 'medium')).sequence);
    // Pinned values: a change here means the PRNG draw order changed.
    expect(mg.generateLevel(ctx(1, 'easy')).sequence).toMatchInlineSnapshot(`
      [
        1,
        3,
        2,
        2,
      ]
    `);
    expect(mg.generateLevel(ctx(1337, 'hard')).sequence).toMatchInlineSnapshot(`
      [
        2,
        1,
        1,
        0,
        2,
        0,
      ]
    `);
  });

  it('pads are in range and the same pad is never drawn 3 times in a row (500 seeds)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      for (const d of ['easy', 'hard'] as const) {
        const level = mg.generateLevel(ctx(seed, d));
        level.sequence.forEach((p, i) => {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThan(level.padCount);
          if (i >= 2) expect(!(p === level.sequence[i - 1] && p === level.sequence[i - 2])).toBe(true);
        });
      }
    }
  });

  it('a longer run shares its prefix with a shorter one for the same seed', () => {
    for (const seed of SEEDS) {
      const base = mg.generateLevel(ctx(seed, 'medium')).sequence;
      const longer = mg.generateLevel(ctx(seed, 'medium', [{ kind: 'extraTarget', count: 2 }])).sequence;
      expect(longer).toHaveLength(base.length + 2);
      expect(longer.slice(0, base.length)).toEqual(base);
    }
  });

  it('modifiers follow the spec table (CP4 hooks)', () => {
    const w = (m: MinigameModifier[], d: Difficulty = 'medium') => mg.generateLevel(ctx(5, d, m));
    expect(w([{ kind: 'timeDelta', seconds: -10 }]).durationMs).toBe(20_000);
    expect(w([{ kind: 'timeDelta', seconds: 10 }]).durationMs).toBe(40_000);
    expect(w([{ kind: 'tolerance', mult: 1.2 }])).toMatchObject({ idleTimeoutMs: 3600, mistakesAllowed: 1 });
    expect(w([{ kind: 'tolerance', mult: 1.3 }])).toMatchObject({ idleTimeoutMs: 3900, mistakesAllowed: 2 });
    expect(w([{ kind: 'tolerance', mult: 1.3 }, { kind: 'tolerance', mult: 1.5 }]).mistakesAllowed).toBe(2); // bonus once
    expect(w([{ kind: 'tolerance', mult: 5 }]).idleTimeoutMs).toBe(6000);
    expect(w([{ kind: 'speed', mult: 1.25 }])).toMatchObject({ flashMs: 440, gapMs: 120, roundDelayMs: 800 });
    expect(w([{ kind: 'speed', mult: 10 }])).toMatchObject({ flashMs: 200, gapMs: 80 });
    expect(w([{ kind: 'extraTarget', count: 1 }])).toMatchObject({ targetLength: 6, durationMs: 34_000 });
    expect(w([{ kind: 'extraTarget', count: 5 }])).toMatchObject({ targetLength: 7, durationMs: 38_000 }); // max +2
    expect(w([{ kind: 'timeDelta', seconds: -10 }, { kind: 'extraTarget', count: 2 }]).durationMs).toBe(28_000); // extra is outside the clamp
    expect(w([{ kind: 'fog' }]).fog).toBe(true);
    expect(w([{ kind: 'hint' }]).replayAvailable).toBe(true);
  });

  it('ignores a modifier it does not know and reports it', () => {
    const level = mg.generateLevel(ctx(5, 'easy', [{ kind: 'bogus' } as unknown as MinigameModifier]));
    expect(level.warnings).toHaveLength(1);
  });
});

describe('simon round structure and input phases', () => {
  const level = mg.generateLevel(ctx(7, 'easy'));

  it('delay 0.8 s -> playback (length x (flash + gap)) -> input', () => {
    const s0 = mg.initState(level);
    expect(mg.step(level, s0, null, 799).phase).toBe('delay');
    expect(mg.step(level, s0, null, 800).phase).toBe('playback');
    const playEnd = 800 + 3 * 850;
    expect(mg.step(level, s0, null, playEnd - 1).phase).toBe('playback');
    const s = mg.step(level, s0, null, playEnd);
    expect(s.phase).toBe('input');
    expect(s.inputIndex).toBe(0);
  });

  it('playback lights the sequence pads for flashMs, then a gap', () => {
    const s = mg.step(level, mg.initState(level), null, 800);
    expect(playbackPad(level, s, 800)).toBe(level.sequence[0]);
    expect(playbackPad(level, s, 800 + 699)).toBe(level.sequence[0]);
    expect(playbackPad(level, s, 800 + 700)).toBeNull(); // gap
    expect(playbackPad(level, s, 800 + 850)).toBe(level.sequence[1]);
    expect(playbackPad(level, s, 800 + 3 * 850)).toBeNull();
  });

  it('taps during the round delay and playback are ignored, not mistakes', () => {
    let s = mg.initState(level);
    s = mg.step(level, s, pad(0), 300);
    s = mg.step(level, s, pad(1), 1500);
    expect(s.mistakes).toBe(0);
    expect(s.inputIndex).toBe(0);
    expect(s.phase).toBe('playback');
  });

  it('correct pad advances; the finished round starts a delay for the next round', () => {
    let t = inputStart(level, 0);
    let s = mg.step(level, mg.initState(level), null, t);
    for (let i = 0; i < 3; i++) {
      t += 300;
      s = mg.step(level, s, pad(level.sequence[i] as number), t);
    }
    expect(s).toMatchObject({ round: 1, phase: 'delay', roundsDone: 1, mistakes: 0, inputIndex: 0 });
    expect(s.phaseStartMs).toBe(t);
    expect(roundLength(level, s.round)).toBe(4);
  });

  it('out of range pads are ignored', () => {
    const t = inputStart(level, 0);
    let s = mg.step(level, mg.initState(level), null, t);
    s = mg.step(level, s, pad(4), t + 100); // easy has pads 0..3
    s = mg.step(level, s, pad(-1), t + 200);
    expect(s.mistakes).toBe(0);
    expect(s.inputIndex).toBe(0);
  });
});

describe('simon mistakes (mg_simon_scoring)', () => {
  const wrongPad = (level: SimonLevel, i: number) => (((level.sequence[i] as number) + 1) % level.padCount);

  it('a wrong pad is a mistake and repeats the same round from the start', () => {
    const level = mg.generateLevel(ctx(7, 'easy'));
    const t = inputStart(level, 0);
    let s = mg.step(level, mg.initState(level), null, t);
    s = mg.step(level, s, pad(level.sequence[0] as number), t + 200);
    s = mg.step(level, s, pad(wrongPad(level, 1)), t + 400);
    expect(s).toMatchObject({ mistakes: 1, round: 0, phase: 'delay', inputIndex: 0, phaseStartMs: t + 400 });
    expect(s.result).toBeNull();
    // Same prefix again, then input from the first step.
    s = mg.step(level, s, null, t + 400 + 800 + 3 * 850);
    expect(s.phase).toBe('input');
    expect(s.inputIndex).toBe(0);
  });

  it('fails with failLimit when mistakes exceed mistakesAllowed (easy: third mistake)', () => {
    const level = mg.generateLevel(ctx(7, 'easy'));
    let s = mg.initState(level);
    let t = 0;
    for (let m = 0; m < 3; m++) {
      while (s.phase !== 'input') {
        t += 50;
        s = mg.step(level, s, null, t);
      }
      t += 100;
      s = mg.step(level, s, pad(wrongPad(level, 0)), t);
      expect(s.mistakes).toBe(m + 1);
    }
    expect(mg.result(level, s)).toEqual({ passed: false, timeTakenMs: t, progress: 0, reason: 'failLimit' });
  });

  it('hard: the first mistake fails immediately, no replay', () => {
    const level = mg.generateLevel(ctx(7, 'hard'));
    const t = inputStart(level, 0);
    let s = mg.step(level, mg.initState(level), null, t);
    s = mg.step(level, s, pad(wrongPad(level, 0)), t + 250);
    expect(mg.result(level, s)).toMatchObject({ passed: false, reason: 'failLimit', timeTakenMs: t + 250 });
  });

  it('idle for 3 s in the input phase is a mistake (DR-19)', () => {
    const level = mg.generateLevel(ctx(7, 'medium'));
    const t = inputStart(level, 0);
    let s = mg.step(level, mg.initState(level), null, t);
    s = mg.step(level, s, null, t + 2999);
    expect(s.mistakes).toBe(0);
    s = mg.step(level, s, null, t + 3000);
    expect(s).toMatchObject({ mistakes: 1, phase: 'delay', phaseStartMs: t + 3000 });
    expect(s.lastPress).toMatchObject({ idle: true, correct: false });
  });

  it('a correct input restarts the idle timer', () => {
    const level = mg.generateLevel(ctx(7, 'medium'));
    const t = inputStart(level, 0);
    let s = mg.step(level, mg.initState(level), null, t);
    s = mg.step(level, s, pad(level.sequence[0] as number), t + 2500);
    s = mg.step(level, s, null, t + 2500 + 2999);
    expect(s.mistakes).toBe(0);
    s = mg.step(level, s, null, t + 2500 + 3000);
    expect(s.mistakes).toBe(1);
  });

  it('idle on a hard run fails with the time of the idle deadline', () => {
    const level = mg.generateLevel(ctx(7, 'hard'));
    const t = inputStart(level, 0);
    const s = mg.step(level, mg.initState(level), null, t + 10_000);
    expect(mg.result(level, s)).toMatchObject({ reason: 'failLimit', timeTakenMs: t + 3000 });
  });

  it('a big time jump is processed phase by phase (frame-rate independent)', () => {
    const level = mg.generateLevel(ctx(9, 'medium'));
    let fine = mg.initState(level);
    for (let t = 0; t <= 20_000; t += 10) fine = mg.step(level, fine, null, t);
    const jump = mg.step(level, mg.initState(level), null, 20_000);
    expect(jump).toEqual(fine);
    expect(jump.mistakes).toBeGreaterThan(0);
  });
});

describe('simon pass, timeout and progress', () => {
  it.each(['easy', 'medium', 'hard'] as const)('%s: perfect play passes with progress 1 and timeTaken = last input', (d) => {
    for (const seed of SEEDS) {
      const level = mg.generateLevel(ctx(seed, d));
      const { s, lastT } = perfect(level);
      expect(mg.result(level, s)).toEqual({ passed: true, timeTakenMs: lastT, progress: 1, reason: 'success' });
      expect(s.roundsDone).toBe(totalRounds(level));
    }
  });

  it('time budget: a casual perfect run fits comfortably in 30 s', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const level = mg.generateLevel(ctx(1, d));
      const { lastT } = perfect(level, d === 'hard' ? 450 : 600);
      expect(lastT).toBeLessThan(26_000);
    }
  });

  it('times out with progress = rounds done / total rounds', () => {
    const level = mg.generateLevel(ctx(1, 'medium'));
    let t = inputStart(level, 0);
    let s = mg.step(level, mg.initState(level), null, t);
    for (let i = 0; i < 3; i++) {
      t += 100;
      s = mg.step(level, s, pad(level.sequence[i] as number), t);
    }
    expect(s.roundsDone).toBe(1);
    // Stay silent with idle timeouts disabled by a huge value: use a level that never idles out.
    const quiet = { ...level, idleTimeoutMs: 1e9, mistakesAllowed: 99 };
    s = mg.step(quiet, s, null, quiet.durationMs);
    expect(mg.result(quiet, s)).toEqual({ passed: false, timeTakenMs: level.durationMs, progress: 1 / 3, reason: 'timeout' });
    expect(mg.step(quiet, s, pad(0), quiet.durationMs + 1)).toBe(s); // final
  });

  it('input at tMs >= durationMs is ignored; the last correct input before it still passes', () => {
    const level = mg.generateLevel(ctx(1, 'easy'));
    const { lastT } = perfect(level);
    const justFits = { ...level, durationMs: lastT + 1 };
    const tooLate = { ...level, durationMs: lastT };
    expect(mg.result(justFits, perfect(justFits).s)?.passed).toBe(true);
    const r = mg.result(tooLate, perfect(tooLate).s);
    expect(r).toMatchObject({ passed: false, reason: 'timeout' });
  });

  it('step is pure: it never mutates the previous state, and replays identically', () => {
    const level = mg.generateLevel(ctx(3, 'easy'));
    const s0 = mg.initState(level);
    const frozen = structuredClone(s0);
    const t = inputStart(level, 0);
    const play = () => {
      let s = mg.step(level, s0, null, t);
      s = mg.step(level, s, pad(level.sequence[0] as number), t + 200);
      return mg.step(level, s, pad(9), t + 400);
    };
    expect(play()).toEqual(play());
    expect(s0).toEqual(frozen);
  });
});

describe('simon replay (hint modifier)', () => {
  const level = mg.generateLevel(ctx(7, 'medium', [{ kind: 'hint' }]));
  it('replays the current prefix once, no mistake, idle timer restarts', () => {
    const t = inputStart(level, 0);
    let s = mg.step(level, mg.initState(level), null, t);
    s = mg.step(level, s, pad(level.sequence[0] as number), t + 500);
    s = mg.step(level, s, { kind: 'replay' }, t + 1000);
    expect(s).toMatchObject({ phase: 'playback', replayUsed: true, mistakes: 0, inputIndex: 0, phaseStartMs: t + 1000 });
    const end = t + 1000 + playbackMs(level, 0);
    s = mg.step(level, s, null, end);
    expect(s).toMatchObject({ phase: 'input', inputIndex: 0, lastActivityMs: end });
    s = mg.step(level, s, { kind: 'replay' }, end + 10); // once per minigame
    expect(s.phase).toBe('input');
  });

  it('is ignored without the hint modifier', () => {
    const plain = mg.generateLevel(ctx(7, 'medium'));
    const t = inputStart(plain, 0);
    let s = mg.step(plain, mg.initState(plain), null, t);
    s = mg.step(plain, s, { kind: 'replay' }, t + 10);
    expect(s.phase).toBe('input');
    expect(s.replayUsed).toBe(false);
  });
});
