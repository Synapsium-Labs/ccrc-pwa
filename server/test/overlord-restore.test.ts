// Overlord W1, authority journal plan Task 8 (PR C): Confirm the restore. The L1 deciders' cases (`sim/overlordRestoreSets.ts`,
// shared with the mutation floors) run here against the real module; the transaction (`overlordRestoreState.ts#confirm`) runs on
// a fixture `coord.db` from the real migrations, a fixture `~/.ccrc` stand-in holding the real journal file, the real guard and
// the real writers. Never the live HOME.
import { describe, expect, it } from 'vitest';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as restoreModule from '../src/coord/overlordRestore.js';
import { tx } from '../src/coord/tx.js';
import { OVERLORD_AUTHORITY_BASENAME, OVERLORD_AUTHORITY_TORN_DIR } from '../src/coord/overlordAuthority.js';
import { OverlordRestoreState, preWitnessFacts } from '../src/coord/overlordRestoreState.js';
import { designationRead, retire } from '../src/coord/overlordDesignationStore.js';
import { ladderRows, raiseLatchInTx } from '../src/coord/overlordLadderStore.js';
import { confirmRestorePlanCases, restoreStricterCases } from './sim/overlordRestoreSets.js';
import {
  GEN1, GEN2, OPERATOR, NOW, S1, S2, confirm, designateLive, headRow, lastEntry, restoreRigHooks, rig, rung,
} from './overlordRestoreRig.js';

restoreRigHooks();

describe('restoreStricter (Task 8\'s table)', () => {
  for (const [title, run] of Object.entries(restoreStricterCases(restoreModule))) it(title, run);
});
describe('confirmRestorePlan (Task 8\'s transaction, step 1)', () => {
  for (const [title, run] of Object.entries(confirmRestorePlanCases(restoreModule))) it(title, run);
});


