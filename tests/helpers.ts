import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MapData } from '../src/logic';

export const ROOT = join(import.meta.dirname, '..');

/** Fresh deep copy of the real Indonesia map data. */
export function indonesiaData(): MapData {
  return JSON.parse(readFileSync(join(ROOT, 'public/maps/indonesia/map.json'), 'utf8')) as MapData;
}
