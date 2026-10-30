// Settings › Automation › Test box (test box plan TB10, D-7412; spec 2026-10-28 §2.7's width table), in a real Chrome
// over the production build, at phone, laptop and wide widths. `src/fleet/TestBoxSection.test.tsx` holds the card's
// behaviour in jsdom; this file holds what only an engine can say, row by row of the spec's table:
//   * phone: one column, the state above the summary, Bring tools up to date as wide as the card, and the versions,
//     the counts, the pristine installs and the failed keys hidden until the disclosure opens;
//   * laptop: the switch and the state on one line, the button at the state line's end, three cells in one row, the
//     versions table open under them;
//   * wide: the versions and pristine-installs tables open side by side.
// At every width nothing in the card or on the page overflows sideways, and the switch posts `{on}` only.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd, no test box. Run: `( cd pwa &&
// CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/testbox-card.browser.test.ts )`. `CCRC_SHOTS=<a directory>` keeps one picture per width.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { TESTBOX_PROTO, type StatusAnswer } from '../../shared/testbox';
import { TESTBOX_TEXT } from '../src/fleet/TestBoxSection';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

/** Phone, laptop and wide, each in the skin that width boots by default. */
const VIEWS: readonly (AppView & { readonly band: 'phone' | 'laptop' | 'wide' })[] = [
  { band: 'phone', skin: REFINED, theme: PHOSPHOR, width: 390 },
  { band: 'laptop', skin: INSTRUMENT, theme: 'light', width: 1280 },
  { band: 'wide', skin: INSTRUMENT, theme: PHOSPHOR, width: 1920 },
];
const named = (v: (typeof VIEWS)[number]): string => `${v.band}: ${v.skin}, ${v.theme}, ${v.width}px`;

const T = TESTBOX_TEXT;
const TITLE = SETTINGS_CARDS.automation.testbox.title;
const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const STATUS: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900',
  tools: { ...TOOLS, node: '22.12.0' }, sync: { state: 'idle', detail: null, at: '2026-10-30T10:00:00Z' },
  runs: { inProgress: 1, limit: 4 }, queueDepth: 2,
  pristine: [
    { repository: 'project-a', package: 'server', key: 'aaaaaaaaaaaaaaaa' },
    { repository: 'project-a', package: 'pwa', key: 'cccccccccccccccc' },
  ],
  failedKeys: [{ repository: 'project-a', package: 'agent', key: 'dddddddddddddddddddd', exit: 1, attempts: 3, nextAttempt: '2026-10-30T13:00:00Z' }],
  heldRunUsers: [], repositories: [{ name: 'project-a', mirrorPath: '/srv/mirrors/project-a.git' }],
};
const BLOCK = {
  state: 'degraded', reasons: ['tools differ (node 22.11.0 vs 22.12.0)'], summary: 'degraded (tools differ (node 22.11.0 vs 22.12.0))',
  switch: 'off', at: Date.now(), host: { tools: TOOLS, release: 'v0.0.900', measuredAt: '2026-10-30T11:59:59Z' }, box: STATUS,
  cells: [], counts: { remote: 7, fallback: 3, refused: 1, unreadable: 0, byReason: { 'queue-full': 2, unreachable: 1, 'unmerged-paths': 1 } },
};

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
  dist = buildDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  removeDist(dist);
});

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  band: string | null;
  card: { scrollWidth: number; clientWidth: number; box: Box };
  head: Box;
  stateLine: Box;
  state: Box;
  button: Box | null;
  cells: Box[];
  tables: Record<string, Box | null>;
  overflowing: string[];
}

