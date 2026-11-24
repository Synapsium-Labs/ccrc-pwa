// Wave 173 at the screen: `SessionScreen` measures whether the open session, and its coordinator, have a busy worker
// (`workersBusyOf` over the fleet store) and hands it to the session facts and to `coordinationOf`, so the header of an
// open coordinator says what its fleet row says. Without that wiring the header reads the bucket's word; these cases red.
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { FleetSession, RunSummary } from '../../shared/api';
import { SessionScreen } from '../src/screens/SessionScreen';
import { STATE_WORD, WAITING_ON_WORKERS } from '../src/fleet/sessionFacts';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore } from '../src/stores/session';
import { served } from './wirePairing';
import { NOW, MIN, run, sess } from './rollupFixture';
import { withRunBinding } from './runBindingFixture';

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: { totalCount: number; itemContent: (i: number) => ReactNode }) =>
      React.createElement('div', { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) => React.createElement('div', { key: i }, props.itemContent(i)))),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

function fleetWith(workerOver: Partial<FleetSession>): { sessions: FleetSession[]; runs: RunSummary[] } {
  const coord = sess('coord', 'project-c', {
    role: 'coordinator', status: 'idle', bucket: 'done', bucketSince: NOW - 10 * MIN, statusUpdatedAt: NOW - 10 * MIN,
  });
  const w1 = sess('w1', 'project-c', { role: 'child', ...workerOver });
  const runs = [run(10, 'coord', 'w1', { state: 'working' })];
  return { sessions: withRunBinding([coord, w1], runs), runs };
}

function open(id: string, f: { sessions: FleetSession[]; runs: RunSummary[] }): HTMLElement {
  const store = served(createSessionStore(id, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } }));
  const fleet = createFleetStore({ makeSocket: fakeSocket });
  act(() => fleet.setState({ sessions: f.sessions, runs: f.runs, conn: 'open', fleetFrameSeen: true, runsFrameSeen: true }));
  const row = f.sessions.find((s) => s.id === id)!;
  act(() => store.setState({ uuid: 'u1', status: row.status }));
  return render(<SessionScreen id={id} store={store} fleet={fleet} />).container;
}

describe('the open coordinator’s header (wave 173)', () => {
  it('says waiting on workers, and its lamp speaks it, while a worker is working', () => {
    const c = open('coord', fleetWith({ status: 'busy', bucket: 'working' }));
    expect(c.querySelector('.status-line')?.textContent).toBe(WAITING_ON_WORKERS);
    expect(c.querySelector(`[role="img"][aria-label="${WAITING_ON_WORKERS}"]`)).not.toBeNull();
  });

  it('says done once its workers are quiet', () => {
    const c = open('coord', fleetWith({ status: 'idle', bucket: 'done' }));
    expect(c.querySelector('.status-line')?.textContent).toMatch(new RegExp(`^${STATE_WORD.done}`));
    expect(c.querySelector(`[role="img"][aria-label="${WAITING_ON_WORKERS}"]`)).toBeNull();
  });
});

describe('a worker’s header names its coordinator waiting on workers', () => {
  it('in its coordination details', () => {
    const c = open('w1', fleetWith({ status: 'busy', bucket: 'working' }));
    expect(c.textContent).toContain(`· ${WAITING_ON_WORKERS}`);
  });
});
