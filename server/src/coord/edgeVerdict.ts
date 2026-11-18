// An edge's verdict, from the done-test reader's answer for its target (Overlord W2 remaining work B; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-remaining-work.md Task 4, questions 3 and 6; spec §5.6 H38: "The
// server alone clears an edge, when it measures the target, with the done test's vocabulary").
//
// Ring: L1, context C5 Coordination. Pure: no store, no clock (`now` is an argument), no I/O. The forecast lane's edge
// arm (`forecastLane.ts#runForecastLane`) asks `doneTestRead.ts#readTarget` about the target, asks this, and hands the
// answer's `settle` to the one writer of the edge's state columns (`programmeFactsStore.ts#settleEdge`).
//
// The reader's two failure words are mapped APART, deliberately (review 2381 N1, the coordinator's ruling):
//   * `unmeasured` is a read that failed NOW (a locked database, a throw) and may succeed on the next pass, so it starts
//     or keeps the edge's clock, and only `EDGE_UNMEASURABLE_AFTER_MS` of unbroken unmeasured answers ends the block;
//   * `unmeasurable` is a fact no row of this build can answer (a PR only the run's lineage names, `lineage-unattributed`;
//     a run closed with no close record), which no later pass can change, so the edge moves to `target-unmeasurable` at
//     once (slug `edge-unmeasurable-answer-ends-at-once`). Neither ever reads as met.
import { EDGE_EVIDENCE_MAX, EDGE_UNMEASURABLE_AFTER_MS, type EdgeState } from '../../../shared/programmeFacts.js';
import type { TargetAnswer } from '../../../shared/doneTests.js';
import { redactCommand } from './redact.js';
import { cutWhole } from './reviewcap.js';

/** What the edge's one writer does with a verdict: END the edge in a state other than `open`, with its measured
 *  evidence, or set its unmeasured CLOCK (`unmeasuredSince`: the first of an unbroken run of unmeasured answers, null
 *  once a measured answer breaks it). */
export type EdgeSettle =
  | { readonly kind: 'end'; readonly state: Exclude<EdgeState, 'open'>; readonly evidence: string }
  | { readonly kind: 'clock'; readonly unmeasuredSince: number | null };

/** Table "The verdict" of Task 4, one word per row. `none` writes nothing. */
export type EdgeVerdictWord = 'none' | 'unmeasurable' | 'unmeasured' | 'met' | 'ended' | 'pending';
const EDGE_VERDICT_MAP: Record<EdgeVerdictWord, true> = {
  none: true, unmeasurable: true, unmeasured: true, met: true, ended: true, pending: true,
};
export const EDGE_VERDICT_WORDS = Object.keys(EDGE_VERDICT_MAP) as readonly EdgeVerdictWord[];

export type EdgeVerdict =
  | { readonly verdict: 'none' }
  | { readonly verdict: Exclude<EdgeVerdictWord, 'none'>; readonly settle: EdgeSettle };

/** The edge as the verdict reads it (`ProgrammeEdge`'s fields): its state (an unknown stored word reads `open` with
 *  `stateUnreadable`), whether its kind and target are words and shapes this build can read, and its clock. */
export interface EdgeVerdictEdge {
  readonly state: EdgeState; readonly stateUnreadable?: true; readonly kindUnreadable?: true; readonly targetUnreadable?: true;
  readonly unmeasuredSince: number | null;
}

/** The reader's evidence or reason, masked and cut whole: ids and words by the reader's contract, masked anyway, since
 *  the edge's evidence is served to the operator. */
const evidenceOf = (text: string): string => cutWhole(redactCommand(text), EDGE_EVIDENCE_MAX).trim();

const end = (verdict: 'met' | 'ended' | 'unmeasurable', state: Exclude<EdgeState, 'open'>, evidence: string): EdgeVerdict =>
  ({ verdict, settle: { kind: 'end', state, evidence: evidenceOf(evidence) } });

/** First match and total over every edge state (read or unreadable), every reader answer and any clock. `answer` is null
 *  when the target could not be asked (a stored shape this build cannot read). Replacing an answer with an unmeasured one
 *  never moves the verdict to `met` or `ended`. */
export function edgeVerdict(edge: EdgeVerdictEdge, answer: TargetAnswer | null, now: number): EdgeVerdict {
  // 1. Only an `open` edge this build can read whole is settled: a word or shape a newer build wrote is never ended by
  //    this one, so the block stays visible, flagged, until a build that can read it measures it.
  if (edge.state !== 'open' || edge.stateUnreadable === true || edge.kindUnreadable === true || edge.targetUnreadable === true
    || answer === null) return { verdict: 'none' };
  if (answer.kind === 'unmeasured') {
    const since = edge.unmeasuredSince;
    // 2. Seven days of unbroken unmeasured answers end the block, never as met.
    if (since !== null && now - since >= EDGE_UNMEASURABLE_AFTER_MS) {
      return end('unmeasurable', 'target-unmeasurable', `unmeasured since ${since}: ${answer.why}`);
    }
    // 3. Otherwise the clock starts, or keeps its first time.
    return { verdict: 'unmeasured', settle: { kind: 'clock', unmeasuredSince: since ?? now } };
  }
  // 4. A fact no row of this build can answer: no later pass can change it.
  if (answer.kind === 'unmeasurable') return end('unmeasurable', 'target-unmeasurable', `unmeasurable: ${answer.why}`);
  // 5 and 6. The target passed, or ended other than as needed.
  if (answer.kind === 'passed') return end('met', 'met', answer.evidence);
  if (answer.kind === 'ended') return end('ended', 'target-ended', answer.evidence);
  // 7. Still pending: a measured answer, so the clock is cleared.
  return { verdict: 'pending', settle: { kind: 'clock', unmeasuredSince: null } };
}
