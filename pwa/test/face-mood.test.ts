import { describe, expect, it } from 'vitest';
import { MOODS, type Mood } from '../../shared/face';
import type { LaneWire } from '../../shared/api';
import { workerQuietAt } from '../src/fleet/runWords';
import { MEASURED, CRY_WINDOW_MS, DIZZY_SWAP_MS, HAPPY_WINDOW_MS, MOOD_FALLBACK, MOOD_RULES, SUSPICIOUS_WINDOW_MS, fallbackCause, moodOf, type MoodFacts } from '../src/face/mood';
import { fleetSession } from './fleetFixture';
import { runRow } from './ledgersFixture';

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const idle = (n: string) => fleetSession({ id: `lane-a-${n}`, bucket: 'idle' });
const base = (over: Partial<MoodFacts> = {}): MoodFacts => ({
  conn: 'open', linkLost: false, agentDown: false,
  sessions: [idle('1'), idle('2'), idle('3')], runs: [], waitingItems: 0, lanes: {}, stallQuietMs: 600_000, nowMs: NOW,
  ...over,
});
const withSession = (s: Partial<Parameters<typeof fleetSession>[0]>, over: Partial<MoodFacts> = {}) =>
  base({ sessions: [...base().sessions!, fleetSession({ id: 'project-a-x', ...s })], ...over });
const merged = (ago: number) => ({ pr: { mergedAt: NOW - ago } as never });
const rateLimited = { state: { word: 'rate-limited', source: 'x' } } as unknown as LaneWire;
const review = (movedAgo: number) => runRow({ id: 1, program: 'project-a', state: 'awaiting-review', lastMoveAt: NOW - movedAgo });
const mood = (f: MoodFacts): Mood => moodOf(f).mood;

