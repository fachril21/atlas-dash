/**
 * Bot decisions (bots.md §5-§7), all pure: `(observation, map, profile, rng) -> decision`.
 * They read only an Observation (botObservation.ts), draw from the `botMind` stream they are
 * handed, and never touch state. The controller (smartBot.ts) owns timing and calls these.
 * Every number comes from the BotProfile / BOT_* data tables.
 */
import { BOT_BOOST_ORDER, BOT_CARD_RULES, SURVIVAL_MINIGAMES, BOT_CARD_VALUE, BOT_CONTEXT, BOT_DEFENSE_ORDER, BOT_SABOTAGE_ORDER, type BotProfile, type Range } from './botProfiles';
import { opponentsOf, type Observation } from './botObservation';
import { getCard, RARITY_RANK } from './cards';
import { passChanceFor } from './controllers';
import { getMinigameLogic } from './minigames';
import { cardPlayability, resolveAttemptEffects, type ResolvedAttemptEffects } from './effects';
import { outgoing, regionDifficulty, type Difficulty, type MapGraph } from './map';
import { autoDiscard, comebackGap, HAND_MAX, N_BASE } from './offers';
import { discardNeeded, selectableTargets } from './reducer';
import type { Rng } from './rng';
import { opponentChecks, sabotagePlayability, sabotageSlotsUsed } from './sabotage';
import { cooldownRemainingMs, COOLDOWN_MS, INTRO_MS, type Attempt, RESULT_BANNER_MS, RETRY_INTRO_MS, totalWins, type CardInstance } from './state';

const mean = (r: Range): number => (r[0] + r[1]) / 2;
const DIFF_RANK: Readonly<Record<Difficulty, number>> = { easy: 0, medium: 1, hard: 2 };
/** Hard route costs closer than this are a tie (bots.md §5). */
const ROUTE_COST_TIE_MS = 1000;

// ------------------------------------------------------------------ brake (§4)

/** The leader brake: leading (ties count) and ahead of the pace schedule. */
export function isAheadOfSchedule(obs: Observation, map: MapGraph, profile: BotProfile): boolean {
  if (!Number.isFinite(profile.paceTargetMs)) return false;
  const total = totalWins(map);
  const mine = obs.me.remainingWins;
  if (!opponentsOf(obs).every((o) => mine <= o.remainingWins)) return false;
  const done = total - mine;
  return obs.state.timeMs < (profile.paceTargetMs * done) / total - profile.paceSlackMs;
}

// ------------------------------------------------------------------ cards: value, offer, discard (§6)

/** Does a region that is neither final nor the finish still lie ahead of the bot? */
function nonFinalAhead(obs: Observation, map: MapGraph): boolean {
  const seen = new Set<string>();
  const stack = [...outgoing(map, obs.me.nodeId)];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id) || id === map.finishId) continue;
    seen.add(id);
    if (!map.finalRegions.has(id)) return true;
    stack.push(...outgoing(map, id));
  }
  return false;
}

/** BOT_CARD_VALUE, plus the Hard context adjustments when `withContext` (§6). */
export function botScoreCard(obs: Observation, map: MapGraph, defId: string, withContext: boolean): number {
  let score = BOT_CARD_VALUE[defId] ?? 0;
  if (!withContext) return score;
  const me = obs.me;
  const def = getCard(defId);
  const inHand = me.hand.some((c) => c.defId === defId);
  if (inHand) score += def.maxStacks === 2 ? BOT_CONTEXT.duplicatePenaltyTwoStack : BOT_CONTEXT.duplicatePenalty;
  const gap = comebackGap(obs.state.players, me);
  if (gap >= BOT_CONTEXT.catchUpGap && BOT_CONTEXT.catchUpCards.includes(defId)) score += BOT_CONTEXT.catchUpBonus;
  if (defId === 'copet' && opponentsOf(obs).reduce((m, o) => Math.max(m, o.hand.length), 0) >= BOT_CONTEXT.copetRichHand) score += BOT_CONTEXT.copetBonus;
  if (BOT_CONTEXT.defenseCards.includes(defId)) {
    const has = me.pending.some((c) => getCard(c.defId).duration === 'next_sabotage') || me.hand.some((c) => BOT_CONTEXT.defenseCards.includes(c.defId));
    if (has) score += BOT_CONTEXT.defensePenalty;
  }
  if (BOT_CONTEXT.needsRegionCards.includes(defId) && !nonFinalAhead(obs, map)) score += BOT_CONTEXT.noRegionPenalty;
  return score;
}

