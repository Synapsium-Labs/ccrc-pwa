// The route table itself (app.tsx) had NO test coverage before Task 19 —
// `/s/:id` has been wired since it was first added with nothing exercising
// it, and `/archive` would have joined it invisibly. This file is scoped to
// exactly the wiring Task 19 touches: the `/archive` route, its detail-pane
// swap, and its onOpen handoff to `/s/:id` — not a general App test suite.
// DEVIATION from the brief's Test: list (which names only
// server/test/fleet.test.ts and pwa/test/archive-screen.test.tsx); see
// task-19-report.md.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AccountUsage, FleetSession } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { App } from '../src/app';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { navigate } from '../src/lib/router';
import { setSkin } from '../src/lib/skin';
import { matchRoute, ROUTES } from '../src/lib/routes';
import { useFleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { TEST_ROSTER } from './rosterFixture';
import { seventeenLanes } from './seventeenLanes';

const s = (over: Partial<FleetSession> = {}): FleetSession => (fleetSession({ workspace: 'quiet-basin', status: 'dead', branch: 'ws/quiet-basin', archivedAt: 1785300123, archivedBytes: 1_200_000_000, ...over }));

afterEach(() => {
  cleanup();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
});

describe('App /archive route', () => {
  it('renders ArchiveScreen in the detail pane, and it is empty when nothing is archived', () => {
    navigate('/archive');
    render(<App />);
    expect(screen.getByText(/nothing is archived/i)).toBeInTheDocument();
  });

  it('joins [data-view="session"] the same way /s/:id does — the fleet sidebar hides on mobile', () => {
    // Task 19 reused the EXISTING mobile swap rather than teaching shell.css a
    // third state: a mutant reverting this to `sessionId ? 'session' : 'fleet'`
    // (dropping the `|| archive`) would leave /archive on data-view='fleet',
    // which on a phone hides the very screen the footer row just navigated to.
    navigate('/archive');
    render(<App />);
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'session');
  });

  it('lists an archived row and opens it — onOpen routes to /s/:id, not somewhere else', () => {
    act(() => useFleetStore.setState({ conn: 'open', sessions: [s()] }));
    navigate('/archive');
    render(<App />);
    // `/^workspace /i`, not `/workspace/i`: the sidebar's own "New workspace
    // on demo" add button also matches the looser pattern once FleetScreen
    // mounts alongside the /archive detail pane.
    fireEvent.click(screen.getByRole('button', { name: /^workspace /i }));
    expect(location.pathname).toBe('/s/demo-quiet-basin');
  });

  it('leaves / on data-view="fleet" and /s/:id routing to SessionScreen untouched', () => {
    // Not a regression test for SessionScreen's own behaviour (covered
    // elsewhere) — just proof the `sessionId || archive` OR did not swallow
    // the plain `/` case, which every /archive mutant risks by construction.
    navigate('/');
    render(<App />);
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'fleet');
    expect(screen.queryByText(/nothing is archived/i)).not.toBeInTheDocument();
  });
});

describe('App /accounts route (Task 6, Build 3 PR G)', () => {
  it('renders AccountsScreen and joins [data-view="session"] like /s/:id and /archive do', () => {
    // app.test.tsx's own warning (this file, Task 19 above) is real here too:
    // /accounts has to ride the SAME data-view OR every other non-fleet route
    // does, or a phone hides the very screen it just navigated to.
    navigate('/accounts');
    render(<App />);
    expect(screen.getByRole('heading', { name: /accounts/i })).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'session');
  });
});

