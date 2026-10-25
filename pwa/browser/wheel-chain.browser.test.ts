// A wheel over a code block or a tool well reaches the transcript (D-6437, desktop polish Task C5), in a real Chrome
// over the production build.
//
// A code block is a scroll container, and `overscroll-behavior: contain` on it stops scroll chaining on both axes even
// when the block has nothing to scroll: measured at 1920 in both skins, a wheel over a block moved `.chat-scroller`
// 0 px, over prose 600 px. jsdom computes no layout and dispatches no wheel, so this file holds what Chrome does with
// `page.mouse.wheel`: at 1280 and 1920 in both skins and both palettes, with the pointer over the element —
//   - a block, and a tool card's result well, whose content fits: the wheel moves the transcript and not the box;
//   - a block taller than `--well-max` (a tool card's result well and an answer chip do the same, in the sibling files):
//     the wheel scrolls the box first, then, with the box at its end, the transcript, and the box stays at its end. That
//     second half is swept over eight sub-pixel offsets (k/8 px) of the box's wrapper: with a fractional scroll range
//     Chrome latches the first wheel at a box's end to the box, which cannot move, at some page offsets, so a single
//     resting offset can pass by luck (a mono box therefore needs a whole-pixel line height: 13px x 1.55 = 20.15px is
//     not one). The FIRST wheel must move the transcript at every offset, and a failure names its offset;
//   - a block with a 300-character line: a sideways wheel moves the block's `scrollLeft` and not the transcript's
//     `scrollTop`. This pins that the block itself scrolls sideways (making it `overflow-x: hidden` reds it); the
//     x-only containment is masked by `.chat-scroller`'s own containment, so its guard is the static test alone;
//   - control: a wheel over prose moves the transcript, which proves this harness can see a chain at all.
// Every wheel is measured from a settled position: the scroller (virtuoso, anchored to the bottom, following output)
// and the box are read until several consecutive reads agree, so settling never counts as a wheel's effect. The box's
// and the scroller's positions are read and asserted separately, so a red names which one moved. The pointer is
// checked to be over the target (`elementFromPoint`) before every wheel: over the composer or a sticky head it would
// fake a result.
//
// This file holds the code blocks, the sideways wheel and the control. The tall tool well is
// `wheel-chain-well.browser.test.ts`'s and the answer chips (fitting and tall) are `wheel-chain-chip.browser.test.ts`'s:
// split by box because vitest runs one file's cases serially and CI's browser job has a fixed timeout, while files run
// in parallel. The shared fixture and helpers are `wheel.ts`.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/wheel-chain.browser.test.ts )`.
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

describe('a wheel over a code block whose content fits moves .chat-scroller', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(rig(), view, 'fit', async (page) => {
      const fit = await settle(page, 'fit');
      const dims = await page.evaluate(() => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find('fit');
        return { sh: el.scrollHeight, ch: el.clientHeight };
      });
      expect(dims.sh, 'the three-line block fits').toBeLessThanOrEqual(dims.ch);
      const dy = direction(fit);
      const m = await wheelOver(page, 'fit', 0, dy);
      expect(Math.abs(m.boxTop), 'the block has nothing to scroll').toBeLessThan(2);
      expect(Math.abs(m.scroller), `the transcript moved by ${m.scroller}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.sign(m.scroller), 'in the wheel direction').toBe(Math.sign(dy));
    }), 120_000);
  }
});

describe('a wheel over a tool card\'s well whose content fits moves .chat-scroller', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(rig(), view, 'well', async (page) => {
      const well = await settle(page, 'well');
      const dims = await page.evaluate(() => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find('well');
        return { sh: el.scrollHeight, ch: el.clientHeight };
      });
      expect(dims.sh, 'the two-line result well fits').toBeLessThanOrEqual(dims.ch);
      const dy = direction(well);
      const m = await wheelOver(page, 'well', 0, dy);
      expect(Math.abs(m.boxTop), 'the well has nothing to scroll').toBeLessThan(2);
      expect(Math.abs(m.scroller), `the transcript moved by ${m.scroller}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.sign(m.scroller), 'in the wheel direction').toBe(Math.sign(dy));
    }), 120_000);
  }
});

describe('a wheel over a code block taller than --well-max scrolls the block first, then the transcript', () => {
  for (const view of VIEWS) {
    it(named(view), () => tallBox(rig(), view, { kind: 'tall', wrapper: '.msg-assist .code-block', what: 'sixty-line block', range: 300, wraps: false }), 120_000);
  }
});

describe('a sideways wheel over a code block that overflows moves the block\'s scrollLeft and not the scroller\'s scrollTop', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(rig(), view, 'wide', async (page) => {
      await settle(page, 'wide');
      const dims = await page.evaluate(() => {
        const el = (window as unknown as { __c5: { find: (kind: string) => HTMLElement } }).__c5.find('wide');
        return { sw: el.scrollWidth, cw: el.clientWidth, left: el.scrollLeft };
      });
      expect(dims.sw, 'the 300-character line overflows sideways').toBeGreaterThan(dims.cw + 300);
      expect(dims.left, 'the block starts at its left edge').toBe(0);
      const m = await wheelOver(page, 'wide', 300, 0);
      expect(m.boxLeft, `the block moved sideways by ${m.boxLeft}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.abs(m.scroller), `the transcript moved by ${m.scroller}px on a sideways wheel`).toBeLessThan(2);
    }), 120_000);
  }
});

describe('control: a wheel over prose moves .chat-scroller', () => {
  for (const view of VIEWS) {
    it(named(view), () => inView(rig(), view, 'prose', async (page) => {
      const prose = await settle(page, 'prose');
      const dy = direction(prose);
      const m = await wheelOver(page, 'prose', 0, dy);
      expect(Math.abs(m.scroller), `the transcript moved by ${m.scroller}px (wanted more than 50)`).toBeGreaterThan(50);
      expect(Math.sign(m.scroller), 'in the wheel direction').toBe(Math.sign(dy));
    }), 120_000);
  }
});
