// Overlord W1, authority journal plan Task 4 (PR A): the guard that holds `authority-rolled-back`
// (`server/src/coord/overlordAuthorityGuard.ts#OverlordAuthorityGuard`, L4) and the boot step that feeds it
// (`runOverlordAuthorityBoot`). Real journals under `mkTmp`, never the live HOME.
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from '../src/coord/schema.js';
import { tx } from '../src/coord/tx.js';
import { OVERLORD_AUTHORITY_BASENAME, OVERLORD_AUTHORITY_FORMAT, type OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';
import type { CoherenceVerdict } from '../src/coord/overlordAuthorityCoherence.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt } from '../src/coord/overlordAuthorityJournal.js';
import { OverlordAuthorityGuard, runOverlordAuthorityBoot, type AuthorityBootPort } from '../src/coord/overlordAuthorityGuard.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const HEAD_MIGRATION = MIGRATIONS.find((sql) => sql.includes('CREATE TABLE overlord_authority_head'))!;
const WIDEN: OverlordAuthorityMove = { kind: 'authority-rung', opKey: 'op-w', from: 'advise', to: 'full' };
const NARROW: OverlordAuthorityMove = { kind: 'authority-rung', opKey: 'op-n', from: 'full', to: 'advise' };
const COHERENT: CoherenceVerdict = { kind: 'coherent' };
/** A port whose heal finds nothing to heal: the guard's tests of its own states. */
const measuring = (measure: () => CoherenceVerdict): AuthorityBootPort => ({ healTornTail: () => ({ kind: 'no-tail' }), measure });

/** A server's worth of the journal over one directory and one database: built afresh, as a restart builds it. */
function boot(dir: string, db: DatabaseSync): { guard: OverlordAuthorityGuard; journal: OverlordAuthorityJournal; lines: string[] } {
  const file = overlordAuthorityFileAt(dir);
  let journal!: OverlordAuthorityJournal;
  const guard = new OverlordAuthorityGuard({ healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) });
  journal = new OverlordAuthorityJournal(file, { clock: fakeTime({ wallMs: Date.parse('2026-11-16T10:00:00.000Z') }).ports.clock }, guard);
  const lines: string[] = [];
  runOverlordAuthorityBoot({ healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) }, guard, (l) => lines.push(l));
  return { guard, journal, lines };
}
function fixture(): { dir: string; db: DatabaseSync; leaf: string } {
  const dir = mkTmp('ccrc-overlord-guard-');
  const db = new DatabaseSync(path.join(dir, 'coord.db'));
  db.exec(HEAD_MIGRATION);
  return { dir, db, leaf: path.join(dir, OVERLORD_AUTHORITY_BASENAME) };
}

