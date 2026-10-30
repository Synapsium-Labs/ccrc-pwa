// D-7406, D-7428, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.0, §2.9 A). L5: the
// test service's entry point, the agent package's SECOND (compiled to `agent/dist/agent/src/testbox/main.js`, which
// TB7's `ccrc-testbox.service` runs as the service user). It reads its settings once (`config.ts`), binds the tailnet
// address only (it refuses `0.0.0.0`, `::` and loopback, spec §2.0: a run's loopback-only network must not reach it),
// checks each connection's `hello` to the fleet agent's contract (`hello.ts`) against the service's token file, and
// speaks `shared/testbox.ts`'s frames, `TESTBOX_PROTO`, never the fleet agent's `AgentReq` (D-7428). It imports
// nothing of the fleet agent's (`agent/test/testbox-imports.test.ts`).
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { BlockList, isIP } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { isReleaseTag } from '../../../shared/api.js';
import { readTestboxFrame } from '../../../shared/testbox.js';
import { durationMs, hostPort, readRepoRows, readTestboxConfig, type TestboxConfig } from './config.js';
import { reflinkProbe } from './fsprobe.js';
import { AUTH_CLOSE_CODE, checkHello, DEFAULT_HELLO_TIMEOUT_MS } from './hello.js';
import { gitEnv, mirrorOps, realGit, runTreeFiles } from './mirror.js';
import { pristineSettings } from './pristine.js';
import { registrySettings, startRegistry } from './registry.js';
import { liveRunIds } from './runs.js';
import { FRAME_HANDLERS, TestboxService, type Conn } from './service.js';
import { systemctlManager } from './systemd.js';
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
    // TB6 (D-7426): the driver keeps each submission while it may wait, so a takeover can hand it to the next service.
    if (r.value.t === 'run.submit') toolSyncOf(o.service)?.noteSubmit(r.value);
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

export function serviceFor(cfg: TestboxConfig, release: string, exit: (code: number) => void = (c) => process.exit(c)): TestboxService {
  const facts = releaseFacts(release);
  const sysEnv = { PATH: SERVICE_PATH, LANG: 'C' };
  const short = boundedExec(sysEnv, SHORT_BOUND_MS);
  const git = realGit(boundedExec(gitEnv(os.homedir()), cfg.unitMaxMs));
  const sys = systemctlManager(short, boundedExec(sysEnv, cfg.unitMaxMs));
  // TB6 (D-7408, D-7426): the tool sync. Its takeover closes admissions through the run limit it hands the service.
  const tools = new ToolSync({ sys, root: cfg.root, toolsDir: cfg.toolsDir, settings: toolsSettings(cfg.lines, durationMs), now: () => Date.now(), exit });
  // TB6 (spec §2.10): each spec's PATH names the set current when it is built, never the link a sync switches.
  const settings = { ...cfg, get runs(): number { return tools.runLimit(cfg.runs); }, get toolsBin(): string { return tools.bin(); } };
  const svc = new TestboxService({
    settings, rows: readRepoRows(cfg.repos), sys,
    probe: () => reflinkProbe(cfg.root, short), mirror: mirrorOps(git),
    // TB6 (spec §2.10): `<tools>/current/chrome` resolved when each prepare starts, so the next prepare picks the new set.
    now: () => Date.now(), get chrome(): string { return tools.chrome(); }, release: facts.release, serviceVersion: facts.serviceVersion,
    // TB6: the box's measured tool versions are the current set's.
    tools: () => tools.versions(),
    // TB5 (D-7407, D-7543): the installs run under the box's node, the current set's (TB6), else the one this service runs under.
    pristine: {
      settings: pristineSettings(cfg.lines, durationMs), inputs: (m, id, paths) => runTreeFiles(git, m, id, paths),
      node: () => tools.node() ?? process.versions.node, platform: `${process.platform}-${process.arch}`,
    },
  });
  tools.serve({
    status: () => svc.status(), idle: () => svc.idle(), tick: () => svc.tick(), liveRuns: () => liveRunIds(svc.poolNow()),
    waiting: () => svc.positions().keys(), submit: (f, conn) => svc.submit(f, conn),
  });
  attachToolSync(svc, tools);
  return svc;
}

/** The registry proxy (TB5, D-7429): on a loopback address of its own, never the service's tailnet address. */
export async function registryFor(cfg: TestboxConfig): Promise<{ close(): Promise<void> }> {
  const r = registrySettings(cfg.lines, hostPort);
  if (listenClass(r.host) !== 'loopback') throw new Error(`CCRC_TESTBOX_REGISTRY_PROXY: ${r.host} is not a loopback address`);
  return startRegistry({ host: r.host, port: r.port, upstream: r.upstream, cacheDir: path.join(cfg.root, 'registry'), timeoutMs: cfg.unitMaxMs });
}

/** The timer's work (L5): the service's tick, after any tick in progress, and beside it, not awaited, the tool sync's
 *  retry, whose unit runs for minutes and whose takeover waits for every run (TB6). */
export function timerWork(service: TestboxService): Promise<void> {
  const tools = toolSyncOf(service);
  if (tools === undefined) return service.tick();
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
  await registryFor(cfg);
  await service.start();
  // TB6 (D-7426): the runs a takeover handed over wait in this service's queue, in their order.
  toolSyncOf(service)?.resume();
  const server = await startTestboxServer({ host: cfg.listen.host, port: cfg.listen.port, token, service });
  // The one scheduler (L5 owns it): fetch, sweep and retention on `CCRC_TESTBOX_FETCH_EVERY`.
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void timerWork(service).finally(() => { ticking = false; });
  }, cfg.fetchEveryMs);
  console.log(`ccrc-testbox on ${cfg.listen.host}:${server.port}`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => { clearInterval(timer); void server.close().finally(() => process.exit(0)); });
  }
}

const invoked = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  process.on('unhandledRejection', (reason) => { console.error('ccrc-testbox: unhandled rejection (ignored):', reason); });
  main().catch((e: unknown) => {
    console.error(`ccrc-testbox: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
