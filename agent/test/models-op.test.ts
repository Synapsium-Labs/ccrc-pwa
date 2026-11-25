// Auto-advance plan W4a Task 17, as re-planned (D-8687, D-8688, D-8692, D-5227): the agent's `models` op, the SIXTH
// wire-triggered spawn, answered by a REAL agent over a real loopback WS against a fixture HOME. Every case but the
// real-port describe injects a recorder through `AgentOpts.spawnModels`; the real-port describe spawns a bash stub at
// `<fixture>/.local/bin/ccrc` with the process's PATH and HOME contained, and restored after. No case touches the live
// `$HOME` or a real `ccrc`.
//
// What is pinned:
//  - Every lane, action and class refusal answers `ok: true` with `{kind: 'refused', why, fleetIdentity}` and spawns
//    nothing; a frame off the envelope's shape is `bad-request` (which from this op means "this agent predates it").
//  - The recorder sees the ABSOLUTE launcher, the builder's frozen argv and MODELS_SPAWN_BOUNDS; nothing else.
//  - Every outcome travels as `ok` with the node's `fleetIdentity`; an exit 1 refusal is still `exited`.
//  - One gate per agent PROCESS: a second op while one runs is `busy`, on any connection; a rejecting port frees it.
//  - The ready frame lists `models` eleventh, before `witness` and `overlord-history`.
//  - The op reaches no exec path, and the port is called in one place (a SOURCE scan).
//  - The real port's child gets exactly {HOME, PATH, LANG}, PATH led by this node's directory (D-5227), no stdin.
//  - The D-8406 grant stays (D-8688): an older server's file read of the lane's two files still answers.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunningAgent } from '../src/server.js';
import {
  MODELS_SPAWN_BOUNDS, makeModelsSpawn, modelsEnv, runModelsOp, type ModelsOpSpawn, type ModelsSpawnOutcome,
} from '../src/modelsop.js';
import { tokenSyncEnv } from '../src/tokensync.js';
import {
  MODELS_ACTIONS, MODELS_OP, MODELS_OP_OUTPUT_MAX_BYTES, readModelsOpAnswer, updateLauncherPath, type AgentReady,
} from '../../shared/agent-protocol.js';
import { CAP_WORD, MAX_CAP_WORDS } from '../../shared/api.js';
import { CLASSES, MODELS_RESERVED_IDS } from '../../shared/models.js';
import { EXEC_COMMANDS, FORBIDDEN_COMMANDS, isExecAllowed } from '../src/whitelist.js';
import { boot, makeFixture, TestClient, type Fixture } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', 'src');
const SERVER_TS = path.join(SRC, 'server.ts');
const OP_TS = path.join(SRC, 'modelsop.ts');

interface Res {
  t: 'res'; id: number; ok: boolean; err?: string; kind?: string; why?: string; code?: number; stdout?: string;
  fleetIdentity?: string | null; data?: string | null;
}

const NODE_ID = '0123abcd-4567-89ab-cdef-0123456789ab';
const WRITING = MODELS_ACTIONS.filter((a) => a !== 'show');

/** A recording port. `park()` makes every later call wait until `release()`; `fail()` makes the next call reject. */
function recorder(answer: ModelsSpawnOutcome = { kind: 'exited', code: 0, stdout: '{"ok":true}\n' }) {
  const calls: Array<[string, readonly string[], unknown]> = [];
  let parked: Array<() => void> | null = null;
  let rejectNext = false;
  const spawn: ModelsOpSpawn = async (file, argv, bounds) => {
    calls.push([file, argv, bounds]);
    if (rejectNext) { rejectNext = false; throw new Error('the recorder rejects'); }
    if (parked) await new Promise<void>((r) => parked!.push(r));
    return answer;
  };
  return {
    calls, spawn,
    park: () => { parked = []; },
    release: () => { const p = parked ?? []; parked = null; for (const r of p) r(); },
    fail: () => { rejectNext = true; },
    set: (a: ModelsSpawnOutcome) => { answer = a; },
  };
}

