// The park over a real coordination store (approvals plan 2026-11-18, §3.3, Tasks 3.1 and 3.3; approvals PR 3): the mint's
// word and its slot, the one write site of `parked`, the park record, the parked-aware rule door, the last-poll move, the one
// signing site, the operator's core, the nudge, the void and the prune. The questions owner is driven directly
// (`createQuestions`); the route hunks that wire it are pinned through the server in `approval-park-routes.test.ts`. The lane
// is driven live past its gate (`parkGate`), because this build holds it inert. A case named
// "inert" pins that hold. Neutral fixtures only; never the live HOME.
import { describe, it, expect, afterEach } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { heldFor } from '../src/coord/heldFor.js';
import { loadOrCreateApprovalSigner, rulingsAllowedHere, type ApprovalSigner } from '../src/coord/approvalsign.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import {
  createQuestions, parkedApprovalsFor, type ApprovalRaiseDeps, type ApprovalRaiseRequest, type ClaimantDoorDeps, type QuestionPush,
  type Questions,
} from '../src/coord/questions.js';
import { approvalOperatorArm } from '../src/coord/approvalParkDoor.js';
import { approvalDecision } from '../src/coord/digest.js';
import { APPROVAL_INPUT_RETENTION_DAYS, approvalRulingBytes, isApprovalState, type ApprovalRulingRecord } from '../../shared/api.js';
import { APPROVAL_PARK_HORIZON_MS } from '../../shared/approval-park.js';
import { APPROVAL_PARK_LANE } from '../../shared/lane-arm.js';
import { CHILD, CHILD2, DUNE, hookInput, PARENT, requestBody, standardFixture, type Approvals } from './approvalsHarness.js';

let f: (Approvals & { runId: number }) | undefined;
afterEach(async () => { if (f) await f.close(); f = undefined; });

const GRACE = 10_000;
const ORDINARY = hookInput({ command: 'rm -rf build' });
const ESCALATE = hookInput({ command: 'cat /etc/hostname' });

const req = (input: Record<string, unknown> = ORDINARY, id = CHILD): ApprovalRaiseRequest => {
  const b = requestBody(input, id);
  return { sessionId: id, digest: b.digest, nonce: b.nonce, canonical: b.canonical };
};

interface Rig {
  f: Approvals & { runId: number };
  q: Questions & Record<string, unknown>;
  signer: ApprovalSigner;
  pushes: QuestionPush[];
  raise(input?: Record<string, unknown>, over?: Partial<ApprovalRaiseDeps>, now?: number): ReturnType<Questions['raiseApproval']>;
  rule(id: number, verdict: 'allow' | 'deny', over?: Partial<ClaimantDoorDeps> & { from?: string }): ReturnType<Questions['rule']>;
  lapse(now: number): void;
  row(id: number): NonNullable<Extract<ReturnType<Approvals['coord']['approvalById']>, { ok: true }>['row']>;
  mail(to: string, like?: string): number;
}

/** The rig: a standard fixture, the lane row stored `live`, sign-in armed, the gate opened for the test (`parkGate`), one
 *  `Questions` instance (its in-memory inputs shared by the raise and the rule door), and a real signer in the fixture. */
async function rig(o: { live?: boolean; gateOpen?: boolean; signedIn?: boolean } = {}): Promise<Rig> {
  const fx = await standardFixture();
  f = fx;
  if (o.live !== false) fx.coord.db.prepare("UPDATE lane_arm_settings SET choice = 'live' WHERE lane = ?").run(APPROVAL_PARK_LANE);
  const signer = loadOrCreateApprovalSigner(path.join(fx.home, '.ccrc'));
  const q = createQuestions({ coord: fx.coord, io: fx.deps.io, cfg: fx.deps.cfg, tmux: fx.deps.tmux }, { heldFor }) as Questions & Record<string, unknown>;
  const cfg = { ...fx.deps.cfg, authEnabled: o.signedIn !== false };
  const pushes: QuestionPush[] = [];
  const raiseDeps = (over: Partial<ApprovalRaiseDeps> = {}): ApprovalRaiseDeps => ({
    coord: fx.coord, io: fx.deps.io, cfg, tmux: fx.deps.tmux, masker: SHAPE_ONLY_MASKER,
    signerFor: () => signer, rulingsAllowedHere, heldFor,
    denyStanding: async () => 'current', liveVersionOf: async () => '2.1.302', journalDigestMismatch: () => {},
    ...(o.gateOpen === false ? {} : { parkGate: () => null }),
    ...over,
  });
  const claimant = (over: Partial<ClaimantDoorDeps> = {}): ClaimantDoorDeps => ({
    coord: fx.coord, io: fx.deps.io, cfg, tmux: fx.deps.tmux, signerFor: () => signer, rulingsAllowedHere, heldFor,
    notice: (() => undefined) as unknown as ClaimantDoorDeps['notice'], approvalsKilled: async () => false, pressAsk: async () => { throw new Error('no press here'); }, ...over,
  });
  return {
    f: fx, q, signer, pushes,
    raise: (input = ORDINARY, over = {}, now = Date.now()) => q.raiseApproval(req(input), raiseDeps(over), now),
    rule: (id, verdict, over = {}) => q.rule({ kind: 'approval', id, fromId: over.from ?? PARENT, verdict, reason: `${verdict} it` }, claimant(over)),
    lapse: (now) => q.lapseApprovals({ now, graceMs: GRACE, paintedDialogOf: () => undefined, push: (ev) => pushes.push(ev) }),
    row: (id) => { const r = fx.coord.approvalById(id); if (!r.ok || r.row === null) throw new Error(`row ${id}`); return r.row; },
    mail: (to, like = '%') => (fx.coord.db.prepare('SELECT COUNT(*) AS n FROM mail WHERE toId = ? AND subject LIKE ?').get(to, like) as { n: number }).n,
  };
}

