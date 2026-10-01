import { REVIEW_DONE_SUBJECT, WAVE_DONE_SUBJECT, isRunState, isSessionLifecycle, lifecycleIsDead } from '../../../shared/api.js';
import type { MailGate } from '../../../shared/api.js';
/**
 * The worker stall watch's pure half (design 2026-09-29 §4.2, wave 1). L1: clock-free, fs-free, fastify-free and
 * store-free. `stall-vocabulary.test.ts` pins that, and the coord-ring scan in `single-definition.test.ts` forbids
 * this file `./db.js` and `node:sqlite`. Its one permitted value import is L0, `shared/api.ts`.
 *
 * Spelled ONCE here: the subject prefixes, and the observation-detail heads that `stallDetail` writes and
 * `parseStallDetail` reads back. `single-definition.test.ts` reds on a second quoted copy anywhere in the four
 * source roots. The arms, holds and markers are each derived from one total Record, never from a hand list.
 *
 * The row shapes the lane reads (`StallRunRow`, `StallMailRow`) are L2 ports declared here, BY THE CONSUMER, as
 * `claims.ts` declares `LivenessProbe`. `store.ts` implements them and imports the types from this file.
 *
 * `mail-routes.test.ts` scans `server/src/coord` for quoted kebab words. Every such word this file spells, and every
 * one the store's stall reads spell with it, is declared to that scan through `isStallKebab`, its twelfth union. A
 * word added here without joining `STALL_KEBABS` reds that scan, which is the point.
 */

// ── the spelled-once strings ──────────────────────────────────────────────────────────────────────────────────

/** r1: a stall check, from the operator role to the worker. Recorded on the phone, never pushed. */
export const STALL_CHECK_PREFIX = 'stall-check:';
/** The worker's answer to a stall check. It is the worker's own mail, so it counts for the ball and the clock. */
export const STALL_REPLY_PREFIX = 're stall-check:';
/** The one reply that hands the run to the coordinator (the ball rule, §4.2). */
export const STALL_REPLY_WAITING_PREFIX = 're stall-check: waiting';
/** r2: a stall report, from the operator role to the coordinator. Pushed as a stall. */
export const STALL_REPORT_PREFIX = 'stall:';
/** A coordinator's hand-back. Sent to the worker, it gives the coordinator the ball and closes the episode. */
export const STALL_WAIT_PREFIX = 'wait:';
/** §5.2's orphan notices (D and E), from the operator role to the session itself. Class `self-wake`: recorded, never
 *  pushed, never mail on the run. */
export const STALL_ORPHANED_PREFIX = 'orphaned:';
/** §5.2's failed notice, from the operator role to the session itself. Class `self-wake`. */
export const STALL_FAILED_PREFIX = 'failed:';
/** The reply that says the worker is still working: r1's body names it, and I2's back-off (Task 17) counts it. */
const STALL_REPLY_WORKING_PREFIX = `${STALL_REPLY_PREFIX} working`;
/** The observation-detail heads: `stall:<arm>:<rung>:<key>` when sent, `stall-shadow:<arm>:<rung>:<key>` in shadow.
 *  They live in `run_events.detail`, never in a mail subject. `stallDetail` writes them, `parseStallDetail` reads
 *  them back, and nothing else spells them. */
const STALL_DETAIL_LIVE = 'stall';
const STALL_DETAIL_SHADOW = 'stall-shadow';
/** The sender every watch notice carries: the operator role (`SystemMailSender`), never a session. */
const STALL_SENDER = 'operator';

// ── arms, holds, markers ─────────────────────────────────────────────────────────────────────────────────────

/** The watch's arms: wave 1's (§4.2) and wave 2's (§5.2). Each key is added with the code that fires it, and
 *  `STALL_ARM_WAVE` says which wave's arming it answers to. */
const STALL_ARM_MAP = {
  quiet: 'the ladder: the worker holds the ball and has been idle past the quiet threshold (r1 worker, r2 coordinator, r3 operator)',
  'limit-cap': 'the usage-limit hold past its cap: one operator push per episode',
  'dialog-cap': 'a dialog with no question behind it, past the quiet threshold: one operator push per episode',
  'coord-ball': 'the coordinator has held the ball past its cap with no mail on the run: one operator push per episode',
  'orphan-d': 'a restart killed background tasks the session ran at its last turn end, and it sat idle past ORPHAN_D_IDLE_MS (any session): a mail to it, then an operator push',
  'orphan-e': 'the session ended its turn over a wake-bearing background task and sat idle past ORPHAN_E_IDLE_MS with no turn: a mail to it',
  failed: 'the turn ended on a StopFailure and the session sat idle past FAILED_IDLE_MS: by its STOP_FAILURE_ERRORS class, a mail to it or to the coordinator',
  frozen: 'the marker reads working under a busy word and no hook event arrived for FROZEN_NO_EVENT_MS: the coordinator, or the operator',
  dead: 'the worker read orphan or never-started, or was absent from the registry, for DEAD_GRACE_MS: the coordinator, or the operator',
  'coord-deaf': 'the worker passed the ball to its coordinator and that mail sat unacked for COORD_DEAF_MS: one operator push',
  'mail-stuck': 'a delivery to the session stayed queued MAIL_STUCK_MS after its main loop went idle, or behind a registry gate: one operator push per delivery',
  'marker-unreadable': 'the turn marker read unmeasured or malformed for MARKER_UNREADABLE_MS: one operator push per episode',
} as const;
export type StallArm = keyof typeof STALL_ARM_MAP;
export const STALL_ARMS = Object.keys(STALL_ARM_MAP) as StallArm[];
function isStallArm(v: string): v is StallArm {
  return Object.prototype.hasOwnProperty.call(STALL_ARM_MAP, v);
}
/** Which wave's arming each arm answers to. A wave-2 arm needs `stall-watch-w2-live` besides its recipient's markers
 *  (`stallNotifyDelivery`; planning departure `w2-arms-ship-dark`). Total over the arms, so a new arm is a compile
 *  error until it is placed. */
const STALL_ARM_WAVE: Record<StallArm, 1 | 2> = {
  quiet: 1, 'limit-cap': 1, 'dialog-cap': 1, 'coord-ball': 1,
  'orphan-d': 2, 'orphan-e': 2, failed: 2, frozen: 2, dead: 2, 'coord-deaf': 2, 'mail-stuck': 2, 'marker-unreadable': 2,
};

/** Why a verdict holds (§4.2 holds 1 to 4, in §10's order). A hold defers a rung and never cancels it. */
const STALL_HOLD_MAP = {
  'run-unnamed': 'the run reads `unknown`, or a state or kind this build cannot name',
  absent: 'the worker is not among the sessions of this tick (wave 2 owns the dead arm)',
  unmeasured: 'an input the verdict needs could not be measured',
  lifecycle: 'the worker is restarting, or its lifecycle reads a dead word',
  ask: 'the worker asked a question that is still open (the asks lane owns it)',
  dialog: 'a dialog with no question behind it, below its cap',
  limit: 'a usage limit, a strand, a blocked swap or a recent auto-continue hold, below its cap',
  busy: 'the worker reads busy, which wave 1 cannot tell apart from a turn in flight',
  'coordinator-unmeasurable': 'r2 is due and the coordinator could not be measured',
  'restart-grace': 'a restart cut a turn short less than RESTART_GRACE_MS ago, and the redrive owns it (§5.1)',
  delegates: 'the main loop is quiet while current subagent hook events arrive, inside DELEGATE_WINDOW_MS and below DELEGATE_CAP_MS (the quiet arm only)',
  'lifecycle-stopped': 'the worker was stopped deliberately and its stop record says so: never the dead arm (§11 item 10)',
  'mail-disabled': 'a rung would send mail while the operator has mail switched off: held, never rerouted',
  'failed-account': 'the turn ended on an account-class StopFailure: the limit, swap and authdead machinery owns it',
  'failed-unknown': 'the turn ended on a StopFailure token this build cannot classify: never guessed into a self-wake',
} as const;
export type StallHold = keyof typeof STALL_HOLD_MAP;
export const STALL_HOLDS = Object.keys(STALL_HOLD_MAP) as StallHold[];

/** The lane's registry markers. None has a writer in the tree. Each is touched and removed by hand on the fleet box,
 *  following the `mail-disabled` precedent, and the lane reads them from one listing per tick. */
const STALL_MARKER_MAP = {
  'stall-watch-disabled': 'the lane returns: nothing is recorded or sent',
  'stall-watch-live': 'notices to the stalled session itself are sent (r1); absent, every arm is shadow',
  'stall-watch-escalate': 'with the live marker, coordinator notices and operator pushes are sent',
  'stall-watch-w2-live': 'the wave-2 arms may send under the other two markers; absent, every wave-2 arm records shadow only',
} as const;
export type StallMarker = keyof typeof STALL_MARKER_MAP;
export const STALL_MARKERS = Object.keys(STALL_MARKER_MAP) as StallMarker[];

/** The store reads the lane depends on. Each fails as its own word, following D-2545's all-or-failure idiom. */
export const STALL_READ_FAILURES = ['run-unreadable', 'mail-unreadable', 'delivery-unreadable'] as const;
export type StallReadFailure = (typeof STALL_READ_FAILURES)[number];
/** Why an observation write (or a notice) recorded nothing: the run already holds this exact detail, or the run is
 *  gone, meaning absent or no longer active (D-3584). `store.ts` answers with these words. */
export const STALL_WRITE_MISSES = ['duplicate', 'run-gone'] as const;
export type StallWriteMiss = (typeof STALL_WRITE_MISSES)[number];

// ── arming and delivery ──────────────────────────────────────────────────────────────────────────────────────

/** `w2Live` and `mailDisabled` are optional, so wave 1's literals stay valid; absent reads as false
 *  (`w2-arming-optional`). `stallArmingOf` always sets `w2Live`. The lane sets `mailDisabled` from `watch.ts`'s own
 *  module-local marker constant, and the verdict filter (Task 11) reads it. */
export interface StallArming { readonly disabled: boolean; readonly live: boolean; readonly escalate: boolean; readonly w2Live?: boolean; readonly mailDisabled?: boolean }

/** One registry listing (the one `tick()` already took) gives the arming. A marker is a whole file name. */
export function stallArmingOf(names: readonly string[]): StallArming {
  const has = (m: StallMarker): boolean => names.includes(m);
  return { disabled: has('stall-watch-disabled'), live: has('stall-watch-live'), escalate: has('stall-watch-escalate'), w2Live: has('stall-watch-w2-live') };
}

export type StallRecipient = 'worker' | 'coordinator' | 'operator';

/** A notice to the stalled session itself is sent under the live marker. A notice to a coordinator, and every
 *  operator push, needs the escalate marker as well. Anything else is recorded in shadow. */
export function stallDelivery(to: StallRecipient, arming: StallArming): 'send' | 'shadow' {
  if (to === 'worker') return arming.live ? 'send' : 'shadow';
  return arming.live && arming.escalate ? 'send' : 'shadow';
}

/** A rung's delivery: a wave-2 arm is shadow until `stall-watch-w2-live` is touched, whatever its recipient's markers
 *  say (planning departure `w2-arms-ship-dark`); otherwise `stallDelivery`. `mailDisabled` is not a delivery: it is
 *  the verdict filter's hold. */
export function stallNotifyDelivery(arm: StallArm, to: StallRecipient, arming: StallArming): 'send' | 'shadow' {
  return STALL_ARM_WAVE[arm] === 2 && arming.w2Live !== true ? 'shadow' : stallDelivery(to, arming);
}

// ── observation details ──────────────────────────────────────────────────────────────────────────────────────

export type StallMode = 'live' | 'shadow';
export interface StallNotice { readonly mode: StallMode; readonly arm: StallArm; readonly rung: 1 | 2 | 3; readonly key: number; readonly at: number }

/** The `run_events.detail` of one rung's observation. The key is an epoch or an id: a non-negative safe integer. */
export function stallDetail(mode: StallMode, arm: StallArm, rung: 1 | 2 | 3, key: number): string {
  // parseStallDetail cannot read back a non-integer key. The rung would then never count as done, and the lane
  // would send it again on every tick. So the key is refused here, loudly, rather than written.
  if (!Number.isSafeInteger(key) || key < 0) throw new RangeError(`stallDetail: the key must be a non-negative safe integer, got ${String(key)}`);
  return `${mode === 'live' ? STALL_DETAIL_LIVE : STALL_DETAIL_SHADOW}:${arm}:${rung}:${key}`;
}

/** Every `run_events` row that is not exactly a stall detail of this build reads null, and the lane ignores it. That
 *  covers transitions, routing details, and a wave-2 arm this build cannot name. */
export function parseStallDetail(detail: string | null): Omit<StallNotice, 'at'> | null {
  if (detail === null) return null;
  const parts = detail.split(':');
  if (parts.length !== 4) return null;
  const [head, arm, rungText, keyText] = parts as [string, string, string, string];
  const mode: StallMode | null = head === STALL_DETAIL_LIVE ? 'live' : head === STALL_DETAIL_SHADOW ? 'shadow' : null;
  if (mode === null) return null;
  if (!isStallArm(arm)) return null;
  const rung = rungText === '1' ? 1 : rungText === '2' ? 2 : rungText === '3' ? 3 : null;
  if (rung === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/.test(keyText)) return null;
  const key = Number(keyText);
  if (!Number.isSafeInteger(key)) return null;
  return { mode, arm, rung, key };
}

// ── the L2 ports: the rows this consumer reads (store.ts implements them) ─────────────────────────────────────

export interface StallRunRow { readonly id: number; readonly kind: string; readonly state: string; readonly sessionId: string;
  readonly claimedBy: string | null; readonly dispatchedAt: number | null; readonly program: string; readonly wave: number;
  readonly waveOf: number | null; readonly project: string; readonly workspace: string | null }
/** `runId` is null for run-less mail: a session notice, or a peer's mail that wave 2's per-session read carries. */
export interface StallMailRow { readonly id: number; readonly at: number; readonly runId: number | null; readonly fromId: string;
  readonly toId: string; readonly kind: string; readonly subject: string }
/** One delivery row as the watch reads it (§5.2 mail-stuck and coord-deaf). The gate columns are selected as plain
 *  columns and judged here, in L1, never filtered on by the store (D-792's pins); the sticky error text is never read. */
export interface StallDeliveryRow { readonly id: number; readonly mailId: number; readonly toId: string; readonly state: string; readonly deliveredAt: number | null; readonly ackedAt: number | null; readonly lastGate: string | null; readonly gateSince: number | null }

// ── grouping ─────────────────────────────────────────────────────────────────────────────────────────────────

/** One worker, judged once. `runs` holds every candidate run on that session in id order, `primary` included. */
export interface StallSubject { readonly primary: StallRunRow; readonly runs: readonly StallRunRow[] }

/** Dispatch time as an order key. A never-dispatched run ranks below every dispatched one. */
const stallDispatchedOrder = (r: StallRunRow): number => r.dispatchedAt ?? Number.NEGATIVE_INFINITY;

/** True when `a` is the more recently dispatched run. A tie goes to the greater id. */
function stallOutranks(a: StallRunRow, b: StallRunRow): boolean {
  const ta = stallDispatchedOrder(a);
  const tb = stallDispatchedOrder(b);
  return ta !== tb ? ta > tb : a.id > b.id;
}

/** Groups by sessionId. The primary is the greatest dispatchedAt (null ranks lowest), with ties going to the greater
 *  id. Pure and order-stable: subjects come out in primary-id order and runs in id order, whatever the input order. */
export function stallSubjects(rows: readonly StallRunRow[]): StallSubject[] {
  const bySession = new Map<string, StallRunRow[]>();
  for (const r of rows) {
    const group = bySession.get(r.sessionId);
    if (group === undefined) bySession.set(r.sessionId, [r]);
    else group.push(r);
  }
  const subjects: StallSubject[] = [];
  for (const group of bySession.values()) {
    const runs = group.sort((a, b) => a.id - b.id);
    let primary = runs[0]!;
    for (const r of runs) if (stallOutranks(r, primary)) primary = r;
    subjects.push({ primary, runs });
  }
  return subjects.sort((a, b) => a.primary.id - b.primary.id);
}

// ── the push classifier ──────────────────────────────────────────────────────────────────────────────────────

