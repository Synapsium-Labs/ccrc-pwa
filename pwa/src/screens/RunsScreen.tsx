// The run board. `/accounts`'s anatomy, run over a different list: route regex,
// the data-view OR, the detail slot, a back control at the tap floor, one door.
//
// TWO sources, TWO DIFFERENT HALVES — never one switched for the other (fix round 1, task 5, findings 1 and 3; the runs
// rebuild, Task 12a, D-8074). The live `{type:'runs'}` frame (`/ws/fleet`) is ACTIVE-ONLY by construction: `watch.ts`'s
// `emitRuns` calls `coord.runs()` with no options, and `CoordStore.runs()` defaults to excluding `TERMINAL_RUN_STATES`
// (`shared/api.ts`'s `done`/`failed` pair). It can never carry a finished run, so it is trusted for the OPEN half only, and
// nothing else lists an open run: the instant it has said anything at all, including an honestly empty `[]`
// (`runsFrameSeen`, `stores/fleet.ts`), the open half is answered, because an empty array from a frame that DID arrive is a
// true empty roster, not silence. Before it, the open half says Loading…, whatever Finished answered.
//
// `GET /api/programmes` (`usePrograms`) is the PROGRAMMES half (Task 18, D-8075): each open programme's card takes its wave
// counts and last move from it, and Finished is its endings, read again when the live frame changes what is open. The cards
// themselves come from the frame, so a card never waits on the read. An older server has no such route (404); the cards then
// count from the open runs alone and Finished says so. The run lists (`/api/runs/find`) are Advanced's and the search's.
//
// The switches (pause, caps, child reclaim) left this screen for Advanced; the paused banner stays, only while paused.
//
// RunSummary's SHIPPED shape (`shared/api.ts`, PR I) diverges from the plan's
// illustrative one on several points — no `waves` (it's `waveOf`), no
// `holdReason` at all (never rides the wire — the reason string this file's
// sibling docs keep citing, registry.ts:28, belongs to `FleetSession.held`,
// a DIFFERENT type), and `items` carries only `{done,total}` — no
// `failed`/`blocked` columns exist anywhere yet. This file renders exactly
// what PR I actually shipped, not the plan's historical sample.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { type ProgrammesAnswer, type RunSummary } from '../../../shared/api';
import { isRunClosed, runState, coordinatorOf, workerOf } from '../fleet/runWords';
import { AbandonSheet, abandonChildOf } from '../fleet/AbandonSheet';
import { coordinatorPresence } from '../fleet/presence';
import { LiftCapSheet } from '../fleet/LiftCapSheet';
import { ReviewCapBand } from '../fleet/ReviewCapBand';
import { CoordBanner } from '../fleet/CoordBanner';
import { StartProgramSheet } from '../fleet/StartProgramSheet';
import { inAppClick } from '../fleet/settingsText';
import { navigate, useLocation } from '../lib/router';
import { runParam, runPath, runQueryOf, runsAdvancedPath, type RunsFilter } from '../lib/routes';
import { peek, put, runsBoardKey } from '../lib/screenCache';
import { backToFleet } from '../command/door';
import { Button, EmptyState, PageScaffold, cn, useNow } from '@ccrc/ui';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { markerState } from '../fleet/coordWords';
import { needsYou, needsYouCount } from '../ledgers/needsYou';
import '../fleet/fleet.css';

/** Finished's own failure sentence: its read did not answer, so newer closes may be missing. */
const FINISHED_UNREAD = 'Could not reach the server — finished runs may exist that are not shown.';

import { FinishedFold, ProgrammeCard, QuietFold } from './ProgrammeCard';
import { StuckBand, WaitingBand, isStuckRun } from './StuckBand';
import { stuckLine } from '../fleet/stuckWords';
import { RunDetailScreen } from './RunDetailScreen';
import { useMeasuredColumn } from './runColumn';
import { RUN_FIND_ID, RunFindBox, RunFindResults } from './RunFind';
import { finishedProgrammes, localMidnight, openCards, quietSplit, sortCards, usePrograms, type ProgrammesReader } from './usePrograms';


