// Desktop polish Task C38 (D-8670; review 1709): `useDelegationAdoptView`'s `landed` and the Settings page's renders.
// The Settings frame holds each card's poll in a memo keyed by its fields (`SettingsDataProvider`), so a poll whose fields
// do not change re-renders nothing. A failed poll keeps the last good view and the same failure, as every other card's hook
// does, but this hook also moved `landed` on every read that landed: one failed poll a minute re-rendered the whole page.
// `landed` exists for one reader, the card's refocus, which waits for the read its own `reload()` issued. It now moves only
// when a read lands at or after the newest `reload()`, so an unasked failed poll leaves the poll's fields as they were.
//
// RED FIRST, measured 2026-11-16 against origin/main 0c573d7f3: the first row failed (`landed` went 1 to 2); the second
// passed there and pins the contract the card relies on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { api } from '../src/lib/api';
import { DELEGATION_ADOPT_POLL_MS, useDelegationAdoptView } from '../src/fleet/useDelegationAdoptView';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tick = async (ms: number): Promise<void> => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

describe('a failed poll nobody waits for changes none of the poll\'s fields (review 1709)', () => {
  it('two failed polls a minute apart: the view, the failure and `landed` are the same values', async () => {
    vi.spyOn(api, 'delegationAdopt').mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDelegationAdoptView());
    await tick(0);
    const first = result.current;
    expect(first.failure, 'CONTROL: the first poll failed').not.toBeNull();
    await tick(DELEGATION_ADOPT_POLL_MS);
    expect(api.delegationAdopt, 'CONTROL: the second poll was issued').toHaveBeenCalledTimes(2);
    expect(result.current.view).toBe(first.view);
    expect(result.current.failure).toBe(first.failure);
    expect(result.current.landed, 'a failed poll nobody asked for moved `landed`, which re-renders the Settings page')
      .toBe(first.landed);
  });

  it('a read the card asked for with `reload()` lands, failed or not, and so does a poll that overtook it', async () => {
    vi.spyOn(api, 'delegationAdopt').mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDelegationAdoptView());
    await tick(0);
    let issue = 0;
    act(() => { issue = result.current.reload(); });
    expect(issue).toBeGreaterThan(0);
    await tick(0);
    expect(result.current.landed, 'the asked read landed failed, and `landed` did not reach it').toBeGreaterThanOrEqual(issue);
    // An asked read overtaken by a newer poll never lands itself; the newer one stands for it.
    let held: (v: unknown) => void = () => undefined;
    vi.mocked(api.delegationAdopt).mockImplementationOnce(() => new Promise((_, no) => { held = no; }));
    let asked = 0;
    act(() => { asked = result.current.reload(); });
    await tick(DELEGATION_ADOPT_POLL_MS);
    held(new Error('late'));
    await tick(0);
    expect(result.current.landed, 'the poll that overtook the asked read did not count for it').toBeGreaterThanOrEqual(asked);
  });
});
