// `raiseApproval`, the raise ladder after the kill switch and attribution (D-7029; W3 Task Q3e, ARCH-56 (#791), fourth
// PR; plan 2026-10-26-consolidation-w3-questions.md). `POST /api/approvals` keeps steps 1 to 5 inline (no store, box
// token, body shape, the kill switch, attribution) and hands steps 6 to 15 to the server's `Questions` instance, which
// answers one closed verdict the route maps byte for byte. Here each fixture request maps to its arm, with the deps the
// route builds in `registerCoordRoutes` replaced one at a time by fixtures: a null signer, a `denyEngaged` that answers
// false, a `liveVersionOf` that answers null, a `heldFor` that throws or answers its own verdicts. The route's bytes for
// each arm are `question-doors-pin.test.ts`'s rows.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { heldFor } from '../src/coord/heldFor.js';
import { rulingsAllowedHere } from '../src/coord/approvalsign.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import {
  createQuestions, type ApprovalRaiseDeps, type ApprovalRaiseRequest, type ApprovalRaiseVerdict,
} from '../src/coord/questions.js';
import { CHILD, CHILD2, DUNE, hookInput, PARENT, requestBody, standardFixture, approvalCount, type Approvals } from './approvalsHarness.js';

let f: (Approvals & { runId: number }) | undefined;
afterEach(async () => { vi.restoreAllMocks(); if (f) await f.close(); f = undefined; });

const ORDINARY = hookInput({ command: 'rm -rf build' });

/** The request the route hands in after its own ladder: the parsed body's fields, unchanged. */
const req = (input: Record<string, unknown> = ORDINARY, id = CHILD): ApprovalRaiseRequest => {
  const b = requestBody(input, id);
  return { sessionId: id, digest: b.digest, nonce: b.nonce, canonical: b.canonical };
};

/** The deps as `registerCoordRoutes` builds them, with every closure a fixture that passes; each row overrides one. */
const raiseDeps = (fx: Approvals, over: Partial<ApprovalRaiseDeps> = {}): ApprovalRaiseDeps & { journal: string[] } => {
  const journal: string[] = [];
  return {
    coord: fx.coord, io: fx.deps.io, cfg: fx.deps.cfg, tmux: fx.deps.tmux,
    masker: SHAPE_ONLY_MASKER,
    signerFor: () => ({}) as never,
    rulingsAllowedHere,
    heldFor,
    denyEngaged: async () => true,
    liveVersionOf: async () => '2.1.302',
    journalDigestMismatch: (sessionId, now) => { journal.push(`${now} digest-mismatch ${sessionId}`); },
    ...over,
    journal,
  };
};

/** The rows' clock: today, so the claimant rule reads the fixture's live state files as fresh. */
const NOW = Date.now();
const mailCount = (fx: Approvals): number =>
  (fx.coord.db.prepare("SELECT COUNT(*) AS n FROM mail WHERE subject LIKE 'approval:%'").get() as { n: number }).n;