describe('Confirm the restore: the transaction', () => {
  it('a coherent guard over a coherent file answers changed: false and writes nothing', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    const before = r.lines();
    expect(confirm(r)).toEqual({ ok: true, changed: false });
    expect(r.lines()).toEqual(before);
    expect(r.offers).toBe(0);
  });

  it('an unmeasured guard refuses journal-unreadable and writes nothing', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.writerFailed('journal-unreadable');
    expect(r.guard.state().kind).toBe('unmeasured');
    const before = r.lines();
    expect(confirm(r)).toMatchObject({ ok: false, refusal: 'journal-unreadable' });
    expect(r.lines()).toEqual(before);
  });

  it('an unmeasured epoch refuses journal-unreadable and writes nothing', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const state = new OverlordRestoreState({
      db: r.db, journal: r.journal, guard: r.guard,
      witness: { ...preWitnessFacts(r.journal), epoch: () => ({ kind: 'unmeasured', why: 'privacy-head' }) },
    });
    const before = r.lines();
    expect(state.confirm(OPERATOR, 'c', NOW)).toMatchObject({ ok: false, refusal: 'journal-unreadable' });
    expect(r.lines()).toEqual(before);
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });

  it('after a restore of coord.db alone, Confirm keeps the journal\'s later retire, raises the term and lifts the refusal', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const restore = r.snapshot(false);
    expect(retire(r.db, r.journal, { actor: OPERATOR, at: NOW, opKey: 'retire-1' })).toMatchObject({ ok: true, changed: true, term: 2 });
    restore();
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true, binding: 'cleared', term: 3, restoreGeneration: 1, newChain: false });
    const d = designationRead(r.db);
    expect(d.kind).toBe('not-designated');
    expect(d.kind !== 'unmeasured' && d.row).toMatchObject({ term: 3, designatedTerm: 1, pastIds: [S1] });
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    expect(r.offers).toBe(1);
    expect(r.journal.measure(r.db)).toEqual({ kind: 'coherent' });
    expect(lastEntry(r)).toMatchObject({ kind: 'authority-restore-confirmed', binding: { kind: 'cleared' }, term: 3 });
  });

  it('the same session on both sides is kept, with the row\'s generation, and its stricter fields written', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-heads');
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true, binding: 'kept', term: 2 });
    const d = designationRead(r.db);
    expect(d).toMatchObject({ kind: 'designated', sessionId: S1, term: 2 });
    expect(d.kind !== 'unmeasured' && d.row).toMatchObject({ designatedTerm: 1, model: 'fable', accountPools: { pools: ['pool-a', 'pool-b'], untagged: true } });
    expect(lastEntry(r)).toMatchObject({ binding: { kind: 'kept', sessionId: S1, generation: GEN1 } });
  });

  it('a coherent guard over a file with a trailing record (a writer failure after its append) is confirmed, not unchanged', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'advise')).toMatchObject({ ok: true, changed: true });
    // The record stands; its head row and rung row are lost (a failure after the append): the head row moves back one.
    const restore = r.snapshot(false);
    expect(rung(r, 'advise', 'full')).toMatchObject({ ok: true, changed: true });
    restore();
    // A restart heals nothing here and reads trailing; a guard told coherent stands for the writer's in-memory miss (F1).
    expect(r.journal.measure(r.db)).toEqual({ kind: 'rolled-back', cause: 'trailing' });
    r.guard.confirmed();
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true });
    // The trailing widening is folded into the journal side and not applied: the row's advise stands.
    expect(ladderRows(r.db)).toMatchObject({ kind: 'measured', rung: { operatorRung: 'advise' } });
  });

  it('an operator narrowing written row-only while rolled back is kept, and carries the Confirm record\'s sequence after', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'full')).toMatchObject({ ok: true, journalled: true });
    r.guard.witnessRefused('witness-epoch');
    expect(rung(r, 'full', 'advise')).toMatchObject({ ok: true, changed: true, journalled: false, recordSequence: null });
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true });
    const seq = a.ok && a.changed ? a.sequence : -1;
    expect(ladderRows(r.db)).toMatchObject({ kind: 'measured', rung: { operatorRung: 'advise', recordSequence: seq } });
    expect(lastEntry(r)).toMatchObject({ operatorRung: 'advise' });
  });

  it('an absent ladder row reads off on the database side (ruling F8)', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'full')).toMatchObject({ ok: true });
    r.db.exec('DELETE FROM overlord_ladder');
    r.guard.witnessRefused('witness-heads');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true });
    expect(ladderRows(r.db)).toMatchObject({ kind: 'measured', rung: { operatorRung: 'off' } });
  });

  it('the restore-detected latch stands after Confirm, stamped with its record (ruling F4)', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    expect(tx(r.db, () => raiseLatchInTx(r.db, r.journal, {
      cause: 'restore-detected', cap: 'chat', detail: 'a restore was detected', raisedBy: OPERATOR, at: NOW, opKey: 'latch-1',
    }))).toMatchObject({ ok: true, changed: true, journalled: false });
    const a = confirm(r);
    const seq = a.ok && a.changed ? a.sequence : -1;
    const rows = ladderRows(r.db);
    expect(rows.kind === 'measured' && rows.standing.map((l) => [l.cause, l.cap, l.raiseSequence])).toEqual([['restore-detected', 'chat', seq]]);
    expect(lastEntry(r)).toMatchObject({ latches: [{ cause: 'restore-detected', cap: 'chat' }] });
  });

  it('the record is appended before any table writes; a table writer that throws rolls back and leaves the record trailing', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const before = r.lines().length;
    r.db.exec("CREATE TEMP TRIGGER no_write BEFORE UPDATE ON overlord_designation BEGIN SELECT RAISE(ABORT, 'refused'); END");
    expect(confirm(r)).toMatchObject({ ok: false, refusal: 'journal-unwritable' });
    expect(r.lines().length).toBe(before + 1);
    expect(lastEntry(r)).toMatchObject({ kind: 'authority-restore-confirmed', restoreGeneration: 1 });
    expect(headRow(r)?.sequence).toBe(before);
    expect(designationRead(r.db)).toMatchObject({ kind: 'designated', term: 1 });
    expect(r.guard.state().kind).toBe('rolled-back');
    expect(r.offers).toBe(0);
    // The next Confirm folds the trailing record in and takes the generation after it: a value skipped, never repeated (F14).
    r.db.exec('DROP TRIGGER no_write');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, restoreGeneration: 2, term: 3 });
    expect(r.lines().length).toBe(before + 2);
  });

  it('a table writer that throws over a coherent guard leaves the record trailing and moves the guard to rolled-back: trailing', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'advise')).toMatchObject({ ok: true });
    const restore = r.snapshot(false);
    expect(rung(r, 'advise', 'full')).toMatchObject({ ok: true });
    restore();
    r.guard.confirmed();
    r.db.exec("CREATE TEMP TRIGGER no_write BEFORE UPDATE ON overlord_designation BEGIN SELECT RAISE(ABORT, 'refused'); END");
    expect(confirm(r)).toMatchObject({ ok: false, refusal: 'journal-unwritable' });
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
  });

  it('a failure before the append leaves the file without the record and the guard rolled-back', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const before = r.lines();
    const state = new OverlordRestoreState({
      db: r.db, journal: r.journal, guard: r.guard,
      witness: { ...preWitnessFacts(r.journal), highest: () => { throw new Error('the exchange failed'); } },
    });
    expect(state.confirm(OPERATOR, 'c', NOW)).toMatchObject({ ok: false, refusal: 'journal-unreadable' });
    expect(r.lines()).toEqual(before);
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
  });

  it('a second Confirm right after the first is changed: false', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true });
    expect(confirm(r)).toEqual({ ok: true, changed: false });
  });

  it('over a malformed file: the file is set aside, record 1 of a new chain, the narrowest journal side, above the bound', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const leaf = path.join(r.dir, OVERLORD_AUTHORITY_BASENAME);
    const lines = r.lines();
    writeFileSync(leaf, `${lines.join('\n')}\nnot a record\n`);
    r.restart();
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'malformed' });
    r.held = { epoch: 2, restoreGeneration: 1 };
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true, sequence: 1, newChain: true, binding: 'cleared', epochAtConfirm: lines.length + 2, restoreGeneration: lines.length + 2 });
    expect(r.lines().length).toBe(1);
    expect(readdirSync(path.join(r.dir, OVERLORD_AUTHORITY_TORN_DIR)).some((n) => n.endsWith('.whole'))).toBe(true);
    // The journal side is the narrowest: the row's fable and its two pools narrow to opus and the empty set.
    const d = designationRead(r.db);
    expect(d.kind !== 'unmeasured' && d.row).toMatchObject({ model: 'opus', accountPools: { pools: [], untagged: false }, pastIds: [S1] });
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    r.restart();
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
  });

  it('after a whole-volume restore, with a console holding a higher epoch and generation, Confirm goes above both (F6)', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const restore = r.snapshot(true);
    r.guard.witnessRefused('witness-epoch');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, restoreGeneration: 1 });
    const firstEpoch = (lastEntry(r)['epochAtConfirm'] as number);
    restore();
    // The volume came back whole: the journal agrees with its rows, so only the witness can tell.
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    r.guard.witnessRefused('witness-epoch');
    r.held = { epoch: firstEpoch, restoreGeneration: 1 };
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true, restoreGeneration: 2, epochAtConfirm: firstEpoch + 1 });
  });

  it('a binding cleared by Confirm owes its body\'s stop, as a retire does', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const restore = r.snapshot(false);
    expect(retire(r.db, r.journal, { actor: OPERATOR, at: NOW, opKey: 'retire-1' })).toMatchObject({ ok: true });
    designateLive(r, S2, GEN2);
    restore();
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true, binding: 'cleared', owed: [S1] });
    const d = designationRead(r.db);
    expect(d.kind !== 'unmeasured' && d.row).toMatchObject({ pastIds: [S1, S2], stopsOwed: [S1] });
  });
});

