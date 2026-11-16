/**
 * Sabotage targeting (cards.md §1 Q2, §2.2.1): the single definition of "valid target". Pure and
 * read-only: it is used for dimming cards, for the picker rows and again by the reducer when a
 * card is confirmed. It never looks at hidden information (a target's Payung / Cermin).
 */
import { getCard, type CardDef } from './cards';
import type { CardInstance, GameState, PlayerState } from './state';

/** Q2: at most 2 sabotage cards pending on one player, from every sender. */
export const SABOTAGE_SLOT_CAP = 2;

/** Why an opponent is not a valid target (priority: top row of §2.2.1 first). */
export type TargetLabel = 'empty' | 'full' | 'stacked';

export type TargetCheck = { ok: true } | { ok: false; label: TargetLabel | null };

export const isCopet = (def: CardDef): boolean => def.ops.some((o) => o.op === 'stealRandomCard');

/** Does a pending card of this kind hold one of the target's 2 sabotage slots? */
export function holdsSlot(def: CardDef): boolean {
  return def.type === 'sabotage' && def.duration !== 'instant' && def.usesSabotageSlot !== false;
}

/** Slots in use: every pending sabotage, including the ones a running attempt has snapshotted. */
export function sabotageSlotsUsed(p: Readonly<PlayerState>): number {
  return p.pending.reduce((n, c) => (holdsSlot(getCard(c.defId)) ? n + 1 : n), 0);
}

export function copiesPending(p: Readonly<PlayerState>, defId: string): number {
  return p.pending.reduce((n, c) => (c.defId === defId ? n + 1 : n), 0);
}

export const isDefense = (def: CardDef): boolean => def.duration === 'next_sabotage';

/** The active defence card (Payung Tameng or Cermin Balik), if any (max 1, DR-40). */
export function activeDefense(p: Readonly<PlayerState>): CardInstance | undefined {
  return p.pending.find((c) => isDefense(getCard(c.defId)));
}

export function defenseOp(c: CardInstance): 'blockSabotage' | 'reflectSabotage' | null {
  for (const o of getCard(c.defId).ops) if (o.op === 'blockSabotage' || o.op === 'reflectSabotage') return o.op;
  return null;
}

/** Can `target` receive `def` right now (rows 2-4 of §2.2.1, for a landing on any player)? */
export function landingCheck(target: Readonly<PlayerState>, def: CardDef): TargetCheck {
  if (isCopet(def)) return target.hand.length >= 1 ? { ok: true } : { ok: false, label: 'empty' };
  if (sabotageSlotsUsed(target) >= SABOTAGE_SLOT_CAP) return { ok: false, label: 'full' };
  if (def.maxStacks !== null && copiesPending(target, def.id) >= def.maxStacks) return { ok: false, label: 'stacked' };
  return { ok: true };
}

/** Full §2.2.1 check of one candidate target for a card played by `sender`. */
export function checkTarget(state: Readonly<GameState>, sender: Readonly<PlayerState>, def: CardDef, target: Readonly<PlayerState> | undefined): TargetCheck {
  if (!target || target.id === sender.id || state.status !== 'running' || target.phase === 'finished') return { ok: false, label: null };
  return landingCheck(target, def);
}

export interface OpponentCheck {
  id: string;
  check: TargetCheck;
}

/** Every other player, in seat order, with their validity for `def`. */
export function opponentChecks(state: Readonly<GameState>, sender: Readonly<PlayerState>, def: CardDef): OpponentCheck[] {
  return state.players.filter((q) => q.id !== sender.id).map((q) => ({ id: q.id, check: checkTarget(state, sender, def, q) }));
}

export type SabotageReason = 'noOpponents' | 'allEmpty' | 'allFull' | 'allStacked' | 'noValidTarget';

export type SabotagePlayability = { ok: true; validIds: string[] } | { ok: false; reason: SabotageReason };

/** A sabotage card is playable when at least one opponent is valid (§2.2.1). */
export function sabotagePlayability(state: Readonly<GameState>, sender: Readonly<PlayerState>, def: CardDef): SabotagePlayability {
  const checks = opponentChecks(state, sender, def);
  const validIds = checks.filter((c) => c.check.ok).map((c) => c.id);
  if (validIds.length > 0) return { ok: true, validIds };
  if (checks.length === 0) return { ok: false, reason: 'noOpponents' };
  const labels = new Set(checks.map((c) => (c.check.ok ? null : c.check.label)));
  if (labels.size === 1) {
    const only = [...labels][0];
    if (only === 'empty') return { ok: false, reason: 'allEmpty' };
    if (only === 'full') return { ok: false, reason: 'allFull' };
    if (only === 'stacked') return { ok: false, reason: 'allStacked' };
  }
  return { ok: false, reason: 'noValidTarget' };
}

export interface ImpactSummary {
  hit: number;
  total: number;
  /** Opponents that will be skipped, with the label why. */
  skipped: { id: string; label: TargetLabel | null }[];
}

/** Gunung Meletus confirmation text input: "Kena 2 dari 3 lawan (Bot 3 penuh)". */
export function impactSummary(state: Readonly<GameState>, sender: Readonly<PlayerState>, def: CardDef): ImpactSummary {
  const checks = opponentChecks(state, sender, def);
  return {
    hit: checks.filter((c) => c.check.ok).length,
    total: checks.length,
    skipped: checks.filter((c) => !c.check.ok).map((c) => ({ id: c.id, label: c.check.ok ? null : c.check.label })),
  };
}
