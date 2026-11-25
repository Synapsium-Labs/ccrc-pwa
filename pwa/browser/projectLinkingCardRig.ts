// The shared half of the project linking card's browser files (landing-order wave 1e, D-9026): the fixture, the
// measures and the helpers that open Settings › Integrations in a real Chrome over the production build. Not a test file
// (no `*.browser.test.*` in its name, so the browser config does not collect it); `project-linking-card.browser.test.ts`
// and `project-linking-card-wide.browser.test.ts` import it. They are two files because vitest runs the cases of one
// file serially and CI's browser shards each have a fixed deadline, while files run in parallel: as one file its 22
// cases took 870 s in one merge-queue run. Each file starts Chrome and serves the shared build in its own `beforeAll`
// and hands both to `holdRig`, which `open` reads.
import { expect } from 'vitest';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { ProjectLinkingWire } from '../../shared/linking';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { openApp, type AppFixture, type AppView } from './app';
import type { Rig } from './wheel';

export const THEMES = [PHOSPHOR, 'light'];
export const SKINS = [REFINED, INSTRUMENT];
export const WIDTHS = [360, 390, 1280, 1470, 1920];
export const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

export const TITLE = SETTINGS_CARDS.integrations.linking.title;
export const NOW = Date.now();
export const LONG_NAME = 'a-project-with-a-deliberately-long-name-that-has-to-wrap-on-a-phone-screen';

export const wire = (over: Partial<ProjectLinkingWire>): ProjectLinkingWire => ({
  teamKey: 'KEY', override: null, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false,
  measured: { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: NOW - 3 * 3_600_000 },
  ...over,
});
export const LONG_TEAM = 'A team whose name is long enough that it has to wrap on a phone screen';
export const PROJECTS = [
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
    teamLink: { source: 'manual', at: NOW - 60_000 },
  }) },
  // Two projects with no team and nothing to decide: the group at the foot. project-f's key was cleared by hand.
  { name: 'project-e', workdir: '/w/project-e', linking: wire({ teamKey: null, measured: { state: 'unmeasured' }, mode: 'unknown' }) },
  { name: 'project-f', workdir: '/w/project-f', linking: wire({ teamKey: null, teamLink: { source: 'manual', at: NOW - 60_000 } }) },
];
/** What the list is, as `linkingList` decides it for this fixture: project-a and project-c share `KEY` with no owning project
 *  (project-a's map waits too, and its three inbound issues have no live owner), the long-named project has suggested teams,
 *  project-d is linked with nothing to decide. The rows that wait come first. */
export const LISTED = ['project-a', LONG_NAME, 'project-c', 'project-d'];
export const WAITING = ['project-a', LONG_NAME, 'project-c'];
export const UNLINKED = ['project-e', 'project-f'];
/** The controls each waiting row draws under its reasons (`LinkingDecision.control`), in the row's order. */
export const CONTROLS: Readonly<Record<string, string[]>> = { 'project-a': ['owning', 'map', 'owner'], [LONG_NAME]: ['key'], 'project-c': ['owning'] };

/** D-8405: the route answers one row per checkout directory, so project-a arrives three times; the card draws it once. */
export const SERVED = [...PROJECTS, { ...PROJECTS[0]!, workdir: '/w2/project-a' }, { ...PROJECTS[0]!, workdir: '/w3/project-a' }];

/** The hierarchy answer (D-8184): project-a and project-c share `KEY`, so their owning-project control draws too. */
export const LONG_COORD = 'cc-coord-with-a-rather-long-identifier-b';
export const HIER = {
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

export const FIXTURE: AppFixture = {
  api: {
    '/api/hierarchy': HIER,
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/feed': { events: [] },
    '/api/projects': { roots: ['/w'], projects: SERVED },
    // The one key write a case makes: project-d's key cleared. The answer is the stored row, as the route gives it.
    '/api/projects/project-d/linking': { ok: true, linking: wire({ teamKey: null, mode: 'unknown', measured: { state: 'failed', reason: 'not-ran', at: NOW - 60_000 }, teamLink: { source: 'manual', at: NOW } }) },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'coord', coord: { pause: 'clear' } }],
};

/** The Chrome and the server the importing file's `beforeAll` started; `open` reads them. */
let held: Rig | undefined;
export const holdRig = (rig: Rig): void => { held = rig; };

export interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
export interface RowMeasure {
  name: string; row: Box; cells: Record<'name' | 'key' | 'visibility' | 'template', Box>; keyLine: Box[]; select: Box; button: Box | null;
  /** The key cell is drawn under a reason, above the rest of the form, not in the form's first line. */
  keyLifted: boolean;
  /** An unlinked row's "More settings" button; null on a listed row. */
  plainMore: Box | null;
  /** D-8405: the automatic link's line and each candidate's button and evidence line. */
  extras: Box[];
}
/** D-8184: one row's hierarchy cell: where it sits, its owner cell and select (in the cell, or under a reason above it), its
 *  toggles and its state cell. */
export interface HierMeasure {
  cell: Box; owner: Box; ownerCell: Box; ownerLifted: boolean; toggles: Box; state: Box; owning: boolean; stateKids: Box[]; reshape: Box | null; reshapeText: string;
}
/** D-8184: the card's all-projects act: its box, label, select and button. */
export interface AllMeasure { box: Box; label: Box; select: Box; button: Box }
export interface Measured {
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
export const measure = (el: Element): Measured => {
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
      select: box(one(r, '.linking-visibility select')),
      button: button === null ? null : box(button),
      keyLifted: one(r, '.linking-key').closest('[data-linking-control]') !== null,
      plainMore: r.querySelector('.linking-plain > [data-linking-rest]') === null ? null : box(one(r, '.linking-plain > [data-linking-rest]')),
      extras: [...r.querySelectorAll('.linking-auto, .linking-candidate button, .linking-candidate p')].map(box),
    };
  });
  const hier: Record<string, HierMeasure> = {};
  for (const r of el.querySelectorAll('[data-linking-row]')) {
    const cell = r.querySelector('[data-linking-hier]');
    if (cell === null) continue;
    hier[r.getAttribute('data-linking-row') ?? ''] = {
      cell: box(cell), owner: box(one(r, '.linking-owner select')), ownerCell: box(one(r, '.linking-owner')),
      ownerLifted: one(r, '.linking-owner').closest('[data-linking-control]') !== null,
      toggles: box(one(cell, '.linking-toggles')), state: box(one(cell, '.linking-state')),
      // The Owning project box is in the row once: in the cell, or under the reason that names it.
      owning: r.querySelectorAll('[role="checkbox"]').length === 2,
      stateKids: [...cell.querySelectorAll('.linking-state > *')].map(box),
      reshape: cell.querySelector('.linking-reshape') === null ? null : box(one(cell, '.linking-reshape')),
      reshapeText: cell.querySelector('.linking-reshape')?.textContent ?? '',
    };
  }
  const allEl = one(el, '[data-linking-all]');
  const all: AllMeasure = { box: box(allEl), label: box(one(allEl, 'label')), select: box(one(allEl, 'select')), button: box(one(allEl, ':scope > button:not(.linking-more)')) };
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

