// ccd/history/store.d.mts — types for the vitest import of store.mjs (the
// compact-card.d.mts precedent). Hand-written; grows with each task. Nothing
// machine-checks it against store.mjs, so every export is declared here.
import type { DatabaseSync } from 'node:sqlite';
import type { FkRow, MigrationVerdict, PairIndex, Presence, StoreFacts } from './lib.mjs';

export const CODEC: 'br5';
export class StoreError extends Error {
  constructor(word: string, message: string);
  readonly word: string;
}
export const MIGRATIONS: readonly string[];
export function openWriter(dbPath: string): DatabaseSync;
export function openReader(dbPath: string): DatabaseSync;
export function userVersion(db: DatabaseSync): number;
export function probeFts5(db: DatabaseSync): 'present' | 'absent';
export function withTx<T>(db: DatabaseSync, sync: 'NORMAL' | 'FULL', fn: () => T): T;
export function brotli(buf: Uint8Array): Buffer;
export function unbrotli(z: Uint8Array, maxLen: number): Buffer;
export function unbrotliPrefix(z: Uint8Array, max: number): Promise<{ bytes: Buffer; decoded: number; whole: boolean }>;
export function blobPlainText(z: Uint8Array, isSidecar: boolean, idx: PairIndex | null, rawLen: number): string;
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
export function createStore(home: string): { storeId: string; writer: string };
export function finishPending(home: string): void;
export function dropPending(home: string): void;
export function syncWriterMirror(db: DatabaseSync, home: string): void;
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