describe('OverlordAuthorityGuard: its four inputs and its one holder', () => {
  it('reads unmeasured before the boot verdict: fail closed', () => {
    expect(new OverlordAuthorityGuard(measuring(() => COHERENT)).state()).toEqual({ kind: 'unmeasured', why: 'journal' });
  });
  it('a rolled-back state stays through remeasure() and a later bootVerdict, and leaves only by confirmed()', () => {
    const g = new OverlordAuthorityGuard(measuring(() => COHERENT));
    g.bootVerdict({ kind: 'rolled-back', cause: 'behind' });
    g.remeasure();
    g.bootVerdict(COHERENT);
    g.writerFailed('trailing');
    g.writerFailed('journal-unreadable');
    g.witnessRefused('witness-epoch');
    expect(g.state()).toEqual({ kind: 'rolled-back', cause: 'behind' });
    g.confirmed();
    expect(g.state()).toEqual(COHERENT);
  });
  it('an unmeasured state re-measures to what the file says, once a call; a coherent one is never re-measured', () => {
    let next: CoherenceVerdict = { kind: 'unmeasured', why: 'journal' };
    let asked = 0;
    const g = new OverlordAuthorityGuard(measuring(() => { asked++; return next; }));
    g.bootVerdict({ kind: 'unmeasured', why: 'rows' });
    g.remeasure();
    expect(g.state()).toEqual({ kind: 'unmeasured', why: 'journal' });
    next = COHERENT;
    g.remeasure();
    expect(g.state()).toEqual(COHERENT);
    g.remeasure();
    expect(asked).toBe(2);
    next = { kind: 'rolled-back', cause: 'ahead' };
    const h = new OverlordAuthorityGuard(measuring(() => next));
    h.bootVerdict({ kind: 'unmeasured', why: 'journal' });
    h.remeasure();
    expect(h.state()).toEqual({ kind: 'rolled-back', cause: 'ahead' });
  });
  it('writerFailed moves a coherent guard to rolled-back: trailing, and the next read sees it at once', () => {
    const g = new OverlordAuthorityGuard(measuring(() => COHERENT));
    g.bootVerdict(COHERENT);
    g.writerFailed('trailing');
    expect(g.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
  });
  it('writerFailed(unreadable) moves only a coherent guard, to unmeasured: journal; a cause moves an unmeasured one to rolled-back', () => {
    const g = new OverlordAuthorityGuard(measuring(() => COHERENT));
    g.bootVerdict(COHERENT);
    g.writerFailed('journal-unreadable');
    expect(g.state()).toEqual({ kind: 'unmeasured', why: 'journal' });
    g.writerFailed('journal-unreadable');
    expect(g.state()).toEqual({ kind: 'unmeasured', why: 'journal' });
    g.writerFailed('diverged');
    expect(g.state()).toEqual({ kind: 'rolled-back', cause: 'diverged' });
  });
});

describe('a restart: what is found again, and what is not (review F17)', () => {
  it('a rollback only a witness found is gone after a restart; one the file holds is found again', () => {
    const f = fixture();
    const first = boot(f.dir, f.db);
    tx(f.db, () => first.journal.appendInTx(f.db, WIDEN));
    first.guard.witnessRefused('witness-heads');
    expect(first.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
    expect(boot(f.dir, f.db).guard.state()).toEqual(COHERENT);

    // The writer's fence: a caller's row failed after the append, so the file is one record past the head row.
    const second = boot(f.dir, f.db);
    expect(() => tx(f.db, () => { second.journal.appendInTx(f.db, NARROW); throw new Error('the caller\'s row'); })).toThrow();
    expect(boot(f.dir, f.db).guard.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
  });
});

describe('runOverlordAuthorityBoot: the server starts whatever the verdict, and the guard reads it', () => {
  const cases: Array<[string, (f: ReturnType<typeof fixture>) => void, CoherenceVerdict]> = [
    ['a fresh box', () => undefined, COHERENT],
    ['missing', (f) => f.db.prepare(`INSERT INTO overlord_authority_head VALUES (1, 1, '${'a'.repeat(64)}', '${'b'.repeat(64)}', 0)`).run(),
      { kind: 'rolled-back', cause: 'missing' }],
    ['malformed', (f) => writeFileSync(f.leaf, 'not a record\n'), { kind: 'rolled-back', cause: 'malformed' }],
    ['unmeasured (journal)', (f) => { writeFileSync(`${f.leaf}.real`, ''); symlinkSync(`${f.leaf}.real`, f.leaf); }, { kind: 'unmeasured', why: 'journal' }],
    ['unmeasured (rows)', (f) => f.db.exec('DROP TABLE overlord_authority_head'), { kind: 'unmeasured', why: 'rows' }],
  ];
  it.each(cases)('%s', (_n, setUp, verdict) => {
    const f = fixture();
    setUp(f);
    const b = boot(f.dir, f.db);
    expect(b.guard.state()).toEqual(verdict);
    expect(b.lines.at(-1)).toMatch(/^ccrc-server: the Overlord authority journal reads /);
  });
  it('a torn tail behind a sound prefix is healed first, so the boot reads coherent, and both lines are logged', () => {
    const f = fixture();
    const a = boot(f.dir, f.db);
    tx(f.db, () => a.journal.appendInTx(f.db, WIDEN));
    appendFileSync(f.leaf, '{"v":1,"seq');
    const b = boot(f.dir, f.db);
    expect(b.guard.state()).toEqual(COHERENT);
    expect(b.lines[0]).toMatch(/torn tail was kept aside as \d+-[0-9a-f]{64}\.tail and cut/);
    expect(readFileSync(f.leaf, 'utf8').endsWith('\n')).toBe(true);
  });
  it('a rolled-back boot\'s guard still lets a narrowing land as its row only', () => {
    const f = fixture();
    writeFileSync(f.leaf, 'not a record\n');
    const b = boot(f.dir, f.db);
    expect(tx(f.db, () => b.journal.appendInTx(f.db, { ...WIDEN, from: 'full', to: 'chat' })))
      .toEqual({ ok: true, kind: 'row-only', state: { kind: 'rolled-back', cause: 'malformed' } });
  });
});

describe('remeasure() heals, then measures, as the boot step does (review F4)', () => {
  it('a torn tail left by a crash, met while unmeasured, is healed rather than read malformed', () => {
    const f = fixture();
    const b = boot(f.dir, f.db);
    tx(f.db, () => b.journal.appendInTx(f.db, WIDEN));
    appendFileSync(f.leaf, '{"v":1,"seq');
    b.guard.writerFailed('journal-unreadable');
    expect(b.guard.state()).toEqual({ kind: 'unmeasured', why: 'journal' });
    b.guard.remeasure();
    expect(b.guard.state()).toEqual(COHERENT);
    expect(readFileSync(f.leaf, 'utf8').split('\n').filter((l) => l !== '')).toHaveLength(1);
  });
  it('writerFailed(rows-unreadable) moves a coherent guard to unmeasured (rows), keeping the word (review F6)', () => {
    const g = new OverlordAuthorityGuard(measuring(() => COHERENT));
    g.bootVerdict(COHERENT);
    g.writerFailed('rows-unreadable');
    expect(g.state()).toEqual({ kind: 'unmeasured', why: 'rows' });
  });
});
