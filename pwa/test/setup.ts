import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { useFleetStore } from '../src/stores/fleet';

// THE MODULE-LEVEL FLEET SOCKET IS TORN DOWN AFTER EVERY TEST.
//
// `useFleetStore` is a singleton, and `<App/>`'s mount effect connects it. A
// test that renders the shell and never disconnects therefore leaves a live
// `ReconnectingSocket` climbing its backoff ladder against jsdom's absent
// server for the rest of the file — and since Stage 3a that socket also asks
// `GET /api/auth/status` on every failed attempt (`lib/ws.ts`'s AuthGate). A
// later test in the same file that stubs `fetch` gets answered by a component
// it is not testing.
//
// That is not hypothetical: it is how `auth-login.test.tsx`'s TerminalDrawer
// probe test passed with the drawer's own `checkAuth()` DELETED — the leaked
// fleet socket raised auth-lost instead. The fix lived in that file's own
// `afterEach` for one round; it belongs here, because the hazard's real shape
// is "a suite nobody has written yet renders `<App/>` and stubs `fetch`", which
// no per-file fix can reach. (`app.test.tsx` renders the shell too and leaks
// the same socket today; it stubs no `fetch`, so it has no symptom — but it is
// one `vi.stubGlobal` away from one.)
//
// A no-op wherever nothing connected: `disconnect()` on an unconnected store
// removes two listeners that were never added and returns. It is deliberately
// the FIRST thing in this file's teardown and this file's only `src/` import —
// a global hook that reached further into the app would be a fixture pretending
// to be a harness.
afterEach(() => {
  useFleetStore.getState().disconnect();
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
