// The runs board at every width (the runs rebuild, D-8072; spec 2026-11-04 section 8.2 and its per-width table; wave B2 Task 9),
// in a real Chrome over the production build: 360, 390, 1280, 1470 and 1920 wide, both skins, both themes. jsdom cannot lay a row
// out, so what a row FITS is measured here: no sideways page scroll, no row wider than its box, the wait line inside its row,
// every open door at the tap floor, a tap on a row landing on `/runs/<id>`, and a phone reaching a run by its number.
// MEASURED (Task 9a, spec §19): the column at 1470 is 1117px in Refined and 1130px in Instrument, so medium in both; at 1920 it
// is 1120px (medium) in Refined and 1500px (broad) in Instrument.
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
  run(1501, { branch: `ws/${'long-branch-name-'.repeat(8)}end` }),
  run(1502, { sessionId: null, state: 'planned', dispatchedAt: null, waitsOn: 'coordinator' }),
  run(1503, { sessionId: null, state: 'planned', dispatchedAt: null, blockedBy: 1012 }),
  run(1504, { state: 'awaiting-review', waitsOn: 'coordinator', lastMoveAt: NOW - 2 * DAY }),
  run(1505, { state: 'working', waitsOn: 'worker', lastMoveAt: NOW - 9 * DAY }),
  run(1527, { program: 'prog-b', programTitle: 'Programme B' }),
  run(1506, { program: 'prog-c', programTitle: 'Prog C', wave: 1, waveOf: 1, workspace: 'w6', branch: null }),
];

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a', repo: { state: 'named', slug: 'owner-a/repo-a' } }] },
    '/api/runs': { runs: RUNS, nextBefore: null }, '/api/claims': [],
    // The run page the number lands on reads these four; a real server answers each in this shape.
    '/api/runs/1501/record': { ok: true, run: RUNS[0], events: [], reviewedBy: [], olderEvents: 0 },
    '/api/runs/1501': { ok: true, run: RUNS[0], spend: { measured: false, reason: 'no-sweep' } },
    '/api/runs/1501/items': { ok: true, items: [] },
    '/api/runs/1501/signals': { ok: true, signals: { signals: { suite: { ok: false, why: 'absent' }, failure: { ok: false, why: 'absent' } } } },
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

/** The column the width and skin should give (Task 9a, spec §8.1): the skin's `--page-max-wide` caps Refined's column. */
const columnAt = (width: number, skin: string): string => {
  if (width < 640) return 'narrow';
  if (width === 1920 && skin === INSTRUMENT) return 'broad';
  return 'medium';
};

