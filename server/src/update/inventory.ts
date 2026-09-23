// L3 — the node inventory (design 2026-09-20 §8): seven small files under a
// node's ~/.ccrc, read every minute and after every `ready`, validated, and
// written into the measurement and report columns of the node's row; then
// the §8 phase table, applied to the lease columns through releaseLease /
// settleNode and never by a direct write.
//
// EVERY READ IS lstat-GATED, SIZE-CAPPED AND BUDGET-BOUNDED, because these
// files are same-user-writable by every session on the box (decision 13):
// `lstatMeasured` first and only `regular` proceeds (`limits.ts:430-431`'s
// authDead gate is the precedent — a symlink is what bash refuses), then
// `statMeasured`'s size against NODE_FILE_CAP_BYTES, then the read, then the
// content's UTF-8 length again. The agent's text read has no cap of its own
// (`readWhole`, `agent/src/fileops.ts:75`), so a file that grows between the
// stat and the read crosses the wire once, bounded by the WS frame limit, and
// still reads `too-large` here (D-3177). One `openPoolReadDeadline`
// bounds all seven reads of a node, exactly as `readObservedEpochFromRegistry`
// (`pools.ts:415-430`) bounds its one.
//
// NOTHING READ FROM A NODE REACHES A ROW UN-VALIDATED: each file has one pure
// validator below, and a value that fails it becomes the column's named
// fallback (§8 "Validation"), never a partial.
//
// THE SWEEP IS THE ONLY WRITER OF MEASUREMENT (§18 "measurement is a sweep"):
// `fleetState.build` is a handshake-time sample and is never read here as the
// current build; the row is re-measured every sweep, and `measuredAt` is the
// sweep's own clock.
import path from 'node:path';
import {
  BUSY_UPDATE_STATES, IN_FLIGHT_UPDATE_PHASES, isReleaseTag, isUpdatePhase, validCapWords,
  type InstallState, type NodeOs, type NodeRole, type ProvenanceState, type SettledUpdateState, type StampRead,
} from '../../../shared/api.js';
import { NODE_FILES, type NodeFileKey } from '../../../shared/agent-protocol.js';
import { parseBuildInfo, type BuildInfo } from '../../../shared/buildinfo.js';
// NODE_ID_RE is the store's (Task 5): declared once beside `rekeyNode`, the one
// writer that refuses a key outside it, so this reader and that writer cannot
// disagree about what `_inst_node_id` (`ccd/ccrc:9494-9513`) mints — a
// lowercase uuid. An uppercase one was not written by the installer and keys nothing.
import {
  NODE_ID_RE,
  type MarkUnreachableResult, type NodeMeasurement, type NodeReport, type NodeRow, type RefuseReleaseResult,
  type RekeyNodeResult, type ReleaseLeaseResult, type SettleNodeResult, type UpsertNodeResult,
} from '../coord/store.js';
import type { FleetState } from '../fleetstate.js';
import type { FleetIO, ReadFailure } from '../io.js';
import { openPoolReadDeadline, type PoolReadDeadline } from '../pools.js';

/** §8: "every read is capped at 65536 bytes". */
export const NODE_FILE_CAP_BYTES = 65536;
/** §8: "`reportedDetail` is cut to 200 printable-ASCII characters". */
export const REPORT_DETAIL_MAX = 200;
/** update.json's times are unix SECONDS (bash-native — the W4 writer's
 *  contract). Eleven digits reach the year 5138; a thirteen-digit value is a
 *  millisecond stamp written by mistake, and it is REFUSED (null), never
 *  divided — a guess about units is the C1 defect `server.ts`'s pool-epoch
 *  route records, the other way round. */
