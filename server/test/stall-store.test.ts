// Stall watch wave 1, Task 7 (spec 2026-09-29 §4.2): the store reads the stall
// lane consumes, the observation writer that is its durable dedupe, and the
// one-transaction notice queue. Fixture coord.db only (mkTmp), never a live one.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { insertSystemMailTx, queueStallNotice, queueSystemMail } from '../src/coord/rundefs.js';
import { STALL_CHECK_PREFIX, STALL_REPLY_PREFIX, STALL_REPORT_PREFIX, stallDetail } from '../src/coord/stall.js';
import { WAVE_DONE_SUBJECT, type MailKind, type RunState } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

/** One past the JavaScript safe domain — `coord-store.test.ts`'s D-2545 idiom, bound as a bigint. */
const UNSAFE = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-stall-store-'), 'coord.db')));

// S4's measured times (spec §4.2's r1 example): the worker's last status mail,
// the answer it was handed, the moment its main loop went idle, and r1 at 2 h.
const S4_STATUS_AT = Date.parse('2026-09-28T21:17:43Z');
const S4_ANSWER_AT = Date.parse('2026-09-28T21:19:17Z');
const S4_IDLE_AT = Date.parse('2026-09-28T21:56:31Z');
const S4_R1_AT = S4_IDLE_AT + 2 * 3_600_000;
const DISPATCHED_AT = Date.parse('2026-09-28T09:00:00Z');
/** Runs 29 and 31 overlapped 8.3 h on one session (spec §4.2 "Candidates"). */
const OVERLAP_MS = 29_880_000;

type Reach = 'dispatched' | 'working' | 'awaiting-review';
const PATH: Record<Reach, readonly RunState[]> = {
  dispatched: ['dispatched'],
  working: ['dispatched', 'working'],
  'awaiting-review': ['dispatched', 'working', 'awaiting-review'],
};

/** planned -> dispatched (-> working -> awaiting-review) through the store's own
 *  writers — `run-signals.test.ts`'s `seedRun`, generalised. `sessionId` is the
 *  WORKER (and its workspace), `claimedBy` the coordinator. Every wave is unique
 *  per store: `openRun` REUSES a `planned` row with the same (program, wave,
 *  waveOf, kind). */
function seedRun(s: CoordStore, o: { sessionId: string; wave: number; reach: Reach; at: number;
                                     kind?: 'work' | 'review'; reviews?: number }): number {
  const opened = s.openRun({ program: 'demo-program', title: 'Demo', project: 'demo', wave: o.wave, waveOf: 9,
    claimedBy: 'demo-coordinator',
    ...(o.kind === 'review' ? { kind: 'review' as const, reviews: o.reviews ?? null } : {}) });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  s.markDispatched(opened.id, o.sessionId, o.sessionId, `ws/${o.sessionId}`, false, o.at);
  for (const to of PATH[o.reach]) {
    const adv = s.advance(opened.id, to, 'coordinator');
    if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  }
  return opened.id;
}

/** A mail row at a measured time. `insertMail` stamps `Date.now()`, so the time
 *  is set through the handle, the way `run-signals.test.ts` sets `run_events.at`. */
function mailAt(s: CoordStore, m: { fromId: string; toId: string; runId: number | null; kind: MailKind;
                                    subject: string; at: number }): number {
  const { id } = s.insertMail({ fromId: m.fromId, fromUuid: m.fromId, toId: m.toId, runId: m.runId,
    kind: m.kind, subject: m.subject, body: 'fixture body', artifacts: [] });
  s.db.prepare('UPDATE mail SET at = ? WHERE id = ?').run(m.at, id);
  return id;
}

/** The stall observation rows on one run (`stall:` and `stall-shadow:` details). */
const stallRows = (s: CoordStore, runId: number) =>
  s.db.prepare("SELECT id, at, fromState, toState, causedBy, detail FROM run_events WHERE runId = ? AND detail LIKE 'stall%' ORDER BY id")
    .all(runId) as { id: number; at: number; fromState: string; toState: string; causedBy: string; detail: string }[];

