// The test box, Part A, TB8 (D-7410, D-7558; spec §2.4, §2.5, §5, §6; plan #1874): the wrapper's remote arm.
//
// `ccd/ccrc-test` sends a run to the test box when the switch marker is in the registry and CCRC_TESTBOX_URL is set;
// the client (`agent/src/testbox/client.ts`, built here into a fixture release beside a link to `ccd/`) checks spec
// §2.4's rows in TESTBOX_FALLBACK's order, pushes the snapshot (TB3's `ccd/testbox-snap`) and streams the run back. A row
// that fails prints its reason first and last and runs today's local path; three refusals exit 75, nothing run.
//
// Fixtures only (plan §Global constraints, SAFETY): a fixture HOME per row (`project-a`), TB4's test service IN
// PROCESS on loopback behind a fixture URL with a fake system manager (each unit's work done here, as the current user,
// from the spec file the service wrote), a local bare mirror TB3's push reaches by path, and `systemctl`/`systemd-run`
// stubs as `ccrc-test-wrapper.test.ts` builds them. No real box, registry, release host or system manager is touched.
// The tools the version row measures are stubs on the fixture PATH (git is the real one, measured here).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { parseRunsLine, TESTBOX_FALLBACK, TESTBOX_PROTO, type RunsLogRow, type TestboxFallbackId, type TestboxRepoRow } from '../../shared/testbox.js';
import { TestboxService, type ServiceSettings } from '../../agent/src/testbox/service.js';
import { startTestboxServer, type RunningTestbox } from '../../agent/src/testbox/main.js';
import type { SystemManager, UnitEnd } from '../../agent/src/testbox/systemd.js';
import { SUBCOMMANDS, VALUE_FLAGS } from '../../agent/src/testbox/budget.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINUX = process.platform === 'linux';
const T = 90_000;
const ME = os.userInfo().username;
const DARWIN_SAYS = 'ccrc test: this box has no systemd user manager (macOS), so the run is not contained; the queue still applies';
const TOKEN = 'fixture-token';

// ---------------------------------------------------------------------------------------------------------------
// The fixture release: `ccd/` linked from the tree, `agent/dist` built from it, once for the file.
// ---------------------------------------------------------------------------------------------------------------

let RELEASE = '';
let WRAPPER = '';
let PARITY = '';
let CLIENT = '';
beforeAll(() => {
  RELEASE = mkTmp('tb8-release-');
  symlinkSync(path.join(REPO, 'ccd'), path.join(RELEASE, 'ccd'));
  mkdirSync(path.join(RELEASE, 'agent'), { recursive: true });
  writeFileSync(path.join(RELEASE, 'agent', 'package.json'), '{"type":"module"}\n');
  const tsc = path.join(REPO, 'agent', 'node_modules', '.bin', 'tsc');
  const r = spawnSync(tsc, ['-p', path.join(REPO, 'agent', 'tsconfig.json'), '--outDir', path.join(RELEASE, 'agent', 'dist')], { encoding: 'utf8' });
  expect(r.status, `the agent builds: ${r.stdout}${r.stderr}`).toBe(0);
  // The built tree imports its packages from agent/node_modules, as the release's does.
  symlinkSync(path.join(REPO, 'agent', 'node_modules'), path.join(RELEASE, 'agent', 'node_modules'));
  WRAPPER = path.join(RELEASE, 'ccd', 'ccrc-test');
  PARITY = path.join(RELEASE, 'ccd', 'testbox-parity');
  CLIENT = path.join(RELEASE, 'agent', 'dist', 'agent', 'src', 'testbox', 'client.js');
  expect(existsSync(CLIENT), 'client.js is built').toBe(true);
}, T);

// ---------------------------------------------------------------------------------------------------------------
// Stubs.
// ---------------------------------------------------------------------------------------------------------------

const SYSTEMCTL = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/systemctl.log"
if [ "$1" = --user ] && [ "$2" = show ]; then
  if [ "$4" = -p ] && [ "$5" = LoadState ] && [ "$6" = --value ]; then echo loaded; exit 0; fi
  exit 0
fi
if [ "$1" = --user ] && [ "$2" = stop ]; then
  u="\${3%.scope}"; [ -f "$HOME/$u.pids" ] && while read -r p; do kill -KILL "$p" 2>/dev/null; done < "$HOME/$u.pids"; exit 0
fi
exit 0
`;
const SYSTEMD_RUN = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/systemd-run.log"
for a in "$@"; do case "$a" in --unit=*) echo $$ >> "$HOME/\${a#--unit=}.pids" ;; --) break ;; esac; done
while [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done
shift
exec "$@"
`;
/** The fixture command head, local and on the box: each named test file (all of test/ when none is named) passes,
 *  or fails when it says FAIL; ENV prints the names the run sees; HOLD holds until killed; SKIP-ON-BOX skips its
 *  second test where VITEST_MAX_WORKERS is set (the box's run sets it, the fixture session does not). It writes vitest's
 *  JSON report when given --outputFile.json=, and junit on stdout for --reporter=junit. */
const VITEST = `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
let out = null, junit = false; const files = [];
for (const a of args) {
  if (a.startsWith('--outputFile.json=')) out = a.slice('--outputFile.json='.length);
  else if (a === '--reporter=junit') junit = true;
  else if (/\\.test\\.[a-z]+$/.test(a)) files.push(a);
}
const list = files.length ? files : fs.readdirSync('test').filter((n) => /\\.test\\./.test(n)).sort().map((n) => 'test/' + n);
const results = []; const cases = []; let failed = false;
for (const f of list) {
  const body = fs.readFileSync(f, 'utf8');
  if (body.includes('ENV')) process.stdout.write('ENV ' + JSON.stringify(Object.keys(process.env).sort()) + '\\n');
  if (body.includes('HOLD')) { process.stdout.write('HOLDING ' + f + '\\n'); setInterval(() => {}, 1000); return; }
  const fail = body.includes('FAIL');
  const skip = body.includes('SKIP-ON-BOX') && !!process.env.VITEST_MAX_WORKERS;
  if (fail) failed = true;
  process.stdout.write((fail ? 'FAIL ' : 'PASS ') + f + '\\n');
  results.push({ name: path.resolve(f), status: fail ? 'failed' : 'passed',
    assertionResults: [{ fullName: f + ' t1', status: fail ? 'failed' : 'passed' }] });
  cases.push('<testcase classname="' + f + '" name="t1">' + (fail ? '<failure/>' : '') + '</testcase>');
  cases.push('<testcase classname="' + f + '" name="t2">' + (skip ? '<skipped/>' : '') + '</testcase>');
}
if (out) fs.writeFileSync(out, JSON.stringify({ testResults: results }));
if (junit) process.stdout.write('<testsuites>' + cases.join('') + '</testsuites>\\n');
process.exit(failed ? 1 : 0);
`;
/** npm: its version, and \`ci\` as a lockfile install of the fixture (the command head, and the hidden lockfile). */
const NPM = `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$HOME/commands.log"
case "$1" in
  --version) echo 10.9.0 ;;
  ci) mkdir -p node_modules/.bin && cp "$HOME/fixture-vitest" node_modules/.bin/vitest && chmod +x node_modules/.bin/vitest \\
        && node -e 'const fs=require("fs");const l=JSON.parse(fs.readFileSync("package-lock.json","utf8"));fs.writeFileSync("node_modules/.package-lock.json",JSON.stringify({name:l.name,packages:Object.fromEntries(Object.entries(l.packages).filter(([k])=>k!==""))}))' ;;
esac
`;
const versionStub = (line: string): string => `#!/bin/sh\necho '${line}'\n`;

