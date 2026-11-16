/**
 * Map graph: data-driven and map-agnostic (R4). A map is loaded from a JSON file under
 * src/data/maps/ and validated here. Nothing in this file knows about Indonesia.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface MapNodeData {
  id: string;
  name: string;
  /** Region type key; must exist in MapData.regionTypes (e.g. "beach", "mountain"). */
  type: string;
  /** Layout position on the board plane, in board units (render maps x -> X, y -> Z). */
  pos: { x: number; y: number };
}

export interface MapEdgeData {
  from: string;
  to: string;
  /**
   * Edges are directed from -> to (towards the finish) by default, which is what makes
   * "no backtracking" mean geographic progress. Set twoWay for a lateral link that may be
   * travelled either way (the no-revisit rule still applies).
   */
  twoWay?: boolean;
}

export interface RegionTypeData {
  label: string;
  /** Minigame difficulty for this region type (M2). */
  difficulty: Difficulty;
}

export interface MapData {
  id: string;
  name: string;
  version: number;
  startNodeId: string;
  finishNodeIds: string[];
  regionTypes: Record<string, RegionTypeData>;
  nodes: MapNodeData[];
  edges: MapEdgeData[];
}

/** Validated, indexed map ready for fast lookups. Immutable after load. */
export interface MapGraph {
  readonly data: MapData;
  readonly nodes: ReadonlyMap<string, MapNodeData>;
  /** Directed adjacency: nodeId -> ids reachable in one move. */
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
  readonly finish: ReadonlySet<string>;
}

export class MapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapValidationError';
  }
}

/** Validate raw JSON and build the graph. Throws MapValidationError on bad data. */
export function loadMap(raw: unknown): MapGraph {
  const data = raw as MapData;
  const fail = (msg: string): never => {
    throw new MapValidationError(`map "${String(data?.id)}": ${msg}`);
  };
  if (!data || typeof data !== 'object') fail('not an object');
  if (!Array.isArray(data.nodes) || data.nodes.length === 0) fail('no nodes');
  if (!Array.isArray(data.edges)) fail('edges missing');
  if (!data.regionTypes || typeof data.regionTypes !== 'object') fail('regionTypes missing');

  const nodes = new Map<string, MapNodeData>();
  for (const n of data.nodes) {
    if (!n.id) fail('node without id');
    if (nodes.has(n.id)) fail(`duplicate node id "${n.id}"`);
    if (!data.regionTypes[n.type]) fail(`node "${n.id}" has unknown type "${n.type}"`);
    nodes.set(n.id, n);
  }

  const adjacency = new Map<string, string[]>();
  for (const id of nodes.keys()) adjacency.set(id, []);
  const addArc = (a: string, b: string): void => {
    const list = adjacency.get(a) as string[];
    if (!list.includes(b)) list.push(b);
  };
  for (const e of data.edges) {
    if (!nodes.has(e.from)) fail(`edge references unknown node "${e.from}"`);
    if (!nodes.has(e.to)) fail(`edge references unknown node "${e.to}"`);
    if (e.from === e.to) fail(`self-loop on "${e.from}"`);
    addArc(e.from, e.to);
    if (e.twoWay) addArc(e.to, e.from);
  }

  if (!nodes.has(data.startNodeId)) fail(`unknown startNodeId "${data.startNodeId}"`);
  if (!Array.isArray(data.finishNodeIds) || data.finishNodeIds.length === 0) fail('no finish nodes');
  for (const f of data.finishNodeIds) if (!nodes.has(f)) fail(`unknown finish node "${f}"`);

  // Every finish must be reachable from the start.
  const seen = new Set<string>([data.startNodeId]);
  const queue = [data.startNodeId];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of adjacency.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  for (const f of data.finishNodeIds) if (!seen.has(f)) fail(`finish "${f}" unreachable from start`);

  // No dead ends: every reachable non-finish node must have a way out.
  const finishSet = new Set(data.finishNodeIds);
  for (const id of seen) {
    if (!finishSet.has(id) && (adjacency.get(id) ?? []).length === 0) fail(`dead end at "${id}"`);
  }

  return { data, nodes, adjacency, finish: new Set(data.finishNodeIds) };
}

export function neighbors(map: MapGraph, nodeId: string): readonly string[] {
  return map.adjacency.get(nodeId) ?? [];
}

export function nodeDifficulty(map: MapGraph, nodeId: string): Difficulty {
  const node = map.nodes.get(nodeId);
  if (!node) throw new MapValidationError(`unknown node "${nodeId}"`);
  return (map.data.regionTypes[node.type] as RegionTypeData).difficulty;
}