/** The board's scroll place: the nearest scrolling ancestor of the search box (the desktop pane), else the document. */
function readBoardScroll(): { scroller: HTMLElement | null; top: number } {
  for (let el = document.getElementById(RUN_FIND_ID)?.parentElement ?? null; el !== null; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return { scroller: el, top: el.scrollTop };
  }
  return { scroller: null, top: window.scrollY };
}

/** The board's words for no open run, and for a read that ran out of time (§8.2). */
const NO_RUNS_OPEN = 'No runs open.';
export const COULD_NOT_LOAD = 'Could not load runs. Try again.';

/** Closed today (§8.2 item 5, A32, o6): the runs closed since the operator's local midnight, by who closed them, each count a
 *  link to All runs with that filter and the same `closedSince` the read used. A zero count is left out, and the line is
 *  absent until some close landed. The counts are the server's: the board re-reads when a group loop ends, and never adds. */
function ClosedToday({ counts, midnight }: { counts: ProgrammesAnswer['closedToday']; midnight: number }): ReactNode {
  const parts: { filter: RunsFilter; n: number; who: string }[] = [
    { filter: 'by-you', n: counts.operator, who: 'you' },
    { filter: 'by-ccrc', n: counts.sweep, who: 'ccrc' },
    { filter: 'by-coordinators', n: counts.coordinator, who: 'coordinators' },
  ];
  const shown = parts.filter((p) => p.n > 0);
  if (shown.length === 0) return null;
  return (
    <p className="closed-today" data-testid="closed-today">
      {'Closed today: '}
      {shown.map((p, i) => {
        const href = runsAdvancedPath(p.filter, midnight);
        return (
          <span key={p.filter}>
            {i > 0 && ' · '}
            <a className="closed-today-link" href={href} onClick={inAppClick(href)}>{`${p.n} by ${p.who}`}</a>
          </span>
        );
      })}
    </p>
  );
}

/** The board's information lines (§8.2 item 5, n2, A62): a run no act can move is told, with no control and no count. An
 *  `unknown` run is in a state a newer server wrote; a run at `closing` is finished by the lane that put it there. One run
 *  links its page; several are a count. */
function RunInfoLines({ runs }: { runs: readonly RunSummary[] }): ReactNode {
  const lines: { key: string; runs: RunSummary[]; one: string; many: string }[] = [
    { key: 'unreadable', runs: runs.filter((r) => runState(r) === 'unknown'),
      one: '1 run is in a state this server cannot read.', many: 'runs are in a state this server cannot read.' },
    { key: 'closing', runs: runs.filter((r) => runState(r) === 'closing'),
      one: '1 run is already closing.', many: 'runs are already closing.' },
  ];
  const told = lines.filter((l) => l.runs.length > 0);
  if (told.length === 0) return null;
  return (
    <>
      {told.map((l) => (
        <p key={l.key} className="runs-info" data-info={l.key}>
          {l.runs.length === 1
            ? <a className="runs-info-link" href={runPath(l.runs[0]!.id)} onClick={inAppClick(runPath(l.runs[0]!.id))}>{l.one}</a>
            : `${l.runs.length} ${l.many}`}
        </p>
      ))}
    </>
  );
}

/** The scroll place the board keeps for a return from a run: how far, and whether a pane held it (the desktop) or the document
 *  did (the phone). */
interface KeptBoard { readonly top: number; readonly pane: boolean }

function keptBoard(): KeptBoard | null {
  const raw = peek(runsBoardKey)?.raw;
  if (typeof raw !== 'object' || raw === null) return null;
  const { top, pane } = raw as Partial<KeptBoard>;
  return typeof top === 'number' && typeof pane === 'boolean' ? { top, pane } : null;
}

/** The nearest ancestor of the search box that scrolls by style, whether or not it has anything to scroll yet. */
function boardPane(): HTMLElement | null {
  for (let el = document.getElementById(RUN_FIND_ID)?.parentElement ?? null; el !== null; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') return el;
  }
  return null;
}

/** The pane's words when no run is open (spec §8.4). */
export const SELECT_RUN = 'Select a run to see it here.';

/** What an older server's board says (§8.2.3): it has no `GET /api/programmes`, so there are no endings to list. Its cards
 *  count from the open runs alone. */
const FINISHED_OLDER = 'This server is older, so Finished is not available.';
/** The foot link's words (§8.2 item 10). */
const ADVANCED_WORDS = 'Advanced';

