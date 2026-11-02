// The canary (spec §16, server half; D-5513, D-5516; accounts plan Task A17, D-7739). A pasted Anthropic token goes
// through `POST /api/accounts` and `POST /api/accounts/:id/credential` on the real server, the real account gate and
// step-up, the real reconciling wrapper and the real `reloadRoster`, and then through the local `AccountOps` arm and,
// separately, the real in-process agent over a real loopback socket, to the REAL `ccrc account` verb in a fixture HOME
// (`laneStateFixture.ts`). The verb's one child that sees the token, the upstream `claude` the probe runs, is a stub
// that ECHOES THE TOKEN ON STDERR. The canary must then be found only in the lane's 0600 secret file: not in any answer
// or refusal, any coord.db table (`feed_events`, the mail outbox and `account_events` among them), any other file of the
// HOME (the lane-state file, the status files, the push and notify stores), or anything the server or the agent wrote to
// stdout, stderr or the console.
//
// END TO END FOR A SHAPELESS KEY (the plan's `compatible` case): the canary has no credential shape, so only its
// fingerprint can mask it. `compatible` is CLI-only (spec §13.2), so the shapeless key is pasted as an Anthropic token,
// which takes the same answer path: the add's `fingerprints` ingested by `reloadRoster` into the masker's table, never a
// planted row. A transcript `env` dump of it then reaches the session socket only masked, and so does the same echo in
// pane history, the feed and a push body. Nothing here is real-shaped except the two assembled shapes the dump carries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';

const sent = vi.hoisted(() => [] as string[]);
vi.mock('web-push', () => {
  class WebPushError extends Error { statusCode = 0; }
  return {
    default: { setVapidDetails: () => {}, sendNotification: async (_s: unknown, body: string) => { sent.push(body); } },
    WebPushError,
  };
});

import { buildServer, type Deps } from '../src/server.js';
import { loadConfig, reloadRoster, rosterAnswerOf } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIOFor } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { AccountAudit, actorOf } from '../src/accounts/audit.js';
import { localAccountOps, remoteAccountOps, type AccountOps } from '../src/accounts/ops.js';
import { reconcilingAccountOps } from '../src/accounts/reconcile.js';
import { SecretMasker, fingerprintAnswerOf } from '../src/accounts/mask.js';
import { PushService } from '../src/push.js';
import type { FleetIdentityCell } from '../src/fleetidentity.js';
import type { FleetState } from '../src/fleetstate.js';
import type { PtyLike } from '../src/pty.js';
import type { RunningAgent } from '../../agent/src/server.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import { SECRET_MASK } from '../../shared/api.js';
import { HAVE_FLOCK, NODE_ID, boxEnv, laneBox } from './laneStateFixture.js';
import { bootAgent, connectToAgent } from './remoteHelpers.js';
import { mkTmp } from './tmpHelpers.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const BOX_TOKEN = 'box-token-a17-canary-fixture-0123456789abcdef';
const ORIGIN = 'http://localhost:7788';
const LANE = 'lane-p';
/** A canary the stub probe accepts (`GOOD-`), unique to the run so no other file can hold it by chance. No shape. */
const canary = (tag: string): string => `GOOD-a17-${tag}-${randomBytes(12).toString('hex')}`;
/** One the stub probe refuses with a 401. */
const refusedCanary = (): string => `NOPE-a17-${randomBytes(12).toString('hex')}`;

// Two assembled credential shapes for the dump, built at run time from neutral filler so no file holds a whole one.
const fill = (n: number, salt: string, hex = false): string => {
  let s = '';
  for (let i = 0; s.length < n; i++) s += createHash('sha256').update(`${salt}:${i}`).digest(hex ? 'hex' : 'base64url');
  return s.slice(0, n);
};
const OAT = ['sk', 'ant', 'oat01', fill(95, 'a17-oat')].join('-');
const ORKEY = ['sk', 'or', 'v1', fill(64, 'a17-or', true)].join('-');

/** No 8-character slice of `secret` appears in `text`. */
const leaksNone = (text: string, secret: string): boolean => {
  for (let i = 0; i + 8 <= secret.length; i++) if (text.includes(secret.slice(i, i + 8))) return false;
  return true;
};

