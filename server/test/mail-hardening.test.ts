// WAVE 0 (Build 9b) — mail hardening before any second producer exists
// (spec 2026-08-21-build9, D10). The store half: the dedupe guard's null
// arm (hole 1) and the two terminality guards (holes 3/4). The route half
// — quotas and the dark-behavior pin — lives in mail-peer-quota.test.ts.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { queueSystemMail } from '../src/coord/rundefs.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-mailhard-'), '.ccrc', 'coord.db')));

const NOW = 1_000_000_000_000;

const openRun = (s: CoordStore) =>
  s.openRun({ program: 'build9b', title: 'Wave 0 fixture', project: 'demo',
              wave: 1, waveOf: 1, claimedBy: 'demo-coordinator' }) as { id: number };

describe('hasOutstandingMail: the runId IS ? arm (D10 hole 1)', () => {
  it('finds an outstanding RUN-LESS mail — under `=` a bound NULL matches nothing, so the guard structurally could not fire', () => {
    const s = store();
    // Reseeded coordinator-sent for wave 4 (D-1041): the probe is sender-scoped
    // now, and this test is about the runId arm, not the sender arm. The
    // property it protects is that a bound NULL can match AT ALL — orthogonal to
    // who sent the row, and measured still-red under `IS` -> `=` after the
    // reseed rather than assumed to survive it.
    const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: 'demo-calm-ridge',
                             runId: null, kind: 'question', subject: 'peer q', body: 'x',
                             artifacts: [] });
    s.queueDelivery(m.id, 'demo-calm-ridge', '<mail>x</mail>');
    expect(s.hasOutstandingMail('coordinator', null, 'demo-calm-ridge', 'peer q')).toBe(true);
  });

  it('still finds a RUN mail by its number, and a run mail is NOT a run-less mail — IS is null-safe on both arms', () => {
    const s = store();
    const r = openRun(s);
    const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator',
                             toId: 'demo-quiet-mesa', runId: r.id, kind: 'status',
                             subject: 'wave-brief', body: 'go', artifacts: [] });
    s.queueDelivery(m.id, 'demo-quiet-mesa', '<mail>go</mail>');
    expect(s.hasOutstandingMail('coordinator', r.id, 'demo-quiet-mesa', 'wave-brief')).toBe(true);
    // The null arm must select ONLY runId-IS-NULL rows — a run mail found by
    // the peer probe would dedupe a peer send against the coordinator's own
    // traffic, silently.
    expect(s.hasOutstandingMail('coordinator', null, 'demo-quiet-mesa', 'wave-brief')).toBe(false);
  });
});

// D-1041 (program-leverage wave 4). This guard's own killer. Until wave 4 the
// probe was keyed `(runId, toId, subject)` and its docstring justified omitting
// the sender: "the coordinator is its only sender". That was true only while
// every system mail carried a RUN. Wave 4 queues a system mail with `runId:
// null` — the program kickoff — which lands in the same key space as PEER mail,
// whose `subject` is caller-chosen free text nobody validates
// (`coord/routes.ts`'s own shape check bounds its BYTES and nothing else). So a
// peer mail that happened to be titled `program-kickoff` would have made
// `queueSystemMail` return with no row, no error and no record, and the new
// coordinator would have sat there un-briefed forever.
//
// The collision was one-way, which is why it had gone unnoticed: the peer lane
// deduped sender-scoped from the start (`hasOutstandingPeerDuplicate`), so a
// kickoff never blocks a peer — only a peer could swallow a kickoff.
describe('hasOutstandingMail is SENDER-scoped: one key space, two lanes (D-1041)', () => {
  it('sees only its own sender\'s outstanding mail, in the runId-IS-NULL space both lanes share', () => {
    const s = store();
    const sys = s.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: 'demo-calm-ridge',
                               runId: null, kind: 'status', subject: 'program-kickoff',
                               body: 'be the coordinator', artifacts: [] });
    s.queueDelivery(sys.id, 'demo-calm-ridge', '<mail>k</mail>');
    const peer = s.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'u1', toId: 'demo-calm-ridge',
                                runId: null, kind: 'question', subject: 'program-kickoff',
                                body: 'what is this', artifacts: [] });
    s.queueDelivery(peer.id, 'demo-calm-ridge', '<mail>q</mail>');

    // Identical (runId, toId, subject) on both rows. ONLY the sender tells them
    // apart, and each probe must see its own and not the other's.
    expect(s.hasOutstandingMail('operator', null, 'demo-calm-ridge', 'program-kickoff')).toBe(true);
    expect(s.hasOutstandingMail('demo-quiet-mesa', null, 'demo-calm-ridge', 'program-kickoff')).toBe(true);
    expect(s.hasOutstandingMail('coordinator', null, 'demo-calm-ridge', 'program-kickoff')).toBe(false);
  });

  it('a peer mail cannot swallow a kickoff — the defect this guard exists for', () => {
    const s = store();
    const peer = s.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'u1', toId: 'demo-calm-ridge',
                                runId: null, kind: 'question', subject: 'program-kickoff',
                                body: 'unrelated', artifacts: [] });
    s.queueDelivery(peer.id, 'demo-calm-ridge', '<mail>q</mail>');
    // The kickoff has not been queued yet. Un-scoped, this probe answered TRUE
    // and `queueSystemMail` returned without inserting anything.
    expect(s.hasOutstandingMail('operator', null, 'demo-calm-ridge', 'program-kickoff')).toBe(false);
  });
});

