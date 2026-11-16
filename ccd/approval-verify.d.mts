// ccd/approval-verify.d.mts — types for the vitest import of approval-verify.mjs (the `compact-card.d.mts`
// precedent). Hand-written.
export const RECORD_KEYS: readonly string[];
export function canonical(v: unknown): string | null;
export function recordBytes(r: unknown): string | null;
export interface Expected { sessionId: string; agentId: string; digest: string; nonce: string; rowId: number; now: number }
export function verdictFor(ruling: unknown, expected: Expected, pem: string): string | null;
