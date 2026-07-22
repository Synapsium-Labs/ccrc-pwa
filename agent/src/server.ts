import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  AgentReq,
  ExecReq,
  PtyOpenReq,
  Pong,
  ReadFromReq,
  ReadReq,
  ReaddirReq,
  ResErr,
  ResOk,
  StatReq,
  TailCloseReq,
  TailData,
  TailOpenReq,
  TailReset,
  WriteB64Req,
} from '../../shared/agent-protocol.js';
import { readFrom, listDir, readWhole, statPath, writeB64 } from './fileops.js';
import { openTail, type TailHandle } from './tail.js';
import { checkPath, isExecAllowed, type WhitelistConfig } from './whitelist.js';

/**
 * ccrc-agent: a small authenticated WS service exposing a whitelisted
 * exec/file/tail/pty surface on a REMOTE fleet host so ccrc-server never
 * needs SSH in the runtime path. `startAgent` is the single entry point —
 * `index.ts` calls it from real env vars; T3's server-side tests call it
 * in-process against tmp fixture dirs.
 */
export interface AgentOpts {
  host?: string;            // default 127.0.0.1 — NEVER 0.0.0.0/::
  port?: number;            // default 7789
  token: string;            // bearer token every connection must present in `hello`
  home?: string;             // whitelist root for .cc-sessions/.cc-limits/.cc-clips/.claude* — default os.homedir()
  projectsRoot?: string;    // whitelist root for fleet project checkouts
  helloTimeoutMs?: number;  // default 3000 — override for fast tests only
}

export interface RunningAgent {
  port: number;
  close(): Promise<void>;
}

const DEFAULT_HELLO_TIMEOUT_MS = 3000;
const DEFAULT_EXEC_TIMEOUT_MS = 10_000;
const MAX_EXEC_TIMEOUT_MS = 120_000;
const EXEC_MAX_BUFFER = 8 * 1024 * 1024;
const AUTH_CLOSE_CODE = 4401;
export const DEFAULT_PROJECTS_ROOT = '/srv/projects';

type OutMsg = ResOk | ResErr | TailData | TailReset | Pong | { t: 'ready'; v: 1 };

function send(ws: WebSocket, msg: OutMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function ok(id: number, fields: Record<string, unknown> = {}): ResOk {
  return { t: 'res', id, ok: true, ...fields };
}

function fail(id: number, message: string): ResErr {
  return { t: 'res', id, ok: false, err: message };
}

function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return DEFAULT_EXEC_TIMEOUT_MS;
  return Math.min(ms, MAX_EXEC_TIMEOUT_MS);
}

function runExec(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: EXEC_MAX_BUFFER, timeout: timeoutMs }, (error, stdout, stderr) => {
      const code = error
        ? (((error as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1)
        : 0;
      resolve({ code: typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

interface ConnCtx {
  cfg: WhitelistConfig;
  tails: Map<number, TailHandle>;
  nextTailId: number;
}

async function handleReq(ws: WebSocket, req: AgentReq, ctx: ConnCtx): Promise<void> {
  switch (req.op) {
    case 'exec': {
      if (!isExecAllowed(req.cmd, req.args)) { send(ws, fail(req.id, 'forbidden')); return; }
      const result = await runExec(req.cmd, req.args, clampTimeout(req.timeoutMs));
      send(ws, ok(req.id, result));
      return;
    }
    case 'read': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      send(ws, ok(req.id, { data: await readWhole(p) }));
      return;
    }
    case 'readFrom': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      const result = await readFrom(p, req.offset);
      send(ws, ok(req.id, result ?? { data: null }));
      return;
    }
    case 'readdir': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      send(ws, ok(req.id, { names: await listDir(p) }));
      return;
    }
    case 'stat': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      const result = await statPath(p);
      send(ws, ok(req.id, result ?? { missing: true }));
      return;
    }
    case 'writeB64': {
      const p = await checkPath(req.path, ctx.cfg, 'write');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      const result = await writeB64(p, req.dataB64);
      send(ws, result.ok ? ok(req.id) : fail(req.id, result.err));
      return;
    }
    case 'tailOpen': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      const tailId = ctx.nextTailId++;
      const handle = openTail(
        p,
        req.offset,
        (chunk) => send(ws, { t: 'tail', tailId, dataB64: chunk.toString('base64') }),
        (size) => send(ws, { t: 'tail', tailId, reset: true, size }),
      );
      ctx.tails.set(tailId, handle);
      send(ws, ok(req.id, { tailId }));
      return;
    }
    case 'tailClose': {
      ctx.tails.get(req.tailId)?.close();
      ctx.tails.delete(req.tailId);
      send(ws, ok(req.id));
      return;
    }
    default:
      // ptyOpen lands here until T4 wires pty handling into this switch.
      send(ws, fail(req.id, 'not-implemented'));
  }
}