const gitVersion = (): string => {
  const out = spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout;
  return (/\d+(?:\.\d+)*/.exec(out) ?? ['0'])[0];
};
const boxTools = (over: Partial<Record<string, string>> = {}) => ({
  node: process.versions.node, npm: '10.9.0', tmux: '3.4', git: gitVersion(), python3: '3.12.3', chrome: '131.0.6778.85', ...over,
});

// ---------------------------------------------------------------------------------------------------------------
// The fake system manager: each unit's work, done here, from the spec file the service wrote.
// ---------------------------------------------------------------------------------------------------------------

function readSpec(file: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const rec of readFileSync(file, 'utf8').split('\0').slice(1)) {
    if (rec === '') continue;
    out.set(rec[0]!, [...(out.get(rec[0]!) ?? []), rec.slice(1)]);
  }
  return out;
}
const one = (s: Map<string, string[]>, tag: string): string => s.get(tag)?.[0] ?? '';

function sh(file: string, args: readonly string[], opts: { cwd?: string; env: NodeJS.ProcessEnv }): Promise<{ status: number; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn(file, [...args], { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr!.on('data', (d: Buffer) => { err += d.toString(); });
    c.on('close', (code) => resolve({ status: code ?? 1, stderr: err }));
    c.on('error', () => resolve({ status: 1, stderr: 'spawn failed' }));
  });
}
const until = async (what: string, p: () => boolean, ms = 30_000): Promise<void> => {
  const t0 = Date.now();
  while (!p()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

class FakeManager implements SystemManager {
  readonly log: string[] = [];
  private readonly running = new Map<string, ChildProcess>();
  constructor(private readonly root: string, private readonly flags: string, private readonly gitEnv: NodeJS.ProcessEnv) {}
  private spec(k: string): Map<string, string[]> { return readSpec(path.join(this.root, 'specs', k)); }

  async run(unit: string): Promise<UnitEnd> {
    this.log.push(unit);
    const m = /^ccrc-testbox-(prepare|run|clean)@([0-9]+)\.service$/.exec(unit);
    if (m === null) return { exit: 1, result: 'exit-code' };
    const [, kind, k] = m as unknown as [string, string, string];
    const out = path.join(this.root, 'out', k);
    const s = this.spec(k);
    const runDir = one(s, 'D');
    if (kind === 'prepare') {
      const err = path.join(out, 'prepare.stderr');
      if (existsSync(path.join(this.flags, 'prepare-hold'))) {
        writeFileSync(path.join(this.flags, 'prepare-started'), '');
        await until('the prepare release', () => existsSync(path.join(this.flags, 'prepare-release')), 60_000);
      }
      if (existsSync(path.join(this.flags, 'prepare-fail'))) {
        writeFileSync(err, readFileSync(path.join(this.flags, 'prepare-fail')));
        return { exit: 1, result: 'exit-code' };
      }
      const co = path.join(runDir, 'checkout');
      const id = one(s, 'R');
      const mirror = one(s, 'G');
      const ref = (s.get('H') ?? []).includes('snap') ? 'snap' : 'head';
      for (const step of [['clone', '-q', '--no-checkout', mirror, co], ['-C', co, 'fetch', '-q', mirror, `+refs/ccrc-test/${id}/*:refs/ccrc-test/${id}/*`],
        ['-C', co, 'checkout', '-q', '--detach', `refs/ccrc-test/${id}/${ref}`]]) {
        const r = await sh('git', step, { env: this.gitEnv });
        if (r.status !== 0) { writeFileSync(err, `test box: prepare failed (git ${step[0] === '-C' ? step[2] : step[0]}: ${r.stderr.trim()})\n`); return { exit: 1, result: 'exit-code' }; }
      }
      for (const n of readdirSync(co)) {
        if (!existsSync(path.join(co, n, 'package.json'))) continue;
        mkdirSync(path.join(co, n, 'node_modules', '.bin'), { recursive: true });
        writeFileSync(path.join(co, n, 'node_modules', '.bin', 'vitest'), VITEST, { mode: 0o755 });
      }
      mkdirSync(path.join(runDir, 'home'), { recursive: true });
      writeFileSync(err, '');
      return { exit: 0, result: 'success' };
    }
    if (kind === 'run') {
      const argv = s.get('A') ?? [];
      const env = Object.fromEntries((s.get('E') ?? []).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
      const o = openSync(path.join(out, 'stdout'), 'w');
      const e = openSync(path.join(out, 'stderr'), 'w');
      const c = spawn(argv[0]!, argv.slice(1), { cwd: one(s, 'C'), env, stdio: ['ignore', o, e], detached: true });
      closeSync(o); closeSync(e);
      this.running.set(unit, c);
      return new Promise((resolve) => {
        c.on('exit', (code, sig) => { this.running.delete(unit); resolve(code === null ? { exit: 128 + (os.constants.signals[sig!] ?? 0), result: 'signal' } : { exit: code, result: code === 0 ? 'success' : 'exit-code' }); });
        c.on('error', () => { this.running.delete(unit); resolve({ exit: 127, result: 'exit-code' }); });
      });
    }
    const results = one(s, 'O');
    mkdirSync(results, { recursive: true });
    const report = path.join(runDir, 'report.json');
    if (existsSync(report)) { copyFileSync(report, path.join(results, 'report.json')); writeFileSync(path.join(results, 'report.status'), 'ok\n'); }
    else writeFileSync(path.join(results, 'report.status'), 'missing\n');
    rmSync(runDir, { recursive: true, force: true });
    return { exit: 0, result: 'success' };
  }

  async stop(unit: string): Promise<void> {
    this.log.push(`stop ${unit}`);
    const c = this.running.get(unit);
    if (c?.pid !== undefined) { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ } }
  }

  async active(unit: string): Promise<boolean> { return this.running.has(unit); }
}

// ---------------------------------------------------------------------------------------------------------------
// The world: a session's clone of project-a, its HOME, the mirror, the service.
// ---------------------------------------------------------------------------------------------------------------

interface WorldOpts {
  /** The service's repository row name (default `project-a`). */
  rowName?: string;
  probeOk?: boolean;
  tools?: Partial<Record<string, string>>;
  /** More `KEY=value` lines of the session's ~/.ccrc/ccrc.env. */
  settings?: Record<string, string>;
  /** The switch marker in the registry (default present). */
  marker?: boolean;
  /** Where CCRC_TESTBOX_URL points: the service, a closed port, a fake box answering this status, or unset. */
  url?: 'service' | 'closed' | 'none' | { fakeStatus: Record<string, unknown> };
  /** The session's server/ has no node_modules. */
  noNodeModules?: boolean;
}

interface World {
  root: string;
  home: string;
  clone: string;
  pkg: string;
  mirror: string;
  boxRoot: string;
  flags: string;
  env: NodeJS.ProcessEnv;
  svc: TestboxService;
  mgr: FakeManager;
  server: RunningTestbox | null;
  fake: WebSocketServer | null;
  port: number;
  git: (cwd: string, ...a: string[]) => string;
  restart: () => Promise<void>;
}
const worlds: World[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) {
    writeFileSync(path.join(w.flags, 'prepare-release'), '');
    await w.server?.close().catch(() => undefined);
    await new Promise<void>((r) => (w.fake === null ? r() : w.fake.close(() => r())));
    await w.svc.idle();
  }
});

