// runCcrcOp, the server's own Linear caller (D-8180; design §6.3): the proxy's order less attribution and validation.
// Linear is faked at the `FetchLike` boundary with constructed answers; nothing reaches a network.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { runCcrcOp, type CcrcCallDeps, type CcrcOpAsk } from '../src/linear/ccrcCall.js';
import type { FetchLike } from '../src/linear/client.js';
import type { LinearWriteAsk, LinearWritePolicy } from '../src/linear/policy.js';
import { linearServicesFake } from './linearServicesFake.js';
import { linearAnswer, RATELIMITED_ERRORS } from './linearFetchFake.js';
import { seedSlot, WS } from './linearProxyRig.js';
import { mkTmp } from './tmpHelpers.js';

const CREATED = '00000000-0004-4000-8000-000000000011';
const KEY = WS.a.key;

afterEach(() => { vi.restoreAllMocks(); });

interface Rig { deps: CcrcCallDeps; calls: { query: string; authorization: string }[]; fx: ReturnType<typeof linearServicesFake>; t: { now: number } }

async function rig(answer: (n: number) => ReturnType<FetchLike> | 'hang', over: { policy?: LinearWritePolicy; seed?: boolean; timeoutMs?: number } = {}): Promise<Rig> {
  const ccrcDir = path.join(mkTmp('ccrc-ccall-'), '.ccrc');
  if (over.seed !== false) await seedSlot(ccrcDir, 'a');
  const t = { now: 1_800_000_000_000 };
  const fx = linearServicesFake({ clock: () => t.now });
  const calls: Rig['calls'] = [];
  const fetch: FetchLike = (_url, init) => {
    calls.push({ query: (JSON.parse(init.body) as { query: string }).query, authorization: init.headers['authorization'] ?? '' });
    const a = answer(calls.length);
    if (a === 'hang') return new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true }); });
    return a;
  };
  return { deps: { ccrcDir, rate: fx.rate, journal: fx.journal, policy: over.policy ?? fx.policy, fetch, timeoutMs: over.timeoutMs, now: () => t.now }, calls, fx, t };
}

const ok = (body: unknown): ReturnType<FetchLike> => Promise.resolve(linearAnswer({ ok: true, status: 200, json: async () => body }));
const created = ok({ data: { projectCreate: { success: true, project: { id: CREATED } } } });

const WRITE: CcrcOpAsk = {
  op: 'projectCreate', pass: 'plan-sync', lane: 'sync', slot: { source: 'file', id: WS.a.id }, workspaceId: WS.a.id,
  teamKey: null, target: null, fields: ['name'], input: { name: 'Project A' },
};
const READ: CcrcOpAsk = { ...WRITE, op: 'initiativesByName', fields: [], input: { name: 'Programme A' } };
const rows = (fx: Rig['fx']): Record<string, unknown>[] => fx.db.prepare('SELECT * FROM linear_events ORDER BY id').all() as Record<string, unknown>[];

