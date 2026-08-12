// Task 10 — lifecycle UI: NewSessionSheet (account rows from the fleet store
// with live limits; account+project selection arms a confirm that posts the
// exact body), SwapSheet (excludes the current wrapper, suggests the least
// loaded, posts the target through a QuickConfirm), the stop flow (QuickConfirm
// fires api.stop only on confirm), and the header overflow menu ("Change
// model" sends the /model command; the resulting picker rides the normal
// dialog stream).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AccountUsage, FleetSession } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { api, ApiError } from '../src/lib/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { createSessionStore } from '../src/stores/session';
import { NewSessionSheet } from '../src/fleet/NewSessionSheet';
import { SwapSheet, pickableWrappers } from '../src/fleet/SwapSheet';
import { SessionScreen } from '../src/screens/SessionScreen';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// — fixtures —

const MIN = 60_000;

const fakeSocket = (): WebSocket =>
  ({
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close(): void {},
  }) as unknown as WebSocket;

const fleetSession = (patch: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude:OpenClawHetzner',
  wrapper: 'claude',
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/root/projects/OpenClawHetzner',
  workspace: null,
  name: null,
  status: 'idle',
  statusUpdatedAt: Date.now() - 2 * MIN,
  limits: { five: 62, seven: 71 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null, bucket: 'idle', bucketSince: null, unmeasured: [],
  version: null,
  ...patch,
});

/** Fleet store seeded with two live sessions: claude (62/71) and claude2
 *  (8/22, the least loaded); claude-corp and gpt have no live session. */
const makeFleet = (): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => {
    store.setState({
      conn: 'open',
      roster: TEST_ROSTER,
      sessions: [
        fleetSession(),
        fleetSession({
          id: 'claude2:mekwarlive',
          wrapper: 'claude2',
          project: 'mekwarlive',
          workdir: '/root/projects/mekwarlive',
          statusUpdatedAt: Date.now() - 30 * MIN,
          limits: { five: 8, seven: 22 },
        }),
      ],
    });
  });
  return store;
};

/** Fleet store seeded with exactly the given sessions — for SwapSheet cases
 *  that need a specific (or empty) fleet rather than makeFleet()'s fixed pair. */
const storeWith = (sessions: FleetSession[]): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions, roster: TEST_ROSTER }); });
  return store;
};

const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude', five: 0, seven: 0, ts: null,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, ...over,
});

/** Stubs GET /api/accounts — the endpoint useDisabledWrappers polls. */
const stubAccounts = (accounts: AccountUsage[]): void => {
  vi.spyOn(api, 'accounts').mockResolvedValue({
    accounts,
    projected: { wrapper: 'claude', score: 0 },
    // Carried on the wire since Stage 2a; unread here until Task 7.
    roster: [],
  });
};

const PROJECTS = {
  roots: ['/root/projects'],
  projects: [
    { name: 'bt-rules', workdir: '/root/projects/bt-rules' },
    { name: 'mekwarlive', workdir: '/root/projects/mekwarlive' },
    { name: 'OpenClawHetzner', workdir: '/root/projects/OpenClawHetzner' },
  ],
};

// — NewSessionSheet —

