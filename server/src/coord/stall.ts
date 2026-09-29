import { REVIEW_DONE_SUBJECT, WAVE_DONE_SUBJECT, isRunState, isSessionLifecycle, lifecycleIsDead } from '../../../shared/api.js';
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
/** The observation-detail heads: `stall:<arm>:<rung>:<key>` when sent, `stall-shadow:<arm>:<rung>:<key>` in shadow.
 *  They live in `run_events.detail`, never in a mail subject. `stallDetail` writes them, `parseStallDetail` reads
 *  them back, and nothing else spells them. */
const STALL_DETAIL_LIVE = 'stall';
const STALL_DETAIL_SHADOW = 'stall-shadow';
/** The sender every watch notice carries: the operator role (`SystemMailSender`), never a session. */
const STALL_SENDER = 'operator';

// ── arms, holds, markers ─────────────────────────────────────────────────────────────────────────────────────

/** Wave 1's arms (§4.2). Wave 2 adds its own keys here, each with the code that fires it. */
const STALL_ARM_MAP = {
  quiet: 'the ladder: the worker holds the ball and has been idle past the quiet threshold (r1 worker, r2 coordinator, r3 operator)',
  'limit-cap': 'the usage-limit hold past its cap: one operator push per episode',
  'dialog-cap': 'a dialog with no question behind it, past the quiet threshold: one operator push per episode',
  'coord-ball': 'the coordinator has held the ball past its cap with no mail on the run: one operator push per episode',
} as const;
export type StallArm = keyof typeof STALL_ARM_MAP;
export const STALL_ARMS = Object.keys(STALL_ARM_MAP) as StallArm[];
function isStallArm(v: string): v is StallArm {
  return Object.prototype.hasOwnProperty.call(STALL_ARM_MAP, v);
}

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
} as const;
export type StallHold = keyof typeof STALL_HOLD_MAP;
export const STALL_HOLDS = Object.keys(STALL_HOLD_MAP) as StallHold[];

/** The lane's registry markers. None has a writer in the tree. Each is touched and removed by hand on the fleet box,
 *  following the `mail-disabled` precedent, and the lane reads them from one listing per tick. */
const STALL_MARKER_MAP = {
  'stall-watch-disabled': 'the lane returns: nothing is recorded or sent',
  'stall-watch-live': 'notices to the stalled session itself are sent (r1); absent, every arm is shadow',
  'stall-watch-escalate': 'with the live marker, coordinator notices and operator pushes are sent',
} as const;
export type StallMarker = keyof typeof STALL_MARKER_MAP;
export const STALL_MARKERS = Object.keys(STALL_MARKER_MAP) as StallMarker[];

/** The store reads the lane depends on. Each fails as its own word, following D-2545's all-or-failure idiom. */
export const STALL_READ_FAILURES = ['run-unreadable', 'mail-unreadable', 'delivery-unreadable'] as const;
export type StallReadFailure = (typeof STALL_READ_FAILURES)[number];
/** Why an observation write (or a notice) recorded nothing: the run already holds this exact detail, or the run is
 *  gone. `store.ts` answers with these words. */
export const STALL_WRITE_MISSES = ['duplicate', 'run-gone'] as const;
export type StallWriteMiss = (typeof STALL_WRITE_MISSES)[number];

// ── arming and delivery ──────────────────────────────────────────────────────────────────────────────────────

export interface StallArming { readonly disabled: boolean; readonly live: boolean; readonly escalate: boolean }

/** One registry listing (the one `tick()` already took) gives the arming. A marker is a whole file name. */
export function stallArmingOf(names: readonly string[]): StallArming {
  const has = (m: StallMarker): boolean => names.includes(m);
  return { disabled: has('stall-watch-disabled'), live: has('stall-watch-live'), escalate: has('stall-watch-escalate') };
}

export type StallRecipient = 'worker' | 'coordinator' | 'operator';

/** A notice to the stalled session itself is sent under the live marker. A notice to a coordinator, and every
 *  operator push, needs the escalate marker as well. Anything else is recorded in shadow. */
