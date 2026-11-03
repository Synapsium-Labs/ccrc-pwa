// The lane routes: Check, and the kill switch with its readiness reason (spec §10, §13.1; D-5511, D-5518; accounts plan
// Task A14, D-7732). Each route runs on the real server, through the real account gate, the real reconciling wrapper and
// the real local `AccountOps` arm, over a stub `ccrc` launcher at `<home>/.local/bin/ccrc` that records its argv to
// `<home>/argv.log` and answers what `<home>/stub/<sub>.{out,code,sleep}` say. So "no route sends `--force`" is read
// off the argv the launcher was actually given, and "a timeout triggers reconcile" off the `roster` run that followed.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AccountCheckAnswer, AccountSwitchAnswer, AccountsResponse } from '../../shared/api.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { buildServer, type Deps } from '../src/server.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { actorOf, type AccountAudit, type AccountEventInput } from '../src/accounts/audit.js';
import { localAccountOps } from '../src/accounts/ops.js';
import { reconcilingAccountOps } from '../src/accounts/reconcile.js';
import { routeOutcomeOf } from '../src/accounts/routes.js';
import { MAIL_TOKEN_HEADER } from '../src/coord/token.js';
import type { FleetState } from '../src/fleetstate.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const BOX_TOKEN = 'box-token-for-the-account-routes-suite';
const LANE = 'claude-a';
const ROUTES = ['check', 'enable', 'disable'] as const;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

/** The stub launcher. It records argv, sleeps, prints and exits as its control files say; `disable` writes the kill
 *  switch's marker and `enable` removes it, as the real verbs do, so the route's re-read sees the switch move. */
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/argv.log"
d="$HOME/stub"
id="\${3#--id=}"
[ -f "$d/$2.sleep" ] && sleep "$(cat "$d/$2.sleep")"
[ -f "$d/$2.out" ] && cat "$d/$2.out"
if [ -f "$d/$2.code" ]; then exit "$(cat "$d/$2.code")"; fi
case "$2" in
  disable) : > "$HOME/.cc-sessions/$id-disabled" ;;
  enable) rm -f "$HOME/.cc-sessions/$id-disabled" ;;
