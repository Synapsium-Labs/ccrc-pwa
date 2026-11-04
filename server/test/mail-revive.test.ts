// D-5914 / D-7901 (spec 2026-10-20 §3, #125): a parked mail comes back with its recipient, and `unreadMail` counts it
// once. A delivery the lane rejected because its recipient's lifecycle read dead gets ONE heir — a new delivery of the
// same mail naming it in `revivedFrom` — once that recipient reads live again; the parent is never written, and its
// retirement is derived in the read (`HAS_HEIR_SQL`). Fixtures use neutral ids (this repository is public).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_REPLAY_CEILING_ERROR, MAIL_RUN_CLOSED_ERROR } from '../src/coord/store.js';
import { MAIL_DISABLED_MARKER } from '../../shared/switches.js';
import { parkExpiredError, parkNoticeSubject, sessionDeadError } from '../src/coord/delivery.js';
import { REVIVABLE_PARK_ERRORS, REVIVE_SKIPPED_SENDERS, REVIVE_SKIPPED_SUBJECT_HEADS, revivable } from '../src/coord/mailRevive.js';
import { BRIEF_NOTICE_DETAIL, WAVE_BRIEF_SUBJECT, briefNotTakenSubject } from '../src/coord/briefwatch.js';
import { DONE_CLAIM_ANSWER_SUBJECTS, doneRejectionMail } from '../src/coord/closeDecide.js';
import { checksSubject, dequeuedSubject, mergedSubject } from '../src/coord/landing.js';
import { queueLandingNotice, queueStallNotice, queueSystemMail } from '../src/coord/rundefsTx.js';
import { DISPATCH_ABANDON_SUBJECT } from '../../shared/dispatch-abandon.js';
import { checksRowDetail, mergingAtDetail } from '../../shared/landing.js';
import { STALL_CHECK_PREFIX, STALL_REPORT_PREFIX } from '../src/coord/stall.js';
import { DEAD_LIFECYCLES, type LifecycleInput } from '../../shared/api.js';
import type { PushPayload } from '../src/push.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';
import { callsIn, symbolOf } from './scan/symbols.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');

const NOW = 1_800_000_000_000;
const DISPATCHED_AT = NOW - 60_000;
const WORKER = 'lane-a-worker';
const COORD = 'lane-a-coordinator';
const HEIR_COORD = 'lane-a-new-coordinator';
const SENDER = 'lane-a-sender';
const ORPHAN = sessionDeadError('orphan');

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-revive-'), '.ccrc', 'coord.db')));

/** An open, dispatched run: `WORKER` bound at `DISPATCHED_AT`, `COORD` in the chair. */
const dispatchedRun = (s: CoordStore, over: { wave?: number; dispatchedAt?: number } = {}): number => {
  const opened = s.openRun({ program: 'prog-a', title: 'T', project: 'project-a',
    wave: over.wave ?? 1, waveOf: 3, claimedBy: COORD });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  s.markDispatched(opened.id, WORKER, null, null, false, over.dispatchedAt ?? DISPATCHED_AT);
  return opened.id;
};

/** One mail and its one delivery, as `POST /api/mail` writes the pair: `toId` is what the sender addressed, `deliverTo`
 *  the resolved recipient. */
const send = (s: CoordStore, m: { runId: number; toId?: string; fromId?: string; subject?: string },
              deliverTo = m.toId ?? WORKER): number => {
  const mail = s.insertMail({ fromId: m.fromId ?? SENDER, fromUuid: 'u-sender', toId: m.toId ?? WORKER,
    runId: m.runId, kind: 'status', subject: m.subject ?? 'wave-brief', body: 'go', artifacts: [] });
  return s.queueDelivery(mail.id, deliverTo, 'envelope rendered once, at queue time').id;
};

/** A delivery parked the way the lane parks it: `rejected`/`undeliverable` with `error` as its `lastError`. */
const park = (s: CoordStore, id: number, error = ORPHAN): void => {
  expect(s.rejectDelivery(id, 'undeliverable', error).changed).toBe(true);
};

