import type { FleetSession } from '../../../shared/api';
import { isUnseen, type Acks } from '../lib/seen';
import { sortFleet } from './sortFleet';

/** The account a card's members call home — or why there is no one answer.
 *  `shared` when every member (live ones; all of them when every member is
 *  archived) carries the same `home`. `mixed` when they DISAGREE — a header
 *  asserting one account while two lines show two different ones would be a
 *  lie, and divergent pins across one project is worth noticing. `empty` when
 *  the card has NO member at all: a durable card (R5, D-3010) rendered from the
 *  project list rather than from its sessions. The third state exists because
 *  the old `string | null` had no honest value for it — `null` meant
 *  disagreement, and "nobody is here" is not a disagreement. */
export type FleetPin =
  | { state: 'shared'; home: string }
  | { state: 'mixed' }
  | { state: 'empty' };

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
  pin: FleetPin;
  /** How many LIVE members carry a strand marker — ccd's `$REG/<id>.stranded`,
   *  written when a hard-blocked session's pool (or the whole roster) has
   *  nothing that can take it (spec §5.8). This is the LOUD count: ruling 6
   *  turned a silence that retried every five seconds forever into a marker, a
   *  log line and a banner, and this is the number the card wears so a fold
   *  cannot hide it.
   *
   *  Counted as `(m.stranded ?? null) !== null`, never a truthiness test and
   *  never a read of `m.stranded.at`. TWO reasons, both producible: the live
   *  `fleet` frame is CAST, not revived (`stores/fleet.ts`'s `asFleetMsg`
   *  validates only `Array.isArray(sessions)`), so a row from a server
   *  predating this field has no key at runtime whatever the type says; and
   *  the registry's fail-shut arm answers `{at: 0, reason:
   *  STRANDED_UNREADABLE}` for a marker it could see and not read — a REAL
   *  strand whose date is unknown, which `at`-truthiness would drop in
   *  exactly the direction that hides a stuck session.
   *
   *  Scoped to `sessions` for the reason `attention`/`busy` are, and for one
   *  more: an archived session is stopped, so a marker it still carries
   *  describes a rescue that no longer has anything to rescue. */
  stranded: number;
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
 * Group the fleet by CARD, preserving the flat list's urgency ordering: the
 * populated groups sort by their most urgent member (members sort by the
 * fleet rule), and every KNOWN project renders a card whether or not
 * anything is on it (R5) — those follow, in the list's own order, because a
 * card with nothing on it has no urgency to sort by. The card set is the
 * union of `projects`, every session's rendered card and every session's own
 * project, so a card can never be destroyed by a workspace leaving it and a
 * project the list does not know (a workspace-only checkout — `listProjects`
 * skips linked worktrees) still renders under its own name. Deduped by name:
 * `listProjects` keys rows by workdir and can emit two rows with one name.
 * `acks` defaults to `{}` so callers that don't care about the unseen count
 * don't have to pass it. Pure — returns new arrays.
 */
export function groupFleet(
  sessions: FleetSession[], projects: readonly string[], acks: Acks = {},
): FleetGroup[] {
  const byProject = new Map<string, FleetSession[]>();
  for (const s of sortFleet(sessions)) {
    const card = s.project;              // Task 4 makes this `boardHome(s)`
    const list = byProject.get(card);
    if (list) list.push(s);
    else byProject.set(card, [s]);
  }
  // Durable cards AFTER the populated ones: Map insertion order is the group
  // order, and the first session of each populated group IS its most urgent
  // member, so the populated cards keep their order with no second comparator
  // to drift. A known project nobody is on, and a session's OWN project that
  // it no longer renders on (Task 4), each get an empty group here.
  for (const s of sessions) if (!byProject.has(s.project)) byProject.set(s.project, []);
  for (const p of projects) if (!byProject.has(p)) byProject.set(p, []);

  const groups: FleetGroup[] = [];
  for (const [project, members] of byProject) {
    // See the `archived` field's doc: the split is on the BUCKET, so a
    // `cleanup` member stays in the live list its own chip counts it in.
    const live = members.filter((m) => m.bucket !== 'archived');
    const archived = members.filter((m) => m.bucket === 'archived');
    // `live` can be empty (every workspace of a project archived), so the pin
    // falls back to the whole membership; and the whole membership can be
    // empty (a durable card), which is the union's third state — never an
    // indexed read of an empty array.
    const forPin = live.length > 0 ? live : members;
    const first = forPin[0];
    const pin: FleetPin =
      first === undefined ? { state: 'empty' }
      : forPin.every((m) => m.home === first.home) ? { state: 'shared', home: first.home }
      : { state: 'mixed' };
    groups.push({
      project,
      sessions: live,
      archived,
      attention: live.some((m) => m.bucket === 'attention'),
      busy: live.filter((m) => m.bucket === 'working').length,
      unseen: live.filter((m) => isUnseen(m, acks)).length,
      pin,
      // `(m.stranded ?? null) !== null`, never a truthiness test and never a
      // read of `m.stranded.at` — see this field's own docstring for the two
      // producible reasons.
      stranded: live.filter(
        (m) => m.status !== 'dead' && (m.stranded ?? null) !== null,
      ).length,
    });
  }
  return groups;
}
