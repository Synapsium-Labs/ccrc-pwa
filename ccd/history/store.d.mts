// ccd/history/store.d.mts — types for the vitest import of store.mjs (the
// compact-card.d.mts precedent). Hand-written; grows with each task. Nothing
// machine-checks it against store.mjs, so every export is declared here.
import type { DatabaseSync } from 'node:sqlite';
import type { MigrationVerdict, Presence, StoreFacts } from './lib.mjs';

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
export function unbrotli(z: Uint8Array): Buffer;
export function unbrotliPrefix(z: Uint8Array, max: number): Promise<{ bytes: Buffer; decoded: number; whole: boolean }>;
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
