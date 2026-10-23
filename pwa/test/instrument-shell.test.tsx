// Instrument's shell at laptop and wide (W2 Task S9, D-5472): the rail, the top bar, the list column and the status
// bar, placed by the shared frame. Each case mounts the whole `App` under Instrument with a desk width stubbed
// (`(min-width: 900px)` true), or reads `instrument.css` where the claim is the stylesheet's (jsdom applies no media
// query and lays nothing out, so a width or a pointer branch is asserted on the rule, and the real-browser renders in
// the PR measure the pixels).
//
// RED FIRST, on the task's base: this file did not compile there (no `skins/instrument/Rail.tsx`).
//
// MUTATION TABLE (plan Task S9 Step 3; RUN, each mutant on a `git archive` copy, this suite or skin-boundary alone):
//   Activity rendered as a disabled door ............... "…Activity not rendered…"
//   the status bar's 24px outside (pointer: fine) ...... "…under a coarse one it and its buttons are at least --tap-min"
//   the command field as a TextInput ................... "…is not a text field"
//   the status bar filters s.bucket === 'attention' .... "the status bar renders fleetSummary"
//   the top bar starts at column 2 ..................... "the top bar spans the rail's column"
//   the rail's tooltip on :hover only .................. "…shows on focus-visible"
//   Wordmark removed from TopBar ....................... skin-boundary (a)
//   a hex in instrument.css ............................ skin-boundary (c)
//
// W2 Task T2e (desk-polish, D-6335): the frame's fourth track, the list column's one head, the pool-lag readout.
// MUTATION TABLE (plan Task T2e Step 3; RUN, each mutant on the working tree, this suite alone, then reverted):
//   the fourth track unconditional ..................... "the fourth-track attribute follows the set's Inspector part, whatever its id"
//   the attribute set from the skin id ................. "the fourth-track attribute follows the set's Inspector part, whatever its id"
//   `ListColumn` keeps the head chrome ................. "at 900, 1280 and 1920 the frame holds one wordmark, and one each of …"
//   the banners tied to the head flag .................. "one banner stack at any width"
//   the pool lag dropped with the chrome ............... "the pool-lag readout shows once at the desk when the epochs differ"
// Fix round 1 (review 826, F1):
//   the rail's Inbox door without the count ............ "at the desk with mail unread, the rail's Inbox door names and shows the count, and nothing else in the frame does"
//
// W2 Task T2g (desk-polish, D-6715): one count at the desk, in the status bar; the list head empty is not drawn.
// MUTATION TABLE (plan Task T2g Step 3; RUN, each mutant on the working tree, this suite alone unless named, then reverted):
//   `ListColumn` without `headCount={false}` ........... "at 900, 1280 and 1920 Instrument's list column draws no count line, …", the head-is-the-lag case,
//                                                         and T2e's census case (the browser leg holds the offset case)
//   `FleetColumn` passes `headCount` without `|| !desktop`  "at 899 Instrument's list column keeps its count line"
//   in `FleetScreen`, `poolLag={headCount ? poolLag : null}`  "…the head is the pool lag alone when the epochs differ…", and T2e's "the pool-lag readout shows once at the desk when the epochs differ"
//   `FleetHead`'s nothing-to-draw `return null` removed  "…and there is no head when they agree", "Refined at 1280 on an empty fleet with no lag draws no …", T2e's census case
//   Refined's `Sidebar` passes `headCount={false}` ..... "Refined's desk column keeps its count line"
//   the flag removed and `@media (min-width: 900px) { .shell-nav .fleet-count { display: none } }` in instrument.css
//                                                       skin-boundary (j) "holds on the real tree" (and three of its siblings, which scan the real sheet), and
//                                                         "at 900, 1280 and 1920 Instrument's list column draws no count line, …"
// Row 8 (Step 0's `flex: none` removed) does not apply: Step 0 found the count whole at 900, so T2g adds no `flex: none`.
// Rows 1, 4 and 7 also run in browser/instrument-desk.browser.test.ts (its own table).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import type { FleetSession, NotifyEvent, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';

