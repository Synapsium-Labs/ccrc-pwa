// mood — which mood the console's character wears (L1, context C6): a pure decider over the fleet facts the PWA already
// holds. First matching rule wins; the order puts what the operator can act on first (spec §4.2: attention is a budget).
// No clock is read: `nowMs` is an argument. A reader still `null` never matches its rule, so a console that has not heard
// a reader never claims calm (Neutral, with the readers named), and never claims a thing that reader would have said.
// The accounts read is three values, not a nullable (`LanesRead`): not read yet, read with no lanes served to this reader,
// read with lanes. Only the first holds the calm moods back; the second only switches Dizzy's lane arm off.
import type { FleetSession, LaneWire, LimitWait, RestartCause, RunSummary, SessionBucket } from '../../../shared/api';
import { recentLastEnd } from '../../../shared/api';
import type { Mood } from '../../../shared/face';
import { operatorAsk } from '../fleet/rollup';
import { isRunClosed, runLastMove, workerQuietAt, workerSeenNote } from '../fleet/runWords';

/** What the console knows of `GET /api/accounts`'s `lanes`: three conditions a caller handles differently, so three values.
 *  `unread`: no answer has landed. `not-served`: an answer landed and carried no `lanes` (the route sends them to a signed-in
 *  reader only: an unarmed box or a signed-out reader never gets them). `served`: the lanes. One field, not a `heard`
 *  flag beside a nullable `lanes`, so "heard, with lanes" cannot be written down as "not heard". */
export type LanesRead =
  | { readonly kind: 'unread' }
  | { readonly kind: 'not-served' }
  | { readonly kind: 'served'; readonly lanes: Readonly<Record<string, LaneWire>> };

/** The one builder of `LanesRead`, from the store's two facts (`accountsHeard`, `lanes`). */
export function lanesRead(accountsHeard: boolean, lanes: Readonly<Record<string, LaneWire>> | null): LanesRead {
  if (!accountsHeard) return { kind: 'unread' };
  return lanes === null ? { kind: 'not-served' } : { kind: 'served', lanes };
}

export interface MoodFacts {
  /** The fleet socket. */
  readonly conn: 'connecting' | 'open' | 'down';
  /** Set by `down`, cleared only by `open`, kept through each `connecting` attempt: the link went down and is not back. */
  readonly linkLost: boolean;
  /** `agentLink(health).word === 'agent down'`: a remote fleet whose agent is not connected. False while health is null. */
  readonly agentDown: boolean;
  /** Null before the first fleet frame (`fleetFrameSeen` false). */
  readonly sessions: readonly FleetSession[] | null;
  /** Null before the first runs frame. */
  readonly runs: readonly RunSummary[] | null;
  /** The Waiting on you door's count (`useNavBadges().waitingItems`); null until its frames have landed. */
  readonly waitingItems: number | null;
  /** The accounts read's lanes: see `LanesRead`. */
  readonly lanes: LanesRead;
  readonly stallQuietMs: number | null;
  readonly nowMs: number;
}

export type MoodRule =
  | { readonly kind: 'measured'; readonly rank: number; readonly cause: string }
  | { readonly kind: 'waits'; readonly on: 'W1' | 'W3'; readonly why: string };

/** Every mood's rule, keyed by mood: a new mood is a compile error here, and a mood trimmed from `MOODS` drops its row.
 *  One rule per mood: Neutral's rule is "not heard yet" (rank 2). `cause` is the sentence the face's label adds. */
export const MOOD_RULES: Readonly<Record<Mood, MoodRule>> = {
  offline: { kind: 'measured', rank: 1, cause: 'the console has lost its link to the server' },
  neutral: { kind: 'measured', rank: 2, cause: 'not heard from the fleet yet' },
  alert: { kind: 'measured', rank: 3, cause: 'a session has a question for you' },
  crying: { kind: 'measured', rank: 4, cause: 'a session died or is stuck at a limit you did not choose to wait out' },
  angry: { kind: 'measured', rank: 5, cause: 'a swap was refused and the refusal stands' },
  sad: { kind: 'measured', rank: 6, cause: 'items wait on you' },
  dizzy: { kind: 'measured', rank: 7, cause: 'an account a session is on is rate-limited, or a session just swapped' },
  confused: { kind: 'measured', rank: 8, cause: 'a run worker has gone quiet' },
  suspicious: { kind: 'measured', rank: 9, cause: 'a review is under way' },
  happy: { kind: 'measured', rank: 10, cause: 'a pull request just merged' },
  thinking: { kind: 'measured', rank: 11, cause: 'a session is working' },
  sleeping: { kind: 'measured', rank: 12, cause: 'nothing needs anyone' },
  afraid: { kind: 'waits', on: 'W3', why: 'a mark that an act is destructive: approvals and holds reach the PWA in W3' },
  laughing: { kind: 'waits', on: 'W1', why: 'review rounds per merged pull request: W1 request records' },
};

