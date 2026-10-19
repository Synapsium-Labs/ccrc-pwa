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
export const OBS_FILE_MAX: number;
export const CONTROL_FILE_MAX: number;
export const SPOOL_FILE_LINES_MAX: number;
export const SPOOL_ID_MAX: number;
export const STATFS_DEADLINE_MS: number;
export const CLI_STAT_DEADLINE_MS: number;
export const TMUX_DEADLINE_MS: number;
export const REPARSE_MAX_TARGETS: number;
export const CARRIER_KILL_S: number;
export const EXPORT_MARGIN_DAYS: number;
export const LINE_MAX: number;
export const BLOB_DECODE_MAX: number;
export function blobOverDecodeCap(rawLen: unknown): boolean;
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
export const ENTRY_FTS_BYTES: number;
export const ENTRY_REDACT_MARGIN: number;
export function entryIndexText(text: string, idx: PairIndex): string;
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
export const PASS_FUTURE_SLACK_MS: number;
export const LAG_FAIL_MS: number;
export const RECOVERY_STALL_TICKS: number;
export const CATCHING_UP_TICKS: number;
export const JOURNAL_GROWTH_BYTES: number;
export const UUID_RE: RegExp;
export const WRITER_RE: RegExp;

export const NODE_KINDS: readonly ['steered_leaf', 'native_leaf', 'raw_leaf', 'condensed'];
export const PARSE_STATUS: readonly ['ok', 'degraded', 'invalid', 'absent', 'not-requested', 'parse-failed'];
export const ENTRY_PARSE_STATES: readonly ['ok', 'raw-only'];
export type Provenance = 'operator' | 'model' | 'tool' | 'summary' | 'harness' | 'ccrc-injected' | 'recall-echo';
export const PROVENANCE: readonly Provenance[];
export const SEARCHABLE_PROVENANCE: readonly Provenance[];
export type SpoolEvent = 'Stop' | 'PostCompact' | 'SessionStart' | 'recall' | 'steer';
export const SPOOL_EVENTS: readonly SpoolEvent[];
export type SpoolSource = 'startup' | 'resume' | 'clear' | 'fork';
export const SPOOL_SOURCES: readonly SpoolSource[];
export const SPOOL_NODE_KINDS: string;
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
export function spoolFileIdOf(name: unknown): string | null;
export function readBoxEnvValue(text: string, key: string): { found: boolean; value: string };
export interface HistoryPaths {
  readonly root: string; readonly spool: string; readonly draining: string; readonly journalDir: string;
  readonly dbDir: string; readonly dbFile: string; readonly wal: string; readonly shm: string;
  /** SQLite's rollback journal beside the DB (`history.db-journal`), not the history journal. */
  readonly journalFile: string;
  readonly backups: string; readonly storeId: string; readonly pending: string; readonly writer: string;
  readonly op: string; readonly pass: string; readonly passDied: string; readonly lock: string; readonly off: string; readonly cap: string;
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
export interface DrainingNameParts { readonly id: string; readonly tickMs: number; readonly pid: number }
export function drainingNameParts(name: unknown): DrainingNameParts | null;
export function drainingOrder(a: { readonly name: string; readonly parts: DrainingNameParts }, b: { readonly name: string; readonly parts: DrainingNameParts }): number;
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
export function storeVersionDamaged(v: number): boolean;
export function decideStatusReadFailure(f: { storeWord: string | null; sqliteError: boolean }): { exit: 5; reason: string } | null;
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
export type OpGateReason = 'bad-args' | 'apply-in-session' | 'needs-tty' | 'irreversible-in-pane' | 'history-off' | 'recovering';
export function decideOpGate(form: string | null, env: { claudecode: boolean; historyOff: boolean; recovering?: boolean; storedVersion?: Presence<number>; codeVersion?: number; storeId?: Presence<string> }, isTTY: boolean, paneName: string | null):
  { ok: true } | { ok: false; rc: 2; reason: OpGateReason };

// --- Task 7: epochs and families (spec §6.1, §9.2 step 1, §9.14 Holds)
export interface Observation {
  v: 1; observedMs: number;
  uuid: Presence<string>; generation: Presence<string>; project: Presence<string>; workdir: Presence<string>;
  late: null | ({ observedMs: number } & Pick<Observation, 'uuid' | 'generation' | 'project' | 'workdir'>);
  journalT: number | null;
  journaled: null | { t: number; storeId: string; writer: string; bytes: number };
  heldMatches: Record<string, number>;
}
export function observationOk(o: unknown): o is Observation;
export function joinGeneration(i: { lineGen: string | null; observedGen: Presence<string> }):
  { generation: string; via: 'line' | 'registry' | 'absent' | 'unreadable' };
export type EpochLineVerdict =
  | { kind: 'confirm'; by: 'reg' | 'observed' | 'held-match' }
  | { kind: 'candidate' }
  | { kind: 'chain'; confirmedBy: 'observed' | 'held-match' | null };
export function decideEpochLine(line: { src: SpoolSource; sid: string; reg?: string }, obs: Observation): EpochLineVerdict;
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
export interface PairIndex {
  readonly byLen: ReadonlyMap<number, { has(sha256: string): boolean }>;
  readonly belt?: Belt | null;
  readonly beltLive?: readonly number[];
}
export function makePairIndex(pairs: Iterable<SecretPair>, belt?: Belt | null): PairIndex;
export interface RankedPair extends SecretPair { readonly rid: number }
export interface ProbeIndex extends PairIndex { readonly probe: { hits: number }; readonly beltAll: boolean }
export function makeProbeIndex(pairs: Iterable<RankedPair>, mark: number, opts?: { belt?: Belt | null; beltAll?: boolean }): ProbeIndex;
export interface RederiveState { target: number; cursor: number; end: number; belt?: true }
export function parseRederiveState(text: string | undefined): RederiveState | null;
export function formatRederiveState(s: RederiveState): string;
export function rederivePlan(mark: number, top: number, maxBlobId: number, state: RederiveState | null, beltDue?: boolean, restart?: boolean): RederiveState | null;
export function phraseValues(mark: number, state: RederiveState | null, values: string[], fresh: string[]): string[];
export const LEAD_PREFIXES_MAX: number;
export const LEAD_READINGS_MAX: number;
export function redactField(text: string, idx: PairIndex): string;
export function redactFinal(text: string, idx: PairIndex): string;
export function redactFinalJson<T>(value: T, idx: PairIndex): T;
export function redactFinalText(text: string, idx: PairIndex): string;
export function redactFinalLines(text: string, idx: PairIndex): string;
// --- Task 10: harness table and the export's horizon (spec §6.10 item 3, §9.15)
export type Readable = { state: 'absent' } | { state: 'unreadable' } | { state: 'text'; text: string };
export const CLAUDE_CODE_DEFAULT_RETENTION_DAYS: 30;
export interface Retention { days: number; state: 'measured' | 'default' | 'unmeasured' }
export function claudeCodeRetention(i: { home: Readable; managed: readonly Readable[]; lastDays: number | null }): Retention;
export const HARNESS_TABLE: Readonly<{ 'claude-code': Readonly<{ retention: typeof claudeCodeRetention }> }>;
export const HARNESSES: readonly string[];
export function shortestRetention(homeRetentionDays: Readonly<Record<string, number>>): number;
export function shortestRetentionHome(containing: readonly string[], homeRetentionDays: Readonly<Record<string, number>>): string | null;
export interface ExportFile { home: string; mtimeMs: number; present: boolean }
export interface ExportCandidate { tsMs: number | null; files: readonly ExportFile[] }
/** A candidate's due TIME, in ms since the epoch: due exactly when it is before now; `-Infinity` when nothing holds
 *  it back (W1-B2, ruled Q15; B1's reducers answered a retention in days). */
export type ExportReducer = (candidate: ExportCandidate, homeRetentionDays: Readonly<Record<string, number>>) => number;
export const EXPORT_REDUCERS: Readonly<{ shortestHome: ExportReducer; perCopy: ExportReducer }>;
export function exportHorizonDays(retentionDays: number): number;
export function planExport(i: {
  nowMs: number; homeRetentionDays: Readonly<Record<string, number>>;
  blobs: readonly { key: string; referrers: readonly ExportCandidate[] }[]; reducer?: ExportReducer;
}): { horizonDays: number; due: string[]; overdue: string[]; oldestDueSinceMs: number | null };
export function exportDates(i: {
  homeRetentionDays: Readonly<Record<string, number>>; holders: readonly ExportCandidate[]; files: readonly ExportFile[];
  reducer?: ExportReducer;
}): { firstDueMs: number | null; firstDeletionMs: number | null };
export function dueTranscriptKeys<K>(i: {
  nowMs: number; homeRetentionDays: Readonly<Record<string, number>>;
  transcripts: readonly { key: K; files: readonly ExportFile[] }[]; reducer?: ExportReducer;
}): K[];
export function retentionLowered(homeRetentionDays: Readonly<Record<string, number>>): null | { home: string; days: number; othersMin: number };

export interface SchemaVersionAdded { readonly heavy: boolean; readonly tables: Readonly<Record<string, readonly string[]>> }
export const SCHEMA_ADDED: Readonly<Record<number, SchemaVersionAdded>>;
export function heavyVersionsBetween(stored: number | null, code: number, schemaAdded?: Readonly<Record<number, SchemaVersionAdded>>): number[];
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
export interface ProcIdentity { readonly procStart: string; readonly bootId: string }
export function parsePassMarker(text: string): { pid: number; startMs: number; procStart: string; bootId: string } | null;
export function formatPassMarker(pid: number, startMs: number, identity: ProcIdentity): string;
/** D-5026: the death record `~/.ccrc/history/pass-died` (one JSON line), or null when it is not in that grammar. */
export interface PassDied { readonly pid: number | null; readonly startMs: number; readonly foundMs: number; readonly count: number }
export function parsePassDied(text: string): PassDied | null;
export function formatPassDied(pid: number | null, startMs: number, foundMs: number, count: number): string;
export function procStartOf(statText: string): string | null;
export function bootIdOf(text: string): string | null;
export function decidePassLive(marker: { procStart: string; bootId: string } | null, identityNow: ProcIdentity | null): boolean;

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
  /** D-5016: the scheduled pass's marker as status measured it; `live` only when its identity measured equal. */
  readonly pass: null | { readonly pid: number; readonly startMs: number; readonly live: boolean };
  /** D-5026: the record a pass left when it found a pass that ended without its tick (status's `pass_died`); absent reads as null. An unreadable record is not null: it rides extrasUnmeasured. */
  readonly passDied?: PassDied | null;
  /** D-5027: when the last held scheduled pass ended (meta `held_pass_ms`, ms); null or absent when none was recorded. An unreadable value rides extrasUnmeasured. */
  readonly heldPassMs?: number | null;
  /** D-5633 (W5h-1 Task 2): the check after a bind's stop record (meta HEALTH_META.exportMarksCheck, read by parseMarkCheckState); null or absent when no check stands unfinished. A value the parser refuses rides extrasUnmeasured. */
  readonly exportMarksCheck?: ReturnType<typeof parseMarkCheckState> | null;
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
  /** W1-B4 Task 9: the last completed export pass (meta HEALTH_META.exportPassMs); null before the first. */
  readonly exportLastPassMs: number | null;
  /** W1-B4 Task 9: when the oldest due blob the census counted became due (meta HEALTH_META.exportDueOldestMs, read by
   *  readExportDueOldest): a time; null when the census counted nothing due; 'unmeasured' when no census of this build
   *  has recorded it, or it could date none of the due blobs. Never a time at or before the epoch. */
  readonly exportDueOldestMs: number | null | 'unmeasured';
  readonly retentionLowered: null | { readonly home: string; readonly days: number; readonly othersMin: number };
  readonly retentionUnmeasured: readonly string[];
  readonly journalGrowth30d: number;
  readonly journalSkipped: number;
  readonly blobUndecodable: number;
  readonly drainRejected: number;
  readonly spoolDisplaced: number;
  readonly spoolBlocked: number;
  readonly spoolUnreadable: number;
  readonly spoolNotDirectory: boolean;
  /** FR2c (D-4418): nodes at spool/<id>.jsonl that are not regular files, by status's own lstat. */
  readonly spoolNodesRefused: number;
  readonly exportSegmentNewer: readonly string[];
  readonly exportSegmentMissing: number;
  /** D-5634: the listed segments the last check after a bind found not whole or not this store's (HEALTH_META.exportSegmentDamaged). */
  readonly exportSegmentDamaged: readonly string[];
  readonly journalUnwritable: boolean;
  readonly dbPath: string;
  readonly freeBytes: number | null;
  readonly thresholdBytes: number | null;
  readonly copyBps: number | null;
  /** The interrupted attempts at the migration to the code's version (store's measureAttempts; its state rides migrationAttemptsUnmeasured), measured only while the verdict is snapshot-needs-op; absent reads as 0. */
  readonly migrationAttempts?: number;
  /** True when that marker could not be read, was empty or was garbled: the count then stands for the cap and nobody measured it (store's measureAttempts); absent reads as false. */
  readonly migrationAttemptsUnmeasured?: boolean;
  readonly backupsDb: readonly string[];
  readonly journalStoreDirs: readonly string[];
  /** What status could not read (Task 28F): each name is an input that kept its default and was NOT measured. */
  readonly extrasUnmeasured: readonly string[];
}
export const HEALTH_META: Readonly<{
  recoverUnmovedTicks: 'recover_unmoved_ticks';
  exportSegmentNewer: 'export_segment_newer';
  exportSegmentMissing: 'export_segment_missing';
  exportSegmentDamaged: 'export_segment_damaged';
  exportPassMs: 'export_pass_ms';
  exportDueOldestMs: 'export_due_oldest_ms';
  exportPaused: 'export_paused';
  heldPassMs: 'held_pass_ms';
  exportMarksCheck: 'export_marks_check';
}>;
export const HEALTH_COUNTERS: Readonly<{
  blobUndecodable: 'blob_undecodable';
  drainRejected: 'drain_rejected';
  spoolDisplaced: 'spool_displaced';
  spoolBlocked: 'spool_blocked';
  spoolUnreadable: 'spool_unreadable';
}>;
export const RETENTION_STATE_META: 'retention_state:';
export const SQLITE_CODES: Readonly<{
  BUSY: 5; LOCKED: 6; TOOBIG: 18; CONSTRAINT: 19; MISMATCH: 20; CONSTRAINT_CHECK: 275; CONSTRAINT_NOTNULL: 1299;
  CONSTRAINT_PRIMARYKEY: 1555; CONSTRAINT_UNIQUE: 2067; CONSTRAINT_ROWID: 2579; CONSTRAINT_DATATYPE: 3091;
}>;
export const DRAIN_FAILURE_ARMS: readonly ['defer', 'reject', 'fail'];
export function decideDrainFailure(errcode: unknown): 'defer' | 'reject' | 'fail';
export const HEALTH_REMEDIES: Readonly<Record<string, string>>;
export function modeWantOf(rel: string, kind: 'dir' | 'file'): '0600' | '0700' | null;
export function modesWrongOf(entries: readonly ModeEntry[]): ModeWrong[];
export function journalHeldTooLong(oldestUnjournaledMs: number | null, nowMs: number): boolean;
export function deriveHealth(h: HealthInputs): HealthResult;