// The bell renders only where the browser can push; this one can, so the doors' census counts it (T2e).
vi.mock('../src/lib/push', () => ({
  pushSupported: () => true,
  pushEnabled: async () => false,
}));

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { ROUTES } = await import('../src/lib/routes');
const { RAIL_ITEMS } = await import('../src/skins/instrument/Rail');
const { fleetSummary } = await import('../src/fleet/fleetSummary');
const { ack, FEED_ACK_KEY, resetAcks } = await import('../src/lib/seen');
const { ShellFrame } = await import('../src/skins/frame');
const { INSTRUMENT_SET } = await import('../src/skins/instrument/parts');
const { REFINED_SET } = await import('../src/skins/refined/parts');

const SKIN_DIR = path.join(import.meta.dirname, '..', 'src', 'skins');
const CSS = readFileSync(path.join(SKIN_DIR, 'instrument', 'instrument.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const S: FleetSession = fleetSession({ id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', bucket: 'attention' });
const WS: FleetSession = fleetSession({
  id: 'project-a-quiet-basin', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'quiet-basin',
});

/** A desk (or not) with a fine pointer: `(min-width: 900px)` answers `desk`. */
function stubWidth(desk: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') ? desk : q.includes('pointer: fine'),
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

function mount(at: string, sessions: FleetSession[] = [S, WS]): void {
  act(() => useFleetStore.setState({ conn: 'open', sessions }));
  navigate(at);
  render(<App />);
}

const rail = (): HTMLElement => screen.getByRole('navigation', { name: 'Primary' });
const railDoors = (): HTMLElement[] => within(rail()).getAllByRole('button').filter((b) => b.hasAttribute('data-command'));
const topBar = (): HTMLElement => document.querySelector<HTMLElement>('header.shell-accounts')!;
const footer = (): HTMLElement => document.querySelector<HTMLElement>('footer.shell-status')!;

/** The declarations of every rule whose selector list includes `selector` exactly, outside any at-rule or inside
 *  the one named by `media` (its prelude, e.g. `(pointer: fine)`). */
function declsOf(selector: string, media: string | null = null): string {
  const blocks: { media: string | null; body: string }[] = [];
  let rest = CSS;
  const at = /@media\s*([^{]+)\{/g;
  let m: RegExpExecArray | null;
  let top = '';
  let from = 0;
  while ((m = at.exec(rest)) !== null) {
    top += rest.slice(from, m.index);
    let depth = 1;
    let i = at.lastIndex;
    for (; i < rest.length && depth > 0; i += 1) depth += rest[i] === '{' ? 1 : rest[i] === '}' ? -1 : 0;
    blocks.push({ media: m[1]!.trim(), body: rest.slice(at.lastIndex, i - 1) });
    from = i;
    at.lastIndex = i;
  }
  top += rest.slice(from);
  rest = media === null ? top : blocks.filter((b) => b.media === media).map((b) => b.body).join('\n');
  const out: string[] = [];
  for (const r of rest.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (r[1]!.split(',').map((s) => s.trim()).includes(selector)) out.push(r[2]!);
  }
  return out.join(';');
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  initSkin();
  act(() => { setSkin(INSTRUMENT); });
  stubWidth(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null, feed: [] }));
  resetAcks();
  act(() => { setSkin(REFINED); });
  localStorage.clear();
});

