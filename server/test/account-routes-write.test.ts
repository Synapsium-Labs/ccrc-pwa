// The write routes, step-up enforced (spec §3.2, §3.3, §11, §13.1; D-5511, D-5512, D-5513, D-5516; accounts plan Task
// A17, D-7738, D-7739). Each route runs on the real server, through the real account gate and step-up, the real
// reconciling wrapper (whose reload is the real `reloadRoster`) and the real local `AccountOps` arm, over a stub `ccrc`
// launcher at `<home>/.local/bin/ccrc` that records its argv to `<home>/argv.log` and its stdin to
// `<home>/stdin-<sub>`, and answers what `<home>/stub/<sub>.{out,code,sleep}` say. A recorder outside the wrapper says
// whether the route called the op at all. No fixture value is real-shaped: the secrets are fixed canaries.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type {
  AccountAddAnswer, AccountRemoveAnswer, AccountRemoveCheckAnswer, AccountSub, AccountsResponse,
} from '../../shared/api.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { buildServer, type Deps } from '../src/server.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { actorOf, type AccountAudit, type AccountEventInput } from '../src/accounts/audit.js';
import { localAccountOps, type AccountOps } from '../src/accounts/ops.js';
import { reconcilingAccountOps } from '../src/accounts/reconcile.js';
import { discardVerdictOf, removeCheckOf, removedLedgerOf, routeOutcomeOf } from '../src/accounts/routes.js';
import { maskHeld } from '../src/accounts/egress.js';
import { reloadRoster, rosterAnswerOf } from '../src/config.js';
import { fingerprintAnswerOf } from '../src/accounts/mask.js';
import { MAIL_TOKEN_HEADER } from '../src/coord/token.js';
import type { FleetIdentityCell } from '../src/fleetidentity.js';
import type { FleetState } from '../src/fleetstate.js';
import type { PtyLike } from '../src/pty.js';
import { SECRET_MASK } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { HAVE_FLOCK, answer as verbAnswer, ccrcRun, laneBox } from './laneStateFixture.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const BOX_TOKEN = 'box-token-for-the-account-write-routes-suite';
const NODE = '0a17a17a-0000-4000-8000-00000000a17a';
const LANE = 'claude-a';
const NEW = 'lane-n';
/** Fixed, non-secret stand-ins for a pasted token. None is real-shaped, and none has a credential shape at all. */
const SECRET = 'PASTE-a17-route-not-a-real-token-0001';
const SECRET_B64 = Buffer.from(SECRET, 'utf8').toString('base64');
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

