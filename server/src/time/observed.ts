// L1, context K (the clock kernel): observed time, the one accumulator (Overlord spec §11.5, "Two kinds of timer").
// A timer whose expiry PERMITS something (the renewal hold-off, a generation's least age, the soft renewal budget's
// window, and later the veto window, a shadow period and the breaker's waits) counts only time the server observed:
// milliseconds advanced by monotonic deltas within one process, never across a gap. It is never a second clock: it
// reads none. The caller passes `clock.mono()`, its process id and its step cap, and stores the stamp in a column of
// the row whose timer it bounds.

/** A stored stamp: `ms` observed so far, anchored at the `mono` reading of process `proc`. */
export interface Observed { readonly ms: number; readonly mono: number; readonly proc: string }

/** Why a step did not advance by its whole monotonic delta: another process (a restart), a mono reading that went
 *  back or is not a number, or a delta past the step cap (a freeze: SIGSTOP, a paused container, a VM stall). */
export type ObservedGap = 'new-process' | 'backwards' | 'capped';

/** One step: the new stamp, and the gap the step observed, or null. The lane records a gap as an observation. */
export interface ObservedStep { readonly at: Observed; readonly gap: ObservedGap | null }

/** Advance by the monotonic delta when `proc` is this stamp's process and `mono` did not go back, by at most `capMs`
 *  (twice the advancing lane's period, `OBSERVED_STEP_CAP_MS` for the renewal lane; slug observed-time-caps-one-step),
 *  so a freeze never fires a break or a soft renewal by itself; otherwise re-anchor on the reading with no advance.
 *  `null` starts at 0. So `ms` never decreases, and never exceeds the in-process forward deltas, each capped. */
export function observeTime(prev: Observed | null, mono: number, proc: string, capMs: number): ObservedStep {
  if (prev === null) return { at: { ms: 0, mono, proc }, gap: null };
  if (prev.proc !== proc) return { at: { ms: prev.ms, mono, proc }, gap: 'new-process' };
  if (!(mono >= prev.mono)) return { at: { ms: prev.ms, mono, proc }, gap: 'backwards' };
  const delta = mono - prev.mono;
  const step = Math.min(delta, Math.max(0, capMs));
  return { at: { ms: prev.ms + step, mono, proc }, gap: step < delta ? 'capped' : null };
}

/** The milliseconds observed between two stamps of one accumulator, never below 0. */
export function observedSince(start: Observed, now: Observed): number {
  return Math.max(0, now.ms - start.ms);
}
