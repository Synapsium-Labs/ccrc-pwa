// Settings › Overlord in a real Chrome over the production build (Overlord W1 home C, Tasks 8 and 9; plan Global Constraints,
// "Phone first"). The section is drawn only under `overlord-v1`, so every fixture names the word on `/health` and answers every
// read the section makes: the designation, the accounts (a roster whose pools have the longest names the rule allows, with a
// billing fact and a continuity record on one account), the renewal backstop, the response retention and the account holds
// (one hold, so Clear is drawn).
//
// TWO STATES of the designation, and each pins the exact count of the controls it draws:
// - `bound`: a bound Overlord (Retire, the place's link, the model class radios and Save, the account set's boxes, Save and Save
//   again), with the backstop, the retention and the account facts;
// - `none`: no designation (the place's Start link only on the designation cards), with the same three other cards.
// Neither draws what only an answer or another read brings: the step-up's confirm, an answer or refusal line, Retire on a row
// that only owes stops, the waiting-for-accounts line, or the absent and unread sentences. Those are the unit files' cases.
// In both, the decision model's and the private-name list's reads answer `absent: true` (the card read's absent, as an older
// server's 404 is: this harness answers every route 200), so their cards are not drawn.
// - `w2` (Overlord W2 Settings): no designation, as `none`, and the W2 cards drawn from their reads: the decision model's host (a
//   long endpoint, a key set) and its seven rows (one armed gate offered a newer line, one held row with Resume), and the
//   private-name list with a list stored (Upload and Clear the list).
// - `w2-refused`: `w2` with one Upload sent and refused for its first row, so a refusal line (the longest row sentence) is drawn
//   and measured at every width too.
// The W2 cards are measured here, in the section's own file and at its widths, not in a file of their own (the brief's ruling 7,
// slug `w2-cards-measured-in-the-section-browser-file`).
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

type State = 'bound' | 'none' | 'w2' | 'w2-refused';
const W2_DRAWS = ['[data-settings-control="start-on-place"]', '[data-settings-control="decision-approve"]', '[data-settings-control="decision-resume"]',
  '[data-settings-control="names-clear"]'] as const;
/** What each state must draw before it is measured (a hook inside the section). */
const DRAWS: Readonly<Record<State, readonly string[]>> = {
  bound: ['[data-settings-control="retire"]', '[data-settings-control="model-save"]', '[data-settings-account-set] input[type="checkbox"]'],
  none: ['[data-settings-control="start-on-place"]'],
  w2: W2_DRAWS,
  'w2-refused': W2_DRAWS,
};
/** The cards each state draws, in order. */
const W1_CARDS = ['designation', 'model', 'account-set', 'backstop', 'retention', 'accounts'] as const;
const W2_CARDS = [...W1_CARDS, 'decision-host', 'decision-rows', 'private-names'] as const;
const CARDS: Readonly<Record<State, readonly string[]>> = { bound: W1_CARDS, none: W1_CARDS, w2: W2_CARDS, 'w2-refused': W2_CARDS };
/** `w2-refused`'s upload answer: a refused row with the longest of the row sentences, drawn under the list's controls. */
const ROW_REFUSED = { ok: false, error: 'bad-request', row: 0, reason: 'non-ascii', detail: 'row 0: a letter or digit outside a-z and 0-9' };