describe('the rail', () => {
  it('the rail renders RAIL_ITEMS in order, Activity not rendered, each with its word as its name and at least --tap-min tall', () => {
    mount('/');
    const routeItems = RAIL_ITEMS.filter((i) => !('reserved' in i) && !('bell' in i));
    const words = routeItems.map((i) => ROUTES.find((r) => r.id === i.id)!.title);
    expect(words).toEqual(['Fleet', 'Inbox', 'Runs', 'Accounts', 'Archive', 'Docs', 'Settings']);
    expect(railDoors().map((b) => b.getAttribute('aria-label'))).toEqual(words);
    // Activity is held in the registry, reserved, and draws nothing: no control that does nothing ships.
    expect(RAIL_ITEMS.find((i) => i.id === 'activity')).toEqual({ id: 'activity', reserved: 'F4, W4' });
    expect(within(rail()).queryByRole('button', { name: /activity/i })).toBeNull();
    expect(within(rail()).getAllByRole('button').filter((b) => b.hasAttribute('disabled'))).toEqual([]);
    expect(rail().textContent).not.toMatch(/activity/i);
    // Every door is the tap floor tall: `Door`'s own floor, and the rail's rule restates it.
    for (const b of railDoors()) expect(b.className).toContain('min-h-tap');
    expect(declsOf('.ins-rail-item')).toMatch(/min-height:\s*var\(--tap-min\)/);
  });

  it('the rail never clips its tooltips: it is no scroll container, and each item fits its track', () => {
    // A rail with any `overflow` other than visible is a clip box in BOTH axes (overflow-y: auto computes overflow-x
    // to auto), so a tooltip drawn beside it is cut away and the hidden tips widen it into a sideways scroller.
    for (const media of [null, '(min-width: 900px)', '(min-width: 1600px)'] as const) {
      expect(declsOf('.ins-frame .shell-rail', media), String(media)).not.toMatch(/overflow/);
      expect(declsOf('.ins-rail', media), String(media)).not.toMatch(/overflow/);
    }
    // It stacks above the list column, so the tooltip draws over the list, not under it.
    expect(declsOf('.ins-frame .shell-rail', '(min-width: 900px)')).toMatch(/position:\s*relative/);
    expect(declsOf('.ins-frame .shell-rail', '(min-width: 900px)')).toMatch(/z-index:/);
    // The item is the track's width, never a fixed 52px inside a track its border makes 51px: no cut ring.
    expect(declsOf('.ins-rail-item')).toMatch(/width:\s*100%/);
    expect(declsOf('.ins-rail-item')).not.toMatch(/width:\s*\d+px/);
  });

  it('the active rail item carries aria-current=page, and only one does; a session sits under Fleet, as its breadcrumb says', () => {
    for (const [at, word] of [['/', 'Fleet'], ['/runs', 'Runs'], ['/settings/updates', 'Settings'], ['/docs', 'Docs'], [`/s/${S.id}`, 'Fleet']] as const) {
      mount(at);
      const current = railDoors().filter((b) => b.getAttribute('aria-current') === 'page');
      expect(current.map((b) => b.getAttribute('aria-label')), at).toEqual([word]);
      cleanup();
    }
  });

  it('every rail item, the command field and + carry their data-command; a rail item\'s tooltip shows on focus-visible', () => {
    mount('/');
    expect(railDoors().map((b) => b.getAttribute('data-command')))
      .toEqual(['go-fleet', 'go-inbox', 'go-runs', 'go-accounts', 'go-archive', 'go-docs', 'go-settings']);
    expect(within(topBar()).getByRole('button', { name: 'Search or run a command' })).toHaveAttribute('data-command', 'open-palette');
    expect(within(topBar()).getByRole('button', { name: 'New session' })).toHaveAttribute('data-command', 'new-session');
    // The word is in each door, for its tooltip.
    for (const b of railDoors()) expect(b.querySelector('.ins-rail-tip')?.textContent).toBe(b.getAttribute('aria-label'));
    expect(declsOf('.ins-rail-item:hover .ins-rail-tip', '(hover: hover)')).toMatch(/opacity:\s*1/);
    expect(declsOf('.ins-rail-item:focus-visible .ins-rail-tip')).toMatch(/opacity:\s*1/);
  });

  it('a rail door runs its command: Runs goes to /runs', () => {
    mount('/');
    fireEvent.click(railDoors().find((b) => b.getAttribute('aria-label') === 'Runs')!);
    expect(window.location.pathname).toBe('/runs');
  });
});

