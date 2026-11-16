// The PWA's ONE poll primitive (ARCH-30, #544): "the newest ISSUED request is authoritative, the page becoming visible
// re-polls, and a write can drop every request issued before it". Four view hooks each carried a copy of it. The
// caller owns the request, what an answer means and the state it lands in; this owns the issue counter and
// the timer; the page becoming visible is the page clock's (`lib/pageClock.ts`, D-7191).
//
// Each read gets its own `AbortSignal` (console speed, task C1 "the link and the start"): the hook aborts every read in
// flight when it unmounts and when `supersede()` drops them, so a screen that is left stops its fetches, and an aborted
// read lands nothing. A newer poll does not abort an older read; the issue counter already keeps it from landing.
import { useCallback, useEffect, useRef } from 'react';
import { onPageVisible } from './pageClock';

/** What a request came to: the raw answer, or the rejection. The caller reads it (a wire guard, a failure word). */
export type PollOutcome = { ok: true; raw: unknown } | { ok: false; err: unknown };

export interface PollOptions {
  /** The cadence. `<= 0` is the injected mode: no request, no timer, no listener, `reload()` issues nothing. `null`
   *  asks once on mount and again on every return to the page, with no timer. */
  pollMs: number | null;
  /** One read. Its signal aborts when the hook unmounts or `supersede()` drops it; a request that ignores it still
   *  works, and its answer is dropped as before. */
  request: (signal: AbortSignal) => Promise<unknown>;
  /** Called with the outcome of a request that is still the newest issued and whose hook is still mounted. `issue` is
   *  that request's number (the one `reload()` returned for it). */
  onOutcome: (outcome: PollOutcome, issue: number) => void;
  /** Re-poll each time the page becomes visible (the page clock's `onPageVisible`). Default `true`; `false` keeps a
   *  view whose request schedule never re-polled on return (`HotFilesStrip`, `useFleetHealth`) on that schedule. */
  refetchOnVisible?: boolean;
}

export interface PollControl {
  /** One request now, under the same newest-issued guard. Returns its issue number, 0 in the injected mode. */
  reload: () => number;
  /** Every request issued before this call now lands stale: a write's reply was installed and a poll must not put the
   *  old answer back. */
  supersede: () => void;
}

/** `onPageVisible` as an effect, for a view that refreshes on return without polling (`useProjectRows`). `handler` may
 *  change identity every render; the subscription is made once and always calls the latest. */
export function useWhenVisible(handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => onPageVisible(() => latest.current()), []);
}

export function usePoll(options: PollOptions): PollControl {
  const { pollMs, refetchOnVisible = true } = options;
  // The latest request and reader, read at call time, so a caller's inline closures never re-arm the timer.
  const latest = useRef(options);
  latest.current = options;
  const issued = useRef(0);
  const loadRef = useRef<() => number>(() => 0);
  /** The reads in flight, each with its own controller; a read leaves the set when it settles. */
  const inFlight = useRef(new Set<AbortController>());

  useEffect(() => {
    if (pollMs !== null && pollMs <= 0) return undefined;   // an injected consumer never polls
    let live = true;
    const flights = inFlight.current;
    const load = (): number => {
      const mine = ++issued.current;
      const ctl = new AbortController();
      flights.add(ctl);
      const land = (outcome: PollOutcome): void => {
        flights.delete(ctl);
        if (!live || ctl.signal.aborted || mine !== issued.current) return;
        latest.current.onOutcome(outcome, mine);
      };
      void latest.current.request(ctl.signal).then(
        (raw) => land({ ok: true, raw }),
        (err: unknown) => land({ ok: false, err }),
      );
      return mine;
    };
    loadRef.current = load;
    load();
    const timer = pollMs === null ? null : setInterval(load, pollMs);
    const stopVisible = refetchOnVisible ? onPageVisible(load) : null;
    return () => {
      live = false;
      loadRef.current = () => 0;
      abortAll(flights);
      if (timer !== null) clearInterval(timer);
      stopVisible?.();
    };
  }, [pollMs, refetchOnVisible]);

  const reload = useCallback((): number => loadRef.current(), []);
  const supersede = useCallback((): void => {
    issued.current += 1;
    abortAll(inFlight.current);
  }, []);
  return { reload, supersede };
}

function abortAll(flights: Set<AbortController>): void {
  for (const ctl of [...flights]) ctl.abort();
  flights.clear();
}
