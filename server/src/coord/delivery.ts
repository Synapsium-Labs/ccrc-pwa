/**
 * THE MAIL DELIVERY POLICY (ARCH-19, #539; D-792, D-1066, D-1068, D-1069, D-2369, D-5838, D-5912, D-5997). L1: pure
 * deciders and no I/O. `FleetWatcher.mailPass` gathers the facts a rung needs, asks one decider here, and executes the
 * `DeliveryAction` that comes back; it makes no retry, park or reject choice of its own.
 *
 * The choices live in five deciders, one per rung of the due-row ladder that ends in a write:
 *  - `decideRecipientAbsent`: the recipient has no registry row, or one that is listed but unreadable;
 *  - `decideSessionDead`: tmux proved the pane gone and the lifecycle says it is not coming back;
 *  - `decideTmuxUnknown`: tmux did not answer;
 *  - `decideSendFailure`: `sendPrompt` refused. THE GUARD ORDER IS THE POLICY, and `delivery-decide.test.ts` holds each
 *    adjacent pair with a recorded reorder mutant: an armed auto-continue and a running turn are holds, ahead of the
 *    attempts ceiling (a hold is not a failed send); a row that has been delivered never parks (its own history
 *    disproves `undeliverable`); a parked row past the park ceiling rejects ahead of re-parking;
 *  - `decideParked` and `decideReplayCeiling`: the two ceilings that end a row from outside the ladder.
 *
 * The rungs that only name a gate (`same-sweep`, `cooldown`, `pending-ask`, `not-idle`, ...) stay in `watch.ts`: each
 * is spelled as a literal at its call because the D-792 structure scan counts them there, and none of them writes a
 * schedule. A rung whose decision needs a read the ladder takes lazily (the live file, the turn marker) is decided at
 * that read, not from facts gathered up front, so the number of reads a refusal costs does not change.
 *
 * Only `MailRejectCode` literals in `coord/` and `store.ts` write a rejection; `watch.ts` carries none.
 */
import { MAIL_MAX_ATTEMPTS, type MailRejectCode } from '../../../shared/api.js';
import { PR_BACKOFF_MAX_MS } from '../laneSchedule.js';

/** WHAT `MAIL_MAX_ATTEMPTS` MEANS, kept beside the code that enforces it. The
 *  VALUE moved to `shared/api.ts` in Task 408 — `MailSummary.attempts` puts
 *  the running count on the wire, so the PWA now names the same budget and a
 *  second `6` in the client would be a second copy of a policy number. The
 *  reasoning stays here, where the ceiling is actually applied.
 *
 *  The PRE-DELIVERY attempt budget, and the spacing between attempts —
 *  applies ONLY while a delivery's own `deliveredAt` is still null (review
 *  finding 4). A row that has NEVER been delivered PARKS at the cap — since
 *  D-5838 (#754) the durable, still-outstanding parked state, no longer
 *  `rejected('undeliverable')` while its recipient lives (`MAIL_PARK_RETRY_MS`
 *  below) — and THE MAIL ROW IS UNTOUCHED (spec:170-172): the record of what
 *  was said survives the failure to say it. The instant `deliveredAt` is set, this budget stops applying: the
 *  row's own history already disproves 'undeliverable', so a failing REPLAY
 *  backs off instead of rejecting on THIS counter — `attempts` keeps
 *  counting on a delivered row too (it is one cumulative column), just
 *  without a ceiling that turns a failing SEND into a park.
 *
 *  A delivered row's own park is `MAIL_REPLAY_MAX_ATTEMPTS` below, a
 *  SEPARATE counter over successful replays (fix — review finding 20: before
 *  it existed, a delivery no one ever acked replayed "forever, bounded by
 *  ack rather than by a count" — true, and that is exactly what left
 *  spec:170-172's own terminal state structurally unreachable for any
 *  delivery that succeeded even once, since `MAIL_COOLDOWN_MS` only SPACES
 *  the injections and a send that keeps succeeding can never fail its way
 *  into this counter).
 *
 *  That is also what makes the constant below real (review finding 9): a
 *  NEVER-delivered row's own schedule (attempts 1..5, 30 s doubling to 8 min)
 *  never reaches `MAIL_BACKOFF_MAX_MS` before `MAIL_MAX_ATTEMPTS` parks it —
 *  `Math.min` never binds on that path and the ceiling is decorative there.
 *  A delivered row's `attempts` is not capped at 6, so by attempt 6
 *  (30 000 * 2^5 = 960 000) `Math.min` genuinely clamps to the ceiling —
 *  doubling from 30 s to the same 15-minute ceiling `PR_BACKOFF_MAX_MS`
 *  already uses, one ceiling for "this keeps not working" across the whole
 *  watcher. */
