// Programme model-class-advance, wave R4 (plan Review Focus line 1, races and locks; Task 19's end-to-end describe as
// re-planned): `POST /api/models/:lane` holds against the lane-files lock the advance step's locked commit takes. The route
// runs over `localIOFor(home)` ITSELF, so `localModels` (its `modelsEnv`, its bounded port, its `not-started` catch) runs
// for real, against the REAL `ccd/ccrc` behind `_inst_shim`'s own launcher bytes, the real lane-files lock, and a real
// `flock` holder in another process (an inert `sh -c 'echo held; read _'`, so it stands in for ANY writer holding the lock,
// not for the commit itself). `modelsEnv` copies PATH and LANG from `process.env`, so each case points those two at this
// suite's contained environment for its duration and restores them after. That does NOT keep the poisoned gh and curl first:
// `modelsEnv` (agent/src/modelsop.ts) puts node's own directory ahead of PATH, so where node is /usr/bin/node the real
// gh and curl sit ahead of the poisoned copies. It makes no difference here, and the header says so rather than claim a
// guard: the hold/release/revert path (`ccrc models <lane> hold|release|revert`, `_models_answer_locked` and
// `_models_node_locked` in ccd/ccrc, then deploy/models-op.mjs and shared/model-advance.mjs) never calls gh or curl,
// so the poisoned copies guard nothing it runs; they only keep a stray call from the harness itself contained.
//
// WHAT THE CASES PROVE, and no more:
//  1. the hold serialises behind a held lane lock, answers nothing until it is released, then lands (200 done, held by hand);
//  2. an `advance-commit` that runs AFTER a hold respects it (abandoned `held`, the class not moved);
//  3. a lock held past the verb's wait refuses the hold `lock-busy` (409) and writes nothing;
//  4. a locked `advance-commit` (the step's own `_models_node_locked`) and the POST's hold, both waiting on one held
//     lock and released together, leave a consistent end state whichever takes the lock first.
// They do NOT run the hourly step itself, nor a commit racing a hold that is mid-write: the verb's lock is what orders them.
// In case 4 the order the two waiters take the lock in is the kernel's, so the case asserts the invariant both orders keep.
// In every observed run the commit took the lock first, so case 4's `abandoned` branch (hold first) has NOT been seen to
// run; it asserts an invariant both orders keep, not an order the suite forces.
//
// SKIPPED WITHOUT flock, NEVER PASSED: every case is `it.skipIf(!HAVE_FLOCK)`, and `HAVE_FLOCK` is MEASURED (`flock
// --version` exits 0), so a box with no flock shows these as skipped in the run's summary and never as a vacuous pass.
//
// CONTAINED. HOME is a `mkTmp` directory; `ghContainedEnv` poisons gh and the service managers, and curl is poisoned here;
// the child sees exactly {HOME, PATH, LANG} (the op's three-name environment), so `CCRC_MODELS_LOCK_S` cannot reach it and
// the lock wait is the verb's default 20 s. Fixture lanes only (`lane-b` is codex-kind), every model id neutral.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { localIOFor } from '../src/io.js';
import { registerLaneModelsRoutes } from '../src/laneModelsRoutes.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { ADV_CATALOGUE, ADV_REGISTRY_BYTES } from './fixtures/advanceCases.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const HAVE_FLOCK = spawnSync('flock', ['--version'], { encoding: 'utf8' }).status === 0;

const LANE = 'lane-b';
/** The class held: its pin and the newer model an advance would move it to are in the fixture catalogue. */
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

