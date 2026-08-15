import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  AgentReq,
  CapsReq,
  ExecReq,
  PtyData,
  PtyExit,
  PtyOpenReq,
  Pong,
  ReadB64Req,
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
import { bodyDigest } from '../../shared/mark.mjs';
import { readB64, readFrom, listDir, readWhole, statPath, writeB64 } from './fileops.js';
import { isSessionIdAllowed, spawnFleetPty, type PtyProcess, type PtySpawn } from './pty.js';
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
  spawnPty?: PtySpawn;      // default spawnFleetPty (real node-pty) — tests inject a fake spawn
}

export interface RunningAgent {
  port: number;
  close(): Promise<void>;
}

const DEFAULT_HELLO_TIMEOUT_MS = 3000;
const DEFAULT_EXEC_TIMEOUT_MS = 10_000;
const MAX_EXEC_TIMEOUT_MS = 300_000;
const EXEC_MAX_BUFFER = 8 * 1024 * 1024;
const AUTH_CLOSE_CODE = 4401;
/** `root === home`, or `root` is a path-segment-aligned ancestor directory of
 *  `home` (e.g. '/', '/home' when home is '/home/x'). Deliberately NOT the
 *  `target.startsWith(base + path.sep)` check whitelist.ts's own `isUnder`
 *  uses — that check happens to treat a root of '/' as unreachable only
 *  because no real path starts with '//', a technicality this guard must not
 *  depend on staying true. `path.resolve` first so a trailing slash on
 *  either side (e.g. CCRC_PROJECTS_ROOT=/home/x/) can't slip past either
 *  branch. */
function isHomeOrAncestorOfHome(root: string, home: string): boolean {
  const r = path.resolve(root);
  const h = path.resolve(home);
  if (r === h) return true;
  const prefix = r === path.sep ? path.sep : r + path.sep;
  return h.startsWith(prefix);
}

/**
 * Refuses a projects root that would silently widen the READ whitelist onto
 * $HOME's own dotfiles. Before this task `projectsRoot` was a hardcoded
 * literal ('/srv/projects') that could never coincide
 * with $HOME — structurally impossible. This task made it
 * operator-configurable via CCRC_PROJECTS_ROOT, and whitelist.ts's
 * `checkPath` grants reads under whatever root it's given with a plain
 * prefix check: pointing it at $HOME itself, or any ancestor of $HOME (e.g.
 * '/', '/home') — an easy typo — folds ~/.ssh, ~/.ccrc/agent.env (which
 * holds CCRC_AGENT_TOKEN) and every other dotfile into the agent's read
 * whitelist. Same posture as whitelist.ts's `auditExecWhitelist`: refuse to
 * boot rather than serve a silently widened whitelist (verify-service.sh
 * exists to catch exactly this class of boot refusal). Roots UNDER $HOME —
 * including the $HOME/projects default — are unaffected and stay valid.
 */
function assertProjectsRootIsSafe(root: string): void {
  if (!path.isAbsolute(root)) {
    throw new Error(`ccrc-agent: projects root '${root}' is not an absolute path. Refusing to start.`);
  }
  const home = os.homedir();
  if (isHomeOrAncestorOfHome(root, home)) {
    throw new Error(
      `ccrc-agent: projects root '${root}' is $HOME (${home}) or an ancestor of it, which would ` +
      'fold ~/.ssh, ~/.ccrc/agent.env and every other dotfile into the read whitelist. Refusing to start.',
    );
  }
}

/** Resolution order for the whitelist's projects root: explicit option
 *  (tests, embedders) > CCRC_PROJECTS_ROOT (production — set in
 *  ~/.ccrc/agent.env) > $HOME/projects (spec §2's cross-component default).
 *  The old export was one operator's literal Hetzner volume id
 *  ('/srv/projects'), compiled in with no override —
 *  every OTHER machine's agent silently whitelisted a directory that does
 *  not exist. An empty env var counts as absent, never as a root of "".
 *  Throws (refuses to boot) if the resolved root is $HOME, an ancestor of
 *  $HOME, or not absolute — see `assertProjectsRootIsSafe`. */
