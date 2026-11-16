// `useFleetHealth` (C8, D-6440): one poll of /api/fleet/health, and an answer equal to the last keeps the previous
// object, so the banner and BuildLine that read it re-render only when the fleet's health actually moves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { FleetHealth } from '../../shared/api';
import { api } from '../src/lib/api';
import { useFleetHealth } from '../src/fleet/useFleetHealth';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A NEW object on every call, as a JSON body is. */
const health = (agentUp: boolean): FleetHealth => ({ agentUp } as unknown as FleetHealth);

describe('useFleetHealth', () => {
  it('an equal health answer keeps the previous object (===)', async () => {
    vi.useFakeTimers();
    let up = true;
    vi.spyOn(api, 'fleetHealth').mockImplementation(async () => health(up));
    const { result } = renderHook(() => useFleetHealth(1_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const first = result.current;
    expect(first).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(api.fleetHealth).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(first);
    // A changed answer still replaces it.
    up = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current).not.toBe(first);
    expect(result.current).toEqual(health(false));
  });

  // W7 C7m (D-7191): the request schedule, held across the move onto usePoll with refetchOnVisible: false. Today's
  // hook never re-polls when the page becomes visible.
  it('the request schedule: one on mount, one per interval, none on a return to the page', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'fleetHealth').mockImplementation(async () => health(true));
    renderHook(() => useFleetHealth(1_000));
    expect(api.fleetHealth).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(api.fleetHealth).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    Reflect.deleteProperty(document, 'visibilityState');
    expect(api.fleetHealth).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(api.fleetHealth).toHaveBeenCalledTimes(4);
  });

  it('a late answer is dropped: an older request answered after a newer one never replaces it', async () => {
    vi.useFakeTimers();
    const answers: ((h: FleetHealth) => void)[] = [];
    vi.spyOn(api, 'fleetHealth').mockImplementation(() => new Promise<FleetHealth>((res) => { answers.push(res); }));
    const { result } = renderHook(() => useFleetHealth(1_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(answers).toHaveLength(2);
    await act(async () => { answers[1]!(health(false)); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toEqual(health(false));
    await act(async () => { answers[0]!(health(true)); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toEqual(health(false));
  });

  it('a failed request leaves the last answer, and an injected consumer (pollMs <= 0) never requests', async () => {
    vi.useFakeTimers();
    let fail = false;
    vi.spyOn(api, 'fleetHealth').mockImplementation(async () => { if (fail) throw new Error('down'); return health(true); });
    const { result } = renderHook(() => useFleetHealth(1_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const first = result.current;
    fail = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current).toBe(first);
    cleanup();
    vi.mocked(api.fleetHealth).mockClear();
    renderHook(() => useFleetHealth(0));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(api.fleetHealth).not.toHaveBeenCalled();
  });
});
