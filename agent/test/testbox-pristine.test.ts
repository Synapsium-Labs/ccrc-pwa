// D-7407, D-7429, D-7543 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB5; spec §2.2 "Pristine installs",
// §2.3 "Network", §5 row 4). The pristine-install store and the registry proxy. The service runs against a FAKE
// system manager, TB4's seam: each unit's script runs directly as the current user in a fixture root (Linux and
// macOS); the install unit is `install-pre`, `runner` and `install-post` in that order, as TB7's unit runs them. The
// box's `npm` is a fixture that counts its calls and lays out a fixture `node_modules`; `cp` is a fixture that drops
// the reflink and timestamp flags (no test filesystem is XFS) and records the argv it was given. Nothing here runs
// `systemctl`, contacts a box, a real registry or a release host: the upstream registry is a local fixture server.
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunSubmit, RunSummary, RunLog, TestboxRepoRow } from '../../shared/testbox.js';
import { durationMs, hostPort, type KnobLine, type TestboxConfig } from '../src/testbox/config.js';
import { boundedExec, SHORT_BOUND_MS } from '../src/testbox/exec.js';
import { registryFor } from '../src/testbox/main.js';
import { gitEnv, realGit, runTreeFiles, type MirrorOps } from '../src/testbox/mirror.js';
import {
  adopt, buildEnded, buildQueued, copyEnded, due, emptyStore, expire, installKey, nodeChanged, pristineLists, pristineSettings, retryDelay, seen,
  type InstallInput,
} from '../src/testbox/pristine.js';
import { distFor, integrityMatches, parseRegistryPath, registrySettings, startRegistry, type RunningRegistry } from '../src/testbox/registry.js';
import { CLONE_ARGV, INSTALL_ARGV, installStep } from '../src/testbox/runs.js';
import { TestboxService, type Conn, type ServiceSettings } from '../src/testbox/service.js';
import { buildInstallSpec, encodeInstallSpec, encodeSpec, buildRunSpec } from '../src/testbox/spec.js';
import { checkUnit, parseShow, unitEnd, type SystemManager, type UnitEnd } from '../src/testbox/systemd.js';
import { mkTmp } from './tmpHelpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const BIN = path.join(REPO, 'deploy', 'testbox', 'bin');
const ME = os.userInfo().username;

// ---------------------------------------------------------------------------------------------------------------
// The settings, from fixture printer lines read the way the service reads them (`config.ts`'s `lines`).
// ---------------------------------------------------------------------------------------------------------------

const line = (key: string, value: string): [string, KnobLine] => [key, { key, def: value, value, from: 'file' }];
const LINES = new Map<string, KnobLine>([
  line('CCRC_TESTBOX_PRISTINE_RETRY', '2m 10m'), line('CCRC_TESTBOX_PRISTINE_KEEP', '7d'),
  line('CCRC_TESTBOX_REGISTRY_PROXY', '127.0.0.1:4873'), line('CCRC_TESTBOX_REGISTRY_UPSTREAM', 'http://testbox.invalid/'),
]);
const PS = pristineSettings(LINES, durationMs);
const [RETRY_FIRST, RETRY_LAST] = [PS.retryMs[0]!, PS.retryMs[PS.retryMs.length - 1]!];

// ---------------------------------------------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------------------------------------------

/** The fixture command head the fixture `npm` installs: `--mode=write` writes under `node_modules` as a test that
 *  touches its dependencies would. */
const FAKE_VITEST = `#!/usr/bin/env bash
for a in "$@"; do
  case $a in --mode=write) printf 'changed\\n' > node_modules/dep/index.js; mkdir -p node_modules/.vite; printf 'x\\n' > node_modules/.vite/cache; echo wrote ;; esac
done
echo ran
`;

/** The box's \`npm\`: logs its directory and argv, fails in the install unit when the lockfile asks it to, and lays out a
 *  fixture \`node_modules\`. */
const fakeNpm = (log: string, vitest: string): string => `#!/usr/bin/env bash
printf '%s\\t%s\\n' "$PWD" "$*" >> '${log}'
[ "$1" = ci ] || exit 2
[ -f package-lock.json ] || exit 3
if grep -q fail-pristine package-lock.json && [[ $PWD == */install/run/* ]]; then echo 'npm ERR! fixture install failure' >&2; exit 1; fi
mkdir -p node_modules/.bin node_modules/dep
cp '${vitest}' node_modules/.bin/vitest
chmod 755 node_modules/.bin/vitest
printf 'module.exports = 1;\\n' > node_modules/dep/index.js
`;

/** \`cp\` without the flags a test filesystem cannot honour, its argv recorded. */
const fakeCp = (log: string): string => `#!/usr/bin/env bash
printf '%s\\n' "$*" >> '${log}'
a=()
for x in "$@"; do case $x in --reflink=always|--preserve=timestamps) ;; *) a+=("$x") ;; esac; done
exec /bin/cp -p "\${a[@]}"
`;

/** The fixture prepare unit's script: the template laid into run/checkout/ as the checkout, then each install step
 *  the spec names (\`N\`, \`W\`, \`J\`), in order; a failed step prints the install-failed row. */
const FAKE_PREPARE = `#!/usr/bin/env bash
set -euo pipefail
spec=$1
run=
while IFS= read -r -d '' rec; do case $rec in D*) run=\${rec:1} ;; esac; done < "$spec"
mkdir -p "$run/checkout"
cp -R "$FIXTURE_TEMPLATE/." "$run/checkout/"
pkg= dir= argv=()
step() {
  [ -n "$pkg" ] || return 0
  rc=0
  (cd "$dir" && "\${argv[@]}") || rc=$?
  if [ "$rc" -ne 0 ]; then echo "test box: install failed ($pkg, exit $rc)" >&2; exit 1; fi
}
while IFS= read -r -d '' rec; do
  case $rec in
    N*) step; pkg=\${rec:1}; dir=; argv=() ;;
    W*) dir=\${rec:1} ;;
    J*) argv+=("\${rec:1}") ;;
  esac
done < "$spec"
step
echo prepared
`;

