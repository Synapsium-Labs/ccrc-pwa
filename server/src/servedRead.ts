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

/**
 * Whether a request may change what the limits say about a lane (console speed S2, fix round 1: an operator's own act is
 * never undone by a served read). Every route under `/api/accounts/`, of any method: the lane acts, the write routes and
 * the sign-in, whose status read (`GET …/auth`) is where the server sees a sign-in end. And every write to
 * `/api/accounts` itself (adding a lane). Never the list read. `route` is the matched PATTERN, `undefined` when none
 * matched. Pure.
 */
export function accountActRoute(method: string, route: string | undefined): boolean {
  if (route === undefined) return false;
  return route === '/api/accounts' ? method !== 'GET' && method !== 'HEAD' : route.startsWith('/api/accounts/');
}

/**
 * The watcher's measurement only when its tick BEGAN after the operator's last account act (`actAt`, the end of that
 * act's handler; `null` when there has been none), else `null`, which every serve decider reads as "read it yourself".
 * A tick stamped at or before the act may have read the files before the act wrote them. Pure.
 */
export function takenAfter<T extends { listedAt: number }>(stamped: T | null, actAt: number | null): T | null {
  return stamped === null || actAt === null || stamped.listedAt > actAt ? stamped : null;
}

/** Two stamped measurements served together or not at all, with the older age. Pure. */
function servedPair<A extends { listedAt: number }, B extends { listedAt: number }>(
  a: A | null,
  b: B | null,
  nowMs: number,
  boundMs: number,
): { serve: true; a: A; b: B; ageMs: number } | { serve: false } {
  const x = servedFromWatcher(a, nowMs, boundMs);
  const y = servedFromWatcher(b, nowMs, boundMs);
  return x.serve && y.serve ? { serve: true, a: x.value, b: y.value, ageMs: Math.max(x.ageMs, y.ageMs) } : { serve: false };
}

/**
 * `GET /api/projects` reads two things the watcher also holds: the project-pool sweep and the limits. It serves them
 * only when BOTH are within the bound, since one served beside one read would stamp an answer with an age that is true of
 * half of it. The age it reports is the older of the two. Pure.
 */
export function servedProjectReads<P extends { listedAt: number }, L extends { listedAt: number }>(
  pools: P | null,
  limits: L | null,
  nowMs: number,
  boundMs: number = FLEET_ROWS_MAX_AGE_MS,
): { serve: true; pools: P; limits: L; ageMs: number } | { serve: false } {
  const r = servedPair(pools, limits, nowMs, boundMs);
  return r.serve ? { serve: true, pools: r.a, limits: r.b, ageMs: r.ageMs } : { serve: false };
}

/**
 * `GET /api/fleet` serves the watcher's registry listing and its pools wire together. The wire (`currentPools()`) carries
 * no stamp of its own, so its freshness is that of the pools READ the watcher kept beside it (`currentProjectPoolsRead()`,
 * set in the same `emitPools` call and cleared by an unlistable tick). Both within the bound, or neither is served: after an
 * unlistable tick a fresh-looking listing must not travel with a `listed:false` wire. The age is the older of the two. Pure.
 */
export function servedFleetReads<F extends { listedAt: number }, P extends { listedAt: number }>(
  listing: F | null,
  poolsRead: P | null,
  nowMs: number,
  boundMs: number = FLEET_ROWS_MAX_AGE_MS,
): { serve: true; listing: F; ageMs: number } | { serve: false } {
  const r = servedPair(listing, poolsRead, nowMs, boundMs);
  return r.serve ? { serve: true, listing: r.a, ageMs: r.ageMs } : { serve: false };
}
