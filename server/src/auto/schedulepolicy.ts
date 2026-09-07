// server/src/auto/schedulepolicy.ts — L1. No fs, no fastify, no node:sqlite,
// no reply, and no clock read: `nowMs` is always an INPUT. Interface per
// .superpowers/sdd/2026-08-31-automations/task-6-decisions.md C2.1/C2.4/C2.5
// — the binding contract for Task 6, which fixes four defects in the plan's
// own text (task-6-brief.md); see task-6-report.md for what each fix was and
// why. TWO value imports, both L0 — the same precedent `dispatch.ts:14-17`
// and `claims.ts:1` set for an L1 file value-importing `shared/`.
import {
  nextOccurrence, localTupleAt, occurrenceShifted,
  type Cadence, type LocalTuple,
} from '../../../shared/schedule.js';
import {
  AUTOMATION_FAILURE_CEILING, AUTOMATION_MAX_INTERVAL_MINUTES, AUTOMATION_MIN_INTERVAL_MINUTES,
  type AutomationOutcome, type AutomationRefusal, type AutomationState,
  type AutomationTrigger, type ScheduleError,
} from '../../../shared/api.js';

/**
 * The hydrated automation row, declared BY THE CONSUMER exactly as
 * `claims.ts:19` declares `ClaimRow` for a row the store produces
 * (task-6-decisions.md C2.1). The store's `hydrateAutomation` (spec §5)
 * returns this type; nothing else re-declares it.
 */
