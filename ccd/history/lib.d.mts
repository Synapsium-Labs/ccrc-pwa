// ccd/history/lib.d.mts — types for the vitest import of lib.mjs (the
// `compact-card.d.mts` / `shared/mark.d.mts` precedent). Hand-written; grows
// with each task. Nothing machine-checks it against lib.mjs, so an export
// added there is declared here in the same commit. Never named by an
// installer line: `_inst_tree` carries it into ~/ccrc/ccd/history/ harmlessly.
// Each name is declared ONCE. A second declaration is a duplicate (TS2300 for
// a type alias), and tsc never reports it here (server/tsconfig.json's
// `skipLibCheck` skips every .d.mts), so a later task reuses the types below
// and never declares one of them again.
export const EXIT: Readonly<{
  OK: 0; INTERNAL: 1; REFUSED: 2; NOT_FOUND: 3; WRITER_BUSY: 4; DB: 5;
  NOT_INDEXED: 6; FTS_UNAVAILABLE: 7; RECALL_OFF: 8; NO_STORE: 9;
}>;
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const REASONS: Readonly<Record<string, 2 | 4 | 5 | 7>>;
export const REFUSALS: readonly string[];
export interface WritingForm { readonly op: string; readonly irreversible: boolean; readonly binding: boolean }
export const WRITING_FORMS: Readonly<Record<string, WritingForm>>;

export const STORE_DB_REL: '.ccrc/history/db';
export const HISTORY_ROOT_REL: string;
export const STORE_DB_FILE: 'history.db';
export const STORE_FILES: readonly string[];
export const SWITCHES: Readonly<{
  off: string; maxGb: string; steerOff: string; steerLivePrefix: string; steerOnDir: string; headlessOn: string;
}>;

export const SPOOL_LINE_MAX: number;
export const SPOOL_FILE_MAX: number;
export const SPOOL_FILE_LINES_MAX: number;
export const SPOOL_ID_MAX: number;
export const STATFS_DEADLINE_MS: number;
export const CLI_STAT_DEADLINE_MS: number;
export const TMUX_DEADLINE_MS: number;
export const REPARSE_MAX_TARGETS: number;
export const CARRIER_KILL_S: number;
export const EXPORT_MARGIN_DAYS: number;
export const LINE_MAX: number;
export const JSON_DEPTH_MAX: number;
export const JSON_NODES_MAX: number;
export const CHUNK_BYTES: number;
export const RUN_BUDGET_MS: number;
export const RUN_BUDGET_BYTES: number;
export const REDERIVE_SLICE_MS: number;
export const REDERIVE_SLICE_BYTES: number;
export const CAP_DEFAULT_GB: number;
export const CAP_WARN_PCT: number;
export const FLOOR_GIB: number;
export const FLOOR_PCT: number;
export const EPOCH_CONFIRM_WINDOW_MS: number;
export const SCAN_INTERVAL_MS: number;
export const SIDECAR_FTS_BYTES: number;
export const SIDECAR_REDACT_MARGIN: number;
export function sidecarIndexText(bytes: Uint8Array, idx: PairIndex | null): string;
export const INDEX_UNESCAPE_PASSES: number;
export function redactForIndex(text: string, idx: PairIndex): string;
export const SECRET_MIN_LEN: number;
export const SECRET_SEGMENT_MIN: number;
export const DEFAULT_COPY_BPS: number;
export const MAX_INTERRUPTED_ATTEMPTS: number;
export const SCHEMA_VERSION: number;
export const BUSY_TIMEOUT_MS: number;
export const SHIM_GRACE_MS: number;
export const TICK_STALE_MS: number;
export const LAG_FAIL_MS: number;
export const RECOVERY_STALL_TICKS: number;
export const CATCHING_UP_TICKS: number;
export const JOURNAL_GROWTH_BYTES: number;
export const UUID_RE: RegExp;
export const WRITER_RE: RegExp;

