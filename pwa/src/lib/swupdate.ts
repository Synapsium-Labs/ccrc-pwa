// Tiny indirection between "something decided the build is too old" (the
// fleet store, on an incompatible `hello`) and "how to actually check for a
// new one" (the SW registration `main.tsx` holds). Neither side should know
// the other exists: the store has no business importing `virtual:pwa-register`
// just to react to a WS frame, and a store test has no service worker to
// register. `setUpdater` is called once real registration lands; before that
// (dev, tests, a registration that never resolved) `requestUpdate` is a no-op
// — the block screen's manual Reload button is the fallback for exactly that.
let updater: (() => void) | null = null;

export function setUpdater(fn: () => void): void {
  updater = fn;
}

export function requestUpdate(): void {
  updater?.();
}
