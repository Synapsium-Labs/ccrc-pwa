// `ccrc codex`, part: the bridge tier (D-6878). `ccrc-codex.test.ts` asked D-6856's allocator for more than the 500 ports
// it issues to one file, so its bridge-tier describe moved here unchanged; the shared fixtures are in `ccrcCodexFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { itLinux } from './platformFixtures.js';
import {
  alive, codexAuthDir, codexRoster, eventually, failUnitStop, fakeUnit, freePorts, laneAnswer,
  plantCodexBins, plantFakeRuntime, plantLaneConfig, portAccepts, psArgs,
  registerLaneCleanup, spawnListener, systemdRunArgv,
  trackChild,
} from './codexLaneFixture.js';
import { plantBackendCredential } from './codexAuthFixture.js';
import { BRIDGE_MODELS, writeBridgeCatalogue } from './codexBridgeFixture.js';
import { installCcrcCodexHooks, REPO, BASH, PY, env, box, type Result, lib, ccrc, laneDir, laneJson, bridgeCode, authLib } from './ccrcCodexFixture.js';

installCcrcCodexHooks();

// ── codex bridge Stage 2, Task 11: the `bridge` tier ─────────────────────────────────────────────────────────────
// A `direct` lane runs ONE tier, `bridge`: the shim file in `direct` mode, under the system `python3`, on the shim's
// port and unit, its key read in process from runtime.env (plan 2026-10-22, Task 11; spec 2026-10-15 §2.1, D18-D20).
// The two modes share that port and unit, so on a healthy lane the other mode's tier reads rc 2 (`listener-other-
// mode` or `unit-unproven`), which every walk reads as `not running` once the lane's own mode tier has answered 0 or
// 4 (`_codex_tier_is_other_mode`). Every bridge a case starts gets loopback upstream and auth bases (ghContainedEnv,
// forwarded by `_codex_start_tier`), and its refresher's first tick (60 s) never comes inside a case.
/** The `origin/main` commit wave 2 was cut from: the build a rollback returns to (plan, "Before Task 1"). */
const WAVE2_BASE = 'c5c3e9cdeae8f091e7dd2da195fc6ebc5c15dd2d';