const row = (s: CoordStore, id: number) =>
  s.db.prepare('SELECT mailId, toId, state, rejectCode, lastError, revivedFrom, envelope FROM mail_deliveries WHERE id = ?')
    .get(id) as { mailId: number; toId: string; state: string; rejectCode: string | null; lastError: string | null;
                  revivedFrom: number | null; envelope: string };
const deliveriesOf = (s: CoordStore, mailId: number) =>
  s.db.prepare('SELECT id, toId, state, revivedFrom FROM mail_deliveries WHERE mailId = ? ORDER BY id').all(mailId) as
    { id: number; toId: string; state: string; revivedFrom: number | null }[];
const unread = (s: CoordStore, runId: number): number => okRun(s.run(runId))!.unreadMail;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('reviveParkedDeliveries: what comes back', () => {
  it('a lifecycle park on an open run is revived once its recipient reads live', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    const before = row(s, d);

    const { revived } = s.reviveParkedDeliveries([WORKER]);

    expect(revived).toHaveLength(1);
    const heir = revived[0]!;
    expect(heir).toMatchObject({ from: d, mailId: before.mailId, toId: WORKER });
    expect(row(s, heir.heir)).toMatchObject({ mailId: before.mailId, toId: WORKER, state: 'queued', revivedFrom: d });
    // The heir renders its OWN envelope: it names itself on the ack line, not its parent.
    expect(row(s, heir.heir).envelope).toContain(`ccrc-api mail ack ${heir.heir} `);
    // The parent is never written: no terminal row goes back to `queued`.
    expect(row(s, d)).toEqual(before);
  });

  it('every dead lifecycle word is a lifecycle park, derived from DEAD_LIFECYCLES', () => {
    expect(DEAD_LIFECYCLES.length).toBeGreaterThan(0);
    for (const lc of DEAD_LIFECYCLES) {
      const s = store();
      const runId = dispatchedRun(s);
      const d = send(s, { runId });
      park(s, d, sessionDeadError(lc));
      expect(s.reviveParkedDeliveries([WORKER]).revived.map((r) => r.from), lc).toEqual([d]);
    }
  });

  it('a legacy draft-present park and a legacy enter-ignored park on an open run are revived', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const a = send(s, { runId });
    const b = send(s, { runId });
    park(s, a, 'draft-present');
    park(s, b, 'enter-ignored');
    expect(s.reviveParkedDeliveries([WORKER]).revived.map((r) => r.from)).toEqual([a, b]);
  });

  it('not while its recipient is out of the live set', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    expect(s.reviveParkedDeliveries([]).revived).toEqual([]);
    expect(s.reviveParkedDeliveries(['lane-a-bystander']).revived).toEqual([]);
    expect(deliveriesOf(s, row(s, d).mailId)).toHaveLength(1);
  });

  it("a closed run's park is never revived", () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    expect(s.advance(runId, 'failed', 'operator')).toMatchObject({ ok: true });
    expect(s.reviveParkedDeliveries([WORKER]).revived).toEqual([]);
  });

  it("a park created before the run's dispatchedAt is never revived", () => {
    const s = store();
    const runId = dispatchedRun(s);
    vi.setSystemTime(DISPATCHED_AT - 1);
    const old = send(s, { runId });
    vi.setSystemTime(NOW);
    const current = send(s, { runId });
    park(s, old);
    park(s, current);
    // A re-dispatch (the next wave) moves `dispatchedAt` past both.
    expect(s.reviveParkedDeliveries([WORKER]).revived.map((r) => r.from)).toEqual([current]);
    s.markDispatched(runId, WORKER, null, null, true, NOW + 1);
    const later = send(s, { runId });
    park(s, later);
    vi.setSystemTime(NOW + 2);
    expect(s.reviveParkedDeliveries([WORKER]).revived.map((r) => r.from)).toEqual([]);
  });

  it('a run never dispatched revives nothing', () => {
    const s = store();
    const opened = s.openRun({ program: 'prog-a', title: 'T', project: 'project-a', wave: 1, waveOf: 3, claimedBy: COORD });
    if (!('id' in opened)) throw new Error('fixture');
    const d = send(s, { runId: opened.id });
    park(s, d);
    expect(s.reviveParkedDeliveries([WORKER]).revived).toEqual([]);
  });

  it('a stall nudge and a server system notice are never revived', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const check = send(s, { runId, fromId: 'operator', subject: `${STALL_CHECK_PREFIX} still there?` });
    const report = send(s, { runId, fromId: 'operator', subject: `${STALL_REPORT_PREFIX} worker quiet` });
    const notice = send(s, { runId, fromId: 'operator', subject: parkNoticeSubject('parked', 'wave-brief') });
    const rejected = send(s, { runId, fromId: 'operator', subject: parkNoticeSubject('rejected', 'wave-brief') });
    const ordinary = send(s, { runId, subject: 'wave-done' });
    for (const d of [check, report, notice, rejected, ordinary]) park(s, d);
    expect(s.reviveParkedDeliveries([WORKER]).revived.map((r) => r.from)).toEqual([ordinary]);
    // Every skipped head is one the list names.
    expect(REVIVE_SKIPPED_SUBJECT_HEADS).toEqual(expect.arrayContaining(
      [STALL_CHECK_PREFIX, STALL_REPORT_PREFIX, 'mail parked:', 'mail rejected:']));
  });

  it("the replay-ceiling park, a deliberate cancel, `recipient not in registry` and #853's 24 h reject are never revived", () => {
    const s = store();
    const runId = dispatchedRun(s);
    const errors = [MAIL_REPLAY_CEILING_ERROR, MAIL_RUN_CLOSED_ERROR, 'recipient not in registry',
      parkExpiredError('enter-ignored'), parkExpiredError(ORPHAN), 'dialog-open'];
    for (const e of errors) park(s, send(s, { runId }), e);
    expect(s.reviveParkedDeliveries([WORKER]).revived).toEqual([]);
    for (const e of errors) expect(REVIVABLE_PARK_ERRORS).not.toContain(e);
  });

  it('a park rejected with any other code is never revived', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    s.db.prepare("UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'unknown-recipient', lastError = ? WHERE id = ?")
      .run(ORPHAN, d);
    expect(s.reviveParkedDeliveries([WORKER]).revived).toEqual([]);
  });

  it('two sweeps revive once', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    expect(s.reviveParkedDeliveries([WORKER]).revived).toHaveLength(1);
    expect(s.reviveParkedDeliveries([WORKER]).revived).toEqual([]);
    expect(deliveriesOf(s, row(s, d).mailId)).toHaveLength(2);
  });

  it('a heir that parks again is revived once, not twice', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    const first = s.reviveParkedDeliveries([WORKER]).revived[0]!.heir;
    park(s, first);   // its recipient died again
    const again = s.reviveParkedDeliveries([WORKER]).revived;
    expect(again.map((r) => r.from)).toEqual([first]);
    expect(s.reviveParkedDeliveries([WORKER]).revived).toEqual([]);
    expect(deliveriesOf(s, row(s, d).mailId).map((x) => x.revivedFrom)).toEqual([null, d, first]);
  });

  it('a role-addressed park comes back only to the session that still holds the role (D-7901)', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const toChair = send(s, { runId, toId: 'coordinator', fromId: WORKER }, COORD);
    const toWorker = send(s, { runId, toId: 'worker', fromId: 'coordinator' }, WORKER);
    const toFormerChair = send(s, { runId, toId: 'coordinator', fromId: WORKER }, 'lane-a-former-coordinator');
    const toFormerWorker = send(s, { runId, toId: 'worker', fromId: 'coordinator' }, 'lane-a-former-worker');
    for (const d of [toChair, toWorker, toFormerChair, toFormerWorker]) park(s, d);
    const live = [COORD, WORKER, 'lane-a-former-coordinator', 'lane-a-former-worker'];
    expect(s.reviveParkedDeliveries(live).revived.map((r) => r.from)).toEqual([toChair, toWorker]);
  });
});

