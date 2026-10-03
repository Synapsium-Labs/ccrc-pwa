import { execFile, spawn } from 'node:child_process';
import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
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
  LstatReq,
  StatReq,
  TailCloseReq,
  TailData,
  TailOpenReq,
  TailReset,
  UpdateOpError,
  UpdateReq,
  WriteB64Req,
} from '../../shared/agent-protocol.js';
import {
  CCRC_DIR_NAME, NODE_FILE_BASENAMES, NODE_FILES, parseCcdCaps, parseObservedEpochDoc, POOL_EPOCH_FILE_NAME, UPDATE_OP,
  UPDATE_SPAWN_DRAIN_MS, UPDATE_SPAWN_TIMEOUT_MS, decideKilledSpawn, firstStderrLine, inFlightBusyDetail, isUpdateLockHeldLine,
  lockHeldBusyDetail, updateLauncherPath, updateSpawnArgv, updateWriterMayLive,
  type KillProbeOutcome, type UpdateReportRead, type UpdateSpawnResult,
} from '../../shared/agent-protocol.js';
import { inFlightReport, isReleaseTag, isRequestKind, type InFlightReport } from '../../shared/api.js';
import { parseBuildInfo, type BuildInfo } from '../../shared/buildinfo.js';
import { bodyDigest } from '../../shared/mark.mjs';
import {
  readB64Measured,
  readFromMeasured,
  listDir,
  lstatMeasured,
  readWhole,
  statMeasured,
  writeB64,
  type ReadB64Result,
  type ReadFromResult,
  type ReadResult,
  type PathKindResult,
  type StatResult,
} from './fileops.js';
import { isSessionIdAllowed, spawnFleetPty, type PtyProcess, type PtySpawn } from './pty.js';
import { openTail, type TailHandle } from './tail.js';
import { canonicalize, checkPath, isExecAllowed, type WhitelistConfig } from './whitelist.js';

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
  spawnUpdate?: UpdateSpawn; // default realUpdateSpawn (a process-group spawn) — tests inject a recorder; the `update` op's ONLY spawn
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
 *  frame carries four synchronised fields now (`ccdVerbs`, `rosterFp`,
 *  `build`, `observedEpoch`) and the next task adds to `AgentReady` again — a
 *  required field gained over there is now a compile error here until this
 *  send site answers it, instead of a field the agent silently never sends.
 *
 *  `observedEpoch` is narrowed the same way `ccdVerbs` is, and for the same
 *  reason: `readObservedEpoch` never throws uncaught and always answers a
 *  `number | null` — THIS agent always has evidence (a real epoch, or `null`
 *  for "never synced"). The wire declares it optional only so a READER can
 *  tolerate an OLDER agent that predates the field entirely; this build is
 *  never that agent, so its own frame type says so and the send site cannot
 *  compile while silently omitting it.
 *
 *  `ops` is narrowed the same way, for the same reason (design 2026-09-20 §10):
 *  the wire declares it optional so a READER tolerates an agent from before the
 *  `update` op, and this build is never that agent. It answers the op, so its
 *  own frame type says so, and the send site cannot compile while silently
 *  omitting the one word the server's dispatcher looks for before it sends it. */
type ReadyFrame = Omit<AgentReady, 'ccdVerbs' | 'observedEpoch' | 'ops'> & {
  ccdVerbs: string[];
  observedEpoch: number | null;
  ops: string[];
};

type OutMsg = ResOk | ResErr | TailData | TailReset | PtyData | PtyExit | Pong | ReadyFrame;

