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
  /** How many LIVE members this device has not yet acknowledged — `isUnseen`
   *  (pwa/src/lib/seen.ts) run over `sessions`.
   *
   *  NOTHING RENDERS THIS YET. It is part of the group shape so a per-project
   *  badge has a count to read, and it is pinned by groupFleet.test.ts, but
   *  the only unseen surface that ships today is the fleet screen's bucket
   *  bar — and that one cannot use this field, because a bucket spans projects
   *  while a group is one project. What it does buy is the rule: when a row
   *  badge or a bell counter arrives, it counts with `isUnseen` like this
   *  does, rather than re-implementing the comparison (spec §2, "one writer").
   *
   *  Scoped to `sessions` for the same reason `attention`/`busy` are. A
   *  `cleanup` member IS in that list and IS counted here — it is a badged
   *  bucket (seen.ts's `BADGED`), so a per-project badge that skipped it
   *  would undercount against the bucket bar's own Cleanup chip. */
  unseen: number;
  /** The account every session in this project calls home, or null when they
   *  disagree. Pinning is per session (`ccd prefer <id> <wrapper>`), so a
   *  project-level pin only exists where its sessions happen to share one.
   *  Null means DISAGREEMENT, not "unknown": a group always holds at least one
   *  session and `home` is non-nullable on the wire, so there is always at
   *  least one value to compare. */
  pin: string | null;
  /** Members in the `archived` BUCKET — folded out of the live list, never
   *  dropped. `/s/<id>` still resolves and the transcript still renders, so a
   *  card that omitted them entirely would leave the workspace reachable only
   *  by a URL nobody has. They take no part in `attention`, `busy`, `unseen`
   *  or `pin`: an archived session is stopped, so any status it still carries
   *  is stale.
   *
   *  `s.bucket === 'archived'`, NOT `archivedAt !== null` — and the difference
   *  is the whole point. Both predicates are true of a `cleanup` session, so
   *  the `archivedAt` one swept every merged-and-archived workspace into a
   *  collapsed fold NAMED AFTER A DIFFERENT BUCKET: the bucket bar counted
   *  `Cleanup 1` and offered "Mark all seen" for a row that rendered nowhere
   *  on the screen, while the fold above the footer read `Archived (2)`. Its
   *  own facts — `merged`, `#157`, the reclaimable size — were unreachable
   *  without expanding a fold that disclaims them. Splitting on the bucket
   *  makes this list exactly the `Archived` chip's members and leaves
   *  `cleanup` in `sessions`, where its chip's count and its rows agree.
   *
   *  The fleet footer (`FleetScreen`'s route into `/archive`) is a THIRD,
   *  deliberately wider set — everything with an `archivedAt`, because that
   *  is the disk fact — which is why it no longer says the bare word
   *  "Archived". */
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
    // See the `archived` field's doc: the split is on the BUCKET, so a
    // `cleanup` member stays in the live list its own chip counts it in.
    const live = members.filter((m) => m.bucket !== 'archived');
    const archived = members.filter((m) => m.bucket === 'archived');
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