export function stallDelivery(to: StallRecipient, arming: StallArming): 'send' | 'shadow' {
  if (to === 'worker') return arming.live ? 'send' : 'shadow';
  return arming.live && arming.escalate ? 'send' : 'shadow';
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
export interface StallMailRow { readonly id: number; readonly at: number; readonly runId: number; readonly fromId: string;
  readonly toId: string; readonly kind: string; readonly subject: string }

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

export type StallMailClass = 'check' | 'reply' | 'report';
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
 *  'reply': a reply subject that is bound (above). Anything else: null, which means ordinary mail. */
export function stallMailClass(
  m: { readonly fromId: string; readonly runId: number | null; readonly subject: string; readonly mailId: number },
  bind?: StallBind,
): StallMailClass | null {
  if (m.fromId === STALL_SENDER && m.subject.startsWith(STALL_CHECK_PREFIX)) return 'check';
  if (m.fromId === STALL_SENDER && m.subject.startsWith(STALL_REPORT_PREFIX)) return 'report';
  if (bind !== undefined && m.subject.startsWith(STALL_REPLY_PREFIX) && stallReplyBound(m, bind)) return 'reply';
  return null;
}

// ── the kebab guard (mail-routes.test.ts, twelfth union) ─────────────────────────────────────────────────────

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
 *  question, however old it is (planning departure ask-hold-correlates-the-dialog). */
export const ASK_DIALOG_SLACK_MS = 60_000;

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

/** The hookstate ask, read identity-gated but NOT aged (the lane's unaged hookstate read). */
export type HookAskFact = { readonly kind: 'ask'; readonly at: number } | { readonly kind: 'none' } | { readonly kind: 'unmeasured' };
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
}
export type StallR3Cause = 'still-silent' | 'coordinator-dead' | 'no-coordinator' | 'coordination-paused';
/** Total over the r3 causes, for `isStallKebab`. */
const STALL_R3_CAUSE_MAP: Record<StallR3Cause, string> = {
  'still-silent': 'the coordinator was told at r2, and the worker is still silent an hour later',
  'coordinator-dead': 'r2 skipped: the claimant measured dead, so the reclaim door applies',
  'no-coordinator': 'r2 skipped: the run has no claimant, and no door is named',
  'coordination-paused': 'r2 skipped: coordination is paused; the pause route lifts it',
};
export type StallNotify =
  | { readonly act: 'notify'; readonly arm: 'quiet'; readonly rung: 1; readonly key: number; readonly to: 'worker' }
  | { readonly act: 'notify'; readonly arm: 'quiet'; readonly rung: 2; readonly key: number; readonly to: 'coordinator'; readonly coordinatorId: string }
  | { readonly act: 'notify'; readonly arm: 'quiet'; readonly rung: 3; readonly key: number; readonly to: 'operator'; readonly because: StallR3Cause }
  | { readonly act: 'notify'; readonly arm: 'limit-cap' | 'dialog-cap' | 'coord-ball'; readonly rung: 1; readonly key: number; readonly to: 'operator' };
export type StallVerdict =
  | { readonly act: 'none' }
  | { readonly act: 'hold'; readonly why: StallHold }
  | { readonly act: 'measure-coordinator'; readonly coordinatorId: string }
  | StallNotify;
