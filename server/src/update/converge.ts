// The dispatcher's ACT (design 2026-09-20 §10) — L3, D-3383. `dispatch.ts` DECIDES
// (pure, L1); this file DOES: it reads the rows through the ConvergeStore port, asks the planner, writes the
// planner's met settles and refusal notes, acquires THE lease, and only then crosses a process boundary — the
// fleet link's `update` op for a link-reached node, the server-role spawn for the server's own row — and maps
// what came back onto the lease with W2's writers. The RESULT of a move is never read off the reply: `accepted`
// holds the lease and asks for a sweep, and only the sweep (or a met request) settles it.
//
// ORDER IS THE MECHANISM. Everything from the role gate to the acquire is one synchronous stretch (`node:sqlite`
// is synchronous and this process is single-threaded), so no other run, route or sweep changes a row between
// the plan and the lease (D-3377; `update-converge.test.ts` scans `runDispatch` for a yield
// above the acquire). The acquire's own WHERE re-checks what SQL can.
import path from 'node:path';
import {
  inFlightReport, type InFlightReport, type NodeRole, type RequestKind, type SettledUpdateState,
} from '../../../shared/api.js';
import {
  NODE_FILES, UPDATE_OP, UPDATE_SPAWN_TIMEOUT_MS, firstStderrLine, updateLauncherPath, updateSpawnArgv, type ResOk,
} from '../../../shared/agent-protocol.js';
import {
  DEADLINE_DETAIL, classifyOpAnswer, deadlineExpired, dispatchRefusalDetail, planDispatch,
  type DispatchMove, type DispatchNodeView, type DispatchPlan, type OpAnswer,
} from './dispatch.js';
import { resolveNodeIntent } from './resolve.js';
import { resolveInputFor } from './project.js';
import { INVENTORY_BUDGET_MS, readNodeFile } from './inventory.js';
import { openPoolReadDeadline } from '../pools.js';
import { AgentOpError } from '../remote/client.js';
import type { ExecResult, Runner } from '../exec.js';
import type { FleetIO } from '../io.js';
import type { FleetState } from '../fleetstate.js';
import type {
  DispatchNodeResult, NodeRow, NoteDispatchRefusalResult, RefusalRow, ReleaseLeaseResult, ReleaseRow,
  SettleNodeResult, UpdateIntentRow,
} from '../coord/store.js';

/** The fleet link's `request()` narrowed to the one op; `index.ts` binds it with UPDATE_OP_TIMEOUT_MS. */
export type SendUpdateOp = (tag: string, kind: RequestKind) => Promise<ResOk>;

/** D-3397: the server-role spawn as a CAPABILITY — it runs the two templates and nothing
 *  else. A raw `Runner` on `Deps` would hand every route a way around `CcdArgv` (task 13S's `runCcd` rule). */
export type LocalUpdateSpawn = (kind: RequestKind, tag: string) => Promise<ExecResult>;

/** The composition-root factory, `ccdRunner`'s idiom (`lifecycle.ts`): binds a Runner and this box's home into
 *  a LocalUpdateSpawn. The argv is built by the ONE builder the agent uses; a non-tag or a kind outside
 *  RequestKind throws RangeError synchronously, before `run` is called. */
export function localUpdateSpawnFor(run: Runner, home: string): LocalUpdateSpawn {
  return (kind, tag) => run(updateLauncherPath(home), [...updateSpawnArgv(kind, tag)]);
}

/** The store port (L2, declared by the consumer); CoordStore satisfies it structurally. `updateEpoch` is here
 *  because `resolveInputFor`'s store parameter requires it. */
export interface ConvergeStore {
  nodes(): NodeRow[]; releases(): ReleaseRow[]; refusalsFor(nodeId: string): RefusalRow[];
  intentFor(scope: string): UpdateIntentRow | null; updateEpoch(): { epoch: number; issuedAt: number };
  dispatchNode(nodeId: string, target: string, kind: RequestKind, startedAt: number, detail: string): DispatchNodeResult;
  releaseLease(nodeId: string, to: SettledUpdateState, detail: string, expectedStartedAt: number | null): ReleaseLeaseResult;
  settleNode(nodeId: string, detail: string, expectedStartedAt: number | null): SettleNodeResult;
  noteDispatchRefusal(nodeId: string, detail: string): NoteDispatchRefusalResult;
}

