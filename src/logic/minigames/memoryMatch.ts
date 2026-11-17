/**
 * Cocokkan Kartu (`memory_match`), pure rules. Spec: minigames.md §7.
 * A preview phase shows every card, then the player flips pairs. The second card of a try is
 * compared at once; a mismatch stays open for `mismatchDelayMs` unless the player taps another
 * closed card first (peek-ahead). Time `tMs` here includes the preview; `playMs = tMs - previewMs`.
 */
import type { Difficulty, MapData } from '../map';
import { Rng } from '../rng';
import type { MinigameContext, MinigameLogic, MinigameResult } from './types';

export const MEMORY_BASE_MS = 30_000;
export const MEMORY_KNOBS: Readonly<Record<Difficulty, { pairs: number; previewMs: number; mismatchDelayMs: number }>> = {
  easy: { pairs: 6, previewMs: 2000, mismatchDelayMs: 800 },
  medium: { pairs: 8, previewMs: 1000, mismatchDelayMs: 700 },
  hard: { pairs: 10, previewMs: 0, mismatchDelayMs: 600 },
};
export const MEMORY_FLIP_MS = 200;
export const MEMORY_MIN_ICONS = 12;
export const MEMORY_MAX_EXTRA = 2;
export const MEMORY_EXTRA_MS_PER_COUNT = 2000;
export const MEMORY_PEEK_MS = 1000;
export const MEMORY_TOLERANCE_PREVIEW_MAX_MS = 3000;
export const MEMORY_MIN_MISMATCH_MS = 250;
export const MEMORY_MIN_FLIP_MS = 80;

export interface MemoryLevel {
  /** Play time after the preview. */
  durationMs: number;
  previewMs: number;
  pairs: number;
  cols: number;
  rows: number;
  /** Icon id per card position (each chosen icon appears exactly twice). */
  cards: string[];
  flipMs: number;
  mismatchDelayMs: number;
  peekAvailable: boolean;
  peekMs: number;
  fog: boolean;
  warnings: string[];
}

export type MemoryInput = { card: number } | { peek: true };

export interface MemoryState {
  /** Time since the start, preview included. */
  tMs: number;
  /** Cards face up and not matched (0-2). */
  open: number[];
  /** Matched card positions, in match order. */
  matched: number[];
  /** A mismatch waiting to close. */
  closing: { cards: [number, number]; closeAtMs: number } | null;
  peekUsed: boolean;
  /** While tMs < peekUntilMs, every unmatched card is face up and input is ignored. */
  peekUntilMs: number;
  mismatches: number;
  /** Last try outcome, for view feedback. */
  lastTry: { tMs: number; kind: 'match' | 'mismatch'; cards: [number, number] } | null;
  result: MinigameResult | null;
}

export function memoryRequires(map: MapData): boolean {
  const t = map.minigameThemes?.['memory_match'];
  const icons = t?.['icons'];
  const groups = t?.['iconGroups'];
  return Array.isArray(icons) && icons.length >= MEMORY_MIN_ICONS && Array.isArray(groups) && groups.length === icons.length;
}

/** cols = 3 for 6 pairs, else 4 (DR-18). */
export function gridFor(pairs: number): { cols: number; rows: number } {
  const cols = pairs === 6 ? 3 : 4;
  return { cols, rows: Math.ceil((2 * pairs) / cols) };
}

export function isPeeking(level: MemoryLevel, state: MemoryState, tMs: number): boolean {
  return tMs < state.peekUntilMs && !state.result && tMs >= level.previewMs;
}

/** True while the preview shows every card. */
export function inPreview(level: MemoryLevel, tMs: number): boolean {
  return tMs < level.previewMs;
}

/** Whether a card is face up at time tMs (view helper; rules never read it). */
export function isFaceUp(level: MemoryLevel, state: MemoryState, card: number, tMs: number): boolean {
  if (state.matched.includes(card)) return false; // matched cards leave the board
  if (inPreview(level, tMs)) return true;
  if (isPeeking(level, state, tMs)) return true;
  if (state.open.includes(card)) return true;
  return false;
}

function progressOf(level: MemoryLevel, s: MemoryState): number {
  return Math.min(1, s.matched.length / 2 / level.pairs);
}

