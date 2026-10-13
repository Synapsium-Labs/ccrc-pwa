// The dead-coordinator lane's attention list (workspace lifecycle wave 4) — its ONE reader, and the words for its kinds.
//
// ITS OWN FILE, beside `expiryWords.ts` and sharing nothing with it: three populations ride one frame and render in one
// row (the fleet's one cleanup switch), and each list stays its own. The sentence is the SERVER's — the claimant, why it
// reads crashed, since when, and what an armed lane would end — and the PWA renders it and maps nothing.
import type { DeadCoordinatorAttention } from '../../../shared/api';

/** What the row says before the claimants and the server's sentence, by kind. A kind from a newer server reads as
 *  `reported`. */
export const DEAD_COORDINATOR_KIND_WORD: Readonly<Record<DeadCoordinatorAttention['kind'], string>> = {
  'would-end': 'would end',
  unmeasured: 'cannot tell',
  stuck: 'stuck',
  breaker: 'held',
};

export const deadCoordinatorKindWord = (kind: string): string =>
  Object.prototype.hasOwnProperty.call(DEAD_COORDINATOR_KIND_WORD, kind)
    ? DEAD_COORDINATOR_KIND_WORD[kind as DeadCoordinatorAttention['kind']] : 'reported';

/** Only the fields the row RENDERS, plus the shape sanity that tells a member from junk. */
type RenderedDeadCoordinator = Pick<DeadCoordinatorAttention, 'kind' | 'claimants' | 'sentence'>;

const isDeadCoordinator = (a: unknown): a is RenderedDeadCoordinator => {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return typeof o.kind === 'string' && typeof o.sentence === 'string'
    && Array.isArray(o.claimants) && o.claimants.every((c) => typeof c === 'string');
};

/** THE ONE READER of `CoordStatus.deadCoordinatorAttention`. An absent field (an older server) reads as no items, and
 *  a malformed member is dropped on its own rather than taking the list with it. */
export function deadCoordinatorAttentionOf(coord: unknown): RenderedDeadCoordinator[] {
  if (typeof coord !== 'object' || coord === null) return [];
  const list = (coord as { deadCoordinatorAttention?: unknown }).deadCoordinatorAttention;
  return Array.isArray(list) ? list.filter(isDeadCoordinator) : [];
}
