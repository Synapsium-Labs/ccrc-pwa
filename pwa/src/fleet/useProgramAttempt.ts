// ONE attempt to start a program, from the create through the bounded wait to
// the kickoff — and the recovery door a failed kickoff leaves behind.
//
// Extracted from `StartProgramSheet.tsx`, where it was interleaved with the
// form state and ~290 lines of JSX. It is a hook and not a component for the
// reason `useProjectList` is: nothing here renders, and the sheet's refusal
// chain consults `starting`/`timedOut`/`error` from several arms.
//
// WHAT DID NOT MOVE, deliberately: the composite guard that decides whether an
// attempt may begin at all (`starting || !kickoffVerdict.ok || project === null`,
// plus the placement and collision returns). Those are statements about the
// FORM's verdicts, which live in the sheet; `start-program.test.tsx` source-pins
// the first of them BY FILE, and the pin names the sheet because that is where
// the boundary belongs. `begin()` below takes an already-resolved target and
// asks no question the caller has already answered.
//
// D-291 (the create returns no id, so the new session is WAITED for and matched
// on fields the server really reports) and D-292 (`cmd_start` is idempotent, so
// a collision is refused before the tap) are the two rulings that make this
// shape what it is; `StartProgramSheet.tsx`'s own header carries the full
// argument for both and is the thing to read first.
import { useEffect, useRef, useState } from 'react';
import type { FleetSession } from '../../../shared/api';
import { apiErrorText, kickoffErrorText } from '../lib/api';
import { navigate } from '../lib/router';
import type { FleetStore } from '../stores/fleet';
import {
  START_PROGRAM_WAIT_MS, liveIdsIn, startErrorText, startedSessionFor,
} from './startProgramPolicy';
import type { KickoffFailure } from './KickoffRecovery';

/** Everything `begin()` needs, already decided. No `ProjectRow`, no placement,
 *  no verdict — a target this hook could second-guess is a rule with two
 *  implementations, which is what this file's neighbours exist to refuse. */
export interface AttemptTarget {
  readonly wrapper: string;
  readonly project: string;
  readonly workdir?: string;
  readonly slug: string;
  readonly title: string;
}

export interface ProgramAttempt {
  /** A create is in flight, or its session has not been seen on a fleet frame
   *  yet. Withdrawn by the D-291 timeout without abandoning the wait. */
  readonly starting: boolean;
  /** The bounded wait elapsed: started, not shown yet. NOT a failure — the
   *  reactive half keeps watching, and a late session still gets its kickoff. */
  readonly timedOut: boolean;
  /** The create itself refused. Separate from `failure`, which is the kickoff's. */
  readonly error: string | null;
  /**
   * A kickoff that could not be QUEUED, held until the operator does something
   * about it (program-leverage wave 4). The only state here that carries an act.
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
  readonly failure: KickoffFailure | null;
  readonly retrying: boolean;
  /** True when a live main checkout in `project` is this sheet's own doing.
   *  Compared on PROJECT ALONE — `cmd_swap` moves a live session's wrapper
   *  while keeping its id (`ccd/ccd:13459`), so a wrapper-comparing ownership
   *  test reports the sheet's own session as someone else's the moment it is
   *  swapped, which is the exact defect this suppression exists to prevent. */
  readonly startedHere: (project: string) => boolean;
  readonly begin: (target: AttemptTarget) => Promise<void>;
  readonly retry: () => Promise<void>;
}

/**
 * @param open   the sheet's visibility. The component is mounted
 *               UNCONDITIONALLY at `RunsScreen` level and keeps running
 *               underneath, so a close must RETIRE everything outstanding
 *               rather than relying on an unmount that never comes.
 * @param targetWorkdir,targetWrapper  the two facts that NAME an attempt's
 *               target. When either changes, `timedOut` is withdrawn: the
 *               sentence it renders ("started X in Y on Z; the board hasn't
 *               shown it yet") stops being true of what is on screen. Keyed on
 *               these and never on the projection object, which the accounts
 *               poll rebuilds every 20 s — that would clear an honest timeout
 *               on a tick rather than on a change.
 */
