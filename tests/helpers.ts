import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAction, SmartBotController, type BotLevel, type GameState, type MapData, type MapGraph } from '../src/logic';

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

/** One controller per bot seat (same seed the state was created with). */
export function botControllers(state: GameState, level: BotLevel = 'normal'): Map<string, SmartBotController> {
  return new Map(state.players.filter((p) => p.kind === 'bot').map((p) => [p.id, new SmartBotController(p.id, state.matchSeed, level)]));
}

/**
 * CP5a invariant: a bot's card screen is answered by its controller with one atomic chooseCards
 * at the first poll after it opens (the overflow Discard that a won offer can open is a second
 * screen, so up to two polls in a row). Throws if a bot does anything else, or a screen survives.
 */
export function answerBotScreens(map: MapGraph, state: GameState, ctls: ReadonlyMap<string, SmartBotController>): GameState {
  let s = state;
  for (let round = 0; round < 2; round++) {
    let any = false;
    for (const [id, ctl] of ctls) {
      const p = s.players.find((x) => x.id === id);
      if (!p || (!p.offer && !p.discard)) continue;
      any = true;
      const a = ctl.nextAction(s, map);
      if (!a || a.type !== 'chooseCards') throw new Error(`bot ${id} did not answer its card screen: ${JSON.stringify(a)}`);
      const r = applyAction(map, s, a);
      const e = r.events[0];
      if (e?.type === 'actionRejected') throw new Error(`bot ${id} chooseCards rejected: ${e.reason}`);
      s = r.state;
    }
    if (!any) break;
  }
  const left = s.players.find((p) => ctls.has(p.id) && (p.offer || p.discard));
  if (left) throw new Error(`bot ${left.id} screen still open after its polls`);
  return s;
}
