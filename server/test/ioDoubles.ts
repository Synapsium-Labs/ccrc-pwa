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
// `lifecycle: 'unmeasurable'`, …) exactly. An `absent` double belongs to the
// next task's new tests, not here.
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
