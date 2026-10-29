// D-7404 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB2; spec 2026-10-28-test-box-design.md §2.4,
// §2.6, §2.7, §2.9, §2.10). L0: imports only shared/ siblings (the PWA may bundle this file). ONE VOCABULARY for the
// test box: the run frames the wrapper's remote arm and the test service exchange, the states the server decides, the
// fallback reasons in spec §2.4's order, the runs log's line, the version row and the repository row's parser.
//
// The frames are the test service's own family (D-7428): they are not members of the fleet agent's `AgentReq` union
// and they bump no `FLEET_PROTO`; `TESTBOX_PROTO` is theirs. Each frame has ONE reader, `readTestboxFrame`, which
// checks every field and refuses a frame with any field it does not name, so a frame is never half-read.

import { isReleaseTag } from './api.js';

/** The test service's protocol version (spec §2.4's protocol row compares it with the wrapper's). */
export const TESTBOX_PROTO = 1;

// ---------------------------------------------------------------------------------------------------------------
// Vocabularies. Every exported literal union has its sibling `Record<X, true>` map (wire totality, D-6048).
// ---------------------------------------------------------------------------------------------------------------

/** The server's decided state of the test box (spec §2.7). `off` means no test box is configured (D-7444); the
 *  switch is a separate field. */
export type TestboxState = 'off' | 'ok' | 'degraded' | 'down' | 'unreachable';
export const TESTBOX_STATE_MAP: Record<TestboxState, true> = { off: true, ok: true, degraded: true, down: true, unreachable: true };

/** What the box says of itself in its status answer: it can only answer `ok`, `degraded` or `down`; `off` and
 *  `unreachable` are the fleet host's own conclusions. */
export type TestboxBoxState = 'ok' | 'degraded' | 'down';
export const TESTBOX_BOX_STATE_MAP: Record<TestboxBoxState, true> = { ok: true, degraded: true, down: true };

/** The scratch refs a submission may push (spec §2.1), each under `refs/ccrc-test/<run-id>/`. */
export type TestboxRef = 'head' | 'base' | 'snap' | 'history-base' | 'ledger-base';
export const TESTBOX_REF_MAP: Record<TestboxRef, true> = { head: true, base: true, snap: true, 'history-base': true, 'ledger-base': true };

/** The six tools whose versions the fleet host and the box compare (spec §2.4 row 4, §2.10), in the card's order. */
export type TestboxTool = 'node' | 'npm' | 'tmux' | 'git' | 'python3' | 'chrome';
export const TESTBOX_TOOL_MAP: Record<TestboxTool, true> = { node: true, npm: true, tmux: true, git: true, python3: true, chrome: true };
export const TESTBOX_TOOLS: readonly TestboxTool[] = Object.keys(TESTBOX_TOOL_MAP) as TestboxTool[];

/** The two output streams a `run.log` frame carries. */
export type TestboxStream = 'stdout' | 'stderr';
export const TESTBOX_STREAM_MAP: Record<TestboxStream, true> = { stdout: true, stderr: true };

/** Where a summarised run ran: on the box, or locally after a fallback. */
export type TestboxRanOn = 'test-box' | 'local';
export const TESTBOX_RAN_ON_MAP: Record<TestboxRanOn, true> = { 'test-box': true, local: true };

/** The summary's report word: `ok`, or why there is no report (spec §2.2: a missing, oversized or non-regular file). */
export type TestboxReport = 'ok' | 'missing' | 'oversized' | 'not-regular';
export const TESTBOX_REPORT_MAP: Record<TestboxReport, true> = { ok: true, missing: true, oversized: true, 'not-regular': true };

/** The tool sync's state in the status answer (spec §2.10). */
export type TestboxSyncState = 'idle' | 'syncing' | 'failed';
export const TESTBOX_SYNC_STATE_MAP: Record<TestboxSyncState, true> = { idle: true, syncing: true, failed: true };

/** The frame family's type words (spec §2.9). */
export type TestboxFrameType = 'run.submit' | 'run.log' | 'run.summary' | 'run.cancel' | 'tools.sync' | 'status';
export const TESTBOX_FRAME_TYPE_MAP: Record<TestboxFrameType, true> = {
  'run.submit': true, 'run.log': true, 'run.summary': true, 'run.cancel': true, 'tools.sync': true, status: true,
};

