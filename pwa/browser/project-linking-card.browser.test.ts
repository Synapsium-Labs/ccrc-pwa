// Settings › Security › Project linking (the linking standard, D-8147; plan Task 8's width table), in a real Chrome over
// the production build, at 360, 390, 1280, 1470 and 1920, in both skins and both themes. `test/project-linking-card.test.tsx`
// holds the card's behaviour in jsdom; this file holds what only an engine can say:
//   * nothing in the card or on the page scrolls sideways, and no text is cut short or clipped (no ellipsis, no element
//     scrolling inside itself), with a long project name that has to wrap;
//   * the layout follows the card's own width, not the window's (a container query): under 480 a row stacks, from 480 its
//     name, key and visibility share a line with the template cell under them, from 760 name, key, visibility and the
//     template cell share ONE grid line. The hierarchy cell sits under that: its owner select takes a line of its own, and
//     the toggles and the state line share the one under it. So a row is four lines from 480 to under 760 of card width
//     (cells, template, owner, toggles and state) and three from 760 up (D-8184; the assertions in `describe` below);
//   * on a phone the key field and Save share a line, and the select and the template button are as wide as the card;
//   * D-8405: a project the route answers once per checkout directory is ONE row, and the automatic link's line and the
//     candidates' one-tap buttons (long team names and evidence) wrap inside the key cell, at every width and skin.
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
import { HIERARCHY_TEXT } from '../src/fleet/hierarchyWords';
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
const LONG_TEAM = 'A team whose name is long enough that it has to wrap on a phone screen';
const PROJECTS = [
  { name: 'project-a', workdir: '/w/project-a', linking: wire({
    teamLink: { source: 'auto', teamName: LONG_TEAM, evidence: { kind: 'ticket-ids', ids: 1234, of: 1250 }, at: NOW - 60_000 },
  }) },
  { name: LONG_NAME, workdir: `/w/${LONG_NAME}`, linking: wire({
    teamKey: null, measured: { state: 'unmeasured' }, mode: 'unknown',
    teamCandidates: [
      { key: 'ABCDEFGHIJKLMNOP', name: LONG_TEAM, evidence: { kind: 'name-match', matched: 'repo', on: 'name' } },
      { key: 'BBB', name: 'Beta', evidence: { kind: 'name-match', matched: 'project', on: 'key' } },
    ],
  }) },
  { name: 'project-c', workdir: '/w/project-c', linking: wire({
    override: 'public', mode: 'public',
    measured: { state: 'measured', visibility: 'public', slug: 'owner/repo', template: 'present', at: NOW - 60_000 },
  }) },
  { name: 'project-d', workdir: '/w/project-d', linking: wire({
    teamKey: 'ABCDE', mode: 'unknown', measured: { state: 'failed', reason: 'not-ran', at: NOW - 60_000 },
  }) },
];

/** D-8405: the route answers one row per checkout directory, so project-a arrives three times; the card draws it once. */
const SERVED = [...PROJECTS, { ...PROJECTS[0]!, workdir: '/w2/project-a' }, { ...PROJECTS[0]!, workdir: '/w3/project-a' }];

/** The hierarchy answer (D-8184): project-a and project-c share `KEY`, so their owning-project control draws too. */
const LONG_COORD = 'cc-coord-with-a-rather-long-identifier-b';
const HIER = {
  ok: true,
  coordinators: [{ id: 'cc-coord-a', live: true }, { id: LONG_COORD, live: false }],
  projects: [...new Set(PROJECTS.map((p) => p.name))].map((project, i) => ({
    project, teamKey: PROJECTS.find((p) => p.name === project)!.linking.teamKey, initiatives: 'on',
    // A7: project-a names the long coordinator (its select SHOWS that long value, "<id> (not live)"); project-c, which shares the
    // key and names no owner, SHOWS the longest empty option the select can now say: "Default: <id> (not live)", the default
    // rule's long coordinator from `ifUnnamed` (D-8738). Where the inherited owner comes from is a separate note under the
    // select, no longer part of the option.
    linearOwner: i === 0 ? LONG_COORD : null,
    ownerNow: project === 'project-c' ? { id: LONG_COORD, source: 'named', live: false, project: 'project-a', ifUnnamed: { id: LONG_COORD, live: false } }
      : i === 0 ? { id: LONG_COORD, source: 'named', live: false } : { id: 'cc-coord-a', source: 'default', live: true },
    ownsTeam: false,
    state: i === 0 ? 'map-waiting' : i === 1 ? 'migrated' : 'not-migrated', stateAt: NOW - 86_400_000, itemId: i === 0 ? 7 : null,
    inboundWaiting: i === 0 ? 3 : 0,
  })),
};

