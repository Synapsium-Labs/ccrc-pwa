// The claim door (box-token lifecycle spec 4.6) and the rotate route, through
// the real Fastify app. The door is reachable from the internet with no source
// matcher and no per-source budget, so each guard here is a property an attacker
// can probe: a jam must not stall a live code, a code works once, inside its TTL,
// for the node it was bound to, and every answer — Fastify's own 400 and 413
// included — carries `Cache-Control: no-store`. Values and codes below are
// fixtures minted in the test; none is a real token.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { ClaimDoor } from '../src/token/door.js';
import type { TokenRouteDriver } from '../src/token/routes.js';
import { BURNED_CODES_KEPT, BURNED_CODE_KEEP_MS, CLAIM_MISS_BUDGET, MAX_PENDING } from '../src/token/policy.js';
import { CLAIM_BODY_LIMIT_BYTES, TOKEN_CLAIM_PATH, TOKEN_ROTATE_PATH, type BoxTokenView, type RotateAnswer } from '../../shared/box-token.js';
import { CLAIM_CODE_TTL_MS, isClaimCode } from '../../shared/agent-protocol.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE = '0e6a6c2e-3b1f-4c55-9a51-2f0f1c9f7d10';
const OTHER = '9b2d7f7e-1c4a-4e8e-8f00-5d6c7b8a9e01';
const GEN = 'a1b2c3d4e5f60718';
const GEN2 = '0f1e2d3c4b5a6978';
const VALUE = 'c'.repeat(64);
const VALUE2 = 'd'.repeat(64);

const VIEW: BoxTokenView = {
  phase: 'idle', origin: 'minted', currentSeq: 1, currentSince: 0, lastRotationAt: null, rotationOwed: false,
  owedWhy: null, hold: null, holdNode: null, failures: 0, lastFailure: null, banner: false, fleetConfirmed: 'unknown',
  fleetTransport: null, lastSync: null, previousPresented: 0, retiredPresented: 0, retiredRefused: false,
  lastBootRecovery: null, role: 'server', stalled: null, fileProblem: null,   // the last two: A1's plan-assembly fields
};

interface FakeDriver extends TokenRouteDriver {
  commits: { generation: string; at: number }[];
  failCommit: boolean;
  rotateAnswer: RotateAnswer;
  warnings: string[];
}

const fakeDriver = (): FakeDriver => {
  const warnings: string[] = [];
  const values = new Map([[GEN, VALUE], [GEN2, VALUE2]]);
  const d: FakeDriver = {
    door: new ClaimDoor({ valueOf: (g) => values.get(g) ?? null, warn: (l) => warnings.push(l) }),
    commits: [], failCommit: false, warnings,
    rotateAnswer: { ok: true, outcome: 'started', view: VIEW },
    async commitHandOut(generation, at) {
      if (d.failCommit) throw new Error('fsync failed');
      d.commits.push({ generation, at });
    },
    async rotateNow() { return d.rotateAnswer; },
    view: () => VIEW,
  };
  return d;
};

const claim = (app: FastifyInstance, body: unknown) =>
  app.inject({ method: 'POST', url: TOKEN_CLAIM_PATH, payload: body as Record<string, unknown> });

const JUNK = (i: number): string => `junk${String(i).padStart(39, '0')}`;   // 43 chars, a well-shaped miss

