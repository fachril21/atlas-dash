/** Registry of the pure minigame halves, and minigame selection rules (minigames.md §1.3). */
import type { MapData } from '../map';
import { Rng, type RngState } from '../rng';
import { dodgeRunnerLogic } from './dodgeRunner';
import { guessLocationLogic } from './guessLocation';
import { memoryMatchLogic } from './memoryMatch';
import { simonLogic } from './simon';
import { slingshotLogic } from './slingshot';
import { tapTimingLogic } from './tapTiming';
import { whackAMoleLogic } from './whackAMole';
import type { MinigameLogic } from './types';

export * from './types';
export * from './tapTiming';
export * from './simon';
export * from './dodgeRunner';
export * from './whackAMole';
export * from './slingshot';
export * from './memoryMatch';
export * from './guessLocation';
export * from './solvers';

/**
 * Registry: fixed order, as in minigames.md §9 (§1.3 step 1). Never reorder; the pick depends on it.
 * A minigame may enter only if its modifier table maps all six kinds (cards.md §5): each logic
 * handles timeDelta/tolerance/speed/extraTarget/fog/hint (tested in tests/cp5b.test.ts).
 */
export const MINIGAME_LOGIC: readonly MinigameLogic<any, any, any>[] = [
  tapTimingLogic,
  simonLogic,
  dodgeRunnerLogic,
  whackAMoleLogic,
  slingshotLogic,
  memoryMatchLogic,
  guessLocationLogic,
];

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
 * Draw per minigames.md §1.3: candidates = pool without `lastId` (the last minigame the player
 * played, failed attempts included); if that leaves nothing, the whole pool. Always exactly one
 * draw from the player's "minigamePick" stream, even with a single candidate.
 * `pool` must keep registry order (minigamePool does). Returns the new stream state.
 */
export function pickMinigame(pool: readonly string[], rngState: RngState, lastId: string | null): { id: string; rng: RngState } {
  if (pool.length === 0) throw new Error('empty minigame pool');
  const rng = Rng.fromState(rngState);
  const filtered = pool.filter((id) => id !== lastId);
  const candidates = filtered.length > 0 ? filtered : pool;
  const id = candidates[rng.int(0, candidates.length - 1)] as string;
  return { id, rng: rng.getState() };
}