const count = (s: CoordStore, table: 'mail' | 'mail_deliveries'): number =>
  (s.db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;

const envelopeOf = (s: CoordStore, deliveryId: number): string =>
  (s.db.prepare('SELECT envelope FROM mail_deliveries WHERE id = ?').get(deliveryId) as { envelope: string }).envelope;

describe('stallCandidates: the active runs that name a worker, all-or-failure (§4.2 Candidates)', () => {
  const row = (id: number, o: { kind?: string; state: string; sessionId: string; dispatchedAt: number; wave: number }) => ({
    id, kind: o.kind ?? 'work', state: o.state, sessionId: o.sessionId, claimedBy: 'demo-coordinator',
    dispatchedAt: o.dispatchedAt, program: 'demo-program', wave: o.wave, waveOf: 9, project: 'demo',
    workspace: o.sessionId,
  });

  it('returns every dispatched/working/unknown/unnamed-state run with a session, both kinds, and BOTH of two overlapping runs on one session', () => {
    const s = store();
    const older = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const newer = seedRun(s, { sessionId: 'demo-worker', wave: 8, reach: 'dispatched', at: DISPATCHED_AT + OVERLAP_MS });
    const review = seedRun(s, { sessionId: 'demo-reviewer', wave: 7, reach: 'dispatched', at: DISPATCHED_AT + 60_000,
      kind: 'review', reviews: older });
    // Excluded by the INACTIVE predicate: idle and terminal states.
    seedRun(s, { sessionId: 'demo-idle', wave: 5, reach: 'awaiting-review', at: DISPATCHED_AT });
    const planned = s.openRun({ program: 'demo-program', title: 'Demo', project: 'demo', wave: 4, waveOf: 9,
      claimedBy: 'demo-coordinator' });
    if (!('id' in planned)) throw new Error('openRun refused');
    s.setSession(planned.id, 'demo-planned');
    const failed = seedRun(s, { sessionId: 'demo-failed', wave: 3, reach: 'dispatched', at: DISPATCHED_AT });
    expect(s.advance(failed, 'failed', 'coordinator').ok).toBe(true);
    // Included: 'unknown', and a raw token this build cannot name (a newer build's row after a rollback).
    const unknown = seedRun(s, { sessionId: 'demo-unknown', wave: 2, reach: 'working', at: DISPATCHED_AT + 120_000 });
    s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('unknown', unknown);
    const raw = seedRun(s, { sessionId: 'demo-raw', wave: 1, reach: 'working', at: DISPATCHED_AT + 180_000 });
    s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('paused-by-newer-build', raw);
    // Excluded: an active run that names no worker.
    const sessionless = seedRun(s, { sessionId: 'demo-gone', wave: 6, reach: 'working', at: DISPATCHED_AT });
    s.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(sessionless);

    expect(s.stallCandidates()).toEqual({ ok: true, runs: [
      row(older, { state: 'working', sessionId: 'demo-worker', dispatchedAt: DISPATCHED_AT, wave: 7 }),
      row(newer, { state: 'dispatched', sessionId: 'demo-worker', dispatchedAt: DISPATCHED_AT + OVERLAP_MS, wave: 8 }),
      row(review, { kind: 'review', state: 'dispatched', sessionId: 'demo-reviewer', dispatchedAt: DISPATCHED_AT + 60_000, wave: 7 }),
      row(unknown, { state: 'unknown', sessionId: 'demo-unknown', dispatchedAt: DISPATCHED_AT + 120_000, wave: 2 }),
      row(raw, { state: 'paused-by-newer-build', sessionId: 'demo-raw', dispatchedAt: DISPATCHED_AT + 180_000, wave: 1 }),
    ] });
  });

  it('answers an empty list, not a failure, when nothing is active', () => {
    expect(store().stallCandidates()).toEqual({ ok: true, runs: [] });
  });

  it.each([
    ['wave', 'run wave is not a positive safe integer'],
    ['waveOf', 'run waveOf is not a positive safe integer'],
    ['dispatchedAt', 'run dispatchedAt is not a positive safe integer'],
  ] as const)('refuses the WHOLE read on one unrepresentable %s, naming the column and no value (D-2545)', (column, detail) => {
    const s = store();
    seedRun(s, { sessionId: 'demo-good', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const bad = seedRun(s, { sessionId: 'demo-bad', wave: 8, reach: 'working', at: DISPATCHED_AT });
    s.db.prepare(`UPDATE runs SET ${column} = ? WHERE id = ?`).run(UNSAFE, bad);
    expect(s.stallCandidates()).toEqual({ ok: false, kind: 'run-unreadable', detail });
    expect(detail).not.toMatch(/[0-9]/);
  });

  it('a bad row the predicate does not select cannot fail the read', () => {
    const s = store();
    const good = seedRun(s, { sessionId: 'demo-good', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const idle = seedRun(s, { sessionId: 'demo-idle', wave: 8, reach: 'awaiting-review', at: DISPATCHED_AT });
    s.db.prepare('UPDATE runs SET wave = ? WHERE id = ?').run(UNSAFE, idle);
    const read = s.stallCandidates();
    expect(read.ok && read.runs.map((r) => r.id)).toEqual([good]);
  });
});

describe('mailOnRuns: every mail row on the subject\'s runs, one read, in id order', () => {
  it('reads two overlapping runs\' mail interleaved by id, whatever order the ids come in, and nothing from another run or no run', () => {
    const s = store();
    const older = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const newer = seedRun(s, { sessionId: 'demo-worker', wave: 8, reach: 'dispatched', at: DISPATCHED_AT + OVERLAP_MS });
    const other = seedRun(s, { sessionId: 'demo-other', wave: 6, reach: 'working', at: DISPATCHED_AT });
    // A rejected wave-done on the older run, then S4's status/answer pair on the newer one.
    const a = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: older, kind: 'status',
      subject: WAVE_DONE_SUBJECT, at: S4_STATUS_AT - 3_600_000 });
    const b = mailAt(s, { fromId: 'coordinator', toId: 'demo-worker', runId: older, kind: 'status',
      subject: 'wave-done-rejected', at: S4_STATUS_AT - 1_800_000 });
    mailAt(s, { fromId: 'demo-other', toId: 'coordinator', runId: other, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    mailAt(s, { fromId: 'demo-worker', toId: 'demo-peer', runId: null, kind: 'question', subject: 'peer q', at: S4_STATUS_AT });
    const c = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: newer, kind: 'status',
      subject: 'progress', at: S4_STATUS_AT });
    const d = mailAt(s, { fromId: 'demo-coordinator', toId: 'demo-worker', runId: newer, kind: 'answer',
      subject: 'go on', at: S4_ANSWER_AT });

    expect(s.mailOnRuns([newer, older])).toEqual({ ok: true, mail: [
      { id: a, at: S4_STATUS_AT - 3_600_000, runId: older, fromId: 'demo-worker', toId: 'coordinator', kind: 'status', subject: WAVE_DONE_SUBJECT },
      { id: b, at: S4_STATUS_AT - 1_800_000, runId: older, fromId: 'coordinator', toId: 'demo-worker', kind: 'status', subject: 'wave-done-rejected' },
      { id: c, at: S4_STATUS_AT, runId: newer, fromId: 'demo-worker', toId: 'coordinator', kind: 'status', subject: 'progress' },
      { id: d, at: S4_ANSWER_AT, runId: newer, fromId: 'demo-coordinator', toId: 'demo-worker', kind: 'answer', subject: 'go on' },
    ] });
  });

  it('an empty id list answers {ok:true, mail:[]} and prepares no statement at all', () => {
    const s = store();
    const spy = vi.spyOn(s.db, 'prepare');
    try {
      expect(s.mailOnRuns([])).toEqual({ ok: true, mail: [] });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses the whole read on one unrepresentable mail time, naming the column and no value (D-2545)', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    const bad = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    s.db.prepare('UPDATE mail SET at = ? WHERE id = ?').run(UNSAFE, bad);
    expect(s.mailOnRuns([run])).toEqual({ ok: false, kind: 'mail-unreadable', detail: 'mail at is not a positive safe integer' });
  });
});

describe('firstMailIdWithPrefix: the reply bind\'s first stall-check (§4.2 Push shape)', () => {
  it('answers the LOWEST id of a prefixed mail from that sender to that recipient on that run, and null when none', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const otherRun = seedRun(s, { sessionId: 'demo-worker', wave: 8, reach: 'dispatched', at: DISPATCHED_AT });
    const check = (runId: number, fromId: string, toId: string, subject: string): number =>
      mailAt(s, { fromId, toId, runId, kind: 'status', subject, at: S4_R1_AT });
    expect(s.firstMailIdWithPrefix(run, 'operator', 'demo-worker', STALL_CHECK_PREFIX)).toBeNull();
    check(otherRun, 'operator', 'demo-worker', `${STALL_CHECK_PREFIX} run ${otherRun} — quiet 2h 0m, owed: first report`);
    check(run, 'coordinator', 'demo-worker', `${STALL_CHECK_PREFIX} run ${run} — forged by the wrong sender`);
    check(run, 'operator', 'demo-other', `${STALL_CHECK_PREFIX} run ${run} — quiet 2h 0m, owed: first report`);
    check(run, 'operator', 'demo-coordinator', `${STALL_REPORT_PREFIX} run ${run} — the coordinator's report`);
    const first = check(run, 'operator', 'demo-worker', `${STALL_CHECK_PREFIX} run ${run} — quiet 2h 0m, owed: reply to #7`);
    check(run, 'operator', 'demo-worker', `${STALL_CHECK_PREFIX} run ${run} — quiet 5h 0m, owed: next report`);
    expect(s.firstMailIdWithPrefix(run, 'operator', 'demo-worker', STALL_CHECK_PREFIX)).toBe(first);
  });

  it('matches the prefix EXACTLY, never LIKE: no case folding, no wildcard, never mid-subject', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const put = (subject: string): number =>
      mailAt(s, { fromId: 'operator', toId: 'demo-worker', runId: run, kind: 'status', subject, at: S4_R1_AT });
    put(`${STALL_CHECK_PREFIX.toUpperCase()} run ${run}`);          // LIKE folds ASCII case
    put(`${STALL_REPLY_PREFIX} working, report at 01:00Z`);          // the check prefix, mid-subject
    put(`stallXcheck: run ${run}`);                                   // LIKE reads `_` as any one char
    expect(s.firstMailIdWithPrefix(run, 'operator', 'demo-worker', STALL_CHECK_PREFIX)).toBeNull();
    expect(s.firstMailIdWithPrefix(run, 'operator', 'demo-worker', 'stall_check:')).toBeNull();
    expect(s.firstMailIdWithPrefix(run, 'operator', 'demo-worker', 'stall%')).toBeNull();
  });
});

describe('deliveryTimesFor: r2 reports when r1 was delivered and acked', () => {
  it('reads the NEWEST delivery row of a mail, and null for a mail with none', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const m = mailAt(s, { fromId: 'operator', toId: 'demo-worker', runId: run, kind: 'status',
      subject: `${STALL_CHECK_PREFIX} run ${run}`, at: S4_R1_AT });
    expect(s.deliveryTimesFor(m)).toBeNull();
    const first = s.queueDelivery(m, 'demo-worker', '');
    expect(s.deliveryTimesFor(m)).toEqual({ deliveredAt: null, ackedAt: null });
    s.markDelivered(first.id, S4_R1_AT + 5_000);
    s.markAcked(first.id, S4_R1_AT + 60_000);
    expect(s.deliveryTimesFor(m)).toEqual({ deliveredAt: S4_R1_AT + 5_000, ackedAt: S4_R1_AT + 60_000 });
    // A second delivery of one mail (the re-queue shape): the newest is the live one.
    s.queueDelivery(m, 'demo-heir', '');
    expect(s.deliveryTimesFor(m)).toEqual({ deliveredAt: null, ackedAt: null });
  });
});

describe('mailQueuedSince: the additive runSessionId (the reply bind\'s worker)', () => {
  it('carries the RUN\'s worker, even on a mail the worker sent to its coordinator, and null for run-less mail', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const reply = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status',
      subject: `${STALL_REPLY_PREFIX} working`, at: S4_R1_AT + 60_000 });
    s.queueDelivery(reply, 'demo-coordinator', '');
    queueSystemMail(s, null, { fromId: 'operator', toId: 'demo-other', runId: null, kind: 'status',
      subject: 'program-kickoff', body: 'be the coordinator' });
    expect(s.mailQueuedSince(0).map((r) => [r.toId, r.fromId, r.runSessionId])).toEqual([
      ['demo-coordinator', 'demo-worker', 'demo-worker'],
      ['demo-other', 'operator', null],
    ]);
  });
});

