// D-8277: the suite's one clock scale for a slow environment. Every time budget a server test sets for itself — the
// suite's `testTimeout`/`hookTimeout` (`vitest.config.ts`), a case's explicit timeout, a `spawnSync` bound on a child,
// a wait loop's deadline, an upper bound on how long a run took — is written for an ordinary runner. Under the
// dependency map's trace (`.github/ci/trace-run.mjs`: `strace -f`, which follows every fork the bash-heavy suites
// make, two traced files at once) the same work runs several times slower, a budget written for the untraced run
// fails, and the traced file is recorded `unknown` with nothing read: the map then selects it on every change.
//
// `CCRC_TIME_SCALE` is that slowdown, as one number at or above 1. trace-run sets it for every traced vitest; nothing
// else does, so an ordinary run reads 1 and every budget is exactly its literal. A budget is scaled at the place it
// is written (`scaled(60_000)`), never by loosening it there, so the untraced run keeps the budget it always had.
// A value below 1, or one that is not a number, would shorten budgets or silently read as 1: both are refused.
//
// Imported by `vitest.config.ts`, so this module imports nothing from vitest and nothing that does.
export const TIME_SCALE_ENV = 'CCRC_TIME_SCALE';

/** The scale `raw` spells: 1 when unset or empty, else a finite number at or above 1. Throws on anything else. */
export function parseTimeScale(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${TIME_SCALE_ENV}=${JSON.stringify(raw)}: a time scale is a finite number at or above 1`);
  }
  return n;
}

/** `ms` multiplied by `scale`, rounded up. */
export const scaledBy = (scale: number) => (ms: number): number => Math.ceil(ms * scale);
/** Whole seconds, for a bound a shell takes (`perl alarm`, `timeout`): `s` multiplied by `scale`, rounded up. */
export const scaledSecondsBy = (scale: number) => (s: number): number => Math.ceil(s * scale);

/** This process's scale, read once from its environment. */
export const TIME_SCALE = parseTimeScale(process.env[TIME_SCALE_ENV]);
/** A budget in milliseconds, scaled for this environment. */
export const scaled = scaledBy(TIME_SCALE);
/** A budget in whole seconds, scaled for this environment. */
export const scaledSeconds = scaledSecondsBy(TIME_SCALE);