describe('reviveParkedDeliveries: the server\'s own notices stay parked (the real writers, the real subjects)', () => {
  const HEAD = 'a'.repeat(40);
  const heirsFrom = (s: CoordStore, live: readonly string[] = [WORKER, COORD]): number[] =>
    s.reviveParkedDeliveries(live).revived.map((r) => r.from);
  const queued = (q: { queued: boolean; deliveryId?: number | undefined }): number => {
    if (!q.queued || q.deliveryId === undefined) throw new Error('fixture: the notice was not queued');
    return q.deliveryId;
  };

  it('nothing the watcher says for the operator comes back; the wave brief, in the coordinator voice, does', () => {
    const s = store();
    const runId = dispatchedRun(s);
    for (const to of ['dispatched', 'working'] as const) expect(s.advance(runId, to, 'test').ok, to).toBe(true);
    const run = { id: runId, program: 'prog-a', wave: 1, waveOf: 3 };
    const operatorMail = (subject: string): number =>
      queued(queueSystemMail(s, run, { fromId: 'operator', toId: COORD, runId, kind: 'status', subject, body: 'b' }));
    const notices = [
      queued(queueStallNotice(s, run, { detail: BRIEF_NOTICE_DETAIL, at: NOW, toId: COORD, kind: 'status',
        subject: briefNotTakenSubject(WORKER, runId, 'held by the draft gate'), body: 'b' })),
      operatorMail(DISPATCH_ABANDON_SUBJECT),
      operatorMail(mergedSubject(42)),
      operatorMail(dequeuedSubject(42, null)),
    ];
    const brief = queued(queueSystemMail(s, run, { fromId: 'coordinator', toId: WORKER, runId, kind: 'status',
      subject: WAVE_BRIEF_SUBJECT, body: 'go' }));
    for (const d of [...notices, brief]) park(s, d);
    expect(heirsFrom(s)).toEqual([brief]);
    expect(REVIVE_SKIPPED_SENDERS).toEqual(['operator']);
  });

  it('a checks notice on a run at merging does not come back as if new', () => {
    const s = store();
    const runId = dispatchedRun(s);
    for (const to of ['dispatched', 'working', 'awaiting-review'] as const) expect(s.advance(runId, to, 'test').ok, to).toBe(true);
    expect(s.advance(runId, 'merging', 'coordinator', mergingAtDetail(HEAD, 42, 'live')).ok).toBe(true);
    const e = s.currentEpisode(runId)!.e;
    const run = { id: runId, program: 'prog-a', wave: 1, waveOf: 3 };
    const d = queued(queueLandingNotice(s, run, { detail: checksRowDetail(e, 0, 'red', 'b'.repeat(12)), at: NOW, episode: e,
      toId: COORD, subject: checksSubject(42, e, 0, 'red', HEAD), body: 'b' }));
    park(s, d);
    expect(heirsFrom(s)).toEqual([]);
  });

  it('a done-claim answer, in the coordinator voice, does not come back: the claim it answered has moved on', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const run = { id: runId, program: 'prog-a', wave: 1, waveOf: 3 };
    const answers = (['work', 'advance', 'review'] as const).flatMap((door) => [
      doneRejectionMail(door, { code: 'stale-tip', detail: 'd' }),
      doneRejectionMail(door, { code: 'lineage-unmeasured', detail: 'd' }),
    ]);
    expect(answers.map((a) => a.subject).sort()).toEqual([...DONE_CLAIM_ANSWER_SUBJECTS].sort());
    for (const a of answers) {
      park(s, queued(queueSystemMail(s, run, { fromId: 'coordinator', toId: WORKER, runId, kind: 'status', ...a })));
    }
    expect(heirsFrom(s)).toEqual([]);
  });

  it('a skipped head holds whoever the sender: a session quoting a stall check gets no revive either', () => {
    const s = store();
    const runId = dispatchedRun(s);
    park(s, send(s, { runId, subject: `${STALL_CHECK_PREFIX} forwarded` }));
    expect(heirsFrom(s)).toEqual([]);
  });

  it('the coordinator voice says the wave brief and the done-claim answers, and nothing else in server/src', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f); else if (e.name.endsWith('.ts')) files.push(f);
      }
    };
    walk(path.join(ccrcRoot, 'server/src'));
    // A new notice in this voice would be revived unless it is named in `REVIVE_SKIPPED_SUBJECT_HEADS`; this reds first.
    const said = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/fromId: 'coordinator',[^;]*?(subject: \w+|\.\.\.doneRejectionMail)/g)]
      .map((m) => m[1]!));
    expect(new Set(said)).toEqual(new Set(['subject: WAVE_BRIEF_SUBJECT', '...doneRejectionMail']));
    expect(said).toHaveLength(4);
  });
});

