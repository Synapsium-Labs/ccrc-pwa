import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RUN_STATES, type FleetSession, type RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { RUN_ORDER, RUN_WORD, programWave } from '../src/fleet/runWords';
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

describe('programWave — the group header’s own derived fact (fix round 1, task 5, finding 4)', () => {
  it('is the FURTHEST wave in the list, never the list’s own head row', () => {
    // `runsByProgram` orders urgency-first, so the head row can be an OLDER
    // wave (here, 'awaiting-review' outranks 'working' in RUN_ORDER even
    // though its wave is behind). The header must still state wave 2.
    const list = [
      r({ id: 2, wave: 1, state: 'awaiting-review' }),
      r({ id: 1, wave: 2, state: 'working' }),
    ];
    expect(programWave(list)).toEqual({ wave: 2, waveOf: 4 });
  });

  it('answers the honest zero/null for an empty list rather than indexing off the end', () => {
    expect(programWave([])).toEqual({ wave: 0, waveOf: null });
  });
});

describe('the run board', () => {
  it('renders the live frame’s active runs immediately — the cold read is issued too, but the active half never waits on it', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()], runsFrameSeen: true }); });
    const load = vi.fn().mockResolvedValue({ runs: [] });
    render(<RunsScreen store={store} loadRuns={load} />);
    // The cold read is now UNCONDITIONAL (finding 1) — it is the only
    // possible source of the Finished half — but the active row born from
    // the live frame renders synchronously, before that promise has any
    // chance to settle.
    expect(screen.getByText('clear-cove')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
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
    act(() => {
      store.setState({
        runs: [r({ id: 1, wave: 1, state: 'done', closedAt: 1 }), r({ id: 2 })],
        runsFrameSeen: true,
      });
    });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    const group = screen.getByRole('group', { name: /build4-transcript-surface/i });
    expect(group.tagName).toBe('DIV');
    expect(document.querySelectorAll('section[aria-label]')).toHaveLength(0);
  });

  it('says the wave and the work-item tally, in tabular mono', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()], runsFrameSeen: true }); });
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
    act(() => { store.setState({ runs: [r({ state: 'awaiting-review' })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText(RUN_WORD['awaiting-review'])).toBeInTheDocument();
    expect(document.querySelector('.run-glyph')).not.toBeNull();
  });

  it('lands a state this build has never heard of on `unknown` instead of rendering an empty cell', () => {
    // The designated we-do-not-know member IS 'unknown' itself, so a fixture
    // typed `state: 'unknown'` only proves `RUN_WORD.unknown` exists —
    // nothing about the DEGRADATION path. A state string that is not a
    // member of `RunState` at all (cast at the fixture, the way it would
    // genuinely arrive — neither the live frame nor `api.runs()` shape-
    // validates a row) is what the total lookup has to survive (finding 2).
    const store = makeStore();
    const fromNewerBuild = { ...r(), state: 'quarantined' } as unknown as RunSummary;
    act(() => { store.setState({ runs: [fromNewerBuild], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText(RUN_WORD.unknown)).toBeInTheDocument();
  });

  it('guards a row with no `items` rather than throwing mid-render (finding 2)', () => {
    const store = makeStore();
    const noItems = { ...r() } as Partial<RunSummary>;
    delete noItems.items;
    const bad = noItems as unknown as RunSummary;
    act(() => { store.setState({ runs: [bad], runsFrameSeen: true }); });
    expect(() => render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />)).not.toThrow();
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });

  it('a row with no `closedAt` lands in Active, never silently in Finished (finding 2)', () => {
    const store = makeStore();
    const noClosedAt = { ...r() } as Partial<RunSummary>;
    delete noClosedAt.closedAt;
    const bad = noClosedAt as unknown as RunSummary;
    act(() => { store.setState({ runs: [bad], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText('clear-cove')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /finished/i })).toBeNull();
  });

  it('splits finished runs out on closedAt — fed by the cold read, the only source of a finished row', async () => {
    // The live frame is active-only BY CONSTRUCTION (the file header's own
    // comment) — it can never carry id 1's closed row. Only the cold
    // `?closed=1` read can, and — like the real route — it carries BOTH
    // halves (finding 1: driven through the real seam, not `setState`).
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ id: 2 })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({
      runs: [r({ id: 1, wave: 1, state: 'done', closedAt: Date.now() - 1 }), r({ id: 2 })],
    })} />);
    expect(await screen.findByRole('group', { name: /finished/i })).toBeInTheDocument();
  });

  it('a run that closes stops being active the instant the live frame says so — never resurrected by a stale cold snapshot (finding 3, failure A)', async () => {
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [r({ id: 7 })] })} />);
    // The cold read lands: run 7, active.
    expect(await screen.findByText('clear-cove')).toBeInTheDocument();
    // The live frame then lands, agreeing run 7 is active…
    act(() => { store.setState({ runs: [r({ id: 7 })], runsFrameSeen: true }); });
    expect(screen.getByText('clear-cove')).toBeInTheDocument();
    // …then run 7 closes: the active-only frame broadcasts an HONEST `[]`.
    // The board must trust it, not the cold snapshot frozen at mount.
    act(() => { store.setState({ runs: [] }); });
    expect(screen.queryByText('clear-cove')).toBeNull();
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });

  it('the Finished group survives a new active run landing — it never re-reads from `live` (finding 3, failure B)', async () => {
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={async () => ({
      runs: [r({ id: 1, wave: 1, state: 'done', closedAt: Date.now() - 1 })],
    })} />);
    expect(await screen.findByRole('group', { name: /finished/i })).toBeInTheDocument();
    act(() => { store.setState({ runs: [r({ id: 10 })], runsFrameSeen: true }); });
    expect(screen.getByRole('group', { name: /finished/i })).toBeInTheDocument();
  });

  it('the group header states the program’s FURTHEST wave, never an arbitrary row’s own (finding 4)', () => {
    const store = makeStore();
    act(() => {
      store.setState({
        runs: [
          // 'awaiting-review' outranks 'working' in RUN_ORDER, so it leads
          // the sorted group — but the program's own wave is 2, not 1.
          r({ id: 2, wave: 1, state: 'awaiting-review' }),
          r({ id: 1, wave: 2, state: 'working' }),
        ],
        runsFrameSeen: true,
      });
    });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText('wave 2/4')).toBeInTheDocument();
    expect(screen.queryByText('wave 1/4')).toBeNull();
  });

  it('opens the run’s session — and renders an INERT row when there is no session to open', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()], runsFrameSeen: true }); });
    const { rerender } = render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /clear-cove/i }));
    expect(location.pathname).toBe('/s/ccrc-pwa-clear-cove');

    act(() => { store.setState({ runs: [r({ sessionId: null, state: 'planned' })], runsFrameSeen: true }); });
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
      store.setState({ runs: [r()], runsFrameSeen: true, sessions: [sess({ unmeasured: ['workdir'] })] });
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