export const MAIL_BACKOFF_BASE_MS = 30_000;
export const MAIL_BACKOFF_MAX_MS = PR_BACKOFF_MAX_MS;

/** D-2369: how long a nudge is held when the recipient's own auto-continue is
 *  armed. Not a backoff step: the recipient is not failing, it is waiting, so
 *  the hold counts no attempt and `MAIL_MAX_ATTEMPTS` cannot park it. Five
 *  minutes against a reset that may be hours away: cheap re-reads, and the
 *  first sweep after the session resumes delivers. */
export const MAIL_ARMED_HOLD_MS = 300_000;

/** Worker stall watch §4.1: how long a nudge is held when `sendPrompt` refused
 *  it `turn-running`. The live word delivered it (`shell`), but the pane's last
 *  8 rows showed `esc to interrupt`. Like `MAIL_ARMED_HOLD_MS`, this is not a
 *  backoff step. The recipient is not failing, so the hold counts no attempt
 *  and `MAIL_MAX_ATTEMPTS` cannot park it. Unlike that hold, the sender is not
 *  told, because a running turn is not a blocked recipient. *Chosen*, 60 s: a
 *  turn may end in seconds, while `MAIL_ARMED_HOLD_MS` is sized for a usage-limit
 *  reset. */
export const MAIL_TURN_HOLD_MS = 60_000;

/** The ceiling on successful, UNACKED replays (review finding 20) — see
 *  `MAIL_MAX_ATTEMPTS`'s own docstring for why that counter cannot serve
 *  this role. At `MAIL_REPLAY_MS` (10 min) between replays, 20 attempts is
 *  a little over three hours of a recipient provably receiving the same
 *  envelope and never acking it — long enough that an ordinary slow ack
 *  (a session busy on something else for a while) never comes close, short
 *  enough that `MAIL_COOLDOWN_MS`'s own docstring's "denial of service
 *  dressed as coordination" eventually parks rather than running for the
 *  life of the box. */
export const MAIL_REPLAY_MAX_ATTEMPTS = 20;

/** THE PARKED STATE (D-5838, #754). A mail is never rejected as
 *  undeliverable while its recipient session is alive. Measured before this:
 *  in 21 days five wave briefs to new workers and two workers' done-mails to
 *  their coordinators were rejected — `enter-ignored` on the FIRST attempt (the
 *  nudge sat in a fresh box), or `draft-present` at `MAIL_MAX_ATTEMPTS` after
 *  about 15 minutes of a human's unsent text — and the sending session was never
 *  told. Now such a row PARKS (`CoordStore.parkDelivery`): still `queued`, so
 *  every outstanding reader keeps it, and:
 *   - the sweep PROBES its recipient's box (`readBoxText`, at most every
 *     `MAIL_PARK_PROBE_MS`) and wakes it the moment the box differs from what it
 *     held at the park — a draft cleared or changed;
 *   - otherwise it is re-attempted every `MAIL_PARK_RETRY_MS`, through every
 *     gate, so a recipient that has since died or stopped is rejected exactly as
 *     before (the lifecycle rung) — the park keeps no dead recipient's mail;
 *   - an `enter-ignored` park never TYPES while its box still holds what it
 *     held at the park — that would put the nudge under itself. On its timer, a
 *     box holding exactly our own nudge is resumed by `sendPrompt`'s
 *     `resumeIfOwn` arm (a correspondence-checked Enter, never a blind one, never
 *     a retype), at most once per retry; any other unchanged text is held with
 *     nothing pressed. A box the park could not read is unknown, not empty
 *     (`parkBoxSeen`);
 *   - its SENDING session is told once, by system mail; the operator is told
 *     once, at `MAIL_PARK_ESCALATE_MS` parked (`tellSender`'s push, its tag
 *     `mail-parked-<id>`);
 *   - at `MAIL_PARK_CEILING_MS` parked it is rejected, with a `lastError` that
 *     says so (`parkExpiredError`). */
export const MAIL_PARK_RETRY_MS = 600_000;
export const MAIL_PARK_PROBE_MS = 30_000;
export const MAIL_PARK_ESCALATE_MS = 900_000;
export const MAIL_PARK_CEILING_MS = 24 * 60 * 60_000;
/** The park ceiling's `lastError` (D-5838) — free text, the reason appended. */
export const parkExpiredError = (reason: string | null): string =>
  `parked 24 h, never delivered: ${reason ?? 'unknown'}`;