/** The watch's own mail classes, one total Record, so `isStallKebab` derives `self-wake` from it (§4.2, §5.2). */
const STALL_MAIL_CLASS_MAP = {
  check: 'r1: a stall-check subject from the operator role (recorded on the phone, never pushed)',
  reply: 'a bound reply to a stall check, from the run worker (recorded, never pushed)',
  report: 'a stall-report subject from the operator role: r2, and the frozen, dead and failed reports (pushed)',
  'self-wake': 'an orphaned or failed notice from the operator role to the session itself (recorded, never pushed)',
} as const;
export type StallMailClass = keyof typeof STALL_MAIL_CLASS_MAP;
export interface StallBind { readonly runSessionId: string | null; readonly runId: number | null; readonly firstCheckId: number | null }

/** A reply is BOUND when all of these hold: it is from the run's own worker; it is on that run; and it came after the
 *  first stall check there. Only a bound reply is kept off the phone, so a holder of the box token cannot use the
 *  prefix alone to hide a mail. */
function stallReplyBound(m: { readonly fromId: string; readonly runId: number | null; readonly mailId: number }, bind: StallBind): boolean {
  return bind.runSessionId !== null && m.fromId === bind.runSessionId
    && m.runId !== null && m.runId === bind.runId
    && bind.firstCheckId !== null && bind.firstCheckId < m.mailId;
}

/** 'check': a stall-check subject from the operator role. 'report': a stall-report subject from the operator role.
 *  'self-wake': an orphaned or failed subject from the operator role (wave 2's notices to the session itself).
 *  'reply': a reply subject that is bound (above). Anything else: null, which means ordinary mail. */
export function stallMailClass(
  m: { readonly fromId: string; readonly runId: number | null; readonly subject: string; readonly mailId: number },
  bind?: StallBind,
): StallMailClass | null {
  if (m.fromId === STALL_SENDER && m.subject.startsWith(STALL_CHECK_PREFIX)) return 'check';
  if (m.fromId === STALL_SENDER && m.subject.startsWith(STALL_REPORT_PREFIX)) return 'report';
  // 'self-wake' is tested after check and report, so a report naming a failure stays a report.
  if (m.fromId === STALL_SENDER && (m.subject.startsWith(STALL_ORPHANED_PREFIX) || m.subject.startsWith(STALL_FAILED_PREFIX))) return 'self-wake';
  if (bind !== undefined && m.subject.startsWith(STALL_REPLY_PREFIX) && stallReplyBound(m, bind)) return 'reply';
  return null;
}

// ── the kebab guard (mail-routes.test.ts, twelfth union) ─────────────────────────────────────────────────────

/** The one mail-gate word the watch reads (§5.2 mail-stuck: a delivery whose last gate stays this word). Typed against
 *  L0's `MailGate` through a type-only import, so a renamed gate is a compile error here. */
const STALL_GATE_WORD_MAP: Record<Extract<MailGate, 'registry-unmeasurable'>, string> = {
  'registry-unmeasurable': 'the registry could not be listed at the gate; mail-stuck times it from its gate stamp',
};
/** Every kebab word this file spells, and every one the store's stall reads spell with it, each taken from its own
 *  Record or tuple. A later task that spells a new kebab word in `server/src/coord` for the watch adds its tuple
 *  HERE. */
const STALL_KEBABS: ReadonlySet<string> = new Set<string>([
  ...STALL_ARMS,
  ...STALL_HOLDS,
  ...STALL_MARKERS,
  ...STALL_READ_FAILURES,
  ...STALL_WRITE_MISSES,
  STALL_DETAIL_SHADOW,
  ...Object.keys(STALL_MAIL_CLASS_MAP),
  ...Object.keys(STALL_GATE_WORD_MAP),
]);

/** True for every kebab token the watch spells in `server/src/coord`. It is derived, never a hand list. */
export function isStallKebab(token: string): boolean {
  return STALL_VERDICT_KEBABS.has(token) || STALL_KEBABS.has(token);
}

// ===========================================================================
// Task 5: the verdict. Spec §4.2 and §10's evaluation order, the wave-1
// subset. First match wins: (1) a run this build cannot name; (2) a worker
// absent from the tick, then any unmeasured input; (3) lifecycle; (4) hold
// 2a, then 2b; (5) the limit hold, capped; (6) the coordinator's ball;
// (7) the worker's ball and its ladder. Pure: every clock is `now`, and every
// fact arrives in `StallInput`. The lane (watch.ts) applies the answer and
// decides nothing.
// ===========================================================================

/** r1 falls due after this much quiet. Spec §10: the census replay; the 1–2 h band is almost all legit. */
export const STALL_QUIET_MS = 2 * 3_600_000;
/** r2 falls due this long after r1, or after the word last turned idle: coordinator reply p90 is 1.56 h. */
export const STALL_ESCALATE_MS = 3_600_000;
/** r3 falls due this long after r2, on the same re-timing rule. */
export const STALL_OPERATOR_MS = 3_600_000;
/** The limit hold's cap: the longest of 19 legit limit waits. Past it, one `limit-cap` push per episode. */
export const LIMIT_HOLD_CAP_MS = 12.5 * 3_600_000;
/** An auto-continue hold begun within this window is a limit hold. *Chosen*: the mail replay cadence. */
export const AUTO_CONTINUE_RECENT_MS = 10 * 60_000;
/** The coordinator's ball has a cap, above the 28.7 h legit maximum (§11 decision 9). */
export const COORD_BALL_CAP_MS = 30 * 3_600_000;
/** Hold 2a: a hookstate ask stamped no earlier than the live dialog's stamp minus this is that dialog's
 *  question, however old it is (planning departure D-3565 ask-hold-correlates-the-dialog). */
export const ASK_DIALOG_SLACK_MS = 60_000;

// ── wave 2's constants (design 2026-09-29 §10), each with its basis ─────────────────────────────────────────
/** §5.1 (d), §11 decision 7: with a marker that reads, r2 falls due this long after r1 at the latest. *Chosen*: it
 *  bounds every episode at r1 + 4 h. */
export const STALL_BOUND_MS = 3 * 3_600_000;
/** The `delegates` hold's window. The longest foreground call measured was 28.3 min. */
export const DELEGATE_WINDOW_MS = 30 * 60_000;
/** The `delegates` hold's cap on main silence. At 4 h, subagent activity covered 1 of 101 gaps. */
export const DELEGATE_CAP_MS = 4 * 3_600_000;
/** The frozen arm: more than twice the longest legitimate call (28.3 min). */
export const FROZEN_NO_EVENT_MS = 60 * 60_000;
/** The dead arm's grace. A respawn was measured at 9 s; this is 5 × `SUPERVISED_FRESH_MS`. */
export const DEAD_GRACE_MS = 10 * 60_000;
/** coord-deaf. Acks precede replies, and 85% of 792 coordinator replies came within 1 h. */
export const COORD_DEAF_MS = 3_600_000;
/** mail-stuck: 1.2 h, the p90 of mail-to-first-read over 1,206 worker mails. Written in minutes, so it is exact. */
export const MAIL_STUCK_MS = 72 * 60_000;
/** orphan (D). 13 of 21 orphaned restarts self-healed within 2.4 min; the earliest human pick-up was 37 min. */
export const ORPHAN_D_IDLE_MS = 15 * 60_000;
/** orphan (E). *Chosen*. */
export const ORPHAN_E_IDLE_MS = 10 * 60_000;
/** failed. *Chosen*. */
export const FAILED_IDLE_MS = 10 * 60_000;
/** failed: a second retry-class StopFailure inside this window goes to the coordinator. *Chosen*. */
export const FAILED_REPEAT_MS = 2 * 3_600_000;
/** §5.1 (c): a stall check still undelivered this long after it was queued is proof for r2. *Chosen*. */
export const CHECK_UNDELIVERED_MS = 2 * 3_600_000;
/** The first enable must not wake long-abandoned sessions: orphan (D) and the per-session mail read look back this
 *  far. *Chosen*. */
export const BACKLOG_HORIZON_MS = 24 * 3_600_000;
/** orphan (D) rung 2: its notice unacked this long after delivery, or undelivered this long after queueing. *Chosen*. */
export const ORPHAN_PUSH_MS = 30 * 60_000;
/** marker-unreadable: the marker read `unmeasured` or `malformed` this long on a candidate. *Chosen*. */
export const MARKER_UNREADABLE_MS = 3_600_000;

// ── StopFailure's error tokens (§5.2) ────────────────────────────────────────────────────────────────────────
/** 2.1.277–2.1.284's own StopFailure matcher list, identical in every installed lane, in §5.2's three classes.
 *  `retry`: a self-mail, then the coordinator on a repeat. `account`: a hold, because the limit, swap and authdead
 *  machinery owns it. `request`: the coordinator, because a retry fails the same way. It is one total Record, and
 *  the classifier reads it through `hasOwnProperty`, so an inherited name is never a token. */
const STOP_FAILURE_ERROR_MAP = {
  server_error: 'retry', overloaded: 'retry', max_output_tokens: 'retry', unknown: 'retry',
  rate_limit: 'account', billing_error: 'account', authentication_failed: 'account', oauth_org_not_allowed: 'account',
  account_on_hold: 'account', verification_required: 'account', cloud_credential_error: 'account',
  invalid_request: 'request', model_not_found: 'request',
} as const;
export type StopFailureError = keyof typeof STOP_FAILURE_ERROR_MAP;
export type StopFailureClass = 'retry' | 'account' | 'request';
export const STOP_FAILURE_ERRORS: Readonly<Record<StopFailureError, StopFailureClass>> = STOP_FAILURE_ERROR_MAP;
/** null for a token this build cannot classify (never guessed): the failed arm holds `failed-unknown`. */
export function stopFailureClass(err: string | null): StopFailureClass | null {
  if (err === null || !Object.prototype.hasOwnProperty.call(STOP_FAILURE_ERROR_MAP, err)) return null;
  return STOP_FAILURE_ERROR_MAP[err as StopFailureError];
}

// ── the kind and event sets, each spelled once ───────────────────────────────────────────────────────────────
/** Each background kind a turn end can wake with, and whether it resumes the session on its own (§5.1 proof (a))
 *  or only could have woken it (§5.2 E; a shell, clause 16). One total Record with unquoted keys: a bracketed list
 *  of two of these words reads as a copy of L0's `ROUTE_WRITABLE_FIELDS` to single-definition's route-field scan. */
const STALL_BG_KIND_MAP = { subagent: 'resumes', workflow: 'resumes', shell: 'wakes' } as const;
/** §5.2 orphan (E): the kinds whose end could have woken the session. A shell counts here: E detects a task that
 *  could have woken it and did not. */
export const STALL_WAKE_KINDS: readonly string[] = Object.keys(STALL_BG_KIND_MAP);
/** §5.1 proof (a): the kinds that resume the session on their own when they end. A shell does not (clause 16). */
export const STALL_RESUMING_KINDS: readonly string[] = STALL_WAKE_KINDS.filter((k) => STALL_BG_KIND_MAP[k as keyof typeof STALL_BG_KIND_MAP] === 'resumes');
/** §5.1 "the one bounded exception": hook events that are plumbing. They never refresh the frozen clock or the
 *  `delegates` hold. */
export const STALL_PLUMBING_EVENTS: readonly string[] = ['SessionStart', 'PreCompact', 'PostCompact'];

// ── the report classifier (Contract note 8) ──────────────────────────────────────────────────────────────────
/** Every report is a `stall:` subject from the operator role. A wave-2 report names its kind right after the run,
 *  `stall: run <id> — <kind>: …`; the wave-1 r2 names none and reads `stall`. */
const STALL_REPORT_KINDS = ['stall', 'frozen', 'dead', 'failed'] as const;
export type StallReportKind = (typeof STALL_REPORT_KINDS)[number];
export function stallReportKind(subject: string): StallReportKind {
  if (!subject.startsWith(STALL_REPORT_PREFIX)) return 'stall';
  const dash = subject.indexOf(' — ');
  if (dash < 0) return 'stall';
  const head = subject.slice(dash + 3);
  for (const k of STALL_REPORT_KINDS) if (k !== 'stall' && head.startsWith(k + ':')) return k;
  return 'stall';
}
/** A report's phone title, `⚠ <kind> › <workspace>`. The workspace is printed only when it matches the id pattern. */
export function stallReportTitle(kind: StallReportKind, ws: string): string {
  return `⚠ ${kind} › ${stallSafe(ws)}`;
}

// ── the self-wake subjects (planning departure self-mail-subjects-carry-the-date) ───────────────────────────
// Each subject carries the date and minute, not the spec's bare time: the run-less dedupe searches every mail row
// ever sent, and a bare time would make a later day's episode at the same minute read as a duplicate. Defined here,
// before the verdicts, because the session verdicts (Task 12) find a notice already sent by its exact subject.

/** Kinds, sanitised and joined, or `kinds unrecorded`. */
function stallKinds(values: readonly string[]): string {
  return values.length === 0 ? 'kinds unrecorded' : values.map(stallSafe).join(', ');
}
/** orphan (D): the count and kinds the restart killed, and the restart's minute. */
export function stallOrphanDSubject(m: Pick<TurnMark, 'lostBg' | 'lostKinds' | 'restartAt'>): string {
  return `${STALL_ORPHANED_PREFIX} ${stallInt(m.lostBg)} background task(s) (${stallKinds(m.lostKinds)}) did not survive the ${stallUtc(m.restartAt ?? Number.NaN)} restart`;
}
/** orphan (E): the first wake-bearing kind in the marker's order, and the turn end's minute. */
export function stallOrphanESubject(m: Pick<TurnMark, 'bgKinds' | 'stopAt'>): string {
  const kind = m.bgKinds.find((k) => STALL_WAKE_KINDS.includes(k)) ?? 'task';
  return `${STALL_ORPHANED_PREFIX} your background ${stallSafe(kind)} ended at ${stallUtc(m.stopAt ?? Number.NaN)} without waking you`;
}
/** failed: the error token and the turn end's minute. */
export function stallFailedSubject(err: string, stopAt: number): string {
  return `${STALL_FAILED_PREFIX} your turn ended on an API error (${stallSafe(err)}) at ${stallUtc(stopAt)}`;
}

/** The worker's RAW live word. The lane reads it itself (tmux pane pid, config dir, then the measured
 *  live-state read), never `FleetSession.status`, which is a collapse. Every `ok: false` reason is hold 1. */
export type LiveWordRead =
  | { readonly ok: true; readonly word: string; readonly since: number | null }
  | { readonly ok: false; readonly reason: 'no-pane' | 'no-config-dir' | 'no-state' | 'unmeasured' };
/** Total over the unread reasons: `isStallKebab` derives them, and a new reason is a compile error here. */
const LIVE_WORD_UNREAD_MAP: Record<Extract<LiveWordRead, { ok: false }>['reason'], string> = {
  'no-pane': 'tmux gave no pane pid: a gone pane and a tmux that did not answer fold here',
  'no-config-dir': 'the wrapper config dir did not resolve',
  'no-state': 'no live file for the pane pid',
  unmeasured: 'the live file could not be read',
};

/** The hookstate ask, read identity-gated but NOT aged (the lane's unaged hookstate read). `approval` is a
 *  PermissionRequest approval envelope. L1 decides what it holds (M7b, `approval-is-a-hook-ask-fact`): it is never 2a. */
export type HookAskFact = { readonly kind: 'ask'; readonly at: number } | { readonly kind: 'approval'; readonly at: number } | { readonly kind: 'none' } | { readonly kind: 'unmeasured' };
/** The raw hookstate (§5.1 "the one bounded exception"): no identity cut and no age cut. The `delegates` hold and the
 *  frozen clock read it. A `sessionId` of `''` is never current (Contract note 9). */
export type HookRawFact = { readonly ok: true; readonly updatedAt: number; readonly event: string | null; readonly sessionId: string; readonly identity: 'current' | 'foreign' | 'unregistered' } | { readonly ok: false; readonly reason: 'absent' | 'unmeasured' | 'malformed' };
/** The frozen arm's clock. It is the later of the turn's start and the newest current, non-plumbing hook event, or the
 *  turn's start alone when that event is plumbing. It is null (unmeasurable, never elapsed time) when the marker or
 *  the hook does not read, or when the hook is not the current session's. A null event is not plumbing: the spec
 *  names three events. */
export function stallFrozenSince(mark: TurnMarkRead, hook: HookRawFact): number | null {
  if (!mark.ok || !hook.ok || hook.identity !== 'current' || hook.sessionId === '') return null;
  const turnStart = mark.turnAt ?? mark.at;
  if (hook.event !== null && STALL_PLUMBING_EVENTS.includes(hook.event)) return turnStart;
  return Math.max(turnStart, hook.updatedAt);
}
/** The marker-unreadable condition, in L1 once (the L1 ruling): the marker was read and could not be measured or
 *  parsed. `absent`, `foreign` and `stale` are not it: each has its own meaning to the verdicts. The verdict's step
 *  (2a) (Task 11), `stallSessionMarkerInner` (Task 12) and the lane's `markUnreadableSince` clock (Task 15) call this
 *  and never spell the two reasons again. */