/** Total over the verdict's acts, for `isStallKebab` (planning departure r2-measures-on-demand). */
const STALL_ACT_MAP: Record<StallVerdict['act'], string> = {
  none: 'nothing is due',
  hold: 'a hold defers every rung and cancels none',
  'measure-coordinator': 'r2 is due: the lane measures the claimant and asks again',
  notify: 'a rung or a cap fires',
};
/** This block's kebab words, derived from its three total Records, never a hand list. */
const STALL_VERDICT_KEBABS: ReadonlySet<string> = new Set([
  ...Object.keys(LIVE_WORD_UNREAD_MAP), ...Object.keys(STALL_R3_CAUSE_MAP), ...Object.keys(STALL_ACT_MAP),
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

/** The watch's own notices (a stall-check to the worker, a stall report to the coordinator) are not mail
 *  on the run. Counting them would restart the clock the notice reports. A reply is the worker's mail. */
function isWatchNotice(m: StallMailRow): boolean {
  const c = stallMailClass({ fromId: m.fromId, runId: m.runId, subject: m.subject, mailId: m.id });
  return c === 'check' || c === 'report';
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

export function stallFacts(input: StallInput): StallFacts {
  const { primary, runs } = input.subject;
  const workerId = primary.sessionId;
  const coordinatorIds = new Set<string>(['coordinator']);
  for (const r of runs) if (r.claimedBy !== null) coordinatorIds.add(r.claimedBy);
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
 *  mail and a coordinator `wait:` close the episode through its key instead. */
function rungDueAt(rungAt: number, liveSince: number, gap: number): number {
  return liveSince > rungAt + gap ? liveSince + gap : rungAt + gap;
}

function rungRecipient(arm: StallArm, rung: 1 | 2 | 3): StallRecipient {
  if (arm !== 'quiet') return 'operator';
  if (rung === 1) return 'worker';
  return rung === 2 ? 'coordinator' : 'operator';
}

/** Planning departure shadow-rung-accounting. A rung is DONE when a live row exists for it, or when a
 *  shadow row exists and the rung's delivery is still shadow under the current markers, so arming
 *  mid-episode sends the pending rung once. Its time is its EARLIEST LIVE row when one exists, else its
 *  earliest row: a rung re-sent live is timed from the notice its recipient actually got, so the next
 *  rung waits the hour the r1 body promises (spec §4.2, "r2 at r1 + 1 h … r3 at r2 + 1 h"), and a rung
 *  standing in shadow is timed from its shadow row. Not done: null. */
function rungDoneAt(input: StallInput, arm: StallArm, rung: 1 | 2 | 3, key: number): number | null {
  const rows = input.notices.filter((n) => n.arm === arm && n.rung === rung && n.key === key);
  const liveRow = rows.some((n) => n.mode === 'live');
  const shadowStands = rows.some((n) => n.mode === 'shadow') && stallDelivery(rungRecipient(arm, rung), input.arming) === 'shadow';
  if (!liveRow && !shadowStands) return null;
  const live = rows.filter((n) => n.mode === 'live');
  const timed = live.length > 0 ? live : rows;
  return timed.reduce((earliest, n) => Math.min(earliest, n.at), Number.POSITIVE_INFINITY);
}

export function stallVerdict(input: StallInput, now: number): StallVerdict {
  const p = input.subject.primary;
  // (1) a run this build cannot name
  if (!isRunState(p.state) || p.state === 'unknown') return holdVerdict('run-unnamed');
  if (p.kind !== 'work' && p.kind !== 'review') return holdVerdict('run-unnamed');
  // (2) a worker absent from this tick (planning departure absent-worker-holds), then any unmeasured input
  const w = input.worker;
  if (!w.present) return holdVerdict('absent');
  const live = w.live;
  const lc = w.lifecycle;
  if (w.unmeasured) return holdVerdict('unmeasured');
  if (!live.ok) return holdVerdict('unmeasured');
  if (lc === null || !isSessionLifecycle(lc) || lc === 'unmeasurable') return holdVerdict('unmeasured');
  if (p.dispatchedAt === null) return holdVerdict('unmeasured');
  if (live.since === null) return holdVerdict('unmeasured');
  const dialogShaped = live.word === 'waiting' || w.dialogPending;
  if (dialogShaped && (w.hookAsk.kind === 'unmeasured' || w.askRow.kind === 'unmeasured')) return holdVerdict('unmeasured');
  // (3) lifecycle: restarting and the dead words hold; unsupervised and unclaimed are judged as running
  if (lc === 'restarting' || lifecycleIsDead(lc)) return holdVerdict('lifecycle');
  const f = stallFacts(input);
  const key = f.episodeKeyMs;
  const capQuiet = now - capQuietSince(input, f, live.since);
  // (4) hold 2a (a question, uncapped), then 2b (a dialog with no ask, capped once per episode)
  const hookAskCorrelated = w.hookAsk.kind === 'ask' && live.since !== null && w.hookAsk.at >= live.since - ASK_DIALOG_SLACK_MS;
  const askRowOpen = w.askRow.kind === 'row' && (w.askRow.state === 'held' || w.askRow.state === 'answering');
  if (live.word === 'waiting' && (hookAskCorrelated || askRowOpen)) return holdVerdict('ask');
  if (dialogShaped) return capQuiet >= STALL_QUIET_MS && rungDoneAt(input, 'dialog-cap', 1, key) === null ? capVerdict('dialog-cap', key) : holdVerdict('dialog');
  // (5) the limit hold, capped once per episode; a null limits or a null window is neither at the ceiling nor unmeasured
  const lim = w.limits;
  const atCeiling = lim !== null && ((lim.five !== null && lim.five >= 100) || (lim.seven !== null && lim.seven >= 100));
  const autoContinueRecent = w.autoContinueHeldAt !== null && w.autoContinueHeldAt > now - AUTO_CONTINUE_RECENT_MS;
  if (atCeiling || w.stranded || w.swapBlocked || autoContinueRecent) {
    return capQuiet >= LIMIT_HOLD_CAP_MS && rungDoneAt(input, 'limit-cap', 1, key) === null ? capVerdict('limit-cap', key) : holdVerdict('limit');
  }
  // (6) the coordinator's ball: none below its cap (planning departure coord-ball-below-cap-is-none)
  if (f.ball === 'coordinator') {
    const ballAge = f.lastExchangeAt === null ? 0 : now - f.lastExchangeAt;
    return ballAge >= COORD_BALL_CAP_MS && rungDoneAt(input, 'coord-ball', 1, key) === null ? capVerdict('coord-ball', key) : VERDICT_NONE;
  }
  // (7) the worker's ball. The quiet clock (the live stamp, and any mail) gates r1 only. A later rung falls due
  // an hour after the previous one on the RAW live stamp (`rungDueAt`), so it re-times only when a busy read
  // pushed the word's turn to idle past that hour.
  if (live.word === 'busy') return holdVerdict('busy');
  if (!isIdleWord(live.word) || f.quietSince === null) return holdVerdict('unmeasured');
  const since = f.quietSince;
  const r1At = rungDoneAt(input, 'quiet', 1, key);
  if (r1At === null) return now - since >= STALL_QUIET_MS ? { act: 'notify', arm: 'quiet', rung: 1, key, to: 'worker' } : VERDICT_NONE;
  if (rungDoneAt(input, 'quiet', 3, key) !== null) return VERDICT_NONE;
  const r2At = rungDoneAt(input, 'quiet', 2, key);
  if (r2At !== null) return now >= rungDueAt(r2At, live.since, STALL_OPERATOR_MS) ? r3Verdict(key, 'still-silent') : VERDICT_NONE;
  if (now < rungDueAt(r1At, live.since, STALL_ESCALATE_MS)) return VERDICT_NONE;
  if (input.coordinationPaused) return r3Verdict(key, 'coordination-paused');
  if (p.claimedBy === null) return r3Verdict(key, 'no-coordinator');
  if (input.coordinator === null) return { act: 'measure-coordinator', coordinatorId: p.claimedBy };
  if (input.coordinator === 'alive') return { act: 'notify', arm: 'quiet', rung: 2, key, to: 'coordinator', coordinatorId: p.claimedBy };
  if (input.coordinator === 'unmeasurable') return holdVerdict('coordinator-unmeasurable');
  return r3Verdict(key, 'coordinator-dead');
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

/** When the worker's quiet began. The episode key stands in when the facts carry no quiet start. */
function stallQuietFrom(facts: StallFacts): number {
  return facts.quietSince ?? facts.episodeKeyMs;
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

/** r1: the stall check. It carries its own protocol, so no skill has to be installed first (§11 decision 3). */
export function stallCheckMail(input: StallInput, facts: StallFacts, now: number): StallNoticeText {
  const run = input.subject.primary;
  const id = stallInt(run.id);
  const since = stallQuietFrom(facts);
  const quiet = stallSpan(now - since);
  const toCoordinator = now + STALL_ESCALATE_MS;
  const toOperator = toCoordinator + STALL_OPERATOR_MS;
  const direct = input.coordinationPaused || run.claimedBy === null;
  const last = direct
    ? `No mail from you on run ${id} by ${stallDeadline(toCoordinator)}: the operator is told.`
    : `No mail from you on run ${id} by ${stallDeadline(toCoordinator)}: the coordinator is told. By ${stallDeadline(toOperator)}: the operator.`;
  return {
    subject: `${STALL_CHECK_PREFIX} run ${id} — quiet ${quiet}, owed: ${stallOwed(facts)}`,
    body: [
      `stall-check from the ccrc stall watch (server), ${stallRunLabel(run)}.`,
      `Your main loop has been idle since ${stallUtcSec(since)} (${quiet}). Your last mail on this run: ${stallMailRef(facts.workerLast)}. Newest mail to you on this run: ${stallMailRef(facts.inboundLast)}.`,
      STALL_WAKE_LINE,
      `Before anything else, send ONE mail on run ${id} to toId 'coordinator', kind status:`,
      `still working — subject beginning "${STALL_REPLY_PREFIX} working", what you are doing and when you report next;`,
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
  const since = stallQuietFrom(facts);
  const quiet = stallSpan(now - since);
  const check = r1.mode === 'live' ? stallLastCheck(input) : null;
  const checkWord = STALL_CHECK_PREFIX.slice(0, -1); // the word, never a second quoted kebab literal in server/src/coord
  const checkRef = check === null ? checkWord : `${checkWord} #${stallInt(check.id)}`;
  const workspace = run.workspace === null ? 'none' : stallSafe(run.workspace);
  return {
    subject: `${STALL_REPORT_PREFIX} run ${stallInt(run.id)} — worker quiet ${quiet}, ${checkRef} unanswered`,
    body: [
      `stall from the ccrc stall watch (server), ${stallRunLabel(run)}, state ${stallSafe(run.state)}.`,
      `Worker ${stallSafe(run.sessionId)} (workspace ${workspace}) has been quiet since ${stallUtcSec(since)} (${quiet}). Its last mail on this run: ${stallMailRef(facts.workerLast)}. Newest mail to it on this run: ${stallMailRef(facts.inboundLast)}.`,
      stallR1Line(r1, check, r1Delivery),
      `Ack this, re-measure the run and the worker's last mail, and act once: mail the worker a resume, mail it a subject beginning "${STALL_WAIT_PREFIX}" naming what it waits for, or re-dispatch a dead worker. A stall mail never licenses re-dispatching a live worker.`,
    ].join('\n'),
  };
}

/** r3's cause, in words. A paused coordinator is alive, so the reclaim door is never named for it: reclaim would
 *  refuse it (§4.2). */
function stallR3Cause(because: StallR3Cause, coordinator: string, runId: number): string {
  switch (because) {
    case 'still-silent': return `The stall check and the report to its coordinator ${coordinator} both went unanswered.`;
    case 'coordinator-dead': return `Its coordinator ${coordinator} measures dead, so no report went to it. Reclaim the run: POST /api/runs/${stallInt(runId)}/reclaim.`;
    case 'no-coordinator': return 'The run has no coordinator, so no report went to one.';
    case 'coordination-paused': return 'Coordination is paused, so no report went to the coordinator. Lift the pause with POST /api/coord/pause.';
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

/** The operator pushes: r3 and the three caps. `<ws>` is the run's workspace, or its session when it has none. */
export function stallPushText(input: StallInput, facts: StallFacts, n: StallNotify, now: number): { readonly title: string; readonly body: string } {
  if (n.to !== 'operator') throw new RangeError(`stallPushText: rung ${n.rung} of ${n.arm} goes to the ${n.to} as mail, never as a push`);
  const run = input.subject.primary;
  const ws = stallSafe(run.workspace ?? run.sessionId);
  const worker = stallSafe(run.sessionId);
  const coordinator = run.claimedBy === null ? 'none' : stallSafe(run.claimedBy);
  const label = stallRunLabel(run);
  switch (n.arm) {
    case 'quiet': {
      const since = stallQuietFrom(facts);
      return {
        title: `⚠ stalled › ${ws}`,
        body: `${label}: worker ${worker} quiet since ${stallUtc(since)} (${stallSpan(now - since)}). ${stallR3Cause(n.because, coordinator, run.id)}`,
      };
    }
    case 'dialog-cap':
      return {
        title: `⚠ stalled › ${ws} (dialog)`,
        body: `${label}: worker ${worker} shows a dialog with no question behind it; this quiet episode opened ${stallUtc(n.key)} (${stallSpan(now - n.key)}). Neither the worker nor its coordinator can be mailed while it shows: answer or dismiss it on the pane.`,
      };
    case 'limit-cap':
      return {
        title: `⚠ limit › ${ws}`,
        body: `${label}: worker ${worker} has been held by a usage limit past the ${stallSpan(LIMIT_HOLD_CAP_MS)} cap; this quiet episode opened ${stallUtc(n.key)} (${stallSpan(now - n.key)}). Measured: ${stallLimitFacts(input.worker)}.`,
      };
    case 'coord-ball': {
      const last = facts.lastExchangeAt ?? n.key;
      return {
        title: `⚠ waiting › ${ws}`,
        body: `${label}: worker ${worker} handed the run to its coordinator ${coordinator}, and no mail has passed on the run since ${stallUtc(last)} (${stallSpan(now - last)}).`,
      };
    }
  }
}