function isHelloShaped(msg: unknown): msg is { t: 'hello'; token: unknown } {
  return typeof msg === 'object' && msg !== null && (msg as { t?: unknown }).t === 'hello';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Runtime shape/type validation for an already-JSON-parsed `req` frame.
 * `msg as AgentReq` (the old dispatch site) is a *compile-time-only*
 * assertion — it does nothing at runtime, so a malformed frame from a buggy
 * or version-skewed client (missing/wrong-typed field) sailed straight into
 * op handlers whose node:fs/node:path calls throw synchronously on the
 * wrong type. Since those handlers run inside an async function with no
 * `.catch` at the call site, that synchronous throw became an unhandled
 * promise rejection — which crashes the whole ccrc-agent process. This is
 * the actual gate: every op's required fields are checked here, by type,
 * before the frame is ever allowed to reach a handler.
 */
function validateReq(msg: Record<string, unknown>): AgentReq | null {
  if (typeof msg.id !== 'number') return null;
  const id = msg.id;
  switch (msg.op) {
    case 'exec': {
      if (typeof msg.cmd !== 'string') return null;
      if (!isStringArray(msg.args)) return null;
      if (msg.timeoutMs !== undefined && typeof msg.timeoutMs !== 'number') return null;
      const req: ExecReq = { t: 'req', id, op: 'exec', cmd: msg.cmd, args: msg.args };
      if (typeof msg.timeoutMs === 'number') req.timeoutMs = msg.timeoutMs;
      return req;
    }
    case 'read': {
      if (typeof msg.path !== 'string') return null;
      return { t: 'req', id, op: 'read', path: msg.path } satisfies ReadReq;
    }
    case 'readFrom': {
      if (typeof msg.path !== 'string') return null;
      if (typeof msg.offset !== 'number') return null;
      return { t: 'req', id, op: 'readFrom', path: msg.path, offset: msg.offset } satisfies ReadFromReq;
    }
    case 'readdir': {
      if (typeof msg.path !== 'string') return null;
      return { t: 'req', id, op: 'readdir', path: msg.path } satisfies ReaddirReq;
    }
    case 'stat': {
      if (typeof msg.path !== 'string') return null;
      return { t: 'req', id, op: 'stat', path: msg.path } satisfies StatReq;
    }
    case 'writeB64': {
      if (typeof msg.path !== 'string') return null;
      if (typeof msg.dataB64 !== 'string') return null;
      return { t: 'req', id, op: 'writeB64', path: msg.path, dataB64: msg.dataB64 } satisfies WriteB64Req;
    }
    case 'tailOpen': {
      if (typeof msg.path !== 'string') return null;
      if (typeof msg.offset !== 'number') return null;
      return { t: 'req', id, op: 'tailOpen', path: msg.path, offset: msg.offset } satisfies TailOpenReq;
    }
    case 'tailClose': {
      if (typeof msg.tailId !== 'number') return null;
      return { t: 'req', id, op: 'tailClose', tailId: msg.tailId } satisfies TailCloseReq;
    }
    case 'ptyOpen': {
      if (typeof msg.sessionId !== 'string') return null;
      if (typeof msg.cols !== 'number') return null;
      if (typeof msg.rows !== 'number') return null;
      return { t: 'req', id, op: 'ptyOpen', sessionId: msg.sessionId, cols: msg.cols, rows: msg.rows } satisfies PtyOpenReq;
    }
    default:
      return null;
  }
}

function handleConnection(ws: WebSocket, opts: Required<Omit<AgentOpts, 'helloTimeoutMs'>>, helloTimeoutMs: number): void {
  let authed = false;
  const ctx: ConnCtx = { cfg: { home: opts.home, projectsRoot: opts.projectsRoot }, tails: new Map(), nextTailId: 1 };

  const helloTimer = setTimeout(() => {
    if (!authed) ws.close(AUTH_CLOSE_CODE, 'hello-timeout');
  }, helloTimeoutMs);

  ws.on('message', (raw) => {
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.close();
      return;
    }

    if (!authed) {
      if (!isHelloShaped(msg) || msg.token !== opts.token) {
        clearTimeout(helloTimer);
        ws.close(AUTH_CLOSE_CODE, 'unauthorized');
        return;
      }
      authed = true;
      clearTimeout(helloTimer);
      send(ws, { t: 'ready', v: 1 });
      return;
    }

    // Valid JSON can still be a bare number/string/null/array — anything
    // that isn't an object frame is silently dropped rather than risking a
    // property access on a non-object.
    if (!isRecord(msg)) return;

    if (msg.t === 'ping') { send(ws, { t: 'pong' }); return; }
    if (msg.t === 'req') {
      const req = validateReq(msg);
      if (!req) {
        // Bad shape/types: reply forbidden-style if we at least have a
        // numeric id to address the response to, otherwise drop the frame
        // and keep serving this connection — never tear it down over a
        // malformed request, and never let it reach a handler unvalidated.
        if (typeof msg.id === 'number') send(ws, fail(msg.id, 'bad-request'));
        return;
      }
      // Defense in depth: even a validated request could hit an unforeseen
      // rejection downstream — this `.catch` guarantees no rejection from
      // the fire-and-forget dispatch is ever left unhandled.
      handleReq(ws, req, ctx).catch((e) => {
        send(ws, fail(req.id, e instanceof Error ? e.message : String(e)));
      });
      return;
    }
    // 'pty' input/resize/close frames arrive here once T4 wires pty handling;
    // any other shape is ignored rather than tearing the connection down.
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    for (const handle of ctx.tails.values()) handle.close();
    ctx.tails.clear();
  });
}

export async function startAgent(rawOpts: AgentOpts): Promise<RunningAgent> {
  const host = rawOpts.host ?? '127.0.0.1';
  if (host === '0.0.0.0' || host === '::') {
    throw new Error('ccrc-agent must not bind 0.0.0.0/:: — set CCRC_AGENT_HOST to a tailnet/loopback address');
  }
  const opts: Required<Omit<AgentOpts, 'helloTimeoutMs'>> = {
    host,
    port: rawOpts.port ?? 7789,
    token: rawOpts.token,
    home: rawOpts.home ?? os.homedir(),
    projectsRoot: rawOpts.projectsRoot ?? DEFAULT_PROJECTS_ROOT,
  };
  const helloTimeoutMs = rawOpts.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;

  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (ws) => handleConnection(ws, opts, helloTimeoutMs));

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.port, opts.host, () => resolve());
  });

  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : opts.port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) client.terminate();
        wss.close((wssErr) => {
          httpServer.close((httpErr) => {
            const e = wssErr ?? httpErr;
            if (e) reject(e); else resolve();
          });
        });
      }),
  };
}
