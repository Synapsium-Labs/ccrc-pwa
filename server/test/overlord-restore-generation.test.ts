// Overlord W1, authority journal plan Task 9 (PR C): the restore generation (`overlordRestoreState.ts#restoreGeneration`), carried
// by the journal's Confirm records and the witnesses, and the response rows' stamp switched to it (`responses/stamp.ts`, index
// question 35). On the shared fixture (`overlordRestoreRig.ts`): a real journal file, the real guard and a migrated `coord.db`.
import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OVERLORD_AUTHORITY_BASENAME } from '../src/coord/overlordAuthority.js';
import { responseStampNow } from '../src/responses/stamp.js';
import { insertPushResponseInTx, openResponseRows } from '../src/coord/responsesStore.js';
import { tx } from '../src/coord/tx.js';
import { responseOutcome, type SealRow } from '../src/responses.js';
import type { ResponseStamp } from '../../shared/responses.js';
import { GEN1, S1, confirm, designateLive, restoreRigHooks, rig } from './overlordRestoreRig.js';

restoreRigHooks();

const BOOT = { ok: true as const, epoch: 4 };

describe('restoreGeneration (Task 9)', () => {
  it('reads 0 on a fresh journal, and on one with records but no Confirm', () => {
    const r = rig();
    expect(r.state.restoreGeneration()).toEqual({ kind: 'measured', n: 0 });
    designateLive(r, S1, GEN1);
    expect(r.state.restoreGeneration()).toEqual({ kind: 'measured', n: 0 });
  });

  it('reads 1 after a Confirm, and 2 after a second restore and Confirm', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, restoreGeneration: 1 });
    expect(r.state.restoreGeneration()).toEqual({ kind: 'measured', n: 1 });
    r.guard.witnessRefused('witness-heads');
    expect(r.state.restoreGeneration()).toEqual({ kind: 'unmeasured', why: 'journal' });
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, restoreGeneration: 2 });
    expect(r.state.restoreGeneration()).toEqual({ kind: 'measured', n: 2 });
  });

  it('after a whole-volume restore that brings back a journal at 1 while a console holds 2, the next Confirm makes it 3', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    expect(confirm(r)).toMatchObject({ restoreGeneration: 1 });
    const restore = r.snapshot(true);
    r.guard.witnessRefused('witness-epoch');
    expect(confirm(r)).toMatchObject({ restoreGeneration: 2 });
    restore();
    expect(r.state.restoreGeneration()).toEqual({ kind: 'measured', n: 1 });
    r.guard.witnessRefused('witness-epoch');
    r.held = { epoch: 0, restoreGeneration: 2 };
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, restoreGeneration: 3 });
    expect(r.state.restoreGeneration()).toEqual({ kind: 'measured', n: 3 });
  });

  it('reads unmeasured, never 0, on an unreadable or malformed file, or a file past its head row', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const leaf = path.join(r.dir, OVERLORD_AUTHORITY_BASENAME);
    rmSync(leaf);
    mkdirSync(leaf);
    expect(r.state.restoreGeneration()).toEqual({ kind: 'unmeasured', why: 'journal' });
    rmSync(leaf, { recursive: true });
    writeFileSync(leaf, 'not a record\n');
    expect(r.state.restoreGeneration()).toEqual({ kind: 'unmeasured', why: 'journal' });
    const t = rig();
    designateLive(t, S1, GEN1);
    t.db.exec('UPDATE overlord_authority_head SET sequence = sequence - 1');
    expect(t.state.restoreGeneration()).toEqual({ kind: 'unmeasured', why: 'journal' });
  });
});

describe('the response rows\' stamp reads the restore generation (index question 35)', () => {
  it('responseStampNow carries the measured generation, and unmeasured as unmeasured', () => {
    expect(responseStampNow(BOOT, { kind: 'measured', n: 2 })).toEqual({ boot: { kind: 'measured', epoch: 4 }, restore: { kind: 'measured', n: 2 } });
    expect(responseStampNow(BOOT, { kind: 'measured', n: 0 })).toEqual({ boot: { kind: 'measured', epoch: 4 }, restore: { kind: 'measured', n: 0 } });
    expect(responseStampNow({ ok: false, detail: 'x' } as never, { kind: 'unmeasured' })).toEqual({ boot: { kind: 'unmeasured' }, restore: { kind: 'unmeasured' } });
  });

  it('a push row inserted now is stamped with the measured generation, and with unmeasured over an unreadable journal', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    r.guard.witnessRefused('witness-epoch');
    confirm(r);
    const stamp = responseStampNow(BOOT, r.state.restoreGeneration());
    tx(r.db, () => insertPushResponseInTx(r.db, { pushId: 'push-a', label: 'ask', carries: null, hasActions: true, tag: 't', stamp, at: 10 }));
    r.guard.witnessRefused('witness-heads');
    const later = responseStampNow(BOOT, r.state.restoreGeneration());
    tx(r.db, () => insertPushResponseInTx(r.db, { pushId: 'push-b', label: 'ask', carries: null, hasActions: true, tag: 't', stamp: later, at: 11 }));
    const rows = openResponseRows(r.db);
    expect(rows.ok && rows.rows.map((x) => x.restore)).toEqual([{ kind: 'measured', n: 1 }, { kind: 'unmeasured' }]);
  });

  it('a push inserted before a Confirm and sealed after it reads unmeasured in responses B\'s rule; with no Confirm between, not-opened', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    const before = responseStampNow(BOOT, r.state.restoreGeneration());
    r.guard.witnessRefused('witness-epoch');
    confirm(r);
    const after = responseStampNow(BOOT, r.state.restoreGeneration());
    const row = (stamp: ResponseStamp): SealRow => ({
      id: 1, kind: 'push', label: 'ask', state: 'delivered', carries: null, hasActions: true, acceptedSubs: ['e1'], boot: stamp.boot,
      restore: stamp.restore, insertedAt: 100, deliveredAt: 100, windowCapAt: null,
    });
    const facts = (stamp: ResponseStamp, now: ResponseStamp) => ({
      row: row(stamp), owner: { kind: 'none' as const }, replacedOn: [], bootsInWindow: 0, stampNow: now,
      receipts: [{ receipt: 'shown' as const, source: 'worker' as const, endpointHash: 'e1', at: 200 }],
    });
    expect(responseOutcome(facts(before, after), 1_000)).toMatchObject({ outcome: 'unmeasured', why: 'receipts' });
    expect(responseOutcome(facts(after, after), 1_000)).toMatchObject({ outcome: 'not-opened' });
  });
});
