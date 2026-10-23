// Instrument's list column (W2 Task S10, D-5473): the status-grouped table, the status · project toggle and the phone
// tabs. Each case mounts the whole `App` under Instrument, at a desk width or a phone's, with a fleet that has a row in
// every bucket and a coordinator with a child; or reads `instrument.css` / `FleetTable.tsx` where the claim is the
// file's (jsdom applies no media query and lays nothing out, so the PR's real-browser renders measure the pixels).
//
// RED FIRST, on the task's base: this file did not compile there (no `skins/instrument/FleetTable.tsx`).
//
// MUTATION TABLE (plan Task S10 Step 3; RUN, each mutant on a `git archive` copy, this suite alone):
//   project mode without the per-row word ................ "…each row shows its word beside its lamp"
//   FleetTable.tsx given its own WORD record ............. "the table renders SessionLine and defines no state-word table"
//   archive-all dropped from Instrument's project cards .. "project mode's cards hold the pool and archive-all doors…"
//   the toggle as two aria-pressed buttons ............... "the toggle is a radiogroup…"
//   rows at min-h-[32px] ................................. "rows are 44px under a coarse pointer"
//   the toggle read without try/catch .................... "…storage that throws leaves status"
//   Idle open by default ................................. "…the last four folded"
//
// W2 Task T2e (D-6335): the two-line dense row, under the desk's fine pointer only. Its browser measures are
// `browser/instrument-desk.browser.test.ts`'s. MUTATION TABLE (plan Task T2e Step 3; RUN, this suite alone):
//   the dense block's media prelude without (pointer: fine) ... "nothing of the dense arrangement is declared outside the fine-pointer desk block"
//                                                                 (and "under a fine pointer at a desk a status row is two lines on --row-h …")
//   the no-context row's lamp rule removed .................... "under a fine pointer at a desk a status row is two lines on --row-h …"
//   the state's flex `0 0 auto` as `0 1 auto` + `min-width: 0` ... "under a fine pointer at a desk a status row is two lines on --row-h …"
//                                                                 (`expected '\n flex: 0 1 auto;\n min-width:…' to match /flex:\s*0 0 auto/`; the browser file's
//                                                                 layout does not change under it, a wrapped flex line deciding on max-content sizes)
// T2e review R32, F6 (carried into T2g, D-6715; RUN, this suite alone, then reverted): the token guard reads every rule of the block.
//   `padding-top: 3px` added to the dense block's `.ins-row .sess-actions` rule, a rule the old four-selector loop did not name
//                                                         "under a fine pointer at a desk a status row is two lines on --row-h …"
//                                                         (`.ins-row .sess-actions: expected '\n padding-top: 3px;\n align-se…' not to match /\d+px|#[0-9a-f]{3,8}\b|rgb|hsl/i`);
//                                                         the old loop, run on the same mutant, stayed green (20 passed)
// The browser file's rows, a literal 32px floor outside (pointer: fine), the naive ⋯ inset and the lamp rule, are that
// file's header's.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import type { FleetSession, RunSummary, SessionBucket } from '../../shared/api';
import { fleetSession } from './fleetFixture';

const { App } = await import('../src/app');
const { navigate, useLocation } = await import('../src/lib/router');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { api } = await import('../src/lib/api');
const { STATUS_GROUPS } = await import('../src/fleet/statusGroups');
const { GROUP_MODE_KEY } = await import('../src/skins/instrument/FleetTable');

const SKIN_DIR = path.join(import.meta.dirname, '..', 'src', 'skins', 'instrument');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = strip(readFileSync(path.join(SKIN_DIR, 'instrument.css'), 'utf8'));
const TABLE_SRC = readFileSync(path.join(SKIN_DIR, 'FleetTable.tsx'), 'utf8');

const LABELS = ['Needs you', 'Working', 'Done', 'Idle', 'Cleanup', 'Archived', 'Dead'];