/**
 * Which N offer cards to take (uids, slot order). Easy: uniform. Normal/Hard: highest score;
 * ties go to the higher rarity, then the leftmost slot.
 */
export function botChooseOffer(obs: Observation, map: MapGraph, profile: BotProfile, rng: Rng): string[] {
  const offer = obs.me.offer;
  if (!offer) return [];
  const slots = offer.cards.map((c, i) => ({ c, i }));
  const n = offer.pick;
  let chosen: typeof slots;
  if (profile.offerPolicy === 'random') {
    chosen = rng.shuffle(slots).slice(0, n);
  } else {
    const ctx = profile.offerPolicy === 'valueContext';
    const scored = slots.map((s) => ({ ...s, score: botScoreCard(obs, map, s.c.defId, ctx), rank: RARITY_RANK[getCard(s.c.defId).rarity] }));
    scored.sort((a, b) => b.score - a.score || b.rank - a.rank || a.i - b.i);
    chosen = scored.slice(0, n);
  }
  return chosen.sort((a, b) => a.i - b.i).map((s) => s.c.uid);
}

/** Which cards to drop from an over-full hand (uids). Easy: the §3.4 auto rule; else lowest value, oldest first. */
export function botChooseDiscard(obs: Observation, profile: BotProfile): string[] {
  const me = obs.me;
  const count = discardNeeded(me);
  if (count <= 0) return [];
  if (profile.discardPolicy === 'autoRule') {
    return autoDiscard(me.hand.map((c) => ({ uid: c.uid, rarity: getCard(c.defId).rarity, seq: c.seq })), [], count);
  }
  return me.hand
    .slice()
    .sort((a, b) => (BOT_CARD_VALUE[a.defId] ?? 0) - (BOT_CARD_VALUE[b.defId] ?? 0) || a.seq - b.seq)
    .slice(0, count)
    .map((c) => c.uid);
}

// ------------------------------------------------------------------ route (§5)

/** E_win(d): expected ms to win one region of difficulty d, retries included (§5). */
export function expectedWinMs(profile: BotProfile, d: Difficulty): number {
  const p = profile.passChance[d];
  const fails = (1 - p) / p;
  const pass = INTRO_MS + mean(profile.passTimeFrac) * profile.estDurationMs + RESULT_BANNER_MS + mean(profile.thinkMs) + mean(profile.afterWinMs);
  const fail = RETRY_INTRO_MS + mean(profile.failTimeFrac) * profile.estDurationMs + RESULT_BANNER_MS + COOLDOWN_MS[d] + mean(profile.thinkMs);
  return pass + fails * fail;
}

/** Hard route cost of playing region `t` and then the best continuation to the finish (DP over the DAG). */
export function routeCosts(map: MapGraph, profile: BotProfile): ReadonlyMap<string, number> {
  const memo = new Map<string, number>();
  const W = map.winsRequired;
  const costOf = (t: string): number => {
    const cached = memo.get(t);
    if (cached !== undefined) return cached;
    const d = regionDifficulty(map, t);
    const cardWins = map.finalRegions.has(t) ? W - 1 : W; // the deciding win earns no offer (C-3)
    const own = W * expectedWinMs(profile, d) - N_BASE[d] * cardWins * profile.cardValueMs;
    const next = outgoing(map, t).filter((n) => n !== map.finishId);
    const rest = next.length === 0 ? 0 : Math.min(...next.map(costOf));
    memo.set(t, own + rest);
    return own + rest;
  };
  for (const id of map.regions.keys()) if (id !== map.finishId) costOf(id);
  return memo;
}

