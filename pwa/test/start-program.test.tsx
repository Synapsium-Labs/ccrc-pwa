// The start-a-program sheet — the run board's own door onto a NEW program
// (Task 13, spec §4.4). TDD red-first: written before `StartProgramSheet.tsx`
// exists, run once to confirm it fails for the right reason, then again once
// the implementation lands.
//
// D-291 (was D-B4-18) and D-292 (was D-B4-19) (`docs/superpowers/plans/2026-08-11-build4-conversation-and-
// controls.md`'s Deviations section) are both pinned here, alongside the
// brief's own eleven cases. The sheet cannot know the new session's id from
// `createSession`'s own response (`{ok:true}`, no id — `server/src/
// server.ts:593-596`), so it matches on fields a `/ws/fleet` frame reports,
// never on a recomputed id — and the two arms match on DIFFERENT fields:
//
//   * D-291's WAIT ("has the session I asked for appeared?") is
//     wrapper-scoped — `wrapper` + `project` + `workspace === null`, no
//     liveness — and bounded by `START_PROGRAM_WAIT_MS`. It ACTS (kickoff +
//     navigate), so it must not resolve onto anyone else's session.
//   * D-292 (was D-B4-19)'s REFUSAL ("is a live main checkout already running here?") is
//     wrapper-INDEPENDENT — `project` + `workspace === null` + alive.
//     `cmd_swap` rewrites a session's `wrapper` and keeps its id
//     (`ccd/ccd:7307`) while `cmd_start` collides on the id, so a
//     wrapper-scoped refusal misses a real collision and dead-ends the
//     operator on "not shown yet". It only ever withholds a button, so
//     over-refusing is the safe direction.
//
// Each conjunct is pinned below ON ITS OWN ARM: the killer was measured by
// deleting that conjunct from that one function, never from the shared
// `isMainCheckoutOf` helper. That distinction is the whole point — the first
// version of this header claimed the coverage before it existed, because
// while both arms shared one expression a single refusal-side test appeared
// to cover both, and splitting them left three of the wait's own conjuncts
// deletable with the suite fully green.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { programKickoff, readyVerdict } from '../../shared/api';
import type {
  CoordStatus, FleetSession, ProjectReadiness, ReadinessFacts,
} from '../../shared/api';
import { StartProgramSheet, openRunVerdict, startedSessionFor, START_PROGRAM_WAIT_MS } from '../src/fleet/StartProgramSheet';
import { missingPreconditions } from '../src/fleet/readinessWords';
import { ApiError, api } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude-ccrc-pwa', wrapper: 'claude', home: 'claude', project: 'ccrc-pwa',
  workdir: '/w', workspace: null, name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  // An alive row: `lifecycle` answers "why is this row NOT alive", so null is
  // the correct value here, not merely the one that compiles.
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false, ...over,
});

const proj = (over: Partial<{ name: string; workdir: string }> = {}): { name: string; workdir: string } => ({
  name: 'ccrc-pwa', workdir: '/home/u/projects/ccrc-pwa', ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
    close(): void {} }) as unknown as WebSocket,
});

/** The measured-and-empty answer — "the board has answered, nothing is open".
 *  Spelled once so the 45 pre-existing render sites all say the same thing, and
 *  so the four fixtures that mean something else stand out on the page. */
const NO_OPEN_RUNS: ReadonlySet<string> = new Set<string>();

const projected = (wrapper = 'claude', score = 5): { accounts: never[]; projected: { wrapper: string; score: number }; roster: never[] } =>
  ({ accounts: [], projected: { wrapper, score }, roster: [] });

/** Fills slug+title and picks the (only, by default) project row — the
 *  common setup every happy-path test below needs before it can see the
 *  confirm button at all. */
async function fillAndPick(slug = 'build9-demo', title = 'Build 9 demo', rowName = /ccrc-pwa/i): Promise<void> {
  fireEvent.change(screen.getByLabelText(/program slug/i), { target: { value: slug } });
  fireEvent.change(screen.getByLabelText(/program title/i), { target: { value: title } });
  fireEvent.click(await screen.findByRole('button', { name: rowName }));
}

// A harness that can CLOSE the sheet mid-flight — the same shape
// abandon-sheet.test.tsx's own `Harness` uses, and for the same reason: a
// sheet mounted once with a fixed `open` prop can never reach "closed while
// an attempt is outstanding".
function OpenHarness({
  createSession, queueKickoff, fleet,
}: {
  createSession: (b: { wrapper: string; project: string; workdir?: string }) => Promise<void>;
  queueKickoff: (id: string, b: { slug: string; title: string }) => Promise<{ queued: boolean }>;
  fleet: FleetStore;
}): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>close sheet</button>
      {/* Wave-4 fix round, MAJOR 1: reopening is the only way to SEE the state a
          superseded retry may have re-planted. `Sheet` is a vaul `Drawer.Portal`
          with no `forceMount`, so a closed sheet renders no children at all and
          a `queryByText` against the closed sheet would report absence whether
          the guard held or not. */}
      <button type="button" onClick={() => setOpen(true)}>reopen sheet</button>
      {/* `openRunProjects` is passed directly rather than threaded through this
          harness's own props: every case that uses it is about the supersession
          guard, not about the run board, and the measured-and-empty answer is
          what all of them want. */}
      <StartProgramSheet
        open={open}
        onClose={() => setOpen(false)}
        openRunProjects={NO_OPEN_RUNS}
        fleet={fleet}
        createSession={createSession}
        queueKickoff={queueKickoff}
        loadProjects={async () => ({ roots: [], projects: [proj()] })}
      />
    </>
  );
}

describe('kickoff — the one standing template, copied from the brief verbatim', () => {
  // A LITERAL comparison, not `programKickoff(...)` compared against itself — the
  // sheet's own tests below call `programKickoff()` to build their expectation too,
  // which pins that the sheet USES the constant but cannot catch the
  // constant's own text drifting away from the brief (measured: a one-word
  // change inside the template still passed every other test in this file).
  // This is the one place the brief's exact code block is checked against
  // what actually ships.
  it('matches the brief\'s kickoff code block byte for byte', () => {
    expect(programKickoff('build4-conversation-and-controls', 'Build 4: conversation and controls')).toBe(
      'You are the coordinator for program `build4-conversation-and-controls` (Build 4: conversation and controls).\n'
      + 'Its ledger is `docs/superpowers/programs/build4-conversation-and-controls.md`.\n'
      + 'Run the ccrc-coordinator skill and open the run for wave 1.',
    );
  });
});

// The wait arm as a pure predicate. Three of its four conjuncts are pinned
// through the component below, which is where they belong — but `preLive` is
// NOT reachable that way: `start()` refuses to run while `existing !== null`,
// and `existing` is any live main checkout in the project, so no tap can
// produce a snapshot that already holds a live matching row. Measured during
// this round: deleting `!preLive.has(s.id)` alone left the whole integration
// suite green (39/39). Rather than ship a guard the review ordered with no
// test that can see it — the exact failure the previous round was about — the
// predicate is pure and gets its own killer here.
describe('startedSessionFor — the wait arm, directly (B-2)', () => {
  const NONE: ReadonlySet<string> = new Set();
  const main = (over: Partial<FleetSession> = {}): FleetSession =>
    sess({ id: 'claude-ccrc-pwa', wrapper: 'claude', project: 'ccrc-pwa', workspace: null, ...over });

  it('takes a fresh live main checkout on the target wrapper', () => {
    expect(startedSessionFor([main()], 'claude', 'ccrc-pwa', NONE)?.id).toBe('claude-ccrc-pwa');
  });

  it('skips a row that was ALREADY LIVE in the pre-create snapshot — freshness', () => {
    // The conjunct with no reachable component-level path. Binding this row
    // would post the kickoff into a session the sheet never created.
    expect(startedSessionFor([main()], 'claude', 'ccrc-pwa', new Set(['claude-ccrc-pwa']))).toBeNull();
  });

  it('takes a row that was in the snapshot but DEAD and is now alive — a revival is my own create', () => {
    // `preLive` holds only ids that were alive, so a dead row is absent from
    // it by construction. This is why freshness is not "an id I had not seen".
    expect(startedSessionFor([main({ status: 'idle' })], 'claude', 'ccrc-pwa', new Set(['other-id']))?.id)
      .toBe('claude-ccrc-pwa');
  });

  it('skips a dead row, a workspace row, another wrapper and another project', () => {
    expect(startedSessionFor([main({ status: 'dead' })], 'claude', 'ccrc-pwa', NONE)).toBeNull();
    expect(startedSessionFor([main({ workspace: 'brisk-harbor' })], 'claude', 'ccrc-pwa', NONE)).toBeNull();
    expect(startedSessionFor([main({ wrapper: 'claude3' })], 'claude', 'ccrc-pwa', NONE)).toBeNull();
    expect(startedSessionFor([main({ project: 'rp-llm' })], 'claude', 'ccrc-pwa', NONE)).toBeNull();
  });
});