describe('appendConfirmInTx (Task 8, step 3)', () => {
  const ENTRY = {
    kind: 'authority-restore-confirmed', opKey: 'op-c', term: 2, epochAtConfirm: 4, privacySequenceAtConfirm: null, restoreGeneration: 1,
    newChain: false, binding: { kind: 'cleared' }, operatorRung: 'off', latches: [], accountSet: { pools: [], untagged: false }, modelClass: 'opus',
  } as const;
  const headOf = (r: ReturnType<typeof rig>) => {
    const last = JSON.parse(r.lines().at(-1)!) as { sequence: number; journalId: string; digest: string };
    return { sequence: last.sequence, journalId: last.journalId, digest: last.digest };
  };

  it('refuses outside a transaction and refuses any entry but the Confirm record, writing nothing', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const before = r.lines();
    expect(r.journal.appendConfirmInTx(r.db, ENTRY, { cutWhole: false, head: headOf(r) })).toMatchObject({ ok: false, error: 'not-in-transaction' });
    const rungMove = { kind: 'authority-rung', opKey: 'x', from: 'chat', to: 'off' } as never;
    expect(tx(r.db, () => r.journal.appendConfirmInTx(r.db, rungMove, { cutWhole: false, head: headOf(r) }))).toMatchObject({ ok: false, error: 'bad-entry' });
    expect(r.lines()).toEqual(before);
  });

  it('refuses changed, writing nothing, when the file\'s head is not the one the plan read', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const before = r.lines();
    const stale = { ...headOf(r), sequence: headOf(r).sequence - 1 };
    expect(tx(r.db, () => r.journal.appendConfirmInTx(r.db, ENTRY, { cutWhole: false, head: stale }))).toMatchObject({ ok: false, error: 'changed' });
    expect(tx(r.db, () => r.journal.appendConfirmInTx(r.db, ENTRY, { cutWhole: false, head: null }))).toMatchObject({ ok: false, error: 'changed' });
    expect(r.lines()).toEqual(before);
  });

  it('appends after the head it read and moves the head row to the record, over an incoherent guard', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const a = tx(r.db, () => r.journal.appendConfirmInTx(r.db, ENTRY, { cutWhole: false, head: headOf(r) }));
    expect(a).toMatchObject({ ok: true, record: { sequence: 4 } });
    expect(headRow(r)?.sequence).toBe(4);
  });
});