describe('reviveParkedDeliveries: one mail, one live copy per role (the dedupe beside the heir clause)', () => {
  const queuedRows = (s: CoordStore, mailId: number) => deliveriesOf(s, mailId).filter((x) => x.state === 'queued');
  /** A coordinator report parked at `COORD`, then the chair away to `HEIR_COORD`, whose re-queue is the copy answered. */
  const handedOver = (s: CoordStore): { runId: number; parked: number; mailId: number; copy: number } => {
    const runId = dispatchedRun(s);
    const parked = send(s, { runId, toId: 'coordinator', fromId: WORKER }, COORD);
    park(s, parked);
    expect(s.reclaimProgram(runId, HEIR_COORD, NOW + 1, null)).toMatchObject({ ok: true });
    const mailId = row(s, parked).mailId;
    const live = queuedRows(s, mailId);
    expect(live).toEqual([expect.objectContaining({ toId: HEIR_COORD, revivedFrom: null })]);
    return { runId, parked, mailId, copy: live[0]!.id };
  };

  it('a chair that comes back to a copy repointed to it gets no second one', () => {
    const s = store();
    const { runId, mailId, copy } = handedOver(s);
    expect(s.reclaimProgram(runId, COORD, NOW + 2, null)).toMatchObject({ ok: true });
    expect(queuedRows(s, mailId).map((x) => [x.id, x.toId])).toEqual([[copy, COORD]]);
    expect(s.reviveParkedDeliveries([COORD]).revived).toEqual([]);
    expect(queuedRows(s, mailId).map((x) => x.id), 'one mail, two queued deliveries to one session').toEqual([copy]);
  });

  it('a chair that comes back after the role acked the copy gets nothing: the role has read it', () => {
    const s = store();
    const { runId, mailId, copy } = handedOver(s);
    expect(s.markAcked(copy, NOW + 2)).toEqual({ ok: true, state: 'acked' });
    expect(s.reclaimProgram(runId, COORD, NOW + 3, null)).toMatchObject({ ok: true });
    expect(s.reviveParkedDeliveries([COORD]).revived).toEqual([]);
    expect(queuedRows(s, mailId)).toEqual([]);
  });

  it('a copy that is delivered and not acked is live: it holds the revive too', () => {
    const s = store();
    const { runId, mailId, copy } = handedOver(s);
    s.markDelivered(copy, NOW + 2);
    expect(s.reclaimProgram(runId, COORD, NOW + 3, null)).toMatchObject({ ok: true });
    expect(s.reviveParkedDeliveries([COORD]).revived).toEqual([]);
    expect(deliveriesOf(s, mailId)).toHaveLength(2);
  });

  it('two parks of one mail to one chair revive once, in the one sweep, from the older', () => {
    const s = store();
    const { runId, parked, mailId, copy } = handedOver(s);
    expect(s.reclaimProgram(runId, COORD, NOW + 2, null)).toMatchObject({ ok: true });
    park(s, copy);   // the copy died at the chair too: no live copy now, and two parks of the one mail
    const { revived } = s.reviveParkedDeliveries([COORD]);
    expect(revived.map((r) => r.from)).toEqual([parked]);
    expect(queuedRows(s, mailId).map((x) => x.id)).toEqual([revived[0]!.heir]);
    expect(s.reviveParkedDeliveries([COORD]).revived, 'the second park came back behind the heir').toEqual([]);
  });
});

