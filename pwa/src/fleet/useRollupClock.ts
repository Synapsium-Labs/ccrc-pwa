// The rollup's clock (D-6088): the instant the 30-minute window is read against. It is read FRESH on every render, so a
// fleet frame always meets the real time, and one timer is set for the next instant a project leaves the window
// (`nextRollupBoundary`), so the list re-renders there with no frame. A quiet fleet sets no timer. A ticking interval
// that stops while quiet would keep its last tick and hold a gone-quiet project open (the review's stale clock).
// `wake` counts those timers (C9, D-6441): it changes only at a window's end, so a list that memoises its rollup keys
// on it, and on the tree, never on the clock itself.
import { useEffect, useReducer } from 'react';
import type { FleetSession } from '../../../shared/api';
import { nextRollupBoundary } from './rollup';

export function useRollupClock(sessions: readonly FleetSession[]): { readonly now: number; readonly wake: number } {
  const [woken, wake] = useReducer((n: number) => n + 1, 0);
  const now = Date.now();
  const next = nextRollupBoundary(sessions, now);
  useEffect(() => {
    if (next === null) return undefined;
    // A millisecond past the boundary, so the re-render reads the window as closed.
    const t = setTimeout(wake, Math.max(0, next - Date.now()) + 1);
    return () => clearTimeout(t);
  }, [next]);
  return { now, wake: woken };
}
