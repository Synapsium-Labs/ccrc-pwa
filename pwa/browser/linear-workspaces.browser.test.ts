// Settings › Security › Linear (#1444, spec §10.3's width table), in a real Chrome over the production build, at the
// widths `accounts-open.browser.test.ts` uses (360, 390, 1280 and 1920), in both skins, light and dark, with one, three
// and twelve workspaces, the first of them a workspace of forty teams with a long name, and the legacy row.
// `test/linear-section.test.tsx` holds the card's behaviour in jsdom; this file holds what only an engine can say, row by
// row of the spec's table:
//   * card: the Settings column's width at every band; at wide it does not stretch past the column;
//   * row head: on a phone the name on its own line and the state under it; on a laptop and wide the name and the state
//     on one line, the controls right-aligned on it;
//   * teams: chips that wrap, the first eight (phone), sixteen (laptop) or twenty-four (wide), then *+N more*, which
//     shows the rest;
//   * key tail and checked time: one line on a laptop and wide;
//   * controls: on a phone a full-width row of buttons under the head, each at least 44 px tall; inline elsewhere.
// At every width no text is cut short with an ellipsis, nothing in the card or on the page scrolls sideways, and every
// control is reached by the keyboard.
//
// The app answers from a fixture (`browser/app.ts`): no server, no Linear. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/linear-workspaces.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { LinearLegacyRow, LinearWorkspaceView } from '../../shared/linear';
import { LINEAR_TEAMS_SHOWN, type LinearBand } from '../src/screens/LinearSection';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const bandOf = (width: number): LinearBand => (width < 900 ? 'phone' : width >= 1600 ? 'wide' : 'laptop');

const TITLE = SETTINGS_CARDS.security.linear.title;
const NOW = Date.now();
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LONG_NAME = 'Workspace with a deliberately long name that has to wrap on a phone screen';
const FORTY = Array.from({ length: 40 }, (_, i) => ({ key: `T${String(i + 1).padStart(2, '0')}`, name: `Team ${i + 1}` }));

const workspace = (n: number): LinearWorkspaceView => {
  const name = n === 1 ? LONG_NAME : `Workspace ${String(n).padStart(2, '0')}`;
  return {
    id: uuid(n), name, urlKey: `ws-${n}`, teams: n === 1 ? FORTY : [{ key: 'AAA', name: 'Team A' }, { key: 'BBB', name: 'Team B' }],
    state: 'connected', outcome: 'ok', org: name, user: 'user-a', keyTail: '4f2c', checkedAt: NOW - 3 * 60_000,
  };
};
const LEGACY: LinearLegacyRow = {
  view: { state: 'connected', outcome: 'ok', org: 'Workspace L', user: 'user-a', keyTail: '9e1d', checkedAt: NOW - 60_000 },
  workspace: { name: 'Workspace L', urlKey: 'ws-l', teams: [{ key: 'LLL', name: 'Team L' }] }, superseded: false,
};
const listOf = (n: number): unknown => ({ ok: true, store: 'ok', workspaces: Array.from({ length: n }, (_, i) => workspace(i + 1)), legacy: LEGACY });

const FIXTURE: AppFixture = {
  api: { '/api/accounts': { accounts: [], projected: null, roster: [] }, '/api/feed': { events: [] } },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'coord', coord: { pause: 'clear' } }],
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

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface RowMeasure {
  row: Box; head: Box; name: Box; state: Box; controls: Box; buttons: Box[]; meta: Box | null; metaLine: number;
  chips: number; chipBoxes: Box[]; teams: Box | null; more: string | null;
}
interface Measured {
  viewport: number; pageScrollWidth: number; pageClientWidth: number; pageMax: number; band: string | null;
  card: { scrollWidth: number; clientWidth: number; box: Box };
  rows: RowMeasure[];
  ellipsis: string[];
  overflowing: string[];
}

