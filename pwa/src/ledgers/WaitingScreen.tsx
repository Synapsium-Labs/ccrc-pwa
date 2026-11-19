// The combined "Waiting on you" list (desktop-polish PL5a, D-7712; spec §2; the prototype's view 1), the ONE Waiting on you
// page since PL11 (D-7986, D29): a programme's chip and Goals page open it filtered to that programme. Pure over what the shell
// holds: the waiting view (`null` until the first frame or read), the fleet's sessions (their questions join the list from
// the `attention` bucket, so nothing new is stored for them; the sessions stopped on a usage limit with no account to take them
// join the same way, from their `limitWait` record, D-8123) and runs, and the page clock. It routes nowhere itself: the
// shell passes what opening an item or a session does, so this file imports no route (ring L4, no decisions: every
// grouping, count and label is `ledgerWords.ts`'s).
import { useState, type ReactNode } from 'react';
import { BareRow, Button, TextLink } from '@ccrc/ui';
import type { CallView, FleetSession, RunSummary } from '../../../shared/api';
import { WAITS_ON_WORDS, type ItemView, type WaitingView } from '../../../shared/ledgers';
import { capWaiting, reviewCapOf } from '../fleet/reviewCapWords';
import { fleetHues } from '../fleet/programmeBoxes';
import { programmeTitle, programWave, waveOfWords } from '../fleet/runWords';
import {
  CLEARED_HEADING, CLEARED_SHOWN, MENTIONS_WORD, SHOW_FEWER_WORD, clearedCountWord, clearedGroups, clearedTrail, itemNumber, itemRefWord, showAllWord, EMPTY_WORD, KIND_WORD, NO_FRAME_WORD, NO_PROGRAMME_WORD, QUESTION_PILL_WORD, QUESTION_WORD,
  COMBINED_LIST, NO_PROGRAMME_FILTER, REVIEW_CAP_WORD, ageWords, cameBack, cameBackNote, groupByProgramme, itemPills, limitRows, listGroups,
  openRunsOf, programmeIsLive, questionRows, resolveList, shownSummary, summaryWords, type ClearedEntry, type ItemList, type ProgrammeGroup,
  type QuestionRow, type Row,
} from './ledgerWords';
import { SpecLink } from './GoalsPanel';
import { LimitWaitRow } from './LimitWaitRow';
import { RowMain, RowMeta } from './rowParts';
import { ItemControls, LiftCapControl, carriesControls, useItemActs, type ItemActs } from './ItemActs';
import { itemRefIds, programmeSpecHref } from './ledgerLinks';
import { inAppClick } from '../fleet/settingsText';
import { AnswerMarkBoxes } from './AnswerMarkBox';
import { ASK_HOW_WORD, ASK_NO_TEXT_WORD, askMarksFor, askRowsOf } from './answerMarkWords';
import type { AskMarkRow } from '../../../shared/answerMarks';
import { apiErrorText } from '../lib/refusalWords';
import { CALLS_GROUP_WORDS, SEEN_WORD, callLine, callRefusalText, callsOf } from './callWords';
import './ledgers.css';

export interface WaitingScreenProps {
  /** `null` until the first `waiting` frame or `GET /api/waiting` answer: "not heard yet" is not "nothing waits". */
  readonly view: WaitingView | null;
  /** The fleet's sessions, or `null` before the first fleet frame and with no saved rows to draw: a list without its
   *  sessions' questions is not "nothing needs you", so the screen then says it is waiting (review 1359 F3). Before the
   *  fleet frame, the route may pass the rows the fleet snapshot saved on this device, never as a fact: always with
   *  `notCurrent` saying they are the device's (console speed C4, spec D16), and never when nothing was saved (review
   *  1556 R1). */
  readonly sessions: readonly FleetSession[] | null;
  /** The runs, or `null` before the runs frame: a programme is not called ended on runs this page has not heard. */
  readonly runs: readonly RunSummary[] | null;
  /** Why no list will come (this box has no coordination database), in words; shown in place of the waiting line. */
  readonly unavailable?: string | null;
  /** Present when the list or the rows given are the device's saved copy, not live (console speed, Task C4; spec §2.6,
   *  D16): the line saying so, in words. The screen draws what it is given with this line above it, where the waiting line
   *  stands with nothing to draw. Absent, the list is live. */
  readonly notCurrent?: string;
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
  /** The page of an item a card's text names ("item 12"), or null for a number that is no item (D-8194). Absent, a card links
   *  nothing. The route decides; this file names no route. */
  readonly itemHref?: ItemHref;
  /** The operator's Seen on a big call (D-8126, `POST /api/calls/:id/seen`). Absent, or on the device's saved copy, the calls
   *  are drawn with no Seen. A rejection frees the button and is said on the call's row. */
  readonly onSeen?: CallSeen;
}

