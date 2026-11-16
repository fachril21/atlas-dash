/**
 * Tap Tepat Waktu (`tap_timing`), pure rules. Spec: minigames.md §2.
 * A needle bounces along a bar; tap while its centre is inside the green zone.
 */
import type { Difficulty } from '../map';
import { Rng } from '../rng';
import type { MinigameContext, MinigameLogic, MinigameResult } from './types';

export const TAP_TIMING_KNOBS: Readonly<Record<Difficulty, {
  hitsRequired: number;
  missesAllowed: number;
  zoneWidth: number;
  needleSpeed: number;
  zoneMoveSpeed: number;
}>> = {
  easy: { hitsRequired: 3, missesAllowed: 2, zoneWidth: 0.22, needleSpeed: 0.8, zoneMoveSpeed: 0 },
  medium: { hitsRequired: 3, missesAllowed: 1, zoneWidth: 0.15, needleSpeed: 1.2, zoneMoveSpeed: 0 },
  hard: { hitsRequired: 3, missesAllowed: 0, zoneWidth: 0.09, needleSpeed: 1.7, zoneMoveSpeed: 0.15 },
};

export const TAP_TIMING_BASE_MS = 20_000;
/** After any tap, further taps are ignored (not misses) for this long. */
export const TAP_LOCK_MS = 250;
export const ZONE_MIN = 0.05;
export const ZONE_MAX = 0.95;
export const MIN_ZONE_CENTER_GAP = 0.25;
export const MAX_ZONE_WIDTH = 0.4;
export const MAX_EXTRA_TARGET = 2;
export const SPARE_ZONES = 2;
export const FOG_PIECE_WIDTH = 0.2;
export const FOG_INTERVAL_MS = 2000;

export interface TapTimingLevel {
  durationMs: number;
  hitsRequired: number;
  missesAllowed: number;
  zoneWidth: number;
  /** Bar widths per second, speed factor U(0.9, 1.1) already applied. */
  needleSpeed: number;
  zoneMoveSpeed: number;
  /** Left edges of successive zones (hitsRequired + spare). */
  zoneStarts: number[];
  /** 0 or 1; the needle moves towards the centre first. */
  needleStart: 0 | 1;
  /** Initial zone move direction (only matters when zoneMoveSpeed > 0). */
  zoneDir: 1 | -1;
  hint: boolean;
  /** Fog layout per 2 s slot: left edges of the two fog pieces. Empty without the fog modifier. */
  fog: [number, number][];
  /** Unknown/ignored modifiers, for the host to log. */
  warnings: string[];
}

export type TapTimingInput = { kind: 'tap' };

export interface TapTimingState {
  tMs: number;
  hits: number;
  misses: number;
  lockUntilMs: number;
  zoneIndex: number;
  /** Current zone segment: left edge at segStartMs, moving in segDir. */
  segBase: number;
  segStartMs: number;
  segDir: 1 | -1;
  /** Last tap outcome, for feedback in the view. */
  lastTap: { tMs: number; hit: boolean } | null;
  result: MinigameResult | null;
}

/** Bounce x inside [lo, hi]: returns position and current direction of travel. */
export function pingPong(start: number, dir: 1 | -1, speed: number, tSec: number, lo: number, hi: number): { pos: number; dir: 1 | -1 } {
  const len = hi - lo;
  if (len <= 0 || speed === 0) return { pos: Math.min(Math.max(start, lo), Math.max(lo, hi)), dir };
  // Unfold: distance travelled from lo along a 2*len loop.
  const startU = dir === 1 ? start - lo : 2 * len - (start - lo);
  let u = (startU + speed * tSec) % (2 * len);
  if (u < 0) u += 2 * len;
  return u <= len ? { pos: lo + u, dir: 1 } : { pos: hi - (u - len), dir: -1 };
}

export function needleAt(level: TapTimingLevel, tMs: number): number {
  return pingPong(level.needleStart, level.needleStart === 0 ? 1 : -1, level.needleSpeed, tMs / 1000, 0, 1).pos;
}

export function zoneAt(level: TapTimingLevel, state: TapTimingState, tMs: number): { start: number; dir: 1 | -1 } {
  const r = pingPong(state.segBase, state.segDir, level.zoneMoveSpeed, (tMs - state.segStartMs) / 1000, ZONE_MIN, ZONE_MAX - level.zoneWidth);
  return { start: r.pos, dir: r.dir };
}

function generateZones(rng: Rng, count: number, width: number): number[] {
  const lo = ZONE_MIN;
  const hi = ZONE_MAX - width;
  const zones: number[] = [];
  for (let i = 0; i < count; i++) {
    const prev = zones[i - 1];
    let pick = rng.range(lo, hi);
    if (prev !== undefined) {
      let tries = 0;
      while (Math.abs(pick - prev) < MIN_ZONE_CENTER_GAP && tries < 50) {
        pick = rng.range(lo, hi);
        tries++;
      }
      if (Math.abs(pick - prev) < MIN_ZONE_CENTER_GAP) {
        // Fallback: the end of the range farthest from the previous zone.
        pick = prev - lo > hi - prev ? lo : hi;
      }
    }
    zones.push(pick);
  }
  return zones;
}

