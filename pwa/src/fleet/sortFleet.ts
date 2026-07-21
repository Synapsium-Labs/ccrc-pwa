import type { FleetSession } from '../../../shared/api';

/** Bucket priority: needs-you (pending dialog) → idle → working → dead. */
function bucket(s: FleetSession): number {
  if (s.status === 'dead') return 3;
  if (s.dialogPending) return 0;
  if (s.status === 'idle') return 1;
  return 2; // busy / working
}

/**
 * Order the fleet: needs-you first, then idle, then working, then dead; within
 * each bucket most-recently-interacted first (statusUpdatedAt desc, id as a
 * stable tiebreak). Pure — returns a new array.
 */
export function sortFleet(sessions: FleetSession[]): FleetSession[] {
  return [...sessions].sort((a, b) => {
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    const ta = a.statusUpdatedAt ?? -Infinity;
    const tb = b.statusUpdatedAt ?? -Infinity;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