// ---------------------------------------------------------------------------------------------------------------
// The fallback reasons (spec §2.4), in the spec's order, plus the two waits (§2.4's drop, §2.8's queue wait).
// ---------------------------------------------------------------------------------------------------------------

export type TestboxFallbackId =
  | 'off' | 'not-set-up' | 'unreachable' | 'down' | 'version-differs' | 'protocol-differs' | 'queue-full'
  | 'snapshot-refused' | 'snapshot-too-large' | 'unmerged-paths' | 'runs-locally' | 'over-budget'
  | 'prepare-failed' | 'install-failed' | 'build-failed' | 'waited' | 'lost-run';
export const TESTBOX_FALLBACK_ID_MAP: Record<TestboxFallbackId, true> = {
  off: true, 'not-set-up': true, unreachable: true, down: true, 'version-differs': true, 'protocol-differs': true,
  'queue-full': true, 'snapshot-refused': true, 'snapshot-too-large': true, 'unmerged-paths': true,
  'runs-locally': true, 'over-budget': true, 'prepare-failed': true, 'install-failed': true, 'build-failed': true,
  waited: true, 'lost-run': true,
};
export const isTestboxFallbackId = (v: unknown): v is TestboxFallbackId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(TESTBOX_FALLBACK_ID_MAP, v);

/** One fallback row: its id, the check that must hold for a remote run, and the printed reason with its `<…>` holes. */
export interface TestboxFallbackRow { readonly id: TestboxFallbackId; readonly check: string; readonly text: string }

/** Spec §2.4's table as one list, in its order (its third row, unreachable or down, is two rows here, one per printed
 *  reason), then the two waits. The one source the wrapper's lines, the summary's `ran on: local (fallback: …)` and
 *  the card's grouping read. The last three table rows are checked on the box, in the prepare phase. */
export const TESTBOX_FALLBACK: readonly TestboxFallbackRow[] = [
  { id: 'off', check: 'the remote switch is on', text: 'test box: off' },
  { id: 'not-set-up', check: "the repository is in the test box's table", text: 'test box: this repository is not set up there' },
  { id: 'unreachable', check: 'the box answers its status call within the deadline (config, default 3 s) and is not `down`', text: 'test box: unreachable (<detail>)' },
  { id: 'down', check: 'the box answers its status call within the deadline (config, default 3 s) and is not `down`', text: 'test box: down (<reason>)' },
  { id: 'version-differs', check: "node major.minor, npm major, tmux major, git major, python3 major.minor and Chrome major match the fleet host's", text: 'test box: version differs (<name> <local> vs <remote>)' },
  { id: 'protocol-differs', check: "the service's protocol version is the wrapper's", text: 'test box: protocol differs (<local> vs <remote>)' },
  { id: 'queue-full', check: 'the queue is under its limit (config, default 20 waiting runs)', text: 'test box: queue full (<n> waiting)' },
  { id: 'snapshot-refused', check: 'the snapshot passes the deny list', text: 'test box: snapshot refused (<paths>)' },
  { id: 'snapshot-too-large', check: 'the snapshot is under its size caps', text: 'test box: snapshot too large (<path> <size>)' },
  { id: 'unmerged-paths', check: 'the index has no unmerged entries', text: 'test box: unmerged paths' },
  { id: 'runs-locally', check: 'the command is one the box runs (§2.5)', text: 'test box: <command> runs locally' },
  { id: 'over-budget', check: "the file set's estimated time is under the budget (§2.5)", text: 'test box: over budget (<estimate>)' },
  { id: 'prepare-failed', check: 'every git step of the checkout succeeds (§2.1)', text: 'test box: prepare failed (git <step>: <detail>)' },
  { id: 'install-failed', check: "every package's clone or `npm ci` succeeds (§2.2)", text: 'test box: install failed (<package>, exit <n>)' },
  { id: 'build-failed', check: 'every declared build output the local tree has builds (§2.2)', text: 'test box: build failed (<output>, exit <n>)' },
  { id: 'waited', check: 'a queued run starts within the queue wait (config, default 10 min) (§2.8)', text: 'test box: waited <n> min' },
  { id: 'lost-run', check: 'a dropped link reconnects within the reconnect deadline (config, default 60 s) (§2.4)', text: 'test box: lost the run' },
];