/** The stub launcher: argv to a log, stdin to a file per sub, then its control files' sleep, output and exit. */
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/argv.log"
cat > "$HOME/stdin-$2"
d="$HOME/stub"
[ -f "$d/$2.sleep" ] && sleep "$(cat "$d/$2.sleep")"
[ -f "$d/$2.out" ] && cat "$d/$2.out"
if [ -f "$d/$2.code" ]; then exit "$(cat "$d/$2.code")"; fi
exit 0
`;

interface Rig {
  app: FastifyInstance; home: string; rows: AccountEventInput[]; calls: AccountSub[];
  argv: () => string[]; stub: (sub: string, o: { out?: unknown; code?: number; sleep?: number }) => void;
  roster: () => { version: number; accounts: Record<string, unknown>[] };
}

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

async function openApp(o: { enabled?: boolean; origin?: string; caps?: string[]; addTimeoutMs?: number } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-account-write-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'ccrc'), STUB);
  chmodSync(path.join(bin, 'ccrc'), 0o755);
  mkdirSync(path.join(home, 'stub'), { recursive: true });
  mkdirSync(path.join(home, '.cc-sessions', '.accounts'), { recursive: true, mode: 0o700 });
  const rows: AccountEventInput[] = [];
  const audit = { write: (e: AccountEventInput) => { rows.push(e); return { ok: true, id: rows.length }; } } as unknown as AccountAudit;
  const cfg = { ...base.cfg, authEnabled: o.enabled ?? true, cookieSecure: false, rpId: 'localhost', origin: o.origin ?? 'http://localhost:7788' };
  const inner = localAccountOps({ home, killGraceMs: 100, timeoutMs: (sub) => (sub === 'add' ? o.addTimeoutMs ?? 10_000 : 10_000) });
  const wrapped = reconcilingAccountOps(inner, {
    reload: (stdout) => {
      const a = rosterAnswerOf(stdout, fingerprintAnswerOf);
      return a === null ? null : reloadRoster(cfg, a, { fleetIdentity: () => NODE });
    },
    audit, fleetIdentity: () => NODE, actor: actorOf('ccrc server', ''),
  });
  const calls: AccountSub[] = [];
  const accountOps: AccountOps = { arm: wrapped.arm, run: (sub, ...rest) => { calls.push(sub); return wrapped.run(sub, ...rest); } };
  const deps: Deps = {
    ...base, cfg, mailToken: BOX_TOKEN, spawnPty: stubPty,
    fleetState: { ccdVerbs: o.caps ?? ['account-v2'] } as unknown as FleetState,
    fleetIdentity: { current: () => ({ kind: 'known', connectionEpoch: 1, nodeId: NODE, measuredAt: 0 }) } as unknown as FleetIdentityCell,
    accountOps, accountAudit: audit,
  };
  const a = await buildServer(deps);
  await a.ready();
  app = a;
  const log = path.join(home, 'argv.log');
  const rosterFile = path.join(home, '.ccrc', 'accounts.json');
  return {
    app: a, home, rows, calls,
    argv: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []),
    stub: (sub, s) => {
      const d = path.join(home, 'stub');
      if (s.out !== undefined) writeFileSync(path.join(d, `${sub}.out`), typeof s.out === 'string' ? s.out : JSON.stringify(s.out));
      if (s.code !== undefined) writeFileSync(path.join(d, `${sub}.code`), String(s.code));
      if (s.sleep !== undefined) writeFileSync(path.join(d, `${sub}.sleep`), String(s.sleep));
    },
    roster: () => JSON.parse(readFileSync(rosterFile, 'utf8')) as { version: number; accounts: Record<string, unknown>[] },
  };
}

/** The roster with lane `NEW` added, as the box's `added` answer would carry it. */
const withNew = (r: Rig, label = 'lane·n'): { version: number; accounts: Record<string, unknown>[] } => {
  const roster = r.roster();
  return {
    ...roster,
    accounts: [...roster.accounts, {
      id: NEW, label, configDirSuffix: `.claude-${NEW}`,
      exec: { kind: 'generated', secretsFile: `.cc-secrets/${NEW}-oauth.env` }, homeAble: true, hue: 'amber', telemetry: 'anthropic',
    }],
  };
};

const login = async (a: FastifyInstance): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};
const stepUp = async (a: FastifyInstance, cookie: string): Promise<void> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/step-up/passphrase', headers: { cookie }, payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(200);
};
/** A session that has stepped up. */
const fresh = async (a: FastifyInstance): Promise<string> => { const c = await login(a); await stepUp(a, c); return c; };

const post = (r: Rig, url: string, payload: unknown, cookie?: string, extra: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'POST', url, payload: payload as object, headers: { ...(cookie ? { cookie } : {}), ...extra } });

const ADD_BODY = { provider: 'anthropic', id: NEW, label: 'lane·n', hue: 'amber', method: 'paste', credential: SECRET };

/** Every write route, with a body it would act on, and whether it asks for a step-up. */
const ROUTES = [
  { name: 'add', url: '/api/accounts', body: ADD_BODY, stepUp: true, cap: true },
  { name: 'credential', url: `/api/accounts/${LANE}/credential`, body: { credential: SECRET }, stepUp: true, cap: true },
  { name: 'set', url: `/api/accounts/${LANE}/set`, body: { placement: 'overflow' }, stepUp: false, cap: true },
  { name: 'remove', url: `/api/accounts/${LANE}/remove`, body: { mode: 'remove', confirmId: LANE }, stepUp: true, cap: true },
  { name: 'discard', url: `/api/accounts/${LANE}/remove`, body: { mode: 'discard' }, stepUp: true, cap: true },
  { name: 'remove check', url: `/api/accounts/${LANE}/remove`, body: { mode: 'check' }, stepUp: false, cap: true },
  { name: 'revoke-ack', url: '/api/accounts/revoke-ack', body: { laneId: LANE, kind: 'anthropic-token' }, stepUp: false, cap: false },
] as const;

/** A lane the box recorded as added and never switched on, held off by its marker: discardable. */
const plantDiscardable = (r: Rig, id = LANE, extra: Record<string, unknown> = {}): void => {
  writeFileSync(path.join(r.home, '.cc-sessions', '.accounts', `${id}.json`),
    JSON.stringify({ addedAt: iso(Date.now() - 60_000), check: { verdict: 'ok', at: iso(Date.now() - 30_000) }, ...extra }));
  writeFileSync(path.join(r.home, '.cc-sessions', `${id}-disabled`), '');
};
/** A registry row whose `wrapper` names lane `id`. */
const plantSession = (r: Rig, sid: string, id = LANE): void => {
  const reg = path.join(r.home, '.cc-sessions');
  const fields = { wrapper: id, project: 'demo', workdir: '/data/projects/demo', uuid: 'a'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${sid}.${k}`), v);
};

