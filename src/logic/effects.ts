/**
 * Effect engine (cards.md §2, §4 and "Urutan resolusi saat Mulai"): interprets a card's `ops`.
 * Pure functions only. Sabotage cards that sit in a player's `pending` zone are resolved here
 * exactly like boost cards (the snapshot sums everything, so the order cards were played in
 * never matters, §2.3); how they get there is in cardflow.ts / sabotage.ts.
 *
 * Resolution at Mulai (snapshot): (1) take the pending next_minigame cards, (2) sum and clamp
 * difficultyShift, (3) merge modifiers (timeDelta summed then clamped so base+total is 10-40 s,
 * multipliers multiplied), (4) the result goes into MinigameContext, (5) after the result the
 * conditional ops whose trigger fired are applied and every snapshot card is spent.
 */
import { getCard, type CardDef } from './cards';
import { regionDifficulty, type Difficulty, type MapGraph } from './map';
import type { MinigameModifier } from './minigames/types';
import { activeDefense, isDefense, sabotagePlayability } from './sabotage';
import type { CardInstance, GameState, PlayerState } from './state';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
export const MIN_DURATION_S = 10;
export const MAX_DURATION_S = 40;

export function shiftDifficulty(d: Difficulty, delta: number): Difficulty {
  const i = DIFFICULTIES.indexOf(d) + delta;
  return DIFFICULTIES[Math.min(DIFFICULTIES.length - 1, Math.max(0, i))] as Difficulty;
}

export interface ResolvedAttemptEffects {
  /** Effective difficulty after difficultyShift (clamped easy..hard). */
  difficulty: Difficulty;
  /** Net modifiers handed to the minigame (one per kind, neutral ones omitted). */
  modifiers: MinigameModifier[];
  /** Net difficulty shift requested (before clamp), for UI badges. */
  difficultyShift: number;
  onFail: { noCooldown: boolean; cooldownDeltaMs: number };
  onWin: { pickDelta: number; winMultiplier: number };
}

/** Race-layer clamp (minigames.md §1.1): base + total timeDelta stays within 10-40 s. */
export function clampTimeDelta(baseDurationMs: number, totalSeconds: number): number {
  const base = baseDurationMs / 1000;
  return Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, base + totalSeconds)) - base;
}

export function resolveAttemptEffects(
  defs: readonly CardDef[],
  baseDifficulty: Difficulty,
  baseDurationMs: number,
): ResolvedAttemptEffects {
  let shift = 0;
  let timeS = 0;
  let tol = 1;
  let speed = 1;
  let extra = 0;
  let fog = false;
  let hint = false;
  const onFail = { noCooldown: false, cooldownDeltaMs: 0 };
  const onWin = { pickDelta: 0, winMultiplier: 1 };

  // Every merge below is commutative; sorting by id also removes float-product order effects.
  const ordered = defs.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const def of ordered) {
    for (const o of def.ops) {
      if (def.trigger === 'onFail') {
        if (o.op === 'noCooldown') onFail.noCooldown = true;
        else if (o.op === 'cooldownDelta') onFail.cooldownDeltaMs += o.seconds * 1000;
        continue;
      }
      if (def.trigger === 'onWin') {
        if (o.op === 'rewardPickDelta') onWin.pickDelta += o.delta;
        else if (o.op === 'winMultiplier') onWin.winMultiplier *= o.mult;
        continue;
      }
      if (o.op === 'difficultyShift') shift += o.delta;
      else if (o.op === 'modifier') {
        const m = o.modifier;
        switch (m.kind) {
          case 'timeDelta': timeS += m.seconds; break;
          case 'tolerance': tol *= m.mult; break;
          case 'speed': speed *= m.mult; break;
          case 'extraTarget': extra += m.count; break;
          case 'fog': fog = true; break;
          case 'hint': hint = true; break;
        }
      }
      // Other ops (instant / defensive) never appear in a snapshot.
    }
  }

  const modifiers: MinigameModifier[] = [];
  const dt = clampTimeDelta(baseDurationMs, timeS);
  if (dt !== 0) modifiers.push({ kind: 'timeDelta', seconds: dt });
  if (tol !== 1) modifiers.push({ kind: 'tolerance', mult: tol });
  if (speed !== 1) modifiers.push({ kind: 'speed', mult: speed });
  if (extra !== 0) modifiers.push({ kind: 'extraTarget', count: extra });
  if (fog) modifiers.push({ kind: 'fog' });
  if (hint) modifiers.push({ kind: 'hint' });

  return { difficulty: shiftDifficulty(baseDifficulty, shift), modifiers, difficultyShift: shift, onFail, onWin };
}

export type UnplayableReason =
  | 'onlyCooldown'
  | 'pickTargetFirst'
  | 'noFinal'
  | 'maxStacks'
  | 'defenseActive' // Payung / Cermin already active (max 1 defence card, DR-40)
  | 'noOpponents'
  | 'allEmpty' // Copet: every opponent has an empty hand
  | 'allFull' // Q2: every opponent already holds 2 sabotage cards
  | 'allStacked' // every opponent already has this card pending (maxStacks)
  | 'noValidTarget' // mixed reasons
  | 'busy'; // minigame running, or a card/discard screen is open

export type CardWarning = 'santaiEasy' | 'olehFinal';

export interface Playability {
  ok: boolean;
  reason?: UnplayableReason;
}

export function cardScreenOpen(p: PlayerState): boolean {
  return p.offer !== null || p.discard !== null;
}

export function pendingCount(p: PlayerState, defId: string): number {
  return p.pending.filter((c) => c.defId === defId).length;
}

/** playableWhen / maxStacks / target / lock rules (§1, §2.1, §2.2.1, DR-30, DR-31). */
export function cardPlayability(map: MapGraph, state: Readonly<GameState>, p: PlayerState, card: CardInstance): Playability {
  const def = getCard(card.defId);
  const no = (reason: UnplayableReason): Playability => ({ ok: false, reason });
  if (state.status !== 'running' || p.phase !== 'idle' || cardScreenOpen(p)) return no('busy');
  if (def.type === 'sabotage') {
    const sp = sabotagePlayability(state, p, def);
    if (!sp.ok) return no(sp.reason);
  }
  if (isDefense(def) && activeDefense(p)) return no('defenseActive');
  if (def.playableWhen === 'cooldown' && state.timeMs >= p.cooldownUntilMs) return no('onlyCooldown');
  if (def.playableWhen === 'hasTarget') {
    if (!p.targetId) return no('pickTargetFirst');
    if (map.finalRegions.has(p.targetId)) return no('noFinal');
  }
  if (def.type === 'boost' && def.maxStacks !== null && def.duration !== 'instant' && pendingCount(p, def.id) >= def.maxStacks) return no('maxStacks');
  return { ok: true };
}

/** Warnings shown in the card detail for cards that are still playable (§2.1). */
export function cardWarnings(map: MapGraph, p: PlayerState, card: CardInstance): CardWarning[] {
  const def = getCard(card.defId);
  const out: CardWarning[] = [];
  if (def.id === 'santai_dulu' && p.targetId) {
    if (regionDifficulty(map, p.targetId) === 'easy') out.push('santaiEasy');
  }
  if (def.id === 'oleh_oleh' && p.targetId && map.finalRegions.has(p.targetId)) out.push('olehFinal');
  return out;
}
