import { describe, expect, it } from 'vitest';
import { MOODS, type Mood } from '../../shared/face';
import { sessionBucket, type LaneWire, type LastEnd, type LimitWait } from '../../shared/api';
import { workerQuietAt } from '../src/fleet/runWords';
import { MEASURED, MOOD_COOLDOWN_MS, moodRank, shownMood, type ShownMood, CRY_WINDOW_MS, DIZZY_SWAP_MS, FUTURE_SKEW_MS, HAPPY_WINDOW_MS, MOOD_FALLBACK, MOOD_RULES, OFFLINE_AGENT_CAUSE, SUSPICIOUS_WINDOW_MS, fallbackCause, lanesRead, moodOf, type LanesRead, type MoodFacts } from '../src/face/mood';
import { fleetSession } from './fleetFixture';
import { runRow } from './ledgersFixture';

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const SERVED: LanesRead = { kind: 'served', lanes: {} };
const UNREAD: LanesRead = { kind: 'unread' };
const NOT_SERVED: LanesRead = { kind: 'not-served' };
const idle = (n: string) => fleetSession({ id: `lane-a-${n}`, wrapper: 'lane-a', bucket: 'idle' });
const base = (over: Partial<MoodFacts> = {}): MoodFacts => ({
  conn: 'open', linkLost: false, agentDown: false,
  sessions: [idle('1'), idle('2'), idle('3')], runs: [], waitingItems: 0, lanes: SERVED, stallQuietMs: 600_000, nowMs: NOW,
  ...over,
});
const withSession = (s: Partial<Parameters<typeof fleetSession>[0]>, over: Partial<MoodFacts> = {}) =>
  base({ sessions: [...base().sessions!, fleetSession({ id: 'project-a-x', ...s })], ...over });
/** A row the server files for a session whose pane is gone: `sessionBucket`'s own answer for `status: 'dead'` with no stamp
 *  (`assembleFleet` sets `statusUpdatedAt` only in the live-pane arm), so its `bucketSince` is whatever the ladder yields. */
const deadRow = (over: Partial<Parameters<typeof fleetSession>[0]> = {}) => {
  const input = { status: 'dead' as const, statusUpdatedAt: null, dialogPending: false, hookState: null, archivedAt: null, pr: null, background: null };
  return { ...sessionBucket(input, null), status: 'dead' as const, statusUpdatedAt: null, ...over };
};
const endedAgo = (ago: number, cause: LastEnd['cause'] = 'exited'): LastEnd => ({ at: NOW - ago, cause });
const merged = (ago: number) => ({ pr: { mergedAt: NOW - ago } as never });
/** A `limitWait` as the wire carries it (D-8123, D-8173): the watchdog's record, and whose "wait until reset" choice stands. */
const limitWait = (waitingBy: LimitWait['waitingBy'], over: Partial<LimitWait> = {}): LimitWait =>
  ({ since: NOW - MIN, reset: NOW + 30 * MIN, account: 'lane-a', waiting: waitingBy !== null, waitingBy, ...over });
const rateLimited = { state: { word: 'rate-limited', source: 'x' } } as unknown as LaneWire;
const review = (movedAgo: number) => runRow({ id: 1, program: 'project-a', state: 'awaiting-review', lastMoveAt: NOW - movedAgo });
const mood = (f: MoodFacts): Mood => moodOf(f).mood;

