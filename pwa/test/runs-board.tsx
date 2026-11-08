// The board with Finished fed from the same archive fixture a test hands the paged arm (the runs rebuild, Task 11, D-8073).
// Finished reads `GET /api/runs/find` now; most board tests still describe their archive as a `loadRuns` loader, so this
// wrapper answers `find` from that loader: closed runs only, in close order, with the loader's `nextBefore` as the cursor.
import type { ComponentProps, ReactNode } from 'react';
import type { RunHit, RunSummary } from '../../shared/api';
import { isRunClosed, runClosedAt } from '../src/fleet/runWords';
import { RunsScreen as RealRunsScreen } from '../src/screens/RunsScreen';
import type { FindReader } from '../src/screens/useRunList';

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

export function RunsScreen(props: ComponentProps<typeof RealRunsScreen>): ReactNode {
  const loadFinished = props.loadFinished ?? (props.loadRuns === undefined ? undefined : findFromArchive(props.loadRuns));
  return <RealRunsScreen {...props} {...(loadFinished === undefined ? {} : { loadFinished })} />;
}

/** A `find` answer holding exactly these rows and no next page. */
export const foundRows = (rows: readonly RunSummary[]): Awaited<ReturnType<FindReader>> =>
  ({ ok: true, exact: null, runs: rows as unknown as RunHit[], reviewsOf: [], next: null });
