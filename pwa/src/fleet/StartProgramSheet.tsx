// The run board's own door onto a NEW program (Task 13, spec §4.4). This is
// a COMPOSITION, not a compound route: `POST /api/runs` is the coordinator's
// own (it demands a live `claimedBy` and refuses a second claimant,
// `server/src/coord/routes.ts:1060`, refusing a second claimant in
// `server/src/coord/store.ts:443-451`) and this build does not add a route that both spawns
// a session and opens a run. The flow is three EXISTING calls —
// `api.projects`, `api.createSession`, `api.kickoff` — plus `useProjectedHome`
// as the old-server and untagged-project placement fallback, composed here and
// nowhere else. A present `ProjectRow.placement` owns the account name.
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
//     computes the id as `${wrapper}-${project}` (`ccd/ccd:1209`, `_id()`)
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
//   * `cmd_start` is IDEMPOTENT (`ccd/ccd:12440`): a second `start` whose
//     `_id()` is already `_alive` is a no-op that attaches to the session
//     already there. A blind kickoff would hand this program to a session
//     started for something else — the queue does not interrupt it, but it
//     does address it — so this sheet checks for that collision
//     BEFORE the tap — same posture as the projection naming the account
//     before the tap rather than guessing — and refuses with no confirm
//     button at all when it finds one.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProjectRow } from '../../../shared/api';
import { ledgerPath, programKickoffVerdict, shapeProgramSlug } from '../../../shared/api';
import { Button, Sheet, TEXT_INPUT_STACKED, TextInput } from '@ccrc/ui';

/** The sheet's confirm control. It was the FIFTH copy of the quiet control's
 *  eleven declarations — `quiet-control.test.ts` found it the day the other
 *  four were folded, which is the whole reason that census exists.
 *
 *  Three things ride beside the variant rather than in it, because they are
 *  this control's and not the family's: it spans the sheet (`size` defaults
 *  to `full`, so nothing is passed), it is a step up in size at `--fs-sm`,
 *  and it presses to 0.98 — shallower than the family's 0.96, as its own rule
 *  always said. */
import { accountLabel } from '../lib/accounts';
import { markerState } from './coordWords';
import { api } from '../lib/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { useProjectedHome } from './useProjectedHome';
import {
  READY_GLYPH, READY_PENDING_GLYPH, missingPreconditions, readinessTitle, readinessWord,
} from './readinessWords';
import { ProjectPicker } from './ProjectPicker';
import { ProjectRowShell } from './ProjectRowShell';
import {
  liveMainCheckoutIn, openRunVerdict, startProgramPlacement,
  type OpenRunVerdict,
} from './startProgramPolicy';
import { KickoffRecovery, PROGRAM_GO } from './KickoffRecovery';
import { useProjectList } from './useProjectList';
import { useProgramAttempt } from './useProgramAttempt';
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

export interface StartProgramSheetProps {
  open: boolean;
  onClose: () => void;
  /** The projects that already carry a NON-CLOSED run, measured by the run
   *  board from its own combined live+cold `active` list
   *  (`screens/RunsScreen.tsx`) and handed down. THE SHEET DOES NOT FETCH
   *  IT: `start-program.test.tsx`'s `expect(urls).toHaveLength(2)` pins this
   *  composition at exactly two network calls, so a third fetch here reds a
   *  suite rather than merely costing a request.
   *
   *  `null` is NOT MEASURED, and it is a third state on purpose — the board has
   *  neither a `runs` frame nor a finished cold read (`noSignalYet`,
   *  `RunsScreen.tsx`): a deep link straight to `/runs`, or a server too old
   *  to send the frame at all, in the window before `api.runs(true)` answers.
   *  Both of those paths END in a measured set; `null` is the window, not the
   *  outcome, and in it this sheet refuses rather than guesses.
   *
   *  REQUIRED, not defaulted. `new Set()` as a default would be a fold-to-permit
   *  written into the type; `null` as a default would silently refuse every
   *  caller that forgot. A compile error is the same discipline
   *  `reviveFleetSession` uses for a new wire field — every path computes it. */
  openRunProjects: ReadonlySet<string> | null;
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
   *  import it — one name for the text, another for the act.
   *
   *  Wave 5 changed the RETURN, not the call. `api.kickoff` answers `{queued}`
   *  now (D-1133), and `Promise<{queued: boolean}>` is not assignable to
   *  `Promise<void>` (D-1137, `TS2322` — `npm run build` runs `tsc --noEmit`
   *  before it builds anything, and vitest strips types, so the suite could
   *  never have caught this), so the default on the line below forces this type.
   *  THE SHEET STILL READS NO FIELD: "one was already waiting" is a distinction
   *  only the revive path renders. Ignoring a field is a rendering decision;
   *  declaring the shape an injected fake has to have is a contract one, and
   *  only the second is worth spending a type on. */
  queueKickoff?: (id: string, b: { slug: string; title: string }) => Promise<{ queued: boolean }>;
  loadProjects?: () => Promise<{ roots: string[]; projects: ProjectRow[] }>;
}

