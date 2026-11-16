/**
 * Actions are the only way state changes. Human input, bots, test hooks and (later) the
 * network all produce the same GameAction values; the reducer answers with GameEvents.
 */
import type { Attempt } from './state';

export type GameAction =
  | { type: 'tick'; dtMs: number }
  /** Choose an outgoing neighbour as target (allowed during cooldown; partial wins are lost). */
  | { type: 'selectTarget'; playerId: string; targetId: string }
  /** The "Mulai" button: start an attempt on the current target. */
  | { type: 'startAttempt'; playerId: string }
  /** Outcome of the running attempt (from the minigame host, bot simulation or a test hook). */
  | { type: 'minigameResult'; playerId: string; passed: boolean; timeTakenMs?: number };

export type RejectReason =
  | 'bad-tick'
  | 'unknown-player'
  | 'game-over'
  | 'player-finished'
  | 'busy'
  | 'unknown-region'
  | 'not-adjacent'
  | 'finish-not-playable'
  | 'already-target'
  | 'no-target'
  | 'cooldown'
  | 'not-playing';

export type GameEvent =
  | { type: 'targetSelected'; playerId: string; targetId: string; minigameId: string; lostWins: number }
  | { type: 'attemptStarted'; playerId: string; attempt: Attempt }
  | {
      type: 'attemptResolved';
      playerId: string;
      targetId: string;
      minigameId: string;
      passed: boolean;
      winsAtTarget: number;
      cooldownMs: number;
      timeTakenMs: number | null;
    }
  | { type: 'regionConquered'; playerId: string; from: string; to: string }
  | { type: 'cooldownEnded'; playerId: string }
  | { type: 'progressChanged'; playerId: string; remainingWins: number }
  | { type: 'playerFinished'; playerId: string; regionId: string; place: number }
  | { type: 'gameOver'; winnerId: string }
  | { type: 'actionRejected'; action: GameAction; reason: RejectReason };
