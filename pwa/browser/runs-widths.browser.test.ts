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

/** One stuck run per reason (the Stuck band, Task 13), two of them holding a workspace or session so a head says why. */
const stuckOf = (reason: string, cause: string | null, ago: number, closes: { at: number; armed: boolean } | null = null) =>
  ({ reason, cause, since: NOW - ago, closes });
const STUCK_RUNS = [
  run(1601, { state: 'planned', kind: 'review', reviews: 1501, sessionId: null, workspace: null, dispatchedAt: null, stuck: stuckOf('review-of-closed', 'target-closed', 30 * DAY, { at: NOW + 20 * H, armed: false }) }),
  run(1602, { program: 'prog-d', programTitle: 'Programme D', state: 'planned', sessionId: null, workspace: null, dispatchedAt: null, stuck: stuckOf('overtaken', null, 28 * DAY) }),
  run(1603, { program: 'prog-d', programTitle: 'Programme D', wave: 3, state: 'planned', sessionId: null, workspace: null, dispatchedAt: null, stuck: stuckOf('overtaken', null, 12 * DAY) }),
  // D-8285: its worker heartbeat rides into the run page's header.
  run(1604, { program: 'prog-e', programTitle: 'Programme E', stuck: stuckOf('owner-gone', 'coordinator-archived', 49 * DAY),
    workerLastSeen: NOW - 3 * H, workerLastTurn: { state: 'done', startedAt: NOW - 4 * H, endedAt: NOW - 3 * H } }),
  run(1605, { program: 'prog-f', programTitle: 'Programme F', state: 'planned', sessionId: null, workspace: null, dispatchedAt: null, stuck: stuckOf('owner-gone', 'coordinator-gone', 5 * H) }),
  run(1606, { program: 'prog-g', programTitle: 'Programme G', state: 'planned', dispatchStartedAt: NOW - 8 * DAY, dispatchedAt: null, stuck: stuckOf('start-never-landed', null, 8 * DAY) }),
  run(1607, { program: 'prog-h', programTitle: 'Programme H', state: 'planned', sessionId: null, workspace: null, dispatchedAt: null, stuck: stuckOf('never-started', null, 23 * DAY) }),
];
const ALL_RUNS = [...RUNS, ...STUCK_RUNS];

/** `GET /api/programmes` (Task 18): a row per programme the frame holds a run of, one of them quiet (no move in 23 days), and one
 *  finished programme for the Finished fold. */
const programmeRow = (slug: string, title: string, over: Record<string, unknown> = {}): object => ({
  slug, title, currentWave: 2, waveOf: 5, claimedBy: 'project-a-coord', coordinatorGone: false,
  waves: { working: 1, waiting: 0, queued: 0, done: 1, failed: 0 }, lastMoveAt: NOW - 2 * H, ending: null, ...over,
});
const PROGRAMMES = {
  ok: true,
  programmes: [
    programmeRow('prog-a', 'Programme A with a title long enough to wrap on a phone', { waves: { working: 2, waiting: 1, queued: 1, done: 4, failed: 0 } }),
    programmeRow('prog-b', 'Programme B'), programmeRow('prog-c', 'Prog C', { lastMoveAt: NOW - 3 * DAY }),
    programmeRow('prog-d', 'Programme D', { stuck: 2 }), programmeRow('prog-e', 'Programme E', { stuck: 1 }),
    programmeRow('prog-f', 'Programme F', { stuck: 1 }), programmeRow('prog-g', 'Programme G', { stuck: 1 }),
    programmeRow('prog-h', 'Programme H', { stuck: 1, lastMoveAt: NOW - 23 * DAY }),
    programmeRow('prog-z', 'Programme Z, finished', { ending: { outcome: 'ended', waves: 3, neverStarted: 3, closedBy: 'sweep' }, lastMoveAt: NOW - 20 * H }),
  ],
  closedToday: { operator: 5, sweep: 2, coordinator: 60 },
};

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a', repo: { state: 'named', slug: 'owner-a/repo-a' } }] },
    '/api/runs': { runs: ALL_RUNS, nextBefore: null }, '/api/claims': [], '/api/programmes': PROGRAMMES,
    // Advanced reads `find` (Task 11): no closed run here.
    '/api/runs/find': { ok: true, exact: null, runs: [], reviewsOf: [], next: null },
    // The run page the number lands on reads these four; a real server answers each in this shape.
    '/api/runs/1501/record': { ok: true, run: RUNS[0], events: [], reviewedBy: [], olderEvents: 0 },
    '/api/runs/1501': { ok: true, run: RUNS[0], spend: { measured: false, reason: 'no-sweep' } },
    '/api/runs/1501/items': { ok: true, items: [] },
    '/api/runs/1501/signals': { ok: true, signals: { signals: { suite: { ok: false, why: 'absent' }, failure: { ok: false, why: 'absent' } } } },
    '/api/runs/1604/record': { ok: true, run: STUCK_RUNS[3], events: [], reviewedBy: [], olderEvents: 0 },
    '/api/runs/1604': { ok: true, run: STUCK_RUNS[3], spend: { measured: false, reason: 'no-sweep' } },
    '/api/runs/1604/items': { ok: true, items: [] },
    '/api/runs/1604/signals': { ok: true, signals: { signals: { suite: { ok: false, why: 'absent' }, failure: { ok: false, why: 'absent' } } } },
    '/api/runs/1527/record': { ok: true, run: RUNS[5], events: [], reviewedBy: [], olderEvents: 0 },
    '/api/runs/1527': { ok: true, run: RUNS[5], spend: { measured: false, reason: 'no-sweep' } },
    '/api/runs/1527/items': { ok: true, items: [] },
    '/api/runs/1527/signals': { ok: true, signals: { signals: { suite: { ok: false, why: 'absent' }, failure: { ok: false, why: 'absent' } } } },
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 1 }, updatedAt: null },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] }, { type: 'runs', runs: ALL_RUNS },
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
  // The cards take their last move from GET /api/programmes: a card the live frame gives no last move waits for it, and the quiet
  // fold is drawn only once it lands. Wait for the answer and the fold, so a count never races the read.
  const read = opened.page.waitForResponse((r) => r.url().includes('/api/programmes'), { timeout: 20_000 });
  await opened.page.goto(`${server!.origin}/runs`);
  await read;
  await opened.page.locator('[data-fold="quiet"]').waitFor({ timeout: 20_000 });
  await opened.page.locator('.programme-card').first().waitFor({ timeout: 20_000 });
  return opened;
}

