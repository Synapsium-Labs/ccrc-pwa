// Overlord W1 authority journal plan, Task 7 (PR B): the ladder's `restore-detected` latch, raised as a row when the authority
// guard refuses, and the `no-witness-since-boot` condition read off the witness exchange. Real journal, guard, exchange, coord
// store and ladder reads over a fixture directory under the per-run temp root, never the live HOME.
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import { OVERLORD_AUTHORITY_BASENAME, type OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt } from '../src/coord/overlordAuthorityJournal.js';
import { OverlordAuthorityGuard, runOverlordAuthorityBoot } from '../src/coord/overlordAuthorityGuard.js';
import { OverlordAuthorityExchange } from '../src/coord/overlordAuthorityExchange.js';
import { raiseRestoreDetectedOn } from '../src/coord/overlordRestoreLatch.js';
import { ladderConditionInputs, ladderRead, NO_WITNESS_YET } from '../src/coord/overlordLadderRead.js';
import { effectiveRung } from '../src/coord/overlordLadder.js';
import { ladderActor } from '../src/coord/overlordLadderStore.js';
import { LADDER_CAUSE_MAP, LADDER_CAUSES, rungRank } from '../../shared/overlord-ladder.js';
import { attributionIdentity, isRecordedActor, serverActorOf } from '../src/auth/attributionIdentity.js';
import { gateActorOf } from '../src/accounts/audit.js';
import type { WitnessTuple } from '../../shared/authorityWitness.js';
import { PRIVACY_HEAD_UNWIRED, type PrivacyHeadRead } from '../src/coord/privacyJournalHead.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const find = (needle: string): string => MIGRATIONS.find((sql) => sql.includes(needle))!;
const NARROW: OverlordAuthorityMove = { kind: 'authority-rung', opKey: 'op-n', from: 'full', to: 'advise' };
const WIDEN: OverlordAuthorityMove = { kind: 'authority-rung', opKey: 'op-w', from: 'advise', to: 'full' };
const identity = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const operator = identity.operator(gateActorOf('operator-a', ''));
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

function fixture(): { dir: string; db: DatabaseSync } {
  const dir = mkTmp('ccrc-overlord-restore-latch-');
  const db = new DatabaseSync(path.join(dir, 'coord.db'));
  for (const n of ['CREATE TABLE overlord_authority_head', 'CREATE TABLE overlord_designation', 'CREATE TABLE overlord_ladder', 'CREATE TABLE decision_rows']) db.exec(find(n));
  return { dir, db };
}

/** A server's worth of the journal, guard, latch raise (registered BEFORE the boot step) and exchange over one directory and database. */
function boot(f: { dir: string; db: DatabaseSync }, bootId = 'boot-now') {
  const { dir, db } = f;
  const time = fakeTime({ wallMs: Date.parse('2026-11-16T10:00:00.000Z') }).ports;
  let journal!: OverlordAuthorityJournal;
  const port = { healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) };
  const guard = new OverlordAuthorityGuard(port);
  journal = new OverlordAuthorityJournal(overlordAuthorityFileAt(dir), { clock: time.clock }, guard);
  const coord = new CoordStore(db);
  const warns: string[] = [];
  raiseRestoreDetectedOn(guard, { coord, journal, clock: time.clock, entropy: time.entropy, inTransaction: () => db.isTransaction, warn: (l) => warns.push(l) });
  runOverlordAuthorityBoot(port, guard, () => {});
  const privacy = PRIVACY_HEAD_UNWIRED.read() as PrivacyHeadRead;
  const ex = new OverlordAuthorityExchange({ journal, guard, privacy: { read: () => privacy }, boot: bootId, relationOf: () => 'other-host', warn: (l) => warns.push(l), agent: null,
    committedRows: () => db.isTransaction ? { kind: 'unmeasured' } : journal.readRows(db) });
  return { guard, journal, coord, warns, ex, time };
}
const append = (f: { db: DatabaseSync }, journal: OverlordAuthorityJournal, m: OverlordAuthorityMove): void => { tx(f.db, () => journal.appendInTx(f.db, m)); };
const standing = (db: DatabaseSync): Record<string, unknown>[] =>
  db.prepare("SELECT cause, cap, detail, raisedBy, raiseSequence FROM overlord_latches WHERE clearedAt IS NULL").all() as Record<string, unknown>[];
/** A boot over a journal whose file is one record past its head row: the guard reads `rolled-back: trailing`. */
function trailing(): { f: ReturnType<typeof fixture> } {
  const f = fixture();
  const first = boot(f);
  expect(() => tx(f.db, () => { first.journal.appendInTx(f.db, NARROW); throw new Error('the caller\'s row'); })).toThrow();
  return { f };
}

