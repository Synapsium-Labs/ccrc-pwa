// Programme model-class-advance, wave R4 (plan Review Focus line 1, races and locks; Task 19's end-to-end describe as
// re-planned): a `POST /api/models/:lane` hold racing the hourly advance's commit. The REAL local arm (`runModelsOp` over
// `makeModelsSpawn`, the body `localIOFor` runs, with this suite's contained environment), the REAL `ccd/ccrc` behind
// `_inst_shim`'s own launcher bytes, the real lane-files lock, and a real `flock` holder in another process standing in for
// the hourly refresh's commit. A reasonable person expects the hold to win: the POST must WAIT for the commit's lock, answer
// only when the verb has landed, and the advance step's commit that follows must find the class held.
//
// SKIPPED WITHOUT flock, NEVER PASSED: every case is `it.skipIf(!HAVE_FLOCK)`, and `HAVE_FLOCK` is MEASURED (`flock
// --version` exits 0), so a box with no flock shows these as skipped in the run's summary and never as a vacuous pass.
//
// CONTAINED. HOME is a `mkTmp` directory; `ghContainedEnv` poisons gh and the service managers, and curl is poisoned here;
// the child sees exactly {HOME, PATH, LANG} (the op's three-name environment), so `CCRC_MODELS_LOCK_S` cannot reach it and
// the lock wait is the verb's default 20 s. Fixture lanes only (`lane-b` is codex-kind), every model id neutral.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { makeModelsSpawn, modelsEnv, runModelsOp } from '../../agent/src/modelsop.js';
import { localIOFor, type FleetIO } from '../src/io.js';
import { registerLaneModelsRoutes } from '../src/laneModelsRoutes.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { ADV_CATALOGUE, ADV_REGISTRY_BYTES } from './fixtures/advanceCases.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const HAVE_FLOCK = spawnSync('flock', ['--version'], { encoding: 'utf8' }).status === 0;

const LANE = 'lane-b';
/** The class held: its pin and the newer model the hourly advance would move it to are in the fixture catalogue. */
const CLS = 'opus';
const FROM = 'model-5.6-gamma';
const TO = 'model-6.1-gamma';

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'lane-u', label: 'lane-u', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true,
      hue: 'cyan', telemetry: 'anthropic' },
    // Pure-parse ports: nothing in this file connects to either.
    { id: LANE, label: LANE, configDirSuffix: '.claude-lane-b',
      exec: { kind: 'codex', provider: 'openai', proxyPort: 45060, litellmPort: 45061, authDir: codexAuthDir(LANE) },
      homeAble: false, hue: 'magenta', telemetry: 'codex' },
  ],
};

