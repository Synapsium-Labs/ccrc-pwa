// The approvals lane's routes (coordinator-first routing plan Task 16, spec §6.3 server half, D-5298, D-5440, D-5441,
// D-5530, D-5531). A child's hook asks (`POST /api/approvals`); the server mints a row held for the child's run's
// ATTRIBUTED claimant wherever it sits, or refuses with nothing minted, or mints it released with its reason; the
// claimant rules (`POST /api/approvals/:id/rule`) and the server signs; the hook fetches the ruling with its nonce.
// Every ruling here is verified with the shipped verifier's own function (`ccd/approval-verify.mjs`).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verdictFor } from '../../ccd/approval-verify.mjs';
import { APPROVAL_CWD_TRUSTED, APPROVAL_REFUSALS_LOG } from '../../shared/api.js';
import {
  approvalCount, CHILD, CHILD2, DENY_DIGEST, DUNE, FAR, FAR_C, hookInput, PARENT, requestBody, sha256, standardFixture,
  TOK, uuidOf, workdirOf, approvalsFixture, type Approvals,
} from './approvalsHarness.js';

let f: (Approvals & { runId?: number }) | undefined;
afterEach(async () => { vi.useRealTimers(); if (f) await f.close(); f = undefined; });

const ORDINARY = hookInput({ command: 'rm -rf build' });
const mailsTo = (fx: Approvals, to: string): { subject: string; body: string }[] =>
  fx.coord.db.prepare("SELECT m.subject, m.body FROM mail m JOIN mail_deliveries d ON d.mailId = m.id WHERE d.toId = ? AND m.subject LIKE 'approval:%'")
    .all(to) as { subject: string; body: string }[];
const rowOf = (fx: Approvals, id: number) => {
  const r = fx.coord.approvalById(id);
  if (!r.ok || r.row === null) throw new Error('fixture: the row must read back');
  return r.row;
};
const keyOf = async (fx: Approvals): Promise<string> =>
  ((await fx.app.inject({ method: 'GET', url: '/api/approvals/key', headers: TOK })).json() as { publicKey: string }).publicKey;

/** Mint an approval through the route, as the hook does; answers the row id, the body sent, and the response. */
const ask = async (fx: Approvals, input: Record<string, unknown> = ORDINARY, id = CHILD) => {
  const body = requestBody(input, id);
  const res = await fx.request(body);
  return { res, body, id: (res.json() as { id?: number }).id ?? -1 };
};

