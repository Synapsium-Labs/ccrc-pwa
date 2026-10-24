// What one `/ws/fleet` frame costs the page's main thread, in a real Chrome over the production build (D-6438; desktop
// polish Task C6). The fleet socket sends the WHOLE session list on every change, and the app re-renders from it, so a
// fleet of 80 rows with about nine changing per frame is the load this file puts on it, and `frameCost`
// (`browser/app.ts`) reads Chrome's `TaskDuration` over the 2 s after each frame (CDP `Performance.getMetrics`).
//
// - The gated case: in Refined and in Instrument at 1920, the median cost of 15 changing frames on `/` stays under
//   `FRAME_CEILING_MS`. The fixture is READY before it is measured: the rows are drawn (not only received), the page has
//   no sideways scroll and threw nothing.
// - The measurement block runs only on demand (`CCRC_MEASURE=1`): 8 configurations (`/` and a long session, in both
//   skins, at 1920 and 390), each 15 changing frames, one identical frame and one idle window, one console line each.
//   When `CCRC_RENDERS` names a directory the same block also writes the viewport screenshots there (both pages, both
//   skins, Phosphor and light, 360 / 390 / 1280 / 1920), with the page clock fixed, for a before/after comparison.
//   No timing assertion in the block: the numbers go to the console and the PR body.
//
// Neutral names only (`project-a`, `lane-a`, `ws-<n>`); the fixture is deterministic (`fleetFixture`).
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/frame-cost.browser.test.ts )`.
// Measure: the same with `CCRC_MEASURE=1 --silent=false --reporter=verbose -t measurement` (both flags, or a passing
// test prints nothing); add `CCRC_RENDERS=<a directory outside the work tree>` for the screenshots.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import {
  backlogFrame, buildDist, fleetApi, fleetFixture, fleetFrame, fleetFrameAt, FIXTURE_NOW_MS, frameCost, longTranscript, openApp,
  removeDist, serveDist, summarize, type AppFixture, type AppView, type DistServer, type OpenedApp,
} from './app';

/** PROVISIONAL, about twice the BEFORE median of Refined and Instrument at 1920 (C6 Step 0: 185 and 176 ms per frame,
 *  measured at a load average near 50, the gated case itself 229 for Refined); the parent rewrites this value and
 *  this comment from the AFTER measurement. */
const FRAME_CEILING_MS = 400;

const ROWS = 80;
const FRAMES = 15;
const GAP_MS = 2000;
const SESSION_ID = 'ws-3';
const SESSION_PATH = `/ws/session/${SESSION_ID}`;

const DATA = fleetFixture(ROWS);
const fixture = (): AppFixture => ({
  api: fleetApi(DATA),
  fleetFrames: [fleetFrame(DATA.sessions)],
  socketFrames: { [SESSION_PATH]: [backlogFrame(longTranscript(200))] },
});
const changing = (): object[] => Array.from({ length: FRAMES }, (_, i) => fleetFrame(fleetFrameAt(DATA.sessions, i + 1)));

const RENDERS = process.env['CCRC_RENDERS'] ?? '';
/** Chrome flags for the render captures only (never for a cost measure): one raster thread, no GPU raster, sRGB output
 *  and grey-scale text, so two captures of one build agree to the byte. The render block launches its OWN browser with
 *  them; the one above, which every cost case uses, never gets them. */
const RENDER_ARGS = ['--disable-gpu', '--disable-gpu-rasterization', '--num-raster-threads=1', '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'];

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = buildDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true }); // never with RENDER_ARGS: the cost cases run on a stock Chrome
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  removeDist(dist);
});

// ---- readiness -----------------------------------------------------------------------------------------------------
// Both skins draw a session as `.sess-line` (Refined inside its project cards, Instrument in its status table; folded
// groups draw none, so the count is a fraction of 80). Three rows that no fold hides in either skin (a working row, an
// asking row, another working row) must be in the DOM, each found by the EXACT text of its name button (`.sess-open`),
// so 'task 5' is not satisfied by 'task 50'; the count must then hold still for half a second, and a session route
// must also have drawn its transcript (`.chat-item`). DOM presence, not visibility: at 390 a session route hides the
// list with CSS, and its rows must still count.
const READY_NAMES = ['task 0', 'task 5', 'task 78'] as const;

async function ready(page: Page, session: boolean): Promise<number> {
  await page.waitForFunction(([names, chat]) => {
    const lines = [...document.querySelectorAll('.sess-line')];
    const named = names.every((n) => lines.some((l) => (l.querySelector('.sess-open')?.textContent ?? '').trim() === n));
    return named && (!chat || document.querySelectorAll('.chat-item').length > 0);
  }, [READY_NAMES, session] as const, { timeout: 30_000 });
  const count = (): Promise<number> => page.evaluate(() => document.querySelectorAll('.sess-line').length);
  for (let settled = await count(); ; ) {
    await page.waitForTimeout(500);
    const now = await count();
    if (now === settled) return now;
    settled = now;
  }
}

const sideScroll = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function boot(view: AppView, route: string): Promise<{ app: OpenedApp; rows: number }> {
  const app = await openApp(browser!, view, fixture());
  await app.page.goto(server!.origin + route);
  const rows = await ready(app.page, route !== '/');
  // A transcript's markdown and code blocks finish after the rows are in the DOM: let that work end, so the idle window
  // measures a page at rest.
  await app.page.waitForTimeout(1500);
  return { app, rows };
}

// ---- the gate ------------------------------------------------------------------------------------------------------

describe('frame cost (D-6438)', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`a fleet frame of ${ROWS} rows on / costs under the ceiling (${skin}, 1920)`, async () => {
      const { app } = await boot({ skin, theme: PHOSPHOR, width: 1920 }, '/');
      try {
        expect(app.errors).toEqual([]);
        expect(await sideScroll(app.page)).toBeLessThanOrEqual(0);
        const cost = await frameCost(app, '/ws/fleet', changing(), GAP_MS);
        expect(cost.frames).toHaveLength(FRAMES);
        expect(app.errors).toEqual([]);
        expect(cost.median.taskMs, `median TaskDuration per frame, ${skin}: ${cost.median.taskMs.toFixed(1)} ms`).toBeLessThan(FRAME_CEILING_MS);
      } finally {
        await app.ctx.close();
      }
    }, 90_000);
  }
});

// ---- on demand -----------------------------------------------------------------------------------------------------

const MEASURE = process.env['CCRC_MEASURE'] === '1';
const ms = (n: number): string => n.toFixed(1);

describe('measurement — C6 Step 0/4', () => {
  const PAGES = [{ name: 'fleet', route: '/' }, { name: 'session', route: `/s/${SESSION_ID}` }] as const;

  for (const pg of PAGES) {
    for (const skin of [REFINED, INSTRUMENT]) {
      for (const width of [1920, 390]) {
        it.runIf(MEASURE)(`${pg.name} ${skin} ${width}px: ${FRAMES} changing frames, one identical, one idle window`, async () => {
          const { app, rows } = await boot({ skin, theme: PHOSPHOR, width }, pg.route);
          try {
            const frames = changing();
            const cost = await frameCost(app, '/ws/fleet', [...frames, frames.at(-1)], GAP_MS);
            const changed = cost.frames.slice(0, FRAMES);
            const same = cost.frames[FRAMES]!;
            const { median, mean } = summarize(changed);
            console.log(`[C6 frame cost] ${pg.name} ${skin} ${width}px rows-drawn=${rows} | idle task ${ms(cost.idle.taskMs)} script ${ms(cost.idle.scriptMs)}`
              + ` | frame median task ${ms(median.taskMs)} script ${ms(median.scriptMs)} (mean task ${ms(mean.taskMs)} script ${ms(mean.scriptMs)})`
              + ` | identical task ${ms(same.taskMs)} script ${ms(same.scriptMs)} | errors ${app.errors.length}`);
            expect(app.errors).toEqual([]);
          } finally {
            await app.ctx.close();
          }
        }, 180_000);
      }
    }
  }

  // The renders have a browser of their own, launched with RENDER_ARGS and closed here (only when CCRC_RENDERS is set),
  // so a run that measures cost and takes the captures together still measures cost on a stock Chrome.
  let renderBrowser: Browser | undefined;
  beforeAll(async () => {
    if (RENDERS === '') return;
    renderBrowser = await chromium.launch({ executablePath: resolveChrome(), headless: true, args: RENDER_ARGS });
  }, 60_000);
  afterAll(async () => {
    await renderBrowser?.close();
  });

  // The renders: viewport only, the clock fixed (Date, not the timers) at the fixture's own "now", fonts loaded, reduced
  // motion, and no caret or animation, so two captures of one build are the same bytes.
  for (const pg of PAGES) {
    for (const skin of [REFINED, INSTRUMENT]) {
      for (const theme of [PHOSPHOR, 'light']) {
        for (const width of [360, 390, 1280, 1920]) {
          it.runIf(RENDERS !== '')(`render ${pg.name}-${skin}-${theme}-${width}`, async () => {
            const app = await openApp(renderBrowser!, { skin, theme, width }, fixture());
            try {
              await app.page.emulateMedia({ reducedMotion: 'reduce' });
              await app.page.clock.setFixedTime(FIXTURE_NOW_MS);
              await app.page.goto(server!.origin + pg.route);
              await ready(app.page, pg.name === 'session');
              // Fonts loaded, every running animation or transition finished, then two painted frames: a raster caught
              // mid-transition differs from the next by a level in one channel.
              await app.page.evaluate(async () => {
                await document.fonts.ready;
                await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
                await new Promise<void>((done) => { requestAnimationFrame(() => { requestAnimationFrame(() => { done(); }); }); });
              });
              await app.page.waitForTimeout(1000);
              // A transcript that is still laying out (a code block's highlight, a late font metric) moves the pinned
              // scroll position: wait until the scroller's offset and height stop changing.
              // Then pin it to the bottom ourselves, so the final offset is a fact of the page and not of the race.
              await app.page.evaluate(() => { const el = document.querySelector('.chat-scroller'); if (el !== null) el.scrollTop = el.scrollHeight; });
              for (let last = '', same = 0; same < 3;) {
                const now = await app.page.evaluate(() => {
                  const el = document.querySelector('.chat-scroller');
                  return el === null ? 'none' : `${el.scrollTop}/${el.scrollHeight}`;
                });
                same = now === last ? same + 1 : 0;
                last = now;
                await app.page.waitForTimeout(300);
              }
              mkdirSync(RENDERS, { recursive: true });
              await app.page.screenshot({
                path: path.join(RENDERS, `${pg.name}-${skin}-${theme}-${width}.png`), fullPage: false, animations: 'disabled', caret: 'hide',
              });
              expect(app.errors).toEqual([]);
              expect(await sideScroll(app.page)).toBeLessThanOrEqual(0);
            } finally {
              await app.ctx.close();
            }
          }, 90_000);
        }
      }
    }
  }
});
