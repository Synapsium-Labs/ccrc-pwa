// Overlord W1a, the timers piece (Task 3): `continuity_timers`, its moves through `TIMER_TRANSITIONS`, one writer each
// (`insertTimer`, `markTimersFired`, `cancelTimer`, `purgeTimers`), and its reads. Every move is a compare-and-set on
// `state = 'pending'`; a reason that is not its actor's throws and moves nothing; a fire is all of its timers or none.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { tx } from '../src/coord/tx.js';
import type { TimerInsert } from '../src/continuity/continuityStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const ID = 'lane-a-project-a';
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-timers-'), '.ccrc', 'coord.db')));
const row = (over: Partial<TimerInsert> = {}): TimerInsert => ({
  setter: ID, setterIncarnation: '11111111-2222-3333-4444-555555555555', setById: ID, setByUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  role: 'worker', note: 'check the checks', runId: 7, programme: null, setAt: NOW, dueAt: NOW + 2 * 3_600_000, ...over,
});
const set = (s: CoordStore, over: Partial<TimerInsert> = {}): number => {
  const r = s.insertTimer(row(over));
  if (!r.ok) throw new Error('timer not set');
  return r.id;
};
const states = (s: CoordStore): Record<string, unknown>[] =>
  s.db.prepare('SELECT id, state, firedAt, mailId, cancelledAt, cancelReason FROM continuity_timers ORDER BY id').all() as Record<string, unknown>[];

