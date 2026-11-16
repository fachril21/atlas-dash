/**
 * Card data (cards.md v0.3 §2, §4): all 20 cards as typed data. One effect interpreter
 * (effects.ts) runs the `ops`. Names/descriptions are string keys (card.<id>.name / .desc).
 * Table order is the canonical order used by the offer algorithm (§3.1): never reorder.
 */
import type { MinigameModifier } from './minigames/types';

export type CardType = 'boost' | 'sabotage';
export type Rarity = 'common' | 'rare' | 'epic';
export type CardTarget = 'self' | 'opponent' | 'all_opponents';
export type CardDuration = 'instant' | 'next_minigame' | 'next_sabotage';
export type CardTrigger = 'onFail' | 'onWin';
export type CardPhase = 'a' | 'b';
export type PlayableWhen = 'always' | 'cooldown' | 'hasTarget';

export type CardOp =
  | { op: 'modifier'; modifier: MinigameModifier }
  | { op: 'difficultyShift'; delta: -1 | 1 }
  | { op: 'cooldownDelta'; seconds: number }
  | { op: 'noCooldown' }
  | { op: 'cooldownClear' }
  | { op: 'rewardPickDelta'; delta: number }
  | { op: 'winMultiplier'; mult: number }
  | { op: 'skipRegion' }
  | { op: 'blockSabotage' }
  | { op: 'reflectSabotage' }
  | { op: 'stealRandomCard'; count: 1 };

export interface CardDef {
  id: string;
  nameKey: string;
  descKey: string;
  icon: string;
  type: CardType;
  rarity: Rarity;
  base: boolean;
  phase: CardPhase;
  target: CardTarget;
  duration: CardDuration;
  trigger?: CardTrigger;
  /** How many copies may be pending on one player; null = not applicable (instant). */
  maxStacks: number | null;
  playableWhen?: PlayableWhen;
  usesSabotageSlot?: boolean;
  ops: CardOp[];
}

interface Row {
  id: string;
  icon: string;
  type: CardType;
  rarity: Rarity;
  base?: boolean;
  phase: CardPhase;
  target?: CardTarget;
  duration: CardDuration;
  trigger?: CardTrigger;
  maxStacks: number | null;
  playableWhen?: PlayableWhen;
  usesSabotageSlot?: boolean;
  ops: CardOp[];
}

const mod = (modifier: MinigameModifier): CardOp => ({ op: 'modifier', modifier });

