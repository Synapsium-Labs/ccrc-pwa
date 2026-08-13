// The run board's own door onto a NEW program (Task 13, spec §4.4). This is
// a COMPOSITION, not a compound route: `POST /api/runs` is the coordinator's
// own (it demands a live `claimedBy` and refuses a second claimant,
// `routes.ts:660-709`) and this build does not add a route that both spawns
// a session and opens a run. The flow is three EXISTING calls —
// `api.projects`, `api.createSession`, `api.prompt` — plus `useProjectedHome`
// for the account name, composed here and nowhere else.
//
// D-B4-18/19 (`docs/superpowers/plans/2026-08-11-build4-conversation-and-
// controls.md`'s Deviations section) are both load-bearing for this file and
// are why it is not the simple "create, then prompt the id it returns" shape
// the brief's own interface list reads as:
//
//   * `POST /api/sessions`'s success body is the literal `{ok:true}`
//     (`server/src/server.ts:593-596`, `runCcdOr502`) — no id. `ccd`
//     computes the id as `${wrapper}-${project}` (`ccd/ccd:185`, `_id()`)
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
//   * `cmd_start` is IDEMPOTENT (`ccd/ccd:7192-7203`): a second `start` whose
//     `_id()` is already `_alive` is a no-op that attaches to the session
//     already there. A blind kickoff would inject a coordinator brief into a
//     session that may be mid-task, so this sheet checks for that collision
//     BEFORE the tap — same posture as the projection naming the account
//     before the tap rather than guessing — and refuses with no confirm
//     button at all when it finds one.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { accountLabel } from '../lib/accounts';
import { markerState } from './coordWords';
import { ApiError, api, apiErrorText } from '../lib/api';
import { navigate } from '../lib/router';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { useProjectedHome } from './useProjectedHome';
import './fleet.css';

interface Project {
  name: string;
  workdir: string;
}

/** The one standing kickoff. It names three things and asserts nothing:
 *  the program slug, the ledger path the operator is expected to have
 *  committed, and the skill to run. THE SERVER NEVER VALIDATES THE LEDGER
 *  (`coord/routes.ts`'s open route: "PARSED BY NOTHING") and this sheet must
 *  not pretend to either — naming the path is exactly what that route already
 *  does in its own response, and this stops there. */
const ledgerPath = (slug: string): string => `docs/superpowers/programs/${slug}.md`;

// Review fix round 1, Minor 3: `kickoff` used to build this path a second
// time inline rather than calling `ledgerPath` — this file's own header
// cites "Two implementations of one rule drift" as the reason it exists at
// all, and had drifted into being an example of the thing it warns against.
export const kickoff = (slug: string, title: string): string =>
  `You are the coordinator for program \`${slug}\` (${title}).\n` +
  `Its ledger is \`${ledgerPath(slug)}\`.\n` +
  `Run the ccrc-coordinator skill and open the run for wave 1.`;

/** D-B4-18: how long the sheet waits for the freshly created session to
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
 *  WORKSPACE row too, with a `_ws_least_loaded` wrapper (`ccd/ccd:1164+`) that
 *  `useProjectedHome` mirrors exactly (`server/src/limits.ts:96`) — so a
 *  two-field match hits live workers on a box in its normal state.
 *  `FleetSession.workspace` is server-reported and documented "null for a
 *  project's main checkout" (`shared/api.ts:35-37`), so this costs NO id
 *  arithmetic and D-B4-18's "never recompute the id" holds unchanged. */
const isMainCheckoutOf = (s: FleetSession, project: string): boolean =>
  s.project === project && s.workspace === null;

