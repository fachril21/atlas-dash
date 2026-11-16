/**
 * Map data (schema v1, map-indonesia.md §6) + validation (§6.2) + derived graph data.
 * Map-agnostic: nothing here knows any region id. Files live at public/maps/<id>/map.json.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
export type PresetId = 'short' | 'standard' | 'long';
export type LocalizedText = Record<string, string>;

export interface MapPreset {
  enabled: boolean;
  start: string;
  finish: string;
  winsRequired: number;
  /** Regions passed after start, finish included. */
  routeLength: { min: number; max: number };
}

export interface MapRegion {
  id: string;
  name: LocalizedText;
  type: string;
  /** Board coordinates, 0..100 × 0..40. */
  position: { x: number; z: number };
  landmarkModel?: string;
}

export interface MapData {
  schemaVersion: 1;
  id: string;
  name: LocalizedText;
  theme: {
    palette: { sky: string; sea: string; ground: string; accent: string; accent2: string };
    music: string;
    boardModel?: string;
  };
  regionTypes: Record<string, { difficulty: Difficulty; name: LocalizedText; tileModel: string }>;
  regions: MapRegion[];
  edges: { from: string; to: string }[];
  presets: Record<PresetId, MapPreset>;
  places: {
    id: string;
    name: LocalizedText;
    regionId: string;
    image: string;
    icon: string;
    hint: LocalizedText;
  }[];
  minigameThemes: Record<string, Record<string, string | string[]>>;
  cardSkins?: Record<string, { nameKey?: string; icon?: string }>;
}

/** A minigame's map requirement (§6.2 rule 5); passed in so map.ts stays independent. */
export interface MapRequirement {
  id: string;
  requires?: (map: MapData) => boolean;
}

/** Validated map + one active preset, with derived lookups. Immutable. */
export interface MapGraph {
  readonly data: MapData;
  readonly presetId: PresetId;
  readonly preset: MapPreset;
  readonly regions: ReadonlyMap<string, MapRegion>;
  /** Outgoing edges (DAG): regionId -> ids reachable in one step. */
  readonly outgoing: ReadonlyMap<string, readonly string[]>;
  readonly startId: string;
  readonly finishId: string;
  readonly winsRequired: number;
  /** Regions with an edge to the finish ("FINAL"): 2 wins there = match won. */
  readonly finalRegions: ReadonlySet<string>;
  /** playDist(n): regions still to be played from n to the finish (n and finish excluded). */
  readonly playDist: ReadonlyMap<string, number>;
}

export class MapValidationError extends Error {
  constructor(
    readonly mapId: string,
    readonly problems: readonly string[],
  ) {
    super(`map "${mapId}" is invalid:\n- ${problems.join('\n- ')}`);
    this.name = 'MapValidationError';
  }
}

export const MIN_PLACES = 8;
export const MIN_PLACE_REGIONS = 5;

function buildOutgoing(data: MapData): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of data.regions) out.set(r.id, []);
  for (const e of data.edges) out.get(e.from)?.push(e.to);
  return out;
}

