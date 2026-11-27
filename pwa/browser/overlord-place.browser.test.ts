// The Overlord's place in a real Chrome over the production build (Overlord W1 home B, Tasks 4 to 6; plan Global
// Constraints, "Phone first"; review 3998 F1 and F2). The place is drawn only under `overlord-v1`, so every fixture names the
// word on `/health` and answers every read the place makes: the designation, the ladder (rows above `chat` unavailable, one
// latch, one condition), the readiness word, the portfolio (two programmes), the pools' runway, the accounts (a roster whose
// pools have long names), Waiting on you and the programmes read, and the authority guard's state.
//
// FIVE STATES OF THE OVERLORD'S BODY, through one sweep, so every control the place can draw is drawn and measured:
// - `bound`: a bound Overlord whose word is ready (Open, Rebind);
// - `restartable`: a bound one whose word is dead with `restartable: true` (Restart);
// - `none`: no designation (the Start form: the model radios and the account boxes, with long pool names);
// - `failed-start`: no binding and a failed last attempt (its sentence, and Start again with its form);
// - `pending`: an attempt pending its first start (the pending line, no control).
// And one flow: Rebind answered `overlord-body-alive` (the route is answered 409 for that case alone) draws "Rebind anyway".
//
// At 320, 360, 390, 899 and 1280 px, in both skins and in the light and the dark palette (the dark palette's id is
// `PHOSPHOR`; each case asserts the theme the page stamped, so a name the app does not keep can never pass as dark):
// - nothing scrolls sideways, and the page throws nothing;
// - every control of the place is at least 44 px tall and 44 px wide at every phone width (a radio or a checkbox is measured
//   by its label, the hit area);
// - the readiness word's status label is drawn in every state, with the state's own word (home C's carried 4b), and reads at
//   4.5:1 or better on the ground drawn behind it, measured in the page; the settle waits for the word itself.
// At 320 and 360 px: the portfolio strip's rank control reorders the strip with no sideways scroll, and it is reachable and
// usable by keyboard alone (Tab to a Move button, Enter).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/overlord-place.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { LOAD_LINES } from '../../shared/loadLines';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const NOW = Date.now();
const NOW_S = Math.floor(NOW / 1000);

const entry = (slug: string, title: string, position: number) => ({
  slug, title, rank: { position, cls: 'standard', fixedDate: null }, cls: 'standard',
  wip: { working: 1, waiting: 0, queued: 1 }, closedWaves: { days7: 2, days28: 5 },
  cycle: { n: 0, medianMs: null, p85Ms: null }, cycleUnmeasured: 0, oldestOpenMs: 3_600_000, oldestOpenUnmeasured: 0,
  reviewRounds: { rounds: 1, waves: 2 }, ended28: { done: 4, failed: 0, neverStarted: 0 }, waitingOnOperatorMs28: 0,
  itemsUnmeasured: 0, asksUnmeasured: 0, blocking: { items: [], asks: 0 },
});
const crossing = { kind: 'at', atS: NOW_S + 86_400 } as const;

/** Pool names as long as the name rule allows (`POOL_NAME_RE`, 32 characters): the account boxes must wrap, not push the page
 *  sideways. A longer name reads as malformed and is never drawn, so the case would measure nothing. */
const LONG_POOLS = ['pool-a-long-running-programmes-1', 'pool-b-reviews-and-quick-fixes-2'] as const;

