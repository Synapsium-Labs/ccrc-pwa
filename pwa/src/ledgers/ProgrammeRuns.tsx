// The programme page's Runs (the runs rebuild, Task 19, D-8075; spec 2026-11-04 §8.5, §9.5, A55). The page adds no second
// programme page (A1): this file is the header's run facts and the Runs section the Goals page gained. L4: it reads the fleet
// store, `GET /api/programmes` and `GET /api/runs/find`, and navigates; the words are `runWords.ts`'s, `stuckWords.ts`'s,
// `closeWords.ts`'s and `ProgrammeCard.tsx`'s.
//
// THE HEADER IS A SUPERSET OF THE CARD (D-5545): every element the board's card draws (lamp and word, the one needs-you
// marker, the context line), plus the coordinator and its word, the four wave counts and the pending-close line per reason.
// Open waves list newest first on the same row the board used, a review nested under its wave, a stuck row with its Abandon.
// Closed waves are a fold read through `find`, each with §9.3's word and §8.4's line; a failed read is that fold's alone (o13).
//
// RESUME SITS ONCE, ON THE HEAD (F25), never on a row, and `resumeShown` decides it: the server's verdict on the coordinator,
// with a programme that has no open run counted (D-1146). It needs a run to act on: the newest open run, else the newest
// closed one the closed read returned, so an all-terminal programme offers it once that read has answered.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, EmptyState, useNow } from '@ccrc/ui';
import type { FleetSession, ProgrammeRow, RunHit, RunSummary } from '../../../shared/api';
import { AbandonSheet, abandonChildOf } from '../fleet/AbandonSheet';
import { coordinatorPresence } from '../fleet/presence';
import { ResumeSheet } from '../fleet/ResumeSheet';
import { resumeHeirs } from '../fleet/resumeHeirs';
import { coordinatorFactWord } from '../fleet/runDetailWords';
import { anyDispatchPending, coordinatorOf, openWaves, pendingCloseLine, resumeShown, workerOf } from '../fleet/runWords';
import { motionState } from '../fleet/programmeBoxes';
import { inAppClick } from '../fleet/settingsText';
import { cardWord } from '../fleet/stuckWords';
import { api } from '../lib/api';
import { runPath, sessionPath, waitingPath } from '../lib/routes';
import { openRunsOf } from './ledgerWords';
import { ResultRow } from '../screens/RunFind';
import { Fold, GLYPH, cardLine, everyOpenRunStuck } from '../screens/ProgrammeCard';
import { RunRow } from '../screens/RunRow';
import { StuckRow, isStuckRun } from '../screens/StuckBand';
import { openCards, usePrograms, type CardProgramme, type ProgrammesReader } from '../screens/usePrograms';
import type { FindReader } from '../screens/useRunList';

/** The closed waves' words. */
export const CLOSED_WAVES_FAILED = 'Could not load closed waves. Try again.';
export const CLOSED_WAVES_RETRY = 'Try again';

const readClosed: FindReader = (q) => api.findRuns(q);

type ClosedRead = { kind: 'loading' } | { kind: 'ok'; runs: readonly RunHit[] } | { kind: 'failed' };

/** The programme's closed runs, newest close first, from `find`. A re-read when `key` moves (a run left the live frame) keeps
 *  the last answer on screen until the new one lands; a failure keeps nothing it cannot draw and says so. */
function useClosedWaves(slug: string, key: string, read: FindReader): { read: ClosedRead; retry: () => void } {
  const [state, setState] = useState<{ slug: string; read: ClosedRead }>({ slug, read: { kind: 'loading' } });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    read({ program: slug, scope: 'closed', limit: 50 }).then(
      (a) => { if (live) setState({ slug, read: Array.isArray(a.runs) ? { kind: 'ok', runs: a.runs } : { kind: 'failed' } }); },
      () => { if (live) setState({ slug, read: { kind: 'failed' } }); },
    );
    return () => { live = false; };
  }, [slug, key, attempt, read]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { read: state.slug === slug ? state.read : { kind: 'loading' }, retry };
}

/** The injectable readers of the page's two run reads (a test's). */
export interface ProgrammeRunsReaders { programmes?: ProgrammesReader; find?: FindReader }

export interface ProgrammeRunsView {
  /** The programme's open runs, as the live frame has them. */
  readonly open: readonly RunSummary[];
  /** The card the header repeats, or null for a programme with no open run. */
  readonly card: CardProgramme | null;
  /** The programme's row from `GET /api/programmes`, or the one counted from the open runs; null when there is neither. */
  readonly row: ProgrammeRow | null;
  readonly closed: ClosedRead;
  readonly retryClosed: () => void;
  /** Re-reads what a close or a hand-over changed. */
  readonly reload: () => void;
}

