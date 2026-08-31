import { describe, it, expect, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RUN_STATES, SPAWN_STALL_MS, type FleetSession, type RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { RUN_ORDER, RUN_WORD, dispatchWindow, itemTallyLabel, programWave, resumeNote, runItems } from '../src/fleet/runWords';
import { spawnChip, spawnVerdictChip } from '../src/fleet/spawnWords';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// RunSummary as PR I actually shipped it (shared/api.ts) — NOT the plan's
// historical illustrative shape. `id` is a number, there is no `waves`
// (it's `waveOf`), there is no `holdReason` at all (never rides the wire —
// see RunsScreen.tsx's own header comment), and `items` carries only
// `{done,total}` — no `failed`/`blocked` columns exist anywhere.
//
// `dispatchStartedAt` DEFAULTS TO NULL ON PURPOSE, and it is not laziness: null
// is what an older build's row carries and what a run nobody has dispatched
// carries, so this default IS the no-regression baseline — every case below
// must keep rendering exactly as it did before the column existed. A case about
// the dispatch window sets it explicitly through `over`.
//
// `claimedBy` names a coordinator that is deliberately NOT one of the sessions
// any fixture in this file puts in the fleet — the ownership edge is real data
// on the row, and no case here is about rendering the edge, so the parent stays
// absent and every row keeps its top-level position.
const r = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
  wave: 3, waveOf: 4, project: 'ccrc-pwa',
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', claimedBy: 'ccrc-pwa-coordinator', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0, ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'ccrc-pwa-clear-cove', wrapper: 'claude', home: 'claude', project: 'ccrc-pwa',
  workdir: '/w', workspace: 'clear-cove', name: null, title: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/clear-cove', tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'working', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null, ...over,
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

  it('never asks REST on an interval — one cold read per mount, never a poll (mutation sweep, Task 8)', async () => {
    // The file's own header states the reason: "Polling would be a fourth
    // cadence for data that changes on human timescales; this reads it once
    // and lets the socket carry updates." `toHaveBeenCalledTimes(1)` above
    // proves the FIRST call is unconditional but says nothing about a SECOND
    // one arriving later on a timer. `useNow` legitimately runs its own
    // unrelated `setInterval` for the relative-time readout — at whichever
    // cadence the board's dispatch-window gate picked — so a bare
    // "setInterval was never called" spy is a false positive on the REAL
    // component — this drives fake time forward with
    // `advanceTimersByTimeAsync` (which also flushes the promise microtask
    // queue between ticks) and counts `loadRuns` calls directly instead.
    vi.useFakeTimers();
    try {
      const store = makeStore();
      act(() => { store.setState({ runs: [r()], runsFrameSeen: true }); });
      const load = vi.fn().mockResolvedValue({ runs: [] });
      render(<RunsScreen store={store} loadRuns={load} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cold-starts from GET /api/runs when no frame has landed', async () => {
    // The deep-link case, and the older-server case: /ws/fleet may never send
    // a runs frame at all, and a blank board would be a lie about the program.
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [r()] })} />);
    expect(await screen.findByText('clear-cove')).toBeInTheDocument();
  });

  it('resolves loadCold and populates Finished under React StrictMode — the aliveRef guard must RE-ARM, not just latch false once (I1, regression, measured)', async () => {
    // StrictMode (dev-only) runs every effect mount -> cleanup -> mount, on
    // the SAME component instance, before the app ever gets a "real" mount.
    // `aliveRef`'s cleanup sets `.current = false`; without re-arming it as
    // the effect's own first statement, that `false` survives the simulated
    // remount and the guard on every `loadCold()` resolution
    // (`if (aliveRef.current) { setCold(...); setColdState(...) }`) then
    // silently drops every real state update for the rest of the component's
    // life — the board hangs on "Loading…" forever. This is measured: it
    // fails against the pre-fix `useRef(true)` + bodyless-cleanup shape.
    const store = makeStore();
    const finishedRun = r({ id: 9, wave: 1, state: 'done', closedAt: Date.now() });
    render(
      <StrictMode>
        <RunsScreen store={store} loadRuns={async () => ({ runs: [finishedRun] })} />
      </StrictMode>,
    );
    expect(await screen.findByRole('group', { name: /finished/i })).toBeInTheDocument();
    expect(screen.getByText('clear-cove')).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).toBeNull();
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

  it('renders an em dash, never 0/0, for a run that declared no ledger', () => {
    // Spec §3.3 / D-288 (was D-B4-15): a wave that declared no ledger must not read as a
    // wave that has done nothing — `summarize()`'s own rule ("drop zero-count
    // clauses rather than print `0 X`") applied to the one place it was not.
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ items: { done: 0, total: 0 } })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(document.querySelector('.run-tally')?.textContent).toBe('—');
    expect(screen.queryByText('0/0')).toBeNull();
  });

  it('renders 3/7 for a run that declared seven', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(document.querySelector('.run-tally')?.textContent).toBe('3/7');
  });

  it('renders 0/7 for a declared ledger nothing has settled yet — only total 0 is the dash', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ items: { done: 0, total: 7 } })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(document.querySelector('.run-tally')?.textContent).toBe('0/7');
  });

  it('gives the tally no glyph — it is a count, not a state', () => {
    // Two-cue discipline applies to STATES. A tally is a count and gets no
    // second cue invented for it (spec §3.3).
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ items: { done: 0, total: 0 } })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    const tally = document.querySelector('.run-tally');
    expect(tally?.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(tally?.getAttribute('title')).toBeNull();
  });

  it('itemTallyLabel is the one place the rule lives, and it is total-based', () => {
    expect(itemTallyLabel({ done: 0, total: 0 })).toBe('—');
    expect(itemTallyLabel({ done: 0, total: 1 })).toBe('0/1');
    expect(itemTallyLabel({ done: 3, total: 7 })).toBe('3/7');
    // A row that reached a renderer without `items` at all reads as no
    // declared ledger, not as a crash — `runItems`' own tolerance, composed.
    expect(itemTallyLabel(runItems({}))).toBe('—');
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
    // `runItems`' `{done:0,total:0}` default, rendered through
    // `itemTallyLabel`: a row that reached this renderer without a tally
    // reads as "no declared ledger" (spec §3.3's em dash), never as `0/0` —
    // which would be a claim that a ledger exists and nothing in it is done.
    expect(document.querySelector('.run-tally')?.textContent).toBe('—');
    expect(screen.queryByText('0/0')).toBeNull();
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

  it('a reconstructed run (state:done, closedAt:null) lands in Finished, not nowhere (finding 3)', async () => {
    // `CoordStore.reconstruct` (the disaster-recovery rebuild) never writes
    // `closedAt` — pinned server-side as one of the facts the drill cannot
    // recover — so a rebuilt program's finished waves carry `state:'done'`
    // with `closedAt:null` forever. Splitting on `closedAt` filed a row like
    // this in NEITHER group; splitting on `state` (what `CoordStore.runs()`
    // itself uses) finds it correctly.
    const store = makeStore();
    act(() => { store.setState({ runs: [], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({
      runs: [r({ id: 1, wave: 1, state: 'done', closedAt: null })],
    })} />);
    expect(await screen.findByRole('group', { name: /finished/i })).toBeInTheDocument();
    expect(screen.getByText('clear-cove')).toBeInTheDocument();
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

  it('a run that closes while this screen is open joins Finished, not vanishes (finding 22)', async () => {
    // Without the fix, `cold` stays frozen at its mount-time snapshot for
    // the rest of the screen's life — the live frame can drop the row (it
    // just did, previous test), but nothing ever asks the archive again, so
    // the newly-closed run is never seen as `done` and never lands in
    // Finished either. `loadRuns` here answers differently on its SECOND
    // call, the way the real `?closed=1` route would once the close has
    // actually landed server-side.
    const store = makeStore();
    let calls = 0;
    const loadRuns = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? { runs: [r({ id: 7 })] }
        : { runs: [r({ id: 7, state: 'done', closedAt: Date.now() })] };
    });
    render(<RunsScreen store={store} loadRuns={loadRuns} />);
    expect(await screen.findByText('clear-cove')).toBeInTheDocument();
    act(() => { store.setState({ runs: [r({ id: 7 })], runsFrameSeen: true }); });
    expect(screen.getByText('clear-cove')).toBeInTheDocument();
    // The run closes: the live active-only frame drops it — this is the
    // exact trigger the fix watches for.
    act(() => { store.setState({ runs: [] }); });
    expect(await screen.findByRole('group', { name: /finished/i })).toBeInTheDocument();
    expect(screen.getByText('clear-cove')).toBeInTheDocument();
    expect(loadRuns).toHaveBeenCalledTimes(2);
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

  // Task 14 gate: `role="group"` is never a named landmark that can be
  // empty (`RunsScreen.tsx`'s own comment, "seven named regions holding
  // nothing turn the landmark rotor into dead ends"). Every OTHER test that
  // finds the Finished group either has a genuine finished row or a real
  // read failure to report (`coldFailed`) — none of them proves the
  // ordinary, successful, truly-empty case renders no group at all. Active
  // runs present, the cold read resolves `ok`, and finished is honestly
  // empty: there must be nothing here for a screen reader's landmark list
  // to land on and find empty.
  it('renders no Finished group at all when the archive genuinely has none — an empty role=group is a dead end, not an honest state', async () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [r()] })} />);
    expect(await screen.findByText('clear-cove')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /finished/i })).toBeNull();
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

  it('has a back control at the tap floor, and an empty state that explains itself', async () => {
    // `getByText` synchronously, before the cold read resolves, would now hit
    // the loading render (finding 19: "loading" and "confirmed empty" are no
    // longer the same state) — `findByText` waits for the real answer, which
    // is what a live app would show.
    render(<RunsScreen store={makeStore()} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByLabelText(/back to fleet/i)).toHaveClass('runs-back');
    expect(await screen.findByText(/no runs/i)).toBeInTheDocument();
  });

  it('says it could not read, not "No runs", when the cold read fails and no live frame has landed', async () => {
    // Review finding 19's own failure scenario: phone offline, or the server
    // mid-restart, with a program in flight — this must not assert the
    // program never existed.
    render(<RunsScreen store={makeStore()} loadRuns={async () => { throw new Error('offline'); }} />);
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/^no runs\./i)).toBeNull();
  });

  it('says it could not read, not "No runs", when a live frame HAS landed (honestly empty) but the archive read failed (I6, residual)', async () => {
    // The gap the finding 19 fix above did not close: `noSignalYet` reads
    // `!runsFrameSeen`, so the instant the live frame has said ANYTHING —
    // including a true, honest `[]` — that guard stands down even though
    // `finished`'s only source, the cold read, never answered at all. Before
    // this fix `!hasAny` fell straight through to the ordinary "No runs.",
    // a positive claim about the WHOLE program history a failed archive
    // read has no standing to make.
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={async () => { throw new Error('offline'); }} />);
    // The live frame lands separately, honestly reporting no active runs —
    // it says nothing at all about the archive.
    act(() => { store.setState({ runs: [], runsFrameSeen: true }); });
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/^no runs\./i)).toBeNull();
  });

  it('surfaces the Finished half\'s OWN failure when active rows already make the board non-empty (I6, residual)', async () => {
    // `hasAny` is true here purely off the live frame's active row — the
    // pre-fix board rendered that group fine and simply omitted Finished
    // entirely, with nothing on screen distinguishing "the archive is
    // genuinely empty" from "the archive could not be read".
    const store = makeStore();
    act(() => { store.setState({ runs: [r()], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => { throw new Error('offline'); }} />);
    // The active group renders as normal — this is not the whole-board
    // failure state, only the Finished half's own.
    expect(await screen.findByText('clear-cove')).toBeInTheDocument();
    const finishedGroup = await screen.findByRole('group', { name: /finished/i });
    expect(finishedGroup).toHaveTextContent(/could not reach the server/i);
  });
});

