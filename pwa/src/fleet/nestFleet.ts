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
// options, and that defaults to excluding `TERMINAL_RUN_STATES`,
// `shared/api.ts`'s `done`/`failed` pair). So the tree
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
import { isDispatchPending, workerOf, type KeptRun } from './runWords';

/** No kept worker: `nestFleet`'s default, the five-rule tree. */
const NO_KEPT: ReadonlyMap<string, KeptRun> = new Map();

/** How deep a row sits. ONE level, deliberately — see `nestFleet`'s rule 4. */
export type RowDepth = 0 | 1;

/** One row of a project card's body: a session or a pending spawn. Nothing of the delegation broker is a row of it: not a
 *  session's subagent or workflow (D-8782), nor a worktree, an unowned tree or a group of them (D-8782, the operator's
 *  scope change of 2026-11-19). The two kinds are a discriminated union
 *  rather than a session-plus-nullable-run record: a pending spawn has no
 *  session BY DEFINITION (the server learns the id by registry diff, after
 *  `ws-add` returns), and collapsing that into a `session: null` would make
 *  "this row is a phantom" and "this row's session could not be read" the same
 *  value at the seam. */
export type FleetRow =
  | { kind: 'session'; depth: RowDepth; session: FleetSession; kept?: KeptRun }
  | { kind: 'pending'; depth: RowDepth; run: RunSummary };

/** A row's one React key and identity, spelled ONCE for the card, a programme box's tray and its footer: a session by
 *  its id and a spawn by its run. */
export function fleetRowKey(row: FleetRow): string {
  return row.kind === 'session' ? row.session.id : `spawn:${row.run.id}`;
}

/** PROGRAMME ORDER, the base comparator — `attentionFirst` below puts ONE key
 *  ahead of it (spec §6, wave 2; D-3008): wave ascending, then run id
 *  ascending. Deliberately NOT the top-level session sort — a child's
 *  position is a fact about the programme (wave 1 came before wave 2), not
 *  about how recently anyone touched it, so a worker does not climb the tree
 *  by being busy. The id tiebreak makes two runs opened in the same wave read
 *  in the order they were opened. */
const programOrder = (a: RunSummary, b: RunSummary): number => a.wave - b.wave || a.id - b.id;

/** ATTENTION FIRST, then programme order — the one key ahead of
 *  {@link programOrder}, and scoped to siblings by construction: `settled` is
 *  sorted once and handed out per parent in that order, and the top level is
 *  never re-sorted, so a waiting child rises among its siblings and never
 *  above its parent. `attention` means blocked on the operator, which is the
 *  one thing this screen exists to surface (`groupFleet.ts`'s own principle);
 *  `programOrder`'s "a worker does not climb the tree by being busy" is about
 *  busy-ness, and this is not that. A pending spawn has no session and so no
 *  bucket; it keeps programme order (rule 5). The waiting worker is the run's
 *  BOUND worker (`workerOf`, D-7182): a session that carries the run's id but
 *  that the wire does not bind to it (#746) does not sort its run first. The
 *  `?.` guard below is type-driven, not a defensive scope widener: `settled` is
 *  pre-filtered by `onList` before this ever runs, so a run with no listed
 *  session never reaches it; it is not a licence to call this comparator on an
 *  unfiltered one. */
const attentionFirst =
  (byId: ReadonlyMap<string, FleetSession>) =>
  (a: RunSummary, b: RunSummary): number => {
    const waiting = (r: RunSummary): 0 | 1 =>
      workerOf(r, byId)?.bucket === 'attention' ? 0 : 1;
    return waiting(a) - waiting(b) || programOrder(a, b);
  };

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
 * The six rules, 1 to 5 each pinned on its own in `nestFleet.test.ts` and 6 in `kept-worker.test.ts`:
 *
 *  1. A run whose owner AND worker are both on this list brackets the worker
 *     under the owner, exactly once — the child is REMOVED from the top level,
 *     never rendered in both places.
 *  2. Children read attention-first, then in programme order
 *     ({@link programOrder}), never in the list's own — and the attention key
 *     never crosses a parent (D-3008).
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
 *  6. A KEPT worker (D-8981: its run closed, and its coordinator still holds open work of that programme, `keptRunOf`,
 *     decided once per fleet by the caller and handed in as `kept`) brackets under that coordinator when the coordinator
 *     is on this list, after the working children and before a spawn: the programme's past, kept beside its present.
 *     Rule 4 holds for it as for any edge (its coordinator is a parent; a kept worker that is a parent stays at top
 *     level), and rule 3 too (a coordinator not on this list leaves it at depth 0). Every row of a kept session carries
 *     its `kept` answer, so the box and the label read the decision instead of making it again. With no `kept` (the
 *     default) the tree is rules 1 to 5, exactly.
 *
 * The delegation broker's rows (wave 4, spec §5.8: its own rules 6 to 11, not rule 6 above) are not drawn here any more. A session's subagents and
 * workflows, its worktrees, the unowned trees and the groups that held them are no row of the fleet list, by the operator's
 * ruling of 2026-11-19 (D-8782): the tree is the six rules above and nothing else, and the session's own details list
 * its activities.
 */
export function nestFleet(
  sessions: readonly FleetSession[],
  runs: readonly RunSummary[],
  kept: ReadonlyMap<string, KeptRun> = NO_KEPT,
): FleetRow[] {
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const onList = (id: string | null): boolean => id !== null && byId.has(id);

  // The edges that can actually be DRAWN — both ends on this list, and never a
  // session pointing at itself. Sorted once, attention-first then in programme
  // order (`attentionFirst`); every list built below inherits it by
  // construction rather than re-sorting.
  const settled = runs
    .filter((r) => onList(r.sessionId) && onList(r.claimedBy) && r.claimedBy !== r.sessionId)
    .slice()
    .sort(attentionFirst(byId));
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
  // Rule 6's edges: a kept session whose coordinator is on this list, never under itself.
  const keptUnder = sessions.flatMap((s) => {
    const k = kept.get(s.id);
    return k !== undefined && k.coordinatorId !== s.id && onList(k.coordinatorId) ? [[s, k.coordinatorId] as const] : [];
  });
  for (const [, parent] of keptUnder) parents.add(parent);
  const row = (s: FleetSession, depth: RowDepth): FleetRow => {
    const k = kept.get(s.id);
    return k === undefined ? { kind: 'session', depth, session: s } : { kind: 'session', depth, session: s, kept: k };
  };

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
    under(r.claimedBy!, row(byId.get(child)!, 1));
  }

  // Rule 6, after every working child: a kept worker its run's open edge did not already place.
  for (const [s, parent] of keptUnder) {
    if (parents.has(s.id) || placed.has(s.id)) continue;
    placed.add(s.id);
    under(parent, row(s, 1));
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
    rows.push(row(s, 0));
    for (const row of kids.get(s.id) ?? []) rows.push(row);
  }
  // A parentless spawn has no session to sit beside — it is not in any bucket
  // and `sortFleet` has no opinion about it — so it goes last rather than
  // displacing a row whose position is already decided.
  rows.push(...orphanSpawns);
  return rows;
}
