// The drift decider (coordinator-durability tail spec §4.1, §4.2, §9; `drift-decider-pure` (D-5921)): one pure L1
// function over plain rows, seven kinds in one L0 map, and the store's four reads that feed it.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { DRIFT_KINDS, isDriftKind } from '../../shared/api.js';
import {
  DRIFT_ASK_MARGIN_MS, MAIL_DRIFT_MS, REVIEW_WAITING_MS, RUN_QUIET_MS, driftFindings,
  type DriftApprovalRow, type DriftAskRow, type DriftDeliveryRow, type DriftInput, type DriftReviewRow,
  type DriftRunRow, type DriftWorkerRow,
} from '../src/coord/drift.js';
import { ASK_ANSWERING_MAX_MS, askNotifyAt } from '../src/askwindow.js';
import { CLAIMANT_DEAD_CAUSES, type ClaimantReading } from '../src/deadCoordinator.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { stallDetail } from '../src/coord/stall.js';
import { mkTmp } from './tmpHelpers.js';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = 1_800_000_000_000;

const run = (o: Partial<DriftRunRow> = {}): DriftRunRow =>
  ({ id: 1, program: 'program-a', state: 'working', claimedBy: 'coord-a', openedAt: NOW - 100 * DAY, lastActAt: NOW - H, ...o });
const delivery = (o: Partial<DriftDeliveryRow> = {}): DriftDeliveryRow =>
  ({ id: 7, toId: 'worker-1', state: 'queued', lastGate: null, gateSince: null, parkedAt: null, parkEscalatedAt: null, ...o });
const review = (o: Partial<DriftReviewRow> = {}): DriftReviewRow =>
  ({ id: 3, program: 'program-a', claimedBy: 'coord-a', enteredAt: NOW - H, lastClaimantMailAt: null, ...o });
const ask = (o: Partial<DriftAskRow> = {}): DriftAskRow => ({ id: 11, at: NOW - 10_000, childId: 'worker-1', state: 'held', ...o });
const worker = (o: Partial<DriftWorkerRow> = {}): DriftWorkerRow =>
  ({ sessionId: 'worker-1', markRunId: 1, parentId: 'coord-a', runClaimedBy: 'coord-a', ...o });
const approval = (o: Partial<DriftApprovalRow> = {}): DriftApprovalRow => ({ id: 21, childId: 'worker-1', notifyAt: NOW - 1_000, ...o });

const input = (o: Partial<DriftInput> = {}): DriftInput => ({
  runs: [], claimants: new Map(), deliveries: [], reviews: [], asks: [], workers: [], approvals: [], ...o,
});
const kinds = (i: DriftInput, now = NOW): string[] => driftFindings(i, now).map((f) => f.kind);
const alive: ClaimantReading = { state: 'alive', why: 'pane live' };

describe('the kind map (L0)', () => {
  it('names the seven kinds once, and isDriftKind narrows only them', () => {
    expect(DRIFT_KINDS).toEqual(['run-quiet', 'claimant-gone', 'mail-parked', 'mail-held', 'parent-mismatch',
      'review-waiting', 'question-orphaned']);
    expect(isDriftKind('run-quiet')).toBe(true);
    expect(isDriftKind('toString')).toBe(false);
    expect(isDriftKind(3)).toBe(false);
  });
});

describe('run-quiet', () => {
  it('fires one past its threshold', () => {
    expect(kinds(input({ runs: [run({ lastActAt: NOW - RUN_QUIET_MS - 1 })] }))).toEqual(['run-quiet']);
  });
  it('does not fire one under it', () => {
    expect(kinds(input({ runs: [run({ lastActAt: NOW - RUN_QUIET_MS + 1 })] }))).toEqual([]);
    expect(kinds(input({ runs: [run({ lastActAt: NOW - 25 * H })] }))).toEqual([]);
  });
  it('a run with no act row ages from its open', () => {
    expect(kinds(input({ runs: [run({ lastActAt: null, openedAt: NOW - RUN_QUIET_MS - 1 })] }))).toEqual(['run-quiet']);
  });
  it('a planned run is no finding', () => {
    expect(kinds(input({ runs: [run({ state: 'planned', lastActAt: NOW - 30 * DAY })] }))).toEqual([]);
  });
  it('an awaiting-review run is review-waiting only', () => {
    const i = input({
      runs: [run({ id: 3, state: 'awaiting-review', lastActAt: NOW - 18 * DAY })],
      reviews: [review({ id: 3, enteredAt: NOW - 18 * DAY })],
    });
    expect(kinds(i)).toEqual(['review-waiting']);
  });
  it('the investigation: a weeks-old open run', () => {
    const [f] = driftFindings(input({ runs: [run({ id: 42, lastActAt: NOW - 21 * DAY })] }), NOW);
    expect(f).toMatchObject({ key: 'run-quiet:42', kind: 'run-quiet', runId: 42, sessionId: null, factAt: NOW - 21 * DAY });
  });
});