export function resolveProjectsRoot(
  rawRoot: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = (() => {
    if (rawRoot !== undefined && rawRoot !== '') return rawRoot;
    const fromEnv = env.CCRC_PROJECTS_ROOT;
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
    return path.join(os.homedir(), 'projects');
  })();
  assertProjectsRootIsSafe(root);
  return root;
}

type OutMsg = ResOk | ResErr | TailData | TailReset | PtyData | PtyExit | Pong
  | { t: 'ready'; v: 1; ccdVerbs: string[]; rosterFp?: string };

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

/** Resolve a whitelisted bare command to a spawnable path. `ccd` lives in
 *  `~/.local/bin`, which is NOT on a systemd user unit's default PATH, so it
 *  must be resolved explicitly; `tmux` is a distro binary and PATH suffices. */
export function resolveSpawnCmd(cmd: string, home: string): string {
  return cmd === 'ccd' ? path.join(home, '.local', 'bin', 'ccd') : cmd;
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

interface PtyEntry {
  proc: PtyProcess;
  dataSub: { dispose(): void };
  exitSub: { dispose(): void };
}

interface ConnCtx {
  cfg: WhitelistConfig;
  tails: Map<number, TailHandle>;
  nextTailId: number;
  ptys: Map<number, PtyEntry>;
  nextPtyId: number;
  spawnPty: PtySpawn;
}

async function handleReq(ws: WebSocket, req: AgentReq, ctx: ConnCtx, verbCache: VerbCache): Promise<void> {
  switch (req.op) {
    case 'caps': {
      const verbs = await refreshVerbs(verbCache, ctx.cfg.home);
      send(ws, { t: 'res', id: req.id, ok: true, verbs });
      return;
    }
    case 'exec': {
      if (!isExecAllowed(req.cmd, req.args)) { send(ws, fail(req.id, 'forbidden')); return; }
      const result = await runExec(resolveSpawnCmd(req.cmd, ctx.cfg.home), req.args, clampTimeout(req.timeoutMs));
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
    case 'readB64': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      send(ws, ok(req.id, { dataB64: await readB64(p) }));
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
    case 'ptyOpen': {
      if (!isSessionIdAllowed(req.sessionId)) { send(ws, fail(req.id, 'forbidden')); return; }
      const ptyId = ctx.nextPtyId++;
      const proc = ctx.spawnPty(req.sessionId, req.cols, req.rows);
      const dataSub = proc.onData((data) => {
        send(ws, { t: 'pty', ptyId, ev: 'data', dataB64: Buffer.from(data, 'utf8').toString('base64') });
      });
      const exitSub = proc.onExit(() => {
        send(ws, { t: 'pty', ptyId, ev: 'exit' });
        ctx.ptys.delete(ptyId);
      });
      ctx.ptys.set(ptyId, { proc, dataSub, exitSub });
      send(ws, ok(req.id, { ptyId }));
      return;
    }
    default: {
      // Exhaustive today (every `AgentReq` op above), but kept as a
      // defensive fallback rather than removed — a future protocol variant
      // added to the union without a case here still gets a clean
      // `not-implemented` response instead of an unhandled request that
      // hangs the caller. `req` is `never` per the current union, hence the
      // cast.
      const unhandled = req as { id: number };
      send(ws, fail(unhandled.id, 'not-implemented'));
    }
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
    case 'readB64': {
      if (typeof msg.path !== 'string') return null;
      return { t: 'req', id, op: 'readB64', path: msg.path } satisfies ReadB64Req;
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
    case 'caps':
      return { t: 'req', id, op: 'caps' } satisfies CapsReq;
    default:
      return null;
  }
}

/** Reachable as the `caps` op on any connection, not just once at agent boot —
 *  but always off the `exec` whitelist: it is the agent's own account of what
 *  the DEPLOYED script implements, and the server uses it to render
 *  `unsupported` instead of a control that silently answers `forbidden` on
 *  the fleet. Returns `null` — not `[]` — when the exec itself could not be
 *  trusted (nonzero exit, spawn error), so a caller can tell "ccd says
 *  nothing" from "we don't know what ccd says" and act accordingly. */
async function readCcdVerbs(home: string): Promise<string[] | null> {
  // 10s, same ceiling as every other pre-connection exec on this box. Not
  // independently provable by a fast stub-script test — any value big enough
  // to let a trivial `sh` process finish behaves identically here — so this
  // bound is disclosed rather than pinned: `caps` just lists whitelist keys,
  // it does no I/O, and 10s already matches the rest of the file's defaults.
  const res = await runExec(resolveSpawnCmd('ccd', home), ['caps'], 10_000);
  if (res.code !== 0) return null;
  return res.stdout.split('\n').map((l) => l.trim()).filter((l) => /^[a-z][a-z-]*$/.test(l));
}

/**
 * `bodyDigest` of this box's installed `~/.ccrc/accounts.sh` — the roster
 * projection every `ccd` invocation here actually sources — or `undefined`
 * when there isn't one to read.
 *
 * The server compares this against the digest of the projection ITS roster
 * produces, and a mismatch means the two boxes disagree about which accounts
 * exist. That disagreement is silent today: it surfaces as a session
 * attributed to the wrong account, or a swap target ccd rejects, with nothing
 * anywhere naming the cause.
 *
 * Read fresh on every `ready`, synchronously, rather than cached the way
 * `VerbCache` caches `ccd caps`. The two are not the same problem. `ccd caps`
 * is an EXEC — a bash fork per server tick, tens of thousands a day — so it
 * earns a stat-gated cache. This is one ~2 KB file read, and only on the
 * authenticated `ready` path, so at most once per WS connection to a link
 * that stays up for days. Paying it inline buys the absence of a staleness
 * question entirely, and keeps `ready` synchronous — an async read here would
 * let request frames overtake the handshake.
 *
 * Every failure — missing file, unreadable, a box with no ccrc roster — is
 * `undefined`, which the wire omits and the server reads as "no evidence",
 * never as "divergent". An agent must not turn its own inability to read a
 * file into an alarm on the server's dashboard.
 */
function readRosterFp(home: string): string | undefined {
  try {
    return bodyDigest(readFileSync(path.join(home, '.ccrc', 'accounts.sh'), 'utf8'));
  } catch {
    return undefined;
  }
}

/** The list `readCcdVerbs` last produced, plus the stat of the script that
 *  produced it. Per-`startAgent` state, never module-level: the test suite
 *  boots several agents in one process and they must not share a cache. */
type VerbCache = { verbs: string[]; mtimeMs: number | null; size: number | null };

/** Re-exec `ccd caps` only when the script it would exec has changed. `caps`
 *  is a static heredoc and does no I/O, but a spawn on every server tick would
 *  be tens of thousands of bash processes a day to learn nothing. A replacement
 *  identical in mtime AND size reads as no change — the accepted cost of not
 *  hashing.
 *
 *  Two situations are "no evidence" and must leave `cache` untouched — neither
 *  writes back `mtimeMs`/`size`, and neither overwrites `cache.verbs`:
 *   - `ccd` missing at stat time (a deploy moving it aside mid-install): the
 *     refresh is a no-op, not a clearing event.
 *   - the exec itself failing once the stat DID differ (a timeout under load,
 *     a fork failure, the `+x` bit lost mid-write): a previously-good list
 *     survives instead of being pinned to `[]`.
 *  Because neither writes back the stat, the NEXT caller (the 60 s fleet lane,
 *  not the 2 s pane poll — the exec only happens from that once-a-minute call
 *  path) sees the exact same mismatch it saw this time and retries, so a
 *  transient failure self-heals within a minute instead of being served
 *  forever from a cache entry that (wrongly) claims to already reflect the
 *  current file. */
async function refreshVerbs(cache: VerbCache, home: string): Promise<string[]> {
  const st = await statPath(resolveSpawnCmd('ccd', home));
  if (st === null) return cache.verbs;
  if (st.mtimeMs === cache.mtimeMs && st.size === cache.size) return cache.verbs;
  const verbs = await readCcdVerbs(home);
  if (verbs === null) return cache.verbs;
  cache.verbs = verbs;
  cache.mtimeMs = st.mtimeMs;
  cache.size = st.size;
  return cache.verbs;
}

function handleConnection(ws: WebSocket, opts: Required<Omit<AgentOpts, 'helloTimeoutMs'>>, helloTimeoutMs: number, verbCache: VerbCache): void {
  let authed = false;
  const ctx: ConnCtx = {
    cfg: { home: opts.home, projectsRoot: opts.projectsRoot },
    tails: new Map(),
    nextTailId: 1,
    ptys: new Map(),
    nextPtyId: 1,
    spawnPty: opts.spawnPty,
  };

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
      // `rosterFp` is omitted, not sent as null, when this box has no readable
      // projection — `AgentReady` declares it optional and the server's reader
      // treats absence as "no evidence", the same contract `ccdVerbs` has.
      const rosterFp = readRosterFp(opts.home);
      send(ws, rosterFp === undefined
        ? { t: 'ready', v: 1, ccdVerbs: verbCache.verbs }
        : { t: 'ready', v: 1, ccdVerbs: verbCache.verbs, rosterFp });
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
      handleReq(ws, req, ctx, verbCache).catch((e) => {
        send(ws, fail(req.id, e instanceof Error ? e.message : String(e)));
      });
      return;
    }
    if (msg.t === 'pty') {
      const p = msg as { ptyId?: unknown; ev?: unknown; dataB64?: unknown; cols?: unknown; rows?: unknown };
      if (typeof p.ptyId !== 'number') return;
      const entry = ctx.ptys.get(p.ptyId);
      if (!entry) return;
      if (p.ev === 'input' && typeof p.dataB64 === 'string') {
        entry.proc.write(Buffer.from(p.dataB64, 'base64').toString('utf8'));
      } else if (p.ev === 'resize' && typeof p.cols === 'number' && typeof p.rows === 'number') {
        entry.proc.resize(p.cols, p.rows);
      } else if (p.ev === 'close') {
        entry.dataSub.dispose();
        entry.exitSub.dispose();
        entry.proc.kill();
        ctx.ptys.delete(p.ptyId);
      }
      // any other ev value (or a shape mismatched to the declared ev) is
      // ignored rather than tearing the connection down.
      return;
    }
    // Any other frame shape is ignored rather than tearing the connection down.
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    for (const handle of ctx.tails.values()) handle.close();
    ctx.tails.clear();
    for (const entry of ctx.ptys.values()) {
      entry.dataSub.dispose();
      entry.exitSub.dispose();
      entry.proc.kill();
    }
    ctx.ptys.clear();
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
    projectsRoot: resolveProjectsRoot(rawOpts.projectsRoot),
    spawnPty: rawOpts.spawnPty ?? spawnFleetPty,
  };
  const helloTimeoutMs = rawOpts.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
  const verbCache: VerbCache = {
    // `?? []`: an unreadable ccd at boot is "no evidence" same as any other
    // failed read, and there is no prior list yet to fall back to — [] is the
    // correct answer here, not a special case of it.
    verbs: (await readCcdVerbs(opts.home)) ?? [],
    mtimeMs: null,
    size: null,
  };

  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (ws) => handleConnection(ws, opts, helloTimeoutMs, verbCache));

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