const ROW = {
  bound: { sessionId: 'lane-a-overlord', generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [],
};
const READY = { word: 'ready', since: NOW - 1_800_000, why: null, until: null, questionsGo: 'operator', restartable: false, strandCause: null };

type BodyState = 'bound' | 'restartable' | 'none' | 'failed-start' | 'pending';
const DESIGNATIONS: Readonly<Record<BodyState, unknown>> = {
  bound: ROW,
  restartable: ROW,
  none: null,
  'failed-start': { ...ROW, bound: null, lastAttempt: { sessionId: 'lane-a-overlord', outcome: 'create-failed', at: NOW - 600_000 } },
  pending: {
    ...ROW, bound: null,
    pending: { sessionId: 'lane-a-overlord', kind: 'designate', deadlineAt: NOW + 600_000, since: NOW - 30_000, actor: 'operator', generation: null },
  },
};
const READINESS: Readonly<Record<BodyState, unknown>> = {
  bound: READY,
  restartable: { ...READY, word: 'dead', why: 'it measures dead', restartable: true },
  none: { ...READY, word: 'absent', since: 0 },
  'failed-start': { ...READY, word: 'absent', since: 0 },
  pending: { ...READY, word: 'absent', since: 0 },
};
/** The readiness word each state's label reads (home C's carried 4b): asserted in every state, so a state that loses its label,
 *  or draws another state's word, is red rather than measured as nothing. */
const WORD: Readonly<Record<BodyState, string>> = {
  bound: 'ready', restartable: 'dead', none: 'absent', 'failed-start': 'absent', pending: 'absent',
};
/** The control each state must draw (a `data-overlord-control` hook), or the pending line's hook. */
const DRAWS: Readonly<Record<BodyState, readonly string[]>> = {
  bound: ['[data-overlord-control="open"]', '[data-overlord-control="rebind"]'],
  restartable: ['[data-overlord-control="restart"]'],
  none: ['[data-overlord-control="start"]', '[data-overlord-start-form] input[type="radio"]', '[data-overlord-account-set] input[type="checkbox"]'],
  'failed-start': ['[data-overlord-outcome]', '[data-overlord-control="start"]', '[data-overlord-start-form]'],
  pending: ['[data-overlord-pending]'],
};

function fixtureFor(state: BodyState): AppFixture {
  return {
    fleetFrames: [{ type: 'fleet', sessions: [fleetSession({ id: 'lane-a-overlord', project: 'overlord', bucket: 'idle' })] }],
    api: {
      '/health': { ok: true, build: null, caps: ['overlord-v1'] },
      '/api/overlord/designation': { ok: true, designation: DESIGNATIONS[state] },
      '/api/overlord/ladder': {
        ok: true, operatorRung: 'chat', operatorRungSource: 'set', effectiveRung: 'chat',
        binding: [{ cause: 'unwitnessed-third', kind: 'latch', cap: 'advise', reading: 'standing', known: true }],
        latches: [{ cause: 'unwitnessed-third', cap: 'advise', raisedAt: NOW - 600_000, detail: '', known: true, narrowing: { state: 'done' } }],
        conditions: [{ cause: 'shared-user', reading: 'standing', effect: { kind: 'cap', cap: 'advise' } }],
        readBy: [], lastChange: null,
        rungs: [
          { rung: 'off', available: true, needs: null }, { rung: 'chat', available: true, needs: null },
          { rung: 'advise', available: false, needs: 'overlord-route-v1' }, { rung: 'full', available: false, needs: 'overlord-answer-v1' },
        ],
      },
      '/api/overlord/readiness': READINESS[state],
      '/api/overlord/restore': { ok: true, authority: { kind: 'coherent' } },
      '/api/accounts': {
        accounts: [], projected: null,
        roster: [
          { id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: LONG_POOLS[0], homeAble: true, hidden: false },
          { id: 'lane-b', label: 'lane-b', hue: 'violet', pool: LONG_POOLS[1], homeAble: true, hidden: false },
        ],
      },
      '/api/portfolio': { ok: true, portfolio: { at: NOW, revision: 3, programmes: [entry('prog-a', 'Programme A', 1), entry('prog-b', 'Programme B', 2)] } },
      '/api/pools/runway': {
        ok: true, nowS: NOW_S,
        pools: [
          { pool: 'pool-a', runway: { out: crossing, lines: Object.fromEntries(LOAD_LINES.map((l) => [l, crossing])), earliestReset: { kind: 'none-exhausted' } } },
          { pool: null, runway: { out: { kind: 'unmeasured', why: 'thin' }, lines: Object.fromEntries(LOAD_LINES.map((l) => [l, { kind: 'unmeasured', why: 'thin' }])), earliestReset: { kind: 'unmeasured', why: 'no-sample' } } },
        ],
      },
      '/api/waiting': { ok: true, waiting: { items: [], approvals: [] } },
      '/api/programmes': { programmes: [], closedToday: { operator: 1, sweep: 0, coordinator: 0 }, appliedSince: NOW - 86_400_000 },
    },
  };
}

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [320, 360, 390, 899, 1280] as const;
/** The light palette and the dark one, by the ids the app keeps (`@ccrc/ui`'s `THEMES`): `PHOSPHOR` is the dark palette. */
const PALETTES = ['light', PHOSPHOR] as const;
const STATES: readonly BodyState[] = ['bound', 'restartable', 'none', 'failed-start', 'pending'];

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

/** What the page measures, in the page: every visible control of the place with its box, the readiness label's contrast on
 *  the nearest opaque ground behind it, and the theme the page stamped (`PHOSPHOR` is applied by removing `data-theme`). */
const measure = (phosphor: string): {
  controls: { name: string; w: number; h: number; left: number; right: number }[]; vw: number;
  label: { text: string; ratio: number } | null; theme: string;
} => {
  const rgb = (s: string): number[] => {
    const v = (s.match(/[\d.]+/g) ?? []).map(Number);
    return s.startsWith('color(') ? v.map((n) => n * 255) : v;
  };
  const lum = ([r, g, b]: number[]): number => {
    const ch = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(b!);
  };
  const ratio = (el: Element): number => {
    const k = getComputedStyle(el);
    let bg = k.backgroundColor;
    for (let n: Element | null = el; n !== null && /rgba\(.*,\s*0\)$|transparent/.test(bg); n = n.parentElement) bg = getComputedStyle(n).backgroundColor;
    const [a, b] = [lum(rgb(k.color)), lum(rgb(bg))].sort((x, y) => y - x);
    return (a! + 0.05) / (b! + 0.05);
  };
  const place = document.querySelector('[data-overlord-place]')!;
  const controls = [...place.querySelectorAll<HTMLElement>('button, select, input, a[href]')]
    .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
    .map((el) => {
      // A native checkbox or radio sits inside its label, which is the tap target: measure the label.
      const target = (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) ? (el.closest('label') ?? el) : el;
      const box = target.getBoundingClientRect();
      return {
        name: el.getAttribute('aria-label') ?? target.textContent?.trim() ?? el.tagName, w: box.width, h: box.height, left: box.left, right: box.right,
      };
    });
  // The place's own label: the one-line form beside the Fleet's BuildLine carries the same hook, and comes first in the document
  // at every width, because the fleet column is mounted at every width and only CSS hides it on a phone.
  const word = place.querySelector('[data-readiness-word]');
  return {
    controls,
    vw: document.documentElement.clientWidth,
    label: word === null ? null : { text: word.textContent ?? '', ratio: ratio(word) },
    theme: document.documentElement.getAttribute('data-theme') ?? phosphor,
  };
};

const sideways = (): number => document.documentElement.scrollWidth - document.documentElement.clientWidth;

async function settle(page: Page, drawn: readonly string[]): Promise<void> {
  await page.waitForSelector('[data-overlord-place] [data-readiness-part]', { timeout: 20_000 });
  // The readiness word itself, not only its part (carried 4b): the part draws "Loading…" before the read lands.
  await page.waitForFunction(() => (document.querySelector('[data-overlord-place] [data-readiness-word]')?.textContent ?? '') !== '',
    undefined, { timeout: 20_000 });
  await page.waitForSelector('[data-overlord-place] [data-portfolio-row]', { timeout: 20_000 });
  await page.waitForSelector('[data-overlord-place] [data-rung]', { timeout: 20_000 });
  for (const sel of drawn) await page.waitForSelector(`[data-overlord-place] ${sel}`, { timeout: 20_000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(250); // the first paint's transitions settle
}

async function open(skin: string, theme: string, width: number, state: BodyState = 'bound') {
  const opened = await openApp(browser!, { skin, theme, width }, fixtureFor(state));
  await opened.page.goto(server!.origin + '/overlord');
  await settle(opened.page, DRAWS[state]);
  return opened;
}

/** The checks every case makes, at its width: the stamped theme, no sideways scroll, the tap floor on a phone, the label. */
async function check(page: Page, theme: string, width: number, errors: readonly unknown[]): Promise<void> {
  expect(await page.evaluate(() => location.pathname)).toBe('/overlord');
  expect(await page.evaluate(sideways), 'sideways scroll').toBe(0);
  const m = await page.evaluate(measure, PHOSPHOR);
  expect(m.theme, 'the palette the page stamped is the one asked for').toBe(theme);
  expect(m.controls.length, 'the place draws its controls').toBeGreaterThanOrEqual(6);
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
  // The label is drawn in every state (carried 4b), so its contrast is measured in every one, never skipped.
  expect(m.label, 'the readiness label is drawn').not.toBeNull();
  expect(m.label!.ratio, `the readiness label "${m.label!.text}"`).toBeGreaterThanOrEqual(4.5);
  expect(errors).toEqual([]);
}

describe.each(SKINS)('the Overlord place in %s', (skin) => {
  for (const state of STATES) {
    for (const theme of PALETTES) {
      for (const width of WIDTHS) {
        it(`${state}, at ${width} (${theme}): no sideways scroll, no page error, 44 px controls on a phone, the readiness label at 4.5:1`, async () => {
          const { ctx, page, errors } = await open(skin, theme, width, state);
          try {
            const shots = process.env['CCRC_SHOTS'];
            if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/overlord-place-${skin}-${state}-${theme}-${width}.png`, fullPage: true });
            // Every state draws its readiness word, by the text its read answers (carried 4b).
            expect((await page.evaluate(measure, PHOSPHOR)).label?.text, `${state} draws its readiness word`).toBe(WORD[state]);
            if (state === 'none' || state === 'failed-start') {
              const boxes = await page.$$eval('[data-overlord-account-set] label', (ls) => ls.map((l) => l.textContent?.trim() ?? ''));
              expect(boxes, 'the account set draws both long pool names and untagged').toEqual([...LONG_POOLS, 'Untagged accounts']);
            }
            await check(page, theme, width, errors);
          } finally {
            await ctx.close();
          }
        }, 60_000);
      }
    }
  }
});

describe.each(SKINS)('"Rebind anyway" in %s', (skin) => {
  for (const theme of PALETTES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): a Rebind answered overlord-body-alive draws the offer and its sentence, and they measure as the rest`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width, 'bound');
        try {
          // This case alone answers Rebind with the door's refusal; a later route takes precedence over the harness's own.
          await ctx.route('**/api/overlord/rebind', (route) => route.fulfill({
            status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'overlord-body-alive', detail: 'it measures alive' }),
          }));
          await page.click('[data-overlord-control="rebind"]');
          await page.waitForSelector('[data-overlord-control="rebind-anyway"]', { timeout: 20_000 });
          await page.waitForSelector('[data-overlord-refusal]', { timeout: 20_000 });
          await check(page, theme, width, errors);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});

describe.each(SKINS)('the portfolio strip\'s rank control in %s', (skin) => {
  const order = (): string[] => [...document.querySelectorAll('[data-portfolio-row]')].map((r) => r.getAttribute('data-portfolio-row') ?? '');
  for (const width of [320, 360] as const) {
    it(`at ${width}: a tap reorders the strip with no sideways scroll`, async () => {
      const { ctx, page, errors } = await open(skin, 'light', width);
      try {
        expect(await page.evaluate(order)).toEqual(['prog-a', 'prog-b']);
        await page.click('[aria-label="Move Programme B up"]');
        expect(await page.evaluate(order)).toEqual(['prog-b', 'prog-a']);
        expect(await page.evaluate(sideways), 'sideways scroll after the move').toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);

    it(`at ${width}: the rank control is reachable and usable by keyboard alone`, async () => {
      const { ctx, page, errors } = await open(skin, 'light', width);
      try {
        await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
        let reached = false;
        for (let i = 0; i < 200 && !reached; i++) {
          await page.keyboard.press('Tab');
          reached = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Move Programme B up');
        }
        expect(reached, 'Tab reaches "Move Programme B up"').toBe(true);
        await page.keyboard.press('Enter');
        expect(await page.evaluate(order)).toEqual(['prog-b', 'prog-a']);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