describe('claimant-gone', () => {
  it('an unmeasurable verdict is no claimant-gone', () => {
    const i = input({ runs: [run()], claimants: new Map([['coord-a', { state: 'unmeasurable', why: 'no listing' }]]) });
    expect(kinds(i)).toEqual([]);
  });
  it('an alive verdict is no finding', () => {
    expect(kinds(input({ runs: [run()], claimants: new Map([['coord-a', alive]]) }))).toEqual([]);
  });
  it.each(CLAIMANT_DEAD_CAUSES)('each dead cause fires and names itself: %s', (cause) => {
    const fs = driftFindings(input({ runs: [run()], claimants: new Map([['coord-a', { state: 'dead', cause }]]) }), NOW);
    expect(fs.map((f) => f.kind)).toEqual(['claimant-gone']);
    expect(fs[0]!.detail).toContain(`(${cause})`);
    expect(fs[0]!.key).toBe('claimant-gone:program-a:coord-a');
  });
  it('carries the programme\'s newest open run, once per programme and claimant', () => {
    const i = input({
      runs: [run({ id: 4 }), run({ id: 9, state: 'planned' }), run({ id: 6 }), run({ id: 12, program: 'program-b', claimedBy: 'coord-b' })],
      claimants: new Map([['coord-a', { state: 'dead', cause: 'absent' }]]),
    });
    const fs = driftFindings(i, NOW);
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ runId: 9, sessionId: null, factAt: null });
  });
  it('the investigation: an archived claimant (whatever the ladder answers) and an absent one', () => {
    const archived = input({ runs: [run()], claimants: new Map([['coord-a', { state: 'dead', cause: 'stopped' }]]) });
    expect(kinds(archived)).toEqual(['claimant-gone']);
    const absent = input({ runs: [run()], claimants: new Map([['coord-a', { state: 'dead', cause: 'absent' }]]) });
    expect(driftFindings(absent, NOW)[0]!.detail).toContain('absent');
  });
  it('an unmeasured claimant (no verdict) is no finding', () => {
    expect(kinds(input({ runs: [run()] }))).toEqual([]);
  });
});

describe('the mail kinds', () => {
  it('mail-held fires one past its threshold, and not one under it', () => {
    expect(kinds(input({ deliveries: [delivery({ lastGate: 'busy', gateSince: NOW - MAIL_DRIFT_MS - 1 })] }))).toEqual(['mail-held']);
    expect(kinds(input({ deliveries: [delivery({ lastGate: 'busy', gateSince: NOW - MAIL_DRIFT_MS + 1 })] }))).toEqual([]);
  });
  it('mail-parked fires one past its threshold, and not one under it', () => {
    expect(kinds(input({ deliveries: [delivery({ parkedAt: NOW - MAIL_DRIFT_MS - 1 })] }))).toEqual(['mail-parked']);
    expect(kinds(input({ deliveries: [delivery({ parkedAt: NOW - MAIL_DRIFT_MS + 1 })] }))).toEqual([]);
  });
  it('a parked delivery is mail-parked and never also mail-held', () => {
    const d = delivery({ parkedAt: NOW - 2 * H, lastGate: 'parked', gateSince: NOW - 2 * H });
    expect(kinds(input({ deliveries: [d] }))).toEqual(['mail-parked']);
    const young = delivery({ parkedAt: NOW - 60_000, lastGate: 'parked', gateSince: NOW - 2 * H });
    expect(kinds(input({ deliveries: [young] }))).toEqual([]);
  });
  it('a terminal rejected delivery is no finding', () => {
    expect(kinds(input({ deliveries: [delivery({ state: 'rejected', lastGate: 'busy', gateSince: NOW - 3 * DAY })] }))).toEqual([]);
  });
  it('the investigation: a 27 h held delivery, and a parked delivery to a live worker', () => {
    const [held] = driftFindings(input({ deliveries: [delivery({ id: 5, lastGate: 'busy', gateSince: NOW - 27 * H })] }), NOW);
    expect(held).toMatchObject({ key: 'mail-held:5', sessionId: 'worker-1', runId: null, factAt: NOW - 27 * H });
    const [parked] = driftFindings(input({
      deliveries: [delivery({ id: 6, parkedAt: NOW - 3 * H, lastGate: 'parked', gateSince: NOW - 3 * H, parkEscalatedAt: NOW - 3 * H })],
      claimants: new Map([['worker-1', alive]]),
    }), NOW);
    expect(parked).toMatchObject({ key: 'mail-parked:6', kind: 'mail-parked', factAt: NOW - 3 * H });
  });
});

