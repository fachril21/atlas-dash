/**
 * What a bot may know (bots.md §2, DR-33): only what a human sees on screen. The controller never
 * hands raw GameState to its decision code; it hands an Observation made here. The observed state
 * is still a structurally valid GameState, so the same validators the UI uses (`cardPlayability`,
 * `sabotagePlayability`, `selectableTargets`, ...) run on it unchanged.
 *
 * Scrubbed (never readable by a bot decision):
 * - own `nextMinigameId` before Mulai, every RNG stream state, `matchSeed`, the own discard pile;
 * - for each opponent: the hand contents (only the count survives), boost / defence cards in
 *   `pending`, `targetId`, `winsAtTarget`, running attempt, offer / discard screens, rng states.
 * Kept on purpose (the documented "Sudah kena kartu ini" leak): an opponent's pending sabotage
 * cards, because the validator needs them to tell a full / already-stacked target.
 */
import { getCard } from './cards';
import { holdsSlot } from './sabotage';
import type { CardInstance, GameState, PlayerState } from './state';

/** defId of the placeholder that stands for an unseen opponent card. Not a real card on purpose. */
export const HIDDEN_CARD_ID = '?';

const ZERO_RNG = [0, 0, 0, 0] as const;

export interface Observation {
  readonly selfId: string;
  /** Scrubbed copy of the state (see above). Never mutated. */
  readonly state: Readonly<GameState>;
  readonly me: Readonly<PlayerState>;
}

function hiddenHand(count: number): CardInstance[] {
  return Array.from({ length: count }, (_, i) => ({ uid: `?${i}`, defId: HIDDEN_CARD_ID, seq: i + 1 }));
}

function scrubSelf(p: PlayerState): PlayerState {
  return { ...p, nextMinigameId: null, pickRng: ZERO_RNG, cardsRng: ZERO_RNG, copetRng: ZERO_RNG, discarded: [] };
}

function scrubOpponent(p: PlayerState): PlayerState {
  return {
    ...p,
    targetId: null,
    winsAtTarget: 0,
    nextMinigameId: null,
    retry: false,
    lastMinigameId: null,
    attempts: {},
    attempt: null,
    pickRng: ZERO_RNG,
    cardsRng: ZERO_RNG,
    copetRng: ZERO_RNG,
    hand: hiddenHand(p.hand.length),
    nextHandSeq: 1,
    // Only the sabotage slots are public, and only for the validators (no sender, no card detail).
    pending: p.pending.filter((c) => holdsSlot(getCard(c.defId))).map(({ uid, defId, seq }) => ({ uid, defId, seq })),
    discarded: [],
    offer: null,
    discard: null,
  };
}

export function observe(state: Readonly<GameState>, selfId: string): Observation {
  const players = state.players.map((p) => (p.id === selfId ? scrubSelf(p) : scrubOpponent(p)));
  const scrubbed: GameState = { ...state, matchSeed: 0, nextCardUid: 0, players };
  return { selfId, state: scrubbed, me: players.find((p) => p.id === selfId) as PlayerState };
}

/** Opponents in seat order. */
export function opponentsOf(obs: Observation): readonly Readonly<PlayerState>[] {
  return obs.state.players.filter((p) => p.id !== obs.selfId);
}
