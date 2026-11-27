// The one read of every card project's landing line (landing order wave 5k, D-9108). L4: one `usePoll` at 60 seconds,
// the PWA's one poll primitive, reads `GET /api/landing` for each project in parallel. It reads at once when the sorted
// set of projects changes (R4: a cold load's first list included), again on each return to the page and on `reload()`,
// which each door's answer calls. No cache: the last good answer lives in this hook's state, and the per-card state
// (`landingCardStateOf`, L1) decides what one read leaves. An unchanged line keeps its state object, so the project
// card's identity memo re-renders only the card whose line changed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { usePoll, type PollOutcome } from '../lib/usePoll';
import { landingCardStateOf, sameLandingState, type LandingCardState } from './landingLineView';

export type LandingLineReader = (project: string, signal: AbortSignal) => Promise<unknown>;
export interface LandingLines { readonly states: ReadonlyMap<string, LandingCardState>; readonly reload: () => void }
export const LANDING_LINE_POLL_MS = 60_000;

const defaultRead: LandingLineReader = (project, signal) => api.landingLine(project, { signal });
const setOf = (projects: readonly string[]): string[] => [...new Set(projects)].sort();
const EMPTY: ReadonlyMap<string, LandingCardState> = new Map();

/** One `usePoll` at `LANDING_LINE_POLL_MS` reads every card project's line, at once when the sorted set of projects
 *  changes (R4), again on each return to the page (the default `refetchOnVisible`) and on `reload()`, which each door's
 *  answer calls. */
export function useLandingLines(args: { projects: readonly string[]; read?: LandingLineReader }): LandingLines {
  const [states, setStates] = useState<ReadonlyMap<string, LandingCardState>>(EMPTY);
  const latest = useRef(args);
  latest.current = args;
  /** The sorted key of the set the last issued request read. */
  const readKey = useRef<string | null>(null);
  const { reload: load } = usePoll({
    pollMs: LANDING_LINE_POLL_MS,
    // Never rejects: one outcome per project, so one project's failure never drops another's answer.
    request: (signal) => {
      const list = setOf(latest.current.projects);
      readKey.current = list.join('\n');   // before the first await, so a full list at mount reads once
      const read = latest.current.read ?? defaultRead;
      return Promise.all(list.map((p) => Promise.resolve().then(() => read(p, signal)).then(
        (raw): [string, PollOutcome] => [p, { ok: true, raw }],
        (err: unknown): [string, PollOutcome] => [p, { ok: false, err }],
      ))).then((pairs) => new Map(pairs));
    },
    onOutcome: (outcome) => {
      if (!outcome.ok || !(outcome.raw instanceof Map)) return;
      const outcomes = outcome.raw as ReadonlyMap<string, PollOutcome>;
      setStates((prev) => {
        let changed = prev.size !== outcomes.size;
        const next = new Map<string, LandingCardState>();
        for (const [project, o] of outcomes) {
          const before = prev.get(project);
          const after = landingCardStateOf(before, o);
          const kept = before !== undefined && sameLandingState(before, after) ? before : after;
          if (kept !== before) changed = true;
          next.set(project, kept);
        }
        return changed ? next : prev;
      });
    },
  });
  const reload = useCallback(() => { load(); }, [load]);
  const key = setOf(args.projects).join('\n');
  // Declared after the `usePoll` call, so on mount the poll's first request has already recorded its key (R4).
  useEffect(() => { if (key !== readKey.current) reload(); }, [key, reload]);
  return useMemo(() => ({ states, reload }), [states, reload]);
}