export const NODE_KINDS: readonly ['steered_leaf', 'native_leaf', 'raw_leaf', 'condensed'];
export const PARSE_STATUS: readonly ['ok', 'degraded', 'invalid', 'absent', 'not-requested'];
export const ENTRY_PARSE_STATES: readonly ['ok', 'raw-only'];
export type Provenance = 'operator' | 'model' | 'tool' | 'summary' | 'harness' | 'ccrc-injected' | 'recall-echo';
export const PROVENANCE: readonly Provenance[];
export const SEARCHABLE_PROVENANCE: readonly Provenance[];
export type SpoolEvent = 'Stop' | 'PostCompact' | 'SessionStart' | 'recall' | 'steer';
export const SPOOL_EVENTS: readonly SpoolEvent[];
export type SpoolSource = 'startup' | 'resume' | 'clear';
export const SPOOL_SOURCES: readonly SpoolSource[];
export type EpochCause = 'startup' | 'resume' | 'clear' | 'import' | 'fork';
export const EPOCH_CAUSES: readonly EpochCause[];
export type DeclaredBy = 'hook' | 'registry' | 'journal' | 'operator';
export const DECLARED_BY: readonly DeclaredBy[];
export const ERROR_CODES: readonly string[];
export const CARD_PREFIX: 'History: ';
export const COVERAGE: readonly ['this-box'];
export const SCOPE_SOURCES: readonly ['tmux'];
export const VARIANT_CAUSES: readonly ['ccd-sanitize', 'unknown'];
export type Backend = 'anthropic' | 'other' | 'unknown';
export const BACKENDS: readonly Backend[];
export type JournalKind = 'head' | 'file' | 'spool' | 'verdict' | 'redact' | 'tick';
export const JOURNAL_KINDS: readonly JournalKind[];
export type JournalVerdict = 'family' | 'epoch-confirmed' | 'epoch-unconfirmed' | 'epoch-chained'
  | 'generation-joined' | 'rekeyed' | 'mapping' | 'bind' | 'drained';
export const JOURNAL_VERDICTS: readonly JournalVerdict[];
export type BindKind = 'adopt' | 'restore' | 'rebuild';
export const BIND_KINDS: readonly BindKind[];
export type MigrationVerdict = 'none' | 'refuse-newer' | 'refuse-low-disk' | 'snapshot-needs-op' | 'snapshot-then-migrate';
export const MIGRATION_VERDICTS: readonly MigrationVerdict[];
export const PASS_WORDS: readonly string[];
export type HealthClass = 'pass' | 'warn' | 'fail';
export const HEALTH_WORDS: Readonly<Record<string, HealthClass>>;

export function idOk(id: unknown): boolean;
export function readBoxEnvValue(text: string, key: string): { found: boolean; value: string };
export interface HistoryPaths {
  readonly root: string; readonly spool: string; readonly draining: string; readonly journalDir: string;
  readonly dbDir: string; readonly dbFile: string; readonly wal: string; readonly shm: string;
  /** SQLite's rollback journal beside the DB (`history.db-journal`), not the history journal. */
  readonly journalFile: string;
  readonly backups: string; readonly storeId: string; readonly pending: string; readonly writer: string;
  readonly op: string; readonly lock: string; readonly off: string; readonly cap: string;
  readonly ccrcEnv: string; readonly accountsSh: string; readonly reg: string; readonly shim: string;
}
export function historyPaths(home: string): HistoryPaths;

export function canonicalJson(value: unknown): string;
export function jsonWithinStructureBound(bytes: Uint8Array): boolean;
export function sha256Bytes(data: string | Uint8Array): Buffer;
export function sha256Hex(data: string | Uint8Array): string;
export function digestText(prefix: string, parts: readonly string[]): string;
export function leafId(ccrcId: string, ccUuid: string, spanStartUuid: string, boundaryUuid?: string): string;
export function parentId(childIds: readonly string[]): string;
export function eventKey(drainingFileName: string, ordinal: number): string;
export function blobShaOfBody(body: unknown): Buffer;
export function blobShaOfBytes(bytes: Uint8Array): Buffer;

export interface SpoolKeySet { readonly required: readonly string[]; readonly optional: readonly string[] }
export const SPOOL_KEYS: Readonly<Record<SpoolEvent, SpoolKeySet>>;
/** A parsed spool line: `v` is 1, `ev` a SPOOL_EVENTS member, `id` passes idOk,
 *  and only its event's declared keys are present. */
