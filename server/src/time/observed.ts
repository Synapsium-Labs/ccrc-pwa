// L1, context K (the clock kernel): observed time, the one accumulator (Overlord spec §11.5, "Two kinds of timer").
// A timer whose expiry PERMITS something (the renewal hold-off, a generation's least age, the soft renewal budget's
// window, and later the veto window, a shadow period and the breaker's waits) counts only time the server observed:
// milliseconds advanced by monotonic deltas within one process, never across a gap. It is never a second clock: it
// reads none. The caller passes `clock.mono()`, its process id and its step cap (`observedStepCapMs(its lane's
// period)`), and stores the stamp in a column of the row whose timer it bounds.
import { OBSERVED_STEP_PERIODS } from '../../../shared/continuity.js';

/** A stored stamp: `ms` observed so far, anchored at the `mono` reading of process `proc`. */
export interface Observed { readonly ms: number; readonly mono: number; readonly proc: string }

/** Why a step did not advance by its whole monotonic delta: `process`, another process (a restart); `backwards`, a mono
 *  reading that went back or is not a number; `step`, a delta past the step cap (a freeze: SIGSTOP, a paused container,
 *  a VM stall), or any delta under a cap that is not a finite positive number. `deltaMs` is the reading's monotonic
 *  delta from the stamp, `mono - prev.mono`, as read: for `step` the freeze's size, for `backwards` how far back
 *  (negative, or NaN for a reading that is not a number), and for `process` a difference of two processes' clocks,
 *  which measures nothing and is recorded as read. */
export interface ObservedGap { readonly kind: 'process' | 'backwards' | 'step'; readonly deltaMs: number }

/** One step: the new stamp, and the gap the step observed, or null. The lane records a gap as an observation. */
export interface ObservedStep { readonly at: Observed; readonly gap: ObservedGap | null }

/** `OBSERVED_STEP_PERIODS` periods of the lane that advances the stamp: the one place the step cap is computed. */
export function observedStepCapMs(lanePeriodMs: number): number {
  return OBSERVED_STEP_PERIODS * lanePeriodMs;
}

/** Advance by the monotonic delta when `proc` is this stamp's process and `mono` did not go back, by at most `capMs`
 *  (slug observed-time-caps-one-step; the coordinator's ruling F1 on review 1894: a longer delta advances by the cap,
 *  so a lane that is always late still ages, and a freeze never fires a break or a soft renewal by itself), answering
 *  a `step` gap for the rest; otherwise re-anchor on the reading with no advance. A cap that is not a finite positive
 *  number advances nothing. `null` starts at 0. So `ms` never decreases, and never exceeds the in-process forward
 *  deltas, each capped. */
export function observeTime(prev: Observed | null, mono: number, proc: string, capMs: number): ObservedStep {
  if (prev === null) return { at: { ms: 0, mono, proc }, gap: null };
  const deltaMs = mono - prev.mono;
  if (prev.proc !== proc) return { at: { ms: prev.ms, mono, proc }, gap: { kind: 'process', deltaMs } };
  if (!(mono >= prev.mono)) return { at: { ms: prev.ms, mono, proc }, gap: { kind: 'backwards', deltaMs } };
  const cap = Number.isFinite(capMs) && capMs > 0 ? capMs : 0;
  const step = Math.min(deltaMs, cap);
  return { at: { ms: prev.ms + step, mono, proc }, gap: step < deltaMs ? { kind: 'step', deltaMs } : null };
}

/** The milliseconds observed between two stamps of one accumulator, never below 0. */
export function observedSince(start: Observed, now: Observed): number {
  return Math.max(0, now.ms - start.ms);
}
