import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { FleetScreen } from '../src/screens/FleetScreen';
import { SessionCard } from '../src/fleet/SessionCard';
import { AccountsStrip } from '../src/fleet/AccountsStrip';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// — fixtures —

const MIN = 60_000;

const session = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude:OpenClawHetzner',
  wrapper: 'claude',
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/home/rc/projects/OpenClawHetzner',
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
