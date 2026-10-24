// C6 / D-6438: a fleet frame reaches only what reads a changed row.
//
// `keepRows` (the store) hands an unchanged row back as the SAME object, so a frame that changes one row is a new
// array with one new row. These cases pin the other half: the readers downstream of the store subscribe to what they
// read and nothing wider. Frames arrive through the store's OWN socket path (a fake socket, `connect()`, a JSON
// message with fresh objects every time), never a prebuilt `setState`, so `keepRows` is in the loop — the one
// exception is case 4, whose `App` has no injectable store (said where it happens).
//
// Every count case first asserts its counter fired at mount and its DOM is present, so a never-mounted probe or an
// absent node cannot read as "no re-render".
import { Profiler, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { FleetSession, RunSummary } from '../../shared/api';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { resetAcks } from '../src/lib/seen';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { createSessionStore } from '../src/stores/session';
import { FleetChromeProvider, useFleetChrome, type FleetChrome } from '../src/fleet/FleetChrome';
import { useFleetFlows, type FleetFlowDoors } from '../src/fleet/FleetFlows';
import { SessionScreen } from '../src/screens/SessionScreen';
import { App } from '../src/app';
import { fleetSession } from './fleetFixture';

// Only ToastHost is replaced: the real @ccrc/ui is spread, so every other export is the shipped one.
const toastCount = vi.hoisted(() => ({ renders: 0 }));
// SessionScreen's OWN renders are counted through a stand-in for one of its always-mounted children: `HistoryTab`
// takes an inline `onClose` and has no store subscription of its own, so it renders exactly when SessionScreen does.
// A Profiler around the screen would also count the sheets it hosts, and `SwapSheet` reads every row for itself
// (`pickableWrappers`): that re-render is its own, not the screen's.
const screenCount = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../src/session/HistoryTab', () => ({
  HistoryTab: () => {
    screenCount.renders += 1;
    return null;
  },
}));
vi.mock('@ccrc/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ccrc/ui')>();
  const { createElement } = await import('react');
  return {
    ...real,
    ToastHost: () => {
      toastCount.renders += 1;
      return createElement('div', { 'data-testid': 'toast-stub' });
    },
  };
});

// — fixtures: neutral names —

const A = 'ws-a';
const B = 'ws-b';
const C = 'ws-c';

const row = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  wrapper: 'lane-a', home: 'lane-a', project: 'project-a', status: 'idle', bucket: 'idle', ...over,
});
const wsA = (over: Partial<FleetSession> = {}): FleetSession => row({
  id: A, project: 'project-b', workspace: 'quiet-river', role: 'child', child: { kind: 'child', runId: 39 },
  boardProject: 'project-a', ...over,
});
const wsB = (over: Partial<FleetSession> = {}): FleetSession => row({
  id: B, project: 'project-c', workspace: 'amber-reef', name: 'other worker', ...over,
});
const wsC = (over: Partial<FleetSession> = {}): FleetSession => row({
  id: C, project: 'project-a', workspace: null, role: 'coordinator', name: 'the coordinator', ...over,
});

/** ws-a's active run, claimed by the coordinator ws-c (so `parentIdOf(ws-a)` names ws-c). */
const runForA: RunSummary = {
  id: 41, program: 'port-api', programTitle: 'Port the API', wave: 5, waveOf: 7,
  project: 'project-b', homeProject: 'project-b', sessionId: A, workspace: 'quiet-river', branch: null,
  state: 'dispatched', kind: 'work', reviews: null, claimedBy: C, resumed: true, clearedAt: null,
  openedAt: 1_800_000_000_000, dispatchStartedAt: null, dispatchedAt: null, closedAt: null, handoffCommit: null,
  items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null,
            briefQueued: true, clearError: null, coordKickoffPendingSince: null }, childReclaim: null,
};

// — the store, driven through its own socket —