/** Offline's other cause: the console is connected, and the server says its own link to the fleet's agent is down.
 *  `moodOf` picks between the two by the arm that matched (`consoleLinkLost`), so the label never blames the wrong link. */
export const OFFLINE_AGENT_CAUSE = 'the server has lost its link to the fleet';

/** What `moodOf` answers when no rule matches (some reader is still `null`). Not a rule, so it takes no rank. */
export const MOOD_FALLBACK: Mood = 'neutral';
export const CRY_WINDOW_MS = 3_600_000;
export const HAPPY_WINDOW_MS = 600_000;
export const DIZZY_SWAP_MS = 60_000;
export const SUSPICIOUS_WINDOW_MS = 1_800_000;
/** How long the face keeps its mood before it may change to an equal or calmer one (`shownMood`). The operator asked for
 *  this cool-down on emotion change (programme item 218: "put cool down on emotion change. Also, we can tune this later"),
 *  so the number is a starting point to tune, not a measured value: change it here and nowhere else. */
export const MOOD_COOLDOWN_MS = 60_000;
/** A stamp this far ahead of the clock is skew and counts as now; one further ahead is not trusted (no window at all),
 *  as `recentLastEnd` does for a `lastEnd` (`shared/api.ts`). */
export const FUTURE_SKEW_MS = 60_000;

/** The fallback's cause: the readers still not heard, named. Never empty. */
export function fallbackCause(f: Pick<MoodFacts, 'sessions' | 'runs' | 'waitingItems' | 'lanes'>): string {
  const missing = [
    f.sessions === null ? 'the sessions' : null,
    f.runs === null ? 'the runs' : null,
    f.waitingItems === null ? 'the waiting items' : null,
    f.lanes.kind === 'unread' ? 'the accounts' : null,
  ].filter((w): w is string => w !== null);
  return missing.length === 0 ? 'every reader is heard, and no rule matched' : `not heard yet: ${missing.join(', ')}`;
}

const consoleLinkLost = (f: MoodFacts): boolean => f.conn !== 'open' && f.linkLost;

const causeOf = (m: Mood, f: MoodFacts): string => {
  if (m === 'offline' && !consoleLinkLost(f)) return OFFLINE_AGENT_CAUSE;
  const r = MOOD_RULES[m];
  return r.kind === 'measured' ? r.cause : r.why;
};

/** Which process ends are a death the operator did not choose. A swap or a limit-reset restart is a move, not a death
 *  (Dizzy's and Crying's limit arm own them). Keyed by cause so a new `RestartCause` is a compile error until it is placed. */
const DEATH_CAUSE: Readonly<Record<RestartCause, boolean>> = {
  oom: true, 'tmux-server': true, exited: true, unknown: true,
  'swap-auto-home': false, 'swap-auto-rescue': false, 'swap-auto': false, 'swap-manual': false, 'limit-resume': false,
};

/** When a dead, unchosen session's process ended, or null: `dead` and neither asleep nor stopped on purpose, with a recent
 *  `lastEnd` of a death cause. `lastEnd` is the registry's record of the process end, read through `recentLastEnd` alone;
 *  a dead row's `bucketSince` is its live-pane stamp, which the server never sets for a row with no pane. */
const deathAt = (s: FleetSession, nowMs: number): number | null => {
  if (s.bucket !== 'dead' || s.hibernatedAt !== null || s.stoppedBy !== null) return null;
  const e = recentLastEnd(s, nowMs);
  return e !== null && DEATH_CAUSE[e.cause] ? e.at : null;
};

const swapEnd = (s: FleetSession, nowMs: number): number | null => {
  const e = recentLastEnd(s, nowMs);
  return e !== null && e.cause.startsWith('swap-') ? e.at : null;
};

/** A stamp as the windows read it: a time ahead of the clock by no more than `FUTURE_SKEW_MS` is now; one further ahead,
 *  or no time, is none. */