// --- W1-B2 Task 1: identity, scope and ids (spec §8.2, §6.1, §6.9, §6.10, §8.6, §9.7)
export type ScopeKind = 'family' | 'project' | 'workspace';
export const SCOPE_KINDS: readonly ['family', 'project', 'workspace'];
export const NODE_ID_DISPLAY_MIN: 6;
export const HISTORY_NODE_ID_RE: RegExp;
export const RECALL_OFF_DIR: 'recall-off';
export interface ScopeRefusal<R extends string> { ok: false; rc: 2; reason: R }
export interface TmuxRead { settled: boolean; status: number | null; stdout: string }
export function decideIdentity(i: { pane: string | null; tmux: TmuxRead | null }):
  { ok: true; id: string } | ScopeRefusal<'no-identity' | 'bad-id'>;
export interface GenerationChoice { value: string | null; via: 'env' | 'registry' | 'newest' }
export function resolveGeneration(i: { envGen: string | null; regGen: Presence<string> }): GenerationChoice;
export function decideHarness(p: Presence<string>):
  { ok: true; harness: string } | ScopeRefusal<'harness-unsupported' | 'harness-unreadable'>;
export interface ScopeInputs {
  source: string;
  id: string;
  generation: GenerationChoice;
  flags: { project: boolean; workspace: boolean; session: string | null };
  reg: { project: Presence<string>; workdir: Presence<string>; sessionProject: Presence<string> | null };
}
export type ScopeVerdict =
  | ScopeRefusal<'no-identity' | 'bad-args' | 'bad-id' | 'cross-project' | 'project-unreadable' | 'workspace-unreadable'>
  | { ok: true; kind: ScopeKind; source: string; id: string; generation: string | null; project: string | null; workdir: string | null };