/** D-B4-19's arm: "is a live main checkout already running in this project?"
 *
 *  WRAPPER-INDEPENDENT, and that is a correction, not an oversight (re-review
 *  of the C1 fix). `cmd_swap` rewrites the registry's `wrapper` field and
 *  KEEPS the id (`ccd/ccd:7307`, `_reg_set "$id" wrapper "$target"`), while
 *  `cmd_start`'s collision test is `_alive "$(_id "$wrapper" "$project")"`
 *  (`ccd/ccd:7202-7203`) — keyed on the ID, which a swap does not move. On the
 *  live fleet 5 of 10 main checkouts already report a `wrapper` that differs
 *  from their own id prefix (`claude-rp-llm` reports `wrapper=claude2`), so a
 *  wrapper-scoped refusal MISSES a real collision: the row reports `Y`, the
 *  projection says `W`, no match, the operator taps Start, `ccd start W P`
 *  resolves `_id` to the live `W-P`, prints "already running" and exits 0 —
 *  the HTTP call SUCCEEDS, the wrapper-scoped wait never matches, and the
 *  sheet ends on "Started — the board just hasn't shown it yet" for a program
 *  that never started. A dead end, reachable on half this fleet's projects.
 *
 *  This arm cannot ask the exact question (`_alive(_id(W,P))`) without
 *  recomputing the id, which D-B4-18 forbids. So it asks the WIDER one and
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

/** D-B4-18's arm: "has the session I just asked for appeared yet?"
 *
 *  WRAPPER-SCOPED, deliberately, and NOT to be widened to match the refusal
 *  above. This one ACTS — it sends the coordinator kickoff and navigates — so
 *  its question is genuinely "the session this sheet created", which is the
 *  one at the wrapper it passed to `createSession`. Dropping `s.wrapper ===
 *  wrapper` here would let a DIFFERENT live main checkout in the same project
 *  (someone else's, or a swapped one) collect this sheet's kickoff: verbatim
 *  the hijack D-B4-19 exists to prevent, arriving through the wait instead.
 *
 *  NO liveness conjunct, equally deliberately: `cmd_start` writes the registry
 *  fields before tmux is necessarily up, so for a beat the session it just
 *  created is reported `dead`. Excluding it would time out a wait on a session
 *  that really did start — not knowing yet is not "not there". */
function startedSessionFor(
  sessions: readonly FleetSession[],
  wrapper: string,
  project: string,
): FleetSession | null {
  return sessions.find((s) => isMainCheckoutOf(s, project) && s.wrapper === wrapper) ?? null;
}

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
  prompt?: (id: string, text: string) => Promise<void>;
  loadProjects?: () => Promise<{ roots: string[]; projects: Project[] }>;
}