export function stallMarkUnreadable(m: TurnMarkRead): boolean {
  return !m.ok && (m.reason === 'unmeasured' || m.reason === 'malformed');
}
/** The dead arm's lifecycles, in L1 once (the L1 ruling): an orphan or a never-started pane. A deliberate `stopped`
 *  worker is never dead-shaped (§11 item 10; it holds `lifecycle-stopped`). The verdict's step (3) (Task 11) and the
 *  lane's `deadSince` clock (Task 15) call this and never spell the two words again. */
export function stallDeadShaped(lifecycle: string | null): lifecycle is 'orphan' | 'never-started' {
  return lifecycle === 'orphan' || lifecycle === 'never-started';
}
/** The worker's newest asks row. */
export type AskRowFact = { readonly kind: 'row'; readonly state: string; readonly at: number } | { readonly kind: 'none' } | { readonly kind: 'unmeasured' };
export type StallWorker =
  | { readonly present: false }
  | { readonly present: true; readonly unmeasured: boolean; readonly lifecycle: string | null;
      readonly limits: { readonly five: number | null; readonly seven: number | null } | null;
      readonly dialogPending: boolean; readonly stranded: boolean; readonly swapBlocked: boolean;
      readonly live: LiveWordRead; readonly hookAsk: HookAskFact; readonly askRow: AskRowFact;
      /** The START of the newest auto-continue hold (nextAttemptAt − MAIL_ARMED_HOLD_MS, computed in watch.ts), or null. */
      readonly autoContinueHeldAt: number | null };
export type CoordinatorState = 'alive' | 'dead' | 'unmeasurable';
export interface StallInput {
  readonly subject: StallSubject;
  readonly worker: StallWorker;
  readonly mail: readonly StallMailRow[];      // every mail row on subject.runs' ids
  readonly notices: readonly StallNotice[];     // parsed from runEvents(subject.primary.id)
  readonly arming: StallArming;
  readonly coordinationPaused: boolean;         // $REG/coordinator-paused in the tick's listing
  readonly coordinator: CoordinatorState | null; // null = not measured this pass
  readonly w2?: StallW2Facts;                   // wave 2's facts; absent = the lane read none, and wave 1's verdict stands
}
/** Wave 2's facts about the subject's worker (`w2-facts-separate-object`): `StallFacts` is unchanged. `absentSince`,
 *  `deadSince` and `markUnreadableSince` are the lane's in-memory first-seen times. They restart with the server. */
export interface StallW2Facts { readonly mark: TurnMarkRead; readonly hook: HookRawFact; readonly deliveries: readonly StallDeliveryRow[]; readonly absentSince: number | null; readonly deadSince: number | null; readonly markUnreadableSince: number | null }
export type StallR3Cause = 'still-silent' | 'coordinator-dead' | 'no-coordinator' | 'coordination-paused';
/** Total over the r3 causes, for `isStallKebab`. */
const STALL_R3_CAUSE_MAP: Record<StallR3Cause, string> = {
  'still-silent': 'the coordinator was told at r2, and the worker is still silent an hour later',
  'coordinator-dead': 'r2 skipped: the claimant measured dead, so the reclaim door applies',
  'no-coordinator': 'r2 skipped: the run has no claimant, and no door is named',
  'coordination-paused': 'r2 skipped: coordination is paused; the pause route lifts it',
};
/** Why wave 2's frozen or dead arm fired (§5.2). Total, for `isStallKebab`. */
export type StallW2Cause = 'registry-absent' | 'orphan' | 'never-started' | 'no-hook-event';
const STALL_W2_CAUSE_MAP: Record<StallW2Cause, string> = {
  'registry-absent': 'dead: the worker has been missing from the tick for DEAD_GRACE_MS (absent-worker-is-dead-after-grace)',
  orphan: 'dead: the lifecycle has read orphan for DEAD_GRACE_MS',
  'never-started': 'dead: the lifecycle has read never-started for DEAD_GRACE_MS',
  'no-hook-event': 'frozen: a turn in flight under a busy word with no main hook event for FROZEN_NO_EVENT_MS',
};
export type StallNotify =
  | { readonly act: 'notify'; readonly arm: 'quiet'; readonly rung: 1; readonly key: number; readonly to: 'worker' }
  | { readonly act: 'notify'; readonly arm: 'quiet'; readonly rung: 2; readonly key: number; readonly to: 'coordinator'; readonly coordinatorId: string }
  | { readonly act: 'notify'; readonly arm: 'quiet'; readonly rung: 3; readonly key: number; readonly to: 'operator'; readonly because: StallR3Cause }
  | { readonly act: 'notify'; readonly arm: 'limit-cap' | 'dialog-cap' | 'coord-ball'; readonly rung: 1; readonly key: number; readonly to: 'operator' }
  | { readonly act: 'notify'; readonly arm: 'frozen' | 'dead'; readonly rung: 1; readonly key: number; readonly to: 'coordinator'; readonly coordinatorId: string; readonly because: StallW2Cause }
  | { readonly act: 'notify'; readonly arm: 'frozen' | 'dead'; readonly rung: 1; readonly key: number; readonly to: 'operator'; readonly because: StallW2Cause }
  | { readonly act: 'notify'; readonly arm: 'coord-deaf' | 'mail-stuck' | 'marker-unreadable'; readonly rung: 1; readonly key: number; readonly to: 'operator' }
  | { readonly act: 'notify'; readonly arm: 'orphan-d' | 'orphan-e'; readonly rung: 1; readonly key: number; readonly to: 'worker' }
  | { readonly act: 'notify'; readonly arm: 'orphan-d'; readonly rung: 2; readonly key: number; readonly to: 'operator' }
  | { readonly act: 'notify'; readonly arm: 'failed'; readonly rung: 1; readonly key: number; readonly to: 'worker'; readonly err: string }
  | { readonly act: 'notify'; readonly arm: 'failed'; readonly rung: 2; readonly key: number; readonly to: 'coordinator'; readonly coordinatorId: string; readonly err: string; readonly because: 'repeat' | 'request' }
  | { readonly act: 'notify'; readonly arm: 'failed'; readonly rung: 2; readonly key: number; readonly to: 'operator'; readonly err: string; readonly because: 'repeat' | 'request' };
export type StallVerdict =
  | { readonly act: 'none' }
  | { readonly act: 'hold'; readonly why: StallHold }
  | { readonly act: 'measure-coordinator'; readonly coordinatorId: string }
  | StallNotify;
/** Total over the verdict's acts, for `isStallKebab` (planning departure D-3570 r2-measures-on-demand). */
const STALL_ACT_MAP: Record<StallVerdict['act'], string> = {
  none: 'nothing is due',
  hold: 'a hold defers every rung and cancels none',
  'measure-coordinator': 'r2 is due: the lane measures the claimant and asks again',
  notify: 'a rung or a cap fires',
};
/** This block's kebab words, derived from its total Records, never a hand list. */
const STALL_VERDICT_KEBABS: ReadonlySet<string> = new Set([
  ...Object.keys(LIVE_WORD_UNREAD_MAP), ...Object.keys(STALL_R3_CAUSE_MAP), ...Object.keys(STALL_ACT_MAP),
  ...Object.keys(STALL_W2_CAUSE_MAP),
]);

/** Exported for tests and for the bodies (Task 6): the derived facts the verdict used. */
export interface StallFacts { readonly ball: 'worker' | 'coordinator'; readonly episodeKeyMs: number; readonly quietSince: number | null;
  readonly workerLast: StallMailRow | null; readonly inboundLast: StallMailRow | null; readonly lastExchangeAt: number | null }

const VERDICT_NONE: StallVerdict = { act: 'none' };

function holdVerdict(why: StallHold): StallVerdict {
  return { act: 'hold', why };
}

function capVerdict(arm: 'limit-cap' | 'dialog-cap' | 'coord-ball', key: number): StallVerdict {
  return { act: 'notify', arm, rung: 1, key, to: 'operator' };
}

function r3Verdict(key: number, because: StallR3Cause): StallVerdict {
  return { act: 'notify', arm: 'quiet', rung: 3, key, to: 'operator', because };
}

function newestMail(rows: readonly StallMailRow[], pick: (m: StallMailRow) => boolean): StallMailRow | null {
  let best: StallMailRow | null = null;
  for (const m of rows) if (pick(m) && (best === null || m.id > best.id)) best = m;
  return best;
}

/** The watch's own notices are not mail on the run: a stall-check to the worker, a stall report to the coordinator,
 *  and an orphaned or failed notice to the session itself. Counting them would restart the clock the notice
 *  reports. A reply is the worker's mail. */
function isWatchNotice(m: StallMailRow): boolean {
  const c = stallMailClass({ fromId: m.fromId, runId: m.runId, subject: m.subject, mailId: m.id });
  return c === 'check' || c === 'report' || c === 'self-wake';
}

function isIdleWord(word: string): boolean {
  return word === 'idle' || word === 'shell';
}

/** Whose turn it is, read from the newest mail between the worker and anyone but the watch (spec §4.2).
 *  The worker's own mail hands over the ball only as a question, a done claim (subject EQUAL, never a
 *  prefix, and kind status) or a stall-check reply declaring a wait. Mail TO the worker hands over the
 *  ball only as a coordinator's wait:, so the server's rejections keep the ball with the worker. */
function ballToCoordinator(m: StallMailRow, workerId: string, coordinatorIds: ReadonlySet<string>): boolean {
  if (m.fromId === workerId) {
    if (m.kind === 'question') return true;
    if (m.kind === 'status' && (m.subject === WAVE_DONE_SUBJECT || m.subject === REVIEW_DONE_SUBJECT)) return true;
    return m.subject.startsWith(STALL_REPLY_WAITING_PREFIX);
  }
  return coordinatorIds.has(m.fromId) && m.subject.startsWith(STALL_WAIT_PREFIX);
}

/** The ids a coordinator's mail arrives from: the `coordinator` alias, and every claimant on the subject's runs.
 *  One definition, for `stallFacts` and for r3's text (D-3583 r3-reports-what-was-measured). */
function stallCoordinatorIds(runs: readonly StallRunRow[]): ReadonlySet<string> {
  const ids = new Set<string>(['coordinator']);
  for (const r of runs) if (r.claimedBy !== null) ids.add(r.claimedBy);
  return ids;
}

export function stallFacts(input: StallInput): StallFacts {
  const { primary, runs } = input.subject;
  const workerId = primary.sessionId;
  const coordinatorIds = stallCoordinatorIds(runs);
  const relevant = input.mail.filter((m) => !isWatchNotice(m) && (m.fromId === workerId || m.toId === workerId));
  const workerLast = newestMail(relevant, (m) => m.fromId === workerId);
  const inboundLast = newestMail(relevant, (m) => m.toId === workerId);
  const waitLast = newestMail(relevant, (m) => m.fromId !== workerId && coordinatorIds.has(m.fromId) && m.subject.startsWith(STALL_WAIT_PREFIX));
  const last = newestMail(relevant, () => true);
  const lastExchangeAt = relevant.reduce<number | null>((max, m) => (max === null || m.at > max ? m.at : max), null);
  const ball = last !== null && ballToCoordinator(last, workerId, coordinatorIds) ? 'coordinator' : 'worker';
  const episodeKeyMs = Math.max(workerLast?.at ?? 0, waitLast?.at ?? 0, primary.dispatchedAt ?? 0);
  const w = input.worker;
  const quietSince = w.present && w.live.ok && isIdleWord(w.live.word) && w.live.since !== null
    ? Math.max(w.live.since, workerLast?.at ?? 0, inboundLast?.at ?? 0, primary.dispatchedAt ?? 0)
    : null;
  return { ball, episodeKeyMs, quietSince, workerLast, inboundLast, lastExchangeAt };
}

/** I2, the working-reply back-off (planning departure `working-reply-backs-off`): the cap on the exponent, so r1's
 *  threshold is 2 h, then 4 h, then 8 h from the second answered check on. CHOSEN, not measured: the operator has
 *  not ruled on I2, and 8 h keeps a worker that only ever says "still working" inside one working day between
 *  checks. */
export const STALL_WORKING_BACKOFF_CAP = 2;

/**
 * I2: how long the marker branch (step 11, under `stall-watch-w2-live` with a readable marker) lets the worker go
 * quiet before r1. The wait backs off per check the worker answered ONLY with `re stall-check: working`. Such a
 * worker is not silent, and a 2 h check on every episode would teach it to ignore them.
 *
 * The streak walks the worker's own mail newest first (the watch's notices are not its mail), and stops at the first
 * subject that is not a working reply. So any other mail from the worker resets it, a `waiting` reply included, while
 * mail TO the worker neither counts nor resets. For each working reply in that run, its check is the newest
 * stall-check to this worker with a lower id. The streak counts the DISTINCT checks found
 * (`working-streak-counts-checks`): two replies to one check are one episode, and a reply with no check before it
 * answers nothing.
 *
 * Wave 1's ladder never calls this. Without the marker rules r1 stays at `STALL_QUIET_MS`, so dark means dark.
 */
export function stallBackoff(input: StallInput): { readonly streak: number; readonly quietMs: number } {
  const workerId = input.subject.primary.sessionId;
  const own = input.mail.filter((m) => m.fromId === workerId && !isWatchNotice(m)).sort((a, b) => b.id - a.id);
  const checks = new Set<number>();
  for (const m of own) {
    if (!m.subject.startsWith(STALL_REPLY_WORKING_PREFIX)) break;
    const check = newestMail(input.mail, (c) => c.id < m.id && c.toId === workerId
      && stallMailClass({ fromId: c.fromId, runId: c.runId, subject: c.subject, mailId: c.id }) === 'check');
    if (check !== null) checks.add(check.id);
  }
  const streak = checks.size;
  return { streak, quietMs: STALL_QUIET_MS * 2 ** Math.min(streak, STALL_WORKING_BACKOFF_CAP) };
}

/** The dialog and limit caps' clock: the same mail terms, from the live stamp whatever the word. The caller
 *  passes a MEASURED stamp: a null one is hold `unmeasured` before this is reached, never a 0. */
function capQuietSince(input: StallInput, f: StallFacts, liveSince: number): number {
  return Math.max(liveSince, f.workerLast?.at ?? 0, f.inboundLast?.at ?? 0, input.subject.primary.dispatchedAt ?? 0);
}

/** When a later rung falls due (spec §4.2: "r2 at r1 + 1 h ... r3 at r2 + 1 h"; a rung due while the worker
 *  reads busy waits, and its hour runs from the word turning idle or shell again). Stateless, on the RAW live
 *  stamp, never the quiet clock: a stamp inside the previous rung's hour (the rung's own turn restamps the
 *  worker) changes nothing, so the hour the r1 body promises holds; a stamp past that hour means the word
 *  turned again after the rung was due, so the hour runs from there. Mail does not re-time a rung: worker
 *  mail and a coordinator `wait:` close the episode through its key instead (D-3579 rung-due-on-the-raw-stamp). */
function rungDueAt(rungAt: number, liveSince: number, gap: number): number {
  return liveSince > rungAt + gap ? liveSince + gap : rungAt + gap;
}

/** Who hears each rung of each arm (planning departure `rung-recipient-per-arm`). The table is total over the arms,
 *  and a rung an arm does not have is absent from its row. Some rungs go to the operator instead: frozen or dead with
 *  no claimant or under a pause, and failed rung 2 likewise. Such a rung is armed exactly as its coordinator form
 *  (`stallDelivery` treats the two alike), so the shadow accounting reads the same answer either way. */
const STALL_RUNG_RECIPIENTS: Record<StallArm, readonly StallRecipient[]> = {
  quiet: ['worker', 'coordinator', 'operator'],
  'limit-cap': ['operator'], 'dialog-cap': ['operator'], 'coord-ball': ['operator'],
  'coord-deaf': ['operator'], 'mail-stuck': ['operator'], 'marker-unreadable': ['operator'],
  'orphan-d': ['worker', 'operator'],
  'orphan-e': ['worker'],
  failed: ['worker', 'coordinator'],
  frozen: ['coordinator'], dead: ['coordinator'],
};

export function rungRecipient(arm: StallArm, rung: 1 | 2 | 3): StallRecipient {
  const to = STALL_RUNG_RECIPIENTS[arm][rung - 1];
  if (to === undefined) throw new RangeError(`rungRecipient: ${arm} has no rung ${rung}`);
  return to;
}