const slice = (src: string, open: string, close: RegExp): string => {
  const at = src.indexOf(open);
  expect(at, `${open} not found`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(at + open.length);
  const end = close.exec(rest);
  expect(end, `no end after ${open}`).not.toBeNull();
  return rest.slice(0, end!.index);
};
const EXEC_PATH = /\b(?:isExecAllowed|runExec|resolveSpawnCmd|checkPath)\s*\(|\bEXEC_WHITELIST\b/;
const CASE_END = /\n    (?:case '|default:)/;
/** A source's code lines: comment-only lines and trailing `//` comments dropped. */
const code = (src: string): string[] => src.split('\n').map((l) => l.replace(/\s\/\/ .*$/, '')).filter((l) => !/^\s*(?:\/\/|\/\*\*?|\*)/.test(l));

describe('the models op over a real agent, with a recording port', () => {
  let agent: RunningAgent | undefined;
  let fixture: Fixture | undefined;
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    if (agent) await agent.close();
    agent = undefined;
    if (fixture) for (const d of [fixture.home, fixture.projectsRoot, fixture.outside]) rmSync(d, { recursive: true, force: true });
    fixture = undefined;
  });

  async function up(rec: ReturnType<typeof recorder>, nodeId = true): Promise<TestClient> {
    fixture = makeFixture();
    if (nodeId) {
      mkdirSync(path.join(fixture.home, '.ccrc'), { recursive: true });
      writeFileSync(path.join(fixture.home, '.ccrc', 'node-id'), `${NODE_ID}\n`);
    }
    agent = await boot(fixture, { spawnModels: rec.spawn });
    return client();
  }
  async function client(): Promise<TestClient> {
    const c = new TestClient(agent!.port);
    clients.push(c);
    await c.hello();
    return c;
  }

  describe('every guard refuses, spawning nothing (Review Focus line 5)', () => {
    const lanes: unknown[] = [...MODELS_RESERVED_IDS, 'lane/a', '..', '-lane', 'Lane-a', `l${'a'.repeat(32)}`, '',
      'lane-a\n', 'lane\u0000a', 7, null];
    it.each(lanes.map((l) => [JSON.stringify(l), l]))('lane %s answers refused bad-lane', async (_n, lane) => {
      const rec = recorder();
      const c = await up(rec);
      const res = await c.req<Res>(1, { op: MODELS_OP, lane, action: 'show' });
      expect(res).toEqual({ t: 'res', id: 1, ok: true, kind: 'refused', why: 'bad-lane', fleetIdentity: NODE_ID });
      expect(rec.calls).toEqual([]);
    });

    it.each([['rm'], ['set-class'], [undefined], ['Hold']])('action %s answers refused bad-action', async (action) => {
      const rec = recorder();
      const c = await up(rec);
      const frame: Record<string, unknown> = { op: MODELS_OP, lane: 'lane-a' };
      if (action !== undefined) frame.action = action;
      expect(await c.req<Res>(1, frame)).toEqual({ t: 'res', id: 1, ok: true, kind: 'refused', why: 'bad-action', fleetIdentity: NODE_ID });
      expect(rec.calls).toEqual([]);
    });

    it('a class on show, no class on hold, and subagent answer refused bad-class; fleetIdentity is null with no node-id', async () => {
      const rec = recorder();
      const c = await up(rec, false);
      const want = (id: number) => ({ t: 'res', id, ok: true, kind: 'refused', why: 'bad-class', fleetIdentity: null });
      expect(await c.req<Res>(1, { op: MODELS_OP, lane: 'lane-a', action: 'show', class: CLASSES[0] })).toEqual(want(1));
      expect(await c.req<Res>(2, { op: MODELS_OP, lane: 'lane-a', action: 'hold' })).toEqual(want(2));
      expect(await c.req<Res>(3, { op: MODELS_OP, lane: 'lane-a', action: 'release', class: 'subagent' })).toEqual(want(3));
      expect(rec.calls).toEqual([]);
    });

    it('a non-numeric id is no answer, and an extra key (args) is bad-request', async () => {
      const rec = recorder();
      const c = await up(rec);
      const seen: unknown[] = [];
      c.ws.on('message', (raw) => { const m = JSON.parse(String(raw)) as { t?: string }; if (m.t === 'res') seen.push(m); });
      c.send({ t: 'req', id: 'x', op: MODELS_OP, lane: 'lane-a', action: 'show' });
      expect(await c.req<Res>(2, { op: MODELS_OP, lane: 'lane-a', action: 'show', args: ['--force'] }))
        .toEqual({ t: 'res', id: 2, ok: false, err: 'bad-request' });
      // the frame with no numeric id had no id to answer: the only answer on the socket is id 2's
      expect(seen).toEqual([{ t: 'res', id: 2, ok: false, err: 'bad-request' }]);
      expect(rec.calls).toEqual([]);
    });
  });

  describe('the spawn', () => {
    it('show spawns [launcher, [models, lane-a, show], MODELS_SPAWN_BOUNDS]', async () => {
      const rec = recorder();
      const c = await up(rec);
      await c.req<Res>(1, { op: MODELS_OP, lane: 'lane-a', action: 'show' });
      expect(rec.calls).toEqual([[updateLauncherPath(fixture!.home), ['models', 'lane-a', 'show'], MODELS_SPAWN_BOUNDS]]);
      expect(Object.isFrozen(rec.calls[0]![1])).toBe(true);
    });

    it('each writing action x each class spawns its four-word argv', async () => {
      const rec = recorder();
      const c = await up(rec);
      let id = 0;
      for (const a of WRITING) for (const cls of CLASSES) {
        await c.req<Res>(++id, { op: MODELS_OP, lane: 'lane-a', action: a, class: cls });
      }
      expect(rec.calls.map((x) => x[1])).toEqual(WRITING.flatMap((a) => CLASSES.map((cls) => ['models', 'lane-a', a, cls])));
    });
  });

  describe('the outcome travels as ok, with fleetIdentity', () => {
    const outcomes: ModelsSpawnOutcome[] = [
      { kind: 'exited', code: 0, stdout: '{"ok":true,"op":"show"}\n' },
      { kind: 'exited', code: 1, stdout: '{"ok":false,"error":"lock-busy","message":"m"}\n' },
      { kind: 'timeout' }, { kind: 'too-large' }, { kind: 'not-started' },
    ];
    it.each(outcomes.map((o) => [o.kind + ('code' in o ? ` ${o.code}` : ''), o]))('%s', async (_n, o) => {
      const rec = recorder(o);
      const c = await up(rec);
      const res = await c.req<Res>(1, { op: MODELS_OP, lane: 'lane-a', action: 'show' });
      expect(res).toEqual({ t: 'res', id: 1, ok: true, ...o, fleetIdentity: NODE_ID });
      expect(readModelsOpAnswer(res)).toEqual({ ...o, fleetIdentity: NODE_ID });
    });

    it('fleetIdentity is null without a node-id', async () => {
      const c = await up(recorder(), false);
      expect(await c.req<Res>(1, { op: MODELS_OP, lane: 'lane-a', action: 'show' })).toMatchObject({ ok: true, fleetIdentity: null });
    });
  });

  describe('busy: one gate per agent process', () => {
    it('a second op while one is held is busy, on the same connection and on a second; then the next op spawns', async () => {
      const rec = recorder();
      const c = await up(rec);
      rec.park();
      c.send({ t: 'req', id: 1, op: MODELS_OP, lane: 'lane-a', action: 'show' });
      await expect.poll(() => rec.calls.length).toBe(1);
      expect(await c.req<Res>(2, { op: MODELS_OP, lane: 'lane-b', action: 'show' }))
        .toEqual({ t: 'res', id: 2, ok: true, kind: 'busy', fleetIdentity: NODE_ID });
      const c2 = await client();
      expect(await c2.req<Res>(3, { op: MODELS_OP, lane: 'lane-a', action: 'hold', class: CLASSES[1] }))
        .toEqual({ t: 'res', id: 3, ok: true, kind: 'busy', fleetIdentity: NODE_ID });
      rec.release();
      expect(await c.waitFor<Res>((m) => (m as Res).t === 'res' && (m as Res).id === 1)).toMatchObject({ kind: 'exited' });
      expect(rec.calls).toHaveLength(1);
      expect(await c2.req<Res>(4, { op: MODELS_OP, lane: 'lane-a', action: 'show' })).toMatchObject({ kind: 'exited' });
      expect(rec.calls).toHaveLength(2);
    });

    it('a rejecting port still frees the gate (finally)', async () => {
      const rec = recorder();
      const c = await up(rec);
      rec.fail();
      expect(await c.req<Res>(1, { op: MODELS_OP, lane: 'lane-a', action: 'show' })).toMatchObject({ ok: false });
      expect(await c.req<Res>(2, { op: MODELS_OP, lane: 'lane-a', action: 'show' })).toMatchObject({ ok: true, kind: 'exited' });
      expect(rec.calls).toHaveLength(2);
    });
  });

  it('the ready frame lists the twelve fixed words with models eleventh and testbox-capture twelfth, then witness, then overlord-history when servable', async () => {
    await up(recorder());
    const c = new TestClient(agent!.port);
    clients.push(c);
    const ops = (await c.hello() as AgentReady).ops!;
    expect(ops.slice(0, 12)).toEqual(['update', 'token-sync', 'account', 'disk', 'pressure', 'testbox', 'testbox-tools-sync',
      'testbox-admin', 'backup', 'readdir-mtimes', 'models', 'testbox-capture']);
    expect(ops[10]).toBe(MODELS_OP);
    expect(ops.slice(12)).toEqual(['witness', 'overlord-history']);
    // an older server's one reader (`readReadyOps`) takes the fourteen words whole: each on CAP_WORD, within MAX_CAP_WORDS
    expect(ops.length).toBeLessThanOrEqual(MAX_CAP_WORDS);
    expect(ops.filter((w) => !CAP_WORD.test(w))).toEqual([]);
  });

  // R3b retires the D-8406 grant D-8688 kept: an older server's files fallback is refused, over the real `read` op, and
  // the op is the one way to a lane's models. Reds the day the grant comes back.
  it('the D-8406 grant is retired (R3b): an older server\'s read of the lane\'s two files is refused', async () => {
    const c = await up(recorder());
    const dir = path.join(fixture!.home, '.ccrc', 'models');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'lane-a.classes.json'), '{"registry":1}\n');
    writeFileSync(path.join(dir, 'lane-a.json'), '{"catalogue":1}\n');
    expect(await c.req<Res>(1, { op: 'read', path: path.join(dir, 'lane-a.classes.json') })).toMatchObject({ ok: false, err: 'forbidden' });
    expect(await c.req<Res>(2, { op: 'read', path: path.join(dir, 'lane-a.json') })).toMatchObject({ ok: false, err: 'forbidden' });
  });
});

