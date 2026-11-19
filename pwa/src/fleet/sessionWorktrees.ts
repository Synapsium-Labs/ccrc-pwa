// A session's worktrees as its details draw them (D-8782: they moved here from the fleet list's rows). `leasesStartedBy`
// (`delegationWords.ts`) is the one reader of the frame; this adds the two labels a row needs from the fleet's sessions: the
// worker a lease is `via`, and the session an inferred lease may be attached to. Pure (L1).
import type { DelegationLeaseWire, FleetSession } from '../../../shared/api';
import { leaseParentOf, listedLive } from './delegationWords';
import { sessionLabel } from './sessionLabel';

/** One worktree of a session's details: the lease and the two labels its row names. `viaLabel` is the worker the lease is
 *  `via` (null on that worker's own page, or with none); `attachLabel` is the label of the lease's own session while that
 *  session is listed live, else null (the words module offers Attach only then, F4). */
export interface SessionWorktree {
  readonly lease: DelegationLeaseWire;
  readonly viaLabel: string | null;
  readonly attachLabel: string | null;
}

/** A session by its display name, or its raw id when the fleet does not carry it. Display only, never a join key. */
const labelOf = (id: string, sessionOf: (id: string) => FleetSession | null): string => {
  const s = sessionOf(id);
  return s === null ? id : sessionLabel(s);
};

/** The two labels of one lease on `selfId`'s page. */
export function worktreeSides(
  l: DelegationLeaseWire, selfId: string, sessionOf: (id: string) => FleetSession | null,
): { viaLabel: string | null; attachLabel: string | null } {
  const parent = leaseParentOf(l);
  return {
    viaLabel: l.via !== null && l.via !== selfId ? labelOf(l.via, sessionOf) : null,
    attachLabel: listedLive(sessionOf(parent)) ? labelOf(parent, sessionOf) : null,
  };
}

/** The labels as one string, for a store selector that must return a primitive (so a fleet frame that changes no label
 *  re-renders nothing, C6); `worktreesOf` reads it back. */
export function worktreeSidesKey(
  leases: readonly DelegationLeaseWire[], selfId: string, sessionOf: (id: string) => FleetSession | null,
): string {
  return JSON.stringify(leases.map((l) => { const w = worktreeSides(l, selfId, sessionOf); return [l.leaseId, w.viaLabel, w.attachLabel]; }));
}

/** The session's worktrees with their labels, from the leases and `worktreeSidesKey`'s answer for the same leases. */
export function worktreesOf(leases: readonly DelegationLeaseWire[], key: string): readonly SessionWorktree[] {
  const sides = new Map((JSON.parse(key) as [string, string | null, string | null][]).map(([id, v, a]) => [id, { viaLabel: v, attachLabel: a }] as const));
  return leases.map((lease) => ({ lease, ...(sides.get(lease.leaseId) ?? { viaLabel: null, attachLabel: null }) }));
}
