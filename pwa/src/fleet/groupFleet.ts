import type { FleetSession } from '../../../shared/api';
import { sortFleet } from './sortFleet';

export interface FleetGroup {
  project: string;
  sessions: FleetSession[];
  /** Any member is waiting on you. A collapsed header wears this, so folding a
   *  project away can never hide the one thing this screen exists to surface. */
  attention: boolean;
  busy: number;
  /** The account every session in this project calls home, or null when they
   *  disagree. Pinning is per session (`ccd prefer <id> <wrapper>`), so a
   *  project-level pin only exists where its sessions happen to share one.
   *  Null means DISAGREEMENT, not "unknown": a group always holds at least one
   *  session and `home` is non-nullable on the wire, so there is always at
   *  least one value to compare. */
  pin: string | null;
}

/**
 * Group the fleet by project, preserving the flat list's urgency ordering:
 * groups sort by their most urgent member, members sort by the fleet rule.
 * Pure — returns new arrays.
 */
export function groupFleet(sessions: FleetSession[]): FleetGroup[] {
  const byProject = new Map<string, FleetSession[]>();
  for (const s of sortFleet(sessions)) {
    const list = byProject.get(s.project);
    if (list) list.push(s);
    else byProject.set(s.project, [s]);
  }

  // sortFleet already ordered the flat list, and Map preserves insertion
  // order — so the first session of each group IS its most urgent member, and
  // group order follows from it with no second comparator to drift.
  const groups: FleetGroup[] = [];
  for (const [project, members] of byProject) {
    // members is never empty (a Map entry is only created alongside its first
    // push), so the non-null assertions are safe under noUncheckedIndexedAccess.
    const pin = members.every((m) => m.home === members[0]!.home) ? members[0]!.home : null;
    groups.push({
      project,
      sessions: members,
      attention: members.some((m) => m.status !== 'dead' && m.dialogPending),
      busy: members.filter((m) => m.status === 'busy').length,
      pin,
    });
  }
  return groups;
}
