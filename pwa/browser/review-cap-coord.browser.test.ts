// D-8125: a cap its coordinator lifted, on the run board's band and the run page's Review cap fact, at phone, laptop and wide
// widths (375, 1024, 1440), in a real Chrome over the production build. jsdom cannot lay a line out, so what wraps is measured
// here: no sideways page scroll, the row and the fact inside their boxes, and the reason whole (not truncated, not clipped).
// Names are neutral.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/review-cap-coord.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';

const NOW = Date.now();
const H = 3_600_000;
const REASON = 'two major findings are still open, both real and converging, and the last round closed three of five of them';
const LINE = `Cap lifted by its coordinator: ${REASON}`;

const RUN = {
  id: 1701, program: 'prog-a', programTitle: 'Programme A with a title long enough to wrap on a phone', wave: 2, waveOf: 5,
  project: 'project-a', homeProject: 'project-a', sessionId: 'project-a-w1701', workspace: 'ws-1701', branch: 'ws/1701',
  state: 'working', kind: 'work', reviews: null, claimedBy: 'project-a-coord', resumed: false, clearedAt: null,
  openedAt: NOW - 3 * H, dispatchStartedAt: null, dispatchedAt: NOW - 2 * H, closedAt: null, handoffCommit: null,
  items: { done: 1, total: 4 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, hadChild: false,
  reviewCap: {
    rounds: 4, cap: 6, askedAt: NOW - H, liftedAt: null, granted: 3, askHandledAt: NOW - H / 2,
    coordLift: { at: NOW - H / 2, by: 'project-a-coord', reason: REASON, rounds: 3, capBefore: 3, capAfter: 6, count: 2 },
  },
};

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a', repo: { state: 'named', slug: 'owner-a/repo-a' } }] },
    '/api/runs': { runs: [RUN], nextBefore: null }, '/api/claims': [],
    '/api/runs/find': { ok: true, exact: null, runs: [], reviewsOf: [], next: null },
    '/api/runs/1701/record': { ok: true, run: RUN, events: [], reviewedBy: [], olderEvents: 0 },
    '/api/runs/1701': { ok: true, run: RUN, spend: { measured: false, reason: 'no-sweep' } },
    '/api/runs/1701/items': { ok: true, items: [] },
    '/api/runs/1701/signals': { ok: true, signals: { signals: { suite: { ok: false, why: 'absent' }, failure: { ok: false, why: 'absent' } } } },
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 1 }, updatedAt: null },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] }, { type: 'runs', runs: [RUN] },
    { type: 'pools', pools: { listed: false, enforcement: 'unknown', accountPools: 'unavailable' } },
  ],
};

let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  server = await serveDist(sharedDist());
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

for (const width of [375, 1024, 1440]) {
  for (const skin of [REFINED, INSTRUMENT]) {
    describe(`a coordinator-lifted cap, ${skin} at ${width}px`, () => {
      it('the band row wraps inside its box and says the whole reason, with no Lift cap button', async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin, theme: 'light', width }, FIXTURE);
        try {
          await page.goto(`${server!.origin}/runs`);
          const row = page.locator('.review-cap-band-row').first();
          await row.waitFor({ timeout: 20_000 });
          const m = await row.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return {
              text: el.textContent, overflow: el.scrollWidth - el.clientWidth, left: r.left, right: r.right, vw: innerWidth,
              buttons: el.querySelectorAll('button').length,
              page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          });
          expect(m.text).toBe(`Run 1701: ${LINE} · 4 of 6 rounds`);
          expect(m.buttons, 'no operator control on a handled ask').toBe(0);
          expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
          expect(m.overflow, 'the row fits its box').toBeLessThanOrEqual(1);
          expect(m.left).toBeGreaterThanOrEqual(-1);
          expect(m.right).toBeLessThanOrEqual(m.vw + 1);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });

      it('the run page fact wraps inside its box and says the whole reason', async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin, theme: 'light', width }, FIXTURE);
        try {
          await page.goto(`${server!.origin}/runs/1701`);
          const fact = page.locator('[data-fact="reviewCap"]');
          await fact.waitFor({ timeout: 20_000 });
          const m = await fact.evaluate((el) => {
            const dd = el.querySelector('dd')!;
            const r = el.getBoundingClientRect();
            return {
              text: dd.textContent, overflow: el.scrollWidth - el.clientWidth, ddOverflow: dd.scrollWidth - dd.clientWidth,
              right: r.right, vw: innerWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          });
          expect(m.text).toBe(`4 of 6 rounds · ${LINE}, 2 times`);
          expect(m.page, 'no sideways page scroll').toBeLessThanOrEqual(0);
          expect(m.overflow, 'the fact fits its box').toBeLessThanOrEqual(1);
          expect(m.ddOverflow, 'the reason is not clipped').toBeLessThanOrEqual(1);
          expect(m.right).toBeLessThanOrEqual(m.vw + 1);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    });
  }
}
