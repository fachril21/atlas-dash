/**
 * Actions are the only way state changes. Humans (via input/UI), bots and, later, the
 * network all produce the same GameAction values; the reducer answers with GameEvents.
 */
import type { Difficulty } from './map';
import type { MoveRejectReason } from './movement';

export type GameAction =
  | { type: 'tick'; dtMs: number }
  | { type: 'move'; playerId: string; toNodeId: string }
  /**
   * Result of the current region's minigame. Placeholder until the minigame system exists;
   * the real minigames will dispatch this same action.
   */
  | { type: 'challengeResult'; playerId: string; success: boolean };

export type RejectReason = MoveRejectReason | 'unknown-player' | 'game-over' | 'not-in-challenge' | 'bad-tick';

export type GameEvent =
  | { type: 'playerMoved'; playerId: string; from: string; to: string }
  | { type: 'challengeStarted'; playerId: string; nodeId: string; difficulty: Difficulty }
  | { type: 'challengeResolved'; playerId: string; nodeId: string; success: boolean; cooldownMs: number }
  | { type: 'cooldownEnded'; playerId: string; nodeId: string }
  | { type: 'playerFinished'; playerId: string; nodeId: string; place: number }
  | { type: 'gameOver'; winnerId: string }
  | { type: 'actionRejected'; action: GameAction; reason: RejectReason };