/** The board's props: the store, the injected reads, and the run open beside it, if any. */
interface BoardProps {
  store?: FleetStore;
  /** The programmes' reader: `GET /api/programmes`, the board's own fixed call. */
  loadProgrammes?: ProgrammesReader;
  /** The run open in the broad pane, or null: its row is marked current and a search keeps it open. */
  openId?: number | null;
}

/** The broad column's right pane: the run open beside the list, or the words that say none is (Advanced draws it too). */
export function RunPane({ openId, store }: { openId: number | null; store: FleetStore }): ReactNode {
  return (
    <div className="runs-detail-pane">
      {openId === null
        ? <p className="rd-note" role="status">{SELECT_RUN}</p>
        : <RunDetailScreen key={openId} id={openId} store={store} pane />}
    </div>
  );
}

/** The runs screen, and the one place the column's layout is decided (Task 9a, spec §8.1): `/runs` and `/runs/<id>` both land
 *  here. A broad column draws the board and the run side by side; narrower, `/runs` is the board and `/runs/<id>` is the
 *  run's own page with its way back. The board stays mounted when a run opens in the pane, so its folds and scroll stay. */
export function RunsScreen(props: BoardProps): ReactNode {
  const { openId = null, store = useFleetStore } = props;
  const ref = useRef<HTMLDivElement>(null);
  const measured = useMeasuredColumn(ref);
  const column = measured ?? 'narrow';
  let body: ReactNode = null;
  if (measured === null) body = null;
  else if (column === 'broad') {
    body = (
      <div className="runs-split">
        <div className="runs-list-pane"><RunsBoard {...props} /></div>
        <RunPane openId={openId} store={store} />
      </div>
    );
  } else body = openId !== null ? <RunDetailScreen key={openId} id={openId} store={store} /> : <RunsBoard {...props} />;
  return <div ref={ref} className="runs-column" data-column={column}>{body}</div>;
}

