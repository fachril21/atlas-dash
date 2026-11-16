/**
 * One player interface for humans and bots (B2): a controller looks at the state and
 * may return an action. The session polls every controller each update; humans return
 * whatever the input/UI queued, bots decide on their own. A future network client is just
 * another controller.
 */
import type { GameAction } from './actions';
import type { MapGraph } from './map';
import { legalMoves } from './movement';
import { Rng } from './rng';
import type { BotLevel, GameState } from './state';
import { getPlayer } from './state';

export interface PlayerController {
  readonly playerId: string;
  /** Called once per session update, after time has advanced. Return null to do nothing. */
  nextAction(state: Readonly<GameState>, map: MapGraph): GameAction | null;
}

/** Human: actions come from input/UI via submit(); polled FIFO, one per update. */
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

/** Placeholder win rates per bot level; replaced by the minigame-aware bot AI later. */
const BOT_WIN_CHANCE: Readonly<Record<BotLevel, number>> = { easy: 0.45, normal: 0.6, hard: 0.75 };

/**
 * PLACEHOLDER bot: picks a random legal route and "plays" each minigame by waiting a
 * random time, then rolling a win chance. Deterministic for a given seed.
 */
export class PlaceholderBotController implements PlayerController {
  private readonly rng: Rng;
  /** Game time at which the bot's current think/play delay ends; null = idle. */
  private busyUntilMs: number | null = null;

  constructor(
    readonly playerId: string,
    seed: number,
    private readonly level: BotLevel = 'normal',
  ) {
    this.rng = new Rng(seed).fork(`bot:${playerId}`);
  }

  nextAction(state: Readonly<GameState>, map: MapGraph): GameAction | null {
    const me = getPlayer(state as GameState, this.playerId);
    if (!me || state.status !== 'running') return null;
    if (me.phase !== 'ready' && me.phase !== 'challenge') {
      this.busyUntilMs = null;
      return null;
    }
    if (this.busyUntilMs === null) {
      const delay = me.phase === 'ready' ? this.rng.int(600, 1500) : this.rng.int(3000, 7000);
      this.busyUntilMs = state.timeMs + delay;
      return null;
    }
    if (state.timeMs < this.busyUntilMs) return null;
    this.busyUntilMs = null;

    if (me.phase === 'ready') {
      const moves = legalMoves(map, me);
      if (moves.length === 0) return null;
      return { type: 'move', playerId: me.id, toNodeId: this.rng.pick(moves) };
    }
    return { type: 'challengeResult', playerId: me.id, success: this.rng.chance(BOT_WIN_CHANCE[this.level]) };
  }
}
