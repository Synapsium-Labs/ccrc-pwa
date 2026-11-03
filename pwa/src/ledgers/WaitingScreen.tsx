// The combined "Waiting on you" list (desktop-polish PL5a, D-7712; spec §2; the prototype's view 1). Pure over what the shell
// holds: the waiting view (`null` until the first frame or read), the fleet's sessions (their questions join the list from
// the `attention` bucket, so nothing new is stored for them) and runs, and the page clock. It routes nowhere itself: the
// shell passes what opening an item or a session does, so this file imports no route (ring L4, no decisions: every
// grouping, count and label is `ledgerWords.ts`'s).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { BareRow } from '@ccrc/ui';
import type { FleetSession, RunSummary } from '../../../shared/api';
import { WAITS_ON_WORDS, type ItemView, type WaitingView } from '../../../shared/ledgers';
import { fleetHues } from '../fleet/programmeBoxes';
import { programmeTitle, programWave } from '../fleet/runWords';
import {
  CLEARED_HEADING, EMPTY_WORD, KIND_WORD, NO_FRAME_WORD, NO_PROGRAMME_WORD, QUESTION_PILL_WORD, QUESTION_WORD,
  ageWords, cameBack, cameBackNote, groupByProgramme, itemPills, openRunsOf, programmeIsLive, questionRows, summaryCounts, summaryWords,
  type Pill, type ProgrammeGroup, type QuestionRow, type Row,
} from './ledgerWords';
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
  readonly onOpenItem: (id: number) => void;
  readonly onOpenSession: (id: string) => void;
}

/** The rail's key for the group of sessions that are in no programme (a programme slug can never be this). */
const NO_RUNS: readonly RunSummary[] = [];
const NO_PROGRAMME_KEY = ' none';
const ALL_KEY = ' all';
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

function ItemRow({ item, now, onOpen }: { item: ItemView; now: number; onOpen: (id: number) => void }): ReactNode {
  const note = cameBackNote(item);
  const back = cameBack(item);
  const meta = item.state === 'checking' && item.tickedAt !== null ? `ticked ${ageWords(item.tickedAt, now)}` : `raised ${ageWords(item.raisedAt, now)}`;
  return (
    <li>
      <BareRow className="wl-item" data-item={item.id} data-state={item.state} data-needed={item.neededBy}
               onClick={() => onOpen(item.id)}>
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

/** One programme's rows: its items and its sessions' questions, as the list and the programme view both draw them. */
export function ItemRows({ rows, now, onOpenItem, onOpenSession }: {
  rows: readonly Row[]; now: number; onOpenItem: (id: number) => void; onOpenSession: (id: string) => void;
}): ReactNode {
  return (
    <ul className="wl-items">
      {rows.map((row) => row.kind === 'item'
        ? <ItemRow key={`i${row.item.id}`} item={row.item} now={now} onOpen={onOpenItem} />
        : <QuestionButton key={`q${row.question.sessionId}`} q={row.question} now={now} onOpen={onOpenSession} />)}
    </ul>
  );
}

function Group({ group, runs, hue, now, props }: {
  group: ProgrammeGroup; runs: readonly RunSummary[] | null; hue: string | null; now: number; props: WaitingScreenProps;
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
        {wave !== null && <span className="wl-gwave">{wave.waveOf === null ? `wave ${wave.wave}` : `wave ${wave.wave} of ${wave.waveOf}`}</span>}
        {ended && <span className="wl-gwave" data-ended="true">{WAITS_ON_WORDS.ended}</span>}
      </div>
      <ItemRows rows={group.rows} now={now} onOpenItem={props.onOpenItem} onOpenSession={props.onOpenSession} />
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
  const [filter, setFilter] = useState<string>(ALL_KEY);
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
  const filtered = filter !== ALL_KEY && groups.some((g) => keyOf(g.program) === filter);
  const shown = filtered ? groups.filter((g) => keyOf(g.program) === filter) : groups;
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
                <BareRow className="wl-rail-btn" aria-pressed={!filtered} onClick={() => setFilter(ALL_KEY)}>
                  <span className="wl-rail-name">All programmes</span>
                  <span className="wl-rail-n">{groups.reduce((n, g) => n + g.waiting, 0)}</span>
                </BareRow>
                {groups.map((g) => (
                  <BareRow key={keyOf(g.program)} className="wl-rail-btn" aria-pressed={filtered && keyOf(g.program) === filter}
                           data-hue={g.program === null ? 'none' : hues.get(g.program) ?? 'none'} onClick={() => setFilter(keyOf(g.program))}>
                    <span className="wl-swatch" aria-hidden="true" />
                    <span className="wl-rail-name">{g.program === null ? NO_PROGRAMME_WORD : programmeTitle(g.program, heardRuns)}</span>
                    <span className="wl-rail-n">{g.waiting}</span>
                  </BareRow>
                ))}
              </nav>
              <div className="wl-groups">
                {shown.map((g) => (
                  <Group key={keyOf(g.program)} group={g} runs={runs} now={now} props={props}
                         hue={g.program === null ? null : hues.get(g.program) ?? null} />
                ))}
              </div>
            </div>
          </>
        )}
      <ClearedTrail items={view.cleared} now={now} where={(c) => programmeTitle(c.program, heardRuns)} />
    </div>
  );
}