const FIXTURE: AppFixture = {
  api: {
    '/api/hierarchy': HIER,
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/feed': { events: [] },
    '/api/projects': { roots: ['/w'], projects: SERVED },
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
interface RowMeasure {
  name: string; row: Box; cells: Record<'name' | 'key' | 'visibility' | 'template', Box>; keyLine: Box[]; select: Box; button: Box | null;
  /** D-8405: the automatic link's line and each candidate's button and evidence line. */
  extras: Box[];
}
/** D-8184: one row's hierarchy cell: where it sits, its owner select, and its parts. */
interface HierMeasure { cell: Box; owner: Box; parts: Box[]; owning: boolean; stateKids: Box[] }
/** D-8184: the card's all-projects act: its box, label, select and button. */
interface AllMeasure { box: Box; label: Box; select: Box; button: Box }
interface Measured {
  all: AllMeasure;
  hier: Record<string, HierMeasure>;
  viewport: number; pageScrollWidth: number; pageClientWidth: number;
  section: { scrollWidth: number; clientWidth: number; box: Box };
  body: { scrollWidth: number; clientWidth: number; box: Box };
  rows: RowMeasure[];
  ellipsis: string[];
  clipped: string[];
  /** A7: a select whose shown (selected) option text is wider than its content box, which `scrollWidth` does not see. */
  clippedSelects: string[];
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
      extras: [...r.querySelectorAll('.linking-auto, .linking-candidate button, .linking-candidate p')].map(box),
    };
  });
  const hier: Record<string, HierMeasure> = {};
  for (const r of el.querySelectorAll('[data-linking-row]')) {
    const cell = r.querySelector('[data-linking-hier]');
    if (cell === null) continue;
    hier[r.getAttribute('data-linking-row') ?? ''] = {
      cell: box(cell), owner: box(one(cell, '.linking-owner select')),
      parts: [...cell.querySelectorAll('.linking-owner, .linking-toggles, .linking-state')].map(box),
      owning: cell.querySelectorAll('[role="checkbox"]').length === 2,
      stateKids: [...cell.querySelectorAll('.linking-state > *')].map(box),
    };
  }
  const allEl = one(el, '[data-linking-all]');
  const all: AllMeasure = { box: box(allEl), label: box(one(allEl, 'label')), select: box(one(allEl, 'select')), button: box(one(allEl, 'button')) };
  return {
    all,
    hier,
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
    // A7: a select's shown value is drawn inside its own box, so `scrollWidth` never trips on it. Measure the selected option's
    // text in the select's own font against the content box less the platform's disclosure arrow (the system's Select keeps the
    // native one, `appearance` not reset; 24px is its width plus the gap, measured generously for Chrome, not for the text).
    clippedSelects: [...el.querySelectorAll('select')].flatMap((s) => {
      const cs = getComputedStyle(s);
      const ctx = document.createElement('canvas').getContext('2d')!;
      // The shorthand serializes empty when the engine cannot express the font as one: say so, never measure in the 10px default.
      if (cs.font === '') return [`${s.closest('[data-linking-row]')?.getAttribute('data-linking-row') ?? 'all'}: computed font is empty`];
      ctx.font = cs.font;
      const text = s.selectedOptions[0]?.textContent ?? '';
      const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24;
      const need = ctx.measureText(text).width;
      return need > room ? [`${s.closest('[data-linking-row]')?.getAttribute('data-linking-row') ?? 'all'}: "${text}" needs ${Math.ceil(need)}px of ${Math.floor(room)}px`] : [];
    }),
  };
};

