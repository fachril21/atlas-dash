/**
 * Whack-a-Mole (`whack_a_mole`), pure rules. Spec: minigames.md §5.
 * The whole spawn schedule is built once in generateLevel (DR-15); play is a function of time
 * only, so it runs in Vitest without DOM. Modifiers change visible time (`lifeMs`), never the
 * schedule, so a card can never make the pass condition unreachable.
 */
import type { Difficulty, MapData } from '../map';
import { Rng } from '../rng';
import { tempoMultiplier } from './dodgeRunner';
import type { MinigameContext, MinigameLogic, MinigameResult } from './types';

export const WHACK_BASE_MS = 20_000;
export const WHACK_KNOBS: Readonly<Record<Difficulty, {
  gridCols: number;
  gridRows: number;
  hitsRequired: number;
  baseLifeMs: number;
  spawnIntervalMs: number;
  decoyRatio: number;
  decoyHitsAllowed: number;
}>> = {
  easy: { gridCols: 3, gridRows: 3, hitsRequired: 8, baseLifeMs: 1100, spawnIntervalMs: 1250, decoyRatio: 0, decoyHitsAllowed: 0 },
  medium: { gridCols: 3, gridRows: 3, hitsRequired: 15, baseLifeMs: 900, spawnIntervalMs: 650, decoyRatio: 0.15, decoyHitsAllowed: 2 },
  hard: { gridCols: 4, gridRows: 3, hitsRequired: 19, baseLifeMs: 700, spawnIntervalMs: 480, decoyRatio: 0.25, decoyHitsAllowed: 1 },
};
export const WHACK_FIRST_SPAWN_MS = 700;
export const WHACK_GRACE_MS = 80;
export const WHACK_WARMUP_SLOTS = 3;
export const WHACK_LIFE_MIN_MS = 350;
export const WHACK_LIFE_MAX_MS = 2500;
export const WHACK_LIFE_JITTER = 0.15;
export const WHACK_TOLERANCE_MAX = 1.5;
export const WHACK_MAX_EXTRA = 2;
export const WHACK_EXTRA_HITS_PER_COUNT = 2;
export const WHACK_EXTRA_MS_PER_COUNT = 3000;
export const WHACK_HINT_LEAD_MS = 300;
export const WHACK_FOG_PERIOD_MS = 3000;
/** Safety margin of the "enough target spawns" guarantee: T >= ceil(1.5 x hitsRequired). */
export const WHACK_GUARANTEE = 1.5;

export interface WhackSpawn {
  tMs: number;
  hole: number;
  kind: 'target' | 'decoy';
  /** Visible time (the hit window is lifeMs + graceMs). */
  lifeMs: number;
}

export interface WhackFogWindow {
  tMs: number;
  holes: [number, number];
}

export interface WhackLevel {
  durationMs: number;
  gridCols: number;
  gridRows: number;
  hitsRequired: number;
  decoyHitsAllowed: number;
  graceMs: number;
  hintLeadMs: number;
  spawns: WhackSpawn[];
  /** Empty unless the fog modifier is active; the draws happen either way. */
  fog: WhackFogWindow[];
  /** tolerance > 1: the view widens the touch area of each hole to the cell edge. */
  wideTouch: boolean;
  /** Tempo multiplier M that was applied to lifeMs. */
  tempo: number;
  /** Total spawn slots, decoys and target spawns (for tests and the bot-free analytics). */
  slots: number;
  warnings: string[];
}

export type WhackInput = { hole: number };

export interface WhackState {
  tMs: number;
  hits: number;
  decoyHits: number;
  /** Indices of spawns that were hit (never hit twice). */
  hit: number[];
  /** Last hit, for view feedback. */
  lastHit: { tMs: number; hole: number; kind: 'target' | 'decoy' } | null;
  result: MinigameResult | null;
}

export function whackRequires(map: MapData): boolean {
  const t = map.minigameThemes?.['whack_a_mole'];
  return !!t && typeof t['target'] === 'string' && t['target'] !== '' && typeof t['decoy'] === 'string' && t['decoy'] !== '';
}

export function holeCount(level: Pick<WhackLevel, 'gridCols' | 'gridRows'>): number {
  return level.gridCols * level.gridRows;
}

