// The run board's own door onto a NEW program (Task 13, spec §4.4). This is
// a COMPOSITION, not a compound route: `POST /api/runs` is the coordinator's
// own (it demands a live `claimedBy` and refuses a second claimant,
// `server/src/coord/routes.ts:872`, refusing a second claimant in
// `server/src/coord/store.ts:363-371`) and this build does not add a route that both spawns
// a session and opens a run. The flow is three EXISTING calls —
// `api.projects`, `api.createSession`, `api.kickoff` — plus `useProjectedHome`
// for the account name, composed here and nowhere else.
//
// D-291 (was D-B4-18) and D-292 (was D-B4-19) (`docs/superpowers/plans/2026-08-11-build4-conversation-and-
// controls.md`'s Deviations section) are both load-bearing for this file and
// are why it is not the simple "create, then kick off the id it returns" shape
// the brief's own interface list reads as. (Wave 4 changed WHAT is sent — the
// kickoff is durable mail queued through the idle-gated lane now, not
// keystrokes typed into the pane — and changed nothing about WHO it is sent to:
// the addressing argument below is why this file exists, and it is unaffected.)
//
//   * `POST /api/sessions`'s success body is the literal `{ok:true}`
//     (`server/src/server.ts:1510-1513`, `runCcdOr502`; the route itself is
//     `:1517-1530`) — no id. `ccd`
//     computes the id as `${wrapper}-${project}` (`ccd/ccd:1091`, `_id()`)
//     and only echoes it to stdout, which that route discards. Recomputing
//     the same formula here was REJECTED — a second implementation of a rule
//     ccd owns is exactly what `useProjectedHome.ts`'s own docstring refuses
//     ("Two implementations of one rule drift; that is what they do."). So
//     this waits for the new session to show up in a real `/ws/fleet`
//     snapshot and matches it on fields the server actually reports, never on
//     a recomputed id. The two arms below match on DIFFERENT field sets and
//     that is the point — see `liveMainCheckoutIn`/`startedSessionFor`, whose
//     own docstrings carry the argument; do not fold them back into one
//     predicate.
//   * `cmd_start` is IDEMPOTENT (`ccd/ccd:12117`): a second `start` whose
//     `_id()` is already `_alive` is a no-op that attaches to the session
//     already there. A blind kickoff would hand this program to a session
//     started for something else — the queue does not interrupt it, but it
//     does address it — so this sheet checks for that collision
//     BEFORE the tap — same posture as the projection naming the account
//     before the tap rather than guessing — and refuses with no confirm
//     button at all when it finds one.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession, ProjectRow } from '../../../shared/api';
import { ledgerPath } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { accountLabel } from '../lib/accounts';
import { markerState } from './coordWords';
import { ApiError, api, apiErrorText, kickoffErrorText } from '../lib/api';
import { navigate } from '../lib/router';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { useProjectedHome } from './useProjectedHome';
import {
  READY_GLYPH, READY_PENDING_GLYPH, missingPreconditions, readinessTitle, readinessWord,
} from './readinessWords';
import './fleet.css';


