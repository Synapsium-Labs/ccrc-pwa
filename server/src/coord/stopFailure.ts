import type { StallNotice, StallNotify, StallSessionInput, StallVerdict, StallNoticeText } from './stall.js';
import {
  BACKLOG_HORIZON_MS, FAILED_REPEAT_MS, STALL_FAILED_PREFIX, STALL_SENDER, STALL_WAIT_PREFIX, VERDICT_NONE, holdVerdict, isIdleWord, stallArmMail,
  stallCurrentMark, stallMailDisabledHold, stallRecordedDone, stallReportHead, stallRunBound, stallSafe,
  stallSelfHead, stallSelfRungDone, stallSessionHold, stallSessionLive, stallSpan, stallUtc,
  stallUtcSec, stallW2ReportSubject, stallWorkerRef,
} from './stall.js';
/**
 * A TURN THAT ENDED ON A `StopFailure` (worker stall watch wave 2, spec §5.2): the error tokens' one classification, and
 * the `failed` arm that reads it, its verdict and its mails (its operator push stays in `stall.ts#stallW2SessionPush`,
 * with the run verdict's). L1, C5, pure: no clock, no I/O, no store. It moved here out of `stall.ts` (capped) word for
 * word; `stall.ts` keeps what every session arm shares (the holds, the marker, the rung accounting, the text helpers).
 * `stallSessionMail` is the lane's one way in to a session arm's mail: the `failed` arm's are here, every other arm's are
 * `stall.ts#stallArmMail`'s.
 */

// ── StopFailure's error tokens (§5.2) ────────────────────────────────────────────────────────────────────────
/** 2.1.277–2.1.284's own StopFailure matcher list, identical in every installed lane, in four classes.
 *  `provider`: the provider's own failure, `providerRetry.ts`'s ladder (D-9085): never this arm's, so no
 *  coordinator is asked to mend one. `retry`: a self-mail, then the coordinator on a repeat. `account`: a hold, because the limit, swap and authdead
 *  machinery owns it. `request`: the coordinator, because a retry fails the same way. It is one total Record, and
 *  the classifier reads it through `hasOwnProperty`, so an inherited name is never a token. */
const STOP_FAILURE_ERROR_MAP = {
  server_error: 'provider', overloaded: 'provider', max_output_tokens: 'retry', unknown: 'retry',
  rate_limit: 'account', billing_error: 'account', authentication_failed: 'account', oauth_org_not_allowed: 'account',
  account_on_hold: 'account', verification_required: 'account', cloud_credential_error: 'account',
  invalid_request: 'request', model_not_found: 'request',
} as const;
export type StopFailureError = keyof typeof STOP_FAILURE_ERROR_MAP;
export type StopFailureClass = 'provider' | 'retry' | 'account' | 'request';
export const STOP_FAILURE_ERRORS: Readonly<Record<StopFailureError, StopFailureClass>> = STOP_FAILURE_ERROR_MAP;
/** The tokens a failing PROVIDER sends (measured, 2.1.332: HTTP 529, 503 and 500, a connection dropped before or inside the
 *  answer and one refused all send `server_error`). The session hook counts exactly these (`failAts`). */
export const PROVIDER_FAILURE_ERRORS: readonly StopFailureError[] = (Object.keys(STOP_FAILURE_ERROR_MAP) as StopFailureError[])
  .filter((e) => STOP_FAILURE_ERROR_MAP[e] === 'provider');
/** null for a token this build cannot classify (never guessed): the failed arm holds `failed-unknown`. */
export function stopFailureClass(err: string | null): StopFailureClass | null {
  if (err === null || !Object.prototype.hasOwnProperty.call(STOP_FAILURE_ERROR_MAP, err)) return null;
  return STOP_FAILURE_ERROR_MAP[err as StopFailureError];
}

export const isProviderFailure = (err: string | null): boolean => stopFailureClass(err) === 'provider';
/** failed. *Chosen*. */
export const FAILED_IDLE_MS = 10 * 60_000;