/** Open every Stuck head (they fold by default), and wait for the rows. */
async function openHeads(page: Page): Promise<void> {
  const toggles = page.locator('[data-testid="stuck-band"] .stuck-head-toggle');
  for (let i = 0, n = await toggles.count(); i < n; i++) {
    if ((await toggles.nth(i).getAttribute('aria-expanded')) !== 'true') await toggles.nth(i).click();
  }
  await page.locator('li.run-stuck').first().waitFor({ timeout: 20_000 });
}

const here = (page: Page): Promise<string> => page.evaluate(() => location.pathname + location.search);

for (const width of MATRIX.widths) {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      describe(`the runs board, ${skin} ${theme} at ${width}px`, () => {
        it('lays every card inside its box, with no sideways scroll, its links at the tap floor, one across or two by the column', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            const m = await page.evaluate(() => {
              const probe = document.createElement('div');
              probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--tap-min);width:1px';
              document.body.appendChild(probe);
              const tap = probe.getBoundingClientRect().height;
              probe.remove();
              const cards = [...document.querySelectorAll<HTMLElement>('.programme-card')].map((li) => {
                const r = li.getBoundingClientRect();
                const links = [...li.querySelectorAll<HTMLElement>('a')].map((a) => a.getBoundingClientRect().height);
                return { slug: li.dataset['programme'] ?? '', overflow: li.scrollWidth - li.clientWidth, left: r.left, right: r.right, top: Math.round(r.top), links };
              });
              return {
                tap, cards, vw: innerWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                spend: document.querySelectorAll('.run-spend').length,
                runRows: document.querySelectorAll('.programme-card .run-row, .programme-card [title^="run "]').length,
                quiet: document.querySelectorAll('[data-fold="quiet"]').length, finished: document.querySelectorAll('[data-fold="finished"]').length,
              };
            });
            // The quiet programme (H) folds, so seven cards show.
            expect(m.cards.map((c) => c.slug).sort()).toEqual(['prog-a', 'prog-b', 'prog-c', 'prog-d', 'prog-e', 'prog-f', 'prog-g']);
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(m.spend, 'the board draws no spend line (A10)').toBe(0);
            expect(m.runRows, 'a card draws no run row').toBe(0);
            expect(m.quiet, 'the quiet fold is drawn').toBe(1);
            expect(m.finished, 'the Finished fold is drawn').toBe(1);
            for (const c of m.cards) {
              expect(c.overflow, `${c.slug} fits its box`).toBeLessThanOrEqual(1);
              expect(c.right, `${c.slug} ends inside the window`).toBeLessThanOrEqual(m.vw + 1);
              expect(c.left, `${c.slug} starts inside the window`).toBeGreaterThanOrEqual(-1);
              for (const h of c.links) expect(h, `${c.slug} link at the tap floor`).toBeGreaterThanOrEqual(m.tap - 1);
            }
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        it('a tap on a stuck row opens /runs/<id>, and a tap on a card’s name opens the programme', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            await openHeads(page);
            await page.locator('li.run-stuck[title^="run 1604"] .run-open').click();
            await page.waitForFunction(() => location.pathname === '/runs/1604', undefined, { timeout: 20_000 });
            expect(await here(page)).toBe('/runs/1604');
            await page.goBack();
            await page.locator('.programme-card').first().waitFor({ timeout: 20_000 });
            await page.locator('.programme-card[data-programme="prog-b"] a.programme-card-name').click();
            await page.waitForFunction(() => location.pathname === '/programmes/prog-b', undefined, { timeout: 20_000 });
            expect(await here(page)).toBe('/programmes/prog-b');
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      });
    }
  }
}

