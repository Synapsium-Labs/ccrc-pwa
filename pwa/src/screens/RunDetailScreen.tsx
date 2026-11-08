// One run's page, `/runs/<id>` (the runs rebuild, D-8072; spec 2026-11-04 §8.4, F16, checks 5 and 16, A42). Any run, open or
// closed, however old. L4: it reads, it navigates and it decides nothing; the facts and their order are `runDetailWords.ts`'s,
// the close words are `closeWords.ts`'s, the row's words are `runWords.ts`'s.
//
// FIVE READS, EACH ITS OWN. The run and its trail come from `GET /api/runs/:id/record`, which is stored rows and answers with
// the agent link down. Spend and unread mail come from `GET /api/runs/:id`, the work items from `/items`, the suite and checks
// from `/signals`, and the programme's pinned spec from its Goals. A slow or failed read leaves out its own fact and delays
// nothing else. Only the record's failure is the page's: 404 says "There is no run N.", any other says "Could not load this
// run. Try again.".
//
// THE HEADER IS A SUPERSET OF THE ROW: every element `RunRow` draws is drawn here from the same readers, so a card, a row and
// this page cannot disagree about a run (D-5545).
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, PageScaffold, Section, TextLink, cn } from '@ccrc/ui';
import {
  graphReadCount, unmeasuredFields,
  type FleetSession, type RunRecordAnswer, type RunSpend, type RunSummary,
} from '../../../shared/api';
import { api, ApiError } from '../lib/api';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { inAppClick } from '../fleet/settingsText';
import { openExternal } from '../lib/markdown';
import { GraphChip, LastSpawnChip, UnmeasuredChip } from '../fleet/chips';
import { formatAge, formatElapsed } from '../fleet/formatReset';
import { coordinatorPresence, type CoordinatorPresence } from '../fleet/presence';
import { closeLeadLine, coordinatorWord, noRunLine, RUN_PAGE_WORDS, runFacts, runWhen } from '../fleet/runDetailWords';
import { runSpendLine } from '../fleet/runSpendWords';
import { spawnVerdictChip } from '../fleet/spawnWords';
import {
  DISPATCH_GLYPH, DISPATCH_STALLED_WORDS, RUN_GLYPH, childReclaimChip, childReclaimTitle, coordinatorOf, crossingNote, dispatchStalledTitle,
  dispatchWindow, itemTallyLabel,
  resumeNote, runItems, runKindChip, runRowName, runState, runStateWord, runWarnings, workerOf,
} from '../fleet/runWords';
import { programmeSpecHref } from '../ledgers/ledgerLinks';
import { WayBack } from '../ledgers/WaitingRoutes';
import { LiftCapSheet } from '../fleet/LiftCapSheet';
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