/** The upstream launcher the verb's probe runs: it ECHOES the token on stderr, then answers by its first word. */
function plantEchoingProbe(home: string): void {
  writeFileSync(path.join(home, '.local', 'bin', 'claude'), [
    '#!/bin/sh',
    'printf \'the token in my environment is %s\\n\' "$CLAUDE_CODE_OAUTH_TOKEN" >&2',
    'case "$CLAUDE_CODE_OAUTH_TOKEN" in',
    '  GOOD-*) echo \'{"type":"result","subtype":"success","is_error":false,"result":"ok"}\'; exit 0 ;;',
    '  *) echo \'{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","api_error_status":401,"result":"Invalid bearer token"}\'; exit 1 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });
}

/**
 * A STUB VERB, the server's own child, that echoes ON STDERR the secret it is handed and the one the lane already
 * holds (spec §16's stub child at the arm's seam): `add` and `credential` write the new one to the lane's secrets file
 * at 0600 and answer the roster; a `NOPE-` secret is refused `key-rejected`. Whatever a port or the route did with a
 * child's stderr would carry a canary, and the lane's own one is not the request's to mask.
 */
const STUB_VERB = `import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.HOME;
const [, sub, ...rest] = process.argv.slice(2);
const id = (rest.find((a) => a.startsWith('--id=')) ?? '').slice(5);
const secret = rest.includes('--credential=-') ? readFileSync(0, 'utf8') : '';
let held = '';
try { held = readFileSync(join(home, '.cc-secrets', id + '-oauth.env'), 'utf8'); } catch { held = ''; }
process.stderr.write('stub verb: the secret on my stdin is ' + secret + '; the lane holds ' + held + '\\n');
const file = join(home, '.ccrc', 'accounts.json');
const roster = JSON.parse(readFileSync(file, 'utf8'));
const node = readFileSync(join(home, '.ccrc', 'node-id'), 'utf8').trim();
const answer = (o) => { process.stdout.write(JSON.stringify(o) + '\\n'); };
if (secret.startsWith('NOPE-')) { answer({ ok: false, error: 'key-rejected', detail: 'refused: ' + secret }); process.exit(1); }
if (sub === 'add') {
  roster.accounts.push({ id, label: 'lane·p', configDirSuffix: '.claude-' + id, homeAble: true, hue: 'amber', telemetry: 'anthropic',
    exec: { kind: 'generated', secretsFile: '.cc-secrets/' + id + '-oauth.env' } });
  writeFileSync(file, JSON.stringify(roster, null, 2) + '\\n');
}
if (sub === 'add' || sub === 'credential') {
  mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.cc-secrets', id + '-oauth.env'), 'export CLAUDE_CODE_OAUTH_TOKEN=' + secret + '\\n', { mode: 0o600 });
}
answer({ ok: true, id, roster, fleetIdentity: node });
`;

/** Every regular file under `root`, symlinks never followed (the tree under `ccrc/` is the repository's). */
function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** The files of the HOME that hold `secret` (its bytes or its base64), as paths relative to the HOME. */
function holders(home: string, secret: string): string[] {
  const forms = [secret, Buffer.from(secret).toString('base64').replace(/=+$/, '')].map((f) => Buffer.from(f));
  return filesUnder(home).filter((f) => {
    const b = readFileSync(f);
    return forms.some((x) => b.includes(x));
  }).map((f) => path.relative(home, f)).sort();
}

interface Box {
  home: string; app: FastifyInstance; coord: CoordStore; masker: SecretMasker; cookie: string;
  bodies: string[]; out: string[]; pane: { text: string };
}

const opened: Array<() => Promise<void> | void> = [];
let savedPath: string | undefined;
let savedLang: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of opened.splice(0).reverse()) await close();
  if (savedPath !== undefined) process.env['PATH'] = savedPath;
  if (savedLang === undefined) delete process.env['LANG']; else process.env['LANG'] = savedLang;
  savedPath = undefined;
});

/** A fixture box with the real verb, a server over it, and the arm `arm` between them. Every write the server and
 *  the agent make to stdout, stderr or the console is captured into `out`, and every answer body into `bodies`. */
