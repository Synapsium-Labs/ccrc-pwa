/**
 * The review-round cap (D-6795, build-spend controls plan 2026-10-24). L1: pure, no store, no clock, no reply.
 *
 * A work run is reviewed in rounds: each review run that names it is one round, and until now nothing bounded them.
 * `CoordStore.openRun` counts the review runs that name the work run (`reviewRounds`) and, at `REVIEW_ROUND_CAP`, refuses
 * the next open `cap-review-rounds` unless the operator has lifted the cap for that run (`liftReviewCap`). The route
 * raises ONE operator ask for the refusal (`CoordStore.raiseReviewCapAsk` is the once-only writer); this file words it.
 */

/** Review runs one work run may have before the next is refused: rounds 1 to 3 open, the 4th is refused. */
export const REVIEW_ROUND_CAP = 3;

/** Whether opening one more review run is over the cap. A lifted run is never over it. */
export const reviewCapRefuses = (rounds: number, lifted: boolean): boolean => !lifted && rounds >= REVIEW_ROUND_CAP;

/** The last review's report as the store reads it from its `review-done` mail; both fields are null when no review
 *  has reported. `summary` is the mail body after its fingerprint line. */
export interface LastReviewReport { reviewRunId: number | null; summary: string | null; report: string | null }

/** The structured ask the refusal answers with and the notice words. */
export interface ReviewCapAsk {
  run: number; rounds: number; cap: number;
  lastReview: LastReviewReport;
}

/** Longest summary the ask carries. */
export const REVIEW_CAP_SUMMARY_MAX = 600;

export const reviewCapAsk = (run: number, rounds: number, lastReview: LastReviewReport): ReviewCapAsk =>
  ({ run, rounds, cap: REVIEW_ROUND_CAP, lastReview });

/** The notice the operator reads: what is blocked, why, and what the last review left open. */
export function reviewCapNotice(a: ReviewCapAsk): { title: string; body: string } {
  const open = a.lastReview.summary === null
    ? 'No review has reported yet.'
    : `Last review (run ${a.lastReview.reviewRunId}): ${a.lastReview.summary}`;
  const where = a.lastReview.report === null ? '' : ` Report: ${a.lastReview.report}`;
  return {
    title: `Review cap reached on run ${a.run}`,
    body: `Run ${a.run} has had ${a.rounds} review rounds (cap ${a.cap}), so a further review was refused. ${open}${where} `
      + 'Lift the cap for this run to allow another round.',
  };
}
