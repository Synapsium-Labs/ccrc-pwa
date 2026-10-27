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
const health = (agentUp: boolean): FleetHealth => ({ agentUp, builds: {} } as unknown as FleetHealth);

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
});
