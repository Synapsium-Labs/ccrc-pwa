// ccd/history/store.d.mts — types for the vitest import of store.mjs (the
// compact-card.d.mts precedent). Hand-written; grows with each task. Nothing
// machine-checks it against store.mjs, so every export is declared here.
import type { DatabaseSync } from 'node:sqlite';
import type { FkRow, MigrationVerdict, PairIndex, Presence, SegmentFileFacts, StoreFacts } from './lib.mjs';

export const CODEC: 'br5';
export class StoreError extends Error {
  constructor(word: string, message: string);
  readonly word: string;
}
export const MIGRATIONS: readonly string[];
export const OWED_INDEX: 'blobs_unindexed';
export const V2_INDEXES: readonly string[];
export function openWriter(dbPath: string): DatabaseSync;
export function openReader(dbPath: string): DatabaseSync;
export function userVersion(db: DatabaseSync): number;
export function probeFts5(db: DatabaseSync): 'present' | 'absent';
export function withTx<T>(db: DatabaseSync, sync: 'NORMAL' | 'FULL', fn: () => T): T;
export function brotli(buf: Uint8Array): Buffer;
export function unbrotli(z: Uint8Array, maxLen: number): Buffer;
export function unbrotliPrefix(z: Uint8Array, max: number): Promise<{ bytes: Buffer; decoded: number; whole: boolean }>;
export function blobPlainText(z: Uint8Array | null, isSidecar: boolean, idx: PairIndex | null, rawLen: number): string;
export type BlobPlainState = 'text' | 'absent' | 'oversize' | 'undecodable';
export function blobPlainTextMeasured(z: Uint8Array | null, isSidecar: boolean, idx: PairIndex | null, rawLen: number): { state: BlobPlainState; text: string };
export function measuredSize(db: DatabaseSync, dbPath: string): number;
export function getMeta(db: DatabaseSync, k: string): string | null;
export function setMeta(db: DatabaseSync, k: string, v: string | number): void;
export function bump(db: DatabaseSync, name: string, by?: number): void;
export function closeWriter(db: DatabaseSync): void;
export function schemaOf(db: DatabaseSync): Record<string, string[]>;
export function mintStoreId(): string;
export function mintWriter(): string;
export function writeFileAtomic(path: string, text: string, mode?: number): void;
export type BoundedRead = { state: 'absent' } | { state: 'unreadable' } | { state: 'over-cap' } | { state: 'value'; value: string };
export function readBounded(path: string, max: number, follow: boolean): BoundedRead;
export function removeStaleAtomicTemps(home: string): string[];
export function mkdirDurable(dir: string, mode?: number): boolean;
export function removeEntry(path: string): 'removed' | 'absent' | 'kept-dir';
export function peekStoreId(dbPath: string): Presence<string>;
export function measureStoreFacts(home: string, role: string): StoreFacts;
export function removeStaleTemps(home: string): string[];
export function removeStaleMigrationTemps(home: string): { removed: string[]; bytes: number };
export function createStore(home: string, opts?: { storeId?: string; bind?: { kind: 'rebuild'; nowMs: number } }): { storeId: string; writer: string };
export function finishPending(home: string): void;
export function dropPending(home: string): void;
export function syncWriterMirror(db: DatabaseSync, home: string): void;
export function measureAttempts(home: string, n: number): { state: 'absent' | 'count' | 'unmeasured'; count: number };
export function readAttempts(home: string, n: number): number;
export function clearDoneMarkers(home: string, version: number): string[];
export function assertAdditive(prev: Record<string, readonly string[]>, next: Record<string, readonly string[]>): void;
export function runMigration(db: DatabaseSync, home: string, i: {
  verdict: MigrationVerdict; from: number; to: number; migrations: readonly string[];
}): { snapshot: string; copyBps: number };
export const BR_QUALITY: 5;
export function compressFdRange(fd: number, start: number, end: number): Promise<{ sha: Buffer; z: Buffer; rawLen: number } | null>;
export const FTS_DDL: readonly string[];
export function createFtsTables(db: import('node:sqlite').DatabaseSync): void;