/** The fallbacks the box itself reports, in a summary's `prepareFailed`. */
export type TestboxPrepareFailure = 'prepare-failed' | 'install-failed' | 'build-failed';
export const TESTBOX_PREPARE_FAILURE_MAP: Record<TestboxPrepareFailure, true> = { 'prepare-failed': true, 'install-failed': true, 'build-failed': true };

// ---------------------------------------------------------------------------------------------------------------
// The runs log (D-7445): one line per wrapper call that reached the remote arm; the wrapper (TB8) is its one writer.
// ---------------------------------------------------------------------------------------------------------------

export type TestboxRunOutcome = 'remote' | 'fallback' | 'refused';
export const TESTBOX_RUN_OUTCOME_MAP: Record<TestboxRunOutcome, true> = { remote: true, fallback: true, refused: true };

/** The line's four tab-separated fields. `remote` carries `-` for the id; `fallback` and `refused` carry the row's
 *  `TestboxFallbackId`. A `refused` line's exit is the refusal status, 75; a `fallback` line's is the local run's. */
export const RUNS_LOG_LINE = '<UTC time, ISO 8601 to the second>\t<outcome>\t<TestboxFallbackId or ->\t<exit status>\n';
/** A line is at most this many bytes, its newline included. */
export const RUNS_LOG_LINE_MAX = 128;
/** The exit status of a refusal (spec §2.5, `EX_TEMPFAIL`). */
export const TESTBOX_REFUSAL_EXIT = 75;

export interface RunsLogRow {
  readonly at: string;
  readonly outcome: TestboxRunOutcome;
  readonly fallback: TestboxFallbackId | null;
  readonly exit: number;
}

const UTC_SECOND = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const EXIT_WORD = /^(?:0|[1-9]\d{0,2})$/;

