/**
 * Card zone mutations (cards.md §2.2-§3.4). Every function here mutates a state that the reducer
 * already cloned, and pushes GameEvents. Zones: hand, limbo (a card while it is being played, never
 * stored), pending, discarded, offer. Each card instance is in exactly one zone at all times.
 */
import type { GameEvent, SabotageOutcome } from './actions';
import { getCard, offerPool, type CardDef } from './cards';
import { autoDiscard, autoPick, buildOffer, CARD_SCREEN_MS, comebackGap, HAND_MAX, tierWeights } from './offers';
import { Rng } from './rng';
import { activeDefense, copiesPending, defenseOp, isCopet, SABOTAGE_SLOT_CAP, sabotageSlotsUsed } from './sabotage';
import type { CardInstance, GameState, PlayerState } from './state';

export function newInstance(state: GameState, defId: string): CardInstance {
  return { uid: `c${state.nextCardUid++}`, defId, seq: 0 };
}

/** Number of cards the player must still drop to get back to HAND_MAX. */
export function discardNeeded(p: Readonly<PlayerState>): number {
  return Math.max(0, p.hand.length - HAND_MAX);
}

const playerOf = (state: GameState, id: string): PlayerState => state.players.find((q) => q.id === id) as PlayerState;

/**
 * New cards enter the hand in slot order with rising handSeq. Overflow opens the discard screen
 * (a bot's controller answers at its next poll; a player inside a minigame gets it afterwards, see ensureDiscard).
 */
export function addToHand(state: GameState, p: PlayerState, cards: CardInstance[], events: GameEvent[]): void {
  const added = cards.map((c) => ({ ...c, seq: p.nextHandSeq++ }));
  p.hand.push(...added);
  events.push({ type: 'handChanged', playerId: p.id });
  if (p.discard) p.discard.newUids.push(...added.map((c) => c.uid));
  openDiscardIfNeeded(state, p, added.map((c) => c.uid), events);
}

/** The discard screen opens when the hand is over 5 and nothing else blocks it. */
function openDiscardIfNeeded(state: GameState, p: PlayerState, newUids: string[], events: GameEvent[]): void {
  if (p.hand.length <= HAND_MAX || p.discard || p.offer || p.phase !== 'idle') return;
  p.discard = { newUids, marked: [], expiresAtMs: state.timeMs + CARD_SCREEN_MS };
  events.push({ type: 'discardRequired', playerId: p.id, count: discardNeeded(p) });
}

/** After a minigame: a hand that grew while the player was playing (reflected Copet) is handled now. */
export function ensureDiscard(state: GameState, p: PlayerState, events: GameEvent[]): void {
  openDiscardIfNeeded(state, p, [], events);
}

/**
 * DR-27: the hand changed under an open discard screen. Marks pointing at missing cards go, the
 * needed count is recomputed, the screen closes when nothing has to be dropped. The 15 s timer
 * is never reset.
 */
export function reconcileDiscard(p: PlayerState, events: GameEvent[]): void {
  const d = p.discard;
  if (!d) return;
  const have = new Set(p.hand.map((c) => c.uid));
  const need = discardNeeded(p);
  if (need <= 0) {
    p.discard = null;
    events.push({ type: 'discardCancelled', playerId: p.id });
    return;
  }
  d.marked = d.marked.filter((u) => have.has(u)).slice(0, need);
  d.newUids = d.newUids.filter((u) => have.has(u));
}

export function openOffer(state: GameState, p: PlayerState, cards: CardInstance[], pick: number, events: GameEvent[]): void {
  p.offer = { cards, pick: Math.min(pick, cards.length), marked: [], expiresAtMs: state.timeMs + CARD_SCREEN_MS };
  events.push({ type: 'cardOffered', playerId: p.id, cardIds: cards.map((c) => c.defId), pick: p.offer.pick });
  // CP5a (bots.md §6): a bot's screen opens like anyone's and its controller answers it with one
  // atomic `chooseCards` on its next poll (so it never stays open longer than one poll).
}

/** Draw the 5-card offer from the player's "cards" stream: all 20 cards, comeback weights (§3.2). */
export function drawOffer(state: GameState, p: PlayerState): CardInstance[] {
  const tier = tierWeights(comebackGap(state.players, p));
  const rng = Rng.fromState(p.cardsRng);
  const defs = buildOffer(offerPool(), tier.weights, rng, tier.guaranteeRarePlus);
  p.cardsRng = rng.getState();
  return defs.map((d) => newInstance(state, d.id));
}

export function resolveOffer(state: GameState, p: PlayerState, uids: string[], auto: boolean, events: GameEvent[]): void {
  const offer = p.offer as NonNullable<PlayerState['offer']>;
  const taken = offer.cards.filter((c) => uids.includes(c.uid));
  p.discarded.push(...offer.cards.filter((c) => !uids.includes(c.uid)));
  p.offer = null;
  events.push({ type: 'cardsPicked', playerId: p.id, cardIds: taken.map((c) => c.defId), auto });
  addToHand(state, p, taken, events);
}

export function resolveDiscard(p: PlayerState, uids: string[], auto: boolean, events: GameEvent[]): void {
  const dropped = p.hand.filter((c) => uids.includes(c.uid));
  p.hand = p.hand.filter((c) => !uids.includes(c.uid));
  p.discarded.push(...dropped);
  p.discard = null;
  events.push({ type: 'cardsDiscarded', playerId: p.id, cardIds: dropped.map((c) => c.defId), auto });
  events.push({ type: 'handChanged', playerId: p.id });
}