const COORD = 'project-a-coord';
const CHILD = 'project-a-worker';
const at = (id: string, bucket: SessionBucket, over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: id.replace(/^project-a-/, ''), bucket,
  status: bucket === 'working' ? 'busy' : bucket === 'dead' ? 'dead' : 'idle', ...over,
});
const FLEET: FleetSession[] = [
  at('project-a-asks', 'attention', { dialogPending: true, hookState: 'waiting' }),
  at(COORD, 'working', { role: 'coordinator', name: 'the coordinator' }),
  at(CHILD, 'done'),
  at('project-a-quiet', 'idle'),
  at('project-a-merged', 'cleanup'),
  at('project-a-shelved', 'archived', { archivedAt: 1_800_000_000 }),
  at('project-a-gone', 'dead'),
];
const RUN: RunSummary = {
  id: 41, program: 'port-api', programTitle: 'Port the API', wave: 1, waveOf: 3,
  project: 'project-a', homeProject: 'project-a', sessionId: CHILD, workspace: 'worker', branch: null,
  state: 'dispatched', kind: 'work', reviews: null, claimedBy: COORD, resumed: false, clearedAt: null,
  openedAt: 1_800_000_000_000, dispatchStartedAt: null, dispatchedAt: null, closedAt: null, handoffCommit: null,
  items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null,
            briefQueued: true, clearError: null, coordKickoffPendingSince: null }, childReclaim: null,
} as RunSummary;

/** A desk (or a phone), and a fine pointer (or a coarse one). */
function stubWidth(desk: boolean, fine = true): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') ? desk : q.includes('pointer: fine') ? fine : false,
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

let where = '/';
function Where(): null { where = useLocation().path; return null; }

function mount(sessions: FleetSession[] = FLEET, runs: RunSummary[] = [RUN]): void {
  act(() => useFleetStore.setState({ conn: 'open', sessions, runs, runsFrameSeen: true, fleetFrameSeen: true }));
  navigate('/');
  render(<><App /><Where /></>);
}

const table = (): HTMLElement => document.querySelector<HTMLElement>('.ins-table')!;
const groups = (): HTMLElement[] => [...table().querySelectorAll<HTMLElement>('[data-status-group]')];
const head = (g: HTMLElement): HTMLElement => g.querySelector<HTMLElement>('[aria-expanded]')!;
const groupOf = (bucket: SessionBucket): HTMLElement => table().querySelector<HTMLElement>(`[data-status-group="${bucket}"]`)!;
const rowIds = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>('[data-row]')].map((r) => r.getAttribute('data-row')!);
const toggle = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Group sessions by' });
const pick = (mode: 'Status' | 'Project'): void => { fireEvent.click(within(toggle()).getByRole('radio', { name: mode })); };

/** The declarations of every rule whose selector list includes `selector`: outside any at-rule, or, with `media`, inside
 *  the `@media` blocks whose prelude is exactly that (the sheet nests no at-rule in another). */
function declsOf(selector: string, media: string | null = null): string {
  const out: string[] = [];
  for (const r of rulesIn(media)) if (r.selectors.includes(selector)) out.push(r.decls);
  return out.join(';');
}

/** Every rule of the sheet outside any at-rule, or, with `media`, of the `@media` blocks whose prelude is exactly
 *  that: its selector list and its declarations (the sheet nests no at-rule in another). `declsOf` reads it by selector. */
