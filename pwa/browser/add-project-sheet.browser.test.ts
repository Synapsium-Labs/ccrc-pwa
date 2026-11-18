// The fleet screen's Add project sheet, with the Linear hierarchy controls it carries (D-8184: the owner select and the
// File into initiatives toggle), in a real Chrome over the production build, at 360, 390, 1280, 1470 and 1920, in both skins and
// both themes. `test/add-project-sheet.test.tsx` holds the behaviour in jsdom; this file holds what only an engine can say: no
// sideways scroll on the page or in the sheet, no clipped text, no select showing only part of its value. An older server's 404 on
// `GET /api/hierarchy` means "absent": the sheet then draws no owner select, no toggle and no failure sentence.
// The helpers below (`measure`'s select check and boxes) are copied, trimmed, from `project-linking-card.browser.test.ts`, which
// keeps them inside its file. Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/add-project-sheet.browser.test.ts )`. `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { HIERARCHY_TEXT } from '../src/fleet/hierarchyWords';
import { LINKING_ADD_TEXT, PROJECT_ADD_TEXT } from '../src/fleet/projectAddWords';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1470, 1920];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const LONG_COORD = 'cc-coord-with-a-rather-long-identifier-b';
const HIER = {
  ok: true,
  coordinators: [{ id: 'coord-a', live: true }, { id: LONG_COORD, live: true }],
  projects: [],
};

const FIXTURE: AppFixture = {
  api: {
    '/api/hierarchy': HIER,
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/feed': { events: [] },
    '/api/projects': { roots: ['/w'], projects: [] },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'coord', coord: { pause: 'clear' } }],
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

interface Measured {
  viewport: number; pageScrollWidth: number; pageClientWidth: number;
  sheet: { scrollWidth: number; clientWidth: number; left: number; right: number };
  ellipsis: string[]; clipped: string[]; clippedSelects: string[]; selects: number;
}

/** The sheet's geometry, measured in the page. */
const measure = (el: Element): Measured => {
  const r = el.getBoundingClientRect();
  return {
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    sheet: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, left: r.left, right: r.right },
    ellipsis: [...el.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.tagName.toLowerCase()),
    clipped: [...el.querySelectorAll('*')]
      // The sheet footer's rows carry `-m-1 p-1` on purpose (the focus ring's reach, `sheet.tsx`), so its 4px of scrollable overflow is
      // the shared primitive's design and clips nothing (the footer itself is overflow: visible).
      .filter((e) => e.tagName !== 'SELECT' && !e.classList.contains('sheet-footer') && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
      .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
    selects: el.querySelectorAll('select').length,
    // A select's shown value is drawn inside its own box, so `scrollWidth` never trips on it: measure the selected option's text in
    // the select's own font against the content box less the platform's disclosure arrow (24px, generous for Chrome).
    clippedSelects: [...el.querySelectorAll('select')].flatMap((s) => {
      const cs = getComputedStyle(s);
      if (cs.font === '') return ['computed font is empty'];
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = cs.font;
      const text = s.selectedOptions[0]?.textContent ?? '';
      const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24;
      const need = ctx.measureText(text).width;
      return need > room ? [`"${text}" needs ${Math.ceil(need)}px of ${Math.floor(room)}px`] : [];
    }),
  };
};

const open = async (view: AppView, hierarchy404 = false) => {
  const app = await openApp(browser!, view, FIXTURE);
  // The last route registered answers first: an older server's 404 on the hierarchy read.
  let seen404: () => void = () => undefined;
  const answered404 = new Promise<void>((resolve) => { seen404 = resolve; });
  if (hierarchy404) await app.ctx.route('**/api/hierarchy', async (route) => { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); seen404(); });
  else seen404();
  await app.page.goto(server!.origin + '/');
  await app.page.getByRole('button', { name: PROJECT_ADD_TEXT.open }).first().click();
  const sheet = app.page.getByRole('dialog');
  await sheet.getByRole('heading', { name: PROJECT_ADD_TEXT.title }).waitFor({ timeout: 30_000 });
  // The hierarchy read has settled once the Team key field is drawn and either the owner select or the toggle (or neither, absent).
  await sheet.getByLabel(LINKING_ADD_TEXT.teamKey).waitFor({ timeout: 30_000 });
  return { ...app, sheet, answered404 };
};

