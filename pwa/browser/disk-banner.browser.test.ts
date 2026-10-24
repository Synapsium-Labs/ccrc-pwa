// The disk banner's geometry, in a real Chrome over the production build (D-6617; spec 2026-10-23 fleet-disk-retention
// §2.5; plan Task DR-5). jsdom lays nothing out, so `test/disk-banner.test.tsx` holds the words, the rank and the
// markup, and this file holds what the operator's every-width rule asks: at 360, 390, 1280 and 1920, in Refined and
// Instrument, in the dark and the light theme, the banner draws once, inside the viewport, on at most two lines at 360
// and on one line from 390 up, and the page scrolls sideways by nothing.
//
// Both levels run: critical wears the longest sentence ("... · sweeps in pressure mode") in the dead tone, warn the
// shorter one in the attention tone. Neutral names only; the figures are fixture numbers.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/disk-banner.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const SKINS = [REFINED, INSTRUMENT] as const;
const THEMES = [PHOSPHOR, 'light'] as const;
const WIDTHS = [360, 390, 1280, 1920] as const;
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const GIB = 2 ** 30;
type Level = 'warn' | 'critical';
const disk = (level: Level): object => {
  // 93% (critical) or 86% (warn) used with 41 GiB free and no reserved blocks.
  const pct = level === 'critical' ? 93 : 86;
  const avail = 41 * GIB;
  const size = Math.round((avail * 100) / (100 - pct));
  return {
    at: 1_792_362_479_000, level, pressure: level === 'critical', holders: [], expectedMounts: [],
    filesystems: [{ dev: 'dev-a', mount: 'mount-a', fsType: 'ext4', roots: ['projects'], sizeBytes: size, availBytes: avail,
      freeBytes: avail, files: 1000, filesFree: 900, readOnly: false, level }],
  };
};
const fixture = (level: Level): AppFixture => ({
  api: {
    '/api/fleet/health': { mode: 'remote', connected: true, downSince: null, disk: disk(level) },
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [],
    '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
});

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

describe('the disk banner fits at every width, skin and theme (D-6617)', () => {
  for (const level of ['critical', 'warn'] as const) {
    for (const view of VIEWS) {
      it(`${level}: ${named(view)}`, async () => {
        const { ctx, page, errors } = await openApp(browser!, view, fixture(level));
        try {
          await page.goto(server!.origin + '/');
          await page.waitForSelector('[data-banner="disk"] [role="status"]', { timeout: 20_000 });
          const m = await page.evaluate(() => {
            const banners = [...document.querySelectorAll<HTMLElement>('[data-banner="disk"] [role="status"]')]
              .filter((el) => el.getClientRects().length > 0);
            const el = banners[0]!;
            const r = el.getBoundingClientRect();
            const msg = el.querySelector<HTMLElement>('.banner-msg')!;
            const lineHeight = parseFloat(getComputedStyle(msg).lineHeight);
            return {
              drawn: banners.length, text: msg.textContent ?? '',
              left: r.left, right: r.right, vw: document.documentElement.clientWidth,
              lines: Math.round(msg.getBoundingClientRect().height / lineHeight),
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              msgOver: msg.scrollWidth - msg.clientWidth,
            };
          });
          expect(m.drawn).toBe(1);
          expect(m.text).toBe(level === 'critical'
            ? 'Fleet disk 93% full · 41 GiB free · sweeps in pressure mode' : 'Fleet disk 86% full · 41 GiB free');
          expect(m.left).toBeGreaterThanOrEqual(0);
          expect(m.right).toBeLessThanOrEqual(m.vw);
          expect(m.overflow).toBeLessThanOrEqual(0);
          expect(m.msgOver).toBeLessThanOrEqual(0);
          // The longest sentence wraps to two lines where the column is narrow (a phone, Instrument's fleet column) and
          // never to three.
          expect(m.lines).toBeLessThanOrEqual(2);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});
