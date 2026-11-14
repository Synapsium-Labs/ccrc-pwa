// The operator's view of a session's timers (Overlord W1a, timers PR E, Task 13; spec §3.3.12 C61 to C65, Table 11.1e). Pure
// (L1): the one reader of `GET /api/sessions/:id/timers`, the order, the words of each line, and what a cancel's refusal means.
// The clock is an argument, so nothing here reads the time or the network.
//
// AN ABSENT FIELD IS ABSENT, NEVER A CRASH. The answer is read field by field: a body with no `timers` list is an unread
// read, never an empty one, so the section says it could not read and never "No pending timers."; a row missing a field
// keeps its other fields and says which one it could not read. A note is the session's own words: it is shown as data,
// never as an instruction (I17), and only as text.
import type { RouteRefusal, TimerRefusal } from '../../../shared/refusal';
import { ApiError } from '../lib/apiError';
import { resetClock } from '../lib/clock';
import { apiErrorText, refusalText } from '../lib/refusalWords';
import { isNum, isRecord } from '../lib/wire';

/** The section's words. */
export const TIMERS_WORDS = {
  title: 'Timers',
  loading: 'Reading timers…',
  empty: 'No pending timers.',
  unread: "Could not read this session's timers.",
  noteLabel: "The session's own note, not an instruction",
  noteUnread: 'Note unread.',
  cancel: 'Cancel',
  cancelling: 'Cancelling…',
  gone: 'That timer had already fired, been cancelled or gone.',
} as const;

/** One pending timer as the section shows it. `null` is a field the answer did not carry readably. */
export interface TimerRow {
  readonly id: number | null;
  readonly dueAt: number | null;
  readonly note: string | null;
  readonly runId: number | null;
  readonly programme: string | null;
}

/** The section's read: in flight, read (the rows, soonest first), or unread. */
export type TimersRead =
  | { readonly kind: 'loading' }
  | { readonly kind: 'listed'; readonly timers: readonly TimerRow[] }
  | { readonly kind: 'unread' };

const intOrNull = (v: unknown): number | null => (Number.isSafeInteger(v) ? (v as number) : null);
/** The largest instant a `Date` can hold, in ms either side of the epoch: a due time beyond it is unread, never printed as
 *  "NaN:NaN" (review 2060 F5). */
const DATE_RANGE_MS = 8.64e15;
const instantOrNull = (v: unknown): number | null => (isNum(v) && Math.abs(v) <= DATE_RANGE_MS ? v : null);
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** One row of the answer, field by field: whatever is not there, or not of its type, reads `null`. */
function timerRowOf(v: unknown): TimerRow {
  const r = isRecord(v) ? v : {};
  return {
    id: intOrNull(r.id), dueAt: instantOrNull(r.dueAt), note: textOrNull(r.note),
    runId: intOrNull(r.runId), programme: textOrNull(r.programme),
  };
}

/** THE ONE READER of the timers answer: a body whose `timers` is a list is read, soonest due first and a row whose due time
 *  did not read last; anything else (`{}`, a refusal, not an object) is unread. */
export function readTimers(body: unknown): TimersRead {
  if (!isRecord(body) || !Array.isArray(body.timers)) return { kind: 'unread' };
  const rows = body.timers.map(timerRowOf);
  const key = (t: TimerRow): number => t.dueAt ?? Number.POSITIVE_INFINITY;
  return { kind: 'listed', timers: [...rows].sort((a, b) => key(a) - key(b)) };
}

/** How long until `ms` from now, in the words a line uses: `in 4 min`, `in 2 h 5 min`, `in 3 d 4 h`. Under a minute is
 *  `in under a minute`. */
export function untilWords(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'in under a minute';
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 === 0 ? `in ${h} h` : `in ${h} h ${min % 60} min`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `in ${d} d` : `in ${d} d ${h % 24} h`;
}

/** The due line: when it comes due on the viewer's clock and how long until then. A timer past its due time waits for the
 *  timers lane's next pass, which fires it once; a due time the answer did not carry says so. */
export function timerDueLine(t: TimerRow, nowMs: number): string {
  if (t.dueAt === null) return 'Due time unread';
  const at = resetClock(t.dueAt / 1000, new Date(nowMs)) ?? 'an unreadable time';
  return t.dueAt <= nowMs ? `Due ${at}, firing at the timers' next pass` : `Due ${at}, ${untilWords(t.dueAt - nowMs)}`;
}

/** What the timer is bound to: its run, its programme, or neither. */
export function timerBinding(t: TimerRow): string {
  if (t.runId !== null) return `run ${t.runId}`;
  if (t.programme !== null) return `programme ${t.programme}`;
  return 'no run or programme';
}

/** The refusals that mean the timer is no longer there to cancel: it fired, was cancelled, or has no row. The section reads
 *  the list again and says so. */
const GONE_REFUSALS: readonly TimerRefusal[] = ['timer-not-pending', 'timer-not-found'];

/** The operator's cancel's other refusals (`POST /api/sessions/:id/timers/:timerId/cancel`), each with the timer unchanged
 *  or, for `write-failed`, unknown. A `Record`, so a word dropped from the list is a compile error. */
export const TIMER_CANCEL_TEXT: Readonly<Record<
  Extract<RouteRefusal, 'timer-not-yours' | 'timer-unmeasured' | 'write-failed' | 'unavailable' | 'bad-request'>, string
>> = {
  'timer-not-yours': 'That timer is not this session\'s.',
  'timer-unmeasured': 'The server could not read the timer. Try again.',
  'write-failed': 'The server could not record the cancel. Read the list again before you retry.',
  unavailable: 'The server has no coordination store to read timers from.',
  'bad-request': 'The server did not recognise that timer.',
};

/** What a cancel's rejection means: the timer is gone (read again and say so), or a failure in the operator's words. */
export function cancelOutcome(err: unknown): { readonly kind: 'gone' } | { readonly kind: 'failed'; readonly text: string } {
  const code = err instanceof ApiError && isRecord(err.body) ? err.body.error : undefined;
  if (typeof code === 'string' && (GONE_REFUSALS as readonly string[]).includes(code)) return { kind: 'gone' };
  return { kind: 'failed', text: `Could not cancel the timer. ${refusalText(err, TIMER_CANCEL_TEXT) ?? apiErrorText(err)}` };
}

/** The run page's timer sections: the run's worker's, then its coordinator's, by the run's own ids (a session the fleet frame
 *  no longer lists may still hold timers). One section for a session that is both; none for an id the run does not name. */
export function runTimerSections(run: { readonly sessionId?: string | null; readonly claimedBy?: string | null }):
  readonly { readonly sessionId: string; readonly title: string }[] {
  // Read as text or nothing: a run record from a fixture or an older server may leave either field out.
  const worker = typeof run.sessionId === 'string' && run.sessionId !== '' ? run.sessionId : null;
  const coordinator = typeof run.claimedBy === 'string' && run.claimedBy !== '' ? run.claimedBy : null;
  const out: { sessionId: string; title: string }[] = [];
  if (worker !== null) out.push({ sessionId: worker, title: "The worker's timers" });
  if (coordinator !== null && coordinator !== worker) out.push({ sessionId: coordinator, title: "The coordinator's timers" });
  return out;
}