export interface SpoolRecord {
  readonly v: 1; readonly ev: SpoolEvent; readonly id: string;
  readonly sid?: string; readonly src?: SpoolSource; readonly reg?: string; readonly trig?: 'manual' | 'auto';
  readonly gen?: string; readonly ts?: number; readonly cmd?: string; readonly rc?: number; readonly ms?: number;
  readonly arm?: string; readonly leaf?: string;
}
export type SpoolReject = 'too-long' | 'json' | 'not-object' | 'keys' | 'value' | 'bad-id';
export function splitSpoolText(text: string): Array<{ ordinal: number; raw: string }>;
export function spoolLineCount(bytes: Uint8Array): number;
export function spoolLinesOverCap(bytes: Uint8Array): boolean;
export function parseSpoolLine(raw: string): { ok: true; rec: SpoolRecord } | { ok: false; why: SpoolReject };

export const JOURNAL_V: 1;
export type ConfirmBy = 'reg' | 'observed' | 'held-match' | 'later-tick' | 'location';
export const CONFIRM_BY: readonly ConfirmBy[];
export type GenerationVia = 'line' | 'registry' | 'absent' | 'unreadable';
export const GENERATION_VIA: readonly GenerationVia[];
export const DRAINING_NAME_MAX: 253;
export function drainingNameOk(name: unknown): boolean;
/** A record's own fields — everything but `v`, `k` and `t`. */
export type JournalFields = Readonly<Record<string, unknown>>;
export interface JournalRecord { readonly v: 1; readonly k: JournalKind; readonly t: number; readonly [field: string]: unknown }
export type JournalRead =
  | { kind: 'record'; rec: JournalRecord }
  | { kind: 'malformed' } | { kind: 'unknown' } | { kind: 'newer' };
export function parseJournalRecord(line: string): JournalRead;
export function journalRecord(kind: JournalKind, t: number, fields: JournalFields): string;

// --- Task 6: planners and gates (spec §5.3, §6.2, §6.9, §6.11, §8.3, §8.4, §9.2, §9.3)
export type Presence<T> = { state: 'absent' } | { state: 'unreadable' } | { state: 'value'; value: T };
export type DbDirState = 'dir' | 'absent' | 'dangling' | 'unmeasured';
export type DbFileState = 'present' | 'absent' | 'zero-byte' | 'unmeasured';
export interface StoreFacts {
  role: string; dbDir: DbDirState; storeId: Presence<string>; pending: Presence<string>; writer: Presence<string>;
  db: DbFileState; dbStoreId: Presence<string>; wal: boolean; shm: boolean;
  journalStoreDirs: readonly string[]; backupsDb: readonly string[];
}
export type StoreOpenVerdict =
  | { act: 'create' } | { act: 'open' } | { act: 'finish-pending' } | { act: 'drop-pending-create' }
  | { act: 'refuse'; word: string };
export function decideStoreOpen(f: StoreFacts): StoreOpenVerdict;
export interface CliStoreFacts {
  darwin: boolean; role: string; statSettled: boolean; dbDir: DbDirState; shim: 'present' | 'absent' | 'unmeasured';
  storeId: Presence<string>; pending: Presence<string>; writer: Presence<string>; db: DbFileState; dbStoreId: Presence<string>;
  wal: boolean; shm: boolean; journalStoreDirs: readonly string[]; backupsDb: readonly string[];
}
export interface CliStoreVerdict { exit: number; reason?: string; read: boolean }
export function decideCliStore(f: CliStoreFacts): CliStoreVerdict;
export interface StatusReadFacts { userVersion: number; journalMode: string; recordedMigration: string | undefined }
export interface StatusReadVerdict { exit: number; reason?: string; migration: MigrationVerdict }
export function decideStatusRead(f: StatusReadFacts): StatusReadVerdict;
export function planCopy(i: { freeBytes: number; thresholdBytes: number; sizeBytes: number }): { admit: boolean; needBytes: number | null };
export function floorThreshold(fsSizeBytes: number, runBudgetBytes?: number): number;
export function capOf(text: string | null): { gb: number; malformed: boolean };
export function capBytes(gb: number): number;
export interface MigrationInputs {
  stored: number; code: number; freeBytes: number; thresholdBytes: number; sizeBytes: number;
  boundS: number | null; copyBps: number | null; attempts: number; heavy: boolean;
}
export function planMigration(i: MigrationInputs): MigrationVerdict;
export function withinBudget(i: { elapsedMs: number; bytes: number; maxMs?: number; maxBytes?: number }): boolean;
export type FreeProbe = { state: 'ok'; bytes: number; fsSize: number } | { state: 'unsettled' } | { state: 'threw' };
export interface RunInputs {
  historyOff: boolean; store: StoreOpenVerdict; free: FreeProbe; sizeBytes: number; capGb: number;
  migration: MigrationVerdict; recovering: boolean;
}
export interface RunPlan {
  arm: 'off' | 'hold' | 'migrate' | 'recover' | 'run'; holdWord: string | null;
  drain: boolean; ingest: boolean; pause: null | 'at-cap' | 'low-disk';
}
export function planRun(i: RunInputs): RunPlan;
export interface CursorRow { transcriptUuid: string; birthNs: number | bigint | null; headSha: string | null; offset: number; tailSha: string | null }
export interface FileReadInputs {
  row: CursorRow | null; stat: { size: number; birthNs: number | bigint | null } | null;
  pathUuid: string; headSha: string | null; tailShaAtOffset: string | null;
}
export function planFileRead(i: FileReadInputs): 'resume' | 'rescan' | 'retire' | 'skip';
export const UNKNOWN_OP_FORM: 'unknown-op';
export function formOf(op: string, args: readonly string[]): string | null;
export type OpGateReason = 'bad-args' | 'apply-in-session' | 'needs-tty' | 'irreversible-in-pane' | 'history-off';
export function decideOpGate(form: string | null, env: { claudecode: boolean; historyOff: boolean }, isTTY: boolean, paneName: string | null):
  { ok: true } | { ok: false; rc: 2; reason: OpGateReason };

