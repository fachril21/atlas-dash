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
  | { type: 'minigameResult'; playerId: string; passed: boolean; timeTakenMs?: number }
  /** Play a card from the hand (CP4a: boost cards only). */
  | { type: 'playCard'; playerId: string; cardUid: string }
  /** Toggle a mark on the pick screen (card to take) or the discard screen (card to drop). */
  | { type: 'markCard'; playerId: string; cardUid: string }
  /** "Ambil" / "Buang": needs exactly N (or the overflow count) marked. */
  | { type: 'confirmCards'; playerId: string }
  /** Resolve the open card screen with the auto-pick / auto-discard rule (timeouts, bots, QA). */
  | { type: 'autoCards'; playerId: string }
  /** DEBUG ONLY (QA hooks): put a card in the hand. */
  | { type: 'debugGrantCard'; playerId: string; cardId: string }
  /** DEBUG ONLY (QA hooks): empty the hand (cards go to discarded). */
  | { type: 'debugClearHand'; playerId: string }
  /** DEBUG ONLY (QA hooks): open an offer now, optionally with fixed card ids and pick count. */
  | { type: 'debugForceOffer'; playerId: string; cardIds?: string[]; pick?: number };

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
  | 'not-playing'
  | 'cards-open'
  | 'no-card'
  | 'card-unplayable'
  | 'no-cards-screen'
  | 'bad-selection'
  | 'unknown-card';

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
  | { type: 'cardOffered'; playerId: string; cardIds: string[]; pick: number }
  | { type: 'cardsPicked'; playerId: string; cardIds: string[]; auto: boolean }
  | { type: 'discardRequired'; playerId: string; count: number }
  | { type: 'cardsDiscarded'; playerId: string; cardIds: string[]; auto: boolean }
  | { type: 'cardPlayed'; playerId: string; uid: string; cardId: string }
  | { type: 'cardsSpent'; playerId: string; cardIds: string[]; effective: boolean }
  | { type: 'handChanged'; playerId: string }
  | { type: 'pendingEffectsChanged'; playerId: string }
  | { type: 'progressChanged'; playerId: string; remainingWins: number }
  | { type: 'playerFinished'; playerId: string; regionId: string; place: number }
  | { type: 'gameOver'; winnerId: string }
  | { type: 'actionRejected'; action: GameAction; reason: RejectReason };
