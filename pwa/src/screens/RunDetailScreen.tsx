// One run's page, `/runs/<id>` (the runs rebuild, D-8072; spec 2026-11-04 §8.4, F16, checks 5 and 16, A42). Any run, open or
// closed, however old. L4: it reads, it navigates and it decides nothing; the facts and their order are `runDetailWords.ts`'s,
// the close words are `closeWords.ts`'s, the row's words are `runWords.ts`'s.
//
// FIVE READS, EACH ITS OWN. The run and its trail come from `GET /api/runs/:id/record`, which is stored rows and answers with
// the agent link down. Spend and unread mail come from `GET /api/runs/:id`, the work items from `/items`, the suite and checks
// from `/signals`, and the programme's pinned spec from its Goals. A slow or failed read leaves out its own fact and delays
// nothing else. Only the record's failure is the page's: a 404 `unknown-run` says "There is no run N.", any other says "Could not load this
// run. Try again.".
//
// THE HEADER IS A SUPERSET OF THE ROW: every element `RunRow` draws is drawn here from the same readers, so a card, a row and
// this page cannot disagree about a run (D-5545).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, PageScaffold, Section, TextLink, cn, useNow } from '@ccrc/ui';
import {
  graphReadCount, unmeasuredFields,
  type FleetSession, type RunRecordAnswer, type RunSpend, type RunSummary,
} from '../../../shared/api';
import { api } from '../lib/api';
import { refusalText } from '../lib/refusalWords';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { inAppClick } from '../fleet/settingsText';
import { openExternal } from '../lib/markdown';
import { GraphChip, LastSpawnChip, UnmeasuredChip } from '../fleet/chips';
import { formatAge, formatElapsed } from '../fleet/formatReset';
import { coordinatorPresence } from '../fleet/presence';
import { closeLeadLine, coordinatorFactWord, coordinatorWord, noRunLine, RUN_PAGE_WORDS, runFacts, runWhen } from '../fleet/runDetailWords';
import { runSpendLine } from '../fleet/runSpendWords';
import { spawnVerdictChip } from '../fleet/spawnWords';
import {
  DISPATCH_GLYPH, DISPATCH_STALLED_WORDS, RUN_GLYPH, childReclaimChip, childReclaimTitle, coordinatorOf, crossingNote, dispatchStalledTitle,
  dispatchWindow, itemTallyLabel, anyDispatchPending, runWaitLine,
  isRunClosed, programsWithOpenRun, resumeNote, resumeShown, runHomeProject, runItems, runKindChip, runRowName, runState, runStateWord, runWarnings, workerOf,
  workerSeenNote,
} from '../fleet/runWords';
import { programmeSpecHref } from '../ledgers/ledgerLinks';
import { WayBack } from '../ledgers/WaitingRoutes';
import { LiftCapSheet } from '../fleet/LiftCapSheet';
import { AbandonSheet, abandonChildOf } from '../fleet/AbandonSheet';
import { ResumeSheet } from '../fleet/ResumeSheet';
import { resumeHeirs } from '../fleet/resumeHeirs';
import { capWaiting } from '../fleet/reviewCapWords';
import { RunTrail } from './RunTrail';
import { runQueryOf, programmeIsOpenable, programmePath, runPath, runsSearchPath, sessionPath } from '../lib/routes';
import { useLocation } from '../lib/router';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './run-detail.css';

type Record_ = { kind: 'loading' } | { kind: 'ok'; answer: RunRecordAnswer } | { kind: 'missing' } | { kind: 'failed' };

/** A read that settles once for the page's `id` and stays `undefined` when it fails: its fact is left out. */
function useSide<T>(id: number, ask: (id: number) => Promise<T>): T | undefined {
  const [got, setGot] = useState<{ id: number; value: T } | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setGot(undefined);
    ask(id).then((value) => { if (live) setGot({ id, value }); }, () => { /* the fact is left out */ });
    return () => { live = false; };
    // `ask` is a module-level reader; re-asking on its identity would read on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return got !== undefined && got.id === id ? got.value : undefined;
}