/** The replay-ceiling park's own `lastError`, written by exactly one decider here (`decideReplayCeiling`) and read back
 *  by exactly one other (`CoordStore.markAcked`, deviation D-67-b / orchestrator ruling I2): a shared constant rather
 *  than the same literal typed twice, so the two can never drift apart and silently stop recognising each other's
 *  writes. `store.ts` re-exports it. */
export const MAIL_REPLAY_CEILING_ERROR = 'replayed without ack past the replay ceiling';

/** What the sweep does with a delivery, decided here and executed in `watch.ts` (one executor per kind). */
export type DeliveryAction =
  /** Retry later. `countsAsAttempt` is whether the failure spends the row's attempts budget. */
  | { readonly kind: 'backOff'; readonly why: string; readonly until: number; readonly countsAsAttempt: boolean }
  /** Retry later because the recipient is waiting, not failing: counts no attempt. The sender is told once, and only
   *  for the hold that names a blocked recipient. */
  | { readonly kind: 'hold'; readonly why: 'auto-continue-armed' | 'turn-running'; readonly until: number;
      readonly tellSender: boolean }
  /** The recipient is alive and its box would not take the nudge: parked, still queued, re-attempted on a timer. */
  | { readonly kind: 'park'; readonly reason: string; readonly retryAt: number; readonly tellSender: boolean;
      readonly escalate: boolean }
  /** A terminal rejection. `told` is the park the sender is told was rejected (its reason, null when unknown), or null
   *  for a rejection that sends no notice. */
  | { readonly kind: 'reject'; readonly code: MailRejectCode; readonly error: string;
      readonly told: { readonly reason: string | null } | null };

/** The kinds `settle` in `watch.ts` writes; the others need a read or a notice around the write. */
export type SettleAction = Extract<DeliveryAction, { kind: 'backOff' | 'reject' }>;

export interface DueFacts {
  readonly attempts: number;
  readonly deliveredAt: number | null;
  readonly parkedAt: number | null;
  readonly lastError: string | null;
}

/** The one back-off schedule: 30 s doubling to the watcher's one 15-minute ceiling. `attempts` is the count the delay
 *  is for (1 is the first). */
const stepMs = (attempts: number): number => Math.min(MAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1), MAIL_BACKOFF_MAX_MS);

/**
 * The recipient has no registry row (`unmeasurable` false) or has one that could not be read (`unmeasurable` true).
 * A row that cannot be measured NEVER parks and counts no attempt: the recipient plainly exists (D-37), so it backs off
 * for ever. Only a recipient PROVEN absent counts toward the ceiling, and at it the row is rejected, delivered or not:
 * this is the one rung that ends a delivered row, because `cancelOutstandingDeliveries` is run-scoped and a purged slug
 * is re-minted for a stranger (D-1069). A delivered row's record says so.
 */
export function decideRecipientAbsent(d: Pick<DueFacts, 'attempts' | 'deliveredAt'>, unmeasurable: boolean, now: number): SettleAction {
  const attempts = d.attempts + 1;
  if (attempts >= MAIL_MAX_ATTEMPTS && !unmeasurable) {
    return { kind: 'reject', code: 'undeliverable', told: null,
      error: d.deliveredAt === null ? 'recipient not in registry'
        : 'recipient purged after this message was delivered, and never acked' };
  }
  return { kind: 'backOff', countsAsAttempt: !unmeasurable, until: now + stepMs(attempts),
    why: unmeasurable ? 'registry row listed but unreadable (registry-unmeasurable)' : 'recipient not in registry' };
}

/**
 * tmux proved the pane gone and `lifecycle` (a `sessionLifecycle` word that `lifecycleIsDead` named) says it will not
 * come back. It takes the absent rung's terms (back off, count, reject at the ceiling) EXCEPT that a DELIVERED row
 * never rejects (D-1066): its own history disproves `undeliverable`. It still counts attempts, because the count is
 * what makes the cap reachable (D-1068).
 */
export function decideSessionDead(d: Pick<DueFacts, 'attempts' | 'deliveredAt'>, lifecycle: string, now: number): SettleAction {
  const attempts = d.attempts + 1;
  const error = `recipient session is ${lifecycle}`;
  if (d.deliveredAt === null && attempts >= MAIL_MAX_ATTEMPTS) return { kind: 'reject', code: 'undeliverable', error, told: null };
  return { kind: 'backOff', why: error, until: now + stepMs(attempts), countsAsAttempt: true };
}