describe('autoContinueHeldUntil: hold 3\'s auto-continue read (§4.2 hold 3)', () => {
  /** A delivery to `toId` on `run`, queued through the store's own writers. */
  const delivery = (s: CoordStore, run: number, toId: string): number =>
    s.queueDelivery(mailAt(s, { fromId: 'demo-coordinator', toId, runId: run, kind: 'answer', subject: 'go on',
      at: S4_ANSWER_AT }), toId, '').id;

  it('answers the LATEST nextAttemptAt among still-outstanding auto-continue refusals to that session, and null when none', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    expect(s.autoContinueHeldUntil('demo-worker')).toEqual({ ok: true, until: null });
    const a = delivery(s, run, 'demo-worker');
    const b = delivery(s, run, 'demo-worker');
    const acked = delivery(s, run, 'demo-worker');
    const other = delivery(s, run, 'demo-other');
    const plain = delivery(s, run, 'demo-worker');
    // `backOff` exactly as sweepMail's auto-continue arm calls it: a non-counting hold.
    s.backOff(a, 'auto-continue-armed', S4_R1_AT + 300_000, false);
    s.backOff(b, 'auto-continue-armed', S4_R1_AT + 600_000, false);
    s.backOff(acked, 'auto-continue-armed', S4_R1_AT + 900_000, false);
    s.markAcked(acked, S4_R1_AT + 700_000);                         // terminal: no longer a hold on anyone
    s.backOff(other, 'auto-continue-armed', S4_R1_AT + 1_200_000, false); // another session's hold
    s.backOff(plain, 'enter-ignored', S4_R1_AT + 1_500_000);       // a send failure, not the hold
    expect(s.autoContinueHeldUntil('demo-worker')).toEqual({ ok: true, until: S4_R1_AT + 600_000 });
    expect(s.autoContinueHeldUntil('demo-other')).toEqual({ ok: true, until: S4_R1_AT + 1_200_000 });
  });

  it('answers delivery-unreadable, naming the column and no value, on an unrepresentable hold time (D-2545)', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const d = delivery(s, run, 'demo-worker');
    s.backOff(d, 'auto-continue-armed', S4_R1_AT, false);
    s.db.prepare('UPDATE mail_deliveries SET nextAttemptAt = ? WHERE id = ?').run(UNSAFE, d);
    expect(s.autoContinueHeldUntil('demo-worker')).toEqual({ ok: false, kind: 'delivery-unreadable',
      detail: 'delivery nextAttemptAt is not a positive safe integer' });
  });
});

