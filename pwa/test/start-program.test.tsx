// The start-a-program sheet — the run board's own door onto a NEW program
// (Task 13, spec §4.4). TDD red-first: written before `StartProgramSheet.tsx`
// exists, run once to confirm it fails for the right reason, then again once
// the implementation lands.
//
// D-B4-18/19 (`docs/superpowers/plans/2026-08-11-build4-conversation-and-
// controls.md`'s Deviations section) are both pinned here, alongside the
// brief's own eleven cases: the sheet cannot know the new session's id from
// `createSession`'s own response (`{ok:true}`, no id — `server/src/
// server.ts:593-596`), so it matches on `FleetSession.wrapper`/`.project`
// once a `/ws/fleet` frame reports them, bounded by `START_PROGRAM_WAIT_MS`
// (D-B4-18); and `cmd_start` is idempotent, so a session already running for
// the target `wrapper`+`project` must refuse the sheet's own confirm button
// entirely, before any tap (D-B4-19).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { StartProgramSheet, kickoff, START_PROGRAM_WAIT_MS } from '../src/fleet/StartProgramSheet';
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
  bucket: 'idle', bucketSince: null, unmeasured: [], ...over,
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

describe('StartProgramSheet', () => {
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

  it('refuses with copy when the projection is null: nothing is placeable (D-B4-11)', async () => {
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

  it('navigates to the new session on success — matched by wrapper+project once a LATER fleet frame shows it (D-B4-18)', async () => {
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

  // — D-B4-18: the bounded wait times out honestly —
  it('renders honest "not shown yet" copy after the bounded wait — never framed as failure, never navigates (D-B4-18)', async () => {
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

  // Review fix round 1, Important 2: D-B4-18's timeout and D-B4-19's
  // collision refusal INTERACT, which neither ruling could see alone. A
  // session that lands after the timeout is the create THIS sheet just
  // asked for — not someone else's mid-task work — and the kickoff must
  // still be sent, not silently abandoned.
  it('a session that lands AFTER the D-B4-18 timeout is never shown as someone else\'s "mid-task" collision — and still gets its kickoff (Important 2)', async () => {
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
      // Past the bounded wait, exactly like the D-B4-18 test above.
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

  // — D-B4-19: refuses before the tap when the target already exists —
  it('refuses before the tap when a session already exists for that wrapper+project — no confirm button at all (D-B4-19)', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(projected());
    const store = makeStore();
    act(() => { store.setState({ sessions: [sess({ id: 'claude-ccrc-pwa', wrapper: 'claude', project: 'ccrc-pwa' })] }); });
    render(<StartProgramSheet open onClose={() => {}} fleet={store}
      loadProjects={async () => ({ roots: [], projects: [proj()] })} />);

    fireEvent.click(await screen.findByRole('button', { name: /ccrc-pwa/i }));

    expect(await screen.findByText(/claude-ccrc-pwa is already running/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^start/i })).toBeNull();
  });

  it('re-evaluates the collision when the chosen project changes (D-B4-19)', async () => {
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

  // — Lesson 5 (Task 12's own review, applied here ahead of time): the sheet
  // holds async state across the D-B4-18 wait, and is mounted unconditionally
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
