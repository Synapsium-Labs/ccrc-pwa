// Settings › Security › Project linking (the linking standard, D-8147; plan Task 8's width table), in a real Chrome over
// the production build, at 360, 390, 1280, 1470 and 1920, in both skins and both themes. `test/project-linking-card.test.tsx`
// holds the card's behaviour in jsdom; this file holds what only an engine can say:
//   * nothing in the card or on the page scrolls sideways, and no text is cut short or clipped (no ellipsis, no element
//     scrolling inside itself), with a long project name that has to wrap;
//   * the layout follows the card's own width, not the window's (a container query): under 480 a row stacks, from 480 its
//     name, key and visibility share a line with the template cell under them, from 760 a row is ONE grid line;
//   * on a phone the key field and Save share a line, and the select and the template button are as wide as the card.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/project-linking-card.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { ProjectLinkingWire } from '../../shared/linking';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1470, 1920];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const TITLE = SETTINGS_CARDS.security.linking.title;
const NOW = Date.now();
const LONG_NAME = 'a-project-with-a-deliberately-long-name-that-has-to-wrap-on-a-phone-screen';

const wire = (over: Partial<ProjectLinkingWire>): ProjectLinkingWire => ({
  teamKey: 'KEY', override: null, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false,
  measured: { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: NOW - 3 * 3_600_000 },
  ...over,
});
const PROJECTS = [
  { name: 'project-a', workdir: '/w/project-a', linking: wire({}) },
  { name: LONG_NAME, workdir: `/w/${LONG_NAME}`, linking: wire({ teamKey: null, measured: { state: 'unmeasured' }, mode: 'unknown' }) },
  { name: 'project-c', workdir: '/w/project-c', linking: wire({
    override: 'public', mode: 'public',
    measured: { state: 'measured', visibility: 'public', slug: 'owner/repo', template: 'present', at: NOW - 60_000 },
  }) },
  { name: 'project-d', workdir: '/w/project-d', linking: wire({
    teamKey: 'ABCDE', mode: 'unknown', measured: { state: 'failed', reason: 'not-ran', at: NOW - 60_000 },
  }) },
];

const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/feed': { events: [] },
    '/api/projects': { roots: ['/w'], projects: PROJECTS },
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

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface RowMeasure { name: string; row: Box; cells: Record<'name' | 'key' | 'visibility' | 'template', Box>; keyLine: Box[]; select: Box; button: Box | null }
interface Measured {
  viewport: number; pageScrollWidth: number; pageClientWidth: number;
  section: { scrollWidth: number; clientWidth: number; box: Box };
  body: { scrollWidth: number; clientWidth: number; box: Box };
  rows: RowMeasure[];
  ellipsis: string[];
  clipped: string[];
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
  const body = one(el, '.linking-card');
  const rows = [...el.querySelectorAll('[data-linking-row]')].map((r): RowMeasure => {
    const button = r.querySelector('.linking-template button');
    return {
      name: r.getAttribute('data-linking-row') ?? '',
      row: box(r),
      cells: {
        name: box(one(r, '.linking-name')), key: box(one(r, '.linking-key')),
        visibility: box(one(r, '.linking-visibility')), template: box(one(r, '.linking-template')),
      },
      keyLine: [...r.querySelectorAll('.linking-key-line > *')].map(box),
      select: box(one(r, 'select')),
      button: button === null ? null : box(button),
    };
  });
  return {
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    section: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, box: box(el) },
    body: { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, box: box(body) },
    rows,
    ellipsis: [...el.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.tagName.toLowerCase()),
    // An element whose own content is wider than it is, or taller than it is where it hides the rest.
    clipped: [...el.querySelectorAll('*')]
      .filter((e) => e.tagName !== 'SELECT' && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
      .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
  };
};

const assertContained = (m: Measured, at: string): void => {
  expect(m.body.scrollWidth, `${at}: the card overflows sideways`).toBeLessThanOrEqual(m.body.clientWidth);
  expect(m.section.scrollWidth, `${at}: the section overflows sideways`).toBeLessThanOrEqual(m.section.clientWidth);
  expect(m.ellipsis, `${at}: text is cut short with an ellipsis`).toEqual([]);
  expect(m.clipped, `${at}: an element is wider than its box`).toEqual([]);
  expect(m.pageScrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClientWidth);
  expect(m.body.box.left, `${at}: the card starts left of the viewport`).toBeGreaterThanOrEqual(0);
  expect(m.body.box.right, `${at}: the card runs past the viewport`).toBeLessThanOrEqual(m.viewport);
  expect(m.section.box.width, `${at}: the card passes 960 px`).toBeLessThanOrEqual(960.5);
  for (const r of m.rows) {
    expect(r.row.right, `${at}: ${r.name} runs past the card`).toBeLessThanOrEqual(m.body.box.right + 0.5);
    for (const [cell, b] of Object.entries(r.cells)) {
      expect(b.right, `${at}: ${r.name}'s ${cell} cell runs past its row`).toBeLessThanOrEqual(r.row.right + 0.5);
    }
    expect(r.select.right, `${at}: ${r.name}'s select runs past its row`).toBeLessThanOrEqual(r.row.right + 0.5);
  }
};

