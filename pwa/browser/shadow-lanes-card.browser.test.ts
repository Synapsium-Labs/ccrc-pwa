// Settings › Automation › Shadow lanes (D-8274; spec 2026-10-28 R-6), in a real Chrome over the production build, at 360, 390,
// 1280 and 1920 in both skins. `test/shadow-lanes-section.test.tsx` holds the card's behaviour in jsdom; this file holds what
// only an engine can say: the roster card's row draws its two choices from the door's answer, nothing in it or on the page
// overflows sideways, and Live is one tap then a confirm whose sheet fits, settling on the server's answer.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. `POST /api/coord/lane-arm` answers the 409
// `confirm-required` to a Live with no key and the view to one with the key, as the route does. Run: `( cd pwa &&
// CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/shadow-lanes-card.browser.test.ts )`. `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { LANE_ARM_TEXT as T, ROSTER_CARD_SHADOW_LOG } from '../../shared/lane-arm';
import { COORDINATOR_ROSTER_CARD_LIVE_MARKER } from '../../shared/switches';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [360, 390, 1280, 1920].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const DOOR = '/api/coord/lane-arm';
const KEY = 'roster-card:shadow:0';
const viewOf = (stored: 'shadow' | 'live', updatedAt: number): object => ({
  ok: true, lanes: [{ lane: 'roster-card', stored, detail: null, live: stored === 'live', updatedAt,
    imported: { result: 'absent', at: 1 }, marker: COORDINATOR_ROSTER_CARD_LIVE_MARKER }],
});

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'runs', runs: [] }, { type: 'coord', coord: { pause: 'clear' } }],
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
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  section: { scrollWidth: number; clientWidth: number; box: Box };
  texts: { text: string; box: Box }[];
}

describe('Settings › Automation › Shadow lanes at every width, in both skins (D-8274)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const app = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors } = app;
      const posts: unknown[] = [];
      let stored: 'shadow' | 'live' = 'shadow';
      await ctx.route(`**${DOOR}`, async (r) => {
        if (r.request().method() === 'GET') {
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewOf(stored, stored === 'live' ? 5 : 0)) });
        }
        const body = r.request().postDataJSON() as { choice?: string; confirm?: string } | null;
        posts.push(body);
        if (body?.choice === 'live' && body.confirm !== KEY) {
          return r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({
            ok: false, error: 'confirm-required', lane: 'roster-card', confirmKey: KEY,
            facts: { stored: 'shadow', updatedAt: 0, shadowLog: ROSTER_CARD_SHADOW_LOG },
          }) });
        }
        stored = body?.choice === 'live' ? 'live' : 'shadow';
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewOf(stored, 5)) });
      });
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: T.title });
        const shadow = section.getByRole('radio', { name: T.shadow });
        const live = section.getByRole('radio', { name: T.live });
        await expect.poll(() => shadow.isChecked(), { timeout: 20_000 }).toBe(true);
        expect(await section.getByRole('radio').count(), 'the card does not offer exactly two choices').toBe(2);
        expect(await section.getByText(T.shadowLog(ROSTER_CARD_SHADOW_LOG)).isVisible()).toBe(true);

        const measure = (): Promise<Measured> => section.evaluate((el): Measured => {
          const box = (e: Element): Box => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          return {
            viewport: window.innerWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            pageClientWidth: document.documentElement.clientWidth,
            section: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, box: box(el) },
            texts: [...el.querySelectorAll('p, label, legend')].map((e) => ({ text: e.textContent ?? '', box: box(e) })),
          };
        });
        const fits = (m: Measured): void => {
          expect(m.section.scrollWidth, 'the card overflows sideways').toBeLessThanOrEqual(m.section.clientWidth);
          expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
          expect(m.section.box.left, 'the card starts left of the viewport').toBeGreaterThanOrEqual(0);
          expect(m.section.box.right, 'the card runs past the viewport').toBeLessThanOrEqual(m.viewport);
          for (const t of m.texts) {
            expect(t.box.left, `"${t.text}" starts left of its card`).toBeGreaterThanOrEqual(m.section.box.left - 0.5);
            expect(t.box.right, `"${t.text}" runs past its card`).toBeLessThanOrEqual(m.section.box.right + 0.5);
            expect(t.box.bottom - t.box.top, `"${t.text}" has no height`).toBeGreaterThan(0);
          }
        };
        fits(await measure());
        const shots = process.env.CCRC_SHOTS;
        if (shots) await section.screenshot({ path: path.join(shots, `shadow-lanes-${view.skin}-${view.width}.png`) });

        // One tap asks the server, whose 409 opens the confirm sheet; it fits the viewport, and the radio stays the server's.
        await live.click();
        const sheet = page.getByRole('dialog', { name: T.confirmTitle });
        await expect.poll(() => sheet.isVisible(), { timeout: 10_000 }).toBe(true);
        const sheetBox = await sheet.boundingBox();
        expect(sheetBox, 'the sheet has no box').not.toBeNull();
        expect(sheetBox!.x, 'the sheet starts left of the viewport').toBeGreaterThanOrEqual(0);
        expect(sheetBox!.x + sheetBox!.width, 'the sheet runs past the viewport').toBeLessThanOrEqual(view.width + 0.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
          'the page scrolls sideways under the sheet').toBe(true);
        if (shots) await page.screenshot({ path: path.join(shots, `shadow-lanes-confirm-${view.skin}-${view.width}.png`) });
        await sheet.getByRole('button', { name: T.confirmLabel }).click();
        await expect.poll(() => live.isChecked(), { timeout: 10_000 }).toBe(true);
        expect(posts).toEqual([{ lane: 'roster-card', choice: 'live' }, { lane: 'roster-card', choice: 'live', confirm: KEY }]);
        fits(await measure());

        // And back to Shadow from the keyboard, with no sheet.
        await live.focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => shadow.isChecked(), { timeout: 10_000 }).toBe(true);
        expect(posts.at(-1)).toEqual({ lane: 'roster-card', choice: 'shadow' });
        expect(await page.getByRole('dialog').count()).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