/** Planning departure D-3572 shadow-rung-accounting. A rung is DONE when a live row exists for it, or when a
 *  shadow row exists and the rung's delivery is still shadow under the current markers, so arming
 *  mid-episode sends the pending rung once. Its time is its EARLIEST LIVE row when one exists, else its
 *  earliest row: a rung re-sent live is timed from the notice its recipient actually got, so the next
 *  rung waits the hour the r1 body promises (spec §4.2, "r2 at r1 + 1 h … r3 at r2 + 1 h"), and a rung
 *  standing in shadow is timed from its shadow row. Not done: null. */
function rungDoneAt(input: Pick<StallInput, 'notices' | 'arming'>, arm: StallArm, rung: 1 | 2 | 3, key: number): number | null {
  const rows = input.notices.filter((n) => n.arm === arm && n.rung === rung && n.key === key);
  const liveRow = rows.some((n) => n.mode === 'live');
  const shadowStands = rows.some((n) => n.mode === 'shadow') && stallNotifyDelivery(arm, rungRecipient(arm, rung), input.arming) === 'shadow';
  if (!liveRow && !shadowStands) return null;
  const live = rows.filter((n) => n.mode === 'live');
  const timed = live.length > 0 ? live : rows;
  return timed.reduce((earliest, n) => Math.min(earliest, n.at), Number.POSITIVE_INFINITY);
}

// ── wave 2: the run verdict's own helpers (design 2026-09-29 §5.1, §5.2, §10) ────────────────────────────────────
// `STALL_PLUMBING_EVENTS`, `STALL_RESUMING_KINDS` and `stallFrozenSince` are Task 10's exports, declared above; this
// block uses them and declares none of them.

/** A turn marker as the run verdict reads it (§5.1, "An interrupted turn"). Stop does not fire on an interrupt, so
 *  every Esc leaves the marker `working`. A `working` marker older than the live stamp, under live `idle` or
 *  `shell`, therefore reads as `done` at that stamp. Anything else reads as it was written. */
export function stallMarkView(mark: TurnMark, live: LiveWordRead): { readonly state: TurnMarkState; readonly stopAt: number | null; readonly interrupted: boolean } {
  if (mark.state === 'working' && live.ok && isIdleWord(live.word) && live.since !== null && mark.at < live.since) {
    return { state: 'done', stopAt: live.since, interrupted: true };
  }
  return { state: mark.state, stopAt: mark.stopAt, interrupted: false };
}

/** `run-mail-filtered-in-l1` (F4): `StallInput.mail` is exactly wave 1's set, the rows on the subject's runs. The
 *  lane's one mail read is wider, because the session arms and the deliveries need the rest, so the lane passes that
 *  read through here. A run-less row is on no run. */
export function stallRunMail(rows: readonly StallMailRow[], runIds: readonly number[]): StallMailRow[] {
  return rows.filter((m) => m.runId !== null && runIds.includes(m.runId));
}

/** M7a, `cited-check-derived-in-l1`: the r1 notice that r2's body cites. It is r1's earliest LIVE row on this key
 *  when one exists, else its earliest row: the timing `rungDoneAt` uses. Arming mid-episode leaves a shadow r1
 *  before the live one, and citing the shadow row would tell the coordinator that no check was sent when one was
 *  (`shadow-rung-accounting`, D-3572). */
export function stallCitedCheck(input: StallInput, key: number): StallNotice | null {
  const rows = input.notices.filter((n) => n.arm === 'quiet' && n.rung === 1 && n.key === key);
  const earliest = (xs: readonly StallNotice[]): StallNotice | null =>
    xs.reduce<StallNotice | null>((e, n) => (e === null || n.at < e.at ? n : e), null);
  return earliest(rows.filter((n) => n.mode === 'live')) ?? earliest(rows);
}

/** `lane-honours-mail-disabled` and `mail-disabled-holds-only-sends`. While `$REG/mail-disabled` stands, two things
 *  become hold `mail-disabled`: a rung that would SEND mail (to the worker or the coordinator), and r2's
 *  `measure-coordinator`. Operator pushes pass through, and so do shadow rungs (the lane still records their rows),
 *  holds and none. */
export function stallMailDisabledHold(v: StallVerdict, arming: StallArming): StallVerdict {
  if (arming.mailDisabled !== true) return v;
  if (v.act === 'measure-coordinator') return stallNotifyDelivery('quiet', 'coordinator', arming) === 'send' ? holdVerdict('mail-disabled') : v;
  if (v.act !== 'notify') return v;
  if (v.to === 'operator') return v;
  return stallNotifyDelivery(v.arm, v.to, arming) === 'send' ? holdVerdict('mail-disabled') : v;
}

/** The dead arm is due once its first-seen time is DEAD_GRACE_MS old and no row records it on this episode. */
function stallDeadDue(input: StallInput, since: number | null, key: number, now: number): boolean {
  return since !== null && now - since >= DEAD_GRACE_MS && rungDoneAt(input, 'dead', 1, key) === null;
}

/** Frozen and dead mail the run's claimant directly, or push to the operator when there is none or coordination is
 *  paused. */
function stallW2Notify(input: StallInput, arm: 'frozen' | 'dead', key: number, because: StallW2Cause): StallVerdict {
  const claimant = input.subject.primary.claimedBy;
  if (input.coordinationPaused || claimant === null) return { act: 'notify', arm, rung: 1, key, to: 'operator', because };
  return { act: 'notify', arm, rung: 1, key, to: 'coordinator', coordinatorId: claimant, because };
}

function stallPlumbing(event: string | null): boolean {
  return event !== null && STALL_PLUMBING_EVENTS.includes(event);
}

/** A raw hook fact that `delegates` may read: identity `current`, and a non-empty session id. A `''` session id is
 *  never current (Contract note 9). The frozen clock applies the same rule inside Task 10's `stallFrozenSince`. */
function stallHookCurrent(hook: HookRawFact): hook is Extract<HookRawFact, { ok: true }> {
  return hook.ok && hook.identity === 'current' && hook.sessionId !== '';
}

/** `delegates` (§5.1): a current, non-plumbing hook event inside DELEGATE_WINDOW_MS, which is subagent activity. */
function stallHookFresh(hook: HookRawFact, now: number): boolean {
  return stallHookCurrent(hook) && !stallPlumbing(hook.event) && now - hook.updatedAt < DELEGATE_WINDOW_MS;
}

/** The marker's quiet start (§5.1, "Quiet with the marker"): `stopAt`, maxed with the worker's last mail, the
 *  newest non-watch mail to it, and `dispatchedAt`. Null when the view has no `stopAt`. */
function stallMarkQuiet(view: { readonly stopAt: number | null }, f: StallFacts, dispatchedAt: number): number | null {
  return view.stopAt === null ? null : Math.max(view.stopAt, f.workerLast?.at ?? 0, f.inboundLast?.at ?? 0, dispatchedAt);
}

/** A mail's newest delivery row, or null when it has none. Exported and owned here (`newest-delivery-rule-lives-in-l1`):
 *  Task 12's session verdicts and Task 15's lane reuse it and never redeclare it. */
export function stallNewestDelivery(rows: readonly StallDeliveryRow[], mailId: number): StallDeliveryRow | null {
  let best: StallDeliveryRow | null = null;
  for (const d of rows) if (d.mailId === mailId && (best === null || d.id > best.id)) best = d;
  return best;
}

/** coord-deaf's mail (§5.2). It is the worker's newest ball-passing mail to a coordinator id: a question, or a status
 *  whose subject EQUALS wave-done or review-done. It counts only while its newest delivery row is unacked. A mail
 *  with NO delivery row is not deaf: nothing measured it unacked, so coord-deaf does not fire on it, and the
 *  coord-ball cap still does. */
function stallDeafMail(input: StallInput, deliveries: readonly StallDeliveryRow[]): StallMailRow | null {
  const worker = input.subject.primary.sessionId;
  const coordinatorIds = stallCoordinatorIds(input.subject.runs);
  const passed = newestMail(input.mail, (m) => m.fromId === worker && coordinatorIds.has(m.toId)
    && (m.kind === 'question' || (m.kind === 'status' && (m.subject === WAVE_DONE_SUBJECT || m.subject === REVIEW_DONE_SUBJECT))));
  if (passed === null) return null;
  const d = stallNewestDelivery(deliveries, passed.id);
  return d !== null && d.ackedAt === null ? passed : null;
}

/** r2 is due: the shipped decision on the coordinator's state (§4.2), which both ladders share. */
function stallR2Due(input: StallInput, key: number): StallVerdict {
  const p = input.subject.primary;
  if (input.coordinationPaused) return r3Verdict(key, 'coordination-paused');
  if (p.claimedBy === null) return r3Verdict(key, 'no-coordinator');
  if (input.coordinator === null) return { act: 'measure-coordinator', coordinatorId: p.claimedBy };
  if (input.coordinator === 'alive') return { act: 'notify', arm: 'quiet', rung: 2, key, to: 'coordinator', coordinatorId: p.claimedBy };
  if (input.coordinator === 'unmeasurable') return holdVerdict('coordinator-unmeasurable');
  return r3Verdict(key, 'coordinator-dead');
}

/** §10 step 11 without the w2 marker, or without a current turn marker: wave 1's ladder, unchanged. The quiet clock
 *  (the live stamp, and any mail) gates r1 only. A later rung falls due an hour after the previous one on the RAW
 *  live stamp (`rungDueAt`), so it re-times only when a busy read pushed the word's turn to idle past that hour. */
function stallWaveOneLadder(input: StallInput, f: StallFacts, word: string, liveSince: number, key: number, now: number): StallVerdict {
  if (word === 'busy') return holdVerdict('busy');
  if (!isIdleWord(word) || f.quietSince === null) return holdVerdict('unmeasured');
  const since = f.quietSince;
  const r1At = rungDoneAt(input, 'quiet', 1, key);
  if (r1At === null) return now - since >= STALL_QUIET_MS ? { act: 'notify', arm: 'quiet', rung: 1, key, to: 'worker' } : VERDICT_NONE;
  if (rungDoneAt(input, 'quiet', 3, key) !== null) return VERDICT_NONE;
  const r2At = rungDoneAt(input, 'quiet', 2, key);
  if (r2At !== null) return now >= rungDueAt(r2At, liveSince, STALL_OPERATOR_MS) ? r3Verdict(key, 'still-silent') : VERDICT_NONE;
  if (now < rungDueAt(r1At, liveSince, STALL_ESCALATE_MS)) return VERDICT_NONE;
  return stallR2Due(input, key);
}

/** Escalation on proof (§5.1): with a current marker, r2 falls due at the first of (a) to (d). The check is this
 *  episode's own: the newest stall check to the worker, queued inside the episode. A worker mail after the check
 *  opens a new episode (the key moves), so "no worker mail since the check" is the key's rule and is not a term here.
 *  The marker keeps only the newest Stop (`proof-a-reads-the-newest-stop`), and a StopFailure is not a Stop. */
function stallProofDue(input: StallInput, mark: TurnMark, deliveries: readonly StallDeliveryRow[], key: number, r1At: number, now: number): boolean {
  // (d) the bound: r2 at the latest STALL_BOUND_MS after r1, whatever the Stops showed
  if (now >= r1At + STALL_BOUND_MS) return true;
  const last = stallLastCheck(input);
  // `proofs-read-checks-in-the-episode`: (a) and (c) read only a check queued inside this episode, never an earlier one.
  const check = last !== null && last.at >= key ? last : null;
  const d = check === null ? null : stallNewestDelivery(deliveries, check.id);
  // (a) the Stop after a delivered check carries a measured bg and nothing that could still wake the worker. The Stop
  // must be a `done` mark (`proof-a-requires-a-done-mark`: a StopFailure is not a Stop). The spec's "no worker mail since
  // the check" term is not here (`proof-a-drops-the-unreachable-term`: that mail moves the key, so proofs are never reached).
  if (d !== null && d.deliveredAt !== null && mark.state === 'done' && mark.stopAt !== null && mark.stopAt > d.deliveredAt
    && mark.bg >= 0 && !mark.bgKinds.some((k) => STALL_RESUMING_KINDS.includes(k))) return true;
  // (b) two orphan-e rows inside the episode: the worker re-armed and ended again without mail
  if (new Set(input.notices.filter((n) => n.arm === 'orphan-e' && n.key > key).map((n) => n.key)).size >= 2) return true;
  // (c) the check is still undelivered CHECK_UNDELIVERED_MS after it was queued
  return check !== null && d !== null && d.deliveredAt === null && now - check.at >= CHECK_UNDELIVERED_MS;
}

/** The limit-hold condition (§10 step (6)), the ONE definition: `stallVerdictInner` and the session verdicts
 *  (`stallSessionHold`, `stallSessionMarkerInner`) both call it, so the run verdict and the session verdicts cannot
 *  disagree on what a limited worker is. A window at its ceiling, a strand, a blocked swap, or an auto-continue hold
 *  begun within AUTO_CONTINUE_RECENT_MS. A null `limits` or a null window is neither at the ceiling nor unmeasured. */
function stallLimited(w: Extract<StallWorker, { present: true }>, now: number): boolean {
  const lim = w.limits;
  const atCeiling = lim !== null && ((lim.five !== null && lim.five >= 100) || (lim.seven !== null && lim.seven >= 100));
  const autoContinueRecent = w.autoContinueHeldAt !== null && w.autoContinueHeldAt > now - AUTO_CONTINUE_RECENT_MS;
  return atCeiling || w.stranded || w.swapBlocked || autoContinueRecent;
}

/** §10's evaluation order after wave 2, wrapped by the mail-disabled filter (`lane-honours-mail-disabled`). */
export function stallVerdict(input: StallInput, now: number): StallVerdict {
  return stallMailDisabledHold(stallVerdictInner(input, now), input.arming);
}

/** §10 after wave 2. The first match wins:
 *  (1) a run this build cannot name;
 *  (2) the marker-unreadable push, then a worker absent from the tick (the dead arm after DEAD_GRACE_MS), then an
 *      unmeasured fleet row, lifecycle or dispatch;
 *  (3) lifecycle: a deliberate stop holds; an orphan or never-started pane is the dead arm after DEAD_GRACE_MS;
 *  (4) the live read, and under the w2 marker an unmeasured turn marker;
 *  (5) hold 2a, then 2b;
 *  (6) the limit hold;
 *  (7) restart grace;
 *  (8) frozen;
 *  (9) delegates;
 *  (10) the coordinator's ball: coord-deaf, the cap, or none;
 *  (11) the worker's ball: under the w2 marker, on the marker clock and escalating on proof; otherwise wave 1's
 *      ladder.
 *  Without `stall-watch-w2-live`, every LIVE outcome is wave 1's (`dark-mode-keeps-wave-1-verdict`). A wave-2 arm
 *  still answers `notify`, `stallNotifyDelivery` makes it shadow, and its standing shadow row marks it done.
 *  Exception (i): a shadow arm takes its sweep, so THREE arms can defer a wave-1 send by one sweep, once per the
 *  arm's own key: `marker-unreadable` (step 2a: it precedes EVERY wave-1 outcome, so it can defer r1, measure-coordinator,
 *  r2, r3 and the caps alike), `coord-deaf` (ahead of the coord-ball cap) and `frozen` (step 8, ahead of the coord-ball
 *  cap, for a busy worker with a `working` marker). The lane guarantees that `input.mail` is run-scoped (`stallRunMail`,
 *  F4). */
