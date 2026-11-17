/**
 * One player interface for humans and bots (B2): a controller looks at the state and may
 * return an action. The session polls every controller each logic step. Humans return what
 * input/UI queued; bots decide themselves. A network client later is just another controller.
 */
import type { GameAction } from './actions';
import type { Difficulty, MapGraph } from './map';
import type { MinigameModifier } from './minigames/types';
import { BOT_MODIFIER_POINTS, BOT_PASS_CHANCE, BOT_PASS_MAX, BOT_PASS_MIN, type BotProfile } from './botProfiles';
import type { BotLevel, GameState } from './state';

export interface PlayerController {
  readonly playerId: string;
  /** Called once per logic step, after time advanced. Return null to do nothing. */
  nextAction(state: Readonly<GameState>, map: MapGraph): GameAction | null;
  /**
   * Optional hint for headless simulation: the game time of the next poll that could do anything
   * (a lower bound; `state.timeMs` or less means "poll me at the next step"). Controllers without
   * it are polled every step.
   */
  wakeAtMs?(state: Readonly<GameState>, map: MapGraph): number;
  /** Optional: what a waiting bot is doing, for the HUD ("thinking", "braking"). */
  activity?(): BotActivity | null;
}

/** A bot that waits on purpose: reading the screen / weighing a route, or holding back as leader. */
export type BotActivity = 'thinking' | 'braking';

/** Human: actions come from input/UI via submit(); polled FIFO, one per step. */
export class HumanController implements PlayerController {
  private queue: GameAction[] = [];

  constructor(readonly playerId: string) {}

  submit(action: GameAction): void {
    this.queue.push(action);
  }

  nextAction(): GameAction | null {
    return this.queue.shift() ?? null;
  }

  clear(): void {
    this.queue.length = 0;
  }
}

export { BOT_MODIFIER_POINTS, BOT_PASS_CHANCE, BOT_PASS_MAX, BOT_PASS_MIN, BOT_TIME_RANGE } from './botProfiles';

/** Pass chance for a profile: its difficulty table plus +-points per modifier kind, clamped (cards.md §3.2.1). */
export function passChanceFor(profile: Pick<BotProfile, 'passChance' | 'modifierPoints' | 'passMin' | 'passMax'>, difficulty: Difficulty, modifiers: readonly MinigameModifier[]): number {
  let chance: number = profile.passChance[difficulty];
  const pts = profile.modifierPoints;
  for (const m of modifiers) {
    switch (m.kind) {
      case 'timeDelta': chance += Math.sign(m.seconds) * pts; break;
      case 'tolerance': chance += Math.sign(m.mult - 1) * pts; break;
      case 'speed': chance -= Math.sign(m.mult - 1) * pts; break;
      case 'extraTarget': chance -= Math.sign(m.count) * pts; break;
      case 'fog': chance -= pts; break;
      case 'hint': chance += pts; break;
    }
  }
  return Math.min(profile.passMax, Math.max(profile.passMin, chance));
}

/**
 * Pass chance of a bot attempt: the level/difficulty table (effective difficulty, so
 * difficultyShift is already in) plus +-8 points per modifier kind, clamped to 5-98% (cards.md §3.2.1).
 * Easier for the bot: timeDelta > 0, tolerance > 1, hint, speed < 1. Harder: timeDelta < 0,
 * speed > 1, extraTarget > 0, fog.
 */
export function botPassChance(level: BotLevel, difficulty: Difficulty, modifiers: readonly MinigameModifier[]): number {
  return passChanceFor({ passChance: BOT_PASS_CHANCE[level], modifierPoints: BOT_MODIFIER_POINTS, passMin: BOT_PASS_MIN, passMax: BOT_PASS_MAX }, difficulty, modifiers);
}