/** The Seen door, as the route hands it in (D-8126). */
export type CallSeen = (id: number) => Promise<unknown>;

/** An item reference's page, or null (D-8194). */
type ItemHref = (id: number) => string | null;

/** The items a card's text names that are items, other than the card's own, each linked once, in the order first named
 *  (D-8194). The card is one button and a link cannot sit inside a button, so the links sit on a line of their own under it,
 *  in the row's own list item. Nothing is drawn when the text names no item. */
function Mentions({ item, note, itemHref }: { item: ItemView; note: string | null; itemHref: ItemHref | null }): ReactNode {
  if (itemHref === null) return null;
  const refs = itemRefIds([item.title, item.why, ...(note === null ? [] : [note])])
    .filter((id) => id !== item.id)
    .flatMap((id) => { const href = itemHref(id); return href === null ? [] : [{ id, href }]; });
  if (refs.length === 0) return null;
  return (
    <p className="wl-refs">
      {`${MENTIONS_WORD} `}
      {refs.map((r, i) => (
        <span key={r.id}>
          {i > 0 && ', '}
          <TextLink href={r.href} onClick={inAppClick(r.href)}>{itemRefWord(r.id)}</TextLink>
        </span>
      ))}
    </p>
  );
}

/** The rail's key for the group of sessions that are in no programme (a programme slug can never be this). */
const NO_RUNS: readonly RunSummary[] = [];
/** No calls: one frozen empty list, so a default never makes a new array per render (D-8126). */
const NO_CALLS: readonly CallView[] = [];
const NO_PROGRAMME_KEY = ' none';
const keyOf = (program: string | null): string => program ?? NO_PROGRAMME_KEY;

/** What the list draws of the controls an item or a cap carries: the sheets' openers, the runs they name, and whether they act. */
interface RowActs { readonly acts: ItemActs; readonly runs: readonly RunSummary[] | null; readonly enabled: boolean }

function ItemRow({ item, now, onOpen, current, rowActs, itemHref }: {
  item: ItemView; now: number; onOpen: (id: number) => void; current: boolean; rowActs: RowActs | null; itemHref: ItemHref | null;
}): ReactNode {
  const note = cameBackNote(item);
  const back = cameBack(item);
  const meta = item.state === 'checking' && item.tickedAt !== null ? `ticked ${ageWords(item.tickedAt, now)}` : `raised ${ageWords(item.raisedAt, now)}`;
  // An item with an action keeps its why's own lines: an end request's holds the asker's words and, on its own line, who it reached
  // the operator through; a refused close's ends in who it reached the operator through too.
  const carries = rowActs !== null && carriesControls(item, rowActs.runs);
  return (
    <li className="wl-li" data-acts={carries ? 'true' : undefined}>
      <BareRow className="wl-item" data-item={item.id} data-state={item.state} data-needed={item.neededBy}
               {...(current ? { 'aria-current': 'page' as const } : {})} onClick={() => onOpen(item.id)}>
        {/* The kind chip and, under it (beside it on a narrow row), the item's number (D-8194). */}
        <span className="wl-tag">
          <span className="wl-kind">{KIND_WORD[item.kind]}</span>
          <span className="wl-num">{itemNumber(item)}</span>
        </span>
        <RowMain what={item.title} why={item.why} lines={item.action !== undefined && item.action !== null}>
          {back && note !== null && <span className="wl-bounce">{`The coordinator sent it back: ${note}`}</span>}
        </RowMain>
        <RowMeta pills={itemPills(item)} when={meta} />
      </BareRow>
      {rowActs !== null && <ItemControls item={item} runs={rowActs.runs} acts={rowActs.acts} enabled={rowActs.enabled} place="row" />}
      {/* The operator's two answer marks (Overlord W1), beside the row's button, never inside it; off on a saved copy. */}
      {/* Fail closed: a row drawn with no acts says nothing about the page being current, so its boxes are off. */}
      <AnswerMarkBoxes item={item} current={rowActs !== null && rowActs.enabled} />
      <Mentions item={item} note={back ? note : null} itemHref={itemHref} />
    </li>
  );
}

