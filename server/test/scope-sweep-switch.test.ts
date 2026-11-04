// D-7994 (plan docs/superpowers/plans/2026-11-03-scope-sweep-busy-orphans.md). The busy arm's door in `coord/routes.ts`,
// over a bare Fastify (`testbox-routes.test.ts`'s idiom):
//  - `GET /api/coord/scope-sweep` reads both switches through the switch table's one reader;
//  - `POST /api/coord/scope-sweep` writes and removes `$REG/scope-sweep-busy-live` through the REAL `ccd scope-sweep-busy`
//    verb, which the runner reaches only across the agent's exec whitelist (`testDeps`' guard), and refuses any body but
//    `{on: boolean}`. `scope-sweep-live` has no writer: nothing here can touch it.
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
import type { Runner } from '../src/exec.js';
import { notRanSentence } from '../src/unmeasured.js';
import { SCOPE_SWEEP_BUSY_LIVE_MARKER, SCOPE_SWEEP_LIVE_MARKER } from '../../shared/switches.js';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { testDeps } from './helpers.js';

const DOOR = '/api/coord/scope-sweep';
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

interface Setup { app: FastifyInstance; h: CcdHarness; argvs: string[][]; reg: string; busy: string; stop: string; feed: string[] }

function setup(o: { verbs?: string[] | null; runner?: Runner; unlistable?: boolean } = {}): Setup {
  const h = makeCcdHarness('ccrc-scope-sweep-switch-');
  harnesses.push(h);
  const argvs: string[][] = [];
  const base = testDeps(h.home, o.runner ?? realCcd(h, argvs));
  const feed: string[] = [];
  const deps: Deps = {
    ...base,
    io: { ...base.io, ...(o.unlistable ? { readdir: async () => null } : {}) },
    notifyLog: { record: async (n: { title: string; body: string }) => { feed.push(`${n.title}: ${n.body}`); }, flush: async () => undefined } as unknown as Deps['notifyLog'],
    ...(o.verbs === undefined ? {} : { fleetState: { ccdVerbs: o.verbs } as unknown as Deps['fleetState'] }),
  };
  const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null } as unknown as GateDecision);
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
  apps.push(app);
  const reg = path.join(h.home, '.cc-sessions');
  return { app, h, argvs, reg, busy: path.join(reg, SCOPE_SWEEP_BUSY_LIVE_MARKER), stop: path.join(reg, SCOPE_SWEEP_LIVE_MARKER), feed };
}
const get = (app: FastifyInstance) => app.inject({ method: 'GET', url: DOOR });
const post = (app: FastifyInstance, payload?: unknown) =>
  app.inject({ method: 'POST', url: DOOR, ...(payload === undefined ? {} : { payload: payload as object }) });

describe('GET /api/coord/scope-sweep: both switches, read (D-7994)', () => {
  it('clear, then each marker read on its own', async () => {
    const s = setup();
    expect((await get(s.app)).json()).toEqual({ ok: true, stop: 'clear', busy: 'clear' });
    writeFileSync(s.stop, '');
    expect((await get(s.app)).json()).toEqual({ ok: true, stop: 'set', busy: 'clear' });
    writeFileSync(s.busy, '');
    expect((await get(s.app)).json()).toEqual({ ok: true, stop: 'set', busy: 'set' });
  });

  it('a registry that cannot be listed reads unmeasurable, never clear', async () => {
    const s = setup({ unlistable: true });
    expect((await get(s.app)).json()).toEqual({ ok: true, stop: 'unmeasurable', busy: 'unmeasurable' });
  });

  it('it is no exempt door: the gate holds it for a session', () => {
    expect([...EXEMPT].filter((e) => e.includes('scope-sweep'))).toEqual([]);
  });
});

describe('POST /api/coord/scope-sweep: the marker through the verb (D-7994)', () => {
  it('on writes the marker and off removes it, each through `ccd scope-sweep-busy --state`, and the answer is what the registry then reads', async () => {
    const s = setup();
    const on = await post(s.app, { on: true });
    expect([on.statusCode, on.json()]).toEqual([200, { ok: true, stop: 'clear', busy: 'set' }]);
    expect(lstatSync(s.busy).isFile()).toBe(true);
    const off = await post(s.app, { on: false });
    expect([off.statusCode, off.json()]).toEqual([200, { ok: true, stop: 'clear', busy: 'clear' }]);
    expect(existsSync(s.busy)).toBe(false);
    expect(s.argvs).toEqual([['scope-sweep-busy', '--state', 'on'], ['scope-sweep-busy', '--state', 'off']]);
  });

  it('it never touches scope-sweep-live', async () => {
    const s = setup();
    await post(s.app, { on: true });
    expect(existsSync(s.stop), 'on writes no sweep switch').toBe(false);
    writeFileSync(s.stop, '');
    await post(s.app, { on: false });
    expect(existsSync(s.stop), 'off removes no sweep switch').toBe(true);
  });

  it('a change is one record-only feed row; the same state again writes none', async () => {
    const s = setup();
    await post(s.app, { on: true });
    await post(s.app, { on: true });
    expect(s.feed.filter((l) => l.startsWith('scope sweep busy arm changed'))).toHaveLength(1);
    expect(s.feed.find((l) => l.startsWith('scope sweep busy arm changed'))).toContain('clear -> set');
  });

  it('on replaces a dangling link with a file, and off removes a dangling link', async () => {
    const s = setup();
    symlinkSync(path.join(s.h.home, 'nowhere'), s.busy);
    await post(s.app, { on: true });
    expect(lstatSync(s.busy).isFile()).toBe(true);
    await post(s.app, { on: false });
    symlinkSync(path.join(s.h.home, 'nowhere'), s.busy);
    await post(s.app, { on: false });
    expect(() => lstatSync(s.busy), 'the dangling link is gone too').toThrow(/ENOENT/);
  });

  it('any body but {on: boolean} is refused and runs nothing', async () => {
    const s = setup();
    for (const bad of [undefined, {}, { on: 'true' }, { on: 1 }, { on: true, state: 'on' }, { state: 'on' }, ['on']]) {
      expect((await post(s.app, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(s.argvs).toEqual([]);
    expect(existsSync(s.busy)).toBe(false);
  });

  it('a fleet whose ccd lists no scope-sweep-busy is refused 501, and nothing runs', async () => {
    const s = setup({ verbs: ['coord-pause'] });
    expect((await post(s.app, { on: true })).statusCode).toBe(501);
    expect(s.argvs).toEqual([]);
  });

  it('a raise that fails answers 502 with the verb\'s words, and leaves no temp behind', async () => {
    const s = setup();
    mkdirSync(path.join(s.busy, 'x'), { recursive: true });   // a directory in the marker's place: the rename cannot land
    const r = await post(s.app, { on: true });
    expect(r.statusCode).toBe(502);
    expect(r.json().stderr).toMatch(/could not raise the busy arm's switch/);
    expect(readdirSync(s.reg).filter((n) => n.includes('scope-sweep-busy-live.'))).toEqual([]);
  });

  it('a verb that never ran answers its own reason, never the forged code\'s words (D-6840)', async () => {
    const s = setup({ runner: async () => ({ ran: false, reason: 'transport', detail: 'the link dropped', code: 1, stdout: '', stderr: 'forged' }) });
    const r = await post(s.app, { on: true });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({
      ok: false, error: 'fleetFailed',
      detail: notRanSentence('ccd scope-sweep-busy', { ran: false, reason: 'transport', detail: 'the link dropped' }),
    });
    expect(existsSync(s.busy)).toBe(false);
  });
});
