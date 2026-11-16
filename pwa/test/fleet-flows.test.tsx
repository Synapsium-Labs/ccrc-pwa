// The fleet's flows and polls lifted above the fleet screen (D-5468, W2 Task S2a). In W2 a fleet list is a skin's
// part: a skin switch remounts it, and more than one part reads health and updates. These cases pin the two things
// that must therefore live above any list: ONE poll of each plane for the whole shell, and sheets that outlive the
// list they were opened from.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession, UpdatesView } from '../../shared/api';
import type { ReactNode } from 'react';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { FleetScreen } from '../src/screens/FleetScreen';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { FleetFlows } from '../src/fleet/FleetFlows';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';

const makeStore = (): FleetStore =>
  createFleetStore({
    makeSocket: () =>
      ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });

const session = (over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', statusUpdatedAt: Date.now(), ...over });

const POOLS = { listed: true as const, byProject: {}, enforcement: 'enforced' as const };

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the fleet chrome (D-5468)', () => {
  it('one health poll, one updates poll and one projects fetch, with two fleet screens mounted', async () => {
    vi.useFakeTimers();
    const health = vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
    const updates = vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
    const projects = vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    const store = makeStore();
    render(
      <FleetChromeProvider store={store}>
        <FleetScreen store={store} />
        <FleetScreen store={store} />
        <FleetFlows />
      </FleetChromeProvider>,
    );
    act(() => {
      store.setState({ conn: 'open', sessions: [session()], pools: POOLS, roster: TEST_ROSTER });
    });
    // One mount's immediate request, then one poll interval of each.
    expect(health).toHaveBeenCalledTimes(1);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(projects).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(health).toHaveBeenCalledTimes(1 + 60_000 / 15_000);
    expect(updates).toHaveBeenCalledTimes(2);
    expect(projects).toHaveBeenCalledTimes(1);
  });

  it('a sheet opened from the fleet stays open when the fleet screen unmounts', () => {
    vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
    const store = makeStore();
    const Host = ({ withScreen }: { withScreen: boolean }): ReactNode => (
      <FleetChromeProvider store={store}>
        {withScreen && <FleetScreen store={store} />}
        <FleetFlows />
      </FleetChromeProvider>
    );
    const { rerender } = render(<Host withScreen />);
    act(() => {
      store.setState({ conn: 'open', sessions: [session()] });
    });
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(screen.getByRole('dialog', { name: /start a session/i })).toBeInTheDocument();
    rerender(<Host withScreen={false} />);
    expect(screen.queryByRole('button', { name: 'New session' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /start a session/i })).toBeInTheDocument();
  });

  // The same promise for the other three sheets a fleet list opens (spec §5.4): each one's open state is the chrome's,
  // so unmounting the list alone leaves it open. Move a sheet's state back onto the screen and its case goes red.
  const rel = (closedAt: number) =>
    ({ runId: closedAt, program: 'lifecycle', programTitle: null, claimedBy: 'coord', closedAt, child: false });
  const survivors: Array<{
    sheet: string;
    seed: Partial<ReturnType<FleetStore['getState']>>;
    open: () => Promise<void>;
    isOpen: () => HTMLElement;
  }> = [
    {
      sheet: 'the ··· actions sheet',
      seed: { sessions: [session()] },
      open: async () => {
        fireEvent.click(screen.getByRole('button', { name: /actions for quiet-mesa/i }));
      },
      isOpen: () => screen.getByRole('button', { name: /restart session/i }),
    },
    {
      sheet: 'the Archive-all confirm',
      seed: {
        sessions: [
          session({ id: 'a-one', workspace: 'one', bucket: 'idle', releasedFrom: rel(300) }),
          session({ id: 'a-two', workspace: 'two', bucket: 'idle', releasedFrom: rel(200) }),
        ],
      },
      open: async () => {
        fireEvent.click(await screen.findByRole('button', { name: /released \(2\)/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Archive all 2 released workspaces in alpha' }));
      },
      isOpen: () => screen.getByRole('button', { name: 'Archive 2' }),
    },
    {
      sheet: 'the pool sheet',
      seed: {
        roster: TEST_ROSTER.map((account) => ({ ...account, pool: account.id === 'claude' ? 'pool-a' : null })),
        pools: { listed: true, byProject: { alpha: { state: 'tagged', name: 'pool-a' } }, enforcement: 'enforced' },
        sessions: [session()],
      },
      open: async () => {
        fireEvent.click(await screen.findByRole('button', { name: 'project pool pool-a' }));
      },
      isOpen: () => screen.getByRole('heading', { name: 'Which pool runs this project?' }),
    },
  ];

  it.each(survivors)('$sheet stays open when the fleet screen unmounts', async ({ seed, open, isOpen }) => {
    vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
    vi.spyOn(api, 'projects').mockResolvedValue({
      roots: [],
      projects: [{ name: 'alpha', workdir: '/alpha', pool: { state: 'tagged', name: 'pool-a' }, placement: { kind: 'unmeasurable' } }],
    });
    const store = makeStore();
    const Host = ({ withScreen }: { withScreen: boolean }): ReactNode => (
      <FleetChromeProvider store={store}>
        {withScreen && <FleetScreen store={store} />}
        <FleetFlows />
      </FleetChromeProvider>
    );
    const { rerender } = render(<Host withScreen />);
    act(() => {
      store.setState({ conn: 'open', ...seed });
    });
    await open();
    expect(isOpen()).toBeInTheDocument();
    rerender(<Host withScreen={false} />);
    expect(screen.queryByRole('button', { name: 'New session' })).not.toBeInTheDocument();
    expect(isOpen()).toBeInTheDocument();
  });

  it('the actions sheet follows its session out of the list', async () => {
    vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
    const store = makeStore();
    render(
      <FleetChromeProvider store={store}>
        <FleetScreen store={store} />
        <FleetFlows />
      </FleetChromeProvider>,
    );
    act(() => {
      store.setState({
        conn: 'open',
        sessions: [session(), session({ id: 'b', project: 'beta', workspace: 'brave-elm' })],
      });
    });
    fireEvent.click(screen.getByRole('button', { name: /actions for quiet-mesa/i }));
    expect(screen.getByRole('button', { name: /restart session/i })).toBeInTheDocument();
    act(() => {
      store.setState({ sessions: [session({ id: 'b', project: 'beta', workspace: 'brave-elm' })] });
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /restart session/i })).not.toBeInTheDocument());
  });

  it("a fleet screen given a store that is not the host's throws rather than read one fleet and act on another", () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
    expect(() =>
      render(
        <FleetChromeProvider store={makeStore()}>
          <FleetScreen store={makeStore()} />
        </FleetChromeProvider>,
      ),
    ).toThrow('FleetScreen store is not the FleetChrome store');
  });

  it('a fleet screen with no store prop reads the host\'s store', () => {
    vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
    const store = makeStore();
    render(
      <FleetChromeProvider store={store}>
        <FleetScreen />
      </FleetChromeProvider>,
    );
    act(() => {
      store.setState({ conn: 'open', sessions: [session()] });
    });
    expect(screen.getByRole('button', { name: /actions for quiet-mesa/i })).toBeInTheDocument();
  });

  it('a fleet screen without the host throws FleetChrome is not mounted', () => {
    // React reports the render error to the console before rethrowing it; that report is this case's expected noise.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
    expect(() => render(<FleetScreen store={makeStore()} />)).toThrow('FleetChrome is not mounted');
  });
});