const LOCK = { name: 'server', lockfileVersion: 3, requires: true, packages: { '': { name: 'server' }, 'node_modules/left-pad': { version: '1.3.0', integrity: 'sha512-fixture130' } } };

async function world(o: WorldOpts = {}): Promise<World> {
  const root = mkTmp('tb8-');
  const home = path.join(root, 'home');
  const bin = path.join(home, 'bin');
  const flags = path.join(root, 'flags');
  for (const d of [home, bin, flags, path.join(home, '.ccrc'), path.join(home, '.cc-sessions')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = fixture\n\temail = fixture@testbox.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgSign = false\n[protocol "file"]\n\tallow = always\n');
  writeFileSync(path.join(bin, 'systemctl'), SYSTEMCTL, { mode: 0o755 });
  writeFileSync(path.join(bin, 'systemd-run'), SYSTEMD_RUN, { mode: 0o755 });
  writeFileSync(path.join(bin, 'npm'), NPM, { mode: 0o755 });
  writeFileSync(path.join(bin, 'tmux'), versionStub('tmux 3.4'), { mode: 0o755 });
  writeFileSync(path.join(bin, 'python3'), versionStub('Python 3.12.3'), { mode: 0o755 });
  writeFileSync(path.join(bin, 'chrome'), versionStub('Google Chrome for Testing 131.0.6778.85'), { mode: 0o755 });
  symlinkSync(process.execPath, path.join(bin, 'node'));
  writeFileSync(path.join(home, 'fixture-vitest'), VITEST, { mode: 0o755 });
  const baseEnv: NodeJS.ProcessEnv = { PATH: `${bin}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, HOME: home, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', TMPDIR: process.env['TMPDIR'] ?? '/tmp' };
  const git = (cwd: string, ...a: string[]): string => {
    const r = spawnSync('git', a, { cwd, env: baseEnv, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  const upstream = path.join(root, 'project-a.git');
  git(root, 'init', '-q', '--bare', upstream);
  const seed = path.join(root, 'seed');
  git(root, 'clone', '-q', upstream, seed);
  mkdirSync(path.join(seed, 'server', 'test'), { recursive: true });
  writeFileSync(path.join(seed, '.gitignore'), 'node_modules/\n');
  writeFileSync(path.join(seed, 'server', 'package.json'), '{"name":"server","private":true}\n');
  writeFileSync(path.join(seed, 'server', 'package-lock.json'), `${JSON.stringify(LOCK, null, 2)}\n`);
  writeFileSync(path.join(seed, 'server', 'test', 'a.test.ts'), 'pass\n');
  writeFileSync(path.join(seed, 'server', 'test', 'b.test.ts'), 'FAIL\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-qm', 'c1');
  git(seed, 'push', '-q', 'origin', 'main');
  const mirror = path.join(root, 'mirrors', 'project-a.git');
  mkdirSync(path.dirname(mirror), { recursive: true });
  git(root, 'clone', '-q', '--bare', upstream, mirror);
  const clone = path.join(root, 'project-a');
  git(root, 'clone', '-q', upstream, clone);
  const pkg = path.join(clone, 'server');
  if (!o.noNodeModules) {
    mkdirSync(path.join(pkg, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(path.join(pkg, 'node_modules', '.bin', 'vitest'), VITEST, { mode: 0o755 });
    writeFileSync(path.join(pkg, 'node_modules', '.bin', 'other-tool'), '#!/bin/sh\necho other-tool ran\nexit 4\n', { mode: 0o755 });
    writeFileSync(path.join(pkg, 'node_modules', '.package-lock.json'), JSON.stringify({ name: 'server', packages: { 'node_modules/left-pad': LOCK.packages['node_modules/left-pad'] } }));
  }

  // The box: TB4's service with the fake manager, on loopback.
  const boxRoot = path.join(root, 'box');
  const s: ServiceSettings = {
    root: boxRoot, workers: 2, runTmpdir: '/tmp', toolsDir: path.join(boxRoot, 'tools'), envForward: ['CCRC_HISTORY_BASE', 'CCRC_LEDGER_BASE'],
    runUserPrefix: 'ccrc-tb-', reportMaxBytes: 1 << 20, serviceUser: ME, runs: 2, sessionRuns: 1, logTail: 5, retentionMs: 3_600_000, outputDrainMs: 50,
  };
  for (let k = 1; k <= s.runs; k++) mkdirSync(path.join(boxRoot, 'runs', String(k)), { recursive: true });
  mkdirSync(path.join(s.toolsDir, 'current', 'bin'), { recursive: true });
  symlinkSync(process.execPath, path.join(s.toolsDir, 'current', 'bin', 'node'));
  const row: TestboxRepoRow = {
    name: o.rowName ?? 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: mirror,
    packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest', 'npm test'] }],
    buildOutputs: [], systemTools: [],
  };
  const mgr = new FakeManager(boxRoot, flags, baseEnv);
  const svc = new TestboxService({
    settings: s, rows: [row], sys: mgr, probe: async () => (o.probeOk === false ? { ok: false, detail: 'cp: no reflink here' } : { ok: true }),
    mirror: { fetch: async () => ({ status: 0, stdout: '', stderr: '', killed: false }), runIds: async () => [], deleteRefs: async () => undefined, gc: async () => ({ status: 0, stdout: '', stderr: '', killed: false }) },
    now: () => Date.now(), chrome: path.join(s.toolsDir, 'current', 'chrome'), release: 'v1.2.3', serviceVersion: '1.2.3', tools: () => boxTools(o.tools) as never,
  });
  await svc.start();
  let server: RunningTestbox | null = null;
  let fake: WebSocketServer | null = null;
  let port = 0;
  const kind = o.url ?? 'service';
  if (kind === 'service') { server = await startTestboxServer({ host: '127.0.0.1', port: 0, token: TOKEN, service: svc }); port = server.port; }
  else if (kind === 'closed') {
    const probe = await startTestboxServer({ host: '127.0.0.1', port: 0, token: TOKEN, service: svc });
    port = probe.port;
    await probe.close();
  } else if (kind !== 'none') {
    const status = { ...svc.status(), ...kind.fakeStatus };
    fake = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => fake!.once('listening', () => r()));
    port = (fake.address() as { port: number }).port;
    fake.on('connection', (ws) => {
      let hello = false;
      ws.on('message', () => { if (!hello) { hello = true; ws.send(JSON.stringify(status)); } else ws.close(1008, 'a fake box runs nothing'); });
    });
  }
  const settings: Record<string, string> = {
    ...(kind === 'none' ? {} : { CCRC_TESTBOX_URL: `ws://127.0.0.1:${port}` }), CCRC_TESTBOX_GIT_URL_BASE: 'file:///',
    CCRC_TESTBOX_STATUS_DEADLINE: '3s', CCRC_TESTBOX_RECONNECT_DEADLINE: '1s', ...o.settings,
  };
  writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), Object.entries(settings).map(([k, v]) => `${k}=${v}\n`).join(''));
  writeFileSync(path.join(home, '.ccrc', 'testbox.token'), `${TOKEN}\n`, { mode: 0o600 });
  if (o.marker !== false) writeFileSync(path.join(home, '.cc-sessions', 'testbox-remote-live'), '');
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('GIT_') && !k.startsWith('VITEST')) env[k] = v;
  Object.assign(env, baseEnv, {
    CCRC_TEST_POLL_S: '0.1', CCRC_CHROME: path.join(bin, 'chrome'),
    // What a session's environment carries on the fleet host: never forwarded to a run.
    GH_TOKEN: 'fleet-secret', CCRC_AGENT_TOKEN: 'fleet-secret',
  });
  // A CI runner's own CI=true would reach the run as CI (spec §2.3); the rows here run as a session does.
  delete env['CI'];
  delete env['NODE_OPTIONS'];
  const w: World = {
    root, home, clone, pkg, mirror, boxRoot, flags, env, svc, mgr, server, fake, port, git,
    restart: async () => { w.server = await startTestboxServer({ host: '127.0.0.1', port: w.port, token: TOKEN, service: svc }); },
  };
  worlds.push(w);
  return w;
}

