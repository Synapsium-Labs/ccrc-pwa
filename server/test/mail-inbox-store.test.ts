// D-6777 (mail inbox, MI-4): `CoordStore.inboxFor` selects the rows a human
// still owes attention AND can ack: the ack door's guard AND the mailbox's read
// predicate. `abandonedCount` is the rest of what `outstandingMailFor` lists.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_REPLAY_CEILING_ERROR, MAIL_RUN_CLOSED_ERROR } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_000_000_000_000;
const TO = 'demo-quiet-mesa';
const OTHER = 'demo-calm-ridge';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-inbox-'), '.ccrc', 'coord.db')));

const openRun = (s: CoordStore, wave = 1): number => {
  const r = s.openRun({ program: 'program-a', title: 'run-a', project: 'project-a',
                        wave, waveOf: 5, claimedBy: 'demo-coordinator' });
  if (!('id' in r)) throw new Error('openRun refused');
  return r.id;
};

const queued = (s: CoordStore, toId = TO, runId: number | null = null): number => {
  const m = s.insertMail({ fromId: 'demo-sender', fromUuid: 'u-sender', toId, runId,
                           kind: 'status', subject: 'fixture', body: 'x', artifacts: [] });
  return s.queueDelivery(m.id, toId, `<mail>${m.id}</mail>`).id;
};

interface Fixture {
  s: CoordStore;
  queued: number; parked: number; delivered: number;
  ceilingLive: number; ceilingNoRun: number;
  acked: number; runClosedPark: number; parkCeiling: number; ceilingClosedRun: number;
  other: number;
}

const fixture = (): Fixture => {
  const s = store();
  const live = openRun(s, 1);
  const dead = openRun(s, 2);
  const q = queued(s);
  const parked = queued(s);
  s.db.prepare('UPDATE mail_deliveries SET parkedAt = ? WHERE id = ?').run(NOW, parked);
  const delivered = queued(s);
  s.markDelivered(delivered, NOW);
  const ceilingLive = queued(s, TO, live);
  s.rejectDelivery(ceilingLive, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);
  const ceilingNoRun = queued(s);
  s.rejectDelivery(ceilingNoRun, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);
  const acked = queued(s);
  s.markAcked(acked, NOW);
  const runClosedPark = queued(s, TO, live);
  s.rejectDelivery(runClosedPark, 'undeliverable', MAIL_RUN_CLOSED_ERROR);
  const parkCeiling = queued(s);
  s.rejectDelivery(parkCeiling, 'undeliverable', 'park ceiling fixture');
  const ceilingClosedRun = queued(s, TO, dead);
  s.rejectDelivery(ceilingClosedRun, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);
  expect(s.advance(dead, 'failed', 'coordinator')).toMatchObject({ ok: true });
  const other = queued(s, OTHER);
  return { s, queued: q, parked, delivered, ceilingLive, ceilingNoRun, acked,
           runClosedPark, parkCeiling, ceilingClosedRun, other };
};

const ids = (rows: { deliveryId: number }[]): number[] => rows.map((r) => r.deliveryId);

describe('CoordStore.inboxFor (D-6777)', () => {
  it('returns a queued, a parked, a delivered, a replay-ceiling row of a live run and a replay-ceiling row with no run, and not an acked, a run closed park or a park-ceiling rejection', () => {
    const f = fixture();
    const got = ids(f.s.inboxFor(TO));
    expect(got).toEqual([f.queued, f.parked, f.delivered, f.ceilingLive, f.ceilingNoRun]);
    for (const n of [f.acked, f.runClosedPark, f.parkCeiling]) expect(got).not.toContain(n);
  });

  it('a replay-ceiling row whose run is closed is neither printed nor counted', () => {
    const f = fixture();
    expect(ids(f.s.inboxFor(TO))).not.toContain(f.ceilingClosedRun);
    expect(f.s.outstandingMailFor(TO).map((m) => m.id)).not.toContain(f.ceilingClosedRun);
    // The ack door still accepts it, as today.
    expect(f.s.markAcked(f.ceilingClosedRun, NOW)).toEqual({ ok: true, state: 'acked' });
  });

  it('returns each row with its stored envelope', () => {
    const f = fixture();
    const first = f.s.inboxFor(TO)[0]!;
    expect(first.envelope).toMatch(/^<mail>\d+<\/mail>$/);
  });

  it('returns only the caller\'s rows (toId)', () => {
    const f = fixture();
    expect(ids(f.s.inboxFor(TO))).not.toContain(f.other);
    expect(ids(f.s.inboxFor(OTHER))).toEqual([f.other]);
  });

  it('returns them oldest first', () => {
    const f = fixture();
    const got = ids(f.s.inboxFor(TO));
    expect(got.length).toBeGreaterThan(1);
    expect(got).toEqual([...got].sort((a, b) => a - b));
  });

  it('for every fixture row, inboxFor includes it only if markAcked changes it AND outstandingMailFor lists it, and every row in that intersection is in inboxFor', () => {
    const f = fixture();
    const inbox = new Set(ids(f.s.inboxFor(TO)));
    const listed = new Set(f.s.outstandingMailFor(TO).map((m) => m.id));
    const all = f.s.db.prepare('SELECT id FROM mail_deliveries WHERE toId = ? ORDER BY id').all(TO) as { id: number }[];
    // Probe ackability on a copy of the store state: markAcked writes, so read
    // each row's answer from a fresh fixture per row.
    for (const { id } of all) {
      const probe = fixture();
      const ackable = probe.s.markAcked(id, NOW).ok;
      const expected = ackable && listed.has(id);
      expect(inbox.has(id), `delivery ${id}`).toBe(expected);
    }
  });

  it('abandonedCount equals outstandingMailFor\'s count minus inboxFor\'s, and counts the park-ceiling rejection and nothing inboxFor returns', () => {
    const f = fixture();
    const inbox = new Set(ids(f.s.inboxFor(TO)));
    const outstanding = f.s.outstandingMailFor(TO).map((m) => m.id);
    expect(f.s.abandonedCount(TO)).toBe(outstanding.length - inbox.size);
    expect(f.s.abandonedCount(TO)).toBe(1);
    expect(outstanding).toContain(f.parkCeiling);
    expect(inbox.has(f.parkCeiling)).toBe(false);
    expect(f.s.abandonedCount(OTHER)).toBe(0);
  });
});
