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
//     snapshot and matches it on the two fields the server actually reports
//     (`FleetSession.wrapper`/`.project`), never on a recomputed id.
//   * `cmd_start` is IDEMPOTENT (`ccd/ccd:7192-7202`): a second `start` for
//     an already-running `${wrapper}-${project}` is a no-op that attaches to
//     the session already there. A blind kickoff would inject a coordinator
//     brief into a session that may be mid-task, so this sheet checks for
//     that collision BEFORE the tap — same posture as the projection naming
//     the account before the tap rather than guessing — and refuses with no
//     confirm button at all when it finds one.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { accountLabel } from '../lib/accounts';
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
export const kickoff = (slug: string, title: string): string =>
  `You are the coordinator for program \`${slug}\` (${title}).\n` +
  `Its ledger is \`docs/superpowers/programs/${slug}.md\`.\n` +
  `Run the ccrc-coordinator skill and open the run for wave 1.`;

const ledgerPath = (slug: string): string => `docs/superpowers/programs/${slug}.md`;

/** D-B4-18: how long the sheet waits for the freshly created session to
 *  appear in a `/ws/fleet` snapshot before giving up. Tied to the fleet
 *  watcher's own 2 s tick (`server/src/watch.ts`'s `intervalMs`) plus a
 *  generous margin — the same reasoning `coordWords.ts`'s `COORD_CONFIRM_MS`
 *  states for the pause toggle's own bounded wait, sized up because this one
 *  waits on a cold process spawn (tmux + a wrapper CLI cold start), not a
 *  marker-file flip: room for a slow box and more than one missed tick, not
 *  a timeout chasing the happy path. */
export const START_PROGRAM_WAIT_MS = 20_000;

/** D-B4-18/19: the id `_id()` (`ccd/ccd:185`) would compute is never
 *  recomputed here — this matches on the two fields the server already
 *  reports for every session (`FleetSession.wrapper`/`.project`), the same
 *  pair `_id()` hashes together, not a re-derivation of the hash itself. */
function existingSessionFor(
  sessions: readonly FleetSession[],
  wrapper: string,
  project: string,
): FleetSession | null {
  return sessions.find((s) => s.wrapper === wrapper && s.project === project) ?? null;
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
  const projected = useProjectedHome();

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
    setSlug('');
    setTitle('');
    setProject(null);
    setQuery('');
    setStarting(false);
    setTimedOut(false);
    setError(null);
  }, [open]);

  useEffect(() => () => clearTimer(), []);

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
    const found = existingSessionFor(fleet.getState().sessions, w.wrapper, w.project);
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
  const existing =
    project !== null && projected != null
      ? existingSessionFor(sessions, projected.wrapper, project.name)
      : null;

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
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Only this attempt's own timeout fires into it — a later attempt (or
      // one already resolved) owns `waitRef` now.
      if (waitRef.current?.mine === mine) {
        waitRef.current = null;
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
          existing !== null ? (
            // D-B4-19: refuses BEFORE the tap — no confirm button rendered
            // at all, not merely a disabled one, so there is no control here
            // that could hijack the running session.
            <p className="program-start-existing">
              {`${existing.id} is already running in ${project.name} — open it, or pick another project. `
                + 'Starting here would send the kickoff into a session that may be mid-task.'}
            </p>
          ) : projected === null ? (
            // D-B4-11: the server's own "nothing is placeable" — refuse with
            // copy rather than guessing a wrapper.
            <p className="program-start-refuse">
              Nothing is placeable — every home-able account is disabled.
            </p>
          ) : (
            <>
              {coord?.pause === 'set' && (
                <p className="program-start-warn">
                  The fleet is paused — the coordinator will be refused at its first dispatch until it is resumed.
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