/** The card's geometry, measured in the page. */
const measure = (el: Element): Measured => {
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const one = (sel: string): Element => {
    const found = el.querySelector(sel);
    if (found === null) throw new Error(`the card has no ${sel}`);
    return found;
  };
  // Inside a shut `<details>` an element keeps its boxes but is not rendered (`content-visibility`), so visibility is
  // the engine's own check.
  const shown = (e: Element | null): Box | null => (e === null || !e.checkVisibility({ contentVisibilityAuto: true }) ? null : box(e));
  const card = one(':scope > div:last-child');
  return {
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    band: el.getAttribute('data-band'),
    card: { scrollWidth: card.scrollWidth, clientWidth: card.clientWidth, box: box(card) },
    head: box(one('[data-testbox="head"]')),
    stateLine: box(one('[data-testbox="state-line"]')),
    state: box(one('[data-testbox="state"]')),
    button: shown(el.querySelector('[data-testbox="sync"]')),
    cells: [...el.querySelectorAll('[data-testbox="cells"] [data-cell]')].map(box),
    tables: Object.fromEntries(['versions', 'counts', 'pristine', 'failed']
      .map((n) => [n, shown(el.querySelector(`[data-table="${n}"]`))])),
    overflowing: [...el.querySelectorAll('*')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')
      .map((e) => e.tagName.toLowerCase() + (e.getAttribute('data-testbox') ?? e.getAttribute('data-table') ?? '')),
  };
};

describe('Settings › Automation › Test box at phone, laptop and wide (D-7412)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      const posts: unknown[] = [];
      // The card's three doors. A route registered after `openApp`'s runs first (Playwright), so these answer the doors
      // and every other `/api` path falls through to the fixture.
      await ctx.route('**/api/testbox', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, testbox: BLOCK }) }));
      await ctx.route('**/api/testbox/switch', async (r) => {
        posts.push(r.request().postDataJSON());
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, requested: true }) });
      });
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: TITLE });
        await expect.poll(() => section.locator('[data-testbox="state"]').count(), { timeout: 20_000 }).toBe(1);
        const m = await section.evaluate(measure);
        const shots = process.env.CCRC_SHOTS;
        if (shots) await section.screenshot({ path: path.join(shots, `testbox-${view.band}-${view.width}.png`) });

        expect(m.band).toBe(view.band);
        // Nothing overflows sideways: the card, any scroller inside it, and the page.
        expect(m.card.scrollWidth, 'the card overflows sideways').toBeLessThanOrEqual(m.card.clientWidth);
        expect(m.overflowing, 'an element inside the card scrolls sideways').toEqual([]);
        expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
        expect(m.card.box.left).toBeGreaterThanOrEqual(0);
        expect(m.card.box.right).toBeLessThanOrEqual(m.viewport);
        expect(m.button, 'a differing tool shows Bring tools up to date').not.toBeNull();
        const button = m.button!;

        if (view.band === 'phone') {
          // One column: the state line under the switch, the summary under the state, the button as wide as its line.
          expect(m.stateLine.top).toBeGreaterThan(m.head.top);
          expect(m.cells).toHaveLength(2);
          expect(m.cells[0]!.top).toBeGreaterThanOrEqual(m.stateLine.bottom - 0.5);
          expect(Math.abs(button.width - m.stateLine.width), 'the button is full-width').toBeLessThanOrEqual(1);
          expect(button.top).toBeGreaterThanOrEqual(m.state.bottom - 0.5);
          // Versions, counts, pristine installs and failed keys are behind the disclosure until it opens.
          expect(Object.values(m.tables)).toEqual([null, null, null, null]);
          await section.getByText(T.details).click();
          const opened = await section.evaluate(measure);
          for (const [name, b] of Object.entries(opened.tables)) {
            expect(b, `${name} shows once the disclosure opens`).not.toBeNull();
            expect(b!.right, `${name} runs past the card`).toBeLessThanOrEqual(opened.card.box.right + 0.5);
          }
          expect(opened.overflowing).toEqual([]);
          expect(opened.pageScrollWidth).toBeLessThanOrEqual(opened.pageClientWidth);
        } else {
          // The switch and the state on one line; the button at the state line's end, on the state's line.
          expect(Math.abs(m.stateLine.top - m.head.top), 'the switch and the state share a line').toBeLessThanOrEqual(1);
          expect(Math.abs(button.right - m.stateLine.right), 'the button ends the state line').toBeLessThanOrEqual(1);
          expect(button.left).toBeGreaterThan(m.state.left);
          expect(button.top).toBeLessThan(m.state.bottom);
          // Three cells in one row.
          expect(m.cells).toHaveLength(3);
          expect(new Set(m.cells.map((c) => Math.round(c.top))).size, 'the three cells share a row').toBe(1);
          expect(m.tables.versions, 'the versions table is open').not.toBeNull();
          expect(m.tables.versions!.top).toBeGreaterThanOrEqual(m.cells[0]!.bottom - 0.5);
          if (view.band === 'wide') {
            const v = m.tables.versions!;
            const p = m.tables.pristine;
            expect(p, 'the pristine-installs table is open').not.toBeNull();
            expect(Math.abs(v.top - p!.top), 'the two tables share a row').toBeLessThanOrEqual(1);
            expect(v.right, 'the two tables sit side by side').toBeLessThanOrEqual(p!.left);
          } else {
            expect(m.tables.pristine, 'the pristine installs are behind the disclosure').toBeNull();
          }
        }

        // The switch posts {on} only.
        await section.getByRole('radio', { name: T.on }).click();
        await expect.poll(() => posts.length, { timeout: 10_000 }).toBe(1);
        expect(posts).toEqual([{ on: true }]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
