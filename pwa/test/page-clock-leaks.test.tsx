// The page clock's leak rows (D-7191; W7 C7m; Review focus 10, "a listener that never unsubscribes"): 100 of each
// caller mounted and unmounted, or connected and disconnected, leave no `visibilitychange` or `online` listener.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { usePoll, useWhenVisible } from '../src/lib/usePoll';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore } from '../src/stores/session';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Live listeners of the clock's two events, counted from add and remove calls since the spies were set. */
const liveListeners = (): (() => { visibilitychange: number; online: number }) => {
  const docAdd = vi.spyOn(document, 'addEventListener');
  const docRemove = vi.spyOn(document, 'removeEventListener');
  const winAdd = vi.spyOn(window, 'addEventListener');
  const winRemove = vi.spyOn(window, 'removeEventListener');
  const net = (add: typeof docAdd, remove: typeof docRemove, type: string): number =>
    add.mock.calls.filter(([t]) => t === type).length - remove.mock.calls.filter(([t]) => t === type).length;
  return () => ({ visibilitychange: net(docAdd, docRemove, 'visibilitychange'), online: net(winAdd, winRemove, 'online') });
};

class FakeSocket {
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  send(): void {}
  close(): void {}
}
const makeSocket = (): WebSocket => new FakeSocket() as unknown as WebSocket;

describe('the page clock leaves no listener behind', () => {
  it('100 usePoll and useWhenVisible hooks mounted and unmounted leave zero listeners', () => {
    const live = liveListeners();
    const hooks = Array.from({ length: 100 }, () => renderHook(() => {
      usePoll({ pollMs: 60_000, request: () => new Promise(() => {}), onOutcome: () => {} });
      useWhenVisible(() => {});
    }));
    expect(live()).toEqual({ visibilitychange: 1, online: 0 });
    for (const h of hooks) h.unmount();
    expect(live()).toEqual({ visibilitychange: 0, online: 0 });
  });

  it('100 fleet and session stores connected and disconnected leave zero listeners', () => {
    vi.useFakeTimers();
    const live = liveListeners();
    const stores = Array.from({ length: 100 }, (_, i) => [
      createFleetStore({ makeSocket }),
      createSessionStore(`session-${i}`, { makeSocket }),
    ] as const);
    for (const [fleet, session] of stores) { fleet.getState().connect(); session.getState().connect(); }
    expect(live()).toEqual({ visibilitychange: 1, online: 1 });
    for (const [fleet, session] of stores) { fleet.getState().disconnect(); session.getState().disconnect(); }
    expect(live()).toEqual({ visibilitychange: 0, online: 0 });
  });
});
