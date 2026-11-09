import type { ReadFailure } from '../../../shared/agent-protocol.js';
import { REVIEW_FINDINGS_NONE_OPEN, REVIEW_FINDINGS_WORDS, type CoordLiftRecord, type LastReviewReport, type ReviewCapAsk, type ReviewCapStatus, type ReviewFindings, type RunKind } from '../../../shared/api.js';
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

/** D-8125: the cap in force for a run whose coordinator has granted `granted` extra rounds (each lift grants `REVIEW_ROUND_CAP`). */
export const effectiveReviewCap = (granted: number): number => REVIEW_ROUND_CAP + granted;

/** Whether opening one more review run is over the cap. An operator-lifted run is never over it; a coordinator grant
 *  raises the cap by `granted`. `granted` is required so every caller is visited. */
export const reviewCapRefuses = (rounds: number, lifted: boolean, granted: number): boolean =>
  !lifted && rounds >= effectiveReviewCap(granted);

/** D-6909: the cap's state a run row carries. Only a work run has one; a review run, or a run of unknown kind, is null.
 *  `row` is the run's `review_cap` state, absent until the ask is raised or the cap lifted; its D-8125 fields are optional so
 *  a row without them reads as granted 0, no handled ask and no coordinator lift. `cap` is the effective one. */
export const reviewCapStatus = (kind: RunKind, rounds: number,
  row: { askedAt: number | null; liftedAt: number | null; granted?: number | null; askHandledAt?: number | null; coordLift?: CoordLiftRecord | null } | undefined): ReviewCapStatus | null => {
  if (kind !== 'work') return null;
  const granted = row?.granted ?? 0;
  return { rounds, cap: effectiveReviewCap(granted), askedAt: row?.askedAt ?? null, liftedAt: row?.liftedAt ?? null,
    granted, askHandledAt: row?.askHandledAt ?? null, coordLift: row?.coordLift ?? null };
};

/** `text` cut to at most `max` characters, never inside a token (review 960 F1). The egress mask matches a key only
 *  whole, so a cut that falls inside a run of non-whitespace drops that whole run rather than send its prefix unmasked;
 *  a text with no whitespace before the limit comes out empty, failing toward hiding. Nothing is appended. */
export function cutWhole(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /\S$/.test(cut) && /\S/.test(text[max]!) ? cut.replace(/\S+$/, '').trimEnd() : cut;
}

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
    .map((l) => cutWhole(redactCommand(l.trim().replace(/^[-*]\s+/, '')), REVIEW_FINDING_MAX))
    .filter((l) => l !== '');
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

/** D-8125: the bounds of a coordinator's lift reason, in characters. */
export const COORD_LIFT_REASON_MIN = 16;
export const COORD_LIFT_REASON_MAX = 300;

/** The reason a coordinator gives for a lift: one line, trimmed, masked, cut whole at the maximum. */
export function coordLiftReason(raw: unknown): { ok: true; reason: string } | { ok: false; detail: string } {
  const bounds = `${COORD_LIFT_REASON_MIN} to ${COORD_LIFT_REASON_MAX} characters`;
  if (typeof raw !== 'string') return { ok: false, detail: `reason must be a string of ${bounds}` };
  const trimmed = raw.trim();
  if (/[\r\n]/.test(trimmed)) return { ok: false, detail: `reason must be one line of ${bounds}` };
  if (trimmed.length < COORD_LIFT_REASON_MIN) return { ok: false, detail: `reason must be ${bounds}, saying why another round is needed` };
  const reason = cutWhole(redactCommand(trimmed), COORD_LIFT_REASON_MAX);
  if (reason.length < COORD_LIFT_REASON_MIN) return { ok: false, detail: `reason must be ${bounds} once masked` };
  return { ok: true, reason };
}

/** Why a coordinator lift is refused. Ownership is the route's to decide (it needs the registry). */
export type CoordLiftRefusal = 'coord-lift-off' | 'run-closed' | 'not-found' | 'cap-not-reached';

/** Whether a coordinator may lift now, and the cap before and after. Order: setting, kind, closed, lifted or under the cap. */
export function coordLiftVerdict(i: { kind: RunKind | 'unknown'; closed: boolean; rounds: number; granted: number; liftedAt: number | null; setting: 'on' | 'off' }):
  { ok: true; capBefore: number; capAfter: number } | { ok: false; refused: CoordLiftRefusal; detail: string } {
  if (i.setting === 'off') return { ok: false, refused: 'coord-lift-off', detail: 'coordinator review-cap lifts are turned off on this box; the operator lifts the cap' };
  if (i.kind !== 'work') return { ok: false, refused: 'not-found', detail: 'only a work run has a review cap' };
  if (i.closed) return { ok: false, refused: 'run-closed', detail: 'the run is closed' };
  const capBefore = effectiveReviewCap(i.granted);
  if (i.liftedAt !== null || i.rounds < capBefore) {
    return { ok: false, refused: 'cap-not-reached', detail: i.liftedAt !== null ? 'the cap is already lifted for this run' : `the run has had ${i.rounds} review rounds, under its cap of ${capBefore}` };
  }
  return { ok: true, capBefore, capAfter: capBefore + REVIEW_ROUND_CAP };
}

/** The record-only notice a coordinator lift sends. */
export const coordLiftNotice = (run: number, by: string, reason: string, capBefore: number, capAfter: number): { title: string; body: string } => ({
  title: 'Review cap lifted by its coordinator',
  body: `Run ${run}: ${by} allowed ${capAfter - capBefore} more review rounds (cap ${capBefore} to ${capAfter}). Why: ${reason}`,
});

/** The run-event detail a coordinator lift writes. */
export const coordLiftEventDetail = (rounds: number, capBefore: number, capAfter: number, reason: string): string =>
  `coord-lift: rounds ${rounds}, cap ${capBefore} -> ${capAfter}: ${reason}`;
