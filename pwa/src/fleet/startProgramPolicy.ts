// Starting a program: the DECISIONS, with none of the sheet.
//
// WHY IT IS ITS OWN FILE. `StartProgramSheet.tsx` was 1114 lines, and the
// first fifth of its body was pure: how long to wait for a session that was
// just created, how to RECOGNISE it when it shows up (two predicates on two
// different field sets, deliberately not one — D-291/D-292), what a refusal
// sentence should read as, whether a project already has an open run, and
// which account the row forecasts. None of it renders, none of it is the
// sheet's, and three of these are exported and tested directly already.
//
// The file header on the sheet is still where the COMPOSITION is argued —
// why this flow is three existing calls rather than one route.
import type { FleetSession, ProjectRow } from '../../../shared/api';
import type { useProjectedHome } from './useProjectedHome';
import { ApiError, apiErrorText } from '../lib/api';

/** D-291: how long the sheet waits for the freshly created session to
 *  appear in a `/ws/fleet` snapshot before giving up. Tied to the fleet
 *  watcher's own 2 s tick (`server/src/watch.ts`'s `intervalMs`) plus a
 *  generous margin — the same reasoning `coordWords.ts`'s `COORD_CONFIRM_MS`
 *  states for the pause toggle's own bounded wait, sized up because this one
 *  waits on a cold process spawn (tmux + a wrapper CLI cold start), not a
 *  marker-file flip: room for a slow box and more than one missed tick, not
 *  a timeout chasing the happy path. */
export const START_PROGRAM_WAIT_MS = 20_000;

/** A MAIN CHECKOUT of `project` — not one of its workspaces. The shared half
 *  of both arms below, and the one C1 was about: `wrapper`+`project` alone is
 *  not a main checkout, because `cmd_ws_add` writes BOTH fields onto every
 *  WORKSPACE row too, with a `_ws_least_loaded` wrapper (`ccd/ccd:3667`, called
 *  at `ccd/ccd:3887`) that
 *  `useProjectedHome` mirrors exactly (`server/src/limits.ts:96`) — so a
 *  two-field match hits live workers on a box in its normal state.
 *  `FleetSession.workspace` is server-reported and documented "null for a
 *  project's main checkout" (`shared/api.ts:35-37`), so this costs NO id
 *  arithmetic and D-291's "never recompute the id" holds unchanged. */
const isMainCheckoutOf = (s: FleetSession, project: string): boolean =>
  s.project === project && s.workspace === null;

/** D-292 (was D-B4-19)'s arm: "is a live main checkout already running in this project?"
 *
 *  WRAPPER-INDEPENDENT, and that is a correction, not an oversight (re-review
 *  of the C1 fix). `cmd_swap` rewrites the registry's `wrapper` field and
 *  KEEPS the id (`ccd/ccd:13459`, `_reg_set "$id" wrapper "$target"`), while
 *  `cmd_start`'s collision test is `_alive "$(_id "$wrapper" "$project")"`
 *  (`ccd/ccd:12467` and `ccd/ccd:12508`) — keyed on the ID, which a swap does
 *  not move. On the
 *  live fleet 5 of 10 main checkouts already report a `wrapper` that differs
 *  from their own id prefix (an id reading `<wrapper>-<project>` whose registry
 *  row reports a DIFFERENT wrapper — the count is the evidence, the particular
 *  names were one fleet's and carried none of the argument), so a
 *  wrapper-scoped refusal MISSES a real collision: the row reports `Y`, the
 *  projection says `W`, no match, the operator taps Start, `ccd start W P`
 *  resolves `_id` to the live `W-P`, prints "already running" and exits 0 —
 *  the HTTP call SUCCEEDS, the wrapper-scoped wait never matches, and the
 *  sheet ends on "Started — the board just hasn't shown it yet" for a program
 *  that never started. A dead end, reachable on half this fleet's projects.
 *
 *  This arm cannot ask the exact question (`_alive(_id(W,P))`) without
 *  recomputing the id, which D-291 forbids. So it asks the WIDER one and
 *  accepts over-refusing: when the live main checkout is one `cmd_start` would
 *  NOT have collided with, this still refuses, and the copy says why in terms
 *  that are true either way (a second coordinator in one project is its own
 *  problem). Safe to widen: this arm renders no confirm button, it never acts
 *  — refusing more is conservative, and there is no path by which a wider
 *  match sends a kickoff anywhere. The arm that ACTS is the wrapper-scoped one
 *  below.
 *
 *  `status !== 'dead'` is on THIS arm only: `cmd_start`'s idempotency test is
 *  `_alive` (tmux has-session), whose wire mirror this is. Without it a
 *  dead-but-unreaped row refuses the sheet forever with copy false on every
 *  clause, and `ws-reap` is human-only-at-a-terminal by contract — no way out
 *  from the phone. */
