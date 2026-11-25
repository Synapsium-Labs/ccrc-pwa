// Overlord W1, the invariant monitor's gatherer (plan w1-sequence-monitor.md Task 5): `gatherInvariantInput` reads every input of
// I2, I5, I7 and I17 in one synchronous span inside one transaction that writes nothing, and never folds `unmeasured` into
// `measured` or `absent`. Fixture databases in temp dirs only, never the live HOME.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { gatherInvariantInput, type InvariantFactsDeps } from '../src/coord/invariantFacts.js';
import { invariantVerdict, type InvariantInput } from '../src/coord/invariants.js';
import { tx } from '../src/coord/tx.js';
import { stampReach } from '../src/coord/pushOutboxStore.js';
import { cancelTimer, insertTimer, markTimersFired } from '../src/continuity/continuityStore.js';
import { packTimerMail } from '../src/continuity/timers.js';
import { MAIL_SUBJECT_MAX_BYTES } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { GEN1, S1, designateLive, restoreRigHooks, rig, rung } from './overlordRestoreRig.js';

restoreRigHooks();

const NOW = 1_800_000_000_000;
const opened: DatabaseSync[] = [];
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* closed */ } } });

const openDb = (): DatabaseSync => {
  const db = openCoordDb(path.join(mkTmp('ccrc-invariant-facts-'), '.ccrc', 'coord.db'));
  opened.push(db);
  return db;
};
const depsOf = (db: DatabaseSync, over: Partial<InvariantFactsDeps> = {}): InvariantFactsDeps => ({
  db,
  readJournal: () => ({ kind: 'absent' }),
  guardState: () => ({ kind: 'coherent' }),
  designationBaseline: () => ({ kind: 'measured', value: null }),
  ...over,
});
const NAMES = ['I2', 'I5', 'I7', 'I17'] as const;

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