// The kickoff sentence and the ledger path both live in `shared/api.ts` since
// wave 4 (D-1043). They moved because they gained a SECOND speaker — the server
// composes the kickoff body now that it is queued as mail rather than typed here
// — and this file's own header cites "Two implementations of one rule drift" as
// the reason it exists at all. The sheet still renders the path (it is the one
// thing the operator has to have committed before starting), and still never
// opens it; only the sending moved.
//
// Review fix round 1, Minor 3, carried with them: `programKickoff` builds the
// path by calling `ledgerPath`, never by spelling it a second time inline.

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
 *  WORKSPACE row too, with a `_ws_least_loaded` wrapper (`ccd/ccd:3530`, called
 *  at `ccd/ccd:3707`) that
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
 *  KEEPS the id (`ccd/ccd:13125`, `_reg_set "$id" wrapper "$target"`), while
 *  `cmd_start`'s collision test is `_alive "$(_id "$wrapper" "$project")"`
 *  (`ccd/ccd:12144` and `ccd/ccd:12182`) — keyed on the ID, which a swap does
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
function liveMainCheckoutIn(
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
 *  (`ccd/ccd:13125` moves the wrapper, keeps the id). A main checkout
 *  `claude-ccrc-pwa` swapped to `claude2` and since DEAD is skipped by the
 *  refusal (`status !== 'dead'`), so Start is offered; the projection says
 *  `claude2`, `cmd_start` spawns a NEW `claude2-ccrc-pwa`, and the next frame
 *  carries both in registry-id sort order (`registry.ts:793`), where
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
const liveIdsIn = (sessions: readonly FleetSession[]): ReadonlySet<string> =>
  new Set(sessions.filter((s) => s.status !== 'dead').map((s) => s.id));

/** `createSession`'s own refusals. 400 is a client-authored mistake (an
 *  unknown/empty project); apiErrorText's stderr-first priority already
 *  handles the 502 spawn-failure case (ccd's own words), so this only adds
 *  the one branch that needs a sentence apiErrorText cannot supply — a bare
 *  `bad-request` slug says nothing actionable. */
function startErrorText(err: unknown): string {
  if (err instanceof ApiError && err.status === 400) {
    return "That project isn't known to the fleet — pick one from the list.";
  }
  return apiErrorText(err);
}

export interface StartProgramSheetProps {
  open: boolean;
  onClose: () => void;
  /** Injectable for tests; defaults to the app-wide fleet store — same shape
   *  every other sheet in this file uses. */
  fleet?: FleetStore;
  /** Injectable for tests; all three default to the real `api.*` methods, so
   *  the production mount exercises the same calls `pwa/test/api.test.ts`
   *  pins the URL/method/body of. */
  createSession?: (b: { wrapper: string; project: string; workdir?: string }) => Promise<void>;
  /** Program-leverage wave 4: the kickoff is QUEUED as durable system mail, not
   *  typed into the pane. Named `queueKickoff` rather than `kickoff` because the
   *  standing sentence itself is `programKickoff` in L0 and this file's tests
   *  import it — one name for the text, another for the act. */
  queueKickoff?: (id: string, b: { slug: string; title: string }) => Promise<void>;
  loadProjects?: () => Promise<{ roots: string[]; projects: ProjectRow[] }>;
}

export function StartProgramSheet({
  open,
  onClose,
  fleet = useFleetStore,
  createSession = api.createSession,
  queueKickoff = api.kickoff,
  loadProjects = api.projects,
}: StartProgramSheetProps): ReactNode {
  const sessions = fleet((s) => s.sessions);
  const roster = fleet((s) => s.roster);
  const coord = fleet((s) => s.coord);
  // `active: open` — this sheet is mounted UNCONDITIONALLY at RunsScreen
  // level (review fix round 1, Minor 2): without gating the poll, `/runs`
  // would ask `/api/accounts` every 20s whether or not the door is ever
  // tapped, the exact shape `useProjectedHome.ts`'s own docstring (citing
  // `useDisabledWrappers`) warns against.
  const projected = useProjectedHome(open);

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ProjectRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * A kickoff that could not be QUEUED, held until the operator does something
   * about it (program-leverage wave 4).
   *
   * This is state, not a toast, and the difference is the wave's whole point.
   * The injection this replaces failed synchronously and left nothing behind, so
   * a transient message was all there was to say; a failed QUEUE leaves nothing
   * behind EITHER — no mail row, no delivery, nothing the lane will retry — and
   * unlike the injection there is now a cheap, correct act that fixes it, so the
   * sheet has to still be offering it when the operator looks up. `Toast.tsx`
   * also drops every toast once the 401 auth-lost signal is raised, which is
   * exactly the failure most likely to eat a kickoff on an armed box.
   *
   * `sessionId` is the id `startedSessionFor` MEASURED, carried verbatim: a
   * retry must not re-open the addressing question D-291/D-292 already settled.
   */
  const [kickoffFailed, setKickoffFailed] =
    useState<{ sessionId: string; slug: string; title: string; why: string } | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Fetch the project list the moment the sheet opens — same idiom
  // NewSessionSheet already uses for the same call.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setList(null);
    setListError(null);
    loadProjects().then(
      (r) => { if (!cancelled) setList(r.projects); },
      (err: unknown) => { if (!cancelled) setListError(apiErrorText(err)); },
    );
    return () => { cancelled = true; };
  }, [open, loadProjects]);

  // Lesson (Task 12's own review, applied here ahead of time): this sheet is
  // mounted UNCONDITIONALLY at RunsScreen level and `open` only toggles the
  // Sheet's own visibility — the component keeps running underneath, the
  // same shape ReapSheet/AbandonSheet's own fix rounds already litigated. It
  // holds async state across the D-291 wait, so closing mid-flight must
  // retire everything outstanding: `gen` is bumped so a create/kickoff/match
  // that resolves AFTER a close cannot write into whatever the sheet shows
  // next, the timer is cleared so it cannot fire into a retired attempt, and
  // the wait target is dropped so a LATER `sessions` frame cannot resurrect
  // it. A closed sheet also forgets its own form choices, same as
  // NewSessionSheet.
  const gen = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitRef = useRef<{ mine: number; wrapper: string; project: string; slug: string; title: string; preLive: ReadonlySet<string> } | null>(null);
  // Review fix round 1, Important 2: the D-291 timeout and the D-292
  // collision refusal INTERACT — neither ruling could see this alone. A
  // timeout does not mean the create failed; it means the board hasn't
  // shown it YET. If the session then lands a moment later, `existing`
  // (below) finds it — and without this ref, the sheet would render the
  // D-292 refusal ("…is already running… may be mid-task") for the
  // session it JUST started itself, which is neither running anyone else's
  // work nor true. `myAttemptRef` outlives the timeout (unlike `waitRef`,
  // which `finish()` still nulls the instant a match is found, so a second
  // `/ws/fleet` frame arriving mid-`queueKickoff()` cannot fire a duplicate
  // kickoff) — it is cleared only on close or by a NEWER attempt overwriting
  // it, so the false-collision suppression below holds for the entire
  // window from a successful `createSession` through navigation, not merely
  // while the wait is still nominally "in progress".
  //
  // PROJECT ONLY, no wrapper (re-review of the C1 fix). It used to hold both
  // and compare both, which was coherent while the refusal arm was itself
  // wrapper-scoped. Now that `liveMainCheckoutIn` is wrapper-independent the
  // two must agree, or the suppression stops covering its own case:
  // `cmd_swap` moves a live session's `wrapper` while keeping its id
  // (`ccd/ccd:13125`), so a session this sheet started at `W` can be reported
  // at `Y` on any later frame — a wrapper-comparing ownership test then fails
  // and the sheet renders "…is already running… may be mid-task" for the
  // session it started ITSELF. That is the Important-2 defect exactly,
  // resurrected through the swap path.
  //
  // Still BOUNDED, which is the property that matters here: this is non-null
  // only after a `createSession` for THIS project SUCCEEDED in the sheet's
  // current lifetime, and the pre-tap refusal proved no live main checkout
  // existed in that project a moment before — so one appearing now is
  // overwhelmingly this sheet's own doing. It is cleared on close, overwritten
  // by a newer attempt, and compared on `project`, so choosing a DIFFERENT
  // project drops the suppression on the same render (pinned by its own
  // test). And the suppression can only ever hide a WARNING: the arm that
  // ACTS is `startedSessionFor`, still wrapper-scoped, so widening the
  // ownership test cannot send a kickoff anywhere it would not already go.
  const myAttemptRef = useRef<{ project: string } | null>(null);

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (open) return;
    gen.current += 1;
    clearTimer();
    waitRef.current = null;
    myAttemptRef.current = null;
    setSlug('');
    setTitle('');
    setProject(null);
    setQuery('');
    setStarting(false);
    setTimedOut(false);
    setError(null);
    setKickoffFailed(null);
    setRetrying(false);
  }, [open]);

  useEffect(() => () => clearTimer(), []);

  // Review, M3: `timedOut` is a statement about ONE attempt's target
  // ("started `build9-demo` in ccrc-pwa on claude; the board hasn't shown it
  // yet"), and it used to be reset only by `start()` and by close — so
  // picking a different project left it rendered above a Start button aimed
  // somewhere else, claiming that target had been started when it never had.
  // Keyed on the two facts that NAME the target: the operator's project pick
  // and the projection's wrapper. Not `projected` itself — that object is
  // rebuilt by the accounts poll every 20 s, which would clear an honest
  // timeout on a tick rather than on a change. `waitRef` is deliberately NOT
  // touched here: the wait keeps watching for the session it really did start
  // (D-291, review fix round 1 Important 2) — only this SENTENCE, which has
  // stopped being true of what is on screen, is withdrawn.
  useEffect(() => {
    setTimedOut(false);
  }, [project?.workdir, projected?.wrapper]);

  // Queues the kickoff and navigates — the ONLY place either happens. `w.mine`
  // is checked again after the queue call settles: a close during that
  // round-trip must not navigate a screen the operator is no longer looking at.
  // The call is a QUEUE, not a keystroke (wave 4): what it resolves means the
  // mail row exists, not that the coordinator has read anything.
  const finish = (session: FleetSession, w: { mine: number; slug: string; title: string }): void => {
    clearTimer();
    waitRef.current = null;
    void queueKickoff(session.id, { slug: w.slug, title: w.title })
      .then(() => {
        if (gen.current !== w.mine) return; // superseded — a later close/open owns the phase now
        setStarting(false);
        navigate(`/s/${encodeURIComponent(session.id)}`);
      })
      .catch((err: unknown) => {
        if (gen.current !== w.mine) return; // superseded — a later close/open owns the phase now
        setStarting(false);
        // NOTE THE ORDER. This used to be `.catch(toast).then(navigate)`, which
        // navigated on BOTH arms — defensible for an injection, where the
        // session is real either way and the operator could finish the kickoff
        // by hand from inside it. It is not defensible for a queue: nothing
        // durable exists, so walking the operator into a session whose
        // coordinator will never be briefed hides the one fact they need.
        setKickoffFailed({ sessionId: session.id, slug: w.slug, title: w.title, why: kickoffErrorText(apiErrorText(err)) });
      });
  };

  /** Re-post the kickoff for a session that is already running — the door the
   *  durable queue makes possible for the first time.
   *
   *  It re-uses `kickoffFailed.sessionId` and never re-measures the fleet: the
   *  target was chosen once by `startedSessionFor` under D-291/D-292's whole
   *  apparatus, and a retry that re-opened that question could land the kickoff
   *  somewhere else entirely.
   *
   *  GENERATION-GUARDED ON EVERY ARM (wave-4 review, MAJOR 1, D-1046). It
   *  shipped guarding none, which was the same defect `finish()` carries two
   *  guards against — and worse here, because this call settles later than
   *  anything else in the file: the operator has already read a failure and
   *  tapped a button before the round trip even starts, which is exactly when a
   *  close is likely. A late SUCCESS navigated to the old session under
   *  whatever the operator had opened next; a late REJECTION re-planted the
   *  block the close had just cleared, so the next program's sheet opened
   *  showing the previous attempt's retry door aimed at the previous attempt's
   *  session. The `finally` is guarded too, and for a third reason: a newer
   *  retry owns `retrying` once `gen` has moved, and clearing it from here
   *  would re-enable a button whose call is still outstanding. */
  const retryKickoff = async (): Promise<void> => {
    const k = kickoffFailed;
    if (k === null || retrying) return;
    const mine = gen.current;
    setRetrying(true);
    try {
      await queueKickoff(k.sessionId, { slug: k.slug, title: k.title });
      if (gen.current !== mine) return; // superseded — a later close/open owns the phase now
      setKickoffFailed(null);
      navigate(`/s/${encodeURIComponent(k.sessionId)}`);
    } catch (err: unknown) {
      if (gen.current !== mine) return; // superseded — the block this would re-plant is retired
      setKickoffFailed({ ...k, why: kickoffErrorText(apiErrorText(err)) });
    } finally {
      if (gen.current === mine) setRetrying(false);
    }
  };

  const checkForMatch = (): void => {
    const w = waitRef.current;
    if (w === null) return;
    // `fleet.getState()`, not the render-scoped `sessions` — this can run
    // from inside `start()`, synchronously after `createSession` resolves,
    // before the closure that captured `sessions` has had a chance to
    // re-render with a fresher value.
    const found = startedSessionFor(fleet.getState().sessions, w.wrapper, w.project, w.preLive);
    if (found !== null) finish(found, w);
  };

  // D-291: the reactive half of the bounded wait. `sessions` is replaced
  // wholesale on every `/ws/fleet` frame (`stores/fleet.ts`), so this fires
  // on every fleet tick while a wait is outstanding — the moment the new
  // session's row appears, `checkForMatch` finds it.
  useEffect(() => {
    checkForMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const needle = query.trim().toLowerCase();
  const filtered =
    list === null ? [] : needle === '' ? list : list.filter((p) => p.name.toLowerCase().includes(needle));

  // D-292: recomputed on every render from the reactive store selector —
  // "whenever the target changes" (a different project picked, or the
  // projection itself moving) falls out of React's own render cycle rather
  // than a second piece of state tracking the same fact.
  // Wrapper-independent — see `liveMainCheckoutIn`'s own docstring for why a
  // wrapper-scoped refusal misses a real `cmd_start` collision on any session
  // that has been swapped. `projected != null` is still required, but only
  // because there is no point refusing a start that has no wrapper to place
  // with in the first place (the D-284 (was D-B4-11) arm below handles saying so).
  const existing =
    project !== null && projected != null
      ? liveMainCheckoutIn(sessions, project.name)
      : null;
  // Review fix round 1, Important 2: `existing` alone cannot tell "someone
  // else's session is in the way" apart from "the session I just started
  // has arrived" — both are `existing !== null`. `myAttemptRef` is the one
  // fact that distinguishes them; see its own comment above for why the
  // comparison is on `project` alone and why that stays bounded.
  const isOwnAttempt =
    existing !== null
    && myAttemptRef.current !== null
    && existing.project === myAttemptRef.current.project;

  const start = async (): Promise<void> => {
    if (starting || slug.trim() === '' || title.trim() === '' || project === null) return;
    if (projected == null) return; // undefined (no answer yet) or null (D-284) — no wrapper to place with
    if (existing !== null) return; // defensive: the confirm button is not rendered in this case at all

    const wrapper = projected.wrapper;
    const projectName = project.name;
    const mine = (gen.current += 1);
    setStarting(true);
    setTimedOut(false);
    setError(null);
    // Wave-4 review, MINOR 4 (D-1121). Same withdrawal as `timedOut`'s above,
    // and for the same reason one line further on: `kickoffFailed` is a
    // statement about ONE attempt's target, and a new attempt makes it a red
    // block ABOVE a Start button aimed somewhere else. Unlike `timedOut` it
    // carries an act — the door navigates to the previous attempt's session,
    // stranding the create being started right now.
    //
    // RETIRED, NOT RE-KEYED, and this costs something: the door is the only
    // control that can re-post for that session, so a kickoff that failed and
    // was then walked away from is not recoverable from this sheet. That is
    // the trade taken deliberately — the operator has the door on screen, in
    // red, directly above the Start they are choosing to tap instead, and a
    // second attempt is a clear statement of what they want the sheet to be
    // about. Bumping `gen` above already retired any retry in flight (D-1046),
    // so this cannot race one back into existence.
    setKickoffFailed(null);
    setRetrying(false);

    // B-1: armed BEFORE the await, not after. `myAttemptRef` records the
    // sheet's INTENT TO CREATE, not a receipt for a completed one — and the
    // window it has to cover starts the moment `ccd` is asked, not the moment
    // it answers. `cmd_start` writes `$REG/<id>.uuid` and the rest of the
    // fields, THEN `_spawn`s (`ccd/ccd:12206-12208`); the server lists a session
    // on its `.uuid` file alone (`registry.ts:793` — `started` does not gate
    // listing, and is written after `_spawn` anyway) and reports `status:
    // 'idle'` as soon as tmux has the id (`fleet.ts:236-237`); the watcher
    // ticks every 2 s (`watch.ts:533`) while the HTTP call is still blocked in
    // `_accept_first_run_prompts`/`_inject_spawn_effort`. So a frame carrying
    // the new session arrives MANY SECONDS before `createSession` resolves.
    // Armed after the await, `isOwnAttempt` was false for that entire window
    // and the D-292 refusal rendered INSTEAD of the confirm fragment: the
    // "Starting…" indicator vanished and the operator was told not to start a
    // program they were already starting. Acting on that copy (closing the
    // sheet) bumps `gen`, the post-await guard below returns, `waitRef` is
    // never set — and the kickoff is never sent, leaving an un-briefed
    // coordinator running. That is the Important-2 harm through another door.
    const preLive = liveIdsIn(fleet.getState().sessions); // B-2, before anything is created
    myAttemptRef.current = { project: projectName };

    try {
      await createSession({ wrapper, project: projectName, workdir: project.workdir });
    } catch (err) {
      if (gen.current !== mine) return; // superseded — the sheet has moved on
      // B-1: a create that FAILED is not an outstanding attempt, and leaving
      // the ref armed would suppress a genuine refusal for a session this
      // sheet never started. Cleared only on this attempt's own failure —
      // the superseded path above returns first, because a newer attempt (or
      // a close) already owns the ref.
      myAttemptRef.current = null;
      setStarting(false);
      setError(startErrorText(err));
      return;
    }
    if (gen.current !== mine) return; // superseded while the create was in flight

    waitRef.current = { mine, wrapper, project: projectName, slug: slug.trim(), title: title.trim(), preLive };
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Only this attempt's own timeout fires into it — a later attempt (or
      // one already resolved) owns `waitRef` now. Review fix round 1,
      // Important 2: `waitRef` is deliberately NOT nulled here — the wait
      // does not give up, only the busy UI does. `checkForMatch` (below,
      // driven by every later `/ws/fleet` frame) keeps watching for exactly
      // this `mine`'s target, so a session that lands at t=25s after a
      // 20s timeout still gets its kickoff sent and still navigates —
      // "started, not shown yet" was true when it was said, and stays true
      // rather than becoming a dead end the operator has to notice and
      // finish by hand.
      if (waitRef.current?.mine === mine) {
        setStarting(false);
        setTimedOut(true);
      }
    }, START_PROGRAM_WAIT_MS);
    // Covers the case where the row landed DURING the create — common, per
    // B-1's own timing note. It cannot bind a row that was already alive
    // before the create: `preLive` was snapshotted above, and that is exactly
    // the stale binding B-2 closed.
    checkForMatch();
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow="new program" title="Start a program">
      <div className="program-start-sheet">
        <p className="sheet-copy">
          Slug, title, and the project it runs in — the coordinator picks up from there.
        </p>
        <input
          className="proj-search"
          type="text"
          placeholder="Program slug (e.g. build4-conversation-and-controls)"
          aria-label="Program slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <input
          className="proj-search"
          type="text"
          placeholder="Program title"
          aria-label="Program title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <input
          className="proj-search"
          type="search"
          placeholder="Search projects"
          aria-label="Search projects"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {list === null && listError === null ? (
          <Skeleton lines={4} className="proj-skel" />
        ) : listError !== null ? (
          <p className="proj-error" role="alert">
            Couldn't load the project list — {listError}
          </p>
        ) : (
          <div className="proj-list">
            {filtered.map((p) => {
              const selected = p.workdir === project?.workdir;
              return (
                <button
                  key={p.workdir}
                  type="button"
                  className={selected ? 'proj-row proj-row--selected' : 'proj-row'}
                  onClick={() => setProject(p)}
                >
                  <span className="proj-glyph" aria-hidden="true">{selected ? '❯' : ''}</span>
                  <span className="proj-name">{p.name}</span>
                  <span className="proj-dir">{p.workdir}</span>
                  {/* F3 — THREE arms, because the wire has three
                      (`ProjectRow` in shared/api.ts): the key ABSENT is a
                      server too old to measure readiness and renders nothing;
                      `null` is this server, not swept yet; an object is the
                      answer. Folding the first two together would erase the
                      difference between "upgrade the server" and "wait a
                      moment", so the check is `=== undefined` and never a
                      truthiness test. */}
                  {p.readiness === undefined ? null : p.readiness === null ? (
                    <span className="proj-ready" data-verdict="pending"
                      title="measuring program readiness">
                      {READY_PENDING_GLYPH} checking
                    </span>
                  ) : (
                    <span className="proj-ready" data-verdict={p.readiness.verdict}
                      title={readinessTitle(p.readiness)}>
                      {READY_GLYPH[p.readiness.verdict]} {readinessWord(p.readiness)}
                    </span>
                  )}
                  {/* The reasons, VISIBLY. `title=` is unreachable on a phone,
                      and "which precondition" is the half an operator acts on
                      — the verdict word alone only says that something is
                      wrong. Nothing is rendered when the project is ready:
                      there is no list to show. */}
                  {p.readiness !== undefined && p.readiness !== null
                    && p.readiness.verdict !== 'ready' && (
                    <span className="proj-ready-why">
                      {missingPreconditions(p.readiness).join(' · ')}
                    </span>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && <p className="proj-none">No project matches "{query}"</p>}
          </div>
        )}

        {project !== null && (
          existing !== null && !isOwnAttempt ? (
            // D-292: refuses BEFORE the tap — no confirm button rendered
            // at all, not merely a disabled one, so there is no control here
            // that could hijack the running session. `!isOwnAttempt` (review
            // fix round 1, Important 2): a session that matches THIS sheet's
            // own last attempt is not a collision to refuse — it is the
            // create finally showing up, possibly after a D-291 timeout
            // already told the operator "not shown yet". Falling through to
            // the ordinary branch below lets `timedOut`/`checkForMatch`
            // finish the job instead of lying that it belongs to someone
            // else's mid-task session.
            // Wave-4 review, MINOR 6 (D-1044's own instruction, finally
            // obeyed): the old half said the kickoff would land in a session
            // "which is running mid-task". `liveMainCheckoutIn` matches any
            // row whose status is not `dead` — an idle one included — so that
            // was a busy state this arm never measured, and the mail lane
            // removed the hazard anyway: a queued kickoff waits for the
            // session's next quiet boundary and interrupts nothing. `main`
            // hedged it as "may be"; this wave hardened a hedge into a false
            // factual claim, which is the wrong direction. What survives is
            // the ADDRESSING hazard, true whether the session is busy or
            // idle: it was started for something else, and either it becomes
            // this program's coordinator or the project ends up with two.
            //
            // The copy names the SESSION, never the account: this arm is
            // wrapper-independent, so the matched row's own `wrapper` may
            // differ from the projected one (a swap moves it, `ccd/ccd:13125`)
            // and naming an account here would state a fact the match never
            // established. Both outcomes are covered rather than the one the
            // wrapper-scoped version could assume: if this IS the row
            // `cmd_start` resolves to, the kickoff lands in it mid-task; if it
            // is not, the start succeeds and leaves the project with two
            // coordinators. The sentence has to be true in both, because this
            // arm cannot tell them apart without recomputing the id.
            <p className="program-start-existing">
              {`${existing.id} is already running in ${project.name} — open it, or pick another project. `
                + 'Starting here would either make that session the coordinator for this program, '
                + 'whatever it was started for, or leave the project running two coordinators.'}
            </p>
          ) : projected === null ? (
            // D-284: the server's own "nothing is placeable" — refuse with
            // copy rather than guessing a wrapper.
            <p className="program-start-refuse">
              Nothing is placeable — every home-able account is disabled.
            </p>
          ) : (
            <>
              {/* Review, I1: read through `markerState`, the TOTAL door Task
                  11 minted for this (`coordWords.ts:43`) — `coord.pause` is
                  shape-validated at FRAME level only (`stores/fleet.ts`) and
                  reaches a renderer as a raw string, so a `=== 'set'` test
                  narrowed a distinction this component RECEIVED (the
                  architecture doc's highest-yield rule) and stayed silent for
                  `unmeasurable` — the ONE state where the coordinator is
                  guaranteed to be refused at its first dispatch, and the one
                  `CoordBanner` one element above already reports correctly.
                  `coord !== null` is checked separately and first: that is
                  the FOURTH, client-side state (no frame has arrived yet),
                  and `markerState(undefined)` is `'unmeasurable'`, so wrapping
                  `coord?.pause` alone would warn about a fleet nothing has
                  reported anything about. Warns, never blocks — spec §4.4. */}
              {coord !== null && markerState(coord.pause) !== 'clear' && (
                <p className="program-start-warn">
                  {markerState(coord.pause) === 'set'
                    ? 'The fleet is paused — the coordinator will be refused at its first dispatch until it is resumed.'
                    : 'The registry could not be read — the mail sweep fails shut on that, so the '
                      + 'kickoff itself would not be delivered, and dispatch would refuse the '
                      + 'coordinator afterwards just as a pause refuses it.'}
                </p>
              )}
              <p className="program-start-ledger">
                {`Its ledger: ${ledgerPath(slug.trim() === '' ? '…' : slug.trim())}`}
              </p>
              <p className="program-start-note">
                The kickoff is queued as mail and lands at the session&rsquo;s next quiet moment,
                usually a minute or two. The run row arrives after that, once the coordinator
                opens it — not from this sheet.
              </p>
              {timedOut && (
                <p className="program-start-timeout">
                  Started — the board just hasn't shown it yet. Check the fleet screen.
                </p>
              )}
              {error !== null && <p className="program-start-error">{error}</p>}
              {/* Program-leverage wave 4: the kickoff could not be QUEUED.
                  Deliberately a standing statement with an act beside it, not a
                  toast — see `kickoffFailed`'s own declaration for why, and note
                  that both controls reuse classes that are already grounded and
                  pinned (`program-start-error`, `program-start-go`) rather than
                  introducing a coloured rule the contrast census has never
                  seen. */}
              {kickoffFailed !== null && (
                <>
                  <p className="program-start-error">
                    {/* Wave-4 review, MINOR 3 (D-1120). This used to open
                        "<id> is running, but…", which on a 404 asserts the exact
                        fact the registry had just denied — above a retry that
                        cannot succeed. What the sheet KNOWS is that it started
                        the session and that nothing was queued for it; the
                        reason comes last, where a `why` with no trailing period
                        (the `err.message` floor) does not read as a typo. */}
                    {`Started ${kickoffFailed.sessionId}, but its kickoff could not be queued `
                      + `— nothing was sent, and it has no brief yet. ${kickoffFailed.why}`}
                  </p>
                  <button
                    type="button"
                    className="program-start-go"
                    disabled={retrying}
                    onClick={() => void retryKickoff()}
                  >
                    {retrying ? 'Queueing…' : 'Queue the kickoff again'}
                  </button>
                  <button
                    type="button"
                    className="program-start-go"
                    onClick={() => navigate(`/s/${encodeURIComponent(kickoffFailed.sessionId)}`)}
                  >
                    Open it without a brief
                  </button>
                </>
              )}
              {/* B-3: `existing !== null` reaches this branch only when
                  `isOwnAttempt` suppressed the refusal above — the sheet's own
                  session has appeared and `finish()` is sending its kickoff.
                  `start()` returns immediately on that state (`existing !==
                  null`), so without this the control was permanently inert
                  with no feedback: the same dead-tap class review round 1
                  fixed for the placement-pending case, reopened by the
                  suppression. Reachable whenever `queueKickoff()` is slow
                  after a D-291 timeout has already set `starting` back to
                  false. */}
              <button
                type="button"
                className="program-start-go"
                disabled={
                  slug.trim() === '' || title.trim() === '' || starting
                  || projected === undefined || existing !== null
                }
                onClick={() => void start()}
              >
                {starting
                  ? 'Starting…'
                  : existing !== null
                    ? 'Started — opening it…'
                    : projected === undefined
                      ? 'Checking placement…'
                      : `Start ${slug.trim() === '' ? '…' : slug.trim()} on ${accountLabel(roster, projected.wrapper)}`}
              </button>
            </>
          )
        )}
      </div>
    </Sheet>
  );
}