describe('Add project sheet, per width, skin and theme (D-8184)', () => {
  for (const width of WIDTHS) {
    it(`the owner select and the initiatives toggle are contained and whole at ${width}px, in both skins and both themes`, async () => {
      for (const skin of SKINS) {
        for (const theme of THEMES) {
          const view: AppView = { skin, theme, width };
          const at = named(view);
          const { ctx, errors, sheet } = await open(view);
          try {
            await sheet.getByLabel(LINKING_ADD_TEXT.owner).waitFor({ timeout: 30_000 });
            await sheet.getByRole('checkbox', { name: HIERARCHY_TEXT.initiatives }).waitFor({ timeout: 30_000 });
            // Choose the long coordinator, so the select SHOWS the long value.
            await sheet.getByLabel(LINKING_ADD_TEXT.owner).selectOption({ value: LONG_COORD });
            const m = await sheet.evaluate(measure);
            const shots = process.env.CCRC_SHOTS;
            if (shots) await sheet.screenshot({ path: path.join(shots, `add-project-${skin}-${theme}-${width}.png`) });
            expect(m.selects, `${at}: the owner select is drawn`).toBeGreaterThanOrEqual(1);
            expect(await sheet.getByRole('checkbox', { name: HIERARCHY_TEXT.initiatives }).isVisible(), `${at}: the toggle is visible`).toBe(true);
            expect(await sheet.getByLabel(LINKING_ADD_TEXT.owner).isVisible(), `${at}: the owner select is visible`).toBe(true);
            expect(m.sheet.scrollWidth, `${at}: the sheet overflows sideways`).toBeLessThanOrEqual(m.sheet.clientWidth);
            expect(m.ellipsis, `${at}: text is cut short with an ellipsis`).toEqual([]);
            expect(m.clipped, `${at}: an element is wider than its box`).toEqual([]);
            // The one very long id is checked from 1280: no select can show an arbitrarily long id on a phone.
            const phone = m.viewport < 1280;
            expect(m.clippedSelects.filter((c) => !(phone && c.includes(LONG_COORD))), `${at}: a select shows only part of its value`).toEqual([]);
            expect(m.pageScrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClientWidth);
            expect(m.sheet.left, `${at}: the sheet starts left of the viewport`).toBeGreaterThanOrEqual(-0.5);
            expect(m.sheet.right, `${at}: the sheet runs past the viewport`).toBeLessThanOrEqual(m.viewport + 0.5);
            // The ordinary default option shows whole at every width too.
            await sheet.getByLabel(LINKING_ADD_TEXT.owner).selectOption({ value: 'coord-a' });
            const m2 = await sheet.evaluate(measure);
            expect(m2.clippedSelects, `${at}: a select shows only part of an ordinary value`).toEqual([]);
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }
      }
    }, 240_000);
  }

  for (const width of [390, 1920]) {
    it(`an older server's 404 on the hierarchy read draws no owner select, no toggle and no failure sentence at ${width}px`, async () => {
      for (const skin of SKINS) {
        const view: AppView = { skin, theme: 'light', width };
        const at = named(view);
        const { ctx, sheet, page, answered404 } = await open(view, true);
        try {
          // Wait for the read to settle, not for a time: the route answered the 404, then two frames let React draw what it will.
          await answered404;
          await page.evaluate(() => new Promise<void>((r) => { requestAnimationFrame(() => requestAnimationFrame(() => r())); }));
          expect(await sheet.getByLabel(LINKING_ADD_TEXT.owner).count(), `${at}: no owner select`).toBe(0);
          expect(await sheet.locator('select').count(), `${at}: no select at all`).toBe(0);
          expect(await sheet.getByRole('checkbox', { name: HIERARCHY_TEXT.initiatives }).count(), `${at}: no initiatives toggle`).toBe(0);
          expect(await sheet.getByRole('alert').count(), `${at}: no alert`).toBe(0);
          expect(await sheet.getByText(LINKING_ADD_TEXT.ownersUnread).count(), `${at}: no failure sentence`).toBe(0);
          expect(await sheet.getByText(HIERARCHY_TEXT.unreadable).count(), `${at}: no unreadable sentence`).toBe(0);
          const m = await sheet.evaluate(measure);
          expect(m.sheet.scrollWidth, `${at}: the sheet overflows sideways`).toBeLessThanOrEqual(m.sheet.clientWidth);
          expect(m.pageScrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClientWidth);
        } finally {
          await ctx.close();
        }
      }
    }, 120_000);
  }
});