describe('insertStallObservation / recordStallObservation: the durable, deduped rung record (§4.2)', () => {
  it('records an observation row at the run\'s own state (fromState = toState), caused by the operator, and answers its event id', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const detail = stallDetail('live', 'quiet', 1, S4_STATUS_AT);
    const r = s.recordStallObservation(run, detail, S4_R1_AT);
    if (!r.recorded) throw new Error(`not recorded: ${r.why}`);
    expect(stallRows(s, run)).toEqual([
      { id: r.eventId, at: S4_R1_AT, fromState: 'working', toState: 'working', causedBy: 'operator', detail },
    ]);
  });

  it('refuses the same detail twice as a duplicate, even from a new store over the same coord.db (a restart)', () => {
    const dbPath = path.join(mkTmp('ccrc-stall-restart-'), 'coord.db');
    const before = new CoordStore(openCoordDb(dbPath));
    const run = seedRun(before, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const r1 = stallDetail('live', 'quiet', 1, S4_STATUS_AT);
    expect(before.recordStallObservation(run, r1, S4_R1_AT).recorded).toBe(true);
    before.db.close();

    const after = new CoordStore(openCoordDb(dbPath));
    expect(after.recordStallObservation(run, r1, S4_R1_AT + 60_000)).toEqual({ recorded: false, why: 'duplicate' });
    // The next rung, the same rung of a new episode, and the shadow form of the
    // same rung are each a new fact.
    expect(after.recordStallObservation(run, stallDetail('live', 'quiet', 2, S4_STATUS_AT), S4_R1_AT + 3_600_000).recorded).toBe(true);
    expect(after.recordStallObservation(run, stallDetail('live', 'quiet', 1, S4_STATUS_AT + 1_000), S4_R1_AT).recorded).toBe(true);
    expect(after.recordStallObservation(run, stallDetail('shadow', 'quiet', 1, S4_STATUS_AT), S4_R1_AT).recorded).toBe(true);
    expect(stallRows(after, run)).toHaveLength(4);
  });

  it('answers run-gone for a run that does not exist, and writes nothing', () => {
    const s = store();
    const detail = stallDetail('live', 'quiet', 1, S4_STATUS_AT);
    expect(s.recordStallObservation(424_242, detail, S4_R1_AT)).toEqual({ recorded: false, why: 'run-gone' });
    expect(s.insertStallObservation(424_242, detail, S4_R1_AT)).toEqual({ recorded: false, why: 'run-gone' });
    expect(stallRows(s, 424_242)).toEqual([]);
  });

  it('insertStallObservation opens NO transaction, so a caller\'s tx can hold it; recordStallObservation opens exactly one', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const inner = tx(s.db, () => s.insertStallObservation(run, stallDetail('live', 'quiet', 1, S4_STATUS_AT), S4_R1_AT));
    expect(inner.recorded).toBe(true);
    // `tx` is BEGIN IMMEDIATE and not re-entrant: a writer that opens its own
    // cannot run inside another, and the outer one rolls back.
    expect(() => tx(s.db, () => s.recordStallObservation(run, stallDetail('live', 'quiet', 2, S4_STATUS_AT), S4_R1_AT)))
      .toThrow(/transaction/i);
    expect(stallRows(s, run)).toHaveLength(1);
  });
});

