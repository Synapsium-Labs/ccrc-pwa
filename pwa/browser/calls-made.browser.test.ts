// Calls made for you in a real Chrome (D-8126): at 390, 1280 and 1920 wide, both skins, the group heading, a call line and the
// Overturn sheet fit without sideways scroll, the sheet's Confirm is reachable, and nothing truncates the chosen option. jsdom
// lays nothing out, so what fits is measured here, over the production build. Names are neutral: the repository is public.
//
//   CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/calls-made.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';

const NOW = Date.now();
const MIN = 60_000;

const session = (id: string, role: string): object => ({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: `/w/project-a/${id}`,
  workspace: id, name: id, status: 'busy', statusUpdatedAt: NOW - MIN, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: `ws/${id}`, ctxPct: 40, paneCols: null, tasks: null, pr: null,
  archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working', bucketSince: NOW - 6 * MIN, unmeasured: [],
  started: true, child: { kind: 'none' }, role,
});
const RUN = {
  id: 100, program: 'prog-a', programTitle: 'Programme A', wave: 2, waveOf: 5, project: 'project-a', homeProject: 'project-a',
  sessionId: 'prog-a-w1', workspace: 'prog-a-w1', branch: 'ws/prog-a-w1', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'prog-a-coord', resumed: false, clearedAt: null, openedAt: NOW - 3_600_000, dispatchStartedAt: null,
  dispatchedAt: NOW - 3_000_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
    clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false,
};
const SESSIONS = [session('prog-a-coord', 'coordinator'), session('prog-a-w1', 'child')];

const LONG_CHOSEN = 'Ship the smaller change now and follow up with the rest of the work in a later wave, once the review queue has drained';
const call = (id: number, over: object = {}): object => ({
  id, program: 'prog-a', runId: null, madeBy: 'prog-a-coord', class: 'big',
  question: 'Which store should the ledger use, given that the table is read far more often than it is written?',
  options: ['Keep the current relational table', LONG_CHOSEN, 'Move it to flat files'],
  chosen: LONG_CHOSEN, why: 'It is already there, and the smaller change lands today without touching the readers.',
  reversible: true, wakeOn: null, at: NOW - 5 * MIN, seenAt: null, overturnedAt: null, overturnNote: null, ...over,
});
const waiting = {
  items: [{ id: 1, program: 'prog-a', runId: null, kind: 'do', title: 'A blocking thing', why: 'A plain sentence.', how: ['Open Settings.'],
    options: null, recommended: null, recommendedWhy: null, neededBy: 'blocking', soonLabel: null, state: 'open', stale: false,
    raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
    history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }] }],
  cleared: [], goals: [], calls: [call(1), call(2)], callsCleared: [],
};
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': [RUN], '/api/claims': [], '/api/waiting': { ok: true, waiting },
    '/api/programmes/prog-a/goals': { ok: true, goals: { program: 'prog-a', specPath: null, inShort: null, inShortAt: null, modifications: [] } },
  },
  fleetFrames: [
    { type: 'fleet', sessions: SESSIONS }, { type: 'runs', runs: [RUN] }, { type: 'waiting', waiting },
  ],
};

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [390, 1280, 1920] as const;

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

const sideways = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Whether the element's box lies inside the viewport's width. */
const inside = (page: Page, selector: string): Promise<boolean> => page.evaluate((sel) => {
  const el = document.querySelector<HTMLElement>(sel);
  if (el === null) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.left >= -0.5 && r.right <= innerWidth + 0.5;
}, selector);

/** Whether the element's text is cut: clipped by an ellipsis or an overflow its own box does not show. */
const truncated = (page: Page, selector: string): Promise<boolean> => page.evaluate((sel) => {
  const el = document.querySelector<HTMLElement>(sel);
  if (el === null) return true;
  const k = getComputedStyle(el);
  return k.textOverflow === 'ellipsis' || el.scrollWidth > el.clientWidth + 1 || (k.webkitLineClamp !== 'none' && k.webkitLineClamp !== '');
}, selector);

describe.each(SKINS)('calls made for you in %s', (skin) => {
  for (const width of WIDTHS) {
    it(`at ${width}: the heading, a call line and the Overturn sheet fit, Confirm is reachable, the chosen option is whole`, async () => {
      const { ctx, page, errors } = await openApp(browser!, { skin, theme: 'light', width }, FIXTURE);
      try {
        await page.goto(`${server!.origin}/waiting`);
        await page.waitForSelector('.wl-calls', { timeout: 20_000 });
        await page.evaluate(async () => { await document.fonts.ready; });
        expect(await page.textContent('.wl-calls-sum')).toBe('Calls made for you (2)');
        expect(await inside(page, '.wl-calls-sum'), 'the heading').toBe(true);
        await page.click('.wl-calls-sum');
        await page.waitForSelector('.wl-call-line', { state: 'visible' });
        expect(await inside(page, '.wl-call-line'), 'a call line').toBe(true);
        expect(await truncated(page, '.wl-call-line'), 'the call line is whole').toBe(false);
        expect(await page.textContent('.wl-call-line')).toContain(LONG_CHOSEN);
        expect(await sideways(page), 'sideways scroll with the group open').toBe(0);

        await page.locator('.wl-call-overturn').first().click();
        await page.locator('.sheet-panel[data-state="open"]').waitFor({ timeout: 20_000 });
        await page.waitForTimeout(300); // the sheet's transition settles
        expect(await inside(page, '.sheet-panel'), 'the sheet').toBe(true);
        expect(await sideways(page), 'sideways scroll with the sheet open').toBe(0);
        const chosen = page.locator('.sheet-panel [data-chosen="true"]');
        expect(await chosen.textContent()).toContain(LONG_CHOSEN);
        expect(await chosen.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis'),
          'the chosen option is not truncated').toBe(true);

        await page.fill('.sheet-panel textarea', 'Use the relational table.');
        const confirm = page.getByRole('button', { name: 'Confirm' });
        await confirm.scrollIntoViewIfNeeded();
        const box = await confirm.boundingBox();
        expect(box, 'Confirm is drawn').not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 0.5);
        expect(await confirm.isEnabled(), 'Confirm is enabled once a note is written').toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