/** A run whose review cap waits: a row of its own with Lift cap on it (runs rebuild §8.7). Not a button: the control is the row's
 *  one act, and the run's page is one tap away from the Runs screen. */
function CapRow({ run, rowActs }: { run: RunSummary; rowActs: RowActs | null }): ReactNode {
  const cap = reviewCapOf(run);
  const rounds = cap === null || cap === 'unmeasured' ? null : cap;
  return (
    <li className="wl-li" data-acts={rowActs === null ? undefined : 'true'}>
      <div className="wl-capitem" data-run={run.id} data-state="open" data-needed="soon">
        <span className="wl-kind">{REVIEW_CAP_WORD}</span>
        <RowMain what={`Review cap reached: run ${run.id}`}
                 why={`${run.programTitle ?? run.program} wave ${run.wave}${rounds === null ? '' : `: ${rounds.rounds} of ${rounds.cap} review rounds`}`} />
      </div>
      {rowActs !== null && capWaiting(run) === 'waiting' && <LiftCapControl run={run} acts={rowActs.acts} enabled={rowActs.enabled} />}
    </li>
  );
}

function QuestionButton({ q, now, onOpen, ask, current }: {
  q: QuestionRow; now: number; onOpen: (id: string) => void; ask: AskMarkRow | null; current: boolean;
}): ReactNode {
  return (
    <li className="wl-li">
      <BareRow className="wl-item wl-question" data-session={q.sessionId} data-state="question" data-needed="soon"
               onClick={() => onOpen(q.sessionId)}>
        <span className="wl-kind">{QUESTION_WORD}</span>
        <RowMain what={q.title} why="A session is waiting for your answer. Open it to answer." />
        <RowMeta pills={[{ tone: 'ask', word: QUESTION_PILL_WORD }]} when={q.at > 0 ? ageWords(q.at, now) : ''} />
      </BareRow>
      {/* Answer marks B: the boxes of the ask the session's dialog waits on, read live by the server; none for any other. Keyed
          by the ask, so a new ask on this row starts with its own boxes (review 2217 F2). */}
      {ask !== null && <AnswerMarkBoxes key={ask.id} item={ask} kind="ask" current={current} />}
    </li>
  );
}

/** One programme's rows: its items, its sessions' questions and its sessions stopped on a usage limit, as the list draws them, and as the list beside an open item
 *  draws them, with that item marked current (plan PL9). */
export function ItemRows({ rows, now, onOpenItem, onOpenSession, currentId = null, rowActs = null, itemHref = null, asks }: {
  rows: readonly Row[]; now: number; onOpenItem: (id: number) => void; onOpenSession: (id: string) => void; currentId?: number | null;
  rowActs?: RowActs | null; itemHref?: ItemHref | null;
  /** The view's live asks (answer marks B); absent, no question row draws a box. */
  asks?: readonly AskMarkRow[];
}): ReactNode {
  return (
    <ul className="wl-items">
      {rows.map((row) => {
        if (row.kind === 'item') return <ItemRow key={`i${row.item.id}`} item={row.item} now={now} onOpen={onOpenItem} current={row.item.id === currentId} rowActs={rowActs} itemHref={itemHref} />;
        // A usage-limit row carries its own two controls (D-8123); tapping the row itself opens nothing.
        if (row.kind === 'limit') return <LimitWaitRow key={`l${row.limit.sessionId}`} limit={row.limit} now={now} />;
        if (row.kind === 'cap') return <CapRow key={`c${row.run.id}`} run={row.run} rowActs={rowActs} />;
        return <QuestionButton key={`q${row.question.sessionId}`} q={row.question} now={now} onOpen={onOpenSession}
                               ask={askMarksFor(row.question.sessionId, asks)} current={rowActs !== null && rowActs.enabled} />;
      })}
    </ul>
  );
}

