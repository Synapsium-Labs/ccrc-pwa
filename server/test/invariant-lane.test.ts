// Overlord W1, the invariant monitor's runner (plan w1-sequence-monitor.md Task 6): `InvariantMonitor.pass` over a real migrated
// temp `coord.db`, the real gatherer, the real findings store and the real ladder raise (a fake authority appender only).
// Shadow raises nothing; Live raises the latch and one blocking item per new finding; a refused latch records nothing and is
// retried; a repaired fault resolves and a recurrence is a new episode. Temp databases only, never the live HOME.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { InvariantMonitor, invariantMonitorOver, type InvariantMonitorDeps } from '../src/coord/invariantLane.js';
import { CoordStore } from '../src/coord/store.js';
import { LANE_ARM_LANES } from '../../shared/lane-arm.js';
import { gatherInvariantInput } from '../src/coord/invariantFacts.js';
import { findingCounts, openFindings, recordFinding, resolveFindings } from '../src/coord/invariantFindingsStore.js';
import { INVARIANT_NAMES, type InvariantInput } from '../src/coord/invariants.js';
import { effectiveRung } from '../src/coord/overlordLadder.js';
import { LADDER_CAUSE_MAP } from '../../shared/overlord-ladder.js';
import { raiseLatch } from '../src/coord/overlordLadderRead.js';
import { ladderRows, raiseLatchInTx, type AuthorityAppender } from '../src/coord/overlordLadderStore.js';
import { serverActorOf } from '../src/auth/attributionIdentity.js';
import { tx } from '../src/coord/tx.js';
import { insertTimer, markTimersFired } from '../src/continuity/continuityStore.js';
import { INVARIANTS_LANE } from '../../shared/lane-arm.js';
import { mkTmp } from './tmpHelpers.js';
import { mkdirSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps, withFakeClock } from './helpers.js';
import { fakeTime } from './fakeTime.js';
import { quietAtTestEnd } from './laneQuiet.js';

const NOW = 1_800_000_000_000;
const SWEEP = 600_000;
const opened: DatabaseSync[] = [];
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* closed */ } } });

const timer = (db: DatabaseSync, setter: string): number => {
  const r = insertTimer(db, {
    setter, setterIncarnation: '11111111-2222-3333-4444-555555555555', setById: setter, setByUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    role: 'worker', note: 'n', runId: null, programme: null, setAt: NOW, dueAt: NOW + 1000,
  });
  if (!r.ok) throw new Error('timer insert failed');
  return r.id;
};
const mail = (db: DatabaseSync, fromId: string, toId: string): number => Number(db.prepare(
  "INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (?, ?, 'u', ?, NULL, 'status', 's', 'b')")
  .run(NOW, fromId, toId).lastInsertRowid);
const count = (db: DatabaseSync, table: string): number => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
/** A fired timer: `bad` plants the I17 violation (its mail is to another session), else it holds. */
const firedTimer = (db: DatabaseSync, setter: string, bad: boolean): { id: number; good: number; wrong: number } => {
  const id = timer(db, setter);
  const good = mail(db, 'timer', setter);
  const wrong = mail(db, 'timer', 'lane-other');
  tx(db, () => markTimersFired(db, [id], bad ? wrong : good, NOW + 5));
  return { id, good, wrong };
};
const setMail = (db: DatabaseSync, id: number, mailId: number): void => { db.prepare('UPDATE continuity_timers SET mailId = ? WHERE id = ?').run(mailId, id); };
const invariantLatches = (db: DatabaseSync) => {
  const r = ladderRows(db);
  if (r.kind !== 'measured') throw new Error('ladder unmeasured');
  return r.standing.filter((l) => l.cause === 'invariant-violation');
};