const minted = async (p: ReturnType<Rig['raise']>): Promise<{ id: number; park: string | null }> => {
  const v = await p;
  if (v.kind !== 'minted') throw new Error(`not minted: ${JSON.stringify(v)}`);
  return { id: v.id, park: v.park };
};
const parkOf = (r: Rig, id: number) => { const k = r.row(id).parkKey; return k === null ? null : r.f.coord.approvalPark(k); };
/** Past a row's window, inside the hook's ceiling. */
const pastWindow = (r: Rig, id: number): number => r.row(id).notifyAt + 1;
/** The signed record a row carries, checked against the fixture's own public key. */
const signedRecord = (r: Rig, id: number): ApprovalRulingRecord => {
  const ruling = JSON.parse(r.row(id).ruling ?? 'null') as { record: ApprovalRulingRecord; sig: string };
  const ok = verify(null, Buffer.from(approvalRulingBytes(ruling.record) ?? '', 'utf8'), createPublicKey(r.signer.publicKeyPem()), Buffer.from(ruling.sig, 'base64'));
  expect(ok, 'the signature verifies over the record').toBe(true);
  return ruling.record;
};

describe('inert until PR 3v: the lane\'s gate holds it in shadow', () => {
  it('inert: with the lane stored live but its real gate standing, the mint stores shadow and the lapse never parks', async () => {
    const r = await rig({ gateOpen: false });
    const a = await minted(r.raise());
    expect(a.park).toBe('shadow');
    r.lapse(pastWindow(r, a.id));
    expect(r.row(a.id)).toMatchObject({ state: 'released', parkWord: 'shadow', wouldPark: true });
    expect(parkOf(r, a.id)).toBeNull();
  });
  it('inert: a shadow row\'s ruling with no fetchedAt is never moved onto a park', async () => {
    const r = await rig({ gateOpen: false });
    const a = await minted(r.raise());
    expect((await r.rule(a.id, 'allow')).status).toBe(200);
    r.lapse(r.row(a.id).notifyAt + GRACE + 1);
    expect(r.row(a.id)).toMatchObject({ state: 'allowed', fetchedAt: null });
  });
});

