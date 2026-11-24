import type { CoordCaps } from '../../../shared/api.js';
import type { CapMode, CoordCapDerived, CoordCapNow } from '../../../shared/runCap.js';
import type { HostMachineReading } from '../../../shared/pressure.js';

/**
 * L1: pure — the DECISIONS about the run cap (what a caps write may store, what
 * the cap derived from the machine is, and what the cap is now), with no clock, no fs and no
 * `reply`, checked by `coord-caps-policy.test.ts`'s purity scan at the bottom of
 * that file. The write itself is `CoordStore.setCaps` and the door is
 * `POST /api/coord/caps`.
 *
 * That citation used to name `single-definition.test.ts`'s coord-ring scan, and
 * was wrong (D-1219): that scan holds no `./db.js` import, no `node:sqlite`
 * import and no `coord.db` receiver — none of the three properties this sentence
 * claims. Measured: an `fs` import and a module-scope `Date.now()` left it green.
 * A miscited check is worse than an uncited claim, because it stops the next
 * reader from looking.
 *
 * This module exists because `setCaps` validates NOTHING and returns `void`
 * (`store.ts#setCaps`, D-1164): it binds the caps straight into an UPDATE, so
 * 0, -5, 1.5 and 1e9 all persist. Nothing in `server/src` had ever called it,
 * so the absence never showed — the caps changed by hand-editing sqlite.
 *
 * It REFUSES rather than clamps, following `ledger.ts`'s own shape (a named
 * ceiling plus a policy function that answers a typed union). A clamp would
 * store a number the operator did not ask for and answer 200, which is the
 * same lie as a silent truncation; `store.ts`'s `clampMailLimit` idiom is for
 * LIMIT arguments, never for policy values.
 */

/** One is the floor, and the reason is a wedge rather than tidiness.
 *  `dispatchDecide.ts#capsReadingOf` refuses on `running >= limit`,
 *  so a cap of `0` refuses EVERY dispatch for ever — and unlike the pause
 *  marker, which has a deliberately ungated door precisely so a wedge keeps a
 *  release valve it can reach, a zeroed cap has none. */
export const CAP_MIN = 1;

/** A fat-finger ceiling, not a claim about fleet size. The box these caps
 *  govern runs about twenty live sessions, so sixty-four is far above any real
 *  setting and far below the range where `640` could read as deliberate. It
 *  once bounded the daily brake too, on `MAIL_PACE.worker.quietMs`'s stated principle (two
 *  numbers for one policy is two numbers to get out of step); that brake is
 *  retired (D-7068), so it bounds the concurrency cap alone. Since
 *  D-8920 it is the DERIVED cap's ceiling too: a machine may not
 *  derive a cap the operator could not have typed. */
export const CAP_MAX = 64;

// ── the derived cap (D-8920; the operator's ruling of 2026-11-22) ────────────────────────────────────
// The run cap is a fact about the machine the fleet runs on, so it is derived from that machine's measured memory and
// cores and never typed. THE FORMULA, stated once:
//
//     cap = clamp( min( floor((memTotalBytes - HOST_RESERVE_BYTES) / RUN_MEMORY_BUDGET_BYTES),
//                       floor(sessionMemLimit / RUN_MEMORY_BUDGET_BYTES),      (only when the sessions have a limit)
//                       cores * RUNS_PER_CORE ),
//                  CAP_MIN, CAP_MAX )
//
// The smallest of what the box's memory allows, what the sessions' own memory limit allows and what the cores allow,
// never below one run and never above the ceiling an operator's own number is held to. It is conservative about memory
// on purpose: a fleet that runs out of memory stalls every session on the box at once, and a fleet with a spare slot
// only waits.
//
// THE SESSIONS' MEMORY LIMIT is a term of its own, decided HERE and never folded into the box's memory by whoever
// measured it. It is the tightest cgroup limit on the fleet's sessions (the session slice's, or one above it), and the
// kernel enforces it whatever the box has, so a cap derived from the box alone could promise memory the sessions may
// not use. It takes no reserve: the reserve is for the rest of the BOX, and the operating system and the control
// plane already sit outside the limit. The sessions no run counts sit inside it and come out of the runs' budgets,
// which are several times an idle session. The limit ships with a default, so a default-configured box is bounded by
// it; the answer says so (`bound: 'session-limit'`) and carries both figures, and the console shows both.
//
// A worked example: a host with 64 GiB of memory and 16 cores, and no limit on its sessions, derives
// min(floor(56 / 3), 16) = min(18, 16) = 16, set by the cores. The same host with its sessions limited to 24 GiB
// derives min(18, floor(24 / 3), 16) = min(18, 8, 16) = 8, set by the limit.

