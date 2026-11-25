// D-7406, D-7428, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.0, §2.9 A). L5: the
// test service's entry point, the agent package's SECOND (compiled to `agent/dist/agent/src/testbox/main.js`, which
// TB7's `ccrc-testbox.service` runs as the service user). It reads its settings once (`config.ts`), binds the tailnet
// address only (it refuses `0.0.0.0`, `::` and loopback, spec §2.0: a run's loopback-only network must not reach it),
// checks each connection's `hello` to the fleet agent's contract (`hello.ts`) against the service's token file, and
// speaks `shared/testbox.ts`'s frames, `TESTBOX_PROTO`, never the fleet agent's `AgentReq` (D-7428). It imports
// nothing of the fleet agent's (`agent/test/testbox-imports.test.ts`).
//
// D-8907 (spec docs/superpowers/specs/2026-11-22-test-box-managed-node-design.md §2.5, §2.7): the entry point owns two
// more things. The drain's poll (`drainer.ts`): once before the service starts, so a request that stands then closes
// admission before anything is queued, and then on its own short timer. And the ready file (`announceReady`), written
// once the service has bound its address: the release it runs from and its process id, which the box's updater reads
// as its form of "the new release answers", with no token and no network. Neither is a frame (D-8912). A stop removes
// both files here; the unit's `RuntimeDirectory=` removes the directory at every stop, a takeover's exit included.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { BlockList, isIP } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { isReleaseTag } from '../../../shared/api.js';
import { readTestboxFrame } from '../../../shared/testbox.js';
import { startedAsProgram } from './entry.js';
import { BOX_PATHS, encodeReady, READY_FILE, type BoxPaths } from './boxFiles.js';
import { boxFs, type BoxFs } from './boxFs.js';
import {
  CAPTURE_TIMINGS, captureBuildsDir, captureDirsRoot, buildsToPrune, captureSocketFits, staleCaptureDirs, type BuildFileFacts, type CaptureTimings, type StandInReply,
} from './capture.js';
import { CaptureDesk, type CaptureRunnerLike } from './captureDesk.js';
import { nodeDeliveryDriver } from './captureDeliveryRun.js';
import { CaptureRunner, tmuxLauncher, type CaptureDeliveryDeps, type CaptureLauncher, type TmuxLauncherSeams } from './captureRunner.js';
import { startStandIn, type StandIn } from './captureStub.js';
import { durationMs, hostPort, readRepoRows, readTestboxConfig, type TestboxConfig } from './config.js';
import { reflinkProbe, reflinkProbeDir } from './fsprobe.js';
import { attachDrainer, Drainer, drainerOf } from './drainer.js';
import { AUTH_CLOSE_CODE, checkHello, DEFAULT_HELLO_TIMEOUT_MS } from './hello.js';
import { gitEnv, mirrorOps, realGit, runTreeFiles } from './mirror.js';
import { pristineSettings } from './pristine.js';
import { ProbeDesk, type ProbeRunner } from './probeDesk.js';
import { fileBudgetStore, fleetConfigDirs, realPathOf } from './probeFs.js';
import { probeRole, probeSettings } from './probes.js';
import { registryCacheDir, registrySettings, startRegistry } from './registry.js';
import { liveRunIds } from './runs.js';
import { FRAME_HANDLERS, TestboxService, type Conn, type PristineDeps } from './service.js';
import { systemctlManager, type SystemManager } from './systemd.js';
import { toolsSettings } from './tools.js';
import { attachToolSync, statusOf, ToolSync, toolSyncOf } from './toolsync.js';
import { boundedExec, SERVICE_PATH, SHORT_BOUND_MS } from './exec.js';

/** WebSocket close code for a frame the service will not take (RFC 6455 "policy violation"). */
export const POLICY_CLOSE_CODE = 1008;
/** A close frame's reason is at most 123 bytes (RFC 6455); the refusal is cut to fit. */
const CLOSE_REASON_MAX = 123;

/** The unspecified addresses (every interface), in each family and IPv4-mapped. */
const EVERY_INTERFACE = new BlockList();
EVERY_INTERFACE.addAddress('0.0.0.0', 'ipv4');
EVERY_INTERFACE.addAddress('::', 'ipv6');
EVERY_INTERFACE.addAddress('::ffff:0.0.0.0', 'ipv6');
/** Loopback, in each family and IPv4-mapped. */
const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');
LOOPBACK.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

