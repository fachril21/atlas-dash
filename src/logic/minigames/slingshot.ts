/**
 * Ketapel (`slingshot`), pure rules. Spec: minigames.md §6.
 * No physics engine: a shot is a closed-form parabola plus constant wind drift, collisions are
 * sampled every 5 ms of flight time, so the outcome of a shot is fixed at release and does not
 * depend on the frame rate. A hit target's fall is a scripted animation (render), not simulated.
 * Targets are generated from an "ideal shot", so every level is solvable by construction.
 */
import type { Difficulty, MapData } from '../map';
import { Rng } from '../rng';
import type { MinigameContext, MinigameLogic, MinigameResult } from './types';

export const SLING_BASE_MS = 30_000;
export const SLING_GRAVITY = 14;
export const SLING_PITCH_DEG = 40;
export const SLING_V_MIN = 12;
export const SLING_V_MAX = 22;
export const SLING_YAW_MAX_DEG = 25;
export const SLING_BULLET_R = 0.15;
export const SLING_SHOOTER = { x: 0, y: 1.2, z: 0 } as const;
export const SLING_SAMPLE_MS = 5;
export const SLING_FLIGHT_MAX_MS = 3000;
export const SLING_RELOAD_MS = 400;
export const SLING_FALL_MS = 700;
export const SLING_POWER_MIN = 0.2;
export const SLING_POWER_START = 0.5;
export const SLING_CANCEL_FRAC = 0.2;
export const SLING_MAX_DRAG_SCREEN_FRAC = 0.25;
export const SLING_MIN_SPACING_M = 4.0;
/**
 * The spec says 10 tries, but with spacing alone 10 tries only give 96% / 83% / 57% of levels (easy /
 * medium / hard) with every target >= 4 m apart, short of the §10 K2 bar (>= 95%). 200 tries (the
 * rule is otherwise unchanged: draws stay in the same order, the last try is kept as it is) give
 * ~100%, and leave room for the extra rule that the ideal shot must not fly through another target.
 */
export const SLING_SPACING_TRIES = 200;
export const SLING_MOVE_HALF_M = 1.5;
export const SLING_MAX_EXTRA = 2;
export const SLING_EXTRA_MS_PER_COUNT = 4000;
export const SLING_TOLERANCE_MAX_RADIUS = 2.2;
export const SLING_WIND_MAX = 3;
export const SLING_SPEED_MIN_DURATION_MS = 15_000;
export const SLING_FOG_DEPTH_M = 20;