export function getStep(db: DatabaseSync, step: string, version: number): { cursor: string | null; completedMs: number | null } | null;
export function setStep(db: DatabaseSync, step: string, version: number, cursor: string | null, completedMs?: number | null): void;

// --- W1-B2 Task 9: lineage (§6.3; the P7 range CTE) and the edge lookups
export interface LineageRow { readonly nodeId: string; readonly entryId: number; readonly ord: number; readonly tsMs: number | null }
export function lineageEntries(db: DatabaseSync, nodeId: string): LineageRow[];
export function childrenOf(db: DatabaseSync, nodeId: string): { childId: string; ord: number }[];
export function parentOf(db: DatabaseSync, nodeId: string): string | null;

// ── W1-B2 Task 19: a registered recovery step (RB6) and the stored version (RB13, RB17) ──
export function recoverOpenOn(db: DatabaseSync): boolean;
export const FTS_GATE_SQL: Readonly<{ table: string; backfill: string; rebuild: string }>;
export function ftsGateFactsOn(db: DatabaseSync): { probe: 'present' | 'absent' | 'threw'; table: boolean; rebuilding: boolean; completed: boolean };
export function recoverStepAt(dbFile: string): 'open' | 'none' | 'absent' | 'unmeasured';
export function storedVersionAt(dbFile: string): Presence<number>;
// ── W1-B2 Task 20: prune by referrer age (§6.6) ──
export function pruneProtected(db: DatabaseSync): Set<number>;
export function pruneCandidates(db: DatabaseSync, i: {
  cutoffMs: number; afterBlobId: number; limit: number; protectedIds: ReadonlySet<number>;
}): { blobIds: number[]; bytes: number; exported: number; lastBlobId: number; more: boolean };
export function pruneBatch(db: DatabaseSync, i: {
  blobIds: readonly number[]; nowMs: number; fts: boolean; onDeleted?: () => void;
}): number;
export function pruneDryRun(db: DatabaseSync, cutoffMs: number): { blobs: number; bytes: number; exported: number };
export function incrementalVacuum(db: DatabaseSync, pages: number): number;
export function pruneApply(db: DatabaseSync, i: {
  cutoffMs: number; nowMs: number; batch: number; vacuumPages: number; between: () => void; onDeleted?: () => void;
}): { blobs: number; bytes: number; fts: boolean };
export function removeStaleBackupTemps(home: string): void;
export function writeBackup(db: DatabaseSync, home: string, i: { nowMs: number }): {
  name: string; sizeBytes: number; copyBps: number;
};

export function integrityCheck(db: DatabaseSync): string[];
export function foreignKeyRows(db: DatabaseSync): FkRow[];
export function ftsMeasure(db: DatabaseSync): { tables: Set<string>; columns: Record<string, string[]> };
export function dropFtsTables(db: DatabaseSync): void;
export function setCounter(db: DatabaseSync, name: string, n: number): void;

// ── W1-B2 Task 24: the binding verbs' sequences ──
export function adoptStore(home: string, i: { nowMs: number }): { storeId: string; writer: string };
export interface StagedRestore {
  readonly tempPath: string; readonly storeId: Presence<string>; readonly userVersion: number | null;
  readonly integrityOk: boolean; readonly sizeBytes: number;
}
export function stageRestore(home: string, name: string): StagedRestore;
/** The caller's belt-witness hooks (ruling R-witness-restore): `check` first in the bind transaction, `stamp` last. */
export interface RestoreBelt { check(db: DatabaseSync): void; stamp(db: DatabaseSync): void }
export function commitRestore(home: string, staged: StagedRestore, i: {
  nowMs: number; pairs?: readonly { len: number; sha256: string; t: number }[]; belt?: RestoreBelt | null;
}): { storeId: string; writer: string };
export function abortRestore(staged: StagedRestore): void;