function useRecord(id: number): { state: Record_; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Record_>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    api.runRecord(id).then(
      (answer) => { if (live) setState({ kind: 'ok', answer }); },
      (e: unknown) => { if (live) setState(e instanceof ApiError && e.status === 404 ? { kind: 'missing' } : { kind: 'failed' }); },
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
function Strip({ q }: { q: string | null }): ReactNode {
  const label = q === null ? RUN_PAGE_WORDS.stripRuns : RUN_PAGE_WORDS.stripSearch;
  return (
    <nav className="wi-nav rd-strip" aria-label={RUN_PAGE_WORDS.stripLabel}>
      <WayBack to={q === null ? '/runs' : runsSearchPath(q)} label={label} />
    </nav>
  );
}

function Header({ run, worker, nowMs }: { run: RunSummary; worker: FleetSession | null; nowMs: number }): ReactNode {
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

/** The controls under the header (spec §8.4, §9.4): each one tap to its place. Abandon joins them with its sheet and Resume
 *  with its picker, in later tasks. */
function Controls({ run, coordinatorOpenable, onLift }: { run: RunSummary; coordinatorOpenable: boolean; onLift: () => void }): ReactNode {
  const session = run.sessionId;
  const coordinator = run.claimedBy;
  const lift = capWaiting(run) === 'waiting';
  if (session === null && !(coordinatorOpenable && coordinator !== null) && !lift) return null;
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
      {lift && <Button variant="ghost" className="rd-control" onClick={onLift}>{RUN_PAGE_WORDS.liftCap}</Button>}
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

/** The Who facts' coordinator word: the server's verdict first (spec §8.4, A46/A60), `coordinatorPresence` only when the
 *  verdict is absent. A claimant with no fleet row (an old closed run) reads gone when the server says so. */
function coordinatorFactWord(gone: boolean | undefined, presence: CoordinatorPresence): string | null {
  if (gone === true) return coordinatorWord('dead');
  if (gone === false) return presence === 'dead' ? null : coordinatorWord(presence);
  return coordinatorWord(presence);
}

export function RunDetailScreen({ id, store = useFleetStore }: { id: number; store?: FleetStore }): ReactNode {
  const { search } = useLocation();
  const q = runQueryOf(search);
  const { state, retry } = useRecord(id);
  const sessions = store((s) => s.sessions);
  const frameSeen = store((s) => s.fleetFrameSeen);
  const run = state.kind === 'ok' ? state.answer.run : null;
  const side = useSide(id, readRun);
  const items = useSide(id, readItems);
  const signals = useSide(id, readSignals);
  const specHref = useSpecHref(run);
  const [liftOpen, setLiftOpen] = useState(false);
  const title = `Run ${id}`;
  const strip = <Strip q={q} />;
  if (state.kind === 'loading') {
    return <PageScaffold title={title}>{strip}<p role="status" className="rd-note">Loading…</p></PageScaffold>;
  }
  if (state.kind === 'missing') {
    return (
      <PageScaffold title={title}>
        {strip}
        <p className="rd-note">{noRunLine(id)}</p>
        {/* A link that stands alone is a control: `GHOST_ANCHOR`, the button's tap floor, never a bare TextLink. */}
        <a className={cn(GHOST_ANCHOR, 'rd-board')} href="/runs" onClick={inAppClick('/runs')}>{RUN_PAGE_WORDS.toBoard}</a>
      </PageScaffold>
    );
  }
  if (state.kind === 'failed' || run === null) {
    return (
      <PageScaffold title={title}>
        {strip}
        <p role="alert" className="rd-note">{RUN_PAGE_WORDS.failed}</p>
        <Button variant="primary" onClick={retry}>{RUN_PAGE_WORDS.retry}</Button>
      </PageScaffold>
    );
  }
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const worker = workerOf(run, byId);
  const coordSession = coordinatorOf(run, byId);
  const presence = coordinatorPresence(run.claimedBy, coordSession, frameSeen);
  const pr = worker?.pr ?? null;
  const spend = side === undefined ? undefined : runSpendLine(side.spend)?.short;
  const programmeHref = programmeIsOpenable(run.program) ? programmePath(run.program) : null;
  const lead = closeLeadLine(run);
  const groups = runFacts({
    run, reviewedBy: state.answer.reviewedBy, fmt: runWhen, programmeHref, specHref, runHref: (n) => runPath(n),
    coordinator: coordinatorFactWord(run.coordinatorGone, presence), worker: worker === null ? null : coordinatorWord(coordinatorPresence(worker.id, worker, frameSeen)),
    pr: pr !== null && pr.number !== null ? { text: `#${pr.number}`, href: pr.url !== null && /^https:\/\//.test(pr.url) ? pr.url : null } : null,
    ...(items === undefined ? {} : { items }),
    ...(signals === undefined ? {} : { signals: signals.signals.signals }),
    ...(side === undefined ? {} : { unreadMail: side.run.unreadMail }),
    ...(spend === undefined ? {} : { spend }),
  });
  return (
    <PageScaffold title={title}>
      {strip}
      <Header run={run} worker={worker} nowMs={Date.now()} />
      {lead !== null && <p className="rd-close">{lead}</p>}
      <Controls run={run} coordinatorOpenable={coordSession !== null} onLift={() => setLiftOpen(true)} />
      <Facts groups={groups} />
      <RunTrail events={state.answer.events} olderEvents={state.answer.olderEvents} />
      <LiftCapSheet run={liftOpen ? run : null} onClose={() => setLiftOpen(false)} onDone={retry} />
    </PageScaffold>
  );
}
