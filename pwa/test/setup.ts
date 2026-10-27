import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setStripExpanded } from '../src/fleet/stripExpanded';
import { useFleetStore } from '../src/stores/fleet';

// ONE teardown hook doing three unrelated jobs, merged deliberately rather than
// registered as two: both arrived in the same week from different branches
// (the socket teardown from Stage 3a, the Radix timer flush from the
// draft-conflict flake fix), and each carried an ordering claim about the
// other's absence — "the FIRST thing in this file's teardown" and "vitest's
// stack hook order runs this setup-registered hook last". Two hooks would have
// made that order an emergent property of registration; one hook makes it a
// readable line. The socket goes first: stop it before anything unmounts, so a
// reconnect cannot be scheduled by a component on its way out.
//
// (1) THE MODULE-LEVEL FLEET SOCKET IS TORN DOWN AFTER EVERY TEST.
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
// the FIRST thing in this file's teardown, and the fleet store the only app state
// it reaches for — a global hook that reached further into the app would be a
// fixture pretending to be a harness. (The one other reach is (3)'s fold memory,
// `stripExpanded`, which is a module value plus a storage key, so only this hook
// can reset both for every file.)
//
// (2) Radix's FocusScope returns focus on unmount from a `setTimeout(..., 0)`
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
//
// (3) THE LANES STRIP'S FOLD CHOICE IS FORGOTTEN AFTER EVERY TEST.
//
// `stripExpanded.ts` keeps the operator's choice twice: in `localStorage`
// (`ccrc-accounts-strip`) and in a module value that holds it for the page when
// storage refuses. Either one alone would leak an expanded strip into the next
// test, which reads folded by default. `setStripExpanded(false)` clears the
// module value (and writes `folded`); the `removeItem` after it then clears the
// key, so a test starts with nothing stored, as a first visit does.
afterEach(async () => {
  useFleetStore.getState().disconnect();
  cleanup();
  setStripExpanded(false);
  try {
    window.localStorage.removeItem('ccrc-accounts-strip');
  } catch {
    /* a file on the node environment has no window, and a test may have made storage throw: nothing to clear then */
  }
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