describe('parent-mismatch', () => {
  it('names the worker, not the run (the reused-name mismatch of #746)', () => {
    const fs = driftFindings(input({ workers: [worker({ markRunId: 8, parentId: 'coord-old', runClaimedBy: 'coord-a' })] }), NOW);
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ key: 'parent-mismatch:worker-1', sessionId: 'worker-1', runId: null, factAt: null });
  });
  it('an agreeing parent, or no parent read, is no finding', () => {
    expect(kinds(input({ workers: [worker()] }))).toEqual([]);
    expect(kinds(input({ workers: [worker({ parentId: null })] }))).toEqual([]);
  });
});

describe('review-waiting', () => {
  it('fires one past its threshold, and not one under it', () => {
    expect(kinds(input({ reviews: [review({ enteredAt: NOW - REVIEW_WAITING_MS - 1 })] }))).toEqual(['review-waiting']);
    expect(kinds(input({ reviews: [review({ enteredAt: NOW - REVIEW_WAITING_MS + 1 })] }))).toEqual([]);
  });
  it('measures from the transition, and a claimant mail naming the run after it clears it', () => {
    const entered = NOW - 2 * DAY;
    expect(kinds(input({ reviews: [review({ enteredAt: entered, lastClaimantMailAt: entered - 1 })] }))).toEqual(['review-waiting']);
    expect(kinds(input({ reviews: [review({ enteredAt: entered, lastClaimantMailAt: entered + 1 })] }))).toEqual([]);
    expect(kinds(input({ reviews: [review({ enteredAt: entered, lastClaimantMailAt: entered })] }))).toEqual([]);
  });
  it('the investigation: an 18-day awaiting-review run', () => {
    const [f] = driftFindings(input({ reviews: [review({ id: 30, enteredAt: NOW - 18 * DAY })] }), NOW);
    expect(f).toMatchObject({ key: 'review-waiting:30', runId: 30, sessionId: null, factAt: NOW - 18 * DAY });
  });
});

describe('question-orphaned', () => {
  it('a held ask fires past askNotifyAt(at) + DRIFT_ASK_MARGIN_MS and not before', () => {
    const at = NOW - 1_000_000;
    const due = askNotifyAt(at) + DRIFT_ASK_MARGIN_MS;
    expect(kinds(input({ asks: [ask({ at })] }), due + 1)).toEqual(['question-orphaned']);
    expect(kinds(input({ asks: [ask({ at })] }), due)).toEqual([]);
    expect(kinds(input({ asks: [ask({ at })] }), askNotifyAt(at) + 1)).toEqual([]);
  });
  it('an answering ask inside ASK_ANSWERING_MAX_MS past its margin is no finding', () => {
    const at = NOW - 1_000_000;
    const due = askNotifyAt(at) + DRIFT_ASK_MARGIN_MS;
    expect(kinds(input({ asks: [ask({ at, state: 'answering' })] }), due + ASK_ANSWERING_MAX_MS - 1)).toEqual([]);
    expect(kinds(input({ asks: [ask({ at, state: 'answering' })] }), due + ASK_ANSWERING_MAX_MS + 1)).toEqual(['question-orphaned']);
  });
  it('a settled ask is no finding', () => {
    expect(kinds(input({ asks: [ask({ at: NOW - DAY, state: 'answered' })] }))).toEqual([]);
  });
  it('an approval from the boot snapshot fires past notifyAt + the margin and not before', () => {
    expect(kinds(input({ approvals: [approval({ notifyAt: NOW - DRIFT_ASK_MARGIN_MS - 1 })] }))).toEqual(['question-orphaned']);
    expect(kinds(input({ approvals: [approval({ notifyAt: NOW - DRIFT_ASK_MARGIN_MS })] }))).toEqual([]);
  });
  it('the investigation: a held ask after a restart', () => {
    const [f] = driftFindings(input({ asks: [ask({ id: 99, at: NOW - H })] }), NOW);
    expect(f).toMatchObject({ key: 'question-orphaned:ask:99', sessionId: 'worker-1', runId: null, factAt: NOW - H });
    const [p] = driftFindings(input({ approvals: [approval({ id: 4 })] }), NOW + DAY);
    expect(p!.key).toBe('question-orphaned:approval:4');
  });
});