/** What a host is, compared as an address (so `0::`, `0:0:0:0:0:0:0:1` and `::ffff:7f00:1` read as what they are):
 *  every interface, loopback, another address, or not an address at all. */
export function listenClass(host: string): 'every-interface' | 'loopback' | 'address' | 'not-an-address' {
  if (host === '') return 'every-interface';
  const family = isIP(host);
  if (family === 0) return 'not-an-address';
  const type = family === 4 ? 'ipv4' : 'ipv6';
  try {
    if (EVERY_INTERFACE.check(host, type)) return 'every-interface';
    if (LOOPBACK.check(host, type)) return 'loopback';
  } catch {
    return 'not-an-address';
  }
  return 'address';
}

/** Why a configured listen host is refused, or `null`: the wildcard addresses, loopback and a name that is not an
 *  address (a name could resolve to either), each however it is spelled. */
export function listenRefusal(host: string): string | null {
  switch (listenClass(host)) {
    case 'every-interface': return `${host || '(empty)'} is every interface; the service binds the tailnet address only`;
    case 'not-an-address': return `${host} is not an address; the service binds the tailnet address only`;
    case 'loopback': return `${host} is loopback; a run's loopback must not reach the service`;
    case 'address': return null;
  }
}

export interface TestboxServerOpts {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly service: TestboxService;
  readonly helloTimeoutMs?: number;
}

export interface RunningTestbox { readonly port: number; close(): Promise<void> }

function send(ws: WebSocket, frame: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

function handleConnection(ws: WebSocket, o: TestboxServerOpts): void {
  let authed = false;
  const helloTimer = setTimeout(() => { if (!authed) ws.close(AUTH_CLOSE_CODE, 'hello-timeout'); }, o.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS);
  const conn: Conn = {
    send: (frame) => send(ws, frame),
    refuse: (reason) => ws.close(POLICY_CLOSE_CODE, Buffer.from(reason, 'utf8').subarray(0, CLOSE_REASON_MAX).toString('utf8').replace(/\uFFFD$/, '')),
  };
  ws.on('message', (raw) => {
    const text = raw.toString();
    if (!authed) {
      let msg: unknown;
      try { msg = JSON.parse(text); } catch { clearTimeout(helloTimer); ws.close(); return; }
      clearTimeout(helloTimer);
      if (checkHello(msg, o.token) !== 'ok') { ws.close(AUTH_CLOSE_CODE, 'unauthorized'); return; }
      authed = true;
      // TB6 (D-7408): with the tool sync's state in it, when a driver serves this service.
      send(ws, statusOf(o.service));
      return;
    }
    const r = readTestboxFrame(text);
    if (!r.ok) { conn.refuse(r.reason); return; }
    const handler = FRAME_HANDLERS[r.value.t];
    if (handler === undefined) { conn.refuse(`${r.value.t} is not a frame the service takes`); return; }
    Promise.resolve(handler(o.service, r.value, conn)).catch((e: unknown) => conn.refuse(e instanceof Error ? e.message : String(e)));
  });
  ws.on('close', () => clearTimeout(helloTimer));
}

/** The WebSocket server. It refuses only the wildcard addresses itself, however spelled; `main` refuses loopback too, from the
 *  settings, so in-process tests can bind loopback while the service never does. */
export async function startTestboxServer(o: TestboxServerOpts): Promise<RunningTestbox> {
  if (listenClass(o.host) === 'every-interface') throw new Error(`the test service must not bind every interface (${o.host || '(empty)'})`);
  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (ws) => handleConnection(ws, o));
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(o.port, o.host, () => resolve());
  });
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : o.port;
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => {
      for (const c of wss.clients) c.terminate();
      wss.close((e1) => httpServer.close((e2) => { const e = e1 ?? e2; if (e) reject(e); else resolve(); }));
    }),
  };
}

/** The release tree this file runs from: `<release>/agent/dist/agent/src/testbox/main.js`. */
export function releaseOf(mainFile: string): string {
  return path.resolve(path.dirname(mainFile), '..', '..', '..', '..', '..');
}

