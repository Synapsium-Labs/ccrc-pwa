// The files that run the tick diet's `C` rows together run every per-locale block once, and so do the files that run
// its UTF-8 rows (D-6767). The split puts each of
// `registerLocaleRows`'s blocks in one file's part; a block added to the runner and named in no part would run nowhere,
// and a block named in two would run twice, and neither shows as a red anywhere else.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TICK_DIET_C_PARTS, TICK_DIET_UTF8_PARTS } from './ccd-tick-diet-equivalenceFixture.js';

describe('the tick diet C rows: every runner block is in exactly one part (D-6767)', () => {
  it('the parts name each registerLocaleRows block once, and no other', () => {
    const runner = fs.readFileSync(fileURLToPath(new URL('./ccdTickDietRunner.ts', import.meta.url)), 'utf8');
    const blocks = [...runner.matchAll(/^ {2}rowsBlock\('(E\d+)'\)\(/gm)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);
    expect([...Object.values(TICK_DIET_C_PARTS).flat()].sort()).toEqual([...blocks].sort());
  });
  it('the UTF-8 parts name each registerLocaleRows block once, and no other', () => {
    const runner = fs.readFileSync(fileURLToPath(new URL('./ccdTickDietRunner.ts', import.meta.url)), 'utf8');
    const blocks = [...runner.matchAll(/^ {2}rowsBlock\('(E\d+)'\)\(/gm)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);
    expect([...Object.values(TICK_DIET_UTF8_PARTS).flat()].sort()).toEqual([...blocks].sort());
  });
});