describe('a POST hold against the lane-files lock: the real local arm (localIOFor), the real ccrc, a real flock holder', () => {
  const holders: ChildProcess[] = [];
  const homes: string[] = [];
  const apps: FastifyInstance[] = [];
  // `localModels` builds its child's PATH and LANG from `process.env`, so a case points them at its contained
  // environment and `afterEach` puts them back.
  let savedPath: string | undefined;
  let savedLang: string | undefined;
  beforeEach(() => { savedPath = process.env.PATH; savedLang = process.env.LANG; });

  const release = (child: ChildProcess): Promise<void> => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once('exit', () => resolve());
    if (child.stdin) child.stdin.end(); else child.kill();   // a child spawned with stdin 'ignore' (lockedCommit) has none
  });
  afterEach(async () => {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    if (savedLang === undefined) delete process.env.LANG; else process.env.LANG = savedLang;
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
    // The launcher's bytes from `_inst_shim` itself. The script is a constant and no path reaches the shell's argument
    // list: the file to source comes in through the environment, and node writes the shim from stdout.
    const r = spawnSync('bash', ['-c', 'set --; . "$CCRC_RACE_SRC"; _inst_shim'],
      { env: { ...env, CCRC_RACE_SRC: join(REPO, 'ccd', 'ccrc') }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.startsWith('#!'), 'the launcher `_inst_shim` printed is not a script (no shebang)').toBe(true);
    fs.writeFileSync(shim, r.stdout, { mode: 0o755 });
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

  /** The route over `localIOFor(home)`, the local arm as the server wires it. For this case's length the process's PATH and
   *  LANG are the contained environment's, the two names `modelsEnv` copies (HOME is the fixture home by construction). */
  async function serverOver(b: { home: string; env: NodeJS.ProcessEnv }): Promise<FastifyInstance> {
    process.env.PATH = b.env.PATH;
    process.env.LANG = b.env.LANG;
    const app = Fastify();
    registerLaneModelsRoutes(app, {
      io: localIOFor(b.home), ccrcDir: join(b.home, '.ccrc'), hasLane: (l) => ROSTER.accounts.some((a) => a.id === l),
      actorOf: () => 'device:race-test',
    });
    apps.push(app);
    return app;
  }

  const advanceFile = (home: string): string => join(home, '.ccrc', 'models', `${LANE}.advance.json`);
  const readHold = (home: string): { at: string; by: string } | null =>
    (JSON.parse(fs.readFileSync(advanceFile(home), 'utf8')) as { classes: Record<string, { hold: { at: string; by: string } | null }> }).classes[CLS]!.hold;

  /** The commit's verb alone, UNLOCKED: the op's own `advance-commit`, for a candidate whose canary passed. */
  function commit(b: { home: string; env: NodeJS.ProcessEnv }): Record<string, unknown> {
    const r = spawnSync(process.execPath, [join(b.home, 'ccrc', 'deploy', 'models-op.mjs'), 'advance-commit',
      '--file', join(b.home, '.ccrc', 'accounts.json'), '--id', LANE, '--class', CLS, '--from', FROM, '--to', TO, '--canary', 'passed'],
    { env: b.env, encoding: 'utf8' });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines.length, r.stdout).toBe(2);
    return JSON.parse(lines[0]!) as Record<string, unknown>;
  }

  it.skipIf(!HAVE_FLOCK)('the hold waits out a held lock and lands: it does not answer while the lock is held, then 200 done, held by hand', async () => {
    const b = box();
    const app = await serverOver(b);
    const holder = await holdLock(b.home);
    let settled = false;
    const pending = app.inject({ method: 'POST', url: `/api/models/${LANE}`, payload: { action: 'hold', class: CLS } })
      .then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 1_500));
    expect(settled, 'the hold answered while another writer held the lane').toBe(false);
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

  // revert-ends-itself: a hand hold waits only to be passed by a model newer than its own, and the commit's candidate is
  // one, so the commit that follows it moves the class and clears the hold in the same write.
  it.skipIf(!HAVE_FLOCK)('the commit that follows a hand hold moves past it: a hold ends at the next newer model', async () => {
    const b = box();
    const app = await serverOver(b);
    const res = await app.inject({ method: 'POST', url: `/api/models/${LANE}`, payload: { action: 'hold', class: CLS } });
    expect(res.statusCode, res.body).toBe(200);
    expect(readHold(b.home)).toMatchObject({ by: 'hand' });
    const registryBefore = fs.readFileSync(join(b.home, '.ccrc', 'models', `${LANE}.classes.json`), 'utf8');
    const answer = commit(b);
    expect(answer).toMatchObject({ ok: true, op: 'advance-commit', class: CLS, outcome: 'moved' });
    expect(fs.readFileSync(join(b.home, '.ccrc', 'models', `${LANE}.classes.json`), 'utf8'), 'the class moved').not.toBe(registryBefore);
    expect(readHold(b.home), 'the commit cleared the hold it ended').toBeNull();
  }, 60_000);

  /** The step's own locked commit: `_models_node_locked` from the real `ccd/ccrc`, a bash process that waits on the lane's
   *  lock as the hourly refresh does. Everything reaches it through the environment: the script is a constant. */
  function lockedCommit(b: { home: string; env: NodeJS.ProcessEnv }): Promise<{ code: number | null; first: Record<string, unknown> | null; stdout: string }> {
    const child = spawn('bash', ['-c',
      'set --; . "$CCRC_RACE_SRC"; _models_node_locked "$CCRC_RACE_LANE" advance-commit --file "$HOME/.ccrc/accounts.json" '
      + '--id "$CCRC_RACE_LANE" --class "$CCRC_RACE_CLASS" --from "$CCRC_RACE_FROM" --to "$CCRC_RACE_TO" --canary passed'],
    { env: { ...b.env, CCRC_RACE_SRC: join(b.home, 'ccrc', 'ccd', 'ccrc'), CCRC_RACE_LANE: LANE, CCRC_RACE_CLASS: CLS,
      CCRC_RACE_FROM: FROM, CCRC_RACE_TO: TO }, stdio: ['ignore', 'pipe', 'pipe'] });
    holders.push(child);
    let stdout = '';
    child.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
    return new Promise((resolve) => {
      child.once('exit', (code) => {
        let first: Record<string, unknown> | null = null;
        try { first = JSON.parse(stdout.split('\n')[0]!) as Record<string, unknown>; } catch { first = null; }
        resolve({ code, first, stdout });
      });
    });
  }

  it.skipIf(!HAVE_FLOCK)('a locked advance-commit and the POST\'s hold both wait on one held lock: whichever takes it first, the end state is consistent', async () => {
    const b = box();
    const app = await serverOver(b);
    const holder = await holdLock(b.home);
    let postSettled = false;
    let commitSettled = false;
    const pending = app.inject({ method: 'POST', url: `/api/models/${LANE}`, payload: { action: 'hold', class: CLS } })
      .then((r) => { postSettled = true; return r; });
    const committing = lockedCommit(b).then((r) => { commitSettled = true; return r; });
    await new Promise((r) => setTimeout(r, 2_000));
    expect(postSettled, 'the hold answered while the lock was held').toBe(false);
    expect(commitSettled, 'the commit ran while the lock was held').toBe(false);
    expect(fs.existsSync(advanceFile(b.home)), 'a writer wrote under a held lock').toBe(false);
    await release(holder);
    const [res, commitRes] = await Promise.all([pending, committing]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, action: 'hold', class: CLS, changed: true });
    expect(commitRes.first, commitRes.stdout).toMatchObject({ ok: true, op: 'advance-commit', class: CLS });
    // The lock orders them, and either order is whole (revert-ends-itself: a hand hold waits only to be passed by a model
    // newer than its own, and the commit's candidate is one). Hold first: the commit moves past it and clears the hold in
    // the write that records the move. Commit first: the class moves, and the hold lands on the moved model. Either way
    // the class is at TO, and a hold stands only on the model the class runs.
    const registry = JSON.parse(fs.readFileSync(join(b.home, '.ccrc', 'models', `${LANE}.classes.json`), 'utf8')) as { classes: Record<string, string> };
    expect(commitRes.first).toMatchObject({ outcome: 'moved' });
    expect(registry.classes[CLS]).toBe(TO);
    // Hold first, the POST's `changed: true` above is the hold it placed; its answer is a re-read after the act, which the
    // commit may already have passed, so it is not pinned in that order.
    const hold = readHold(b.home);
    if (hold !== null) {
      expect(hold, 'commit first: the hold lands on the moved model').toMatchObject({ by: 'hand' });
      expect((res.json().models as { advance: { classes: Record<string, { hold: unknown }> } }).advance.classes[CLS]!.hold)
        .toMatchObject({ by: 'hand' });
    }
  }, 90_000);

  it.skipIf(!HAVE_FLOCK)('a lock held past the verb\'s wait is 409 lane-act-refused lock-busy, inside the spawn bound, and writes nothing', async () => {
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
