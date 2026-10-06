// ccd/history/store.d.mts — types for the vitest import of store.mjs (the
// compact-card.d.mts precedent). Hand-written; grows with each task. Nothing
// machine-checks it against store.mjs, so every export is declared here.
import type { DatabaseSync } from 'node:sqlite';

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
export function measuredSize(db: DatabaseSync, dbPath: string): number;
export function getMeta(db: DatabaseSync, k: string): string | null;
export function setMeta(db: DatabaseSync, k: string, v: string | number): void;
export function bump(db: DatabaseSync, name: string, by?: number): void;
export function closeWriter(db: DatabaseSync): void;
export function schemaOf(db: DatabaseSync): Record<string, string[]>;