// Programme cards lay out by the board's own column (Task 18, spec §8.1): one across under 840, two across from 840 (860, 912 and
// 1056 are the measured columns), and one across again in the broad list, whose pane is only part of the column. The extra
// widths put the column on both sides of the 840 line.
for (const width of [...MATRIX.widths, 760, 880, 960]) {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      if (!(MATRIX.widths as readonly number[]).includes(width) && (skin !== REFINED || theme !== 'light')) continue;
      describe(`the programme cards, ${skin} ${theme} at ${width}px`, () => {
        it('are one across under 840, two across from 840, and one across in the broad list', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            const m = await page.evaluate(() => {
              const col = document.querySelector<HTMLElement>('.runs-column')!;
              const cards = [...document.querySelectorAll<HTMLElement>('.programme-cards .programme-card')].map((c) => c.getBoundingClientRect());
              const first = cards[0]!;
              const across = cards.filter((r) => Math.abs(r.top - first.top) < 4).length;
              return { column: col.dataset['column'], colWidth: col.clientWidth, across, count: cards.length,
                lefts: [...new Set(cards.map((r) => Math.round(r.left)))].length };
            });
            console.info(`cards at ${width} ${skin} ${theme}: column ${m.column} (${m.colWidth}px), ${m.across} across`);
            expect(m.count).toBeGreaterThanOrEqual(4);
            const want = m.column === 'broad' || m.colWidth < 840 ? 1 : 2;
            expect(m.across, `${m.column} column of ${m.colWidth}px`).toBe(want);
            expect(m.lefts, 'the cards stand in that many columns').toBe(want);
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
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
              await openHeads(page);
              await page.locator('li.run-stuck[title^="run 1604"] .run-open').click();
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
            // Abandon sits on stuck rows alone (Task 13): at the right end of the row's first line, at every width.
            await openHeads(page);
            const line = await page.locator('li.run-stuck[title^="run 1607"]').evaluate((li) => {
              const open = li.querySelector('.run-open')!.getBoundingClientRect();
              const abandon = li.querySelector('.run-abandon')!.getBoundingClientRect();
              const word = li.querySelector('.run-name')!.getBoundingClientRect();
              return { openTop: open.top, abandonTop: abandon.top, wordTop: word.top, abandonLeft: abandon.left, openRight: open.right, abandonRight: abandon.right, rowRight: li.getBoundingClientRect().right };
            });
            expect(line.abandonTop, 'the control sits on the first line').toBeLessThanOrEqual(line.wordTop + 4);
            expect(line.abandonLeft, 'the control sits at the right').toBeGreaterThanOrEqual(line.openRight - 1);
            expect(line.abandonRight).toBeLessThanOrEqual(line.rowRight + 1);
            await page.locator('li.run-stuck[title^="run 1604"] .run-open').click();
            await page.locator('.rd-facts').first().waitFor({ timeout: 20_000 });
            const m = await page.evaluate(() => {
              const fact = document.querySelector<HTMLElement>('.rd-fact')!;
              const dt = fact.querySelector('dt')!.getBoundingClientRect();
              const dd = fact.querySelector('dd')!.getBoundingClientRect();
              const wide = [...document.querySelectorAll<HTMLElement>('.rd-fact dd')].filter((d) => d.scrollWidth > d.clientWidth + 1).length;
              const seen = document.querySelector<HTMLElement>('.rd-head .rd-seen');
              const sr = seen?.getBoundingClientRect() ?? null;
              return { sameLine: Math.abs(dt.top - dd.top) < 6, wide, page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                seen: seen?.textContent ?? null, seenInside: sr !== null && sr.left >= -1 && sr.right <= innerWidth + 1 };
            });
            expect(m.seen, 'the header draws the heartbeat (D-8285)').toBe('last seen 3h ago');
            expect(m.seenInside, 'inside the window').toBe(true);
            expect(m.sameLine, want === 'narrow' ? 'label over value' : 'label beside value').toBe(want !== 'narrow');
            expect(m.wide, 'no fact runs past its box').toBe(0);
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        it('lays the lane rows and the Turn on sheet inside the window with every control at the tap floor (Task 26)', async () => {
          const opened = await openApp(browser!, { skin, theme, width }, ADVANCED_FIXTURE);
          const { ctx, page, errors } = opened;
          try {
            await page.goto(`${server!.origin}/runs/advanced`);
            await page.locator('.rc-row').first().waitFor({ timeout: 20_000 });
            const measure = (): Promise<{ tap: number; vw: number; page: number; boxes: { right: number; left: number; h: number; tag: string }[] }> =>
              page.evaluate(() => {
                const probe = document.createElement('div');
                probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--tap-min);width:1px';
                document.body.appendChild(probe);
                const tap = probe.getBoundingClientRect().height;
                probe.remove();
                const boxes = [...document.querySelectorAll<HTMLElement>('.rc-row, .rc-control, .rc-sheet, .rc-sheet .rc-run')]
                  .map((n) => { const r = n.getBoundingClientRect(); return { right: r.right, left: r.left, h: r.height, tag: n.className }; });
                return { tap, vw: innerWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth, boxes };
              });
            const rows = await measure();
            expect(rows.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(rows.boxes.length).toBeGreaterThan(4);
            for (const b of rows.boxes) {
              expect(b.right, `${b.tag} ends inside the window`).toBeLessThanOrEqual(rows.vw);
              expect(b.left, `${b.tag} starts inside the window`).toBeGreaterThanOrEqual(0);
              if (b.tag.includes('rc-control')) expect(b.h, 'a control at the tap floor').toBeGreaterThanOrEqual(rows.tap - 1);
            }
            // The claimant-gone group's sheet (D-8078): its longest reasons and its held runs fit the window too.
            await page.getByTestId('run-close-claimant-gone').getByRole('button', { name: 'Turn on' }).click();
            await page.getByTestId('run-close-sheet').waitFor({ timeout: 20_000 });
            const goneSheet = await measure();
            expect(goneSheet.page, 'no sideways page scroll with the claimant-gone sheet open').toBeLessThanOrEqual(0);
            for (const b of goneSheet.boxes.filter((x) => x.tag.includes('rc-sheet') || x.tag.includes('rc-run'))) {
              expect(b.right, `${b.tag} ends inside the window`).toBeLessThanOrEqual(goneSheet.vw);
              if (b.tag.includes('rc-run')) expect(b.h, 'a run link at the tap floor').toBeGreaterThanOrEqual(goneSheet.tap - 1);
            }
            await page.getByRole('button', { name: 'Keep it in shadow' }).click();
            await page.getByTestId('run-close-sheet').waitFor({ state: 'detached', timeout: 20_000 });
            await page.getByTestId('run-close-never-started').getByRole('button', { name: 'Turn on' }).click();
            await page.getByTestId('run-close-sheet').waitFor({ timeout: 20_000 });
            const sheet = await measure();
            expect(sheet.page, 'no sideways page scroll with the sheet open').toBeLessThanOrEqual(0);
            for (const b of sheet.boxes.filter((x) => x.tag.includes('rc-sheet') || x.tag.includes('rc-run'))) {
              expect(b.right, `${b.tag} ends inside the window`).toBeLessThanOrEqual(sheet.vw);
              if (b.tag.includes('rc-run')) expect(b.h, 'a run link at the tap floor').toBeGreaterThanOrEqual(sheet.tap - 1);
            }
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
    const many = Array.from({ length: 120 }, (_, i) => run(2000 + i, { workspace: `ws-m${i}`, sessionId: null, state: 'planned', dispatchedAt: null, stuck: stuckOf('never-started', null, 23 * DAY) }));
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
      await page.locator('.programme-card').first().waitFor({ timeout: 20_000 });
      // The board lists no run row of its own but the Stuck band's: the rows this case scrolls are the long head's.
      await openHeads(page);
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

/** Closed runs for Advanced's All runs list: a few, so the chips and the rows lay out beside real text. */
const CLOSED = Array.from({ length: 12 }, (_, i) => ({
  id: 1400 + i, program: 'prog-a', programTitle: 'Programme A with a title long enough to wrap on a phone', runTitle: null, wave: 2, waveOf: 5,
  kind: 'work', reviews: null, state: 'done', project: 'project-a', workspace: `ws-${1400 + i}`, branch: null,
  claimedBy: 'project-a-coord', openedAt: NOW - 20 * H, closedAt: NOW - (i + 1) * H, closedBy: i % 2 === 0 ? 'operator' : 'sweep', closeDetail: null,
}));
/** The lane rows of "What ccrc closes on its own" (Task 26): the never-started group with a list of three, one held back and one
 *  whose warning cannot be delivered, and the crash row without a list. */
const RUN_CLOSE_VIEW = {
  ok: true,
  groups: [
    {
      group: 'never-started', choice: 'shadow', marker: 'clear', state: 'shadow', held: null, closed7d: 3, refused7d: 1, updatedAt: 0,
      list: {
        would: [
          { runId: 1701, program: 'prog-long-programme-name-that-wraps-on-a-phone', why: 'never-started', at: NOW - H },
          { runId: 1702, program: 'prog-b', why: 'review-of-closed', at: NOW - 2 * H },
          { runId: 1703, program: 'prog-c', why: 'later-review', at: NOW + 5 * H },
        ],
        named: [
          { runId: 1085, program: 'prog-d', why: 'live-session' },
          { runId: 65, program: 'prog-e', why: 'coordinator-not-reached' },
        ],
        now: 2, later: 1,
      },
    },
    { group: 'claimant-crashed', choice: 'shadow', marker: 'clear', state: 'shadow', held: null, closed7d: 0, refused7d: 0, updatedAt: 0, list: null },
    {
      group: 'claimant-gone', choice: 'shadow', marker: 'clear', state: 'shadow', held: null, closed7d: 1, refused7d: 2, updatedAt: 0,
      list: {
        would: [
          { runId: 1801, program: 'prog-long-programme-name-that-wraps-on-a-phone', why: 'claimant-gone', at: NOW - H },
          { runId: 1802, program: 'prog-f', why: 'claimant-stopped', at: NOW + 20 * H },
          { runId: 1803, program: 'prog-g', why: 'name-reused', at: NOW },
        ],
        named: [{ runId: 1804, program: 'prog-h', why: 'busy-worker' }, { runId: 1805, program: 'prog-i', why: 'breaker-held' }],
        now: 2, later: 1,
      },
    },
  ],
};
const ADVANCED_FIXTURE: AppFixture = {
  ...FIXTURE,
  api: {
    ...FIXTURE.api,
    '/api/coord/run-close': RUN_CLOSE_VIEW,
    '/api/runs/find': { ok: true, exact: null, runs: [RUNS[0], ...CLOSED], reviewsOf: [], next: { beforeAt: NOW - 13 * H, beforeId: 1411 } },
    '/api/runs/1400/record': { ok: true, run: CLOSED[0], events: [], reviewedBy: [], olderEvents: 0 },
    '/api/runs/1400': { ok: true, run: CLOSED[0], spend: { measured: false, reason: 'no-sweep' } },
    '/api/runs/1400/items': { ok: true, items: [] },
    '/api/runs/1400/signals': FIXTURE.api['/api/runs/1501/signals'],
  },
};

describe('the foot link to Advanced reaches a thumb (§8.2 item 10)', () => {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      it(`the foot link is reachable and 44px tall on a phone, ${skin} ${theme}`, async () => {
        const { ctx, page, errors } = await openBoard(360, skin, theme);
        try {
          const link = page.getByRole('link', { name: 'Advanced' });
          await link.scrollIntoViewIfNeeded();
          const m = await link.evaluate((a) => {
            const probe = document.createElement('div');
            probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--tap-min);width:1px';
            document.body.appendChild(probe);
            const tap = probe.getBoundingClientRect().height;
            probe.remove();
            const r = a.getBoundingClientRect();
            return { tap, h: r.height, w: r.width, top: r.top, bottom: r.bottom, vh: innerHeight, left: r.left, right: r.right, vw: innerWidth };
          });
          expect(m.h, 'at the tap floor').toBeGreaterThanOrEqual(m.tap - 1);
          expect(m.tap).toBeGreaterThanOrEqual(44);
          expect(m.right).toBeLessThanOrEqual(m.vw);
          await link.click();
          await page.waitForFunction(() => location.pathname === '/runs/advanced', undefined, { timeout: 20_000 });
          expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});

for (const width of MATRIX.widths) {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      describe(`Advanced, ${skin} ${theme} at ${width}px`, () => {
        it('lays All runs inside the window with the chips wrapping and every control at the tap floor', async () => {
          const opened = await openApp(browser!, { skin, theme, width }, ADVANCED_FIXTURE);
          const { ctx, page, errors } = opened;
          try {
            await page.goto(`${server!.origin}/runs/advanced`);
            await page.locator('.ra-list .rf-link').first().waitFor({ timeout: 20_000 });
            const m = await page.evaluate(() => {
              const probe = document.createElement('div');
              probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--tap-min);width:1px';
              document.body.appendChild(probe);
              const tap = probe.getBoundingClientRect().height;
              probe.remove();
              const chips = [...document.querySelectorAll<HTMLElement>('.ra-chip')].map((c) => c.getBoundingClientRect());
              const rows = [...document.querySelectorAll<HTMLElement>('.ra-list .rf-link')].map((a) => a.getBoundingClientRect());
              const older = document.querySelector<HTMLElement>('.ra-older')?.getBoundingClientRect() ?? null;
              return {
                tap, vw: innerWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                chips: chips.map((r) => ({ top: Math.round(r.top), right: r.right, h: r.height })),
                rowH: Math.min(...rows.map((r) => r.height)), rowRight: Math.max(...rows.map((r) => r.right)),
                older: older === null ? null : { h: older.height },
              };
            });
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(m.chips).toHaveLength(4);
            for (const c of m.chips) {
              expect(c.right, 'a chip ends inside the window').toBeLessThanOrEqual(m.vw);
              expect(c.h, 'a chip at the tap floor').toBeGreaterThanOrEqual(m.tap - 1);
            }
            const lines = new Set(m.chips.map((c) => c.top)).size;
            if (width <= 390) expect(lines, 'chips wrap on a phone').toBeGreaterThan(1);
            expect(m.rowH, 'a row at the tap floor').toBeGreaterThanOrEqual(m.tap - 1);
            expect(m.rowRight).toBeLessThanOrEqual(m.vw);
            expect(m.older, 'Show older is offered while older runs remain').not.toBeNull();
            expect(m.older!.h).toBeGreaterThanOrEqual(m.tap - 1);
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      });
    }
  }
}

// The top of the board and the switches under Advanced (Task 12a, D-8074): the start door sits in the header's actions slot, the
// board draws none of the three switches, and Advanced draws them whole, inside the window, at every width.
for (const width of MATRIX.widths) {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      describe(`the top of the board and the switches, ${skin} ${theme} at ${width}px`, () => {
        it('puts Start a program in the header at the tap floor, holds no switch, and Advanced draws the switches inside the window', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            const board = await page.evaluate(() => {
              const probe = document.createElement('div');
              probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--tap-min);width:1px';
              document.body.appendChild(probe);
              const tap = probe.getBoundingClientRect().height;
              probe.remove();
              const door = document.querySelector<HTMLElement>('.program-start-door');
              const r = door?.getBoundingClientRect() ?? null;
              const h1 = document.querySelector('h1');
              const head = h1?.parentElement ?? null;
              return {
                tap, vw: innerWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                door: r === null ? null : { h: r.height, right: r.right, left: r.left },
                inHead: head !== null && door !== null && head.contains(door),
                caps: document.querySelector('.caps-control') !== null,
                reclaim: document.querySelector('.child-reclaim-banner') !== null,
              };
            });
            expect(board.door, 'the start door is drawn').not.toBeNull();
            expect(board.inHead, 'in the header, beside the title').toBe(true);
            expect(board.door!.h, 'at the tap floor').toBeGreaterThanOrEqual(board.tap - 1);
            expect(board.door!.right).toBeLessThanOrEqual(board.vw);
            expect(board.door!.left).toBeGreaterThanOrEqual(0);
            expect(board.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(board.caps || board.reclaim, 'no switch on the board').toBe(false);
            await page.getByRole('link', { name: 'Advanced' }).click();
            await page.locator('.caps-control').waitFor({ timeout: 20_000 });
            const adv = await page.evaluate(() => {
              const box = document.querySelector('.caps-control')!.getBoundingClientRect();
              return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, right: box.right, left: box.left, vw: innerWidth };
            });
            expect(adv.page, 'no sideways page scroll on Advanced').toBeLessThanOrEqual(0);
            expect(adv.right).toBeLessThanOrEqual(adv.vw);
            expect(adv.left).toBeGreaterThanOrEqual(0);
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      });
    }
  }
}

describe('Advanced in a broad column opens a run beside its list', () => {
  it('a row sets ?open=<id> and the run draws in the pane (Instrument, 1920)', async () => {
    const { ctx, page, errors } = await openApp(browser!, { skin: INSTRUMENT, theme: 'dark', width: 1920 }, ADVANCED_FIXTURE);
    try {
      await page.goto(`${server!.origin}/runs/advanced`);
      await page.locator('.ra-list .rf-link').first().waitFor({ timeout: 20_000 });
      expect(await page.locator('.runs-column').getAttribute('data-column')).toBe('broad');
      await page.locator('.ra-list .rf-link', { hasText: 'Run 1400' }).click();
      await page.waitForFunction(() => location.search === '?open=1400', undefined, { timeout: 20_000 });
      await page.locator('.runs-detail-pane .rd-head').waitFor({ timeout: 20_000 });
      expect(await page.evaluate(() => location.pathname)).toBe('/runs/advanced');
      expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

// The Stuck band (Task 13, D-8074; spec §8.2, §8.2.1): at each width, skin and theme the heads fold by default, the last head
// ends within half a visible height of the fold on a 667-tall phone (the visible height stops at the bottom bar), the last fold
// scrolls clear of the bar, every link and band control is at the tap floor, and a head's group control sits on its own line
// when narrow and at the right from medium. The measured heads' end is recorded in the log line for the PR body.
for (const width of MATRIX.widths) {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      describe(`the Stuck band, ${skin} ${theme} at ${width}px`, () => {
        it('folds by default, ends within half a visible height of the fold at 667 tall, scrolls clear of the bar, and keeps every control at the tap floor', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            await page.setViewportSize({ width, height: 667 });
            await page.locator('.stuck-band').waitFor({ timeout: 20_000 });
            const m = await page.evaluate(() => {
              const probe = document.createElement('div');
              probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--tap-min);width:1px';
              document.body.appendChild(probe);
              const tap = probe.getBoundingClientRect().height;
              probe.remove();
              const bar = document.querySelector<HTMLElement>('.shell-phone-nav');
              const barTop = bar !== null && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : null;
              const visible = barTop ?? innerHeight;
              const heads = [...document.querySelectorAll<HTMLElement>('[data-testid="stuck-band"] .stuck-head')];
              const last = heads[heads.length - 1]!.getBoundingClientRect();
              const first = document.querySelector<HTMLElement>('.stuck-band')!.getBoundingClientRect();
              const under = (el: Element): number => el.getBoundingClientRect().height;
              return {
                tap, visible, barTop, headCount: heads.length, lastBottom: last.bottom, bandTop: first.top,
                folded: [...document.querySelectorAll('[data-testid="stuck-band"] .stuck-head-toggle')].every((b) => b.getAttribute('aria-expanded') === 'false'),
                rows: document.querySelectorAll('li.run-stuck').length,
                short: [...document.querySelectorAll('.stuck-band button, .runs-column a')].filter((el) => under(el) < tap - 1).map((el) => el.className || el.tagName),
                page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              };
            });
            console.info(`stuck heads' end at ${width} ${skin} ${theme} (667 tall): ${Math.round(m.lastBottom)}px of ${Math.round(m.visible)}px visible`);
            expect(m.headCount, 'all five heads').toBe(5);
            expect(m.folded, 'every head folded by default').toBe(true);
            expect(m.rows, 'no stuck row while folded').toBe(0);
            expect(m.lastBottom - m.visible, 'the last head ends within half a visible height of the fold').toBeLessThanOrEqual(m.visible / 2);
            expect(m.short, 'every link and band control at the tap floor').toEqual([]);
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            if (width < 900) {
              expect(m.barTop, 'the phone bar bounds the visible height').not.toBeNull();
              await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
              const clear = await page.evaluate(() => {
                const foot = document.querySelector<HTMLElement>('.runs-foot-link')!.getBoundingClientRect();
                return { footBottom: foot.bottom, barTop: document.querySelector<HTMLElement>('.shell-phone-nav')!.getBoundingClientRect().top };
              });
              expect(clear.footBottom, 'the last fold scrolls clear of the bar').toBeLessThanOrEqual(clear.barTop + 1);
            }
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        it('opens a head to its rows, each inside its box, and puts a head\'s group control on its own line when narrow and at the right from medium', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            await page.locator('.stuck-band').waitFor({ timeout: 20_000 });
            const heads = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.stuck-group')].map((g) => {
              const head = g.querySelector('.stuck-head')!.getBoundingClientRect();
              const toggle = g.querySelector('.stuck-head-toggle')!.getBoundingClientRect();
              const group = g.querySelector('.stuck-head-group')?.getBoundingClientRect() ?? null;
              return {
                reason: g.getAttribute('data-reason'), headRight: head.right, headLeft: head.left, toggleBottom: toggle.bottom, toggleRight: toggle.right,
                toggleMid: (toggle.top + toggle.bottom) / 2,
                group: group === null ? null : { top: group.top, left: group.left, right: group.right, mid: (group.top + group.bottom) / 2 },
              };
            }));
            const withControl = heads.filter((h) => h.group !== null);
            expect(withControl.length, 'heads with a group control').toBeGreaterThanOrEqual(3);
            for (const h of withControl) {
              if (width < 640) {
                expect(h.group!.top, `${h.reason}: the control sits on its own line`).toBeGreaterThanOrEqual(h.toggleBottom - 1);
              } else {
                expect(h.group!.right, `${h.reason}: the control sits at the right`).toBeGreaterThanOrEqual(h.headRight - 24);
                expect(Math.abs(h.group!.mid - h.toggleMid), `${h.reason}: on the toggle's line`).toBeLessThanOrEqual(20);
              }
            }
            await openHeads(page);
            const rows = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('li.run-stuck')].map((li) => {
              const r = li.getBoundingClientRect();
              return { title: li.title, overflow: li.scrollWidth - li.clientWidth, right: r.right, vw: innerWidth };
            }));
            expect(rows).toHaveLength(STUCK_RUNS.length);
            for (const r of rows) {
              expect(r.overflow, `${r.title} fits its box`).toBeLessThanOrEqual(1);
              expect(r.right, `${r.title} ends inside the window`).toBeLessThanOrEqual(r.vw + 1);
            }
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      });
    }
  }
}

// Closed today and the first card's place (Task 20, spec §8.2 items 4 to 7, check 11). Closed today sits below the Stuck band and
// above everything healthy, its three counts are links at the tap floor, and at Instrument 1920 the first programme card starts
// under 800px (the spec's inferred figure is 742px, measured and reported below).
for (const width of MATRIX.widths) {
  for (const skin of MATRIX.skins) {
    for (const theme of MATRIX.themes) {
      describe(`Closed today and the first card, ${skin} ${theme} at ${width}px`, () => {
        it('sits below the Stuck band and above the first card, its counts at the tap floor, and the first card starts under 800px at Instrument 1920', async () => {
          const { ctx, page, errors } = await openBoard(width, skin, theme);
          try {
            await page.locator('[data-testid="closed-today"]').waitFor({ timeout: 20_000 });
            const m = await page.evaluate(() => {
              const probe = document.createElement('div');
              probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--tap-min);width:1px';
              document.body.appendChild(probe);
              const tap = probe.getBoundingClientRect().height;
              probe.remove();
              const box = (sel: string): DOMRect => document.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
              const line = document.querySelector<HTMLElement>('[data-testid="closed-today"]')!;
              const band = box('[data-testid="stuck-band"]');
              const closed = line.getBoundingClientRect();
              const card = box('.programme-card');
              const linkBoxes = [...line.querySelectorAll('a')].map((a) => a.getBoundingClientRect());
              const column = box('.runs-column');
              const fin = document.querySelector<HTMLElement>('[data-fold="finished"]');
              return {
                finishedTop: fin === null ? -1 : fin.getBoundingClientRect().top + window.scrollY,
                tap, text: line.textContent, bandBottom: band.bottom, closedTop: closed.top, closedBottom: closed.bottom, cardTop: card.top,
                short: linkBoxes.filter((b) => b.height < tap - 1).length, links: linkBoxes.length,
                outside: linkBoxes.filter((b) => b.left < column.left - 1 || b.right > column.right + 1).length,
                page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              };
            });
            console.info(`first programme card top at ${width} ${skin} ${theme}: ${Math.round(m.cardTop)}px (spec inferred 742px)`);
            console.info(`Finished fold top at ${width} ${skin} ${theme}: ${Math.round(m.finishedTop)}px (spec 17: phone 390 under 2000, Refined 1280 under 1400)`);
            expect(m.finishedTop, 'the Finished fold is drawn').toBeGreaterThan(0);
            if (width === 390) expect(m.finishedTop, 'Finished starts under y=2000 on a phone').toBeLessThan(2000);
            if (width === 1280 && skin === REFINED) expect(m.finishedTop, 'Finished starts under y=1400 at Refined 1280').toBeLessThan(1400);
            expect(m.text).toBe('Closed today: 5 by you · 2 by ccrc · 60 by coordinators');
            expect(m.links).toBe(3);
            expect(m.short, 'every count at the tap floor').toBe(0);
            expect(m.outside, 'every count inside the column').toBe(0);
            expect(m.closedTop, 'below the Stuck band').toBeGreaterThanOrEqual(m.bandBottom - 1);
            expect(m.cardTop, 'above the first card').toBeGreaterThanOrEqual(m.closedBottom - 1);
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            if (width === 1920 && skin === INSTRUMENT) expect(m.cardTop, 'the first card starts under 800px').toBeLessThan(800);
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });
      });
    }
  }
}
