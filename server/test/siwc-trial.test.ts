// siwc-trial.test.ts — `deploy/siwc-trial.py`, the operator's one-off trial helper for the Sign in with ChatGPT plan
// route (codex-bridge spec 2026-10-15 §2.2, §2.6, §5 "The operator's trial", and decision D10: "The operator runs a
// helper; the token never passes through an agent").
//
// NO CASE REACHES A LIVE ENDPOINT. The authorization server and the Responses API are two Python stdlib servers under
// `fixtures/siwc/`, each on a free port of 127.0.0.1, reached through the tool's two loopback overrides
// (CCRC_SIWC_AUTH_BASE, CCRC_SIWC_API_BASE). `childEnv` sets both on every spawn, to CLOSED (a loopback port nothing
// listens on) unless the case names a fake, so no spawn can run with the real endpoints; a case that passes a
// forbidden override uses a name under `.invalid` or a loopback spelling, so a broken guard still reaches nothing
// real. Every process gets an environment built from scratch and a mkTmp HOME. The browser is this file: it fetches
// the authorize URL the tool prints from the fake, then the loopback callback the fake redirects to. Every token,
// code and id is synthetic, issued by the fakes at run time, and carries the word `sentinel`.
import { afterEach, describe, it, expect } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pythonOrSkip } from './ccgptHarness.js';
import { BRIDGE_FILES } from './codexBridgeFixture.js';
import { mkTmp } from './tmpHelpers.js';

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Env = Record<string, string>;
type Run = { status: number | null; stdout: string; stderr: string };

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'deploy', 'siwc-trial.py');
const RECORD_PY = path.join(ROOT, 'ccd', 'codexbridge', 'record.py');
const FAKE_AUTH = path.join(__dirname, 'fixtures', 'siwc', 'fake_auth.py');
const FAKE_API = path.join(__dirname, 'fixtures', 'siwc', 'fake_api.py');
/** A loopback port nothing listens on: where both bases point unless a case names a fake. */
const CLOSED = 'http://127.0.0.1:1';
const AUTH_ENV = 'CCRC_SIWC_AUTH_BASE';
const API_ENV = 'CCRC_SIWC_API_BASE';
const P = 'siwc-trial: ';

// The trial directory's files, and the facts the pages fix.
const CRED = 'credential.json';
const REG = 'registration.json';
const HOST = 'host-id';
const COUNT = 'siwc-trial.count';
const CAP = 60;
const MODEL = 'model-fixture-a';
const CLIENT = 'oaiapp_fixture';
const RESOURCE = 'https://api.openai.com/v1';
const ALL_SCOPES = ['chatgpt.tokens.use.direct', 'email', 'offline_access', 'openid', 'profile', 'resource.invoke'];
const UNSUPPORTED = [
  'background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'multi_agent',
  'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p', 'truncation',
  'user', 'previous_response_id',
];
/** The step that carries one unsupported field on purpose, and the steps in order (16 sends two requests). */
const DELIBERATE = 21;
const STEPS = Array.from({ length: 21 }, (_, i) => i + 1);
const SENT = STEPS.flatMap((s) => (s === 16 ? [16, 16] : [s]));

// ── the fakes ────────────────────────────────────────────────────────────────────────────────────────────────────
type Fake = { base: string; log: () => Json[]; config: (c: Json) => void };
type Rig = { home: string; dir: string; auth: Fake; api: Fake; env: Env };

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
});

function startFake(script: string, dir: string, name: string): Promise<Fake> {
  const log = path.join(dir, `${name}.log`);
  const cfg = path.join(dir, `${name}.json`);
  fs.writeFileSync(log, '');
  fs.writeFileSync(cfg, '{}');
  const child = spawn(PY!, ['-I', script, '--log', log, '--config', cfg], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: tmpdir() }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => reject(new Error(`${name} did not start: ${err}`)), 15_000);
    child.stderr!.on('data', (c: Buffer) => { err += c.toString(); });
    child.stdout!.on('data', (c: Buffer) => {
      out += c.toString();
      const m = /^port ([0-9]+)$/m.exec(out);
      if (!m) return;
      clearTimeout(timer);
      resolve({
        base: `http://127.0.0.1:${m[1]}`,
        log: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Json),
        config: (c) => fs.writeFileSync(cfg, JSON.stringify(c)),
      });
    });
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** A fixture HOME, a trial directory inside it (not made yet), and the two fakes. */
async function rig(): Promise<Rig> {
  const home = mkTmp('siwc-trial-');
  const fakes = path.join(home, 'fakes');
  fs.mkdirSync(fakes);
  const [auth, api] = await Promise.all([startFake(FAKE_AUTH, fakes, 'auth'), startFake(FAKE_API, fakes, 'api')]);
  return { home, dir: path.join(home, 'trial'), auth, api, env: { [AUTH_ENV]: auth.base, [API_ENV]: api.base } };
}

// ── the tool ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The child's environment, built from scratch. BROWSER is a script that does nothing, so a spawn that forgot
 *  `--no-browser` opens nothing; both bases are CLOSED unless `env` names them. */
function childEnv(home: string, env: Env): Env {
  const browser = path.join(home, 'no-browser.sh');
  if (!fs.existsSync(browser)) fs.writeFileSync(browser, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: tmpdir(), BROWSER: browser, [AUTH_ENV]: CLOSED, [API_ENV]: CLOSED,
    ...env, HOME: home,
  };
}

