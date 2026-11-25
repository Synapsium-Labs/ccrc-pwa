// The real-journal rollback oracles: the designation suite runs these against the store, and the
// mutation floor runs the same cases against each changed writer or fence guard.
import { copyFileSync, mkdirSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { expect } from 'vitest';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { openCoordDb } from '../src/coord/db.js';
import { OverlordAuthorityGuard } from '../src/coord/overlordAuthorityGuard.js';
import { OverlordAuthorityJournal, overlordAuthorityFileAt } from '../src/coord/overlordAuthorityJournal.js';
import type { AuthorityAppender } from '../src/coord/overlordDesignationStore.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp } from './tmpHelpers.js';

const AT = 1_800_000_000_000;
const BOUND = 'overlord-quiet-otter';
const PENDING = 'overlord-brisk-heron';
const GEN = '11111111-2222-3333-4444-555555555555';
const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('operator-a', '0123456789abcdef'));
const RETIRE = { actor: OPERATOR, at: AT + 2, opKey: 'op-retire-1' };
const SETTINGS_RECORDS = ['authority-account-set', 'authority-model-class'];
const LIVE_RECORDS = [...SETTINGS_RECORDS, 'authority-designate'];
const TRAILING = { kind: 'rolled-back', cause: 'trailing' };

type Store = typeof import('../src/coord/overlordDesignationStore.js');
let template: string | undefined;

function fixture() {
  if (template === undefined) {
    const file = path.join(mkTmp('ccrc-fence-template-'), 'coord.db');
    openCoordDb(file).close();
    template = file;
  }
  const dir = path.join(mkTmp('ccrc-designation-journal-'), '.ccrc');
  mkdirSync(dir);
  const file = path.join(dir, 'coord.db');
  copyFileSync(template, file);
  const db = openCoordDb(file);
  const clock = fakeTime({ wallMs: AT }).ports.clock;
  const guard = new OverlordAuthorityGuard({ healTornTail: () => journal.healTornTail(db), measure: () => journal.measure(db) });
  const journal: OverlordAuthorityJournal = new OverlordAuthorityJournal(overlordAuthorityFileAt(dir), { clock }, guard);
  guard.bootVerdict(journal.measure(db));
  const snapshot = () => ({ row: db.prepare('SELECT * FROM overlord_designation').get(),
    head: db.prepare('SELECT * FROM overlord_authority_head').get(), lines: db.prepare('SELECT * FROM overlord_sequence ORDER BY seq').all() });
  const recordKinds = () => {
    const file = journal.readVerified();
    if (file.kind !== 'records') throw new Error(`expected verified records, got ${file.kind}`);
    return file.records.map(({ entry }) => entry.kind);
  };
  return { db, guard, journal, snapshot, recordKinds };
}

type Fixture = ReturnType<typeof fixture>;
const refusesStamp = (db: DatabaseSync) =>
  db.exec("CREATE TRIGGER refuse BEFORE INSERT ON overlord_sequence BEGIN SELECT RAISE(ABORT, 'stamp refused'); END");
const entersPending = (m: Store, { db, journal }: Fixture) => m.designatePending(db, journal, {
  sessionId: BOUND, deadlineAt: AT + 60_000, model: 'opus', accountPools: { pools: ['pool-a'], untagged: true },
  actor: OPERATOR, at: AT, opKey: 'op-designate-1',
});
function entersLive(m: Store, f: Fixture, withPending = false): void {
  expect(entersPending(m, f)).toEqual({ ok: true, changed: true });
  expect(m.goLive(f.db, f.journal, BOUND, GEN, AT + 1)).toMatchObject({ ok: true, changed: true });
  if (withPending) {
    // The rebind writer is outside PR A; seed the same pending columns that retire consumes.
    f.db.prepare("UPDATE overlord_designation SET pendingId = ?, pendingKind = 'rebind', pendingSince = ?, pendingDeadlineAt = ?, "
      + 'pendingActor = actor, pendingActorKind = actorKind, pendingActorIssuer = actorIssuer, pendingActorStrength = actorStrength')
      .run(PENDING, AT + 1, AT + 60_000);
  }
}

