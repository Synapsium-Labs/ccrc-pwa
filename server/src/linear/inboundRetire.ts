// The retire of a stored inbound row, as words and a rule (review 2457 F4, A6; D-8735). L1: pure, no I/O, imports only types. Its own
// file so the plan store (L3) and the inbound policy (L1) both reach it without importing each other.
import type { InboundRow } from '../coord/planStore.js';

/** Why a stored inbound row was retired (review 2457 F4, D-8735): its issue was completed or canceled, turned out to be ccrc's own,
 *  or left the managed teams (`moved-out`, D-8733: inbound counts only issues now in a managed team). THE ONE LIST: the store's
 *  narrowing reader and the retire verdicts derive from it. */
export const RETIRE_WHYS = ['completed', 'canceled', 'ccrc-own', 'moved-out'] as const;
export type RetireWhy = (typeof RETIRE_WHYS)[number];
/** A stored `retiredWhy` as the store reads it: an unknown word (a newer build's, a hand edit) reads as null, never as a cause. */
export const retireWhyOf = (v: unknown): RetireWhy | null => (RETIRE_WHYS as readonly unknown[]).includes(v) ? (v as RetireWhy) : null;

/** Whether a stored row may be retired (D-8735): one the owner, a coordinator or the operator still has to act on, and a close not
 *  yet written to Linear (an acted or given-up close is ccrc's own cancel and stays). `taken` and `placed` are bound tickets (the
 *  drift pass's, never the inbound lane's), and a `retired` row already is. The one rule `inboundRetireVerdict`, the store's
 *  `retireInbound`, the doors' re-read and the lane's re-read all ask. */
export const inboundRetirable = (row: Pick<InboundRow, 'state' | 'actedAt'>): boolean =>
  row.state === 'waiting' || row.state === 'mailed' || row.state === 'handed' || row.state === 'raised' || (row.state === 'closed' && row.actedAt === null);
