// The mail hold's set (mid-turn mail PR 2, plan Tasks 2.1 and 2.5; spec §3.2). Task 2.1 pins `inboxFor`'s set over one
// row in each delivery state BEFORE its predicate is named once (`ACKABLE_OUTSTANDING_SQL`), so the move is checked by an
// unchanged test. Task 2.5 holds the urgent hold to that same set: the hold's deliveries are exactly the urgent members
// of `inboxFor`'s set, in both directions, over every state.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import {
  CoordStore, MAIL_CHILD_RECLAIMED_ERROR, MAIL_REPLAY_CEILING_ERROR, MAIL_RUN_CLOSED_ERROR,
} from '../src/coord/store.js';
import { MAIL_MAX_ATTEMPTS } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_000_000_000_000;
const TO = 'lane-a-worker';
const COORD = 'lane-a-coordinator';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-mail-hold-'), '.ccrc', 'coord.db')));

const openRun = (s: CoordStore, wave: number): number => {
  const r = s.openRun({ program: 'program-a', title: 'run-a', project: 'project-a', wave, waveOf: 5, claimedBy: COORD });
  if (!('id' in r)) throw new Error('openRun refused');
  return r.id;
};

/** One delivery to `TO`. `urgentAs` is passed only when given, so the Task 2.1 rows are the insert main has today. */
type Urgent = 'coordinator' | 'overlord' | undefined;
const queued = (s: CoordStore, runId: number | null, urgentAs: Urgent): number => {
  const fields = { fromId: COORD, fromUuid: 'u-coordinator', toId: TO, runId, kind: 'status' as const,
    subject: 'fixture', body: 'x', artifacts: [] as string[] };
  const m = s.insertMail(urgentAs === undefined ? fields : { ...fields, urgentAs } as typeof fields);
  return s.queueDelivery(m.id, TO, `<mail>${m.id}</mail>`).id;
};

/** One row in each state the inbox predicate distinguishes (plan Task 2.1). `urgent` marks every row urgent (Task 2.5). */
const fixture = (urgent: Urgent) => {
  const s = store();
  const live = openRun(s, 1);
  const dead = openRun(s, 2);
  const closing = openRun(s, 3);
  const row = (runId: number | null = null) => queued(s, runId, urgent);
  const queuedRow = row();
  const delivered = row(live);
  s.markDelivered(delivered, NOW);
  const acked = row(live);
  s.markAcked(acked, NOW);
  const maxAttempts = row();
  s.db.prepare('UPDATE mail_deliveries SET attempts = ? WHERE id = ?').run(MAIL_MAX_ATTEMPTS, maxAttempts);
  s.rejectDelivery(maxAttempts, 'undeliverable', `send failed ${MAIL_MAX_ATTEMPTS} times`);
  const ceilingOpen = row(live);
  s.rejectDelivery(ceilingOpen, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);
  const ceilingClosed = row(dead);
  s.rejectDelivery(ceilingClosed, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);
  expect(s.advance(dead, 'failed', 'coordinator')).toMatchObject({ ok: true });
  const parkCeiling = row();
  s.rejectDelivery(parkCeiling, 'undeliverable', 'park ceiling fixture');
  const runClosed = row(closing);
  expect(s.cancelOutstandingDeliveries(closing)).toMatchObject({ changed: 1 });
  const childReclaimed = row();
  s.rejectDelivery(childReclaimed, 'undeliverable', MAIL_CHILD_RECLAIMED_ERROR);
  return { s, live, queuedRow, delivered, acked, maxAttempts, ceilingOpen, ceilingClosed, parkCeiling, runClosed,
    childReclaimed };
};

const inbox = (s: CoordStore, to = TO): number[] => s.inboxFor(to).map((r) => r.deliveryId);

describe("inboxFor's set, pinned before the move (plan Task 2.1)", () => {
  it('prints a queued, a delivered and an open run replay-ceiling row, and no other state', () => {
    const f = fixture(undefined);
    expect(inbox(f.s)).toEqual([f.queuedRow, f.delivered, f.ceilingOpen]);
  });

  it("leaves out an acked row, a MAIL_MAX_ATTEMPTS rejection, a closed run's replay-ceiling row, the park ceiling, 'run closed' and 'child workspace reclaimed'", () => {
    const f = fixture(undefined);
    const got = new Set(inbox(f.s));
    for (const [name, id] of Object.entries({ acked: f.acked, maxAttempts: f.maxAttempts, ceilingClosed: f.ceilingClosed,
      parkCeiling: f.parkCeiling, runClosed: f.runClosed, childReclaimed: f.childReclaimed })) {
      expect(got.has(id), name).toBe(false);
    }
    expect(MAIL_RUN_CLOSED_ERROR).toBe('run closed');
    expect(MAIL_CHILD_RECLAIMED_ERROR).toBe('child workspace reclaimed');
  });
});