describe('POST /api/approvals — the request (spec §6.3 server steps 1 and 2)', () => {
  it('a held request answers 201 {id, waitS}: 60 on the main thread (D-5441), mailed to the claimant', async () => {
    f = await standardFixture();
    const { res, id } = await ask(f);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id, waitS: 60 });
    const row = rowOf(f, id);
    expect({ state: row.state, parentId: row.parentId, class: row.class, agentId: row.agentId, runId: row.runId })
      .toEqual({ state: 'held', parentId: PARENT, class: 'ordinary', agentId: '', runId: f.runId });
    expect(mailsTo(f, PARENT)).toHaveLength(1);
  });

  it('a digest that does not match its input is refused, mints nothing, and is journaled for doctor', async () => {
    f = await standardFixture();
    const body = { ...requestBody(ORDINARY), digest: 'a'.repeat(64) };
    const res = await f.request(body);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'digest-mismatch' });
    expect(approvalCount(f.coord)).toBe(0);
    expect(readFileSync(path.join(f.home, '.ccrc', APPROVAL_REFUSALS_LOG), 'utf8')).toMatch(/^\d+ digest-mismatch project-a-quiet-basin\n$/);
  });

  it('a canonical string that does not re-canonicalise to itself (a reordered key) is digest-mismatch', async () => {
    f = await standardFixture();
    const good = requestBody(ORDINARY);
    const reordered = (good['canonical'] as string).replace('{"command":"rm -rf build","description":"Remove the build directory"}',
      '{"description":"Remove the build directory","command":"rm -rf build"}');
    expect(reordered).not.toBe(good['canonical']);
    const res = await f.request({ ...good, canonical: reordered, digest: sha256(reordered) });
    expect(res.json()).toMatchObject({ error: 'digest-mismatch' });
    expect(approvalCount(f.coord)).toBe(0);
  });

  it('not a child: an operator-created session is refused, nothing minted — even when an open run names it', async () => {
    f = await standardFixture();
    f.run(PARENT, DUNE);
    const { res } = await ask(f, ORDINARY, DUNE);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'not-a-child' });
    expect(approvalCount(f.coord)).toBe(0);
  });

  it('a .child mark naming no run is not-a-child, nothing minted', async () => {
    f = await standardFixture();
    f.child(CHILD2, 999);
    const { res } = await ask(f, ORDINARY, CHILD2);
    expect(res.json()).toMatchObject({ error: 'not-a-child' });
    expect(approvalCount(f.coord)).toBe(0);
  });

  it('a version not in APPROVAL_HOOK_VERSIONS is refused, nothing minted', async () => {
    f = await approvalsFixture();
    f.seed(PARENT, 'project-a');
    f.seed(CHILD, 'project-a', '2.1.299');
    f.child(CHILD, f.run(PARENT, CHILD));
    const { res } = await ask(f);
    expect(res.json()).toMatchObject({ error: 'version-unverified' });
    expect(approvalCount(f.coord)).toBe(0);
  });

  it('no .deny-settings, one naming another digest, or no bash pin: deny-not-engaged, nothing minted', async () => {
    for (const o of [{ deny: null }, { deny: 'b'.repeat(64) }, { shell: null }, { shell: '/bin/zsh' }]) {
      const fx = await standardFixture();
      try {
        fx.child(CHILD, fx.runId, o);
        const { res } = await ask(fx);
        expect(res.json(), JSON.stringify(o)).toMatchObject({ error: 'deny-not-engaged' });
        expect(approvalCount(fx.coord)).toBe(0);
      } finally { await fx.close(); }
    }
  });

  it('the managed deny file changed since the spawn: deny-not-engaged', async () => {
    f = await standardFixture();
    appendFileSync(path.join(f.home, '.cc-sessions', 'child-deny.settings.json'), ' ');
    const { res } = await ask(f);
    expect(res.json()).toMatchObject({ error: 'deny-not-engaged' });
    expect(DENY_DIGEST).toMatch(/^[0-9a-f]{64}$/);
  });

  it('role both without the opt-in is single-box, nothing minted; with it, minted', async () => {
    f = await standardFixture({ role: 'both' });
    expect((await ask(f)).res.json()).toMatchObject({ error: 'single-box' });
    expect(approvalCount(f.coord)).toBe(0);
    writeFileSync(path.join(f.home, '.ccrc', 'approvals-single-box'), '');
    expect((await ask(f)).res.statusCode).toBe(201);
  });

  it('either kill switch on: nothing minted', async () => {
    f = await standardFixture();
    writeFileSync(path.join(f.home, '.cc-sessions', 'approvals-disabled'), '');
    expect((await ask(f)).res.json()).toMatchObject({ error: 'approvals-disabled' });
    expect(approvalCount(f.coord)).toBe(0);
    const g = await standardFixture();
    try {
      writeFileSync(path.join(g.home, '.ccrc', 'approvals-disabled'), '');
      expect((await ask(g)).res.json()).toMatchObject({ error: 'approvals-disabled' });
      expect(approvalCount(g.coord)).toBe(0);
    } finally { await g.close(); }
  });

  it('a forbidden request is minted released and never mailed', async () => {
    f = await standardFixture();
    const { res, id } = await ask(f, hookInput({ command: 'ccd ws-rm project-a-still-cove' }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'approval-released', releaseReason: 'forbidden' });
    const row = rowOf(f, id);
    expect({ state: row.state, class: row.class, releaseReason: row.releaseReason }).toEqual({ state: 'released', class: 'forbidden', releaseReason: 'forbidden' });
    expect(mailsTo(f, PARENT)).toEqual([]);
  });

  it('a parent that is not live mints released parent-not-live, no mail', async () => {
    f = await standardFixture();
    f.gone.add(PARENT);
    const { res, id } = await ask(f);
    expect(res.json()).toMatchObject({ error: 'approval-released', releaseReason: 'parent-not-live' });
    expect(rowOf(f, id).state).toBe('released');
    expect(mailsTo(f, PARENT)).toEqual([]);
  });

  it('a truncated request is minted released truncated', async () => {
    f = await standardFixture();
    const b: Record<string, unknown> = { ...requestBody(ORDINARY) };
    delete b['canonical'];
    const res = await f.request({ ...b, truncated: true });
    expect(res.json()).toMatchObject({ error: 'approval-released', releaseReason: 'truncated' });
  });
});

