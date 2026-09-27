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
// stat and the read still reads `too-large` here (D-3177), but the residual
// this reads honestly differs by path: over the agent, the grown file crosses
// the wire once, bounded by the WS frame limit; read locally (the server's
// own row, no wire in the way), the same race is bounded only by however
// large the file has grown by the time `readFile` runs. One
// `openPoolReadDeadline` bounds all seven reads of a node, exactly as
// `readObservedEpochFromRegistry` (`pools.ts:415-430`) bounds its one.
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
  BUSY_UPDATE_STATES, IN_FLIGHT_UPDATE_PHASES, UNIX_SECONDS_MAX, isReleaseTag, isUpdatePhase, validCapWords,
  type InstallState, type NodeOs, type NodeRole, type ProvenanceState, type SettledUpdateState, type StampRead,
  type TagFileRead,
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

/** floor / previous → line 1 through the one tag guard, plus THIS SWEEP's
 *  raw read state (fix round 1, D-3213). `absent` covers both a missing file
 *  and a garbled one (read fine, not a tag): both are determined THIS SWEEP
 *  to carry no floor, so a NULL floor stays UNCONSTRAINED to the resolver
 *  (§9) exactly as before. `unreadable`/`too-large`/the per-node deadline
 *  are `unmeasured` for THIS raw read — the caller (`applyMeasurement`)
 *  then decides, from the row's OWN previous `floorRead`/`previousRead`,
 *  whether to carry the previous (value, state) pair forward unchanged
 *  (I-1: something WAS measured before) or leave it `unmeasured` (nothing
 *  ever was) — never falling back to `currentVersion` as if the file were
 *  absent. */
