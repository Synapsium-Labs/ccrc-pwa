// Overlord W1, authority journal plan Task 8 (PR C): Confirm the restore. The L1 deciders' cases (`sim/overlordRestoreSets.ts`,
// shared with the mutation floors) run here against the real module; the transaction (`overlordRestoreState.ts#confirm`) runs on
// a fixture `coord.db` from the real migrations, a fixture `~/.ccrc` stand-in holding the real journal file, the real guard and
// the real writers. Never the live HOME.
import { describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as restoreModule from '../src/coord/overlordRestore.js';
import { tx } from '../src/coord/tx.js';
import { OVERLORD_AUTHORITY_BASENAME, OVERLORD_AUTHORITY_TORN_DIR } from '../src/coord/overlordAuthority.js';
import { OverlordRestoreState, preWitnessFacts } from '../src/coord/overlordRestoreState.js';
import { applyDesignationRestoreInTx, designationRead, retire } from '../src/coord/overlordDesignationStore.js';
import { ladderRows, raiseLatchInTx } from '../src/coord/overlordLadderStore.js';
import { insertStart, mintGeneration, type MintInput } from '../src/continuity/continuityStore.js';
import { confirmRestorePlanCases, restoreStricterCases } from './sim/overlordRestoreSets.js';
import {
  GEN1, GEN2, OPERATOR, NOW, S1, S2, confirm, designateLive, headRow, lastEntry, restoreRigHooks, rig, rung,
} from './overlordRestoreRig.js';

restoreRigHooks();

/** The body's live generation, minted under its own session id at term 0, as a start mints it before the designate arm
 *  re-stamps it `overlord` at the designation's term (`goLive`). */
function mintBody(r: ReturnType<typeof rig>, sessionId: string): void {
  const start = insertStart(r.db, { sessionId, reportId: `report-${sessionId}`, uuid: '0123abcd-0000-4000-8000-000000000001', source: 'startup',
    model: null, rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
  if (!start.ok) throw new Error('insertStart');
  const input: MintInput = { identity: sessionId, sessionId, role: 'worker', term: 0, rowIncarnation: null, startId: start.id, startReportedAt: NOW,
    resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'renewed', mono: 1, proc: 'p', now: NOW };
  expect(mintGeneration(r.db, input, null, false)).toMatchObject({ ok: true });
}
const liveOverlordGenerations = (r: ReturnType<typeof rig>) =>
  r.db.prepare("SELECT sessionId FROM continuity_generations WHERE identity = 'overlord' AND state <> 'ended'").all();

function withPrivacyHeadFence(r: ReturnType<typeof rig>) {
  // Stand in for B's witness input, which C cannot set yet. If asked to remeasure, the real guard still
  // performs its journal-only heal and measurement; this port exposes that result in place of the fence.
  r.guard.writerFailed('journal-unreadable');
  let fenced = true;
  const guard = {
    state: () => fenced ? { kind: 'unmeasured', why: 'privacy-head' } as const : r.guard.state(),
    remeasure: () => { r.guard.remeasure(); fenced = false; },
    confirmed: () => { r.guard.confirmed(); fenced = false; },
    writerFailed: r.guard.writerFailed.bind(r.guard),
  };
  const state = new OverlordRestoreState({
    db: r.db, journal: r.journal, guard,
    witness: { ...preWitnessFacts(r.journal), offerNow: () => { r.offers += 1; } },
  });
  return { guard, state };
}

describe('restoreStricter (Task 8\'s table)', () => {
  for (const [title, run] of Object.entries(restoreStricterCases(restoreModule))) it(title, run);
});
describe('confirmRestorePlan (Task 8\'s transaction, step 1)', () => {
  for (const [title, run] of Object.entries(confirmRestorePlanCases(restoreModule))) it(title, run);
});


describe('Restore paths keep an unmeasured privacy head fenced (review 3373 F1)', () => {
  it('the authority read preserves the privacy fence even when the authority journal is coherent', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(r.journal.measure(r.db)).toEqual({ kind: 'coherent' });
    const { guard, state } = withPrivacyHeadFence(r);

    expect(state.authority()).toEqual({ kind: 'unmeasured', why: 'privacy-head' });
    expect(guard.state()).toEqual({ kind: 'unmeasured', why: 'privacy-head' });
  });

  it('Confirm keeps the privacy fence and leaves a healable authority tail untouched', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const { guard, state } = withPrivacyHeadFence(r);
    const leaf = path.join(r.dir, OVERLORD_AUTHORITY_BASENAME);
    appendFileSync(leaf, '{"partial');
    const bytes = readFileSync(leaf);
    const head = headRow(r);
    const designation = designationRead(r.db);
    const ladder = ladderRows(r.db);

    const answer = state.confirm(OPERATOR, 'privacy-fenced', NOW);
    expect(answer).toMatchObject({ ok: false, refusal: 'journal-unreadable' });
    expect(guard.state()).toEqual({ kind: 'unmeasured', why: 'privacy-head' });
    expect(readFileSync(leaf)).toEqual(bytes);
    expect(existsSync(path.join(r.dir, OVERLORD_AUTHORITY_TORN_DIR))).toBe(false);
    expect(headRow(r)).toEqual(head);
    expect(designationRead(r.db)).toEqual(designation);
    expect(ladderRows(r.db)).toEqual(ladder);
    expect(r.offers).toBe(0);
  });
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

  it('a guard left unmeasured by a transient read is measured again first (its remeasure contract), here coherent: nothing waits', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.writerFailed('journal-unreadable');
    expect(r.guard.state().kind).toBe('unmeasured');
    const before = r.lines();
    expect(confirm(r)).toEqual({ ok: true, changed: false });
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
    expect(r.lines()).toEqual(before);
  });

  it('a guard that stays unmeasured refuses journal-unreadable and writes nothing', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const guard = { state: () => ({ kind: 'unmeasured', why: 'journal' }) as const, confirmed: () => {}, writerFailed: () => {}, remeasure: () => {} };
    const state = new OverlordRestoreState({ db: r.db, journal: r.journal, guard, witness: preWitnessFacts(r.journal) });
    const before = r.lines();
    expect(state.confirm(OPERATOR, 'c', NOW)).toEqual({ ok: false, refusal: 'journal-unreadable', detail: 'the authority guard reads unmeasured' });
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

  it('a malformed journal refuses, keeps every byte and writes nothing, however often it is tried and whatever a witness holds (review 3334 F2)', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, restoreGeneration: 1 });
    const leaf = path.join(r.dir, OVERLORD_AUTHORITY_BASENAME);
    appendFileSync(leaf, 'not a record\n');
    r.restart();
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'malformed' });
    const bytes = readFileSync(leaf);
    const head = headRow(r);
    for (const held of [{ epoch: 0, restoreGeneration: 0 }, { epoch: 90, restoreGeneration: 40 }]) {
      r.held = held;
      expect(confirm(r)).toEqual({ ok: false, refusal: 'journal-unreadable', detail: expect.stringContaining('malformed') });
      expect(readFileSync(leaf)).toEqual(bytes);
      expect(headRow(r)).toEqual(head);
      expect(existsSync(path.join(r.dir, OVERLORD_AUTHORITY_TORN_DIR))).toBe(false);
      expect(r.state.restoreGeneration()).toEqual({ kind: 'unmeasured', why: 'journal' });
    }
    expect(r.offers).toBe(1);
  });

  it('a journal missing under its head row refuses and creates nothing (review 3334 F1)', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const leaf = path.join(r.dir, OVERLORD_AUTHORITY_BASENAME);
    rmSync(leaf);
    r.restart();
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'missing' });
    const head = headRow(r);
    r.held = { epoch: 90, restoreGeneration: 40 };
    expect(confirm(r)).toEqual({ ok: false, refusal: 'journal-unreadable', detail: expect.stringContaining('head row attests') });
    expect(existsSync(leaf)).toBe(false);
    expect(headRow(r)).toEqual(head);
    expect(designationRead(r.db)).toMatchObject({ kind: 'designated', sessionId: S1, term: 1 });
  });

  it('a journal behind its head row refuses, a high witness or not, and keeps its bytes (review 3334 F1)', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const leaf = path.join(r.dir, OVERLORD_AUTHORITY_BASENAME);
    const older = readFileSync(leaf);
    expect(rung(r, 'chat', 'advise')).toMatchObject({ ok: true, journalled: true });
    writeFileSync(leaf, older);
    r.restart();
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'behind' });
    for (const held of [{ epoch: 0, restoreGeneration: 0 }, { epoch: 90, restoreGeneration: 40 }]) {
      r.held = held;
      expect(confirm(r)).toMatchObject({ ok: false, refusal: 'journal-unreadable' });
      expect(readFileSync(leaf)).toEqual(older);
    }
  });

  it('a healable torn tail is healed through its owner first: Confirm folds the records, keeps the binding and cuts no file', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const before = r.lines();
    appendFileSync(path.join(r.dir, OVERLORD_AUTHORITY_BASENAME), '{"partial');
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true, binding: 'kept', newChain: false, sequence: before.length + 1 });
    expect(r.lines().slice(0, before.length)).toEqual(before);
    const kept = readdirSync(path.join(r.dir, OVERLORD_AUTHORITY_TORN_DIR));
    expect(kept.some((n) => n.endsWith('.tail'))).toBe(true);
    expect(kept.some((n) => n.endsWith('.whole'))).toBe(false);
  });

  it('over a coherent guard, a healable torn tail is healed first, so nothing waits and nothing is appended', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const before = r.lines();
    appendFileSync(path.join(r.dir, OVERLORD_AUTHORITY_BASENAME), '{"partial');
    expect(confirm(r)).toEqual({ ok: true, changed: false });
    expect(r.lines()).toEqual(before);
    expect(readFileSync(path.join(r.dir, OVERLORD_AUTHORITY_BASENAME), 'utf8').endsWith('\n')).toBe(true);
  });

  it('a torn tail after records that reach an older head row is set aside, never the file: the journal\'s later retire is kept', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const restore = r.snapshot(false);
    expect(retire(r.db, r.journal, { actor: OPERATOR, at: NOW, opKey: 'retire-1' })).toMatchObject({ ok: true, term: 2 });
    restore();
    const before = r.lines();
    appendFileSync(path.join(r.dir, OVERLORD_AUTHORITY_BASENAME), '{"partial');
    r.restart();
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'malformed' });
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true, binding: 'cleared', term: 3, newChain: false, sequence: before.length + 1 });
    expect(r.lines().slice(0, before.length)).toEqual(before);
    const kept = readdirSync(path.join(r.dir, OVERLORD_AUTHORITY_TORN_DIR));
    expect(kept.some((n) => n.endsWith('.tail'))).toBe(true);
    expect(kept.some((n) => n.endsWith('.whole'))).toBe(false);
    r.restart();
    expect(r.guard.state()).toEqual({ kind: 'coherent' });
  });

  it('an append that fails after the tail cut appends nothing; the retry confirms above the journal\'s last generation', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, restoreGeneration: 1 });
    const restore = r.snapshot(false);
    // Confirm wrote the rung its absent ladder row read (`off`, ruling F8).
    expect(rung(r, 'off', 'chat')).toMatchObject({ ok: true, journalled: true });
    restore();
    const before = r.lines();
    const head = headRow(r);
    appendFileSync(path.join(r.dir, OVERLORD_AUTHORITY_BASENAME), '{"partial');
    r.restart();
    r.failAppends = 1;
    expect(confirm(r)).toMatchObject({ ok: false, refusal: 'journal-unwritable' });
    expect(r.lines()).toEqual(before);
    expect(readFileSync(path.join(r.dir, OVERLORD_AUTHORITY_BASENAME), 'utf8').endsWith('\n')).toBe(true);
    expect(headRow(r)).toEqual(head);
    expect(r.guard.state().kind).toBe('rolled-back');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, restoreGeneration: 2, newChain: false, sequence: before.length + 1 });
  });

  it('a tail cut that fails after it began appends nothing and says so; the retry confirms', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const restore = r.snapshot(false);
    expect(retire(r.db, r.journal, { actor: OPERATOR, at: NOW, opKey: 'retire-1' })).toMatchObject({ ok: true });
    restore();
    const before = r.lines();
    appendFileSync(path.join(r.dir, OVERLORD_AUTHORITY_BASENAME), '{"partial');
    r.restart();
    r.failTruncates = 1;
    expect(confirm(r)).toEqual({ ok: false, refusal: 'journal-unwritable', detail: expect.stringContaining('nothing was appended') });
    // The truncation failed, so the tail stands (its bytes are also kept aside); no record was appended.
    expect(r.lines()).toEqual([...before, '{"partial']);
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, binding: 'cleared', sequence: before.length + 1 });
  });

  it('an append that fails over a coherent guard and a trailing file tells the guard trailing', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'advise')).toMatchObject({ ok: true });
    const restore = r.snapshot(false);
    expect(rung(r, 'advise', 'full')).toMatchObject({ ok: true });
    restore();
    r.guard.confirmed();
    r.failAppends = 1;
    expect(confirm(r)).toMatchObject({ ok: false, refusal: 'journal-unwritable', detail: expect.stringContaining('may stand') });
    expect(r.guard.state()).toEqual({ kind: 'rolled-back', cause: 'trailing' });
  });

  it('a high measured witness raises the epoch and the generation above its own', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    r.held = { epoch: 50, restoreGeneration: 9 };
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, epochAtConfirm: 51, restoreGeneration: 10 });
    expect(lastEntry(r)).toMatchObject({ epochAtConfirm: 51, restoreGeneration: 10 });
  });

  it('a narrower rung and latch a witness was told reach the rows through the transaction (told-narrowings-survive-confirm)', () => {
    const r = rig({ told: () => ({ kind: 'measured', told: { operatorRung: 'chat', latches: [{ cause: 'restore-detected', cap: 'off' }] } }) });
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'full')).toMatchObject({ ok: true, journalled: true });
    r.guard.witnessRefused('witness-epoch');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true });
    const rows = ladderRows(r.db);
    expect(rows).toMatchObject({ kind: 'measured', rung: { operatorRung: 'chat' } });
    expect(rows.kind === 'measured' && rows.standing.map((l) => [l.cause, l.cap])).toEqual([['restore-detected', 'off']]);
    expect(lastEntry(r)).toMatchObject({ operatorRung: 'chat', latches: [{ cause: 'restore-detected', cap: 'off' }] });
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
    mintBody(r, S1);
    designateLive(r, S1, GEN1);
    const restore = r.snapshot(false);
    expect(retire(r.db, r.journal, { actor: OPERATOR, at: NOW, opKey: 'retire-1' })).toMatchObject({ ok: true });
    designateLive(r, S2, GEN2);
    restore();
    expect(liveOverlordGenerations(r)).toEqual([{ sessionId: S1 }]);
    const a = confirm(r);
    // S2 is bound by the journal alone (review 3334 F4): its body is owed its stop too, once, and both generations end.
    expect(a).toMatchObject({ ok: true, changed: true, binding: 'cleared', owed: [S1, S2] });
    const d = designationRead(r.db);
    expect(d.kind !== 'unmeasured' && d.row).toMatchObject({ pastIds: [S1, S2], stopsOwed: [S1, S2] });
    expect(liveOverlordGenerations(r)).toEqual([]);
  });

  it('with no designation row (a lost coord.db), a body only the journal binds is owed its stop', () => {
    const r = rig();
    const fresh = r.snapshot(false);
    designateLive(r, S1, GEN1);
    fresh();
    expect(r.guard.state().kind).toBe('rolled-back');
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true, binding: 'cleared', owed: [S1] });
    const d = designationRead(r.db);
    expect(d.kind !== 'unmeasured' && d.row).toMatchObject({ pastIds: [S1], stopsOwed: [S1], term: 2 });
  });
});

