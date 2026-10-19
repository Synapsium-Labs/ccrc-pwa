/**
 * The account audit (D-5516; spec §3.6; plan Task A7): the session-only `account_events` table and its one writer.
 *
 *  - `actor` is the session's device label and the first 8 hex characters of its `idHash`, never an IP.
 *  - `act`, `outcome` and `code` are closed vocabularies (`shared/api.ts`); every other field is shape-checked. A
 *    canary written into any field that could carry free text is refused, and no table of coord.db ever holds it.
 *  - Rows older than 365 days are swept; a row of 364 days is kept.
 *  - The step-up limiter's lock writes a `step-up-locked` row (D-5512), through the real server.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { ACCOUNT_AUDIT_RETENTION_DAYS } from '../../shared/api.js';
import { AccountAudit, actorOf, type AccountEventInput } from '../src/accounts/audit.js';
import { createAccountGate } from '../src/accounts/gate.js';
import { measureSecret, sessionVerdict } from '../src/auth/gate.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { SESSION_COOKIE } from '../src/auth/cookie.js';
import { SessionStore, sessionIdHash } from '../src/auth/sessions.js';
import { PasskeyStore } from '../src/auth/credentials.js';
import { createStepUp } from '../src/auth/stepup.js';
import { STEP_UP_MAX_FAILURES } from '../src/auth/ratelimit.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { buildServer, type Deps } from '../src/server.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const DAY_MS = 86_400_000;
const NODE = '0f1e2d3c-4b5a-4968-8776-655443322110';

const openDb = (): DatabaseSync => openCoordDb(path.join(mkTmp('ccrc-account-audit-'), '.ccrc', 'coord.db'));

/** Every value in every row of every table, as one string: what "the table never holds it" is measured on. */
const everyTable = (db: DatabaseSync): string => {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  expect(tables).toContain('account_events');
  return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())).join('\n');
};

const rowsOf = (db: DatabaseSync): Record<string, unknown>[] =>
  db.prepare('SELECT * FROM account_events ORDER BY id').all() as Record<string, unknown>[];

const good = (over: Partial<AccountEventInput> = {}): AccountEventInput => ({
  act: 'check', laneId: 'lane-a', provider: 'anthropic', outcome: 'ok', fleetIdentity: NODE,
  actor: actorOf('a test phone', 'ab'.repeat(32)), ...over,
});

