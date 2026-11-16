/**
 * Simon (`simon`), pure rules. Spec: minigames.md §3.
 * Watch a growing colour sequence, then repeat it. Everything is derived from game time:
 * delay -> playback -> input per round; a mistake replays the same round.
 */
import type { Difficulty } from '../map';
import { Rng } from '../rng';
import type { MinigameContext, MinigameLogic, MinigameResult } from './types';

export const SIMON_BASE_MS = 30_000;
export const SIMON_KNOBS: Readonly<Record<Difficulty, {
  padCount: number;
  startLength: number;
  targetLength: number;
  flashMs: number;
  gapMs: number;
  mistakesAllowed: number;
}>> = {
  easy: { padCount: 4, startLength: 3, targetLength: 4, flashMs: 700, gapMs: 150, mistakesAllowed: 2 },
  medium: { padCount: 4, startLength: 3, targetLength: 5, flashMs: 550, gapMs: 150, mistakesAllowed: 1 },
  hard: { padCount: 6, startLength: 3, targetLength: 6, flashMs: 400, gapMs: 150, mistakesAllowed: 0 },
};
export const SIMON_ROUND_DELAY_MS = 800;
export const SIMON_IDLE_TIMEOUT_MS = 3000;
export const SIMON_IDLE_MAX_MS = 6000;
export const SIMON_MIN_FLASH_MS = 200;
export const SIMON_MIN_GAP_MS = 80;
export const SIMON_MAX_EXTRA = 2;
export const SIMON_EXTRA_MS_PER_COUNT = 4000;
export const SIMON_TOLERANCE_BONUS_MULT = 1.3;
/** Minimum time a pressed pad stays lit (view feedback). */
export const SIMON_PRESS_LIT_MS = 150;

export interface SimonLevel {
  durationMs: number;
  padCount: number;
  startLength: number;
  targetLength: number;
  sequence: number[];
  flashMs: number;
  gapMs: number;
  roundDelayMs: number;
  idleTimeoutMs: number;
  mistakesAllowed: number;
  replayAvailable: boolean;
  fog: boolean;
  warnings: string[];
}

export type SimonInput = { kind: 'pad'; pad: number } | { kind: 'replay' };

export type SimonPhase = 'delay' | 'playback' | 'input';

export interface SimonState {
  tMs: number;
  /** Round index, 0-based; the round uses sequence[0 .. startLength + round). */
  round: number;
  phase: SimonPhase;
  /** When the current phase began (play time). */
  phaseStartMs: number;
  /** Correct inputs so far this round. */
  inputIndex: number;
  /** Idle timer reference: input phase start or last correct input. */
  lastActivityMs: number;
  mistakes: number;
  roundsDone: number;
  replayUsed: boolean;
  /** Last pad press or mistake, for view feedback. */
  lastPress: { tMs: number; pad: number | null; correct: boolean; idle: boolean } | null;
  result: MinigameResult | null;
}

export function roundLength(level: SimonLevel, round: number): number {
  return level.startLength + round;
}
export function totalRounds(level: SimonLevel): number {
  return level.targetLength - level.startLength + 1;
}
export function stepPeriodMs(level: SimonLevel): number {
  return level.flashMs + level.gapMs;
}
export function playbackMs(level: SimonLevel, round: number): number {
  return roundLength(level, round) * stepPeriodMs(level);
}

/** Pad lit by the playback at time tMs (null outside playback or in a gap). */
export function playbackPad(level: SimonLevel, state: SimonState, tMs: number): number | null {
  if (state.phase !== 'playback') return null;
  const local = tMs - state.phaseStartMs;
  if (local < 0) return null;
  const period = stepPeriodMs(level);
  const idx = Math.floor(local / period);
  if (idx >= roundLength(level, state.round)) return null;
  return local - idx * period < level.flashMs ? (level.sequence[idx] as number) : null;
}

function progressOf(level: SimonLevel, s: SimonState): number {
  return Math.min(1, s.roundsDone / totalRounds(level));
}

function mistake(level: SimonLevel, s: SimonState, at: number, pad: number | null, idle: boolean): void {
  s.mistakes += 1;
  s.lastPress = { tMs: at, pad, correct: false, idle };
  if (s.mistakes > level.mistakesAllowed) {
    s.result = { passed: false, timeTakenMs: at, progress: progressOf(level, s), reason: 'failLimit' };
    return;
  }
  // Same round again from the start.
  s.phase = 'delay';
  s.phaseStartMs = at;
  s.inputIndex = 0;
}

/** Process time-driven transitions up to (and including) `to`. Mutates s. */
function advanceTo(level: SimonLevel, s: SimonState, to: number): void {
  for (let guard = 0; guard < 10_000 && !s.result; guard++) {
    if (s.phase === 'delay') {
      const end = s.phaseStartMs + level.roundDelayMs;
      if (end > to) break;
      s.phase = 'playback';
      s.phaseStartMs = end;
    } else if (s.phase === 'playback') {
      const end = s.phaseStartMs + playbackMs(level, s.round);
      if (end > to) break;
      s.phase = 'input';
      s.phaseStartMs = end;
      s.inputIndex = 0;
      s.lastActivityMs = end;
    } else {
      const deadline = s.lastActivityMs + level.idleTimeoutMs;
      if (deadline > to) break;
      mistake(level, s, deadline, null, true); // DR-19: idle counts as a mistake
    }
  }
  s.tMs = s.result ? s.result.timeTakenMs : to; // a finished run stays at its finishing time
}

