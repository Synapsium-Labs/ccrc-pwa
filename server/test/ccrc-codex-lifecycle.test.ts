// `ccrc codex`, part: lifecycle and login (D-6878). `ccrc-codex.test.ts` asked D-6856's allocator for more than the 500 ports it
// issues to one file, so its fixture-contract, lifecycle and login describes moved here unchanged; fixtures: `ccrcCodexFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs, {
  chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { pythonOrSkip } from './ccgptHarness.js';
import { describeLinux, IS_DARWIN, itLinux } from './platformFixtures.js';
import {
  alive, codexAuthDir, codexRoster, eventually, failUnitStop, fakeUnit, freePorts, killLaneProcesses, laneAnswer,
  litellmEvidence, litellmTeardownEvents, plantCodexBins, plantFakeRuntime, plantLaneConfig, plantSystemd, portAccepts, psArgs,
  refuseLitellmStart, registerLaneCleanup, resistLitellmTerm, slowLitellmListen, spawnFakeLitellm, spawnListener, systemctlCalls, systemdRunArgv,
  systemdRunCalls, trackChild, unitPid,
} from './codexLaneFixture.js';
import type { FakeRuntime } from './codexLaneFixture.js';
import {
  AUTH_LIB, AUTH_ROUTES, fakeAuthServer, plantBackendCredential,
  syntheticJwt, type AuthAnswer, type AuthScript,
} from './codexAuthFixture.js';
import {
  installCcrcCodexHooks, here, REPO, BASH, PY, env, box, type Result, lib, ccrc,
  twoLanes, laneDir, litellmYaml, sha256, litellmCode, authLib, refusedRefresh,
} from './ccrcCodexFixture.js';

installCcrcCodexHooks();