const readRun = (id: number): Promise<{ run: RunSummary; spend: RunSpend }> => api.run(id);
const readItems = (id: number): Promise<{ done: number; total: number }> =>
  api.runItems(id).then((a) => ({ done: a.items.filter((i) => i.state === 'done').length, total: a.items.length }));
const readSignals = (id: number) => api.runSignals(id);

/** Only the server's own `unknown-run` answer means the run does not exist. An older server answers an unmatched `/api` path with
 *  404 `not-found`, which is a missing route and reads as a failed load. */
const UNKNOWN_RUN_CODE: Readonly<Record<'unknown-run', string>> = { 'unknown-run': 'unknown' };
function isUnknownRun(e: unknown): boolean {
  return refusalText(e, UNKNOWN_RUN_CODE) !== null;
}

function useRecord(id: number): { state: Record_; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Record_>({ kind: 'loading' });
  const lastId = useRef<number | null>(null);
  useEffect(() => {
    let live = true;
    // A re-read of the same run (`retry`) keeps the page drawn until the answer lands; a new run starts from loading.
    if (lastId.current !== id) setState({ kind: 'loading' });
    lastId.current = id;
    api.runRecord(id).then(
      (answer) => { if (live) setState({ kind: 'ok', answer }); },
      (e: unknown) => { if (live) setState(isUnknownRun(e) ? { kind: 'missing' } : { kind: 'failed' }); },
    );
    return () => { live = false; };
  }, [id, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

/** The programme's pinned spec, from its Goals; a read that fails leaves the link out. */
function useSpecHref(run: RunSummary | null): string | null {
  const slug = run?.program ?? null;
  const [href, setHref] = useState<{ slug: string; href: string | null } | null>(null);
  useEffect(() => {
    if (slug === null || run === null) return undefined;
    let live = true;
    api.goals(slug).then(
      (a) => { if (live) setHref({ slug, href: programmeSpecHref(slug, [a.goals], [run]) }); },
      () => { /* no link */ },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  return href !== null && href.slug === slug ? href.href : null;
}

/** The way-back strip: "‹ Search results" with the query kept when the page was opened from a search, "‹ Runs" from anywhere
 *  else, a cold link included (A42). Named "Back to …" for a screen reader (o3). */
export function WayStrip({ to, label }: { to: string; label: string }): ReactNode {
  return (
    <nav className="wi-nav rd-strip" aria-label={RUN_PAGE_WORDS.stripLabel}>
      <WayBack to={to} label={label} />
    </nav>
  );
}

function Strip({ q }: { q: string | null }): ReactNode {
  return <WayStrip to={q === null ? '/runs' : runsSearchPath(q)} label={q === null ? RUN_PAGE_WORDS.stripRuns : RUN_PAGE_WORDS.stripSearch} />;
}

function Header({ run, worker, nowMs, quietMs }: {
  run: RunSummary; worker: FleetSession | null; nowMs: number; quietMs: number | null;
}): ReactNode {
  const state = runState(run);
  const nowSec = Math.floor(nowMs / 1000);
  const crossing = crossingNote(run);
  const kind = runKindChip(run);
  const warnings = runWarnings(run, nowMs);
  const reclaim = childReclaimChip(run);
  const resume = resumeNote(run, nowSec);
  const spawn = dispatchWindow(run, nowMs);
  const verdict = worker === null ? null : spawnVerdictChip(worker);
  const degraded = worker === null ? [] : unmeasuredFields(worker);
  const graphReads = worker === null ? null : graphReadCount(worker);
  const waitLine = runWaitLine(run, nowMs);
  const seen = workerSeenNote(run, nowMs, quietMs);
  return (
    <header className="rd-head">
      <p className="rd-kind-word">{run.kind === 'review' ? 'review' : 'work'}</p>
      <p className="rd-lamp">
        <span className="rd-glyph" aria-hidden="true">{RUN_GLYPH[state]}</span>
        <span className="rd-state">{runStateWord(run)}</span>
      </p>
      <p className="rd-name">{runRowName(run)}</p>
      <p className="rd-line">
        <span className="rd-project">{run.project}</span>
        {crossing !== null && (
          <span className="rd-crossing" title={crossing.title}>
            <span aria-hidden="true">{crossing.glyph}</span>{crossing.word}
          </span>
        )}
        {kind !== null && (
          <span className="rd-kind" title={kind.title}><span aria-hidden="true">{kind.glyph}</span>{kind.word}</span>
        )}
        <span className="rd-tally">{itemTallyLabel(runItems(run))}</span>
        <span className="rd-when">{run.dispatchedAt === null ? '—' : formatAge(nowSec - Math.floor(run.dispatchedAt / 1000))}</span>
        {seen !== null && <span className="rd-seen" data-quiet={String(seen.quiet)} title={seen.title}>{seen.word}</span>}
      </p>
      {spawn.phase === 'in-flight' && (
        <p className="rd-dispatch">
          <span aria-hidden="true">{DISPATCH_GLYPH['in-flight']}</span>{'dispatching… '}{formatElapsed(spawn.elapsedMs)}
        </p>
      )}
      {spawn.phase === 'stalled' && (
        <p className="rd-dispatch" title={dispatchStalledTitle(spawn.elapsedMs)}>
          <span aria-hidden="true">{DISPATCH_GLYPH.stalled}</span>{DISPATCH_STALLED_WORDS}
        </p>
      )}
      {waitLine !== null && (
        run.blockedBy != null
          ? <p className="rd-wait"><a className="rd-wait-link" href={runPath(run.blockedBy)} onClick={inAppClick(runPath(run.blockedBy))}>{waitLine}</a></p>
          : <p className="rd-wait">{waitLine}</p>
      )}
      <p className="rd-chips">
        <LastSpawnChip chip={verdict} />
        <GraphChip reads={graphReads} gated={null} />
        {resume !== null && <span className="rd-resumed" title={resume.title}>{resume.word}</span>}
        {reclaim !== null && (
          <span className="rd-reclaim" title={childReclaimTitle(reclaim, nowSec)}>
            <span aria-hidden="true">{reclaim.glyph}</span>{reclaim.label}
          </span>
        )}
        <UnmeasuredChip fields={degraded} />
      </p>
      {reclaim !== null && reclaim.line !== null && <p className="rd-reclaim-line">{reclaim.line}</p>}
      {warnings.length > 0 && (
        <p className="rd-warn">
          {warnings.map((w) => (
            <span key={w.word} className="rd-warn-item" title={w.title}><span aria-hidden="true">{w.glyph}</span>{' '}{w.word}</span>
          ))}
        </p>
      )}
    </header>
  );
}

/** The controls under the header (spec §8.4, §9.4): each one tap to its place. Resume is drawn when `onResume` is handed, and
 *  the caller hands it only when `resumeShown` says so. */
function Controls({ run, coordinatorOpenable, onLift, onAbandon, onResume }: {
  run: RunSummary; coordinatorOpenable: boolean; onLift: () => void; onAbandon?: () => void; onResume?: () => void;
}): ReactNode {
  const session = run.sessionId;
  const coordinator = run.claimedBy;
  const lift = capWaiting(run) === 'waiting';
  // Abandon is for an open run, whatever the stuck verdict says or lacks: it is the guard for a wrong or uncertain one (spec 8.4, 7).
  const abandon = onAbandon !== undefined && !isRunClosed(run);
  if (session === null && !(coordinatorOpenable && coordinator !== null) && !lift && !abandon && onResume === undefined) return null;
  return (
    <p className="rd-controls">
      {session !== null && (
        <a className={cn(GHOST_ANCHOR, 'rd-control')} href={sessionPath(session)} onClick={inAppClick(sessionPath(session))}>
          {RUN_PAGE_WORDS.openSession}
        </a>
      )}
      {coordinatorOpenable && coordinator !== null && (
        <a className={cn(GHOST_ANCHOR, 'rd-control')} href={sessionPath(coordinator)} onClick={inAppClick(sessionPath(coordinator))}>
          {RUN_PAGE_WORDS.openCoordinator}
        </a>
      )}
      {onResume !== undefined && (
        <Button variant="ghost" className="rd-control" aria-label={`Resume run ${run.id}`} onClick={onResume}>{RUN_PAGE_WORDS.resume}</Button>
      )}
      {lift && <Button variant="ghost" className="rd-control" onClick={onLift}>{RUN_PAGE_WORDS.liftCap}</Button>}
      {abandon && <Button variant="ghost" className="rd-control" onClick={onAbandon}>{RUN_PAGE_WORDS.abandon}</Button>}
    </p>
  );
}

function Facts({ groups }: { groups: ReturnType<typeof runFacts> }): ReactNode {
  return (
    <>
      {groups.map((g) => (
        <Section key={g.id} title={g.title} level={3} data-group={g.id} className="rd-group">
          <dl className="rd-facts">
            {g.facts.map((f) => (
              <div key={f.key} className="rd-fact" data-fact={f.key}>
                <dt>{f.label}</dt>
                <dd>
                  {f.parts.map((p, i) => p.href === undefined ? <span key={i}>{p.text}</span> : (
                    p.external === true
                      ? <TextLink key={i} href={p.href} onClick={(e) => openExternal(e, p.href)}>{p.text}</TextLink>
                      : <TextLink key={i} href={p.href} onClick={inAppClick(p.href)}>{p.text}</TextLink>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      ))}
    </>
  );
}

/** The run's frame: the page scaffold with its way-back strip, or, in the broad pane, a plain region with neither strip nor Back
 *  (spec §8.4: the list beside it is the way back). */
function Frame({ pane, title, q, children }: { pane: boolean; title: string; q: string | null; children: ReactNode }): ReactNode {
  if (pane) return <section className="rd-pane" aria-label={title}><h2 className="rd-pane-title">{title}</h2>{children}</section>;
  return <PageScaffold title={title}><Strip q={q} />{children}</PageScaffold>;
}

export function RunDetailScreen({ id, store = useFleetStore, pane = false }: { id: number; store?: FleetStore; pane?: boolean }): ReactNode {
  const { search } = useLocation();
  const q = runQueryOf(search);
  const { state, retry } = useRecord(id);
  const sessions = store((s) => s.sessions);
  const frameSeen = store((s) => s.fleetFrameSeen);
  const liveRuns = store((s) => s.runs);
  const runsFrameSeen = store((s) => s.runsFrameSeen);
  const stallQuietMs = store((s) => s.stallQuietMs);
  const recordRun = state.kind === 'ok' ? state.answer.run : null;
  // The live runs frame wins for an open run, so a page beside the board cannot disagree with its row (D-5545); a closed run
  // is not in the frame and keeps the record's.
  const run = recordRun === null ? null : liveRuns.find((r) => r.id === recordRun.id) ?? recordRun;
  // The frame carries open runs only: a run that was in it and has left it has closed (or been abandoned), and the record read
  // on mount still says what it was then, so it is read again (D-5545).
  const wasLive = useRef(false);
  useEffect(() => {
    const inFrame = recordRun !== null && liveRuns.some((r) => r.id === recordRun.id);
    if (inFrame) wasLive.current = true;
    else if (wasLive.current && runsFrameSeen) { wasLive.current = false; retry(); }
  }, [liveRuns, recordRun, runsFrameSeen, retry]);
  const now = useNow(run !== null && anyDispatchPending([run]) ? 1_000 : 30_000);
  const side = useSide(id, readRun);
  const items = useSide(id, readItems);
  const signals = useSide(id, readSignals);
  const pinnedSpec = useSpecHref(run);
  const [liftOpen, setLiftOpen] = useState(false);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const title = `Run ${id}`;
  if (state.kind === 'loading') {
    return <Frame pane={pane} title={title} q={q}><p role="status" className="rd-note">Loading…</p></Frame>;
  }
  if (state.kind === 'missing') {
    return (
      <Frame pane={pane} title={title} q={q}>
        <p className="rd-note">{noRunLine(id)}</p>
        {/* A link that stands alone is a control: `GHOST_ANCHOR`, the button's tap floor, never a bare TextLink. */}
        {!pane && <a className={cn(GHOST_ANCHOR, 'rd-board')} href="/runs" onClick={inAppClick('/runs')}>{RUN_PAGE_WORDS.toBoard}</a>}
      </Frame>
    );
  }
  if (state.kind === 'failed' || run === null) {
    // An older server has no `/record` route, but it answers `/api/runs/:id`: the header and the way to the session come
    // from that read, so a row's tap is never a dead end.
    const basic = side?.run;
    return (
      <Frame pane={pane} title={title} q={q}>
        <p role="alert" className="rd-note">{RUN_PAGE_WORDS.failed}</p>
        <Button variant="primary" onClick={retry}>{RUN_PAGE_WORDS.retry}</Button>
        {basic !== undefined && (
          <>
            <Header run={liveRuns.find((r) => r.id === basic.id) ?? basic} worker={null} nowMs={now} quietMs={stallQuietMs} />
            <Controls run={basic} coordinatorOpenable={false} onLift={() => undefined} />
          </>
        )}
      </Frame>
    );
  }
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const worker = workerOf(run, byId);
  const coordSession = coordinatorOf(run, byId);
  const presence = coordinatorPresence(run.claimedBy, coordSession, frameSeen);
  // Resume (spec §8.4, §9.5, A55): the server's verdict on the coordinator, and the run open or its programme with no open run;
  // a runs frame not yet heard hides it.
  const programHasOpenRun = runsFrameSeen ? programsWithOpenRun(liveRuns).has(run.program) : null;
  const resumable = run.claimedBy !== null && resumeShown(run, presence, programHasOpenRun);
  const pr = worker?.pr ?? null;
  const spend = side === undefined ? undefined : runSpendLine(side.spend)?.short;
  const programmeHref = programmeIsOpenable(run.program) ? programmePath(run.program) : null;
  const lead = closeLeadLine(run);
  const groups = runFacts({
    run, reviewedBy: state.answer.reviewedBy, fmt: runWhen, programmeHref, specHref: pinnedSpec, runHref: (n) => runPath(n),
    coordinator: coordinatorFactWord(run.coordinatorGone, presence), worker: worker === null ? null : coordinatorWord(coordinatorPresence(worker.id, worker, frameSeen)),
    pr: pr !== null && pr.number !== null ? { text: `#${pr.number}`, href: pr.url !== null && /^https:\/\//.test(pr.url) ? pr.url : null } : null,
    ...(items === undefined ? {} : { items }),
    ...(signals === undefined ? {} : { signals: signals.signals.signals }),
    ...(side === undefined ? {} : { unreadMail: side.run.unreadMail }),
    ...(spend === undefined ? {} : { spend }),
  });
  return (
    <Frame pane={pane} title={title} q={q}>
      <Header run={run} worker={worker} nowMs={now} quietMs={stallQuietMs} />
      {lead !== null && <p className="rd-close">{lead}</p>}
      <Controls run={run} coordinatorOpenable={coordSession !== null} onLift={() => setLiftOpen(true)} onAbandon={() => setAbandonOpen(true)}
        {...(resumable ? { onResume: () => setResumeOpen(true) } : {})} />
      <Facts groups={groups} />
      <RunTrail events={state.answer.events} olderEvents={state.answer.olderEvents} />
      <ResumeSheet run={resumeOpen ? run : null} heirs={resumeHeirs(sessions, runHomeProject(run) ?? run.project, run.claimedBy, frameSeen)}
        onClose={() => setResumeOpen(false)} onDone={retry} />
      <LiftCapSheet run={liftOpen ? run : null} onClose={() => setLiftOpen(false)} onDone={retry} />
      {/* The one abandon sheet the board uses (spec 9.1); a done abandon re-reads the record, which now says who closed it and why. */}
      <AbandonSheet run={abandonOpen ? run : null} workspaceChild={abandonChildOf(worker ?? undefined)} coordinatorPresence={presence}
        onClose={() => setAbandonOpen(false)} onDone={retry} />
    </Frame>
  );
}