describe('POST /api/approvals/:id/rule — the claimant rules, and the server signs (spec §6.3 server steps 5 and 6)', () => {
  it('a parent allows an ordinary row: the stored ruling verifies with the public key and names row, session, agent, digest, nonce', async () => {
    f = await standardFixture();
    const { id, body } = await ask(f);
    const res = await f.rule(id, PARENT, 'allow');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: 'allowed' });
    const row = rowOf(f, id);
    expect({ state: row.state, answeredBy: row.answeredBy }).toEqual({ state: 'allowed', answeredBy: PARENT });
    const got = await f.ruling(id, body['nonce'] as string);
    expect(got.statusCode).toBe(200);
    const answer = got.json() as { state: string; ruling: { record: Record<string, unknown>; sig: string } };
    expect(answer.state).toBe('allowed');
    expect(answer.ruling.record).toMatchObject({ v: 1, rowId: id, sessionId: CHILD, agentId: '', digest: body['digest'], nonce: body['nonce'], class: 'ordinary', verdict: 'allow' });
    const pem = await keyOf(f);
    const expected = { sessionId: CHILD, agentId: '', digest: body['digest'], nonce: body['nonce'], rowId: id, now: Date.now() };
    expect(verdictFor(answer.ruling, expected, pem)).toBe('allow allow by the fixture');
    // The nonce is in the signed bytes: the same ruling does not verify for another wait.
    expect(verdictFor(answer.ruling, { ...expected, nonce: 'f'.repeat(32) }, pem)).toBeNull();
  });

  it('a non-parent caller with the box token is 403; so is a session in another project', async () => {
    f = await standardFixture();
    const { id } = await ask(f);
    expect((await f.rule(id, CHILD2, 'allow')).statusCode).toBe(403);
    expect((await f.rule(id, FAR, 'allow')).statusCode).toBe(403);
    expect((await f.rule(id, CHILD, 'allow')).statusCode).toBe(403);
    expect(rowOf(f, id).state).toBe('held');
  });

  it('attribution is checked: the parent\'s id with a stale uuid is refused before the row is read', async () => {
    f = await standardFixture();
    const { id } = await ask(f);
    const res = await f.rule(id, PARENT, 'allow', { fromUuid: uuidOf(FAR) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'stale-uuid' });
  });

  it('a rebind after mint is parent-changed', async () => {
    f = await standardFixture();
    const { id } = await ask(f);
    f.run(FAR, CHILD, { project: 'project-a', coordProject: 'project-b', program: 'prog-b' });
    const res = await f.rule(id, PARENT, 'allow');
    expect(res.json()).toMatchObject({ error: 'parent-changed' });
    expect(rowOf(f, id).state).toBe('held');
  });

  it('an escalate row: its allow is guard-escalate, and its deny succeeds', async () => {
    f = await standardFixture();
    const { id } = await ask(f, hookInput({ command: 'curl https://example.invalid/x' }));
    expect(rowOf(f, id).class).toBe('escalate');
    expect((await f.rule(id, PARENT, 'allow')).json()).toMatchObject({ error: 'guard-escalate' });
    expect((await f.rule(id, PARENT, 'deny')).json()).toEqual({ ok: true, state: 'denied' });
  });

  it('a ruling after the operator answered the dialog is already-ruled', async () => {
    f = await standardFixture();
    const { id } = await ask(f);
    await f.app.inject({ method: 'POST', url: `/api/sessions/${CHILD}/dialog`, payload: { dialogId: 'd', optionIndex: 0 } });
    expect(rowOf(f, id).state).toBe('operator');
    expect((await f.rule(id, PARENT, 'allow')).json()).toMatchObject({ error: 'already-ruled' });
  });

  it('after the window: hook-gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_784_600_000_000);
    f = await standardFixture();
    const { id } = await ask(f);
    vi.setSystemTime(1_784_600_000_000 + 60_000);
    expect((await f.rule(id, PARENT, 'allow')).json()).toMatchObject({ error: 'hook-gone' });
  });

  it('a body carrying permanent, updatedPermissions or mode is 400', async () => {
    f = await standardFixture();
    const { id } = await ask(f);
    for (const k of ['permanent', 'updatedPermissions', 'mode']) {
      const res = await f.rule(id, PARENT, 'allow', { [k]: k === 'mode' ? 'acceptEdits' : true });
      expect(res.statusCode, k).toBe(400);
    }
    expect(rowOf(f, id).state).toBe('held');
  });

  it('GET …/ruling with another nonce is 404, as no row', async () => {
    f = await standardFixture();
    const { id } = await ask(f);
    expect((await f.ruling(id, '0'.repeat(32))).statusCode).toBe(404);
    expect((await f.ruling(id, 'not-hex')).statusCode).toBe(404);
  });

  it('a released (declined) row answers its state and no ruling, which the hook stops on (D-5440)', async () => {
    f = await standardFixture();
    const { id, body } = await ask(f);
    expect((await f.release(id, PARENT)).json()).toEqual({ ok: true });
    const got = (await f.ruling(id, body['nonce'] as string)).json() as Record<string, unknown>;
    expect(got).toEqual({ state: 'declined' });
    expect((await f.rule(id, PARENT, 'allow')).json()).toMatchObject({ error: 'declined' });
  });
});

