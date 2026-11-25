// D-8907, D-8912, D-8913 (spec docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md §2.5, §2.6, §2.7,
// §2.8, §5 "Wire rule", §9's PR 3 row; plan docs/superpowers/plans/2026-11-22-test-box-managed-node.md). The test
// service's additions for a managed box, none of them a frame's:
//   - the drain: the request file read, the lease decided (`drain.ts`), the queue handed to disk and back
//     (`drainer.ts`, `toolsync.ts`), the answer file written;
//   - the ready file (`main.ts#announceReady`);
//   - the versions a managed box answers are the ones its updater measured (`tools.json`);
//   - a `tools.sync` on a managed box starts nothing.
// And the wire rule: a released fleet agent reads a new box in every state this adds, and a new fleet agent reads a
// released box, because no frame gained a field.
//
// Everything runs in a fixture directory: the runtime directory, the request file, the tools directory and the box
// root are all under it, the system manager is a fake that starts nothing, and the clock is the test's. Nothing here
// contacts a box, a system manager or a release host.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import {
  readTestboxFrame, TESTBOX_FRAME_TYPE_MAP, TESTBOX_PROTO,
  type RunSubmit, type StatusAnswer, type TestboxRepoRow, type TestboxToolVersions, type ToolsSync,
} from '../../shared/testbox.js';
import { callBox } from '../src/testboxOp.js';
import {
  ACT_ID, BOX_FILE_MAX, DRAIN_ANSWER_FILE, DRAIN_REQUEST_FILE, encodeDrainAnswer, encodeReady, NODE_ID_FILE, NODE_STATE_DIR, parseDrainRequest,
  READY_FILE, RUNTIME_DIR, tabFields, TOOLS_JSON_FILE,
} from '../src/testbox/boxFiles.js';
import { boxFs, readSmall, removeSmall, writeSmall } from '../src/testbox/boxFs.js';
import type { TestboxConfig } from '../src/testbox/config.js';
import { durationMs } from '../src/testbox/config.js';
import { drainAnswer, DRAIN_LEASE_MAX_MS, drainOpen, leaseEnd, leaseStep, OPEN_DRAIN, requestRead, type DrainState, type Lease } from '../src/testbox/drain.js';
import { Drainer, drainerOf, type DrainedService } from '../src/testbox/drainer.js';
import { announceReady, serviceFor, startTestboxServer, type ServiceSeams } from '../src/testbox/main.js';
import { installKey, PRISTINE_KNOBS, type InstallInput } from '../src/testbox/pristine.js';
import { degradedReasons, statusAnswer, type StatusFacts } from '../src/testbox/status.js';
import type { SystemManager, UnitEnd } from '../src/testbox/systemd.js';
import {
  IDLE_TOOLS, managedOf, parseMeasuredTools, parseReport, released, requested, retryDue, syncsHere, TOOLS_KNOBS, toolsSettings, withHandedOver,
  type BoxTools, type ToolsState,
} from '../src/testbox/tools.js';
import { HANDOVER_DIR, HANDOVER_TOOLS_SYNC, statusOf, ToolSync, toolSyncOf, type ServedService } from '../src/testbox/toolsync.js';
import { mkTmp } from './tmpHelpers.js';
import { CAPTURE_CLOSED_DETAIL } from '../src/testbox/capture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN_TS = path.join(HERE, '..', 'src', 'testbox', 'main.ts');
/** The service's unit, as the box's installer and its updater render it. */
const SERVICE_UNIT = path.join(HERE, '..', '..', 'deploy', 'testbox', 'systemd', 'ccrc-testbox.service');
/** The box files' text, stated once for both sides: the service (`boxFiles.ts`) and the updater's shell. */
const BOX_FILES_FIXTURE = path.join(HERE, 'fixtures', 'testbox-box-files.json');

// ---------------------------------------------------------------------------------------------------------------
// The released wire, frozen here by hand from the release before this change. A reader of that release refuses a
// frame with any field it does not name, so these lists are what a new box may send it and what it sends a new box.
// ---------------------------------------------------------------------------------------------------------------

const RELEASED_FRAME_TYPES = ['capture.state', 'capture.submit', 'probe.state', 'probe.submit', 'run.cancel', 'run.log', 'run.submit', 'run.summary', 'status', 'tools.sync'];
const RELEASED_STATUS_KEYS = ['failedKeys', 'heldRunUsers', 'pristine', 'proto', 'queueDepth', 'reason', 'release', 'repositories', 'runs', 'serviceVersion', 'state', 'sync', 't', 'tools'];
const RELEASED_TOOLS_KEYS = ['chrome', 'git', 'node', 'npm', 'python3', 'tmux'];
const RELEASED_TOOLS_SYNC_KEYS = ['measuredAt', 'release', 't', 'versions'];
/** A status answer exactly as a released box sends it (no probe block: it names no probe directory). */
const RELEASED_STATUS_JSON = JSON.stringify({
  t: 'status', state: 'ok', reason: null, serviceVersion: '0.0.1', proto: 1, release: 'v0.0.1',
  tools: { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' },
  sync: { state: 'idle', detail: null, at: null }, runs: { inProgress: 0, limit: 2 }, queueDepth: 0,
  pristine: [], failedKeys: [], heldRunUsers: [], repositories: [],
});

const keys = (o: object): string[] => Object.keys(o).sort();

/** A status answer a released fleet agent reads: the released keys and no other, at every level it checks exactly. */
function expectReleasedShape(a: StatusAnswer, what: string): void {
  expect(keys(a), `${what}: the answer's keys`).toEqual(RELEASED_STATUS_KEYS);
  expect(keys(a.tools), `${what}: the tools' keys`).toEqual(RELEASED_TOOLS_KEYS);
  expect(keys(a.sync), `${what}: the sync's keys`).toEqual(['at', 'detail', 'state']);
  expect(keys(a.runs), `${what}: the runs' keys`).toEqual(['inProgress', 'limit']);
  const r = readTestboxFrame(JSON.stringify(a));
  expect(r.ok ? 'read' : r.reason, `${what}: the family's reader`).toBe('read');
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------------------------------------------

const TAG = 'v0.0.2';
const SET: TestboxToolVersions = { node: '22.1.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const MEASURED: TestboxToolVersions = { node: '22.2.0', npm: '10.9.1', tmux: '3.5', git: '2.44.0', python3: '3.12.4', chrome: '132.0.6800.10' };
const MEASURED_AT = '2026-11-22T12:00:00Z';
const ROW: TestboxRepoRow = {
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: '/nonexistent/project-a.git',
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }], buildOutputs: [], systemTools: [],
};
const SUBMIT: RunSubmit = {
  t: 'run.submit', runId: 'a'.repeat(32), repository: 'project-a', package: 'server', branch: 'main', refs: ['head'], outputs: [],
  argv: ['./node_modules/.bin/vitest', 'run'], forward: {}, ci: false, workers: 1, session: 'session-a',
};
const [RUN_R, Q1, Q2, Q3] = ['6'.repeat(32), '1'.repeat(32), '2'.repeat(32), '3'.repeat(32)];
const IDS = [RUN_R, Q1, Q2, Q3];
const submitOf = (runId: string): RunSubmit => ({ ...SUBMIT, runId });
const syncFrame = (release: string = 'v0.0.3'): ToolsSync => ({ t: 'tools.sync', release, versions: MEASURED, measuredAt: MEASURED_AT });
/** The settings the entry point's readers ask for, by the names their own lists give. */
const LINES = new Map<string, { value: string }>([
  [TOOLS_KNOBS[0], { value: '2m 10m' }], [TOOLS_KNOBS[1], { value: '127.0.0.1:4873' }], [TOOLS_KNOBS[2], { value: '' }],
  [PRISTINE_KNOBS[1], { value: '7d' }],
]);
const TOOLS_UNIT = 'ccrc-testbox-tools.service';
const START = Date.parse('2026-11-22T12:00:00Z');
const MIN = 60_000;

interface Fx {
  readonly dir: string;
  readonly cfg: TestboxConfig;
  /** The release tree the service runs from (a `build.json` and nothing else). */
  readonly release: string;
  /** The service's runtime directory and the request file, both under the fixture. */
  readonly run: string;
  readonly request: string;
  readonly clock: { now: number };
}

/** A fixture box: one repository row, a tool set in place as the tool sync leaves it, one run at a time. */
function fixture(): Fx {
  const dir = mkTmp('ccrc-tb-node-');
  const tools = path.join(dir, 'tools');
  const repos = path.join(dir, 'repos');
  const run = path.join(dir, 'run', 'svc');
  const release = path.join(dir, 'release');
  const set = path.join(tools, 'sets', 's.bootstrap');
  for (const d of [set, repos, run, path.join(dir, 'run', 'drain'), release]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(set, 'versions'), Object.entries(SET).map(([k, v]) => `${k}\t${v}\n`).join(''));
  symlinkSync(path.join('sets', 's.bootstrap'), path.join(tools, 'current'));
  writeFileSync(path.join(release, 'build.json'), `${JSON.stringify({ version: TAG })}\n`);
  writeFileSync(path.join(repos, 'project-a.json'), `${JSON.stringify({ ...ROW, mirrorPath: path.join(dir, 'mirrors', 'project-a.git') })}\n`);
  const cfg: TestboxConfig = {
    runs: 1, sessionRuns: 1, workers: 1, runTmpdir: '/tmp', root: path.join(dir, 'box'), repos,
    fetchEveryMs: 60_000, retentionMs: 3_600_000, registryKeepMs: 86_400_000, reportMaxBytes: 1024, toolsDir: tools, envForward: [], runUserPrefix: 'ccrc-tb-', logTail: 5,
    serviceUser: 'ccrc-tb-svc', listen: { host: '127.0.0.1', port: 0 }, tokenFile: path.join(dir, 'no-token'), unitMaxMs: 60_000,
    lines: LINES as unknown as TestboxConfig['lines'],
  };
  return { dir, cfg, release, run, request: path.join(dir, 'run', 'drain', 'request'), clock: { now: START } };
}

/** The box's updater has adopted it: its node id is there, and (unless `tools` is `null`) its measured versions. */
function adopt(fx: Fx, tools: unknown = MEASURED): void {
  const dir = path.join(fx.cfg.toolsDir, NODE_STATE_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, NODE_ID_FILE), '5f1c7f0e-0000-4000-8000-000000000001\n');
  if (tools === null) rmSync(path.join(dir, TOOLS_JSON_FILE), { force: true });
  else writeFileSync(path.join(dir, TOOLS_JSON_FILE), `${typeof tools === 'string' ? tools : JSON.stringify(tools)}\n`);
}

