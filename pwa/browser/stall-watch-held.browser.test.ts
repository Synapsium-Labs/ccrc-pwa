// Settings › Automation › Stall watch, held by its override markers (D-8339), in a real Chrome over the production build,
// at 360, 390, 1280 and 1920 in both skins. `test/settings-screen.test.tsx` holds the lines in jsdom; this file holds what
// only an engine can say: while the kill switch and the strict gate both hold the watch, every held line, the strict
// gate's line on what it does and each marker's remedy is on screen, whole, wrapped inside the card (never cut short,
// never past its edge), and nothing on the page scrolls sideways.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. `GET /api/coord/stall-watch` answers one view
// whose chosen level is held by both markers. Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary>
// ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/stall-watch-held.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { STALL_SECTION_TEXT, type StallWatchView } from '../../shared/api';
import { stallNowLines } from '../src/screens/StallWatchSection';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [360, 390, 1280, 1920].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const DOOR = '/api/coord/stall-watch';
const H = 3_600_000;

/** A chosen All held by both markers: the longest Now block the card draws for a hold. */
const HELD: StallWatchView = {
  chosen: { level: 'all', quietMs: 'default', updatedAt: 1_000, stored: 'row' },
  effective: {
    measured: true, level: 'off', files: 'off', source: 'held',
    stages: { runs: false, checks: false, alerts: false, busyDelivery: false, busyGate: false, wave2: false },
    held: { watchOff: true, mailOff: false, gateStrict: true, wave2HeldByStrict: true },
    next: { kind: 'none' }, filesExceed: false,
  },
  quiet: { effectiveMs: 2 * H, builtInMs: 2 * H, minMs: H / 2, maxMs: 12 * H, stepMs: H / 2, source: 'default' },
  notices: {
    ok: true, since: 0, windowMs: 48 * H,
    counts: [
      { row: 'checks', sent: 0, shadow: 0 }, { row: 'wakes', sent: 0, shadow: 0 },
      { row: 'reports', sent: 0, shadow: 0 }, { row: 'pushes', sent: 0, shadow: 0 },
    ],
  },
  fallback: null,
};

/** The lines the hold adds, read from the section's own pure half, so the words are never copied here. */
const HELD_LINES = stallNowLines(HELD).map((l) => l.text)
  .filter((t) => /stall-watch-disabled|mail-gate-strict|idle sessions only/.test(t));

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

interface Box { left: number; right: number; top: number; bottom: number }
interface Line { text: string; box: Box; scrollWidth: number; clientWidth: number; clipped: boolean }
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  section: { scrollWidth: number; clientWidth: number; box: Box };
  lines: Line[];
}

describe('Settings › Automation › Stall watch held by its markers, at every width, in both skins (D-8339)', () => {
  it('CONTROL: the hold adds five lines — two held lines, the strict gate\'s effect, two remedies', () => {
    expect(HELD_LINES).toHaveLength(5);
  });

  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      await ctx.route(`**${DOOR}`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HELD) }));
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: STALL_SECTION_TEXT.title });
        for (const line of HELD_LINES) {
          await expect.poll(() => section.getByText(line, { exact: true }).isVisible(), { timeout: 20_000 }).toBe(true);
        }
        // No control for either marker: the card's only buttons are none, its radios the levels'.
        expect(await section.getByRole('button').count(), 'the card offers a button').toBe(0);
        expect(await section.getByRole('switch').count(), 'the card offers a switch').toBe(0);
        expect(await section.getByRole('checkbox').count(), 'the card offers a checkbox').toBe(0);

        const m = await section.evaluate((el, wanted): Measured => {
          const box = (e: Element): Box => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const ps = [...el.querySelectorAll('p')].filter((p) => wanted.includes(p.textContent ?? ''));
          return {
            viewport: window.innerWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            pageClientWidth: document.documentElement.clientWidth,
            section: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, box: box(el) },
            lines: ps.map((p) => {
              const cs = getComputedStyle(p);
              return {
                text: p.textContent ?? '', box: box(p), scrollWidth: p.scrollWidth, clientWidth: p.clientWidth,
                clipped: cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden',
              };
            }),
          };
        }, HELD_LINES);
        expect(m.lines.map((l) => l.text), 'a held line is missing from the card').toEqual(HELD_LINES);
        expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
        expect(m.section.scrollWidth, 'the card overflows sideways').toBeLessThanOrEqual(m.section.clientWidth);
        expect(m.section.box.right, 'the card runs past the viewport').toBeLessThanOrEqual(m.viewport);
        for (const l of m.lines) {
          expect(l.clipped, `"${l.text}" is set to cut short rather than wrap`).toBe(false);
          expect(l.scrollWidth, `"${l.text}" overflows its line box`).toBeLessThanOrEqual(l.clientWidth);
          expect(l.box.left, `"${l.text}" starts left of its card`).toBeGreaterThanOrEqual(m.section.box.left - 0.5);
          expect(l.box.right, `"${l.text}" runs past its card`).toBeLessThanOrEqual(m.section.box.right + 0.5);
        }
        // A remedy is a long sentence: at phone width it wraps onto more than one line rather than running out.
        if (view.width <= 390) {
          const remedy = m.lines.find((l) => l.text.startsWith('To lift it,'))!;
          expect(remedy.box.bottom - remedy.box.top, 'a remedy did not wrap at phone width').toBeGreaterThan(30);
        }
        const shots = process.env.CCRC_SHOTS;
        if (shots) await section.screenshot({ path: path.join(shots, `stall-watch-held-${view.skin}-${view.width}.png`) });
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