export function liveMainCheckoutIn(
  sessions: readonly FleetSession[],
  project: string,
): FleetSession | null {
  return sessions.find((s) => isMainCheckoutOf(s, project) && s.status !== 'dead') ?? null;
}

/** D-291's arm: "has the session I just asked for appeared yet?"
 *
 *  WRAPPER-SCOPED, deliberately, and NOT to be widened to match the refusal
 *  above. This one ACTS — it sends the coordinator kickoff and navigates — so
 *  its question is genuinely "the session this sheet created", which is the
 *  one at the wrapper it passed to `createSession`. Dropping `s.wrapper ===
 *  wrapper` here would let a DIFFERENT live main checkout in the same project
 *  (someone else's, or a swapped one) collect this sheet's kickoff: verbatim
 *  the hijack D-292 exists to prevent, arriving through the wait instead.
 *
 *  LIVENESS + FRESHNESS, both required (coordinator review B-2). An earlier
 *  version of this docstring argued for NO liveness conjunct, on the grounds
 *  that `cmd_start` writes the registry fields before tmux is up, so
 *  "excluding a dead row would time out a wait on a session that really did
 *  start". THAT REASONING WAS WRONG and is corrected here rather than
 *  preserved: excluding a dead row does not time the wait out, it simply does
 *  not resolve on THAT tick. `checkForMatch` re-runs on every later
 *  `/ws/fleet` frame and the wait is bounded at `START_PROGRAM_WAIT_MS`, so
 *  the row resolves the moment it is reported alive. "Not resolving yet" was
 *  conflated with "timing out"; they are different facts.
 *
 *  Why liveness is needed: project + wrapper + `workspace === null` is NOT a
 *  unique key, by the same `cmd_swap` fact that widened the refusal arm
 *  (`ccd/ccd:13459` moves the wrapper, keeps the id). A main checkout
 *  `claude-ccrc-pwa` swapped to `claude2` and since DEAD is skipped by the
 *  refusal (`status !== 'dead'`), so Start is offered; the projection says
 *  `claude2`, `cmd_start` spawns a NEW `claude2-ccrc-pwa`, and the next frame
 *  carries both in registry-id sort order (`registry.ts:869`), where
 *  `'claude-'` sorts before `'claude2'` (`-` 0x2D < `2` 0x32). Without
 *  liveness `.find()` returns the DEAD swapped row — it satisfies project,
 *  `workspace === null` and `wrapper === 'claude2'` — and the kickoff goes to
 *  a dead session while the coordinator that actually started never gets its
 *  brief.
 *
 *  Why liveness ALONE is not enough: `preLive` is the set of ids that were
 *  already alive when `start()` snapshotted the store, immediately before the
 *  create. The discriminator is "this row became live as a RESULT of my
 *  create" — alive now, and either absent from that snapshot or present in it
 *  but dead. That last clause is the subtle one and is deliberate: a DEAD row
 *  with the same id that `cmd_start` will revive is a legitimate resolution
 *  (the refusal skips dead rows, so Start is offered, and `ccd start`
 *  respawns exactly that id), so freshness cannot be "an id I had not seen".
 *
 *  EXPORTED for its own unit test, deliberately. The `!preLive.has(s.id)`
 *  conjunct is unreachable through the component: `start()` refuses to run at
 *  all while `existing !== null`, and `existing` is any live main checkout in
 *  the project — so no tap can produce a snapshot that already contains a
 *  live matching row. Measured: deleting that conjunct alone left the whole
 *  integration suite green. A guard no test can see is exactly what this
 *  branch's mutation-table doctrine forbids, so rather than ship it
 *  unpinned (or delete a guard the review ordered), the predicate is pure and
 *  is tested directly. The component tests remain the primary pins for the
 *  other three conjuncts. */