describe('unreadMail counts a revived park once (the readers of ABANDONED_PARK_SQL)', () => {
  it('`unreadMail`: 1 before, 1 after the revive (the heir), 0 after the heir\'s ack', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    expect(unread(s, runId)).toBe(1);
    const heir = s.reviveParkedDeliveries([WORKER]).revived[0]!.heir;
    expect(unread(s, runId)).toBe(1);
    expect(s.markAcked(heir, NOW + 1)).toEqual({ ok: true, state: 'acked' });
    expect(unread(s, runId)).toBe(0);
  });

  it('outstandingMailFor (the MailStrip) shows the heir in place of its parent', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    expect(s.outstandingMailFor(WORKER).map((m) => m.deliveryId)).toEqual([d]);
    const heir = s.reviveParkedDeliveries([WORKER]).revived[0]!.heir;
    expect(s.outstandingMailFor(WORKER).map((m) => m.deliveryId)).toEqual([heir]);
    // The history read keeps both: the parent is a fact that happened.
    expect(s.mailForRecipient(WORKER).map((m) => m.deliveryId).sort()).toEqual([d, heir].sort());
  });

  it('the inbox reads and the programme read retire the parent the same way', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    expect(s.abandonedCount(WORKER)).toBe(1);
    expect(s.mailForProgram('prog-a', {}).map((m) => m.deliveryId)).toEqual([d]);
    const heir = s.reviveParkedDeliveries([WORKER]).revived[0]!.heir;
    expect(s.abandonedCount(WORKER)).toBe(0);
    expect(s.inboxFor(WORKER).map((r) => r.deliveryId)).toEqual([heir]);
    expect(s.mailForProgram('prog-a', {}).map((m) => m.deliveryId)).toEqual([heir]);
  });

  it('a revived heir to a later-displaced coordinator is requeued to the new coordinator', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId, toId: 'coordinator', fromId: WORKER }, COORD);
    park(s, d);
    const heir = s.reviveParkedDeliveries([COORD]).revived[0]!.heir;
    park(s, heir);   // the chair died again before reading it
    expect(s.reclaimProgram(runId, HEIR_COORD, NOW + 1, null)).toMatchObject({ ok: true });
    const all = deliveriesOf(s, row(s, d).mailId);
    // ONE new delivery to the new chair, from the heir (the parent is retired and is not a source again).
    expect(all.filter((x) => x.toId === HEIR_COORD)).toEqual([expect.objectContaining({ state: 'queued', revivedFrom: null })]);
    expect(s.outstandingMailFor(HEIR_COORD)).toHaveLength(1);
    expect(s.outstandingMailFor(COORD), 'the parent stays retired; the heir park is still the corpse\'s')
      .toEqual([expect.objectContaining({ deliveryId: heir })]);
  });

  it('a revived heir repointed to a new coordinator: the parent stays retired', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId, toId: 'coordinator', fromId: WORKER }, COORD);
    park(s, d);
    const heir = s.reviveParkedDeliveries([COORD]).revived[0]!.heir;
    expect(s.reclaimProgram(runId, HEIR_COORD, NOW + 1, null)).toMatchObject({ ok: true });
    expect(row(s, heir)).toMatchObject({ toId: HEIR_COORD, state: 'queued', revivedFrom: d });
    expect(s.outstandingMailFor(HEIR_COORD).map((m) => m.deliveryId)).toEqual([heir]);
    expect(s.outstandingMailFor(COORD), 'the parent came back as a park beside its repointed heir').toEqual([]);
    expect(s.abandonedCount(COORD)).toBe(0);
  });
});

