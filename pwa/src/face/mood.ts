// mood — which mood the console's character wears (L1, context C6): a pure decider over the fleet facts the PWA already
// holds. First matching rule wins; the order puts what the operator can act on first (spec §4.2: attention is a budget).
// No clock is read: `nowMs` is an argument. A reader still `null` never matches its rule, so a console that has not heard
// a reader never claims calm (Neutral, with the readers named), and never claims a thing that reader would have said.
import type { FleetSession, LaneWire, RunSummary, SessionBucket } from '../../../shared/api';
import { recentLastEnd } from '../../../shared/api';
import type { Mood } from '../../../shared/face';
import { operatorAsk } from '../fleet/rollup';
import { isRunClosed, runLastMove, workerQuietAt, workerSeenNote } from '../fleet/runWords';

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
  /** Null before the first accounts read. */
  readonly lanes: Readonly<Record<string, LaneWire>> | null;
  readonly stallQuietMs: number | null;
  readonly nowMs: number;
}

export type MoodRule =
  | { readonly kind: 'measured'; readonly rank: number; readonly cause: string }
  | { readonly kind: 'waits'; readonly on: 'W1' | 'W3'; readonly why: string };

/** Every mood's rule, keyed by mood: a new mood is a compile error here, and a mood trimmed from `MOODS` drops its row.
 *  One rule per mood: Neutral's rule is "not heard yet" (rank 2). `cause` is the sentence the face's label adds. */
export const MOOD_RULES: Readonly<Record<Mood, MoodRule>> = {
  offline: { kind: 'measured', rank: 1, cause: 'the console has lost its link to the fleet' },
  neutral: { kind: 'measured', rank: 2, cause: 'not heard from the fleet yet' },
  alert: { kind: 'measured', rank: 3, cause: 'a session has a question for you' },
  crying: { kind: 'measured', rank: 4, cause: 'a session died or is waiting out a limit' },
  angry: { kind: 'measured', rank: 5, cause: 'a swap was refused and the refusal stands' },
  sad: { kind: 'measured', rank: 6, cause: 'items wait on you' },
  dizzy: { kind: 'measured', rank: 7, cause: 'an account is rate-limited or a session just swapped' },
  confused: { kind: 'measured', rank: 8, cause: 'a run worker has gone quiet' },
  suspicious: { kind: 'measured', rank: 9, cause: 'a review is under way' },
  happy: { kind: 'measured', rank: 10, cause: 'a pull request just merged' },
  thinking: { kind: 'measured', rank: 11, cause: 'a session is working' },
  sleeping: { kind: 'measured', rank: 12, cause: 'nothing needs anyone' },
  afraid: { kind: 'waits', on: 'W3', why: 'a mark that an act is destructive: approvals and holds reach the PWA in W3' },
  laughing: { kind: 'waits', on: 'W1', why: 'review rounds per merged pull request: W1 request records' },
};

/** What `moodOf` answers when no rule matches (some reader is still `null`). Not a rule, so it takes no rank. */
export const MOOD_FALLBACK: Mood = 'neutral';
export const CRY_WINDOW_MS = 3_600_000;
export const HAPPY_WINDOW_MS = 600_000;
export const DIZZY_SWAP_MS = 60_000;
export const SUSPICIOUS_WINDOW_MS = 1_800_000;

/** The fallback's cause: the readers still not heard, named. Never empty. */
export function fallbackCause(f: Pick<MoodFacts, 'sessions' | 'runs' | 'waitingItems' | 'lanes'>): string {
  const missing = [
    f.sessions === null ? 'the sessions' : null,
    f.runs === null ? 'the runs' : null,
    f.waitingItems === null ? 'the waiting items' : null,
    f.lanes === null ? 'the lanes' : null,
  ].filter((w): w is string => w !== null);
  return missing.length === 0 ? 'every reader is heard, and no rule matched' : `not heard yet: ${missing.join(', ')}`;
}

const causeOf = (m: Mood): string => {
  const r = MOOD_RULES[m];
  return r.kind === 'measured' ? r.cause : r.why;
};

/** A session's death the operator did not choose and that is recent: `dead`, neither asleep nor stopped on purpose. */
const cryDeath = (s: FleetSession): boolean =>
  s.bucket === 'dead' && s.hibernatedAt === null && s.stoppedBy === null && s.bucketSince !== null;

