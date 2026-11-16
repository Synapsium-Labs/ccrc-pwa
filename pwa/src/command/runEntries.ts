// The palette's run entries (the runs rebuild, Task 8, D-8072; spec 2026-11-04 §8.3). Pure: no React, no store, and no server.
// A number offers "Open run 410", which goes to `/runs/410` (the page it opens says whether there is such a run). Open runs
// join the entries by the same terms the board's search uses, ranked after sessions. Any other text offers "Find runs
// matching 'xyz'", which opens `/runs?q=xyz`.
import type { RunSummary } from '../../../shared/api';
import { isRunClosed, runRowName } from '../fleet/runWords';
import { runPath, runsSearchPath } from '../lib/routes';
import { parseRunNumber } from '../screens/useRunFind';
import type { Command } from './registry';

/** Open runs rank after every session (tiers 1 to 3), and the find entry after the open runs. */
const TIER_RUN = 4;
const TIER_FIND = 5;

/** The entries for a typed query over the open runs the frame holds. An empty query offers none. */
export function runEntries(query: string, runs: readonly RunSummary[]): Command[] {
  const q = query.trim();
  if (q === '') return [];
  const entries: Command[] = [];
  const number = parseRunNumber(q);
  if (number !== null) {
    entries.push({
      id: `open-run-${number}`,
      title: `Open run ${number}`,
      group: 'Runs',
      terms: [q],
      run: (c) => c.navigate(runPath(number)),
    });
  } else {
    entries.push({
      id: 'find-runs',
      title: `Find runs matching '${q}'`,
      group: 'Runs',
      searchOnly: true,
      tier: TIER_FIND,
      run: (c) => c.navigate(runsSearchPath(q)),
    });
  }
  for (const r of runs) {
    if (isRunClosed(r)) continue;
    const terms = [r.runTitle, r.programTitle, r.program, r.workspace, r.branch, r.project]
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '');
    entries.push({
      id: `run-hit-${r.id}`,
      title: `Run ${r.id} · ${runRowName(r)}`,
      group: r.project,
      terms,
      tier: TIER_RUN,
      searchOnly: true,
      run: (c) => c.navigate(runPath(r.id)),
    });
  }
  return entries;
}
