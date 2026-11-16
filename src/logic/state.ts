/**
 * Game state: plain, serializable data (no classes, no functions), so it can be cloned,
 * deep-compared in tests, exported in the debug log and later sent from a server.
 *
 * Movement model (D-011, map-indonesia.md §1): a player stands on a conquered region
 * (`nodeId`), picks an outgoing neighbour as `targetId`, and needs `winsRequired` wins
 * there before the pawn moves.
 */
import type { Difficulty, MapGraph } from './map';
import type { MinigameModifier } from './minigames/types';
import { createStream, type RngState } from './rng';

export type PlayerKind = 'human' | 'bot';
export type BotLevel = 'easy' | 'normal' | 'hard';

/**
 * - idle:     in the race view (may be choosing a target, ready, or cooling down).
 * - playing:  a minigame attempt is running (intro included).
 * - finished: won the match (playerFinished).
 */
export type PlayerPhase = 'idle' | 'playing' | 'finished';

/** One physical card. `seq` = handSeq (order of entering the hand; lower = older), 0 until then. */
export interface CardInstance {
  uid: string;
  defId: string;
  seq: number;
  /** Sabotage in a `pending` zone: the player who sent it (the Cermin owner for a reflection). */
  source?: string;
}

/** The pick screen (cards.md §3, ui-flow §5). Timer is game time, so pause freezes it. */
export interface CardOffer {
  cards: CardInstance[];
  /** N: how many to take. */
  pick: number;
  /** Uids the player has marked so far (kept by the auto-pick). */
  marked: string[];
  expiresAtMs: number;
}

/** The discard screen (K1.1): the hand holds up to 9 cards until it is back to 5. */
export interface DiscardState {
  /** Cards that came from the latest pick ("BARU"). */
  newUids: string[];
  marked: string[];
  expiresAtMs: number;
}

export interface Attempt {
  minigameId: string;
  targetId: string;
  /** Difficulty of the region type, before cards. */
  baseDifficulty: Difficulty;
  /** Modifiers snapshotted from pending cards at Mulai (DR-48). */
  modifiers: MinigameModifier[];
  /** Pending cards consumed by this attempt (they stay in `pending` until it ends). */
  cardUids: string[];
  /** Conditional effects resolved at Mulai, applied by the result. */
  onFail: { noCooldown: boolean; cooldownDeltaMs: number };
  onWin: { pickDelta: number; winMultiplier: number };
  /** ctx.seed, from "minigameParams:<targetId>:<attemptIndex>". */
  seed: number;
  /** Effective difficulty (after Santai Dulu etc.): drives cooldown and N. */
  difficulty: Difficulty;
  attemptIndex: number;
  /** 3000 for a freshly drawn minigame, 1500 for a retry after a fail (DR-02). */
  introMs: number;
  startedAtMs: number;
}

export interface PlayerState {
  id: string;
  name: string;
  kind: PlayerKind;
  botLevel?: BotLevel;
  colorIndex: number;
  /** Conquered region the pawn stands on (finish once the player has won). */
  nodeId: string;
  /** Regions conquered so far, in order, starting with the start region. */
  path: string[];
  targetId: string | null;
  winsAtTarget: number;
  phase: PlayerPhase;
  /** Game time (ms) when the cooldown ends; 0 = none. Belongs to the player, not the target. */
  cooldownUntilMs: number;
  /** Minigame armed for the current target (drawn on target select / after a win). */
  nextMinigameId: string | null;
  /** True when the armed minigame is a retry of a failed attempt (1.5 s intro). */
  retry: boolean;
  lastMinigameId: string | null;
  /** attemptIndex per target: attempts made on that target so far (never reset). */
  attempts: Record<string, number>;
  attempt: Attempt | null;
  /** "minigamePick" stream state. */
  pickRng: RngState;
  /** "cards" stream state (offers). */
  cardsRng: RngState;
  /** "copet" stream state (Copet steals, cards.md §2.2.4). */
  copetRng: RngState;
  /** Hand (max 5; more only while the discard screen is open or the owner is in a minigame). */
  hand: CardInstance[];
  /** Next handSeq to hand out. */
  nextHandSeq: number;
  /**
   * Played next_minigame cards waiting for (or inside) the next attempt, sabotage cards sent to
   * this player (each carries `source`), and an active defence card (Payung / Cermin).
   */
  pending: CardInstance[];
  /** Spent / discarded / unpicked cards. */
  discarded: CardInstance[];
  offer: CardOffer | null;
  discard: DiscardState | null;
  /** remainingWins and when it last changed (ranking tie-break). */
  remainingWins: number;
  remainingWinsSinceMs: number;
  place?: number;
  finishedAtMs?: number;
}

