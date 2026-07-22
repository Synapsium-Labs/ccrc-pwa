import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentReq, Pong, ResErr, ResOk, TailData, TailReset } from '../../shared/agent-protocol.js';
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
      await writeB64(p, req.dataB64);
      send(ws, ok(req.id));
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

    const shaped = msg as { t?: unknown };
    if (shaped.t === 'ping') { send(ws, { t: 'pong' }); return; }
    if (shaped.t === 'req') { void handleReq(ws, msg as AgentReq, ctx); return; }
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
