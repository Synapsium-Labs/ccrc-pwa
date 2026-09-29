// The reclaim row's small vocabulary (child-reclamation wave 4) — parallel
// `Record<MarkerState, …>` tables, word and glyph, so no state is read out of
// colour alone (coordWords.ts's own discipline), and the ONE reader for each of
// the two `CoordStatus` fields this row renders.
//
// ITS OWN TABLES, not `MARKER_WORD`'s: those words are written for the
// coordinator pause ("dispatch would refuse"), and `coordWords.ts` says a
// second marker needs its own table rather than a widened reuse.
import { isMarkerState, type ChildReclaimAttention, type MarkerState } from '../../../shared/api';

/** Fix round 1, Important 1: `clear` used to read "children are reclaimed
 *  when their runs close" — a claim about BEHAVIOUR the frame cannot back.
 *  The server sends `reclaim` unconditionally, even from a fleet box that
 *  lacks the reclaim capabilities (the sweep then does nothing and the route
 *  answers 501); the frame carries no capability bit the PWA could read
 *  instead. So the word now claims only what `clear` actually measures — the
 *  SWITCH's own state, in the pause banner's own register (`MARKER_WORD.clear`
 *  is `'not paused'`) — and a stale box reveals itself through the tap's own
 *  inline 501, not through this word overclaiming what is running. */
export const CHILD_RECLAIM_MARKER_WORD: Record<MarkerState, string> = {
  clear: 'reclaim not paused',
  set: 'child reclaim paused',
  unmeasurable: 'reclaim switch unreadable — the registry did not list',
};

export const CHILD_RECLAIM_MARKER_GLYPH: Record<MarkerState, string> = {
  clear: '·',
  set: '⏸',
  unmeasurable: '?',
};

/** THE ONE READER of `CoordStatus.reclaim`. THREE answers, never folded:
 *  `null` — the frame carries no such field, i.e. a server older than this
 *  switch, and the row renders NOTHING; a `MarkerState` it knows; and
 *  `'unmeasurable'` for a value it does not — a newer server's word degrades
 *  to doubt, never to `clear`, `markerState`'s own posture. */
export function childReclaimMarker(coord: unknown): MarkerState | null {
  if (typeof coord !== 'object' || coord === null) return null;
  const v = (coord as { reclaim?: unknown }).reclaim;
  if (v === undefined) return null;
  return isMarkerState(v) ? v : 'unmeasurable';
}

// Fix round 1, Minor 5: checks only the fields `ChildReclaimBanner` actually
// RENDERS — `sessionId`, `runId`, `sentence` — plus the shape sanity that
// distinguishes a real member from junk. `token` and `at` are real fields of
// `ChildReclaimAttention` (`shared/api.ts`) but nothing here reads either, so
// requiring them would under-report the moment a future server dropped the
// grep-only `token` or a computed `at` for one member: a row worth showing
// would silently vanish over a field this row never displays.
type RenderedAttention = Pick<ChildReclaimAttention, 'sessionId' | 'runId' | 'sentence'>;

const isAttention = (a: unknown): a is RenderedAttention => {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return typeof o.sessionId === 'string' && typeof o.sentence === 'string'
    && (o.runId === null || typeof o.runId === 'number');
};

/** THE ONE READER of `CoordStatus.childReclaimAttention`. The coord frame is
 *  shape-checked only at FRAME level (`stores/fleet.ts`), so an absent field
 *  (an older server) reads as no items, and a malformed member is dropped on
 *  its own rather than taking the list with it. */
export function childReclaimAttentionOf(coord: unknown): RenderedAttention[] {
  if (typeof coord !== 'object' || coord === null) return [];
  const list = (coord as { childReclaimAttention?: unknown }).childReclaimAttention;
  return Array.isArray(list) ? list.filter(isAttention) : [];
}
