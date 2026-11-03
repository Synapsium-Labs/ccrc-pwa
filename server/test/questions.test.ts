// `coord/questions.ts`'s read side (D-7026; W3 Task Q3b, ARCH-56 (#791); plan 2026-10-26-consolidation-w3-questions.md):
// every reader of the asks and approvals tables answers the store's measured result UNCHANGED. A refusal
// (`{ok:false, detail}`) stays that refusal, never an empty list or map, and a throw still throws, so each caller keeps
// today's direction on a bad read (the fleet degrades and warns, the digest refuses, the drift lane records nothing).
// The `OperatorQuestion` arms carry their row unchanged, and `createQuestions` makes a new instance per call.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type AskRow, type ApprovalRow } from '../src/coord/store.js';
import {
  approvalFor, approvalQuestion, askQuestion, createQuestions, currentFor, decidedIn, dialogQuestion, forCorrection,
  heldForDrift, openFor,
} from '../src/coord/questions.js';
import { askNotifyAt } from '../src/askwindow.js';
import { mkTmp } from './tmpHelpers.js';

const CHILD = 'project-a-quiet-basin';
const PARENT = 'project-a-calm-mesa';
const REFUSAL = { ok: false as const, detail: 'the fixture store refuses' };
const ASK_REFUSAL = { ok: false as const, kind: 'ask-unreadable' as const, detail: 'the fixture store refuses' };

/** A store whose every method records its arguments and answers `answer` (the same object, so `toBe` proves it was
 *  handed back unchanged). */
function fake(answer: unknown) {
  const calls: [string, unknown[]][] = [];
  const store = new Proxy({}, {
    get: (_t, p) => (...args: unknown[]) => { calls.push([String(p), args]); return answer; },
  }) as unknown as CoordStore;
  return { store, calls };
}
const throwing = new Proxy({}, { get: () => () => { throw new Error('the fixture store throws'); } }) as unknown as CoordStore;

const mkCoord = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-questions-'), '.ccrc', 'coord.db')));
const mintAsk = (coord: CoordStore, at: number): number => coord.insertAsk({ childId: CHILD, parentId: PARENT, runId: null,
  askKey: 'k', askAt: 1000, dialogId: 'd', question: 'Which colour?', options: ['Red', 'Blue'], now: at });
const mintApproval = (coord: CoordStore, askAt: number): number => coord.insertApproval({ childId: CHILD, parentId: PARENT,
  runId: null, digest: 'a'.repeat(64), nonce: '0'.repeat(32), agentId: '', tool: 'Bash', inputRedacted: 'rm -rf build',
  truncated: false, class: 'ordinary', askAt, notifyAt: askAt + 60_000 });

describe('each reader answers the store\'s result unchanged, and passes its arguments through', () => {
  it('currentFor: the newest ask per child, and the held approval per child', () => {
    const ok = { ok: true, asks: new Map() };
    const a = fake(ok);
    expect(currentFor(a.store, [CHILD], 'ask')).toBe(ok);
    expect(a.calls).toEqual([['currentAsksFor', [[CHILD]]]]);
    const rows = { ok: true, rows: new Map() };
    const p = fake(rows);
    expect(currentFor(p.store, [CHILD, PARENT], 'approval')).toBe(rows);
    expect(p.calls).toEqual([['heldApprovalsFor', [[CHILD, PARENT]]]]);
  });

  it('openFor: the parent\'s asks, with and without a state', () => {
    const ok = { ok: true, asks: [] };
    const a = fake(ok);
    expect(openFor(a.store, PARENT, 'held')).toBe(ok);
    expect(openFor(a.store, PARENT)).toBe(ok);
    expect(a.calls).toEqual([['asksForParent', [PARENT, 'held']], ['asksForParent', [PARENT, undefined]]]);
  });

  it('approvalFor: one approval row by id', () => {
    const ok = { ok: true, row: null };
    const a = fake(ok);
    expect(approvalFor(a.store, 7)).toBe(ok);
    expect(a.calls).toEqual([['approvalById', [7]]]);
  });

  it('forCorrection: the ask row with its corrected mark, or the approval row', () => {
    const ok = { ok: true, row: null };
    const a = fake(ok);
    expect(forCorrection(a.store, 'ask', 3)).toBe(ok);
    expect(forCorrection(a.store, 'approval', 4)).toBe(ok);
    expect(a.calls).toEqual([['askForCorrection', [3]], ['approvalById', [4]]]);
  });

  it('heldForDrift: the drift lane\'s held questions', () => {
    const ok = { ok: true, rows: [] };
    const a = fake(ok);
    expect(heldForDrift(a.store)).toBe(ok);
    expect(a.calls).toEqual([['driftHeldQuestions', []]]);
  });

  it('decidedIn: both tables over the window, the asks read first, each answer\'s rows unchanged', () => {
    const coord = mkCoord();
    const ask = mintAsk(coord, 5000);
    coord.declineAsk(ask, 6000);
    mintApproval(coord, 7000);
    const w = { fromMs: 0, toMs: 100_000 };
    const asks = coord.digestAsks(w.fromMs, w.toMs);
    const approvals = coord.digestApprovals(w.fromMs, w.toMs);
    if (!asks.ok || !approvals.ok) throw new Error('fixture: the digest reads must answer');
    expect(decidedIn(coord, w)).toEqual({ ok: true, asks: asks.rows, approvals: approvals.rows });
    const a = fake({ ok: true, rows: [] });
    decidedIn(a.store, { fromMs: 1, toMs: 2 });
    expect(a.calls).toEqual([['digestAsks', [1, 2]], ['digestApprovals', [1, 2]]]);
  });
});

