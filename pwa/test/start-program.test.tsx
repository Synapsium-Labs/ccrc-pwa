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
import type { CoordStatus, FleetSession } from '../../shared/api';
import { StartProgramSheet, kickoff, startedSessionFor, START_PROGRAM_WAIT_MS } from '../src/fleet/StartProgramSheet';
import { ApiError, api } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude-ccrc-pwa', wrapper: 'claude', home: 'claude', project: 'ccrc-pwa',
  workdir: '/w', workspace: null, name: null, title: null, status: 'idle', statusUpdatedAt: null,
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
  createSession, prompt, fleet,
}: {
  createSession: (b: { wrapper: string; project: string; workdir?: string }) => Promise<void>;
  prompt: (id: string, text: string) => Promise<void>;
  fleet: FleetStore;
}): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>close sheet</button>
      <StartProgramSheet
        open={open}
        onClose={() => setOpen(false)}
        fleet={fleet}
        createSession={createSession}
        prompt={prompt}
        loadProjects={async () => ({ roots: [], projects: [proj()] })}
      />
    </>
  );
}

describe('kickoff — the one standing template, copied from the brief verbatim', () => {
  // A LITERAL comparison, not `kickoff(...)` compared against itself — the
  // sheet's own tests below call `kickoff()` to build their expectation too,
  // which pins that the sheet USES the constant but cannot catch the
  // constant's own text drifting away from the brief (measured: a one-word
  // change inside the template still passed every other test in this file).
  // This is the one place the brief's exact code block is checked against
  // what actually ships.
  it('matches the brief\'s kickoff code block byte for byte', () => {
    expect(kickoff('build4-conversation-and-controls', 'Build 4: conversation and controls')).toBe(
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

    const { rerender } = render(<StartProgramSheet open={false} onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);
    // Give the effect (and any immediate `load()`) a chance to run.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(accounts).not.toHaveBeenCalled();

    // Opening it is what asks — otherwise this would pass against a hook that
    // never polls at all.
    rerender(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);
    await waitFor(() => expect(accounts).toHaveBeenCalled());
  });

  it('collects slug, title and project, and refuses an empty slug', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
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
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    // Named on the confirm button's own label — before any tap on it.
    expect(await screen.findByRole('button', { name: /start build9-demo on claude2/i })).toBeInTheDocument();
  });

  it('refuses with copy when the projection is null: nothing is placeable (D-284 (was D-B4-11))', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster: [] });
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    expect(await screen.findByText(/nothing is placeable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  it('renders the in-flight state on the session create — the one long call', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession = vi.fn(() => new Promise<void>(() => {})); // never resolves
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
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
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    // No match yet — the create resolved, but nothing has appeared in the
    // fleet snapshot. Navigation must wait for that, not the create alone.
    expect(location.pathname).toBe('/runs');
    expect(prompt).not.toHaveBeenCalled();

    act(() => { store.setState({ sessions: [sess()] }); });

    await waitFor(() => expect(location.pathname).toBe('/s/claude-ccrc-pwa'));
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('says in one line that the run row arrives later, from the coordinator', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    const note = await screen.findByText(/the run row arrives later/i);
    expect(note.textContent).toMatch(/coordinator/i);
  });

  it('sends ONE kickoff prompt naming the slug, the ledger path and the skill', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    const [id, text] = prompt.mock.calls[0] as [string, string];
    expect(id).toBe('claude-ccrc-pwa');
    // Exact equality against the exported constant — the text has one home.
    expect(text).toBe(kickoff('build9-demo', 'Build 9 demo'));
    expect(text).toContain('build9-demo');
    expect(text).toContain('docs/superpowers/programs/build9-demo.md');
    expect(text).toContain('ccrc-coordinator');
  });

  // Review fix round 1, Minor 5: `finish()`'s own `.catch` arm — deleting it
  // loses the toast AND silently kills navigation (the rejection short-
  // circuits `.then`, and `void` swallows it), with the rest of the suite
  // staying green because every other test's injected `prompt` resolves.
  it('a prompt failure toasts once, non-blocking — the session is real, so it still navigates', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const createSession = vi.fn().mockResolvedValue(undefined);
    const prompt = vi.fn().mockRejectedValue(
      new ApiError(502, { ok: false, stderr: 'ccd: prompt: pane busy' }),
    );
    const store = makeStore();
    render(
      <>
        <StartProgramSheet open onClose={() => {}} fleet={store}
          createSession={createSession} prompt={prompt}
          loadProjects={async () => ({ roots: [], projects: [proj()] })} />
        <ToastHost />
      </>,
    );

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });
    act(() => { store.setState({ sessions: [sess()] }); });

    expect(await screen.findByText(/kickoff prompt failed to send/i)).toBeInTheDocument();
    expect(screen.getByText(/ccd: prompt: pane busy/i)).toBeInTheDocument();
    // The session was really created — the failure is only that the nudge
    // never landed, so the sheet still takes the operator there.
    await waitFor(() => expect(location.pathname).toBe('/s/claude-ccrc-pwa'));
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
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
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
    expect(urls).toContain('/api/sessions/claude-ccrc-pwa/prompt');
  });

  it('never claims the ledger exists — it names the path the operator committed', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
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
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
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
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
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
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
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
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
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
      <StartProgramSheet open onClose={() => {}} fleet={makeStore()}
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
      <StartProgramSheet open onClose={() => {}} fleet={makeStore()}
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
      createSession={createSession} prompt={prompt}
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
    expect(prompt).not.toHaveBeenCalled();
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={createSession} prompt={prompt}
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
    expect(screen.queryByText(/may be mid-task/i)).toBeNull();

    // And the mission still completes, as if the timeout had never fired —
    // the kickoff is sent, once, and the sheet navigates.
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledWith('claude-ccrc-pwa', kickoff('build9-demo', 'Build 9 demo'));
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
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    expect(await screen.findByText(/claude-ccrc-pwa is already running/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  it('re-evaluates the collision when the chosen project changes (D-292)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    act(() => { store.setState({ sessions: [sess({ id: 'claude-alpha', wrapper: 'claude', project: 'alpha' })] }); });
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
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
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();

    expect(await screen.findByRole('button', { name: /^start build9-demo on/i })).toBeInTheDocument();
    expect(screen.queryByText(/already running/i)).toBeNull();
    expect(screen.queryByText(/may be mid-task/i)).toBeNull();
  });

  it("does NOT refuse for a DEAD session — cmd_start's own idempotency test is `_alive`, and ws-reap is human-only (C1)", async () => {
    // `cmd_start` re-attaches only when `_alive` (tmux has-session) says so;
    // the wire's mirror of that is `status !== 'dead'`. A dead-but-unreaped
    // row would otherwise refuse this sheet forever — and `ws-reap` is
    // human-only-at-a-terminal by contract, so there is no way out from here.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    act(() => { store.setState({ sessions: [sess({ status: 'dead' })] }); });
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
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

    expect(prompt).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');

    // Frame 2: the same row, now alive. NOT resolving on frame 1 did not end
    // the wait — this is the half the old rule's reasoning got wrong.
    act(() => {
      store.setState({ sessions: [
        sess({ id: 'claude-ccrc-pwa', wrapper: 'claude', status: 'idle' }),
        sess({ id: 'claude3-ccrc-pwa', wrapper: 'claude3', status: 'idle' }),
      ] });
    });

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledWith('claude-ccrc-pwa', kickoff('build9-demo', 'Build 9 demo'));
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    const stale = sess({ id: 'claude-ccrc-pwa', wrapper: 'claude2', status: 'dead' });
    act(() => { store.setState({ sessions: [stale] }); });
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
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
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledWith('claude2-ccrc-pwa', kickoff('build9-demo', 'Build 9 demo'));
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    act(() => { store.setState({ sessions: [sess({ id: 'claude-ccrc-pwa', status: 'dead' })] }); });
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    act(() => { store.setState({ sessions: [sess({ id: 'claude-ccrc-pwa', status: 'idle' })] }); });

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledWith('claude-ccrc-pwa', kickoff('build9-demo', 'Build 9 demo'));
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={createSession} prompt={prompt}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    // The watcher sees the new session long before `POST /api/sessions`
    // answers — `createSession` is deliberately still pending here.
    act(() => { store.setState({ sessions: [sess()] }); });

    // The refusal must NOT render…
    expect(screen.queryByText(/already running/i)).toBeNull();
    expect(screen.queryByText(/may be mid-task/i)).toBeNull();
    // …and the in-flight indicator must still be there. This is the half that
    // makes it a real pin: the refusal replaces the WHOLE confirm fragment,
    // so "Starting…" vanishing is what the operator actually sees.
    expect(screen.getByRole('button', { name: /^starting…$/i })).toBeInTheDocument();
    expect(createSession).toHaveBeenCalledTimes(1);

    // And the attempt still completes once the create finally answers.
    resolveCreate!();
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledWith('claude-ccrc-pwa', kickoff('build9-demo', 'Build 9 demo'));
  });

  it('re-arms nothing when the create FAILS — a genuine refusal is not suppressed by a dead attempt (B-1)', async () => {
    // The other side of arming before the await: the ref must not stay armed
    // on a create that never happened, or it would suppress the D-292
    // refusal for a session this sheet did not start.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const createSession = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'ccd: start: boom' }));
    const store = makeStore();
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
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
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
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

    expect(prompt).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');

    // …and the sheet is still waiting for its own, which then lands.
    act(() => { store.setState({ sessions: [sess()] }); });
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledWith('claude-ccrc-pwa', kickoff('build9-demo', 'Build 9 demo'));
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
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

    expect(prompt).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');

    // …and the sheet is still waiting for its own main checkout, which lands.
    act(() => { store.setState({ sessions: [sess()] }); });
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledWith('claude-ccrc-pwa', kickoff('build9-demo', 'Build 9 demo'));
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    history.pushState(null, '', '/runs');
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
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

    expect(prompt).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');

    act(() => { store.setState({ sessions: [sess()] }); });
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledWith('claude-ccrc-pwa', kickoff('build9-demo', 'Build 9 demo'));
  });

  it("does not refuse its OWN attempt after a swap moves its wrapper — ownership is compared on project alone (C1-swap)", async () => {
    // `myAttemptRef` must agree with the (now wrapper-independent) refusal
    // arm. A session this sheet started at `claude` can be reported at
    // `claude2` on any later frame; comparing wrappers there would render
    // "…already running… may be mid-task" for the sheet's OWN session — the
    // Important-2 defect, arriving through the swap path.
    vi.spyOn(api, 'accounts').mockResolvedValue(projected('claude'));
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
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
    expect(screen.queryByText(/may be mid-task/i)).toBeNull();
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
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
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
    const prompt = vi.fn(() => new Promise<void>(() => {})); // hangs — finish() is mid-flight
    const store = makeStore();
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      createSession={async () => {}} prompt={prompt}
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
    expect(prompt).toHaveBeenCalledTimes(1); // no second attempt fired
  });

  // Whole-branch review, M3: `timedOut` described ONE attempt's target, but
  // only `start()` and close ever reset it — so picking a different project
  // left "Started — the board just hasn't shown it yet" sitting above a Start
  // button aimed somewhere else entirely.
  it('forgets a timeout when the target changes — "not shown yet" never sits above a Start aimed elsewhere (M3)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    render(<StartProgramSheet open onClose={() => {}} fleet={makeStore()}
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
    const prompt = vi.fn().mockResolvedValue(undefined);
    const store = makeStore();
    render(<OpenHarness createSession={createSession} prompt={prompt} fleet={store} />);

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
    expect(prompt).not.toHaveBeenCalled();
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
    let resolvePrompt: (() => void) | null = null;
    const prompt = vi.fn(() => new Promise<void>((resolve) => { resolvePrompt = resolve; }));
    const store = makeStore();
    render(<OpenHarness createSession={createSession} prompt={prompt} fleet={store} />);

    await fillAndPick();
    fireEvent.click(await screen.findByRole('button', { name: /^start build9-demo/i }));
    await screen.findByRole('button', { name: /^starting…$/i });

    // The match arrives while the sheet is still open — this is what fires
    // `finish()` and starts the (deliberately hanging) `prompt()` call.
    act(() => { store.setState({ sessions: [sess()] }); });
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));

    // Close NOW — `prompt()` is still outstanding.
    fireEvent.click(screen.getByRole('button', { name: /close sheet/i, hidden: true }));
    const before = location.pathname;

    // The hanging `prompt()` finally resolves, after the close.
    resolvePrompt!();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(location.pathname).toBe(before);
  });
});