/** "Calls made for you (N)": the big calls coordinators made in the operator's name, collapsed, below a programme's rows
 *  (D-8126). Never part of the blocking count, the rail's counts or the summary: a call needs nothing from the operator but a
 *  glance. Each carries Seen while one is offered, asked once while in flight; the row leaves for the cleared trail on the next
 *  frame, and a rejection (offline, `not-big`, `unknown-call`) frees the button and says why on the row, because the server
 *  sends no frame on a refusal. Nothing is drawn for none. */
export function CallsGroup({ calls, now, onSeen }: { calls: readonly CallView[]; now: number; onSeen?: CallSeen | undefined }): ReactNode {
  const [asked, setAsked] = useState<ReadonlySet<number>>(() => new Set());
  const [refused, setRefused] = useState<ReadonlyMap<number, string>>(() => new Map());
  if (calls.length === 0) return null;
  const askSeen = (id: number, send: CallSeen): void => {
    setAsked((was) => new Set(was).add(id));
    setRefused((was) => { if (!was.has(id)) return was; const next = new Map(was); next.delete(id); return next; });
    send(id).catch((err: unknown) => {
      setAsked((was) => { const next = new Set(was); next.delete(id); return next; });
      setRefused((was) => new Map(was).set(id, callRefusalText(err) ?? apiErrorText(err)));
    });
  };
  return (
    <details className="wl-calls" data-calls={calls.length}>
      <summary className="wl-calls-sum">{CALLS_GROUP_WORDS(calls.length)}</summary>
      <ul className="wl-calls-list">
        {calls.map((c) => (
          <li key={c.id} className="wl-call" data-call={c.id}>
            <span className="wl-call-line">{callLine(c, now)}</span>
            {onSeen !== undefined && (
              <BareRow className="wl-call-act" disabled={asked.has(c.id)} onClick={() => askSeen(c.id, onSeen)}>{SEEN_WORD}</BareRow>
            )}
            {refused.has(c.id) && <span className="wl-call-error" role="alert">{refused.get(c.id)}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A programme with calls made for the operator and no row of its own (D-8126): its heading and its calls, drawn among the
 *  groups so a call is seen where the programme's rows would be, and never counted. */
function CallsApart({ program, title, hue, calls, now, onSeen }: {
  program: string; title: string; hue: string | null; calls: readonly CallView[]; now: number; onSeen: CallSeen | undefined;
}): ReactNode {
  return (
    <section className="wl-group" data-program={program} data-hue={hue ?? 'none'} data-calls-only="true" aria-label={title}>
      <div className="wl-ghead">
        <span className="wl-swatch" aria-hidden="true" />
        <h2 className="wl-gtitle">{title}</h2>
      </div>
      <CallsGroup calls={calls} now={now} onSeen={onSeen} />
    </section>
  );
}

/** One programme's block of a list: its heading in its hue, and its rows. The combined list draws one per group, and so does
 *  the list beside an open item (plan PL9), which passes the open item as `currentId`. `specHref` is the programme's pinned spec
 *  in the Docs reader (`programmeSpecHref`, PL10, D-7952): the combined list passes it, and null or absent draws no Spec link. */
export function ListGroup({ group, runs, hue, now, onOpenItem, onOpenSession, currentId = null, specHref = null, rowActs = null, itemHref = null, asks, calls = NO_CALLS, onSeen }: {
  group: ProgrammeGroup; runs: readonly RunSummary[] | null; hue: string | null; now: number;
  onOpenItem: (id: number) => void; onOpenSession: (id: string) => void; currentId?: number | null; specHref?: string | null;
  rowActs?: RowActs | null; itemHref?: ItemHref | null; asks?: readonly AskMarkRow[];
  /** The programme's calls made for the operator (D-8126), drawn collapsed below its rows; none draws nothing. */
  calls?: readonly CallView[]; onSeen?: CallSeen | undefined;
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
      <ItemRows rows={group.rows} now={now} onOpenItem={onOpenItem} onOpenSession={onOpenSession} currentId={currentId} rowActs={rowActs} itemHref={itemHref}
                {...(asks === undefined ? {} : { asks })} />
      <CallsGroup calls={calls} now={now} onSeen={onSeen} />
    </section>
  );
}

/** Where a cleared row's programme is named: beside a row of the list that holds several programmes, and not under a
 *  programme's own heading. `null` is the asks in no programme. */
type Where = (program: string | null) => string;

/** One row of the Recently cleared trail: an item, (answer marks B) an ask the operator has that is not live, or (D-8126) a
 *  big call that left "Calls made for you". */
function ClearedRow({ entry, where, now, current }: { entry: ClearedEntry; where?: Where | undefined; now: number; current: boolean }): ReactNode {
  if (entry.kind === 'call') return <ClearedCallRow call={entry.call} where={where} now={now} />;
  return entry.kind === 'item'
    ? <ClearedItemRow item={entry.item} where={where} now={now} current={current} />
    : <ClearedAskRow ask={entry.ask} where={where} now={now} current={current} />;
}

/** A cleared call (D-8126): its line as the group drew it, and where. Read only: Seen and Overturn… live in the group. */
function ClearedCallRow({ call, where, now }: { call: CallView; where?: Where | undefined; now: number }): ReactNode {
  const place = where?.(call.program);
  return (
    <li className="wl-cleared-row" data-call={call.id}>
      <span aria-hidden="true">✓ </span>{callLine(call, now)}{place === undefined ? null : ` · ${place}`}
    </li>
  );
}

/** A cleared ask: the question (not struck through, for a lapsed or handed-over ask may still wait in its session), how it
 *  reached the operator and when, and its two boxes. */
function ClearedAskRow({ ask, where, now, current }: { ask: AskMarkRow; where?: Where | undefined; now: number; current: boolean }): ReactNode {
  const tail = [QUESTION_WORD, where?.(ask.program), `${ASK_HOW_WORD[ask.how]} ${ageWords(ask.at, now)}`].filter((t) => t !== undefined);
  return (
    <li className="wl-cleared-row" data-ask={ask.id}>
      <span aria-hidden="true">{ask.how === 'answered' ? '✓ ' : '? '}</span>{ask.question === '' ? ASK_NO_TEXT_WORD : ask.question}
      {` · ${tail.join(' · ')}`}
      <AnswerMarkBoxes item={ask} kind="ask" current={current} />
    </li>
  );
}

/** One struck-through cleared item: its title, its number, where, and when. */
function ClearedItemRow({ item, where, now, current }: {
  item: ItemView; where?: Where | undefined; now: number; current: boolean;
}): ReactNode {
  const tail = [itemNumber(item), where?.(item.program), item.closedAt === null ? undefined : `confirmed ${ageWords(item.closedAt, now)}`]
    .filter((t) => t !== undefined);
  return (
    <li className="wl-cleared-row">
      <span aria-hidden="true">✓ </span><s>{item.title}</s>
      {` · ${tail.join(' · ')}`}
      {/* An answer is often best judged once given (Overlord W1): the marks stay inside the Recently cleared window. */}
      <AnswerMarkBoxes item={item} current={current} />
    </li>
  );
}

/** A cleared row's React key: an item and an ask may share an id. */
const entryKey = (e: ClearedEntry): string => (e.kind === 'item' ? `i${e.item.id}` : e.kind === 'ask' ? `a${e.ask.id}` : `c${e.call.id}`);

/** How the whole trail is grouped by programme (D-8194): each programme's name and hue, as the list's groups draw them. */
interface ClearedGrouping { readonly title: (program: string | null) => string; readonly hue: (program: string | null) => string | null }

/** "Recently cleared": what the coordinator confirmed in the last 48 hours (`CLEARED_WINDOW_MS`, D-8194), newest first, each struck
 *  through with its number and when. The newest `CLEARED_SHOWN` show; Show all reveals the whole window and Show fewer folds it
 *  back. `where` names the programme beside a row where the list holds several; the list filtered to one programme leaves it out.
 *  Nothing is drawn for none.
 *
 *  THE WHOLE WINDOW IS GROUPED BY PROGRAMME where the list holds several (`grouping`, D-8194): a heading per programme in the
 *  order of its newest clear, its name beside its hue's swatch and its count, each COLLAPSED until its heading is pressed. Which
 *  groups are open lives in this component's state alone: Show fewer forgets it, and so does leaving the page (nothing is kept
 *  in storage). The list filtered to one programme has one group, so it draws its share as one plain list. */
export function ClearedTrail({ items, asks = [], calls = NO_CALLS, where, now, grouping, current = false }: {
  items: readonly ItemView[]; where?: Where; now: number; grouping?: ClearedGrouping;
  /** The asks the operator has that are not live (answer marks B), joined to the trail by their time. */
  asks?: readonly AskMarkRow[];
  /** The big calls that left "Calls made for you" (D-8126), joined to the trail by when they cleared. */
  calls?: readonly CallView[];
  /** True only on a current page; false on the device's saved copy, and unset fails closed: the rows' answer marks are off, as
   *  every act on a saved copy is. */
  current?: boolean;
}): ReactNode {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string | null>>(() => new Set());
  const trail = clearedTrail(items, now, asks, calls);
  if (trail.length === 0) return null;
  const more = trail.length > CLEARED_SHOWN;
  const whole = all || !more;
  const grouped = all && more && grouping !== undefined;
  const flip = (program: string | null): void => setOpen((was) => {
    const next = new Set(was);
    if (!next.delete(program)) next.add(program);
    return next;
  });
  return (
    <section className="wl-cleared" aria-label={CLEARED_HEADING}>
      <h3 className="wl-cleared-title">{CLEARED_HEADING}</h3>
      {grouped
        ? (
          <div className="wl-cgroups">
            {clearedGroups(trail).map((g) => {
              const shown = open.has(g.program);
              const listId = `wl-cg-${g.program ?? 'none'}`;
              return (
                <div key={g.program ?? ''} className="wl-cgroup" data-hue={grouping.hue(g.program) ?? 'none'}>
                  <BareRow className="wl-cg-head" data-program={g.program ?? ''} aria-expanded={shown} aria-controls={listId}
                           onClick={() => flip(g.program)}>
                    <span className="wl-swatch" aria-hidden="true" />
                    <span className="wl-cg-name">{grouping.title(g.program)}</span>{' '}
                    <span className="wl-cg-n">{clearedCountWord(g.entries.length)}</span>
                    <span className="wl-cg-chev" aria-hidden="true" />
                  </BareRow>
                  {shown && <ul id={listId}>{g.entries.map((c) => <ClearedRow key={entryKey(c)} entry={c} now={now} current={current} />)}</ul>}
                </div>
              );
            })}
          </div>
        )
        : <ul>{(whole ? trail : trail.slice(0, CLEARED_SHOWN)).map((c) => <ClearedRow key={entryKey(c)} entry={c} where={where} now={now} current={current} />)}</ul>}
      {more && (
        <Button variant="ghost" size="fit" className="wl-cleared-more" aria-expanded={all}
                onClick={() => { setAll((v) => !v); setOpen(new Set()); }}>
          {all ? SHOW_FEWER_WORD : showAllWord(trail.length)}
        </Button>
      )}
    </section>
  );
}

/** The line over a list or an item drawn from the device's saved copy, saying it is not current (console speed, Task C4;
 *  spec §2.6, D16): ONE leaf, drawn by this screen and by the item's route, in the place the waiting line stands. */
export function NotCurrentLine({ words }: { words: string }): ReactNode {
  return <p className="wl-note" role="status" data-current="false">{words}</p>;
}

export function WaitingScreen(props: WaitingScreenProps): ReactNode {
  const { view, sessions, runs, now } = props;
  const { acts, sheets } = useItemActs(sessions);
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
  // The asks the operator has (answer marks B): the live ones carry boxes on their child's question row, the rest are cleared rows.
  const liveAsks = askRowsOf(view.asks);
  const clearedAsks = askRowsOf(view.asksCleared);
  const titleOf = (p: string | null): string => (p === null ? NO_PROGRAMME_WORD : programmeTitle(p, heardRuns));
  // The runs whose review cap waits join the list with their Lift cap control (runs rebuild §8.7, F21).
  const groups = groupByProgramme(view.items, questions, limitRows(sessions, heardRuns), heardRuns.filter((r) => capWaiting(r) === 'waiting'));
  // A list drawn from the device's saved copy acts on nothing, like every other act on a saved copy.
  const rowActs: RowActs = { acts, runs, enabled: props.notCurrent === undefined };
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
  // The pills count what is drawn (`shownSummary`, review 1537 F4): under a filter, that filter's share alone.
  const words = summaryWords(shownSummary(shown));
  const empty = groups.length === 0;
  // Calls made for the operator (D-8126) never count and never make a group on the rows' account: a programme with calls and no
  // rows draws them apart, among the groups, under the filter that shows it. Seen is offered only on a current page.
  const onSeen = rowActs.enabled ? props.onSeen : undefined;
  const callsFor = (p: string | null): readonly CallView[] => (p === null ? NO_CALLS : callsOf(view, p).open);
  const apart = noProgramme ? [] : [...new Set((view.calls ?? []).map((c) => c.program))]
    .filter((p) => !groups.some((g) => g.program === p) && (list.programme === null || list.programme === p));
  const apartBlock = apart.map((p) => (
    <CallsApart key={`calls:${p}`} program={p} title={titleOf(p)} hue={hues.get(p) ?? null} calls={callsFor(p)} now={now} onSeen={onSeen} />
  ));
  const clearedCalls = noProgramme ? NO_CALLS : (view.callsCleared ?? NO_CALLS).filter((c) => list.programme === null || c.program === list.programme);
  return (
    <div className="wl">
      <header className="wl-head"><h1 className="wl-title">Waiting on you</h1></header>
      {props.notCurrent !== undefined && <NotCurrentLine words={props.notCurrent} />}
      {/* A saved source never says "Nothing needs you." (review 1561 F4): an empty list from the device's copy, or a
          list drawn with the device's rows, is not a fact, so it says it is waiting, under the not-current line. */}
      {empty
        ? (
          <>
            <p className="wl-note">{props.notCurrent === undefined ? EMPTY_WORD : NO_FRAME_WORD}</p>
            {apartBlock.length > 0 && <div className="wl-groups">{apartBlock}</div>}
          </>
        )
        : (
          <>
            {words.length > 0 && (
              <ul className="wl-summary" aria-label="Summary">
                {/* Two pills can share a tone (the limit pill is `blocking` like "N blocking now"), so the text is in the key. */}
                {words.map((w) => <li key={`${w.tone}:${w.text}`} className="wl-pill" data-tone={w.tone}>{w.text}</li>)}
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
                             hue={g.program === null ? null : hues.get(g.program) ?? null} rowActs={rowActs} itemHref={props.itemHref ?? null} asks={liveAsks}
                             calls={callsFor(g.program)} onSeen={onSeen}
                             specHref={g.program === null ? null : programmeSpecHref(g.program, view.goals, heardRuns)} />
                ))}
                {apartBlock}
              </div>
            </div>
          </>
        )}
      {/* The trail follows the filter (PL11, D-7986): the programme's page lost its own trail, so the list filtered to one
          programme holds that programme's, without naming it on every row, and the sessions in no programme hold only their
          cleared asks (answer marks B). */}
      {list.programme !== null
        ? <ClearedTrail items={view.cleared.filter((c) => c.program === list.programme)} asks={clearedAsks.filter((a) => a.program === list.programme)}
                        calls={clearedCalls} now={now} current={rowActs.enabled} />
        : <ClearedTrail items={noProgramme ? [] : view.cleared} asks={noProgramme ? clearedAsks.filter((a) => a.program === null) : clearedAsks}
                        calls={clearedCalls} now={now} where={titleOf} current={rowActs.enabled}
                        grouping={{ title: titleOf, hue: (p) => (p === null ? null : hues.get(p) ?? null) }} />}
      {sheets}
    </div>
  );
}