function overlap(a: number, aw: number, b: number, bw: number): number {
  return Math.max(0, Math.min(a + aw, b + bw) - Math.max(a, b));
}

export const tapTimingLogic: MinigameLogic<TapTimingLevel, TapTimingInput, TapTimingState> = {
  id: 'tap_timing',
  render: '2d',
  introKey: 'mg.tap_timing.intro',
  baseDurationMs: TAP_TIMING_BASE_MS,

  generateLevel(ctx: MinigameContext): TapTimingLevel {
    const rng = new Rng(ctx.seed);
    const k = TAP_TIMING_KNOBS[ctx.difficulty];
    let durationMs = TAP_TIMING_BASE_MS;
    let zoneWidth = k.zoneWidth;
    let speedMult = 1;
    let extra = 0;
    let fog = false;
    let hint = false;
    const warnings: string[] = [];
    for (const m of ctx.modifiers) {
      switch (m.kind) {
        case 'timeDelta': durationMs += m.seconds * 1000; break; // already clamped by the race layer
        case 'tolerance': zoneWidth = Math.min(zoneWidth * m.mult, MAX_ZONE_WIDTH); break;
        case 'speed': speedMult *= m.mult; break;
        case 'extraTarget': extra = Math.min(extra + m.count, MAX_EXTRA_TARGET); break;
        case 'fog': fog = true; break;
        case 'hint': hint = true; break;
        default: warnings.push(`tap_timing: ignored modifier ${JSON.stringify(m)}`);
      }
    }

    // Fixed draw order keeps levels stable when knobs change.
    const zoneStarts = generateZones(rng, k.hitsRequired + SPARE_ZONES, zoneWidth);
    const needleStart: 0 | 1 = rng.chance(0.5) ? 0 : 1;
    const speedFactor = rng.range(0.9, 1.1);
    const zoneDir: 1 | -1 = rng.chance(0.5) ? 1 : -1;

    const fogSlots: [number, number][] = [];
    if (fog) {
      const slots = Math.ceil(durationMs / FOG_INTERVAL_MS);
      for (let s = 0; s < slots; s++) {
        const pieces: number[] = [];
        for (let p = 0; p < 2; p++) {
          let x = rng.range(0, 1 - FOG_PIECE_WIDTH);
          for (let tries = 0; tries < 30; tries++) {
            const ok = zoneStarts.every((z) => overlap(x, FOG_PIECE_WIDTH, z, zoneWidth) <= zoneWidth * 0.5);
            if (ok) break;
            x = rng.range(0, 1 - FOG_PIECE_WIDTH);
          }
          pieces.push(x);
        }
        fogSlots.push([pieces[0] as number, pieces[1] as number]);
      }
    }

    return {
      durationMs,
      hitsRequired: k.hitsRequired + extra,
      missesAllowed: k.missesAllowed,
      zoneWidth,
      needleSpeed: k.needleSpeed * speedMult * speedFactor,
      zoneMoveSpeed: k.zoneMoveSpeed * speedMult,
      zoneStarts,
      needleStart,
      zoneDir,
      hint,
      fog: fogSlots,
      warnings,
    };
  },

  initState(level: TapTimingLevel): TapTimingState {
    return {
      tMs: 0,
      hits: 0,
      misses: 0,
      lockUntilMs: 0,
      zoneIndex: 0,
      segBase: level.zoneStarts[0] as number,
      segStartMs: 0,
      segDir: level.zoneDir,
      lastTap: null,
      result: null,
    };
  },

  step(level, prev, input, tMs) {
    if (prev.result) return prev;
    const t = Math.max(tMs, prev.tMs); // time never runs backwards
    const progress = (hits: number) => Math.min(1, hits / level.hitsRequired);
    if (t >= level.durationMs) {
      return {
        ...prev,
        tMs: level.durationMs,
        result: { passed: false, timeTakenMs: level.durationMs, progress: progress(prev.hits), reason: 'timeout' },
      };
    }
    const s: TapTimingState = { ...prev, tMs: t };
    if (!input || t < prev.lockUntilMs) return s;

    s.lockUntilMs = t + TAP_LOCK_MS;
    const p = needleAt(level, t);
    const zone = zoneAt(level, prev, t);
    const hit = zone.start <= p && p <= zone.start + level.zoneWidth; // inclusive edges
    s.lastTap = { tMs: t, hit };
    if (hit) {
      s.hits = prev.hits + 1;
      if (s.hits >= level.hitsRequired) {
        s.result = { passed: true, timeTakenMs: t, progress: 1, reason: 'success' };
        return s;
      }
      s.zoneIndex = prev.zoneIndex + 1;
      s.segBase = level.zoneStarts[s.zoneIndex % level.zoneStarts.length] as number;
      s.segStartMs = t;
      s.segDir = zone.dir; // keep moving the same way
    } else {
      s.misses = prev.misses + 1;
      if (s.misses > level.missesAllowed) {
        s.result = { passed: false, timeTakenMs: t, progress: progress(prev.hits), reason: 'failLimit' };
      }
    }
    return s;
  },

  result(_level, state) {
    return state.result;
  },
};
