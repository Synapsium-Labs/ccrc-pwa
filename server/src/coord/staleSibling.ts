import type { RunState } from '../../../shared/api.js';

/**
 * The stale sibling (D-TBD-kept-reason-visible). L1: pure, no store, no
 * registry, no clock.
 *
 * A child's workspace is kept while another open run names its session (`siblings-open`). A run that opened for an
 * earlier occupant of a reused workspace name, or one a coordinator planned and then never dispatched before it was
 * archived, can name the session for weeks and release nothing. Such a run is a STALE SIBLING and does not keep the
 * child, on all four counts:
 *  - it is `planned`: no worker was ever sent;
 *  - it has no dispatch stamp of either kind (`dispatchStartedAt`, `dispatchedAt`);
 *  - it opened more than fourteen days ago, written `!(age > ceiling)` so a stamp from the future or a NaN keeps it;
 *  - its claimant is provably archived or no longer listed. A live claimant, an unmeasured one and an ownerless run
 *    all keep it: only a proven absence of anyone to dispatch it lets a run be ignored.
 *
 * It is ignored, never closed: closing a run is the coordinator's or the operator's act (Abandon, never Reclaim).
 * Every reader of a child's siblings splits them through `splitSiblings`, so the sweep's count, the stale arm's check,
 * the executor's step 2 and the hold-release job cannot disagree.
 */
export const STALE_SIBLING_MS = 14 * 24 * 3_600_000;

/** What the registry says of a run's claimant: `archived-or-gone` is a PROVEN archive or absence; every doubt is
 *  `unmeasured` and keeps the run. */
export type ClaimantState = 'live' | 'archived-or-gone' | 'unmeasured';

/** The columns of an open run the rule reads. */
export interface SiblingFact {
  readonly id: number;
  readonly state: RunState;
  readonly openedAt: number;
  readonly dispatchStartedAt: number | null;
  readonly dispatchedAt: number | null;
  readonly claimedBy: string | null;
}

/** A sibling run as a surface names it: the id and when it opened. */
export interface SiblingRef { readonly id: number; readonly openedAt: number }

export interface SiblingSplit {
  /** The siblings that keep the child, in id order. */
  readonly live: readonly SiblingRef[];
  /** The siblings the rule ignores, in id order. */
  readonly stale: readonly SiblingRef[];
}

export function isStaleSibling(f: SiblingFact, claimant: ClaimantState, nowMs: number): boolean {
  if (claimant !== 'archived-or-gone') return false;
  if (f.state !== 'planned' || f.dispatchStartedAt !== null || f.dispatchedAt !== null) return false;
  return nowMs - f.openedAt > STALE_SIBLING_MS;
}

/** Splits a child's open sibling runs. `claimantOf` is told the run's `claimedBy`; an ownerless run has no claimant
 *  to prove gone and is never asked about. */
export function splitSiblings(
  facts: readonly SiblingFact[], claimantOf: (claimedBy: string) => ClaimantState, nowMs: number,
): SiblingSplit {
  const live: SiblingRef[] = [];
  const stale: SiblingRef[] = [];
  for (const f of [...facts].sort((a, b) => a.id - b.id)) {
    const claimant: ClaimantState = f.claimedBy === null ? 'live' : claimantOf(f.claimedBy);
    (isStaleSibling(f, claimant, nowMs) ? stale : live).push({ id: f.id, openedAt: f.openedAt });
  }
  return { live, stale };
}

/** The registry's single-row read, as the claimant state: a proven absence or an archive is gone, a live row is live,
 *  an unassemblable row, an unlistable registry and a bad id are doubt. */
export function claimantStateOfRead(
  read: { readonly kind: 'found'; readonly record: { readonly archivedAt: number | null } }
    | { readonly kind: 'absent' | 'unmeasurable' | 'unlistable' | 'bad-id' },
): ClaimantState {
  switch (read.kind) {
    case 'absent': return 'archived-or-gone';
    case 'found': return read.record.archivedAt !== null ? 'archived-or-gone' : 'live';
    default: return 'unmeasured';
  }
}
