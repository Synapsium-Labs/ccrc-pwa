// Instrument's round `+` is the one New session door below 900 and is not mounted at the desk (desktop-polish T2b,
// D-6328), in a real Chrome over the production build.
//
// What it pins: at 899 Instrument shows ONE visible New session door, the round `.fab`, carrying
// `data-command="new-session"` and not inside the top bar; at 900 and 1280 there is no `.fab` and ONE visible door,
// the top bar's `+`, inside `header.shell-accounts`. What jsdom cannot hold: a real engine's media query at the 899/900
// boundary, and what the engine calls visible. A door counts only when it has a laid-out box (a non-zero client rect)
// AND the browser's own `checkVisibility` (with `visibility` and `opacity`) says it is visible, so a second door that
// is mounted but hidden (`visibility: hidden` or `opacity: 0`) or laid out off-screen is not counted: a hidden round `+`
// at 899 reds (the one door is gone), and so does a duplicate door at the desk.
//
// MUTATION TABLE (each mutant is transient; the file it touches is restored from a saved copy and `git diff` is empty after):
//   V   `@media (max-width: 899.98px) { .fab { visibility: hidden } }` appended to fleet.css: the round + is mounted at 899
//       but hidden. It PASSED the previous version of this file (which counted any non-zero client rect), 2 of 2 at 899.
//       -> RED at 899 in both palettes (two cases; `-t "899px"`): { doors: 0, fabs: 1, fabIsDoor: false, inTopBar: false }
//          for { doors: 1, fabs: 1, fabIsDoor: true, inTopBar: false }.
//   F1  PhoneFab mounted at every width (returns the button unconditionally)
//       -> RED at 900 and 1280 in both palettes (four cases; `-t "(900|1280)px"`): { doors: 2, fabs: 1, fabIsDoor: false,
//          inTopBar: false } for { doors: 1, fabs: 0, fabIsDoor: false, inTopBar: true }.
//   F2  PhoneFab gated on `useMediaQuery('(min-width: 600px)')` in place of `useDesk()`
//       -> RED at 899 in both palettes (two cases; `-t "899px"`): { doors: 0, fabs: 0, fabIsDoor: false, inTopBar: false }
//          for { doors: 1, fabs: 1, fabIsDoor: true, inTopBar: false } (the top bar's + is not visible below 900).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts --maxWorkers=2 browser/instrument-fab.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const THEMES = [PHOSPHOR, 'light'];
const VIEWS: AppView[] = THEMES.flatMap((theme) => [899, 900, 1280].map((width) => ({ skin: INSTRUMENT, theme, width })));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

/** No `/api/updates`, so no update row; an empty feed; nine sessions over three projects. */
const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] } },
  fleetFrames: [
    {
      type: 'fleet',
      sessions: Array.from({ length: 9 }, (_, i) => fleetSession({
        id: `s${i}`, project: `proj-${i % 3}`, bucket: i === 0 ? 'attention' : 'idle',
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

describe("Instrument's round + is the one New session door below 900, and absent at the desk", () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/');
        // Wait on the fleet alone, never on a door: a missing door is MEASURED below (doors: 0), not hidden behind a timeout.
        await page.waitForFunction(() => document.body.innerText.includes('9 sessions'), undefined, { timeout: 20_000 });
        const seen = await page.evaluate(() => {
          // Visible is the engine's own word for it: a laid-out box AND not `visibility: hidden`, not `opacity: 0`.
          const visible = (el: Element): boolean => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
          };
          const doors = [...new Set(document.querySelectorAll('[data-command="new-session"], [aria-label="New session"]'))].filter(visible);
          const door = doors.length === 1 ? doors[0]! : null;
          return {
            doors: doors.length,
            fabs: document.querySelectorAll('.fab').length,
            fabIsDoor: door !== null && door.matches('.fab[data-command="new-session"]'),
            inTopBar: door !== null && door.closest('header.shell-accounts') !== null,
          };
        });
        expect(seen).toEqual(view.width < 900
          ? { doors: 1, fabs: 1, fabIsDoor: true, inTopBar: false }
          : { doors: 1, fabs: 0, fabIsDoor: false, inTopBar: true });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