// THREE answers, and the third is the whole reason this is a function rather
// than a `.has()` at the call site. It follows `startedSessionFor`'s precedent
// in the same file (`StartProgramSheet.tsx`'s own docstring on it): the
// `unmeasured` answer is reachable through the component only via a prop
// fixture, and a pure predicate is the cheapest place to pin all three arms
// against each other.
describe('openRunVerdict — the run-board arm, directly (D-1130)', () => {
  it('answers unmeasured for null — NOT MEASURED is never folded into "no open run"', () => {
    expect(openRunVerdict(null, 'ccrc-pwa')).toBe('unmeasured');
  });

  it('answers open-run for a project the measured set names', () => {
    expect(openRunVerdict(new Set(['ccrc-pwa']), 'ccrc-pwa')).toBe('open-run');
  });

  it('answers clear for a measured set that does not name it — an EMPTY set included', () => {
    expect(openRunVerdict(new Set(['other-repo']), 'ccrc-pwa')).toBe('clear');
    expect(openRunVerdict(new Set<string>(), 'ccrc-pwa')).toBe('clear');
  });

  // The join between `RunSummary.project` and `ProjectRow.name` is CONVENTION:
  // `POST /api/runs` validates the field as a non-empty string and nothing more
  // (`server/src/coord/routes.ts:889-897`), so a run can name a string this
  // picker never lists. A prefix or case-folded match would refuse a real
  // project on the strength of a lookalike; an exact one means the sheet simply
  // has nothing to say about that run, which is the honest answer.
  it('matches EXACTLY — never by prefix, never case-folded', () => {
    expect(openRunVerdict(new Set(['ccrc-pwa-brisk-harbor']), 'ccrc-pwa')).toBe('clear');
    expect(openRunVerdict(new Set(['CCRC-PWA']), 'ccrc-pwa')).toBe('clear');
    expect(openRunVerdict(new Set(['ccrc']), 'ccrc-pwa')).toBe('clear');
  });
});