/** Validate one preset on the subgraph reachable from its start (§6.2 rule 2). */
export function validatePreset(data: MapData, presetId: PresetId): string[] {
  const problems: string[] = [];
  const p = data.presets?.[presetId];
  const tag = `preset "${presetId}"`;
  if (!p) return [`${tag}: missing`];
  const ids = new Set(data.regions.map((r) => r.id));
  if (!ids.has(p.start)) problems.push(`${tag}: unknown start "${p.start}"`);
  if (!ids.has(p.finish)) problems.push(`${tag}: unknown finish "${p.finish}"`);
  if (!(Number.isInteger(p.winsRequired) && p.winsRequired >= 1)) problems.push(`${tag}: winsRequired must be an integer >= 1`);
  if (!p.routeLength || p.routeLength.min > p.routeLength.max) problems.push(`${tag}: bad routeLength`);
  if (problems.length > 0) return problems;

  const out = buildOutgoing(data);
  // Edges into start are ignored: walk forward from start only.
  const reach = new Set<string>([p.start]);
  const queue = [p.start];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === p.finish) continue;
    for (const n of out.get(cur) ?? []) {
      if (n !== p.start && !reach.has(n)) {
        reach.add(n);
        queue.push(n);
      }
    }
  }
  if (!reach.has(p.finish)) problems.push(`${tag}: finish "${p.finish}" not reachable from start`);
  if ((out.get(p.finish) ?? []).length > 0) problems.push(`${tag}: finish "${p.finish}" has outgoing edges`);
  if ((out.get(p.start) ?? []).includes(p.finish)) problems.push(`${tag}: direct edge start -> finish`);

  // Dead ends: every reachable region must be able to reach the finish.
  const canFinish = new Set<string>([p.finish]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of reach) {
      if (!canFinish.has(id) && (out.get(id) ?? []).some((n) => canFinish.has(n))) {
        canFinish.add(id);
        changed = true;
      }
    }
  }
  for (const id of reach) if (!canFinish.has(id)) problems.push(`${tag}: dead end at "${id}" (cannot reach finish)`);

  // Every start -> finish path length (start excluded, finish included) within routeLength.
  if (problems.length === 0) {
    const bad: string[] = [];
    const walk = (node: string, path: string[]): void => {
      if (bad.length > 5) return;
      if (node === p.finish) {
        const len = path.length - 1;
        if (len < p.routeLength.min || len > p.routeLength.max) bad.push(`${path.join('>')} (${len})`);
        return;
      }
      for (const n of out.get(node) ?? []) if (n !== p.start) walk(n, [...path, n]);
    };
    walk(p.start, [p.start]);
    for (const b of bad) {
      problems.push(`${tag}: route length outside ${p.routeLength.min}-${p.routeLength.max}: ${b}`);
    }
  }
  return problems;
}

/** Full validation (§6.2). Returns a list of problems; empty = valid. */
export function validateMap(raw: unknown, pool: readonly MapRequirement[] = []): string[] {
  const data = raw as MapData;
  const problems: string[] = [];
  if (!data || typeof data !== 'object') return ['not an object'];
  if (data.schemaVersion !== 1) problems.push(`unsupported schemaVersion ${String(data.schemaVersion)}`);
  if (!data.id) problems.push('missing id');
  if (!Array.isArray(data.regions) || data.regions.length === 0) return [...problems, 'no regions'];
  if (!Array.isArray(data.edges)) return [...problems, 'edges missing'];
  if (!data.regionTypes || typeof data.regionTypes !== 'object') return [...problems, 'regionTypes missing'];
  if (!data.presets || typeof data.presets !== 'object') return [...problems, 'presets missing'];

  // Rule 5a: unique ids, known types.
  const ids = new Set<string>();
  for (const r of data.regions) {
    if (ids.has(r.id)) problems.push(`duplicate region id "${r.id}"`);
    ids.add(r.id);
    if (!data.regionTypes[r.type]) problems.push(`region "${r.id}" has unknown type "${r.type}"`);
  }
  // Rule 1: edges point to known regions; no self loops / duplicates; DAG.
  const seenEdge = new Set<string>();
  for (const e of data.edges) {
    if (!ids.has(e.from)) problems.push(`edge references unknown region "${e.from}"`);
    if (!ids.has(e.to)) problems.push(`edge references unknown region "${e.to}"`);
    if (e.from === e.to) problems.push(`self-loop on "${e.from}"`);
    const key = `${e.from}>${e.to}`;
    if (seenEdge.has(key)) problems.push(`duplicate edge ${key}`);
    seenEdge.add(key);
  }
  if (problems.length > 0) return problems;
  const cycle = findCycle(buildOutgoing(data));
  if (cycle) problems.push(`cycle detected: ${cycle.join(' > ')}`);

  // Rule 3: at least 2 branch points.
  const out = buildOutgoing(data);
  const branches = [...out.values()].filter((n) => n.length >= 2).length;
  if (branches < 2) problems.push(`needs >= 2 branch regions (>= 2 outgoing edges), found ${branches}`);

  // Rule 2: every enabled preset.
  if (!cycle) {
    const enabled = (Object.keys(data.presets) as PresetId[]).filter((k) => data.presets[k]?.enabled);
    if (enabled.length === 0) problems.push('no enabled preset');
    for (const k of enabled) problems.push(...validatePreset(data, k));
  }

  // Rule 4: places.
  const places = Array.isArray(data.places) ? data.places : [];
  for (const pl of places) if (!ids.has(pl.regionId)) problems.push(`place "${pl.id}" has unknown regionId "${pl.regionId}"`);
  if (places.length < MIN_PLACES) problems.push(`needs >= ${MIN_PLACES} places, found ${places.length}`);
  const placeRegions = new Set(places.map((pl) => pl.regionId)).size;
  if (placeRegions < MIN_PLACE_REGIONS) {
    problems.push(`places must cover >= ${MIN_PLACE_REGIONS} regions, found ${placeRegions}`);
  }

  // Rule 5b: each minigame in the pool has what it needs.
  for (const mg of pool) {
    if (mg.requires && !mg.requires(data)) problems.push(`minigame "${mg.id}" requirements not met by this map`);
  }
  return problems;
}

