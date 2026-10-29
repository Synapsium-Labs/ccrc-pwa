// D-7406, D-7428, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.0, §2.9 A). L5: the
// test service's entry point, the agent package's SECOND (compiled to `agent/dist/agent/src/testbox/main.js`, which
// TB7's `ccrc-testbox.service` runs as the service user). It reads its settings once (`config.ts`), binds the tailnet
// address only (it refuses `0.0.0.0`, `::` and loopback, spec §2.0: a run's loopback-only network must not reach it),
// checks each connection's `hello` to the fleet agent's contract (`hello.ts`) against the service's token file, and
// speaks `shared/testbox.ts`'s frames, `TESTBOX_PROTO`, never the fleet agent's `AgentReq` (D-7428). It imports
// nothing of the fleet agent's (`agent/test/testbox-imports.test.ts`).
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { BlockList, isIP } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { isReleaseTag } from '../../../shared/api.js';
import { readTestboxFrame } from '../../../shared/testbox.js';
import { readRepoRows, readTestboxConfig, type TestboxConfig } from './config.js';
import { reflinkProbe } from './fsprobe.js';
import { AUTH_CLOSE_CODE, checkHello, DEFAULT_HELLO_TIMEOUT_MS } from './hello.js';
import { gitEnv, mirrorOps, realGit } from './mirror.js';
import { FRAME_HANDLERS, TestboxService, type Conn } from './service.js';
import { systemctlManager } from './systemd.js';
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
      send(ws, o.service.status());
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

export function serviceFor(cfg: TestboxConfig, release: string): TestboxService {
  const chromeLink = path.join(cfg.toolsDir, 'current', 'chrome');
  const chrome = existsSync(chromeLink) ? realpathSync(chromeLink) : chromeLink;
  const facts = releaseFacts(release);
  const sysEnv = { PATH: SERVICE_PATH, LANG: 'C' };
  const short = boundedExec(sysEnv, SHORT_BOUND_MS);
  return new TestboxService({
    settings: cfg, rows: readRepoRows(cfg.repos), sys: systemctlManager(short, boundedExec(sysEnv, cfg.unitMaxMs)),
    probe: () => reflinkProbe(cfg.root, short), mirror: mirrorOps(realGit(boundedExec(gitEnv(os.homedir()), cfg.unitMaxMs))),
    now: () => Date.now(), chrome, release: facts.release, serviceVersion: facts.serviceVersion,
  });
}

async function main(): Promise<void> {
  const release = releaseOf(fileURLToPath(import.meta.url));
  const cfg = await readTestboxConfig(release);
  const refused = listenRefusal(cfg.listen.host);
  if (refused !== null) throw new Error(`CCRC_TESTBOX_LISTEN: ${refused}`);
  const token = readToken(cfg.tokenFile);
  const service = serviceFor(cfg, release);
  await service.start();
  const server = await startTestboxServer({ host: cfg.listen.host, port: cfg.listen.port, token, service });
  // The one scheduler (L5 owns it): fetch, sweep and retention on `CCRC_TESTBOX_FETCH_EVERY`.
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void service.tick().finally(() => { ticking = false; });
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