/** Slot count S for a duration (§5, "Acak per run" step 1). */
export function whackSlotCount(durationMs: number, difficulty: Difficulty): number {
  const k = WHACK_KNOBS[difficulty];
  return Math.floor((durationMs - WHACK_FIRST_SPAWN_MS - k.baseLifeMs) / k.spawnIntervalMs) + 1;
}

/**
 * Last moment (exclusive) at which spawn `i` can be hit: its life + grace, or the start of a later
 * spawn in the same hole (a new spawn replaces a character that is still up, without penalty).
 */
export function spawnEndMs(level: WhackLevel, i: number): number {
  const s = level.spawns[i] as WhackSpawn;
  let end = s.tMs + s.lifeMs + level.graceMs;
  for (let j = i + 1; j < level.spawns.length; j++) {
    const n = level.spawns[j] as WhackSpawn;
    if (n.tMs >= end) break;
    if (n.hole === s.hole) {
      end = Math.min(end, n.tMs);
      break;
    }
  }
  return end;
}

/** Index of the live (visible and not yet hit) spawn in a hole at time t, or -1. */
export function liveSpawnAt(level: WhackLevel, hit: readonly number[], hole: number, t: number): number {
  let found = -1;
  for (let i = 0; i < level.spawns.length; i++) {
    const s = level.spawns[i] as WhackSpawn;
    if (s.tMs > t) break;
    if (s.hole !== hole || hit.includes(i)) continue;
    if (t < spawnEndMs(level, i)) found = i;
  }
  return found;
}

/** Spawn indices visible in a hole at t (for the view; the hit window includes grace). */
export function visibleSpawns(level: WhackLevel, hit: readonly number[], t: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < level.spawns.length; i++) {
    const s = level.spawns[i] as WhackSpawn;
    if (s.tMs > t) break;
    if (!hit.includes(i) && t < spawnEndMs(level, i)) out.push(i);
  }
  return out;
}