/** `python3 -I deploy/siwc-trial.py <args>` to its end. The fakes are other processes, so a synchronous spawn is safe. */
function trial(home: string, args: string[], env: Env = {}): Run {
  const r = spawnSync(PY!, ['-I', SCRIPT, ...args], { cwd: home, env: childEnv(home, env), encoding: 'utf8', timeout: 60_000 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const verb = (r: Rig, name: string, args: string[] = [], env: Env = r.env): Run =>
  trial(r.home, [name, '--dir', r.dir, ...args], env);
const probe = (r: Rig, args: string[], env: Env = r.env): Run => verb(r, 'probe', ['--model', MODEL, ...args], env);

type Pending = { url: Promise<string>; done: Promise<Run> };

/** `signin`, running: `url` resolves with the authorize URL it prints, `done` when it ends. */
function startSignin(r: Rig, args: string[] = ['--no-browser', '--wait', '20'], env: Env = r.env, dir: string[] = ['--dir', r.dir]): Pending {
  const child = spawn(PY!, ['-I', SCRIPT, 'signin', ...dir, ...args], {
    cwd: r.home, env: childEnv(r.home, env), stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  let found: (u: string) => void = () => {};
  let ended: (e: Error) => void = () => {};
  const url = new Promise<string>((resolve, reject) => { found = resolve; ended = reject; });
  url.catch(() => {}); // a case that expects no URL never awaits it
  child.stdout!.on('data', (c: Buffer) => {
    stdout += c.toString();
    const m = /^siwc-trial: authorize-url (\S+)$/m.exec(stdout);
    if (m) found(m[1]!);
  });
  child.stderr!.on('data', (c: Buffer) => { stderr += c.toString(); });
  const done = new Promise<Run>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      ended(new Error(`signin ended with no authorize URL: ${stderr}`));
      resolve({ status: code, stdout, stderr });
    });
  });
  return { url, done };
}

type Hit = { status: number; body: string };
/** The browser's first leg: the authorize URL, which the fake answers with a redirect to the loopback callback. */
async function authorize(url: string): Promise<URL> {
  const res = await fetch(url, { redirect: 'manual' });
  expect(res.status, 'the fake redirects to the callback').toBe(302);
  return new URL(res.headers.get('location')!);
}
/** One request to the tool's listener. */
async function hit(url: URL | string): Promise<Hit> {
  const res = await fetch(url, { redirect: 'manual' });
  return { status: res.status, body: await res.text() };
}
/** A whole sign-in: the tool, the browser's two legs, the tool's end. `edit` changes the callback URL first. */
async function signin(r: Rig, edit: (u: URL) => URL = (u) => u, args?: string[]): Promise<Run & { callback: Hit }> {
  const p = startSignin(r, args);
  const callback = await hit(edit(await authorize(await p.url)));
  return { ...(await p.done), callback };
}
/** A rig whose directory holds a credential from one good sign-in. */
async function signedIn(config: Json = {}): Promise<Rig> {
  const r = await rig();
  r.auth.config(config);
  const s = await signin(r);
  expect(s.status, s.stderr).toBe(0);
  return r;
}

// ── reading what happened ────────────────────────────────────────────────────────────────────────────────────────
const mode = (p: string): number => fs.statSync(p).mode & 0o777;
const at = (r: Rig, name: string): string => path.join(r.dir, name);
const readJson = (p: string): Json => JSON.parse(fs.readFileSync(p, 'utf8')) as Json;
const cred = (r: Rig): Json => readJson(at(r, CRED));
const authorizeQueries = (r: Rig): Json[] => r.auth.log().filter((e) => e.route === 'authorize').map((e) => e.query as Json);
const tokenForms = (r: Rig, grant: string): Json[] =>
  r.auth.log().filter((e) => e.route === 'token' && e.form.grant_type === grant).map((e) => e.form as Json);
const issued = (r: Rig): string[] => r.auth.log().filter((e) => e.issued).flatMap((e) => Object.values(e.issued as Env));
const sent = (r: Rig): Json[] => r.api.log().filter((e) => e.route === 'responses');
const lines = (text: string): string[] => text.split('\n').filter(Boolean);
const refusal = (run: Run): string => lines(run.stderr).find((l) => l.startsWith(`${P}refused `)) ?? '';
const recDir = (r: Rig): string => at(r, BRIDGE_FILES.recordings);
const recordings = (r: Rig): string[] => fs.readdirSync(recDir(r)).filter((f) => f.endsWith('.sse')).sort(byCount);
const countOf = (f: string): number => Number(/-([0-9]+)\.(?:sse|request\.json)$/.exec(f)![1]);
const byCount = (a: string, b: string): number => countOf(a) - countOf(b);
/** A recording's status and body, as `record.py`'s own `split_head` reads them. */
function splitHead(file: string): { status: number | null; sha256: string; bytes: number } {
  const code = [
    'import hashlib, json, sys', 'sys.dont_write_bytecode = True', 'sys.path.insert(0, sys.argv[1])',
    'from codexbridge import record', 'status, body = record.split_head(open(sys.argv[2], "rb").read())',
    'print(json.dumps({"status": status, "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}))',
  ].join('\n');
  const r = spawnSync(PY!, ['-I', '-c', code, path.join(ROOT, 'ccd'), file], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as { status: number | null; sha256: string; bytes: number };
}
/** Move the credential's `saved_at` into the past, so its access token has expired. */
function expire(r: Rig): void {
  fs.writeFileSync(at(r, CRED), JSON.stringify({ ...cred(r), saved_at: '2026-01-01T00:00:00Z' }));
}
/** Every text a request body carries: each string under a `text`, `instructions` or `description` key. */
function texts(v: unknown, key = ''): string[] {
  if (typeof v === 'string') return ['text', 'instructions', 'description'].includes(key) ? [v] : [];
  if (Array.isArray(v)) return v.flatMap((x) => texts(x, key));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => texts(x, k));
  return [];
}
const items = (body: Json, type: string): Json[] => (body.input as Json[]).filter((i) => i.type === type);

// ── the endpoints ────────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('siwc-trial: the two bases are the real ones or a loopback fake', () => {
  // Every value is harmless if a broken guard accepts it: `status` sends nothing, and the `.invalid` name resolves
  // nowhere.
  const FORBIDDEN = [
    'https://127.0.0.1:1', 'http://localhost:1', 'http://127.0.0.1', 'http://127.0.0.1:1/v1', 'http://127.0.0.1:99999',
    'http://user@127.0.0.1:1', 'http://127.0.0.1.siwc.invalid:1', 'http://siwc.invalid:80', 'http://[::1]:1',
    'http://127.0.0.1:1?x=1', ' http://127.0.0.1:1',
  ];
  it.each(FORBIDDEN)('an override of %j is refused before the credential is read', (value) => {
    const home = mkTmp('siwc-base-');
    for (const [name, word] of [[AUTH_ENV, 'bad-auth-base'], [API_ENV, 'bad-api-base']] as const) {
      const r = trial(home, ['status', '--dir', path.join(home, 'trial')], { [name]: value });
      expect(r.status).toBe(1);
      // the base's own refusal, not `no-credential`: the override is judged before anything is read
      expect(refusal(r)).toMatch(new RegExp(`^${P}refused ${word}: `));
      expect(r.stdout + r.stderr, 'the value is never echoed').not.toContain(value.trim());
      expect(fs.existsSync(path.join(home, 'trial')), 'nothing was made').toBe(false);
    }
  });

  it('a forbidden API override sends nothing: no request, no count', async () => {
    const r = await signedIn();
    const port = new URL(r.api.base).port;
    for (const value of [`http://localhost:${port}`, `http://127.0.0.1:${port}/v1`, `http://[::1]:${port}`]) {
      const run = probe(r, ['--step', '1'], { ...r.env, [API_ENV]: value });
      expect(run.status).toBe(1);
      expect(refusal(run)).toMatch(new RegExp(`^${P}refused bad-api-base: `));
    }
    expect(r.api.log()).toEqual([]);
    expect(fs.existsSync(at(r, COUNT))).toBe(false);
  });

  it('inside a Claude Code session every verb is refused, and nothing is read, made or sent', async () => {
    const r = await rig();
    const all: string[][] = [
      ['signin', '--dir', r.dir, '--no-browser', '--wait', '1'], ['status', '--dir', r.dir], ['models', '--dir', r.dir],
      ['probe', '--dir', r.dir, '--model', MODEL, '--all'], ['signout', '--dir', r.dir],
    ];
    for (const args of all) {
      const run = trial(r.home, args, { ...r.env, CLAUDECODE: '1' });
      expect(run.status, args[0]).toBe(1);
      expect(refusal(run), args[0]).toMatch(new RegExp(`^${P}refused in-session: `));
      expect(run.stdout, args[0]).toBe('');
    }
    expect(fs.existsSync(r.dir)).toBe(false);
    expect(r.auth.log().concat(r.api.log())).toEqual([]);
    // an empty value is no session, as the tree's other session bumps read it
    expect(refusal(trial(r.home, ['status', '--dir', r.dir], { ...r.env, CLAUDECODE: '' }))).toMatch(/refused no-credential: /);
  });

  it('one base overridden without the other is refused', () => {
    const home = mkTmp('siwc-pair-');
    const env = childEnv(home, {});
    for (const name of [AUTH_ENV, API_ENV]) {
      const only = Object.fromEntries(Object.entries(env).filter(([k]) => k !== name));
      const r = spawnSync(PY!, ['-I', SCRIPT, 'status', '--dir', path.join(home, 'trial')], { cwd: home, env: only, encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(new RegExp(`^${P}refused base-pair: `));
    }
  });
});

// ── signin ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('siwc-trial signin: one loopback callback, one exchange, one credential record', () => {
  it('a first sign-in registers as a dynamic client, exchanges under PKCE and writes the record', async () => {
    const r = await rig();
    const s = await signin(r);
    expect(s.status, s.stderr).toBe(0);
    expect(s.callback.status).toBe(200);

    // the authorization request, as the sign-in page lists it
    const [q] = authorizeQueries(r);
    expect(Object.keys(q!).sort()).toEqual([
      'agent_name_hint', 'client_id', 'code_challenge', 'code_challenge_method', 'ext_agent_host_id', 'nonce',
      'redirect_uri', 'resource', 'response_type', 'scope', 'state',
    ]);
    expect(q).toMatchObject({
      client_id: 'dynamic_agent_client', agent_name_hint: 'ccrc', response_type: 'code', resource: RESOURCE,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', code_challenge_method: 'S256',
    });
    expect(q!.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:[0-9]+\/auth\/callback$/);
    expect(q!.ext_agent_host_id).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(q!.state.length).toBeGreaterThanOrEqual(32);
    expect(q!.nonce.length).toBeGreaterThanOrEqual(32);
    expect(q!.nonce).not.toBe(q!.state);

    // the exchange: the issued client id, the code, the verifier whose S256 digest is the challenge, the same
    // redirect_uri and resource; no secret, no scope
    const [form] = tokenForms(r, 'authorization_code');
    expect(Object.keys(form!).sort()).toEqual(['client_id', 'code', 'code_verifier', 'grant_type', 'redirect_uri', 'resource']);
    expect(form).toMatchObject({ client_id: CLIENT, redirect_uri: q!.redirect_uri, resource: RESOURCE });
    expect(form!.code_verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(createHash('sha256').update(form!.code_verifier as string).digest('base64url')).toBe(q!.code_challenge);

    // the record, in the page's shape, 0600 in a 0700 directory
    const c = cred(r);
    expect(Object.keys(c).sort()).toEqual([
      'access_token', 'client_id', 'earliest_refresh_at', 'email', 'expires_in', 'ext_agent_host_id', 'id_token',
      'issuer', 'refresh_token', 'saved_at', 'scopes', 'subject', 'token_type',
    ]);
    expect(c).toMatchObject({
      issuer: 'https://auth.openai.com', subject: 'sub-sentinel-0001', client_id: CLIENT, email: 'user@example.com',
      ext_agent_host_id: q!.ext_agent_host_id, token_type: 'Bearer', expires_in: 3600, scopes: ALL_SCOPES,
    });
    expect(issued(r)).toEqual(expect.arrayContaining([c.access_token, c.refresh_token, c.id_token]));
    expect(c.saved_at).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/);
    expect(Math.abs(Date.parse(c.saved_at as string) - Date.now())).toBeLessThan(60_000);
    expect(mode(r.dir)).toBe(0o700);
    expect(mode(at(r, CRED))).toBe(0o600);
    expect(mode(at(r, REG))).toBe(0o600);
    expect(mode(at(r, HOST))).toBe(0o600);
    expect(fs.readFileSync(at(r, HOST), 'utf8')).toBe(`${q!.ext_agent_host_id}\n`);
    expect(readJson(at(r, REG))).toEqual({ client_id: CLIENT, subject: 'sub-sentinel-0001' });
    expect(fs.readdirSync(r.dir).sort(), 'nothing is left beside the files').toEqual([CRED, HOST, 'lock', REG].sort());

    // the discovery document, read before the authorize URL is printed
    const out = lines(s.stdout);
    const published = ['issuer', 'authorization_endpoint', 'token_endpoint'].map((f) => `${P}discovery ${f} same`);
    expect(out.filter((l) => l.startsWith(`${P}discovery `))).toEqual(published);
    expect(out.indexOf(published[2]!)).toBeLessThan(out.findIndex((l) => l.startsWith(`${P}authorize-url `)));
    expect(r.auth.log()[0]!.route).toBe('discovery');

    // the three facts
    expect(out).toContain(`${P}plan-usage enabled`);
    expect(out.filter((l) => l.startsWith(`${P}scope `))).toEqual(ALL_SCOPES.map((n) => `${P}scope ${n}`));
    const left = Number(/^siwc-trial: expires-in ([0-9]+)$/m.exec(s.stdout)![1]);
    expect(left).toBeGreaterThan(3590);
    expect(left).toBeLessThanOrEqual(3600);
  });

  it('a second sign-in re-authorises with the saved client id, and replaces the record by a rename', async () => {
    const r = await signedIn();
    const before = fs.readFileSync(at(r, CRED));
    // a second name for the file the record is in now: a rename leaves it holding the old bytes, a write in place
    // would change it
    const witness = path.join(r.home, 'witness');
    fs.linkSync(at(r, CRED), witness);
    const s = await signin(r, (u) => { u.searchParams.delete('client_id'); return u; });
    expect(s.status, s.stderr).toBe(0);
    const [first, second] = authorizeQueries(r);
    expect(second!.client_id).toBe(CLIENT);
    expect(second, 'the name hint is for a first registration only').not.toHaveProperty('agent_name_hint');
    expect(second, 'the ID token is never put in a URL the tool prints').not.toHaveProperty('id_token_hint');
    expect(second).not.toHaveProperty('login_hint');
    expect(second!.ext_agent_host_id).toBe(first!.ext_agent_host_id);
    expect(second!.state).not.toBe(first!.state);
    expect(second!.nonce).not.toBe(first!.nonce);
    expect(second!.code_challenge).not.toBe(first!.code_challenge);
    expect(tokenForms(r, 'authorization_code')[1]!.client_id).toBe(CLIENT);
    expect(fs.readFileSync(witness).equals(before), 'the old file was never written into').toBe(true);
    expect(fs.readFileSync(at(r, CRED)).equals(before)).toBe(false);
    expect(fs.statSync(at(r, CRED)).nlink).toBe(1);
    expect(cred(r).access_token).not.toBe((JSON.parse(before.toString()) as Json).access_token);
    expect(fs.readdirSync(r.dir).sort()).toEqual([CRED, HOST, 'lock', REG].sort());
  });

  const NO_DISCOVERY: [string, Json, Env, string][] = [
    ['answers 500', { discovery_status: 500 }, {}, 'status 500'],
    ['is not a JSON object', { discovery_body: '["not an object, sentinel"]' }, {}, 'not a JSON object'],
    ['cannot be reached', {}, { [AUTH_ENV]: CLOSED }, 'ConnectionRefusedError'],
  ];
  it.each(NO_DISCOVERY)('a discovery document that %s refuses before the browser is given a URL', async (_what, config, env, why) => {
    const r = await rig();
    r.auth.config(config);
    const run = verb(r, 'signin', ['--no-browser', '--wait', '1'], { ...r.env, ...env });
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused auth-unreachable: .*\\(${why}\\)`));
    expect(run.stdout).not.toContain('authorize-url');
    expect(run.stdout + run.stderr).not.toMatch(/sentinel/i);
    expect(authorizeQueries(r)).toEqual([]);
    expect(fs.readdirSync(r.dir).sort(), 'the host id is chosen; nothing else is written').toEqual([HOST, 'lock']);
  });

  it('a discovery document whose endpoints differ from the pages is said so, and the pages\' are used', async () => {
    const r = await rig();
    r.auth.config({ discovery_fields: { token_endpoint: 'http://127.0.0.1:1/elsewhere-sentinel', issuer: null } });
    const s = await signin(r);
    expect(s.status, s.stderr).toBe(0);
    expect(lines(s.stdout).filter((l) => l.startsWith(`${P}discovery `))).toEqual([
      `${P}discovery issuer absent`, `${P}discovery authorization_endpoint same`, `${P}discovery token_endpoint differs`,
    ]);
    expect(tokenForms(r, 'authorization_code'), 'the code went to the token endpoint the page names').toHaveLength(1);
    expect(s.stdout + s.stderr).not.toMatch(/sentinel/i);
  });

  it('opens the browser at the authorize URL unless --no-browser', async () => {
    const r = await rig();
    const seen = path.join(r.home, 'browser-argv');
    const browser = path.join(r.home, 'browser.sh');
    fs.writeFileSync(browser, `#!/bin/sh\nprintf '%s\\n' "$@" > '${seen}'\n`, { mode: 0o755 });
    const p = startSignin(r, ['--wait', '20'], { ...r.env, BROWSER: browser });
    const url = await p.url;
    await hit(await authorize(url));
    const run = await p.done;
    expect(run.status, run.stderr).toBe(0);
    expect(fs.readFileSync(seen, 'utf8')).toBe(`${url}\n`);
    expect(lines(run.stdout)).toContain(`${P}browser opened`);

    const quiet = await signin(r);
    expect(lines(quiet.stdout)).toContain(`${P}browser skipped`);
  });

  const BAD_CALLBACKS: [string, string, Json, (u: URL) => URL][] = [
    ['a wrong state', 'state-mismatch', {}, (u) => { u.searchParams.set('state', 'not-the-state'); return u; }],
    ['no state', 'state-mismatch', {}, (u) => { u.searchParams.delete('state'); return u; }],
    ['access_denied', 'access-denied', { callback: 'access_denied' }, (u) => u],
    ['access_denied under a wrong state', 'state-mismatch', { callback: 'access_denied' },
      (u) => { u.searchParams.set('state', 'not-the-state'); return u; }],
    ['another OAuth error', 'callback-error', { callback: 'server_error' }, (u) => u],
    ['no code', 'no-code', { callback: 'no-code' }, (u) => u],
    ['no issued client id', 'registration-incomplete', { callback: 'no-client-id' }, (u) => u],
    ['the registration entry point as the issued id', 'registration-incomplete', { callback_client_id: 'dynamic_agent_client' }, (u) => u],
    ['a code given twice', 'callback-malformed', {}, (u) => { u.searchParams.append('code', 'another'); return u; }],
  ];
  it.each(BAD_CALLBACKS)('a callback with %s is refused %s and writes no credential', async (_what, word, config, edit) => {
    const r = await rig();
    r.auth.config(config);
    const s = await signin(r, edit);
    expect(s.status).toBe(1);
    expect(refusal(s)).toMatch(new RegExp(`^${P}refused ${word}: `));
    expect(s.callback.status).toBe(400);
    expect(s.callback.body).toContain(word);
    expect(tokenForms(r, 'authorization_code'), 'no code was exchanged').toEqual([]);
    expect(fs.existsSync(at(r, CRED))).toBe(false);
    expect(fs.existsSync(at(r, REG))).toBe(false);
  });

  it('a request on another path is answered 404 by name and is not the callback: the wait goes on, then ends', async () => {
    const r = await rig();
    const p = startSignin(r, ['--no-browser', '--wait', '2']);
    const back = await authorize(await p.url);
    back.pathname = '/callback';
    const stray = await hit(back);
    expect(stray.status).toBe(404);
    expect(stray.body).toContain('callback-path');
    const run = await p.done;
    expect(run.status).toBe(1);
    expect(lines(run.stderr).filter((l) => l.startsWith(`${P}refused `)).map((l) => l.slice(P.length).split(':')[0]))
      .toEqual(['refused callback-path', 'refused callback-timeout']);
    expect(tokenForms(r, 'authorization_code')).toEqual([]);
    expect(fs.existsSync(at(r, CRED))).toBe(false);
    expect(fs.existsSync(at(r, REG))).toBe(false);
  });

  it('after a request on another path the real callback still signs in', async () => {
    const r = await rig();
    const p = startSignin(r);
    const back = await authorize(await p.url);
    const stray = new URL(back);
    stray.pathname = '/favicon.ico';
    expect((await hit(stray)).status).toBe(404);
    expect((await hit(back)).status).toBe(200);
    const run = await p.done;
    expect(run.status, run.stderr).toBe(0);
    expect(cred(r).client_id).toBe(CLIENT);
  });

  it('a second callback refuses the attempt and writes no credential', async () => {
    const r = await rig();
    r.auth.config({ token_delay_ms: 4000 }); // the exchange is still in flight when the second callback arrives
    const p = startSignin(r);
    const back = await authorize(await p.url);
    const first = await hit(back);
    const second = await hit(back);
    const run = await p.done;
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toContain('second-callback');
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused second-callback: `));
    expect(fs.existsSync(at(r, CRED))).toBe(false);
    expect(fs.existsSync(at(r, REG))).toBe(false);
  });

  it('no callback within the wait is refused callback-timeout', async () => {
    const r = await rig();
    const run = await startSignin(r, ['--no-browser', '--wait', '1']).done;
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused callback-timeout: `));
    expect(fs.existsSync(at(r, CRED))).toBe(false);
  });

  it('on re-authorisation a callback naming another client id is refused, and the record stands', async () => {
    const r = await signedIn();
    const before = fs.readFileSync(at(r, CRED));
    r.auth.config({ callback_client_id: 'oaiapp_another' });
    const s = await signin(r);
    expect(s.status).toBe(1);
    expect(refusal(s)).toMatch(new RegExp(`^${P}refused client-changed: `));
    expect(tokenForms(r, 'authorization_code')).toHaveLength(1);
    expect(fs.readFileSync(at(r, CRED)).equals(before)).toBe(true);
    expect(readJson(at(r, REG)).client_id).toBe(CLIENT);
  });

  const BAD_ID_TOKENS: [string, string, Json][] = [
    ['another audience', 'id-token-audience', { id_claims: { aud: 'oaiapp_another' } }],
    ['an audience list without the client id', 'id-token-audience', { id_claims: { aud: ['oaiapp_another'] } }],
    ['no audience', 'id-token-audience', { id_claims: { aud: null } }],
    ['another issuer', 'id-token-issuer', { id_claims: { iss: 'https://auth.siwc.invalid' } }],
    ['another nonce', 'id-token-nonce', { id_claims: { nonce: 'not-the-nonce' } }],
    ['no nonce', 'id-token-nonce', { id_claims: { nonce: null } }],
    ['an expiry in the past', 'id-token-expired', { id_claims: { exp: 1_700_000_000 } }],
    ['no expiry', 'id-token-expired', { id_claims: { exp: null } }],
    ['an expiry that is not a number', 'id-token-expired', { id_claims: { exp: 'never' } }],
    ['no subject', 'id-token-subject', { id_claims: { sub: null } }],
    ['no claims at all', 'id-token-unreadable', { id_token: 'not-a-jwt-sentinel' }],
  ];
  it.each(BAD_ID_TOKENS)('an ID token with %s is refused %s and writes no credential', async (_what, word, config) => {
    const r = await rig();
    r.auth.config(config);
    const s = await signin(r);
    expect(s.status).toBe(1);
    expect(refusal(s)).toMatch(new RegExp(`^${P}refused ${word}: `));
    expect(tokenForms(r, 'authorization_code'), 'the code was exchanged; the answer was refused').toHaveLength(1);
    expect(fs.existsSync(at(r, CRED))).toBe(false);
    expect(fs.existsSync(at(r, REG))).toBe(false);
  });

  it('an audience that is a list holding the issued client id is accepted', async () => {
    const r = await signedIn({ aud_list: true });
    expect(cred(r).client_id).toBe(CLIENT);
  });

  it('a returning sign-in whose subject is another account is refused, and the record stands', async () => {
    const r = await signedIn();
    const before = fs.readFileSync(at(r, CRED));
    r.auth.config({ subject: 'sub-sentinel-0002' });
    const s = await signin(r);
    expect(s.status).toBe(1);
    expect(refusal(s)).toMatch(new RegExp(`^${P}refused account-changed: `));
    expect(fs.readFileSync(at(r, CRED)).equals(before)).toBe(true);
    expect(readJson(at(r, REG)).subject).toBe('sub-sentinel-0001');
  });

  it('a token answer without the plan scope writes the record, says so, and probe and models send nothing', async () => {
    const r = await rig();
    r.auth.config({ scope: 'email offline_access openid profile' });
    const s = await signin(r);
    expect(s.status, s.stderr).toBe(0);
    expect(lines(s.stdout)).toContain(`${P}plan-usage not-enabled`);
    expect(cred(r).scopes).toEqual(['email', 'offline_access', 'openid', 'profile']);
    expect(lines(verb(r, 'status').stdout)).toContain(`${P}plan-usage not-enabled`);
    for (const run of [probe(r, ['--step', '1']), probe(r, ['--all']), verb(r, 'models')]) {
      expect(run.status).toBe(1);
      expect(refusal(run)).toMatch(new RegExp(`^${P}refused plan-usage-not-enabled: `));
    }
    expect(r.api.log()).toEqual([]);
    expect(fs.existsSync(at(r, COUNT))).toBe(false);
  });

  it('a refused exchange is named by its code, and a code that echoes what was sent is not printed', async () => {
    const r = await rig();
    r.auth.config({ exchange_error: { status: 400, body: { error: 'invalid_grant', error_description: 'description sentinel' } } });
    const s = await signin(r);
    expect(s.status).toBe(1);
    expect(refusal(s)).toMatch(new RegExp(`^${P}refused exchange-refused: .*\\(400 invalid_grant\\)`));
    expect(fs.existsSync(at(r, CRED))).toBe(false);

    r.auth.config({ exchange_error: { status: 400, body: 'echo' } });
    const echoed = await signin(r);
    expect(echoed.status).toBe(1);
    expect(refusal(echoed)).toMatch(new RegExp(`^${P}refused exchange-refused: .*\\(400 unrecognised\\)`));
    for (const secret of issued(r)) expect(echoed.stdout + echoed.stderr).not.toContain(secret);
  });

  it('a token answer that is not the documented shape is refused', async () => {
    const r = await rig();
    r.auth.config({ expires_in: 'soon' });
    const s = await signin(r);
    expect(s.status).toBe(1);
    expect(refusal(s)).toMatch(new RegExp(`^${P}refused token-answer-malformed: `));
    expect(fs.existsSync(at(r, CRED))).toBe(false);
  });

  it('with no --dir the directory is ~/.config/ccrc-siwc-trial, made 0700; a missing parent is refused', async () => {
    const r = await rig();
    const fallback = path.join(r.home, '.config', 'ccrc-siwc-trial');
    expect(refusal(trial(r.home, ['status'], r.env))).toMatch(new RegExp(`^${P}refused no-credential: `));
    const bare = trial(r.home, ['signin', '--no-browser', '--wait', '1'], r.env);
    expect(bare.status).toBe(1);
    expect(refusal(bare)).toMatch(new RegExp(`^${P}refused dir-unusable: `));
    expect(fs.existsSync(path.join(r.home, '.config')), 'the parent is never made').toBe(false);
    fs.mkdirSync(path.join(r.home, '.config'));
    const p = startSignin(r, ['--no-browser', '--wait', '20'], r.env, []);
    await hit(await authorize(await p.url));
    const s = await p.done;
    expect(s.status, s.stderr).toBe(0);
    expect(mode(path.join(fallback, CRED))).toBe(0o600);
    expect(mode(fallback)).toBe(0o700);
    expect(lines(trial(r.home, ['status'], r.env).stdout)).toContain(`${P}plan-usage enabled`);
    expect(trial(r.home, ['status', '--dir', ''], r.env).status, 'an empty --dir is a usage error').toBe(2);
  });

  it('a directory that is a symlink is refused', async () => {
    const r = await rig();
    const real = path.join(r.home, 'real');
    fs.mkdirSync(real, { mode: 0o755 });
    fs.symlinkSync(real, r.dir);
    const run = verb(r, 'signin', ['--no-browser', '--wait', '1']);
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused dir-unusable: `));
    expect(fs.readdirSync(real)).toEqual([]);
    expect(mode(real), 'the link target keeps its mode').toBe(0o755);
  });

  it('a host id that cannot be read is refused, never replaced', async () => {
    const r = await rig();
    fs.mkdirSync(r.dir, { mode: 0o700 });
    fs.writeFileSync(at(r, HOST), 'not a host id\n', { mode: 0o600 });
    const run = verb(r, 'signin', ['--no-browser', '--wait', '1']);
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused host-id-unreadable: `));
    expect(fs.readFileSync(at(r, HOST), 'utf8')).toBe('not a host id\n');
    expect(authorizeQueries(r)).toEqual([]);
  });

  it('a second run on one directory is refused busy while the first holds it', async () => {
    const r = await signedIn();
    const p = startSignin(r, ['--no-browser', '--wait', '20']);
    await p.url;
    const run = probe(r, ['--step', '1']);
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused busy: `));
    expect(r.api.log()).toEqual([]);
    expect(lines(verb(r, 'status').stdout), 'status only reads').toContain(`${P}plan-usage enabled`);
  });
});

// ── status ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('siwc-trial status: three facts from the record, no request', () => {
  it('prints plan usage, the scope names and the seconds to expiry, with both bases closed', async () => {
    const r = await signedIn();
    const before = { auth: r.auth.log().length, api: r.api.log().length };
    const s = verb(r, 'status', [], {});
    expect(s.status, s.stderr).toBe(0);
    expect(s.stderr).toBe('');
    const out = lines(s.stdout);
    expect(out[0]).toBe(`${P}plan-usage enabled`);
    expect(out.slice(1, -1)).toEqual(ALL_SCOPES.map((n) => `${P}scope ${n}`));
    expect(out.at(-1)).toMatch(/^siwc-trial: expires-in 3[0-9]{3}$/);
    expect({ auth: r.auth.log().length, api: r.api.log().length }).toEqual(before);

    expire(r);
    const old = verb(r, 'status', [], {});
    expect(old.status).toBe(0);
    expect(lines(old.stdout).at(-1)).toMatch(/^siwc-trial: expires-in -[0-9]+$/);
    expect(r.auth.log().length, 'status never refreshes').toBe(before.auth);
  });

  it('no record, or one out of shape, is refused by name', async () => {
    const r = await rig();
    const none = verb(r, 'status');
    expect(none.status).toBe(1);
    expect(refusal(none)).toMatch(new RegExp(`^${P}refused no-credential: `));
    fs.mkdirSync(r.dir, { mode: 0o700 });
    fs.writeFileSync(at(r, CRED), '{"access_token": "token-sentinel-in-a-broken-record"', { mode: 0o600 });
    const broken = verb(r, 'status');
    expect(broken.status).toBe(1);
    expect(refusal(broken)).toMatch(new RegExp(`^${P}refused credential-unreadable: `));
    expect(broken.stdout + broken.stderr).not.toMatch(/sentinel/i);
  });
});

// ── models ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('siwc-trial models: the slugs and their visibility', () => {
  it('lists each model, counts the request and identifies itself as ccrc', async () => {
    const r = await signedIn();
    const m = verb(r, 'models');
    expect(m.status, m.stderr).toBe(0);
    const out = lines(m.stdout);
    expect(out).toContain(`${P}request 1 of ${CAP}`);
    expect(out).toContain(`${P}status 200`);
    expect(out).toContain(`${P}header x-request-id`);
    expect(out.filter((l) => l.startsWith(`${P}model `))).toEqual([`${P}model model-fixture-a list`, `${P}model model-fixture-b hide`]);
    expect(m.stdout).not.toMatch(/sentinel/i);
    const [req] = r.api.log();
    expect(req!.route).toBe('models');
    expect(req!.headers.authorization).toBe(`Bearer ${cred(r).access_token}`);
    expect(req!.headers.originator).toBe('ccrc');
    expect(req!.headers['user-agent']).toMatch(/^ccrc-siwc-trial\/[0-9]+$/);
    expect(fs.readFileSync(at(r, COUNT), 'utf8')).toBe('1\n');
  });

  it('an answer that is not 200 is exit 3, named by its shape', async () => {
    const r = await signedIn();
    r.api.config({ mode: 'detail-401' });
    const m = verb(r, 'models');
    expect(m.status).toBe(3);
    expect(lines(m.stdout)).toEqual(expect.arrayContaining([`${P}status 401`, `${P}error-shape detail`]));
    expect(m.stdout + m.stderr).not.toMatch(/sentinel/i);
  });
});

// ── probe ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('siwc-trial probe: the numbered requests, each counted, sent and recorded', () => {
  it('--all sends every step once (16 twice): each body store:false and stream:true, no unsupported field but in step 21', async () => {
    const r = await signedIn();
    const run = probe(r, ['--all']);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stderr).toBe('');
    const requests = sent(r);
    expect(requests).toHaveLength(SENT.length);
    const bodies = requests.map((q) => q.body as Json);
    const of = (step: number): Json => bodies[SENT.indexOf(step)]!;
    const token = cred(r).access_token as string;

    requests.forEach((q, i) => {
      const body = q.body as Json;
      const where = `request ${i + 1}, step ${SENT[i]}`;
      expect(body.store, where).toBe(false);
      expect(body.stream, where).toBe(true);
      expect(body.model, where).toBe(MODEL);
      expect(Array.isArray(body.input), where).toBe(true);
      expect((body.input as Json[]).filter((x) => x.role === 'system'), where).toEqual([]);
      expect(Object.keys(body).filter((k) => UNSUPPORTED.includes(k)), where)
        .toEqual(SENT[i] === DELIBERATE ? ['max_output_tokens'] : []);
      // the identity the terms ask for, and the token only in its header
      expect(q.headers.authorization, where).toBe(`Bearer ${token}`);
      expect(q.headers.originator, where).toBe('ccrc');
      expect(q.headers['user-agent'], where).toMatch(/^ccrc-siwc-trial\/[0-9]+$/);
      expect(q.headers['content-type'], where).toBe('application/json');
      expect(JSON.stringify(body), where).not.toContain(token);
    });

    // each step's own shape
    const fn = (tools: Json[]): Json => (tools[0]!.type === 'namespace' ? (tools[0]!.tools as Json[])[0]! : tools[0]!);
    expect(of(1)).not.toHaveProperty('instructions');
    expect(of(1).input[0]).toMatchObject({ type: 'message', role: 'developer' });
    expect(of(1).input[1]).toMatchObject({ type: 'message', role: 'user' });
    expect(Object.keys(of(1)).sort()).toEqual(['input', 'model', 'store', 'stream']);
    expect(typeof of(2).instructions).toBe('string');
    expect((of(2).input as Json[]).map((x) => x.role)).toEqual(['user']);
    expect(of(3).tools).toHaveLength(1);
    expect(of(3).tools[0]).toMatchObject({ type: 'namespace', name: 'functions' });
    expect(fn(of(3).tools as Json[])).toMatchObject({ type: 'function', name: 'probe_echo' });
    expect(of(4).tools[0]).toMatchObject({ type: 'function', name: 'probe_echo' });
    expect(of(5)).not.toHaveProperty('tools');
    const late = items(of(5), 'additional_tools');
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ role: 'developer', tools: [{ type: 'namespace', name: 'functions' }] });
    expect((of(5).input as Json[]).indexOf(late[0]!), 'the tools arrive after the first exchange').toBeGreaterThan(2);
    expect(of(6).parallel_tool_calls).toBe(true);
    // step 7: step 6's two calls under toolu_-shaped ids, a result for each, none of the upstream's ids
    const calls = items(of(7), 'function_call');
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.call_id).toMatch(/^toolu_01[0-9a-f]{22}$/);
      expect(c).toMatchObject({ name: 'probe_echo', namespace: 'functions' });
      expect(c).not.toHaveProperty('id');
    }
    expect(new Set(calls.map((c) => c.call_id as string)).size).toBe(2);
    expect(calls.map((c) => c.arguments)).toEqual(['{"word": "one"}', '{"word": "two"}']);
    expect(items(of(7), 'function_call_output').map((o) => o.call_id)).toEqual(calls.map((c) => c.call_id));
    expect(JSON.stringify(of(7))).not.toMatch(/call_sentinel|fc_sentinel/);
    // step 8: a tool result whose content holds a 1x1 PNG
    const [result] = items(of(8), 'function_call_output');
    expect(items(of(8), 'function_call')[0]!.call_id).toBe(result!.call_id);
    expect(result!.call_id).toMatch(/^toolu_01[0-9a-f]{22}$/);
    const image = (result!.output as Json[]).find((p) => p.type === 'input_image')!;
    const png = Buffer.from((image.image_url as string).replace(/^data:image\/png;base64,/, ''), 'base64');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], 'IHDR: one pixel by one').toEqual([1, 1]);
    expect(of(9).tool_choice).toBe('required');
    expect(of(10).tool_choice).toEqual({ type: 'function', name: 'probe_echo' });
    expect(of(11).tool_choice).toBe('none');
    expect((fn(of(12).tools as Json[]).name as string)).toMatch(/^[A-Za-z0-9_-]{70}$/);
    expect(of(13).include).toEqual(['reasoning.encrypted_content']);
    expect(of(13).reasoning).toEqual({ effort: 'medium' });
    expect(of(13).tools[0].type).toBe('namespace');
    // steps 14 and 15: step 13's reasoning item before its call, with and without its id
    for (const [step, withId] of [[14, true], [15, false]] as const) {
      const input = of(step).input as Json[];
      const at13 = input.findIndex((x) => x.type === 'reasoning');
      expect(input[at13]!.encrypted_content, `step ${step}`).toMatch(/^gAAAAAB-sentinel/);
      expect('id' in input[at13]!, `step ${step}`).toBe(withId);
      expect(input[at13 + 1]!.type, `step ${step}`).toBe('function_call');
      expect(input[at13 + 1]!.call_id, `step ${step}`).toMatch(/^toolu_01[0-9a-f]{22}$/);
      expect(input[at13 + 2], `step ${step}`).toMatchObject({ type: 'function_call_output', call_id: input[at13 + 1]!.call_id });
      expect(of(step).include, `step ${step}`).toEqual(['reasoning.encrypted_content']);
    }
    expect(of(14).input[2].id).toMatch(/^rs_sentinel/);
    expect(bodies.filter((_, i) => SENT[i] === 16).map((b) => b.reasoning)).toEqual([{ effort: 'low' }, { effort: 'high' }]);
    expect(of(17).text.format).toMatchObject({ type: 'json_schema', strict: true, schema: { type: 'object' } });
    expect(typeof of(18).prompt_cache_key).toBe('string');
    expect(of(19)).toEqual(of(18));
    expect(of(20)).not.toHaveProperty('prompt_cache_key');
    expect({ ...of(18), prompt_cache_key: undefined }).toEqual({ ...of(20), prompt_cache_key: undefined });
    expect(JSON.stringify(of(18).input).length, 'long enough for a prompt cache to engage').toBeGreaterThan(4096);
    expect(of(21)).toEqual({ ...of(1), max_output_tokens: of(21).max_output_tokens });

    // what it printed: each step and its description, the request's number, names and numbers
    const out = lines(run.stdout);
    for (const s of STEPS) expect(out.filter((l) => l.startsWith(`${P}step ${s} `)), `step ${s}`).toHaveLength(1);
    expect(out.filter((l) => /^siwc-trial: request [0-9]+ of 60/.test(l)).map((l) => Number(l.split(' ')[2])))
      .toEqual(SENT.map((_, i) => i + 1));
    expect(out.filter((l) => l === `${P}status 200`)).toHaveLength(SENT.length - 1);
    expect(out.filter((l) => l === `${P}status 400`)).toHaveLength(1);
    expect(out).toEqual(expect.arrayContaining([
      `${P}header x-request-id`, `${P}header x-fixture-usage-primary`, `${P}header content-type`,
      `${P}event response.created`, `${P}event response.output_text.delta`, `${P}event response.completed`,
      `${P}item message`, `${P}item function_call`, `${P}item reasoning`, `${P}terminal response.completed`,
      `${P}usage input_tokens 1100`, `${P}usage input_tokens_details.cached_tokens 0`,
      `${P}usage input_tokens_details.cached_tokens 1024`, `${P}usage output_tokens_details.reasoning_tokens 3`,
      `${P}error-shape error-object`, `${P}error-code subscription_sharing_unsupported_capability`,
      `${P}error-param max_output_tokens`, `${P}error-type invalid_request_error`,
    ]));
    for (const l of out) expect(l.startsWith(P), l).toBe(true);

    // the count, the recordings and the request bodies beside them
    expect(fs.readFileSync(at(r, COUNT), 'utf8')).toBe(`${SENT.length}\n`);
    expect(mode(at(r, COUNT))).toBe(0o600);
    expect(mode(recDir(r))).toBe(0o700);
    const files = recordings(r);
    expect(files).toHaveLength(SENT.length);
    files.forEach((f, i) => {
      const m = /^siwc-([0-9]+)-[0-9]{8}T[0-9]{6}Z-([0-9]+)\.sse$/.exec(f);
      expect(m, f).not.toBeNull();
      expect([Number(m![1]), Number(m![2])], f).toEqual([SENT[i], i + 1]);
      expect(out, f).toContain(`${P}recorded ${f}`);
      const file = path.join(recDir(r), f);
      expect(mode(file), f).toBe(0o600);
      // the head, a blank line, then the body exactly as the fake sent it, as record.py reads a recording
      const answered = requests[i]!.answered as Json;
      expect(splitHead(file), f).toEqual({ status: answered.status, sha256: answered.sha256, bytes: answered.bytes });
      const raw = fs.readFileSync(file, 'utf8');
      expect(raw.startsWith(`HTTP/1.1 ${answered.status}\n`), f).toBe(true);
      expect(raw.slice(0, raw.indexOf('\n\n')), 'the head keeps the header values').toContain('\nx-fixture-usage-primary: header-sentinel-value-42');
      const request = file.replace(/\.sse$/, '.request.json');
      expect(mode(request), f).toBe(0o600);
      expect(readJson(request), f).toEqual(bodies[i]);
    });
    expect(fs.readdirSync(recDir(r))).toHaveLength(2 * SENT.length);
    expect(tokenForms(r, 'refresh_token'), 'a token that has not expired is never refreshed').toEqual([]);
  }, 120_000);

  it('record.py scrub accepts the recordings of a reply, a call, two calls and a reasoning item', async () => {
    const r = await signedIn();
    for (const step of [1, 3, 6, 13]) expect(probe(r, ['--step', String(step)]).status).toBe(0);
    for (const f of recordings(r)) {
      const out = path.join(r.home, `${f}.scrubbed`);
      const s = spawnSync(PY!, ['-I', RECORD_PY, 'scrub', path.join(recDir(r), f), out], { encoding: 'utf8' });
      expect(s.status, `${f}: ${s.stderr}`).toBe(0);
      const text = fs.readFileSync(out, 'utf8');
      expect(text, f).toContain('event: response.completed\n');
      expect(text, f).not.toMatch(/sentinel/i);
    }
  }, 60_000);

  it('the count is raised before the request is sent: a request that dies is still counted', async () => {
    const r = await signedIn();
    r.api.config({ mode: 'drop' });
    const run = probe(r, ['--step', '1']);
    expect(run.status).toBe(3);
    expect(lines(run.stdout).some((l) => l.startsWith(`${P}transport `))).toBe(true);
    expect(sent(r)).toHaveLength(1);
    expect(fs.readFileSync(at(r, COUNT), 'utf8')).toBe('1\n');
    // and a request that never left: nothing listens on the API base
    const closed = probe(r, ['--step', '1'], { ...r.env, [API_ENV]: CLOSED });
    expect(closed.status).toBe(3);
    expect(lines(closed.stdout)).toContain(`${P}transport ConnectionRefusedError`);
    expect(fs.readFileSync(at(r, COUNT), 'utf8')).toBe('2\n');
    expect(sent(r)).toHaveLength(1);
  });

  it('the cap stops the next request, for probe and for models', async () => {
    const r = await signedIn();
    fs.writeFileSync(at(r, COUNT), `${CAP - 1}\n`, { mode: 0o600 });
    // step 16 is two requests: the first is the last the cap allows
    const run = probe(r, ['--step', '16']);
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused count-exhausted: `));
    expect(lines(run.stdout)).toContain(`${P}request ${CAP} of ${CAP} effort low`);
    expect(sent(r)).toHaveLength(1);
    expect(fs.readFileSync(at(r, COUNT), 'utf8')).toBe(`${CAP}\n`);
    for (const more of [probe(r, ['--step', '1']), probe(r, ['--all']), verb(r, 'models')]) {
      expect(more.status).toBe(1);
      expect(refusal(more)).toMatch(new RegExp(`^${P}refused count-exhausted: `));
    }
    expect(r.api.log()).toHaveLength(1);
    expect(fs.readFileSync(at(r, COUNT), 'utf8')).toBe(`${CAP}\n`);
  });

  it('a count file that is not a whole number is refused, never read as zero', async () => {
    const r = await signedIn();
    fs.writeFileSync(at(r, COUNT), 'many\n', { mode: 0o600 });
    const run = probe(r, ['--step', '1']);
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused count-unreadable: `));
    expect(r.api.log()).toEqual([]);
    expect(fs.readFileSync(at(r, COUNT), 'utf8')).toBe('many\n');
  });

  it('an expired access token is refreshed once, and the new tokens replace the old in one rename', async () => {
    const r = await signedIn();
    const old = cred(r);
    expire(r);
    const witness = path.join(r.home, 'witness');
    fs.linkSync(at(r, CRED), witness);
    const stale = fs.readFileSync(witness);
    const run = probe(r, ['--step', '1']);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(lines(run.stdout)).toContain(`${P}refresh done`);
    const forms = tokenForms(r, 'refresh_token');
    expect(forms).toHaveLength(1);
    // the refresh request, as the accounts page gives it: no scope, so the grant is kept
    expect(forms[0]).toEqual({ grant_type: 'refresh_token', client_id: CLIENT, refresh_token: old.refresh_token, resource: RESOURCE });
    const now = cred(r);
    expect(now.access_token).not.toBe(old.access_token);
    expect(now.refresh_token).not.toBe(old.refresh_token);
    expect(issued(r)).toEqual(expect.arrayContaining([now.access_token, now.refresh_token]));
    expect(now).toMatchObject({ client_id: CLIENT, subject: old.subject, id_token: old.id_token, scopes: ALL_SCOPES, expires_in: 3600 });
    expect(Math.abs(Date.parse(now.saved_at as string) - Date.now())).toBeLessThan(60_000);
    expect(sent(r)[0]!.headers.authorization, 'the request carries the new token').toBe(`Bearer ${now.access_token}`);
    expect(fs.readFileSync(witness).equals(stale), 'the old file was never written into').toBe(true);
    expect(mode(at(r, CRED))).toBe(0o600);
    // the next run finds a token that has not expired
    expect(probe(r, ['--step', '1']).status).toBe(0);
    expect(tokenForms(r, 'refresh_token')).toHaveLength(1);
  });

  it.each(['refresh_token_reused', 'invalid_grant'])('a refresh refused %s needs a new signin and is never tried again', async (code) => {
    const r = await signedIn();
    expire(r);
    r.auth.config({ refresh_error: { status: 400, body: { error: code } } });
    const run = probe(r, ['--step', '1']);
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused needs-signin: .*\\(400 ${code}\\).*signin`));
    expect(tokenForms(r, 'refresh_token')).toHaveLength(1);
    expect(r.api.log()).toEqual([]);
    expect(fs.existsSync(at(r, COUNT))).toBe(false);
    expect(cred(r).refresh_token, 'the dead refresh token is cleared').toBeNull();
    // later runs send nothing, to either base
    r.auth.config({});
    for (const again of [probe(r, ['--step', '1']), verb(r, 'models')]) {
      expect(again.status).toBe(1);
      expect(refusal(again)).toMatch(new RegExp(`^${P}refused needs-signin: `));
    }
    expect(tokenForms(r, 'refresh_token')).toHaveLength(1);
    expect(r.api.log()).toEqual([]);
  });

  it('a refresh that fails for another reason keeps the tokens, and a code that echoes the token is not printed', async () => {
    const r = await signedIn();
    expire(r);
    const before = fs.readFileSync(at(r, CRED));
    r.auth.config({ refresh_error: { status: 503, body: { error: 'temporarily_unavailable' } } });
    const run = probe(r, ['--step', '1']);
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused refresh-failed: .*\\(503 temporarily_unavailable\\)`));
    expect(fs.readFileSync(at(r, CRED)).equals(before)).toBe(true);
    expect(r.api.log()).toEqual([]);

    r.auth.config({ refresh_error: { status: 503, body: 'echo' } });
    const echoed = probe(r, ['--step', '1']);
    expect(refusal(echoed)).toMatch(new RegExp(`^${P}refused refresh-failed: .*\\(503 unrecognised\\)`));
    expect(echoed.stdout + echoed.stderr).not.toContain(cred(r).refresh_token as string);
    expect(tokenForms(r, 'refresh_token')).toHaveLength(2);
  });

  it('an expired token with no refresh token needs a new signin', async () => {
    const r = await signedIn({ no_refresh_token: true });
    expect(cred(r).refresh_token).toBeNull();
    expect(probe(r, ['--step', '1']).status, 'the access token still works until it expires').toBe(0);
    expire(r);
    const run = probe(r, ['--step', '1']);
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused needs-signin: `));
    expect(tokenForms(r, 'refresh_token')).toEqual([]);
    expect(sent(r)).toHaveLength(1);
  });

  it('a round trip needs the recording it replays: 7 after 6, 14 and 15 after 13', async () => {
    const r = await signedIn();
    for (const [step, word] of [[7, 'step-6-first'], [14, 'step-13-first'], [15, 'step-13-first']] as const) {
      const run = probe(r, ['--step', String(step)]);
      expect(run.status).toBe(1);
      expect(refusal(run)).toMatch(new RegExp(`^${P}refused ${word}: `));
    }
    // a recording of step 6 that is not a 2xx answer is not replayed either
    r.api.config({ mode: 'not-eligible' });
    expect(probe(r, ['--step', '6']).status).toBe(3);
    r.api.config({});
    expect(refusal(probe(r, ['--step', '7']))).toMatch(new RegExp(`^${P}refused step-6-first: `));
    expect(sent(r)).toHaveLength(1);
    expect(fs.readFileSync(at(r, COUNT), 'utf8')).toBe('1\n');
  });

  it('a plan refusal is named by its code, is exit 3, and stops --all at its step', async () => {
    const r = await signedIn();
    r.api.config({ mode: 'not-eligible' });
    const run = probe(r, ['--all']);
    expect(run.status).toBe(3);
    const out = lines(run.stdout);
    expect(out).toEqual(expect.arrayContaining([
      `${P}status 403`, `${P}error-shape error-object`, `${P}error-code subscription_sharing_user_not_eligible`,
      `${P}stopped at step 1`,
    ]));
    expect(out.some((l) => l.startsWith(`${P}error-param`)), 'a null param prints nothing').toBe(false);
    expect(sent(r)).toHaveLength(1);
    expect(recordings(r)).toHaveLength(1);
    expect(splitHead(path.join(recDir(r), recordings(r)[0]!)).status).toBe(403);
    expect(run.stdout + run.stderr).not.toMatch(/sentinel/i);
  });

  it('an admission refusal with no error object is named by its shape, never its text', async () => {
    const r = await signedIn();
    r.api.config({ mode: 'detail-401' });
    const run = probe(r, ['--step', '1']);
    expect(run.status).toBe(3);
    expect(lines(run.stdout)).toEqual(expect.arrayContaining([`${P}status 401`, `${P}error-shape detail`]));
    expect(run.stdout + run.stderr).not.toMatch(/sentinel/i);
  });

  it.each([
    ['failed', 3, ['terminal response.failed', 'error-code subscription_sharing_usage_limit_exceeded']],
    ['incomplete', 0, ['terminal response.incomplete', 'incomplete-reason max_output_tokens', 'usage output_tokens 7']],
    ['no-terminal', 3, ['terminal none']],
  ] as const)('a stream that ends %s is exit %i', async (how, status, expected) => {
    const r = await signedIn();
    r.api.config({ mode: how });
    const run = probe(r, ['--step', '1']);
    expect(run.status, run.stdout).toBe(status);
    expect(lines(run.stdout)).toEqual(expect.arrayContaining(expected.map((l) => P + l)));
    expect(recordings(r), 'whatever came is recorded').toHaveLength(1);
    expect(run.stdout + run.stderr).not.toMatch(/sentinel/i);
  });

  it('an error code or param that echoes the access token is not printed', async () => {
    // the record's token is made short and lower-case, the shape a code's bound would let through
    const r = await signedIn();
    const short = 'tok-sentinel-0123456789abcdef';
    fs.writeFileSync(at(r, CRED), JSON.stringify({ ...cred(r), access_token: short }));
    r.api.config({ mode: 'echo-code' });
    const run = probe(r, ['--step', '1']);
    expect(run.status).toBe(0); // a 400 is an answer the trial records
    expect(lines(run.stdout)).toEqual(expect.arrayContaining([`${P}error-code unrecognised`, `${P}error-param unrecognised`]));
    expect(run.stdout + run.stderr).not.toContain(short);
  });

  it('a recordings path that is not a directory refuses before anything is counted or sent', async () => {
    const r = await signedIn();
    fs.writeFileSync(recDir(r), 'planted\n', { mode: 0o600 });
    const run = probe(r, ['--step', '1']);
    expect(run.status).toBe(1);
    expect(refusal(run)).toMatch(new RegExp(`^${P}refused recordings-unusable: `));
    expect(r.api.log()).toEqual([]);
    expect(fs.existsSync(at(r, COUNT))).toBe(false);
    expect(fs.readFileSync(recDir(r), 'utf8')).toBe('planted\n');
  });

  it('usage: a missing model, a step out of range, both --step and --all, an unknown verb', async () => {
    const r = await signedIn();
    const bad: string[][] = [
      ['probe', '--dir', r.dir, '--step', '1'], ['probe', '--dir', r.dir, '--model', MODEL],
      ['probe', '--dir', r.dir, '--model', MODEL, '--step', '0'], ['probe', '--dir', r.dir, '--model', MODEL, '--step', '22'],
      ['probe', '--dir', r.dir, '--model', MODEL, '--step', '1', '--all'], ['probe', '--dir', r.dir, '--model', 'a b', '--step', '1'],
      ['status', '--dir', r.dir, '--model', MODEL], ['signin', '--dir', r.dir, '--wait', '0'], ['signin', '--dir', r.dir, '--wait', '901'],
      ['token', '--dir', r.dir], [],
    ];
    for (const args of bad) {
      const run = trial(r.home, args, r.env);
      expect(run.status, args.join(' ')).toBe(2);
      expect(run.stderr, args.join(' ')).toMatch(/^siwc-trial: usage: /);
    }
    expect(r.api.log()).toEqual([]);
  });
});

