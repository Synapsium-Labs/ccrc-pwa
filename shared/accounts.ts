/**
 * The Accounts screen's pure policy (spec 2026-10-18 accounts-connect; plan File structure). L0: imports
 * nothing. Task A5 opens this file with the step-up freshness window (D-5512, D-5618); the state words, the kind
 * codes, the URL shape checks and the ceiling arithmetic join it in their own tasks (A2, A12, A21, A29, A32).
 */

/**
 * How long a step-up stays fresh on the session that took it: FIVE MINUTES (D-5512, spec §3.2). Every act
 * that puts, replaces or deletes a credential needs a step-up from the last five minutes on the same session.
 * The one home of the number: `requireRecentAssertion`'s default and `stepUpFreshUntil` both read it.
 */
export const STEP_UP_FRESH_MS = 5 * 60 * 1000;

/**
 * The first instant a step-up taken at `assertedAt` is no longer fresh: `assertedAt + windowMs`. The window
 * is the last `windowMs` milliseconds, so this instant is OUTSIDE it, and `GET /api/accounts`'s
 * `connect.stepUpFreshUntil` (A12) carries exactly this value.
 */
export function stepUpFreshUntil(assertedAt: number, windowMs: number = STEP_UP_FRESH_MS): number {
  return assertedAt + windowMs;
}

/**
 * Is a step-up taken at `assertedAt` still fresh at `now`? `undefined` is "this session never stepped up",
 * which is never fresh. A stamp in the future (the clock stepped back) is not fresh either: freshness is
 * measured, never assumed.
 */
export function isStepUpFresh(assertedAt: number | undefined, now: number, windowMs: number = STEP_UP_FRESH_MS): boolean {
  if (assertedAt === undefined || assertedAt > now) return false;
  return now < stepUpFreshUntil(assertedAt, windowMs);
}