export interface ConvergeDeps {
  store: ConvergeStore; role: NodeRole; ccrcDir: string; localIo: FleetIO; deadlineMs: number;
  /** null in local mode, or with no link wired. */
  fleet: { state: FleetState; send: SendUpdateOp } | null;
  /** null → a server-row move is noted NO_LOCAL_RUNNER_DETAIL and takes no lease. */
  runLocal: LocalUpdateSpawn | null;
  /** FleetWatcher.triggerInventory: an accepted move is re-measured at once, never believed. */
  onAccepted: () => void;
}

export const NO_FLEET_LINK_DETAIL = 'disconnected — no fleet link is wired on this server; the request stands';
export const LINK_DOWN_DETAIL = 'disconnected — the fleet link is down; the request stands';
export const NO_LOCAL_RUNNER_DETAIL = 'no local runner — this server was started without an update spawner; the request stands';
/** D-3399: an ok reply that does not say `accepted: true` is a word this build cannot name. */
export const OK_WITHOUT_ACCEPTED = 'ok-without-accepted';
export const SPAWN_TIMEOUT_MESSAGE = `the --detach parent did not exit within ${UPDATE_SPAWN_TIMEOUT_MS} ms`;
/** D-3400: the server-side twin of the agent's `an update op is already spawning on this agent`. */
export const LOCAL_SPAWNING_DETAIL = 'an update op is already spawning on this server';

/** The busy sentence — the same words Task 2's agent sends for an in-flight report, so both roles read alike. */
export function inFlightSentence(r: InFlightReport): string {
  return `update.json says ${r.phase} (target ${r.target ?? 'none'}, started ${r.startedAtS ?? 'unknown'})`;
}

/** The ONE builder of the dispatcher's views: every live row, its RESOLVED auto (the resolver's own answer for
 *  this node, never a second reading of the intent rows) and this node's refused tags. The routes (Task 6) call
 *  it too, so a route's synchronous 409 and a dispatch run read the same views. */
export function dispatchViewsFor(
  store: Omit<ConvergeStore, 'dispatchNode' | 'releaseLease' | 'settleNode' | 'noteDispatchRefusal'>,
): DispatchNodeView[] {
  return store.nodes().map((row) => ({
    row,
    auto: resolveNodeIntent(resolveInputFor(store, row)).auto,
    refusedTags: new Set(store.refusalsFor(row.nodeId).map((f) => f.tag)),
  }));
}

export type MoveOutcome =
  | { nodeId: string; result: 'accepted'; detail: string }
  | { nodeId: string; result: 'released'; to: 'idle' | 'failed'; detail: string }
  | { nodeId: string; result: 'release-refused'; to: 'idle' | 'failed'; detail: string; why: Extract<ReleaseLeaseResult, { ok: false }>['why'] }
  | { nodeId: string; result: 'not-sent'; detail: string }
  | { nodeId: string; result: 'acquire-refused'; why: Extract<DispatchNodeResult, { ok: false }>['why'] };

export type DispatchRunResult =
  | { ran: false; why: 'no-coord' | 'not-server-role' }
  | { ran: true; expired: string[]; settled: string[]; noted: number; plan: DispatchPlan; outcome: MoveOutcome | null };

const liveOps = (s: FleetState): readonly string[] => s.agentOps ?? [];

/** Why a planned move cannot be SENT, or null when it can. Decided before the acquire, so a move that could
 *  never leave this process takes no lease and churns no row: no link wired, the link down, the LIVE agent not
 *  advertising the op (the row's agentOps is up to one sweep old — D-3398), no local spawner. */
function unsendableDetail(deps: ConvergeDeps, view: DispatchNodeView, move: DispatchMove): string | null {
  if (!move.viaLink) return deps.runLocal === null ? NO_LOCAL_RUNNER_DETAIL : null;
  if (deps.fleet === null) return NO_FLEET_LINK_DETAIL;
  if (!deps.fleet.state.connected) return LINK_DOWN_DETAIL;
  if (!liveOps(deps.fleet.state).includes(UPDATE_OP)) return dispatchRefusalDetail('agent-predates-update-op', view, move.target);
  return null;
}

function transportWhy(message: string): 'disconnected' | 'timeout' | 'aborted' | 'other' {
  return message === 'disconnected' || message === 'timeout' || message === 'aborted' ? message : 'other';
}