function rulesIn(media: string | null): { selectors: string[]; decls: string }[] {
  let scope = CSS.replace(/@media[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  if (media !== null) {
    const bodies: string[] = [];
    const at = /@media\s*([^{]+)\{/g;
    let m: RegExpExecArray | null;
    while ((m = at.exec(CSS)) !== null) {
      let depth = 1;
      let i = at.lastIndex;
      for (; i < CSS.length && depth > 0; i += 1) depth += CSS[i] === '{' ? 1 : CSS[i] === '}' ? -1 : 0;
      if (m[1]!.trim() === media) bodies.push(CSS.slice(at.lastIndex, i - 1));
      at.lastIndex = i;
    }
    scope = bodies.join('\n');
  }
  return [...scope.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((r) => ({ selectors: r[1]!.split(',').map((x) => x.trim()), decls: r[2]! }));
}

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

describe('status mode', () => {
  it('status mode renders the groups in groupByStatus\'s order, the last four folded', () => {
    mount();
    expect(groups().map((g) => g.getAttribute('data-status-group'))).toEqual(
      ['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead']);
    expect(groups().map((g) => head(g).getAttribute('aria-expanded'))).toEqual(
      ['true', 'true', 'true', 'false', 'false', 'false', 'false']);
    // A folded group draws no rows; an open one draws its own.
    expect(rowIds(groupOf('idle'))).toEqual([]);
    expect(rowIds(groupOf('dead'))).toEqual([]);
    expect(rowIds(groupOf('attention'))).toEqual(['project-a-asks']);
    // The folds are the model's, never a second list.
    expect(Object.entries(STATUS_GROUPS).filter(([, g]) => g.folds).map(([b]) => b)).toEqual(['idle', 'cleanup', 'archived', 'dead']);
  });

  it('each group header names its status, and in project mode each row shows its word beside its lamp', () => {
    mount();
    expect(groups().map((g) => head(g).textContent)).toEqual(LABELS.map((l) => expect.stringContaining(l)));
    // Each header carries its count in its name, so a folded group still says how many it holds.
    expect(head(groupOf('idle'))).toHaveAccessibleName(/^Idle.*1/);
    pick('Project');
    const lines = [...table().querySelectorAll<HTMLElement>('.sess-line')];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const lamp = line.querySelector('.sess-lamp');
      const word = line.querySelector('.sess-state');
      expect(lamp, line.textContent ?? '').not.toBeNull();
      expect(word?.textContent?.trim(), line.textContent ?? '').toBeTruthy();
    }
  });

  it('the table renders SessionLine and defines no state-word table', () => {
    const code = TABLE_SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toMatch(/<SessionLine\b/);
    expect(code).not.toMatch(/Record<\s*SessionBucket/);
    expect(code).not.toMatch(/\bSTATE_WORD\b/);
    for (const w of ['waiting', 'exited', 'merged', 'needs you']) expect(code).not.toContain(`'${w}'`);
  });

  it('in status mode a child row carries its coordinator\'s crumb; in project mode it nests as today', () => {
    mount();
    const child = groupOf('done').querySelector<HTMLElement>(`[data-row="${CHILD}"]`)!;
    expect(child).not.toBeNull();
    expect(child.querySelector('.ins-coord-crumb')?.textContent).toContain('the coordinator');
    // The coordinator itself carries no crumb.
    expect(groupOf('working').querySelector(`[data-row="${COORD}"] .ins-coord-crumb`)).toBeNull();
    pick('Project');
    expect(table().querySelector('.ins-coord-crumb')).toBeNull();
    // Project mode is the shared card: the child sits under its coordinator (a nest, or the rollup's workers line).
    const nested = table().querySelector('.proj-nest[data-depth="1"]') ?? table().querySelector('.proj-children-toggle');
    expect(nested).not.toBeNull();
  });
});

describe('project mode and the doors', () => {
  it('project mode\'s cards hold the pool and archive-all doors, each carrying data-action', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({
      roots: [],
      projects: [{ name: 'project-a', workdir: '/project-a', pool: { state: 'tagged', name: 'pool-a' }, placement: { kind: 'unmeasurable' } }],
    } as Awaited<ReturnType<typeof api.projects>>);
    localStorage.setItem('ccrc.fleet-folded.v1', JSON.stringify(['project-a::released']));
    const rel = { runId: 9, program: 'lifecycle', programTitle: null, claimedBy: 'coord', closedAt: 9, child: false };
    mount([...FLEET, at('project-a-released', 'idle', { releasedFrom: rel })]);
    act(() => useFleetStore.setState({
      pools: { listed: true, byProject: { 'project-a': { state: 'tagged', name: 'pool-a' } }, enforcement: 'enforced' } as never,
    }));
    pick('Project');
    const pool = await screen.findByRole('button', { name: 'project pool pool-a' });
    expect(pool.getAttribute('data-action')).toBe('open-pool');
    const archiveAll = screen.getByRole('button', { name: /^Archive all 1 released workspace in project-a$/ });
    expect(archiveAll.getAttribute('data-action')).toBe('archive-all');
    expect(table().contains(pool) && table().contains(archiveAll)).toBe(true);
  });

  it('the toggle is a radiogroup with one checked; the phone tabs are a tablist with one selected', () => {
    mount();
    const radios = within(toggle()).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Status', 'Project']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    for (const r of radios) expect(r.hasAttribute('aria-pressed')).toBe(false);
    pick('Project');
    expect(within(toggle()).getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    cleanup();
    stubWidth(false, false);
    mount();
    pick('Status');
    const tabs = within(screen.getByRole('tablist', { name: 'Sessions by status' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringMatching(/^Needs you/), expect.stringMatching(/^Working/), expect.stringMatching(/^Done/), expect.stringMatching(/^All/)]);
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('a fold is remembered through useFolded', () => {
    mount();
    fireEvent.click(head(groupOf('idle')));
    expect(head(groupOf('idle')).getAttribute('aria-expanded')).toBe('true');
    expect(rowIds(groupOf('idle'))).toEqual(['project-a-quiet']);
    expect(JSON.parse(localStorage.getItem('ccrc.fleet-folded.v1') ?? '[]')).toContain('status::idle');
    // An open group closes the same way, and its key is the inverse (presence = closed for an open-by-default group).
    fireEvent.click(head(groupOf('working')));
    expect(head(groupOf('working')).getAttribute('aria-expanded')).toBe('false');
    cleanup();
    mount();
    expect(head(groupOf('idle')).getAttribute('aria-expanded')).toBe('true');
    expect(head(groupOf('working')).getAttribute('aria-expanded')).toBe('false');
  });

  it('the toggle is remembered, and storage that throws leaves status', () => {
    mount();
    pick('Project');
    expect(localStorage.getItem(GROUP_MODE_KEY)).toBe('project');
    cleanup();
    mount();
    expect(table().getAttribute('data-mode')).toBe('project');
    cleanup();
    localStorage.setItem(GROUP_MODE_KEY, 'sideways');
    mount();
    expect(table().getAttribute('data-mode')).toBe('status');
    cleanup();
    localStorage.setItem(GROUP_MODE_KEY, 'project');
    // A store installed on `window` itself, throwing for the mode's key and delegating the rest: a spy on the instance
    // does not hold on jsdom's Storage (a named-property proxy stores it as a key), and the Storage shape differs
    // between a local Node and CI's, so the test owns the whole accessor and restores it.
    const real = window.localStorage;
    const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const refusing = {
      getItem: (k: string) => { if (k === GROUP_MODE_KEY) throw new Error('storage refused'); return real.getItem(k); },
      setItem: (k: string, v: string) => real.setItem(k, v),
      removeItem: (k: string) => real.removeItem(k),
      clear: () => real.clear(),
      key: (i: number) => real.key(i),
      get length() { return real.length; },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => refusing });
    try {
      mount();
      expect(table().getAttribute('data-mode')).toBe('status');
    } finally {
      if (own === undefined) delete (window as { localStorage?: Storage }).localStorage;
      else Object.defineProperty(window, 'localStorage', own);
    }
  });

  it('a row opens its session, and ⋯ opens the fleet flow\'s actions sheet', async () => {
    mount();
    const row = groupOf('attention').querySelector<HTMLElement>('[data-row="project-a-asks"]')!;
    const more = row.querySelector<HTMLElement>('[data-action="open-actions"]')!;
    expect(more).not.toBeNull();
    fireEvent.click(more);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    cleanup();
    mount();
    fireEvent.click(groupOf('attention').querySelector<HTMLElement>('[data-row="project-a-asks"] .sess-open')!);
    expect(where).toBe('/s/project-a-asks');
  });

  it('rows are 44px under a coarse pointer', () => {
    mount();
    const rows = [...table().querySelectorAll<HTMLElement>('[data-row]')];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.className.split(/\s+/)).toContain('min-h-row');
    // The shared line inside follows the density role, never a literal: 44 under a coarse pointer, 32 under a fine one
    // (skins.css's `--row-h`).
    expect(declsOf('.ins-row .sess-line')).toMatch(/min-height:\s*var\(--row-h\)/);
    expect(declsOf('.ins-row .sess-line')).not.toMatch(/\d+px/);
    expect(TABLE_SRC).not.toMatch(/min-h-\[\d+px\]/);
  });
});

describe('phone', () => {
  it('phone: the tabs select one group; All shows every group', () => {
    stubWidth(false, false);
    mount();
    const tab = (name: RegExp): HTMLElement => within(screen.getByRole('tablist', { name: 'Sessions by status' })).getByRole('tab', { name });
    fireEvent.click(tab(/^Working/));
    expect(tab(/^Working/).getAttribute('aria-selected')).toBe('true');
    expect(groups().map((g) => g.getAttribute('data-status-group'))).toEqual(['working']);
    fireEvent.click(tab(/^Needs you/));
    expect(groups().map((g) => g.getAttribute('data-status-group'))).toEqual(['attention']);
    fireEvent.click(tab(/^All/));
    expect(groups().map((g) => g.getAttribute('data-status-group'))).toEqual(
      ['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead']);
    expect(groups().map((g) => head(g).getAttribute('aria-expanded'))).toEqual(
      ['true', 'true', 'true', 'false', 'false', 'false', 'false']);
    // A tab's name carries its group's count.
    expect(tab(/^Needs you/)).toHaveAccessibleName(/1/);
  });
});

// The review's fixes (D-5473 extended). RED FIRST on the first S10 head: every case below failed there except the two
// that pin behaviour the head already had untested (empty groups, the selected row), which the mutants below turn red.
//   the attention hold dropped (isOpen ignores the held group) ... "Needs you is held open while it holds a row…"
//   the held head's toggle not ignored .......................... "Needs you is held open while it holds a row…"
//   the fold mark dropped or fixed to ▾ ......................... "each group head draws a fold mark…"
//   the checked radio marked by weight alone .................... "the checked toggle option carries an accent edge…"
//   the selected tab's edge back to a border ..................... "the chosen tab's edge takes no room…"
//   empty groups shown at a desk ................................ "a group with no rows is absent at a desk and under All…"
//   the selected row's flag dropped ............................. "the open session's row is marked selected…"
//   arrow keys ignored on either group .......................... "arrow keys move and choose…"
describe('review fixes', () => {
  it('Needs you is held open while it holds a row, whatever is stored (the fleet rollup\'s rule, D-6088)', () => {
    localStorage.setItem('ccrc.fleet-folded.v1', JSON.stringify(['status::attention']));
    mount();
    const h = head(groupOf('attention'));
    expect(h.getAttribute('aria-expanded')).toBe('true');
    expect(h.getAttribute('aria-disabled')).toBe('true');
    expect(h.hasAttribute('disabled')).toBe(false);
    expect(h.textContent).toContain('held open: a question here is waiting on you');
    expect(rowIds(groupOf('attention'))).toEqual(['project-a-asks']);
    cleanup();
    localStorage.clear();
    mount();
    fireEvent.click(head(groupOf('attention')));
    expect(rowIds(groupOf('attention'))).toEqual(['project-a-asks']);
    expect(JSON.parse(localStorage.getItem('ccrc.fleet-folded.v1') ?? '[]')).not.toContain('status::attention');
    cleanup();
    mount();
    expect(rowIds(groupOf('attention'))).toEqual(['project-a-asks']);
    // Only the group holding a waiting row is held: Working still folds.
    expect(head(groupOf('working')).hasAttribute('aria-disabled')).toBe(false);
  });

  it('each group head draws a fold mark matching its aria-expanded', () => {
    mount();
    const mark = (g: HTMLElement): string => head(g).querySelector('.ins-group-chevron[aria-hidden="true"]')?.textContent ?? '';
    for (const g of groups()) expect(mark(g)).toBe(head(g).getAttribute('aria-expanded') === 'true' ? '▾' : '▸');
    fireEvent.click(head(groupOf('idle')));
    expect(mark(groupOf('idle'))).toBe('▾');
  });

  it('the checked toggle option carries an accent edge, not weight alone', () => {
    expect(declsOf(".ins-toggle-option[aria-checked='true']")).toMatch(/(border|box-shadow)[^;]*var\(--accent\)/);
  });

  it('the chosen tab\'s edge takes no room, so choosing one moves no label', () => {
    expect(declsOf(".ins-tab[aria-selected='true']")).not.toMatch(/border|padding|margin/);
    expect(declsOf('.ins-tab')).toMatch(/position:\s*relative/);
    const edge = declsOf(".ins-tab[aria-selected='true']::after");
    expect(edge).toMatch(/position:\s*absolute/);
    expect(edge).toMatch(/height:\s*2px/);
    expect(edge).toMatch(/background:\s*var\(--accent\)/);
  });

  it('a group with no rows is absent at a desk and under All, present under its own phone tab', () => {
    const sparse = FLEET.filter((s) => s.bucket !== 'attention' && s.bucket !== 'idle');
    mount(sparse);
    expect(groups().map((g) => g.getAttribute('data-status-group'))).toEqual(['working', 'done', 'cleanup', 'archived', 'dead']);
    cleanup();
    stubWidth(false, false);
    mount(sparse);
    const tab = (name: RegExp): HTMLElement => within(screen.getByRole('tablist', { name: 'Sessions by status' })).getByRole('tab', { name });
    fireEvent.click(tab(/^All/));
    expect(groups().map((g) => g.getAttribute('data-status-group'))).not.toContain('idle');
    fireEvent.click(tab(/^Needs you/));
    expect(groups().map((g) => g.getAttribute('data-status-group'))).toEqual(['attention']);
  });

  it('the open session\'s row is marked selected in status mode', () => {
    mount();
    act(() => navigate('/s/project-a-quiet'));
    fireEvent.click(head(groupOf('idle')));
    act(() => navigate('/s/project-a-asks'));
    const line = (id: string): Element | null => table().querySelector(`[data-row="${id}"] .sess-line`);
    expect(line('project-a-asks')?.classList.contains('sess-line--active')).toBe(true);
    expect(line('project-a-quiet')?.classList.contains('sess-line--active')).toBe(false);
  });

  it('arrow keys move and choose in the toggle and the phone tabs; the tabs control a tabpanel', () => {
    stubWidth(false, false);
    mount();
    const status = within(toggle()).getByRole('radio', { name: 'Status' });
    expect(status.getAttribute('tabindex')).toBe('0');
    expect(within(toggle()).getByRole('radio', { name: 'Project' }).getAttribute('tabindex')).toBe('-1');
    status.focus();
    fireEvent.keyDown(status, { key: 'ArrowRight' });
    expect(table().getAttribute('data-mode')).toBe('project');
    expect(document.activeElement?.textContent).toBe('Project');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(table().getAttribute('data-mode')).toBe('status');
    const list = screen.getByRole('tablist', { name: 'Sessions by status' });
    const all = within(list).getByRole('tab', { name: /^All/ });
    expect(all.getAttribute('tabindex')).toBe('0');
    all.focus();
    fireEvent.keyDown(all, { key: 'Home' });
    const needs = within(list).getByRole('tab', { name: /^Needs you/ });
    expect(needs.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(needs);
    fireEvent.keyDown(needs, { key: 'End' });
    expect(all.getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(all.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(all.id);
    expect(panel.querySelector('[data-status-group]')).not.toBeNull();
  });
});

describe('dense rows at the desk (T2e, D-6335)', () => {
  const DENSE = '(min-width: 900px) and (pointer: fine)';

  it('under a fine pointer at a desk a status row is two lines on --row-h: name and state, then the context', () => {
    // The body is a wrapping flex row: the state word beside the name when both fit, on a line of its own when they do
    // not (a flex line breaks on max-content sizes, so the name then has the whole line), and the context on a line of
    // its own. Never a grid with a capped state column: that squeezed a long name into three lines beside the state.
    const body = declsOf('.ins-row .sess-body', DENSE);
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-flow:\s*row wrap/);
    expect(body).not.toMatch(/grid/);
    expect(body).toMatch(/min-height:\s*var\(--row-h\)/);
    expect(declsOf('.ins-row .sess-body > .sess-open', DENSE)).toMatch(/flex:\s*1 1 auto/);
    expect(declsOf('.ins-row .sess-body > .sess-open', DENSE)).toMatch(/min-width:\s*0/);
    expect(declsOf('.ins-row .sess-body > .sess-meta:not(.sess-meta--context)', DENSE)).toMatch(/flex:\s*0 0 auto/);
    expect(declsOf('.ins-row .sess-body > .sess-meta:not(.sess-meta--context)', DENSE)).toMatch(/margin-inline-start:\s*auto/);
    expect(declsOf('.ins-row .sess-meta--context', DENSE)).toMatch(/flex:\s*1 0 100%/);
    // The lamp and the actions button lose the three-line centring margin they carry from the shared sheet.
    // The lamp is reached as the row's first cell (skin-boundary (b): a skin's sheet never names the lamp's class).
    expect(declsOf('.ins-row .sess-line > :first-child', DENSE)).toMatch(/margin-top:\s*0/);
    // A row with no context fact makes its name's line the floor high and puts the lamp at that line's middle, so the
    // lamp is on the name's first line in a one-line row and in a two-line one (T2e fix round 1, F5).
    expect(declsOf('.ins-row .sess-line:not(:has(.sess-meta--context)) .sess-body > .sess-open', DENSE)).toMatch(/min-height:\s*var\(--row-h\)/);
    expect(declsOf('.ins-row .sess-line:not(:has(.sess-meta--context)) > :first-child', DENSE))
      .toMatch(/margin-top:\s*calc\(\(var\(--row-h\) - var\(--fs-base\) \* var\(--lh-tight\)\) \/ 2\)/);
    mount();
    expect(table().querySelector('.ins-row .sess-line')!.firstElementChild, 'the first cell is the lamp').toHaveClass('sess-lamp');
    expect(declsOf('.ins-row .sess-actions', DENSE)).toMatch(/margin-top:\s*0/);
    expect(declsOf('.ins-row .sess-actions', DENSE)).toMatch(/align-self:\s*center/);
    // The group heads and the toggle sit at --row-h.
    expect(declsOf('.ins-group-head', DENSE)).toMatch(/min-height:\s*var\(--row-h\)/);
    expect(declsOf('.ins-toggle-option', DENSE)).toMatch(/min-height:\s*var\(--row-h\)/);
    // Every dense value is a token or a keyword: the pattern bars a px literal and a colour literal (hex, rgb, hsl), in
    // every rule of the block (T2e review R32, F6), not in a list of selectors that a new rule would be left out of.
    const dense = rulesIn(DENSE);
    expect(dense.length, 'the dense block has rules').toBeGreaterThanOrEqual(8);
    for (const r of dense) expect(r.decls, r.selectors.join(', ')).not.toMatch(/\d+px|#[0-9a-f]{3,8}\b|rgb|hsl/i);
  });

  it('nothing of the dense arrangement is declared outside the fine-pointer desk block', () => {
    // A coarse pointer, or a width below 900, keeps the shared sheet's `--tap-min` rows, group heads and toggle.
    for (const sel of ['.ins-row .sess-body', '.ins-row .sess-body > .sess-open', '.ins-row .sess-body > .sess-meta:not(.sess-meta--context)',
      '.ins-row .sess-line > :first-child', '.ins-row .sess-line:not(:has(.sess-meta--context)) > :first-child',
      '.ins-row .sess-line:not(:has(.sess-meta--context)) .sess-body > .sess-open', '.ins-row .sess-actions',
      '.ins-row .sess-meta--context', '.ins-group-head', '.ins-toggle-option']) {
      expect(declsOf(sel), sel).not.toMatch(/min-height|margin-top|margin-inline|flex|display:\s*(grid|flex)|align-self/);
      for (const media of ['(min-width: 900px)', '(pointer: fine)']) expect(declsOf(sel, media), `${sel} in ${media}`).toBe('');
    }
  });
});
