// The sign-in routes' rig (accounts plan Task A21, D-7793): the real server, the real account gate and step-up, the real
// reconciling wrapper and the real local `AccountOps` arm, over a stub `ccrc` launcher at `<home>/.local/bin/ccrc` that
// records its argv to `<home>/argv.log` and answers what `<home>/stub/<sub>.{out,code}` say, with `@ATTEMPT@` in an
// answer replaced by the `--attempt=` the route passed. The helper's status file is written by the test, as a fleet-user
// process could. The attempts store runs on a clock the test moves. No fixture value is real-shaped.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import type { AccountSub } from '../../shared/api.js';
import { buildServer, type Deps } from '../src/server.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { actorOf, type AccountAudit, type AccountEventInput } from '../src/accounts/audit.js';
import { AuthAttempts, type AuthAttemptClock } from '../src/accounts/attempts.js';
import { localAccountOps, type AccountOps } from '../src/accounts/ops.js';
import { reconcilingAccountOps } from '../src/accounts/reconcile.js';
import { reloadRoster, rosterAnswerOf } from '../src/config.js';
import { fingerprintAnswerOf } from '../src/accounts/mask.js';
import type { FleetIdentityCell } from '../src/fleetidentity.js';
import type { FleetState } from '../src/fleetstate.js';
import type { PtyLike } from '../src/pty.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
export const PASSPHRASE = 'correct horse battery staple';
export const BOX_TOKEN = 'box-token-for-the-account-auth-routes-suite';
export const NODE = '0a21a21a-0000-4000-8000-00000000a21a';
export const OTHER_NODE = '0a21a21a-0000-4000-8000-0000000b0b0b';
export const LANE = 'claude-a';
/** A code of the measured `login` shape (48 alphanumerics, `#`, 43 base64url characters), built from neutral filler. */
export const CODE = `${'Fx7Qa21R'.repeat(6)}#${'c0de_a21-'.repeat(4)}a21ok0d`;
export const T0 = Date.UTC(2026, 10, 1, 21, 0, 0);
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/argv.log"
cat > /dev/null
d="$HOME/stub"
a=""
for w in "$@"; do case "$w" in --attempt=*) a="\${w#--attempt=}" ;; esac; done
[ -f "$d/$2.out" ] && sed "s/@ATTEMPT@/$a/g" "$d/$2.out"
if [ -f "$d/$2.code" ]; then exit "$(cat "$d/$2.code")"; fi
exit 0
`;

/** A clock the test moves: `fire()` runs every timer whose time has come. */
export interface FakeClock extends AuthAttemptClock { at: number; advance(ms: number): void }
export function fakeClock(): FakeClock {
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const c: FakeClock = {
    at: T0,
    now: () => c.at,
    schedule: (fn, ms) => {
      const t = { at: c.at + ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
    advance: (ms) => {
      c.at += ms;
      for (const t of timers) if (t.live && t.at <= c.at) { t.live = false; t.fn(); }
    },
  };
  return c;
}

export interface AuthRig {
  app: FastifyInstance; home: string; rows: AccountEventInput[]; calls: AccountSub[]; clock: FakeClock;
  node: { id: string };
  argv: () => string[];
  stub: (sub: string, o: { out?: unknown; code?: number }) => void;
  /** Writes the helper's status file for the lane, as any fleet-user process could. */
  status: (fields: Record<string, unknown>, id?: string) => void;
}

export async function openAuthApp(o: { enabled?: boolean; caps?: string[] } = {}): Promise<AuthRig> {
  const home = mkTmp('ccrc-account-auth-');
  const base = testDeps(home);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'ccrc'), STUB);
  chmodSync(path.join(bin, 'ccrc'), 0o755);
  mkdirSync(path.join(home, 'stub'), { recursive: true });
  mkdirSync(path.join(home, '.cc-sessions', '.auth'), { recursive: true, mode: 0o700 });
  const rows: AccountEventInput[] = [];
  const audit = { write: (e: AccountEventInput) => { rows.push(e); return { ok: true, id: rows.length }; } } as unknown as AccountAudit;
  const cfg = { ...base.cfg, authEnabled: o.enabled ?? true, cookieSecure: false, rpId: 'localhost', origin: 'http://localhost:7788' };
  const node = { id: NODE };
  const inner = localAccountOps({ home, killGraceMs: 100, timeoutMs: () => 10_000 });
  const wrapped = reconcilingAccountOps(inner, {
    reload: (stdout) => {
      const a = rosterAnswerOf(stdout, fingerprintAnswerOf);
      return a === null ? null : reloadRoster(cfg, a, { fleetIdentity: () => node.id });
    },
    audit, fleetIdentity: () => node.id, actor: actorOf('ccrc server', ''),
  });
  const calls: AccountSub[] = [];
  const accountOps: AccountOps = { arm: wrapped.arm, run: (sub, ...rest) => { calls.push(sub); return wrapped.run(sub, ...rest); } };
  const clock = fakeClock();
  const deps: Deps = {
    ...base, cfg, mailToken: BOX_TOKEN, spawnPty: stubPty,
    fleetState: { ccdVerbs: o.caps ?? ['account-v2', 'account-auth-v1'] } as unknown as FleetState,
    fleetIdentity: { current: () => ({ kind: 'known', connectionEpoch: 1, nodeId: node.id, measuredAt: 0 }) } as unknown as FleetIdentityCell,
    accountOps, accountAudit: audit, authAttempts: new AuthAttempts(clock),
  };
  const a = await buildServer(deps);
  await a.ready();
  const log = path.join(home, 'argv.log');
  const rig: AuthRig = {
    app: a, home, rows, calls, clock, node,
    argv: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []),
    stub: (sub, s) => {
      const d = path.join(home, 'stub');
      if (s.out !== undefined) writeFileSync(path.join(d, `${sub}.out`), typeof s.out === 'string' ? s.out : JSON.stringify(s.out));
      if (s.code !== undefined) writeFileSync(path.join(d, `${sub}.code`), String(s.code));
    },
    status: (fields, id = LANE) => {
      writeFileSync(path.join(home, '.cc-sessions', '.auth', `${id}.json`), JSON.stringify(fields));
    },
  };
  // The box's answers, as A20's verbs give them (`auth-answer`), each naming the attempt and the node.
  rig.stub('auth-start', { out: { ok: true, id: LANE, attemptId: '@ATTEMPT@', method: 'login', state: 'starting', unit: 'ccrc-auth-unit', fleetIdentity: NODE } });
  rig.stub('auth-code', { out: { ok: true, id: LANE, attemptId: '@ATTEMPT@', sent: true, fleetIdentity: NODE } });
  rig.stub('auth-cancel', { out: { ok: true, id: LANE, attemptId: '@ATTEMPT@', unit: 'ccrc-auth-unit', stopped: true, state: 'cancelled', fleetIdentity: NODE } });
  return rig;
}

export const login = async (a: FastifyInstance): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};
export const stepUp = async (a: FastifyInstance, cookie: string): Promise<void> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/step-up/passphrase', headers: { cookie }, payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(200);
};
/** A session that has stepped up. */
export const fresh = async (a: FastifyInstance): Promise<string> => { const c = await login(a); await stepUp(a, c); return c; };

export const post = (r: AuthRig, url: string, payload: unknown, cookie?: string, extra: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'POST', url, payload: payload as object, headers: { ...(cookie ? { cookie } : {}), ...extra } });
export const get = (r: AuthRig, url: string, cookie?: string): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

/** Starts a `login` attempt on `LANE` from `cookie` (a fresh session), and answers its id and deadline. */
export async function startAttempt(r: AuthRig, cookie: string, method = 'login'): Promise<{ attemptId: string; expiresAt: number }> {
  const res = await post(r, `/api/accounts/${LANE}/auth/start`, { method }, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { attemptId: string; expiresAt: number };
}

/** The measured `login` URL's shape, with neutral parameter values. */
export const LOGIN_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=client-a21&response_type=code'
  + '&redirect_uri=https%3A%2F%2Fexample.invalid%2Fcallback&scope=user%3Ainference&code_challenge=challenge-a21'
  + '&code_challenge_method=S256&state=state-a21';
export const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
