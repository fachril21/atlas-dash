/**
 * Card offers (cards.md §3): the offer algorithm (DR-26), the pick count N (§3.3) and the
 * deterministic auto-pick / auto-discard tie-breaks (DR-25, §3.4). All pure; randomness only
 * through the player's "cards" stream.
 */
import { RARITIES, RARITY_RANK, type CardDef, type CardType, type Rarity } from './cards';
import type { Difficulty } from './map';
import type { Rng } from './rng';
import type { PlayerState } from './state';

export type RarityWeights = Readonly<Record<Rarity, number>>;

export const OFFER_SIZE = 5;
export const HAND_MAX = 5;
export const CARD_SCREEN_MS = 15_000;
export const N_BASE: Readonly<Record<Difficulty, number>> = { easy: 1, medium: 2, hard: 3 };
/** "Pemimpin / seri depan" row (§3.2). */
export const LEADER_WEIGHTS: RarityWeights = { common: 75, rare: 22, epic: 3 };

export interface TierInfo {
  weights: RarityWeights;
  /** Tier requires >= 1 rare+ in the offer (§3.1 step 3). */
  guaranteeRarePlus: boolean;
}

/**
 * Comeback tier hook. CP4a: everyone gets the leader row, no guarantee. CP4b replaces only
 * this function (gap-based tiers).
 */
export function tierWeights(_player: Pick<PlayerState, 'id'>): TierInfo {
  return { weights: LEADER_WEIGHTS, guaranteeRarePlus: false };
}

/** Draw a rarity among those that still have cards in `remaining`; exactly one rng.next(). */
function drawRarity(rng: Rng, remaining: readonly CardDef[], weights: RarityWeights, only?: readonly Rarity[]): Rarity | null {
  const avail = RARITIES.filter((r) => (!only || only.includes(r)) && remaining.some((c) => c.rarity === r));
  if (avail.length === 0) return null;
  const total = avail.reduce((s, r) => s + Math.max(0, weights[r]), 0);
  const x = rng.next() * total;
  let acc = 0;
  for (const r of avail) {
    acc += Math.max(0, weights[r]);
    if (x < acc) return r;
  }
  return avail[avail.length - 1] as Rarity;
}

function drawCard(rng: Rng, remaining: readonly CardDef[], rarity: Rarity, type?: CardType): CardDef {
  const cands = remaining.filter((c) => c.rarity === rarity && (!type || c.type === type));
  return cands[rng.int(0, cands.length - 1)] as CardDef;
}

/**
 * §3.1. `pool` must be in §2 table order. No redraws: every draw removes the card from
 * `remaining`, so the loop ends in <= OFFER_SIZE iterations plus at most 2 replacements.
 */
export function buildOffer(pool: readonly CardDef[], weights: RarityWeights, rng: Rng, guaranteeRarePlus = false): CardDef[] {
  const offer: CardDef[] = [];
  let remaining = pool.slice();
  const take = (c: CardDef) => { remaining = remaining.filter((x) => x.id !== c.id); };

  for (let slot = 0; slot < OFFER_SIZE; slot++) {
    if (remaining.length === 0) break;
    const r = drawRarity(rng, remaining, weights) as Rarity;
    const c = drawCard(rng, remaining, r);
    offer.push(c);
    take(c);
  }

  // Step 2: type guarantee, only when the pool holds both types.
  const poolTypes = new Set(pool.map((c) => c.type));
  if (poolTypes.size === 2 && offer.length > 0) {
    const missing = (['boost', 'sabotage'] as const).find((t) => !offer.some((c) => c.type === t));
    if (missing) {
      const ofType = remaining.filter((c) => c.type === missing);
      const r = drawRarity(rng, ofType, weights);
      if (r) {
        const c = drawCard(rng, ofType, r, missing);
        offer[offer.length - 1] = c;
        take(c);
      }
    }
  }

  // Step 3: rare+ guarantee (slot 5 -> 1, first slot replaceable by a same-type rare+ card).
  if (guaranteeRarePlus && offer.length > 0 && !offer.some((c) => c.rarity !== 'common')) {
    for (let i = offer.length - 1; i >= 0; i--) {
      const type = (offer[i] as CardDef).type;
      const cands = remaining.filter((c) => c.type === type && c.rarity !== 'common');
      if (cands.length === 0) continue;
      const r = drawRarity(rng, cands, weights, ['rare', 'epic']);
      if (!r) continue;
      const c = drawCard(rng, cands, r, type);
      offer[i] = c;
      take(c);
      break;
    }
  }
  return offer;
}

/** §3.3: N = clamp(Nbase(effective difficulty) + Σ rewardPickDelta, 1, min(5, offer size)). */
export function pickCount(effectiveDifficulty: Difficulty, pickDelta: number, offerSize: number): number {
  const hi = Math.max(1, Math.min(OFFER_SIZE, offerSize));
  return Math.min(hi, Math.max(1, N_BASE[effectiveDifficulty] + pickDelta));
}

export interface RarityCard {
  uid: string;
  rarity: Rarity;
}

/**
 * Auto-pick (§3.4): marked cards stay picked; the rest of the N is filled from the unmarked
 * ones, highest rarity first, ties by the leftmost slot. Returns the chosen uids (slot order).
 */
export function autoPick(slots: readonly RarityCard[], marked: readonly string[], n: number): string[] {
  const chosen = new Set(slots.filter((s) => marked.includes(s.uid)).map((s) => s.uid));
  const order = slots
    .map((s, i) => ({ s, i }))
    .filter((x) => !chosen.has(x.s.uid))
    .sort((a, b) => RARITY_RANK[b.s.rarity] - RARITY_RANK[a.s.rarity] || a.i - b.i);
  for (const x of order) {
    if (chosen.size >= n) break;
    chosen.add(x.s.uid);
  }
  return slots.filter((s) => chosen.has(s.uid)).map((s) => s.uid).slice(0, Math.max(n, 0));
}

export interface HandCard extends RarityCard {
  /** handSeq: lower = older. */
  seq: number;
}

/**
 * Auto-discard (§3.4): marked cards stay discarded; the rest of `count` is filled from the
 * unmarked ones, lowest rarity first, ties by oldest (smallest handSeq). New cards carry the
 * largest seqs, so they go last within a rarity.
 */
export function autoDiscard(cards: readonly HandCard[], marked: readonly string[], count: number): string[] {
  const chosen = new Set(cards.filter((c) => marked.includes(c.uid)).map((c) => c.uid));
  const order = cards
    .filter((c) => !chosen.has(c.uid))
    .sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || a.seq - b.seq);
  for (const c of order) {
    if (chosen.size >= count) break;
    chosen.add(c.uid);
  }
  return cards.filter((c) => chosen.has(c.uid)).map((c) => c.uid);
}
