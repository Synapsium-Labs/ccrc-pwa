// The dispatcher's ACT (design 2026-09-20 §10) — L3, D-3383. `dispatch.ts` DECIDES
// (pure, L1); this file DOES: it reads the rows through the ConvergeStore port, asks the planner, writes the
// planner's met settles and refusal notes, acquires THE lease, and only then crosses a process boundary — the
// fleet link's `update` op for a link-reached node, the server-role spawn for the server's own row — and maps
// what came back onto the lease with W2's writers. The RESULT of a move is never read off the reply: `accepted`
// holds the lease and asks for a sweep, and only the sweep (or a met request) settles it.
//
// ORDER IS THE MECHANISM. Everything from the deadline sweep's own row read to the acquire is one synchronous stretch
// (`node:sqlite` is synchronous and this process is single-threaded), so no other run, route or sweep changes a row
// between the plan and the lease (D-3377; `update-converge.test.ts` scans `runDispatch` for a yield inside that
// stretch). The one await above it — the server's own report, read for the deadline's words — is taken BEFORE the
// stretch's first row read and handed in (fix round 1 item 4). The acquire's own WHERE re-checks what SQL can.
import path from 'node:path';
import {
  inFlightReport, type NodeRole, type RequestKind, type SettledUpdateState,
} from '../../../shared/api.js';
import {
  NODE_FILES, UPDATE_OP, decideKilledSpawn, firstStderrLine, inFlightBusyDetail, isUpdateLockHeldLine,
  lockHeldBusyDetail, updateLauncherPath, updateSpawnArgv, updateWriterMayLive,
  type KillProbeOutcome, type ResOk, type UpdateReportRead, type UpdateSpawnResult,
} from '../../../shared/agent-protocol.js';
import {
  classifyOpAnswer, deadlineDetail, deadlineExpired, dispatchRefusalDetail, leaseHolder, linkFailedDeadlineDetail, parseReportOrigin,
  planDispatch,
  type DispatchMove, type DispatchNodeView, type DispatchPlan, type OpAnswer, type ReportOrigin,
} from './dispatch.js';
import { resolveNodeIntent } from './resolve.js';
import { resolveInputFor } from './project.js';
import { INVENTORY_BUDGET_MS, readNodeFile } from './inventory.js';
import { openPoolReadDeadline } from '../pools.js';
import { AgentOpError, LinkNotSentError } from '../remote/client.js';
import { boundedUpdateSpawn, type BoundedSpawnOpts } from './spawn.js';
import type { FleetIO } from '../io.js';
import type { FleetState } from '../fleetstate.js';
import type {
  DispatchNodeResult, NodeRow, NoteDispatchRefusalResult, NoteLeaseDetailResult, RefusalRow, ReleaseLeaseResult, ReleaseRow,
  SettleNodeResult, UpdateIntentRow,
} from '../coord/store.js';

/** The fleet link's `request()` narrowed to the one op; `index.ts` binds it with UPDATE_OP_TIMEOUT_MS. */
export type SendUpdateOp = (tag: string, kind: RequestKind) => Promise<ResOk>;

/** D-3397: the server-role spawn as a CAPABILITY — it runs the two templates and nothing
 *  else. A raw `Runner` on `Deps` would hand every route a way around `CcdArgv` (task 13S's `runCcd` rule). */
export type LocalUpdateSpawn = (kind: RequestKind, tag: string) => Promise<UpdateSpawnResult>;

/** The composition-root factory, `ccdRunner`'s idiom (`lifecycle.ts`): binds this box's home into a
 *  LocalUpdateSpawn over the BOUNDED update runner (`spawn.ts`), never the shared `Runner` that tmux and ccd use.
 *  The argv is built by the ONE builder the agent uses; a non-tag or a kind outside RequestKind throws RangeError
 *  synchronously, before anything runs. `env` and `timeoutMs` are for a test (a fixture HOME, a small bound). */
