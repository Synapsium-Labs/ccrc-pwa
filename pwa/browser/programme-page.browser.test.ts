// The programme page's Runs section and its head's Resume at every width (the runs rebuild, Task 19, D-8075; spec 2026-11-04
// §8.5, §9.5, o8), in a real Chrome over the production build: 360, 390, 1280, 1470 and 1920 wide, both skins, both themes.
// jsdom cannot lay a column out, so what the page FITS is measured here: no sideways page scroll, no row wider than its box,
// Resume and the closed-waves fold at the tap floor, and the columns of o8: under 900 everything stacks (Goals, Waiting on you,
// then Runs); from 900 Goals and Waiting on you share the first column and Runs is the other. Names are neutral.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/programme-page.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';

const NOW = Date.now();
const H = 3_600_000;
const DAY = 24 * H;
const WIDTHS = [360, 390, 1280, 1470, 1920] as const;
const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = ['light', 'dark'] as const;

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
  // D-8285: each open row carries its worker heartbeat, one quiet past the frame's quiet time and one inside a turn.
  run(1702, { wave: 2, branch: `ws/${'long-branch-name-'.repeat(8)}end`, workerLastSeen: NOW - 3 * H,
    workerLastTurn: { state: 'done', startedAt: NOW - 4 * H, endedAt: NOW - 3 * H } }),
  run(1703, { wave: 2, kind: 'review', reviews: 1702, state: 'working', workerLastSeen: NOW - 40 * 60_000,
    workerLastTurn: { state: 'working', startedAt: NOW - 40 * 60_000, endedAt: null } }),
  run(1701, { wave: 1, state: 'planned', sessionId: null, workspace: null, dispatchedAt: null,
    stuck: { reason: 'overtaken', cause: null, since: NOW - 12 * DAY, closes: { at: NOW + 20 * H, armed: true } } }),
];

const CLOSED = [1690, 1689].map((id, i) => ({
  ...run(id, { wave: 1, state: i === 0 ? 'done' : 'failed', closedAt: NOW - (i + 1) * DAY, closedBy: i === 0 ? 'coordinator' : 'operator',
    closeDetail: i === 0 ? null : 'abandon:overtaken', sessionId: null, workspace: null, branch: null }),
}));

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': { runs: RUNS, nextBefore: null }, '/api/claims': [],
    '/api/programmes': {
      ok: true, closedToday: { operator: 0, sweep: 0, coordinator: 0 },
      programmes: [{
        slug: 'prog-a', title: 'Programme A with a title long enough to wrap on a phone', currentWave: 2, waveOf: 5, claimedBy: 'project-a-coord',
        coordinatorGone: true, waves: { working: 1, waiting: 0, queued: 1, done: 1, failed: 1 }, lastMoveAt: NOW - 2 * H, ending: null, stuck: 1,
        pendingClose: [{ reason: 'overtaken', count: 1, soonestAt: NOW + 20 * H, armed: true }],
      }],
    },
    '/api/runs/find': { ok: true, exact: null, runs: CLOSED, reviewsOf: [], next: null },
    '/api/programmes/prog-a/goals': { ok: true, goals: { program: 'prog-a', specPath: null, inShort: null, inShortAt: null, modifications: [] } },
    '/api/programmes/prog-a/secrets': { ok: true, program: 'prog-a', slots: [] },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] }, { type: 'runs', runs: RUNS, stallQuietMs: 2 * H },
    { type: 'pools', pools: { listed: false, enforcement: 'unknown', accountPools: 'unavailable' } },
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

