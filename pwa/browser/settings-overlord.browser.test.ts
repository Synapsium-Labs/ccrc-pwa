// Settings › Overlord in a real Chrome over the production build (Overlord W1 home C, Tasks 8 and 9; plan Global Constraints,
// "Phone first"). The section is drawn only under `overlord-v1`, so every fixture names the word on `/health` and answers every
// read the section makes: the designation, the accounts (a roster whose pools have the longest names the rule allows, with a
// billing fact and a continuity record on one account), the renewal backstop, the response retention and the account holds
// (one hold, so Clear is drawn).
//
// TWO STATES of the designation, so every control the section can draw is drawn and measured:
// - `bound`: a bound Overlord (Retire, the place's link, the model class radios and Save, the account set's boxes, Save and Save
//   again), with the backstop, the retention and the account facts;
// - `none`: no designation (the place's Start link only on the designation cards), with the same three other cards.
//
// At 320, 360, 390, 899 and 1280 px, in both skins and in the light and the dark palette (the dark palette's id is `PHOSPHOR`;
// each case asserts the theme the page stamped, so a name the app does not keep can never pass as dark):
// - nothing scrolls sideways, and the page throws nothing;
// - every control of the section starts and ends inside the page;
// - every control is at least 44 px tall and 44 px wide at every phone width (a radio or a checkbox is measured by its label,
//   the hit area), the account set's checkboxes included.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/settings-overlord.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';

const NOW = Date.now();

/** Pool names as long as the name rule allows (`POOL_NAME_RE`, 32 characters): the boxes must wrap, not push the page sideways. */
const LONG_POOLS = ['pool-a-long-running-programmes-1', 'pool-b-reviews-and-quick-fixes-2'] as const;

const ROW = {
  bound: { sessionId: 'lane-a-overlord', generation: 'g1' }, pending: null, term: 2, designatedTerm: 1, model: 'opus',
  accountPools: { pools: [LONG_POOLS[0]], untagged: false }, pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [],
};

type State = 'bound' | 'none';
/** What each state must draw before it is measured (a hook inside the section). */
const DRAWS: Readonly<Record<State, readonly string[]>> = {
  bound: ['[data-settings-control="retire"]', '[data-settings-control="model-save"]', '[data-settings-account-set] input[type="checkbox"]'],
  none: ['[data-settings-control="start-on-place"]'],
};
/** The cards each state draws, in order. */
const CARDS = ['designation', 'model', 'account-set', 'backstop', 'retention', 'accounts'] as const;

function fixtureFor(state: State): AppFixture {
  return {
    fleetFrames: [{ type: 'fleet', sessions: [] }],
    api: {
      '/health': { ok: true, build: null, caps: ['overlord-v1'] },
      '/api/overlord/designation': { ok: true, designation: state === 'bound' ? ROW : null },
      '/api/accounts': {
        accounts: [], projected: null,
        roster: [
          { id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: LONG_POOLS[0], homeAble: true, hidden: false, fableBilling: 'included', continuity: { recordedAt: Math.floor(NOW / 1000) - 86_400 } },
          { id: 'lane-b', label: 'lane-b', hue: 'violet', pool: LONG_POOLS[1], homeAble: true, hidden: false },
        ],
      },
      '/api/continuity/renewal-backstop': { ok: true, hour: 4, zone: 'UTC', isDefault: true, setAt: null },
      '/api/responses/retention': { ok: true, days: 30, min: 7, max: 90, default: 30 },
      '/api/continuity/account-holds': { ok: true, holds: [{ lane: 'lane-b', cause: 'launch-profile-unmet', startId: 4, heldAt: NOW - 600_000 }] },
    },
  };
}

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [320, 360, 390, 899, 1280] as const;
/** The light palette and the dark one, by the ids the app keeps (`@ccrc/ui`'s `THEMES`): `PHOSPHOR` is the dark palette. */
const PALETTES = ['light', PHOSPHOR] as const;
const STATES: readonly State[] = ['bound', 'none'];

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

/** What the page measures, in the page: every visible control of the section with its box, the cards drawn, and the theme the
 *  page stamped (`PHOSPHOR` is applied by removing `data-theme`). */