export function StartProgramSheet({
  open,
  onClose,
  openRunProjects,
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
  // `useAccountUsage`) warns against.
  const projected = useProjectedHome(open);

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [query, setQuery] = useState('');
  // Fetch the project list the moment the sheet opens — same idiom
  // NewSessionSheet already uses for the same call.
  // The project plane — a read on open, three answers, and the query's own
  // filter — lives in `useProjectList`: it was the one part of this 770-line
  // function that stood alone, and its `null`-vs-error distinction is what
  // `ProjectPicker` renders three arms from.
  const { list, listError, matching } = useProjectList(open, query, loadProjects);

  // A closed sheet forgets its own form choices, same as NewSessionSheet. The
  // attempt's own retirement — generation, timer, wait target — is
  // `useProgramAttempt`'s, on the same `open`.
  useEffect(() => {
    if (open) return;
    setSlug('');
    setTitle('');
    setProject(null);
    setQuery('');
  }, [open]);

  // `placementWrapper` and the project's workdir are the two facts that NAME
  // an attempt's target; `useProgramAttempt` withdraws its `timedOut`
  // sentence when either changes, and its own comment carries why it is keyed
  // on these and never on `projected`.
  const placement = project === null ? null : startProgramPlacement(project, projected);
  const placementWrapper = placement?.kind === 'projected' ? placement.wrapper : undefined;

  const attempt = useProgramAttempt(open, project?.workdir, placementWrapper,
                                    { fleet, createSession, queueKickoff });
  const { starting, timedOut, error } = attempt;

  // D-292: recomputed on every render from the reactive store selector.
  // Wrapper-independent — see `liveMainCheckoutIn`'s own docstring for why a
  // wrapper-scoped refusal misses a real `cmd_start` collision after a swap.
  // D-2694: the PROJECT placement decides whether a target exists; the global
  // untagged projection may be null or pending without erasing a route target.
  const existing =
    project !== null && placement?.kind === 'projected'
      ? liveMainCheckoutIn(sessions, project.name)
      : null;
  // Review fix round 1, Important 2: `existing` alone cannot tell "someone
  // else's session is in the way" apart from "the session I just started
  // has arrived" — both are `existing !== null`. The attempt's own record of
  // what it created is the one fact that distinguishes them; `startedHere`'s
  // docstring carries why the comparison is on `project` alone and why that
  // stays bounded.
  const isOwnAttempt = existing !== null && attempt.startedHere(existing.project);

  // Computed from `project` ALONE, and deliberately NOT written into
  // `existing`'s expression above. That one carries a `projected != null`
  // conjunct, which is harmless for D-292 only because the D-284 arm renders
  // directly beneath it — a run-based refusal riding the same conjunct would be
  // silently replaced by "Nothing is placeable" on exactly the fleet where
  // nothing is placeable: a state that has nothing to do with whether this
  // project already has a coordinator, and one the operator fixes by enabling an
  // account and walking straight into the collision. Two independent facts, two
  // independent measurements.
  const runVerdict: OpenRunVerdict | null =
    project === null ? null : openRunVerdict(openRunProjects, project.name);
  const kickoffVerdict = programKickoffVerdict(slug, title);
  // The ledger line previews a SLUG, not a kickoff: `programKickoffVerdict`
  // also refuses a blank title, and gating the path on that would blank a
  // perfectly good preview while the operator is still typing one. Same
  // shared shape decision, taken at the granularity this line needs.
  const slugPreview = shapeProgramSlug(slug);
  const kickoffOversize = !kickoffVerdict.ok && kickoffVerdict.kind === 'oversize';
  // Branch on the verdict's own FIELD, never on its prose. A blank title is not
  // an error to shout while the operator is still typing one, but the two causes
  // share `kind:'bad-request'` — comparing `detail` against the L0 sentence made
  // this sheet's behaviour depend on that sentence's wording, with no test
  // between a reword and a silently changed error.
  const showKickoffError = slug !== '' && !kickoffVerdict.ok
    && (kickoffOversize || kickoffVerdict.field !== 'title');

  const start = async (): Promise<void> => {
    // The button independently disables on this verdict, but a disabled control
    // never invokes its handler. `start-program.test.tsx` therefore source-pins
    // this defensive return too: either boundary becoming permissive must red.
    if (starting || !kickoffVerdict.ok || project === null) return;
    if (placement?.kind !== 'projected') return;
    if (existing !== null) return; // defensive: the confirm button is not rendered in this case at all
    // …and the run-board arm above it in the same `? :` chain withholds the
    // button on the same terms, so `runVerdict` needs no return of its own here.
    // Deliberate: React dispatches the handler attached by the render that
    // decided to draw the control, so no tap can carry a stale verdict — and a
    // guard no test can reach is exactly what `startedSessionFor`'s own
    // docstring refuses to ship. If a later change ever demotes either refusal
    // to a `disabled` term, BOTH need a return here.

    // Everything below the guards is the attempt machine's
    // (`useProgramAttempt`): the generation bump, the pre-create snapshot, the
    // bounded wait and its timeout, the match and the kickoff. What stays here
    // is the decision that an attempt may begin at all, and the already-resolved
    // target it begins on — nothing this call could second-guess.
    await attempt.begin({
      wrapper: placement.wrapper,
      project: project.name,
      workdir: project.workdir,
      slug: kickoffVerdict.slug,
      title: kickoffVerdict.title,
    });
  };

  // The standing recovery is its own component (`KickoffRecovery`), and its
  // file carries the argument for why — including the half extraction cannot
  // enforce: EVERY arm of the chain below must render it BESIDE its own
  // refusal, never instead of it (D-1149).
  const recovery = (
    <KickoffRecovery failure={attempt.failure} retrying={attempt.retrying}
                     onRetry={() => void attempt.retry()} />
  );

  return (
    <Sheet open={open} onClose={onClose} eyebrow="new program" title="Start a program">
      <div className="program-start-sheet">
        <p className="sheet-copy">
          Slug, title, and the project it runs in — the coordinator picks up from there.
        </p>
        <TextInput
          className={TEXT_INPUT_STACKED}
          placeholder="Program slug (e.g. build4-conversation-and-controls)"
          aria-label="Program slug"
          aria-invalid={showKickoffError}
          aria-describedby={showKickoffError ? 'program-kickoff-error' : undefined}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        {showKickoffError && (
          <p id="program-kickoff-error" className="program-start-error">{kickoffVerdict.detail}.</p>
        )}
        <TextInput
          className={TEXT_INPUT_STACKED}
          placeholder="Program title"
          aria-label="Program title"
          aria-invalid={title !== '' && kickoffOversize}
          aria-describedby={title !== '' && kickoffOversize ? 'program-kickoff-error' : undefined}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <ProjectPicker
          query={query}
          onQuery={setQuery}
          list={list}
          listError={listError}
          empty={matching.length === 0}
        >
            {matching.map((p) => {
              const selected = p.workdir === project?.workdir;
              return (
                <ProjectRowShell
                  key={p.workdir}
                  selected={selected}
                  name={p.name}
                  onPick={() => setProject(p)}
                >
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
                </ProjectRowShell>
              );
            })}
        </ProjectPicker>

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
            // differ from the projected one (a swap moves it, `ccd/ccd:13459`)
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
          ) : runVerdict === 'open-run' || runVerdict === 'unmeasured' ? (
            // The run-board arm: BELOW D-292, ABOVE D-284, and the order is the
            // argument rather than an accident of where it was pasted.
            //
            // Below D-292 because when both are true both sentences are true, and
            // that one names a SESSION the operator can open right now; this one
            // names only a project, because a set of project names is all it was
            // given. The more actionable sentence wins the single slot.
            //
            // Above D-284 because "this project already has a run" holds whether
            // or not anything is placeable, while "nothing is placeable" is fixed
            // by enabling an account — which would then walk the operator into
            // this collision with the refusal never shown.
            //
            // NO CONFIRM BUTTON — the D-292 posture, not a disabled control and
            // not a warning beside a live Start: there is nothing to render here
            // that could open a second run. The five-term `disabled` below is left
            // alone deliberately; a sixth term there would be dead code, since
            // this arm means the button was never rendered.
            //
            // KNOWN NARROWER THAN THE HARM, and the copy is written to that limit
            // (D-1131). `resolveCoordinator(null)` needs exactly one program in
            // `state='active'` BOX-WIDE (`server/src/coord/store.ts`, its
            // "no single active program: ambiguous or absent" guard), so a second
            // program in a DIFFERENT project wedges run-less coordinator mail just
            // as hard and this arm cannot see it; and `POST /api/runs` applies no
            // project predicate at all (`server/src/coord/routes.ts:1077-1085`), so
            // nothing behind this catches what it misses. The sentence claims a
            // consequence of THIS start and never that the fleet is otherwise
            // clean.
            //
            // The `unmeasured` sentence does not say a run exists. It says the
            // board has not answered, which is the only fact held, and it is a
            // WAIT — the cold read resolves it within one round trip and this
            // recomputes on the next render.
            //
            // AND IT NO LONGER RETIRES A STANDING RECOVERY (wave-5 review,
            // MINOR 6, D-1149) — the THIRD reason this arm needed, which the two
            // above could not supply because the thing it displaces lives
            // further DOWN the chain rather than beside it. Wave 4's
            // kickoff-failure recovery renders in the last arm; this one
            // rendering instead of that one took the retry door away from an
            // operator mid-recovery, on a poll tick, because `openRunProjects`
            // is rebuilt every ~2 s. The refusal keeps its slot and its copy —
            // ordering is an argument about which SENTENCE wins the one slot,
            // and never was an argument for withdrawing an ACT the operator
            // still needs — and `recovery` (non-null only while a failure is
            // actually standing, see its own docstring) rides beneath it.
            <>
              <p className="program-start-refuse">
                {runVerdict === 'open-run'
                  ? `${project.name} already has a run open — open it from the run board, or pick `
                    + 'another project. A second program here leaves the project with two coordinators, '
                    + 'and coordinator mail that carries no run id then has more than one active '
                    + 'program to choose from, which the server refuses rather than guesses.'
                  : 'The run board has not answered yet, so this sheet cannot tell whether '
                    + `${project.name} already has a program running. It will know in a moment — or `
                    + 'open the run board and look.'}
              </p>
              {recovery}
            </>
          ) : placement?.kind === 'none' ? (
            <p className="program-start-refuse">
              {placement.source === 'global'
                ? 'Nothing is placeable — every home-able account is disabled.'
                : placement.pool === null
                  ? 'No eligible account can place this project.'
                  : `No eligible account can place this project in pool ${placement.pool}.`}
            </p>
          ) : placement?.kind === 'unmeasurable' ? (
            <p className="program-start-refuse">
              This project's placement cannot be decided because its pool tag could not be measured.
            </p>
          ) : placement?.kind === 'pool-blind' ? (
            <p className="program-start-refuse">
              {placement.pool.state === 'tagged'
                ? `This older placement answer cannot choose an eligible account for pool ${placement.pool.name}.`
                : placement.pool.state === 'malformed'
                  ? "This project's pool tag is malformed, so placement cannot be decided."
                  : "This project's pool tag could not be read, so placement cannot be decided."}
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
              {/* THE SHAPED SLUG, never the raw one (D-2508's own rule, which
                  this preview was the last reader to break): `ledgerPath` is a
                  pure interpolator, so previewing `../other` here would render a
                  path this sheet will never send and the server would refuse —
                  a preview that disagrees with the act it previews. The verdict
                  is the single shape decision already computed above, so the
                  line now shows exactly the path a successful start would use,
                  and falls back to the placeholder while there is no valid slug
                  to show one for. */}
              <p className="program-start-ledger">
                {`Its ledger: ${ledgerPath(slugPreview.ok ? slugPreview.slug : '…')}`}
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
              {/* Program-leverage wave 4's kickoff-failure recovery, which is
                  no longer written out here: it is `recovery` above (D-1149),
                  because the run arm renders it too. Rendered in the same slot
                  it has always occupied — under the ledger note, over the
                  confirm control. */}
              {recovery}
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
              <Button
                variant="quiet"
                className={PROGRAM_GO}
                disabled={
                  !kickoffVerdict.ok || starting
                  || placement?.kind !== 'projected' || existing !== null
                }
                onClick={() => void start()}
              >
                {starting
                  ? 'Starting…'
                  : existing !== null
                    ? 'Started — opening it…'
                    : placement?.kind !== 'projected'
                      ? 'Checking placement…'
                      : `Start ${slug.trim() === '' ? '…' : slug.trim()} on ${accountLabel(roster, placement.wrapper)}`}
              </Button>
            </>
          )
        )}
      </div>
    </Sheet>
  );
}