describe('raiseApproval: each fixture request maps to its verdict arm (W3 Q3e, D-7029)', () => {
  it('step 6: rulings not allowed here is single-box, with its detail', async () => {
    f = await standardFixture();
    const v = await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, { rulingsAllowedHere: () => false }), NOW);
    expect(v).toEqual<ApprovalRaiseVerdict>({ kind: 'single-box', detail: 'this server shares one box with the sessions; place ~/.ccrc/approvals-single-box to opt in' });
    expect(approvalCount(f.coord)).toBe(0);
  });

  it('step 7: a null signer is internal, nothing minted', async () => {
    f = await standardFixture();
    const v = await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, { signerFor: () => null }), NOW);
    expect(v).toEqual<ApprovalRaiseVerdict>({ kind: 'internal', detail: 'the approval signing key is not loaded' });
    expect(approvalCount(f.coord)).toBe(0);
  });

  it('steps 6 and 7 fail together: single-box, the earlier word', async () => {
    f = await standardFixture();
    const v = await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, { rulingsAllowedHere: () => false, signerFor: () => null }), NOW);
    expect(v.kind).toBe('single-box');
  });

  it('step 8: a session with no child mark is not-a-child', async () => {
    f = await standardFixture();
    const v = await createQuestions({ coord: f.coord }).raiseApproval(req(ORDINARY, DUNE), raiseDeps(f), NOW);
    expect(v).toEqual<ApprovalRaiseVerdict>({ kind: 'not-a-child' });
  });

  it('step 9: a denyEngaged that answers false is deny-not-engaged, and is read before the version', async () => {
    f = await standardFixture();
    const v = await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, { denyEngaged: async () => false, liveVersionOf: async () => null }), NOW);
    expect(v).toEqual<ApprovalRaiseVerdict>({ kind: 'deny-not-engaged' });
  });

  it('step 10: a liveVersionOf that answers null is version-unverified, unread; an unlisted one names itself', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    expect(await q.raiseApproval(req(), raiseDeps(f, { liveVersionOf: async () => null }), NOW)).toEqual<ApprovalRaiseVerdict>({
      kind: 'version-unverified', detail: "this child's live Claude Code version (unread) is not one the rig verified",
    });
    expect(await q.raiseApproval(req(), raiseDeps(f, { liveVersionOf: async () => '2.1.299' }), NOW)).toEqual<ApprovalRaiseVerdict>({
      kind: 'version-unverified', detail: "this child's live Claude Code version (2.1.299) is not one the rig verified",
    });
  });

  it('step 11: a digest that does not match is digest-mismatch, journaled once, with the version check first', async () => {
    f = await standardFixture();
    const d = raiseDeps(f);
    const v = await createQuestions({ coord: f.coord }).raiseApproval({ ...req(), digest: 'a'.repeat(64) }, d, NOW);
    expect(v).toEqual<ApprovalRaiseVerdict>({ kind: 'digest-mismatch' });
    expect(d.journal).toEqual([`${NOW} digest-mismatch ${CHILD}`]);
    const e = raiseDeps(f, { liveVersionOf: async () => null });
    expect((await createQuestions({ coord: f.coord }).raiseApproval({ ...req(), digest: 'a'.repeat(64) }, e, NOW)).kind).toBe('version-unverified');
    expect(e.journal).toEqual([]);
  });

  it('step 12: a heldFor that throws is run-unreadable, with its message', async () => {
    f = await standardFixture();
    const v = await createQuestions({ coord: f.coord }).raiseApproval(req(), raiseDeps(f, {
      heldFor: async () => { throw new Error('fixture: the runs table is unreadable'); },
    }), NOW);
    expect(v).toEqual<ApprovalRaiseVerdict>({ kind: 'run-unreadable', detail: 'fixture: the runs table is unreadable' });
    expect(approvalCount(f.coord)).toBe(0);
  });

  it("step 13: heldFor's not-a-child is not-a-child, nothing minted", async () => {
    f = await standardFixture();
    f.child(CHILD2, 999);
    const v = await createQuestions({ coord: f.coord }).raiseApproval(req(ORDINARY, CHILD2), raiseDeps(f), NOW);
    expect(v).toEqual<ApprovalRaiseVerdict>({ kind: 'not-a-child' });
    expect(approvalCount(f.coord)).toBe(0);
  });

  it('step 14: truncated, unparseable, a released claimant and a forbidden class are each minted released, never mailed, no input held', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    const { canonical: _c, ...t } = req();
    const rows: Array<[ApprovalRaiseRequest, ApprovalRaiseDeps, string]> = [
      [{ ...t, truncated: true }, raiseDeps(f), 'truncated'],
      [req(hookInput({ toolInput: ['rm'] as never })), raiseDeps(f), 'unparseable'],
      [req(), raiseDeps(f, { heldFor: async () => ({ kind: 'released', parent: PARENT, runId: f!.runId, reason: 'parent-not-live' }) }), 'parent-not-live'],
      [req(hookInput({ command: 'ccd ws-rm project-a-still-cove' })), raiseDeps(f), 'forbidden'],
    ];
    for (const [r, d, reason] of rows) {
      const v = await q.raiseApproval(r, d, NOW);
      expect(v, reason).toMatchObject({ kind: 'approval-released', releaseReason: reason });
      const id = (v as { id: number }).id;
      expect(q.approvalInput(id, NOW), reason).toBeUndefined();
    }
    expect(approvalCount(f.coord)).toBe(4);
    expect(mailCount(f)).toBe(0);
  });

  it('step 15: a held request is minted {id, waitS}, mailed once, and its input held in THIS instance only, until the window', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    const v = await q.raiseApproval(req(), raiseDeps(f), NOW);
    expect(v).toEqual<ApprovalRaiseVerdict>({ kind: 'minted', id: 1, waitS: 60 });
    expect(mailCount(f)).toBe(1);
    expect(q.approvalInput(1, NOW)).toMatchObject({ tool: 'Bash', input: { command: 'rm -rf build' }, until: NOW + 60_000 });
    expect(createQuestions({ coord: f.coord }).approvalInput(1, NOW), 'another instance holds nothing').toBeUndefined();
    const r = f.coord.approvalById(1);
    expect(r.ok && r.row?.inputRedacted).toBe('rm -rf build');
    q.forgetApprovalInput(1);
    expect(q.approvalInput(1, NOW)).toBeUndefined();
  });

  it('spec §6.7: the row holds the masked text only, and no column of it holds the raw input; the raw input is in memory', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    const raw = 'rm -rf build-0123456789abcdef';
    const masker = { maskText: (t: string) => t.replace('0123456789abcdef', '[MASKED]') };
    const v = await q.raiseApproval(req(hookInput({ command: raw })), raiseDeps(f, { masker }), NOW);
    expect(v.kind).toBe('minted');
    const row = f.coord.db.prepare('SELECT * FROM approvals WHERE id = 1').get() as Record<string, unknown>;
    expect(row['inputRedacted']).toBe('rm -rf build-[MASKED]');
    expect(Object.entries(row).filter(([, c]) => typeof c === 'string' && c.includes('0123456789abcdef')).map(([k]) => k)).toEqual([]);
    expect(q.approvalInput(1, NOW)?.input).toMatchObject({ command: raw });
  });

  it('an input held past its window is forgotten on the next read', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    await q.raiseApproval(req(), raiseDeps(f), NOW);
    expect(q.approvalInput(1, NOW + 59_999)).toBeDefined();
    expect(q.approvalInput(1, NOW + 60_000)).toBeUndefined();
    expect(q.approvalInput(1, NOW)).toBeUndefined();
  });
});