describe('runHealth.mailParked retires a revived parent (it spells its own count, not ABANDONED_PARK_SQL)', () => {
  const health = (s: CoordStore, runId: number) => {
    const h = s.runHealth([runId], []).get(runId)!;
    return [h.mailParked, h.mailOutstanding];
  };

  it('`[mailParked, mailOutstanding]`: [1,0] parked, [0,1] revived, [0,0] once the heir is acked', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    expect(health(s, runId)).toEqual([1, 0]);
    const heir = s.reviveParkedDeliveries([WORKER]).revived[0]!.heir;
    expect(health(s, runId), 'the run board still said a revived mail was never received').toEqual([0, 1]);
    expect(s.markAcked(heir, NOW + 1)).toEqual({ ok: true, state: 'acked' });
    expect(health(s, runId)).toEqual([0, 0]);
    expect(unread(s, runId)).toBe(0);
  });

  it('a heir that parks twice reads 1 for the one message, and agrees with `unreadMail`', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    const first = s.reviveParkedDeliveries([WORKER]).revived[0]!.heir;
    park(s, first);
    const second = s.reviveParkedDeliveries([WORKER]).revived[0]!.heir;
    park(s, second);
    expect(health(s, runId)).toEqual([1, 0]);
    expect(unread(s, runId)).toBe(1);
  });

  it('a park with no heir is unchanged: it counts while nothing carries it', () => {
    const s = store();
    const runId = dispatchedRun(s);
    const a = send(s, { runId });
    const b = send(s, { runId }, 'lane-a-elsewhere');
    park(s, a);
    park(s, b);
    expect(s.reviveParkedDeliveries([WORKER]).revived.map((r) => r.from)).toEqual([a]);
    expect(health(s, runId)).toEqual([1, 1]);
  });
});