// The fixture's own contract, for the suites after this one: the lifecycle,
// launcher, spine, uninstall and account-removal cases plant EVERY built
// runtime generation through `plantFakeRuntime` and every manager through
// `plantSystemd`. Neither case below calls the library.
describe('codexLaneFixture — the runtime and the manager later suites plant through it', () => {
  it('plantFakeRuntime: a named generation, a custom interpreter body, and no stamp — each as the REAL ccgpt-runtime reads it', () => {
    const h = box('ccrc-codex-fixture-runtime-');
    const { runtimeCli } = plantCodexBins(h);
    const python = (): Result => {
      const r = spawnSync(BASH, [runtimeCli, 'python'], { env: env(h), encoding: 'utf8', timeout: 15_000 });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const body = '#!/bin/sh\necho "a custom interpreter body" >&2\nexit 42\n';
    const named = plantFakeRuntime(h, { generationName: 'gen-20260101T000000Z-1', python: body });
    expect(path.basename(named.gen)).toBe('gen-20260101T000000Z-1');
    expect(fs.readlinkSync(join(named.root, 'current'))).toBe('gen-20260101T000000Z-1');
    expect(fs.readFileSync(named.python, 'utf8')).toBe(body);
    expect(fs.existsSync(named.stamp)).toBe(true);
    // `python` runs no interpreter, so the body's exit 42 never shows.
    expect(python().stdout).toBe(`${named.gen}/bin/python\n`);
    // No stamp: a generation `ccgpt-runtime python` calls mutated, not absent.
    const bare = plantFakeRuntime(h, { generationName: 'gen-20260101T000000Z-2', stamp: false });
    expect(bare.stamp).toBeNull();
    expect(fs.existsSync(join(bare.gen, '.ccrc-runtime.json'))).toBe(false);
    expect(python()).toEqual({ code: 1, stdout: '', stderr: 'ccgpt-runtime: mutated\n' });
    // A name off the builder's generation shape throws here, rather than
    // planting a runtime the builder reads as absent.
    expect(() => plantFakeRuntime(h, { generationName: 'gen-latest' })).toThrow(/generationName "gen-latest"/);
    expect(fs.readlinkSync(join(bare.root, 'current'))).toBe('gen-20260101T000000Z-2');
  });

  it('plantSystemd\'s refuseSpawn: systemd-run records the call, refuses in a real manager\'s words, and runs nothing — while the manager stays up', () => {
    const h = box('ccrc-codex-fixture-refusespawn-');
    plantSystemd(h, { userManager: true, refuseSpawn: true });
    const bin = join(h, '.local', 'bin');
    const marker = join(h, 'spawned');
    const run = (cmd: string, args: string[]): Result => {
      const r = spawnSync(BASH, [join(bin, cmd), ...args], { env: env(h), encoding: 'utf8', timeout: 15_000 });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const start = (): Result =>
      run('systemd-run', ['--user', '--collect', '--quiet', '--unit=fixture-refused.service', '--', 'touch', marker]);
    const r = start();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^Failed to start transient service unit: /);
    expect(systemdRunCalls(h)).toEqual([`--user --collect --quiet --unit=fixture-refused.service -- touch ${marker}`]);
    expect(fs.existsSync(marker), 'a refusing manager ran the command').toBe(false);
    // The manager is UP, so a unit can still be asked about: the shape a
    // suite needs to prove a path asks and never starts.
    expect(run('systemctl', ['--user', 'show-environment']).code).toBe(0);
    // CONTROL: planting again without the knob clears it, and the refusal
    // sentence goes with it.
    plantSystemd(h, { userManager: true });
    expect(fs.existsSync(join(h, 'fake-systemd', 'refuse-spawn'))).toBe(false);
    expect(start().stderr).not.toMatch(/^Failed to start transient service unit: /);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Plan 2b-2 Task 5 — `ccrc codex start|stop|status`: the lane RUNS, in fixtures.
//
// These cases run REAL processes on kernel-chosen loopback ports: the shipped
// shim (the copy `plantCodexBins` placed, exec'd by the fake runtime python
// with ccrc's own argv) and a stdlib stand-in for LiteLLM. The service manager
// is codexLaneFixture.ts' fake, which Task 5 taught to run what it is handed.
//
// Containment is this file's (its header, and Task 4's `box`/`env`):
//   - `plantSystemd` runs before `env()`, so a real systemd-run or systemctl
//     is unreachable; `curl` stays poisoned, and one case asserts it untouched
//     — the library speaks HTTP over bash's own /dev/tcp.
//   - No case binds or probes a fixed port.
//   - `killLaneProcesses` runs current-run product stops while the fixture
//     state exists, then ends direct current-run child handles. Persisted PIDs
//     are observations only.
// ════════════════════════════════════════════════════════════════════════════
describe.skipIf(!PY)('ccrc codex start|stop|status: the lane runs, in fixtures (Plan 2b-2 Task 5)', () => {
  const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

  interface Lane { proxyPort: number; litellmPort: number; authDir: string }
  interface Life { home: string; lanes: Record<string, Lane>; rt: FakeRuntime; shimFile: string }

  /** `ccrc codex <args>` as the launcher runs it: this file's `env()` with a
   *  20 s readiness bound, a timeout past a start's lock wait plus its own
   *  readiness wait, and stdin from /dev/null so a detached tier inherits
   *  nothing spawnSync waits on. */
  function codex(home: string, args: string[], extra: NodeJS.ProcessEnv = {}): Result {
    const r = spawnSync(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), 'codex', ...args], {
      env: env(home, { CCRC_CODEX_READY_S: '20', ...extra }), encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 150_000,
    });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }
  /** The same verb, NOT awaited: for the cases where two verbs overlap. */
  function codexAsync(home: string, args: string[], extra: NodeJS.ProcessEnv = {}): Promise<Result> {
    return new Promise((resolve) => {
      const c = spawn(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), 'codex', ...args],
        { env: env(home, { CCRC_CODEX_READY_S: '20', ...extra }), stdio: ['ignore', 'pipe', 'pipe'] });
      trackChild(home, c);
      let out = '';
      let err = '';
      c.stdout!.on('data', (x: Buffer) => { out += x.toString(); });
      c.stderr!.on('data', (x: Buffer) => { err += x.toString(); });
      c.on('close', (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
    });
  }

  const logDir = (home: string, id: string): string => join(home, '.ccrc', 'logs', 'codex', id);
  const stopCalls = (home: string): string[] => systemctlCalls(home).filter((c) => c.startsWith('--user stop'));

  /** `env(home)`'s PATH with `tool` reachable NOWHERE and nothing else
   *  missing: the fixture's own `.local/bin` first (the fake manager, the
   *  poisons), then one directory of links to the first copy of every other
   *  executable on that PATH. The list is DERIVED, because the whole verb runs
   *  under this PATH and a hand-kept list would be a second census of what it
   *  calls. `ccrc-installFixture.ts`' `pathWithout` keeps one, and its comments
   *  count what that has cost. */
  function pathWithout(home: string, tool: string): string {
    const head = join(home, '.local', 'bin');
    if (fs.existsSync(join(head, tool))) throw new Error(`pathWithout: the fixture itself planted ${tool} in ${head}`);
    const d = join(home, `no-${tool}-bin`);
    fs.mkdirSync(d, { recursive: true });
    const seen = new Set<string>([tool]);
    for (const dir of (env(home)['PATH'] ?? '').split(':')) {
      if (dir === '' || path.resolve(dir) === head || !fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (seen.has(name)) continue;
        const p = join(dir, name);
        try {
          fs.accessSync(p, fs.constants.X_OK);
          if (!fs.statSync(p).isFile()) continue;
        } catch { continue; }
        seen.add(name);
        fs.symlinkSync(p, join(d, name));
      }
    }
    return `${head}:${d}`;
  }

  /** A fleet box in miniature, on Task 4's `box()`:
   *  - the tree `ccrc` resolves against, the fake manager and the poisons;
   *  - `ccgpt-runtime` and `ccgpt-proxy.py` placed as `_inst_bins` would
   *    (`plantCodexBins`: copies of the shipped files, so the shim that runs IS
   *    the shipped file);
   *  - the codex roster, and a class registry and lane.json per lane, both
   *    written through the real verb;
   *  - a backend credential per lane (`plantBackendCredential`, fresh: what
   *    `ccrc codex start` reads through the auth library, codex-bridge Stage 1
   *    Task 8), and a litellm.yaml per lane rendered by the real renderer
   *    (`plantLaneConfig`, ruling R20);
   *  - the fake runtime. */
  async function lifeBox(opts: { userManager: boolean; ids?: string[] }): Promise<Life> {
    const home = box('ccrc-codex-life-', { userManager: opts.userManager });
    const { shimFile } = plantCodexBins(home);
    const ids = opts.ids ?? ['codex-a', 'codex-b'];
    const ports = await freePorts(ids.length * 2);
    codexRoster(home, ids.map((id, i) => ({ id, proxyPort: ports[2 * i]!, litellmPort: ports[2 * i + 1]! })));
    const rt = plantFakeRuntime(home);
    const lanes: Record<string, Lane> = {};
    ids.forEach((id, i) => {
      const authDir = codexAuthDir(id);
      lanes[id] = { proxyPort: ports[2 * i]!, litellmPort: ports[2 * i + 1]!, authDir };
      // This is deliberately registered before any caller can start the lane.
      // It invokes the real product stop while roster, lane and fake-manager
      // state still exist; cleanup ignores the result to preserve test failures.
      registerLaneCleanup(home, `codex:${id}`, () => { codex(home, ['stop', id]); });
      const init = ccrc(home, ['models', id, 'init', 'codex']);
      expect(init.code, init.stderr).toBe(0);
      fs.mkdirSync(join(home, authDir), { recursive: true, mode: 0o700 });
      plantBackendCredential(join(home, authDir));
      expect(plantLaneConfig(home, id)).toBe(litellmYaml(home, id));
    });
    return { home, lanes, rt, shimFile };
  }

  // ── the tier's auth library (codex-bridge Stage 1, Task 6) ─────────────────
  // `_codex_start_tier` alone, its platform helper replaced by a recorder that
  // prints the nohup answer a start gives, so each case reads the exact argv a
  // spawn would have run and nothing is started.
  const SVC_RECORDER = '_svc_run_supervised() { printf \'%s\\n\' "$@" > "$HOME/svc-$TIER"; echo "nohup 999999"; }';
  const startTier = (home: string, tier: string): Result =>
    lib(home, `${SVC_RECORDER}\nTIER=${tier}; _codex_start_tier codex-a ${tier}`);
  const svcArgs = (home: string, tier: string): string[] | null => {
    const f = join(home, `svc-${tier}`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : null;
  };
  /** The NAME=VALUE pairs handed to the helper, before its `--`. */
  const pairs = (argv: string[]): string[] => argv.slice(0, argv.indexOf('--')).filter((x) => /^[A-Z_]+=/.test(x));

  it('the litellm tier is started with CCRC_CODEX_AUTH_LIB and CCRC_CODEX_LANE', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const r = startTier(home, 'litellm');
    expect(r.code, r.stderr).toBe(0);
    const argv = svcArgs(home, 'litellm')!;
    expect(pairs(argv)).toEqual(expect.arrayContaining([
      `CCRC_CODEX_AUTH_LIB=${authLib(home)}`, 'CCRC_CODEX_LANE=codex-a']));
  });

  it('the shim tier is not', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const r = startTier(home, 'shim');
    expect(r.code, r.stderr).toBe(0);
    expect(pairs(svcArgs(home, 'shim')!).filter((p) => p.startsWith('CCRC_CODEX_'))).toEqual([]);
  });

  it('no library: auth-library-absent, nothing started, and no stamp sentence', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    fs.rmSync(authLib(home));
    const r = startTier(home, 'litellm');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: auth-library-absent: .*'ccrc update'/m);
    // Never the runtime's refusal: the runtime is current and its stamp readable.
    expect(r.stderr).not.toMatch(/runtime-absent|\.ccrc-runtime\.json/);
    expect(svcArgs(home, 'litellm'), 'a tier was started with no auth library').toBeNull();
    expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'litellm.started'))).toBe(false);
  });

  it('no library: the shim tier still starts', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    fs.rmSync(authLib(home));
    const r = startTier(home, 'shim');
    expect(r.code, r.stderr).toBe(0);
    expect(svcArgs(home, 'shim')).not.toBeNull();
  });

  // ── L0: the instrument, before anything leans on it ────────────────────────
  it.skipIf(!PY)('L0 the instrument: the fake manager requests a per-unit Python supervisor stop, waits for exact-child completion, refuses a second live unit of one name, and its stop ends only what this HOME started', async () => {
    const home = box('ccrc-codex-fake-', { userManager: true });
    // The parse gate first (ruling R44): every program this task's fixture
    // writes as a whole file parses — the two manager fakes, the runtime
    // interpreter with its tier arms, and the stand-in LiteLLM.
    const gen = plantFakeRuntime(home).gen;
    for (const f of [join(home, '.local', 'bin', 'systemctl'), join(home, '.local', 'bin', 'systemd-run'),
      join(gen, 'bin', 'python')]) {
      const n = spawnSync(BASH, ['-n', f], { encoding: 'utf8' });
      expect(n.status, `bash -n ${f}: ${n.stderr}`).toBe(0);
    }
    const standIn = join(home, 'fake-procs', 'fake-litellm.py');
    const ast = spawnSync(PY!, ['-I', '-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', standIn],
      { encoding: 'utf8' });
    expect(ast.status, `${standIn}: ${ast.stderr}`).toBe(0);
    const e = env(home, { CALLER_ONLY: 'leaked' });
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const log = join(home, 'probe.log');
    const code = 'import os,signal,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print(os.environ.get("A"), os.environ.get("CALLER_ONLY")); sys.stdout.flush(); time.sleep(12)';
    const run = `systemd-run --user --collect --quiet --unit=probe.service -p ${shq(`StandardOutput=append:${log}`)}`
      + ` -p ${shq(`StandardError=append:${log}`)} --setenv=A=1 -- ${shq(PY!)} -B -c ${shq(code)} ${shq(join(home, 'probe-marker'))}`;
    const r = sh(run);
    expect(r.status, r.stderr).toBe(0);
    // `1 None`: the --setenv pair arrived, and the CALLER's environment did not.
    await eventually(() => fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('1 None'), 'the probe line in its log');
    expect(sh('systemctl --user is-active probe.service').stdout.trim()).toBe('active');
    const pid = unitPid(home, 'probe.service');
    expect(pid).toBeGreaterThan(1);
    expect(sh('systemctl --user show -p MainPID --value probe.service').stdout.trim()).toBe(String(pid));
    // ONE live unit per name, as the real manager refuses a second.
    const dup = sh(run);
    expect([dup.status, /already exists/.test(dup.stderr)]).toEqual([1, true]);
    expect(sh('systemctl --user stop probe.service').status).toBe(0);
    await eventually(() => !alive(pid!), 'the probe to exit');
    const unitDir = join(home, 'fake-systemd', 'units', 'probe.service');
    // Fake systemctl can only request and await a named unit stop. Its Python
    // supervisor alone retains the direct child that receives TERM/KILL.
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean))
      .toEqual(['TERM', 'TIMEOUT', 'KILL', 'WAIT:-9']);
    expect(fs.readFileSync(join(unitDir, 'state'), 'utf8')).toBe('inactive\n');
    expect(fs.readFileSync(join(unitDir, 'pid'), 'utf8')).toBe('0\n');
    const after = sh('systemctl --user is-active probe.service');
    expect(after.stdout.trim()).toBe('inactive');
    expect(after.status).not.toBe(0);
    // A seeded unit with no supervisor/control channel becomes inactive without
    // signalling its observed PID, so the stranger keeps running.
    const stranger = spawn('sleep', ['600'], { stdio: 'ignore' });
    trackChild(home, stranger);
    fakeUnit(home, 'stranger.service', { state: 'active', pid: stranger.pid! });
    expect(sh('systemctl --user stop stranger.service').status).toBe(0);
    expect(sh('systemctl --user is-active stranger.service').stdout.trim()).toBe('inactive');
    expect(psArgs(stranger.pid!)).toMatch(/^sleep 600/);
    expect(systemdRunArgv(home)[0]!.slice(0, 4)).toEqual(['--user', '--collect', '--quiet', '--unit=probe.service']);
  }, 60_000);

  it.skipIf(!PY)('L0a a responsive fake-manager tier records exact-child TERM then WAIT before stop marks its unit inactive', async () => {
    const home = box('ccrc-codex-manager-responsive-', { userManager: true });
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const unit = 'responsive.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const run = `systemd-run --user --collect --quiet --unit=${unit} -- ${shq(PY!)} -B -c ${shq('import time; time.sleep(12)')}`;
    expect(sh(run).status).toBe(0);
    await eventually(() => fs.existsSync(join(unitDir, 'pid')) && unitPid(home, unit) !== null, 'the manager tier pid');
    const pid = unitPid(home, unit)!;
    expect(sh(`systemctl --user stop ${unit}`).status).toBe(0);
    expect(alive(pid), 'manager completion preceded the exact-child reap').toBe(false);
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean)).toEqual(['TERM', 'WAIT:-15']);
    expect(fs.readFileSync(join(unitDir, 'state'), 'utf8')).toBe('inactive\n');
    expect(fs.readFileSync(join(unitDir, 'pid'), 'utf8')).toBe('0\n');
  }, 30_000);

  it.skipIf(!PY)('L0a a TERM-resistant fake-manager tier times out, kills and reaps its exact child before stop completion', async () => {
    const home = box('ccrc-codex-manager-resistant-', { userManager: true });
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const unit = 'resistant.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const code = 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(12)';
    const run = `systemd-run --user --collect --quiet --unit=${unit} -- ${shq(PY!)} -B -c ${shq(code)}`;
    try {
      expect(sh(run).status).toBe(0);
      await eventually(() => fs.existsSync(join(unitDir, 'pid')) && unitPid(home, unit) !== null, 'the resistant manager tier pid');
      const pid = unitPid(home, unit)!;
      const supervisorPid = Number(fs.readFileSync(join(unitDir, 'supervisor-pid'), 'utf8').trim());
      const started = Date.now();
      expect(sh(`systemctl --user stop ${unit}`).status).toBe(0);
      expect(Date.now() - started, 'manager stop waited for self-expiry').toBeLessThan(9_000);
      // Round 2 (rereview Minor 2): a BEHAVIOURAL pin on the final exact wait.
      // The supervisor lingers after completion and reaps nothing more, so a
      // KILLed child it never waited for would still be its zombie here. Both
      // reads are `ps` observations, the tier's first: a supervisor row still
      // present at the second read was present at the first, so the first read
      // happened inside that window and cannot pass vacuously.
      const tierAfterStop = psArgs(pid);
      const supervisorAfterStop = psArgs(supervisorPid);
      expect(supervisorAfterStop, 'the supervisor no longer lingers after completion, so this pin binds nothing')
        .toContain(join(unitDir, 'supervisor.py'));
      expect(tierAfterStop, 'WAIT:-9 was written without the final exact wait').toBe('');
      expect(alive(pid), 'manager completion preceded the exact-child reap').toBe(false);
      const events = fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean);
      expect(events).toEqual(['TERM', 'TIMEOUT', 'KILL', 'WAIT:-9']);
      expect(fs.readFileSync(join(unitDir, 'state'), 'utf8')).toBe('inactive\n');
      expect(fs.readFileSync(join(unitDir, 'stop-complete'), 'utf8')).toBe('complete\n');
      const supervisor = fs.readFileSync(join(unitDir, 'supervisor.py'), 'utf8');
      const stopBody = supervisor.slice(supervisor.indexOf('def stop_exact_child'), supervisor.indexOf('with open(out'));
      const requestArm = supervisor.slice(supervisor.indexOf('while proc.poll() is None:'), supervisor.indexOf('time.sleep(linger)'));
      expect(stopBody).toContain('status = proc.wait()');
      expect(stopBody.indexOf('status = proc.wait()')).toBeLessThan(stopBody.indexOf('record("WAIT:%d" % status)'));
      expect(requestArm.indexOf('stop_exact_child(proc)')).toBeLessThan(requestArm.indexOf('complete_inactive()'));
      expect(fs.readFileSync(join(unitDir, 'pid'), 'utf8')).toBe('0\n');
    } catch (error) {
      await eventually(() => unitPid(home, unit) === null, 'the resistant manager tier to self-expire', 15_000);
      throw error;
    }
  }, 30_000);

  it('L0a fake manager refuses an unvalidated unit name before touching its unit directory', () => {
    const home = box('ccrc-codex-manager-name-', { userManager: true });
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: env(home), encoding: 'utf8' });
    const result = sh('systemctl --user stop ..');
    expect(result.status).toBe(90);
    expect(result.stderr).toContain('unsafe unit name');
    expect(fs.existsSync(join(home, 'fake-systemd', 'state'))).toBe(false);
  });

  it('L0a a spawned starting unit stays manager-owned and completes only through its request channel', async () => {
    const home = box('ccrc-codex-manager-starting-', { userManager: true });
    const unit = 'starting.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(join(unitDir, 'spawned'), '');
    fs.writeFileSync(join(unitDir, 'state'), 'starting\n');
    fs.writeFileSync(join(unitDir, 'pid'), '0\n');
    const stop = spawn(BASH, ['-c', `systemctl --user stop ${unit}`], {
      env: env(home), stdio: 'ignore',
    });
    trackChild(home, stop);
    await eventually(() => fs.existsSync(join(unitDir, 'stop-request')),
      'the manager-owned starting unit to receive a stop request', 1_000);
    expect(fs.readFileSync(join(unitDir, 'state'), 'utf8')).toBe('starting\n');
    fs.writeFileSync(join(unitDir, 'state'), 'inactive\n');
    fs.writeFileSync(join(unitDir, 'pid'), '0\n');
    fs.writeFileSync(join(unitDir, 'stop-complete'), 'complete\n');
    const code = await new Promise<number | null>((resolve) => stop.once('exit', resolve));
    expect(code).toBe(0);
  }, 15_000);

  it.skipIf(!PY)('L0a every fake-manager supervisor has a finite default expiry above the normal readiness bound', async () => {
    const home = box('ccrc-codex-manager-default-expiry-', { userManager: true });
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const unit = 'default-expiry.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const run = `systemd-run --user --collect --quiet --unit=${unit} -- ${shq(PY!)} -B -c ${shq('import time; time.sleep(12)')}`;
    expect(sh(run).status).toBe(0);
    try {
      await eventually(() => fs.existsSync(join(unitDir, 'supervisor.py')), 'the supervisor source');
      const supervisor = fs.readFileSync(join(unitDir, 'supervisor.py'), 'utf8');
      const match = /^ttl = float\(ttl_raw\) if ttl_raw is not None else ([0-9]+(?:\.[0-9]+)?)$/m.exec(supervisor);
      expect(match, 'an unset CCRC_FAKE_SUPERVISOR_TTL must not disable expiry').not.toBeNull();
      expect(Number(match![1])).toBeGreaterThanOrEqual(120);
      expect(supervisor).toContain('deadline = time.monotonic() + ttl');
    } finally {
      sh(`systemctl --user stop ${unit}`);
    }
  }, 30_000);

  it.skipIf(!PY)('L0a a fake-manager supervisor self-expires and reaps its responsive exact child', async () => {
    const home = box('ccrc-codex-manager-expiry-', { userManager: true });
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const unit = 'expiry.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const run = `systemd-run --user --collect --quiet --unit=${unit} --setenv=CCRC_FAKE_SUPERVISOR_TTL=1 -- ${shq(PY!)} -B -c ${shq('import time; time.sleep(12)')}`;
    expect(sh(run).status).toBe(0);
    await eventually(() => fs.readFileSync(join(unitDir, 'state'), 'utf8') === 'inactive\n', 'the supervisor self-expiry', 5_000);
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean)).toEqual(['TERM', 'WAIT:-15']);
    expect(fs.readFileSync(join(unitDir, 'pid'), 'utf8')).toBe('0\n');
  }, 15_000);

  // Round 2 (rereview Important 1): the supervisor's exact-child control must
  // not depend on its evidence files, because `afterAll` deletes every fixture
  // HOME while a unit a case left running (the uninstall namesake case's
  // deliberately foreign unit) may still be alive. Each tier below sleeps 15 s
  // and then exits ON ITS OWN, so a RED here can never leave a permanent
  // process. Every assertion reads the process table for a pid recorded
  // BEFORE the deletion; nothing in these cases signals any pid.
  const selfExpiringTier = (marker: string): string =>
    `${shq(PY!)} -B -c ${shq('import time; time.sleep(15)')} ${shq(marker)}`;
  /** Observation only (`ps`): the recorded pid is still this case's tier —
   *  its argv carries `marker` — or an unreaped zombie. */
  const tierRow = (pid: number, marker: string): boolean => {
    const args = psArgs(pid);
    return args.includes(marker) || /<defunct>/.test(args);
  };
  async function startSelfExpiringUnit(home: string, unit: string, setenv = ''): Promise<{ pid: number; marker: string; unitDir: string }> {
    const e = env(home);
    const marker = join(home, `tier-marker-${unit}`);
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const r = spawnSync(BASH, ['-c', `systemd-run --user --collect --quiet --unit=${unit} ${setenv} -- ${selfExpiringTier(marker)}`],
      { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(r.status, r.stderr).toBe(0);
    await eventually(() => fs.existsSync(join(unitDir, 'supervisor-ready')) && unitPid(home, unit) !== null,
      'the self-expiring tier pid', 5_000);
    const pid = unitPid(home, unit)!;
    expect(tierRow(pid, marker), 'the recorded pid is this case\'s tier').toBe(true);
    return { pid, marker, unitDir };
  }
  /** The bounded assertion, and on its failure a wait for the tier's own
   *  15-second exit, so a RED leaves nothing behind. Never a signal. */
  async function expectTierGone(pid: number, marker: string, what: string, ms: number): Promise<void> {
    try {
      await eventually(() => !tierRow(pid, marker), what, ms);
    } catch (error) {
      await eventually(() => !tierRow(pid, marker), 'the self-expiring tier to exit on its own', 20_000);
      throw error;
    }
  }

  it.skipIf(!PY)('L0a a vanished unit directory is a stop request: the supervisor reaps its exact child with no evidence file left to write', async () => {
    const home = box('ccrc-codex-manager-vanished-', { userManager: true });
    // The default 120-second expiry: only the vanished directory can end this
    // tier inside the bound.
    const { pid, marker, unitDir } = await startSelfExpiringUnit(home, 'vanished.service');
    fs.rmSync(unitDir, { recursive: true, force: true });
    await expectTierGone(pid, marker, 'the supervisor to reap its exact child once its unit directory vanished', 8_000);
  }, 45_000);

  it.skipIf(!PY)('L0a supervisor expiry reaps its exact child after the whole fixture HOME is gone', async () => {
    const home = box('ccrc-codex-manager-expiry-nohome-', { userManager: true });
    const { pid, marker } = await startSelfExpiringUnit(home, 'expiry-nohome.service', '--setenv=CCRC_FAKE_SUPERVISOR_TTL=3');
    // What `afterAll(removeTmpFixtures)` does at the end of every file.
    fs.rmSync(home, { recursive: true, force: true });
    expect(fs.existsSync(home)).toBe(false);
    await expectTierGone(pid, marker, 'the supervisor to reap its exact child with its HOME gone', 10_000);
  }, 45_000);

  it.skipIf(!PY)('L0a a TERM to the supervisor itself is a stop request: it reaps its exact child before it exits (a directly held handle, never a pid)', async () => {
    const home = box('ccrc-codex-manager-supervisor-term-', { userManager: true });
    // One real start plants the supervisor exactly as systemd-run writes it;
    // its own unit is then stopped through the manager's request channel.
    const planted = await startSelfExpiringUnit(home, 'source.service');
    const source = join(planted.unitDir, 'supervisor.py');
    const copy = join(home, 'supervisor-under-test.py');
    fs.copyFileSync(source, copy);
    spawnSync(BASH, ['-c', 'systemctl --user stop source.service'], { env: env(home), stdio: 'ignore' });
    await expectTierGone(planted.pid, planted.marker, 'the source unit\'s requested stop', 10_000);
    // The same source, run as THIS process's direct child: the one authority
    // that may signal it is the handle below, never an observed pid.
    const unitDir = join(home, 'direct-unit');
    fs.mkdirSync(unitDir);
    const marker = join(home, 'tier-marker-direct');
    const supervisor = spawn(PY!, ['-B', copy, unitDir, home, '/dev/null', '/dev/null',
      PY!, '-B', '-c', 'import time; time.sleep(15)', marker],
    { cwd: home, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, stdio: 'ignore' });
    trackChild(home, supervisor);
    const exited = new Promise<number | null>((resolve) => supervisor.once('exit', (code) => resolve(code)));
    await eventually(() => fs.existsSync(join(unitDir, 'supervisor-ready')), 'the directly held supervisor to start its tier', 5_000);
    const pid = Number(fs.readFileSync(join(unitDir, 'pid'), 'utf8').trim());
    expect(tierRow(pid, marker), 'the recorded pid is this case\'s tier').toBe(true);
    supervisor.kill('SIGTERM');
    await expectTierGone(pid, marker, 'the TERMed supervisor to reap its exact child', 8_000);
    expect(await exited).toBe(0);
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean)).toEqual(['TERM', 'WAIT:-15']);
    expect(fs.readFileSync(join(unitDir, 'stop-complete'), 'utf8')).toBe('complete\n');
  }, 60_000);

  it.skipIf(!PY)('L0a a launcher descheduled after it backgrounds the supervisor never overwrites the supervisor\'s active state and pid', async () => {
    const home = box('ccrc-codex-manager-launch-order-', { userManager: true });
    // Rereview Minor 3's model of a preempted launcher, applied to THIS HOME's
    // planted copy only: whatever the launcher still writes after the fork
    // lands a full second after the supervisor's own writes.
    const runner = join(home, '.local', 'bin', 'systemd-run');
    const anchor = 'supervisor="$!"\n';
    const src = fs.readFileSync(runner, 'utf8');
    expect(src.split(anchor), 'the planted systemd-run has one backgrounding point').toHaveLength(2);
    fs.writeFileSync(runner, src.replace(anchor, `${anchor}sleep 1\n`), { mode: 0o755 });
    const unit = 'launch-order.service';
    const unitDir = join(home, 'fake-systemd', 'units', unit);
    const marker = join(home, `tier-marker-${unit}`);
    const e = env(home);
    const sh = (cmd: string) => spawnSync(BASH, ['-c', cmd], { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // Returns only after the injected second, so the launcher has finished
    // every write it makes.
    const r = sh(`systemd-run --user --collect --quiet --unit=${unit} -- ${selfExpiringTier(marker)}`);
    expect(r.status, r.stderr).toBe(0);
    try {
      await eventually(() => fs.existsSync(join(unitDir, 'supervisor-ready')), 'the supervisor to start its tier', 5_000);
      expect(fs.readFileSync(join(unitDir, 'state'), 'utf8'), 'the launcher overwrote the supervisor\'s state').toBe('active\n');
      const pid = unitPid(home, unit);
      expect(pid, 'the launcher overwrote the supervisor\'s pid').not.toBeNull();
      expect(tierRow(pid!, marker), 'the recorded pid is this case\'s tier').toBe(true);
      expect(sh(`systemctl --user is-active ${unit}`).stdout.trim()).toBe('active');
      expect(sh(`systemctl --user show -p MainPID --value ${unit}`).stdout.trim()).toBe(String(pid));
    } finally {
      // A request through the manager's own channel, never a signal. It ends
      // the tier on the RED path too, where no pid was left to observe.
      sh(`systemctl --user stop ${unit}`);
    }
    expect(fs.readFileSync(join(unitDir, 'stop-complete'), 'utf8')).toBe('complete\n');
    expect(fs.readFileSync(join(unitDir, 'events'), 'utf8').split('\n').filter(Boolean)).toEqual(['TERM', 'WAIT:-15']);
  }, 60_000);

  it('L0a safety pins: fake systemctl has no signal vocabulary at all, and the safety report says what the fixture does', () => {
    const fixture = fs.readFileSync(join(here, 'codexLaneFixture.ts'), 'utf8');
    const from = fixture.indexOf('const FAKE_SYSTEMCTL');
    const to = fixture.indexOf('const FAKE_SYSTEMD_RUN');
    expect(from, 'the FAKE_SYSTEMCTL constant').toBeGreaterThan(0);
    expect(to, 'the FAKE_SYSTEMD_RUN constant after it').toBeGreaterThan(from);
    const control = fixture.slice(from, to);
    // Round 2 (rereview Minor 1): STRUCTURAL, never one spelling. No `kill`
    // token in any case or form (bare, numeric, `-s KILL`, `-SIGKILL`,
    // `/bin/kill`, `pkill`, `killall`, `os.kill`, `killpg`, `pthread_kill`)
    // and no `/proc` read, over the whole constant AND over the bytes
    // plantSystemd writes. The senders that spell no `kill` are scanned the
    // same way, in any case: `fuser` (whose `-k` signals every holder of a
    // file), and the Python `signal` module's other senders,
    // `pidfd_send_signal`, `raise_signal`, `alarm` and `setitimer`.
    // Fake systemctl's only stop is the request/completion channel.
    const home = box('ccrc-codex-manager-vocabulary-', { userManager: true });
    const planted = fs.readFileSync(join(home, '.local', 'bin', 'systemctl'), 'utf8');
    for (const [what, text] of [['FAKE_SYSTEMCTL', control], ['the planted systemctl', planted]] as const) {
      expect(text.match(/kill/gi) ?? [], `${what} carries signal vocabulary`).toEqual([]);
      expect(text.match(/\/proc\b/g) ?? [], `${what} reads /proc`).toEqual([]);
      expect(text.match(/fuser/gi) ?? [], `${what} names fuser`).toEqual([]);
      expect(text.match(/pidfd_send_signal|raise_signal|alarm|setitimer/gi) ?? [],
        `${what} names a Python signal-module sender`).toEqual([]);
      expect(text, what).toContain('valid_unit "$u"');
      expect(text, what).toContain('stop-request');
      expect(text, what).toContain('stop-complete');
    }
    const report = fs.readFileSync(join(REPO, '.superpowers', 'sdd', '2026-09-23-gpt-lane-ownership-2b2-the-lane-runs', 'final-reaper-safety-report.md'), 'utf8');
    const prose = report.replace(/\s+/g, ' ');
    expect(report).not.toContain('final-reaper-ownership-correction-report.md');
    // Rereview F2b: the reparented-tier sentence ITSELF, not any mention of a
    // Python supervisor (the manager paragraph names one too).
    expect(prose).toContain('A reparented fake LiteLLM tier is owned through a directly held Python supervisor');
    expect(prose).not.toMatch(/shell supervisor/i);
    // Rereview observation: `active` is written before any wait.
    expect(prose).not.toContain('writes its state only after waiting');
  });

  // The stand-in LiteLLM started DIRECTLY (ruling R29), and a lane config
  // planted by the real renderer (ruling R20): what Tasks 8, 10 and 11 lean on.
  // Both branches have current-run ChildProcess ownership: direct tiers by
  // their handle and reparented tiers by their Python supervisor.
  const assertFakeLitellm = async (reparent: boolean): Promise<void> => {
    const home = box('ccrc-codex-fake-litellm-');
    const [port] = await freePorts(1);
    const config = plantLaneConfig(home, 'codex-a');
    expect(config).toBe(litellmYaml(home, 'codex-a'));
    expect(fs.statSync(config).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(config, 'utf8')).toContain('master_key: os.environ/LITELLM_MASTER_KEY');
    await expect(spawnFakeLitellm(home, { port: port!, config: join(home, 'absent.yaml'), reparent }))
      .rejects.toThrow(/is not a file/);
    const pid = await spawnFakeLitellm(home, { port: port!, config, reparent });
    expect(await portAccepts(port!)).toBe(true);
    // `_codex_pid_is_tier` proves a LiteLLM by `--config <this lane's litellm.yaml>`, two words.
    expect(lib(home, `_codex_pid_is_tier codex-a litellm ${pid}; echo "rc=$?"`).stdout).toBe('rc=0\n');
    expect(litellmEvidence(home, port!)?.['pid']).toBe(pid);
    await killLaneProcesses(home);
    if (reparent) await eventually(() => !alive(pid), 'the stand-in to exit');
    expect(await portAccepts(port!)).toBe(false);
  };

  it('L0b the instrument: spawnFakeLitellm (direct child) runs the stand-in with a lane tier\'s command line on the port it is given, refuses a config that is no file, and the afterEach cleanup ends it', async () => {
    await assertFakeLitellm(false);
  }, 60_000);

  it('L0b the instrument: spawnFakeLitellm (supervised) runs the stand-in with a lane tier\'s command line on the port it is given, refuses a config that is no file, and the afterEach cleanup ends it', async () => {
    await assertFakeLitellm(true);
  }, 60_000);

  it('L0c fixture cleanup owns a supervised stand-in through its current-run handle', async () => {
    const home = box('ccrc-codex-supervisor-owner-');
    const [port] = await freePorts(1);
    const pid = await spawnFakeLitellm(home, {
      port: port!, config: plantLaneConfig(home, 'codex-a'), reparent: true,
    });
    await killLaneProcesses(home);
    await eventually(() => !alive(pid), 'the current-run supervisor to reap its tier');
    expect(await portAccepts(port!)).toBe(false);
  }, 60_000);

  it('L0c1 a TERM-responsive supervised tier records TERM then WAIT, is reaped, and closes its port before cleanup resolves', async () => {
    const home = box('ccrc-codex-supervisor-responsive-');
    const [port] = await freePorts(1);
    const pid = await spawnFakeLitellm(home, {
      port: port!, config: plantLaneConfig(home, 'codex-a'), reparent: true,
    });
    await killLaneProcesses(home);
    expect(litellmTeardownEvents(home, port!)).toEqual(['TERM', 'WAIT:-15']);
    expect(alive(pid), 'the supervisor returned before its direct tier exited').toBe(false);
    expect(psArgs(pid), 'the supervisor did not reap its direct tier').toBe('');
    expect(await portAccepts(port!), 'the reaped tier kept its fixture port').toBe(false);
  }, 30_000);

  it('L0c2 a TERM-resistant supervised tier is killed, reaped, and closes its port before cleanup resolves', async () => {
    const home = box('ccrc-codex-supervisor-resistant-');
    const [port] = await freePorts(1);
    // The self-expiry is only the broken-path safety net. Fixed teardown KILLs
    // and reaps materially earlier, without signaling this observed PID.
    resistLitellmTerm(home, 12);
    const pid = await spawnFakeLitellm(home, {
      port: port!, config: plantLaneConfig(home, 'codex-a'), reparent: true,
    });
    const started = Date.now();
    try {
      await killLaneProcesses(home);
      expect(litellmTeardownEvents(home, port!)).toEqual(['TERM', 'TIMEOUT', 'KILL', 'WAIT:-9']);
      expect(Date.now() - started, 'cleanup waited for the fake self-expiry').toBeLessThan(9_000);
      expect(alive(pid), 'the supervisor returned before its direct tier exited').toBe(false);
      expect(psArgs(pid), 'the supervisor did not reap its direct tier').toBe('');
      expect(await portAccepts(port!), 'the reaped tier kept its fixture port').toBe(false);
    } catch (error) {
      // Broken RED/mutation paths may leave the tier until its finite expiry.
      await eventually(() => !alive(pid), 'the TERM-resistant fake to self-expire', 15_000);
      throw error;
    }
  }, 30_000);

  it('L0d a product stop reaps its supervised direct fixture tier while this Node process is blocked in spawnSync', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const pid = await spawnFakeLitellm(home, {
      port: a.litellmPort, config: litellmYaml(home, 'codex-a'), reparent: true,
    });
    writeFileSync(join(d, 'litellm.pid'), `${pid}\n`, { mode: 0o600 });
    // `codex` blocks this event loop in spawnSync. The supervisor, a direct
    // child of this run, must wait/reap the tier without Node running events.
    const stopped = codex(home, ['stop', 'codex-a']);
    expect(stopped.code, stopped.stderr).toBe(0);
    await eventually(() => !alive(pid), 'the product-stopped supervised tier to be reaped');
    expect(psArgs(pid), 'a reaped tier has no remaining process-table row').toBe('');
    expect(await portAccepts(a.litellmPort)).toBe(false);
  }, 60_000);

  // Linux only: the product stop is measured through the fake `systemctl`'s
  // `--user stop` record, and on macOS ccrc's manager is launchctl, so that
  // record stays empty there (PR #240's test-macos 2/2), as L16's does.
  itLinux('L0e fixture cleanup calls the real product stop before direct handles', async () => {
    const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const started = codex(home, ['start', 'codex-a']);
    expect(started.code, started.stderr).toBe(0);
    await killLaneProcesses(home);
    expect(stopCalls(home).join('\n')).toMatch(/ccgpt-codex-a-(litellm|shim)\.service/);
    expect(await portAccepts(a.proxyPort)).toBe(false);
    expect(await portAccepts(a.litellmPort)).toBe(false);
  }, 60_000);

  // ── the verb's surface: role, usage, refusals ──────────────────────────────
  // `login` too (ruling R18): the gate runs before any subcommand is dispatched,
  // so it answers here although `_codex_login` is Task 8's.
  it.each(['start', 'stop', 'status', 'login'])('L1 %s refuses on a server-role box, before it reads or locks anything', async (sub) => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    fs.writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const r = codex(home, [sub, 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: server-role: .*CCRC_ROLE=server/m);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const f of ['runtime.env', '.lock']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), f).toBe(false);
  }, 60_000);

  const USAGE: Array<[string[], RegExp]> = [
    [[], /needs a subcommand/],
    [['wat', 'codex-a'], /no subcommand "wat"/],
    [['start'], /needs a lane id/],
    // `login` is a subcommand of this verb (ruling R18), so its missing id is
    // the id parse's refusal, not `no subcommand "login"`.
    [['login'], /needs a lane id/],
    [['start', 'codex-a', 'extra'], /got "extra"/],
    [['status', 'codex-a', '--yaml'], /got "--yaml"/],
  ];
  it.each(USAGE)('L2 a usage error is exit 2 (ruling R3), one line, before any lane is read: %j', (args, why) => {
    const home = box('ccrc-codex-usage-');   // no roster at all: usage is decided before one is read
    const r = codex(home, args);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
    expect(r.stderr).toMatch(why);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stdout).toBe('');
  });

  // `mintsKey`: not-logged-in and runtime-absent refuse BEFORE the gateway key is
  // generated; a lane that cannot run gets no key.
  const REFUSALS: Array<[string, (h: string) => void, RegExp, boolean]> = [
    // Codex-bridge Stage 1, Task 8: read through the auth library, whose word
    // the sentence names; existence is no longer all ccrc checks.
    ['not-logged-in', (h) => fs.rmSync(join(h, codexAuthDir('codex-a'), 'auth.json')),
      /is not signed in: the auth library reads its credential in ~\/\S+ as absent\. Sign the lane in with 'ccrc codex login codex-a'/, false],
    ['runtime-absent', (h) => fs.rmSync(join(h, '.ccrc', 'runtime', 'codex', 'current')), /ccgpt-runtime build/, false],
    // Ruling R4: this task renders nothing. Task 6's `_codex_litellm_ensure`
    // replaces this refusal with the render call, and moves this row.
    ['litellm-unrendered', (h) => fs.rmSync(litellmYaml(h, 'codex-a')), /ccrc models litellm codex-a/, true],
  ];
  it.each(REFUSALS)('L3 %s: refused by name, with its remedy, and nothing starts', async (code, spoil, remedy, mintsKey) => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    spoil(home);
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: ${code}: `, 'm'));
    expect(r.stderr).toMatch(remedy);
    expect(r.stdout).toBe('');
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    expect(litellmEvidence(home, lanes['codex-a']!.litellmPort)).toBeNull();
    expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'runtime.env'))).toBe(mintsKey);
  }, 60_000);

  // ── the credential, read through the auth library (codex-bridge Stage 1, Task 8) ─
  // `start` reads `_codex_auth_status` before the lane lock: a lane whose
  // credential cannot serve is refused with nothing locked, minted or started.
  // Each status the cases read is the library's own (`refusedRefresh`), and
  // every library `start` runs is under this file's CLOSED_AUTH_BASE default,
  // where a token request is refused at once.
  /** `ccrc codex start codex-a`, refused as `code` with `remedy` before the
   *  lane lock: no `.lock`, no gateway key, no pidfile, no spawn. `end` is how
   *  the line ends: start's own refusals say "Nothing was started.", and the
   *  shared helpers' (`_codex_auth`, `_codex_auth_status`) say "then re-run.".
   *  `extra` is the run's own env. */
  function refusedBeforeLock(home: string, code: string, remedy: RegExp,
    o: { end?: RegExp; extra?: NodeJS.ProcessEnv } = {}): string {
    const d = laneDir(home, 'codex-a');
    const r = codex(home, ['start', 'codex-a'], o.extra);
    expect(r.code, r.stderr).toBe(1);
    const line = r.stderr.split('\n').find((l) => l.startsWith(`ccrc codex: ${code}: `));
    expect(line, r.stderr).toBeDefined();
    expect(line).toMatch(remedy);
    expect(line).toMatch(o.end ?? /Nothing was started\.$/);
    expect(r.stdout).toBe('');
    expect(fs.existsSync(join(d, '.lock')), `${code}: the lane lock was taken`).toBe(false);
    expect(fs.existsSync(join(d, 'runtime.env')), `${code}: a gateway key was minted`).toBe(false);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(d, `${t}.pid`)), t).toBe(false);
    expect(systemdRunCalls(home)).toEqual([]);
    return line!;
  }

  it('start refuses needs-signin and credential-unusable before the lane lock, and starts an expired token', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const dir = join(home, lanes['codex-a']!.authDir);
    const cred = join(dir, 'auth.json');
    await refusedRefresh(home, dir, { status: 400, body: { error: 'invalid_grant' } }, 'needs-signin');
    expect(refusedBeforeLock(home, 'needs-signin', /'ccrc codex login codex-a'/)).toContain('needs-signin');
    // A credential that does not parse reads `unreadable`: never started on, and the doctor names it.
    fs.writeFileSync(cred, '{"access_token": ', { mode: 0o600 });
    expect(refusedBeforeLock(home, 'credential-unusable', /'ccrc doctor'/)).toContain(' as unreadable');
    // An expired present credential STARTS: in litellm mode the tier refreshes on its next request, and start
    // itself never refreshes, so the file is the one planted.
    plantBackendCredential(dir, { expiresIn: -120 });
    const before = sha256(cred);
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^ccrc codex: codex-a: litellm started \(.*\), shim started \(/m);
    expect(sha256(cred), 'start rewrote the credential').toBe(before);
  }, 60_000);

  it('start refuses a foreign-family credential: credential-unusable, the file untouched', async () => {
    // Review Focus 2: the Codex CLI's own auth.json, and its API-key form.
    const shapes: Array<[string, object]> = [
      ['the Codex CLI\'s own', {
        OPENAI_API_KEY: null,
        tokens: { id_token: syntheticJwt({ sub: 'fixture' }), access_token: syntheticJwt({ sub: 'fixture' }),
          refresh_token: 'rtok-fixture-cli', account_id: null },
        last_refresh: '2026-01-01T00:00:00Z',
      }],
      ['its API-key form', { OPENAI_API_KEY: 'fixture-key-not-a-secret', tokens: null }],
    ];
    for (const [label, body] of shapes) {
      const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
      const dir = join(home, lanes['codex-a']!.authDir);
      const cred = join(dir, 'auth.json');
      fs.writeFileSync(cred, JSON.stringify(body), { mode: 0o600 });
      const st = fs.statSync(cred, { bigint: true });
      const bytes = sha256(cred);
      const listing = fs.readdirSync(dir).sort();
      const line = refusedBeforeLock(home, 'credential-unusable', /'ccrc doctor'/);
      expect(line, label).toContain(' as foreign-family');
      const after = fs.statSync(cred, { bigint: true });
      expect([sha256(cred), after.ino, after.mtimeNs], `${label}: the credential was touched`)
        .toEqual([bytes, st.ino, st.mtimeNs]);
      expect(fs.readdirSync(dir).sort(), `${label}: something was written beside the credential`).toEqual(listing);
    }
  }, 60_000);

  it('start names ccrc update then ccrc codex login for config-error', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const dir = join(home, lanes['codex-a']!.authDir);
    await refusedRefresh(home, dir, { status: 401, body: { error: 'invalid_client' } }, 'config-error');
    const line = refusedBeforeLock(home, 'credential-unusable', /config-error/);
    const update = line.indexOf("'ccrc update'");
    expect(update, line).toBeGreaterThan(-1);
    expect(line.indexOf("'ccrc codex login codex-a'"), line).toBeGreaterThan(update);
    expect(line, 'a config-error is not the doctor\'s to cure').not.toContain('ccrc doctor');
  }, 60_000);

  // Review fix round 1 (T8-SPEC-1, T8-CQ-1): the refusals the Interfaces name
  // that no case reached — `incomplete`, `auth-library-absent` from start
  // itself, and `auth-status-unreadable` in each shape `_codex_auth_status`
  // refuses, plus the unknown-credential-word arm.
  it('start refuses an incomplete credential (an abandoned sign-in) as not-logged-in, with the login remedy', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const cred = join(home, lanes['codex-a']!.authDir, 'auth.json');
    fs.writeFileSync(cred, JSON.stringify({ device_code_requested_at: Math.floor(Date.now() / 1000) - 60 }),
      { mode: 0o600 });
    const line = refusedBeforeLock(home, 'not-logged-in', /'ccrc codex login codex-a'/);
    expect(line).toContain(' as incomplete. ');
    expect(line).not.toContain('ccrc update');
  }, 60_000);

  it('start with no auth library, or no python3, refuses auth-library-absent before the lane lock', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const PATH = pathWithout(home, 'python3');
    const py = refusedBeforeLock(home, 'auth-library-absent', /python3 is not on PATH/,
      { end: /then re-run\.$/, extra: { PATH } });
    expect(py).toContain(authLib(home));
    fs.rmSync(authLib(home));
    const lib = refusedBeforeLock(home, 'auth-library-absent', /'ccrc update'/, { end: /then re-run\.$/ });
    expect(lib).toContain(`${authLib(home)} is not a readable file`);
  }, 60_000);

  // A stand-in at the library's path, run as `python3 -IS <lib> status …`:
  // each prints `out` (when given) and exits `rc`. `status --json` reports
  // `auth: null` for every one of them, and start refuses each before the lock.
  const STANDINS: Array<[string, string | null, number]> = [
    ['no answer, exit 1', null, 1],
    ['not JSON', 'not json', 0],
    ['an array', '[]', 0],
    ['an object with no credential', '{"state": "ok"}', 0],
    ['a whole object, then exit 1', '{"credential": "present", "state": "ok"}', 1],
    // Review fix round 2 (T8-FR1-CQ-1): the one-answer guard and the state's type test.
    // jq prints one `<credential> <state>` line per object, so two objects carry a
    // newline AND a second space; a newline inside one word carries the newline alone.
    ['two objects', '{"credential": "present", "state": "ok"}\n{"credential": "absent", "state": null}', 0],
    ['a credential word with a space', '{"credential": "pres ent", "state": "ok"}', 0],
    ['a state with a newline in it', '{"credential": "present", "state": "o\\nk"}', 0],
    ['a state that is not a string', '{"credential": "present", "state": 5}', 0],
  ];
  const plantStandin = (home: string, out: string | null, rc: number): void => {
    fs.rmSync(authLib(home), { force: true });
    fs.writeFileSync(authLib(home),
      `import sys\n${out === null ? '' : `sys.stdout.write(${JSON.stringify(out + '\n')})\n`}sys.exit(${rc})\n`,
      { mode: 0o755 });
  };
  const statusAuth = (home: string): unknown => {
    const r = codex(home, ['status', 'codex-a', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr, 'status --json named a refusal').toBe('');
    return (JSON.parse(r.stdout) as Record<string, unknown>)['auth'];
  };

  // Review fix round 3 (T8-FR2-CQ-1): one titled case per stand-in, so a mutant that
  // lets one through names it in the suite's output and hides none of the rows after it.
  it.each(STANDINS)('start refuses auth-status-unreadable for an answer the library\'s status cannot be read from, and status says auth: null: %s', async (label, out, rc) => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    plantStandin(home, out, rc);
    const line = refusedBeforeLock(home, 'auth-status-unreadable', /'ccrc update'/, { end: /then re-run\.$/ });
    expect(line, label).toContain(`the auth library answered no status ccrc can read for codex-a (it exited ${rc})`);
    expect(statusAuth(home), label).toBeNull();
  }, 60_000);

  it('start refuses a credential word the library does not define as auth-status-unreadable, naming the word', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    plantStandin(home, '{"credential": "brand-new-word", "state": "ok"}', 0);
    const line = refusedBeforeLock(home, 'auth-status-unreadable', /'ccrc update'/);
    expect(line).toContain('"brand-new-word", a word this ccrc does not know');
  }, 60_000);

  it('status --json carries auth.state, auth.credential and auth.authBase', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const dir = join(home, lanes['codex-a']!.authDir);
    const auth = (): Record<string, unknown> | null => {
      const r = codex(home, ['status', 'codex-a', '--json']);
      expect(r.code, r.stderr).toBe(0);
      return (JSON.parse(r.stdout) as Record<string, unknown>)['auth'] as Record<string, unknown> | null;
    };
    const ok = auth();
    // The library's status report, minus the file's mode and owner (the doctor's to read).
    expect(Object.keys(ok ?? {}).sort()).toEqual([
      'authBase', 'credential', 'expiresAt', 'family', 'lastErrorCode', 'lastRefreshAt', 'lastRequestId', 'modeOk',
      'source', 'state', 'unsaved', 'updatedAt',
    ]);
    // `override`: this file's env() keeps the loopback CCRC_CODEX_AUTH_BASE ghContainedEnv sets.
    expect(ok).toMatchObject({ credential: 'present', state: 'ok', source: 'computed', authBase: 'override' });
    await refusedRefresh(home, dir, { status: 400, body: { error: 'invalid_grant' } }, 'needs-signin');
    expect(auth()).toMatchObject({ credential: 'present', state: 'needs-signin', source: 'file' });
    fs.rmSync(join(dir, 'auth.json'));
    expect(auth()).toMatchObject({ credential: 'absent', state: null });
    // No library: status still answers, exit 0, with no auth to report.
    fs.rmSync(authLib(home));
    expect(auth()).toBeNull();
  }, 60_000);

  // Ruling R3: `_codex_row`'s rc 2 for a malformed id reaches the exit status;
  // every other refusal is 1.
  it.each([['claude', 'not-codex', 1], ['nobody', 'not-rostered', 1], ['Codex_A', 'usage', 2]] as const)(
    'L4 start %s answers %s, exit %i, through the verb', async (id, code, exit) => {
      const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
      const r = codex(home, ['start', id]);
      expect(r.code).toBe(exit);
      expect(r.stderr).toMatch(new RegExp(`^ccrc codex: ${code}: `, 'm'));
      expect(systemdRunCalls(home)).toEqual([]);
    }, 60_000);

  // ── identity: never adopt, never stop what cannot be identified ────────────
  it.each(['shim', 'litellm'] as const)('L5 a foreign listener on the %s port is refused by start and left running by stop, named both times (D-3488)', async (tier) => {
    // Linux runs the unit arm here, so "no systemd-run call" means something; the
    // macOS arm is always nohup, where the pidfiles say the same thing.
    const { home, lanes } = await lifeBox({ userManager: !IS_DARWIN, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const port = tier === 'shim' ? a.proxyPort : a.litellmPort;
    // The other repository's shim shape — text/plain, the bare id — with the SAME id.
    const other = await spawnListener(home, { answer: 'text', lane: 'codex-a', port });
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${port} `, 'm'));
    expect(r.stderr).toMatch(/Nothing was started/);
    // NOTHING started, not even the tier whose port was free…
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    // …and the listener is untouched.
    expect(await portAccepts(port)).toBe(true);
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe(tier === 'shim'
      // The bridge serves on the shim's port (codex-bridge Stage 2), so the
      // listener there is foreign to it too.
      ? 'ccrc codex: codex-a: litellm not running, shim foreign, bridge foreign\n'
      : 'ccrc codex: codex-a: litellm foreign, shim not running, bridge not running\n');
    expect(s.stderr).toContain(`port ${port} (codex-a's ${tier} tier) is held by a listener that is not this lane's`);
    expect(s.stderr).toMatch(/ccrc left it running\.$/m);
    expect(stopCalls(home)).toEqual([]);
    expect(await portAccepts(port)).toBe(true);
    expect(psArgs(other.pid)).toContain('listener.py');
  }, 60_000);

  it('L6 status --json is ONE object in the contract shape, and reads lane.json without writing it', async () => {
    const { home, lanes, rt } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const gen = path.basename(rt.gen);
    const status = (): Record<string, unknown> => {
      const r = codex(home, ['status', 'codex-a', '--json']);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout.split('\n'), 'one line and its newline').toHaveLength(2);
      return JSON.parse(r.stdout) as Record<string, unknown>;
    };
    const stopped = { state: 'stopped', via: null, pid: null };
    expect(status()).toEqual({
      id: 'codex-a', mode: 'litellm', upstream: 'backend', tiers: { litellm: stopped, shim: stopped, bridge: stopped },
      runtime: { generation: gen }, lane: { json: 'current' },
      auth: expect.objectContaining({ credential: 'present', state: 'ok' }), bridge: null,
    });
    const lj = join(laneDir(home, 'codex-a'), 'lane.json');
    const good = fs.readFileSync(lj, 'utf8');
    fs.writeFileSync(lj, JSON.stringify({ ...JSON.parse(good), proxyPort: 1 }));
    expect(status()['lane']).toEqual({ json: 'stale' });
    expect(JSON.parse(fs.readFileSync(lj, 'utf8'))['proxyPort'], 'status re-rendered lane.json').toBe(1);
    fs.rmSync(lj);
    expect(status()['lane']).toEqual({ json: 'absent' });
    expect(fs.existsSync(lj), 'status wrote lane.json').toBe(false);
    fs.writeFileSync(lj, good);
    await spawnListener(home, { answer: 'text', lane: 'codex-a', port: a.proxyPort });
    expect((status()['tiers'] as Record<string, unknown>)['shim']).toEqual({ state: 'foreign', via: null, pid: null });
    const h = codex(home, ['status', 'codex-a']);
    expect(h.code).toBe(0);
    expect(h.stdout).toBe([
      'ccrc codex: codex-a: litellm stopped',
      // Review A2: named in `_codex_foreign_what`'s words, never a sentence
      // of status's own.
      `ccrc codex: codex-a: shim FOREIGN — port ${a.proxyPort} (codex-a's shim tier) is held by a listener that is not this lane's: its identity check failed. `
        + `Stop whatever holds port ${a.proxyPort}, or give codex-a other ports in ~/.ccrc/accounts.json. ccrc will neither adopt nor stop it.`,
      // The bridge serves on the shim's port (codex-bridge Stage 2), so the listener there is foreign to it too.
      `ccrc codex: codex-a: bridge FOREIGN — port ${a.proxyPort} (codex-a's bridge tier) is held by a listener that is not this lane's: its identity check failed. `
        + `Stop whatever holds port ${a.proxyPort}, or give codex-a other ports in ~/.ccrc/accounts.json. ccrc will neither adopt nor stop it.`,
      `ccrc codex: codex-a: runtime ${gen}; lane.json current`,
      '',
    ].join('\n'));
    fs.rmSync(join(home, '.ccrc', 'runtime', 'codex', 'current'));
    expect(status()['runtime']).toEqual({ generation: null });
  }, 60_000);

  // ── the nohup arm: a box with no user manager (and every macOS box) ────────
  it('L7 with no user manager the nohup arm runs both tiers — the REAL shim carrying its --ccrc-lane marker — records their pids, adopts them again, and stops them', async () => {
    const { home, lanes, shimFile } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const m = /^ccrc codex: codex-a: litellm started \(nohup (\d+)\), shim started \(nohup (\d+)\)\n$/.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    const lit = Number(m![1]);
    const shim = Number(m![2]);
    expect(Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'))).toBe(lit);
    expect(Number(fs.readFileSync(join(d, 'shim.pid'), 'utf8'))).toBe(shim);
    expect(alive(lit) && alive(shim)).toBe(true);
    expect(systemdRunCalls(home), 'a manager was asked to run something').toEqual([]);
    const logs = logDir(home, 'codex-a');
    expect(fs.readFileSync(join(logs, 'litellm.log'), 'utf8')).toMatch(/fixture litellm: listening on/);
    expect(fs.existsSync(join(logs, 'shim.log'))).toBe(true);
    // The key reached LiteLLM from runtime.env, and the recorded pid IS the tier.
    const ev = litellmEvidence(home, a.litellmPort)!;
    expect([ev['masterKeyShaped'], ev['pid']]).toEqual([true, lit]);
    // Ruling R6: the shim that runs IS the shipped file, started with ccrc's
    // lane marker as a whole word after it, and the marker is inert to it: it
    // binds and answers `/ccgpt/lane` as this lane.
    expect(sha256(shimFile)).toBe(sha256(join(REPO, 'ccd', 'ccgpt-proxy.py')));
    expect(` ${psArgs(shim).trim()} `).toContain(` ${shimFile} --ccrc-lane=codex-a `);
    const lane = await laneAnswer(a.proxyPort);
    expect(lane?.status).toBe(200);
    expect(lane?.type).toMatch(/^application\/json/);
    expect(JSON.parse(lane!.body)).toEqual({ lane: 'codex-a' });
    const st = codex(home, ['status', 'codex-a', '--json']);
    expect((JSON.parse(st.stdout) as { tiers: unknown }).tiers).toEqual({
      litellm: { state: 'running', via: 'nohup', pid: lit }, shim: { state: 'running', via: 'nohup', pid: shim },
      bridge: { state: 'stopped', via: null, pid: null },
    });
    const again = codex(home, ['start', 'codex-a']);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toBe(`ccrc codex: codex-a: litellm adopted (nohup ${lit}), shim adopted (nohup ${shim})\n`);
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped, bridge not running\n');
    await eventually(() => !alive(lit) && !alive(shim), 'both nohup tiers to exit');
    for (const f of ['litellm.pid', 'shim.pid', 'litellm.started', 'shim.started']) {
      expect(fs.existsSync(join(d, f)), f).toBe(false);
    }
    expect(fs.existsSync(join(home, 'curl-poison')), 'the lane verb reached curl').toBe(false);
  }, 120_000);

  it('L8 a pidfile naming another lane\'s live tier is STALE, not foreign: status reads stopped, stop signals nothing and removes it, and start replaces it without signalling its pid (ruling R34)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false });
    const a = lanes['codex-a']!;
    const b = lanes['codex-b']!;
    expect(codex(home, ['start', 'codex-b']).code).toBe(0);
    const bd = laneDir(home, 'codex-b');
    const bl = Number(fs.readFileSync(join(bd, 'litellm.pid'), 'utf8'));
    const bs = Number(fs.readFileSync(join(bd, 'shim.pid'), 'utf8'));
    // codex-a's pidfiles name codex-b's LIVE tiers: pid reuse, or a hand edit.
    // Their command lines carry codex-b's --config and --ccrc-lane=codex-b, so
    // they prove nothing of codex-a's, and nothing answers on codex-a's ports:
    // `_codex_tier_ours` reads past both files and answers 1, not running.
    const ad = laneDir(home, 'codex-a');
    const plantStale = (): void => {
      fs.writeFileSync(join(ad, 'litellm.pid'), `${bl}\n`);
      fs.writeFileSync(join(ad, 'shim.pid'), `${bs}\n`);
    };
    const bStillUp = async (): Promise<void> => {
      expect(alive(bl) && alive(bs), "codex-b's tiers").toBe(true);
      expect(JSON.parse((await laneAnswer(b.proxyPort))!.body)).toEqual({ lane: 'codex-b' });
      expect(await portAccepts(b.litellmPort)).toBe(true);
      expect(fs.existsSync(join(bd, 'shim.pid'))).toBe(true);
    };
    plantStale();
    const st = JSON.parse(codex(home, ['status', 'codex-a', '--json']).stdout) as { tiers: Record<string, { state: string }> };
    expect([st.tiers['litellm']!.state, st.tiers['shim']!.state]).toEqual(['stopped', 'stopped']);
    // stop: nothing of codex-a's runs, nothing is foreign, and the stale files go.
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm not running, shim not running, bridge not running\n');
    expect(s.stderr).toBe('');
    expect(fs.existsSync(join(ad, 'litellm.pid')) || fs.existsSync(join(ad, 'shim.pid')), 'stale pidfiles kept').toBe(false);
    await bStillUp();
    // start: this lane's own tiers, under their own pids, and codex-b's untouched.
    plantStale();
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const m = /^ccrc codex: codex-a: litellm started \(nohup (\d+)\), shim started \(nohup (\d+)\)\n$/.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    expect([Number(fs.readFileSync(join(ad, 'litellm.pid'), 'utf8')), Number(fs.readFileSync(join(ad, 'shim.pid'), 'utf8'))])
      .toEqual([Number(m![1]), Number(m![2])]);
    expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-a' });
    await bStillUp();
    // The nohup arm is Darwin's production arm. Stop both tiers directly while
    // this successful test still owns the product command, rather than asking
    // afterEach to reconstruct authority from their evidence PIDs.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
    expect(codex(home, ['stop', 'codex-b']).code).toBe(0);
  }, 120_000);

  it('L9 a tier that never answers is tier-not-ready, naming its log, inside the bounded wait', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    refuseLitellmStart(home);
    const t0 = Date.now();
    const r = codex(home, ['start', 'codex-a'], { CCRC_CODEX_READY_S: '3' });
    expect(r.code).toBe(1);
    const log = join(logDir(home, 'codex-a'), 'litellm.log');
    expect(r.stderr).toMatch(/^ccrc codex: tier-not-ready: codex-a's litellm tier did not answer as this lane within 3s/m);
    expect(r.stderr).toContain(log);
    expect(fs.readFileSync(log, 'utf8')).toMatch(/fixture litellm: refusing to start/);
    expect(Date.now() - t0).toBeLessThan(30_000);
    // LiteLLM exited before the failed start returned, but the shim has a
    // product pidfile. Stop it before a successful Darwin test returns.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  itLinux('L16 a tier whose proven handle lives while its port is silent is ours, starting: status says so, start waits on it and never starts over it, and stop stops it (ruling R7)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    // Mint the gateway key FIRST. A start that creates or replaces runtime.env
    // restarts a 0 or 4 LiteLLM (ruling R21, L20's subject), so without this
    // line the start below would stop the planted tier and start its own. The
    // case would then test R21's restart, not R7's adopt-and-wait.
    expect(lib(home, '_codex_runtime_env_ensure codex-a').code).toBe(0);
    // A LiteLLM still importing: its command line is this lane's, and it binds
    // nothing yet. Linux-only because this deliberately reparented product
    // shape is under test; its explicit product stop remains the cleanup path.
    const plant = spawnSync(BASH, ['-c',
      'nohup "$0" -B -c "import time; time.sleep(600)" --config "$1" </dev/null >/dev/null 2>&1 & echo $!',
      PY!, litellmYaml(home, 'codex-a')], { encoding: 'utf8' });
    const pid = Number(plant.stdout.trim());
    expect(pid > 1, plant.stderr).toBe(true);
    fs.writeFileSync(join(d, 'litellm.pid'), `${pid}\n`);
    await eventually(() => psArgs(pid).includes(`--config ${litellmYaml(home, 'codex-a')}`), 'the planted tier to exec');
    const st = codex(home, ['status', 'codex-a', '--json']);
    expect((JSON.parse(st.stdout) as { tiers: Record<string, unknown> }).tiers['litellm'])
      .toEqual({ state: 'starting', via: 'nohup', pid });
    expect(codex(home, ['status', 'codex-a']).stdout)
      .toMatch(new RegExp(`^ccrc codex: codex-a: litellm starting \\(nohup, pid ${pid}\\)`, 'm'));
    const r = codex(home, ['start', 'codex-a'], { CCRC_CODEX_READY_S: '3' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: tier-not-ready: codex-a's litellm tier did not answer as this lane within 3s/m);
    // It WAITED on the starting tier: no LiteLLM was started over it.
    expect(litellmEvidence(home, a.litellmPort)).toBeNull();
    expect(Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'))).toBe(pid);
    expect(alive(pid)).toBe(true);
    // Every stop stops a 4 (ruling R8): it is this lane's, by its command line.
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped, bridge not running\n');
    await eventually(() => !alive(pid), 'the starting tier to exit');
  }, 120_000);

  // Ruling R21: LiteLLM holds the key it was STARTED with, and the launcher
  // reads runtime.env on every session start. `restarts`: whether the file's
  // spoiling is a NEW key (`created`, `replaced`) or the same one (`rechmod`).
  const REKEY: Array<[string, (f: string) => void, boolean]> = [
    ['deleted', (f) => fs.rmSync(f), true],
    ['garbled', (f) => fs.writeFileSync(f, 'LITELLM_MASTER_KEY=not-a-key\n', { mode: 0o600 }), true],
    ['re-moded', (f) => fs.chmodSync(f, 0o644), false],
  ];
  it.each(REKEY)('L20 runtime.env %s under a running LiteLLM: a new key restarts that tier before readiness, the same key restarts nothing, and the shim is never restarted (ruling R21)', async (_what, spoil, restarts) => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const keyFile = join(d, 'runtime.env');
    const first = codex(home, ['start', 'codex-a']);
    expect(first.code, first.stderr).toBe(0);
    const lit = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    const shim = Number(fs.readFileSync(join(d, 'shim.pid'), 'utf8'));
    const before = fs.readFileSync(keyFile, 'utf8');
    spoil(keyFile);
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    // The file is whole again, 0600, and a NEW key exactly when one was minted.
    const after = fs.readFileSync(keyFile, 'utf8');
    expect(after).toMatch(/^LITELLM_MASTER_KEY=sk-[0-9a-f]{48}\n$/);
    expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(after === before, 'the key is the one LiteLLM started with').toBe(!restarts);
    const now = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    if (restarts) {
      expect(r.stdout).toBe(`ccrc codex: codex-a: litellm started (nohup ${now}), shim adopted (nohup ${shim})\n`);
      expect(now).not.toBe(lit);
      await eventually(() => !alive(lit), 'the old-key LiteLLM to exit');
    } else {
      expect(r.stdout).toBe(`ccrc codex: codex-a: litellm adopted (nohup ${lit}), shim adopted (nohup ${shim})\n`);
      expect(now).toBe(lit);
    }
    // The LiteLLM that answers is the one the pidfile names, started from this
    // runtime.env: a restarted one read the new file at its spawn.
    expect([litellmEvidence(home, a.litellmPort)!['pid'], litellmEvidence(home, a.litellmPort)!['masterKeyShaped']])
      .toEqual([now, true]);
    expect(alive(shim), 'the shim').toBe(true);
    expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-a' });
    // Product stop is a behavioral assertion; the current-run callback covers
    // failure paths before afterEach releases this fixture HOME.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 120_000);

  // Ruling R22: every lane read goes through jq, and lane.json's one writer runs
  // under node, so both are proven before any subcommand reads a lane. `login`
  // is the one exception (ruling PF-31, Plan 2b-2 Task 8): it never runs
  // models-op.mjs, so it is excluded from the node case below and pinned past
  // it, on its own, next.
  it.each(['jq', 'node'])('L21 with no %s on PATH every subcommand that needs it is missing-dependency, named, before any lane is read (ruling R22)', async (tool) => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const PATH = pathWithout(home, tool);
    const subs = tool === 'node' ? ['start', 'stop', 'status'] : ['start', 'stop', 'status', 'login'];
    for (const sub of subs) {
      const r = codex(home, [sub, 'codex-a'], { PATH });
      expect(r.code, `${sub}: ${r.stderr}`).toBe(1);
      expect(r.stderr).toMatch(new RegExp(`^ccrc codex: missing-dependency: ${tool} is not on PATH`));
      expect(r.stderr.trimEnd().split('\n'), sub).toHaveLength(1);
      expect(r.stdout).toBe('');
    }
    expect(systemdRunCalls(home)).toEqual([]);
    for (const f of ['runtime.env', '.lock']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), f).toBe(false);
  }, 60_000);

  // Ruling PF-31: the phone's sign-in must not die on a dependency it never
  // uses. `login` never runs models-op.mjs, and the pane that reaches it runs
  // under the tmux server's own PATH, which need not carry node.
  it('L21b login with no node on PATH gets past the dependency probe (ruling PF-31)', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const PATH = pathWithout(home, 'node');
    const r = codex(home, ['login', 'codex-a'], { PATH });
    // Past the probe: the lane library ran and reached the auth library
    // (codex-bridge Stage 1, Task 8), which reads the box's present
    // credential and answers already-signed-in with no request — never
    // `missing-dependency`.
    expect(r.stderr).not.toMatch(/missing-dependency/);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^ccgpt-auth: codex-a: already-signed-in: /m);
  }, 60_000);

  // Review fix round 1, findings spec-5/mut-5: the missing-dependency
  // SENTENCE, not just the probe, must be per-subcommand. Before this fix
  // the sentence was one hard-coded string ("'ccrc codex' needs both: jq …
  // and node runs …models-op.mjs …"), printed unconditionally, so a `login`
  // caller missing only jq (the one tool `login` ever checks, ruling PF-31)
  // was told it also needed node — the very dependency PF-31 exists to drop.
  it('L21c the missing-dependency sentence is built from what THIS subcommand checks, not a fixed "needs both"', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const PATH = pathWithout(home, 'jq');
    const loginR = codex(home, ['login', 'codex-a'], { PATH });
    expect(loginR.code).toBe(1);
    expect(loginR.stderr).toMatch(/^ccrc codex: missing-dependency: jq is not on PATH, and 'ccrc codex login' needs jq, which reads the lane's roster row\.\s/m);
    expect(loginR.stderr).not.toContain('needs both');
    expect(loginR.stderr).not.toContain('node');
    expect(loginR.stderr).not.toContain('models-op.mjs');
    // start/stop/status are UNCHANGED: still "needs both", still name node.
    for (const sub of ['start', 'stop', 'status']) {
      const r = codex(home, [sub, 'codex-a'], { PATH });
      expect(r.code, sub).toBe(1);
      expect(r.stderr, sub).toContain("'ccrc codex' needs both: jq reads every lane's roster row and lane.json, and node runs");
      expect(r.stderr, sub).toContain('models-op.mjs');
    }
  }, 60_000);

  // Ruling R45: LiteLLM runs as `-m`, and both arms start a tier in $HOME
  // (Task 2), so without `-I` the interpreter puts $HOME first on sys.path and
  // a `~/litellm/` shadows the generation the runtime's own `-I` probe proved.
  // The fake runtime cannot show that, because its tier arm execs the stand-in
  // and resolves no module. So this asks the REAL python3, with the flags ccrc
  // actually passed, and swaps only the module name, for one that exists
  // nowhere but this HOME. The swap is deliberate: under `-I`, a python3 with a
  // real litellm installed would import it, and no case runs real litellm.
  it('L23 the LiteLLM tier runs isolated: the interpreter flags start passes keep $HOME, its working directory, off sys.path, so a ~/litellm/ cannot shadow the generation (ruling R45)', async () => {
    const { home, rt } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const r = codex(home, ['start', 'codex-a']);
    // What the fake runtime python was asked, one `$*` line per call. The
    // interpreter flags are every word before `-m`, and they precede every path.
    const callsFile = join(rt.gen, 'python-calls');
    const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').split('\n') : [];
    const line = calls.find((l) => ` ${l} `.includes(' -m litellm.proxy.proxy_cli '));
    expect(line, `start ran no LiteLLM: ${r.stderr}`).toBeDefined();
    const words = line!.split(' ');
    const flags = words.slice(0, words.indexOf('-m'));
    fs.writeFileSync(join(home, 'ccrc_cwd_shadow_probe.py'), 'print("SHADOW-LOADED")\n');
    const probe = (f: string[]) => spawnSync(PY!, [...f, '-B', '-m', 'ccrc_cwd_shadow_probe'], {
      cwd: home, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home }, encoding: 'utf8',
    });
    // CONTROL: with no flags this interpreter DOES load the shadow from its
    // working directory, so a clean answer below is the flags' doing.
    expect(probe([]).stdout).toBe('SHADOW-LOADED\n');
    const iso = probe(flags);
    expect(iso.stdout, `the flags ${JSON.stringify(flags)} let a $HOME module shadow the generation's`).toBe('');
    expect(iso.stderr).toMatch(/No module named ccrc_cwd_shadow_probe/);
    // Asserted LAST, so a start without `-I` reds on the effect above, and not
    // only here: the fake runtime has no arm for a non-isolated `-m`, so that
    // start also ends `tier-not-ready`.
    expect(r.code, r.stderr).toBe(0);
    // This product stop is behavioral evidence; lifeBox registered the
    // current-run callback before this lane could start.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  // Ruling PF-15: "every refusal lands before anything is spawned" covers the
  // shim's own file. Without the pre-check, LiteLLM (the first tier) is
  // spawned and only the shim's start refuses, leaving a half-started lane.
  // Linux runs the unit arm here, so "no systemd-run call" means something;
  // the macOS arm is always nohup, where `litellm.pid` says the same thing.
  it('L24 a missing placed shim is shim-absent, with its remedy, before either tier is spawned (ruling PF-15)', async () => {
    const { home, lanes, shimFile } = await lifeBox({ userManager: !IS_DARWIN, ids: ['codex-a'] });
    fs.rmSync(shimFile);
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: shim-absent: /m);
    expect(r.stderr).toContain(shimFile);
    expect(r.stderr).toMatch(/'ccrc update' places it; re-run after\. Nothing was started\.$/m);
    expect(r.stderr).not.toMatch(/runtime-absent/);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    expect(litellmEvidence(home, lanes['codex-a']!.litellmPort)).toBeNull();
  }, 60_000);

  // Ruling PF-17 (spec §7.4): a listener in ccrc's OWN shim shape that answers
  // as ANOTHER lane is `listener-answers-other-lane`, the dated incident of one
  // lane attaching to another's gateway, and its sentence says exactly that.
  it('L25 a ccrc-shaped shim answering as another lane on this lane\'s proxy port is port-foreign, named as another lane, and nothing starts (ruling PF-17)', async () => {
    const { home, lanes } = await lifeBox({ userManager: !IS_DARWIN, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const other = await spawnListener(home, { answer: 'json', lane: 'codex-b', port: a.proxyPort });
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${a.proxyPort} \\(codex-a's shim tier\\) `
      + 'is held by a listener that is not this lane\'s: it answers as another lane\\. ', 'm'));
    expect(r.stderr).toMatch(/Nothing was started\.$/m);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    // …and the other lane's shim still answers as itself.
    expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-b' });
    expect(psArgs(other.pid)).toContain('listener.py');
  }, 60_000);

  // Ruling PF-19: the readiness bound falls back to 90 exactly as
  // `_codex_probe_secs` falls back for its own: on a value that is empty, not
  // all digits, five characters or longer (`$(( ))` could wrap it), or zero
  // in ANY spelling — `00` included, because GNU `timeout 00` means no
  // timeout at all (the controller's measurement on the probe bound). Leading
  // zeros are decimal padding.
  it('L26 _codex_ready_secs reads CCRC_CODEX_READY_S in whole seconds, and falls back to 90 on every zero spelling and on an over-long value (ruling PF-19)', () => {
    const home = box('ccrc-codex-ready-');
    const rows: Array<[string | null, string]> = [
      [null, '90'], ['', '90'], ['20', '20'], ['007', '7'], ['0008', '8'], ['9999', '9999'],
      ['0', '90'], ['00', '90'], ['0000', '90'], ['2x', '90'], ['-5', '90'], [' 20', '90'],
      ['99999', '90'], ['00007', '90'], ['99999999999999999999', '90'],
    ];
    for (const [v, want] of rows) {
      const r = lib(home, 'printf "[%s]" "$(_codex_ready_secs)"; _codex_ready_secs >/dev/null; echo " rc=$?"',
        v === null ? {} : { CCRC_CODEX_READY_S: v });
      expect(r.stdout, `CCRC_CODEX_READY_S=${JSON.stringify(v)}`).toBe(`[${want}] rc=0\n`);
    }
  });

  // Ruling PF-21: every consumer of `_codex_stop_tier` CAPTURES its word and
  // never folds `foreign` into stopped. `start`'s rekey restart (ruling R21)
  // is one: if the tier it measured as this lane's reads `foreign` at the stop
  // (something outside ccrc changed it under the lock), it refuses by name,
  // and starts no LiteLLM over the tier it left running. The word is planted
  // by a stub of `_codex_stop_tier`, because no fixture can hand the stop a
  // tier that is ours at one measurement and foreign at the next.
  it('L27 a rekey restart whose stop answers foreign is tier-foreign, and starts nothing over the tier it left running (ruling PF-21)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const first = codex(home, ['start', 'codex-a']);
    expect(first.code, first.stderr).toBe(0);
    const lit = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    fs.rmSync(join(d, 'runtime.env'));   // `created` on the next start: a rekey
    const r = lib(home, '_codex_stop_tier() { printf \'foreign\\n\'; }; cmd_codex start codex-a',
      { CCRC_CODEX_READY_S: '3' });
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: tier-foreign: codex-a's litellm tier .*ccrc left it running.*Nothing was started\.$/m);
    expect(r.stdout).toBe('');
    // No LiteLLM was started over it: the pidfile, and the one that answers, are the first start's.
    expect(Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'))).toBe(lit);
    expect(litellmEvidence(home, a.litellmPort)!['pid']).toBe(lit);
    expect(alive(lit)).toBe(true);
    // The stub only simulates the failed rekey stop. End the real nohup tier
    // through the product before successful Darwin test completion.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  // CLASS FIX (review round 2, N0) — the re-reviewer's own probe, reproduced
  // here: a REAL stop (never stubbed, unlike L27 above) answers `stopped`
  // and genuinely frees the port, and a REAL foreign process binds it
  // immediately afterward, before this rekey's restart. Before this fix the
  // measured outcome was a NEW LiteLLM started onto that port anyway
  // (`litellm.started` written, a new pid), with the readiness wait's own
  // `tier-not-ready` the only signal — naming no holder. `_codex_stop_tier`
  // itself is left untouched (unlike L27's stub): only what runs AFTER it
  // returns is engineered, via the `declare -f` rename idiom this suite
  // already uses (ccd-ws-add-child.test.ts).
  it('L35 a rekey restart whose REAL stop frees the port, and a current-run foreign helper binds it before the restart, refuses port-foreign — the code _codex_foreign_what gives — names the holder, and starts nothing (review round 2, N0)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    const first = codex(home, ['start', 'codex-a']);
    expect(first.code, first.stderr).toBe(0);
    const lit = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    fs.rmSync(join(d, 'runtime.env'));   // `created` on the next start: a rekey
    const trigger = join(home, 'foreign-trigger');
    const marker = join(home, 'foreign-bound');
    const foreignPy = join(home, 'foreign-holder.py');
    fs.writeFileSync(foreignPy, [
      'import os, socket, sys, time',
      'trigger, marker, port = sys.argv[1], sys.argv[2], int(sys.argv[3])',
      'while not os.path.exists(trigger): time.sleep(0.01)',
      's = socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
      's.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)',
      "s.bind(('127.0.0.1', port))",
      's.listen(1)',
      'open(marker, "w").write(str(os.getpid()))',
      'time.sleep(20)',
    ].join('\n') + '\n');
    const helper = spawn(PY!, [foreignPy, trigger, marker, String(a.litellmPort)], {
      cwd: home, env: { ...process.env, HOME: home }, stdio: 'ignore',
    });
    trackChild(home, helper);
    const script = [
      // Real `_codex_stop_tier`, renamed aside; the wrapper calls it for
      // real, then releases the directly owned helper. The bind follows the
      // real stop return without converting a persisted PID into authority.
      "eval \"$(declare -f _codex_stop_tier | sed '1s/^_codex_stop_tier/_codex_stop_tier_real/')\"",
      '_codex_stop_tier() {',
      '  _codex_stop_tier_real "$@"; local rc=$?',
      `  : > ${shq(trigger)}`,
      `  for _i in $(seq 1 100); do [ -s ${shq(marker)} ] && break; sleep 0.05; done`,
      '  return "$rc"',
      '}',
      'cmd_codex start codex-a',
    ].join('\n');
    const r = lib(home, script, { CCRC_CODEX_READY_S: '3' });
    expect(fs.existsSync(marker), 'the foreign holder never bound the port').toBe(true);
    expect(r.code, r.stderr).toBe(1);
    // `_codex_foreign_what`'s own code for a raw socket with no lane
    // protocol is `port-foreign` (measured), not a fixed `tier-foreign` —
    // this step relays whatever it answers, never a hand-picked one.
    expect(r.stderr).toMatch(/^ccrc codex: port-foreign: /m);
    expect(r.stderr).toMatch(/is held by a listener that is not this lane's/m);
    expect(r.stderr).not.toMatch(/tier-not-ready/);
    expect(r.stderr).toMatch(/tier is now DOWN/m);
    expect(r.stderr).toContain('ccrc codex start codex-a');
    expect(r.stdout).toBe('');
    expect(fs.existsSync(join(d, 'litellm.pid')), 'a new litellm.pid was written over the foreign holder').toBe(false);
    expect(alive(lit)).toBe(false);   // the real stop really ended it
  }, 60_000);

  // The Task 10 residue C1: the rekey re-ask's `*)` arm — a re-ask, right
  // before the restart it owes, that cannot tell whether the port is free.
  // The stop is REAL and frees the port; only the answers AFTER it are
  // engineered (a flag file, because the stop runs in a `$( … )` subshell):
  // every later `_codex_tier_ours` then answers 3, as an unmeasurable
  // socket owner does.
  it('L36 a rekey restart whose re-ask right before the restart cannot be measured is tier-unmeasured, says the tier is DOWN, and starts nothing (Task 10 residue C1)', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const d = laneDir(home, 'codex-a');
    const first = codex(home, ['start', 'codex-a']);
    expect(first.code, first.stderr).toBe(0);
    const lit = Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'));
    fs.rmSync(join(d, 'runtime.env'));   // `created` on the next start: a rekey
    const flag = join(home, 'rekey-stopped');
    const script = [
      "eval \"$(declare -f _codex_tier_ours | sed '1s/^_codex_tier_ours/_codex_tier_ours_real/')\"",
      `_codex_tier_ours() { [ -f ${shq(flag)} ] && return 3; _codex_tier_ours_real "$@"; }`,
      "eval \"$(declare -f _codex_stop_tier | sed '1s/^_codex_stop_tier/_codex_stop_tier_real/')\"",
      `_codex_stop_tier() { _codex_stop_tier_real "$@"; local rc=$?; : > ${shq(flag)}; return "$rc"; }`,
      'cmd_codex start codex-a',
    ].join('\n');
    const r = lib(home, script, { CCRC_CODEX_READY_S: '3' });
    expect(fs.existsSync(flag), 'the rekey never reached its stop').toBe(true);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: tier-unmeasured: whether codex-a's litellm tier's port is free right before the restart could not be measured \(the lane library answered 3\), so it was not started again for the new gateway key; codex-a's litellm tier is now DOWN\. Bring it back with: ccrc codex start codex-a\.$/m);
    expect(r.stderr).not.toMatch(/tier-not-ready/);
    expect(r.stdout).toBe('');
    expect(fs.existsSync(join(d, 'litellm.pid')), 'a litellm was started after an unmeasurable re-ask').toBe(false);
    expect(alive(lit)).toBe(false);   // the real stop really ended it
    // The shim survived the rekey's LiteLLM-only stop; end that nohup tier
    // through the product before a successful Darwin case returns.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  // Review A4 (D-3488: never signal what is not proven ours): the nohup
  // stop's SIGKILL follows a TERM wait of up to 10 s, and a pid reused
  // inside it would be a stranger. Every seam is stubbed — `kill` and
  // `sleep` included, so nothing is signalled and nothing waits — and the
  // pid named is this runner's own `sleep` child, in case a stub is lost.
  it('A4 the nohup stop re-proves the pid before its SIGKILL: a pid that no longer proves this lane\'s tier after the TERM wait is never killed (review A4)', async () => {
    const h = box('ccrc-codex-stop-reprove-');
    await twoLanes(h);
    const sleeper = spawn('sleep', ['600'], { stdio: 'ignore' });
    trackChild(h, sleeper);
    const pid = sleeper.pid!;
    const kills = join(h, 'kills');
    const run = (proven: 0 | 1): { r: Result; log: string[] } => {
      fs.rmSync(kills, { force: true });
      const r = lib(h, [
        // Not `n`: `_codex_stop_tier` has a `local n` of its own, which this
        // stub would read by bash's dynamic scope.
        'tier_calls=0',
        `_codex_tier_ours() { tier_calls=$((tier_calls + 1)); CX_TIER_WHY=''; if [ "$tier_calls" -eq 1 ]; then CX_TIER_VIA=nohup; CX_TIER_PID=${pid}; return 0; fi; CX_TIER_VIA=''; CX_TIER_PID=''; return 1; }`,
        `kill() { printf 'kill %s\\n' "$*" >> ${shq(kills)}; return 0; }`,
        'sleep() { :; }',
        `_codex_pid_is_tier() { printf 'reprove %s\\n' "$*" >> ${shq(kills)}; return ${proven}; }`,
        '_codex_stop_tier codex-a litellm',
      ].join('\n'));
      return { r, log: fs.existsSync(kills) ? fs.readFileSync(kills, 'utf8').split('\n').filter(Boolean) : [] };
    };
    const gone = run(1);
    expect(gone.r.stdout, gone.r.stderr).toBe('stopped\n');
    expect(gone.log[0]).toBe(`kill -TERM ${pid}`);
    expect(gone.log).toContain(`reprove codex-a litellm ${pid}`);
    expect(gone.log.filter((l) => l.startsWith('kill -KILL')), 'SIGKILL went to a pid that no longer proves the tier').toEqual([]);
    // CONTROL: the pid still proving the tier is killed, so the case can see a KILL.
    const still = run(0);
    expect(still.log).toContain(`kill -KILL ${pid}`);
    expect(sleeper.exitCode, 'a stub was lost and a real signal landed').toBeNull();
  }, 30_000);

  // Rulings R19 and R38, the lock's contract: held until `_codex_unlock`, the
  // ONLY release, which clears both variables; re-entrant AT ONCE for the lane
  // this shell, or a subshell of it, already holds (no second `flock`, which
  // would wait on this very process's lock); a call for another lane releases
  // the first; and rc 0 with nothing held where `flock` is missing. The
  // instrument for "held" is `flock -n` from another process. A 1 s readiness
  // bound makes a non-re-entrant subshell wait 31 s, past this runner's 15 s.
  it('L28 _codex_lock is held until _codex_unlock, re-entrant for its own lane in the shell and a subshell, releases the first lane for another, and holds nothing without flock (rulings R19, R38)', () => {
    const home = box('ccrc-codex-lock-');
    const held = (id: string): string =>
      `if flock -n ${shq(join(laneDir(home, id), '.lock'))} true; then echo "${id} free"; else echo "${id} held"; fi`;
    const r = lib(home, [
      '_codex_lock codex-a; echo "a rc=$? fd=${CX_LOCK_FD:+set} id=$CX_LOCK_ID"',
      held('codex-a'),
      'f1="$CX_LOCK_FD"; t0=$SECONDS',
      '_codex_lock codex-a; echo "again rc=$? same=$([ "$CX_LOCK_FD" = "$f1" ] && echo y)"',
      '( _codex_lock codex-a; echo "sub rc=$? id=$CX_LOCK_ID" )',
      'echo "at-once=$(( SECONDS - t0 < 5 ))"',
      held('codex-a'),
      '_codex_lock codex-b; echo "b rc=$? id=$CX_LOCK_ID"',
      held('codex-a'),
      held('codex-b'),
      '_codex_unlock; echo "unlock rc=$? fd=[$CX_LOCK_FD] id=[$CX_LOCK_ID]"',
      held('codex-b'),
      '_codex_unlock; echo "noop rc=$?"',
    ].join('\n'), { CCRC_CODEX_READY_S: '1' });
    expect(r.stdout, r.stderr).toBe([
      'a rc=0 fd=set id=codex-a', 'codex-a held',
      'again rc=0 same=y', 'sub rc=0 id=codex-a', 'at-once=1', 'codex-a held',
      'b rc=0 id=codex-b', 'codex-a free', 'codex-b held',
      'unlock rc=0 fd=[] id=[]', 'codex-b free', 'noop rc=0', '',
    ].join('\n'));
    expect(r.stderr).toBe('');
    // No flock on PATH: rc 0, nothing held, nothing opened.
    const bare = box('ccrc-codex-lock-noflock-');
    const n = lib(bare, '_codex_lock codex-a; echo "rc=$? fd=[${CX_LOCK_FD:-}]"',
      { PATH: pathWithout(bare, 'flock') });
    expect(n.stdout, n.stderr).toBe('rc=0 fd=[]\n');
    expect(fs.existsSync(join(laneDir(bare, 'codex-a'), '.lock'))).toBe(false);
  }, 60_000);

  // Review F1, end to end: the LiteLLM this start spawned is alive and this
  // lane's by its command line but has not bound (the stand-in told to wait
  // 600 s: a real one imports for 8-10 s), and ANOTHER process takes its port
  // once the start has classified both tiers. The start must never adopt that
  // port: not `litellm started`, not exit 0. A second start names the holder,
  // and a stop stops this lane's own process and leaves the holder running.
  // PLATFORM-ONLY (the ruling): the ownership read is /proc here.
  it.skipIf(IS_DARWIN)('L29 a LiteLLM this start spawned that has not bound, while another process takes its port, is never adopted: start ends tier-not-ready, a second start names the holder, and stop stops this lane\'s process and leaves the holder running (review F1)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const d = laneDir(home, 'codex-a');
    slowLitellmListen(home, 600);
    const start = codexAsync(home, ['start', 'codex-a'], { CCRC_CODEX_READY_S: '6' });
    // The stand-in records itself before it waits: the start has classified
    // both tiers and spawned this one.
    await eventually(() => litellmEvidence(home, a.litellmPort) !== null, 'the spawned LiteLLM to record itself', 20_000);
    const mine = litellmEvidence(home, a.litellmPort)!['pid'] as number;
    const holder = await spawnListener(home, { answer: '404', port: a.litellmPort });
    const r = await start;
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc codex: tier-not-ready: codex-a's litellm tier did not answer as this lane within 6s/m);
    expect(alive(mine)).toBe(true);
    expect(Number(fs.readFileSync(join(d, 'litellm.pid'), 'utf8'))).toBe(mine);
    const again = codex(home, ['start', 'codex-a']);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${a.litellmPort} \\(codex-a's litellm tier\\) `
      + `is held by a process that is not this lane's LiteLLM: pid ${mine} is this lane's by its command line`, 'm'));
    const s = codex(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped, bridge not running\n');
    expect(s.stderr).toMatch(new RegExp(`port ${a.litellmPort} \\(codex-a's litellm tier\\) is held by a listener that is not this lane's.*ccrc left it running\\.$`, 'm'));
    await eventually(() => !alive(mine), 'this lane\'s LiteLLM to exit');
    expect(await portAccepts(a.litellmPort)).toBe(true);
    expect(psArgs(holder.pid)).toContain('listener.py');
  }, 120_000);

  // Review F2: the PF-15 pre-check's per-tier loop is reachable. lane.json's
  // state reads `current` for ANY non-empty unit string, while `_codex_unit`
  // takes only a `.service` name that cannot be read as a flag (Task 4's
  // "a unit name lane.json spells like a flag" case), so this lane.json passes
  // the ensure and names no usable shim unit.
  it('L31 a lane.json whose shim unit is no usable unit name reads current, and start refuses lane-unwritable in its pre-check, before either tier is spawned (review F2)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const f = join(laneDir(home, 'codex-a'), 'lane.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { units: Record<string, string> };
    fs.writeFileSync(f, JSON.stringify({ ...j, units: { ...j.units, shim: '--all.service' } }));
    expect(lib(home, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
    const r = codex(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: lane-unwritable: .*lane\.json names no usable shim unit, .*Nothing was started\.$/m);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    expect(litellmEvidence(home, lanes['codex-a']!.litellmPort)).toBeNull();
  }, 60_000);

  // Review F2: a stamp that exists but cannot be read passes the verb's own
  // runtime check (`ccgpt-runtime python` asks only that it exists) and fails
  // `_codex_started_json`, so the pre-check's own sentence answers. Root reads
  // a 0000 file, so the case cannot be staged there.
  it.skipIf(process.getuid?.() === 0)('L32 a runtime stamp that cannot be read is the pre-check\'s runtime-absent, with its own sentence, before either tier is spawned (review F2)', async () => {
    const { home, lanes, rt } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    fs.chmodSync(rt.stamp, 0o000);
    const r = codex(home, ['start', 'codex-a']);
    fs.chmodSync(rt.stamp, 0o644);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: runtime-absent: what codex-a's litellm tier would run cannot be recorded: .*Nothing was started\.$/m);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stdout).toBe('');
    expect(systemdRunCalls(home)).toEqual([]);
    for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(laneDir(home, 'codex-a'), `${t}.pid`)), t).toBe(false);
    expect(litellmEvidence(home, lanes['codex-a']!.litellmPort)).toBeNull();
  }, 60_000);

  // Review F1: a 3 in the readiness wait is an answer `_codex_tier_ours` has
  // already printed (here, ownership it cannot measure: a stub), and waiting
  // cannot change it. The start ends at once, with that one line.
  it('L33 a readiness probe that cannot measure LiteLLM\'s ownership of its port ends the start at once, with its one line (review F1)', async () => {
    const { home } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const t0 = Date.now();
    const r = lib(home, "_codex_pid_listens() { CX_LISTEN_WHY='a stub that cannot ask'; return 3; }\ncmd_codex start codex-a",
      { CCRC_CODEX_READY_S: '8' });
    const took = Date.now() - t0;
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trimEnd().split('\n')).toEqual([expect.stringMatching(
      /^ccrc codex: tier-unmeasured: codex-a's litellm tier: .*\(a stub that cannot ask\)/)]);
    expect(took).toBeLessThan(8000);
    // The stub's unmeasurable readiness answer left both product-started nohup
    // tiers live. Stop them while this Darwin-reachable case still owns them.
    expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
  }, 60_000);

  // Review S1: the one `foreign` that carries a handle. This lane's LiteLLM is
  // running by its command line (bound elsewhere: a kernel-chosen port) while
  // another process holds litellmPort. Status must not say ccrc "will neither
  // adopt nor stop it": `stop` stops this lane's process there (L29) and
  // leaves the holder running, and the JSON keeps the handle.
  it.skipIf(IS_DARWIN)('L34 status names this lane\'s LiteLLM process running on a port another process holds, says what stop does, and keeps its via and pid in --json (review S1)', async () => {
    const { home, lanes } = await lifeBox({ userManager: false, ids: ['codex-a'] });
    const a = lanes['codex-a']!;
    const mine = await spawnListener(home, { answer: '404', argv: ['--config', litellmYaml(home, 'codex-a')] });
    fs.writeFileSync(join(laneDir(home, 'codex-a'), 'litellm.pid'), `${mine.pid}\n`);
    await spawnListener(home, { answer: '404', port: a.litellmPort });
    const h = codex(home, ['status', 'codex-a']);
    expect(h.code, h.stderr).toBe(0);
    expect(h.stdout.split('\n').slice(0, 2)).toEqual([
      `ccrc codex: codex-a: litellm FOREIGN — this lane's litellm process is running (nohup, pid ${mine.pid}) `
        + `but does not hold port ${a.litellmPort}: another process does. 'ccrc codex stop codex-a' stops this lane's `
        + 'process and leaves the other running',
      'ccrc codex: codex-a: shim stopped',
    ]);
    expect(h.stdout).not.toMatch(/neither adopt nor stop/);
    const j = codex(home, ['status', 'codex-a', '--json']);
    expect(j.code, j.stderr).toBe(0);
    expect((JSON.parse(j.stdout) as { tiers: Record<string, unknown> }).tiers).toEqual({
      litellm: { state: 'foreign', via: 'nohup', pid: mine.pid },
      shim: { state: 'stopped', via: null, pid: null },
      bridge: { state: 'stopped', via: null, pid: null },
    });
  }, 60_000);

  // ── the unit arm: a Linux box whose user manager answers ───────────────────
  // PLATFORM-ONLY: `_svc_have_user_manager` answers 1 on darwin unconditionally
  // (D-3483), so a macOS box has no unit arm to contrast with. The
  // arms these cases pin have no darwin counterpart, and L5–L9, L16, L20, L21
  // and L23 above run the nohup arm on both platforms, as L24–L28 run on both.
  describeLinux('with a user manager, each tier is one transient unit', () => {
    it('L10 two lanes start, run and stop independently; stopping one leaves the other up', async () => {
      const { home, lanes } = await lifeBox({ userManager: true });
      const a = lanes['codex-a']!;
      const b = lanes['codex-b']!;
      const sa = codex(home, ['start', 'codex-a']);
      expect(sa.code, sa.stderr).toBe(0);
      expect(sa.stdout).toBe('ccrc codex: codex-a: litellm started (systemd ccgpt-codex-a-litellm.service), '
        + 'shim started (systemd ccgpt-codex-a-shim.service)\n');
      const sb = codex(home, ['start', 'codex-b']);
      expect(sb.code, sb.stderr).toBe(0);
      // Each lane answers AS ITSELF on its own port: the REAL shim, started
      // with its --ccrc-lane marker (ruling R6), under its own unit.
      for (const [id, l] of [['codex-a', a], ['codex-b', b]] as const) {
        const ans = await laneAnswer(l.proxyPort);
        expect(ans?.status).toBe(200);
        expect(ans?.type).toMatch(/^application\/json/);
        expect(JSON.parse(ans!.body)).toEqual({ lane: id });
        expect(await portAccepts(l.litellmPort)).toBe(true);
      }
      const st = codex(home, ['stop', 'codex-a']);
      expect(st.code, st.stderr).toBe(0);
      expect(st.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped, bridge not running\n');
      // BY EXACT UNIT NAME — each proven by its MainPID first — the front tier
      // first, and nothing of codex-b's.
      expect(stopCalls(home)).toEqual([
        '--user stop ccgpt-codex-a-shim.service', '--user stop ccgpt-codex-a-litellm.service',
      ]);
      expect(await laneAnswer(a.proxyPort)).toBeNull();
      expect(await portAccepts(a.litellmPort)).toBe(false);
      expect(JSON.parse((await laneAnswer(b.proxyPort))!.body)).toEqual({ lane: 'codex-b' });
      expect(await portAccepts(b.litellmPort)).toBe(true);
      for (const f of ['litellm.started', 'shim.started', 'litellm.pid', 'shim.pid']) {
        expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), f).toBe(false);
      }
      expect(fs.existsSync(join(laneDir(home, 'codex-b'), 'shim.started'))).toBe(true);
      expect(codex(home, ['stop', 'codex-b']).code).toBe(0);
      expect(await laneAnswer(b.proxyPort)).toBeNull();
    }, 120_000);

    it('L11 the unit argv: app.slice, Restart=always, RestartSec=3, the log paths, runtime.env for litellm only, an isolated LiteLLM, the shim\'s lane marker, and no key', async () => {
      const { home, lanes, rt, shimFile } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      expect(codex(home, ['start', 'codex-a']).code).toBe(0);
      const runs = systemdRunArgv(home);
      expect(runs).toHaveLength(2);
      const [lit, shim] = runs as [string[], string[]];
      const py = join(rt.gen, 'bin', 'python');
      const d = laneDir(home, 'codex-a');
      const logs = logDir(home, 'codex-a');
      const head = (unit: string): string[] =>
        ['--user', '--collect', '--quiet', `--unit=${unit}`, '--slice=app.slice', `--working-directory=${home}`];
      const props = (argv: string[]): string[] => argv.flatMap((x, i) => (x === '-p' ? [argv[i + 1]!] : []));
      const setenv = (argv: string[]): string[] =>
        argv.filter((x) => x.startsWith('--setenv=')).map((x) => x.slice('--setenv='.length));
      const after = (argv: string[]): string[] => argv.slice(argv.indexOf('--') + 1);

      expect(lit.slice(0, 6)).toEqual(head('ccgpt-codex-a-litellm.service'));
      expect(props(lit)).toEqual(expect.arrayContaining(['Restart=always', 'RestartSec=3',
        `StandardOutput=append:${logs}/litellm.log`, `StandardError=append:${logs}/litellm.log`,
        `EnvironmentFile=${d}/runtime.env`]));
      // Ruling R1: CHATGPT_TOKEN_DIR's last `_`-segment is DIR, so the helper
      // passes it. This is the cross-task pin on Task 2's name rule.
      expect(setenv(lit).sort()).toEqual(
        [`CCRC_CODEX_AUTH_LIB=${join(home, '.local', 'bin', 'ccgpt-auth.py')}`, 'CCRC_CODEX_LANE=codex-a',
          `CHATGPT_TOKEN_DIR=${join(home, a.authDir)}`, `HOME=${home}`, 'LITELLM_LOCAL_MODEL_COST_MAP=True'].sort());
      // Ruling R45: `-I`, so the working directory ($HOME) is not on sys.path.
      // L23 measures what that buys, with the real interpreter.
      expect(after(lit)).toEqual([py, '-I', '-m', 'litellm.proxy.proxy_cli', '--config', litellmYaml(home, 'codex-a'),
        '--host', '127.0.0.1', '--port', String(a.litellmPort)]);

      expect(shim.slice(0, 6)).toEqual(head('ccgpt-codex-a-shim.service'));
      expect(props(shim)).toEqual(expect.arrayContaining(['Restart=always', 'RestartSec=3',
        `StandardOutput=append:${logs}/shim.log`, `StandardError=append:${logs}/shim.log`]));
      expect(props(shim).filter((p) => p.startsWith('EnvironmentFile=')), 'the shim is value-blind').toEqual([]);
      expect(setenv(shim).sort()).toEqual(['CCGPT_ACCOUNT_ID=codex-a', `CCGPT_LITELLM_PORT=${a.litellmPort}`,
        `CCGPT_PROXY_PORT=${a.proxyPort}`, `HOME=${home}`].sort());
      // Ruling R6: the shim file, then the lane marker, as two words — exactly
      // what Task 4's `_codex_pid_is_tier` proves a pid by.
      expect(after(shim)).toEqual([py, '-I', shimFile, '--ccrc-lane=codex-a']);
      // The RESOLVED generation, never through `current` (D-3480), asked of
      // the interpreter ccrc's own argv names (ruling PF-16), not of `py`.
      for (const argv of [lit, shim]) expect(after(argv)[0]!.split(path.sep)).not.toContain('current');

      // THE KEY: in runtime.env at 0600, and nowhere in any argv or recorded call…
      // This census IS spec §5.4's no-secret pin (D-3491, ruling R46).
      // The spec says to assert over `systemctl show` output in a fixture, but a
      // planted `show` answer would be a control derived from the measurement.
      const envText = fs.readFileSync(join(d, 'runtime.env'), 'utf8');
      expect(envText).toMatch(/^LITELLM_MASTER_KEY=sk-[0-9a-f]{48}\n$/);
      expect(fs.statSync(join(d, 'runtime.env')).mode & 0o777).toBe(0o600);
      const k = envText.trim().slice('LITELLM_MASTER_KEY='.length);
      const carriers = [...runs.flat(), ...systemctlCalls(home), ...systemdRunCalls(home),
        ...fs.readFileSync(join(rt.gen, 'python-calls'), 'utf8').split('\n')].filter((s) => s.includes(k)).length;
      expect(carriers, 'an argv element or a recorded call carries the gateway key').toBe(0);
      // No pair is secret-shaped by ruling R1's rule: a NAME whose last
      // `_`-segment ends with KEY, TOKEN, SECRET, PASSWORD or PASSWD.
      expect([...setenv(lit), ...setenv(shim)].map((s) => s.split('=')[0]!)
        .filter((n) => /(KEY|TOKEN|SECRET|PASSWORD|PASSWD)$/i.test(n.split('_').pop()!))).toEqual([]);
      // …and it still REACHED the litellm process, through the file alone.
      const ev = litellmEvidence(home, a.litellmPort)!;
      expect(ev['masterKeyShaped']).toBe(true);
      expect(ev['tokenDir']).toBe(join(home, a.authDir));
      expect(ev['costMapLocal']).toBe('True');
      expect(ev['home']).toBe(home);
      expect(fs.readFileSync(join(logs, 'litellm.log'), 'utf8')).toMatch(/fixture litellm: listening on/);
      // The record is Task 4's `_codex_started_json` output, nothing else, so
      // Task 4's `_codex_tier_stale` reads a fresh start as current (1) for both.
      expect(JSON.parse(fs.readFileSync(join(d, 'litellm.started'), 'utf8')))
        .toEqual({ generation: rt.gen, code: litellmCode(rt.stamp, home) });
      expect(JSON.parse(fs.readFileSync(join(d, 'shim.started'), 'utf8')))
        .toEqual({ generation: rt.gen, code: sha256(shimFile) });
      expect(lib(home, '_codex_tier_stale codex-a litellm; a=$?; _codex_tier_stale codex-a shim; echo "$a $?"').stdout)
        .toBe('1 1\n');
    }, 120_000);

    it('L12 start is idempotent: a second start adopts both tiers and spawns nothing', async () => {
      const { home, rt } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      expect(codex(home, ['start', 'codex-a']).code).toBe(0);
      const lit = unitPid(home, 'ccgpt-codex-a-litellm.service');
      const shim = unitPid(home, 'ccgpt-codex-a-shim.service');
      const again = codex(home, ['start', 'codex-a']);
      expect(again.code, again.stderr).toBe(0);
      expect(again.stdout).toBe('ccrc codex: codex-a: litellm adopted (systemd ccgpt-codex-a-litellm.service), '
        + 'shim adopted (systemd ccgpt-codex-a-shim.service)\n');
      expect(systemdRunArgv(home)).toHaveLength(2);
      expect([unitPid(home, 'ccgpt-codex-a-litellm.service'), unitPid(home, 'ccgpt-codex-a-shim.service')]).toEqual([lit, shim]);
      const st = codex(home, ['status', 'codex-a', '--json']);
      expect(st.code).toBe(0);
      expect(JSON.parse(st.stdout)).toEqual({
        id: 'codex-a', mode: 'litellm', upstream: 'backend', bridge: null,
        tiers: { litellm: { state: 'running', via: 'systemd', pid: lit }, shim: { state: 'running', via: 'systemd', pid: shim },
          bridge: { state: 'stopped', via: null, pid: null } },
        runtime: { generation: path.basename(rt.gen) },
        lane: { json: 'current' },
        auth: expect.objectContaining({ credential: 'present', state: 'ok' }),
      });
    }, 120_000);

    // Ruling PF-13: a unit of this name that is live with no process proving
    // this lane is UNPROVEN, and never claimed as another tool's. Two shapes:
    // a live stranger as MainPID, and MainPID 0, which is also this lane's own
    // tier crash-looping inside its RestartSec window. The sentence says the
    // identity is unproven and suggests retrying.
    it.each([['a live stranger', true], ['MainPID 0, as in a restart window', false]] as const)(
      'L13 an active unit of this name whose MainPID is not this lane\'s tier (%s) is unit-foreign, its identity named unproven, and left running', async (_what, stranger) => {
        const { home } = await lifeBox({ userManager: true, ids: ['codex-a'] });
        // A live process on a kernel-chosen port whose command line proves no lane.
        const other = stranger ? await spawnListener(home, { answer: '404' }) : null;
        fakeUnit(home, 'ccgpt-codex-a-litellm.service', { state: 'active', pid: other?.pid ?? 0 });
        const r = codex(home, ['start', 'codex-a']);
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/^ccrc codex: unit-foreign: the unit ccgpt-codex-a-litellm\.service is active, but its identity as codex-a's litellm tier is unproven/m);
        expect(r.stderr).toMatch(/Re-run in a few seconds/);
        expect(r.stderr).not.toMatch(/another tool/);
        expect(systemdRunCalls(home)).toEqual([]);
        if (other !== null) expect(await portAccepts(other.port)).toBe(true);
      }, 60_000);

    it('L14 a unit the manager will not stop is stop-failed, and the other tier is still stopped', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      expect(codex(home, ['start', 'codex-a']).code).toBe(0);
      failUnitStop(home, 'ccgpt-codex-a-shim.service', true);
      const s = codex(home, ['stop', 'codex-a']);
      expect(s.code).toBe(1);
      expect(s.stdout).toBe('');
      expect(s.stderr).toMatch(/^ccrc codex: stop-failed: codex-a's shim tier is still running/m);
      expect(await portAccepts(a.litellmPort)).toBe(false);
      expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-a' });
      failUnitStop(home, 'ccgpt-codex-a-shim.service', false);
      expect(codex(home, ['stop', 'codex-a']).code).toBe(0);
      expect(await laneAnswer(a.proxyPort)).toBeNull();
    }, 120_000);

    it('L15 two starts at once serialise on the lane lock: one starts, the other adopts, and neither is refused (ruling R11)', async () => {
      const { home } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const [r1, r2] = await Promise.all([codexAsync(home, ['start', 'codex-a']), codexAsync(home, ['start', 'codex-a'])]);
      expect([r1.code, r2.code], `${r1.stderr}\n${r2.stderr}`).toEqual([0, 0]);
      expect([r1.stdout, r2.stdout].sort()).toEqual([
        'ccrc codex: codex-a: litellm adopted (systemd ccgpt-codex-a-litellm.service), shim adopted (systemd ccgpt-codex-a-shim.service)\n',
        'ccrc codex: codex-a: litellm started (systemd ccgpt-codex-a-litellm.service), shim started (systemd ccgpt-codex-a-shim.service)\n',
      ]);
      expect(systemdRunArgv(home)).toHaveLength(2);
    }, 120_000);

    it('L17 a same-named unit that is not this lane\'s is never stopped: stop leaves it running and names it, and start refuses it (ruling R8, D-3488)', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      // The fleet box's shape (m-livebox §3): the OTHER repository runs this
      // lane's tiers under the SAME unit names — its shim answering text/plain
      // with the same id, its LiteLLM reading the box-global config.
      const shim = await spawnListener(home, { answer: 'text', lane: 'codex-a', port: a.proxyPort });
      const lit = await spawnListener(home, {
        answer: '404', port: a.litellmPort, argv: ['--config', join(home, '.handoff', 'litellm-config.yaml')],
      });
      fakeUnit(home, 'ccgpt-codex-a-shim.service', { state: 'active', pid: shim.pid });
      fakeUnit(home, 'ccgpt-codex-a-litellm.service', { state: 'active', pid: lit.pid });
      const s = codex(home, ['stop', 'codex-a']);
      expect(s.code, s.stderr).toBe(0);
      expect(s.stdout).toBe('ccrc codex: codex-a: litellm foreign, shim foreign, bridge foreign\n');
      for (const t of ['shim', 'litellm']) {
        expect(s.stderr).toMatch(new RegExp(`the unit ccgpt-codex-a-${t}\\.service is active but is not codex-a's ${t} tier.*ccrc left it running\\.$`, 'm'));
      }
      // No stop reached the manager, and both of the other repository's tiers still answer.
      expect(stopCalls(home)).toEqual([]);
      expect(await portAccepts(a.proxyPort)).toBe(true);
      expect(await portAccepts(a.litellmPort)).toBe(true);
      expect(psArgs(shim.pid)).toContain('listener.py');
      expect(psArgs(lit.pid)).toContain('listener.py');
      // And start will not attach this lane to them.
      const r = codex(home, ['start', 'codex-a']);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^ccrc codex: unit-foreign: the unit ccgpt-codex-a-litellm\.service is active but is not codex-a's litellm tier/m);
      expect(systemdRunCalls(home)).toEqual([]);
      expect(await portAccepts(a.litellmPort)).toBe(true);
    }, 60_000);

    it('L18 ccrc codex stop during a start waits on the lane lock: the start finishes, then both tiers stop (ruling R11)', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      // A LiteLLM that takes 4 s to bind: the start holds the lock through it.
      slowLitellmListen(home, 4);
      const start = codexAsync(home, ['start', 'codex-a']);
      // Once a unit is spawned, the start holds the lock and is waiting on readiness.
      await eventually(() => systemdRunArgv(home).length >= 1, 'the start to spawn its first unit', 20_000);
      const s = codex(home, ['stop', 'codex-a']);
      const r = await start;
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^ccrc codex: codex-a: litellm started \(systemd /);
      expect(s.code, s.stderr).toBe(0);
      expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped, bridge not running\n');
      expect(await portAccepts(a.litellmPort)).toBe(false);
      expect(await laneAnswer(a.proxyPort)).toBeNull();
    }, 120_000);

    // Review F1 on the unit arm: this lane's OWN unit, MainPID proven, whose
    // process has not bound while another process holds the port. That is
    // port-foreign, never unit-foreign (the unit IS this lane's), and a stop
    // the manager refuses is stop-failed, never `foreign`: rc 0 would promise
    // no tier of this lane runs while this lane's unit still does.
    it('L30 this lane\'s LiteLLM unit whose process does not hold its port is port-foreign, never unit-foreign, and a stop that cannot end it is stop-failed, never foreign (review F1)', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      const unit = 'ccgpt-codex-a-litellm.service';
      slowLitellmListen(home, 600);
      const start = codexAsync(home, ['start', 'codex-a'], { CCRC_CODEX_READY_S: '6' });
      await eventually(() => litellmEvidence(home, a.litellmPort) !== null, 'the unit\'s LiteLLM to record itself', 20_000);
      const mine = litellmEvidence(home, a.litellmPort)!['pid'] as number;
      expect(unitPid(home, unit)).toBe(mine);
      await spawnListener(home, { answer: '404', port: a.litellmPort });
      const r = await start;
      expect(r.code, r.stdout).toBe(1);
      expect(r.stdout).toBe('');
      const again = codex(home, ['start', 'codex-a']);
      expect(again.code).toBe(1);
      expect(again.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${a.litellmPort} \\(codex-a's litellm tier\\) `
        + `is held by a process that is not this lane's LiteLLM: pid ${mine} is this lane's by its command line`, 'm'));
      expect(again.stderr).not.toMatch(/unit-foreign/);
      failUnitStop(home, unit, true);
      const s = codex(home, ['stop', 'codex-a']);
      expect(s.code).toBe(1);
      expect(s.stdout).toBe('');
      expect(s.stderr).toMatch(new RegExp(`^ccrc codex: stop-failed: codex-a's litellm tier is still running after the stop \\(systemd, pid ${mine}\\)`, 'm'));
      expect(alive(mine)).toBe(true);
      failUnitStop(home, unit, false);
      const s2 = codex(home, ['stop', 'codex-a']);
      expect(s2.code, s2.stderr).toBe(0);
      expect(s2.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim not running, bridge not running\n');
      await eventually(() => !alive(mine), 'this lane\'s LiteLLM unit process to exit');
      expect(await portAccepts(a.litellmPort)).toBe(true);
    }, 120_000);

    it('L22 on the unit arm a start deletes a stale pidfile, which nothing else there would remove, and never signals its pid (ruling R34)', async () => {
      const { home, lanes } = await lifeBox({ userManager: true, ids: ['codex-a'] });
      const a = lanes['codex-a']!;
      const d = laneDir(home, 'codex-a');
      // A live process this lane's own pidfiles name, proving no lane: pid reuse
      // after the box ran the nohup arm, or a hand edit. No unit of this lane's
      // is active yet, so `_codex_tier_ours` reads the files, and reads past them.
      const stranger = spawn('sleep', ['600'], { stdio: 'ignore' });
      trackChild(home, stranger);
      for (const t of ['litellm', 'shim']) fs.writeFileSync(join(d, `${t}.pid`), `${stranger.pid}\n`);
      const r = codex(home, ['start', 'codex-a']);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('ccrc codex: codex-a: litellm started (systemd ccgpt-codex-a-litellm.service), '
        + 'shim started (systemd ccgpt-codex-a-shim.service)\n');
      for (const t of ['litellm', 'shim']) expect(fs.existsSync(join(d, `${t}.pid`)), `${t}.pid`).toBe(false);
      // Unsignalled: a killed child of this process would read `[sleep] <defunct>`.
      expect(psArgs(stranger.pid!)).toMatch(/^sleep 600/);
      expect(JSON.parse((await laneAnswer(a.proxyPort))!.body)).toEqual({ lane: 'codex-a' });
      expect(await portAccepts(a.litellmPort)).toBe(true);
    }, 120_000);
  });
});

