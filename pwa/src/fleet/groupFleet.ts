import type { FleetSession } from '../../../shared/api';
import { sortFleet } from './sortFleet';

export interface FleetGroup {
  project: string;
  sessions: FleetSession[];
  /** False for a project holding one session: it renders bare, with no header
   *  and no chevron. Most projects hold one and always will; the screen must
   *  not pay for worktrees it does not have. */
  grouped: boolean;
  /** Any member is waiting on you. A collapsed header wears this, so folding a
   *  project away can never hide the one thing this screen exists to surface. */
  attention: boolean;
  busy: number;
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
    groups.push({
      project,
      sessions: members,
      grouped: members.length > 1,
      attention: members.some((m) => m.status !== 'dead' && m.dialogPending),
      busy: members.filter((m) => m.status === 'busy').length,
    });
  }
  return groups;
}