export const simonLogic: MinigameLogic<SimonLevel, SimonInput, SimonState> = {
  id: 'simon',
  render: '2d',
  introKey: 'mg.simon.intro',
  baseDurationMs: SIMON_BASE_MS,

  generateLevel(ctx: MinigameContext): SimonLevel {
    const rng = new Rng(ctx.seed);
    const k = SIMON_KNOBS[ctx.difficulty];
    let durationMs = SIMON_BASE_MS;
    let idle = SIMON_IDLE_TIMEOUT_MS;
    let mistakesAllowed = k.mistakesAllowed;
    let toleranceBonus = false;
    let speedMult = 1;
    let extra = 0;
    let fog = false;
    let hint = false;
    const warnings: string[] = [];
    for (const m of ctx.modifiers) {
      switch (m.kind) {
        case 'timeDelta': durationMs += m.seconds * 1000; break;
        case 'tolerance':
          idle = Math.min(idle * m.mult, SIMON_IDLE_MAX_MS);
          if (m.mult >= SIMON_TOLERANCE_BONUS_MULT) toleranceBonus = true;
          break;
        case 'speed': speedMult *= m.mult; break;
        case 'extraTarget': extra = Math.min(extra + m.count, SIMON_MAX_EXTRA); break;
        case 'fog': fog = true; break;
        case 'hint': hint = true; break;
        default: warnings.push(`simon: ignored modifier ${JSON.stringify(m)}`);
      }
    }
    if (toleranceBonus) mistakesAllowed += 1; // once, does not stack
    durationMs += extra * SIMON_EXTRA_MS_PER_COUNT; // outside the race-layer clamp (DR-17)
    const targetLength = k.targetLength + extra;

    // Drawn sequentially, so a longer run shares its prefix with a shorter one for the same seed.
    const sequence: number[] = [];
    for (let i = 0; i < targetLength; i++) {
      let pad = rng.int(0, k.padCount - 1);
      const a = sequence[i - 1];
      const b = sequence[i - 2];
      if (a !== undefined && a === b) {
        let tries = 0;
        while (pad === a && tries++ < 200) pad = rng.int(0, k.padCount - 1);
        if (pad === a) pad = (a + 1) % k.padCount; // unreachable in practice
      }
      sequence.push(pad);
    }

    return {
      durationMs,
      padCount: k.padCount,
      startLength: k.startLength,
      targetLength,
      sequence,
      flashMs: Math.max(SIMON_MIN_FLASH_MS, k.flashMs / speedMult),
      gapMs: Math.max(SIMON_MIN_GAP_MS, k.gapMs / speedMult),
      roundDelayMs: SIMON_ROUND_DELAY_MS,
      idleTimeoutMs: idle,
      mistakesAllowed,
      replayAvailable: hint,
      fog,
      warnings,
    };
  },

  initState(): SimonState {
    return {
      tMs: 0,
      round: 0,
      phase: 'delay',
      phaseStartMs: 0,
      inputIndex: 0,
      lastActivityMs: 0,
      mistakes: 0,
      roundsDone: 0,
      replayUsed: false,
      lastPress: null,
      result: null,
    };
  },

  step(level, prev, input, tMs) {
    if (prev.result) return prev;
    const t = Math.max(tMs, prev.tMs);
    const s: SimonState = { ...prev };
    advanceTo(level, s, Math.min(t, level.durationMs));
    if (s.result) return s;
    if (t >= level.durationMs) {
      s.tMs = level.durationMs;
      s.result = { passed: false, timeTakenMs: level.durationMs, progress: progressOf(level, s), reason: 'timeout' };
      return s;
    }
    s.tMs = t;
    if (!input || s.phase !== 'input') return s; // taps during playback / round delay are ignored

    if (input.kind === 'replay') {
      if (level.replayAvailable && !s.replayUsed) {
        s.replayUsed = true;
        s.phase = 'playback';
        s.phaseStartMs = t;
        s.inputIndex = 0;
      }
      return s;
    }

    if (!Number.isInteger(input.pad) || input.pad < 0 || input.pad >= level.padCount) return s;
    if (input.pad === level.sequence[s.inputIndex]) {
      s.inputIndex += 1;
      s.lastActivityMs = t;
      s.lastPress = { tMs: t, pad: input.pad, correct: true, idle: false };
      if (s.inputIndex >= roundLength(level, s.round)) {
        s.roundsDone += 1;
        if (roundLength(level, s.round) >= level.targetLength) {
          s.result = { passed: true, timeTakenMs: t, progress: 1, reason: 'success' };
          return s;
        }
        s.round += 1;
        s.phase = 'delay';
        s.phaseStartMs = t;
        s.inputIndex = 0;
      }
    } else {
      mistake(level, s, t, input.pad, false);
    }
    return s;
  },

  result(_level, state) {
    return state.result;
  },
};