export function decideScope(i: ScopeInputs): ScopeVerdict;
export function displayPrefixes(ids: readonly string[]): Map<string, string>;
export type ScopedId =
  | { kind: 'ok'; id: string } | { kind: 'out-of-scope' } | { kind: 'not-found' }
  | { kind: 'ambiguous'; candidates: string[] } | { kind: 'bad' };
export function resolveScopedId(i: { wanted: string; inScope: readonly string[]; outOfScope: readonly string[] }): ScopedId;
export function extractNodeId(raw: string): { ok: true; id: string } | { ok: false; error: string; hint?: string };
export function recallOffPath(home: string, id: string): string;
export function decideRecallOff(i: { file: Presence<string>; generation: string }): 'off' | 'stale' | 'none';


// --- W1-B2 Task 2: search primitives (spec §8.4 grep, §11 V2, P1, P8, P9, P10)
export function sanitizeFtsQuery(raw: string): string;
export function queryTerms(raw: string): string[];
/** queryTerms for snippet localization: a term the query made a prefix keeps one terminal `*` (Task 12 fix round 1, F1). */
export function snippetTerms(raw: string): string[];
export function regexSyntaxIn(pattern: string): string | null;
export function regexSyntaxHint(pattern: string, syntax: string): string;
export const REGEX_MAX_LEN: 500;
export const REGEX_BUDGET_MS: 5000;
export type RegexGuard = { ok: true; source: string } | { ok: false; why: 'too-long' | 'nested' | 'invalid' };
export function guardRegex(pattern: string): RegexGuard;
export function regexPrefilter(pattern: string): string | null;
export type GrepSort = 'recency' | 'relevance' | 'hybrid';
export const GREP_SORTS: readonly GrepSort[];
export const GREP_LIMIT_MAX: 100;
export const GREP_LIMIT_DEFAULT: 20;
export const RANK_POOL: 2000;
export const HYBRID_AGE_DECAY: 0.001;
export function ftsOrderBy(sort: string, tsExpr: string): string;
export function snippetWindow(text: string, terms: readonly string[]): string;
export function parseTimeBound(s: string, nowMs: number): number | null;

// --- W1-B2 Task 3: output primitives (spec §8.3, §8.4, §11 P11, P12, P13, P17, P30)
export const OUTPUT_CAP: 20000;
export const EXPLORE_CUT: 2000;
export const DESCRIBE_EXCERPT: 4000;
export const DELEGATE_FACTOR: 3;
export const SNIPPET_MAX: 200;
export const EXPLORE_JSON_MAX: number;
export const HISTORY_CMD: '"$HOME/.local/bin/ccrc" history';
export const SHIM_LOCK_HELD: 75;
export const RECALL_SRCS: readonly string[];
export function escapeXmlAttr(value: string): string;
export function escapeXmlText(value: string): string;
export interface RecallField { src: string; id: string; ts: number | null; role: string | null; text: string; family?: { id: string; generation: string; firstSeenMs: number } }
export function recallEnvelope(f: RecallField): string;
export function snippetLine(text: string, max?: number): string;
export function capOutput(blocks: readonly string[], reserve: number, cap?: number): { kept: string[]; shown: number };
export function shownLine(shown: number, total: number): string;
export function nextLine(args: readonly string[]): string;
export interface HeaderFacts {
  kind: ScopeKind; id: string; project: string | null; families: number; transcripts: number;
  indexedThroughMs: number | null; lagS: number | null;
}
export function headerLine(h: HeaderFacts): string;
export function scopeLag(i: { eofMs: readonly (number | null)[]; nowMs: number; recovering: boolean }):
  { indexedThroughMs: number | null; lagS: number | null };
