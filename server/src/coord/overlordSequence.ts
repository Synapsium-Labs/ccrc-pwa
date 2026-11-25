// The one sequence's deciders (Overlord spec §10.4 "One sequence" and "No stream of its own", H3, H27; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Tasks 1 and 3, questions 5, 7, 8 and 19). Ring L1,
// context C5: pure, L0 imports only, no clock, no database. Three deciders and one rule:
//   - `sequenceLineVerdict`: whether a line may be written (the writer's check, before any insert);
//   - `sequenceLineKnown`: whether this build can name a stored line (else it is served opaque, `known: false`);
//   - `sequencePage`: the cursor read's answer over one read of the facts and the lines (`ahead`, `gap` or a `page`);
//   - `retentionCut`: what the retention lane deletes, which never includes the newest line, or the newest `live` line, of `SEQUENCE_KEPT_KIND`.
import { ACTOR_KIND_MAP } from '../../../shared/overlord-identity.js';
import {
  SEQUENCE_ACTOR_MAX, SEQUENCE_ID_MAX, SEQUENCE_KEEP_MS, SEQUENCE_KIND_MAP, SEQUENCE_PAGE_MAX, isSequenceKind,
  type RestoreGeneration, type SequenceKind, type SequencePageWire, type SequenceWireLine,
} from '../../../shared/overlord-sequence.js';

/** Why a line may not be written, enumerated once; the type derives from it. */
export const LINE_REFUSALS = ['unknown-kind', 'unknown-state', 'bad-id', 'bad-actor', 'bad-actor-kind', 'bad-at'] as const;
export type LineRefusal = (typeof LINE_REFUSALS)[number];

const textWithin = (v: string, max: number): boolean => v.length > 0 && v.length <= max;

/** Whether a line may be written: its kind in the table, its state among the kind's words, its id and actor non-empty and
 *  within their bounds, its actor kind one of gates A's words, its time a non-negative integer. First match, in that order. */
export function sequenceLineVerdict(l: { kind: string; id: string; state: string; actor: string; actorKind: string; at: number }):
  { ok: true } | { ok: false; refusal: LineRefusal } {
  if (!isSequenceKind(l.kind)) return { ok: false, refusal: 'unknown-kind' };
  if (!(SEQUENCE_KIND_MAP[l.kind].states as readonly string[]).includes(l.state)) return { ok: false, refusal: 'unknown-state' };
  if (!textWithin(l.id, SEQUENCE_ID_MAX)) return { ok: false, refusal: 'bad-id' };
  if (!textWithin(l.actor, SEQUENCE_ACTOR_MAX)) return { ok: false, refusal: 'bad-actor' };
  if (!Object.hasOwn(ACTOR_KIND_MAP, l.actorKind)) return { ok: false, refusal: 'bad-actor-kind' };
  if (!Number.isSafeInteger(l.at) || l.at < 0) return { ok: false, refusal: 'bad-at' };
  return { ok: true };
}

/** Whether this build can name a stored line: its kind in the table, its state among that kind's words, and its actor kind a
 *  word of gates A. A line it cannot name is served with its stored text and `known: false`, never dropped and never a failed
 *  page (slug `unknown-lines-are-served-opaque`): a rollback build that lacks a later kind keeps serving it. */
export function sequenceLineKnown(kind: string, state: string, actorKind: string): boolean {
  return isSequenceKind(kind) && (SEQUENCE_KIND_MAP[kind].states as readonly string[]).includes(state)
    && Object.hasOwn(ACTOR_KIND_MAP, actorKind);
}

/** What the cursor read decides from, read with the lines in one synchronous read. */
export interface SequenceFacts {
  /** The highest seq ever issued (from `sqlite_sequence`), 0 before the first line. */
  readonly head: number;
  /** The highest seq any prune deleted, or null when nothing was pruned. */
  readonly prunedThrough: number | null;
}

/** A page's size: `limit` as an integer, at least one line and at most `SEQUENCE_PAGE_MAX`. */
const pageSize = (limit: number): number => Math.min(SEQUENCE_PAGE_MAX, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 1));

/** The cursor read's answer. First match: `after` above `head` is `ahead` (a restored database, or a reader holding numbers
 *  this database never issued); `after` below `prunedThrough` is `gap`, naming the floor; otherwise a page of the lines above
 *  `after`, in seq order, at most `limit`, with `next` the last line's seq (or `after` when there are none). `after` equal to
 *  the floor is no gap: the reader holds every line above it. Neither `ahead` nor `gap` is ever an empty page. */
export function sequencePage(after: number, limit: number, f: SequenceFacts, lines: readonly SequenceWireLine[],
  restoreGeneration: RestoreGeneration): SequencePageWire {
  if (after > f.head) return { kind: 'ahead', after, head: f.head, restoreGeneration };
  if (f.prunedThrough !== null && after < f.prunedThrough) {
    return { kind: 'gap', after, prunedThrough: f.prunedThrough, head: f.head, restoreGeneration };
  }
  const served = lines.filter((l) => l.seq > after).sort((a, b) => a.seq - b.seq).slice(0, pageSize(limit));
  return { kind: 'page', lines: served, next: served.length === 0 ? after : served[served.length - 1]!.seq, head: f.head, restoreGeneration };
}

/** The kind whose newest line, and newest `live` line, the retention lane never deletes. With no attempt pending the newest
 *  designation line is the current binding's (a rebind's go-live stamps the old body `retired` before the new one `live`); while
 *  a rebind is pending, or after one failed, the newest line is the attempt's and the binding's is the newest `live` line, so
 *  both are kept, and I5's term arm reads them as the window's baseline (slug `newest-designation-line-is-kept`; review 3740
 *  F2). They sit below the floor once the lines around them are pruned, so the cursor read never serves them again. */
export const SEQUENCE_KEPT_KIND: SequenceKind = 'designation';

/** What the retention lane deletes: of the oldest lines in seq order, the highest seq of the leading run older than
 *  `now - SEQUENCE_KEEP_MS` (Table 11.5b, the wall clock), with each line of that run marked `keep` named to be kept; or
 *  none. The run stops at the first line not yet old, so a line is never deleted while an older-numbered one stays younger,
 *  and a wall clock stepped back deletes nothing new. */
export function retentionCut(now: number, oldest: readonly { seq: number; at: number; keep: boolean }[]):
  { through: number; keep: readonly number[] } | { through: null } {
  const cutoff = now - SEQUENCE_KEEP_MS;
  let through: number | null = null;
  const keep: number[] = [];
  for (const l of [...oldest].sort((a, b) => a.seq - b.seq)) {
    if (!(l.at < cutoff)) break;
    through = l.seq;
    if (l.keep) keep.push(l.seq);
  }
  return through === null ? { through: null } : { through, keep };
}