describe('insertSystemMailTx: queueSystemMail\'s body, extracted with no transaction of its own', () => {
  const RUN_FIELDS = { program: 'demo-program', wave: 7, waveOf: 9 };

  it('writes the mail, its delivery and the envelope stamped against the DELIVERY id, inside a caller\'s tx', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const out = tx(s.db, () => insertSystemMailTx(s, RUN_FIELDS, { fromId: 'operator', toId: 'demo-worker', runId: run,
      kind: 'status', subject: 'fixture subject', body: 'fixture body' }));
    const env = envelopeOf(s, out.deliveryId);
    expect(env).toContain(`id: ${out.deliveryId}`);
    expect(env).toContain('from: operator');
    expect(env).toContain(`run: ${run} (program:demo-program wave 7/9)`);
    expect(s.db.prepare('SELECT fromId, fromUuid, toId, runId FROM mail WHERE id = ?').get(out.mailId))
      .toEqual({ fromId: 'operator', fromUuid: 'operator', toId: 'demo-worker', runId: run });
  });

  it('THROWS on an unstampable envelope, and under the caller\'s tx nothing it wrote survives', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    s.setDeliveryEnvelope = () => ({ ok: false as const, why: 'absent' as const });
    expect(() => tx(s.db, () => insertSystemMailTx(s, RUN_FIELDS, { fromId: 'operator', toId: 'demo-worker', runId: run,
      kind: 'status', subject: 'fixture subject', body: 'fixture body' }))).toThrow(/unstampable: absent/);
    expect(count(s, 'mail')).toBe(0);
    expect(count(s, 'mail_deliveries')).toBe(0);
  });

  it('queueSystemMail still dedupes BEFORE its one transaction, and opens exactly one', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const m = { fromId: 'coordinator' as const, toId: 'demo-worker', runId: run, kind: 'status' as const,
                subject: 'wave-brief', body: 'go' };
    expect(queueSystemMail(s, RUN_FIELDS, m).queued).toBe(true);
    expect(queueSystemMail(s, RUN_FIELDS, m)).toEqual({ queued: false });
    expect(() => tx(s.db, () => queueSystemMail(s, RUN_FIELDS, { ...m, subject: 'wave-done-rejected' })))
      .toThrow(/transaction/i);
    expect(count(s, 'mail')).toBe(1);
  });
});

