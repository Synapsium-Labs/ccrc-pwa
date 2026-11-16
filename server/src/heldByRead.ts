/**
 * The one reader of an audit document's holding rows (cleanup un-wedge R2, spec 2026-11-04 §4.3; its own leaf module
 * since Task C15, D-8111). Ring L1, context C4: pure, no I/O, and it imports L0 alone, so every lane parser
 * (`archivedExpiry.ts`, `collectLane.ts`, `coord/childReclaim.ts`) and `cleanupHeldBy.ts` take it from here and no two
 * of them import each other for it.
 *
 * ccd's rows rung adds `heldBy` and `heldByOwn` to each of the reclaim, expiry and collect audit documents.
 * `heldByOf` reads that pair; `heldByFieldOf` is the spread a lane parser puts on its read.
 */
import { HELD_BY_WORDS } from '../../shared/api.js';
import type { HeldByWord } from '../../shared/api.js';

/** ccd's measurement of a holding row's `workspace` registry field: no field, a workspace, or unreadable (or a link). */
export type HeldByWorkspace = 'absent' | 'present' | 'unreadable';

/** One holding row as ccd printed it. `workspace` is null when ccd's word is missing or outside the three. */
export interface HeldByRow { readonly id: string; readonly word: HeldByWord; readonly workspace: HeldByWorkspace | null }

/** What one audit document says about holding rows. `absent` is an older ccd, `not-reached` is a rung that did not
 *  run, `none` is a rung that ran and found no holding row, and `malformed` is a read the server does not trust. `own`
 *  is true when the child also had a fault of its own. */
export type HeldByRead =
  | { readonly kind: 'absent' } | { readonly kind: 'not-reached' } | { readonly kind: 'none' }
  | { readonly kind: 'rows'; readonly rows: readonly HeldByRow[]; readonly own: boolean }
  | { readonly kind: 'malformed' };

/** The one `absent` read. */
export const HELD_BY_ABSENT: HeldByRead = { kind: 'absent' };

const HELD_BY_NOT_REACHED: HeldByRead = { kind: 'not-reached' };
const HELD_BY_NONE: HeldByRead = { kind: 'none' };
const HELD_BY_MALFORMED: HeldByRead = { kind: 'malformed' };
const ROW_ID = /^[A-Za-z0-9._-]+$/;
const WORKSPACE_WORDS: readonly string[] = ['absent', 'present', 'unreadable'];

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Reads `heldBy` and `heldByOwn` from a parsed audit document. A missing key is `absent`; one bad member makes the
 *  whole read `malformed`; `own` is everything but an explicit `false`, so an unclear answer fails safe. */
export function heldByOf(doc: unknown): HeldByRead {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc) || !has(doc, 'heldBy')) return HELD_BY_ABSENT;
  const d = doc as Record<string, unknown>;
  const raw = d['heldBy'];
  if (raw === null) return HELD_BY_NOT_REACHED;
  if (!Array.isArray(raw)) return HELD_BY_MALFORMED;
  if (raw.length === 0) return HELD_BY_NONE;
  const out: HeldByRow[] = [];
  for (const m of raw as unknown[]) {
    if (typeof m !== 'object' || m === null || Array.isArray(m)) return HELD_BY_MALFORMED;
    const r = m as Record<string, unknown>;
    const id = r['id'];
    const word = r['word'];
    if (typeof id !== 'string' || !ROW_ID.test(id)) return HELD_BY_MALFORMED;
    if (typeof word !== 'string' || !(HELD_BY_WORDS as readonly string[]).includes(word)) return HELD_BY_MALFORMED;
    const ws = r['workspace'];
    out.push({
      id, word: word as HeldByWord,
      workspace: typeof ws === 'string' && WORKSPACE_WORDS.includes(ws) ? (ws as HeldByWorkspace) : null,
    });
  }
  return { kind: 'rows', rows: out, own: d['heldByOwn'] !== false };
}

/** What a lane parser spreads onto its read: `{ heldBy }` only when the document NAMES rows, else nothing. Every other
 *  answer (absent, not-reached, none, malformed) contributes no item and folds nothing, exactly as no read does, so a
 *  read without rows keeps the shape it had before R2. */
export function heldByFieldOf(doc: unknown): { readonly heldBy?: HeldByRead } {
  const read = heldByOf(doc);
  return read.kind === 'rows' ? { heldBy: read } : {};
}
