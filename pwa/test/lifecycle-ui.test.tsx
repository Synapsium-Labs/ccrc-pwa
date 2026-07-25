// Task 10 — lifecycle UI: NewSessionSheet (account rows from the fleet store
// with live limits; account+project selection arms a confirm that posts the
// exact body), SwapSheet (excludes the current wrapper, suggests the least
// loaded, posts the target through a QuickConfirm), the stop flow (QuickConfirm
// fires api.stop only on confirm), and the header overflow menu ("Change
// model" sends the /model command; the resulting picker rides the normal
// dialog stream).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { api, ApiError } from '../src/lib/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { createSessionStore } from '../src/stores/session';
import { NewSessionSheet } from '../src/fleet/NewSessionSheet';
import { SwapSheet } from '../src/fleet/SwapSheet';
import { SessionScreen } from '../src/screens/SessionScreen';

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
  name: null,
  status: 'idle',
  statusUpdatedAt: Date.now() - 2 * MIN,
  limits: { five: 62, seven: 71 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null,
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
  it('renders all four account rows with labels and the fleet-store limits', () => {
    vi.spyOn(api, 'projects').mockResolvedValue(PROJECTS);
    render(<NewSessionSheet open onClose={vi.fn()} fleet={makeFleet()} />);

    for (const label of ['team·max', 'alt·max', 'team·shared', 'gpt']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
    // Live limits ride the rows that have a session on that account…
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();
    expect(screen.getByText('22%')).toBeInTheDocument();
    // …and the accounts without one say so instead of faking a gauge.
    expect(screen.getAllByText(/limits unknown/)).toHaveLength(2);
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
    fireEvent.click(screen.getByRole('button', { name: /Opus 4\.8/ }));
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