describe('the restore-detected latch', () => {
  it('a boot over a trailing journal raises it once, as a row with a NULL sequence, and the effective rung reads chat', () => {
    const { f } = trailing();
    // the first boot's writer failure already raised it (see below); start from a fresh ladder to measure the boot alone
    f.db.exec('DELETE FROM overlord_latches');
    const b = boot(f);
    expect(b.guard.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
    expect(standing(f.db)).toEqual([{ cause: 'restore-detected', cap: 'chat', detail: 'the authority journal reads rolled-back: trailing', raisedBy: 'ccrc server: authority', raiseSequence: null }]);
    f.db.exec("INSERT INTO overlord_ladder (id, operatorRung, actor, updatedAt, recordSequence, recordFrom, narrowedAt) VALUES (1, 'full', 'operator-a', 1, 1, NULL, NULL)");
    const lifted = { 'generation-degraded': () => 'lifted' as const, 'off-model': () => 'lifted' as const, 'rung-word-missing': () => 'lifted' as const, 'no-witness-since-boot': () => 'lifted' as const };
    const read = ladderRead(b.coord, lifted, NO_WITNESS_YET, []);
    expect(read).toMatchObject({ kind: 'measured', effective: { rung: 'chat' } });
    // a second boot over the still-standing latch adds no second row (idempotent in the store)
    boot(f);
    expect(standing(f.db)).toHaveLength(1);
  });

  it('a writer failure after the append raises it at once (past the open transaction), and a second failure does not raise it again', async () => {
    const f = fixture();
    const b = boot(f);
    expect(standing(f.db)).toEqual([]);
    // the journal reports a failure after its append from inside the writer's open transaction: the raise waits for it to end
    tx(f.db, () => { b.guard.writerFailed('trailing'); expect(standing(f.db)).toEqual([]); });
    expect(standing(f.db)).toEqual([]);
    await flush();
    expect(b.guard.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
    expect(standing(f.db)).toMatchObject([{ cause: 'restore-detected', raiseSequence: null }]);
    b.guard.writerFailed('diverged');
    await flush();
    expect(standing(f.db)).toHaveLength(1);
    expect(b.warns).toEqual([]);
  });

  it('a coherent boot raises nothing', () => {
    const f = fixture();
    boot(f);
    expect(standing(f.db)).toEqual([]);
  });

  it('the clear door refuses it while the journal is not coherent, and clears it with an authority-latch-clear record once it is', () => {
    const f = fixture();
    const b = boot(f);
    const at = 1_800_000_000_000;
    // The latch stands as a JOURNALLED row (raised while the journal was coherent), so the head row agrees with the rows once the
    // guard is confirmed; a row-only latch needs Confirm's re-stamp of the head first (PR C), which this file does not drive.
    expect(b.coord.raiseLatch(b.journal, { cause: 'restore-detected', cap: 'chat', detail: 'fixture', raisedBy: serverActorOf('authority'), at, opKey: 'op-r' })).toMatchObject({ ok: true, journalled: true });
    b.guard.witnessRefused('witness-heads');
    expect(standing(f.db)).toHaveLength(1);
    expect(b.coord.clearLatch(b.journal, { cause: 'restore-detected', actor: operator, at, opKey: 'op-c1' })).toEqual({ ok: false, error: 'authority-rolled-back' });
    expect(standing(f.db)).toHaveLength(1);
    b.guard.confirmed();
    const cleared = b.coord.clearLatch(b.journal, { cause: 'restore-detected', actor: operator, at, opKey: 'op-c2' });
    expect(cleared, JSON.stringify(cleared)).toMatchObject({ ok: true, changed: true, journalled: true });
    expect(standing(f.db)).toEqual([]);
    expect(readFileSync(path.join(f.dir, OVERLORD_AUTHORITY_BASENAME), 'utf8')).toContain('authority-latch-clear');
  });

  it('a throwing or refusing raise is one warn line, and never breaks the guard', () => {
    const f = fixture();
    const time = fakeTime({ wallMs: 1 }).ports;
    const guard = new OverlordAuthorityGuard({ healTornTail: () => ({ kind: 'no-tail' }), measure: () => ({ kind: 'coherent' }) });
    const warns: string[] = [];
    const coord = { raiseLatch: () => { throw new Error('db gone'); } } as unknown as CoordStore;
    raiseRestoreDetectedOn(guard, { coord, journal: undefined as never, clock: time.clock, entropy: time.entropy, inTransaction: () => false, warn: (l) => warns.push(l) });
    guard.bootVerdict({ kind: 'rolled-back', cause: 'behind' });
    expect(warns).toEqual(['ccrc-server: restore-detected latch not raised: db gone']);
    expect(guard.state()).toEqual({ kind: 'rolled-back', cause: 'behind' });
    f.db.close();
  });
});

describe('the no-witness-since-boot condition', () => {
  const capped = (b: ReturnType<typeof boot>, reading: () => 'standing' | 'lifted' | 'unmeasured') => {
    const rows = b.coord.ladderRows();
    if (rows.kind !== 'measured') throw new Error('unmeasured');
    return effectiveRung({ operatorRung: { kind: 'set', rung: 'full' }, latches: rows.standing, conditions: [{ cause: 'no-witness-since-boot', reading: reading() }], causeTable: LADDER_CAUSE_MAP, serverCaps: ['overlord-route-v1', 'overlord-answer-v1'] }).rung;
  };

  it('a fresh boot reads it standing, and the effective rung is capped at advise with the operator at full', () => {
    const f = fixture();
    const b = boot(f);
    expect(b.ex.noWitnessSinceBoot()).toBe('standing');
    expect(capped(b, () => b.ex.noWitnessSinceBoot())).toBe('advise');
    const inputs = ladderConditionInputs({ coord: b.coord, serverCaps: [], noWitnessSinceBoot: () => b.ex.noWitnessSinceBoot() });
    expect(inputs['no-witness-since-boot']()).toBe('standing');
  });

  it('an absent dep, or a throwing one, reads unmeasured: its effect applies', () => {
    const f = fixture();
    const b = boot(f);
    expect(ladderConditionInputs({ coord: b.coord, serverCaps: [] })['no-witness-since-boot']()).toBe('unmeasured');
    expect(ladderConditionInputs({ coord: b.coord, serverCaps: [], noWitnessSinceBoot: () => { throw new Error('x'); } })['no-witness-since-boot']()).toBe('unmeasured');
    expect(capped(b, () => 'unmeasured')).toBe('advise');
  });

  it('a counting console answer lifts it, and the cap lifts with it', () => {
    const f = fixture();
    const b = boot(f);
    append(f, b.journal, WIDEN);
    const offer = b.ex.exchangeConsole('probe', null);
    if (offer.kind !== 'offer') throw new Error('no offer');
    const earlier: WitnessTuple = { ...offer.tuple, boot: 'boot-old' };
    b.ex.exchangeConsole('probe', earlier);
    expect(b.ex.noWitnessSinceBoot()).toBe('lifted');
    expect(capped(b, () => b.ex.noWitnessSinceBoot())).toBe('full');
  });

  it('NarrowingWitness answers held once a counting witness holds the record sequence', () => {
    const f = fixture();
    const b = boot(f);
    append(f, b.journal, WIDEN);
    expect(b.ex.heldFor(1)).toBe('not-yet');
    const offer = b.ex.exchangeConsole('probe', null);
    if (offer.kind !== 'offer') throw new Error('no offer');
    b.ex.exchangeConsole('probe', { ...offer.tuple, boot: 'boot-old' });
    expect(b.ex.heldFor(1)).toBe('held');
  });
});

describe('the server actor', () => {
  it('is a recorded actor with the server kind, a brake takes it, and a widening refuses it', () => {
    const actor = serverActorOf('authority');
    expect(isRecordedActor(actor)).toBe(true);
    expect(actor).toEqual({ kind: 'server', subject: 'ccrc server: authority', issuer: 'server', strength: 'attributed' });
    expect(identity.server('authority')).toMatchObject({ kind: 'server', subject: 'ccrc server: authority' });
    expect(ladderActor(actor, 'brake')).toEqual({ ok: true, subject: 'ccrc server: authority' });
    expect(ladderActor(actor, 'widen')).toEqual({ ok: false, reason: 'actor' });
    expect(isRecordedActor({ ...actor })).toBe(false);
  });
});

describe('monotonicity with every cause of the table', () => {
  it('adding one more standing cause never raises the effective rung', () => {
    const causes = [...LADDER_CAUSES];
    const rungAt = (mask: number): number => {
      const on = causes.filter((_, i) => (mask >> i) & 1);
      const latches = on.filter((c) => LADDER_CAUSE_MAP[c].kind === 'latch').map((cause, id) => ({
        id, cause, cap: (LADDER_CAUSE_MAP[cause].effect as { cap: 'chat' | 'advise' }).cap, detail: '', raisedAt: 1, raisedBy: 'x', raiseSequence: null, journalled: false }));
      const conditions = causes.filter((c) => LADDER_CAUSE_MAP[c].kind === 'condition').map((cause) => ({ cause: cause as never, reading: on.includes(cause) ? 'standing' as const : 'lifted' as const }));
      return rungRank(effectiveRung({ operatorRung: { kind: 'set', rung: 'full' }, latches, conditions, causeTable: LADDER_CAUSE_MAP, serverCaps: ['overlord-route-v1', 'overlord-answer-v1'] }).rung);
    };
    for (let mask = 0; mask < 1 << causes.length; mask++) {
      for (let i = 0; i < causes.length; i++) expect(rungAt(mask | (1 << i))).toBeLessThanOrEqual(rungAt(mask));
    }
    expect(causes).toEqual(expect.arrayContaining(['restore-detected', 'no-witness-since-boot']));
  });
});