describe('moodOf', () => {
  it('a calm fleet is Sleeping', () => expect(mood(base())).toBe('sleeping'));
  it('no fleet frame yet is Neutral, never Sleeping', () => expect(mood(base({ sessions: null }))).toBe('neutral'));
  it('each null reader turns a calm mood into Neutral', () => {
    for (const over of [{ runs: null }, { waitingItems: null }, { lanes: UNREAD }] as Partial<MoodFacts>[]) {
      expect(mood(base(over))).toBe('neutral');
      expect(mood(withSession(merged(MIN), over))).toBe('neutral');
    }
    expect(mood(withSession(merged(MIN)))).toBe('happy');
  });
  it('a null reader does not hide a measured rule', () => {
    expect(mood(withSession({ bucket: 'attention' }, { lanes: UNREAD }))).toBe('alert');
  });
  it('lanes not served to this reader do not hold the calm moods back', () => {
    expect(mood(base({ lanes: NOT_SERVED }))).toBe('sleeping');
    expect(mood(withSession(merged(MIN), { lanes: NOT_SERVED }))).toBe('happy');
  });
  it('lanes not served switch only the lane arm of Dizzy off', () => {
    expect(mood(base({ lanes: NOT_SERVED }))).not.toBe('dizzy');
    expect(mood(withSession({ lastEnd: { at: NOW - 10_000, cause: 'swap-manual' } }, { lanes: NOT_SERVED }))).toBe('dizzy');
    expect(mood(base({ lanes: { kind: 'served', lanes: { 'lane-a': rateLimited } } }))).toBe('dizzy');
  });
  it('lanesRead keeps its three conditions apart', () => {
    expect(lanesRead(false, null)).toEqual(UNREAD);
    expect(lanesRead(true, null)).toEqual(NOT_SERVED);
    expect(lanesRead(true, {})).toEqual(SERVED);
  });
  it('the first connect is not Offline', () => expect(mood(base({ conn: 'connecting', linkLost: false }))).not.toBe('offline'));
  it('a down socket is Offline', () => expect(mood(base({ conn: 'down', linkLost: true }))).toBe('offline'));
  it('a reconnect during an outage stays Offline', () => expect(mood(base({ conn: 'connecting', linkLost: true }))).toBe('offline'));
  it('a link back open is not Offline', () => expect(mood(base({ conn: 'open', linkLost: false }))).not.toBe('offline'));
  it('an open link with a stale linkLost is not Offline', () => expect(mood(base({ conn: 'open', linkLost: true }))).not.toBe('offline'));
  it('a remote fleet whose agent is down is Offline', () => expect(mood(base({ agentDown: true }))).toBe('offline'));
  it('Offline names the link that is down: the console\'s own, or the server\'s to the fleet', () => {
    const own = moodOf(base({ conn: 'down', linkLost: true }));
    expect(own.cause).toBe(MOOD_RULES.offline.kind === 'measured' ? MOOD_RULES.offline.cause : '');
    expect(own.cause).toContain('console');
    expect(moodOf(base({ agentDown: true })).cause).toBe(OFFLINE_AGENT_CAUSE);
    expect(OFFLINE_AGENT_CAUSE).toContain('server');
    expect(moodOf(base({ conn: 'down', linkLost: true, agentDown: true })).cause).toBe(own.cause);
  });
  it('a remote fleet with no health answer yet is not Offline', () => expect(mood(base({ agentDown: false }))).not.toBe('offline'));
  it('a session with a question is Alert', () => expect(mood(withSession({ bucket: 'attention' }))).toBe('alert'));
  it('a dead row as the server files it carries no bucketSince', () => expect(deadRow().bucketSince).toBeNull());
  it('a recent unchosen death is Crying, dated from lastEnd', () =>
    expect(mood(withSession(deadRow({ lastEnd: endedAgo(10 * MIN) })))).toBe('crying'));
  it('every death cause cries, and a swap or a limit restart is no death', () => {
    for (const cause of ['oom', 'tmux-server', 'exited', 'unknown'] as const) expect(mood(withSession(deadRow({ lastEnd: endedAgo(MIN, cause) })))).toBe('crying');
    for (const cause of ['swap-auto-home', 'swap-auto-rescue', 'swap-auto', 'swap-manual', 'limit-resume'] as const)
      expect(mood(withSession(deadRow({ lastEnd: endedAgo(MIN, cause) })))).not.toBe('crying');
  });
  it('a limit wait nobody chose is Crying: ccd waiting by itself, or no choice yet', () => {
    expect(mood(withSession({ limitWait: limitWait('auto') }))).toBe('crying');
    expect(mood(withSession({ limitWait: limitWait(null, { waiting: false }) }))).toBe('crying');
  });
  it('a limit wait the operator chose is not Crying (item 219)', () => {
    expect(mood(withSession({ limitWait: limitWait('operator') }))).not.toBe('crying');
    expect(mood(withSession({ limitWait: limitWait('operator', { reset: null }) }))).not.toBe('crying');
  });
  it("one session's chosen wait does not hide another's limit nobody chose", () => {
    const f = base({ sessions: [...base().sessions!, fleetSession({ id: 'project-a-x', limitWait: limitWait('operator') }),
      fleetSession({ id: 'project-a-y', limitWait: limitWait('auto') })] });
    expect(mood(f)).toBe('crying');
  });
  it('the Crying cause says the limit was not chosen', () => {
    expect(moodOf(withSession({ limitWait: limitWait('auto') })).cause).toBe(MOOD_RULES.crying.kind === 'measured' ? MOOD_RULES.crying.cause : '');
    expect(MOOD_RULES.crying.kind === 'measured' && MOOD_RULES.crying.cause).toContain('did not choose');
  });
  it('a hibernated or stopped session does not cry, though its process ended just now', () => {
    expect(mood(withSession(deadRow({ lastEnd: endedAgo(MIN), hibernatedAt: NOW - MIN })))).not.toBe('crying');
    expect(mood(withSession(deadRow({ lastEnd: endedAgo(MIN), stoppedBy: { at: NOW, surface: 'pwa' } as never })))).not.toBe('crying');
  });
  it('a death with no recorded end does not cry', () =>
    expect(mood(withSession(deadRow({ lastEnd: null })))).not.toBe('crying'));
  it('a live session with a recent process end does not cry', () =>
    expect(mood(withSession({ bucket: 'working', lastEnd: endedAgo(MIN) }))).not.toBe('crying'));
  it('a death older than the window does not cry', () =>
    expect(mood(withSession(deadRow({ lastEnd: endedAgo(CRY_WINDOW_MS + 1) })))).not.toBe('crying'));
  it('a standing swap refusal is Angry', () =>
    expect(mood(withSession({ bucket: 'working', swapBlocked: { at: NOW, reason: 'x' } }))).toBe('angry'));
  it('items waiting are Sad', () => expect(mood(base({ waitingItems: 2 }))).toBe('sad'));
  it('a rate-limited lane a live session is on is Dizzy', () =>
    expect(mood(base({ lanes: { kind: 'served', lanes: { 'lane-a': rateLimited } } }))).toBe('dizzy'));
  it('a rate-limited spare lane that no session is on gives no Dizzy (item 219)', () => {
    expect(mood(base({ lanes: { kind: 'served', lanes: { 'lane-b': rateLimited } } }))).not.toBe('dizzy');
    expect(mood(base({ lanes: { kind: 'served', lanes: { 'lane-a': { state: { word: 'ok', source: 'x' } } as unknown as LaneWire, 'lane-b': rateLimited } } }))).not.toBe('dizzy');
  });
  it('a limited lane only a dead, archived or cleaned-up session was on gives no Dizzy', () => {
    const lanes: LanesRead = { kind: 'served', lanes: { 'lane-b': rateLimited } };
    expect(mood(base({ lanes, sessions: [...base().sessions!, fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', ...deadRow() })] }))).not.toBe('dizzy');
    expect(mood(base({ lanes, sessions: [...base().sessions!, fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', bucket: 'archived' })] }))).not.toBe('dizzy');
    expect(mood(base({ lanes, sessions: [...base().sessions!, fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', bucket: 'cleanup' })] }))).not.toBe('dizzy');
  });
  it('a session in a wait the operator chose does not count as using its limited lane (item 219)', () => {
    const lanes: LanesRead = { kind: 'served', lanes: { 'lane-b': rateLimited } };
    const waiting = fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', bucket: 'idle', limitWait: limitWait('operator', { account: 'lane-b' }) });
    expect(mood(base({ lanes, sessions: [...base().sessions!, waiting] }))).not.toBe('dizzy');
    expect(mood(base({ lanes, sessions: [...base().sessions!, waiting] }))).not.toBe('crying');
    // another live session on the same lane still uses it
    const other = fleetSession({ id: 'lane-b-y', wrapper: 'lane-b', bucket: 'working' });
    expect(mood(base({ lanes, sessions: [...base().sessions!, waiting, other] }))).toBe('dizzy');
  });
  it('a limited lane any live session is on is Dizzy, whichever live bucket it is in', () => {
    const lanes: LanesRead = { kind: 'served', lanes: { 'lane-b': rateLimited } };
    for (const bucket of ['working', 'done', 'idle'] as const)
      expect(mood(base({ lanes, sessions: [...base().sessions!, fleetSession({ id: 'lane-b-x', wrapper: 'lane-b', bucket })] }))).toBe('dizzy');
  });
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
  it('a merge stamped ahead by clock skew counts as now, and its window runs from now', () => {
    const f = withSession({ pr: { mergedAt: NOW + FUTURE_SKEW_MS } as never });
    expect(mood(f)).toBe('happy');
    expect(moodOf(f).next).toBe(NOW + HAPPY_WINDOW_MS);
  });
  it('a merge stamped far ahead is not trusted, so it is Happy for no time at all', () => {
    expect(mood(withSession({ pr: { mergedAt: NOW + 15 * MIN } as never }))).not.toBe('happy');
    expect(moodOf(withSession({ pr: { mergedAt: NOW + 15 * MIN } as never })).next).toBeNull();
  });
  it('a merge older than the window is not Happy', () =>
    expect(mood(withSession(merged(HAPPY_WINDOW_MS + 1)))).not.toBe('happy'));
  it('a working session is Thinking', () => expect(mood(withSession({ bucket: 'working' }))).toBe('thinking'));
  it('the higher rank wins', () => {
    expect(mood(withSession({ bucket: 'attention', limitWait: limitWait('auto') }))).toBe('alert');
    expect(mood(base({ sessions: [fleetSession({ bucket: 'attention' }), fleetSession({ bucket: 'working' })] }))).toBe('alert');
    expect(mood(withSession({ bucket: 'attention' }, { conn: 'down', linkLost: true }))).toBe('offline');
    expect(mood(withSession({ bucket: 'attention' }, { agentDown: true }))).toBe('offline');
  });
  it('Afraid and Laughing are never chosen', () => {
    const cases = [
      base(), base({ sessions: null }), base({ waitingItems: 3 }), base({ lanes: { kind: 'served', lanes: { a: rateLimited } } }), base({ runs: [review(MIN)] }),
      withSession({ bucket: 'attention' }), withSession({ bucket: 'working' }), withSession(merged(MIN)),
      withSession(deadRow({ lastEnd: endedAgo(MIN) })), base({ conn: 'down', linkLost: true }), base({ runs: null }),
    ];
    for (const c of cases) expect(['afraid', 'laughing']).not.toContain(mood(c));
  });
  it('next is the nearest window edge', () => {
    expect(moodOf(withSession(deadRow({ lastEnd: endedAgo(10 * MIN) }))).next).toBe(NOW + 50 * MIN);
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
    expect(mood(withSession(deadRow({ swapBlocked: { at: NOW, reason: 'x' } })))).not.toBe('angry'));
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
    expect(moodOf(base({ lanes: UNREAD })).cause).toContain('the accounts');
    expect(fallbackCause({ sessions: null, runs: null, waitingItems: null, lanes: UNREAD })).toContain('the sessions');
    expect(moodOf(base({ runs: null, lanes: UNREAD })).cause).toBe('not heard yet: the runs, the accounts');
  });
  it('lanes not served are never named as unheard', () => {
    expect(moodOf(base({ runs: null, lanes: NOT_SERVED })).cause).toBe('not heard yet: the runs');
    expect(fallbackCause({ sessions: [], runs: [], waitingItems: 0, lanes: NOT_SERVED })).not.toContain('lanes');
    expect(fallbackCause({ sessions: [], runs: [], waitingItems: 0, lanes: NOT_SERVED })).not.toContain('accounts');
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

// The cool-down on mood change (item 218): `shownMood` chooses what the face shows from what it showed and what `moodOf`
// decided. Time is an argument.
describe('shownMood', () => {
  const T0 = NOW;
  const on = (m: Mood, since = T0): ShownMood => ({ mood: m, cause: `cause of ${m}`, since });
  const decide = (m: Mood) => ({ mood: m, cause: `decided ${m}` });
  const afterEnd = T0 + MOOD_COOLDOWN_MS;

  it('the cool-down is a minute to start', () => expect(MOOD_COOLDOWN_MS).toBe(60_000));
  it('the first mood shows at once, from now', () => {
    expect(shownMood(null, decide('sleeping'), T0 + 5)).toEqual({ mood: 'sleeping', cause: 'decided sleeping', since: T0 + 5, holdUntil: null });
  });
  it('an escalation inside the cool-down shows at once', () => {
    const r = shownMood(on('sleeping'), decide('alert'), T0 + 1000);
    expect(r).toEqual({ mood: 'alert', cause: 'decided alert', since: T0 + 1000, holdUntil: null });
  });
  it('an escalation shows at once whatever the gap between the ranks', () => {
    expect(shownMood(on('sleeping'), decide('neutral'), T0 + 1).mood).toBe('neutral');
    expect(shownMood(on('sad'), decide('crying'), T0 + 1).mood).toBe('crying');
  });
  it('a calming change inside the cool-down waits, keeping the mood and its cause, and says when it ends', () => {
    const r = shownMood(on('alert'), decide('sleeping'), T0 + 1000);
    expect(r).toEqual({ mood: 'alert', cause: 'cause of alert', since: T0, holdUntil: afterEnd });
  });
  it('an equal-rank change is not an escalation: it waits (a mood with no measured rule counts as the calmest)', () => {
    expect(shownMood(on('afraid'), decide('laughing'), T0 + 1)).toMatchObject({ mood: 'afraid', holdUntil: afterEnd });
    expect(shownMood(on('sleeping'), decide('afraid'), T0 + 1)).toMatchObject({ mood: 'sleeping', holdUntil: afterEnd });
    expect(shownMood(on('alert'), decide('afraid'), T0 + 1)).toMatchObject({ mood: 'alert', holdUntil: afterEnd });
    expect(shownMood(on('afraid'), decide('sleeping'), T0 + 1).mood).toBe('sleeping');
  });
  it('a calming change shows at the cool-down\'s end, to what is decided then', () => {
    expect(shownMood(on('alert'), decide('sleeping'), afterEnd - 1)).toMatchObject({ mood: 'alert', holdUntil: afterEnd });
    expect(shownMood(on('alert'), decide('sleeping'), afterEnd)).toEqual({ mood: 'sleeping', cause: 'decided sleeping', since: afterEnd, holdUntil: null });
    expect(shownMood(on('alert'), decide('thinking'), afterEnd + 7).mood).toBe('thinking');
  });
  it('a flip-flop (A, B, A) inside the cool-down shows A throughout', () => {
    let shown: ShownMood | null = on('thinking');
    for (const [m, at] of [['sleeping', T0 + 1000], ['thinking', T0 + 2000], ['sleeping', T0 + 3000], ['thinking', T0 + 4000]] as const) {
      const r = shownMood(shown, decide(m), at);
      expect(r.mood).toBe('thinking');
      expect(r.since).toBe(T0);
      shown = r;
    }
  });
  it('a held face shows the first mood that differs once the cool-down ends, not a queue of the missed changes', () => {
    const held = shownMood(on('alert'), decide('sleeping'), T0 + 1000);
    expect(held.mood).toBe('alert');
    expect(shownMood(held, decide('thinking'), afterEnd).mood).toBe('thinking');
  });
  it('Offline shows at once, from any mood, inside the cool-down', () => {
    for (const m of MOODS.filter((x) => x !== 'offline')) {
      expect(shownMood(on(m), { mood: 'offline', cause: 'lost' }, T0 + 1)).toEqual({ mood: 'offline', cause: 'lost', since: T0 + 1, holdUntil: null });
    }
  });
  it('leaving Offline for a calmer mood waits like any other calming change', () => {
    const r = shownMood(on('offline'), decide('sleeping'), T0 + 1000);
    expect(r).toMatchObject({ mood: 'offline', cause: 'cause of offline', holdUntil: afterEnd });
    expect(shownMood(on('offline'), decide('sleeping'), afterEnd).mood).toBe('sleeping');
  });
  it('leaving Neutral, the not-heard-yet reading, shows at once for any mood', () => {
    for (const m of MOODS.filter((x) => x !== 'neutral')) {
      expect(shownMood(on('neutral'), decide(m), T0 + 1)).toEqual({ mood: m, cause: `decided ${m}`, since: T0 + 1, holdUntil: null });
    }
  });
  it('arriving at Neutral from a calmer mood is an escalation and shows at once; from Offline it waits', () => {
    expect(shownMood(on('sleeping'), decide('neutral'), T0 + 1).mood).toBe('neutral');
    expect(shownMood(on('offline'), decide('neutral'), T0 + 1)).toMatchObject({ mood: 'offline', holdUntil: afterEnd });
  });
  it('the same mood shows its new cause and keeps its time, held or not', () => {
    expect(shownMood(on('offline'), { mood: 'offline', cause: 'other link' }, T0 + 9)).toEqual({ mood: 'offline', cause: 'other link', since: T0, holdUntil: null });
    expect(shownMood(on('offline'), { mood: 'offline', cause: 'other link' }, afterEnd + 9).since).toBe(T0);
  });
  it('it ranks the measured moods 1 to 12 and the rest as the least urgent', () => {
    expect(moodRank('offline')).toBe(1);
    expect(moodRank('sleeping')).toBe(12);
    expect(moodRank('afraid')).toBeGreaterThan(12);
    expect(moodRank('laughing')).toBeGreaterThan(12);
  });
  it('the accessible name stays with the held mood: moodOf decides, the shown mood and its cause are the name', () => {
    const decided = moodOf(withSession({ bucket: 'attention' }));
    const shown = shownMood(on('thinking'), decided, T0 + 1);
    expect(shown.mood).toBe('alert');
    expect(shown.cause).toBe(MOOD_RULES.alert.kind === 'measured' ? MOOD_RULES.alert.cause : '');
  });
});
