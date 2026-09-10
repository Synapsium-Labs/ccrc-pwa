// ccd/compact-card.d.mts — types for the vitest import of compact-card.mjs
// (the `shared/mark.d.mts` precedent). Hand-written; grows with each task.
export const EXIT: Readonly<{ OK: 0; FAILURE: 1; USAGE: 2; EMPTY: 3 }>;
export const WINDOW_CAP: number;
export const CHUNK: number;
export interface WindowResult { text: string; boundary: boolean }
export function isBoundaryLine(line: string): boolean;
export function readWindow(path: string, cap?: number, chunkSize?: number): WindowResult;
export function parseArgs(argv: string[]):
  { cmd: string | undefined; opts: Record<string, string | true>; error?: undefined } | { error: string; cmd?: undefined; opts?: undefined };
export function main(argv: string[]): number;
export type Tag = 'edited' | 'touched' | 'carried';
export const TAGS: readonly Tag[];
export const WORKSET_CAP: number;
export interface Token { token: string; tag: Tag }
export interface SetFile { path: string; tag: Tag; count: number }
export interface SetStats { tokens: number; resolved: number; ambiguous: number; outside: number; nomatch: number }
export function extensionsOf(files: Iterable<string>): string[];
export function tokenRegex(exts: string[]): RegExp | null;
export function mineTokens(windowText: string, re: RegExp | null): Token[];
export interface FileIndex { files: Set<string>; byBase: Map<string, string[]> }
export function fileIndex(files: Iterable<string>): FileIndex;
export function resolveToken(token: string, index: FileIndex, cwd: string):
  { path: string; reason?: undefined } | { reason: 'outside' | 'ambiguous' | 'nomatch'; path?: undefined };
export function workingSet(tokens: Token[], index: FileIndex, cwd: string, cap?: number): { files: SetFile[]; stats: SetStats };