/** Best option by `key` (lower is better): near-ties go to the lower base difficulty, then random. */
function bestBy(options: readonly string[], key: (id: string) => number, tolerance: number, map: MapGraph, rng: Rng): string {
  const min = Math.min(...options.map(key));
  const near = options.filter((o) => key(o) - min < tolerance);
  const lowest = Math.min(...near.map((o) => DIFF_RANK[regionDifficulty(map, o)]));
  const tied = near.filter((o) => DIFF_RANK[regionDifficulty(map, o)] === lowest);
  return tied.length === 1 ? (tied[0] as string) : rng.pick(tied);
}

/** Target region to pick from the current node (null if there is none). Never called for a switch. */
export function botChooseRoute(obs: Observation, map: MapGraph, profile: BotProfile, rng: Rng): string | null {
  const options = selectableTargets(map, obs.state, obs.me);
  if (options.length === 0) return null;
  if (profile.routePolicy === 'random') return rng.pick(options);
  const mistake = rng.chance(profile.routeMistake); // one draw per decision, whatever the map
  let best: string;
  if (profile.routePolicy === 'shortest') {
    best = bestBy(options, (id) => map.playDist.get(id) ?? 0, 0.5, map, rng);
  } else {
    const costs = routeCosts(map, profile);
    best = bestBy(options, (id) => costs.get(id) ?? 0, ROUTE_COST_TIE_MS, map, rng);
  }
  if (mistake) {
    const others = options.filter((o) => o !== best);
    if (others.length > 0) return rng.pick(others);
  }
  return best;
}

// ------------------------------------------------------------------ playing cards (§7)

export interface CardPlay {
  cardUid: string;
  targetId?: string;
}

export interface CardContext {
  /** Game time of the bot's last Copet (null = never). */
  lastCopetAtMs: number | null;
}

/** Leader among `validIds`: fewest remainingWins, then fewest filled slots, then random (§7.2). */
function leaderAmong(obs: Observation, validIds: readonly string[], rng: Rng): string {
  const cands = obs.state.players.filter((p) => validIds.includes(p.id));
  const minRw = Math.min(...cands.map((p) => p.remainingWins));
  let best = cands.filter((p) => p.remainingWins === minRw);
  const minSlots = Math.min(...best.map((p) => sabotageSlotsUsed(p)));
  best = best.filter((p) => sabotageSlotsUsed(p) === minSlots);
  return (best.length === 1 ? best[0] : rng.pick(best))?.id as string;
}

/**
 * Target for an `opponent` sabotage card, or null if none qualifies. Copet: most cards in hand
 * (at least `minHand`), ties to the leader. Everything else: the leader among valid targets.
 * `valid` comes from the same validator as the UI.
 */
export function botPickSabotageTarget(obs: Observation, defId: string, valid: readonly string[], minHand: number, rng: Rng): string | null {
  if (valid.length === 0) return null;
  if (defId !== 'copet') return leaderAmong(obs, valid, rng);
  const rich = obs.state.players.filter((p) => valid.includes(p.id) && p.hand.length >= minHand);
  if (rich.length === 0) return null;
  const most = Math.max(...rich.map((p) => p.hand.length));
  return leaderAmong(obs, rich.filter((p) => p.hand.length === most).map((p) => p.id), rng);
}

/** p_next and the net effects of everything pending on the bot (own boosts and incoming sabotage). */
export function botNextAttempt(obs: Observation, map: MapGraph, profile: BotProfile): { p: number; eff: ResolvedAttemptEffects } | null {
  const me = obs.me;
  if (!me.targetId) return null;
  const defs = me.pending.map((c) => getCard(c.defId)).filter((d) => d.duration === 'next_minigame');
  const eff = resolveAttemptEffects(defs, regionDifficulty(map, me.targetId), profile.estDurationMs);
  return { p: passChanceFor(profile, eff.difficulty, eff.modifiers), eff };
}

