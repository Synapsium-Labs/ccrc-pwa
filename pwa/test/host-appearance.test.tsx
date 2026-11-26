// `useHostAppearance` and `appearanceStamp` (native Docs reader, appearance continuity, Task 3): the one stamp of the
// skin and palette the document root carries, kept by one shared MutationObserver. The root is what the frame must
// follow, not the stored choice: a "Follow the system" palette flips the root while the stored choice stays `system`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { applySkin, applyTheme } from '@ccrc/ui';
import { useHostAppearance } from '../src/lib/appearance';
import { appearanceStamp } from '../src/lib/appearanceStamp';
import { initTheme } from '../src/lib/theme';

const root = document.documentElement;
const reset = (): void => {
  root.removeAttribute('data-skin');
  root.removeAttribute('data-theme');
  root.removeAttribute('data-probe');
  root.removeAttribute('lang');
};
beforeEach(() => { reset(); localStorage.clear(); });
afterEach(() => { cleanup(); reset(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Let the observer's microtask run, inside act. */
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };

describe('useHostAppearance', () => {
  it('renders the current stamp', () => {
    applySkin('instrument', root);
    applyTheme('nord', root, false);
    const { result } = renderHook(() => useHostAppearance());
    expect(result.current).toBe('instrument|nord');
  });

  it("applyTheme('nord', root, false) re-renders with |nord", async () => {
    const { result } = renderHook(() => useHostAppearance());
    expect(result.current).toBe('|');
    act(() => { applyTheme('nord', root, false); });
    await flush();
    expect(result.current).toBe('|nord');
  });

  it("applySkin('instrument', root) re-renders with instrument|", async () => {
    const { result } = renderHook(() => useHostAppearance());
    act(() => { applySkin('instrument', root); });
    await flush();
    expect(result.current).toBe('instrument|');
  });

  it('a system flip moves the stamp: with stored choice system, initTheme given a media query that flips to light moves it to |light', async () => {
    let onChange: ((e: { matches: boolean }) => void) | null = null;
    const mq = {
      matches: false,
      addEventListener: (_t: 'change', cb: (e: { matches: boolean }) => void) => { onChange = cb; },
    };
    initTheme(mq); // nothing stored: the choice is `system`, and the OS answers dark
    expect(localStorage.getItem('ccrc-theme')).toBeNull();
    const { result } = renderHook(() => useHostAppearance());
    expect(result.current).toBe('|');
    expect(onChange).not.toBeNull();
    act(() => { onChange!({ matches: true }); }); // the OS flips to light; the stored choice does not move
    await flush();
    expect(localStorage.getItem('ccrc-theme')).toBeNull();
    expect(result.current).toBe('|light');
  });

  it('a change to any other attribute does not re-render', async () => {
    let renders = 0;
    renderHook(() => { renders += 1; return useHostAppearance(); });
    const before = renders;
    act(() => { root.setAttribute('data-probe', 'x'); root.setAttribute('lang', 'fr'); });
    await flush();
    expect(renders).toBe(before);
    root.removeAttribute('lang');
  });

  it('unmounting the last subscriber disconnects the observer, and one observer serves every subscriber', async () => {
    const live: { observed: boolean; disconnects: number }[] = [];
    const Real = globalThis.MutationObserver;
    class Spy extends Real {
      readonly rec = { observed: false, disconnects: 0 };
      constructor(cb: MutationCallback) { super(cb); live.push(this.rec); }
      override observe(target: Node, options?: MutationObserverInit): void { this.rec.observed = true; super.observe(target, options); }
      override disconnect(): void { this.rec.disconnects += 1; super.disconnect(); }
    }
    vi.stubGlobal('MutationObserver', Spy);
    const a = renderHook(() => useHostAppearance());
    const b = renderHook(() => useHostAppearance());
    expect(live).toHaveLength(1); // created on the first subscribe, shared by the second
    expect(live[0]!.observed).toBe(true);
    a.unmount();
    expect(live[0]!.disconnects).toBe(0); // one subscriber left
    b.unmount();
    expect(live[0]!.disconnects).toBe(1); // the last one left
    renderHook(() => useHostAppearance());
    expect(live).toHaveLength(2); // a later subscriber gets a fresh observer
  });

  it('observes the two stamps only (attributeFilter)', () => {
    const seen: (MutationObserverInit | undefined)[] = [];
    const Real = globalThis.MutationObserver;
    class Spy extends Real {
      override observe(target: Node, options?: MutationObserverInit): void { seen.push(options); super.observe(target, options); }
    }
    vi.stubGlobal('MutationObserver', Spy);
    renderHook(() => useHostAppearance());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.attributeFilter).toEqual(['data-skin', 'data-theme']);
  });

  it("one stamp: for each data-skin and data-theme root, the hook answers exactly appearanceStamp(root)", () => {
    for (const skin of ['', 'instrument', 'refined']) {
      for (const theme of ['', 'nord']) {
        reset();
        if (skin !== '') root.setAttribute('data-skin', skin);
        if (theme !== '') root.setAttribute('data-theme', theme);
        const { result, unmount } = renderHook(() => useHostAppearance());
        expect(result.current).toBe(appearanceStamp(root));
        expect(result.current).toBe(`${skin}|${theme}`);
        unmount();
      }
    }
  });
});
