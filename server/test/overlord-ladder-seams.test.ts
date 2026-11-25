import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { gateActorOf } from '../src/accounts/audit.js';
const ladderActor = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) }).operator(gateActorOf('actor', ''));
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { raiseLatch, ladderRead } from '../src/coord/overlordLadderRead.js';
import { effectiveRung } from '../src/coord/overlordLadder.js';
import { LADDER_CAUSE_MAP } from '../../shared/overlord-ladder.js';
import { applyRestoreInTx } from '../src/coord/overlordLadderStore.js';
import { tx } from '../src/coord/db.js';
import type { AuthorityAppender } from '../src/coord/overlordDesignationStore.js';
import path from 'node:path';
import { sources, ccrcRoot } from './single-definition/helpers.js';
import { sqlWrites, tableRefSource } from './single-definition/sqlStatements.js';
import { parseFile, parseSource, ts } from './scan/parse.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const causes = { 'restore-detected': { kind: 'latch', effect: { kind: 'cap', cap: 'chat' }, notice: 'push', spec: 'fixture' } } as const;

// `sqlWrites` locates each table statement and its enclosing function. Inspect its column list and assignments,
// including SQLite's quoted identifiers; a sequence-only UPDATE must not be mistaken for a rung change.
const rungIdentifier = '(?:operatorRung|"operatorRung"|`operatorRung`|\\[operatorRung\\])';
const insertColumns = new RegExp(`\\b(?:insert(?:\\s+or\\s+\\w+)?|replace)\\s+into\\s+${tableRefSource('overlord_ladder')}\\s*(?:\\(([^)]*)\\))?`, 'i');
const rungColumn = new RegExp(`^\\s*${rungIdentifier}\\s*$`, 'i');
const assignRung = new RegExp(`(?:\\bset\\s+|,\\s*)${rungIdentifier}\\s*=`, 'i');
const changesRung = (sql: string): boolean => {
  const insert = insertColumns.exec(sql);
  return (insert !== null && (insert[2] === undefined || insert[2].split(',').some((col) => rungColumn.test(col)))) || assignRung.test(sql);
};

