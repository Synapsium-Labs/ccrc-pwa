// THE THREE REFUSALS THE SESSION SCREEN CAN SPEAK, and none of them had a
// test — measured: `SessionScreen.tsx` was the largest remaining coverage gap
// in the package (27 uncovered statements at 83.63%), and every one of them is
// an error arm. A refusal nobody has asked is a sentence nobody has read.
//
// The harness is `session-pickers.test.tsx`'s own, down to the Virtuoso
// stand-in jsdom needs and the `vi.hoisted` spies its factory closes over.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../shared/api';
import { SessionScreen } from '../src/screens/SessionScreen';
import { ToastHost } from '@ccrc/ui';
import { createSessionStore } from '../src/stores/session';
import { createFleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: { totalCount: number; itemContent: (i: number) => ReactNode }) =>
      React.createElement('div', { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: i }, props.itemContent(i)))),
  };
});

const { ensure, route, restore, prompt } = vi.hoisted(() => ({
  ensure: vi.fn().mockResolvedValue(undefined),
  route: vi.fn().mockResolvedValue(undefined),
  restore: vi.fn().mockResolvedValue(undefined),
  prompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { ...actual.api, ensure, route, restore, prompt } };
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  for (const spy of [ensure, route, restore, prompt]) { spy.mockClear(); spy.mockResolvedValue(undefined); }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ID = 'claude:OpenClawHetzner';
const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

const fleetSession = (patch: Partial<FleetSession> = {}): FleetSession => ({
  id: ID, wrapper: 'claude', home: 'claude', project: 'OpenClawHetzner',
  workdir: '/root/projects/OpenClawHetzner', workspace: null, name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: 'Sonnet 5', effort: 'medium', ultracode: false, branch: null,
  ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null,
  child: { kind: 'none' }, releasedFrom: null, ...patch,
});

const renderScreen = (patch: Partial<FleetSession> = {}, status: 'idle' | 'dead' = 'idle') => {
  const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt } });
  const fleet = createFleetStore();
  act(() => { fleet.setState({ roster: TEST_ROSTER, conn: 'open', sessions: [fleetSession(patch)] }); });
  render(<><SessionScreen id={ID} store={store} fleet={fleet} /><ToastHost /></>);
  act(() => { store.setState({ uuid: 'u1', status }); });
  return { store, fleet };
};

describe('Restart session — the one control a dead row offers', () => {
  it('says why it could not restart, as an alert, and re-arms the button', async () => {
    // `finally { setRestarting(false) }` is the half that matters: a refusal
    // that left the button saying "Restarting…" for ever would make a
    // recoverable failure look terminal.
    ensure.mockRejectedValue(new Error('tmux: no server running'));
    renderScreen({ status: 'dead', bucket: 'dead' }, 'dead');
    const btn = await screen.findByRole('button', { name: 'Restart session' });
    fireEvent.click(btn);
    const t = await screen.findByText("Couldn't restart — tmux: no server running");
    expect(t.closest('[role="alert"]'), 'a refusal is an alert, not a status').not.toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart session' })).not.toBeDisabled());
  });

  it('stringifies a thrown non-Error rather than printing [object Object]', async () => {
    // The `String(err)` arm. ccd's own failures arrive as Errors; a rejected
    // fetch in a stale browser does not.
    ensure.mockRejectedValue('offline');
    renderScreen({ status: 'dead', bucket: 'dead' }, 'dead');
    fireEvent.click(await screen.findByRole('button', { name: 'Restart session' }));
    expect(await screen.findByText("Couldn't restart — offline")).toBeInTheDocument();
  });

  it('refuses a second tap while the first is still in flight', async () => {
    // `if (restarting) return;` — two `/ensure` posts for one row is a race
    // between two spawns, and the second would report a failure that is not
    // one.
    let release!: () => void;
    ensure.mockReturnValue(new Promise<void>((res) => { release = () => res(); }));
    renderScreen({ status: 'dead', bucket: 'dead' }, 'dead');
    const btn = await screen.findByRole('button', { name: 'Restart session' });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Restarting…' }));
    expect(ensure).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart session' })).not.toBeDisabled());
  });
});

describe('a routing write that fails', () => {
  it("says it could not apply, and drops the queued badge it had just armed", async () => {
    // BOTH halves, and the second is the one a reader would notice: the badge
    // promises "the pane has not confirmed it yet", which is a lie once the
    // write itself has been refused. `useQueuedRoute`'s `clear()` in the catch
    // is what retires it.
    route.mockRejectedValue(new Error('ccd: route refused'));
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Change effort/ }));
    fireEvent.click(await screen.findByRole('button', { name: /High/ }));
    expect(await screen.findByText(/Couldn't apply that/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('queued')).toBeNull());
  });
});

describe('Restore, on a session already put away', () => {
  it('says why it could not restore', async () => {
    // A main checkout's Restore reaches `/ensure` (`restoreReachesEnsure`),
    // which is the same request Restart makes — so this arm is about the
    // SENTENCE, which is its own ("restore", not "restart").
    ensure.mockRejectedValue(new Error('registry row is gone'));
    renderScreen({ archivedAt: 1785300000, bucket: 'archived' });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));
    expect(await screen.findByText(/Couldn't restore — registry row is gone/)).toBeInTheDocument();
  });
});
