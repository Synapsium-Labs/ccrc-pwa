// Refined's app bar at a desk (W2 Task S4b, D-5471), in a real Chrome over the production build.
//
// The bar is at its tightest just above the phone break: six lanes with short names, and the Inbox and Runs tabs each
// carrying a two-digit badge (the plan's Step 0 fixture). The bar's line holds no gauges; the lanes row under it, in
// the same header (T2c, D-6329), holds every lane's card (lanes-row.browser.test.ts holds the row at length, with
// seventeen lanes). This file holds the bar itself with its row: at 900, 930, 960 and 1280 in both palettes, the bar's
// line is whole and holds no card, the row sits under it, every card is whole inside the row with its readings whole
// inside it, and the page does not scroll sideways. Under a coarse pointer every door in the bar is at least 44 x 44.
// The coarse pointer is a touch screen: headless Chrome ignores the DevTools protocol's pointer media feature
// (measured), so `openApp` takes `touch`. The strip folds by default (S5b, D-6530) and six lanes fold at every desk width, so
// the case seeds the stored choice expanded and keeps counting all six; the fold itself is lanes-row.browser.test.ts's.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/refined-bar.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, seedStripExpanded, serveDist, type AppFixture, type AppView, type DistServer } from './app';

// Each width with a mouse and with a touch screen (a coarse pointer at a desk width: a tablet in landscape, a touch
// laptop): the layout half runs under both, the doors' size under the touch screen.
const VIEWS: AppView[] = [false, true].flatMap((touch) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [900, 930, 960, 1280].map((width) => ({ skin: REFINED, theme, width, touch }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px, ${v.touch === true ? 'touch' : 'mouse'}`;

const nowSec = Math.floor(Date.now() / 1000);
const NAMES = ['alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta'];
const FIXTURE: AppFixture = {
  api: {
    '/api/feed': {
      events: Array.from({ length: 12 }, (_, i) => ({
        seq: i + 1, at: Date.now() - i * 1000, kind: 'mail', sessionId: 's', title: 't', body: 'b', runId: null,
      })),
    },
    '/api/accounts': {
      accounts: NAMES.map((_, i) => ({
        wrapper: `w${i}`, five: [100, 88, 76, 40, 30, 20][i], seven: 50, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
        fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
      })),
      projected: null,
      roster: NAMES.map((label, i) => ({ id: `w${i}`, label, hue: 'cyan', homeAble: true, hidden: false })),
    },
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] },
    {
      type: 'runs',
      runs: Array.from({ length: 12 }, (_, i) => ({
        id: i + 1, program: 'p', programTitle: 'P', wave: 1, waveOf: 1, project: 'x', homeProject: null, state: 'working', closedAt: null,
      })),
    },
  ],
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

describe("Refined's app bar shows nothing cut, and every door is a finger's square under a coarse pointer", () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        // Six lanes fold at every desk width here (a folded line holds fewer than six cards), and this case checks all six
        // cards' fit, so the stored choice is expanded; lanes-row.browser.test.ts holds the fold.
        await seedStripExpanded(ctx);
        await page.goto(server!.origin + '/');
        // The lanes and both badges have landed once the lanes row's cards and the two counted tab names are in place.
        await page.waitForFunction(() => document.querySelectorAll('header.shell-accounts .account-gauge').length === 6
          && document.querySelector('.ref-bar [aria-label="Inbox, 12 unread"]') !== null
          && document.querySelector('.ref-bar [aria-label="Runs, 12 active"]') !== null, undefined, { timeout: 20_000 });
        const faults = await page.evaluate(() => {
          const out: string[] = [];
          // The bar's line holds no card; the lanes row (T2c, D-6329) sits under it, in the header, one card per lane, each
          // whole inside the row.
          const line = document.querySelector<HTMLElement>('header.shell-accounts .ref-bar')!;
          const lineBox = line.getBoundingClientRect();
          if (line.querySelector('.account-gauge, .accounts-strip') !== null) out.push("the bar's line holds lane cards");
          const row = document.querySelector<HTMLElement>('header.shell-accounts .accounts-strip')!;
          const r = row.getBoundingClientRect();
          if (r.top < lineBox.bottom - 0.5) out.push(`the row (top ${r.top}) is not under the bar's line (bottom ${lineBox.bottom})`);
          const cardCount = row.querySelectorAll('.account-gauge').length;
          if (cardCount !== 6) out.push(`${cardCount} cards, not 6`);
          const fresh = line.querySelector<HTMLElement>('.ref-bar-new')!.getBoundingClientRect();
          if (fresh.right > lineBox.right + 0.5 || fresh.right > window.innerWidth + 0.5) out.push('New session is cut');
          for (const g of row.querySelectorAll<HTMLElement>('.account-gauge')) {
            const gr = g.getBoundingClientRect();
            const name = g.querySelector<HTMLElement>('.account-gauge-label')!.textContent;
            if (gr.left < r.left - 0.5 || gr.right > r.right + 0.5) out.push(`${name} sticks out of the row (${gr.left}..${gr.right} in ${r.left}..${r.right})`);
            for (const pct of g.querySelectorAll<HTMLElement>('.acct-pct')) {
              if (pct.getBoundingClientRect().right > gr.right + 0.5 || pct.scrollWidth > pct.clientWidth + 0.5) out.push(`${name}'s ${pct.textContent} is cut`);
            }
          }
          if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push('the page scrolls sideways');
          return out;
        });
        expect(faults).toEqual([]);

        if (view.touch !== true) { expect(errors).toEqual([]); return; }
        const small = await page.evaluate(() => {
          if (!matchMedia('(pointer: coarse)').matches) return ['the coarse pointer was not emulated'];
          return [...document.querySelectorAll<HTMLElement>('.ref-bar-doors button')]
            .map((b) => ({ name: b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '?', r: b.getBoundingClientRect() }))
            .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
            .map(({ name, r }) => `${name} is ${Math.round(r.width)} x ${Math.round(r.height)}`);
        });
        expect(small).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
