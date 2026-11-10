// D-7411, D-7554 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB9; spec 2026-10-28 §2.7). The test box's
// three doors in `coord/routes.ts`, over a bare Fastify (the roll-idle route suite's idiom):
//  - `POST /api/testbox/switch` writes and removes `$REG/testbox-remote-live` through the REAL `ccd testbox-remote`
//    verb, which the runner reaches only across the agent's exec whitelist (`testDeps`' guard), and refuses any body
//    but `{on: boolean}`;
//  - `GET /api/testbox` answers the poll's block, `null` before its first pass;
//  - `POST /api/testbox/tools-sync` takes no body and answers the op's outcome;
//  - armed, the read and the sync take a session OR the box token (D-7554), and the switch is not exempt.
// Every ccd call runs against a fixture HOME (`makeCcdHarness`), never the live one.
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { Bus } from '../src/bus.js';
import { EXEMPT, type GateDecision } from '../src/auth/gate.js';
import type { FleetWatcher } from '../src/watch.js';
import type { Runner } from '../src/exec.js';
import type { MeasuredTestbox, TestboxSyncAsked } from '../src/io.js';
import { TestboxLane } from '../src/testboxLane.js';
import { notRanSentence } from '../src/unmeasured.js';
import { TESTBOX_PROTO, type StatusAnswer } from '../../shared/testbox.js';
import { TESTBOX_ADMIN_CAP, TESTBOX_PARITY_REQUIRED_SENTENCE } from '../../shared/api.js';
import type { TestboxAdminStatus, TestboxAdminSub } from '../../shared/testbox-admin.js';
import { openCoordDb } from '../src/coord/db.js';
import { TestboxAudit } from '../src/testboxAudit.js';
import type { TestboxAdminOps, TestboxAdminOutcome } from '../src/testboxAdmin.js';
import type { FleetState } from '../src/fleetstate.js';
import { TESTBOX_REMOTE_LIVE_MARKER } from '../../shared/switches.js';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { testDeps } from './helpers.js';

const TOKEN = 'b'.repeat(64);
const HEADER = 'x-ccrc-mail-token';
const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const STATUS: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900', tools: TOOLS,
  sync: { state: 'idle', detail: null, at: null }, runs: { inProgress: 0, limit: 2 }, queueDepth: 0, pristine: [],
  failedKeys: [], heldRunUsers: [], repositories: [],
};
const MEASURED: MeasuredTestbox = {
  ok: true, reply: { host: { tools: TOOLS, release: 'v0.0.900', measuredAt: '2026-10-30T12:00:00Z' }, pollMs: 30_000, box: { ok: true, status: STATUS } },
};
const SENT: TestboxSyncAsked = {
  ok: true, reply: { outcome: 'sent', detail: null, frame: { t: 'tools.sync', release: 'v0.0.900', versions: TOOLS, measuredAt: '2026-10-30T12:00:00Z' } },
};

/** D-8166: `--state on` needs a passing parity record that matches the pin and the box file, so every route row that raises
 *  the marker starts from one (the gate's own rows are in testbox-remote-gate.test.ts). */
function seedPassingParity(home: string): void {
  const fp = `SHA256:${'A'.repeat(43)}`;
  const sha = 'a'.repeat(64);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'testbox-parity.json'), `${JSON.stringify({ v: 1, result: 'pass', prs: [], fixtures: [], release: 'v0.0.900', toolsKey: 'k', fingerprint: fp, boxFileSha256: sha, at: 1 })}\n`);
  writeFileSync(path.join(home, '.ccrc', 'testbox-admin.state'), `fingerprint=${fp}\nbox_sha256=${sha}\n`);
}

const apps: FastifyInstance[] = [];
const harnesses: CcdHarness[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const h of harnesses.splice(0)) h.cleanup();
});

/** The runner the agent would be: the real ccd dispatcher, under the fixture HOME. `testDeps` guards it with the
 *  agent's whitelist, so an argv the whitelist refuses never reaches it. */
const realCcd = (h: CcdHarness, argvs: string[][]): Runner => (_cmd, args) => new Promise((resolve) => {
  argvs.push(args);
  const env = ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home }, { systemd: true, tmux: true });
  execFile('bash', [CCD, ...args], { cwd: h.home, env, encoding: 'utf8' }, (err, stdout, stderr) => {
    resolve({ ran: true, code: err === null ? 0 : typeof err.code === 'number' ? err.code : 1, stdout, stderr });
  });
});

