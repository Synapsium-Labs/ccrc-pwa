// A SCREEN LOADED ON DEMAND (console speed, task C1 "the link and the start"; reviews 1464 F2 and 1473 F1-F3). React's
// own `lazy` keeps the first answer of its loader for the life of the page, a rejection included, so the detail
// boundary's reset on navigation would redraw the same failure for good. `lazyScreen` forgets a rejected load, but only
// once React has seen it: the boundary's `componentDidCatch` calls `ScreenLoadError.forget()` after drawing its
// fallback, so each reset of the boundary asks the loader once more, and never more than once. (Forgetting it earlier,
// in the loader's own catch, let React's retry start a fresh load that suspended again, without end, when the load took
// longer than a React turn to fail: review 1473 F2.) Whether that second ask reaches the network is the engine's:
// Chromium remembers a failed module per URL and rejects again with no request, so there Reload, which `ScreenFallback`
// offers for this error, is what recovers; an engine that fetches a failed module again recovers on the navigation.
//
// A load that succeeded is kept, and once it has resolved a newly mounted screen is drawn from the resolved component
// directly, with no Suspense on that path: React's `lazy` suspends on its first render even when the code is already
// here, and holds the reveal for 300 ms after its fallback commits (review 1473 F3). A screen already mounted through
// the lazy path keeps it, so no screen remounts when the load resolves. `preload()` starts the load early, for a screen
// the reader is likely to open next, so its first open draws in the first commit.
import { createElement, lazy, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';

/** A lazy screen's code could not be loaded: fetched, or run once fetched (a module that throws as it is evaluated is
 *  one too, and Reload is its cure as well). `cause` is what the loader rejected with. */
export class ScreenLoadError extends Error {
  /** Forget this failure, so the next render of the screen asks the loader again. Called by the boundary once it has
   *  drawn its fallback; a second call does nothing. */
  readonly forget: () => void;
  constructor(cause: unknown, forget: () => void = () => {}) {
    super('the screen’s code could not be loaded', { cause });
    this.name = 'ScreenLoadError';
    this.forget = forget;
  }
}

export interface LazyScreen<P extends object> {
  (props: P): ReactNode;
  /** Start the load now, if it has not started; never rejects. A failed preload no screen has rendered yet is forgotten
   *  at once; one a screen is waiting on is left for the boundary to forget. */
  preload(): Promise<void>;
}

export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>): LazyScreen<P> {
  let pending: Promise<ComponentType<P>> | null = null;
  let resolved: ComponentType<P> | null = null;
  let current: ComponentType<P> = make();
  /** Has a screen rendered the current lazy component? */
  let shown = false;
  function make(): ComponentType<P> {
    return lazy(async () => ({ default: await start() })) as unknown as ComponentType<P>;
  }
  function start(): Promise<ComponentType<P>> {
    if (pending !== null) return pending;
    const mine: Promise<ComponentType<P>> = load().then((c) => { resolved = c; return c; }, (err: unknown) => {
      // Kept until React has seen it: `forget` swaps in a fresh load only if this is still the one in use.
      throw new ScreenLoadError(err, () => {
        if (pending !== mine) return;
        pending = null;
        current = make();
        shown = false;
      });
    });
    pending = mine;
    return mine;
  }
  const Screen = ((props: P): ReactNode => {
    // The type is fixed at mount: a screen mounted through the lazy path keeps it when the load resolves.
    const [type] = useState(() => resolved ?? current);
    if (type === current) shown = true;
    return createElement(type, props);
  }) as LazyScreen<P>;
  Screen.preload = () => start().then(() => undefined, (err: unknown) => {
    if (!shown && err instanceof ScreenLoadError) err.forget();
  });
  return Screen;
}

/** How long after mount a browser without `requestIdleCallback` waits before preloading. */
export const PRELOAD_FALLBACK_MS = 2_000;

/** Preload `screen` once the page is idle after its first paint (reviews 1464 F4 and 1473 F3: the session screen, so
 *  its first open draws in the first commit, with no loading line, while the eager inspector's doors wait for it). Call
 *  it from a mount effect; it returns the effect's cleanup. Idle-scheduled, so it competes with nothing the start draws,
 *  and the entry's own imports are unchanged; a browser without `requestIdleCallback` waits `PRELOAD_FALLBACK_MS`
 *  instead, and a reader whose browser asks to save data (`navigator.connection.saveData`) gets no preload. */
export function preloadWhenIdle(screen: { preload(): Promise<void> }): () => void {
  const idle = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void; navigator?: { connection?: { saveData?: boolean } } };
  // A reader who asked the browser to save data gets no download they did not ask for (review 1473 A7).
  if (idle.navigator?.connection?.saveData === true) return () => {};
  if (typeof idle.requestIdleCallback === 'function') {
    const h = idle.requestIdleCallback(() => { void screen.preload(); }, { timeout: 10_000 });
    return () => idle.cancelIdleCallback?.(h);
  }
  const t = setTimeout(() => { void screen.preload(); }, PRELOAD_FALLBACK_MS);
  return () => clearTimeout(t);
}
