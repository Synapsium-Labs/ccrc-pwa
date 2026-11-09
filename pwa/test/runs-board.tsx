// The board with Finished fed from the same archive fixture a test hands the paged arm (the runs rebuild, Task 11, D-8073).
// Finished reads `GET /api/runs/find` now; most board tests still describe their archive as a `loadRuns` loader, so this
// wrapper answers `find` from that loader: closed runs only, in close order, with the loader's `nextBefore` as the cursor.
import type { ComponentProps, ReactNode } from 'react';
import { STUCK_REASONS, type ProgrammeRow, type RunHit, type RunStuck, type RunSummary } from '../../shared/api';
import { isRunClosed, runClosedAt } from '../src/fleet/runWords';
import { RunsScreen as RealRunsScreen } from '../src/screens/RunsScreen';
import type { FindReader } from '../src/screens/useRunList';
import type { ProgrammesReader } from '../src/screens/usePrograms';
import { RunsScreen as LegacyRowsScreen } from './runs-rows-board';

type Archive = (limit: number, before?: number) => Promise<{ runs: RunSummary[]; nextBefore?: number }>;

/** `find` as the archive loader would answer it. A cursor carries the loader's `nextBefore` in `beforeId`. */
export function findFromArchive(counted: Archive): FindReader {
  // A mock's own implementation answers without counting as a call: tests that count the paged arm's reads keep their numbers.
  const mock = counted as Archive & { getMockImplementation?: () => Archive | undefined };
  const load = mock.getMockImplementation?.() ?? counted;
  return async (q) => {
    const limit = q.limit ?? 50;
    const a = await (q.beforeId === undefined ? load(limit) : load(limit, q.beforeId));
    const closed = a.runs.filter(isRunClosed)
      .sort((x, y) => (runClosedAt(y) ?? 0) - (runClosedAt(x) ?? 0) || y.id - x.id);
    return {
      ok: true, exact: null, runs: closed as unknown as RunHit[], reviewsOf: [],
      next: a.nextBefore === undefined ? null : { beforeAt: 0, beforeId: a.nextBefore },
    };
  };
}

/** The board's props plus the readers tests still describe their world with: the archive as `loadRuns`, Finished's old `find`
 *  reader, and the caps dial's read, which moved to Advanced (Task 12a, D-8074). The board lists no run row of its own any
 *  more (programme cards, the runs rebuild Task 18, D-8075), so the two run readers are accepted and dropped here; a test
 *  that describes Finished hands `loadProgrammes` instead. With none handed, the programmes read answers nothing, so the
 *  cards count from the open runs alone and a test is never left waiting on a real fetch. */
export type BoardTestProps = Omit<ComponentProps<typeof RealRunsScreen>, 'loadFinished'>
  & { loadRuns?: Archive; loadCaps?: unknown; loadFinished?: unknown; loadArchive?: unknown };

export function RunsScreen({ loadRuns: _loadRuns, loadCaps: _loadCaps, loadFinished: _loadFinished, loadArchive: _loadArchive, ...props }: BoardTestProps): ReactNode {
  return <RealRunsScreen {...props} loadProgrammes={props.loadProgrammes ?? NO_PROGRAMMES} />;
}

/** A programmes read that answers an empty list (`GET /api/programmes` with nothing to show). */
export const NO_PROGRAMMES: ProgrammesReader = async () => ({ ok: true, programmes: [], closedToday: { operator: 0, sweep: 0, coordinator: 0 } });

/** A programmes read answering exactly these rows. */
export const programmesAnswer = (programmes: ProgrammeRow[], closedToday = { operator: 0, sweep: 0, coordinator: 0 }): ProgrammesReader =>
  async () => ({ ok: true, programmes, closedToday });

/** A programme row for a fixture: no open run, no ending, no move unless a test says so. */
export const programmeRow = (slug: string, over: Partial<ProgrammeRow> = {}): ProgrammeRow => ({
  slug, title: slug, currentWave: null, waveOf: null, claimedBy: null,
  waves: { working: 0, waiting: 0, queued: 0, done: 0, failed: 0 }, lastMoveAt: null, ending: null, ...over,
});

/** A `find` answer holding exactly these rows and no next page. */
export const foundRows = (rows: readonly RunSummary[]): Awaited<ReturnType<FindReader>> =>
  ({ ok: true, exact: null, runs: rows as unknown as RunHit[], reviewsOf: [], next: null });

/** A stuck verdict, for a test that needs a run in the Stuck band (D-8074, Task 13): Abandon sits on stuck rows alone. */
export const STUCK_NOW: RunStuck = { reason: 'owner-gone', cause: 'coordinator-gone', since: Date.now() - 2 * 86_400_000, closes: null };

/** Open every head of the Stuck band for this viewer, so a stuck row is on screen without a tap (heads fold by default). */
export function stuckOpen(): void {
  try { window.localStorage.setItem('ccrc-runs-stuck-open', JSON.stringify(STUCK_REASONS)); } catch { /* no storage here */ }
}

/** The rows harness (`runs-rows-board.tsx`): the board as it drew its `RunRow`s before the programme cards, fed Finished the way
 *  the old tests describe it: the archive as `loadRuns`, or `find` as `loadFinished`. For the tests that pin a ROW. */
export function RowsBoard({ loadRuns, loadCaps: _loadCaps, ...props }: ComponentProps<typeof LegacyRowsScreen> & { loadRuns?: Archive; loadCaps?: unknown }): ReactNode {
  const loadFinished = props.loadFinished ?? (loadRuns === undefined ? undefined : findFromArchive(loadRuns));
  return <LegacyRowsScreen {...props} {...(loadFinished === undefined ? {} : { loadFinished })} />;
}
