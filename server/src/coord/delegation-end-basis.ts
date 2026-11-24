// Session helpers S1 (D-8830; spec docs/superpowers/specs/2026-11-19-session-helpers-design.md §7.1, Table 9; plan
// docs/superpowers/plans/2026-11-20-broker-helper-ends.md): how a broker activity record's END is decided, and what it rests on.
//
// L1 policy, context C5 Coordination: pure, no fs, no clock, no SQLite. The checkpoint builder (`delegation-checkpoint.ts`, growth-frozen
// under D-8641) keeps only thin calls into it, so every rule below is written once and every end site goes through it:
//   - `isEndable`: the widened "not ended". A record a measured end may still end is one that has not ended, or one S2's one-time pass
//     closed (`backfill-unmeasured`): any later measured end replaces a backfill, basis and `endedAt` together.
//   - `endedBy`: one measured end of a record, the single shape every end site writes.
//   - `taskReportKey` / `taskReportEnd`: the task-report arm. An Agent's final task notification (a `UserPromptSubmit` whose status is
//     `completed`, `failed` or `cancelled`; the hook maps `killed` and `stopped` to `cancelled`) names its agent by its task id, so it
//     joins the record directly on the natural key (session, incarnation, `agent`, task id) through the mapping, with no launch index.
//   - `endBasisDefect`: the projectability rule for a row that carries `endBasis` (Table 9), mirrored by the column's CHECK in `schema.ts`.
//   - `isFinalNotification` (S2, review 3026 F9): what makes a task notification final, read by this arm and by the checkpoint's Workflow
//     arm (`foldNotification`), so the rule has one writer. The instant maximum has one too: `delegation-model.ts#maxInstant`.
//   - `hasMeasuredEnd` (S2, D-8874): the negation of `isEndable`, for the readers of Table 10 that hold or retire a record: a record the
//     one-time pass closed has no measured end, so it is held as an open record is and never retired.
import type { DelegationActivityNaturalKey, DelegationEventEnvelopeV1 } from '../../../shared/api.js';
import { maxInstant, type DelegationActivityRow, type DelegationEndBasis } from './delegation-model.js';

/** The widened "not ended": not ended, or ended by the backfill (which has no measured end, so any measured one replaces it). */
export const isEndable = (a: Pick<DelegationActivityRow, 'executionState' | 'endBasis'>): boolean =>
  a.executionState !== 'ended' || a.endBasis === 'backfill-unmeasured';

/** Ended, and on a measured end (S2): what the compaction's holds, its retirable set and `retireBehindCut` read as "ended". */
export const hasMeasuredEnd = (a: Pick<DelegationActivityRow, 'executionState' | 'endBasis'>): boolean => !isEndable(a);

/** A task notification's status, as the hook journals it. */
type NotificationStatus = Extract<DelegationEventEnvelopeV1, { eventKind: 'UserPromptSubmit' }>['notification']['status'];
/** A task notification is final on `completed`, `failed` or `cancelled`; `unknown` (a paused workflow) is not (review 3026 F9: one writer). */
export const isFinalNotification = (status: NotificationStatus): boolean => status !== 'unknown';

/**
 * `a` ended by a measured end at `at`: `ended`, `endedAt` never before `openedAt`, `lastEventAt` moved, and the basis written. `observed`
 * is written as ABSENCE (the key removed, never `endBasis: 'observed'`), so a row ended the way every row ended before S1 is
 * byte-identical to one ended then, and a checkpoint carries the key only for a task report or a backfill.
 */
export function endedBy(a: DelegationActivityRow, at: string, basis: Exclude<DelegationEndBasis, 'backfill-unmeasured'>): DelegationActivityRow {
  const { endBasis: _replaced, ...row } = a;
  const ended: DelegationActivityRow = { ...row, executionState: 'ended', endedAt: maxInstant(at, a.openedAt), lastEventAt: maxInstant(a.lastEventAt, at) };
  return basis === 'observed' ? ended : { ...ended, endBasis: basis };
}

/** The natural key an Agent's FINAL task notification names, or null: not a notification, or one whose status is `unknown`. */
export function taskReportKey(e: DelegationEventEnvelopeV1): DelegationActivityNaturalKey | null {
  if (e.eventKind !== 'UserPromptSubmit' || !isFinalNotification(e.notification.status)) return null;
  return { parentId: e.sessionId, parentIncarnation: e.parentIncarnation, sourceKind: 'agent', upstreamId: e.notification.taskId };
}

/**
 * The task-report arm's decision: the record the notification ends, or null when there is nothing to end. `rowOf` answers the record the
 * MAPPING holds for a natural key (undefined when the key is unmapped: never opened, or retired behind a compaction's cut, so a late
 * notification of a retired record ends nothing and refuses nothing). A record with a measured end keeps it: the first measured end
 * stands, whichever of the Stop and the task report the journal holds first.
 */
export function taskReportEnd(e: DelegationEventEnvelopeV1, rowOf: (key: DelegationActivityNaturalKey) => DelegationActivityRow | undefined): DelegationActivityRow | null {
  const key = taskReportKey(e);
  const a = key === null ? undefined : rowOf(key);
  return a === undefined || !isEndable(a) ? null : endedBy(a, e.observedAt, 'task-report');
}

/** Table 9's rule, for a row that carries `endBasis` only: `task-report` needs an `endedAt`, `backfill-unmeasured` a null one. A row
 *  without the key is not read, so no row written before S1 can fail it. Null when the row passes; else why it does not. */
export function endBasisDefect(a: Pick<DelegationActivityRow, 'endBasis' | 'endedAt'>): string | null {
  if (a.endBasis === 'task-report' && a.endedAt === null) return 'ended by a task report with no endedAt';
  if (a.endBasis === 'backfill-unmeasured' && a.endedAt !== null) return 'closed by the backfill with an endedAt';
  return null;
}
