// The programme tree: which rows of a project card are children of which, in
// what order (Task 4, spawn visibility).
//
// THE EDGE IS `run.claimedBy` -> `run.sessionId`. The first is the coordinator
// that owns the run — stamped at `POST /api/runs`, and the mechanism behind the
// `claimed-by-another` refusal, which is exactly as absolute as it ever was for
// a claimant that is ALIVE. It is NOT a write-once column, and this comment
// said it was for one wave longer than the tree deserved: D-1125 corrected that
// claim in `shared/api.ts`'s own docstring and left the copy HERE — the file
// closest to the render — still asserting it, and still citing that docstring
// as its authority for the opposite of what the docstring now says (D-1153).
// The old wording is PARAPHRASED and never quoted, here or in `api.ts`: the
// literal is what `server/test/resume-reclaim-l0.test.ts` now scans this whole
// source tree for, and a correction that recites the sentence it corrects would
// red the pin that protects it. What the operator's reclaim door does is
// measure the current claimant and, on a dead answer, move every run of that
// programme to a named successor. The consequence for THIS file is small and
// worth stating rather than inferring: the parent end of an edge can differ
// between two `runs` frames, and nothing here caches it — the tree is
// re-derived from the frame it was handed, so a succession simply re-parents
// the bracket on the next frame. The second end is the worker that run
// dispatched.
// Neither is inferred here: both ride on the `runs` frame, which is ACTIVE-ONLY
// by construction (`watch.ts`'s `emitRuns` calls `coord.runs()` with no
// options, and that defaults to `state NOT IN ('done','failed')`). So the tree
// shows the programme structure that is LIVE RIGHT NOW and forgets it when the
// programme closes — which is the honest lifetime for a bracket the operator
// reads as "this is happening".
//
// A COMPANION to sortFleet/groupFleet, never a replacement: `sortFleet` decides
// the fleet's own urgency order and `groupFleet` splits it by project, and this
// takes ONE project's already-ordered list and only ever LIFTS a child out of
// it and re-inserts it one line below its parent. Nothing here re-sorts the
// top level — a child's position is a fact about the programme, everyone
// else's is a fact about the fleet, and the two orders must not contend.
import type { FleetSession, RunSummary } from '../../../shared/api';
import { isDispatchPending } from './runWords';

/** How deep a row sits. ONE level, deliberately — see `nestFleet`'s rule 4. */
export type RowDepth = 0 | 1;

/** One row of a project card's body. Two kinds, as a discriminated union
 *  rather than a session-plus-nullable-run record: a pending spawn has no
 *  session BY DEFINITION (the server learns the id by registry diff, after
 *  `ws-add` returns), and collapsing that into a `session: null` would make
 *  "this row is a phantom" and "this row's session could not be read" the same
 *  value at the seam. */
export type FleetRow =
  | { kind: 'session'; depth: RowDepth; session: FleetSession }
  | { kind: 'pending'; depth: RowDepth; run: RunSummary };

/** PROGRAMME ORDER, and the only comparator in this file: wave ascending, then
 *  run id ascending. Deliberately NOT the top-level session sort — a child's
 *  position is a fact about the programme (wave 1 came before wave 2), not
 *  about how recently anyone touched it, so a worker does not climb the tree
 *  by being busy. The id tiebreak makes two runs opened in the same wave read
 *  in the order they were opened. */
const programOrder = (a: RunSummary, b: RunSummary): number => a.wave - b.wave || a.id - b.id;