class FakeSocket {
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close(): void {}
  open(): void { this.onopen?.(new Event('open')); }
  message(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
}

interface Driven {
  store: FleetStore;
  /** One `fleet` frame: the rows are serialised and parsed again, so every frame carries FRESH objects. */
  sendRows: (sessions: readonly FleetSession[]) => void;
  sendRuns: (runs: readonly RunSummary[]) => void;
}

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

const driven = (): Driven => {
  const sockets: FakeSocket[] = [];
  const store = createFleetStore({
    makeSocket: () => { const s = new FakeSocket(); sockets.push(s); return s as unknown as WebSocket; },
    catchUp: () => never(),
    fetchFeed: () => never(),
    fetchAccounts: () => never(),
  });
  store.getState().connect();
  const sock = sockets[0];
  if (sock === undefined) throw new Error('the store opened no socket');
  act(() => { sock.open(); });
  return {
    store,
    sendRows: (sessions) => { act(() => { sock.message(JSON.stringify({ type: 'fleet', sessions })); }); },
    sendRuns: (runs) => { act(() => { sock.message(JSON.stringify({ type: 'runs', runs })); }); },
  };
};

const opened: FleetStore[] = [];
const track = (d: Driven): Driven => { opened.push(d.store); return d; };

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  toastCount.renders = 0;
  vi.spyOn(api, 'accounts').mockReturnValue(never());
  vi.spyOn(api, 'fleetHealth').mockReturnValue(never());
  vi.spyOn(api, 'updates').mockReturnValue(never());
  vi.spyOn(api, 'projects').mockReturnValue(never());
});

afterEach(() => {
  cleanup();
  for (const s of opened.splice(0)) s.getState().disconnect();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
  vi.restoreAllMocks();
});

/** A Profiler that counts the commits its subtree takes part in. */
const counted = (): { count: () => number; onRender: () => void } => {
  let n = 0;
  return { count: () => n, onRender: () => { n += 1; } };
};