/** The link's answer. An AgentOpError is a word the NODE said; any other rejection is the transport. */
async function linkAnswer(deps: ConvergeDeps, move: DispatchMove): Promise<OpAnswer> {
  if (deps.fleet === null) return { kind: 'transport', why: 'disconnected', message: NO_FLEET_LINK_DETAIL };
  try {
    const res = await deps.fleet.send(move.target, move.kind);
    return res.accepted === true ? { kind: 'accepted' } : { kind: 'refused', err: OK_WITHOUT_ACCEPTED, detail: null };
  } catch (e) {
    if (e instanceof AgentOpError) return { kind: 'refused', err: e.code, detail: e.detail };
    const message = e instanceof Error ? e.message : String(e);
    return { kind: 'transport', why: transportWhy(message), message };
  }
}

const TIMED_OUT = Symbol('timed-out');

/** The spawn raced against UPDATE_SPAWN_TIMEOUT_MS — the agent's own bound, strictly below the link's
 *  UPDATE_OP_TIMEOUT_MS (D-3374). A late exit after the bound resolves into nothing. */
function withinSpawnDeadline<T>(p: Promise<T>): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), UPDATE_SPAWN_TIMEOUT_MS);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

/** `~/.ccrc/update.json` on THIS box, through the one shared parser and W2's BOUNDED node-file reader — the
 *  same `readNodeFile` the inventory sweep reads this file with: lstat to a regular file only, size ≤
 *  NODE_FILE_CAP_BYTES, every step raced against one deadline. It runs AFTER the lease is taken, so an unbounded
 *  read here (a FIFO blocks `open(2)` for good) would leave the row `pending` and the single-flight dispatch run
 *  unsettled, and no later trigger would reach the deadline sweep. Absent, unreadable, non-regular, too large or
 *  not in flight all read "not busy" — the node's own `_upd_lock_probe` (in `_upd_detach`) then decides, the agent's rule
 *  (D-3371; Task 2's `readInFlightReport` is the agent's `O_NONBLOCK` twin). */
async function localInFlight(deps: ConvergeDeps): Promise<InFlightReport | null> {
  const deadline = openPoolReadDeadline(INVENTORY_BUDGET_MS);
  try {
    const read = await readNodeFile(deps.localIo, path.join(deps.ccrcDir, NODE_FILES.report), deadline);
    return read.ok ? inFlightReport(read.content) : null;
  } finally {
    deadline?.close();
  }
}

/** D-3400: the server-role spawns whose `--detach` parent has not exited yet, by capability
 *  (one `LocalUpdateSpawn` per process in production — `index.ts` builds it once — and one per harness in a
 *  test). `realRunner` passes `execFile` no deadline, so the race below stops WAITING at UPDATE_SPAWN_TIMEOUT_MS
 *  but kills nothing; an entry leaves this set only when the child's own promise settles. While it is here, the
 *  next run answers `busy` instead of starting a second parent — both parents would only PROBE the lock (wave 4),
 *  and a rollback parent asks the release host before it writes `queued`. The agent's process-wide `UpdateGate`
 *  (D-3392) is the same rule on the other role. */
const spawning = new WeakSet<LocalUpdateSpawn>();

/** The server-role answer: the busy read (D-3384), the spawn gate, then the `--detach`
 *  parent's exit. */
