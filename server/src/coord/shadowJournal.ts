// DISK RETENTION shadow journal (D-TBD-shadow-journal), the server's side. L1 holds the read route's query decider; the
// recorder is the ONE door a shadow lane writes a verdict through, so no lane spells the row, and it never throws: a
// journal that cannot be written costs the row and never the lane's pass (the notice funnel's rule, `notice.ts`).
// The store (`CoordStore.recordShadowVerdict`) owns the table, its once-only key and its retention.
import type { CoordStore } from './store.js';
import {
  SHADOW_JOURNAL_DEFAULT_LIMIT, SHADOW_JOURNAL_MAX_LIMIT, SHADOW_LANES, isShadowLane, type ShadowLane, type ShadowVerdictInput,
} from '../../../shared/shadowJournal.js';

export type ShadowJournalQuery =
  | { readonly ok: true; readonly lane: ShadowLane | null; readonly subject: string | null; readonly limit: number }
  | { readonly ok: false; readonly detail: string };

/** The read route's query, decided: an unknown lane or a malformed limit is a refusal, never a silent default. */
export function decideShadowJournalQuery(q: { lane?: unknown; subject?: unknown; limit?: unknown }): ShadowJournalQuery {
  if (q.lane !== undefined && !isShadowLane(q.lane)) return { ok: false, detail: `lane must be one of ${SHADOW_LANES.join(', ')}` };
  if (q.subject !== undefined && (typeof q.subject !== 'string' || q.subject === '')) return { ok: false, detail: 'subject must be a non-empty string' };
  let limit = SHADOW_JOURNAL_DEFAULT_LIMIT;
  if (q.limit !== undefined) {
    const n = typeof q.limit === 'string' && /^[0-9]{1,6}$/.test(q.limit) ? Number(q.limit) : NaN;
    if (!Number.isSafeInteger(n) || n < 1 || n > SHADOW_JOURNAL_MAX_LIMIT) {
      return { ok: false, detail: `limit must be an integer from 1 to ${SHADOW_JOURNAL_MAX_LIMIT}` };
    }
    limit = n;
  }
  return { ok: true, lane: q.lane === undefined ? null : q.lane, subject: q.subject === undefined ? null : q.subject, limit };
}

/** Records a shadow verdict, once per key across restarts. Answers whether a new row landed; never throws. */
export function journalShadowVerdict(coord: Partial<Pick<CoordStore, 'recordShadowVerdict'>>, v: ShadowVerdictInput, now: number = Date.now()): boolean {
  try {
    return coord.recordShadowVerdict?.(v, now) ?? false;
  } catch (err) {
    console.warn(`ccrc-server: shadow journal (${v.lane}) not written — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