describe('NewSessionSheet', () => {
  it('renders all five account rows with labels and the fleet-store limits', () => {
    vi.spyOn(api, 'projects').mockResolvedValue(PROJECTS);
    render(<NewSessionSheet open onClose={vi.fn()} fleet={makeFleet()} />);

    for (const label of ['team·max', 'alt·max', 'team·shared', 'gpt', 'lab·dev0']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    // Live limits ride the rows that have a session on that account…
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();
    expect(screen.getByText('22%')).toBeInTheDocument();
    // …and the accounts without one say so instead of faking a gauge.
    expect(screen.getAllByText(/limits unknown/)).toHaveLength(3);
  });

  it('selecting account + project arms the confirm, which posts the exact body', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue(PROJECTS);
    const create = vi.spyOn(api, 'createSession').mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <>
        <NewSessionSheet open onClose={onClose} fleet={makeFleet()} />
        <ToastHost />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: /alt·max/ }));

    // Step 2: the project list arrives; the confirm sits disarmed until a
    // project is chosen.
    const projRow = await screen.findByRole('button', { name: /OpenClawHetzner/ });
    expect(screen.getByRole('button', { name: /Choose a project/i })).toBeDisabled();

    fireEvent.click(projRow);
    const confirm = screen.getByRole('button', { name: 'Start OpenClawHetzner on alt·max' });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(create).toHaveBeenCalledWith({
      wrapper: 'claude2',
      project: 'OpenClawHetzner',
      workdir: '/root/projects/OpenClawHetzner',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('orders registry projects first, most recently active on top', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue(PROJECTS);
    const { container } = render(
      <NewSessionSheet open onClose={vi.fn()} fleet={makeFleet()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /alt·max/ }));
    await screen.findByRole('button', { name: /OpenClawHetzner/ });

    const names = [...container.ownerDocument.querySelectorAll('.proj-name')].map(
      (el) => el.textContent,
    );
    // OpenClawHetzner (active 2m ago) → mekwarlive (30m) → bt-rules (unregistered).
    expect(names).toEqual(['OpenClawHetzner', 'mekwarlive', 'bt-rules']);
  });

  it('a failed start stays open and toasts the ccd stderr', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue(PROJECTS);
    vi.spyOn(api, 'createSession').mockRejectedValue(
      new ApiError(502, { ok: false, stderr: 'ccd: no such wrapper' }),
    );
    const onClose = vi.fn();
    render(
      <>
        <NewSessionSheet open onClose={onClose} fleet={makeFleet()} />
        <ToastHost />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: /alt·max/ }));
    fireEvent.click(await screen.findByRole('button', { name: /OpenClawHetzner/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start OpenClawHetzner on alt·max' }));

    expect(await screen.findByText(/no such wrapper/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('excludes a disabled account from the new-session picker', async () => {
    // The same bug shape as SwapSheet, one layer up: a kill-switched lane
    // cannot start a session either, so offering it here is just as broken.
    stubAccounts([acct({ wrapper: 'claude' }), acct({ wrapper: 'gpt', disabled: true })]);
    vi.spyOn(api, 'projects').mockResolvedValue(PROJECTS);
    render(<NewSessionSheet open onClose={vi.fn()} fleet={makeFleet()} />);

    expect(await screen.findByRole('button', { name: /alt·max/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gpt/i })).not.toBeInTheDocument();
  });
});

// — SwapSheet —

describe('SwapSheet', () => {
  it('lists only the other accounts and marks the least loaded as suggested', () => {
    render(
      <SwapSheet session={fleetSession()} open onClose={vi.fn()} fleet={makeFleet()} />,
    );

    // The current account never appears as a move target.
    expect(screen.queryByText('team·max')).not.toBeInTheDocument();
    for (const label of ['alt·max', 'team·shared', 'gpt']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    // claude2 (8/22) is the least loaded of the accounts with known limits.
    expect(screen.getByRole('button', { name: /alt·max/ })).toHaveTextContent('suggested');
  });

  it('confirming the move posts the target wrapper', async () => {
    const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <>
        <SwapSheet session={fleetSession()} open onClose={onClose} fleet={makeFleet()} />
        <ToastHost />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: /alt·max/ }));
    expect(
      screen.getByText(
        'The session restarts under alt·max. Anyone attached is briefly disconnected.',
      ),
    ).toBeInTheDocument();
    // Nothing fires until the consequence sentence is confirmed.
    expect(swap).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(swap).toHaveBeenCalledWith('claude:OpenClawHetzner', 'claude2');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // ADJUDICATION, cross-lane seam round. The ui-tsx lane reported this exact
    // path as leaving a stale confirm on screen ("`move()` calls the sheet's
    // `onClose` and never clears `target`") and proposed `setTarget(null)` in
    // `move()`. It does NOT: `QuickConfirm`'s confirm button runs
    // `onConfirm(); onClose();`, and this sheet's `onClose` for it is
    // `setTarget(null)`. Recorded here so the claim cannot be re-raised from
    // the same reading — the confirm is gone after a confirmed move, and it
    // was gone before this round too.
    expect(screen.queryByText(/The session restarts under/)).not.toBeInTheDocument();
  });

  // ...but the CLASS is real, by a different trigger, and it is reachable.
  //
  // The QuickConfirm is a SIBLING of SwapSheet's outer `Sheet`, not a child, so
  // closing the sheet does not close it. `SessionActionsSheet`'s reset-on-close
  // effect sets `swapOpen = false` whenever the actions sheet is dismissed, and
  // FleetScreen keeps both mounted across that close (its findings 2 and 3) —
  // so the confirm outlives the sheet that raised it, and `move()` closes over
  // whatever `session` is CURRENT when it finally runs.
  describe('the confirm does not outlive the sheet that raised it', () => {
    const A = fleetSession();
    const B = fleetSession({ id: 'claude:other', project: 'other' });

    it('drops a pending confirm when the sheet is closed from outside', () => {
      const fleet = makeFleet();
      const { rerender } = render(
        <>
          <SwapSheet session={A} open onClose={() => {}} fleet={fleet} />
          <ToastHost />
        </>,
      );
      fireEvent.click(screen.getByRole('button', { name: /alt·max/ }));
      expect(screen.getByText(/The session restarts under alt·max/)).toBeInTheDocument();
      // The parent closes the sheet while the confirm is up — what the actions
      // sheet's own reset-on-close effect does on every dismissal.
      rerender(
        <>
          <SwapSheet session={A} open={false} onClose={() => {}} fleet={fleet} />
          <ToastHost />
        </>,
      );
      expect(screen.queryByText(/The session restarts under/)).not.toBeInTheDocument();
    });

    it('never shows one session’s pending confirm over another session', () => {
      // The consequence, and the reason this is worth a fix rather than a note:
      // `move()` reads the CURRENT `session`, so a confirm raised while
      // browsing A and tapped after switching to B moves B to the account
      // chosen for A. Nothing on screen would say so — the title still names
      // the account, which is the same in both readings.
      const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined);
      const fleet = makeFleet();
      const { rerender } = render(
        <>
          <SwapSheet session={A} open onClose={() => {}} fleet={fleet} />
          <ToastHost />
        </>,
      );
      fireEvent.click(screen.getByRole('button', { name: /alt·max/ }));
      rerender(
        <>
          <SwapSheet session={A} open={false} onClose={() => {}} fleet={fleet} />
          <ToastHost />
        </>,
      );
      rerender(
        <>
          <SwapSheet session={B} open onClose={() => {}} fleet={fleet} />
          <ToastHost />
        </>,
      );
      expect(screen.queryByText(/The session restarts under/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
      expect(swap).not.toHaveBeenCalled();
    });

    it('drops a pending confirm when the TARGET SESSION changes under it, without closing', () => {
      // Keyed on `session.id` as well as `open`, and this is the fixture that
      // makes that dependency load-bearing rather than decorative: with `[open]`
      // alone every other test here still passes.
      //
      // DISCLOSED: no app path drives this today. Both call sites are modal —
      // `SessionActionsSheet` cannot have its `session` swapped while it is
      // open, and `SessionScreen` is keyed by session id and remounts. So this
      // pins the COMPONENT's contract ("this state belongs to this target"),
      // not a reachable bug. Kept for the reason `_ws_clip_manifest`'s `sort -z`
      // is kept: a property this design depends on must not rest on a caller's
      // current shape merely because today's callers happen to make it hold.
      const fleet = makeFleet();
      const { rerender } = render(
        <>
          <SwapSheet session={A} open onClose={() => {}} fleet={fleet} />
          <ToastHost />
        </>,
      );
      fireEvent.click(screen.getByRole('button', { name: /alt·max/ }));
      expect(screen.getByText(/The session restarts under alt·max/)).toBeInTheDocument();
      rerender(
        <>
          <SwapSheet session={B} open onClose={() => {}} fleet={fleet} />
          <ToastHost />
        </>,
      );
      expect(screen.queryByText(/The session restarts under/)).not.toBeInTheDocument();
    });

    it('still arms a confirm normally after the reset — the guard is not a mute', () => {
      // A reset that fired too eagerly would make the sheet unusable rather
      // than safe, and every assertion above would still pass.
      const fleet = makeFleet();
      const { rerender } = render(
        <>
          <SwapSheet session={A} open={false} onClose={() => {}} fleet={fleet} />
          <ToastHost />
        </>,
      );
      rerender(
        <>
          <SwapSheet session={A} open onClose={() => {}} fleet={fleet} />
          <ToastHost />
        </>,
      );
      fireEvent.click(screen.getByRole('button', { name: /alt·max/ }));
      expect(screen.getByText(/The session restarts under alt·max/)).toBeInTheDocument();
    });
  });

  // Fix round 3, verifier P7 — the eleventh instance of the measurement
  // forgery class, adjudicated REAL and closed here. `AccountLimits.five` /
  // `.seven` are `number | null`, null meaning THE WINDOW WAS NOT READ, and
  // the ranking scored them `?? 0`. `{five: null, seven: null}` is producible,
  // not hypothetical: `readLimits` writes exactly that for an account whose
  // limits file is missing or unparseable (server/src/limits.ts) and
  // `server/src/fleet.ts` passes it through as a NON-null `limits` object, so
  // the unreadable account scored 0% and was recommended as the emptiest pool
  // — while its own gauges rendered '—'.
  it('never suggests an account whose limits were not read — an unread window is not 0%', () => {
    const fleet = storeWith([
      fleetSession(),  // claude, the current account: excluded as a target
      fleetSession({ id: 'claude2:a', wrapper: 'claude2', limits: { five: 8, seven: 22 } }),
      // The whole limits file failed to read: both windows unknown.
      fleetSession({ id: 'claude-corp:b', wrapper: 'claude-corp', limits: { five: null, seven: null } }),
    ]);
    render(<SwapSheet session={fleetSession()} open onClose={vi.fn()} fleet={fleet} />);
    expect(screen.getByRole('button', { name: /team·shared/ })).not.toHaveTextContent('suggested');
    expect(screen.getByRole('button', { name: /alt·max/ })).toHaveTextContent('suggested');
    // And it still says so where the reader can see it, rather than 0%.
    expect(screen.getByRole('button', { name: /team·shared/ })).toHaveTextContent('—');
  });

  it('never suggests on a HALF-read account either — max() of one known window is a lower bound', () => {
    // `{five: 3, seven: null}` scored 3 under `?? 0` and beat a measured 8,
    // while its unread 7-day window could have been at 99. The score is a
    // maximum; one window cannot produce it.
    const fleet = storeWith([
      fleetSession(),
      fleetSession({ id: 'claude2:a', wrapper: 'claude2', limits: { five: 8, seven: 22 } }),
      fleetSession({ id: 'claude-corp:b', wrapper: 'claude-corp', limits: { five: 3, seven: null } }),
    ]);
    render(<SwapSheet session={fleetSession()} open onClose={vi.fn()} fleet={fleet} />);
    expect(screen.getByRole('button', { name: /team·shared/ })).not.toHaveTextContent('suggested');
    expect(screen.getByRole('button', { name: /alt·max/ })).toHaveTextContent('suggested');
  });

  it('suggests nobody at all when no account has both windows read', () => {
    const fleet = storeWith([
      fleetSession(),
      fleetSession({ id: 'claude2:a', wrapper: 'claude2', limits: { five: null, seven: null } }),
      fleetSession({ id: 'claude-corp:b', wrapper: 'claude-corp', limits: null }),
    ]);
    render(<SwapSheet session={fleetSession()} open onClose={vi.fn()} fleet={fleet} />);
    expect(screen.queryByText('suggested')).not.toBeInTheDocument();
    // Every target is still offered and still tappable — not scoring is not
    // hiding.
    for (const label of ['alt·max', 'team·shared', 'gpt']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('excludes a disabled account from the swap picker', () => {
    // The bug a display-only fix leaves behind: the strip stops showing gpt
    // while the picker still offers it as a swap target.
    expect(pickableWrappers(TEST_ROSTER, [], ['gpt'])).not.toContain('gpt');
  });

  it('keeps every account when none is disabled', () => {
    expect(pickableWrappers(TEST_ROSTER, [], [])).toEqual(['claude', 'claude2', 'claude-corp', 'gpt', 'claude-dev0']);
  });

  it('does not offer a disabled account in the rendered picker', async () => {
    stubAccounts([acct({ wrapper: 'claude' }), acct({ wrapper: 'gpt', disabled: true })]);
    render(<SwapSheet session={{ id: 'demo', wrapper: 'claude', project: 'demo' }}
                      open onClose={() => {}} fleet={storeWith([])} />);
    expect(await screen.findByText('alt·max')).toBeInTheDocument();  // picker rendered
    expect(screen.queryByText('gpt')).not.toBeInTheDocument();
  });

  it('does not poll /api/accounts while the sheet is closed', () => {
    // SwapSheet mounts unconditionally from both its callers (open only
    // toggles the inner vaul Sheet), so without gating useDisabledWrappers on
    // `open` this would poll forever in the background, visible or not.
    const accounts = vi.spyOn(api, 'accounts');
    render(<SwapSheet session={{ id: 'demo', wrapper: 'claude', project: 'demo' }}
                      open={false} onClose={() => {}} fleet={storeWith([])} />);
    expect(accounts).not.toHaveBeenCalled();
  });
});

// — SessionScreen overflow menu (change model / move account / stop) —

describe('SessionScreen overflow menu', () => {
  const makeStores = () => {
    const store = createSessionStore('claude:OpenClawHetzner', {
      makeSocket: fakeSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    const fleet = makeFleet();
    return { store, fleet };
  };

  const renderScreen = () => {
    const { store, fleet } = makeStores();
    render(
      <>
        <SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />
        <ToastHost />
      </>,
    );
    act(() => {
      store.setState({ uuid: 'u1', status: 'idle' });
    });
    return { store, fleet };
  };

  it('"Change model" opens the chooser; picking a model sends /model <alias>', () => {
    const prompt = vi.spyOn(api, 'prompt').mockResolvedValue(undefined);
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Change model/ }));
    // The chooser is open now — tap a model row.
    fireEvent.click(screen.getByRole('button', { name: /Opus 5/ }));
    expect(prompt).toHaveBeenCalledWith('claude:OpenClawHetzner', '/model opus');
  });

  it('"Change effort" opens the chooser; picking a level sends /effort <level>', () => {
    const prompt = vi.spyOn(api, 'prompt').mockResolvedValue(undefined);
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Change effort/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ultracode/ }));
    expect(prompt).toHaveBeenCalledWith('claude:OpenClawHetzner', '/effort ultracode');
  });

  it('"Move to another account" opens the swap sheet for this session', () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to another account' }));
    // The swap sheet lists target accounts, current excluded.
    expect(screen.getByRole('button', { name: /alt·max/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /team·max/ })).not.toBeInTheDocument();
  });

  it('stop asks for confirmation and fires api.stop only on confirm', () => {
    const stop = vi.spyOn(api, 'stop').mockResolvedValue(undefined);
    renderScreen();

    // Cancel path: the consequence sheet closes without stopping anything.
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Stop session/ }));
    expect(
      screen.getByText(
        'The session goes offline until you start it again. Its conversation is kept.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(stop).not.toHaveBeenCalled();

    // Confirm path.
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Stop session/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }));
    expect(stop).toHaveBeenCalledWith('claude:OpenClawHetzner');
  });
});