export interface ReadEnvelopeInput {
  exit: number; reason?: string; storeId: string | null; scope: Record<string, unknown> | null;
  header: { indexedThroughMs: number | null; lagS: number | null } | null;
  items: readonly Record<string, unknown>[]; shown: number; total: number; next: string | null; hint?: string;
}
export interface ReadEnvelope {
  v: 1; exit: number; reason?: string; store_id: string | null; coverage: string; scope: Record<string, unknown> | null;
  indexed_through_ms: number | null; lag_s: number | null; items: Record<string, unknown>[];
  shown: number; total: number; next: string | null; hint?: string;
}
export function readEnvelope(o: ReadEnvelopeInput): ReadEnvelope;
export function topicsOfColumn(text: string | null | undefined): string[];
export type CursorResource = 'grep' | 'describe' | 'expand';
export const CURSOR_RESOURCES: readonly CursorResource[];
export type Cursor =
  | { v: 1; resource: 'grep'; q: string; pos: number }
  | { v: 1; resource: 'describe'; node: string; off: number }
  | { v: 1; resource: 'expand'; t: string; i: number; o: number };
export type CursorOf<R extends CursorResource> = Extract<Cursor, { resource: R }>;
export function encodeCursor(c: Cursor): string;
export function decodeCursor<R extends CursorResource>(s: string, resource: R): CursorOf<R> | null;
export function decideRelay(i: { status: number | null; signal: string | null; lastLine: string | null }):
  { exit: number; reason?: string };
export function stripReadPrefix(text: string): string;
export type ExploreKind = 'json' | 'csv' | 'tsv' | 'code';
export function exploreKindOf(path: string | null): ExploreKind | null;
export function explore(text: string, kind: ExploreKind, fileName?: string): string;
export function costRow(chars: number, cap?: number): { chars: number; fits: 'in' | 'over' };
export function pickExpandBody(i: { primary: unknown; variants: readonly { body: unknown; cause: string }[] }): unknown;

// --- W1-B2 Task 4: the parser (spec §7.4, §7.8, §6.2, §11 V8, P29)
export const EXPAND_LABEL: 'Expand for details about:';
export const BLOCK_RE_SOURCE: string;
export const GIST_MAX: 1200;
export const NATIVE_GIST_MAX: 600;
export const GIST_MIN: 40;
export const TOPICS_MAX: 16;
export const TOPIC_CHARS: 80;
export const REFS_MAX: 40;
export const NODE_PARSER_VERSION: 1;
export type RefKind = 'path' | 'path:symbol' | 'sha' | 'issue' | 'd-number' | 'url' | 'test';
export const REF_KINDS: readonly RefKind[];
export type BlockReason = 'no-receipt' | 'no-block' | 'gist-short' | 'carried-copy' | 'id-mismatch' | 'topics-missing' | 'refs-missing';
export const BLOCK_REASONS: readonly BlockReason[];
export function capText(text: string, max: number): { text: string; capped: boolean };
export function capTopics(items: Iterable<string>): { topics: string[]; capped: boolean };
export function gistSha(gist: string): string;
export interface Block {
  kind: 'leaf' | 'node'; attrs: Record<string, string>; gist: string | null; expand: string | null;
  refs: string[] | null; refsNone: boolean; inAnalysis: boolean;
}
export function parseBlocks(text: string): Block[];
export function selectBlock(i: { blocks: readonly Block[]; kind: 'leaf' | 'node'; computedId: string; generic: boolean }):
  { block: Block | null; idMismatch: boolean };
export type BlockStatus = 'ok' | 'degraded' | 'invalid' | 'absent' | 'not-requested';
export function blockStatus(i: { receipt: boolean; block: Block | null; idMismatch: boolean; priorGistShas: ReadonlySet<string> }):
  { status: BlockStatus; reason: BlockReason | null };
export function summaryParts(text: string): { bodyStart: number; opens: number; unclosed: boolean; analysisSurvives: boolean };
export function summaryRowFor(i: {
  boundaryUuid: string; anchorUuid: string | null; rows: readonly { uuid: string; isCompactSummary: boolean; isEcho: boolean }[];
}): { uuid: string | null; anchorIsBoundary: boolean };
export interface GistKit {
  HEADING_RE: RegExp;
  fencedRanges: (t: string) => { ranges: Array<[number, number]>; closed: number };
}
export function nativeGist(i: { text: string; direction: 'from' | 'up_to' | null }, kit: GistKit, idx: PairIndex):
  { gist: string | null; capped: boolean; pair: 'current' | 'completed' | null };
export function nativeTopics(i: { text: string; prevText: string | null }, kit: GistKit, idx: PairIndex):
  { topics: string[]; capped: boolean };
export function classifyRef(v: string): RefKind | null;
export interface NodeRef { kind: string; value: string; origin: 'model' | 'tool_use' | 'meta' }
export function capRefs(refs: Iterable<NodeRef>): { refs: NodeRef[]; capped: boolean };
export function directiveFlag(text: string): boolean;

// --- W1-B2 Task 5: spans, leaf ids, readiness, fan-in, parent rollups (spec §6.1, §6.3)
export interface SpanRow { readonly uuid: string; readonly pos: number; readonly isBoundary: boolean; readonly isSummary: boolean }
export interface SpanBoundary { readonly uuid: string; readonly headUuid: string | null; readonly kept: ReadonlySet<string>; readonly summaryUuid: string | null }
export interface SpanLeaf { boundaryUuid: string; spanStartUuid: string; sources: string[]; headMissing: boolean }
export function planSpans(i: { rows: readonly SpanRow[]; boundaries: readonly SpanBoundary[] }): { leaves: SpanLeaf[]; liveTail: string[] };
export function decideLeafId(i: { ccrcId: string; ccUuid: string; spanStartUuid: string; boundaryUuid: string; plainBoundOther: boolean }): { id: string; forked: boolean };
export const RAW_LEAF_GRACE_MS: number;
export function eofAfterBoundary(i: { eofMs: number | null; boundaryTsMs: number | null }): boolean;
export function leafReady(i: { summaryStored: boolean; fileAtEofAfterBoundary: boolean }): boolean;
export const FAN_IN: Readonly<{ leaf: 8; condensed: 4 }>;
export interface FanInSlot { readonly nodeId: string | null; readonly final: boolean; readonly parented: boolean }
export function planFanIn(i: { slots: readonly FanInSlot[]; width: number }): string[][];
export function firstSentence(text: string): string;
export interface RollupChild {
  gist: string | null; topics: readonly string[]; refs: readonly { kind: string; value: string; origin: string }[];
  earliestMs: number | null; latestMs: number | null; srcChars: number; descCount: number; descChars: number;
}
export function parentRollup(children: readonly RollupChild[]): {
  gist: string | null; topics: string[]; refs: { kind: string; value: string; origin: string }[];
  earliestMs: number | null; latestMs: number | null; srcChars: number; descCount: number; descChars: number; capped: boolean;
};