export function StartProgramSheet({
  open,
  onClose,
  fleet = useFleetStore,
  createSession = api.createSession,
  prompt = api.prompt,
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
  const [project, setProject] = useState<Project | null>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Project[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  // holds async state across the D-B4-18 wait, so closing mid-flight must
  // retire everything outstanding: `gen` is bumped so a create/prompt/match
  // that resolves AFTER a close cannot write into whatever the sheet shows
  // next, the timer is cleared so it cannot fire into a retired attempt, and
  // the wait target is dropped so a LATER `sessions` frame cannot resurrect
  // it. A closed sheet also forgets its own form choices, same as
  // NewSessionSheet.
  const gen = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitRef = useRef<{ mine: number; wrapper: string; project: string; slug: string; title: string } | null>(null);
  // Review fix round 1, Important 2: the D-B4-18 timeout and the D-B4-19
  // collision refusal INTERACT — neither ruling could see this alone. A
  // timeout does not mean the create failed; it means the board hasn't
  // shown it YET. If the session then lands a moment later, `existing`
  // (below) finds it — and without this ref, the sheet would render the
  // D-B4-19 refusal ("…is already running… may be mid-task") for the
  // session it JUST started itself, which is neither running anyone else's
  // work nor true. `myAttemptRef` outlives the timeout (unlike `waitRef`,
  // which `finish()` still nulls the instant a match is found, so a second
  // `/ws/fleet` frame arriving mid-`prompt()` cannot fire a duplicate
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
  // (`ccd/ccd:7307`), so a session this sheet started at `W` can be reported
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
  // (D-B4-18, review fix round 1 Important 2) — only this SENTENCE, which has
  // stopped being true of what is on screen, is withdrawn.
  useEffect(() => {
    setTimedOut(false);
  }, [project?.workdir, projected?.wrapper]);

  // Sends the kickoff and navigates — the ONLY place either happens. `w.mine`
  // is checked again after the prompt call settles: a close during the
  // (short) prompt round-trip must not navigate a screen the operator is no
  // longer looking at.
  const finish = (session: FleetSession, w: { mine: number; slug: string; title: string }): void => {
    clearTimer();
    waitRef.current = null;
    void prompt(session.id, kickoff(w.slug, w.title))
      .catch((err: unknown) => {
        // The session is real and the create already succeeded — only the
        // nudge failed to land. Said once, non-blocking: the operator can
        // finish the kickoff by hand from inside the session this still
        // navigates to below.
        toast(`Started, but the kickoff prompt failed to send — ${apiErrorText(err)}`, 'error');
      })
      .then(() => {
        if (gen.current !== w.mine) return; // superseded — a later close/open owns the phase now
        setStarting(false);
        navigate(`/s/${encodeURIComponent(session.id)}`);
      });
  };

  const checkForMatch = (): void => {
    const w = waitRef.current;
    if (w === null) return;
    // `fleet.getState()`, not the render-scoped `sessions` — this can run
    // from inside `start()`, synchronously after `createSession` resolves,
    // before the closure that captured `sessions` has had a chance to
    // re-render with a fresher value.
    const found = startedSessionFor(fleet.getState().sessions, w.wrapper, w.project);
    if (found !== null) finish(found, w);
  };

  // D-B4-18: the reactive half of the bounded wait. `sessions` is replaced
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

  // D-B4-19: recomputed on every render from the reactive store selector —
  // "whenever the target changes" (a different project picked, or the
  // projection itself moving) falls out of React's own render cycle rather
  // than a second piece of state tracking the same fact.
  // Wrapper-independent — see `liveMainCheckoutIn`'s own docstring for why a
  // wrapper-scoped refusal misses a real `cmd_start` collision on any session
  // that has been swapped. `projected != null` is still required, but only
  // because there is no point refusing a start that has no wrapper to place
  // with in the first place (the D-B4-11 arm below handles saying so).
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
    if (projected == null) return; // undefined (no answer yet) or null (D-B4-11) — no wrapper to place with
    if (existing !== null) return; // defensive: the confirm button is not rendered in this case at all

    const wrapper = projected.wrapper;
    const projectName = project.name;
    const mine = (gen.current += 1);
    setStarting(true);
    setTimedOut(false);
    setError(null);

    try {
      await createSession({ wrapper, project: projectName, workdir: project.workdir });
    } catch (err) {
      if (gen.current !== mine) return; // superseded — the sheet has moved on
      setStarting(false);
      setError(startErrorText(err));
      return;
    }
    if (gen.current !== mine) return; // superseded while the create was in flight

    waitRef.current = { mine, wrapper, project: projectName, slug: slug.trim(), title: title.trim() };
    myAttemptRef.current = { project: projectName };
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
    checkForMatch(); // covers the (unusual) case where the row was already there
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
                </button>
              );
            })}
            {filtered.length === 0 && <p className="proj-none">No project matches "{query}"</p>}
          </div>
        )}

        {project !== null && (
          existing !== null && !isOwnAttempt ? (
            // D-B4-19: refuses BEFORE the tap — no confirm button rendered
            // at all, not merely a disabled one, so there is no control here
            // that could hijack the running session. `!isOwnAttempt` (review
            // fix round 1, Important 2): a session that matches THIS sheet's
            // own last attempt is not a collision to refuse — it is the
            // create finally showing up, possibly after a D-B4-18 timeout
            // already told the operator "not shown yet". Falling through to
            // the ordinary branch below lets `timedOut`/`checkForMatch`
            // finish the job instead of lying that it belongs to someone
            // else's mid-task session.
            // The copy names the SESSION, never the account: this arm is
            // wrapper-independent, so the matched row's own `wrapper` may
            // differ from the projected one (a swap moves it, `ccd/ccd:7307`)
            // and naming an account here would state a fact the match never
            // established. Both outcomes are covered rather than the one the
            // wrapper-scoped version could assume: if this IS the row
            // `cmd_start` resolves to, the kickoff lands in it mid-task; if it
            // is not, the start succeeds and leaves the project with two
            // coordinators. The sentence has to be true in both, because this
            // arm cannot tell them apart without recomputing the id.
            <p className="program-start-existing">
              {`${existing.id} is already running in ${project.name} — open it, or pick another project. `
                + 'Starting here would either send the kickoff into that session, which may be '
                + 'mid-task, or leave the project running two coordinators.'}
            </p>
          ) : projected === null ? (
            // D-B4-11: the server's own "nothing is placeable" — refuse with
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
                    : 'The registry could not be read — dispatch fails shut on that, so the coordinator '
                      + 'would be refused at its first dispatch just as a pause refuses it.'}
                </p>
              )}
              <p className="program-start-ledger">
                {`Its ledger: ${ledgerPath(slug.trim() === '' ? '…' : slug.trim())}`}
              </p>
              <p className="program-start-note">
                The run row arrives later, once the coordinator opens it — not from this sheet.
              </p>
              {timedOut && (
                <p className="program-start-timeout">
                  Started — the board just hasn't shown it yet. Check the fleet screen.
                </p>
              )}
              {error !== null && <p className="program-start-error">{error}</p>}
              <button
                type="button"
                className="program-start-go"
                disabled={slug.trim() === '' || title.trim() === '' || starting || projected === undefined}
                onClick={() => void start()}
              >
                {starting
                  ? 'Starting…'
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
