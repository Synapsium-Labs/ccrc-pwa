// The Overlord face's three deciders: their oracle cases and mutant sets (the face plan, Task F). Each decider is a pure
// L1 function in the PWA (`pwa/src/face/{mood,splash,badgeAct}.ts`); its cases are restated here, over a loaded module,
// so `mutation-floors.test.ts` can run them against each textual mutant (every-run floors). The pwa suites pin the same
// behaviour against the real module; the duplication is the point, the server runner needs a suite it can hand a copy.
// The sets load the pwa deciders by path at runtime, so vitest's import graph does not tie them to
// `mutation-floors.test.ts`: a pull request that changes only a face decider runs no floor on its fast run, and the merge
// queue's full run does.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { sessionBucket, type FleetSession, type LaneWire, type LimitWait, type RunSummary } from '../../../shared/api.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The loaded modules' shapes, written here and only as far as the suite uses them: a type edge into `pwa/` would pull
// pwa sources into the server's node16 resolution (TS2835), and `modulePath` below is a runtime load, not a type edge.
type LanesRead = { kind: 'unread' } | { kind: 'not-served' } | { kind: 'served'; lanes: Readonly<Record<string, LaneWire>> };
interface MoodFacts {
  conn: 'connecting' | 'open' | 'down'; linkLost: boolean; agentDown: boolean;
  sessions: readonly FleetSession[] | null; runs: readonly RunSummary[] | null; waitingItems: number | null;
  lanes: LanesRead; stallQuietMs: number | null; nowMs: number;
}
interface ShownMood { mood: string; cause: string; since: number }
interface MoodModule {
  moodOf(f: MoodFacts): { mood: string; cause: string; next: number | null };
  fallbackCause(f: Pick<MoodFacts, 'sessions' | 'runs' | 'waitingItems' | 'lanes'>): string;
  shownMood(previous: ShownMood | null, decided: { mood: string; cause: string }, nowMs: number): ShownMood & { holdUntil: number | null };
  moodRank(m: string): number; MOOD_COOLDOWN_MS: number;
  OFFLINE_AGENT_CAUSE: string; FUTURE_SKEW_MS: number;
  CRY_WINDOW_MS: number; HAPPY_WINDOW_MS: number; DIZZY_SWAP_MS: number; SUSPICIOUS_WINDOW_MS: number; MOOD_FALLBACK: string;
}
interface SplashFacts { standalone: boolean; sinceMs: number; frameSeen: boolean; reducedMotion: boolean }
interface SplashModule { splashShows(f: SplashFacts): boolean; SPLASH_TYPE_MS: number; SPLASH_MAX_MS: number }
interface BadgeModule { badgeAct(count: number | null, last: number | null): { kind: string; n?: number } }

/** A session row with only the fields the mood rules read; the rest of the wire type is cast over. */
const fleetSession = (over: Partial<Record<keyof FleetSession, unknown>> = {}): FleetSession => ({
  id: 'lane-a-x', project: 'project-a', status: 'idle', bucket: 'idle', bucketSince: null, hibernatedAt: null, stoppedBy: null,
  swapBlocked: null, limitWait: null, lastEnd: null, pr: null, stranded: null, ...over,
}) as unknown as FleetSession;
/** A run row with only the fields the mood rules read. */
const runRow = (over: Partial<Record<keyof RunSummary, unknown>> & { id: number; program: string }): RunSummary =>
  ({ state: 'working', kind: 'work', wave: 1, waveOf: 3, closedAt: null, sessionId: null, claimedBy: null, programTitle: null, ...over }) as unknown as RunSummary;

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SERVED: LanesRead = { kind: 'served', lanes: {} };
const UNREAD: LanesRead = { kind: 'unread' };
const NOT_SERVED: LanesRead = { kind: 'not-served' };
const serving = (lanes: Record<string, LaneWire>): LanesRead => ({ kind: 'served', lanes });
/** A row the server files for a gone pane: `sessionBucket`'s own answer for `status: 'dead'` with no stamp (`assembleFleet`
 *  sets `statusUpdatedAt` only in the live-pane arm), so its `bucketSince` is what the ladder yields, never a death time. */