/** The system manager: every unit ends at once with 0, but RUN_R's run unit waits until released. It records the run
 *  ids whose run unit started, in order, and every start of the tools unit. */
function units(fx: Fx, o: { toolsExit?: number } = {}) {
  const ran: string[] = [];
  const toolsStarts: string[] = [];
  const started: string[] = [];
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => { release = r; });
  const sys: SystemManager = {
    async run(unit: string): Promise<UnitEnd> {
      started.push(unit);
      if (unit === TOOLS_UNIT) {
        toolsStarts.push(unit);
        const exit = o.toolsExit ?? 0;
        writeFileSync(path.join(fx.cfg.toolsDir, 'sync-report'), exit === 0 ? 'result\tnoop\n' : 'result\tfailed\ntool\tnode\ndetail\tno such version\n');
        return { exit, result: exit === 0 ? 'success' : 'exit-code' };
      }
      const m = /^ccrc-testbox-run@([0-9]+)\.service$/.exec(unit);
      if (m !== null) {
        const spec = readFileSync(path.join(fx.cfg.root, 'specs', m[1]!), 'utf8');
        const id = IDS.find((x) => spec.includes(x)) ?? '?';
        ran.push(id);
        if (id === RUN_R) await held;
      }
      return { exit: 0, result: 'success' };
    },
    async stop() { /* nothing to stop */ },
    async active() { return false; },
  };
  return { sys, ran, toolsStarts, started, release: () => release() };
}

/** A system manager whose tools unit waits until released and then leaves `report`; every other unit ends at once. */
function heldTools(fx: Fx, report: string = 'result\tnoop\n') {
  const starts: string[] = [];
  const gates: (() => void)[] = [];
  const sys: SystemManager = {
    async run(unit: string): Promise<UnitEnd> {
      if (unit === TOOLS_UNIT) {
        starts.push(unit);
        await new Promise<void>((r) => { gates.push(r); });
        writeFileSync(path.join(fx.cfg.toolsDir, 'sync-report'), report);
      }
      return { exit: 0, result: 'success' };
    },
    async stop() { /* nothing to stop */ },
    async active() { return false; },
  };
  return { sys, starts, release: (): void => { gates.shift()?.(); } };
}

/** The entry point's start order (`main.ts#main`, pinned below): the drain's first pass, the service, the hand-over
 *  resumed, then the door. */
async function boot(fx: Fx, sys: SystemManager, o: { exit?: (code: number) => void; inputs?: ServiceSeams['inputs']; capture?: ServiceSeams['capture'] } = {}) {
  const svc = serviceFor(fx.cfg, fx.release, o.exit ?? (() => undefined), {
    sys, box: { runtimeDir: fx.run, drainRequest: fx.request, now: () => fx.clock.now }, ...(o.inputs === undefined ? {} : { inputs: o.inputs }),
    ...(o.capture === undefined ? {} : { capture: o.capture }),
  });
  const drain = drainerOf(svc)!;
  drain.poll();
  await svc.start();
  const resumed = toolSyncOf(svc)!.resume();
  const srv = await startTestboxServer({ host: '127.0.0.1', port: 0, token: 'tok', service: svc });
  return { svc, srv, drain, resumed };
}

/** A connection through the WebSocket door, past its hello: the frames it was sent and how it closed. */
async function door(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: string[] = [];
  let closed: string | null = null;
  ws.on('message', (m) => frames.push(m.toString()));
  ws.on('close', (_code, reason) => { closed = reason.toString(); });
  await new Promise<void>((r, j) => { ws.once('open', () => r()); ws.once('error', j); });
  ws.send(JSON.stringify({ t: 'hello', token: 'tok' }));
  await expect.poll(() => frames.length).toBe(1);
  const summaries = (): string[] => frames.map((f) => JSON.parse(f) as { t: string; runId?: string }).filter((f) => f.t === 'run.summary').map((f) => f.runId ?? '?');
  return { ws, frames, summaries, closed: (): string | null => closed, send: (f: unknown) => ws.send(JSON.stringify(f)) };
}

/** Root writes the drain request: an act's id and a deadline in seconds since the epoch. */
function ask(fx: Fx, act: string, deadlineMs: number): void {
  writeFileSync(fx.request, `act\t${act}\ndeadline\t${Math.floor(deadlineMs / 1000)}\n`);
}
const withdraw = (fx: Fx): void => rmSync(fx.request, { force: true });
const answerOf = (fx: Fx): string | null => { try { return readFileSync(path.join(fx.run, DRAIN_ANSWER_FILE), 'utf8'); } catch { return null; } };
const handedOver = (fx: Fx): string[] => { try { return readdirSync(path.join(fx.cfg.root, HANDOVER_DIR)).filter((n) => n.endsWith('.json')).sort(); } catch { return []; } };
const summaryOf = (fx: Fx, id: string): string => path.join(fx.cfg.root, 'results', id, 'summary.json');
const settle = (ms = 150): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
/** One pass of the drain's poll, then the answer file. */
const pass = (fx: Fx, d: Drainer): string | null => { d.poll(); return answerOf(fx); };
const draining = (act: string, running: number): string => `act\t${act}\nstate\tdraining\nrunning\t${running}\n`;
const idle = (act: string, queued: number): string => `act\t${act}\nstate\tidle\nqueued\t${queued}\n`;

// ---------------------------------------------------------------------------------------------------------------
// The files' text (boxFiles.ts).
// ---------------------------------------------------------------------------------------------------------------