const GIB = 2 ** 30;

/** What one run is budgeted, in bytes of memory. A run is not one idle process: it is a worker session (a few hundred
 *  MiB resident when idle, more with a long conversation), the tools it starts, and its typecheck and test runs, each
 *  of which is several processes of a few hundred MiB to more than 1 GiB for as long as it runs. 3 GiB is several
 *  times the idle size. Set against measurement: a host run full at about one and a half times the cap this derives for
 *  it showed memory pressure at times. */
export const RUN_MEMORY_BUDGET_BYTES = 3 * GIB;

/** What is kept back from the box's memory for everything on it that is not a run: the sessions no run counts
 *  (coordinators, the operator's own sessions, workers that wait), the ccrc server or agent, the operating system and
 *  the page cache git and the test runs lean on. A busy fleet holds about as many sessions outside any counted run as
 *  inside one, and at the idle size those alone come to several GiB. */
export const HOST_RESERVE_BYTES = 8 * GIB;

/** How many runs one core carries. One: a run mostly waits for its model, but its typecheck and test phases each take
 *  at least a whole core, and the suites are sensitive to load. The cores are the ones the agent may run on
 *  (`os.availableParallelism`); a cgroup CPU quota is not read. */
export const RUNS_PER_CORE = 1;

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** THE DERIVED CAP: the formula above over a measured host, with the term that set it (`bound`) and the figures it was
 *  derived from, so whoever shows the number can say why it is that number. An unmeasured host derives NOTHING, as its
 *  own member with its reason: never a cap of zero, never a guess. `capNowOf` decides what is used then.
 *
 *  It trusts no caller to have validated the figures: a memory or core count that is not a positive finite number, and
 *  a limit that could not be read, derive nothing (`read-failed`). A NaN let through would come out as a cap of NaN,
 *  and `running >= NaN` is false, so the cap would refuse nothing. A tie between terms names the memory first, then
 *  the limit, then the cores. */
export function deriveCap(host: HostMachineReading): CoordCapDerived {
  if (host.kind === 'unmeasured') return { kind: 'unmeasured', why: host.why };
  const { memTotalBytes, cores, sessionMemLimit } = host.machine;
  const limited = sessionMemLimit !== 'none';
  if (!positive(memTotalBytes) || !positive(cores) || (limited && !positive(sessionMemLimit))) {
    return { kind: 'unmeasured', why: 'read-failed' };
  }
  const byMemory = Math.floor((memTotalBytes - HOST_RESERVE_BYTES) / RUN_MEMORY_BUDGET_BYTES);
  const byLimit = limited ? Math.floor(sessionMemLimit / RUN_MEMORY_BUDGET_BYTES) : Number.POSITIVE_INFINITY;
  const byCores = Math.floor(cores * RUNS_PER_CORE);
  const terms = Math.min(byMemory, byLimit, byCores);
  const from = { memTotalBytes, cores, ...(limited ? { sessionMemLimitBytes: sessionMemLimit } : {}) };
  if (terms < CAP_MIN) return { kind: 'measured', cap: CAP_MIN, bound: 'floor', ...from };
  if (terms > CAP_MAX) return { kind: 'measured', cap: CAP_MAX, bound: 'ceiling', ...from };
  const bound = terms === byMemory ? 'memory' : terms === byLimit ? 'session-limit' : 'cores';
  return { kind: 'measured', cap: terms, bound, ...from };
}