export interface AutomationRow {
  readonly id: number;
  readonly name: string;
  readonly state: AutomationState;
  readonly project: string;
  readonly prompt: string;
  /** `null` = the stored `cadenceKind` is a token this build does not know
   *  (`isCadenceKind` degraded it to `'unknown'`) — a rollback fact, never
   *  something a producer wrote. `planSchedule` answers `bad-cadence` for it. */
  readonly cadence: Cadence | null;
  readonly graceMs: number;
  readonly provedAt: number | null;
  readonly nextRunAt: number | null;
  readonly scheduleError: ScheduleError | null;
  readonly lastFireAt: number | null;
  readonly lastOutcome: AutomationOutcome | null;
  readonly lastRefusal: AutomationRefusal | null;
  readonly leaseUntil: number | null;
  readonly leaseHardUntil: number | null;
  readonly consecutiveFailures: number;
  readonly runsEvicted: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The pair spec §5's invariant binds together —
 *  `state='armed' AND scheduleError IS NULL <=> nextRunAt IS NOT NULL` — as
 *  a UNION rather than two nullable fields, so the invariant cannot be
 *  written wrong (task-6-decisions.md C2.4). */
export type SchedulePlan =
  | { readonly nextRunAt: number; readonly scheduleError: null }
  | { readonly nextRunAt: null; readonly scheduleError: ScheduleError };

export type FireDecision =
  | { readonly act: 'fire';
      readonly trigger: Extract<AutomationTrigger, 'schedule' | 'catchup'>;
      readonly scheduledFor: number;      // the OCCURRENCE, not the start
      readonly lateMs: number;            // nowMs - scheduledFor, >= 0, truthful
      readonly dstShifted: boolean;       // of the occurrence being CONSUMED
      readonly advance: SchedulePlan }
  | { readonly act: 'record-missed';
      readonly scheduledFor: number; readonly lateMs: number;
      readonly dstShifted: boolean;       // of the occurrence being RECORDED
      readonly advance: SchedulePlan }
  | { readonly act: 'unschedulable'; readonly error: ScheduleError };

/**
 * How late a firing may be and still count as "on time" rather than a catch-
 * up — spec §3's finest granularity (one minute), so "late" cannot mean less
 * than the cadence's own resolution, and the lane's own jitter cannot spend
 * an automation's once-per-boot catch-up budget on an ordinary firing
 * (task-6-decisions.md C2.4).
 *
 * DEVIATION (see task-6-report.md, ledger number pending Task 12): the
 * contract imports this from `shared/api.js` alongside
 * `AUTOMATION_FAILURE_CEILING`/`AUTOMATION_MIN_INTERVAL_MINUTES`, on the
 * theory it belongs in that file's Task-2 cap block. It is not there yet —
 * `shared/api.ts` is not in this task's file list, so it stays local to the
 * one function that reads it, rather than adding a second home for it or
 * hand-editing a file another task owns mid-flight. */
export const AUTOMATION_PUNCTUAL_MS = 60_000;

// The local-tuple and gap-shift arithmetic this file needs lives in
// `shared/schedule.ts` and is imported above. It was briefly duplicated here
// as a flagged shim while that file was under concurrent edit; the duplicate
// is gone. Two copies of the zone arithmetic is precisely how the server and
// the PWA come to disagree about what time it is, so `single-definition` now
// scans for a second wall-clock decomposition by name. This comment
// deliberately does NOT spell that method: the scan is textual, and naming the
// thing it forbids would trip it from a comment explaining why it exists.

/**
 * The two schedule columns, decided in one place (task-6-decisions.md C2.5).
 * `consumedMs` is the occurrence being advanced past (`a.nextRunAt`), or
 * `null` for create / edit / arm.
 *
 * The ONE consumer of the interval BAND: below `AUTOMATION_MIN_INTERVAL_
 * MINUTES` or above `AUTOMATION_MAX_INTERVAL_MINUTES` answers `bad-cadence`.
 * Neither cap can live in `shared/schedule.ts` — that module is import-free
 * and cannot read a cap (GC 8). The ceiling is not symmetry for its own sake:
 * the floor stops a rate a fleet cannot absorb, and the ceiling stops a
 * number whose `nextRunAt` leaves the range an INTEGER column can hold and
 * `node:sqlite` can read back (a read above 2^53 throws for the whole result
 * set, so one stored row would make every automations read fail).
 *
 * TOTAL, as `SchedulePlan` promises. The local-tuple read for the consumed
 * occurrence used to sit OUTSIDE `nextOccurrence`'s zone guard, so on the
 * advance path — the only path that ever has a `consumedMs`, and the only
 * writer of a stored `scheduleError` — a zone this build's ICU rejects
 * escaped as the `RangeError` `localTupleAt` documents, instead of the typed
 * refusal declared here. Converting an L0 throw into this file's own
 * vocabulary is exactly what a policy is for; leaving it to escape wedged the
 * row (nothing written, nothing disarmed, re-offered every 10 s for ever) and
 * made `scheduleError='unknown-timezone'` unwritable by any path at all.
 */
export function planSchedule(
  cadence: Cadence | null, nowMs: number, consumedMs: number | null,
): SchedulePlan {
  if (cadence === null) return { nextRunAt: null, scheduleError: 'bad-cadence' };
  if (cadence.kind === 'interval' &&
      (cadence.everyMinutes < AUTOMATION_MIN_INTERVAL_MINUTES ||
       cadence.everyMinutes > AUTOMATION_MAX_INTERVAL_MINUTES)) {
    return { nextRunAt: null, scheduleError: 'bad-cadence' };
  }
  let afterLocal: LocalTuple | null = null;
  if (consumedMs !== null && cadence.kind !== 'interval') {
    try {
      afterLocal = localTupleAt(cadence.tz, consumedMs);
    } catch {
      return { nextRunAt: null, scheduleError: 'unknown-timezone' };
    }
  }
  const next = nextOccurrence(cadence, nowMs, afterLocal);
  if ('unschedulable' in next) return { nextRunAt: null, scheduleError: next.unschedulable };
  return { nextRunAt: next.at, scheduleError: null };
}

/** The shift of the occurrence being CONSUMED, measured — and measurable,
 *  because `occurrenceShifted` reaches the same `localTupleAt` that throws on
 *  a zone ICU rejects. The guard is the advance's own answer rather than a
 *  second try/catch: `unknown-timezone` there means exactly "this cadence's
 *  zone does not resolve", which is exactly when the shift cannot be
 *  measured. So `false` here is never a silent collapse — the condition that
 *  produced it rides beside it, in `advance`, where the caller already reads
 *  it and where it disarms the row. */
function shiftOf(cadence: Cadence, atMs: number, advance: SchedulePlan): boolean {
  if (advance.scheduleError === 'unknown-timezone') return false;
  return occurrenceShifted(cadence, atMs);
}

/**
 * The table, in order — the order IS the specification (task-6-decisions.md
 * C2.4, `claims.ts:162-175`'s shape):
 *
 *   cadence === null                      -> unschedulable 'bad-cadence'
 *   nextRunAt === null                    -> unschedulable 'no-future-occurrence'
 *   consecutiveFailures >= CEILING        -> unschedulable 'failure-ceiling'
 *   lateMs <  AUTOMATION_PUNCTUAL_MS      -> fire 'schedule'
 *   lateMs <= graceMs && !caughtUpThisBoot-> fire 'catchup'
 *   otherwise                             -> record-missed
 *
 * Every arm but `unschedulable` carries `advance = planSchedule(cadence,
 * nowMs, scheduledFor)`, landing strictly in the future — one lateness
 * episode produces ONE row, never one per skipped occurrence.
 *
 * No `idle` arm (overrides plan:515-519): over `dueAutomations(now)`'s
 * output it is unreachable, and `caughtUpThisBoot` is MEASURED BY THE
 * CALLER (`claims.ts:153-156`'s `LivenessProbe` idiom) — an input, so the
 * decision stays pure. L4 owns the memory (`private caughtUp = new
 * Set<number>()`); L1 owns the rule.
 */
export function decideFire(
  a: Pick<AutomationRow, 'cadence' | 'graceMs' | 'nextRunAt' | 'consecutiveFailures'>,
  nowMs: number,
  caughtUpThisBoot: boolean,
): FireDecision {
  if (a.cadence === null) return { act: 'unschedulable', error: 'bad-cadence' };
  if (a.nextRunAt === null) return { act: 'unschedulable', error: 'no-future-occurrence' };
  if (a.consecutiveFailures >= AUTOMATION_FAILURE_CEILING) {
    return { act: 'unschedulable', error: 'failure-ceiling' };
  }
  const scheduledFor = a.nextRunAt;
  const lateMs = nowMs - scheduledFor;
  const advance = planSchedule(a.cadence, nowMs, scheduledFor);
  const dstShifted = shiftOf(a.cadence, scheduledFor, advance);
  if (lateMs < AUTOMATION_PUNCTUAL_MS) {
    return { act: 'fire', trigger: 'schedule', scheduledFor, lateMs, dstShifted, advance };
  }
  if (lateMs <= a.graceMs && !caughtUpThisBoot) {
    return { act: 'fire', trigger: 'catchup', scheduledFor, lateMs, dstShifted, advance };
  }
  // The missed arm carries the SAME measurement. It used to carry none, and
  // L4 wrote `dstShifted: false` as a literal into the run row — a fact the
  // delivery ring never measured, which is the one shape it may not take.
  return { act: 'record-missed', scheduledFor, lateMs, dstShifted, advance };
}

// THE §8 LADDER LIVES IN THE STORE, AND ONLY THERE. An `export function
// failureLadder(prev, outcome)` stood here, whose docstring said it existed "so
// the store APPLIES and never decides" — but the store decides for itself, with
// its own `AUTOMATION_LEDGER_MAP` plus the refusal ledger beside it, and this
// copy had ZERO production callers. Two copies of one policy is what this
// tree's single-definition doctrine forbids, and these two had already DRIFTED:
// this one answered `missed` with increment-and-auto-pause while the live map
// answers `ignore` (the grace machinery working is not the automation's
// failure). Its only consumer was a test titled "spec §8: missed counts,
// skipped does not" — a green suite pinning the copy nothing runs and
// contradicting shipped behaviour, which `single-definition.test.ts` cannot
// see because it scans for duplicated VALUES, not duplicated decisions.
//
// The live ledger's coverage is end-to-end in `automations-store.test.ts`
// ("skipped and missed do not move the counter; an ok resets it", and the
// operator-pause fixture beside it), which is where a decision the store makes
// belongs.

/** WHETHER THIS BUILD CAN KEEP A WALL CLOCK AT ALL — pure, so it is testable
 *  without a small-ICU node to hand.
 *
 *  `icuHasZones()` (`shared/schedule.ts`) exists because a small-ICU build
 *  does NOT throw on an IANA zone: it silently answers UTC. Every
 *  `wall-clock` cadence on such a box therefore fires at the UTC wall clock —
 *  two hours early in Warsaw in summer — while `nextRunAt`, every run row and
 *  every operator-facing sentence look exactly right, because they are all
 *  computed from the same wrong offset. There is no refusal to hang it on
 *  either: `nextOccurrence` answers `unknown-timezone` for a zone ICU
 *  REJECTS, and this zone is accepted.
 *
 *  The detector shipped with ZERO production callers, so nothing said any of
 *  this out loud. Answers null when there is nothing to say — a box with full
 *  ICU, or one with no wall-clock automation to mis-fire. */
export function zoneWarning(hasZones: boolean, wallClockCount: number): string | null {
  if (hasZones || wallClockCount <= 0) return null;
  const plural = wallClockCount === 1 ? '' : 's';
  return 'this node build carries no IANA timezone data, so every named timezone silently '
    + `resolves to UTC: ${wallClockCount} wall-clock automation${plural} will fire at the UTC wall `
    + 'clock, NOT the zone it names, and its history will look correct. Run a full-ICU node build '
    + '(or set NODE_ICU_DATA).';
}