// T2c (D-6329, Q14): a card opens /accounts?lane=<id>, and the screen scrolls the lane's row into view. The shell's
// reset of the detail pane runs on every path or search change, as a LAYOUT effect, and layout effects run child before
// parent: an arrival made in a layout effect (the screen is the child) would be undone by the reset that follows it.
describe('App /accounts?lane= (T2c, D-6329)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("a second lane on /accounts scrolls after the shell's pane reset", async () => {
    const at = Math.floor(Date.now() / 1000);
    const usage = (wrapper: string): AccountUsage => ({
      wrapper, five: 10, seven: 5, ts: at - 60, fiveResetAt: null, sevenResetAt: null,
      fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
    });
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [usage('claude'), usage('claude9')], projected: null, roster: TEST_ROSTER });
    // One array for the pane's scrollTop writes and the arrival's scrollIntoView calls: their ORDER is the property.
    const log: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      const lane = this.matches('.accounts-row[data-lane]') ? this.getAttribute('data-lane') : null;
      if (lane !== null) log.push(`scroll:${lane}`);
    });
    navigate('/accounts?lane=claude');
    render(<App />);
    await screen.findAllByText('team·alt');
    await act(async () => {});
    expect(log, 'the first lane arrived once the poll landed').toEqual(['scroll:claude']);
    const pane = document.querySelector('.shell-detail');
    expect(pane).not.toBeNull();
    let top = 300;
    Object.defineProperty(pane!, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => { top = v; log.push(`reset:${v}`); },
    });
    log.length = 0;
    act(() => { navigate('/accounts?lane=claude9'); });
    expect(log).toEqual(['reset:0', 'scroll:claude9']);
  });
});

describe('App block overlay (the dormant handshake, Rider E)', () => {
  it('renders BlockScreen OUTSIDE/above .app-shell when the fleet store is blocked', () => {
    act(() => useFleetStore.setState({ blocked: true }));
    render(<App />);

    const shell = document.querySelector('.app-shell');
    const block = document.querySelector('.block-screen');
    expect(block).toBeInTheDocument();
    // Not a descendant — a banner lives inside a pane, this has to cover the
    // whole shell (and any sheet/toast on top of it), which only works as a
    // SIBLING rendered before .app-shell, not nested inside it.
    expect(shell?.contains(block)).toBe(false);
    // DOM order: block comes BEFORE the shell, i.e. the shell "follows" it.
    const rel = block!.compareDocumentPosition(shell!);
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders nothing when not blocked', () => {
    act(() => useFleetStore.setState({ blocked: false }));
    render(<App />);
    expect(document.querySelector('.block-screen')).not.toBeInTheDocument();
  });
});

describe('App /mail route', () => {
  it('renders MailScreen and joins [data-view="session"] like every other non-fleet route', () => {
    navigate('/mail');
    render(<App />);
    expect(screen.getByRole('heading', { name: /^mail$/i })).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'session');
  });
});

describe('App /runs route', () => {
  it('renders RunsScreen and joins [data-view="session"] like every other non-fleet route', () => {
    navigate('/runs');
    render(<App />);
    expect(screen.getByRole('heading', { name: /^runs$/i })).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'session');
  });
});

describe('App /settings route', () => {
  it('renders SettingsScreen and joins [data-view="session"] like every other non-fleet route', () => {
    // Spec §13 names this pin, and this file's /archive warning is why it has
    // two halves: a route left out of the data-view chain still renders on a
    // desktop (.shell-detail is always shown there) and is HIDDEN behind the
    // fleet sidebar on a phone. The heading catches a missing ternary rung;
    // the attribute catches a missing `|| settings`.
    navigate('/settings');
    render(<App />);
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'session');
  });
});