interface Rig {
  db: DatabaseSync; monitor: InvariantMonitor; log: string[];
  st: { armed: boolean; mono: number; wall: number; raises: number; refuseNext: number; failRecordNext: number; gathers: number; gather: (() => InvariantInput) | null };
}
const rig = (): Rig => {
  const db = openCoordDb(path.join(mkTmp('ccrc-invariant-lane-'), '.ccrc', 'coord.db'));
  opened.push(db);
  const st: Rig['st'] = { armed: false, mono: 1000, wall: NOW, raises: 0, refuseNext: 0, failRecordNext: 0, gathers: 0, gather: null };
  const log: string[] = [];
  let seq = 0;
  const journal = { appendInTx: () => ({ ok: true, kind: 'appended', record: { sequence: ++seq } }) } as unknown as AuthorityAppender;
  let opKeys = 0;
  const coordLike = { raiseLatch: (j: AuthorityAppender, latch: Parameters<typeof raiseLatchInTx>[2]) => tx(db, () => raiseLatchInTx(db, j, latch)) };
  const real = (detail: string) => raiseLatch(
    { coord: coordLike as never, journal, clock: { wall: () => st.wall }, entropy: { hex: () => String(++opKeys).padStart(8, '0') }, causeTable: undefined },
    'invariant-violation', detail, serverActorOf('invariants'));
  const deps: InvariantMonitorDeps = {
    armed: () => st.armed,
    head: () => {
      const r = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'overlord_sequence'").get() as { seq: number } | undefined;
      return { kind: 'measured', value: r === undefined ? 0 : Number(r.seq) };
    },
    gather: () => {
      st.gathers += 1;
      return st.gather !== null ? st.gather() : gatherInvariantInput({
        db, readJournal: () => ({ kind: 'absent' }), guardState: () => ({ kind: 'coherent' }), designationBaseline: () => ({ kind: 'measured', value: null }),
      });
    },
    open: (mode) => openFindings(db, mode),
    record: (f, mode, live, at) => {
      if (st.failRecordNext > 0) { st.failRecordNext -= 1; return { ok: false, error: 'a fixture write failure' }; }
      return recordFinding(db, f, mode, live, at);
    },
    resolve: (ids, at) => resolveFindings(db, ids, at),
    raiseLatch: (detail) => {
      if (st.refuseNext > 0) { st.refuseNext -= 1; return { ok: false }; }
      st.raises += 1;
      const r = real(detail);
      if (!r.ok) return { ok: false };
      return r.changed ? { ok: true, changed: true, journalled: r.journalled } : { ok: true, changed: false };
    },
    clock: { wall: () => st.wall, mono: () => st.mono },
    tableSweepMs: SWEEP,
    log: (l) => { log.push(l); },
  };
  return { db, monitor: new InvariantMonitor(deps), log, st };
};
/** Advance the monotonic clock past the table cadence and run a pass. */
const later = (r: Rig): void => { r.st.mono += SWEEP; r.st.wall += SWEEP; r.monitor.pass(); };
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM overlord_invariant_findings ORDER BY id').all() as Record<string, unknown>[];

