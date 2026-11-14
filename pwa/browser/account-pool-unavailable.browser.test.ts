// The dimmed account pool chip at every width (D-8015): a box with no pool-sync timer answers `accountPools: 'unavailable'`,
// and the existing chip and the sheet's note must reach the operator on it. That box is the single-box install, so the
// frame carries `accountPoolsReason: 'no-pool-sync'` and the chip says the tag is not applied here and why (D-8283), the
// longest of its texts and so the one that must fit. Sixteen cells: phone 360 and 390, laptop 1280
// and wide 1920, both skins, light and dark. The chip stays a real control, so each cell also opens the sheet it leads to.
// `account-pool-chip.test.tsx` holds the other direction, where no frame timing can make its answer true by accident.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { ACCOUNT_POOL_NO_SYNC_TEXT } from '../src/screens/AccountsScreen';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const CHIP = '[data-testid="acct-pool-chip-lane-a"]';
const NOTICE = '[data-testid="account-pool-unenforced-notice"]';

const FIXTURE: AppFixture = {
  api: {
    '/api/feed': { events: [] },
    '/api/accounts': {
      accounts: [{
        wrapper: 'lane-a', five: 12, seven: 30, ts: Math.floor(Date.now() / 1000) - 60, fiveResetAt: null, sevenResetAt: null,
        fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
      }],
      projected: { wrapper: 'lane-a', score: 12 },
      roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: 'pool-a', provider: 'anthropic', kind: 'sign-in' }],
      lanes: { 'lane-a': { state: { word: 'signed-in', source: 'checked 4m ago' }, ready: true } },
    },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] },
    { type: 'pools', pools: { listed: false, enforcement: 'enforced', accountPools: 'unavailable', accountPoolsReason: 'no-pool-sync' } },
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

/** The SPA's own navigation, as a link tap makes it. */
const go = (page: Page, to: string): Promise<void> => page.evaluate((path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, to);

describe('accountPools: unavailable on a single-box install dims the chip and the sheet says why (D-8015, D-8283)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
        await page.locator(`${CHIP}[data-dim="true"]`).waitFor({ timeout: 30_000 });
        const m = await page.evaluate((chipSel) => {
          const chip = document.querySelector<HTMLButtonElement>(chipSel)!;
          const b = chip.getBoundingClientRect();
          return {
            skin: document.documentElement.getAttribute('data-skin'),
            theme: document.documentElement.getAttribute('data-theme') ?? 'phosphor',
            title: chip.title,
            label: chip.getAttribute('aria-label') ?? '',
            tag: chip.tagName,
            disabled: chip.disabled,
            inView: b.left >= 0 && b.right <= innerWidth,
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        }, CHIP);
        expect(m.skin).toBe(view.skin);
        expect(m.theme).toBe(view.theme);
        expect(m.title).toBe(ACCOUNT_POOL_NO_SYNC_TEXT);
        expect(m.label).toContain(ACCOUNT_POOL_NO_SYNC_TEXT);
        expect(m.tag, 'still a control').toBe('BUTTON');
        expect(m.disabled).toBe(false);
        expect(m.inView, 'the chip inside the viewport').toBe(true);
        expect(m.docOverflow, 'no sideways scroll').toBeLessThanOrEqual(0);

        await page.locator(CHIP).click();
        await page.locator(NOTICE).waitFor({ timeout: 10_000 });
        expect(await page.locator(NOTICE).textContent()).toMatch(/Not applied on this install: it has no pool-sync timer/);
        const notice = await page.locator(NOTICE).evaluate((el) => {
          const b = el.getBoundingClientRect();
          return { inView: b.left >= 0 && b.right <= innerWidth, overflow: el.scrollWidth - el.clientWidth };
        });
        expect(notice.inView, 'the notice inside the viewport').toBe(true);
        expect(notice.overflow, 'the notice wraps, never scrolls sideways').toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