esac
exit 0
`;

interface Rig { app: FastifyInstance; home: string; rows: AccountEventInput[]; argv: () => string[] }

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

async function openApp(o: { enabled?: boolean; origin?: string; caps?: string[]; enableTimeoutMs?: number } = {}): Promise<Rig> {
  const home = mkTmp('ccrc-account-routes-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'ccrc'), STUB);
  chmodSync(path.join(bin, 'ccrc'), 0o755);
  mkdirSync(path.join(home, 'stub'), { recursive: true });
  const lanes = path.join(home, '.cc-sessions', '.accounts');
  mkdirSync(lanes, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(lanes, `${LANE}.json`), JSON.stringify({ check: { verdict: 'ok', at: iso(Date.now() - 60_000) } }));
  const rows: AccountEventInput[] = [];
  const audit = { write: (e: AccountEventInput) => { rows.push(e); return { ok: true, id: rows.length }; } } as unknown as AccountAudit;
  const inner = localAccountOps({
    home, killGraceMs: 100, timeoutMs: (sub) => (sub === 'enable' ? o.enableTimeoutMs ?? 10_000 : 10_000),
  });
  const accountOps = reconcilingAccountOps(inner, {
    reload: () => null, audit, fleetIdentity: () => null, actor: actorOf('ccrc server', ''),
  });
  const deps: Deps = {
    ...base,
    cfg: { ...base.cfg, authEnabled: o.enabled ?? true, cookieSecure: false, rpId: 'localhost', origin: o.origin ?? 'http://localhost:7788' },
    mailToken: BOX_TOKEN,
    spawnPty: stubPty,
    fleetState: { ccdVerbs: o.caps ?? ['account-v2'] } as unknown as FleetState,
    accountOps,
    accountAudit: audit,
  };
  const a = await buildServer(deps);
  await a.ready();
  app = a;
  const log = path.join(home, 'argv.log');
  return { app: a, home, rows, argv: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []) };
}

const login = async (a: FastifyInstance): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};

const post = (r: Rig, route: string, cookie?: string, extra: Record<string, string> = {}) =>
  r.app.inject({ method: 'POST', url: `/api/accounts/${LANE}/${route}`, headers: { ...(cookie ? { cookie } : {}), ...extra } });

describe('the lane routes take the account gate first (D-5511)', () => {
  it.each(ROUTES)('%s refuses a box token, and runs nothing', async (route) => {
    const r = await openApp();
    const res = await post(r, route, undefined, { [MAIL_TOKEN_HEADER]: BOX_TOKEN });
    expect(res.statusCode).toBe(401);
    expect(r.argv()).toEqual([]);
  });

  it.each(ROUTES)('%s refuses a dark gate with auth-off, no-store, and runs nothing', async (route) => {
    const r = await openApp({ enabled: false });
    const res = await post(r, route);
    expect(res.statusCode).toBe(REFUSAL_STATUS['auth-off']);
    expect(res.json()).toMatchObject({ ok: false, error: 'auth-off' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(r.argv()).toEqual([]);
  });

  it.each(ROUTES)('%s refuses an insecure origin, and runs nothing', async (route) => {
    const r = await openApp({ origin: 'http://ccrc.example.invalid:7788' });
    const cookie = await login(r.app);
    const res = await post(r, route, cookie);
    expect(res.json()).toMatchObject({ ok: false, error: 'insecure-origin' });
    expect(res.statusCode).toBe(REFUSAL_STATUS['insecure-origin']);
    expect(r.argv()).toEqual([]);
  });

  it.each(ROUTES)('%s refuses a fleet that does not advertise account-v2, and runs nothing', async (route) => {
    const r = await openApp({ caps: ['account-v1'] });
    const cookie = await login(r.app);
    const res = await post(r, route, cookie);
    expect(res.json()).toMatchObject({ ok: false, error: 'unsupported' });
    expect(r.argv()).toEqual([]);
  });

  it('an id off the roster grammar, or one the roster does not hold, runs nothing', async () => {
    const r = await openApp();
    const cookie = await login(r.app);
    const bad = await r.app.inject({ method: 'POST', url: '/api/accounts/a%20b/check', headers: { cookie } });
    expect(bad.json()).toMatchObject({ ok: false, error: 'bad-account-id' });
    const unknown = await r.app.inject({ method: 'POST', url: '/api/accounts/lane-zz/enable', headers: { cookie } });
    expect(unknown.json()).toMatchObject({ ok: false, error: 'not-found' });
    expect(r.argv()).toEqual([]);
  });
});

describe('Check, enable and disable (spec §10, §13.1)', () => {
  it('check runs one `ccrc account check` and answers the lane as re-read, no-store', async () => {
    const r = await openApp();
    const cookie = await login(r.app);
    const res = await post(r, 'check', cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json() as AccountCheckAnswer;
    expect(body.ok).toBe(true);
    expect(body.lane.check?.verdict).toBe('ok');
    expect(r.argv()).toEqual([`account check --id=${LANE}`]);
    expect(r.rows).toEqual([expect.objectContaining({ act: 'check', laneId: LANE, outcome: 'ok', provider: 'anthropic' })]);
  });

  it('disable then enable answer the roster and the lane, and the lane reads the switch the box now holds', async () => {
    const r = await openApp();
    const cookie = await login(r.app);
    const off = await post(r, 'disable', cookie);
    expect(off.statusCode, off.body).toBe(200);
    const offBody = off.json() as AccountSwitchAnswer;
    expect(offBody.lane.state.word).toBe('off');
    const accounts = (await r.app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie } })).json() as AccountsResponse;
    expect(offBody.roster).toEqual(accounts.roster);
    const on = await post(r, 'enable', cookie);
    expect(on.statusCode, on.body).toBe(200);
    expect((on.json() as AccountSwitchAnswer).lane.state.word).not.toBe('off');
  });

  it('enable on a not-ready lane answers not-ready with its reason, never the verb\'s sentence, and the roster is unchanged', async () => {
    const r = await openApp();
    const cookie = await login(r.app);
    const rosterFile = path.join(r.home, '.ccrc', 'accounts.json');
    const before = readFileSync(rosterFile, 'utf8');
    writeFileSync(path.join(r.home, '.cc-sessions', `${LANE}-disabled`), '');
    writeFileSync(path.join(r.home, 'stub', 'enable.out'), JSON.stringify({
      ok: false, error: 'not-ready', reason: 'check-failed',
      detail: `Not ready: the last check of lane ${LANE} didn't pass. Check it first: ccrc account check --id ${LANE}.`,
    }));
    writeFileSync(path.join(r.home, 'stub', 'enable.code'), '1');
    const res = await post(r, 'enable', cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['not-ready']);
    expect(res.json()).toEqual({ ok: false, error: 'not-ready', reason: 'check-failed' });
    expect(res.body).not.toContain('ccrc account');
    expect(readFileSync(rosterFile, 'utf8')).toBe(before);
    expect(existsSync(path.join(r.home, '.cc-sessions', `${LANE}-disabled`))).toBe(true);
    // The refusal's row follows the reconcile the wrapper ran for it (a non-zero exit is a failed op).
    expect(r.rows.map((x) => [x.act, x.outcome, x.code])).toEqual([['reconcile', 'failed', undefined], ['enable', 'refused', 'not-ready']]);
  });

  it('a verb refusal of its own crosses as its code only; lane-busy and last-enabled-home keep their words', async () => {
    const r = await openApp();
    const cookie = await login(r.app);
    const refuse = (error: string): void => {
      writeFileSync(path.join(r.home, 'stub', 'disable.out'), JSON.stringify({ ok: false, error, detail: 'a sentence with /a/path in it' }));
      writeFileSync(path.join(r.home, 'stub', 'disable.code'), '1');
    };
    refuse('last-enabled-home');
    expect((await post(r, 'disable', cookie)).json()).toEqual({ ok: false, error: 'last-enabled-home' });
    refuse('lane-busy');
    expect((await post(r, 'disable', cookie)).json()).toEqual({ ok: false, error: 'lane-busy' });
    refuse('marker-conflict');
    const other = await post(r, 'disable', cookie);
    expect(other.json()).toEqual({ ok: false, error: 'lane-act-refused', verbCode: 'marker-conflict' });
    expect(other.body).not.toContain('/a/path');
  });

  it('a timeout answers outcome unknown and triggers reconcile: one roster sub and a reconcile row', async () => {
    const r = await openApp({ enableTimeoutMs: 2_000 });
    const cookie = await login(r.app);
    writeFileSync(path.join(r.home, 'stub', 'enable.sleep'), '8');
    const res = await post(r, 'enable', cookie);
    expect(res.statusCode).toBe(REFUSAL_STATUS['outcome-unknown']);
    expect(res.json()).toEqual({ ok: false, error: 'outcome-unknown' });
    expect(r.argv()).toEqual([`account enable --id=${LANE}`, 'account roster']);
    expect(r.rows.map((x) => [x.act, x.outcome])).toEqual([['reconcile', 'failed'], ['enable', 'unknown']]);
  }, 20_000);

  it('no route sends --force: every argv the launcher saw is the sub and the id, the not-ready refusal included', async () => {
    const r = await openApp();
    const cookie = await login(r.app);
    writeFileSync(path.join(r.home, 'stub', 'enable.out'), JSON.stringify({ ok: false, error: 'not-ready', reason: 'not-checked', detail: 'x' }));
    writeFileSync(path.join(r.home, 'stub', 'enable.code'), '1');
    for (const route of ROUTES) await post(r, route, cookie);
    const seen = r.argv();
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const line of seen) {
      expect(line).not.toContain('--force');
      expect([...ROUTES.map((s) => `account ${s} --id=${LANE}`), 'account roster']).toContain(line);
    }
  });
});

