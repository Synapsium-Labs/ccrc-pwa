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