/**
 * THE CAP NOW, decided once (D-8920): the operator's override if one stands, else the derived cap, else
 * the stored number while the host is unmeasured. Every reader of "the cap" takes this answer through
 * `dispatch.ts#capNow`: the dispatch door, the send-back door, the admission wake and the caps view.
 *
 * `stored` is `coordinator_state.maxConcurrentWorkers` and `mode` is `coordinator_state.capMode`. In `override` the
 * stored number IS the override. In `automatic` it decides nothing while the host is measured, and it is what is used
 * while it is not: an older agent or a failed read must not collapse the cap to something nobody chose, and the number
 * the box ran on before is the one number known to have been somebody's choice. `derived` is carried on every answer,
 * so the answer itself says which of the three it is.
 */
export function capNowOf(stored: CoordCaps, mode: CapMode, host: HostMachineReading): CoordCapNow {
  const derived = deriveCap(host);
  if (mode === 'override') return { mode, cap: stored.maxConcurrentWorkers, derived };
  return { mode, cap: derived.kind === 'measured' ? derived.cap : stored.maxConcurrentWorkers, derived };
}

/** The cap in a feed line: an override is its number, an automatic cap says it is automatic and, when it is the stored
 *  number (`host unmeasured`), why. */
export function capNowWord(now: CoordCapNow): string {
  if (now.mode === 'override') return String(now.cap);
  return now.derived.kind === 'measured' ? `automatic (${now.cap})` : `automatic (${now.cap}, host unmeasured)`;
}

/** The title of every feed record of a cap that moved: the operator's write (`POST /api/coord/caps`) and the automatic
 *  cap's own (`capAutomaticNotice`). */
export const CAPS_FEED_TITLE = 'caps changed';

/** One feed record, with its once-only key. */
export interface CapAutomaticNotice { readonly body: string; readonly dedupeKey: string }

/**
 * THE AUTOMATIC CAP'S OWN RECORD (D-8920). An automatic cap moves with no operator act: when the first
 * reading of the host lands after an upgrade or a boot, and when the host or its limit changes. Whenever the cap in
 * force is the derived one and differs from the stored number, that is one feed record, `workers 3 → automatic (16)`:
 * the number the box would otherwise run on, and the cap it runs on instead. Otherwise the first sign of a cap nobody
 * set would be a `cap-concurrency` refusal naming it.
 *
 * ONCE per stored number's write and derived cap: the key carries the stored number's `updatedAt` and the cap, so a
 * restart repeats nothing, a host that derives a new cap is recorded again, and the operator's own move to automatic
 * (which the caps route records under this same key) is not recorded twice. Null: nothing to record (an override, an
 * unmeasured host, or a derived cap equal to the stored number).
 */
export function capAutomaticNotice(stored: CoordCaps, updatedAt: number | null, now: CoordCapNow): CapAutomaticNotice | null {
  if (now.mode !== 'automatic' || now.derived.kind !== 'measured' || now.cap === stored.maxConcurrentWorkers) return null;
  return {
    body: `workers ${stored.maxConcurrentWorkers} → ${capNowWord(now)}`,
    dedupeKey: `run-cap:automatic:${updatedAt ?? 0}:${now.cap}`,
  };
}

/** The two members are what a route must tell apart, so they carry different
 *  shapes rather than one nullable field: a refusal has a reason to say and a
 *  success has caps to write, and neither is the other's absence. */
