// useProjectedHome distinguishes "no answer yet" from "the server said no" —
// the bug this task exists to fix collapsed both into `null`, which let a
// slow or failing /api/accounts poll paint "all accounts disabled" (see
// ProjectCard's addLabel) over a perfectly healthy fleet. These pin the hook's
// own contract directly, one JS value per fact.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { api } from '../src/lib/api';
import { useProjectedHome } from '../src/fleet/useProjectedHome';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useProjectedHome', () => {
  it('starts undefined — the first poll has not landed yet', () => {
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {})); // never settles
    const { result } = renderHook(() => useProjectedHome());
    expect(result.current).toBeUndefined();
  });

  it('carries the server\'s null through as null, not undefined', async () => {
    // The server's own "nothing is placeable" — every home-able lane
    // disabled — must render as a DIFFERENT value than "not known yet",
    // because ProjectCard gives the two different copy.
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster: [] });
    const { result } = renderHook(() => useProjectedHome());
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('carries a real projection through unchanged', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [], projected: { wrapper: 'claude', score: 18 }, roster: [],
    });
    const { result } = renderHook(() => useProjectedHome());
    await waitFor(() => expect(result.current).toEqual({ wrapper: 'claude', score: 18 }));
  });

  it('leaves the value exactly where it was when a poll fails — never forces null or undefined', async () => {
    // A rejected /api/accounts (offline, or the server restarting) must not
    // be indistinguishable from the server's own null: that would announce
    // "all accounts disabled" for a network hiccup, the mirror-image lie
    // Rider B exists to stop the `+` from telling.
    vi.spyOn(api, 'accounts').mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useProjectedHome());
    await act(() => new Promise<void>((r) => setTimeout(r, 0)));
    expect(result.current).toBeUndefined();
  });
});
