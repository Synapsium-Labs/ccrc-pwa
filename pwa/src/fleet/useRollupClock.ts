// The rollup's clock (D-6088): the instant the 30-minute window is read against. It is read FRESH on every render, so a
// fleet frame always meets the real time, and one timer is set for the next instant a project leaves the window
// (`nextRollupBoundary`), so the list re-renders there with no frame. A quiet fleet sets no timer. A ticking interval
// that stops while quiet would keep its last tick and hold a gone-quiet project open (the review's stale clock).
// `next` is that boundary (C9, D-6441): with the same fleet, runs, quiet time and pause it moves only at a boundary (a
// window's end, or since Task G1b a box's stall boundary, below), whether this hook's timer woke the list or some other
// render read the clock first (which moves `next` and clears the timer). It also moves with no boundary passed when the
// stall boundary's inputs change: a pause flip, a quiet-time change or a runs frame (review 1253 F4), harmlessly, since
// the rollup then rebuilds to the same answer. A list that memoises its rollup keys on `next`, and on the tree, never on
// the clock itself. One clock, one timer.
// Task G1b (D-7380; review 1152 F1): the same timer also wakes at the next instant a programme box crosses the stall
// watch's quiet time (`nextStallBoundary`, over the open runs, the frame's `stallQuietMs` and the operator's pause), so
// a box reads stalled at its boundary with no frame, and `next` is the earlier of the two boundaries.
import { useEffect, useReducer } from 'react';
import type { FleetSession, RunSummary } from '../../../shared/api';
import { nextStallBoundary } from './programmeBoxes';
import { nextRollupBoundary } from './rollup';
import { runLastMove } from './runWords';

const earliest = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));

export function useRollupClock(
  sessions: readonly FleetSession[], runs: readonly RunSummary[], stallQuietMs: number | null, paused: boolean,
): { readonly now: number; readonly next: number | null } {
  const [, wake] = useReducer((n: number) => n + 1, 0);
  const now = Date.now();
  const next = earliest(nextRollupBoundary(sessions, now), nextStallBoundary(runs, runLastMove, now, stallQuietMs, paused));
  useEffect(() => {
    if (next === null) return undefined;
    // A millisecond past the boundary, so the re-render reads the window as closed.
    const t = setTimeout(wake, Math.max(0, next - Date.now()) + 1);
    return () => clearTimeout(t);
  }, [next]);
  return { now, next };
}