function findCycle(out: Map<string, string[]>): string[] | null {
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  let found: string[] | null = null;
  const visit = (n: string): void => {
    if (found) return;
    color.set(n, 1);
    stack.push(n);
    for (const m of out.get(n) ?? []) {
      const c = color.get(m) ?? 0;
      if (c === 1) {
        found = [...stack.slice(stack.indexOf(m)), m];
        return;
      }
      if (c === 0) visit(m);
      if (found) return;
    }
    stack.pop();
    color.set(n, 2);
  };
  for (const n of out.keys()) if ((color.get(n) ?? 0) === 0) visit(n);
  return found;
}

/** Validate and index a map for one preset. Throws MapValidationError. */
export function loadMap(raw: unknown, presetId: PresetId = 'standard', pool: readonly MapRequirement[] = []): MapGraph {
  const data = raw as MapData;
  const problems = validateMap(raw, pool);
  if (problems.length === 0 && !data.presets[presetId]?.enabled) {
    problems.push(...validatePreset(data, presetId));
  }
  if (problems.length > 0) throw new MapValidationError(String(data?.id), problems);

  const preset = data.presets[presetId];
  const outgoing = buildOutgoing(data);
  const regions = new Map(data.regions.map((r) => [r.id, r]));
  const finalRegions = new Set(data.edges.filter((e) => e.to === preset.finish).map((e) => e.from));

  // Shortest step count to finish via reverse BFS; playDist = steps - 1.
  const incoming = new Map<string, string[]>();
  for (const e of data.edges) {
    const list = incoming.get(e.to) ?? [];
    list.push(e.from);
    incoming.set(e.to, list);
  }
  const steps = new Map<string, number>([[preset.finish, 0]]);
  const queue = [preset.finish];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const prev of incoming.get(cur) ?? []) {
      if (!steps.has(prev)) {
        steps.set(prev, (steps.get(cur) as number) + 1);
        queue.push(prev);
      }
    }
  }
  const playDist = new Map<string, number>();
  for (const [id, s] of steps) if (id !== preset.finish) playDist.set(id, s - 1);

  return {
    data,
    presetId,
    preset,
    regions,
    outgoing,
    startId: preset.start,
    finishId: preset.finish,
    winsRequired: preset.winsRequired,
    finalRegions,
    playDist,
  };
}

export function outgoing(map: MapGraph, regionId: string): readonly string[] {
  return map.outgoing.get(regionId) ?? [];
}

export function regionDifficulty(map: MapGraph, regionId: string): Difficulty {
  const r = map.regions.get(regionId);
  if (!r) throw new Error(`unknown region "${regionId}"`);
  const t = map.data.regionTypes[r.type];
  if (!t) throw new Error(`unknown region type "${r.type}"`);
  return t.difficulty;
}

/** Localized text with fallback: requested language, then "id", then any value. */
export function localize(text: LocalizedText | undefined, lang = 'id'): string {
  if (!text) return '';
  return text[lang] ?? text.id ?? Object.values(text)[0] ?? '';
}