export const REPORT_TIME_MAX_S = 99_999_999_999;
/** A seconds stamp names a whole second: `startedAt = s` covers
 *  [s*1000, s*1000 + 999] ms. The precedence below compares the LATEST instant
 *  the report's run could have started with the lease's ms stamp, so a run
 *  dispatched at s*1000 + 500 whose node wrote `startedAt = s` is the current
 *  run, not a previous one (D-3199). Skew between the
 *  two boxes' clocks beyond this second is not covered, and not claimed. */
export const REPORT_TIME_RESOLUTION_MS = 1000;
/** One node's seven reads, in total. Over the agent each read is three round
 *  trips (lstat, stat, read), all seven in parallel. */
export const INVENTORY_BUDGET_MS = 10_000;
/** D-3184: the server's own row and the one agent connection. A
 *  second agent connection would need a label of its own. */
export const SERVER_LABEL = 'server';
export const FLEET_LABEL = 'fleet';

/** A stamp's three strings reach `NodeWire.current` and the screen: printable
 *  ASCII, at most 200. `stamp_build` writes a git sha, a ref name and a
 *  `date -u`, none of which is longer or anything else. */
const STAMP_FIELD = /^[\x20-\x7e]{1,200}$/;
const OS_LINE = /^os (linux|darwin)$/;

/** The two failure words are `ReadFailure`'s, DERIVED, never restated: naming
 *  the two failure words as a spelled-out quoted union in this file would make
 *  it a second holder of that vocabulary and red single-definition.test.ts's
 *  "one absent/unreadable read vocabulary" (its `PAIR` scan covers
 *  `server/src`) — the trap Task 1 avoided for `StampRead` (D-3189). */
export type NodeFileRead =
  | { ok: true; content: string }
  | { ok: false; reason: ReadFailure | 'too-large' };
type MeasuredFileKey = Exclude<NodeFileKey, 'projection'>;
export type NodeFileReads = Record<MeasuredFileKey, NodeFileRead>;
export interface NodeConnection { label: string; role: NodeRole; agentOps: readonly string[] | null }

/** Derived from `NODE_FILES`, never hand-listed. `update-intent` is in the
 *  agent's read set so a later screen can SHOW what a fleet node last
 *  received; it is never read back as authority (§8), so the measurement does
 *  not read it at all. */
const MEASURED_FILE_KEYS: readonly MeasuredFileKey[] =
  (Object.keys(NODE_FILES) as NodeFileKey[]).filter((k): k is MeasuredFileKey => k !== 'projection');

const ABSENT: NodeFileRead = { ok: false, reason: 'absent' };
const UNREADABLE: NodeFileRead = { ok: false, reason: 'unreadable' };
const TOO_LARGE: NodeFileRead = { ok: false, reason: 'too-large' };

/**
 * One file: lstat → regular only → stat size → read → length. `absent` only
 * on a proven ENOENT from the io (its one errno mapping, `io.ts:169-170`).
 *
 * `unmeasured` — an lstat this io cannot answer — reads `unreadable`
 * (D-3178). It has TWO sources: an agent too old for the op,
 * and a W2 agent REFUSING the lstat of a live symlink that carries a node-file
 * name (Task 8's literal-basename rule, D-3195), which
 * `remote/io.ts`'s `lstatMeasured` maps to `unmeasured` like any refused
 * request. `io.ts`'s never-fold rule governs ADAPTERS; this is the consumer
 * deciding, for a vocabulary (`StampRead`, §8's absent/unreadable pair) that
 * has no third slot, and the fold is honest for both: an agent that old
 * predates the ~/.ccrc read set and refuses every one of these paths anyway,
 * and a symlinked node file is exactly what §8 reads as `unreadable`.
 */