// --- W1-B2 Task 6: operator-verb decisions (spec §6.6, §6.9, §8.3, §8.4)
export type OpArgs =
  | { readonly op: 'import'; readonly apply: boolean; readonly session: string | null; readonly file: string | null }
  | { readonly op: 'migrate' }
  | { readonly op: 'prune'; readonly days: number; readonly apply: boolean }
  | { readonly op: 'reparse'; readonly node: string | null; readonly session: string | null; readonly apply: boolean }
  | { readonly op: 'repair' }
  | { readonly op: 'backup' }
  | { readonly op: 'adopt' }
  | { readonly op: 'restore'; readonly name: string }
  | { readonly op: 'rebuild'; readonly storeId: string | null };
export function parseOpVerbArgs(op: string, args: readonly string[]):
  { ok: true; args: OpArgs } | { ok: false; reason: 'bad-args' | 'bad-id' | 'older-than-floor' | 'restore-refused' };
export function decideOpDoor(f: CliStoreFacts):
  | { ok: true } | { ok: false; exit: 9 } | { ok: false; exit: 2; reason: 'writer-absent' }
  | { ok: false; exit: 5; reason: 'store-unreachable' | 'store-root-dangling' | 'store-unmeasured' };
export function parseDuration(input: string): number | null;
export const PRUNE_FLOOR_DAYS: 30;
export function backupNameOf(nowMs: number): string;
export function restoreNameOk(name: string): boolean;
export interface BindBackup { regular: boolean; storeId: Presence<string>; userVersion: number | null; integrityOk: boolean | null }
export interface BindFacts extends StoreFacts {
  codeVersion: number; storedVersion: Presence<number>; storeIdArg: string | null;
  journalDirs: readonly { storeId: string; heads: 'agree' | 'empty' | 'disagree' | 'unreadable' | 'foreign' }[];
  backup: null | BindBackup;
}
export function decideBind(kind: 'adopt' | 'restore' | 'rebuild', f: BindFacts):
  { ok: true; storeId: string } | { ok: false; rc: 2 | 5; reason: string; detail: string; remedy?: 'store-id' };
export function decideReparse(i: { targets: number; prunedSpans: number }): { ok: true } | { ok: false; reason: 'reparse-too-many' | 'span-pruned' };

// --- W1-B2 Task 7: recovery and repair decisions (spec §9.14, §9.6, §8.4 doctor --repair)
export const RECOVER_PHASES: readonly string[];
export const RECOVER_JOURNAL_PHASES: readonly string[];
/** `file` and `offset` name a position in the phase's input. In the journal phases (index, apply) `file` is a journal file's name and
 *  `groupSize` is the file count of the replay group it leads, which `offset` is a position in (a byte offset for a group of one, an
 *  ordinal for a merge group); null or absent means it was not recorded (D-4607). In the export phases `file` is a segment's name and
 *  `offset` is the last blobs rowid applied (export-blobs, export-stubs) or the last row ord applied (export-rows). Only the journal phases carry a
 *  `groupSize`: formatRecoverCursor throws a TypeError for one beside any other phase. */
export interface RecoverCursor { phase: string; file: string | null; offset: number; blobId: number | null; groupSize?: number | null; pairsAdded: boolean }
export function formatRecoverCursor(c: RecoverCursor): string;
export function parseRecoverCursor(s: string | null): RecoverCursor | null;
export interface JournalFileFacts { name: string; month: string; writer: string; headT: number | null; lastT: number | null }
export function orderJournalFiles(files: readonly JournalFileFacts[]): string[][];
export type ReplayAction =
  | { do: 'file'; name: string; t: number }
  | { do: 'receipt'; key: string; ord: number; rec: Record<string, unknown>; recvMs: number; verdicts: JournalRecord[] }
  | { do: 'skip-undrained'; file: string }
  | { do: 'verdict'; rec: JournalRecord }
  | { do: 'redact'; len: number; sha256: string; t: number }
  | { do: 'tick'; t: number; lagMs: number | null }
  | { do: 'skip'; counter: 'journal_line_malformed' | 'journal_record_unknown' | 'journal_head_mismatch' };
export interface ReplayState {
  storeId: string; file: string | null; recvMs: number;
  drained: ReadonlySet<string>; verdictsByKey: ReadonlyMap<string, readonly JournalRecord[]>; ticksAfter: number;
  ticksBefore?: number | null;
}
export function indexRecord(r: JournalRead): { redact?: { len: number; sha256: string; t: number }; verdictKey?: string; drainedFile?: string };
export function replayStep(state: ReplayState, r: JournalRead): { state: ReplayState; actions: ReplayAction[] };
export function planReplay(i: {
  storeId: string; files: readonly { name: string; month: string; writer: string; lines: readonly string[] }[]; ticksAfter: number;
  ticksBefore?: number | null;
}): ReplayAction[];
/** One merge group's items merged by `t`: each file's own order kept, a tie to the earlier file (planReplay and sweep.mjs's recovery executor share it; W1-B2 Task 25, R-T25-1). */
export function mergeJournalByTime<T extends { t: number }>(files: readonly (readonly T[])[]): T[];
export function nextUnmovedTicks(i: { prev: number; moved: boolean; held: boolean }): number;
export interface FkRow { table: string | null; rowid: number | null; parent: string | null; fkid: number | null }
export function diffForeignKeys(baseline: readonly FkRow[], current: readonly FkRow[]): { newViolations: FkRow[]; preExisting: number };
export const FTS_SHADOWS: Readonly<{ blobs_fts: readonly string[]; nodes_fts: readonly string[] }>;
export const FTS_COLUMNS: Readonly<{ blobs_fts: readonly string[]; nodes_fts: readonly string[] }>;
export function ftsTablesHealthy(m: { tables: ReadonlySet<string>; columns: Readonly<Record<string, readonly string[]>> }): { blobs: boolean; nodes: boolean };

// --- W1-B2 Task 7A: the substring belt (spec §8.3 layer 4 and layer 1's glue windows, §6.2 "The belt"; rev 3.5)
export const BELT_VERSION: number;
export const BELT_BITS: number;
export const BELT_K_LADDER: readonly number[];
export const BELT_GRAMS_MAX: number;
export const BELT_META: 'fts_belt';
export const BELT_NODES_STEP: 'nodes-belt';
export const REDACT_SOURCES_META: 'redact_sources';
export const REDACT_SOURCES_MAX: number;
export function normalizeRedactSources(paths: unknown): string[] | null;
export const BELT_COUNTERS: Readonly<{ overflow: string; generations: string }>;
export interface Belt {
  readonly units: readonly Uint8Array[];
  readonly texts: readonly string[];
  readonly widths: readonly { readonly w: number; readonly pw: number; readonly table: ReadonlyMap<number, readonly { readonly unit: number; readonly off: number }[]> }[];
  readonly grams: number;
  readonly overflow: number;
}
export function beltWidth(unit: string): number;
export function beltFold(cp: number): number;
export function beltUnits(values: Iterable<string>): string[];
export function makeBelt(units: Iterable<string>): Belt;
export function beltMask(text: string, belt: Belt | null | undefined, decode: boolean, onHit?: (() => void) | null): string;
/** `gv`: the BELT_VERSION an open generation opened under, present exactly when `gen` is a list (R-version). `w`: the
 *  store's witness when a belt-aware pass last wrote the state (R-rollback). */