// ── signout ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('siwc-trial signout: the refresh token revoked, the record deleted', () => {
  it('revokes at the published endpoint and deletes the record; the registration, host id and recordings stay', async () => {
    const r = await signedIn();
    expect(probe(r, ['--step', '1']).status).toBe(0);
    const c = cred(r);
    const mark = r.auth.log().length;
    const out = verb(r, 'signout');
    expect(out.status, out.stderr).toBe(0);
    expect(lines(out.stdout)).toEqual([`${P}revocation confirmed`, `${P}credential deleted`]);
    const log = r.auth.log().slice(mark);
    expect(log.map((e) => e.route), 'the discovery document, then the revocation').toEqual(['discovery', 'revoke']);
    expect(log.filter((e) => e.route === 'revoke').map((e) => e.form)).toEqual([
      { token: c.refresh_token, token_type_hint: 'refresh_token', client_id: CLIENT },
    ]);
    expect(fs.existsSync(at(r, CRED))).toBe(false);
    expect(readJson(at(r, REG))).toEqual({ client_id: CLIENT, subject: c.subject });
    expect(fs.existsSync(at(r, HOST))).toBe(true);
    expect(recordings(r)).toHaveLength(1);
    // and the next sign-in is a re-authorisation of the same registration
    const again = await signin(r);
    expect(again.status, again.stderr).toBe(0);
    expect(authorizeQueries(r).at(-1)!.client_id).toBe(CLIENT);
    expect(authorizeQueries(r).at(-1)).not.toHaveProperty('agent_name_hint');
  });

  it.each([
    ['absent', 'none-published'],
    ['elsewhere', 'endpoint-elsewhere'],
  ])('a revocation endpoint that is %s: says so, sends the token nowhere, deletes the record, exit 3', async (how, word) => {
    const r = await signedIn();
    r.auth.config({ revocation: how });
    const out = verb(r, 'signout');
    expect(out.status).toBe(3);
    expect(lines(out.stdout)).toEqual([`${P}revocation unconfirmed ${word}`, `${P}credential deleted`]);
    expect(out.stderr).toMatch(/ChatGPT/);
    expect(r.auth.log().filter((e) => e.route === 'revoke')).toEqual([]);
    expect(fs.existsSync(at(r, CRED))).toBe(false);
  });

  it.each([
    ['the revocation answers 503', { revocation_status: 503 }, 'status-503'],
    ['the discovery document cannot be fetched', { discovery_status: 500 }, 'discovery-failed'],
  ] as const)('when %s the record is kept, exit 3', async (_what, config, word) => {
    const r = await signedIn();
    const before = fs.readFileSync(at(r, CRED));
    r.auth.config(config);
    const out = verb(r, 'signout');
    expect(out.status).toBe(3);
    expect(lines(out.stdout)).toEqual([`${P}revocation unconfirmed ${word}`, `${P}credential kept`]);
    expect(fs.readFileSync(at(r, CRED)).equals(before)).toBe(true);
  });

  it('with no record there is nothing to sign out of', async () => {
    const r = await rig();
    const out = verb(r, 'signout');
    expect(out.status).toBe(1);
    expect(refusal(out)).toMatch(new RegExp(`^${P}refused no-credential: `));
    expect(r.auth.log()).toEqual([]);
  });
});