interface Ran { status: number | null; stdout: string; stderr: string; lines: string[] }
function wrapAsync(w: World, args: readonly string[], o: { env?: NodeJS.ProcessEnv; onSpawn?: (c: ChildProcess) => void; script?: string } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const c = spawn('bash', [o.script ?? WRAPPER, ...args], { cwd: w.pkg, env: { ...w.env, ...o.env }, detached: true });
    let out = '';
    let err = '';
    c.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
    c.stderr!.on('data', (d: Buffer) => { err += d.toString(); });
    o.onSpawn?.(c);
    const timer = setTimeout(() => { try { process.kill(-c.pid!, 'SIGKILL'); } catch { /* gone */ } }, T - 5000);
    c.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout: out, stderr: err, lines: err.split('\n').filter((l) => l !== '') });
    });
  });
}
const wrap = (w: World, args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<Ran> => wrapAsync(w, args, { env });

const VITEST_A = ['--', './node_modules/.bin/vitest', 'run', 'test/a.test.ts'];
const VITEST_B = ['--', './node_modules/.bin/vitest', 'run', 'test/b.test.ts'];
const log = (w: World, name: string): string => (existsSync(path.join(w.home, name)) ? readFileSync(path.join(w.home, name), 'utf8') : '');
const runsDir = (w: World): string => path.join(w.home, '.cc-sessions', 'testbox-runs');
function runsRows(w: World): (RunsLogRow | null)[] {
  if (!existsSync(runsDir(w))) return [];
  return readdirSync(runsDir(w)).sort().flatMap((f) => readFileSync(path.join(runsDir(w), f), 'utf8').split('\n').filter((l) => l !== '').map((l) => parseRunsLine(l)));
}
const reasonOf = (id: TestboxFallbackId): RegExp => {
  const row = TESTBOX_FALLBACK.find((r) => r.id === id)!;
  return new RegExp(`^${row.text.split(/<[^>]+>/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
};

/** The fallback's shape (spec §5 row 7): the reason first and in the last line, the local slice used, the local exit. */
function expectFallback(w: World, r: Ran, id: TestboxFallbackId, localExit: number, command = './node_modules/.bin/vitest run test/a.test.ts'): void {
  const first = r.lines[0] ?? '';
  expect(first, `first line: ${r.stderr}`).toMatch(reasonOf(id));
  expect(r.lines[r.lines.length - 1]).toBe(`ran on: local (fallback: ${first.replace(/^test box: /, '').replace(/; installing .*$/, '')})`);
  if (LINUX) expect(log(w, 'systemd-run.log'), 'the local slice ran it').toContain(`-- ${command}`);
  else expect(r.stderr).toContain(DARWIN_SAYS);
  expect(r.status).toBe(localExit);
  const rows = runsRows(w);
  expect(rows, 'one runs log line').toHaveLength(1);
  expect(rows[0]).toMatchObject({ outcome: 'fallback', fallback: id, exit: localExit });
}

// ---------------------------------------------------------------------------------------------------------------
// The rows.
// ---------------------------------------------------------------------------------------------------------------

describe('TB8: a run on the box (D-7410)', () => {
  it('runs remote, streams its output, ends `ran on: test box` with the run\'s exit, and logs one remote line', async () => {
    const w = await world();
    const r = await wrap(w, VITEST_B);
    expect(r.stdout).toBe('FAIL test/b.test.ts\n');
    expect(r.lines[r.lines.length - 1]).toBe('ran on: test box');
    expect(r.stderr).toContain('ccrc test: failed files: server/test/b.test.ts');
    expect(r.status).toBe(1);
    expect(log(w, 'systemd-run.log'), 'nothing ran in the local slice').toBe('');
    expect(w.mgr.log).toContain('ccrc-testbox-run@1.service');
    expect(runsRows(w)).toEqual([expect.objectContaining({ outcome: 'remote', fallback: null, exit: 1 })]);
  }, T);

  it('spec §5 row 1: a remote and a local run of the same snapshot give the same exit and failed-file list', async () => {
    const w = await world();
    writeFileSync(path.join(w.pkg, 'test', 'c.test.ts'), 'FAIL\n');   // dirty: untracked, sent as the snapshot
    const argv = ['--', './node_modules/.bin/vitest', 'run'];
    const remote = await wrap(w, argv);
    const local = await wrap(w, ['--local', ...argv]);
    expect(remote.lines[remote.lines.length - 1]).toBe('ran on: test box');
    expect(remote.status).toBe(local.status);
    const fails = (s: string) => s.split('\n').filter((l) => l.startsWith('FAIL ')).sort();
    expect(fails(remote.stdout)).toEqual(fails(local.stdout));
    expect(fails(local.stdout)).toEqual(['FAIL test/b.test.ts', 'FAIL test/c.test.ts']);
    expect(remote.stderr).toContain('ccrc test: failed files: server/test/b.test.ts server/test/c.test.ts');
  }, T);

  it('spec §5 row 8: one entry at another version prints the parity-reference line first and in the summary, and still runs remote', async () => {
    const w = await world();
    writeFileSync(path.join(w.pkg, 'node_modules', '.package-lock.json'), JSON.stringify({ name: 'server', packages: { 'node_modules/left-pad': { version: '1.2.0', integrity: 'sha512-fixture120' } } }));
    const r = await wrap(w, VITEST_A);
    const line = 'local deps differ from lockfile (server: node_modules/left-pad)';
    expect(r.lines[0]).toBe(line);
    expect(r.lines.slice(-3)).toContain(line);
    expect(r.lines[r.lines.length - 1]).toBe('ran on: test box');
    expect(r.status).toBe(0);
  }, T);

  it('the env row: a run sees exactly the names built from empty plus the allowlist; the session environment is never forwarded', async () => {
    const w = await world();
    writeFileSync(path.join(w.pkg, 'test', 'e.test.ts'), 'ENV\n');
    const r = await wrap(w, ['--', './node_modules/.bin/vitest', 'run', 'test/e.test.ts'], { CCRC_HISTORY_BASE: 'HEAD' });
    expect(r.lines[r.lines.length - 1]).toBe('ran on: test box');
    const names = (JSON.parse(/^ENV (.*)$/m.exec(r.stdout)![1]!) as string[]).filter((n) => !(process.platform === 'darwin' && n === '__CF_USER_TEXT_ENCODING'));
    expect(names).toEqual(['CCRC_CHROME', 'CCRC_HISTORY_BASE', 'HOME', 'LANG', 'PATH', 'TERM', 'TMPDIR', 'VITEST_MAX_FORKS', 'VITEST_MAX_THREADS', 'VITEST_MAX_WORKERS']);
    for (const secret of ['GH_TOKEN', 'CCRC_AGENT_TOKEN', 'GIT_CONFIG_NOSYSTEM', 'CCRC_TEST_POLL_S']) expect(names).not.toContain(secret);
  }, T);

  it('Ctrl-C cancels the box\'s run: the service stops it, the wrapper exits 130 and logs it', async () => {
    const w = await world();
    writeFileSync(path.join(w.pkg, 'test', 'h.test.ts'), 'HOLD\n');
    let child: ChildProcess | null = null;
    const p = wrapAsync(w, ['--', './node_modules/.bin/vitest', 'run', 'test/h.test.ts'], { onSpawn: (c) => { child = c; } });
    await until('the box run to hold', () => w.mgr.log.includes('ccrc-testbox-run@1.service') && existsSync(path.join(w.boxRoot, 'out', '1', 'stdout')) && readFileSync(path.join(w.boxRoot, 'out', '1', 'stdout'), 'utf8').includes('HOLDING'));
    await new Promise((r) => setTimeout(r, 300));
    process.kill(-child!.pid!, 'SIGINT');
    const r = await p;
    expect(r.status).toBe(130);
    await w.svc.idle();
    expect(w.mgr.log).toContain('stop ccrc-testbox-run@1.service');
    expect(runsRows(w)).toEqual([expect.objectContaining({ outcome: 'remote', exit: 130 })]);
  }, T);

  // The Ctrl-C row signals the whole group, so the client gets SIGINT itself. A supervisor's stop or a timeout's kill
  // signals the wrapper alone: only the wrapper's traps pass it on to the client, and only the client cancels the run.
  for (const [sig, exit] of [['SIGTERM', 143], ['SIGHUP', 129]] as const) {
    it(`${sig} to the wrapper alone is passed to the client: the service stops the run, the wrapper exits ${exit} and logs it`, async () => {
      const w = await world();
      writeFileSync(path.join(w.pkg, 'test', 'h.test.ts'), 'HOLD\n');
      let child: ChildProcess | null = null;
      const p = wrapAsync(w, ['--', './node_modules/.bin/vitest', 'run', 'test/h.test.ts'], { onSpawn: (c) => { child = c; } });
      await until('the box run to hold', () => w.mgr.log.includes('ccrc-testbox-run@1.service') && existsSync(path.join(w.boxRoot, 'out', '1', 'stdout')) && readFileSync(path.join(w.boxRoot, 'out', '1', 'stdout'), 'utf8').includes('HOLDING'));
      await new Promise((r) => setTimeout(r, 300));
      process.kill(child!.pid!, sig);   // the wrapper's own pid, not its group
      // A wrapper that does not pass the signal on waits on a held run forever: bound it, then end the group.
      const bound = new Promise<'held'>((r) => setTimeout(() => r('held'), 20_000));
      const r = await Promise.race([p, bound]);
      if (r === 'held') { try { process.kill(-child!.pid!, 'SIGKILL'); } catch { /* gone */ } }
      expect(r === 'held' ? 'the wrapper was still waiting 20 s after the signal' : r.status).toBe(exit);
      await w.svc.idle();
      expect(w.mgr.log).toContain('stop ccrc-testbox-run@1.service');
      expect(runsRows(w)).toEqual([expect.objectContaining({ outcome: 'remote', exit })]);
    }, T);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// One reading of a vitest argv in two languages: budget.ts's sets against ccd/ccrc-test's case arms.
// ---------------------------------------------------------------------------------------------------------------

/** `_tvalflag`'s case arm in ccd/ccrc-test: the flags that take the next word as their value. */
function wrapperValueFlags(text: string): string[] {
  const m = /^_tvalflag\(\) \{[^\n]*\n\s*case "\$1" in\n([\s\S]*?)\) return 0 ;;/m.exec(text);
  expect(m, '_tvalflag has its one case arm').not.toBeNull();
  return m![1]!.replace(/\\\n/g, ' ').split('|').map((f) => f.trim());
}
/** The subcommands `_targv_heavy` skips as the first word. */
function wrapperSubcommands(text: string): string[] {
  const all = [...text.matchAll(/case "\$w" in ([a-z|]+)\) continue ;; esac/g)];
  expect(all, 'one subcommand case').toHaveLength(1);
  return all[0]![1]!.split('|');
}
const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

describe('TB8: the budget reads an argv as the wrapper does (single definition across bash and TypeScript)', () => {
  const text = readFileSync(path.join(REPO, 'ccd', 'ccrc-test'), 'utf8');

  it('budget.ts VALUE_FLAGS is exactly `_tvalflag`\'s list, and a flag added to one side only is caught', () => {
    const flags = wrapperValueFlags(text);
    expect(flags.length).toBeGreaterThan(10);
    expect(new Set(flags).size, 'no flag twice').toBe(flags.length);
    expect(sorted(VALUE_FLAGS)).toEqual(sorted(flags));
    const mutated = text.replace('|--workspace) return 0 ;;', '|--workspace|--sequence.seed) return 0 ;;');
    expect(mutated).not.toBe(text);
    expect(sorted(VALUE_FLAGS)).not.toEqual(sorted(wrapperValueFlags(mutated)));
  });

  it('budget.ts SUBCOMMANDS is exactly `_targv_heavy`\'s subcommand case, and one added to one side only is caught', () => {
    expect(sorted(SUBCOMMANDS)).toEqual(sorted(wrapperSubcommands(text)));
    const mutated = text.replace('run|watch|dev|related|bench) continue', 'run|watch|dev|related|bench|list) continue');
    expect(mutated).not.toBe(text);
    expect(sorted(SUBCOMMANDS)).not.toEqual(sorted(wrapperSubcommands(mutated)));
  });
});

describe('TB8: every fallback row, in TESTBOX_FALLBACK\'s order (spec §5 row 7)', () => {
  it('the rows this file covers are every TESTBOX_FALLBACK row', () => {
    expect(TESTBOX_FALLBACK.map((r) => r.id)).toEqual(FALLBACK_ROWS.map(([id]) => id));
  });
  // Each fixture: the setup that fails exactly that row. The local run is test/a.test.ts (exit 0) unless the row says.
  type Row = [TestboxFallbackId, () => Promise<{ w: World; r: Ran; exit: number; command?: string }>];
  const plain = (o: WorldOpts, args: string[] = VITEST_A, env: NodeJS.ProcessEnv = {}, prep?: (w: World) => void) => async () => {
    const w = await world(o);
    prep?.(w);
    return { w, r: await wrap(w, args, env), exit: 0 };
  };
  const FALLBACK_ROWS: Row[] = [
    ['off', plain({ marker: false }, ['--remote', ...VITEST_A])],
    ['not-set-up', plain({ rowName: 'project-b' })],
    ['unreachable', plain({ url: 'closed' })],
    ['down', plain({ probeOk: false })],
    ['version-differs', plain({ tools: { node: '1.0.0' } })],
    ['protocol-differs', plain({ url: { fakeStatus: { proto: TESTBOX_PROTO + 1 } } })],
    ['queue-full', plain({ url: { fakeStatus: { queueDepth: 20 } } })],
    ['snapshot-refused', plain({}, VITEST_A, {}, (w) => writeFileSync(path.join(w.pkg, 'secret.pem'), 'k\n'))],
    ['snapshot-too-large', plain({ settings: { CCRC_TESTBOX_UNTRACKED_FILE_MAX: '1K' } }, VITEST_A, {}, (w) => writeFileSync(path.join(w.pkg, 'big.bin'), 'x'.repeat(4096)))],
    ['unmerged-paths', async () => {
      const w = await world();
      const g = (...a: string[]) => w.git(w.clone, ...a);
      g('checkout', '-q', '-b', 'side'); writeFileSync(path.join(w.pkg, 'test', 'a.test.ts'), 'pass side\n'); g('commit', '-qam', 'side');
      g('checkout', '-q', 'main'); writeFileSync(path.join(w.pkg, 'test', 'a.test.ts'), 'pass main\n'); g('commit', '-qam', 'main');
      spawnSync('git', ['merge', '-q', 'side'], { cwd: w.clone, env: w.env });
      writeFileSync(path.join(w.pkg, 'test', 'a.test.ts'), 'pass resolved\n');
      return { w, r: await wrap(w, VITEST_A), exit: 0 };
    }],
    ['runs-locally', async () => {
      const w = await world();
      return { w, r: await wrap(w, ['--', './node_modules/.bin/other-tool']), exit: 4, command: './node_modules/.bin/other-tool' };
    }],
    ['over-budget', plain({ settings: { CCRC_TESTBOX_BUDGET: '1s' } })],
    ['prepare-failed', plain({}, VITEST_A, {}, (w) => writeFileSync(path.join(w.flags, 'prepare-fail'), 'test box: prepare failed (git checkout: fixture refusal)\n'))],
    ['install-failed', plain({}, VITEST_A, {}, (w) => writeFileSync(path.join(w.flags, 'prepare-fail'), 'test box: install failed (server, exit 1)\n'))],
    ['build-failed', plain({}, VITEST_A, {}, (w) => writeFileSync(path.join(w.flags, 'prepare-fail'), 'test box: build failed (server/dist, exit 2)\n'))],
    ['waited', plain({ settings: { CCRC_TESTBOX_QUEUE_WAIT: '1s' } }, VITEST_A, {}, (w) => writeFileSync(path.join(w.flags, 'prepare-hold'), ''))],
    ['lost-run', async () => {
      const w = await world();
      writeFileSync(path.join(w.flags, 'prepare-hold'), '');
      const p = wrap(w, VITEST_A);
      await until('the prepare to start', () => existsSync(path.join(w.flags, 'prepare-started')));
      await w.server!.close();
      w.server = null;
      return { w, r: await p, exit: 0 };
    }],
  ];
  it.each(FALLBACK_ROWS)('%s: the reason first and last, the local slice, the local run\'s exit, one fallback line', async (id, make) => {
    const { w, r, exit, command } = await make();
    expectFallback(w, r, id, exit, command);
    if (id === 'over-budget') expect(r.stderr).toContain('gh workflow run ci.yml --ref main -f mode=full');
  }, T);
});

describe('TB8: the three refusals, exit 75, nothing run (spec §2.5; D-7417)', () => {
  it('an explicit --remote over the budget runs nothing, prints the CI command and exits 75', async () => {
    const w = await world({ settings: { CCRC_TESTBOX_BUDGET: '1s' } });
    const r = await wrap(w, ['--remote', ...VITEST_A]);
    expect(r.status).toBe(75);
    expect(r.lines[0]).toMatch(reasonOf('over-budget'));
    expect(r.stderr).toContain('ccrc test: the full suite runs on CI: gh workflow run ci.yml --ref main -f mode=full');
    expect(r.stdout).toBe('');
    expect(log(w, 'systemd-run.log')).toBe('');
    expect(w.mgr.log).toEqual([]);
    expect(runsRows(w)).toEqual([expect.objectContaining({ outcome: 'refused', fallback: 'over-budget', exit: 75 })]);
  }, T);

  // Spec §2.5: an unknown file costs the median, or the per-file default with no durations. A durations file that
  // names only another package's files is no durations for this one, so a wide run still counts every test file.
  it('a durations file of another package only: a wide --remote run over the budget still refuses, exit 75', async () => {
    const w = await world({ settings: { CCRC_TESTBOX_BUDGET: '1s' } });
    writeFileSync(path.join(w.home, '.ccrc', 'testbox-times.json'), JSON.stringify({ 'agent/test/x.test.ts': 60_000 }));
    const r = await wrap(w, ['--remote', '--', './node_modules/.bin/vitest', 'run']);
    expect(r.status).toBe(75);
    expect(r.lines[0]).toMatch(reasonOf('over-budget'));
    expect(r.stderr).toContain('over 2 files');
    expect(r.stdout).toBe('');
    expect(w.mgr.log).toEqual([]);
  }, T);

  it('a wide run counts an on-disk test file the durations do not name at the median: over the budget, exit 75', async () => {
    const w = await world({ settings: { CCRC_TESTBOX_BUDGET: '90s' } });
    writeFileSync(path.join(w.home, '.ccrc', 'testbox-times.json'), JSON.stringify({ 'server/test/a.test.ts': 60_000 }));
    const r = await wrap(w, ['--remote', '--', './node_modules/.bin/vitest', 'run']);
    expect(r.status).toBe(75);
    expect(r.lines[0]).toMatch(reasonOf('over-budget'));
    expect(r.stderr).toContain('estimate 2 min 0 s over 2 files');
    expect(w.mgr.log).toEqual([]);
  }, T);

  it('CCRC_TESTBOX_FALLBACK_INSTALL=install: a fallback with no node_modules runs npm ci through the wrapper first, then the run', async () => {
    const w = await world({ url: 'closed', noNodeModules: true });
    const r = await wrap(w, VITEST_A);
    expect(r.stderr).toMatch(/^test box: unreachable \(.+\); installing server locally$/m);
    expect(log(w, 'commands.log')).toContain('npm ci');
    if (LINUX) expect(log(w, 'systemd-run.log')).toContain('-- npm ci');
    expect(r.stdout).toBe('PASS test/a.test.ts\n');
    expect(r.status).toBe(0);
    expect(runsRows(w)).toEqual([expect.objectContaining({ outcome: 'fallback', fallback: 'unreachable', exit: 0 })]);
  }, T);

  it('CCRC_TESTBOX_FALLBACK_INSTALL=refuse: the same fallback refuses, exit 75, nothing run', async () => {
    const w = await world({ url: 'closed', noNodeModules: true, settings: { CCRC_TESTBOX_FALLBACK_INSTALL: 'refuse' } });
    const r = await wrap(w, VITEST_A);
    expect(r.stderr).toMatch(/^test box: unreachable \(.+\); no local deps for server$/m);
    expect(r.status).toBe(75);
    expect(log(w, 'commands.log')).toBe('');
    expect(log(w, 'systemd-run.log')).toBe('');
    expect(runsRows(w)).toEqual([expect.objectContaining({ outcome: 'refused', fallback: 'unreachable', exit: 75 })]);
  }, T);

  it('CCRC_TESTBOX_LOST_RUN=fail before any output: `test box: lost the run`, exit 75, nothing run locally', async () => {
    const w = await world({ settings: { CCRC_TESTBOX_LOST_RUN: 'fail' } });
    writeFileSync(path.join(w.flags, 'prepare-hold'), '');
    const p = wrap(w, VITEST_A);
    await until('the prepare to start', () => existsSync(path.join(w.flags, 'prepare-started')));
    await w.server!.close();
    w.server = null;
    const r = await p;
    expect(r.stderr).toContain('test box: lost the run');
    expect(r.status).toBe(75);
    expect(log(w, 'systemd-run.log')).toBe('');
    expect(r.stdout).toBe('');
    expect(runsRows(w)).toEqual([expect.objectContaining({ outcome: 'refused', fallback: 'lost-run', exit: 75 })]);
  }, T);

  it('a reconnect inside the deadline still loses the run (proto 1 cannot re-attach) and cancels it on the box (D-7558)', async () => {
    const w = await world({ settings: { CCRC_TESTBOX_RECONNECT_DEADLINE: '10s' } });
    writeFileSync(path.join(w.flags, 'prepare-hold'), '');
    const p = wrap(w, VITEST_A);
    await until('the prepare to start', () => existsSync(path.join(w.flags, 'prepare-started')));
    await w.server!.close();
    await w.restart();
    const r = await p;
    expectFallback(w, r, 'lost-run', 0);
    writeFileSync(path.join(w.flags, 'prepare-release'), '');
    await w.svc.idle();
    expect(readdirSync(path.join(w.boxRoot, 'results')).length, 'the run ended on the box').toBe(1);
  }, T);
});

describe('TB8: the switch off is today (TB0\'s pins; plan §Global constraints)', () => {
  // The pinned commands of server/test/testbox-pins.test.ts, in its fixture, three ways: as TB0 recorded them (no
  // marker, no URL), with the URL set and no marker, and with the marker and no URL. Every byte and every stub log equal.
  const PINNED = [
    ['--', './node_modules/.bin/vitest', 'run', 'test/a.test.ts'], ['--heavy', '--', './node_modules/.bin/tsc', '--noEmit'],
    ['--', 'npm', 'test'], ['--status'], ['--bogus'],
  ];
  const pinBox = (variant: 'today' | 'url' | 'marker') => {
    const home = mkTmp('tb8-pins-');
    const bin = path.join(home, 'bin');
    const nm = path.join(home, 'node_modules', '.bin');
    for (const d of [bin, nm, path.join(home, 'proc', 'self'), path.join(home, '.cc-sessions'), path.join(home, '.ccrc')]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(bin, 'systemctl'), SYSTEMCTL, { mode: 0o755 });
    writeFileSync(path.join(bin, 'systemd-run'), SYSTEMD_RUN, { mode: 0o755 });
    const stub = (name: string, rc: number) => `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> "$HOME/commands.log"\necho '${name} stub ran'\nexit ${rc}\n`;
    writeFileSync(path.join(bin, 'npm'), stub('npm', 0), { mode: 0o755 });
    writeFileSync(path.join(nm, 'vitest'), stub('vitest', 0), { mode: 0o755 });
    writeFileSync(path.join(nm, 'tsc'), stub('tsc', 1), { mode: 0o755 });
    writeFileSync(path.join(home, 'proc', 'self', 'cgroup'), '0::/user.slice/user-1000.slice/session-1.scope\n');
    if (variant === 'url') writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), 'CCRC_TESTBOX_URL=ws://testbox.invalid:1\n');
    if (variant === 'marker') writeFileSync(path.join(home, '.cc-sessions', 'testbox-remote-live'), '');
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_')) env[k] = v;
    Object.assign(env, { HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}`, CCRC_TEST_POLL_S: '0.1', CCRC_PROC_ROOT: path.join(home, 'proc') });
    return { home, env };
  };
  const pin = (variant: 'today' | 'url' | 'marker', args: string[]) => {
    const b = pinBox(variant);
    const r = spawnSync('bash', [path.join(REPO, 'ccd', 'ccrc-test'), ...args], { env: b.env, encoding: 'utf8', cwd: b.home, timeout: 60_000 });
    const norm = (s: string) => s.split(b.home).join('$HOME').replace(/ccrc-test-\d+/g, 'ccrc-test-<pid>');
    const f = (n: string) => (existsSync(path.join(b.home, n)) ? norm(readFileSync(path.join(b.home, n), 'utf8')) : '');
    return { pin: { stdout: norm(r.stdout), stderr: norm(r.stderr), status: r.status, systemctl: f('systemctl.log'), systemdRun: f('systemd-run.log'), commands: f('commands.log') }, runs: existsSync(path.join(b.home, '.cc-sessions', 'testbox-runs')) };
  };
  it.each(PINNED)('%j: the URL alone and the marker alone change no byte, fork no stubbed process and write no runs log', (...args) => {
    const today = pin('today', args);
    for (const v of ['url', 'marker'] as const) {
      const got = pin(v, args);
      expect(got.pin, v).toEqual(today.pin);
      expect(got.runs, `${v}: no $REG/testbox-runs/`).toBe(false);
    }
  }, T);

  it('--local with the marker and the URL set runs today\'s path and appends nothing', async () => {
    const w = await world();
    const r = await wrap(w, ['--local', ...VITEST_A]);
    expect(r.stdout).toBe('PASS test/a.test.ts\n');
    expect(r.stderr).not.toContain('test box');
    expect(r.status).toBe(0);
    expect(existsSync(runsDir(w))).toBe(false);
    expect(w.mgr.log).toEqual([]);
  }, T);

  it('--local and --remote together are a usage error', async () => {
    const w = await world();
    const r = await wrap(w, ['--local', '--remote', ...VITEST_A]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('ccrc test: --local and --remote together');
  }, T);
});