export interface BeltState { v: number; rids: number[]; gen: number[] | null; gv?: number; w?: string }
export function parseBeltState(text: string | null | undefined): BeltState | null;
export function formatBeltState(s: BeltState): string;
export function decideBelt(state: BeltState | null, live: readonly number[], mark: number): { due: boolean; restart: boolean; next: BeltState };
export function beltAfterGeneration(next: BeltState): BeltState;
export function beltWitnessMoved(state: BeltState | null, witness: string): boolean;
export function parseRedactSources(text: string | null | undefined): string[];

// --- W1-B2 Task 7A: the index's escape readings for display and nodes_fts (spec §8.3, §6.2; rev 3.5)
export const DISPLAY_READINGS_MAX: number;
export function redactForDisplay(text: string, idx: PairIndex): string;
export function nodeIndexTexts(fields: { gist: string | null; topics: readonly string[] | null; refs: readonly string[] }, idx: PairIndex):
  { gist: string; topics: string; refs: string };


// --- W1-B2 Task 8: leaf helpers derive.mjs composes (spec §6.1, §7.4)
export function directionOfSummaryRow(row: unknown): 'from' | 'up_to' | null;
export function blockFields(block: Block): { gist: string | null; topics: string[]; refs: { kind: string; value: string; origin: 'model' }[]; capped: boolean };
export interface SteerReceipt { readonly leafId: string; readonly tsMs: number }
export function pickReceipt(receipts: readonly SteerReceipt[], w: { id: string; afterMs: number | null; uptoMs: number | null }): SteerReceipt | null;
export function pickHoldingCopy(files: readonly { fileId: number; live: boolean; holds: boolean }[]): number | null;
export function forkCounts(i: { liveSizes: readonly number[]; unionSize: number; coveredSize: number; holdingCopies: number }): { unspanned: number; forked: boolean };

// --- W1-B2 Task 10: the read verbs' arguments, version-aware selects, recall-off's B2 refusals
export function paneOk(pane: unknown): boolean;
export const TREE_DEPTH_DEFAULT: 2;
export const TREE_DEPTH_MAX: 8;
export const AROUND_DEFAULT: 5;
export const AROUND_MAX: 50;
export interface ReadOptionSpec {
  readonly kind: 'flag' | 'value' | 'enum' | 'int'; readonly key: string;
  readonly values?: readonly string[]; readonly min?: number; readonly max?: number;
}
export interface ReadVerbSpec {
  readonly options: Readonly<Record<string, ReadOptionSpec>>;
  readonly defaults: Readonly<Record<string, string | number | boolean | null>>;
  readonly positional: Readonly<{ min: number; max: number }>;
}
export const READ_OPTIONS: Readonly<Record<'grep' | 'describe' | 'expand' | 'tree', ReadVerbSpec>>;
export const READ_VERBS: readonly string[];
export type ReadOpts = Readonly<Record<string, string | number | boolean | null>>;
export type ReadArgs =
  | { ok: true; verb: string; positional: readonly string[]; opts: ReadOpts }
  | { ok: false; reason: 'bad-args' };
export function parseReadArgs(verb: string, argv: readonly string[]): ReadArgs;
export function selectColumns(version: number, table: string, cols: readonly string[],
  schema?: Readonly<Record<number, SchemaVersionAdded>>, alias?: string | null): string;
export type RecallOffPreflight =
  | { done: true; exit: 2; reason: 'bad-args' | 'bad-id' | 'generation-unreadable' }
  | { done: false; id: string };
export function decideRecallOffPreflight(i: { args: readonly string[]; generation: Presence<string> | null }): RecallOffPreflight;

// --- W1-B2 Task 11: the --json scope's family bound
export const SCOPE_FAMILIES_JSON_MAX: 3;

// --- W1-B2 Task 12: grep's arguments and index gate
export const INDEXED_PROVENANCE: readonly Provenance[];
export const FTS_STEP: 'fts';
export function reachSize(n: number): string;
export const SEARCH_REACH: string;
export type GrepIndexVerdict =
  | { ok: true }
  | { ok: false; exit: 5 | 7; reason: 'probe-failed' | 'fts5-absent' | 'fts-pending' };
export function decideGrepIndex(i: { probe: 'present' | 'absent' | 'threw'; table: boolean; completed: boolean; rebuilding?: boolean }): GrepIndexVerdict;
export interface GrepArgs {
  words: string[]; regex: string | null; role: string | null; tool: string | null; sinceMs: number | null; beforeMs: number | null;
  node: string | null; sort: 'recency' | 'relevance' | 'hybrid'; limit: number; cursor: string | null; includeRecall: boolean; json: boolean;
}
export function parseGrepArgs(argv: readonly string[], nowMs: number): { ok: true; args: GrepArgs } | { ok: false; reason: 'bad-args' };

// --- W1-B2 Task 12: a window of a longer text, redacted for display
export function snippetSpan(text: string, terms: readonly string[]): { at: number; len: number };
export const DISPLAY_WINDOW_MAX: number;
export const DISPLAY_EDGE_SLACK: 32;
export const DISPLAY_INEXACT_NOTE: string;
export function redactDisplayWindow(text: string, from: number, to: number, idx: PairIndex): string;
export function displaySnippet(text: string, terms: readonly string[], idx: PairIndex): string;
export function displayToken(value: string, idx: PairIndex): string;
export function foldOneLine(text: string): string;
// --- W1-B2 Task 15: describe's arguments
export interface DescribeArgs { target: string; full: boolean; cursor: string | null; json: boolean }
export function parseDescribeArgs(argv: readonly string[]): { ok: true; args: DescribeArgs } | { ok: false; reason: 'bad-args' };
// ── W1-B2 Task 16: expand ──
export const PAGE_TEXT_BUDGET: number;
export const CUT_TEXT_BUDGET: 8000;
export const EXPAND_MIN_PARTIAL: 4000;
export function charCost(code: number): number;
export function textCost(text: string, start?: number, end?: number): number;
export function pageEnd(text: string, start: number, budget: number): number;
export function cutText(text: string, maxChars: number, budget: number): string;
export function expandTargetOf(s: string): 'node' | 'entry' | 'bad';
export interface ExpandArgs { target: string | null; around: string | null; before: number; after: number; cursor: string | null }
export function expandArgsOf(parsed: { positional: readonly string[]; opts: Readonly<Record<string, unknown>> }):
  { ok: true; args: ExpandArgs } | { ok: false; reason: 'bad-args' };