describe('StartProgramSheet', () => {
  // Coordinator review B-4: nothing pinned `useProjectedHome(open)`. The one
  // test that could have caught its removal was widened to exclude
  // `/api/accounts`, and its own comment conceded the exclusion was
  // "defensive rather than currently load-bearing". This sheet is mounted
  // UNCONDITIONALLY at RunsScreen level, so dropping the argument means
  // `/runs` polls `/api/accounts` every 20 s whether or not the door is ever
  // tapped — the exact shape `useProjectedHome`'s own docstring refuses.
  it('does not poll /api/accounts while the door is closed — the open gate is real (B-4)', async () => {
    const accounts = vi.spyOn(api, 'accounts').mockResolvedValue(projected());

    const { rerender } = render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open={false} onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);
    // Give the effect (and any immediate `load()`) a chance to run.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(accounts).not.toHaveBeenCalled();

    // Opening it is what asks — otherwise this would pass against a hook that
    // never polls at all.
    rerender(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);
    await waitFor(() => expect(accounts).toHaveBeenCalled());
  });

  it('collects slug, title and project, and refuses an empty slug', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.change(screen.getByLabelText(/program title/i), { target: { value: 'Build 9 demo' } });
    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    const go = await screen.findByRole('button', { name: /^start/i });
    expect(go).toBeDisabled(); // slug is still empty

    fireEvent.change(screen.getByLabelText(/program slug/i), { target: { value: 'build9-demo' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /^start/i })).not.toBeDisabled());
  });

  it('names the account it will place into BEFORE the tap (the projection, not a guess)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude2', 40));
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    // Named on the confirm button's own label — before any tap on it.
    expect(await screen.findByRole('button', { name: /start build9-demo on claude2/i })).toBeInTheDocument();
  });

  it('refuses with copy when the projection is null: nothing is placeable (D-284 (was D-B4-11))', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster: [] });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    expect(await screen.findByText(/nothing is placeable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  it('renders the in-flight state on the session create — the one long call', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession = vi.fn(() => new Promise<void>(() => {})); // never resolves
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      createSession={createSession}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));

    expect(await screen.findByRole('button', { name: /^starting…$/i })).toBeDisabled();
    expect(createSession).toHaveBeenCalledWith({ wrapper: 'claude', project: 'ccrc-pwa', workdir: proj().workdir });
  });

  // Review fix round 1, Important 1: the THIRD projection state
  // (`projected === undefined`, "no answer yet") had no test anywhere in the
  // suite — every other case stubs `api.accounts` with `mockResolvedValue`
  // and then `findBy*`-waits past this window, so nothing ever observed the
  // sheet while it was still pending. On a real phone the accounts poll
  // takes ~200ms; a tap inside that window must not be a dead tap.
  it('renders a disabled "checking placement…" control while the projection has not answered yet — no dead tap (Important 1)', async () => {
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {})); // never resolves — the pending window
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    const go = await screen.findByRole('button', { name: /checking placement/i });
    expect(go).toBeDisabled();
    // Not merely disabled cosmetically — a tap in this state must not fire
    // any request at all, so a mutant that dropped the `disabled` attribute
    // but left `start()`'s own `projected == null` guard in place would
    // still be a dead-tap regression the operator has no way to see.
    fireEvent.click(go);
    expect(screen.queryByRole('button', { name: /^starting…$/i })).toBeNull();
  });

  it('navigates to the new session on success — matched by wrapper+project once a LATER fleet frame shows it (D-291)', async () => {
    history.pushState(null, '', '/runs');
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    // No match yet — the create resolved, but nothing has appeared in the
    // fleet snapshot. Navigation must wait for that, not the create alone.
    expect(location.pathname).toBe('/runs');
    expect(queueKickoff).not.toHaveBeenCalled();

    act(() => { store.setState({ sessions: [sess()] }); });

    await waitFor(() => expect(location.pathname).toBe('/s/claude-ccrc-pwa'));
    expect(queueKickoff).toHaveBeenCalledTimes(1);
  });

  it('says in one line that the run row arrives later, from the coordinator', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    const note = await screen.findByText(/the run row arrives after that/i);
    expect(note.textContent).toMatch(/coordinator/i);
  });

  it('QUEUES one kickoff, naming the program — not the prose', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });

    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
    const [id, body] = queueKickoff.mock.calls[0] as [string, { slug: string; title: string }];
    expect(id).toBe('claude-ccrc-pwa');
    expect(body).toEqual({ slug: 'build9-demo', title: 'Build 9 demo' });
    // Program-leverage wave 4: the SENTENCE is no longer this sheet's to send.
    // The server composes it from `programKickoff`, and `server/test/
    // coord-kickoff.test.ts` pins the queued body against both that constant and
    // the three literal sentences. What is pinned HERE is that the sheet hands
    // over the program and nothing else — a `text` key reaching this route would
    // hand back the narrowing that makes it safer than `/prompt`.
    expect(Object.keys(body).sort()).toEqual(['slug', 'title']);
  });

  // Review fix round 1, Minor 5, rewritten for program-leverage wave 4.
  //
  // The old test pinned a TOAST and a navigation-anyway: right for an injection,
  // where the session is real either way and the operator could finish the
  // kickoff by hand from inside it. Wrong for a queue. A failed queue leaves
  // NOTHING durable — no mail row, no delivery, nothing the lane will retry — so
  // walking the operator into a session whose coordinator will never be briefed
  // hides the one fact they need. Its old fixture is gone too: a 502
  // `{stderr:'ccd: prompt: pane busy'}` is a `sendPrompt` shape, and queueing
  // never touches a pane, so it could not arise on this path at all.
  it('a failed QUEUE holds the sheet, says nothing was sent, and does NOT navigate', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession = vi.fn().mockResolvedValue(undefined);
    const queueKickoff = vi.fn().mockRejectedValue(
      new ApiError(501, { ok: false, error: 'not-configured' }),
    );
    const store = makeStore();
    render(
      <>
        <StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
          createSession={createSession} queueKickoff={queueKickoff}
          loadProjects={async () => ({ roots: [], projects: [proj()] })} />
        <ToastHost />
      </>,
    );

    await fillAndPick();
    // PUT THE ROUTER SOMEWHERE THAT IS NOT THE TARGET, explicitly. Nothing in
    // this file resets it between tests, and the first draft of this test merely
    // captured `location.pathname` and compared against it — which was
    // `/s/claude-ccrc-pwa` by the time this test ran, so a mutant that navigated
    // on the failure arm navigated to the path already there and the assertion
    // reported green. MEASURED: that mutant survived 64/64. A fixture that
    // cannot reproduce the topology proves nothing — wave 2's lesson, wave 3's
    // lesson, and now this wave's.
    act(() => { history.pushState(null, '', '/runs'); });
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });

    expect(await screen.findByText(/could not be queued/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing was sent/i)).toBeInTheDocument();
    // The code becomes a sentence, not a slug: `API_ERROR_TEXT` owns that.
    expect(screen.getByText(/does not run coordination/i)).toBeInTheDocument();
    // …and it STAYS on screen. Not a toast: `Toast.tsx` drops every toast once
    // the 401 auth-lost signal is up, which is exactly the failure most likely
    // to eat a kickoff on an armed box.
    expect(location.pathname).toBe('/runs');
  });

  it('offers a retry that re-posts to the SAME measured session id', async () => {
    // The addressing question was settled once, by `startedSessionFor` under
    // D-291/D-292's whole apparatus. A retry that re-measured the fleet could
    // land the kickoff somewhere else entirely, so it re-uses the id verbatim —
    // and this is the pin that says so.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const queueKickoff = vi.fn()
      .mockRejectedValueOnce(new ApiError(501, { ok: false, error: 'not-configured' }))
      .mockResolvedValueOnce(undefined);
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });
    await screen.findByText(/could not be queued/i);

    // The fleet has MOVED under the sheet — a different session is now the live
    // main checkout for this project. A retry that re-measured would find it.
    act(() => { store.setState({ sessions: [sess({ id: 'claude2-ccrc-pwa', wrapper: 'claude2' })] }); });
    fireEvent.click(screen.getByRole('button', { name: /queue the kickoff again/i }));

    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(2));
    expect(queueKickoff.mock.calls[1]).toEqual([
      'claude-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' },
    ]);
    await waitFor(() => expect(location.pathname).toBe('/s/claude-ccrc-pwa'));
  });

  it('the failure survives a dropped toast — it is sheet state, not a notification', async () => {
    // `Toast.tsx:40` returns before minting an item once `isAuthLost()` is up,
    // and `api.ts` raises that signal on any 401 BEFORE it throws. So on an
    // armed box the old toast-only shape said nothing at all about a kickoff
    // that never landed. Nothing covered that before this wave.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const queueKickoff = vi.fn().mockRejectedValue(new ApiError(401, { ok: false, error: 'unauthenticated' }));
    const store = makeStore();
    render(
      <>
        <StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
          createSession={async () => {}} queueKickoff={queueKickoff}
          loadProjects={async () => ({ roots: [], projects: [proj()] })} />
        <ToastHost />
      </>,
    );

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });

    expect(await screen.findByText(/could not be queued/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /queue the kickoff again/i })).toBeInTheDocument();
  });

  // WAVE-4 REVIEW, MINOR 3 (D-1120). RENDERED TEXT, not slug survival — the
  // review asked for exactly that, and it is the difference between pinning
  // that a map exists and pinning that the operator can read the screen.
  it('a 404 says what the registry actually answered — and stops claiming the session is running', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const queueKickoff = vi.fn().mockRejectedValue(
      new ApiError(404, { ok: false, error: 'unknown-session' }),
    );
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });

    const block = await screen.findByText(/could not be queued/i);
    expect(block.textContent).toMatch(/no longer in the registry/i);
    // The code never reaches the operator as itself…
    expect(block.textContent).not.toMatch(/unknown-session/);
    // …and the sentence stops asserting the ONE fact the registry just denied.
    // A 404 means the row is gone; "<id> is running" was a claim the sheet had
    // no measurement for, printed directly above a retry that cannot succeed.
    expect(block.textContent).not.toMatch(/is running/i);
  });

  // WAVE-4 REVIEW, MINOR 4 (D-1121). The same class this file already fixed
  // once, for `timedOut` (review M3): a sentence about ONE attempt's target,
  // left rendered above a Start button aimed somewhere else. `kickoffFailed` is
  // worse than `timedOut` was, because it carries an ACT — the door navigates
  // to the previous attempt's session, stranding the create the operator just
  // started, and it is `program-start-error` red directly above the control
  // they are looking at.
  it('a NEW attempt retires the previous attempt’s failure door', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession = vi.fn().mockResolvedValue(undefined);
    const queueKickoff = vi.fn().mockRejectedValue(
      new ApiError(501, { ok: false, error: 'not-configured' }),
    );
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={createSession} queueKickoff={queueKickoff}
      loadProjects={async () => ({
        roots: [],
        projects: [proj(), proj({ name: 'other-repo', workdir: '/home/u/projects/other-repo' })],
      })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });
    await screen.findByText(/could not be queued/i);

    // The operator moves on: a different program in a DIFFERENT project — the
    // one shape that reaches a live Start button while A's door is up, since
    // re-picking A's own project renders the D-292 refusal instead of the
    // confirm fragment.
    await fillAndPick('other-program', 'A different program', /other-repo/i);
    fireEvent.click(await screen.findByRole('button', { name: /^start other-program/i }));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

    expect(screen.queryByText(/could not be queued/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /queue the kickoff again/i })).toBeNull();
    // The retry is retired, not merely hidden: the door is the only control
    // that could re-post for A, and B owns the sheet now.
    expect(screen.queryByRole('button', { name: /open it without a brief/i })).toBeNull();
  });

  it('never calls POST /api/runs', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const store = makeStore();
    // Deliberately no createSession/prompt injection — the REAL api.* default
    // props, so this exercises the production composition, not a fake.
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    act(() => { store.setState({ sessions: [sess()] }); });
    await waitFor(() => expect(location.pathname).toBe('/s/claude-ccrc-pwa'));

    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/runs'))).toBe(false);
    // Review fix round 1, Minor 4: the length check is what actually backs
    // "these two, and no third" — two bare `toContain`s pass just as well
    // with a third, unrelated call mixed in.
    expect(urls).toHaveLength(2);
    expect(urls).toContain('/api/sessions');
    expect(urls).toContain('/api/sessions/claude-ccrc-pwa/kickoff');
    // …and NOT the injection route it replaced. `toContain` alone would stay
    // green if the sheet called both.
    expect(urls).not.toContain('/api/sessions/claude-ccrc-pwa/prompt');
  });

  it('never claims the ledger exists — it names the path the operator committed', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.change(screen.getByLabelText(/program slug/i), { target: { value: 'build9-demo' } });
    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    const ledgerLine = await screen.findByText(/docs\/superpowers\/programs\/build9-demo\.md/);
    expect(ledgerLine.textContent).not.toMatch(/exists|confirmed|found|verified/i);
  });

  it('warns, and does NOT block, when coord.pause is set', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    act(() => { store.setState({ coord: { pause: 'set', mail: 'clear' }, coordFrameSeen: true }); });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    expect(await screen.findByText(/fleet is paused/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^start build9-demo/i })).not.toBeDisabled();
  });

  // — Whole-branch review, I1: the warning reads `coord.pause` through
  // `markerState`, the TOTAL door Task 11 minted for exactly this, not a raw
  // `=== 'set'`. `coord` is shape-validated at FRAME level only
  // (`stores/fleet.ts`), so `coord.pause` reaches this renderer as a raw
  // string; `markerState` degrades anything it does not recognise to
  // `unmeasurable`, never `clear`, mirroring `dispatchRun`'s own fail-shut.
  // Reading it with `===` narrowed a distinction this component RECEIVED —
  // and it silenced the one state where the coordinator is GUARANTEED to be
  // refused at its first dispatch, while `CoordBanner` one element above was
  // correctly saying so. —
  it('warns for an UNMEASURABLE registry too — the one state dispatch is guaranteed to refuse (I1)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    act(() => { store.setState({ coord: { pause: 'unmeasurable', mail: 'clear' }, coordFrameSeen: true }); });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    const warn = await screen.findByText(/registry could not be read/i);
    // It must not claim the fleet IS paused — that is a different measurement,
    // and this one is precisely "we could not measure it".
    expect(warn.textContent).not.toMatch(/is paused/i);
    // Warns, never blocks — same posture as the `set` case above.
    expect(screen.getByRole('button', { name: /^start build9-demo/i })).not.toBeDisabled();
  });

  it('warns for a MarkerState this build has never heard of — markerState degrades unknown to unmeasurable, never clear (I1)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    const fromNewerBuild = { pause: 'quarantined', mail: 'clear' } as unknown as CoordStatus;
    act(() => { store.setState({ coord: fromNewerBuild, coordFrameSeen: true }); });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    expect(await screen.findByText(/registry could not be read/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^start build9-demo/i })).not.toBeDisabled();
  });

  it('says NOTHING about the pause when no coord frame has arrived — absence is not a warning (I1)', async () => {
    // The FOURTH, client-side state `CoordBanner`'s own header names: no
    // `coord` frame has arrived this store instance's lifetime. `markerState
    // (undefined)` is `'unmeasurable'`, so a naive `markerState(coord?.pause)
    // !== 'clear'` wrap would warn here — about a fleet nothing has reported
    // anything about yet.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    await screen.findByRole('button', { name: /^start build9-demo/i });
    expect(screen.queryByText(/registry could not be read/i)).toBeNull();
    expect(screen.queryByText(/fleet is paused/i)).toBeNull();
    expect(document.querySelector('.program-start-warn')).toBeNull();
  });

  it('renders unknown project as 400 copy and a spawn failure as its stderr', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession400 = vi.fn().mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-request' }));
    const { rerender } = render(
      <StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
        createSession={createSession400}
        loadProjects={async () => ({ roots: [], projects: [proj()] })} />,
    );

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    expect(await screen.findByText(/isn't known to the fleet/i)).toBeInTheDocument();

    const createSession502 = vi.fn().mockRejectedValue(
      new ApiError(502, { ok: false, stderr: 'ccd: start: workdir missing' }),
    );
    rerender(
      <StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
        createSession={createSession502}
        loadProjects={async () => ({ roots: [], projects: [proj()] })} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    expect(await screen.findByText('ccd: start: workdir missing')).toBeInTheDocument();
  });

  // — D-291: the bounded wait times out honestly —
  it('renders honest "not shown yet" copy after the bounded wait — never framed as failure, never navigates (D-291)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession = vi.fn().mockResolvedValue(undefined);
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      createSession={createSession} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    const go = await screen.findByRole('button', { name: /^start build9-demo/i });
    const before = location.pathname;

    vi.useFakeTimers();
    try {
      fireEvent.click(go);
      // Let createSession() resolve and the wait timer arm.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      // Past the bounded wait — nothing has matched.
      await act(async () => { await vi.advanceTimersByTimeAsync(START_PROGRAM_WAIT_MS + 1_000); });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByText(/board just hasn't shown it yet/i)).toBeInTheDocument();
    expect(queueKickoff).not.toHaveBeenCalled();
    expect(location.pathname).toBe(before);
    // Not stuck disabled either — the operator can watch the fleet screen and
    // still retry from here if it truly never landed.
    expect(screen.getByRole('button', { name: /^start build9-demo/i })).not.toBeDisabled();
  });

  // Review fix round 1, Important 2: D-291's timeout and D-292's
  // collision refusal INTERACT, which neither ruling could see alone. A
  // session that lands after the timeout is the create THIS sheet just
  // asked for — not someone else's mid-task work — and the kickoff must
  // still be sent, not silently abandoned.
  it('a session that lands AFTER the D-291 timeout is never shown as someone else\'s "mid-task" collision — and still gets its kickoff (Important 2)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession = vi.fn().mockResolvedValue(undefined);
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={createSession} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    const go = await screen.findByRole('button', { name: /^start build9-demo/i });

    vi.useFakeTimers();
    try {
      fireEvent.click(go);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      // Past the bounded wait, exactly like the D-291 test above.
      await act(async () => { await vi.advanceTimersByTimeAsync(START_PROGRAM_WAIT_MS + 1_000); });
      expect(screen.getByText(/board just hasn't shown it yet/i)).toBeInTheDocument();

      // …and only THEN does the cold spawn finish: a later `/ws/fleet` frame
      // reports the session this sheet itself started.
      act(() => { store.setState({ sessions: [sess()] }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    } finally {
      vi.useRealTimers();
    }

    // Never told this is someone else's session — the exact false claim
    // the pre-fix shape rendered here.
    expect(screen.queryByText(/already running/i)).toBeNull();
    expect(screen.queryByText(/two coordinators/i)).toBeNull();  // the D-292 refusal, by the half of it that survives every rewording

    // And the mission still completes, as if the timeout had never fired —
    // the kickoff is sent, once, and the sheet navigates.
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
    expect(queueKickoff).toHaveBeenCalledWith('claude-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' });
    await waitFor(() => expect(location.pathname).toBe('/s/claude-ccrc-pwa'));
  });

  // — D-292: refuses before the tap when the target already exists —
  // Retitled (re-review): this said "for that wrapper+project", which the
  // refusal arm has not matched on since the C1-swap correction — it passes
  // only because the fixture happens to use the projected wrapper. What it
  // actually pins is the arm's SHAPE: a live main checkout in the chosen
  // project withholds the confirm button entirely, rather than disabling one.
  it('refuses before the tap when a live main checkout already exists in that project — no confirm button at all (D-292)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    act(() => { store.setState({ sessions: [sess({ id: 'claude-ccrc-pwa', wrapper: 'claude', project: 'ccrc-pwa' })] }); });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    expect(await screen.findByText(/claude-ccrc-pwa is already running/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  it('re-evaluates the collision when the chosen project changes (D-292)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    act(() => { store.setState({ sessions: [sess({ id: 'claude-alpha', wrapper: 'claude', project: 'alpha' })] }); });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      loadProjects={async () => ({
        roots: [],
        projects: [proj({ name: 'alpha', workdir: '/w/alpha' }), proj({ name: 'beta', workdir: '/w/beta' })],
      })} />);

    fireEvent.click(await screen.findByRole('button', { name: /alpha/i }));
    expect(await screen.findByText(/already running/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: /beta/i }));
    expect(await screen.findByRole('button', { name: /^start/i })).toBeInTheDocument();
    expect(screen.queryByText(/already running/i)).toBeNull();
  });

  // — Program-leverage wave 5, D-1130. The run board is a fact this sheet never
  // had. `POST /api/runs` will happily open a SECOND program in a project that
  // already has one: it validates `project` as a non-empty string and nothing
  // else (`server/src/coord/routes.ts:889-897`), and `openRun`'s own refusal is
  // per-PROGRAM (its one-coordinator guard, `store.ts`), so it never fires for
  // a different slug. The sheet is the last place the operator can still be
  // told. —
  it('refuses when the board already shows a run in that project — no confirm button at all (D-1130)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      openRunProjects={new Set(['ccrc-pwa'])}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    expect(await screen.findByText(/already has a run open/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  // THE ARM THIS EXISTS FOR. `null` is NOT MEASURED, and the failure it prevents
  // is fold-to-permit — `(openRunProjects ?? new Set()).has(name)` answers
  // `false` here, indistinguishable from a measured empty board, and offers
  // Start on a question nobody answered.
  it('refuses when the board has NOT answered — null is not "no open run" (D-1130)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      openRunProjects={null}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
    expect(await screen.findByText(/has not answered yet/i)).toBeInTheDocument();
    // …and it must not claim a run EXISTS. The sheet holds exactly one fact
    // here — that the board is silent — and the copy states that one.
    expect(screen.queryByText(/already has a run open/i)).toBeNull();
  });

  it('yields to the D-292 sentence when BOTH are true — that one names a session the operator can open (D-1130)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    act(() => { store.setState({ sessions: [sess({ id: 'claude-ccrc-pwa', project: 'ccrc-pwa' })] }); });
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      openRunProjects={new Set(['ccrc-pwa'])}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    expect(await screen.findByText(/claude-ccrc-pwa is already running/i)).toBeInTheDocument();
    expect(screen.queryByText(/already has a run open/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  // THE INDEPENDENCE PIN. `existing` is evaluated only when `projected != null`
  // (its own declaration in `StartProgramSheet.tsx`), so a run refusal written
  // into THAT expression is invisible on a fleet where nothing is placeable: the
  // operator reads "Nothing is placeable", enables an account, and walks
  // straight into the collision. The run arm is computed from `project` alone
  // and sits ABOVE the D-284 arm for exactly that reason.
  it('refuses the open run even when NOTHING is placeable — the run arm never depends on the projection (D-1130)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster: [] });
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      openRunProjects={new Set(['ccrc-pwa'])}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    expect(await screen.findByText(/already has a run open/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing is placeable/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  it('does NOT refuse for a run naming a project the picker never lists — the join is exact (D-1130)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      openRunProjects={new Set(['ccrc-pwa-brisk-harbor', 'CCRC-PWA'])}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    expect(await screen.findByRole('button', { name: /^start build9-demo on/i })).not.toBeDisabled();
    expect(screen.queryByText(/already has a run open/i)).toBeNull();
  });

  it('re-evaluates the run refusal when the chosen project changes (D-1130)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      openRunProjects={new Set(['alpha'])}
      loadProjects={async () => ({
        roots: [],
        projects: [proj({ name: 'alpha', workdir: '/w/alpha' }), proj({ name: 'beta', workdir: '/w/beta' })],
      })} />);

    fireEvent.click(await screen.findByRole('button', { name: /alpha/i }));
    expect(await screen.findByText(/already has a run open/i)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /beta/i }));
    expect(await screen.findByRole('button', { name: /^start/i })).toBeInTheDocument();
    expect(screen.queryByText(/already has a run open/i)).toBeNull();
  });

  // — Whole-branch review, C1: `wrapper`+`project` alone is not the target
  // `cmd_start` would collide with. `cmd_ws_add` writes `project` AND a
  // `_ws_least_loaded` wrapper onto every WORKSPACE row (`ccd/ccd:1164+`),
  // and `useProjectedHome`'s wrapper is the server's own mirror of that same
  // `_ws_least_loaded` (`server/src/limits.ts:96`) — so the projected wrapper
  // is exactly the wrapper workspaces cluster on, and on a box running ~11
  // sessions the D-292 refusal fired for the fleet's NORMAL state, with no
  // path forward from the phone. It was also false on the facts: the id
  // `_id()` would compute for the projection is the MAIN checkout's, a
  // different, not-alive id `cmd_start` would have spawned correctly.
  //
  // `FleetSession.workspace` is server-reported and documented as "null for a
  // project's main checkout" (`shared/api.ts:35-37`), so it separates the two
  // with NO id arithmetic — D-291's "never recompute the id" still holds. —
  it('does NOT refuse for a WORKSPACE session on the projected wrapper — only a main checkout is what cmd_start would collide with (C1)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    // The live registry's own shape, measured: workspace `ccrc-pwa-brisk-
    // harbor` carries `project=ccrc-pwa`, the projected wrapper, and a
    // non-null `workspace`.
    act(() => {
      store.setState({ sessions: [sess({
        id: 'ccrc-pwa-brisk-harbor', wrapper: 'claude', project: 'ccrc-pwa', workspace: 'brisk-harbor',
      })] });
    });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    expect(await screen.findByRole('button', { name: /^start build9-demo on/i })).toBeInTheDocument();
    expect(screen.queryByText(/already running/i)).toBeNull();
    expect(screen.queryByText(/two coordinators/i)).toBeNull();  // the D-292 refusal, by the half of it that survives every rewording
  });

  it("does NOT refuse for a DEAD session — cmd_start's own idempotency test is `_alive`, and ws-reap is human-only (C1)", async () => {
    // `cmd_start` re-attaches only when `_alive` (tmux has-session) says so;
    // the wire's mirror of that is `status !== 'dead'`. A dead-but-unreaped
    // row would otherwise refuse this sheet forever — and `ws-reap` is
    // human-only-at-a-terminal by contract, so there is no way out from here.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    act(() => { store.setState({ sessions: [sess({ status: 'dead' })] }); });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    expect(await screen.findByRole('button', { name: /^start build9-demo on/i })).toBeInTheDocument();
    expect(screen.queryByText(/already running/i)).toBeNull();
  });

  // REPLACES the old "D-291's own match carries NO liveness conjunct" test
  // (coordinator review B-2). That test pinned a rule that was WRONG, and its
  // stated reason — "excluding a dead row would time out a wait on a session
  // that really did start" — conflated "not resolving on this tick" with
  // "timing out". The wait re-runs on every later frame and is bounded at 20 s,
  // so a dead row simply resolves later, when it is alive. Deleting the test
  // would have lost the wrapper coverage it also carried, so it is REPLACED:
  // same shape, pinning the corrected rule, and still red if the wait's
  // `wrapper` conjunct is dropped (the live `claude3-` row would be taken).
  it('waits for its own row to be LIVE — a dead row does not resolve the wait, and does not end it either (B-2)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    // Frame 1: this sheet's own row, still DEAD (registry written, tmux not
    // up) — alongside a LIVE main checkout on another wrapper, which the
    // wrapper conjunct must exclude even though it is the only live match.
    act(() => {
      store.setState({ sessions: [
        sess({ id: 'claude-ccrc-pwa', wrapper: 'claude', status: 'dead' }),
        sess({ id: 'claude3-ccrc-pwa', wrapper: 'claude3', status: 'idle' }),
      ] });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(queueKickoff).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');

    // Frame 2: the same row, now alive. NOT resolving on frame 1 did not end
    // the wait — this is the half the old rule's reasoning got wrong.
    act(() => {
      store.setState({ sessions: [
        sess({ id: 'claude-ccrc-pwa', wrapper: 'claude', status: 'idle' }),
        sess({ id: 'claude3-ccrc-pwa', wrapper: 'claude3', status: 'idle' }),
      ] });
    });

    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
    expect(queueKickoff).toHaveBeenCalledWith('claude-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' });
    await waitFor(() => expect(location.pathname).toBe('/s/claude-ccrc-pwa'));
  });

  it('never resolves the wait onto a STALE main checkout that pre-dated the create (B-2)', async () => {
    // The B-2 chain end to end: `claude-ccrc-pwa` was swapped to `claude2`
    // (`ccd/ccd:7307` moves the wrapper, keeps the id) and has since died, so
    // the refusal skips it and Start is offered. The projection is `claude2`,
    // so `cmd_start` spawns a NEW `claude2-ccrc-pwa` — and the next frame
    // carries both in registry-id sort order, where `'claude-'` sorts BEFORE
    // `'claude2'` (`-` 0x2D < `2` 0x32). Liveness alone stops this one; the
    // ordering is what made it reachable rather than theoretical.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude2'));
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    const stale = sess({ id: 'claude-ccrc-pwa', wrapper: 'claude2', status: 'dead' });
    act(() => { store.setState({ sessions: [stale] }); });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    // The dead row does not refuse — that is what makes the wait reachable.
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    act(() => {
      store.setState({ sessions: [
        stale,                                                        // sorts first
        sess({ id: 'claude2-ccrc-pwa', wrapper: 'claude2', status: 'idle' }),
      ] });
    });

    // The kickoff goes to the session that was actually started, never the
    // dead swapped row that merely satisfies the same three fields.
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
    expect(queueKickoff).toHaveBeenCalledWith('claude2-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' });
    await waitFor(() => expect(location.pathname).toBe('/s/claude2-ccrc-pwa'));
  });

  it('DOES resolve onto a dead row that its own create REVIVED — freshness is not "an id I had not seen" (B-2)', async () => {
    // The subtle half of the discriminator, and the one a naive
    // "id absent from the snapshot" rule would break. A dead main checkout is
    // skipped by the refusal, so Start is offered; `ccd start` then respawns
    // THAT EXACT ID (`_id(wrapper, project)` is unchanged). The row was in the
    // pre-create snapshot — but DEAD, so it is not in `preLive`, and coming
    // alive is precisely "became live as a result of my create".
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    act(() => { store.setState({ sessions: [sess({ id: 'claude-ccrc-pwa', status: 'dead' })] }); });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    act(() => { store.setState({ sessions: [sess({ id: 'claude-ccrc-pwa', status: 'idle' })] }); });

    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
    expect(queueKickoff).toHaveBeenCalledWith('claude-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' });
    await waitFor(() => expect(location.pathname).toBe('/s/claude-ccrc-pwa'));
  });

  // — Coordinator review B-1 (BLOCKING). The refusal fired for the sheet's
  // OWN just-started session on the ORDINARY path, because `myAttemptRef` was
  // armed only AFTER `await createSession(...)`. The window is seconds, not
  // milliseconds: `cmd_start` writes `$REG/<id>.uuid` and the other fields
  // then `_spawn`s (`ccd/ccd:7203-7208`), the server lists a session on its
  // `.uuid` file ALONE (`registry.ts:375`) and reports `idle` as soon as tmux
  // has the id (`fleet.ts:186-190`), and the watcher ticks every 2 s
  // (`watch.ts:424`) while the HTTP call is still blocked in
  // `_accept_first_run_prompts`. Every OTHER test in this file uses
  // `mockResolvedValue` and pushes its frame after the create has already
  // resolved, which is exactly why this went unpinned. —
  it('never refuses its own attempt while the create is STILL IN FLIGHT — the spawn window is seconds (B-1)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    let resolveCreate: (() => void) | null = null;
    const createSession = vi.fn(() => new Promise<void>((r) => { resolveCreate = r; }));
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={createSession} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    // The watcher sees the new session long before `POST /api/sessions`
    // answers — `createSession` is deliberately still pending here.
    act(() => { store.setState({ sessions: [sess()] }); });

    // The refusal must NOT render…
    expect(screen.queryByText(/already running/i)).toBeNull();
    expect(screen.queryByText(/two coordinators/i)).toBeNull();  // the D-292 refusal, by the half of it that survives every rewording
    // …and the in-flight indicator must still be there. This is the half that
    // makes it a real pin: the refusal replaces the WHOLE confirm fragment,
    // so "Starting…" vanishing is what the operator actually sees.
    expect(screen.getByRole('button', { name: /^starting…$/i })).toBeInTheDocument();
    expect(createSession).toHaveBeenCalledTimes(1);

    // And the attempt still completes once the create finally answers.
    resolveCreate!();
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
    expect(queueKickoff).toHaveBeenCalledWith('claude-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' });
  });

  it('re-arms nothing when the create FAILS — a genuine refusal is not suppressed by a dead attempt (B-1)', async () => {
    // The other side of arming before the await: the ref must not stay armed
    // on a create that never happened, or it would suppress the D-292
    // refusal for a session this sheet did not start.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const createSession = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'ccd: start: boom' }));
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={createSession}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    expect(await screen.findByText('ccd: start: boom')).toBeInTheDocument();

    // Someone else's session turns up in the same project afterwards.
    act(() => { store.setState({ sessions: [sess({ id: 'claude3-ccrc-pwa', wrapper: 'claude3' })] }); });

    expect(await screen.findByText(/claude3-ccrc-pwa is already running/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  // — Re-review of the C1 fix: `cmd_swap` breaks the wrapper↔id link, so the
  // REFUSAL arm cannot be wrapper-scoped. `_reg_set "$id" wrapper "$target"`
  // (`ccd/ccd:7307`) moves the field and keeps the id; `cmd_start` collides on
  // `_alive "$(_id "$wrapper" "$project")"` (`ccd/ccd:7202-7203`), i.e. on the
  // id. Measured on the live fleet: 5 of 10 main checkouts report a `wrapper`
  // that differs from their own id prefix (`claude-rp-llm` → `wrapper=
  // claude2`). —
  it('refuses for a SWAPPED main checkout the projection no longer names — cmd_swap moves the wrapper and keeps the id (C1-swap)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const store = makeStore();
    // The live `claude-rp-llm` shape: id says `claude`, the registry now says
    // `claude2`. `ccd start claude ccrc-pwa` still resolves `_id` to this very
    // session and finds it alive.
    act(() => {
      store.setState({ sessions: [sess({
        id: 'claude-ccrc-pwa', wrapper: 'claude2', project: 'ccrc-pwa', workspace: null, status: 'idle',
      })] });
    });
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    // Refused before the tap, naming the SESSION (not the account — the
    // matched row's wrapper is not the projected one, and the copy must not
    // claim otherwise).
    const refusal = await screen.findByText(/claude-ccrc-pwa is already running/i);
    expect(refusal.textContent).not.toMatch(/claude2/);
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  it('never sends the kickoff to a foreign main checkout that appears mid-wait — the WAIT stays wrapper-scoped (C1-swap)', async () => {
    // The other half of the asymmetry, and the reason the refusal may widen
    // safely: the arm that ACTS must still only ever resolve onto the session
    // THIS sheet asked for. Here nothing is live at tap time, and a different
    // live main checkout in the same project (another wrapper — someone
    // else's, or a swapped one) shows up while the sheet waits.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    act(() => {
      store.setState({ sessions: [sess({
        id: 'claude3-ccrc-pwa', wrapper: 'claude3', project: 'ccrc-pwa', workspace: null,
      })] });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(queueKickoff).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');

    // …and the sheet is still waiting for its own, which then lands.
    act(() => { store.setState({ sessions: [sess()] }); });
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
    expect(queueKickoff).toHaveBeenCalledWith('claude-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' });
  });

  // The sibling of the test above, varying `workspace` where that one varies
  // `wrapper` — and a pin the two-named-function refactor OWED. While the two
  // arms shared one `existingSessionFor` expression, one test over the
  // refusal covered both; splitting them into `startedSessionFor`/
  // `liveMainCheckoutIn` widened the mutation surface, and `s.workspace ===
  // null` on the WAIT arm was left reachable only through the shared
  // `isMainCheckoutOf` definition. Measured: deleting it from
  // `startedSessionFor` alone left the suite fully green at 31/31 — a
  // WORKSPACE row collecting the coordinator kickoff, which is C1's own
  // consequence (2), with nothing red to say so.
  it('never sends the kickoff to a WORKSPACE row on the projected wrapper — the WAIT wants a main checkout (C1-workspace)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    // Everything the wait matches on EXCEPT the main-checkout conjunct: the
    // projected wrapper, the chosen project — a live worker, mid-task.
    act(() => {
      store.setState({ sessions: [sess({
        id: 'ccrc-pwa-brisk-harbor', wrapper: 'claude', project: 'ccrc-pwa', workspace: 'brisk-harbor',
      })] });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(queueKickoff).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');

    // …and the sheet is still waiting for its own main checkout, which lands.
    act(() => { store.setState({ sessions: [sess()] }); });
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
    expect(queueKickoff).toHaveBeenCalledWith('claude-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' });
  });

  // The THIRD conjunct of the same arm, found by the same measurement that
  // produced the test above and closed in the same edit rather than left as a
  // known gap: `s.project === project` reaches the wait only through the
  // shared `isMainCheckoutOf`, and deleting it from `startedSessionFor` alone
  // also left the suite green. Same consequence, one field over — the kickoff
  // resolving onto a main checkout of a DIFFERENT project on the same
  // wrapper, which on this fleet is simply the operator's other work.
  it('never sends the kickoff to a main checkout of ANOTHER project on the same wrapper (C1-workspace)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    act(() => {
      store.setState({ sessions: [sess({
        id: 'claude-rp-llm', wrapper: 'claude', project: 'rp-llm', workspace: null,
      })] });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(queueKickoff).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');

    act(() => { store.setState({ sessions: [sess()] }); });
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
    expect(queueKickoff).toHaveBeenCalledWith('claude-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' });
  });

  it("does not refuse its OWN attempt after a swap moves its wrapper — ownership is compared on project alone (C1-swap)", async () => {
    // `myAttemptRef` must agree with the (now wrapper-independent) refusal
    // arm. A session this sheet started at `claude` can be reported at
    // `claude2` on any later frame; comparing wrappers there would render
    // "…already running… two coordinators" for the sheet's OWN session — the
    // Important-2 defect, arriving through the swap path.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    const go = await screen.findByRole('button', { name: /^start build9-demo/i });

    vi.useFakeTimers();
    try {
      fireEvent.click(go);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(START_PROGRAM_WAIT_MS + 1_000); });
      expect(screen.getByText(/board just hasn't shown it yet/i)).toBeInTheDocument();

      // It lands — swapped away from the wrapper it was started on.
      act(() => {
        store.setState({ sessions: [sess({
          id: 'claude-ccrc-pwa', wrapper: 'claude2', project: 'ccrc-pwa', workspace: null,
        })] });
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.queryByText(/already running/i)).toBeNull();
    expect(screen.queryByText(/two coordinators/i)).toBeNull();  // the D-292 refusal, by the half of it that survives every rewording
  });

  it('still refuses for a project it never started — the ownership suppression is bounded (C1-swap)', async () => {
    // The negative half of the ruling above: project-only ownership must not
    // become "suppress every refusal once any attempt has been made". After
    // starting `alpha`, switching to `beta` — where someone else's live main
    // checkout sits — must refuse exactly as if no attempt had happened.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const store = makeStore();
    act(() => {
      store.setState({ sessions: [sess({
        id: 'claude3-beta', wrapper: 'claude3', project: 'beta', workspace: null,
      })] });
    });
    const createSession = vi.fn().mockResolvedValue(undefined);
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={createSession}
      loadProjects={async () => ({
        roots: [],
        projects: [proj({ name: 'alpha', workdir: '/w/alpha' }), proj({ name: 'beta', workdir: '/w/beta' })],
      })} />);

    await fillAndPick('build9-demo', 'Build 9 demo', /alpha/i);
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    // The create must have SUCCEEDED before the switch — that is what arms
    // `myAttemptRef` and makes this a real test of the bound.
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    fireEvent.click(screen.getByRole('button', { name: /beta/i }));

    expect(await screen.findByText(/claude3-beta is already running/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  // Coordinator review B-3: when `isOwnAttempt` suppresses the refusal, the
  // ordinary branch renders and its confirm button was ENABLED — while
  // `start()` returns immediately on `existing !== null`. A permanently inert
  // control with no feedback, the same dead-tap class review round 1 fixed
  // for the placement-pending case. Reachable whenever `prompt()` is slow
  // after a D-291 timeout has already put `starting` back to false.
  it('never leaves an ENABLED Start while its own started session is being opened — no dead tap (B-3)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    // Wave 5: the type argument follows the prop (D-1137). The promise still
    // never settles, so nothing about what this measures moved.
    const queueKickoff = vi.fn(() => new Promise<{ queued: boolean }>(() => {})); // hangs — finish() is mid-flight
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    const go = await screen.findByRole('button', { name: /^start build9-demo/i });

    vi.useFakeTimers();
    try {
      fireEvent.click(go);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      // Past the bounded wait: `starting` is false again, `timedOut` is true.
      await act(async () => { await vi.advanceTimersByTimeAsync(START_PROGRAM_WAIT_MS + 1_000); });
      // …and only now does the session appear, so `finish()` fires and hangs
      // in `prompt()`. `existing` is non-null and `isOwnAttempt` suppresses.
      act(() => { store.setState({ sessions: [sess()] }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    } finally {
      vi.useRealTimers();
    }

    // Queried by class, not by label — this pins that the control is not
    // tappable, not the words it happens to use.
    const control = document.querySelector('.program-start-go');
    expect(control).not.toBeNull();
    expect(control).toBeDisabled();
    // Suppression is working (this is the state B-3 is about), and the tap
    // that would have done nothing cannot be made.
    expect(screen.queryByText(/already running/i)).toBeNull();
    fireEvent.click(control as Element);
    expect(queueKickoff).toHaveBeenCalledTimes(1); // no second attempt fired
  });

  // Whole-branch review, M3: `timedOut` described ONE attempt's target, but
  // only `start()` and close ever reset it — so picking a different project
  // left "Started — the board just hasn't shown it yet" sitting above a Start
  // button aimed somewhere else entirely.
  it('forgets a timeout when the target changes — "not shown yet" never sits above a Start aimed elsewhere (M3)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      createSession={async () => {}}
      loadProjects={async () => ({
        roots: [],
        projects: [proj(), proj({ name: 'MekWarLive', workdir: '/w/mek' })],
      })} />);

    await fillAndPick();
    const go = await screen.findByRole('button', { name: /^start build9-demo/i });

    vi.useFakeTimers();
    try {
      fireEvent.click(go);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(START_PROGRAM_WAIT_MS + 1_000); });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByText(/board just hasn't shown it yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /MekWarLive/i }));

    await waitFor(() => expect(screen.queryByText(/board just hasn't shown it yet/i)).toBeNull());
  });

  // — Lesson 5 (Task 12's own review, applied here ahead of time): the sheet
  // holds async state across the D-291 wait, and is mounted unconditionally
  // — a close mid-wait must retire the attempt, not let a later match write
  // into whatever the sheet shows next. —
  it('a superseded attempt (sheet closed mid-wait) cannot navigate when a later matching session appears', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession = vi.fn().mockResolvedValue(undefined);
    const queueKickoff = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<OpenHarness createSession={createSession} queueKickoff={queueKickoff} fleet={store} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    // `{ hidden: true }`: vaul/Radix marks everything outside the open sheet
    // `aria-hidden` while it traps focus, and this harness's own trigger sits
    // outside the portal — the node is still real and clickable, only
    // excluded from the accessible-name query by default.
    fireEvent.click(screen.getByRole('button', { name: /close sheet/i, hidden: true }));
    const before = location.pathname;

    // The session the FIRST (now-abandoned) attempt asked for shows up only
    // after the close.
    act(() => { store.setState({ sessions: [sess()] }); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(location.pathname).toBe(before);
    expect(queueKickoff).not.toHaveBeenCalled();
  });

  // A second, narrower race than the one above: here the match is found and
  // `prompt()` is already IN FLIGHT before the close — so it is the `.then()`
  // generation check inside `finish()` (not the `waitRef` clear on close)
  // that has to stop the late response from navigating. Task 12 shipped
  // exactly this shape of defect once already (a superseded response closing
  // the wrong sheet).
  it('a superseded prompt response (in flight when the sheet closes) cannot navigate', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession = vi.fn().mockResolvedValue(undefined);
    // Wave 5: the type argument follows the prop (D-1137). The sheet reads no
    // field off this answer — it is the SETTLING, after the close, that this
    // test is about — so the value below is arbitrary and the assertion at the
    // end is unchanged.
    let resolveKickoff: ((v: { queued: boolean }) => void) | null = null;
    const queueKickoff = vi.fn(() => new Promise<{ queued: boolean }>((resolve) => { resolveKickoff = resolve; }));
    const store = makeStore();
    render(<OpenHarness createSession={createSession} queueKickoff={queueKickoff} fleet={store} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    // The match arrives while the sheet is still open — this is what fires
    // `finish()` and starts the (deliberately hanging) `prompt()` call.
    act(() => { store.setState({ sessions: [sess()] }); });
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));

    // Close NOW — `prompt()` is still outstanding.
    fireEvent.click(screen.getByRole('button', { name: /close sheet/i, hidden: true }));
    const before = location.pathname;

    // The hanging `prompt()` finally resolves, after the close.
    resolveKickoff!({ queued: true });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(location.pathname).toBe(before);
  });

  // WAVE-4 REVIEW, MAJOR 1 (D-1046). The twin of the test above, for the door
  // this wave added. `finish()` checks `gen.current` on BOTH arms because a
  // close mid-flight must retire everything outstanding; `retryKickoff` shipped
  // checking NEITHER, and it settles later than anything else in this file —
  // the operator has already read a failure and tapped a button before its
  // round trip even starts, which is exactly when a close is likely.
  //
  // Both arms are pinned because they harm differently: a late SUCCESS
  // navigates to the old session under whatever the operator opened next, and a
  // late REJECTION re-plants the block the close just cleared, so the next
  // program's sheet opens showing the previous attempt's retry door aimed at
  // the previous attempt's session.
  it('a superseded RETRY response cannot navigate', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    let resolveRetry: (() => void) | null = null;
    const queueKickoff = vi.fn()
      .mockRejectedValueOnce(new ApiError(501, { ok: false, error: 'not-configured' }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveRetry = resolve; }));
    const store = makeStore();
    render(<OpenHarness createSession={async () => {}} queueKickoff={queueKickoff} fleet={store} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });
    await screen.findByText(/could not be queued/i);

    // Somewhere that is NOT the target, explicitly — this file's own measured
    // lesson: a router already sitting on `/s/claude-ccrc-pwa` makes a
    // navigating mutant indistinguishable from a guarded one.
    act(() => { history.pushState(null, '', '/runs'); });
    fireEvent.click(screen.getByRole('button', { name: /queue the kickoff again/i }));
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(2));

    // Close NOW — the retry is still outstanding.
    fireEvent.click(screen.getByRole('button', { name: /close sheet/i, hidden: true }));
    resolveRetry!();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(location.pathname).toBe('/runs');
  });

  // The THIRD arm of D-1046, and the one my own fix round nearly shipped
  // unpinned: `retryKickoff`'s `finally` is generation-guarded too. A retry
  // whose generation has moved on no longer owns `retrying`, and clearing it
  // from there re-enables a button whose newer call is still outstanding — one
  // tap away from a duplicate kickoff. The two arms above cannot see this: they
  // pin what a superseded call must NOT write, and this is about a write it must
  // not UNDO.
  it('a superseded retry cannot re-enable the button under a NEWER retry', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const pending: Array<() => void> = [];
    const hang = (): Promise<void> => new Promise<void>((resolve) => { pending.push(resolve); });
    const refuse = () => Promise.reject(new ApiError(501, { ok: false, error: 'not-configured' }));
    const queueKickoff = vi.fn()
      .mockImplementationOnce(refuse)   // A's kickoff fails      -> door A
      .mockImplementationOnce(hang)     // retry #1               -> outstanding
      .mockImplementationOnce(refuse)   // B's kickoff fails      -> door B
      .mockImplementationOnce(hang);    // retry #2               -> outstanding
    const store = makeStore();
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={store}
      createSession={async () => {}} queueKickoff={queueKickoff}
      loadProjects={async () => ({
        roots: [],
        projects: [proj(), proj({ name: 'other-repo', workdir: '/home/u/projects/other-repo' })],
      })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    act(() => { store.setState({ sessions: [sess()] }); });
    await screen.findByText(/could not be queued/i);
    fireEvent.click(screen.getByRole('button', { name: /queue the kickoff again/i }));
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(2));

    // A second attempt, in another project — `start()` bumps `gen`, so retry #1
    // is superseded from here on while its call is still outstanding.
    await fillAndPick('other-program', 'A different program', /other-repo/i);
    fireEvent.click(await screen.findByRole('button', { name: /^start other-program/i }));
    act(() => {
      store.setState({ sessions: [sess(), sess({ id: 'claude-other-repo', project: 'other-repo' })] });
    });
    await screen.findByText(/could not be queued/i);
    fireEvent.click(screen.getByRole('button', { name: /queue the kickoff again/i }));
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(4));

    // Retry #1 finally answers. It owns nothing any more.
    pending[0]!();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByRole('button', { name: /^queueing…$/i })).toBeDisabled();
  });

  it('a superseded RETRY rejection cannot re-plant the failure the close cleared', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    let rejectRetry: ((e: unknown) => void) | null = null;
    const queueKickoff = vi.fn()
      .mockRejectedValueOnce(new ApiError(501, { ok: false, error: 'not-configured' }))
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectRetry = reject; }));
    const store = makeStore();
    render(<OpenHarness createSession={async () => {}} queueKickoff={queueKickoff} fleet={store} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });
    await screen.findByText(/could not be queued/i);

    fireEvent.click(screen.getByRole('button', { name: /queue the kickoff again/i }));
    await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /close sheet/i, hidden: true }));

    // The close cleared `kickoffFailed`. The late rejection must not put it back.
    rejectRetry!(new ApiError(503, { ok: false, error: 'registry-unmeasurable' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // The session that was started has since gone — reaped, stopped, or simply
    // not in this frame. Without that, re-picking the same project renders the
    // D-292 refusal INSTEAD of the confirm fragment (`myAttemptRef` was cleared
    // by the close, so `isOwnAttempt` is false), and neither the door nor its
    // absence is observable at all. MEASURED: the unguarded code failed this
    // test on the missing Start button rather than on the stale door.
    act(() => { store.setState({ sessions: [] }); });

    // Reopen for a DIFFERENT program, and pick a project — the confirm
    // fragment that holds the door is gated on `project !== null`, and the
    // close reset it, so a `queryByText` against a freshly reopened sheet
    // reports absence whether the guard held or not. MEASURED: without this
    // re-pick the unguarded code passed this test.
    fireEvent.click(screen.getByRole('button', { name: /reopen sheet/i, hidden: true }));
    expect(await screen.findByLabelText(/program slug/i)).toBeInTheDocument();
    await fillAndPick('other-program', 'A different program');

    expect(screen.queryByText(/could not be queued/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /queue the kickoff again/i })).toBeNull();
    // …and the sheet really is showing the fragment that WOULD have held it.
    expect(screen.getByRole('button', { name: /^start other-program/i })).toBeInTheDocument();
  });
});