// --- Task 7: epochs and families (spec §6.1, §9.2 step 1, §9.14 Holds)
export interface Observation {
  v: 1; observedMs: number;
  uuid: Presence<string>; generation: Presence<string>; project: Presence<string>; workdir: Presence<string>;
  journaled: null | { t: number; storeId: string; writer: string };
  heldMatches: Record<string, number>;
}
export function joinGeneration(i: { lineGen: string | null; observedGen: Presence<string> }):
  { generation: string; via: 'line' | 'registry' | 'absent' | 'unreadable' };
export type EpochLineVerdict =
  | { kind: 'confirm'; by: 'reg' | 'observed' | 'held-match' }
  | { kind: 'candidate' }
  | { kind: 'chain'; confirmedBy: 'observed' | 'held-match' | null };
export function decideEpochLine(line: { src: 'startup' | 'resume' | 'clear'; sid: string; reg?: string }, obs: Observation): EpochLineVerdict;
export function decideCandidate(i: {
  sid: string; journaledMs: number; nowMs: number; currentUuid: Presence<string>; supersededByLaterClearOfSameId: boolean;
}): { kind: 'confirm'; by: 'later-tick' } | { kind: 'wait' } | { kind: 'drop'; superseded: boolean };
export function locationMatches(i: { cwd: string | null; cwdReal: string | null; workdir: Presence<string>; workdirReal: string | null }): boolean;
export function decideRekey(i: { observedGeneration: string; uuid: string; emptyFamilyUuids: ReadonlySet<string> }): 'merge' | 'none';

// --- Task 8: row extraction (spec §2, §6.1, §6.2)
export function isStoredRow(row: unknown): boolean;
export function uuidlessTypeOf(row: unknown): string;
export function blobBodyOf(row: Record<string, unknown>): unknown;
export interface EntryColumns {
  uuid: string; type: string; subtype: string | null; role: string | null; model: string | null;
  parentUuid: string | null; tsMs: number | null; requestId: string | null; apiBlockIndex: number | null;
  msgId: string | null; sourceToolUseId: string | null; toolName: string | null; isCompactSummary: 0 | 1;
}
export function entryOf(row: Record<string, unknown>, ctx?: { apiBlockIndex?: number | null }): EntryColumns;
export interface BoundaryFacts {
  trigger: string | null; headUuid: string | null; anchorUuid: string | null; tailUuid: string | null;
  allUuids: string[] | null; preTokens: number | null; postTokens: number | null; durationMs: number | null;
  missing: string[];
}
export function boundaryOf(row: unknown): BoundaryFacts | null;
export function isHistoryCommand(command: string): boolean;
export function provenanceOf(row: Record<string, unknown>, ctx: { pairedToolUse: null | { name: string; command?: string } }): Provenance;
export function ftsTextOf(body: unknown, kind: 'entry' | 'sidecar'): string;
export function variantCauseOf(a: unknown, b: unknown): 'ccd-sanitize' | 'unknown';
export function backendOf(model: string | null | undefined): Backend;
export function producerOf(modelsAfterSummary: readonly (string | null)[]): Backend;
export function producerOfCopy(rows: readonly { type: string; model: string | null }[], summaryIndex: number): Backend;

