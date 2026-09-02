// F7: the per-run health facts the /runs board renders as a compact warn row.
// Every case here MANUFACTURES the wedge it asserts — the spec's own test
// obligation, and this program's two recurring failure classes are an absence
// assertion whose fixture cannot produce the presence, and a pin whose premise is
// never established. So each positive case is paired with the negative that
// proves the fixture could have gone either way.
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_RUN_CLOSED_ERROR, MAIL_RECLAIM_CANCELLED_ERROR,
         toRunSummary } from '../src/coord/store.js';
import { PROGRAM_KICKOFF_SUBJECT, type RunHealth } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-health-'), '.ccrc', 'coord.db')));

const COORD = 'ccrc-pwa-brisk-meadow';
const WORKER = 'ccrc-pwa-quiet-meadow';

const openRun = (s: CoordStore, over: Partial<Parameters<CoordStore['openRun']>[0]> = {}) =>
  s.openRun({ program: 'leverage', title: 'F7', project: 'ccrc-pwa',
              wave: 7, waveOf: 8, claimedBy: COORD, ...over }) as { id: number };

const dispatched = (s: CoordStore, id: number): void => {
  s.dispatchRun({ runId: id, sessionId: WORKER, workspace: 'quiet-meadow',
                  branch: 'ws/quiet-meadow', resumed: false, clearedAt: null, items: [] });
};

/** One mail + one delivery. Returns the DELIVERY id — the sequence every
 *  delivery-keyed store method takes, never the mail row's own. */
const mailTo = (s: CoordStore, runId: number | null, toId: string,
                over: { fromId?: string; subject?: string } = {}): number => {
  const m = s.insertMail({ fromId: over.fromId ?? 'coordinator', fromUuid: over.fromId ?? 'coordinator',
                           toId, runId, kind: 'status', subject: over.subject ?? 'wave-brief',
                           body: 'x', artifacts: [] });
  return s.queueDelivery(m.id, toId, '<env>').id;
};

/** A park written the way the store's own two deliberate-cancel writers write
 *  one: state rejected, code undeliverable, and the reason in `lastError`. */
const parkWith = (s: CoordStore, deliveryId: number, lastError: string): void => {
  s.db.prepare("UPDATE mail_deliveries SET state='rejected', rejectCode='undeliverable', " +
               'lastError=? WHERE id=?').run(lastError, deliveryId);
};

const healthOf = (s: CoordStore, runId: number, coordIds: string[] = []): RunHealth =>
  s.runHealth([runId], coordIds).get(runId)!;