for (const width of WIDTHS) {
  for (const skin of SKINS) {
    for (const theme of THEMES) {
      describe(`the programme page, ${skin} ${theme} at ${width}px`, () => {
        it('fits its rows, keeps Resume and the fold at the tap floor, and lays the columns by o8', async () => {
          const { ctx, page, errors } = await openApp(browser!, { skin, theme, width }, FIXTURE);
          try {
            await page.goto(`${server!.origin}/programmes/prog-a`);
            await page.locator('[data-testid="programme-runs"] li.run-row').first().waitFor({ timeout: 30_000 });
            await page.locator('[data-testid="programme-facts"] .pv-resume').waitFor({ timeout: 30_000 });
            await page.locator('[data-fold="closed"] .programme-fold-toggle').waitFor({ timeout: 30_000 });
            await page.locator('[data-fold="closed"] .programme-fold-toggle').click();
            await page.locator('[data-fold="closed"] .rf-row').first().waitFor({ timeout: 30_000 });
            const m = await page.evaluate(() => {
              const probe = document.createElement('div');
              probe.style.cssText = 'position:absolute;visibility:hidden;min-height:var(--tap-min);width:1px';
              document.body.appendChild(probe);
              const tap = probe.getBoundingClientRect().height;
              probe.remove();
              const box = (sel: string): DOMRect => document.querySelector(sel)!.getBoundingClientRect();
              const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="programme-runs"] li.run-row, [data-testid="programme-runs"] .rf-row')]
                .map((li) => ({ overflow: li.scrollWidth - li.clientWidth, right: li.getBoundingClientRect().right, left: li.getBoundingClientRect().left }));
              // D-8285: each heartbeat inside its own row's box, its word whole.
              const seen = [...document.querySelectorAll<HTMLElement>('[data-testid="programme-runs"] li.run-row .run-seen')].map((el) => {
                const row = el.closest('li.run-row')!.getBoundingClientRect();
                const r = el.getBoundingClientRect();
                return { text: el.textContent ?? '', quiet: el.dataset['quiet'], inside: r.left >= row.left - 1 && r.right <= row.right + 1 };
              });
              const goals = box('.pv-main > .pv-card'), waiting = box('.pv-main section[aria-label="Waiting on you"]'), runs = box('[data-testid="programme-runs"]');
              return {
                tap, vw: innerWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth, rows,
                resume: box('[data-testid="programme-facts"] .pv-resume').height, fold: box('[data-fold="closed"] .programme-fold-toggle').height,
                goals: { l: goals.left, r: goals.right, b: goals.bottom }, waiting: { l: waiting.left, t: waiting.top, b: waiting.bottom },
                runs: { l: runs.left, r: runs.right, t: runs.top },
                rowCount: rows.length, seen,
              };
            });
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(m.rowCount, 'three open rows, two closed waves').toBeGreaterThanOrEqual(5);
            for (const r of m.rows) {
              expect(r.overflow, 'a row fits its box').toBeLessThanOrEqual(1);
              expect(r.right, 'a row ends inside the window').toBeLessThanOrEqual(m.vw + 1);
              expect(r.left).toBeGreaterThanOrEqual(-1);
            }
            expect(m.seen.map((x) => x.text).sort(), 'the two heartbeats').toEqual(['last seen 3h ago · quiet', 'last seen 40m ago · in a turn']);
            expect(m.seen.find((x) => x.quiet === 'true')?.text).toBe('last seen 3h ago · quiet');
            for (const x of m.seen) expect(x.inside, `${x.text} inside its row`).toBe(true);
            expect(m.resume, 'Resume at the tap floor').toBeGreaterThanOrEqual(m.tap - 1);
            expect(m.fold, 'the closed waves fold at the tap floor').toBeGreaterThanOrEqual(m.tap - 1);
            expect(m.waiting.t, 'Waiting on you sits under Goals').toBeGreaterThanOrEqual(m.goals.b - 1);
            expect(Math.abs(m.waiting.l - m.goals.l), 'in the same column').toBeLessThanOrEqual(1);
            if (width > 900) {
              expect(m.runs.l, 'Runs is the other column').toBeGreaterThanOrEqual(m.goals.r - 1);
              expect(m.runs.t, 'beside Goals, not under it').toBeLessThan(m.goals.b);
            } else {
              expect(m.runs.t, 'Runs stacks after Waiting on you').toBeGreaterThanOrEqual(m.waiting.b - 1);
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