for (const width of MATRIX.widths) {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      describe(`the runs column, ${skin} ${theme} at ${width}px`, () => {
        const want = columnAt(width, skin);

        it(`the column is ${want}, the pane sits at about 40 and 60 percent when broad, and the search box is placed for it`, async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            const column = await page.locator('.runs-column').getAttribute('data-column');
            const colWidth = await page.locator('.runs-column').evaluate((el) => el.clientWidth);
            console.info(`runs column at ${width} ${skin} ${theme}: ${column} (${colWidth}px)`);
            expect(column).toBe(want);
            const box = await page.locator('.rf-box').evaluate((el) => {
              const cs = getComputedStyle(el);
              const pane = el.closest('.runs-list-pane')?.getBoundingClientRect() ?? null;
              return { position: cs.position, top: el.getBoundingClientRect().top, paneTop: pane?.top ?? null };
            });
            if (want === 'broad') {
              expect(box.position).toBe('static');
              expect(box.top - box.paneTop!, 'the search box tops the list pane, under its own header').toBeLessThanOrEqual(80);
              await page.locator('.run-row[title^="run 1501"] .run-open').click();
              await page.locator('.runs-detail-pane .rd-head').waitFor({ timeout: 20_000 });
              const w = await page.evaluate(() => ({
                list: document.querySelector('.runs-list-pane')!.getBoundingClientRect().width,
                pane: document.querySelector('.runs-detail-pane')!.getBoundingClientRect().width,
              }));
              const share = w.list / (w.list + w.pane);
              expect(share, 'the list is about 40 percent').toBeGreaterThan(0.35);
              expect(share).toBeLessThan(0.45);
            } else {
              expect(box.position, 'the search box is sticky under the header').toBe('sticky');
            }
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        it('a row runs on one line with its control at the right where the text fits; facts stack when narrow and sit in two columns from medium; a long branch wraps', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            if (want !== 'narrow') {
              const line = await page.locator('.run-row[title^="run 1506"]').evaluate((li) => {
                const open = li.querySelector('.run-open')!.getBoundingClientRect();
                const abandon = li.querySelector('.run-abandon')!.getBoundingClientRect();
                return { openTop: open.top, openBottom: open.bottom, mid: (abandon.top + abandon.bottom) / 2, abandonLeft: abandon.left, openRight: open.right };
              });
              expect(line.mid, 'a short row keeps its control on its one line').toBeGreaterThanOrEqual(line.openTop);
              expect(line.mid).toBeLessThanOrEqual(line.openBottom);
              expect(line.abandonLeft, 'the control sits at the right').toBeGreaterThanOrEqual(line.openRight - 1);
            }
            await page.locator('.run-row[title^="run 1501"] .run-open').click();
            await page.locator('.rd-facts').first().waitFor({ timeout: 20_000 });
            const m = await page.evaluate(() => {
              const fact = document.querySelector<HTMLElement>('.rd-fact')!;
              const dt = fact.querySelector('dt')!.getBoundingClientRect();
              const dd = fact.querySelector('dd')!.getBoundingClientRect();
              const wide = [...document.querySelectorAll<HTMLElement>('.rd-fact dd')].filter((d) => d.scrollWidth > d.clientWidth + 1).length;
              return { sameLine: Math.abs(dt.top - dd.top) < 6, wide, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
            });
            expect(m.sameLine, want === 'narrow' ? 'label over value' : 'label beside value').toBe(want !== 'narrow');
            expect(m.wide, 'no fact runs past its box').toBe(0);
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      });
    }
  }
}

describe('a broad column keeps the list\'s place when a run opens (D-8072)', () => {
  it('scrolling the list, then opening a row, leaves the scroller where it was and the row in view', async () => {
    const many = Array.from({ length: 120 }, (_, i) => run(2000 + i, { workspace: `ws-m${i}`, sessionId: null, state: 'planned', dispatchedAt: null }));
    const runs = [...many.slice(0, 60), RUNS[5], ...many.slice(60)];
    const fixture: AppFixture = {
      ...FIXTURE,
      api: {
        ...FIXTURE.api, '/api/runs': { runs, nextBefore: null },
        ...Object.fromEntries(many.flatMap((r, i) => {
          const id = 2000 + i;
          return [
            [`/api/runs/${id}/record`, { ok: true, run: r, events: [], reviewedBy: [], olderEvents: 0 }],
            [`/api/runs/${id}`, { ok: true, run: r, spend: { measured: false, reason: 'no-sweep' } }],
            [`/api/runs/${id}/items`, { ok: true, items: [] }],
            [`/api/runs/${id}/signals`, FIXTURE.api['/api/runs/1501/signals']],
          ];
        })),
      },
      fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'runs', runs }, FIXTURE.fleetFrames![2]!],
    };
    const opened = await openApp(browser!, { skin: INSTRUMENT, theme: 'dark', width: 1920 }, fixture);
    const { ctx, page, errors } = opened;
    try {
      await page.goto(`${server!.origin}/runs`);
      await page.locator('.run-row').first().waitFor({ timeout: 20_000 });
      expect(await page.locator('.runs-column').getAttribute('data-column')).toBe('broad');
      // Scroll the list well down, then take the row that is in the middle of the view.
      await page.evaluate(() => { document.querySelector<HTMLElement>('.shell-detail')!.scrollTop = 1200; });
      const id = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('.run-row')];
        const mid = rows.find((r) => r.getBoundingClientRect().top > window.innerHeight / 2)!;
        return /^run (\d+)/.exec(mid.title)![1]!;
      });
      const row = page.locator(`.run-row[title^="run ${id}"]`);
      const before = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('.shell-detail')!;
        return el.scrollTop;
      });
      expect(before, 'the list is scrolled before the click').toBeGreaterThan(300);
      await row.locator('.run-open').click();
      await page.waitForURL(new RegExp(`/runs/${id}$`), { timeout: 20_000 });
      await page.locator('.runs-detail-pane .rd-note').waitFor({ state: 'detached', timeout: 20_000 });
      const after = await page.evaluate((n) => {
        const el = document.querySelector<HTMLElement>('.shell-detail')!;
        const r = document.querySelector(`.run-row[title^="run ${n}"]`)!.getBoundingClientRect();
        return { top: el.scrollTop, rowTop: r.top, rowBottom: r.bottom, vh: window.innerHeight };
      }, id);
      expect(after.top, 'the list keeps its place').toBe(before);
      expect(after.rowTop).toBeGreaterThanOrEqual(0);
      expect(after.rowBottom).toBeLessThanOrEqual(after.vh);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
