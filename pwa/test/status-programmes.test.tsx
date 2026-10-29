// Instrument's Status view shows programmes, not children (Task G3, D-7333; spec §2.7). In status mode a child session
// never draws as a row of its own: a coordinator's open work is its programme's box (G2's `ProgrammeBox`), and a child
// is drawn only inside that box, only while it asks the operator. The groups are Needs you (the boxes that need the
// operator, then the sessions in no programme that do), Programmes (the other boxes), then today's groups for the
// sessions in no programme; every group counts what it draws, a box as one. The decision is `statusGroups.ts`'s
// (`statusView`), and `FleetTable` draws it. Project mode, and its bucket bar, are unchanged.
//
// RED FIRST on main (34ee3e3f8): every case below failed there but the bucket bar's, which pins project mode unchanged and
// so passes on main by design, the status view drawing each child as a row of its own status group with no box and no
// Programmes group, and the phone's tabs reading Needs you, Done, Working, All.
//
// MUTATION TABLE (plan Task G3 Step 3; RUN, each mutant on the working tree, one at a time, with this suite,
// status-groups.test.ts and instrument-list.test.tsx (the browser rows: instrument-desk.browser.test.ts -t "programmes"),
// then restored from a saved copy with its sha256 checked; 23 run, 23 red; instrument-shell holds one more):
//   a child row drawn outside its box (members not hidden) ..... 15 cases, here, status-groups and instrument-list
//   counts taken from sessions (a box as its coordinator and
//     children) instead of drawn rows ......................... 9 cases, "every group counts what it draws…" among them
//   the tray showing every member ............................... 8 cases, "the needing box's tray shows only the child that asks…" among them
//   the tray dropping the session the operator has open ......... "the session the operator has open stays in its box's tray…", here and in status-groups
//   the open session making its box need you .................... status-groups' open-session case
//   Programmes taking the needing boxes too ..................... 13 cases, "the groups are Needs you…" among them
//   Programmes after Done (its order 1.5) ....................... 6 cases, statusGroups' order case among them
//   far workers not members ..................................... "a far worker that asks is drawn in its coordinator's box…", and 4 in status-groups
//   a box's needs ignoring its far workers' asks ................ status-groups' "a box that needs you only through a far worker…"
//   Needs you never held ........................................ instrument-list's held case, status-groups' held case
//   Mark all seen leaving the coordinators out .................. "Mark all seen covers what a group draws…", here and in status-groups
//   Programmes' door named for Needs you ........................ 3 cases, "Mark all seen covers what a group draws…" among them
//   the All tab counting sessions ............................... "Programmes is the tab after Needs you, and every tab counts what its group draws"
//   PHONE_TABS without Programmes ............................... 4 cases, both phone cases here among them
//   a head counting its rows only ............................... 6 cases, "every group counts what it draws…" among them
//   the boxes not drawn ......................................... 11 cases
//   the kicker without the project .............................. "a box's kicker names its project as well as its programme"
//   the far-worker line drawn in the status box ................. "a far worker that asks is drawn in its coordinator's box…"
//   a tray handed a summary row (a footer) ...................... status-groups' tray case (`ProgrammeBox`'s mode draws no footer either way)
//   `.ins-tab` back to equal parts (`flex: 1 1 0`) .............. browser: the 360 case and both 390 cases (`its words fit its tab`)
//   `.ins-tabs` without `overflow-x: auto` ...................... browser: the 360 case (`the tablist scrolls inside itself`)
//   `.ins-tab` without `width: auto` (the button's full width) .. browser: both 390 cases (`<tab>: in view`)
//   the chosen tab not scrolled into view ....................... browser: the 360 case (`the chosen tab is scrolled into view`)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../shared/api';
import { asking, run, sess } from './rollupFixture';

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { api } = await import('../src/lib/api');
const { GROUP_MODE_KEY } = await import('../src/skins/instrument/FleetTable');
const { fleetHues } = await import('../src/fleet/programmeBoxes');

const TABLE_SRC = readFileSync(path.join(import.meta.dirname, '..', 'src', 'skins', 'instrument', 'FleetTable.tsx'), 'utf8');

const coordinator = (id: string, project: string, over: Partial<FleetSession> = {}): FleetSession =>
  sess(id, project, { role: 'coordinator', name: id, bucket: 'working', status: 'busy', ...over });

/** Two coordinators: `coord-a` (project-a) needs you through its child `a1`, and `coord-b` (project-b) has sat quiet
 *  for five hours, past the stall watch's threshold. Five children, and four sessions in no programme, one asking. */
