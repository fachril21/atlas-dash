/** Registry of the pure minigame halves, and minigame selection rules (minigames.md §1.3). */
import type { MapData } from '../map';
import { Rng, type RngState } from '../rng';
import { tapTimingLogic } from './tapTiming';
import type { MinigameLogic } from './types';

export * from './types';
export * from './tapTiming';

/** CP3a pool: Tap Tepat Waktu only. */
export const MINIGAME_LOGIC: readonly MinigameLogic<any, any, any>[] = [tapTimingLogic];

export function getMinigameLogic(id: string): MinigameLogic<any, any, any> {
  const mg = MINIGAME_LOGIC.find((m) => m.id === id);
  if (!mg) throw new Error(`unknown minigame "${id}"`);
  return mg;
}

/** Ids of minigames whose requires(map) passes. */
export function minigamePool(map: MapData): string[] {
  return MINIGAME_LOGIC.filter((m) => !m.requires || m.requires(map)).map((m) => m.id);
}

/**
 * One draw from the player's "minigamePick" stream. Excludes the last played minigame
 * unless the pool has a single entry. Returns the new stream state.
 */
export function pickMinigame(pool: readonly string[], rngState: RngState, lastId: string | null): { id: string; rng: RngState } {
  if (pool.length === 0) throw new Error('empty minigame pool');
  const rng = Rng.fromState(rngState);
  const candidates = pool.length > 1 && lastId !== null ? pool.filter((id) => id !== lastId) : pool;
  const id = rng.pick(candidates.length > 0 ? candidates : pool);
  return { id, rng: rng.getState() };
}