/** The connect surface's `status` as the switch gate reads it (TC13): what the fake ops port answers. `armable` is a passing
 *  record that matches the pin and the box file `seedPassingParity` wrote; `none` has no record; `mismatch` has a pass for
 *  another box file; `no-op` is an agent that does not carry the op; `absent` is a server with no ops port at all. */
type AdminMode = 'armable' | 'none' | 'mismatch' | 'no-op' | 'unanswered' | 'absent';
const PIN = `SHA256:${'A'.repeat(43)}`;
const BOX_SHA = 'a'.repeat(64);
const adminStatus = (mode: AdminMode): TestboxAdminStatus => ({
  v: 1, connected: true, addressSet: true, login: 'root', fingerprint: PIN, hostKey: 'pinned', boxFileSha256: BOX_SHA, act: null,
  boxSettings: null, boxSettingsAt: null,
  parity: mode === 'none' ? null : {
    v: 1, result: 'pass', prs: [], fixtures: [], release: 'v0.0.900', toolsKey: 'k', fingerprint: PIN,
    boxFileSha256: mode === 'mismatch' ? 'b'.repeat(64) : BOX_SHA, at: 1,
  },
});

interface Setup {
  app: FastifyInstance; h: CcdHarness; argvs: string[][]; syncs: () => number; marker: string;
  mode: (m: AdminMode) => void; adminAsked: () => TestboxAdminSub[]; rows: () => { act: string; outcome: string; code: string | null }[];
}

async function setup(o: {
  armed?: boolean; session?: boolean; watcher?: boolean; verbs?: string[] | null; sync?: TestboxSyncAsked; runner?: Runner; admin?: AdminMode;
} = {}): Promise<Setup> {
  const h = makeCcdHarness('ccrc-testbox-routes-');
  harnesses.push(h);
  seedPassingParity(h.home);
  const argvs: string[][] = [];
  const base = testDeps(h.home, o.runner ?? realCcd(h, argvs));
  let syncs = 0;
  let mode: AdminMode = o.admin ?? 'armable';
  const asked: TestboxAdminSub[] = [];
  const ops: TestboxAdminOps = {
    arm: 'remote',
    run: async (sub): Promise<TestboxAdminOutcome> => {
      asked.push(sub);
      if (mode === 'no-op') return { kind: 'unsupported' };
      if (mode === 'unanswered') return { kind: 'lost' };
      return { kind: 'exited', code: 0, stdout: `${JSON.stringify(adminStatus(mode))}\n` };
    },
  };
  const audit = new TestboxAudit(openCoordDb(path.join(h.home, '.ccrc', 'coord.db')));
  const io = { ...base.io, testboxMeasured: async () => MEASURED, testboxToolsSync: async () => { syncs += 1; return o.sync ?? SENT; } };
  // The default fleet carries the connect surface's cap beside the switch verb, so the gate's `unsupported` arm is its own row.
  const fleetState = { ccdVerbs: o.verbs ?? ['testbox-remote', TESTBOX_ADMIN_CAP] } as unknown as FleetState;
  const deps: Deps = {
    ...base, io, cfg: { ...base.cfg, authEnabled: o.armed ?? false }, mailToken: TOKEN, fleetState, testboxAudit: audit,
    ...(o.admin === 'absent' ? {} : { testboxAdmin: ops }),
  };
  const lane = new TestboxLane(() => deps);
  const watcher = o.watcher === false ? undefined : ({ testboxLane: lane } as unknown as FleetWatcher);
  const sessionAuth = (): GateDecision => (o.session ?? true
    ? { allow: true, verdict: 'ok', reason: 'session', device: null }
    : { allow: false, verdict: 'no-session', reason: 'no-session', device: null } as unknown as GateDecision);
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, watcher);
  apps.push(app);
  return {
    app, h, argvs, syncs: () => syncs, marker: path.join(h.home, '.cc-sessions', TESTBOX_REMOTE_LIVE_MARKER),
    mode: (m) => { mode = m; }, adminAsked: () => asked,
    rows: () => audit.recent(50).reverse().map((r) => ({ act: r.act, outcome: r.outcome, code: r.code })),
  };
}

const post = (app: FastifyInstance, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });

