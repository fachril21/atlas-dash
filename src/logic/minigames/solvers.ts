/**
 * Perfect-player solvers for the CP5b minigames (pure). They read the generated level (which
 * carries everything a player would eventually learn, plus `targets[i].ideal`) and return a
 * timed input script. Used by unit tests, QA and e2e smoke tests; never by the shipping game.
 */
import type { GuessInput, GuessLevel } from './guessLocation';
import type { MemoryInput, MemoryLevel } from './memoryMatch';
import { SLING_RELOAD_MS, simulateShot, targetOffsetX, groundTimeSec, type SlingAim, type SlingLevel } from './slingshot';
import type { WhackInput, WhackLevel } from './whackAMole';
import type { MinigameLogic } from './types';

export interface TimedInput<I> {
  tMs: number;
  input: I;
}

/** Whack: hit every target spawn shortly after it appears, until enough are down. */
export function whackPerfectScript(level: WhackLevel, reactionMs = 20): TimedInput<WhackInput>[] {
  const out: TimedInput<WhackInput>[] = [];
  for (const s of level.spawns) {
    if (s.kind !== 'target') continue;
    if (out.length >= level.hitsRequired) break;
    out.push({ tMs: s.tMs + reactionMs, input: { hole: s.hole } });
  }
  return out;
}

/** Memory: wait for the preview, then open each pair in turn. */
export function memoryPerfectScript(level: MemoryLevel, gapMs = 120): TimedInput<MemoryInput>[] {
  const positions = new Map<string, number[]>();
  level.cards.forEach((icon, i) => positions.set(icon, [...(positions.get(icon) ?? []), i]));
  const out: TimedInput<MemoryInput>[] = [];
  let t = level.previewMs + 50;
  for (const [, [a, b]] of positions) {
    out.push({ tMs: t, input: { card: a as number } });
    t += gapMs;
    out.push({ tMs: t, input: { card: b as number } });
    t += gapMs;
  }
  return out;
}

/** Guess: answer correctly shortly after each question appears (the next one starts gapMs later). */
export function guessPerfectScript(level: GuessLevel, reactionMs = 50): TimedInput<GuessInput>[] {
  const out: TimedInput<GuessInput>[] = [];
  let qStart = 0;
  for (let q = 0; q < level.questions; q++) {
    const item = level.items[q];
    if (!item) break;
    const at = qStart + reactionMs;
    out.push({ tMs: at, input: { choice: item.choices.indexOf(item.correctRegionId) } });
    qStart = at + level.gapMs;
  }
  return out;
}

/**
 * Slingshot: shoot the ideal aim of whichever target can be hit now (static targets at once,
 * moving ones when their offset lines up), until enough are down or the bullets run out.
 */
export function slingshotPerfectScript(level: SlingLevel, opts: { stepMs?: number; maxWaitMs?: number } = {}): TimedInput<SlingAim>[] {
  const stepMs = opts.stepMs ?? 20;
  const maxWaitMs = opts.maxWaitMs ?? 14_000;
  const out: TimedInput<SlingAim>[] = [];
  const down: number[] = [];
  // Static targets first, then the moving ones.
  const order = level.targets.map((_, i) => i).sort((a, b) => Number(a < level.movingCount) - Number(b < level.movingCount) || a - b);
  let ready = 0;
  while (down.length < level.targetsRequired && out.length < level.bullets) {
    let fired = false;
    for (let t = ready; t <= ready + maxWaitMs && t < level.durationMs && !fired; t += stepMs) {
      for (const i of order) {
        if (down.includes(i)) continue;
        const tg = level.targets[i]!;
        const aim: SlingAim = { yawDeg: tg.ideal.yawDeg, power: tg.ideal.power };
        if (i < level.movingCount) {
          // Cheap pre-check: is the target near its centre when the ideal shot arrives?
          const impactMs = t + tg.ideal.tFrac * groundTimeSec(aim.power) * 1000;
          if (Math.abs(targetOffsetX(level, i, impactMs)) > level.hitRadiusM) continue;
        }
        const shot = simulateShot(level, aim, t, down);
        if (shot.hitIndex === null) continue;
        out.push({ tMs: t, input: aim });
        down.push(shot.hitIndex);
        ready = t + shot.flightMs + SLING_RELOAD_MS;
        fired = true;
        break;
      }
    }
    if (!fired) break;
  }
  return out;
}

export interface RunOutcome<S> {
  state: S;
  result: ReturnType<MinigameLogic<any, any, S>['result']>;
}

/**
 * Feed a timed script into a minigame's pure `step`, then keep stepping with no input until it
 * finishes or `endMs` passes (so timeouts and landing bullets resolve). Inputs after the run is
 * over are dropped, like the shell would.
 */
export function runScript<L, I, S>(logic: MinigameLogic<L, I, S>, level: L, script: readonly TimedInput<I>[], endMs: number): RunOutcome<S> {
  let state = logic.initState(level);
  for (const s of script) {
    if (logic.result(level, state)) break;
    state = logic.step(level, state, s.input, s.tMs);
  }
  for (let t = script.length > 0 ? (script[script.length - 1] as TimedInput<I>).tMs : 0; t <= endMs && !logic.result(level, state); t += 250) {
    state = logic.step(level, state, null, t);
  }
  if (!logic.result(level, state)) state = logic.step(level, state, null, endMs);
  return { state, result: logic.result(level, state) };
}
