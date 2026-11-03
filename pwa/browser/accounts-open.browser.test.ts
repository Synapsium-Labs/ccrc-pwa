// Opening Accounts asks once (W7 C7b Step 3; D-7180; ARCH-28 #540; coordinator call 3). The fleet store is the one
// `/api/accounts` reader (#1720, D-6440): its read at connect and every 20 s. The Accounts screen calls
// `refreshAccounts()` once when it opens, so a person opening it sees the store's answer at once and then a fresh one.
// Each view opens the fleet, lets the store's first answer land, then opens `/accounts` with every `/api` request held:
// the rows are drawn from the store while the screen's one request is parked, and stay drawn once it is answered.
// Phone 360 and 390, laptop 1280 and wide 1920, in both skins, light and dark.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const nowSec = Math.floor(Date.now() / 1000);
const acct = (wrapper: string, five: number, seven: number): Record<string, unknown> => ({
  wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});
const ACCOUNTS = {
  accounts: [acct('lane-a', 12, 30), acct('lane-b', 40, 55)],
  projected: { wrapper: 'lane-a', score: 12 },
  roster: [
    { id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: null },
    { id: 'lane-b', label: 'lane-b', hue: 'violet', homeAble: true, hidden: false, pool: null },
  ],
};
const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
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

const ROWS = '.accounts-list .accounts-row:not([data-loading])';

describe('opening Accounts shows the store\'s answer at once and asks once (D-7180)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const opened = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors, events } = opened;
      try {
        const accountsHits = (): number => events.filter((e) => e.kind === 'intercept' && e.path === '/api/accounts').length;
        const accountsDone = (): number => events.filter((e) => e.kind === 'fulfil-done' && e.path === '/api/accounts').length;
        await page.goto(server!.origin + '/');
        // The store's first answer (its read at connect) has landed.
        await expect.poll(accountsDone, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
        await page.waitForTimeout(300);
        const before = accountsHits();
        // Every request from here on is parked, so the rows drawn below are the store's answer, not the fresh one.
        opened.holdApi();
        await page.evaluate(() => {
          history.pushState(null, '', '/accounts');
          dispatchEvent(new PopStateEvent('popstate'));
        });
        await page.waitForFunction((sel) => location.pathname === '/accounts' && document.querySelectorAll(sel).length === 2, ROWS, { timeout: 30_000 });
        await expect.poll(() => accountsHits() - before, { timeout: 5_000, message: 'one /api/accounts request on open' }).toBe(1);
        expect(accountsDone(), 'the fresh answer is still parked: the rows are the store\'s').toBe(before);
        opened.releaseApi();
        await page.waitForTimeout(3_000); // well inside the store's 20 s cadence
        expect(accountsHits() - before, 'one /api/accounts request on open, and no more').toBe(1);
        expect(await page.locator(ROWS).count(), 'the rows stay drawn after the fresh answer').toBe(2);
        expect(await page.locator('.accounts-projection').textContent()).toBe('Next workspace lands on lane-a — least-loaded');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