describe('the claimant rule (D-5530, D-5531): held for the run\'s attributed claimant wherever it sits', () => {
  it('a cross-project claimant: a run of project-b-far-ridge binding the child is held for it, mailed to it, and its allow is signed; a non-claimant of another project is 403', async () => {
    f = await approvalsFixture();
    f.seed(CHILD, 'project-a');
    f.seed(FAR, 'project-b');
    f.seed(FAR_C, 'project-c');
    f.child(CHILD, f.run(FAR, CHILD, { project: 'project-a', coordProject: 'project-b' }));
    const { res, id, body } = await ask(f);
    expect(res.statusCode).toBe(201);
    expect(rowOf(f, id).parentId).toBe(FAR);
    expect(mailsTo(f, FAR)).toHaveLength(1);
    expect((await f.rule(id, FAR_C, 'allow')).statusCode).toBe(403);
    expect((await f.rule(id, FAR, 'allow')).json()).toEqual({ ok: true, state: 'allowed' });
    const got = (await f.ruling(id, body['nonce'] as string)).json() as { ruling: { record: unknown; sig: string } };
    expect(verdictFor(got.ruling, { sessionId: CHILD, agentId: '', digest: body['digest'], nonce: body['nonce'], rowId: id, now: Date.now() },
      await keyOf(f))).toMatch(/^allow /);
  });

  it('a mark naming a run claimed by someone other than the binding parent mints released run-other-programme', async () => {
    f = await standardFixture();
    const farRun = f.run(FAR, CHILD2, { coordProject: 'project-b', program: 'prog-b' });
    f.run(PARENT, CHILD2);
    f.child(CHILD2, farRun);
    const { res, id } = await ask(f, ORDINARY, CHILD2);
    expect(res.json()).toMatchObject({ error: 'approval-released', releaseReason: 'run-other-programme' });
    expect(rowOf(f, id).parentId).toBe('operator');
    expect(mailsTo(f, PARENT)).toEqual([]);
    expect(mailsTo(f, FAR)).toEqual([]);
  });

  it('a run with no claimant: run-unclaimed; journaled unattributed, or unstamped: run-unattributed; an unmeasurable parent: parent-unmeasured — each released, no mail', async () => {
    const cases: [string, (fx: Approvals) => void, string][] = [
      ['unclaimed', (fx) => { fx.child(CHILD2, fx.run(null, CHILD2)); }, 'run-unclaimed'],
      ['unattributed', (fx) => { fx.child(CHILD2, fx.run(PARENT, CHILD2, { unattributed: true, program: 'prog-u' })); }, 'run-unattributed'],
      ['unstamped', (fx) => { fx.child(CHILD2, fx.run(PARENT, CHILD2, { coordProject: null, program: 'prog-s' })); }, 'run-unattributed'],
      ['unmeasurable', (fx) => { fx.child(CHILD2, fx.run(PARENT, CHILD2, { program: 'prog-m' })); fx.unmeasured.add(PARENT); }, 'parent-unmeasured'],
    ];
    for (const [name, setup, reason] of cases) {
      const fx = await standardFixture();
      try {
        setup(fx);
        const { res, id } = await ask(fx, ORDINARY, CHILD2);
        expect(res.json(), name).toMatchObject({ error: 'approval-released', releaseReason: reason });
        expect(rowOf(fx, id).state, name).toBe('released');
        expect(mailsTo(fx, PARENT), name).toEqual([]);
        expect((await fx.rule(id, PARENT, 'deny')).statusCode, name).not.toBe(200);
      } finally { await fx.close(); }
    }
  });
});