describe('revivable: "reads live" is the park arm\'s own predicate', () => {
  const input = (over: Partial<LifecycleInput> = {}): LifecycleInput => ({
    alive: false, supervisedAt: null, stoppedAt: null, stopSurface: null, started: true, unmeasured: [], nowMs: NOW,
    ...over,
  });
  const LISTED = { listed: true, registryPresent: true };

  it('not while lifecycleIsDead reads it dead, nor while it is unlisted', () => {
    expect(revivable(input(), LISTED), 'orphan').toBe(false);
    expect(revivable(input({ stoppedAt: NOW - 1 }), LISTED), 'stopped').toBe(false);
    expect(revivable(input({ started: false }), LISTED), 'never-started').toBe(false);
    const live = input({ supervisedAt: NOW - 1_000 });
    expect(revivable(live, LISTED), 'restarting').toBe(true);
    expect(revivable(input({ alive: true }), LISTED), 'unsupervised').toBe(true);
    expect(revivable(live, { listed: false, registryPresent: true }), 'unlisted').toBe(false);
    expect(revivable(live, { listed: true, registryPresent: false }), 'no registry row').toBe(false);
    expect(revivable(null, LISTED), 'no row to read').toBe(false);
  });

  it('the revive calls lifecycleIsDead, and server/src defines no other lifecycle-dead predicate', () => {
    const code = (f: string): string => readFileSync(f, 'utf8').split('\n')
      .map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l)).join('\n');
    // The decider's calls, read off the symbol scan: exactly the lifecycle word and the park arm's own predicate. A
    // hand list of the dead words (`.includes`, a comparison chain) would drop `lifecycleIsDead` from this set.
    const calls = callsIn(symbolOf('server/src/coord/mailRevive.ts', 'revivable')).map((c) => c.callee).sort();
    expect(calls).toEqual(['lifecycleIsDead', 'sessionLifecycle']);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f); } else if (/\.(ts|mjs)$/.test(e.name)) files.push(f);
      }
    };
    walk(path.join(ccrcRoot, 'server/src'));
    walk(path.join(ccrcRoot, 'shared'));
    expect(files.length).toBeGreaterThan(20);
    const DECL = /\b(?:function|const|let)\s+(\w*(?:lifecycle\w*dead|dead\w*lifecycle)\w*)/gi;
    const found = files.flatMap((f) => [...code(f).matchAll(DECL)].map((m) => `${path.relative(ccrcRoot, f)}:${m[1]}`));
    expect(found.sort()).toEqual(['shared/api.ts:DEAD_LIFECYCLES', 'shared/api.ts:LIFECYCLE_DEAD', 'shared/api.ts:lifecycleIsDead']);
  });
});

