// Overlord W1, sequence PR B2 (plan w1-sequence-monitor.md Task 5, call 1219): Confirm the restore's database side is one read,
// which the invariant monitor's I7 reads too. CHARACTERIZATION FIRST: the Confirm case below was green on `main` against the
// private `rowsSide`, before the read moved to `overlordRestoreRows.ts`; the move changes no answer. Fixture `coord.db` and
// journal only (`overlordRestoreRig.ts`), never the live HOME.
import { describe, expect, it } from 'vitest';
import { tx } from '../src/coord/tx.js';
import { raiseLatchInTx } from '../src/coord/overlordLadderStore.js';
import { GEN1, OPERATOR, NOW, S1, confirm, designateLive, lastEntry, restoreRigHooks, rig, rung } from './overlordRestoreRig.js';

restoreRigHooks();

describe('Confirm the restore reads the database side as it did (characterization)', () => {
  it('a database behind its journal: Confirm keeps the binding and takes the rows\' lower rung and the union of latches', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'advise')).toMatchObject({ ok: true, journalled: true });
    expect(tx(r.db, () => raiseLatchInTx(r.db, r.journal, {
      cause: 'unwitnessed-third', cap: 'advise', detail: 'a fixture latch', raisedBy: OPERATOR, at: NOW, opKey: 'latch-a',
    }))).toMatchObject({ ok: true, changed: true, journalled: true });
    const restore = r.snapshot(false);
    expect(rung(r, 'advise', 'full')).toMatchObject({ ok: true, journalled: true });
    restore();
    const a = confirm(r);
    expect(a).toMatchObject({ ok: true, changed: true, binding: 'kept', term: 2 });
    expect(lastEntry(r)).toMatchObject({
      kind: 'authority-restore-confirmed', binding: { kind: 'kept', sessionId: S1, generation: GEN1 }, term: 2, operatorRung: 'advise',
      latches: [{ cause: 'unwitnessed-third', cap: 'advise' }], accountSet: { pools: ['pool-a', 'pool-b'], untagged: true }, modelClass: 'fable',
    });
  });

  it('with no designation row and no ladder row, the database side is the narrowest (ruling F8): nothing bound, off, opus, the empty set', () => {
    const r = rig();
    designateLive(r, S1, GEN1);
    expect(rung(r, 'chat', 'advise')).toMatchObject({ ok: true });
    r.db.exec('DELETE FROM overlord_designation; DELETE FROM overlord_ladder');
    r.guard.witnessRefused('witness-heads');
    expect(confirm(r)).toMatchObject({ ok: true, changed: true, binding: 'cleared' });
    expect(lastEntry(r)).toMatchObject({ operatorRung: 'off', accountSet: { pools: [], untagged: false }, modelClass: 'opus', latches: [] });
  });
});
