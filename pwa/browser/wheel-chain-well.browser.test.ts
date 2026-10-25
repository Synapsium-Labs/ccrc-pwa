// A wheel over a tool card's result well taller than `--well-max` scrolls the well first, then the transcript (D-6437,
// desktop polish Task C5), in a real Chrome over the production build: with the well at its end, the FIRST wheel moves
// the transcript at each of eight sub-pixel offsets (k/8 px) of the well's wrapper (a mono box therefore needs a
// whole-pixel line height). One of the three wheel-chain browser files, split by box so CI's browser job runs them in
// parallel: see `wheel-chain.browser.test.ts` for what every wheel measurement does, and `wheel.ts` for the fixture.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/wheel-chain-well.browser.test.ts )`.
import { afterAll, beforeAll, describe, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { resolveChrome } from './harness';
import { buildDist, removeDist, serveDist, type DistServer } from './app';
import { tallBox, VIEWS, named, type Rig } from './wheel';

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = buildDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  removeDist(dist);
});

const rig = (): Rig => ({ browser: browser!, server: server! });

describe('a wheel over a tool card\'s well taller than --well-max scrolls the well first, then the transcript', () => {
  for (const view of VIEWS) {
    it(named(view), () => tallBox(rig(), view, { kind: 'tallwell', wrapper: '.toolcard', what: 'sixty-line well', range: 300, wraps: true }), 120_000);
  }
});