describe('across the kinds', () => {
  const everything = (): DriftInput => input({
    runs: [run({ id: 1, lastActAt: NOW - 5 * DAY }), run({ id: 2, program: 'program-b', claimedBy: 'coord-b' })],
    claimants: new Map<string, ClaimantReading>([['coord-b', { state: 'dead', cause: 'orphan' }]]),
    deliveries: [delivery({ id: 1, parkedAt: NOW - 2 * H }), delivery({ id: 2, lastGate: 'busy', gateSince: NOW - 2 * H })],
    reviews: [review({ id: 3, enteredAt: NOW - 3 * DAY })],
    asks: [ask({ at: NOW - DAY })],
    workers: [worker({ parentId: 'coord-x' })],
    approvals: [approval({ notifyAt: NOW - H })],
  });
  it('keys are stable across two calls on the same input', () => {
    const a = driftFindings(everything(), NOW).map((f) => f.key);
    const b = driftFindings(everything(), NOW + 60_000).map((f) => f.key);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(a.length).toBe(DRIFT_KINDS.length + 1);
  });
  it('factAt is the fact\'s own time where it has one', () => {
    const at = new Map(driftFindings(everything(), NOW).map((f) => [f.key, f.factAt]));
    expect(at.get('run-quiet:1')).toBe(NOW - 5 * DAY);
    expect(at.get('mail-parked:1')).toBe(NOW - 2 * H);
    expect(at.get('mail-held:2')).toBe(NOW - 2 * H);
    expect(at.get('review-waiting:3')).toBe(NOW - 3 * DAY);
    expect(at.get('question-orphaned:ask:11')).toBe(NOW - DAY);
  });
  it('a run-kind finding carries its runId, and a session kind its sessionId', () => {
    for (const f of driftFindings(everything(), NOW)) {
      if (['run-quiet', 'claimant-gone', 'review-waiting'].includes(f.kind)) {
        expect(f.runId, f.key).not.toBeNull();
        expect(f.sessionId, f.key).toBeNull();
      } else {
        expect(f.sessionId, f.key).not.toBeNull();
        expect(f.runId, f.key).toBeNull();
      }
      expect(() => JSON.parse(f.subject)).not.toThrow();
    }
  });
  it('a swapped session (same id, same uuid, alive) is no finding of any kind', () => {
    const i = input({
      runs: [run({ claimedBy: 'coord-a', lastActAt: NOW - H })],
      claimants: new Map([['coord-a', alive]]),
      workers: [worker()],
      deliveries: [delivery({ state: 'delivered' })],
    });
    expect(driftFindings(i, NOW)).toEqual([]);
  });
});