export function localUpdateSpawnFor(home: string, opts: BoundedSpawnOpts = {}): LocalUpdateSpawn {
  return (kind, tag) => boundedUpdateSpawn(updateLauncherPath(home), updateSpawnArgv(kind, tag), opts);
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
  noteLeaseDetail(nodeId: string, detail: string, startedAt: number): NoteLeaseDetailResult;
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
/** D-3400: the server-side twin of the agent's `an update op is already spawning on this agent`. */
export const LOCAL_SPAWNING_DETAIL = 'an update op is already spawning on this server';

/** The server's `process.kill(pid, 0)` adapter for `updateWriterAlive` (D-3411; the liveness RULE is L0's, and the
 *  agent supplies its own adapter for the same rule). */
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
 *  The agent's `writerMayLive` is the same composition on the other role. */
function writerMayLive(pid: number | null): boolean {
  return updateWriterMayLive(pid, probeKill);
}

/** The ONE builder of the dispatcher's views: every live row, its RESOLVED auto (the resolver's own answer for
 *  this node, never a second reading of the intent rows) and this node's refused tags. The routes (Task 6) call
 *  it too, so a route's synchronous 409 and a dispatch run read the same views. */
export function dispatchViewsFor(
  store: Omit<ConvergeStore, 'dispatchNode' | 'releaseLease' | 'settleNode' | 'noteDispatchRefusal' | 'noteLeaseDetail'>,
): DispatchNodeView[] {
  return store.nodes().map((row) => ({
    row,
    auto: resolveNodeIntent(resolveInputFor(store, row)).auto,
    refusedTags: new Set(store.refusalsFor(row.nodeId).map((f) => f.tag)),
  }));
}

export type MoveOutcome =
  | { nodeId: string; result: 'accepted'; detail: string }
  | { nodeId: string; result: 'held'; detail: string }
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
  if (deps.fleet === null) return { kind: 'transport', why: 'disconnected', message: NO_FLEET_LINK_DETAIL, reached: 'never' };
  try {
    const res = await deps.fleet.send(move.target, move.kind);
    if (res.accepted !== true) return { kind: 'refused', err: OK_WITHOUT_ACCEPTED, detail: null };
    // D-3413: arms B and D of the agent's bound ride the ok reply with the words the row will read; an agent that omits
    // `detail` (every other accepted) keeps the default.
    return typeof res.detail === 'string' ? { kind: 'accepted', detail: res.detail } : { kind: 'accepted' };
  } catch (e) {
    if (e instanceof AgentOpError) return { kind: 'refused', err: e.code, detail: e.detail };
    const message = e instanceof Error ? e.message : String(e);
    // D-3555: only the client's positive marker proves the frame never left; anything else — a
    // timeout, a close or abort after the send, a rejection this build cannot name — MAY have reached the agent.
    return { kind: 'transport', why: transportWhy(message), message, reached: e instanceof LinkNotSentError ? 'never' : 'maybe' };
  }
}

/** `~/.ccrc/update.json` on THIS box, through W2's BOUNDED node-file reader — the same `readNodeFile` the inventory
 *  sweep reads this file with: lstat to a regular file only, size ≤ NODE_FILE_CAP_BYTES, every step raced against one
 *  deadline. It runs AFTER the lease is taken, so an unbounded read here (a FIFO blocks `open(2)` for good) would leave
 *  the row `pending` and the single-flight dispatch run unsettled, and no later trigger would reach the deadline sweep.
 *  The answer keeps absent and unreadable apart (D-3400 amended, D-3413): `absent` on `readNodeFile`'s proven ENOENT,
 *  `unreadable` for everything else (a failed, non-regular, too-large or late read). ONE read feeds both the in-flight
 *  check (`inFlightReport` over its text — every non-bytes read is "not busy", and the node's own `_upd_lock_probe`, in
 *  `_upd_detach`, then decides: the agent's rule, D-3371; Task 2's `readUpdateReport` is the agent's `O_NONBLOCK` twin)
 *  and the bound's snapshot, and a second read after a kill is compared with it. A report that IS in flight comes back
 *  with its writer's `pid`; whether that writer lives is `writerMayLive`'s question, asked by `localAnswer` (D-3411). */
async function localReport(deps: ConvergeDeps): Promise<UpdateReportRead> {
  const deadline = openPoolReadDeadline(INVENTORY_BUDGET_MS);
  try {
    const read = await readNodeFile(deps.localIo, path.join(deps.ccrcDir, NODE_FILES.report), deadline);
    if (read.ok) return { kind: 'bytes', text: read.content };
    return read.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
  } finally {
    deadline?.close();
  }
}

/** This box's own `update.json`, parsed for who wrote it (`parseReportOrigin`): `null` for anything but readable bytes of
 *  one JSON object. Absent and unreadable fold to `null` HERE and nowhere else, because the only question asked is whether
 *  the watchdog wrote it, and no answer is the plain `deadline`. */
async function ownReportOrigin(deps: ConvergeDeps): Promise<ReportOrigin | null> {
  const read = await localReport(deps);
  return read.kind === 'bytes' ? parseReportOrigin(read.text) : null;
}