/** The tree's own `build.json` version: the release tag, and the service version without its `v`. */
export function releaseFacts(release: string): { release: string | null; serviceVersion: string } {
  try {
    const v = (JSON.parse(readFileSync(path.join(release, 'build.json'), 'utf8')) as { version?: unknown }).version;
    if (isReleaseTag(v)) return { release: v, serviceVersion: v.slice(1) };
  } catch { /* no stamp: the status answer says the release is not known */ }
  return { release: null, serviceVersion: '0' };
}

/** The token file's one line; an empty or unreadable file refuses the start. */
export function readToken(file: string): string {
  const t = readFileSync(file, 'utf8').trim();
  if (t === '') throw new Error(`${file} holds no token`);
  return t;
}

/** What a test may put in place of the box's own (the service never passes any): the system manager, the reader of
 *  a run's install inputs from its mirror, and the probe runner (D-8290: the box installs none yet, so every probe is
 *  refused `no-runner`). */
export interface ServiceSeams {
  readonly sys?: SystemManager; readonly inputs?: PristineDeps['inputs']; readonly probeRunner?: ProbeRunner;
  /** D-8907: where the drain request and the service's runtime directory are, and the drain's clock. */
  readonly box?: BoxPaths & { readonly now?: () => number };
  /** The capture desk's home, temporary directory and runner seams (spec 2026-11-22 PR 3b). */
  readonly capture?: Pick<CaptureDeskOpts, 'home' | 'tmuxBase' | 'uid' | 'seams'>;
}

/** How often the service looks for a drain request (D-8907: the request is a file, so the service polls for it). */
export const DRAIN_POLL_MS = 2000;

/** The ready file (spec 2026-11-22 §2.7), written once the service has bound its address: the release this tree is
 *  and this process's id. A tree with no release stamp writes none (the updater's gate then fails it, as it should),
 *  and a box whose unit gives the service no runtime directory writes none either: both are said, neither stops the
 *  service. */
