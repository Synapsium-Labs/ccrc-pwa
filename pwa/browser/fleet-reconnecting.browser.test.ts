// An empty Fleet pane keeps saying the link is down for the whole outage, in a real Chrome over the production build.
// With the link cut, the fleet socket climbs its backoff ladder, and the store reads `connecting` for each attempt and
// `down` when it closes. On a real network an attempt to an unreachable host stays `connecting` for seconds; here the
// harness holds it there (`holdAttempts`, which delays the routed close, as accounts-cards.browser.test.ts's
// `holdOffline` reads the shell between attempts), and the pane with no session must still say "Reconnecting…".
// `test/fleet-screen.test.tsx` holds the store's transitions and the cold start that has not failed yet; this file holds
// what the operator's every-width rule asks: at 360, 390, 1280 and 1920, in Refined and Instrument, the banner is drawn
// once, as a status, inside the viewport, and the page scrolls sideways by nothing.
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/fleet-reconnecting.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [360, 390, 1280, 1920] as const;
const VIEWS: AppView[] = SKINS.flatMap((skin) => WIDTHS.map((width) => ({ skin, theme: PHOSPHOR, width })));
const named = (v: AppView): string => `${v.skin}, ${v.width}px`;

const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': { accounts: [], projected: null, roster: [] } },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
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

describe("an empty Fleet pane says 'Reconnecting…' through a held reconnect attempt, at every width and skin", () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const app = await openApp(browser!, view, FIXTURE);
      try {
        await app.page.goto(server!.origin + '/');
        await app.page.waitForFunction(() => document.querySelector('.fleet')?.getAttribute('data-conn') === 'open',
          undefined, { polling: 50, timeout: 30_000 });
        const release = app.holdAttempts();
        app.cut();
        // The open socket closes (`down`), and the ladder's next rung starts an attempt that the hold keeps open.
        await app.page.waitForFunction(() => document.querySelector('.fleet')?.getAttribute('data-conn') === 'connecting',
          undefined, { polling: 50, timeout: 10_000 });
        // Read while it stays there: the hold is the only thing that ends this attempt.
        await app.page.waitForTimeout(300);
        const m = await app.page.evaluate(() => {
          const drawn = (text: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.offline-banner')]
            .filter((b) => b.checkVisibility() && (b.textContent ?? '').includes(text));
          const banners = drawn('Reconnecting…');
          const r = banners[0]?.getBoundingClientRect();
          return {
            conn: document.querySelector('.fleet')?.getAttribute('data-conn') ?? null,
            sessions: document.querySelectorAll('.proj-card').length,
            reconnecting: banners.length,
            role: banners[0]?.getAttribute('role') ?? null,
            text: banners[0]?.textContent ?? null,
            lastKnown: drawn('Last known state').length,
            left: r?.left ?? NaN, right: r?.right ?? NaN, top: r?.top ?? NaN, bottom: r?.bottom ?? NaN,
            vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        release();
        expect(m.conn, 'the attempt is still held').toBe('connecting');
        expect(m.sessions, 'the pane holds no session').toBe(0);
        expect(m.reconnecting, "'Reconnecting…' is drawn, once").toBe(1);
        expect(m.role).toBe('status');
        expect(m.text).toBe('Reconnecting…');
        expect(m.lastKnown, 'never beside the stale-cards banner').toBe(0);
        expect(m.left).toBeGreaterThanOrEqual(0);
        expect(m.right).toBeLessThanOrEqual(m.vw);
        expect(m.top).toBeGreaterThanOrEqual(0);
        expect(m.bottom).toBeLessThanOrEqual(m.vh);
        expect(m.overflow).toBeLessThanOrEqual(0);
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 60_000);
  }
});