describe('the op reaches no exec path, and the port is called in one place (a SOURCE scan)', () => {
  const src = readFileSync(SERVER_TS, 'utf8');
  const op = readFileSync(OP_TS, 'utf8');

  it("handleReq's models case and src/modelsop.ts name no exec-surface call; the exec case does (the control)", () => {
    const handle = slice(src, 'async function handleReq(', /\n\}\n/);
    const body = slice(handle, "case 'models': {", CASE_END);
    expect(body).not.toMatch(EXEC_PATH);
    expect(op).not.toMatch(EXEC_PATH);
    expect(slice(handle, "case 'exec': {", CASE_END)).toMatch(/isExecAllowed\(/);
  });

  it('ctx.spawnModels appears once in code, inside the case, as the first argument of its one runModelsOp call', () => {
    const handle = slice(src, 'async function handleReq(', /\n\}\n/);
    const body = slice(handle, "case 'models': {", CASE_END);
    expect(body.match(/runModelsOp\(/g)).toHaveLength(1);
    expect(body).toMatch(/runModelsOp\(ctx\.spawnModels, ctx\.cfg\.home, /);
    const lines = code(src).filter((l) => /spawnModels/.test(l)).map((l) => l.trim());
    expect(lines).toEqual([
      'spawnModels?: ModelsOpSpawn;',
      'spawnModels: ModelsOpSpawn;',
      "outcome = await runModelsOp(ctx.spawnModels, ctx.cfg.home, req.lane, req.action, 'class' in req ? req.class : undefined);",
      'spawnModels: opts.spawnModels,',
      'spawnModels: rawOpts.spawnModels ?? makeModelsSpawn(modelsEnv(rawOpts.home ?? os.homedir())),',
    ]);
  });

  it('in agent/src only modelsop.ts calls the port (once, in runModelsOp), and no other file names spawnModels', () => {
    const runBody = slice(op, 'export async function runModelsOp(', /\n\}\n/);
    expect(code(op).join('\n').match(/spawnModels\(/g)).toHaveLength(1);
    expect(runBody).toMatch(/spawnModels\(file, built\.argv, bounds\)/);
    const naming = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))
      .filter((f) => /spawnModels/.test(readFileSync(path.join(SRC, f), 'utf8'))).sort();
    expect(naming).toEqual(['modelsop.ts', 'server.ts']);
  });

  it('modelsop.ts calls boundedStdinSpawn once with null stdin, and spawns nothing itself', () => {
    const c = code(op).join('\n');
    expect(c.match(/\bboundedStdinSpawn\(/g)).toHaveLength(1);
    expect(c).toMatch(/boundedStdinSpawn\(\{ spawn, signals: osConstants\.signals \}, file, argv, null, \{/);
    expect(c).not.toMatch(/spawn\(file/);
    expect(c).not.toMatch(/(?<![\w.])spawn\(/);
  });

  it('the exec surface is untouched: ccrc and models are on neither list, and the exec op refuses the argv', () => {
    expect([...EXEC_COMMANDS]).toEqual(['tmux', 'ccd']);
    for (const w of ['ccrc', 'models']) {
      expect((EXEC_COMMANDS as readonly string[]).includes(w)).toBe(false);
      expect((FORBIDDEN_COMMANDS as readonly string[]).includes(w)).toBe(false);
    }
    for (const cmd of ['ccrc', 'models', updateLauncherPath('/h')]) expect(isExecAllowed(cmd, ['models', 'lane-a', 'show'])).toBe(false);
  });
});

describe('the real port over a stub launcher (D-5227)', () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ['PATH', 'HOME', 'CCRC_AGENT_TOKEN'] as const;
  let home = '';
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    home = makeFixture().home;
    // `/bin` first, so a PATH that is not led by this node's own directory is told apart wherever node lives
    process.env.PATH = path.dirname(process.execPath) === '/bin' ? '/usr/bin:/bin' : '/bin:/usr/bin';
    process.env.HOME = home;
    process.env.CCRC_AGENT_TOKEN = ['planted', 'agent', 'bearer'].join('-');
  });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
  function plant(body: string): void {
    const bin = path.join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ccrc'), `#!/bin/bash\n${body}\n`);
    chmodSync(path.join(bin, 'ccrc'), 0o755);
  }
  const RECORD = (): string => [
    `printf '%s\\n' "$@" > '${home}/argv'`,
    `compgen -e | sort > '${home}/envnames'`,
    `printf '%s' "$PATH" > '${home}/path'`,
    `cat > '${home}/stdin'`,
    `echo '{"ok":true,"op":"show"}'`,
  ].join('\n');

  it("the child's environ is exactly HOME, LANG, PATH, its PATH led by this node's directory, and its stdin empty", async () => {
    plant(RECORD());
    const out = await runModelsOp(makeModelsSpawn(modelsEnv(home)), home, 'lane-a', 'show', undefined);
    expect(out).toEqual({ kind: 'exited', code: 0, stdout: '{"ok":true,"op":"show"}\n' });
    expect(readFileSync(path.join(home, 'argv'), 'utf8')).toBe('models\nlane-a\nshow\n');
    // bash itself exports nothing it was not given beyond its own shell names; these are the three handed in
    const names = readFileSync(path.join(home, 'envnames'), 'utf8').trim().split('\n').filter((n) => !['OLDPWD', 'PWD', 'SHLVL', '_'].includes(n));
    expect(names).toEqual(['HOME', 'LANG', 'PATH']);
    expect(readFileSync(path.join(home, 'path'), 'utf8').split(':')[0]).toBe(path.dirname(process.execPath));
    expect(readFileSync(path.join(home, 'stdin'), 'utf8')).toBe('');
  });

  it('stdout past the cap is too-large', async () => {
    plant(`head -c ${MODELS_OP_OUTPUT_MAX_BYTES + 1024} /dev/zero | tr '\\0' 'x'`);
    expect(await runModelsOp(makeModelsSpawn(modelsEnv(home)), home, 'lane-a', 'show', undefined)).toEqual({ kind: 'too-large' });
  });

  it('a missing launcher is not-started', async () => {
    expect(await runModelsOp(makeModelsSpawn(modelsEnv(home)), home, 'lane-a', 'show', undefined)).toEqual({ kind: 'not-started' });
  });

  it('a home the launcher path refuses is not-started, and a builder refusal spawns nothing', async () => {
    let n = 0;
    const port: ModelsOpSpawn = async () => { n += 1; return { kind: 'timeout' }; };
    expect(await runModelsOp(port, 'relative/home', 'lane-a', 'show', undefined)).toEqual({ kind: 'not-started' });
    expect(await runModelsOp(port, home, 'refresh', 'show', undefined)).toEqual({ kind: 'refused', why: 'bad-lane' });
    expect(n).toBe(0);
  });
});

describe('modelsEnv', () => {
  it("keeps exactly three names, its PATH the node directory then tokenSyncEnv's PATH", () => {
    const from = { PATH: '/p/a:/p/b', LANG: 'L', CCRC_AGENT_TOKEN: 'x', HOME: '/elsewhere' };
    const env = modelsEnv('/h', from, '/n/bin');
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'PATH']);
    expect(env).toEqual({ HOME: '/h', LANG: 'L', PATH: `/n/bin:${tokenSyncEnv('/h', from).PATH}` });
    expect(modelsEnv('/h', {}, '/n/bin').PATH).toBe(`/n/bin:${tokenSyncEnv('/h', {}).PATH}`);
  });
});