describe('routeOutcomeOf (pure)', () => {
  it('an exit with no envelope is refused with no code, and an envelope reason off the list is dropped', () => {
    expect(routeOutcomeOf({ kind: 'exited', code: 1, stdout: 'not json' }))
      .toEqual({ kind: 'refuse', word: 'lane-act-refused', extra: {}, audit: 'failed' });
    expect(routeOutcomeOf({ kind: 'exited', code: 1, stdout: '{"ok":false,"error":"not-ready","reason":"<b>"}' }))
      .toEqual({ kind: 'refuse', word: 'not-ready', extra: {}, audit: 'refused' });
    expect(routeOutcomeOf({ kind: 'exited', code: 1, stdout: '{"ok":false,"error":"Not A Word"}' }))
      .toEqual({ kind: 'refuse', word: 'lane-act-refused', extra: {}, audit: 'refused' });
  });

  it('an outcome the box may have acted on is unknown; nothing that never ran is', () => {
    for (const kind of ['timeout', 'lost', 'too-large'] as const) {
      expect(routeOutcomeOf({ kind })).toMatchObject({ word: 'outcome-unknown', audit: 'unknown' });
    }
    expect(routeOutcomeOf({ kind: 'not-started' })).toMatchObject({ word: 'unavailable' });
    expect(routeOutcomeOf({ kind: 'unsupported' })).toMatchObject({ word: 'unsupported' });
    expect(routeOutcomeOf({ kind: 'refused', why: 'bad-field' })).toMatchObject({ word: 'bad-request' });
  });
});
