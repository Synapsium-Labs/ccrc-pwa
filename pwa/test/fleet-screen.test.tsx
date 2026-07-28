import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { FleetScreen } from '../src/screens/FleetScreen';
import { SessionCard } from '../src/fleet/SessionCard';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { ToastHost } from '../src/components/Toast';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// — fixtures —

const MIN = 60_000;

/** Stubs the real `fetch` (not the `api` module) so a request runs through
 *  the actual `ApiError` construction — this is the only way to exercise the
 *  `body.stderr` vs `body.error` translation that `apiErrorText` handles and
 *  a raw `err.message` does not. Mirrors the server's real 502 shape for a
 *  failed lifecycle route (`{ ok: false, stderr }`, no `error` key).
 *
 *  Unlike the sibling helper in session-card.test.tsx, this mounts the full
 *  FleetScreen tree — AccountsStrip and FleetHostBanner also call fetch on
 *  mount (api.accounts / api.fleetHealth), and a Response body can only be
 *  read once. A single shared `mockResolvedValue(response)` would let the
 *  first of those consume the body, leaving later callers (our click) with
 *  an empty, already-read stream — so this hands back a fresh Response
 *  per call instead. */
const stubFetch502 = (stderr: string): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: false, stderr }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
};

const session = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude:OpenClawHetzner',
  wrapper: 'claude',
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/home/rc/projects/OpenClawHetzner',
  workspace: null,
  name: null,
  status: 'idle',
  statusUpdatedAt: Date.now() - 2 * MIN,
  limits: { five: 10, seven: 40 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null,
  version: '2.1.0',
  ...over,
});

/** Store whose ReconnectingSocket gets an inert fake — connect() is harmless. */
const makeStore = (): FleetStore =>
  createFleetStore({
    makeSocket: () =>
      ({
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close(): void {},
      }) as unknown as WebSocket,
  });

const seed = (store: FleetStore, patch: Partial<ReturnType<FleetStore['getState']>>): void => {
  act(() => {
    store.setState(patch);
  });
};

// — FleetScreen —

describe('FleetScreen', () => {
  it('renders a card per session with account label and status word', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({
          id: 'claude:OpenClawHetzner',
          status: 'busy',
          statusUpdatedAt: Date.now() - 4 * MIN,
        }),
        session({
          id: 'claude2:mekwarlive',
          wrapper: 'claude2',
          project: 'mekwarlive',
          status: 'idle',
        }),
      ],
    });

    // Both cards, titled by project, with jargon-free account labels. The
    // account label also appears once in the accounts strip, so allow multiples.
    expect(screen.getByText('OpenClawHetzner')).toBeInTheDocument();
    expect(screen.getByText('mekwarlive')).toBeInTheDocument();
    expect(screen.getAllByText('team·max').length).toBeGreaterThan(0);
    expect(screen.getAllByText('alt·max').length).toBeGreaterThan(0);

    // Status is dot + word, never dot alone; relative activity rides along.
    expect(screen.getByRole('img', { name: 'working' })).toBeInTheDocument();
    expect(screen.getByText('working · 4m')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'idle' })).toBeInTheDocument();
    expect(screen.getByText('idle · 2m ago')).toBeInTheDocument();
  });

  it('shows the attention badge when a dialog is pending', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [session({ dialogPending: true })] });

    expect(
      screen.getByText('Claude is asking you something — tap to answer'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'waiting on you' })).toBeInTheDocument();
  });

  it("shows a persistent offline banner when conn is 'down', keeping last-known cards", () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'down', sessions: [session()] });

    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    expect(screen.getByText('OpenClawHetzner')).toBeInTheDocument();
  });

  it('renders the first-run block when the fleet is empty and connected', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [] });

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a session' })).toBeInTheDocument();
  });

  it('renders 3 skeleton cards while connecting with nothing known', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    // untouched store: conn 'connecting', no sessions
    expect(screen.getAllByRole('status', { name: 'Loading' })).toHaveLength(3);
  });

  it('renders notices as dismissible banners', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session()],
      notices: [{ id: 1, message: 'OpenClawHetzner moved to alt·max' }],
    });

    expect(screen.getByText('OpenClawHetzner moved to alt·max')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('OpenClawHetzner moved to alt·max')).not.toBeInTheDocument();
  });

  it('creates a workspace on the tapped project', async () => {
    const calls: string[] = [];
    vi.spyOn(api, 'workspaceAdd').mockImplementation(async (p: string) => {
      calls.push(p);
    });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha' }),
        session({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
    await waitFor(() => expect(calls).toEqual(['alpha']));
  });

  it('surfaces a failure as a toast rather than a silent no-op', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new Error('no origin/HEAD'));
    const store = makeStore();
    render(
      <>
        <FleetScreen store={store} />
        <ToastHost />
      </>,
    );
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha' }),
        session({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
    await waitFor(() => expect(screen.getByText(/no origin\/HEAD/)).toBeInTheDocument());
  });

  it('offers a + on a project holding a single session', () => {
    // Every one of the nine live projects holds exactly one session, so a +
    // that only exists on grouped headers exists nowhere at all.
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [session({ id: 'a', project: 'solo' })] });

    expect(screen.getByRole('button', { name: /New workspace on solo/i })).toBeInTheDocument();
  });

  it('disables a + while its own ws-add is in flight, per project', async () => {
    // ccd does NOT dedupe: ws-add draws a fresh random slug each call and only
    // checks it against the registry, so two concurrent calls both succeed —
    // two worktrees, two branches, two systemd units, two of three account
    // lanes gone. The window is _spawn plus _accept_first_run_prompts, up to
    // ~15 minutes, with no feedback whatsoever.
    let release!: () => void;
    const add = vi.spyOn(api, 'workspaceAdd').mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha' }), session({ id: 'b', project: 'beta' })],
    });

    const alpha = screen.getByRole('button', { name: /New workspace on alpha/i });
    const beta = screen.getByRole('button', { name: /New workspace on beta/i });
    fireEvent.click(alpha);
    await waitFor(() => expect(alpha).toBeDisabled());

    // A second tap on the same project is refused…
    fireEvent.click(alpha);
    expect(add).toHaveBeenCalledTimes(1);
    // …while another project's + is untouched: the guard is per project.
    expect(beta).not.toBeDisabled();

    await act(async () => { release(); });
    await waitFor(() => expect(alpha).not.toBeDisabled());
  });

  it('re-enables the + after a FAILED ws-add, so a refusal is not a dead button', async () => {
    let reject!: (e: Error) => void;
    vi.spyOn(api, 'workspaceAdd').mockImplementation(
      () => new Promise<void>((_resolve, r) => { reject = r; }),
    );
    const store = makeStore();
    render(
      <>
        <FleetScreen store={store} />
        <ToastHost />
      </>,
    );
    seed(store, { conn: 'open', sessions: [session({ id: 'a', project: 'alpha' })] });

    const plus = screen.getByRole('button', { name: /New workspace on alpha/i });
    fireEvent.click(plus);
    await waitFor(() => expect(plus).toBeDisabled());
    await act(async () => { reject(new Error('no origin/HEAD')); });
    await waitFor(() => expect(plus).not.toBeDisabled());
  });

  it("surfaces ccd's stderr from a real 502, not a generic request-failed message", async () => {
    // Goes through the REAL fetch → ApiError path (unlike the mocked-api test
    // above), which is the only way to observe the body.stderr vs body.error
    // translation that apiErrorText performs and a raw err.message does not.
    stubFetch502('no origin/HEAD — run: git -C /repo remote set-head origin -a');
    const store = makeStore();
    render(
      <>
        <FleetScreen store={store} />
        <ToastHost />
      </>,
    );
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha' }),
        session({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
    await waitFor(() =>
      expect(screen.getByText(/origin\/HEAD — run: git -C \/repo remote set-head/))
        .toBeInTheDocument());
    expect(screen.queryByText(/request failed/)).toBeNull();
  });
});

