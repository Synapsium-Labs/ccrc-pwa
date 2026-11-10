// Advanced, `/runs/advanced` (the runs rebuild, Task 11, D-8073; spec 2026-11-04 §8.6, A51, o13). The ledger the board's foot
// links to. In this task it holds All runs: every run from `GET /api/runs/find`, open ones first and then closed ones in close
// order, 50 at a time with "Show older", and four filter chips. The chip and `closedSince` are in the URL, so a reload or a
// shared link keeps both. An open hit reads its word and line from the live frame, by id, because a hit carries no verdict.
// In a broad column a row opens beside the list with `?open=<id>`; narrower, it opens the run's page.
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, EmptyState, PageScaffold } from '@ccrc/ui';
import type { CoordCapsView, RunFindQuery, RunSummary } from '../../../shared/api';
import type { RunCloseRequest } from '../../../shared/run-close';
import { api } from '../lib/api';
import { CapsControl } from '../fleet/CapsControl';
import { ChildReclaimBanner } from '../fleet/ChildReclaimBanner';
import { CoordBanner } from '../fleet/CoordBanner';
import { navigate, useLocation } from '../lib/router';
import {
  RUNS_FILTERS, RUNS_OPEN_QUERY, runPath, runsAdvancedPath, runsClosedSinceOf, runsFilterOf, runsOpenOf, type RunsFilter,
} from '../lib/routes';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { WayStrip } from './RunDetailScreen';
import { COULD_NOT_LOAD, RunPane } from './RunsScreen';
import { ResultRow } from './RunFind';
import { RunCloseSection } from './RunCloseSection';
import { useColumnName } from './runColumn';
import { readFind, useRunList, type FindReader } from './useRunList';
import './run-detail.css';

/** The caps dial's default reader, module-scope so its identity is stable across renders: the control's own effect does not
 *  re-fire on every parent re-render. */
const loadCapsDefault = (): Promise<CoordCapsView> => api.coordCaps();

/** The screen's words (§8.6, o13). */
export const ADVANCED_WORDS = {
  title: 'Advanced',
  back: 'Runs',
  allRuns: 'All runs',
  loading: 'Loading…',
  failed: COULD_NOT_LOAD,
  tryAgain: 'Try again',
  older: 'This server is older, so All runs is not available.',
  none: 'No runs.',
  showOlder: 'Show older',
  olderFailed: 'Could not load older runs. Try again.',
} as const;

/** The chips, in the order they are drawn (§8.6). */
const CHIP_WORDS: Readonly<Record<RunsFilter, string>> = {
  'open': 'Open',
  'by-you': 'Closed by you',
  'by-ccrc': 'Closed by ccrc',
  'by-coordinators': 'Closed by coordinators',
};

/** What each chip asks `find` (the wire's `closedBy` words are `operator`, `sweep` and `coordinator`). */
function queryOf(filter: RunsFilter | null, closedSince: number | null): RunFindQuery {
  const q: RunFindQuery = {};
  if (filter === 'open') q.scope = 'open';
  else if (filter === 'by-you') { q.scope = 'closed'; q.closedBy = 'operator'; }
  else if (filter === 'by-ccrc') { q.scope = 'closed'; q.closedBy = 'sweep'; }
  else if (filter === 'by-coordinators') { q.scope = 'closed'; q.closedBy = 'coordinator'; }
  if (closedSince !== null) q.closedSince = closedSince;
  return q;
}

/** The address of a row beside the list: the screen's own address with `?open=<id>` added (A51). */
function withOpen(base: string, id: number): string {
  return `${base}${base.includes('?') ? '&' : '?'}${RUNS_OPEN_QUERY}=${id}`;
}