export async function readNodeFile(io: FleetIO, filePath: string, deadline: PoolReadDeadline | null): Promise<NodeFileRead> {
  const within = <T>(op: Promise<T>): Promise<T | null> => (deadline === null ? op.catch(() => null) : deadline.race(op));
  const kind = await within(io.lstatMeasured(filePath));
  if (kind === null || deadline?.expired()) return UNREADABLE;
  if (!kind.ok) return kind.reason === 'absent' ? ABSENT : UNREADABLE;
  if (kind.kind !== 'regular') return UNREADABLE;
  const size = await within(io.statMeasured(filePath));
  if (size === null || deadline?.expired()) return UNREADABLE;
  if (!size.ok) return size.reason === 'absent' ? ABSENT : UNREADABLE;
  if (size.size > NODE_FILE_CAP_BYTES) return TOO_LARGE;
  const read = await within(io.readFileMeasured(filePath, deadline?.budgetMs, deadline?.signal));
  if (read === null || deadline?.expired()) return UNREADABLE;
  if (!read.ok) return read.reason === 'absent' ? ABSENT : UNREADABLE;
  if (Buffer.byteLength(read.content, 'utf8') > NODE_FILE_CAP_BYTES) return TOO_LARGE;
  return { ok: true, content: read.content };
}

/** A node's seven files under one deadline. No usable budget is no
 *  measurement: every file `unreadable`, and not one io call is made. */
export async function readNodeFiles(io: FleetIO, ccrcDir: string, budgetMs: number): Promise<NodeFileReads> {
  const deadline = openPoolReadDeadline(budgetMs);
  const assemble = (reads: readonly NodeFileRead[]): NodeFileReads =>
    Object.fromEntries(MEASURED_FILE_KEYS.map((k, i) => [k, reads[i]])) as NodeFileReads;
  if (deadline === null) return assemble(MEASURED_FILE_KEYS.map(() => UNREADABLE));
  try {
    return assemble(await Promise.all(
      MEASURED_FILE_KEYS.map((k) => readNodeFile(io, path.join(ccrcDir, NODE_FILES[k]), deadline)),
    ));
  } finally {
    deadline.close();
  }
}

/** Lines of a small text file: `\n`-split, one trailing empty element dropped,
 *  and a `\r` stripped only where it ends a line — anywhere else it stays, and
 *  the line's own grammar refuses it. */
function linesOf(content: string): string[] {
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}
const firstLine = (read: NodeFileRead): string | null => (read.ok ? linesOf(read.content)[0] ?? null : null);

/** build.json → the four-word read and the whole stamp. `parseBuildInfo`
 *  (`buildinfo.ts:86`) is the one validator; the read above it is what keeps
 *  absent and unreadable apart (§8), and a stamp is accepted whole or not at
 *  all — a `version` that is present but not a tag, or a string field outside
 *  printable ASCII / 200 characters, makes the stamp `malformed`. */
export function stampFrom(read: NodeFileRead): { stampRead: StampRead; build: BuildInfo | null } {
  if (!read.ok) {
    if (read.reason === 'too-large') return { stampRead: 'malformed', build: null };
    return { stampRead: read.reason, build: null };
  }
  const build = parseBuildInfo(read.content);
  if (build === null) return { stampRead: 'malformed', build: null };
  if (build.version !== undefined && !isReleaseTag(build.version)) return { stampRead: 'malformed', build: null };
  if (!STAMP_FIELD.test(build.sha) || !STAMP_FIELD.test(build.ref) || !STAMP_FIELD.test(build.builtAt)) {
    return { stampRead: 'malformed', build: null };
  }
  return { stampRead: 'ok', build };
}

/** ccrc-caps → line 1 `os linux|darwin`, then one CAP_WORD per line, at most
 *  MAX_CAP_WORDS (`validCapWords`). ONE bad line drops the whole file (§8):
 *  a file that carries anything else was not written by `_inst_caps`, and
 *  keeping the good half of it would put a stranger's words on the wire. */
export function capsFrom(read: NodeFileRead): { os: NodeOs; caps: string[] } {
  if (!read.ok) return { os: 'unknown', caps: [] };
  const lines = linesOf(read.content);
  const os = OS_LINE.exec(lines[0] ?? '');
  if (os === null) return { os: 'unknown', caps: [] };
  const caps = validCapWords(lines.slice(1));
  if (caps === null) return { os: 'unknown', caps: [] };
  return { os: os[1] === 'darwin' ? 'darwin' : 'linux', caps };
}