describe('TB8: the runs log (D-7445)', () => {
  it('two wrappers finishing together leave two whole lines', async () => {
    const w = await world({ url: 'closed' });
    const [a, b] = await Promise.all([wrap(w, VITEST_A), wrap(w, VITEST_A)]);
    expect([a.status, b.status]).toEqual([0, 0]);
    const rows = runsRows(w);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ outcome: 'fallback', fallback: 'unreachable', exit: 0 });
  }, T);

  it('when today\'s file is new, a day file three days old is removed and yesterday\'s kept; the directory is 0700', async () => {
    const w = await world({ url: 'closed' });
    mkdirSync(runsDir(w), { recursive: true, mode: 0o700 });
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const old = path.join(runsDir(w), `${day(3)}.log`);
    const yesterday = path.join(runsDir(w), `${day(1)}.log`);
    writeFileSync(old, `${day(3)}T01:00:00Z\tremote\t-\t0\n`);
    writeFileSync(yesterday, `${day(1)}T01:00:00Z\tremote\t-\t0\n`);
    await wrap(w, VITEST_A);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(yesterday)).toBe(true);
    expect(readFileSync(path.join(runsDir(w), `${day(0)}.log`), 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
  }, T);

  it('the directory is made 0700 on first use', async () => {
    const w = await world({ url: 'closed' });
    await wrap(w, VITEST_A);
    const mode = spawnSync('ls', ['-ld', runsDir(w)], { encoding: 'utf8' }).stdout.slice(0, 10);
    expect(mode).toBe('drwx------');
  }, T);

  it('--remote with the URL unset writes nothing and still says why it ran locally', async () => {
    const w = await world({ url: 'none' });
    const r = await wrap(w, ['--remote', ...VITEST_A]);
    expect(r.lines[0]).toBe('test box: off');
    expect(r.lines[r.lines.length - 1]).toBe('ran on: local (fallback: off)');
    expect(existsSync(runsDir(w))).toBe(false);
  }, T);
});

