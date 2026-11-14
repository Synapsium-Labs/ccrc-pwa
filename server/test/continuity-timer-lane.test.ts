// Overlord W1a, the timers piece (Task 8; spec §3.3.12, C62 to C65, I17): the timers lane. One pass cleans up (always),
// fires each due timer that answered `keep` with its one mail in one transaction (held while `mail-disabled` stands), and
// purges. A fact it cannot measure neither fires nor cancels; a timer fires at most once, only with the mail that names it.
// In-memory-shaped `coord.db` in a temp dir, a fixed clock, stub incarnation reads; fixtures use neutral ids.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { localIO } from '../src/io.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import type { SessionRecord } from '../src/registry.js';
import { MAIL_DISABLED_MARKER } from '../../shared/switches.js';
import { testDeps, withFakeClock } from './helpers.js';
import { fakeTime } from './fakeTime.js';
import { quietAtTestEnd } from './laneQuiet.js';   // D-8140: nothing a watcher fires outlives its test
import type { TimerInsert } from '../src/continuity/continuityStore.js';
import {
  gatherTimerFacts, runTimersLane, setterIncarnationOf, timersPass, type IncarnationRead, type TimerListing, type TimersPassResult,
} from '../src/continuity/timerLane.js';
import { TIMER_KEEP_MS, TIMER_MAIL_SENDER } from '../../shared/continuity-timers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const H = 3_600_000;
const DAY = 86_400_000;
const ID = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const STAMP = '11111111-2222-3333-4444-555555555555';
const LATER = '99999999-2222-3333-4444-555555555555';

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-timer-lane-'), '.ccrc', 'coord.db')));
const set = (s: CoordStore, over: Partial<TimerInsert> = {}): number => {
  const r = s.insertTimer({ setter: ID, setterIncarnation: STAMP, setById: ID, setByUuid: 'u', role: 'worker',
    note: 'check the checks', runId: null, programme: null, setAt: NOW - 3 * H, dueAt: NOW - MIN, ...over });
  if (!r.ok) throw new Error('timer not set');
  return r.id;
};
const openRun = (s: CoordStore, program = 'prog-a'): number => {
  const opened = s.openRun({ program, title: 'T', project: 'project-a', wave: 2, waveOf: 3, claimedBy: OTHER });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  return opened.id;
};
const timer = (s: CoordStore, id: number) => s.db.prepare(
  'SELECT state, firedAt, mailId, cancelReason FROM continuity_timers WHERE id = ?').get(id) as
  { state: string; firedAt: number | null; mailId: number | null; cancelReason: string | null } | undefined;
const timerMail = (s: CoordStore) => s.db.prepare(
  'SELECT m.id, m.toId, m.runId, m.kind, m.subject, m.body, d.toId AS deliverTo, d.state FROM mail m '
  + 'JOIN mail_deliveries d ON d.mailId = m.id WHERE m.fromId = ? ORDER BY m.id').all(TIMER_MAIL_SENDER) as
  { id: number; toId: string; runId: number | null; kind: string; subject: string; body: string; deliverTo: string; state: string }[];

const LISTED: TimerListing = { listedAt: NOW - 1_000, listedIds: new Set([ID, OTHER]), archivedIds: new Set(), mailDisabled: false };
const measured = (v: string): IncarnationRead => ({ kind: 'measured', incarnation: v });
const absent: IncarnationRead = { kind: 'unmeasured', reason: 'absent' };

/** One pass at `now`, its incarnation reads answered from `reads` (a setter not in it reads its own stamp). */
const pass = async (s: CoordStore, o: { now?: number; listing?: Partial<TimerListing>; reads?: Record<string, IncarnationRead> } = {}):
  Promise<TimersPassResult> => {
  const logs: string[] = [];
  const facts = await gatherTimerFacts(s, async (id) => o.reads?.[id] ?? measured(STAMP));
  return timersPass({ coord: s, now: o.now ?? NOW, log: (l) => logs.push(l) }, { ...LISTED, ...o.listing }, facts);
};

describe('setterIncarnationOf: the one place a reason of incarnationOf is compared (incarnation-reason-is-a-string)', () => {
  it.each(['unreadable', 'changing', 'unread', 'not a session id'])('%s reads unmeasured', (reason) => {
    expect(setterIncarnationOf({ kind: 'unmeasured', reason })).toEqual({ kind: 'unmeasured' });
  });
  it('absent reads absent, and a measured read keeps its value', () => {
    expect(setterIncarnationOf(absent)).toEqual({ kind: 'absent' });
    expect(setterIncarnationOf(measured(STAMP))).toEqual({ kind: 'measured', v: STAMP });
  });
});

