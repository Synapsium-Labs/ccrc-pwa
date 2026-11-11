/**
 * The wave brief is confirmed taken (D-5841, D3, #755) — the L1 decider.
 *
 * A dispatched run's brief is ordinary mail (`dispatchRun` queues it with
 * `WAVE_BRIEF_SUBJECT`), and the mail lane's own ladder keeps it outstanding
 * while its recipient lives (D-5838). What nothing asked before this is whether
 * it was ever TAKEN: its delivery reached `ingestedAt` (the worker's
 * `UserPromptSubmit` edge) or was acked. This module answers, per unlanded brief,
 * what the mail sweep does next; `sweepMail`'s brief pass acts on the answer.
 *
 * Pure: no I/O, no clock read. Every input is a row `coord.db` holds (`mail.at`,
 * the delivery's columns, the run's `brief-retry` row), so a server restart
 * reads the same answer back.
 */

import { MAIL_SUBJECT_MAX_BYTES } from '../../../shared/api.js';

/** The subject `dispatchRun` gives a wave brief: its one spelling. */
export const WAVE_BRIEF_SUBJECT = 'wave-brief';

/** How long after a brief was queued it may sit untaken before the ONE retry. */
export const BRIEF_RETRY_MS = 5 * 60_000;

/** How long after a brief was queued it may sit untaken before the claimant is
 *  told and the operator pushed, once. */
export const BRIEF_NOTICE_MS = 10 * 60_000;

/** How far back the pass looks for a brief. The park's own 24 h ceiling
 *  (D-5838): an older brief has been decided by the lane already, and a deploy
 *  must not mail a coordinator about runs it has long since moved past. */
export const BRIEF_WATCH_HORIZON_MS = 24 * 60 * 60_000;

/** The `run_events.detail` of the retry and of the notice: the durable,
 *  `(runId, detail)`-deduped rows (`insertStallObservation`) every timer here
 *  reads back. */
export const BRIEF_RETRY_DETAIL = 'brief-retry';
export const BRIEF_NOTICE_DETAIL = 'brief-not-taken';

/** One unlanded brief of an active run, as `CoordStore.unlandedBriefs` reads
 *  it: the brief's LATEST delivery, never ingested and never acked. */
export interface UnlandedBrief {
  runId: number; program: string; wave: number; waveOf: number | null;
  deliveryId: number; mailId: number; toId: string;
  /** `mail.at`: when the brief was queued, which is the dispatch's own moment. */
  queuedAt: number;
  state: string; deliveredAt: number | null;
  parkedAt: number | null; parkReason: string | null;
  lastGate: string | null; lastError: string | null;
  /** The run already carries its `brief-retry` row. */
  retried: boolean;
}

export type BriefStep = 'wait' | 'retry' | 'notice';

/** What to do with one unlanded brief now. The notice wins over a retry that
 *  never happened (a server that was down across the 5-minute mark). */
export function briefStep(b: Pick<UnlandedBrief, 'queuedAt' | 'retried'>, now: number): BriefStep {
  const age = now - b.queuedAt;
  if (age >= BRIEF_NOTICE_MS) return 'notice';
  if (age >= BRIEF_RETRY_MS && !b.retried) return 'retry';
  return 'wait';
}

/** The send refusals a coordinator can act on, in its words. */
const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  'draft-present': 'its input box holds unsent text',
  'enter-ignored': 'the nudge sits unsubmitted in its input box',
};

const REASON_MAX = 120;

/** Why the brief has not landed, in a few words, for the notice's subject. */
export function briefNotTakenReason(
  b: Pick<UnlandedBrief, 'state' | 'deliveredAt' | 'parkReason' | 'lastGate' | 'lastError'>,
): string {
  const words = ((): string => {
    if (b.state === 'rejected') return `rejected (${b.lastError ?? 'no reason recorded'})`;
    if (b.deliveredAt !== null) return 'the nudge was submitted but no turn started';
    const code = b.parkReason ?? b.lastError;
    if (code !== null) return REFUSAL_WORDS[code] ?? `the send keeps failing (${code})`;
    if (b.lastGate !== null) return `held by the ${b.lastGate} gate`;
    return 'not yet attempted';
  })();
  return words.length > REASON_MAX ? `${words.slice(0, REASON_MAX - 1)}…` : words;
}

/** The notice's subject: `brief not taken by <worker>, run N: <reason>`, held to
 *  `MAIL_SUBJECT_MAX_BYTES` like any coordinator's subject (system mail skips
 *  the HTTP ingress that enforces it), trimmed by code point from the end. */
export function briefNotTakenSubject(worker: string, runId: number, reason: string): string {
  const full = `brief not taken by ${worker}, run ${runId}: ${reason}`;
  if (Buffer.byteLength(full, 'utf8') <= MAIL_SUBJECT_MAX_BYTES) return full;
  const chars = Array.from(full);
  const ellipsisBytes = Buffer.byteLength('…', 'utf8');
  let bytes = Buffer.byteLength(full, 'utf8');
  while (chars.length > 0 && bytes + ellipsisBytes > MAIL_SUBJECT_MAX_BYTES) {
    bytes -= Buffer.byteLength(chars.pop()!, 'utf8');
  }
  return `${chars.join('')}…`;
}

/** The notice's body, to the run's claimant. A REJECTED brief is terminal:
 *  nothing retries it, so its body never says so. */
export const briefNotTakenBody = (worker: string, runId: number, reason: string, rejected = false): string =>
  `run ${runId}'s wave brief to ${worker} has not been taken ${BRIEF_NOTICE_MS / 60_000} minutes after dispatch: ` +
  `${reason}. ` +
  (rejected
    ? 'The lane has given up on it and will not try again: re-send it yourself or abandon the run. '
    : 'The lane keeps it outstanding and retries it. ') +
  'Nothing was re-dispatched and no hold or limit changed. Look at the worker, or abandon and re-dispatch the run yourself.';

/** The operator push's collapse key: one per run. */
export const briefNotTakenTag = (runId: number): string => `brief-not-taken-${runId}`;

/**
 * D-8292 (#119): A TAKEN BRIEF STARTS THE RUN. A run at `dispatched` whose worker has taken the run's wave brief (the
 * same "taken" as above: a delivery to the run's own session reached `ingestedAt`, the worker's `UserPromptSubmit` edge
 * after the nudge, or was acked) moves to `working`. `CoordStore.startRunsOnTakenBrief` is the one writer, through the
 * one state writer (`advanceInner`), from the mail sweep. Before this only the coordinator's `{"to":"working"}` advance
 * made the move, and a run whose coordinator never sent it sat at `dispatched` however long its worker worked.
 *
 * It is a DERIVED move and says so: `causedBy` is `'sweep'` (the trail's "ccrc") and the detail names the delivery and
 * how it was taken. It claims only that the worker started a turn on its brief, never progress: `items` still counts
 * only what the coordinator settled (D-5914). Only `dispatched` is ever moved, so a run that went on to review, or a
 * closed one, is never sent back.
 */
export const BRIEF_TAKEN_START_PREFIX = 'work-started:';
export type BriefTakenHow = 'ingested' | 'acked';
export const briefTakenStartDetail = (deliveryId: number, how: BriefTakenHow): string =>
  `${BRIEF_TAKEN_START_PREFIX} the worker took its wave brief (delivery ${deliveryId}, ${how})`;