describe('TB8: spec §5 row 6, what a remote run costs the fleet host', () => {
  // The wrapper's own tree (the wrapper, the settings reads, the snapshot's git, the client), measured by a fixed driver
  // with getrusage(RUSAGE_CHILDREN): peak RSS of its largest process and its CPU time, on a dirty tree, and on one with a
  // file over the cap, which must not be hashed. Ceilings recorded below, well above what the fixture measures.
  const PEAK_RSS_MAX_MB = 256;
  const CPU_MAX_S = 20;
  const DRIVER = 'import resource, subprocess, sys, json\nr = subprocess.run(sys.argv[1:], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\nu = resource.getrusage(resource.RUSAGE_CHILDREN)\nprint(json.dumps({"rc": r.returncode, "maxrss": u.ru_maxrss, "cpu": u.ru_utime + u.ru_stime}))\n';
  const realPython = spawnSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
  const measure = async (w: World): Promise<{ rc: number; mb: number; cpu: number }> => {
    const driver = path.join(w.root, 'rusage.py');
    writeFileSync(driver, DRIVER);
    const r = await new Promise<string>((resolve) => {
      const c = spawn(realPython, [driver, 'bash', WRAPPER, ...VITEST_A], { cwd: w.pkg, env: w.env });
      let out = '';
      c.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      c.on('close', () => resolve(out));
    });
    const m = JSON.parse(r) as { rc: number; maxrss: number; cpu: number };
    return { rc: m.rc, mb: process.platform === 'darwin' ? m.maxrss / (1 << 20) : m.maxrss / 1024, cpu: m.cpu };
  };
  it.skipIf(realPython === '')('a dirty tree: below the ceilings, run remote', async () => {
    const w = await world();
    writeFileSync(path.join(w.pkg, 'test', 'a.test.ts'), 'pass, edited\n');
    const m = await measure(w);
    expect(m.rc).toBe(0);
    expect(runsRows(w)).toEqual([expect.objectContaining({ outcome: 'remote' })]);
    expect(m.mb).toBeLessThan(PEAK_RSS_MAX_MB);
    expect(m.cpu).toBeLessThan(CPU_MAX_S);
  }, T);
  it.skipIf(realPython === '')('a file over the cap: below the ceilings, never hashed, and the run falls back', async () => {
    const w = await world({ settings: { CCRC_TESTBOX_UNTRACKED_FILE_MAX: '1K' } });
    const big = path.join(w.pkg, 'big.bin');
    writeFileSync(big, 'y'.repeat(64 * 1024));
    const m = await measure(w);
    expect(runsRows(w)).toEqual([expect.objectContaining({ outcome: 'fallback', fallback: 'snapshot-too-large' })]);
    const sha = spawnSync('git', ['hash-object', big], { cwd: w.clone, env: w.env, encoding: 'utf8' }).stdout.trim();
    expect(spawnSync('git', ['cat-file', '-e', sha], { cwd: w.clone, env: w.env }).status, 'the big file was never written as an object').not.toBe(0);
    expect(m.mb).toBeLessThan(PEAK_RSS_MAX_MB);
    expect(m.cpu).toBeLessThan(CPU_MAX_S);
  }, T);
});

