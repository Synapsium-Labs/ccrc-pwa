import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RUN_STATES, type FleetSession, type RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { RUN_ORDER, RUN_WORD } from '../src/fleet/runWords';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// RunSummary as PR I actually shipped it (shared/api.ts) — NOT the plan's
// historical illustrative shape. `id` is a number, there is no `waves`
// (it's `waveOf`), there is no `holdReason` at all (never rides the wire —
// see RunsScreen.tsx's own header comment), and `items` carries only
// `{done,total}` — no `failed`/`blocked` columns exist anywhere.
const r = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
  wave: 3, waveOf: 4, project: 'ccrc-pwa',
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0, ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'ccrc-pwa-clear-cove', wrapper: 'claude', home: 'claude', project: 'ccrc-pwa',
  workdir: '/w', workspace: 'clear-cove', name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/clear-cove', tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'working', bucketSince: null, unmeasured: [], ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

describe('the run vocabulary tracks RUN_STATES, not a hand-copied list', () => {
  it('RUN_ORDER names every RunState exactly once — the same drift guard RUN_STATES itself exists for', () => {
    // shared/api.ts's own docstring on RUN_STATES: a second, module-private
    // enumeration of the state space is exactly the drift that constant
    // exists to prevent. RUN_WORD/RUN_GLYPH get this for free from their
    // `Record<RunState,…>` typing (a compile error to miss a member);
    // RUN_ORDER is a bare array and gets no such check from the type system.
    expect([...RUN_ORDER].sort()).toEqual([...RUN_STATES].sort());
  });
});

describe('the run board', () => {
  it('renders the frame’s runs and never asks REST when the frame already answered', async () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()] }); });
    const load = vi.fn().mockResolvedValue({ runs: [] });
    render(<RunsScreen store={store} loadRuns={load} />);
    expect(screen.getByText('clear-cove')).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });

  it('cold-starts from GET /api/runs when no frame has landed', async () => {
    // The deep-link case, and the older-server case: /ws/fleet may never send
    // a runs frame at all, and a blank board would be a lie about the program.
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [r()] })} />);
    expect(await screen.findByText('clear-cove')).toBeInTheDocument();
  });

  it('groups by program, and the group is a role=group — not a landmark', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ id: 1, wave: 1, state: 'done', closedAt: 1 }), r({ id: 2 })] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    const group = screen.getByRole('group', { name: /build4-transcript-surface/i });
    expect(group.tagName).toBe('DIV');
    expect(document.querySelectorAll('section[aria-label]')).toHaveLength(0);
  });

  it('says the wave and the work-item tally, in tabular mono', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText('wave 3/4')).toBeInTheDocument();
    expect(screen.getByText('3/7')).toBeInTheDocument();
    // No blocked/failed cell: RunItemTally shipped as {done,total} only —
    // no failed/blocked columns exist anywhere (reconciliation item 1).
  });

  it('carries BOTH cues — a word and a glyph — for every state', () => {
    // StatusDot's discipline: "no state the user has to interpret from a status
    // dot alone". A run board that colour-coded alone would fail the same rule.
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ state: 'awaiting-review' })] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText(RUN_WORD['awaiting-review'])).toBeInTheDocument();
    expect(document.querySelector('.run-glyph')).not.toBeNull();
  });

  it('lands a state from a newer build on `unknown` instead of rendering an empty cell', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ state: 'unknown' })] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText(RUN_WORD.unknown)).toBeInTheDocument();
  });

  it('splits finished runs out on closedAt, and says so', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ id: 1, wave: 1, state: 'done', closedAt: Date.now() - 1 }), r({ id: 2 })] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByRole('group', { name: /finished/i })).toBeInTheDocument();
  });

  it('opens the run’s session — and renders an INERT row when there is no session to open', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()] }); });
    const { rerender } = render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /clear-cove/i }));
    expect(location.pathname).toBe('/s/ccrc-pwa-clear-cove');

    act(() => { store.setState({ runs: [r({ sessionId: null, state: 'planned' })] }); });
    rerender(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    // A dead button that navigates to a session that does not exist is worse
    // than a row you cannot tap.
    expect(screen.queryByRole('button', { name: /clear-cove/i })).toBeNull();
  });

  it('renders the linked session’s registry-degrade note, matching SessionLine’s own grey+reason idiom', () => {
    // FleetSession.unmeasured is the ladder's wire field (registry.ts's
    // SessionRecord.unmeasured, carried verbatim). RunSummary itself has no
    // such field — a run row's session is looked up from the live fleet
    // snapshot by sessionId, and when THAT session is degraded, the row says
    // so with the exact class/title SessionLine.tsx already uses, rather
    // than inventing a second vocabulary for the same fact.
    const store = makeStore();
    act(() => {
      store.setState({ runs: [r()], sessions: [sess({ unmeasured: ['workdir'] })] });
    });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    const note = screen.getByText('unreadable');
    expect(note).toHaveClass('sess-unmeasured');
    expect(note).toHaveAttribute('title', 'registry workdir temporarily unreadable — retrying');
  });

  it('has a back control at the tap floor, and an empty state that explains itself', () => {
    render(<RunsScreen store={makeStore()} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByLabelText(/back to fleet/i)).toHaveClass('runs-back');
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });
});
