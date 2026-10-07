// The reclaim row's small vocabulary (child-reclamation wave 4) — parallel
// `Record<MarkerState, …>` tables, word and glyph, so no state is read out of
// colour alone (coordWords.ts's own discipline), and the ONE reader for each of
// the two `CoordStatus` fields this row renders.
//
// ITS OWN TABLES, not `MARKER_WORD`'s: those words are written for the
// coordinator pause ("dispatch would refuse"), and `coordWords.ts` says a
// second marker needs its own table rather than a widened reuse.
import { isMarkerState, type ChildReclaimAttention, type MarkerState } from '../../../shared/api';

/** `clear` does not read "children are reclaimed when their runs close" —
 *  a claim about BEHAVIOUR the frame cannot back.
 *  The server sends `reclaim` unconditionally, even from a fleet box that
 *  lacks the reclaim capabilities (the sweep then does nothing and the route
 *  answers 501); the frame carries no capability bit the PWA could read
 *  instead. So the word now claims only what `clear` actually measures — the
 *  SWITCH's own state, in the pause banner's own register (`MARKER_WORD.clear`
 *  is `'not paused'`) — and a stale box reveals itself through the tap's own
 *  inline 501, not through this word overclaiming what is running. */
export const CHILD_RECLAIM_MARKER_WORD: Record<MarkerState, string> = {
  // THE FLEET'S ONE CLEANUP SWITCH since workspace lifecycle wave 3b (that
  // design's §5.3 and §6 item 1): `reclaim-paused` stops child reclamation AND
  // the expiry of archived workspaces, so the words name the cleanup.
  clear: 'cleanup not paused',
  set: 'cleanup paused',
  // Names no cause. Two producers reach this word: the server's own
  // `unmeasurable` (its registry did not list) and `childReclaimMarker`'s
  // degrade arm for a value this build does not recognise — where the
  // registry DID list and a newer server said something this row cannot read.
  unmeasurable: 'cleanup switch unreadable',
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

// Checks only the fields `ChildReclaimBanner` actually RENDERS, plus the shape
// sanity that distinguishes a real member from junk. Two shapes are read, told
// apart by `sessionId` (the collapsed line has none):
//
//   • a single child — `sessionId`, `runId`, `sentence`. `token` and `at` are
//     fields of the two mirror arms of `ChildReclaimAttention`
//     (`shared/api.ts`) ONLY, a `kept` item carries a `word` instead, and
//     nothing here reads any of them (nor `kind`), so requiring one would
//     under-report: a row worth showing would silently vanish over a field this
//     row never displays, and a kept item has no `at` to require at all.
//   • a collapsed kept line — `kind: 'kept-many'`, a `word`, the server's
//     `sentence` (which already states the count) and the `members` behind it.
//     A member that is not a `{ sessionId, runId }` pair is dropped on its own,
//     and a line left with no member is dropped whole. The PWA counts nothing
//     itself.
type RenderedAttention = Pick<Extract<ChildReclaimAttention, { readonly sessionId: string }>, 'sessionId' | 'runId' | 'sentence'>;

/** A collapsed kept line (spec §5.9): the server's sentence, which already
 *  states the count, and the children behind it. `word` is a React key and
 *  nothing else: it is never rendered and never switched on. */
export interface RenderedKeptMany {
  readonly kind: 'kept-many'; readonly word: string; readonly sentence: string;
  readonly members: readonly { readonly sessionId: string; readonly runId: number }[];
}
export type RenderedAttentionItem = RenderedAttention | RenderedKeptMany;

const isAttention = (a: unknown): a is RenderedAttention => {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return typeof o.sessionId === 'string' && typeof o.sentence === 'string'
    && (o.runId === null || typeof o.runId === 'number');
};

const isKeptMember = (m: unknown): m is RenderedKeptMany['members'][number] => {
  if (typeof m !== 'object' || m === null) return false;
  const o = m as Record<string, unknown>;
  return typeof o.sessionId === 'string' && typeof o.runId === 'number';
};

/** A collapsed kept line whose `members` are still unchecked: `isKeptMany`
 *  has vouched for everything but each member, which the reader filters. */
type KeptManyWire = Omit<RenderedKeptMany, 'members'> & { readonly members: readonly unknown[] };

/** `kind`, a string `word` and `sentence`, an array `members` holding at least
 *  one real member. (An item left with no member names no child, so it is not
 *  a line.) */
const isKeptMany = (a: unknown): a is KeptManyWire => {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return o.kind === 'kept-many' && typeof o.word === 'string' && typeof o.sentence === 'string'
    && Array.isArray(o.members) && o.members.some(isKeptMember);
};

/** THE ONE READER of `CoordStatus.childReclaimAttention`. The coord frame is
 *  shape-checked only at FRAME level (`stores/fleet.ts`), so an absent field
 *  (an older server) reads as no items, and a malformed member is dropped on
 *  its own rather than taking the list with it. The server's order is kept:
 *  a collapsed line stays where the server put it among the single items. */
export function childReclaimAttentionOf(coord: unknown): RenderedAttentionItem[] {
  if (typeof coord !== 'object' || coord === null) return [];
  const list = (coord as { childReclaimAttention?: unknown }).childReclaimAttention;
  if (!Array.isArray(list)) return [];
  const items: RenderedAttentionItem[] = [];
  for (const a of list) {
    if (isAttention(a)) items.push(a);
    else if (isKeptMany(a)) {
      items.push({ kind: 'kept-many', word: a.word, sentence: a.sentence, members: a.members.filter(isKeptMember) });
    }
  }
  return items;
}