/** tmux did not answer (D-309): a substrate outage must never walk a row toward a park, so it counts no attempt and
 *  the step is read from the attempts as they stand. The tmux message is the diagnosis and rides in the reason. */
export function decideTmuxUnknown(d: Pick<DueFacts, 'attempts'>, detail: string, now: number): SettleAction {
  return { kind: 'backOff', why: `tmux did not answer (substrate-unknown): ${detail}`,
    until: now + Math.min(MAIL_BACKOFF_BASE_MS * 2 ** d.attempts, MAIL_BACKOFF_MAX_MS), countsAsAttempt: false };
}

/** The two stash refusals are a delivery's gate as well as its `lastError` (D-5912); no other refusal is. */
export type SendFailureGate = 'stash-failed' | 'stash-occupied';

/**
 * `sendPrompt` refused `error`. The guards, in order, each ahead of the next on purpose:
 *  1. `auto-continue-armed` (D-2369) and `turn-running` (worker stall watch §4.1) are HOLDS: the recipient is waiting,
 *     not failing, so they sit ahead of the attempts ceiling and count nothing. Only the first tells the sender, once.
 *  2. A row that has NEVER been delivered parks (D-5838) on `enter-ignored` at once, at the attempts ceiling, or when
 *     it is already parked. A delivered row never parks: that would write a false `undeliverable` over a message that
 *     reached the recipient.
 *  3. A parked row past the park ceiling is rejected, ahead of re-parking, and its sender is told.
 *  4. Anything else backs off on the attempts ceiling's own schedule, counting.
 */
export function decideSendFailure(
  d: DueFacts, error: string, now: number,
): { readonly gate: SendFailureGate | null; readonly action: DeliveryAction } {
  if (error === 'auto-continue-armed') {
    return { gate: null, action: { kind: 'hold', why: error, until: now + MAIL_ARMED_HOLD_MS, tellSender: d.lastError !== error } };
  }
  if (error === 'turn-running') {
    return { gate: null, action: { kind: 'hold', why: error, until: now + MAIL_TURN_HOLD_MS, tellSender: false } };
  }
  const gate = error === 'stash-failed' || error === 'stash-occupied' ? error : null;
  const attempts = d.attempts + 1;
  if (d.deliveredAt === null && (error === 'enter-ignored' || attempts >= MAIL_MAX_ATTEMPTS || d.parkedAt !== null)) {
    if (d.parkedAt !== null && now - d.parkedAt >= MAIL_PARK_CEILING_MS) {
      return { gate, action: { kind: 'reject', code: 'undeliverable', error: parkExpiredError(error), told: { reason: error } } };
    }
    const first = d.parkedAt === null;
    return { gate, action: { kind: 'park', reason: error, retryAt: now + MAIL_PARK_RETRY_MS, tellSender: first,
      escalate: first && error !== 'enter-ignored' } };
  }
  return { gate, action: { kind: 'backOff', why: error, until: now + stepMs(attempts), countsAsAttempt: true } };
}

/**
 * A PARKED row, looked at every sweep, due or not (D-5838). Past the park ceiling it is rejected and its sender told.
 * Otherwise the operator's one escalation is due at `MAIL_PARK_ESCALATE_MS` parked, and `waiting` says its retry timer
 * has not come round (only then is the box worth probing; the probe's own throttle and claim stay with the sweep).
 */
export function decideParked(
  p: { readonly parkedAt: number; readonly parkReason: string | null; readonly parkEscalatedAt: number | null;
       readonly nextAttemptAt: number }, now: number,
): Extract<DeliveryAction, { kind: 'reject' }> | { readonly kind: 'keep'; readonly escalate: boolean; readonly waiting: boolean } {
  if (now - p.parkedAt >= MAIL_PARK_CEILING_MS) {
    return { kind: 'reject', code: 'undeliverable', error: parkExpiredError(p.parkReason), told: { reason: p.parkReason } };
  }
  return { kind: 'keep', escalate: p.parkEscalatedAt === null && now - p.parkedAt >= MAIL_PARK_ESCALATE_MS,
    waiting: p.nextAttemptAt > now };
}

/** A REPLAY just landed and was counted: at `MAIL_REPLAY_MAX_ATTEMPTS` unacked replays the row is rejected. */
export function decideReplayCeiling(replayCount: number): SettleAction | null {
  return replayCount >= MAIL_REPLAY_MAX_ATTEMPTS
    ? { kind: 'reject', code: 'undeliverable', error: MAIL_REPLAY_CEILING_ERROR, told: null } : null;
}