async function openBox(arm: 'local' | 'agent', verb: 'real' | 'stub' = 'real'): Promise<Box> {
  const home = laneBox(`ccrc-canary-${arm}-`);
  plantEchoingProbe(home);
  mkdirSync(path.join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(home, '.cc-secrets', 'ccrc-mail.token'), `${BOX_TOKEN}\n`, { mode: 0o600 });
  // The launcher both arms spawn: the box's own `ccrc`, as a deployed box has it, or the echoing stub verb.
  if (verb === 'stub') writeFileSync(path.join(home, 'stub-verb.mjs'), STUB_VERB);
  writeFileSync(path.join(home, '.local', 'bin', 'ccrc'), verb === 'real'
    ? '#!/bin/sh\nexec bash "$HOME/ccrc/ccd/ccrc" "$@"\n' : '#!/bin/sh\nexec node "$HOME/stub-verb.mjs" "$@"\n', { mode: 0o755 });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  // The arms hand the verb exactly {HOME, PATH, LANG} of this process: PATH is the fixture's, with its poisons first.
  savedPath = process.env['PATH'];
  savedLang = process.env['LANG'];
  process.env['PATH'] = boxEnv(home)['PATH'];

  const out: string[] = [];
  const keep = (...a: unknown[]): void => { out.push(a.map(String).join(' ')); };
  for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, m).mockImplementation(keep);
  for (const s of [process.stdout, process.stderr]) {
    vi.spyOn(s, 'write').mockImplementation(((chunk: unknown) => { out.push(String(chunk)); return true; }) as typeof s.write);
  }

  const base = loadConfig({ CCRC_HOME: home });
  const cfg = { ...base, authEnabled: true, cookieSecure: false, rpId: 'localhost', origin: ORIGIN };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const audit = new AccountAudit(coord.db);
  const masker = new SecretMasker({ db: coord.db, token: () => BOX_TOKEN });
  let inner: AccountOps;
  if (arm === 'local') {
    inner = localAccountOps({ home });
  } else {
    const projectsRoot = mkTmp('ccrc-canary-projects-');
    const agent: RunningAgent = await bootAgent({ home, projectsRoot });
    opened.push(() => agent.close());
    const fleet: ConnectedFleet = connectToAgent(agent.port, { requestTimeoutMs: 200_000 });
    opened.push(() => fleet.close());
    await vi.waitFor(() => expect(fleet.client.state.agentOps ?? []).toContain('account'), { timeout: 10_000 });
    inner = remoteAccountOps({ client: fleet.client });
  }
  const accountOps = reconcilingAccountOps(inner, {
    // The real answer path: every answer that carries a roster feeds `reloadRoster`, which offers its fingerprints.
    reload: (stdout) => {
      const a = rosterAnswerOf(stdout, fingerprintAnswerOf);
      return a === null ? null : reloadRoster(cfg, a, {
        fleetIdentity: () => NODE_ID, fingerprints: { offer: (f, keepLanes) => masker.offer(f, keepLanes) },
      });
    },
    audit, fleetIdentity: () => NODE_ID, actor: actorOf('ccrc server', ''),
  });
  const pane = { text: '' };
  const run: Runner = async (_c, args) => {
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: pane.text, stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });
  const deps: Deps = {
    cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIOFor(cfg.home), queue: new KeyedQueue(),
    coord, mailToken: BOX_TOKEN, spawnPty: stubPty, masker, accountAudit: audit, accountOps,
    fleetState: { ccdVerbs: ['account-v2'] } as unknown as FleetState,
    fleetIdentity: { current: () => ({ kind: 'known', connectionEpoch: 1, nodeId: NODE_ID, measuredAt: 0 }) } as unknown as FleetIdentityCell,
  };
  const app = await buildServer(deps, new Bus());
  await app.ready();
  opened.push(() => app.close());
  const bodies: string[] = [];
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(login.statusCode, login.body).toBe(204);
  const set = login.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  const cookie = line.slice(0, line.indexOf(';'));
  const up = await app.inject({ method: 'POST', url: '/api/auth/step-up/passphrase', headers: { cookie }, payload: { passphrase: PASSPHRASE } });
  expect(up.statusCode, up.body).toBe(200);
  return { home, app, coord, masker, cookie, bodies, out, pane };
}

const ask = async (b: Box, url: string, payload: object): Promise<{ status: number; json: Record<string, unknown> }> => {
  const res = await b.app.inject({ method: 'POST', url, headers: { cookie: b.cookie }, payload });
  b.bodies.push(res.body);
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
};
const addLane = (b: Box, credential: string) => ask(b, '/api/accounts', {
  provider: 'anthropic', id: LANE, label: 'lane·p', hue: 'amber', method: 'paste', credential,
});

/** What the canary must never be in: every answer, every captured write, every coord.db row; and among the HOME's
 *  files, only the lane's own secret file, at 0600. */
