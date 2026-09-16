// Routing spec 2026-09-14 §5.3, slice 4, Task 5 — the model/effort pickers'
// write. A tap sends `POST /api/sessions/:id/route` (`api.route`) instead of
// a slash command, and the header chip wears a `queued` badge until the live
// fleet frame reads the write back (or 60s pass with no confirmation).
//
// The harness is `session-lifecycle.test.tsx`'s own shape: the Virtuoso
// stand-in jsdom needs, and `act`-wrapped `fireEvent`s against a real
// `SessionScreen`. This file additionally mocks `../src/lib/api` — the one
// module `SessionScreen`'s picker calls reach directly, never through the
// session store's own `api` (that only serves the composer's `prompt`/
// `resolve`) — so `route`/`prompt` are both spies this file controls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../shared/api';
import { SessionScreen } from '../src/screens/SessionScreen';
import { ToastHost } from '../src/components/Toast';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: {
      totalCount: number;
      itemContent: (i: number) => ReactNode;
      computeItemKey?: (i: number) => string | number;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i)),
        ),
      ),
  };
});

// `vi.mock`'s factory is hoisted above every top-level statement in this
// file, so the spies it closes over have to be created through `vi.hoisted`
// — a bare `const route = vi.fn()` above this call would still run AFTER the
// factory, and `route` inside it would throw on the temporal-dead-zone read
// (measured: "Cannot access 'route' before initialization").
const { route, prompt } = vi.hoisted(() => ({
  route: vi.fn().mockResolvedValue(undefined),
  prompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { ...actual.api, route, prompt } };
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  route.mockClear();
  route.mockResolvedValue(undefined);
  prompt.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ID = 'claude:OpenClawHetzner';
const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

const fleetSession = (patch: Partial<FleetSession> = {}): FleetSession => ({
  id: ID, wrapper: 'claude', home: 'claude', project: 'OpenClawHetzner',
  workdir: '/root/projects/OpenClawHetzner', workspace: null, name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  // Non-null model/effort — the header's model/effort chips only render at
  // all once one of model/branch/effort/ultracode is truthy (`SessionHeader`'s
  // `hasMeta`), and the `queued` badge for a field rides that field's own
  // chip. `Sonnet 5`/`medium`, deliberately neither of the values these
  // tests pick, so a tap is a real change to read back.
  version: null, model: 'Sonnet 5', effort: 'medium', ultracode: false, branch: null,
  ctxPct: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, ...patch,
});

const makeStore = (): SessionStore =>
  createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt } });

const makeFleet = (): FleetStore => {
  const store = createFleetStore();
  act(() => { store.setState({ roster: TEST_ROSTER, conn: 'open', sessions: [fleetSession()] }); });
  return store;
};

const renderScreen = (): { store: SessionStore; fleet: FleetStore } => {
  const store = makeStore();
  const fleet = makeFleet();
  render(
    <>
      <SessionScreen id={ID} store={store} fleet={fleet} />
      <ToastHost />
    </>,
  );
  act(() => { store.setState({ uuid: 'u1', status: 'idle' }); });
  return { store, fleet };
};

/** Live-frame read-back: replaces the one session in the fleet store. */
const updateLive = (fleet: FleetStore, patch: Partial<FleetSession>): void => {
  act(() => { fleet.setState({ sessions: [fleetSession(patch)] }); });
};

const openEffortSheet = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('button', { name: /Change effort/ }));
};

const openModelSheet = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('button', { name: /Change model/ }));
};

describe('session pickers write the routing record', () => {
  it('a tap on High calls api.route once, never api.prompt, and renders queued', async () => {
    renderScreen();
    openEffortSheet();
    fireEvent.click(screen.getByRole('button', { name: /^High/ }));

    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith(ID, 'effort', 'high');
    expect(prompt).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('queued')).toBeInTheDocument());
  });

  it('a fleet frame with effort:"high" clears the queued badge', async () => {
    const { fleet } = renderScreen();
    openEffortSheet();
    fireEvent.click(screen.getByRole('button', { name: /^High/ }));
    await waitFor(() => expect(screen.getByText('queued')).toBeInTheDocument());

    updateLive(fleet, { effort: 'high' });
    await waitFor(() => expect(screen.queryByText('queued')).not.toBeInTheDocument());
  });

  it('a tap on Opus 5 calls api.route(id, "class", "opus"), and clears on model:"Opus 5"', async () => {
    const { fleet } = renderScreen();
    openModelSheet();
    fireEvent.click(screen.getByRole('button', { name: /Opus 5/ }));

    expect(route).toHaveBeenCalledWith(ID, 'class', 'opus');
    expect(prompt).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('queued')).toBeInTheDocument());

    updateLive(fleet, { model: 'Opus 5' });
    await waitFor(() => expect(screen.queryByText('queued')).not.toBeInTheDocument());
  });

  it('Auto clears on the response — no live frame needed, absence is not readable', async () => {
    renderScreen();
    openEffortSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));

    expect(route).toHaveBeenCalledWith(ID, 'effort', 'auto');
    await waitFor(() => expect(screen.queryByText('queued')).not.toBeInTheDocument());
  });

  it('after 60s with no read-back, queued clears with the unconfirmed toast', async () => {
    vi.useFakeTimers();
    try {
      renderScreen();
      openEffortSheet();
      fireEvent.click(screen.getByRole('button', { name: /^High/ }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('queued')).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(screen.queryByText('queued')).not.toBeInTheDocument();
      expect(screen.getByText('Routing queued; the pane has not confirmed it yet')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