/** failed: the error token and the turn end's minute. */
export function stallFailedSubject(err: string, stopAt: number): string {
  return `${STALL_FAILED_PREFIX} your turn ended on an API error (${stallSafe(err)}) at ${stallUtc(stopAt)}`;
}

const STALL_FAILED_WORD = STALL_FAILED_PREFIX.slice(0, -1);

/** A run worker's `failed` rung-1 notices keyed inside `[stopAt - FAILED_REPEAT_MS, stopAt)`, live or shadow: the
 *  failures before this one in the repeat window. The verdict counts them, and the repeat report reads their modes. */
function stallPriorFailedNotices(input: StallSessionInput, stopAt: number): StallNotice[] {
  const from = stopAt - FAILED_REPEAT_MS;
  return input.notices.filter((n) => n.arm === 'failed' && n.rung === 1 && n.key >= from && n.key < stopAt);
}

/** Was there a failure BEFORE this one inside `[stopAt - FAILED_REPEAT_MS, stopAt)`? For a run worker: a `failed`
 *  rung-1 notice keyed in that window, live or shadow (either one records that the failure happened). For a run-less
 *  session: a `failed:` self-mail from the watch, sent in that window under another subject. */
function stallPriorFailure(input: StallSessionInput, stopAt: number, subject: string): boolean {
  const from = stopAt - FAILED_REPEAT_MS;
  if (stallRunBound(input)) return stallPriorFailedNotices(input, stopAt).length > 0;
  return input.mail.some((m) => m.fromId === STALL_SENDER && m.toId === input.sessionId && m.subject.startsWith(STALL_FAILED_PREFIX)
    && m.subject !== subject && m.at >= from && m.at < stopAt);
}

/** Failed (§5.2), for run workers and coordinators: the marker reads `failed`, FAILED_IDLE_MS have passed since the
 *  failure (and no more than BACKLOG_HORIZON_MS - FAILED_REPEAT_MS), and the pane reads idle or shell. Key: `stopAt`.
 *  Per `STOP_FAILURE_ERRORS` class:
 *  - an unclassifiable token holds `failed-unknown` (the lane warns once, and it is never guessed);
 *  - `account` holds `failed-account`;
 *  - `provider` is none here: `providerRetry.ts#providerRetryVerdict` owns it, for every session;
 *  - `retry` mails the session itself, or goes to rung 2 `repeat` after a prior failure in the window;
 *  - `request` goes to rung 2 `request`.
 *  Rung 2 goes to a run worker's claimant, or to the operator when there is none, when coordination is paused, or
 *  for a coordinator. */
function stallFailedInner(input: StallSessionInput, now: number): StallVerdict {
  if (input.role === 'other') return VERDICT_NONE;
  const held = stallSessionHold(input, now);
  if (held !== null) return held;
  const m = stallCurrentMark(input);
  if (m === null || m.state !== 'failed' || m.stopAt === null || now - m.stopAt < FAILED_IDLE_MS) return VERDICT_NONE;
  // `failed-arm-bounded-by-the-mail-horizon` (D-3752): a run-less repeat is told from a first failure by a prior failed:
  // self-mail at most FAILED_REPEAT_MS before this stop, and the lane's mail read keeps BACKLOG_HORIZON_MS. Past this
  // bound that evidence may be gone, so the arm answers none rather than re-read a repeat as a first failure.
  if (now - m.stopAt > BACKLOG_HORIZON_MS - FAILED_REPEAT_MS) return VERDICT_NONE;
  const live = stallSessionLive(input);
  if (live === null || !isIdleWord(live.word)) return VERDICT_NONE;
  const key = m.stopAt;
  const cls = stopFailureClass(m.err);
  if (cls === null) return holdVerdict('failed-unknown');
  if (cls === 'account') return holdVerdict('failed-account');
  if (cls === 'provider') return VERDICT_NONE;   // `providerRetry.ts`'s
  const err = m.err ?? '';
  const subject = stallFailedSubject(err, m.stopAt);
  if (cls === 'retry' && !stallPriorFailure(input, m.stopAt, subject)) {
    return stallSelfRungDone(input, 'failed', key, subject) ? VERDICT_NONE : { act: 'notify', arm: 'failed', rung: 1, key, to: 'worker', err };
  }
  if (stallRecordedDone(input, 'failed', 2, key)) return VERDICT_NONE;
  const because = cls === 'retry' ? 'repeat' : 'request';
  const r = input.run;
  if (stallRunBound(input) && r !== null && r.claimedBy !== null && !input.coordinationPaused) {
    return { act: 'notify', arm: 'failed', rung: 2, key, to: 'coordinator', coordinatorId: r.claimedBy, err, because };
  }
  return { act: 'notify', arm: 'failed', rung: 2, key, to: 'operator', err, because };
}