export function tagStateFrom(read: NodeFileRead): { tag: string | null; state: TagFileRead } {
  if (!read.ok && read.reason !== 'absent') return { tag: null, state: 'unmeasured' };
  const line = firstLine(read);
  return isReleaseTag(line) ? { tag: line, state: 'measured' } : { tag: null, state: 'absent' };
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

/** update.json's times are unix SECONDS (bash-native — the W4 writer's
 *  contract). Eleven digits reach the year 5138; a thirteen-digit value is a
 *  millisecond stamp written by mistake, and it is REFUSED (null), never
 *  divided — a guess about units is the C1 defect `server.ts`'s pool-epoch
 *  route records, the other way round. `UNIX_SECONDS_MAX` (`shared/api.ts`)
 *  is the one declaration of this bound — `resolve.ts`'s `MAX_UNIX_S` used to
 *  be a second copy (C5, final fix wave). */
function secondsToMs(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= UNIX_SECONDS_MAX ? v * 1000 : null;
}

/** The report the phase table treats as "a node wrote SOMETHING unreadable
 *  or unparseable, leave the lease alone" (§8) — `reportFrom`'s own fallback,
 *  and (fix round 1, D-3214, I-2) `applyMeasurement`'s fallback for a
 *  `stamp-unmeasured` verdict with no previous report to restore: a
 *  guaranteed-non-NULL sentinel (fix round 1 re-review, N-4: NOT one no
 *  node's own `update.json` would ever produce — an unreadable, too-large or
 *  unparseable report produces this exact object too, through `reportFrom`)
 *  that differs from any report whose phase is NOT `unknown` (e.g. a real
 *  `done`) — `'unknown'` is itself a member of the `UpdatePhase` vocabulary,
 *  and is this sentinel's own phase, so it does not "differ from every report
 *  in the vocabulary"; what distinguishes its USE is that it satisfies "never
 *  NULL for a report that exists" while still differing from a real `done`
 *  report on the next sweep, keeping the changed-report gate open for
 *  re-evaluation. */
const UNKNOWN_REPORT: NodeReport = { phase: 'unknown', target: null, startedAt: null, updatedAt: null, detail: null };

/** update.json `{target, phase, startedAt, updatedAt, detail, from}` → the
 *  five report columns (§8, §10). NULL = no report file. Any other failure is
 *  a report whose phase is `unknown` — a node that wrote SOMETHING, which the
 *  phase table treats as "leave the lease alone" rather than as silence.
 *  Fields are read BY NAME and every other key is ignored: the file is
 *  additive, and a newer writer's extra key (wave 4's `pid`) is not a
 *  malformed report. */
export function reportFrom(read: NodeFileRead): NodeReport | null {
  if (!read.ok) return read.reason === 'absent' ? null : UNKNOWN_REPORT;
  let parsed: unknown;
  try { parsed = JSON.parse(read.content); } catch { return UNKNOWN_REPORT; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return UNKNOWN_REPORT;
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
  // No node-id forces installState 'unknown' regardless of what the marker
  // itself says (§8, a pre-W1 node) — D-3200's own invariant ("provenance is
  // 'unknown' unless installState is 'complete'") must hold on the OUTPUT
  // pair, not just on installFrom's own answer, so provenance is re-gated on
  // the installState this function actually returns, not on install's.
  const installState: InstallState = nodeId === null ? 'unknown' : install.installState;
  const floorState = tagStateFrom(reads.floor);
  const previousState = tagStateFrom(reads.previous);
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
    installState,
    provenance: installState === 'complete' ? install.provenance : 'unknown',
    caps,
    agentOps: conn.agentOps === null ? null : (validCapWords(conn.agentOps) ?? []),
    highestVersion: floorState.tag,
    previousVersion: previousState.tag,
    floorRead: floorState.state,
    previousRead: previousState.state,
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
  | {
    kind: 'none';
    why: 'no-report' | 'unchanged-report' | 'not-busy' | 'in-flight' | 'stale-report' | 'unknown-phase'
      /** fix round 1, D-3214 (F2): a `done` report whose stamp could not be
       *  read gives NO verdict — the lease stays pending until a later sweep
       *  reads the stamp fine. */
      | 'stamp-unmeasured';
  }
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
  // fix round 1, D-3214 (item 12): a report that names no start at all
  // cannot be shown to belong to THIS lease (or any other run) — treat it as
  // stale rather than let a report with a missing `startedAt` move a lease
  // it never announced starting, whenever the row holds one (it does here,
  // BUSY having just been proven).
  if (r.startedAt === null) return { kind: 'none', why: 'stale-report' };
  // PRECEDENCE (§8): a report whose run started before this lease belongs to
  // a previous run and never moves it — the round-2 race, where a stale
  // `done` released a lease acquired seconds earlier. The store's WHERE
  // carries the same guard (Task 5); this plan never asks it to be tested.
  const latest = latestStartOf(r)!;
  if (row.updateStartedAt !== null && latest < row.updateStartedAt) return { kind: 'none', why: 'stale-report' };
  if (IN_FLIGHT.has(r.phase)) return { kind: 'none', why: 'in-flight' };
  switch (r.phase) {
    case 'done':
      // fix round 1, D-3214 (F2): `currentVersion` is null both for an
      // unversioned build and for a stamp that could not be read — comparing
      // it against the target when the stamp itself is unmeasured would read
      // an unreadable build.json as a mismatch. Give NO verdict instead: the
      // lease stays pending until a later sweep reads the stamp fine.
      if (m.stampRead !== 'ok') return { kind: 'none', why: 'stamp-unmeasured' };
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
  /** D-3211: this connection's node-id was measured, but it already keys a
   *  LIVE row under a different label — merging would name two boxes as one,
   *  so this sweep keyed the measurement as if no node-id had been read and
   *  says so, rather than reporting `measured`. */
  | { label: string; result: 'node-id-collision'; nodeId: string; lease: LeaseAction['kind']; refused: boolean }
  | { label: string; result: 'unreachable'; nodeId: string }
  | { label: string; result: 'refused'; why: string }
  /** C1 (final fix wave; D-3217 records this arm in the plan's own Interfaces
   *  block, which had fallen behind it): this connection's own measurement+apply threw —
   *  `coord.db` is a synchronous `node:sqlite` handle, and a lock or
   *  corruption throws mid-transaction. Isolated per connection so a throw
   *  on one row still lets the OTHER row's measurement run and still lets
   *  the resolver/projection run after both (never an overloaded null on an
   *  existing arm — this is a distinct outcome, not a `refused`). */
  | { label: string; result: 'error'; message: string };

/** Read through a function so a check after an `await` reads the live field. */
const linkUp = (state: FleetState): boolean => state.connected;

/** D-3211: true when `nodeId` is already the key of a LIVE row (not
 *  superseded) carrying a connection label OTHER than this one — the state
 *  that would otherwise let `rekeyNode`/`upsertNodeMeasurement` merge two
 *  boxes' rows into one because both happen to read the same UUID (a cloned
 *  or restored `~/.ccrc`, a same-user write of `node-id`, or a remote agent
 *  pointed at the server's own box). */
function nodeIdCollides(store: InventoryStore, nodeId: string, label: string): boolean {
  const existing = store.node(nodeId);
  return existing !== null && existing.supersededBy === null && existing.label !== label;
}

/** D-3210: the row's own report columns, reconstructed as the `NodeReport`
 *  they represent — `null` when the row has none (never measured, or its
 *  last WRITTEN report was itself absent, `reportedPhase === null`). */
function previousReportOf(row: NodeRow | null): NodeReport | null {
  if (row === null || row.reportedPhase === null) return null;
  return {
    phase: row.reportedPhase, target: row.reportedTarget, startedAt: row.reportedStartedAt,
    updatedAt: row.reportedUpdatedAt, detail: row.reportedDetail,
  };
}

/** D-3210: `unreadable` is the only `NodeFileRead` failure this sweep treats
 *  as UNMEASURED rather than a real report — it is `readNodeFile`'s one fold
 *  for a plain read failure, the D-3178 unmeasured-lstat fold, and a per-file
 *  budget timeout alike. `absent` is a real absence (the report stays NULL,
 *  unchanged below); `too-large` was READ and is bad, so §8's `unknown` for
 *  it is unchanged. */
function reportUnmeasured(read: NodeFileRead): boolean {
  return !read.ok && read.reason === 'unreadable';
}

/** `label-key-taken` (Task 5): no live row carries the label AND a row
 *  already holds the label-keyed placeholder's key — superseded (its heir
 *  named) or live under another label (null). Nothing was written, so it is
 *  reported as a refusal, never as the `unreachable` row it is not. */
function unreachable(store: InventoryStore, now: number): SweepOutcome {
  const r = store.markUnreachable(FLEET_LABEL, 'fleet', now);
  if (!r.ok) return { label: FLEET_LABEL, result: 'refused', why: `${r.why}: ${r.supersededBy ?? 'held by a live row under another label'}` };
  return { label: FLEET_LABEL, result: 'unreachable', nodeId: r.nodeId };
}

/** One measurement into the store, in the order §8 fixes: collision check,
 *  re-key, the report/floor/previous unmeasured-carry overrides, plan against
 *  the pre-upsert row, the stamp-unmeasured report override (fix round 1,
 *  D-3214), upsert, refuse, lease. */
function applyMeasurement(store: InventoryStore, measured: NodeMeasurement, unmeasuredReport: boolean, now: number): SweepOutcome {
  const label = measured.label;
  let m = measured;
  let collision = false;
  if (m.nodeId !== label && nodeIdCollides(store, m.nodeId, label)) {
    // D-3211: this connection's node-id already keys a LIVE row under
    // another label — treat it exactly as a MISSING node-id (below) rather
    // than rekey/upsert onto that other box's row, and name the collision.
    collision = true;
    m = { ...m, nodeId: label };
  }
  if (m.nodeId !== label) {
    const rekeyed = store.rekeyNode(label, m.nodeId);
    if (!rekeyed.ok) return { label, result: 'refused', why: rekeyed.why };
  } else {
    // D-3201 (also the D-3211 collision's fallback path): no node-id this
    // sweep, but the live row carrying this label was already re-keyed to
    // one — keep measuring into it rather than open a second live row for
    // the same connection.
    const live = store.nodeByLabel(label);
    if (live !== null && live.nodeId !== label) m = { ...m, nodeId: live.nodeId };
  }
  const preRow = store.node(m.nodeId);
  if (unmeasuredReport) {
    // D-3210, corrected by fix round 1 D-3213 (F8): an unmeasured report read
    // must never overwrite a previously measured one — reuse the row's own
    // report columns unchanged so the changed-report gate below sees no
    // change. But when there IS no previous report to carry (a first sweep,
    // or a row whose `reportedPhase` is still NULL), falling back to `null`
    // would store "no report file" (§6) for a file that DOES exist and was
    // merely unreadable — `measurementFrom` already computed `m.report` as
    // `reportFrom`'s `unknown` fold for exactly this read, so keep THAT
    // rather than nulling it out.
    m = { ...m, report: previousReportOf(preRow) ?? m.report };
  }
  // fix round 1, D-3213 (I-1, corrected by this fix round's own review): an
  // unmeasured READ this sweep carries the row's own previous (VALUE, STATE)
  // PAIR forward unchanged — never just the value. `floorRead`/`previousRead`
  // describe the STORED value, not this sweep's raw read: `measured` and
  // `absent` both survive a later unreadable sweep exactly as they were,
  // because something WAS measured, and only a row with NO PRIOR
  // measurement at all (`preRow` absent, or itself `unmeasured`) reads
  // `unmeasured` here — which then always pairs with a NULL value, never a
  // carried one. Without the state carrying too, a previously-absent floor
  // (a real, measured "no floor") would relabel itself `unmeasured` on the
  // next EACCES and the resolver would refuse to resolve a node that was
  // always unconstrained.
  if (m.floorRead === 'unmeasured' && preRow !== null && preRow.floorRead !== 'unmeasured') {
    m = { ...m, highestVersion: preRow.highestVersion, floorRead: preRow.floorRead };
  }
  if (m.previousRead === 'unmeasured' && preRow !== null && preRow.previousRead !== 'unmeasured') {
    m = { ...m, previousVersion: preRow.previousVersion, previousRead: preRow.previousRead };
  }
  const plan = sweepPlanFor(preRow, m);
  // fix round 1, D-3214 (F2, corrected by this fix round's own review, I-2):
  // a `done` report seen while the stamp could not be read must be
  // re-evaluated once the stamp reads fine — never consumed as "seen" while
  // its verdict was withheld. Restore the row's own previous report before
  // the upsert, so the NEXT sweep's report — even the identical one — reads
  // as CHANGED against what is actually stored, and `leaseActionFor` runs
  // again with (by then, hopefully) a readable stamp. A busy row with NO
  // previous report falls back to `UNKNOWN_REPORT`, never `NULL` (I-2: a
  // `reportedPhase NULL` claims "no report file", §6, for an `update.json`
  // that DID read fine — the stamp is what is unmeasured, not the report)
  // and never `m.report` itself (storing the real, unchanged `done` report
  // would make the NEXT identical sweep read as unchanged too, wedging the
  // gate exactly like the bug this override exists to fix).
  if (plan.lease.kind === 'none' && plan.lease.why === 'stamp-unmeasured') {
    m = { ...m, report: previousReportOf(preRow) ?? UNKNOWN_REPORT };
  }
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
  return { label, result: collision ? 'node-id-collision' : 'measured', nodeId: m.nodeId, lease, refused };
}

/** C1 (final fix wave): the server row's own measurement+apply, isolated in
 *  its own try/catch — a throw here (a locked or corrupt `coord.db`, most
 *  likely) must not stop the fleet connection's row, below, from being
 *  measured on the same sweep. */
async function sweepOwn(deps: InventoryDeps, budget: number, now: number): Promise<SweepOutcome> {
  try {
    // Reads inlined (rather than through `measureNode`) so the raw report read
    // survives past validation — D-3210's fold decision needs to know whether
    // it was `unreadable`, not just what `reportFrom` turned it into.
    const ownReads = await readNodeFiles(deps.localIo, deps.ccrcDir, budget);
    const own = measurementFrom(ownReads, { label: SERVER_LABEL, role: deps.role, agentOps: null }, now);
    return applyMeasurement(deps.store, own, reportUnmeasured(ownReads.report), now);
  } catch (err) {
    return { label: SERVER_LABEL, result: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/** C1's twin for the one agent connection. Same isolation, same reason. */
async function sweepFleet(deps: InventoryDeps, fleet: NonNullable<InventoryDeps['fleet']>, budget: number, now: number): Promise<SweepOutcome> {
  try {
    const { io, state } = fleet;
    if (!linkUp(state)) return unreachable(deps.store, now);
    // `agentOps` is read inside the connected arm only: the field keeps the
    // last `ready`'s answer across a drop (Task 8).
    const fleetReads = await readNodeFiles(io, deps.ccrcDir, budget);
    const m = measurementFrom(fleetReads, { label: FLEET_LABEL, role: 'fleet', agentOps: state.agentOps ?? [] }, now);
    return linkUp(state) ? applyMeasurement(deps.store, m, reportUnmeasured(fleetReads.report), now) : unreachable(deps.store, now);
  } catch (err) {
    return { label: FLEET_LABEL, result: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * One sweep over every node this server can name: its own row through the
 * local io, and — in remote mode — the one agent connection. A connection that
 * is down on this sweep is written unreachable ON THIS SWEEP (§8), never left
 * at its last value; one that drops while its reads are in flight is too,
 * because seven `unreadable`s across a drop describe the link, not the node.
 *
 * PER-ROW ISOLATION (C1, final fix wave): the server row and the fleet
 * connection are measured+applied in their OWN try/catch — a throw on one
 * (a locked or corrupt `coord.db`, most likely, since every write here is a
 * synchronous `node:sqlite` call) still lets the other row's outcome land,
 * and this function itself never rejects on that account, so its caller's
 * resolve-and-project step always runs after both rows.
 */
export async function sweepInventory(deps: InventoryDeps, now: number): Promise<SweepOutcome[]> {
  const budget = deps.budgetMs ?? INVENTORY_BUDGET_MS;
  const out: SweepOutcome[] = [await sweepOwn(deps, budget, now)];
  if (deps.fleet !== null) out.push(await sweepFleet(deps, deps.fleet, budget, now));
  return out;
}
