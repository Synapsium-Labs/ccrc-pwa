// Overlord W2, act journal plan Task A2, last stage: act rows A's two fix-round cases (#3664, review 4205: a fact changed between
// the append and the apply) run against the REAL act journal writer (`server/src/coord/overlordActJournal.ts#OverlordActJournal`),
// not the store suite's double. A real coordination database (every migration, the act rows' table and the journal's head row
// among them), a real journal file under `mkTmp`, the real guard behind a spy; never the live HOME.
//
// What each case holds, as the coordinator's GO for the last stage states it: the writer answers `journal-append`, and only the
// apply's savepoint is undone. So inside the caller's transaction the act row and its line are gone, while the journal's record
// and the head row the writer wrote before the apply still stand; the guard is told `trailing` for the acts journal at once; and
// a door that then ends its transaction without committing (the port's door contract) leaves the head row where it was.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import { serverActorOf } from '../src/auth/attributionIdentity.js';
import type { RecordedActor } from '../src/auth/callerIdentity.js';
import { OverlordAuthorityGuard } from '../src/coord/overlordAuthorityGuard.js';
import type { AuthorityWriterFailure } from '../src/coord/overlordAuthorityJournal.js';
import type { OverlordJournalName } from '../src/coord/overlordAuthorityCoherence.js';
import { OVERLORD_ACTS_BASENAME } from '../src/coord/overlordActRecords.js';
import { OverlordActJournal, overlordActsFileAt } from '../src/coord/overlordActJournal.js';
import {
  actById, settleActInTx, writeActInTx, type ActJournalAppend, type ActJournalPort, type ActWrite, type ActWritten,
} from '../src/coord/overlordActsStore.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const AT = 1_800_000_000_000;

function rig() {
  const dir = mkTmp('ccrc-actjournal-store-');
  const leaf = path.join(dir, OVERLORD_ACTS_BASENAME);
  const db = openCoordDb(path.join(dir, 'coord.db'));
  const failures: [AuthorityWriterFailure, OverlordJournalName | undefined][] = [];
  let journal!: OverlordActJournal;
  const guard = new OverlordAuthorityGuard({ healTornTail: () => ({ kind: 'no-tail' }), measure: () => journal.measure(db) });
  const spy = { state: () => guard.state(), writerFailed: (c: AuthorityWriterFailure, j?: OverlordJournalName) => { failures.push([c, j]); guard.writerFailed(c, j); } };
  journal = new OverlordActJournal(overlordActsFileAt(dir), { clock: fakeTime({ wallMs: Date.parse('2026-11-28T11:00:00.000Z') }).ports.clock }, spy);
  guard.bootVerdict(journal.measure(db));
  return {
    db, journal, guard, failures,
    lines: (): string[] => (existsSync(leaf) ? readFileSync(leaf, 'utf8').split('\n').filter((l) => l !== '') : []),
    headSequence: (): number | null => (db.prepare('SELECT sequence FROM overlord_act_journal_head').get() as { sequence: number } | undefined)?.sequence ?? null,
    /** The journal's highest act id, as the writer's caller passes it on every write (the coordinator's call 2007). */
    highest: (): number | null => { const h = journal.readHighest(); return h.kind === 'measured' ? h.act : null; },
  };
}
const actLines = (db: DatabaseSync): number =>
  (db.prepare("SELECT count(*) AS n FROM overlord_sequence WHERE kind = 'act'").get() as { n: number }).n;

/** The store suite's write input (`actCases.ts#applyInput`), with the journal's highest as the caller passes it. */
let seed = 0;
const input = (actor: RecordedActor, id: number, state: 'pending' | 'done', journalHighest: number | null): ActWrite => ({
  allow: { act: 'relay', effect: null, programme: 'prog-a', incarnation: null, naturalKey: '', cell: 'allow', generationId: 2 },
  kind: 'relay', state, target: { kind: 'request', id, revision: 0 }, targets: [{ kind: 'request', id: String(id), revision: 0 }],
  requestId: id, widens: null, opens: null, summary: 'route it', why: 'its owner', authority: 'own', actor,
  identityStrength: 'attributed', isolation: 'shared-user', fence: { term: 1, generationId: 2, model: null, lane: null },
  op: { key: (++seed).toString(16).padStart(32, 'a'), door: 'relay', callSha256: 'c'.repeat(64), sessionId: 'overlord-a' },
  checks: [], journalHighest,
});
/** The real writer, with `between` run after its append and its head row and before the store's apply: a fact changed under the
 *  plan. The wrapper adds no answer of its own; every word is the writer's. */
const between = (j: ActJournalPort, fn: () => void): ActJournalPort => ({
  appendInTx: (db, records, apply): ActJournalAppend => j.appendInTx(db, records, () => { fn(); apply(); }),
});
const LANE = serverActorOf('lane-a');

/** A door's transaction: it commits on an answer that is ok, and on any other it reads what stands inside the transaction, then
 *  throws out of it so it rolls back (the port's door contract). */
function door<T extends ActWritten | { ok: boolean }>(db: DatabaseSync, act: () => T, inside: (answer: T) => void): T {
  let answer: T | undefined;
  try {
    tx(db, () => { answer = act(); if (!answer.ok) { inside(answer); throw new Error('the door refuses and rolls back'); } });
  } catch (e) { if (!(e instanceof Error) || e.message !== 'the door refuses and rolls back') throw e; }
  return answer!;
}

