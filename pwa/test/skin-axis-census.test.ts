// Skins change the runs column through their tokens and nothing else (the runs rebuild, Task 9a, D-8072; spec §8.1, Q2).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUN_COLUMN } from '../src/screens/runColumn';

const read = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8');
const DETAIL = read('src/screens/run-detail.css');
const RUN_CSS = ['src/fleet/fleet.css', 'src/screens/run-detail.css', 'src/screens/run-find.css'].map(read).join('\n');
const ALLOWED = new Set<number>(Object.values(RUN_COLUMN));

describe('the runs column rule', () => {
  it("the runs @container thresholds (fleet.css, run-detail.css, run-find.css) equal RUN_COLUMN", () => {
    const found = [...RUN_CSS.matchAll(/@container\s+runs\s*\(min-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
    expect(found.length).toBeGreaterThan(0);
    for (const n of found) expect(ALLOWED.has(n), `${n}px is not a RUN_COLUMN threshold`).toBe(true);
    for (const n of Object.values(RUN_COLUMN)) {
      if (n === RUN_COLUMN.cards) continue; // the cards' form lands in Task 18
      expect(found, `${n}px is used`).toContain(n);
    }
  });
  it('instrument.css and refined.css hold no .run, .stuck or .programme-card rule', () => {
    for (const f of ['src/skins/instrument/instrument.css', 'src/skins/refined/refined.css']) {
      expect(read(f), f).not.toMatch(/\.(run|stuck|programme-card)\b[-\w]*/);
    }
  });
  it("the board's container rule is the only one on its column", () => {
    const decls = [...DETAIL.matchAll(/container-(?:type|name)\s*:[^;]+;/g)].map((m) => m[0]);
    const runs = DETAIL.match(/\.runs-column\s*\{[^}]*\}/)?.[0] ?? '';
    expect(runs).toMatch(/container-type:\s*inline-size/);
    expect(runs).toMatch(/container-name:\s*runs/);
    expect(decls.filter((d) => /container-name:\s*runs/.test(d))).toHaveLength(1);
  });
});
