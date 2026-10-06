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
export const SPOOL_ID_MAX: number;
export const STATFS_DEADLINE_MS: number;
export const CLI_STAT_DEADLINE_MS: number;
export const TMUX_DEADLINE_MS: number;
export const REPARSE_MAX_TARGETS: number;
export const CARRIER_KILL_S: number;
export const EXPORT_MARGIN_DAYS: number;
export const LINE_MAX: number;
export const CHUNK_BYTES: number;
export const RUN_BUDGET_MS: number;
export const RUN_BUDGET_BYTES: number;
export const CAP_DEFAULT_GB: number;
export const CAP_WARN_PCT: number;
export const FLOOR_GIB: number;
export const FLOOR_PCT: number;
export const EPOCH_CONFIRM_WINDOW_MS: number;
export const SCAN_INTERVAL_MS: number;
export const SIDECAR_FTS_BYTES: number;
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
export type EpochCause = 'startup' | 'resume' | 'clear' | 'import';
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
export function planCopy(i: { freeBytes: number; thresholdBytes: number; sizeBytes: number }): { admit: boolean; needBytes: number | null };
export function floorThreshold(fsSizeBytes: number, runBudgetBytes?: number): number;
export function capOf(text: string | null): { gb: number; malformed: boolean };
export function capBytes(gb: number): number;
export interface MigrationInputs {
  stored: number; code: number; freeBytes: number; thresholdBytes: number; sizeBytes: number;
  boundS: number | null; copyBps: number | null; attempts: number; heavy: boolean;
}
export function planMigration(i: MigrationInputs): MigrationVerdict;
export function withinBudget(i: { elapsedMs: number; bytes: number }): boolean;
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
