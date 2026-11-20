// The park over a real coordination store (approvals plan 2026-11-18, §3.3, Tasks 3.1 and 3.3; approvals PR 3): the mint's
// word and its slot, the one write site of `parked`, the park record, the parked-aware rule door, the last-poll move, the one
// signing site, the operator's core, the nudge, the void and the prune. The questions owner is driven directly
// (`createQuestions`), because the request route's park word, the ruling read's `fetchedAt` and the operator door's arm are
// wired in PR 3b; and the lane is driven live past its gate (`parkGate`), because this build holds it inert. A case named
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
import { APPROVAL_INPUT_RETENTION_DAYS, approvalRulingBytes, isApprovalState, type ApprovalRulingRecordAny } from '../../shared/api.js';
import { APPROVAL_PARK_HORIZON_MS } from '../../shared/approval-park.js';
import { APPROVAL_PARK_LANE } from '../../shared/lane-arm.js';
import { CHILD, CHILD2, hookInput, PARENT, requestBody, standardFixture, type Approvals } from './approvalsHarness.js';

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
const signedRecord = (r: Rig, id: number): ApprovalRulingRecordAny => {
  const ruling = JSON.parse(r.row(id).ruling ?? 'null') as { record: ApprovalRulingRecordAny; sig: string };
  const ok = verify(null, Buffer.from(approvalRulingBytes(ruling.record) ?? '', 'utf8'), createPublicKey(r.signer.publicKeyPem()), Buffer.from(ruling.sig, 'base64'));
  expect(ok, 'the signature verifies over the record').toBe(true);
  return ruling.record;
};

describe('inert until PR 3b: the lane\'s gate holds it in shadow', () => {
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
  it('a pane press marks a parked row operator and voids its park; a later ruling on it is refused (F4)', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    expect(r.f.coord.markApprovalOperator(CHILD, Date.now())).toBe(1);
    expect(r.row(a.id).state).toBe('operator');
    expect(parkOf(r, a.id)?.voided).toBe(true);
    expect(r.q.operatorRuleApproval({ id: a.id, verdict: 'allow', reason: 'ok', by: 'operator' }).status).toBe(409);
  });
  it('markApprovalOperatorRows does the same for the rows it names', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    r.lapse(pastWindow(r, a.id));
    expect(r.f.coord.markApprovalOperatorRows([a.id], Date.now())).toBe(1);
    expect(parkOf(r, a.id)?.voided).toBe(true);
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
  it('fetchedAt is recorded when a ruling is served the grace before its expiry, and not later', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    await r.rule(a.id, 'allow');
    const exp = r.row(a.id).notifyAt;
    r.q.noteRulingServed(r.row(a.id), exp - GRACE + 1, GRACE);
    expect(r.row(a.id).fetchedAt).toBeNull();
    r.q.noteRulingServed(r.row(a.id), exp - GRACE, GRACE);
    expect(r.row(a.id).fetchedAt).toBe(exp - GRACE);
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

describe('the one signing site\'s deny currency (F2\'s carry from PR 0\'s review)', () => {
  it('a row minted current, its managed deny file changed before the ruling, is refused at signing when the door reads the standing', async () => {
    const r = await rig();
    const a = await minted(r.raise());
    const res = await r.rule(a.id, 'allow', { denyStanding: async () => 'history' });
    expect(res).toMatchObject({ status: 409, body: { error: 'deny-not-current' } });
    expect(r.row(a.id).state).toBe('held');
  });
  it('with no standing read passed (the claimant door until PR 3b), the door answers as today', async () => {
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
