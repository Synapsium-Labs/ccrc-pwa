// D-7902. `POST /api/coord/pane-scope-stop`, Settings › Automation's switch for the deliberate stop's pane-scope stop,
// over a bare Fastify (the test box switch suite's idiom):
//  - `{state:'live'}` raises `$REG/pane-scope-stop-live` and `{state:'shadow'}` lowers it, each through the REAL
//    `ccd pane-scope-stop --state` verb, which the runner reaches only across the agent's exec whitelist (`testDeps`'
//    guard);
//  - any other body is refused 400 and runs nothing; a box whose ccd lists no such verb is refused 501;
//  - a verb that never ran answers its own reason (D-6840), and one that failed answers 502 with its words;
//  - the route is not exempt from the auth gate (session-only), and the coord frame carries the switch.
// Every ccd call runs against a fixture HOME (`makeCcdHarness`), never the live one.
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { Bus } from '../src/bus.js';
import { EXEMPT, type GateDecision } from '../src/auth/gate.js';
import type { Runner } from '../src/exec.js';
import { notRanSentence } from '../src/unmeasured.js';
import { PANE_SCOPE_STOP_LIVE_MARKER, readSwitches } from '../../shared/switches.js';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { testDeps } from './helpers.js';

const apps: FastifyInstance[] = [];
const harnesses: CcdHarness[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const h of harnesses.splice(0)) h.cleanup();
});

/** The runner the agent would be: the real ccd dispatcher, under the fixture HOME. */
const realCcd = (h: CcdHarness, argvs: string[][]): Runner => (_cmd, args) => new Promise((resolve) => {
  argvs.push(args);
  const env = ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home }, { systemd: true, tmux: true });
  execFile('bash', [CCD, ...args], { cwd: h.home, env, encoding: 'utf8' }, (err, stdout, stderr) => {
    resolve({ ran: true, code: err === null ? 0 : typeof err.code === 'number' ? err.code : 1, stdout, stderr });
  });
});

async function setup(o: { verbs?: string[]; runner?: Runner } = {}): Promise<{ app: FastifyInstance; h: CcdHarness; argvs: string[][]; marker: string }> {
  const h = makeCcdHarness('ccrc-pane-scope-stop-route-');
  harnesses.push(h);
  const argvs: string[][] = [];
  const base = testDeps(h.home, o.runner ?? realCcd(h, argvs));
  const deps: Deps = {
    ...base, cfg: { ...base.cfg, authEnabled: false },
    ...(o.verbs === undefined ? {} : { fleetState: { ccdVerbs: o.verbs } as unknown as Deps['fleetState'] }),
  };
  const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null } as unknown as GateDecision);
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
  apps.push(app);
  return { app, h, argvs, marker: path.join(h.home, '.cc-sessions', PANE_SCOPE_STOP_LIVE_MARKER) };
}
const post = (app: FastifyInstance, payload?: unknown) =>
  app.inject({ method: 'POST', url: '/api/coord/pane-scope-stop', ...(payload === undefined ? {} : { payload: payload as object }) });

describe('POST /api/coord/pane-scope-stop: the marker through the verb (D-7902)', () => {
  it('live writes the marker and shadow removes it, each through `ccd pane-scope-stop --state`', async () => {
    const s = await setup();
    expect(existsSync(s.marker)).toBe(false);
    const on = await post(s.app, { state: 'live' });
    expect([on.statusCode, on.json()]).toEqual([200, { ok: true, requested: 'live' }]);
    expect(lstatSync(s.marker).isFile()).toBe(true);
    const off = await post(s.app, { state: 'shadow' });
    expect([off.statusCode, off.json()]).toEqual([200, { ok: true, requested: 'shadow' }]);
    expect(existsSync(s.marker)).toBe(false);
    expect(s.argvs).toEqual([['pane-scope-stop', '--state', 'live'], ['pane-scope-stop', '--state', 'shadow']]);
  });

  it('live replaces a dangling link with a file', async () => {
    const s = await setup();
    symlinkSync(path.join(s.h.home, 'nowhere'), s.marker);
    await post(s.app, { state: 'live' });
    expect(lstatSync(s.marker).isFile()).toBe(true);
  });

  it('any body but {state: live|shadow} is refused 400 and runs nothing', async () => {
    const s = await setup();
    for (const bad of [undefined, {}, { state: 'on' }, { state: true }, { on: true }, { state: 'live', x: 1 }, ['live']]) {
      const r = await post(s.app, bad);
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(s.argvs).toEqual([]);
    expect(existsSync(s.marker)).toBe(false);
  });

  it('a fleet whose ccd lists no pane-scope-stop is refused 501, and nothing runs', async () => {
    const s = await setup({ verbs: ['coord-pause'] });
    expect((await post(s.app, { state: 'live' })).statusCode).toBe(501);
    expect(s.argvs).toEqual([]);
  });

  it('a lowering that fails answers 502 with the verb\'s words', async () => {
    const s = await setup();
    // A directory in the marker's place: `rm -f` cannot remove it, and the CHECKED arm must say so.
    mkdirSync(path.join(s.marker, 'x'), { recursive: true });
    const r = await post(s.app, { state: 'shadow' });
    expect(r.statusCode).toBe(502);
    expect(r.json().stderr).toMatch(/could not lower .* the stop is STILL armed/);
  });

  it('a verb that never ran answers its own reason, never the forged code\'s words (D-6840)', async () => {
    const s = await setup({ runner: async () => ({ ran: false, reason: 'transport', detail: 'the link dropped', code: 1, stdout: '', stderr: 'forged' }) });
    const r = await post(s.app, { state: 'live' });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({
      ok: false, error: 'fleetFailed',
      detail: notRanSentence('ccd pane-scope-stop', { ran: false, reason: 'transport', detail: 'the link dropped' }),
    });
    expect(existsSync(s.marker)).toBe(false);
  });

  it('the switch is not exempt from the sign-in gate: armed, it is a session\'s write like every Settings switch', () => {
    expect(EXEMPT.has('POST /api/coord/pane-scope-stop')).toBe(false);
  });

  it('readSwitches reads the marker set, clear and unmeasurable, the coord frame\'s three values', () => {
    expect(readSwitches([PANE_SCOPE_STOP_LIVE_MARKER])[PANE_SCOPE_STOP_LIVE_MARKER]).toBe('set');
    expect(readSwitches([])[PANE_SCOPE_STOP_LIVE_MARKER]).toBe('clear');
    expect(readSwitches(null)[PANE_SCOPE_STOP_LIVE_MARKER]).toBe('unmeasurable');
  });
});
