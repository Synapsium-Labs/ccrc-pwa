// Instrument's rail tooltip, measured in a real Chrome over the production build (W2 Task S9, D-5472). The jsdom
// suite (test/instrument-shell.test.tsx) pins the rules that produce this geometry; this file holds the geometry.
//
// The plan's Step 4: every rail icon has its tooltip, by hover and by Tab. A tooltip's opacity says nothing about
// whether it is drawn: an ancestor that clips (any `overflow` but visible, in either axis) cuts it away. So each case
// checks, for the item's tip, that it is opaque, inside the viewport and inside every clipping ancestor's box; that
// the rail itself does not scroll sideways; and that the focused item, and its ring, fit the rail. Both Phosphor
// palettes, at 1280 and 1920 (the rail mounts from 900 up), on the fleet route and on /runs.
//
// Chrome comes from `resolveChrome()` in `beforeAll`, which THROWS when neither `CCRC_CHROME` nor
// `/usr/bin/google-chrome` is an executable file: a box without Chrome gives a red leg, never a skipped one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [1280, 1920] as const;
const ROUTES = ['/', '/runs'] as const;
const VIEWS: AppView[] = THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin: INSTRUMENT, theme, width })));
const named = (v: AppView, route: string): string => `${v.theme}, ${v.width}px, ${route}`;

const FIXTURE: AppFixture = {
  api: { '/api/accounts': { accounts: [], projected: null, roster: [] }, '/api/runs': [], '/api/claims': [] },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
};

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

interface TipFit {
  readonly opacity: number;
  /** Clipping ancestors (any overflow but visible) whose box does not hold the whole tip. */
  readonly clippedBy: string[];
  readonly inViewport: boolean;
  /** How far the rail moves when asked to scroll sideways by 100px: 0 when it is no scroll container. (Its
   *  scrollWidth counts the hidden tips even when it cannot scroll, so the attempt is the measure.) */
  readonly railSideScroll: number;
  /** How far the item runs past the rail's content box, either side (<= 0 fits). */
  readonly itemOver: number;
}

/** Measure the tip of the rail item named `word`, once its transition has settled. */
async function measureTip(page: Page, word: string): Promise<TipFit> {
  await page.waitForTimeout(300);
  return page.evaluate((w) => {
    const rail = document.querySelector<HTMLElement>('nav.shell-rail')!;
    const item = rail.querySelector<HTMLElement>(`.ins-rail-item[aria-label="${w}"]`)!;
    const tip = item.querySelector<HTMLElement>('.ins-rail-tip')!;
    const t = tip.getBoundingClientRect();
    const clippedBy: string[] = [];
    for (let el = tip.parentElement; el !== null && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const r = el.getBoundingClientRect();
      if (t.left < r.left || t.right > r.right || t.top < r.top || t.bottom > r.bottom) {
        clippedBy.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
      }
    }
    const rr = rail.getBoundingClientRect();
    const ir = item.getBoundingClientRect();
    const contentLeft = rr.left + rail.clientLeft;
    const contentRight = contentLeft + rail.clientWidth;
    return {
      opacity: parseFloat(getComputedStyle(tip).opacity),
      clippedBy,
      inViewport: t.left >= 0 && t.top >= 0 && t.right <= window.innerWidth && t.bottom <= window.innerHeight && t.width > 0,
      railSideScroll: (() => { rail.scrollLeft = 100; const moved = rail.scrollLeft; rail.scrollLeft = 0; return moved; })(),
      itemOver: Math.max(contentLeft - ir.left, ir.right - contentRight),
    };
  }, word);
}

describe("Instrument's rail tooltip is drawn beside the rail, by hover and by Tab", () => {
  for (const view of VIEWS) {
    for (const route of ROUTES) {
      it(named(view, route), async () => {
        const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
        try {
          await page.goto(server!.origin + route);
          await page.waitForSelector('nav.shell-rail .ins-rail-item', { timeout: 20_000 });

          // Hover.
          await page.hover('nav.shell-rail .ins-rail-item[aria-label="Runs"]');
          const hovered = await measureTip(page, 'Runs');
          expect(hovered.opacity, 'hover: opacity').toBe(1);
          expect(hovered.clippedBy, 'hover: clipped by').toEqual([]);
          expect(hovered.inViewport, 'hover: in the viewport').toBe(true);
          await page.mouse.move(view.width - 10, 450);

          // Tab, from the top of the page, until the Inbox item has the focus.
          await page.locator('body').click({ position: { x: view.width - 10, y: 450 } });
          let reached = false;
          for (let i = 0; i < 40 && !reached; i += 1) {
            await page.keyboard.press('Tab');
            reached = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Inbox'
              && document.activeElement.matches('.ins-rail-item:focus-visible'));
          }
          expect(reached, 'Tab reaches the Inbox item').toBe(true);
          const tabbed = await measureTip(page, 'Inbox');
          expect(tabbed.opacity, 'Tab: opacity').toBe(1);
          expect(tabbed.clippedBy, 'Tab: clipped by').toEqual([]);
          expect(tabbed.inViewport, 'Tab: in the viewport').toBe(true);
          expect(tabbed.itemOver, 'the focused item fits the rail').toBeLessThanOrEqual(0);
          expect(tabbed.railSideScroll, 'the rail does not scroll sideways').toBeLessThanOrEqual(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});
