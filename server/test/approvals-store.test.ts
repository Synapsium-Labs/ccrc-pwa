// The approvals rows (coordinator-first routing plan Task 16, D-5298): each state change is one CAS'd UPDATE, so the
// row is its own mutex, and the journal survives the retention prune. Neutral ids only.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { APPROVAL_INPUT_RETENTION_DAYS } from '../../shared/api.js';

const mk = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-aprstore-'), '.ccrc', 'coord.db')));
const T0 = 1_784_600_000_000;
const mint = (c: CoordStore, o: Partial<Parameters<CoordStore['insertApproval']>[0]> = {}): number => c.insertApproval({
  childId: 'project-a-quiet-basin', parentId: 'project-a-calm-mesa', runId: null, digest: 'd'.repeat(64), nonce: 'e'.repeat(32),
  agentId: '', tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'ordinary', askAt: T0, notifyAt: T0 + 60_000,
  ...o,
});
const row = (c: CoordStore, id: number) => {
  const r = c.approvalById(id);
  if (!r.ok || r.row === null) throw new Error('fixture: the row must read back');
  return r.row;
};
const rule = { by: 'project-a-calm-mesa', verdict: 'allow' as const, reason: 'inside the worktree', ruling: '{"record":{},"sig":"x"}', now: T0 + 1 };

describe('approvals rows (D-5298)', () => {
  it('a mint is held; with a release reason it is released at once and keeps the reason', () => {
    const c = mk();
    expect(row(c, mint(c)).state).toBe('held');
    const r = row(c, mint(c, { releaseReason: 'forbidden', class: 'forbidden' }));
    expect({ state: r.state, releaseReason: r.releaseReason }).toEqual({ state: 'released', releaseReason: 'forbidden' });
  });

  it('a rule takes a held row once; a second principal finds it already ruled', () => {
    const c = mk();
    const id = mint(c);
    expect(c.takeApprovalForRule(id, rule)).toEqual({ ok: true });
    const r = row(c, id);
    expect({ state: r.state, verdict: r.verdict, answeredBy: r.answeredBy, ruledAt: r.ruledAt, ruling: r.ruling })
      .toEqual({ state: 'allowed', verdict: 'allow', answeredBy: 'project-a-calm-mesa', ruledAt: T0 + 1, ruling: rule.ruling });
    expect(c.takeApprovalForRule(id, { ...rule, verdict: 'deny' })).toEqual({ ok: false, why: 'already-ruled' });
  });

  it('a lapsed row is still taken (the window check is the route\'s); a declined row is not, and says so', () => {
    const c = mk();
    const lapsed = mint(c);
    expect(c.lapseApproval(lapsed)).toBe(true);
    expect(row(c, lapsed).state).toBe('released');
    expect(c.takeApprovalForRule(lapsed, rule)).toEqual({ ok: true });
    const declined = mint(c);
    expect(c.declineApproval(declined, 'project-a-calm-mesa', T0 + 2)).toBe(true);
    expect(c.declineApproval(declined, 'project-a-calm-mesa', T0 + 3)).toBe(false);
    expect(c.takeApprovalForRule(declined, rule)).toEqual({ ok: false, why: 'declined' });
  });

  it('a row minted released is never taken: it was held for nobody', () => {
    const c = mk();
    const id = mint(c, { releaseReason: 'run-unclaimed', parentId: 'operator' });
    expect(c.takeApprovalForRule(id, rule)).toEqual({ ok: false, why: 'not-held' });
  });

  it('the operator marks every open row of the child, and a later rule is already ruled', () => {
    const c = mk();
    const a = mint(c);
    const b = mint(c, { agentId: 'a0000000000000001' });
    c.lapseApproval(b);
    const ruled = mint(c);
    c.takeApprovalForRule(ruled, rule);
    expect(c.markApprovalOperator('project-a-quiet-basin', T0 + 5)).toBe(2);
    expect([row(c, a).state, row(c, b).state, row(c, ruled).state]).toEqual(['operator', 'operator', 'allowed']);
    expect(c.takeApprovalForRule(a, rule)).toEqual({ ok: false, why: 'already-ruled' });
  });

  it('stale moves held and released rows only', () => {
    const c = mk();
    const a = mint(c);
    const b = mint(c);
    c.declineApproval(b, 'project-a-calm-mesa', T0);
    expect(c.staleApproval(a)).toBe(true);
    expect(c.staleApproval(b)).toBe(false);
    expect([row(c, a).state, row(c, b).state]).toEqual(['stale', 'declined']);
  });

  it(`the retention prune clears an input older than ${APPROVAL_INPUT_RETENTION_DAYS} days and keeps the row as the journal`, () => {
    const c = mk();
    const old = mint(c, { askAt: T0, notifyAt: T0 + 60_000 });
    const fresh = mint(c, { askAt: T0 + 2 * 86_400_000, notifyAt: T0 + 2 * 86_400_000 + 60_000 });
    const now = T0 + (APPROVAL_INPUT_RETENTION_DAYS + 1) * 86_400_000;
    expect(c.pruneApprovalInputs(now)).toBe(1);
    expect(row(c, old).inputRedacted).toBeNull();
    expect(row(c, old).digest).toBe('d'.repeat(64));
    expect(row(c, fresh).inputRedacted).toBe('rm -rf build');
  });

  it('a state word a newer build wrote reads unknown, never a cast', () => {
    const c = mk();
    const id = mint(c);
    c.db.prepare("UPDATE approvals SET state = 'pondering', releaseReason = 'later' WHERE id = ?").run(id);
    const r = row(c, id);
    expect({ state: r.state, releaseReason: r.releaseReason }).toEqual({ state: 'unknown', releaseReason: 'unknown' });
  });

  it('heldApprovalsFor names each child\'s newest held row, and none for a row minted released', () => {
    const c = mk();
    mint(c);
    const newer = mint(c, { agentId: 'a0000000000000002' });
    mint(c, { childId: 'project-a-still-cove', releaseReason: 'run-unclaimed' });
    const read = c.heldApprovalsFor(['project-a-quiet-basin', 'project-a-still-cove']);
    if (!read.ok) throw new Error('read');
    expect([...read.rows.keys()]).toEqual(['project-a-quiet-basin']);
    expect(read.rows.get('project-a-quiet-basin')!.id).toBe(newer);
  });

  it('the asks\' question text follows the same retention', () => {
    const c = mk();
    const id = c.insertAsk({ childId: 'project-a-quiet-basin', parentId: 'project-a-calm-mesa', runId: null, askKey: 'k',
      askAt: 1, dialogId: 'dl', question: 'Which colour?', options: ['Red'], now: T0 });
    expect(c.pruneAskQuestions(T0 + (APPROVAL_INPUT_RETENTION_DAYS + 1) * 86_400_000)).toBe(1);
    const a = c.askById(id);
    if (!a.ok || a.ask === null) throw new Error('read');
    expect({ question: a.ask.question, options: a.ask.options, state: a.ask.state }).toEqual({ question: '', options: [], state: 'held' });
  });
});
