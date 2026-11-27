// Types for the vitest import of timing-report.mjs (the `ccd/approval-verify.d.mts` precedent). Hand-written.
export function summarise(ms: number[]): { n: number; median: number; p90: number; total: number };
export function parseEntryLog(text: string): Map<string, number[]>;
export function parseUnitJournal(text: string, sinceMs: number): Map<string, number[]>;
