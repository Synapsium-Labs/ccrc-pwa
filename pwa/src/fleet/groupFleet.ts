import type { FleetSession } from '../../../shared/api';
import { sortFleet } from './sortFleet';

export interface FleetGroup {
  project: string;
  sessions: FleetSession[];
  /** Any member is waiting on you. A collapsed header wears this, so folding a
   *  project away can never hide the one thing this screen exists to surface. */
  attention: boolean;
  /** How many members a row would render the word `working` for. Not "how many
   *  hold status: 'busy'" — SessionLine ranks attention first
   *  (`busy = !attention && status === 'busy'`), so a busy session with a
   *  pending dialog reads `waiting`. This count is rendered as a WORD on a
   *  folded card, so it is a claim about what the hidden rows say; counting a
   *  waiting session here makes the head contradict them. */
  busy: number;
  /** The account every session in this project calls home, or null when they
   *  disagree. Pinning is per session (`ccd prefer <id> <wrapper>`), so a
   *  project-level pin only exists where its sessions happen to share one.
   *  Null means DISAGREEMENT, not "unknown": a group always holds at least one
   *  session and `home` is non-nullable on the wire, so there is always at
   *  least one value to compare. */
  pin: string | null;
  /** Archived members — folded out of the live list, never dropped. `/s/<id>`
   *  still resolves and the transcript still renders, so a card that omitted
   *  them entirely would leave the workspace reachable only by a URL nobody
   *  has. They take no part in `attention`, `busy` or `pin`: an archived
   *  session is stopped, so any status it still carries is stale. */
  archived: FleetSession[];
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
    const live = members.filter((m) => m.archivedAt === null);
    const archived = members.filter((m) => m.archivedAt !== null);
    // `live` can be empty (every workspace of a project archived), so the pin
    // falls back to the whole membership rather than indexing an empty array.
    const forPin = live.length > 0 ? live : members;
    const pin = forPin.every((m) => m.home === forPin[0]!.home) ? forPin[0]!.home : null;
    groups.push({
      project,
      sessions: live,
      archived,
      attention: live.some((m) => m.status !== 'dead' && m.dialogPending),
      // Same predicate SessionLine renders, attention-first — see the field's
      // doc. Dead sessions need no clause: `dead` and `busy` are exclusive
      // statuses, which is also why `attention` needs its explicit one.
      // KEEP the `&& !m.dialogPending` clause: it is main's fix (4b5bb67) and
      // two tests in groupFleet.test.ts pin it. `busy` is a claim about what
      // the hidden rows SAY, and a row with a pending dialog says `waiting`.
      busy: live.filter((m) => m.status === 'busy' && !m.dialogPending).length,
      pin,
    });
  }
  return groups;
}
