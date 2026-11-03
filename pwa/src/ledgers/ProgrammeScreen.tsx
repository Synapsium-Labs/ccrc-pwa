// The programme view (desktop-polish PL5b, D-7713; spec section 3; the prototype's view 2): Goals on one side, this
// programme's share of the Waiting on you list on the other. The chip on the programme's box opens it (`/programmes/<slug>`).
//
// A screen of the ladder, ring L4: it reads the fleet store (the list, the fleet's sessions and runs, each only once its frame
// has landed, `useHeard`), asks the server for the programme's Goals, and navigates. It decides nothing: the rows, their order
// and the count are `ledgerWords.ts`'s (`groupByProgramme`, the one grouping the combined list uses too), what the programme
// waits on is `programmeWaitsOn`'s, and the two panels' own words are the combined list's (`ItemRow`, `QuestionButton`) and
// `GoalsPanel`'s.
//
// GOALS COME FROM TWO PLACES AND NEITHER IS "NOT PINNED". The `waiting` frame carries every programme's Goals, so the copy the
// list holds is drawn at once; `GET /api/programmes/:slug/goals` is asked once on arrival and its answer replaces that copy. A
// read that fails changes nothing when there is a copy and, when there is none, says so: "no spec is pinned yet" is a fact
// about the programme, never a word for "nothing has been heard".
//
// "NOTHING NEEDS YOU" is said only for what is KNOWN: with no open item the card says what the programme waits on instead
// (spec section 3), and names it only once the runs frame has landed; a programme is never called ended on runs not heard.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BackButton } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import {
  WAITS_ON_WORDS, programmeWaitsOn, type GoalsView, type ItemView, type WaitingView,
} from '../../../shared/ledgers';
import { fleetHues } from '../fleet/programmeBoxes';
import { programWave, programmeTitle, runHomeProject } from '../fleet/runWords';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { ROUTES, sessionPath } from '../lib/routes';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { GoalsPanel } from './GoalsPanel';
import {
  CLEARED_HEADING, EMPTY_WORD, NO_FRAME_WORD, ageWords, groupByProgramme, openRunsOf, programmeIsLive, questionRows,
} from './ledgerWords';
import { itemPath, useHeard, useUnavailable } from './WaitingRoutes';
import { ItemRow, QuestionButton } from './WaitingScreen';
import './ledgers.css';

/** The fleet's own path, read off the `fleet` row of the route table: this file spells no path of its own. */
const FLEET_PATH: string = ROUTES.find((r) => r.id === 'fleet')?.path ?? '/';

/** What the read of Goals has come to: not answered yet, refused or unreachable, or the programme's view. Three conditions the
 *  screen words differently, so three values and no `null`. */
type GoalsRead = 'reading' | 'failed' | GoalsView;

/** Ask for the programme's Goals once on arrival (the screen is keyed by the slug, so a new slug is a new read). A view that is
 *  not for this programme, or not a view at all, is a failed read: the answer is drawn only when it is the one asked for. */
function useGoalsRead(slug: string): GoalsRead {
  const [read, setRead] = useState<GoalsRead>('reading');
  useEffect(() => {
    let live = true;
    api.goals(slug).then(
      (answer) => { if (live) setRead(answer.ok === true && isGoalsFor(answer.goals, slug) ? answer.goals : 'failed'); },
      () => { if (live) setRead('failed'); },
    );
    return () => { live = false; };
  }, [slug]);
  return read;
}

/** The envelope of a Goals view, and that it is this programme's: what the panel reads (`modifications.map`) must be an array. */
function isGoalsFor(v: unknown, slug: string): v is GoalsView {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Partial<GoalsView>;
  return g.program === slug && Array.isArray(g.modifications);
}

/** The newest run of the programme that names a home project: the repository whose Docs hold its spec. `null` when none does. */
function homeProjectOf(slug: string, runs: readonly RunSummary[]): string | null {
  const mine = runs.filter((r) => r.program === slug).sort((a, b) => b.id - a.id);
  for (const r of mine) { const home = runHomeProject(r); if (home !== null) return home; }
  return null;
}

const NO_RUNS: readonly RunSummary[] = [];
const NO_ITEMS: readonly ItemView[] = [];

/** The cards' left column: Goals, or the word for why there are none to show. */
function GoalsCard({ read, held, homeProject, heldItems }: {
  read: GoalsRead; held: GoalsView | null; homeProject: string | null; heldItems: ReadonlySet<number>;
}): ReactNode {
  const goals = read !== 'reading' && read !== 'failed' ? read : held;
  if (goals === null) {
    return (
      <section className="pg-goals" aria-label="Goals">
        <h2 className="pg-goals-title">Goals</h2>
        {read === 'failed'
          ? <p className="pg-goals-none" role="alert">Goals could not be read.</p>
          : <p className="pg-goals-none">Reading Goals…</p>}
      </section>
    );
  }
  return <GoalsPanel goals={goals} homeProject={homeProject} itemHref={(id) => (heldItems.has(id) ? itemPath(id) : null)} />;
}

