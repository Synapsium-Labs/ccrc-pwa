// Finding a run (the runs rebuild, Task 8, D-8072; spec 2026-11-04 §8.3, F1, F2, F4). L4: this reads the fleet store's open
// runs and `GET /api/runs/find` and decides nothing about a run. Open runs filter at once from the frame; closed runs, the
// exact number and the runs that review it come from one `find` read, 200 ms after typing stops. Any failure of that read
// (an older server answers 400 from `GET /api/runs/:id`) leaves the open runs and sets `failed`.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunHit, RunSummary } from '../../../shared/api';
import { api } from '../lib/api';
import { isRunId } from '../lib/routes';
import { isRunClosed } from '../fleet/runWords';
import { useFleetStore, type FleetStore } from '../stores/fleet';

/** How long typing must stop before the closed runs are asked for (spec §8.3). */
export const FIND_DEBOUNCE_MS = 200;

/** A run as a result row draws it: an open run from the frame, or a hit from `find`. Both carry these fields. */
export type FoundRun = RunHit | RunSummary;

/** "410", "#410" and "run 410" all mean run 410; anything else, and a number that is not a run id, is null. */
export function parseRunNumber(text: string): number | null {
  const m = /^(?:#|run\s+)?(\d+)$/i.exec(text.trim());
  return m === null || !isRunId(m[1]!) ? null : Number(m[1]);
}

/** Does an open run match the query: its title, programme name, slug, workspace, branch or project holds it. */
export function runMatches(run: RunSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return false;
  return [run.runTitle, run.programTitle, run.program, run.workspace, run.branch, run.project]
    .some((t) => typeof t === 'string' && t.toLowerCase().includes(q));
}

export interface RunFindResult {
  /** The run whose number the query names, whatever its state, or null. */
  exact: FoundRun | null;
  /** Open runs matching, from the frame, at once. */
  open: RunSummary[];
  /** Closed runs matching, newest close first, once the read answers. */
  closed: RunHit[];
  /** The runs that review the number. */
  reviewsOf: RunHit[];
  /** The `find` read failed, for any reason: the open runs are all there is. */
  failed: boolean;
  /** The `find` read is on its way (or waiting out the 200 ms). */
  searching: boolean;
}

const NONE: Pick<RunFindResult, 'closed' | 'reviewsOf'> & { exact: RunHit | null } = { exact: null, closed: [], reviewsOf: [] };

export function useRunFind(q: string, store: FleetStore = useFleetStore): RunFindResult {
  const runs = store((s) => s.runs);
  const text = q.trim();
  const number = parseRunNumber(text);
  // What the server is asked: a spelling of a number goes as the number.
  const asked = number === null ? text : String(number);
  const [answer, setAnswer] = useState<{ for: string; exact: RunHit | null; closed: RunHit[]; reviewsOf: RunHit[] } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const latest = useRef(asked);
  latest.current = asked;

  useEffect(() => {
    if (asked === '') return undefined;
    const timer = setTimeout(() => {
      api.findRuns({ q: asked, scope: 'closed' }).then(
        (a) => {
          if (latest.current !== asked) return;
          setFailedFor(null);
          setAnswer({ for: asked, exact: a.exact, closed: a.runs, reviewsOf: a.reviewsOf });
        },
        () => {
          if (latest.current !== asked) return;
          setAnswer(null);
          setFailedFor(asked);
        },
      );
    }, FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [asked]);

  return useMemo(() => {
    if (asked === '') return { ...NONE, open: [], failed: false, searching: false };
    const mine = answer !== null && answer.for === asked ? answer : null;
    const failed = failedFor === asked;
    const live = runs.filter((r) => !isRunClosed(r));
    const inFrame = number === null ? null : runs.find((r) => r.id === number) ?? null;
    const exact: FoundRun | null = mine?.exact ?? inFrame;
    const open = live.filter((r) => r.id !== number && runMatches(r, text));
    return {
      exact, open, closed: mine?.closed ?? [], reviewsOf: mine?.reviewsOf ?? [], failed,
      searching: mine === null && !failed,
    };
  }, [asked, answer, failedFor, runs, number, text]);
}
