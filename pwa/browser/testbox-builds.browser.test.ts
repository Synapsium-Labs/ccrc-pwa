// Settings › Automation › Test box › Claude Code builds (D-8289), in a real Chrome over the production build, at phone, laptop
// and wide widths. `src/fleet/TestBoxBuilds.test.tsx` holds the list's behaviour in jsdom; this file holds what only an engine
// can say: every row sits inside the card, the replay output wraps inside its block once its disclosure opens (a long line
// never pushes the card or the page sideways), Capture again is as wide as its row on a phone and its own width otherwise,
// and it posts `{build}` only.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd, no test box, no Claude Code. Run: `( cd pwa &&
// CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/testbox-builds.browser.test.ts )`. `CCRC_SHOTS=<a directory>` keeps one picture per width.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { ClaudeBuildRecord } from '../../shared/claudeBuildTrust';
import { TESTBOX_BUILDS_TEXT } from '../src/fleet/TestBoxBuilds';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly (AppView & { readonly band: 'phone' | 'laptop' | 'wide' })[] = [
  { band: 'phone', skin: REFINED, theme: PHOSPHOR, width: 390 },
  { band: 'laptop', skin: INSTRUMENT, theme: 'light', width: 1280 },
  { band: 'wide', skin: INSTRUMENT, theme: PHOSPHOR, width: 1920 },
];
const named = (v: (typeof VIEWS)[number]): string => `${v.band}: ${v.skin}, ${v.theme}, ${v.width}px`;

const T = TESTBOX_BUILDS_TEXT;
const TITLE = SETTINGS_CARDS.automation.testbox.title;
const rec = (build: string, over: Partial<ClaudeBuildRecord> = {}): ClaudeBuildRecord => ({
  build, source: 'fleet', capture: 'queued', cwd: false, seenAt: Date.now() - 7_200_000, attempts: 0, lastAttemptAt: null,
  notSent: null, verdictAt: null, output: null, ...over,
});
const LONG_LINE = `Stop payload: ${'background_tasks_field_missing_'.repeat(12)}end`;
const BUILDS: ClaudeBuildRecord[] = [
  rec('2.1.321', { capture: 'fail', attempts: 1, verdictAt: 1, output: `replay: 39 passed, 1 failed\n${LONG_LINE}` }),
  // Tried with no capture runner on the box: the row says it was not sent, and the card says no build can be captured.
  rec('2.1.320', { lastAttemptAt: 5, notSent: 'no-runner' }),
  rec('2.1.302', { source: 'rig', capture: 'pass', cwd: true, seenAt: 0, verdictAt: 0 }),
];
const BLOCK = {
  state: 'off', reasons: [], summary: 'off', switch: 'off', at: Date.now(), host: null, box: null, cells: [], counts: null,
};
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
  },
  fleetFrames: [
    { type: 'fleet', sessions: [] },
    { type: 'runs', runs: [] },
    { type: 'coord', coord: { pause: 'clear' } },
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

interface Box { left: number; right: number; top: number; bottom: number; width: number }
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  card: Box;
  rows: Box[];
  failedRow: Box;
  blocked: Box | null;
  button: Box | null;
  log: Box | null;
  logScroll: { scrollWidth: number; clientWidth: number } | null;
  overflowing: string[];
}

/** The card's builds, measured in the page. */
const measure = (el: Element): Measured => {
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  };
  const shown = (e: Element | null): Box | null => (e === null || !e.checkVisibility({ contentVisibilityAuto: true }) ? null : box(e));
  const list = el.querySelector('[data-testbox="builds"]');
  if (list === null) throw new Error('the card has no build list');
  const failed = list.querySelector('[data-build="2.1.321"]')!;
  const log = failed.querySelector('pre');
  return {
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    card: box(el),
    rows: [...list.querySelectorAll('[data-build]')].map(box),
    failedRow: box(failed),
    blocked: shown(list.querySelector('[data-testbox="builds-blocked"]')),
    button: shown(failed.querySelector('[data-testbox="capture-again"]')),
    log: shown(log),
    logScroll: log === null ? null : { scrollWidth: log.scrollWidth, clientWidth: log.clientWidth },
    overflowing: [...el.querySelectorAll('*')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')
      .map((e) => e.tagName.toLowerCase() + (e.getAttribute('data-testbox') ?? e.getAttribute('data-build') ?? '')),
  };
};

describe('Settings › Automation › Test box › Claude Code builds at phone, laptop and wide (D-8289)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      const posts: unknown[] = [];
      await ctx.route('**/api/testbox', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, testbox: BLOCK }) }));
      await ctx.route('**/api/testbox/builds', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, claudeBuilds: BUILDS }) }));
      await ctx.route('**/api/testbox/builds/capture', async (r) => {
        posts.push(r.request().postDataJSON());
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, claudeBuilds: [rec('2.1.321', { attempts: 1 }), ...BUILDS.slice(1)] }) });
      });
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: TITLE });
        await expect.poll(() => section.locator('[data-build]').count(), { timeout: 20_000 }).toBe(3);
        const m = await section.evaluate(measure);
        expect(m.rows).toHaveLength(3);
        for (const r of m.rows) {
          expect(r.left, 'a row starts outside the card').toBeGreaterThanOrEqual(m.card.left - 0.5);
          expect(r.right, 'a row runs past the card').toBeLessThanOrEqual(m.card.right + 0.5);
        }
        expect(m.blocked, 'the card says no build can be captured').not.toBeNull();
        expect(m.blocked!.left, 'the not-capturable note starts outside the card').toBeGreaterThanOrEqual(m.card.left - 0.5);
        expect(m.blocked!.right, 'the not-capturable note runs past the card').toBeLessThanOrEqual(m.card.right + 0.5);
        expect(m.log, 'the replay output is behind its disclosure').toBeNull();
        expect(m.button, 'a failed build shows Capture again').not.toBeNull();
        if (view.band === 'phone') {
          expect(Math.abs(m.button!.width - m.failedRow.width), 'Capture again is full-width on a phone').toBeLessThanOrEqual(1);
        } else {
          expect(m.button!.width, 'Capture again is its own width').toBeLessThan(m.failedRow.width / 2);
        }

        await section.getByText(T.output).click();
        const opened = await section.evaluate(measure);
        const shots = process.env.CCRC_SHOTS;
        if (shots) await section.screenshot({ path: path.join(shots, `testbox-builds-${view.band}-${view.width}.png`) });
        expect(opened.log, 'the output shows once its disclosure opens').not.toBeNull();
        expect(opened.log!.right, 'the output runs past its row').toBeLessThanOrEqual(opened.failedRow.right + 0.5);
        expect(opened.logScroll!.scrollWidth, 'the output scrolls sideways').toBeLessThanOrEqual(opened.logScroll!.clientWidth + 1);
        expect(opened.overflowing, 'an element inside the card scrolls sideways').toEqual([]);
        expect(opened.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(opened.pageClientWidth);

        await section.getByRole('button', { name: T.again }).click();
        await expect.poll(() => posts.length, { timeout: 10_000 }).toBe(1);
        expect(posts).toEqual([{ build: '2.1.321' }]);
        await expect.poll(() => section.getByText(T.queuedAgain).count(), { timeout: 10_000 }).toBe(1);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