const deadRow = (over: Partial<Record<keyof FleetSession, unknown>> = {}): Partial<Record<keyof FleetSession, unknown>> => ({
  ...sessionBucket({ status: 'dead', statusUpdatedAt: null, dialogPending: false, hookState: null, archivedAt: null, pr: null, background: null }, null),
  status: 'dead', statusUpdatedAt: null, ...over,
});
const endedAgo = (ago: number, cause = 'exited') => ({ at: NOW - ago, cause });
const idle = (n: string) => fleetSession({ id: `lane-a-${n}`, wrapper: 'lane-a', bucket: 'idle' });
const base = (over: Partial<MoodFacts> = {}): MoodFacts => ({
  conn: 'open', linkLost: false, agentDown: false,
  sessions: [idle('1'), idle('2'), idle('3')], runs: [], waitingItems: 0, lanes: SERVED, stallQuietMs: 600_000, nowMs: NOW,
  ...over,
});
const withSession = (s: Parameters<typeof fleetSession>[0], over: Partial<MoodFacts> = {}) =>
  base({ sessions: [...base().sessions!, fleetSession({ id: 'project-a-x', ...s })], ...over });
const merged = (ago: number) => ({ pr: { mergedAt: NOW - ago } as never });
/** A `limitWait` as the wire carries it (D-8123, D-8173). */
const limitWait = (waitingBy: LimitWait['waitingBy'], over: Partial<LimitWait> = {}): LimitWait =>
  ({ since: NOW - MIN, reset: NOW + 30 * MIN, account: 'lane-a', waiting: waitingBy !== null, waitingBy, ...over });
const rateLimited = { state: { word: 'rate-limited', source: 'x' } } as unknown as LaneWire;
const review = (movedAgo: number) => runRow({ id: 1, program: 'project-a', state: 'awaiting-review', lastMoveAt: NOW - movedAgo });

