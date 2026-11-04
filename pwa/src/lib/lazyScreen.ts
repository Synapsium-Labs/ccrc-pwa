// A SCREEN LOADED ON DEMAND (console speed, task C1 "the link and the start"; review 1464 F2). React's own `lazy` keeps
// the first answer of its loader for the life of the page, a rejection included: a chunk that failed to load once (a
// dropped connection, a deploy that replaced the chunk) would throw on every later render, so the detail boundary's
// reset on navigation would redraw the same failure until a reload. `lazyScreen` forgets a rejected load: the next
// render after the boundary resets asks the loader again. A load that succeeded is kept, as `lazy` keeps it.
//
// The rejection reaches the boundary as a `ScreenLoadError`, so `ScreenFallback` can tell "this screen's code could
// not be loaded" (offer Reload: a browser may keep a failed module, and a reload always fetches afresh) from "this
// screen threw while drawing". `preload()` starts the load early, for a screen the reader is likely to open next.
import { createElement, lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';

/** A lazy screen's code could not be loaded. `cause` is what the loader rejected with. */
export class ScreenLoadError extends Error {
  constructor(cause: unknown) {
    super('the screen’s code could not be loaded', { cause });
    this.name = 'ScreenLoadError';
  }
}

export interface LazyScreen<P extends object> {
  (props: P): ReactNode;
  /** Start the load now, if it has not started; never rejects (a failure is forgotten, as a render's would be). */
  preload(): Promise<void>;
}

export function lazyScreen<P extends object>(load: () => Promise<ComponentType<P>>): LazyScreen<P> {
  let pending: Promise<ComponentType<P>> | null = null;
  const start = (): Promise<ComponentType<P>> => {
    pending ??= load().catch((err: unknown) => {
      // Forget the failure: a fresh `lazy` and a fresh load for the next render.
      pending = null;
      current = make();
      throw new ScreenLoadError(err);
    });
    return pending;
  };
  const make = () => lazy(async () => ({ default: await start() }));
  let current = make();
  const Screen = ((props: P): ReactNode => createElement(current, props)) as LazyScreen<P>;
  Screen.preload = () => start().then(() => undefined, () => undefined);
  return Screen;
}

/** How long after mount a browser without `requestIdleCallback` waits before preloading. */
export const PRELOAD_FALLBACK_MS = 2_000;

/** Preload `screen` once the page is idle after its first paint (review 1464 F4: the session screen, so the first open
 *  of a session does not wait for its chunk while the eager inspector's doors are drawn). Call it from a mount effect;
 *  it returns the effect's cleanup. Idle-scheduled, so it competes with nothing the start draws, and the entry's own
 *  imports are unchanged; a browser without `requestIdleCallback` waits `PRELOAD_FALLBACK_MS` instead. */
export function preloadWhenIdle(screen: { preload(): Promise<void> }): () => void {
  const idle = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void };
  if (typeof idle.requestIdleCallback === 'function') {
    const h = idle.requestIdleCallback(() => { void screen.preload(); }, { timeout: 10_000 });
    return () => idle.cancelIdleCallback?.(h);
  }
  const t = setTimeout(() => { void screen.preload(); }, PRELOAD_FALLBACK_MS);
  return () => clearTimeout(t);
}