const isUtcSecond = (s: string): boolean => {
  if (!UTC_SECOND.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString() === `${s.slice(0, 19)}.000Z`;
};

/** The format's ONE reader: a line (with or without its newline) read to its row, or `null` when any field is off. */
export function parseRunsLine(line: string): RunsLogRow | null {
  const body = line.endsWith('\n') ? line.slice(0, -1) : line;
  if (utf8Length(body) + 1 > RUNS_LOG_LINE_MAX) return null;
  if (/[\r\n]/.test(body)) return null;
  const f = body.split('\t');
  if (f.length !== 4) return null;
  const [at, outcome, id, exitWord] = f as [string, string, string, string];
  if (!isUtcSecond(at)) return null;
  if (!has(TESTBOX_RUN_OUTCOME_MAP, outcome)) return null;
  if (!EXIT_WORD.test(exitWord)) return null;
  const exit = Number(exitWord);
  if (exit > 255) return null;
  if (outcome === 'remote') {
    if (id !== '-') return null;
    return { at, outcome, fallback: null, exit };
  }
  if (!isTestboxFallbackId(id)) return null;
  if (outcome === 'refused' && exit !== TESTBOX_REFUSAL_EXIT) return null;
  return { at, outcome, fallback: id, exit };
}

// ---------------------------------------------------------------------------------------------------------------
// The version row (spec §2.4 row 4) and the card's cells (spec §2.10).
// ---------------------------------------------------------------------------------------------------------------

/** The six measured versions, normalised (`22.11.0`, not `v22.11.0`; tmux may end in a letter, `3.3a`). */
export type TestboxToolVersions = { readonly [K in TestboxTool]: string };

/** How many leading components of each tool's version the fallback row compares. */
const ROW_DEPTH: Readonly<Record<TestboxTool, number>> = { node: 2, npm: 1, tmux: 1, git: 1, python3: 2, chrome: 1 };

const VERSION = /^\d+(?:\.\d+)*[a-z]?$/;
const isVersion = (s: unknown): s is string => typeof s === 'string' && s.length <= 64 && VERSION.test(s);

/** One tool's difference, in the fallback's words `<name> <local> vs <remote>`. */
export interface TestboxVersionDiff { readonly tool: TestboxTool; readonly local: string; readonly remote: string }

const leading = (v: string, n: number): string | null =>
  isVersion(v) ? v.replace(/[a-z]$/, '').split('.').slice(0, n).join('.') : null;

/** The first tool, in `TESTBOX_TOOLS` order, whose difference reaches the fallback row, or `null`. A version that does
 *  not parse differs: the row fails toward a local run. */
export function versionRowDiffers(fleet: TestboxToolVersions, box: TestboxToolVersions): TestboxVersionDiff | null {
  for (const tool of TESTBOX_TOOLS) {
    const a = leading(fleet[tool], ROW_DEPTH[tool]);
    const b = leading(box[tool], ROW_DEPTH[tool]);
    if (a === null || b === null || a !== b) return { tool, local: fleet[tool], remote: box[tool] };
  }
  return null;
}

/** Every tool whose two cells differ at all (a node patch, an npm minor, a Chrome build included): the card marks
 *  each one. A difference that also reaches the row is listed too; one listed here alone keeps runs remote. */
export function versionCellsDiffer(fleet: TestboxToolVersions, box: TestboxToolVersions): TestboxTool[] {
  return TESTBOX_TOOLS.filter((t) => fleet[t] !== box[t]);
}

// ---------------------------------------------------------------------------------------------------------------
// The frames (spec §2.9; D-7428, D-7426 for the status answer's takeover fields).
// ---------------------------------------------------------------------------------------------------------------

export interface RunSubmit {
  readonly t: 'run.submit';
  /** 32 lowercase hex characters, drawn at random by the wrapper (spec §2.1). */
  readonly runId: string;
  readonly repository: string;
  readonly package: string;
  /** `null` when the session was detached. */
  readonly branch: string | null;
  /** The scratch refs pushed, each at most once; `head` always. */
  readonly refs: readonly TestboxRef[];
  /** The declared build outputs the local tree has (spec §2.2). */
  readonly outputs: readonly string[];
  readonly argv: readonly string[];
  /** The forwarded names and their values (a ref-valued name already resolved to a sha, spec §2.1). */
  readonly forward: Readonly<Record<string, string>>;
  readonly ci: boolean;
  readonly workers: number;
  readonly session: string;
}

export interface RunLog {
  readonly t: 'run.log';
  readonly runId: string;
  readonly offset: number;
  readonly stream: TestboxStream;
  /** The bytes, base64. */
  readonly bytes: string;
}

export interface TestboxPrepareFailed { readonly id: TestboxPrepareFailure; readonly text: string }

export interface RunSummary {
  readonly t: 'run.summary';
  readonly runId: string;
  readonly exit: number;
  readonly failed: { readonly files: readonly string[]; readonly tests: readonly string[] };
  readonly wallMs: number;
  readonly prepareMs: number;
  readonly logTail: readonly string[];
  readonly ranOn: TestboxRanOn;
  readonly workers: number;
  /** The count a local run of the same command would get, when it differs; else `null`. */
  readonly localDefault: number | null;
  /** The build outputs the prepare built on the box. */
  readonly builtOnBox: readonly string[];
  readonly report: TestboxReport;
  readonly prepareFailed: TestboxPrepareFailed | null;
}

export interface RunCancel { readonly t: 'run.cancel'; readonly runId: string }

export interface ToolsSync {
  readonly t: 'tools.sync';
  /** The fleet host's release tag as cut, `v0.0.830` (the leading `v` kept). */
  readonly release: string;
  readonly versions: TestboxToolVersions;
  /** UTC ISO 8601 to the second. */
  readonly measuredAt: string;
}

export interface TestboxPristine { readonly repository: string; readonly package: string; readonly key: string }
export interface TestboxFailedKey {
  readonly repository: string; readonly package: string; readonly key: string;
  readonly exit: number; readonly attempts: number; readonly nextAttempt: string;
}
export interface TestboxSync { readonly state: TestboxSyncState; readonly detail: string | null; readonly at: string | null }
export interface TestboxRepoName { readonly name: string; readonly mirrorPath: string }

export interface StatusAnswer {
  readonly t: 'status';
  readonly state: TestboxBoxState;
  /** Why `degraded` or `down`; `null` when `ok`. */
  readonly reason: string | null;
  readonly serviceVersion: string;
  readonly proto: number;
  /** The release tag the box's tools were installed from, the same shape as `ToolsSync.release`. */
  readonly release: string;
  readonly tools: TestboxToolVersions;
  readonly sync: TestboxSync;
  readonly runs: { readonly inProgress: number; readonly limit: number };
  readonly queueDepth: number;
  readonly pristine: readonly TestboxPristine[];
  readonly failedKeys: readonly TestboxFailedKey[];
  /** Run users held out of the pool by a failed cleanup (spec §2.2). */
  readonly heldRunUsers: readonly string[];
  readonly repositories: readonly TestboxRepoName[];
}

export type TestboxFrame = RunSubmit | RunLog | RunSummary | RunCancel | ToolsSync | StatusAnswer;

export type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------------------------------------------------------
// The checks the readers share. Each throws a `Refusal` with the field's path; the readers turn it into a reason.
// ---------------------------------------------------------------------------------------------------------------

// A declared field, not a parameter property: the PWA compiles this file under `erasableSyntaxOnly`.
class Refusal {
  readonly reason: string;
  constructor(reason: string) { this.reason = reason; }
}
const refuse = (at: string, why: string): never => { throw new Refusal(`${at}: ${why}`); };

function has<K extends string>(map: Record<K, true>, v: unknown): v is K {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v);
}

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

