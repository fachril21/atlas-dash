import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indonesiaData, ROOT } from './helpers';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}
const SRC = join(ROOT, 'src');
const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('architecture', () => {
  it('src/logic imports no three.js, render, ui or DOM APIs', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(join(SRC, 'logic'))) {
      const src = stripComments(read(file));
      const rel = relative(ROOT, file);
      if (/from\s+['"]three(\/[^'"]*)?['"]/.test(src)) offenders.push(`${rel}: imports three`);
      if (/from\s+['"](\.\.\/)+(render|ui)\//.test(src)) offenders.push(`${rel}: imports render/ui`);
      if (/\b(window|document|requestAnimationFrame|HTMLElement|localStorage|performance)\b/.test(src)) {
        offenders.push(`${rel}: uses a DOM global`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('Math.random is only used to create the matchSeed (no_math_random, DR-21)', () => {
    const uses = tsFiles(SRC).flatMap((f) =>
      stripComments(read(f)).split('\n').filter((l) => l.includes('Math.random')).map((l) => `${relative(ROOT, f)}: ${l.trim()}`),
    );
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/^src\/main\.ts: .*matchSeed/);
  });

  it('no map-specific region ids or names in code (map_no_map_ids_in_code, R4)', () => {
    const data = indonesiaData();
    const words = new Set<string>();
    for (const r of data.regions) {
      words.add(r.id);
      for (const n of Object.values(r.name)) words.add(n);
    }
    const offenders: string[] = [];
    for (const f of tsFiles(SRC)) {
      const src = stripComments(read(f)).toLowerCase();
      for (const w of words) if (new RegExp(`\\b${w.toLowerCase()}\\b`).test(src)) offenders.push(`${relative(ROOT, f)}: ${w}`);
    }
    expect(offenders).toEqual([]);
  });
});