/** D-3400: the server-role spawns whose `--detach` parent has not exited yet, by capability
 *  (one `LocalUpdateSpawn` per process in production — `index.ts` builds it once — and one per harness in a
 *  test). The bounded runner (`spawn.ts`) kills the parent's whole process group at UPDATE_SPAWN_TIMEOUT_MS and
 *  answers within `UPDATE_SPAWN_DRAIN_MS` after that, so an entry leaves this set when the runner's promise
 *  settles, and that is bounded. While it is here, the
 *  next run answers `busy` instead of starting a second parent — both parents would only PROBE the lock (wave 4),
 *  and a rollback parent asks the release host before it writes `queued`. The agent's process-wide `UpdateGate`
 *  (D-3392) is the same rule on the other role. */
const spawning = new WeakSet<LocalUpdateSpawn>();

/** The server-role answer: the busy read (D-3384), the spawn gate, then the `--detach`
 *  parent's exit. A parent the bound KILLED is decided by `decideKilledSpawn` over the report read before the spawn and
 *  the one read after it (D-3400 amended, D-3413), never by the kill alone. */
async function localAnswer(deps: ConvergeDeps, move: DispatchMove): Promise<OpAnswer> {
  const spawn = deps.runLocal;
  if (spawn === null) return { kind: 'transport', why: 'other', message: NO_LOCAL_RUNNER_DETAIL, reached: 'never' };
  // D-3411: a report says busy only while its writer lives; a dead writer's is a leftover and the op spawns,
  // and the parent's own lock probe decides. (F2 of review run 175; D-3384 read the file alone.)
  // D-3413: the SAME read is the bound's snapshot.
  const before = await localReport(deps);
  const busy = before.kind === 'bytes' ? inFlightReport(before.text) : null;
  if (busy !== null && writerMayLive(busy.pid)) return { kind: 'refused', err: 'busy', detail: inFlightBusyDetail(busy) };
  // Checked and taken with no await between: two runs can never both pass.
  if (spawning.has(spawn)) return { kind: 'refused', err: 'busy', detail: LOCAL_SPAWNING_DETAIL };
  let child: Promise<UpdateSpawnResult>;
  try {
    child = spawn(move.kind, move.target);
  } catch (e) {
    // A SYNCHRONOUS throw from the spawn — the argv builder's RangeError, or a relative or trailing-slash HOME — is a
    // fault of this server that will not mend itself: a halting `spawn-failed` naming the throw (fix round 1 item 9).
    // It is NOT the rejected-promise arm below. That arm is reached only by an error `child_process.spawn` throws
    // synchronously inside the runner's executor (E2BIG, ENOMEM, or an invalid argument such as ERR_INVALID_ARG_VALUE
    // — the last is not an errno), and nothing started there;
    // EAGAIN, EMFILE, ENFILE, EACCES and ENOENT arrive as the child's `error` event, which the runner answers as
    // code 1 `could not start the launcher (<code>)` — a halting `spawn-failed` below (residue R6, review 176 F2).
    return { kind: 'refused', err: 'spawn-failed', detail: e instanceof Error ? e.message : String(e) };
  }
  spawning.add(spawn);
  const clear = (): void => { spawning.delete(spawn); };
  child.then(clear, clear);
  try {
    const res = await child;
    if (res.killed) {
      const verdict = decideKilledSpawn({
        before, after: await localReport(deps), stdout: res.stdout, pid: res.pid, tag: move.target,
      });
      return verdict.arm === 'A'
        ? { kind: 'refused', err: 'not-queued', detail: verdict.detail }
        : { kind: 'accepted', detail: verdict.detail };
    }
    if (res.code === 0) return { kind: 'accepted' };
    // A launcher that ran, failed and printed nothing would render `firstStderrLine`'s generic 'no message'. Name
    // the one condition this path can actually tell apart: an empty stderr on a non-zero exit means the launcher
    // itself never spoke (review finding 3). A launcher that could not START answers a sentence of its own.
    const stderrLine = firstStderrLine(res.stderr);
    // D-3411: the parent's lock probe found the lock HELD and died before its `queued` write, so nothing changed:
    // busy (release `idle`, the request stands), carrying that line. Every other refusal keeps `spawn-failed`.
    if (isUpdateLockHeldLine(stderrLine)) return { kind: 'refused', err: 'busy', detail: lockHeldBusyDetail(stderrLine) };
    const detail = stderrLine === 'no message' ? `exit ${res.code} with no stderr from the launcher` : stderrLine;
    return { kind: 'refused', err: 'spawn-failed', detail };
  } catch (e) {
    // Reached only by an error spawn() throw synchronously inside the runner's executor (residue R6, review 176 F2).
    // `reached: 'never'` here rests on the bounded runner rejecting only before anything started (the premise cases
    // in update-local-spawn-throw.test.ts pin it); a runner that could reject AFTER spawning would need its own
    // positive marker, as the fleet link has (D-3555).
    return { kind: 'transport', why: 'other', message: e instanceof Error ? e.message : String(e), reached: 'never' };
  }
}