/** An endpoint as long as a real one may be, with a path: it must wrap, not push the page sideways. */
const LONG_ENDPOINT = 'https://decision-model-host-a.example/v1/projects/project-a-long-name/locations/region-a/endpoints/ask';
const SIDE = { mode: 'off', ceiling: 600, armedLine: null, held: false };
const decisionRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, side: SIDE, heldWhy: null, direction: 'advice', privateState: false, today: { serve: 0, maintenance: 0, reserved: 0, total: 0 },
  line: null, offered: null, ...over,
});
/** The decision model's read: seven rows, the gate armed and offered a newer line, one advice row held. */
const DECISION_VIEW = {
  rows: [
    decisionRow('programme.pick', { side: { ...SIDE, mode: 'shadow' }, today: { serve: 12, maintenance: 3, reserved: 1, total: 16 } }),
    decisionRow('programme.any'),
    decisionRow('scope.widens', {
      direction: 'gate', privateState: true, side: { mode: 'armed', ceiling: 300, armedLine: { id: 4, line: 0.85 }, held: false },
      line: { id: 6, line: 0.9, admitted: true, labelled: 240, errors: 2, bound: 0.05, canaryAsked: 20, canaryExpected: 20, canaryCrossed: 0 },
      offered: { id: 6, line: 0.9 },
    }),
    decisionRow('relay.method', { side: { mode: 'shadow', ceiling: 5000, armedLine: null, held: true }, heldWhy: 'line-key' }),
    decisionRow('readback.omits', { privateState: true }),
    decisionRow('readback.adds', { privateState: true }),
    decisionRow('goals.conflict'),
  ],
  fleetToday: 16, fleetCap: 3000,
  host: { kind: 'zero-retention', endpoint: LONG_ENDPOINT, origin: 'https://decision-model-host-a.example', modelId: 'model-a-long-identifier-2026-11' },
  key: { setAt: NOW - 86_400_000, masked: true },
};

const w2 = (state: State): boolean => state === 'w2' || state === 'w2-refused';

function fixtureFor(state: State): AppFixture {
  return {
    fleetFrames: [{ type: 'fleet', sessions: [] }],
    api: {
      '/health': { ok: true, build: null, caps: ['overlord-v1'] },
      '/api/overlord/designation': { ok: true, designation: state === 'bound' ? ROW : null },
      '/api/decision-model': w2(state) ? DECISION_VIEW : { absent: true },
      '/api/overlord/private-names': w2(state) ? { state: 'list', rows: 12, uploadedAt: NOW - 3_600_000 } : { absent: true },
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
const STATES: readonly State[] = ['bound', 'none', 'w2', 'w2-refused'];

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
  const controls = [...section.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href]')]
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
  // `w2-refused`: the upload alone is answered with a refusal (a page route outranks the harness's context route, which answers
  // every other call, the status read included).
  if (state === 'w2-refused') {
    await opened.page.route('**/api/overlord/private-names', (route) => (route.request().method() === 'PUT'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(ROW_REFUSED) }) : route.fallback()));
  }
  await opened.page.goto(server!.origin + '/settings/overlord');
  await settle(opened.page, DRAWS[state]);
  if (state === 'w2-refused') {
    await opened.page.fill('[data-settings-card="private-names"] textarea', 'zz-alpha');
    await opened.page.click('[data-settings-control="names-upload"]');
    await opened.page.waitForSelector('.ovs-section [data-settings-refusal="private-names"]', { timeout: 20_000 });
  }
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
            expect(m.cards, 'the cards, in order').toEqual([...CARDS[state]]);
            // The controls drawn, exactly (review 4056 F10: a floor under them let a card lose a control and still pass). In every
            // state: the backstop's hour, zone and Save (3), the retention's days and Save (2), and two accounts with four fact
            // controls each and one Clear (9). `bound` adds the place's link and Retire (2), the model class's two radios and Save
            // (3), and the account set's three boxes, Save and Save again (5): 24. `none` adds the place's Start link (1): 15. `w2`
            // is `none`'s 15, then the decision model's host (its kind, endpoint, model id, the key field and its Show, Save and
            // Remove the key: 7), its seven rows (three radios, the ceiling and its Save each: 35, with Approve and Resume: 37), and
            // the list (its box, Upload and Clear the list: 3): 62. `w2-refused` is `w2` with a refused row's line drawn: 62.
            expect(m.controls.length, 'the section draws exactly its controls').toBe({ bound: 24, none: 15, w2: 62, 'w2-refused': 62 }[state]);
            if (state === 'w2-refused') {
              const line = await page.$eval('[data-settings-refusal="private-names"]', (el) => {
                const b = el.getBoundingClientRect();
                return { left: b.left, right: b.right, text: el.textContent ?? '' };
              });
              expect(line.text, 'the refused row is named by its line').toMatch(/^Line 1: /);
              expect(line.left, 'the refusal line starts inside the page').toBeGreaterThanOrEqual(0);
              expect(line.right, 'the refusal line ends inside the page').toBeLessThanOrEqual(m.vw + 0.5);
            }
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
