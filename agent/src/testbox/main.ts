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
import { readFileSync, statSync } from 'node:fs';
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
import { CaptureDesk } from './captureDesk.js';
import { durationMs, hostPort, readRepoRows, readTestboxConfig, type TestboxConfig } from './config.js';
import { reflinkProbe, reflinkProbeDir } from './fsprobe.js';
import { attachDrainer, Drainer, drainerOf } from './drainer.js';
import { AUTH_CLOSE_CODE, checkHello, DEFAULT_HELLO_TIMEOUT_MS } from './hello.js';
import { gitEnv, mirrorOps, realGit, runTreeFiles } from './mirror.js';
import { pristineSettings } from './pristine.js';
import { ProbeDesk, type ProbeRunner } from './probeDesk.js';
import { fileBudgetStore, fleetConfigDirs, realPathOf } from './probeFs.js';
import { probeRole, probeSettings } from './probes.js';
import { registrySettings, startRegistry } from './registry.js';
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

/** The build capture desk (spec 2026-11-22): the role and the fleet directories as the probe desk has them. The runner is
 *  wired in PR 3 of the spec, so until then every capture is refused `no-runner`. */
export function captureDeskFor(cfg: TestboxConfig, home: string = os.homedir()): CaptureDesk {
  return new CaptureDesk({
    role: probeRole(cfg.lines), runner: null, root: cfg.root, fleetDirs: () => fleetConfigDirs([home]), realPath: realPathOf,
    buildPresent: (file) => { try { return statSync(file).isFile(); } catch { return false; } },
  });
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
      settings: pristineSettings(cfg.lines, durationMs), inputs: seams.inputs ?? ((m, id, paths) => runTreeFiles(git, m, id, paths)),
      node: () => tools.node() ?? process.versions.node, platform: `${process.platform}-${process.arch}`,
    },
    probes: probeDeskFor(cfg, seams.probeRunner ?? null), captures: captureDeskFor(cfg),
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
  return startRegistry({ host: r.host, port: r.port, upstream: r.upstream, cacheDir: path.join(cfg.root, 'registry'), timeoutMs: cfg.unitMaxMs });
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