function send(ws: WebSocket, msg: OutMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function ok(id: number, fields: Record<string, unknown> = {}): ResOk {
  return { t: 'res', id, ok: true, ...fields };
}

/** `detail` is ADDITIVE (design 2026-09-20 §10, D-3373): spread
 *  only when there is one, so every existing refusal's frame is byte-identical
 *  to what it was. */
function fail(id: number, message: string, detail?: string): ResErr {
  return detail === undefined
    ? { t: 'res', id, ok: false, err: message }
    : { t: 'res', id, ok: false, err: message, detail };
}

/** The `update` op's refusals. `err` is typed to the op's closed vocabulary
 *  (`UPDATE_OP_ERRORS`), so a word the server's answer mapping does not know is
 *  a compile error here, not a string that drifts. */
function failUpdate(id: number, err: UpdateOpError, detail?: string): ResErr {
  return fail(id, err, detail);
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

/** Builds the `lstat` op's payload. `kind` is a POSITIVE answer in all three
 *  arms, and its absence is therefore never an answer: an agent too old to
 *  implement this op rejects the request outright with `not-implemented`, which
 *  is what lets the server tell UNMEASURED from `regular` instead of reading an
 *  older peer's silence as proof the path is a plain file. That direction is the
 *  load-bearing one — `regular` is the only kind any caller may condemn on. */
function lstatPayload(r: PathKindResult): { kind: 'regular' | 'symlink' | 'other' } | { missing: true; absent?: true } {
  if (r.ok) return { kind: r.kind };
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

/** The BODY half of the installed `ccd` pair — the Bash the launcher at
 *  `resolveSpawnCmd('ccd', home)` hashes and hands control to. Derived here,
 *  once, and used for ONE thing: a local `stat` that tells `refreshVerbs` whether
 *  `ccd caps` could now answer differently. It is NOT a wire read and NOT a
 *  read-whitelist grant — no request can name it, and nothing opens it, execs
 *  it or reads its bytes; the entry is still the only thing the agent ever
 *  spawns. */
function ccdBodyPath(home: string): string {
  return path.join(home, '.local', 'libexec', 'ccrc', 'ccd');
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

/**
 * The `update` op's spawn port (design 2026-09-20 §10). It is the ONE place a
 * wire-triggered request reaches a process spawn outside the exec whitelist,
 * and it is deliberately NOT `runExec`: `runExec` is the exec op's executor,
 * and a call to it here would put this op on the exec path in the reader's
 * mind, which is exactly what §18 "the op never execs" forbids. Production is
 * `realUpdateSpawn`; tests inject a recorder through `AgentOpts.spawnUpdate`.
 */
export type UpdateSpawn = (file: string, args: readonly string[], timeoutMs: number) => Promise<UpdateSpawnResult>;

/** Enough for any sentence a `--detach` parent prints; past it the capture stops and stdout reads as incomplete. */
const UPDATE_SPAWN_MAX_BUFFER = 1024 * 1024;

/**
 * The `--detach` parent under a bound — the ABSOLUTE launcher and one of the two templates, both built by the
 * caller from `shared/agent-protocol.ts`. `env` is the parent's whole environment, passed on purpose: the factory
 * takes it so a test can hand the child a fixture HOME and PATH, and production hands it `process.env`.
 *
 * The parent is its own PROCESS GROUP (`detached`, pgid = pid), and the bound kills the WHOLE group with SIGKILL:
 * a bound that killed only the parent would leave whatever it had already forked running, and the caller would
 * read that as a stopped run. Answers, kept apart:
 *  - `killed` — the parent was still running at the bound; the group was sent SIGKILL.
 *  - A spawn error — the launcher absent or not executable (`ENOENT`/`EACCES`). It answers code 1 with the
 *    sentence `could not start the launcher (<code>)` (D-3393) and `pid: null`: without that sentence the
 *    parent's stderr is empty, and a node with no `ccrc` installed would read `spawn-failed: no message`.
 *  - Every other exit — the parent's own code, its stderr, its stdout.
 *
 * The answer comes once the parent has EXITED and then either both pipes reached EOF or
 * `UPDATE_SPAWN_DRAIN_MS` passed. A grandchild that left the group (setsid) and still holds a pipe therefore never
 * stops the answer; it costs `stdout: null` (EOF not reached). The drain is ONE deadline, armed by the kill or by the
 * parent's exit, whichever comes first, so the whole answer is within `timeoutMs + UPDATE_SPAWN_DRAIN_MS` of the spawn.
 * A parent that a signal ended answers `128 + signo`. A pipe that errors marks the capture incomplete (`stdout: null`).
 * Nothing resolves twice.
 */
export function makeUpdateSpawn(env: NodeJS.ProcessEnv): UpdateSpawn {
  return (file, args, timeoutMs) => new Promise((resolve) => {
    // ── BEGIN bounded-spawn body — identical in `agent/src/server.ts` and `server/src/update/spawn.ts`; a test holds the two equal
    let settled = false;
    let exited: { code: number } | null = null;
    let killed = false;
    let killTimer: NodeJS.Timeout | null = null;
    let drainTimer: NodeJS.Timeout | null = null;
    const out = { chunks: [] as Buffer[], bytes: 0, capped: false, broken: false, eof: false };
    const err = { chunks: [] as Buffer[], bytes: 0, capped: false, broken: false, eof: false };
    const child = spawn(file, [...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    const finish = (r: UpdateSpawnResult): void => {
      if (settled) return;
      settled = true;
      if (killTimer !== null) clearTimeout(killTimer);
      if (drainTimer !== null) clearTimeout(drainTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(r);
    };
    const answer = (): void => {
      if (exited === null) return;
      finish({
        code: exited.code,
        stdout: out.eof && !out.capped && !out.broken ? Buffer.concat(out.chunks).toString('utf8') : null,
        stderr: Buffer.concat(err.chunks).toString('utf8'),
        killed,
        pid: child.pid ?? null,
      });
    };
    // ONE absolute drain deadline (I1): the first arm stands. The kill arms it at T; a parent that then exits at
    // T + D - e must not restart it, or the answer would come at T + 2D and the op's budget be TIMEOUT + 2 * DRAIN.
    const armDrain = (): void => {
      if (drainTimer !== null) return;
      drainTimer = setTimeout(() => { exited ??= { code: 1 }; answer(); }, UPDATE_SPAWN_DRAIN_MS);
    };
    const take = (buf: typeof out) => (chunk: Buffer): void => {
      if (buf.capped) return;
      if (buf.bytes + chunk.length > UPDATE_SPAWN_MAX_BUFFER) { buf.capped = true; return; }
      buf.chunks.push(chunk);
      buf.bytes += chunk.length;
    };
    // A pipe that errors (EPIPE, ECONNRESET) never reaches `end`, and an uncaught stream error kills the process:
    // the capture is marked incomplete (stdout reads null) and counts as finished, so the answer is not held for it.
    const broke = (buf: typeof out, other: typeof out) => (): void => {
      buf.broken = true;
      buf.eof = true;
      if (other.eof) answer();
    };
    child.stdout?.on('data', take(out));
    child.stderr?.on('data', take(err));
    child.stdout?.on('end', () => { out.eof = true; if (err.eof) answer(); });
    child.stderr?.on('end', () => { err.eof = true; if (out.eof) answer(); });
    child.stdout?.on('error', broke(out, err));
    child.stderr?.on('error', broke(err, out));
    // `on`, not `once` (M2): `child.kill()` in the kill's fallback can emit `error` a second time, and an `error`
    // event with no listener throws.
    child.on('error', (e: NodeJS.ErrnoException) => {
      // A spawn that never produced a pid (ENOENT, EACCES): the launcher never ran.
      if (child.pid !== undefined) return;
      finish({
        code: 1, stdout: '', killed: false, pid: null,
        stderr: `could not start the launcher (${typeof e.code === 'string' ? e.code : 'unknown'})`,
      });
    });
    child.once('exit', (code, signal) => {
      if (killTimer !== null) { clearTimeout(killTimer); killTimer = null; }
      // A parent that a signal ended (not ours: `killed` says ours) answers the shell's `128 + signo`, so the detail
      // says what happened; a code of its own is kept as it is (M4).
      const signo = signal === null ? undefined : os.constants.signals[signal];
      exited = { code: typeof code === 'number' ? code : signo !== undefined ? 128 + signo : 1 };
      if (out.eof && err.eof) { answer(); return; }
      armDrain();
    });
    killTimer = setTimeout(() => {
      killTimer = null;
      if (exited !== null || child.pid === undefined) return;
      killed = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {
        // ESRCH: the group is already gone. Anything else: fall back to the parent alone rather than to nothing.
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL');
      }
      // A parent that will not die (an uninterruptible wait) must not stop the answer past the drain bound.
      armDrain();
    }, timeoutMs);
    // ── END bounded-spawn body
  });
}

/** The agent's production spawner: the parent inherits this process's own environment. */
export const realUpdateSpawn: UpdateSpawn = makeUpdateSpawn(process.env);

/** ONE per agent PROCESS, shared by every connection (D-3392).
 *  A server whose link dropped while an op was spawning reconnects on a NEW
 *  socket and re-sends the op, and a per-connection flag would let that second
 *  `--detach` parent start beside the first. Both parents only PROBE the lock
 *  (wave 4 Task 3), so both would pass it and write `queued`. */
interface UpdateGate { spawning: boolean }

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
  spawnUpdate: UpdateSpawn;
  updateGate: UpdateGate;
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
    case 'lstat': {
      // THE WHITELIST DECISION IS UNCHANGED and still made on the FULLY
      // RESOLVED path: a link escaping the whitelist is refused here exactly as
      // it is for every other op.
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      // BUT NOT `p` ITSELF AS THE SUBJECT. `checkPath` canonicalizes, and
      // canonicalization destroys precisely the fact this op exists to report
      // — `lstat(p)` follows nothing because there is nothing left to follow,
      // so a symlinked marker could only ever come back `regular`. That is a
      // fix that looks like one and is not, and it was caught by an end-to-end
      // case, not by reading: the local adapter answered `symlink` and this
      // wire answered `regular` on the same fixture.
      //
      // So the subject is the path whose PARENT is canonical and whose last
      // component is literal. The parent is whitelist-checked in its own right
      // and exactly one component is appended, so this can only ever name an
      // entry of a directory the connection may already `readdir` — which
      // lists this very name. Strictly less disclosure than `readdir`, and
      // `lstat` reads no content and follows no final link.
      //
      // `parent === null` is the whitelist ROOT itself (`.cc-sessions`, whose
      // parent is $HOME and is not whitelisted): fall back to the canonical
      // path, which for a directory is the same answer.
      //
      // ONE exception to that fallback (F12/D-3195, fix round 1 dispatch C).
      // `~/.ccrc` is not itself independently whitelisted in the common case
      // (only its eight literal node-file paths are), so `parent === null`
      // usually fires for a node-file request, and the fallback subject would
      // then be `p` — `checkPath`'s CANONICAL, already symlink-resolved,
      // answer. That is correct when the node file is admitted through
      // `isCcrcNodeFile` (that grant requires canonical === `<ccrc>/<literal
      // basename>`, so canonical already equals the literal path). But a node
      // file can ALSO be admitted through a DIFFERENT whitelist arm: a live
      // symlink whose FULLY RESOLVED target lies in another admitted prefix
      // (`.cc-sessions`, `.cc-clips`, a `.claude*` dir, the projects root) —
      // that target is a regular file the OTHER prefix's own arm admits on
      // its own — and then `p` names that other file, not the link. Scoped
      // narrowly so every other request's answer stays byte-for-byte
      // unchanged, whether or not `~/.ccrc` itself happens to be
      // independently admitted (e.g. `~/.ccrc` itself under another prefix):
      // only when the request literally names `<canonical
      // ~/.ccrc>/<one of the eight basenames>` does the subject become that
      // literal path directly, never the parent-probe fallback. The basename
      // check runs FIRST — a cheap array lookup — so the two `canonicalize`
      // calls (realpath walks) below run only when it can possibly matter,
      // never on every `lstat`.
      const literalBasename = path.basename(req.path);
      const viaParentProbe = async (): Promise<string> => {
        const parent = await checkPath(path.dirname(req.path), ctx.cfg, 'read');
        return parent === null ? p : path.join(parent, path.basename(req.path));
      };
      let subject: string;
      if (NODE_FILE_BASENAMES.includes(literalBasename)) {
        const canonicalCcrc = await canonicalize(path.join(ctx.cfg.home, CCRC_DIR_NAME));
        const literalParent = await canonicalize(path.dirname(req.path));
        subject = literalParent === canonicalCcrc
          ? path.join(canonicalCcrc, literalBasename)
          : await viaParentProbe();
      } else {
        subject = await viaParentProbe();
      }
      send(ws, ok(req.id, lstatPayload(await lstatMeasured(subject))));
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
    case 'update': {
      // Design 2026-09-20 §10. THE ONE wire-triggered spawn outside the exec
      // whitelist (agent/CLAUDE.md). `validateReq` has already refused a tag
      // that fails `isReleaseTag` and a kind outside `RequestKind`, so this body
      // never sees an unvalidated argument. `updateSpawnArgv` checks both AGAIN
      // and throws on a caller bug, so an edit that lets one through reaches
      // the envelope's `.catch`, never `execFile`. Nothing here consults the
      // exec whitelist, and nothing here may: `ccrc` is on neither list, and
      // the argv is one of two templates with `tag` the only variable token.
      //
      // No `await` before the busy decision. The gate is checked and taken in
      // one synchronous stretch, so two ops arriving together cannot both pass.
      if (ctx.updateGate.spawning) {
        send(ws, failUpdate(req.id, 'busy', 'an update op is already spawning on this agent'));
        return;
      }
      const home = ctx.cfg.home;
      // ONE read feeds both the in-flight check and the bound's snapshot (D-3400 amended, D-3413): the report's text, proven
      // absent, or unreadable. Absent and unreadable stay two values, because arm A needs a readable before.
      const before = readUpdateReport(home);
      const inFlight = before.kind === 'bytes' ? inFlightReport(before.text) : null;
      // D-3411: an in-flight report answers busy only while its WRITER lives. A dead writer's report is a
      // leftover (an updater killed mid-run), and the op spawns: the parent's own lock probe then decides.
      // An absent or unreadable pid keeps busy — that writer is unmeasurable, which is not dead. The
      // sentence is `inFlightBusyDetail`'s, the one both roles send, and it stays within the op's detail bound
      // (D-3391) with its advice intact.
      if (inFlight !== null && writerMayLive(inFlight.pid)) {
        send(ws, failUpdate(req.id, 'busy', inFlightBusyDetail(inFlight)));
        return;
      }
      const file = updateLauncherPath(home);
      const argv = updateSpawnArgv(req.kind ?? 'update', req.tag);
      ctx.updateGate.spawning = true;
      let spawned: Awaited<ReturnType<UpdateSpawn>>;
      try {
        spawned = await ctx.spawnUpdate(file, argv, UPDATE_SPAWN_TIMEOUT_MS);
      } finally {
        ctx.updateGate.spawning = false;
      }
      // D-3372: `accepted` is a measured fact about the
      // node. The `--detach` parent exits 0 only after `_upd_phase queued` (which WARNs, never fails) and
      // `_svc_run_detached` started the unit (wave 4 Task 3). It is never "a
      // process was forked". Everything else is `spawn-failed`, carrying what
      // the parent said.
      if (spawned.killed) {
        // D-3400 (amended), D-3413: the bound killed the parent's whole group, and what it did is MEASURED, never guessed:
        // re-read update.json and let L0's `decideKilledSpawn` attribute the change (A. nothing queued, B. it queued our tag
        // as this pid, D. anything else). Only A releases (`not-queued`: idle, the request standing); B and D answer the ok
        // `accepted` reply carrying their words, so the server HOLDS the lease. The old `spawn-failed` here was a halting
        // answer for a parent that may well have started the run.
        const verdict = decideKilledSpawn({
          before, after: readUpdateReport(home), stdout: spawned.stdout, pid: spawned.pid, tag: req.tag,
        });
        send(ws, verdict.arm === 'A'
          ? failUpdate(req.id, 'not-queued', verdict.detail)
          : ok(req.id, { accepted: true, detail: verdict.detail }));
        return;
      }
      if (spawned.code !== 0) {
        const line = firstStderrLine(spawned.stderr);
        // D-3411: the parent's lock probe found the lock HELD and died before its `queued` write, so nothing on
        // the box changed. That is a busy node, not a faulted one: `busy` releases `idle` with the request
        // standing. `_upd_flock_die` and the probe's unmeasured arm carry other sentences and stay spawn-failed.
        // The busy detail carries the way out (`lockHeldBusyDetail`): a holder that hangs writes no report.
        send(ws, isUpdateLockHeldLine(line)
          ? failUpdate(req.id, 'busy', lockHeldBusyDetail(line))
          : failUpdate(req.id, 'spawn-failed', line));
        return;
      }
      send(ws, ok(req.id, { accepted: true }));
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

/** `validateReq`'s answer for a well-shaped op whose ARGUMENT failed its guard
 *  (design 2026-09-20 §10). The message handler sends it as
 *  `failUpdate(id, refuse)` before any case body runs. It is not `null`,
 *  because the handler answers `null` with `bad-request`, which from the
 *  `update` op must mean exactly one thing: this agent predates it. */
export interface ReqRefusal { refuse: Extract<UpdateOpError, 'bad-tag' | 'bad-kind'>; id: number }

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
function validateReq(msg: Record<string, unknown>): AgentReq | ReqRefusal | null {
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
    case 'lstat': {
      if (typeof msg.path !== 'string') return null;
      return { t: 'req', id, op: 'lstat', path: msg.path } satisfies LstatReq;
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
    case 'update': {
      // The ONE tag-shape guard (`isReleaseTag`, never a regex here) and the
      // one kind guard. A failed argument is a `ReqRefusal` carrying the op's
      // own word; nothing past this point sees an unvalidated tag.
      if (!isReleaseTag(msg.tag)) return { refuse: 'bad-tag', id };
      const kind = msg.kind === undefined ? 'update' : msg.kind;
      if (!isRequestKind(kind)) return { refuse: 'bad-kind', id };
      return { t: 'req', id, op: 'update', tag: msg.tag, kind } satisfies UpdateReq;
    }
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

/** Re-exported so `pool-epoch-numeric-parity.test.ts`'s existing import
 *  keeps resolving unchanged. The grammar itself, and the document parser
 *  below, moved to `shared/agent-protocol.ts` (D-3086,
 *  item 1, wave-1 fix round A): the SERVER now has its own reader of this
 *  same file (`server/src/pools.ts`'s `readObservedEpochFromRegistry`, via
 *  `FleetIO.readFileMeasured` rather than this file's `readFileSync`), and
 *  the brief that ordered it forbids a second hand-typed copy of one
 *  grammar — see `parseObservedEpochDoc`'s own docstring for the full
 *  three-check explanation this file used to carry locally. */
export { OBSERVED_EPOCH_NUM } from '../../shared/agent-protocol.js';

/**
 * The epoch of the pool-membership projection THIS node actually has —
 * `~/.cc-sessions/pool-epoch`, the leased projection `ccd-pool-sync` (Task 3)
 * writes and `_acct_pool_state` (`ccd/ccd`) reads for placement decisions.
 *
 * `null` means this node has never synced — no file, an unreadable one, or a
 * document `parseObservedEpochDoc` cannot prove a usable epoch out of. That
 * is NOT the same as epoch 0 (the control plane has issued nothing yet, but
 * this node has a real, if trivial, projection) and NOT the same as the
 * field being absent from the `ready` frame (an older agent build that
 * cannot even ASK the question) — `AgentReady.observedEpoch` and
 * `FleetState.observedEpoch` both keep those three apart; `undefined` is
 * what an ABSENT reader sees, never what this function returns.
 *
 * The read-and-fold-to-`null` is this function's own remaining job; the
 * CONTENT grammar (terminator, exactly-one `epoch` line, that line's own
 * numeric precision) is `parseObservedEpochDoc`'s (`shared/agent-protocol.ts`)
 * — shared with the server's own reader of the identical file so the two
 * cannot drift on what counts as a usable epoch.
 *
 * Read fresh on every `ready`, synchronously, for the same reason
 * `readRosterFp`/`readBuildStamp` are: one small file read, at most once per
 * WS connection, bought against a staleness question that would otherwise
 * need its own cache-invalidation story. (This per-handshake cadence is
 * exactly why the SERVER no longer treats the value this produces as its
 * `pools` wire's `observedEpoch` authority — see the doc on
 * `AgentReady.observedEpoch` in `shared/agent-protocol.ts`.)
 */
export function readObservedEpoch(home: string): number | null {
  try {
    const text = readFileSync(path.join(home, '.cc-sessions', POOL_EPOCH_FILE_NAME), 'utf8');
    return parseObservedEpochDoc(text);
  } catch {
    return null;
  }
}

/** Wave 4's writer puts ONE line of a few hundred bytes. Anything larger is not its report. */
const UPDATE_REPORT_READ_MAX = 65_536;

/** The agent's `process.kill(pid, 0)` adapter for `updateWriterAlive` (D-3411; the liveness RULE is L0's). */
function probeKill(pid: number): KillProbeOutcome {
  try {
    process.kill(pid, 0);
    return { threw: false };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { threw: true, code: typeof code === 'string' ? code : null };
  }
}
/** Whether an in-flight report's writer may still be running: L0's `updateWriterMayLive` over this role's adapter.
 *  Exported for the pins; the `update` op is its one caller. */
export function writerMayLive(pid: number | null): boolean {
  return updateWriterMayLive(pid, probeKill);
}

/**
 * Spec §10: the handler refuses when `~/.ccrc/update.json` says an update is in
 * flight. The agent reads the file ITSELF, as `readObservedEpoch` and
 * `readBuildStamp` read theirs (D-3371). This
 * is the agent's own decision about its own box, not a wire file op, so it
 * never goes through `checkPath`: that gate exists for what the SERVER reads.
 *
 * `null` (not busy) covers every failure: an absent, unreadable, over-cap or
 * unparseable file, a non-regular one, and a report that is not in flight.
 * The `--detach` parent's own lock probe (`_upd_detach`'s `_upd_lock_probe`) then decides, and a held lock comes back as
 * `busy` with the lock's sentence (D-3411; it was `spawn-failed` before). A report that IS in flight is returned
 * with its writer's `pid`; whether that writer lives is `writerMayLive`'s question, asked by the `update` case, not this
 * read's. Opened `O_NONBLOCK`, because a FIFO
 * planted at this name would otherwise block `open(2)` and, with it, this
 * agent's whole event loop; `fstat` then refuses it as not a regular file. The
 * CONTENT is judged by `inFlightReport` (`shared/api.ts`), the same parser the
 * server-role spawn uses, so the two roles cannot disagree about what "in
 * flight" means.
 */
export function readInFlightReport(home: string): InFlightReport | null {
  const read = readUpdateReport(home);
  return read.kind === 'bytes' ? inFlightReport(read.text) : null;
}

/**
 * `~/.ccrc/update.json` on THIS box, bounded and measured (D-3400 amended, D-3413): its text, `absent` on a PROVEN ENOENT
 * at the open, or `unreadable` for every other failure (a non-regular file, over the cap, any other errno). The `update` op
 * reads it once before the spawn — that read is both the in-flight check's input and the bound's snapshot — and once
 * after a kill, and the two are compared byte for byte. Same bounds as ever: `O_NONBLOCK` (a FIFO planted at the name
 * would block `open(2)` and the agent's whole event loop), `fstat` to a regular file of at most `UPDATE_REPORT_READ_MAX`.
 */
export function readUpdateReport(home: string): UpdateReportRead {
  let fd: number;
  try {
    fd = openSync(path.join(home, CCRC_DIR_NAME, NODE_FILES.report), fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable' };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > UPDATE_REPORT_READ_MAX) return { kind: 'unreadable' };
    const buf = Buffer.alloc(st.size);
    const n = readSync(fd, buf, 0, st.size, 0);
    return { kind: 'bytes', text: buf.subarray(0, n).toString('utf8') };
  } catch {
    return { kind: 'unreadable' };
  } finally {
    try { closeSync(fd); } catch { /* nothing left to release */ }
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

/** One file's `(mtimeMs, size)` — what a half of the cache key is made of. */
type FileStamp = { mtimeMs: number; size: number };

/** The list `readCcdVerbs` last produced, plus the stats of BOTH halves of the
 *  installed `ccd` that produced it: the entry the agent execs and the body that
 *  entry hands control to. `caps` is printed by the body, so a body-only change
 *  (a new verb) leaves the entry's bytes and stat as they were — a key made of the
 *  entry alone would answer the old list for as long as the agent ran. `null`
 *  means "never measured", and the two halves are only ever written TOGETHER
 *  (`refreshVerbs`), so one is `null` exactly when the other is. Per-`startAgent`
 *  state, never module-level: the test suite boots several agents in one process
 *  and they must not share a cache. */
type VerbCache = { verbs: string[]; entry: FileStamp | null; body: FileStamp | null };

/** Re-exec `ccd caps` only when the `ccd` it would exec has changed — in EITHER
 *  half. `caps` is a static heredoc and does no I/O, but a spawn on every server
 *  tick would be tens of thousands of bash processes a day to learn nothing. A
 *  replacement identical in mtime AND size reads as no change — the accepted cost
 *  of not hashing — and a hit needs all four numbers (entry and body, mtime and
 *  size) to equal the cached key.
 *
 *  Three situations are "no evidence" and must leave `cache` untouched — none
 *  writes back either half of the key, and none overwrites `cache.verbs`:
 *   - EITHER half missing or unmeasurable at stat time (a deploy moving the entry
 *     or the body aside mid-install, an unreadable directory): the refresh is a
 *     no-op, not a clearing event, and it is a no-op for the WHOLE key — the half
 *     that did stat is not adopted while the other cannot be measured, or a
 *     pair that returns identical to the old one would read as a hit on a
 *     half-updated key. This includes a box whose installed entry is still the
 *     self-contained pre-launcher one: it has no body to stat, so its list is the
 *     one read at boot until the install moves it onto the pair.
 *   - the exec itself failing once a stat DID differ (a timeout under load, a
 *     fork failure, the `+x` bit lost mid-write, a launcher refusing a body it
 *     cannot verify): a previously-good list survives instead of being pinned
 *     to `[]`.
 *  Because none writes back the key, the NEXT caller (the 60 s fleet lane, not
 *  the 2 s pane poll — the exec only happens from that once-a-minute call path)
 *  sees the exact same mismatch it saw this time and retries, so a transient
 *  failure self-heals within a minute instead of being served forever from a
 *  cache entry that (wrongly) claims to already reflect the current files. The
 *  key is written only after a SUCCESSFUL `caps` read, and both stats are taken
 *  BEFORE that read, so a file replaced while `caps` runs reads as a change on
 *  the next call rather than being absorbed into the key. */
async function refreshVerbs(cache: VerbCache, home: string): Promise<string[]> {
  const [entry, body] = await Promise.all([
    statMeasured(resolveSpawnCmd('ccd', home)),
    statMeasured(ccdBodyPath(home)),
  ]);
  if (!entry.ok || !body.ok) return cache.verbs;
  if (
    cache.entry !== null && entry.mtimeMs === cache.entry.mtimeMs && entry.size === cache.entry.size &&
    cache.body !== null && body.mtimeMs === cache.body.mtimeMs && body.size === cache.body.size
  ) return cache.verbs;
  const verbs = await readCcdVerbs(home);
  if (verbs === null) return cache.verbs;
  cache.verbs = verbs;
  cache.entry = { mtimeMs: entry.mtimeMs, size: entry.size };
  cache.body = { mtimeMs: body.mtimeMs, size: body.size };
  return cache.verbs;
}

function handleConnection(
  ws: WebSocket, opts: Required<Omit<AgentOpts, 'helloTimeoutMs'>>, helloTimeoutMs: number, verbCache: VerbCache,
  updateGate: UpdateGate,
): void {
  let authed = false;
  const ctx: ConnCtx = {
    cfg: { home: opts.home, projectsRoot: opts.projectsRoot },
    tails: new Map(),
    nextTailId: 1,
    ptys: new Map(),
    nextPtyId: 1,
    spawnPty: opts.spawnPty,
    spawnUpdate: opts.spawnUpdate,
    updateGate,
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
      // `observedEpoch` is DIFFERENT and is never omitted by this build: it is
      // in the initial literal, not assembled after like the two above,
      // because `ReadyFrame` narrows it to required (same move as `ccdVerbs`)
      // — `readObservedEpoch` always has an answer, a real epoch or `null` for
      // "never synced", and only an agent build old enough to lack this
      // field's code at all may omit it. This build is never that agent.
      //
      // `rosterFp`/`build` are still assembled field by field rather than by
      // the ternary this used to be: with two optional fields that ternary
      // becomes four spellings of one frame, and a third field eight. The
      // contract is unchanged — a key is written only when there is
      // something to write.
      // `ops` (design 2026-09-20 §10): the request ops this agent answers beyond
      // the closed set every agent has always had, which is exactly one today.
      // It is required in `ReadyFrame`, so it cannot be dropped silently.
      const frame: ReadyFrame = {
        t: 'ready', v: 1, ccdVerbs: verbCache.verbs, observedEpoch: readObservedEpoch(opts.home), ops: [UPDATE_OP],
      };
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
      // A well-shaped op whose ARGUMENT failed its guard (design 2026-09-20
      // §10) is answered with the op's own word, never `bad-request`.
      if ('refuse' in req) { send(ws, failUpdate(req.id, req.refuse)); return; }
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
    spawnUpdate: rawOpts.spawnUpdate ?? realUpdateSpawn,
  };
  const helloTimeoutMs = rawOpts.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS;
  const verbCache: VerbCache = {
    // `?? []`: an unreadable ccd at boot is "no evidence" same as any other
    // failed read, and there is no prior list yet to fall back to — [] is the
    // correct answer here, not a special case of it.
    verbs: (await readCcdVerbs(opts.home)) ?? [],
    // Both halves of the key stay unset: boot's read is not tied to any stat,
    // so the first live `caps` request measures the pair and establishes it.
    entry: null,
    body: null,
  };

  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  // ONE update gate per agent process, shared by every connection (D-3392).
  const updateGate: UpdateGate = { spawning: false };
  wss.on('connection', (ws) => handleConnection(ws, opts, helloTimeoutMs, verbCache, updateGate));

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