describe('the mint decision (F1)', () => {
  it('a live lane with sign-in armed stores live, reserves a slot and answers the same word', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    expect(a.park).toBe('live');
    expect(r.row(a.id).parkWord).toBe('live');
    expect(parkOf(r, a.id)).toMatchObject({ slots: 1, retries: 0, horizon: null });
  });
  it('sign-in dark: shadow, and nothing reserved (F12)', async () => {
    const r = await rig({ signedIn: false });
    const a = await minted(r.raise());
    expect(a.park).toBe('shadow');
    expect(parkOf(r, a.id)).toBeNull();
  });
  it('the cap race: three live mints take the slots, the fourth of the key is capped at mint and never parks', async () => {
    const r = await rig();
    const words: (string | null)[] = [];
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) { const m = await minted(r.raise()); words.push(m.park); ids.push(m.id); }
    expect(words).toEqual(['live', 'live', 'live', 'capped']);
    expect(parkOf(r, ids[0]!)).toMatchObject({ slots: 3, retries: 3 });
    r.lapse(pastWindow(r, ids[3]!));
    expect(ids.map((id) => r.row(id).state)).toEqual(['parked', 'parked', 'parked', 'released']);
  });
  it('a mint after a pane answer voided the key\'s park is capped, and never parks (review 2889 F4)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    expect(r.f.coord.markApprovalOperatorRows([a.id], Date.now())).toBe(1);
    const b = await minted(r.raise());
    expect(b.park).toBe('capped');
    r.lapse(pastWindow(r, b.id));
    expect(r.row(b.id).state).not.toBe('parked');
  });
  it('a mint after the key\'s park passed its horizon is capped, and never parks (review 2889 F4)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    // The park's two hours have passed (its horizon moved into the past, so the claimant is measured at the real clock).
    r.f.coord.db.prepare('UPDATE approval_parks SET horizon = ? WHERE parkKey = ?').run(Date.now() - 1, r.row(a.id).parkKey);
    const b = await minted(r.raise());
    expect(b.park).toBe('capped');
    r.lapse(pastWindow(r, b.id));
    expect(r.row(b.id).state).not.toBe('parked');
  });
  it('a row ruled inside its window releases its slot', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    expect((await r.rule(a.id, 'allow')).status).toBe(200);
    expect(parkOf(r, a.id)).toMatchObject({ slots: 0 });
  });
});

describe('the state: one write site, the vocabularies, the readers (F8-a, F4, F9)', () => {
  it('parked is in the state map, and a token this build does not know reads unknown', () => {
    expect(isApprovalState('parked')).toBe(true);
    expect(isApprovalState('from-the-future')).toBe(false);
  });
  it('one writer: `parked` is written by exactly one statement in server/src', () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          const n = fs.readFileSync(p, 'utf8').match(/SET state = 'parked'/g)?.length ?? 0;
          for (let i = 0; i < n; i++) hits.push(path.relative(path.resolve(__dirname, '..'), p));
        }
      }
    };
    walk(path.resolve(__dirname, '../src'));
    expect(hits).toEqual(['src/coord/approvalParkStore.ts']);
  });
  it('a held row past its window, stored live, parks: its horizon is two hours, and its push is sent at park time', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const at = pastWindow(r, a.id);
    r.lapse(at);
    expect(r.row(a.id).state).toBe('parked');
    expect(parkOf(r, a.id)).toMatchObject({ firstRowId: a.id, parkedAt: at, horizon: at + APPROVAL_PARK_HORIZON_MS });
    expect(r.pushes.map((p) => p.source)).toEqual([`approval:${a.id}`]);
  });
  it('the lapse sweep never lapses a parked row; the stale sweep stales it at its horizon only', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const at = pastWindow(r, a.id);
    r.lapse(at);
    r.lapse(r.row(a.id).askAt + 600_000);
    expect(r.row(a.id).state).toBe('parked');
    r.lapse(at + APPROVAL_PARK_HORIZON_MS);
    expect(r.row(a.id).state).toBe('stale');
  });
  it('a parked row has no ruling to serve: noting it served records nothing', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    r.q.noteRulingServed(r.row(a.id), Date.now(), GRACE);
    expect(r.row(a.id)).toMatchObject({ state: 'parked', ruling: null, fetchedAt: null });
  });
  it('a pane press on another prompt of the child voids no parked prompt: two parked rows keep their parks (review 2889 F3)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const b = await minted(r.raise(hookInput({ command: 'rm -rf dist' })));
    r.lapse(Math.max(pastWindow(r, a.id), pastWindow(r, b.id)));
    expect([r.row(a.id).state, r.row(b.id).state]).toEqual(['parked', 'parked']);
    const c = await minted(r.raise(hookInput({ command: 'rm -rf out' })));
    expect(r.f.coord.markApprovalOperator(CHILD, Date.now())).toBe(1);
    expect(r.row(c.id).state).toBe('operator');
    expect([r.row(a.id).state, r.row(b.id).state]).toEqual(['parked', 'parked']);
    expect([parkOf(r, a.id)?.voided, parkOf(r, b.id)?.voided]).toEqual([false, false]);
    expect(r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'ok', by: 'operator' }).status).toBe(200);
  });
  it('a press on the cleared dialog\'s own rows (markApprovalOperatorRows) marks a parked row operator and voids its park (F4)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    expect(r.f.coord.markApprovalOperatorRows([a.id], Date.now())).toBe(1);
    expect(r.row(a.id).state).toBe('operator');
    expect(parkOf(r, a.id)?.voided).toBe(true);
    expect(r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'ok', by: 'operator' }).status).toBe(409);
  });
  it('the coordinator\'s card does not list a parked row (heldApprovalsFor)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    const read = r.f.coord.heldApprovalsFor([CHILD]);
    expect(read.ok && read.rows.has(CHILD)).toBe(false);
  });
  it('the digest prints a parked line, and a moved ruling keeps its allow line', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    expect(approvalDecision(r.row(a.id))?.kind).toBe('parked');
    const b = await minted(r.raise());
    await r.rule(b.id, 'allow');
    r.lapse(r.row(b.id).notifyAt + GRACE + 1);
    expect(r.row(b.id).state).toBe('parked');
    expect(approvalDecision(r.row(b.id))?.kind).toBe('allow');
  });
  it('Waiting on you lists the parked row at park time, with its coordinator, and not a void one', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    expect(parkedApprovalsFor(r.f.coord, Date.now())).toEqual([]);
    r.lapse(pastWindow(r, a.id));
    expect(parkedApprovalsFor(r.f.coord, Date.now())?.map((x) => [x.id, x.holder, x.parentId])).toEqual([[a.id, 'coordinator', PARENT]]);
  });
});