// The dependency is optional and fails closed, so a typecheck cannot prove either connection. Read source only.
describe('ladder isolation wiring', () => {
  it('assigns the reader before building the server with those deps', () => {
    const source = readFileSync(path.join(ccrcRoot, 'server/src/index.ts'), 'utf8');
    const statements = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true).statements.map((s) => s.getText());
    const assignment = statements.findIndex((s) => /^deps\.isolation\s*=\s*wireIsolation\s*\(/.test(s));
    const build = statements.findIndex((s) => /^const app\s*=\s*await buildServer\s*\(\s*deps\s*,/.test(s));
    expect(assignment, 'index.ts assigns the isolation reader').toBeGreaterThanOrEqual(0);
    expect(build, 'buildServer receives the assigned deps').toBeGreaterThan(assignment);
  });

  it('passes the reader into the ladder inputs in buildServer', () => {
    const source = readFileSync(path.join(ccrcRoot, 'server/src/server.ts'), 'utf8');
    const { calls, symbols } = parseSource(source, 'server.ts');
    const build = symbols.find((s) => s.name === 'buildServer' && s.kind === 'function');
    const inputs = calls.filter((c) => build && c.start > build.start && c.end < build.end
      && c.boundTo === 'ladderDeps' && c.callee === 'ladderConditionInputs');
    expect(inputs).toHaveLength(1);
    const arg = inputs[0]!.argSpans[0];
    const [statement] = ts.createSourceFile('inputs.ts', `const inputs = ${arg ? source.slice(arg.start, arg.end) : 'undefined'};`, ts.ScriptTarget.Latest, true).statements;
    const object = statement && ts.isVariableStatement(statement) ? statement.declarationList.declarations[0]?.initializer : undefined;
    const reader = object && ts.isObjectLiteralExpression(object) ? object.properties.find((p) => p.name?.getText() === 'isolation') : undefined;
    expect(reader && ts.isPropertyAssignment(reader) ? reader.initializer.getText() : undefined,
      'ladderConditionInputs receives deps.isolation').toBe('deps.isolation');
  });
});

describe('ladder latch seam', () => {
  it('pins the two rung-value writers, not the sequence stamp', () => {
    expect(changesRung('UPDATE overlord_ladder SET recordSequence = ?, recordFrom = NULL')).toBe(false);
    expect(changesRung('UPDATE overlord_ladder SET actor = ?, operatorRung = ?')).toBe(true);
    expect(changesRung('UPDATE overlord_ladder SET "operatorRung" = ?')).toBe(true);
    expect(changesRung('UPDATE main."overlord_ladder" SET [actor] = ?, `operatorRung` = ?')).toBe(true);
    expect(changesRung('INSERT INTO overlord_ladder (id, "operatorRung") VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET "operatorRung" = excluded."operatorRung"')).toBe(true);
    expect(changesRung('INSERT INTO overlord_ladder (id, operatorRung) VALUES (1, ?)')).toBe(true);
    expect(changesRung('INSERT INTO overlord_ladder VALUES (1, ?)')).toBe(true);
    expect(changesRung('INSERT INTO overlord_ladder (id, actor) VALUES (1, ?)')).toBe(false);
    const writes = sqlWrites(sources(path.join(ccrcRoot, 'server', 'src')), ['overlord_ladder']).filter((w) => changesRung(w.sql));
    expect([...new Set(writes.map((w) => w.writer))].sort()).toEqual([
      'server/src/coord/overlordLadderStore.ts#applyRestoreInTx', 'server/src/coord/overlordLadderStore.ts#setRungInTx',
    ]);
  });
  it('catches a quoted rung assignment inside the allowed sequence stamper', () => {
    const original = parseFile(path.join(ccrcRoot, 'server/src/coord/overlordLadderStore.ts')).text;
    const needle = 'UPDATE overlord_ladder SET recordSequence = ?, recordFrom = NULL WHERE id = 1 AND recordSequence IS NULL';
    expect(original.split(needle)).toHaveLength(2);
    const dir = mkTmp('ladder-writer-mutant-'); const file = path.join(dir, 'mutant.ts');
    try {
      writeFileSync(file, original.replace(needle, 'UPDATE overlord_ladder SET recordSequence = ?, "operatorRung" = ?, recordFrom = NULL WHERE id = 1 AND recordSequence IS NULL'));
      const offenders = sqlWrites([file], ['overlord_ladder']).filter((w) => changesRung(w.sql));
      expect(offenders.some((w) => w.writer.endsWith('#journalPendingInTx'))).toBe(true);
    } finally { removeTmpFixtures(); }
  });
  it('a fixture latch and condition apply without another decision mechanism', () => {
    const table = { ...causes, 'condition-a': { kind: 'condition', effect: { kind: 'cap', cap: 'off' }, notice: 'none', spec: 'fixture' } } as const;
    const facts = { operatorRung: { kind: 'set', rung: 'full' }, latches: [{ cause: 'restore-detected', cap: 'chat' }], conditions: [{ cause: 'condition-a', reading: 'standing' }], causeTable: table, serverCaps: [] } as const;
    expect(effectiveRung(facts)).toMatchObject({ rung: 'off', binding: [{ cause: 'condition-a', known: true }] });
    expect(effectiveRung({ ...facts, conditions: [{ cause: 'condition-a', reading: 'lifted' }] })).toMatchObject({ rung: 'chat', binding: [{ cause: 'restore-detected', known: true }] });
  });
  it("the isolation word's row is a condition capping advise with notice none, through the shipped table", () => {
    const facts = { operatorRung: { kind: 'set', rung: 'full' }, latches: [], conditions: [{ cause: 'shared-user', reading: 'standing' }],
      causeTable: LADDER_CAUSE_MAP, serverCaps: ['overlord-route-v1', 'overlord-answer-v1'] } as const;
    expect(LADDER_CAUSE_MAP['shared-user']).toMatchObject({ kind: 'condition', effect: { kind: 'cap', cap: 'advise' }, notice: 'none' });
    expect(effectiveRung(facts)).toMatchObject({ rung: 'advise', binding: [{ cause: 'shared-user', kind: 'condition', cap: 'advise', known: true }] });
  });
  it('Confirm stamps pending rows, preserves earlier records and adds the stricter side', () => {
    const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'advise', 'actor', 1, NULL, 'full', 1)");
    db.exec("INSERT INTO overlord_latches (cause,cap,detail,raisedAt,raisedBy,raiseSequence) VALUES ('latch-a','chat','a',1,'actor',NULL), ('latch-b','advise','b',1,'actor',3)");
    const events: string[] = [];
    const appendConfirm = (): number => {
      expect(db.isTransaction).toBe(true);
      expect(db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'advise' });
      events.push('append-confirm'); return 9;
    };
    tx(db, () => { const sequence = appendConfirm(); events.push('restore'); applyRestoreInTx(db, { operatorRung: 'off', latches: [{ cause: 'latch-c', cap: 'chat' }] }, sequence, 10); });
    expect(events).toEqual(['append-confirm', 'restore']);
    expect(db.prepare('SELECT operatorRung,recordSequence FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off', recordSequence: 9 });
    expect(db.prepare('SELECT cause,cap,raiseSequence FROM overlord_latches ORDER BY cause').all()).toEqual([
      { cause: 'latch-a', cap: 'chat', raiseSequence: 9 }, { cause: 'latch-b', cap: 'advise', raiseSequence: 3 }, { cause: 'latch-c', cap: 'chat', raiseSequence: 9 },
    ]);
    const coord = new CoordStore(db);
    const read = ladderRead(coord, { 'generation-degraded': () => 'lifted', 'off-model': () => 'lifted', 'rung-word-missing': () => 'lifted', 'shared-user': () => 'lifted', 'load-past-95': () => 'lifted', 'launch-profile-unengaged': () => 'lifted', 'no-witness-since-boot': () => 'lifted' }, { heldFor: () => 'held' }, []);
    expect(read).toMatchObject({ kind: 'measured', lastChange: { narrowing: { state: 'done' } } });
    db.close();
  });
  it('a refused Confirm append never restores, and a later restore error rolls back the transaction', () => {
    const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'chat', 'actor', 1, NULL, 'advise', 1)");
    db.exec('CREATE TABLE confirm_fixture (sequence INTEGER)');
    let restores = 0;
    const confirm = (append: () => { ok: true; sequence: number } | { ok: false }) => tx(db, () => {
      const result = append();
      if (!result.ok) return result;
      restores++;
      applyRestoreInTx(db, { operatorRung: 'off', latches: [{ cause: 'Bad Cause', cap: 'chat' }] }, result.sequence, 10);
      return result;
    });
    expect(confirm(() => ({ ok: false }))).toEqual({ ok: false });
    expect(restores).toBe(0);
    expect(() => confirm(() => { expect(db.isTransaction).toBe(true); db.exec('INSERT INTO confirm_fixture VALUES (9)'); return { ok: true, sequence: 9 }; })).toThrow();
    expect(db.prepare('SELECT * FROM confirm_fixture').all()).toEqual([]);
    expect(db.prepare('SELECT operatorRung,recordSequence,recordFrom FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'chat', recordSequence: null, recordFrom: 'advise' });
    db.close();
  });
  it('Confirm writes off for the absent database side', () => {
    const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    tx(db, () => applyRestoreInTx(db, { operatorRung: 'off', latches: [] }, 9, 10));
    expect(db.prepare('SELECT operatorRung FROM overlord_ladder').get()).toMatchObject({ operatorRung: 'off' }); db.close();
  });
  it('restore detection remains through Confirm and clears only after coherence', () => {
    const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    const coord = new CoordStore(db); let coherent = false;
    const journal: AuthorityAppender = { appendInTx: (_db, entry) => coherent
      ? { ok: true, kind: 'appended', record: { sequence: 12 } } as any
      : entry.kind === 'authority-latch-raise' ? { ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'diverged' } } as any
        : { ok: false, error: 'authority-rolled-back', detail: 'fixture' } };
    const deps = { coord, journal, causeTable: causes, clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' } };
    expect(raiseLatch(deps, 'restore-detected', 'detail', ladderActor)).toMatchObject({ changed: true, journalled: false });
    expect(raiseLatch(deps, 'restore-detected', 'detail', ladderActor)).toMatchObject({ changed: false });
    expect(coord.clearLatch(journal, { cause: 'restore-detected', actor: ladderActor, at: 10, opKey: 'clear-a' })).toMatchObject({ ok: false, error: 'authority-rolled-back' });
    tx(db, () => applyRestoreInTx(db, { operatorRung: 'off', latches: [] }, 11, 10));
    expect(db.prepare('SELECT cap,raiseSequence,clearedAt FROM overlord_latches').get()).toMatchObject({ cap: 'chat', raiseSequence: 11, clearedAt: null });
    coherent = true;
    expect(coord.clearLatch(journal, { cause: 'restore-detected', actor: ladderActor, at: 10, opKey: 'clear-b' })).toMatchObject({ ok: true, changed: true, recordSequence: 12 });
    db.close();
  });
  it('uses the fixture table cap and notice and keeps a standing latch', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
    const coord = new CoordStore(db);
    const deps = { coord, causeTable: causes, clock: { wall: () => 10 }, entropy: { hex: () => 'abcd' },
      journal: { appendInTx: () => ({ ok: true as const, kind: 'row-only' as const, state: { kind: 'rolled-back' as const, cause: 'diverged' as const } }) } };
    expect(raiseLatch(deps, 'restore-detected', 'detail', ladderActor)).toMatchObject({ ok: true, changed: true, journalled: false, notice: 'push' });
    expect(db.prepare('SELECT cap FROM overlord_latches').get()).toMatchObject({ cap: 'chat' });
    expect(raiseLatch(deps, 'restore-detected', 'detail', ladderActor)).toMatchObject({ ok: true, changed: false });
    db.close();
  });
});