export function expandResumeOf(cursor: Readonly<Record<string, unknown>> | null):
  { target: string | null; around: string | null; before: number; after: number } | null;
export function entryScopeVerdict(i: { found: boolean; inScope: boolean }): 'ok' | 'out-of-scope' | 'not-found';
export function expandCuts(i: { whole: boolean; kind: 'entry' | 'sidecar'; provenance: string | null }): boolean;
export function decideExpandCursor(i: { cursor: Readonly<Record<string, unknown>> | null; key: string; total: number }):
  { ok: true; i: number; o: number } | { ok: false };
export function delegateHint(chars: number): string | null;
export function expandBlobFits(rawLen: number): boolean;
export function toolUseInputPath(content: unknown, toolUseId: string): { found: false } | { found: true; path: string | null };
export function renderEntryText(body: unknown): string;
export const EXPLORE_READ_MAX: number;
export function exploreOutline(text: string, kind: ExploreKind, fileName: string | undefined, idx: PairIndex): string;
// ── W1-B2 Task 17: version-aware reads ──
export const VERB_TABLES: Readonly<Record<'grep' | 'describe' | 'expand' | 'tree', readonly string[]>>;
export function missingTablesAt(version: number, verb: string, schema?: Readonly<Record<number, SchemaVersionAdded>>,
  verbTables?: Readonly<Record<string, readonly string[]>>): string[];
export function schemaAdditive(schema: Readonly<Record<number, SchemaVersionAdded>>,
  measured?: Readonly<Record<number, Readonly<Record<string, readonly string[]>>>>): { ok: true } | { ok: false; lost: string[] };

// ── W1-B2 Task 19: the operator door's pane read ──
export function paneReadWanted(form: string | null, pane: string | null): boolean;
// --- W1-B2 Task 23: doctor --repair's rebuild step
export const FTS_REBUILD_STEP: 'fts-rebuild';
// --- W1-B2 Task 23: B1's health counters re-measured after a cure
export const COUNTER_STANDING: Readonly<Record<string, 'item' | 'pass'>>;
export function decideCounterResets(counters: Readonly<Record<string, number>>, standing: Readonly<Record<string, number | null>>):
  Array<{ name: string; n: number }>;
export function decideIntegrity(rows: readonly string[]): { verdict: 'ok' | 'index' | 'store'; rows: string[] };

// --- W1-B3 Task 1: the card line's vocabulary, paths and line (spec §8.6, §5.1, §5.2, §9.4)
export const CARD_DIR: 'card';
export const SCOPE_DIR: 'scope';
export const CARD_LINE_MAX: 512;
export const CARD_DESCRIBE_CMD: '~/.local/bin/ccrc history describe';
export const CARD_LINE_PATTERN: string;
export const CARD_LINE_RE: RegExp;
export const PURGED_FILES_GRACE_MS: number;
export function cardDirOf(home: string, id: string): string;
export function cardFileOf(home: string, id: string, uuid: string): string;
export function scopeMarkerOf(home: string, id: string): string;
export function cardLine(i: { leaf: string; parent?: string | null }): string;

// --- W1-B3 Task 2: the card prediction and the card file decision (spec §8.6, §6.1, §6.3)
export interface CardBoundary { readonly uuid: string; readonly headUuid: string | null }
export interface CardSlot { readonly nodeId: string | null; readonly parented: boolean }
export interface CardPredictionInputs {
  ccrcId: string | null; ccUuid: string; firstRowUuid: string | null; lastBoundary: CardBoundary | null;
  plainBoundOther: boolean; slots: readonly CardSlot[]; newestCondensed: string | null; familyIds: readonly string[];
}
export type CardPrediction =
  | { act: 'write'; line: string; leafId: string; parentId: string | null; parentKind: 'predicted' | 'newest-condensed' | null }
  | { act: 'skip'; reason: 'fork-qualified'; plainLeafId: string }
  | { act: 'skip'; reason: 'no-epoch' | 'no-rows' };
export function predictedSpanStart(i: { firstRowUuid: string | null; lastBoundary: CardBoundary | null }): string | null;
export function planCardPrediction(i: CardPredictionInputs): CardPrediction;
export function decideCardFile(i: { current: Presence<string>; prediction: CardPrediction; atEof: boolean }):
  { act: 'keep' | 'write' | 'delete' | 'none'; consumed: boolean };
export function decideCardGenFile(i: {
  current: Presence<string>; generation: string; card: 'keep' | 'write' | 'delete' | 'none'; mayWrite: boolean;
}): 'keep' | 'write' | 'delete' | 'none';
export function cardGenFileOf(home: string, id: string, uuid: string): string;


// --- W1-B3 Task 3: card delivery, window and purge decisions (spec §8.6 RV17, §9.4, §10.7 W1-e)
export const CARD_MEASURE_ROWS: 40;
export const CARD_MEASURE_MAX_WAIT_MS: number;
export const CARD_ATTACHMENT_MAX_BYTES: number;
export function cardIdsIn(attachment: unknown): string[];
export function cardWindowComplete(i: { live: boolean; rowsSeen: number; nextBoundary: boolean; eofAfter: boolean; waitedMs: number }): boolean;
export function decideCardDelivery(i: { ids: readonly string[]; leafId: string; windowComplete: boolean }): 'served' | 'mismatch' | 'none' | 'wait';
export function decidePurgedEntry(i: { reg: 'present' | 'absent' | 'unmeasured'; newestMtimeMs: number | null; nowMs: number }): 'keep' | 'remove';
// rulings RC3 (the consumption's scope) and RC2 (the withdrawal)
export const SCOPE_MARKER_MAX_AGE_MS: number;
export type CardConsumedScope = 'main' | 'other' | 'unknown';
export const CARD_CONSUMED_SCOPES: readonly CardConsumedScope[];
export type CardWithdrawReason =
  | 'at-cap' | 'low-disk' | 'floor-stop' | 'roster-unreadable' | 'budget' | 'recovering' | 'migrating' | 'held'
  | 'unreachable' | 'refused' | 'unbound' | 'copy-skipped';
export const CARD_WITHDRAW_REASONS: readonly CardWithdrawReason[];
export interface CardBoundaryAt { readonly uuid: string; readonly headUuid: string | null; readonly tsMs: number | null }
export type CardPassFacts =
  | { arm: 'hold'; word: string }
  | { arm: 'migrate' | 'recover'; word?: string | null }
  | { arm: 'run'; pause: 'at-cap' | 'low-disk' | null; floorStop: boolean; ingested: boolean; budgetLeft: boolean }
  | { arm: 'copy'; uuid: string; skipped: readonly string[] };
