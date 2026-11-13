// Console speed, task C2 ("the last view kept"; spec 2026-11-04 §2.4, decision D13): the ONE owner of query answers a
// screen keeps across visits. Settings' reads and the Digest start from "Loading" on every visit without it, because
// their hooks unmount when the screen does. Each keeps its last raw answer here, draws it at once on the next visit
// through its own reader, re-reads, and replaces it when the new answer lands.
//
// What this module is not:
// - It is not a reader. It holds the RAW answer, and a hook runs it through its own wire guard every time it draws it,
//   so an answer this build cannot read is still caught, and a cached answer the reader refuses draws nothing.
// - It is not storage. It lives in memory only, for one page load, and imports no storage API (`census-w7`'s storage
//   owners are unchanged; `screen-cache.test.ts` scans this file for one).
// - It is not the run archive's home. Run rows have one owner, the fleet store, and a second copy here would be a
//   second writer.
//
// Bounded: at most SCREEN_CACHE_MAX keys, the oldest dropped first. A `Map` keeps insertion order, so "newest" is
// "last inserted": `put` deletes and re-inserts its key, `peek` moves nothing.

/** The bound on keys held: the settings reads, the auth pair and a few dozen digest days, with room to spare. */
export const SCREEN_CACHE_MAX = 64;

/** One kept answer: the raw body as the read answered it, and when it landed (`Date.now()` at the write). */
export interface ScreenCacheEntry {
  readonly raw: unknown;
  readonly at: number;
}

const entries = new Map<string, ScreenCacheEntry>();

/** The kept answer for `key`, or undefined. Reading moves nothing: only a write makes a key newest. */
export function peek(key: string): ScreenCacheEntry | undefined {
  return entries.get(key);
}

/** Keep `raw` as `key`'s answer, landed at `at`; the key becomes the newest, and the oldest past the bound is dropped. */
export function put(key: string, raw: unknown, at: number): void {
  entries.delete(key);
  entries.set(key, { raw, at });
  while (entries.size > SCREEN_CACHE_MAX) {
    const oldest = entries.keys().next();
    if (oldest.done === true) break;
    entries.delete(oldest.value);
  }
}

/** Drop `key`'s answer: a write the operator made, or a server answer that says the view is gone, so a stale kept view
 *  never draws on the next visit. The next good read puts it back. */
export function forget(key: string): void {
  entries.delete(key);
}

/** Drop every kept answer (the test harness's teardown). */
export function clearScreenCache(): void {
  entries.clear();
}

/** The Settings reads that keep their last answer. One name per read, so two reads never share a key. */
export type SettingsCacheName =
  | 'updates' | 'stall-watch' | 'collect-lane' | 'dispatch-abandon' | 'lane-arm' | 'testbox' | 'linear-workspaces'
  | 'auth' | 'passkeys' | 'overrides';

/** The key of one Settings read. */
export const settingsKey = (name: SettingsCacheName): string => `settings:${name}`;

/** The key of one digest day. `null` is the server's default day (the screen opened with no `?day=`; an empty one
 *  gives the same key, and the screen reads it as `null`), kept apart from every named day: the default answer is for
 *  whichever day the server picks, so a correction forgets it by the day its answer names (`DigestScreen`). */
export const digestKey = (day: string | null): string => (day === null ? 'digest:' : `digest:${day}`);

/** The key of the runs board's place (the runs rebuild, D-8072): its Finished fold and its scroll, kept so a return from a run
 *  finds the board as it was left. */
export const runsBoardKey = 'runs:board';

/** The key of one lane's model files as `GET /api/models/:lane` read them (D-8406), kept so the session's model picker, its
 *  routing lines and the new-session sheet name a lane's models at once on a second visit. */
export const laneModelsKey = (lane: string): string => `lane-models:${lane}`;
