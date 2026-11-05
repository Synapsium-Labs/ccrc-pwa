// The combined "Waiting on you" list (desktop-polish PL5a, D-7712; spec §2; the prototype's view 1), the ONE Waiting on you
// page since PL11 (D-7986, D29): a programme's chip and Goals page open it filtered to that programme. Pure over what the shell
// holds: the waiting view (`null` until the first frame or read), the fleet's sessions (their questions join the list from
// the `attention` bucket, so nothing new is stored for them) and runs, and the page clock. It routes nowhere itself: the
// shell passes what opening an item or a session does, so this file imports no route (ring L4, no decisions: every
// grouping, count and label is `ledgerWords.ts`'s).
import type { ReactNode } from 'react';
import { BareRow } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import { WAITS_ON_WORDS, type ItemView, type WaitingView } from '../../../shared/ledgers';
import { fleetHues } from '../fleet/programmeBoxes';
import { programmeTitle, programWave, waveOfWords } from '../fleet/runWords';
import {
  CLEARED_HEADING, EMPTY_WORD, KIND_WORD, NO_FRAME_WORD, NO_PROGRAMME_WORD, QUESTION_PILL_WORD, QUESTION_WORD,
  COMBINED_LIST, NO_PROGRAMME_FILTER, ageWords, cameBack, cameBackNote, groupByProgramme, itemPills, listGroups, openRunsOf,
  programmeIsLive, questionRows, resolveList, summaryCounts, summaryWords, type ItemList, type Pill, type ProgrammeGroup, type QuestionRow, type Row,
} from './ledgerWords';
import { SpecLink } from './GoalsPanel';
import { programmeSpecHref } from './ledgerLinks';
import './ledgers.css';

export interface WaitingScreenProps {
  /** `null` until the first `waiting` frame or `GET /api/waiting` answer: "not heard yet" is not "nothing waits". */
  readonly view: WaitingView | null;
  /** The fleet's sessions, or `null` before the first fleet frame: the offline snapshot's rows are not a fact, and a list
   *  without its sessions' questions is not "nothing needs you", so the screen says it is waiting (review 1359 F3). */
  readonly sessions: readonly FleetSession[] | null;
  /** The runs, or `null` before the runs frame: a programme is not called ended on runs this page has not heard. */
  readonly runs: readonly RunSummary[] | null;
  /** Why no list will come (this box has no coordination database), in words; shown in place of the waiting line. */
  readonly unavailable?: string | null;
  /** The page clock, epoch ms: every age is read against it, so the screen reads no clock of its own. */
  readonly now: number;
  /** The side rail's filter as the URL names it (plan PL9): a programme's slug, `NO_PROGRAMME_FILTER` for the sessions in no
   *  programme, absent or `null` for every programme. It is the filter, not its first value: the screen keeps no copy, so a door
   *  tap, a reload and Back all draw what the URL says (fix round 1, F5). */
  readonly programme?: string | null;
  /** Told the operator's pick in the side rail, in the same words (`null` for every programme), so the route writes it into the
   *  URL, which hands it back as `programme`. Absent, the rail draws the filter it is given and a pick changes nothing. */
  readonly onFilter?: (programme: string | null) => void;
  /** Opens an item, naming the list it is opened from (plan PL9): the item's previous and next follow that list. */
  readonly onOpenItem: (id: number, list: ItemList) => void;
  readonly onOpenSession: (id: string) => void;
}

/** The rail's key for the group of sessions that are in no programme (a programme slug can never be this). */
const NO_RUNS: readonly RunSummary[] = [];
const NO_PROGRAMME_KEY = ' none';
const keyOf = (program: string | null): string => program ?? NO_PROGRAMME_KEY;

/** The right-hand end of a row: its pills and when, ONE block for an item and for a session's question. */
function RowMeta({ pills, when }: { pills: readonly Pill[]; when: string }): ReactNode {
  return (
    <span className="wl-meta">
      {pills.map((p) => <span key={p.tone} className="wl-pill" data-tone={p.tone}>{p.word}</span>)}
      <span>{when}</span>
    </span>
  );
}