const REMOVED_ANSWER = (r: Rig, id = LANE) => ({
  ok: true, id, roster: { ...r.roster(), accounts: r.roster().accounts.filter((a) => a['id'] !== id) }, fleetIdentity: NODE,
  rehomed: [], kept: ['the config dir and transcripts'], removed: ['the roster entry', 'the token file'],
  'operator-steps': [], atProvider: [{ kind: 'anthropic-token', state: 'still-valid', revokeAt: 'claude-code-settings' }],
});

describe('every write route takes the account gate first (D-5511, D-5512)', () => {
  it.each(ROUTES)('$name refuses a box token, and runs nothing', async (route) => {
    const r = await openApp();
    const res = await post(r, route.url, route.body, undefined, { [MAIL_TOKEN_HEADER]: BOX_TOKEN });
    expect(res.statusCode).toBe(401);
    expect(r.calls).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  it.each(ROUTES)('$name refuses a dark gate with auth-off, no-store, and runs nothing', async (route) => {
    const r = await openApp({ enabled: false });
    const res = await post(r, route.url, route.body);
    expect(res.statusCode).toBe(REFUSAL_STATUS['auth-off']);
    expect(res.json()).toMatchObject({ ok: false, error: 'auth-off' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(r.calls).toEqual([]);
  });

  it.each(ROUTES)('$name refuses an insecure origin, and runs nothing', async (route) => {
    const r = await openApp({ origin: 'http://ccrc.example.invalid:7788' });
    const cookie = await login(r.app);
    const res = await post(r, route.url, route.body, cookie);
    expect(res.json()).toMatchObject({ ok: false, error: 'insecure-origin' });
    expect(r.calls).toEqual([]);
  });

  it.each(ROUTES.filter((x) => x.cap))('$name refuses a fleet that does not advertise account-v2, and runs nothing', async (route) => {
    const r = await openApp({ caps: ['account-v1'] });
    const cookie = await fresh(r.app);
    const res = await post(r, route.url, route.body, cookie);
    expect(res.json()).toMatchObject({ ok: false, error: 'unsupported' });
    expect(r.calls).toEqual([]);
  });

  it.each(ROUTES.filter((x) => x.stepUp))('$name refuses a stale step-up, and runs nothing and writes no row', async (route) => {
    const r = await openApp();
    plantDiscardable(r);
    // Signed in, never stepped up on this session; and a step-up on ANOTHER session counts for nothing here.
    const cookie = await login(r.app);
    await fresh(r.app);
    const res = await post(r, route.url, route.body, cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['step-up-required']);
    expect(res.json()).toMatchObject({ ok: false, error: 'step-up-required' });
    expect(r.calls).toEqual([]);
    expect(r.argv()).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  it.each(ROUTES.filter((x) => !x.stepUp))('$name asks no step-up of a signed-in session', async (route) => {
    const r = await openApp();
    r.stub('remove', { out: { ok: true, id: LANE, dryRun: true, live: 0, sleeping: [], archived: 0, upstream: false, otherHomeAble: 1,
      authInProgress: false, discardable: false, at: iso(Date.now()), fleetIdentity: NODE } });
    r.stub('set', { out: { ok: true, roster: r.roster(), fleetIdentity: NODE } });
    const cookie = await login(r.app);
    const res = await post(r, route.url, route.body, cookie);
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('the secret: checked at the route, held for the request, never answered (spec §3.3, D-5513)', () => {
  const HOSTILE = (tmp: string): string[] => [`"\noutput = ${tmp}/pwned`, `${SECRET}\u0000x`, `${SECRET}\r`, `${SECRET}\u007f`, 'x'.repeat(8193), ''];

  it('a hostile key refuses key-charset at the route: no op is called, no file appears, and the row says so', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    for (const hostile of HOSTILE(r.home)) {
      for (const [url, body] of [['/api/accounts', { ...ADD_BODY, credential: hostile }], [`/api/accounts/${LANE}/credential`, { credential: hostile }]] as const) {
        const res = await post(r, url, body, cookie);
        expect(res.statusCode, `${JSON.stringify(hostile.slice(0, 30))} at ${url}`).toBe(REFUSAL_STATUS['key-charset']);
        expect(res.json()).toEqual({ ok: false, error: 'key-charset' });
      }
    }
    expect(r.calls, 'the route called the op with a hostile secret').toEqual([]);
    expect(existsSync(path.join(r.home, 'pwned'))).toBe(false);
    expect(r.rows.map((x) => [x.act, x.outcome, x.code])).toEqual(
      HOSTILE(r.home).flatMap(() => [['add', 'refused', 'key-charset'], ['credential', 'refused', 'key-charset']]));
  });

  it('a hostile key refuses key-charset at the verb too, with the route bypassed (the real `ccrc account add`)', (ctx) => {
    if (!HAVE_FLOCK) ctx.skip();
    const home = laneBox('ccrc-account-write-verb-');
    const pwned = path.join(home, 'pwned');
    const v = ccrcRun(home, ['account', 'add', '--id', 'lane-p', '--provider', 'anthropic', '--method', 'paste', '--label', 'lane·p',
      '--hue', 'amber', '--credential', '-'], `"\noutput = ${pwned}`);
    expect(v.code, v.stderr).toBe(2);
    expect(verbAnswer(v)['error']).toBe('key-charset');
    expect(existsSync(pwned)).toBe(false);
    expect(existsSync(path.join(home, '.cc-secrets', 'lane-p-oauth.env'))).toBe(false);
  }, 60_000);

  it('a failed validation answers the code and an empty field, never the value', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('add', { out: { ok: false, error: 'key-rejected', detail: `the token ${SECRET} was refused (HTTP 401)`, echo: SECRET_B64 }, code: 1 });
    r.stub('roster', { out: { ok: true, roster: r.roster(), fleetIdentity: NODE } });
    const res = await post(r, '/api/accounts', ADD_BODY, cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['key-rejected']);
    expect(res.json()).toEqual({ ok: false, error: 'key-rejected' });
    expect(res.body).not.toContain(SECRET);
    expect(res.body).not.toContain(SECRET_B64);
    // The secret rode stdin, never argv.
    expect(r.argv()[0]).toBe(`account add --id=${NEW} --provider=anthropic --method=paste --label=lane·n --hue=amber --credential=-`);
    expect(readFileSync(path.join(r.home, `stdin-add`), 'utf8')).toBe(SECRET);
    for (const line of r.argv()) expect(line).not.toContain(SECRET);
    // An unreachable provider is its own word, and the credential route reads the same.
    r.stub('credential', { out: { ok: false, error: 'token-unverified', detail: SECRET }, code: 1 });
    const cred = await post(r, `/api/accounts/${LANE}/credential`, { credential: SECRET }, cookie);
    expect(cred.json()).toEqual({ ok: false, error: 'token-unverified' });
    expect(cred.statusCode).toBe(REFUSAL_STATUS['token-unverified']);
  });

  it('a success answer masks the held secret by its exact bytes and its base64, even where no shape or fingerprint could', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    // A box that echoes the secret into the new lane's label: the route's own mask is the last word.
    r.stub('add', { out: { ok: true, id: NEW, roster: withNew(r, SECRET.slice(0, 40)), fleetIdentity: NODE } });
    const res = await post(r, '/api/accounts', { ...ADD_BODY, credential: SECRET.slice(0, 40) }, cookie);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as AccountAddAnswer;
    expect(res.body).not.toContain(SECRET.slice(0, 40));
    expect(body.roster.find((x) => x.id === NEW)?.label).toBe(SECRET_MASK);
    expect(body.lane).toBeDefined();
    expect(body.fleetIdentity).toBe(NODE);
    expect(body).not.toHaveProperty('credential');
    expect(maskHeld({ a: [`x${SECRET_B64}y`, SECRET_B64.replace(/=+$/, '')] }, [SECRET])).toEqual({ a: [`x${SECRET_MASK}y`, SECRET_MASK] });
  });
});

describe('add: outcome unknown is never retried (spec §3.9, §6.2; D-5518)', () => {
  it('an add that times out answers outcome unknown, reconciles, and a retry finds the lane rather than duplicate-id', async () => {
    const r = await openApp({ addTimeoutMs: 2_000 });
    const cookie = await fresh(r.app);
    r.stub('add', { sleep: 8 });
    // The box added the lane before the sub's bound ran out: the reconcile's roster carries it.
    r.stub('roster', { out: { ok: true, roster: withNew(r), fleetIdentity: NODE } });
    const res = await post(r, '/api/accounts', ADD_BODY, cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['outcome-unknown']);
    expect(res.json()).toEqual({ ok: false, error: 'outcome-unknown' });
    expect(r.argv().map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['account add', 'account roster']);
    expect(r.rows.map((x) => [x.act, x.outcome])).toEqual([['reconcile', 'ok'], ['add', 'unknown']]);
    // The screen re-reads, and the lane is there.
    const accounts = (await r.app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } })).json() as AccountsResponse;
    expect(accounts.roster.map((x) => x.id)).toContain(NEW);
    // The operator's retry: the server's roster holds the id, so it answers the lane, and the verb is never asked.
    r.stub('add', { out: { ok: false, error: 'duplicate-id', detail: 'x' }, code: 1 });
    const again = await post(r, '/api/accounts', ADD_BODY, cookie);
    expect(again.statusCode).toBe(REFUSAL_STATUS['lane-exists']);
    expect(again.json()).toMatchObject({ ok: false, error: 'lane-exists', lane: { ready: false } });
    expect(again.body).not.toContain('duplicate-id');
    expect(r.argv().filter((l) => l.startsWith('account add'))).toHaveLength(1);
  }, 30_000);

  it('a good add answers the roster, the lane and the node, and chains reloadRoster', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('add', { out: { ok: true, id: NEW, roster: withNew(r), fleetIdentity: NODE } });
    const res = await post(r, '/api/accounts', { ...ADD_BODY, placement: 'overflow', adopt: true }, cookie);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as AccountAddAnswer;
    expect(body.roster.map((x) => x.id)).toContain(NEW);
    expect(body.lane.ready).toBe(false);
    expect(r.argv()).toEqual([`account add --id=${NEW} --provider=anthropic --method=paste --label=lane·n --hue=amber --placement=overflow --adopt --credential=-`]);
    expect(r.rows).toEqual([expect.objectContaining({ act: 'add', laneId: NEW, provider: 'anthropic', method: 'paste', outcome: 'ok' })]);
    // A later wave's field is a bad request here, and runs nothing.
    const later = await post(r, '/api/accounts', { ...ADD_BODY, id: 'lane-q', limit: '20' }, cookie);
    expect(later.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(r.argv()).toHaveLength(1);
  });

  it('the verb\'s refusals cross as words: config-dir-exists says only whether the dir is signed in', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('roster', { out: { ok: true, roster: r.roster(), fleetIdentity: NODE } });
    r.stub('add', { out: { ok: false, error: 'config-dir-exists', detail: '/a/path', found: { signedIn: true, identity: 'someone@example.invalid' } }, code: 1 });
    const res = await post(r, '/api/accounts', ADD_BODY, cookie);
    expect(res.json()).toEqual({ ok: false, error: 'config-dir-exists', signedIn: true });
    expect(res.body).not.toContain('example.invalid');
  });
});

describe('remove, discard and the pre-check (spec §11)', () => {
  it('remove\'s typed confirm must equal the id (confirm-mismatch), and nothing runs', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    const res = await post(r, `/api/accounts/${LANE}/remove`, { mode: 'remove', confirmId: 'claude-b' }, cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['confirm-mismatch']);
    expect(res.json()).toEqual({ ok: false, error: 'confirm-mismatch' });
    expect(r.calls).toEqual([]);
    expect(r.rows.map((x) => [x.act, x.outcome, x.code])).toEqual([['remove', 'refused', 'confirm-mismatch']]);
    // The right id runs the verb in remove mode and answers its ledger.
    r.stub('remove', { out: REMOVED_ANSWER(r) });
    const ok = await post(r, `/api/accounts/${LANE}/remove`, { mode: 'remove', confirmId: LANE }, cookie);
    expect(ok.statusCode, ok.body).toBe(200);
    const body = ok.json() as AccountRemoveAnswer;
    expect(body.roster.map((x) => x.id)).not.toContain(LANE);
    expect(body.atProvider).toEqual([{ kind: 'anthropic-token', state: 'still-valid', revokeAt: 'claude-code-settings' }]);
    expect(body.removed).toEqual(['the roster entry', 'the token file']);
    expect(r.argv()).toEqual([`account remove --id=${LANE} --mode=remove`]);
  });

  it('remove\'s census refusals name the session ids, never the sentence', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('roster', { out: { ok: true, roster: r.roster(), fleetIdentity: NODE } });
    r.stub('remove', { out: { ok: false, error: 'sleeping-sessions', detail: 'lane has 1 sleeping session', sleeping: ['claude-a-demo', '../x'] }, code: 1 });
    const res = await post(r, `/api/accounts/${LANE}/remove`, { mode: 'remove', confirmId: LANE }, cookie);
    expect(res.json()).toEqual({ ok: false, error: 'sleeping-sessions', sessions: ['claude-a-demo'] });
    r.stub('remove', { out: { ok: false, error: 'live-sessions', detail: 'x', live: ['claude-a-one'] }, code: 1 });
    expect((await post(r, `/api/accounts/${LANE}/remove`, { mode: 'remove', confirmId: LANE }, cookie)).json())
      .toEqual({ ok: false, error: 'live-sessions', sessions: ['claude-a-one'] });
  });

  it('discard needs no typed confirm and still needs step-up', async () => {
    const r = await openApp();
    plantDiscardable(r);
    const stale = await login(r.app);
    expect((await post(r, `/api/accounts/${LANE}/remove`, { mode: 'discard' }, stale)).json()).toMatchObject({ error: 'step-up-required' });
    expect(r.calls).toEqual([]);
    const cookie = await fresh(r.app);
    // A typed confirm is not a discard's field.
    expect((await post(r, `/api/accounts/${LANE}/remove`, { mode: 'discard', confirmId: LANE }, cookie)).json())
      .toEqual({ ok: false, error: 'bad-request' });
    r.stub('remove', { out: REMOVED_ANSWER(r) });
    const res = await post(r, `/api/accounts/${LANE}/remove`, { mode: 'discard' }, cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(r.argv()).toEqual([`account remove --id=${LANE} --mode=discard`]);
    expect(r.rows.map((x) => [x.act, x.outcome])).toEqual([['discard', 'ok']]);
    // The answer's roster was taken: the lane is gone from the server's roster too.
    expect((res.json() as AccountRemoveAnswer).roster.map((x) => x.id)).not.toContain(LANE);
    expect((await post(r, `/api/accounts/${LANE}/remove`, { mode: 'discard' }, cookie)).json()).toEqual({ ok: false, error: 'not-found' });
  });

  it('with the verb stubbed to accept anything, the route still refuses not-discardable for an ever-enabled lane and for a lane with a session, and never calls the op', async () => {
    const r = await openApp();
    const cookie = await fresh(r.app);
    r.stub('remove', { out: REMOVED_ANSWER(r) });
    const discard = () => post(r, `/api/accounts/${LANE}/remove`, { mode: 'discard' }, cookie);
    // No record of adding it.
    expect((await discard()).json()).toEqual({ ok: false, error: 'not-discardable' });
    // Switched on once.
    plantDiscardable(r, LANE, { enabledAt: iso(Date.now() - 10_000) });
    expect((await discard()).json()).toEqual({ ok: false, error: 'not-discardable' });
    // On now (no marker).
    plantDiscardable(r);
    rmMarker(r);
    expect((await discard()).json()).toEqual({ ok: false, error: 'not-discardable' });
    // A session names the lane.
    plantDiscardable(r);
    plantSession(r, 'claude-a-demo');
    const res = await discard();
    expect(res.statusCode).toBe(REFUSAL_STATUS['not-discardable']);
    expect(res.json()).toEqual({ ok: false, error: 'not-discardable', sessions: ['claude-a-demo'] });
    expect(r.calls, 'the route called the op for a lane it refuses').toEqual([]);
    expect(r.argv()).toEqual([]);
    expect(r.rows.map((x) => [x.act, x.code])).toEqual([
      ['discard', 'not-discardable'], ['discard', 'not-discardable'], ['discard', 'not-discardable'], ['discard', 'not-discardable']]);
  });

  it('`{mode:\'check\'}` needs no step-up, is session-only, and changes nothing', async () => {
    const r = await openApp();
    const before = readFileSync(path.join(r.home, '.ccrc', 'accounts.json'), 'utf8');
    const at = Date.now() - 1000;
    r.stub('remove', { out: { ok: true, id: LANE, dryRun: true, live: 2, sleeping: ['claude-a-zz'], archived: 1, upstream: false,
      otherHomeAble: 3, authInProgress: false, discardable: false, at: iso(at), fleetIdentity: NODE } });
    expect((await post(r, `/api/accounts/${LANE}/remove`, { mode: 'check' }, undefined, { [MAIL_TOKEN_HEADER]: BOX_TOKEN })).statusCode).toBe(401);
    const cookie = await login(r.app);
    const res = await post(r, `/api/accounts/${LANE}/remove`, { mode: 'check' }, cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      ok: true, fleetIdentity: NODE,
      check: { live: 2, sleeping: ['claude-a-zz'], archived: 1, upstream: false, otherHomeAble: 3, authInProgress: false, discardable: false, at: Math.floor(at / 1000) * 1000 },
    } satisfies AccountRemoveCheckAnswer);
    expect(r.argv()).toEqual([`account remove --id=${LANE} --dry-run`]);
    expect(r.rows, 'a pre-check is no act').toEqual([]);
    expect(readFileSync(path.join(r.home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
  });
});

describe('set and the revoke tick', () => {
  it('set carries the stated account on stdin, never argv, and refuses a bad one before the verb', async () => {
    const r = await openApp();
    const cookie = await login(r.app);
    r.stub('set', { out: { ok: true, roster: r.roster(), fleetIdentity: NODE } });
    const res = await post(r, `/api/accounts/${LANE}/set`, { stated: 'someone@example.invalid', placement: 'full' }, cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(r.argv()).toEqual([`account set --id=${LANE} --placement=full --stated=-`]);
    expect(readFileSync(path.join(r.home, 'stdin-set'), 'utf8')).toBe('someone@example.invalid');
    for (const bad of ['', '   ', 'a\nb', 'x'.repeat(121), 'a‮b']) {
      expect((await post(r, `/api/accounts/${LANE}/set`, { stated: bad }, cookie)).json()).toEqual({ ok: false, error: 'bad-stated' });
    }
    for (const body of [{}, { limit: '20' }, { placement: 'full', limitReset: 'daily' }]) {
      expect((await post(r, `/api/accounts/${LANE}/set`, body, cookie)).json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(r.argv()).toHaveLength(1);
  });

  it('revoke-ack writes one revoke-acknowledged row with no value, for a lane that may be gone, and runs no op', async () => {
    const r = await openApp();
    const cookie = await login(r.app);
    const res = await post(r, '/api/accounts/revoke-ack', { laneId: 'lane-gone', kind: 'anthropic-token' }, cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(r.rows).toEqual([expect.objectContaining({ act: 'revoke-acknowledged', laneId: 'lane-gone', provider: 'anthropic', outcome: 'ok' })]);
    expect(Object.keys(r.rows[0]!).sort()).toEqual(['act', 'actor', 'fleetIdentity', 'laneId', 'outcome', 'provider']);
    for (const body of [{ laneId: 'lane-gone', kind: 'a-url' }, { laneId: 'lane-gone', kind: 'codex', note: 'x' }, { laneId: '../x', kind: 'codex' }]) {
      expect((await post(r, '/api/accounts/revoke-ack', body, cookie)).statusCode).toBe(400);
    }
    expect(r.calls).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });
});

describe('the pure readers', () => {
  it('routeOutcomeOf maps the write verbs\' codes to their words, and the port\'s key-charset to its own', () => {
    const exited = (o: unknown) => routeOutcomeOf({ kind: 'exited', code: 1, stdout: JSON.stringify(o) });
    for (const w of ['key-charset', 'key-rejected', 'token-unverified', 'upstream', 'last-home-able', 'auth-in-progress',
      'not-discardable', 'not-a-token-lane', 'bad-stated', 'duplicate-id', 'lane-busy', 'last-enabled-home'] as const) {
      expect(exited({ ok: false, error: w, detail: 'x' })).toEqual({ kind: 'refuse', word: w, extra: {}, audit: 'refused' });
    }
    expect(routeOutcomeOf({ kind: 'refused', why: 'key-charset' })).toMatchObject({ word: 'key-charset' });
    expect(routeOutcomeOf({ kind: 'refused', why: 'bad-field' })).toMatchObject({ word: 'bad-request' });
  });

  it('discardVerdictOf: unmeasured is never "no session"', () => {
    const read = { kind: 'read', state: { addedAt: 1 } } as const;
    expect(discardVerdictOf(read, true, [])).toEqual({ ok: true });
    expect(discardVerdictOf(read, true, null)).toEqual({ ok: false, word: 'unmeasured' });
    expect(discardVerdictOf({ kind: 'unreadable' }, true, [])).toEqual({ ok: false, word: 'not-discardable' });
    expect(discardVerdictOf(read, false, [])).toEqual({ ok: false, word: 'not-discardable' });
  });

  it('the ledger and the pre-check are held to their grammars; a sign-in row reads unmeasured, never ended', () => {
    const l = removedLedgerOf(JSON.stringify({ ok: true, removed: ['a', 1, 'b\nc'], kept: [], rehomed: ['x'],
      atProvider: [{ kind: 'anthropic-sign-in', state: 'unmeasured', revokeAt: 'claude-account-settings' },
        { kind: 'anthropic-sign-in', state: 'ended', revokeAt: null }, { kind: 'api-key', state: 'still-valid', revokeAt: null }] }));
    expect(l).toEqual({ removed: ['a'], kept: [], rehomed: ['x'], atProvider: [
      { kind: 'anthropic-sign-in', state: 'unmeasured', revokeAt: 'claude-account-settings' },
      { kind: 'api-key', state: 'still-valid', revokeAt: null }] });
    expect(removedLedgerOf('not json')).toBeNull();
    expect(removeCheckOf(JSON.stringify({ ok: true, dryRun: true, live: -1, sleeping: [], archived: 0, upstream: false,
      otherHomeAble: 0, authInProgress: false, discardable: false, at: iso(0) }))).toBeNull();
  });
});

function rmMarker(r: Rig): void {
  rmSync(path.join(r.home, '.cc-sessions', `${LANE}-disabled`), { force: true });
}