const SESSIONS: FleetSession[] = [
  coordinator('coord-a', 'project-a'),
  sess('a1', 'project-a', asking({ ask: { state: 'held', parentId: 'coord-a', answeredBy: null } })),
  sess('a2', 'project-a', { bucket: 'working', status: 'busy' }),
  sess('a3', 'project-a', { bucket: 'done' }),
  coordinator('coord-b', 'project-b', { bucket: 'idle', status: 'idle' }),
  sess('b1', 'project-b', { bucket: 'working', status: 'busy' }),
  sess('b2', 'project-b', { bucket: 'idle' }),
  sess('lone-ask', 'project-a', asking({ ask: null })),
  sess('lone-done', 'project-a', { bucket: 'done' }),
  sess('lone-work', 'project-a', { bucket: 'working', status: 'busy' }),
  sess('lone-idle', 'project-a', { bucket: 'idle' }),
];
const RUNS: RunSummary[] = [
  ...['a1', 'a2', 'a3'].map((id, i) => run(i + 1, 'coord-a', id, { program: 'prog-a', programTitle: 'Programme A', project: 'project-a' })),
  ...['b1', 'b2'].map((id, i) => run(i + 4, 'coord-b', id, { program: 'prog-b', programTitle: 'Programme B', project: 'project-b' })),
];
const CHILDREN = ['a1', 'a2', 'a3', 'b1', 'b2'];

function stubWidth(desk: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') ? desk : q.includes('pointer: fine') ? desk : false,
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

function mount(sessions: FleetSession[] = SESSIONS, runs: RunSummary[] = RUNS): void {
  act(() => useFleetStore.setState({ conn: 'open', sessions, runs, runsFrameSeen: true, fleetFrameSeen: true }));
  navigate('/');
  render(<App />);
}

const table = (): HTMLElement => document.querySelector<HTMLElement>('.ins-table')!;
const groups = (): HTMLElement[] => [...table().querySelectorAll<HTMLElement>('[data-status-group]')];
const groupIds = (): string[] => groups().map((g) => g.getAttribute('data-status-group')!);
const groupOf = (id: string): HTMLElement => table().querySelector<HTMLElement>(`[data-status-group="${id}"]`)!;
const head = (g: HTMLElement): HTMLElement => g.querySelector<HTMLElement>('.ins-group-head')!;
const words = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const rowIds = (el: Element): string[] => [...el.querySelectorAll<HTMLElement>('[data-row]')].map((r) => r.getAttribute('data-row')!);
const boxes = (el: Element): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('section.pg-box')];
/** A box's coordinator: the row in its coordinator band. */
const boxOf = (el: Element, coord: string): HTMLElement =>
  boxes(el).find((b) => rowIds(b.querySelector('.pg-coord')!).includes(coord))!;
/** The rows a group draws outside any box. */
const looseRows = (g: HTMLElement): string[] =>
  [...g.querySelectorAll<HTMLElement>('[data-row]')].filter((r) => r.closest('section.pg-box') === null).map((r) => r.getAttribute('data-row')!);
/** The number the head prints: `Needs you · 2`. */
const headCount = (g: HTMLElement): number => Number(/· (\d+)/.exec(words(head(g)))![1]);
const pick = (mode: 'Status' | 'Project'): void => {
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Group sessions by' })).getByRole('radio', { name: mode }));
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  initSkin();
  act(() => { setSkin(INSTRUMENT); });
  stubWidth(true);
  vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], runs: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
  act(() => { setSkin(REFINED); });
  localStorage.clear();
});

