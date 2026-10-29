// D-7406, D-7420, D-7451, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.2, §2.3,
// §2.5, §2.8, §5 row 1). The test service against a FAKE system manager: each unit's script runs directly, as the
// current user, in a fixture root (Linux and macOS). Nothing here runs `systemctl`, writes a polkit rule or contacts
// a box, a registry or a release host. The prepare unit's script is a fixture (TB3's checkout and TB5's installs are
// not this task's): it lays a fixture package into `run/checkout/`. The run's command is a fixture `vitest` whose
// behaviour its `--mode=` word picks. The fake manager emulates root's two privileges and nothing else: `runs/<k>` is
// writable only while root's prestart and clean steps run, so a run cannot create a sibling of `run`.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync, chmodSync, closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync,
  utimesSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  readTestboxFrame, TESTBOX_FALLBACK, TESTBOX_PROTO,
  type RunLog, type RunSubmit, type RunSummary, type StatusAnswer, type TestboxRepoRow,
} from '../../shared/testbox.js';
import {
  ConfigRefusal, configFromLines, KNOB_FIELD_SEP, knobArgv, parseKnobLines, readRepoRows, readTestboxConfig, realKnobRunner, SERVICE_KNOBS,
} from '../src/testbox/config.js';
import { reflinkProbe } from '../src/testbox/fsprobe.js';
import { AUTH_CLOSE_CODE, checkHello, DEFAULT_HELLO_TIMEOUT_MS } from '../src/testbox/hello.js';
import { listenRefusal, POLICY_CLOSE_CODE, startTestboxServer } from '../src/testbox/main.js';
import { mirrorOps, type MirrorOps } from '../src/testbox/mirror.js';
import { admit, cancel, enqueue, EMPTY_QUEUE, finish, positions, type QueueState } from '../src/testbox/queue.js';
import { cleaned, fillRow, makePool, prepareFailedFrom, retentionPlan, startupSweep, step, takeUser, queuedRun } from '../src/testbox/runs.js';
import { OutputTail } from '../src/testbox/results.js';
import { FRAME_HANDLERS, TestboxService, type Conn, type ServiceSettings } from '../src/testbox/service.js';
import { buildRunSpec, encodeSpec, workerArgv } from '../src/testbox/spec.js';
import { statusAnswer, type StatusFacts } from '../src/testbox/status.js';
import { boundedExec, type Exec } from '../src/testbox/exec.js';
import { checkUnit, systemctlManager, units, unitEnd, unitExit, parseShow, type SystemManager, type UnitEnd } from '../src/testbox/systemd.js';
import { mkTmp } from './tmpHelpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const BIN = path.join(REPO, 'deploy', 'testbox', 'bin');
const ME = os.userInfo().username;
const LINUX = process.platform === 'linux';
/** A unix socket path's cap, as `server/test/run-tmp.globalsetup.mjs#RUN_SUN_PATH_MAX` spells it. */
const SUN_PATH_MAX = LINUX ? 108 : 104;

// ---------------------------------------------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------------------------------------------

/** The fixture command head, `testbox-fixtures/vitest.cjs`: its `--mode=` word picks what the run does. */
const FAKE_VITEST = readFileSync(path.join(HERE, 'testbox-fixtures', 'vitest.cjs'), 'utf8');

/** The fixture prepare unit's script: the package laid into run/checkout/, or the failure line the template asks for. */
const FAKE_PREPARE = `#!/usr/bin/env bash
set -euo pipefail
spec=$1
run=
while IFS= read -r -d '' rec; do case $rec in D*) run=\${rec:1} ;; esac; done < "$spec"
if [ -f "$FIXTURE_TEMPLATE/FAIL_PREPARE" ]; then cat "$FIXTURE_TEMPLATE/FAIL_PREPARE" >&2; exit 1; fi
mkdir -p "$run/checkout"
cp -R "$FIXTURE_TEMPLATE/." "$run/checkout/"
echo prepared
`;

/** A fixture \`chown\` first on the scripts' PATH: the run users and the service user do not exist on a test machine,
 *  and changing an owner is root's privilege the fake manager emulates. It logs its argv and changes nothing. */
function chownStub(dir: string): string {
  const bin = path.join(dir, 'stub-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'chown'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${path.join(dir, 'chown.log')}"\n`, { mode: 0o755 });
  return bin;
}

const SETTINGS = (root: string, over: Partial<ServiceSettings> = {}): ServiceSettings => ({
  root, workers: 3, runTmpdir: '/tmp', toolsDir: path.join(root, 'tools'), envForward: ['CCRC_HISTORY_BASE', 'CCRC_LEDGER_BASE'],
  runUserPrefix: 'ccrc-tb-', reportMaxBytes: 1024, serviceUser: ME, runs: 2, sessionRuns: 1, logTail: 5, retentionMs: 3_600_000, outputDrainMs: 100, ...over,
});

const ROW = (root: string): TestboxRepoRow => ({
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: path.join(root, 'mirrors', 'project-a.git'),
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest', 'npm test'] }],
  buildOutputs: [{ path: 'server/dist', package: 'server', build: ['npm', 'run', 'build'] }], systemTools: [],
});

const BOX_TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const runId = (): string => randomBytes(16).toString('hex');
const SUBMIT = (over: Partial<RunSubmit> = {}): RunSubmit => ({
  t: 'run.submit', runId: runId(), repository: 'project-a', package: 'server', branch: 'main', refs: ['head'], outputs: [],
  argv: ['./node_modules/.bin/vitest', 'run', 'test/a.test.ts', '--mode=pass'], forward: {}, ci: false, workers: 2, session: 'session-a', ...over,
});

interface Proc { child: ChildProcess; done: Promise<UnitEnd> }

/** The fake system manager: each unit's script, run directly as the current user. */
class FakeManager implements SystemManager {
  readonly log: string[] = [];
  readonly running = new Map<string, Proc>();
  readonly forceActive = new Set<string>();
  failCleans = 0;
  constructor(private readonly root: string, private readonly prepare: string, readonly env: Record<string, string>) {}

  private spawnTo(file: string, args: string[], out: string | null, err: string | null): Proc {
    const o = out === null ? 'ignore' : openSync(out, 'w');
    const e = err === null ? 'ignore' : openSync(err, 'w');
    const child = spawn(file, args, { stdio: ['ignore', o, e], env: this.env, detached: true });
    if (typeof o === 'number') closeSync(o);
    if (typeof e === 'number') closeSync(e);
    const done = new Promise<UnitEnd>((resolve) => {
      // What `systemctl start --wait` and `show` would say of this main process, read by the real manager's reader.
      child.on('exit', (code, signal) => {
        const sig = signal === null ? 0 : (os.constants.signals[signal] ?? 0);
        const show = code === null ? `ExecMainCode=killed\nExecMainStatus=${sig}\nResult=signal\n` : `ExecMainCode=exited\nExecMainStatus=${code}\nResult=${code === 0 ? 'success' : 'exit-code'}\n`;
        resolve(unitEnd({ status: code === 0 ? 0 : 3, killed: false }, parseShow(show)));
      });
      child.on('error', () => resolve(unitEnd({ status: 1, killed: false }, parseShow('ExecMainCode=0\nExecMainStatus=0\nResult=resources\n'))));
    });
    return { child, done };
  }

  async run(unit: string): Promise<UnitEnd> {
    checkUnit(unit);
    this.log.push(unit);
    const m = /^ccrc-testbox-(prepare|run|clean)@([0-9]+|install)\.service$/.exec(unit);
    if (m === null) throw new Error(`fake manager has no ${unit}`);
    const [, kind, k] = m as unknown as [string, string, string];
    const spec = path.join(this.root, 'specs', k);
    const out = path.join(this.root, 'out', k);
    const slot = path.join(this.root, 'runs', k);
    if (kind === 'prepare') {
      chmodSync(slot, 0o755);
      const pre = this.spawnTo(path.join(BIN, 'prestart'), [spec], null, path.join(out, 'prestart.stderr'));
      const preEnd = await pre.done;
      chmodSync(slot, 0o555);
      // An `ExecStartPre=` that refused: `start --wait` fails and the main process never ran, so `show` gives the
      // defaults. The same reader as the real manager's reads it.
      if (preEnd.exit !== 0) return unitEnd({ status: 1, killed: false }, parseShow('ExecMainCode=0\nExecMainStatus=0\nResult=exit-code\n'));
      return this.track(unit, this.spawnTo(this.prepare, [spec], path.join(out, 'prepare.stdout'), path.join(out, 'prepare.stderr')));
    }
    if (kind === 'run') return this.track(unit, this.spawnTo(path.join(BIN, 'runner'), [spec], path.join(out, 'stdout'), path.join(out, 'stderr')));
    if (this.failCleans > 0) { this.failCleans--; return { exit: 1, result: 'exit-code' }; }
    chmodSync(slot, 0o755);
    const end = await this.track(unit, this.spawnTo(path.join(BIN, 'clean'), [spec], null, path.join(out, 'clean.stderr')));
    return end;
  }

  private async track(unit: string, p: Proc): Promise<UnitEnd> {
    this.running.set(unit, p);
    try { return await p.done; } finally { this.running.delete(unit); }
  }

  async stop(unit: string): Promise<void> {
    this.log.push(`stop ${unit}`);
    const p = this.running.get(unit);
    if (p?.child.pid !== undefined) { try { process.kill(-p.child.pid, 'SIGTERM'); } catch { /* gone */ } }
  }

  async active(unit: string): Promise<boolean> { return this.running.has(unit) || this.forceActive.has(unit); }
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
  output(id: string, stream: 'stdout' | 'stderr' = 'stdout'): string {
    return this.frames.filter((f): f is RunLog => f.t === 'run.log' && f.runId === id && f.stream === stream)
      .sort((a, b) => a.offset - b.offset).map((f) => Buffer.from(f.bytes, 'base64').toString('utf8')).join('');
  }
}

interface Box {
  root: string;
  template: string;
  mgr: FakeManager;
  svc: TestboxService;
  mirror: RecordingMirror;
  clock: { now: number };
}

class RecordingMirror implements MirrorOps {
  readonly calls: string[] = [];
  refs = new Map<string, string[]>();
  async fetch(m: string) { this.calls.push(`fetch ${path.basename(m)}`); return { status: 0, stdout: '', stderr: '', killed: false }; }
  async runIds(m: string) { return [...(this.refs.get(m) ?? [])]; }
  async deleteRefs(m: string, id: string) { this.calls.push(`delete ${id}`); this.refs.set(m, (this.refs.get(m) ?? []).filter((x) => x !== id)); }
  async gc(m: string) { this.calls.push(`gc ${path.basename(m)}`); return { status: 0, stdout: '', stderr: '', killed: false }; }
}

/** Every fixture root, opened up before `mkTmp`'s own removal runs (hooks after a file run last-registered first): a
 *  failing row can leave a slot at the fake manager's 0555 or a run's read-only directory behind. */
const roots: string[] = [];
afterAll(() => {
  const open = (d: string): void => {
    try { chmodSync(d, 0o755); } catch { return; }
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      try { if (statSync(p).isDirectory() && !lstatIsLink(p)) open(p); } catch { /* gone */ }
    }
  };
  for (const r of roots) if (existsSync(r)) open(r);
});
const lstatIsLink = (p: string): boolean => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

