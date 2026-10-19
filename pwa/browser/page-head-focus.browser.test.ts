// Focus is never hidden under the page header (D-5667; WCAG 2.2 SC 2.4.11, Focus Not Obscured), in a real Chrome over
// the production build.
//
// PageScaffold's header is sticky (D-5102), so a row scrolled to the scroller's top edge sits under it. When a keyboard
// user Shift+Tabs up a list that runs past the fold, the browser scrolls each focused row just into view: with nothing
// reserving the header's height, that is under the header (Refined's 56px header covered a 44px Archive row whole, so
// no focus ring showed). The scaffold gives every element in its body a scroll margin of the header's height and one
// step of air (`PAGE_FOCUS_CLEAR`), which the browser honours when focus scrolls.
//
// Measured on Archive with 30 archived workspaces, the longest focusable list on the scaffold: focus the last row, then
// Shift+Tab up through every row, and after each step the focused element's top must clear the header's bottom. Both
// skins, both Phosphor palettes, at 360, 390, 1280 and 1920; no horizontal overflow and no page error either.
// `test/page-scaffold.test.tsx` pins the class that produces this; this file holds the geometry.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1920] as const;
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const NOW = 1_792_362_479;
const ROWS = 30;
const archived = (i: number): object => ({
  id: `project-${i % 3}-ws-${i}`, wrapper: 'lane-a', home: 'lane-a', project: `project-${i % 3}`,
  workdir: `/w/project-${i % 3}/ws-${i}`, workspace: `ws-${i}`, name: `ws-${i}`,
  status: 'dead', statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: `ws/ws-${i}`, ctxPct: null, paneCols: null, tasks: null, pr: null,
  archivedAt: NOW - i * 100_000, archivedBytes: 100_000_000 * (i + 1), held: null, hookState: null, askSummary: null,
  subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'dead',
  unmeasured: [], started: true, child: { kind: 'none' },
});
const FIXTURE: AppFixture = {
  api: {},
  fleetFrames: [{ type: 'fleet', sessions: Array.from({ length: ROWS }, (_, i) => archived(i)) }],
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

interface Step {
  readonly label: string;
  /** How far the focused element's top sits below the header's bottom (< 0: under the header). */
  readonly clear: number;
}

describe('the page header never hides keyboard focus (D-5667)', () => {
  for (const view of VIEWS) {
    it(`Shift+Tab up Archive's ${ROWS} rows keeps each focused row clear of the header — ${named(view)}`, async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/archive');
        await page.waitForFunction(([skin, theme]) => {
          const root = document.documentElement;
          return root.getAttribute('data-skin') === skin && (root.getAttribute('data-theme') ?? 'phosphor') === theme;
        }, [view.skin, view.theme] as const, { timeout: 20_000 });
        const rows = page.locator('[data-page-scaffold] [data-page-body] .archive-row');
        await rows.nth(ROWS - 1).waitFor({ timeout: 20_000 });
        expect(await rows.count()).toBe(ROWS);
        await rows.nth(ROWS - 1).focus();
        const steps: Step[] = [];
        for (let i = 0; i < ROWS - 1; i++) {
          await page.keyboard.press('Shift+Tab');
          const step = await page.evaluate(() => {
            const a = document.activeElement;
            const body = document.querySelector('[data-page-body]');
            const head = document.querySelector('[data-page-scaffold] header');
            if (a === null || body === null || head === null || !body.contains(a)) return null;
            return {
              label: (a.textContent ?? '').trim().slice(0, 24),
              clear: Math.round(a.getBoundingClientRect().top - head.getBoundingClientRect().bottom),
            };
          });
          if (step !== null) steps.push(step);
        }
        expect(steps.length, 'Shift+Tab walked the rows').toBeGreaterThanOrEqual(ROWS - 1);
        expect(steps.filter((s) => s.clear < 0), 'focused rows under the header').toEqual([]);
        const side = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(side, 'horizontal overflow').toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
