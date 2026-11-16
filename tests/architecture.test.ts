import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOGIC_DIR = join(import.meta.dirname, '..', 'src', 'logic');

describe('architecture', () => {
  it('src/logic imports no three.js, render, ui or DOM APIs', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(LOGIC_DIR).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(LOGIC_DIR, file), 'utf8');
      if (/from\s+['"](three|three\/.*)['"]/.test(src)) offenders.push(`${file}: imports three`);
      if (/from\s+['"]\.\.\/(render|ui)\//.test(src)) offenders.push(`${file}: imports render/ui`);
      if (/\b(window|document|requestAnimationFrame|HTMLElement|localStorage)\b/.test(src)) {
        offenders.push(`${file}: uses a DOM global`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