describe.skipIf(!PY)('ccrc codex: the bridge tier (codex bridge Stage 2, Task 11)', () => {
  const PY_ABS = PY === null ? '' : fs.realpathSync(PY);
  interface BBox { home: string; proxyPort: number; litellmPort: number; shimFile: string }

  /** `ccrc codex <args>` as the launcher runs it, with a 20 s readiness bound. `drop` names variables taken out of the
   *  environment (never a case that starts a real process: a bridge always gets its loopback bases). */
  function cx(home: string, args: string[], extra: NodeJS.ProcessEnv = {}): Result {
    const r = spawnSync(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), 'codex', ...args], {
      env: env(home, { CCRC_CODEX_READY_S: '20', ...extra }), encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 150_000,
    });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }
  const statusJson = (home: string): Record<string, unknown> => {
    const r = cx(home, ['status', 'codex-a', '--json']);
    expect(r.code, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as Record<string, unknown>;
  };
  const tiersOf = (home: string): Record<string, { state: string; via: string | null; pid: number | null }> =>
    statusJson(home)['tiers'] as Record<string, { state: string; via: string | null; pid: number | null }>;
  const keyOf = (home: string): string =>
    /^LITELLM_MASTER_KEY=(sk-[0-9a-f]{48})$/m.exec(fs.readFileSync(join(laneDir(home, 'codex-a'), 'runtime.env'), 'utf8'))![1]!;
  const STOPPED = { state: 'stopped', via: null, pid: null };

  /** One lane, `codex-a`, in `mode` (default `direct`): the box's tree with a COPY of the package beside its ccrc
   *  (where `_codex_bridge_dir` names it, so a case may change it), the shipped shim and auth library placed, a class
   *  registry and lane.json through the real verb, a fresh backend credential, the fake runtime unless `runtime` is
   *  false, and a litellm.yaml on a `litellm` lane. Its cleanup is the real product stop. */
  async function bridgeBox(o: {
    userManager: boolean; mode?: 'litellm' | 'direct'; upstream?: 'backend' | 'siwc'; runtime?: boolean;
  }): Promise<BBox> {
    const home = box('ccrc-codex-bridge-', { userManager: o.userManager });
    const { shimFile } = plantCodexBins(home);
    fs.cpSync(join(REPO, 'ccd', 'codexbridge'), join(home, 'ccrc', 'ccd', 'codexbridge'),
      { recursive: true, filter: (src) => !src.includes('__pycache__') });
    const [proxyPort, litellmPort] = await freePorts(2);
    codexRoster(home, [{
      id: 'codex-a', proxyPort: proxyPort!, litellmPort: litellmPort!,
      ...(o.mode === 'litellm' ? {} : { bridge: 'direct' as const }),
      ...(o.upstream !== undefined ? { upstream: o.upstream } : {}),
    }]);
    if (o.runtime !== false) plantFakeRuntime(home);
    registerLaneCleanup(home, 'codex:codex-a', () => { cx(home, ['stop', 'codex-a']); });
    const init = ccrc(home, ['models', 'codex-a', 'init', 'codex']);
    expect(init.code, init.stderr).toBe(0);
    const authDir = join(home, codexAuthDir('codex-a'));
    fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
    plantBackendCredential(authDir);
    if (o.mode === 'litellm') plantLaneConfig(home, 'codex-a');
    return { home, proxyPort: proxyPort!, litellmPort: litellmPort!, shimFile };
  }

  /** A process whose command line is this lane's LiteLLM tier's (`--config <litellm.yaml>`), binding nothing: a
   *  retired tier still starting, held by `litellm.pid` (L16's shape, reparented through nohup so a stop reaps it). */
  async function plantRetiredLitellm(home: string): Promise<number> {
    const yaml = plantLaneConfig(home, 'codex-a');
    const plant = spawnSync(BASH, ['-c',
      'nohup "$0" -B -c "import time; time.sleep(600)" --config "$1" </dev/null >/dev/null 2>&1 & echo $!',
      PY!, yaml], { encoding: 'utf8' });
    const pid = Number(plant.stdout.trim());
    expect(pid > 1, plant.stderr).toBe(true);
    fs.writeFileSync(join(laneDir(home, 'codex-a'), 'litellm.pid'), `${pid}\n`);
    await eventually(() => psArgs(pid).includes(`--config ${yaml}`), 'the planted tier to exec');
    return pid;
  }

  // PLATFORM-ONLY: the subject is the unit arm (systemd-run's argv, the shim's unit name), and `_svc_have_user_manager`
  // answers 1 on darwin (D-3483), so darwin has no unit arm. Its nohup arm is the both-platform case below (D-6994).
  itLinux('a direct lane starts the bridge tier only, on the shim\'s port and unit, with the key read in process', async () => {
    const { home, proxyPort, shimFile } = await bridgeBox({ userManager: true });
    const catalogue = join(home, '.ccrc', 'models', 'codex-a.json');
    writeBridgeCatalogue(catalogue, BRIDGE_MODELS);
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const units = laneJson(home, 'codex-a')['units'] as { litellm: string; shim: string };
    expect(r.stdout).toBe(`ccrc codex: codex-a: bridge started (systemd ${units.shim})\n`);
    const runs = systemdRunArgv(home);
    expect(runs, 'one unit, the shim\'s name, and nothing for LiteLLM').toHaveLength(1);
    const argv = runs[0]!;
    expect(argv).toContain(`--unit=${units.shim}`);
    // The key never reaches the unit: no EnvironmentFile, no variable, no value.
    expect(argv.filter((x) => x.includes('EnvironmentFile'))).toEqual([]);
    expect(argv.join('\n')).not.toMatch(/LITELLM_MASTER_KEY|sk-[0-9a-f]{48}/);
    expect(argv).toEqual(expect.arrayContaining([
      '--setenv=CCGPT_BRIDGE=direct', '--setenv=CCGPT_ACCOUNT_ID=codex-a', `--setenv=CCGPT_PROXY_PORT=${proxyPort}`,
      `--setenv=CCGPT_BRIDGE_DIR=${join(home, 'ccrc', 'ccd', 'codexbridge')}`,
      `--setenv=CCGPT_LANE_DIR=${laneDir(home, 'codex-a')}`, `--setenv=CCRC_CODEX_AUTH_LIB=${authLib(home)}`,
      '--setenv=CCGPT_CCRC_VERSION=dev', `--setenv=CCGPT_CATALOGUE=${catalogue}`, `--setenv=HOME=${home}`,
    ]));
    const cmd = argv.slice(argv.indexOf('--') + 1);
    expect(path.isAbsolute(cmd[0]!), cmd[0]).toBe(true);
    expect(cmd.slice(1)).toEqual(['-I', shimFile, '--ccrc-bridge=direct', '--ccrc-lane=codex-a']);
    const lane = await laneAnswer(proxyPort);
    expect(lane?.status).toBe(200);
    expect(JSON.parse(lane!.body)).toEqual({ lane: 'codex-a', mode: 'direct' });
    // The key was read in process: refused without it, served with it.
    const url = `http://127.0.0.1:${proxyPort}/v1/models`;
    expect((await fetch(url, { signal: AbortSignal.timeout(5000) })).status).toBe(401);
    const ok = await fetch(url, { headers: { 'x-api-key': keyOf(home) }, signal: AbortSignal.timeout(5000) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { data: Array<{ id: string }> }).data.map((m) => m.id)).toEqual([...BRIDGE_MODELS]);
    const rec = JSON.parse(fs.readFileSync(join(laneDir(home, 'codex-a'), 'bridge.started'), 'utf8')) as Record<string, string>;
    expect(Object.keys(rec)).toEqual(['interpreter', 'code', 'bridge', 'mode']);
    expect(rec).toMatchObject({ interpreter: cmd[0], code: bridgeCode(shimFile, home), mode: 'direct' });
    expect(rec['bridge']).toMatch(/^[0-9a-f]{64}$/);
    for (const f of ['litellm.started', 'shim.started', 'litellm.pid', 'shim.pid']) {
      expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), f).toBe(false);
    }
  }, 120_000);

  // D-6994: the case above's nohup twin, on both platforms. With no user manager (darwin always, Linux here) the bridge
  // tier is a nohup child: its pid recorded, its argv the bridge's, the key out of `ps`, read in process. The
  // interpreter is taken from the record, never from `ps`, which may print another spelling of it (a framework
  // python3 re-execs its app bundle), so `ps` is matched on the argv's tail only.
  it('a direct lane starts the bridge tier only under nohup, its pid recorded and the key read in process', async () => {
    const { home, proxyPort, shimFile } = await bridgeBox({ userManager: false });
    const catalogue = join(home, '.ccrc', 'models', 'codex-a.json');
    writeBridgeCatalogue(catalogue, BRIDGE_MODELS);
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const pid = Number(/^ccrc codex: codex-a: bridge started \(nohup (\d+)\)\n$/.exec(r.stdout)?.[1]);
    expect(pid > 1, r.stdout).toBe(true);
    expect(fs.readFileSync(join(laneDir(home, 'codex-a'), 'bridge.pid'), 'utf8')).toBe(`${pid}\n`);
    expect(systemdRunArgv(home), 'no unit was started').toEqual([]);
    const ps = psArgs(pid);
    expect(ps, ps).toContain(` -I ${shimFile} --ccrc-bridge=direct --ccrc-lane=codex-a`);
    expect(ps).not.toMatch(/LITELLM_MASTER_KEY|sk-[0-9a-f]{48}/);
    const lane = await laneAnswer(proxyPort);
    expect(lane?.status).toBe(200);
    expect(JSON.parse(lane!.body)).toEqual({ lane: 'codex-a', mode: 'direct' });
    // The key was read in process: refused without it, served with it.
    const url = `http://127.0.0.1:${proxyPort}/v1/models`;
    expect((await fetch(url, { signal: AbortSignal.timeout(5000) })).status).toBe(401);
    const ok = await fetch(url, { headers: { 'x-api-key': keyOf(home) }, signal: AbortSignal.timeout(5000) });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { data: Array<{ id: string }> }).data.map((m) => m.id)).toEqual([...BRIDGE_MODELS]);
    const rec = JSON.parse(fs.readFileSync(join(laneDir(home, 'codex-a'), 'bridge.started'), 'utf8')) as Record<string, string>;
    expect(Object.keys(rec)).toEqual(['interpreter', 'code', 'bridge', 'mode']);
    expect(path.isAbsolute(rec['interpreter']!), rec['interpreter']).toBe(true);
    expect(rec).toMatchObject({ code: bridgeCode(shimFile, home), mode: 'direct' });
    expect(rec['bridge']).toMatch(/^[0-9a-f]{64}$/);
    for (const f of ['litellm.started', 'shim.started', 'litellm.pid', 'shim.pid']) {
      expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), f).toBe(false);
    }
  }, 120_000);

  itLinux('start refuses a running litellm tier on a direct lane', async () => {
    const { home } = await bridgeBox({ userManager: false });
    expect(lib(home, '_codex_runtime_env_ensure codex-a').code).toBe(0);
    const pid = await plantRetiredLitellm(home);
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^ccrc codex: retired-tier-running: codex-a runs in direct mode, and its litellm tier .*Nothing was started\.$/m);
    expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.pid')), 'a bridge was started beside it').toBe(false);
    expect(alive(pid), 'start stopped the retired tier (that is the stop\'s, and the switch\'s)').toBe(true);
  }, 120_000);

  it.each([false, true])('start, status and stop on a healthy direct lane do not misfire (user manager: %s)', async (um) => {
    const { home, proxyPort } = await bridgeBox({ userManager: um });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^ccrc codex: codex-a: bridge started \((systemd|nohup) [^)]+\)\n$/);
    const again = cx(home, ['start', 'codex-a']);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/^ccrc codex: codex-a: bridge adopted \((systemd|nohup) [^)]+\)\n$/);
    expect(again.stderr).toBe('');
    const st = statusJson(home);
    expect([st['mode'], st['upstream']]).toEqual(['direct', 'backend']);
    const tiers = st['tiers'] as Record<string, { state: string }>;
    expect(tiers['bridge']!.state).toBe('running');
    expect([tiers['shim'], tiers['litellm']]).toEqual([STOPPED, STOPPED]);
    const text = cx(home, ['status', 'codex-a']);
    expect(text.stdout).toMatch(/^ccrc codex: codex-a: bridge running \(/m);
    expect(text.stdout).not.toMatch(/FOREIGN|UNPROVEN|UNKNOWN/);
    const s = cx(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm not running, shim not running, bridge stopped\n');
    expect(s.stderr).toBe('');
    await eventually(async () => !(await portAccepts(proxyPort)), 'the bridge to stop listening');
  }, 120_000);

  it('a litellm lane\'s running shim is not a bridge', async () => {
    const { home } = await bridgeBox({ userManager: false, mode: 'litellm' });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^ccrc codex: codex-a: litellm started \(nohup \d+\), shim started \(nohup \d+\)\n$/);
    const st = statusJson(home);
    expect(st['mode']).toBe('litellm');
    const tiers = st['tiers'] as Record<string, { state: string }>;
    expect([tiers['litellm']!.state, tiers['shim']!.state]).toEqual(['running', 'running']);
    expect(tiers['bridge']).toEqual(STOPPED);
    const text = cx(home, ['status', 'codex-a']);
    expect(text.stdout).toMatch(/^ccrc codex: codex-a: bridge stopped$/m);
    expect(text.stdout).not.toMatch(/FOREIGN|UNPROVEN|UNKNOWN/);
    const s = cx(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim stopped, bridge not running\n');
    expect(s.stderr).toBe('');
  }, 120_000);

  it('today\'s build refuses a running bridge instead of adopting it', async () => {
    // The build a rollback returns to, read from the clone: FAIL, never skip, when it is absent.
    const has = spawnSync('git', ['-C', REPO, 'cat-file', '-e', `${WAVE2_BASE}^{commit}`], { encoding: 'utf8' });
    expect(has.status, `${WAVE2_BASE} is not in this clone: fetch it, this case never skips`).toBe(0);
    const { home, proxyPort } = await bridgeBox({ userManager: false });
    plantLaneConfig(home, 'codex-a');
    const d = laneDir(home, 'codex-a');
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const pid = Number(/^ccrc codex: codex-a: bridge started \(nohup (\d+)\)$/m.exec(r.stdout)?.[1]);
    expect(alive(pid), r.stdout).toBe(true);
    const old = spawnSync('git', ['-C', REPO, 'show', `${WAVE2_BASE}:ccd/ccrc`], { maxBuffer: 64 << 20 });
    expect(old.status, String(old.stderr)).toBe(0);
    const cur = join(home, 'ccrc', 'ccd', 'ccrc');
    fs.rmSync(cur);
    fs.writeFileSync(cur, old.stdout, { mode: 0o755 });
    try {
      const o = cx(home, ['start', 'codex-a']);
      expect(o.code, o.stdout).toBe(1);
      expect(o.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${proxyPort} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed\\. .*Nothing was started\\.$`, 'm'));
      for (const f of ['litellm.pid', 'shim.pid', 'litellm.started', 'shim.started']) expect(fs.existsSync(join(d, f)), f).toBe(false);
      const os = statusJson(home);
      expect((os['tiers'] as Record<string, { state: string }>)['shim']!.state).toBe('foreign');
      expect(alive(pid)).toBe(true);
    } finally {
      fs.rmSync(cur);
      fs.symlinkSync(join(REPO, 'ccd', 'ccrc'), cur);
    }
  }, 120_000);

  itLinux('the bridge\'s argv proves the bridge and not today\'s shim', async () => {
    const home = box('ccrc-codex-bridge-argv-');
    // The placed shim file is a sleeper here, so a process can hold a bridge's exact argv and serve nothing; and
    // `python3` on PATH is a fixture link, so the interpreter `_codex_python` names is not the one `ps` prints.
    const shim = join(home, '.local', 'bin', 'ccgpt-proxy.py');
    fs.writeFileSync(shim, 'import time\ntime.sleep(60)\n', { mode: 0o755 });
    fs.symlinkSync(PY_ABS, join(home, '.local', 'bin', 'python3'));
    const c = spawn(PY_ABS, ['-I', shim, '--ccrc-bridge=direct', '--ccrc-lane=codex-a'], { stdio: 'ignore' });
    trackChild(home, c);
    await eventually(() => psArgs(c.pid!).includes('--ccrc-bridge=direct'), 'the sleeper to exec');
    expect(psArgs(c.pid!).trim().startsWith(`${PY_ABS} -I ${shim} `), psArgs(c.pid!)).toBe(true);
    const r = lib(home, `for t in bridge shim; do _codex_pid_is_tier codex-a "$t" ${c.pid}; echo "$t=$?"; done`);
    expect(r.stdout, r.stderr).toBe('bridge=0\nshim=1\n');
    // The build a rollback returns to never proves it as its shim either.
    const old = spawnSync('git', ['-C', REPO, 'show', `${WAVE2_BASE}:ccd/ccrc`], { maxBuffer: 64 << 20 });
    expect(old.status, String(old.stderr)).toBe(0);
    const base = join(home, 'ccrc', 'ccd', 'ccrc-base');
    fs.writeFileSync(base, old.stdout, { mode: 0o755 });
    const b = spawnSync(BASH, ['-c', `. "${base}"; _codex_pid_is_tier codex-a shim ${c.pid}; echo "shim=$?"`],
      { env: env(home), encoding: 'utf8', timeout: 15_000 });
    expect(b.stdout, b.stderr).toBe('shim=1\n');
  });

  it('a changed package makes a running bridge stale', async () => {
    const { home } = await bridgeBox({ userManager: false });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const stale = (): string => lib(home, '_codex_tier_stale codex-a bridge; echo "rc=$?"').stdout;
    expect(stale()).toBe('rc=1\n');
    fs.appendFileSync(join(home, 'ccrc', 'ccd', 'codexbridge', 'stats.py'), '\n# fixture: the next release of the package\n');
    expect(stale()).toBe('rc=0\n');
  }, 120_000);

  // The whole-wave fix round (L2): the bridge is a direct lane's credential refresher and loads the auth library once,
  // for its whole life, so its record hashes the placed library as the litellm tier's does.
  it('a changed auth library makes a running bridge stale', async () => {
    const { home } = await bridgeBox({ userManager: false });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const stale = (): string => lib(home, '_codex_tier_stale codex-a bridge; echo "rc=$?"').stdout;
    expect(stale()).toBe('rc=1\n');
    fs.appendFileSync(authLib(home), '\n# fixture: the next release of the auth library\n');
    expect(stale()).toBe('rc=0\n');
  }, 120_000);

  // The whole-wave fix round (L5): `_codex_python` resolves python3 on the caller's PATH, so the same healthy bridge
  // can be recorded under another interpreter path than a later caller resolves. The record keeps it; the comparison
  // leaves it out. Its code and its package are still compared (the CONTROL).
  it('a bridge record that names another interpreter, with the same code and package, reads current', async () => {
    const { home } = await bridgeBox({ userManager: false });
    const now = lib(home, '_codex_started_json bridge');
    expect(now.code, now.stderr).toBe(0);
    const rec = JSON.parse(now.stdout) as Record<string, string>;
    const file = join(laneDir(home, 'codex-a'), 'bridge.started');
    const stale = (): string => lib(home, '_codex_tier_stale codex-a bridge; echo "rc=$?"').stdout;
    fs.writeFileSync(file, `${JSON.stringify({ ...rec, interpreter: join(home, 'elsewhere', 'python3') })}\n`);
    expect(stale()).toBe('rc=1\n');
    fs.writeFileSync(file, `${JSON.stringify({ ...rec, interpreter: join(home, 'elsewhere', 'python3'), code: '0'.repeat(64) })}\n`);
    expect(stale()).toBe('rc=0\n');
  }, 60_000);

  itLinux('stop is mode-blind', async () => {
    const { home, proxyPort } = await bridgeBox({ userManager: false });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    // A retired LiteLLM tier beside the bridge: stop stops both, whatever the mode says.
    const lit = await plantRetiredLitellm(home);
    const s = cx(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(0);
    expect(s.stdout).toBe('ccrc codex: codex-a: litellm stopped, shim not running, bridge stopped\n');
    await eventually(() => !alive(lit), 'the retired tier to exit');
    // A lane.json whose mode cannot be read: the stop walks bridge, shim, litellm and still stops the bridge.
    const again = cx(home, ['start', 'codex-a']);
    expect(again.code, again.stderr).toBe(0);
    const lj = join(laneDir(home, 'codex-a'), 'lane.json');
    fs.writeFileSync(lj, JSON.stringify({ ...laneJson(home, 'codex-a'), bridge: 'nope' }));
    const s2 = cx(home, ['stop', 'codex-a']);
    expect(s2.code, s2.stderr).toBe(0);
    expect(s2.stdout).toBe('ccrc codex: codex-a: litellm not running, shim not running, bridge stopped\n');
    await eventually(async () => !(await portAccepts(proxyPort)), 'the bridge to stop listening');
  }, 120_000);

  // The whole-wave fix round (LB-2): `_codex_stop_lane` runs each stop in its own `$( … )`, so it asks the lane's own
  // front tier again in its own shell, where the next stop's other-mode reading looks for it. A shim that answers as
  // this lane while no unit or pidfile of the lane holds it cannot be stopped (stop-failed), and the bridge tier on the
  // same port then reads not running, never a foreign listener ccrc left running.
  it('a front tier the stop could not end leaves its mate on the shared port not running, never named foreign', async () => {
    const { home, proxyPort } = await bridgeBox({ userManager: false, mode: 'litellm' });
    await spawnListener(home, { answer: 'json', lane: 'codex-a', port: proxyPort });
    const s = cx(home, ['stop', 'codex-a']);
    expect(s.code, s.stderr).toBe(1);
    expect(s.stdout).toBe('');
    expect(s.stderr).toMatch(/^ccrc codex: stop-failed: codex-a's shim tier answers as this lane, but neither a unit nor a pidfile of this lane's holds it/m);
    expect(s.stderr).not.toMatch(/bridge tier|left it running/);
  }, 60_000);

  it('the nohup stop waits at least DRAIN_S plus the margin', () => {
    const home = box('ccrc-codex-bridge-wait-');
    const r = lib(home, 'for t in litellm shim bridge; do printf "%s=%s\\n" "$t" "$(_codex_stop_wait_s "$t")"; done');
    expect(r.stdout, r.stderr).toBe('litellm=10\nshim=10\nbridge=10\n');
    // The package's own two constants, read from the package itself.
    const c = spawnSync(PY_ABS, ['-I', '-c', [
      'import sys', 'sys.dont_write_bytecode = True', 'sys.path.insert(0, sys.argv[1])',
      'from codexbridge import server', 'print(server.DRAIN_S + server.STOP_MARGIN_S)'].join('; '),
    join(REPO, 'ccd')], { encoding: 'utf8' });
    expect(c.status, c.stderr).toBe(0);
    expect(10).toBeGreaterThanOrEqual(Number(c.stdout.trim()));
    // The nohup arm's TERM-to-KILL wait is that function's answer, never a literal of its own.
    const m = /^_codex_stop_tier\(\) \{[\s\S]*?\n\}$/m.exec(fs.readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
    expect(m?.[0]).toMatch(/while kill -0 "\$pid" 2>\/dev\/null && \[ "\$n" -lt "\$\(_codex_stop_wait_s "\$tier"\)" \]; do sleep 1/);
  });

  it('status --json names the mode and the bridge\'s stats', async () => {
    const { home } = await bridgeBox({ userManager: false });
    expect(statusJson(home)['bridge']).toBeNull();
    const doc = {
      version: 1, lane: 'codex-a', since: '2026-10-20T00:00:00.000Z', startedAt: '2026-10-24T09:00:00.000Z',
      updatedAt: '2026-10-24T10:00:00.000Z', routes: {},
      refusals: { 'backend/model-6.1-alpha': { tokens: 410000, window: 400000, at: '2026-10-24T09:30:00.000Z', estimated: true } },
      outcomes: { ok: 3, '4xx': 1 }, names: {}, unexplained: { event: ['response.fx_new'] },
      usageHeaders: null, lastUpstreamRequestId: 'req_fx1',
    };
    fs.writeFileSync(join(laneDir(home, 'codex-a'), 'bridge.stats.json'), JSON.stringify(doc), { mode: 0o600 });
    const st = statusJson(home);
    expect([st['mode'], st['upstream']]).toEqual(['direct', 'backend']);
    expect(st['bridge']).toEqual({
      statsAt: doc.updatedAt, lastUpstreamRequestId: 'req_fx1', refusals: doc.refusals, outcomes: doc.outcomes,
      unexplained: doc.unexplained,
    });
    expect((st['tiers'] as Record<string, unknown>)['bridge']).toEqual(STOPPED);
    fs.writeFileSync(join(laneDir(home, 'codex-a'), 'bridge.stats.json'), 'not json');
    expect(statusJson(home)['bridge']).toBeNull();
  }, 60_000);

  it('removal reaps the bridge files, the markers and the recordings directory', async () => {
    const { home } = await bridgeBox({ userManager: false });
    const d = laneDir(home, 'codex-a');
    const files = ['bridge.started', 'bridge.pid', 'bridge-instructions', 'record-streams', 'liveprobe-allowed',
      'liveprobe.count', 'bridge.stats.json', 'reasoning.sqlite', 'reasoning.sqlite-wal', 'reasoning.sqlite-shm'];
    files.push('liveprobe.count.tmp', 'bridge.stats.json.tmp');   // a killed write_count's or stats flush's tmp (Z11)
    for (const f of files) fs.writeFileSync(join(d, f), 'fixture\n');
    fs.mkdirSync(join(d, 'recordings', 'nested'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(join(d, 'recordings', 'nested', 'r1.sse'), 'event: fixture\n\n');
    const r = lib(home, '_codex_reap_files codex-a; echo "rc=$?"');
    expect(r.stdout, r.stderr).toBe('rc=0\n');
    expect(fs.existsSync(d), fs.existsSync(d) ? fs.readdirSync(d).join(' ') : '').toBe(false);
    // A symlinked recordings directory, and what it points at, are left alone.
    const again = lib(home, '_codex_lane_json_ensure codex-a');
    expect(again.code, again.stderr).toBe(0);
    const elsewhere = join(home, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(join(elsewhere, 'keep.sse'), 'event: fixture\n\n');
    fs.symlinkSync(elsewhere, join(d, 'recordings'));
    const r2 = lib(home, '_codex_reap_files codex-a; echo "rc=$?"');
    expect(r2.stdout, r2.stderr).toBe('rc=0\n');
    expect(fs.lstatSync(join(d, 'recordings')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(join(elsewhere, 'keep.sse'), 'utf8')).toBe('event: fixture\n\n');
    expect(fs.existsSync(join(d, 'lane.json'))).toBe(false);
  }, 60_000);

  // PLATFORM-ONLY: the instrument is systemd-run's argv (the unit's --setenv pairs), and darwin's nohup arm leaves no
  // argv record of its pairs. The bridge arm's two forwards are pinned on both platforms by the recorder case
  // 'with both bases set, the bridge arm forwards both' below (D-6994).
  itLinux('a bridge started through ccrc codex start under ghContainedEnv gets both bases', async () => {
    const { home } = await bridgeBox({ userManager: true });
    const e = env(home);
    const up = e['CCGPT_BRIDGE_UPSTREAM_BASE'];
    const auth = e['CCRC_CODEX_AUTH_BASE'];
    expect(up, 'ghContainedEnv set no upstream base').toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    expect(auth, 'ghContainedEnv set no auth base').toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(systemdRunArgv(home)[0]).toEqual(expect.arrayContaining([
      `--setenv=CCGPT_BRIDGE_UPSTREAM_BASE=${up!}`, `--setenv=CCRC_CODEX_AUTH_BASE=${auth!}`]));
  }, 120_000);

  // `_codex_start_tier`'s platform helper as a recorder that starts nothing: it writes the argv it was handed to
  // `$HOME/svc-bridge`, so a case reads what would have run (fix round 1, I2; shared since fix round 2).
  const SVC_BRIDGE = '_svc_run_supervised() { printf \'%s\\n\' "$@" > "$HOME/svc-bridge"; echo "nohup 999999"; }';
  const startBridgeAlone = (home: string): Result => lib(home, `${SVC_BRIDGE}\n_codex_start_tier codex-a bridge`);

  it('with neither base set, neither is forwarded', async () => {
    // `_codex_start_tier` alone, its platform helper a recorder that starts nothing: with neither variable set, no
    // bridge may run at all (it would name the live endpoints), so nothing does.
    const { home } = await bridgeBox({ userManager: false });
    const r = lib(home, `${SVC_BRIDGE}\nunset CCGPT_BRIDGE_UPSTREAM_BASE CCRC_CODEX_AUTH_BASE\n_codex_start_tier codex-a bridge`);
    expect(r.code, r.stderr).toBe(0);
    const argv = fs.readFileSync(join(home, 'svc-bridge'), 'utf8').split('\n');
    const pairs = argv.slice(0, argv.indexOf('--'));
    expect(pairs).toContain('CCGPT_BRIDGE=direct');
    expect(pairs.filter((p) => /^(CCGPT_BRIDGE_UPSTREAM_BASE|CCRC_CODEX_AUTH_BASE)=/.test(p))).toEqual([]);
    fs.rmSync(join(laneDir(home, 'codex-a'), 'bridge.pid'), { force: true });
  }, 60_000);

  // D-6994: the mirror of the case above, on both platforms (the unit-argv case before SVC_BRIDGE is Linux-only):
  // with ghContainedEnv's two loopback bases set, the bridge arm hands both to its platform helper.
  it('with both bases set, the bridge arm forwards both', async () => {
    const { home } = await bridgeBox({ userManager: false });
    const e = env(home);
    expect(e['CCGPT_BRIDGE_UPSTREAM_BASE'], 'ghContainedEnv set no upstream base').toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    expect(e['CCRC_CODEX_AUTH_BASE'], 'ghContainedEnv set no auth base').toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    const r = startBridgeAlone(home);
    expect(r.code, r.stderr).toBe(0);
    const argv = fs.readFileSync(join(home, 'svc-bridge'), 'utf8').split('\n');
    expect(argv.slice(0, argv.indexOf('--'))).toEqual(expect.arrayContaining([
      `CCGPT_BRIDGE_UPSTREAM_BASE=${e['CCGPT_BRIDGE_UPSTREAM_BASE']!}`, `CCRC_CODEX_AUTH_BASE=${e['CCRC_CODEX_AUTH_BASE']!}`]));
    fs.rmSync(join(laneDir(home, 'codex-a'), 'bridge.pid'), { force: true });
  }, 60_000);

  // Fix round 1 (review I2): each refusal the bridge arm makes before it spawns, asked of `_codex_start_tier` alone,
  // with its platform helper a recorder (`SVC_BRIDGE`, above), so a deleted guard spawns (records) and the case goes red.
  it('the bridge arm refuses auth-library-absent with no auth library, and spawns nothing', async () => {
    const { home } = await bridgeBox({ userManager: false });
    fs.rmSync(authLib(home));
    const r = startBridgeAlone(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: auth-library-absent: .*codex-a's bridge would have no auth library.*Nothing was started\.$/m);
    expect(fs.existsSync(join(home, 'svc-bridge')), 'a bridge was spawned').toBe(false);
    expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.started'))).toBe(false);
  }, 60_000);

  it('the bridge arm refuses bridge-absent with no bridge package, and spawns nothing', async () => {
    const { home } = await bridgeBox({ userManager: false });
    fs.rmSync(join(home, 'ccrc', 'ccd', 'codexbridge', '__init__.py'));
    const r = startBridgeAlone(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: bridge-absent: the bridge package .*codexbridge is missing or unreadable.*Nothing was started\.$/m);
    expect(fs.existsSync(join(home, 'svc-bridge')), 'a bridge was spawned').toBe(false);
    expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.started'))).toBe(false);
  }, 60_000);

  it('the bridge arm refuses python-absent for a python3 that does not say its version, and spawns nothing', async () => {
    const { home } = await bridgeBox({ userManager: false });
    // Silent when asked its version, and the real one for everything else.
    fs.writeFileSync(join(home, '.local', 'bin', 'python3'),
      `#!/bin/bash\ncase "$*" in *version_info*) exit 0 ;; esac\nexec "${PY_ABS}" "$@"\n`, { mode: 0o755 });
    const r = startBridgeAlone(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: python-absent: .*python3 did not say its version.*Nothing was started\.$/m);
    expect(fs.existsSync(join(home, 'svc-bridge')), 'a bridge was spawned').toBe(false);
  }, 60_000);

  // Fix round 1 (review F5): the shared unit is live and its MainPID proves this lane's SHIM, whose port is still
  // silent (a litellm-mode front tier starting), so the direct lane's own bridge reads `unit-unproven`. The start
  // names the retired tier, never the generic unit-foreign sentence.
  itLinux('start on a direct lane names a starting shim under the shared unit retired-tier-running', async () => {
    const { home, shimFile } = await bridgeBox({ userManager: true });
    const units = laneJson(home, 'codex-a')['units'] as { litellm: string; shim: string };
    const c = spawn(PY_ABS, ['-B', '-c', 'import time; time.sleep(60)', shimFile, '--ccrc-lane=codex-a'], { stdio: 'ignore' });
    trackChild(home, c);
    await eventually(() => psArgs(c.pid!).includes(`${shimFile} --ccrc-lane=codex-a`), 'the stand-in shim to exec');
    fakeUnit(home, units.shim, { state: 'active', pid: c.pid! });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: retired-tier-running: codex-a runs in direct mode, and its shim tier \\(the other mode's\\) is running \\(pid ${c.pid}\\): .*Nothing was started\\.$`, 'm'));
    expect(r.stderr).not.toMatch(/unit-foreign/);
    expect(systemdRunArgv(home), 'a bridge was started beside it').toEqual([]);
    expect(alive(c.pid!), 'start stopped the retired tier').toBe(true);
  }, 120_000);

  // Fix round 2 (review R1): the mirror of the case above. On a litellm lane the shared unit is live and its MainPID
  // proves this lane's BRIDGE, whose port is still silent (a direct-mode front tier starting), so the lane's own shim
  // reads `unit-unproven`. The start names the bridge retired-tier-running, never the generic unit-foreign sentence.
  itLinux('start on a litellm lane names a starting bridge under the shared unit retired-tier-running', async () => {
    const { home, shimFile } = await bridgeBox({ userManager: true, mode: 'litellm' });
    const units = laneJson(home, 'codex-a')['units'] as { litellm: string; shim: string };
    const c = spawn(PY_ABS, ['-B', '-c', 'import time; time.sleep(60)', shimFile, '--ccrc-bridge=direct', '--ccrc-lane=codex-a'],
      { stdio: 'ignore' });
    trackChild(home, c);
    await eventually(() => psArgs(c.pid!).includes(`${shimFile} --ccrc-bridge=direct --ccrc-lane=codex-a`),
      'the stand-in bridge to exec');
    fakeUnit(home, units.shim, { state: 'active', pid: c.pid! });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(new RegExp(`^ccrc codex: retired-tier-running: codex-a runs in litellm mode, and its bridge tier \\(the other mode's\\) is running \\(pid ${c.pid}\\): .*Nothing was started\\.$`, 'm'));
    expect(r.stderr).not.toMatch(/unit-foreign/);
    expect(systemdRunArgv(home), 'a tier was started beside it').toEqual([]);
    expect(alive(c.pid!), 'start stopped the retired tier').toBe(true);
  }, 120_000);

  // Fix round 3 (review N1/Q1): the other mode's front tier RUNNING and ANSWERING on the shared port. The lane is
  // started in one mode, its roster row is switched to the other, and it is started again: the own front tier reads
  // `listener-other-mode`, its mate is measured on the spot (`--mate-now`), and start names it retired-tier-running,
  // by pid, in the one retired-tier sentence. The tier ccrc did identify is never "what it cannot identify".
  /** The lane's switch to `mode`, as the one writer would render it: the roster row, and the rendered lane.json's
   *  `bridge` word (`_codex_lane_json_state` checks that word's presence, not its value, so start renders nothing
   *  over it), plus the lane config a litellm lane reads. */
  function switchMode(home: string, proxyPort: number, litellmPort: number, mode: 'litellm' | 'direct'): void {
    codexRoster(home, [{ id: 'codex-a', proxyPort, litellmPort, ...(mode === 'direct' ? { bridge: 'direct' as const } : {}) }]);
    const lj = join(laneDir(home, 'codex-a'), 'lane.json');
    fs.writeFileSync(lj, JSON.stringify({ ...laneJson(home, 'codex-a'), bridge: mode }));
    if (mode === 'litellm') plantLaneConfig(home, 'codex-a');
  }
  itLinux('start on a direct lane names a running shim on the shared port retired-tier-running', async () => {
    const { home, proxyPort, litellmPort } = await bridgeBox({ userManager: false, mode: 'litellm' });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const shimPid = Number(/ shim started \(nohup (\d+)\)/.exec(r.stdout)?.[1]);
    expect(alive(shimPid), r.stdout).toBe(true);
    switchMode(home, proxyPort, litellmPort, 'direct');
    const o = cx(home, ['start', 'codex-a']);
    expect(o.code, o.stdout).toBe(1);
    expect(o.stdout).toBe('');
    expect(o.stderr).toMatch(new RegExp(`^ccrc codex: retired-tier-running: codex-a runs in direct mode, and its shim tier \\(the other mode's\\) is running \\(pid ${shimPid}\\): .*Nothing was started\\.$`, 'm'));
    expect(o.stderr).not.toMatch(/cannot identify/);
    expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.pid')), 'a bridge was started beside it').toBe(false);
    expect(alive(shimPid), 'start stopped the retired tier').toBe(true);
  }, 120_000);

  itLinux('start on a litellm lane names a running bridge on the shared port retired-tier-running', async () => {
    const { home, proxyPort, litellmPort } = await bridgeBox({ userManager: false });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const pid = Number(/^ccrc codex: codex-a: bridge started \(nohup (\d+)\)$/m.exec(r.stdout)?.[1]);
    expect(alive(pid), r.stdout).toBe(true);
    switchMode(home, proxyPort, litellmPort, 'litellm');
    const o = cx(home, ['start', 'codex-a']);
    expect(o.code, o.stdout).toBe(1);
    expect(o.stdout).toBe('');
    expect(o.stderr).toMatch(new RegExp(`^ccrc codex: retired-tier-running: codex-a runs in litellm mode, and its bridge tier \\(the other mode's\\) is running \\(pid ${pid}\\): .*Nothing was started\\.$`, 'm'));
    expect(o.stderr).not.toMatch(/cannot identify/);
    for (const f of ['litellm.pid', 'shim.pid']) {
      expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), `${f}: a tier was started beside it`).toBe(false);
    }
    expect(alive(pid), 'start stopped the retired tier').toBe(true);
  }, 120_000);

  // Its fallback: an answer in the bridge's shape for this lane, from a process nothing proves (the bridge's pidfile
  // moved aside), is no retired tier ccrc can name. The mate measure reads it unproven, so the start words the port as
  // `_codex_foreign_what` words `listener-unidentified` (the whole-wave fix round, R3-1): `port-foreign`, with its
  // "stop whatever holds port" remedy. `retired-tier-running` and its `ccrc codex stop` remedy are a proven mate's
  // only, because that stop is identity-gated and leaves an unproven listener running.
  itLinux('start on a litellm lane words an unproven bridge-shaped answer as a listener it cannot identify', async () => {
    const { home, proxyPort, litellmPort } = await bridgeBox({ userManager: false });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const pid = Number(/^ccrc codex: codex-a: bridge started \(nohup (\d+)\)$/m.exec(r.stdout)?.[1]);
    expect(alive(pid), r.stdout).toBe(true);
    switchMode(home, proxyPort, litellmPort, 'litellm');
    const pf = join(laneDir(home, 'codex-a'), 'bridge.pid');
    fs.renameSync(pf, `${pf}.aside`);
    try {
      const o = cx(home, ['start', 'codex-a']);
      expect(o.code, o.stdout).toBe(1);
      expect(o.stdout).toBe('');
      expect(o.stderr).toMatch(new RegExp(`^ccrc codex: port-foreign: port ${proxyPort} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed\\. ccrc never adopts or stops what it cannot identify\\. Stop whatever holds port ${proxyPort}, or give codex-a other ports in ~/\\.ccrc/accounts\\.json\\. Nothing was started\\.$`, 'm'));
      expect(o.stderr).not.toMatch(/retired-tier-running|ccrc codex stop/);
      for (const f of ['litellm.pid', 'shim.pid']) {
        expect(fs.existsSync(join(laneDir(home, 'codex-a'), f)), `${f}: a tier was started beside it`).toBe(false);
      }
      expect(alive(pid), 'start stopped the unproven holder').toBe(true);
    } finally {
      fs.renameSync(`${pf}.aside`, pf);   // the cleanup's stop reaps the bridge through its handle
    }
  }, 120_000);

  it('siwc is refused upstream-unsupported', async () => {
    const { home } = await bridgeBox({ userManager: false, upstream: 'siwc' });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: upstream-unsupported: .*siwc.*Stage 3.*Nothing was started\.$/m);
    expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.pid'))).toBe(false);
  }, 60_000);

  it('python3 below 3.9 is refused', async () => {
    const { home } = await bridgeBox({ userManager: false });
    // A python3 that says 3.8 when asked its version and is the real one for everything else (the auth library).
    fs.writeFileSync(join(home, '.local', 'bin', 'python3'),
      `#!/bin/bash\ncase "$*" in *version_info*) echo 3.8; exit 0 ;; esac\nexec "${PY_ABS}" "$@"\n`, { mode: 0o755 });
    expect(lib(home, '_codex_python >/dev/null; echo "rc=$?"').stdout).toBe('rc=1\n');
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc codex: python-too-old: .*3\.8.*3\.9/m);
    expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.pid'))).toBe(false);
  }, 60_000);

  it('a direct lane starts and reads not-stale with no LiteLLM runtime', async () => {
    const { home, proxyPort } = await bridgeBox({ userManager: false, runtime: false });
    expect(spawnSync(join(home, '.local', 'bin', 'ccgpt-runtime'), ['python'], { env: env(home) }).status,
      'the fixture planted a runtime').not.toBe(0);
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse((await laneAnswer(proxyPort))!.body)).toEqual({ lane: 'codex-a', mode: 'direct' });
    expect(lib(home, '_codex_tier_stale codex-a bridge; echo "rc=$?"').stdout).toBe('rc=1\n');
  }, 120_000);

  it('a new gateway key under a running bridge restarts the bridge tier', async () => {
    const { home, proxyPort } = await bridgeBox({ userManager: false });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const was = Number(/bridge started \(nohup (\d+)\)/.exec(r.stdout)?.[1]);
    fs.writeFileSync(join(laneDir(home, 'codex-a'), 'runtime.env'), 'LITELLM_MASTER_KEY=not-a-key\n', { mode: 0o600 });
    const again = cx(home, ['start', 'codex-a']);
    expect(again.code, again.stderr).toBe(0);
    const now = Number(/^ccrc codex: codex-a: bridge started \(nohup (\d+)\)$/m.exec(again.stdout)?.[1]);
    expect(now > 1 && now !== was, again.stdout).toBe(true);
    await eventually(() => !alive(was), 'the old bridge to exit');
    const ok = await fetch(`http://127.0.0.1:${proxyPort}/v1/models`,
      { headers: { 'x-api-key': keyOf(home) }, signal: AbortSignal.timeout(5000) });
    expect(ok.status, 'the bridge serving is not the one started with the new key').not.toBe(401);
  }, 120_000);

  // ── codex bridge Stage 2, Task 12: `ccrc codex switch <id> litellm|direct` ───────────────────────────────────────
  // Under the lane lock from start to end: stop the outgoing set (to direct: shim, then litellm; to litellm: bridge),
  // re-measure every tier down, record the mode (`account-op codex-mode`), re-render lane.json unconditionally and read
  // the new mode back, then start the incoming set through the start verb in a subshell. A failure before the record
  // writes nothing; a failure after it leaves the lane down, named, with the way back (plan 2026-10-22, Task 12).
  describe('ccrc codex switch (codex bridge Stage 2, Task 12)', () => {
    const rosterBytes = (home: string): string => fs.readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    const laneBytes = (home: string): string => fs.readFileSync(join(laneDir(home, 'codex-a'), 'lane.json'), 'utf8');
    const execOf = (home: string): Record<string, unknown> =>
      (JSON.parse(rosterBytes(home)) as { accounts: Array<{ id: string; exec: Record<string, unknown> }> })
        .accounts.find((a) => a.id === 'codex-a')!.exec;
    const pidOf = (out: string, tier: string): number =>
      Number(new RegExp(` ${tier} started \\(nohup (\\d+)\\)`).exec(out)?.[1]);
    function cxAsync(home: string, args: string[]): Promise<Result> {
      return new Promise((resolve) => {
        const c = spawn(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), 'codex', ...args], {
          env: env(home, { CCRC_CODEX_READY_S: '20' }), stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        c.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        c.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        c.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
      });
    }
    /** A `litellm` lane, started: both tiers running under `userManager`'s arm. */
    async function litellmUp(o: { userManager?: boolean; upstream?: 'backend' | 'siwc' } = {}): Promise<BBox & { start: string }> {
      const b = await bridgeBox({ userManager: o.userManager ?? false, mode: 'litellm',
        ...(o.upstream !== undefined ? { upstream: o.upstream } : {}) });
      const r = cx(b.home, ['start', 'codex-a']);
      expect(r.code, r.stderr).toBe(0);
      return { ...b, start: r.stdout };
    }

    itLinux('switch to direct stops both tiers, records the mode and starts the bridge', async () => {
      const { home, proxyPort, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      expect(alive(lit) && alive(shim), start).toBe(true);
      const r = cx(home, ['switch', 'codex-a', 'direct']);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^ccrc codex: codex-a: bridge started \(nohup \d+\)\nccrc codex: codex-a: switched from litellm to direct \(shim stopped, litellm stopped\)\n$/);
      expect(r.stderr).toBe('');
      await eventually(() => !alive(lit) && !alive(shim), 'the litellm-mode tiers to exit');
      expect(execOf(home)['bridge']).toBe('direct');
      expect(laneJson(home, 'codex-a')['bridge']).toBe('direct');
      expect(JSON.parse((await laneAnswer(proxyPort))!.body)).toEqual({ lane: 'codex-a', mode: 'direct' });
      const tiers = tiersOf(home);
      expect(tiers['bridge']!.state).toBe('running');
      expect([tiers['shim'], tiers['litellm']]).toEqual([STOPPED, STOPPED]);
    }, 120_000);

    itLinux('switch back deletes exec.bridge and starts both tiers', async () => {
      const { home, proxyPort } = await litellmUp();
      const before = rosterBytes(home);
      const d = cx(home, ['switch', 'codex-a', 'direct']);
      expect(d.code, d.stderr).toBe(0);
      const bridge = pidOf(d.stdout, 'bridge');
      expect(execOf(home)['bridge']).toBe('direct');
      const r = cx(home, ['switch', 'codex-a', 'litellm']);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^ccrc codex: codex-a: litellm started \(nohup \d+\), shim started \(nohup \d+\)\nccrc codex: codex-a: switched from direct to litellm \(bridge stopped\)\n$/);
      await eventually(() => !alive(bridge), 'the bridge to exit');
      expect(Object.hasOwn(execOf(home), 'bridge'), 'the switch back wrote the key instead of deleting it').toBe(false);
      expect(rosterBytes(home)).toBe(before);
      expect(laneJson(home, 'codex-a')['bridge']).toBe('litellm');
      expect(JSON.parse((await laneAnswer(proxyPort))!.body)).toEqual({ lane: 'codex-a' });
      const tiers = tiersOf(home);
      expect([tiers['litellm']!.state, tiers['shim']!.state]).toEqual(['running', 'running']);
      expect(tiers['bridge']).toEqual(STOPPED);
    }, 120_000);

    it('a foreign listener stops the switch before anything is written', async () => {
      const { home, proxyPort } = await bridgeBox({ userManager: false, mode: 'litellm' });
      const listener = await spawnListener(home, { answer: 'json', lane: 'codex-b', port: proxyPort });
      const [roster, lane] = [rosterBytes(home), laneBytes(home)];
      const r = cx(home, ['switch', 'codex-a', 'direct']);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(new RegExp(`port ${proxyPort} .*ccrc left it running`));
      expect(r.stderr).toMatch(/^ccrc codex: tier-foreign: the switch of codex-a to direct stopped at its shim tier, .*Nothing was written: codex-a is still a litellm lane\. .*$/m);
      expect([rosterBytes(home), laneBytes(home)]).toEqual([roster, lane]);
      expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.pid')), 'a bridge was started').toBe(false);
      expect(alive(listener.pid) && await portAccepts(proxyPort), 'the switch stopped the foreign listener').toBe(true);
    }, 60_000);

    // PLATFORM-ONLY: a tier that will not stop is the unit arm's state (failUnitStop steers the fake `systemctl stop`).
    // On darwin every tier is a nohup child whose stop ends in a re-proven SIGKILL, so there is no such tier to make,
    // and the switch-stopped branch is the same shell on both platforms (D-6994).
    itLinux('a tier that will not stop leaves the lane down and named', async () => {
      const { home, proxyPort, litellmPort } = await litellmUp({ userManager: true });
      const units = laneJson(home, 'codex-a')['units'] as { litellm: string; shim: string };
      const roster = rosterBytes(home);
      failUnitStop(home, units.litellm, true);
      try {
        const r = cx(home, ['switch', 'codex-a', 'direct']);
        expect(r.code).toBe(1);
        expect(r.stdout).toBe('');
        expect(r.stderr).toMatch(/^ccrc codex: stop-failed: codex-a's litellm tier is still running after the stop/m);
        expect(r.stderr).toMatch(/^ccrc codex: switch-stopped: the switch of codex-a to direct stopped because its litellm tier would not stop \(said above\)\. Nothing was written: codex-a is still a litellm lane\. It is DOWN: this switch stopped its shim tier, and nothing restarts it\. .*'ccrc codex start codex-a'.*$/m);
        expect(rosterBytes(home)).toBe(roster);
        expect(laneJson(home, 'codex-a')['bridge']).toBe('litellm');
        expect(await laneAnswer(proxyPort), 'the shim still answers').toBeNull();
        expect(await portAccepts(litellmPort), 'the litellm unit the manager would not stop').toBe(true);
        expect(systemdRunArgv(home).filter((a) => a.some((x) => x.includes('--ccrc-bridge'))), 'a bridge was started').toEqual([]);
      } finally {
        failUnitStop(home, units.litellm, false);
      }
    }, 120_000);

    itLinux('a tier still running after the stop stops the switch before anything is written', async () => {
      // Review Focus 5: a direct lane whose retired LiteLLM tier is running. The switch to litellm stops the outgoing
      // bridge (not running), then re-measures every tier, and the litellm tier still reads this lane's: starting the
      // incoming set would adopt it behind the operator's back, so nothing is written and nothing is started.
      const { home } = await bridgeBox({ userManager: false });
      expect(lib(home, '_codex_runtime_env_ensure codex-a').code).toBe(0);
      const lit = await plantRetiredLitellm(home);
      const [roster, lane] = [rosterBytes(home), laneBytes(home)];
      const r = cx(home, ['switch', 'codex-a', 'litellm']);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(new RegExp(`^ccrc codex: switch-stopped: the switch of codex-a to litellm stopped: its litellm tier still reads as this lane's \\(starting, pid ${lit}\\) after the stop of the outgoing tiers, .*Nothing was written: codex-a is still a direct lane\\. .*'ccrc codex stop codex-a'.*$`, 'm'));
      expect([rosterBytes(home), laneBytes(home)]).toEqual([roster, lane]);
      expect(alive(lit), 'the switch stopped the retired tier').toBe(true);
      expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'shim.pid')), 'a shim was started').toBe(false);
    }, 120_000);

    itLinux('switch to the mode it is in is already', async () => {
      const { home, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      const d = laneDir(home, 'codex-a');
      const before = [rosterBytes(home), laneBytes(home), fs.readFileSync(join(d, 'litellm.pid'), 'utf8'),
        fs.readFileSync(join(d, 'shim.pid'), 'utf8')];
      const r = cx(home, ['switch', 'codex-a', 'litellm']);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('ccrc codex: codex-a: already litellm (litellm running, shim running)\n');
      expect(r.stderr).toBe('');
      expect([rosterBytes(home), laneBytes(home), fs.readFileSync(join(d, 'litellm.pid'), 'utf8'),
        fs.readFileSync(join(d, 'shim.pid'), 'utf8')]).toEqual(before);
      expect(alive(lit) && alive(shim), 'the switch touched a running tier').toBe(true);
    }, 120_000);

    itLinux('switch takes the lane lock', async () => {
      const { home, start } = await litellmUp();
      const shim = pidOf(start, 'shim');
      // Another holder of the lane lock (`_codex_lock`'s file), for 4 s: the switch waits for it before it stops a tier.
      const holder = spawn('flock', [join(laneDir(home, 'codex-a'), '.lock'), 'sh', '-c', 'touch "$0"; sleep 4; touch "$1"',
        join(home, 'held'), join(home, 'released')], { stdio: 'ignore' });
      trackChild(home, holder);
      await eventually(() => fs.existsSync(join(home, 'held')), 'the holder to take the lane lock');
      const sw = cxAsync(home, ['switch', 'codex-a', 'direct']);
      await new Promise((res) => setTimeout(res, 2500));
      expect(fs.existsSync(join(home, 'released'))).toBe(false);
      expect(alive(shim), 'the switch stopped the shim while another process held the lane lock').toBe(true);
      expect(laneJson(home, 'codex-a')['bridge']).toBe('litellm');
      const r = await sw;
      expect(r.code, r.stderr).toBe(0);
      expect(fs.statSync(join(laneDir(home, 'codex-a'), 'bridge.started')).mtimeMs)
        .toBeGreaterThanOrEqual(fs.statSync(join(home, 'released')).mtimeMs);
    }, 120_000);

    // The whole-wave fix round (LB-1): start reads the lane's mode under the lane lock. A holder of that lock stands in
    // for a switch: while a start (the launcher's) waits on the lock, the holder's lane moves to `direct` (the roster
    // row and lane.json, as the switch's step 4 leaves them) and the holder brings the bridge up through the start verb
    // in a subshell, as the switch's step 5 does. Once it lets go, the start walks the mode the holder left and adopts
    // that bridge, never calling it a retired tier. Every wait is bounded: the holder's own (60 s for its go file),
    // the start's lock (`_codex_lock`: the readiness bound plus 30 s) and this case's `eventually`s.
    itLinux('a start that waits on the lane lock acts on the mode its holder left, and adopts the bridge it brought up', async () => {
      const { home, proxyPort, litellmPort } = await bridgeBox({ userManager: false, mode: 'litellm' });
      const lock = join(laneDir(home, 'codex-a'), '.lock');
      fs.writeFileSync(lock, '');
      const lockReal = fs.realpathSync(lock);
      /** A `flock` process with the lane's lock file open: a start blocked in `_codex_lock` (the holder's own
       *  `flock` has exited once it took the lock). */
      const waitingOnLock = (): boolean => fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)).some((p) => {
        try {
          if (fs.readFileSync(`/proc/${p}/comm`, 'utf8').trim() !== 'flock') return false;
          return fs.readdirSync(`/proc/${p}/fd`).some((fd) => {
            try { return fs.readlinkSync(`/proc/${p}/fd/${fd}`) === lockReal; } catch { return false; }
          });
        } catch { return false; }
      });
      const holder = spawn(BASH, ['-c', [
        `. "${join(home, 'ccrc', 'ccd', 'ccrc')}"`,
        '_codex_lock codex-a || exit 3',
        ': > "$HOME/held"',
        'for _ in $(seq 600); do [ -e "$HOME/go" ] && break; sleep 0.1; done',
        '[ -e "$HOME/go" ] || exit 4',
        '( _codex_cmd_start codex-a ) > "$HOME/holder-start.out" 2>&1',
        'exit $?',
      ].join('\n')], { env: env(home, { CCRC_CODEX_READY_S: '20' }), stdio: 'ignore' });
      trackChild(home, holder);
      const held = new Promise<number>((res) => { holder.once('close', (code) => res(code ?? -1)); });
      await eventually(() => fs.existsSync(join(home, 'held')), 'the holder to take the lane lock');
      const st = cxAsync(home, ['start', 'codex-a']);
      await eventually(waitingOnLock, 'the start to wait on the lane lock');
      switchMode(home, proxyPort, litellmPort, 'direct');
      fs.writeFileSync(join(home, 'go'), '');
      expect(await held, fs.existsSync(join(home, 'holder-start.out')) ? fs.readFileSync(join(home, 'holder-start.out'), 'utf8') : '').toBe(0);
      const pid = Number(/^ccrc codex: codex-a: bridge started \(nohup (\d+)\)$/m.exec(fs.readFileSync(join(home, 'holder-start.out'), 'utf8'))?.[1]);
      expect(alive(pid)).toBe(true);
      const r = await st;
      expect(r.stderr).not.toMatch(/retired-tier-running/);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe(`ccrc codex: codex-a: bridge adopted (nohup ${pid})\n`);
    }, 120_000);

    itLinux('switch refuses siwc', async () => {
      // The lane runs in litellm mode first (fix round 1, review M4): a refusal that came after the stop of the
      // outgoing set would leave its tiers dead and their pidfiles gone, which a lane with nothing running cannot show.
      const { home, start } = await litellmUp({ upstream: 'siwc' });
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      const d = laneDir(home, 'codex-a');
      const before = [rosterBytes(home), laneBytes(home), fs.readFileSync(join(d, 'litellm.pid'), 'utf8'),
        fs.readFileSync(join(d, 'shim.pid'), 'utf8')];
      const r = cx(home, ['switch', 'codex-a', 'direct']);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^ccrc codex: upstream-unsupported: .*siwc.*Stage 3.*Nothing was stopped, and the roster was not written\.$/m);
      // The whole-wave fix round (L1): the remedy names the act that re-renders lane.json from the roster.
      expect(r.stderr).toContain('Set the lane\'s upstream back to "backend" (or remove it) in ~/.ccrc/accounts.json, then run \'ccrc doctor --fix\' (it re-renders lane.json from the roster), then re-run.');
      expect([rosterBytes(home), laneBytes(home), fs.readFileSync(join(d, 'litellm.pid'), 'utf8'),
        fs.readFileSync(join(d, 'shim.pid'), 'utf8')]).toEqual(before);
      expect(alive(lit) && alive(shim), 'the switch stopped a tier before it refused').toBe(true);
      expect(fs.existsSync(join(d, 'bridge.pid'))).toBe(false);
    }, 120_000);

    itLinux('a failed start leaves the lane down and names the way back', async () => {
      const { home, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      // The incoming tier refuses: a python3 that says 3.8 when asked its version (the real one for everything else).
      fs.writeFileSync(join(home, '.local', 'bin', 'python3'),
        `#!/bin/bash\ncase "$*" in *version_info*) echo 3.8; exit 0 ;; esac\nexec "${PY_ABS}" "$@"\n`, { mode: 0o755 });
      const r = cx(home, ['switch', 'codex-a', 'direct']);
      expect(r.code).not.toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^ccrc codex: python-too-old: /m);
      expect(r.stderr).toMatch(/^ccrc codex: lane-down: codex-a is not serving: the switch to direct recorded the mode and rendered lane\.json, but the start of its direct tiers failed \(exit 1, said above\)\. Nothing this switch stopped was restarted, .*'ccrc codex status codex-a' shows what runs\. .*ccrc codex switch codex-a litellm$/m);
      await eventually(() => !alive(lit) && !alive(shim), 'the litellm-mode tiers to exit');
      expect(execOf(home)['bridge']).toBe('direct');
      expect(laneJson(home, 'codex-a')['bridge']).toBe('direct');
      expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.pid')), 'a bridge was started').toBe(false);
    }, 120_000);

    it('the switch re-renders lane.json and reads the new mode back', async () => {
      const { home } = await bridgeBox({ userManager: false, mode: 'litellm' });
      // lane.json is current (its bridge word present), so only an unconditional render can move it to the new mode.
      expect(lib(home, '_codex_lane_json_state codex-a').stdout).toBe('current\n');
      // A render that answers ok and writes nothing: the read-back names the mode lane.json still holds.
      const r = lib(home, '_models_node_locked() { printf \'{"ok":true,"wrote":{"lane":"fixture"}}\\n\'; }\ncmd_codex switch codex-a direct');
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^ccrc codex: lane-down: codex-a is DOWN: the switch to direct recorded the mode, but .*lane\.json reads litellm after it was rendered\. Nothing was started\. .*ccrc codex switch codex-a litellm$/m);
      expect(execOf(home)['bridge']).toBe('direct');
      expect(laneJson(home, 'codex-a')['bridge']).toBe('litellm');
      expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.pid')), 'a bridge was started').toBe(false);
      // The real render: lane.json moves, the new mode is read back, and the bridge starts.
      const ok = cx(home, ['switch', 'codex-a', 'direct']);
      expect(ok.code, ok.stderr).toBe(0);
      expect(laneJson(home, 'codex-a')['bridge']).toBe('direct');
      expect(lib(home, '_codex_lane_mode codex-a').stdout).toBe('direct\n');
      expect(ok.stdout).toMatch(/^ccrc codex: codex-a: bridge started \(nohup \d+\)\nccrc codex: codex-a: switched from litellm to direct \(shim not running, litellm not running\)\n$/);
    }, 120_000);
    // ── fix round 1 ──────────────────────────────────────────────────────────────────────────────────────────────────
    // F1/M2: the roster writers' lock. Step 4 rewrites the whole of accounts.json, so the switch waits for the file the
    // account verbs write it under (`_acct_marker_lock`'s), before it stops anything, and lets go before it spawns a
    // tier, which would otherwise inherit the descriptor and hold every account verb off.
    itLinux('switch takes the roster writers\' lock before it stops a tier, and lets go of it before it starts one', async () => {
      const { home, start } = await litellmUp();
      const shim = pidOf(start, 'shim');
      const lock = join(home, '.cc-sessions', '.account-placement.lock');
      fs.mkdirSync(path.dirname(lock), { recursive: true });
      const holder = spawn('flock', [lock, 'sh', '-c', 'touch "$0"; sleep 4; touch "$1"',
        join(home, 'held'), join(home, 'released')], { stdio: 'ignore' });
      trackChild(home, holder);
      await eventually(() => fs.existsSync(join(home, 'held')), 'the holder to take the roster writers\' lock');
      const sw = cxAsync(home, ['switch', 'codex-a', 'direct']);
      await new Promise((res) => setTimeout(res, 2500));
      expect(fs.existsSync(join(home, 'released'))).toBe(false);
      expect(alive(shim), 'the switch stopped the shim while an account verb held the roster writers\' lock').toBe(true);
      expect(Object.hasOwn(execOf(home), 'bridge'), 'the switch wrote the roster under another writer').toBe(false);
      const r = await sw;
      expect(r.code, r.stderr).toBe(0);
      expect(fs.statSync(join(laneDir(home, 'codex-a'), 'bridge.started')).mtimeMs)
        .toBeGreaterThanOrEqual(fs.statSync(join(home, 'released')).mtimeMs);
      expect(alive(pidOf(r.stdout, 'bridge')), r.stdout).toBe(true);
      const free = spawnSync('flock', ['-n', lock, 'true'], { stdio: 'ignore' });
      expect(free.status, 'the started bridge holds the roster writers\' lock').toBe(0);
    }, 120_000);

    // F3/M4: a record that fails after the outgoing set has stopped. `~/.ccrc` is made read-only, so the roster's
    // tmp cannot be created beside it and `account-op codex-mode` refuses `roster-write`.
    itLinux('a mode the roster will not take leaves the lane down and names the way back', async () => {
      const { home, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      const [roster, lane] = [rosterBytes(home), laneBytes(home)];
      const dot = join(home, '.ccrc');
      fs.chmodSync(dot, 0o555);
      let r: Result;
      try {
        r = cx(home, ['switch', 'codex-a', 'direct']);
      } finally {
        fs.chmodSync(dot, 0o755);
      }
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/\(roster-write\)$/m);
      expect(r.stderr).toMatch(/^ccrc codex: lane-down: codex-a is DOWN: the switch to direct stopped its shim tier and litellm tier, and the mode direct could not be recorded in ~\/\.ccrc\/accounts\.json \(said above\), so nothing was written\. Nothing was started\. Bring it back with: ccrc codex switch codex-a litellm$/m);
      await eventually(() => !alive(lit) && !alive(shim), 'the litellm-mode tiers to exit');
      expect([rosterBytes(home), laneBytes(home)]).toEqual([roster, lane]);
      expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'bridge.pid')), 'a bridge was started').toBe(false);
    }, 120_000);

    // I1: after a failed read-back the roster names the new mode and lane.json the old; a launcher's start brings the
    // old mode's tiers up from lane.json. The way back the lane-down line names must bring the roster back too, or the
    // next render would move lane.json under those running tiers.
    itLinux('the way back after a failed read-back records the old mode again under the running tiers', async () => {
      const { home } = await bridgeBox({ userManager: false, mode: 'litellm' });
      const roster = rosterBytes(home);
      const failed = lib(home, '_models_node_locked() { printf \'{"ok":true,"wrote":{"lane":"fixture"}}\\n\'; }\ncmd_codex switch codex-a direct');
      expect(failed.code, failed.stderr).toBe(1);
      expect(failed.stderr).toMatch(/^ccrc codex: lane-down: .*ccrc codex switch codex-a litellm$/m);
      expect(execOf(home)['bridge']).toBe('direct');
      expect(laneJson(home, 'codex-a')['bridge']).toBe('litellm');
      const s = cx(home, ['start', 'codex-a']);
      expect(s.code, s.stderr).toBe(0);
      const [lit, shim] = [pidOf(s.stdout, 'litellm'), pidOf(s.stdout, 'shim')];
      const r = cx(home, ['switch', 'codex-a', 'litellm']);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('ccrc codex: codex-a: already litellm (litellm running, shim running)\n');
      expect(Object.hasOwn(execOf(home), 'bridge'), 'the way back left the roster on the new mode').toBe(false);
      expect(rosterBytes(home)).toBe(roster);
      expect(laneJson(home, 'codex-a')['bridge']).toBe('litellm');
      expect(alive(lit) && alive(shim), 'the way back touched a running tier').toBe(true);
      // The next render keeps the lane whole.
      expect(lib(home, '_codex_row codex-a && _codex_lane_json_render && _codex_lane_mode codex-a').stdout).toBe('litellm\n');
    }, 120_000);

    // M1: a litellm lane half up (its litellm tier dead, its shim up), switched to litellm. Every own-mode tier is
    // measured before the outgoing bridge is asked about, so the shim's answer on the shared port reads as the lane's
    // own mode, and the refusal is step 3's, never a `tier-foreign` that calls the lane's own shim something else.
    itLinux('a half-up lane switched to its own mode is refused as running, never as foreign', async () => {
      const { home, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      process.kill(lit, 'SIGKILL');
      await eventually(() => !alive(lit), 'the litellm tier to exit');
      const [roster, lane] = [rosterBytes(home), laneBytes(home)];
      const r = cx(home, ['switch', 'codex-a', 'litellm']);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).not.toMatch(/tier-foreign|the tier of the lane's other mode/);
      expect(r.stderr).toMatch(/^ccrc codex: switch-stopped: the switch of codex-a to litellm stopped: its shim tier still reads as this lane's \(running, pid \d+\) after the stop of the outgoing tiers, .*Nothing was written: codex-a is still a litellm lane\. .*'ccrc codex stop codex-a'.*$/m);
      expect([rosterBytes(home), laneBytes(home)]).toEqual([roster, lane]);
      expect(alive(shim), 'the switch stopped the lane\'s own shim').toBe(true);
    }, 120_000);

    // M3 (c): a port of the incoming set held by something that is not this lane's is named as the start names it,
    // with its own remedy, never as "this lane's" tier that `ccrc codex stop` would stop.
    it('a port the incoming set needs, held by something else, stops the switch before anything is written', async () => {
      const { home, litellmPort } = await bridgeBox({ userManager: false });
      const listener = await spawnListener(home, { answer: 'json', lane: 'codex-b', port: litellmPort });
      const [roster, lane] = [rosterBytes(home), laneBytes(home)];
      const r = cx(home, ['switch', 'codex-a', 'litellm']);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).not.toMatch(/still reads as this lane's/);
      expect(r.stderr).toMatch(new RegExp(`^ccrc codex: tier-foreign: the switch of codex-a to litellm stopped at its litellm tier: port ${litellmPort} \\(codex-a's litellm tier\\) is held by .*\\. Nothing was written: codex-a is still a direct lane\\. Stop whatever holds port ${litellmPort}, .* Once that clears, re-run 'ccrc codex switch codex-a litellm'\\.$`, 'm'));
      expect([rosterBytes(home), laneBytes(home)]).toEqual([roster, lane]);
      expect(fs.existsSync(join(laneDir(home, 'codex-a'), 'shim.pid')), 'a shim was started').toBe(false);
      expect(alive(listener.pid), 'the switch stopped the foreign listener').toBe(true);
    }, 60_000);

    // ── fix round 2 ──────────────────────────────────────────────────────────────────────────────────────────────────
    // Quality R1: step 0's two refusals. Either one carrying on would run steps 1-4, the roster's read-modify-write
    // included, without the roster writers' lock.
    itLinux('a roster writers\' lock that cannot be opened stops the switch before anything is stopped or written', async () => {
      const { home, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      const reg = join(home, '.cc-sessions');
      const lock = join(reg, '.account-placement.lock');
      fs.mkdirSync(lock, { recursive: true });   // a directory: `exec {pfd}>>` cannot open it
      const [roster, lane] = [rosterBytes(home), laneBytes(home)];
      const r = cx(home, ['switch', 'codex-a', 'direct']);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe(`ccrc codex: roster-unwritable: ${lock} could not be opened, so this switch cannot be serialised `
        + `against the account verbs that write ~/.ccrc/accounts.json. Fix ${reg}, then re-run. Nothing was stopped or written.\n`);
      expect([rosterBytes(home), laneBytes(home)]).toEqual([roster, lane]);
      expect(alive(lit) && alive(shim), 'the switch stopped a tier without the roster writers\' lock').toBe(true);
    }, 120_000);

    itLinux('a roster writers\' lock held past the bound stops the switch as roster-busy, with nothing stopped or written', async () => {
      const { home, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      const lock = join(home, '.cc-sessions', '.account-placement.lock');
      fs.mkdirSync(path.dirname(lock), { recursive: true });
      // Fix round 3 (review M2/M3): flock(1) forks the `sh` (and its `sleep`), which inherit the lock fd, so the holder
      // runs in a process group of its own and the finally kills that whole group; signalling the flock pid alone
      // would leave the sh/sleep holding the fixture lock after the case.
      const holder = spawn('flock', [lock, 'sh', '-c', 'touch "$0"; sleep 60', join(home, 'held')],
        { stdio: 'ignore', detached: true });
      trackChild(home, holder);
      try {
        await eventually(() => fs.existsSync(join(home, 'held')), 'the holder to take the roster writers\' lock');
        const [roster, lane] = [rosterBytes(home), laneBytes(home)];
        // CCRC_CODEX_READY_S=1: the bound is 1 + 30 s.
        const r = cx(home, ['switch', 'codex-a', 'direct'], { CCRC_CODEX_READY_S: '1' });
        expect(r.code).toBe(1);
        expect(r.stdout).toBe('');
        expect(r.stderr).toBe(`ccrc codex: roster-busy: another roster writer (a 'ccrc account' verb, or a 'ccrc codex switch' of `
          + `this or another lane) has held the roster writers' lock (${lock}) for 31s without finishing, and this switch `
          + 'writes the roster. Re-run once it has ended. Nothing was stopped or written.\n');
        expect([rosterBytes(home), laneBytes(home)]).toEqual([roster, lane]);
        expect(alive(lit) && alive(shim), 'the switch stopped a tier without the roster writers\' lock').toBe(true);
      } finally {
        try { process.kill(-holder.pid!, 'SIGKILL'); } catch { /* the group has already gone */ }
      }
    }, 120_000);

    // Quality R2: the `already` arm's three failures. The lane runs its litellm tiers; each refusal leaves them
    // running and says nothing was stopped.
    itLinux('a split lane whose roster will not take its mode back is refused, never answered already', async () => {
      const { home, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      // I1's split: the roster names direct while lane.json, and the running tiers, are litellm.
      const json = JSON.parse(rosterBytes(home)) as { accounts: Array<{ id: string; exec: Record<string, unknown> }> };
      json.accounts.find((a) => a.id === 'codex-a')!.exec['bridge'] = 'direct';
      fs.writeFileSync(join(home, '.ccrc', 'accounts.json'), `${JSON.stringify(json, null, 2)}\n`);
      const [roster, lane] = [rosterBytes(home), laneBytes(home)];
      const dot = join(home, '.ccrc');
      fs.chmodSync(dot, 0o555);
      let r: Result;
      try {
        r = cx(home, ['switch', 'codex-a', 'litellm']);
      } finally {
        fs.chmodSync(dot, 0o755);
      }
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/\(roster-write\)$/m);
      expect(r.stderr).toMatch(/^ccrc codex: switch-stopped: codex-a runs its litellm tiers \(litellm running, shim running\), but its mode could not be recorded again in ~\/\.ccrc\/accounts\.json \(said above\)\. Nothing was stopped\. Fix what is named above, then re-run 'ccrc codex switch codex-a litellm'\.$/m);
      expect([rosterBytes(home), laneBytes(home)]).toEqual([roster, lane]);
      expect(execOf(home)['bridge']).toBe('direct');
      expect(alive(lit) && alive(shim), 'the refusal touched a running tier').toBe(true);
    }, 120_000);

    itLinux('an already lane whose lane.json cannot be rendered is refused, never answered already', async () => {
      const { home, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      const [roster, lane] = [rosterBytes(home), laneBytes(home)];
      const r = lib(home, '_models_node_locked() { return 1; }\ncmd_codex switch codex-a litellm');
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^ccrc codex: lane-unwritable: 'ccrc models' could not render /m);
      expect(r.stderr).toMatch(/^ccrc codex: switch-stopped: codex-a runs its litellm tiers \(litellm running, shim running\) and the roster records that mode, but lane\.json could not be rendered \(said above\)\. Nothing was stopped\. .*'ccrc codex switch codex-a litellm'\.$/m);
      expect([rosterBytes(home), laneBytes(home)]).toEqual([roster, lane]);
      expect(alive(lit) && alive(shim), 'the refusal touched a running tier').toBe(true);
    }, 120_000);

    itLinux('an already lane whose rendered lane.json reads another mode is refused, never answered already', async () => {
      const { home, start } = await litellmUp();
      const [lit, shim] = [pidOf(start, 'litellm'), pidOf(start, 'shim')];
      const roster = rosterBytes(home);
      // A render that answers ok and leaves lane.json naming the other mode.
      const r = lib(home, '_models_node_locked() { f="$(_codex_lane_dir codex-a)/lane.json"; jq \'.bridge = "direct"\' "$f" > "$f.x" && mv "$f.x" "$f"; '
        + 'printf \'{"ok":true,"wrote":{"lane":"fixture"}}\\n\'; }\ncmd_codex switch codex-a litellm');
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^ccrc codex: switch-stopped: codex-a runs its litellm tiers \(litellm running, shim running\) and the roster records that mode, but .*lane\.json reads direct after it was rendered\. Nothing was stopped\. .*'ccrc codex switch codex-a litellm'\.$/m);
      expect(rosterBytes(home)).toBe(roster);
      expect(alive(lit) && alive(shim), 'the refusal touched a running tier').toBe(true);
    }, 120_000);
  });

  // The closing round, C1: status words the state of start's fallback above as start does, because
  // `_codex_foreign_what` now measures the mate itself (`--mate-now`) for every consumer. A bridge-shaped answer for
  // this lane from a bridge that proves itself is the other mode's tier, with the `ccrc codex stop` remedy; with its
  // pidfile moved aside the mate is unproven, and the shim tier reads `port-foreign`'s listener ccrc cannot identify,
  // with the "stop whatever holds port" remedy.
  itLinux('status on a litellm lane words a bridge-shaped answer as the other mode\'s tier only while the bridge proves itself', async () => {
    const { home, proxyPort, litellmPort } = await bridgeBox({ userManager: false });
    const r = cx(home, ['start', 'codex-a']);
    expect(r.code, r.stderr).toBe(0);
    const pid = Number(/^ccrc codex: codex-a: bridge started \(nohup (\d+)\)$/m.exec(r.stdout)?.[1]);
    expect(alive(pid), r.stdout).toBe(true);
    switchMode(home, proxyPort, litellmPort, 'litellm');
    const proven = cx(home, ['status', 'codex-a']);
    expect(proven.code, proven.stderr).toBe(0);
    expect(proven.stdout).toMatch(new RegExp(`^ccrc codex: codex-a: shim FOREIGN — port ${proxyPort} \\(codex-a's shim tier\\) answers as codex-a's bridge, the tier of the lane's other mode, .*'ccrc codex stop codex-a' stops every tier of the lane`, 'm'));
    const pf = join(laneDir(home, 'codex-a'), 'bridge.pid');
    fs.renameSync(pf, `${pf}.aside`);
    try {
      const o = cx(home, ['status', 'codex-a']);
      expect(o.code, o.stderr).toBe(0);
      expect(o.stdout).toMatch(new RegExp(`^ccrc codex: codex-a: shim FOREIGN — port ${proxyPort} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed\\. Stop whatever holds port ${proxyPort}, or give codex-a other ports in ~/\\.ccrc/accounts\\.json\\. ccrc will neither adopt nor stop it\\.$`, 'm'));
      expect(o.stdout).not.toMatch(/the tier of the lane's other mode|ccrc codex stop/);
      expect(alive(pid), 'status stopped the unproven holder').toBe(true);
    } finally {
      fs.renameSync(`${pf}.aside`, pf);   // the cleanup's stop reaps the bridge through its handle
    }
  }, 120_000);
});
