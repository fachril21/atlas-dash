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
  /**
   * Play a card from the hand. Sabotage cards with target `opponent` need `targetId`
   * (validated again here, cards.md §2.2.1(c)); `all_opponents` and self cards ignore it.
   */
  | { type: 'playCard'; playerId: string; cardUid: string; targetId?: string }
  /** Toggle a mark on the pick screen (card to take) or the discard screen (card to drop). */
  | { type: 'markCard'; playerId: string; cardUid: string }
  /** "Ambil" / "Buang": needs exactly N (or the overflow count) marked. */
  | { type: 'confirmCards'; playerId: string }
  /**
   * One atomic answer to the open card screen (bots, DR-32 / bots.md §6): exactly N offer cards to
   * take, or exactly the overflow count of hand cards to drop. Marks are ignored.
   */
  | { type: 'chooseCards'; playerId: string; cardUids: string[] }
  /** Resolve the open card screen with the auto-pick / auto-discard rule (timeouts, bots, QA). */
  | { type: 'autoCards'; playerId: string }
  /** DEBUG ONLY (QA hooks): put a card in the hand. */
  | { type: 'debugGrantCard'; playerId: string; cardId: string }
  /** DEBUG ONLY (QA hooks): empty the hand (cards go to discarded). */
  | { type: 'debugClearHand'; playerId: string }
  /** DEBUG ONLY (QA hooks): open an offer now, optionally with fixed card ids and pick count. */
  | { type: 'debugForceOffer'; playerId: string; cardIds?: string[]; pick?: number };

/**
 * - landed: pending on the target. blocked: Payung ate it. reflected: pending on the sender.
 * - reflectBurned: reflected but the sender was full / at maxStacks.
 * - stolen: Copet took a card. reflectStolen / reflectEmpty: the Cermin owner stole from the sender
 *   (or the sender's hand was empty).
 */
export type SabotageOutcome = 'landed' | 'blocked' | 'reflected' | 'reflectBurned' | 'stolen' | 'reflectStolen' | 'reflectEmpty';

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
  | 'bad-target'
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
  | {
      type: 'sabotagePlayed';
      senderId: string;
      /** The opponent the card was aimed at (for a reflection, the Cermin owner). */
      targetId: string;
      cardId: string;
      outcome: SabotageOutcome;
    }
  | { type: 'cardStolen'; thiefId: string; victimId: string; cardId: string; uid: string; reflected: boolean }
  /** The discard screen closed because a steal made it unnecessary (DR-27). */
  | { type: 'discardCancelled'; playerId: string }
  | { type: 'cardsSpent'; playerId: string; cardIds: string[]; effective: boolean }
  | { type: 'handChanged'; playerId: string }
  | { type: 'pendingEffectsChanged'; playerId: string }
  | { type: 'progressChanged'; playerId: string; remainingWins: number }
  | { type: 'playerFinished'; playerId: string; regionId: string; place: number }
  | { type: 'gameOver'; winnerId: string }
  | { type: 'actionRejected'; action: GameAction; reason: RejectReason };