describe('the key (F8-d)', () => {
  it('leaves out the agent: a subagent\'s retry of the same command in the same cwd meets the main thread\'s park', async () => {
    const r = await rig();
    const a = await minted(r.raise(ORDINARY));
    const b = await minted(r.raise(hookInput({ command: 'rm -rf build', agentId: 'a0123456789abcdef' })));
    expect(r.row(b.id).parkKey).toBe(r.row(a.id).parkKey);
    expect(r.row(a.id).parkKey).toContain(`${CHILD}:${r.f.runId}:`);
  });
  it('a new child at a recycled registry id, in a new run, does not meet the old run\'s ruling', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    expect(r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'ok', by: 'operator' }).status).toBe(200);
    r.f.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(r.f.runId);
    const run2 = r.f.run(PARENT, CHILD);
    r.f.child(CHILD, run2);
    const b = await minted(r.raise());
    expect(r.row(b.id).parkKey).not.toBe(r.row(a.id).parkKey);
    expect(r.row(b.id).state).toBe('held');
  });
});

/** A resumed child (D-5362): wave 1's run (the one its mark names) closes and the next wave's run binds it. The child's mark
 *  is NEVER rewritten here, because production never rewrites it on a resume. Answers the new run's id. */
const resume = (r: Rig, from: number): number => {
  r.f.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(from);
  return r.f.run(PARENT, CHILD);
};

describe('the park follows the child\'s live binding run, not its mark (review 2889 F2)', () => {
  it('a resumed child whose mark names closed wave 1 parks on wave 2\'s run, and the park stays live', async () => {
    const r = await rig();
    const run2 = resume(r, r.f.runId);
    const a = await minted(r.raise());
    expect(r.row(a.id).parkKey).toContain(`${CHILD}:${run2}:`);
    r.lapse(pastWindow(r, a.id));
    r.lapse(pastWindow(r, a.id) + 1);
    expect(r.row(a.id).state).toBe('parked');
    expect((parkedApprovalsFor(r.f.coord, Date.now()) ?? []).map((p) => p.id)).toEqual([a.id]);
    expect(r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'ok', by: 'operator' }).status).toBe(200);
  });
  it('a resumed child\'s parked view names the park\'s run (wave 2), not the run its mark names (approvals PR 3c F-D)', async () => {
    const r = await rig();
    const run1 = r.f.runId;
    const run2 = resume(r, run1);
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    expect(r.row(a.id).runId, 'the row keeps the mark\'s run').toBe(run1);
    expect((parkedApprovalsFor(r.f.coord, Date.now()) ?? []).map((p) => [p.id, p.runId])).toEqual([[a.id, run2]]);
  });
  it('a wave 3 retry does not meet a wave 2 ruling of the same command', async () => {
    const r = await rig();
    const run2 = resume(r, r.f.runId);
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    expect(r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'ok', by: 'operator' }).status).toBe(200);
    const run3 = resume(r, run2);
    const b = await minted(r.raise());
    expect(r.row(b.id).parkKey).toContain(`${CHILD}:${run3}:`);
    expect(r.row(b.id).state).toBe('held');
    expect(parkOf(r, a.id)?.ruling?.spent).toBe(false);
  });
  it('the retry treats a closed run\'s park as void: its ruling is not met, and the row is held fresh', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    expect(r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'ok', by: 'operator' }).status).toBe(200);
    r.f.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(r.f.runId);
    // A binding read that still answers the run (it closed between that read and the meet): the void rule decides.
    const stale = async () => ({ kind: 'held', parent: PARENT, runId: r.f.runId, bindingRunId: r.f.runId }) as const;
    const b = await minted(r.raise(ORDINARY, { heldFor: stale as never }));
    expect(r.row(b.id).parkKey).toBe(r.row(a.id).parkKey);
    expect(r.row(b.id).state).toBe('held');
    expect(parkOf(r, a.id)?.ruling?.spent).toBe(false);
  });
});