export const SLING_KNOBS: Readonly<Record<Difficulty, {
  targets: number;
  targetsRequired: number;
  bullets: number;
  hitRadiusM: number;
  aimLineFrac: number;
  windMps: number;
  movingCount: number;
  moveSpeedMps: number;
}>> = {
  easy: { targets: 4, targetsRequired: 3, bullets: 6, hitRadiusM: 1.5, aimLineFrac: 1, windMps: 0, movingCount: 0, moveSpeedMps: 0 },
  medium: { targets: 5, targetsRequired: 4, bullets: 6, hitRadiusM: 1.1, aimLineFrac: 0.4, windMps: 1, movingCount: 1, moveSpeedMps: 0.6 },
  hard: { targets: 6, targetsRequired: 5, bullets: 6, hitRadiusM: 0.8, aimLineFrac: 0.15, windMps: 2, movingCount: 2, moveSpeedMps: 0.8 },
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SlingAim {
  /** Positive = to the right (+x). */
  yawDeg: number;
  /** 0..1, mapped to v = vMin + (vMax - vMin) x power. */
  power: number;
}

export interface SlingTarget {
  /** Index into the map's `targets` skins. */
  skin: number;
  /** Index into the map's `platforms` (0 when the map has none). */
  platform: number;
  center: Vec3;
  halfM: number;
  phase: number;
  /** Test and bot only, never shown: shooting this at the right moment hits the target. */
  ideal: { yawDeg: number; power: number; tFrac: number };
}

export interface SlingLevel {
  durationMs: number;
  bullets: number;
  targetsRequired: number;
  hitRadiusM: number;
  aimLineFrac: number;
  windMps: number;
  moveSpeedMps: number;
  movingCount: number;
  reloadMs: number;
  fallMs: number;
  fogDepthM: number;
  fog: boolean;
  /** hint: the aim line turns green (with a check) while the current aim hits a target. */
  hitPreview: boolean;
  targets: SlingTarget[];
  warnings: string[];
}

export interface SlingShot {
  aim: SlingAim;
  releasedAtMs: number;
  flightMs: number;
  hitIndex: number | null;
  /** Where the bullet ends (target hit point or ground). */
  impact: Vec3;
}

export interface SlingState {
  tMs: number;
  bulletsLeft: number;
  /** Bullet in the air (resolved when tMs reaches releasedAtMs + flightMs). */
  flight: SlingShot | null;
  /** No new shot before this time. */
  reloadUntilMs: number;
  /** Targets down, in order, with the landing time that counted them (the fall anim starts there). */
  down: { index: number; atMs: number; impact: Vec3; yawDeg: number }[];
  /** Every landed shot, for view feedback. */
  landed: SlingShot[];
  result: MinigameResult | null;
}

export function slingshotRequires(map: MapData): boolean {
  const t = map.minigameThemes?.['slingshot']?.['targets'];
  return Array.isArray(t) && t.length >= 2;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

export function shotSpeed(power: number): number {
  return SLING_V_MIN + (SLING_V_MAX - SLING_V_MIN) * power;
}

/** Bullet position `tSec` seconds after release (closed form, wind drift on x). */
export function shotPosition(aim: SlingAim, windMps: number, tSec: number): Vec3 {
  const v = shotSpeed(aim.power);
  const vh = v * Math.cos(rad(SLING_PITCH_DEG));
  const psi = rad(aim.yawDeg);
  return {
    x: SLING_SHOOTER.x + vh * Math.sin(psi) * tSec + windMps * tSec,
    y: SLING_SHOOTER.y + v * Math.sin(rad(SLING_PITCH_DEG)) * tSec - 0.5 * SLING_GRAVITY * tSec * tSec,
    z: SLING_SHOOTER.z + vh * Math.cos(psi) * tSec,
  };
}

/** Seconds until the parabola reaches y = 0 (positive root). */
export function groundTimeSec(power: number): number {
  const vy = shotSpeed(power) * Math.sin(rad(SLING_PITCH_DEG));
  return (vy + Math.sqrt(vy * vy + 2 * SLING_GRAVITY * SLING_SHOOTER.y)) / SLING_GRAVITY;
}

/** Triangle-wave offset of a moving target along x at absolute play time tMs. */
export function targetOffsetX(level: SlingLevel, index: number, tMs: number): number {
  const tg = level.targets[index] as SlingTarget;
  if (index >= level.movingCount || level.moveSpeedMps <= 0) return 0;
  const period = 4 * tg.halfM;
  const s = level.moveSpeedMps * (tMs / 1000) + tg.phase * period;
  const u = ((s % period) + period) % period;
  return u < 2 * tg.halfM ? u - tg.halfM : 3 * tg.halfM - u;
}

export function targetPosition(level: SlingLevel, index: number, tMs: number): Vec3 {
  const c = (level.targets[index] as SlingTarget).center;
  return { x: c.x + targetOffsetX(level, index, tMs), y: c.y, z: c.z };
}

/**
 * Outcome of a shot released at absolute play time `tReleaseMs`: the first sample (every
 * `sampleMs` of flight) at which the bullet is within hitRadiusM + bullet radius of a target that
 * is not down. `down` lists targets already fallen. Pure and independent of the frame rate.
 */
export function simulateShot(
  level: SlingLevel,
  aim: SlingAim,
  tReleaseMs: number,
  down: readonly number[] = [],
  sampleMs: number = SLING_SAMPLE_MS,
): SlingShot {
  const endMs = Math.min(SLING_FLIGHT_MAX_MS, Math.round(groundTimeSec(aim.power) * 1000));
  const reach = level.hitRadiusM + SLING_BULLET_R;
  const reach2 = reach * reach;
  const live: number[] = [];
  for (let i = 0; i < level.targets.length; i++) if (!down.includes(i)) live.push(i);
  for (let ms = sampleMs; ms < endMs; ms += sampleMs) {
    const p = shotPosition(aim, level.windMps, ms / 1000);
    let best = -1;
    let bestD = Infinity;
    for (const i of live) {
      const c = targetPosition(level, i, tReleaseMs + ms);
      const d2 = (p.x - c.x) ** 2 + (p.y - c.y) ** 2 + (p.z - c.z) ** 2;
      if (d2 <= reach2 && d2 < bestD) {
        best = i;
        bestD = d2;
      }
    }
    if (best >= 0) return { aim, releasedAtMs: tReleaseMs, flightMs: ms, hitIndex: best, impact: p };
  }
  const p = shotPosition(aim, level.windMps, endMs / 1000);
  return { aim, releasedAtMs: tReleaseMs, flightMs: endMs, hitIndex: null, impact: { x: p.x, y: Math.max(0, p.y), z: p.z } };
}

/**
 * Drag to aim (pure). `dx`/`dy` are pixels from where the press began (dy > 0 = down);
 * `maxDragPx` = 25% of the screen height. Returns null when the drag is too short (< 20% of
 * maxDragPx): that cancels the shot and no bullet is used. The shot goes OPPOSITE to the drag;
 * dragging upwards counts as the maximum yaw, opposite to dx (dx = 0 counts as dx > 0).
 */
export function aimFromDrag(dx: number, dy: number, maxDragPx: number): SlingAim | null {
  const d = Math.hypot(dx, dy);
  if (!(maxDragPx > 0) || d < SLING_CANCEL_FRAC * maxDragPx) return null;
  const power = Math.min(1, d / maxDragPx);
  let yawDeg: number;
  if (dy > 0) {
    const a = (Math.atan2(dx, dy) * 180) / Math.PI;
    yawDeg = -Math.max(-SLING_YAW_MAX_DEG, Math.min(SLING_YAW_MAX_DEG, a));
  } else {
    yawDeg = dx < 0 ? SLING_YAW_MAX_DEG : -SLING_YAW_MAX_DEG;
  }
  return { yawDeg: yawDeg + 0, power }; // + 0 turns -0 into 0
}

export function clampAim(aim: SlingAim): SlingAim {
  return {
    yawDeg: Math.max(-SLING_YAW_MAX_DEG, Math.min(SLING_YAW_MAX_DEG, aim.yawDeg)),
    power: Math.max(SLING_POWER_MIN, Math.min(1, aim.power)),
  };
}

/**
 * True when the ideal shot of `shooter` passes within `reach` of `blocker`'s centre before it
 * arrives at its own target (a moving blocker counts with its full sweep along x).
 */
function pathBlocked(shooter: SlingTarget, blocker: SlingTarget, reach: number, blockerMoves: boolean, windMps: number): boolean {
  const aim = { yawDeg: shooter.ideal.yawDeg, power: shooter.ideal.power };
  const tEnd = shooter.ideal.tFrac * groundTimeSec(aim.power);
  const sweep = blockerMoves ? blocker.halfM : 0;
  for (let t = 0.02; t < tEnd; t += 0.02) {
    const p = shotPosition(aim, windMps, t);
    const dx = Math.max(0, Math.abs(p.x - blocker.center.x) - sweep);
    if (Math.hypot(dx, p.y - blocker.center.y, p.z - blocker.center.z) <= reach) return true;
  }
  return false;
}

/** Pure ideal-shot helper shared by generation and tests: where the ideal shot passes. */
function idealPoint(aim: SlingAim, windMps: number, tFrac: number): Vec3 {
  return shotPosition(aim, windMps, tFrac * groundTimeSec(aim.power));
}

export const slingshotLogic: MinigameLogic<SlingLevel, SlingAim, SlingState> = {
  id: 'slingshot',
  render: '3d',
  introKey: 'mg.slingshot.intro',
  baseDurationMs: SLING_BASE_MS,
  requires: slingshotRequires,

  generateLevel(ctx: MinigameContext): SlingLevel {
    const rng = new Rng(ctx.seed);
    const k = SLING_KNOBS[ctx.difficulty];
    const theme = ctx.map.minigameThemes?.['slingshot'] ?? {};
    const skinCount = Array.isArray(theme['targets']) ? theme['targets'].length : 1;
    const platformCount = Array.isArray(theme['platforms']) ? theme['platforms'].length : 0;

    let durationMs = SLING_BASE_MS;
    let radius = k.hitRadiusM;
    let moveSpeed = k.moveSpeedMps;
    let windMag = k.windMps;
    let speedMult = 1;
    let extra = 0;
    let fog = false;
    let hint = false;
    const warnings: string[] = [];
    for (const m of ctx.modifiers) {
      switch (m.kind) {
        case 'timeDelta': durationMs += m.seconds * 1000; break;
        case 'tolerance': radius = Math.min(SLING_TOLERANCE_MAX_RADIUS, radius * m.mult); break;
        case 'speed': speedMult *= m.mult; break;
        case 'extraTarget': extra = Math.min(extra + m.count, SLING_MAX_EXTRA); break;
        case 'fog': fog = true; break;
        case 'hint': hint = true; break;
        default: warnings.push(`slingshot: ignored modifier ${JSON.stringify(m)}`);
      }
    }
    if (speedMult !== 1) {
      moveSpeed *= speedMult;
      windMag = Math.min(SLING_WIND_MAX, windMag * speedMult);
      durationMs = Math.max(Math.min(durationMs, SLING_SPEED_MIN_DURATION_MS), durationMs / speedMult);
    }
    durationMs += extra * SLING_EXTRA_MS_PER_COUNT; // outside the race-layer clamp (DR-17)
    const targetCount = k.targets + extra;

    // 1. wind sign (always drawn).
    const windSign = rng.int(0, 1);
    const windMps = windMag * (windSign ? 1 : -1) + 0; // + 0: no -0 on calm levels

    // 2. targets, generated from an ideal shot so each one can be hit.
    const targets: SlingTarget[] = [];
    for (let i = 0; i < targetCount; i++) {
      let made: SlingTarget | null = null;
      for (let attempt = 0; attempt < SLING_SPACING_TRIES; attempt++) {
        const ideal = {
          yawDeg: -18 + 36 * rng.next(),
          power: 0.45 + 0.45 * rng.next(),
          tFrac: 0.55 + 0.3 * rng.next(),
        };
        const skin = rng.int(0, skinCount - 1);
        const platform = platformCount > 0 ? rng.int(0, platformCount - 1) : 0;
        const phase = rng.next();
        const center = idealPoint(ideal, windMps, ideal.tFrac);
        made = { skin, platform, center, halfM: SLING_MOVE_HALF_M, phase, ideal };
        // Spacing >= 4 m, and neither ideal shot may fly through the other target first
        // (otherwise "shoot the ideal aim at target i" would knock down a different one).
        const reach = radius + SLING_BULLET_R;
        const clear = targets.every((o, j) => (
          Math.hypot(o.center.x - center.x, o.center.z - center.z) >= SLING_MIN_SPACING_M
          && !pathBlocked(made as SlingTarget, o, reach, j < k.movingCount, windMps)
          && !pathBlocked(o, made as SlingTarget, reach, targets.length < k.movingCount, windMps)
        ));
        if (clear) break; // the 10th attempt is kept as it is
      }
      targets.push(made as SlingTarget);
    }

    return {
      durationMs,
      bullets: k.bullets + extra,
      targetsRequired: k.targetsRequired + extra,
      hitRadiusM: radius,
      aimLineFrac: hint ? 1 : k.aimLineFrac,
      windMps,
      moveSpeedMps: moveSpeed,
      movingCount: k.movingCount,
      reloadMs: SLING_RELOAD_MS,
      fallMs: SLING_FALL_MS,
      fogDepthM: SLING_FOG_DEPTH_M,
      fog,
      hitPreview: hint,
      targets,
      warnings,
    };
  },

  initState(level): SlingState {
    return { tMs: 0, bulletsLeft: level.bullets, flight: null, reloadUntilMs: 0, down: [], landed: [], result: null };
  },

  step(level, prev, input, tMs) {
    if (prev.result) return prev;
    let t = Math.max(tMs, prev.tMs);
    const s: SlingState = { ...prev, tMs: t };

    // Land the bullet in the air first: its outcome was fixed at release.
    const f = s.flight;
    if (f && t >= f.releasedAtMs + f.flightMs) {
      const landAt = f.releasedAtMs + f.flightMs;
      s.flight = null;
      s.landed = [...s.landed, f];
      s.reloadUntilMs = landAt + level.reloadMs;
      if (f.hitIndex !== null) {
        s.down = [...s.down, { index: f.hitIndex, atMs: landAt, impact: f.impact, yawDeg: f.aim.yawDeg }];
      }
      const progress = Math.min(1, s.down.length / level.targetsRequired);
      if (s.down.length >= level.targetsRequired) {
        s.result = { passed: true, timeTakenMs: landAt, progress: 1, reason: 'success' };
        s.tMs = landAt;
        return s;
      }
      // Impossible when the bullets left cannot cover what is still missing (or none are left).
      if (s.bulletsLeft < level.targetsRequired - s.down.length || s.bulletsLeft <= 0) {
        s.result = { passed: false, timeTakenMs: landAt, progress, reason: 'failLimit' };
        s.tMs = landAt;
        return s;
      }
    }

    if (!s.flight && t >= level.durationMs) {
      s.tMs = level.durationMs;
      s.result = { passed: false, timeTakenMs: level.durationMs, progress: Math.min(1, s.down.length / level.targetsRequired), reason: 'timeout' };
      return s;
    }
    if (!input || s.flight || t >= level.durationMs || t < s.reloadUntilMs || s.bulletsLeft <= 0) return s; // ignored, no bullet used
    if (!Number.isFinite(input.yawDeg) || !Number.isFinite(input.power)) return s;
    t = Math.max(t, 0);
    const aim = clampAim(input);
    const shot = simulateShot(level, aim, t, s.down.map((d) => d.index));
    s.flight = shot;
    s.bulletsLeft -= 1;
    return s;
  },

  result(_level, state) {
    return state.result;
  },
};
