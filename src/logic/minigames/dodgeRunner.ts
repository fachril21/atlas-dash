/**
 * Hindari Rintangan (`dodge_runner`), pure rules. Spec: minigames.md §4.
 * Three lanes, rows of obstacles. Collision is purely time based (no 3D positions): a row
 * hits if, at any moment in [tHit - hw, tHit + hw], the pawn's logical lane is blocked.
 * Speed (m/s) only sets the visual distance = speed x time.
 */
import type { Difficulty, MapData } from '../map';
import { Rng } from '../rng';
import type { MinigameContext, MinigameLogic, MinigameResult } from './types';

export type Lane = -1 | 0 | 1;

export const DODGE_BASE_MS = 20_000;
export const DODGE_KNOBS: Readonly<Record<Difficulty, {
  lives: number;
  speedMps: number;
  intervalMs: number;
  twoLaneChance: number;
  iFrameMs: number;
}>> = {
  easy: { lives: 3, speedMps: 6, intervalMs: 1200, twoLaneChance: 0, iFrameMs: 1000 },
  medium: { lives: 2, speedMps: 8, intervalMs: 900, twoLaneChance: 0.2, iFrameMs: 1000 },
  hard: { lives: 1, speedMps: 10, intervalMs: 650, twoLaneChance: 0.4, iFrameMs: 0 },
};
export const DODGE_FIRST_ROW_MS = 2000;
export const DODGE_HIT_HALF_WINDOW_MS = 150;
export const DODGE_LANE_CHANGE_MS = 120;
/** The logical lane changes this long after the input (tween is 120 ms, logic switches mid-way). */
export const DODGE_LANE_SWITCH_DELAY_MS = 60;
export const DODGE_VISIBLE_M = 40;
export const DODGE_M_MIN = 0.7;
export const DODGE_M_MAX = 1.5;
export const DODGE_TIME_DELTA_PER_SEC = 0.03;
export const DODGE_MIN_HIT_WINDOW_MS = 60;
export const DODGE_MAX_EXTRA = 2;
export const DODGE_EXTRA_MS_PER_COUNT = 5000;
export const DODGE_FOG_FACTOR = 0.6;
export const DODGE_HINT_LEAD_MS = 500;
/** Gesture thresholds used by the view (kept here so tests and view agree). */
export const SWIPE_MIN_PX = 24;
export const TAP_HOLD_MS = 100;

export interface DodgeRow {
  tHitMs: number;
  /** Blocked lanes, ascending; never all three. */
  blocked: Lane[];
  /** One obstacle prop id per blocked lane. */
  props: string[];
}

export interface DodgeLevel {
  durationMs: number;
  lives: number;
  iFrameMs: number;
  /** Visual metres per second, already x M. */
  speedMps: number;
  /** Effective interval, already / M. */
  intervalMs: number;
  firstRowMs: number;
  hitHalfWindowMs: number;
  laneChangeMs: number;
  rows: DodgeRow[];
  visibleDistanceM: number;
  hintLeadMs: number;
  /** The tempo multiplier M that was applied. */
  tempo: number;
  warnings: string[];
}

export type DodgeInput = { dir: -1 | 1 };

export interface DodgeMove {
  /** Input (decision) time. */
  inputMs: number;
  /** Time the logical lane changes. */
  atMs: number;
  from: Lane;
  to: Lane;
}

export interface DodgeState {
  tMs: number;
  lives: number;
  /** Lane the pawn is heading to (last move's target). */
  targetLane: Lane;
  moves: DodgeMove[];
  /** Index of the next row to evaluate. */
  nextRow: number;
  /** Time until which collisions are ignored (exclusive). */
  iFrameUntilMs: number;
  /** Rows that hit, with the collision time, for view feedback. */
  hits: { row: number; atMs: number }[];
  /** Rows that were evaluated and dodged. */
  dodged: number;
  result: MinigameResult | null;
}

export function dodgeRequires(map: MapData): boolean {
  const o = map.minigameThemes?.['dodge_runner']?.['obstacles'];
  return Array.isArray(o) && o.length >= 3;
}

/** Tempo multiplier M (DR-16): speed x (1 - 0.03 x sum timeDelta), clamped 0.70..1.50. */
export function tempoMultiplier(speedMult: number, timeDeltaSeconds: number): number {
  const m = speedMult * (1 - DODGE_TIME_DELTA_PER_SEC * timeDeltaSeconds);
  return Math.min(DODGE_M_MAX, Math.max(DODGE_M_MIN, m));
}

/** Logical lane at time t from the move history (a move applies from its atMs, inclusive). */
export function laneAt(moves: readonly DodgeMove[], t: number): Lane {
  let lane: Lane = 0;
  for (const m of moves) {
    if (m.atMs <= t) lane = m.to;
    else break;
  }
  return lane;
}

export function rowEvalMs(level: DodgeLevel, row: DodgeRow): number {
  return row.tHitMs + level.hitHalfWindowMs;
}

/** First moment in the row's window where the pawn stands in a blocked lane, or null. */
export function rowCollisionMs(level: DodgeLevel, moves: readonly DodgeMove[], row: DodgeRow): number | null {
  const start = row.tHitMs - level.hitHalfWindowMs;
  const end = row.tHitMs + level.hitHalfWindowMs;
  if (row.blocked.includes(laneAt(moves, start))) return start;
  for (const m of moves) {
    if (m.atMs > start && m.atMs <= end && row.blocked.includes(m.to)) return m.atMs;
  }
  return null;
}

function clampLane(n: number): Lane {
  return Math.max(-1, Math.min(1, n)) as Lane;
}

