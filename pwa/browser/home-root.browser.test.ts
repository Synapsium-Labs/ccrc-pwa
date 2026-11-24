// The console's root, `/`, in a real Chrome over the production build (Overlord W1 home, Task 2; review 3319 F1). These are the
// suite's intentional root entries: every other case that means the Fleet opens `/fleet`.
//
// - With no Overlord (the harness's default `/health`, no capability word), the bare origin replaces itself with `/fleet`:
//   the Fleet draws, and the replace leaves no `/` in the tab's history: Back leaves the app (to the context's first entry,
//   `about:blank`), never returns to `/`. Both skins, a phone and a desk.
// - With a designated Overlord, the bare origin replaces itself with `/overlord`, the same way.
// - THE RACE (review 3319 F1). `navigate` runs its history call inside a view transition, which the browser runs a frame
//   later. The home's replace, held there, must never land over a navigation made meanwhile. An init script holds the page's
//   FIRST view transition's update for 800 ms (the home's replace, recorded with the path it was asked from); the case taps
//   the Runs tab while it waits, then waits for the held update to run, and the page must still be on `/runs`. Before
//   `navigate`'s `from` guard, the late replace rewrote the entry to `/fleet` and drew the Fleet over the Runs screen
//   (lazy-screens and accounts-cards failed this way at 515c82f3).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/home-root.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const FIXTURE: AppFixture = {
  api: {},
  fleetFrames: [{ type: 'fleet', sessions: [fleetSession({ id: 'lane-a-one', project: 'project-a', bucket: 'idle' })] }],
};
const FIXTURE_OVERLORD: AppFixture = {
  ...FIXTURE,
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
      ok: true, operatorRung: 'chat', operatorRungSource: 'set', effectiveRung: 'chat', binding: [], latches: [], conditions: [],
      readBy: [], lastChange: null, rungs: [],
    },
  },
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

describe('the bare origin is the home', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    for (const width of [390, 1280]) {
      it(`${skin}, ${width}px, no Overlord: / replaces itself with /fleet, the Fleet draws, and Back never returns to /`, async () => {
        const { ctx, page, errors } = await openApp(browser!, { skin, theme: 'light', width }, FIXTURE);
        try {
          await page.goto(server!.origin + '/');
          await page.waitForFunction(() => location.pathname === '/fleet', undefined, { timeout: 20_000 });
          await page.waitForSelector('.app-shell[data-view="fleet"] .shell-nav', { timeout: 20_000 });
          await page.waitForTimeout(500); // a late second replace, if any, would land here
          expect(await page.evaluate(() => location.pathname)).toBe('/fleet');
          expect(errors).toEqual([]);
          await page.goBack();
          expect(page.url(), 'Back leaves the app: the replace left no / entry').toBe('about:blank');
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }

  it('refined, 1280px, a designated Overlord: / replaces itself with /overlord, the place draws, and Back never returns to /', async () => {
    const { ctx, page, errors } = await openApp(browser!, { skin: REFINED, theme: 'light', width: 1280 }, FIXTURE_OVERLORD);
    try {
      await page.goto(server!.origin + '/');
      await page.waitForFunction(() => location.pathname === '/overlord', undefined, { timeout: 20_000 });
      await page.waitForSelector('.shell-detail h1', { timeout: 20_000 });
      expect(await page.evaluate(() => document.querySelector('.shell-detail h1')!.textContent)).toBe('Overlord');
      expect(errors).toEqual([]);
      await page.goBack();
      expect(page.url(), 'Back leaves the app: the replace left no / entry').toBe('about:blank');
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

describe("the home's replace, held by its view transition, never lands over a tap made meanwhile (review 3319 F1)", () => {
  it('refined, 1280px: / is decided, its replace waits 800 ms in its transition, a tap opens Runs, and Runs stays', async () => {
    const { ctx, page, errors } = await openApp(browser!, { skin: REFINED, theme: 'light', width: 1280 }, FIXTURE);
    try {
      await ctx.addInitScript(() => {
        const w = window as unknown as { __held: string };
        w.__held = 'none';
        const proto = Document.prototype as unknown as { startViewTransition?: (update: () => unknown) => unknown };
        const original = proto.startViewTransition;
        if (typeof original !== 'function') { w.__held = 'no-view-transitions'; return; }
        let first = true;
        proto.startViewTransition = function (this: Document, update: () => unknown) {
          if (!first) return original.call(this, update);
          first = false;
          return original.call(this, () => {
            w.__held = `held:${location.pathname}`;
            return new Promise<void>((done) => { setTimeout(() => { update(); w.__held = 'ran'; done(); }, 800); });
          });
        };
      });
      await page.goto(server!.origin + '/');
      // The first transition is the home's replace, asked from `/`; a Chrome with no view transitions is red, never a pass.
      // Polled on a timer: a view transition suppresses rendering, so the default animation-frame polling would stall until
      // it ends, after the held update has run.
      await page.waitForFunction(() => (window as unknown as { __held: string }).__held !== 'none', undefined, { timeout: 20_000, polling: 25 });
      expect(await page.evaluate(() => (window as unknown as { __held: string }).__held)).toBe('held:/');
      // A tap on the Runs tab while the replace waits (a DOM click: the page is mid-transition, so no hit test).
      await page.evaluate(() => { document.querySelector<HTMLElement>('.ref-tabs [data-command="go-runs"]')!.click(); });
      await page.waitForFunction(() => location.pathname === '/runs', undefined, { timeout: 20_000, polling: 25 });
      expect(await page.evaluate(() => (window as unknown as { __held: string }).__held), 'the tap landed while the replace waited').toBe('held:/');
      await page.waitForFunction(() => (window as unknown as { __held: string }).__held === 'ran', undefined, { timeout: 20_000, polling: 25 });
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({
        path: location.pathname,
        view: document.querySelector('.app-shell')?.getAttribute('data-view') ?? null,
        current: [...document.querySelectorAll('header [aria-current="page"]')].map((d) => d.getAttribute('data-command')),
      }));
      expect(after, 'the late replace did nothing: the page is where the tap took it').toEqual({ path: '/runs', view: 'session', current: ['go-runs'] });
      // Two overlapping transitions are this case's point: Chrome skips the first when the tap starts the second and rejects
      // its `ready` promise, which `navigate` has never held (any two moves within a frame raise it). That rejection, at most
      // once, is the scenario's own; any other page error fails the case.
      expect(errors.filter((e) => e !== 'Transition was skipped. New ViewTransition started')).toEqual([]);
      expect(errors.length).toBeLessThanOrEqual(1);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
