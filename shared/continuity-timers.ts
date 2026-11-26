/** The timers' vocabulary (Overlord design spec §3.3.12, C61 to C65, Table 3.3.12a, I17, Tables 11.1b and 11.5b; the spec
 *  is `docs/superpowers/specs/2026-11-09-overlord-design.md`; the plan is
 *  `docs/superpowers/plans/2026-11-10-overlord/w1a-timers.md`, Task 1). Ring L0, context K: pure vocabulary, no import.
 *
 *  A timer is a reminder a session sets itself. The server keeps it as a row of `continuity_timers`, stamped with the
 *  setter's incarnation, and the timers lane fires it once, in the transaction that queues its one mail (I17). It never
 *  acts: its only effects are its row's moves and that mail. Its own file, beside `continuity-card.ts`, so the timers
 *  change for one reason (slug timers-vocabulary-file). The cap by role is the `timerCap` column of `FLEET_ROLES`
 *  (`shared/fleetRoles.ts`, slug timer-cap-is-a-role-column); the refusal words are `TIMER_REFUSALS` in `shared/refusal.ts`. */

/** A timer's states (C61): waiting, fired once with its mail, or cancelled. */
const TIMER_STATE_MAP = {
  pending: 'set and not yet due, or due and not yet fired',
  fired: 'its one mail was queued in the same transaction',
  cancelled: 'cancelled by its setter, the operator or the cleanup; it never fires',
} as const;
export type TimerState = keyof typeof TIMER_STATE_MAP;
export const TIMER_STATES = Object.keys(TIMER_STATE_MAP) as TimerState[];
export const TERMINAL_TIMER_STATES = ['fired', 'cancelled'] as const satisfies readonly TimerState[];

/** Who moves a timer: the set door, the timers lane, the setter's cancel, the operator's cancel, the lane's cleanup arm. */
export type TimerActor = 'set-door' | 'timer-lane' | 'setter-cancel' | 'operator-cancel' | 'cleanup';
const TIMER_ACTOR_MAP: Readonly<Record<TimerActor, true>> = {
  'set-door': true, 'timer-lane': true, 'setter-cancel': true, 'operator-cancel': true, cleanup: true,
};
export const TIMER_ACTORS = Object.keys(TIMER_ACTOR_MAP) as TimerActor[];

/** One actor and one target on each move. `from: null` is the set. Every writer of `continuity_timers` checks its move
 *  here (`timerMoveAllowed`), and `server/test/single-definition/writers-map.test.ts` names the one function per move. */
export const TIMER_TRANSITIONS: readonly {
  readonly from: TimerState | null; readonly to: TimerState; readonly actor: TimerActor;
}[] = [
  { from: null, to: 'pending', actor: 'set-door' },
  { from: 'pending', to: 'fired', actor: 'timer-lane' },
  { from: 'pending', to: 'cancelled', actor: 'setter-cancel' },
  { from: 'pending', to: 'cancelled', actor: 'operator-cancel' },
  { from: 'pending', to: 'cancelled', actor: 'cleanup' },
];

/** Whether `actor` may move a timer from `from` to `to`: a row of `TIMER_TRANSITIONS`, and nothing else. */
export function timerMoveAllowed(from: TimerState | null, to: TimerState, actor: TimerActor): boolean {
  return TIMER_TRANSITIONS.some((t) => t.from === from && t.to === to && t.actor === actor);
}

/** Each cancel reason, and the one actor that may write it (slug cancel-reason-by-actor): `cancelTimer` refuses any other
 *  pairing. `retired` has its writer, the cleanup arm, from W1 (the Overlord's designation). */
const TIMER_CANCEL_REASON_MAP = {
  setter: 'setter-cancel',
  operator: 'operator-cancel',
  'run-closed': 'cleanup',
  'programme-ended': 'cleanup',
  'setter-archived': 'cleanup',
  'setter-gone': 'cleanup',
  retired: 'cleanup',
} as const satisfies Record<string, TimerActor>;
export type TimerCancelReason = keyof typeof TIMER_CANCEL_REASON_MAP;
export const TIMER_CANCEL_REASONS = Object.keys(TIMER_CANCEL_REASON_MAP) as TimerCancelReason[];
export function isTimerCancelReason(s: string): s is TimerCancelReason { return Object.hasOwn(TIMER_CANCEL_REASON_MAP, s); }
export const cancelActorOf = (r: TimerCancelReason): TimerActor => TIMER_CANCEL_REASON_MAP[r];

/** The bounds (Table 11.5b). Text lengths are Unicode code points (`[...note].length`), in the door and the deciders. */
export const TIMER_NOTE_MAX_CHARS = 500;
/** Whether a note is within its bound: a string of at most `TIMER_NOTE_MAX_CHARS` code points. The set door asks it before
 *  the egress masker reads a note, so the masker's patterns never run over an unbounded string (CodeQL js/polynomial-redos
 *  and js/resource-exhaustion); `timerBodyVerdict` alone refuses `timer-too-long`, and a test holds the two in agreement.
 *  The UTF-16 length is checked first: a string of more than twice the bound in code units is over it in code points. */
