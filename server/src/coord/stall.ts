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
  return STALL_KEBABS.has(token);
}