export function moodCases(m: MoodModule): Record<string, SuiteCase> {
  const mood = (f: MoodFacts) => m.moodOf(f).mood;
  return {
    'a calm fleet is Sleeping': () => { expect(mood(base())).toBe('sleeping'); },
    'no fleet frame yet is Neutral, never Sleeping': () => { expect(mood(base({ sessions: null }))).toBe('neutral'); },
    'each null reader turns a calm mood into Neutral': () => {
      for (const over of [{ runs: null }, { waitingItems: null }, { lanes: UNREAD }] as Partial<MoodFacts>[]) {
        expect(mood(base(over))).toBe('neutral');
        expect(mood(withSession(merged(MIN), over))).toBe('neutral');
      }
      expect(mood(withSession(merged(MIN)))).toBe('happy');
    },
    'a null reader does not hide a measured rule': () => { expect(mood(withSession({ bucket: 'attention' }, { lanes: UNREAD }))).toBe('alert'); },
    'lanes not served to this reader do not hold the calm moods back': () => {
      expect(mood(base({ lanes: NOT_SERVED }))).toBe('sleeping');
      expect(mood(withSession(merged(MIN), { lanes: NOT_SERVED }))).toBe('happy');
    },
    'lanes not served switch only the lane arm of Dizzy off': () => {
      expect(mood(base({ lanes: NOT_SERVED }))).not.toBe('dizzy');
      expect(mood(withSession({ lastEnd: { at: NOW - 10_000, cause: 'swap-manual' } }, { lanes: NOT_SERVED }))).toBe('dizzy');
    },
    'Offline names the link that is down': () => {
      expect(m.moodOf(base({ conn: 'down', linkLost: true })).cause).toContain('console');
      expect(m.moodOf(base({ agentDown: true })).cause).toBe(m.OFFLINE_AGENT_CAUSE);
      expect(m.moodOf(base({ conn: 'down', linkLost: true, agentDown: true })).cause).toContain('console');
    },
    'the first connect is not Offline': () => { expect(mood(base({ conn: 'connecting', linkLost: false }))).not.toBe('offline'); },
    'a down socket is Offline': () => { expect(mood(base({ conn: 'down', linkLost: true }))).toBe('offline'); },
    'a reconnect during an outage stays Offline': () => { expect(mood(base({ conn: 'connecting', linkLost: true }))).toBe('offline'); },
    'an open link with a stale linkLost is not Offline': () => { expect(mood(base({ conn: 'open', linkLost: true }))).not.toBe('offline'); },
    'a remote fleet whose agent is down is Offline': () => { expect(mood(base({ agentDown: true }))).toBe('offline'); },
    'a session with a question is Alert': () => { expect(mood(withSession({ bucket: 'attention' }))).toBe('alert'); },
    'a recent unchosen death is Crying, dated from lastEnd': () => { expect(mood(withSession(deadRow({ lastEnd: endedAgo(10 * MIN) })))).toBe('crying'); },
    'a swap or a limit restart is no death': () => {
      for (const cause of ['swap-auto-home', 'swap-auto-rescue', 'swap-auto', 'swap-manual', 'limit-resume']) {
        expect(mood(withSession(deadRow({ lastEnd: endedAgo(MIN, cause) })))).not.toBe('crying');
      }
      for (const cause of ['oom', 'tmux-server', 'exited', 'unknown']) expect(mood(withSession(deadRow({ lastEnd: endedAgo(MIN, cause) })))).toBe('crying');
    },
    'a limit wait nobody chose is Crying: ccd waiting by itself, or no choice yet': () => {
      expect(mood(withSession({ limitWait: limitWait('auto') }))).toBe('crying');
      expect(mood(withSession({ limitWait: limitWait(null, { waiting: false }) }))).toBe('crying');
    },
    'a limit wait the operator chose is not Crying': () => {
      expect(mood(withSession({ limitWait: limitWait('operator') }))).not.toBe('crying');
      expect(mood(withSession({ limitWait: limitWait('operator', { reset: null }) }))).not.toBe('crying');
    },
    "one session's chosen wait does not hide another's limit nobody chose": () => {
      const f = base({ sessions: [...base().sessions!, fleetSession({ id: 'project-a-x', limitWait: limitWait('operator') }),
        fleetSession({ id: 'project-a-y', limitWait: limitWait('auto') })] });
      expect(mood(f)).toBe('crying');
    },
    'a hibernated or stopped session does not cry': () => {
      expect(mood(withSession(deadRow({ lastEnd: endedAgo(MIN), hibernatedAt: NOW - MIN })))).not.toBe('crying');
      expect(mood(withSession(deadRow({ lastEnd: endedAgo(MIN), stoppedBy: { at: NOW, surface: 'pwa' } as never })))).not.toBe('crying');
    },
    'a death with no recorded end does not cry': () => { expect(mood(withSession(deadRow({ lastEnd: null })))).not.toBe('crying'); },
    'a live session with a recent process end does not cry': () => {
      expect(mood(withSession({ bucket: 'working', lastEnd: endedAgo(MIN) }))).not.toBe('crying');
    },
    'a death older than the window does not cry': () => {
      expect(mood(withSession(deadRow({ lastEnd: endedAgo(m.CRY_WINDOW_MS) })))).not.toBe('crying');
      expect(mood(withSession(deadRow({ lastEnd: endedAgo(m.CRY_WINDOW_MS - 1) })))).toBe('crying');
    },
    'a standing swap refusal is Angry': () => {
      expect(mood(withSession({ bucket: 'working', swapBlocked: { at: NOW, reason: 'x' } }))).toBe('angry');
    },
    'a dead session with a standing refusal is not Angry': () => {
      expect(mood(withSession(deadRow({ swapBlocked: { at: NOW, reason: 'x' } })))).not.toBe('angry');
    },
    'items waiting are Sad, none waiting is not': () => {
      expect(mood(base({ waitingItems: 2 }))).toBe('sad');
      expect(mood(base({ waitingItems: 0 }))).not.toBe('sad');
    },
    'a rate-limited lane a live session is on is Dizzy': () => { expect(mood(base({ lanes: serving({ 'lane-a': rateLimited }) }))).toBe('dizzy'); },
    'a rate-limited spare lane that no session is on gives no Dizzy': () => {
      expect(mood(base({ lanes: serving({ 'lane-b': rateLimited }) }))).not.toBe('dizzy');
      expect(mood(base({ lanes: serving({ 'lane-a': { state: { word: 'ok', source: 'x' } } as unknown as LaneWire, 'lane-b': rateLimited }) }))).not.toBe('dizzy');
    },
    'a limited lane only a dead, archived or cleaned-up session was on gives no Dizzy': () => {
      const lanes = serving({ 'lane-b': rateLimited });
      expect(mood(base({ lanes, sessions: [...base().sessions!, fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', ...deadRow() })] }))).not.toBe('dizzy');
      expect(mood(base({ lanes, sessions: [...base().sessions!, fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', bucket: 'archived' })] }))).not.toBe('dizzy');
      expect(mood(base({ lanes, sessions: [...base().sessions!, fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', bucket: 'cleanup' })] }))).not.toBe('dizzy');
    },
    'a session in a wait the operator chose does not count as using its limited lane': () => {
      const lanes = serving({ 'lane-b': rateLimited });
      const waiting = fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', bucket: 'idle', limitWait: limitWait('operator', { account: 'lane-b' }) });
      expect(mood(base({ lanes, sessions: [...base().sessions!, waiting] }))).not.toBe('dizzy');
      expect(mood(base({ lanes, sessions: [...base().sessions!, waiting, fleetSession({ id: 'lane-b-y', wrapper: 'lane-b', bucket: 'working' })] }))).toBe('dizzy');
    },
    'a limited lane any live session is on is Dizzy': () => {
      const lanes = serving({ 'lane-b': rateLimited });
      for (const bucket of ['working', 'done', 'idle'])
        expect(mood(base({ lanes, sessions: [...base().sessions!, fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', bucket })] }))).toBe('dizzy');
    },
    'a recent swap is Dizzy, an older one is not': () => {
      expect(mood(withSession({ lastEnd: { at: NOW - 10_000, cause: 'swap-manual' } }))).toBe('dizzy');
      expect(mood(withSession({ lastEnd: { at: NOW - m.DIZZY_SWAP_MS - 1, cause: 'swap-manual' } }))).not.toBe('dizzy');
    },
    'a quiet run worker is Confused': () => {
      expect(mood(base({ runs: [runRow({ id: 1, program: 'project-a', state: 'working', workerLastSeen: NOW - 20 * MIN })] }))).toBe('confused');
    },
    'a null runs reader cannot make Confused or Suspicious': () => {
      expect(mood(base({ runs: null }))).not.toBe('confused');
      expect(mood(base({ runs: null }))).not.toBe('suspicious');
    },
    'a moving review is Suspicious, one parked for hours is not': () => {
      expect(mood(base({ runs: [review(5 * MIN)] }))).toBe('suspicious');
      expect(mood(base({ runs: [review(120 * MIN)] }))).not.toBe('suspicious');
    },
    'a recently moved run that is not awaiting review is not Suspicious': () => {
      const run = runRow({ id: 1, program: 'project-a', state: 'working', lastMoveAt: NOW - 5 * MIN });
      expect(mood(base({ runs: [run] }))).not.toBe('suspicious');
    },
    'a fresh merge is Happy, an old one is not': () => {
      expect(mood(withSession(merged(MIN)))).toBe('happy');
      expect(mood(withSession(merged(m.HAPPY_WINDOW_MS + 1)))).not.toBe('happy');
    },
    'a merge stamped ahead by skew counts as now, one far ahead is not trusted': () => {
      const f = withSession({ pr: { mergedAt: NOW + m.FUTURE_SKEW_MS } as never });
      expect(mood(f)).toBe('happy');
      expect(m.moodOf(f).next).toBe(NOW + m.HAPPY_WINDOW_MS);
      expect(mood(withSession({ pr: { mergedAt: NOW + 15 * MIN } as never }))).not.toBe('happy');
    },
    'a working session is Thinking, an idle one is not': () => {
      expect(mood(withSession({ bucket: 'working' }))).toBe('thinking');
      expect(mood(base())).not.toBe('thinking');
    },
    'the higher rank wins': () => {
      expect(mood(withSession({ bucket: 'attention', limitWait: limitWait('auto') }))).toBe('alert');
      expect(mood(base({ sessions: [fleetSession({ bucket: 'attention' }), fleetSession({ bucket: 'working' })] }))).toBe('alert');
      expect(mood(withSession({ bucket: 'attention' }, { conn: 'down', linkLost: true }))).toBe('offline');
      expect(mood(withSession({ bucket: 'attention' }, { agentDown: true }))).toBe('offline');
    },
    'next is the nearest window edge': () => {
      expect(m.moodOf(withSession(deadRow({ lastEnd: endedAgo(10 * MIN) }))).next).toBe(NOW + 50 * MIN);
      expect(m.moodOf(base()).next).toBeNull();
      expect(m.moodOf(base({ runs: [review(5 * MIN)] })).next).toBe(NOW - 5 * MIN + m.SUSPICIOUS_WINDOW_MS);
      expect(m.moodOf(withSession(merged(MIN))).next).toBe(NOW - MIN + m.HAPPY_WINDOW_MS);
    },
    'next is the smallest of several edges': () => {
      const f = base({ sessions: [...base().sessions!, fleetSession({ id: 'project-a-d', ...deadRow({ lastEnd: endedAgo(10 * MIN) }) }),
        fleetSession({ id: 'project-a-m', ...merged(MIN) })] });
      expect(m.moodOf(f).next).toBe(NOW - MIN + m.HAPPY_WINDOW_MS);
    },
    'an edge at this very instant is not a next edge': () => {
      const f = withSession(deadRow({ lastEnd: endedAgo(m.CRY_WINDOW_MS) }));
      expect(m.moodOf(f).next).toBeNull();
    },
    'the fallback names the readers it waits on': () => {
      const a = m.moodOf(base({ waitingItems: null }));
      expect(a.mood).toBe(m.MOOD_FALLBACK);
      expect(a.cause).not.toBe('');
      expect(m.moodOf(base({ runs: null })).cause).toContain('the runs');
      expect(m.moodOf(base({ waitingItems: null })).cause).toContain('the waiting items');
      expect(m.moodOf(base({ lanes: UNREAD })).cause).toContain('the accounts');
      expect(m.fallbackCause({ sessions: null, runs: null, waitingItems: null, lanes: UNREAD })).toContain('the sessions');
      expect(m.moodOf(base({ runs: null, lanes: UNREAD })).cause).toBe('not heard yet: the runs, the accounts');
      expect(m.moodOf(base({ runs: null, lanes: NOT_SERVED })).cause).toBe('not heard yet: the runs');
    },
  };
}

const MOOD_SET: MutantSet<MoodModule> = {
  modulePath: path.join(ROOT, 'pwa/src/face/mood.ts'),
  mutants: [
    { id: 'O1', old: "consoleLinkLost(f) || f.agentDown", new: 'f.linkLost || f.agentDown' },
    { id: 'O4', old: "const consoleLinkLost = (f: MoodFacts): boolean => f.conn !== 'open' && f.linkLost;", new: "const consoleLinkLost = (f: MoodFacts): boolean => f.linkLost;" },
    { id: 'O2', old: "consoleLinkLost(f) || f.agentDown", new: "consoleLinkLost(f)" },
    { id: 'N1', old: "['neutral', (f) => f.sessions === null]", new: "['neutral', (f) => false]" },
    { id: 'C1', old: ' || limitNotChosen(s))]', new: ')]' },
    { id: 'C7', old: "s.limitWait !== null && s.limitWait.waitingBy !== 'operator'", new: 's.limitWait !== null' },
    { id: 'C8', old: "s.limitWait.waitingBy !== 'operator'", new: "s.limitWait.waitingBy === 'operator'" },
    { id: 'C9', old: "s.limitWait !== null && s.limitWait.waitingBy !== 'operator'", new: "s.limitWait?.waitingBy !== 'operator'" },
    { id: 'C2', old: 'within(deathAt(s, f.nowMs), CRY_WINDOW_MS, f.nowMs)', new: '(deathAt(s, f.nowMs) !== null)' },
    { id: 'C3', old: 'return e !== null && DEATH_CAUSE[e.cause] ? e.at : null;', new: 'return e !== null ? e.at : null;' },
    { id: 'C4', old: "if (s.bucket !== 'dead' || s.hibernatedAt !== null || s.stoppedBy !== null) return null;", new: "if (s.bucket !== 'dead') return null;" },
    { id: 'C5', old: 'return e !== null && DEATH_CAUSE[e.cause] ? e.at : null;', new: 'return null;' },
    { id: 'C6', old: 'if (diedAt !== null) out.push(diedAt + CRY_WINDOW_MS);', new: '' },
    { id: 'O3', old: "if (m === 'offline' && !consoleLinkLost(f)) return OFFLINE_AGENT_CAUSE;", new: '' },
    { id: 'W1', old: ': Math.min(at, nowMs);', new: ': at;' },
    { id: 'W2', old: 'at - nowMs > FUTURE_SKEW_MS ? null', new: 'false ? null' },
    { id: 'A1', old: '!NOT_LIVE.has(s.bucket) && s.swapBlocked', new: 's.swapBlocked' },
    { id: 'S1', old: 'f.waitingItems > 0', new: 'f.waitingItems >= 0' },
    { id: 'D1', old: "f.lanes.kind === 'served' && Object.entries(f.lanes.lanes).some(([id, l]) => l.state.word === 'rate-limited' && lanesInUse(ss).has(id))", new: 'false' },
    { id: 'D2', old: " && lanesInUse(ss).has(id)", new: '' },
    { id: 'D3', old: '!NOT_LIVE.has(s.bucket) && s.limitWait?.waitingBy', new: 's.limitWait?.waitingBy' },
    { id: 'D4', old: '.map((s) => s.wrapper)', new: '.map((s) => s.project)' },
    { id: 'D5', old: "&& lanesInUse(ss).has(id)", new: "&& !lanesInUse(ss).has(id)" },
    { id: 'D7', old: " && s.limitWait?.waitingBy !== 'operator')", new: ')' },
    { id: 'D8', old: "s.limitWait?.waitingBy !== 'operator').map", new: "s.limitWait?.waitingBy === 'operator').map" },
    { id: 'D9', old: "new Set(sessions.filter((s) => !NOT_LIVE.has(s.bucket) &&", new: "new Set(sessions.filter((s) => (s.bucket === 'working' || s.bucket === 'idle') &&" },
    { id: 'D6', old: "new Set(sessions.filter((s) => !NOT_LIVE.has(s.bucket) &&", new: "new Set(sessions.filter((s) => s.bucket !== 'dead' &&" },
    { id: 'G1', old: "f.lanes.kind !== 'unread'\n    && ss.some((s) => within(s.pr", new: "f.lanes.kind === 'served'\n    && ss.some((s) => within(s.pr" },
    { id: 'G2', old: "f.lanes.kind !== 'unread'\n    && !ss.some", new: "f.lanes.kind === 'served'\n    && !ss.some" },
    { id: 'H1', old: "['happy', (f, ss) => f.runs !== null && f.waitingItems", new: "['happy', (f, ss) => f.waitingItems" },
    { id: 'Z1', old: "['sleeping', (f, ss) => f.runs !== null && f.waitingItems !== null && f.lanes", new: "['sleeping', (f, ss) => f.runs !== null && f.lanes" },
    { id: 'U1', old: "!isRunClosed(r) && r.state === 'awaiting-review' && within", new: '!isRunClosed(r) && within' },
    { id: 'T1', old: "s.bucket === 'working')],", new: "s.bucket === 'idle')]," },
    { id: 'E1', old: 'filter((t) => t > f.nowMs)', new: 'filter((t) => t >= f.nowMs)' },
    { id: 'E2', old: '(a === null || t < a ? t : a)', new: '(a === null || t > a ? t : a)' },
    { id: 'F1', old: "f.sessions === null ? 'the sessions' : null,", new: 'null,' },
    { id: 'F2', old: "f.runs === null ? 'the runs' : null,", new: 'null,' },
    { id: 'F3', old: "f.waitingItems === null ? 'the waiting items' : null,", new: 'null,' },
    { id: 'F4', old: "f.lanes.kind === 'unread' ? 'the accounts' : null,", new: 'null,' },
    { id: 'F5', old: "f.lanes.kind === 'unread' ? 'the accounts' : null,", new: "f.lanes.kind !== 'served' ? 'the accounts' : null," },
  ],
  suite: moodCases,
};

/** The cool-down on mood change (item 218): `shownMood`'s cases, over a loaded module. */
export function shownMoodCases(m: MoodModule): Record<string, SuiteCase> {
  const T0 = NOW;
  const on = (mood: string, since = T0): ShownMood => ({ mood, cause: `cause of ${mood}`, since });
  const decide = (mood: string) => ({ mood, cause: `decided ${mood}` });
  const END = T0 + m.MOOD_COOLDOWN_MS;
  return {
    'the cool-down is a minute to start': () => { expect(m.MOOD_COOLDOWN_MS).toBe(60_000); },
    'the first mood shows at once, from now': () => {
      expect(m.shownMood(null, decide('sleeping'), T0 + 5)).toEqual({ mood: 'sleeping', cause: 'decided sleeping', since: T0 + 5, holdUntil: null });
    },
    'an escalation inside the cool-down shows at once': () => {
      expect(m.shownMood(on('sleeping'), decide('alert'), T0 + 1000)).toEqual({ mood: 'alert', cause: 'decided alert', since: T0 + 1000, holdUntil: null });
      expect(m.shownMood(on('sad'), decide('crying'), T0 + 1).mood).toBe('crying');
    },
    'a calming change inside the cool-down waits, keeping the mood and its cause, and says when it ends': () => {
      expect(m.shownMood(on('alert'), decide('sleeping'), T0 + 1000)).toEqual({ mood: 'alert', cause: 'cause of alert', since: T0, holdUntil: END });
    },
    'an equal-rank change waits': () => {
      expect(m.shownMood(on('afraid'), decide('laughing'), T0 + 1)).toMatchObject({ mood: 'afraid', holdUntil: END });
      expect(m.shownMood(on('sleeping'), decide('afraid'), T0 + 1)).toMatchObject({ mood: 'sleeping', holdUntil: END });
      expect(m.shownMood(on('afraid'), decide('sleeping'), T0 + 1).mood).toBe('sleeping');
    },
    'a calming change shows at the end of the cool-down, to what is decided then': () => {
      expect(m.shownMood(on('alert'), decide('sleeping'), END - 1)).toMatchObject({ mood: 'alert', holdUntil: END });
      expect(m.shownMood(on('alert'), decide('sleeping'), END)).toEqual({ mood: 'sleeping', cause: 'decided sleeping', since: END, holdUntil: null });
      expect(m.shownMood(on('alert'), decide('thinking'), END + 7).mood).toBe('thinking');
    },
    'a flip-flop inside the cool-down shows the first mood throughout': () => {
      let shown: ShownMood = on('thinking');
      for (const [mood, at] of [['sleeping', T0 + 1000], ['thinking', T0 + 2000], ['sleeping', T0 + 3000], ['thinking', T0 + 4000]] as const) {
        const r = m.shownMood(shown, decide(mood), at);
        expect(r.mood).toBe('thinking');
        expect(r.since).toBe(T0);
        shown = r;
      }
    },
    'Offline shows at once, and leaving it waits': () => {
      expect(m.shownMood(on('sleeping'), { mood: 'offline', cause: 'lost' }, T0 + 1)).toEqual({ mood: 'offline', cause: 'lost', since: T0 + 1, holdUntil: null });
      expect(m.shownMood(on('offline'), decide('sleeping'), T0 + 1000)).toMatchObject({ mood: 'offline', cause: 'cause of offline', holdUntil: END });
      expect(m.shownMood(on('offline'), decide('sleeping'), END).mood).toBe('sleeping');
    },
    'leaving Neutral shows at once, arriving at it from a calmer mood too, and from Offline it waits': () => {
      expect(m.shownMood(on('neutral'), decide('sleeping'), T0 + 1)).toEqual({ mood: 'sleeping', cause: 'decided sleeping', since: T0 + 1, holdUntil: null });
      expect(m.shownMood(on('sleeping'), decide('neutral'), T0 + 1).mood).toBe('neutral');
      expect(m.shownMood(on('offline'), decide('neutral'), T0 + 1)).toMatchObject({ mood: 'offline', holdUntil: END });
    },
    'the same mood shows its new cause and keeps its time': () => {
      expect(m.shownMood(on('offline'), { mood: 'offline', cause: 'other link' }, T0 + 9)).toEqual({ mood: 'offline', cause: 'other link', since: T0, holdUntil: null });
      expect(m.shownMood(on('offline'), { mood: 'offline', cause: 'other link' }, END + 9).since).toBe(T0);
    },
    'the measured moods rank 1 to 12 and the rest are the least urgent': () => {
      expect(m.moodRank('offline')).toBe(1);
      expect(m.moodRank('sleeping')).toBe(12);
      expect(m.moodRank('afraid')).toBeGreaterThan(12);
    },
  };
}

const SHOWN_SET: MutantSet<MoodModule> = {
  modulePath: path.join(ROOT, 'pwa/src/face/mood.ts'),
  mutants: [
    { id: 'K1', old: 'moodRank(decided.mood) < moodRank(previous.mood)', new: 'moodRank(decided.mood) <= moodRank(previous.mood)' },
    { id: 'K2', old: 'moodRank(decided.mood) < moodRank(previous.mood)', new: 'moodRank(decided.mood) > moodRank(previous.mood)' },
    { id: 'K3', old: 'if (escalates || previous.mood', new: 'if (previous.mood' },
    { id: 'K4', old: 'nowMs >= endsAt', new: 'nowMs > endsAt' },
    { id: 'K5', old: 'previous.mood === MOOD_FALLBACK || ', new: '' },
    { id: 'K6', old: 'const endsAt = previous.since + MOOD_COOLDOWN_MS;', new: 'const endsAt = nowMs + MOOD_COOLDOWN_MS;' },
    { id: 'K7', old: 'return { ...previous, holdUntil: endsAt };', new: 'return { ...decided, since: previous.since, holdUntil: endsAt };' },
    { id: 'K8', old: 'cause: decided.cause, since: previous.since, holdUntil: null };', new: 'cause: decided.cause, since: nowMs, holdUntil: null };' },
    { id: 'K9', old: 'cause: decided.cause, since: previous.since, holdUntil: null };', new: 'cause: previous.cause, since: previous.since, holdUntil: null };' },
    { id: 'K10', old: 'if (previous === null) return { ...decided, since: nowMs, holdUntil: null };', new: 'if (previous === null) return { ...decided, since: 0, holdUntil: null };' },
    { id: 'K11', old: 'nowMs >= endsAt) return { ...decided, since: nowMs, holdUntil: null };', new: 'nowMs >= endsAt) return { ...decided, since: previous.since, holdUntil: null };' },
    { id: 'K12', old: "r.kind === 'measured' ? r.rank : Number.POSITIVE_INFINITY", new: "r.kind === 'measured' ? r.rank : 0" },
    { id: 'K13', old: 'return { ...previous, holdUntil: endsAt };', new: 'return { ...previous, holdUntil: null };' },
    { id: 'K14', old: 'MOOD_COOLDOWN_MS = 60_000;', new: 'MOOD_COOLDOWN_MS = 0;' },
    { id: 'K15', old: 'if (decided.mood === previous.mood) return', new: 'if (false) return' },
  ],
  suite: shownMoodCases,
};

export function splashCases(m: SplashModule): Record<string, SuiteCase> {
  const facts = (over: Partial<SplashFacts> = {}) =>
    ({ standalone: true, sinceMs: 0, frameSeen: false, reducedMotion: false, ...over });
  return {
    'not installed never shows': () => {
      for (const sinceMs of [0, m.SPLASH_TYPE_MS, m.SPLASH_MAX_MS - 1]) expect(m.splashShows(facts({ standalone: false, sinceMs }))).toBe(false);
    },
    'installed shows at mount': () => { expect(m.splashShows(facts())).toBe(true); },
    'stays until the typing ends even when the frame came first': () => {
      expect(m.splashShows(facts({ frameSeen: true, sinceMs: m.SPLASH_TYPE_MS - 1 }))).toBe(true);
      expect(m.splashShows(facts({ frameSeen: true, sinceMs: m.SPLASH_TYPE_MS }))).toBe(false);
    },
    'stays until the frame when the typing ended first': () => {
      expect(m.splashShows(facts({ sinceMs: m.SPLASH_TYPE_MS + 1 }))).toBe(true);
      expect(m.splashShows(facts({ sinceMs: m.SPLASH_TYPE_MS + 1, frameSeen: true }))).toBe(false);
    },
    'reduced motion leaves on the frame': () => {
      expect(m.splashShows(facts({ reducedMotion: true }))).toBe(true);
      expect(m.splashShows(facts({ reducedMotion: true, frameSeen: true }))).toBe(false);
    },
    'never outlives SPLASH_MAX_MS, link or no link': () => {
      expect(m.splashShows(facts({ sinceMs: m.SPLASH_MAX_MS - 1 }))).toBe(true);
      expect(m.splashShows(facts({ sinceMs: m.SPLASH_MAX_MS }))).toBe(false);
      expect(m.splashShows(facts({ sinceMs: m.SPLASH_MAX_MS, frameSeen: true }))).toBe(false);
    },
  };
}

const SPLASH_SET: MutantSet<SplashModule> = {
  modulePath: path.join(ROOT, 'pwa/src/face/splash.ts'),
  mutants: [
    { id: 'X1', old: 'f.sinceMs >= SPLASH_MAX_MS', new: 'f.sinceMs > SPLASH_MAX_MS' },
    { id: 'X2', old: 'f.sinceMs >= SPLASH_TYPE_MS', new: 'f.sinceMs > SPLASH_TYPE_MS' },
    { id: 'X3', old: 'if (!f.standalone) return false;', new: '' },
    { id: 'X4', old: 'f.reducedMotion || ', new: '' },
    { id: 'X5', old: 'if (!f.frameSeen) return true;', new: 'if (!f.frameSeen) return false;' },
  ],
  suite: splashCases,
};

export function badgeCases(m: BadgeModule): Record<string, SuiteCase> {
  return {
    'not heard yet leaves the badge, whatever was written': () => {
      expect(m.badgeAct(null, null)).toEqual({ kind: 'leave' });
      expect(m.badgeAct(null, 3)).toEqual({ kind: 'leave' });
      expect(m.badgeAct(null, 0)).toEqual({ kind: 'leave' });
    },
    'a count equal to the last one written leaves the badge': () => {
      expect(m.badgeAct(3, 3)).toEqual({ kind: 'leave' });
      expect(m.badgeAct(0, 0)).toEqual({ kind: 'leave' });
    },
    'zero clears the badge, from nothing written or from a count': () => {
      expect(m.badgeAct(0, null)).toEqual({ kind: 'clear' });
      expect(m.badgeAct(0, 2)).toEqual({ kind: 'clear' });
    },
    'a count sets the badge to that count, one included': () => {
      expect(m.badgeAct(1, null)).toEqual({ kind: 'set', n: 1 });
      expect(m.badgeAct(4, 2)).toEqual({ kind: 'set', n: 4 });
      expect(m.badgeAct(2, 0)).toEqual({ kind: 'set', n: 2 });
    },
  };
}

const BADGE_SET: MutantSet<BadgeModule> = {
  modulePath: path.join(ROOT, 'pwa/src/face/badgeAct.ts'),
  mutants: [
    { id: 'B1', old: "if (count === last) return { kind: 'leave' };", new: '' },
    { id: 'B2', old: 'if (count === 0)', new: 'if (count <= 1)' },
    { id: 'B3', old: "if (count === null) return { kind: 'leave' };", new: "if (count === null) return { kind: 'clear' };" },
    { id: 'B4', old: 'n: count }', new: 'n: count + 1 }' },
  ],
  suite: badgeCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const FACE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'pwa/src/face/mood.ts#moodOf': MOOD_SET as MutantSet<never>,
  'pwa/src/face/mood.ts#shownMood': SHOWN_SET as MutantSet<never>,
  'pwa/src/face/splash.ts#splashShows': SPLASH_SET as MutantSet<never>,
  'pwa/src/face/badgeAct.ts#badgeAct': BADGE_SET as MutantSet<never>,
};
