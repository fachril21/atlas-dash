import { describe, expect, it } from 'vitest';
import {
  loadMap,
  MapValidationError,
  minigamePool,
  MINIGAME_LOGIC,
  remainingWinsFor,
  totalWins,
  validateMap,
  validatePreset,
  type MapData,
} from '../src/logic';
import { indonesiaData } from './helpers';

const map = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);

/** All start -> finish paths, as region id lists. */
function allRoutes(): string[][] {
  const routes: string[][] = [];
  const walk = (n: string, path: string[]) => {
    if (n === map.finishId) return void routes.push(path);
    for (const m of map.outgoing.get(n) ?? []) walk(m, [...path, m]);
  };
  walk(map.startId, [map.startId]);
  return routes;
}

describe('Indonesia map (map_indonesia_valid)', () => {
  it('validates with 10 regions, 12 edges and 3 branch regions', () => {
    expect(validateMap(indonesiaData(), MINIGAME_LOGIC)).toEqual([]);
    expect(map.regions.size).toBe(10);
    expect(map.data.edges.length).toBe(12);
    const branches = [...map.outgoing.entries()].filter(([, n]) => n.length >= 2).map(([id]) => id).sort();
    expect(branches).toEqual(['jakarta', 'sabang', 'toraja']);
  });

  it('has 6 routes, every length (finish counted) within 5-6 (map_all_routes_in_range)', () => {
    const lengths = allRoutes().map((r) => r.length - 1).sort();
    expect(lengths).toEqual([5, 5, 5, 5, 6, 6]);
  });

  it('final regions are the ones with an edge to the finish', () => {
    expect([...map.finalRegions].sort()).toEqual(['labuan_bajo', 'raja_ampat']);
    expect(map.startId).toBe('sabang');
    expect(map.finishId).toBe('merauke');
  });

  it('pool contains tap_timing', () => {
    expect(minigamePool(map.data)).toEqual(['tap_timing']);
  });
});

describe('playDist and remainingWins (race_remaining_wins_table, map-indonesia.md §1)', () => {
  const table: [string, number, number][] = [
    ['sabang', 4, 8],
    ['medan', 3, 6],
    ['padang', 3, 6],
    ['jakarta', 2, 4],
    ['yogyakarta', 2, 4],
    ['toraja', 1, 2],
    ['bali', 1, 2],
    ['labuan_bajo', 0, 0],
    ['raja_ampat', 0, 0],
  ];
  it.each(table)('%s: playDist %i, remainingWins %i', (node, dist, rw) => {
    expect(map.playDist.get(node)).toBe(dist);
    expect(remainingWinsFor(map, node, null, 0)).toBe(rw);
  });

  it('finish has no playDist and total = 8', () => {
    expect(map.playDist.has('merauke')).toBe(false);
    expect(totalWins(map)).toBe(8);
  });

  it('partial-win examples from the doc', () => {
    expect(remainingWinsFor(map, 'jakarta', 'toraja', 1)).toBe(3);
    expect(remainingWinsFor(map, 'jakarta', 'yogyakarta', 1)).toBe(4);
    expect(remainingWinsFor(map, 'bali', 'labuan_bajo', 1)).toBe(1);
    expect(remainingWinsFor(map, 'jakarta', 'toraja', 0)).toBe(4); // w = 0 -> from node
  });
});

describe('map validation rejects invalid data (map_rejects_invalid_<case>)', () => {
  const mutate = (fn: (d: MapData) => void): MapData => {
    const d = indonesiaData();
    fn(d);
    return d;
  };
  const cases: [string, (d: MapData) => void, RegExp][] = [
    ['cycle', (d) => d.edges.push({ from: 'labuan_bajo', to: 'bali' }), /cycle/],
    ['unknown-edge', (d) => d.edges.push({ from: 'bali', to: 'atlantis' }), /unknown region "atlantis"/],
    ['dead-end', (d) => {
      d.regions.push({ id: 'buntu', name: { id: 'Buntu' }, type: 'kota', position: { x: 50, z: 5 } });
      d.edges.push({ from: 'jakarta', to: 'buntu' });
    }, /dead end at "buntu"/],
    ['start-to-finish', (d) => d.edges.push({ from: 'sabang', to: 'merauke' }), /direct edge start -> finish/],
    ['finish-outgoing', (d) => {
      d.regions.push({ id: 'after', name: { id: 'After' }, type: 'kota', position: { x: 99, z: 39 } });
      d.edges.push({ from: 'merauke', to: 'after' });
    }, /finish "merauke" has outgoing edges/],
    ['route-too-long', (d) => {
      d.regions.push({ id: 'extra', name: { id: 'Extra' }, type: 'kota', position: { x: 70, z: 38 } });
      d.edges = d.edges.filter((e) => !(e.from === 'labuan_bajo' && e.to === 'merauke'));
      d.edges.push({ from: 'labuan_bajo', to: 'extra' }, { from: 'extra', to: 'merauke' });
    }, /route length outside 5-6/],
    ['route-too-short', (d) => d.edges.push({ from: 'jakarta', to: 'raja_ampat' }), /route length outside 5-6/],
    ['one-branch', (d) => {
      d.edges = d.edges.filter((e) => !(e.from === 'sabang' && e.to === 'padang') && !(e.from === 'toraja' && e.to === 'labuan_bajo'));
      d.regions = d.regions.filter((r) => r.id !== 'padang');
      d.edges = d.edges.filter((e) => e.from !== 'padang');
      d.places = d.places.filter((p) => p.regionId !== 'padang');
      d.places.push({ ...d.places[0]!, id: 'x1' }, { ...d.places[0]!, id: 'x2' });
    }, /branch/],
    ['few-places', (d) => { d.places = d.places.slice(0, 7); }, /needs >= 8 places/],
    ['places-4-regions', (d) => {
      const keep = new Set(['sabang', 'medan', 'padang', 'jakarta']);
      const base = d.places.filter((p) => keep.has(p.regionId));
      d.places = [...base, ...base.map((p) => ({ ...p, id: `${p.id}_2` }))];
    }, /cover >= 5 regions/],
    ['unknown-type', (d) => { d.regions[1]!.type = 'gurun'; }, /unknown type "gurun"/],
    ['bad-place-region', (d) => { d.places[0]!.regionId = 'atlantis'; }, /unknown regionId/],
  ];

  it.each(cases)('%s', (_name, fn, pattern) => {
    const problems = validateMap(mutate(fn));
    expect(problems.join('\n')).toMatch(pattern);
    expect(() => loadMap(mutate(fn))).toThrow(MapValidationError);
  });

  it('a minigame whose requires() fails is reported', () => {
    const problems = validateMap(indonesiaData(), [{ id: 'needs_more', requires: () => false }]);
    expect(problems.join()).toMatch(/needs_more/);
  });
});

describe('presets', () => {
  it('short preset (start Jakarta) validates on the reachable subgraph (map_short_preset_validates)', () => {
    expect(validatePreset(indonesiaData(), 'short')).toEqual([]);
    const d = indonesiaData();
    d.presets.short.enabled = true;
    expect(validateMap(d)).toEqual([]);
    const short = loadMap(d, 'short');
    expect(short.playDist.get('jakarta')).toBe(2);
    expect(totalWins(short)).toBe(4);
  });
});
