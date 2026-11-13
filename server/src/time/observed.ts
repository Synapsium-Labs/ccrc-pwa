// L1, context K (the clock kernel): observed time, the one accumulator (Overlord spec §11.5, "Two kinds of timer").
// A timer whose expiry PERMITS something (the renewal hold-off, a generation's least age, the soft renewal budget's
// window, and later the veto window, a shadow period and the breaker's waits) counts only time the server observed:
// milliseconds advanced by monotonic deltas within one process, never across a gap. It is never a second clock: it
// reads none. The caller passes `clock.mono()` and its process id, and stores the stamp in a column of the row whose
// timer it bounds.

/** A stored stamp: `ms` observed so far, anchored at the `mono` reading of process `proc`. */
export interface Observed { readonly ms: number; readonly mono: number; readonly proc: string }

/** Advance by the monotonic delta when `proc` is this stamp's process and `mono` did not go back; otherwise (a new
 *  process, a mono reading that went backwards or is not a number) re-anchor on the reading with no advance. `null`
 *  starts at 0. So `ms` never decreases and never exceeds the sum of the in-process forward deltas. */
export function observeTime(prev: Observed | null, mono: number, proc: string): Observed {
  if (prev === null) return { ms: 0, mono, proc };
  if (prev.proc === proc && mono >= prev.mono) return { ms: prev.ms + (mono - prev.mono), mono, proc };
  return { ms: prev.ms, mono, proc };
}

/** The milliseconds observed between two stamps of one accumulator, never below 0. */
export function observedSince(start: Observed, now: Observed): number {
  return Math.max(0, now.ms - start.ms);
}