const stampAt = (at: number | null | undefined, nowMs: number): number | null =>
  typeof at !== 'number' || at - nowMs > FUTURE_SKEW_MS ? null : Math.min(at, nowMs);

/** The edges of every window the facts hold: the times a window closes (or a quiet threshold is crossed). */
function edges(f: MoodFacts, sessions: readonly FleetSession[]): number[] {
  const out: number[] = [];
  for (const s of sessions) {
    const diedAt = stampAt(deathAt(s, f.nowMs), f.nowMs);
    if (diedAt !== null) out.push(diedAt + CRY_WINDOW_MS);
    const swapAt = stampAt(swapEnd(s, f.nowMs), f.nowMs);
    if (swapAt !== null) out.push(swapAt + DIZZY_SWAP_MS);
    const mergedAt = stampAt(s.pr?.mergedAt, f.nowMs);
    if (mergedAt !== null) out.push(mergedAt + HAPPY_WINDOW_MS);
  }
  for (const r of f.runs ?? []) {
    if (isRunClosed(r)) continue;
    const move = runLastMove(r);
    const movedAt = stampAt(move, f.nowMs);
    if (r.state === 'awaiting-review' && movedAt !== null) out.push(movedAt + SUSPICIOUS_WINDOW_MS);
    const quietAt = workerQuietAt(r, f.stallQuietMs);
    if (quietAt !== null) out.push(quietAt);
  }
  return out.filter((t) => t > f.nowMs);
}

/** Buckets where a session is not live ("any live session" in the angry rule). */
const NOT_LIVE: ReadonlySet<SessionBucket> = new Set<SessionBucket>(['dead', 'archived', 'cleanup']);

/** A limit nobody chose to wait out (item 219: "no Crying for a wait you chose"). `LimitWait.waitingBy` says whose choice
 *  stands: `'operator'` is the operator's own "Wait until reset", which is no cause to cry; `'auto'` (ccd's own wait where no
 *  account had room) and `null` (a limit with no choice yet, `waiting: false`) are not the operator's, so they still do. */
const limitNotChosen = (s: FleetSession): boolean => {
  // The key can be ABSENT, not only null: a live frame from an older server omits it (`reviveFleetSession` reads absent as null,
  // but only the snapshot path runs it), so a row with no `limitWait` has no limit wait and must not throw here.
  const wait: LimitWait | null | undefined = s.limitWait;
  return wait !== undefined && wait !== null && wait.waitingBy !== 'operator';
};

/** The lanes a live session is on now: each session's `wrapper`, which is the lane's id on `GET /api/accounts` (the same
 *  key `LanesRead` carries). A session in a `NOT_LIVE` bucket holds no lane, and neither does one in a wait the operator
 *  chose (`waitingBy: 'operator'`, item 219 ruling: such a wait is calm, so it is no reason for Dizzy either; an `'auto'`
 *  wait or a limit with no choice yet still counts, though Crying outranks Dizzy while it stands). Nothing on the wire names a lane a session is
 *  ABOUT to use (no pending-swap field, and `limitWait.account` is the lane the session is on), so "using now" is the
 *  whole of Dizzy's lane arm (departure `dizzy-about-to-use-has-no-wire-field`). */
const lanesInUse = (sessions: readonly FleetSession[]): ReadonlySet<string> =>
  new Set(sessions.filter((s) => !NOT_LIVE.has(s.bucket) && s.limitWait?.waitingBy !== 'operator').map((s) => s.wrapper));

type Rule = (f: MoodFacts, sessions: readonly FleetSession[]) => boolean;

const within = (at: number | null | undefined, window: number, nowMs: number): boolean => {
  const t = stampAt(at, nowMs);
  return t !== null && nowMs - t < window;
};