function stallVerdictInner(input: StallInput, now: number): StallVerdict {
  const p = input.subject.primary;
  // (1) a run this build cannot name
  if (!isRunState(p.state) || p.state === 'unknown') return holdVerdict('run-unnamed');
  if (p.kind !== 'work' && p.kind !== 'review') return holdVerdict('run-unnamed');
  const w2 = input.w2;
  const w2Live = input.arming.w2Live === true;
  const mark = w2?.mark;
  const okMark = mark !== undefined && mark.ok ? mark : null;
  const markReason = mark !== undefined && !mark.ok ? mark.reason : null;
  const f = stallFacts(input);
  const key = f.episodeKeyMs;
  // (2a) the marker-unreadable push: spec-exact, ahead of every unmeasured input, once per episode. The reasons that
  // count live once, in Task 10's `stallMarkUnreadable` (the L1 ruling).
  if (w2 !== undefined && stallMarkUnreadable(w2.mark) && w2.markUnreadableSince !== null
    && now - w2.markUnreadableSince >= MARKER_UNREADABLE_MS && rungDoneAt(input, 'marker-unreadable', 1, key) === null) {
    return { act: 'notify', arm: 'marker-unreadable', rung: 1, key, to: 'operator' };
  }
  // (2b) a worker absent from this tick holds (`absent-worker-holds`, D-3566), and is the dead arm after DEAD_GRACE_MS (`absent-worker-is-dead-after-grace`)
  const w = input.worker;
  if (!w.present) {
    return w2 !== undefined && stallDeadDue(input, w2.absentSince, key, now) ? stallW2Notify(input, 'dead', key, 'registry-absent') : holdVerdict('absent');
  }
  const live = w.live;
  const lc = w.lifecycle;
  // (2c) an unmeasured fleet row, lifecycle or dispatch
  if (w.unmeasured) return holdVerdict('unmeasured');
  if (lc === null || !isSessionLifecycle(lc) || lc === 'unmeasurable') return holdVerdict('unmeasured');
  if (p.dispatchedAt === null) return holdVerdict('unmeasured');
  // (3) lifecycle, ahead of the live read: a dead pane has no live stamp (`dead-lifecycle-precedes-live-stamp`)
  if (lc === 'stopped') return holdVerdict(w2 !== undefined ? 'lifecycle-stopped' : 'lifecycle'); // `deliberate-stop-excluded`
  if (stallDeadShaped(lc)) {
    // The dead-shaped set lives once, in Task 10's `stallDeadShaped` (the L1 ruling). It answers a boolean, so the
    // cause word is named here from the lifecycle it accepted; this line decides nothing about which lifecycles count.
    const because: StallW2Cause = lc; // stallDeadShaped is a type predicate: lc is 'orphan' | 'never-started' here
    return w2 !== undefined && stallDeadDue(input, w2.deadSince, key, now) ? stallW2Notify(input, 'dead', key, because) : holdVerdict('lifecycle');
  }
  if (lc === 'restarting' || lifecycleIsDead(lc)) return holdVerdict('lifecycle');
  // (4) the live read. The marker's `unmeasured` holds only under the w2 marker: the dark keeps wave 1 (F3).
  if (!live.ok) return holdVerdict('unmeasured');
  if (w2Live && markReason === 'unmeasured') return holdVerdict('unmeasured');
  if (live.since === null) return holdVerdict('unmeasured'); // D-3580 any-null-stamp-holds: whatever the word
  const dialogShaped = live.word === 'waiting' || w.dialogPending;
  if (dialogShaped && (w.hookAsk.kind === 'unmeasured' || w.askRow.kind === 'unmeasured')) return holdVerdict('unmeasured');
  const capQuiet = now - capQuietSince(input, f, live.since);
  // (5) hold 2a (a question, uncapped), then 2b (a dialog with no ask, capped once per episode). An `approval` is 2b.
  const hookAskCorrelated = w.hookAsk.kind === 'ask' && live.since !== null && w.hookAsk.at >= live.since - ASK_DIALOG_SLACK_MS;
  const askRowOpen = w.askRow.kind === 'row' && (w.askRow.state === 'held' || w.askRow.state === 'answering');
  if (live.word === 'waiting' && (hookAskCorrelated || askRowOpen)) return holdVerdict('ask');
  if (dialogShaped) return capQuiet >= STALL_QUIET_MS && rungDoneAt(input, 'dialog-cap', 1, key) === null ? capVerdict('dialog-cap', key) : holdVerdict('dialog');
  // (6) the limit hold, capped once per episode (`stallLimited`, shared with the session verdicts)
  if (stallLimited(w, now)) {
    return capQuiet >= LIMIT_HOLD_CAP_MS && rungDoneAt(input, 'limit-cap', 1, key) === null ? capVerdict('limit-cap', key) : holdVerdict('limit');
  }
  // (7) restart grace: a restart cut a turn short, and ccd's redrive re-prompts it
  if (w2Live && okMark !== null && okMark.graceUntil !== null && now < okMark.graceUntil) return holdVerdict('restart-grace');
  const view = okMark === null ? null : stallMarkView(okMark, live);
  // (8) frozen: a turn in flight under a busy word with no main hook event for FROZEN_NO_EVENT_MS, once per turn
  if (w2 !== undefined && okMark !== null && view !== null && view.state === 'working' && live.word === 'busy') {
    const turnKey = okMark.turnAt ?? okMark.at;
    const frozenSince = stallFrozenSince(okMark, w2.hook);
    if (frozenSince !== null && now - frozenSince >= FROZEN_NO_EVENT_MS && rungDoneAt(input, 'frozen', 1, turnKey) === null) {
      return stallW2Notify(input, 'frozen', turnKey, 'no-hook-event');
    }
  }
  // (9) delegates: subagent activity holds the quiet arm, capped at DELEGATE_CAP_MS of main silence. It needs the worker's
  // ball (`delegates-requires-the-workers-ball`), or it would also silence coord-deaf and the coord-ball cap.
  const quietStart = view === null ? null : stallMarkQuiet(view, f, p.dispatchedAt);
  if (w2 !== undefined && w2Live && view !== null && view.state !== 'working' && f.ball === 'worker' && quietStart !== null
    && stallHookFresh(w2.hook, now) && now - quietStart < DELEGATE_CAP_MS) return holdVerdict('delegates');
  // (10) the coordinator's ball: coord-deaf, then the cap, then none (`coord-ball-below-cap-is-none`, D-3574)
  if (f.ball === 'coordinator') {
    const deaf = w2 === undefined ? null : stallDeafMail(input, w2.deliveries);
    if (deaf !== null && now - deaf.at >= COORD_DEAF_MS && rungDoneAt(input, 'coord-deaf', 1, deaf.id) === null) {
      return { act: 'notify', arm: 'coord-deaf', rung: 1, key: deaf.id, to: 'operator' };
    }
    const ballAge = f.lastExchangeAt === null ? 0 : now - f.lastExchangeAt;
    return ballAge >= COORD_BALL_CAP_MS && rungDoneAt(input, 'coord-ball', 1, key) === null ? capVerdict('coord-ball', key) : VERDICT_NONE;
  }
  // (11) the worker's ball. Without the w2 marker, or without a current marker: wave 1's ladder, unchanged.
  if (!w2Live || w2 === undefined || okMark === null || view === null) return stallWaveOneLadder(input, f, live.word, live.since, key, now);
  if (view.state === 'working') return holdVerdict('busy');
  if (live.word !== 'busy' && !isIdleWord(live.word)) return holdVerdict('unmeasured');
  if (quietStart === null) return stallWaveOneLadder(input, f, live.word, live.since, key, now);
  const r1At = rungDoneAt(input, 'quiet', 1, key);
  if (r1At === null) return now - quietStart >= stallBackoff(input).quietMs ? { act: 'notify', arm: 'quiet', rung: 1, key, to: 'worker' } : VERDICT_NONE;
  if (rungDoneAt(input, 'quiet', 3, key) !== null) return VERDICT_NONE;
  const r2At = rungDoneAt(input, 'quiet', 2, key);
  if (r2At !== null) return now >= r2At + STALL_OPERATOR_MS ? r3Verdict(key, 'still-silent') : VERDICT_NONE;
  return stallProofDue(input, okMark, w2.deliveries, key, r1At, now) ? stallR2Due(input, key) : VERDICT_NONE;
}

// ── the notice texts (§4.2 "Mail bodies" and "Push shape") ───────────────────────────────────────────────────
// Measured facts only:
// - session ids, workspace ids, programme slugs, run states and mail kinds, each printed only if it matches
//   STALL_SAFE_RE;
// - integers;
// - server-formatted UTC.
// Never transcript text, a mail subject or a task description (§9.12). A value that fails its pattern prints as
// STALL_UNPRINTABLE, never quoted or escaped.

const STALL_UNPRINTABLE = '(unprintable)';
const STALL_SAFE_RE = /^[A-Za-z0-9._-]+$/;

/** A session id, workspace id, programme slug, run state or mail kind, printed only when it matches the id pattern. */
export function stallSafe(v: string): string {
  return typeof v === 'string' && STALL_SAFE_RE.test(v) ? v : STALL_UNPRINTABLE;
}

/** An id, printed only when it is an integer. */
function stallInt(n: number): string {
  return Number.isSafeInteger(n) ? String(n) : STALL_UNPRINTABLE;
}

/** The ONE Date use in this module, and the only shape `stall-vocabulary.test.ts` admits: formatting a measured
 *  epoch, never reading the clock. It returns null for a value `toISOString` would throw on. */
function stallIso(ms: number): string | null {
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}

/** `YYYY-MM-DDTHH:MMZ`: the time on a phone line. */
export function stallUtc(ms: number): string {
  const iso = stallIso(ms);
  return iso === null ? STALL_UNPRINTABLE : `${iso.slice(0, 16)}Z`;
}

/** `YYYY-MM-DDTHH:MM:SSZ`: when a body's quiet began (§4.2's example). */
function stallUtcSec(ms: number): string {
  const iso = stallIso(ms);
  return iso === null ? STALL_UNPRINTABLE : `${iso.slice(0, 19)}Z`;
}

/** `HH:MM:SSZ`: a mail's time in a body (§4.2's example). */
function stallClockSec(ms: number): string {
  const iso = stallIso(ms);
  return iso === null ? STALL_UNPRINTABLE : `${iso.slice(11, 19)}Z`;
}

/** `HH:MMZ`, floored: the time of an event on a phone line, with no date (D-3583 r3-reports-what-was-measured). */
function stallClockMin(ms: number): string {
  const iso = stallIso(ms);
  return iso === null ? STALL_UNPRINTABLE : `${iso.slice(11, 16)}Z`;
}

/** `HH:MMZ`, rounded UP to the minute. It is a deadline, so it must never read earlier than the rung it names. */
function stallDeadline(ms: number): string {
  const iso = stallIso(Math.ceil(ms / 60_000) * 60_000);
  return iso === null ? STALL_UNPRINTABLE : `${iso.slice(11, 16)}Z`;
}

