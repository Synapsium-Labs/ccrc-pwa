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
  const m = s.insertMail(urgentAs === undefined ? fields : { ...fields, urgentAs });
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

const urgentIds = (s: CoordStore, to = TO): number[] =>
  (s.urgentHolds().get(to) ?? []).map((h) => h.deliveryId);
const isUrgent = (s: CoordStore, deliveryId: number): boolean =>
  (s.db.prepare('SELECT m.urgentAs AS u FROM mail_deliveries d JOIN mail m ON m.id = d.mailId WHERE d.id = ?')
    .get(deliveryId) as { u: string | null }).u !== null;

describe('the urgent hold (plan Task 2.5; spec §3.2)', () => {
  it('answers, per recipient, the urgent deliveries in delivery-id order, each with its role', () => {
    const f = fixture('coordinator');
    const over = queued(f.s, null, 'overlord');
    queued(f.s, null, undefined);
    const other = f.s.insertMail({ fromId: COORD, fromUuid: 'u', toId: 'lane-b-worker', runId: null, kind: 'status',
      subject: 's', body: 'b', artifacts: [], urgentAs: 'coordinator' });
    const otherDelivery = f.s.queueDelivery(other.id, 'lane-b-worker', 'e').id;
    const holds = f.s.urgentHolds();
    expect(holds.get(TO)).toEqual([
      { deliveryId: f.queuedRow, role: 'coordinator' }, { deliveryId: f.delivered, role: 'coordinator' },
      { deliveryId: f.ceilingOpen, role: 'coordinator' }, { deliveryId: over, role: 'overlord' },
    ]);
    expect(holds.get('lane-b-worker')).toEqual([{ deliveryId: otherDelivery, role: 'coordinator' }]);
  });

  it("set equality: the hold is exactly the urgent members of inboxFor's set, in both directions, over every state", () => {
    for (const urgent of ['coordinator', undefined] as const) {
      const f = fixture(urgent);
      // A mix: the fixture's rows carry `urgent`, and one row of the other kind joins each state's neighbours.
      queued(f.s, f.live, urgent === undefined ? 'coordinator' : undefined);
      const all = (f.s.db.prepare('SELECT id FROM mail_deliveries WHERE toId = ? ORDER BY id').all(TO) as { id: number }[])
        .map((r) => r.id);
      const set = new Set(inbox(f.s));
      const hold = urgentIds(f.s);
      expect(hold).toEqual([...hold].sort((a, b) => a - b));
      for (const id of all) expect(hold.includes(id), `delivery ${id}`).toBe(set.has(id) && isUrgent(f.s, id));
    }
  }, 60_000); // two fresh stores, each running every migration: about 8 s apiece on a loaded box

  it("closing the run with an urgent mail unread empties the hold, and so does reclaiming the child", () => {
    const f = fixture(undefined);
    const onRun = queued(f.s, f.live, 'coordinator');
    expect(urgentIds(f.s)).toEqual([onRun]);
    f.s.cancelOutstandingDeliveries(f.live);
    expect(urgentIds(f.s)).toEqual([]);
    const peer = queued(f.s, null, 'coordinator');
    expect(urgentIds(f.s)).toEqual([peer]);
    f.s.cancelDeliveriesTo(TO);
    expect(urgentIds(f.s)).toEqual([]);
  });

  it('acking empties it', () => {
    const f = fixture(undefined);
    const id = queued(f.s, f.live, 'coordinator');
    f.s.markDelivered(id, NOW);
    expect(urgentIds(f.s)).toEqual([id]);
    expect(f.s.markAcked(id, NOW)).toMatchObject({ ok: true });
    expect(f.s.urgentHolds().has(TO)).toBe(false);
  });

  it('urgentOutstanding is keyed on the sender and recipient pair, over the same set', () => {
    const f = fixture(undefined);
    expect(f.s.urgentOutstanding(COORD, TO)).toBe(false);
    const id = queued(f.s, f.live, 'coordinator');
    expect(f.s.urgentOutstanding(COORD, TO)).toBe(true);
    expect(f.s.urgentOutstanding('lane-b-coordinator', TO)).toBe(false);
    expect(f.s.urgentOutstanding(COORD, 'lane-b-worker')).toBe(false);
    f.s.markAcked(id, NOW);
    expect(f.s.urgentOutstanding(COORD, TO)).toBe(false);
  });
});