describe('runCcrcOp (D-8180)', () => {
  it('a write is journaled pending before the call and ok after, with the created UUID', async () => {
    const r = await rig(() => created);
    let during: Record<string, unknown>[] = [];
    const inner = r.deps.fetch!;
    r.deps.fetch = (u, i) => { during = rows(r.fx); return inner(u, i); };
    const out = await runCcrcOp(r.deps, WRITE);
    expect(out).toEqual({ ok: true, value: { id: CREATED }, created: CREATED });
    expect(during.map((x) => x['outcome'])).toEqual(['pending']);
    expect(during[0]).toMatchObject({ op: 'project-create', actor: 'ccrc:plan-sync', sessionId: null, workspaceId: WS.a.id });
    expect(rows(r.fx)[0]).toMatchObject({ outcome: 'ok', result: CREATED, fields: 'name' });
    expect(r.calls[0]!.authorization).toBe(KEY);
  });

  it('a denied policy sends nothing and journals denied', async () => {
    const seen: LinearWriteAsk[] = [];
    const r = await rig(() => created, { policy: async (a) => { seen.push(a); return { allow: false, why: 'denied', decisionId: 'd-1' }; } });
    const out = await runCcrcOp(r.deps, WRITE);
    expect(out).toEqual({ ok: false, word: 'policy-denied', maybeSent: false });
    expect(r.calls).toHaveLength(0);
    expect(rows(r.fx)[0]).toMatchObject({ outcome: 'denied', code: 'policy-denied', decisionId: 'd-1' });
    expect(seen[0]).toMatchObject({ actor: { kind: 'ccrc', pass: 'plan-sync' }, resource: { op: 'project-create', object: { kind: 'project', id: null } } });
  });

  it('the policy ask names the issue for an issue update, and none for a create or a project write', async () => {
    const seen: LinearWriteAsk[] = [];
    const r = await rig(() => created, { policy: async (a) => { seen.push(a); return { allow: false, why: 'denied', decisionId: 'd-1' }; } });
    await runCcrcOp(r.deps, { ...WRITE, op: 'issueUpdate', teamKey: 'CCRC', target: 'CCRC-12', fields: ['title'] });
    await runCcrcOp(r.deps, { ...WRITE, op: 'issueCreate', teamKey: 'CCRC', target: null, fields: ['title'] });
    await runCcrcOp(r.deps, WRITE);
    expect(seen.map((a) => a.resource.issue)).toEqual(['CCRC-12', null, null]);
  });

  it('a refused journal row sends nothing', async () => {
    const r = await rig(() => created);
    // A target outside the journal's grammar makes its pending row refuse.
    const out = await runCcrcOp(r.deps, { ...WRITE, op: 'projectUpdate', target: 'not a uuid or identifier', fields: ['name'] });
    expect(out).toEqual({ ok: false, word: 'journal-unavailable', maybeSent: false });
    expect(r.calls).toHaveLength(0);
    expect(rows(r.fx)).toHaveLength(0);
  });

  it('a timeout after send answers maybeSent and journals unknown', async () => {
    const r = await rig(() => 'hang', { timeoutMs: 20 });
    const out = await runCcrcOp(r.deps, WRITE);
    expect(out).toEqual({ ok: false, word: 'timeout', maybeSent: true });
    expect(r.calls).toHaveLength(1);
    expect(rows(r.fx)[0]).toMatchObject({ outcome: 'unknown', code: 'timeout' });
  });

  it('a rate-limited answer closes the slot for its wait', async () => {
    const r = await rig(() => Promise.resolve(linearAnswer({ ok: false, status: 429, headers: { 'retry-after': '90' }, json: async () => ({}) })));
    expect(await runCcrcOp(r.deps, WRITE)).toEqual({ ok: false, word: 'rate-limited', retryAfterS: 90 });
    expect(rows(r.fx)[0]).toMatchObject({ outcome: 'failed', code: 'rate-limited' });
    r.t.now += 30_000;
    const again = await runCcrcOp(r.deps, READ);
    expect(again).toMatchObject({ ok: false, word: 'rate-limited' });
    expect(r.calls).toHaveLength(1);
    r.t.now += 61_000;
    await runCcrcOp(r.deps, READ);
    expect(r.calls).toHaveLength(2);
  });

  it('a rate-limited 200 answer to the probe closes the slot for the fallback wait, and says so', async () => {
    const r = await rig(() => ok(RATELIMITED_ERRORS));
    const PROBE: CcrcOpAsk = { ...READ, op: 'initiativesProbe', lane: 'floor', input: {} };
    expect(await runCcrcOp(r.deps, PROBE)).toEqual({ ok: false, word: 'rate-limited', retryAfterS: 60 });
    r.t.now += 30_000;
    expect(await runCcrcOp(r.deps, PROBE)).toMatchObject({ ok: false, word: 'rate-limited' });
    expect(r.calls).toHaveLength(1);
  });

  it('a read takes the lane and journals nothing', async () => {
    const r = await rig(() => ok({ data: { initiatives: { nodes: [] } } }));
    const out = await runCcrcOp(r.deps, READ);
    expect(out).toEqual({ ok: true, value: { nodes: [] }, created: null });
    expect(rows(r.fx)).toHaveLength(0);
    expect(r.calls).toHaveLength(1);
  });

  it('a spent lane answers rate-limited with no call', async () => {
    const r = await rig(() => ok({ data: { initiatives: { nodes: [] } } }));
    let last: unknown;
    for (let i = 0; i < 60; i++) last = await runCcrcOp(r.deps, READ);
    expect(last).toMatchObject({ ok: false, word: 'rate-limited' });
    expect(r.calls.length).toBeLessThan(60);
  });

  it('no key answers not-configured and sends nothing', async () => {
    const r = await rig(() => created, { seed: false });
    expect(await runCcrcOp(r.deps, WRITE)).toEqual({ ok: false, word: 'not-configured', maybeSent: false });
    expect(r.calls).toHaveLength(0);
  });

  it('a thrown fetch is unreachable, never a throw', async () => {
    const r = await rig(() => { throw new Error('boom'); });
    expect(await runCcrcOp(r.deps, READ)).toEqual({ ok: false, word: 'unreachable', maybeSent: false });
  });

  it('the key is read per call and never appears in an outcome or a log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await rig(() => Promise.resolve(linearAnswer({ ok: false, status: 401, json: async () => ({ errors: [{ message: 'lin_api_fixture bad' }] }) })));
    const out = await runCcrcOp(r.deps, WRITE);
    const bad = await runCcrcOp({ ...r.deps, ccrcDir: path.join(mkTmp('ccrc-ccall-'), '.ccrc') }, WRITE);
    expect(out).toEqual({ ok: false, word: 'linear-unauthorised', maybeSent: false });
    expect(bad).toMatchObject({ ok: false, word: 'not-configured' });
    const text = JSON.stringify([out, bad, rows(r.fx), warn.mock.calls, log.mock.calls, err.mock.calls]);
    expect(text).not.toContain('lin_api_fixture');
    expect(text).not.toContain(KEY.slice(8, 24));
  });
});