describe('POST /api/testbox/switch: the marker through the verb (D-7411)', () => {
  it('on writes the marker and off removes it, each through `ccd testbox-remote --state`', async () => {
    const s = await setup();
    expect(existsSync(s.marker)).toBe(false);
    const on = await post(s.app, '/api/testbox/switch', { on: true });
    expect([on.statusCode, on.json()]).toEqual([200, { ok: true, requested: true }]);
    expect(lstatSync(s.marker).isFile()).toBe(true);
    const off = await post(s.app, '/api/testbox/switch', { on: false });
    expect([off.statusCode, off.json()]).toEqual([200, { ok: true, requested: false }]);
    expect(existsSync(s.marker)).toBe(false);
    expect(s.argvs).toEqual([['testbox-remote', '--state', 'on'], ['testbox-remote', '--state', 'off']]);
  });

  it('on replaces a dangling link with a file, and off removes a dangling link', async () => {
    const s = await setup();
    symlinkSync(path.join(s.h.home, 'nowhere'), s.marker);
    await post(s.app, '/api/testbox/switch', { on: true });
    expect(lstatSync(s.marker).isFile()).toBe(true);
    await post(s.app, '/api/testbox/switch', { on: false });
    symlinkSync(path.join(s.h.home, 'nowhere'), s.marker);
    await post(s.app, '/api/testbox/switch', { on: false });
    expect(() => lstatSync(s.marker), 'the dangling link is gone too').toThrow(/ENOENT/);
  });

  it('any body but {on: boolean} is refused and runs nothing', async () => {
    const s = await setup();
    for (const bad of [undefined, {}, { on: 'true' }, { on: 1 }, { on: true, state: 'on' }, { state: 'on' }, ['on']]) {
      const r = await post(s.app, '/api/testbox/switch', bad);
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(s.argvs).toEqual([]);
    expect(existsSync(s.marker)).toBe(false);
  });

  it('a fleet whose ccd lists no testbox-remote is refused 501, and nothing runs', async () => {
    const s = await setup({ verbs: ['coord-pause'] });
    expect((await post(s.app, '/api/testbox/switch', { on: true })).statusCode).toBe(501);
    expect(s.argvs).toEqual([]);
  });

  it('a raise that fails answers 502 with the verb\'s words, and leaves no temp behind', async () => {
    const s = await setup();
    // A directory in the marker's place: the rename cannot land, and the CHECKED arm must say so.
    mkdirSync(path.join(s.marker, 'x'), { recursive: true });
    const r = await post(s.app, '/api/testbox/switch', { on: true });
    expect(r.statusCode).toBe(502);
    expect(r.json().stderr).toMatch(/could not raise the test box switch/);
    expect(readdirSync(path.join(s.h.home, '.cc-sessions')).filter((n) => n.includes('testbox-remote-live.'))).toEqual([]);
  });

  it('a verb that never ran answers its own reason, never the forged code\'s words (D-6840)', async () => {
    // The not-ran arm forges `code: 1` and a stderr: the route reads `ran` first, so neither reaches the answer.
    const s = await setup({ runner: async () => ({ ran: false, reason: 'transport', detail: 'the link dropped', code: 1, stdout: '', stderr: 'forged' }) });
    const r = await post(s.app, '/api/testbox/switch', { on: true });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({
      ok: false, error: 'fleetFailed',
      detail: notRanSentence('ccd testbox-remote', { ran: false, reason: 'transport', detail: 'the link dropped' }),
    });
    expect(existsSync(s.marker)).toBe(false);
  });
});

describe('POST /api/testbox/switch: on needs a passing parity record (D-8166, spec §2.8, T9)', () => {
  const PARITY_REQUIRED = { ok: false, error: 'parity-required', detail: TESTBOX_PARITY_REQUIRED_SENTENCE };

  it('on without a passing record is refused parity-required and runs no ccd', async () => {
    const s = await setup({ admin: 'none' });
    const r = await post(s.app, '/api/testbox/switch', { on: true });
    expect([r.statusCode, r.json()]).toEqual([409, PARITY_REQUIRED]);
    expect(s.argvs).toEqual([]);
    expect(existsSync(s.marker)).toBe(false);
  });

  it('on with a stale record is refused: a pass for another box file', async () => {
    const s = await setup({ admin: 'mismatch' });
    const r = await post(s.app, '/api/testbox/switch', { on: true });
    expect([r.statusCode, r.json()]).toEqual([409, PARITY_REQUIRED]);
    expect(s.argvs).toEqual([]);
  });

  it('on with a record the verb marked stale is refused by ccd and answers parity-required, not a fleet failure', async () => {
    const s = await setup({ admin: 'armable' });
    // The status carries no stale mark; ccd reads `parity_stale` in the verb's state file, and its refusal is the answer.
    writeFileSync(path.join(s.h.home, '.ccrc', 'testbox-admin.state'), `fingerprint=${PIN}\nbox_sha256=${BOX_SHA}\nparity_stale=1\n`);
    const r = await post(s.app, '/api/testbox/switch', { on: true });
    expect([r.statusCode, r.json()]).toEqual([409, PARITY_REQUIRED]);
    expect(s.argvs).toEqual([['testbox-remote', '--state', 'on']]);
    expect(existsSync(s.marker)).toBe(false);
    expect(s.rows()).toEqual([{ act: 'switch', outcome: 'refused', code: 'parity-required' }]);
  });

  it('on with a matching pass runs ccd testbox-remote --state on', async () => {
    const s = await setup({ admin: 'armable' });
    const r = await post(s.app, '/api/testbox/switch', { on: true });
    expect([r.statusCode, r.json()]).toEqual([200, { ok: true, requested: true }]);
    expect(s.argvs).toEqual([['testbox-remote', '--state', 'on']]);
    expect(existsSync(s.marker)).toBe(true);
  });

  it('off is never gated: no status is asked and the marker comes down on any record', async () => {
    // No watcher: the forced lane pass after a switch asks `status` too, and this row counts the gate's own asks.
    const s = await setup({ admin: 'none', watcher: false });
    writeFileSync(s.marker, '');
    const r = await post(s.app, '/api/testbox/switch', { on: false });
    expect([r.statusCode, r.json()]).toEqual([200, { ok: true, requested: false }]);
    expect(s.adminAsked()).toEqual([]);
    expect(existsSync(s.marker)).toBe(false);
  });

  it('the gate reads a fresh status on every request, never the lane\'s cache', async () => {
    const s = await setup({ admin: 'armable', watcher: false });
    expect((await post(s.app, '/api/testbox/switch', { on: true })).statusCode).toBe(200);
    s.mode('none');
    expect((await post(s.app, '/api/testbox/switch', { on: true })).statusCode).toBe(409);
    s.mode('armable');
    expect((await post(s.app, '/api/testbox/switch', { on: true })).statusCode).toBe(200);
    expect(s.adminAsked()).toEqual(['status', 'status', 'status']);
  });

  it('an agent without the op refuses on as unsupported, and runs no ccd', async () => {
    for (const admin of ['no-op', 'absent'] as const) {
      const s = await setup({ admin });
      const r = await post(s.app, '/api/testbox/switch', { on: true });
      expect([r.statusCode, r.json().error], admin).toEqual([501, 'unsupported']);
      expect(s.argvs).toEqual([]);
    }
  });

  it('a fleet whose ccd carries no testbox-admin cap refuses on as unsupported before asking the op', async () => {
    const s = await setup({ verbs: ['testbox-remote'], watcher: false });
    expect((await post(s.app, '/api/testbox/switch', { on: true })).statusCode).toBe(501);
    expect(s.adminAsked()).toEqual([]);
    expect(s.argvs).toEqual([]);
  });

  it('a status the fleet did not answer is a fleet failure, never an arm', async () => {
    const s = await setup({ admin: 'unanswered' });
    const r = await post(s.app, '/api/testbox/switch', { on: true });
    expect(r.statusCode).toBe(502);
    expect(s.argvs).toEqual([]);
  });

  it('each switch request writes one switch row: on, a refusal, off, a bad body, a failed raise', async () => {
    const s = await setup({ admin: 'armable' });
    await post(s.app, '/api/testbox/switch', { on: true });
    s.mode('none');
    await post(s.app, '/api/testbox/switch', { on: true });
    await post(s.app, '/api/testbox/switch', { on: false });
    await post(s.app, '/api/testbox/switch', { on: 'yes' });
    expect(s.rows()).toEqual([
      { act: 'switch', outcome: 'ok', code: null },
      { act: 'switch', outcome: 'refused', code: 'parity-required' },
      { act: 'switch', outcome: 'ok', code: null },
      { act: 'switch', outcome: 'refused', code: 'bad-request' },
    ]);
    s.mode('armable');
    mkdirSync(path.join(s.marker, 'x'), { recursive: true });
    await post(s.app, '/api/testbox/switch', { on: true });
    expect(s.rows().at(-1)).toEqual({ act: 'switch', outcome: 'failed', code: 'fleetFailed' });
  });

  it('a verb that never ran writes an unknown row', async () => {
    const s = await setup({ runner: async () => ({ ran: false, reason: 'transport', detail: 'x', code: 1, stdout: '', stderr: '' }) });
    await post(s.app, '/api/testbox/switch', { on: true });
    expect(s.rows()).toEqual([{ act: 'switch', outcome: 'unknown', code: 'fleetFailed' }]);
  });
});

describe('GET /api/testbox and POST /api/testbox/tools-sync', () => {
  it('the read answers null before the first pass, then the block', async () => {
    const s = await setup();
    expect((await s.app.inject({ method: 'GET', url: '/api/testbox' })).json()).toEqual({ ok: true, testbox: null });
    await post(s.app, '/api/testbox/switch', { on: true });
    await new Promise((r) => setTimeout(r, 50));
    const r = (await s.app.inject({ method: 'GET', url: '/api/testbox' })).json();
    expect(r.testbox).toMatchObject({ state: 'ok', switch: 'on' });
  });

  it('the sync takes no body, sends through the op once, and answers its outcome', async () => {
    const s = await setup();
    const r = await post(s.app, '/api/testbox/tools-sync');
    expect([r.statusCode, r.json()]).toEqual([200, { ok: true, ...SENT.reply }]);
    expect((await post(s.app, '/api/testbox/tools-sync', {})).statusCode).toBe(200);
    for (const bad of [{ release: 'v9.9.9' }, { versions: TOOLS }, ['x']]) {
      expect((await post(s.app, '/api/testbox/tools-sync', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(s.syncs()).toBe(2);
  });

  it('an outcome other than sent is ok: false with its words; an agent without the op is 501', async () => {
    const s = await setup({ sync: { ok: true, reply: { outcome: 'unconfigured', detail: null, frame: null } } });
    expect((await post(s.app, '/api/testbox/tools-sync')).json()).toEqual({ ok: false, outcome: 'unconfigured', detail: null, frame: null });
    const t = await setup({ sync: { ok: false, reason: 'no-op' }, watcher: false });
    const noOp = await post(t.app, '/api/testbox/tools-sync');
    expect([noOp.statusCode, noOp.json()]).toEqual([501, { ok: false, error: 'unsupported', detail: 'agent has no testbox-tools-sync op' }]);
  });

  it('an agent that did not answer the sync is 502 fleetFailed, through the refusal table', async () => {
    const s = await setup({ sync: { ok: false, reason: 'unanswered' }, watcher: false });
    const r = await post(s.app, '/api/testbox/tools-sync');
    expect([r.statusCode, r.json()]).toEqual([502, { ok: false, error: 'fleetFailed', detail: 'the fleet agent did not answer the testbox-tools-sync op' }]);
  });
});

describe('armed: a session OR the box token for the read and the sync, a session for the switch (D-7554)', () => {
  it('without a session, the read and the sync need the box token', async () => {
    const s = await setup({ armed: true, session: false });
    expect((await s.app.inject({ method: 'GET', url: '/api/testbox' })).statusCode).toBe(401);
    expect((await post(s.app, '/api/testbox/tools-sync')).statusCode).toBe(401);
    expect((await post(s.app, '/api/testbox/tools-sync', undefined, { [HEADER]: 'c'.repeat(64) })).statusCode).toBe(401);
    expect(s.syncs()).toBe(0);
    expect((await s.app.inject({ method: 'GET', url: '/api/testbox', headers: { [HEADER]: TOKEN } })).statusCode).toBe(200);
    expect((await post(s.app, '/api/testbox/tools-sync', undefined, { [HEADER]: TOKEN })).statusCode).toBe(200);
  });

  it('with a session, both answer without a token', async () => {
    const s = await setup({ armed: true, session: true });
    expect((await s.app.inject({ method: 'GET', url: '/api/testbox' })).statusCode).toBe(200);
    expect((await post(s.app, '/api/testbox/tools-sync')).statusCode).toBe(200);
  });

  it('the gate exempts the read and the sync, never the switch', () => {
    expect(EXEMPT.has('GET /api/testbox')).toBe(true);
    expect(EXEMPT.has('POST /api/testbox/tools-sync')).toBe(true);
    expect(EXEMPT.has('POST /api/testbox/switch')).toBe(false);
  });
});
