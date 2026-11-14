// The files that run the tick diet's `C` rows together run every per-locale block once, and so do the files that run
// its UTF-8 rows (D-6767). The split puts each of
// `registerLocaleRows`'s blocks in one file's part; a block added to the runner and named in no part would run nowhere,
// and a block named in two would run twice, and neither shows as a red anywhere else.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICK_DIET_C_PARTS, TICK_DIET_UTF8_PARTS } from './ccd-tick-diet-equivalenceFixture.js';
import { ROUTE_CHAIN_SHARES, routeChainIds } from './ccdTickDietRunner.js';
import { ROUTE_ROWS } from './tickDietCorpus.js';

describe('the tick diet C rows: every runner block is in exactly one part (D-6767)', () => {
  it('the parts name each registerLocaleRows block once, and no other', () => {
    const runner = fs.readFileSync(fileURLToPath(new URL('./ccdTickDietRunner.ts', import.meta.url)), 'utf8');
    const blocks = [...runner.matchAll(/^ {2}rowsBlock\('(E\d+(?:-\d+)?)'\)\(/gm)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);
    expect([...Object.values(TICK_DIET_C_PARTS).flat()].sort()).toEqual([...blocks].sort());
  });
  it('the UTF-8 parts name each registerLocaleRows block once, and no other', () => {
    const runner = fs.readFileSync(fileURLToPath(new URL('./ccdTickDietRunner.ts', import.meta.url)), 'utf8');
    const blocks = [...runner.matchAll(/^ {2}rowsBlock\('(E\d+(?:-\d+)?)'\)\(/gm)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(0);
    expect([...Object.values(TICK_DIET_UTF8_PARTS).flat()].sort()).toEqual([...blocks].sort());
  });
  // A part that no file registers runs nowhere, and a part two files register runs twice; neither reds anywhere else.
  // Each part is one `ccd-tick-diet-equivalence-*.test.ts` file's one call (D-6767).
  it.each([
    ['registerCParts', TICK_DIET_C_PARTS],
    ['registerUtf8Parts', TICK_DIET_UTF8_PARTS],
  ] as const)('every part of %s is registered by exactly one file', (fn, parts) => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const calls = fs.readdirSync(dir).filter((f) => f.startsWith('ccd-tick-diet-equivalence-') && f.endsWith('.test.ts'))
      .flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(new RegExp(`^${fn}\\('([a-z0-9-]+)'\\);$`, 'gm'))]
        .map((m) => m[1]));
    expect(calls.sort()).toEqual(Object.keys(parts).sort());
  });

  // E9's chain records run in ROUTE_CHAIN_SHARES blocks, `E9` and `E9-2` on, one file per locale each (D-6767): the
  // shares together must be every ROUTE_ROWS record once, and the records E9a's non-vacuity pins read must be in E9's
  // own share, or a record runs nowhere, runs twice, or a pin reads a row its batch never ran.
  it('E9\'s chain shares are every ROUTE_ROWS record once, each share a block, and the pinned records in E9\'s own', () => {
    const shares = Array.from({ length: ROUTE_CHAIN_SHARES }, (_v, k) => routeChainIds(k + 1));
    expect(ROUTE_CHAIN_SHARES).toBeGreaterThan(1);
    for (const ids of shares) expect(ids.length).toBeGreaterThan(0);
    expect(shares.flat().sort()).toEqual(ROUTE_ROWS.map((r) => r.id).sort());
    const runner = fs.readFileSync(fileURLToPath(new URL('./ccdTickDietRunner.ts', import.meta.url)), 'utf8');
    const e9 = [...runner.matchAll(/^ {2}rowsBlock\('(E9(?:-\d+)?)'\)\(/gm)].map((m) => m[1]);
    expect(e9).toEqual(['E9', ...Array.from({ length: ROUTE_CHAIN_SHARES - 1 }, (_v, k) => `E9-${k + 2}`)]);
    // Each record E9a's non-vacuity pins read by `leg('<id>')`, in E9's block (up to the next block).
    const from = runner.indexOf("  rowsBlock('E9')(");
    const e9Block = runner.slice(from, runner.indexOf('  rowsBlock(', from + 1));
    const pinned = [...e9Block.matchAll(/\bleg\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(pinned.length).toBeGreaterThan(0);
    for (const id of pinned) expect(shares[0], id).toContain(id);
  });
});