export function RunsAdvancedScreen({
  store = useFleetStore, read = readFind, loadCaps = loadCapsDefault, readRunClose, writeRunClose,
}: {
  store?: FleetStore;
  read?: FindReader;
  /** The lane rows' own read and write, injected so a test can hold them; absent, the section's `api` defaults. */
  readRunClose?: () => Promise<unknown>;
  writeRunClose?: (body: RunCloseRequest) => Promise<unknown>;
  /** The caps dial's own read, injected so a test can hold it. */
  loadCaps?: () => Promise<CoordCapsView>;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const column = useColumnName(ref);
  const { search } = useLocation();
  const filter = runsFilterOf(search);
  const closedSince = runsClosedSinceOf(search);
  const openId = column === 'broad' ? runsOpenOf(search) : null;
  const live = store((s) => s.runs);
  const seen = store((s) => s.runsFrameSeen);
  const list = useRunList(queryOf(filter, closedSince), { read, watch: { live, seen } });
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const showOlder = (): void => {
    setOlderBusy(true);
    setOlderFailed(false);
    void list.loadOlder().then((o) => setOlderFailed(o === 'failed')).finally(() => setOlderBusy(false));
  };
  const base = runsAdvancedPath(filter ?? undefined, closedSince ?? undefined);
  // The chip is a toggle: the pressed one clears, and no chip is every run.
  const pick = (f: RunsFilter): void => navigate(runsAdvancedPath(f === filter ? undefined : f, closedSince ?? undefined), { replace: true });
  const liveById = new Map<number, RunSummary>(live.map((r) => [r.id, r] as const));
  // A hit that is still open reads from the frame (by id); a closed one, or one the frame does not hold, is the hit itself.
  const rowOf = (r: RunSummary): RunSummary => liveById.get(r.id) ?? r;
  const addressOf = (id: number): string => (column === 'broad' ? withOpen(base, id) : runPath(id));

  let body: ReactNode;
  if (list.rows === null && list.state === 'loading') body = <EmptyState data-state="loading">{ADVANCED_WORDS.loading}</EmptyState>;
  else if (list.rows === null && list.state === 'error') {
    body = (
      <EmptyState data-state="error">
        {ADVANCED_WORDS.failed}{' '}
        <Button variant="ghost" size="fit" onClick={() => { void list.reload(); }}>{ADVANCED_WORDS.tryAgain}</Button>
      </EmptyState>
    );
  } else if (list.state === 'older') body = <EmptyState data-state="older">{ADVANCED_WORDS.older}</EmptyState>;
  else {
    const rows = list.rows ?? [];
    body = (
      <>
        {list.state === 'error' && (
          <EmptyState data-state="error">
            {ADVANCED_WORDS.failed}{' '}
            <Button variant="ghost" size="fit" onClick={() => { void list.reload(); }}>{ADVANCED_WORDS.tryAgain}</Button>
          </EmptyState>
        )}
        {rows.length === 0 ? <EmptyState data-state="ok">{ADVANCED_WORDS.none}</EmptyState> : (
          <ul className="rf-list ra-list">
            {rows.map((r) => <ResultRow key={r.id} run={rowOf(r)} q="" openId={openId} to={addressOf(r.id)} />)}
          </ul>
        )}
        {list.hasOlder && (
          <Button variant="quiet" size="fit" className="ra-older text-xs leading-none" disabled={olderBusy} onClick={showOlder}>
            {ADVANCED_WORDS.showOlder}
          </Button>
        )}
        {olderFailed && <EmptyState data-state="error">{ADVANCED_WORDS.olderFailed}</EmptyState>}
      </>
    );
  }

  // The switches (§8.6 item 1, Task 12a): the coordination pause, the two coordination caps and the child-reclaim switch with its
  // attention list. They left the board, whose foot links here at every width. A closed run named by a reclaim target is found
  // among the hits All runs holds, and an open one in the live frame.
  const switches = (
    <section className="ra-section ra-switches" aria-label="Switches">
      <CoordBanner store={store} />
      <ChildReclaimBanner store={store} runs={[...live, ...(list.rows ?? [])]} />
      <CapsControl coordCaps={loadCaps} />
    </section>
  );

  // What ccrc closes on its own (§8.6 item 2, Task 26): one row per lane group, between the switches and All runs.
  const closes = <RunCloseSection read={readRunClose} write={writeRunClose} />;

  const allRuns = (
    <section className="ra-section" aria-label={ADVANCED_WORDS.allRuns}>
      <h2 className="ra-head">{ADVANCED_WORDS.allRuns}</h2>
      <div className="ra-chips" role="group" aria-label="Filter">
        {RUNS_FILTERS.map((f) => (
          <Button key={f} variant="ghost" size="fit" className="ra-chip" aria-pressed={f === filter} onClick={() => pick(f)}>
            {CHIP_WORDS[f]}
          </Button>
        ))}
      </div>
      {body}
    </section>
  );

  return (
    <div ref={ref} className="runs-column" data-column={column}>
      <PageScaffold wide title={ADVANCED_WORDS.title}>
        <WayStrip to="/runs" label={ADVANCED_WORDS.back} />
        {column === 'broad' ? (
          <div className="runs-split">
            <div className="runs-list-pane">{switches}{closes}{allRuns}</div>
            <RunPane openId={openId} store={store} />
          </div>
        ) : <>{switches}{closes}{allRuns}</>}
      </PageScaffold>
    </div>
  );
}
