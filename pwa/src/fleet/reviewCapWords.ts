// The review cap's words and its ONE reader (D-6911, building on D-6909's `RunSummary.reviewCap`). L1: pure.
//
// `reviewCapOf` is the only place `RunSummary.reviewCap` is read. A `RunSummary` is cast, never revived, so an older
// server's row carries no `reviewCap` key at all: that reads `'unmeasured'`, never as "not waiting", and every caller
// below says nothing for it rather than claiming the cap is clear.
import { REVIEW_FINDINGS_WORDS, type NotifyEvent, type ReviewCapStatus, type ReviewFindings, type RunSummary } from '../../../shared/api';
import { eventRunId } from '../lib/feed';
import { isRunClosed } from './runWords';

/** The one reader of `RunSummary.reviewCap`: absent is unmeasured, `null` is a run with no cap (a review run). */
export const reviewCapOf = (run: { reviewCap?: ReviewCapStatus | null }): ReviewCapStatus | 'unmeasured' | null =>
  run.reviewCap === undefined ? 'unmeasured' : run.reviewCap;

/** Whether this run waits on the operator for its review cap. `waiting` is a raised ask with no lift, `lifted` a raised
 *  ask the operator lifted. A closed run is never waiting, and an unmeasured cap says nothing. */
export function capWaiting(run: RunSummary): 'waiting' | 'lifted' | null {
  if (isRunClosed(run)) return null;
  const cap = reviewCapOf(run);
  if (cap === null || cap === 'unmeasured' || cap.askedAt === null) return null;
  return cap.liftedAt === null ? 'waiting' : 'lifted';
}

/** The last review's findings as the sheet lists them: the lines a read report gave, or one sentence saying why there
 *  are none, in the notice's own words (`REVIEW_FINDINGS_WORDS`). Never empty. */
export function findingsWords(f: ReviewFindings): string[] {
  if (f.state !== 'read') return [REVIEW_FINDINGS_WORDS[f.state]];
  return f.lines.length > 0 ? f.lines : [REVIEW_FINDINGS_WORDS.none];
}

/** The run whose cap a Mail record offers to lift, or null for no door. The record is the cap's notice: `kind: 'run'`
 *  with an empty session (the server pins that the notice is that shape's one writer, `review-cap.test.ts`), naming a
 *  run whose ask is raised and not lifted. A run the runs read did not resolve offers no door. */
export function capRecordRun(ev: NotifyEvent, runOf: (id: number) => RunSummary | undefined): RunSummary | null {
  const runId = eventRunId(ev);
  if (ev.kind !== 'run' || ev.sessionId !== '' || runId === null) return null;
  const run = runOf(runId);
  return run !== undefined && capWaiting(run) === 'waiting' ? run : null;
}
