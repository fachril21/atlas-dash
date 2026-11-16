/**
 * Movement rules (R6.1):
 * - Move only to an adjacent (connected) region.
 * - No backtracking: a region already on the player's path can never be entered again.
 * - No skipping: the current region's minigame must be won (phase "ready") before moving.
 *   A future "skip" card will bypass this via an explicit option, not by loosening the rule.
 * - Multiple players may occupy the same region: occupancy is never checked.
 */
import { neighbors, type MapGraph } from './map';
import type { PlayerState } from './state';

export type MoveRejectReason =
  | 'unknown-node'
  | 'player-finished'
  | 'region-not-cleared'
  | 'not-adjacent'
  | 'already-visited';

export type MoveCheck = { ok: true } | { ok: false; reason: MoveRejectReason };

export function validateMove(map: MapGraph, player: PlayerState, toNodeId: string): MoveCheck {
  if (!map.nodes.has(toNodeId)) return { ok: false, reason: 'unknown-node' };
  if (player.phase === 'finished') return { ok: false, reason: 'player-finished' };
  if (player.phase !== 'ready') return { ok: false, reason: 'region-not-cleared' };
  if (!neighbors(map, player.nodeId).includes(toNodeId)) return { ok: false, reason: 'not-adjacent' };
  if (player.path.includes(toNodeId)) return { ok: false, reason: 'already-visited' };
  return { ok: true };
}

/** All regions the player may move to right now (empty unless phase is "ready"). */
export function legalMoves(map: MapGraph, player: PlayerState): string[] {
  return neighbors(map, player.nodeId).filter((id) => validateMove(map, player, id).ok);
}

/** Regions adjacent and not yet visited, regardless of phase (for UI previews / bots planning). */
export function forwardNeighbors(map: MapGraph, player: PlayerState): string[] {
  return neighbors(map, player.nodeId).filter((id) => !player.path.includes(id));
}