describe('InvariantMonitor', () => {
  it('shadow: a planted I17 violation records one shadow finding and raises no latch and no item', () => {
    const r = rig();
    const t = firedTimer(r.db, 'lane-a', true);
    r.monitor.pass();
    const all = rows(r.db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ invariant: 'I17', subject: `timer:${t.id}`, mode: 'shadow', itemId: null, latched: null, resolvedAt: null });
    expect(r.st.raises).toBe(0);
    expect(invariantLatches(r.db)).toEqual([]);
    expect(count(r.db, 'operator_items')).toBe(0);
    later(r);
    expect(rows(r.db)).toHaveLength(1);
  });

  it('live: raises the advise latch and one blocking item; a later pass raises nothing new', () => {
    const r = rig();
    r.st.armed = true;
    const t = firedTimer(r.db, 'lane-a', true);
    r.monitor.pass();
    const latches = invariantLatches(r.db);
    expect(latches).toHaveLength(1);
    expect(latches[0]).toMatchObject({ cause: 'invariant-violation', cap: 'advise' });
    expect(count(r.db, 'operator_items')).toBe(1);
    const item = r.db.prepare('SELECT program, neededBy, raisedBy, kind FROM operator_items').get();
    expect(item).toMatchObject({ program: 'overlord', neededBy: 'blocking', raisedBy: 'ccrc', kind: 'do' });
    const all = rows(r.db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ subject: `timer:${t.id}`, mode: 'live', latched: 'raised' });
    expect(all[0]?.itemId).not.toBeNull();
    const raises = r.st.raises;
    later(r);
    expect(r.st.raises).toBe(raises);
    expect(count(r.db, 'operator_items')).toBe(1);
    expect(rows(r.db)).toHaveLength(1);
    expect(invariantLatches(r.db)).toHaveLength(1);
  });

  it('live: a second, different violation raises a second item and its row reads standing', () => {
    const r = rig();
    r.st.armed = true;
    firedTimer(r.db, 'lane-a', true);
    r.monitor.pass();
    const second = firedTimer(r.db, 'lane-b', true);
    later(r);
    expect(count(r.db, 'operator_items')).toBe(2);
    const all = rows(r.db);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ subject: `timer:${second.id}`, mode: 'live', latched: 'standing' });
    expect(all[0]).toMatchObject({ latched: 'raised' });
    expect(invariantLatches(r.db)).toHaveLength(1);
  });

  it('a refused latch records no live finding, and the very next pass retries with the real raise (no clock advance, review 3843 F8)', () => {
    const r = rig();
    r.st.armed = true;
    firedTimer(r.db, 'lane-a', true);
    r.st.refuseNext = 1;
    r.monitor.pass();
    expect(rows(r.db)).toEqual([]);
    expect(count(r.db, 'operator_items')).toBe(0);
    expect(invariantLatches(r.db)).toEqual([]);
    expect(r.log.some((l) => l.includes('latch was refused'))).toBe(true);
    r.monitor.pass(); // the same head, mode and clock: due only because the last pass failed
    expect(r.st.gathers).toBe(2);
    expect(rows(r.db)).toHaveLength(1);
    expect(count(r.db, 'operator_items')).toBe(1);
    expect(invariantLatches(r.db)).toHaveLength(1);
    r.monitor.pass(); // a pass that succeeded is remembered: nothing is due now
    expect(r.st.gathers).toBe(2);
  });

  it('a latch raised with its record lost stands with no finding; the very next pass records the finding against it as standing (F8, F10)', () => {
    const r = rig();
    r.st.armed = true;
    const t = firedTimer(r.db, 'lane-a', true);
    r.st.failRecordNext = 1;
    r.monitor.pass();
    expect(invariantLatches(r.db)).toHaveLength(1);
    expect(rows(r.db)).toEqual([]);
    expect(count(r.db, 'operator_items')).toBe(0);
    expect(r.log.some((l) => l.includes('recorded nothing for I17'))).toBe(true);
    r.monitor.pass(); // no clock advance
    expect(r.st.gathers).toBe(2);
    const all = rows(r.db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ subject: `timer:${t.id}`, mode: 'live', latched: 'standing' });
    expect(count(r.db, 'operator_items')).toBe(1);
    expect(invariantLatches(r.db)).toHaveLength(1);
  });

  it('a shadow record that failed is retried by the very next pass', () => {
    const r = rig();
    firedTimer(r.db, 'lane-a', true);
    r.st.failRecordNext = 1;
    r.monitor.pass();
    expect(rows(r.db)).toEqual([]);
    r.monitor.pass();
    expect(r.st.gathers).toBe(2);
    expect(rows(r.db)).toHaveLength(1);
    expect(r.st.raises).toBe(0);
  });

  it('repaired: the next pass resolves the finding; broken again it is a new finding and a new item', () => {
    const r = rig();
    r.st.armed = true;
    const t = firedTimer(r.db, 'lane-a', true);
    r.monitor.pass();
    expect(rows(r.db)[0]?.resolvedAt).toBeNull();
    setMail(r.db, t.id, t.good);
    later(r);
    expect(rows(r.db)).toHaveLength(1);
    expect(rows(r.db)[0]?.resolvedAt).not.toBeNull();
    expect(count(r.db, 'operator_items')).toBe(1);
    setMail(r.db, t.id, t.wrong);
    later(r);
    const all = rows(r.db);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ subject: `timer:${t.id}`, resolvedAt: null, latched: 'standing' });
    expect(all[1]?.itemId).not.toBe(all[0]?.itemId);
    expect(count(r.db, 'operator_items')).toBe(2);
  });

  it('shadow to live with an open shadow finding records a live finding for the same subject and leaves the shadow row', () => {
    const r = rig();
    const t = firedTimer(r.db, 'lane-a', true);
    r.monitor.pass();
    const shadowBefore = rows(r.db)[0];
    r.st.armed = true;
    r.monitor.pass(); // a mode change is due at once, with no clock advance
    const all = rows(r.db);
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual(shadowBefore);
    expect(all[1]).toMatchObject({ subject: `timer:${t.id}`, mode: 'live', latched: 'raised' });
    expect(count(r.db, 'operator_items')).toBe(1);
    expect(invariantLatches(r.db)).toHaveLength(1);
  });

  it('an unreadable arming reads shadow (nothing raised), and the seeded invariants row reads shadow', () => {
    const r = rig();
    const seed = r.db.prepare('SELECT choice FROM lane_arm_settings WHERE lane = ?').get(INVARIANTS_LANE) as { choice: string };
    expect(seed.choice).toBe('shadow');
    r.st.armed = false;
    firedTimer(r.db, 'lane-a', true);
    r.monitor.pass();
    expect(r.st.raises).toBe(0);
    expect(count(r.db, 'operator_items')).toBe(0);
    expect(rows(r.db)[0]).toMatchObject({ mode: 'shadow' });
  });

  it('an unmeasured input raises nothing even armed, and last() shows I17 unmeasured', () => {
    const r = rig();
    r.st.armed = true;
    const un = { kind: 'unmeasured', why: 'x' } as const;
    r.st.gather = () => ({ lines: un, facts: { I2: un, I5: un, I7: un, I17: un } });
    firedTimer(r.db, 'lane-a', true);
    r.monitor.pass();
    expect(r.st.raises).toBe(0);
    expect(invariantLatches(r.db)).toEqual([]);
    expect(count(r.db, 'operator_items')).toBe(0);
    expect(rows(r.db)).toEqual([]);
    expect(r.monitor.last()?.verdicts.get('I17')).toEqual({ kind: 'unmeasured', why: 'x' });
  });

  it('skips the gather while the head, mode and cadence are unchanged; runs it on a moved head, an elapsed cadence or a mode change', () => {
    const r = rig();
    r.monitor.pass();
    expect(r.st.gathers).toBe(1);
    r.st.mono += SWEEP - 1;
    r.monitor.pass();
    expect(r.st.gathers).toBe(1);
    r.st.mono += 1;
    r.monitor.pass();
    expect(r.st.gathers).toBe(2);
    r.st.armed = true;
    r.monitor.pass();
    expect(r.st.gathers).toBe(3);
    r.monitor.pass();
    expect(r.st.gathers).toBe(3);
  });

  it('a moved sequence head runs the gather before the cadence elapses', () => {
    const r = rig();
    r.monitor.pass();
    expect(r.st.gathers).toBe(1);
    // the fixture head reader reads sqlite_sequence, so move it directly
    r.db.exec("INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('overlord_sequence', 7)");
    r.st.mono += 1;
    r.monitor.pass();
    expect(r.st.gathers).toBe(2);
  });

  it('last() is null before the first pass, then carries the mode and a verdict for every invariant; the log writes on a word change only', () => {
    const r = rig();
    expect(r.monitor.last()).toBeNull();
    r.monitor.pass();
    const last = r.monitor.last();
    expect(last?.mode).toBe('shadow');
    expect([...(last?.verdicts.keys() ?? [])].sort()).toEqual([...INVARIANT_NAMES].sort());
    expect(r.log.some((l) => l.includes('invariant I17 reads holds (was nothing), shadow'))).toBe(true);
    const lines = r.log.length;
    later(r);
    expect(r.log.length).toBe(lines);
    firedTimer(r.db, 'lane-a', true);
    later(r);
    expect(r.log.slice(lines).filter((l) => l.includes('invariant I17 reads violated (was holds)'))).toHaveLength(1);
    expect(r.monitor.last()?.verdicts.get('I17')?.kind).toBe('violated');
  });

  it('findingCounts sees the lane\'s shadow and live rows apart', () => {
    const r = rig();
    firedTimer(r.db, 'lane-a', true);
    r.monitor.pass();
    r.st.armed = true;
    r.monitor.pass();
    const c = findingCounts(r.db);
    expect(c.kind === 'measured' && [c.value.shadow.total, c.value.live.total]).toEqual([1, 1]);
  });
});

