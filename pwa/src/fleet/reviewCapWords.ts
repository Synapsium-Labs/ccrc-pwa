// The review cap's words and its ONE reader (D-6911, building on D-6909's `RunSummary.reviewCap`). L1: pure.
//
// `reviewCapOf` is the only place `RunSummary.reviewCap` is read. A `RunSummary` is cast, never revived, so an older
// server's row carries no `reviewCap` key at all: that reads `'unmeasured'`, never as "not waiting", and every caller
// below says nothing for it rather than claiming the cap is clear.
import { REVIEW_FINDINGS_NONE_OPEN, REVIEW_FINDINGS_WORDS, type CoordLiftRecord, type NotifyEvent, type ReviewCapStatus, type ReviewFindings, type RunSummary } from '../../../shared/api';
import { eventRunId } from '../lib/feed';
import { isRunClosed } from './runWords';

/** The one reader of `RunSummary.reviewCap`: absent is unmeasured, `null` is a run with no cap (a review run). */
export const reviewCapOf = (run: { reviewCap?: ReviewCapStatus | null }): ReviewCapStatus | 'unmeasured' | null =>
  run.reviewCap === undefined ? 'unmeasured' : run.reviewCap;

/** The two D-8125 fields an older server never sends, read as absent. `ReviewCapStatus` types them required (this
 *  server always sends them), so the reader narrows through a partial view rather than trusting the type. */
const handledAtOf = (cap: ReviewCapStatus): number | null => (cap as Partial<ReviewCapStatus>).askHandledAt ?? null;

/** The run's last coordinator lift, or null (none, or an older server that sends no `coordLift`). */
export const coordLiftOf = (cap: ReviewCapStatus): CoordLiftRecord | null => (cap as Partial<ReviewCapStatus>).coordLift ?? null;

/** Whether this run waits on the operator for its review cap. `waiting` is a raised ask that nobody has lifted or
 *  handled, `lifted` a raised ask the operator lifted, `coordinator` a cap its coordinator extended (D-8125) whose ask
 *  is closed or was never raised. A closed run is never waiting, and an unmeasured cap says nothing. An older server's
 *  row (no `askHandledAt`, no `coordLift`) reads exactly as before. */
export function capWaiting(run: RunSummary): 'waiting' | 'lifted' | 'coordinator' | null {
  if (isRunClosed(run)) return null;
  const cap = reviewCapOf(run);
  if (cap === null || cap === 'unmeasured') return null;
  if (cap.askedAt !== null) {
    if (cap.liftedAt !== null) return 'lifted';
    if (handledAtOf(cap) === null) return 'waiting';
  }
  return coordLiftOf(cap) === null ? null : 'coordinator';
}

/** "Cap lifted by its coordinator: <reason>" with the reason as the server sent it, or null when no coordinator lifted. */
export function coordLiftLine(cap: ReviewCapStatus): string | null {
  const lift = coordLiftOf(cap);
  return lift === null ? null : `Cap lifted by its coordinator: ${lift.reason}`;
}

/** The last review's findings as the sheet lists them: the lines a read report gave, or one sentence saying why there
 *  are none, in the notice's own words (`REVIEW_FINDINGS_WORDS`, `REVIEW_FINDINGS_NONE_OPEN`). Never empty. */
export function findingsWords(f: ReviewFindings): string[] {
  if (f.state !== 'read') return [REVIEW_FINDINGS_WORDS[f.state]];
  return f.lines.length > 0 ? f.lines : [REVIEW_FINDINGS_NONE_OPEN];
}

/** The run whose cap a Mail record offers to lift, or null for no door (D-6911). The key is the MEASURED cap state: the
 *  record names a run (read through `eventRunId`) that `live` holds and whose ask is raised and not lifted. `kind:
 *  'run'` and an empty session narrow it to the cap notice's shape (the server's census pins that notice as that
 *  shape's one literal writer, `review-cap.test.ts`), but a record can open the door only for a run that waits. `live`
 *  is the fleet store's runs frame, active runs only, so a closed run never has a door. */
export function capDoorRun(ev: NotifyEvent, live: readonly RunSummary[]): RunSummary | null {
  const runId = eventRunId(ev);
  if (ev.kind !== 'run' || ev.sessionId !== '' || runId === null) return null;
  const run = live.find((r) => r.id === runId);
  return run !== undefined && capWaiting(run) === 'waiting' ? run : null;
}