export const memoryMatchLogic: MinigameLogic<MemoryLevel, MemoryInput, MemoryState> = {
  id: 'memory_match',
  render: '2d',
  introKey: 'mg.memory_match.intro',
  baseDurationMs: MEMORY_BASE_MS,
  requires: memoryRequires,

  generateLevel(ctx: MinigameContext): MemoryLevel {
    const rng = new Rng(ctx.seed);
    const k = MEMORY_KNOBS[ctx.difficulty];
    const theme = ctx.map.minigameThemes?.['memory_match'] ?? {};
    const icons = (Array.isArray(theme['icons']) ? theme['icons'] : []) as string[];
    const groupOf = (Array.isArray(theme['iconGroups']) ? theme['iconGroups'] : []) as string[];

    let durationMs = MEMORY_BASE_MS;
    let toleranceBonusMs = 0;
    let speed = 1;
    let extra = 0;
    let fog = false;
    let hint = false;
    const warnings: string[] = [];
    for (const m of ctx.modifiers) {
      switch (m.kind) {
        case 'timeDelta': durationMs += m.seconds * 1000; break;
        case 'tolerance':
          toleranceBonusMs = Math.min(MEMORY_TOLERANCE_PREVIEW_MAX_MS, Math.max(toleranceBonusMs, (1000 * (m.mult - 1)) / 0.3));
          break;
        case 'speed': speed *= m.mult; break;
        case 'extraTarget': extra = Math.min(extra + m.count, MEMORY_MAX_EXTRA); break;
        case 'fog': fog = true; break;
        case 'hint': hint = true; break;
        default: warnings.push(`memory_match: ignored modifier ${JSON.stringify(m)}`);
      }
    }
    durationMs += extra * MEMORY_EXTRA_MS_PER_COUNT; // outside the race-layer clamp (DR-17)
    const pairs = Math.min(k.pairs + extra, icons.length);

    // 1. shuffle the icon indices; 2. take icons round-robin per colour group; 3. shuffle the deck.
    const order = rng.shuffle(icons.map((_, i) => i));
    const groups: string[] = [];
    for (const i of order) {
      const g = groupOf[i] as string;
      if (!groups.includes(g)) groups.push(g);
    }
    const byGroup = new Map<string, number[]>(groups.map((g) => [g, []]));
    for (const i of order) (byGroup.get(groupOf[i] as string) as number[]).push(i);
    const chosen: number[] = [];
    for (let round = 0; chosen.length < pairs; round++) {
      let any = false;
      for (const g of groups) {
        const member = (byGroup.get(g) as number[])[round];
        if (member === undefined) continue;
        any = true;
        if (chosen.length < pairs) chosen.push(member);
      }
      if (!any) break;
    }
    const deck = rng.shuffle([...chosen, ...chosen].map((i) => icons[i] as string));
    const { cols, rows } = gridFor(pairs);

    return {
      durationMs,
      previewMs: Math.round(k.previewMs / speed + toleranceBonusMs),
      pairs,
      cols,
      rows,
      cards: deck,
      flipMs: Math.max(MEMORY_MIN_FLIP_MS, MEMORY_FLIP_MS / speed),
      mismatchDelayMs: Math.max(MEMORY_MIN_MISMATCH_MS, Math.round(k.mismatchDelayMs / speed)),
      peekAvailable: hint,
      peekMs: MEMORY_PEEK_MS,
      fog,
      warnings,
    };
  },

  initState(): MemoryState {
    return { tMs: 0, open: [], matched: [], closing: null, peekUsed: false, peekUntilMs: 0, mismatches: 0, lastTry: null, result: null };
  },

  step(level, prev, input, tMs) {
    if (prev.result) return prev;
    const t = Math.max(tMs, prev.tMs);
    const s: MemoryState = { ...prev, tMs: t };
    const playMs = t - level.previewMs;
    // Time-driven: a mismatch closes after its delay.
    if (s.closing && t >= s.closing.closeAtMs) {
      s.open = s.open.filter((c) => !(s.closing as { cards: number[] }).cards.includes(c));
      s.closing = null;
    }
    if (playMs >= level.durationMs) {
      s.tMs = level.previewMs + level.durationMs;
      s.result = { passed: false, timeTakenMs: s.tMs, progress: progressOf(level, s), reason: 'timeout' };
      return s;
    }
    if (!input || playMs < 0 || t < s.peekUntilMs) return s; // preview and peek ignore input

    if ('peek' in input) {
      if (!level.peekAvailable || s.peekUsed) return s;
      s.peekUsed = true;
      s.peekUntilMs = t + level.peekMs;
      s.open = []; // cards open before the peek close
      s.closing = null;
      return s;
    }

    const c = input.card;
    if (!Number.isInteger(c) || c < 0 || c >= level.cards.length) return s;
    if (s.matched.includes(c) || s.open.includes(c)) return s; // open or matched: ignored
    if (s.closing) {
      // Peek-ahead: tapping another closed card shuts the mismatch at once.
      s.open = [];
      s.closing = null;
    }
    if (s.open.length === 0) {
      s.open = [c];
      return s;
    }
    const first = s.open[0] as number;
    if (level.cards[first] === level.cards[c]) {
      s.matched = [...s.matched, first, c];
      s.open = [];
      s.lastTry = { tMs: t, kind: 'match', cards: [first, c] };
      if (s.matched.length >= level.cards.length) {
        s.result = { passed: true, timeTakenMs: t, progress: 1, reason: 'success' };
      }
    } else {
      s.open = [first, c];
      s.closing = { cards: [first, c], closeAtMs: t + level.mismatchDelayMs };
      s.mismatches += 1;
      s.lastTry = { tMs: t, kind: 'mismatch', cards: [first, c] };
    }
    return s;
  },

  result(_level, state) {
    return state.result;
  },
};