// --- Task 9: redaction (spec §8.3)
export interface SecretSource { readonly glob?: string; readonly path?: string; readonly identifierKeysOnly?: true; readonly sessionHashes?: true }
export const SECRET_SOURCES: readonly SecretSource[];
export function kindOfPath(p: string): 'token' | 'json' | 'env';
export const IDENTIFIER_RE: RegExp;
export const SECRET_SHAPE_RES: readonly RegExp[];
export const REDACTED_MARK: '[redacted]';
export function extractSecretValues(text: string, kind: 'env' | 'env-identifier' | 'token' | 'json'): string[];
export interface SecretPair { len: number; sha256: string }
export function secretPairs(values: readonly string[]): { pairs: SecretPair[]; unsegmentable: number };
export function secretUnits(value: string): string[];
export function sessionHashPairs(jsonText: string): SecretPair[];
export interface PairIndex { readonly byLen: ReadonlyMap<number, { has(sha256: string): boolean }> }
export function makePairIndex(pairs: Iterable<SecretPair>): PairIndex;
export interface RankedPair extends SecretPair { readonly rid: number }
export interface ProbeIndex extends PairIndex { readonly probe: { hits: number } }
export function makeProbeIndex(pairs: Iterable<RankedPair>, mark: number): ProbeIndex;
export interface RederiveState { target: number; cursor: number; end: number }
export function parseRederiveState(text: string | undefined): RederiveState | null;
export function formatRederiveState(s: RederiveState): string;
export function rederivePlan(mark: number, top: number, maxBlobId: number, state: RederiveState | null): RederiveState | null;
export function redactField(text: string, idx: PairIndex): string;
export function redactFinal(text: string, idx: PairIndex): string;
// --- Task 10: harness table and the export's horizon (spec §6.10 item 3, §9.15)
export type Readable = { state: 'absent' } | { state: 'unreadable' } | { state: 'text'; text: string };
export const CLAUDE_CODE_DEFAULT_RETENTION_DAYS: 30;
export interface Retention { days: number; state: 'measured' | 'default' | 'unmeasured' }
export function claudeCodeRetention(i: { home: Readable; managed: readonly Readable[]; lastDays: number | null }): Retention;
export const HARNESS_TABLE: Readonly<{ 'claude-code': Readonly<{ retention: typeof claudeCodeRetention }> }>;
export const HARNESSES: readonly string[];
export function shortestRetention(homeRetentionDays: Readonly<Record<string, number>>): number;
export interface ExportFile { home: string; mtimeMs: number; present: boolean }
export interface ExportCandidate { tsMs: number | null; files: readonly ExportFile[] }
export type ExportReducer = (candidate: ExportCandidate, homeRetentionDays: Readonly<Record<string, number>>) => number;
export const EXPORT_REDUCERS: Readonly<{ shortestHome: ExportReducer }>;
export function exportHorizonDays(retentionDays: number): number;
export function planExport(i: {
  nowMs: number; homeRetentionDays: Readonly<Record<string, number>>;
  blobs: readonly { key: string; referrers: readonly ExportCandidate[] }[]; reducer?: ExportReducer;
}): { horizonDays: number; due: string[]; overdue: string[] };
export function exportDates(i: {
  homeRetentionDays: Readonly<Record<string, number>>; oldestRowMs: number | null; files: readonly ExportFile[];
}): { firstDueMs: number | null; firstDeletionMs: number | null };
export function retentionLowered(homeRetentionDays: Readonly<Record<string, number>>): null | { home: string; days: number; othersMin: number };