function validTargetsFor(obs: Observation, defId: string): string[] {
  const check = sabotagePlayability(obs.state, obs.me, getCard(defId));
  return check.ok ? check.validIds : [];
}

/** All cards the UI would let the bot play right now (same validator). */
export function playableCards(obs: Observation, map: MapGraph): CardInstance[] {
  return obs.me.hand.filter((c) => cardPlayability(map, obs.state, obs.me, c).ok);
}

const copetBlocked = (profile: BotProfile, ctx: CardContext, now: number): boolean => ctx.lastCopetAtMs !== null && now - ctx.lastCopetAtMs < profile.copetMinGapMs;

/**
 * At most one card to play this evaluation, or null. Easy: with chance `cardPlayChance`, a uniform
 * pick among playable cards. Normal/Hard: the §7 priority list, then the overflow rule.
 */
export function botPickCardToPlay(obs: Observation, map: MapGraph, profile: BotProfile, rng: Rng, ctx: CardContext): CardPlay | null {
  const me = obs.me;
  const now = obs.state.timeMs;
  const blockedCopet = copetBlocked(profile, ctx, now);
  const cards = playableCards(obs, map).filter((c) => !(c.defId === 'copet' && blockedCopet));
  if (cards.length === 0) return null;

  const play = (c: CardInstance, targetId?: string | null): CardPlay => (targetId ? { cardUid: c.uid, targetId } : { cardUid: c.uid });
  const find = (id: string): CardInstance | undefined => cards.find((c) => c.defId === id);

  // Playing a card needs the gate on top of "something is playable" (Easy 30%, casual human 60%).
  if (profile.cardPlayChance < 1 && !rng.chance(profile.cardPlayChance)) return null;

  const sabotageTarget = (c: CardInstance, minHand: number): { ok: boolean; targetId?: string | null } => {
    const def = getCard(c.defId);
    if (def.type !== 'sabotage' || def.target !== 'opponent') return { ok: true };
    const targetId = botPickSabotageTarget(obs, def.id, validTargetsFor(obs, def.id), minHand, rng);
    return targetId ? { ok: true, targetId } : { ok: false };
  };

  if (profile.cardLogic === 'random') {
    const c = rng.pick(cards);
    const t = isOpponentSabotage(c) ? botPickSabotageTarget(obs, c.defId, validTargetsFor(obs, c.defId), 1, rng) : null;
    if (isOpponentSabotage(c) && !t) return null;
    return play(c, t);
  }

  const hard = profile.cardLogic === 'hard';
  const gap = comebackGap(obs.state.players, me);
  const next = botNextAttempt(obs, map, profile);
  const baseDiff = me.targetId ? regionDifficulty(map, me.targetId) : null;
  const final = me.targetId ? map.finalRegions.has(me.targetId) : false;

  // 1. Defence, at once (★2).
  for (const id of BOT_DEFENSE_ORDER) {
    const c = find(id);
    if (c) return play(c);
  }
  // 2. Kopi Tubruk while a real cooldown is left.
  const kopi = find('kopi_tubruk');
  if (kopi && cooldownRemainingMs(obs.state, me) >= BOT_CARD_RULES.kopiMinCooldownMs) return play(kopi);
  // 3. Tiket Pesawat: skip a hard region before any win there.
  const tiket = find('tiket_pesawat');
  if (tiket && baseDiff && me.winsAtTarget === 0 && !final && (baseDiff === 'hard' || (hard && baseDiff === 'medium' && gap >= BOT_CARD_RULES.tiketMediumGap))) return play(tiket);
  // 4. Ojek Kilat: double wins on a tough (or deciding) region.
  const ojek = find('ojek_kilat');
  if (ojek && baseDiff && me.winsAtTarget === 0) {
    const worth = hard ? baseDiff === 'hard' || final : DIFF_RANK[baseDiff] >= DIFF_RANK.medium;
    if (worth) return play(ojek);
  }
  // 5. Oleh-oleh: only when the next win still earns an offer and the hand has room.
  const oleh = find('oleh_oleh');
  if (oleh && baseDiff && next) {
    const gain = Math.round(next.eff.onWin.winMultiplier);
    const decides = final && me.winsAtTarget + gain >= map.winsRequired;
    if (!decides && me.hand.length + N_BASE[baseDiff] + 1 <= HAND_MAX) return play(oleh);
  }
  // 6. Boosts for the next attempt, only while the pass chance is low.
  if (next) {
    for (const id of BOT_BOOST_ORDER) {
      const c = find(id);
      if (!c || next.p > profile.boostMaxPass) continue;
      if (id === 'santai_dulu' && DIFF_RANK[next.eff.difficulty] < DIFF_RANK.medium) continue;
      return play(c);
    }
  }
  // 7. Sabotage.
  const opponents = opponentsOf(obs).length;
  for (const id of BOT_SABOTAGE_ORDER) {
    const c = find(id);
    if (!c) continue;
    if (id === 'gunung_meletus') {
      const valid = validTargetsFor(obs, id).length;
      const ok = valid >= profile.gunungMinValid || (valid >= 1 && (opponents === 1 || gap >= BOT_CARD_RULES.gunungCatchUpGap));
      if (ok) return play(c);
    } else if (id === 'copet') {
      const t = sabotageTarget(c, profile.copetMinHand);
      if (t.ok && t.targetId) return play(c, t.targetId);
    } else {
      const t = sabotageTarget(c, 1);
      if (t.ok) return play(c, t.targetId);
    }
  }
  // Overflow: a full hand wastes the next offer, so the cheapest playable card goes.
  if (me.hand.length >= profile.overflowHand) {
    const ordered = cards.slice().sort((a, b) => (BOT_CARD_VALUE[a.defId] ?? 0) - (BOT_CARD_VALUE[b.defId] ?? 0) || a.seq - b.seq);
    for (const c of ordered) {
      const t = sabotageTarget(c, 1);
      if (t.ok) return play(c, t.targetId);
    }
  }
  return null;
}

