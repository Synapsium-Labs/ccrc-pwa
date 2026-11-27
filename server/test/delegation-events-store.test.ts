// D-9167, D-9168 (plan docs/superpowers/plans/2026-11-27-delegation-events-retention.md, PR-2): the contract row of `delegation_events`
// (migration 134) and the store's two writers of it, against a fixture `coord.db`. PR2-M1 and PR2-M2 are measured red against these rows.
import { describe, expect, it } from 'vitest';
import { delegationEventRowOfRecord } from '../src/coord/delegation-journal.js';
import { recoverDelegation } from '../src/coord/delegation-recovery.js';
import { repairDelegationProjection } from '../src/coord/delegation-db-projection.js';
import {
  DELEGATION_EVENTS_ALL, decodeDelegationEventsRow, stopDelegationEvents, type DelegationEventsRow,
} from '../src/coord/delegation-event-projection.js';
import type { DelegationJournalRecordV1 } from '../src/coord/delegation-model.js';
import { agentPre, bashPost, bashPre, evidenceRecords, freshStore, heldSequences, sessionStart, storePort } from './delegationEventsFixture.js';

const decoded = (store: ReturnType<typeof freshStore>['store']): DelegationEventsRow => {
  const read = store.delegationEventsRow();
  if (read.kind !== 'row') throw new Error(`no row: ${read.kind}`);
  const d = decodeDelegationEventsRow(read.raw);
  if (!d.ok) throw new Error(d.detail);
  return d.row;
};

/** A store holding one session's five evidence rows (1..5). */
async function populated() {
  const records = evidenceRecords([sessionStart(1), agentPre(2), bashPre(3), bashPost(4, 3), bashPre(5, ['wt-1'])]);
  const report = recoverDelegation(null, records);
  const { store } = freshStore();
  await repairDelegationProjection({ projection: storePort(store), checkpoint: report.state.checkpoint, evidence: report.facts!.evidence,
    journal: () => (async function* (): AsyncIterable<DelegationJournalRecordV1> { yield* records; })() });
  return { store, records };
}

describe('the contract row (migration 134, D-9167)', () => {
  it('a fresh database seeds one row reading `all` with no stop', () => {
    const { store } = freshStore();
    expect(decoded(store)).toEqual(DELEGATION_EVENTS_ALL);
    expect((store.db.prepare('SELECT COUNT(*) AS n FROM delegation_events_projection').get() as { n: number }).n).toBe(1);
  });

  it('the one whole-row writer round-trips every shape through the L1 codec, and stamps its time', () => {
    const { store } = freshStore();
    const rows: DelegationEventsRow[] = [
      { contract: { mode: 'thin', legacyBelow: 40, sweptBelow: 0 }, stop: null },
      stopDelegationEvents('rows-not-in-journal', 7, 0),
      { contract: { mode: 'all' }, stop: { at: 7, reason: 'replay-from-start', choiceAt: 3, noticedAt: 9 } },
      DELEGATION_EVENTS_ALL,
    ];
    rows.forEach((r, i) => {
      store.setDelegationEventsRow(r, 100 + i);
      expect(decoded(store)).toEqual(r);
      expect((store.db.prepare('SELECT updatedAt AS t FROM delegation_events_projection').get() as { t: number }).t).toBe(100 + i);
    });
  });

  it('a row deleted by hand is written again, not lost', () => {
    const { store } = freshStore();
    store.db.prepare('DELETE FROM delegation_events_projection').run();
    expect(store.delegationEventsRow()).toEqual({ kind: 'absent' });
    store.setDelegationEventsRow(DELEGATION_EVENTS_ALL, 1);
    expect(decoded(store)).toEqual(DELEGATION_EVENTS_ALL);
  });

  it('PR2-M2: a read that fails is `unreadable` with the reason, never `absent`', () => {
    const { store } = freshStore();
    store.db.exec('DROP TABLE delegation_events_projection');
    const read = store.delegationEventsRow();
    expect(read.kind).toBe('unreadable');
    expect(read.kind === 'unreadable' && read.detail).toMatch(/delegation_events_projection/);
  });
});

describe('a sweep batch (D-9168)', () => {
  it('deletes exactly the named sequences and moves sweptBelow, answering the rows deleted', async () => {
    const { store } = await populated();
    store.setDelegationEventsRow({ contract: { mode: 'thin', legacyBelow: 6, sweptBelow: 0 }, stop: null }, 1);
    expect(store.deleteDelegationEventsAt([3, 4], 5, 2)).toBe(2);
    expect(heldSequences(store)).toEqual([1, 2, 5]);
    expect(decoded(store).contract).toEqual({ mode: 'thin', legacyBelow: 6, sweptBelow: 5 });
    expect(store.deleteDelegationEventsAt([], 6, 3)).toBe(0);
    expect(decoded(store).contract).toEqual({ mode: 'thin', legacyBelow: 6, sweptBelow: 6 });
  });

  it('PR2-M1: a batch whose window cannot move rolls its deletes back (both or neither)', async () => {
    const { store } = await populated();
    expect(() => store.deleteDelegationEventsAt([3, 4], 5, 2)).toThrow(/not thin/);  // the seed is `all`: no window
    expect(heldSequences(store)).toEqual([1, 2, 3, 4, 5]);
    expect(decoded(store)).toEqual(DELEGATION_EVENTS_ALL);
  });

  it('a sequence SQLite does not hold deletes nothing and still moves the window', async () => {
    const { store, records } = await populated();
    store.setDelegationEventsRow({ contract: { mode: 'thin', legacyBelow: 9, sweptBelow: 0 }, stop: null }, 1);
    expect(store.deleteDelegationEventsAt([8], 9, 2)).toBe(0);
    expect(heldSequences(store)).toEqual(records.map((r) => r.sequence));
    expect(delegationEventRowOfRecord(records[0]!).journalSequence).toBe(1);
  });
});

describe('the page counts (D-9170)', () => {
  it('are whole numbers with the freelist inside the file', () => {
    const { store } = freshStore();
    const p = store.coordPageStats();
    expect([p.pageCount, p.freelistCount, p.pageSize].every((n) => Number.isSafeInteger(n) && n >= 0)).toBe(true);
    expect(p.freelistCount).toBeLessThanOrEqual(p.pageCount);
    expect(p.pageSize).toBeGreaterThan(0);
  });
});
