// The route file's park hunks (approvals PR 3, the packet item 486 lets run 1850's holder take): H1, the request route's `201`
// carries the park's word; H2, the ruling read records `fetchedAt`; H3, the operator door's `approval-<n>` arm reaches its
// handler (the account gate first); H4, the claimant door's deps carry the deny standing, so the one signing site re-checks
// it at signing. Through the real server over a fixture HOME (the approvals harness). Neutral fixtures only.
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHILD_DENY_SETTINGS_FILE } from '../../shared/api.js';
import { CHILD, hookInput, PARENT, requestBody, standardFixture, type Approvals } from './approvalsHarness.js';

let f: (Approvals & { runId: number }) | undefined;
afterEach(async () => { if (f) await f.close(); f = undefined; });

const ORDINARY = hookInput({ command: 'rm -rf build' });
const mint = async (fx: Approvals): Promise<{ id: number; nonce: string; body: Record<string, unknown> }> => {
  const body = requestBody(ORDINARY);
  const res = await fx.request(body);
  expect(res.statusCode).toBe(201);
  return { id: (res.json() as { id: number }).id, nonce: body.nonce, body: res.json() as Record<string, unknown> };
};
const rowOf = (fx: Approvals, id: number) => { const r = fx.coord.approvalById(id); if (!r.ok || r.row === null) throw new Error('row'); return r.row; };

describe('H1: the request route\'s 201 carries the park word decided at mint', () => {
  it('a held mint answers its id, its window and park: shadow while the lane is gated', async () => {
    f = await standardFixture();
    const m = await mint(f);
    expect(m.body).toEqual({ id: m.id, waitS: 60, park: 'shadow' });
    expect(rowOf(f, m.id).parkWord).toBe('shadow');
  });
});

describe('H2: the ruling read records fetchedAt', () => {
  it('serving a ruling the grace before its expiry records fetchedAt once; the answer is unchanged', async () => {
    f = await standardFixture();
    const m = await mint(f);
    expect((await f.rule(m.id, PARENT, 'allow')).statusCode).toBe(200);
    const res = await f.ruling(m.id, m.nonce);
    expect(res.json()).toMatchObject({ state: 'allowed', ruling: { record: { rowId: m.id } } });
    const at = rowOf(f, m.id).fetchedAt;
    expect(at).not.toBeNull();
    await f.ruling(m.id, m.nonce);
    expect(rowOf(f, m.id).fetchedAt).toBe(at);
  });
  it('a held row serves no ruling and records nothing', async () => {
    f = await standardFixture();
    const m = await mint(f);
    expect((await f.ruling(m.id, m.nonce)).json()).toEqual({ state: 'held' });
    expect(rowOf(f, m.id).fetchedAt).toBeNull();
  });
});

describe('H3: the operator door\'s approval arm', () => {
  const answer = (fx: Approvals, qid: string, body: Record<string, unknown>) =>
    fx.app.inject({ method: 'POST', url: `/api/questions/${qid}/answer`, payload: body });
  it('an approval-<n> id reaches the arm: its account gate answers first (auth-off while sign-in is dark)', async () => {
    f = await standardFixture();
    const m = await mint(f);
    const res = await answer(f, `approval-${m.id}`, { kind: 'approval', verdict: 'allow' });
    expect(res.json()).toMatchObject({ ok: false, error: 'auth-off' });
  });
  it('an ask-<n> id is still kind-mismatch', async () => {
    f = await standardFixture();
    const res = await answer(f, 'ask-1', { kind: 'approval', verdict: 'allow' });
    expect(res.json()).toMatchObject({ ok: false, error: 'kind-mismatch' });
  });
});

describe('H4: the claimant door re-checks the deny standing at signing (F2\'s carry)', () => {
  it('a row minted current whose managed deny file changed before the ruling is refused deny-not-current', async () => {
    f = await standardFixture();
    const m = await mint(f);
    writeFileSync(path.join(f.home, '.cc-sessions', CHILD_DENY_SETTINGS_FILE), '{"permissions":{"deny":["Bash(ccd ws-gc:*)"]}}\n');
    const res = await f.rule(m.id, PARENT, 'allow');
    expect(res.json()).toMatchObject({ ok: false, error: 'deny-not-current' });
    expect(rowOf(f, m.id).state).toBe('held');
  });
  it('a deny is still signed', async () => {
    f = await standardFixture();
    const m = await mint(f);
    writeFileSync(path.join(f.home, '.cc-sessions', CHILD_DENY_SETTINGS_FILE), '{"permissions":{"deny":["Bash(ccd ws-gc:*)"]}}\n');
    expect((await f.rule(m.id, PARENT, 'deny')).statusCode).toBe(200);
    expect(rowOf(f, m.id).state).toBe('denied');
  });
  it('the child id stays the fixture\'s', () => { expect(CHILD).toBe('project-a-quiet-basin'); });
});