export function autoResolve(state: GameState, p: PlayerState, events: GameEvent[]): void {
  if (p.offer) {
    resolveOffer(state, p, autoPick(p.offer.cards.map((c) => ({ uid: c.uid, rarity: getCard(c.defId).rarity })), p.offer.marked, p.offer.pick), true, events);
  } else if (p.discard) {
    const cards = p.hand.map((c) => ({ uid: c.uid, rarity: getCard(c.defId).rarity, seq: c.seq }));
    resolveDiscard(p, autoDiscard(cards, p.discard.marked, discardNeeded(p)), true, events);
  }
}

/** Spend the snapshot cards of a finished attempt: they leave `pending` for `discarded`. */
export function spendSnapshot(p: PlayerState, uids: string[], effective: boolean, events: GameEvent[]): void {
  if (uids.length === 0) return;
  const spent = p.pending.filter((c) => uids.includes(c.uid));
  p.pending = p.pending.filter((c) => !uids.includes(c.uid));
  p.discarded.push(...spent);
  events.push({ type: 'cardsSpent', playerId: p.id, cardIds: spent.map((c) => c.defId), effective });
  events.push({ type: 'pendingEffectsChanged', playerId: p.id });
}

/**
 * DR-06 / QA-CP4a-02: when the match ends, open card screens close without a result. Offered
 * cards go to `discarded` so every instance stays in exactly one zone; a discard screen closes
 * and the hand is left as it is.
 */
export function closeCardScreens(state: GameState): void {
  for (const q of state.players) {
    if (q.offer) q.discarded.push(...q.offer.cards);
    q.offer = null;
    q.discard = null;
  }
}

// ------------------------------------------------------------------ sabotage (§2.2.2 - §2.2.4)

function consumeDefense(owner: PlayerState, events: GameEvent[]): void {
  const card = activeDefense(owner);
  if (!card) return;
  owner.pending = owner.pending.filter((c) => c.uid !== card.uid);
  owner.discarded.push(card);
  events.push({ type: 'pendingEffectsChanged', playerId: owner.id });
}

/** Copet steal: uniform over the victim's hand sorted by handSeq, from `rngOwner`'s copet stream. */
function steal(state: GameState, rngOwner: PlayerState, from: PlayerState, to: PlayerState, reflected: boolean, events: GameEvent[]): CardInstance | null {
  if (from.hand.length === 0) return null;
  const sorted = from.hand.slice().sort((a, b) => a.seq - b.seq);
  const rng = Rng.fromState(rngOwner.copetRng);
  const picked = sorted[rng.int(0, sorted.length - 1)] as CardInstance;
  rngOwner.copetRng = rng.getState();
  from.hand = from.hand.filter((c) => c.uid !== picked.uid);
  events.push({ type: 'cardStolen', thiefId: to.id, victimId: from.id, cardId: picked.defId, uid: picked.uid, reflected });
  events.push({ type: 'handChanged', playerId: from.id });
  reconcileDiscard(from, events);
  addToHand(state, to, [{ ...picked }], events); // the same instance moves (new handSeq, newest)
  return picked;
}

/**
 * The atomic play of a sabotage card (§2.2.2). The caller validated the card and the targets
 * (`targetIds` in seat order). Per target: Cermin reflects, else Payung blocks, else the card lands.
 * Gunung Meletus needs one instance per target, so extra copies are created for the others.
 */
export function playSabotage(state: GameState, sender: PlayerState, card: CardInstance, def: CardDef, targetIds: string[], events: GameEvent[]): void {
  sender.hand = sender.hand.filter((c) => c.uid !== card.uid);
  events.push({ type: 'cardPlayed', playerId: sender.id, uid: card.uid, cardId: def.id });
  events.push({ type: 'handChanged', playerId: sender.id });

  let originalUsed = false;
  const instance = (): CardInstance => {
    if (!originalUsed) {
      originalUsed = true;
      return card;
    }
    return newInstance(state, def.id);
  };
  const report = (targetId: string, outcome: SabotageOutcome): void => {
    events.push({ type: 'sabotagePlayed', senderId: sender.id, targetId, cardId: def.id, outcome });
  };
  const land = (inst: CardInstance, onto: PlayerState, source: string): boolean => {
    if (sabotageSlotsUsed(onto) >= SABOTAGE_SLOT_CAP || (def.maxStacks !== null && copiesPending(onto, def.id) >= def.maxStacks)) return false;
    onto.pending.push({ ...inst, source });
    events.push({ type: 'pendingEffectsChanged', playerId: onto.id });
    return true;
  };

  for (const tid of targetIds) {
    const target = playerOf(state, tid);
    const inst = instance();
    const def0 = activeDefense(target);
    const op = def0 ? defenseOp(def0) : null;
    if (op === 'reflectSabotage') {
      consumeDefense(target, events);
      if (isCopet(def)) {
        // Cermin owner steals from the sender, with the Cermin owner's own copet stream.
        const got = steal(state, target, sender, target, true, events);
        sender.discarded.push(inst);
        report(tid, got ? 'reflectStolen' : 'reflectEmpty');
      } else if (land(inst, sender, target.id)) {
        report(tid, 'reflected');
      } else {
        sender.discarded.push(inst);
        report(tid, 'reflectBurned');
      }
    } else if (op === 'blockSabotage') {
      consumeDefense(target, events);
      sender.discarded.push(inst);
      report(tid, 'blocked');
    } else if (isCopet(def)) {
      steal(state, sender, target, sender, false, events);
      sender.discarded.push(inst);
      report(tid, 'stolen');
    } else {
      if (!land(inst, target, sender.id)) sender.discarded.push(inst); // validated before, so not expected
      report(tid, 'landed');
    }
  }
}