/** The measured rules in rank order: rank n is `MEASURED[n - 1]`. */
export const MEASURED: readonly (readonly [Mood, Rule])[] = [
  ['offline', (f) => consoleLinkLost(f) || f.agentDown],
  ['neutral', (f) => f.sessions === null],
  ['alert', (_f, ss) => ss.some(operatorAsk)],
  ['crying', (f, ss) => ss.some((s) => within(deathAt(s, f.nowMs), CRY_WINDOW_MS, f.nowMs) || limitNotChosen(s))],
  ['angry', (_f, ss) => ss.some((s) => !NOT_LIVE.has(s.bucket) && s.swapBlocked !== null)],
  ['sad', (f) => f.waitingItems !== null && f.waitingItems > 0],
  ['dizzy', (f, ss) =>
    (f.lanes.kind === 'served' && Object.entries(f.lanes.lanes).some(([id, l]) => l.state.word === 'rate-limited' && lanesInUse(ss).has(id)))
    || ss.some((s) => { const at = swapEnd(s, f.nowMs); return at !== null && within(at, DIZZY_SWAP_MS, f.nowMs); })],
  ['confused', (f) => (f.runs ?? []).some((r) => !isRunClosed(r) && workerSeenNote(r, f.nowMs, f.stallQuietMs)?.quiet === true)],
  ['suspicious', (f) => (f.runs ?? []).some((r) => {
    const move = runLastMove(r);
    return !isRunClosed(r) && r.state === 'awaiting-review' && within(move, SUSPICIOUS_WINDOW_MS, f.nowMs);
  })],
  ['happy', (f, ss) => f.runs !== null && f.waitingItems !== null && f.lanes.kind !== 'unread'
    && ss.some((s) => within(s.pr?.mergedAt, HAPPY_WINDOW_MS, f.nowMs))],
  ['thinking', (_f, ss) => ss.some((s) => s.bucket === 'working')],
  ['sleeping', (f, ss) => f.runs !== null && f.waitingItems !== null && f.lanes.kind !== 'unread'
    && !ss.some((s) => s.bucket === 'working' || operatorAsk(s))],
];

/** The mood, why, and the next time a window can change it (null: none). */
export function moodOf(f: MoodFacts): { readonly mood: Mood; readonly cause: string; readonly next: number | null } {
  const sessions = f.sessions ?? [];
  const nextEdge = edges(f, sessions).reduce<number | null>((a, t) => (a === null || t < a ? t : a), null);
  for (const [mood, matches] of MEASURED) {
    if (matches(f, sessions)) return { mood, cause: causeOf(mood, f), next: nextEdge };
  }
  return { mood: MOOD_FALLBACK, cause: fallbackCause(f), next: nextEdge };
}

/** How urgent a mood is: its rank (1 most urgent). A mood with no measured rule (`afraid`, `laughing`) is the least urgent,
 *  so a change to it waits like any calming change; `moodOf` never answers one today. */
export const moodRank = (m: Mood): number => {
  const r = MOOD_RULES[m];
  return r.kind === 'measured' ? r.rank : Number.POSITIVE_INFINITY;
};

/** The mood the face shows, with the instant it last changed. */
export interface ShownMood {
  readonly mood: Mood;
  readonly cause: string;
  /** When the face last changed its mood (the first mood: when it was first shown). */
  readonly since: number;
}

/** What the face shows now, given what it showed and what `moodOf` decided: a cool-down on mood change (item 218).
 *  A change to a MORE urgent mood (a lower rank, Offline included) shows at once, so the face never hides something urgent
 *  to keep its cool. A change to an equal or less urgent mood shows only once `MOOD_COOLDOWN_MS` has passed since the last
 *  change; until then the face keeps its mood and its cause, and `holdUntil` says when to look again (null: nothing is
 *  held). When the cool-down ends the face shows what `moodOf` decides then, never a queue of the changes it missed, and a
 *  decision back to the mood on show (A, B, A) changes nothing. The same mood with a new cause shows the new cause.
 *  One exception to the hold, which the ruling did not name: leaving Neutral (`MOOD_FALLBACK`, "not heard yet") shows at once.
 *  Neutral is no emotion to cool down from but the start-up reading, and holding it would make the face say "not heard
 *  yet" for a minute after every reader had answered (recorded in the face plan's departures as `neutral-leaves-at-once`).
 *  `nowMs` is an argument: no clock is read. */
export function shownMood(
  previous: ShownMood | null,
  decided: { readonly mood: Mood; readonly cause: string },
  nowMs: number,
): ShownMood & { readonly holdUntil: number | null } {
  if (previous === null) return { ...decided, since: nowMs, holdUntil: null };
  if (decided.mood === previous.mood) return { mood: previous.mood, cause: decided.cause, since: previous.since, holdUntil: null };
  const escalates = moodRank(decided.mood) < moodRank(previous.mood);
  const endsAt = previous.since + MOOD_COOLDOWN_MS;
  if (escalates || previous.mood === MOOD_FALLBACK || nowMs >= endsAt) return { ...decided, since: nowMs, holdUntil: null };
  return { ...previous, holdUntil: endsAt };
}
