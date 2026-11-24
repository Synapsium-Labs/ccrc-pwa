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
import { heldByCoordinator, HOUR, NOW, MIN, run, sess } from './rollupFixture';
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
  vi.useRealTimers();
});

const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

/** The coordinator (done) and its worker w1, bound to run 10; `spawnAt`, when given, adds the coordinator's next dispatch
 *  (run 30, planned, stamped then, its session not yet listed: the ordinary "open wave N+1 before closing wave N"). */
function fleetWith(workerOver: Partial<FleetSession>, spawnAt: number | null = null): { sessions: FleetSession[]; runs: RunSummary[] } {
  const coord = sess('coord', 'project-c', {
    role: 'coordinator', status: 'idle', bucket: 'done', bucketSince: NOW - 10 * MIN, statusUpdatedAt: NOW - 10 * MIN,
  });
  const w1 = sess('w1', 'project-c', { role: 'child', ...workerOver });
  const runs = [run(10, 'coord', 'w1', { state: 'working' })];
  const spawn = spawnAt === null ? [] : [run(30, 'coord', null, { state: 'planned', dispatchStartedAt: spawnAt })];
  return { sessions: withRunBinding([coord, w1], runs), runs: [...runs, ...spawn] };
}

const quietWorker: Partial<FleetSession> = { status: 'idle', bucket: 'done' };
const asleepWorker: Partial<FleetSession> = {
  status: 'dead', lifecycle: 'stopped', stoppedBy: { at: NOW - HOUR, surface: 'agent' }, bucket: 'dead', hibernatedAt: NOW - HOUR,
};

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

  // Review 3651 F1: the screen hands the coordination reader its clock, so a coordinator whose only wait is a spawn in
  // flight reads on its worker's header as it does on its own row, header and lamp. The clock is the screen's own
  // (`useNow`), so `Date` is pinned to the fixtures' NOW; past the stall threshold the same spawn is no wait.
  for (const [name, over] of [['done', quietWorker], ['whose question the coordinator holds', heldByCoordinator()],
    ['asleep', asleepWorker]] as const) {
    it(`a worker ${name}, its coordinator's spawn in flight: waiting on workers; the same spawn stalled: done`, () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      expect(open('w1', fleetWith(over, NOW - MIN)).textContent).toContain(`· ${WAITING_ON_WORKERS}`);
      cleanup();
      const stalled = open('w1', fleetWith(over, NOW - 3 * HOUR)).textContent;
      expect(stalled).not.toContain(WAITING_ON_WORKERS);
      expect(stalled).toContain(`· ${STATE_WORD.done}`);
    });
  }

  // The held question and the asleep worker alone keep nobody waiting (review 3632 F2, and the hibernation census's stance).
  for (const [name, over] of [['whose question the coordinator holds', heldByCoordinator()], ['asleep', asleepWorker]] as const) {
    it(`a worker ${name}, with no other worker or spawn: its coordinator reads done`, () => {
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      const c = open('w1', fleetWith(over)).textContent;
      expect(c).not.toContain(WAITING_ON_WORKERS);
      expect(c).toContain(`· ${STATE_WORD.done}`);
    });
  }
});
