// The programme's Goals page (desktop-polish PL5b, D-7713; spec section 3; the prototype's view 2), at `/programmes/<slug>`:
// Goals on one side; on the other, how many things wait on the operator as a link to the one Waiting on you list filtered to
// this programme, or what the programme waits on when nothing does, and its Stored secrets. The title of the programme's box
// opens it, and so does the Goals icon in the chrome of a session in the programme.
//
// IT DRAWS NO LIST OF ITS OWN (PL11, D-7986; spec §2, D29). Until PL11 this card drew the programme's share of the list, a second
// Waiting on you page with its own way into each item; there is one page now, and this one links it (`waitingPath`, the one
// builder), so the navigation, the box's chip and this link all land on it.
//
// A screen of the ladder, ring L4: it reads the fleet store (the list, the fleet's sessions and runs, each only once its frame
// has landed, `useHeard`), asks the server for the programme's Goals, and navigates. It decides nothing: the count is
// `programmeWaitingCount`'s (the chip's own number), what the programme waits on is `programmeWaitsOn`'s, and the Goals panel's
// words are `GoalsPanel`'s.
//
// GOALS COME FROM TWO PLACES AND NEITHER IS "NOT PINNED". The `waiting` frame carries Goals for each programme that has an item
// or a pin, and it is re-sent whenever they change, so its entry for THIS programme is drawn whenever there is one;
// `GET /api/programmes/:slug/goals` is asked once on arrival and answers for a programme the frame does not list. A read that
// fails changes nothing when there is a copy and, when there is none, says so: "no spec is pinned yet" is a fact about the
// programme, never a word for "nothing has been heard".
//
// "NOTHING NEEDS YOU" is said only for what is KNOWN: with no open item the card says what the programme waits on instead
// (spec section 3), and names it only once the runs frame has landed; a programme is never called ended on runs not heard.
//
// STORED SECRETS (the operator's ruling on programme item 9): the Waiting card ends with a "Stored secrets" section, shown only
// when the programme has one, read from `GET /api/programmes/:slug/secrets` on arrival and again whenever one of this
// programme's secret items changes in the frame. Each slot shows its name, when it was saved and the item that asked for it,
// NEVER any part of the value, and a Remove control (`StoredSecretRemove`) that asks for confirmation. A store the box could
// not read says so; it is never drawn as a programme with no secrets.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import {
  WAITS_ON_WORDS, programmeWaitsOn, type GoalsView, type ItemView, type StoredSecret, type StoredSecretsAnswer, type WaitingView,
  type WaitsOn,
} from '../../../shared/ledgers';
import type { StepUpDeps } from '../accounts/useStepUp';
import { fleetHues } from '../fleet/programmeBoxes';
import { programWave, programmeTitle, waveOfWords } from '../fleet/runWords';
import { api } from '../lib/api';
import { WAITING_BADGE_UNIT } from '../fleet/navBadges';
import { inAppClick } from '../fleet/settingsText';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { ROUTES, waitingPath } from '../lib/routes';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { GoalsPanel, SpecLink } from './GoalsPanel';
import { homeProjectOf, specHref } from './ledgerLinks';
import { EMPTY_WORD, NO_FRAME_WORD, ageWords, itemPath, openRunsOf, programmeWaitingCount, type ItemList } from './ledgerWords';
import { STORED_TEXT, StoredSecretRemove, removeStoredSecret, type RemoveSecret } from './ItemView';
import { Back, useHeard, useUnavailable } from './WaitingRoutes';
import { isGoalsFor } from './waitingView';
import './ledgers.css';

/** The fleet's own path, read off the `fleet` row of the route table: this file spells no path of its own. */
const FLEET_PATH: string = ROUTES.find((r) => r.id === 'fleet')?.path ?? '/';

/** What the read of Goals has come to: not answered yet, refused or unreachable, or the programme's view. Three conditions the
 *  screen words differently, so three values and no `null`. */
