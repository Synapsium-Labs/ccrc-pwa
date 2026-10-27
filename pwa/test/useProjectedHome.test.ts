// useProjectedHome distinguishes "no answer yet" from "the server said no" —
// the bug this task exists to fix collapsed both into `null`, which let a
// slow or failing /api/accounts poll paint "all accounts disabled" (see
// ProjectCard's addLabel) over a perfectly healthy fleet. These pin the hook's
// own contract directly, one JS value per fact.
//
// C8 (D-6440): the hook reads the fleet store's `projected`, which the store's
// one poll writes, so each case drives a store's read (`refreshAccounts`) with
// an injected `fetchAccounts`, and `api.accounts` is a spy that must never run.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { AccountsResponse } from '../../shared/api';
import { api } from '../src/lib/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { useAccountUsage, useProjectedHome } from '../src/fleet/useProjectedHome';

let accountsSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  accountsSpy = vi.spyOn(api, 'accounts').mockRejectedValue(new Error('the hook must not call the route'));
});

afterEach(() => {
  // No hook ever reads the route itself: the store is the one reader.
  expect(accountsSpy).not.toHaveBeenCalled();
  cleanup();
  vi.restoreAllMocks();
});

/** A store whose read answers `answer` (or rejects with it), never connected: each case reads it when it says so. */
function storeAnswering(answer: () => Promise<AccountsResponse>): FleetStore {
  return createFleetStore({ fetchAccounts: answer, makeSocket: () => { throw new Error('no socket in this file'); } });
}
const read = async (store: FleetStore): Promise<void> => { await act(() => store.getState().refreshAccounts()); };

describe('useProjectedHome', () => {
  it('starts undefined — the first poll has not landed yet', () => {
    const store = storeAnswering(() => new Promise(() => {})); // never settles
    const { result } = renderHook(() => useProjectedHome(true, store));
    expect(result.current).toBeUndefined();
  });

  it('carries the server\'s null through as null, not undefined', async () => {
    // The server's own "nothing is placeable" — every home-able lane
    // disabled — must render as a DIFFERENT value than "not known yet",
    // because ProjectCard gives the two different copy.
    const store = storeAnswering(async () => ({ accounts: [], projected: null, roster: [] }));
    const { result } = renderHook(() => useProjectedHome(true, store));
    await read(store);
    expect(result.current).toBeNull();
  });

  it('carries a real projection through unchanged', async () => {
    const store = storeAnswering(async () => ({ accounts: [], projected: { wrapper: 'claude', score: 18 }, roster: [] }));
    const { result } = renderHook(() => useProjectedHome(true, store));
    await read(store);
    expect(result.current).toEqual({ wrapper: 'claude', score: 18 });
  });

  it('leaves the value exactly where it was when a poll fails — never forces null or undefined', async () => {
    // A rejected /api/accounts (offline, or the server restarting) must not
    // be indistinguishable from the server's own null: that would announce
    // "all accounts disabled" for a network hiccup, the mirror-image lie
    // Rider B exists to stop the `+` from telling.
    const store = storeAnswering(async () => { throw new Error('network down'); });
    const { result } = renderHook(() => useProjectedHome(true, store));
    await read(store);
    expect(result.current).toBeUndefined();
  });

  it('keeps the last good projection across a malformed answer (one reader, one rule)', async () => {
    let good = true;
    const store = storeAnswering(async () => (good
      ? { accounts: [], projected: { wrapper: 'claude', score: 18 }, roster: [] }
      : ({ accounts: [], projected: 'nope', roster: [] } as unknown as AccountsResponse)));
    const { result } = renderHook(() => useProjectedHome(true, store));
    await read(store);
    const landed = result.current;
    good = false;
    await read(store);
    expect(result.current).toBe(landed);
  });

  it('reads the app-wide store when no store is passed', () => {
    const { result } = renderHook(() => useProjectedHome());
    // The app-wide store has not read anything in this file: its own "no answer yet".
    expect(result.current).toBeUndefined();
  });

  // Review fix round 1, Minor 2 (Task 13): `active` is the caller's `open`, for
  // a caller (`StartProgramSheet`) mounted unconditionally at screen level,
  // the same shape `useAccountUsage`'s own `active` param already covers.
  describe('active (Task 13 review fix round 1, Minor 2)', () => {
    it('defaults to true — a caller with no argument reads the store\'s answer', async () => {
      const store = storeAnswering(async () => ({ accounts: [], projected: { wrapper: 'claude', score: 5 }, roster: [] }));
      await read(store);
      const { result } = renderHook(() => useProjectedHome(undefined, store));
      expect(result.current).toEqual({ wrapper: 'claude', score: 5 });
    });

    it('renders undefined while inactive — never the server\'s own null, which it never asked for', async () => {
      const store = storeAnswering(async () => ({ accounts: [], projected: null, roster: [] }));
      await read(store);
      expect(store.getState().projected).toBeNull();
      const { result } = renderHook(() => useProjectedHome(false, store));
      expect(result.current).toBeUndefined();
    });

    it('answers the store\'s value the moment active flips true, and undefined the moment it flips back', async () => {
      const store = storeAnswering(async () => ({ accounts: [], projected: { wrapper: 'claude', score: 5 }, roster: [] }));
      await read(store);
      const { result, rerender } = renderHook(({ active }) => useProjectedHome(active, store), {
        initialProps: { active: false },
      });
      expect(result.current).toBeUndefined();
      rerender({ active: true });
      expect(result.current).toEqual({ wrapper: 'claude', score: 5 });
      rerender({ active: false });
      expect(result.current).toBeUndefined();
    });
  });
});

describe('useAccountUsage', () => {
  const row = { wrapper: 'claude', five: 10, seven: 20, ts: 1, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false };

  it('answers null while inactive, and the store\'s rows while active', async () => {
    const store = storeAnswering(async () => ({ accounts: [row], projected: null, roster: [] }));
    await read(store);
    const { result, rerender } = renderHook(({ active }) => useAccountUsage(active, store), { initialProps: { active: false } });
    expect(result.current).toBeNull();
    rerender({ active: true });
    expect(result.current).toEqual([row]);
  });

  it('keeps the last good rows across a malformed answer (one reader, one rule)', async () => {
    let good = true;
    const store = storeAnswering(async () => (good
      ? { accounts: [row], projected: null, roster: [] }
      : ({ accounts: 'nope', projected: null, roster: [] } as unknown as AccountsResponse)));
    const { result } = renderHook(() => useAccountUsage(true, store));
    await read(store);
    const landed = result.current;
    expect(landed).toEqual([row]);
    good = false;
    await read(store);
    expect(result.current).toBe(landed);
  });
});