describe('a refusing store stays a refusal; a throwing store still throws', () => {
  it('every single-read reader hands the refusal back as it came', () => {
    const r = fake(REFUSAL);
    expect(currentFor(r.store, [CHILD], 'approval')).toBe(REFUSAL);
    expect(approvalFor(r.store, 1)).toBe(REFUSAL);
    expect(forCorrection(r.store, 'ask', 1)).toBe(REFUSAL);
    expect(forCorrection(r.store, 'approval', 1)).toBe(REFUSAL);
    expect(heldForDrift(r.store)).toBe(REFUSAL);
    const k = fake(ASK_REFUSAL);
    expect(currentFor(k.store, [CHILD], 'ask')).toBe(ASK_REFUSAL);
    expect(openFor(k.store, PARENT)).toBe(ASK_REFUSAL);
  });

  it('decidedIn: a refusing asks read is the refusal and the approvals are not read; a refusing approvals read is the refusal', () => {
    const r = fake(REFUSAL);
    expect(decidedIn(r.store, { fromMs: 1, toMs: 2 })).toBe(REFUSAL);
    expect(r.calls.map(([m]) => m)).toEqual(['digestAsks']);
    const coord = mkCoord();
    const late = Object.assign(Object.create(coord) as CoordStore, { digestApprovals: () => REFUSAL });
    expect(decidedIn(late, { fromMs: 0, toMs: 1 })).toBe(REFUSAL);
  });

  it('every reader lets a throw through to the caller that catches it today', () => {
    expect(() => currentFor(throwing, [CHILD], 'ask')).toThrow('the fixture store throws');
    expect(() => currentFor(throwing, [CHILD], 'approval')).toThrow('the fixture store throws');
    expect(() => openFor(throwing, PARENT)).toThrow('the fixture store throws');
    expect(() => approvalFor(throwing, 1)).toThrow('the fixture store throws');
    expect(() => decidedIn(throwing, { fromMs: 0, toMs: 1 })).toThrow('the fixture store throws');
    expect(() => forCorrection(throwing, 'ask', 1)).toThrow('the fixture store throws');
    expect(() => forCorrection(throwing, 'approval', 1)).toThrow('the fixture store throws');
    expect(() => heldForDrift(throwing)).toThrow('the fixture store throws');
  });
});

describe('OperatorQuestion: one aggregate over the two tables and the pane', () => {
  it('an ask arm carries its row unchanged; its notifyAt is the mint\'s window', () => {
    const coord = mkCoord();
    mintAsk(coord, 5000);
    const read = coord.currentAsksFor([CHILD]);
    if (!read.ok) throw new Error(read.detail);
    const row = read.asks.get(CHILD) as AskRow;
    const q = askQuestion(row);
    expect(q).toEqual({ kind: 'ask', childId: CHILD, parentId: PARENT, runId: null, state: 'held', at: 5000,
      notifyAt: askNotifyAt(5000), row });
    expect(q.row).toBe(row);
  });

  it('an approval arm carries its row unchanged; at is the ask, notifyAt the row\'s own window', () => {
    const coord = mkCoord();
    const id = mintApproval(coord, 7000);
    const read = coord.approvalById(id);
    if (!read.ok || read.row === null) throw new Error('fixture');
    const row: ApprovalRow = read.row;
    const q = approvalQuestion(row);
    expect(q).toEqual({ kind: 'approval', childId: CHILD, parentId: PARENT, runId: null, state: 'held', at: 7000,
      notifyAt: 67_000, row });
    expect(q.row).toBe(row);
  });

  it('a dialog arm is what the pane shows: held for nobody, no window', () => {
    expect(dialogQuestion({ childId: CHILD, dialogId: 'dlg-1', at: 9000 })).toEqual({ kind: 'dialog', childId: CHILD,
      parentId: null, runId: null, state: 'shown', at: 9000, notifyAt: null, dialogId: 'dlg-1' });
  });
});

describe('createQuestions: the owner of question state, one instance per call', () => {
  it('two calls over the same deps are two instances', () => {
    const deps = { coord: mkCoord() };
    const a = createQuestions(deps);
    const b = createQuestions(deps);
    expect(a).not.toBe(b);
  });
});
