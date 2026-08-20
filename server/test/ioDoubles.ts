// Shared `FleetIO` test doubles for the "listed but its bytes never come
// back" fixture shape — what `remote/io.ts` produces on one dropped agent-WS
// round trip, and what SEVEN independent copies of `withUnreadableField`/
// `unreadableField` hand-rolled across this tree before this file existed
// (`server/test/` is not a `single-definition` root, so nothing policed the
// duplication). Retires all of them.
//
// GOVERNING RULE (docs/superpowers/plans/2026-08-20-fleetio-measured-read.md,
// Task 4): every double here overrides `readFileMeasured` ONLY, never
// `readFile`. `localIO.readFile` derives from `readFileMeasured` through
// `this` —
//
//   async readFile(p) { const r = await this.readFileMeasured(p); return r.ok ? r.content : null; }
//
// — so spreading `localIO` onto a double that overrides `readFileMeasured`
// carries that derivation forward for free: a caller of either method sees
// the same degraded/real answer, from ONE source of truth. Overriding both
// would let them drift.
//
// Today's `readFile → null` failures always meant `unreadable`, never
// `absent` (a real, listed file whose bytes never came back — not a proven
// ENOENT), so `unreadable` is the fixed, only reason these doubles produce.
// Preserves every existing assertion written against the old `null` shape
// (`HOLD_UNREADABLE`, `branchEvidence: 'unreadable'`, `unmeasured`,
// `lifecycle: 'unmeasurable'`, …) exactly.
//
// `absentReadIO`/`absentField` below are Task 5's addition: a PROVEN ENOENT,
// for the case that was impossible to express before `readFileMeasured`
// existed — a file this fixture SEEDS (so it is LISTED, present in the
// directory the test's `readdir` sees) whose read nonetheless answers
// `absent`, modelling the race `field()` alone could never prove: listed at
// listing time, genuinely gone (unlinked) by the time its own bytes are read.
import { localIO, type FleetIO } from '../src/io.js';

/**
 * A `FleetIO` double that fails every `readFileMeasured` call whose path
 * matches `predicate` with `{ ok: false, reason: 'unreadable' }`, delegating
 * everything else — the non-matching paths, and every other `FleetIO`
 * member — to `localIO`. `predicate` may itself be a closure over a mutable
 * flag (a test that degrades then heals mid-fixture), which is why this
 * takes a function rather than a fixed path.
 */
export function degradedReadIO(predicate: (path: string) => boolean): FleetIO {
  return {
    ...localIO,
    readFileMeasured: async (p) => (predicate(p) ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p)),
  };
}

/** The common case: one session id's one field file, always degraded. */
export function unreadableField(id: string, field: string): FleetIO {
  return degradedReadIO((p) => p.endsWith(`${id}.${field}`));
}

/**
 * A `FleetIO` double that answers `{ ok: false, reason: 'absent' }` for every
 * `readFileMeasured` call whose path matches `predicate` — a PROVEN ENOENT,
 * regardless of what is actually on disk at that path (so it can model a
 * file the fixture seeded, and therefore LISTS, but that a race unlinked
 * before its own bytes were read). Delegates everything else to `localIO`,
 * same shape as `degradedReadIO`.
 */
export function absentReadIO(predicate: (path: string) => boolean): FleetIO {
  return {
    ...localIO,
    readFileMeasured: async (p) => (predicate(p) ? { ok: false, reason: 'absent' } : localIO.readFileMeasured(p)),
  };
}

/** The common case: one session id's one field file, always measured absent. */
export function absentField(id: string, field: string): FleetIO {
  return absentReadIO((p) => p.endsWith(`${id}.${field}`));
}