describe('the timers lane: a due timer fires once, with its one mail (I17)', () => {
  it('fires a due run-bound timer with one mail carrying its run, to its setter, from the role timer', async () => {
    const s = store();
    const runId = openRun(s);
    const id = set(s, { runId });
    const r = await pass(s);
    expect(r.fired).toHaveLength(1);
    const mail = timerMail(s);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ toId: ID, deliverTo: ID, runId, kind: 'status', state: 'queued' });
    expect(mail[0]!.subject).toBe(`timer: 1 due (${id})`);
    expect(timer(s, id)).toEqual({ state: 'fired', firedAt: NOW, mailId: mail[0]!.id, cancelReason: null });
  });

  it('two passes fire nothing twice', async () => {
    const s = store();
    const id = set(s);
    await pass(s);
    const again = await pass(s, { now: NOW + MIN });
    expect(again.fired).toEqual([]);
    expect(timerMail(s)).toHaveLength(1);
    expect(timer(s, id)!.state).toBe('fired');
  });

  it('a timer not yet due stays pending and sends nothing', async () => {
    const s = store();
    const id = set(s, { dueAt: NOW + MIN });
    expect((await pass(s)).fired).toEqual([]);
    expect(timer(s, id)!.state).toBe('pending');
  });

  it('a crash between the mail insert and the move leaves neither: the mail rolls back with the timers', async () => {
    const s = store();
    const id = set(s);
    const real = s.markTimersFired.bind(s);
    s.markTimersFired = () => { throw new Error('the disk went away'); };
    const r = await pass(s);
    expect(r).toMatchObject({ fired: [], failed: 1 });
    expect(timerMail(s)).toEqual([]);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM mail_deliveries').get()).toEqual({ n: 0 });
    expect(timer(s, id)!.state).toBe('pending');
    s.markTimersFired = real;
    expect((await pass(s, { now: NOW + MIN })).fired).toHaveLength(1);
    expect(timerMail(s)).toHaveLength(1);
  });

  it('one mail that fails does not stop the next: two setters, the first one\'s move throws', async () => {
    const s = store();
    const a = set(s, { dueAt: NOW - 2 * MIN });
    const b = set(s, { setter: OTHER, setById: OTHER });
    const real = s.markTimersFired.bind(s);
    s.markTimersFired = (ids, mailId, at) => { if (ids.includes(a)) throw new Error('moved'); return real(ids, mailId, at); };
    const r = await pass(s);
    expect(r.failed).toBe(1);
    expect(r.fired.map((f) => f.ids)).toEqual([[b]]);
    expect(timer(s, a)!.state).toBe('pending');
  });
});

describe('cleanup runs before the fire', () => {
  it('a due timer whose run closed is cancelled run-closed and never fired', async () => {
    const s = store();
    const runId = openRun(s);
    expect(s.advance(runId, 'failed', 'operator')).toMatchObject({ ok: true });
    const id = set(s, { runId });
    const r = await pass(s);
    expect(r).toMatchObject({ fired: [], cancelled: [{ id, reason: 'run-closed' }] });
    expect(timerMail(s)).toEqual([]);
  });
});

describe('the brakes: mail-disabled holds firing and not cleanup; a gap fires late, once', () => {
  it('under mail-disabled nothing fires and a run-closed timer is still cancelled; after it lifts, the timer fires 7 min late', async () => {
    const s = store();
    const closed = openRun(s);
    expect(s.advance(closed, 'failed', 'operator')).toMatchObject({ ok: true });
    const gone = set(s, { runId: closed });
    const id = set(s, { dueAt: NOW });
    const held = await pass(s, { listing: { mailDisabled: true } });
    expect(held.fired).toEqual([]);
    expect(held.cancelled).toEqual([{ id: gone, reason: 'run-closed' }]);
    expect(timer(s, id)!.state).toBe('pending');
    const lifted = await pass(s, { now: NOW + 7 * MIN });
    expect(lifted.fired).toHaveLength(1);
    expect(timerMail(s)[0]!.body).toContain(`Timer ${id}: due `);
    expect(timerMail(s)[0]!.body).toContain('fired 7 min late.');
  });

  it('a 91-day-old fired row is purged and an 89-day-old one is kept; a pending row never is', async () => {
    const s = store();
    const old = set(s, { dueAt: NOW + DAY });
    const young = set(s, { dueAt: NOW + DAY });
    const pending = set(s, { setAt: NOW - 100 * DAY, dueAt: NOW + DAY });
    s.db.prepare("UPDATE continuity_timers SET state = 'fired', firedAt = ?, mailId = 1 WHERE id = ?").run(NOW - 91 * DAY, old);
    s.db.prepare("UPDATE continuity_timers SET state = 'fired', firedAt = ?, mailId = 1 WHERE id = ?").run(NOW - 89 * DAY, young);
    expect((await pass(s)).purged).toBe(1);
    expect(timer(s, old)).toBeUndefined();
    expect(timer(s, young)!.state).toBe('fired');
    expect(timer(s, pending)!.state).toBe('pending');
    expect(91 * DAY).toBeGreaterThan(TIMER_KEEP_MS);
  });
});