const measure = (phosphor: string): {
  controls: { name: string; w: number; h: number; left: number; right: number }[]; vw: number; cards: string[]; theme: string;
} => {
  const section = document.querySelector('.ovs-section')!;
  const controls = [...section.querySelectorAll<HTMLElement>('button, select, input, a[href]')]
    .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
    .map((el) => {
      // A native checkbox or radio sits inside its label, which is the tap target: measure the label.
      const target = (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) ? (el.closest('label') ?? el) : el;
      const box = target.getBoundingClientRect();
      return {
        name: el.getAttribute('aria-label') ?? target.textContent?.trim() ?? el.tagName, w: box.width, h: box.height, left: box.left, right: box.right,
      };
    });
  return {
    controls,
    vw: document.documentElement.clientWidth,
    cards: [...section.querySelectorAll('[data-settings-card]')].map((c) => c.getAttribute('data-settings-card') ?? ''),
    theme: document.documentElement.getAttribute('data-theme') ?? phosphor,
  };
};

const sideways = (): number => document.documentElement.scrollWidth - document.documentElement.clientWidth;

async function settle(page: Page, drawn: readonly string[]): Promise<void> {
  await page.waitForSelector('.ovs-section [data-settings-backstop]', { timeout: 20_000 });
  await page.waitForSelector('.ovs-section [data-settings-retention]', { timeout: 20_000 });
  await page.waitForSelector('.ovs-section [data-hold-clear="lane-b"]', { timeout: 20_000 });
  for (const sel of drawn) await page.waitForSelector(`.ovs-section ${sel}`, { timeout: 20_000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(250); // the first paint's transitions settle
}

async function open(skin: string, theme: string, width: number, state: State) {
  const opened = await openApp(browser!, { skin, theme, width }, fixtureFor(state));
  await opened.page.goto(server!.origin + '/settings/overlord');
  await settle(opened.page, DRAWS[state]);
  return opened;
}

describe.each(SKINS)('Settings › Overlord in %s', (skin) => {
  for (const state of STATES) {
    for (const theme of PALETTES) {
      for (const width of WIDTHS) {
        it(`${state}, at ${width} (${theme}): every card drawn, no sideways scroll, no page error, every control inside the page and 44 px on a phone`, async () => {
          const { ctx, page, errors } = await open(skin, theme, width, state);
          try {
            const shots = process.env['CCRC_SHOTS'];
            if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/settings-overlord-${skin}-${state}-${theme}-${width}.png`, fullPage: true });
            expect(await page.evaluate(() => location.pathname)).toBe('/settings/overlord');
            expect(await page.evaluate(sideways), 'sideways scroll').toBe(0);
            const m = await page.evaluate(measure, PHOSPHOR);
            expect(m.theme, 'the palette the page stamped is the one asked for').toBe(theme);
            expect(m.cards, 'the six cards, in order').toEqual([...CARDS]);
            // Two accounts with four fact controls each, a Clear, the backstop's and the retention's: never fewer.
            expect(m.controls.length, 'the section draws its controls').toBeGreaterThanOrEqual(state === 'bound' ? 20 : 13);
            if (state === 'bound') {
              const boxes = await page.$$eval('[data-settings-account-set] label', (ls) => ls.map((l) => l.textContent?.trim() ?? ''));
              expect(boxes, 'the account set draws the saved pool first, the other long pool and untagged').toEqual([...LONG_POOLS, 'Untagged accounts']);
            }
            // Inside the page too: an overflow inside a clipped scroller widens no document, so the page-level check above cannot see it.
            for (const c of m.controls) {
              expect(c.left, `"${c.name}" starts inside the page`).toBeGreaterThanOrEqual(0);
              expect(c.right, `"${c.name}" ends inside the page`).toBeLessThanOrEqual(m.vw + 0.5);
            }
            if (width < 900) {
              for (const c of m.controls) {
                expect(c.h, `"${c.name}" is at the tap floor`).toBeGreaterThanOrEqual(44);
                expect(c.w, `"${c.name}" is at the tap floor`).toBeGreaterThanOrEqual(44);
              }
            }
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }, 60_000);
      }
    }
  }
});