function expectOnlyInTheSecretFile(b: Box, secret: string, where: 'secret-file' | 'nowhere'): void {
  const answers = b.bodies.join('\n');
  expect(answers.includes(secret), 'an answer or refusal carried the canary').toBe(false);
  expect(answers.includes(Buffer.from(secret).toString('base64').replace(/=+$/, '')), 'an answer carried its base64').toBe(false);
  expect(b.out.join('\n').includes(secret), 'the server or the agent wrote the canary to stdout, stderr or the console').toBe(false);
  const tables = (b.coord.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  expect(tables).toEqual(expect.arrayContaining(['account_events', 'feed_events']));
  for (const t of tables) {
    const rows = JSON.stringify(b.coord.db.prepare(`SELECT * FROM "${t}"`).all());
    expect(rows.includes(secret), `coord.db table ${t} holds the canary`).toBe(false);
  }
  const secretFile = path.join('.cc-secrets', `${LANE}-oauth.env`);
  expect(holders(b.home, secret)).toEqual(where === 'secret-file' ? [secretFile] : []);
  if (where === 'secret-file') expect((statSync(path.join(b.home, secretFile)).mode & 0o777).toString(8)).toBe('600');
}

// ── the session the transcript echo lives in ────────────────────────────────────────────────────────────────────────
const SID = 'lane-b-demo';
const UUID = 'b'.repeat(36);
const WORKDIR = '/data/projects/demo';
const PID = 40617;
function seedSession(home: string, transcript: string): void {
  const reg = path.join(home, '.cc-sessions');
  for (const [k, v] of Object.entries({ wrapper: 'lane-b', project: 'demo', workdir: WORKDIR, uuid: UUID, started: '1' })) {
    writeFileSync(path.join(reg, `${SID}.${k}`), v);
  }
  const sess = path.join(home, '.claude-lane-b', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID, cwd: WORKDIR, name: 'demo-b1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
  }));
  const tdir = path.join(home, '.claude-lane-b', 'projects', WORKDIR.replace(/\//g, '-'));
  mkdirSync(tdir, { recursive: true });
  writeFileSync(path.join(tdir, `${UUID}.jsonl`), transcript);
}
const userLine = (text: string): string => `${JSON.stringify({
  uuid: 'c'.repeat(36), parentUuid: null, isSidechain: false, timestamp: '2026-11-01T21:00:00.000Z', type: 'user',
  message: { role: 'user', content: text },
})}\n`;

async function backlogFrame(b: Box): Promise<string> {
  await b.app.listen({ host: '127.0.0.1', port: 0 });
  const a = b.app.server.address();
  const port = typeof a === 'object' && a !== null ? a.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${SID}`, { headers: { cookie: b.cookie, origin: ORIGIN } });
  try {
    return await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no backlog')), 10_000);
      ws.on('message', (d) => {
        const s = String(d);
        if ((JSON.parse(s) as { type: string }).type === 'backlog') { clearTimeout(t); resolve(s); }
      });
      ws.on('error', reject);
    });
  } finally { ws.close(); }
}

describe('the canary: a pasted token is found only in its 0600 secret file (spec §16)', () => {
  it.each(['local', 'agent'] as const)('paste-add, a refused replacement and a replacement, through the %s arm, with a child that echoes the token on stderr', async (arm) => {
    const b = await openBox(arm);
    const first = canary('add');
    const add = await addLane(b, first);
    expect(add.status, JSON.stringify(add.json)).toBe(200);
    expect(add.json['fleetIdentity']).toBe(NODE_ID);
    expect(add.json).not.toHaveProperty('credential');
    expectOnlyInTheSecretFile(b, first, 'secret-file');

    const refused = refusedCanary();
    const no = await ask(b, `/api/accounts/${LANE}/credential`, { credential: refused });
    expect(no.json).toEqual({ ok: false, error: 'key-rejected' });
    expectOnlyInTheSecretFile(b, refused, 'nowhere');
    expectOnlyInTheSecretFile(b, first, 'secret-file');

    const second = canary('credential');
    const yes = await ask(b, `/api/accounts/${LANE}/credential`, { credential: second });
    expect(yes.status, JSON.stringify(yes.json)).toBe(200);
    expectOnlyInTheSecretFile(b, second, 'secret-file');
    // The replaced token is gone from the box entirely: no backup of it was kept.
    expectOnlyInTheSecretFile(b, first, 'nowhere');

    // The reads a screen makes after the acts carry none of them either.
    const read = await b.app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: b.cookie } });
    b.bodies.push(read.body);
    expectOnlyInTheSecretFile(b, second, 'secret-file');
    // Every act wrote one row, and the rows hold no value: the add, the refused replacement and the replacement.
    const rows = b.coord.db.prepare("SELECT act, outcome, code FROM account_events WHERE act != 'reconcile' ORDER BY id").all();
    expect(rows).toEqual([
      { act: 'add', outcome: 'ok', code: null }, { act: 'credential', outcome: 'refused', code: 'key-rejected' },
      { act: 'credential', outcome: 'ok', code: null },
    ]);
  }, 400_000);

  it.each(['local', 'agent'] as const)('the same acts through the %s arm, with the verb itself a stub that echoes the secret on stderr', async (arm) => {
    const b = await openBox(arm, 'stub');
    const first = canary('stub-add');
    const add = await addLane(b, first);
    expect(add.status, JSON.stringify(add.json)).toBe(200);
    const refused = refusedCanary();
    // The word, read alone: whatever else a refusal carried is the canary checks' to judge.
    expect((await ask(b, `/api/accounts/${LANE}/credential`, { credential: refused })).json['error']).toBe('key-rejected');
    // The stub echoed both the refused secret and the lane's own on its stderr: neither reached an answer.
    expectOnlyInTheSecretFile(b, refused, 'nowhere');
    expectOnlyInTheSecretFile(b, first, 'secret-file');
    const second = canary('stub-credential');
    expect((await ask(b, `/api/accounts/${LANE}/credential`, { credential: second })).status).toBe(200);
    expectOnlyInTheSecretFile(b, refused, 'nowhere');
    expectOnlyInTheSecretFile(b, first, 'nowhere');
    expectOnlyInTheSecretFile(b, second, 'secret-file');
  }, 120_000);

  it('a shapeless key pasted through the route and the real agent is masked end to end, through the real answer path', async () => {
    const b = await openBox('agent');
    const key = canary('shapeless');
    // Nothing is in the masker's table before the add: no planted row.
    expect(b.coord.db.prepare('SELECT COUNT(*) AS n FROM secret_fingerprints').get()).toEqual({ n: 0 });
    const add = await addLane(b, key);
    expect(add.status, JSON.stringify(add.json)).toBe(200);
    expectOnlyInTheSecretFile(b, key, 'secret-file');
    expect((b.coord.db.prepare('SELECT laneId FROM secret_fingerprints').all() as { laneId: string }[]).map((r) => r.laneId)).toEqual([LANE]);

    // A session on another lane dumps its environment into its transcript, the shapeless key and two shapes in it.
    const dump = `$ env\nCLAUDE_CODE_OAUTH_TOKEN=${key}\nOTHER=${OAT}\nOR=${ORKEY}\n`;
    seedSession(b.home, userLine(dump));
    const frame = await backlogFrame(b);
    expect(frame).toContain(SECRET_MASK);
    for (const s of [key, OAT, ORKEY]) expect(leaksNone(frame, s), `the session socket leaked ${s.slice(0, 8)}…`).toBe(true);

    // The same echo in pane history, the feed and a push body.
    b.pane.text = dump;
    const history = await b.app.inject({ method: 'GET', url: `/api/sessions/${SID}/pane/history`, headers: { cookie: b.cookie } });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.body).toContain(SECRET_MASK);
    expect(leaksNone(history.body, key)).toBe(true);
    b.coord.recordFeedEvent('e1', { seq: 1, at: 1, kind: 'ask', sessionId: SID, title: `token ${key}`, body: dump, runId: null });
    const feed = await b.app.inject({ method: 'GET', url: '/api/feed', headers: { cookie: b.cookie } });
    expect(feed.statusCode, feed.body).toBe(200);
    expect(feed.body).toContain(SECRET_MASK);
    expect(leaksNone(feed.body, key)).toBe(true);
    sent.length = 0;
    const push = new PushService({ publicKey: 'p', privateKey: 'k', subject: 'mailto:someone@example.invalid' },
      path.join(b.home, '.ccrc', 'push-subs.json'), b.masker);
    await push.subscribe({ endpoint: 'https://push.example.invalid/1', keys: { p256dh: 'x', auth: 'y' } });
    await push.notify({ title: `token ${key}`, body: `the session printed ${key}` });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(SECRET_MASK);
    expect(leaksNone(sent[0]!, key)).toBe(true);
  }, 400_000);
});