type GoalsRead = 'reading' | 'failed' | GoalsView;

/** Ask for the programme's Goals once on arrival, and again for a new slug. A view that is not for this programme, or not a
 *  view at all, is a failed read: the answer is drawn only when it is the one asked for. The read is kept beside the slug it
 *  was asked for, so a new slug reads `reading` from its first render, even on a mount not keyed by the slug (carry C, D-7951;
 *  review 1386 F6). */
function useGoalsRead(slug: string): GoalsRead {
  const [read, setRead] = useState<{ slug: string; read: GoalsRead }>({ slug, read: 'reading' });
  useEffect(() => {
    let live = true;
    api.goals(slug).then(
      (answer) => { if (live) setRead({ slug, read: answer.ok === true && isGoalsFor(answer.goals, slug) ? answer.goals : 'failed' }); },
      () => { if (live) setRead({ slug, read: 'failed' }); },
    );
    return () => { live = false; };
  }, [slug]);
  return read.slug === slug ? read.read : 'reading';
}

const NO_RUNS: readonly RunSummary[] = [];
const NO_ITEMS: readonly ItemView[] = [];

/** Reads one programme's stored secrets (`api.storedSecrets`); a test passes its own. */
export type ReadStoredSecrets = (slug: string) => Promise<StoredSecretsAnswer>;
const readStoredSecrets: ReadStoredSecrets = (slug) => api.storedSecrets(slug);
/** What the read of the stored secrets has come to: not answered yet, refused or unreachable, or the slots. Never `[]` for a
 *  read that failed. */
type SecretsRead = 'reading' | 'failed' | readonly StoredSecret[];

/** The programme's stored secrets, read on arrival and whenever `key` moves (a secret item of this programme changed in the
 *  frame), and again after a Remove. An answer for another programme is a failed read. */
function useStoredSecrets(slug: string, key: string, read: ReadStoredSecrets): { secrets: SecretsRead; reread: () => void } {
  const [secrets, setSecrets] = useState<SecretsRead>('reading');
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let live = true;
    read(slug).then(
      (a) => { if (live) setSecrets(a.ok === true && a.program === slug && Array.isArray(a.slots) ? a.slots : 'failed'); },
      () => { if (live) setSecrets('failed'); },
    );
    return () => { live = false; };
  }, [slug, key, bump, read]);
  const reread = useCallback(() => setBump((n) => n + 1), []);
  return { secrets, reread };
}

/** The Waiting card's "Stored secrets" section: nothing while reading or when the programme has none; the sentence when the
 *  read failed; otherwise one row per slot, with its Remove. */