describe('boxFiles.ts: the files the updater and the service exchange (D-8907)', () => {
  it('the paths are the spec\'s: the request in root\'s directory, the answer and the ready file in the service\'s own', () => {
    expect([DRAIN_REQUEST_FILE, RUNTIME_DIR, DRAIN_ANSWER_FILE, READY_FILE]).toEqual(['/run/ccrc-testbox-drain/request', '/run/ccrc-testbox', 'drain', 'ready']);
    expect([NODE_STATE_DIR, NODE_ID_FILE, TOOLS_JSON_FILE]).toEqual(['node-state', 'node-id', 'tools.json']);
  });

  it('a request is an act id and a deadline in seconds since the epoch; a key it does not name is ignored', () => {
    expect(parseDrainRequest('act\tact-1\ndeadline\t1795000000\n')).toEqual({ ok: true, request: { actId: 'act-1', deadlineMs: 1_795_000_000_000 } });
    expect(parseDrainRequest('deadline\t1795000000\nlater\tword\nact\t20261122T120000Z.a1b2\n')).toEqual({ ok: true, request: { actId: '20261122T120000Z.a1b2', deadlineMs: 1_795_000_000_000 } });
  });

  it.each([
    ['', 'no act line'], ['deadline\t1795000000\n', 'no act line'], ['act\tact-1\n', 'no deadline line'],
    ['act\t../x\ndeadline\t1795000000\n', 'act is not an act id'], ['act\t\ndeadline\t1795000000\n', 'act is not an act id'],
    ['act\tact-1\ndeadline\tsoon\n', 'deadline is not seconds since the epoch'], ['act\tact-1\ndeadline\t-5\n', 'deadline is not seconds since the epoch'],
    ['act\tact-1\ndeadline\t2026-11-22T12:00:00Z\n', 'deadline is not seconds since the epoch'], ['{"act":"act-1","deadline":1795000000}', 'no act line'],
  ])('a text that is no request is refused with its reason: %j', (text, why) => {
    expect(parseDrainRequest(text)).toEqual({ ok: false, why });
  });

  it('the answer and the ready file are key<TAB>value lines root\'s shell reads with no JSON tool', () => {
    expect(encodeDrainAnswer({ act: 'act-1', state: 'draining', running: 2 })).toBe('act\tact-1\nstate\tdraining\nrunning\t2\n');
    expect(encodeDrainAnswer({ act: 'act-1', state: 'idle', queued: 3 })).toBe('act\tact-1\nstate\tidle\nqueued\t3\n');
    expect(encodeReady({ release: TAG, pid: 4242 })).toBe(`release\t${TAG}\npid\t4242\n`);
    expect([...tabFields(encodeDrainAnswer({ act: 'act-1', state: 'idle', queued: 3 }))]).toEqual([['act', 'act-1'], ['state', 'idle'], ['queued', '3']]);
  });

  it('the tools unit\'s report still reads through the same field reader (the one parser of this form)', () => {
    expect(parseReport('result\tok\nrelease\tv0.0.2\nset\ts.bbbbbbbb\ntakeover\t1\nnode-changed\t1\nno tab here\n\tno key\n')).toMatchObject({
      result: 'ok', release: 'v0.0.2', set: 's.bbbbbbbb', takeover: true, nodeChanged: true,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The adapter (boxFs.ts).
// ---------------------------------------------------------------------------------------------------------------

describe('boxFs.ts: a small file read as data (spec §2.12)', () => {
  it('answers the text, a proven absence, or that it is unreadable and why: three answers', () => {
    const d = mkTmp('ccrc-tb-boxfs-');
    writeFileSync(path.join(d, 'f'), 'act\tact-1\n');
    expect(readSmall(path.join(d, 'f'))).toEqual({ t: 'text', text: 'act\tact-1\n' });
    expect(readSmall(path.join(d, 'none'))).toEqual({ t: 'absent' });
    expect(readSmall(path.join(d, 'f', 'under-a-file'))).toEqual({ t: 'absent' });
    mkdirSync(path.join(d, 'dir'));
    expect(readSmall(path.join(d, 'dir'))).toEqual({ t: 'unreadable', why: 'not a regular file' });
  });

  it('never follows a link at the file\'s name: a link to a readable file is unreadable, not its target\'s text', () => {
    const d = mkTmp('ccrc-tb-boxfs-');
    writeFileSync(path.join(d, 'target'), 'act\tact-1\ndeadline\t1795000000\n');
    symlinkSync(path.join(d, 'target'), path.join(d, 'link'));
    expect(readSmall(path.join(d, 'link'))).toEqual({ t: 'unreadable', why: 'a symbolic link' });
  });

  it('reads at most BOX_FILE_MAX bytes: a longer file is unreadable, one of exactly that length is read', () => {
    const d = mkTmp('ccrc-tb-boxfs-');
    writeFileSync(path.join(d, 'max'), 'x'.repeat(BOX_FILE_MAX));
    writeFileSync(path.join(d, 'over'), 'x'.repeat(BOX_FILE_MAX + 1));
    expect(readSmall(path.join(d, 'max'))).toEqual({ t: 'text', text: 'x'.repeat(BOX_FILE_MAX) });
    expect(readSmall(path.join(d, 'over'))).toEqual({ t: 'unreadable', why: `longer than ${BOX_FILE_MAX} bytes` });
  });

  it('a FIFO in the file\'s place does not hang the read', () => {
    const d = mkTmp('ccrc-tb-boxfs-');
    const made = spawnSync('mkfifo', [path.join(d, 'fifo')]);
    expect(made.status, 'mkfifo made the fixture').toBe(0);
    expect(readSmall(path.join(d, 'fifo'))).toEqual({ t: 'unreadable', why: 'not a regular file' });
  });

  it('a write is whole or not at all, and leaves no temporary name; a remove of nothing is quiet', () => {
    const d = mkTmp('ccrc-tb-boxfs-');
    writeSmall(d, 'ready', 'release\tv0.0.2\n');
    writeSmall(d, 'ready', 'release\tv0.0.3\n');
    expect(readdirSync(d)).toEqual(['ready']);
    expect(readFileSync(path.join(d, 'ready'), 'utf8')).toBe('release\tv0.0.3\n');
    expect(() => writeSmall(path.join(d, 'no-such-dir'), 'ready', 'x')).toThrow();
    removeSmall(path.join(d, 'ready'));
    removeSmall(path.join(d, 'ready'));
    expect(readdirSync(d)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The lease (drain.ts).
// ---------------------------------------------------------------------------------------------------------------

describe('drain.ts: the request is a lease (D-8907)', () => {
  const T0 = START;
  const req = (actId: string, deadlineMs: number) => ({ t: 'request', request: { actId, deadlineMs } }) as const;
  const held = (actId: string, since: number, deadlineMs: number): DrainState => ({ lease: { actId, since, deadlineMs }, spent: null });

  it('a file that does not parse is malformed, never absent; absent and unreadable pass through as read', () => {
    expect(requestRead({ t: 'absent' })).toEqual({ t: 'absent' });
    expect(requestRead({ t: 'unreadable', why: 'EACCES' })).toEqual({ t: 'unreadable', why: 'EACCES' });
    expect(requestRead({ t: 'text', text: 'garbage' })).toEqual({ t: 'malformed', why: 'no act line' });
    expect(requestRead({ t: 'text', text: 'act\ta\ndeadline\t5\n' })).toEqual(req('a', 5000));
  });

  it('a request with its deadline ahead starts a lease, and admission closes; none stands without one', () => {
    expect(drainOpen(OPEN_DRAIN)).toBe(true);
    expect(leaseStep(OPEN_DRAIN, { t: 'absent' }, T0)).toEqual({ state: OPEN_DRAIN, ended: null });
    const s = leaseStep(OPEN_DRAIN, req('a', T0 + 15 * MIN), T0);
    expect(s).toEqual({ state: held('a', T0, T0 + 15 * MIN), ended: null });
    expect(drainOpen(s.state)).toBe(false);
  });

  it('a withdrawn request ends the lease at once', () => {
    expect(leaseStep(held('a', T0, T0 + 15 * MIN), { t: 'absent' }, T0 + MIN)).toEqual({ state: OPEN_DRAIN, ended: 'withdrawn' });
  });

  it('a deadline that has passed ends the lease, with the request still on disk; one already past starts none', () => {
    const at = T0 + 15 * MIN;
    expect(leaseStep(held('a', T0, at), req('a', at), at - 1).ended).toBeNull();
    expect(leaseStep(held('a', T0, at), req('a', at), at)).toEqual({ state: OPEN_DRAIN, ended: 'expired' });
    expect(leaseStep(OPEN_DRAIN, req('a', at), at + MIN)).toEqual({ state: OPEN_DRAIN, ended: null });
  });

  it('a request the same act rewrites with a later deadline extends the lease, from when the act was first seen', () => {
    const s = leaseStep(held('a', T0, T0 + 15 * MIN), req('a', T0 + 20 * MIN), T0 + 14 * MIN);
    expect(s).toEqual({ state: held('a', T0, T0 + 20 * MIN), ended: null });
  });

  it('a request naming another act continues the drain under that act: nothing reopens between them', () => {
    const s = leaseStep(held('a', T0, T0 + 15 * MIN), req('b', T0 + 30 * MIN), T0 + 5 * MIN);
    expect(s).toEqual({ state: held('b', T0 + 5 * MIN, T0 + 30 * MIN), ended: null });
  });

  it.each([{ t: 'unreadable', why: 'EACCES' } as const, { t: 'malformed', why: 'no act line' } as const])(
    'a request that is $t is no information: it starts no lease, and a lease held stands until its own deadline', (read) => {
      expect(leaseStep(OPEN_DRAIN, read, T0)).toEqual({ state: OPEN_DRAIN, ended: null });
      const s = held('a', T0, T0 + 15 * MIN);
      expect(leaseStep(s, read, T0 + 14 * MIN)).toEqual({ state: s, ended: null });
      expect(leaseStep(s, read, T0 + 15 * MIN)).toEqual({ state: OPEN_DRAIN, ended: 'expired' });
    });

  it('the ceiling: a lease stands at most DRAIN_LEASE_MAX_MS from when its act was first seen, whatever its deadline', () => {
    const far = T0 + 10 * 365 * 24 * 60 * MIN;
    const l: Lease = { actId: 'a', since: T0, deadlineMs: far };
    expect(DRAIN_LEASE_MAX_MS).toBe(60 * MIN);
    expect(leaseEnd(l)).toBe(T0 + DRAIN_LEASE_MAX_MS);
    expect(leaseStep(OPEN_DRAIN, req('a', far), T0).state.lease).toEqual(l);
    expect(leaseStep({ lease: l, spent: null }, req('a', far), T0 + DRAIN_LEASE_MAX_MS - 1).ended).toBeNull();
    const over = leaseStep({ lease: l, spent: null }, req('a', far), T0 + DRAIN_LEASE_MAX_MS);
    expect(over).toEqual({ state: { lease: null, spent: 'a' }, ended: 'expired' });
    // The same request, still on disk, never closes the box again; another act does, and a withdrawal clears it.
    expect(leaseStep(over.state, req('a', far), T0 + DRAIN_LEASE_MAX_MS + MIN)).toEqual({ state: { lease: null, spent: 'a' }, ended: null });
    expect(leaseStep(over.state, { t: 'unreadable', why: 'EIO' }, T0 + DRAIN_LEASE_MAX_MS + MIN).state).toEqual({ lease: null, spent: 'a' });
    expect(leaseStep(over.state, req('b', far), T0 + DRAIN_LEASE_MAX_MS + MIN).state.lease?.actId).toBe('b');
    expect(leaseStep(over.state, { t: 'absent' }, T0 + DRAIN_LEASE_MAX_MS + MIN).state).toEqual(OPEN_DRAIN);
  });

  it('the answer is idle only when nothing is in progress and the queue is on disk', () => {
    const l: Lease = { actId: 'a', since: T0, deadlineMs: T0 + MIN };
    expect(drainAnswer(l, false, 2, null)).toEqual({ act: 'a', state: 'draining', running: 2 });
    expect(drainAnswer(l, true, 0, null), 'a hand-over that could not be written').toEqual({ act: 'a', state: 'draining', running: 0 });
    expect(drainAnswer(l, false, 1, 3), 'a run still in progress').toEqual({ act: 'a', state: 'draining', running: 1 });
    expect(drainAnswer(l, true, 0, 3)).toEqual({ act: 'a', state: 'idle', queued: 3 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The driver alone (drainer.ts), against a scripted service.
// ---------------------------------------------------------------------------------------------------------------

describe('drainer.ts: the driver never throws and says a fault once', () => {
  function scripted(o: { quiet?: () => boolean; handOver?: () => number } = {}) {
    const dir = mkTmp('ccrc-tb-drainer-');
    const run = path.join(dir, 'run');
    mkdirSync(run);
    const request = path.join(dir, 'request');
    const clock = { now: START };
    const log: string[] = [];
    const calls: string[] = [];
    const svc: DrainedService = {
      quiet: o.quiet ?? (() => true), running: () => 0,
      handOver: () => { calls.push('handOver'); return (o.handOver ?? (() => 0))(); },
      reopen: () => { calls.push('reopen'); },
    };
    const d = new Drainer({ requestFile: request, runtimeDir: run, now: () => clock.now, fs: boxFs, log: (l) => log.push(l) });
    d.serve(svc);
    return { d, run, request, clock, log, calls };
  }

  it('a leftover answer of a service before this one goes at the first pass with no request', () => {
    const s = scripted();
    writeFileSync(path.join(s.run, DRAIN_ANSWER_FILE), idle('old-act', 4));
    s.d.poll();
    expect(existsSync(path.join(s.run, DRAIN_ANSWER_FILE))).toBe(false);
    expect(s.calls).toEqual([]);
  });

  it('with no request, a queued submission asks nothing of the service, writes nothing and says nothing', () => {
    const s = scripted();
    s.d.poll();
    s.d.queued();
    expect(s.calls).toEqual([]);
    expect(readdirSync(s.run)).toEqual([]);
    expect(s.log).toEqual([]);
  });

  it('an unreadable request is said once, starts no drain, and the box stays open', () => {
    const s = scripted();
    mkdirSync(s.request);
    for (let i = 0; i < 3; i++) s.d.poll();
    expect(s.d.closed()).toBe(false);
    expect(s.log).toEqual(['ccrc-testbox: the drain request is unreadable (not a regular file); it starts no drain and ends none early']);
    expect(s.calls).toEqual([]);
  });

  it('an answer that cannot be written (no runtime directory) is said once; the drain still closes and reopens', () => {
    const s = scripted();
    rmSync(s.run, { recursive: true });
    writeFileSync(s.request, `act\tact-1\ndeadline\t${(START + 15 * MIN) / 1000}\n`);
    for (let i = 0; i < 3; i++) s.d.poll();
    expect(s.d.closed()).toBe(true);
    expect(s.log.filter((l) => l.includes('could not be written'))).toHaveLength(1);
    rmSync(s.request);
    s.d.poll();
    expect(s.d.closed()).toBe(false);
    expect(s.calls.at(-1)).toBe('reopen');
  });

  it('a service call that throws ends the pass, not the process', () => {
    const s = scripted({ quiet: () => { throw new Error('boom'); } });
    writeFileSync(s.request, `act\tact-1\ndeadline\t${(START + 15 * MIN) / 1000}\n`);
    expect(() => s.d.poll()).not.toThrow();
    expect(() => s.d.queued()).not.toThrow();
    expect(s.log.filter((l) => l.includes('the drain pass failed (boom)'))).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A managed box: who moves it, and whose versions it answers (tools.ts, toolsync.ts, status.ts).
// ---------------------------------------------------------------------------------------------------------------

describe('a managed box is the update act\'s to move (D-8913)', () => {
  const BOX: BoxTools = { release: TAG, versions: SET, set: 's.bootstrap', managed: 'unmanaged' };
  const FAILED: ToolsState = { ...IDLE_TOOLS, sync: { state: 'failed', detail: 'node: no such version', at: MEASURED_AT }, last: syncFrame(), attempts: 2, nextAt: 5 };

  it('the node id says it: there, the box is managed; proven absent, it is not; anything else tells nothing', () => {
    expect(managedOf({ t: 'text', text: '5f1c7f0e-0000-4000-8000-000000000001\n' })).toBe('managed');
    expect(managedOf({ t: 'absent' })).toBe('unmanaged');
    expect(managedOf({ t: 'unreadable', why: 'EACCES' })).toBe('unreadable');
    expect(managedOf({ t: 'text', text: ' \n' }), 'an empty file is no identity yet').toBe('unreadable');
    expect([syncsHere('unmanaged'), syncsHere('managed'), syncsHere('unreadable')]).toEqual([true, false, false]);
  });

  it('the decider: a tools.sync starts a sync on an unmanaged box, and nothing on a managed or an unreadable one', () => {
    expect(requested(IDLE_TOOLS, syncFrame(), BOX, MEASURED_AT).start?.release).toBe('v0.0.3');
    for (const managed of ['managed', 'unreadable'] as const) {
      const r = requested(IDLE_TOOLS, syncFrame(), { ...BOX, managed }, MEASURED_AT);
      expect(r, managed).toEqual({ state: IDLE_TOOLS, start: null });
    }
  });

  it('the decider: on a managed box the frame is not kept for later, and a failed sync is over', () => {
    const running: ToolsState = { ...IDLE_TOOLS, running: true, sync: { state: 'syncing', detail: null, at: MEASURED_AT }, last: syncFrame('v0.0.4') };
    expect(requested(running, syncFrame(), { ...BOX, managed: 'managed' }, MEASURED_AT), 'a sync in flight ends as it would have').toEqual({ state: running, start: null });
    const takeover: ToolsState = { ...IDLE_TOOLS, takeover: true };
    expect(requested(takeover, syncFrame(), { ...BOX, managed: 'managed' }, MEASURED_AT).state.pending, 'nothing handed to the next service').toBeNull();
    const r = requested(FAILED, syncFrame(), { ...BOX, managed: 'managed' }, MEASURED_AT);
    expect(r.start).toBeNull();
    expect(r.state).toMatchObject({ sync: { state: 'idle', detail: null, at: MEASURED_AT }, attempts: 0, nextAt: null, last: null });
  });

  /** The driver alone, on a fixture tools directory, with a tools unit that fails. */
  function driver(fx: Fx) {
    const u = units(fx, { toolsExit: 1 });
    const t = new ToolSync({ sys: u.sys, root: fx.cfg.root, toolsDir: fx.cfg.toolsDir, settings: toolsSettings(LINES, durationMs), now: () => fx.clock.now, exit: () => undefined });
    const served: ServedService = {
      status: () => JSON.parse(RELEASED_STATUS_JSON) as StatusAnswer, idle: async () => undefined, tick: async () => undefined, liveRuns: () => [],
      waiting: () => [], submit: () => undefined, forgetWaiting: () => new Map(),
    };
    t.serve(served);
    return { t, u };
  }

  it('the driver: a failed sync is retried on an unmanaged box, and never once the box is managed', async () => {
    const control = fixture();
    const c = driver(control);
    await c.t.request(syncFrame());
    expect(c.t.stateNow().sync.state).toBe('failed');
    control.clock.now += 3 * MIN;
    await c.t.tick();
    expect(c.u.toolsStarts, 'the control: the retry runs the unit again').toHaveLength(2);

    const fx = fixture();
    const d = driver(fx);
    await d.t.request(syncFrame());
    expect(d.u.toolsStarts).toHaveLength(1);
    adopt(fx);
    fx.clock.now += 3 * MIN;
    await d.t.tick();
    expect(d.u.toolsStarts, 'adopted: the old mover is never started again').toHaveLength(1);
  });

  it('the driver: a drain\'s later hand-over sorts after its earlier one on any clock, so the runs are queued again in the order they were queued', () => {
    const fx = fixture();
    const waiting: RunSubmit[] = [];
    const order: string[] = [];
    // A clock that does not move, and ids whose names sort against their arrival.
    const t = new ToolSync({ sys: units(fx).sys, root: fx.cfg.root, toolsDir: fx.cfg.toolsDir, settings: toolsSettings(LINES, durationMs), now: () => START, exit: () => undefined });
    t.serve({
      status: () => JSON.parse(RELEASED_STATUS_JSON) as StatusAnswer, idle: async () => undefined, tick: async () => undefined, liveRuns: () => [],
      waiting: () => waiting, submit: (f) => { order.push(f.runId); },
      forgetWaiting: () => new Map(waiting.splice(0).map((f) => [f.runId, { send: () => undefined }])),
    });
    waiting.push(submitOf(Q2));
    expect(t.handOverWaiting()).toBe(1);
    waiting.push(submitOf(Q1));
    expect(t.handOverWaiting()).toBe(2);
    expect(t.resume()).toBe(2);
    expect(order).toEqual([Q2, Q1]);
  });

  it('through the door: an unmanaged box runs the sync; a managed one starts nothing and refuses nothing', async () => {
    for (const managed of [false, true]) {
      const fx = fixture();
      if (managed) adopt(fx);
      const u = units(fx);
      const b = await boot(fx, u.sys);
      try {
        const c = await door(b.srv.port);
        c.send(syncFrame());
        if (!managed) await expect.poll(() => u.toolsStarts.length).toBe(1);
        else { await settle(); expect(u.toolsStarts, 'a managed box starts no tools unit').toEqual([]); }
        expect(c.closed(), 'the frame is not refused').toBeNull();
        const a = statusOf(b.svc);
        expect(a.sync).toEqual({ state: 'idle', detail: null, at: managed ? null : a.sync.at });
        expectReleasedShape(a, managed ? 'managed, after a tools.sync' : 'unmanaged, after a tools.sync');
        expect(existsSync(path.join(fx.cfg.root, 'specs', 'tools')), 'a tools spec is written only when a sync starts').toBe(!managed);
        c.ws.close();
      } finally {
        await b.srv.close();
      }
    }
  });

  it('through the door: a box whose node id cannot be read starts no tools unit either', async () => {
    const fx = fixture();
    mkdirSync(path.join(fx.cfg.toolsDir, NODE_STATE_DIR, NODE_ID_FILE), { recursive: true });
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      const c = await door(b.srv.port);
      c.send(syncFrame());
      await settle();
      expect(u.toolsStarts).toEqual([]);
      expect(c.closed()).toBeNull();
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });
});

describe('a managed box answers the versions its updater measured (spec §2.6)', () => {
  it('tools.json is an object keyed by tool; a key that is no tool is ignored; a tool off its shape is not measured, alone', () => {
    expect(parseMeasuredTools(JSON.stringify(MEASURED))).toEqual(MEASURED);
    expect(parseMeasuredTools(JSON.stringify({ ...MEASURED, measuredAt: MEASURED_AT, later: { word: 1 } }))).toEqual(MEASURED);
    expect(parseMeasuredTools(JSON.stringify({ ...MEASURED, node: 'v22.2.0', chrome: undefined, tmux: 3.5, git: '' }))).toEqual({
      ...MEASURED, node: null, chrome: null, tmux: null, git: null,
    });
    for (const text of ['', 'node\t22.2.0\n', '[]', 'null', '"22.2.0"', '{']) expect(parseMeasuredTools(text), JSON.stringify(text)).toBeNull();
  });

  const FACTS: StatusFacts = {
    reflink: { ok: true }, mirrors: [], release: TAG, serviceVersion: '0.0.2', tools: MEASURED, fleetTools: null,
    sync: IDLE_TOOLS.sync, inProgress: 0, limit: 1, queueDepth: 0, pristine: [], failedKeys: [], heldRunUsers: [],
  };

  it('the answer: a tool not measured carries the placeholder and is named in the reason; the others stand', () => {
    expect(statusAnswer(FACTS)).toMatchObject({ state: 'ok', reason: null, tools: MEASURED });
    const partial = statusAnswer({ ...FACTS, tools: { ...MEASURED, chrome: null, tmux: null } });
    expect(partial).toMatchObject({ state: 'degraded', reason: 'tool version not measured (tmux); tool version not measured (chrome)', tools: { ...MEASURED, chrome: '0', tmux: '0' } });
    expectReleasedShape(partial, 'a tool not measured');
    const none = statusAnswer({ ...FACTS, tools: null });
    expect(none).toMatchObject({ state: 'degraded', reason: 'tool versions not measured', tools: { node: '0', npm: '0', tmux: '0', git: '0', python3: '0', chrome: '0' } });
    expectReleasedShape(none, 'nothing measured');
    // A tool that is not measured is not also said to differ from the fleet host's.
    expect(degradedReasons({ ...FACTS, tools: { ...MEASURED, chrome: null }, fleetTools: { ...MEASURED, npm: '11.0.0' } })).toEqual([
      'tool version not measured (chrome)', 'tool version differs (npm)',
    ]);
  });

  it('the service: an unmanaged box answers its set\'s versions; once adopted, tools.json\'s, never the set\'s copy', async () => {
    const fx = fixture();
    const b = await boot(fx, units(fx).sys);
    try {
      expect(statusOf(b.svc).tools, 'unmanaged: the set\'s file, as before').toEqual(SET);
      adopt(fx);
      expect(statusOf(b.svc).tools, 'managed: what the updater measured').toEqual(MEASURED);
      expectReleasedShape(statusOf(b.svc), 'managed, measured');
      adopt(fx, { ...MEASURED, chrome: undefined, node: 'v22.2.0', measuredAt: MEASURED_AT });
      expect(statusOf(b.svc).tools, 'a tool tools.json does not carry reads as the placeholder, alone').toEqual({ ...MEASURED, chrome: '0', node: '0' });
      expectReleasedShape(statusOf(b.svc), 'managed, two tools not measured');
      for (const [what, text] of [['absent', null], ['not JSON', '{'], ['too long', JSON.stringify({ ...MEASURED, pad: 'x'.repeat(BOX_FILE_MAX) })]] as const) {
        adopt(fx, text);
        expect(statusOf(b.svc).tools, `tools.json ${what}: nothing measured, and the set's copy is not read in its place`).toEqual({
          node: '0', npm: '0', tmux: '0', git: '0', python3: '0', chrome: '0',
        });
        expectReleasedShape(statusOf(b.svc), `managed, tools.json ${what}`);
      }
      // What a hello is sent is that answer.
      adopt(fx);
      const c = await door(b.srv.port);
      const hello = readTestboxFrame(c.frames[0]!);
      expect(hello.ok ? hello.value : hello.reason).toMatchObject({ t: 'status', release: TAG, tools: MEASURED });
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The drain on the entry point's service.
// ---------------------------------------------------------------------------------------------------------------

describe('the drain on the entry point\'s service (D-8907)', () => {
  /** RUN_R in progress and Q1 waiting behind it, on one connection. */
  async function busy(fx: Fx) {
    const u = units(fx);
    const b = await boot(fx, u.sys);
    const c = await door(b.srv.port);
    c.send(submitOf(RUN_R));
    await expect.poll(() => u.ran).toEqual([RUN_R]);
    c.send(submitOf(Q1));
    await expect.poll(() => [...b.svc.positions().keys()]).toEqual([Q1]);
    return { u, b, c };
  }
  it('a request closes admission, the run in progress ends, the queue goes to disk, and the answer says so; withdrawn, the runs are queued again in order, to their own connection', async () => {
    const fx = fixture();
    const { u, b, c } = await busy(fx);
    try {
      ask(fx, 'act-1', fx.clock.now + 15 * MIN);
      expect(pass(fx, b.drain)).toBe(draining('act-1', 1));
      expect(b.drain.closed()).toBe(true);
      const during = statusOf(b.svc);
      expectReleasedShape(during, 'draining');
      expect(during, 'the configured run limit, as the takeover keeps it').toMatchObject({ runs: { inProgress: 1, limit: fx.cfg.runs }, queueDepth: 1 });
      expect(handedOver(fx), 'nothing is handed over while a run is in progress').toEqual([]);

      u.release();
      await expect.poll(() => existsSync(summaryOf(fx, RUN_R))).toBe(true);
      await expect.poll(() => pass(fx, b.drain)).toBe(idle('act-1', 1));
      await settle();
      expect(u.ran, 'the waiting run does not start while the request stands').toEqual([RUN_R]);
      expect(handedOver(fx)).toHaveLength(1);
      expect(handedOver(fx)[0]).toContain(Q1);
      // An answer something removed is written again at the next pass; one in place is left as it is.
      rmSync(path.join(fx.run, DRAIN_ANSWER_FILE));
      expect(pass(fx, b.drain)).toBe(idle('act-1', 1));
      const inode = statSync(path.join(fx.run, DRAIN_ANSWER_FILE)).ino;
      expect(pass(fx, b.drain)).toBe(idle('act-1', 1));
      expect(statSync(path.join(fx.run, DRAIN_ANSWER_FILE)).ino, 'not rewritten every pass').toBe(inode);
      expect([...b.svc.positions().keys()], 'the run left the service\'s queue: the disk is its one home').toEqual([]);
      expect(existsSync(path.join(fx.cfg.root, 'logs', Q1)), 'its id is free for the service that queues it again').toBe(false);
      const drained = statusOf(b.svc);
      expectReleasedShape(drained, 'drained');
      expect(drained, 'a handed-over run still waits for this box').toMatchObject({ runs: { inProgress: 0, limit: fx.cfg.runs }, queueDepth: 1 });
      const late = await door(b.srv.port);
      const hello = readTestboxFrame(late.frames[0]!);
      expect(hello.ok ? hello.value : hello.reason, 'a hello during the drain').toMatchObject({ t: 'status', queueDepth: 1 });
      late.ws.close();

      // A run submitted while the queue is on disk goes there in the same turn, and the answer counts it.
      c.send(submitOf(Q2));
      await expect.poll(() => answerOf(fx)).toBe(idle('act-1', 2));
      expect(c.closed(), 'the submission is not refused').toBeNull();
      expect(handedOver(fx).map((n) => n.slice(-37, -5)), 'in the order they were queued').toEqual([Q1, Q2]);
      expect(u.ran).toEqual([RUN_R]);

      withdraw(fx);
      expect(pass(fx, b.drain), 'the answer goes with the lease').toBeNull();
      expect(b.drain.closed()).toBe(false);
      await expect.poll(() => u.ran).toEqual([RUN_R, Q1, Q2]);
      await expect.poll(() => c.summaries()).toEqual([RUN_R, Q1, Q2]);
      expect(handedOver(fx)).toEqual([]);
      expectReleasedShape(statusOf(b.svc), 'reopened');
      expect(statusOf(b.svc).queueDepth).toBe(0);
      c.ws.close();
    } finally {
      u.release();
      await b.srv.close();
    }
  });

  it('an updater killed in mid-drain: the request stays, its deadline passes, and the service takes runs again by itself, in order', async () => {
    const fx = fixture();
    const { u, b, c } = await busy(fx);
    try {
      ask(fx, 'act-2', fx.clock.now + 15 * MIN);
      b.drain.poll();
      c.send(submitOf(Q2));
      await expect.poll(() => [...b.svc.positions().keys()]).toEqual([Q1, Q2]);
      u.release();
      await expect.poll(() => pass(fx, b.drain)).toBe(idle('act-2', 2));
      fx.clock.now += 15 * MIN - 1000;
      expect(pass(fx, b.drain), 'a second before the deadline the lease stands').toBe(idle('act-2', 2));
      await settle();
      expect(u.ran).toEqual([RUN_R]);
      fx.clock.now += 1000;
      expect(pass(fx, b.drain), 'at the deadline the answer goes').toBeNull();
      expect(existsSync(fx.request), 'nobody withdrew the request').toBe(true);
      await expect.poll(() => u.ran).toEqual([RUN_R, Q1, Q2]);
      await expect.poll(() => c.summaries()).toEqual([RUN_R, Q1, Q2]);
      // The request, still on disk and past its deadline, closes nothing again.
      b.drain.poll();
      expect(b.drain.closed()).toBe(false);
      c.send(submitOf(Q3));
      await expect.poll(() => u.ran).toEqual([RUN_R, Q1, Q2, Q3]);
      c.ws.close();
    } finally {
      u.release();
      await b.srv.close();
    }
  });

  it('a request with a deadline years ahead closes the box for the ceiling, not for good', async () => {
    const fx = fixture();
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      const c = await door(b.srv.port);
      ask(fx, 'act-far', fx.clock.now + 10 * 365 * 24 * 60 * MIN);
      b.drain.poll();
      c.send(submitOf(Q1));
      await expect.poll(() => answerOf(fx)).toBe(idle('act-far', 1));
      fx.clock.now += DRAIN_LEASE_MAX_MS - 1000;
      b.drain.poll();
      await settle();
      expect(u.ran).toEqual([]);
      fx.clock.now += 1000;
      b.drain.poll();
      await expect.poll(() => u.ran).toEqual([Q1]);
      fx.clock.now += MIN;
      b.drain.poll();
      expect(b.drain.closed(), 'the same request never closes the box again').toBe(false);
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });

  it('the updater stops the service after the answer: the next service queues nothing while the request stands, then the handed-over runs, in order', async () => {
    const fx = fixture();
    const { u, b, c } = await busy(fx);
    try {
      ask(fx, 'act-3', fx.clock.now + 15 * MIN);
      b.drain.poll();
      c.send(submitOf(Q2));
      await expect.poll(() => [...b.svc.positions().keys()]).toEqual([Q1, Q2]);
      u.release();
      await expect.poll(() => pass(fx, b.drain)).toBe(idle('act-3', 2));
      c.ws.close();
    } finally {
      u.release();
      await b.srv.close();
    }
    // The next service, on the new tree, at the same root, started while the request still stands.
    const v = units(fx);
    const next = await boot(fx, v.sys);
    try {
      expect(next.resumed, 'a standing request leaves the handed-over runs on disk').toBe(0);
      expect(next.drain.closed()).toBe(true);
      expect(answerOf(fx), 'its first pass answers for what is on disk').toBe(idle('act-3', 2));
      expect(statusOf(next.svc).queueDepth, 'and its status answer counts them').toBe(2);
      expectReleasedShape(statusOf(next.svc), 'the next service, under a standing request');
      await settle();
      expect(v.ran).toEqual([]);
      withdraw(fx);
      next.drain.poll();
      await expect.poll(() => v.ran).toEqual([Q1, Q2]);
      await expect.poll(() => [Q1, Q2].every((id) => existsSync(summaryOf(fx, id)))).toBe(true);
      expect(handedOver(fx)).toEqual([]);
    } finally {
      await next.srv.close();
    }
  });

  it('a hand-over that cannot be written never answers idle: the queue stays in the service, and the next pass writes it', async () => {
    const fx = fixture();
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      const c = await door(b.srv.port);
      // The hand-over directory's name is taken by a file: nothing can be written under it.
      writeFileSync(path.join(fx.cfg.root, HANDOVER_DIR), 'in the way\n');
      ask(fx, 'act-4', fx.clock.now + 15 * MIN);
      b.drain.poll();
      c.send(submitOf(Q1));
      await expect.poll(() => [...b.svc.positions().keys()]).toEqual([Q1]);
      expect(pass(fx, b.drain), 'nothing in progress, but the queue is not on disk').toBe(draining('act-4', 0));
      expect([...b.svc.positions().keys()], 'the run is still the service\'s').toEqual([Q1]);
      rmSync(path.join(fx.cfg.root, HANDOVER_DIR));
      expect(pass(fx, b.drain)).toBe(idle('act-4', 1));
      expect([...b.svc.positions().keys()]).toEqual([]);
      withdraw(fx);
      b.drain.poll();
      await expect.poll(() => u.ran).toEqual([Q1]);
      await expect.poll(() => existsSync(summaryOf(fx, Q1))).toBe(true);

      // A request withdrawn while the queue never reached the disk: the run still in the service starts, with nothing
      // else to start it (no run ends, nothing is submitted).
      rmSync(path.join(fx.cfg.root, HANDOVER_DIR), { recursive: true, force: true });
      writeFileSync(path.join(fx.cfg.root, HANDOVER_DIR), 'in the way\n');
      ask(fx, 'act-4b', fx.clock.now + 15 * MIN);
      b.drain.poll();
      c.send(submitOf(Q2));
      await expect.poll(() => [...b.svc.positions().keys()]).toEqual([Q2]);
      expect(pass(fx, b.drain)).toBe(draining('act-4b', 0));
      withdraw(fx);
      b.drain.poll();
      await expect.poll(() => u.ran).toEqual([Q1, Q2]);
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });

  it('a cancel for a handed-over run removes it from disk: it is not queued again, and the answer counts one fewer', async () => {
    const fx = fixture();
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      const c = await door(b.srv.port);
      ask(fx, 'act-5', fx.clock.now + 15 * MIN);
      b.drain.poll();
      c.send(submitOf(Q1));
      c.send(submitOf(Q2));
      await expect.poll(() => answerOf(fx)).toBe(idle('act-5', 2));
      c.send({ t: 'run.cancel', runId: Q1 });
      await expect.poll(() => handedOver(fx).map((n) => n.slice(-37, -5))).toEqual([Q2]);
      expect(pass(fx, b.drain)).toBe(idle('act-5', 1));
      // A cancel for an id this service never handed over touches nothing.
      c.send({ t: 'run.cancel', runId: Q3 });
      await settle();
      expect(handedOver(fx)).toHaveLength(1);
      withdraw(fx);
      b.drain.poll();
      await expect.poll(() => u.ran).toEqual([Q2]);
      await settle();
      expect(u.ran).toEqual([Q2]);
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });

  it('a request that is a link, or that does not read as one, closes nothing; one that turns unreadable in mid-drain ends nothing early', async () => {
    const fx = fixture();
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      const c = await door(b.srv.port);
      const real = path.join(fx.dir, 'elsewhere');
      writeFileSync(real, `act\tact-6\ndeadline\t${(fx.clock.now + 15 * MIN) / 1000}\n`);
      symlinkSync(real, fx.request);
      b.drain.poll();
      expect(b.drain.closed(), 'a link is not followed').toBe(false);
      rmSync(fx.request);
      writeFileSync(fx.request, '{"act":"act-6"}\n');
      b.drain.poll();
      expect(b.drain.closed(), 'a text that is no request').toBe(false);
      c.send(submitOf(Q1));
      await expect.poll(() => u.ran).toEqual([Q1]);
      await expect.poll(() => existsSync(summaryOf(fx, Q1))).toBe(true);

      ask(fx, 'act-6', fx.clock.now + 15 * MIN);
      b.drain.poll();
      c.send(submitOf(Q2));
      await expect.poll(() => answerOf(fx)).toBe(idle('act-6', 1));
      writeFileSync(fx.request, 'half a write');
      fx.clock.now += 14 * MIN;
      b.drain.poll();
      expect(b.drain.closed(), 'no information is not a withdrawal').toBe(true);
      expect(answerOf(fx)).toBe(idle('act-6', 1));
      fx.clock.now += MIN;
      b.drain.poll();
      expect(b.drain.closed(), 'its own deadline still ends it').toBe(false);
      await expect.poll(() => u.ran).toEqual([Q1, Q2]);
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });

  it('with no request the queue depth is what it was: a hand-over file still waiting for the timer is not counted', async () => {
    const fx = fixture();
    const b = await boot(fx, units(fx).sys);
    try {
      mkdirSync(path.join(fx.cfg.root, HANDOVER_DIR), { recursive: true });
      writeFileSync(path.join(fx.cfg.root, HANDOVER_DIR, `000000000000001-000001-${Q1}.json`), `${JSON.stringify(submitOf(Q1))}\n`);
      expect(statusOf(b.svc).queueDepth).toBe(0);
    } finally {
      await b.srv.close();
    }
  });

  it('a box whose unit gives the service no runtime directory still drains and reopens; it only cannot answer', async () => {
    const fx = fixture();
    rmSync(fx.run, { recursive: true });
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      const c = await door(b.srv.port);
      ask(fx, 'act-7', fx.clock.now + 15 * MIN);
      b.drain.poll();
      c.send(submitOf(Q1));
      await expect.poll(() => handedOver(fx)).toHaveLength(1);
      expect(answerOf(fx)).toBeNull();
      await settle();
      expect(u.ran).toEqual([]);
      withdraw(fx);
      b.drain.poll();
      await expect.poll(() => u.ran).toEqual([Q1]);
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The ready file, and the entry point's order.
// ---------------------------------------------------------------------------------------------------------------

describe('the ready file (spec §2.7)', () => {
  it('names the release the service runs from and its process id, and leaves no other file', () => {
    const d = mkTmp('ccrc-tb-ready-');
    expect(announceReady(d, TAG, 4242)).toEqual({ ok: true });
    expect(readdirSync(d)).toEqual([READY_FILE]);
    expect(readFileSync(path.join(d, READY_FILE), 'utf8')).toBe(`release\t${TAG}\npid\t4242\n`);
  });

  it('a tree with no release stamp writes none, and a box with no runtime directory writes none: neither throws', () => {
    const d = mkTmp('ccrc-tb-ready-');
    expect(announceReady(d, null, 4242)).toEqual({ ok: false, why: 'this tree has no release stamp' });
    expect(readdirSync(d)).toEqual([]);
    const r = announceReady(path.join(d, 'no-runtime-dir'), TAG, 4242);
    expect(r.ok).toBe(false);
    expect(existsSync(path.join(d, 'no-runtime-dir'))).toBe(false);
  });

  /** `main()`'s body, comments dropped. */
  const mainBody = (): string => {
    const src = readFileSync(MAIN_TS, 'utf8');
    return src.slice(src.indexOf('async function main(): Promise<void> {')).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  };

  it('main() writes it only after the service has bound its address, for its own release and process', () => {
    const body = mainBody();
    const bound = body.indexOf('await startTestboxServer(');
    const ready = body.indexOf('announceReady(BOX_PATHS.runtimeDir, releaseFacts(release).release, process.pid)');
    expect(bound, 'main() binds').toBeGreaterThan(0);
    expect(ready, 'main() announces').toBeGreaterThan(bound);
  });

  it('main() polls the drain once before the service starts or queues anything, and then on its timer; a stop removes both files', () => {
    const body = mainBody();
    const first = body.indexOf('drain?.poll();');
    expect(first, 'main() polls first').toBeGreaterThan(0);
    expect(first).toBeLessThan(body.indexOf('await service.start();'));
    expect(first).toBeLessThan(body.indexOf('toolSyncOf(service)?.resume();'));
    expect(body).toContain('setInterval(() => drain?.poll(), DRAIN_POLL_MS)');
    expect(body).toContain('boxFs.remove(path.join(BOX_PATHS.runtimeDir, READY_FILE));');
    expect(body).toContain('drain?.retire();');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The wire rule (D-8912): older peers, both ways.
// ---------------------------------------------------------------------------------------------------------------

describe('no frame gained a field (D-8912)', () => {
  it('the family\'s frame types and protocol number are the released ones', () => {
    expect(keys(TESTBOX_FRAME_TYPE_MAP)).toEqual(RELEASED_FRAME_TYPES);
    expect(TESTBOX_PROTO).toBe(1);
  });

  it('the status reader still refuses a field it does not name: a fact added to the answer would turn a released fleet agent away', () => {
    const base = JSON.parse(RELEASED_STATUS_JSON) as Record<string, unknown>;
    expect(readTestboxFrame(JSON.stringify(base)).ok).toBe(true);
    for (const extra of ['nodeId', 'drain', 'ready', 'node', 'managed']) {
      expect(readTestboxFrame(JSON.stringify({ ...base, [extra]: 'x' })), extra).toEqual({ ok: false, reason: `status: extra field ${extra}` });
    }
    expect(readTestboxFrame(JSON.stringify({ ...base, tools: { ...(base['tools'] as object), measuredAt: MEASURED_AT } }))).toEqual({ ok: false, reason: 'tools: extra field measuredAt' });
  });

  /** The fleet agent's own call (`testboxOp.ts#callBox`, the code a released fleet agent runs: this change does not
   *  touch it), against a box at `port`. */
  const fleetCall = (port: number, frame: ToolsSync | null) => callBox({ url: `http://127.0.0.1:${port}`, token: 'tok', deadlineMs: 3000 }, frame);

  it('a released fleet agent against a new box: it reads the box\'s answer unmanaged, managed, draining and drained, and its tools.sync is taken', async () => {
    const fx = fixture();
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      const seen: [string, Awaited<ReturnType<typeof fleetCall>>][] = [];
      seen.push(['unmanaged', await fleetCall(b.srv.port, null)]);
      adopt(fx);
      seen.push(['managed', await fleetCall(b.srv.port, null)]);
      adopt(fx, { node: MEASURED.node });
      seen.push(['managed, five tools not measured', await fleetCall(b.srv.port, null)]);
      adopt(fx);
      const c = await door(b.srv.port);
      c.send(submitOf(RUN_R));
      await expect.poll(() => u.ran).toEqual([RUN_R]);
      c.send(submitOf(Q1));
      await expect.poll(() => [...b.svc.positions().keys()]).toEqual([Q1]);
      ask(fx, 'act-8', fx.clock.now + 15 * MIN);
      b.drain.poll();
      seen.push(['draining', await fleetCall(b.srv.port, null)]);
      u.release();
      await expect.poll(() => { b.drain.poll(); return answerOf(fx); }).toBe(idle('act-8', 1));
      seen.push(['drained', await fleetCall(b.srv.port, null)]);
      // Its tools.sync, as the update lane's signal and the card's button send it: taken, nothing started.
      seen.push(['drained, with a tools.sync', await fleetCall(b.srv.port, syncFrame())]);
      await settle();
      expect(u.toolsStarts).toEqual([]);
      for (const [what, r] of seen) {
        expect(r.ok ? 'read' : `${r.failure}: ${r.detail}`, what).toBe('read');
        if (r.ok) expectReleasedShape(r.status, what);
      }
      c.ws.close();
    } finally {
      u.release();
      await b.srv.close();
    }
  });

  it('a new fleet agent against a released box: it reads the released answer, and what it sends is the released tools.sync', async () => {
    // A released box, as a WebSocket server: it answers a hello with the released status answer and takes what follows.
    const got: string[] = [];
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => { wss.once('listening', () => r()); });
    wss.on('connection', (ws) => {
      let greeted = false;
      ws.on('message', (m) => {
        if (!greeted) { greeted = true; ws.send(RELEASED_STATUS_JSON); return; }
        got.push(m.toString());
      });
    });
    const port = (wss.address() as { port: number }).port;
    try {
      const read = await fleetCall(port, null);
      expect(read.ok ? read.status : read).toEqual(JSON.parse(RELEASED_STATUS_JSON));
      const sent = await fleetCall(port, syncFrame());
      expect(sent.ok).toBe(true);
      await expect.poll(() => got.length).toBe(1);
      const frame = JSON.parse(got[0]!) as Record<string, unknown>;
      expect(keys(frame)).toEqual(RELEASED_TOOLS_SYNC_KEYS);
      expect(keys(frame['versions'] as object)).toEqual(RELEASED_TOOLS_KEYS);
    } finally {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => { wss.close(() => r()); });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// One mover while a request stands (D-8907, D-8913; spec §2.5 "It stays up", §2.8 "One mover per box"). A box no act
// has adopted yet is still the tool sync's to move, and its first act asks this service to drain: while the request
// stands the tool sync starts nothing, and the answer is never `idle` over a tools unit or a takeover in flight.
// ---------------------------------------------------------------------------------------------------------------

describe('while a drain request stands the tool sync starts nothing (D-8907, D-8913)', () => {
  const BOX: BoxTools = { release: TAG, versions: SET, set: 's.bootstrap', managed: 'unmanaged' };
  const FAILED: ToolsState = { ...IDLE_TOOLS, sync: { state: 'failed', detail: 'node: no such version', at: MEASURED_AT }, last: syncFrame(), attempts: 1, nextAt: 5 };
  const sync = (svc: object): ToolSync => toolSyncOf(svc)!;

  it('the decider: a frame under a standing request is kept and starts nothing; released, it is the frame to request again', () => {
    expect(requested(IDLE_TOOLS, syncFrame(), BOX, MEASURED_AT, false).start?.release, 'the control: no request stands').toBe('v0.0.3');
    const kept = requested(IDLE_TOOLS, syncFrame(), BOX, MEASURED_AT, true);
    expect(kept).toEqual({ state: { ...IDLE_TOOLS, pending: syncFrame() }, start: null });
    expect(released(kept.state)).toEqual({ state: IDLE_TOOLS, frame: syncFrame() });
    expect(released(IDLE_TOOLS), 'nothing kept').toEqual({ state: IDLE_TOOLS, frame: null });
    // A frame that waits for a sync in flight, or for a takeover, is theirs to run: it is not requested twice.
    for (const s of [{ ...kept.state, running: true }, { ...kept.state, takeover: true }]) expect(released(s)).toEqual({ state: s, frame: null });
    // A managed box keeps nothing, with a request standing or not (D-8913).
    expect(requested(IDLE_TOOLS, syncFrame(), { ...BOX, managed: 'managed' }, MEASURED_AT, true)).toEqual({ state: IDLE_TOOLS, start: null });
  });

  it('the decider: a failed sync is due on a box the tool sync moves with no request standing, and never otherwise', () => {
    expect(retryDue(FAILED, 5, 'unmanaged', false)?.release).toBe('v0.0.3');
    expect(retryDue(FAILED, 5, 'unmanaged', true), 'a request stands').toBeNull();
    expect(retryDue(FAILED, 5, 'managed', false), 'the update act is the mover').toBeNull();
    expect(retryDue(FAILED, 5, 'unreadable', false), 'it may be managed').toBeNull();
  });

  it('the decider: the handed-over runs count in the queue depth only while a request stands', () => {
    const a = JSON.parse(RELEASED_STATUS_JSON) as StatusAnswer;
    expect(withHandedOver({ ...a, queueDepth: 1 }, true, 2)).toEqual({ ...a, queueDepth: 3 });
    expect(withHandedOver({ ...a, queueDepth: 1 }, false, 2)).toEqual({ ...a, queueDepth: 1 });
  });

  it('through the door: a tools.sync under a standing request starts no tools unit and the answer stays idle; the request over, it runs once', async () => {
    const fx = fixture();
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      const c = await door(b.srv.port);
      ask(fx, 'act-9', fx.clock.now + 15 * MIN);
      expect(pass(fx, b.drain)).toBe(idle('act-9', 0));
      c.send(syncFrame());
      await expect.poll(() => sync(b.svc).stateNow().pending?.release).toBe('v0.0.3');
      await settle();
      expect(u.toolsStarts, 'the old mover does not start under the lease').toEqual([]);
      expect(c.closed(), 'the frame is not refused').toBeNull();
      expect(pass(fx, b.drain)).toBe(idle('act-9', 0));
      expectReleasedShape(statusOf(b.svc), 'a tools.sync kept under a request');
      expect(existsSync(path.join(fx.cfg.root, HANDOVER_DIR, HANDOVER_TOOLS_SYNC)), 'the kept frame has one holder, this service').toBe(false);
      withdraw(fx);
      b.drain.poll();
      await expect.poll(() => u.toolsStarts.length).toBe(1);
      await sync(b.svc).settled();
      await settle();
      expect(u.toolsStarts, 'once').toHaveLength(1);
      expect(sync(b.svc).stateNow().pending).toBeNull();
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });

  it('the driver: a failed sync is not run again while a request stands; the request over, the timer runs it', async () => {
    const fx = fixture();
    const u = units(fx, { toolsExit: 1 });
    let closed = false;
    const t = new ToolSync({
      sys: u.sys, root: fx.cfg.root, toolsDir: fx.cfg.toolsDir, settings: toolsSettings(LINES, durationMs), now: () => fx.clock.now, exit: () => undefined,
      closed: () => closed,
    });
    t.serve({
      status: () => JSON.parse(RELEASED_STATUS_JSON) as StatusAnswer, idle: async () => undefined, tick: async () => undefined, liveRuns: () => [],
      waiting: () => [], submit: () => undefined, forgetWaiting: () => new Map(),
    });
    await t.request(syncFrame());
    expect(t.stateNow().sync.state).toBe('failed');
    closed = true;
    fx.clock.now += 3 * MIN;
    await t.tick();
    expect(u.toolsStarts, 'no retry under the lease').toHaveLength(1);
    closed = false;
    await t.tick();
    expect(u.toolsStarts, 'the lease over, the retry runs').toHaveLength(2);
  });

  it('a sync in flight when the request comes: the answer says draining until its unit has ended, and nothing is handed over before', async () => {
    const fx = fixture();
    const h = heldTools(fx);
    const b = await boot(fx, h.sys);
    try {
      const c = await door(b.srv.port);
      c.send(syncFrame());
      await expect.poll(() => h.starts.length).toBe(1);
      ask(fx, 'act-10', fx.clock.now + 15 * MIN);
      expect(pass(fx, b.drain), 'no run is in progress, but the tools unit is').toBe(draining('act-10', 0));
      c.send(submitOf(Q1));
      await expect.poll(() => [...b.svc.positions().keys()]).toEqual([Q1]);
      expect(pass(fx, b.drain)).toBe(draining('act-10', 0));
      expect(handedOver(fx)).toEqual([]);
      h.release();
      await sync(b.svc).settled();
      expect(pass(fx, b.drain)).toBe(idle('act-10', 1));
      c.ws.close();
    } finally {
      h.release();
      await b.srv.close();
    }
  });

  it('a frame that waited for a sync in flight when the request came is not written to the hand-over, and runs once after the request', async () => {
    const fx = fixture();
    const h = heldTools(fx);
    const b = await boot(fx, h.sys);
    try {
      const c = await door(b.srv.port);
      c.send(syncFrame('v0.0.3'));
      await expect.poll(() => h.starts.length).toBe(1);
      c.send(syncFrame('v0.0.4'));
      await expect.poll(() => sync(b.svc).stateNow().pending?.release).toBe('v0.0.4');
      ask(fx, 'act-11', fx.clock.now + 15 * MIN);
      b.drain.poll();
      c.send(submitOf(Q1));
      await expect.poll(() => [...b.svc.positions().keys()]).toEqual([Q1]);
      h.release();
      await sync(b.svc).settled();
      expect(pass(fx, b.drain)).toBe(idle('act-11', 1));
      expect(readdirSync(path.join(fx.cfg.root, HANDOVER_DIR)).filter((n) => !n.endsWith('.json')), 'the runs only: the frame stays this service\'s').toEqual([]);
      expect(sync(b.svc).stateNow().pending?.release).toBe('v0.0.4');
      expect(h.starts, 'the waiting frame does not start under the lease').toHaveLength(1);
      withdraw(fx);
      b.drain.poll();
      await expect.poll(() => h.starts.length).toBe(2);
      h.release();
      await sync(b.svc).settled();
      await settle();
      expect(h.starts, 'once, not once from memory and once from disk').toHaveLength(2);
      expect(sync(b.svc).stateNow()).toMatchObject({ pending: null, attempts: 0 });
      c.ws.close();
    } finally {
      h.release();
      h.release();
      await b.srv.close();
    }
  });

  it('a takeover that ends under a standing request: the answer never says idle, up to the exit and after it', async () => {
    const fx = fixture();
    const h = heldTools(fx, 'result\tok\nrelease\tv0.0.3\nset\ts.bootstrap\ntakeover\t1\nnode-changed\t0\n');
    const exits: number[] = [];
    const answers: (string | null)[] = [];
    const b = await boot(fx, h.sys, { exit: (code) => { answers.push(answerOf(fx)); exits.push(code); } });
    try {
      const c = await door(b.srv.port);
      c.send(syncFrame());
      await expect.poll(() => h.starts.length).toBe(1);
      ask(fx, 'act-12', fx.clock.now + 15 * MIN);
      expect(pass(fx, b.drain)).toBe(draining('act-12', 0));
      h.release();
      await expect.poll(() => exits).toEqual([0]);
      expect(answers, 'what the updater reads when the process leaves').toEqual([draining('act-12', 0)]);
      // The takeover has begun: a pass that still runs before the process is gone does not answer idle either. The
      // unit's runtime directory goes with the process, and the next service answers for itself.
      expect(pass(fx, b.drain)).toBe(draining('act-12', 0));
      c.ws.close();
    } finally {
      h.release();
      await b.srv.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The pristine store's node, the used ids, and the two guards the first table missed.
// ---------------------------------------------------------------------------------------------------------------

describe('what the drain and a managed box leave as they were', () => {
  const INPUTS: NonNullable<ServiceSeams['inputs']> = async (_m, _id, paths) => paths.map((p): InstallInput => ({ path: p, bytes: Buffer.from(`${p}\n`) }));
  const INSTALL_UNIT = 'ccrc-testbox-install.service';
  const keyUnder = (node: string): string => installKey(ROW.packages[0]!.installInputs.map((p) => ({ path: p, bytes: Buffer.from(`${p}\n`) })), node, `${process.platform}-${process.arch}`);

  it('the installs\' node: the current set\'s on a box the tool sync moves; on a managed box the one the service runs on, never tools.json\'s', async () => {
    const fx = fixture();
    const probe = await boot(fx, units(fx).sys);
    try {
      expect(toolSyncOf(probe.svc)!.node(), 'unmanaged: the set\'s, as before').toBe(SET.node);
      // tools.json is written after the service starts (spec §2.5, steps 7 and 8): at the start it names the node before.
      adopt(fx, { ...MEASURED, node: '20.0.0' });
      expect(toolSyncOf(probe.svc)!.node(), 'managed: not this driver\'s to say').toBeNull();
      expect(statusOf(probe.svc).tools.node, 'the status answer still reads tools.json').toBe('20.0.0');
    } finally {
      await probe.srv.close();
    }
    // A service started on the managed box keys its installs on the node it runs on.
    const u = units(fx);
    const b = await boot(fx, u.sys, { inputs: INPUTS });
    try {
      const c = await door(b.srv.port);
      c.send(submitOf(Q1));
      await expect.poll(() => c.summaries()).toEqual([Q1]);
      await expect.poll(() => u.started.includes(INSTALL_UNIT)).toBe(true);
      const spec = readFileSync(path.join(fx.cfg.root, 'specs', 'install'), 'utf8');
      expect(spec.includes(keyUnder(process.versions.node)), 'keyed on the running node').toBe(true);
      expect(spec.includes(keyUnder('20.0.0')), 'not on the stale file\'s').toBe(false);
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });

  it('a run id on disk is used: a second submission with it is refused at the door, and the first run stays its submitter\'s', async () => {
    const fx = fixture();
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      const first = await door(b.srv.port);
      const second = await door(b.srv.port);
      ask(fx, 'act-13', fx.clock.now + 15 * MIN);
      b.drain.poll();
      first.send(submitOf(Q1));
      await expect.poll(() => answerOf(fx)).toBe(idle('act-13', 1));
      second.send({ ...submitOf(Q1), branch: 'other-branch' });
      await expect.poll(() => second.closed()).toBe(`run id ${Q1} already used`);
      expect(handedOver(fx), 'one run under that id').toHaveLength(1);
      expect(readFileSync(path.join(fx.cfg.root, HANDOVER_DIR, handedOver(fx)[0]!), 'utf8')).not.toContain('other-branch');
      withdraw(fx);
      b.drain.poll();
      await expect.poll(() => first.summaries(), { message: 'the handed-over run is not refused when it is queued again' }).toEqual([Q1]);
      expect(readdirSync(path.join(fx.cfg.root, HANDOVER_DIR)), 'nothing dropped').toEqual([]);
      first.ws.close();
    } finally {
      await b.srv.close();
    }
  });

  it('a run id on disk under the next service is used too; cancelled, it is free again', async () => {
    const fx = fixture();
    ask(fx, 'act-14', fx.clock.now + 15 * MIN);
    mkdirSync(path.join(fx.cfg.root, HANDOVER_DIR), { recursive: true });
    writeFileSync(path.join(fx.cfg.root, HANDOVER_DIR, `000000000000001-000001-${Q1}.json`), `${JSON.stringify(submitOf(Q1))}\n`);
    const u = units(fx);
    const b = await boot(fx, u.sys);
    try {
      expect(b.resumed).toBe(0);
      const dup = await door(b.srv.port);
      dup.send(submitOf(Q1));
      await expect.poll(() => dup.closed()).toBe(`run id ${Q1} already used`);
      const c = await door(b.srv.port);
      c.send({ t: 'run.cancel', runId: Q1 });
      await expect.poll(() => handedOver(fx)).toEqual([]);
      c.send(submitOf(Q1));
      await expect.poll(() => answerOf(fx)).toBe(idle('act-14', 1));
      expect(c.closed(), 'the id is free once its run is cancelled').toBeNull();
      withdraw(fx);
      b.drain.poll();
      await expect.poll(() => c.summaries()).toEqual([Q1]);
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });

  it('the driver: the run being queued again is not a second run under its id, and only while it is being queued', () => {
    const fx = fixture();
    const asked: boolean[] = [];
    const t = new ToolSync({ sys: units(fx).sys, root: fx.cfg.root, toolsDir: fx.cfg.toolsDir, settings: toolsSettings(LINES, durationMs), now: () => START, exit: () => undefined });
    t.serve({
      status: () => JSON.parse(RELEASED_STATUS_JSON) as StatusAnswer, idle: async () => undefined, tick: async () => undefined, liveRuns: () => [],
      waiting: () => [], submit: (f) => { asked.push(t.handedOver(f.runId)); }, forgetWaiting: () => new Map(),
    });
    const file = path.join(fx.cfg.root, HANDOVER_DIR, `000000000000001-000001-${Q1}.json`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(submitOf(Q1))}\n`);
    expect([t.handedOver(Q1), t.handedOver(Q2)]).toEqual([true, false]);
    expect(t.resume()).toBe(1);
    expect(asked, 'the service, asked while it takes the run').toEqual([false]);
    // The same id on disk again (a later hand-over): used again.
    writeFileSync(file, `${JSON.stringify(submitOf(Q1))}\n`);
    expect(t.handedOver(Q1)).toBe(true);
  });

  it('a pristine build waiting when the queue is handed over stays the service\'s: it is built when the request is over', async () => {
    const fx = fixture();
    const u = units(fx);
    const b = await boot(fx, u.sys, { inputs: INPUTS });
    try {
      const c = await door(b.srv.port);
      c.send(submitOf(RUN_R));
      await expect.poll(() => u.ran).toEqual([RUN_R]);
      ask(fx, 'act-15', fx.clock.now + 15 * MIN);
      b.drain.poll();
      c.send(submitOf(Q1));
      await expect.poll(() => [...b.svc.positions().keys()]).toContain(Q1);
      // The run ends and its install key is queued for a build, which waits behind the request.
      u.release();
      await expect.poll(() => pass(fx, b.drain)).toBe(idle('act-15', 1));
      expect(u.started.filter((x) => x === INSTALL_UNIT), 'no build starts while the request stands').toEqual([]);
      withdraw(fx);
      b.drain.poll();
      await expect.poll(() => u.started.includes(INSTALL_UNIT), { timeout: 5000 }).toBe(true);
      await expect.poll(() => u.ran).toEqual([RUN_R, Q1]);
      c.ws.close();
    } finally {
      u.release();
      await b.srv.close();
    }
  });

  it('a write that fails leaves no temporary name beside the file', () => {
    const d = mkTmp('ccrc-tb-boxfs-');
    // The file's own name is taken by a directory that is not empty: the rename fails after the temporary file is written.
    mkdirSync(path.join(d, 'ready', 'in-the-way'), { recursive: true });
    expect(() => writeSmall(d, 'ready', 'release\tv0.0.2\n')).toThrow();
    expect(readdirSync(d)).toEqual(['ready']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The service's runtime directory, and the files' text stated once for both sides.
// ---------------------------------------------------------------------------------------------------------------

describe('the unit gives the service its runtime directory (spec §2.5, §2.7)', () => {
  const directives = (): string[] => readFileSync(SERVICE_UNIT, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));

  it('ccrc-testbox.service declares the directory boxFiles.ts writes the ready file and the answer in, under /run', () => {
    expect(path.dirname(RUNTIME_DIR)).toBe('/run');
    expect(directives().filter((l) => l.startsWith('RuntimeDirectory'))).toEqual([`RuntimeDirectory=${path.basename(RUNTIME_DIR)}`]);
  });
});

describe('the box files\' text is stated once for the service and the updater (D-8907)', () => {
  interface BoxFilesFixture {
    readonly maxBytes: number; readonly actId: string;
    readonly paths: { readonly request: string; readonly answer: string; readonly ready: string; readonly nodeId: string; readonly toolsJson: string };
    readonly request: { readonly text: string; readonly act: string; readonly deadline: number };
    readonly answerDraining: { readonly text: string; readonly act: string; readonly running: number };
    readonly answerIdle: { readonly text: string; readonly act: string; readonly queued: number };
    readonly ready: { readonly text: string; readonly release: string; readonly pid: number };
    readonly toolsJson: { readonly text: string; readonly read: Record<string, string | null> };
  }
  const F = JSON.parse(readFileSync(BOX_FILES_FIXTURE, 'utf8')) as BoxFilesFixture;

  it('boxFiles.ts reads and writes exactly the fixture\'s text, at its paths, to its bound', () => {
    expect([BOX_FILE_MAX, ACT_ID.source]).toEqual([F.maxBytes, F.actId]);
    expect({
      request: DRAIN_REQUEST_FILE, answer: path.join(RUNTIME_DIR, DRAIN_ANSWER_FILE), ready: path.join(RUNTIME_DIR, READY_FILE),
      nodeId: path.join(NODE_STATE_DIR, NODE_ID_FILE), toolsJson: path.join(NODE_STATE_DIR, TOOLS_JSON_FILE),
    }).toEqual(F.paths);
    expect(parseDrainRequest(F.request.text)).toEqual({ ok: true, request: { actId: F.request.act, deadlineMs: F.request.deadline * 1000 } });
    expect(encodeDrainAnswer({ act: F.answerDraining.act, state: 'draining', running: F.answerDraining.running })).toBe(F.answerDraining.text);
    expect(encodeDrainAnswer({ act: F.answerIdle.act, state: 'idle', queued: F.answerIdle.queued })).toBe(F.answerIdle.text);
    expect(encodeReady({ release: F.ready.release, pid: F.ready.pid })).toBe(F.ready.text);
    expect(parseMeasuredTools(F.toolsJson.text)).toEqual(F.toolsJson.read);
  });
});

// Gate G2 on the entry point's own composition (capture runner PR 3b): the capture desk `serviceFor` builds reads the tool
// sync's admissions, so while a drain stands (the same `admitting` a takeover closes) a capture is ended unrun.
describe('the entry point\'s capture desk starts no capture while admissions are closed (gate G2)', () => {
  it('a drain stands: a capture through the door is queued, then ended with no verdict and the word, never started', async () => {
    const plain = fixture();
    // The box's own settings file names its lines, which is what makes this node the test box (`probes.ts#probeRole`).
    const lines = new Map([...LINES].map(([k, v]) => [k, { key: k, def: '', value: v.value, from: 'file' }]));
    const fx: Fx = { ...plain, cfg: { ...plain.cfg, lines: lines as unknown as TestboxConfig['lines'] } };
    const builds = path.join(fx.cfg.root, 'captures', 'builds');
    mkdirSync(builds, { recursive: true });
    writeFileSync(path.join(builds, '2.1.100'), 'bytes');
    const started: string[] = [];
    const b = await boot(fx, units(fx).sys, {
      capture: { home: fx.dir, tmuxBase: '/tmp', seams: { launcher: { start: async (spec) => { started.push(spec.binary); throw new Error('not here'); } } } },
    });
    try {
      ask(fx, 'act-1', START + 10 * MIN);
      b.drain.poll();
      const c = await door(b.srv.port);
      c.send({ t: 'capture.submit', captureId: 'a'.repeat(32), build: '2.1.100' });
      await expect.poll(() => c.frames.filter((f) => f.includes('"capture.state"') && /"(ended|refused)"/.test(f)).length).toBe(1);
      const states = c.frames.map((f) => JSON.parse(f) as { t: string; state?: string; detail?: string | null }).filter((f) => f.t === 'capture.state');
      expect(states.map((f) => f.state)).toEqual(['queued', 'ended']);
      expect(states.at(-1)!.detail).toBe(CAPTURE_CLOSED_DETAIL);
      expect(started).toEqual([]);
      c.ws.close();
    } finally {
      await b.srv.close();
    }
  });
});
