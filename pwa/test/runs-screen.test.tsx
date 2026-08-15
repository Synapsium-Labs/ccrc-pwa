import { describe, it, expect, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RUN_STATES, type FleetSession, type RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { RUN_ORDER, RUN_WORD, itemTallyLabel, programWave, runItems } from '../src/fleet/runWords';
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
  bucket: 'working', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, ...over,
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
    // one arriving later on a timer. `useNow(30_000)` legitimately runs its
    // own unrelated `setInterval` for the relative-time readout, so a bare
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
    // Spec §3.3 / D-B4-15: a wave that declared no ledger must not read as a
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
describe('the abandon control mounts on every run row (Task 12, spec §4.3, D-B4-14)', () => {
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