/**
 * One dispatch run (design 2026-09-20 §10). The role gate and, only when a server-role lease is about to fail, one bounded
 * read of this box's own report; then, in one synchronous stretch: the deadline
 * sweep; the plan over rows read after it; the met settles; the refusal notes; a move that cannot be sent,
 * noted; THE lease. Then, and only then, the op or the spawn — and the answer decides only what happens to
 * the lease: hold (and ask for a sweep), or release it idle/failed in this same run.
 */
export async function runDispatch(deps: ConvergeDeps, now: number): Promise<DispatchRunResult> {
  if (deps.role !== 'server' && deps.role !== 'both') return { ran: false, why: 'not-server-role' };
  const { store } = deps;
  // (0) The ONE await that precedes the synchronous stretch (fix round 1 item 4, D-3405 amended): when a SERVER-ROLE row
  // (`agentOps` NULL) is about to fail the deadline, this box's own `update.json` is read — through `localReport`'s
  // bounded reader — so the failed row can say the watchdog reverted the box (`deadlineDetail`). The read is async and
  // D-3377 forbids a yield between the rows the plan reads and the acquire, so it is taken HERE, BEFORE the stretch's own
  // first `store.nodes()`, and only handed in. The decision to read is synchronous over rows read a moment earlier; the
  // stretch then re-reads every row itself, so a row that changed in between is judged on its own fresh state and only
  // ever loses the sentence (a `null` here, or a report that does not fit, yields the plain `deadline`) — never a
  // wrong verdict. The scan in `update-converge.test.ts` pins the stretch from `const expired` to the acquire.
  // `now` was passed in by `watch.ts` before this await, so after it `now` can be up to INVENTORY_BUDGET_MS stale. Harmless, but an acquire CAN follow: the await happens when a server-role row is about to expire, and if that row settles during it (a report lands) the stretch's fresh re-read skips it, so `dispatchNode` may stamp a `now` up to INVENTORY_BUDGET_MS old and that lease's deadline fires up to that long (10 s) early. A row that does expire fails, and failed halts the fleet, so no acquire follows THAT case.
  const ownReport = store.nodes().some((r) => r.agentOps === null && deadlineExpired(r, now, deps.deadlineMs))
    ? await ownReportOrigin(deps)
    : null;
  // (1) The deadline: a busy lease its node has not written to for deadlineMs fails, and failed halts.
  const expired: string[] = [];
  for (const row of store.nodes()) {
    if (!deadlineExpired(row, now, deps.deadlineMs)) continue;
    if (store.releaseLease(row.nodeId, 'failed', linkFailedDeadlineDetail(row) ?? deadlineDetail(row, ownReport), null).ok) expired.push(row.nodeId);
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
  // R5 (review 176 F1, D-3412 amended): the answer is written on the LEASE, found by identity — the live busy row with
  // this move's label and this run's `now` — never on the id acquired: a revive during the await hands the lease to the
  // heir. Read and written with no await between. No holder (settled, or dropped by a no-revive supersede, R2): the id
  // acquired, whose own guards name what happened.
  const holder = leaseHolder(store.nodes(), view.row.label, now) ?? move.nodeId;
  if (action.kind === 'hold') {
    // D-3413: the bound's arms B/D carry the node's words; D-3555: a link failure after the hand-off
    // carries the server's. Either is written on the lease this run acquired (`now`, its identity); a refused note
    // is silent (a report settled the row first, or a newer lease).
    if ((answer.kind === 'accepted' && answer.detail !== undefined) || answer.kind === 'transport') {
      store.noteLeaseDetail(holder, action.detail, now);
    }
    deps.onAccepted();
    return done({ nodeId: holder, result: answer.kind === 'transport' ? 'held' : 'accepted', detail: action.detail });
  }
  const released = store.releaseLease(holder, action.to, action.detail, now);
  if (!released.ok) {
    return done({ nodeId: holder, result: 'release-refused', to: action.to, detail: action.detail, why: released.why });
  }
  return done({ nodeId: holder, result: 'released', to: action.to, detail: action.detail });
}