// ── the mail pass ──────────────────────────────────────────────────────────────────────────────────────────────────

const seedRegistry = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'project-a', workdir: '/w/project-a', uuid: 'a'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};
/** A fresh supervisor heartbeat (epoch seconds): with the pane gone it reads `restarting`, which is live. */
const seedSupervised = (home: string, id: string): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.supervised`), String(Math.floor(Date.now() / 1000)));
};

/** tmux proves every pane gone, so a heir is held `tmux-gone` (or counted `session-dead`) and nothing is typed. */
const goneRunner: Runner = async (_cmd, args) => (args[0] === 'has-session'
  ? { ran: true, code: 1, stdout: '', stderr: "can't find session: cc-x\n" }
  : { ran: true, code: 1, stdout: '', stderr: '' });

const watcher = async (): Promise<{ w: FleetWatcher; s: CoordStore; home: string; sent: PushPayload[] }> => {
  const home = mkTmp('ccrc-revive-sweep-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const s = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const sent: PushPayload[] = [];
  const deps: Deps = { ...testDeps(home, goneRunner), coord: s,
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never };
  const w = new FleetWatcher(withFakeClock(deps), new Bus(), 2000);
  await w.tick();
  return { w, s, home, sent };
};

describe('sweepMail: the revive is its first act', () => {
  it('revives a park whose recipient reads live, and the sender is told once', async () => {
    const { w, s, home, sent } = await watcher();
    seedRegistry(home, WORKER);
    seedSupervised(home, WORKER);
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);

    await w.sweepMail();
    vi.setSystemTime(Date.now() + 60_000);
    await w.sweepMail();

    const heirs = deliveriesOf(s, row(s, d).mailId).filter((x) => x.revivedFrom === d);
    expect(heirs).toHaveLength(1);
    const told = sent.filter((p) => p.tag === `mail-revived-${d}`);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ sessionId: SENDER });
    expect(told[0]!.title).toContain('revived');
  });

  it('a recipient the park arm still reads dead (orphan: no heartbeat), or one the registry does not list, gets nothing', async () => {
    const { w, s, home, sent } = await watcher();
    seedRegistry(home, WORKER);   // started, no heartbeat, pane gone: orphan
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    const toAbsent = send(s, { runId }, 'lane-a-absent');
    park(s, d);
    park(s, toAbsent);

    await w.sweepMail();

    expect(deliveriesOf(s, row(s, d).mailId)).toHaveLength(1);
    expect(deliveriesOf(s, row(s, toAbsent).mailId)).toHaveLength(1);
    expect(sent.filter((p) => p.tag?.startsWith('mail-revived-'))).toEqual([]);
  });

  it('the mail kill switch holds the revive too', async () => {
    const { w, s, home } = await watcher();
    seedRegistry(home, WORKER);
    seedSupervised(home, WORKER);
    writeFileSync(path.join(home, '.cc-sessions', MAIL_DISABLED_MARKER), '');
    const runId = dispatchedRun(s);
    const d = send(s, { runId });
    park(s, d);
    await w.sweepMail();
    expect(deliveriesOf(s, row(s, d).mailId)).toHaveLength(1);
  });
});
