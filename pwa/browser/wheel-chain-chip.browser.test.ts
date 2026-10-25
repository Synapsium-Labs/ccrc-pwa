// A wheel over an answer chip (D-6437, desktop polish Task C5), in a real Chrome over the production build: a chip whose
// content fits moves the transcript (the chip is an `overflow-y: auto` box all the same), and a chip taller than
// `--well-max` scrolls first and then, with the chip at its end, the transcript, the FIRST wheel moving it at each of
// eight sub-pixel offsets (k/8 px) of the chip's wrapper. One of the three wheel-chain browser files, split by box so
// CI's browser job runs them in parallel: see `wheel-chain.browser.test.ts` for what every wheel measurement does, and
// `wheel.ts` for the fixture.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/wheel-chain-chip.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { resolveChrome } from './harness';
import { buildDist, removeDist, serveDist, type DistServer } from './app';
import { direction, inView, named, settle, tallBox, VIEWS, wheelOver, type Rig } from './wheel';

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

describe('a wheel over an answer chip whose content fits moves .chat-scroller', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(rig(), view, 'chipfit', async (page) => {
      const chip = await settle(page, 'chipfit');
      const dims = await page.evaluate(() => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find('chipfit');
        return { sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY };
      });
      expect(dims.oy, 'the chip is a scroll container even when its answer fits').toBe('auto');
      expect(dims.sh, 'the one-line answer fits').toBeLessThanOrEqual(dims.ch);
      const dy = direction(chip);
      const m = await wheelOver(page, 'chipfit', 0, dy);
      expect(Math.abs(m.boxTop), 'the chip has nothing to scroll').toBeLessThan(2);
      expect(Math.abs(m.scroller), `the transcript moved by ${m.scroller}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.sign(m.scroller), 'in the wheel direction').toBe(Math.sign(dy));
    }), 120_000);
  }
});

describe('a wheel over an answer chip taller than --well-max scrolls the chip first, then the transcript', () => {
  for (const view of VIEWS) {
    it(named(view), () => tallBox(rig(), view, { kind: 'chip', wrapper: '.tool-ask', what: 'answer chip', range: 200, wraps: true }), 120_000);
  }
});