const NONE: readonly RunSummary[] = [];

export function useProgrammeRuns(
  slug: string, live: readonly RunSummary[] | null, readers: ProgrammeRunsReaders = {},
): ProgrammeRunsView {
  const open = useMemo(() => openRunsOf(slug, live ?? NONE), [live, slug]);
  const programmes = usePrograms({
    ...(readers.programmes === undefined ? {} : { read: readers.programmes }), live: live ?? NONE, seen: live !== null,
  });
  const closedKey = open.map((r) => r.id).join(',');
  const closed = useClosedWaves(slug, closedKey, readers.find ?? readClosed);
  const card = open.length === 0 ? null : openCards(open, programmes.answer)[0] ?? null;
  const row = card?.row ?? (programmes.answer?.programmes ?? []).find((p) => p.slug === slug) ?? null;
  const { reload: reloadProgrammes } = programmes;
  const { retry: retryClosed } = closed;
  const reload = useCallback(() => { void reloadProgrammes(); retryClosed(); }, [reloadProgrammes, retryClosed]);
  return { open, card, row, closed: closed.read, retryClosed, reload };
}

/** The newest run the page can act on for the head's Resume: the newest open run, else the newest closed one read. */
function newestRun(view: ProgrammeRunsView): Pick<RunSummary, 'id' | 'program' | 'programTitle' | 'wave' | 'claimedBy' | 'project'> | null {
  const open = [...view.open].sort((a, b) => b.id - a.id)[0];
  if (open !== undefined) return open;
  if (view.closed.kind !== 'ok') return null;
  const closed = [...view.closed.runs].sort((a, b) => b.id - a.id)[0];
  return closed ?? null;
}

/** The head's run facts: the card's elements, the coordinator, the wave counts, a pending-close line per reason, and Resume. */
export function ProgrammeHeadFacts({ view, sessions, fleetFrameSeen, runsHeard, needs, quietMs, paused, nowMs, onResume }: {
  view: ProgrammeRunsView; sessions: readonly FleetSession[]; fleetFrameSeen: boolean; runsHeard: boolean;
  /** The one needs-you source's count for this programme, 0 for none. */
  needs: number; quietMs: number | null; paused: boolean; nowMs: number; onResume: () => void;
}): ReactNode {
  const { row, card, open } = view;
  if (row === null) return null;
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const claimant = coordinatorOf({ claimedBy: row.claimedBy }, byId);
  const presence = coordinatorPresence(row.claimedBy, claimant, fleetFrameSeen);
  const word = card === null ? null : cardWord(motionState(row.lastMoveAt, nowMs, quietMs, paused), everyOpenRunStuck(card.open));
  const line = card === null ? '' : cardLine(card, nowMs);
  const coordinatorWord = row.claimedBy === null ? null : coordinatorFactWord(row.coordinatorGone, presence);
  const pending = (row.pendingClose ?? []).map((p) => ({ reason: p.reason, text: pendingCloseLine(p, nowMs) }));
  const target = newestRun(view);
  const resume = target !== null && row.claimedBy !== null
    && resumeShown({ state: open.length > 0 ? 'working' : 'done', ...(row.coordinatorGone === undefined ? {} : { coordinatorGone: row.coordinatorGone }) },
      presence, runsHeard ? open.length > 0 : null);
  const w = row.waves;
  const counts = [`${w.working} working`, `${w.waiting} waiting`, `${w.queued} queued`, `${w.done} done`, ...(w.failed > 0 ? [`${w.failed} failed`] : [])];
  return (
    <div className="pv-facts" data-testid="programme-facts">
      {word !== null && (
        <p className="pv-lamp"><span aria-hidden="true">{GLYPH[word]}</span> <span className="pv-word" data-word={word}>{word}</span></p>
      )}
      {needs > 0 && (
        <a className="pv-marker" href={waitingPath(row.slug)} onClick={inAppClick(waitingPath(row.slug))}>needs you · {needs}</a>
      )}
      {line !== '' && <p className="pv-line">{line}</p>}
      <p className="pv-counts">{counts.join(' · ')}</p>
      {row.claimedBy !== null && (
        <p className="pv-coordinator">
          {'Coordinator: '}
          {claimant === null
            ? <span>{row.claimedBy}</span>
            : <a className="pv-coordinator-link" href={sessionPath(row.claimedBy)} onClick={inAppClick(sessionPath(row.claimedBy))}>{row.claimedBy}</a>}
          {coordinatorWord !== null && <span className="pv-coordinator-word">{` · ${coordinatorWord}`}</span>}
        </p>
      )}
      {pending.map((p) => <p key={p.reason} className="pv-pending" data-reason={p.reason}>{p.text}</p>)}
      {resume && <Button variant="ghost" className="pv-resume" aria-label={`Resume programme ${row.slug}`} onClick={onResume}>Resume</Button>}
    </div>
  );
}