function RunsBoard({
  store = useFleetStore,
  loadProgrammes,
  openId = null,
}: {
  store?: FleetStore;
  loadProgrammes?: ProgrammesReader;
  openId?: number | null;
}): ReactNode {
  const live = store((s) => s.runs);
  const waitingView = store((s) => s.waiting);
  const stallQuietMs = store((s) => s.stallQuietMs);
  const coordPaused = store((s) => markerState(s.coord?.pause) === 'set');
  const runsFrameSeen = store((s) => s.runsFrameSeen);
  const sessions = store((s) => s.sessions);
  const fleetFrameSeen = store((s) => s.fleetFrameSeen);
  const conn = store((s) => s.conn);
  // Task 12, spec §4.3: which run's AbandonSheet is open, or `null`. ONE
  // sheet at screen level, reused across rows — the same shape
  // `SessionActionsSheet`'s single actions sheet uses rather than mounting
  // one sheet per row.
  const [abandonTarget, setAbandonTarget] = useState<RunSummary | null>(null);

  // D-6911: which run's LiftCapSheet is open, or `null`. ONE sheet at screen level, on `abandonTarget`'s idiom; the
  // "Waiting on you" band opens it.
  const [liftTarget, setLiftTarget] = useState<RunSummary | null>(null);

  // Task 13, spec §4.4: the run board's own door onto a new program. ONE
  // door, rendered unconditionally below — including at zero runs, the same
  // "renders at zero runs too" rule `.fleet-runs-row` already holds one
  // screen over.
  const [startOpen, setStartOpen] = useState(false);

  // The programmes (§8.2.2, §8.2.3, D-8075): the cards' counts and Finished's endings, read again when the frame changes what is
  // open. Every act that closes or rewrites a run re-reads it: the cards' counts and Finished's rows are its answer.
  const programmes = usePrograms({ ...(loadProgrammes === undefined ? {} : { read: loadProgrammes }), live, seen: runsFrameSeen });
  const reloadProgrammes = programmes.reload;
  const loadCold = async (): Promise<void> => { await reloadProgrammes(); };
  const finishedState = programmes.state;

  const sessionById = new Map(sessions.map((s) => [s.id, s] as const));
  // #166 wave 5 (spec §5.7): the abandon sheet's confirm line branches on the
  // run's workspace's child mark, read off the fleet row of the run's worker.
  // Abandon is offered on an open run only, so that is the session the wire
  // binds to it (`workerOf`, D-7182): a recycled id, or an older server's frame
  // with no binding, finds none, and the sheet hedges as it does for no row.
  const abandonSession = abandonTarget === null ? undefined : workerOf(abandonTarget, sessionById) ?? undefined;
  // The sheet's "Its coordinator is told." line asks `coordinatorGoneOf`, whose fallback is the board's reading of the claimant.
  const abandonPresence = abandonTarget === null ? 'unknown' : coordinatorPresence(abandonTarget.claimedBy, coordinatorOf(abandonTarget, sessionById), fleetFrameSeen);
  // OPEN reads `live` alone, from the instant the socket has said anything at all (`runsFrameSeen`) — including an honest
  // `[]`, which is what a run closing broadcasts. Before any frame has landed (a cold deep link, or a server too old to send
  // it) `noSignalYet` holds and nothing is listed as open: no other read may stand in for the frame (Task 12a).
  //
  // `isRunClosed` (state), never `runClosedAt` (fix, review findings 3/22):
  // `closedAt` is written by exactly one path outside `reconstruct`, and
  // `reconstruct` — the disaster-recovery rebuild — never writes it at all
  // (pinned by `reconstruction-drill.test.ts` as one of the twelve facts the
  // drill cannot recover). A rebuilt program's finished waves carry
  // `state:'done'`/`'failed'` with `closedAt:null` forever; splitting on
  // `closedAt` filed those rows in NEITHER group the instant a live frame
  // excluded them by state, or in BOTH depending on which slice happened to
  // answer first. `state` is the same line `CoordStore.runs()` itself draws.
  const active = live.filter((r) => !isRunClosed(r));
  // The tick, and it is deliberately declared HERE rather than up with the
  // other hooks: it reads `active`, which is the list it has to describe.
  //
  // MILLISECONDS all the way to the row, which derives its own seconds for
  // `formatAge`. The dispatch window's boundary is `SPAWN_STALL_MS`, a
  // millisecond constant, and flooring here first would make it unmeasurable
  // by up to 999 of them (`runs-screen.test.tsx`'s `FROZEN` carries a
  // sub-second remainder so that claim is held by a red suite, not by this
  // comment).
  //
  // The CADENCE follows the content, the idiom `SessionHeader`
  // (`working ? 1_000 : 30_000`) and `ToolCard` (`useNow(1_000, running)`)
  // already use. 30 s was right while every readout on this board was
  // minute-granular; the dispatch window is not — it renders `formatElapsed`
  // to the second and flips phase on a millisecond threshold, so at 30 s the
  // operator watched `⟳ dispatching… 0:12` hold still for half a minute and
  // then jump to `0:42`, and the wedge landed up to 30 s after the runner had
  // certainly given up. §Design's own complaint about the state this build
  // fixes is "a board that never moves"; rendering a clock the tick cannot
  // honour would have kept it.
  //
  // `anyDispatchPending` and not an inline condition, because the answer must
  // stay `dispatchWindow`'s alone — and it can be asked before a tick exists
  // (that half of the answer is clock-independent; the helper's docstring has
  // the reasoning). `finished` is not consulted: it holds closed runs by
  // construction, and `dispatchWindow` answers `none` for every closed state.
  const now = useNow(30_000);
  // `/runs?run=<id>` is old chat text (chat reading Task L, D-8062). The board replaces it with the run's page, so Back skips it
  // and `?run=` never meets `?q=` (A50); no arrival has to find a row folded under a Stuck head.
  const search = useLocation().search;
  const runId = runParam(search);
  useEffect(() => {
    if (runId !== null) navigate(runPath(runId), { replace: true });
  }, [runId]);
  // The search (spec §8.3): `?q=` holds the query, so Back and a reload keep it. Typing replaces the entry rather than pushing
  // one, and a change of `?q=` from outside (Back) is read back into the box.
  const heldQuery = runQueryOf(search);
  const [findText, setFindText] = useState(heldQuery ?? '');
  useEffect(() => {
    const held = heldQuery ?? '';
    setFindText((t) => (t.trim() === held ? t : held));
  }, [heldQuery]);
  // Clearing the query restores the board with its folds (they live in this component) and the place it was scrolled to. The
  // place is read in `typeFind`, before the swap: once the short results page has rendered the browser has already clamped it.
  // The phone scrolls the document and the desktop a pane, so the scroller is found from the box.
  const scrollWas = useRef<{ scroller: HTMLElement | null; top: number } | null>(null);
  const typeFind = (text: string): void => {
    if (text.trim() !== '' && findText.trim() === '') scrollWas.current = readBoardScroll();
    setFindText(text);
    const t = text.trim();
    // A run open in the pane stays open under the search: the query rides the run's own URL.
    const base = openId === null ? '/runs' : runPath(openId);
    navigate(t === '' ? base : `${base}?${new URLSearchParams({ q: t })}`, { replace: true });
  };
  const finding = findText.trim() !== '';
  const wasFinding = useRef(finding);
  useEffect(() => {
    if (!finding && wasFinding.current && scrollWas.current !== null) {
      const { scroller, top } = scrollWas.current;
      if (scroller !== null) scroller.scrollTop = top;
      else window.scrollTo(0, top);
    }
    wasFinding.current = finding;
  }, [finding]);
  // `/` focuses the box, outside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const box = document.getElementById(RUN_FIND_ID);
      if (box === null) return;
      e.preventDefault();
      box.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Review finding 19: the open half is not trustworthy enough to assert "there are none of these" until the frame has answered
  // (`runsFrameSeen`), and nothing else lists an open run. Until then the board says Loading…, or that the server could not be
  // reached once Finished has failed, and never "No runs open." Finished's rows show below as they arrive: Finished
  // answering says nothing about whether runs are OPEN (its `find` is a closed-only read), so it does not end this window.
  const noSignalYet = !runsFrameSeen;
  // The board's own answer to "does this project already have a program
  // running?", handed to the sheet rather than fetched by it — the sheet's
  // composition is pinned at exactly two network calls
  // (`start-program.test.tsx`'s `expect(urls).toHaveLength(2)`).
  //
  // THREE-STATE, and `noSignalYet` is the third. Before either signal has
  // answered, `new Set()` would tell the sheet this board had measured an empty
  // world; `null` says it has measured nothing, which is what is true. Both of
  // the paths that reach it (a cold deep link, a server too old to send the
  // frame) resolve to a measured set the moment a frame lands, so this is a
  // window and not a dead end.
  //
  // Built from `active`, which is already `!isRunClosed`-filtered: a project
  // whose only run is `done` is not carrying a coordinator any more.
  const openRunProjects: ReadonlySet<string> | null =
    noSignalYet ? null : new Set(active.map((r) => r.project));
  // The cards (§8.2.2): the open programmes of the live frame, needs you first, then the newest move. What needs the operator is
  // the one source's count per programme (`needsYou`, F20), the same number the Waiting door and a programme's chip print.
  const entries = waitingView === null || !fleetFrameSeen ? [] : needsYou(waitingView.items, sessions, live);
  const needsOf = (slug: string): number => needsYouCount(entries, slug);
  // A card counted from the frame alone, while the read has not answered, shows at once when the frame gives it a last move.
  // One the frame gives none (`runLastMove` is null for every run) waits for the read: it would sit in the live list and then
  // jump into the quiet fold and re-sort when the read lands, and nothing arrives late, so nothing jumps. A failed or
  // older-server read ends the wait and such a card falls back to the frame.
  const readPending = programmes.state === 'loading' && programmes.answer === null;
  const cardsShown = openCards(active, programmes.answer).filter((c) => !(readPending && c.row.lastMoveAt === null));
  const { live: liveCards, quiet: quietCards } = quietSplit(sortCards(cardsShown, needsOf), now, needsOf);
  const finishedRows = finishedProgrammes(programmes.answer, new Set(active.map((r) => r.program)), now);
  const hasAny = active.length > 0 || finishedRows.length > 0;
  // I6 (residual): a failed Finished read is a fact about the FINISHED half specifically — the open half can be fully
  // answered by the live frame alone (`runsFrameSeen`) while Finished's `find` has failed outright. With the frame seen and no
  // run open, `!hasAny` would fall straight through to the ordinary "No runs open." — a POSITIVE claim about the program's
  // whole history that a failed read has no standing to make. Read below for the second half: open rows present, Finished
  // failed.
  const coldFailed = finishedState === 'error';
  const timedOut = programmes.timedOut;
  // A read that ran out of time (C1's `ApiTimeout`) says so and offers to read again (§8.2); any other failure keeps the
  // sentence it always had.
  const failedLine: ReactNode = timedOut ? (
    <>
      {COULD_NOT_LOAD}{' '}
      <Button variant="ghost" size="fit" onClick={() => { void loadCold(); }}>Try again</Button>
    </>
  ) : 'Could not reach the server — runs may exist that are not shown.';

  // The place is kept as the board unmounts and restored once it has rows to scroll (C2). A layout cleanup runs before the
  // DOM leaves, so the box is still there to find the scroller from.
  useLayoutEffect(() => () => {
    const at = readBoardScroll();
    put(runsBoardKey, { top: at.top, pane: at.scroller !== null }, Date.now());
  }, []);
  const placeRestored = useRef(false);
  useEffect(() => {
    if (noSignalYet || placeRestored.current) return;
    placeRestored.current = true;
    const kept = keptBoard();
    if (kept === null || kept.top <= 0 || runId !== null || finding) return;
    const pane = kept.pane ? boardPane() : null;
    if (pane !== null) pane.scrollTop = kept.top; else window.scrollTo(0, kept.top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noSignalYet]);

  // The programme cards, quiet programmes and Finished (§8.2 items 7 to 9). A failed read says so in Finished's place, and
  // never claims there is no history; an older server says it has no endings.
  const cardList: ReactNode = (
    <>
      {liveCards.length > 0 && (
        <ul className="programme-cards" aria-label="Programmes">
          {liveCards.map((c) => (
            <ProgrammeCard key={c.row.slug} card={c} nowMs={now} quietMs={stallQuietMs} paused={coordPaused} needs={needsOf(c.row.slug)} />
          ))}
        </ul>
      )}
      <QuietFold cards={quietCards} nowMs={now} quietMs={stallQuietMs} paused={coordPaused} />
    </>
  );
  const finishedGroup: ReactNode = (
    <>
      {finishedRows.length > 0 && <FinishedFold rows={finishedRows} />}
      {finishedState === 'older' && <p className="runs-info" data-info="older-server">{FINISHED_OLDER}</p>}
      {coldFailed && <EmptyState data-state="error">{timedOut ? failedLine : FINISHED_UNREAD}</EmptyState>}
    </>
  );

  return (
    // The page scaffold (D-5102), at the wide column: a board, not a reading column.
    <PageScaffold
      data-conn={conn}
      wide
      title="Runs"
      back={backToFleet('runs-back')}
      actions={(
        <Button variant="quiet" size="fit" className="program-start-door text-xs leading-none" onClick={() => setStartOpen(true)}>
          Start a programme
        </Button>
      )}
    >

      <RunFindBox value={findText} onChange={typeFind} />

      {/* Review finding 26: `runs`/`runsFrameSeen` are sticky across a socket
          loss (`stores/fleet.ts`, "sticky until replaced") — without this,
          the board keeps rendering ages that tick upward with nothing on
          screen saying the socket is down. Text, not an opacity fade —
          `fleet.css`'s own note by `.fleet-list` documents, with contrast
          numbers, why that idiom was tried here first and removed. */}
      {conn === 'down' && (
        <div className="offline-banner" role="status">
          Reconnecting…
        </div>
      )}

      {/* The paused banner (§8.2 item 3): only while coordination is paused. The switch itself lives under Advanced. */}
      <CoordBanner store={store} onlyWhilePaused />

      {/* The Stuck band (§8.2 item 4): one head per reason, right under the paused banner, so no healthy work sits above it.
          The band is a second view of the stuck runs, not a move (§8.2.2): they stay in their programme's rows and counts. The group control opens the group sheet (Task 14). */}
      {!finding && !noSignalYet && <StuckBand runs={active} nowMs={now} openId={openId} onAbandon={setAbandonTarget}
        presence={(r) => coordinatorPresence(r.claimedBy, coordinatorOf(r, sessionById), fleetFrameSeen)} onGroupDone={() => { void loadCold(); }} />}

      {/* Closed today (§8.2 item 5): below the Stuck band, above everything healthy, so no healthy work sits above the band
          (check 12). The counts come from the programmes read, which asks from the operator's local midnight. */}
      {!finding && !noSignalYet && programmes.answer !== null && <ClosedToday counts={programmes.answer.closedToday} midnight={localMidnight(now)} />}

      {/* Waiting on its coordinator (§8.2 item 6): one folded row below Stuck; a stuck run is in the Stuck band alone (R2). */}
      {!finding && !noSignalYet && <WaitingBand runs={active} nowMs={now} openId={openId}
        coordinatorOpenable={(r) => coordinatorOf(r, sessionById) !== null} />}

      {/* D-6911: every open work run whose review cap waits on the operator. It sits below where the Stuck band goes (Task 13)
          until review caps join `/waiting` (Task 24); renders nothing when no run waits. */}
      <ReviewCapBand runs={active} nowMs={now} onLift={setLiftTarget} />

      {finding ? <RunFindResults q={findText} store={store} openId={openId} /> : (<>
      {!noSignalYet && <RunInfoLines runs={active} />}
      {noSignalYet ? (
        // Review finding 19: neither source has answered yet, so this is not
        // "no runs" — it is "no answer". The failed line only after
        // Finished's read has actually failed; until then this is the ordinary
        // in-flight window every mount passes through.
        <>
          <EmptyState data-state={coldFailed ? 'error' : 'loading'}>
            {coldFailed ? failedLine : 'Loading…'}
          </EmptyState>
          {/* Finished's own rows show as they arrive, whatever the open half is waiting on. */}
          {finishedRows.length > 0 || finishedState === 'older' ? finishedGroup : null}
        </>
      ) : !hasAny ? (
        // I6: `noSignalYet` above only covers the "nothing has answered at
        // all" window — once the live frame has said `runsFrameSeen`, this
        // arm is reached even with `active` honestly empty AND
        // Finished's read having FAILED. That is not "No
        // runs" either: it is "no active runs, and the archive could not be
        // read", which must say so rather than claim the program's whole
        // history is empty.
        coldFailed ? (
          <EmptyState data-state="error">{failedLine}</EmptyState>
        ) : (
          <>
            <EmptyState data-state="ok">{NO_RUNS_OPEN}</EmptyState>
            {finishedState === 'older' && <p className="runs-info" data-info="older-server">{FINISHED_OLDER}</p>}
          </>
        )
      ) : (
        <>
          {/* With finished runs only, the board still says nothing is open (§8.2), above the Finished fold. */}
          {active.length === 0 && <EmptyState data-state="ok">{NO_RUNS_OPEN}</EmptyState>}
          {cardList}

          {finishedGroup}
        </>
      )}

      </>)}

      {/* The foot (§8.2 item 10): the door to Advanced, at every width, whatever else the board holds. */}
      <p className="runs-foot">
        <a className={cn(GHOST_ANCHOR, 'runs-foot-link')} href={runsAdvancedPath()} onClick={inAppClick(runsAdvancedPath())}>
          {ADVANCED_WORDS}
        </a>
      </p>

      {/* Task 12, spec §4.3: `onDone` re-runs the screen's own `loadCold()`
          (Step 5) so an abandoned run moves into Finished — the live frame's
          own vanish-diff (above) also fires for the same close, and both
          landing is harmless because they feed separate slices (`active`
          from `live`, `finished` from `find`, never merged). */}
      <AbandonSheet run={abandonTarget} contextLine={abandonTarget !== null && isStuckRun(abandonTarget) ? stuckLine(abandonTarget, now) : undefined}
        workspaceChild={abandonChildOf(abandonSession)} coordinatorPresence={abandonPresence}
        onClose={() => setAbandonTarget(null)} onDone={() => { void loadCold(); }} />
      {/* D-6911: the live `runs` frame carries the lift on the watcher's next tick; `loadCold()` re-reads Finished
          for a session with no frame yet. */}
      <LiftCapSheet run={liftTarget} onClose={() => setLiftTarget(null)} onDone={() => { void loadCold(); }} />
      <StartProgramSheet open={startOpen} onClose={() => setStartOpen(false)} fleet={store}
        openRunProjects={openRunProjects} />
    </PageScaffold>
  );
}