async function localAnswer(deps: ConvergeDeps, move: DispatchMove): Promise<OpAnswer> {
  const spawn = deps.runLocal;
  if (spawn === null) return { kind: 'transport', why: 'other', message: NO_LOCAL_RUNNER_DETAIL };
  const busy = await localInFlight(deps);
  if (busy !== null) return { kind: 'refused', err: 'busy', detail: inFlightSentence(busy) };
  // Checked and taken with no await between: two runs can never both pass.
  if (spawning.has(spawn)) return { kind: 'refused', err: 'busy', detail: LOCAL_SPAWNING_DETAIL };
  let child: Promise<ExecResult>;
  try {
    child = spawn(move.kind, move.target);   // a non-tag or non-kind throws RangeError here, before anything runs
  } catch (e) {
    return { kind: 'transport', why: 'other', message: e instanceof Error ? e.message : String(e) };
  }
  spawning.add(spawn);
  const clear = (): void => { spawning.delete(spawn); };
  child.then(clear, clear);
  try {
    const res = await withinSpawnDeadline(child);
    if (res === TIMED_OUT) return { kind: 'transport', why: 'timeout', message: SPAWN_TIMEOUT_MESSAGE };
    if (res.code === 0) return { kind: 'accepted' };
    // A missing launcher (`realRunner`'s spawn-error branch) answers `code: 1, stderr: ''` — the child never ran,
    // so there is no line to name and `firstStderrLine` would render the generic 'no message', indistinguishable
    // from a launcher that ran, failed and simply printed nothing. Name the one condition this path can actually
    // tell apart: an empty stderr on a non-zero exit means the launcher itself never spoke (review finding 3).
    const stderrLine = firstStderrLine(res.stderr);
    const detail = stderrLine === 'no message' ? `exit ${res.code} with no stderr from the launcher` : stderrLine;
    return { kind: 'refused', err: 'spawn-failed', detail };
  } catch (e) {
    return { kind: 'transport', why: 'other', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * One dispatch run (design 2026-09-20 §10). In order, in one synchronous stretch: the role gate; the deadline
 * sweep; the plan over rows read after it; the met settles; the refusal notes; a move that cannot be sent,
 * noted; THE lease. Then, and only then, the op or the spawn — and the answer decides only what happens to
 * the lease: hold (and ask for a sweep), or release it idle/failed in this same run.
 */
export async function runDispatch(deps: ConvergeDeps, now: number): Promise<DispatchRunResult> {
  if (deps.role !== 'server' && deps.role !== 'both') return { ran: false, why: 'not-server-role' };
  const { store } = deps;
  // (1) The deadline: a busy lease its node has not written to for deadlineMs fails, and failed halts.
  const expired: string[] = [];
  for (const row of store.nodes()) {
    if (!deadlineExpired(row, now, deps.deadlineMs)) continue;
    if (store.releaseLease(row.nodeId, 'failed', DEADLINE_DETAIL, null).ok) expired.push(row.nodeId);
  }
  // (2) The plan, over rows read after those writes.
  const views = dispatchViewsFor(store);
  const plan = planDispatch({ nodes: views, releases: store.releases() });
  // (3) A request the node already runs is convergence, measured (D-3380).
  const settled: string[] = [];
  for (const m of plan.met) {
    if (store.settleNode(m.nodeId, `met: ${m.tag}`, null).ok) settled.push(m.nodeId);
  }
  // (4) Every refusal is noted: idle rows only, changed words only (D-3375).
  let noted = 0;
  const note = (nodeId: string, detail: string): void => {
    const w = store.noteDispatchRefusal(nodeId, detail);
    if (w.ok && w.changed) noted += 1;
  };
  for (const r of plan.refusals) note(r.nodeId, r.detail);
  const done = (outcome: MoveOutcome | null): DispatchRunResult => ({ ran: true, expired, settled, noted, plan, outcome });
  const move = plan.move;
  if (move === null) return done(null);
  const view = views.find((v) => v.row.nodeId === move.nodeId);
  if (view === undefined) return done({ nodeId: move.nodeId, result: 'acquire-refused', why: 'unknown-node' });
  // (5) A move that cannot be sent takes no lease: it is noted, and the request stands.
  const unsendable = unsendableDetail(deps, view, move);
  if (unsendable !== null) {
    note(move.nodeId, unsendable);
    return done({ nodeId: move.nodeId, result: 'not-sent', detail: unsendable });
  }
  // (6) THE lease. Everything above ran in this one turn.
  const got = store.dispatchNode(move.nodeId, move.target, move.kind, now, move.detail);
  if (!got.ok) return done({ nodeId: move.nodeId, result: 'acquire-refused', why: got.why });
  // (7) Only now does the act leave this process; the reply decides only what happens to the lease.
  const answer = move.viaLink ? await linkAnswer(deps, move) : await localAnswer(deps, move);
  const advertised = move.viaLink ? deps.fleet !== null && liveOps(deps.fleet.state).includes(UPDATE_OP) : true;
  const action = classifyOpAnswer(answer, advertised);
  if (action.kind === 'hold') {
    deps.onAccepted();
    return done({ nodeId: move.nodeId, result: 'accepted', detail: action.detail });
  }
  const released = store.releaseLease(move.nodeId, action.to, action.detail, null);
  if (!released.ok) {
    return done({ nodeId: move.nodeId, result: 'release-refused', to: action.to, detail: action.detail, why: released.why });
  }
  return done({ nodeId: move.nodeId, result: 'released', to: action.to, detail: action.detail });
}