describe('the cleanup arm: setter-gone from the stamp only, and every unmeasured fact waits', () => {
  it('a setter whose .generation changed is cancelled setter-gone, and gets no mail', async () => {
    const s = store();
    const id = set(s);
    const r = await pass(s, { reads: { [ID]: measured(LATER) } });
    expect(r.cancelled).toEqual([{ id, reason: 'setter-gone' }]);
    expect(timerMail(s)).toEqual([]);
  });

  it('a setter whose .generation reads absent and whom the listing did not name is cancelled setter-gone', async () => {
    const s = store();
    const id = set(s);
    const r = await pass(s, { reads: { [ID]: absent }, listing: { listedIds: new Set([OTHER]) } });
    expect(r.cancelled).toEqual([{ id, reason: 'setter-gone' }]);
  });

  it('a row the listing named but left unbuilt (.generation absent) waits, and fires once it reads again', async () => {
    const s = store();
    const id = set(s);
    const first = await pass(s, { reads: { [ID]: absent } });
    expect(first).toMatchObject({ cancelled: [], fired: [], waited: 1 });
    expect(timer(s, id)!.state).toBe('pending');
    expect((await pass(s, { now: NOW + MIN })).fired).toHaveLength(1);
  });

  it('a setter born after the listing began (its timer set at or after listedAt) waits, and fires on the next pass', async () => {
    const s = store();
    const id = set(s, { setAt: NOW - 1_000, dueAt: NOW - 1 });
    const first = await pass(s, { reads: { [ID]: absent }, listing: { listedAt: NOW - 1_000, listedIds: new Set([OTHER]) } });
    expect(first).toMatchObject({ cancelled: [], fired: [], waited: 1 });
    expect((await pass(s, { now: NOW + MIN, listing: { listedAt: NOW + MIN - 1_000 } })).fired).toHaveLength(1);
    expect(timer(s, id)!.state).toBe('fired');
  });

  it('a null listedAt, or a listing that was not read, waits', async () => {
    const s = store();
    set(s);
    expect(await pass(s, { listing: { listedAt: null } })).toMatchObject({ waited: 1, fired: [], cancelled: [] });
    expect(await pass(s, { listing: { listedIds: null } })).toMatchObject({ waited: 1, fired: [], cancelled: [] });
  });

  it('an archived row is cancelled setter-archived', async () => {
    const s = store();
    const id = set(s);
    expect((await pass(s, { listing: { archivedIds: new Set([ID]) } })).cancelled).toEqual([{ id, reason: 'setter-archived' }]);
  });

  it('an unreadable .generation leaves the timer pending and unfired; the next pass with a matching read fires it', async () => {
    const s = store();
    const id = set(s);
    for (const reason of ['unreadable', 'changing', 'unread']) {
      expect(await pass(s, { reads: { [ID]: { kind: 'unmeasured', reason } } })).toMatchObject({ waited: 1, fired: [], cancelled: [] });
    }
    expect(timer(s, id)!.state).toBe('pending');
    expect((await pass(s)).fired).toHaveLength(1);
  });

  it('an incarnation read that throws waits', async () => {
    const s = store();
    set(s);
    const facts = await gatherTimerFacts(s, async () => { throw new Error('link down'); });
    expect(timersPass({ coord: s, now: NOW, log: () => {} }, LISTED, facts)).toMatchObject({ waited: 1, fired: [] });
  });

  it('a programme with planEnd cancels its timer programme-ended; one whose state reads done with planEnd unset keeps it', async () => {
    const s = store();
    openRun(s, 'prog-a');
    openRun(s, 'prog-b');
    s.db.prepare("UPDATE programs SET planEnd = 'done' WHERE slug = 'prog-a'").run();
    s.db.prepare("UPDATE programs SET state = 'done' WHERE slug = 'prog-b'").run();
    const ended = set(s, { programme: 'prog-a' });
    const between = set(s, { programme: 'prog-b' });
    const r = await pass(s);
    expect(r.cancelled).toEqual([{ id: ended, reason: 'programme-ended' }]);
    expect(r.fired.map((f) => f.ids)).toEqual([[between]]);
    expect(timerMail(s)[0]!.body).toContain('programme prog-b.');
  });

  it('a pending read that fails is a fact: nothing is cancelled or fired, and the purge still runs', async () => {
    const s = store();
    const facts = { pending: { ok: false as const, detail: 'disk I/O error' }, incarnations: new Map() };
    const logs: string[] = [];
    const r = timersPass({ coord: s, now: NOW, log: (l) => logs.push(l) }, LISTED, facts);
    expect(r).toMatchObject({ unread: 'disk I/O error', cancelled: [], fired: [] });
    expect(logs.join('\n')).toContain('disk I/O error');
  });
});

