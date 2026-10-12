// The expiry lane's attention list (workspace lifecycle wave 3b) — its ONE reader, and the words for its kinds.
//
// ITS OWN FILE, not `childReclaimWords.ts`'s: the two lists ride one frame and render in one row (the fleet's one
// cleanup switch), but they are two populations with two vocabularies, and child reclamation's run chip must never
// see an expiry. The sentence is the SERVER's — the pid, the command and the path of a process that keeps a row among
// them — and the PWA renders it and maps nothing.
import type { ExpiryAttention } from '../../../shared/api';

/** What the row says before the server's sentence, by kind. A kind from a newer server reads as `reported`. */
export const EXPIRY_KIND_WORD: Readonly<Record<ExpiryAttention['kind'], string>> = {
  'would-expire': 'would clean up',
  held: 'held',
  'in-use': 'in use',
  refused: 'refused',
  failing: 'failing',
  'no-evidence': 'no evidence',
  kept: 'cleaned up, kept',
};

export const expiryKindWord = (kind: string): string =>
  Object.prototype.hasOwnProperty.call(EXPIRY_KIND_WORD, kind)
    ? EXPIRY_KIND_WORD[kind as ExpiryAttention['kind']] : 'reported';

/** Only the fields the row RENDERS, plus the shape sanity that tells a member from junk. */
type RenderedExpiry = Pick<ExpiryAttention, 'sessionId' | 'kind' | 'sentence'>;

const isExpiry = (a: unknown): a is RenderedExpiry => {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return typeof o.sessionId === 'string' && typeof o.kind === 'string' && typeof o.sentence === 'string';
};

/** THE ONE READER of `CoordStatus.expiryAttention`. An absent field (an older server) reads as no items, and a
 *  malformed member is dropped on its own rather than taking the list with it. */
export function expiryAttentionOf(coord: unknown): RenderedExpiry[] {
  if (typeof coord !== 'object' || coord === null) return [];
  const list = (coord as { expiryAttention?: unknown }).expiryAttention;
  return Array.isArray(list) ? list.filter(isExpiry) : [];
}