const ROWS: Row[] = [
  // Boost (11)
  { id: 'jam_pasir', icon: '⏳', type: 'boost', rarity: 'common', base: true, phase: 'a', duration: 'next_minigame', maxStacks: 2, ops: [mod({ kind: 'timeDelta', seconds: 5 })] },
  { id: 'santai_dulu', icon: '🌴', type: 'boost', rarity: 'rare', base: true, phase: 'a', duration: 'next_minigame', maxStacks: 1, ops: [{ op: 'difficultyShift', delta: -1 }] },
  { id: 'nyawa_cadangan', icon: '💗', type: 'boost', rarity: 'common', base: true, phase: 'a', duration: 'next_minigame', trigger: 'onFail', maxStacks: 1, ops: [{ op: 'noCooldown' }] },
  { id: 'teropong', icon: '🔭', type: 'boost', rarity: 'common', base: true, phase: 'a', duration: 'next_minigame', maxStacks: 1, ops: [mod({ kind: 'hint' })] },
  { id: 'payung_tameng', icon: '☂️', type: 'boost', rarity: 'rare', base: true, phase: 'b', duration: 'next_sabotage', maxStacks: 1, ops: [{ op: 'blockSabotage' }] },
  { id: 'zona_lebar', icon: '🎯', type: 'boost', rarity: 'common', phase: 'a', duration: 'next_minigame', maxStacks: 1, ops: [mod({ kind: 'tolerance', mult: 1.3 })] },
  { id: 'kopi_tubruk', icon: '☕', type: 'boost', rarity: 'common', phase: 'a', duration: 'instant', maxStacks: null, playableWhen: 'cooldown', ops: [{ op: 'cooldownClear' }] },
  { id: 'oleh_oleh', icon: '🎁', type: 'boost', rarity: 'common', phase: 'a', duration: 'next_minigame', trigger: 'onWin', maxStacks: 1, ops: [{ op: 'rewardPickDelta', delta: 1 }] },
  { id: 'ojek_kilat', icon: '🛵', type: 'boost', rarity: 'rare', phase: 'a', duration: 'next_minigame', trigger: 'onWin', maxStacks: 1, ops: [{ op: 'winMultiplier', mult: 2 }] },
  { id: 'cermin_balik', icon: '🪞', type: 'boost', rarity: 'epic', phase: 'b', duration: 'next_sabotage', maxStacks: 1, ops: [{ op: 'reflectSabotage' }] },
  { id: 'tiket_pesawat', icon: '✈️', type: 'boost', rarity: 'epic', phase: 'a', duration: 'instant', maxStacks: null, playableWhen: 'hasTarget', ops: [{ op: 'skipRegion' }] },
  // Sabotage (9): data only in CP4a (phase 'b', never offered)
  { id: 'jam_rusak', icon: '⏱️', type: 'sabotage', rarity: 'common', base: true, phase: 'b', target: 'opponent', duration: 'next_minigame', maxStacks: 2, ops: [mod({ kind: 'timeDelta', seconds: -5 })] },
  { id: 'badai', icon: '🌪️', type: 'sabotage', rarity: 'rare', base: true, phase: 'b', target: 'opponent', duration: 'next_minigame', maxStacks: 1, ops: [{ op: 'difficultyShift', delta: 1 }] },
  { id: 'kabut_asap', icon: '🌫️', type: 'sabotage', rarity: 'common', base: true, phase: 'b', target: 'opponent', duration: 'next_minigame', maxStacks: 1, ops: [mod({ kind: 'fog' })] },
  { id: 'macet_total', icon: '🚧', type: 'sabotage', rarity: 'common', phase: 'b', target: 'opponent', duration: 'next_minigame', trigger: 'onFail', maxStacks: 1, ops: [{ op: 'cooldownDelta', seconds: 6 }] },
  { id: 'pelit_hadiah', icon: '🪙', type: 'sabotage', rarity: 'common', phase: 'b', target: 'opponent', duration: 'next_minigame', trigger: 'onWin', maxStacks: 1, ops: [{ op: 'rewardPickDelta', delta: -1 }] },
  { id: 'ngebut', icon: '💨', type: 'sabotage', rarity: 'rare', phase: 'b', target: 'opponent', duration: 'next_minigame', maxStacks: 1, ops: [mod({ kind: 'speed', mult: 1.25 })] },
  { id: 'tambah_beban', icon: '🎒', type: 'sabotage', rarity: 'rare', phase: 'b', target: 'opponent', duration: 'next_minigame', maxStacks: 1, ops: [mod({ kind: 'extraTarget', count: 1 })] },
  { id: 'copet', icon: '🕵️', type: 'sabotage', rarity: 'rare', phase: 'b', target: 'opponent', duration: 'instant', maxStacks: null, usesSabotageSlot: false, ops: [{ op: 'stealRandomCard', count: 1 }] },
  { id: 'gunung_meletus', icon: '🌋', type: 'sabotage', rarity: 'epic', phase: 'b', target: 'all_opponents', duration: 'next_minigame', maxStacks: 1, ops: [{ op: 'difficultyShift', delta: 1 }] },
];

export const CARDS: readonly CardDef[] = ROWS.map((r) => {
  const def: CardDef = {
    id: r.id,
    nameKey: `card.${r.id}.name`,
    descKey: `card.${r.id}.desc`,
    icon: r.icon,
    type: r.type,
    rarity: r.rarity,
    base: r.base ?? false,
    phase: r.phase,
    target: r.target ?? 'self',
    duration: r.duration,
    maxStacks: r.maxStacks,
    ops: r.ops,
  };
  if (r.trigger) def.trigger = r.trigger;
  if (r.playableWhen) def.playableWhen = r.playableWhen;
  if (r.usesSabotageSlot !== undefined) def.usesSabotageSlot = r.usesSabotageSlot;
  return def;
});

const BY_ID = new Map(CARDS.map((c) => [c.id, c] as const));

export function getCard(id: string): CardDef {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`unknown card "${id}"`);
  return c;
}

export function hasCard(id: string): boolean {
  return BY_ID.has(id);
}

/** CP4a offer pool: phase 'a' cards (the 9 boost cards), in §2 table order. */
export function offerPool(phase: CardPhase = 'a'): CardDef[] {
  return CARDS.filter((c) => c.phase === phase);
}

export const RARITY_RANK: Readonly<Record<Rarity, number>> = { common: 0, rare: 1, epic: 2 };
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic'];

/** An op list is valid for a card when each op fits its duration/trigger (tested). */
export function opsValidFor(def: CardDef): boolean {
  const conditional = def.trigger !== undefined;
  return def.ops.every((o) => {
    switch (o.op) {
      case 'modifier':
      case 'difficultyShift':
        return def.duration === 'next_minigame' && !conditional;
      case 'noCooldown':
      case 'cooldownDelta':
        return def.duration === 'next_minigame' && def.trigger === 'onFail';
      case 'rewardPickDelta':
      case 'winMultiplier':
        return def.duration === 'next_minigame' && def.trigger === 'onWin';
      case 'cooldownClear':
      case 'skipRegion':
      case 'stealRandomCard':
        return def.duration === 'instant';
      case 'blockSabotage':
      case 'reflectSabotage':
        return def.duration === 'next_sabotage';
    }
  });
}
