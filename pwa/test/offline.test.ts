// Task 13 — offline shell: the fleet snapshot persists to localStorage, the
// fleet store hydrates from it at boot (conn stays 'connecting'), and the
// fleet screen stale-marks hydrated data until the socket opens.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { FleetSession } from '../../shared/api';
import { loadFleetSnapshot, saveFleetSnapshot } from '../src/lib/offline';
import { createFleetStore } from '../src/stores/fleet';
import { FleetScreen } from '../src/screens/FleetScreen';

const session = (id: string): FleetSession => ({
  id,
  wrapper: 'claude',
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/home/rc/projects/OpenClawHetzner',
  name: null,
  status: 'idle',
  statusUpdatedAt: null,
  limits: { five: 10, seven: 40 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null,
  version: '2.1.0',
});

/** Scripted WebSocket stand-in (same shape the store tests use). */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly url: string;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event('open'));
  }

  message(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  window.localStorage.clear();
  FakeSocket.instances = [];
});

afterEach(() => {
  cleanup();
});

describe('fleet snapshot (lib/offline)', () => {
  it('round-trips sessions through localStorage', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    const snap = loadFleetSnapshot();
    expect(snap?.sessions).toHaveLength(1);
    expect(snap?.sessions[0]?.id).toBe('claude:OpenClawHetzner');
    expect(typeof snap?.savedAt).toBe('number');
  });

  it('returns null when absent or corrupt', () => {
    expect(loadFleetSnapshot()).toBeNull();
    window.localStorage.setItem('ccrc.fleet-snapshot.v1', 'not json');
    expect(loadFleetSnapshot()).toBeNull();
    window.localStorage.setItem('ccrc.fleet-snapshot.v1', '{"savedAt":"no","sessions":{}}');
    expect(loadFleetSnapshot()).toBeNull();
  });
});

describe('fleet store hydration + persistence', () => {
  it('hydrates sessions from the snapshot at boot, still connecting', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['claude:OpenClawHetzner']);
    expect(store.getState().conn).toBe('connecting');
  });

  it('persists each live fleet message as the new snapshot', () => {
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    store.getState().connect();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.message(JSON.stringify({ type: 'fleet', sessions: [session('claude2:mekwarlive')] }));

    expect(store.getState().sessions.map((s) => s.id)).toEqual(['claude2:mekwarlive']);
    expect(loadFleetSnapshot()?.sessions.map((s) => s.id)).toEqual(['claude2:mekwarlive']);
    store.getState().disconnect();
  });
});

describe('FleetScreen stale marking', () => {
  it('shows hydrated cards behind a last-known banner while connecting', () => {
    saveFleetSnapshot([session('claude:OpenClawHetzner')]);
    const store = createFleetStore({ makeSocket: (url) => new FakeSocket(url) as unknown as WebSocket });
    render(createElement(FleetScreen, { store }));

    // Instant content from the snapshot, clearly marked stale.
    expect(screen.getByText('OpenClawHetzner')).toBeInTheDocument();
    expect(screen.getByText('Last known state — connecting…')).toBeInTheDocument();

    // Socket opens with a live snapshot: the stale banner goes away.
    act(() => {
      const sock = FakeSocket.instances[0]!;
      sock.open();
      sock.message(JSON.stringify({ type: 'fleet', sessions: [session('claude:OpenClawHetzner')] }));
    });
    expect(screen.queryByText('Last known state — connecting…')).not.toBeInTheDocument();
  });
});