describe('the per-run health read (F7)', () => {
  it('splits outstanding from parked, and excludes BOTH deliberate cancels', () => {
    const s = store();
    const r = openRun(s);
    dispatched(s, r.id);
    mailTo(s, r.id, WORKER);                                            // outstanding
    parkWith(s, mailTo(s, r.id, WORKER), 'recipient not in registry');  // a real wedge
    parkWith(s, mailTo(s, r.id, WORKER), MAIL_RUN_CLOSED_ERROR);        // benign
    parkWith(s, mailTo(s, r.id, WORKER), MAIL_RECLAIM_CANCELLED_ERROR); // benign

    const h = healthOf(s, r.id);
    expect(h.mailOutstanding, 'the queued delivery is not counted outstanding').toBe(1);
    // Four deliveries, three parked, and only ONE is a wedge. Reporting a
    // `run closed` or `coordinator reclaimed` park would announce a chair that
    // has already changed hands.
    expect(h.mailParked, 'a deliberate cancel was counted as a wedge').toBe(1);
  });

  it('a delivered-but-unacked message is still OUTSTANDING, not parked', () => {
    const s = store();
    const r = openRun(s);
    dispatched(s, r.id);
    const d = mailTo(s, r.id, WORKER);
    s.markDelivered(d, 1_000);
    expect(healthOf(s, r.id).mailOutstanding).toBe(1);
    expect(healthOf(s, r.id).mailParked).toBe(0);
    s.markAcked(d, 2_000);
    expect(healthOf(s, r.id).mailOutstanding, 'an acked delivery is still outstanding').toBe(0);
  });

  it('reports the replay HIGH-WATER — the 722/911 fact that surfaces nowhere', () => {
    const s = store();
    const r = openRun(s);
    dispatched(s, r.id);
    const a = mailTo(s, r.id, WORKER);
    const b = mailTo(s, r.id, WORKER);
    s.markDelivered(a, 1); s.markDelivered(b, 1);
    for (let i = 0; i < 19; i++) s.bumpReplayCount(a);
    s.bumpReplayCount(b);
    // MAX, not SUM and not the last row's: one message climbing toward the
    // 20-ceiling is the signal, and it must not be diluted by quiet siblings.
    expect(healthOf(s, r.id).mailReplayMax, 'the high-water is not the MAX').toBe(19);
  });

  it('counts done-claim rejections and names the newest code, ignoring other families', () => {
    const s = store();
    const r = openRun(s);
    s.recordRejection({ code: 'stale-tip', runId: r.id, toId: WORKER, detail: 'a' });
    s.recordRejection({ code: 'pr-regressed', runId: r.id, toId: WORKER, detail: 'b' });
    // An ingress refusal is a different family and must not inflate the count.
    s.recordRejection({ code: 'unknown-sender', runId: r.id, toId: WORKER, detail: 'c' });
    const h = healthOf(s, r.id);
    expect(h.doneRejects, 'an ingress refusal was counted as a done-claim rejection').toBe(2);
    expect(h.lastRejectCode).toBe('pr-regressed');
  });

  it('says nothing about rejections when there are none — null, not a word', () => {
    const s = store();
    const r = openRun(s);
    const h = healthOf(s, r.id);
    expect(h.doneRejects).toBe(0);
    expect(h.lastRejectCode).toBeNull();
  });

  it('carries the dispatch decision, and NULL is a third condition, not a flavour of false', () => {
    const s = store();
    const never = openRun(s);
    const h = healthOf(s, never.id);
    expect(h.briefQueued, 'an undispatched run claims a decision it never made').toBeNull();
    expect(h.clearError).toBeNull();
  });

  it('names when an unacked kickoff to this run’s coordinator was first sent', () => {
    const s = store();
    const r = openRun(s);
    const k = mailTo(s, null, COORD, { fromId: 'operator', subject: PROGRAM_KICKOFF_SUBJECT });
    s.db.prepare('UPDATE mail SET at=? WHERE id=(SELECT mailId FROM mail_deliveries WHERE id=?)')
      .run(4_000, k);
    // A TIMESTAMP, never a verdict: the renderer owns the threshold, exactly as
    // it owns SPAWN_STALL_MS. A field carrying an AGE would differ every tick and
    // defeat the runs frame's byte-equality dedupe (D-1300).
    expect(healthOf(s, r.id, [COORD]).coordKickoffPendingSince,
      'the pending kickoff is invisible').toBe(4_000);
  });

  it('prefers ingestedAt over deliveredAt — a replay rewrites one and never the other', () => {
    const s = store();
    const r = openRun(s);
    const k = mailTo(s, null, COORD, { fromId: 'operator', subject: PROGRAM_KICKOFF_SUBJECT });
    s.db.prepare('UPDATE mail SET at=? WHERE id=(SELECT mailId FROM mail_deliveries WHERE id=?)')
      .run(1_000, k);
    s.markDelivered(k, 5_000);
    s.markIngested(k, 7_000);
    s.markDelivered(k, 9_000);   // a replay moves deliveredAt and not ingestedAt
    expect(healthOf(s, r.id, [COORD]).coordKickoffPendingSince,
      'the clock froze on deliveredAt, which a replay rewrites').toBe(7_000);
  });

  it('an ACKED kickoff is not pending — absence is silence, never a warning', () => {
    const s = store();
    const r = openRun(s);
    const k = mailTo(s, null, COORD, { fromId: 'operator', subject: PROGRAM_KICKOFF_SUBJECT });
    s.markDelivered(k, 10);
    s.markAcked(k, 20);
    expect(healthOf(s, r.id, [COORD]).coordKickoffPendingSince).toBeNull();
  });

  it('a kickoff to a DIFFERENT session is not this run’s', () => {
    const s = store();
    const r = openRun(s);
    mailTo(s, null, 'ccrc-pwa-somebody-else', { fromId: 'operator', subject: PROGRAM_KICKOFF_SUBJECT });
    expect(healthOf(s, r.id, [COORD, 'ccrc-pwa-somebody-else']).coordKickoffPendingSince).toBeNull();
  });

  it('is ONE query set for MANY runs, and every id gets a row', () => {
    const s = store();
    // Distinct WAVES, deliberately: `openRun` is idempotent per (program, wave),
    // so three calls with the same wave return one run and this case would have
    // asserted a batch of one while claiming to test three.
    const ids = [openRun(s, { wave: 1 }).id, openRun(s, { wave: 2 }).id, openRun(s, { wave: 3 }).id];
    expect(new Set(ids).size, 'the fixture made fewer runs than it claims').toBe(3);
    const m = s.runHealth(ids, []);
    expect([...m.keys()].sort((a, b) => a - b), 'a run fell out of the batch').toEqual(ids);
    // A MISSING key would make the caller invent a default, which is where an
    // overloaded null is born. Every id gets a row, mail or no mail.
    expect(m.get(ids[0]!)!.mailOutstanding).toBe(0);
  });

  it('answers an empty ask with an empty map rather than a malformed IN ()', () => {
    expect([...store().runHealth([], []).keys()]).toEqual([]);
  });

  it('does not attribute one run’s mail to another', () => {
    const s = store();
    const a = openRun(s, { wave: 1 }); const b = openRun(s, { wave: 2 });
    expect(a.id).not.toBe(b.id);
    dispatched(s, a.id);
    mailTo(s, a.id, WORKER);
    const m = s.runHealth([a.id, b.id], []);
    expect(m.get(a.id)!.mailOutstanding).toBe(1);
    expect(m.get(b.id)!.mailOutstanding, 'a sibling run inherited the mail').toBe(0);
  });

  it('reaches the board: GET /api/runs’s own builder carries it', () => {
    const s = store();
    const r = openRun(s);
    dispatched(s, r.id);
    parkWith(s, mailTo(s, r.id, WORKER), 'recipient not in registry');
    const wire = s.runs().find((x) => x.id === r.id)!;
    expect(wire.health.mailParked, 'health never reached the wire shape').toBe(1);
  });
});