describe('the rule door on a parked row, and the operator\'s core', () => {
  it('the coordinator\'s ruling is recorded on the park, nothing is signed, and the child is nudged', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    const res = await r.rule(a.id, 'allow');
    expect(res).toMatchObject({ status: 200, body: { ok: true, state: 'parked', recorded: 'allow' } });
    expect(r.row(a.id)).toMatchObject({ state: 'parked', ruling: null });
    expect(parkOf(r, a.id)?.ruling).toMatchObject({ verdict: 'allow', authority: 'coordinator', by: PARENT, spent: false });
    expect(r.mail(CHILD, `approval ${a.id} ruled`)).toBe(1);
  });
  it('a second principal is refused park-ruled while the ruling is unspent; after a spend a new ruling is taken (F5)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    await r.rule(a.id, 'allow');
    expect(r.q.operatorRuleApproval({ id: a.id, verdict: 'deny', reason: 'no', by: 'operator' })).toMatchObject({ status: 409, body: { error: 'park-ruled' } });
    const retry = await minted(r.raise());
    expect(r.row(retry.id).state).toBe('allowed');
    const c = await minted(r.raise());
    r.lapse(pastWindow(r, c.id));
    expect(r.q.operatorRuleApproval({ id: c.id, verdict: 'deny', reason: 'no', by: 'operator' }).status).toBe(200);
  });
  it('the operator\'s ruling reaches no press function and is recorded as authority operator', async () => {
    const r = await rig();
    const a = await minted(r.raise(ESCALATE));
    r.lapse(pastWindow(r, a.id));
    const res = r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'fine', by: 'operator' });
    expect(res.status).toBe(200);
    expect(parkOf(r, a.id)?.ruling).toMatchObject({ authority: 'operator', class: 'escalate' });
  });
  it('the operator\'s arm: the gate first (auth-off dark), then the body, then the core; it presses nothing', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    const sent: { code: number; body: unknown }[] = [];
    const reply = () => { const x = { c: 0, code(n: number) { x.c = n; return x; }, send(b: unknown) { sent.push({ code: x.c, body: b }); return x; }, header() { return x; } }; return x; };
    const dark = (_q: unknown, rp: ReturnType<typeof reply>) => { rp.code(501).send({ ok: false, error: 'auth-off' }); return { pass: false } as const; };
    await approvalOperatorArm({ body: { kind: 'approval', verdict: 'allow' } } as never, reply() as never, a.id, { gate: dark as never, questions: r.q });
    expect(sent.pop()).toMatchObject({ code: 501, body: { error: 'auth-off' } });
    const pass = () => ({ pass: true, actor: { label: 'device', idHash8: '00000000' }, sessionIdHash: 'x' }) as never;
    await approvalOperatorArm({ body: { kind: 'ask', verdict: 'allow' } } as never, reply() as never, a.id, { gate: pass, questions: r.q });
    expect(sent.pop()).toMatchObject({ code: 400 });
    await approvalOperatorArm({ body: { kind: 'approval', verdict: 'allow' } } as never, reply() as never, a.id, { gate: pass, questions: r.q });
    expect(sent.pop()).toMatchObject({ code: 200, body: { ok: true, state: 'parked', recorded: 'allow' } });
  });
  it('the operator\'s arm asks the gate for a step-up, and a session with none rules nothing (review 2889 F5)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    const sent: { code: number; body: unknown }[] = [];
    const reply = { c: 0, code(n: number) { reply.c = n; return reply; }, send(b: unknown) { sent.push({ code: reply.c, body: b }); return reply; }, header() { return reply; } };
    // The gate as `accounts/gate.ts` behaves for a signed-in session with no recent step-up: it passes a route that asks
    // none, and refuses `step-up-required` when the route asks for one.
    const asked: unknown[] = [];
    const unfresh = (_q: unknown, rp: typeof reply, opts: { cap: unknown; stepUp?: boolean }) => {
      asked.push(opts);
      if (opts.stepUp === true) { rp.code(403).send({ ok: false, error: 'step-up-required' }); return { pass: false } as const; }
      return { pass: true, actor: { label: 'device', idHash8: '00000000' }, sessionIdHash: 'x' } as const;
    };
    await approvalOperatorArm({ body: { kind: 'approval', verdict: 'allow' } } as never, reply as never, a.id, { gate: unfresh as never, questions: r.q });
    expect(asked).toEqual([{ cap: null, stepUp: true }]);
    expect(sent.pop()).toMatchObject({ code: 403, body: { error: 'step-up-required' } });
    expect(parkOf(r, a.id)?.ruling ?? null).toBeNull();
  });
});

