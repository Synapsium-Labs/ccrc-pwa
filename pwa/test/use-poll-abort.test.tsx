// Console speed, task C1 (the link and the start): `usePoll` hands each read an `AbortSignal`, aborted when the hook
// unmounts and when `supersede()` drops the reads issued before it. An aborted read lands nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePoll, type PollOutcome } from '../src/lib/usePoll';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };

/** A request that settles only when its signal aborts (as `fetch` does), recording each signal it was handed. */
const abortable = () => {
  const signals: AbortSignal[] = [];
  const request = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<unknown>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  });
  return { request, signals };
};

describe('usePoll aborts what it no longer wants', () => {
  it('unmount aborts the read in flight', () => {
    const { request, signals } = abortable();
    const { unmount } = renderHook(() => usePoll({ pollMs: 60_000, request, onOutcome: () => {} }));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    unmount();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('supersede aborts the older read', () => {
    const { request, signals } = abortable();
    const { result } = renderHook(() => usePoll({ pollMs: 60_000, request, onOutcome: () => {} }));
    act(() => { result.current.supersede(); });
    expect(signals[0]?.aborted).toBe(true);
    act(() => { result.current.reload(); });
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted, 'a read issued after the supersede is untouched').toBe(false);
  });

  it('a newer poll does not abort an older read: only the newest lands, as before', () => {
    const { request, signals } = abortable();
    const { result } = renderHook(() => usePoll({ pollMs: 60_000, request, onOutcome: () => {} }));
    act(() => { result.current.reload(); });
    expect(signals.map((s) => s.aborted)).toEqual([false, false]);
  });

  it('an aborted read lands no outcome', async () => {
    const landed: PollOutcome[] = [];
    const { request } = abortable();
    const { result, unmount } = renderHook(() => usePoll({ pollMs: 60_000, request, onOutcome: (o) => landed.push(o) }));
    act(() => { result.current.supersede(); });
    await flush();
    unmount();
    await flush();
    expect(landed).toEqual([]);
  });

  it('a read that settles normally lands, and its signal is never aborted afterwards', async () => {
    const landed: PollOutcome[] = [];
    const signals: AbortSignal[] = [];
    const request = (signal: AbortSignal): Promise<unknown> => { signals.push(signal); return Promise.resolve('x'); };
    const { unmount } = renderHook(() => usePoll({ pollMs: 60_000, request, onOutcome: (o) => landed.push(o) }));
    await flush();
    expect(landed).toEqual([{ ok: true, raw: 'x' }]);
    unmount();
    expect(signals[0]?.aborted, 'a settled read is no longer in flight').toBe(false);
  });

  it('a request lambda that ignores the signal still works', async () => {
    const landed: PollOutcome[] = [];
    const request = (): Promise<unknown> => Promise.resolve({ a: 1 });
    renderHook(() => usePoll({ pollMs: 60_000, request, onOutcome: (o) => landed.push(o) }));
    await flush();
    expect(landed).toEqual([{ ok: true, raw: { a: 1 } }]);
  });
});