export function useProgramAttempt(
  open: boolean,
  targetWorkdir: string | undefined,
  targetWrapper: string | undefined,
  deps: {
    fleet: FleetStore;
    createSession: (b: { wrapper: string; project: string; workdir?: string }) => Promise<void>;
    queueKickoff: (id: string, b: { slug: string; title: string }) => Promise<{ queued: boolean }>;
  },
): ProgramAttempt {
  const { fleet, createSession, queueKickoff } = deps;
  const sessions = fleet((s) => s.sessions);

  const [starting, setStarting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<KickoffFailure | null>(null);
  const [retrying, setRetrying] = useState(false);

  // `gen` is bumped on every close and every new attempt, so a create, kickoff
  // or match that resolves AFTERWARDS cannot write into whatever the sheet
  // shows next. The timer is cleared so it cannot fire into a retired attempt,
  // and the wait target is dropped so a LATER `sessions` frame cannot
  // resurrect one.
  const gen = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitRef = useRef<{ mine: number; wrapper: string; project: string; slug: string; title: string; preLive: ReadonlySet<string> } | null>(null);
  // The D-291 timeout and the D-292 collision refusal INTERACT — neither ruling
  // could see this alone. A timeout does not mean the create failed; it means
  // the board hasn't shown it YET. If the session then lands a moment later,
  // the sheet's `existing` finds it — and without this ref it would render the
  // D-292 refusal ("…is already running… may be mid-task") for the session it
  // JUST started itself, which is neither running anyone else's work nor true.
  //
  // It outlives the timeout (unlike `waitRef`, which `finish()` nulls the
  // instant a match is found, so a second `/ws/fleet` frame arriving
  // mid-`queueKickoff()` cannot fire a duplicate kickoff): cleared only on
  // close or by a NEWER attempt overwriting it, so the suppression holds for
  // the whole window from a successful create through navigation, not merely
  // while the wait is nominally in progress.
  //
  // BOUNDED, which is the property that matters: non-null only after a create
  // for THIS project SUCCEEDED in the sheet's current lifetime, when the
  // pre-tap refusal had just proved no live main checkout existed there. And
  // the suppression can only ever hide a WARNING — the arm that ACTS is
  // `startedSessionFor`, still wrapper-scoped, so widening the ownership test
  // cannot send a kickoff anywhere it would not already go.
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
    setStarting(false);
    setTimedOut(false);
    setError(null);
    setFailure(null);
    setRetrying(false);
  }, [open]);

  useEffect(() => () => clearTimer(), []);

  // `waitRef` is deliberately NOT touched here: the wait keeps watching for the
  // session it really did start (D-291) — only this SENTENCE is withdrawn.
  useEffect(() => {
    setTimedOut(false);
  }, [targetWorkdir, targetWrapper]);

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
        setFailure({ sessionId: session.id, slug: w.slug, title: w.title, why: kickoffErrorText(apiErrorText(err)) });
      });
  };

  const checkForMatch = (): void => {
    const w = waitRef.current;
    if (w === null) return;
    // `fleet.getState()`, not the render-scoped `sessions` — this can run from
    // inside `begin()`, synchronously after `createSession` resolves, before
    // the closure that captured `sessions` has re-rendered with a fresher one.
    const found = startedSessionFor(fleet.getState().sessions, w.wrapper, w.project, w.preLive);
    if (found !== null) finish(found, w);
  };

  // D-291: the reactive half of the bounded wait. `sessions` is replaced
  // wholesale on every `/ws/fleet` frame (`stores/fleet.ts`), so this fires on
  // every fleet tick while a wait is outstanding — the moment the new session's
  // row appears, `checkForMatch` finds it.
  useEffect(() => {
    checkForMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const begin = async (t: AttemptTarget): Promise<void> => {
    const mine = (gen.current += 1);
    setStarting(true);
    setTimedOut(false);
    setError(null);
    // D-1121. Same withdrawal as `timedOut`'s, and for the same reason:
    // `failure` is a statement about ONE attempt's target, and a new attempt
    // makes it a red block ABOVE a Start button aimed somewhere else. Unlike
    // `timedOut` it carries an act — the door navigates to the previous
    // attempt's session, stranding the create being started right now.
    //
    // RETIRED, NOT RE-KEYED, and this costs something: the door is the only
    // control that can re-post for that session, so a kickoff that failed and
    // was then walked away from is not recoverable from this sheet. That is the
    // trade taken deliberately — the operator has the door on screen, in red,
    // directly above the Start they are choosing to tap instead, and a second
    // attempt is a clear statement of what they want the sheet to be about.
    // Bumping `gen` above already retired any retry in flight (D-1046), so this
    // cannot race one back into existence.
    setFailure(null);
    setRetrying(false);

    // B-1: armed BEFORE the await, not after. `myAttemptRef` records the INTENT
    // TO CREATE, not a receipt for a completed one — and the window it has to
    // cover starts the moment `ccd` is asked, not the moment it answers.
    // `cmd_start` writes `$REG/<id>.uuid` and the rest of the fields, THEN
    // `_spawn`s (`ccd/ccd:12532-12534`); the server lists a session on its
    // `.uuid` file alone (`registry.ts:869` — `started` does not gate listing,
    // and is written after `_spawn` anyway) and reports `status: 'idle'` as
    // soon as tmux has the id (`fleet.ts:236-237`); the watcher ticks every 2 s
    // (`watch.ts:614`) while the HTTP call is still blocked in
    // `_accept_first_run_prompts`/`_inject_spawn_effort`. So a frame carrying
    // the new session arrives MANY SECONDS before `createSession` resolves.
    // Armed after the await, the sheet's `isOwnAttempt` was false for that
    // entire window and the D-292 refusal rendered INSTEAD of the confirm
    // fragment: the "Starting…" indicator vanished and the operator was told
    // not to start a program they were already starting. Acting on that copy
    // (closing the sheet) bumps `gen`, the post-await guard below returns,
    // `waitRef` is never set — and the kickoff is never sent, leaving an
    // un-briefed coordinator running.
    const preLive = liveIdsIn(fleet.getState().sessions); // B-2, before anything is created
    myAttemptRef.current = { project: t.project };

    try {
      await createSession({ wrapper: t.wrapper, project: t.project, workdir: t.workdir });
    } catch (err) {
      if (gen.current !== mine) return; // superseded — the sheet has moved on
      // B-1: a create that FAILED is not an outstanding attempt, and leaving
      // the ref armed would suppress a genuine refusal for a session this sheet
      // never started. Cleared only on this attempt's own failure — the
      // superseded path above returns first, because a newer attempt (or a
      // close) already owns the ref.
      myAttemptRef.current = null;
      setStarting(false);
      setError(startErrorText(err));
      return;
    }
    if (gen.current !== mine) return; // superseded while the create was in flight

    waitRef.current = {
      mine, wrapper: t.wrapper, project: t.project, slug: t.slug, title: t.title, preLive,
    };
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Only this attempt's own timeout fires into it — a later attempt (or one
      // already resolved) owns `waitRef` now. `waitRef` is deliberately NOT
      // nulled here: the wait does not give up, only the busy UI does.
      // `checkForMatch`, driven by every later `/ws/fleet` frame, keeps
      // watching for exactly this `mine`'s target, so a session that lands at
      // t=25s after a 20s timeout still gets its kickoff sent and still
      // navigates — "started, not shown yet" was true when it was said, and
      // stays true rather than becoming a dead end the operator has to notice
      // and finish by hand.
      if (waitRef.current?.mine === mine) {
        setStarting(false);
        setTimedOut(true);
      }
    }, START_PROGRAM_WAIT_MS);
    // Covers the case where the row landed DURING the create — common, per
    // B-1's own timing note. It cannot bind a row that was already alive before
    // the create: `preLive` was snapshotted above, and that is exactly the
    // stale binding B-2 closed.
    checkForMatch();
  };

  /** Re-post the kickoff for a session that is already running — the door the
   *  durable queue makes possible for the first time.
   *
   *  It re-uses `failure.sessionId` and never re-measures the fleet: the target
   *  was chosen once by `startedSessionFor` under D-291/D-292's whole
   *  apparatus, and a retry that re-opened that question could land the kickoff
   *  somewhere else entirely.
   *
   *  GENERATION-GUARDED ON EVERY ARM (D-1046). It shipped guarding none, which
   *  is the same defect `finish()` carries two guards against — and worse here,
   *  because this call settles later than anything else: the operator has
   *  already read a failure and tapped a button before the round trip even
   *  starts, which is exactly when a close is likely. A late SUCCESS navigated
   *  to the old session under whatever the operator had opened next; a late
   *  REJECTION re-planted the block the close had just cleared, so the next
   *  program's sheet opened showing the previous attempt's retry door aimed at
   *  the previous attempt's session. The `finally` is guarded too, and for a
   *  third reason: a newer retry owns `retrying` once `gen` has moved, and
   *  clearing it from here would re-enable a button whose call is still
   *  outstanding. */
  const retry = async (): Promise<void> => {
    const k = failure;
    if (k === null || retrying) return;
    const mine = gen.current;
    setRetrying(true);
    try {
      await queueKickoff(k.sessionId, { slug: k.slug, title: k.title });
      if (gen.current !== mine) return; // superseded — a later close/open owns the phase now
      setFailure(null);
      navigate(`/s/${encodeURIComponent(k.sessionId)}`);
    } catch (err: unknown) {
      if (gen.current !== mine) return; // superseded — the block this would re-plant is retired
      setFailure({ ...k, why: kickoffErrorText(apiErrorText(err)) });
    } finally {
      if (gen.current === mine) setRetrying(false);
    }
  };

  return {
    starting, timedOut, error, failure, retrying,
    startedHere: (project: string) => myAttemptRef.current?.project === project,
    begin,
    retry,
  };
}