describe('TB8: ccd/testbox-parity (spec §6, for TB14)', () => {
  const parity = (w: World, revs: string[]): Promise<Ran> => {
    const args = ['--repo', w.clone, '--workers', '2', ...revs.flatMap((r) => ['--rev', r]), '--', './node_modules/.bin/vitest', 'run'];
    return wrapAsync(w, args, { script: PARITY });
  };
  it('two fixture PRs against the in-process service agree; a planted skip on one side is a disagreement', async () => {
    const w = await world();
    const g = (...a: string[]) => w.git(w.clone, ...a).trim();
    // Two "merged PRs": two commits on main, each with a lockfile install the fixture's npm makes.
    writeFileSync(path.join(w.pkg, 'test', 'b.test.ts'), 'pass now\n');
    g('commit', '-qam', 'pr 1');
    const pr1 = g('rev-parse', 'HEAD');
    writeFileSync(path.join(w.pkg, 'test', 'c.test.ts'), 'FAIL\n');
    g('add', '-A'); g('commit', '-qm', 'pr 2');
    const pr2 = g('rev-parse', 'HEAD');
    g('push', '-q', 'origin', 'main');
    w.git(w.mirror, 'fetch', '-q', path.join(w.root, 'project-a.git'), '+refs/heads/*:refs/heads/*');
    const ok = await parity(w, [pr1, pr2]);
    expect(ok.stdout, ok.stderr).toContain('parity: every file agrees');
    expect(ok.stdout).toContain('test/c.test.ts: local fail, box fail; skipped local 0, box 0; agree');
    expect(ok.status).toBe(0);
    // The planted skip: a test the box skips (its run sets VITEST_MAX_WORKERS) and the local leg runs.
    writeFileSync(path.join(w.pkg, 'test', 'd.test.ts'), 'SKIP-ON-BOX\n');
    g('add', '-A'); g('commit', '-qm', 'pr 3');
    const pr3 = g('rev-parse', 'HEAD');
    const bad = await parity(w, [pr3]);
    expect(bad.stdout).toContain('test/d.test.ts: local pass, box pass; skipped local 0, box 1 (t2); DIFFERS');
    expect(bad.status).toBe(1);
  }, T);
});