const assertContained = (m: Measured, at: string): void => {
  expect(m.body.scrollWidth, `${at}: the card overflows sideways`).toBeLessThanOrEqual(m.body.clientWidth);
  expect(m.section.scrollWidth, `${at}: the section overflows sideways`).toBeLessThanOrEqual(m.section.clientWidth);
  expect(m.ellipsis, `${at}: text is cut short with an ellipsis`).toEqual([]);
  expect(m.clipped, `${at}: an element is wider than its box`).toEqual([]);
  // A7: every ordinary value shows whole at every width. The one very long coordinator id (LONG_COORD) is checked at 1280 and up
  // only: no select can show an arbitrarily long id on a phone, where the picker lists it in full.
  const phone = m.viewport < 1280;
  expect(m.clippedSelects.filter((c) => !(phone && c.includes(LONG_COORD))), `${at}: a select shows only part of its value`).toEqual([]);
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
    for (const e of r.extras) {
      expect(e.right, `${at}: ${r.name}'s team link text runs past its key cell`).toBeLessThanOrEqual(r.cells.key.right + 0.5);
      expect(e.left, `${at}: ${r.name}'s team link text starts left of its key cell`).toBeGreaterThanOrEqual(r.cells.key.left - 0.5);
    }
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
            expect(m.rows[0]!.extras.length, 'project-a\'s automatic link line').toBe(1);
            expect(m.rows[1]!.extras.length, 'two candidates, each a button and an evidence line').toBe(4);
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
            // D-8184: every project's row has its hierarchy cell inside it; the owning-project control draws for the shared key only.
            expect(Object.keys(m.hier), `${at}: a hierarchy cell per row`).toEqual(PROJECTS.map((p) => p.name));
            expect(Object.entries(m.hier).filter(([, h]) => h.owning).map(([n]) => n).sort(), `${at}: the shared key`).toEqual(['project-a', 'project-c']);
            for (const r of m.rows) {
              const h = m.hier[r.name]!;
              expect(h.cell.right, `${at}: ${r.name}'s hierarchy cell runs past its row`).toBeLessThanOrEqual(r.row.right + 0.5);
              expect(h.cell.top, `${at}: ${r.name}'s hierarchy cell is not under the first line`).toBeGreaterThan(r.cells.name.top + 1);
              const [owner, toggles, state] = h.parts as [Box, Box, Box];
              if (cardWidth < 480) {
                expect(h.owner.width, `${at}: ${r.name}'s owner select is not full width`).toBeGreaterThan(r.row.width - 2);
                expect(toggles.top).toBeGreaterThanOrEqual(owner.bottom - 0.5);
                expect(state.top).toBeGreaterThanOrEqual(toggles.bottom - 0.5);
              } else {
                // A7: the owner select has the hierarchy cell's first line; the toggles and the state line share the one under it.
                expect(Math.abs(state.top - toggles.top), `${at}: ${r.name}'s second line at ${cardWidth}px`).toBeLessThan(1);
                expect(toggles.top, `${at}: ${r.name}'s toggles are not under the owner select`).toBeGreaterThanOrEqual(owner.bottom - 0.5);
              }
            }
            // The all-projects act sits at the card's end, under every row, and wraps nothing past the card.
            const { all } = m;
            expect(all.box.top, `${at}: the all-projects act is not at the card's end`).toBeGreaterThanOrEqual(m.rows[m.rows.length - 1]!.row.bottom - 0.5);
            expect(all.box.right, `${at}: the all-projects act runs past the card`).toBeLessThanOrEqual(m.body.box.right + 0.5);
            if (cardWidth < 480) {
              expect(all.select.width, `${at}: the all-projects select is not full width`).toBeGreaterThan(all.box.width - 2);
              expect(all.button.width, `${at}: the all-projects button is not full width`).toBeGreaterThan(all.box.width - 2);
              expect(all.button.top).toBeGreaterThanOrEqual(all.select.bottom - 0.5);
            } else {
              expect(all.button.left, `${at}: the all-projects button is not beside its select`).toBeGreaterThanOrEqual(all.select.right - 0.5);
              expect(Math.abs(all.button.bottom - all.select.bottom), `${at}: the all-projects button and select do not share a line`).toBeLessThan(2);
            }
            // The state line wraps inside its cell, never past it (project-a's reads "3 inbound issues wait for an owner").
            for (const r of m.rows) {
              const h = m.hier[r.name]!;
              for (const k of h.stateKids) expect(k.right, `${at}: ${r.name}'s state line runs past its cell`).toBeLessThanOrEqual(h.parts[2]!.right + 0.5);
            }
            expect(errors).toEqual([]);
          } finally {
            await ctx.close();
          }
        }
      }
    }, 240_000);
  }

  for (const width of [360, 1920]) {
    it(`a failed re-read after a write shows the stale note and Read again, contained, at ${width}px`, async () => {
      for (const skin of SKINS) {
        const view: AppView = { skin, theme: 'light', width };
        const { ctx, page, errors, section } = await open(view);
        try {
          // The hierarchy read fails from now on: the write below saves (the fixture answers it), and its re-read is refused.
          await ctx.route('**/api/hierarchy', (route) => route.abort('failed'));
          await section.locator('[data-linking-row="project-a"]').getByRole('checkbox', { name: HIERARCHY_TEXT.initiatives }).click();
          const note = section.locator('.linking-stale');
          await note.waitFor({ timeout: 30_000 });
          expect(await note.getByRole('button', { name: HIERARCHY_TEXT.readAgain }).count()).toBe(1);
          const m = await section.evaluate(measure);
          assertContained(m, named(view));
          const box = await note.boundingBox();
          const card = await section.locator('.linking-card').boundingBox();
          expect(box!.x, `${named(view)}: the stale note starts left of the card`).toBeGreaterThanOrEqual(card!.x - 0.5);
          expect(box!.x + box!.width, `${named(view)}: the stale note runs past the card`).toBeLessThanOrEqual(card!.x + card!.width + 0.5);
          const button = await note.getByRole('button').boundingBox();
          expect(button!.width, `${named(view)}: Read again keeps its usual size`).toBeLessThan(box!.width);
          const shots = process.env.CCRC_SHOTS;
          if (shots) await section.screenshot({ path: path.join(shots, `project-linking-stale-${skin}-${width}.png`) });
          void page;
          expect(errors.filter((e) => !/Failed to fetch|net::ERR/.test(e))).toEqual([]);
        } finally {
          await ctx.close();
        }
      }
    }, 120_000);
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