export function stallFailedVerdict(input: StallSessionInput, now: number): StallVerdict {
  return stallMailDisabledHold(stallFailedInner(input, now), input.arming);
}

/** failed rung 1 (retry class), to the session. */
function stallFailedMail(input: StallSessionInput, err: string, stopAt: number): StallNoticeText {
  const next = input.role === 'worker'
    ? "If it fails again, mail the coordinator (toId 'coordinator', kind status) what failed and when, rather than retrying again."
    : 'If it fails again, report what failed and when to whoever you owe a report, rather than retrying again.';
  return {
    subject: stallFailedSubject(err, stopAt),
    body: [
      stallSelfHead(STALL_FAILED_WORD, input),
      `Your turn ended at ${stallUtcSec(stopAt)} on an API error (${stallSafe(err)}), a kind a retry can clear, and your main loop has been idle since.`,
      `Retry the step that failed, once. ${next}`,
    ].join('\n'),
  };
}

/** failed rung 2, to the coordinator: a report. */
function stallFailedReportMail(input: StallSessionInput, err: string, because: 'repeat' | 'request', stopAt: number): StallNoticeText {
  const run = input.run;
  if (run === null) throw new RangeError('stallSessionMail: a failed report names its run, and this session is on none');
  const e = stallSafe(err);
  // "Told" only when a first failure's rung 1 went out live. A shadow row records the failure
  // and sent nothing (it stands while the self-mail is unarmed), so the report names when that first failure happened and that it was recorded only in shadow.
  const priors = stallPriorFailedNotices(input, stopAt);
  const first = priors.reduce<StallNotice | null>((f, n) => (f === null || n.key < f.key ? n : f), null);
  const toldLine = priors.some((n) => n.mode === 'live')
    ? 'It was told to retry once after the first.'
    : first === null ? 'It was not told to retry.' : `A first failure at ${stallUtcSec(first.key)} was recorded only in shadow, so it was not told to retry.`;
  return {
    subject: stallW2ReportSubject(run, 'failed', `${e} ${because === 'repeat' ? 'twice' : 'request error'} at ${stallUtc(stopAt)}`),
    body: [
      stallReportHead(run),
      because === 'repeat'
        ? `${stallWorkerRef(run)}: its turn ended on an API error (${e}) at ${stallUtcSec(stopAt)}, its second retryable failure within ${stallSpan(FAILED_REPEAT_MS)}. ${toldLine}`
        : `${stallWorkerRef(run)}: its turn ended on an API error (${e}) at ${stallUtcSec(stopAt)}. A retry fails the same way, so it was not told to retry.`,
      `Ack this and act once: mail the worker what to do instead, or mail it a subject beginning "${STALL_WAIT_PREFIX}" naming what it waits for.`,
    ].join('\n'),
  };
}

/** The mail of one session arm's notice: the `failed` arm's own, or `stall.ts`'s. */
export function stallSessionMail(input: StallSessionInput, n: StallNotify, now: number): StallNoticeText {
  if (n.arm === 'failed' && n.to === 'worker') return stallFailedMail(input, n.err, n.key);
  if (n.arm === 'failed' && n.to === 'coordinator') return stallFailedReportMail(input, n.err, n.because, n.key);
  return stallArmMail(input, n, now);
}
