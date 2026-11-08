// The runs board at every width (the runs rebuild, D-8072; spec 2026-11-04 section 8.2 and its per-width table; wave B2 Task 9),
// in a real Chrome over the production build: 360, 390, 1280, 1470 and 1920 wide, both skins, both themes. jsdom cannot lay a row
// out, so what a row FITS is measured here: no sideways page scroll, no row wider than its box, the wait line inside its row,
// every open door at the tap floor, a tap on a row landing on `/runs/<id>`, and a phone reaching a run by its number.
// This file sets the width matrix up once; later waves add their rows to `MATRIX`'s cases. Names are neutral.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/runs-widths.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer, type OpenedApp } from './app';

const NOW = Date.now();
const H = 3_600_000;
const DAY = 24 * H;

/** The matrix every board row is judged on: the five widths, both skins, both themes. */
export const MATRIX = {
  widths: [360, 390, 1280, 1470, 1920],
  skins: [REFINED, INSTRUMENT],
  themes: ['light', 'dark'],
} as const;

const run = (id: number, over: Record<string, unknown> = {}): object => ({
  id, program: 'prog-a', programTitle: 'Programme A with a title long enough to wrap on a phone', wave: 2, waveOf: 5,
  project: 'project-a', homeProject: 'project-a', sessionId: `project-a-w${id}`, workspace: `ws-${id}`, branch: `ws/${id}`,
  state: 'working', kind: 'work', reviews: null, claimedBy: 'project-a-coord', resumed: false, clearedAt: null,
  openedAt: NOW - 3 * H, dispatchStartedAt: null, dispatchedAt: NOW - 2 * H, closedAt: null, handoffCommit: null,
  items: { done: 1, total: 4 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false, ...over,
});

const RUNS = [
  run(1501),
  run(1502, { sessionId: null, state: 'planned', dispatchedAt: null, waitsOn: 'coordinator' }),
  run(1503, { sessionId: null, state: 'planned', dispatchedAt: null, blockedBy: 1012 }),
  run(1504, { state: 'awaiting-review', waitsOn: 'coordinator', lastMoveAt: NOW - 2 * DAY }),
  run(1505, { state: 'working', waitsOn: 'worker', lastMoveAt: NOW - 9 * DAY }),
  run(1527, { program: 'prog-b', programTitle: 'Programme B' }),
];

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a', repo: { state: 'named', slug: 'owner-a/repo-a' } }] },
    '/api/runs': { runs: RUNS, nextBefore: null }, '/api/claims': [],
    // The run page the number lands on reads these four; a real server answers each in this shape.
    '/api/runs/1527/record': { ok: true, run: RUNS[5], events: [], reviewedBy: [], olderEvents: 0 },
    '/api/runs/1527': { ok: true, run: RUNS[5], spend: { measured: false, reason: 'no-sweep' } },
    '/api/runs/1527/items': { ok: true, items: [] },
    '/api/runs/1527/signals': { ok: true, signals: { signals: { suite: { ok: false, why: 'absent' }, failure: { ok: false, why: 'absent' } } } },
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 1 }, updatedAt: null },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] }, { type: 'runs', runs: RUNS },
    { type: 'pools', pools: { listed: false, enforcement: 'unknown', accountPools: 'unavailable' } },
  ],
};

let dist: string;
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

async function openBoard(width: number, skin: string, theme: string): Promise<OpenedApp> {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.page.goto(`${server!.origin}/runs`);
  await opened.page.locator('.run-row').first().waitFor({ timeout: 20_000 });
  return opened;
}

const here = (page: Page): Promise<string> => page.evaluate(() => location.pathname + location.search);