function ItemRow({ item, now, onOpen, current }: { item: ItemView; now: number; onOpen: (id: number) => void; current: boolean }): ReactNode {
  const note = cameBackNote(item);
  const back = cameBack(item);
  const meta = item.state === 'checking' && item.tickedAt !== null ? `ticked ${ageWords(item.tickedAt, now)}` : `raised ${ageWords(item.raisedAt, now)}`;
  return (
    <li>
      <BareRow className="wl-item" data-item={item.id} data-state={item.state} data-needed={item.neededBy}
               {...(current ? { 'aria-current': 'page' as const } : {})} onClick={() => onOpen(item.id)}>
        <span className="wl-kind">{KIND_WORD[item.kind]}</span>
        <span className="wl-main">
          <span className="wl-what">{item.title}</span>
          <span className="wl-why">{item.why}</span>
          {back && note !== null && <span className="wl-bounce">{`The coordinator sent it back: ${note}`}</span>}
        </span>
        <RowMeta pills={itemPills(item)} when={meta} />
      </BareRow>
    </li>
  );
}

function QuestionButton({ q, now, onOpen }: { q: QuestionRow; now: number; onOpen: (id: string) => void }): ReactNode {
  return (
    <li>
      <BareRow className="wl-item wl-question" data-session={q.sessionId} data-state="question" data-needed="soon"
               onClick={() => onOpen(q.sessionId)}>
        <span className="wl-kind">{QUESTION_WORD}</span>
        <span className="wl-main">
          <span className="wl-what">{q.title}</span>
          <span className="wl-why">A session is waiting for your answer. Open it to answer.</span>
        </span>
        <RowMeta pills={[{ tone: 'ask', word: QUESTION_PILL_WORD }]} when={q.at > 0 ? ageWords(q.at, now) : ''} />
      </BareRow>
    </li>
  );
}

/** One programme's rows: its items and its sessions' questions, as the list and the programme view both draw them, and as
 *  the list beside an open item draws them, with that item marked current (plan PL9). */
export function ItemRows({ rows, now, onOpenItem, onOpenSession, currentId = null }: {
  rows: readonly Row[]; now: number; onOpenItem: (id: number) => void; onOpenSession: (id: string) => void; currentId?: number | null;
}): ReactNode {
  return (
    <ul className="wl-items">
      {rows.map((row) => row.kind === 'item'
        ? <ItemRow key={`i${row.item.id}`} item={row.item} now={now} onOpen={onOpenItem} current={row.item.id === currentId} />
        : <QuestionButton key={`q${row.question.sessionId}`} q={row.question} now={now} onOpen={onOpenSession} />)}
    </ul>
  );
}

/** One programme's block of a list: its heading in its hue, and its rows. The combined list draws one per group, and so does
 *  the list beside an open item (plan PL9), which passes the open item as `currentId`. `specHref` is the programme's pinned spec
 *  in the Docs reader (`programmeSpecHref`, PL10, D-7952): the combined list passes it, and null or absent draws no Spec link. */
export function ListGroup({ group, runs, hue, now, onOpenItem, onOpenSession, currentId = null, specHref = null }: {
  group: ProgrammeGroup; runs: readonly RunSummary[] | null; hue: string | null; now: number;
  onOpenItem: (id: number) => void; onOpenSession: (id: string) => void; currentId?: number | null; specHref?: string | null;
}): ReactNode {
  const heard = runs ?? NO_RUNS;
  const title = group.program === null ? NO_PROGRAMME_WORD : programmeTitle(group.program, heard);
  const open = group.program === null ? [] : openRunsOf(group.program, heard);
  const wave = open.length === 0 ? null : programWave(open);
  // A programme with no open run is shown as ended (spec §3.4); not on runs that have not been heard.
  const ended = group.program !== null && !programmeIsLive(group.program, runs);
  return (
    <section className="wl-group" data-program={group.program ?? ''} data-hue={hue ?? 'none'} aria-label={title}>
      <div className="wl-ghead">
        <span className="wl-swatch" aria-hidden="true" />
        <h2 className="wl-gtitle">{title}</h2>
        {wave !== null && <span className="wl-gwave">{waveOfWords(wave)}</span>}
        {ended && <span className="wl-gwave" data-ended="true">{WAITS_ON_WORDS.ended}</span>}
        <SpecLink href={specHref} programme={title} className="wl-gspec" />
      </div>
      <ItemRows rows={group.rows} now={now} onOpenItem={onOpenItem} onOpenSession={onOpenSession} currentId={currentId} />
    </section>
  );
}

/** "Recently cleared": what the coordinator confirmed in the last seven days, each struck through with when. `where` names the
 *  programme beside a row where the list holds several; a single programme's view leaves it out. Nothing is drawn for none. */