// ── what is printed ──────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('siwc-trial prints names and numbers, never a value', () => {
  it('no token, code, verifier, ID token, email, id or prompt is printed by any verb', async () => {
    const r = await rig();
    const runs: Run[] = [];
    runs.push(await signin(r));
    runs.push(verb(r, 'status'));
    runs.push(verb(r, 'models'));
    runs.push(probe(r, ['--all']));
    expire(r);
    runs.push(probe(r, ['--step', '1'])); // a refresh
    runs.push(await signin(r)); // a re-authorisation
    runs.push(verb(r, 'signout'));
    runs.push(verb(r, 'status')); // a refusal
    expect(runs.map((x) => x.status)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    const all = runs.map((x) => x.stdout + x.stderr).join('\n');
    // the one line that carries values is the authorize URL, which the browser must be given
    const rest = lines(all).filter((l) => !l.startsWith(`${P}authorize-url `)).join('\n');

    // every secret the fakes issued, whole and by JWT segment
    const secrets = issued(r);
    expect(secrets.length).toBeGreaterThanOrEqual(2 + 3 + 2 + 3);
    for (const s of secrets) {
      expect(all).not.toContain(s);
      for (const part of s.split('.').filter((x) => x.length >= 16)) expect(all).not.toContain(part);
    }
    // every id, text, encrypted content and header value the fakes send carries this word
    expect(all).not.toMatch(/sentinel/i);
    expect(all).not.toContain('user@example.com');
    // what the tool itself made: the verifier nowhere; state, nonce, challenge, host id and client id only in the URL
    const queries = authorizeQueries(r);
    const forms = tokenForms(r, 'authorization_code');
    expect(queries).toHaveLength(2);
    for (const f of forms) expect(all).not.toContain(f.code_verifier as string);
    for (const q of queries) {
      for (const key of ['state', 'nonce', 'code_challenge', 'ext_agent_host_id']) {
        expect(all, key).toContain(encodeURIComponent(q[key] as string));
        expect(rest, key).not.toContain(q[key] as string);
      }
    }
    expect(rest).not.toContain(CLIENT);
    // the prompts: every text the requests carried
    const prompts = new Set(sent(r).flatMap((q) => texts(q.body)).filter((t) => t.length >= 12));
    expect(prompts.size).toBeGreaterThan(5);
    for (const t of prompts) expect(all).not.toContain(t);
    // and every line is the tool's own
    for (const l of lines(all)) expect(l.startsWith(P), l).toBe(true);
    expect(all).not.toContain('Traceback');
  }, 120_000);

  it('the authorize URL carries no token, no ID token hint and no email', async () => {
    const r = await signedIn();
    const p = startSignin(r);
    const url = new URL(await p.url);
    await hit(await authorize(url.toString()));
    await p.done;
    expect(url.origin + url.pathname).toBe(`${r.auth.base}/api/accounts/authorize`);
    expect([...url.searchParams.keys()].sort()).toEqual([
      'client_id', 'code_challenge', 'code_challenge_method', 'ext_agent_host_id', 'nonce', 'redirect_uri', 'resource',
      'response_type', 'scope', 'state',
    ]);
  });
});

