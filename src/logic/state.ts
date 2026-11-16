/**
 * Game state: plain, serializable data (no classes, no functions) so it can be cloned,
 * saved, diffed in tests and later sent from a Colyseus server.
 */
import type { Difficulty, MapGraph } from './map';
import { Rng, type RngState } from './rng';

export type PlayerKind = 'human' | 'bot';
export type BotLevel = 'easy' | 'normal' | 'hard';

/**
 * - ready:     current region is cleared; the player may move to an adjacent region.
 * - challenge: the player is on an uncleared region and must win its minigame (no skipping).
 * - cooldown:  the player lost the minigame and waits before retrying (R2).
 * - finished:  the player reached a finish region (R1).
 */
export type PlayerPhase = 'ready' | 'challenge' | 'cooldown' | 'finished';

export interface PlayerState {
  id: string;
  name: string;
  kind: PlayerKind;
  botLevel?: BotLevel;
  /** Index into the render palette; logic does not know colours. */
  colorIndex: number;
  nodeId: string;
  /** Every region entered so far, in order, starting with the start node. */
  path: string[];
  phase: PlayerPhase;
  /** Game time (ms) when the cooldown ends; only meaningful in phase "cooldown". */
  cooldownUntilMs: number;
  /** Finishing place (1 = winner), set when phase becomes "finished". */
  place?: number;
  finishedAtMs?: number;
}

export interface GameState {
  mapId: string;
  seed: number;
  /** Game time in ms, advanced only by "tick" actions. */
  timeMs: number;
  status: 'running' | 'finished';
  winnerId: string | null;
  players: PlayerState[];
  /** Shared game RNG state (minigame/card rolls will draw from it). */
  rng: RngState;
}

export interface PlayerSetup {
  id: string;
  name: string;
  kind: PlayerKind;
  botLevel?: BotLevel;
}

/** R2 starting point: easy 12 s, medium 8 s, hard 4 s. Tune in playtest. */
export const COOLDOWN_MS: Readonly<Record<Difficulty, number>> = {
  easy: 12_000,
  medium: 8_000,
  hard: 4_000,
};

export const MAX_PLAYERS = 4;

export function createInitialState(map: MapGraph, players: PlayerSetup[], seed: number): GameState {
  if (players.length < 1 || players.length > MAX_PLAYERS) {
    throw new RangeError(`need 1-${MAX_PLAYERS} players, got ${players.length}`);
  }
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) throw new Error('duplicate player ids');

  const start = map.data.startNodeId;
  return {
    mapId: map.data.id,
    seed,
    timeMs: 0,
    status: 'running',
    winnerId: null,
    players: players.map((p, i) => {
      const ps: PlayerState = {
        id: p.id,
        name: p.name,
        kind: p.kind,
        colorIndex: i,
        nodeId: start,
        path: [start],
        phase: 'ready', // the start region counts as cleared
        cooldownUntilMs: 0,
      };
      if (p.botLevel) ps.botLevel = p.botLevel;
      return ps;
    }),
    rng: new Rng(seed).getState(),
  };
}

export function getPlayer(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}