// --- W1-B4 Task 4: export segments (spec §9.15 "Write", "Who reads it"; §9.14 "Export replay")
/** A dev, an ino or a nanosecond time: a number on the way in, a BigInt on the way out of a reader. */
export type SegmentInt = number | bigint;
export const SEGMENT_DDL: readonly string[];
export interface SegmentMeta { storeId: string; writer: string; seq: number; harnesses: readonly string[]; cutoffMs: number; format: number }
export interface SegmentHandle { db: DatabaseSync | null; readonly temp: string; readonly name: string }
export interface SegmentBlobRow { sha256: Uint8Array; codec: string; raw_len: number; z: Uint8Array | null; pruned: boolean }
export interface SegmentRows {
  family: { ccrc_id: string; generation: string; project: string; first_seen_ms: number };
  transcript: { cc_session_uuid: string; agent_id: string; harness: string; parent_tool_use_id: string | null; workflow_run_id: string | null; agent_type: string | null };
  epoch: {
    ccrc_id: string; generation: string; seq: number; cc_session_uuid: string; cause: string; declared_by: string;
    started_ms: number | null; cwd: string | null; cwd_real: string | null; git_branch: string | null; confirmed_ms: number | null;
  };
  file: { path: string; dev: SegmentInt; ino: SegmentInt; cc_session_uuid: string; agent_id: string; size: number | null; mtime_ns: SegmentInt | null; eof_ms: number | null };
  entry: {
    uuid: string; cc_session_uuid: string; agent_id: string; type: string; subtype: string | null; role: string | null; model: string | null;
    parent_uuid: string | null; ts_ms: number | null; request_id: string | null; api_block_index: number | null; msg_id: string | null;
    source_tool_use_id: string | null; tool_name: string | null; is_compact_summary: number; provenance: string; prov_version: number;
    parse_state: string; struct_rank_ns: SegmentInt; struct_path: string; struct_dev: SegmentInt; struct_ino: SegmentInt; blob_sha256: Uint8Array;
  };
  variant: { uuid: string; blob_sha256: Uint8Array; first_path: string; first_dev: SegmentInt; first_ino: SegmentInt; first_seen_ms: number; cause: string };
  boundary: {
    uuid: string; cc_session_uuid: string; agent_id: string; boundary_ord: number; trigger: string | null; head_uuid: string | null;
    anchor_uuid: string | null; tail_uuid: string | null; kept_sha256: Uint8Array | null; pre_tokens: number | null; post_tokens: number | null;
    duration_ms: number | null;
  };
  sidecar: { cc_session_uuid: string; agent_id: string; name: string; blob_sha256: Uint8Array; uuid: string | null; first_seen_ms: number };
  membership: { path: string; dev: SegmentInt; ino: SegmentInt; uuid: string; line: number };
}
export type SegmentRowKind = keyof SegmentRows;
export type SegmentInserts = { blob(row: SegmentBlobRow): void } & { [K in SegmentRowKind]: (row: SegmentRows[K]) => number };
export type SegmentRowRead = { [K in SegmentRowKind]: { ord: number; kind: K; row: SegmentRows[K] } }[SegmentRowKind];
export function ensureSegmentDir(exportRoot: string, storeId: string): string;
export function createSegment(dir: string, name: string, meta: SegmentMeta): SegmentHandle;
export function segmentInserts(seg: SegmentHandle): SegmentInserts;
export function publishSegment(seg: SegmentHandle, dir: string, name: string): 'linked' | 'exists';
export function setSegmentSeq(temp: string, seq: number): void;
export function openSegment(path: string): DatabaseSync;
export function segmentMeta(db: DatabaseSync): SegmentMeta;
export function segmentBlobsAfter(db: DatabaseSync, rowid: number, maxBytes: number, kind: 'bytes' | 'stubs'): Array<SegmentBlobRow & { rowid: number }>;
export function segmentHasBlob(db: DatabaseSync, sha256: Uint8Array): boolean;
export function segmentRowsAfter(db: DatabaseSync, ord: number, limit: number): SegmentRowRead[];
export function segmentFileFacts(path: string): SegmentFileFacts;
export function listSegments(dir: string): { name: string; seq: number; writer: string; bytes: number }[];
export function removeStaleSegmentTemps(dir: string): string[];