describe('queueStallNotice: the observation row and the mail, in ONE transaction (§4.2)', () => {
  /** S4 on a fixture run: the worker's status, then the answer it was handed. */
  function s4(s: CoordStore): { run: { id: number; program: string; wave: number; waveOf: number }; answer: number } {
    const id = seedRun(s, { sessionId: 'demo-worker', wave: 9, reach: 'working', at: DISPATCHED_AT });
    mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: id, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    const answer = mailAt(s, { fromId: 'demo-coordinator', toId: 'demo-worker', runId: id, kind: 'answer',
      subject: 'go on', at: S4_ANSWER_AT });
    return { run: { id, program: 'demo-program', wave: 9, waveOf: 9 }, answer };
  }
  const r1 = (runId: number, answer: number) => ({
    detail: stallDetail('live', 'quiet', 1, S4_STATUS_AT), at: S4_R1_AT, toId: 'demo-worker', kind: 'status' as const,
    subject: `${STALL_CHECK_PREFIX} run ${runId} — quiet 2h 0m, owed: reply to #${answer}`,
    body: 'stall-check from the ccrc stall watch (server)',
  });

  it('queues an operator mail to the worker and records the rung, answering all three ids', () => {
    const s = store();
    const { run, answer } = s4(s);
    const q = queueStallNotice(s, run, r1(run.id, answer));
    if (!q.queued) throw new Error(`not queued: ${q.why}`);
    expect(s.db.prepare('SELECT fromId, toId, runId, kind, subject FROM mail WHERE id = ?').get(q.mailId)).toEqual({
      fromId: 'operator', toId: 'demo-worker', runId: run.id, kind: 'status', subject: r1(run.id, answer).subject });
    expect(envelopeOf(s, q.deliveryId)).toContain(`run: ${run.id} (program:demo-program wave 9/9)`);
    expect(stallRows(s, run.id)).toEqual([{ id: q.eventId, at: S4_R1_AT, fromState: 'working', toState: 'working',
      causedBy: 'operator', detail: stallDetail('live', 'quiet', 1, S4_STATUS_AT) }]);
    // The check is what pushNewMail's reply bind will find first.
    expect(s.firstMailIdWithPrefix(run.id, 'operator', 'demo-worker', STALL_CHECK_PREFIX)).toBe(q.mailId);
  });

  it('refuses the same rung twice as a duplicate, even after the first was ACKED, which the outstanding-mail dedupe cannot see', () => {
    const s = store();
    const { run, answer } = s4(s);
    const q = queueStallNotice(s, run, r1(run.id, answer));
    if (!q.queued) throw new Error(`not queued: ${q.why}`);
    s.markDelivered(q.deliveryId, S4_R1_AT + 5_000);
    s.markAcked(q.deliveryId, S4_R1_AT + 60_000);
    expect(queueStallNotice(s, run, { ...r1(run.id, answer), at: S4_R1_AT + 120_000 }))
      .toEqual({ queued: false, why: 'duplicate' });
    expect(count(s, 'mail')).toBe(3);                    // the S4 pair and ONE stall-check
  });

  it('answers run-gone for an absent run, and writes neither a row nor a mail', () => {
    const s = store();
    expect(queueStallNotice(s, { id: 424_242, program: 'demo-program', wave: 9, waveOf: 9 }, r1(424_242, 1)))
      .toEqual({ queued: false, why: 'run-gone' });
    expect(count(s, 'mail')).toBe(0);
    expect(stallRows(s, 424_242)).toEqual([]);
  });

  it('rolls the observation row back when the mail write throws, so a failed send never burns its rung', () => {
    const s = store();
    const { run, answer } = s4(s);
    const real = s.insertMail.bind(s);
    s.insertMail = () => { throw new Error('boom — simulated coord.db failure'); };
    expect(() => queueStallNotice(s, run, r1(run.id, answer))).toThrow(/boom/);
    expect(stallRows(s, run.id)).toEqual([]);
    s.insertMail = real;
    expect(queueStallNotice(s, run, r1(run.id, answer)).queued).toBe(true);
  });

  it('rolls the observation row back when the envelope cannot be stamped', () => {
    const s = store();
    const { run, answer } = s4(s);
    s.setDeliveryEnvelope = () => ({ ok: false as const, why: 'absent' as const });
    expect(() => queueStallNotice(s, run, r1(run.id, answer))).toThrow(/unstampable: absent/);
    expect(stallRows(s, run.id)).toEqual([]);
    expect(count(s, 'mail')).toBe(2);                    // only the S4 pair
    expect(count(s, 'mail_deliveries')).toBe(0);
  });

  it('r2 to the coordinator is its own rung on the same run, and the notice cannot be nested in another tx', () => {
    const s = store();
    const { run, answer } = s4(s);
    expect(queueStallNotice(s, run, r1(run.id, answer)).queued).toBe(true);
    const r2 = { detail: stallDetail('live', 'quiet', 2, S4_STATUS_AT), at: S4_R1_AT + 3_600_000,
      toId: 'demo-coordinator', kind: 'status' as const, subject: `${STALL_REPORT_PREFIX} run ${run.id} — worker silent 3h`,
      body: 'stall report from the ccrc stall watch (server)' };
    expect(() => tx(s.db, () => queueStallNotice(s, run, r2))).toThrow(/transaction/i);
    const q2 = queueStallNotice(s, run, r2);
    if (!q2.queued) throw new Error(`not queued: ${q2.why}`);
    expect(s.db.prepare('SELECT fromId, toId FROM mail WHERE id = ?').get(q2.mailId))
      .toEqual({ fromId: 'operator', toId: 'demo-coordinator' });
    expect(stallRows(s, run.id).map((r) => r.detail)).toEqual([
      stallDetail('live', 'quiet', 1, S4_STATUS_AT), stallDetail('live', 'quiet', 2, S4_STATUS_AT)]);
  });
});