export function timerNoteFits(note: unknown): note is string {
  return typeof note === 'string' && note.length <= 2 * TIMER_NOTE_MAX_CHARS && [...note].length <= TIMER_NOTE_MAX_CHARS;
}
/** The earliest a timer may come due: five minutes. Not `TIMER_MAX_MS`, which is the `Scheduler`'s ceiling (D-8223). */
export const TIMER_DUE_MIN_MS = 300_000;
/** The latest a timer may come due: 30 days. */
export const TIMER_DUE_MAX_MS = 2_592_000_000;
/** How many timers one identity may set in an hour, cancelled ones counted. */
export const TIMER_SETS_PER_HOUR = 30;
/** The timers lane's period (its `LANE_SCHEDULE` row). */
export const TIMER_LANE_PERIOD_MS = 60_000;
/** How long a fired or cancelled row is kept before the lane purges it: 90 days. */
export const TIMER_KEEP_MS = 7_776_000_000;
/** The stall hold never reaches past the stall ladder's start plus this: 24 hours. */
export const TIMER_HOLD_CAP_MS = 86_400_000;
/** The first words of a note the card line shows, in code points (`timerPreview`). */
export const TIMER_PREVIEW_CHARS = 60;
/** The role the timer mail comes from (C63): `rundefs.ts` keys its `SYSTEM_MAIL_SENDER_MAP` row by it, and `stall.ts`
 *  leaves its mail out of the stall facts. Never `operator`: a note is the session's own words, carried as data. */
export const TIMER_MAIL_SENDER = 'timer';

/** One pending timer as the doors answer it (`GET /api/timers`, the caller's own; `GET /api/sessions/:id/timers`, the
 *  operator's read), masked on the way out by the one answer hook. `note` is the setter's own words: `untrusted` tells a
 *  reader to render it as data, never as an instruction (I17). */
export interface TimerView {
  readonly id: number;
  readonly setAt: number;
  readonly dueAt: number;
  readonly note: string;
  readonly runId: number | null;
  readonly programme: string | null;
  readonly untrusted: true;
}

/** The stamp of an `overlord` timer (C61; plan `w1-overlord-timers.md` Task 1): the designation's `designatedTerm`, in
 *  decimal. One codec, both ways: the set door writes it and the cleanup compares with it, so a session's stamp (its
 *  registry `.generation`) never equals one. */
export function overlordTimerStamp(designatedTerm: number): string {
  return designatedTerm.toString(10);
}

/** How long after its mail's ack a fired timer of the role stays in the designated caller's list (question 2): 24 hours,
 *  a starting value (Table 11.5b). The window starts at the ack, because the card hold can keep the line from the pane. */
export const TIMER_FIRED_SHOWN_MS = 86_400_000;

/** Whether a fired timer was set before a confirmed restore of `coord.db` (question 5): the lane can tell that a timer was
 *  set before a restore, never that it fired before it, so `set-before-restore` says it may have. */
const TIMER_RESTORE_FACT_MAP = {
  none: 'no restore was confirmed between its set and its fire',
  'set-before-restore': 'it was set before a confirmed restore, so it may have fired once before that restore',
  unmeasured: 'whether a restore came between could not be read',
} as const;
export type TimerRestoreFact = keyof typeof TIMER_RESTORE_FACT_MAP;
export const TIMER_RESTORE_FACTS = Object.keys(TIMER_RESTORE_FACT_MAP) as TimerRestoreFact[];

/** One fired timer of the role, in the designated caller's list answer (question 2). */
export interface FiredTimerView extends TimerView { readonly firedAt: number; readonly restore: TimerRestoreFact }

/** The timer doors, as the refusal count names them (question 6, M36). */
const TIMER_DOOR_MAP = {
  set: 'POST /api/timers', list: 'GET /api/timers', cancel: 'POST /api/timers/:id/cancel',
  'operator-read': 'GET /api/sessions/:id/timers', 'operator-cancel': 'POST /api/sessions/:id/timers/:timerId/cancel',
} as const;
export type TimerDoor = keyof typeof TIMER_DOOR_MAP;
export const TIMER_DOORS = Object.keys(TIMER_DOOR_MAP) as TimerDoor[];

/** Whose a row of the operator's read is (F13): the path's session set it, or the role it is bound to holds it. */
const TIMER_OWNER_MAP = { session: 'the session the path names set it', overlord: "the Overlord's role holds it" } as const;
export type TimerOwner = keyof typeof TIMER_OWNER_MAP;
export const TIMER_OWNERS = Object.keys(TIMER_OWNER_MAP) as TimerOwner[];

/** Whether the operator's read of a session carries the role's timers (F13). */
const OVERLORD_TIMERS_READ_MAP = {
  included: 'the designation binds this session, and the role timers are listed',
  'not-this-session': 'the designation binds no session, or another one',
  unmeasured: 'the designation could not be read, so the role timers are not listed',
} as const;
export type OverlordTimersRead = keyof typeof OVERLORD_TIMERS_READ_MAP;
export const OVERLORD_TIMERS_READS = Object.keys(OVERLORD_TIMERS_READ_MAP) as OverlordTimersRead[];
