// Settings › Automation › Stop leftovers (D-7902), in a real Chrome over the production build, at 360, 390, 1280 and 1920
// in both skins. `test/pane-scope-stop-section.test.tsx` holds the card's behaviour in jsdom; this file holds what only an
// engine can say: the card draws its two choices from the coord frame, nothing in it or on the page overflows sideways,
// and each choice can be reached and picked, settling on a later frame.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. `POST /api/coord/pane-scope-stop` answers
// `requested`, as the route does, and the test sends the coord frame the server would. Run: `( cd pwa && CCRC_CHROME=<a
// Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/pane-scope-stop-card.browser.test.ts )`. `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { PANE_SCOPE_STOP_TEXT as T } from '../src/fleet/paneScopeStopWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [360, 390, 1280, 1920].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const DOOR = '/api/coord/pane-scope-stop';
const coordFrame = (paneScopeStop: 'clear' | 'set'): object => ({ type: 'coord', coord: { pause: 'clear', paneScopeStop } });

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
    coordFrame('clear'),
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
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  detail: { scrollWidth: number; clientWidth: number } | null;
  section: { scrollWidth: number; clientWidth: number };
  card: { scrollWidth: number; clientWidth: number; box: Box };
  texts: { text: string; box: Box }[];
}

describe('Settings › Automation › Stop leftovers at every width, in both skins (D-7902)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const app = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors } = app;
      const posts: unknown[] = [];
      await ctx.route(`**${DOOR}`, async (r) => {
        const body = r.request().postDataJSON() as { state?: unknown } | null;
        posts.push(body);
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, requested: body?.state }) });
      });
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: T.title });
        const shadow = section.getByRole('radio', { name: T.shadow });
        const live = section.getByRole('radio', { name: T.live });
        await expect.poll(() => shadow.isChecked(), { timeout: 20_000 }).toBe(true);
        expect(await section.getByRole('radio').count(), 'the card does not offer exactly two choices').toBe(2);
        expect(await live.isChecked()).toBe(false);

        const measure = (): Promise<Measured> => section.evaluate((el): Measured => {
          const box = (e: Element): Box => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          };
          const card = el.querySelector(':scope > div:last-child');
          if (card === null) throw new Error('the card has no body');
          const detail = document.querySelector('.shell-detail');
          return {
            viewport: window.innerWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            pageClientWidth: document.documentElement.clientWidth,
            detail: detail === null ? null : { scrollWidth: detail.scrollWidth, clientWidth: detail.clientWidth },
            section: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth },
            card: { scrollWidth: card.scrollWidth, clientWidth: card.clientWidth, box: box(card) },
            texts: [...card.querySelectorAll('p, label, legend')].map((e) => ({ text: e.textContent ?? '', box: box(e) })),
          };
        });
        const fits = (m: Measured): void => {
          expect(m.card.scrollWidth, 'the card overflows sideways').toBeLessThanOrEqual(m.card.clientWidth);
          expect(m.section.scrollWidth, 'the section overflows sideways').toBeLessThanOrEqual(m.section.clientWidth);
          if (m.detail !== null) expect(m.detail.scrollWidth, 'the detail pane scrolls sideways').toBeLessThanOrEqual(m.detail.clientWidth);
          expect(m.pageScrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(m.pageClientWidth);
          expect(m.card.box.left, 'the card starts left of the viewport').toBeGreaterThanOrEqual(0);
          expect(m.card.box.right, 'the card runs past the viewport').toBeLessThanOrEqual(m.viewport);
          for (const t of m.texts) {
            expect(t.box.left, `"${t.text}" starts left of its card`).toBeGreaterThanOrEqual(m.card.box.left - 0.5);
            expect(t.box.right, `"${t.text}" runs past its card`).toBeLessThanOrEqual(m.card.box.right + 0.5);
            expect(t.box.bottom - t.box.top, `"${t.text}" has no height`).toBeGreaterThan(0);
          }
        };
        fits(await measure());
        const shots = process.env.CCRC_SHOTS;
        if (shots) await section.screenshot({ path: path.join(shots, `stop-leftovers-${view.skin}-${view.width}.png`) });

        // A tap waits on the frame: the reading stands and the choice is held, with its line on screen and still fitting.
        await live.click();
        await expect.poll(() => section.getByText(T.asked).isVisible(), { timeout: 10_000 }).toBe(true);
        expect(await shadow.isChecked(), 'the tap moved the radio before a frame said so').toBe(true);
        expect(await live.isDisabled(), 'the choice is not held while the tap waits').toBe(true);
        fits(await measure());
        expect(posts).toEqual([{ state: 'live' }]);

        app.send('/ws/fleet', coordFrame('set'));
        await expect.poll(() => live.isChecked(), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => live.isDisabled(), { timeout: 10_000 }).toBe(false);
        expect(await section.getByText(T.asked).count()).toBe(0);

        // And back from the keyboard.
        await live.focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => posts.length, { timeout: 10_000 }).toBe(2);
        app.send('/ws/fleet', coordFrame('clear'));
        await expect.poll(() => shadow.isChecked(), { timeout: 10_000 }).toBe(true);
        expect(posts).toEqual([{ state: 'live' }, { state: 'shadow' }]);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