// T9-R2 (coordinator ruling closing a Task 9 review gap): FleetScreen's
// `epoch`/`observedEpoch` props were fully tested but had no real producer —
// app.tsx is the ONLY place `<FleetScreen>` is rendered, and it passed
// neither. This proves the wiring off the fleet store's `pools` frame (the
// one carrier — no second poll), not the indicator's own render logic
// (fleet-screen.test.tsx already covers that).
describe('App wires the pools frame\'s epoch/observedEpoch into FleetScreen (T9-R2)', () => {
  it('renders the staleness chip once the store has a pools frame naming both, and they differ', () => {
    act(() => useFleetStore.setState({
      pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: 3 },
    }));
    render(<App />);
    expect(screen.getByTestId('pool-epoch-lag')).toHaveTextContent('epoch 5 / observed 3');
  });

  it('renders nothing before any pools frame has arrived — pools stays null', () => {
    render(<App />);
    expect(screen.queryByTestId('pool-epoch-lag')).not.toBeInTheDocument();
  });

  it('renders "never synced" for observedEpoch:null, never a fabricated number', () => {
    act(() => useFleetStore.setState({
      pools: { listed: false, enforcement: 'unknown', epoch: 5, observedEpoch: null },
    }));
    render(<App />);
    expect(screen.getByTestId('pool-epoch-lag')).toHaveTextContent('epoch 5 / observed never synced');
  });

  it('renders nothing when epoch is absent, even though observedEpoch is a real number', () => {
    act(() => useFleetStore.setState({
      pools: { listed: false, enforcement: 'unknown', observedEpoch: 9 },
    }));
    render(<App />);
    expect(screen.queryByTestId('pool-epoch-lag')).not.toBeInTheDocument();
  });
});

// ── the detail pane's scroll offset does not survive a route change (D-161) ──

describe('a route change puts the detail pane back at the top (D-161)', () => {
  /** THAT it lands, not WHEN: none of these three can tell a layout effect from
   *  a passive one (`navigate` flushSync's both), which is why the ordering has
   *  a file of its own — app-pane-reset-timing.test.tsx. */

  /** jsdom does NO LAYOUT, so nothing here is really scrollable: the prototype
   *  `scrollTop` is a hard 0 and assigning it is discarded. An own accessor
   *  pair on the node records what the shell WRITES, which is exactly the
   *  property under test — a route change writes 0 to the pane — and it is the
   *  only way this suite can observe it. (The offset itself was measured in a
   *  real browser: scrolled to 2517, children replaced, still 2517.) */
  const track = (el: Element, start: number): { readonly top: number } => {
    let top = start;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => { top = v; },
    });
    return { get top() { return top; } };
  };

  const panes = (): { detail: Element; nav: Element } => {
    const detail = document.querySelector('.shell-detail');
    const nav = document.querySelector('.shell-nav');
    expect(detail, '.shell-detail is the pane the reset is about').not.toBeNull();
    expect(nav, '.shell-nav is the pane the reset must NOT touch').not.toBeNull();
    return { detail: detail!, nav: nav! };
  };

  it('resets .shell-detail when the route changes under it', () => {
    navigate('/mail');
    render(<App />);
    const { detail } = panes();
    const scroll = track(detail, 2517);      // where a long screen leaves it
    act(() => { navigate('/runs'); });
    // The new screen's <h1> and its Back button are the top of this pane; at
    // 2517 they are above the fold and the operator sees a mid-list stranger.
    expect(scroll.top).toBe(0);
  });

  it('resets on back/forward too — popstate is the same route change', () => {
    navigate('/mail');
    render(<App />);
    const { detail } = panes();
    const scroll = track(detail, 1200);
    act(() => {
      history.pushState(null, '', '/runs');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(scroll.top).toBe(0);
  });

  it('LEAVES THE SIDEBAR ALONE — its content does not swap per route', () => {
    // .shell-nav has always been scrollable and always shows the same fleet
    // list. Resetting it would throw away the operator's place in that list
    // every time they opened a session: a regression dressed as a fix.
    navigate('/');
    render(<App />);
    const { nav } = panes();
    const scroll = track(nav, 900);
    act(() => { navigate('/mail'); });
    expect(scroll.top).toBe(900);
  });
});