describe('the working directory reaches the classifier only on a trusted version (spec §6.5, §6.9)', () => {
  it('on a trusted version, a sibling-worktree cwd with rm -rf build is escalate, and its allow is guard-escalate', async () => {
    f = await standardFixture();
    const { id } = await ask(f, hookInput({ cwd: workdirOf(CHILD2), command: 'rm -rf build' }));
    expect(rowOf(f, id).class).toBe('escalate');
    expect((await f.rule(id, PARENT, 'allow')).json()).toMatchObject({ error: 'guard-escalate' });
  });

  it('on a version in APPROVAL_HOOK_VERSIONS but not APPROVAL_CWD_TRUSTED, a subagent\'s relative rm -rf build escalates; the literal absolute target is still ordinary', async () => {
    const trusted = APPROVAL_CWD_TRUSTED as string[];
    const at = trusted.indexOf('2.1.302');
    expect(at).toBeGreaterThanOrEqual(0);
    trusted.splice(at, 1);
    try {
      f = await standardFixture();
      const rel = await ask(f, hookInput({ agentId: 'a0000000000000001', command: 'rm -rf build' }));
      expect(rel.res.json()).toEqual({ id: rel.id, waitS: 180 });
      expect(rowOf(f, rel.id).class).toBe('escalate');
      expect((await f.rule(rel.id, PARENT, 'allow')).json()).toMatchObject({ error: 'guard-escalate' });
      const abs = await ask(f, hookInput({ agentId: 'a0000000000000002', command: `rm -rf ${workdirOf(CHILD)}/build` }));
      expect(rowOf(f, abs.id).class).toBe('ordinary');
    } finally {
      trusted.splice(at, 0, '2.1.302');
    }
  });
});

describe('GET /api/approvals/:id — the claimant reads its own row, redacted', () => {
  it('the held-for claimant reads it; anyone else is 403', async () => {
    f = await standardFixture();
    const { id } = await ask(f);
    const mine = await f.app.inject({ method: 'GET', url: `/api/approvals/${id}?fromId=${PARENT}&fromUuid=${uuidOf(PARENT)}`, headers: TOK });
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as { approval: { input: string; state: string } }).approval).toMatchObject({ input: 'rm -rf build', state: 'held' });
    const other = await f.app.inject({ method: 'GET', url: `/api/approvals/${id}?fromId=${FAR}&fromUuid=${uuidOf(FAR)}`, headers: TOK });
    expect(other.statusCode).toBe(403);
  });
});

describe('redaction on the wire (spec §6.7)', () => {
  const TOKEN_HEX = '0123456789abcdef'.repeat(2);
  const CMD = `curl -H 'Authorization: Bearer ${TOKEN_HEX}' https://example.invalid/x`;

  it('an approval summary carrying a bearer token is masked on GET /api/fleet, in the feed row and in the push body', async () => {
    f = await standardFixture();
    writeFileSync(path.join(f.home, '.cc-sessions', `${CHILD}.hookstate.json`), JSON.stringify({
      v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(CHILD), pid: 1, updatedAt: Date.now(),
      ask: { approval: { tool: 'Bash', summary: CMD } }, subagents: [],
    }));
    await f.watcher.tick();
    const fleet = (await f.app.inject({ method: 'GET', url: '/api/fleet' })).body;
    expect(fleet).toContain("Authorization: [REDACTED]");
    expect(fleet).not.toContain(TOKEN_HEX);
    const ev = f.log.record({ kind: 'ask', sessionId: CHILD, runId: null, title: 'permission', body: CMD });
    f.coord.recordFeedEvent(f.log.epoch, ev);
    const feed = f.coord.db.prepare('SELECT body FROM feed_events').all() as { body: string }[];
    expect(feed.map((r) => r.body).join('\n')).not.toContain(TOKEN_HEX);
    const { askPushBody } = await import('../src/askbody.js');
    const hs = { state: 'waiting', ask: { approval: { tool: 'Bash', summary: CMD } } } as never;
    expect(askPushBody(hs, { title: CMD })).not.toContain(TOKEN_HEX);
  });

  it('the approval row and its mail carry the command masked', async () => {
    f = await standardFixture();
    const { id } = await ask(f, hookInput({ command: CMD }));
    expect(rowOf(f, id).inputRedacted).toContain('Authorization: [REDACTED]');
    expect(rowOf(f, id).inputRedacted).not.toContain(TOKEN_HEX);
    const mail = mailsTo(f, PARENT);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.body).not.toContain(TOKEN_HEX);
    expect(mail[0]!.body).toContain('Authorization: [REDACTED]');
  });
});