describe('act rows A\'s fix-round cases against the real act journal writer', () => {
  it('two plain writes and a settle go through the real writer: each answers ok with its last record\'s sequence', () => {
    const r = rig();
    const a = tx(r.db, () => writeActInTx(r.db, r.journal, input(LANE, 7, 'pending', r.highest()), AT));
    expect(a).toMatchObject({ ok: true, act: { id: 1, state: 'pending' } });
    const b = tx(r.db, () => writeActInTx(r.db, r.journal, input(LANE, 8, 'done', r.highest()), AT));
    expect(b).toMatchObject({ ok: true, act: { id: 2, state: 'done' } });
    expect(tx(r.db, () => settleActInTx(r.db, r.journal, 1, 'done', 'lane', AT + 1))).toMatchObject({ ok: true, act: { state: 'done' } });
    expect(r.lines()).toHaveLength(3);
    expect(r.headSequence()).toBe(3);
    expect(actLines(r.db)).toBe(3);
    expect(r.failures).toEqual([]);
    expect(r.journal.measure(r.db)).toEqual({ kind: 'coherent' });
  });

  it('the write\'s apply throws when the highest id moved between the append and the apply: journal-append, no row, no line', () => {
    const r = rig();
    // #3664's case as it stands (its input passes no journal highest): the plan reserves id 3; row 2 is then dropped, so the
    // re-made plan reserves 2 and the apply must not insert 3.
    for (const id of [7, 8]) expect(tx(r.db, () => writeActInTx(r.db, r.journal, input(LANE, id, 'done', null), AT)).ok).toBe(true);
    const moved = between(r.journal, () => { r.db.prepare('DELETE FROM overlord_acts WHERE id = 2').run(); });
    const answer = door(r.db, () => writeActInTx(r.db, moved, input(LANE, 9, 'done', null), AT), () => {
      expect(actById(r.db, 3)).toEqual({ kind: 'measured', value: 'absent' });
      expect(actLines(r.db)).toBe(2);
      // Only the apply's savepoint was undone: the head row the writer wrote before the apply still stands in the transaction.
      expect(r.headSequence()).toBe(3);
    });
    expect(answer).toMatchObject({ ok: false, error: 'journal-append' });
    expect(r.failures).toEqual([['trailing', 'acts']]);
    expect(r.guard.state()).toMatchObject({ kind: 'rolled-back', cause: 'trailing', journal: 'acts' });
    // The record stands in the file; the door's rollback took the head row back with the dropped row.
    expect(r.lines()).toHaveLength(3);
    expect(r.headSequence()).toBe(2);
    expect(actById(r.db, 2)).toMatchObject({ kind: 'measured', value: { id: 2 } });
  });

  it('with the journal\'s highest passed, as the writer\'s caller does, a dropped row moves nothing, and a raised one still throws', () => {
    const r = rig();
    for (const id of [7, 8]) expect(tx(r.db, () => writeActInTx(r.db, r.journal, input(LANE, id, 'done', r.highest()), AT)).ok).toBe(true);
    // The journal's highest (2) holds the next id at 3 whatever the table's highest reads, so a dropped row is no fact change.
    const dropped = between(r.journal, () => { r.db.prepare('DELETE FROM overlord_acts WHERE id = 2').run(); });
    const kept = door(r.db, () => writeActInTx(r.db, dropped, input(LANE, 9, 'done', r.highest()), AT), () => undefined);
    expect(kept).toMatchObject({ ok: true, act: { id: 3 } });
    // A row raised above the journal's highest moves the re-made plan's id to 6, so the apply must not insert 4.
    const raised = between(r.journal, () => { r.db.prepare('UPDATE overlord_acts SET id = 5 WHERE id = 3').run(); });
    const answer = door(r.db, () => writeActInTx(r.db, raised, input(LANE, 10, 'done', r.highest()), AT), () => {
      expect(actById(r.db, 4)).toEqual({ kind: 'measured', value: 'absent' });
      expect(actById(r.db, 6)).toEqual({ kind: 'measured', value: 'absent' });
      expect(r.headSequence()).toBe(4);
    });
    expect(answer).toMatchObject({ ok: false, error: 'journal-append' });
    expect(r.failures).toEqual([['trailing', 'acts']]);
    expect(r.lines()).toHaveLength(4);
    expect(r.headSequence()).toBe(3);
  });

  it('the settle\'s apply throws when the row\'s state moved between the append and the apply: journal-append, the state left', () => {
    const r = rig();
    expect(tx(r.db, () => writeActInTx(r.db, r.journal, input(LANE, 7, 'pending', r.highest()), AT)).ok).toBe(true);
    // The plan reads from = pending; the row is then moved to unknown, from which the lane may also settle done, so the re-made
    // plan passes with another from, and the apply must refuse it rather than write done over unknown.
    const moved = between(r.journal, () => { r.db.prepare("UPDATE overlord_acts SET state = 'unknown' WHERE id = 1").run(); });
    const answer = door(r.db, () => settleActInTx(r.db, moved, 1, 'done', 'lane', AT + 1), () => {
      expect(actById(r.db, 1)).toMatchObject({ kind: 'measured', value: { state: 'unknown' } });
      expect(actLines(r.db)).toBe(1);
      expect(r.headSequence()).toBe(2);
    });
    expect(answer).toMatchObject({ ok: false, error: 'journal-append' });
    expect(r.failures).toEqual([['trailing', 'acts']]);
    expect(r.lines()).toHaveLength(2);
    expect(r.headSequence()).toBe(1);
    expect(actById(r.db, 1)).toMatchObject({ kind: 'measured', value: { state: 'pending' } });
  });
});
