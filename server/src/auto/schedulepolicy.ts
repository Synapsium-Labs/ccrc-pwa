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
  AUTOMATION_FAILURE_CEILING, AUTOMATION_MIN_INTERVAL_MINUTES,
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
      readonly advance: SchedulePlan }
  | { readonly act: 'unschedulable'; readonly error: ScheduleError };

/**
 * How late a firing may be and still count as "on time" rather than a catch-
 * up — spec §3's finest granularity (one minute), so "late" cannot mean less
 * than the cadence's own resolution, and the lane's own jitter cannot spend
 * an automation's once-per-boot catch-up budget on an ordinary firing
 * (task-6-decisions.md C2.4).
 *
 * DEVIATION (see task-6-report.md, D-TBD-automation-punctual-ms): the
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
// scans for a second formatter construction by name. This comment deliberately
// does NOT spell that constructor: the scan is textual, and naming the thing
// it forbids would trip it from a comment explaining why it exists.

/**
 * The two schedule columns, decided in one place (task-6-decisions.md C2.5).
 * `consumedMs` is the occurrence being advanced past (`a.nextRunAt`), or
 * `null` for create / edit / arm.
 *
 * The ONE consumer of `AUTOMATION_MIN_INTERVAL_MINUTES`: an `interval` below
 * the floor answers `bad-cadence`. It cannot live in `shared/schedule.ts` —
 * that module is import-free and cannot read a cap (GC 8).
 */
export function planSchedule(
  cadence: Cadence | null, nowMs: number, consumedMs: number | null,
): SchedulePlan {
  if (cadence === null) return { nextRunAt: null, scheduleError: 'bad-cadence' };
  if (cadence.kind === 'interval' && cadence.everyMinutes < AUTOMATION_MIN_INTERVAL_MINUTES) {
    return { nextRunAt: null, scheduleError: 'bad-cadence' };
  }
  const afterLocal = consumedMs === null || cadence.kind === 'interval'
    ? null : localTupleAt(cadence.tz, consumedMs);
  const next = nextOccurrence(cadence, nowMs, afterLocal);
  if ('unschedulable' in next) return { nextRunAt: null, scheduleError: next.unschedulable };
  return { nextRunAt: next.at, scheduleError: null };
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
  if (lateMs < AUTOMATION_PUNCTUAL_MS) {
    return {
      act: 'fire', trigger: 'schedule', scheduledFor, lateMs,
      dstShifted: occurrenceShifted(a.cadence, scheduledFor), advance,
    };
  }
  if (lateMs <= a.graceMs && !caughtUpThisBoot) {
    return {
      act: 'fire', trigger: 'catchup', scheduledFor, lateMs,
      dstShifted: occurrenceShifted(a.cadence, scheduledFor), advance,
    };
  }
  return { act: 'record-missed', scheduledFor, lateMs, advance };
}

export interface FailureLadder {
  readonly consecutiveFailures: number;   // the value to store
  readonly autoPause: boolean;            // state='paused', scheduleError='failure-ceiling'
}

/** Spec §8, as a function so the store APPLIES and never decides:
 *  'ok' -> 0; 'skipped' -> unchanged (the lease working is not a failure);
 *  everything else -> prev + 1, autoPause at >= AUTOMATION_FAILURE_CEILING. */
export function failureLadder(
  prev: number,
  outcome: Exclude<AutomationOutcome, 'running' | 'unknown'>,
): FailureLadder {
  if (outcome === 'ok') return { consecutiveFailures: 0, autoPause: false };
  if (outcome === 'skipped') return { consecutiveFailures: prev, autoPause: false };
  const next = prev + 1;
  return { consecutiveFailures: next, autoPause: next >= AUTOMATION_FAILURE_CEILING };
}
