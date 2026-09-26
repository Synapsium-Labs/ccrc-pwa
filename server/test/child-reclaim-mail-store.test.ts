// Child reclamation, wave 3 — the two store surfaces the executor and the
// close decision lean on (spec 2026-09-22 §5.6, §5.7):
//
//   - `cancelDeliveriesTo(toId)`: every OUTSTANDING delivery addressed to a
//     reclaimed child, parked on purpose — keyed on the RECIPIENT, so it
//     reaches what `cancelOutstandingDeliveries(runId)` cannot (an earlier
//     wave's unacked mail, peer mail with no run), and returning its count.
//   - `programOpenRunCount(program, excludeRunId?)`: D-51's retirement
//     predicate, asked with the closing run set aside — "would this close
//     retire the program?" — by the ONE query, not a second spelling.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_CHILD_RECLAIMED_ERROR } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const CHILD = 'demo-quiet-basin';
const OTHER = 'demo-other-mesa';
const NOW = 1_000_000_000_000;

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-child-reclaim-mail-store-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, wave: number): number => {
  const r = s.openRun({ program, title: 't', project: 'demo', wave, waveOf: 3, claimedBy: 'demo-coordinator' });
  if (!('id' in r)) throw new Error('openRun refused');
  return r.id;
};
const deliver = (s: CoordStore, to: string, runId: number | null): number => {
  const m = s.insertMail({ fromId: 'demo-coordinator', fromUuid: 'u', toId: to, runId,
    kind: 'status', subject: 's', body: 'b', artifacts: [] });
  return s.queueDelivery(m.id, to, '<mail/>').id;
};
const row = (s: CoordStore, id: number) => s.db.prepare(
  'SELECT state, rejectCode, lastError FROM mail_deliveries WHERE id = ?',
).get(id) as { state: string; rejectCode: string | null; lastError: string | null };

describe('cancelDeliveriesTo — the reclaimed child’s outstanding mail, parked on purpose', () => {
  it('parks every outstanding delivery TO the child, across runs and peers, and counts them', () => {
    const s = store();
    const w1 = open(s, 'p', 1);
    const w2 = open(s, 'p', 2);
    const fromWave1 = deliver(s, CHILD, w1);                 // queued, an earlier wave's
    const fromWave2 = deliver(s, CHILD, w2);
    s.markDelivered(fromWave2, NOW);                          // delivered, never acked
    const peer = deliver(s, CHILD, null);                     // no run at all
    const elsewhere = deliver(s, OTHER, w2);                  // someone else's
    const acked = deliver(s, CHILD, w2);
    s.markDelivered(acked, NOW); expect(s.markAcked(acked, NOW).ok).toBe(true);
    const parked = deliver(s, CHILD, w2);
    s.rejectDelivery(parked, 'undeliverable', 'recipient not in registry');

    expect(s.cancelDeliveriesTo(CHILD), 'the count is the three outstanding rows, nothing else').toBe(3);
    for (const id of [fromWave1, fromWave2, peer]) {
      expect(row(s, id)).toEqual({ state: 'rejected', rejectCode: 'undeliverable', lastError: MAIL_CHILD_RECLAIMED_ERROR });
    }
    expect(row(s, elsewhere).state, 'another recipient is untouched').toBe('queued');
    expect(row(s, acked).state, 'an acked row is not outstanding').toBe('acked');
    expect(row(s, parked).lastError, 'an earlier park keeps its own reason').toBe('recipient not in registry');
    expect(s.cancelDeliveriesTo(CHILD), 'a second call finds nothing outstanding').toBe(0);
    expect(s.dueDeliveries(NOW + 10_000_000, 1).map((d) => d.id)).not.toEqual(
      expect.arrayContaining([fromWave1, fromWave2, peer]));
  });

  it('is a DELIBERATE park — the mailbox does not list it as abandoned, while a real abandonment stays listed', () => {
    const s = store();
    const w = open(s, 'p', 1);                                // OPEN: the run-terminal exclusion cannot be what hides it
    const peer = deliver(s, CHILD, null);
    const ofRun = deliver(s, CHILD, w);
    const abandoned = deliver(s, CHILD, w);
    s.rejectDelivery(abandoned, 'undeliverable', 'recipient not in registry');   // the CONTROL
    expect(s.cancelDeliveriesTo(CHILD)).toBe(2);
    const listed = s.outstandingMailFor(CHILD).map((m) => m.deliveryId);
    expect(listed, 'the control: an abandoned park is still a human’s to see').toContain(abandoned);
    expect(listed, 'the reclaim park is not').not.toContain(peer);
    expect(listed).not.toContain(ofRun);
  });

  it('spells its sentence once, and holds no apostrophe — it is interpolated into SQL', () => {
    expect(MAIL_CHILD_RECLAIMED_ERROR).toBe('child workspace reclaimed');
    expect(MAIL_CHILD_RECLAIMED_ERROR.includes("'")).toBe(false);
  });
});

describe('programOpenRunCount(program, excludeRunId) — D-51’s predicate, one run set aside', () => {
  it('answers "would closing THIS run retire the program" before the close, and D-51 still retires after it', () => {
    const s = store();
    const a = open(s, 'p', 1);
    const b = open(s, 'p', 2);
    const c = open(s, 'q', 1);
    expect(s.programOpenRunCount('p')).toBe(2);
    expect(s.programOpenRunCount('p', a)).toBe(1);
    expect(s.programOpenRunCount('p', c), 'another program’s run excludes nothing here').toBe(2);
    expect(s.programOpenRunCount('q', c)).toBe(0);
    expect(s.closeRun({ runId: b, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
      viaClosing: false }).ok).toBe(true);
    expect(s.programOpenRunCount('p', a), 'with b terminal, closing a retires p').toBe(0);
    expect(s.programOpenRunCount('p')).toBe(1);
    expect(s.closeRun({ runId: a, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
      viaClosing: false }).ok).toBe(true);
    const state = (slug: string) => (s.db.prepare('SELECT state FROM programs WHERE slug = ?').get(slug) as { state: string }).state;
    expect(state('p'), 'D-51 retired it from inside the close transaction, unexcluded').toBe('abandoned');
    expect(state('q')).toBe('active');
  });

  it('is ONE query in the store — the exclusion rides the same statement, never a second spelling', () => {
    const store = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'store.ts'), 'utf8');
    expect(store.match(/SELECT count\(\*\) AS c FROM runs WHERE program = \?/g) ?? []).toHaveLength(1);
  });
});