export function ClearedTrail({ items, where, now }: {
  items: readonly ItemView[]; where?: (item: ItemView) => string; now: number;
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <section className="wl-cleared" aria-label={CLEARED_HEADING}>
      <h3 className="wl-cleared-title">{CLEARED_HEADING}</h3>
      <ul>
        {items.map((c) => {
          const tail = [where?.(c), c.closedAt === null ? undefined : `confirmed ${ageWords(c.closedAt, now)}`].filter((t) => t !== undefined);
          return (
            <li key={c.id} className="wl-cleared-row">
              <span aria-hidden="true">✓ </span><s>{c.title}</s>
              {tail.length === 0 ? '' : ` · ${tail.join(' · ')}`}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WaitingScreen(props: WaitingScreenProps): ReactNode {
  const { view, sessions, runs, now } = props;
  const pick = (programme: string | null): void => props.onFilter?.(programme);
  if (view === null || sessions === null) {
    return (
      <div className="wl">
        <header className="wl-head"><h1 className="wl-title">Waiting on you</h1></header>
        {typeof props.unavailable === 'string'
          ? <p className="wl-note" role="alert">{props.unavailable}</p>
          : <p className="wl-note" role="status">{NO_FRAME_WORD}</p>}
      </div>
    );
  }
  const heardRuns = runs ?? NO_RUNS;
  const questions = questionRows(sessions, heardRuns);
  const groups = groupByProgramme(view.items, questions);
  const hues = fleetHues(heardRuns);
  const filter = props.programme ?? null;
  // The sessions in no programme: the one filter no item list names (it holds questions only). Stale when no such group is drawn.
  const noProgramme = filter === NO_PROGRAMME_FILTER && groups.some((g) => g.program === null);
  // The list an item opens from: the filter's programme, settled by the one stale-list rule (`resolveList`), or the combined list.
  const list: ItemList = filter === null || filter === NO_PROGRAMME_FILTER ? COMBINED_LIST : resolveList({ at: 'waiting', programme: filter }, groups);
  const filtered = noProgramme || list.programme !== null;
  // What is drawn is that list's groups (`listGroups`, the one reader the item's steps use too).
  const shown = noProgramme ? groups.filter((g) => g.program === null) : listGroups(list, groups);
  const pressed = (program: string | null): boolean => (program === null ? noProgramme : list.programme === program);
  const words = summaryWords(summaryCounts(view.items, questions));
  const empty = groups.length === 0;
  return (
    <div className="wl">
      <header className="wl-head"><h1 className="wl-title">Waiting on you</h1></header>
      {empty
        ? <p className="wl-note">{EMPTY_WORD}</p>
        : (
          <>
            {words.length > 0 && (
              <ul className="wl-summary" aria-label="Summary">
                {words.map((w) => <li key={w.tone} className="wl-pill" data-tone={w.tone}>{w.text}</li>)}
              </ul>
            )}
            <div className="wl-grid">
              <nav className="wl-rail" aria-label="Programmes">
                <BareRow className="wl-rail-btn" aria-pressed={!filtered} onClick={() => pick(null)}>
                  <span className="wl-rail-name">All programmes</span>
                  <span className="wl-rail-n">{groups.reduce((n, g) => n + g.waiting, 0)}</span>
                </BareRow>
                {groups.map((g) => (
                  <BareRow key={keyOf(g.program)} className="wl-rail-btn" aria-pressed={pressed(g.program)}
                           data-hue={g.program === null ? 'none' : hues.get(g.program) ?? 'none'} onClick={() => pick(g.program ?? NO_PROGRAMME_FILTER)}>
                    <span className="wl-swatch" aria-hidden="true" />
                    <span className="wl-rail-name">{g.program === null ? NO_PROGRAMME_WORD : programmeTitle(g.program, heardRuns)}</span>
                    <span className="wl-rail-n">{g.waiting}</span>
                  </BareRow>
                ))}
              </nav>
              <div className="wl-groups">
                {shown.map((g) => (
                  <ListGroup key={keyOf(g.program)} group={g} runs={runs} now={now}
                             onOpenItem={(id) => props.onOpenItem(id, list)} onOpenSession={props.onOpenSession}
                             hue={g.program === null ? null : hues.get(g.program) ?? null}
                             specHref={g.program === null ? null : programmeSpecHref(g.program, view.goals, heardRuns)} />
                ))}
              </div>
            </div>
          </>
        )}
      {/* The trail follows the filter (PL11, D-7986): the programme's page lost its own trail, so the list filtered to one
          programme holds that programme's, without naming it on every row, and the sessions in no programme have none. */}
      {list.programme !== null
        ? <ClearedTrail items={view.cleared.filter((c) => c.program === list.programme)} now={now} />
        : <ClearedTrail items={noProgramme ? [] : view.cleared} now={now} where={(c) => programmeTitle(c.program, heardRuns)} />}
    </div>
  );
}