export const whackAMoleLogic: MinigameLogic<WhackLevel, WhackInput, WhackState> = {
  id: 'whack_a_mole',
  render: '2d',
  introKey: 'mg.whack_a_mole.intro',
  baseDurationMs: WHACK_BASE_MS,
  requires: whackRequires,

  generateLevel(ctx: MinigameContext): WhackLevel {
    const rng = new Rng(ctx.seed);
    const k = WHACK_KNOBS[ctx.difficulty];
    let timeDelta = 0;
    let tolerance = 1;
    let speed = 1;
    let extra = 0;
    let fog = false;
    let hint = false;
    const warnings: string[] = [];
    for (const m of ctx.modifiers) {
      switch (m.kind) {
        case 'timeDelta': timeDelta += m.seconds; break; // tempo only, duration stays (DR-15)
        case 'tolerance': tolerance *= m.mult; break;
        case 'speed': speed *= m.mult; break;
        case 'extraTarget': extra = Math.min(extra + m.count, WHACK_MAX_EXTRA); break;
        case 'fog': fog = true; break;
        case 'hint': hint = true; break;
        default: warnings.push(`whack_a_mole: ignored modifier ${JSON.stringify(m)}`);
      }
    }
    const durationMs = WHACK_BASE_MS + extra * WHACK_EXTRA_MS_PER_COUNT; // outside the race clamp (DR-17)
    const tempo = tempoMultiplier(speed, timeDelta);
    const holes = k.gridCols * k.gridRows;
    const S = whackSlotCount(durationMs, ctx.difficulty);
    const nDecoy = Math.floor(S * k.decoyRatio);

    // 2. decoy slots: shuffle slots 3..S-1, take the first nDecoy.
    const candidates: number[] = [];
    for (let i = WHACK_WARMUP_SLOTS; i < S; i++) candidates.push(i);
    const decoySlots = new Set(rng.shuffle(candidates).slice(0, nDecoy));

    // 3. per slot: hole, then lifeFactor (two draws each).
    const toleranceCapped = Math.min(tolerance, WHACK_TOLERANCE_MAX);
    const spawns: WhackSpawn[] = [];
    const baseEnds: number[] = []; // alive-until per spawn, computed with baseLifeMs
    for (let i = 0; i < S; i++) {
      const tMs = WHACK_FIRST_SPAWN_MS + i * k.spawnIntervalMs;
      const busy = new Set<number>();
      for (let j = 0; j < i; j++) if (baseEnds[j] as number > tMs) busy.add((spawns[j] as WhackSpawn).hole);
      const prev = spawns[i - 1];
      if (prev) busy.add(prev.hole);
      const allowed: number[] = [];
      for (let h = 0; h < holes; h++) if (!busy.has(h)) allowed.push(h);
      const hole = allowed[rng.int(0, allowed.length - 1)] as number;
      const lifeFactor = 1 - WHACK_LIFE_JITTER + 2 * WHACK_LIFE_JITTER * rng.next();
      const lifeMs = Math.round(Math.min(WHACK_LIFE_MAX_MS, Math.max(WHACK_LIFE_MIN_MS, (k.baseLifeMs * lifeFactor * toleranceCapped) / tempo)));
      spawns.push({ tMs, hole, kind: decoySlots.has(i) ? 'decoy' : 'target', lifeMs });
      baseEnds.push(tMs + k.baseLifeMs);
    }

    // 4. fog windows last, always drawn, so fog never shifts the schedule.
    const fogWindows: WhackFogWindow[] = [];
    for (let t = 0; t < durationMs; t += WHACK_FOG_PERIOD_MS) {
      const a = rng.int(0, holes - 1);
      let b = rng.int(0, holes - 2);
      if (b >= a) b += 1;
      fogWindows.push({ tMs: t, holes: [a, b] });
    }

    // Guarantee (DR-15): enough target spawns. Safety net only; official data never triggers it.
    let hitsRequired = k.hitsRequired + extra * WHACK_EXTRA_HITS_PER_COUNT;
    const targetSpawns = S - nDecoy;
    if (targetSpawns < Math.ceil(WHACK_GUARANTEE * hitsRequired)) {
      hitsRequired = Math.floor(targetSpawns / WHACK_GUARANTEE);
      warnings.push(`whack_a_mole: hitsRequired lowered to ${hitsRequired} (only ${targetSpawns} target spawns)`);
    }

    return {
      durationMs,
      gridCols: k.gridCols,
      gridRows: k.gridRows,
      hitsRequired,
      decoyHitsAllowed: k.decoyHitsAllowed,
      graceMs: WHACK_GRACE_MS,
      hintLeadMs: hint ? WHACK_HINT_LEAD_MS : 0,
      spawns,
      fog: fog ? fogWindows : [],
      wideTouch: tolerance > 1,
      tempo,
      slots: S,
      warnings,
    };
  },

  initState(): WhackState {
    return { tMs: 0, hits: 0, decoyHits: 0, hit: [], lastHit: null, result: null };
  },

  step(level, prev, input, tMs) {
    if (prev.result) return prev;
    const t = Math.max(tMs, prev.tMs);
    if (t >= level.durationMs) {
      return {
        ...prev,
        tMs: level.durationMs,
        result: { passed: false, timeTakenMs: level.durationMs, progress: Math.min(1, prev.hits / level.hitsRequired), reason: 'timeout' },
      };
    }
    const s: WhackState = { ...prev, tMs: t };
    if (!input || !Number.isInteger(input.hole) || input.hole < 0 || input.hole >= holeCount(level)) return s;
    const idx = liveSpawnAt(level, s.hit, input.hole, t);
    if (idx < 0) return s; // empty hole: ignored, not a miss
    const spawn = level.spawns[idx] as WhackSpawn;
    s.hit = [...s.hit, idx];
    s.lastHit = { tMs: t, hole: spawn.hole, kind: spawn.kind };
    if (spawn.kind === 'target') {
      s.hits += 1;
      if (s.hits >= level.hitsRequired) {
        s.result = { passed: true, timeTakenMs: t, progress: 1, reason: 'success' };
      }
    } else {
      s.decoyHits += 1;
      if (s.decoyHits > level.decoyHitsAllowed) {
        s.result = { passed: false, timeTakenMs: t, progress: Math.min(1, s.hits / level.hitsRequired), reason: 'failLimit' };
      }
    }
    return s;
  },

  result(_level, state) {
    return state.result;
  },
};
