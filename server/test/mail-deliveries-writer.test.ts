// D-5997 (ARCH-15, #532): one guarded writer for `mail_deliveries`.
//
// Every delivery-row writer in `CoordStore` delegates to ONE private primitive
// that owns the terminality guard, and hands its caller what the guard decided:
// `{changed, state}` for a one-row write, `{changed: <rows>}` for a scoped bulk
// write (D-5998). The outstanding states are DERIVED as the complement of
// `TERMINAL_DELIVERY_STATES`, never typed a second time.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  OUTSTANDING_DELIVERY_STATES, TERMINAL_DELIVERY_STATES, outstandingDeliveryStates,
} from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_000_000_000_000;
const TO = 'demo-quiet-mesa';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-onewriter-'), '.ccrc', 'coord.db')));

const queued = (s: CoordStore, toId = TO): number => {
  const m = s.insertMail({ fromId: 'demo-calm-ridge', fromUuid: 'u-calm', toId, runId: null,
                           kind: 'status', subject: 'fixture', body: 'x', artifacts: [] });
  return s.queueDelivery(m.id, toId, '<mail>x</mail>').id;
};

const row = (s: CoordStore, id: number) => s.db.prepare(
  'SELECT state, attempts, lastError, nextAttemptAt, lastGate, gateCount, deliveredAt, ingestedAt, ' +
  'parkedAt, parkEscalatedAt, parkBox FROM mail_deliveries WHERE id = ?',
).get(id) as Record<string, unknown>;

const acked = (s: CoordStore): number => {
  const id = queued(s);
  expect(s.markAcked(id, NOW)).toEqual({ ok: true, state: 'acked' });
  return id;
};

const rejected = (s: CoordStore): number => {
  const id = queued(s);
  expect(s.rejectDelivery(id, 'undeliverable', 'fixture park')).toEqual({ changed: true, state: 'rejected' });
  return id;
};

describe('the outstanding states are the complement of TERMINAL_DELIVERY_STATES (D-5997)', () => {
  it('derives queued and delivered from the one terminal list', () => {
    expect([...OUTSTANDING_DELIVERY_STATES]).toEqual(['queued', 'delivered']);
    expect([...outstandingDeliveryStates(TERMINAL_DELIVERY_STATES)]).toEqual(['queued', 'delivered']);
  });

  it('a member added to the terminal list leaves the outstanding list too — both guards move together', () => {
    expect([...outstandingDeliveryStates([...TERMINAL_DELIVERY_STATES, 'delivered'])]).toEqual(['queued']);
    // `unknown` is the read-side label for a token this build cannot name: it is
    // never outstanding and never terminal (D-1406 stays open).
    expect(outstandingDeliveryStates([])).not.toContain('unknown');
  });
});

describe('a stale-state transition is refused and SAYS so — {changed:false, state} (D-5997)', () => {
  it('backOff on an acked row: changed:false, and no back-off is recorded', () => {
    const s = store();
    const id = acked(s);
    const before = row(s, id);
    expect(s.backOff(id, 'draft-present', NOW + 30_000)).toEqual({ changed: false, state: 'acked' });
    expect(row(s, id)).toEqual(before);
  });

  it('noteGate on a parked (rejected) row: changed:false', () => {
    const s = store();
    const id = rejected(s);
    const before = row(s, id);
    expect(s.noteGate(id, 'not-idle', NOW, false, null)).toEqual({ changed: false, state: 'rejected' });
    expect(row(s, id)).toEqual(before);
  });

  it('markDelivered, markIngested and rejectDelivery on an acked row: changed:false, the row untouched', () => {
    const s = store();
    const id = acked(s);
    const before = row(s, id);
    expect(s.markDelivered(id, NOW + 1)).toEqual({ changed: false, state: 'acked' });
    expect(s.markIngested(id, NOW + 2)).toEqual({ changed: false, state: 'acked' });
    expect(s.rejectDelivery(id, 'undeliverable', 'late')).toEqual({ changed: false, state: 'acked' });
    expect(row(s, id)).toEqual(before);
  });

  it('the park writers refuse a DELIVERED row (outstanding, but never parked) and a terminal one', () => {
    const s = store();
    const live = queued(s);
    expect(s.markDelivered(live, NOW)).toEqual({ changed: true, state: 'delivered' });
    expect(s.parkDelivery(live, 'draft-present', null, NOW, NOW + 1)).toEqual({ changed: false, state: 'delivered' });
    const done = acked(s);
    expect(s.parkDelivery(done, 'draft-present', null, NOW, NOW + 1)).toEqual({ changed: false, state: 'acked' });
    expect(s.holdParked(done, NOW + 1)).toEqual({ changed: false, state: 'acked' });
    expect(s.wakeParked(done, NOW)).toEqual({ changed: false, state: 'acked' });
    expect(s.markParkEscalated(done, NOW)).toEqual({ changed: false, state: 'acked' });
    expect(s.absorbParkEscalation(done, NOW)).toEqual({ changed: false, state: 'acked' });
    expect(s.baselineParkBox(done, 'box')).toEqual({ changed: false, state: 'acked' });
  });

  it('a row that does not exist answers absent, never a state', () => {
    const s = store();
    expect(s.backOff(4242, 'x', NOW)).toEqual({ changed: false, state: 'absent' });
    expect(s.markDelivered(4242, NOW)).toEqual({ changed: false, state: 'absent' });
  });
});

