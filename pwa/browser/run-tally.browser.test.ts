// D-8292 (#119): a run row's tally says it counts settled items, and the worker branch's commit count stands beside it.
// In a real Chrome over the production build, at 360, 390, 1280, 1470 and 1920 wide, both skins and both themes: on the
// programme page's run row and on the run's own page header, both words are drawn, each inside its row, and the page
// never scrolls sideways. The row also carries its worker heartbeat (D-8285): the three facts share the row and the
// header draws all three (the header is the superset). Names are neutral.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/run-tally.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { UNCHECKED_PR } from '../../shared/api';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const NOW = Date.now();
const H = 3_600_000;
const WIDTHS = [360, 390, 1280, 1470, 1920] as const;
const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = ['light', 'dark'] as const;

const RUN = {
  id: 1801, program: 'prog-a', programTitle: 'Programme A with a title long enough to wrap on a phone', wave: 8, waveOf: 9,
  project: 'project-a', homeProject: 'project-a', sessionId: 'project-a-w1801', workspace: 'ws-1801', branch: 'ws/1801',
  state: 'working', kind: 'work', reviews: null, claimedBy: 'project-a-coord', resumed: false, clearedAt: null,
  openedAt: NOW - 3 * H, dispatchStartedAt: null, dispatchedAt: NOW - 2 * H, closedAt: null, handoffCommit: null,
  items: { done: 0, total: 5 }, unreadMail: 0,
  workerLastSeen: NOW - 5 * 60_000, workerLastTurn: { state: 'done', startedAt: NOW - 20 * 60_000, endedAt: NOW - 5 * 60_000 },
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
};

const WORKER = fleetSession({
  id: 'project-a-w1801', project: 'project-a', workdir: '/w/project-a', workspace: 'ws-1801', branch: 'ws/1801',
  status: 'busy', bucket: 'working', pr: { ...UNCHECKED_PR, phase: 'open', number: 12, ahead: 58, checkedAt: NOW - 60_000 },
  run: { id: 1801, state: 'working', claimedBy: 'project-a-coord' },
});

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': { runs: [RUN], nextBefore: null }, '/api/claims': [],
    '/api/programmes': {
      ok: true, closedToday: { operator: 0, sweep: 0, coordinator: 0 },
      programmes: [{
        slug: 'prog-a', title: 'Programme A with a title long enough to wrap on a phone', currentWave: 8, waveOf: 9, claimedBy: 'project-a-coord',
        coordinatorGone: false, waves: { working: 1, waiting: 0, queued: 1, done: 7, failed: 0 }, lastMoveAt: NOW - 2 * H, ending: null,
      }],
    },
    '/api/runs/find': { ok: true, exact: null, runs: [], reviewsOf: [], next: null },
    '/api/programmes/prog-a/goals': { ok: true, goals: { program: 'prog-a', specPath: null, inShort: null, inShortAt: null, modifications: [] } },
    '/api/programmes/prog-a/secrets': { ok: true, program: 'prog-a', slots: [] },
    '/api/runs/1801/record': { ok: true, run: RUN, events: [], reviewedBy: [], olderEvents: 0 },
    '/api/runs/1801': { ok: true, run: RUN, spend: { measured: false, reason: 'no-sweep' } },
    '/api/runs/1801/items': { ok: true, items: [] },
    '/api/runs/1801/signals': { ok: true, signals: { signals: { suite: { ok: false, why: 'absent' }, failure: { ok: false, why: 'absent' } } } },
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 1 }, updatedAt: null },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [WORKER] }, { type: 'runs', runs: [RUN] },
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

/** Each named element's words and whether it sits inside `within`, plus the page's sideways scroll. Its arguments ride
 *  `page.evaluate`'s second parameter: the function runs in the page, where no closure of this file exists. */
const measure = ({ sels, within }: { sels: readonly string[]; within: string }) => {
  const outer = document.querySelector(within)!.getBoundingClientRect();
  const parts = sels.map((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el === null) return { sel, text: null, inside: false, title: null };
    const r = el.getBoundingClientRect();
    return { sel, text: el.textContent, title: el.getAttribute('title'),
      inside: r.left >= outer.left - 1 && r.right <= outer.right + 1 && r.right <= innerWidth + 1 };
  });
  const row = document.querySelector<HTMLElement>(within)!;
  return { parts, overflow: row.scrollWidth - row.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};

for (const width of WIDTHS) {
  for (const skin of SKINS) {
    for (const theme of THEMES) {
      describe(`the run tally and commits, ${skin} ${theme} at ${width}px`, () => {
        it('the programme page\'s row draws "0/5 settled", "58 commits" and the heartbeat inside the row', async () => {
          const { ctx, page, errors } = await openApp(browser!, { skin, theme, width }, FIXTURE);
          try {
            await page.goto(`${server!.origin}/programmes/prog-a`);
            await page.locator('[data-testid="programme-runs"] li.run-row .run-commits').first().waitFor({ timeout: 30_000 });
            const m = await page.evaluate(measure, { sels: ['li.run-row .run-tally', 'li.run-row .run-commits', 'li.run-row .run-seen'], within: '[data-testid="programme-runs"] li.run-row' });
            expect(m.parts.map((p) => p.text)).toEqual(['0/5 settled', '58 commits', 'last seen 5m ago']);
            for (const p of m.parts) {
              expect(p.inside, `${p.sel} inside its row`).toBe(true);
              expect(p.title, `${p.sel} says what it counts`).toBeTruthy();
            }
            expect(m.overflow, 'the row fits its box').toBeLessThanOrEqual(1);
            expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
            expect(errors.filter((e) => !e.includes('Transition was skipped'))).toEqual([]);
          } finally {
            await ctx.close();
          }
        });

        it('the run page header draws them too', async () => {
          const { ctx, page, errors } = await openApp(browser!, { skin, theme, width }, FIXTURE);
          try {
            await page.goto(`${server!.origin}/runs/1801`);
            await page.locator('.rd-head .rd-commits').first().waitFor({ timeout: 30_000 });
            const m = await page.evaluate(measure, { sels: ['.rd-head .rd-tally', '.rd-head .rd-commits', '.rd-head .rd-seen'], within: '.rd-head' });
            expect(m.parts.map((p) => p.text)).toEqual(['0/5 settled', '58 commits', 'last seen 5m ago']);
            for (const p of m.parts) expect(p.inside, `${p.sel} inside the header`).toBe(true);
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