// ── the file ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe.skipIf(!PY)('siwc-trial.py: standard library only, Python 3.9 grammar', () => {
  it('parses as Python 3.9 and imports nothing but the standard library and the bridge package', () => {
    const code = [
      'import ast, sys',
      'tree = ast.parse(open(sys.argv[1], encoding="utf-8").read(), feature_version=(3, 9))',
      'names = set()',
      'for node in ast.walk(tree):',
      '    if isinstance(node, ast.Import):',
      '        names.update(a.name.split(".")[0] for a in node.names)',
      '    elif isinstance(node, ast.ImportFrom) and node.level == 0:',
      '        names.add((node.module or "").split(".")[0])',
      'std = getattr(sys, "stdlib_module_names", None)',
      'print(" ".join(sorted(n for n in names if n != "codexbridge" and std is not None and n not in std)))',
    ].join('\n');
    const r = spawnSync(PY!, ['-I', '-c', code, SCRIPT], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('refuses to run without -I, before it imports anything but sys', () => {
    const home = mkTmp('siwc-iso-');
    const r = spawnSync(PY!, [SCRIPT, 'status', '--dir', path.join(home, 'trial')], { cwd: home, env: childEnv(home, {}), encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^siwc-trial: refused not-isolated: /);
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const imports = [...src.matchAll(/^(?:import|from) (\S+)/gm)].map((m) => m[1]);
    expect(imports[0]).toBe('sys');
    expect(src.indexOf('sys.flags.isolated')).toBeLessThan(src.indexOf(`\nimport ${imports[1]}`));
  });

  it('turns bytecode writing off before it imports the bridge package (-I ignores PYTHONDONTWRITEBYTECODE)', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const off = src.indexOf('sys.dont_write_bytecode = True');
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(src.indexOf('from codexbridge import'));
    expect(src.indexOf('from codexbridge import')).toBeGreaterThan(-1);
  });
});
