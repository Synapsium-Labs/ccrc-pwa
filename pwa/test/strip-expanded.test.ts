// The lanes strip's per-device memory (desktop polish S5b, D-6530): whether this device last chose the full strip over
// the fold. Absent means folded (the operator ruled the fold as the default), the opposite of foldState.ts, where absent
// means expanded; every failure of storage must read folded too, and a choice storage refuses must still hold for this page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { setStripExpanded, useStripExpanded } from '../src/fleet/stripExpanded';

const KEY = 'ccrc-accounts-strip';

// A spy on jsdom's `localStorage.setItem` does not intercept (the Storage object keeps methods on its prototype and
// treats an own-property write as an item), so the refusing storage is a stand-in swapped in for the window's own.
const realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
function refuseStorage(refuse: 'read' | 'write', seed: Record<string, string> = {}): void {
  const backing = new Map<string, string>(Object.entries(seed));
  const stub = {
    getItem: (k: string): string | null => {
      if (refuse === 'read') throw new Error('storage denied');
      return backing.get(k) ?? null;
    },
    setItem: (): void => {
      throw new Error('quota exceeded');
    },
    removeItem: (k: string): void => void backing.delete(k),
  };
  Object.defineProperty(window, 'localStorage', { value: stub, configurable: true });
}

afterEach(() => {
  cleanup();
  if (realStorage !== undefined) Object.defineProperty(window, 'localStorage', realStorage);
  vi.restoreAllMocks();
});

describe('what storage may say', () => {
  it('absent, malformed or unreadable storage reads folded', () => {
    const { result } = renderHook(() => useStripExpanded(true));
    expect(result.current).toBe(false);
    for (const raw of ['', 'true', '1', 'Expanded', 'expanded ', '{"expanded":true}']) {
      window.localStorage.setItem(KEY, raw);
      const { result: again } = renderHook(() => useStripExpanded(true));
      expect(again.current, JSON.stringify(raw)).toBe(false);
    }
    window.localStorage.removeItem(KEY);
    refuseStorage('read');
    const { result: unreadable } = renderHook(() => useStripExpanded(true));
    expect(unreadable.current).toBe(false);
  });

  it("only 'expanded' expands", () => {
    window.localStorage.setItem(KEY, 'folded');
    expect(renderHook(() => useStripExpanded(true)).result.current).toBe(false);
    window.localStorage.setItem(KEY, 'expanded');
    expect(renderHook(() => useStripExpanded(true)).result.current).toBe(true);
    act(() => setStripExpanded(false));
    expect(window.localStorage.getItem(KEY)).toBe('folded');
    act(() => setStripExpanded(true));
    expect(window.localStorage.getItem(KEY)).toBe('expanded');
  });

  it('a choice storage refuses still holds for this page', () => {
    refuseStorage('write');
    const { result } = renderHook(() => useStripExpanded(true));
    expect(result.current).toBe(false);
    act(() => setStripExpanded(true));
    expect(result.current).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(renderHook(() => useStripExpanded(true)).result.current).toBe(true);
  });
});

describe('a refused write', () => {
  it("makes this page's choice authoritative over a value storage still holds, until another tab writes the key", () => {
    // Reads work and writes are refused (a quota or policy error), with 'expanded' already stored.
    refuseStorage('write', { [KEY]: 'expanded' });
    const { result } = renderHook(() => useStripExpanded(true));
    expect(result.current).toBe(true);
    act(() => setStripExpanded(false));
    expect(result.current).toBe(false);
    expect(renderHook(() => useStripExpanded(true)).result.current).toBe(false);
    act(() => setStripExpanded(true));
    expect(result.current).toBe(true);
    act(() => setStripExpanded(false));
    expect(result.current).toBe(false);
    // Another tab's write to the key is storage speaking again: the page's refused choice no longer overrides it.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'expanded' }));
    });
    expect(result.current).toBe(true);
  });

  it('unreadable storage reads folded until this page chooses, and then the page choice holds', () => {
    refuseStorage('read');
    const { result } = renderHook(() => useStripExpanded(true));
    expect(result.current).toBe(false);
    act(() => setStripExpanded(true));
    expect(result.current).toBe(true);
    act(() => setStripExpanded(false));
    expect(result.current).toBe(false);
  });
});

describe('remembered and shared', () => {
  it('the choice survives a remount and a reload', async () => {
    const first = renderHook(() => useStripExpanded(true));
    act(() => setStripExpanded(true));
    first.unmount();
    expect(renderHook(() => useStripExpanded(true)).result.current).toBe(true);
    // A reload keeps storage and loses the page's own value: a fresh module reads what was stored. This relies on
    // `react` being externalised by the test runner, so the fresh module and `renderHook` share one React instance
    // across `vi.resetModules()`; were React inlined, the fresh import would bring its own and the hook would throw.
    vi.resetModules();
    const fresh = await import('../src/fleet/stripExpanded');
    const { result } = renderHook(() => fresh.useStripExpanded(true));
    expect(result.current).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe('expanded');
  });

  it('two strips agree', () => {
    const a = renderHook(() => useStripExpanded(true));
    const b = renderHook(() => useStripExpanded(true));
    expect([a.result.current, b.result.current]).toEqual([false, false]);
    act(() => setStripExpanded(true));
    expect([a.result.current, b.result.current]).toEqual([true, true]);
    act(() => setStripExpanded(false));
    expect([a.result.current, b.result.current]).toEqual([false, false]);
  });

  it('a storage event for ccrc-accounts-strip updates a mounted hook', () => {
    const { result } = renderHook(() => useStripExpanded(true));
    expect(result.current).toBe(false);
    act(() => {
      window.localStorage.setItem(KEY, 'expanded');
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'expanded' }));
    });
    expect(result.current).toBe(true);
    // Another key's write is not this hook's business; a cleared storage (a null key) is.
    act(() => {
      window.localStorage.setItem(KEY, 'folded');
      window.dispatchEvent(new StorageEvent('storage', { key: 'ccrc-something-else' }));
    });
    expect(result.current).toBe(true);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(result.current).toBe(false);
  });
});

describe('a disabled hook (the phone) touches nothing', () => {
  it('answers false although storage holds expanded', () => {
    window.localStorage.setItem(KEY, 'expanded');
    expect(renderHook(() => useStripExpanded(false)).result.current).toBe(false);
    expect(renderHook(() => useStripExpanded(true)).result.current).toBe(true);
  });

  it('never reads storage and adds no storage listener', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const add = vi.spyOn(window, 'addEventListener');
    const { result } = renderHook(() => useStripExpanded(false));
    expect(result.current).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(add.mock.calls.filter(([type]) => type === 'storage')).toEqual([]);
  });

  it('a storage event, or this page choosing, changes nothing in it', () => {
    window.localStorage.setItem(KEY, 'folded');
    const { result } = renderHook(() => useStripExpanded(false));
    act(() => {
      window.localStorage.setItem(KEY, 'expanded');
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'expanded' }));
    });
    expect(result.current).toBe(false);
    act(() => setStripExpanded(true));
    expect(result.current).toBe(false);
  });
});