describe('the mail is bounded: what does not fit waits for the next pass, oldest first', () => {
  it('12 due timers of one setter and run, with 500-character notes, go out over two passes, oldest first', async () => {
    const s = store();
    const runId = openRun(s);
    const ids = Array.from({ length: 12 }, (_, i) => set(s, { runId, dueAt: NOW - (20 - i) * MIN, note: 'x'.repeat(500) }));
    const first = await pass(s);
    expect(first.fired).toHaveLength(1);
    const n = first.fired[0]!.ids.length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(12);
    expect(first.fired[0]!.ids).toEqual(ids.slice(0, n));
    const second = await pass(s, { now: NOW + MIN });
    expect(second.fired.flatMap((f) => f.ids)).toEqual(ids.slice(n));
    expect(timerMail(s)).toHaveLength(2);
  });
});

describe('runTimersLane: the whole pass on the fleet\'s .generation files', () => {
  it('reads each setter\'s stamp from $REG/<id>.generation: a match fires, a different one cancels', async () => {
    const home = mkTmp('ccrc-timer-lane-reg-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(path.join(reg, `${ID}.generation`), STAMP);
    writeFileSync(path.join(reg, `${OTHER}.generation`), LATER);
    const s = store();
    const mine = set(s);
    const theirs = set(s, { setter: OTHER, setById: OTHER });
    const r = await runTimersLane({ coord: s, clock: { wall: () => NOW }, io: localIO, registryDir: reg, log: () => {} }, LISTED);
    expect(r.fired.map((f) => f.ids)).toEqual([[mine]]);
    expect(r.cancelled).toEqual([{ id: theirs, reason: 'setter-gone' }]);
  });
});

describe('FleetWatcher.sweepTimers: the tick\'s own listing, passed in', () => {
  afterEach(() => { vi.useRealTimers(); });
  /** A watcher over `home`'s registry, its store `s`. Only the record fields the lane reads are set. */
  const watcher = (home: string, s: CoordStore): FleetWatcher =>
    quietAtTestEnd(new FleetWatcher(withFakeClock({ ...testDeps(home), coord: s, time: fakeTime({ wallMs: NOW }).ports }), new Bus(), 2000));
  const rec = (id: string, archivedAt: number | null = null): SessionRecord => ({ id, archivedAt }) as unknown as SessionRecord;
  const home = (): string => { const h = mkTmp('ccrc-timer-lane-w-'); mkdirSync(path.join(h, '.cc-sessions'), { recursive: true }); return h; };

  it('reads whether a row was listed from listedIds, never from records: a listed, unbuilt row with no .generation waits', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
    const h = home();
    const s = store();
    const id = set(s);
    await watcher(h, s).sweepTimers([], new Set([ID]), NOW - 1_000, []);
    expect(timer(s, id)!.state).toBe('pending');
    writeFileSync(path.join(h, '.cc-sessions', `${ID}.generation`), STAMP);
    await watcher(h, s).sweepTimers([rec(ID)], new Set([ID]), NOW - 1_000, []);
    expect(timer(s, id)!.state).toBe('fired');
  });

  it('a row the listing did not name, with no .generation, is cancelled setter-gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
    const s = store();
    const id = set(s);
    await watcher(home(), s).sweepTimers([], new Set([OTHER]), NOW - 1_000, []);
    expect(timer(s, id)!.cancelReason).toBe('setter-gone');
  });

  it('archived comes from the record\'s archive stamp, mail-disabled from the listing\'s names, and listedAt is the tick\'s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
    const h = home();
    writeFileSync(path.join(h, '.cc-sessions', `${ID}.generation`), STAMP);
    const s = store();
    const archived = set(s, { setter: OTHER, setById: OTHER });
    const held = set(s);
    const late = set(s, { setAt: NOW - 500 });
    await watcher(h, s).sweepTimers([rec(ID), rec(OTHER, NOW - DAY)], new Set([ID, OTHER]), NOW - 1_000, [MAIL_DISABLED_MARKER]);
    expect(timer(s, archived)!.cancelReason).toBe('setter-archived');
    expect(timer(s, held)!.state).toBe('pending');
    expect(timer(s, late)!.state).toBe('pending');
    await watcher(h, s).sweepTimers([rec(ID)], new Set([ID]), NOW - 1_000, []);
    expect(timer(s, held)!.state).toBe('fired');
    expect(timer(s, late)!.state).toBe('pending');
  });
});