// Docs W5 part 1, Task 9 (M4.R2; design 2026-10-01 section 4.2): `/docs` and every page under it mount the Docs
// screen in the detail pane and join the data-view chain, `/docsearch` does not (the pattern is `/docs` then a slash
// or the end, never a bare prefix), and the screen is not keyed, so one mount spans a visit. The screen's default
// loaders call `fetch`; it is stubbed offline here, so every load is the `unreachable` slot and nothing leaves the test.
describe('App /docs route (M4.R2)', () => {
  const offline = (): void => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['/docs', '/docs/demo/specs/x.md'])('%s renders the Docs screen in the detail pane and joins [data-view="session"]', async (url) => {
    offline();
    navigate(url);
    render(<App />);
    expect(document.querySelector('.shell-detail .docs-screen')).not.toBeNull();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'session');
    expect(await screen.findByText('The server could not be reached; Docs needs a connection.')).toBeInTheDocument();
  });

  it('/docsearch is not Docs: the placeholder renders and data-view stays fleet', () => {
    offline();
    navigate('/docsearch');
    render(<App />);
    expect(document.querySelector('.docs-screen')).toBeNull();
    expect(screen.getByText('Select a session')).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'fleet');
  });

  it('the Docs screen is not keyed: the same mount spans a page, ref and section change', () => {
    offline();
    navigate('/docs/demo');
    render(<App />);
    const first = document.querySelector('.docs-screen');
    expect(first).not.toBeNull();
    act(() => { navigate('/docs/demo/specs?ref=ws/a'); });
    expect(document.querySelector('.docs-screen')).toBe(first);
  });
});

// Docs W5.1 review 5-2: the pattern is `/docs` then a slash or the end. A word boundary would also take `/docs-x` and
// `/docs.md`, which are not Docs pages; `/docsearch` alone was tested.
describe('T13 review 5-2: /docs-x and /docs.md are not Docs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['/docs-x', '/docs.md'])('%s renders the placeholder and data-view stays fleet', (url) => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    navigate(url);
    render(<App />);
    expect(document.querySelector('.docs-screen')).toBeNull();
    expect(screen.getByText('Select a session')).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'fleet');
  });
});

// W2 S2a review: the fleet's five sheets render from `FleetFlows`, which `app.tsx` mounts beside `.app-shell`
// (D-5468). The fleet suites mount it themselves through test/fleetHost.tsx, so only the real App proves the
// production mount: drop `<FleetFlows />` from app.tsx and the fleet's doors open nothing, and this goes red.
describe('App mounts the fleet sheets (D-5468)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the fleet's New session door and a session's ··· door each open their sheet", () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'a', project: 'alpha', workspace: 'quiet-mesa',
      // A change just now keeps its project open (D-6088 rolls up a quiet one).
      statusUpdatedAt: Date.now() })] }));
    navigate('/');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(screen.getByRole('dialog', { name: /start a session/i })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /actions for quiet-mesa/i }));
    expect(screen.getByRole('button', { name: /restart session/i })).toBeInTheDocument();
  });
});

// ── the route table and the ladder are one table (D-5466, W2 Task S2b) ─────────