// program-leverage wave 3 (F3): the program-ready badge.
//
// It renders HERE, and only here, because this is the one surface that is
// genuinely project-keyed — the /runs board itself groups by PROGRAM slug and
// nothing constrains a program's runs to one project, so a badge on a group
// header would be a program wearing a project's answer (operator ruling,
// 2026-08-29). This is also the moment the answer is worth anything: the
// operator is choosing a project to start a program on.
describe('the program-ready badge', () => {
  const READY: ProjectReadiness = {
    worker: 'present', coordinator: 'present', floor: 'seeded',
    boxToken: 'configured', coordDb: 'available', verdict: 'ready', at: 1,
  };

  const withReadiness = (over: Partial<ProjectReadiness> = {}) =>
    ({ roots: [], projects: [{ ...proj(), readiness: { ...READY, ...over } }] });

  const openSheet = (loadProjects: () => Promise<unknown>) => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet openRunProjects={NO_OPEN_RUNS} open onClose={() => {}} fleet={makeStore()}
      loadProjects={loadProjects as never} />);
  };

  it('renders program-ready with a word AND a glyph, never colour alone', async () => {
    openSheet(async () => withReadiness());
    expect(await screen.findByText(/program-ready/)).toBeTruthy();
    const badge = document.querySelector('.proj-ready[data-verdict="ready"]');
    expect(badge).toBeTruthy();
    // The two-cue rule: the glyph is in the text, not carried by colour.
    expect(badge?.textContent).toMatch(/\S/);
  });

  it('names the missing preconditions VISIBLY when blocked, not only in a title', async () => {
    // title= is unreachable on the mobile-first surface this board is built
    // for: there is no hover on a phone. The run item asks for a badge WITH
    // the missing-precondition list, and the data is already on the wire.
    openSheet(async () => withReadiness({ worker: 'absent', verdict: 'blocked' }));
    const badge = await screen.findByText(/not ready/);
    expect(badge.getAttribute('title')).toContain('not installed');
    const why = document.querySelector('.proj-ready-why');
    expect(why, 'the blocked reason is not rendered anywhere visible').toBeTruthy();
    expect(why?.textContent).toContain('worker skill not installed');
  });

  it('names the unmeasurable precondition visibly too — an unknown is not a blank', async () => {
    openSheet(async () => withReadiness({ floor: 'unmeasurable', verdict: 'unknown' }));
    await screen.findByText(/readiness unknown/);
    expect(document.querySelector('.proj-ready-why')?.textContent)
      .toContain('could not be measured');
  });

  it('renders NO reason line when the project is ready — there is nothing to say', async () => {
    openSheet(async () => withReadiness());
    await screen.findByText(/program-ready/);
    expect(document.querySelector('.proj-ready-why')).toBeNull();
  });

  it('says unknown — NOT "not ready" — when a precondition could not be measured', async () => {
    // The whole point of the feature: absence of evidence is not evidence of
    // absence, and the operator must be able to tell the two apart.
    openSheet(async () => withReadiness({ floor: 'unmeasurable', verdict: 'unknown' }));
    expect(await screen.findByText(/readiness unknown/)).toBeTruthy();
    expect(screen.queryByText(/not ready/)).toBeNull();
    const badge = document.querySelector('.proj-ready[data-verdict="unknown"]');
    expect(badge?.getAttribute('title')).toContain('could not be measured');
  });

  it('an OLDER SERVER omitting the key renders NO badge and no broken row', async () => {
    openSheet(async () => ({ roots: [], projects: [proj()] }));
    expect(await screen.findByText('ccrc-pwa')).toBeTruthy();
    expect(document.querySelector('.proj-ready')).toBeNull();
  });

  it('readiness: null renders the pending arm — a DIFFERENT arm from the absent key', async () => {
    // `null` is "this server measures readiness and has not swept yet"; an
    // absent key is "this server does not measure it at all". A reader that
    // folds them together throws away the difference between "wait a moment"
    // and "upgrade the server".
    openSheet(async () => ({ roots: [], projects: [{ ...proj(), readiness: null }] }));
    await screen.findByText('ccrc-pwa');
    expect(document.querySelector('.proj-ready[data-verdict="pending"]')).toBeTruthy();
  });
});