function makeBox(over: Partial<ServiceSettings> = {}, probeOk = true): Box {
  const root = mkTmp('ccrc-tb-svc-');
  roots.push(root);
  const s = SETTINGS(root, over);
  for (let k = 1; k <= s.runs; k++) mkdirSync(path.join(root, 'runs', String(k)), { recursive: true });
  mkdirSync(path.join(ROW(root).mirrorPath), { recursive: true });
  writeFileSync(path.join(ROW(root).mirrorPath, 'HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(path.join(s.toolsDir, 'current', 'bin'), { recursive: true });
  symlinkSync(process.execPath, path.join(s.toolsDir, 'current', 'bin', 'node'));
  const template = path.join(root, 'template');
  mkdirSync(path.join(template, 'server', 'node_modules', '.bin'), { recursive: true });
  mkdirSync(path.join(template, 'server', 'test'), { recursive: true });
  mkdirSync(path.join(template, '.git'), { recursive: true });
  writeFileSync(path.join(template, '.git', 'config'), '[core]\n\tbare = false\n');
  writeFileSync(path.join(template, 'server', 'package.json'), '{"name":"server"}\n');
  writeFileSync(path.join(template, 'server', 'node_modules', '.bin', 'vitest'), FAKE_VITEST, { mode: 0o755 });
  const prepare = path.join(root, 'fake-prepare');
  writeFileSync(prepare, FAKE_PREPARE, { mode: 0o755 });
  const mgr = new FakeManager(root, prepare, {
    PATH: `${chownStub(root)}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: root, FIXTURE_TEMPLATE: template,
    // What a session's environment carries on the fleet host: the runner must drop every one of these.
    CCRC_AGENT_TOKEN: 'fleet-secret', GH_TOKEN: 'fleet-secret', CCRC_TESTBOX_WORKERS: '99', NODE_OPTIONS: '--inspect',
  });
  const clock = { now: Date.now() };
  const mirror = new RecordingMirror();
  const svc = new TestboxService({
    settings: s, rows: [ROW(root)], sys: mgr, probe: async () => (probeOk ? { ok: true } : { ok: false, detail: 'cp: failed to clone: Operation not supported' }),
    mirror, now: () => clock.now, chrome: path.join(s.toolsDir, 'current', 'chrome'), release: 'v1.2.3', serviceVersion: '1.2.3',
    tools: () => BOX_TOOLS,
  });
  return { root, template, mgr, svc, mirror, clock };
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

/** How long a row waits for a live run's streamed output, and the row's own timeout above it: vitest's default 5 s
 *  test timeout would otherwise end the row before its poll could. */
const LIVE_POLL_MS = 20_000;
const LIVE_ROW_TIMEOUT_MS = LIVE_POLL_MS + 10_000;

const runDir = (box: Box, k: number): string => path.join(box.root, 'runs', String(k), 'run');

// ---------------------------------------------------------------------------------------------------------------
// The queue (spec §2.8, D-7420).
// ---------------------------------------------------------------------------------------------------------------

describe('queue.ts: first come first served, one running run per session, a pristine build counting as one', () => {
  const lim = { runs: 2, sessionRuns: 1 };
  const q = (...es: [string, string, 'run' | 'pristine'][]): QueueState =>
    es.reduce<QueueState>((s, [id, session, kind]) => enqueue(s, { id, session, kind })!, EMPTY_QUEUE);

  it('admits in arrival order up to the run limit', () => {
    const r = admit(q(['a', 's1', 'run'], ['b', 's2', 'run'], ['c', 's3', 'run']), lim);
    expect(r.started.map((e) => e.id)).toEqual(['a', 'b']);
    expect(positions(r.state)).toEqual(new Map([['c', 1]]));
  });
  it('a session with a running run waits; a later session passes it', () => {
    const r = admit(q(['a', 's1', 'run'], ['b', 's1', 'run'], ['c', 's2', 'run']), lim);
    expect(r.started.map((e) => e.id)).toEqual(['a', 'c']);
    expect(positions(r.state)).toEqual(new Map([['b', 1]]));
  });
  it('CCRC_TESTBOX_SESSION_RUNS=2 lets a session run two (D-7420)', () => {
    expect(admit(q(['a', 's1', 'run'], ['b', 's1', 'run']), { runs: 2, sessionRuns: 2 }).started.map((e) => e.id)).toEqual(['a', 'b']);
  });
  it('a pristine build counts as one run, and only one runs at a time', () => {
    const r = admit(q(['p1', 'svc', 'pristine'], ['p2', 'svc', 'pristine'], ['a', 's1', 'run'], ['b', 's2', 'run']), lim);
    expect(r.started.map((e) => e.id)).toEqual(['p1', 'a']);
    expect([...positions(r.state).keys()]).toEqual(['p2', 'b']);
  });
  it('positions move as runs end', () => {
    let s = admit(q(['a', 's1', 'run'], ['b', 's2', 'run'], ['c', 's3', 'run'], ['d', 's4', 'run']), lim).state;
    expect(positions(s)).toEqual(new Map([['c', 1], ['d', 2]]));
    s = admit(finish(s, 'a'), lim).state;
    expect(positions(s)).toEqual(new Map([['d', 1]]));
  });
  it('a reused id is refused; a waiting cancel leaves, a running one is the run manager\'s', () => {
    const s = admit(q(['a', 's1', 'run'], ['b', 's1', 'run']), lim).state;
    expect(enqueue(s, { id: 'a', session: 's9', kind: 'run' })).toBeNull();
    expect(cancel(s, 'b').was).toBe('waiting');
    expect(cancel(s, 'b').state.waiting).toEqual([]);
    expect(cancel(s, 'a').was).toBe('running');
    expect(cancel(s, 'zz').was).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The lifecycle deciders (spec §2.2, §2.4, §2.1 "Ref lifetime").
// ---------------------------------------------------------------------------------------------------------------

describe('runs.ts: the pool, the phases, the prepare reason and retention', () => {
  it('a user is taken lowest first and returns only when the clean succeeded and the directory is gone', () => {
    let pool = makePool(2);
    const a = takeUser(pool, 'r1')!; pool = a.pool;
    const b = takeUser(pool, 'r2')!; pool = b.pool;
    expect([a.k, b.k]).toEqual([1, 2]);
    expect(takeUser(pool, 'r3')).toBeNull();
    pool = cleaned(pool, 1, true, false);
    expect(pool[0]).toMatchObject({ state: 'held', runId: 'r1', failures: 1 });
    pool = cleaned(pool, 1, false, true);
    expect(pool[0]).toMatchObject({ state: 'held', failures: 2 });
    pool = cleaned(pool, 1, true, true);
    expect(pool[0]).toMatchObject({ state: 'free', failures: 0 });
  });
  it('the start-up sweep cleans a directory with no active unit and holds one with an active unit', () => {
    const r = startupSweep(makePool(3), [{ k: 1, runDir: true, active: false }, { k: 2, runDir: true, active: true }, { k: 3, runDir: false, active: false }]);
    expect(r.clean).toEqual([1]);
    expect(r.pool.map((s) => s.state)).toEqual(['held', 'held', 'free']);
  });
  it('the phases: prepare, run, clean, summary; a failed prepare skips the run; a cancel stops the unit and still cleans', () => {
    let s = step(queuedRun('r'), { t: 'admitted', k: 2 });
    expect(s.act).toEqual({ t: 'start-prepare', k: 2 });
    let ok = step(s.run, { t: 'prepared', exit: 0, lastStderr: null });
    expect(ok.act).toEqual({ t: 'start-run', k: 2 });
    ok = step(ok.run, { t: 'ran', exit: 1 });
    expect(ok.act).toEqual({ t: 'start-clean', k: 2 });
    expect(step(ok.run, { t: 'cleaned' }).act).toEqual({ t: 'summarise' });
    const bad = step(s.run, { t: 'prepared', exit: 1, lastStderr: 'test box: install failed (server, exit 1)' });
    expect(bad.act).toEqual({ t: 'start-clean', k: 2 });
    expect(bad.run.prepareFailed).toEqual({ id: 'install-failed', text: 'test box: install failed (server, exit 1)' });
    s = step(s.run, { t: 'prepared', exit: 0, lastStderr: null });
    const c = step(s.run, { t: 'cancel' });
    expect(c.act).toEqual({ t: 'stop', unit: 'run', k: 2 });
    expect(step(c.run, { t: 'ran', exit: 143 }).act).toEqual({ t: 'start-clean', k: 2 });
    expect(step(queuedRun('q'), { t: 'cancel' }).act).toEqual({ t: 'drop' });
  });
  it('prepareFailed reasons are TESTBOX_FALLBACK\'s words; an unworded failure is the checkout step with its exit', () => {
    for (const id of ['prepare-failed', 'install-failed', 'build-failed'] as const) {
      const row = TESTBOX_FALLBACK.find((r) => r.id === id)!;
      const text = row.text.replace(/<[^>]+>/g, 'x');
      expect(prepareFailedFrom(1, text)).toEqual({ id, text });
    }
    expect(prepareFailedFrom(7, 'npm ERR! something')).toEqual({ id: 'prepare-failed', text: 'test box: prepare failed (git checkout: exit 7)' });
    expect(fillRow('build-failed', ['server/dist', '2'])).toBe('test box: build failed (server/dist, exit 2)');
  });
  it('retention: results and logs go after the time; refs only after the time AND the directory\'s deletion', () => {
    const H = 3_600_000;
    const kept = [
      { runId: 'old', at: 0, results: true, logs: true, refs: true },
      { runId: 'live', at: 0, results: true, logs: true, refs: true },
      { runId: 'new', at: 2 * H - 1, results: true, logs: true, refs: true },
    ];
    const plan = retentionPlan(kept, new Set(['live']), 2 * H, H);
    expect(plan).toEqual({ results: ['old', 'live'], logs: ['old', 'live'], refs: ['old'] });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The status answer (spec §2.7).
// ---------------------------------------------------------------------------------------------------------------

describe('status.ts: ok, degraded and down', () => {
  const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
  const facts = (over: Partial<StatusFacts> = {}): StatusFacts => ({
    reflink: { ok: true }, mirrors: [{ name: 'project-a', mirrorPath: '/srv/m/project-a.git', present: true }], release: 'v1.2.3',
    serviceVersion: '1.2.3', tools: TOOLS, fleetTools: TOOLS, sync: { state: 'idle', detail: null, at: null }, inProgress: 1, limit: 2,
    queueDepth: 3, pristine: [], failedKeys: [], heldRunUsers: [], ...over,
  });
  const reread = (a: StatusAnswer): StatusAnswer => {
    const r = readTestboxFrame(JSON.stringify(a));
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    return a;
  };
  it('ok, and the answer passes the frame reader', () => {
    const a = reread(statusAnswer(facts()));
    expect([a.state, a.reason, a.proto, a.runs, a.queueDepth]).toEqual(['ok', null, TESTBOX_PROTO, { inProgress: 1, limit: 2 }, 3]);
  });
  it('the reflink probe failing gives down, and so does a missing mirror', () => {
    expect(reread(statusAnswer(facts({ reflink: { ok: false, detail: 'not supported' } })))).toMatchObject({ state: 'down', reason: 'no reflink on the run root (not supported)' });
    expect(reread(statusAnswer(facts({ mirrors: [{ name: 'project-a', mirrorPath: '/srv/m/project-a.git', present: false }] })))).toMatchObject({ state: 'down', reason: 'missing mirror project-a' });
  });
  it('degraded: a held run user, a failed sync, a differing tool cell, unmeasured tools', () => {
    expect(reread(statusAnswer(facts({ heldRunUsers: ['ccrc-tb-2'] })))).toMatchObject({ state: 'degraded', reason: 'run user held out (ccrc-tb-2)' });
    expect(statusAnswer(facts({ sync: { state: 'failed', detail: 'node: checksum', at: null } })).reason).toBe('tool sync failed (node: checksum)');
    expect(statusAnswer(facts({ fleetTools: { ...TOOLS, node: '22.11.1' } })).reason).toBe('tool version differs (node)');
    expect(reread(statusAnswer(facts({ tools: null, release: null })))).toMatchObject({ state: 'degraded', reason: 'tool versions not measured; release not known' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The settings (D-7451): one read, through the printer, never the environment.
// ---------------------------------------------------------------------------------------------------------------

const KNOB_VALUES: Record<string, string> = {
  CCRC_TESTBOX_RUNS: '4', CCRC_TESTBOX_SESSION_RUNS: '1', CCRC_TESTBOX_WORKERS: '3', CCRC_TESTBOX_RUN_TMPDIR: '/tmp/r',
  CCRC_TESTBOX_ROOT: '/srv/testbox', CCRC_TESTBOX_REPOS: '~/.ccrc/testbox-repos.d', CCRC_TESTBOX_FETCH_EVERY: '5m',
  CCRC_TESTBOX_RETENTION: '24h', CCRC_TESTBOX_REPORT_MAX: '16M', CCRC_TESTBOX_TOOLS_DIR: '/opt/ccrc-testbox/tools',
  CCRC_TESTBOX_ENV_FORWARD: 'CCRC_HISTORY_BASE CCRC_LEDGER_BASE', CCRC_TESTBOX_RUN_USER_PREFIX: 'ccrc-tb-', CCRC_TESTBOX_LOG_TAIL: '40',
  CCRC_TESTBOX_SERVICE_USER: 'ccrc-tb-svc', CCRC_TESTBOX_LISTEN: '192.0.2.10:7790', CCRC_TESTBOX_SERVICE_TOKEN_FILE: '/etc/ccrc-testbox/service.token',
  CCRC_TESTBOX_UNIT_MAX: '1h',
};
const knobText = (vals: Record<string, string>): string =>
  `${Object.entries(vals).map(([k, v]) => [k, v, v, 'file'].join(KNOB_FIELD_SEP)).join('\n')}\n`;

describe('config.ts: the service reads its settings once, from the box-mode printer (D-7451)', () => {
  it('the lines become the settings; ~/ is the service user\'s home', () => {
    const c = configFromLines(parseKnobLines(knobText(KNOB_VALUES)), '/home/svc');
    expect(c).toMatchObject({
      runs: 4, sessionRuns: 1, workers: 3, runTmpdir: '/tmp/r', root: '/srv/testbox', repos: '/home/svc/.ccrc/testbox-repos.d',
      fetchEveryMs: 300_000, retentionMs: 86_400_000, reportMaxBytes: 16 * 1024 * 1024, envForward: ['CCRC_HISTORY_BASE', 'CCRC_LEDGER_BASE'],
      logTail: 40, serviceUser: 'ccrc-tb-svc', listen: { host: '192.0.2.10', port: 7790 }, tokenFile: '/etc/ccrc-testbox/service.token',
      unitMaxMs: 3_600_000,
    });
  });
  it.each(SERVICE_KNOBS)('a printer without %s refuses the start', (k) => {
    const vals = { ...KNOB_VALUES };
    delete vals[k];
    expect(() => configFromLines(parseKnobLines(knobText(vals)), '/home/svc')).toThrow(ConfigRefusal);
  });
  it('a line without four fields, a key twice and a bad value each refuse', () => {
    expect(() => parseKnobLines('CCRC_TESTBOX_RUNS\x1f2\x1f2\n')).toThrow(/four fields/);
    expect(() => parseKnobLines(`${knobText({ CCRC_TESTBOX_RUNS: '2' })}${knobText({ CCRC_TESTBOX_RUNS: '2' })}`)).toThrow(/twice/);
    expect(() => configFromLines(parseKnobLines(knobText({ ...KNOB_VALUES, CCRC_TESTBOX_RUNS: '0' })), '/h')).toThrow(/count/);
    expect(() => configFromLines(parseKnobLines(knobText({ ...KNOB_VALUES, CCRC_TESTBOX_RETENTION: '24' })), '/h')).toThrow(/duration/);
  });
  it('the printer runs as `<release>/ccd/ccrc-test --testbox-knobs box`, with HOME, PATH and LANG only (a fixture printer)', async () => {
    const release = mkTmp('ccrc-tb-rel-');
    mkdirSync(path.join(release, 'ccd'));
    const seen = path.join(release, 'seen');
    // The fixture printer records its argv and environment, then prints the lines TB1's flag would.
    writeFileSync(path.join(release, 'ccd', 'ccrc-test'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${seen}.argv"\nenv | cut -d= -f1 | sort > "${seen}.env"\ncat "${path.join(release, 'lines')}"\n`, { mode: 0o755 });
    writeFileSync(path.join(release, 'lines'), knobText({ ...KNOB_VALUES, CCRC_TESTBOX_WORKERS: '5' }));
    const prev = process.env.CCRC_TESTBOX_WORKERS;
    process.env.CCRC_TESTBOX_WORKERS = '9';
    try {
      const c = await readTestboxConfig(release, realKnobRunner, '/home/svc', process.env.PATH);
      expect(c.workers).toBe(5);
    } finally {
      if (prev === undefined) delete process.env.CCRC_TESTBOX_WORKERS; else process.env.CCRC_TESTBOX_WORKERS = prev;
    }
    expect(readFileSync(`${seen}.argv`, 'utf8')).toBe('--testbox-knobs\nbox\n');
    expect(readFileSync(`${seen}.env`, 'utf8').split('\n').filter((l) => l !== '' && l !== 'PWD' && l !== 'SHLVL' && l !== '_')).toEqual(['HOME', 'LANG', 'PATH']);
    expect(knobArgv('/r')).toEqual({ file: '/r/ccd/ccrc-test', args: ['--testbox-knobs', 'box'] });
  });
  it('a printer that fails refuses the start with its first stderr line', async () => {
    const run = async () => ({ status: 1, stdout: '', stderr: 'ccrc-test: unknown flag --testbox-knobs\n' });
    await expect(readTestboxConfig('/r', run, '/h')).rejects.toThrow(/unknown flag --testbox-knobs/);
  });
  it('no file under agent/src/testbox reads process.env for a test box key or names a ccrc.env', () => {
    const dir = path.join(REPO, 'agent', 'src', 'testbox');
    const offenders = readdirSync(dir).filter((f) => f.endsWith('.ts')).filter((f) => {
      const t = readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
      return /process\.env(\.|\[\s*['"`])CCRC_TESTBOX_/.test(t) || /ccrc\.env/.test(t);
    });
    expect(offenders).toEqual([]);
  });
  it('the repository table: a bad row refuses the start, naming its file', () => {
    const dir = mkTmp('ccrc-tb-repos-');
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ ...ROW('/srv'), mirrorPath: '/srv/m/project-a.git' }));
    expect(readRepoRows(dir).map((r) => r.name)).toEqual(['project-a']);
    writeFileSync(path.join(dir, 'b.json'), '{"name":"project-b"}');
    expect(() => readRepoRows(dir)).toThrow(/b\.json/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The adapters' fences.
// ---------------------------------------------------------------------------------------------------------------

describe('systemd.ts: the static unit names only, the polkit rule\'s regex', () => {
  it('accepts exactly the names the service starts', () => {
    expect([units.prepare(1), units.run(12), units.clean(3), units.clean('install'), units.install(), units.tools()]).toEqual([
      'ccrc-testbox-prepare@1.service', 'ccrc-testbox-run@12.service', 'ccrc-testbox-clean@3.service', 'ccrc-testbox-clean@install.service',
      'ccrc-testbox-install.service', 'ccrc-testbox-tools.service',
    ]);
  });
  it.each(['ccrc-testbox.service', 'ccrc-testbox-run@x.service', 'ccrc-testbox-run@install.service', 'ccrc-agent.service',
    'xccrc-testbox-run@1.service', 'ccrc-testbox-run@1.service.d', 'ccrc-testbox-prepare@1.service; reboot'])('refuses %s', (n) => {
    expect(() => checkUnit(n)).toThrow(/not a test box unit/);
  });
  const recorder = (calls: string[][], killedStart = false): Exec => async (file, args) => {
    calls.push([file, ...args]);
    const stdout = args[0] === 'show' ? (args.includes('ActiveState') ? 'ActiveState=active\n' : 'ExecMainCode=2\nExecMainStatus=15\nResult=signal\n') : '';
    return { status: 0, stdout, stderr: '', killed: killedStart && args[0] === 'start' };
  };
  it('runs `systemctl start --wait` under the long bound, `show` and `stop` under the short one, and a refused name reaches no exec', async () => {
    const short: string[][] = [];
    const long: string[][] = [];
    const m = systemctlManager(recorder(short), recorder(long), 'systemctl');
    expect(await m.run(units.run(1))).toEqual({ exit: 143, result: 'signal' });
    await m.stop(units.run(1));
    expect(await m.active(units.prepare(1))).toBe(true);
    await expect(m.run('ccrc-agent.service')).rejects.toThrow(/not a test box unit/);
    expect(long).toEqual([['systemctl', 'start', '--wait', 'ccrc-testbox-run@1.service']]);
    expect(short).toEqual([
      ['systemctl', 'show', '-p', 'ExecMainCode', '-p', 'ExecMainStatus', '-p', 'Result', 'ccrc-testbox-run@1.service'],
      ['systemctl', 'stop', 'ccrc-testbox-run@1.service'],
      ['systemctl', 'show', '-p', 'ActiveState', 'ccrc-testbox-prepare@1.service'],
    ]);
    expect(unitExit(parseShow('ExecMainCode=1\nExecMainStatus=3\n'))).toBe(3);
  });
  // What `systemctl` answers when the main process never ran or `start` itself failed: `show` then gives default or
  // stale ExecMain values, so only `start`'s own status, `Result=` and `ExecMainCode` tell a pass from a unit that
  // never ran.
  const answering = (startStatus: number, show: string): Exec => async (_file, args) =>
    ({ status: args[0] === 'start' ? startStatus : 0, stdout: args[0] === 'show' ? show : '', stderr: '', killed: false });
  it.each([
    ['ExecStartPre= refused (start exits 1, the main never ran)', 1, 'ExecMainCode=0\nExecMainStatus=0\nResult=exit-code\n'],
    ['a unit that is not found (start exits 5, show gives the defaults)', 5, 'ExecMainCode=0\nExecMainStatus=0\nResult=success\n'],
    ['a denied start (start exits 4, show gives the last run\'s pass)', 4, 'ExecMainCode=1\nExecMainStatus=0\nResult=success\n'],
    ['a start that exits 0 but whose main never ran', 0, 'ExecMainCode=0\nExecMainStatus=0\nResult=success\n'],
    ['a start that exits 0 with no ExecMainCode', 0, 'ExecMainStatus=0\nResult=success\n'],
    ['a main that exited 0 in a unit whose Result is not success', 0, 'ExecMainCode=1\nExecMainStatus=0\nResult=timeout\n'],
  ])('never a pass: %s', async (_name, startStatus, show) => {
    const m = systemctlManager(answering(startStatus, show), answering(startStatus, show), 'systemctl');
    expect((await m.run(units.run(1))).exit).not.toBe(0);
    expect(unitEnd({ status: startStatus, killed: false }, parseShow(show)).exit).not.toBe(0);
  });
  it('a real pass is 0, a test failure keeps its exit, a signal is 128 plus its number', async () => {
    const read = async (startStatus: number, show: string) => (await systemctlManager(answering(startStatus, show), answering(startStatus, show), 'systemctl').run(units.run(1)));
    expect(await read(0, 'ExecMainCode=1\nExecMainStatus=0\nResult=success\n')).toEqual({ exit: 0, result: 'success' });
    expect(await read(3, 'ExecMainCode=1\nExecMainStatus=1\nResult=exit-code\n')).toEqual({ exit: 1, result: 'exit-code' });
    expect(await read(3, 'ExecMainCode=2\nExecMainStatus=15\nResult=signal\n')).toEqual({ exit: 143, result: 'signal' });
  });
  it('a `start --wait` the bound ended stops the unit before its end is read', async () => {
    const short: string[][] = [];
    const m = systemctlManager(recorder(short), recorder([], true), 'systemctl');
    await m.run(units.run(2));
    expect(short.map((c) => c[1])).toEqual(['stop', 'show']);
  });
  it('the bounded exec is the spawn kernel\'s: a real child, its exit, its output, the whole environment the caller gave', async () => {
    const r = await boundedExec({ PATH: process.env.PATH ?? '/usr/bin:/bin', ONLY: 'this' }, 20_000)('/bin/sh', ['-c', 'echo "$ONLY"; exit 3']);
    expect(r).toEqual({ status: 3, stdout: 'this\n', stderr: '', killed: false });
    const k = await boundedExec({ PATH: process.env.PATH ?? '/usr/bin:/bin' }, 100)(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    expect(k.killed).toBe(true);
  });
});

describe('fsprobe.ts: the reflink probe', () => {
  it('a cp that cannot clone gives its reason, and both probe files are gone', async () => {
    const root = mkTmp('ccrc-tb-probe-');
    const calls: string[][] = [];
    const r = await reflinkProbe(root, async (f, a) => { calls.push([f, ...a]); return { status: 1, stdout: '', stderr: "cp: failed to clone 'x': Operation not supported\n", killed: false }; });
    expect(r).toEqual({ ok: false, detail: "cp: failed to clone 'x': Operation not supported" });
    expect(calls[0]!.slice(0, 3)).toEqual(['cp', '--reflink=always', '--']);
    expect(readdirSync(root)).toEqual([]);
    expect(await reflinkProbe(root, async () => ({ status: 0, stdout: '', stderr: '', killed: false }))).toEqual({ ok: true });
  });
  it('a box whose probe fails answers down', async () => {
    const box = makeBox({}, false);
    await box.svc.start();
    expect(box.svc.status()).toMatchObject({ state: 'down', reason: 'no reflink on the run root (cp: failed to clone: Operation not supported)' });
  });
});

describe('mirror.ts: the fetch prunes only its own refspec, and run refs go one run at a time (a fixture bare mirror)', () => {
  it('a timer fetch keeps refs/ccrc-test/*, and deleteRefs removes one run\'s refs only', async () => {
    const dir = mkTmp('ccrc-tb-mirror-');
    const env = { HOME: dir, PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', LANG: 'C' };
    const g = (cwd: string, ...a: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@testbox.invalid', ...a], { cwd, env, encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    };
    const up = path.join(dir, 'up');
    mkdirSync(up);
    g(up, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(up, 'f'), '1');
    g(up, 'add', 'f');
    g(up, 'commit', '-q', '-m', 'one');
    const m = path.join(dir, 'project-a.git');
    g(dir, 'clone', '-q', '--bare', up, m);
    g(m, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    const sha = g(up, 'rev-parse', 'HEAD');
    const a = 'a'.repeat(32);
    const b = 'b'.repeat(32);
    g(m, 'update-ref', `refs/ccrc-test/${a}/head`, sha);
    g(m, 'update-ref', `refs/ccrc-test/${b}/head`, sha);
    g(m, 'update-ref', `refs/ccrc-test/${b}/base`, sha);
    const { realGit } = await import('../src/testbox/mirror.js');
    const ops = mirrorOps(realGit(boundedExec(env, 60_000)));
    expect((await ops.fetch(m)).status).toBe(0);
    expect(await ops.runIds(m)).toEqual([a, b]);
    await ops.deleteRefs(m, b);
    expect(await ops.runIds(m)).toEqual([a]);
    expect(g(m, 'rev-parse', 'refs/remotes/origin/main')).toBe(sha);
    await expect(ops.deleteRefs(m, '../heads')).rejects.toThrow(/not a run id/);
  });
});

describe('hello.ts: the fleet agent\'s hello contract, twinned and pinned', () => {
  it('the close code and the hello timeout equal agent/src/server.ts\'s own constants', () => {
    const src = readFileSync(path.join(REPO, 'agent', 'src', 'server.ts'), 'utf8');
    expect(Number(/const AUTH_CLOSE_CODE = (\d+);/.exec(src)?.[1])).toBe(AUTH_CLOSE_CODE);
    expect(Number(/const DEFAULT_HELLO_TIMEOUT_MS = (\d+);/.exec(src)?.[1])).toBe(DEFAULT_HELLO_TIMEOUT_MS);
    expect(src).toContain("ws.close(AUTH_CLOSE_CODE, 'hello-timeout')");
    expect(src).toContain("ws.close(AUTH_CLOSE_CODE, 'unauthorized')");
  });
  it('only a hello carrying exactly the token passes', () => {
    expect(checkHello({ t: 'hello', token: 'tok' }, 'tok')).toBe('ok');
    for (const m of [{ t: 'hello', token: 'tok2' }, { t: 'hello' }, { t: 'hello', token: 1 }, { t: 'ping', token: 'tok' }, null, 'tok']) {
      expect(checkHello(m, 'tok')).toBe('unauthorized');
    }
    expect(checkHello({ t: 'hello', token: '' }, '')).toBe('unauthorized');
  });
});

describe('main.ts: the tailnet address only (spec §2.0)', () => {
  it.each(['0.0.0.0', '::', '', '127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', 'localhost', 'testbox.invalid'])('refuses %s', (h) => {
    expect(listenRefusal(h)).not.toBeNull();
  });
  // The same addresses spelled another way: the guard compares addresses, not strings.
  it.each(['0:0:0:0:0:0:0:0', '::0', '0::', '0000::', '::ffff:0.0.0.0', '::ffff:0:0', '0:0:0:0:0:ffff:0.0.0.0'])('refuses %s as every interface', (h) => {
    expect(listenRefusal(h)).toMatch(/every interface/);
  });
  it.each(['0:0:0:0:0:0:0:1', '::0:1', '0::1', '::ffff:7f00:1', '::ffff:127.9.9.9', '0:0:0:0:0:ffff:7f00:0001', '::FFFF:127.0.0.1'])('refuses %s as loopback', (h) => {
    expect(listenRefusal(h)).toMatch(/loopback/);
  });
  it.each(['0:0:0:0:0:0:0:0', '::0', '0::', '::ffff:0.0.0.0'])('the server itself refuses to bind %s', async (h) => {
    const box = makeBox();
    await expect(startTestboxServer({ host: h, port: 0, token: 'tok', service: box.svc })).rejects.toThrow(/must not bind/);
  });
  // 100.100.1.1 is the CGNAT-range (tailnet-shaped) row: the one placeholder
  // topology-clean's CGNAT class sanctions.
  it.each(['192.0.2.10', '2001:db8::10', '100.100.1.1', 'fd7a:115c:a1e0::1', '::ffff:192.0.2.10'])('accepts %s', (h) => {
    expect(listenRefusal(h)).toBeNull();
  });
});

describe('the WebSocket door: hello, the status answer, refusals', () => {
  const open = async (port: number) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const frames: string[] = [];
    ws.on('message', (d) => frames.push(d.toString()));
    const closed = new Promise<{ code: number; reason: string }>((r) => ws.on('close', (code, reason) => r({ code, reason: reason.toString() })));
    await new Promise<void>((r, j) => { ws.once('open', () => r()); ws.once('error', j); });
    return { ws, frames, closed };
  };
  it('a right token gets the status answer; a wrong one and a late one close with 4401', async () => {
    const box = makeBox();
    await box.svc.start();
    const srv = await startTestboxServer({ host: '127.0.0.1', port: 0, token: 'tok', service: box.svc, helloTimeoutMs: 200 });
    try {
      const a = await open(srv.port);
      a.ws.send(JSON.stringify({ t: 'hello', token: 'tok' }));
      await expect.poll(() => a.frames.length).toBe(1);
      const st = readTestboxFrame(a.frames[0]!);
      expect(st.ok && st.value.t === 'status' && st.value.state).toBe('ok');
      // A frame the service does not take, and one its reader refuses, each close with the policy code.
      a.ws.send(JSON.stringify({ t: 'run.cancel', runId: 'x' }));
      expect((await a.closed).code).toBe(POLICY_CLOSE_CODE);
      const b = await open(srv.port);
      b.ws.send(JSON.stringify({ t: 'hello', token: 'nope' }));
      expect(await b.closed).toEqual({ code: AUTH_CLOSE_CODE, reason: 'unauthorized' });
      const c = await open(srv.port);
      expect(await c.closed).toEqual({ code: AUTH_CLOSE_CODE, reason: 'hello-timeout' });
    } finally {
      await srv.close();
    }
  });
  it('the dispatch table takes run.submit and run.cancel, nothing else yet', () => {
    expect(Object.keys(FRAME_HANDLERS).sort()).toEqual(['run.cancel', 'run.submit']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Runs, end to end through the fake system manager.
// ---------------------------------------------------------------------------------------------------------------

describe('a run through the units: prepare, run, clean, summary', () => {
  it('a run passes with the command\'s exit, and its directory is gone with the user back in the pool', async () => {
    const box = makeBox();
    await box.svc.start();
    const { summary, sink, id } = await runOne(box);
    expect(summary).toMatchObject({ exit: 0, ranOn: 'test-box', report: 'ok', failed: { files: [], tests: [] }, prepareFailed: null });
    expect(readTestboxFrame(JSON.stringify(summary)).ok).toBe(true);
    expect(sink.output(id)).toContain('workers=3');
    expect(box.mgr.log).toEqual(['ccrc-testbox-prepare@1.service', 'ccrc-testbox-run@1.service', 'ccrc-testbox-clean@1.service']);
    expect(existsSync(runDir(box, 1))).toBe(false);
    expect(box.svc.poolNow().map((s) => s.state)).toEqual(['free', 'free']);
    expect(readFileSync(path.join(box.root, 'logs', id, 'run.log'), 'utf8')).toContain('workers=3');
    expect(existsSync(path.join(box.root, 'results', id, 'summary.json'))).toBe(true);
  });
  it('a run fails with the command\'s exit; the failed file and test come from the collected report', async () => {
    const box = makeBox();
    await box.svc.start();
    const { summary, sink, id } = await runOne(box, { argv: ['./node_modules/.bin/vitest', 'run', '--mode=fail'] });
    expect(summary).toMatchObject({ exit: 1, report: 'ok', failed: { files: ['server/test/b.test.ts'], tests: ['b fails'] } });
    expect(sink.output(id, 'stderr')).toContain('b fails');
    expect(summary.logTail.some((l) => l.includes('b fails'))).toBe(true);
    expect(summary.wallMs).toBeGreaterThanOrEqual(0);
  });
  it('a killed run\'s directory is still removed (spec §5 row 3)', async () => {
    const box = makeBox();
    await box.svc.start();
    const sink = new Sink();
    const f = SUBMIT({ argv: ['./node_modules/.bin/vitest', 'run', '--mode=sleep'] });
    box.svc.submit(f, sink);
    await expect.poll(() => sink.output(f.runId), { timeout: LIVE_POLL_MS }).toContain('started');
    await box.svc.cancel(f.runId);
    const summary = await sink.summary(f.runId);
    await box.svc.idle();
    expect(summary.exit).toBe(128 + os.constants.signals.SIGTERM);
    expect(box.mgr.log).toContain('stop ccrc-testbox-run@1.service');
    expect(existsSync(runDir(box, 1))).toBe(false);
    expect(box.svc.poolNow()[0]!.state).toBe('free');
  }, LIVE_ROW_TIMEOUT_MS);
  it('a waiting run cancelled leaves the queue, nothing started for it', async () => {
    const box = makeBox({ runs: 1 });
    await box.svc.start();
    const sink = new Sink();
    const first = SUBMIT({ argv: ['./node_modules/.bin/vitest', 'run', '--mode=sleep'] });
    const second = SUBMIT({ session: 'session-b' });
    box.svc.submit(first, sink);
    box.svc.submit(second, sink);
    expect(box.svc.positions()).toEqual(new Map([[second.runId, 1]]));
    expect(box.svc.status().queueDepth).toBe(1);
    await box.svc.cancel(second.runId);
    expect(box.svc.status().queueDepth).toBe(0);
    await expect.poll(() => sink.output(first.runId), { timeout: LIVE_POLL_MS }).toContain('started');
    await box.svc.cancel(first.runId);
    await sink.summary(first.runId);
    await box.svc.idle();
    expect(sink.frames.some((x) => x.t === 'run.summary' && x.runId === second.runId)).toBe(false);
  }, LIVE_ROW_TIMEOUT_MS);
  it('a failed prepare runs nothing of the command, cleans up and says why in TESTBOX_FALLBACK\'s words', async () => {
    const box = makeBox();
    writeFileSync(path.join(box.template, 'FAIL_PREPARE'), 'npm ci output\ntest box: install failed (server, exit 1)\n');
    await box.svc.start();
    const { summary } = await runOne(box);
    expect(summary).toMatchObject({ exit: 1, prepareFailed: { id: 'install-failed', text: 'test box: install failed (server, exit 1)' }, builtOnBox: [] });
    expect(box.mgr.log).toEqual(['ccrc-testbox-prepare@1.service', 'ccrc-testbox-clean@1.service']);
    expect(existsSync(runDir(box, 1))).toBe(false);
  });
  it('a prepare whose prestart refused (the run directory is there already) is a failure, and a previous run\'s prepare stderr gives no reason', async () => {
    const box = makeBox();
    await box.svc.start();
    mkdirSync(runDir(box, 1));
    // What the last run of slot 1 left in the output directory the system manager writes to.
    writeFileSync(path.join(box.root, 'out', '1', 'prepare.stderr'), 'test box: install failed (server, exit 1)\n');
    writeFileSync(path.join(box.root, 'out', '1', 'prepare.stdout'), 'prepared\n');
    const { summary } = await runOne(box);
    expect(summary.exit).not.toBe(0);
    expect(summary.prepareFailed?.id).toBe('prepare-failed');
    expect(summary.prepareFailed?.text).not.toContain('install failed');
    expect(box.mgr.log).toEqual(['ccrc-testbox-prepare@1.service', 'ccrc-testbox-clean@1.service']);
  });
  it('the build outputs the local tree has are reported as built on the box', async () => {
    const box = makeBox();
    await box.svc.start();
    expect((await runOne(box, { outputs: ['server/dist'] })).summary.builtOnBox).toEqual(['server/dist']);
  });
  it('a cleanup that fails holds the user out, counted, and the next sweep retries it', async () => {
    const box = makeBox({ runs: 1 });
    await box.svc.start();
    box.mgr.failCleans = 1;
    await runOne(box);
    expect(existsSync(runDir(box, 1))).toBe(true);
    expect(box.svc.poolNow()[0]).toMatchObject({ state: 'held', failures: 1 });
    expect(box.svc.status()).toMatchObject({ state: 'degraded', reason: 'run user held out (ccrc-tb-1)', heldRunUsers: ['ccrc-tb-1'] });
    // While the only user is held, a new run waits.
    const sink = new Sink();
    const f = SUBMIT({ session: 'session-b' });
    box.svc.submit(f, sink);
    expect(box.svc.status().queueDepth).toBe(1);
    await box.svc.sweep();
    expect((await sink.summary(f.runId)).exit).toBe(0);
    await box.svc.idle();
    expect(box.svc.status()).toMatchObject({ state: 'ok', heldRunUsers: [] });
  });
  it('the start-up sweep cleans a directory a reboot left, and holds one whose unit is still active', async () => {
    const box = makeBox();
    for (const k of [1, 2]) {
      mkdirSync(path.join(runDir(box, k), 'checkout'), { recursive: true });
      writeFileSync(path.join(runDir(box, k), 'checkout', 'left'), 'x');
      const spec = buildRunSpec(SUBMIT(), ROW(box.root), k, SETTINGS(box.root), '/c');
      if (!spec.ok) throw new Error(spec.reason);
      mkdirSync(path.join(box.root, 'specs'), { recursive: true });
      writeFileSync(path.join(box.root, 'specs', String(k)), encodeSpec(spec.spec));
    }
    box.mgr.forceActive.add('ccrc-testbox-run@2.service');
    await box.svc.start();
    expect(existsSync(runDir(box, 1))).toBe(false);
    expect(existsSync(runDir(box, 2))).toBe(true);
    expect(box.svc.poolNow().map((s) => s.state)).toEqual(['free', 'held']);
    box.mgr.forceActive.clear();
    await box.svc.sweep();
    expect(existsSync(runDir(box, 2))).toBe(false);
    expect(box.svc.poolNow().map((s) => s.state)).toEqual(['free', 'free']);
  });
  it('a submission the box will not run is refused with its reason, and nothing starts', async () => {
    const box = makeBox();
    await box.svc.start();
    const cases: [Partial<RunSubmit>, RegExp][] = [
      [{ repository: 'project-b' }, /not set up there/],
      [{ package: 'pwa' }, /package pwa/],
      [{ argv: ['./node_modules/.bin/tsx', 'x'] }, /runs locally/],
      [{ forward: { GH_TOKEN: 'x' } }, /GH_TOKEN is not a forwarded name/],
      [{ outputs: ['server/dist-pwa'] }, /not declared/],
    ];
    for (const [over, why] of cases) {
      const sink = new Sink();
      box.svc.submit(SUBMIT(over), sink);
      expect(sink.refusals.join(';')).toMatch(why);
    }
    const sink = new Sink();
    const f = SUBMIT();
    box.svc.submit(f, sink);
    await sink.summary(f.runId);
    await box.svc.idle();
    const again = new Sink();
    box.svc.submit({ ...f, session: 'session-z' }, again);
    expect(again.refusals).toEqual([`run id ${f.runId} already used`]);
    expect(box.mgr.log.filter((u) => u.startsWith('ccrc-testbox-prepare'))).toHaveLength(1);
  });
});

describe('the output tail: streamed on the watchers AND on a periodic drain, so a missed watch event never stalls the log', () => {
  it('a write is sent within one drain interval with no watch event at all (fake timers: no event can be delivered)', () => {
    const dir = mkTmp('ccrc-tb-tail-');
    const out = path.join(dir, 'out');
    mkdirSync(out);
    writeFileSync(path.join(out, 'stdout'), '');
    const chunks: string[] = [];
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const tail = new OutputTail(out, path.join(dir, 'logs', 'run.log'), (c) => chunks.push(c.bytes.toString('utf8')), 250);
      tail.watch();
      writeFileSync(path.join(out, 'stdout'), 'started\n');
      expect(chunks).toEqual([]);
      vi.advanceTimersByTime(250);
      expect(chunks).toEqual(['started\n']);
      appendFileSync(path.join(out, 'stdout'), 'more\n');
      vi.advanceTimersByTime(250);
      expect(chunks).toEqual(['started\n', 'more\n']);
      tail.stop();
      appendFileSync(path.join(out, 'stdout'), 'after stop\n');
      vi.advanceTimersByTime(1000);
      expect(chunks).toEqual(['started\n', 'more\n']);
      expect(readFileSync(path.join(dir, 'logs', 'run.log'), 'utf8')).toBe('started\nmore\n');
    } finally {
      vi.useRealTimers();
    }
  });
  it('a tail whose output directory does not exist yet still drains once it does', () => {
    const dir = mkTmp('ccrc-tb-tail-');
    const out = path.join(dir, 'out');
    const chunks: string[] = [];
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      const tail = new OutputTail(out, path.join(dir, 'logs', 'run.log'), (c) => chunks.push(c.bytes.toString('utf8')), 250);
      tail.watch();
      mkdirSync(out);
      writeFileSync(path.join(out, 'stderr'), 'late\n');
      vi.advanceTimersByTime(250);
      expect(chunks).toEqual(['late\n']);
      tail.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the report: collected as a regular file under the cap, or `no report (<reason>)` with the exit kept', () => {
  it.each([
    ['report-none', 'missing'],
    ['report-big', 'oversized'],
    ['report-link', 'not-regular'],
    ['report-dir', 'not-regular'],
  ] as const)('%s gives %s', async (mode, word) => {
    const box = makeBox();
    await box.svc.start();
    const { summary, id } = await runOne(box, { argv: ['./node_modules/.bin/vitest', 'run', `--mode=${mode}`] });
    expect(summary).toMatchObject({ exit: 0, report: word, failed: { files: [], tests: [] } });
    expect(existsSync(path.join(box.root, 'results', id, 'report.json'))).toBe(false);
    expect(readFileSync(path.join(box.root, 'results', id, 'report.status'), 'utf8')).toBe(`${word}\n`);
    expect(existsSync(runDir(box, 1))).toBe(false);
  });
});

describe('the worker count is always set (spec §2.5, §5 row 1\'s worker fixture)', () => {
  it('no flag gives CCRC_TESTBOX_WORKERS in the flag and the three names, and local default: <m> when the local count differs', async () => {
    const box = makeBox();
    await box.svc.start();
    const { summary, sink, id } = await runOne(box, { workers: 2 });
    expect(sink.output(id)).toContain('workers=3 env=3,3,3');
    expect([summary.workers, summary.localDefault]).toEqual([3, 2]);
  });
  it('a lower session flag is kept (and the names carry it, D-7501); a higher one or a share is replaced', async () => {
    const box = makeBox();
    await box.svc.start();
    const low = await runOne(box, { argv: ['./node_modules/.bin/vitest', 'run', '--maxWorkers=1', '--mode=pass'], workers: 1 });
    expect(low.sink.output(low.id)).toContain('workers=1 env=1,1,1');
    expect([low.summary.workers, low.summary.localDefault]).toEqual([1, null]);
    expect(workerArgv(['vitest', '--maxWorkers', '8', 'run'], 3)).toEqual({ argv: ['vitest', 'run', '--maxWorkers=3'], workers: 3 });
    expect(workerArgv(['vitest', '--maxWorkers=40%'], 3)).toEqual({ argv: ['vitest', '--maxWorkers=3'], workers: 3 });
    expect(workerArgv(['vitest', 'run', '--', 'x'], 3).argv).toEqual(['vitest', 'run', '--maxWorkers=3', '--', 'x']);
  });
  it('a non-vitest head gets the names but no flag and no reporter', () => {
    const r = buildRunSpec(SUBMIT({ argv: ['npm', 'test'] }), ROW('/srv'), 1, SETTINGS('/srv'), '/c');
    expect(r.ok && r.spec.argv).toEqual(['npm', 'test']);
    expect(r.ok && r.spec.env.filter(([n]) => n.startsWith('VITEST_'))).toEqual([['VITEST_MAX_WORKERS', '3'], ['VITEST_MAX_THREADS', '3'], ['VITEST_MAX_FORKS', '3']]);
  });
});

describe('the run\'s environment is the allowlist plus the forwarded names (spec §2.3, §Review focus 3)', () => {
  it('a fixture run prints its whole environment: nothing of the manager\'s or the session\'s reaches it', async () => {
    const box = makeBox();
    await box.svc.start();
    const { sink, id } = await runOne(box, {
      argv: ['./node_modules/.bin/vitest', 'run', '--mode=env'], forward: { CCRC_HISTORY_BASE: 'a'.repeat(40) }, ci: true,
    });
    const out = sink.output(id);
    // macOS adds __CF_USER_TEXT_ENCODING to every process it starts, whatever the parent's environment; no box is one.
    const env = (JSON.parse(/^ENV (.*)$/m.exec(out)![1]!) as string[]).filter((n) => !(process.platform === 'darwin' && n === '__CF_USER_TEXT_ENCODING'));
    expect(env).toEqual(['CCRC_CHROME', 'CCRC_HISTORY_BASE', 'CI', 'HOME', 'LANG', 'PATH', 'TERM', 'TMPDIR', 'VITEST_MAX_FORKS', 'VITEST_MAX_THREADS', 'VITEST_MAX_WORKERS']);
    expect(JSON.parse(/^HOME (.*)$/m.exec(out)![1]!)).toEqual([]);
  });
  it('CI is set only when the local invocation had it', async () => {
    const box = makeBox();
    await box.svc.start();
    const { sink, id } = await runOne(box, { argv: ['./node_modules/.bin/vitest', 'run', '--mode=env'] });
    expect(JSON.parse(/^ENV (.*)$/m.exec(sink.output(id))![1]!)).not.toContain('CI');
  });
  it('the spec holds the settings\' values, never a literal: TMPDIR, the worker count, the report cap, CCRC_CHROME', () => {
    const r = buildRunSpec(SUBMIT(), ROW('/srv'), 2, SETTINGS('/srv', { workers: 7, runTmpdir: '/tmp/q', reportMaxBytes: 99 }), '/opt/t/chrome-131/chrome');
    if (!r.ok) throw new Error(r.reason);
    const recs = encodeSpec(r.spec).toString('utf8').split('\0');
    for (const want of ['ETMPDIR=/tmp/q', 'EVITEST_MAX_WORKERS=7', 'M99', 'ECCRC_CHROME=/opt/t/chrome-131/chrome', 'A--maxWorkers=7', 'Uccrc-tb-2',
      'D/srv/runs/2/run', 'C/srv/runs/2/run/checkout/server', `O/srv/results/${r.spec.runId}`, 'Gm', 'Bmain'].map((w) => (w === 'Gm' ? `G${ROW('/srv').mirrorPath}` : w))) {
      expect(recs).toContain(want);
    }
    expect(recs[0]).toBe('ccrc-testbox-spec');
  });
});

describe('the socket fixture (spec §5 row 1): the longest names the suites build bind under TMPDIR and under /tmp', () => {
  // The run-tmp parent's socket path: realpath(TMPDIR)/ccrc-testrun-XXXXXX/live.sock.
  const RUN_TMP_TAIL = Buffer.byteLength('/ccrc-testrun-XXXXXX/live.sock');
  /** A run TMPDIR (not /tmp, not under it on macOS) as long as one may be: the live.sock under it is exactly the
   *  platform's sun_path cap, the run-tmp parent's own limit. */
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const longestRunTmpdir = (): string => {
    // Under the real /tmp, not os.tmpdir(): a suite run's own TMPDIR is a long run-tmp directory with no room left.
    const base = mkdtempSync(path.join(realpathSync('/tmp'), 'ccrc-tb-sock-'));
    made.push(base);
    const pad = SUN_PATH_MAX - RUN_TMP_TAIL - Buffer.byteLength(base) - 1;
    if (pad < 1) throw new Error(`the fixture temp root is too long to pad: ${base}`);
    const dir = path.join(base, 'p'.repeat(pad));
    mkdirSync(dir);
    return dir;
  };
  it('both bind, the TMPDIR one at the longest path the cap allows', async () => {
    const runTmpdir = longestRunTmpdir();
    const box = makeBox({ runTmpdir });
    await box.svc.start();
    const { sink, id, summary } = await runOne(box, { argv: ['./node_modules/.bin/vitest', 'run', '--mode=socket'] });
    expect(summary.exit).toBe(0);
    const lines = sink.output(id).split('\n').filter((l) => l.startsWith('bound') || l.startsWith('refused'));
    expect(lines.map((l) => l.split(' ').slice(0, 2).join(' ')).sort()).toEqual(['bound /tmp', 'bound TMPDIR']);
    expect(lines.find((l) => l.startsWith('bound TMPDIR'))).toBe(`bound TMPDIR ${SUN_PATH_MAX}`);
  });
});

describe('the carry-over fixture of spec §2.3, against the seam', () => {
  it('the next run as the same run user, from another session, sees none of it; the sibling is refused; the log and report are kept', async () => {
    const box = makeBox({ runs: 1 });
    await box.svc.start();
    const first = await runOne(box, { argv: ['./node_modules/.bin/vitest', 'run', '--mode=carry'], session: 'session-a' });
    expect(first.summary.exit).toBe(0);
    expect(first.sink.output(first.id)).toMatch(/sibling refused (EACCES|EPERM)/);
    expect(existsSync(runDir(box, 1))).toBe(false);
    expect(readdirSync(path.join(box.root, 'runs', '1'))).toEqual([]);
    expect(existsSync(path.join(box.root, 'logs', first.id, 'run.log'))).toBe(true);
    expect(existsSync(path.join(box.root, 'results', first.id, 'report.json'))).toBe(true);
    const second = await runOne(box, { argv: ['./node_modules/.bin/vitest', 'run', '--mode=look'], session: 'session-b' });
    expect(second.sink.output(second.id)).toContain('SEEN []');
    // The fixture TMPDIR is the shared /tmp here (the box gives each unit its own private one); the run's file goes.
    rmSync(/^TMPCARRY (.*)$/m.exec(first.sink.output(first.id))![1]!, { force: true });
  });
});

describe('retention: results, logs and refs (spec §2.1 "Ref lifetime")', () => {
  it('past the retention time results and logs go; refs go only once the run\'s directory is gone; gc follows', async () => {
    const box = makeBox({ runs: 1 });
    await box.svc.start();
    const done = await runOne(box);
    const m = ROW(box.root).mirrorPath;
    const heldId = runId();
    box.mirror.refs.set(m, [done.id, heldId]);
    // `heldId` still has a directory: its user is held by a failing clean.
    box.mgr.failCleans = 1;
    const held = await runOne(box, { runId: heldId, session: 'session-b' });
    expect(held.summary.exit).toBe(0);
    const old = (box.clock.now - 2 * 3_600_000) / 1000;
    for (const id of [done.id, heldId]) for (const kind of ['results', 'logs']) utimesSync(path.join(box.root, kind, id), old, old);
    await box.svc.retention();
    for (const id of [done.id, heldId]) {
      expect(existsSync(path.join(box.root, 'results', id)), `results ${id === heldId ? 'held' : 'done'}`).toBe(false);
      expect(existsSync(path.join(box.root, 'logs', id)), `logs ${id === heldId ? 'held' : 'done'}`).toBe(false);
    }
    expect(box.mirror.calls).toEqual([`delete ${done.id}`, 'gc project-a.git']);
    await box.svc.sweep();
    box.clock.now += 2 * 3_600_000;
    await box.svc.retention();
    expect(box.mirror.calls.slice(2)).toEqual([`delete ${heldId}`, 'gc project-a.git']);
  });
  it('a fresh run\'s results are kept', async () => {
    const box = makeBox();
    await box.svc.start();
    const { id } = await runOne(box);
    await box.svc.retention();
    expect(existsSync(path.join(box.root, 'results', id, 'summary.json'))).toBe(true);
  });
  it('the timer fetch fetches every present mirror', async () => {
    const box = makeBox();
    await box.svc.start();
    await box.svc.tick();
    expect(box.mirror.calls).toEqual(['fetch project-a.git']);
  });
});

describe('the scripts read only their spec', () => {
  it.each(['runner', 'prestart', 'clean'])('%s names no config file and no test box variable', (f) => {
    const t = readFileSync(path.join(BIN, f), 'utf8');
    expect(t).not.toMatch(/CCRC_TESTBOX_|ccrc\.env|EnvironmentFile|TB_FIXTURE_/);
    expect(statSync(path.join(BIN, f)).mode & 0o111).not.toBe(0);
  });
  it('prestart refuses an existing run directory, and makes a fresh one 0700', async () => {
    const root = mkTmp('ccrc-tb-pre-');
    mkdirSync(path.join(root, 'runs', '1'), { recursive: true });
    const r = buildRunSpec(SUBMIT(), ROW(root), 1, SETTINGS(root), '/c');
    if (!r.ok) throw new Error(r.reason);
    const spec = path.join(root, 'spec');
    writeFileSync(spec, encodeSpec(r.spec));
    const env = { PATH: `${chownStub(root)}:${process.env.PATH ?? '/usr/bin:/bin'}` };
    const once = spawnSync(path.join(BIN, 'prestart'), [spec], { encoding: 'utf8', env });
    expect(once.status, once.stderr).toBe(0);
    expect(readFileSync(path.join(root, 'chown.log'), 'utf8')).toBe(`-- ccrc-tb-1 ${r.spec.runDir} ${r.spec.runDir}/home\n`);
    expect(statSync(r.spec.runDir).mode & 0o777).toBe(0o700);
    expect(readdirSync(r.spec.runDir)).toEqual(['home']);
    const twice = spawnSync(path.join(BIN, 'prestart'), [spec], { encoding: 'utf8', env });
    expect([twice.status, twice.stderr.trim()]).toEqual([1, `ccrc-testbox-prestart: the run directory already exists: ${r.spec.runDir}`]);
    rmSync(r.spec.runDir, { recursive: true });
    symlinkSync(root, r.spec.runDir);
    expect(spawnSync(path.join(BIN, 'prestart'), [spec], { encoding: 'utf8', env }).status).toBe(1);
  });
  it('the runner refuses a file that is not a test box spec', () => {
    const f = path.join(mkTmp('ccrc-tb-run-'), 'spec');
    writeFileSync(f, 'Aecho\0');
    const r = spawnSync(path.join(BIN, 'runner'), [f], { encoding: 'utf8' });
    expect([r.status, r.stderr.trim()]).toEqual([2, `ccrc-testbox-runner: not a test box spec: ${f}`]);
  });
});

describe.skipIf(!LINUX)('Linux: the clean stays on its filesystem', () => {
  it('the script spells --one-file-system on Linux', () => {
    expect(readFileSync(path.join(BIN, 'clean'), 'utf8')).toContain('rm -rf --one-file-system -- "$run"');
  });
});
