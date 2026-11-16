import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAction, type GameState, type MapData, type MapGraph } from '../src/logic';

export const ROOT = join(import.meta.dirname, '..');

/** Fresh deep copy of the real Indonesia map data. */
export function indonesiaData(): MapData {
  return JSON.parse(readFileSync(join(ROOT, 'public/maps/indonesia/map.json'), 'utf8')) as MapData;
}

/** Resolve any open card screen (offer/discard) with the auto rules, so pre-CP4 flows can keep going. */
export function settleCards(map: MapGraph, state: GameState): GameState {
  let s = state;
  for (const p of s.players) {
    while (s.players.find((x) => x.id === p.id)?.offer || s.players.find((x) => x.id === p.id)?.discard) {
      s = applyAction(map, s, { type: 'autoCards', playerId: p.id }).state;
    }
  }
  return s;
}