/** The right column: this programme's open items and its sessions' questions, or what the programme waits on instead. */
function WaitingCard({ slug, view, sessions, runs, unavailable, now }: {
  slug: string; view: WaitingView | null; sessions: readonly FleetSession[] | null; runs: readonly RunSummary[] | null;
  unavailable: string | null; now: number;
}): ReactNode {
  if (view === null || sessions === null) {
    return (
      <section className="pv-card" aria-label="Waiting on you">
        <h2 className="pv-h">Waiting on you</h2>
        {unavailable !== null
          ? <p className="wl-note" role="alert">{unavailable}</p>
          : <p className="wl-note" role="status">{NO_FRAME_WORD}</p>}
      </section>
    );
  }
  const heard = runs ?? NO_RUNS;
  const group = groupByProgramme(view.items, questionRows(sessions, heard)).find((g) => g.program === slug) ?? null;
  const waiting = group?.waiting ?? 0;
  const cleared = view.cleared.filter((c) => c.program === slug);
  // What the programme waits on, over ALL its runs: `programmeWaitsOn` leaves the finished ones out itself.
  const waitsOn = runs === null ? null : WAITS_ON_WORDS[programmeWaitsOn(runs.filter((r) => r.program === slug))];
  return (
    <section className="pv-card" aria-label="Waiting on you">
      <h2 className="pv-h">{`Waiting on you · ${waiting}`}</h2>
      {waiting === 0 && (
        <p className="pv-none">{waitsOn === null ? EMPTY_WORD : `${EMPTY_WORD} Waiting on: ${waitsOn}`}</p>
      )}
      {group !== null && group.rows.length > 0 && (
        <ul className="wl-items">
          {group.rows.map((row) => row.kind === 'item'
            ? <ItemRow key={`i${row.item.id}`} item={row.item} now={now} onOpen={(id) => navigate(itemPath(id))} />
            : <QuestionButton key={`q${row.question.sessionId}`} q={row.question} now={now} onOpen={(id) => navigate(sessionPath(id))} />)}
        </ul>
      )}
      {cleared.length > 0 && (
        <section className="wl-cleared" aria-label={CLEARED_HEADING}>
          <h3 className="wl-cleared-title">{CLEARED_HEADING}</h3>
          <ul>
            {cleared.map((c) => (
              <li key={c.id} className="wl-cleared-row">
                <span aria-hidden="true">✓ </span><s>{c.title}</s>
                {c.closedAt === null ? '' : ` · confirmed ${ageWords(c.closedAt, now)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

/** `/programmes/<slug>`. Keyed by the slug where it is mounted, so one programme's Goals never show under another's name. */
export function ProgrammeScreen({ slug, store = useFleetStore }: { slug: string; store?: FleetStore }): ReactNode {
  const view = store((s) => s.waiting);
  const { sessions, runs } = useHeard(store);
  const unavailable = useUnavailable(store, view !== null);
  const read = useGoalsRead(slug);
  const heard = runs ?? NO_RUNS;
  const open = openRunsOf(slug, heard);
  const wave = open.length === 0 ? null : programWave(open);
  const ended = runs !== null && !programmeIsLive(slug, runs);
  const held = view?.goals.find((g) => g.program === slug) ?? null;
  const heldItems = new Set<number>([...(view?.items ?? NO_ITEMS), ...(view?.cleared ?? NO_ITEMS)].map((i) => i.id));
  const hue = fleetHues(heard).get(slug) ?? 'none';
  return (
    <div className="wl pv" data-program={slug} data-hue={hue}>
      <header className="pv-head" data-hue={hue}>
        <BackButton className="wl-back" aria-label="Back to Fleet" onClick={() => navigate(FLEET_PATH)}>‹</BackButton>
        <span className="pv-kicker">Programme</span>
        <h1 className="pv-title">{programmeTitle(slug, heard)}</h1>
        {wave !== null && <span className="pv-sub">{wave.waveOf === null ? `wave ${wave.wave}` : `wave ${wave.wave} of ${wave.waveOf}`}</span>}
        {ended && <span className="pv-sub" data-ended="true">{WAITS_ON_WORDS.ended}</span>}
      </header>
      <div className="pv-two">
        <div className="pv-card">
          <GoalsCard read={read} held={held} homeProject={homeProjectOf(slug, heard)} heldItems={heldItems} />
        </div>
        <WaitingCard slug={slug} view={view} sessions={sessions} runs={runs} unavailable={unavailable} now={Date.now()} />
      </div>
    </div>
  );
}
