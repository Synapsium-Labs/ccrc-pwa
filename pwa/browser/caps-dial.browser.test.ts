// The caps dial on the runs board, in a real Chrome over the production build, at every width. jsdom lays nothing
// out, so `test/caps-control.test.tsx` holds the behaviour and this file holds what only an engine can say: with the
// daily brake retired (D-TBD-retire-daily-brake) the dial is ONE field, its input, its usage reading and its save
// stay whole inside the viewport and inside the row at phone, laptop and wide widths, and nothing overflows sideways.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/caps-dial.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per width.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [
  { skin: REFINED, theme: PHOSPHOR, width: 360 },
  { skin: REFINED, theme: 'light', width: 390 },
  { skin: INSTRUMENT, theme: PHOSPHOR, width: 1280 },
  { skin: INSTRUMENT, theme: 'light', width: 1920 },
];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 1 }, updatedAt: null },
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
  dist = buildDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  removeDist(dist);
});

interface Box { left: number; right: number; top: number; bottom: number }
interface Measured {
  fields: number;
  labels: string[];
  viewport: number;
  scrollWidth: number;
  row: Box;
  parts: Record<'input' | 'usage' | 'save', Box>;
}

describe('the caps dial lays out at every width with one field', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await page.goto(server!.origin + '/runs');
        await page.waitForSelector('.caps-control', { timeout: 20_000 });
        const m = await page.evaluate((): Measured => {
          const box = (el: Element | null): Box => {
            if (el === null) throw new Error('a part of the dial is missing');
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const row = document.querySelector('.caps-control')!;
          return {
            fields: row.querySelectorAll('.caps-field').length,
            labels: [...row.querySelectorAll('.caps-label')].map((l) => l.textContent ?? ''),
            viewport: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            row: box(row),
            parts: {
              input: box(row.querySelector('.caps-input')),
              usage: box(row.querySelector('.caps-usage')),
              save: box(row.querySelector('.caps-save')),
            },
          };
        });
        const shots = process.env.CCRC_SHOTS;
        if (shots) await page.locator('.caps-control').screenshot({ path: path.join(shots, `caps-dial-${view.skin}-${view.theme}-${view.width}.png`) });
        expect(m.fields, 'the dial is not one field').toBe(1);
        expect(m.labels).toEqual(['workers']);
        expect(m.scrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.viewport);
        for (const [name, b] of Object.entries(m.parts)) {
          expect(b.left, `${name} starts left of the viewport`).toBeGreaterThanOrEqual(0);
          expect(b.right, `${name} runs past the viewport`).toBeLessThanOrEqual(m.viewport);
          expect(b.left, `${name} starts left of its row`).toBeGreaterThanOrEqual(m.row.left - 0.5);
          expect(b.right, `${name} runs past its row`).toBeLessThanOrEqual(m.row.right + 0.5);
          expect(b.bottom - b.top, `${name} has no height`).toBeGreaterThan(0);
        }
        // One field and a save fit on one line at every width, phone included: a wrap here means the row lost room.
        const mid = (b: Box): number => (b.top + b.bottom) / 2;
        expect(Math.abs(mid(m.parts.save) - mid(m.parts.input)), 'the save wrapped below the field')
          .toBeLessThan(m.parts.input.bottom - m.parts.input.top);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
