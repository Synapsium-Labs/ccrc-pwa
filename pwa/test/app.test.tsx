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
  archivedBytes: 1_200_000_000, hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, ...over,
});

afterEach(() => {
  cleanup();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [] }));
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