const swapEnd = (s: FleetSession, nowMs: number): number | null => {
  const e = recentLastEnd(s, nowMs);
  return e !== null && e.cause.startsWith('swap-') ? e.at : null;
};

/** The edges of every window the facts hold: the times a window closes (or a quiet threshold is crossed). */
function edges(f: MoodFacts, sessions: readonly FleetSession[]): number[] {
  const out: number[] = [];
  for (const s of sessions) {
    if (cryDeath(s)) out.push(s.bucketSince! + CRY_WINDOW_MS);
    const swapAt = swapEnd(s, f.nowMs);
    if (swapAt !== null) out.push(swapAt + DIZZY_SWAP_MS);
    if (s.pr?.mergedAt != null) out.push(s.pr.mergedAt + HAPPY_WINDOW_MS);
  }
  for (const r of f.runs ?? []) {
    if (isRunClosed(r)) continue;
    const move = runLastMove(r);
    if (r.state === 'awaiting-review' && move !== null) out.push(move + SUSPICIOUS_WINDOW_MS);
    const quietAt = workerQuietAt(r, f.stallQuietMs);
    if (quietAt !== null) out.push(quietAt);
  }
  return out.filter((t) => t > f.nowMs);
}

/** Buckets where a session is not live ("any live session" in the angry rule). */
const NOT_LIVE: ReadonlySet<SessionBucket> = new Set<SessionBucket>(['dead', 'archived', 'cleanup']);

type Rule = (f: MoodFacts, sessions: readonly FleetSession[]) => boolean;

const within = (at: number | null | undefined, window: number, nowMs: number): boolean =>
  typeof at === 'number' && nowMs - at < window;

/** The measured rules in rank order: rank n is `MEASURED[n - 1]`. */
export const MEASURED: readonly (readonly [Mood, Rule])[] = [
  ['offline', (f) => (f.conn !== 'open' && f.linkLost) || f.agentDown],
  ['neutral', (f) => f.sessions === null],
  ['alert', (_f, ss) => ss.some(operatorAsk)],
  ['crying', (f, ss) => ss.some((s) => (cryDeath(s) && within(s.bucketSince, CRY_WINDOW_MS, f.nowMs)) || s.limitWait !== null)],
  ['angry', (_f, ss) => ss.some((s) => !NOT_LIVE.has(s.bucket) && s.swapBlocked !== null)],
  ['sad', (f) => f.waitingItems !== null && f.waitingItems > 0],
  ['dizzy', (f, ss) =>
    (f.lanes !== null && Object.values(f.lanes).some((l) => l.state.word === 'rate-limited'))
    || ss.some((s) => { const at = swapEnd(s, f.nowMs); return at !== null && within(at, DIZZY_SWAP_MS, f.nowMs); })],
  ['confused', (f) => (f.runs ?? []).some((r) => !isRunClosed(r) && workerSeenNote(r, f.nowMs, f.stallQuietMs)?.quiet === true)],
  ['suspicious', (f) => (f.runs ?? []).some((r) => {
    const move = runLastMove(r);
    return !isRunClosed(r) && r.state === 'awaiting-review' && within(move, SUSPICIOUS_WINDOW_MS, f.nowMs);
  })],
  ['happy', (f, ss) => f.runs !== null && f.waitingItems !== null && f.lanes !== null
    && ss.some((s) => within(s.pr?.mergedAt, HAPPY_WINDOW_MS, f.nowMs))],
  ['thinking', (_f, ss) => ss.some((s) => s.bucket === 'working')],
  ['sleeping', (f, ss) => f.runs !== null && f.waitingItems !== null && f.lanes !== null
    && !ss.some((s) => s.bucket === 'working' || operatorAsk(s))],
];

/** The mood, why, and the next time a window can change it (null: none). */
export function moodOf(f: MoodFacts): { readonly mood: Mood; readonly cause: string; readonly next: number | null } {
  const sessions = f.sessions ?? [];
  const nextEdge = edges(f, sessions).reduce<number | null>((a, t) => (a === null || t < a ? t : a), null);
  for (const [mood, matches] of MEASURED) {
    if (matches(f, sessions)) return { mood, cause: causeOf(mood), next: nextEdge };
  }
  return { mood: MOOD_FALLBACK, cause: fallbackCause(f), next: nextEdge };
}