describe('gatherInvariantInput', () => {
  it('an empty migrated database: every arm is measured, and I2, I5, I7 and I17 hold', () => {
    const db = openDb();
    const input = gatherInvariantInput(depsOf(db));
    expect(input.lines.kind).toBe('measured');
    for (const n of NAMES) expect(input.facts[n]?.kind, n).toBe('measured');
    for (const n of NAMES) expect(invariantVerdict(n, input), n).toEqual({ kind: 'holds' });
  });

  it('an absent table reads absent naming it, and its row answers not-applicable (tables-absent)', () => {
    const db = openDb();
    db.exec('DROP TABLE continuity_timers');
    const input = gatherInvariantInput(depsOf(db));
    expect(input.facts.I17).toEqual({ kind: 'absent', what: 'continuity_timers' });
    expect(invariantVerdict('I17', input)).toMatchObject({ kind: 'not-applicable', why: 'tables-absent' });
    expect(input.lines.kind).toBe('measured');
    for (const n of ['I2', 'I5', 'I7'] as const) expect(input.facts[n]?.kind, n).toBe('measured');
  });

  it('a closed database reads unmeasured on every arm and does not throw', () => {
    const db = openDb();
    db.close();
    let input: InvariantInput | undefined;
    expect(() => { input = gatherInvariantInput(depsOf(db)); }).not.toThrow();
    expect(input!.lines.kind).toBe('unmeasured');
    for (const n of NAMES) expect(input!.facts[n]?.kind, n).toBe('unmeasured');
  });

  it('an unmeasured baseline makes the I5 arm unmeasured and only it', () => {
    const db = openDb();
    const input = gatherInvariantInput(depsOf(db, { designationBaseline: () => ({ kind: 'unmeasured', why: 'a fixture read failure' }) }));
    expect(input.facts.I5).toMatchObject({ kind: 'unmeasured' });
    expect(invariantVerdict('I5', input).kind).toBe('unmeasured');
    expect(input.lines.kind).toBe('measured');
    for (const n of ['I2', 'I7', 'I17'] as const) expect(input.facts[n]?.kind, n).toBe('measured');
  });

  it('a journal that could not be read makes the I7 arm unmeasured, and only it (review 3843 F10)', () => {
    const db = openDb();
    const input = gatherInvariantInput(depsOf(db, { readJournal: () => ({ kind: 'unmeasured', why: 'unreadable' }) }));
    expect(input.facts.I7).toEqual({ kind: 'unmeasured', why: 'the authority journal could not be read' });
    expect(invariantVerdict('I7', input)).toEqual({ kind: 'unmeasured', why: 'the authority journal could not be read' });
    for (const n of ['I2', 'I5', 'I17'] as const) expect(input.facts[n]?.kind, n).toBe('measured');
  });

  it('a malformed journal makes the I7 arm unmeasured with its code, never a fold of what it could read (review 3843 F10)', () => {
    const db = openDb();
    const input = gatherInvariantInput(depsOf(db, { readJournal: () => ({ kind: 'malformed', code: 'chain-broken', detail: 'a fixture', lines: 3 }) }));
    expect(input.facts.I7).toEqual({ kind: 'unmeasured', why: 'the authority journal is malformed: chain-broken' });
    expect(invariantVerdict('I7', input).kind).toBe('unmeasured');
    for (const n of ['I2', 'I5', 'I17'] as const) expect(input.facts[n]?.kind, n).toBe('measured');
  });

  it('every read happens in one synchronous span inside a transaction, and the gather writes nothing', async () => {
    const db = openDb();
    const count = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
    const totals = (): number[] => [
      count('SELECT total_changes() AS n'), count('SELECT COUNT(*) AS n FROM overlord_sequence'), count('SELECT COUNT(*) AS n FROM continuity_timers'),
    ];
    const before = totals();
    let turned = false;
    const seen: { inTx: boolean; turned: boolean }[] = [];
    queueMicrotask(() => { turned = true; });
    const spy = <T,>(v: T) => (): T => { seen.push({ inTx: db.isTransaction, turned }); return v; };
    const input = gatherInvariantInput(depsOf(db, {
      readJournal: spy({ kind: 'absent' } as const),
      guardState: spy({ kind: 'coherent' } as const),
    }));
    expect(turned).toBe(false);
    expect(seen).toHaveLength(2);
    for (const s of seen) expect(s).toEqual({ inTx: true, turned: false });
    expect(input.facts.I7?.kind).toBe('measured');
    await Promise.resolve();
    expect(turned).toBe(true);
    expect(db.isTransaction).toBe(false);
    expect(totals()).toEqual(before);
  });

  it('I17 through the real writers: a fired timer whose mail is to its setter holds; a mail to another session violates', () => {
    const db = openDb();
    const ids = [timer(db, 'lane-a'), timer(db, 'lane-a'), timer(db, 'lane-a')];
    const m = mail(db, 'timer', 'lane-a');
    tx(db, () => markTimersFired(db, ids, m, NOW + 5));
    expect(invariantVerdict('I17', gatherInvariantInput(depsOf(db)))).toEqual({ kind: 'holds' });

    const bad = timer(db, 'lane-a');
    const wrong = mail(db, 'timer', 'lane-b');
    tx(db, () => markTimersFired(db, [bad], wrong, NOW + 6));
    const v = invariantVerdict('I17', gatherInvariantInput(depsOf(db)));
    expect(v.kind).toBe('violated');
    if (v.kind === 'violated') expect(v.findings.map((f) => f.subject)).toEqual([`timer:${bad}`]);

    // a cancelled timer with no mail stays fine
    const c = timer(db, 'lane-a');
    expect(tx(db, () => cancelTimer(db, c, 'setter-cancel', 'setter', NOW + 7))).toEqual({ changed: true });
    const v2 = invariantVerdict('I17', gatherInvariantInput(depsOf(db)));
    if (v2.kind === 'violated') expect(v2.findings.map((f) => f.subject)).toEqual([`timer:${bad}`]);
  });

  it('I17 through the timer lane\'s own mail: a subject cut by the subject limit still holds, since no subject is read (review 3843 F10)', () => {
    const db = openDb();
    // Ids of seven digits, so the lane's subject for one mail cuts well before the last id.
    tx(db, () => { db.prepare('UPDATE continuity_timers SET id = 999999 WHERE id = ?').run(timer(db, 'lane-a')); });
    const ids = Array.from({ length: 24 }, () => timer(db, 'lane-a'));
    const due = ids.map((id) => ({ id, setter: 'lane-a', dueAt: NOW + 1000, note: 'n', setAt: NOW, setById: 'lane-a', runId: null, programme: null }));
    const [first] = packTimerMail(due, NOW + 2000);
    expect(first!.ids).toEqual(ids);
    expect(Buffer.byteLength(first!.subject)).toBeLessThanOrEqual(MAIL_SUBJECT_MAX_BYTES);
    expect(first!.subject).toContain('…');
    expect(first!.subject).not.toContain(String(ids.at(-1)));
    const m = Number(db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (?, 'timer', 'u', 'lane-a', NULL, 'status', ?, ?)")
      .run(NOW + 2000, first!.subject, first!.body).lastInsertRowid);
    tx(db, () => markTimersFired(db, first!.ids, m, NOW + 2000));
    expect(invariantVerdict('I17', gatherInvariantInput(depsOf(db)))).toEqual({ kind: 'holds' });
  });

  it('I2 through stampReach: a reach-stamped ask with no bound outbox row is violated', () => {
    const db = openDb();
    const id = Number(db.prepare(
      "INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state) VALUES (?, 'lane-a-project-a', "
      + "'lane-b-project-a', NULL, 'k', ?, 'd', 'Proceed?', '[\"Yes\",\"No\"]', 'held')").run(NOW, NOW).lastInsertRowid);
    expect(invariantVerdict('I2', gatherInvariantInput(depsOf(db)))).toEqual({ kind: 'holds' });
    expect(tx(db, () => stampReach(db, 'ask', id, NOW))).toEqual({ changed: true });
    const v = invariantVerdict('I2', gatherInvariantInput(depsOf(db)));
    expect(v.kind).toBe('violated');
    if (v.kind === 'violated') expect(v.findings.map((f) => f.subject)).toEqual([`ask:${id}`]);
  });
});

describe('I7 over the restore rig', () => {
  it('holds when the rows match the journal, is violated by a rung written without a record, and is unmeasured while the guard is not coherent', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'advise')).toMatchObject({ ok: true, journalled: true });
    const over = { db: r.db, readJournal: () => r.journal.readVerified(), guardState: () => r.guard.state() };
    expect(invariantVerdict('I7', gatherInvariantInput(depsOf(r.db, over)))).toEqual({ kind: 'holds' });

    r.db.exec("UPDATE overlord_ladder SET operatorRung = 'full'");
    const v = invariantVerdict('I7', gatherInvariantInput(depsOf(r.db, over)));
    expect(v.kind).toBe('violated');
    if (v.kind === 'violated') expect(v.findings.map((f) => f.subject)).toEqual(['operatorRung']);

    const rolled = invariantVerdict('I7', gatherInvariantInput(depsOf(r.db, { ...over, guardState: () => ({ kind: 'rolled-back', cause: 'trailing' }) })));
    expect(rolled.kind).toBe('unmeasured');
  });
});