// The witness fixture for wave 4's "the run-mail lanes are unchanged" claim
// (D-1042). Widening `queueSystemMail` touched the write that dispatch, close
// and advance all use, and "unchanged" is worth nothing without a fixture that
// could see the change. `run-routes.test.ts`'s brief pin already witnesses the
// SENDER half (`from: coordinator` in the rendered envelope); this witnesses the
// DEDUPE half, which no route can reach — `RUN_TRANSITIONS.dispatched` has no
// self-edge, so a second dispatch 409s before the mail write, and only a retried
// close can re-enter the guard in production.
describe('queueSystemMail: the run-mail arm still dedupes, and now says so (D-1042)', () => {
  it('queues once, declines the identical second, and inserts nothing the second time', () => {
    const s = store();
    const r = openRun(s);
    const run = { program: 'build9b', wave: 1, waveOf: 1 };
    const m = { fromId: 'coordinator' as const, toId: 'demo-quiet-mesa', runId: r.id,
                kind: 'status' as const, subject: 'wave-brief', body: 'go' };

    const first = queueSystemMail(s, run, m);
    expect(first.queued).toBe(true);
    const due = s.dueDeliveries(NOW, 60_000);
    expect(due.length).toBe(1);
    // The sender half, at the seam rather than through a route: a widening that
    // let the sender drift would land here first.
    expect(due[0]!.envelope).toContain('from: coordinator');

    const second = queueSystemMail(s, run, m);
    expect(second.queued).toBe(false);
    // Not merely "the answer changed" — nothing was written.
    expect(s.dueDeliveries(NOW, 60_000).length).toBe(1);
  });

  it('a RUN-LESS system mail is queueable, carries no run line, and dedupes on its own key', () => {
    const s = store();
    const m = { fromId: 'operator' as const, toId: 'demo-calm-ridge', runId: null,
                kind: 'status' as const, subject: 'program-kickoff', body: 'be the coordinator' };

    const first = queueSystemMail(s, null, m);
    expect(first.queued).toBe(true);
    const due = s.dueDeliveries(NOW, 60_000);
    expect(due.length).toBe(1);
    expect(due[0]!.envelope).toContain('from: operator');
    // `renderEnvelope` gates the whole `run:` line on a non-null runId. A
    // positive assertion on ABSENCE, because that line is the run-less shape's
    // one visible difference and a regression would restore it silently.
    expect(due[0]!.envelope).not.toContain('run:');

    expect(queueSystemMail(s, null, m).queued).toBe(false);
    expect(s.dueDeliveries(NOW, 60_000).length).toBe(1);
  });
});

describe('terminality guards: markIngested and bumpReplayCount (D10 holes 3/4)', () => {
  const now = 1_000_000_000_000;

  /** One mail, one delivery, driven to `delivered` — the state both
   *  writers under test are only ever legitimately called in. */
  const deliveredRow = (s: CoordStore): { id: number } => {
    const r = openRun(s);
    const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator',
                             toId: 'demo-quiet-mesa', runId: r.id, kind: 'status',
                             subject: 'wave-brief', body: 'go', artifacts: [] });
    const d = s.queueDelivery(m.id, 'demo-quiet-mesa', '<mail>go</mail>');
    s.markDelivered(d.id, now);
    return d;
  };

  it('markIngested leaves a PARKED row alone — the edge is not for a delivery already decided', () => {
    const s = store();
    const d = deliveredRow(s);
    s.rejectDelivery(d.id, 'undeliverable', 'parked at the ceiling');
    s.markIngested(d.id, now + 100);
    expect(s.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(d.id))
      .toEqual({ ingestedAt: null });
  });

  it('markIngested leaves an ACKED row alone', () => {
    const s = store();
    const d = deliveredRow(s);
    expect(s.markAcked(d.id, now + 1)).toBe(true);
    s.markIngested(d.id, now + 100);
    expect(s.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(d.id))
      .toEqual({ ingestedAt: null });
  });

  it('markIngested still stamps a live delivered row', () => {
    const s = store();
    const d = deliveredRow(s);
    s.markIngested(d.id, now + 100);
    expect(s.db.prepare('SELECT ingestedAt FROM mail_deliveries WHERE id = ?').get(d.id))
      .toEqual({ ingestedAt: now + 100 });
  });

  it('bumpReplayCount counts a live replay, as a state and a number', () => {
    const s = store();
    const d = deliveredRow(s);
    expect(s.bumpReplayCount(d.id)).toEqual({ state: 'counted', replayCount: 1 });
    expect(s.bumpReplayCount(d.id)).toEqual({ state: 'counted', replayCount: 2 });
  });

  it('bumpReplayCount answers {state:"terminal"} for a parked or acked row and leaves the counter alone', () => {
    // The union is the fix, not the guard (D10): a guard that still
    // returned a bare unchanged number would read as "not yet at the
    // ceiling" for a row already parked — two conditions, one value, at a
    // seam.
    const s = store();
    const parked = deliveredRow(s);
    s.rejectDelivery(parked.id, 'undeliverable', 'parked at the ceiling');
    expect(s.bumpReplayCount(parked.id)).toEqual({ state: 'terminal' });
    expect(s.db.prepare('SELECT replayCount FROM mail_deliveries WHERE id = ?').get(parked.id))
      .toEqual({ replayCount: 0 });

    const acked = deliveredRow(s);
    expect(s.markAcked(acked.id, now + 1)).toBe(true);
    expect(s.bumpReplayCount(acked.id)).toEqual({ state: 'terminal' });
    expect(s.db.prepare('SELECT replayCount FROM mail_deliveries WHERE id = ?').get(acked.id))
      .toEqual({ replayCount: 0 });
  });
});