// Task 11 review, Important 1: the only place `CoordBanner` is actually
// mounted in production is `RunsScreen.tsx`, and before this test nothing
// pinned that mount — `coord-banner.test.tsx` only pins the NEGATIVE half
// (FleetScreen finds none) and `tap-targets.test.tsx` renders `RunsScreen`
// with `coord: null`, so the banner is absent there by construction either
// way. A merge conflict or a "clean up RunsScreen" pass could drop the
// `<CoordBanner store={store} />` line and every existing test would stay
// green while the pause readout silently stopped shipping.
describe('the coord banner mounts on /runs (Task 11, spec §4.2)', () => {
  it('renders .coord-banner once a coord frame has landed, ordered after .offline-banner', () => {
    const store = makeStore();
    act(() => {
      store.setState({
        conn: 'down', // also exercises the offline banner, so both can be ordered
        coord: { pause: 'clear', mail: 'clear' },
        coordFrameSeen: true,
      });
    });
    const { container } = render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);

    const banner = container.querySelector('.coord-banner');
    const offline = container.querySelector('.offline-banner');
    expect(banner).not.toBeNull();
    expect(offline).not.toBeNull();

    // Brief, Step 5: "above the groups and below the Reconnecting… banner" —
    // DOM order (not merely presence) is what that sentence actually asks
    // for, so this checks order, not just membership.
    const order = [...container.querySelectorAll('.offline-banner, .coord-banner')];
    expect(order).toEqual([offline, banner]);
  });
});