describe('a fleet frame reaches only what reads a changed row (C6, D-6438)', () => {
  const mountScreen = (rows: readonly FleetSession[], runs: readonly RunSummary[]) => {
    const d = track(driven());
    d.sendRows(rows);
    d.sendRuns(runs);
    const session = createSessionStore(A, {
      makeSocket: () => new FakeSocket() as unknown as WebSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    screenCount.renders = 0;
    render(<SessionScreen id={A} store={session} fleet={d.store} />);
    const screen = { count: () => screenCount.renders };
    // The mount is real: the counter fired and the header is in the DOM.
    expect(screen.count()).toBeGreaterThan(0);
    expect(document.querySelector('.chat-head')).not.toBeNull();
    return { d, screen };
  };

  it('another session\'s row change does not re-render SessionScreen', () => {
    const { d, screen } = mountScreen([wsA(), wsB(), wsC()], [runForA]);
    // The coordinator line is on screen, so the screen DOES read ws-c: the row it must not follow is ws-b's.
    expect(document.querySelector('.chat-coord')).not.toBeNull();
    const before = screen.count();
    d.sendRows([wsA(), wsB({ name: 'renamed worker', bucket: 'working', status: 'busy' }), wsC()]);
    expect(d.store.getState().sessions.find((s) => s.id === B)?.name).toBe('renamed worker');
    expect(screen.count()).toBe(before);
  });

  it('the coordinator\'s row change does', () => {
    const { d, screen } = mountScreen([wsA(), wsB(), wsC()], [runForA]);
    const line = (): string => document.querySelector('.chat-coord')?.textContent ?? '';
    expect(line()).toContain('the coordinator');
    expect(line()).toContain('idle');
    const before = screen.count();
    d.sendRows([wsA(), wsB(), wsC({ name: 'the renamed coordinator', bucket: 'working', status: 'busy' })]);
    expect(screen.count()).toBeGreaterThan(before);
    // The DOM says the new fact: a lookup over `[live]` alone would keep the old coordinator in the header.
    expect(line()).toContain('the renamed coordinator');
    expect(line()).toContain('working');
    expect(line()).not.toContain('idle');
  });

  it('a fleet frame re-renders no useFleetChrome consumer while no plane changed', () => {
    const d = track(driven());
    d.sendRows([wsA(), wsB(), wsC()]);
    const provider = counted();
    const probe = counted();
    const Probe = (): ReactNode => {
      useFleetChrome();
      probe.onRender();
      return <span data-testid="probe" />;
    };
    const { getByTestId } = render(
      <Profiler id="provider" onRender={provider.onRender}>
        <FleetChromeProvider store={d.store}><Probe /></FleetChromeProvider>
      </Profiler>,
    );
    expect(getByTestId('probe')).toBeInTheDocument();
    expect(probe.count()).toBeGreaterThan(0);
    expect(provider.count()).toBeGreaterThan(0);
    const probeBefore = probe.count();
    const providerBefore = provider.count();
    d.sendRows([wsA(), wsB({ name: 'renamed worker' }), wsC()]);
    // The provider read the changed frame (it subscribes to the rows) ...
    expect(provider.count()).toBeGreaterThan(providerBefore);
    // ... and the consumers below it did not follow.
    expect(probe.count()).toBe(probeBefore);
  });

  it('a changed fleet frame does not re-render the shell root', () => {
    navigate('/');
    // `App` has no injectable store, so this case moves the GLOBAL store by `setState`; `keepRows` is not in the
    // loop here, and does not need to be: what is pinned is that the shell root holds no `sessions` subscription.
    act(() => useFleetStore.setState({ conn: 'open', sessions: [wsA(), wsB(), wsC()] }));
    const { getByTestId } = render(<App />);
    expect(getByTestId('toast-stub')).toBeInTheDocument();
    expect(toastCount.renders).toBeGreaterThan(0);
    const before = toastCount.renders;
    act(() => useFleetStore.setState({ sessions: [wsA(), wsB({ name: 'renamed worker' }), wsC()] }));
    expect(useFleetStore.getState().sessions.find((s) => s.id === B)?.name).toBe('renamed worker');
    expect(toastCount.renders).toBe(before);
  });

  /** A probe that records the doors it was handed and the chrome beside them, and can re-render itself. */
  const mountFlows = () => {
    const d = track(driven());
    d.sendRows([wsA(), wsB(), wsC()]);
    const seen: { doors: FleetFlowDoors[]; chrome: FleetChrome[]; bump: () => void } = {
      doors: [], chrome: [], bump: () => {},
    };
    const Probe = (): ReactNode => {
      const [, setN] = useState(0);
      seen.bump = () => setN((n) => n + 1);
      seen.doors.push(useFleetFlows());
      seen.chrome.push(useFleetChrome());
      return <span data-testid="probe" />;
    };
    const { getByTestId } = render(<FleetChromeProvider store={d.store}><Probe /></FleetChromeProvider>);
    expect(getByTestId('probe')).toBeInTheDocument();
    expect(seen.doors.length).toBeGreaterThan(0);
    return { d, seen };
  };

  it('useFleetFlows\' doors keep their identity', () => {
    const { d, seen } = mountFlows();
    const first = seen.doors[0]!;
    // (a) the probe itself renders again.
    const renders = seen.doors.length;
    act(() => { seen.bump(); });
    expect(seen.doors.length).toBeGreaterThan(renders);
    // (b) a changed fleet frame.
    d.sendRows([wsA(), wsB({ name: 'renamed worker' }), wsC()]);
    // (c) and the probe renders once more, after the frame.
    act(() => { seen.bump(); });
    for (const doors of seen.doors) {
      expect(doors).toBe(first);
      for (const key of Object.keys(first) as Array<keyof FleetFlowDoors>) expect(doors[key]).toBe(first[key]);
    }
  });

  it('openActions opens the newest row', () => {
    const { d, seen } = mountFlows();
    // The doors of the FIRST render, called after later frames: they must read the store at call time.
    const stale = seen.doors[0]!;
    d.sendRows([wsA({ name: 'first name' }), wsB(), wsC()]);
    d.sendRows([wsA({ name: 'newest name' }), wsB(), wsC()]);
    act(() => { stale.openActions(A); });
    const chrome = seen.chrome[seen.chrome.length - 1]!;
    const newest = d.store.getState().sessions.find((s) => s.id === A);
    expect(newest?.name).toBe('newest name');
    expect(chrome.actions.open).toBe(true);
    expect(chrome.actions.session).toBe(newest);
  });

  it('openActions opens a row that arrived after the doors were taken', () => {
    const { d, seen } = mountFlows();
    // The doors of the FIRST render, taken while the store held three rows. ws-d is in none of the lists they could have
    // closed over: `useActionsSheet` swaps in the newest row after `openFor`, so a door that froze the list at render
    // would open nothing, or the wrong row, for it.
    const stale = seen.doors[0]!;
    expect(d.store.getState().sessions.some((s) => s.id === 'ws-d')).toBe(false);
    d.sendRows([wsA(), wsB(), wsC(), row({ id: 'ws-d', project: 'project-a', workspace: null, name: 'late row' })]);
    expect(d.store.getState().sessions.find((s) => s.id === 'ws-d')?.name).toBe('late row');
    act(() => { stale.openActions('ws-d'); });
    const chrome = seen.chrome[seen.chrome.length - 1]!;
    expect(chrome.actions.open).toBe(true);
    expect(chrome.actions.session?.name).toBe('late row');
  });
});
