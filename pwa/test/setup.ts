import '@testing-library/jest-dom/vitest';

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