export function consumedBoundaryTs(i: {
  current: Presence<string>; ccrcId: string | null; ccUuid: string; firstRowUuid: string | null; boundaries: readonly CardBoundaryAt[];
}): number | null;
export function decideConsumedScope(i: { marker: Presence<string>; uuid: string; boundaryTsMs: number | null }): CardConsumedScope;
export function decideCardWithdraw(p: CardPassFacts): { act: 'withdraw'; reason: CardWithdrawReason } | { act: 'keep' };
// --- W1-B4 Task 1: the sole-copy export's names, numbers, cadence, room and dead-file key (spec §9.15, §9.3, §6.2)
export const EXPORT_DIR: 'export';
export const EXPORT_SEGMENT_MAX_BYTES: number;
export const EXPORT_PASS_INTERVAL_MS: number;
export const EXPORT_SEGMENT_FORMAT: number;
export const SEGMENT_HEADER_BYTES: 100;
export function segmentName(i: { seq: number; writer: string }): string;
export function parseSegmentName(name: string): { seq: number; writer: string } | null;
export function segmentTempName(name: string): string;
export function orderSegmentNames(names: readonly string[]): string[];
export function segmentOrdersAfter(a: string, b: string | null): boolean;
export function nextSegmentSeq(i: { onDisk: readonly number[]; recorded: number | null }): number;
export function decideExportPass(i: { nowMs: number; lastPassMs: number | null; firstTickMs: number | null; lastAttemptMs?: number | null; intervalMs?: number }): 'run' | 'wait';
export const EXPORT_MARK_BACKOFF_MAX_MS: number;
export function exportPassIntervalMs(markFails: number): number;
/** The sweep's statfsWithDeadline answer for ~/.ccrc/history/export, as planExportRoom takes it. */
export type ExportProbe = { state: 'ok'; bytes: number; fsSize: number } | { state: 'unsettled' } | { state: 'threw' };
export interface ExportRoom { admit: boolean; word: 'ok' | 'low-disk' | 'unsettled'; needBytes: number | null }
export function planExportRoom(free: ExportProbe): ExportRoom;
export function exportedSourceKey(path: string, dev: string | number | bigint, ino: string | number | bigint): string;
export function deadFileSourceKey(path: string, dev: string | number | bigint, ino: string | number | bigint): string;
// the marks' two decisions (RD2)
export function exportMarkFailsOf(recorded: string | null): number;
export type ExportMarkOutcome = 'marked' | 'mark-failed' | 'mark-busy' | 'write-failed';
export function decideMarkOutcome(i: { outcome: ExportMarkOutcome; recorded: string | null }): { markFails: number; write: string | null; intervalMs: number };
export function decideMarkCheck(i: { metaKeys: readonly string[]; checkedRecord: string | null; vanished?: boolean }): { check: boolean; facts: string[]; record: string };
export function missingSegmentNames(i: { named: Iterable<string>; present: Iterable<string> }): string[];
// W5h-1 Task 4: the listing record (D-5636 (history-export-vanished-rearm))
export function segmentListingDigest(names: Iterable<string>): string;
export function segmentListingRecord(names: Iterable<string>): string;
export function addSegmentToListing(recorded: string | null, name: string): string | null;
export function segmentListingVanished(i: { recorded: string | null; measured: string | null }): boolean;
export function entryMayHoldMark(i: { blobs: readonly { exported: boolean; pruned: boolean }[] }): boolean;
export function segmentMayMarkEntry(i: { blobs: readonly { exported: boolean; pruned: boolean; carried: boolean }[] }): boolean;
export function budgetHeldPass(i: { taken: number; selectionComplete: boolean; written: number; writeStopped: 'budget' | 'off' | null }): boolean;
// --- W1-B4 Task 2: what one export segment carries (spec §9.15 "What is due", "Write")
export interface SegmentBlob { key: string; zBytes: number; exported: boolean; pruned: boolean }
export interface SegmentCandidate extends ExportCandidate { key: string; blobs: readonly SegmentBlob[] }
export interface SegmentPlan { take: string[]; carry: string[]; stubs: string[]; bytes: number; leftDue: number; oldestLeftDueSinceMs: number | null }
export const EXPORT_ROW_META_BYTES: number;
export function planSegment(i: {
  nowMs: number; homeRetentionDays: Readonly<Record<string, number>>; rows: readonly SegmentCandidate[]; boundBytes: number; reducer?: ExportReducer;
  takenBefore?: boolean;
}): SegmentPlan;

// --- W1-B4 Task 3: export replay's decisions (spec §9.14 "Export replay")
export function decideSegmentReplay(i: { meta: { storeId: string; format: number }; storeId: string }): 'replay' | 'newer' | 'foreign';
/** W5h-1 Task 3 (D-5634): store.mjs segmentFileFacts' answer, and the two verdicts over it. */
export type SegmentFileFacts =
  | { readonly size: number; readonly magic: boolean; readonly pageSize: number; readonly pageCount: number; readonly headerValid: boolean; readonly unreadable?: undefined }
  | { readonly unreadable: string };
export type SegmentWholeVerdict = 'whole' | 'short' | 'long' | 'not-sqlite' | 'header-invalid' | 'unreadable';
export function decideSegmentWhole(facts: SegmentFileFacts): SegmentWholeVerdict;
export function decideSegmentOwn(i: { meta: { storeId: string; seq: number; writer: string } | null; storeId: string; name: string }): 'own' | 'foreign' | 'renamed' | 'meta-unreadable';
export function readSegmentNameList(v: string | null): string[];

// --- W1-B4 Task 9: the census's oldest due-since in meta, written and read back (no epoch, no overloaded null)
export const EXPORT_DUE_OLDEST_UNMEASURED: 'unmeasured';
export function exportDueOldestMeta(due: number, dueOldestMs: number | null): string;
export function readExportDueOldest(v: string | undefined): number | null | 'unmeasured';

// --- W5h-1 Task 1: the check after a bind, in bounded batches (D-5632 (history-export-bind-check-batched))
export const EXPORT_BIND_BYTES: number;
export const EXPORT_BIND_WAL_CEILING: number;
export const EXPORT_BIND_BATCH: number;
export const EXPORT_MARKS_STALL_MS: number;
export type MarkCheckWord = 'budget' | 'off' | 'wal-held' | 'unlistable' | 'failed';
export const MARK_CHECK_WORDS: readonly MarkCheckWord[];
export interface MarkCheckState { word: MarkCheckWord; sinceMs: number; cleared: number }
export function markCheckStop(i: { budgetLeft: boolean; off: boolean; walBytes: number; walCeiling: number }): null | 'budget' | 'off' | 'wal-held';
export function planMarkCheckBatch(i: { rows: readonly { id: number; bytes: number }[]; maxBytes: number; maxRows: number }): { ids: number[]; bytes: number; after: number | null };
export function formatMarkCheckState(s: MarkCheckState): string;
export function parseMarkCheckState(v: string | null): MarkCheckState | null;
export function nextMarkCheckState(i: { recorded: string | null; word: MarkCheckWord; nowMs: number; cleared: number }): MarkCheckState;
