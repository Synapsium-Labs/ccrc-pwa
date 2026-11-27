// Fold state is a layout preference: every failure mode must resolve to
// "everything expanded", never to a fleet the reader cannot see.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import {
  loadFolded, loadRollupPrefs, resetLandingLineOpen, saveFolded, toggleLandingLineOpen, useFolded, useLandingLineOpen, useRollupPrefs,
} from '../src/fleet/foldState';
import { NO_ROLLUP_PREFS, toggleChildren } from '../src/fleet/rollup';

const KEY = 'ccrc.fleet-folded.v1';

beforeEach(() => { window.localStorage.clear(); });
// Final-round gates review, finding 7. `renderHook` below mounts into
// `document.body`, and this suite has no vitest `globals`, so RTL's automatic
// per-test cleanup (which is wired to a global `afterEach`) is NOT active
// here. Without an explicit `cleanup()` the mounted hosts accumulate across
// tests in this file and a later test can read state a previous one left
// behind — passing for the wrong reason. `cleanup()` first: it unmounts, and
// unmounting must not be looking at mocks `restoreAllMocks` has already
// removed (the saveFolded test spies on `localStorage.setItem`).
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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

  // Finding 7's actual hazard, made visible. Both tests above end with
  // 'alpha' persisted in localStorage; `beforeEach` clears the storage, but
  // nothing unmounted the hooks. A fresh hook must read the CLEARED storage —
  // if a previous test's mounted host were still live and its state observable
  // here, "starts empty" would be indistinguishable from "the fold leaked".
  it('starts from empty storage and an empty document, not from what the previous test mounted', () => {
    // Nothing the two tests above mounted is still attached. Without the
    // explicit `cleanup()`, their `renderHook` containers are all still in
    // `document.body` when this runs (RTL's `unmount()` tears down the React
    // tree but leaves the host div behind), and this reads 3.
    expect(document.body.childElementCount).toBe(0);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    const { result } = renderHook(() => useFolded());
    expect([...result.current[0]]).toEqual([]);
  });
});

// D-6088: the rollup preferences fail the same way — to NO preferences, which is the default rule (a quiet project
// rolled up, an active one open, an operator-facing question never hidden), never to a stored state nobody chose.
describe('loadRollupPrefs (D-6088)', () => {
  const RKEY = 'ccrc.fleet-rollup.v1';
  it('reads an absent, corrupt or wrongly shaped store as no preferences', () => {
    expect(loadRollupPrefs()).toEqual(NO_ROLLUP_PREFS);
    window.localStorage.setItem(RKEY, '{not json');
    expect(loadRollupPrefs()).toEqual(NO_ROLLUP_PREFS);
    window.localStorage.setItem(RKEY, '[1,2]');
    expect(loadRollupPrefs()).toEqual({ projects: {}, openChildren: [] });
  });

  it('keeps the well-formed entries and drops the junk, field by field', () => {
    window.localStorage.setItem(RKEY, JSON.stringify({
      projects: { a: { collapsed: false, cls: 'inactive' }, b: { collapsed: 'yes', cls: 'inactive' }, c: { collapsed: true, cls: 'busy' } },
      openChildren: ['coord', 7, null],
    }));
    expect(loadRollupPrefs()).toEqual({ projects: { a: { collapsed: false, cls: 'inactive' } }, openChildren: ['coord'] });
  });

  it('persists an update and writes nothing for an update that changes nothing', () => {
    const { result } = renderHook(() => useRollupPrefs());
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    act(() => result.current[1]((p) => p));
    expect(setItem).not.toHaveBeenCalled();
    act(() => result.current[1]((p) => toggleChildren(p, 'coord')));
    expect(JSON.parse(window.localStorage.getItem(RKEY) ?? 'null')).toEqual({ projects: {}, openChildren: ['coord'] });
  });
});

// Desktop polish wave 192: the landing block's fold. Absent is rolled up; kept in memory for the page's life, never in
// the browser, so a reload starts every block rolled up.
describe('the landing line\'s fold (wave 192)', () => {
  beforeEach(resetLandingLineOpen);
  it('rolled up until toggled, per project; a second toggle rolls it up again', () => {
    const { result } = renderHook(() => useLandingLineOpen());
    expect([...result.current]).toEqual([]);
    act(() => toggleLandingLineOpen('project-a'));
    expect([...result.current]).toEqual(['project-a']);
    act(() => toggleLandingLineOpen('project-b'));
    expect([...result.current].sort()).toEqual(['project-a', 'project-b']);
    act(() => toggleLandingLineOpen('project-a'));
    expect([...result.current]).toEqual(['project-b']);
  });
  it('the choice outlives the hook that read it: a new reader sees it', () => {
    const first = renderHook(() => useLandingLineOpen());
    act(() => toggleLandingLineOpen('project-a'));
    first.unmount();
    const second = renderHook(() => useLandingLineOpen());
    expect(second.result.current.has('project-a')).toBe(true);
  });
  it('a toggle writes nothing to the browser\'s storage', () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    act(() => toggleLandingLineOpen('project-a'));
    act(() => toggleLandingLineOpen('project-b'));
    expect(local).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
  it('a reload (the module evaluated afresh) starts rolled up after a toggle', async () => {
    act(() => toggleLandingLineOpen('project-a'));
    vi.resetModules();
    // Fresh copies of the testing library and React with it, so the fresh module's hook runs under its own React.
    const rtl = await import('@testing-library/react');
    const fresh = await import('../src/fleet/foldState');
    const { result, unmount } = rtl.renderHook(() => fresh.useLandingLineOpen());
    expect(result.current.size).toBe(0);
    unmount();
  });
});
