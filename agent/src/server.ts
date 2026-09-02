import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  AgentReady,
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
import { parseCcdCaps } from '../../shared/agent-protocol.js';
import { parseBuildInfo, type BuildInfo } from '../../shared/buildinfo.js';
import { bodyDigest } from '../../shared/mark.mjs';
import {
  readB64Measured,
  readFromMeasured,
  listDir,
  readWhole,
  statMeasured,
  writeB64,
  type ReadB64Result,
  type ReadFromResult,
  type ReadResult,
  type StatResult,
} from './fileops.js';
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
 * literal (one operator's volume mount path) that could never coincide
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
 *  The old export was one operator's literal Hetzner volume mount path,
 *  compiled in with no override —
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

/** The agent's side of `AgentReady` (shared/agent-protocol.ts), DERIVED from it
 *  rather than restated: every field the wire contract has, this frame has, and
 *  a field added over there arrives here without anyone remembering to copy it.
 *
 *  The one difference is narrowed in the type, not asserted in prose:
 *  `ccdVerbs` is REQUIRED here. The wire declares it optional because a READER
 *  must tolerate an agent old enough to omit it; this agent always has a list
 *  (`[]` when `ccd` could not be read), so its own frame type says so.
 *
 *  Written as a restatement first, and that was the defect: a hand-copied
 *  member list is a claim about another file with nothing enforcing it. This
 *  frame carries three synchronised fields now (`ccdVerbs`, `rosterFp`,
 *  `build`) and the next task adds to `AgentReady` again — a required field
 *  gained over there is now a compile error here until this send site answers
 *  it, instead of a field the agent silently never sends. */
type ReadyFrame = Omit<AgentReady, 'ccdVerbs'> & { ccdVerbs: string[] };

type OutMsg = ResOk | ResErr | TailData | TailReset | PtyData | PtyExit | Pong | ReadyFrame;

function send(ws: WebSocket, msg: OutMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function ok(id: number, fields: Record<string, unknown> = {}): ResOk {
  return { t: 'res', id, ok: true, ...fields };
}

function fail(id: number, message: string): ResErr {
  return { t: 'res', id, ok: false, err: message };
}

/** Builds the `read` op's wire payload from `readWhole`'s result. `data`
 *  keeps its exact pre-existing meaning (null for BOTH absent and
 *  unreadable) so an older server's `typeof data === 'string' ? data : null`
 *  reader is unaffected. `absent` is spread in ONLY when true — never sent
 *  as `absent: false` — matching the wire contract `{data: string|null,
 *  absent?: true}` in `shared/agent-protocol.ts`. */
function readPayload(r: ReadResult): { data: string | null; absent?: true } {
  return { data: r.data, ...(r.absent ? { absent: true as const } : {}) };
}

/** Builds the `stat` op's wire payload from `statMeasured`'s result.
 *  `missing: true` keeps its EXACT pre-existing meaning — "no {mtimeMs,size}
 *  for you", absent and unmeasurable alike — so an older server's
 *  `r.missing === true ? null : …` reader is unaffected. `absent` is spread
 *  in ONLY when the failure was a proven ENOENT, never sent as
 *  `absent: false`, matching `{mtimeMs,size} | {missing: true, absent?: true}`
 *  in `shared/agent-protocol.ts`. A newer server reads a bare `missing: true`
 *  as UNMEASURED — which is what makes an OLDER agent's every stat failure
 *  fail SHUT instead of masquerading as proof the path is gone (D-114). */
function statPayload(r: StatResult): { mtimeMs: number; size: number } | { missing: true; absent?: true } {
  if (r.ok) return { mtimeMs: r.mtimeMs, size: r.size };
  return { missing: true, ...(r.absent ? { absent: true as const } : {}) };
}

/** Builds the `readB64` op's payload. `dataB64` keeps its exact pre-existing
 *  meaning (null for every failure), so an older server's
 *  `typeof data === 'string' ? data : null` reader is unaffected. TWO
 *  positive markers, spread only when true: `absent` (a proven ENOENT) and
 *  `tooLarge` (over the cap, with the measured `size` beside it so the server
 *  can answer 413 with a number instead of a shrug). An older server ignores
 *  both; a newer one reads a bare `dataB64: null` as UNMEASURED. */
function readB64Payload(r: ReadB64Result): { dataB64: string | null; absent?: true; tooLarge?: true; size?: number } {
  if (r.ok) return { dataB64: r.dataB64 };
  if (r.reason === 'too-large') return { dataB64: null, tooLarge: true, size: r.size };
  return { dataB64: null, ...(r.reason === 'absent' ? { absent: true as const } : {}) };
}

/** Builds the `readFrom` op's payload. Shape is unchanged for both existing
 *  arms — `{data, size}` on success, `{data: null}` on failure — with
 *  `absent` spread in only on a proven ENOENT. The EOF case rides the SUCCESS
 *  arm as `{data: '', size}`, exactly as it does today. */
function readFromPayload(r: ReadFromResult): { data: string; size: number } | { data: null; absent?: true } {
  if (r.ok) return { data: r.data, size: r.size };
  return { data: null, ...(r.reason === 'absent' ? { absent: true as const } : {}) };
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

/**
 * §1.4. `error.code ?? 1` used to be the WHOLE answer, which made `{code:1}` from
 * "ccd exited 1" byte-identical to `{code:1}` from "we SIGTERM'd ccd at the
 * deadline" — an overloaded value at a seam, and the reason the dispatch layer
 * could not tell a real refusal from a timeout (§1.5's adoption gate rests on
 * exactly this distinction).
 *
 * `killed` and `signal` are ADDITIVE and absence-permits: an older server ignores
 * both, and a newer server reads their absence as UNMEASURED (`server/src/exec.ts`),
 * which is the safe direction — only a MEASURED cut-short adopts, and ignorance
 * is not a measurement. (This sentence used to say absence reads as
 * `killed: false`. That collapse was §1.7's defect, not its contract: `false`
 * is a claim about a kill nobody looked for.) NO `FLEET_PROTO` bump.
 *
 * WHY STDERR IS EMPTY ON A KILL, correctly stated: not because "a killed child
 * writes nothing" — `execFile` delivers whatever was already buffered — but
 * because NO STDERR-WRITING STATEMENT WAS REACHED. The child was still blocked.
 */
function runExec(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string; killed: boolean; signal: string | null }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: EXEC_MAX_BUFFER, timeout: timeoutMs }, (error, stdout, stderr) => {
      const code = error
        ? (((error as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1)
        : 0;
      resolve({
        code: typeof code === 'number' ? code : 1,
        stdout: String(stdout),
        stderr: String(stderr),
        killed: (error as (NodeJS.ErrnoException & { killed?: boolean }) | null)?.killed === true,
        signal: (error as (NodeJS.ErrnoException & { signal?: string }) | null)?.signal ?? null,
      });
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
      send(ws, ok(req.id, readPayload(await readWhole(p))));
      return;
    }
    case 'readFrom': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      send(ws, ok(req.id, readFromPayload(await readFromMeasured(p, req.offset))));
      return;
    }
    case 'readB64': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      send(ws, ok(req.id, readB64Payload(await readB64Measured(p))));
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
      send(ws, ok(req.id, statPayload(await statMeasured(p))));
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
  return parseCcdCaps(res.stdout);
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

/**
 * This box's own build stamp — `~/.ccrc/build.json` as `deploy/deploy.sh`'s
 * `stamp_build` installed it on the agent lane — or `undefined` when there
 * isn't a usable one to read.
 *
 * The server has no other way to learn what the fleet host is running. Its
 * `/health` reports the SERVER's sha; the fleet host's has been legible only
 * by ssh'ing there and reading this same file by hand. The two lanes are
 * separate deploys and an AGENT-FIRST change ships to one box on purpose, so
 * skew is a normal transient state that nothing could name until now.
 *
 * Read fresh on every `ready`, synchronously, for the reasons spelled out on
 * `readRosterFp` above — one small file read, at most once per WS connection,
 * bought against having no staleness question at all. It matters slightly more
 * here: the deploy RESTARTS this agent, but it is the server's link that
 * reconnects afterwards, so a stamp cached at boot would be answering for a
 * process that outlived the file.
 *
 * `undefined`, not `null` and not a partial object, for every failure — no
 * stamp (dev checkout, never deployed to), unreadable, unparseable, or
 * well-formed JSON of the wrong shape. `undefined` is what the send path below
 * turns into an OMITTED key, which the server reads as "no evidence". The
 * distinction is load-bearing in the wrong-shape case especially: forwarding a
 * half-stamp would put a `sha: undefined` on the wire, which compares unequal
 * to the server's sha and invents a skew alarm out of a file this box could not
 * read. `parseBuildInfo` (`shared/buildinfo.ts`) makes that judgement, and it is
 * the same one the server makes about its own stamp — imported, not restated,
 * so a comparison between the two boxes can never straddle two definitions of
 * a well-formed stamp.
 *
 * NAMED `readBuildStamp`, not `readBuildInfo`, though it is the agent's twin of
 * `server/src/buildinfo.ts`'s `readBuildInfo` and reads the same file on the
 * other box. The two have OPPOSITE empty conventions — `undefined` here because
 * that is what the wire omits, `null` there because that is what `/health`
 * serialises — and a same-name/different-contract pair one import away from the
 * same parser is how a later reader comes to assume the wrong one. Different
 * contract, different name.
 */
function readBuildStamp(home: string): BuildInfo | undefined {
  let raw: string;
  try {
    raw = readFileSync(path.join(home, '.ccrc', 'build.json'), 'utf8');
  } catch {
    return undefined;
  }
  return parseBuildInfo(raw) ?? undefined;
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
  const st = await statMeasured(resolveSpawnCmd('ccd', home));
  if (!st.ok) return cache.verbs;
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
      // `rosterFp` and `build` are OMITTED, not sent as null or as an explicit
      // `undefined`, when this box has no readable projection / no usable
      // stamp — `AgentReady` declares both optional and the server's readers
      // treat absence as "no evidence", the same contract `ccdVerbs` has.
      //
      // Assembled field by field rather than by the ternary this used to be:
      // with two optional fields that ternary becomes four spellings of one
      // frame, and a third field eight. The contract is unchanged — a key is
      // written only when there is something to write.
      const frame: ReadyFrame = { t: 'ready', v: 1, ccdVerbs: verbCache.verbs };
      const rosterFp = readRosterFp(opts.home);
      if (rosterFp !== undefined) frame.rosterFp = rosterFp;
      const build = readBuildStamp(opts.home);
      if (build !== undefined) frame.build = build;
      send(ws, frame);
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