describe('the retry (F6, F8-b, the one signing site)', () => {
  it('meets the coordinator\'s ruling: signed v1 for the retry\'s own row and nonce, the ruling spent, no brief mailed', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    await r.rule(a.id, 'allow');
    const briefs = r.mail(PARENT, 'approval:%');
    const b = await minted(r.raise());
    const rec = signedRecord(r, b.id);
    expect(rec).toMatchObject({ v: 1, rowId: b.id, sessionId: CHILD, nonce: r.row(b.id).nonce, verdict: 'allow', class: 'ordinary' });
    expect(parkOf(r, a.id)?.ruling?.spent).toBe(true);
    expect(r.mail(PARENT, 'approval:%')).toBe(briefs);
    expect(r.row(a.id).state).toBe('stale');
    expect(r.row(a.id).nonce).not.toBe(r.row(b.id).nonce);
  });
  it('meets the operator\'s ruling on an escalate row: a v2 record, authority operator', async () => {
    const r = await rig();
    const a = await minted(r.raise(ESCALATE));
    r.lapse(pastWindow(r, a.id));
    r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'fine', by: 'operator' });
    const b = await minted(r.raise(ESCALATE));
    expect(signedRecord(r, b.id)).toMatchObject({ v: 2, authority: 'operator', class: 'escalate', denyCurrent: true, family: 'none', rowId: b.id });
  });
  it('a retry of a higher class than the ruling is held fresh and the ruling stays unspent', async () => {
    const r = await rig();
    const a = await minted(r.raise(ESCALATE));
    r.lapse(pastWindow(r, a.id));
    const key = r.row(a.id).parkKey!;
    expect(r.f.coord.recordApprovalParkRuling(key, { verdict: 'allow', authority: 'operator', by: 'operator', reason: 'x', class: 'ordinary', rowId: a.id, now: Date.now() })).toBe(true);
    const b = await minted(r.raise(ESCALATE));
    expect(r.row(b.id).state).toBe('held');
    expect(r.f.coord.approvalPark(key)?.ruling?.spent).toBe(false);
  });
  it('the heir: a coordinator\'s ruling, then a reclaim, is not signed for the heir\'s child; the ruling is spent (F8-b, F5)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    await r.rule(a.id, 'allow');
    r.f.coord.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run(CHILD2, r.f.runId);
    const b = await minted(r.raise());
    expect(r.row(b.id)).toMatchObject({ state: 'held', parentId: CHILD2, ruling: null });
    expect(parkOf(r, a.id)?.ruling?.spent).toBe(true);
  });
  it('two identical prompts meet one ruling once: the first retry is allowed, the second is held fresh', async () => {
    const r = await rig();
    const a = await minted(r.raise(ORDINARY));
    const a2 = await minted(r.raise(hookInput({ command: 'rm -rf build', agentId: 'a0123456789abcdef' })));
    r.lapse(Math.max(pastWindow(r, a.id), pastWindow(r, a2.id)));
    expect([r.row(a.id).state, r.row(a2.id).state]).toEqual(['parked', 'parked']);
    r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'once', by: 'operator' });
    const b1 = await minted(r.raise());
    const b2 = await minted(r.raise());
    expect([r.row(b1.id).state, r.row(b2.id).state]).toEqual(['allowed', 'held']);
  });
  it('concurrent retries interleaved across the claimant read: exactly one is signed', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    await r.rule(a.id, 'allow');
    const [x, y] = await Promise.all([minted(r.raise()), minted(r.raise())]);
    expect([r.row(x.id).state, r.row(y.id).state].sort()).toEqual(['allowed', 'held']);
  });
  it('a closed run voids its park: the parked row is staled and leaves Waiting on you', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    r.f.coord.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(r.f.runId);
    r.lapse(pastWindow(r, a.id) + 1);
    expect(r.row(a.id).state).toBe('stale');
    expect(parkedApprovalsFor(r.f.coord, Date.now())).toEqual([]);
  });
});

