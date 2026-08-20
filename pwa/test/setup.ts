import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Radix's FocusScope returns focus on unmount from a `setTimeout(..., 0)`
// (@radix-ui/react-focus-scope dist/index.mjs, the unmount CustomEvent). A
// test whose LAST render mounted a focus scope therefore leaves a pending
// macrotask behind, and when the file's jsdom is torn down before it fires,
// the callback constructs a CustomEvent in one realm and dispatches it at a
// container from another — vitest reports `dispatchEvent: parameter 1 is not
// of type 'Event'` as an unhandled error and FAILS THE JOB with every test
// green (seen on CI 2026-08-19 and twice on 2026-08-20, always attributed to
// whichever file ran a Radix dialog last — draft-conflict.test.tsx both
// times). The fix is to let that timer fire while this file's realm is still
// alive: unmount now (idempotent — a file's own `afterEach(cleanup)` just
// no-ops after this), then yield one macrotask so every 0 ms timer the
// unmount scheduled runs before the environment can go away. Under fake
// timers the yield would never resolve, so pending timers are run inside
// fake time instead; files that restore real timers in their own afterEach
// ran it already — vitest's stack hook order runs this setup-registered hook
// last.
afterEach(async () => {
  cleanup();
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});

// jsdom gaps touched by vaul/radix (the Sheet primitive). All guarded so a
// future jsdom that implements them wins automatically.
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  window.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;

  // Node 22+ ships an experimental bare `localStorage` global (undefined
  // without --localstorage-file) that shadows jsdom's Storage when vitest
  // merges the jsdom window onto globalThis. Shim an in-memory Storage when
  // the merged one is unusable; a working implementation wins automatically.
  const storageUsable = ((): boolean => {
    try {
      return typeof window.localStorage?.setItem === 'function';
    } catch {
      return false;
    }
  })();
  if (!storageUsable) {
    const backing = new Map<string, string>();
    const memStorage: Storage = {
      get length() {
        return backing.size;
      },
      clear: () => backing.clear(),
      getItem: (k: string) => backing.get(k) ?? null,
      key: (i: number) => [...backing.keys()][i] ?? null,
      removeItem: (k: string) => void backing.delete(k),
      setItem: (k: string, v: string) => void backing.set(k, String(v)),
    };
    Object.defineProperty(window, 'localStorage', {
      value: memStorage,
      configurable: true,
      writable: true,
    });
  }

  window.HTMLElement.prototype.scrollIntoView ??= function scrollIntoView(): void {};
  window.HTMLElement.prototype.setPointerCapture ??= function setPointerCapture(): void {};
  window.HTMLElement.prototype.releasePointerCapture ??= function releasePointerCapture(): void {};
  window.HTMLElement.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
}

// jsdom has neither object URLs nor an image decoder.
let objectUrlSeq = 0;
URL.createObjectURL = vi.fn(() => `blob:mock/${++objectUrlSeq}`);
URL.revokeObjectURL = vi.fn();
globalThis.createImageBitmap = vi.fn(async () =>
  ({ width: 2788, height: 442, close: () => {} }) as unknown as ImageBitmap);