/** installed → installState and provenance (§8). `complete` iff line 1 is the
 *  stamp's sha; `incomplete` when it differs or the marker is absent under a
 *  readable stamp; `unknown` when either cannot be read. Provenance is line 2
 *  (`unsigned` → unverified; none, on a node whose caps say `verify` →
 *  verified) and is read ONLY from a complete marker: a marker naming another
 *  tree says nothing about the one running (D-3200). */
export function installFrom(read: NodeFileRead, stamp: { stampRead: StampRead; build: BuildInfo | null }, caps: readonly string[]): { installState: InstallState; provenance: ProvenanceState } {
  if (stamp.build === null) return { installState: 'unknown', provenance: 'unknown' };
  if (!read.ok) return { installState: read.reason === 'absent' ? 'incomplete' : 'unknown', provenance: 'unknown' };
  const lines = linesOf(read.content);
  if (lines[0] !== stamp.build.sha) return { installState: 'incomplete', provenance: 'unknown' };
  const provenance: ProvenanceState = lines.length === 2 && lines[1] === 'unsigned' ? 'unverified'
    : lines.length === 1 && caps.includes('verify') ? 'verified'
      : 'unknown';
  return { installState: 'complete', provenance };
}

/** floor / previous → line 1 through the one tag guard, else NULL (§8). A
 *  NULL floor is UNCONSTRAINED to the resolver (§9), so a garbled floor file
 *  reads as the absence it is, never as `v0.0.0`. */
export function tagLineFrom(read: NodeFileRead): string | null {
  const line = firstLine(read);
  return isReleaseTag(line) ? line : null;
}

/** node-id → line 1 through NODE_ID_RE, else NULL (the row keys by label). */
export function nodeIdFrom(read: NodeFileRead): string | null {
  const line = firstLine(read);
  return line !== null && NODE_ID_RE.test(line) ? line : null;
}

/** Printable ASCII only — every run of anything else becomes one space — trimmed, cut to REPORT_DETAIL_MAX. */
export function printableDetail(raw: string): string {
  return raw.replace(/[^\x20-\x7e]+/g, ' ').trim().slice(0, REPORT_DETAIL_MAX);
}

function secondsToMs(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= REPORT_TIME_MAX_S ? v * 1000 : null;
}

/** update.json `{target, phase, startedAt, updatedAt, detail, from}` → the
 *  five report columns (§8, §10). NULL = no report file. Any other failure is
 *  a report whose phase is `unknown` — a node that wrote SOMETHING, which the
 *  phase table treats as "leave the lease alone" rather than as silence.
 *  Fields are read BY NAME and every other key is ignored: the file is
 *  additive, and a newer writer's extra key (wave 4's `pid`) is not a
 *  malformed report. */