describe('POST /api/token/claim', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; vi.restoreAllMocks(); });

  const open = async (driver?: TokenRouteDriver): Promise<FastifyInstance> => {
    app = await buildServer({ ...testDeps(mkTmp('ccrc-claim-')), ...(driver ? { tokenDriver: driver } : {}) });
    return app;
  };

  it('hands the value out once for a live code, persisting the hand-out before the 200', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    expect(isClaimCode(code)).toBe(true);
    const a = await open(d);
    const res = await claim(a, { code, nodeId: NODE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, value: VALUE, generation: GEN });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(d.commits.map((c) => c.generation)).toEqual([GEN]);
  });

  it('single use: the same code again answers 410 code-used and hands nothing out', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    expect((await claim(a, { code, nodeId: NODE })).statusCode).toBe(200);
    const again = await claim(a, { code, nodeId: NODE });
    expect(again.statusCode).toBe(410);
    expect(again.json()).toEqual({ ok: false, error: 'code-used' });
    expect(d.commits).toHaveLength(1);
  });

  it('a replay of a burned code discards nothing: it is counted, never reported as expired or misbound', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    await claim(a, { code, nodeId: NODE });
    for (let i = 0; i < 3; i++) expect((await claim(a, { code, nodeId: NODE })).statusCode).toBe(410);
    expect(d.door.alerts).toEqual({ expired: [], wrongNode: [], replays: 3 });
  });

  it('TTL: a code past CLAIM_CODE_TTL_MS answers 410 code-expired, is burned, and names its generation for discard', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now() - CLAIM_CODE_TTL_MS - 1);
    const a = await open(d);
    const res = await claim(a, { code, nodeId: NODE });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ ok: false, error: 'code-expired' });
    expect(d.door.alerts.expired).toEqual([GEN]);
    expect(d.commits).toEqual([]);
    // Burned: the same code once more is a replay, not a second expiry.
    expect((await claim(a, { code, nodeId: NODE })).json()).toEqual({ ok: false, error: 'code-used' });
    expect(d.door.alerts.expired).toEqual([GEN]);
  });

  it('wrong node: a live code from another node id answers 403, is burned, and the right node cannot use it after', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const res = await claim(a, { code, nodeId: OTHER });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ ok: false, error: 'wrong-node' });
    expect(d.door.alerts.wrongNode).toEqual([GEN]);
    expect((await claim(a, { code, nodeId: NODE })).statusCode).toBe(410);
    expect(d.commits).toEqual([]);
  });

  it('same tick: two claims with the live code give exactly one 200 and one 410 code-used', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const [r1, r2] = await Promise.all([claim(a, { code, nodeId: NODE }), claim(a, { code, nodeId: NODE })]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 410]);
    expect(d.commits).toHaveLength(1);
  });

  it('jam: 1000 junk claims exhaust the miss budget and answer 429, yet the live code still answers 200', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const statuses: number[] = [];
    for (let i = 0; i < 1000; i++) statuses.push((await claim(a, { code: JUNK(i), nodeId: NODE })).statusCode);
    expect(statuses.slice(0, CLAIM_MISS_BUDGET).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(CLAIM_MISS_BUDGET).every((s) => s === 429)).toBe(true);
    const live = await claim(a, { code, nodeId: NODE });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ ok: true, generation: GEN });
    // Miss alerts are capped: one warning inside the minute, carrying a count.
    expect(d.warnings.filter((w) => w.includes('miss'))).toHaveLength(1);
  });

  it('a malformed body is 400 bad-request and charges the miss budget, never burning a live code', async () => {
    const d = fakeDriver();
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    for (const body of [{}, { code }, { code, nodeId: 'NOT-A-NODE' }, { code: 'short', nodeId: NODE }, { code: 7, nodeId: NODE }]) {
      const res = await claim(a, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect((await claim(a, { code, nodeId: NODE })).statusCode).toBe(200);
  });

  it('size: a 2 KiB body answers 413 with the same small body and no-store', async () => {
    const d = fakeDriver();
    d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const res = await a.inject({ method: 'POST', url: TOKEN_CLAIM_PATH, headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ code: 'x'.repeat(2048), nodeId: NODE }) });
    expect(2048).toBeGreaterThan(CLAIM_BODY_LIMIT_BYTES);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it("headers: Fastify's own JSON-parse 400 and media-type refusal are reshaped and carry no-store too", async () => {
    const a = await open(fakeDriver());
    const bad = await a.inject({ method: 'POST', url: TOKEN_CLAIM_PATH,
      headers: { 'content-type': 'application/json' }, payload: '{"code":' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(bad.headers['cache-control']).toBe('no-store');
    const media = await a.inject({ method: 'POST', url: TOKEN_CLAIM_PATH,
      headers: { 'content-type': 'application/x-unknown' }, payload: 'x' });
    expect(media.statusCode).toBe(400);
    expect(media.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(media.headers['cache-control']).toBe('no-store');
  });

  it('headers: every refusal carries no-store and the same small body', async () => {
    const d = fakeDriver();
    const a = await open(d);
    const res = await claim(a, { code: JUNK(1), nodeId: NODE });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'no-claim' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('a hand-out that cannot be recorded answers 503 unavailable and is never handed out (D-4394)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = fakeDriver();
    d.failCommit = true;
    const code = d.door.issue(GEN, NODE, Date.now());
    const a = await open(d);
    const res = await claim(a, { code, nodeId: NODE });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'unavailable' });
    expect(res.body).not.toContain(VALUE);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('with no driver it answers 404 no-claim — the same small body, never "no rotation exists"', async () => {
    const a = await open();
    const res = await claim(a, { code: JUNK(2), nodeId: NODE });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'no-claim' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('ClaimDoor', () => {
  it('keeps only the sha256 of a code: neither the code nor the value is in its state', () => {
    const d = new ClaimDoor({ valueOf: () => VALUE, warn: () => {} });
    const code = d.issue(GEN, NODE, 1_000);
    expect(JSON.stringify(d)).not.toContain(code);
    expect(JSON.stringify(d)).not.toContain(VALUE);
  });

  it('claimNow is ONE synchronous step: it answers a value, not a promise', () => {
    const d = new ClaimDoor({ valueOf: () => VALUE, warn: () => {} });
    const code = d.issue(GEN, NODE, 1_000);
    const step = d.claimNow({ code, nodeId: NODE }, 1_001);
    expect(typeof (step as unknown as { then?: unknown }).then).toBe('undefined');
    expect(step).toEqual({ status: 200, generation: GEN, value: VALUE });
  });

  it(`compares a FIXED ${MAX_PENDING} live + ${BURNED_CODES_KEPT} burned slots on every claim, live, burned or none`, () => {
    // Contract addition (marked): `compare` is injectable for this count only.
    let calls = 0;
    const compare = (a: Buffer, b: Buffer): boolean => { calls++; return timingSafeEqual(a, b); };
    const d = new ClaimDoor({ valueOf: () => VALUE, warn: () => {}, compare });
    const code = d.issue(GEN, NODE, 1_000);
    for (const body of [{ code: JUNK(3), nodeId: NODE }, { code, nodeId: NODE }, { code, nodeId: NODE }]) {
      const before = calls;
      d.claimNow(body, 1_001);
      expect(calls - before).toBe(MAX_PENDING + BURNED_CODES_KEPT);
    }
    // A malformed body never reaches the compare: it is refused on shape alone.
    const before = calls;
    d.claimNow({ code: 'short', nodeId: NODE }, 1_002);
    expect(calls - before).toBe(0);
  });

  it('holds at most two live codes, a re-issue for the same generation replaces its code, and revoke drops one', () => {
    const d = new ClaimDoor({ valueOf: (g) => (g === GEN ? VALUE : VALUE2), warn: () => {} });
    const first = d.issue(GEN, NODE, 1_000);
    const second = d.issue(GEN, NODE, 1_000);
    expect(second).not.toBe(first);
    expect(d.claimNow({ code: first, nodeId: NODE }, 1_001)).toMatchObject({ status: 404 });
    d.issue(GEN2, NODE, 1_000);
    expect(() => d.issue('1122334455667788', NODE, 1_000)).toThrow(RangeError);
    d.revoke(GEN);
    expect(d.claimNow({ code: second, nodeId: NODE }, 1_001)).toMatchObject({ status: 404, error: 'no-claim' });
  });

  it('warns on a miss at most once a minute, with the count, and never prints a code', () => {
    const lines: string[] = [];
    const d = new ClaimDoor({ valueOf: () => VALUE, warn: (l) => lines.push(l) });
    for (let i = 0; i < 5; i++) d.claimNow({ code: JUNK(i), nodeId: NODE }, 1_000 + i);
    expect(lines).toHaveLength(1);
    d.claimNow({ code: JUNK(9), nodeId: NODE }, 1_000 + 60_000);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^ccrc-server: box token: the claim door refused \d+ miss/);
    for (const l of lines) expect(l).not.toContain(JUNK(9));
  });

  it('a burned code ages out by A6\'s keepBurned: after BURNED_CODE_KEEP_MS a replay is a miss, not a code-used', () => {
    const d = new ClaimDoor({ valueOf: () => VALUE, warn: () => {} });
    const code = d.issue(GEN, NODE, 1_000);
    expect(d.claimNow({ code, nodeId: NODE }, 1_001)).toMatchObject({ status: 200 });
    expect(d.claimNow({ code, nodeId: NODE }, 1_002)).toMatchObject({ status: 410, error: 'code-used' });
    expect(d.claimNow({ code, nodeId: NODE }, 1_001 + BURNED_CODE_KEEP_MS)).toMatchObject({ status: 404, error: 'no-claim' });
  });

  it('door.ts spells neither the code TTL nor the burned-code age: both come from policy.ts (D-4405)', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'token', 'door.ts'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/CLAIM_CODE_TTL_MS|BURNED_CODE_KEEP_MS/);
    expect(code).toMatch(/codeExpiresAt\(/);
    expect(code).toMatch(/keepBurned\(/);
  });

  it('door.ts imports no file system: codes live in memory only', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'token', 'door.ts'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/from 'node:fs/);
    expect(code, 'the door awaits: its claim step is no longer one synchronous step').not.toMatch(/\bawait\b|\basync\b/);
  });
});

describe('POST /api/token/rotate (session-only)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('with no driver answers 501 not-configured', async () => {
    app = await buildServer(testDeps(mkTmp('ccrc-rotate-')));
    const res = await app.inject({ method: 'POST', url: TOKEN_ROTATE_PATH });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it.each([
    [{ ok: true, outcome: 'joined', view: VIEW }, 200],
    [{ ok: false, error: 'held', hold: 'update-in-flight', node: 'fleet', view: VIEW }, 409],
    [{ ok: false, error: 'rate-limited', retryAfterS: 42 }, 429],
  ] as [RotateAnswer, number][])('answers the driver\'s %o as %i, body verbatim', async (answer, status) => {
    const d = fakeDriver();
    d.rotateAnswer = answer;
    app = await buildServer({ ...testDeps(mkTmp('ccrc-rotate-')), tokenDriver: d });
    const res = await app.inject({ method: 'POST', url: TOKEN_ROTATE_PATH });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual(answer);
    if (status === 429) expect(res.headers['retry-after']).toBe('42');
  });
});