type Obj = Record<string, unknown>;

/** An object with exactly these keys: a missing key and an extra one are both refused. */
function exact(v: unknown, at: string, keys: readonly string[]): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return refuse(at, 'not an object');
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k)) refuse(at, `extra field ${k}`);
  for (const k of keys) if (!Object.prototype.hasOwnProperty.call(o, k)) refuse(at, `missing field ${k}`);
  return o;
}

const CONTROL = /[\u0000-\u001f\u007f]/;
function text(v: unknown, at: string, max = 4096): string {
  if (typeof v !== 'string' || v.length === 0) return refuse(at, 'not a non-empty string');
  if (v.length > max) return refuse(at, `longer than ${max}`);
  if (CONTROL.test(v)) return refuse(at, 'holds a control character');
  return v;
}
const textOrNull = (v: unknown, at: string): string | null => (v === null ? null : text(v, at));
/** A log line may be empty. */
function line(v: unknown, at: string): string {
  if (typeof v !== 'string' || v.length > 4096 || /[\n\r]/.test(v)) return refuse(at, 'not one line');
  return v;
}
function int(v: unknown, at: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return refuse(at, `not an integer in ${min}..${max}`);
  return v;
}
function bool(v: unknown, at: string): boolean {
  if (typeof v !== 'boolean') return refuse(at, 'not a boolean');
  return v;
}
function list<T>(v: unknown, at: string, each: (x: unknown, at: string) => T, opts: { min?: number; unique?: boolean } = {}): T[] {
  if (!Array.isArray(v)) return refuse(at, 'not a list');
  if (v.length < (opts.min ?? 0)) refuse(at, `fewer than ${opts.min} entries`);
  if (v.length > 4096) refuse(at, 'more than 4096 entries');
  const out = v.map((x, i) => each(x, `${at}[${i}]`));
  if (opts.unique) {
    const seen = new Set<string>();
    out.forEach((x, i) => { const k = JSON.stringify(x); if (seen.has(k)) refuse(`${at}[${i}]`, 'duplicate'); seen.add(k); });
  }
  return out;
}
function word<K extends string>(map: Record<K, true>, v: unknown, at: string): K {
  if (!has(map, v)) return refuse(at, `not one of ${Object.keys(map).join(', ')}`);
  return v;
}

const RUN_ID = /^[0-9a-f]{32}$/;
const runId = (v: unknown, at: string): string => (typeof v === 'string' && RUN_ID.test(v) ? v : refuse(at, 'not 32 lowercase hex characters'));
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const name = (v: unknown, at: string): string => (typeof v === 'string' && NAME.test(v) ? v : refuse(at, 'not a lowercase name'));
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const version = (v: unknown, at: string): string => (isVersion(v) ? v : refuse(at, 'not a version'));
/** The fleet host's release tag, as the release lane cuts it and the tools sync passes it on (deploy/release-artifact.sh's
 *  SHAPE, spelled once in shared/api.ts): `v<major>.<minor>.<patch>`, the leading `v` kept. A tool version's reader would refuse that `v`. */
const releaseTag = (v: unknown, at: string): string =>
  (isReleaseTag(v) && v.length <= 64 ? v : refuse(at, 'not a release tag'));
