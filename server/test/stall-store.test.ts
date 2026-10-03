// Stall watch wave 1, Task 7 (spec 2026-09-29 §4.2): the store reads the stall
// lane consumes, the observation writer that is its durable dedupe, and the
// one-transaction notice queue. Fixture coord.db only (mkTmp), never a live one.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { insertSystemMailTx, queueStallNotice, queueSystemMail } from '../src/coord/rundefs.js';
import { STALL_CHECK_PREFIX, STALL_ORPHANED_PREFIX, STALL_REPLY_PREFIX, STALL_REPORT_PREFIX, stallDetail, stallRunMail } from '../src/coord/stall.js';
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
  const row = (id: number, o: { kind?: string; state: string; sessionId: string; dispatchedAt: number | null; wave: number }) => ({
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

  it('a candidate whose dispatchedAt is NULL stays a candidate, with dispatchedAt: null, and never fails the read', () => {
    const s = store();
    const undated = seedRun(s, { sessionId: 'demo-undated', wave: 7, reach: 'working', at: DISPATCHED_AT });
    s.db.prepare('UPDATE runs SET dispatchedAt = NULL WHERE id = ?').run(undated);
    const dated = seedRun(s, { sessionId: 'demo-dated', wave: 8, reach: 'working', at: DISPATCHED_AT });
    expect(s.stallCandidates()).toEqual({ ok: true, runs: [
      row(undated, { state: 'working', sessionId: 'demo-undated', dispatchedAt: null, wave: 7 }),
      row(dated, { state: 'working', sessionId: 'demo-dated', dispatchedAt: DISPATCHED_AT, wave: 8 }),
    ] });
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

describe('stallMailFor: the pins wave 1\'s mailOnRuns and deliveryTimesFor carried, moved here (rulings Q3)', () => {
  it('reads two overlapping runs\' mail interleaved by id, whatever order the ids come in; stallRunMail narrows it to exactly those runs\' rows', () => {
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
    const peer = mailAt(s, { fromId: 'demo-worker', toId: 'demo-peer', runId: null, kind: 'question', subject: 'peer q', at: S4_STATUS_AT });
    const c = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: newer, kind: 'status',
      subject: 'progress', at: S4_STATUS_AT });
    const d = mailAt(s, { fromId: 'demo-coordinator', toId: 'demo-worker', runId: newer, kind: 'answer',
      subject: 'go on', at: S4_ANSWER_AT });

    const read = s.stallMailFor('demo-worker', [newer, older], S4_STATUS_AT - 86_400_000);
    if (!read.ok) throw new Error(read.detail);
    // The whole read: the session's own run-less mail is in it, another worker's run is not.
    expect(read.mail.map((m) => m.id)).toEqual([a, b, peer, c, d]);
    // Wave 1's exact rows, through the L1 filter the lane applies to the run verdict (F4).
    expect(stallRunMail(read.mail, [newer, older])).toEqual([
      { id: a, at: S4_STATUS_AT - 3_600_000, runId: older, fromId: 'demo-worker', toId: 'coordinator', kind: 'status', subject: WAVE_DONE_SUBJECT },
      { id: b, at: S4_STATUS_AT - 1_800_000, runId: older, fromId: 'coordinator', toId: 'demo-worker', kind: 'status', subject: 'wave-done-rejected' },
      { id: c, at: S4_STATUS_AT, runId: newer, fromId: 'demo-worker', toId: 'coordinator', kind: 'status', subject: 'progress' },
      { id: d, at: S4_ANSWER_AT, runId: newer, fromId: 'demo-coordinator', toId: 'demo-worker', kind: 'answer', subject: 'go on' },
    ]);
  });

  it('an empty id list never emits IN (), and still answers the session\'s own mail', () => {
    const s = store();
    const spy = vi.spyOn(s.db, 'prepare');
    try {
      expect(s.stallMailFor('demo-worker', [], 0)).toEqual({ ok: true, mail: [], deliveries: [] });
      expect(spy.mock.calls.map((c) => String(c[0])).filter((sql) => /IN\s*\(\s*\)/.test(sql))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    const own = mailAt(s, { fromId: 'demo-worker', toId: 'demo-peer', runId: null, kind: 'question', subject: 'peer q', at: S4_STATUS_AT });
    const read = s.stallMailFor('demo-worker', [], S4_STATUS_AT);
    expect(read.ok && read.mail.map((m) => m.id)).toEqual([own]);
  });

  it('refuses the whole read on one unrepresentable mail time, naming the column and no value (D-2545)', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    const bad = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    s.db.prepare('UPDATE mail SET at = ? WHERE id = ?').run(UNSAFE, bad);
    expect(s.stallMailFor('demo-worker', [run], 0)).toEqual({ ok: false, kind: 'mail-unreadable', detail: 'mail at is not a positive safe integer' });
  });

  it('carries every delivery row of each mail it returns, with its delivered and acked times; a mail with none has no row', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const m = mailAt(s, { fromId: 'operator', toId: 'demo-worker', runId: run, kind: 'status',
      subject: `${STALL_CHECK_PREFIX} run ${run}`, at: S4_R1_AT });
    const rows = () => {
      const r = s.stallMailFor('demo-worker', [run], S4_R1_AT);
      if (!r.ok) throw new Error(r.detail);
      return [...r.deliveries].sort((x, y) => x.id - y.id);
    };
    expect(rows()).toEqual([]);
    const first = s.queueDelivery(m, 'demo-worker', '');
    expect(rows()).toMatchObject([{ id: first.id, mailId: m, toId: 'demo-worker', deliveredAt: null, ackedAt: null }]);
    s.markDelivered(first.id, S4_R1_AT + 5_000);
    s.markAcked(first.id, S4_R1_AT + 60_000);
    expect(rows()).toMatchObject([{ id: first.id, deliveredAt: S4_R1_AT + 5_000, ackedAt: S4_R1_AT + 60_000 }]);
    // A second delivery of one mail (the re-queue shape): both rows come back, and the lane cites the newest.
    const heir = s.queueDelivery(m, 'demo-heir', '');
    expect(rows()).toMatchObject([
      { id: first.id, ackedAt: S4_R1_AT + 60_000 },
      { id: heir.id, mailId: m, toId: 'demo-heir', deliveredAt: null, ackedAt: null },
    ]);
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

  // D-3584 run-gone-includes-inactive: the lane awaits between its candidate read and
  // its write, so a run that has left the active states in that window is gone too.
  it('answers run-gone for a run that is no longer active (D-3584), and adds no row, from either writer', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    expect(s.recordStallObservation(run, stallDetail('live', 'quiet', 1, S4_STATUS_AT), S4_R1_AT).recorded).toBe(true);
    expect(s.advance(run, 'awaiting-review', 'coordinator').ok).toBe(true);
    const r2 = stallDetail('live', 'quiet', 2, S4_STATUS_AT);
    expect(s.recordStallObservation(run, r2, S4_R1_AT + 3_600_000)).toEqual({ recorded: false, why: 'run-gone' });
    expect(s.insertStallObservation(run, r2, S4_R1_AT + 3_600_000)).toEqual({ recorded: false, why: 'run-gone' });
    expect(stallRows(s, run)).toHaveLength(1);
  });

  it('still records on a run in `unknown`, which is ACTIVE (D-3584 keeps the cap\'s safe direction)', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('unknown', run);
    const r = s.recordStallObservation(run, stallDetail('live', 'quiet', 1, S4_STATUS_AT), S4_R1_AT);
    if (!r.recorded) throw new Error(`not recorded: ${r.why}`);
    expect(stallRows(s, run)).toEqual([{ id: r.eventId, at: S4_R1_AT, fromState: 'unknown', toState: 'unknown',
      causedBy: 'operator', detail: stallDetail('live', 'quiet', 1, S4_STATUS_AT) }]);
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
    // The ORDER: a declined mail never reaches BEGIN, so the same subject nested in a
    // caller's tx answers `{queued:false}` and does NOT throw. A dedupe moved inside
    // the tx would throw here, exactly as the new-subject call below does either way.
    expect(tx(s.db, () => queueSystemMail(s, RUN_FIELDS, m))).toEqual({ queued: false });
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

  it('answers run-gone for a run that closed to `done` (D-3584), and writes neither a row, a mail nor a delivery', () => {
    const s = store();
    // A review run closes `working -> done` directly (`REVIEW_RUN_TRANSITIONS`), through the store's own writer.
    const id = seedRun(s, { sessionId: 'demo-reviewer', wave: 9, reach: 'working', at: DISPATCHED_AT, kind: 'review' });
    mailAt(s, { fromId: 'demo-reviewer', toId: 'coordinator', runId: id, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    expect(s.advance(id, 'done', 'coordinator').ok).toBe(true);
    const run = { id, program: 'demo-program', wave: 9, waveOf: 9 };
    expect(queueStallNotice(s, run, { ...r1(id, 1), toId: 'demo-reviewer' })).toEqual({ queued: false, why: 'run-gone' });
    expect(count(s, 'mail')).toBe(1);                    // only the worker's own status
    expect(count(s, 'mail_deliveries')).toBe(0);
    expect(stallRows(s, id)).toEqual([]);
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

// ── stall watch wave 2, Task 14: the store half of the session arms ─────────────────────────────────────────
// `hasMailWithSubject` (the run-less notice's durable dedupe), `stallMailFor` (one mail read per candidate,
// with those mails' delivery rows) and `queueStallNotice(null)`. Fixture coord.db only.

const W2_HOUR = 3_600_000;
/** The horizon the lane hands `stallMailFor` for the non-run half of its read: `now - BACKLOG_HORIZON_MS` at r1. */
const W2_SINCE_AT = S4_R1_AT - 24 * W2_HOUR;
/** An orphan-D self-wake subject in Task 13's form: it names the restart to the day and minute (`stallUtc`). */
const W2_ORPHANED_SUBJECT = `${STALL_ORPHANED_PREFIX} 2 background task(s) (subagent, shell) did not survive the 2026-09-28T21:00Z restart`;

describe('hasMailWithSubject: any mail with this exact key was ever queued, in EVERY delivery state (wave 2)', () => {
  /** The self-wake above, from the operator role to one session. */
  const put = (s: CoordStore, runId: number | null, toId = 'demo-worker'): number =>
    mailAt(s, { fromId: 'operator', toId, runId, kind: 'status', subject: W2_ORPHANED_SUBJECT, at: S4_R1_AT });

  it('answers true for a mail with NO delivery row: it reads `mail` alone, never a join', () => {
    const s = store();
    expect(s.hasMailWithSubject('operator', null, 'demo-worker', W2_ORPHANED_SUBJECT)).toBe(false);
    put(s, null);
    expect(count(s, 'mail_deliveries')).toBe(0);
    expect(s.hasMailWithSubject('operator', null, 'demo-worker', W2_ORPHANED_SUBJECT)).toBe(true);
  });

  it.each(['queued', 'delivered', 'acked', 'rejected', 'unknown'] as const)(
    'answers true with its delivery %s, where the outstanding read answers only for queued and delivered',
    (state) => {
      const s = store();
      const d = s.queueDelivery(put(s, null), 'demo-worker', '');
      if (state === 'delivered' || state === 'acked') s.markDelivered(d.id, S4_R1_AT + 5_000);
      if (state === 'acked') s.markAcked(d.id, S4_R1_AT + 60_000);
      if (state === 'rejected') s.rejectDelivery(d.id, 'undeliverable', 'recipient not in registry');
      // The vocabulary's own degrade member, written raw: the state column is free text (schema.ts).
      if (state === 'unknown') s.db.prepare('UPDATE mail_deliveries SET state = ? WHERE id = ?').run('unknown', d.id);
      expect(s.db.prepare('SELECT state FROM mail_deliveries WHERE id = ?').get(d.id)).toEqual({ state });
      expect(s.hasMailWithSubject('operator', null, 'demo-worker', W2_ORPHANED_SUBJECT)).toBe(true);
      // The control: the outstanding read forgets a finished mail, which is why the run-less dedupe cannot use it.
      expect(s.hasOutstandingMail('operator', null, 'demo-worker', W2_ORPHANED_SUBJECT))
        .toBe(state === 'queued' || state === 'delivered');
    });

  it('is null-safe on runId both ways: a run-less key never matches a run mail, and a run key never a run-less one', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    put(s, run);
    expect(s.hasMailWithSubject('operator', run, 'demo-worker', W2_ORPHANED_SUBJECT)).toBe(true);
    expect(s.hasMailWithSubject('operator', null, 'demo-worker', W2_ORPHANED_SUBJECT)).toBe(false);
    put(s, null, 'demo-other');
    expect(s.hasMailWithSubject('operator', null, 'demo-other', W2_ORPHANED_SUBJECT)).toBe(true);
    expect(s.hasMailWithSubject('operator', run, 'demo-other', W2_ORPHANED_SUBJECT)).toBe(false);
  });

  it('keys on the exact sender, the mail row\'s OWN toId and the exact subject', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    // Addressed to the coordinator role and delivered to the session behind it: the row's toId is the role.
    s.queueDelivery(put(s, run, 'coordinator'), 'demo-coordinator', '');
    expect(s.hasMailWithSubject('operator', run, 'coordinator', W2_ORPHANED_SUBJECT)).toBe(true);
    expect(s.hasMailWithSubject('operator', run, 'demo-coordinator', W2_ORPHANED_SUBJECT)).toBe(false);
    expect(s.hasMailWithSubject('coordinator', run, 'coordinator', W2_ORPHANED_SUBJECT)).toBe(false);
    expect(s.hasMailWithSubject('operator', run, 'coordinator', W2_ORPHANED_SUBJECT.slice(0, -1))).toBe(false);
    expect(s.hasMailWithSubject('operator', run, 'coordinator', `${W2_ORPHANED_SUBJECT} `)).toBe(false);
  });
});

describe('stallMailFor: one mail read per candidate, and those mails\' delivery rows (wave 2, M5)', () => {
  it('reads the run\'s whole history, and the session\'s own traffic inside the horizon, in id order', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const other = seedRun(s, { sessionId: 'demo-other', wave: 6, reach: 'working', at: DISPATCHED_AT });
    // IN: on the run and older than the horizon. The run clause is unbounded: the ladder keys on its whole exchange.
    const onRunOld = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status',
      subject: WAVE_DONE_SUBJECT, at: W2_SINCE_AT - W2_HOUR });
    // OUT: off the run, from the session, one millisecond older than the horizon.
    mailAt(s, { fromId: 'demo-worker', toId: 'demo-peer', runId: null, kind: 'question', subject: 'old peer q',
      at: W2_SINCE_AT - 1 });
    // IN: off the run, from the session, exactly AT the horizon (`at >= sinceAt`).
    const peerAtHorizon = mailAt(s, { fromId: 'demo-worker', toId: 'demo-peer', runId: null, kind: 'question',
      subject: 'peer q', at: W2_SINCE_AT });
    // IN: a run-less self-wake TO the session.
    const selfWake = mailAt(s, { fromId: 'operator', toId: 'demo-worker', runId: null, kind: 'status',
      subject: W2_ORPHANED_SUBJECT, at: S4_STATUS_AT });
    // OUT: another run's mail between two other sessions.
    mailAt(s, { fromId: 'demo-other', toId: 'coordinator', runId: other, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    // IN: another run's mail FROM the session, inside the horizon. It is off this subject's runs, so the lane's
    // `stallRunMail` keeps it out of the run verdict and only the session verdicts see it.
    const offRun = mailAt(s, { fromId: 'demo-worker', toId: 'demo-other', runId: other, kind: 'answer',
      subject: 'peer answer', at: S4_ANSWER_AT });
    // IN through its DELIVERY: addressed to the coordinator role, delivered to the session.
    const toRole = mailAt(s, { fromId: 'demo-other', toId: 'coordinator', runId: null, kind: 'question',
      subject: 'to the role', at: S4_ANSWER_AT });
    const toRoleDelivery = s.queueDelivery(toRole, 'demo-worker', '');
    // OUT: addressed to the role and delivered to someone else.
    s.queueDelivery(mailAt(s, { fromId: 'demo-other', toId: 'coordinator', runId: null, kind: 'question',
      subject: 'to the role, not us', at: S4_ANSWER_AT }), 'demo-heir', '');
    // OUT: delivered to the session but older than the horizon. The bound covers all three session clauses.
    s.queueDelivery(mailAt(s, { fromId: 'demo-other', toId: 'coordinator', runId: null, kind: 'question',
      subject: 'to the role, long ago', at: W2_SINCE_AT - 1 }), 'demo-worker', '');
    const selfWakeDelivery = s.queueDelivery(selfWake, 'demo-worker', '');

    expect(s.stallMailFor('demo-worker', [run], W2_SINCE_AT)).toEqual({ ok: true, mail: [
      { id: onRunOld, at: W2_SINCE_AT - W2_HOUR, runId: run, fromId: 'demo-worker', toId: 'coordinator', kind: 'status', subject: WAVE_DONE_SUBJECT },
      { id: peerAtHorizon, at: W2_SINCE_AT, runId: null, fromId: 'demo-worker', toId: 'demo-peer', kind: 'question', subject: 'peer q' },
      { id: selfWake, at: S4_STATUS_AT, runId: null, fromId: 'operator', toId: 'demo-worker', kind: 'status', subject: W2_ORPHANED_SUBJECT },
      { id: offRun, at: S4_ANSWER_AT, runId: other, fromId: 'demo-worker', toId: 'demo-other', kind: 'answer', subject: 'peer answer' },
      { id: toRole, at: S4_ANSWER_AT, runId: null, fromId: 'demo-other', toId: 'coordinator', kind: 'question', subject: 'to the role' },
    ], deliveries: [
      { id: toRoleDelivery.id, mailId: toRole, toId: 'demo-worker', state: 'queued', deliveredAt: null, ackedAt: null, lastGate: null, gateSince: null },
      { id: selfWakeDelivery.id, mailId: selfWake, toId: 'demo-worker', state: 'queued', deliveredAt: null, ackedAt: null, lastGate: null, gateSince: null },
    ] });
  });

  it('hands EVERY delivery row of a selected mail, oldest first, the gate columns as plain values', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const check = mailAt(s, { fromId: 'operator', toId: 'demo-worker', runId: run, kind: 'status',
      subject: `${STALL_CHECK_PREFIX} run ${run} — quiet 2h 0m, owed: first report`, at: S4_R1_AT });
    const first = s.queueDelivery(check, 'demo-worker', '');
    s.markDelivered(first.id, S4_R1_AT + 5_000);
    s.markAcked(first.id, S4_R1_AT + 60_000);
    // A second delivery of one mail (the re-queue shape), held at the gate. The lane takes the newest as the live
    // one (L1's `stallNewestDelivery`), the rule wave 1's per-mail delivery read applied.
    const second = s.queueDelivery(check, 'demo-heir', '');
    s.noteGate(second.id, 'registry-unmeasurable', S4_R1_AT + 120_000, false, null);
    const read = s.stallMailFor('demo-worker', [run], W2_SINCE_AT);
    expect(read.ok && read.deliveries).toEqual([
      { id: first.id, mailId: check, toId: 'demo-worker', state: 'acked', deliveredAt: S4_R1_AT + 5_000,
        ackedAt: S4_R1_AT + 60_000, lastGate: null, gateSince: null },
      { id: second.id, mailId: check, toId: 'demo-heir', state: 'queued', deliveredAt: null, ackedAt: null,
        lastGate: 'registry-unmeasurable', gateSince: S4_R1_AT + 120_000 },
    ]);
  });

  it('with no runs, reads the session\'s own traffic only, and never binds an empty IN ()', () => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status', subject: 'progress',
      at: W2_SINCE_AT - W2_HOUR });
    const recent = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status', subject: 'progress',
      at: S4_STATUS_AT });
    const spy = vi.spyOn(s.db, 'prepare');
    try {
      const read = s.stallMailFor('demo-worker', [], W2_SINCE_AT);
      expect(read.ok && read.mail.map((m) => m.id)).toEqual([recent]);
      const sql = spy.mock.calls.map((c) => String(c[0]));
      expect(sql).toHaveLength(2);
      expect(sql.filter((q) => /IN \(\s*\)/.test(q))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('answers {ok:true, mail:[], deliveries:[]} for a session with no mail, and prepares no delivery statement', () => {
    const s = store();
    const spy = vi.spyOn(s.db, 'prepare');
    try {
      expect(s.stallMailFor('demo-worker', [], W2_SINCE_AT)).toEqual({ ok: true, mail: [], deliveries: [] });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    ['mail id', 'mail-unreadable', 'mail id is not a positive safe integer'],
    ['mail at', 'mail-unreadable', 'mail at is not a positive safe integer'],
    ['mail runId', 'mail-unreadable', 'mail runId is not a positive safe integer'],
    ['delivery id', 'delivery-unreadable', 'delivery id is not a positive safe integer'],
    ['delivery deliveredAt', 'delivery-unreadable', 'delivery deliveredAt is not a positive safe integer'],
    ['delivery ackedAt', 'delivery-unreadable', 'delivery ackedAt is not a positive safe integer'],
    ['delivery gateSince', 'delivery-unreadable', 'delivery gateSince is not a positive safe integer'],
  ] as const)('refuses the WHOLE read on one unrepresentable %s, naming its table\'s kind and the column, and no value (D-2545)', (column, kind, detail) => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const plain = mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status', subject: 'progress', at: S4_STATUS_AT });
    const bad = mailAt(s, { fromId: 'operator', toId: 'demo-worker', runId: null, kind: 'status',
      subject: W2_ORPHANED_SUBJECT, at: S4_STATUS_AT });
    const d = s.queueDelivery(bad, 'demo-worker', '');
    // `plain` has no delivery row, so its id moves with the foreign key still on.
    if (column === 'mail id') s.db.prepare('UPDATE mail SET id = ? WHERE id = ?').run(UNSAFE, plain);
    if (column === 'mail at') s.db.prepare('UPDATE mail SET at = ? WHERE id = ?').run(UNSAFE, bad);
    if (column === 'mail runId') {
      // A run id this process cannot represent has no runs row to reference, so the fixture lifts the FK first.
      s.db.exec('PRAGMA foreign_keys = OFF');
      s.db.prepare('UPDATE mail SET runId = ? WHERE id = ?').run(UNSAFE, bad);
    }
    if (column === 'delivery id') s.db.prepare('UPDATE mail_deliveries SET id = ? WHERE id = ?').run(UNSAFE, d.id);
    if (column === 'delivery deliveredAt') s.db.prepare('UPDATE mail_deliveries SET deliveredAt = ? WHERE id = ?').run(UNSAFE, d.id);
    if (column === 'delivery ackedAt') s.db.prepare('UPDATE mail_deliveries SET ackedAt = ? WHERE id = ?').run(UNSAFE, d.id);
    if (column === 'delivery gateSince') s.db.prepare('UPDATE mail_deliveries SET gateSince = ? WHERE id = ?').run(UNSAFE, d.id);
    expect(s.stallMailFor('demo-worker', [run], W2_SINCE_AT)).toEqual({ ok: false, kind, detail });
    expect(detail).not.toMatch(/[0-9]/);
  });
});

describe('queueStallNotice(null): the run-less notice, deduped on its subject inside its one transaction (wave 2)', () => {
  /** An orphan-D self-wake as the lane hands it. The run-less arm uses neither `detail` nor `at`. */
  const notice = (subject: string = W2_ORPHANED_SUBJECT, toId = 'demo-worker') => ({
    detail: stallDetail('live', 'orphan-d', 1, Date.parse('2026-09-28T21:00:00Z')), at: S4_R1_AT, toId,
    kind: 'status' as const, subject, body: 'orphaned background work notice from the ccrc stall watch (server)',
  });
  const stallEvents = (s: CoordStore): number =>
    (s.db.prepare("SELECT count(*) AS c FROM run_events WHERE detail LIKE 'stall%'").get() as { c: number }).c;

  it('queues an operator mail with no run and no run line, answers eventId null, and writes no run_events row', () => {
    const s = store();
    seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });   // a run it must not touch
    const q = queueStallNotice(s, null, notice());
    if (!q.queued) throw new Error(`not queued: ${q.why}`);
    expect(q.eventId).toBeNull();
    expect(s.db.prepare('SELECT fromId, toId, runId, kind, subject FROM mail WHERE id = ?').get(q.mailId)).toEqual({
      fromId: 'operator', toId: 'demo-worker', runId: null, kind: 'status', subject: W2_ORPHANED_SUBJECT });
    expect(envelopeOf(s, q.deliveryId)).toContain('from: operator');
    expect(envelopeOf(s, q.deliveryId)).not.toContain('run:');
    expect(stallEvents(s)).toBe(0);
  });

  it('refuses the same subject to the same session as a duplicate even after the first was ACKED', () => {
    const s = store();
    const q = queueStallNotice(s, null, notice());
    if (!q.queued) throw new Error(`not queued: ${q.why}`);
    s.markDelivered(q.deliveryId, S4_R1_AT + 5_000);
    s.markAcked(q.deliveryId, S4_R1_AT + 60_000);
    expect(queueStallNotice(s, null, { ...notice(), at: S4_R1_AT + 120_000 })).toEqual({ queued: false, why: 'duplicate' });
    expect(count(s, 'mail')).toBe(1);
    expect(count(s, 'mail_deliveries')).toBe(1);
  });

  it('another episode\'s subject, or the same subject to another session, is its own notice', () => {
    const s = store();
    expect(queueStallNotice(s, null, notice()).queued).toBe(true);
    const nextDay = W2_ORPHANED_SUBJECT.replace('2026-09-28T21:00Z', '2026-09-29T21:00Z');
    expect(nextDay).not.toBe(W2_ORPHANED_SUBJECT);
    expect(queueStallNotice(s, null, notice(nextDay)).queued).toBe(true);
    expect(queueStallNotice(s, null, notice(W2_ORPHANED_SUBJECT, 'demo-coordinator')).queued).toBe(true);
    expect(count(s, 'mail')).toBe(3);
  });

  it('dedupes INSIDE its one transaction: nested in a caller\'s tx, even a duplicate throws', () => {
    const s = store();
    expect(queueStallNotice(s, null, notice()).queued).toBe(true);
    // A dedupe read before BEGIN would answer `duplicate` here without opening anything. Inside, BEGIN refuses first.
    expect(() => tx(s.db, () => queueStallNotice(s, null, notice()))).toThrow(/transaction/i);
    expect(count(s, 'mail')).toBe(1);
  });

  it('rolls the mail back when the envelope cannot be stamped, so a failed send leaves nothing to dedupe on', () => {
    const s = store();
    s.setDeliveryEnvelope = () => ({ ok: false as const, why: 'absent' as const });
    expect(() => queueStallNotice(s, null, notice())).toThrow(/unstampable: absent/);
    expect(count(s, 'mail')).toBe(0);
    expect(count(s, 'mail_deliveries')).toBe(0);
    expect(s.hasMailWithSubject('operator', null, 'demo-worker', W2_ORPHANED_SUBJECT)).toBe(false);
  });
});

describe('stallMailFor: planned on indexes, and no other mail read re-planned (wave 5)', () => {
  /** Every statement `fn` prepares, in order, as it prepared it. */
  const preparedBy = (s: CoordStore, fn: () => unknown): string[] => {
    const spy = vi.spyOn(s.db, 'prepare');
    try { fn(); return spy.mock.calls.map((c) => String(c[0])); } finally { spy.mockRestore(); }
  };
  /** EXPLAIN QUERY PLAN's detail lines, joined. The server never runs ANALYZE, so this is the plan it runs. */
  const planOf = (s: CoordStore, sql: string): string =>
    (s.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
  const SCAN = /\bSCAN (mail|mail_deliveries)\b/;

  it('CONTROL: the scan pattern sees a table scan and a covering-index scan, and not a SEARCH or a CTE scan', () => {
    expect(SCAN.test('SCAN mail | LIST SUBQUERY 1')).toBe(true);
    expect(SCAN.test('SCAN mail_deliveries USING COVERING INDEX mail_deliveries_due')).toBe(true);
    expect(SCAN.test('SEARCH mail USING INDEX mail_by_at (at>?)')).toBe(false);
    expect(SCAN.test('SCAN sel')).toBe(false);
  });

  it.each([
    ['a run worker (its runs bound)', true],
    ['a coordinator or a registry row (no runs)', false],
  ] as const)('%s: both statements SEARCH, and neither scans mail or mail_deliveries', (_name, withRun) => {
    const s = store();
    const run = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    // One selected mail, so the delivery statement is prepared too.
    s.queueDelivery(mailAt(s, { fromId: 'demo-worker', toId: 'coordinator', runId: run, kind: 'status',
      subject: 'progress', at: S4_STATUS_AT }), 'demo-coordinator', '');
    const sql = preparedBy(s, () => s.stallMailFor('demo-worker', withRun ? [run] : [], W2_SINCE_AT));
    expect(sql).toHaveLength(2);
    for (const q of sql) expect(planOf(s, q), q).not.toMatch(SCAN);
  });

  it('hasMailWithSubject reads mail through an index', () => {
    const s = store();
    const [q] = preparedBy(s, () => s.hasMailWithSubject('operator', null, 'demo-worker', 'x'));
    expect(planOf(s, q!)).not.toMatch(SCAN);
  });

  it.each([
    ['hasOutstandingPeerDuplicate', (s: CoordStore) => s.hasOutstandingPeerDuplicate('demo-a', 'demo-b', 'x')],
    ['outstandingPeerCount', (s: CoordStore) => s.outstandingPeerCount('demo-a', 'demo-b')],
    ['outstandingMailFor', (s: CoordStore) => s.outstandingMailFor('demo-b')],
    ['dueDeliveries', (s: CoordStore) => s.dueDeliveries(1, 1)],
  ] as const)('%s still reads its deliveries through mail_deliveries_due (an index led by toId would take it)', (_name, fn) => {
    const s = store();
    const sql = preparedBy(s, () => fn(s));
    expect(sql.length).toBeGreaterThan(0);
    for (const q of sql) expect(planOf(s, q), q).toContain('mail_deliveries_due');
  });

  it('selects exactly the rows its predicate names, against a reference over the raw tables', () => {
    const s = store();
    const runA = seedRun(s, { sessionId: 'demo-worker', wave: 7, reach: 'working', at: DISPATCHED_AT });
    const runB = seedRun(s, { sessionId: 'demo-other', wave: 6, reach: 'working', at: DISPATCHED_AT });
    const who = ['demo-worker', 'demo-other', 'demo-peer', 'operator', 'coordinator'] as const;
    const ats = [W2_SINCE_AT - W2_HOUR, W2_SINCE_AT - 1, W2_SINCE_AT, W2_SINCE_AT + 1, S4_STATUS_AT] as const;
    // A fixed 32-bit LCG, so the fixture is the same on every run and every box. `Math.imul` and `>>> 0` keep every
    // step exact (a plain `*` passes 2^53 and loses the low bits), and `% n` reads the high bits, never the low ones.
    let seed = 7;
    const pick = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) % n; };
    for (let i = 0; i < 80; i++) {
      const id = mailAt(s, { fromId: who[pick(4)]!, toId: who[1 + pick(4)]!, runId: [runA, runB, null][pick(3)]!,
        kind: 'status', subject: `m${i}`, at: ats[pick(ats.length)]! });
      for (let k = pick(3); k > 0; k--) s.queueDelivery(id, who[pick(3)]!, '');
    }
    // The bounded subquery's edge, written out rather than left to the draws: mail to the coordinator ROLE that
    // reaches demo-peer only through its delivery row, once exactly AT the horizon (selected) and once a
    // millisecond before it (not selected).
    for (const at of [W2_SINCE_AT, W2_SINCE_AT - 1]) {
      s.queueDelivery(mailAt(s, { fromId: 'demo-other', toId: 'coordinator', runId: null, kind: 'question',
        subject: `role mail at ${at}`, at }), 'demo-peer', '');
    }
    const mail = s.db.prepare('SELECT id, at, runId, fromId, toId FROM mail ORDER BY id').all() as
      { id: number; at: number; runId: number | null; fromId: string; toId: string }[];
    const dels = s.db.prepare('SELECT id, mailId, toId FROM mail_deliveries ORDER BY id').all() as
      { id: number; mailId: number; toId: string }[];
    let compared = 0;
    for (const sid of ['demo-worker', 'demo-other', 'demo-peer']) {
      for (const runIds of [[], [runA], [runA, runB]]) {
        const want = mail.filter((m) => (m.runId !== null && runIds.includes(m.runId))
          || ((m.fromId === sid || m.toId === sid || dels.some((d) => d.mailId === m.id && d.toId === sid))
              && m.at >= W2_SINCE_AT)).map((m) => m.id);
        const got = s.stallMailFor(sid, runIds, W2_SINCE_AT);
        expect(got.ok && got.mail.map((m) => m.id), `${sid} on [${runIds.join(',')}]`).toEqual(want);
        expect(got.ok && got.deliveries.map((d) => d.id), `${sid} on [${runIds.join(',')}]`)
          .toEqual(dels.filter((d) => want.includes(d.mailId)).map((d) => d.id));
        compared += want.length;
      }
    }
    // Non-vacuity: the draws spread over every sender and recipient, and the reference compared well over 100 rows.
    expect(new Set(mail.map((m) => m.fromId)).size).toBe(4);
    expect(new Set(mail.map((m) => m.toId)).size).toBe(4);
    expect(compared).toBeGreaterThan(100);
    // The horizon edge: a coordinator-role mail at exactly `sinceAt` reaches demo-peer through its delivery row alone,
    // and is selected; its twin a millisecond older is not.
    const roleAt = (at: number): number => mail.find((m) => m.toId === 'coordinator' && m.fromId === 'demo-other'
      && m.at === at && dels.some((d) => d.mailId === m.id && d.toId === 'demo-peer'))!.id;
    const peer = s.stallMailFor('demo-peer', [], W2_SINCE_AT);
    expect(peer.ok && peer.mail.map((m) => m.id)).toContain(roleAt(W2_SINCE_AT));
    expect(peer.ok && peer.mail.map((m) => m.id)).not.toContain(roleAt(W2_SINCE_AT - 1));
  });
});
