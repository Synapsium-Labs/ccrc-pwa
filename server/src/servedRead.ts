import { FLEET_ROWS_MAX_AGE_MS } from './lifecycle.js';

/** The decider's answer: the watcher's stamped measurement and its age, or "read it yourself". */
export type Served<T> = { serve: true; value: T; ageMs: number } | { serve: false };

/**
 * Whether a route may serve the watcher's last measurement (console speed S2). Pure. It serves `stamped` only while
 * its age, `nowMs - stamped.listedAt`, is at least zero and under `boundMs`: a negative age (a clock that stepped back)
 * proves nothing about how old it is, and a measurement at the bound is already too old. This is the arithmetic of
 * `fleetRowsUsable` (`lifecycle.ts`), generalised to any stamped value. `null` means the watcher has nothing to hand
 * over. A watcher that has stalled stops stamping, so its last measurement ages past the bound and the route reads
 * for itself: an old answer is never served as a new one.
 */
export function servedFromWatcher<T extends { listedAt: number }>(
  stamped: T | null,
  nowMs: number,
  boundMs: number = FLEET_ROWS_MAX_AGE_MS,
): Served<T> {
  if (stamped === null) return { serve: false };
  const ageMs = nowMs - stamped.listedAt;
  return ageMs >= 0 && ageMs < boundMs ? { serve: true, value: stamped, ageMs } : { serve: false };
}