// --- fix round 1, minor 5 --------------------------------------------------
// The badge's "what is missing" list and the server's verdict are two readings
// of the same five facts. They MUST agree, and before this they were two
// independent spellings of each vocabulary's ok-member with nothing checking.
describe('missingPreconditions agrees with readyVerdict, by construction', () => {
  const READY: ReadinessFacts = {
    worker: 'present', coordinator: 'present', floor: 'seeded',
    boxToken: 'configured', coordDb: 'available',
  };
  const stamp = (f: ReadinessFacts): ProjectReadiness =>
    ({ ...f, verdict: readyVerdict(f), at: 1 });

  it('lists nothing exactly when the verdict is ready', () => {
    expect(missingPreconditions(stamp(READY))).toEqual([]);
    expect(readyVerdict(READY)).toBe('ready');
  });

  // Every non-ok member of every vocabulary, one at a time: the list must name
  // it and the verdict must leave `ready`. Exhaustive over the arms rather
  // than a sample, because the failure mode minor 5 names is a NARROWED
  // comparison, which a sample can miss.
  it.each([
    ...(['absent', 'unmeasurable'] as const).flatMap((v) =>
      [['worker', v], ['coordinator', v]] as [keyof ReadinessFacts, string][]),
    ...(['not-seeded', 'unmeasurable'] as const).map((v) =>
      ['floor', v] as [keyof ReadinessFacts, string]),
    ...(['absent', 'unmeasurable'] as const).map((v) =>
      ['boxToken', v] as [keyof ReadinessFacts, string]),
    ...(['degraded', 'not-configured'] as const).map((v) =>
      ['coordDb', v] as [keyof ReadinessFacts, string]),
  ])('%s = %s is named by the list and leaves the verdict non-ready', (key, value) => {
    const facts = { ...READY, [key]: value } as ReadinessFacts;
    const listed = missingPreconditions(stamp(facts));
    expect(listed, `${key}=${value} is not named`).toHaveLength(1);
    expect(readyVerdict(facts)).not.toBe('ready');
  });

  it('an empty list and a non-ready verdict can never coexist', () => {
    // The corollary stated as its own case: this is the shape an operator
    // actually hits — a badge saying "not ready" over nothing at all.
    for (const worker of ['present', 'absent', 'unmeasurable'] as const) {
      for (const floor of ['seeded', 'not-seeded', 'unmeasurable'] as const) {
        for (const coordDb of ['available', 'degraded', 'not-configured'] as const) {
          const facts = { ...READY, worker, floor, coordDb };
          const empty = missingPreconditions(stamp(facts)).length === 0;
          expect(empty, JSON.stringify(facts)).toBe(readyVerdict(facts) === 'ready');
        }
      }
    }
  });
});
