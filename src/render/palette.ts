/**
 * Placeholder look (R10, bright toy diorama). Map-specific colours (sky, sea) come from the
 * map theme; tile colours are keyed by difficulty so any map works without code changes.
 */
import type { Difficulty } from '../logic';

export const DIFFICULTY_TILE_COLORS: Readonly<Record<Difficulty, number>> = {
  easy: 0x8fdc6f,
  medium: 0xffd166,
  hard: 0xff8a65,
};
export const START_TILE_COLOR = 0xffffff;
export const FINISH_TILE_COLOR = 0xffe066;

/** Player colours by PlayerState.colorIndex (CSS twins in ui/hud.ts). */
export const PLAYER_COLORS: readonly number[] = [0xff4d6d, 0x3a86ff, 0x2ec4b6, 0xffb703];
export const PLAYER_CSS_COLORS: readonly string[] = ['#ff4d6d', '#3a86ff', '#2ec4b6', '#ffb703'];

export const PATH_COLOR = 0xfff4dc;
export const HIGHLIGHT_COLOR = 0xffffff;
export const TARGET_COLOR = 0xff4d6d;
export const FALLBACK_SKY = '#bfe9ff';
export const FALLBACK_SEA = '#7fd3f7';
