// Types for ccd/history/overlord-read.mjs (Overlord W1, w1-board-history.md Task 3). The answer's shape is
// shared/overlordHistory.ts' OverlordHistoryAnswer, which this declaration names structurally so the plain module needs
// no TypeScript import.
export const OVERLORD_READ_BUSY_TIMEOUT_MS: number;
export const OVERLORD_READ_ANSWER_MAX_BYTES: number;
export interface OverlordReadRequest {
  verb: 'search' | 'describe' | 'expand';
  target: { kind: 'all' } | { kind: 'project'; project: string } | { kind: 'session'; session: string };
  agents: boolean;
  args: readonly string[];
}
/** One read over the store under `home`; never throws. */
export function overlordRead(home: string, request: OverlordReadRequest, nowMs: number): Promise<Record<string, unknown>>;