export function announceReady(runtimeDir: string, release: string | null, pid: number, fs: BoxFs = boxFs): { readonly ok: true } | { readonly ok: false; readonly why: string } {
  if (release === null) return { ok: false, why: 'this tree has no release stamp' };
  try {
    fs.write(runtimeDir, READY_FILE, encodeReady({ release, pid }));
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

/** The live probe desk (D-8290): the role and the settings from the box's own lines, the fleet config directories the
 *  service user's home names, and the day's count under `<root>/probes`. */
export function probeDeskFor(cfg: TestboxConfig, runner: ProbeRunner | null, home: string = os.homedir()): ProbeDesk {
  const root = path.join(cfg.root, 'probes');
  return new ProbeDesk({
    role: probeRole(cfg.lines), settings: probeSettings(cfg.lines, root, home), runner,
    fleetDirs: () => fleetConfigDirs([home]), realPath: realPathOf, store: fileBudgetStore(path.join(root, 'budget.json')),
    now: () => Date.now(),
  });
}

/** What a test may put in place of the capture's own (the service never passes any): the clock, the sleep and the
 *  launcher's spawner and signal call, so the deadline test runs the composed runner and the real launcher on a virtual
 *  clock; or the whole launcher. */
export interface CaptureSeams {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly tmux?: TmuxLauncherSeams;
  readonly launcher?: CaptureLauncher;
  readonly standIn?: (reply?: (body: unknown) => StandInReply) => Promise<StandIn>;
  /** The delivery recipe's wiring; `null` wires none. Absent: {@link deliveryWiring}. Its settle and quiet bounds are never
   *  a seam's: they come from the timing contract the runner is built from. */
  readonly delivery?: DeliveryWiring | null;
}

/** The delivery recipe's wiring past its bounds: the driver and the tmux config. */
export type DeliveryWiring = Pick<CaptureDeliveryDeps, 'driver' | 'tmuxConf'>;

/** The compiled recorder, beside this file in the release (`agent/dist/agent/src/testbox/captureRecord.js`, where
 *  `testbox-capture-compiled.test.ts` finds it). Named, never imported: the recorder is an entry point of its own, run as a
 *  hook's process (`testbox-imports.test.ts`). */
export const compiledRecorder = (): string => fileURLToPath(new URL('./captureRecord.js', import.meta.url));

/** The delivery recipe's driver in the release tree this file runs from (Desktop polish wave 178): the server's compiled
 *  `server/src/inject/deliveryDrive.ts`, beside the agent's dist (`<tree>/agent/dist/agent/src/testbox/main.js`, five
 *  levels below `<tree>`). Named, never imported: the driver is the server package's entry point of its own. */
export const compiledDeliveryDriver = (): string => fileURLToPath(new URL('../../../../../server/dist/server/src/inject/deliveryDrive.js', import.meta.url));

/** The fleet's tmux config in that release tree (`ccd/tmux.conf`), which the delivery recipe's pane starts with. */
export const shippedTmuxConf = (): string => fileURLToPath(new URL('../../../../../ccd/tmux.conf', import.meta.url));

/** The delivery recipe's wiring: the driver run by this process's node within `t`'s driver bound, and the fleet's tmux
 *  config when the tree holds it. A tree with no compiled driver wires none, so a delivery capture is refused at the frame
 *  (`service.ts#capture`). */
export function deliveryWiring(t: CaptureTimings = CAPTURE_TIMINGS, driver: string = compiledDeliveryDriver(), conf: string = shippedTmuxConf()): DeliveryWiring | undefined {
  if (!existsSync(driver)) return undefined;
  return { driver: nodeDeliveryDriver(process.execPath, driver, t.deliveryDriveMs), tmuxConf: existsSync(conf) ? conf : null };
}

/** The capture runner (spec 2026-11-22 §2.3; gate G1): every bound it keeps from the one timing contract `t`, the launcher's
 *  per-call bound included; the build's tmux server is the box's `tmux`, found on the capture's own `PATH`; the recorder
 *  is the compiled one beside this file, run by this process's node. */
/** The runner's delivery dependencies: the wiring (the seam's, or {@link deliveryWiring} on `t`) with `t`'s settle and quiet
 *  bounds, so every bound of a delivery capture is the one contract's. */
export const deliveryOf = (seams: CaptureSeams, t: CaptureTimings): { delivery?: CaptureDeliveryDeps } => {
  const d = seams.delivery === undefined ? deliveryWiring(t) : seams.delivery;
  return d === undefined || d === null ? {} : { delivery: { ...d, settleMs: t.deliverySettleMs, quietMs: t.deliveryQuietMs } };
};

export function captureRunnerFor(root: string, tmuxBase: string, toolsPath: () => string | null, t: CaptureTimings = CAPTURE_TIMINGS, seams: CaptureSeams = {}): CaptureRunner {
  return new CaptureRunner({
    root, tmuxBase, recorder: [process.execPath, compiledRecorder()], toolsPath,
    launcher: seams.launcher ?? tmuxLauncher('tmux', t.tmuxCallMs, seams.tmux),
    standIn: seams.standIn ?? ((reply) => startStandIn(reply === undefined ? {} : { reply })),
    stepTimeoutMs: t.stepMs, exitTimeoutMs: t.exitMs, pollMs: t.pollMs, stopWaitMs: t.stopWaitMs, standInCloseMs: t.standInCloseMs,
    ...deliveryOf(seams, t),
    ...(seams.now === undefined ? {} : { now: seams.now }), ...(seams.sleep === undefined ? {} : { sleep: seams.sleep }),
  });
}

/** What the desk reads of a build's file (L3): its own kind through `lstat`, never a link's target, its hard-link count and
 *  its real path; `null` when any of it cannot be read (a dangling link among them). */
export function buildFileFacts(file: string): BuildFileFacts | null {
  try {
    const st = lstatSync(file);
    return { regular: st.isFile(), link: st.isSymbolicLink(), links: st.nlink, real: realpathSync(file) };
  } catch {
    return null;
  }
}

/** The builds store's prune (L5's act, `capture.ts#buildsToPrune` decides): each build past the newest kept, never one in
 *  `inUse`, removed in its own try. An absent store is nothing to do. Answers the names it removed. */
export function pruneBuilds(root: string, inUse: readonly string[], remove: (file: string) => void = (f) => rmSync(f, { force: true })): string[] {
  const dir = captureBuildsDir(root);
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const removed: string[] = [];
  for (const name of buildsToPrune(names, inUse)) {
    try { remove(path.join(dir, name)); removed.push(name); } catch (e) { console.warn(`ccrc-testbox: build ${name} not pruned: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return removed;
}

export interface CaptureDeskOpts {
  /** The box's tools directories, read when each capture starts. */
  readonly toolsPath?: () => string | null;
  /** Whether the box admits work (the tool sync's `admitting`, gate G2). */
  readonly admitting?: () => boolean;
  readonly home?: string;
  /** The service's temporary directory (default `os.tmpdir()`, `/tmp` private to the unit). */
  readonly tmuxBase?: string;
  readonly uid?: number;
  readonly seams?: CaptureSeams;
}

/** The build capture desk (spec 2026-11-22), with its runner wired (PR 3b): the role and the fleet directories as the probe
 *  desk has them, one timing contract for the runner, the launcher and the desk's late check, the box's admissions, and the
 *  builds store's prune. A service whose temporary directory is too long for the capture's tmux socket wires no runner, so
 *  every capture is refused `no-runner` (nothing sent is counted). */
export function captureDeskFor(cfg: TestboxConfig, o: CaptureDeskOpts = {}): CaptureDesk {
  const tmuxBase = o.tmuxBase ?? os.tmpdir();
  const uid = o.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0);
  const fits = captureSocketFits(tmuxBase, uid);
  if (!fits) console.warn(`ccrc-testbox: a capture's tmux socket would not fit under ${tmuxBase}; captures are refused no-runner`);
  return captureDeskComposed(cfg, tmuxBase, fits, o);
}

/** The composition itself, past the socket's fit (`wired`): the runner built from `CAPTURE_TIMINGS` and the desk around it
 *  handed that very object (gate G1 runs through this function, review 3687 F2 and review 3765 F2), or no runner. */
export function captureDeskComposed(cfg: TestboxConfig, tmuxBase: string, wired: boolean, o: CaptureDeskOpts = {}): CaptureDesk {
  const timings = CAPTURE_TIMINGS;
  return captureDeskWith(cfg, wired ? captureRunnerFor(cfg.root, tmuxBase, o.toolsPath ?? (() => null), timings, o.seams) : null, timings, tmuxBase, o);
}

/** The desk around `runner`, as `captureDeskComposed` composes it: the late check on `timings`, the very contract the runner
 *  was built from (gate G1), the box's admissions (G2), the builds store's prune. */
export function captureDeskWith(cfg: TestboxConfig, runner: CaptureRunnerLike | null, timings: CaptureTimings, tmuxBase: string, o: CaptureDeskOpts = {}): CaptureDesk {
  const home = o.home ?? os.homedir();
  return new CaptureDesk({
    role: probeRole(cfg.lines), runner,
    root: cfg.root, tmuxBase, fleetDirs: () => fleetConfigDirs([home]), realPath: realPathOf, buildFacts: buildFileFacts, timings,
    ...(o.admitting === undefined ? {} : { admitting: o.admitting }), ...(o.seams?.now === undefined ? {} : { now: o.seams.now }),
    prune: (inUse) => { pruneBuilds(cfg.root, inUse); },
  });
}

/** The stale capture directories at the service's start (L5, once): each entry of `<root>/captures/` that is a capture id
 *  (`capture.ts#staleCaptureDirs`) is removed, each in its own try so one failure stops neither the others nor the start.
 *  An absent captures directory is nothing to do. Answers the names it removed. */
export function sweepStaleCaptures(root: string, remove: (dir: string) => void = (d) => rmSync(d, { recursive: true, force: true })): string[] {
  const base = captureDirsRoot(root);
  let names: string[];
  try { names = readdirSync(base); } catch { return []; }
  const removed: string[] = [];
  for (const name of staleCaptureDirs(names)) {
    try { remove(path.join(base, name)); removed.push(name); } catch (e) { console.warn(`ccrc-testbox: stale capture directory ${name} not removed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return removed;
}

/** The capture store at the service's start (L5, once): the stale capture directories swept, then the builds store pruned
 *  with no build in use (nothing is queued yet). Answers what each removed. */
export function captureStoreAtStart(root: string): { readonly captures: string[]; readonly builds: string[] } {
  return { captures: sweepStaleCaptures(root), builds: pruneBuilds(root, []) };
}

export function serviceFor(cfg: TestboxConfig, release: string, exit: (code: number) => void = (c) => process.exit(c), seams: ServiceSeams = {}): TestboxService {
  const facts = releaseFacts(release);
  const sysEnv = { PATH: SERVICE_PATH, LANG: 'C' };
  const short = boundedExec(sysEnv, SHORT_BOUND_MS);
  const git = realGit(boundedExec(gitEnv(os.homedir()), cfg.unitMaxMs));
  const sys = seams.sys ?? systemctlManager(short, boundedExec(sysEnv, cfg.unitMaxMs));
  // D-8907: the drain's driver. A standing request closes admissions through the same `admitting` the takeover uses.
  const box = seams.box ?? BOX_PATHS;
  const drain = new Drainer({ requestFile: box.drainRequest, runtimeDir: box.runtimeDir, now: seams.box?.now ?? (() => Date.now()), fs: boxFs });
  // TB6 (D-7408, D-7426): the tool sync. Its takeover closes admissions (`admitting`), never the run limit the service
  // reports, so every status answer during it still reads as the frame family's.
  const tools = new ToolSync({
    sys, root: cfg.root, toolsDir: cfg.toolsDir, settings: toolsSettings(cfg.lines, durationMs), now: () => Date.now(), exit,
    closed: () => drain.closed(),
  });
  // TB6 (spec §2.10): each spec's PATH names the set current when it is built, never the link a sync switches.
  const settings = { ...cfg, get toolsBin(): string { return tools.bin(); } };
  const svc = new TestboxService({
    settings, rows: readRepoRows(cfg.repos), sys,
    probe: () => reflinkProbe(reflinkProbeDir(cfg.root), short), mirror: mirrorOps(git),
    // TB6 (spec §2.10): `<tools>/current/chrome` resolved when each prepare starts, so the next prepare picks the new set.
    now: () => Date.now(), get chrome(): string { return tools.chrome(); }, release: facts.release, serviceVersion: facts.serviceVersion,
    // TB6: the box's measured tool versions are the current set's.
    tools: () => tools.versions(), admitting: () => tools.admitting(), specBuilt: (spec) => tools.pin(spec),
    // TB5 (D-7407, D-7543): the installs run under the box's node, the current set's (TB6), else the one this service
    // runs under: before a set is in place, and always on a managed box, whose act restarts the service when node
    // changes and writes `tools.json` only after that start (spec 2026-11-22 §2.5).
    pristine: {
      settings: pristineSettings(cfg.lines, durationMs), inputs: seams.inputs ?? ((m, id, paths, optional) => runTreeFiles(git, m, id, paths, optional)),
      node: () => tools.node() ?? process.versions.node, platform: `${process.platform}-${process.arch}`,
    },
    probes: probeDeskFor(cfg, seams.probeRunner ?? null),
    // Spec 2026-11-22 PR 3b: the capture's tools are the current set's when each capture starts, and it starts only while
    // the box admits work (gate G2).
    captures: captureDeskFor(cfg, { ...seams.capture, toolsPath: () => tools.bin(), admitting: () => tools.admitting() }),
    // D-8907: a submission queued while a drain has the queue on disk goes there at once; a cancel for a run on disk
    // removes it there; and a run on disk keeps its id.
    queued: () => drain.queued(), cancelHandedOver: (id) => tools.cancelHandedOver(id), handedOver: (id) => tools.handedOver(id),
  });
  tools.serve({
    status: () => svc.status(), idle: () => svc.idle(), tick: () => svc.tick(), liveRuns: () => liveRunIds(svc.poolNow()),
    waiting: () => svc.waitingSubmits(), submit: (f, conn) => svc.submit(f, conn), forgetWaiting: () => svc.forgetWaiting(),
  });
  drain.serve({
    // Nothing of the service's is in progress, and the tool sync is not moving the box (its unit, or its takeover).
    quiet: () => svc.quiet() && !tools.busy(), running: () => svc.inProgress(), handOver: () => tools.handOverWaiting(),
    reopen: () => { tools.resume(); svc.admitNow(); },
  });
  attachToolSync(svc, tools);
  attachDrainer(svc, drain);
  return svc;
}

/** The registry proxy (TB5, D-7429): on a loopback address of its own, never the service's tailnet address. */
export async function registryFor(cfg: TestboxConfig): Promise<{ close(): Promise<void> }> {
  const r = registrySettings(cfg.lines, hostPort);
  if (listenClass(r.host) !== 'loopback') throw new Error(`CCRC_TESTBOX_REGISTRY_PROXY: ${r.host} is not a loopback address`);
  return startRegistry({ host: r.host, port: r.port, upstream: r.upstream, cacheDir: registryCacheDir(cfg.root), timeoutMs: cfg.unitMaxMs });
}

/** The timer's work (L5): the service's tick, after any tick in progress, and beside it, not awaited, the tool sync's
 *  retry, whose unit runs for minutes and whose takeover waits for every run (TB6). A handed-over run the start could
 *  not queue is tried again first (D-7560). */
export function timerWork(service: TestboxService): Promise<void> {
  const tools = toolSyncOf(service);
  if (tools === undefined) return service.tick();
  if (tools.pendingHandover() > 0) {
    try { tools.resume(); } catch (e: unknown) { console.error(`ccrc-testbox: handed-over runs: ${e instanceof Error ? e.message : String(e)}`); }
  }
  void tools.tick().catch((e: unknown) => console.error(`ccrc-testbox: tool sync: ${e instanceof Error ? e.message : String(e)}`));
  return tools.serviceTick();
}

async function main(): Promise<void> {
  const release = releaseOf(fileURLToPath(import.meta.url));
  const cfg = await readTestboxConfig(release);
  const refused = listenRefusal(cfg.listen.host);
  if (refused !== null) throw new Error(`CCRC_TESTBOX_LISTEN: ${refused}`);
  const token = readToken(cfg.tokenFile);
  captureStoreAtStart(cfg.root);
  const service = serviceFor(cfg, release);
  // D-8907: a drain request that stands now closes admission before the service queues or starts anything.
  const drain = drainerOf(service);
  drain?.poll();
  await registryFor(cfg);
  await service.start();
  // TB6 (D-7426): the runs a takeover handed over wait in this service's queue, in their order. A standing drain
  // leaves them on disk (D-8907): they are queued when its request is withdrawn or runs out.
  toolSyncOf(service)?.resume();
  const server = await startTestboxServer({ host: cfg.listen.host, port: cfg.listen.port, token, service });
  // Spec 2026-11-22 §2.7: bound, so ready. The file names this tree's release and this process.
  const ready = announceReady(BOX_PATHS.runtimeDir, releaseFacts(release).release, process.pid);
  if (!ready.ok) console.error(`ccrc-testbox: no ready file (${ready.why})`);
  // The drain's own timer, beside the service's below: a request is a file, so it is seen only by looking, and the
  // updater waits on the answer, so it is looked for every `DRAIN_POLL_MS`. The service's timer runs on
  // `CCRC_TESTBOX_FETCH_EVERY`, minutes apart, and each of its ticks waits for the last one's fetches to end.
  const drainTimer = setInterval(() => drain?.poll(), DRAIN_POLL_MS);
  // The service's scheduler (L5 owns both): fetch, sweep and retention on `CCRC_TESTBOX_FETCH_EVERY`.
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void timerWork(service).finally(() => { ticking = false; });
  }, cfg.fetchEveryMs);
  console.log(`ccrc-testbox on ${cfg.listen.host}:${server.port}`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      clearInterval(timer);
      clearInterval(drainTimer);
      // The two files say this process serves: they go before it does.
      boxFs.remove(path.join(BOX_PATHS.runtimeDir, READY_FILE));
      drain?.retire();
      void server.close().finally(() => process.exit(0));
    });
  }
}

const invoked = startedAsProgram(process.argv[1], import.meta.url);
if (invoked) {
  process.on('unhandledRejection', (reason) => { console.error('ccrc-testbox: unhandled rejection (ignored):', reason); });
  main().catch((e: unknown) => {
    console.error(`ccrc-testbox: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