function stubBin(dir: string): string {
  const bin = path.join(dir, 'stub-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'chown'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${path.join(dir, 'chown.log')}"\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'cp'), fakeCp(path.join(dir, 'cp.log')), { mode: 0o755 });
  return bin;
}

const SETTINGS = (root: string): ServiceSettings => ({
  root, workers: 3, runTmpdir: '/tmp', toolsDir: path.join(root, 'tools'), envForward: [], runUserPrefix: 'ccrc-tb-',
  reportMaxBytes: 1024, serviceUser: ME, runs: 2, sessionRuns: 1, logTail: 5, retentionMs: 3_600_000, outputDrainMs: 100,
});

const ROW = (root: string): TestboxRepoRow => ({
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: path.join(root, 'mirrors', 'project-a.git'),
  packages: [{ name: 'server', installInputs: ['server/package.json', 'server/package-lock.json'], commands: ['./node_modules/.bin/vitest'] }],
  buildOutputs: [], systemTools: [],
});

const runId = (): string => randomBytes(16).toString('hex');
const SUBMIT = (over: Partial<RunSubmit> = {}): RunSubmit => ({
  t: 'run.submit', runId: runId(), repository: 'project-a', package: 'server', branch: 'main', refs: ['head'], outputs: [],
  argv: ['./node_modules/.bin/vitest', 'run'], forward: {}, ci: false, workers: 2, session: 'session-a', ...over,
});

interface Proc { child: ChildProcess; done: Promise<UnitEnd> }

/** TB4's seam: each unit's script, run directly as the current user. */
class FakeManager implements SystemManager {
  readonly log: string[] = [];
  constructor(private readonly root: string, private readonly prepare: string, readonly env: Record<string, string>) {}

  private spawnTo(file: string, args: string[], out: string | null, err: string | null): Proc {
    const o = out === null ? 'ignore' : openSync(out, 'w');
    const e = err === null ? 'ignore' : openSync(err, 'w');
    const child = spawn(file, args, { stdio: ['ignore', o, e], env: this.env, detached: true });
    if (typeof o === 'number') closeSync(o);
    if (typeof e === 'number') closeSync(e);
    const done = new Promise<UnitEnd>((resolve) => {
      child.on('exit', (code, signal) => {
        const sig = signal === null ? 0 : (os.constants.signals[signal] ?? 0);
        const show = code === null ? `ExecMainCode=killed\nExecMainStatus=${sig}\nResult=signal\n` : `ExecMainCode=exited\nExecMainStatus=${code}\nResult=${code === 0 ? 'success' : 'exit-code'}\n`;
        resolve(unitEnd({ status: code === 0 ? 0 : 3, killed: false }, parseShow(show)));
      });
      child.on('error', () => resolve({ exit: 255, result: 'resources' }));
    });
    return { child, done };
  }

  async run(unit: string): Promise<UnitEnd> {
    checkUnit(unit);
    this.log.push(unit);
    if (unit === 'ccrc-testbox-install.service') {
      const spec = path.join(this.root, 'specs', 'install');
      const out = path.join(this.root, 'out', 'install');
      const pre = await this.spawnTo(path.join(BIN, 'install-pre'), [spec], null, path.join(out, 'install-pre.stderr')).done;
      if (pre.exit !== 0) return { exit: 255, result: 'exit-code' };
      const main = await this.spawnTo(path.join(BIN, 'runner'), [spec], path.join(out, 'stdout'), path.join(out, 'stderr')).done;
      if (main.exit !== 0) return main;
      const post = await this.spawnTo(path.join(BIN, 'install-post'), [spec], null, path.join(out, 'install-post.stderr')).done;
      return post.exit !== 0 ? post : main;
    }
    const m = /^ccrc-testbox-(prepare|run|clean)@([0-9]+|install)\.service$/.exec(unit);
    if (m === null) throw new Error(`fake manager has no ${unit}`);
    const [, kind, k] = m as unknown as [string, string, string];
    const spec = path.join(this.root, 'specs', k);
    const out = path.join(this.root, 'out', k);
    if (kind === 'prepare') {
      const pre = await this.spawnTo(path.join(BIN, 'prestart'), [spec], null, path.join(out, 'prestart.stderr')).done;
      if (pre.exit !== 0) return unitEnd({ status: 1, killed: false }, parseShow('ExecMainCode=0\nExecMainStatus=0\nResult=exit-code\n'));
      return this.spawnTo(this.prepare, [spec], path.join(out, 'prepare.stdout'), path.join(out, 'prepare.stderr')).done;
    }
    if (kind === 'run') return this.spawnTo(path.join(BIN, 'runner'), [spec], path.join(out, 'stdout'), path.join(out, 'stderr')).done;
    return this.spawnTo(path.join(BIN, 'clean'), [spec], null, path.join(out, 'clean.stderr')).done;
  }

  async stop(): Promise<void> { /* no row stops a unit */ }
  async active(): Promise<boolean> { return false; }
}

class Sink implements Conn {
  readonly frames: (RunLog | RunSummary)[] = [];
  readonly refusals: string[] = [];
  private waiters: (() => void)[] = [];
  send(f: RunLog | RunSummary): void { this.frames.push(f); for (const w of this.waiters.splice(0)) w(); }
  refuse(reason: string): void { this.refusals.push(reason); for (const w of this.waiters.splice(0)) w(); }
  async summary(id: string): Promise<RunSummary> {
    for (;;) {
      const s = this.frames.find((f): f is RunSummary => f.t === 'run.summary' && f.runId === id);
      if (s !== undefined) return s;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
  output(id: string): string {
    return this.frames.filter((f): f is RunLog => f.t === 'run.log' && f.runId === id && f.stream === 'stdout')
      .sort((a, b) => a.offset - b.offset).map((f) => Buffer.from(f.bytes, 'base64').toString('utf8')).join('');
  }
}

const NO_MIRROR: MirrorOps = {
  fetch: async () => ({ status: 0, stdout: '', stderr: '', killed: false }), runIds: async () => [], deleteRefs: async () => undefined,
  gc: async () => ({ status: 0, stdout: '', stderr: '', killed: false }),
};

interface Box {
  root: string;
  template: string;
  svc: TestboxService;
  /** A second service on the same root: a restart. */
  restart: () => TestboxService;
  mgr: FakeManager;
  clock: { now: number };
  node: { v: string };
  npmCalls: () => string[];
  cpCalls: () => string[];
}

const roots: string[] = [];
afterAll(() => {
  const open = (d: string): void => {
    try { chmodSync(d, 0o755); } catch { return; }
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      try { if (lstatSync(p).isDirectory()) open(p); } catch { /* gone */ }
    }
  };
  for (const r of roots) if (existsSync(r)) open(r);
});

const LOCK = (tag: string): string => `{"name":"server","lockfileVersion":3,"packages":{"":{"name":"server"}},"tag":"${tag}"}\n`;

function makeBox(): Box {
  const root = mkTmp('ccrc-tb-pristine-');
  roots.push(root);
  const s = SETTINGS(root);
  for (let k = 1; k <= s.runs; k++) mkdirSync(path.join(root, 'runs', String(k)), { recursive: true });
  mkdirSync(path.join(root, 'install'), { recursive: true });
  mkdirSync(path.join(root, 'pristine'), { recursive: true });
  mkdirSync(path.join(ROW(root).mirrorPath), { recursive: true });
  writeFileSync(path.join(ROW(root).mirrorPath, 'HEAD'), 'ref: refs/heads/main\n');
  const bin = path.join(s.toolsDir, 'current', 'bin');
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, path.join(bin, 'node'));
  const vitest = path.join(root, 'fixture-vitest');
  writeFileSync(vitest, FAKE_VITEST, { mode: 0o755 });
  const npmLog = path.join(root, 'npm.log');
  writeFileSync(path.join(bin, 'npm'), fakeNpm(npmLog, vitest), { mode: 0o755 });
  const template = path.join(root, 'template');
  mkdirSync(path.join(template, 'server', 'test'), { recursive: true });
  writeFileSync(path.join(template, 'server', 'package.json'), '{"name":"server"}\n');
  writeFileSync(path.join(template, 'server', 'package-lock.json'), LOCK('one'));
  const prepare = path.join(root, 'fake-prepare');
  writeFileSync(prepare, FAKE_PREPARE, { mode: 0o755 });
  const mgr = new FakeManager(root, prepare, {
    PATH: `${stubBin(root)}:${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: root, FIXTURE_TEMPLATE: template,
  });
  const clock = { now: Date.UTC(2026, 9, 29, 12, 0, 0) };
  const node = { v: '22.11.0' };
  // The run's tree is the template as it stands when the run is prepared (the mirror read is its own row, below).
  const inputs = async (_m: string, _id: string, paths: readonly string[]): Promise<InstallInput[]> =>
    paths.map((p) => ({ path: p, bytes: readFileSync(path.join(template, p)) }));
  const service = (): TestboxService => new TestboxService({
    settings: s, rows: [ROW(root)], sys: mgr, probe: async () => ({ ok: true }), mirror: NO_MIRROR, now: () => clock.now,
    chrome: path.join(s.toolsDir, 'current', 'chrome'), release: 'v1.2.3', serviceVersion: '1.2.3',
    tools: () => ({ node: node.v, npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' }),
    pristine: { settings: PS, inputs, node: () => node.v, platform: 'linux-x64' },
  });
  const svc = service();
  const lines = (f: string): string[] => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : []);
  return { root, template, svc, restart: service, mgr, clock, node, npmCalls: () => lines(npmLog), cpCalls: () => lines(path.join(root, 'cp.log')) };
}

async function runOne(box: Box, over: Partial<RunSubmit> = {}): Promise<{ summary: RunSummary; sink: Sink; id: string }> {
  const sink = new Sink();
  const f = SUBMIT(over);
  box.svc.submit(f, sink);
  if (sink.refusals.length > 0) throw new Error(`refused: ${sink.refusals.join('; ')}`);
  const summary = await sink.summary(f.runId);
  await box.svc.idle();
  return { summary, sink, id: f.runId };
}

const keyOf = (box: Box): string => installKey(
  ROW(box.root).packages[0]!.installInputs.map((p) => ({ path: p, bytes: readFileSync(path.join(box.template, p)) })), box.node.v, 'linux-x64',
);

/** Every path, mode and content under a directory, hashed: a byte-for-byte fingerprint. */
function treeHash(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = path.join(d, n);
      const st = lstatSync(p);
      h.update(`${path.relative(dir, p)}\0${st.mode}\0`);
      if (st.isDirectory()) walk(p);
      else h.update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

/** A service row runs several units through real scripts: vitest's default 5 s is too short on a loaded machine. */
const ROW_TIMEOUT_MS = 120_000;

const inRun = (call: string): boolean => call.includes(`${path.sep}runs${path.sep}`);
const inInstall = (call: string): boolean => call.includes(`${path.sep}install${path.sep}run${path.sep}`);
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.[0-9]{3}Z$/, 'Z');

// ---------------------------------------------------------------------------------------------------------------
// The import census (§Review focus 4): the fleet agent's entry point reaches neither new file.
// ---------------------------------------------------------------------------------------------------------------

describe('the fleet agent never loads the pristine store or the registry proxy', () => {
  const SRC = path.join(REPO, 'agent', 'src');
  const reach = (entry: string): Set<string> => {
    const seenFiles = new Set<string>();
    const todo = [entry];
    while (todo.length > 0) {
      const f = todo.pop()!;
      if (seenFiles.has(f) || !existsSync(f)) continue;
      seenFiles.add(f);
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:from\s*|import\(\s*|import\s+)['"](\.[^'"]+)['"]/g)) {
        todo.push(path.resolve(path.dirname(f), m[1]!).replace(/\.js$/, '.ts'));
      }
    }
    return seenFiles;
  };
  it('nothing agent/src/index.ts imports reaches pristine.ts or registry.ts; the test service reaches both', () => {
    const fleet = reach(path.join(SRC, 'index.ts'));
    expect(fleet.has(path.join(SRC, 'server.ts'))).toBe(true);
    expect(['pristine.ts', 'registry.ts'].filter((f) => fleet.has(path.join(SRC, 'testbox', f)))).toEqual([]);
    const svc = reach(path.join(SRC, 'testbox', 'main.ts'));
    expect(['pristine.ts', 'registry.ts'].filter((f) => svc.has(path.join(SRC, 'testbox', f)))).toEqual(['pristine.ts', 'registry.ts']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The store (L1).
// ---------------------------------------------------------------------------------------------------------------

describe('pristine.ts: the install key, the states, the backoff, the keep and a new node', () => {
  const inA: InstallInput[] = [{ path: 'server/package.json', bytes: Buffer.from('{}') }, { path: 'server/package-lock.json', bytes: Buffer.from('a') }];
  const inB: InstallInput[] = [{ path: 'server/package.json', bytes: Buffer.from('{}') }, { path: 'server/package-lock.json', bytes: Buffer.from('b') }];
  it('the key is sha256 of the inputs, the node version and the platform', () => {
    const k = installKey(inA, '22.11.0', 'linux-x64');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(installKey(inA, '22.11.0', 'linux-x64')).toBe(k);
    expect(installKey(inB, '22.11.0', 'linux-x64')).not.toBe(k);
    expect(installKey(inA, '22.12.0', 'linux-x64')).not.toBe(k);
    expect(installKey(inA, '22.11.0', 'darwin-arm64')).not.toBe(k);
    // A path is part of the key: the same bytes under another name are another input set.
    expect(installKey([{ path: 'x/package.json', bytes: Buffer.from('{}') }, inA[1]!], '22.11.0', 'linux-x64')).not.toBe(k);
  });
  it('missing, then building, then present; a failed build waits its delay, the last delay repeating', () => {
    let s = emptyStore('22.11.0', 'linux-x64');
    const r = seen(s, 'project-a', 'server', inA, 0);
    expect(r.present).toBe(false);
    s = r.store;
    expect(due(s, 0)).toEqual([r.key]);
    s = buildQueued(s, r.key);
    expect(due(s, 0)).toEqual([]);
    s = buildEnded(s, r.key, 1, 1000, PS.retryMs);
    expect(pristineLists(s).failed).toEqual([{ repository: 'project-a', package: 'server', key: r.key, exit: 1, attempts: 1, nextAttemptAt: 1000 + RETRY_FIRST }]);
    expect(due(s, 1000 + RETRY_FIRST - 1)).toEqual([]);
    expect(due(s, 1000 + RETRY_FIRST)).toEqual([r.key]);
    for (let a = 2; a <= PS.retryMs.length + 2; a++) s = buildEnded(buildQueued(s, r.key), r.key, 1, 0, PS.retryMs);
    expect(pristineLists(s).failed[0]!.nextAttemptAt).toBe(RETRY_LAST);
    expect([1, 2, 3, 9].map((n) => retryDelay(PS.retryMs, n))).toEqual([RETRY_FIRST, RETRY_LAST, RETRY_LAST, RETRY_LAST]);
    s = buildEnded(buildQueued(s, r.key), r.key, 0, 5, PS.retryMs);
    expect(pristineLists(s)).toEqual({ pristine: [{ repository: 'project-a', package: 'server', key: r.key }], failed: [] });
    expect(seen(s, 'project-a', 'server', inA, 6).present).toBe(true);
  });
  it('a newer key for the same package replaces the failed one', () => {
    let s = seen(emptyStore('22.11.0', 'linux-x64'), 'project-a', 'server', inA, 0).store;
    const a = installKey(inA, '22.11.0', 'linux-x64');
    s = buildEnded(buildQueued(s, a), a, 1, 0, PS.retryMs);
    expect(pristineLists(s).failed.map((f) => f.key)).toEqual([a]);
    s = seen(s, 'project-a', 'server', inB, 1).store;
    expect(pristineLists(s).failed).toEqual([]);
    expect(due(s, 1)).toEqual([installKey(inB, '22.11.0', 'linux-x64')]);
  });
  it('a present key unused for the keep time is deleted only while no prepare copies it', () => {
    let s = seen(emptyStore('22.11.0', 'linux-x64'), 'project-a', 'server', inA, 0).store;
    const a = installKey(inA, '22.11.0', 'linux-x64');
    s = buildEnded(buildQueued(s, a), a, 0, 0, PS.retryMs);
    s = seen(s, 'project-a', 'server', inA, 10).store; // a prepare clones it: copying 1
    expect(expire(s, 10 + PS.keepMs, PS.keepMs)).toBe(s);
    s = copyEnded(s, a);
    expect(expire(s, 10 + PS.keepMs - 1, PS.keepMs)).toBe(s);
    const gone = expire(s, 10 + PS.keepMs, PS.keepMs);
    expect(pristineLists(gone).pristine).toEqual([]);
    expect(gone.doomed).toEqual([a]);
  });
  it('a new node version queues every key\'s rebuild under it', () => {
    let s = seen(emptyStore('22.11.0', 'linux-x64'), 'project-a', 'server', inA, 0).store;
    s = seen(s, 'project-a', 'agent', inB, 0).store;
    for (const k of due(s, 0)) s = buildEnded(buildQueued(s, k), k, 0, 0, PS.retryMs);
    expect(due(s, 0)).toEqual([]);
    const n = nodeChanged(s, '22.12.0', 1);
    expect(due(n, 1)).toEqual([installKey(inA, '22.12.0', 'linux-x64'), installKey(inB, '22.12.0', 'linux-x64')]);
    expect(nodeChanged(s, '22.11.0', 1)).toBe(s);
  });
  it('a directory found at start is adopted as present, unnamed, and expires unused', () => {
    const k = 'a'.repeat(64);
    const s = adopt(emptyStore('22.11.0', 'linux-x64'), [k, 'not-a-key', '.stage-x'], 0);
    expect(s.entries.map((e) => [e.key, e.state])).toEqual([[k, 'present']]);
    expect(pristineLists(s).pristine).toEqual([]);
    expect(expire(s, PS.keepMs, PS.keepMs).doomed).toEqual([k]);
  });
  it('the settings come from the printer\'s lines, and a missing key refuses with its name', () => {
    expect(PS.retryMs.length).toBeGreaterThan(1);
    expect(() => pristineSettings(new Map(), durationMs)).toThrow(/CCRC_TESTBOX_PRISTINE_RETRY/);
  });
});

describe('runs.ts and spec.ts: the prepare\'s install step and the install unit\'s spec', () => {
  it('a present key is cloned with the reflink copy; otherwise npm ci in the run\'s copy', () => {
    const k = 'b'.repeat(64);
    expect(installStep('server', k, true, '/r/pristine', '/r/runs/1/run/checkout')).toEqual({
      package: 'server', key: k, mode: 'clone', dir: '/r/runs/1/run/checkout/server',
      argv: ['cp', '-R', '--reflink=always', '--preserve=timestamps', `/r/pristine/${k}`, '/r/runs/1/run/checkout/server/node_modules'],
    });
    expect(installStep('server', k, false, '/r/pristine', '/c').argv).toEqual(['npm', 'ci', '--prefer-offline']);
    expect(installStep('server', null, true, '/r/pristine', '/c').mode).toBe('install');
    expect([...CLONE_ARGV, ...INSTALL_ARGV]).toEqual(['cp', '-R', '--reflink=always', '--preserve=timestamps', 'npm', 'ci', '--prefer-offline']);
  });
  it('the steps ride the run\'s spec as N, W and J records; the install spec carries its inputs and doomed keys', () => {
    const root = mkTmp('ccrc-tb-pristine-spec-');
    const built = buildRunSpec(SUBMIT(), ROW(root), 1, SETTINGS(root), '/c');
    if (!built.ok) throw new Error(built.reason);
    const recs = encodeSpec({ ...built.spec, installs: [installStep('server', null, false, '/p', '/c')] }).toString('utf8').split('\0');
    expect(recs.slice(recs.indexOf('Nserver'))).toEqual(['Nserver', 'W/c/server', 'Jnpm', 'Jci', 'J--prefer-offline', '']);
    const spec = buildInstallSpec('c'.repeat(64), 'server', [{ path: 'server/package-lock.json', bytes: Buffer.from('lock') }], ['d'.repeat(64)], SETTINGS(root));
    const irecs = encodeInstallSpec(spec).toString('utf8').split('\0');
    expect(irecs).toContain(`D${path.join(root, 'install', 'run')}`);
    expect(irecs).toContain('Uccrc-tb-install');
    expect(irecs).toContain(`V${Buffer.from('lock').toString('base64')}`);
    expect(irecs).toContain(`Z${'d'.repeat(64)}`);
    expect(irecs).toContain(`C${path.join(root, 'install', 'run', 'build', 'server')}`);
    expect(irecs.filter((r) => r.startsWith('A'))).toEqual(['Anpm', 'Aci']);
    expect(irecs.some((r) => r.startsWith('Enpm_config'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Spec §5 row 4, against the service.
// ---------------------------------------------------------------------------------------------------------------

describe('spec §5 row 4: a run with no pristine install for its key', () => {
  it('installs in its own copy, the pristine install appears after, and the next run clones it (npm ci per run with a present key: 0)', async () => {
    const box = makeBox();
    await box.svc.start();
    const key = keyOf(box);
    const first = await runOne(box);
    expect(first.summary.exit).toBe(0);
    expect(first.summary.prepareFailed).toBeNull();
    expect(first.sink.output(first.id)).toContain('ran');
    expect(box.npmCalls().filter(inRun)).toHaveLength(1);
    expect(box.npmCalls().filter(inRun)[0]).toMatch(/\tci --prefer-offline$/);
    // The build ran in the install unit, from the lockfile alone, and its node_modules is the key's pristine install.
    expect(box.npmCalls().filter(inInstall)).toHaveLength(1);
    expect(box.npmCalls().filter(inInstall)[0]).toMatch(/install\/run\/build\/server\tci$/);
    expect(existsSync(path.join(box.root, 'pristine', key, 'dep', 'index.js'))).toBe(true);
    expect(existsSync(path.join(box.root, 'install', 'run'))).toBe(false);
    expect(box.mgr.log.filter((u) => u.includes('install'))).toEqual(['ccrc-testbox-install.service', 'ccrc-testbox-clean@install.service']);
    expect(box.svc.status().pristine).toEqual([{ repository: 'project-a', package: 'server', key }]);
    expect(box.svc.status().failedKeys).toEqual([]);

    const before = box.npmCalls().length;
    const second = await runOne(box);
    expect(second.summary.exit).toBe(0);
    expect(second.sink.output(second.id)).toContain('ran');
    expect(box.npmCalls().length - before, 'npm ci per run with a present key').toBe(0);
    expect(box.cpCalls().filter((c) => c.includes('--reflink'))).toEqual([[...CLONE_ARGV.slice(1), path.join(box.root, 'pristine', key), path.join(box.root, 'runs', '1', 'run', 'checkout', 'server', 'node_modules')].join(' ')]);
    expect(box.mgr.log.filter((u) => u === 'ccrc-testbox-install.service')).toHaveLength(1);
  }, ROW_TIMEOUT_MS);

  it('the pristine install is byte-unchanged after a run writes under its clone', async () => {
    const box = makeBox();
    await box.svc.start();
    await runOne(box);
    const pristine = path.join(box.root, 'pristine', keyOf(box));
    const before = treeHash(pristine);
    const w = await runOne(box, { argv: ['./node_modules/.bin/vitest', 'run', '--mode=write'] });
    expect(w.sink.output(w.id)).toContain('wrote');
    expect(w.summary.exit).toBe(0);
    expect(treeHash(pristine)).toBe(before);
    expect(readFileSync(path.join(pristine, 'dep', 'index.js'), 'utf8')).toBe('module.exports = 1;\n');
    expect(existsSync(path.join(pristine, '.vite'))).toBe(false);
  }, ROW_TIMEOUT_MS);

  it('a failing install retries on the backoff, is listed with exit, attempts and next attempt, the box is degraded, runs still install in their copy, and install/run is gone after every attempt', async () => {
    const box = makeBox();
    writeFileSync(path.join(box.template, 'server', 'package-lock.json'), LOCK('fail-pristine'));
    await box.svc.start();
    const key = keyOf(box);
    const t0 = box.clock.now;
    const r1 = await runOne(box);
    expect(r1.summary.exit).toBe(0);
    expect(existsSync(path.join(box.root, 'install', 'run'))).toBe(false);
    expect(existsSync(path.join(box.root, 'pristine', key))).toBe(false);
    let st = box.svc.status();
    expect(st.failedKeys).toEqual([{ repository: 'project-a', package: 'server', key, exit: 1, attempts: 1, nextAttempt: iso(t0 + RETRY_FIRST) }]);
    expect(st.state).toBe('degraded');
    expect(st.reason).toContain(`pristine install failed (server ${key}, exit 1)`);

    // Not yet due: the timer builds nothing.
    box.clock.now = t0 + RETRY_FIRST - 1;
    await box.svc.tick();
    await box.svc.idle();
    expect(box.mgr.log.filter((u) => u === 'ccrc-testbox-install.service')).toHaveLength(1);

    // Each attempt after its delay, the last delay repeating.
    let at = t0 + RETRY_FIRST;
    const expected = [RETRY_LAST, RETRY_LAST];
    for (const [i, delay] of expected.entries()) {
      box.clock.now = at;
      await box.svc.tick();
      await box.svc.idle();
      expect(box.mgr.log.filter((u) => u === 'ccrc-testbox-install.service')).toHaveLength(i + 2);
      expect(existsSync(path.join(box.root, 'install', 'run')), `install/run after attempt ${i + 2}`).toBe(false);
      st = box.svc.status();
      expect(st.failedKeys).toEqual([{ repository: 'project-a', package: 'server', key, exit: 1, attempts: i + 2, nextAttempt: iso(at + delay) }]);
      at += delay;
    }

    // A run of that key still installs in its own copy, and passes on its merits.
    const runsBefore = box.npmCalls().filter(inRun).length;
    const r2 = await runOne(box);
    expect(r2.summary.exit).toBe(0);
    expect(box.npmCalls().filter(inRun).length).toBe(runsBefore + 1);
    expect(box.svc.status().state).toBe('degraded');

    // A newer lockfile for the package replaces the failed key, and its build succeeds.
    writeFileSync(path.join(box.template, 'server', 'package-lock.json'), LOCK('two'));
    await runOne(box);
    st = box.svc.status();
    expect(st.failedKeys).toEqual([]);
    expect(st.pristine).toEqual([{ repository: 'project-a', package: 'server', key: keyOf(box) }]);
    expect(st.state).toBe('ok');
  }, ROW_TIMEOUT_MS);

  it('a key unused for the keep time leaves the list once the runs that cloned it are done, and the next install\'s first step removes it, once', async () => {
    const box = makeBox();
    await box.svc.start();
    await runOne(box);
    const old = keyOf(box);
    expect(existsSync(path.join(box.root, 'pristine', old))).toBe(true);
    // A second run clones the key: its prepare's copy ends with the prepare, so the key can still expire.
    await runOne(box);
    expect(box.cpCalls().filter((c) => c.includes('--reflink') && c.includes(path.join('pristine', old)))).toHaveLength(1);
    box.clock.now += PS.keepMs;
    await box.svc.tick();
    await box.svc.idle();
    expect(box.svc.status().pristine).toEqual([]);
    writeFileSync(path.join(box.template, 'server', 'package-lock.json'), LOCK('three'));
    await runOne(box);
    expect(existsSync(path.join(box.root, 'pristine', old))).toBe(false);
    expect(existsSync(path.join(box.root, 'pristine', keyOf(box)))).toBe(true);
    const doomedIn = (): string[] => readFileSync(path.join(box.root, 'specs', 'install'), 'utf8').split('\0').filter((r) => r.startsWith('Z')).map((r) => r.slice(1));
    expect(doomedIn(), 'the build that removed it named it').toEqual([old]);
    // Removed once: the next build's spec names no doomed key.
    writeFileSync(path.join(box.template, 'server', 'package-lock.json'), LOCK('four'));
    await runOne(box);
    expect(existsSync(path.join(box.root, 'pristine', keyOf(box)))).toBe(true);
    expect(doomedIn(), 'a removed key is not named again').toEqual([]);
  }, ROW_TIMEOUT_MS);

  it('a build the service lost mid-flight (install/run left behind) is cleaned before the next build, which succeeds', async () => {
    const box = makeBox();
    mkdirSync(path.join(box.root, 'install', 'run', 'build', 'server'), { recursive: true });
    writeFileSync(path.join(box.root, 'install', 'run', 'build', 'server', 'package-lock.json'), LOCK('lost'));
    await box.svc.start();
    const r = await runOne(box);
    expect(r.summary.exit).toBe(0);
    expect(box.mgr.log.filter((u) => u.includes('install'))).toEqual([
      'ccrc-testbox-clean@install.service', 'ccrc-testbox-install.service', 'ccrc-testbox-clean@install.service',
    ]);
    expect(box.svc.status().failedKeys).toEqual([]);
    expect(box.svc.status().pristine).toEqual([{ repository: 'project-a', package: 'server', key: keyOf(box) }]);
    expect(existsSync(path.join(box.root, 'pristine', keyOf(box), 'dep', 'index.js'))).toBe(true);
    expect(existsSync(path.join(box.root, 'install', 'run'))).toBe(false);
  }, ROW_TIMEOUT_MS);

  it('a new node version queues the key\'s rebuild, and a restarted service adopts what is on disk', async () => {
    const box = makeBox();
    await box.svc.start();
    await runOne(box);
    const old = keyOf(box);
    box.node.v = '22.12.0';
    await box.svc.tick();
    await box.svc.idle();
    expect(existsSync(path.join(box.root, 'pristine', keyOf(box)))).toBe(true);
    expect(keyOf(box)).not.toBe(old);
    expect(box.mgr.log.filter((u) => u === 'ccrc-testbox-install.service')).toHaveLength(2);
    // A restarted service clones what is on disk and builds nothing.
    box.svc = box.restart();
    await box.svc.start();
    const before = box.npmCalls().length;
    const r = await runOne(box);
    expect(r.summary.exit).toBe(0);
    expect(box.npmCalls().length - before).toBe(0);
    expect(box.mgr.log.filter((u) => u === 'ccrc-testbox-install.service')).toHaveLength(2);
    expect(box.svc.status().pristine).toEqual([{ repository: 'project-a', package: 'server', key: keyOf(box) }]);
  }, ROW_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------------------------
// The install inputs at a run's tree, read from a fixture mirror.
// ---------------------------------------------------------------------------------------------------------------

describe('mirror.ts#runTreeFiles: the inputs at the run\'s tree', () => {
  const git = (cwd: string, ...args: string[]): string => {
    const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@testbox.invalid', '-c', 'commit.gpgSign=false', ...args], { cwd, encoding: 'utf8', env: { ...gitEnv(cwd), PATH: process.env.PATH ?? '' } });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  it('reads the snapshot\'s working tree when the run carries one, its head otherwise, and null for a missing path', async () => {
    const root = mkTmp('ccrc-tb-pristine-git-');
    const work = path.join(root, 'work');
    mkdirSync(path.join(work, 'server'), { recursive: true });
    git(root, 'init', '-q', work);
    writeFileSync(path.join(work, 'server', 'package-lock.json'), 'head\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'head');
    const head = git(work, 'rev-parse', 'HEAD');
    writeFileSync(path.join(work, 'server', 'package-lock.json'), 'dirty\n');
    git(work, 'add', '-A');
    const tree = git(work, 'write-tree');
    const snap = git(work, 'commit-tree', tree, '-p', head, '-m', 'snap');
    const mirror = path.join(root, 'mirror.git');
    git(root, 'clone', '-q', '--bare', work, mirror);
    const a = runId();
    const b = runId();
    git(mirror, 'update-ref', `refs/ccrc-test/${a}/head`, head);
    git(mirror, 'update-ref', `refs/ccrc-test/${b}/head`, head);
    git(mirror, 'update-ref', `refs/ccrc-test/${b}/snap`, snap);
    const g = realGit(boundedExec({ ...gitEnv(root), PATH: process.env.PATH ?? '' }, SHORT_BOUND_MS));
    const text = (r: { bytes: Uint8Array }[] | null): string[] | null => r?.map((x) => Buffer.from(x.bytes).toString('utf8')) ?? null;
    expect(text(await runTreeFiles(g, mirror, a, ['server/package-lock.json']))).toEqual(['head\n']);
    expect(text(await runTreeFiles(g, mirror, b, ['server/package-lock.json']))).toEqual(['dirty\n']);
    expect(await runTreeFiles(g, mirror, a, ['server/package-lock.json', 'server/absent.json'])).toBeNull();
    expect(await runTreeFiles(g, mirror, runId(), ['server/package-lock.json'])).toBeNull();
  });
  it('fails closed: a blob past the exec\'s capture, or one whose bytes do not round-trip, is null, never empty bytes; an empty blob is read as empty', async () => {
    const root = mkTmp('ccrc-tb-pristine-git-');
    const work = path.join(root, 'work');
    mkdirSync(path.join(work, 'server'), { recursive: true });
    git(root, 'init', '-q', work);
    // Past the bounded spawner's 1 MiB capture: the exec answers status 0 with no stdout.
    writeFileSync(path.join(work, 'server', 'package-lock.json'), Buffer.alloc(2 * 1024 * 1024, 0x61));
    // Not UTF-8: a decode and re-encode would change its bytes, and its key.
    writeFileSync(path.join(work, 'server', 'latin1.json'), Buffer.from([0x7b, 0xe9, 0xff, 0x7d, 0x0a]));
    writeFileSync(path.join(work, 'server', 'empty.json'), '');
    writeFileSync(path.join(work, 'server', 'package.json'), '{"name":"server"}\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'head');
    const head = git(work, 'rev-parse', 'HEAD');
    const mirror = path.join(root, 'mirror.git');
    git(root, 'clone', '-q', '--bare', work, mirror);
    const a = runId();
    git(mirror, 'update-ref', `refs/ccrc-test/${a}/head`, head);
    const g = realGit(boundedExec({ ...gitEnv(root), PATH: process.env.PATH ?? '' }, SHORT_BOUND_MS));
    expect(await runTreeFiles(g, mirror, a, ['server/package-lock.json']), 'a 2 MiB blob').toBeNull();
    expect(await runTreeFiles(g, mirror, a, ['server/package.json', 'server/package-lock.json']), 'one over the capture fails the set').toBeNull();
    expect(await runTreeFiles(g, mirror, a, ['server/latin1.json']), 'a non-UTF-8 blob').toBeNull();
    const ok = await runTreeFiles(g, mirror, a, ['server/empty.json', 'server/package.json']);
    expect(ok?.map((x) => Buffer.from(x.bytes).toString('utf8'))).toEqual(['', '{"name":"server"}\n']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The registry proxy (D-7429), against a local fixture upstream.
// ---------------------------------------------------------------------------------------------------------------

describe('registry.ts: the caching read-only registry proxy', () => {
  const GOOD = Buffer.from('fixture tarball dep 1.0.0');
  const BAD = Buffer.from('fixture tarball dep 1.0.1, not what the packument says');
  const sri = (b: Uint8Array): string => `sha512-${createHash('sha512').update(b).digest('base64')}`;
  let upstream: Server;
  let upstreamUrl = '';
  const hits: string[] = [];
  let proxy: RunningRegistry;
  let base = '';
  let cache = '';
  /** The upstream's state: down answers 500 for every packument; `newer` lists a version published since. */
  const up = { down: false, newer: false };

  const start = async (): Promise<void> => {
    upstream = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (up.down && !(req.url ?? '').includes('/-/')) { res.writeHead(500).end(); return; }
      if (req.url === '/dep') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          name: 'dep', versions: {
            '1.0.0': { dist: { tarball: `${upstreamUrl}/dep/-/dep-1.0.0.tgz`, integrity: sri(GOOD) } },
            '1.0.1': { dist: { tarball: `${upstreamUrl}/dep/-/dep-1.0.1.tgz`, integrity: sri(GOOD) } },
            ...(up.newer ? { '1.0.2': { dist: { tarball: `${upstreamUrl}/dep/-/dep-1.0.2.tgz`, integrity: sri(GOOD) } } } : {}),
          },
        }));
        return;
      }
      if (req.url === '/@scope%2fdep') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          name: '@scope/dep', versions: { '2.0.0': { dist: { tarball: `${upstreamUrl}/@scope/dep/-/dep-2.0.0.tgz`, integrity: sri(GOOD) } } },
        }));
        return;
      }
      if (req.url === '/@scope/dep/-/dep-2.0.0.tgz') { res.writeHead(200).end(GOOD); return; }
      if (req.url === '/dep/-/dep-1.0.0.tgz') { res.writeHead(200).end(GOOD); return; }
      if (req.url === '/dep/-/dep-1.0.1.tgz') { res.writeHead(200).end(BAD); return; }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    const a = upstream.address();
    upstreamUrl = `http://127.0.0.1:${typeof a === 'object' && a !== null ? a.port : 0}`;
    const root = mkTmp('ccrc-tb-registry-');
    cache = path.join(root, 'registry');
    const lines = new Map(LINES);
    lines.set('CCRC_TESTBOX_REGISTRY_UPSTREAM', line('CCRC_TESTBOX_REGISTRY_UPSTREAM', upstreamUrl)[1]);
    const r = registrySettings(lines, hostPort);
    expect(r).toEqual({ host: '127.0.0.1', port: 4873, upstream: upstreamUrl });
    // The fixture binds an ephemeral port in place of the setting's, so parallel files never collide.
    proxy = await startRegistry({ host: r.host, port: 0, upstream: r.upstream, cacheDir: cache, timeoutMs: SHORT_BOUND_MS });
    base = `http://127.0.0.1:${proxy.port}`;
  };
  afterAll(async () => {
    await proxy?.close();
    await new Promise<void>((r) => (upstream === undefined ? r() : upstream.close(() => r())));
  });

  it('a cached second GET makes no upstream call', async () => {
    await start();
    const one = await fetch(`${base}/dep/-/dep-1.0.0.tgz`);
    expect(one.status).toBe(200);
    expect(Buffer.from(await one.arrayBuffer())).toEqual(GOOD);
    const n = hits.length;
    const two = await fetch(`${base}/dep/-/dep-1.0.0.tgz`);
    expect(two.status).toBe(200);
    expect(Buffer.from(await two.arrayBuffer())).toEqual(GOOD);
    expect(hits.length - n, 'upstream calls for the cached GET').toBe(0);
    const head = await fetch(`${base}/dep/-/dep-1.0.0.tgz`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(hits.length - n).toBe(0);
  });

  it('any method but GET and HEAD is 405, and never reaches the upstream', async () => {
    const n = hits.length;
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await fetch(`${base}/dep`, { method, body: method === 'DELETE' ? undefined : '{}' });
      expect(r.status, method).toBe(405);
      expect(r.headers.get('allow')).toBe('GET, HEAD');
    }
    expect(hits.length - n).toBe(0);
  });

  it('a tarball whose bytes do not match its packument\'s dist.integrity is not cached and answers 502', async () => {
    const r = await fetch(`${base}/dep/-/dep-1.0.1.tgz`);
    expect(r.status).toBe(502);
    expect(existsSync(path.join(cache, 'tarballs', 'dep', 'dep-1.0.1.tgz'))).toBe(false);
    const n = hits.filter((h) => h.endsWith('dep-1.0.1.tgz')).length;
    expect((await fetch(`${base}/dep/-/dep-1.0.1.tgz`)).status).toBe(502);
    expect(hits.filter((h) => h.endsWith('dep-1.0.1.tgz')).length, 'not cached: asked again').toBe(n + 1);
  });

  it('a packument comes through with its tarball URLs pointed at the proxy; other paths are 404', async () => {
    const r = await fetch(`${base}/dep`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain(`${base}/dep/-/dep-1.0.0.tgz`);
    expect(text).not.toContain(upstreamUrl);
    expect((await fetch(`${base}/-/whoami`)).status).toBe(404);
    expect((await fetch(`${base}/absent`)).status).toBe(404);
  });

  it('the pure readers: paths, integrity, dist', () => {
    expect(parseRegistryPath('/dep')).toEqual({ kind: 'packument', name: 'dep' });
    expect(parseRegistryPath('/@scope%2fdep')).toEqual({ kind: 'packument', name: '@scope/dep' });
    expect(parseRegistryPath('/@scope/dep/-/dep-1.0.0.tgz')).toEqual({ kind: 'tarball', name: '@scope/dep', file: 'dep-1.0.0.tgz' });
    for (const bad of ['/', '/-/user/org.couchdb.user:x', '/dep/../x', '/Dep', '/dep/-/x.tar']) expect(parseRegistryPath(bad), bad).toBeNull();
    expect(integrityMatches(GOOD, sri(GOOD), null)).toBe(true);
    expect(integrityMatches(BAD, sri(GOOD), null)).toBe(false);
    expect(integrityMatches(GOOD, null, createHash('sha1').update(GOOD).digest('hex'))).toBe(true);
    expect(integrityMatches(GOOD, null, null)).toBe(false);
    expect(distFor({ versions: { '1.0.0': { dist: { tarball: 'x/-/dep-1.0.0.tgz', integrity: 'i' } } } }, 'dep-1.0.0.tgz')).toEqual({ integrity: 'i', shasum: null });
    expect(distFor({ versions: {} }, 'dep-1.0.0.tgz')).toBeNull();
  });

  it('a packument is asked of the upstream on every request, and the kept copy answers only while the upstream fails', async () => {
    const asked = (): number => hits.filter((h) => h === 'GET /dep').length;
    const n = asked();
    expect((await fetch(`${base}/dep`)).status).toBe(200);
    expect((await fetch(`${base}/dep`)).status).toBe(200);
    expect(asked() - n, 'each GET reaches the upstream, though a copy is kept').toBe(2);
    up.newer = true;
    const seenNew = await fetch(`${base}/dep`);
    expect(await seenNew.text(), 'a version published since is seen').toContain(`${base}/dep/-/dep-1.0.2.tgz`);
    up.down = true;
    try {
      const m = asked();
      const kept = await fetch(`${base}/dep`);
      expect(kept.status, 'the kept copy answers').toBe(200);
      const text = await kept.text();
      expect(text).toContain(`${base}/dep/-/dep-1.0.2.tgz`);
      expect(text).not.toContain(upstreamUrl);
      expect(asked() - m, 'the upstream was asked first').toBe(1);
      expect((await fetch(`${base}/never-kept`)).status, 'nothing kept and the upstream down').toBe(502);
    } finally {
      up.down = false;
    }
  });

  it('a scoped packument reaches the upstream as /@scope%2fdep, and its tarball as /@scope/dep/-/<file>', async () => {
    const r = await fetch(`${base}/@scope%2fdep`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain(`${base}/@scope/dep/-/dep-2.0.0.tgz`);
    expect(hits).toContain('GET /@scope%2fdep');
    const t = await fetch(`${base}/@scope/dep/-/dep-2.0.0.tgz`);
    expect(t.status).toBe(200);
    expect(Buffer.from(await t.arrayBuffer())).toEqual(GOOD);
    expect(hits).toContain('GET /@scope/dep/-/dep-2.0.0.tgz');
    expect(existsSync(path.join(cache, 'tarballs', encodeURIComponent('@scope/dep'), 'dep-2.0.0.tgz'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The service's entry point starts the proxy on a loopback address only (D-7543).
// ---------------------------------------------------------------------------------------------------------------

describe('main.ts#registryFor: the proxy binds a loopback address of its own, never another', () => {
  const cfgWith = (proxy: string): TestboxConfig => {
    const lines = new Map(LINES);
    lines.set('CCRC_TESTBOX_REGISTRY_PROXY', line('CCRC_TESTBOX_REGISTRY_PROXY', proxy)[1]);
    return { lines, root: mkTmp('ccrc-tb-registry-for-'), unitMaxMs: SHORT_BOUND_MS } as unknown as TestboxConfig;
  };
  it('refuses a non-loopback CCRC_TESTBOX_REGISTRY_PROXY before it binds, and starts on a loopback one', async () => {
    for (const bad of ['198.51.100.1:4873', '192.0.2.1:4873', '[2001:db8::1]:4873', '0.0.0.0:4873', '[::]:4873']) {
      await expect(registryFor(cfgWith(bad)), bad).rejects.toThrow(/^CCRC_TESTBOX_REGISTRY_PROXY: .* is not a loopback address$/);
    }
    // A port the kernel just handed out and released, so the row never collides with another file's.
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
    const a = probe.address();
    const port = typeof a === 'object' && a !== null ? a.port : 0;
    await new Promise<void>((r) => probe.close(() => r()));
    const running = await registryFor(cfgWith(`127.0.0.1:${port}`));
    try {
      expect((await fetch(`http://127.0.0.1:${port}/dep`, { method: 'POST' })).status).toBe(405);
    } finally {
      await running.close();
    }
  });
});