for (const width of MATRIX.widths) {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      describe(`the runs board, ${skin} ${theme} at ${width}px`, () => {
        it('lays every row inside its box, with no sideways scroll, its wait line whole and its doors at the tap floor', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            const m = await page.evaluate(() => {
              const probe = document.createElement('div');
              probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--tap-min);width:1px';
              document.body.appendChild(probe);
              const tap = probe.getBoundingClientRect().height;
              probe.remove();
              const rows = [...document.querySelectorAll<HTMLElement>('.run-row')].map((li) => {
                const r = li.getBoundingClientRect();
                const wait = li.querySelector<HTMLElement>('.run-wait');
                const w = wait?.getBoundingClientRect() ?? null;
                const open = li.querySelector<HTMLElement>('.run-open')!.getBoundingClientRect();
                return {
                  title: li.title, overflow: li.scrollWidth - li.clientWidth, left: r.left, right: r.right,
                  wait: wait === null ? null : { text: wait.textContent, left: w!.left, right: w!.right, tag: wait.tagName, h: w!.height },
                  openH: open.height, inert: li.hasAttribute('data-inert'),
                };
              });
              return {
                tap, rows, page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                spend: document.querySelectorAll('.run-spend').length, vw: innerWidth,
              };
            });
            expect(m.rows.length).toBe(RUNS.length);
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(m.spend, 'the board draws no spend line (A10)').toBe(0);
            for (const row of m.rows) {
              expect(row.inert, `${row.title} is not inert`).toBe(false);
              expect(row.overflow, `${row.title} fits its box`).toBeLessThanOrEqual(1);
              expect(row.right, `${row.title} ends inside the window`).toBeLessThanOrEqual(m.vw + 1);
              expect(row.openH, `${row.title} door at the tap floor`).toBeGreaterThanOrEqual(m.tap - 1);
              if (row.wait !== null) {
                expect(row.wait.left, `${row.title} wait line starts inside its row`).toBeGreaterThanOrEqual(row.left - 1);
                expect(row.wait.right, `${row.title} wait line ends inside its row`).toBeLessThanOrEqual(row.right + 1);
                if (row.wait.tag === 'A') expect(row.wait.h, `${row.title} wait link at the tap floor`).toBeGreaterThanOrEqual(m.tap - 1);
              }
            }
            const lines = m.rows.map((r) => r.wait?.text).filter((t) => t !== undefined);
            // The board orders its rows by urgency, so the lines are compared as a set.
            expect([...lines].sort()).toEqual([
              'Waits for its coordinator to start it.', 'Waits behind a stuck run.',
              'Reviews done. Waits on its coordinator.', 'No move in 9 days.',
            ].sort());
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        it('a tap on a row opens /runs/<id>', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            await page.locator('.run-row[title^="run 1502"] .run-open').click();
            await page.waitForFunction(() => location.pathname === '/runs/1502', undefined, { timeout: 20_000 });
            expect(await here(page)).toBe('/runs/1502');
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      });
    }
  }
}

describe('a phone reaches a run by number', () => {
  it('a whole number and Enter in the search box opens /runs/<id>', async () => {
    const { ctx, page, errors } = await openBoard(390, REFINED, 'light');
    try {
      const box = page.getByLabel('Find a run');
      await box.fill('1527');
      await box.press('Enter');
      await page.waitForFunction(() => location.pathname === '/runs/1527', undefined, { timeout: 20_000 });
      // The run page's way back names the search the number came from, so the query rides along.
      expect(await here(page)).toBe('/runs/1527?q=1527');
      // Chrome rejects a view transition that a second navigation (the search box's replace, then the open) supersedes; that
      // is the router's own and says nothing about this screen.
      expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  it('a link to /runs?run=1527 from old chat text lands on the run\'s page and Back skips it', async () => {
    const { ctx, page } = await openBoard(390, REFINED, 'light');
    try {
      await page.evaluate(() => { history.pushState(null, '', '/runs?run=1527'); dispatchEvent(new PopStateEvent('popstate')); });
      await page.waitForFunction(() => location.pathname === '/runs/1527', undefined, { timeout: 20_000 });
      await page.goBack();
      await page.waitForFunction(() => location.pathname === '/runs', undefined, { timeout: 20_000 });
      expect(await here(page)).toBe('/runs');
    } finally {
      await ctx.close();
    }
  });
});
