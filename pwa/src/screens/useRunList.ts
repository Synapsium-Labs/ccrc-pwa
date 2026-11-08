// A list of runs read from `GET /api/runs/find` (the runs rebuild, Task 11, D-8073; spec 2026-11-04 §8.2.3, §8.6). The board's
// Finished group and Advanced's All runs list are the same read with different questions, so they share this hook: the first
// page, the cursor of the next, the race guard, and the four states the screens word.
//
// SKEW (§8.2.3). An older server has no `find`: its `GET /api/runs/:id` takes the path, fails to parse "find" as an id and
// answers 400 `bad-request`; a server with no such route would answer 404. Either is `older`, and counts as answered. The
// board's own call is fixed, so a new server never answers it 400 `bad-request`; a 400 with any other code is a failure.
// A caller that gives a `fallback` reads the unpaged archive instead and sorts it by `closedAt`.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunFindQuery, RunHit, RunSummary } from '../../../shared/api';
import { api, ApiError } from '../lib/api';
import { refusalText } from '../lib/refusalWords';
import { isRunClosed, runClosedAt } from '../fleet/runWords';

/** How many runs one page of `find` asks for (§8.6: 50 at a time). */
export const RUN_LIST_PAGE = 50;

/** The live frame's open runs and whether the frame has landed: a run leaving it is a close the list must read again. */
export interface LiveWatch { readonly live: readonly RunSummary[]; readonly seen: boolean }

export type RunListState = 'loading' | 'ok' | 'error' | 'older';
export type FindReader = (q: RunFindQuery) => ReturnType<typeof api.findRuns>;
export type ArchiveReader = () => Promise<{ runs: RunSummary[] }>;

/** The board's reader, module-scope so its identity is stable across renders. */
export const readFind: FindReader = (q) => api.findRuns(q);

/** A slim `find` row as the board's row component draws it: the stored columns, and an empty value for each field `find`
 *  does not carry. A finished row needs no more than that, and a hit never shows a live verdict. */
export function runOfHit(h: RunHit): RunSummary {
  // `hadChild` is left off: `runHadChild` is its one reader, and absent reads as false, which is what a hit knows. A
  // `RunSummary` is cast, never revived, so the readers already take a row without it.
  const whole: Omit<RunSummary, 'hadChild'> = {
    homeProject: null, sessionId: null, resumed: false, clearedAt: null, dispatchStartedAt: null, dispatchedAt: null,
    handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
    health: {
      mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true,
      clearError: null, coordKickoffPendingSince: null,
    },
    childReclaim: null, reviewCap: null,
    ...h,
  };
  return whole as RunSummary;
}

/** The one code that makes a 400 an older server's answer: `GET /api/runs/:id` refusing "find" as an id. */
const OLDER_SERVER_CODE: Readonly<Record<'bad-request', string>> = { 'bad-request': 'an older server' };

/** Whether a refusal is the one an older server gives `find`: 400 `bad-request` or 404. */
export function isOlderServerAnswer(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || (err.status === 400 && refusalText(err, OLDER_SERVER_CODE) !== null));
}

/** What one `loadOlder()` came to: `appended` the page joined the rows; `dropped` an answer refused as stale; `failed` the
 *  read did not answer; `idle` nothing to ask. A caller shows a failure for `failed` alone. */
export type RunListOlder = 'appended' | 'dropped' | 'failed' | 'idle';

export interface RunList {
  /** The rows held, or null for no answer yet. A failed re-read keeps them. */
  readonly rows: RunSummary[] | null;
  readonly state: RunListState;
  readonly reload: () => Promise<void>;
  readonly loadOlder: () => Promise<RunListOlder>;
  readonly hasOlder: boolean;
}

const byClose = (a: RunSummary, b: RunSummary): number => (runClosedAt(b) ?? 0) - (runClosedAt(a) ?? 0) || b.id - a.id;

export function useRunList(
  query: RunFindQuery,
  { read = readFind, fallback, watch }: { read?: FindReader; fallback?: ArchiveReader; watch?: LiveWatch } = {},
): RunList {
  const key = JSON.stringify(query);
  const [rows, setRows] = useState<RunSummary[] | null>(null);
  const [state, setState] = useState<RunListState>('loading');
  const [next, setNext] = useState<{ beforeAt: number; beforeId: number } | null>(null);
  const issued = useRef(0);
  const asking = useRef<Promise<RunListOlder> | null>(null);
  const nextRef = useRef(next);
  nextRef.current = next;
  const queryRef = useRef(query);
  queryRef.current = query;
  const readRef = useRef(read);
  readRef.current = read;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const reload = useCallback(async (): Promise<void> => {
    const mine = ++issued.current;
    try {
      const a = await readRef.current({ ...queryRef.current, limit: RUN_LIST_PAGE });
      if (mine !== issued.current) return;
      setRows(a.runs.map(runOfHit));
      setNext(a.next);
      setState('ok');
    } catch (err) {
      if (mine !== issued.current) return;
      if (isOlderServerAnswer(err) && fallbackRef.current !== undefined) {
        try {
          const all = await fallbackRef.current();
          if (mine !== issued.current) return;
          setRows(all.runs.filter(isRunClosed).sort(byClose));
          setNext(null);
          setState('older');
        } catch {
          if (mine === issued.current) setState('error');
        }
        return;
      }
      setState(isOlderServerAnswer(err) ? 'older' : 'error');
    }
  }, []);

  // A new question starts over; the first render of a key reads.
  useEffect(() => {
    setRows(null);
    setNext(null);
    setState('loading');
    void reload();
    return () => { issued.current++; };
  }, [key, reload]);

  const loadOlder = useCallback((): Promise<RunListOlder> => {
    if (asking.current !== null) return asking.current;
    const cursor = nextRef.current;
    if (cursor === null) return Promise.resolve('idle');
    const mine = issued.current;
    const p = readRef.current({ ...queryRef.current, limit: RUN_LIST_PAGE, beforeAt: cursor.beforeAt, beforeId: cursor.beforeId })
      .then((a): RunListOlder => {
        // A re-read issued meanwhile owns the rows: this page was asked from a cursor that has moved.
        if (mine !== issued.current || nextRef.current !== cursor) return 'dropped';
        const seen = new Set<number>();
        setRows((held) => [...(held ?? []), ...a.runs.map(runOfHit)].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))));
        setNext(a.next);
        return 'appended';
      }, (): RunListOlder => 'failed')
      .finally(() => { asking.current = null; });
    asking.current = p;
    return p;
  }, []);

  // A run leaving the live frame has closed (or been abandoned): the list is read again so it heads the close order.
  const live = watch?.live ?? null;
  const seen = watch?.seen ?? false;
  const was = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (live === null || !seen) return;
    const ids = new Set(live.map((r) => r.id));
    const prev = was.current;
    was.current = ids;
    if (prev !== null && [...prev].some((id) => !ids.has(id))) void reload();
  }, [live, seen, reload]);

  return { rows, state, reload, loadOlder, hasOlder: next !== null };
}