describe('a POST hold racing the hourly commit: the real local arm, the real ccrc, a real flock holder', () => {
  const holders: ChildProcess[] = [];
  const homes: string[] = [];
  const apps: FastifyInstance[] = [];

  const release = (child: ChildProcess): Promise<void> => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once('exit', () => resolve());
    child.stdin!.end();
  });
  afterEach(async () => {
    for (const c of holders.splice(0)) await release(c);
    while (apps.length) await apps.pop()!.close();
    for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
  });

  /** A fixture box: `ccrc` runs from `<home>/ccrc/ccd/ccrc` as on a deployed box, behind the real launcher. */
  function box(): { home: string; env: NodeJS.ProcessEnv } {
    const home = mkTmp('ccrc-models-race-');
    homes.push(home);
    const ccd = join(home, 'ccrc', 'ccd');
    fs.mkdirSync(ccd, { recursive: true });
    for (const f of ['ccrc', 'ccrc-wrapper-shape']) fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
    fs.symlinkSync(join(REPO, 'deploy'), join(home, 'ccrc', 'deploy'));
    fs.symlinkSync(join(REPO, 'shared'), join(home, 'ccrc', 'shared'));
    fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(join(home, '.ccrc', 'accounts.json'), `${JSON.stringify(ROSTER, null, 2)}\n`);
    const inherited: NodeJS.ProcessEnv = { ...process.env };
    // A runner's own knobs never steer a case.
    for (const k of ['CCRC_MODELS_LOCK_S', 'CCRC_MODELS_NOW', 'CCRC_CODEX_READY_S', 'CCRC_CODEX_PROBE_S', 'CCGPT_CONFIG',
      'CCRC_MODELS_CANARY_S', 'CCRC_MODELS_ADVANCE_BUDGET_S']) delete inherited[k];
    const env = ghContainedEnv(home, { ...inherited, HOME: home, LANG: 'C' }, { systemd: true });
    fs.writeFileSync(join(home, '.local', 'bin', 'curl'),
      '#!/bin/sh\necho "the models race suite must never reach curl" >&2\nexit 97\n', { mode: 0o755 });
    const shim = join(home, '.local', 'bin', 'ccrc');
    const r = spawnSync('bash', ['-c', 'f=$1; out=$2; set --; . "$f"; _inst_shim > "$out"', 'shim', join(REPO, 'ccd', 'ccrc'), shim],
      { env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    fs.chmodSync(shim, 0o755);
    // the lane: registry and catalogue planted, then the op's own `materialise`
    const dir = join(home, '.ccrc', 'models');
    fs.writeFileSync(join(dir, `${LANE}.classes.json`), ADV_REGISTRY_BYTES, { mode: 0o600 });
    fs.writeFileSync(join(dir, `${LANE}.json`), JSON.stringify(ADV_CATALOGUE));
    const m = spawnSync(process.execPath, [join(home, 'ccrc', 'deploy', 'models-op.mjs'), 'materialise',
      '--file', join(home, '.ccrc', 'accounts.json'), '--id', LANE], { env, encoding: 'utf8' });
    expect(m.status, `${m.stdout}${m.stderr}`).toBe(0);
    return { home, env };
  }

  /** Another writer, outside the verb: a real `flock` on the lane's lock, held until `release`. */
  async function holdLock(home: string): Promise<ChildProcess> {
    fs.mkdirSync(join(home, '.ccrc', 'locks'), { recursive: true, mode: 0o700 });
    const child = spawn('flock', [join(home, '.ccrc', 'locks', `models-${LANE}.lock`), 'sh', '-c', 'echo held; read _'],
      { stdio: ['pipe', 'pipe', 'ignore'] });
    holders.push(child);
    await new Promise<void>((resolve, reject) => {
      child.stdout!.once('data', () => resolve());
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`the lock holder exited (${code}) before it held the lock`)));
    });
    return child;
  }

  /** The route over the local arm's own body (`localIOFor`'s `models`: `runModelsOp` over `makeModelsSpawn`), with the
   *  contained environment in place of the process's, so the child's PATH puts the poisoned gh and curl first. */
  async function serverOver(b: { home: string; env: NodeJS.ProcessEnv }): Promise<FastifyInstance> {
    const base = localIOFor(b.home);
    const io: FleetIO = { ...base, models: (lane, action, cls) => runModelsOp(makeModelsSpawn(modelsEnv(b.home, b.env)), b.home, lane, action, cls) };
    const app = Fastify();
    registerLaneModelsRoutes(app, {
      io, ccrcDir: join(b.home, '.ccrc'), hasLane: (l) => ROSTER.accounts.some((a) => a.id === l), actorOf: () => 'device:race-test',
    });
    apps.push(app);
    return app;
  }

  const advanceFile = (home: string): string => join(home, '.ccrc', 'models', `${LANE}.advance.json`);
  const readHold = (home: string): { at: string; by: string } | null =>
    (JSON.parse(fs.readFileSync(advanceFile(home), 'utf8')) as { classes: Record<string, { hold: { at: string; by: string } | null }> }).classes[CLS]!.hold;

  /** The hourly step's commit, as `_models_node_locked` runs it: the op's own `advance-commit`, for a candidate whose canary passed. */
  function commit(b: { home: string; env: NodeJS.ProcessEnv }): Record<string, unknown> {
    const r = spawnSync(process.execPath, [join(b.home, 'ccrc', 'deploy', 'models-op.mjs'), 'advance-commit',
      '--file', join(b.home, '.ccrc', 'accounts.json'), '--id', LANE, '--class', CLS, '--from', FROM, '--to', TO, '--canary', 'passed'],
    { env: b.env, encoding: 'utf8' });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines.length, r.stdout).toBe(2);
    return JSON.parse(lines[0]!) as Record<string, unknown>;
  }

  it.skipIf(!HAVE_FLOCK)('the hold waits out the commit and lands: it does not answer while the lock is held, then 200 done, held by hand', async () => {
    const b = box();
    const app = await serverOver(b);
    const holder = await holdLock(b.home);
    let settled = false;
    const pending = app.inject({ method: 'POST', url: `/api/models/${LANE}`, payload: { action: 'hold', class: CLS } })
      .then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 1_500));
    expect(settled, 'the hold answered while the commit held the lane').toBe(false);
    expect(fs.existsSync(advanceFile(b.home)), 'the hold wrote under a held lock').toBe(false);
    await release(holder);
    const res = await pending;
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, lane: LANE, action: 'hold', class: CLS, changed: true, partial: false });
    // the fresh read, asked after the act: the lane's classes and its advance state, the hold in it
    expect(body.models.kind).toBe('read');
    expect(body.models.advance.state).toBe('ok');
    expect(body.models.advance.classes[CLS].hold).toMatchObject({ by: 'hand' });
    // the advance file itself records the hold
    const hold = readHold(b.home);
    expect(hold).toMatchObject({ by: 'hand' });
    expect(hold!.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  }, 60_000);

  it.skipIf(!HAVE_FLOCK)('the commit that follows the hold abandons held and moves nothing: the Hold wins', async () => {
    const b = box();
    const app = await serverOver(b);
    const res = await app.inject({ method: 'POST', url: `/api/models/${LANE}`, payload: { action: 'hold', class: CLS } });
    expect(res.statusCode, res.body).toBe(200);
    expect(readHold(b.home)).toMatchObject({ by: 'hand' });
    const registryBefore = fs.readFileSync(join(b.home, '.ccrc', 'models', `${LANE}.classes.json`), 'utf8');
    const answer = commit(b);
    expect(answer).toMatchObject({ ok: true, op: 'advance-commit', class: CLS, outcome: 'abandoned', why: 'held' });
    expect(fs.readFileSync(join(b.home, '.ccrc', 'models', `${LANE}.classes.json`), 'utf8'), 'the held class moved').toBe(registryBefore);
    expect(readHold(b.home), 'the commit dropped the hold').toMatchObject({ by: 'hand' });
  }, 60_000);

  it.skipIf(!HAVE_FLOCK)('a commit that outlasts the lock wait is 409 lane-act-refused lock-busy, inside the spawn bound, and writes nothing', async () => {
    const b = box();
    const app = await serverOver(b);
    await holdLock(b.home);
    const t0 = Date.now();
    const res = await app.inject({ method: 'POST', url: `/api/models/${LANE}`, payload: { action: 'hold', class: CLS } });
    const took = Date.now() - t0;
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'lane-act-refused', verbCode: 'lock-busy' });
    expect(took, 'the verb gave up before its own lock wait').toBeGreaterThanOrEqual(19_000);
    expect(took, 'the agent had to stop the child').toBeLessThan(40_000);
    expect(fs.existsSync(advanceFile(b.home))).toBe(false);
  }, 90_000);
});
