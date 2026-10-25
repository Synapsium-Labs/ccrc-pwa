// usePoll — the PWA's ONE poll primitive (ARCH-30, #544): the newest ISSUED request is authoritative, the page
// becoming visible re-polls, `pollMs <= 0` is the injected mode, `pollMs: null` polls once and on visibility only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePoll, type PollOutcome } from '../src/lib/usePoll';

const setVisibility = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

type Landed = { outcome: PollOutcome; issue: number };
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };

describe('usePoll', () => {
  it('requests on mount and again every pollMs', async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => Promise.resolve('x'));
    renderHook(() => usePoll({ pollMs: 1000, request, onOutcome: () => {} }));
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('hands a good answer and a rejection to onOutcome with the issue number', async () => {
    const landed: Landed[] = [];
    let n = 0;
    const request = (): Promise<unknown> => (++n === 1 ? Promise.resolve({ a: 1 }) : Promise.reject(new Error('boom')));
    const { result } = renderHook(() => usePoll({ pollMs: 60_000, request, onOutcome: (outcome, issue) => landed.push({ outcome, issue }) }));
    await flush();
    act(() => { result.current.reload(); });
    await flush();
    expect(landed.map((l) => [l.outcome.ok, l.issue])).toEqual([[true, 1], [false, 2]]);
  });

  it('lets only the newest issued request land: an older answer, good or bad, is dropped', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const queue = [first, second];
    const landed: Landed[] = [];
    const { result } = renderHook(() => usePoll({
      pollMs: 60_000, request: () => queue.shift()!.promise, onOutcome: (outcome, issue) => landed.push({ outcome, issue }),
    }));
    act(() => { result.current.reload(); });
    second.resolve('new');
    await flush();
    first.reject(new Error('old'));
    await flush();
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({ issue: 2, outcome: { ok: true, raw: 'new' } });
  });

  it('supersede() makes every request issued before it land stale', async () => {
    const d = deferred<unknown>();
    const landed: Landed[] = [];
    const { result } = renderHook(() => usePoll({ pollMs: 60_000, request: () => d.promise, onOutcome: (o, i) => landed.push({ outcome: o, issue: i }) }));
    act(() => { result.current.supersede(); });
    d.resolve('old');
    await flush();
    expect(landed).toEqual([]);
  });

  it('reload() returns the issue number it took', () => {
    const { result } = renderHook(() => usePoll({ pollMs: 60_000, request: () => new Promise(() => {}), onOutcome: () => {} }));
    let a = 0; let b = 0;
    act(() => { a = result.current.reload(); b = result.current.reload(); });
    expect([a, b]).toEqual([2, 3]);
  });

  it('re-polls when the page becomes visible, not when it becomes hidden', () => {
    const request = vi.fn(() => new Promise<unknown>(() => {}));
    renderHook(() => usePoll({ pollMs: 60_000, request, onOutcome: () => {} }));
    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('pollMs <= 0 is the injected mode: no request, no timer, no listener, reload() issues nothing and returns 0', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const request = vi.fn(() => Promise.resolve('x'));
    const { result } = renderHook(() => usePoll({ pollMs: 0, request, onOutcome: () => {} }));
    let issued = -1;
    act(() => { issued = result.current.reload(); });
    expect(issued).toBe(0);
    expect(request).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(0);
  });

  it('pollMs: null requests once and on visibility, with no interval', async () => {
    vi.useFakeTimers();
    const request = vi.fn(() => Promise.resolve('x'));
    renderHook(() => usePoll({ pollMs: null, request, onOutcome: () => {} }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(request).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('drops an answer that lands after unmount and removes its listener', async () => {
    const d = deferred<unknown>();
    const onOutcome = vi.fn();
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => usePoll({ pollMs: 60_000, request: () => d.promise, onOutcome }));
    unmount();
    d.resolve('late');
    await flush();
    expect(onOutcome).not.toHaveBeenCalled();
    expect(remove.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
  });

  it('keeps ONE listener across re-renders with a fresh callback identity', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const { rerender } = renderHook(() => usePoll({ pollMs: 60_000, request: () => new Promise(() => {}), onOutcome: () => {} }));
    rerender(); rerender();
    expect(add.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
  });
});