// — SessionCard —

describe('SessionCard', () => {
  it('opens the session when tapped', () => {
    const onOpen = vi.fn();
    render(<SessionCard session={session()} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'OpenClawHetzner' }));
    expect(onOpen).toHaveBeenCalledWith('claude:OpenClawHetzner');
  });

  it('renders the dead card muted with restart affordances', () => {
    const ensure = vi.spyOn(api, 'ensure').mockResolvedValue(undefined);
    const onOpen = vi.fn();
    render(
      <SessionCard
        session={session({ status: 'dead', statusUpdatedAt: Date.now() - 3 * 60 * MIN })}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText('Not running — tap to view, hold to restart')).toBeInTheDocument();
    expect(screen.getByText('exited · 3h ago')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'not running' })).toBeInTheDocument();
    // Dead cards hide the limits bars — meaningless for a stopped session.
    expect(document.querySelector('.limits')).not.toBeInTheDocument();

    // The inline restart button calls ensure without also opening the session.
    fireEvent.click(screen.getByRole('button', { name: 'Restart session' }));
    expect(ensure).toHaveBeenCalledWith('claude:OpenClawHetzner');
    expect(onOpen).not.toHaveBeenCalled();

    // Tapping the card still opens the (read-only) chat.
    fireEvent.click(screen.getByRole('button', { name: 'OpenClawHetzner' }));
    expect(onOpen).toHaveBeenCalledWith('claude:OpenClawHetzner');
  });

  it('renders account usage from /api/accounts with a reset countdown, independent of sessions', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [
        // gpt has NO active session, yet still shows — telemetry-driven.
        { wrapper: 'gpt', five: 8, seven: 8, ts: nowSec, fiveResetAt: nowSec + 2 * 3600, sevenResetAt: nowSec + 3 * 86400, fiveRolledOver: false, sevenRolledOver: false },
      ],
      // gpt is not home-able, so the projection names an Anthropic account
      // regardless of what telemetry exists — see limits.ts HOME_ABLE.
      projected: { wrapper: 'claude', score: 0 },
    });
    render(<AccountsStrip />);
    // one account gauge → two meters (5h + 7d)
    await screen.findByText('gpt');
    expect(document.querySelectorAll('.acct-fill')).toHaveLength(2);
    // reset countdown rendered ("2h" for the 5h window)
    expect(screen.getByText(/↻\s*2h/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('a session card no longer renders its own limit bars', () => {
    render(<SessionCard session={session({ limits: { five: 85, seven: 30 } })} onOpen={() => {}} />);
    expect(document.querySelectorAll('.limit-fill')).toHaveLength(0);
  });
});
