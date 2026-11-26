// The Overlord's place in a real Chrome over the production build (Overlord W1 home B, Tasks 4 to 6; plan Global
// Constraints, "Phone first"). The place is drawn only under `overlord-v1`, so the fixture names the word on `/health` and
// answers every read the place makes: the designation (a bound Overlord), the ladder (rows above `chat` unavailable, one
// latch, one condition), the readiness word, the portfolio (two programmes), the pools' runway, Waiting on you and the
// programmes read, and the authority guard's state.
//
// At 320, 360, 390, 899 and 1280 px, in both skins and in a light and a dark palette:
// - nothing scrolls sideways, and the page throws nothing;
// - every control of the place is at least 44 px tall and 44 px wide at 320 px (and at every phone width);
// - the readiness word's status label reads at 4.5:1 or better on the ground drawn behind it, measured in the page.
// At 320 and 360 px: the portfolio strip's rank control reorders the strip with no sideways scroll, and it is reachable and
// usable by keyboard alone (Tab to a Move button, Enter).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/overlord-place.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
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

const FIXTURE: AppFixture = {
  fleetFrames: [{ type: 'fleet', sessions: [fleetSession({ id: 'lane-a-overlord', project: 'overlord', bucket: 'idle' })] }],
  api: {
    '/health': { ok: true, build: null, caps: ['overlord-v1'] },
    '/api/overlord/designation': {
      ok: true,
      designation: {
        bound: { sessionId: 'lane-a-overlord', generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus',
        accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [],
      },
    },
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
    '/api/overlord/readiness': {
      word: 'ready', since: NOW - 1_800_000, why: null, until: null, questionsGo: 'operator', restartable: false, strandCause: null,
    },
    '/api/overlord/restore': { ok: true, authority: { kind: 'coherent' } },
    '/api/portfolio': { ok: true, portfolio: { at: NOW, revision: 3, programmes: [entry('prog-a', 'Programme A', 1), entry('prog-b', 'Programme B', 2)] } },
    '/api/pools/runway': {
      ok: true, nowS: NOW_S,
      pools: [
        { pool: 'pool-a', runway: { out: crossing, lines: Object.fromEntries(LOAD_LINES.map((l) => [l, crossing])), earliestReset: { kind: 'none-exhausted' } } },
        { pool: null, runway: { out: { kind: 'unmeasured', why: 'thin' }, lines: Object.fromEntries(LOAD_LINES.map((l) => [l, { kind: 'unmeasured', why: 'thin' }])), earliestReset: { kind: 'unmeasured', why: 'no-sample' } } },
      ],
    },
    '/api/waiting': { ok: true, waiting: { items: [], approvals: [] } },
    '/api/programmes': { programmes: [], closedToday: { operator: 1, sweep: 0, coordinator: 0 } },
  },
};

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [320, 360, 390, 899, 1280] as const;
const PALETTES = ['light', 'dark'] as const;

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

/** What the page measures, in the page: every visible control of the place with its box, and the readiness label's contrast
 *  on the nearest opaque ground behind it. */
const measure = (): { controls: { name: string; w: number; h: number }[]; label: { text: string; ratio: number } | null } => {
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
      return { name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName, w: box.width, h: box.height };
    });
  const word = document.querySelector('[data-readiness-word]');
  return { controls, label: word === null ? null : { text: word.textContent ?? '', ratio: ratio(word) } };
};

const sideways = (): number => document.documentElement.scrollWidth - document.documentElement.clientWidth;

async function open(skin: string, theme: string, width: number) {
  const opened = await openApp(browser!, { skin, theme, width }, FIXTURE);
  await opened.page.goto(server!.origin + '/overlord');
  await opened.page.waitForSelector('[data-overlord-place] [data-readiness-word]', { timeout: 20_000 });
  await opened.page.waitForSelector('[data-overlord-place] [data-portfolio-row]', { timeout: 20_000 });
  await opened.page.waitForSelector('[data-overlord-place] [data-rung]', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250); // the first paint's transitions settle
  return opened;
}

describe.each(SKINS)('the Overlord place in %s', (skin) => {
  for (const theme of PALETTES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): no sideways scroll, no page error, 44 px controls on a phone, the readiness label at 4.5:1`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/overlord-place-${skin}-${theme}-${width}.png`, fullPage: true });
          expect(await page.evaluate(() => location.pathname)).toBe('/overlord');
          expect(await page.evaluate(sideways), 'sideways scroll').toBe(0);
          const m = await page.evaluate(measure);
          expect(m.controls.length, 'the place draws its controls').toBeGreaterThanOrEqual(6);
          if (width < 900) {
            for (const c of m.controls) {
              expect(c.h, `"${c.name}" is at the tap floor`).toBeGreaterThanOrEqual(44);
              expect(c.w, `"${c.name}" is at the tap floor`).toBeGreaterThanOrEqual(44);
            }
          }
          expect(m.label, 'the readiness word is drawn').not.toBeNull();
          expect(m.label!.ratio, `the readiness label "${m.label!.text}"`).toBeGreaterThanOrEqual(4.5);
          expect(errors).toEqual([]);
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