/**
 * The display order of one project's card body, with a depth per row.
 *
 * `sessions` is that project's list as the card would render it today
 * (`FleetGroup.sessions`, already through `sortFleet`); `runs` is the ACTIVE
 * runs the caller wants considered — scoped to this project by the caller,
 * because "which card does a spawn belong on" is a question about the run's
 * `project`, and a helper handed one session list cannot answer it (an empty
 * list has no project to read). Pure: returns new rows, mutates neither input.
 *
 * The five rules, each pinned on its own in `nestFleet.test.ts`:
 *
 *  1. A run whose owner AND worker are both on this list brackets the worker
 *     under the owner, exactly once — the child is REMOVED from the top level,
 *     never rendered in both places.
 *  2. Children read in programme order ({@link programOrder}), never in the
 *     list's own.
 *  3. An orphan is never bracketed. A child whose parent is absent from this
 *     list — a coordinator on another project, archived, or simply not
 *     measured this pass — stays exactly where it is, at depth 0. Absence
 *     permits: no dangling `└─` pointing at nothing, and no session bracketed
 *     under itself.
 *  4. ONE LEVEL ONLY. A session that is both a child of one run and the parent
 *     of another renders at TOP level with its own children beneath it. The
 *     alternative is either hiding its children or growing a second level, and
 *     the operator asked for one bracket, not a tree — so the PARENT role
 *     wins, always.
 *  5. A dispatch in flight ({@link isDispatchPending}: `planned` plus a
 *     `dispatchStartedAt`) renders as a pending CHILD of its `claimedBy`,
 *     after the settled ones, carrying no session id because there is not one
 *     yet. It ends when `state` leaves `planned` — the stamp is never cleared,
 *     so `state` is the whole of what stops it — and it yields to a session
 *     row the run has already bound, since two rows for one spawn is worse
 *     than none. With no parent on this list it renders at top level rather
 *     than vanishing: the operator still needs to know a spawn is happening.
 */
export function nestFleet(
  sessions: readonly FleetSession[],
  runs: readonly RunSummary[],
): FleetRow[] {
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const onList = (id: string | null): boolean => id !== null && byId.has(id);

  // The edges that can actually be DRAWN — both ends on this list, and never a
  // session pointing at itself. Sorted once, in programme order; every list
  // built below inherits it by construction rather than re-sorting.
  const settled = runs
    .filter((r) => onList(r.sessionId) && onList(r.claimedBy) && r.claimedBy !== r.sessionId)
    .slice()
    .sort(programOrder);
  // Rule 5's runs, minus the ones whose session row already exists: `dispatch.ts`
  // binds the session (`coord.setSession`) as soon as the registry diff names
  // it and only advances the state much later, so a hold or an advance failing
  // in between leaves a run `planned`, stamped AND bound. The session row is
  // the honest row.
  const pending = runs
    .filter((r) => isDispatchPending(r) && !onList(r.sessionId))
    .slice()
    .sort(programOrder);

  // Rule 4, and it must be settled BEFORE any child is placed: a session that
  // owns any drawable edge is a parent, and a parent is never itself a child.
  const parents = new Set<string>();
  for (const r of settled) parents.add(r.claimedBy!);
  for (const r of pending) if (onList(r.claimedBy)) parents.add(r.claimedBy!);

  const kids = new Map<string, FleetRow[]>();
  const under = (parent: string, row: FleetRow): void => {
    const list = kids.get(parent);
    if (list) list.push(row);
    else kids.set(parent, [row]);
  };

  // Rule 1: exactly once. `placed` is both the dedupe (two runs naming the
  // same worker put it under the first in programme order, not twice) and the
  // record of what the top-level pass below must skip.
  const placed = new Set<string>();
  for (const r of settled) {
    const child = r.sessionId!;
    if (parents.has(child) || placed.has(child)) continue;
    placed.add(child);
    under(r.claimedBy!, { kind: 'session', depth: 1, session: byId.get(child)! });
  }

  // Rule 5, pushed after every settled child so the phantom reads last under
  // its parent: the children that exist are the programme's present tense, the
  // one being spawned is its next moment.
  const orphanSpawns: FleetRow[] = [];
  for (const r of pending) {
    if (onList(r.claimedBy)) under(r.claimedBy!, { kind: 'pending', depth: 1, run: r });
    else orphanSpawns.push({ kind: 'pending', depth: 0, run: r });
  }

  const rows: FleetRow[] = [];
  for (const s of sessions) {
    if (placed.has(s.id)) continue;
    rows.push({ kind: 'session', depth: 0, session: s });
    for (const row of kids.get(s.id) ?? []) rows.push(row);
  }
  // A parentless spawn has no session to sit beside — it is not in any bucket
  // and `sortFleet` has no opinion about it — so it goes last rather than
  // displacing a row whose position is already decided.
  rows.push(...orphanSpawns);
  return rows;
}
