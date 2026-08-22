// The route table itself (app.tsx) had NO test coverage before Task 19 —
// `/s/:id` has been wired since it was first added with nothing exercising
// it, and `/archive` would have joined it invisibly. This file is scoped to
// exactly the wiring Task 19 touches: the `/archive` route, its detail-pane
// swap, and its onOpen handoff to `/s/:id` — not a general App test suite.
// DEVIATION from the brief's Test: list (which names only
// server/test/fleet.test.ts and pwa/test/archive-screen.test.tsx); see
// task-19-report.md.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { App } from '../src/app';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'demo', workdir: '/w',
  workspace: 'quiet-basin', name: null, status: 'dead', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: 1785300123,
  archivedBytes: 1_200_000_000, hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null, ...over,
});

afterEach(() => {
  cleanup();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
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

// ── the detail pane's scroll offset does not survive a route change (D-161) ──

describe('a route change puts the detail pane back at the top (D-161)', () => {
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