describe('the coordinator\'s verdicts on the key (F3)', () => {
  it('a deny at the rule door is recorded on the park; no later allow of the key is recorded for anyone', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    expect((await r.rule(a.id, 'deny')).status).toBe(200);
    expect(parkOf(r, a.id)?.coordDenied).toBe(true);
    const b = await minted(r.raise());
    r.lapse(pastWindow(r, b.id));
    expect(r.q.operatorRuleApproval({ id: b.id, verdict: 'allow', reason: 'ok', by: 'operator' })).toMatchObject({ status: 409, body: { error: 'coordinator-denied' } });
  });
  it('a decline is recorded on the park in the row\'s own transaction', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const d = await r.q.release({ kind: 'approval', id: a.id, fromId: PARENT }, { coord: r.f.coord } as never);
    expect(d.status).toBe(200);
    expect(parkOf(r, a.id)?.coordDeclined).toBe(true);
  });
});

describe('the last poll (F8-c, F2)', () => {
  it('fetchedAt is recorded on every serve of a ruling, whatever the time left before its expiry (F1)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    await r.rule(a.id, 'allow');
    const exp = r.row(a.id).notifyAt;
    r.q.noteRulingServed(r.row(a.id), exp - 1, GRACE);
    expect(r.row(a.id).fetchedAt).toBe(exp - 1);
    r.q.noteRulingServed(r.row(a.id), exp - 500, GRACE);
    expect(r.row(a.id).fetchedAt, 'the first serve is kept').toBe(exp - 1);
  });
  it('a ruling served inside the last seconds was used: the sweep never parks it, and no mail says run it again (F1)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    await r.rule(a.id, 'allow');
    // The hook read the allow 1 s before its expiry and printed it: the command ran.
    r.q.noteRulingServed(r.row(a.id), r.row(a.id).notifyAt - 1_000, GRACE);
    r.lapse(r.row(a.id).notifyAt + GRACE);
    expect(r.row(a.id).state).toBe('allowed');
    expect(parkOf(r, a.id)?.ruling ?? null).toBeNull();
    expect(r.mail(CHILD, `approval ${a.id} ruled`)).toBe(0);
  });
  it('an allowed row the hook never fetched, minted live, moves onto the park; the child is nudged; the retry meets it', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    await r.rule(a.id, 'allow');
    r.lapse(r.row(a.id).notifyAt + GRACE);
    expect(r.row(a.id).state).toBe('parked');
    expect(parkOf(r, a.id)?.ruling).toMatchObject({ verdict: 'allow', authority: 'coordinator', by: PARENT });
    expect(r.mail(CHILD, `approval ${a.id} ruled`)).toBe(1);
    const b = await minted(r.raise());
    expect(r.row(b.id).state).toBe('allowed');
  });
  it('a fetched ruling, and a row minted before PR 3 (no word), are never moved', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    await r.rule(a.id, 'allow');
    r.q.noteRulingServed(r.row(a.id), Date.now(), GRACE);
    const b = await minted(r.raise());
    await r.rule(b.id, 'allow');
    r.f.coord.db.prepare('UPDATE approvals SET parkWord = NULL WHERE id = ?').run(b.id);
    r.lapse(Math.max(r.row(a.id).notifyAt, r.row(b.id).notifyAt) + GRACE + 1);
    expect([r.row(a.id).state, r.row(b.id).state]).toEqual(['allowed', 'allowed']);
  });
});