export function reportFrom(read: NodeFileRead): NodeReport | null {
  const unknown: NodeReport = { phase: 'unknown', target: null, startedAt: null, updatedAt: null, detail: null };
  if (!read.ok) return read.reason === 'absent' ? null : unknown;
  let parsed: unknown;
  try { parsed = JSON.parse(read.content); } catch { return unknown; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return unknown;
  const o = parsed as Record<string, unknown>;
  const detail = typeof o.detail === 'string' ? printableDetail(o.detail) : '';
  return {
    phase: isUpdatePhase(o.phase) ? o.phase : 'unknown',
    target: isReleaseTag(o.target) ? o.target : null,
    startedAt: secondsToMs(o.startedAt),
    updatedAt: secondsToMs(o.updatedAt),
    detail: detail === '' ? null : detail,
  };
}

/** The seven reads → one row's measurement and report groups (§6's writer
 *  groups: nothing else). No node-id keys the row by its label with
 *  installState `unknown` (§8, a pre-W1 node). `agentOps` is validated again
 *  here — the ready reader validated it once (`readReadyOps`), and this is the
 *  last step before a row, so a caller that skipped that reader still cannot
 *  put an unvalidated word on the wire. */
export function measurementFrom(reads: NodeFileReads, conn: NodeConnection, now: number): NodeMeasurement {
  const stamp = stampFrom(reads.stamp);
  const { os, caps } = capsFrom(reads.caps);
  const nodeId = nodeIdFrom(reads.nodeId);
  const install = installFrom(reads.installed, stamp, caps);
  const build = stamp.build;
  return {
    nodeId: nodeId ?? conn.label,
    role: conn.role,
    label: conn.label,
    currentVersion: build?.version ?? null,
    currentSha: build?.sha ?? null,
    currentRef: build?.ref ?? null,
    currentBuiltAt: build?.builtAt ?? null,
    currentDirty: build === null ? null : build.dirty,
    stampRead: stamp.stampRead,
    installState: nodeId === null ? 'unknown' : install.installState,
    provenance: install.provenance,
    caps,
    agentOps: conn.agentOps === null ? null : (validCapWords(conn.agentOps) ?? []),
    highestVersion: tagLineFrom(reads.floor),
    previousVersion: tagLineFrom(reads.previous),
    os,
    measuredAt: now,
    report: reportFrom(reads.report),
  };
}

export async function measureNode(io: FleetIO, ccrcDir: string, budgetMs: number, conn: NodeConnection, now: number): Promise<NodeMeasurement> {
  return measurementFrom(await readNodeFiles(io, ccrcDir, budgetMs), conn, now);
}

/** The five current* columns back to the parser's own shape — no `version`
 *  key when the column is NULL, exactly as `parseBuildInfo` returns an
 *  unversioned stamp — so `buildAgreement` keeps its sha+dirty inputs (§14).
 *  NULL unless the stamp read `ok`: a row whose stamp could not be read has no
 *  build, whatever its columns last held. */
export function buildInfoOfRow(row: Pick<NodeRow, 'stampRead' | 'currentSha' | 'currentRef' | 'currentBuiltAt' | 'currentDirty' | 'currentVersion'>): BuildInfo | null {
  if (row.stampRead !== 'ok' || row.currentSha === null || row.currentRef === null
    || row.currentBuiltAt === null || row.currentDirty === null) return null;
  const base = { sha: row.currentSha, ref: row.currentRef, builtAt: row.currentBuiltAt, dirty: row.currentDirty };
  return row.currentVersion === null ? base : { ...base, version: row.currentVersion };
}

export type LeaseAction =
  | { kind: 'none'; why: 'no-report' | 'unchanged-report' | 'not-busy' | 'in-flight' | 'stale-report' | 'unknown-phase' }
  | { kind: 'settle'; detail: string }
  | { kind: 'release'; to: SettledUpdateState; detail: string };
export interface SweepPlan { lease: LeaseAction; refuse: { tag: string; detail: string } | null }

const BUSY: ReadonlySet<string> = new Set<string>(BUSY_UPDATE_STATES);
const IN_FLIGHT: ReadonlySet<string> = new Set<string>(IN_FLIGHT_UPDATE_PHASES);

function sameReport(row: NodeRow, r: NodeReport): boolean {
  return row.reportedPhase === r.phase && row.reportedTarget === r.target && row.reportedStartedAt === r.startedAt
    && row.reportedUpdatedAt === r.updatedAt && row.reportedDetail === r.detail;
}

/** The latest ms instant the report's run could have started (see
 *  REPORT_TIME_RESOLUTION_MS); NULL when the report carries no start. */
function latestStartOf(r: NodeReport): number | null {
  return r.startedAt === null ? null : r.startedAt + REPORT_TIME_RESOLUTION_MS - 1;
}

function leaseActionFor(row: NodeRow | null, m: NodeMeasurement, r: NodeReport): LeaseAction {
  if (row === null || !BUSY.has(row.updateState)) return { kind: 'none', why: 'not-busy' };
  // PRECEDENCE (§8): a report whose run started before this lease belongs to
  // a previous run and never moves it — the round-2 race, where a stale
  // `done` released a lease acquired seconds earlier. The store's WHERE
  // carries the same guard (Task 5); this plan never asks it to be tested.
  const latest = latestStartOf(r);
  if (latest !== null && row.updateStartedAt !== null && latest < row.updateStartedAt) return { kind: 'none', why: 'stale-report' };
  if (IN_FLIGHT.has(r.phase)) return { kind: 'none', why: 'in-flight' };
  switch (r.phase) {
    case 'done':
      return r.target !== null && m.currentVersion === r.target
        ? { kind: 'settle', detail: `done: ${r.target}` }
        : { kind: 'release', to: 'failed', detail: 'stamp-mismatch' };
    case 'failed':
    case 'reverted':
      return { kind: 'release', to: r.phase, detail: r.detail ?? r.phase };
    default:
      // `unknown` (a token outside UpdatePhase, or an unreadable report):
      // untouched inside the deadline, which W4's dispatcher enforces.
      return { kind: 'none', why: 'unknown-phase' };
  }
}

/**
 * The §8 phase table as a plan, pure. ACTS ONLY ON A CHANGED REPORT: update.json
 * persists, so a report the row already holds is one the sweep already acted
 * on — without this, a `failed` report would re-release a lease every minute
 * and re-insert a provenance refusal that `ack` just cleared (Review Focus 2).
 * The refusal is THIS node's verdict on THIS tag (§8), recorded whether or not
 * this server holds a lease — a CLI-driven update reports the same file.
 */
export function sweepPlanFor(row: NodeRow | null, m: NodeMeasurement): SweepPlan {
  const r = m.report;
  if (r === null) return { lease: { kind: 'none', why: 'no-report' }, refuse: null };
  if (row !== null && sameReport(row, r)) return { lease: { kind: 'none', why: 'unchanged-report' }, refuse: null };
  const refuse = r.phase === 'failed' && r.target !== null && r.detail !== null && r.detail.startsWith('provenance:')
    ? { tag: r.target, detail: r.detail }
    : null;
  return { lease: leaseActionFor(row, m, r), refuse };
}

/** The port this module needs, declared by the consumer (L2). `CoordStore` satisfies it structurally. */
export interface InventoryStore {
  upsertNodeMeasurement(m: NodeMeasurement): UpsertNodeResult;
  markUnreachable(label: string, role: NodeRole, at: number): MarkUnreachableResult;
  rekeyNode(label: string, nodeId: string): RekeyNodeResult;
  releaseLease(nodeId: string, to: SettledUpdateState, detail: string, reportStartedAt: number | null): ReleaseLeaseResult;
  settleNode(nodeId: string, detail: string, reportStartedAt: number | null): SettleNodeResult;
  refuseRelease(nodeId: string, tag: string, at: number, detail: string): RefuseReleaseResult;
  node(nodeId: string): NodeRow | null;
  nodeByLabel(label: string): NodeRow | null;
}
export interface InventoryDeps {
  store: InventoryStore; localIo: FleetIO; ccrcDir: string; role: NodeRole;
  fleet: { io: FleetIO; state: FleetState } | null;
  budgetMs?: number;
}
export type SweepOutcome =
  | { label: string; result: 'measured'; nodeId: string; lease: LeaseAction['kind']; refused: boolean }
  | { label: string; result: 'unreachable'; nodeId: string }
  | { label: string; result: 'refused'; why: string };

/** Read through a function so a check after an `await` reads the live field. */
const linkUp = (state: FleetState): boolean => state.connected;

/** `label-key-taken` (Task 5): no live row carries the label AND a row
 *  already holds the label-keyed placeholder's key — superseded (its heir
 *  named) or live under another label (null). Nothing was written, so it is
 *  reported as a refusal, never as the `unreachable` row it is not. */
function unreachable(store: InventoryStore, now: number): SweepOutcome {
  const r = store.markUnreachable(FLEET_LABEL, 'fleet', now);
  if (!r.ok) return { label: FLEET_LABEL, result: 'refused', why: `${r.why}: ${r.supersededBy ?? 'held by a live row under another label'}` };
  return { label: FLEET_LABEL, result: 'unreachable', nodeId: r.nodeId };
}

/** One measurement into the store, in the order §8 fixes: re-key, plan
 *  against the pre-upsert row, upsert, refuse, lease. */
function applyMeasurement(store: InventoryStore, measured: NodeMeasurement, now: number): SweepOutcome {
  const label = measured.label;
  let m = measured;
  if (m.nodeId !== label) {
    const rekeyed = store.rekeyNode(label, m.nodeId);
    if (!rekeyed.ok) return { label, result: 'refused', why: rekeyed.why };
  } else {
    // D-3201: no node-id this sweep, but the live row carrying
    // this label was already re-keyed to one — keep measuring into it rather
    // than open a second live row for the same connection.
    const live = store.nodeByLabel(label);
    if (live !== null && live.nodeId !== label) m = { ...m, nodeId: live.nodeId };
  }
  const plan = sweepPlanFor(store.node(m.nodeId), m);
  const upserted = store.upsertNodeMeasurement(m);
  if (!upserted.ok) return { label, result: 'refused', why: `${upserted.why}: ${upserted.supersededBy}` };
  let refused = false;
  if (plan.refuse !== null) {
    const r = store.refuseRelease(m.nodeId, plan.refuse.tag, now, plan.refuse.detail);
    refused = r.ok && r.inserted;
  }
  const latest = m.report === null ? null : latestStartOf(m.report);
  let lease: LeaseAction['kind'] = 'none';
  if (plan.lease.kind === 'settle') {
    if (store.settleNode(m.nodeId, plan.lease.detail, latest).ok) lease = 'settle';
  } else if (plan.lease.kind === 'release') {
    if (store.releaseLease(m.nodeId, plan.lease.to, plan.lease.detail, latest).ok) lease = 'release';
  }
  return { label, result: 'measured', nodeId: m.nodeId, lease, refused };
}

/**
 * One sweep over every node this server can name: its own row through the
 * local io, and — in remote mode — the one agent connection. A connection that
 * is down on this sweep is written unreachable ON THIS SWEEP (§8), never left
 * at its last value; one that drops while its reads are in flight is too,
 * because seven `unreadable`s across a drop describe the link, not the node.
 */
export async function sweepInventory(deps: InventoryDeps, now: number): Promise<SweepOutcome[]> {
  const budget = deps.budgetMs ?? INVENTORY_BUDGET_MS;
  const out: SweepOutcome[] = [];
  const own = await measureNode(deps.localIo, deps.ccrcDir, budget, { label: SERVER_LABEL, role: deps.role, agentOps: null }, now);
  out.push(applyMeasurement(deps.store, own, now));
  if (deps.fleet !== null) {
    const { io, state } = deps.fleet;
    if (!linkUp(state)) {
      out.push(unreachable(deps.store, now));
    } else {
      // `agentOps` is read inside the connected arm only: the field keeps the
      // last `ready`'s answer across a drop (Task 8).
      const m = await measureNode(io, deps.ccrcDir, budget, { label: FLEET_LABEL, role: 'fleet', agentOps: state.agentOps ?? [] }, now);
      out.push(linkUp(state) ? applyMeasurement(deps.store, m, now) : unreachable(deps.store, now));
    }
  }
  return out;
}
