// Settings' index, its two diagnostic doors (Reader lab, Measure highlighting), in a real Chrome over the production
// build, at 390 and 1280 in both skins (the library 1.1 take-up plan, Task 9 Step 4; fix round 1, A6).
// `test/settings-frame.test.tsx` holds the rows' order, hrefs and clicks in jsdom; this file holds what only an engine can
// say: in either skin each door draws the shared row's skeleton (its icon, its name, its purpose line, its chevron), is at
// least one tap tall and whole inside the index, carries no status line and no current mark, follows the six section
// rows, and nothing on the page scrolls sideways.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/settings-diagnostics.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { SETTINGS_INDEX_TEXT } from '../src/fleet/settingsText';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [390, 1280].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const TAP = 44;
const DIAGNOSTICS = ['reader-lab', 'measure-highlighting'] as const;

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] },
    { type: 'runs', runs: [] },
    { type: 'coord', coord: { pause: 'clear' } },
  ],
};

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

interface Box { left: number; right: number; top: number; bottom: number; height: number }
interface Door {
  id: string; box: Box; icons: number; name: string; purpose: string; status: number; skeleton: number;
  current: string | null; purposeShown: boolean;
}
interface Measured {
  viewport: number; pageScrollWidth: number; pageClientWidth: number; index: Box; order: string[]; doors: Door[];
}

describe("Settings' index: the two diagnostic doors in both skins (Task 9 Step 4; fix round 1, A6)", () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/settings');
        const nav = page.getByRole('navigation', { name: 'Settings sections' });
        await expect.poll(() => nav.locator('a[data-diagnostic]').count(), { timeout: 20_000 }).toBe(2);
        const m = await nav.evaluate((el): Measured => {
          const box = (e: Element): Box => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
          };
          const shown = (e: Element | null): boolean => {
            if (e === null) return false;
            const r = e.getBoundingClientRect();
            const cs = getComputedStyle(e);
            return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
          };
          const rows = [...el.querySelectorAll('a.settings-index-row')];
          return {
            viewport: window.innerWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            pageClientWidth: document.documentElement.clientWidth,
            index: box(el),
            order: rows.map((a) => a.getAttribute('data-section') ?? `diagnostic:${a.getAttribute('data-diagnostic') ?? ''}`),
            doors: [...el.querySelectorAll('a[data-diagnostic]')].map((a) => ({
              id: a.getAttribute('data-diagnostic') ?? '',
              box: box(a),
              icons: a.querySelectorAll('svg').length,
              name: a.querySelector('.settings-index-name')?.textContent ?? '',
              purpose: a.querySelector('.settings-index-purpose')?.textContent ?? '',
              purposeShown: shown(a.querySelector('.settings-index-purpose')),
              status: a.querySelectorAll('.settings-index-status').length,
              skeleton: a.querySelectorAll('.skel, [role=status]').length,
              current: a.getAttribute('aria-current'),
            })),
          };
        });
        console.log(`T9-FIGURES settings-diagnostics ${named(view)} ${JSON.stringify(m.doors.map((d) => ({ id: d.id, h: d.box.height, icons: d.icons })))}`);
        expect(m.order.slice(-2), 'the two doors follow the six section rows').toEqual(DIAGNOSTICS.map((d) => `diagnostic:${d}`));
        expect(m.order.filter((o) => !o.startsWith('diagnostic:')), 'six section rows before them').toHaveLength(6);
        expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
        for (const d of m.doors) {
          const id = d.id as typeof DIAGNOSTICS[number];
          expect(d.purpose, `${id}: its purpose line`).toBe(SETTINGS_INDEX_TEXT.diagnosticPurpose[id]);
          expect(d.purposeShown, `${id}: the purpose line is drawn`).toBe(true);
          expect(d.icons, `${id}: its icon and its chevron`).toBe(2);
          expect(d.name.length, `${id}: its name`).toBeGreaterThan(0);
          expect(d.status, `${id}: a diagnostic door has no status line`).toBe(0);
          expect(d.skeleton, `${id}: and no status skeleton`).toBe(0);
          expect(d.current, `${id}: never marked as the current section`).toBeNull();
          expect(d.box.height, `${id}: at least one tap tall`).toBeGreaterThanOrEqual(TAP);
          expect(d.box.left, `${id}: starts inside the index`).toBeGreaterThanOrEqual(m.index.left - 0.5);
          expect(d.box.right, `${id}: ends inside the index`).toBeLessThanOrEqual(m.index.right + 0.5);
          expect(d.box.right, `${id}: ends inside the window`).toBeLessThanOrEqual(m.viewport);
        }
        expect(errors, 'no page error').toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);
  }
});