describe('applyDesignationRestoreInTx, the designation\'s inner writer', () => {
  it('refuses to keep a binding the row does not hold, so the transaction rolls back', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const kept = { binding: { kind: 'kept' as const, sessionId: S2 }, pastIdsJoin: [], term: 2, model: 'opus' as const, accountPools: { pools: [], untagged: false } };
    expect(() => tx(r.db, () => applyDesignationRestoreInTx(r.db, kept, OPERATOR, NOW))).toThrow('a binding the row does not hold');
    expect(designationRead(r.db)).toMatchObject({ kind: 'designated', sessionId: S1, term: 1 });
  });
});

describe('termRaised (the renewal readings\' input; the renewal readings piece wires it)', () => {
  it('reads not-raised with nothing designated, and while the term is the one the live generation was launched under', () => {
    const r = rig();
    expect(r.state.termRaised()).toBe('not-raised');
    mintBody(r, S1);
    designateLive(r, S1, GEN1);
    expect(r.state.termRaised()).toBe('not-raised');
  });

  it('reads raised once a kept Confirm raises the term, and unmeasured when the bound session has no live generation', () => {
    const r = rig();
    mintBody(r, S1);
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-heads');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, binding: 'kept', term: 2 });
    expect(r.state.termRaised()).toBe('raised');
    r.db.prepare("UPDATE continuity_generations SET state = 'ended' WHERE identity = 'overlord'").run();
    expect(r.state.termRaised()).toBe('unmeasured');
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
    expect(r.journal.appendConfirmInTx(r.db, ENTRY, { cutTail: null, head: headOf(r) })).toMatchObject({ ok: false, error: 'not-in-transaction' });
    const rungMove = { kind: 'authority-rung', opKey: 'x', from: 'chat', to: 'off' } as never;
    expect(tx(r.db, () => r.journal.appendConfirmInTx(r.db, rungMove, { cutTail: null, head: headOf(r) }))).toMatchObject({ ok: false, error: 'bad-entry' });
    expect(r.lines()).toEqual(before);
  });

  it('refuses changed, writing nothing, when the file\'s head is not the one the plan read', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const before = r.lines();
    const stale = { ...headOf(r), sequence: headOf(r).sequence - 1 };
    expect(tx(r.db, () => r.journal.appendConfirmInTx(r.db, ENTRY, { cutTail: null, head: stale }))).toMatchObject({ ok: false, error: 'changed' });
    expect(tx(r.db, () => r.journal.appendConfirmInTx(r.db, ENTRY, { cutTail: null, head: null }))).toMatchObject({ ok: false, error: 'changed' });
    expect(r.lines()).toEqual(before);
  });

  it('appends after the head it read and moves the head row to the record, over an incoherent guard', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    const a = tx(r.db, () => r.journal.appendConfirmInTx(r.db, ENTRY, { cutTail: null, head: headOf(r) }));
    expect(a).toMatchObject({ ok: true, record: { sequence: 4 } });
    expect(headRow(r)?.sequence).toBe(4);
  });
});