export function designationFenceCases(m: Store): Record<string, () => void> {
  const guarded = (run: (f: Fixture) => void) => () => {
    const f = fixture();
    try {
      expect(f.guard.state()).toEqual({ kind: 'coherent' });
      run(f);
    } finally { f.db.close(); }
  };
  const retireStampFailure = (withPending: boolean) => guarded((f) => {
    entersLive(m, f, withPending);
    const before = f.snapshot();
    // When there is a pending attempt its `failed` line is inserted first; a later refusal rolls it back too.
    f.db.exec("CREATE TRIGGER refuse BEFORE INSERT ON overlord_sequence WHEN NEW.state = 'retired' BEGIN SELECT RAISE(ABORT, 'retired stamp refused'); END");
    expect(() => m.retire(f.db, f.journal, RETIRE)).toThrow(m.SequenceStampRefused);
    expect(f.guard.state()).toEqual(TRAILING);
    expect(f.snapshot()).toEqual(before);
    expect(f.recordKinds()).toEqual([...LIVE_RECORDS, 'authority-retire']);
  });
  return {
    'fences immediately when a go-live stamp fails after one durable append': guarded((f) => {
      expect(entersPending(m, f)).toEqual({ ok: true, changed: true });
      const before = f.snapshot();
      refusesStamp(f.db);
      expect(() => m.goLive(f.db, f.journal, BOUND, GEN, AT + 1)).toThrow(m.SequenceStampRefused);
      expect(f.guard.state()).toEqual(TRAILING);
      expect(f.snapshot()).toEqual(before);
      expect(f.recordKinds()).toEqual(LIVE_RECORDS);
    }),
    'fences immediately when a pending stamp fails after two durable appends': guarded((f) => {
      refusesStamp(f.db);
      expect(() => entersPending(m, f)).toThrow(m.SequenceStampRefused);
      expect(f.guard.state()).toEqual(TRAILING);
      expect(f.snapshot()).toEqual({ row: undefined, head: undefined, lines: [] });
      expect(f.recordKinds()).toEqual(SETTINGS_RECORDS);
      expect(f.journal.measure(f.db)).toEqual({ kind: 'rolled-back', cause: 'ahead' });
    }),
    'fences immediately when a live retire stamp fails without a pending attempt': retireStampFailure(false),
    'fences immediately when a live retire stamp fails with a pending attempt': retireStampFailure(true),
    'does not fence on a pending-only retire stamp failure without an append': guarded((f) => {
      expect(entersPending(m, f)).toEqual({ ok: true, changed: true });
      const before = f.snapshot();
      refusesStamp(f.db);
      expect(() => m.retire(f.db, f.journal, RETIRE)).toThrow(m.SequenceStampRefused);
      expect(f.guard.state()).toEqual({ kind: 'coherent' });
      expect(f.snapshot()).toEqual(before);
      expect(f.recordKinds()).toEqual(SETTINGS_RECORDS);
    }),
    'fences when the designation row write itself throws after the append': guarded((f) => {
      entersLive(m, f);
      const before = f.snapshot();
      f.db.exec("CREATE TRIGGER refuse_row BEFORE UPDATE ON overlord_designation BEGIN SELECT RAISE(ABORT, 'designation update refused'); END");
      expect(() => m.retire(f.db, f.journal, RETIRE)).toThrow(/^designation update refused$/);
      expect(f.guard.state()).toEqual(TRAILING);
      expect(f.snapshot()).toEqual(before);
      expect(f.recordKinds()).toEqual([...LIVE_RECORDS, 'authority-retire']);
    }),
    'propagates the original stamp refusal even when the receipt throws': guarded((f) => {
      expect(entersPending(m, f)).toEqual({ ok: true, changed: true });
      const before = f.snapshot();
      let called = false;
      const throwing: AuthorityAppender = { appendInTx(db, entry) {
        const answer = f.journal.appendInTx(db, entry);
        if (!answer.ok || answer.kind !== 'appended') return answer;
        return { ...answer, postAppendFailed() {
          called = true;
          throw new Error('receipt failed');
        } };
      } };
      refusesStamp(f.db);
      expect(() => m.goLive(f.db, throwing, BOUND, GEN, AT + 1)).toThrow(m.SequenceStampRefused);
      expect(called).toBe(true);
      expect(f.snapshot()).toEqual(before);
      expect(f.recordKinds()).toEqual(LIVE_RECORDS);
    }),
    'a row-only live retire still stamps the failed and retired designation lines': guarded((f) => {
      entersLive(m, f, true);
      f.guard.witnessRefused('witness-epoch');
      const before = f.snapshot();
      expect(m.retire(f.db, f.journal, RETIRE)).toEqual({ ok: true, changed: true, term: 2, owed: [BOUND, PENDING] });
      const after = f.snapshot();
      const attribution = { at: RETIRE.at, kind: 'designation', actor: OPERATOR.subject, actorKind: OPERATOR.kind };
      expect(after.lines.slice(0, before.lines.length)).toEqual(before.lines);
      expect(after.lines.slice(before.lines.length)).toEqual([
        { seq: before.lines.length + 1, ...attribution, id: PENDING, state: 'failed' },
        { seq: before.lines.length + 2, ...attribution, id: BOUND, state: 'retired' },
      ]);
      expect(after.row).toMatchObject({ sessionId: null, pendingId: null, term: 2 });
      expect(after.head).toEqual(before.head);
      expect(f.recordKinds()).toEqual(LIVE_RECORDS);
    }),
  };
}