describe('the top bar', () => {
  it("the breadcrumb reads ROUTES' titles, and the session's title on a session route", () => {
    const crumbs = (): string[] => [...topBar().querySelectorAll('.ins-crumb')].map((c) => c.textContent ?? '');
    const title = (id: string): string => ROUTES.find((r) => r.id === id)!.title;
    mount('/runs');
    expect(crumbs()).toEqual([title('runs')]);
    cleanup();
    mount('/settings/updates');
    expect(crumbs()).toEqual([title('settings'), title('settings-updates')]);
    cleanup();
    mount(`/s/${WS.id}`);
    // The session header's own words: its project, then the workspace's label.
    expect(crumbs()).toEqual([title('fleet'), 'project-a', 'quiet-basin']);
    expect(topBar().querySelector('.ins-crumb:last-child')).toHaveAttribute('aria-current', 'page');
    // A crumb the bar cuts short (the overflow order gives crumbs up first) still shows its whole word on hover.
    for (const c of topBar().querySelectorAll('.ins-crumb')) expect(c).toHaveAttribute('title', c.textContent ?? '');
    cleanup();
    mount(`/s/${S.id}`);
    expect(crumbs()).toEqual([title('fleet'), 'project-a']);
  });

  it('a session the fleet does not list reads Fleet › Session, never a name guessed from its id', () => {
    mount('/s/project-z-unlisted-basin');
    const crumbs = [...topBar().querySelectorAll('.ins-crumb')].map((c) => c.textContent ?? '');
    expect(crumbs).toEqual([ROUTES.find((r) => r.id === 'fleet')!.title, ROUTES.find((r) => r.id === 'session')!.title]);
  });

  it('the command field opens the palette, and is not a text field', () => {
    mount('/');
    const field = within(topBar()).getByRole('button', { name: 'Search or run a command' });
    expect(field.tagName).toBe('BUTTON');
    expect(within(topBar()).queryByRole('textbox')).toBeNull();
    expect(within(topBar()).queryByRole('combobox')).toBeNull();
    expect(topBar().querySelector('input, textarea, [contenteditable]')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Command palette' })).toBeNull();
    fireEvent.click(field);
    expect(screen.getByRole('combobox', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('the top bar renders the wordmark first, then the crumbs, the command field, the meters door and +', () => {
    mount('/');
    const bar = topBar();
    const order = [
      bar.querySelector('[data-wordmark]'),
      bar.querySelector('.ins-crumbs'),
      within(bar).getByRole('button', { name: 'Search or run a command' }),
      bar.querySelector('.accounts-compact[data-compact="led"]'),
      within(bar).getByRole('button', { name: 'New session' }),
    ];
    for (const el of order) expect(el).not.toBeNull();
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `item ${i}`).toBeTruthy();
    }
    // The wordmark is the frame's first chrome after the skip link: the bar precedes the rail in DOM order.
    const frame = document.querySelector('.app-shell')!;
    const kids = [...frame.children].map((c) => c.tagName.toLowerCase() + (c.getAttribute('aria-label') ? `:${c.getAttribute('aria-label')}` : ''));
    expect(kids.slice(0, 5)).toEqual(['a', 'header', 'nav:Primary', 'div', 'main']);
  });

  it("the top bar spans the rail's column", () => {
    expect(declsOf('.ins-frame .shell-accounts', '(min-width: 900px)')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(declsOf('.ins-frame .shell-rail', '(min-width: 900px)')).toMatch(/grid-column:\s*1\b/);
    expect(declsOf('.ins-frame .shell-rail', '(min-width: 900px)')).toMatch(/grid-row:\s*2/);
  });
});

describe('the status bar', () => {
  it('the status bar is 24px only under a fine pointer; under a coarse one it and its buttons are at least --tap-min', () => {
    // Outside the fine-pointer block, nothing in the sheet is 24px tall …
    expect(declsOf('.ins-status')).not.toMatch(/height:\s*24px/);
    expect(declsOf('.ins-status-key')).not.toMatch(/height:\s*(?:2[0-4])px/);
    expect(declsOf('.ins-status')).toMatch(/min-height:\s*var\(--tap-min\)/);
    expect(declsOf('.ins-status-key')).toMatch(/min-height:\s*var\(--tap-min\)/);
    expect(declsOf('.ins-status-key')).toMatch(/min-width:\s*var\(--tap-min\)/);
    // … and inside it, the bar is 24px.
    expect(declsOf('.ins-status', '(pointer: fine)')).toMatch(/height:\s*24px/);
    // No other block in the sheet makes the bar dense.
    const other = CSS.replace(/@media\s*\(pointer:\s*fine\)\s*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
    expect(other).not.toMatch(/24px/);
    // And the keys carry the hook the rules select.
    mount('/');
    const keys = within(footer()).getAllByRole('button');
    expect(keys.map((k) => k.getAttribute('data-command'))).toEqual(['open-palette', 'show-shortcuts']);
    for (const k of keys) expect(k).toHaveClass('ins-status-key');
  });

  it('the agent link reads "agent: checking" until the health poll answers, never an all-clear', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    mount('/');
    expect(footer().querySelector('.ins-status-link')).toHaveTextContent('agent: checking');
    expect(footer()).not.toHaveTextContent('agent connected');
  });

  it('runs are counted only after a runs frame has arrived', () => {
    const runs = [{ state: 'working' }] as unknown as RunSummary[];
    act(() => useFleetStore.setState({ runs, runsFrameSeen: false }));
    mount('/');
    const summary = (): string => footer().querySelector('.ins-status-summary')!.textContent ?? '';
    expect(summary()).toBe(fleetSummary([S, WS], null).readout);
    expect(summary()).not.toContain('run');
    act(() => useFleetStore.setState({ runsFrameSeen: true }));
    expect(summary()).toBe(fleetSummary([S, WS], runs).readout);
    expect(summary()).toContain('1 run');
    act(() => useFleetStore.setState({ runs: [], runsFrameSeen: false }));
  });

  it('the status bar renders fleetSummary', () => {
    mount('/');
    expect(footer()).toHaveTextContent(fleetSummary([S, WS], null).readout);
    expect(footer().textContent).toContain('1 waiting');
    // The footer is not a live region.
    expect(footer().querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    expect(footer()).not.toHaveAttribute('aria-live');
    // The source scan: the status bar imports the one function, and no skin file filters sessions by bucket itself.
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const status = readFileSync(path.join(SKIN_DIR, 'instrument', 'StatusBar.tsx'), 'utf8');
    expect(status).toMatch(/import \{[^}]*\bfleetSummary\b[^}]*\} from '\.\.\/\.\.\/fleet\/fleetSummary'/);
    expect(status).toMatch(/fleetSummary\(/);
    for (const f of files(SKIN_DIR)) {
      const code = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(code, path.relative(SKIN_DIR, f)).not.toMatch(/\.bucket\s*[!=]==|\bbucket\s*[!=]==|['"]attention['"]\s*[!=]==/);
    }
  });
});

describe('one instance per width', () => {
  it('one banner stack and one set of lane meters at any width', () => {
    for (const desk of [false, true]) {
      stubWidth(desk);
      act(() => useFleetStore.setState({ conn: 'down', sessions: [S] }));
      navigate('/');
      render(<App />);
      const at = desk ? '900' : '899';
      expect(document.querySelectorAll('[data-banner="offline"]').length, `${at}: banner stacks`).toBe(1);
      const meters = document.querySelectorAll('.accounts-compact, .accounts-strip');
      expect(meters.length, `${at}: lane meters`).toBe(1);
      expect(meters[0]!.matches('.accounts-compact[data-compact="led"]'), at).toBe(desk);
      // The rail and the status bar are desk parts: mounted at 900, absent at 899.
      expect(document.querySelectorAll('nav[aria-label="Primary"]').length, `${at}: rail`).toBe(desk ? 1 : 0);
      expect(document.querySelectorAll('footer.shell-status').length, `${at}: status bar`).toBe(desk ? 1 : 0);
      cleanup();
    }
  });
});

// ---- Desk polish, T2e (D-6335) ----------------------------------------------------------------------------------

/** The width at which a desk `(min-width: N)` query answers, so one test can stand at 899, 900, 1280 and 1920. */
function stubAt(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    return {
      matches: min !== null ? width >= Number(min[1]) : q.includes('pointer: fine'),
      media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

/** The frame's doors, counted by what each one IS (its name), never by a class: the rail's and the list head's doors
 *  carry different names for one destination, and the meters' door to /accounts is not a second Accounts door. The
 *  rail's `Inbox` (`Inbox, N unread` with mail) and the list head's `Mail — N unread` are told apart, so a desk that
 *  has the second back, or a rail door that lost its count, is a different census (T2e fix round 1, F1). */
function doorCounts(): Record<string, number> {
  const named = [...document.querySelectorAll<HTMLElement>('[aria-label]')];
  const count = (re: RegExp): number => named.filter((el) => re.test(el.getAttribute('aria-label') ?? '')).length;
  return {
    wordmark: document.querySelectorAll('[data-wordmark], .wordmark').length,
    docs: count(/^Docs\b/),
    accounts: count(/^(Accounts|Your sign-in and accounts)$/),
    settings: count(/^Settings\b/),
    inbox: count(/^Inbox\b/),
    mail: count(/^Mail\b/),
    unread: count(/\d+ unread/),
    bell: count(/^Notifications (on|off)$/),
  };
}

describe('the desk (T2e): no second head in the list column, no empty fourth column', () => {
  it("the fourth-track attribute follows the set's Inspector part, whatever its id", () => {
    function Stub(): ReactNode { return <p>an inspector</p>; }
    // The frame is driven directly: the sets' own parts read providers this case does not mount.
    const bare = { Bar: null, Banners: null, Rail: null, Nav: null, StatusBar: null } as const;
    const attr = (set: Parameters<typeof ShellFrame>[0]['set']): string | null => {
      const view = render(<ShellFrame set={set} view="fleet" detailRef={{ current: null }}><p>ladder</p></ShellFrame>);
      const value = view.container.querySelector('.app-shell')!.getAttribute('data-inspector');
      view.unmount();
      return value;
    };
    stubAt(1920);
    expect(attr({ ...INSTRUMENT_SET, ...bare, Inspector: Stub })).toBe('placed');
    expect(attr({ ...INSTRUMENT_SET, ...bare, Inspector: null })).toBe('none');
    expect(attr({ ...REFINED_SET, ...bare, Inspector: null })).toBe('none');
    expect(attr({ ...REFINED_SET, ...bare, Inspector: Stub })).toBe('placed');
    // Instrument's set carries no Inspector part until S12: the attribute reads none for the set as shipped.
    expect(INSTRUMENT_SET.Inspector).toBeNull();
    expect(attr({ ...INSTRUMENT_SET, ...bare })).toBe('none');
    // The sheet keys the 320px track on the attribute and on nothing else.
    expect(declsOf('.ins-frame', '(min-width: 1600px)')).toMatch(/grid-template-columns:\s*52px 420px minmax\(0, 1fr\)\s*(;|$)/);
    expect(declsOf(".ins-frame[data-inspector='placed']", '(min-width: 1600px)'))
      .toMatch(/grid-template-columns:\s*52px 420px minmax\(0, 1fr\) 320px/);
    for (const media of [null, '(min-width: 900px)'] as const) expect(declsOf('.ins-frame', media), String(media)).not.toMatch(/\b320px/);
    expect(declsOf('.ins-frame', '(min-width: 1600px)')).not.toMatch(/\b320px/);
  });

  it('at 900, 1280 and 1920 the frame holds one wordmark, and one each of the Docs, Accounts, Settings, Inbox and Bell doors', () => {
    for (const width of [900, 1280, 1920]) {
      stubAt(width);
      mount('/');
      expect(doorCounts(), `${width}px, fleet`).toEqual({ wordmark: 1, docs: 1, accounts: 1, settings: 1, inbox: 1, mail: 0, unread: 0, bell: 1 });
      // The list column's head drops its chrome and, with no count line (T2g) and no lag in this fixture, is not drawn.
      expect(document.querySelector('.shell-nav .fleet-head'), `${width}px`).toBeNull();
      expect(document.querySelector('.shell-nav .fleet-head .wordmark'), `${width}px`).toBeNull();
      expect(document.querySelector('.shell-nav .fleet-count'), `${width}px: no count line`).toBeNull();
      cleanup();
    }
    // Below 900 nothing changed: the head holds its chrome, and the rail and the bar are not mounted.
    stubAt(899);
    mount('/');
    expect(doorCounts(), '899px').toEqual({ wordmark: 1, docs: 1, accounts: 1, settings: 1, inbox: 0, mail: 1, unread: 0, bell: 1 });
    expect(document.querySelector('.shell-nav .fleet-head .wordmark')).not.toBeNull();
  });

  /** `n` unread mail records past the feed's ack, and one the count never counts (an interrupt record). */
  function unreadFeed(n: number): NotifyEvent[] {
    const stamp = Date.now();
    act(() => { ack(FEED_ACK_KEY, stamp); });
    return [
      ...Array.from({ length: n }, (_, i): NotifyEvent => ({ seq: i + 1, at: stamp + 60_000 + i, kind: 'mail', sessionId: 'x', title: 'unread', body: '', runId: null })),
      { seq: n + 1, at: stamp + 120_000, kind: 'interrupt', sessionId: 'x', title: 'interrupt · keycap', body: 'source=keycap outcome=sent', runId: null },
    ];
  }

  it("at the desk with mail unread, the rail's Inbox door names and shows the count, and nothing else in the frame does", () => {
    for (const width of [900, 1280, 1920]) {
      stubAt(width);
      act(() => useFleetStore.setState({ feed: unreadFeed(2) }));
      mount('/');
      const door = within(rail()).getByRole('button', { name: 'Inbox, 2 unread' });
      expect(door, `${width}px`).toHaveAttribute('data-command', 'go-inbox');
      // The tooltip says the same as the name, and the pill prints the number.
      expect(door.querySelector('.ins-rail-tip')?.textContent, `${width}px: tooltip`).toBe('Inbox, 2 unread');
      expect(door.textContent, `${width}px: tooltip, then the count`).toBe('Inbox, 2 unread2');
      // Nothing else in the frame names or draws an unread count: the list head's Mail door is gone at a desk.
      expect(doorCounts(), `${width}px`).toEqual({ wordmark: 1, docs: 1, accounts: 1, settings: 1, inbox: 1, mail: 0, unread: 1, bell: 1 });
      expect(document.querySelector('.mail-badge'), `${width}px`).toBeNull();
      expect(document.querySelectorAll('.ins-rail-count, .mail-badge-count'), `${width}px: count pills`).toHaveLength(1);
      cleanup();
    }
    // The printed count is capped like the sibling doors' and the name carries the real number.
    stubAt(1280);
    act(() => useFleetStore.setState({ feed: unreadFeed(120) }));
    mount('/');
    const capped = within(rail()).getByRole('button', { name: 'Inbox, 120 unread' });
    expect(capped.textContent).toBe('Inbox, 120 unread99+');
  });

  it('with no mail unread, the Inbox door draws no badge', () => {
    for (const width of [900, 1920]) {
      stubAt(width);
      mount('/');
      const door = within(rail()).getByRole('button', { name: 'Inbox' });
      expect(door.textContent, `${width}px`).toBe('Inbox');
      expect(door.querySelector('.ins-rail-count'), `${width}px`).toBeNull();
      expect(document.querySelectorAll('.ins-rail-count, .mail-badge-count'), `${width}px: no count pill anywhere`).toHaveLength(0);
      expect(doorCounts(), `${width}px`).toMatchObject({ inbox: 1, mail: 0, unread: 0 });
      cleanup();
    }
    // Interrupt records and records at or before the ack are not unread.
    stubAt(1280);
    act(() => useFleetStore.setState({ feed: unreadFeed(0) }));
    mount('/');
    expect(within(rail()).getByRole('button', { name: 'Inbox' }).textContent).toBe('Inbox');
  });

  it('the pool-lag readout shows once at the desk when the epochs differ', () => {
    act(() => useFleetStore.setState({ pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: 3 } }));
    for (const width of [900, 1280, 1920]) {
      stubAt(width);
      mount('/');
      expect(screen.getAllByTestId('pool-epoch-lag'), `${width}px`).toHaveLength(1);
      expect(screen.getByTestId('pool-epoch-lag')).toHaveTextContent('epoch 5 / observed 3');
      cleanup();
    }
    act(() => useFleetStore.setState({ pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: 5 } }));
    stubAt(1280);
    mount('/');
    expect(screen.queryByTestId('pool-epoch-lag')).toBeNull();
  });

  it('one banner stack at any width', () => {
    for (const width of [899, 900, 1280, 1920]) {
      stubAt(width);
      act(() => useFleetStore.setState({ conn: 'down', sessions: [S] }));
      navigate('/');
      render(<App />);
      expect(document.querySelectorAll('[data-banner="offline"]').length, `${width}px: banner stacks`).toBe(1);
      cleanup();
    }
  });
});

// ---- Desk polish, T2g (D-6715) ----------------------------------------------------------------------------------

describe('the desk (T2g): one count, in the status bar', () => {
  const readout = fleetSummary([S, WS], null).readout;

  it("at 900, 1280 and 1920 Instrument's list column draws no count line, and the status bar's fleetSummary is the one count in the frame", () => {
    for (const width of [900, 1280, 1920]) {
      stubAt(width);
      mount('/');
      const counts = document.querySelectorAll('.fleet-count, .ins-status-summary');
      expect(counts, `${width}px: count elements`).toHaveLength(1);
      expect(footer().contains(counts[0]!), `${width}px: inside the status bar`).toBe(true);
      expect(counts[0]!.textContent, `${width}px`).toBe(readout);
      // By its text, not its class: a count that came back under a new class name is still a second one.
      const leaves = [...document.body.querySelectorAll('*')].filter((el) => el.children.length === 0);
      expect(leaves.filter((el) => (el.textContent ?? '').includes(readout)), `${width}px: leaves that say the count`).toHaveLength(1);
      cleanup();
    }
  });

  it("at 899 Instrument's list column keeps its count line", () => {
    stubAt(899);
    mount('/');
    expect(document.querySelector('.shell-nav .fleet-count')).toHaveTextContent(readout);
    expect(document.querySelector('footer.shell-status')).toBeNull();
  });

  it("at the desk the list column's head is the pool lag alone when the epochs differ, and there is no head when they agree", () => {
    stubAt(1280);
    act(() => useFleetStore.setState({ pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: 3 } }));
    mount('/');
    const head = document.querySelector('.shell-nav .fleet-head');
    expect(head).not.toBeNull();
    expect(head!.textContent).toBe('epoch 5 / observed 3');
    expect(head!.querySelector('.fleet-count, .wordmark')).toBeNull();
    cleanup();
    act(() => useFleetStore.setState({ pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: 5 } }));
    mount('/');
    expect(document.querySelector('.shell-nav .fleet-head')).toBeNull();
  });

  it("Refined's desk column keeps its count line", () => {
    act(() => { setSkin(REFINED); });
    stubAt(1280);
    mount('/');
    expect(document.querySelector('.shell-nav .fleet-count')).toHaveTextContent(readout);
  });

  it('Refined at 1280 on an empty fleet with no lag draws no .shell-nav .fleet-head', () => {
    act(() => { setSkin(REFINED); });
    stubAt(1280);
    mount('/', []);
    expect(document.querySelector('.shell-nav')).not.toBeNull();
    expect(document.querySelector('.shell-nav .fleet-head')).toBeNull();
  });
});