// Task 12 review lesson, applied ahead of time (Task 11's own review, finding
// "Important 1"): a control that only ever renders in its OWN isolated test
// file (`abandon-sheet.test.tsx`) ships missing the moment a merge or a
// cleanup pass drops the line from `RunsScreen.tsx` — every OTHER test here
// stays green because nothing else renders `RunsScreen` with a run and looks
// for it. This pins the row control on a REAL row, in the file that already
// owns every other row-level assertion (`.run-open`, the tally, the glyph).
describe('the abandon control mounts on every run row (Task 12, spec §4.3, D-287 (was D-B4-14))', () => {
  it('renders .run-abandon as a sibling of .run-open, not nested inside it', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);

    const abandon = screen.getByRole('button', { name: /abandon run 3/i });
    expect(abandon).toHaveClass('run-abandon');
    const open = screen.getByRole('button', { name: /clear-cove/i });
    expect(open).toHaveClass('run-open');
    // Siblings under the same <li>, never one nested in the other.
    expect(open.parentElement).toBe(abandon.parentElement);
    expect(open.contains(abandon)).toBe(false);
    expect(abandon.contains(open)).toBe(false);
  });
});

// Task 13 review lesson, applied ahead of time (Task 11/12's own reviews,
// "Important 1" both times): a control that only ever renders in its own
// isolated test file (`start-program.test.tsx`) ships missing the moment a
// merge or a cleanup pass drops the line from `RunsScreen.tsx` — every OTHER
// test here stays green because nothing else renders `RunsScreen` and looks
// for it. This pins the door on the REAL screen, including at zero runs
// (spec §4.4: "one door, rendered at zero runs too").
describe('the program-start door mounts on /runs (Task 13, spec §4.4)', () => {
  it('renders even at zero runs — one door, always there', async () => {
    render(<RunsScreen store={makeStore()} loadRuns={async () => ({ runs: [] })} />);
    expect(await screen.findByText(/no runs/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start a program/i })).toHaveClass('program-start-door');
  });

  it('opens the sheet on tap', async () => {
    render(<RunsScreen store={makeStore()} loadRuns={async () => ({ runs: [] })} />);
    fireEvent.click(await screen.findByRole('button', { name: /start a program/i }));
    expect(await screen.findByText(/the coordinator picks up from there/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 3 (spawn visibility): the dispatch window, and the wedge.
//
// The measured gap this pins closed: from dispatch acceptance to a usable
// pane, the run board sat on `planned` and never moved, while the fleet screen
// showed the same event as three fault-shaped words in sequence. `planned` is
// overloaded — it means BOTH "opened, nobody has dispatched" and "a dispatch is
// in flight" — and `dispatchStartedAt` (Task 1) is the fact that separates
// them. This half of the build is what reads it.
// ---------------------------------------------------------------------------

/** A fixed wall clock. The `in-flight`/`stalled` boundary is `SPAWN_STALL_MS`
 *  EXACTLY, so a test that let real time run could not state which side of it
 *  a case is on — the assertion would be true by a margin, not by the
 *  constant.
 *
 *  THE `499` IS LOAD-BEARING — do not round it. `RunsScreen` carries the tick
 *  to the row in MILLISECONDS and derives its own `nowSec` there, rather than
 *  flooring once upstream, and its own comments justify that at length: a
 *  boundary stated in milliseconds cannot be measured by a clock already
 *  floored to seconds, by up to 999 of them. On a whole-second `FROZEN` that
 *  claim was untestable and untested — flooring the clock inside the row was a
 *  no-op for every case here, so planting
 *  `dispatchWindow(run, nowSec * 1000)` in place of `dispatchWindow(run,
 *  nowMs)` passed all 47 (measured, review round). With a sub-second
 *  remainder the same probe reds twice — the wedge lands 499 ms late and the
 *  in-flight clock reads `0:41` for a 42-second spawn — so the millisecond
 *  path is now held by a mechanism instead of by three comments. */
const FROZEN = 1_800_000_000_499;

/** Runs `body` with `Date.now()` pinned at `FROZEN`. The timers are always
 *  restored, including on a failing assertion — a suite that leaks fake timers
 *  hangs the NEXT file, not this one, and that is the hardest kind of flake to
 *  attribute. */
function atFrozenClock(body: () => void): void {
  vi.useFakeTimers({ now: FROZEN });
  try { body(); } finally { vi.useRealTimers(); }
}

describe('dispatchWindow — the three-way answer, decided once and away from the renderer (Task 3)', () => {
  it('is `none` for a planned run nobody has fresh-spawn dispatched', () => {
    // The no-regression baseline: an ordinary wave N+1 row, opened and
    // waiting. `null` here is one of TWO honest conditions (the other being a
    // resume-only run — `shared/api.ts`'s own docstring names both), and
    // neither of them is a dispatch in flight.
    expect(dispatchWindow(r({ state: 'planned', dispatchStartedAt: null }), FROZEN))
      .toEqual({ phase: 'none' });
  });

  it('is `in-flight` below the threshold, carrying the elapsed span itself', () => {
    // The span rides on the answer rather than being recomputed by the caller:
    // a renderer that re-derives `now - startedAt` is a second reader of the
    // same nullable field, and the `!` it needs to do so is exactly where the
    // NaN gets in.
    expect(dispatchWindow(r({ state: 'planned', dispatchStartedAt: FROZEN - 42_000 }), FROZEN))
      .toEqual({ phase: 'in-flight', elapsedMs: 42_000 });
  });

  it('is `stalled` AT SPAWN_STALL_MS exactly — the boundary is the constant, not a rounded neighbour', () => {
    // One millisecond either side, measured against the shared constant. The
    // threshold is deliberately >= the `ws-add` verb ceiling, so at this point
    // the runner has certainly given up: the console is not guessing early.
    expect(dispatchWindow(r({ state: 'planned', dispatchStartedAt: FROZEN - (SPAWN_STALL_MS - 1) }), FROZEN).phase)
      .toBe('in-flight');
    expect(dispatchWindow(r({ state: 'planned', dispatchStartedAt: FROZEN - SPAWN_STALL_MS }), FROZEN))
      .toEqual({ phase: 'stalled', elapsedMs: SPAWN_STALL_MS });
  });

  it('is `none` once the state has moved off `planned`, however old the stamp — STATE ends the render, not the field', () => {
    // §Design: "Success moves `state` to `dispatched`, which is what stops the
    // 'dispatching' rendering; the timestamp stays as forensic material." A
    // window keyed on the timestamp alone would leave every dispatched run in
    // the fleet's history claiming to be spawning, forever.
    for (const state of ['dispatched', 'working', 'awaiting-review', 'done', 'failed'] as const) {
      expect(dispatchWindow(r({ state, dispatchStartedAt: FROZEN - 1_000 }), FROZEN), state)
        .toEqual({ phase: 'none' });
    }
  });

  it('degrades a row that reached it without the key at all to `none`, never to a NaN clock', () => {
    // The same tolerance `runItems`/`runClosedAt` already carry, for the same
    // measured reason: neither the live `{type:'runs'}` frame nor
    // `api.runs()` shape-validates a row, so a row minted by a build older
    // than the column arrives with the key MISSING. `undefined !== null` is
    // true, so a bare null-check would call that a dispatch in flight and
    // render `NaN` as its elapsed clock.
    const older = { ...r({ state: 'planned' }) } as Partial<RunSummary>;
    delete older.dispatchStartedAt;
    expect(dispatchWindow(older as RunSummary, FROZEN)).toEqual({ phase: 'none' });
  });

  it('clamps a stamp from the future to a zero-length window rather than reading it as stalled', () => {
    // Server clock ahead of the phone's: the span is negative, and a raw
    // `>= SPAWN_STALL_MS` comparison would answer `in-flight` correctly by
    // luck while handing the renderer a negative clock.
    expect(dispatchWindow(r({ state: 'planned', dispatchStartedAt: FROZEN + 5_000 }), FROZEN))
      .toEqual({ phase: 'in-flight', elapsedMs: 0 });
  });
});

describe('the run board renders the dispatch window — and the wedge (Task 3)', () => {
  /** Mounts the board with one run on the live frame. */
  const board = (over: Partial<RunSummary>): void => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ ...over })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
  };
  /** A run in the shape a `planned` one actually reaches the wire in: no
   *  session id (the server learns it by registry diff, AFTER `ws-add`
   *  returns) and no `dispatchedAt` (nothing has completed). The default
   *  fixture is a `working` row and carries both, so spelling them out here is
   *  what keeps these cases about the dispatch window rather than about a
   *  half-real row. */
  const planned = (over: Partial<RunSummary>): void =>
    board({ state: 'planned', sessionId: null, dispatchedAt: null, ...over });
  const cell = (): HTMLElement | null => document.querySelector('.run-dispatch');

  it('renders NO dispatch affordance for a planned run nobody has dispatched — exactly as the board read before the column existed', () => {
    atFrozenClock(() => {
      planned({ dispatchStartedAt: null });
      expect(cell()).toBeNull();
      expect(screen.queryByText(/dispatching/i)).toBeNull();
      expect(screen.queryByText(/never completed/i)).toBeNull();
      // Every other cell still says what it said: the branch is additive.
      expect(screen.getByText(RUN_WORD.planned)).toBeInTheDocument();
      expect(document.querySelector('.run-when')?.textContent).toBe('—');
    });
  });

  it('says ⟳ dispatching… with a live elapsed clock while the spawn is in flight', () => {
    atFrozenClock(() => {
      planned({ dispatchStartedAt: FROZEN - 42_000 });
      expect(cell()?.textContent).toContain('dispatching…');
      expect(cell()?.textContent).toContain('0:42');
      expect(cell()).toHaveAttribute('data-phase', 'in-flight');
      // Two cues, the board's standing rule: a word AND a glyph, so the state
      // is never read out of colour alone.
      expect(cell()?.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(screen.queryByText(/never completed/i)).toBeNull();
    });
  });

  it('keeps the row inert for NAVIGATION while the affordance renders — there is still no session to open', () => {
    atFrozenClock(() => {
      planned({ dispatchStartedAt: FROZEN - 42_000 });
      // Inertness is about the TAP, not about the text. A button that
      // navigates to a session id that does not exist yet says something
      // false; the row saying a spawn is under way says something true, and
      // the two are not the same claim.
      expect(document.querySelector('.run-row')).toHaveAttribute('data-inert', 'true');
      expect(screen.queryByRole('button', { name: /clear-cove/i })).toBeNull();
      expect(cell()).not.toBeNull();
    });
  });

  it('renders the wedge — dispatch never completed — once the threshold has passed, and stops saying dispatching', () => {
    atFrozenClock(() => {
      planned({ dispatchStartedAt: FROZEN - SPAWN_STALL_MS });
      // `dispatch.ts`'s own words for this class: "a run stuck in `planned`
      // beside an unexplained new workspace is a state no verb names". It has
      // a name on screen now, and it is not the in-flight one.
      expect(cell()?.textContent).toMatch(/never completed/i);
      expect(cell()).toHaveAttribute('data-phase', 'stalled');
      expect(screen.queryByText(/dispatching/i)).toBeNull();
    });
  });

  it('is one millisecond short of the wedge at SPAWN_STALL_MS - 1 — the rendered boundary IS the constant', () => {
    atFrozenClock(() => {
      planned({ dispatchStartedAt: FROZEN - (SPAWN_STALL_MS - 1) });
      expect(cell()).toHaveAttribute('data-phase', 'in-flight');
      expect(screen.queryByText(/never completed/i)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // The tick, review round. §Design's complaint about the state this build
  // exists to fix is "three fault-shaped words for an entirely normal event,
  // and A BOARD THAT NEVER MOVES" — so a dispatch window rendered to the
  // second on a board that re-renders every 30 s only moves the complaint. The
  // operator would watch `⟳ dispatching… 0:12` sit motionless for half a
  // minute and then jump to `0:42`, and the wedge would arrive up to 30 s
  // after `SPAWN_STALL_MS` had actually passed. The cadence has to follow what
  // the row renders.
  // -------------------------------------------------------------------------

  /** `atFrozenClock`'s async twin, for the cases that ADVANCE the clock rather
   *  than only read it: `advanceTimersByTimeAsync` flushes the promise
   *  microtask queue between ticks, which a React state update fired from an
   *  interval needs before the DOM reflects it. */
  const fromFrozenClock = async (body: () => Promise<void>): Promise<void> => {
    vi.useFakeTimers({ now: FROZEN });
    try { await body(); } finally { vi.useRealTimers(); }
  };

  /** Every interval the board asks the timer for during one mount, in ms.
   *  The interval IS the instrument here because there is nothing else to
   *  watch: when no row is inside a dispatch window, NOTHING on this board is
   *  second-granular (`formatAge` rounds everything under two minutes to "just
   *  now"), so no readout can report the cadence. `useNow` is the only
   *  `setInterval` in this screen's whole tree — measured across `pwa/src`:
   *  `CoordBanner`, `AbandonSheet` and `StartProgramSheet` run none, and this
   *  store never connects — so every recorded call is the tick.
   *
   *  `mockRestore()` BEFORE `useRealTimers()`, deliberately: the spy wraps the
   *  FAKE `setInterval`, and unwinding in the other order would hand the
   *  global back the fake after the fake clock had already been uninstalled —
   *  a leaked timer that hangs the next FILE, not this one. */
  const cadenceOf = (mount: () => void): number[] => {
    vi.useFakeTimers({ now: FROZEN });
    const spy = vi.spyOn(globalThis, 'setInterval');
    try {
      mount();
      return spy.mock.calls.map((c) => Number(c[1]));
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
      cleanup();
    }
  };

  it('moves the in-flight clock every second — the readout the operator watches actually advances', async () => {
    await fromFrozenClock(async () => {
      planned({ dispatchStartedAt: FROZEN - 42_000 });
      expect(cell()?.textContent).toContain('0:42');
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(cell()?.textContent).toContain('0:43');
    });
  });

  it('renders the wedge within a second of SPAWN_STALL_MS, not up to thirty after it', async () => {
    await fromFrozenClock(async () => {
      // One second short of the threshold at mount, past it after one tick.
      // At the board's old standing cadence the row keeps claiming the spawn
      // is in flight for the rest of the half-minute — the operator is told a
      // dispatch is progressing that the runner has already given up on.
      planned({ dispatchStartedAt: FROZEN - (SPAWN_STALL_MS - 1_000) });
      expect(cell()).toHaveAttribute('data-phase', 'in-flight');
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(cell()).toHaveAttribute('data-phase', 'stalled');
    });
  });

  it('asks for the slow cadence when no row is spawning — both directions, or it is not a gate', () => {
    // The same rule the `└─` bracket gets one task over: an affordance that is
    // always on is not a gate. A board with nothing spawning has nothing
    // second-granular to say, and paying a re-render a second to say it would
    // be the cost without the reason.
    expect(cadenceOf(() => planned({ dispatchStartedAt: null }))).toEqual([30_000]);
    expect(cadenceOf(() => board({ state: 'working' }))).toEqual([30_000]);
    // The stamp SURVIVES success — §Design: a measurement, never cleared — so
    // a gate that read the FIELD instead of asking `dispatchWindow` would tick
    // once a second for every run the fleet has ever dispatched, forever, on a
    // board with nothing to narrate. Which is why the gate asks the same
    // function the row does.
    expect(cadenceOf(() => board({
      state: 'dispatched', dispatchStartedAt: FROZEN - 42_000, dispatchedAt: FROZEN - 1_000,
    }))).toEqual([30_000]);
    expect(cadenceOf(() => planned({ dispatchStartedAt: FROZEN - 42_000 }))).toEqual([1_000]);
    // The wedge keeps the fast tick: its own elapsed span is still rendered to
    // the second (the title `dispatch.ts`'s wedge carries), and the row is
    // still `planned` — the window has not closed, it has gone bad.
    expect(cadenceOf(() => planned({ dispatchStartedAt: FROZEN - SPAWN_STALL_MS }))).toEqual([1_000]);
  });

  it('says nothing about dispatching once the run reaches `dispatched`, though the stamp survives on the row', () => {
    atFrozenClock(() => {
      // The forensic half of §Design, rendered: `dispatchedAt -
      // dispatchStartedAt` stays readable on the row for as long as the run
      // exists, and the board still stops narrating the spawn the instant it
      // succeeded.
      board({ state: 'dispatched', dispatchStartedAt: FROZEN - 42_000, dispatchedAt: FROZEN - 1_000 });
      expect(cell()).toBeNull();
      expect(screen.queryByText(/dispatching/i)).toBeNull();
      expect(screen.getByText(RUN_WORD.dispatched)).toBeInTheDocument();
    });
  });
});

// ── Task 5: the facts that already ship, finally read ──────────────────────
//
// Nothing below is a new WIRE fact. `FleetSession.spawnState` has ridden the
// fleet frame since §1.6b and `RunSummary.resumed`/`clearedAt` since Build 4 —
// and this board, which already holds the whole `FleetSession` for every row it
// links (it looks one up by `sessionId` for the degrade note), rendered neither.
// The gap was never measurement; it was reading.

describe('the run row renders its session’s spawn verdict (Task 5)', () => {
  /** Mounts the board with one run and the session it links to. */
  const withSession = (over: Partial<FleetSession>): void => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()], runsFrameSeen: true, sessions: [sess(over)] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
  };
  const chip = (): HTMLElement | null => document.querySelector('.sess-spawn');

  it('renders the verdict with SessionLine’s own class and word — one vocabulary, two surfaces', () => {
    // `.sess-spawn`, not a second `.run-…` class for the identical meaning:
    // the same reuse this row already makes of `.sess-unmeasured`, and the
    // reason RunsScreen.tsx gives for it. The WORD comes from the one table
    // (`spawnWords.ts`), so the two surfaces cannot drift into two names for
    // one verdict.
    withSession({ spawnState: 'blocked' });
    expect(chip()?.textContent).toBe('blocked');
    expect(chip()).toHaveAttribute('data-spawn', 'blocked');
  });

  it('says nothing for a healthy spawn — `ready` goes THROUGH the table, it is not special-cased', () => {
    // `SPAWN_WORD` is typed `string | null` precisely so a member can be
    // SILENT; a row whose last spawn was clean has nothing to qualify.
    withSession({ spawnState: 'ready' });
    expect(chip()).toBeNull();
  });

  it('says nothing for the shape every healthy live session actually carries — the no-regression baseline', () => {
    // All eighteen live sessions carry `spawnState: null` with
    // `started: true`. A rule of "chip on anything not ready" would light a
    // warning on every row on the board; this is the half that keeps it dark.
    withSession({ spawnState: null, started: true });
    expect(chip()).toBeNull();
  });

  it('shows a verdict this build cannot NAME as itself, prefixed — never as silence', () => {
    // §1.7's render-seam rule, and the reason it has to hold on this surface
    // too: the two deploy lanes have no version handshake, so a newer agent's
    // verdict reaching an older bundle is a real window. Hiding an unknown
    // verdict is strictly worse than showing an ugly one.
    withSession({ spawnState: 'quarantined' as FleetSession['spawnState'] });
    expect(chip()?.textContent).toBe('? quarantined');
  });

  it('says nothing at all for a run whose session the fleet frame has not named', () => {
    // The `planned` row's ordinary shape: no session id yet, so no session to
    // read a verdict off. A chip here would be a claim about a pane that does
    // not exist.
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ sessionId: null, state: 'planned' })], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(chip()).toBeNull();
  });

  // ── The scoping, and the two conditions the first round left unmeasured ──
  //
  // Task 5's Step 1 asks this board for the linked session's `spawnState`
  // "WHEN IT IS NOT `null`". `spawnChip` answers a wider question than that —
  // it is the FLEET ROW's question, and its `unstarted` fallback fires when
  // `spawnState` IS null — so the board asks the narrower one by name
  // (`spawnVerdictChip`). The three pins below are what makes that a mechanism:
  // the fallback's ABSENCE here, the verdict's survival beside it, and the dead
  // exemption measured on THIS surface rather than borrowed from the other one.

  it('says nothing for a row that has not claimed — `unstarted` is not a VERDICT, and this board asks for one', () => {
    // WHY THE BOARD DIVERGES, in the order the argument has to be made.
    //
    // 1. §Design opens by naming `unstarted` as one of the three fault-shaped
    //    words an ordinary spawn currently spends four minutes wearing. A build
    //    whose premise is "stop saying that" must not propagate it to a second
    //    surface.
    // 2. On THIS surface the word cannot even be true the way it is on the
    //    fleet screen. `cmd_ws_add` writes the claim (`_reg_claim`, ccd:2708)
    //    BEFORE the settle it then blocks in, and a run learns its `sessionId`
    //    only from the registry diff AFTER `ws-add` returns
    //    (`dispatch.ts`, the fresh-spawn arm) — so at the first instant a run
    //    row can look a session up, `started` is already `1`, and it is
    //    monotone within a row (`_reg_claim`'s header: nothing in that file
    //    clears it; only `_reg_purge` does, and that destroys the identity).
    // 3. What actually reaches this arm is the OTHER condition `started ===
    //    false` carries. `server/src/registry.ts` maps it as
    //    `startedRead.ok && startedRead.content === '1'`, so a `.started` that
    //    was listed and could not be READ this pass arrives as `false` — and
    //    `FleetSession` does not carry the evidence that would tell the two
    //    apart (`lifecycleUnmeasured` is spent on `lifecycle` server-side and
    //    goes no further; `unmeasured` is identity fields only). Rendering that
    //    as "unstarted" states a fact about a worker that is running fine.
    //    `sessionLifecycle` already refuses exactly this inference in this
    //    repo's own words — "an UNREADABLE `started` cannot be mistaken for an
    //    absent one" — and it is the same seam.
    withSession({ spawnState: null, started: false });
    expect(chip()).toBeNull();
  });

  it('still renders a RECORDED verdict on a row that never claimed — the scoping drops the fallback, not the verdict', () => {
    // The other direction, and the one that makes the pin above a scoping
    // rather than a mute button: `started === false` is not itself a reason to
    // go quiet. A spawn that recorded `blocked` says `blocked` here whatever
    // the claim marker reads.
    withSession({ spawnState: 'blocked', started: false });
    expect(chip()?.textContent).toBe('blocked');
  });

  it('never renders a chip on a dead row — the exemption measured on THIS surface, not borrowed', () => {
    // The dead exemption is `spawnWords.ts`'s, shared by both surfaces, and
    // until now only `session-line.test.tsx` measured it: deleting it left
    // this suite entirely green. Nothing is running, so how the last spawn
    // ended describes work that no longer exists.
    withSession({ spawnState: 'blocked', status: 'dead' });
    expect(chip()).toBeNull();
  });

  it('the two surfaces diverge on ONE named question, and both halves are stated here', () => {
    // The divergence is deliberate, so it is pinned in both directions rather
    // than left as a difference someone tidies away. The fleet row keeps the
    // fallback (`swift-harbor` — a real workspace whose only signal is the
    // absent claim, and the fleet screen is where an operator goes looking for
    // one); the board does not.
    const shape = sess({ spawnState: null, started: false });
    expect(spawnChip(shape)).toEqual({ word: 'unstarted', data: 'unstarted' });
    expect(spawnVerdictChip(shape)).toBeNull();
  });
});

describe('the run row renders the resume it has always carried (D-1, Task 5)', () => {
  const board2 = (over: Partial<RunSummary>): void => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r(over)], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
  };
  const cellR = (): HTMLElement | null => document.querySelector('.run-resumed');

  it('says nothing for a wave that spawned fresh — the no-regression baseline', () => {
    board2({ resumed: false, clearedAt: null });
    expect(cellR()).toBeNull();
  });

  it('says the wave was resumed, and that the /clear landed', () => {
    // D-1: wave >= 2 cannot spawn fresh into an existing workspace, so the
    // dispatch route resumes the pane and injects `/clear` through the send
    // path. `clearedAt` is the PROOF the second step ran.
    board2({ resumed: true, clearedAt: Date.now() - 120_000 });
    expect(cellR()?.textContent).toBe('resumed');
    expect(cellR()).toHaveAttribute('data-cleared', 'true');
  });

  it('says something DIFFERENT when the resume has no proof its context was cleared', () => {
    // The two must not collapse into one word. A resumed pane whose `/clear`
    // never landed is carrying the previous wave's context into this one —
    // which is the entire reason D-1 injects it — and that is the operator's
    // problem, not a rendering detail.
    board2({ resumed: true, clearedAt: null });
    expect(cellR()).not.toBeNull();
    expect(cellR()?.textContent).not.toBe('resumed');
    expect(cellR()?.textContent).toMatch(/not cleared/i);
    expect(cellR()).toHaveAttribute('data-cleared', 'false');
  });

  it('degrades a row that reached it without the key at all to silence, never to a half-sentence', () => {
    // The same tolerance `runItems`/`runClosedAt`/`dispatchWindow` already
    // carry, for the same measured reason: nothing between the wire and this
    // renderer validates a row's members.
    const older = { ...r() } as Partial<RunSummary>;
    delete older.resumed;
    expect(resumeNote(older as RunSummary, 0)).toBeNull();
  });
});
