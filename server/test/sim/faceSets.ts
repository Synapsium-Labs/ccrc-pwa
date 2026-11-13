// The Overlord face's three deciders: their oracle cases and mutant sets (the face plan, Task F). Each decider is a pure
// L1 function in the PWA (`pwa/src/face/{mood,splash,appBadge}.ts`); its cases are restated here, over a loaded module,
// so `mutation-floors.test.ts` can run them against each textual mutant (every-run floors). The pwa suites pin the same
// behaviour against the real module; the duplication is the point, the server runner needs a suite it can hand a copy.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { FleetSession, LaneWire, RunSummary } from '../../../shared/api.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The loaded modules' shapes, written here and only as far as the suite uses them: a type edge into `pwa/` would pull
// pwa sources into the server's node16 resolution (TS2835), and `modulePath` below is a runtime load, not a type edge.
interface MoodFacts {
  conn: 'connecting' | 'open' | 'down'; linkLost: boolean; agentDown: boolean;
  sessions: readonly FleetSession[] | null; runs: readonly RunSummary[] | null; waitingItems: number | null;
  lanes: Readonly<Record<string, LaneWire>> | null; stallQuietMs: number | null; nowMs: number;
}
interface MoodModule {
  moodOf(f: MoodFacts): { mood: string; cause: string; next: number | null };
  fallbackCause(f: Pick<MoodFacts, 'sessions' | 'runs' | 'waitingItems' | 'lanes'>): string;
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
const idle = (n: string) => fleetSession({ id: `lane-a-${n}`, bucket: 'idle' });
const base = (over: Partial<MoodFacts> = {}): MoodFacts => ({
  conn: 'open', linkLost: false, agentDown: false,
  sessions: [idle('1'), idle('2'), idle('3')], runs: [], waitingItems: 0, lanes: {}, stallQuietMs: 600_000, nowMs: NOW,
  ...over,
});
const withSession = (s: Parameters<typeof fleetSession>[0], over: Partial<MoodFacts> = {}) =>
  base({ sessions: [...base().sessions!, fleetSession({ id: 'project-a-x', ...s })], ...over });
const merged = (ago: number) => ({ pr: { mergedAt: NOW - ago } as never });
const rateLimited = { state: { word: 'rate-limited', source: 'x' } } as unknown as LaneWire;
const review = (movedAgo: number) => runRow({ id: 1, program: 'project-a', state: 'awaiting-review', lastMoveAt: NOW - movedAgo });

export function moodCases(m: MoodModule): Record<string, SuiteCase> {
  const mood = (f: MoodFacts) => m.moodOf(f).mood;
  return {
    'a calm fleet is Sleeping': () => { expect(mood(base())).toBe('sleeping'); },
    'no fleet frame yet is Neutral, never Sleeping': () => { expect(mood(base({ sessions: null }))).toBe('neutral'); },
    'each null reader turns a calm mood into Neutral': () => {
      for (const over of [{ runs: null }, { waitingItems: null }, { lanes: null }] as Partial<MoodFacts>[]) {
        expect(mood(base(over))).toBe('neutral');
        expect(mood(withSession(merged(MIN), over))).toBe('neutral');
      }
      expect(mood(withSession(merged(MIN)))).toBe('happy');
    },
    'a null reader does not hide a measured rule': () => { expect(mood(withSession({ bucket: 'attention' }, { lanes: null }))).toBe('alert'); },
    'the first connect is not Offline': () => { expect(mood(base({ conn: 'connecting', linkLost: false }))).not.toBe('offline'); },
    'a down socket is Offline': () => { expect(mood(base({ conn: 'down', linkLost: true }))).toBe('offline'); },
    'a reconnect during an outage stays Offline': () => { expect(mood(base({ conn: 'connecting', linkLost: true }))).toBe('offline'); },
    'an open link with a stale linkLost is not Offline': () => { expect(mood(base({ conn: 'open', linkLost: true }))).not.toBe('offline'); },
    'a remote fleet whose agent is down is Offline': () => { expect(mood(base({ agentDown: true }))).toBe('offline'); },
    'a session with a question is Alert': () => { expect(mood(withSession({ bucket: 'attention' }))).toBe('alert'); },
    'a recent unchosen death is Crying': () => { expect(mood(withSession({ bucket: 'dead', bucketSince: NOW - 10 * MIN }))).toBe('crying'); },
    'a limit wait is Crying': () => { expect(mood(withSession({ limitWait: { at: NOW } as never }))).toBe('crying'); },
    'a hibernated or stopped session does not cry': () => {
      expect(mood(withSession({ bucket: 'dead', bucketSince: NOW - MIN, hibernatedAt: NOW - MIN }))).not.toBe('crying');
      expect(mood(withSession({ bucket: 'dead', bucketSince: NOW - MIN, stoppedBy: { at: NOW, surface: 'pwa' } as never }))).not.toBe('crying');
    },
    'a death with no time does not cry': () => { expect(mood(withSession({ bucket: 'dead', bucketSince: null }))).not.toBe('crying'); },
    'a death older than the window does not cry': () => {
      expect(mood(withSession({ bucket: 'dead', bucketSince: NOW - m.CRY_WINDOW_MS - 1 }))).not.toBe('crying');
    },
    'a standing swap refusal is Angry': () => {
      expect(mood(withSession({ bucket: 'working', swapBlocked: { at: NOW, reason: 'x' } }))).toBe('angry');
    },
    'a dead session with a standing refusal is not Angry': () => {
      expect(mood(withSession({ bucket: 'dead', swapBlocked: { at: NOW, reason: 'x' } }))).not.toBe('angry');
    },
    'items waiting are Sad, none waiting is not': () => {
      expect(mood(base({ waitingItems: 2 }))).toBe('sad');
      expect(mood(base({ waitingItems: 0 }))).not.toBe('sad');
    },
    'a rate-limited lane is Dizzy': () => { expect(mood(base({ lanes: { 'lane-a': rateLimited } }))).toBe('dizzy'); },
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
    'a working session is Thinking, an idle one is not': () => {
      expect(mood(withSession({ bucket: 'working' }))).toBe('thinking');
      expect(mood(base())).not.toBe('thinking');
    },
    'the higher rank wins': () => {
      expect(mood(withSession({ bucket: 'attention', limitWait: { at: NOW } as never }))).toBe('alert');
      expect(mood(base({ sessions: [fleetSession({ bucket: 'attention' }), fleetSession({ bucket: 'working' })] }))).toBe('alert');
      expect(mood(withSession({ bucket: 'attention' }, { conn: 'down', linkLost: true }))).toBe('offline');
      expect(mood(withSession({ bucket: 'attention' }, { agentDown: true }))).toBe('offline');
    },
    'next is the nearest window edge': () => {
      expect(m.moodOf(withSession({ bucket: 'dead', bucketSince: NOW - 10 * MIN })).next).toBe(NOW + 50 * MIN);
      expect(m.moodOf(base()).next).toBeNull();
      expect(m.moodOf(base({ runs: [review(5 * MIN)] })).next).toBe(NOW - 5 * MIN + m.SUSPICIOUS_WINDOW_MS);
      expect(m.moodOf(withSession(merged(MIN))).next).toBe(NOW - MIN + m.HAPPY_WINDOW_MS);
    },
    'next is the smallest of several edges': () => {
      const f = base({ sessions: [...base().sessions!, fleetSession({ id: 'project-a-d', bucket: 'dead', bucketSince: NOW - 10 * MIN }),
        fleetSession({ id: 'project-a-m', ...merged(MIN) })] });
      expect(m.moodOf(f).next).toBe(NOW - MIN + m.HAPPY_WINDOW_MS);
    },
    'an edge at this very instant is not a next edge': () => {
      const f = withSession({ bucket: 'dead', bucketSince: NOW - m.CRY_WINDOW_MS });
      expect(m.moodOf(f).next).toBeNull();
    },
    'the fallback names the readers it waits on': () => {
      const a = m.moodOf(base({ waitingItems: null }));
      expect(a.mood).toBe(m.MOOD_FALLBACK);
      expect(a.cause).not.toBe('');
      expect(m.moodOf(base({ runs: null })).cause).toContain('the runs');
      expect(m.moodOf(base({ waitingItems: null })).cause).toContain('the waiting items');
      expect(m.moodOf(base({ lanes: null })).cause).toContain('the lanes');
      expect(m.fallbackCause({ sessions: null, runs: null, waitingItems: null, lanes: null })).toContain('the sessions');
      expect(m.moodOf(base({ runs: null, lanes: null })).cause).toBe('not heard yet: the runs, the lanes');
    },
  };
}

const MOOD_SET: MutantSet<MoodModule> = {
  modulePath: path.join(ROOT, 'pwa/src/face/mood.ts'),
  mutants: [
    { id: 'O1', old: "(f.conn !== 'open' && f.linkLost) || f.agentDown", new: 'f.linkLost || f.agentDown' },
    { id: 'O2', old: "(f.conn !== 'open' && f.linkLost) || f.agentDown", new: "(f.conn !== 'open' && f.linkLost)" },
    { id: 'N1', old: "['neutral', (f) => f.sessions === null]", new: "['neutral', (f) => false]" },
    { id: 'C1', old: ' || s.limitWait !== null)]', new: ')]' },
    { id: 'C2', old: 'within(s.bucketSince, CRY_WINDOW_MS, f.nowMs)', new: 'true' },
    { id: 'A1', old: '!NOT_LIVE.has(s.bucket) && s.swapBlocked', new: 's.swapBlocked' },
    { id: 'S1', old: 'f.waitingItems > 0', new: 'f.waitingItems >= 0' },
    { id: 'D1', old: "f.lanes !== null && Object.values(f.lanes).some((l) => l.state.word === 'rate-limited')", new: 'false' },
    { id: 'H1', old: "['happy', (f, ss) => f.runs !== null && f.waitingItems", new: "['happy', (f, ss) => f.waitingItems" },
    { id: 'Z1', old: "['sleeping', (f, ss) => f.runs !== null && f.waitingItems !== null && f.lanes", new: "['sleeping', (f, ss) => f.runs !== null && f.lanes" },
    { id: 'U1', old: "!isRunClosed(r) && r.state === 'awaiting-review' && within", new: '!isRunClosed(r) && within' },
    { id: 'T1', old: "s.bucket === 'working')],", new: "s.bucket === 'idle')]," },
    { id: 'E1', old: 'filter((t) => t > f.nowMs)', new: 'filter((t) => t >= f.nowMs)' },
    { id: 'E2', old: '(a === null || t < a ? t : a)', new: '(a === null || t > a ? t : a)' },
    { id: 'F1', old: "f.sessions === null ? 'the sessions' : null,", new: 'null,' },
    { id: 'F2', old: "f.runs === null ? 'the runs' : null,", new: 'null,' },
    { id: 'F3', old: "f.waitingItems === null ? 'the waiting items' : null,", new: 'null,' },
    { id: 'F4', old: "f.lanes === null ? 'the lanes' : null,", new: 'null,' },
  ],
  suite: moodCases,
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
  modulePath: path.join(ROOT, 'pwa/src/face/appBadge.ts'),
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
  'pwa/src/face/splash.ts#splashShows': SPLASH_SET as MutantSet<never>,
  'pwa/src/face/appBadge.ts#badgeAct': BADGE_SET as MutantSet<never>,
};