describe('moodOf', () => {
  it('a calm fleet is Sleeping', () => expect(mood(base())).toBe('sleeping'));
  it('no fleet frame yet is Neutral, never Sleeping', () => expect(mood(base({ sessions: null }))).toBe('neutral'));
  it('each null reader turns a calm mood into Neutral', () => {
    for (const over of [{ runs: null }, { waitingItems: null }, { lanes: null }] as Partial<MoodFacts>[]) {
      expect(mood(base(over))).toBe('neutral');
      expect(mood(withSession(merged(MIN), over))).toBe('neutral');
    }
    expect(mood(withSession(merged(MIN)))).toBe('happy');
  });
  it('a null reader does not hide a measured rule', () => {
    expect(mood(withSession({ bucket: 'attention' }, { lanes: null }))).toBe('alert');
  });
  it('the first connect is not Offline', () => expect(mood(base({ conn: 'connecting', linkLost: false }))).not.toBe('offline'));
  it('a down socket is Offline', () => expect(mood(base({ conn: 'down', linkLost: true }))).toBe('offline'));
  it('a reconnect during an outage stays Offline', () => expect(mood(base({ conn: 'connecting', linkLost: true }))).toBe('offline'));
  it('a link back open is not Offline', () => expect(mood(base({ conn: 'open', linkLost: false }))).not.toBe('offline'));
  it('an open link with a stale linkLost is not Offline', () => expect(mood(base({ conn: 'open', linkLost: true }))).not.toBe('offline'));
  it('a remote fleet whose agent is down is Offline', () => expect(mood(base({ agentDown: true }))).toBe('offline'));
  it('a remote fleet with no health answer yet is not Offline', () => expect(mood(base({ agentDown: false }))).not.toBe('offline'));
  it('a session with a question is Alert', () => expect(mood(withSession({ bucket: 'attention' }))).toBe('alert'));
  it('a recent unchosen death is Crying', () =>
    expect(mood(withSession({ bucket: 'dead', bucketSince: NOW - 10 * MIN }))).toBe('crying'));
  it('a limit wait is Crying', () =>
    expect(mood(withSession({ limitWait: { at: NOW } as never }))).toBe('crying'));
  it('a hibernated or stopped session does not cry', () => {
    expect(mood(withSession({ bucket: 'dead', bucketSince: NOW - MIN, hibernatedAt: NOW - MIN }))).not.toBe('crying');
    expect(mood(withSession({ bucket: 'dead', bucketSince: NOW - MIN, stoppedBy: { at: NOW, surface: 'pwa' } as never }))).not.toBe('crying');
  });
  it('a death with no time does not cry', () =>
    expect(mood(withSession({ bucket: 'dead', bucketSince: null }))).not.toBe('crying'));
  it('a death older than the window does not cry', () =>
    expect(mood(withSession({ bucket: 'dead', bucketSince: NOW - CRY_WINDOW_MS - 1 }))).not.toBe('crying'));
  it('a standing swap refusal is Angry', () =>
    expect(mood(withSession({ bucket: 'working', swapBlocked: { at: NOW, reason: 'x' } }))).toBe('angry'));
  it('items waiting are Sad', () => expect(mood(base({ waitingItems: 2 }))).toBe('sad'));
  it('a rate-limited lane is Dizzy', () => expect(mood(base({ lanes: { 'lane-a': rateLimited } }))).toBe('dizzy'));
  it('a recent swap is Dizzy', () =>
    expect(mood(withSession({ lastEnd: { at: NOW - 10_000, cause: 'swap-manual' } }))).toBe('dizzy'));
  it('a swap older than the window is not Dizzy', () =>
    expect(mood(withSession({ lastEnd: { at: NOW - DIZZY_SWAP_MS - 1, cause: 'swap-manual' } }))).not.toBe('dizzy'));
  it('a quiet run worker is Confused', () =>
    expect(mood(base({ runs: [runRow({ id: 1, program: 'project-a', state: 'working', workerLastSeen: NOW - 20 * MIN })] }))).toBe('confused'));
  it('a null runs reader cannot make Confused or Suspicious', () => {
    expect(mood(base({ runs: null }))).not.toBe('confused');
    expect(mood(base({ runs: null }))).not.toBe('suspicious');
  });
  it('a moving review is Suspicious', () => expect(mood(base({ runs: [review(5 * MIN)] }))).toBe('suspicious'));
  it('a review parked for hours is not Suspicious', () =>
    expect(mood(base({ runs: [review(120 * MIN)] }))).not.toBe('suspicious'));
  it('a fresh merge is Happy', () => expect(mood(withSession(merged(MIN)))).toBe('happy'));
  it('a merge older than the window is not Happy', () =>
    expect(mood(withSession(merged(HAPPY_WINDOW_MS + 1)))).not.toBe('happy'));
  it('a working session is Thinking', () => expect(mood(withSession({ bucket: 'working' }))).toBe('thinking'));
  it('the higher rank wins', () => {
    expect(mood(withSession({ bucket: 'attention', limitWait: { at: NOW } as never }))).toBe('alert');
    expect(mood(base({ sessions: [fleetSession({ bucket: 'attention' }), fleetSession({ bucket: 'working' })] }))).toBe('alert');
    expect(mood(withSession({ bucket: 'attention' }, { conn: 'down', linkLost: true }))).toBe('offline');
    expect(mood(withSession({ bucket: 'attention' }, { agentDown: true }))).toBe('offline');
  });
  it('Afraid and Laughing are never chosen', () => {
    const cases = [
      base(), base({ sessions: null }), base({ waitingItems: 3 }), base({ lanes: { a: rateLimited } }), base({ runs: [review(MIN)] }),
      withSession({ bucket: 'attention' }), withSession({ bucket: 'working' }), withSession(merged(MIN)),
      withSession({ bucket: 'dead', bucketSince: NOW - MIN }), base({ conn: 'down', linkLost: true }), base({ runs: null }),
    ];
    for (const c of cases) expect(['afraid', 'laughing']).not.toContain(mood(c));
  });
  it('next is the nearest window edge', () => {
    expect(moodOf(withSession({ bucket: 'dead', bucketSince: NOW - 10 * MIN })).next).toBe(NOW + 50 * MIN);
    expect(moodOf(base()).next).toBeNull();
    expect(moodOf(base({ runs: [review(5 * MIN)] })).next).toBe(NOW - 5 * MIN + SUSPICIOUS_WINDOW_MS);
    expect(moodOf(withSession(merged(MIN))).next).toBe(NOW - MIN + HAPPY_WINDOW_MS);
  });
  it('next is the instant a quiet worker reads quiet, as its owner says', () => {
    const run = runRow({ id: 1, program: 'project-a', state: 'working', workerLastSeen: NOW - 5 * MIN });
    const expected = NOW - 5 * MIN + 10 * MIN + 1;
    expect(workerQuietAt(run, 10 * MIN)).toBe(expected);
    expect(moodOf(base({ runs: [run], stallQuietMs: 10 * MIN })).next).toBe(expected);
    const open = { ...run, workerLastTurn: { state: 'working', startedAt: NOW - MIN, endedAt: null } } as never;
    expect(workerQuietAt(open, 10 * MIN)).toBeNull();
    expect(workerQuietAt({ ...run, workerLastSeen: Number.NaN }, 10 * MIN)).toBeNull();
  });
  it('next is the end of a swap window', () =>
    expect(moodOf(withSession({ lastEnd: { at: NOW - 10_000, cause: 'swap-manual' } })).next).toBe(NOW - 10_000 + DIZZY_SWAP_MS));
  it('a dead session with a standing refusal is not Angry', () =>
    expect(mood(withSession({ bucket: 'dead', swapBlocked: { at: NOW, reason: 'x' } }))).not.toBe('angry'));
  it('the measured table is in rank order', () =>
    expect(MEASURED.map(([m]) => { const r = MOOD_RULES[m]; return r.kind === 'measured' ? r.rank : -1; })).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
  it('no rule matching gives the fallback', () => {
    const a = moodOf(base({ waitingItems: null }));
    expect(a.mood).toBe(MOOD_FALLBACK);
    expect(a.cause).not.toBe('');
  });
  it('the fallback names the reader it waits on', () => {
    expect(moodOf(base({ runs: null })).cause).toContain('the runs');
    expect(moodOf(base({ waitingItems: null })).cause).toContain('the waiting items');
    expect(moodOf(base({ lanes: null })).cause).toContain('the lanes');
    expect(fallbackCause({ sessions: null, runs: null, waitingItems: null, lanes: null })).toContain('the sessions');
    expect(moodOf(base({ runs: null, lanes: null })).cause).toBe('not heard yet: the runs, the lanes');
  });
  it('every mood has one rule, and the measured ranks are 1 to 12 without a gap or repeat', () => {
    expect(Object.keys(MOOD_RULES).sort()).toEqual([...MOODS].sort());
    const measured = Object.values(MOOD_RULES).flatMap((r) => (r.kind === 'measured' ? [r.rank] : []));
    expect(measured.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Object.entries(MOOD_RULES).filter(([, r]) => r.kind === 'waits').map(([m]) => m).sort()).toEqual(['afraid', 'laughing']);
    expect(MOOD_FALLBACK).toBe('neutral');
  });
  it('every answer carries a cause', () => {
    for (const f of [base(), base({ sessions: null }), withSession({ bucket: 'working' })]) expect(moodOf(f).cause).not.toBe('');
  });
});