describe('the health facts carry no clock — the constraint that makes them shippable (D-1300)', () => {
  // `server/test/fleetws.test.ts` pins that the WS `runs` frame is DROPPED from
  // the broadcast when its JSON is unchanged. That dedupe is what keeps an idle
  // fleet quiet, and a health field holding an AGE would differ on every tick,
  // defeat it, and turn twenty idle sessions into a broadcast storm — a
  // performance regression shaped exactly like a feature.
  //
  // So this is not a style pin. It is the reason `coordKickoffPendingSince` ships
  // the stored instant instead of `now - instant`, and the reason the two
  // thresholds are rendering constants the PWA applies.
  it('two reads ten minutes apart are byte-identical when nothing changed', () => {
    const s = store();
    const r = openRun(s);
    dispatched(s, r.id);
    // Every clock-adjacent fact is PRESENT, so the case could actually fail:
    // an outstanding delivery, a replay high-water, a done-claim refusal and a
    // pending kickoff whose age is genuinely growing across the two reads.
    const d = mailTo(s, r.id, WORKER);
    s.markDelivered(d, 1_000);
    s.bumpReplayCount(d);
    s.recordRejection({ code: 'stale-tip', runId: r.id, toId: WORKER, detail: 'x' });
    const k = mailTo(s, null, COORD, { fromId: 'operator', subject: PROGRAM_KICKOFF_SUBJECT });
    s.db.prepare('UPDATE mail SET at=? WHERE id=(SELECT mailId FROM mail_deliveries WHERE id=?)')
      .run(1_000, k);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(2_000);
      const before = JSON.stringify(s.runs().map(toRunSummary));
      vi.setSystemTime(2_000 + 600_000);
      const after = JSON.stringify(s.runs().map(toRunSummary));
      expect(after, 'a health field moved with the clock — the runs frame can no longer dedupe')
        .toBe(before);
      // Non-vacuity: the facts really are there to have moved.
      const h = s.runHealth([r.id], [COORD]).get(r.id)!;
      expect(h.mailReplayMax).toBe(1);
      expect(h.doneRejects).toBe(1);
      expect(h.coordKickoffPendingSince).toBe(1_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