describe('a write the guard admits says changed:true and the row\'s state after it (D-5997)', () => {
  it('every one-row writer on a live row', () => {
    const s = store();
    const id = queued(s);
    expect(s.noteGate(id, 'not-idle', NOW, false, null)).toEqual({ changed: true, state: 'queued' });
    expect(s.backOff(id, 'draft-present', NOW + 30_000)).toEqual({ changed: true, state: 'queued' });
    expect(s.parkDelivery(id, 'enter-ignored', 'box', NOW, NOW + 600_000)).toEqual({ changed: true, state: 'queued' });
    expect(s.holdParked(id, NOW + 600_000)).toEqual({ changed: true, state: 'queued' });
    expect(s.wakeParked(id, NOW)).toEqual({ changed: true, state: 'queued' });
    expect(s.markParkEscalated(id, NOW)).toEqual({ changed: true, state: 'queued' });
    expect(s.markParkEscalated(id, NOW), 'escalated once only').toEqual({ changed: false, state: 'queued' });
    expect(s.markDelivered(id, NOW)).toEqual({ changed: true, state: 'delivered' });
    expect(s.markIngested(id, NOW + 1)).toEqual({ changed: true, state: 'delivered' });
    expect(s.rejectDelivery(id, 'undeliverable', 'ceiling')).toEqual({ changed: true, state: 'rejected' });
  });

  it('the bulk writers answer how many rows they changed — never void', () => {
    const s = store();
    const a = queued(s, 'demo-child');
    queued(s, 'demo-child');
    acked(s);
    expect(s.cancelDeliveriesTo('demo-child')).toEqual({ changed: 2 });
    expect(s.cancelDeliveriesTo('demo-child'), 'nothing outstanding is left').toEqual({ changed: 0 });
    expect(row(s, a).state).toBe('rejected');
  });
});

// The census, as a plain occurrence count over CODE (comment lines stripped):
// the one primitive is the one place a delivery row is written.
describe('store.ts writes mail_deliveries in exactly one place (D-5997)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const src = readFileSync(path.join(root, 'server/src/coord/store.ts'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');

  it('one UPDATE mail_deliveries site, and the strip is real', () => {
    expect(src.includes('UPDATE mail_deliveries'), 'prose names the statement too').toBe(true);
    expect((code.match(/UPDATE mail_deliveries\b/g) ?? []).length).toBe(1);
  });

  it('the hand-typed outstanding literal is gone', () => {
    expect(code).not.toMatch(/OUTSTANDING_STATES_SQL\s*=\s*["'`]\('queued/);
    expect(code).toMatch(/const OUTSTANDING_STATES_SQL = `\('\$\{OUTSTANDING_DELIVERY_STATES\.join\("','"\)\}'\)`;/);
  });
});