/** The production monitor, as `index.ts` builds it (`invariantMonitorOver`), over a migrated temp database and a stub journal: the
 *  arming binding is the one read that keeps a merged box in shadow (review 3843 F1). */
const overRig = () => {
  const db = openCoordDb(path.join(mkTmp('ccrc-invariant-over-'), '.ccrc', 'coord.db'));
  opened.push(db);
  const coord = new CoordStore(db);
  let seq = 0;
  const journal = { appendInTx: () => ({ ok: true, kind: 'appended', record: { sequence: ++seq } }) } as unknown as AuthorityAppender;
  let keys = 0;
  const monitor = invariantMonitorOver({
    db, coord, journal, readJournal: () => ({ kind: 'absent' }), guardState: () => ({ kind: 'coherent' }),
    designationBaseline: () => ({ kind: 'measured', value: null }),
    clock: { wall: () => NOW, mono: () => 1000 }, entropy: { hex: (n: number) => String(++keys).padStart(n * 2, '0') }, log: () => {},
  });
  firedTimer(db, 'lane-a', true);
  const setChoice = (lane: string, choice: string): void => {
    db.prepare('INSERT INTO lane_arm_settings (lane, choice, updatedAt) VALUES (?, ?, 1) ON CONFLICT(lane) DO UPDATE SET choice = excluded.choice').run(lane, choice);
  };
  const raisedNothing = (): void => {
    expect(invariantLatches(db)).toEqual([]);
    expect(count(db, 'operator_items')).toBe(0);
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ mode: 'shadow', latched: null, itemId: null });
  };
  return { db, monitor, setChoice, raisedNothing };
};