describe('account_events (D-5516)', () => {
  it("a row's actor is a label and 8 hex characters", async () => {
    const home = mkTmp('ccrc-account-actor-');
    const dir = path.join(home, '.ccrc');
    mkdirSync(dir, { recursive: true });
    const secretPath = path.join(dir, 'auth.scrypt');
    writeFileSync(secretPath, `${await hashLine('a test passphrase', FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    const store = new SessionStore(path.join(dir, 'sessions.json'));
    const { token } = await store.create('a test phone', 1, Date.now());
    const stepUp = createStepUp({
      enabled: true, store, passkeys: new PasskeyStore(path.join(dir, 'passkeys.json')),
      secretNow: () => measureSecret(secretPath), rpProblem: () => null, rpId: 'localhost', device: () => null,
    });
    const gate = createAccountGate({
      enabled: true, origin: 'https://box.example.invalid',
      sessionAuth: (req: FastifyRequest) => sessionVerdict(req, { enabled: true, secret: measureSecret(secretPath), store }, Date.now()),
      fleetState: () => ({ ccdVerbs: ['cap-under-test'] }), stepUp,
    });
    const db = openDb();
    const audit = new AccountAudit(db);
    const app = Fastify({ logger: false });
    app.post('/api/accounts/:id/check', async (req, reply) => {
      const ans = gate(req, reply, { cap: 'cap-under-test' });
      if (!ans.pass) return reply;
      expect(audit.write(good({ actor: ans.actor, fleetIdentity: null }))).toMatchObject({ ok: true });
      return { ok: true };
    });
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/api/accounts/lane-a/check', remoteAddress: '203.0.113.9',
      headers: { cookie: `${SESSION_COOKIE}=${token}`, 'user-agent': 'a different agent', 'x-forwarded-for': '198.51.100.4' },
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = rowsOf(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!['actor']).toBe(`a test phone ${sessionIdHash(token).slice(0, 8)}`);
    expect(String(rows[0]!['actor'])).toMatch(/^.+ [0-9a-f]{8}$/);
    expect(everyTable(db)).not.toMatch(/203\.0\.113\.9|198\.51\.100\.4|127\.0\.0\.1/);
    await app.close();
  });

  it('the actor label is bounded and carries no control bytes; an absent device reads as one', () => {
    expect(actorOf(null, 'cd'.repeat(32)).toString()).toBe(`unknown device ${'cd'.repeat(4)}`);
    expect(actorOf('line\none\u0007', 'cd'.repeat(32)).toString()).toBe(`line one ${'cd'.repeat(4)}`);
    expect(actorOf('x'.repeat(500), 'cd'.repeat(32)).toString()).toBe(`${'x'.repeat(64)} ${'cd'.repeat(4)}`);
  });

  it('a canary written through write() in every free-text-shaped field is refused by the types, and the table never holds it', () => {
    const db = openDb();
    const audit = new AccountAudit(db);
    const canary = `CANARY-${process.pid}-${Date.now()} ${'sk-'}${'ant-oat01-'}${'x'.repeat(24)}`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // @ts-expect-error act is a closed vocabulary
      expect(audit.write(good({ act: canary }))).toEqual({ ok: false, why: 'act' });
      // @ts-expect-error outcome is a closed vocabulary
      expect(audit.write(good({ outcome: canary }))).toEqual({ ok: false, why: 'outcome' });
      // @ts-expect-error code is a closed vocabulary
      expect(audit.write(good({ outcome: 'refused', code: canary }))).toEqual({ ok: false, why: 'code' });
      // @ts-expect-error provider is a closed vocabulary
      expect(audit.write(good({ provider: canary }))).toEqual({ ok: false, why: 'provider' });
      // @ts-expect-error method is a closed vocabulary
      expect(audit.write(good({ method: canary }))).toEqual({ ok: false, why: 'method' });
      // @ts-expect-error the actor is only ever minted by actorOf
      expect(audit.write(good({ actor: canary }))).toEqual({ ok: false, why: 'actor' });
      // A look-alike object is not an actor either: only `actorOf` mints one.
      expect(audit.write(good({ actor: { label: canary, idHash8: 'abababab' } as never }))).toEqual({ ok: false, why: 'actor' });
      // The shaped strings: a lane id, a node id and a minted key's name each have one grammar.
      expect(audit.write(good({ laneId: canary }))).toEqual({ ok: false, why: 'lane' });
      expect(audit.write(good({ laneId: 'x'.repeat(65) }))).toEqual({ ok: false, why: 'lane' });
      expect(audit.write(good({ fleetIdentity: canary }))).toEqual({ ok: false, why: 'fleet-identity' });
      expect(audit.write(good({ act: 'retire-key', provider: 'openrouter', keyName: canary }))).toEqual({ ok: false, why: 'key-name' });
      expect(audit.write(good({ act: 'retire-key', provider: 'openrouter', keyName: `ccrc lane-d 2026-10-18 ${canary}` })))
        .toEqual({ ok: false, why: 'key-name' });
      // A lane act needs its lane; only the laneless acts write none.
      expect(audit.write(good({ laneId: null }))).toEqual({ ok: false, why: 'lane' });
      // A refusal code rides only a refused or failed row.
      expect(audit.write(good({ code: 'unsupported' }))).toEqual({ ok: false, why: 'code' });
      // And a whole row of good values writes, with a minted key's NAME the one free-standing string allowed.
      expect(audit.write(good())).toMatchObject({ ok: true });
      expect(audit.write(good({ act: 'retire-key', provider: 'openrouter', keyName: 'ccrc lane-d 2026-10-18' }))).toMatchObject({ ok: true });
      expect(audit.write(good({ act: 'step-up-locked', laneId: null, provider: null, outcome: 'refused', code: 'step-up-locked' })))
        .toMatchObject({ ok: true });
      expect(audit.write(good({ act: 'add', method: 'setup-token', outcome: 'refused', code: 'insecure-origin' }))).toMatchObject({ ok: true });
      expect(audit.write(good({ act: 'remove', outcome: 'failed', code: 'provider-delete-failed' }))).toMatchObject({ ok: true });
      expect(rowsOf(db)).toHaveLength(5);
      const all = everyTable(db);
      expect(all).not.toContain('CANARY-');
      expect(all).not.toContain('ant-oat01');
    } finally { warn.mockRestore(); }
  });

  it('rows older than 365 days are swept, a row of 364 days is kept', () => {
    expect(ACCOUNT_AUDIT_RETENTION_DAYS).toBe(365);
    const db = openDb();
    const now = 1_900_000_000_000;
    let clock = now;
    const audit = new AccountAudit(db, () => clock);
    for (const [days, lane] of [[366, 'lane-a'], [365.5, 'lane-b'], [364, 'lane-c'], [36, 'lane-d'], [0, 'lane-e']] as const) {
      clock = now - days * DAY_MS;
      expect(audit.write(good({ laneId: lane }))).toMatchObject({ ok: true });
    }
    expect(audit.sweep(now)).toBe(2);
    expect(rowsOf(db).map((r) => r['laneId'])).toEqual(['lane-c', 'lane-d', 'lane-e']);
    expect(audit.sweep(now)).toBe(0);
  });

  it('a step-up-locked row is written when the limiter locks', async () => {
    const home = mkTmp('ccrc-account-locked-');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const passphrase = 'correct horse battery staple';
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(passphrase, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });
    const deps: Deps = {
      ...base, coord, accountAudit: new AccountAudit(coord.db), spawnPty: stubPty,
      cfg: { ...base.cfg, authEnabled: true, cookieSecure: false, rpId: 'localhost', origin: 'http://localhost:7788' },
    };
    const app = await buildServer(deps);
    await app.ready();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const login = await app.inject({
        method: 'POST', url: '/api/auth/login', payload: { passphrase }, headers: { 'user-agent': 'a test phone' },
      });
      expect(login.statusCode, login.body).toBe(204);
      const set = login.headers['set-cookie'];
      const line = Array.isArray(set) ? set[0]! : String(set);
      const cookie = line.slice(0, line.indexOf(';'));
      const idHash = sessionIdHash(cookie.slice(cookie.indexOf('=') + 1));
      const attempt = () => app.inject({
        method: 'POST', url: '/api/auth/step-up/passphrase',
        headers: { cookie, origin: 'http://localhost:7788' }, payload: { passphrase: 'wrong' },
      });
      for (let i = 0; i < STEP_UP_MAX_FAILURES - 1; i++) await attempt();
      expect(rowsOf(coord.db)).toEqual([]);
      await attempt();
      const rows = rowsOf(coord.db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        act: 'step-up-locked', laneId: null, provider: null, method: null, outcome: 'refused', code: 'step-up-locked',
        actor: `a test phone ${idHash.slice(0, 8)}`,
      });
      // Locked: a further attempt is refused before any count, and writes no second row.
      await attempt();
      expect(rowsOf(coord.db)).toHaveLength(1);
    } finally { warn.mockRestore(); await app.close(); }
  });
});