describe('the ring', () => {
  it('drift.ts imports no IO module', () => {
    const src = readFileSync(new URL('../src/coord/drift.ts', import.meta.url), 'utf8');
    const specs = [...src.matchAll(/^import[^;]*?from '([^']+)';/gms)].map((m) => m[1]);
    expect(specs.sort()).toEqual(['../../../shared/api.js', '../askwindow.js', '../deadCoordinator.js']);
    expect(src).not.toMatch(/\brequire\(|\bimport\(/);
  });
});

// ── the store's reads ────────────────────────────────────────────────────────────────────────────────────────

const fresh = () => {
  const db = openCoordDb(path.join(mkTmp('ccrc-drift-'), '.ccrc', 'coord.db'));
  return { db, coord: new CoordStore(db) };
};
const open = (coord: CoordStore, wave = 1): number => {
  const r = coord.openRun({ program: 'program-a', title: 'T', project: 'project-a', wave, waveOf: 3, claimedBy: 'coord-a' });
  if (!('id' in r)) throw new Error('fixture openRun refused');
  return r.id;
};

describe('the store reads', () => {
  it('stall observation rows and operator rows do not reset run-quiet', () => {
    const { db, coord } = fresh();
    const id = open(coord);
    db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(id);
    const ev = db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)');
    ev.run(id, NOW - 5 * DAY, 'dispatched', 'working', 'coordinator', null);
    ev.run(id, NOW - DAY, 'working', 'working', 'coordinator', stallDetail('live', 'quiet', 1, 1));
    ev.run(id, NOW - H, 'working', 'working', 'operator', `reclaim:coord-a -> coord-b`);
    const read = coord.driftOpenRuns();
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rows.find((r) => r.id === id)?.lastActAt).toBe(NOW - 5 * DAY);
    expect(kinds(input({ runs: read.rows }))).toEqual(['run-quiet']);
  });
  it('driftOpenRuns leaves terminal runs out', () => {
    const { db, coord } = fresh();
    const id = open(coord);
    db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    const read = coord.driftOpenRuns();
    expect(read.ok && read.rows).toEqual([]);
  });
  it('driftAwaitingReview reads the transition into awaiting-review and the claimant\'s mail naming the run', () => {
    const { db, coord } = fresh();
    const id = open(coord);
    db.prepare("UPDATE runs SET state = 'awaiting-review' WHERE id = ?").run(id);
    const ev = db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)');
    ev.run(id, NOW - 18 * DAY, 'working', 'awaiting-review', 'coordinator', null);
    ev.run(id, NOW - DAY, 'awaiting-review', 'awaiting-review', 'coordinator', 'note');
    const mail = db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (?, ?, 'u', 'worker-1', ?, 'status', 's', 'b')");
    mail.run(NOW - 20 * DAY, 'coord-a', id);
    mail.run(NOW - H, 'worker-1', id);
    const read = coord.driftAwaitingReview();
    expect(read.ok && read.rows).toEqual([{ id, program: 'program-a', claimedBy: 'coord-a', enteredAt: NOW - 18 * DAY, lastClaimantMailAt: NOW - 20 * DAY }]);
    if (read.ok) expect(kinds(input({ reviews: read.rows }))).toEqual(['review-waiting']);
  });
  it('driftAwaitingReview times a re-review from its latest entry, not its first', () => {
    const { db, coord } = fresh();
    const id = open(coord);
    db.prepare("UPDATE runs SET state = 'awaiting-review' WHERE id = ?").run(id);
    const ev = db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)');
    ev.run(id, NOW - 18 * DAY, 'working', 'awaiting-review', 'coordinator', null);
    ev.run(id, NOW - 10 * DAY, 'awaiting-review', 'working', 'coordinator', null);
    ev.run(id, NOW - H, 'working', 'awaiting-review', 'coordinator', null);
    const read = coord.driftAwaitingReview();
    expect(read.ok && read.rows.map((r) => r.enteredAt)).toEqual([NOW - H]);
    if (read.ok) expect(kinds(input({ reviews: read.rows }))).toEqual([]);
  });
  it('driftOutstandingDeliveries carries the gate and park columns of outstanding rows only', () => {
    const { db, coord } = fresh();
    const m = coord.insertMail({ fromId: 'coord-a', fromUuid: 'u', toId: 'worker-1', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    const a = coord.queueDelivery(m.id, 'worker-1', 'env').id;
    const b = coord.queueDelivery(m.id, 'worker-1', 'env').id;
    db.prepare("UPDATE mail_deliveries SET lastGate = 'parked', gateSince = ?, parkedAt = ?, parkEscalatedAt = ? WHERE id = ?").run(NOW - 3 * H, NOW - 3 * H, NOW - 2 * H, a);
    db.prepare("UPDATE mail_deliveries SET state = 'rejected' WHERE id = ?").run(b);
    const read = coord.driftOutstandingDeliveries();
    expect(read.ok && read.rows).toEqual([{ id: a, toId: 'worker-1', state: 'queued', lastGate: 'parked', gateSince: NOW - 3 * H, parkedAt: NOW - 3 * H, parkEscalatedAt: NOW - 2 * H }]);
  });
  it('driftHeldQuestions reads held and answering rows only', () => {
    const { db, coord } = fresh();
    const ins = db.prepare("INSERT INTO asks (at, childId, parentId, askKey, askAt, dialogId, question, options, state) VALUES (?, 'worker-1', 'coord-a', 'k', 1, 'd', 'q', '[]', ?)");
    ins.run(NOW - H, 'held');
    ins.run(NOW - H, 'answering');
    ins.run(NOW - H, 'answered');
    const read = coord.driftHeldQuestions();
    expect(read.ok && read.rows.map((r) => r.state)).toEqual(['held', 'answering']);
  });
  it('a read that fails answers ok:false with its detail, never a throw', () => {
    const { db, coord } = fresh();
    db.close();
    for (const r of [coord.driftOpenRuns(), coord.driftOutstandingDeliveries(), coord.driftAwaitingReview(), coord.driftHeldQuestions()]) {
      expect(r.ok).toBe(false);
    }
  });
});