describe('the park write asks whether the key\'s park is still open (approvals PR 3c F-B)', () => {
  it('an abandoned run while a prompt sits in its window: the row does not park, is not pushed, and is staled', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    expect(r.row(a.id).state).toBe('held');
    // The abandon door closes the run `failed` (a terminal run state) while the prompt is still inside its window.
    r.f.coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(r.f.runId);
    r.lapse(pastWindow(r, a.id));
    expect(r.row(a.id).state).toBe('stale');
    expect(parkOf(r, a.id)?.parkedAt ?? null, 'no first park is recorded').toBeNull();
    expect(r.pushes).toEqual([]);
    expect(parkedApprovalsFor(r.f.coord, Date.now())).toEqual([]);
  });
  it('the last-poll move on a closed run: an unfetched allow is not moved, and no mail says run it again', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    await r.rule(a.id, 'allow');
    r.f.coord.db.prepare("UPDATE runs SET state = 'failed' WHERE id = ?").run(r.f.runId);
    r.lapse(r.row(a.id).notifyAt + GRACE);
    expect(r.row(a.id).state).toBe('allowed');
    expect(parkOf(r, a.id)?.ruling ?? null).toBeNull();
    expect(r.mail(CHILD, `approval ${a.id} ruled`)).toBe(0);
  });
  it('a row minted before its key\'s park passed its horizon does not park at its window\'s end', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const t1 = pastWindow(r, a.id);
    r.lapse(t1);
    const horizon = t1 + APPROVAL_PARK_HORIZON_MS;
    // Minted 30 s before the horizon (the key still open), its window ends after it.
    const b = await minted(r.raise(ORDINARY, {}, horizon - 30_000));
    expect([b.park, r.row(b.id).state]).toEqual(['live', 'held']);
    r.lapse(pastWindow(r, b.id));
    expect(r.row(b.id).state).toBe('stale');
    expect(r.pushes.map((p) => p.source)).toEqual([`approval:${a.id}`]);
  });
  it('a row minted before a pane press voided its key\'s park does not park, and is not pushed', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    const b = await minted(r.raise());
    expect(r.row(b.id).state).toBe('held');
    expect(r.f.coord.markApprovalOperatorRows([a.id], Date.now())).toBe(1);
    expect(parkOf(r, a.id)?.voided).toBe(true);
    r.lapse(pastWindow(r, b.id));
    expect(r.row(b.id).state).toBe('stale');
    expect(r.pushes.map((p) => p.source)).toEqual([`approval:${a.id}`]);
  });
  it('the last-poll move honours recordParkRuling: a ruling the park refused (an unspent one stands) is never mailed', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    const b = await minted(r.raise());
    expect(r.row(b.id).state).toBe('held');
    expect(r.q.operatorRuleApproval({ id: a.id, verdict: 'deny', reason: 'not now', by: 'operator' }).status).toBe(200);
    await r.rule(b.id, 'allow');
    expect(r.row(b.id).state).toBe('allowed');
    r.lapse(r.row(b.id).notifyAt + GRACE);
    expect(r.row(b.id).state).toBe('parked');
    expect(parkOf(r, a.id)?.ruling).toMatchObject({ verdict: 'deny', authority: 'operator', rowId: a.id });
    expect(r.mail(CHILD, `approval ${b.id} ruled`), 'no "run the same command again" for a ruling the park did not take').toBe(0);
    expect(r.mail(CHILD, `approval ${a.id} ruled`)).toBe(1);
  });
});

describe('the one signing site\'s deny currency (F2\'s carry from PR 0\'s review)', () => {
  it('a row minted current, its managed deny file changed before the ruling, is refused at signing when the door reads the standing', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const res = await r.rule(a.id, 'allow', { denyStanding: async () => 'history' });
    expect(res).toMatchObject({ status: 409, body: { error: 'deny-not-current' } });
    expect(r.row(a.id).state).toBe('held');
  });
  it('a reclaim landing during the standing read: the claimant is measured again before signing, and the allow is refused (review 2889 F9)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const reclaimDuringRead = async () => {
      r.f.coord.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run(DUNE, r.f.runId);
      return 'current' as const;
    };
    const res = await r.rule(a.id, 'allow', { denyStanding: reclaimDuringRead });
    expect(res).toMatchObject({ status: 409, body: { error: 'parent-changed' } });
    expect(r.row(a.id).state).toBe('held');
  });
  it('a standing read that throws fails closed: the allow is refused deny-not-current (review 2889 F9)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const res = await r.rule(a.id, 'allow', { denyStanding: async () => { throw new Error('fixture: the managed deny file is unreadable'); } });
    expect(res).toMatchObject({ status: 409, body: { error: 'deny-not-current' } });
    expect(r.row(a.id).state).toBe('held');
  });
  it('with no standing read passed (the claimant door before H4), the door answers as today', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    expect((await r.rule(a.id, 'allow')).status).toBe(200);
    expect(signedRecord(r, a.id)).toMatchObject({ v: 1, verdict: 'allow' });
  });
  it('the retry\'s signing reads the standing the raise read: a history child\'s coordinator ruling is refused and spent', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    await r.rule(a.id, 'allow');
    const b = await minted(r.raise(ORDINARY, { denyStanding: async () => 'history' }));
    expect(r.row(b.id).state).toBe('held');
    expect(parkOf(r, a.id)?.ruling?.spent).toBe(true);
  });
});

describe('the prune (T8-4)', () => {
  it('a park past its horizon plus the input retention is deleted; the row is kept', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const at = pastWindow(r, a.id);
    r.lapse(at);
    const horizon = at + APPROVAL_PARK_HORIZON_MS;
    r.q.prune(horizon + APPROVAL_INPUT_RETENTION_DAYS * 86_400_000 - 1);
    expect(parkOf(r, a.id)).not.toBeNull();
    r.q.prune(horizon + APPROVAL_INPUT_RETENTION_DAYS * 86_400_000 + 1);
    expect(parkOf(r, a.id)).toBeNull();
    expect(r.row(a.id).id).toBe(a.id);
  });
});
