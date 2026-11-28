// Types for ccd/history/overlord-read.mjs (Overlord W1, w1-board-history.md Task 3). The answer's shape is
// shared/overlordHistory.ts' OverlordHistoryAnswer, which this declaration names structurally so the plain module needs
// no TypeScript import.
export const OVERLORD_READ_BUSY_TIMEOUT_MS: number;
export const OVERLORD_READ_ANSWER_MAX_BYTES: number;
/** The touched runner's own budget between paths (Overlord W2, request record B1). */
export const TOUCHED_OPEN_BUDGET_MS: number;
/** The most sessions one touched item names (a hand copy of shared/overlordHistory.ts' bound). */
export const TOUCHED_SESSIONS_MAX: number;
export interface OverlordReadRequest {
  verb: 'search' | 'describe' | 'expand' | 'touched';
  target: { kind: 'all' } | { kind: 'project'; project: string } | { kind: 'session'; session: string };
  agents: boolean;
  args: readonly string[];
}
/** One read over the store under `home`; never throws. `mono` is the monotonic clock the touched budget reads. */
export function overlordRead(home: string, request: OverlordReadRequest, nowMs: number, mono?: () => number): Promise<Record<string, unknown>>;