export interface GameState {
  mapId: string;
  presetId: string;
  matchSeed: number;
  /** Game time in ms; advanced only by "tick" actions, so pause freezes everything. */
  timeMs: number;
  status: 'running' | 'finished';
  winnerId: string | null;
  /** Next card instance number (uids are "c<n>"). */
  nextCardUid: number;
  /** Minigame ids available on this map (requires(map) passed). */
  pool: string[];
  players: PlayerState[];
}

export interface PlayerSetup {
  id: string;
  name: string;
  kind: PlayerKind;
  botLevel?: BotLevel;
}

/** R2: cooldown after a failed attempt, by effective difficulty. Tune in playtest. */
export const COOLDOWN_MS: Readonly<Record<Difficulty, number>> = {
  easy: 8_000,
  medium: 6_000,
  hard: 4_000,
};
export const INTRO_MS = 3000;
export const RETRY_INTRO_MS = 1500;
export const RESULT_BANNER_MS = 1200;
export const MAX_PLAYERS = 4;

export function createInitialState(
  map: MapGraph,
  players: PlayerSetup[],
  matchSeed: number,
  pool: string[],
): GameState {
  if (players.length < 1 || players.length > MAX_PLAYERS) {
    throw new RangeError(`need 1-${MAX_PLAYERS} players, got ${players.length}`);
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error('duplicate player ids');
  if (pool.length === 0) throw new Error('empty minigame pool');

  const start = map.startId;
  const total = remainingWinsFor(map, start, null, 0);
  return {
    mapId: map.data.id,
    presetId: map.presetId,
    matchSeed: matchSeed >>> 0,
    timeMs: 0,
    nextCardUid: 1,
    status: 'running',
    winnerId: null,
    pool: pool.slice(),
    players: players.map((p, i) => {
      const ps: PlayerState = {
        id: p.id,
        name: p.name,
        kind: p.kind,
        colorIndex: i,
        nodeId: start,
        path: [start],
        targetId: null,
        winsAtTarget: 0,
        phase: 'idle',
        cooldownUntilMs: 0,
        nextMinigameId: null,
        retry: false,
        lastMinigameId: null,
        attempts: {},
        attempt: null,
        pickRng: createStream(matchSeed, p.id, 'minigamePick').getState(),
        cardsRng: createStream(matchSeed, p.id, 'cards').getState(),
        copetRng: createStream(matchSeed, p.id, 'copet').getState(),
        hand: [],
        nextHandSeq: 1,
        pending: [],
        discarded: [],
        offer: null,
        discard: null,
        remainingWins: total,
        remainingWinsSinceMs: 0,
      };
      if (p.botLevel) ps.botLevel = p.botLevel;
      return ps;
    }),
  };
}

/**
 * remainingWins (gdd.md, DR-07), W = winsRequired:
 * - no target or w = 0: W × playDist(n)
 * - with target:        min(W × playDist(t) + (W − w), W × playDist(n))
 */
export function remainingWinsFor(map: MapGraph, nodeId: string, targetId: string | null, winsAtTarget: number): number {
  const W = map.winsRequired;
  if (nodeId === map.finishId) return 0;
  const fromNode = W * (map.playDist.get(nodeId) ?? 0);
  if (!targetId || winsAtTarget === 0) return fromNode;
  const fromTarget = W * (map.playDist.get(targetId) ?? 0) + (W - winsAtTarget);
  return Math.min(fromTarget, fromNode);
}

/** HUD "total" = remainingWins at the start (Indonesia: 8). */
export function totalWins(map: MapGraph): number {
  return remainingWinsFor(map, map.startId, null, 0);
}

export function getPlayer(state: Readonly<GameState>, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

export function cooldownRemainingMs(state: Readonly<GameState>, p: PlayerState): number {
  return Math.max(0, p.cooldownUntilMs - state.timeMs);
}

/**
 * Ranking (gdd.md): winner first; then remainingWins ascending; ties: whoever reached
 * their current value earlier; then seat order.
 */
export function ranking(state: Readonly<GameState>): PlayerState[] {
  return state.players
    .map((p, seat) => ({ p, seat }))
    .sort((a, b) => {
      const pa = a.p.place ?? Infinity;
      const pb = b.p.place ?? Infinity;
      if (pa !== pb) return pa - pb;
      if (a.p.remainingWins !== b.p.remainingWins) return a.p.remainingWins - b.p.remainingWins;
      if (a.p.remainingWinsSinceMs !== b.p.remainingWinsSinceMs) return a.p.remainingWinsSinceMs - b.p.remainingWinsSinceMs;
      return a.seat - b.seat;
    })
    .map((x) => x.p);
}