export type CapsDecision =
  /** `mode` (D-8920): `override` when the body gave a number, `automatic` when it asked for the derived
   *  cap. On `automatic`, `next` is the stored number unchanged: it stays as the number used while the host is unmeasured. */
  | { readonly ok: true; readonly next: CoordCaps; readonly mode: CapMode }
  | { readonly ok: false; readonly detail: string }
  /** The body asked for nothing BUT retired dials: an older PWA's save of the
   *  dial it still renders. Its own member rather than an `ok: true` whose
   *  `next` is the current caps, because the route acts on the two differently:
   *  a write stamps `updatedAt` and records a feed row, and this writes nothing
   *  and records nothing — the operator moved no cap that still exists. */
  | { readonly ok: 'retired'; readonly retired: readonly string[] };

/** The FULL conjunction, and the lower bound is not optional — D-1151 is the
 *  recorded case of borrowing this shape one term short, on the kickoff route,
 *  where only the integer half made the trip. */
const wellFormed = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= CAP_MIN && v <= CAP_MAX;

/** The settable fields, enumerated ONCE — the route, the refusal detail and the
 *  merge below all read this rather than each spelling the list again. */
const FIELDS = ['maxConcurrentWorkers'] as const;

/** Dials that no longer exist, accepted and IGNORED on the wire (the wire rule:
 *  absence permits, and a legacy field must not 400). `maxSessionsPerDay` is
 *  the daily dispatch brake, retired by the operator on 2026-10-26
 *  (D-7068): an older cached PWA still sends it with every
 *  save that touched its row, and refusing that save would break the workers
 *  dial beside it. Its value is never read, so it is never validated either:
 *  an out-of-range legacy value is as meaningless as an in-range one. */
export const RETIRED_CAP_FIELDS = ['maxSessionsPerDay'] as const;

/**
 * `body` is a PARTIAL: an omitted field keeps its current value, so a dial added
 * later never has to be restated, and cannot be clobbered with a stale reading.
 *
 * An unknown extra key is IGNORED, not refused — a newer client's third field
 * must not be a 400 from an older server (the wire rule, absence-permits, read
 * in the other direction). A body that asks for NOTHING is refused, because
 * answering `ok` to it would make "the caps are now what you sent" and "you
 * sent nothing" the same 200.
 *
 * `mode` (D-8920) is the additive way back to the derived cap. A number is the operator's OVERRIDE, as
 * every body before this field was; `{ mode: 'automatic' }` clears it. The two together are refused (they ask for
 * opposite things), `override` with no number is refused (there is nothing to override with), and a mode this build
 * does not know is refused rather than ignored: ignoring it beside a number would store an override the caller may not
 * have meant.
 */
export function decideCaps(current: CoordCaps, body: unknown): CapsDecision {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, detail: 'body must be an object' };
  }
  const b = body as Record<string, unknown>;
  const mode = b['mode'];
  if (mode !== undefined && mode !== 'automatic' && mode !== 'override') {
    return { ok: false, detail: 'mode must be automatic or override' };
  }
  const asked = FIELDS.filter((k) => b[k] !== undefined);
  if (mode === 'automatic') {
    if (asked.length > 0) {
      return { ok: false,
        detail: `mode automatic takes no ${FIELDS.join(' or ')}: the cap is derived from the fleet host` };
    }
    return { ok: true, next: { ...current }, mode: 'automatic' };
  }
  if (asked.length === 0) {
    if (mode === 'override') {
      return { ok: false, detail: `mode override needs ${FIELDS.join(' or ')}` };
    }
    const retired = RETIRED_CAP_FIELDS.filter((k) => b[k] !== undefined);
    if (retired.length > 0) return { ok: 'retired', retired };
    return { ok: false,
      detail: `at least one of ${FIELDS.join(' or ')} must be given` };
  }
  for (const k of asked) {
    if (!wellFormed(b[k])) {
      return { ok: false,
        detail: `${k} must be an integer between ${CAP_MIN} and ${CAP_MAX}` };
    }
  }
  const next = { ...current };
  for (const k of asked) next[k] = b[k] as number;
  return { ok: true, next, mode: 'override' };
}