describe('continuity_timers: the table and its writers (Overlord §3.3.12, C61)', () => {
  it('the migration\'s slot is found by its DDL, after the card\'s tables', () => {
    const slot = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE continuity_timers')) + 1;
    expect(slot).toBeGreaterThan(MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE continuity_card_reads')) + 1);
    expect(MIGRATIONS.filter((m) => m.includes('continuity_timers'))).toHaveLength(1);
  });

  it('insert then read back: a pending row with every column as set', () => {
    const s = store();
    const id = set(s, { programme: null, runId: 7 });
    const r = s.pendingTimersOf(ID);
    expect(r).toStrictEqual({ ok: true, rows: [{
      id, setter: ID, setterIncarnation: '11111111-2222-3333-4444-555555555555', setById: ID,
      setByUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'worker', note: 'check the checks', runId: 7, programme: null,
      setAt: NOW, dueAt: NOW + 2 * 3_600_000, state: 'pending', firedAt: null, mailId: null, cancelledAt: null, cancelReason: null,
    }] });
  });

  it('a row with both a run and a programme is refused by the check', () => {
    const s = store();
    expect(s.insertTimer(row({ runId: 7, programme: 'prog-a' }))).toStrictEqual({ ok: false, kind: 'write-failed' });
    expect(states(s)).toEqual([]);
    expect(s.insertTimer(row({ runId: null, programme: 'prog-a' })).ok).toBe(true);
    expect(s.insertTimer(row({ runId: null, programme: null })).ok).toBe(true);
  });

  it('a cancel of a pending row changes it once; a second cancel answers changed: false', () => {
    const s = store();
    const id = set(s);
    expect(s.cancelTimer(id, 'setter-cancel', 'setter', NOW + 1)).toStrictEqual({ changed: true });
    expect(s.cancelTimer(id, 'operator-cancel', 'operator', NOW + 2)).toStrictEqual({ changed: false });
    expect(states(s)).toEqual([{ id, state: 'cancelled', firedAt: null, mailId: null, cancelledAt: NOW + 1, cancelReason: 'setter' }]);
  });

  it('a cancel by cleanup with the reason operator throws and moves nothing; each reason with its own actor moves', () => {
    const s = store();
    const id = set(s);
    expect(() => s.cancelTimer(id, 'cleanup', 'operator', NOW + 1)).toThrow(/operator is not cleanup's/);
    expect(() => s.cancelTimer(id, 'setter-cancel', 'run-closed', NOW + 1)).toThrow();
    expect(() => s.cancelTimer(id, 'timer-lane', 'setter', NOW + 1)).toThrow();
    expect(states(s)).toEqual([{ id, state: 'pending', firedAt: null, mailId: null, cancelledAt: null, cancelReason: null }]);
    for (const reason of ['run-closed', 'programme-ended', 'setter-archived', 'setter-gone', 'retired'] as const) {
      const t = set(s);
      expect(s.cancelTimer(t, 'cleanup', reason, NOW + 3), reason).toStrictEqual({ changed: true });
    }
  });

  it('a fired row is never cancelled, and a cancelled row is never fired', () => {
    const s = store();
    const a = set(s); const b = set(s);
    s.markTimersFired([a], 41, NOW + 1);
    expect(s.cancelTimer(a, 'cleanup', 'run-closed', NOW + 2)).toStrictEqual({ changed: false });
    s.cancelTimer(b, 'setter-cancel', 'setter', NOW + 2);
    expect(() => s.markTimersFired([b], 42, NOW + 3)).toThrow(/no longer pending/);
    expect(states(s)).toEqual([
      { id: a, state: 'fired', firedAt: NOW + 1, mailId: 41, cancelledAt: null, cancelReason: null },
      { id: b, state: 'cancelled', firedAt: null, mailId: null, cancelledAt: NOW + 2, cancelReason: 'setter' },
    ]);
  });

  it('markTimersFired over three rows, one cancelled meanwhile, throws inside a tx and leaves all three as they were, mail included', () => {
    const s = store();
    const ids = [set(s), set(s), set(s)];
    s.cancelTimer(ids[1]!, 'cleanup', 'setter-gone', NOW + 1);
    const before = states(s);
    const mailsBefore = (s.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n;
    expect(() => tx(s.db, () => {
      // A stand-in for the lane's mail insert, in the same transaction: it must roll back with the timers.
      s.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, kind, subject, body, artifacts) VALUES (?, 'timer', '', ?, 'status', 's', 'b', '[]')").run(NOW, ID);
      s.markTimersFired(ids, 99, NOW + 2);
    })).toThrow(/1 of 3 timers were no longer pending/);
    expect(states(s)).toEqual(before);
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n).toBe(mailsBefore);
  });

  it('markTimersFired outside a transaction is all or nothing too', () => {
    const s = store();
    const ids = [set(s), set(s)];
    s.markTimersFired([ids[1]!], 5, NOW + 1);
    expect(() => s.markTimersFired(ids, 6, NOW + 2)).toThrow();
    expect(states(s).map((r) => [r.state, r.mailId])).toEqual([['pending', null], ['fired', 5]]);
    expect(s.markTimersFired([ids[0]!], 7, NOW + 3)).toStrictEqual({ changed: true });
  });

  it('pendingTimersOf leaves out fired and cancelled rows and other setters\' rows, oldest due first', () => {
    const s = store();
    const late = set(s, { dueAt: NOW + 3 * DAY });
    const early = set(s, { dueAt: NOW + DAY });
    const fired = set(s); const cancelled = set(s);
    set(s, { setter: 'lane-b-project-a' });
    s.markTimersFired([fired], 1, NOW + 1);
    s.cancelTimer(cancelled, 'setter-cancel', 'setter', NOW + 1);
    const r = s.pendingTimersOf(ID);
    expect(r.ok && r.rows.map((x) => x.id)).toEqual([early, late]);
    const all = s.pendingTimers();
    expect(all.ok && all.rows.map((x) => x.setter).sort()).toEqual([ID, ID, 'lane-b-project-a']);
  });

  it('a read of a row this build cannot read answers ok: false, never an empty list', () => {
    const s = store();
    set(s);
    s.db.prepare("UPDATE continuity_timers SET state = 'snoozed'").run();
    const r = s.pendingTimers();
    expect(r.ok).toBe(true); // the pending read selects state = 'pending', so the row is out of it
    s.db.prepare("UPDATE continuity_timers SET state = 'pending', cancelReason = 'expired'").run();
    const bad = s.pendingTimersOf(ID);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.detail).toContain('cancel reason expired');
    expect(s.pendingTimers().ok).toBe(false);
    expect(s.timerHoldFacts(ID, 0).ok).toBe(false);
  });

  it('timerHoldFacts answers the earliest pending and the newest fired at or after firedSince', () => {
    const s = store();
    expect(s.timerHoldFacts(ID, 0)).toStrictEqual({ ok: true, earliestPending: null, newestFired: null });
    const p2 = set(s, { dueAt: NOW + 2 * DAY });
    const p1 = set(s, { dueAt: NOW + DAY });
    const f1 = set(s); const f2 = set(s); const f3 = set(s);
    set(s, { setter: 'lane-b-project-a', dueAt: NOW });
    s.markTimersFired([f1], 1, NOW + 10);
    s.markTimersFired([f2], 2, NOW + 30);
    s.markTimersFired([f3], 3, NOW + 20);
    const h = s.timerHoldFacts(ID, NOW + 15);
    expect(h.ok && [h.earliestPending?.id, h.newestFired?.id, h.newestFired?.firedAt]).toEqual([p1, f2, NOW + 30]);
    const at = s.timerHoldFacts(ID, NOW + 30);
    expect(at.ok && at.newestFired?.id).toBe(f2);
    const after = s.timerHoldFacts(ID, NOW + 31);
    expect(after.ok && after.newestFired).toBeNull();
    expect(p2).toBeGreaterThan(0);
  });

  it('setsSince counts the setter\'s sets at or after since, cancelled and fired ones too', () => {
    const s = store();
    set(s, { setAt: NOW - 3_600_001 });
    const a = set(s, { setAt: NOW - 3_600_000 });
    const b = set(s, { setAt: NOW - 1 });
    set(s, { setAt: NOW });
    set(s, { setter: 'lane-b-project-a', setAt: NOW });
    s.cancelTimer(a, 'setter-cancel', 'setter', NOW);
    s.markTimersFired([b], 1, NOW);
    expect(s.setsSince(ID, NOW - 3_600_000)).toBe(3);
    expect(s.setsSince('lane-c-project-a', 0)).toBe(0);
  });

  it('purgeTimers removes only terminal rows past the keep, never a pending one', () => {
    const s = store();
    const now = NOW + 200 * DAY;
    const before = now - 90 * DAY;
    const firedOld = set(s); const firedNew = set(s); const cancelledOld = set(s); const cancelledNew = set(s);
    const pendingOld = set(s, { setAt: NOW - 400 * DAY, dueAt: NOW - 300 * DAY });
    s.markTimersFired([firedOld], 1, now - 91 * DAY);
    s.markTimersFired([firedNew], 2, now - 89 * DAY);
    s.cancelTimer(cancelledOld, 'cleanup', 'run-closed', now - 91 * DAY);
    s.cancelTimer(cancelledNew, 'cleanup', 'run-closed', now - 89 * DAY);
    expect(s.purgeTimers(before)).toStrictEqual({ removed: 2 });
    expect(states(s).map((r) => r.id)).toEqual([firedNew, cancelledNew, pendingOld]);
    expect(s.purgeTimers(before)).toStrictEqual({ removed: 0 });
  });
});
