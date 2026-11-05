// Settings › Automation › Leftover processes (D-7994), in a real Chrome over the production build, at 360, 390, 1280 and
// 1920 in both skins. `test/scope-sweep-section.test.tsx` holds the card's behaviour in jsdom; this file holds what only
// an engine can say: both switches are visible, nothing in the card or on the page overflows sideways, whether it is at
// rest, waiting on a tap or unable to read the registry, and the busy choice can be reached and picked, its write answered
// by the stub below.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. `GET`/`POST /api/coord/scope-sweep` answer from
// one stored pair that starts as a live sweep with its busy arm in shadow. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/scope-sweep-card.browser.test.ts )`. `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { SCOPE_SWEEP_TEXT as T } from '../src/fleet/scopeSweepWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: readonly AppView[] = [360, 390, 1280, 1920].flatMap((width) => [
  { skin: REFINED, theme: PHOSPHOR, width }, { skin: INSTRUMENT, theme: 'light', width },
]);
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const DOOR = '/api/coord/scope-sweep';

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
interface Measured {
  viewport: number;
  pageScrollWidth: number;
  pageClientWidth: number;
  detail: { scrollWidth: number; clientWidth: number } | null;
  section: { scrollWidth: number; clientWidth: number };
  card: { scrollWidth: number; clientWidth: number; box: Box };
  texts: { text: string; box: Box }[];
}

describe('Settings › Automation › Leftover processes at every width, in both skins (D-7994)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      let stop: 'set' | 'clear' | 'unmeasurable' = 'set';
      let busy: 'set' | 'clear' | 'unmeasurable' = 'clear';
      const posts: unknown[] = [];
      // The write waits on the case, so the card can be measured while it holds the choice.
      let answer: () => void = () => undefined;
      const held = (): Promise<void> => new Promise((done) => { answer = done; });
      let hold: Promise<void> | null = null;
      await ctx.route(`**${DOOR}`, async (r) => {
        const req = r.request();
        if (req.method() === 'POST') {
          const body = req.postDataJSON() as { on?: unknown } | null;
          posts.push(body);
          if (typeof body?.on !== 'boolean') {
            return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'bad-request' }) });
          }
          if (hold !== null) await hold;
          busy = body.on ? 'set' : 'clear';
        }
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stop, busy }) });
      });
      try {
        await page.goto(server!.origin + '/settings/automation');
        const section = page.getByRole('region', { name: T.title });
        const off = section.getByRole('radio', { name: T.off });
        const on = section.getByRole('radio', { name: T.on });
        await expect.poll(() => off.isChecked(), { timeout: 20_000 }).toBe(true);
        expect(await section.getByRole('radio').count(), 'the card does not offer exactly two choices').toBe(2);
        expect(await on.isChecked()).toBe(false);
        // Both switches are on screen: the idle one's line and the busy one's radios.
        expect(await section.getByText(`${T.idleLead}: ${T.idleOn}`).isVisible(), 'the idle switch is not visible').toBe(true);
        expect(await section.getByRole('group', { name: T.legend }).isVisible(), 'the busy switch is not visible').toBe(true);

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
        if (shots) await section.screenshot({ path: path.join(shots, `scope-sweep-${view.skin}-${view.width}.png`) });

        // A tap waits on the answer: the reading stands and the choice is held, with its line on screen and still fitting.
        hold = held();
        await on.click();
        await expect.poll(() => section.getByText(T.asked).isVisible(), { timeout: 10_000 }).toBe(true);
        expect(await off.isChecked(), 'the tap moved the radio before the server said so').toBe(true);
        expect(await on.isDisabled(), 'the choice is not held while the tap waits').toBe(true);
        fits(await measure());
        hold = null;
        answer();
        await expect.poll(() => on.isChecked(), { timeout: 10_000 }).toBe(true);
        expect(busy).toBe('set');
        await expect.poll(() => on.isDisabled(), { timeout: 10_000 }).toBe(false);
        expect(await section.getByText(T.asked).count()).toBe(0);

        // And back from the keyboard.
        await on.focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => off.isChecked(), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => busy, { timeout: 10_000 }).toBe('clear');
        expect(posts).toEqual([{ on: true }, { on: false }]);

        // The longest body the card has: a registry that could not be listed, read fresh, checks neither and still fits.
        stop = 'unmeasurable';
        busy = 'unmeasurable';
        await page.reload();
        await expect.poll(() => section.getByText(T.unmeasured).isVisible(), { timeout: 20_000 }).toBe(true);
        expect(await on.isChecked()).toBe(false);
        expect(await off.isChecked()).toBe(false);
        fits(await measure());
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
