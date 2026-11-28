// D-9167 (plan docs/superpowers/plans/2026-11-27-delegation-events-retention.md, PR-1): CHARACTERIZATION, green on `main` against the
// code as it is, BEFORE the membership changes. Today SQLite's `delegation_events` holds every retained evidence record, and the
// repair keeps it so: these rows pin the in-memory index's counts, the per-pass skip, the full repair's catch-up, its replay from the
// start, its wipe, step 0's clean-up below the journal, and that an applier projects every class. PR-3 changes the index's
// membership; every row here must stay green there for a port that carries no `events` member (the contract is then `all` for good).
import { afterEach, describe, expect, it } from 'vitest';
import { DelegationEvidenceIndex, recoverDelegation } from '../src/coord/delegation-recovery.js';
import { repairDelegationProjection } from '../src/coord/delegation-db-projection.js';
import { delegationEventRowOfRecord } from '../src/coord/delegation-journal.js';
import type { DelegationJournalRecordV1 } from '../src/coord/delegation-model.js';
import type { DelegationDurability } from '../src/coord/delegation-durability.js';
import {
  agentPre, bashPost, bashPre, batchOf, evidenceRecords, freshStore, heldSequences, openApplier, sessionStart, storePort,
} from './delegationEventsFixture.js';

const opened: DelegationDurability[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((d) => d.close().catch(() => undefined))); });

const stream = (records: readonly DelegationJournalRecordV1[]) => (): AsyncIterable<DelegationJournalRecordV1> =>
  (async function* () { for (const r of records) yield r; })();

/** A recovered journal of one session's mixed evidence: a session start, an agent call and three Bash records. */
function world() {
  const records = evidenceRecords([sessionStart(1), agentPre(2), bashPre(3), bashPost(4, 3), bashPre(5, ['wt-1'])]);
  const report = recoverDelegation(null, records);
  if (report.facts === null) throw new Error(`recovery failed: ${JSON.stringify(report.failure)}`);
  const { store } = freshStore();
  const port = storePort(store);
  return { records, cp: report.state.checkpoint, evidence: report.facts.evidence, store, port };
}

describe('characterization: the evidence index (D-9167, as on main)', () => {
  it('counts every evidence sequence, answers the last, and drops through a cut keeping the carried', () => {
    const ix = new DelegationEvidenceIndex();
    for (const s of [1, 2, 4, 7, 9]) ix.add(s);
    expect([ix.total, ix.last, ix.countAtOrBelow(4), ix.countAtOrBelow(0)]).toEqual([5, 9, 3, 0]);
    expect(ix.sequencesAtOrBelow(7)).toEqual([1, 2, 4, 7]);
    ix.dropThrough(7, [2]);
    expect([ix.total, ix.last, ix.sequencesAtOrBelow(9)]).toEqual([2, 9, [2, 9]]);
  });

  it('a recovery indexes every evidence record of every class', () => {
    const { evidence } = world();
    expect([evidence.total, evidence.last]).toEqual([5, 5]);
  });
});

describe('characterization: the repair keeps SQLite equal to every retained record (D-9167, as on main)', () => {
  it('on an empty table the repair inserts every record of every class, resuming from 0', async () => {
    const w = world();
    const r = await repairDelegationProjection({ projection: w.port, checkpoint: w.cp, journal: stream(w.records), evidence: w.evidence });
    expect([r.inserted, r.fullReplay, r.wipedAll, r.prunedBelow]).toEqual([5, false, false, 0]);
    expect(heldSequences(w.store)).toEqual([1, 2, 3, 4, 5]);
    expect(w.port.eventStats()).toEqual({ count: w.evidence.total, maxSequence: w.evidence.last });
  });

  it('a row missing below SQLite\'s maximum is replayed from the start', async () => {
    const w = world();
    await repairDelegationProjection({ projection: w.port, checkpoint: w.cp, journal: stream(w.records), evidence: w.evidence });
    w.store.db.prepare('DELETE FROM delegation_events WHERE journalSequence = 3').run();
    const r = await repairDelegationProjection({ projection: w.port, checkpoint: w.cp, journal: stream(w.records), evidence: w.evidence });
    expect([r.fullReplay, r.inserted, r.wipedAll]).toEqual([true, 1, false]);
    expect(heldSequences(w.store)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a row the journal does not hold makes the repair wipe every event and replay', async () => {
    const w = world();
    await repairDelegationProjection({ projection: w.port, checkpoint: w.cp, journal: stream(w.records), evidence: w.evidence });
    const stray = evidenceRecords([sessionStart(1), agentPre(2), bashPre(3), bashPost(4, 3), bashPre(5, ['wt-1']), bashPost(6)])[5]!;
    w.port.insertEvents([delegationEventRowOfRecord(stray)]);
    const r = await repairDelegationProjection({ projection: w.port, checkpoint: w.cp, journal: stream(w.records), evidence: w.evidence });
    expect(r.wipedAll).toBe(true);
    expect(heldSequences(w.store)).toEqual([1, 2, 3, 4, 5]);
  });

  it('step 0 deletes rows below the journal\'s first retained sequence that are not carried', async () => {
    const w = world();
    await repairDelegationProjection({ projection: w.port, checkpoint: w.cp, journal: stream(w.records), evidence: w.evidence });
    w.evidence.dropThrough(3, [2]);                              // a cut through 3 that carried 2, whose SQLite delete never ran
    const r = await repairDelegationProjection({ projection: w.port, checkpoint: w.cp, journal: stream(w.records.slice(3)), evidence: w.evidence, retainedFrom: 4 });
    expect(r.prunedBelow).toBe(2);
    expect(heldSequences(w.store)).toEqual([2, 4, 5]);
  });
});

describe('characterization: an applier projects every class (D-9167, as on main)', () => {
  it('Bash records with and without a listing reach SQLite beside the rest, and the per-pass repair then skips', async () => {
    const { dir, store } = freshStore();
    const d = await openApplier(dir, storePort(store));
    opened.push(d);
    await d.applyAccepted(batchOf([sessionStart(1), agentPre(2), bashPre(3), bashPost(4, 3), bashPre(5, ['wt-1'])]));
    expect(heldSequences(store)).toEqual([1, 2, 3, 4, 5]);
    await d.repairProjection({ perPass: true });
    const again = await d.repairProjection({ perPass: true });
    expect(again?.skipped).toBe(true);
  });
});
