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
