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
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';

const { App } = await import('../src/app');
const { navigate } = await import('../src/lib/router');
const { initSkin, setSkin } = await import('../src/lib/skin');
const { useFleetStore } = await import('../src/stores/fleet');
const { ROUTES } = await import('../src/lib/routes');
const { RAIL_ITEMS } = await import('../src/skins/instrument/Rail');
const { fleetSummary } = await import('../src/fleet/fleetSummary');

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
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
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