describe("Instrument's Status view shows programmes, not children (G3, D-7333)", () => {
  it('no child row is drawn outside a box, and a child that does not ask is not drawn at all', () => {
    mount();
    for (const id of CHILDREN) {
      for (const r of table().querySelectorAll<HTMLElement>(`[data-row="${id}"]`)) {
        expect(r.closest('section.pg-box'), id).not.toBeNull();
      }
    }
    expect(rowIds(table()).filter((id) => CHILDREN.includes(id))).toEqual(['a1']);
    // The coordinators are their boxes' heads, never a loose row.
    for (const g of groups()) expect(looseRows(g).filter((id) => id.startsWith('coord-')), g.dataset.statusGroup).toEqual([]);
  });

  it('the groups are Needs you (the needing box, then the lone ask), Programmes (the other box), then today\'s groups', () => {
    mount();
    expect(groupIds()).toEqual(['attention', 'programmes', 'done', 'working', 'idle']);
    expect(words(head(groupOf('attention')))).toMatch(/^▾\s*Needs you · 2/);
    expect(words(head(groupOf('programmes')))).toMatch(/^▾\s*Programmes · 1/);
    const needs = groupOf('attention');
    const box = boxOf(needs, 'coord-a');
    expect(boxes(needs)).toEqual([box]);
    expect(box.getAttribute('data-state')).toBe('needs');
    // The box comes first, then the session in no programme that asks.
    const lone = needs.querySelector<HTMLElement>('[data-row="lone-ask"]')!;
    expect(box.compareDocumentPosition(lone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(looseRows(needs)).toEqual(['lone-ask']);
    expect(boxes(groupOf('programmes')).map((b) => rowIds(b.querySelector('.pg-coord')!))).toEqual([['coord-b']]);
    expect(looseRows(groupOf('programmes'))).toEqual([]);
    // The sessions in no programme keep today's groups.
    expect(looseRows(groupOf('done'))).toEqual(['lone-done']);
    expect(looseRows(groupOf('working'))).toEqual(['lone-work']);
  });

  it('every group counts what it draws: a box counts one, and a hidden child counts nowhere', () => {
    mount();
    fireEvent.click(head(groupOf('idle')));
    for (const g of groups()) {
      expect(head(g).getAttribute('aria-expanded'), g.dataset.statusGroup).toBe('true');
      expect(headCount(g), g.dataset.statusGroup).toBe(boxes(g).length + looseRows(g).length);
    }
    expect(groups().map(headCount)).toEqual([2, 1, 1, 1, 1]);
  });

  it("the needing box's tray shows only the child that asks, with its ask; the box does not fold and has no footer", () => {
    mount();
    const box = boxOf(groupOf('attention'), 'coord-a');
    const tray = box.querySelector<HTMLElement>('.pg-tray')!;
    expect(rowIds(tray)).toEqual(['a1']);
    expect(tray.querySelector('.sess-lamp')?.getAttribute('data-status')).toBe('attention');
    // Three children would fold under a footer in a project card; here there is no footer and no toggle.
    expect(box.querySelector('.pg-foot')).toBeNull();
    expect(table().querySelector('.proj-children-toggle')).toBeNull();
    // The quiet box draws no tray at all: none of its children asks.
    expect(boxOf(groupOf('programmes'), 'coord-b').querySelector('.pg-tray')).toBeNull();
  });

  it("the session the operator has open stays in its box's tray, though it does not ask (G3's Step 0 ruling)", () => {
    act(() => useFleetStore.setState({ conn: 'open', sessions: SESSIONS, runs: RUNS, runsFrameSeen: true, fleetFrameSeen: true }));
    navigate('/s/a2');
    render(<App />);
    const tray = boxOf(groupOf('attention'), 'coord-a').querySelector<HTMLElement>('.pg-tray')!;
    expect(rowIds(tray)).toEqual(['a1', 'a2']);
    // Drawn in its box, it is still counted nowhere: the box counts one.
    expect(headCount(groupOf('attention'))).toBe(2);
    expect(rowIds(table()).filter((id) => ['a3', 'b1', 'b2'].includes(id))).toEqual([]);
  });

  it('Mark all seen covers what a group draws, coordinators included: Programmes says "n new" and offers its own door', () => {
    const now = Date.now();
    const sessions = SESSIONS.map((s) => (s.id === 'coord-b' ? { ...s, bucket: 'done' as const, status: 'idle' as const, bucketSince: now } : s));
    mount(sessions);
    const programmes = groupOf('programmes');
    expect(words(head(programmes))).toMatch(/Programmes · 1 · 1 new$/);
    const door = within(programmes).getByRole('button', { name: 'Mark all seen, Programmes' });
    fireEvent.click(door);
    expect(within(programmes).queryByRole('button', { name: /^Mark all/ })).toBeNull();
    expect(document.activeElement).toBe(head(programmes));
    expect(within(table()).getByRole('status')).toHaveTextContent('Programmes: 1 marked seen');
  });

  it("a box's kicker names its project as well as its programme", () => {
    mount();
    const kicker = (coord: string, g: string): string => words(boxOf(groupOf(g), coord).querySelector('.pg-kicker')!);
    expect(kicker('coord-a', 'attention')).toContain('Programme A');
    expect(kicker('coord-a', 'attention')).toContain('project-a');
    expect(kicker('coord-b', 'programmes')).toContain('Programme B');
    expect(kicker('coord-b', 'programmes')).toContain('project-b');
  });

  it("a programme's hue is the fleet's (D-7369): the same here as in project mode", () => {
    mount();
    const hues = fleetHues(RUNS);
    const here = boxOf(groupOf('attention'), 'coord-a').getAttribute('data-hue');
    expect(here).toBe(hues.get('prog-a'));
    expect(boxOf(groupOf('programmes'), 'coord-b').getAttribute('data-hue')).toBe(hues.get('prog-b'));
    pick('Project');
    // A card's rows carry no data-row: the coordinator band is found by its label.
    const card = boxes(table()).find((b) => b.querySelector('.pg-coord .sess-label')?.textContent === 'coord-a')!;
    expect(card.getAttribute('data-hue')).toBe(here);
  });

  it('the bucket bar above project mode is unchanged: it counts sessions, children included', () => {
    window.localStorage.setItem(GROUP_MODE_KEY, 'project');
    mount();
    const chips = [...table().querySelectorAll('.bucket-bar .bucket-head')].map((c) =>
      `${words(c.querySelector('.bucket-head-label')!)} ${words(c.querySelector('.bucket-head-count')!)}`);
    expect(chips).toEqual(['Needs you 2', 'Done 2', 'Idle 3', 'Working 4']);
    // Project mode draws its cards as G2 shipped them: the children toggle is there.
    expect(table().querySelector('.proj-children-toggle')).not.toBeNull();
  });

  it("a far worker that asks is drawn in its coordinator's box; one that does not is drawn nowhere", () => {
    const sessions = [
      ...SESSIONS,
      sess('far-ask', 'project-b', asking({ ask: { state: 'held', parentId: 'coord-a', answeredBy: null } })),
      sess('far-work', 'project-b', { bucket: 'working', status: 'busy' }),
    ];
    const runs = [
      ...RUNS,
      run(6, 'coord-a', 'far-ask', { program: 'prog-a', programTitle: 'Programme A', project: 'project-b' }),
      run(7, 'coord-a', 'far-work', { program: 'prog-a', programTitle: 'Programme A', project: 'project-b' }),
    ];
    mount(sessions, runs);
    expect(rowIds(boxOf(groupOf('attention'), 'coord-a').querySelector('.pg-tray')!)).toEqual(['a1', 'far-ask']);
    expect(rowIds(table()).filter((id) => id.startsWith('far-'))).toEqual(['far-ask']);
    // The box's own far-worker line belongs to the project card, not to this view.
    expect(table().querySelector('.proj-abroad')).toBeNull();
    expect(headCount(groupOf('attention'))).toBe(2);
  });

  it('a worker whose coordinator is on no box stays a row of its own, so nothing is lost', () => {
    const sessions = [...SESSIONS, sess('orphan', 'project-a', { bucket: 'working', status: 'busy' })];
    mount(sessions, [...RUNS, run(8, 'gone-coord', 'orphan', { program: 'prog-c', project: 'project-a' })]);
    expect(looseRows(groupOf('working'))).toEqual(expect.arrayContaining(['orphan']));
    expect(headCount(groupOf('working'))).toBe(2);
  });

  it('a box whose coordinator itself asks is in Needs you', () => {
    const sessions = SESSIONS.map((s) => (s.id === 'coord-b' ? { ...s, ...asking({ ask: null }) } : s));
    mount(sessions);
    expect(boxes(groupOf('attention')).map((b) => b.getAttribute('data-state'))).toEqual(['needs', 'needs']);
    expect(groupIds()).not.toContain('programmes');
    expect(headCount(groupOf('attention'))).toBe(3);
  });

  it('the status view makes no decision itself: its groups come from statusGroups.ts', () => {
    const code = TABLE_SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toMatch(/\bstatusView\(/);
    expect(code).not.toMatch(/\bprogrammeBoxes\(|\brankBoxes\(|\bboxState\(|\boperatorAsk\(/);
    // The child crumb is gone from status mode (project mode never drew it).
    expect(code).not.toMatch(/ins-coord-crumb|\bparentIdOf\b/);
  });
});

describe('on a phone (G3, D-7333)', () => {
  const tablist = (): HTMLElement => screen.getByRole('tablist', { name: 'Sessions by status' });
  const tab = (name: RegExp): HTMLElement => within(tablist()).getByRole('tab', { name });

  it('Programmes is the tab after Needs you, and every tab counts what its group draws', () => {
    stubWidth(false);
    mount();
    const tabs = within(tablist()).getAllByRole('tab');
    expect(tabs.map((t) => words(t))).toEqual(['Needs you 2', 'Programmes 1', 'Done 1', 'Working 1', 'All 6']);
  });

  it('the Needs you tab lands on the Needs you group: the box that needs you, then the lone ask', () => {
    stubWidth(false);
    mount();
    fireEvent.click(tab(/^Needs you/));
    expect(tab(/^Needs you/).getAttribute('aria-selected')).toBe('true');
    expect(groupIds()).toEqual(['attention']);
    expect(boxes(groupOf('attention'))).toHaveLength(1);
    expect(looseRows(groupOf('attention'))).toEqual(['lone-ask']);
    fireEvent.click(tab(/^Programmes/));
    expect(groupIds()).toEqual(['programmes']);
    expect(boxes(groupOf('programmes'))).toHaveLength(1);
    // The arrow keys rove over the new tab too: Programmes, then Needs you, back.
    fireEvent.keyDown(tablist(), { key: 'ArrowLeft' });
    expect(tab(/^Needs you/).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist(), { key: 'ArrowRight' });
    expect(tab(/^Programmes/).getAttribute('aria-selected')).toBe('true');
  });
});
