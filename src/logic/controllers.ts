/**
 * One player interface for humans and bots (B2): a controller looks at the state and may
 * return an action. The session polls every controller each logic step. Humans return what
 * input/UI queued; bots decide themselves. A network client later is just another controller.
 */
import type { GameAction } from './actions';
import type { Difficulty, MapGraph } from './map';
import { getMinigameLogic } from './minigames';
import { canStartAttempt, selectableTargets } from './reducer';
import { createStream, type Rng } from './rng';
import { getPlayer, RESULT_BANNER_MS, type BotLevel, type GameState } from './state';

export interface PlayerController {
  readonly playerId: string;
  /** Called once per logic step, after time advanced. Return null to do nothing. */
  nextAction(state: Readonly<GameState>, map: MapGraph): GameAction | null;
}

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

/** Pass chance per bot level and difficulty (gdd.md, Bot table). */
export const BOT_PASS_CHANCE: Readonly<Record<BotLevel, Record<Difficulty, number>>> = {
  easy: { easy: 0.7, medium: 0.5, hard: 0.3 },
  normal: { easy: 0.85, medium: 0.65, hard: 0.45 },
  hard: { easy: 0.92, medium: 0.8, hard: 0.65 },
};
/** Fraction of the minigame duration a passing attempt takes (gdd.md, Bot table). */
export const BOT_TIME_RANGE: Readonly<Record<BotLevel, [number, number]>> = {
  easy: [0.85, 1.0],
  normal: [0.7, 0.95],
  hard: [0.55, 0.85],
};
/** Placeholder think time before selecting a target / pressing Mulai. */
const BOT_THINK_MS: [number, number] = [600, 1500];

/**
 * PLACEHOLDER bot (CP3a): random legal target, presses Mulai when allowed, and rolls the
 * attempt from its own "bot" stream. Smart routing and cards come in CP4/CP5.
 */
export class PlaceholderBotController implements PlayerController {
  private readonly rng: Rng;
  /** Game time when the current think/play delay ends; null = no pending decision. */
  private readyAtMs: number | null = null;
  private pendingResult: { passed: boolean; timeTakenMs: number } | null = null;

  constructor(
    readonly playerId: string,
    matchSeed: number,
    private readonly level: BotLevel = 'normal',
  ) {
    this.rng = createStream(matchSeed, playerId, 'bot');
  }

  nextAction(state: Readonly<GameState>, map: MapGraph): GameAction | null {
    const me = getPlayer(state, this.playerId);
    if (!me || state.status !== 'running' || me.phase === 'finished') return null;

    // CP4a: bots take card offers and discard by the auto rules; they never play cards (CP5).
    if (me.offer || me.discard) return { type: 'autoCards', playerId: me.id };

    if (me.phase === 'playing' && me.attempt) {
      if (!this.pendingResult) {
        // Decide the whole attempt up front: outcome + how long it takes.
        const d = me.attempt.difficulty;
        const base = getMinigameLogic(me.attempt.minigameId).baseDurationMs;
        const passed = this.rng.chance(BOT_PASS_CHANCE[this.level][d]);
        const [lo, hi] = passed ? BOT_TIME_RANGE[this.level] : [0.4, 1.0];
        const timeTakenMs = Math.round(base * this.rng.range(lo, hi));
        this.pendingResult = { passed, timeTakenMs };
        this.readyAtMs = me.attempt.startedAtMs + me.attempt.introMs + timeTakenMs + RESULT_BANNER_MS;
      }
      if (state.timeMs < (this.readyAtMs ?? 0)) return null;
      const r = this.pendingResult;
      this.pendingResult = null;
      this.readyAtMs = null;
      return { type: 'minigameResult', playerId: me.id, passed: r.passed, timeTakenMs: r.timeTakenMs };
    }

    // Idle: think, then pick a target or press Mulai.
    if (this.readyAtMs === null) {
      this.readyAtMs = state.timeMs + this.rng.int(BOT_THINK_MS[0], BOT_THINK_MS[1]);
      return null;
    }
    if (state.timeMs < this.readyAtMs) return null;
    if (!me.targetId) {
      this.readyAtMs = null;
      const options = selectableTargets(map, state, me);
      return options.length > 0 ? { type: 'selectTarget', playerId: me.id, targetId: this.rng.pick(options) } : null;
    }
    if (canStartAttempt(state, me) === null) {
      this.readyAtMs = null;
      return { type: 'startAttempt', playerId: me.id };
    }
    return null; // cooling down: keep waiting
  }
}
