import type { FleetSession } from '../../../shared/api';
import { isUnseen, type Acks } from '../lib/seen';
import { sortFleet } from './sortFleet';

export interface FleetGroup {
  project: string;
  sessions: FleetSession[];
  /** Any member is waiting on you. A collapsed header wears this, so folding a
   *  project away can never hide the one thing this screen exists to surface. */
  attention: boolean;
  /** How many members a row would render the word `working` for — a straight
   *  read of `s.bucket === 'working'`. This count is rendered as a WORD on a
   *  folded card, so it is a claim about what the hidden rows say.
   *
   *  Before the server shipped one `bucket` per session (Task 1), this counted
   *  `status === 'busy' && !dialogPending` — a client-side re-derivation of
   *  SessionLine's own attention-first arbitration, kept in agreement with it
   *  by a comment ("KEEP the `&& !m.dialogPending` clause") rather than by
   *  anything the compiler could enforce. That clause, and the arbitration it
   *  was copying, are BOTH gone: `bucket` is the one field both this count and
   *  the row's own word read, so a `working`-bucket session cannot also be the
   *  one the fold's attention mark is about, and there is nothing left here to
   *  keep in agreement by hand. A reader who reintroduces a `!dialogPending`
   *  (or `!== 'attention'`) clause here is restoring a bug this field exists
   *  to end — the two facts cannot drift apart because there is only one of
   *  them now. */
  busy: number;
  /** How many LIVE members this device has not yet acknowledged —
   *  `isUnseen` (pwa/src/lib/seen.ts) run over `sessions`, the identical
   *  function every other unseen surface (a row's own badge, the bell) reads.
   *  Scoped to `live` for the same reason `attention`/`busy` are: an archived
   *  member (including a `cleanup`-bucket one) is folded into `archived`
   *  below, not counted here. */
  unseen: number;
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
   *  has. They take no part in `attention`, `busy`, `unseen` or `pin`: an
   *  archived session is stopped, so any status it still carries is stale. */
  archived: FleetSession[];
}

/**
 * Group the fleet by project, preserving the flat list's urgency ordering:
 * groups sort by their most urgent member, members sort by the fleet rule.
 * `acks` defaults to `{}` (nothing acknowledged) so callers that don't care
 * about the unseen count — most existing ones — don't have to pass it. Pure —
 * returns new arrays.
 */
export function groupFleet(sessions: FleetSession[], acks: Acks = {}): FleetGroup[] {
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
      attention: live.some((m) => m.bucket === 'attention'),
      busy: live.filter((m) => m.bucket === 'working').length,
      unseen: live.filter((m) => isUnseen(m, acks)).length,
      pin,
    });
  }
  return groups;
}
