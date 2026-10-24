// The PWA's ONE poll primitive (ARCH-30, #544): "the newest ISSUED request is authoritative, the page becoming visible
// re-polls, and a write can drop every request issued before it". Four view hooks each carried a copy of it. The
// caller owns the request, what an answer means and the state it lands in; this owns the issue counter, the timer and
// the one `visibilitychange` listener the fleet views use.
import { useCallback, useEffect, useRef } from 'react';

/** What a request came to: the raw answer, or the rejection. The caller reads it (a wire guard, a failure word). */
export type PollOutcome = { ok: true; raw: unknown } | { ok: false; err: unknown };

export interface PollOptions {
  /** The cadence. `<= 0` is the injected mode: no request, no timer, no listener, `reload()` issues nothing. `null`
   *  asks once on mount and again on every return to the page, with no timer. */
  pollMs: number | null;
  /** One read. */
  request: () => Promise<unknown>;
  /** Called with the outcome of a request that is still the newest issued and whose hook is still mounted. `issue` is
   *  that request's number (the one `reload()` returned for it). */
  onOutcome: (outcome: PollOutcome, issue: number) => void;
}

export interface PollControl {
  /** One request now, under the same newest-issued guard. Returns its issue number, 0 in the injected mode. */
  reload: () => number;
  /** Every request issued before this call now lands stale: a write's reply was installed and a poll must not put the
   *  old answer back. */
  supersede: () => void;
}

/** Run `handler` each time the page becomes visible; the returned function stops it. The ONLY `visibilitychange`
 *  subscription in the fleet views: `usePoll` and `useWhenVisible` both go through it. */
export function onPageVisible(handler: () => void): () => void {
  const listener = (): void => {
    if (document.visibilityState === 'visible') handler();
  };
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

/** `onPageVisible` as an effect, for a view that refreshes on return without polling (`useProjectRows`). `handler` may
 *  change identity every render; the subscription is made once and always calls the latest. */
export function useWhenVisible(handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => onPageVisible(() => latest.current()), []);
}

export function usePoll(options: PollOptions): PollControl {
  const { pollMs } = options;
  // The latest request and reader, read at call time, so a caller's inline closures never re-arm the timer.
  const latest = useRef(options);
  latest.current = options;
  const issued = useRef(0);
  const loadRef = useRef<() => number>(() => 0);

  useEffect(() => {
    if (pollMs !== null && pollMs <= 0) return undefined;   // an injected consumer never polls
    let live = true;
    const load = (): number => {
      const mine = ++issued.current;
      const land = (outcome: PollOutcome): void => {
        if (!live || mine !== issued.current) return;
        latest.current.onOutcome(outcome, mine);
      };
      void latest.current.request().then(
        (raw) => land({ ok: true, raw }),
        (err: unknown) => land({ ok: false, err }),
      );
      return mine;
    };
    loadRef.current = load;
    load();
    const timer = pollMs === null ? null : setInterval(load, pollMs);
    const stopVisible = onPageVisible(load);
    return () => {
      live = false;
      loadRef.current = () => 0;
      if (timer !== null) clearInterval(timer);
      stopVisible();
    };
  }, [pollMs]);

  const reload = useCallback((): number => loadRef.current(), []);
  const supersede = useCallback((): void => { issued.current += 1; }, []);
  return { reload, supersede };
}
