// The Stuck band's words (D-8074; spec 2026-11-04 §7, §8.2.1, A35 to A39, A43, A47, A54). Pure (L1): the heads' fixed order,
// the age and time-left forms, the row line, the row's one marker and the held-back line. Every reader takes the one page
// clock, so nothing here reads the network or the time itself.
import type { RunStuck, RunSummary, StuckCause, StuckReason } from '../../../shared/api';

/** The heads' reading order (check 14). Not §7's matching order, which only decides which reason a run gets. */
export const STUCK_HEAD_ORDER: readonly StuckReason[] = [
  'review-of-closed', 'overtaken', 'owner-gone', 'start-never-landed', 'never-started',
];

/** Each reason's heading. */
export const STUCK_HEADING: Readonly<Record<StuckReason, string>> = {
  'review-of-closed': 'Review of finished work',
  'overtaken': 'Overtaken by later waves',
  'owner-gone': 'Owner gone',
  'start-never-landed': 'Start never finished',
  'never-started': 'Never started',
};

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

/** How long ago a reason began, in the words a head and a row share (A39): whole days, rounded down; under a day, hours;
 *  under an hour, minutes. One function, so a head never shows an age none of its rows can show. */
export function stuckAge(since: number, nowMs: number): string {
  const ms = Math.max(0, nowMs - since);
  const days = Math.floor(ms / DAY);
  if (days >= 1) return days === 1 ? '1 day' : `${days} days`;
  const hours = Math.floor(ms / H);
  if (hours >= 1) return `${hours} h`;
  return `${Math.max(1, Math.floor(ms / MIN))} min`;
}

/** Time left on a close clock (A36): minutes under an hour, whole hours up to 48, days from there, always rounded up so it
 *  never says "in 0". Null at zero or past: the caller words that moment. */
export function closeWhen(at: number, nowMs: number): string | null {
  const ms = at - nowMs;
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / MIN);
  if (minutes < 60) return `in ${minutes} min`;
  if (ms <= 48 * H) return `in ${Math.ceil(ms / H)} h`;
  return `in ${Math.ceil(ms / DAY)} days`;
}

/** What happens next to a stuck run (A35, A36), from `stuck.closes`. Shadow reads "would close"; a clock at zero or past
 *  reads "soon" when armed and "now" in shadow. */
export function stuckNext(closes: RunStuck['closes'], nowMs: number): string {
  if (closes === null) return 'Nothing closes this on its own';
  const when = closeWhen(closes.at, nowMs);
  if (closes.armed) return when === null ? 'ccrc closes this soon' : `ccrc closes this ${when}`;
  return when === null ? 'ccrc would close this now' : `ccrc would close this ${when}`;
}

/** The line each cause says (§7, A54). A `Record`, so a cause with no line does not compile. */
const CAUSE_LINE: Readonly<Record<StuckCause, (age: string) => string>> = {
  'coordinator-archived': (a) => `Coordinator archived ${a} ago`,
  'coordinator-forgotten': (a) => `Coordinator forgotten ${a} ago`,
  'coordinator-removed': (a) => `Coordinator removed ${a} ago`,
  'coordinator-stopped': (a) => `Coordinator stopped ${a} ago. Nothing has moved since`,
  'coordinator-gone': (a) => `Coordinator gone ${a} ago. Nothing has moved since`,
  'worker-stopped': (a) => `Worker stopped ${a} ago. Nothing has moved since`,
  'worker-gone': (a) => `Worker gone ${a} ago. Nothing has moved since`,
  'name-reused': (a) => `Its session moved to a later run ${a} ago`,
  'target-closed': (a) => `The work it reviews closed ${a} ago`,
  'later-review': (a) => `A later review moved on ${a} ago`,
};

/** The line of a reason that names no cause (§7's table). `owner-gone` and `review-of-closed` always carry one; their entry
 *  only keeps an unexpected null readable. */
const REASON_LINE: Readonly<Record<StuckReason, (age: string) => string>> = {
  'overtaken': (a) => `A later wave moved on ${a} ago`,
  'never-started': (a) => `Opened ${a} ago and never started`,
  'start-never-landed': (a) => `Started ${a} ago and never landed`,
  'owner-gone': (a) => `Owner gone ${a} ago`,
  'review-of-closed': (a) => `Nothing left to review since ${a} ago`,
};

/** A stuck row's context line: the reason's line, then what happens next. Empty for a run with no verdict. */
export function stuckLine(run: Pick<RunSummary, 'stuck'>, nowMs: number): string {
  const s = run.stuck;
  if (s === undefined || s === null) return '';
  const age = stuckAge(s.since, nowMs);
  const cause = s.cause === null ? REASON_LINE[s.reason](age) : CAUSE_LINE[s.cause](age);
  return `${cause} · ${stuckNext(s.closes, nowMs)}`;
}

/** The run holds a session or a workspace, so it goes one at a time, never in a bulk act (A13). */
export const heldBack = (run: Pick<RunSummary, 'sessionId' | 'workspace'>): boolean =>
  typeof run.workspace === 'string' || typeof run.sessionId === 'string';

/** A row's one marker, in this order (A43): "needs you", "holds a workspace", "holds a session" (check 6). `needsYou` comes
 *  from the one needs-you source; stuck alone never sets it (D-6170). */
export function runMarker(
  run: Pick<RunSummary, 'sessionId' | 'workspace'>, needsYou: boolean,
): 'needs you' | 'holds a workspace' | 'holds a session' | null {
  if (needsYou) return 'needs you';
  if (typeof run.workspace === 'string') return 'holds a workspace';
  if (typeof run.sessionId === 'string') return 'holds a session';
  return null;
}

/** The held-back line (check 15). */
export const heldBackLine = (n: number): string =>
  `${n} ${n === 1 ? 'holds' : 'hold'} a workspace or session: one at a time`;

/** The head's group control (§9.2, o1): "Abandon all N…" from three up when every run is free, "Abandon N…" otherwise; null
 *  with none free. `free` counts the runs that may go in bulk, `total` every run in the head. */
export function groupControlWords(free: number, total: number): string | null {
  if (free <= 0) return null;
  return free === total && free >= 3 ? `Abandon all ${free}…` : `Abandon ${free}…`;
}

/** The largest age in a group, in whole days (rounded down). */
export function oldestDays(runs: readonly Pick<RunSummary, 'stuck'>[], nowMs: number): number {
  let since = Infinity;
  for (const r of runs) if (r.stuck != null && r.stuck.since < since) since = r.stuck.since;
  return since === Infinity ? 0 : Math.floor(Math.max(0, nowMs - since) / DAY);
}

/** A head's "oldest" in the words its rows use, or null for an empty group. */
export function oldestAge(runs: readonly Pick<RunSummary, 'stuck'>[], nowMs: number): string | null {
  let since = Infinity;
  for (const r of runs) if (r.stuck != null && r.stuck.since < since) since = r.stuck.since;
  return since === Infinity ? null : stuckAge(since, nowMs);
}