export interface SchemaVersionAdded { readonly heavy: boolean; readonly tables: Readonly<Record<string, readonly string[]>> }
export const SCHEMA_ADDED: Readonly<Record<number, SchemaVersionAdded>>;
export function passOutcome(word: string): { word: string; exit: number };
export const ROW_TYPES: readonly ['user', 'assistant', 'system', 'attachment'];
export const PARSE_STATE: Readonly<{ ok: 'ok'; rawOnly: 'raw-only' }>;
export const RAW_ROW: Readonly<{ type: ''; provenance: 'harness'; parseState: 'raw-only' }>;
export const PROV_VERSION: 1;
export function newSha256(): import('node:crypto').Hash;
export interface ToolUse { id: string; name: string; command?: string }
export function toolUsesOf(content: unknown): ToolUse[];
export function toolResultIdsOf(content: unknown): string[];
export function rawRowKey(ccSessionUuid: string, rawShaHex: string): string;
export function launchFactsOf(row: unknown): { cwd: string | null; gitBranch: string | null };
export function lagOfTick(i: { tickStartMs: number; newEntries: number; minNewTsMs: number | null }): number | null;
export const SIDECAR_WHOLE_MAX: 67108864;
export const SIDECAR_MAX_BYTES: 134217728;
export function linkSidecar(name: string, candidates: ReadonlyArray<{ entryId: number; text: string; toolUseIds: readonly string[] }>): number | null;
export function secretKindOf(source: object | null, path: string): 'sessions' | 'env-identifier' | 'env' | 'token' | 'json';
export function ftsPhrase(value: string): string;
export function parseOpMarker(text: string): { verb: string; pid: number; startMs: number } | null;

// ── task 28: the health block (HealthClass is task 3's declaration, reused) ──
export interface HealthItem { readonly word: string; readonly detail: string; readonly remedy: string }
export interface HealthResult { readonly pass: string | null; readonly warn: HealthItem[]; readonly fail: HealthItem[] }
export interface ModeEntry { readonly rel: string; readonly kind: 'dir' | 'file'; readonly mode: number; readonly shown: string }
export interface ModeWrong { readonly path: string; readonly want: '0600' | '0700'; readonly got: string }
export interface HealthInputs {
  readonly nowMs: number;
  readonly storeId: string | null;
  readonly exit: number;
  readonly reason: string | null;
  readonly shimMtimeMs: number | null;
  readonly lastTickMs: number | null;
  readonly lagS: number | null;
  readonly sizeBytes: number | null;
  readonly capGb: number;
  readonly capMalformed: boolean;
  readonly capFile: string;
  readonly capturePause: '' | 'at-cap' | 'low-disk';
  readonly migration: string;
  readonly userVersion: number | null;
  readonly codeVersion: number;
  readonly historyOff: boolean;
  readonly recovering: null | { readonly step: string; readonly cursor: string; readonly cursorUnmovedTicks: number };
  readonly op: null | { readonly verb: string; readonly pid: number; readonly alive: boolean };
  readonly bytesBehindLast3: readonly number[];
  readonly fts: string | null;
  readonly modesWrong: readonly ModeWrong[];
  readonly rootIsSymlink: boolean;
  readonly redactUnreadable: readonly string[];
  readonly breakerOpen: boolean;
  readonly rosterUnreadable: boolean;
  readonly exportDue: number;
  readonly exportOverdue: number;
  readonly exportWriterLive: boolean;
  readonly exportPausedLowDisk: boolean;
  readonly retentionLowered: null | { readonly home: string; readonly days: number; readonly othersMin: number };
  readonly retentionUnmeasured: readonly string[];
  readonly journalGrowth30d: number;
  readonly journalSkipped: number;
  readonly exportSegmentNewer: readonly string[];
  readonly exportSegmentMissing: number;
  readonly journalUnwritable: boolean;
  readonly dbPath: string;
  readonly freeBytes: number | null;
  readonly thresholdBytes: number | null;
  readonly copyBps: number | null;
  readonly backupsDb: readonly string[];
  readonly journalStoreDirs: readonly string[];
  /** What status could not read (Task 28F): each name is an input that kept its default and was NOT measured. */
  readonly extrasUnmeasured: readonly string[];
}
export const HEALTH_META: Readonly<{
  recoverUnmovedTicks: 'recover_unmoved_ticks';
  exportSegmentNewer: 'export_segment_newer';
  exportSegmentMissing: 'export_segment_missing';
}>;
export const HEALTH_REMEDIES: Readonly<Record<string, string>>;
export function modeWantOf(rel: string, kind: 'dir' | 'file'): '0600' | '0700' | null;
export function modesWrongOf(entries: readonly ModeEntry[]): ModeWrong[];
export function journalHeldTooLong(oldestUnjournaledMs: number | null, nowMs: number): boolean;
export function deriveHealth(h: HealthInputs): HealthResult;
