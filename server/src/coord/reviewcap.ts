import type { ReadFailure } from '../../../shared/agent-protocol.js';
import { REVIEW_FINDINGS_NONE_OPEN, REVIEW_FINDINGS_WORDS, type LastReviewReport, type ReviewCapAsk, type ReviewCapStatus, type ReviewFindings, type RunKind } from '../../../shared/api.js';
import { redactCommand } from './redact.js';

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

/** D-6909: the cap's state a run row carries. Only a work run has one; a review run, or a run of unknown kind, is null.
 *  `row` is the run's `review_cap` row, absent until the ask is raised or the cap lifted. */
export const reviewCapStatus = (kind: RunKind, rounds: number,
  row: { askedAt: number | null; liftedAt: number | null } | undefined): ReviewCapStatus | null =>
  kind !== 'work' ? null
    : { rounds, cap: REVIEW_ROUND_CAP, askedAt: row?.askedAt ?? null, liftedAt: row?.liftedAt ?? null };

/** At most this many finding lines ride the ask, each at most `REVIEW_FINDING_MAX` characters. */
export const REVIEW_FINDINGS_MAX = 8;
export const REVIEW_FINDING_MAX = 300;

/** The open findings of a reviewer-skill report: the bullets under `## Findings` (each is `- **Fn (...)** ...`, with
 *  `needs a ruling: <question>` when it wants one). A report with no such section yields its `needs a ruling:` lines
 *  alone. Redacted, truncated and capped; never throws. */
export function extractOpenFindings(report: string): string[] {
  const lines = report.split('\n');
  const start = lines.findIndex((l) => /^##\s+Findings\s*$/.test(l));
  let picked: string[];
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^##\s/.test(l));
    picked = (end < 0 ? rest : rest.slice(0, end)).filter((l) => /^\s*[-*]\s+\S/.test(l));
  } else {
    picked = lines.filter((l) => l.includes('needs a ruling:'));
  }
  return picked.slice(0, REVIEW_FINDINGS_MAX)
    .map((l) => redactCommand(l.trim().replace(/^[-*]\s+/, '')).slice(0, REVIEW_FINDING_MAX));
}

/** Words the read of a report as a `ReviewFindings`. */
export const reviewFindingsOf = (read: { ok: true; content: string } | { ok: false; reason: ReadFailure } | null): ReviewFindings =>
  read === null ? { state: 'unnamed' }
    : read.ok ? { state: 'read', lines: extractOpenFindings(read.content) }
      : { state: read.reason };

/** Longest summary the ask carries. */
export const REVIEW_CAP_SUMMARY_MAX = 600;

export const reviewCapAsk = (run: number, rounds: number, lastReview: LastReviewReport, findings: ReviewFindings): ReviewCapAsk =>
  ({ run, rounds, cap: REVIEW_ROUND_CAP, lastReview: { ...lastReview, findings } });

/** The notice the operator reads: what is blocked, why, and what the last review left open. */
export function reviewCapNotice(a: ReviewCapAsk): { title: string; body: string } {
  const open = a.lastReview.summary === null
    ? 'No review has reported yet.'
    : `Last review (run ${a.lastReview.reviewRunId}): ${a.lastReview.summary}`;
  const where = a.lastReview.report === null ? '' : ` Report: ${a.lastReview.report}`;
  const f = a.lastReview.findings;
  const findings = f.state === 'read' && f.lines.length > 0
    ? ` Open findings: ${f.lines.join(' | ')}`
    : f.state === 'read' ? ` ${REVIEW_FINDINGS_NONE_OPEN}`
      : f.state === 'unnamed' ? '' : ` ${REVIEW_FINDINGS_WORDS[f.state]}`;
  return {
    title: `Review cap reached on run ${a.run}`,
    body: `Run ${a.run} has had ${a.rounds} review rounds (cap ${a.cap}), so a further review was refused. ${open}${where}${findings} `
      + 'Lift the cap for this run to allow another round.',
  };
}