function isOpponentSabotage(c: CardInstance): boolean {
  const d = getCard(c.defId);
  return d.type === 'sabotage' && d.target === 'opponent';
}

/** Opponents the validator would accept for a card (re-exported for tests). */
export function validOpponentIds(obs: Observation, defId: string): string[] {
  return opponentChecks(obs.state, obs.me, getCard(defId)).filter((c) => c.check.ok).map((c) => c.id);
}

// ------------------------------------------------------------------ attempt simulation (§3)

export interface SimulatedAttempt {
  passed: boolean;
  timeTakenMs: number;
  /** Game time at which the result action is due (end of intro + play + banner). */
  resultAtMs: number;
}

/**
 * Roll a bot attempt from its own `bot` stream: exactly two draws (chance, then range). The
 * level is generated from the attempt's own seed and modifiers, so D is what a human would see.
 */
export function simulateAttempt(attempt: Readonly<Attempt>, map: MapGraph, profile: BotProfile, rng: Rng): SimulatedAttempt {
  const level = getMinigameLogic(attempt.minigameId).generateLevel({
    seed: attempt.seed,
    difficulty: attempt.difficulty,
    modifiers: attempt.modifiers.slice(),
    map: map.data,
    regionId: attempt.targetId,
    inputMode: 'mouse',
    settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 },
  }) as { durationMs: number; previewMs?: number };
  // D (minigames.md §9): play duration plus a preview that sits outside it (Cocokkan Kartu).
  const effectiveMs = level.durationMs + (level.previewMs ?? 0);
  const passed = rng.chance(passChanceFor(profile, attempt.difficulty, attempt.modifiers));
  const [lo, hi] = passed ? profile.passTimeFrac : profile.failTimeFrac;
  const frac = rng.range(lo, hi);
  const timeTakenMs = Math.round(effectiveMs * (passed && SURVIVAL_MINIGAMES.has(attempt.minigameId) ? 1 : frac));
  return { passed, timeTakenMs, resultAtMs: attempt.startedAtMs + attempt.introMs + timeTakenMs + RESULT_BANNER_MS };
}