describe('ROUTES and the ladder, both ways', () => {
  // Every path the ladder has ever routed, plus near misses. A probe that a
  // ROUTES row matches must render that row's own screen; a probe no row
  // matches must render the fleet's placeholder. So a row dropped while the
  // ladder kept its own test, or a ladder rung the table never named, reds.
  const PROBES = [
    '/', `/s/${encodeURIComponent('demo-quiet-basin')}`, '/archive', '/accounts', '/mail', '/runs', '/settings',
    '/digest', '/docs', '/docs/notes/a.md', '/nope', '/docsearch', '/docs-x', '/s/', '/runsx', '/mail/x',
    // Settings' five pages and the catch-all (D-5504).
    '/settings/updates', '/settings/appearance', '/settings/notifications', '/settings/automation',
    '/settings/security', '/settings/bogus', '/settings/a/b',
  ];
  const placeholder = (): Element | null => document.querySelector('.shell-placeholder');

  it('every ROUTES row is reached by a probe, and every probe renders what the table says', () => {
    for (const r of ROUTES) expect(PROBES.some((p) => r.pattern.test(p)), `no probe for ${r.id}`).toBe(true);
    for (const p of PROBES) {
      navigate(p);
      const view = render(<App />);
      const at = matchRoute(p);
      if (at === null || at.route.id === 'fleet') {
        expect(placeholder(), `${p} is the fleet`).not.toBeNull();
        expect(document.querySelector('.app-shell'), p).toHaveAttribute('data-view', 'fleet');
      } else {
        expect(placeholder(), `${p} renders its own screen (${at.route.id})`).toBeNull();
        expect(document.querySelector('.app-shell'), p).toHaveAttribute('data-view', 'session');
      }
      view.unmount();
    }
  });

  it('`/settings/bogus` renders Settings with the not-found line, never ScreenFallback (D-5504)', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    try {
      navigate('/settings/bogus');
      render(<App />);
      const detail = document.querySelector('.shell-detail')!;
      expect(within(detail as HTMLElement).getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
      expect(within(detail as HTMLElement).getByText('That section does not exist.')).toBeInTheDocument();
      expect(within(detail as HTMLElement).getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
      expect(within(detail as HTMLElement).queryByText(/could not be shown/i)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── Settings' reads sit above the frame, on every route (D-5504) ──────────────

describe("Settings' provider keeps the frame (D-5504, D-161, D-5466)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('`/` → `/settings/updates` → `/` keeps the same .app-shell and sidebar nodes and the sidebar\'s scrollTop', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    navigate('/');
    render(<App />);
    const shell = document.querySelector('.app-shell');
    const nav = document.querySelector('.shell-nav')!;
    let top = 900;
    Object.defineProperty(nav, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    act(() => { navigate('/settings/updates'); });
    expect(screen.getByRole('heading', { level: 2, name: 'Updates' })).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toBe(shell);
    expect(document.querySelector('.shell-nav')).toBe(nav);
    act(() => { navigate('/'); });
    expect(document.querySelector('.app-shell')).toBe(shell);
    expect(document.querySelector('.shell-nav')).toBe(nav);
    expect(nav.scrollTop).toBe(900);
  });

  it('the detail section is the same DOM node across an entry to Settings and out', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    navigate('/runs');
    render(<App />);
    const detail = document.querySelector('.shell-detail');
    expect(detail).not.toBeNull();
    act(() => { navigate('/settings'); });
    expect(document.querySelector('.shell-detail')).toBe(detail);
    act(() => { navigate('/settings/automation'); });
    expect(document.querySelector('.shell-detail')).toBe(detail);
    act(() => { navigate('/runs'); });
    expect(document.querySelector('.shell-detail')).toBe(detail);
  });
});

describe('the frame: landmarks and the skip link (W2 Task S2b)', () => {
  it('exactly one main landmark, #content, holding the detail; the fleet column is a section named Fleet', () => {
    navigate('/runs');
    render(<App />);
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'content');
    expect(mains[0]).toHaveClass('shell-detail');
    expect(within(mains[0]!).getByRole('heading', { name: /^runs$/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fleet' })).toHaveClass('fleet');
  });

  it('the skip link is the first focusable element, before the desk bar, and moves focus to #content', () => {
    // On a desk, so the bar (and its doors) is mounted ahead of everything but the skip link.
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('min-width: 900px'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));
    navigate('/runs');
    render(<App />);
    expect(document.querySelector('header.shell-accounts'), 'the desk bar is mounted').not.toBeNull();
    const focusable = document.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(focusable[0]).toBe(skip);
    expect(document.querySelector('.app-shell')!.firstElementChild).toBe(skip);
    fireEvent.click(skip);
    expect(document.activeElement).toBe(document.getElementById('content'));
    vi.unstubAllGlobals();
  });

  // ONE ACCOUNTS STRIP PER WIDTH (W2 Global constraints, D-5678): the gate is split between `ShellFrame`'s
  // `desk &&` and `FleetColumn`'s `showAccounts={!desktop}`, so it is counted through App, in both skins.
  // The full strip is the only lane readout (T2c, D-6329): both desk bars mount it under their line, in the header.
  for (const skin of [REFINED, INSTRUMENT]) {
    for (const desk of [true, false]) {
      it(`${skin}, ${desk ? 'desk' : 'phone'}: exactly one accounts strip, in ${desk ? 'the header' : 'the fleet column'}`, () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
        vi.stubGlobal('matchMedia', (q: string) => ({
          matches: desk && q.includes('min-width: 900px'), media: q, onchange: null,
          addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
        }));
        try {
          setSkin(skin);
          navigate('/');
          render(<App />);
          const strips = document.querySelectorAll('.accounts-strip');
          expect(strips).toHaveLength(1);
          const bar = document.querySelector('header.shell-accounts');
          const fleet = screen.getByRole('region', { name: 'Fleet' });
          if (desk) {
            expect(bar?.contains(strips[0]!)).toBe(true);
            expect(fleet.contains(strips[0]!)).toBe(false);
          } else {
            expect(bar).toBeNull();
            expect(fleet.contains(strips[0]!)).toBe(true);
          }
        } finally {
          setSkin(REFINED);
          vi.unstubAllGlobals();
        }
      });
    }
  }

  // ONE FOLD CONTROL PER WIDTH (S5b, D-6530): the strip folds wherever it mounts, so with 17 lanes each width holds one
  // control, in the place that width's one strip sits. The desk's row is measured, so its arm stubs a 1248 px group.
  for (const skin of [REFINED, INSTRUMENT]) {
    for (const desk of [true, false]) {
      it(`one fold control per width, in both skins: ${skin}, ${desk ? 'desk, in the header\'s lanes row' : 'phone, in the fleet column'}`, async () => {
        const f = seventeenLanes(Math.floor(Date.now() / 1000));
        vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: f.accounts, projected: { wrapper: 'w0', score: 0 }, roster: f.roster });
        vi.stubGlobal('matchMedia', (q: string) => ({
          matches: desk && q.includes('min-width: 900px'), media: q, onchange: null,
          addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
        }));
        vi.stubGlobal('ResizeObserver', class {
          private readonly cb: ResizeObserverCallback;
          constructor(cb: ResizeObserverCallback) { this.cb = cb; }
          observe(target: Element): void {
            this.cb([{ target, contentRect: { width: 1248 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
          }
          unobserve(): void {}
          disconnect(): void {}
        });
        try {
          setSkin(skin);
          navigate('/');
          render(<App />);
          const strip = await screen.findByRole('group', { name: /^account usage/ });
          // The fold's control, not a card: `lane-a` shows before the fold does (the row is measured a render or two after
          // the poll lands), so a wait on it can read the strip at 17 cards with no control.
          await within(strip).findByRole('button', { name: /more/ });
          const controls = [...document.querySelectorAll('[aria-expanded][aria-controls]')]
            .filter((el) => /^(\+\d+ more|Show fewer)/.test(el.textContent ?? ''));
          expect(controls).toHaveLength(1);
          expect(strip.contains(controls[0]!)).toBe(true);
          expect(controls[0]).toHaveAttribute('aria-controls', strip.id);
          const bar = document.querySelector('header.shell-accounts');
          if (desk) expect(bar?.contains(strip)).toBe(true);
          else expect(screen.getByRole('region', { name: 'Fleet' }).contains(strip)).toBe(true);
          // Four on a phone; at the desk three of the 1248 px row's four tracks, the last the end cell's.
          expect(strip.querySelectorAll('.account-gauge')).toHaveLength(desk ? 3 : 4);
        } finally {
          setSkin(REFINED);
          vi.unstubAllGlobals();
        }
      });
    }
  }

  it("Settings' Theme and Layout fieldsets are the doors of Switch theme and Switch layout (doorMark)", () => {
    // On the page the W2 door table names for both (settings Task R2b1's C1).
    navigate('/settings/appearance');
    render(<App />);
    expect(screen.getByRole('group', { name: 'Theme' })).toHaveAttribute('data-command', 'switch-theme');
    expect(screen.getByRole('group', { name: 'Layout' })).toHaveAttribute('data-command', 'switch-layout');
  });
});
