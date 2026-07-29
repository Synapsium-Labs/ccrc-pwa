// Fold state is a layout preference: every failure mode must resolve to
// "everything expanded", never to a fleet the reader cannot see.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { loadFolded, saveFolded, useFolded } from '../src/fleet/foldState';

const KEY = 'ccrc.fleet-folded.v1';

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('loadFolded', () => {
  it('returns an empty set when nothing is stored — a first run opens everything', () => {
    expect([...loadFolded()]).toEqual([]);
  });

  it('reads back what saveFolded wrote', () => {
    saveFolded(new Set(['alpha', 'beta']));
    expect([...loadFolded()].sort()).toEqual(['alpha', 'beta']);
  });

  it('returns empty on unparseable JSON rather than throwing', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect([...loadFolded()]).toEqual([]);
  });

  it('returns empty when the stored value is not an array', () => {
    window.localStorage.setItem(KEY, '{"alpha":true}');
    expect([...loadFolded()]).toEqual([]);
  });

  it('drops non-string members rather than admitting them to the set', () => {
    // A `folded.has(project)` against a set holding 7 or null cannot match, but
    // it would round-trip the junk back into storage on the next toggle.
    window.localStorage.setItem(KEY, '["alpha", 7, null, "beta"]');
    expect([...loadFolded()].sort()).toEqual(['alpha', 'beta']);
  });
});

describe('saveFolded', () => {
  it('swallows a storage failure — a fold that cannot be saved still folds', () => {
    // Private mode and quota walls both throw here. saveFleetSnapshot has the
    // same contract (lib/offline.ts).
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveFolded(new Set(['alpha']))).not.toThrow();
  });
});

describe('useFolded', () => {
  it('toggles a project in and out of the set', () => {
    const { result } = renderHook(() => useFolded());
    act(() => { result.current[1]('alpha'); });
    expect(result.current[0].has('alpha')).toBe(true);
    act(() => { result.current[1]('alpha'); });
    expect(result.current[0].has('alpha')).toBe(false);
  });

  it('survives a remount — this is the whole point of the module', () => {
    const first = renderHook(() => useFolded());
    act(() => { first.result.current[1]('alpha'); });
    first.unmount();
    const second = renderHook(() => useFolded());
    expect(second.result.current[0].has('alpha')).toBe(true);
  });
});