export const assertContained = (m: Measured, at: string): void => {
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

/** The layout the card's own width asks for (settings.css's container queries): a row's form at 480 and 760, a row's line at 600. */
export const bandOf = (cardWidth: number): 'stack' | 'three' | 'line' => (cardWidth >= 760 ? 'line' : cardWidth >= 480 ? 'three' : 'stack');
export const LINE_COLUMNS = 600;

export const open = async (view: AppView) => {
  const app = await openApp(held!.browser, view, FIXTURE);
  await app.page.goto(held!.server.origin + '/settings/integrations');
  const section = app.page.locator('[data-linking="section"]');
  await section.locator('[data-linking-row]').first().waitFor({ timeout: 30_000 });
  // The hierarchy answer decides two of the reasons a row waits: wait for the row it opens.
  await section.locator('[data-linking-row="project-c"][data-linking-kind="decision"]').waitFor({ timeout: 30_000 });
  return { ...app, section };
};

/** Open every line, every "More settings" and the group, as an operator would by hand, so the controls can be measured. */
export const openAll = async (section: import('playwright-core').Locator): Promise<void> => {
  const group = section.locator('[data-linking-group] button[aria-expanded="false"]');
  if (await group.count() > 0) await group.click();
  await section.evaluate((el) => { for (const d of el.querySelectorAll('details')) d.open = true; });
  await section.evaluate((el) => { for (const b of el.querySelectorAll<HTMLElement>('[data-linking-rest][aria-expanded="false"]')) b.click(); });
  await section.locator('[data-linking-row] .linking-visibility select').last().waitFor({ timeout: 30_000 });
  expect(await section.locator('[data-linking-rest][aria-expanded="false"]').count(), 'every "More settings" is open').toBe(0);
};

export interface SlotMeasure { control: string | null; reasons: Box[]; controls: Box[] }
export interface LineMeasure {
  name: string; kind: string | null; hidden: boolean; row: Box; open: boolean | null; summary: Box | null;
  /** The line's parts, in order: the name, the team, the owner, the state. */
  parts: Box[];
  /** The flag and the notes, which wrap after the parts, or take the line under them in columns; null when the row has neither. */
  extra: Box | null; notes: string[]; flagged: boolean; reasons: number;
  /** A waiting row: each reason with its control, then "More settings" and what it has not shown. */
  slots: SlotMeasure[]; more: { expanded: string | null; box: Box; rest: Box } | null;
  /** What Tab reaches in the row as it is drawn. */
  stops: string[];
}
export interface ListMeasure {
  counts: string | null;
  order: string[]; group: { text: string; expanded: string | null; box: Box } | null; lines: LineMeasure[];
  body: Box; viewport: number; pageScrollWidth: number; pageClientWidth: number; ellipsis: string[]; clipped: string[];
}
/** The list as it is drawn, measured in the page. */
export const measureList = (el: Element): ListMeasure => {
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const button = el.querySelector('[data-linking-group] button');
  // Drawn, and reachable: not `hidden`, and not inside a shut disclosure (whose content keeps a box but is not rendered).
  const shown = (e: Element): boolean => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && e.checkVisibility() && (e.tagName === 'SUMMARY' || e.closest('details:not([open])') === null);
  };
  return {
    counts: el.querySelector('[data-linking-counts]')?.textContent ?? null,
    order: [...el.querySelectorAll('.linking-list > li')].map((li) => li.getAttribute('data-linking-row') ?? (li.hasAttribute('data-linking-group') ? '(group)' : '?')),
    group: button === null ? null : { text: button.textContent ?? '', expanded: button.getAttribute('aria-expanded'), box: box(button) },
    lines: [...el.querySelectorAll('[data-linking-row]')].map((r): LineMeasure => {
      const fold = r.querySelector(':scope > details');
      const summary = fold?.querySelector(':scope > summary') ?? null;
      return {
        name: r.getAttribute('data-linking-row') ?? '', kind: r.getAttribute('data-linking-kind'), hidden: r.hasAttribute('hidden'),
        row: box(r), open: fold === null ? null : (fold as HTMLDetailsElement).open, summary: summary === null ? null : box(summary),
        parts: [...r.querySelectorAll('.linking-line > .linking-name, .linking-line > [data-linking-sum]')].map(box),
        extra: r.querySelector('.linking-extra') === null ? null : box(r.querySelector('.linking-extra')!),
        notes: [...r.querySelectorAll('[data-linking-sum="note"]')].map((e) => e.textContent ?? ''),
        flagged: r.querySelector('[data-linking-flag]') !== null, reasons: r.querySelectorAll('[data-linking-decision]').length,
        slots: [...r.querySelectorAll('[data-linking-control]')].map((slot): SlotMeasure => ({
          control: slot.getAttribute('data-linking-control'),
          reasons: [...slot.querySelectorAll('[data-linking-decision]')].map(box),
          controls: [...slot.querySelectorAll('input, select, button, a[href], [role="checkbox"]')].filter(shown).map(box),
        })),
        more: (() => {
          const b = r.querySelector('details [data-linking-rest]');
          const rest = b === null ? null : document.getElementById(b.getAttribute('aria-controls') ?? '');
          return b === null || rest === null ? null : { expanded: b.getAttribute('aria-expanded'), box: box(b), rest: box(rest) };
        })(),
        stops: [...r.querySelectorAll<HTMLElement>('summary, input, select, button, a[href], [role="checkbox"]')]
          .filter((e) => shown(e) && !(e as HTMLButtonElement).disabled)
          .map((e) => (e.tagName === 'SUMMARY' ? 'line' : e.tagName === 'INPUT' ? 'key' : e.tagName === 'SELECT' ? 'select' : (e.textContent ?? ''))),
      };
    }),
    body: box(el.querySelector('.linking-card')!),
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    ellipsis: [...el.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.tagName.toLowerCase()),
    clipped: [...el.querySelectorAll('*')]
      .filter((e) => e.tagName !== 'SELECT' && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
      .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
  };
};