/** `<h>h <m>m`, floored to the minute. A negative span prints as `0h 0m`. */
function stallSpan(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** `run 67 — demo-program wave 9/9`. */
function stallRunLabel(run: StallRunRow): string {
  const wave = run.waveOf === null ? stallInt(run.wave) : `${stallInt(run.wave)}/${stallInt(run.waveOf)}`;
  return `run ${stallInt(run.id)} — ${stallSafe(run.program)} wave ${wave}`;
}

/** `#2509 status at 21:17:43Z`, or `none`. The subject is never printed. */
function stallMailRef(m: StallMailRow | null): string {
  return m === null ? 'none' : `#${stallInt(m.id)} ${stallSafe(m.kind)} at ${stallClockSec(m.at)}`;
}

/** When the worker's live status last turned idle: wave 1's r1 clock (r1 is sent when that stamp is two hours old).
 *  The episode key stands in when the facts carry no quiet start. r2 and r3 never read this: r1's own delivery
 *  restamps it (D-3582 r2-r3-span-from-the-episode). */
function stallQuietFrom(facts: StallFacts): number {
  return facts.quietSince ?? facts.episodeKeyMs;
}

/** The marker ladder's quiet start, when §10 step 11's marker ladder is the one that decides r1: `stall-watch-w2-live`
 *  armed, a marker that reads on a present worker, and a view that is not `working` and names a turn end. Null when
 *  wave 1's ladder decides it. `stallVerdictInner` sends a `working` view to hold `busy` and a view with no `stopAt` to
 *  wave 1's ladder, so this is exactly the set of r1s the marker clock sent. */
function stallR1MarkQuiet(input: StallInput, facts: StallFacts): number | null {
  const w = input.worker;
  if (input.arming.w2Live !== true || input.w2 === undefined || !input.w2.mark.ok || !w.present) return null;
  const view = stallMarkView(input.w2.mark, w.live);
  return view.state === 'working' ? null : stallMarkQuiet(view, facts, input.subject.primary.dispatchedAt ?? 0);
}

/** r1's quiet start, from the rule the ladder that sent it used (final fix wave, E2E-2): the marker clock under the
 *  marker rules, else wave 1's. Measured either way, so a busy worker is never told its silence runs from dispatch,
 *  and a worker whose live stamp a respawn restamped after its Stop is never told it has been quiet for minutes. */
export function stallR1QuietFrom(input: StallInput, facts: StallFacts): number {
  return stallR1MarkQuiet(input, facts) ?? stallQuietFrom(facts);
}

/** D-3582 r2-r3-span-from-the-episode: what r2 and r3 report is the time since the worker's last mail on the run,
 *  measured from the episode key (the same clock the caps use), so a restamp by r1's own delivery cannot shorten
 *  it. `at` formats the key. When the key IS the dispatch time the worker has never mailed on this run, and the
 *  text says `dispatch`. A coordinator's `wait:` can also move the key, and "no mail from the worker since" that
 *  moment is still true. */
function stallSilence(run: StallRunRow, facts: StallFacts, now: number, at: (ms: number) => string): string {
  const since = run.dispatchedAt !== null && facts.episodeKeyMs === run.dispatchedAt ? 'dispatch' : at(facts.episodeKeyMs);
  return `since ${since} (${stallSpan(now - facts.episodeKeyMs)})`;
}

/** §4.2's "owed" part:
 *  - "first report" when the worker has not mailed on the run since dispatch;
 *  - a reply, when mail to it is newer than its own last mail;
 *  - "next report" otherwise. */
function stallOwed(facts: StallFacts): string {
  if (facts.workerLast === null) return 'first report';
  if (facts.inboundLast !== null && facts.inboundLast.id > facts.workerLast.id) return `reply to #${stallInt(facts.inboundLast.id)}`;
  return 'next report';
}

export interface StallNoticeText { readonly subject: string; readonly body: string }

/** The newest stall check to the subject's worker in `input.mail`: the r1 mail. A stall-check subject from anyone
 *  but the operator role is not a check (`stallMailClass`). */
export function stallLastCheck(input: StallInput): StallMailRow | null {
  const worker = input.subject.primary.sessionId;
  let newest: StallMailRow | null = null;
  for (const m of input.mail) {
    if (m.toId !== worker) continue;
    if (stallMailClass({ fromId: m.fromId, runId: m.runId, subject: m.subject, mailId: m.id }) !== 'check') continue;
    if (newest === null || m.id > newest.id) newest = m;
  }
  return newest;
}

/** Why a worker that ended its turn to wait may never be woken (§3.2). */
const STALL_WAKE_LINE = 'Background work you ended your turn to wait for may have finished or died without a notice that can wake you: a task a subagent started reports to that subagent, and a background shell has no deadline.';

/** D-3581 r1-body-states-its-arming: r1's last line while escalation is unarmed. */
const STALL_UNARMED_LINE = 'Escalation is not armed on this fleet yet: no one else is told if you stay silent. Send the mail anyway — it is the report you owe.';

/** r1: the stall check. It carries its own protocol, so no skill has to be installed first (§11 decision 3). */
export function stallCheckMail(input: StallInput, facts: StallFacts, now: number): StallNoticeText {
  const run = input.subject.primary;
  const id = stallInt(run.id);
  const since = stallR1QuietFrom(input, facts);
  const quiet = stallSpan(now - since);
  const toCoordinator = now + STALL_ESCALATE_MS;
  const toOperator = toCoordinator + STALL_OPERATOR_MS;
  const direct = input.coordinationPaused || run.claimedBy === null;
  // D-3581 r1-body-states-its-arming: while escalation is unarmed r2 and r3 are recorded in shadow and nobody is
  // told, so the body says so and still asks for the mail. Only an armed fleet gets the spec's promise.
  // Planning departure `r1-body-names-the-proof-bound`. With the marker rules armed (`stall-watch-w2-live`) and the
  // marker's view naming a turn end, r2 falls due on proof at the worker's next turn end, and by STALL_BOUND_MS after
  // r1 at the latest (§5.1 (a)–(d)). The body promises that, and names the operator when r2 would be skipped. The
  // predicate is the marker ladder's own (Task 11), shared with the quiet start above (`stallR1MarkQuiet`): an ok marker
  // whose view has no stopAt runs wave 1's ladder, and keeps wave 1's line.
  const proofBound = stallR1MarkQuiet(input, facts) !== null;
  const last = stallDelivery('coordinator', input.arming) === 'shadow'
    ? STALL_UNARMED_LINE
    : proofBound
      // §4.2: the operator hears STALL_OPERATOR_MS after the coordinator (r3 at r2 + 1 h), so a coordinator line says
      // so; a direct line already names the operator (final fix wave, E2E-5).
      ? `No mail from you on run ${id}: the ${direct ? 'operator' : 'coordinator'} is told when your next turn ends without one, and by ${stallDeadline(now + STALL_BOUND_MS)} at the latest${direct ? '' : `; the operator ${STALL_OPERATOR_MS / 3_600_000} h after that`}.`
      : direct
        ? `No mail from you on run ${id} by ${stallDeadline(toCoordinator)}: the operator is told.`
        : `No mail from you on run ${id} by ${stallDeadline(toCoordinator)}: the coordinator is told. By ${stallDeadline(toOperator)}: the operator.`;
  return {
    subject: `${STALL_CHECK_PREFIX} run ${id} — quiet ${quiet}, owed: ${stallOwed(facts)}`,
    body: [
      `stall-check from the ccrc stall watch (server), ${stallRunLabel(run)}.`,
      `Your main loop has been idle since ${stallUtcSec(since)} (${quiet}). Your last mail on this run: ${stallMailRef(facts.workerLast)}. Newest mail to you on this run: ${stallMailRef(facts.inboundLast)}.`,
      STALL_WAKE_LINE,
      `Before anything else, send ONE mail on run ${id} to toId 'coordinator', kind status:`,
      `still working — subject beginning "${STALL_REPLY_WORKING_PREFIX}", what you are doing and when you report next;`,
      `waiting on the coordinator — subject beginning "${STALL_REPLY_WAITING_PREFIX}", what you wait for (this hands the run to the coordinator and stops these checks);`,
      "blocked on a decision — ask it with AskUserQuestion (your skill's question clause); these checks hold while it is open.",
      last,
    ].join('\n'),
  };
}

/** r2's sentence about r1: what the coordinator needs in order to judge whether the check ever reached the worker. */
function stallR1Line(r1: StallNotice, check: StallMailRow | null, d: { queuedAt: number; deliveredAt: number | null; ackedAt: number | null } | null): string {
  const silent = ' The worker has sent no mail on this run since.';
  if (r1.mode === 'shadow') return `The stall check was recorded in shadow at ${stallClockSec(r1.at)}; no mail was sent to the worker.${silent}`;
  if (check === null) return `The stall check was recorded at ${stallClockSec(r1.at)}, and no stall-check mail is on this run.${silent}`;
  if (d === null) return `Stall check #${stallInt(check.id)} was queued at ${stallClockSec(check.at)}, and has no delivery row.${silent}`;
  const delivered = d.deliveredAt === null ? 'not delivered' : `delivered at ${stallClockSec(d.deliveredAt)}`;
  const acked = d.ackedAt === null ? 'not acked' : `acked at ${stallClockSec(d.ackedAt)}`;
  return `Stall check #${stallInt(check.id)} was queued at ${stallClockSec(d.queuedAt)}, ${delivered}, ${acked}.${silent}`;
}

/** r2: the stall report to the coordinator. It carries its own instruction until wave 3's clause reaches every home. */
export function stallReportMail(input: StallInput, facts: StallFacts, r1: StallNotice, r1Delivery: { queuedAt: number; deliveredAt: number | null; ackedAt: number | null } | null, now: number): StallNoticeText {
  const run = input.subject.primary;
  const check = r1.mode === 'live' ? stallLastCheck(input) : null;
  const checkWord = STALL_CHECK_PREFIX.slice(0, -1); // the word, never a second quoted kebab literal in server/src/coord
  const checkRef = check === null ? checkWord : `${checkWord} #${stallInt(check.id)}`;
  const workspace = run.workspace === null ? 'none' : stallSafe(run.workspace);
  return {
    // D-3582 r2-r3-span-from-the-episode: the span is the silence since the worker's last mail, never the live stamp's.
    subject: `${STALL_REPORT_PREFIX} run ${stallInt(run.id)} — worker silent ${stallSpan(now - facts.episodeKeyMs)}, ${checkRef} unanswered`,
    body: [
      `stall from the ccrc stall watch (server), ${stallRunLabel(run)}, state ${stallSafe(run.state)}.`,
      `Worker ${stallSafe(run.sessionId)} (workspace ${workspace}): no mail from the worker ${stallSilence(run, facts, now, stallUtcSec)}. Its last mail on this run: ${stallMailRef(facts.workerLast)}. Newest mail to it on this run: ${stallMailRef(facts.inboundLast)}.`,
      stallR1Line(r1, check, r1Delivery),
      `Ack this, re-measure the run and the worker's last mail, and act once: mail the worker a resume, mail it a subject beginning "${STALL_WAIT_PREFIX}" naming what it waits for, or re-dispatch a dead worker. A stall mail never licenses re-dispatching a live worker.`,
    ].join('\n'),
  };
}

/** The newest stall report on the subject's run: a `report`-class mail (from the operator role, `stallMailClass`).
 *  Its `toId` is who the report went to. That may not be today's claimant: a reclaim moves the claim. */
function stallLastReport(input: StallInput): StallMailRow | null {
  const run = input.subject.primary;
  let newest: StallMailRow | null = null;
  for (const m of input.mail) {
    if (m.runId !== run.id) continue;
    if (stallMailClass({ fromId: m.fromId, runId: m.runId, subject: m.subject, mailId: m.id }) !== 'report') continue;
    if (newest === null || m.id > newest.id) newest = m;
  }
  return newest;
}

/** D-3583 r3-reports-what-was-measured: r3's `still-silent` text states what the watch measured, in sanitised ids
 *  and server times, and asserts nothing about an answer:
 *  - the stall check's id and when it was queued;
 *  - who the stall report went to (its own `toId`) and when it was queued;
 *  - whether a coordinator has mailed the worker since (newer than the report), and when.
 *  With no report mail on the run (r2 was shadow, or was skipped) the report clause, and what follows it, is omitted. */
function stallStillSilent(input: StallInput): string {
  const run = input.subject.primary;
  const check = stallLastCheck(input);
  const checkClause = check === null ? 'No stall-check mail is on the run.' : `Stall check #${stallInt(check.id)} was queued at ${stallUtc(check.at)}.`;
  const report = stallLastReport(input);
  if (report === null) return checkClause;
  const coordinatorIds = stallCoordinatorIds(input.subject.runs);
  const coordinatorMail = newestMail(input.mail, (m) => m.toId === run.sessionId && coordinatorIds.has(m.fromId) && m.id > report.id);
  const after = coordinatorMail === null
    ? 'No mail from its coordinator to the worker since the report.'
    : `Its coordinator last mailed the worker at ${stallClockMin(coordinatorMail.at)}.`;
  return `${checkClause} The stall report went to ${stallSafe(report.toId)}, queued at ${stallUtc(report.at)}. ${after}`;
}

/** r3's cause, in words. A paused coordinator is alive, so the reclaim door is never named for it: reclaim would
 *  refuse it (§4.2). */
function stallR3Cause(because: StallR3Cause, input: StallInput, coordinator: string): string {
  switch (because) {
    case 'still-silent': return stallStillSilent(input);
    case 'coordinator-dead': return `Its coordinator ${coordinator} measures dead, so no report went to it. Reclaim the run: POST /api/runs/${stallInt(input.subject.primary.id)}/reclaim.`;
    case 'no-coordinator': return STALL_NO_COORDINATOR_LINE;
    case 'coordination-paused': return STALL_PAUSED_LINE;
  }
}

/** Why the limit hold held: only facts the tick measured. */
function stallLimitFacts(w: StallWorker): string {
  if (!w.present) return 'the worker is absent';
  const parts: string[] = [];
  if (w.limits === null) parts.push('limits unmeasured');
  else parts.push(`5h ${stallPercent(w.limits.five)}`, `7d ${stallPercent(w.limits.seven)}`);
  if (w.stranded) parts.push('stranded');
  if (w.swapBlocked) parts.push('swap blocked');
  if (w.autoContinueHeldAt !== null) parts.push(`auto-continue held since ${stallUtc(w.autoContinueHeldAt)}`);
  return parts.join(', ');
}

function stallPercent(v: number | null): string {
  if (v === null) return 'unmeasured';
  return Number.isFinite(v) ? `${Math.round(v)}%` : STALL_UNPRINTABLE;
}

/** The operator pushes: r3, the three caps, and every wave-2 arm that reaches the operator. `<ws>` is the run's workspace, or its session when it has none. */
export function stallPushText(input: StallInput, facts: StallFacts, n: StallNotify, now: number): { readonly title: string; readonly body: string } {
  if (n.to !== 'operator') throw new RangeError(`stallPushText: rung ${n.rung} of ${n.arm} goes to the ${n.to} as mail, never as a push`);
  const run = input.subject.primary;
  const ws = stallSafe(run.workspace ?? run.sessionId);
  const worker = stallSafe(run.sessionId);
  const coordinator = run.claimedBy === null ? 'none' : stallSafe(run.claimedBy);
  const label = stallRunLabel(run);
  switch (n.arm) {
    case 'quiet':
      // D-3582 r2-r3-span-from-the-episode: the silence since the worker's last mail, not the live stamp's.
      return {
        title: `⚠ stalled › ${ws}`,
        body: `${label}: no mail from worker ${worker} ${stallSilence(run, facts, now, stallUtc)}. ${stallR3Cause(n.because, input, coordinator)}`,
      };
    case 'dialog-cap':
      return {
        title: `⚠ stalled › ${ws} (dialog)`,
        body: `${label}: worker ${worker} shows a dialog with no question behind it; this quiet episode opened ${stallUtc(n.key)} (${stallSpan(now - n.key)}). Mail to the worker, its coordinator's included, cannot land while the dialog shows: answer or dismiss it on the pane.`,
      };
    case 'limit-cap':
      return {
        title: `⚠ limit › ${ws}`,
        body: `${label}: worker ${worker} has been held by a usage limit past the ${stallSpan(LIMIT_HOLD_CAP_MS)} cap; this quiet episode opened ${stallUtc(n.key)} (${stallSpan(now - n.key)}). Measured: ${stallLimitFacts(input.worker)}.`,
      };
    case 'coord-ball': {
      // Minor (texts): worded from the facts. The ball reaches the coordinator by the worker's question, a done
      // claim or a declared wait, and by the coordinator's own `wait:`, so the worker is never said to have
      // "handed" the run over; and a run with no claimant names none.
      const last = facts.lastExchangeAt ?? n.key;
      const claimant = run.claimedBy === null ? '' : ` ${coordinator}`;
      return {
        title: `⚠ waiting › ${ws}`,
        body: `${label}: the run is waiting on its coordinator${claimant} (worker ${worker}); no mail on the run since ${stallUtc(last)} (${stallSpan(now - last)}).`,
      };
    }
    case 'frozen':
      return {
        title: `⚠ frozen › ${ws}`,
        body: stallSentences(`${label}: worker ${worker} reads busy with its turn open since ${stallUtc(n.key)}, and no hook event has arrived for ${stallSpanOrUnmeasured(stallW2FrozenSince(input), now)}.`, stallRunWho(input).unreported),
      };
    case 'dead':
      return {
        title: `⚠ dead › ${ws}`,
        body: stallSentences(`${label}: worker ${worker}: ${stallDeadSentence(n.because)} for ${stallSpanOrUnmeasured(stallDeadSince(input, n.because), now)}.`, stallRunWho(input).unreported),
      };
    case 'coord-deaf':
      return { title: `⚠ coordinator deaf › ${ws}`, body: stallDeafBody(input, label, worker, n.key, now) };
    case 'orphan-d':
    case 'failed':
    case 'mail-stuck':
    case 'marker-unreadable':
      return stallW2SessionPush(stallRunWho(input), n, now);
  }
}

// ── the turn marker port (wave 2, §5.1) ──────────────────────────────────────────────────────────────────────
// `$REG/<id>.turn.json`, the session hook's record of the MAIN thread's turn. The shape is an L2 port declared here,
// by its consumers (this lane's verdicts, and the mail gate through its own structural copy in `turnidle.ts`), and
// answered by `readTurnMarkMeasured` (`server/src/turnmark.ts`, L3), which imports the two judgements below rather
// than deriving its own.

/** The marker's state words, enumerated once. `turnmark.ts` refuses any other word as malformed. */
export const TURN_MARK_STATES = ['working', 'done', 'failed'] as const;
export type TurnMarkState = (typeof TURN_MARK_STATES)[number];
/** `$REG/<id>.turn.json`, validated (§5.1). The comma-joined fields arrive split. */
export interface TurnMark {
  readonly sessionId: string; readonly state: TurnMarkState; readonly event: string; readonly at: number;
  readonly turnAt: number | null; readonly stopAt: number | null;
  /** −1: the Stop's payload had no array `background_tasks` (unmeasured, never 0). */
  readonly bg: number; readonly bgKinds: readonly string[]; readonly bgIds: readonly string[];
  readonly err: string | null; readonly restartAt: number | null;
  readonly lostBg: number; readonly lostKinds: readonly string[]; readonly lostIds: readonly string[];
  /** `restartAt + RESTART_GRACE_MS` when that restart cut a turn short (`turnMarkGraceUntil`), else null. */
  readonly graceUntil: number | null;
}
/** Why a read has no mark. Each is a different act for a consumer (§5.1, and `turnmark.ts`'s docstring). */
export type TurnMarkUnread = 'absent' | 'unmeasured' | 'malformed' | 'foreign' | 'stale';
export type TurnMarkRead = ({ readonly ok: true } & TurnMark) | { readonly ok: false; readonly reason: TurnMarkUnread };
/** *Chosen* (spec §10): a restart that cut a turn short is redriven by ccd, so the stall lane and the `busy` gate
 *  hold this long after `restartAt` rather than read the redrive's gap as a finished turn. */
export const RESTART_GRACE_MS = 5 * 60_000;
/** Older than the live process: `at` AND (`restartAt` null or older) both before `startedAt`. A restart at or after
 *  the process start rescues an older `at`: that SessionStart was this very process's. */
export function turnMarkStale(m: Pick<TurnMark, 'at' | 'restartAt'>, startedAt: number): boolean {
  return m.at < startedAt && (m.restartAt === null || m.restartAt < startedAt);
}
/** `restartAt + RESTART_GRACE_MS` iff `restartAt !== null && turnAt !== null && turnAt > (stopAt ?? -Infinity)`, else
 *  null: the restart found a turn newer than the last Stop, so it cut that turn short. No marker field records this;
 *  it is derived from the two stamps (restart-grace-derived-from-turn-and-stop). */
export function turnMarkGraceUntil(m: Pick<TurnMark, 'restartAt' | 'turnAt' | 'stopAt'>): number | null {
  if (m.restartAt === null || m.turnAt === null) return null;
  return m.turnAt > (m.stopAt ?? Number.NEGATIVE_INFINITY) ? m.restartAt + RESTART_GRACE_MS : null;
}

// ===========================================================================
// Task 12 (wave 2): the session-scoped verdicts (spec §5.2; §10: "The D, E and failed arms are separate pure
// verdicts over the marker and apply holds 1, 2 and the limit hold only; mail-stuck is evaluated per delivery").
// Each is judged beside `stallVerdict`, never inside it. A run worker's notices are its run's `run_events`. A
// coordinator's, and any other session's, are run-less (`coordinator-notices-are-run-less`). A run-less rung to
// the session itself is therefore done by the watch's own mail, found by its exact subject. A run-less rung to the
// operator is latched in memory by the lane, which L1 cannot see. Every exported verdict passes through
// `stallMailDisabledHold` (`lane-honours-mail-disabled`, `mail-disabled-holds-only-sends`).
// ===========================================================================

export type StallSessionRole = 'worker' | 'coordinator' | 'other';
export interface StallSessionInput {
  readonly sessionId: string;
  readonly role: StallSessionRole;
  readonly run: StallRunRow | null;          // worker: its subject's primary; coordinator/other: null (run-less notices)
  readonly worker: StallWorker;
  readonly mark: TurnMarkRead;
  readonly liveStartedAt: number | null;     // L1 re-judges staleness with turnMarkStale
  readonly markUnreadableSince: number | null;
  readonly mail: readonly StallMailRow[];    // stallMailFor's whole (time-bounded) rows
  readonly deliveries: readonly StallDeliveryRow[];
  readonly notices: readonly StallNotice[];  // worker: runEvents(run.id); else []
  readonly arming: StallArming;
  readonly coordinationPaused: boolean;
}

/** The one gate word mail-stuck reads. It is typed against Task 10's Record, so a rename there is a compile error
 *  here, and `isStallKebab` declares it through that Record. §5.2: `lastError` is never read, because it is sticky
 *  text that outlives the transient it records. */
const STALL_STUCK_GATE: keyof typeof STALL_GATE_WORD_MAP = 'registry-unmeasurable';

/** Holds 1, 2 and the limit hold only (§4.2's numbers, in §10's order); null = none applies. Before them, a run worker's
 *  run must be one this build can name (§10 step 1): a coordinator's verdict, and any other session's, names no run.
 *  Hold 1 is absent or any input unmeasured. Hold 2 is 2b's `dialogPending`, a harness menu that owns the keyboard, so
 *  a self-mail would sit queued behind it (final fix wave, E2E-4). 2b's other half, live `waiting`, never reaches D, E
 *  or failed: their word checks refuse it. Hold 2a is not applied: the run verdict's 2a is a question behind a
 *  `waiting` word, which those checks refuse too, and the lane reads no hookstate ask for a coordinator or another row
 *  (`STALL_HOOK_ASK_UNREAD`). `now` is the limit hold's auto-continue clock (`session-hold-takes-now`). A marker that is
 *  not ok for a reason other than `unmeasured` is no hold here: D, E and failed read it as `none`. */
export function stallSessionHold(input: StallSessionInput, now: number): StallVerdict | null {
  const r = input.run;
  if (input.role === 'worker' && r !== null
    && (!isRunState(r.state) || r.state === 'unknown' || (r.kind !== 'work' && r.kind !== 'review'))) return holdVerdict('run-unnamed');
  const w = input.worker;
  if (!w.present) return holdVerdict('absent');
  const lc = w.lifecycle;
  if (w.unmeasured || lc === null || !isSessionLifecycle(lc) || lc === 'unmeasurable') return holdVerdict('unmeasured');
  if (!w.live.ok || w.live.since === null) return holdVerdict('unmeasured');
  if (!input.mark.ok && input.mark.reason === 'unmeasured') return holdVerdict('unmeasured');
  if (w.dialogPending) return holdVerdict('dialog');
  if (stallLimited(w, now)) return holdVerdict('limit');
  return null;
}

/** The measured live word and its stamp, or null when any part of it is unmeasured. */
function stallSessionLive(input: StallSessionInput): { readonly word: string; readonly since: number } | null {
  const w = input.worker;
  if (!w.present || !w.live.ok || w.live.since === null) return null;
  return { word: w.live.word, since: w.live.since };
}

/** The marker when it is CURRENT: read ok, and not older than the live process. A null `liveStartedAt` reads it
 *  stale (`stale-when-live-has-no-startedat`). */
function stallCurrentMark(input: StallSessionInput): TurnMark | null {
  const m = input.mark;
  if (!m.ok || input.liveStartedAt === null || turnMarkStale(m, input.liveStartedAt)) return null;
  return m;
}

/** A run worker's rungs are recorded on its run's notices; every other session's are run-less. */
function stallRunBound(input: StallSessionInput): boolean {
  return input.role === 'worker' && input.run !== null;
}

/** The watch's newest self-mail to this session with exactly this subject, on any run or none. */
function stallSelfMail(input: StallSessionInput, subject: string): StallMailRow | null {
  return newestMail(input.mail, (m) => m.fromId === STALL_SENDER && m.toId === input.sessionId && m.subject === subject);
}

/** Is a rung-1 self-mail done? For a run worker: `rungDoneAt` over its run's notices, with shadow accounting. For a
 *  run-less session: its mail row, found by the exact subject that the store's run-less dedupe
 *  (`hasMailWithSubject`) keys on. A run-less shadow rung records nothing, so it is never done here, and the lane
 *  warns once per key instead. */
function stallSelfRungDone(input: StallSessionInput, arm: StallArm, key: number, subject: string): boolean {
  if (stallRunBound(input)) return rungDoneAt(input, arm, 1, key) !== null;
  return stallSelfMail(input, subject) !== null;
}

/** Is a coordinator- or operator-bound rung done? Only a run worker's is recorded. A run-less session's operator
 *  push is latched in memory by the lane (`stall-<sessionId>-<arm>-<rung>-<key>`, or `orphaned-<toId>-<restartAt>`
 *  for D), so L1 answers false and the lane holds it to one push. */
function stallRecordedDone(input: StallSessionInput, arm: StallArm, rung: 1 | 2 | 3, key: number): boolean {
  return stallRunBound(input) && rungDoneAt(input, arm, rung, key) !== null;
}

/** The exact subject of a session self-mail (§5.2), for the arm that sends it. The wording is Task 10's three
 *  builders', never re-spelled here: the lane queues their output through Task 13's texts, the store's run-less dedupe
 *  keys on it, and these verdicts find the sent mail by it. The failed arm passes the `err` and `key` (`stopAt`) its
 *  verdict carries, the same two values Task 13's `stallFailedMail` hands the same builder. */
function stallSelfSubjectOf(arm: 'orphan-d' | 'orphan-e' | 'failed', m: TurnMark): string {
  if (arm === 'orphan-d') return stallOrphanDSubject(m);
  if (arm === 'orphan-e') return stallOrphanESubject(m);
  return stallFailedSubject(m.err ?? '', m.stopAt ?? Number.NaN);
}

/** The coordinator candidates (Contract note 2). They are the distinct non-null claimants of the rows that
 *  `stallCandidates()` returned, whose predicate is already the INACTIVE one, so no store read is added. A blank
 *  claimant names no session. Pure and order-stable: runs come out in id order, and subjects in the order of their
 *  first run id. */
export function stallCoordinatorSubjects(rows: readonly StallRunRow[]): { readonly sessionId: string; readonly runs: readonly StallRunRow[] }[] {
  const byClaimant = new Map<string, StallRunRow[]>();
  for (const r of rows) {
    if (r.claimedBy === null || r.claimedBy === '') continue;
    const group = byClaimant.get(r.claimedBy);
    if (group === undefined) byClaimant.set(r.claimedBy, [r]);
    else group.push(r);
  }
  return [...byClaimant.entries()]
    .map(([sessionId, group]) => ({ sessionId, runs: [...group].sort((a, b) => a.id - b.id) }))
    .sort((a, b) => a.runs[0]!.id - b.runs[0]!.id);
}

/** Orphan D's pre-conditions on the marker ALONE (§5.2, "Candidates are the registry rows whose marker reads done
 *  with lostBg > 0"): the newest record is a done turn, a restart came after its Stop (or with no Stop recorded), and
 *  that restart lost background tasks. Exported so the lane's read-budget pre-filter (Task 15) asks this predicate
 *  instead of spelling its conjuncts, because L4 does not decide; `stallOrphanDInner` asks it too, so the two cannot
 *  drift. The backlog horizon, the staleness judgement and the idle clock need `now` and the live facts, so they stay
 *  in the verdict. */
export function stallOrphanDCandidate(mark: TurnMark): boolean {
  return mark.state === 'done' && mark.lostBg > 0 && mark.restartAt !== null && mark.restartAt > (mark.stopAt ?? Number.NEGATIVE_INFINITY);
}

/** Orphan D (§5.2), any session: a restart cut background tasks short, nothing has run since, and the pane has
 *  been idle ORPHAN_D_IDLE_MS. The episode began within BACKLOG_HORIZON_MS, so a first enable never wakes a
 *  long-abandoned session. Rung 1 mails the session itself. Rung 2 pushes the operator when that mail is still
 *  unacked ORPHAN_PUSH_MS after delivery, or still undelivered that long after queueing. Key: `restartAt`. */
function stallOrphanDInner(input: StallSessionInput, now: number): StallVerdict {
  const held = stallSessionHold(input, now);
  if (held !== null) return held;
  const m = stallCurrentMark(input);
  // `m.restartAt === null` narrows the type only: the candidate already refuses it (deleting it is a tsc error).
  if (m === null || !stallOrphanDCandidate(m) || m.restartAt === null || now - m.restartAt > BACKLOG_HORIZON_MS) return VERDICT_NONE;
  const live = stallSessionLive(input);
  if (live === null || !isIdleWord(live.word) || now - live.since < ORPHAN_D_IDLE_MS) return VERDICT_NONE;
  const key = m.restartAt;
  const subject = stallSelfSubjectOf('orphan-d', m);
  if (!stallSelfRungDone(input, 'orphan-d', key, subject)) return { act: 'notify', arm: 'orphan-d', rung: 1, key, to: 'worker' };
  if (stallRecordedDone(input, 'orphan-d', 2, key)) return VERDICT_NONE;
  const sentMail = stallSelfMail(input, subject);
  if (sentMail === null) return VERDICT_NONE;
  // Task 11's `stallNewestDelivery` reads every recipient's rows; rung 2 reads this session's delivery only.
  const d = stallNewestDelivery(input.deliveries.filter((x) => x.toId === input.sessionId), sentMail.id);
  if (d === null || d.ackedAt !== null) return VERDICT_NONE;
  return now - (d.deliveredAt ?? sentMail.at) >= ORPHAN_PUSH_MS ? { act: 'notify', arm: 'orphan-d', rung: 2, key, to: 'operator' } : VERDICT_NONE;
}

export function stallOrphanDVerdict(input: StallSessionInput, now: number): StallVerdict {
  return stallMailDisabledHold(stallOrphanDInner(input, now), input.arming);
}

/** Orphan E (§5.2), for run workers and coordinators: the newest Stop left a wake-bearing kind running, nothing has
 *  been written since (`at === stopAt`, with no restart after it), and the pane has read exactly `idle` since that
 *  Stop for ORPHAN_E_IDLE_MS. `shell` is not idle here: a background shell may still be running. Rung 1 mails the
 *  session itself. Key: `stopAt`. */
function stallOrphanEInner(input: StallSessionInput, now: number): StallVerdict {
  if (input.role === 'other') return VERDICT_NONE;
  const held = stallSessionHold(input, now);
  if (held !== null) return held;
  const m = stallCurrentMark(input);
  if (m === null || m.state !== 'done' || m.stopAt === null) return VERDICT_NONE;
  if ((m.restartAt ?? Number.NEGATIVE_INFINITY) >= m.stopAt || m.at !== m.stopAt) return VERDICT_NONE;
  if (!m.bgKinds.some((k) => STALL_WAKE_KINDS.includes(k))) return VERDICT_NONE;
  const live = stallSessionLive(input);
  if (live === null || live.word !== 'idle' || live.since < m.stopAt || now - live.since < ORPHAN_E_IDLE_MS) return VERDICT_NONE;
  const key = m.stopAt;
  return stallSelfRungDone(input, 'orphan-e', key, stallSelfSubjectOf('orphan-e', m))
    ? VERDICT_NONE
    : { act: 'notify', arm: 'orphan-e', rung: 1, key, to: 'worker' };
}

export function stallOrphanEVerdict(input: StallSessionInput, now: number): StallVerdict {
  return stallMailDisabledHold(stallOrphanEInner(input, now), input.arming);
}

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
  // `failed-arm-bounded-by-the-mail-horizon`: a run-less repeat is told from a first failure by a prior failed:
  // self-mail at most FAILED_REPEAT_MS before this stop, and the lane's mail read keeps BACKLOG_HORIZON_MS. Past this
  // bound that evidence may be gone, so the arm answers none rather than re-read a repeat as a first failure.
  if (now - m.stopAt > BACKLOG_HORIZON_MS - FAILED_REPEAT_MS) return VERDICT_NONE;
  const live = stallSessionLive(input);
  if (live === null || !isIdleWord(live.word)) return VERDICT_NONE;
  const key = m.stopAt;
  const cls = stopFailureClass(m.err);
  if (cls === null) return holdVerdict('failed-unknown');
  if (cls === 'account') return holdVerdict('failed-account');
  const err = m.err ?? '';
  const subject = stallSelfSubjectOf('failed', m);
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

/** When the recipient's main loop went idle: the live stamp under idle or shell, else the CURRENT marker's stop when
 *  it reads done or failed, else null (§5.2). */
function stallIdleStart(input: StallSessionInput): number | null {
  const live = stallSessionLive(input);
  if (live !== null && isIdleWord(live.word)) return live.since;
  const m = stallCurrentMark(input);
  return m !== null && (m.state === 'done' || m.state === 'failed') ? m.stopAt : null;
}

/** One queued delivery (§5.2). It is judged from plain columns the store SELECTs, never in SQL and never in watch.ts
 *  (`mail-stuck-decided-in-l1`; the D-792 pins in mail-sweep.test.ts). The registry-unmeasurable clause is the
 *  delivery's own measurement, and hold 1 (`absent`, `unmeasured`) answers exactly when that gate is the reason. So
 *  the clause is judged before the holds (`stuck-gate-precedes-holds`). The idle clause is judged after them, hold 2b
 *  included (E2E-4). Key: the delivery id. */
function stallMailStuckInner(input: StallSessionInput, d: StallDeliveryRow, now: number): StallVerdict {
  if (stallRecordedDone(input, 'mail-stuck', 1, d.id)) return VERDICT_NONE;
  const fire: StallVerdict = { act: 'notify', arm: 'mail-stuck', rung: 1, key: d.id, to: 'operator' };
  if (d.lastGate === STALL_STUCK_GATE && d.gateSince !== null && now - d.gateSince >= MAIL_STUCK_MS) return fire;
  const held = stallSessionHold(input, now);
  if (held !== null) return held;
  const queuedMail = input.mail.find((m) => m.id === d.mailId);
  if (queuedMail === undefined) return VERDICT_NONE;
  const idleStart = stallIdleStart(input);
  return idleStart !== null && now - Math.max(idleStart, queuedMail.at) >= MAIL_STUCK_MS ? fire : VERDICT_NONE;
}

/** For run workers and coordinators: one verdict per `queued` delivery addressed to the session, in id order. */
export function stallMailStuckVerdicts(input: StallSessionInput, now: number): StallVerdict[] {
  if (input.role === 'other') return [];
  return input.deliveries
    .filter((d) => d.toId === input.sessionId && d.state === 'queued')
    .sort((a, b) => a.id - b.id)
    .map((d) => stallMailDisabledHold(stallMailStuckInner(input, d, now), input.arming));
}

/** A coordinator's marker-unreadable (§5.1 "on a candidate"; `coordinator-marker-unreadable`). The marker has been
 *  unreadable since the lane first saw it so, for MARKER_UNREADABLE_MS. Which reads count is Task 10's
 *  `stallMarkUnreadable`, never re-spelled here. Holds 1 and 2 do NOT apply, because the unreadable mark is the fact
 *  reported. The limit hold does, when the session is present. The push goes to the operator. Key: the in-memory
 *  first-seen time, which a server restart re-times. A run worker gets this arm through the run verdict (step 2a),
 *  and a registry row is no candidate until its marker reads. */
function stallSessionMarkerInner(input: StallSessionInput, now: number): StallVerdict {
  if (input.role !== 'coordinator') return VERDICT_NONE;
  if (!stallMarkUnreadable(input.mark)) return VERDICT_NONE;
  const since = input.markUnreadableSince;
  if (since === null || now - since < MARKER_UNREADABLE_MS) return VERDICT_NONE;
  const w = input.worker;
  if (w.present && stallLimited(w, now)) return holdVerdict('limit');
  return { act: 'notify', arm: 'marker-unreadable', rung: 1, key: since, to: 'operator' };
}

export function stallSessionMarkerVerdict(input: StallSessionInput, now: number): StallVerdict {
  return stallMailDisabledHold(stallSessionMarkerInner(input, now), input.arming);
}

// ── wave 2's notice texts (§5.2; plan Task 13) ───────────────────────────────────────────────────────────────
// Wave 1's text rules hold here. A text carries sanitised ids, integers, kinds and server-formatted UTC only. It never
// carries a subject, a transcript, or a task's name, description or command. The marker's reader already validated
// its kinds and ids; they are sanitised again at each call site, so a reader defect cannot carry a hostile string
// into a pane.

/** Why no coordinator was told, for a push that reached the operator instead. `stallR3Cause` says the same two. */
const STALL_PAUSED_LINE = 'Coordination is paused, so no report went to the coordinator. Lift the pause with POST /api/coord/pause.';
const STALL_NO_COORDINATOR_LINE = 'The run has no coordinator, so no report went to one.';
/** The self-mail heads' words, taken from their prefixes, so no second quoted copy exists. */
const STALL_ORPHANED_WORD = STALL_ORPHANED_PREFIX.slice(0, -1);
const STALL_FAILED_WORD = STALL_FAILED_PREFIX.slice(0, -1);

type OkTurnMark = Extract<TurnMarkRead, { readonly ok: true }>;

/** Non-empty sentences, joined by one space. */
function stallSentences(...parts: readonly string[]): string {
  return parts.filter((p) => p !== '').join(' ');
}

/** `Their ids: a, b.` over sanitised ids, or `No task ids were recorded.` */
function stallTaskIds(ids: readonly string[]): string {
  return ids.length === 0 ? 'No task ids were recorded.' : `Their ids: ${ids.map(stallSafe).join(', ')}.`;
}

/** A span, or `an unmeasured time`, which is never a guess. */
function stallSpanOrUnmeasured(since: number | null, now: number): string {
  return since === null ? 'an unmeasured time' : stallSpan(now - since);
}

/** Line 1 of a self-mail: who it is from, and the session, with its run when it has one. */
function stallSelfHead(word: string, input: StallSessionInput): string {
  const run = input.run === null ? '' : `, ${stallRunLabel(input.run)}`;
  return `${word} from the ccrc stall watch (server), session ${stallSafe(input.sessionId)}${run}.`;
}

/** The marker a self-mail reports from. The verdict fired on a marker that reads, so one that does not is a caller
 *  defect: it is refused, loudly. */
function stallReadMark(input: StallSessionInput, what: string): OkTurnMark {
  if (!input.mark.ok) throw new RangeError(`stallSessionMail: ${what} is written from a marker that reads, and this one reads ${input.mark.reason}`);
  return input.mark;
}

/** orphan (D), to the session (Case D). */
function stallOrphanDMail(input: StallSessionInput): StallNoticeText {
  const m = stallReadMark(input, 'an orphan notice (D)');
  const stop = m.stopAt === null ? 'none recorded' : stallUtcSec(m.stopAt);
  return {
    subject: stallOrphanDSubject(m),
    body: [
      stallSelfHead(STALL_ORPHANED_WORD, input),
      `Your session restarted at ${stallUtcSec(m.restartAt ?? Number.NaN)}. At your last turn end before it (${stop}), ${stallInt(m.lostBg)} background task(s) were running (${stallKinds(m.lostKinds)}). They ran inside the process that restart replaced, and none of them survived it.`,
      stallTaskIds(m.lostIds),
      'Report what was lost to whoever you owe a report. Resume a workflow only when that is cheap: never relaunch an expensive or long-running workflow by default.',
    ].join('\n'),
  };
}

/** orphan (E), to the session (S4). */
function stallOrphanEMail(input: StallSessionInput, now: number): StallNoticeText {
  const m = stallReadMark(input, 'an orphan notice (E)');
  const w = input.worker;
  const since = w.present && w.live.ok ? w.live.since : null;
  const idle = since === null ? '' : `: your main loop has been idle since ${stallUtcSec(since)} (${stallSpan(now - since)})`;
  return {
    subject: stallOrphanESubject(m),
    body: [
      stallSelfHead(STALL_ORPHANED_WORD, input),
      `Your turn ended at ${stallUtcSec(m.stopAt ?? Number.NaN)} with ${stallInt(m.bg)} background task(s) running (${stallKinds(m.bgKinds)}), and no turn has run since${idle}.`,
      stallTaskIds(m.bgIds),
      "A task that ends reports to whoever started it, and a notice that reaches no running loop wakes nobody. Check each task's result now, and report what it found to whoever you owe a report.",
    ].join('\n'),
  };
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

/** `stall: run <id> — <kind>: <rest>`: the form `stallReportKind` reads back. */
function stallW2ReportSubject(run: StallRunRow, kind: Exclude<StallReportKind, 'stall'>, rest: string): string {
  return `${STALL_REPORT_PREFIX} run ${stallInt(run.id)} — ${kind}: ${rest}`;
}

/** A report's first line (wave 1's r2 opens the same way). */
function stallReportHead(run: StallRunRow): string {
  return `stall from the ccrc stall watch (server), ${stallRunLabel(run)}, state ${stallSafe(run.state)}.`;
}

/** `Worker <id> (workspace <ws>)`. */
function stallWorkerRef(run: StallRunRow): string {
  return `Worker ${stallSafe(run.sessionId)} (workspace ${run.workspace === null ? 'none' : stallSafe(run.workspace)})`;
}

/** failed rung 2, to the coordinator: a report. */
function stallFailedReportMail(input: StallSessionInput, err: string, because: 'repeat' | 'request', stopAt: number): StallNoticeText {
  const run = input.run;
  if (run === null) throw new RangeError('stallSessionMail: a failed report names its run, and this session is on none');
  const e = stallSafe(err);
  // Final fix wave, TRI-6: "told" only when a first failure's rung 1 went out live. A shadow row records the failure
  // and sent nothing (it stands while the self-mail is unarmed), so the report names when that failure was recorded.
  const priors = stallPriorFailedNotices(input, stopAt);
  const first = priors.reduce<StallNotice | null>((f, n) => (f === null || n.key < f.key ? n : f), null);
  const toldLine = priors.some((n) => n.mode === 'live')
    ? 'It was told to retry once after the first.'
    : first === null ? 'It was not told to retry.' : `A first failure was recorded at ${stallUtcSec(first.key)} in shadow, so it was not told to retry.`;
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

export function stallSessionMail(input: StallSessionInput, n: StallNotify, now: number): StallNoticeText {
  if (n.to === 'worker') {
    if (n.arm === 'orphan-d') return stallOrphanDMail(input);
    if (n.arm === 'orphan-e') return stallOrphanEMail(input, now);
    if (n.arm === 'failed') return stallFailedMail(input, n.err, n.key);
  }
  if (n.arm === 'failed' && n.to === 'coordinator') return stallFailedReportMail(input, n.err, n.because, n.key);
  throw new RangeError(`stallSessionMail: ${n.arm} rung ${n.rung} to the ${n.to} is not a session notice`);
}

/** The frozen clock of a run subject, or null without wave-2 facts. */
function stallW2FrozenSince(input: StallInput): number | null {
  return input.w2 === undefined ? null : stallFrozenSince(input.w2.mark, input.w2.hook);
}

/** When a dead-shaped worker was first seen so: the lane's in-memory first-seen times. */
function stallDeadSince(input: StallInput, because: StallW2Cause): number | null {
  if (input.w2 === undefined) return null;
  return because === 'registry-absent' ? input.w2.absentSince : input.w2.deadSince;
}

/** The cause as a report subject names it. */
function stallDeadWords(because: StallW2Cause): string {
  switch (because) {
    case 'registry-absent': return 'registry row absent';
    case 'orphan': return 'orphan';
    case 'never-started': return 'never-started';
    case 'no-hook-event': return 'no hook event';
  }
}

/** The cause as a sentence, followed by `for <span>`. */
function stallDeadSentence(because: StallW2Cause): string {
  switch (because) {
    case 'registry-absent': return 'its registry row has been absent';
    case 'orphan': return 'its session has read orphan';
    case 'never-started': return 'its session has read never-started';
    case 'no-hook-event': return 'no hook event has arrived';
  }
}

export function stallW2ReportMail(input: StallInput, facts: StallFacts, n: StallNotify, now: number): StallNoticeText {
  if (n.arm !== 'frozen' && n.arm !== 'dead') throw new RangeError(`stallW2ReportMail: ${n.arm} is not a frozen or dead report`);
  if (n.to !== 'coordinator') throw new RangeError(`stallW2ReportMail: ${n.arm} to the ${n.to} is a push, never a report`);
  const run = input.subject.primary;
  if (n.arm === 'frozen') {
    const span = stallSpanOrUnmeasured(stallW2FrozenSince(input), now);
    return {
      subject: stallW2ReportSubject(run, 'frozen', `no hook event for ${span}`),
      body: [
        stallReportHead(run),
        `${stallWorkerRef(run)} reads busy with its turn open since ${stallUtcSec(n.key)}, and no hook event has arrived for ${span}.`,
        'A tool call or a process it waits on may be hung, and mail cannot land while the turn stays open. Ack this, look at the worker on its pane, and act once: interrupt the hung call there, or re-dispatch the worker if it measures dead. A stall mail never licenses re-dispatching a live worker.',
      ].join('\n'),
    };
  }
  const span = stallSpanOrUnmeasured(stallDeadSince(input, n.because), now);
  return {
    subject: stallW2ReportSubject(run, 'dead', `${stallDeadWords(n.because)} for ${span}`),
    body: [
      stallReportHead(run),
      `${stallWorkerRef(run)}: ${stallDeadSentence(n.because)} for ${span}. No mail from the worker ${stallSilence(run, facts, now, stallUtcSec)}.`,
      'Ack this, re-measure the worker, and act once: re-dispatch it, or reclaim the run. The watch itself closes, reclaims and re-dispatches nothing.',
    ].join('\n'),
  };
}

/** What a wave-2 push says about who and where: built from a run subject (`stallRunWho`) or from a session
 *  (`stallSessionWho`), so both push functions share one text per arm. */
interface StallPushWho {
  readonly ws: string;                  // the title's id, sanitised
  readonly lead: string;                // `<run label>: worker <id>`, `coordinator <id>` or `session <id>`, sanitised
  readonly sessionId: string;           // raw, for matching mail rows only
  readonly mark: TurnMarkRead | null;
  readonly mail: readonly StallMailRow[];
  readonly deliveries: readonly StallDeliveryRow[];
  readonly markUnreadableSince: number | null;
  readonly unreported: string;          // why no coordinator was told; '' when one was
}

function stallUnreported(role: StallSessionRole, paused: boolean, claimedBy: string | null): string {
  if (role === 'coordinator') return 'It is a coordinator, so no coordinator was told.';
  if (role === 'other') return 'It is on no run, so no coordinator was told.';
  if (paused) return STALL_PAUSED_LINE;
  return claimedBy === null ? STALL_NO_COORDINATOR_LINE : '';
}

function stallRunWho(input: StallInput): StallPushWho {
  const run = input.subject.primary;
  return {
    ws: stallSafe(run.workspace ?? run.sessionId),
    lead: `${stallRunLabel(run)}: worker ${stallSafe(run.sessionId)}`,
    sessionId: run.sessionId,
    mark: input.w2?.mark ?? null,
    mail: input.mail,
    deliveries: input.w2?.deliveries ?? [],
    markUnreadableSince: input.w2?.markUnreadableSince ?? null,
    unreported: stallUnreported('worker', input.coordinationPaused, run.claimedBy),
  };
}

function stallSessionWho(input: StallSessionInput): StallPushWho {
  const sid = stallSafe(input.sessionId);
  const who = input.role === 'other' ? `session ${sid}` : `${input.role} ${sid}`;
  return {
    ws: stallSafe(input.run?.workspace ?? input.sessionId),
    lead: input.run === null ? who : `${stallRunLabel(input.run)}: ${who}`,
    sessionId: input.sessionId,
    mark: input.mark,
    mail: input.mail,
    deliveries: input.deliveries,
    markUnreadableSince: input.markUnreadableSince,
    unreported: stallUnreported(input.role, input.coordinationPaused, input.run?.claimedBy ?? null),
  };
}

/** The state of an orphan notice, as rung 2 reports it. */
function stallOrphanNoticeState(notice: StallMailRow | null, deliveries: readonly StallDeliveryRow[], now: number): string {
  if (notice === null) return 'Its orphan notice is not in this read.';
  const d = stallNewestDelivery(deliveries, notice.id);
  const state = d === null ? 'has no delivery row'
    : d.ackedAt !== null ? `was acked at ${stallClockMin(d.ackedAt)}`
      : d.deliveredAt === null ? 'is not delivered' : `was delivered at ${stallClockMin(d.deliveredAt)} and is not acked`;
  return `Its orphan notice #${stallInt(notice.id)}, queued at ${stallUtc(notice.at)} (${stallSpan(now - notice.at)} ago), ${state}.`;
}

/** The operator push of a session arm. A run arm is refused: `stallPushText` owns it. */
function stallW2SessionPush(who: StallPushWho, n: StallNotify, now: number): { readonly title: string; readonly body: string } {
  switch (n.arm) {
    case 'orphan-d': {
      const m = who.mark !== null && who.mark.ok ? who.mark : null;
      const what = m === null
        ? `a restart at ${stallUtc(n.key)} orphaned its background tasks`
        : `${stallInt(m.lostBg)} background task(s) (${stallKinds(m.lostKinds)}) did not survive the ${stallUtc(n.key)} restart`;
      const notice = m === null ? null
        : newestMail(who.mail, (x) => x.fromId === STALL_SENDER && x.toId === who.sessionId && x.subject === stallOrphanDSubject(m));
      return { title: `⚠ orphaned › ${who.ws}`, body: `${who.lead}: ${what}. ${stallOrphanNoticeState(notice, who.deliveries, now)}` };
    }
    case 'failed': {
      const why = n.rung === 2 && n.because === 'repeat'
        ? `its second retryable failure within ${stallSpan(FAILED_REPEAT_MS)}`
        : 'a retry fails the same way, so it was not told to retry';
      return {
        title: `⚠ failed › ${who.ws}`,
        body: stallSentences(`${who.lead}: its turn ended on an API error (${stallSafe(n.err)}) at ${stallUtc(n.key)}; ${why}.`, who.unreported),
      };
    }
    case 'mail-stuck': {
      const d = who.deliveries.find((x) => x.id === n.key) ?? null;
      const m = d === null ? null : who.mail.find((x) => x.id === d.mailId) ?? null;
      const ref = d === null ? '' : m === null
        ? ` (mail #${stallInt(d.mailId)})`
        : ` (mail #${stallInt(m.id)} ${stallSafe(m.kind)} from ${stallSafe(m.fromId)}, queued at ${stallUtc(m.at)}, ${stallSpan(now - m.at)} ago)`;
      const gate = d === null || d.lastGate === null ? ''
        : ` Its last gate: ${stallSafe(d.lastGate)}${d.gateSince === null ? '' : ` since ${stallUtc(d.gateSince)}`}.`;
      return { title: `⚠ mail stuck › ${who.ws}`, body: `${who.lead}: delivery #${stallInt(n.key)}${ref} is still undelivered.${gate}` };
    }
    case 'marker-unreadable': {
      const reason = who.mark !== null && !who.mark.ok ? stallSafe(who.mark.reason) : 'unreadable';
      const since = who.markUnreadableSince ?? n.key;
      return {
        title: `⚠ marker › ${who.ws}`,
        body: `${who.lead}: its turn marker has read ${reason} since ${stallUtc(since)} (${stallSpan(now - since)}). The busy gate and the wave-2 arms fall back to wave 1 for it until the marker reads again.`,
      };
    }
    default:
      throw new RangeError(`stall push: ${n.arm} is a run arm, and stallPushText owns its text`);
  }
}

export function stallSessionPushText(input: StallSessionInput, n: StallNotify, now: number): { readonly title: string; readonly body: string } {
  if (n.to !== 'operator') throw new RangeError(`stallSessionPushText: rung ${n.rung} of ${n.arm} goes to the ${n.to} as mail, never as a push`);
  return stallW2SessionPush(stallSessionWho(input), n, now);
}

/** Every stall push's notify kind and collapse tag, for the run verdict and the session verdicts alike (spec §4.2
 *  "Push shape", §11 "The push classifier's home and kind"), so the lane spells neither. The kind is `run`, and
 *  `mail` only for a run-less orphan: the delayed orphan push (orphan D rung 2) of a session on no run. That push is
 *  tagged `orphaned-<toId>-<restartAt>` for EVERY session, a run worker's included. Every other push is tagged
 *  `stall-<runId>-<arm>-<rung>-<key>`, or `stall-<toId>-…` for a run-less session. The tag is also the lane's
 *  run-less push latch key. */
export function stallPushRoute(n: Pick<StallNotify, 'arm' | 'rung' | 'key'>, toId: string, runId: number | null): { readonly kind: 'run' | 'mail'; readonly tag: string } {
  if (n.arm === 'orphan-d' && n.rung === 2) return { kind: runId === null ? 'mail' : 'run', tag: `orphaned-${toId}-${n.key}` };
  return { kind: 'run', tag: `stall-${runId ?? toId}-${n.arm}-${n.rung}-${n.key}` };
}

/** coord-deaf's body: the ball-passing mail, its newest delivery, and that it is unacked. */
function stallDeafBody(input: StallInput, label: string, worker: string, mailId: number, now: number): string {
  const m = input.mail.find((x) => x.id === mailId) ?? null;
  if (m === null) return `${label}: mail #${stallInt(mailId)} from worker ${worker} to its coordinator is not acked.`;
  const d = stallNewestDelivery(input.w2?.deliveries ?? [], m.id);
  const state = d === null ? 'has no delivery row' : d.deliveredAt === null ? 'is not delivered' : `was delivered at ${stallClockMin(d.deliveredAt)}`;
  return `${label}: mail #${stallInt(m.id)} ${stallSafe(m.kind)} from worker ${worker} to ${stallSafe(m.toId)}, queued at ${stallUtc(m.at)} (${stallSpan(now - m.at)} ago), ${state} and is not acked. The run waits on that coordinator: look at it on its pane.`;
}