// `ccrc codex login <id>` (Plan 2b-2 Task 8, spec §9.3; codex-bridge Stage 1,
// Task 8). The auth library signs the lane in: `ccd/ccgpt-auth.py`'s
// device-code sign-in, run as a command over the roster's authDir, the copy
// `_codex_auth_lib` names. No Codex runtime is built in these boxes, so a
// login that still needed one would answer runtime-absent. Every case runs
// `ccrc` ASYNCHRONOUSLY against a `fakeAuthServer` passed as
// CCRC_CODEX_AUTH_BASE (a synchronous child deadlocks against a server on
// this event loop), or under the CLOSED_AUTH_BASE default `ghContainedEnv`
// sets, so no case can reach a live endpoint. Tokens are built at runtime by
// `syntheticJwt`; none is written here.
describe.skipIf(!pythonOrSkip())('ccrc codex login — the auth library signs the lane in', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const RUNTIME_SRC = join(ROOT, 'ccd', 'ccgpt-runtime');
  // The lane's authDir, relative to HOME, as the ROSTER names it: `codexRoster`
  // writes exactly `codexAuthDir(id)`, so this is the roster's value, not an
  // assumption about it.
  const AUTH_REL = codexAuthDir('codex-a');
  // A device code in the shape `ccd-account-auth` publishes: the FIRST
  // `XXXX-XXXX` run it sees, so nothing ccrc prints before the library's lines
  // may carry one.
  const USER_CODE = 'QW7R-9KZ2';
  const firstCode = (s: string): string | undefined => /[A-Z0-9]{4}-[A-Z0-9]{4}/.exec(s)?.[0];

  /** A fresh set of tokens the fake exchange answers with. */
  const issued = (): { access: string; refresh: string; id: string } => {
    const now = Math.floor(Date.now() / 1000);
    const claim = { 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-fixture-login' } };
    return {
      access: syntheticJwt({ exp: now + 3600, iat: now, ...claim }),
      refresh: `rtok-fixture-${randomBytes(16).toString('hex')}`,
      id: syntheticJwt({ exp: now + 3600, iat: now, email: 'lane-a@example.invalid', ...claim }),
    };
  };
  const usercode = (): AuthAnswer => ({ status: 200, body: { device_auth_id: 'dauth-fixture-1', user_code: USER_CODE } });
  const approved = (): AuthAnswer => ({
    status: 200, body: { authorization_code: 'acode-fixture-1', code_challenge: 'cchal-fixture-1', code_verifier: 'cver-fixture-1' },
  });
  /** A whole sign-in that succeeds at the first poll. */
  const fullSignin = (t: { access: string; refresh: string; id: string }): AuthScript => ({
    usercode: [usercode()], deviceToken: [approved()],
    token: [{ status: 200, body: { access_token: t.access, refresh_token: t.refresh, id_token: t.id } }],
  });
  const SIGNIN_PATHS = [AUTH_ROUTES.usercode, AUTH_ROUTES.deviceToken, AUTH_ROUTES.token];
  const credOf = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, AUTH_REL, 'auth.json'), 'utf8')) as Record<string, unknown>;

  /** A deployed-shaped box: ccrc under <home>/ccrc/ccd (so `$CCRC_HERE/../deploy`
   *  resolves for `models init`), `deploy`/`shared` linked whole, the REAL
   *  `ccgpt-runtime` placed with no generation built, the auth library placed
   *  where `_codex_auth_lib` names it (a copy, as `_inst_bins` places it), and
   *  `codexRoster`'s `codex-a` lane. */
  const loginBox = async (): Promise<string> => {
    const home = mkTmp('ccrc-codex-login-');
    const ccd = join(home, 'ccrc', 'ccd');
    mkdirSync(ccd, { recursive: true });
    for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccgpt-runtime']) {
      symlinkSync(join(ROOT, 'ccd', f), join(ccd, f));
    }
    symlinkSync(join(ROOT, 'deploy'), join(home, 'ccrc', 'deploy'));
    symlinkSync(join(ROOT, 'shared'), join(home, 'ccrc', 'shared'));
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    symlinkSync(RUNTIME_SRC, join(home, '.local', 'bin', 'ccgpt-runtime'));
    fs.copyFileSync(AUTH_LIB, authLib(home));
    chmodSync(authLib(home), 0o755);
    const [proxyPort, litellmPort] = await freePorts(2);
    codexRoster(home, [{ id: 'codex-a', proxyPort: proxyPort!, litellmPort: litellmPort! }]);
    return home;
  };

  /** ccrc under `umask 022`, so the mode case measures the library's modes
   *  rather than the runner's; every CHATGPT_, LITELLM_, OPENAI_ and CCRC_
   *  variable is removed from the developer's environment before
   *  `ghContainedEnv` (which sets CCRC_CODEX_AUTH_BASE to CLOSED_AUTH_BASE)
   *  and a case's own `extra` are added. Spawned, never spawnSync'd; killed
   *  past 15 s, inside vitest's own bound. `onErr`, when given, is called with
   *  the stderr read so far each time more arrives. */
  const runCcrc = (home: string, args: string[], extra: NodeJS.ProcessEnv = {},
    onErr?: (soFar: string) => void): Promise<{ code: number; stdout: string; stderr: string }> => {
    const base: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    for (const k of Object.keys(base)) {
      if (/^(CHATGPT_|LITELLM_|OPENAI_|CCRC_)/.test(k)) delete base[k];
    }
    const e = { ...ghContainedEnv(home, base, { systemd: true, tmux: true }), ...extra };
    expect(e['CCRC_CODEX_AUTH_BASE'], 'a login case with no loopback endpoint').toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    return new Promise((resolve, reject) => {
      const c = spawn('bash', ['-c', 'umask 022 && exec "$BASH" "$0" "$@"', join(home, 'ccrc', 'ccd', 'ccrc'), ...args],
        { cwd: home, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => c.kill('SIGKILL'), 15_000);
      c.stdout.on('data', (x: Buffer) => { out += x.toString(); });
      c.stderr.on('data', (x: Buffer) => { err += x.toString(); onErr?.(err); });
      c.once('error', (x) => { clearTimeout(timer); reject(x); });
      c.once('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: out, stderr: err }); });
    });
  };

  it('env() keeps the loopback CCGPT_BRIDGE_UPSTREAM_BASE ghContainedEnv sets (D-6838)', () => {
    const e = env(mkTmp('ccrc-codex-env-'));
    expect(e['CCRC_CODEX_AUTH_BASE'], 'no auth library reaches a live endpoint').toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(e['CCGPT_BRIDGE_UPSTREAM_BASE'], 'no bridge reaches the live backend').toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("A1: signs in through the library over the roster's authDir, against the fake endpoint, with no runtime", async () => {
    const home = await loginBox();
    const auth = join(home, AUTH_REL);
    const t = issued();
    const srv = await fakeAuthServer(fullSignin(t));
    try {
      const r = await runCcrc(home, ['codex', 'login', 'codex-a'], {
        CCRC_CODEX_AUTH_BASE: srv.base,
        // Ambient variables LiteLLM's authenticator read: the library reads none
        // of them, so none moves the credential out of the roster's authDir.
        CHATGPT_TOKEN_DIR: join(home, 'ambient-token-dir'),
        CHATGPT_AUTH_FILE: join(home, 'ambient', 'elsewhere.json'),
        OPENAI_API_KEY: 'ambient-not-a-secret',
        LITELLM_LOG: 'DEBUG',
      });
      expect(r.code, r.stderr).toBe(0);
      expect(srv.requests.map((q) => q.path)).toEqual(SIGNIN_PATHS);
      expect(credOf(home)).toMatchObject({ access_token: t.access, refresh_token: t.refresh, id_token: t.id });
      expect(existsSync(join(auth, 'auth.status.json')), 'the sign-in wrote no status').toBe(true);
      expect(existsSync(join(home, '.ccrc', 'runtime', 'codex', 'current')), 'a runtime was built').toBe(false);
      for (const p of ['ambient-token-dir', 'ambient']) {
        expect(existsSync(join(home, p)), `${p} was written — an ambient variable steered the sign-in`).toBe(false);
      }
      // The device lines reach the operator, and NOTHING ccrc printed before
      // them is shaped like a device code.
      expect(r.stdout).toContain(`2) Enter code: ${USER_CODE}`);
      expect(firstCode(r.stdout), 'ccrc printed a device-code-shaped run before the library did').toBe(USER_CODE);
      expect(r.stdout).toMatch(/^ccgpt-auth: codex-a: signed-in\nccrc codex: codex-a: logged in/m);
      for (const s of [t.access, t.refresh, t.id]) expect(r.stdout + r.stderr, 'a token was printed').not.toContain(s);
      // Again: the credential is present, so the library answers already-signed-in with no request.
      const again = await runCcrc(home, ['codex', 'login', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(again.code, again.stderr).toBe(0);
      expect(srv.requests).toHaveLength(SIGNIN_PATHS.length);
      expect(again.stdout).toMatch(
        /^ccgpt-auth: codex-a: already-signed-in: .*records needs-signin; run this again then\nccrc codex: codex-a: logged in/m);
    } finally {
      await srv.close();
    }
  });

  it("A2: login-failed when the library's sign-in fails, and nothing is written", async () => {
    const home = await loginBox();
    const t = issued();
    const srv = await fakeAuthServer({ ...fullSignin(t), token: [{ status: 400, body: { error: 'invalid_grant' } }] });
    try {
      const r = await runCcrc(home, ['codex', 'login', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.code).toBe(1);
      expect(srv.requests.map((q) => q.path)).toEqual(SIGNIN_PATHS);
      // The library's own line, then ccrc's, which names the library's word.
      expect(r.stderr).toMatch(/^ccgpt-auth: login-failed: the token exchange was refused/m);
      expect(r.stderr.trimEnd().split('\n').at(-1)).toMatch(
        /^ccrc codex: login-failed: .*\(login-failed\).*Retry with: ccrc codex login codex-a$/);
      expect(existsSync(join(home, AUTH_REL)), 'a failed sign-in wrote into the authDir').toBe(false);
      expect(r.stdout).not.toMatch(/logged in/);
    } finally {
      await srv.close();
    }
    // Another family's file: the library refuses before any request, and ccrc names its word.
    const foreign = await loginBox();
    mkdirSync(join(foreign, AUTH_REL), { recursive: true });
    const cred = join(foreign, AUTH_REL, 'auth.json');
    writeFileSync(cred, JSON.stringify({ OPENAI_API_KEY: 'fixture-key-not-a-secret', tokens: null }), { mode: 0o600 });
    const bytes = readFileSync(cred, 'utf8');
    const none = await fakeAuthServer(fullSignin(t));
    try {
      const r = await runCcrc(foreign, ['codex', 'login', 'codex-a'], { CCRC_CODEX_AUTH_BASE: none.base });
      expect(r.code).toBe(1);
      expect(none.requests).toEqual([]);
      expect(r.stderr).toMatch(/^ccrc codex: login-failed: .*\(foreign-family\)/m);
      expect(readFileSync(cred, 'utf8')).toBe(bytes);
    } finally {
      await none.close();
    }
  });

  it('A3: an abandoned LiteLLM marker (incomplete) is signed in again', async () => {
    // LiteLLM's device flow wrote {"device_code_requested_at": …} into auth.json
    // BEFORE it polled, so an abandoned one left a credential with no token.
    const home = await loginBox();
    mkdirSync(join(home, AUTH_REL), { recursive: true });
    writeFileSync(join(home, AUTH_REL, 'auth.json'),
      JSON.stringify({ device_code_requested_at: Math.floor(Date.now() / 1000) - 60 }), { mode: 0o600 });
    const t = issued();
    const srv = await fakeAuthServer(fullSignin(t));
    try {
      const r = await runCcrc(home, ['codex', 'login', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.code, r.stderr).toBe(0);
      expect(srv.requests.map((q) => q.path)).toEqual(SIGNIN_PATHS);
      expect(r.stdout).toMatch(/^ccgpt-auth: codex-a: signed-in$/m);
      const cred = credOf(home);
      expect(cred).toMatchObject({ access_token: t.access, refresh_token: t.refresh });
      expect(Object.keys(cred), 'the marker survived the sign-in').not.toContain('device_code_requested_at');
    } finally {
      await srv.close();
    }
  });

  it('A4: a NEW authDir and its auth.json are owner-only; an ADOPTED authDir keeps its mode', async () => {
    const home = await loginBox();
    const auth = join(home, AUTH_REL);
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      const r = await runCcrc(home, ['codex', 'login', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.code, r.stderr).toBe(0);
    } finally {
      await srv.close();
    }
    expect(statSync(auth).mode & 0o777).toBe(0o700);
    expect(statSync(join(auth, 'auth.json')).mode & 0o777).toBe(0o600);

    // Adoption is by path (spec §9.2): the library signs into a directory it
    // did not make and never re-modes it.
    const adopted = await loginBox();
    const dir = join(adopted, AUTH_REL);
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    const srv2 = await fakeAuthServer(fullSignin(issued()));
    try {
      const r = await runCcrc(adopted, ['codex', 'login', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv2.base });
      expect(r.code, r.stderr).toBe(0);
    } finally {
      await srv2.close();
    }
    expect(statSync(dir).mode & 0o777, 'login re-moded an adopted authDir').toBe(0o755);
    expect(statSync(join(dir, 'auth.json')).mode & 0o777).toBe(0o600);
  });

  it('A5: no library: auth-library-absent, nothing created', async () => {
    const home = await loginBox();
    fs.rmSync(authLib(home));
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      const r = await runCcrc(home, ['codex', 'login', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^ccrc codex: auth-library-absent: .*'ccrc update'/m);
      expect(r.stderr).not.toMatch(/runtime-absent|login-failed/);
      expect(srv.requests).toEqual([]);
      expect(existsSync(join(home, AUTH_REL))).toBe(false);
      expect(r.stdout).not.toMatch(/logged in/);
    } finally {
      await srv.close();
    }
  });

  // Review fix round 1 (T8-CQ-2): the library's stderr reaches the pane as it
  // is printed, not when the library exits, so its CCRC_CODEX_AUTH_BASE notice
  // still comes before its first request (Task 4's contract). A stand-in at the
  // library's path prints that notice and then waits for a file this case
  // writes only once the notice has arrived through `ccrc codex login`; a
  // login that held stderr until exit never lets it see the file.
  it('A5b: the library\'s stderr is relayed live, while it still runs, and the refusal word is still read', async () => {
    const home = await loginBox();
    fs.rmSync(authLib(home));
    writeFileSync(authLib(home), [
      'import os, sys, time',
      'sys.stderr.write("ccgpt-auth: CCRC_CODEX_AUTH_BASE is set: a stand-in notice\\n")',
      'sys.stderr.flush()',
      'go = os.path.join(os.environ["HOME"], "login-go")',
      'for _ in range(60):',
      '    if os.path.exists(go):',
      '        sys.stdout.write("ccgpt-auth: codex-a: signed-in\\n")',
      '        sys.exit(0)',
      '    time.sleep(0.1)',
      'sys.stderr.write("ccgpt-auth: login-failed: the go file never appeared\\n")',
      'sys.exit(1)',
      '',
    ].join('\n'), { mode: 0o755 });
    const go = join(home, 'login-go');
    const r = await runCcrc(home, ['codex', 'login', 'codex-a'], {}, (soFar) => {
      if (soFar.includes('CCRC_CODEX_AUTH_BASE is set') && !existsSync(go)) writeFileSync(go, '');
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^ccgpt-auth: codex-a: signed-in\nccrc codex: codex-a: logged in$/m);
    // A refusal still ends in login-failed naming the library's word, and that line comes last.
    fs.rmSync(go);
    writeFileSync(authLib(home), [
      'import sys',
      'sys.stderr.write("ccgpt-auth: needs-signin: a stand-in refusal\\n")',
      'sys.stderr.write("a trailing line that is not a refusal\\n")',
      'sys.exit(1)',
      '',
    ].join('\n'), { mode: 0o755 });
    const f = await runCcrc(home, ['codex', 'login', 'codex-a']);
    expect(f.code).toBe(1);
    const lines = f.stderr.trimEnd().split('\n');
    expect(lines.slice(0, 2)).toEqual(['ccgpt-auth: needs-signin: a stand-in refusal',
      'a trailing line that is not a refusal']);
    expect(lines.at(-1)).toMatch(/^ccrc codex: login-failed: .*\(needs-signin\) and exited 1 .*Retry with: ccrc codex login codex-a$/);
  });

  it('A6: a lane that is not codex-kind is refused before the library runs', async () => {
    const home = await loginBox();
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      const r = await runCcrc(home, ['codex', 'login', 'claude'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^ccrc codex: not-codex: /m);
      expect(srv.requests, 'the library signed in a lane that is not codex').toEqual([]);
    } finally {
      await srv.close();
    }
  });

  it('A7: login is behind the same role gate as the rest of ccrc codex', async () => {
    const home = await loginBox();
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      const r = await runCcrc(home, ['codex', 'login', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^ccrc codex: server-role: /m);
      expect(srv.requests).toEqual([]);
      expect(existsSync(join(home, AUTH_REL))).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('A8: what login writes is exactly what start\'s not-logged-in gate reads', async () => {
    const home = await loginBox();
    expect((await runCcrc(home, ['models', 'codex-a', 'init', 'codex'])).code).toBe(0);
    // BEFORE: no runtime is built in this box either, so a start that checked
    // the runtime before the credential would answer runtime-absent here — this
    // half pins the order. Start runs under the CLOSED_AUTH_BASE default.
    const before = await runCcrc(home, ['codex', 'start', 'codex-a']);
    expect(before.code).toBe(1);
    expect(before.stderr).toMatch(/^ccrc codex: not-logged-in: /m);
    expect(before.stderr).toContain('ccrc codex login codex-a');
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      expect((await runCcrc(home, ['codex', 'login', 'codex-a'], { CCRC_CODEX_AUTH_BASE: srv.base })).code).toBe(0);
    } finally {
      await srv.close();
    }
    // AFTER: the credential gate passes on what login left, and start stops at
    // the next gate — before any tier function, so no process is started.
    const after = await runCcrc(home, ['codex', 'start', 'codex-a']);
    expect(after.code).toBe(1);
    expect(after.stderr, 'start refused a lane login just signed in')
      .not.toMatch(/not-logged-in|needs-signin|credential-unusable/);
    expect(after.stderr).toMatch(/^ccrc codex: runtime-absent: /m);
  });

  it('A9: takes exactly one well-formed lane id, and a usage refusal exits 2', async () => {
    const home = await loginBox();
    const srv = await fakeAuthServer(fullSignin(issued()));
    try {
      // Exit 2, not 1: `ccrc codex` exits 2 on a usage refusal (ruling R3, the
      // `ccd/ccrc` header's rule). The first two rows are the ARITY, which is
      // `cmd_codex`'s parse (Task 5, ruling R18): `_codex_login` checks none, so
      // these rows pin that login rides that parse. The third is a malformed id,
      // which `_codex_row` answers as usage at rc 2 (Task 4), and which login
      // must pass on as it came.
      for (const argv of [['codex', 'login'], ['codex', 'login', 'codex-a', 'extra'],
        ['codex', 'login', 'NOT_AN_ID']]) {
        const r = await runCcrc(home, argv, { CCRC_CODEX_AUTH_BASE: srv.base });
        expect(r.code, argv.join(' ')).toBe(2);
        expect(r.stderr).toMatch(/^ccrc codex: usage: /m);
      }
      expect(srv.requests).toEqual([]);
    } finally {
      await srv.close();
    }
  });
});