const utc = (v: unknown, at: string): string => (typeof v === 'string' && isUtcSecond(v) ? v : refuse(at, 'not a UTC time to the second'));

/** A relative path inside the repository: no leading `/`, no `.` or `..` segment, no empty segment. */
function relPath(v: unknown, at: string): string {
  const s = text(v, at, 1024);
  if (s.startsWith('/') || s.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) refuse(at, 'not a relative path inside the repository');
  return s;
}
/** An absolute path with no `.` or `..` segment. */
function absPath(v: unknown, at: string): string {
  const s = text(v, at, 1024);
  if (!s.startsWith('/') || s.slice(1).split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) refuse(at, 'not an absolute path');
  return s;
}

function tools(v: unknown, at: string): TestboxToolVersions {
  const o = exact(v, at, TESTBOX_TOOLS);
  const out = {} as Record<TestboxTool, string>;
  for (const t of TESTBOX_TOOLS) out[t] = version(o[t], `${at}.${t}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The frame readers.
// ---------------------------------------------------------------------------------------------------------------

function readRunSubmit(o: Obj): RunSubmit {
  const f = exact(o, 'run.submit', ['t', 'runId', 'repository', 'package', 'branch', 'refs', 'outputs', 'argv', 'forward', 'ci', 'workers', 'session']);
  const refs = list(f.refs, 'refs', (x, at) => word(TESTBOX_REF_MAP, x, at), { unique: true });
  if (!refs.includes('head')) refuse('refs', 'no head');
  const fwd = f.forward;
  if (typeof fwd !== 'object' || fwd === null || Array.isArray(fwd)) refuse('forward', 'not an object');
  const forward: Record<string, string> = {};
  for (const [k, val] of Object.entries(fwd as Obj)) {
    if (!ENV_NAME.test(k)) refuse(`forward.${k}`, 'not an environment name');
    if (typeof val !== 'string' || val.length > 4096 || CONTROL.test(val)) refuse(`forward.${k}`, 'not a value');
    forward[k] = val as string;
  }
  return {
    t: 'run.submit', runId: runId(f.runId, 'runId'), repository: name(f.repository, 'repository'), package: name(f.package, 'package'),
    branch: textOrNull(f.branch, 'branch'), refs, outputs: list(f.outputs, 'outputs', relPath, { unique: true }),
    argv: list(f.argv, 'argv', (x, at) => text(x, at), { min: 1 }), forward, ci: bool(f.ci, 'ci'),
    workers: int(f.workers, 'workers', 1, 256), session: text(f.session, 'session', 256),
  };
}

function readRunLog(o: Obj): RunLog {
  const f = exact(o, 'run.log', ['t', 'runId', 'offset', 'stream', 'bytes']);
  if (typeof f.bytes !== 'string' || !BASE64.test(f.bytes)) refuse('bytes', 'not base64');
  return { t: 'run.log', runId: runId(f.runId, 'runId'), offset: int(f.offset, 'offset', 0), stream: word(TESTBOX_STREAM_MAP, f.stream, 'stream'), bytes: f.bytes as string };
}

function readRunSummary(o: Obj): RunSummary {
  const f = exact(o, 'run.summary', ['t', 'runId', 'exit', 'failed', 'wallMs', 'prepareMs', 'logTail', 'ranOn', 'workers', 'localDefault', 'builtOnBox', 'report', 'prepareFailed']);
  const failed = exact(f.failed, 'failed', ['files', 'tests']);
  let prepareFailed: TestboxPrepareFailed | null = null;
  if (f.prepareFailed !== null) {
    const p = exact(f.prepareFailed, 'prepareFailed', ['id', 'text']);
    prepareFailed = { id: word(TESTBOX_PREPARE_FAILURE_MAP, p.id, 'prepareFailed.id'), text: text(p.text, 'prepareFailed.text') };
  }
  return {
    t: 'run.summary', runId: runId(f.runId, 'runId'), exit: int(f.exit, 'exit', 0, 255),
    failed: { files: list(failed.files, 'failed.files', (x, at) => text(x, at)), tests: list(failed.tests, 'failed.tests', (x, at) => text(x, at)) },
    wallMs: int(f.wallMs, 'wallMs', 0), prepareMs: int(f.prepareMs, 'prepareMs', 0), logTail: list(f.logTail, 'logTail', line),
    ranOn: word(TESTBOX_RAN_ON_MAP, f.ranOn, 'ranOn'), workers: int(f.workers, 'workers', 1, 256),
    localDefault: f.localDefault === null ? null : int(f.localDefault, 'localDefault', 1, 256),
    builtOnBox: list(f.builtOnBox, 'builtOnBox', relPath, { unique: true }), report: word(TESTBOX_REPORT_MAP, f.report, 'report'), prepareFailed,
  };
}

function readRunCancel(o: Obj): RunCancel {
  const f = exact(o, 'run.cancel', ['t', 'runId']);
  return { t: 'run.cancel', runId: runId(f.runId, 'runId') };
}

function readToolsSync(o: Obj): ToolsSync {
  const f = exact(o, 'tools.sync', ['t', 'release', 'versions', 'measuredAt']);
  return { t: 'tools.sync', release: releaseTag(f.release, 'release'), versions: tools(f.versions, 'versions'), measuredAt: utc(f.measuredAt, 'measuredAt') };
}

function readStatusAnswer(o: Obj): StatusAnswer {
  const f = exact(o, 'status', ['t', 'state', 'reason', 'serviceVersion', 'proto', 'release', 'tools', 'sync', 'runs', 'queueDepth', 'pristine', 'failedKeys', 'heldRunUsers', 'repositories']);
  const state = word(TESTBOX_BOX_STATE_MAP, f.state, 'state');
  const reason = textOrNull(f.reason, 'reason');
  if ((state === 'ok') !== (reason === null)) refuse('reason', state === 'ok' ? 'present on an ok answer' : `missing on a ${state} answer`);
  const sync = exact(f.sync, 'sync', ['state', 'detail', 'at']);
  const runs = exact(f.runs, 'runs', ['inProgress', 'limit']);
  const limit = int(runs.limit, 'runs.limit', 1, 256);
  const pristine = list(f.pristine, 'pristine', (x, at) => {
    const p = exact(x, at, ['repository', 'package', 'key']);
    return { repository: name(p.repository, `${at}.repository`), package: name(p.package, `${at}.package`), key: text(p.key, `${at}.key`, 128) };
  }, { unique: true });
  const failedKeys = list(f.failedKeys, 'failedKeys', (x, at) => {
    const p = exact(x, at, ['repository', 'package', 'key', 'exit', 'attempts', 'nextAttempt']);
    return {
      repository: name(p.repository, `${at}.repository`), package: name(p.package, `${at}.package`), key: text(p.key, `${at}.key`, 128),
      exit: int(p.exit, `${at}.exit`, 0, 255), attempts: int(p.attempts, `${at}.attempts`, 1), nextAttempt: utc(p.nextAttempt, `${at}.nextAttempt`),
    };
  });
  const repositories = list(f.repositories, 'repositories', (x, at) => {
    const p = exact(x, at, ['name', 'mirrorPath']);
    return { name: name(p.name, `${at}.name`), mirrorPath: absPath(p.mirrorPath, `${at}.mirrorPath`) };
  }, { unique: true });
  return {
    t: 'status', state, reason, serviceVersion: version(f.serviceVersion, 'serviceVersion'), proto: int(f.proto, 'proto', 1),
    release: releaseTag(f.release, 'release'), tools: tools(f.tools, 'tools'),
    sync: { state: word(TESTBOX_SYNC_STATE_MAP, sync.state, 'sync.state'), detail: textOrNull(sync.detail, 'sync.detail'), at: sync.at === null ? null : utc(sync.at, 'sync.at') },
    runs: { inProgress: int(runs.inProgress, 'runs.inProgress', 0, limit), limit }, queueDepth: int(f.queueDepth, 'queueDepth', 0),
    pristine, failedKeys, heldRunUsers: list(f.heldRunUsers, 'heldRunUsers', name, { unique: true }), repositories,
  };
}

const FRAME_READERS: { readonly [K in TestboxFrameType]: (o: Obj) => TestboxFrame } = {
  'run.submit': readRunSubmit, 'run.log': readRunLog, 'run.summary': readRunSummary, 'run.cancel': readRunCancel,
  'tools.sync': readToolsSync, status: readStatusAnswer,
};

/** The frames' ONE reader: a frame's JSON text to its typed frame, or the reason it is refused. Every field is checked
 *  and a field the frame does not name is refused, so nothing is half-read. */
export function readTestboxFrame(json: string): Read<TestboxFrame> {
  let v: unknown;
  try { v = JSON.parse(json); } catch { return { ok: false, reason: 'not JSON' }; }
  try {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return refuse('frame', 'not an object');
    const t = (v as Obj).t;
    if (!has(TESTBOX_FRAME_TYPE_MAP, t)) return refuse('t', 'not a test box frame type');
    return { ok: true, value: FRAME_READERS[t](v as Obj) };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, reason: e.reason };
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The repository row (spec §2.6), one file of the box's repository table.
// ---------------------------------------------------------------------------------------------------------------

export interface TestboxRepoPackage {
  readonly name: string;
  /** The files whose sha256 is the package's install key (its `package.json` and `package-lock.json`, plus any the
   *  row adds), relative to the repository root. */
  readonly installInputs: readonly string[];
  /** The command heads the box runs in this package (spec §2.5). */
  readonly commands: readonly string[];
}
export interface TestboxBuildOutput {
  /** The output's path, relative to the repository root. */
  readonly path: string;
  /** The package whose directory the build command runs in. */
  readonly package: string;
  /** The build command, as argv. */
  readonly build: readonly string[];
}
export interface TestboxRepoRow {
  readonly name: string;
  readonly fetchUrl: string;
  readonly mirrorPath: string;
  /** In install order. */
  readonly packages: readonly TestboxRepoPackage[];
  readonly buildOutputs: readonly TestboxBuildOutput[];
  readonly systemTools: readonly string[];
}

const FETCH_URL = /^(?:https|ssh):\/\/[^\s@/]+(?:@[^\s/]+)?\/[^\s]+$/;

/** A repository row's JSON text to the row, or the reason it is refused. Every field is checked, an unknown one is
 *  refused, and a package, output or tool named twice is refused; a build output must name a listed package. */
export function parseRepoRow(json: string): Read<TestboxRepoRow> {
  let v: unknown;
  try { v = JSON.parse(json); } catch { return { ok: false, reason: 'not JSON' }; }
  try {
    const o = exact(v, 'row', ['name', 'fetchUrl', 'mirrorPath', 'packages', 'buildOutputs', 'systemTools']);
    const fetchUrl = text(o.fetchUrl, 'fetchUrl', 1024);
    if (!FETCH_URL.test(fetchUrl)) refuse('fetchUrl', 'not an https or ssh URL');
    const packages = list(o.packages, 'packages', (x, at) => {
      const p = exact(x, at, ['name', 'installInputs', 'commands']);
      return {
        name: name(p.name, `${at}.name`),
        installInputs: list(p.installInputs, `${at}.installInputs`, relPath, { min: 1, unique: true }),
        commands: list(p.commands, `${at}.commands`, (c, cat) => {
          const s = text(c, cat, 256);
          if (s !== s.trim() || /\s{2}/.test(s)) refuse(cat, 'not a single-spaced command head');
          return s;
        }, { min: 1, unique: true }),
      };
    }, { min: 1 });
    const names = packages.map((p) => p.name);
    names.forEach((n, i) => { if (names.indexOf(n) !== i) refuse(`packages[${i}].name`, 'duplicate'); });
    const buildOutputs = list(o.buildOutputs, 'buildOutputs', (x, at) => {
      const b = exact(x, at, ['path', 'package', 'build']);
      const pkg = name(b.package, `${at}.package`);
      if (!names.includes(pkg)) refuse(`${at}.package`, 'not a listed package');
      return { path: relPath(b.path, `${at}.path`), package: pkg, build: list(b.build, `${at}.build`, (c, cat) => text(c, cat, 256), { min: 1 }) };
    });
    const paths = buildOutputs.map((b) => b.path);
    paths.forEach((p, i) => { if (paths.indexOf(p) !== i) refuse(`buildOutputs[${i}].path`, 'duplicate'); });
    return {
      ok: true,
      value: {
        name: name(o.name, 'name'), fetchUrl, mirrorPath: absPath(o.mirrorPath, 'mirrorPath'), packages, buildOutputs,
        systemTools: list(o.systemTools, 'systemTools', name, { unique: true }),
      },
    };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, reason: e.reason };
    throw e;
  }
}
