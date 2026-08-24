// Wave 7's cross-cutting suite: the 409 envelope is not decoration — this
// file POSTS it. D12's bargain with D10 ("the idle gate is untouched") only
// holds because a loser learns synchronously and is handed an address; Wave
// 0's quotas are what make that address safe to hand out. Plus the auth-arm
// matrix and the ClaimRefuseCode producer direction.
//
// The landed hint shape (claims.ts `claimMailHint`, plan governance: the
// defining task's landed spelling wins) is `{toId, subject} | null` — no
// `send`/`escalate` wrapper and no `kind`: the SENDER chooses the kind when
// it posts, and the subject spelling is `claim conflict: <path>`. The
// interplay the plan pinned is unchanged: the hint's subject is STABLE, so a
// twice-lost race re-sends the same subject and Wave 0's outstanding
// (fromId,toId,subject) guard answers 409 duplicate by design.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { CLAIM_REFUSE_CODES, PEER_MAIL_MAX_OUTSTANDING } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const A = { byId: 'demo-quiet-mesa', byUuid: UUID_A };
const B = { byId: 'demo-still-pond', byUuid: UUID_B };

const seed = (home: string, id: string, uuid: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const tmuxRunner = (): Runner => async (_cmd, args) => {
  if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
  if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
  if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

const openApp = async (over: Partial<Deps> = {}) => {
  const home = mkTmp('ccrc-envelope-');
  seed(home, A.byId, UUID_A);
  seed(home, B.byId, UUID_B);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, tmuxRunner()), mailToken: TOKEN, coord, ...over });
  return { app, coord, home };
};

/** The landed `ClaimConflict['mailHint']` — null exactly when the holder
 *  measured `no:<reason>` (escalate to the operator, never a silent send). */
type Hint = { toId: string; subject: string } | null;

describe('the 409 is an address, and Wave 0 makes it safe to use', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const conflictHint = async (app: FastifyInstance): Promise<Hint> => {
    const won = await app.inject({ method: 'POST', url: '/api/claims', headers: tok,
      payload: { ...A, project: 'demo', paths: ['shared/api.ts'], intent: 'rewiring' } });
    expect(won.statusCode).toBe(200);
    const lost = await app.inject({ method: 'POST', url: '/api/claims', headers: tok,
      payload: { ...B, project: 'demo', paths: ['shared/api.ts'], intent: 'me too' } });
    expect(lost.statusCode).toBe(409);
    return (lost.json() as { conflicts: { mailHint: Hint }[] }).conflicts[0]!.mailHint;
  };

  it('the hint POSTS as-is (202), and a re-send of the SAME hint is Wave 0\'s duplicate, not spam', async () => {
    const w = await openApp(); app = w.app;
    const hint = await conflictHint(app);
    expect(hint).toEqual({ toId: A.byId, subject: 'claim conflict: shared/api.ts' });

    const mail = { fromId: B.byId, fromUuid: UUID_B, toId: hint!.toId,
      kind: 'question', subject: hint!.subject,
      body: 'I need shared/api.ts for the roster wire — how far are you?', artifacts: [] };
    const first = await app.inject({ method: 'POST', url: '/api/mail', headers: tok, payload: mail });
    expect(first.statusCode).toBe(202);

    // Losing the race twice produces the SAME subject — Wave 0's outstanding
    // (fromId,toId,subject) guard answers 409 duplicate. The hint's stable
    // subject is DESIGNED to hit this guard: that is the interplay.
    const again = await app.inject({ method: 'POST', url: '/api/mail', headers: tok, payload: mail });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ ok: false, error: 'duplicate' });
  });

  it('the per-pair outstanding quota still bounds a chatty loser — 429 peer-quota past the cap', async () => {
    const w = await openApp(); app = w.app;
    await conflictHint(app);
    const mail = (subject: string) => ({ fromId: B.byId, fromUuid: UUID_B, toId: A.byId,
      kind: 'question', subject, body: 'x', artifacts: [] });
    for (let i = 0; i < PEER_MAIL_MAX_OUTSTANDING; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/mail', headers: tok,
        payload: mail(`claim conflict: file-${i}`) });
      expect(res.statusCode, `send ${i}`).toBe(202);
    }
    const over = await app.inject({ method: 'POST', url: '/api/mail', headers: tok,
      payload: mail('claim conflict: one-more') });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ ok: false, error: 'peer-quota' });
  });
});

describe('the auth arms, all three surfaces', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const armedApp = async () => {
    const home = mkTmp('ccrc-envelope-');
    seed(home, A.byId, UUID_A);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    const base = testDeps(home, tmuxRunner());
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    return buildServer({ ...base, cfg: { ...base.cfg, authEnabled: true },
      mailToken: TOKEN, coord });
  };

  const login = async (app: FastifyInstance): Promise<string> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { passphrase: PASSPHRASE } });
    expect(res.statusCode, res.body).toBe(204);
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    return line.slice(0, line.indexOf(';'));
  };

  it.each([
    ['GET', '/api/peers?project=demo'],
    ['GET', '/api/claims?project=demo'],
  ] as const)('%s %s: armed takes EITHER credential, never neither', async (method, url) => {
    app = await armedApp();
    const anon = await app.inject({ method, url });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ verdict: 'no-session' });
    expect((await app.inject({ method, url, headers: tok })).statusCode).toBe(200);
    const cookie = await login(app);
    expect((await app.inject({ method, url, headers: { cookie } })).statusCode).toBe(200);
  });

  it('the box-token lanes refuse anon with a BARE 401 — no verdict, the /api/mail shape', async () => {
    app = await armedApp();
    const res = await app.inject({ method: 'GET', url: '/api/ledger?project=demo' });
    // The session gate exempts it; requireMailToken refuses it. A verdict here
    // would raise the PWA's login screen for a machine lane.
    expect(res.statusCode).toBe(401);
    expect((res.json() as { verdict?: unknown }).verdict).toBeUndefined();
  });

  it('break sits behind the SESSION gate when armed — the operator door is the phone\'s, not the fleet\'s', async () => {
    app = await armedApp();
    const anon = await app.inject({ method: 'POST', url: '/api/claims/1/break', payload: {} });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ verdict: 'no-session' });   // the GATE's refusal
    const cookie = await login(app);
    const opened = await app.inject({ method: 'POST', url: '/api/claims/1/break',
      headers: { cookie }, payload: {} });
    expect(opened.statusCode).toBe(404);   // through the gate; no such claim
  });
});

describe('ClaimRefuseCode, producer direction', () => {
  it('every declared code has a producer in coord/routes.ts (both directions with the scanner)', () => {
    // The scanner in mail-routes.test.ts holds tokens -> declared; this holds
    // declared -> produced, so the union cannot grow a member no route sends.
    const src = readFileSync(path.resolve(here, '..', 'src', 'coord', 'routes.ts'), 'utf8');
    for (const code of CLAIM_REFUSE_CODES) {
      expect(src, `${code} has no producer in coord/routes.ts`).toContain(`'${code}'`);
    }
  });
});