/** The layout the card's own width asks for (settings.css's two container queries). */
const bandOf = (cardWidth: number): 'stack' | 'three' | 'line' => (cardWidth >= 760 ? 'line' : cardWidth >= 480 ? 'three' : 'stack');

const open = async (view: AppView) => {
  const app = await openApp(browser!, view, FIXTURE);
  await app.page.goto(server!.origin + '/settings/security');
  const section = app.page.locator('[data-linking="section"]');
  await section.locator('[data-linking-row]').first().waitFor({ timeout: 30_000 });
  return { ...app, section };
};

describe('Settings › Security › Project linking, per width, skin and theme (D-8147)', () => {
  for (const width of WIDTHS) {
    it(`no horizontal overflow and no clipped text at ${width}px, in both skins and both themes`, async () => {
      for (const skin of SKINS) {
        for (const theme of THEMES) {
          const view: AppView = { skin, theme, width };
          const { ctx, errors, section } = await open(view);
          try {
            expect(await section.getByRole('heading', { name: TITLE }).count()).toBe(1);
            const m = await section.evaluate(measure);
            const shots = process.env.CCRC_SHOTS;
            if (shots) await section.screenshot({ path: path.join(shots, `project-linking-${skin}-${theme}-${width}.png`) });
            expect(m.rows.map((r) => r.name), 'one row per project that carries a cell').toEqual(PROJECTS.map((p) => p.name));
            assertContained(m, named(view));

            const at = named(view);
            const cardWidth = m.body.box.width;
            for (const r of m.rows) {
              const band = bandOf(cardWidth);
              const { name, key, visibility, template } = r.cells;
              if (band === 'line') {
                // ONE grid line: the four cells start at the same height.
                for (const c of [key, visibility, template]) expect(Math.abs(c.top - name.top), `${at}: ${r.name} is not one grid line at ${cardWidth}px`).toBeLessThan(1);
                expect(key.left).toBeGreaterThan(name.left);
                expect(template.left).toBeGreaterThan(visibility.left);
              } else if (band === 'three') {
                // Name, key and visibility on one line, the template cell on the row under them.
                for (const c of [key, visibility]) expect(Math.abs(c.top - name.top), `${at}: ${r.name}'s first line at ${cardWidth}px`).toBeLessThan(1);
                expect(template.top, `${at}: ${r.name}'s template cell is not under the line at ${cardWidth}px`).toBeGreaterThan(name.top + 1);
              } else {
                // Stacked: each cell under the one before.
                expect(key.top).toBeGreaterThanOrEqual(name.bottom - 0.5);
                expect(visibility.top).toBeGreaterThanOrEqual(key.bottom - 0.5);
                expect(template.top).toBeGreaterThanOrEqual(visibility.bottom - 0.5);
                // The select is as wide as the card's row, and so is the template button.
                expect(r.select.width, `${at}: ${r.name}'s select is not full width`).toBeGreaterThan(r.row.width - 2);
                if (r.button !== null) expect(r.button.width, `${at}: ${r.name}'s button is not full width`).toBeGreaterThan(r.row.width - 2);
              }
              // The key field and Save share a line at 390 and wider (360 may wrap Save under the field).
              if (width >= 390) {
                const [field, save] = r.keyLine;
                expect(Math.abs(save!.top - field!.top), `${at}: ${r.name}'s Save is not beside its field (key cell ${Math.round(r.cells.key.width)}px, field ${Math.round(field!.width)}px, Save ${Math.round(save!.width)}px)`).toBeLessThan(8);
              }
            }
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }
      }
    }, 240_000);
  }

  it('at 1280 a row is one grid line wherever the card is 760 px or wider, and the template button wraps under it elsewhere', async () => {
    const seen: string[] = [];
    for (const skin of SKINS) {
      const view: AppView = { skin, theme: 'light', width: 1280 };
      const { ctx, section } = await open(view);
      try {
        const m = await section.evaluate(measure);
        const first = m.rows[0]!;
        const { name, key, visibility, template } = first.cells;
        seen.push(`${skin}: card ${Math.round(m.body.box.width)}px`);
        if (m.body.box.width >= 760) {
          for (const c of [key, visibility, template]) expect(Math.abs(c.top - name.top), `${skin} at 1280`).toBeLessThan(1);
        } else {
          for (const c of [key, visibility]) expect(Math.abs(c.top - name.top), `${skin} at 1280`).toBeLessThan(1);
          expect(template.top, `${skin} at 1280: the template cell wraps to the row's second line`).toBeGreaterThan(name.top + 1);
        }
      } finally {
        await ctx.close();
      }
    }
    expect(seen.length).toBe(SKINS.length);
  }, 120_000);
});
