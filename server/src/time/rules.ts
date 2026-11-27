// L1 policy: the clock kernel's rules for time and chance (Overlord spec §11.5). Context K. Every bound is named once
// here, and the system adapters (`./system.ts`) and the test fake (`server/test/fakeTime.ts`) both call these checks
// rather than keep a copy (D-8223). Pure: it imports nothing and reads no clock.

/** Node clamps a longer setTimeout delay to 1 ms, so a longer one is refused, never shortened. */
export const TIMER_MAX_MS = 2_147_483_647;
/** The fewest bytes `Entropy.hex` will draw: a secret is never weaker than 128 bits. */
export const ENTROPY_MIN_BYTES = 16;
export const ENTROPY_MAX_BYTES = 1024;
/** `Entropy.below`'s largest n, so a seed is a full 32-bit draw. */
export const ENTROPY_MAX_BOUND = 2 ** 32;

/** Answers `ms`, or throws RangeError unless it is finite and 0 <= ms <= TIMER_MAX_MS. */
export function checkDelayMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`Scheduler.after: ${ms} ms is not a finite delay of 0 or more`);
  if (ms > TIMER_MAX_MS) throw new RangeError(`Scheduler.after: ${ms} ms is over TIMER_MAX_MS (${TIMER_MAX_MS})`);
  return ms;
}

/** Answers `n`, or throws RangeError unless it is an integer in [ENTROPY_MIN_BYTES, ENTROPY_MAX_BYTES]. */
export function checkEntropyBytes(n: number): number {
  if (!Number.isInteger(n) || n < ENTROPY_MIN_BYTES || n > ENTROPY_MAX_BYTES) {
    throw new RangeError(`Entropy.hex: ${n} bytes is not an integer in [ENTROPY_MIN_BYTES (${ENTROPY_MIN_BYTES}), `
      + `ENTROPY_MAX_BYTES (${ENTROPY_MAX_BYTES})]`);
  }
  return n;
}

/** Answers `n`, or throws RangeError unless it is an integer in [1, ENTROPY_MAX_BOUND]. */
export function checkEntropyBound(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > ENTROPY_MAX_BOUND) {
    throw new RangeError(`Entropy.below: ${n} is not an integer in [1, ENTROPY_MAX_BOUND (${ENTROPY_MAX_BOUND})]`);
  }
  return n;
}

/** §11.5: a wall reading earlier than the last stored time is treated as that time. `lastStoredMs` null: nothing is
 *  stored yet, so the reading stands. For timers that fail towards the operator only. */
export function wallNotBefore(readingMs: number, lastStoredMs: number | null): number {
  return lastStoredMs === null ? readingMs : Math.max(readingMs, lastStoredMs);
}

/** The ISO week a wall time falls in, in UTC (slug quiz-week-is-utc: the Settings time zone ships in W1), as `YYYY-Www`, and
 *  the ms of its Monday 00:00 UTC. One week for every lane keyed on it (the replay quiz, the label queue). */
export function utcIsoWeek(now: number): { readonly key: string; readonly start: number } {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (d.getUTCDay() + 6) % 7;                      // Monday 0 .. Sunday 6
  const start = midnight - dow * 86_400_000;
  const thursday = new Date(start + 3 * 86_400_000);        // the ISO year is the year of the week's Thursday
  const year = thursday.getUTCFullYear();
  const dayOfYear = (thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000;   // whole days: both are UTC midnights
  const week = 1 + Math.floor(dayOfYear / 7);
  return { key: `${year}-W${String(week).padStart(2, '0')}`, start };
}