function StoredSecretsSection({ slug, secrets, now, onRemoved, removeSecret, stepUpDeps }: {
  slug: string; secrets: SecretsRead; now: number; onRemoved: () => void; removeSecret: RemoveSecret; stepUpDeps?: StepUpDeps;
}): ReactNode {
  if (secrets === 'reading' || (secrets !== 'failed' && secrets.length === 0)) return null;
  return (
    <section className="pv-secrets" aria-label={STORED_TEXT.heading} data-secrets="stored">
      <h3 className="pv-h">{STORED_TEXT.heading}</h3>
      {secrets === 'failed'
        ? <p className="wl-note" role="alert">{STORED_TEXT.unreadable}</p>
        : (
          <ul className="pv-secret-list">
            {secrets.map((s) => (
              <li key={s.slot} className="pv-secret" data-slot={s.slot}>
                <span className="pv-secret-name">{s.slot}</span>
                <span className="pv-secret-when">{STORED_TEXT.savedAt(s.setAt === null ? null : ageWords(s.setAt, now))}</span>
                <span className="pv-secret-asker">{STORED_TEXT.askedBy(s.item?.title ?? null)}</span>
                <StoredSecretRemove key={`${s.slot}:${s.setAt ?? ''}`} program={slug} slot={s.slot} onRemoved={onRemoved}
                                    removeSecret={removeSecret} {...(stepUpDeps === undefined ? {} : { stepUpDeps })} />
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/** One item's slot state as a key: nothing stored, unreadable, stored with no record, or the time it was saved. Each is its
 *  own key (reviews 1416 F4 and 1418 F2), so a move between any two reloads the Stored secrets list. */
function secretSetKey(set: WaitingView['items'][number]['secretSet']): string {
  if (set === null) return '-';
  if ('unreadable' in set) return 'unreadable';
  return set.at === null ? 'unrecorded' : String(set.at);
}

/** The key that moves when one of this programme's secret items changes in the frame (raised, saved, removed, closed). */
function secretItemsKey(slug: string, view: WaitingView | null): string {
  if (view === null) return '';
  return [...view.items, ...view.cleared]
    .filter((i) => i.program === slug && i.kind === 'secret')
    .map((i) => `${i.id}:${i.state}:${secretSetKey(i.secretSet)}`)
    .sort().join(',');
}

/** The card's one sentence when nothing is waiting on the operator: what the programme waits on, named only once the runs have
 *  been heard, and, for a programme with no open run, said once as a sentence of its own, not as `WAITS_ON_WORDS.ended`'s tail
 *  after "Waiting on:" (that text reads as a fragment and is the words' other readers', `pl5b-ended-card-sentence`). */
function waitsOnSentence(waitsOn: WaitsOn | null): string {
  if (waitsOn === null) return EMPTY_WORD;
  if (waitsOn === 'ended') return `${EMPTY_WORD} The programme has no open run.`;
  return `${EMPTY_WORD} Waiting on: ${WAITS_ON_WORDS[waitsOn]}`;
}

/** The cards' left column: Goals, or the word for why there are none to show. */
function GoalsCard({ read, held, homeProject, heldItems, list }: {
  read: GoalsRead; held: GoalsView | null; homeProject: string | null; heldItems: ReadonlySet<number>; list: ItemList;
}): ReactNode {
  // The frame's copy for THIS programme wins whenever the frame has one: the frame is re-sent on every spec pin, change and merge.
  // The fetch answers only for a programme the frame does not list (a programme with a pin and nothing else waiting is in it; one
  // with neither is not), and a read that has not answered or failed says so. The fallback is the one fetch, asked on arrival,
  // so it can be as old as the mount: a programme the frame stops listing, or never lists, shows that copy until the view is
  // opened again.
  const goals = held ?? (read !== 'reading' && read !== 'failed' ? read : null);
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
  return <GoalsPanel goals={goals} homeProject={homeProject} itemHref={(id) => (heldItems.has(id) ? itemPath(id, list) : null)} />;
}

/** The right column: how many things wait on the operator, as a link to the one list filtered to this programme, or what the
 *  programme waits on when nothing does; then its Stored secrets. */
function WaitingCard({ slug, view, sessions, runs, unavailable, stored }: {
  slug: string; view: WaitingView | null; sessions: readonly FleetSession[] | null; runs: readonly RunSummary[] | null;
  unavailable: string | null; stored: ReactNode;
}): ReactNode {
  if (view === null || sessions === null) {
    return (
      <section className="pv-card" aria-label="Waiting on you">
        <h2 className="pv-h">Waiting on you</h2>
        {unavailable !== null
          ? <p className="wl-note" role="alert">{unavailable}</p>
          : <p className="wl-note" role="status">{NO_FRAME_WORD}</p>}
        {stored}
      </section>
    );
  }
  // The chip's own number (`programmeWaitingCount`): the programme's open items plus its sessions' questions.
  const waiting = programmeWaitingCount(view, sessions, runs, slug) ?? 0;
  // What the programme waits on, over ALL its runs: `programmeWaitsOn` leaves the finished ones out itself.
  const waitsOn = runs === null ? null : programmeWaitsOn(runs.filter((r) => r.program === slug));
  const href = waitingPath(slug);
  return (
    <section className="pv-card" aria-label="Waiting on you">
      <h2 className="pv-h">Waiting on you</h2>
      {waiting === 0
        ? <p className="pv-none">{waitsOnSentence(waitsOn)}</p>
        : (
          // A link that stands alone is a control: `buttonVariants` on an anchor (`GHOST_ANCHOR`), never a bare TextLink.
          <a className={cn(GHOST_ANCHOR, 'pv-waiting')} href={href} onClick={inAppClick(href)}>{`${waiting} ${WAITING_BADGE_UNIT}`}</a>
        )}
      {stored}
    </section>
  );
}

/** `/programmes/<slug>`. Keyed by the slug where it is mounted, so one programme's Goals never show under another's name.
 *  `secrets` replaces the stored-secrets read, the Remove call and the step-up's injectables (a test's). */
export function ProgrammeScreen({ slug, store = useFleetStore, secrets }: {
  slug: string; store?: FleetStore;
  secrets?: { read?: ReadStoredSecrets; remove?: RemoveSecret; stepUpDeps?: StepUpDeps };
}): ReactNode {
  const view = store((s) => s.waiting);
  const { sessions, runs } = useHeard(store);
  const unavailable = useUnavailable(store, view !== null);
  const read = useGoalsRead(slug);
  const heard = runs ?? NO_RUNS;
  const open = openRunsOf(slug, heard);
  const wave = open.length === 0 ? null : programWave(open);
  // The frame's entry, on the fetched answer's terms (`isGoalsFor`): an entry the panel cannot read is no copy.
  const entry = view?.goals.find((g) => g.program === slug);
  const held = isGoalsFor(entry, slug) ? entry : null;
  const heldItems = new Set<number>([...(view?.items ?? NO_ITEMS), ...(view?.cleared ?? NO_ITEMS)].map((i) => i.id));
  const hue = fleetHues(heard).get(slug) ?? 'none';
  // The list an item opened from Goals names: the one list, filtered to this programme, so its steps stay in this programme, and
  // its way back and its Dismiss return here, to this Goals page (plan PL9; PL11, D-7986; review 1537 F2, keeping review 1402's F3).
  const list: ItemList = { at: 'waiting', programme: slug, back: 'goals' };
  const stored = useStoredSecrets(slug, secretItemsKey(slug, view), secrets?.read ?? readStoredSecrets);
  const now = Date.now();
  const home = homeProjectOf(slug, heard);
  // The head's Spec link reads the pin the Goals card draws: the frame's copy, else the fetched one (PL10, D-7952; D26).
  const pinned = held ?? (read !== 'reading' && read !== 'failed' ? read : null);
  const title = programmeTitle(slug, heard);
  return (
    <div className="wl pv" data-program={slug} data-hue={hue}>
      <header className="pv-head" data-hue={hue}>
        <Back to={FLEET_PATH} label="Back to Fleet" />
        <span className="pv-kicker">Programme</span>
        <h1 className="pv-title">{title}</h1>
        {wave !== null && <span className="pv-sub">{waveOfWords(wave)}</span>}
        <SpecLink href={specHref(pinned?.specPath ?? null, home)} programme={title} className="pv-spec" />
      </header>
      <div className="pv-two">
        <div className="pv-card">
          <GoalsCard read={read} held={held} homeProject={home} heldItems={heldItems} list={list} />
        </div>
        <WaitingCard slug={slug} view={view} sessions={sessions} runs={runs} unavailable={unavailable}
                     stored={<StoredSecretsSection slug={slug} secrets={stored.secrets} now={now} onRemoved={stored.reread}
                                                   removeSecret={secrets?.remove ?? removeStoredSecret}
                                                   {...(secrets?.stepUpDeps === undefined ? {} : { stepUpDeps: secrets.stepUpDeps })} />} />
      </div>
    </div>
  );
}