describe('invariantMonitorOver: the arming binding over the real Shadow lanes row (review 3843 F1)', () => {
  it('the seeded invariants row (shadow) raises nothing', () => {
    const o = overRig();
    expect(o.db.prepare('SELECT choice FROM lane_arm_settings WHERE lane = ?').get(INVARIANTS_LANE)).toEqual({ choice: 'shadow' });
    o.monitor.pass();
    o.raisedNothing();
  });
  it('every other lane set live, the invariants row still shadow: raises nothing', () => {
    const o = overRig();
    for (const lane of LANE_ARM_LANES) if (lane !== INVARIANTS_LANE) o.setChoice(lane, 'live');
    o.monitor.pass();
    o.raisedNothing();
  });
  it('a stored word this build cannot name raises nothing', () => {
    const o = overRig();
    o.setChoice(INVARIANTS_LANE, 'Live');
    o.monitor.pass();
    o.raisedNothing();
  });
  it('an absent row raises nothing', () => {
    const o = overRig();
    o.db.prepare('DELETE FROM lane_arm_settings WHERE lane = ?').run(INVARIANTS_LANE);
    o.monitor.pass();
    o.raisedNothing();
  });
  it('an unreadable row raises nothing', () => {
    const o = overRig();
    o.db.exec('ALTER TABLE lane_arm_settings RENAME TO lane_arm_settings_gone');
    o.monitor.pass();
    o.raisedNothing();
  });
  it('a live invariants row raises the latch and one blocking item', () => {
    const o = overRig();
    o.setChoice(INVARIANTS_LANE, 'live');
    o.monitor.pass();
    expect(invariantLatches(o.db)).toHaveLength(1);
    expect(count(o.db, 'operator_items')).toBe(1);
    expect(rows(o.db)[0]).toMatchObject({ mode: 'live', latched: 'raised' });
  });
});

describe('the ladder\'s invariant-violation row (Table 7.5a; the seams case, here because the seams file is another run\'s)', () => {
  it('is a latch capping advise with one item as its notice, and a standing one reads at most advise through the shipped table', () => {
    expect(LADDER_CAUSE_MAP['invariant-violation']).toMatchObject({ kind: 'latch', effect: { kind: 'cap', cap: 'advise' }, notice: 'item' });
    const facts = { operatorRung: { kind: 'set', rung: 'full' }, latches: [{ cause: 'invariant-violation', cap: 'advise' }], conditions: [],
      causeTable: LADDER_CAUSE_MAP, serverCaps: ['overlord-route-v1', 'overlord-answer-v1'] } as const;
    expect(effectiveRung(facts)).toMatchObject({ rung: 'advise', binding: [{ cause: 'invariant-violation', kind: 'latch', cap: 'advise', known: true }] });
    expect(effectiveRung({ ...facts, operatorRung: { kind: 'set', rung: 'chat' } })).toMatchObject({ rung: 'chat' });
  });
});

describe('FleetWatcher.sweepInvariants: the lane through its row (slug invariant-monitor-built-in-the-composition-root)', () => {
  it('with no monitor wired (a test, a script), the sweep returns: no pass runs and nothing reads as a pass', async () => {
    const home = mkTmp('ccrc-invariants-w-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock({ ...testDeps(home), time: fakeTime({ wallMs: 1_800_000_000_000 }).ports }), new Bus(), 2000));
    await expect(w.sweepInvariants()).resolves.toBeUndefined();
  });
  it('with a monitor wired, one sweep runs one pass, handed the watcher\'s item reach', async () => {
    const home = mkTmp('ccrc-invariants-w-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const calls: unknown[] = [];
    const monitor = { pass: (reach?: unknown) => { calls.push(reach); }, last: () => null } as unknown as InvariantMonitor;
    const w = quietAtTestEnd(new FleetWatcher(withFakeClock({ ...testDeps(home), time: fakeTime({ wallMs: 1_800_000_000_000 }).ports,
      invariantMonitor: monitor }), new Bus(), 2000));
    await w.sweepInvariants();
    expect(calls).toHaveLength(1);
    expect(typeof calls[0]).toBe('function');
  });
});