/** The Resume sheet the head opens, for the newest run the page can act on. */
export function HeadResumeSheet({ open, onClose, view, sessions, fleetFrameSeen, title, project }: {
  open: boolean; onClose: () => void; view: ProgrammeRunsView; sessions: readonly FleetSession[]; fleetFrameSeen: boolean;
  title: string; project: string | null;
}): ReactNode {
  const target = open ? newestRun(view) : null;
  const claimedBy = view.row?.claimedBy ?? target?.claimedBy ?? null;
  const run = target === null ? null : { ...target, programTitle: title, claimedBy };
  // The programme's home project when a run names one, else the project of the run the sheet acts on.
  const heirsProject = project ?? target?.project ?? null;
  return (
    <ResumeSheet run={run} heirs={heirsProject === null ? [] : resumeHeirs(sessions, heirsProject, claimedBy, fleetFrameSeen)}
      onClose={onClose} onDone={view.reload} />
  );
}

/** The Runs section: open waves newest first with reviews nested, then the closed waves fold. */
export function ProgrammeRunsSection({ view, sessions, fleetFrameSeen, runsHeard }: {
  view: ProgrammeRunsView; sessions: readonly FleetSession[]; fleetFrameSeen: boolean; runsHeard: boolean;
}): ReactNode {
  const dispatching = anyDispatchPending(view.open);
  const nowMs = useNow(dispatching ? 1_000 : 30_000);
  const [target, setTarget] = useState<RunSummary | null>(null);
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const waves = openWaves(view.open);
  const targetWorker = target === null ? undefined : workerOf(target, byId) ?? undefined;
  const targetPresence = target === null ? 'unknown' : coordinatorPresence(target.claimedBy, coordinatorOf(target, byId), fleetFrameSeen);
  const keep = useRef(view.reload);
  keep.current = view.reload;
  const rowFor = (run: RunSummary): ReactNode => (isStuckRun(run)
    ? <StuckRow key={run.id} run={run} nowMs={nowMs} current={false} onAbandon={setTarget} />
    : <RunRow key={run.id} run={run} nowMs={nowMs} session={workerOf(run, byId)} />);
  return (
    <section className="pv-card pv-runs" aria-label="Runs" data-testid="programme-runs">
      <h2 className="pv-h">Runs</h2>
      {waves.length === 0
        ? (runsHeard ? <p className="pv-none">No run is open.</p> : null)
        : (
          <ul className="programme-waves">
            {waves.map(({ run, reviews }) => (
              <li key={run.id} className="programme-wave" data-wave={run.wave}>
                <ul className="runs-list">{rowFor(run)}</ul>
                {reviews.length > 0 && <ul className="runs-list programme-reviews">{reviews.map(rowFor)}</ul>}
              </li>
            ))}
          </ul>
        )}
      <ClosedWaves view={view} />
      <AbandonSheet run={target} workspaceChild={abandonChildOf(targetWorker)} coordinatorPresence={targetPresence}
        onClose={() => setTarget(null)} onDone={() => keep.current()} />
    </section>
  );
}

function ClosedWaves({ view }: { view: ProgrammeRunsView }): ReactNode {
  const { closed } = view;
  if (closed.kind === 'loading') return null;
  if (closed.kind === 'ok' && closed.runs.length === 0) return null;
  const count = closed.kind === 'ok' ? closed.runs.length : 'could not load';
  return (
    <Fold name="Closed waves" count={count} id="closed">
      {closed.kind === 'failed'
        ? (
          <EmptyState data-state="error" role="alert">
            {CLOSED_WAVES_FAILED}
            <Button variant="ghost" onClick={view.retryClosed}>{CLOSED_WAVES_RETRY}</Button>
          </EmptyState>
        )
        : (
          <ul className="rf-list programme-closed">
            {[...closed.runs].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0) || b.id - a.id)
              .map((r) => <ResultRow key={r.id} run={r} q="" openId={null} to={runPath(r.id)} />)}
          </ul>
        )}
    </Fold>
  );
}