/** The card's geometry, measured in the page. */
const measure = (el: Element): Measured => {
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const one = (root: Element, sel: string): Element => {
    const found = root.querySelector(sel);
    if (found === null) throw new Error(`no ${sel}`);
    return found;
  };
  const card = one(el, ':scope > div:last-child');
  const rows = [...el.querySelectorAll('[data-linear="row"]')].map((r): RowMeasure => {
    const meta = r.querySelector('[data-linear="meta"]');
    const teams = r.querySelector('[data-linear="teams"]');
    return {
      row: box(r), head: box(one(r, '.linear-row-head')), name: box(one(r, '[data-linear="name"]')), state: box(one(r, '[data-linear="state"]')),
      controls: box(one(r, '[data-linear="controls"]')), buttons: [...r.querySelectorAll('[data-linear="controls"] button')].map(box),
      meta: meta === null ? null : box(meta), metaLine: meta === null ? 0 : parseFloat(getComputedStyle(meta).lineHeight),
      chips: r.querySelectorAll('[data-linear="teams"] .chip').length, chipBoxes: [...r.querySelectorAll('[data-linear="teams"] .chip')].map(box),
      teams: teams === null ? null : box(teams), more: r.querySelector('[data-linear="more"]')?.textContent ?? null,
    };
  });
  return {
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    pageMax: parseFloat(getComputedStyle(el).getPropertyValue('--page-max')),
    band: el.getAttribute('data-band'),
    card: { scrollWidth: card.scrollWidth, clientWidth: card.clientWidth, box: box(card) },
    rows,
    ellipsis: [...el.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.tagName.toLowerCase()),
    overflowing: [...el.querySelectorAll('*')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')
      .map((e) => e.tagName.toLowerCase() + (e.getAttribute('data-linear') ?? '')),
  };
};

/** Nothing scrolls sideways and nothing is cut short with an ellipsis: the card, any scroller inside it, the page. */
const assertContained = (m: Measured, at: string): void => {
  expect(m.card.scrollWidth, `${at}: the card overflows sideways`).toBeLessThanOrEqual(m.card.clientWidth);
  expect(m.overflowing, `${at}: an element inside the card scrolls sideways`).toEqual([]);
  expect(m.ellipsis, `${at}: text is cut short with an ellipsis`).toEqual([]);
  expect(m.pageScrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClientWidth);
  expect(m.card.box.left).toBeGreaterThanOrEqual(0);
  expect(m.card.box.right).toBeLessThanOrEqual(m.viewport);
  for (const r of m.rows) {
    expect(r.row.right, `${at}: a row runs past the card`).toBeLessThanOrEqual(m.card.box.right + 0.5);
    for (const c of r.chipBoxes) expect(c.right, `${at}: a team chip runs past its row`).toBeLessThanOrEqual(r.row.right + 0.5);
  }
};

/** Every control in the card, reached by Tab from the first one, in order, and focus leaves the card after the last. */
const tabWalk = async (page: Page, title: string): Promise<{ controls: number; reached: number }> => {
  const section = page.getByRole('region', { name: title });
  const controls = await section.locator('button:not([disabled]), input:not([disabled])').count();
  await section.locator('button:not([disabled]), input:not([disabled])').first().focus();
  const seen = new Set<string>();
  for (let i = 0; i < controls + 2; i += 1) {
    const at = await section.evaluate((el) => {
      const a = document.activeElement;
      if (a === null || !el.contains(a)) return null;
      const all = [...el.querySelectorAll('button:not([disabled]), input:not([disabled])')];
      return String(all.indexOf(a));
    });
    if (at === null) break;
    seen.add(at);
    await page.keyboard.press('Tab');
  }
  return { controls, reached: seen.size };
};

describe('Settings › Security › Linear at every width (spec §10.3)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const band = bandOf(view.width);
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      let count = 12;
      await ctx.route('**/api/linear/workspaces', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listOf(count)) }));
      try {
        for (const n of [12, 3, 1]) {
          count = n;
          await page.goto(server!.origin + '/settings/security');
          const section = page.getByRole('region', { name: TITLE });
          await expect.poll(() => section.locator('[data-linear="row"]').count(), { timeout: 20_000 }).toBe(n + 1);
          const m = await section.evaluate(measure);
          const at = `${n} workspaces`;
          const shots = process.env.CCRC_SHOTS;
          if (shots) await section.screenshot({ path: path.join(shots, `linear-${view.skin}-${view.theme}-${view.width}-${n}.png`) });

          expect(m.band, at).toBe(band);
          assertContained(m, at);
          // The card: the Settings column at every band; at wide it does not stretch past the column.
          expect(m.card.box.width, `${at}: the card stretches past the Settings column`).toBeLessThanOrEqual(m.pageMax + 1);

          // The forty-team row: the band's first few chips, then +N more.
          const big = m.rows[0]!;
          const cap = LINEAR_TEAMS_SHOWN[band];
          expect(big.chips, `${at}: chips before +N more`).toBe(cap);
          expect(big.more, at).toBe(`+${40 - cap} more`);

          for (const [i, r] of m.rows.entries()) {
            const which = `${at}, row ${i + 1}`;
            if (band === 'phone') {
              // The name on its own line, the state under it, the controls a full-width row under the head.
              expect(r.state.top, `${which}: the state sits under the name`).toBeGreaterThanOrEqual(r.name.bottom - 0.5);
              expect(r.controls.top, `${which}: the controls sit under the state`).toBeGreaterThanOrEqual(r.state.bottom - 0.5);
              expect(Math.abs(r.controls.width - r.head.width), `${which}: the controls are full-width`).toBeLessThanOrEqual(1);
              expect(new Set(r.buttons.map((b) => Math.round(b.top))).size, `${which}: the buttons share one row`).toBe(1);
              for (const b of r.buttons) expect(b.height, `${which}: a control under 44 px`).toBeGreaterThanOrEqual(44);
            } else {
              // A short name and its state on one line; the controls right-aligned on that line.
              if (i > 0) expect(Math.abs(r.state.top - r.name.top), `${which}: the name and the state share a line`).toBeLessThanOrEqual(4);
              expect(Math.abs(r.controls.right - r.head.right), `${which}: the controls are right-aligned`).toBeLessThanOrEqual(1);
              expect(Math.abs(r.controls.top - r.head.top), `${which}: the controls sit on the head's line`).toBeLessThanOrEqual(1);
              expect(new Set(r.buttons.map((b) => Math.round(b.top))).size, `${which}: the buttons are inline`).toBe(1);
              for (const b of r.buttons) expect(b.width, `${which}: an inline button is not full-width`).toBeLessThan(r.head.width / 2);
              // The key tail and the checked time on one line.
              expect(r.meta, which).not.toBeNull();
              expect(r.meta!.height, `${which}: the key line wraps`).toBeLessThanOrEqual(r.metaLine * 1.5);
            }
          }
          if (n === 1) {
            // A long name wraps rather than pushing the card sideways.
            expect(m.rows[0]!.name.height, 'the long name wraps').toBeGreaterThan(band === 'phone' ? m.rows[1]!.name.height : 0);
          }
        }

        // +N more shows every team, and the card still holds them.
        const section = page.getByRole('region', { name: TITLE });
        await section.locator('[data-linear="more"]').first().click();
        const opened = await section.evaluate(measure);
        expect(opened.rows[0]!.chips, '+N more shows every team').toBe(40);
        // Forty chips never fit one line of the column: they wrap, inside the row.
        expect(new Set(opened.rows[0]!.chipBoxes.map((c) => Math.round(c.top))).size, 'the chips wrap').toBeGreaterThan(1);
        assertContained(opened, 'teams shown');

        // Every control is reached by the keyboard.
        const walk = await tabWalk(page, TITLE);
        expect(walk.controls).toBeGreaterThan(0);
        expect(walk.reached, 'every control is reached by Tab').toBe(walk.controls);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);
  }
});