export const dodgeRunnerLogic: MinigameLogic<DodgeLevel, DodgeInput, DodgeState> = {
  id: 'dodge_runner',
  render: '3d',
  introKey: 'mg.dodge_runner.intro',
  baseDurationMs: DODGE_BASE_MS,
  requires: dodgeRequires,

  generateLevel(ctx: MinigameContext): DodgeLevel {
    const rng = new Rng(ctx.seed);
    const k = DODGE_KNOBS[ctx.difficulty];
    let speedMult = 1;
    let timeDelta = 0;
    let tolerance = 1;
    let extra = 0;
    let fog = false;
    let hint = false;
    const warnings: string[] = [];
    for (const m of ctx.modifiers) {
      switch (m.kind) {
        case 'timeDelta': timeDelta += m.seconds; break; // does not change the duration here
        case 'tolerance': tolerance *= m.mult; break;
        case 'speed': speedMult *= m.mult; break;
        case 'extraTarget': extra = Math.min(extra + m.count, DODGE_MAX_EXTRA); break;
        case 'fog': fog = true; break;
        case 'hint': hint = true; break;
        default: warnings.push(`dodge_runner: ignored modifier ${JSON.stringify(m)}`);
      }
    }
    const M = tempoMultiplier(speedMult, timeDelta);
    const hw = Math.max(DODGE_MIN_HIT_WINDOW_MS, DODGE_HIT_HALF_WINDOW_MS / tolerance);
    const absorbed = Math.min(extra, k.lives - 1);
    const lives = k.lives - absorbed;
    const durationMs = DODGE_BASE_MS + (extra - absorbed) * DODGE_EXTRA_MS_PER_COUNT;
    const intervalMs = k.intervalMs / M;

    const obstacles = (ctx.map.minigameThemes?.['dodge_runner']?.['obstacles'] ?? []) as string[];
    if (obstacles.length === 0) throw new Error('dodge_runner: map has no obstacle props');

    // Per row, in order: 2-lane? (always one draw), lane (empty lane for a 2-lane row,
    // blocked lane for a 1-lane row), then one prop per blocked lane. A fairness redraw picks
    // one extra value from the allowed lanes.
    const rows: DodgeRow[] = [];
    let prevEmpty: Lane | null = null;
    for (let i = 0; ; i++) {
      const tHitMs = DODGE_FIRST_ROW_MS + i * intervalMs;
      if (tHitMs + hw > durationMs) break;
      const two = rng.next() < k.twoLaneChance;
      let lane = (rng.int(0, 2) - 1) as Lane;
      let blocked: Lane[];
      if (two) {
        if (prevEmpty !== null && Math.abs(lane - prevEmpty) > 1) {
          const allowed = ([-1, 0, 1] as Lane[]).filter((l) => Math.abs(l - (prevEmpty as Lane)) <= 1);
          lane = rng.pick(allowed);
        }
        blocked = ([-1, 0, 1] as Lane[]).filter((l) => l !== lane);
        prevEmpty = lane;
      } else {
        blocked = [lane];
        prevEmpty = null;
      }
      rows.push({ tHitMs, blocked, props: blocked.map(() => rng.pick(obstacles)) });
    }

    return {
      durationMs,
      lives,
      iFrameMs: k.iFrameMs * tolerance,
      speedMps: k.speedMps * M,
      intervalMs,
      firstRowMs: DODGE_FIRST_ROW_MS,
      hitHalfWindowMs: hw,
      laneChangeMs: DODGE_LANE_CHANGE_MS,
      rows,
      visibleDistanceM: DODGE_VISIBLE_M * (fog ? DODGE_FOG_FACTOR : 1),
      hintLeadMs: hint ? DODGE_HINT_LEAD_MS : 0,
      tempo: M,
      warnings,
    };
  },

  initState(level): DodgeState {
    return {
      tMs: 0,
      lives: level.lives,
      targetLane: 0,
      moves: [],
      nextRow: 0,
      iFrameUntilMs: 0,
      hits: [],
      dodged: 0,
      result: null,
    };
  },

  step(level, prev, input, tMs) {
    if (prev.result) return prev;
    const t = Math.max(tMs, prev.tMs);
    const s: DodgeState = { ...prev, hits: prev.hits, moves: prev.moves };
    const horizon = Math.min(t, level.durationMs);

    // Grade every row whose window has fully passed, from the move history (frame-rate independent).
    while (s.nextRow < level.rows.length) {
      const row = level.rows[s.nextRow] as DodgeRow;
      if (rowEvalMs(level, row) > horizon) break;
      const windowStart = row.tHitMs - level.hitHalfWindowMs;
      const c = windowStart < s.iFrameUntilMs ? null : rowCollisionMs(level, s.moves, row);
      const index = s.nextRow;
      s.nextRow += 1;
      if (c === null) {
        s.dodged += 1;
        continue;
      }
      s.lives -= 1;
      s.iFrameUntilMs = c + level.iFrameMs;
      s.hits = [...s.hits, { row: index, atMs: c }];
      if (s.lives <= 0) {
        s.tMs = Math.max(prev.tMs, Math.min(t, level.durationMs));
        s.result = { passed: false, timeTakenMs: c, progress: Math.min(1, c / level.durationMs), reason: 'failLimit' };
        return s;
      }
    }

    if (t >= level.durationMs) {
      s.tMs = level.durationMs;
      s.result = { passed: true, timeTakenMs: level.durationMs, progress: 1, reason: 'success' };
      return s;
    }
    s.tMs = t;
    if (input) {
      const to = clampLane(s.targetLane + input.dir);
      if (to !== s.targetLane) {
        s.moves = [...s.moves, { inputMs: t, atMs: t + DODGE_LANE_SWITCH_DELAY_MS, from: s.targetLane, to }];
        s.targetLane = to;
      }
    }
    return s;
  },

  result(_level, state) {
    return state.result;
  },
};
