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

  // Review fix round 1, Minor 2 (Task 13): `active` gates the poll for a
  // caller (`StartProgramSheet`) mounted unconditionally at screen level,
  // the same shape `useDisabledWrappers`'s own `active` param already
  // covers one function down in the source file.
  describe('active (Task 13 review fix round 1, Minor 2)', () => {
    it('defaults to true — every pre-existing caller (no argument) keeps polling exactly as before', () => {
      const accounts = vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
      renderHook(() => useProjectedHome());
      expect(accounts).toHaveBeenCalledTimes(1);
    });

    it('never calls /api/accounts while inactive', async () => {
      const accounts = vi.spyOn(api, 'accounts').mockResolvedValue({
        accounts: [], projected: { wrapper: 'claude', score: 5 }, roster: [],
      });
      renderHook(() => useProjectedHome(false));
      await act(() => new Promise<void>((r) => setTimeout(r, 0)));
      expect(accounts).not.toHaveBeenCalled();
    });

    it('renders undefined while inactive — never the server\'s own null, which it never asked for', async () => {
      vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [], projected: null, roster: [] });
      const { result } = renderHook(() => useProjectedHome(false));
      await act(() => new Promise<void>((r) => setTimeout(r, 0)));
      expect(result.current).toBeUndefined();
    });

    it('starts polling the moment active flips true, and stops the moment it flips back', async () => {
      const accounts = vi.spyOn(api, 'accounts').mockResolvedValue({
        accounts: [], projected: { wrapper: 'claude', score: 5 }, roster: [],
      });
      const { result, rerender } = renderHook(({ active }) => useProjectedHome(active), {
        initialProps: { active: false },
      });
      expect(accounts).not.toHaveBeenCalled();

      rerender({ active: true });
      await waitFor(() => expect(result.current).toEqual({ wrapper: 'claude', score: 5 }));
      expect(accounts).toHaveBeenCalledTimes(1);

      rerender({ active: false });
      expect(result.current).toBeUndefined();
      const callsAtDeactivation = accounts.mock.calls.length;
      await act(() => new Promise<void>((r) => setTimeout(r, 0)));
      expect(accounts).toHaveBeenCalledTimes(callsAtDeactivation); // no further poll once inactive
    });
  });
});
