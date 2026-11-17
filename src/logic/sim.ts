/**
 * Headless match simulator (bots.md §9-§11): runs whole matches with SmartBotController seats
 * only (bots and the reference humans), in skip-ahead mode, and summarises them. Pure logic, no
 * DOM; the CLI wrapper is scripts/sim.ts (`npm run sim`).
 */
import { GameSession } from './session';
import { SmartBotController } from './smartBot';
import { createInitialState, type BotLevel, type GameState } from './state';
import type { BotProfile } from './botProfiles';
import type { MapGraph } from './map';
import { streamSeed } from './rng';

export interface SimSeat {
  id: string;
  kind: 'human' | 'bot';
  profile: BotProfile;
  /** Shown in the state for bots (HUD); the profile is what drives behaviour. */
  botLevel?: BotLevel;
}

export interface SimMatchOptions {
  map: MapGraph;
  pool: string[];
  seed: number;
  seats: readonly SimSeat[];
  /** Give up after this much game time (a stuck match is reported, not hung). */
  maxTimeMs?: number;
  /** Poll every 50 ms step instead of skipping ahead (slow; used to prove both agree). */
  stepwise?: boolean;
}

export interface SimMatchResult {
  seed: number;
  winnerId: string | null;
  timeMs: number;
  timedOut: boolean;
  /** actionRejected events from any seat: must be 0 for bots (§11 #1). */
  rejected: number;
  rejectedSamples: string[];
  state: Readonly<GameState>;
  session: GameSession;
}

export function simulateMatch(opts: SimMatchOptions): SimMatchResult {
  const { map, seed, seats } = opts;
  const initial = createInitialState(
    map,
    seats.map((s) => ({ id: s.id, name: s.id, kind: s.kind, ...(s.botLevel ? { botLevel: s.botLevel } : {}) })),
    seed,
    opts.pool,
  );
  const session = new GameSession(map, initial, seats.map((s) => new SmartBotController(s.id, seed, s.profile)));
  let rejected = 0;
  const rejectedSamples: string[] = [];
  session.subscribe((_state, events) => {
    for (const e of events) {
      if (e.type !== 'actionRejected') continue;
      rejected++;
      if (rejectedSamples.length < 5) rejectedSamples.push(`${e.action.type}:${e.reason}`);
    }
  });
  const maxTimeMs = opts.maxTimeMs ?? 90 * 60_000;
  while (session.state.status === 'running' && session.state.timeMs < maxTimeMs) {
    if (opts.stepwise) session.step();
    else session.stepToNextWake();
  }
  return {
    seed,
    winnerId: session.state.winnerId,
    timeMs: session.state.timeMs,
    timedOut: session.state.status === 'running',
    rejected,
    rejectedSamples,
    state: session.state,
    session,
  };
}

/** Deterministic per-match seed from a base seed, a cell label and the match index. */
export function simSeed(baseSeed: number, label: string, index: number): number {
  return streamSeed(baseSeed, label, `match:${index}`);
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

export interface CellSummary {
  matches: number;
  /** Win share of the first seat. */
  winRate: number;
  /** Win share per seat id. */
  wins: Record<string, number>;
  medianMin: number;
  p5Min: number;
  p95Min: number;
  rejected: number;
  timedOut: number;
}

/** Run `n` matches with the same seats and summarise (the first seat is "the human" of the cell). */
export function runCell(base: Omit<SimMatchOptions, 'seed'>, label: string, n: number, baseSeed = 1): CellSummary {
  const times: number[] = [];
  const wins: Record<string, number> = Object.fromEntries(base.seats.map((s) => [s.id, 0]));
  let rejected = 0;
  let timedOut = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateMatch({ ...base, seed: simSeed(baseSeed, label, i) });
    times.push(r.timeMs / 60_000);
    if (r.winnerId) wins[r.winnerId] = (wins[r.winnerId] ?? 0) + 1;
    rejected += r.rejected;
    if (r.timedOut) timedOut++;
  }
  times.sort((a, b) => a - b);
  const first = base.seats[0]?.id as string;
  return {
    matches: n,
    winRate: (wins[first] ?? 0) / n,
    wins,
    medianMin: quantile(times, 0.5),
    p5Min: quantile(times, 0.05),
    p95Min: quantile(times, 0.95),
    rejected,
    timedOut,
  };
}
