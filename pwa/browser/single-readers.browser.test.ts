// The single readers, seen in a real browser (W7 C7n Step 9; D-7192, D-7209; ARCH-75 #810). The fleet store owns the
// one `/api/feed` request, and the Inbox calls its `refreshFeed()` on every open; the Inbox's closed runs and the run
// board's are one archive reader; New session and Start programme read their projects through the one loader. None
// of it may change a word, a state or a request on screen. Each view holds:
//   - the Inbox: "Loading…" while its read on open is parked, "Nothing yet." once it lands empty, one feed and one runs
//     request per open (a re-open asks again), and the error sentence when the feed read fails;
//   - the run board: "No runs." with one `GET /api/runs?closed=1` on mount;
//   - Start programme and New session: the project list drawn from one class-blind `GET /api/projects`.
// Phone 360 and 390, laptop 1280 and wide 1920, in both skins, light and dark.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const nowSec = Math.floor(Date.now() / 1000);
const ACCOUNTS = {
  accounts: [{ wrapper: 'lane-a', five: 12, seven: 30, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
    fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false }],
  projected: { wrapper: 'lane-a', score: 12 },
  roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: null }],
};
const FIXTURE: AppFixture = {
  api: {
    '/api/feed': { events: [] },
    '/api/accounts': ACCOUNTS,
    '/api/runs': { runs: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/claims': [],
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 0 }, updatedAt: null },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'runs', runs: [] }],
};

const MAIL_ERROR = 'Could not reach the server — mail may exist that is not shown.';
const NO_RUNS = 'No runs. A program starts when a coordinator opens one.';

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

/** Every `/api` request the page sent, as `pathname?search`, in order. */
const recordRequests = (page: Page): string[] => {
  const sent: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/')) sent.push(url.pathname + url.search);
  });
  return sent;
};
const go = (page: Page, to: string): Promise<void> => page.evaluate((path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, to);
const emptyState = (page: Page): Promise<{ state: string | null; text: string } | null> => page.evaluate(() => {
  const el = document.querySelector('main [data-state], [data-state]');
  return el === null ? null : { state: el.getAttribute('data-state'), text: el.textContent ?? '' };
});
const count = (sent: readonly string[], want: string): number => sent.filter((s) => s === want).length;

describe('the single readers change nothing on screen (C7n, D-7192, D-7209)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const opened = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors, events } = opened;
      try {
        const sent = recordRequests(page);
        const feedDone = (): number => events.filter((e) => e.kind === 'fulfil-done' && e.path === '/api/feed').length;
        await page.goto(server!.origin + '/');
        // The store's connect-time feed read has landed.
        await expect.poll(feedDone, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
        await page.waitForTimeout(300);

        // The Inbox, its read on open parked: "Loading…".
        let before = sent.length;
        opened.holdApi();
        await go(page, '/mail');
        await page.waitForFunction(() => location.pathname === '/mail' && document.querySelector('[data-state]') !== null, null, { timeout: 30_000 });
        expect(await emptyState(page)).toEqual({ state: 'loading', text: 'Loading…' });
        await expect.poll(() => count(sent.slice(before), '/api/feed?limit=100'), { timeout: 5_000 }).toBe(1);
        opened.releaseApi();
        // Answered empty: "Nothing yet.".
        await page.waitForFunction(() => document.querySelector('[data-state="ok"]') !== null, null, { timeout: 30_000 });
        expect(await emptyState(page)).toEqual({ state: 'ok', text: 'Nothing yet.' });
        await page.waitForTimeout(500);
        expect([count(sent.slice(before), '/api/feed?limit=100'), count(sent.slice(before), '/api/runs?closed=1')], 'one feed and one runs read on open').toEqual([1, 1]);

        // The run board: "No runs.", one archive read on mount.
        before = sent.length;
        await go(page, '/runs');
        await page.waitForFunction((words) => [...document.querySelectorAll('[data-state="ok"]')].some((el) => el.textContent === words), NO_RUNS, { timeout: 30_000 });
        await page.waitForTimeout(500);
        expect(count(sent.slice(before), '/api/runs?closed=1'), 'one archive read on the board\'s mount').toBe(1);

        // Start programme: the project list from one class-blind GET /api/projects.
        before = sent.length;
        await page.getByRole('button', { name: 'Start a program' }).click();
        await page.getByRole('button', { name: /project-a/ }).first().waitFor({ timeout: 30_000 });
        expect(sent.slice(before).filter((s) => s.startsWith('/api/projects')), 'Start programme asks once, with no class').toEqual(['/api/projects']);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // The Inbox re-opened: one more feed read and one more runs read.
        before = sent.length;
        await go(page, '/mail');
        await page.waitForFunction(() => location.pathname === '/mail' && document.querySelector('[data-state="ok"]') !== null, null, { timeout: 30_000 });
        await page.waitForTimeout(500);
        expect([count(sent.slice(before), '/api/feed?limit=100'), count(sent.slice(before), '/api/runs?closed=1')], 'a re-open reads again').toEqual([1, 1]);

        // New session: pick the account, and the project list is drawn from one class-blind GET /api/projects.
        await go(page, '/');
        await page.waitForTimeout(500);
        before = sent.length;
        await page.getByRole('button', { name: 'New session' }).first().click();
        await page.getByRole('button', { name: /lane-a/ }).first().click({ timeout: 30_000 });
        await page.getByText('project-a', { exact: true }).first().waitFor({ timeout: 30_000 });
        expect(sent.slice(before).filter((s) => s.startsWith('/api/projects')), 'New session asks once, with no class').toEqual(['/api/projects']);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);

    it(`${named(view)}: the Inbox's error sentence when its feed read fails`, async () => {
      const opened = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors } = opened;
      try {
        await page.route('**/api/feed**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
        await page.goto(server!.origin + '/mail');
        await page.waitForFunction(() => document.querySelector('[data-state="error"]') !== null, null, { timeout: 30_000 });
        expect(await emptyState(page)).toEqual({ state: 'error', text: MAIL_ERROR });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