export function startedSessionFor(
  sessions: readonly FleetSession[],
  wrapper: string,
  project: string,
  preLive: ReadonlySet<string>,
): FleetSession | null {
  return sessions.find((s) =>
    isMainCheckoutOf(s, project)
    && s.wrapper === wrapper
    && s.status !== 'dead'
    && !preLive.has(s.id)) ?? null;
}

/** The ids alive at a given instant — `startedSessionFor`'s `preLive`
 *  snapshot. Taken from `fleet.getState()` (authoritative) rather than the
 *  render-scoped `sessions`, and taken BEFORE the create, so "was already
 *  running before I asked for anything" is a measurement and not an
 *  inference. */
export const liveIdsIn = (sessions: readonly FleetSession[]): ReadonlySet<string> =>
  new Set(sessions.filter((s) => s.status !== 'dead').map((s) => s.id));

/** `createSession`'s own refusals. 400 is a client-authored mistake (an
 *  unknown/empty project); apiErrorText's stderr-first priority already
 *  handles the 502 spawn-failure case (ccd's own words), so this only adds
 *  the one branch that needs a sentence apiErrorText cannot supply — a bare
 *  `bad-request` slug says nothing actionable. */
export function startErrorText(err: unknown): string {
  if (err instanceof ApiError && err.status === 400) {
    return "That project isn't known to the fleet — pick one from the list.";
  }
  return apiErrorText(err);
}

/** "Is a program already running in this project?" — THREE answers, and the
 *  third is why this is a function instead of a `.has()` at the call site.
 *
 *  `openRunProjects === null` is NOT MEASURED: the run board has had neither a
 *  `runs` frame nor a finished cold read. A `(openRunProjects ?? new Set()).has()`
 *  answers `false` there, which is indistinguishable from a measured empty board
 *  — the sheet would offer Start on the strength of a question nobody answered.
 *  That fold is the single failure this arm exists to prevent, so the state gets
 *  its own word and the render gets its own sentence.
 *
 *  The set carries PROJECT NAMES and nothing else, so the copy below can name
 *  the project and cannot name the program. That is a limit, not an omission: a
 *  set of names is not a run row, and naming a program would be a claim this
 *  measurement never made.
 *
 *  The match is EXACT. `RunSummary.project` is whatever string the coordinator
 *  passed to `POST /api/runs`, which validates it as a non-empty string and
 *  nothing more (`server/src/coord/routes.ts:1077-1085`); `ProjectRow.name` comes
 *  from the projects listing. Nothing joins the two but convention, so a run
 *  naming a project this picker never lists is a run this sheet cannot speak
 *  about — loosening to a prefix would refuse real projects over a lookalike.
 *
 *  EXPORTED for its own unit test, on `startedSessionFor`'s precedent above. */
export type OpenRunVerdict = 'clear' | 'open-run' | 'unmeasured';

export function openRunVerdict(
  openRunProjects: ReadonlySet<string> | null,
  project: string,
): OpenRunVerdict {
  if (openRunProjects === null) return 'unmeasured';
  return openRunProjects.has(project) ? 'open-run' : 'clear';
}

export type StartProgramPlacement =
  | { kind: 'projected'; wrapper: string }
  | { kind: 'pending' }
  | { kind: 'none'; pool: string | null; source: 'project' | 'global' }
  | { kind: 'unmeasurable' }
  | { kind: 'pool-blind'; pool: NonNullable<ProjectRow['pool']> };

/** Selects the route's project-specific forecast whenever it is present. The
 * global forecast remains valid only for old servers and measured untagged
 * projects, where the pool-aware and historical rules are the same. */
export function startProgramPlacement(
  project: ProjectRow,
  projected: ReturnType<typeof useProjectedHome>,
): StartProgramPlacement {
  if (project.placement !== undefined) {
    if (project.placement.kind === 'projected') {
      return { kind: 'projected', wrapper: project.placement.wrapper };
    }
    if (project.placement.kind === 'none') {
      return { ...project.placement, source: 'project' };
    }
    return project.placement;
  }

  if (project.pool !== undefined && project.pool.state !== 'untagged') {
    return { kind: 'pool-blind', pool: project.pool };
  }
  if (projected === undefined) return { kind: 'pending' };
  if (projected === null) return { kind: 'none', pool: null, source: 'global' };
  return { kind: 'projected', wrapper: projected.wrapper };
}
