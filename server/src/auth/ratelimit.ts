/**
 * The login rate limiter — a COARSE GLOBAL brake, not the security boundary.
 *
 * This box is single-operator, single-passphrase (secret.ts). The window below
 * is tracked GLOBALLY, deliberately not per-IP: per-IP is spoofable outright (an
 * attacker rotates source port or a forged `X-Forwarded-For`), and it collapses
 * to a single bucket anyway the moment this box sits behind a reverse proxy
 * (`tailscale serve`) — every request arrives from the same peer address
 * regardless of who the real client is. A global window is the only shape that
 * is honest about what this box can actually observe, and it is enough to stop
 * what it needs to stop: trivial hammering (a script firing guesses in a loop)
 * and the log spam that comes with it.
 *
 * What this does NOT stop: a patient attacker willing to wait out the window,
 * or one willing to lock the legitimate operator out (a global window is a
 * denial-of-service against exactly one person on a single-operator box — an
 * accepted tradeoff, not an oversight). The REAL brute-force defense is
 * secret.ts's scrypt KDF (N=65536): every guess costs real CPU/memory, so an
 * attacker who simply waits out this window is still throttled by the KDF's
 * own cost. This file is a cheap first gate in front of that cost, not a
 * replacement for it.
 *
 * Counts FAILURES, not attempts, deliberately: a fat-finger-then-correct login
 * (the operator mistypes, notices, retries) must not spend the same budget an
 * attacker's guesses would. `recordSuccess` resets the window outright — a
 * correct passphrase is proof this was the operator, not an attack in
 * progress.
 */

/** One global fixed window's worth of failure bookkeeping. `windowStart` is
 *  the epoch-ms this window began; `count` is failures seen since then. */
export interface RateState {
  windowStart: number;
  count: number;
}

/** The window's length, ms. Single source — do not re-type this value. */
export const WINDOW_MS = 60_000;

/** Failures allowed inside one window before `loginVerdict` locks. Single
 *  source — do not re-type this value. */
export const MAX_FAILURES = 8;

/** What `loginVerdict` answers: whether login may proceed, the (possibly
 *  rolled) state the caller should persist, and — only when locked — the ms
 *  until the window ends. */
export interface RateLimitVerdict {
  ok: boolean;
  state: RateState;
  retryAfter?: number;
}

/** Roll `state` onto a fresh window iff the current one has expired. Pure —
 *  no clock read; `now` is always the caller's value. */
function rolled(state: RateState, now: number): RateState {
  if (now - state.windowStart >= WINDOW_MS) {
    return { windowStart: now, count: 0 };
  }
  return state;
}

/**
 * The pure gate check: does `state`, as of `now`, permit a login attempt?
 *
 * Rolls an expired window before reading it (so a caller who only ever calls
 * `check()` — never `fail()` — still sees the window reset in time), but NEVER
 * increments: reading the verdict is side-effect-free on the failure count.
 * `retryAfter` (ms until the window ends) is present iff `ok` is false.
 */
export function loginVerdict(state: RateState, now: number): RateLimitVerdict {
  const next = rolled(state, now);
  if (next.count < MAX_FAILURES) return { ok: true, state: next };
  return { ok: false, state: next, retryAfter: next.windowStart + WINDOW_MS - now };
}

/** Pure reducer: roll an expired window, then count one failure. This is the
 *  ONLY place a failure is counted — `loginVerdict` never increments. */
export function recordFailure(state: RateState, now: number): RateState {
  const next = rolled(state, now);
  return { windowStart: next.windowStart, count: next.count + 1 };
}

/** Pure reducer: a successful login clears the failure counter outright and
 *  starts a fresh window at `now`. This is "reset on success" — the reason
 *  failures, not attempts, are what this file counts. */
export function recordSuccess(_state: RateState, now: number): RateState {
  return { windowStart: now, count: 0 };
}

/**
 * The ONE impure surface in this file: a per-process, in-memory holder of a
 * single global `RateState`, mirroring fleet.ts's `now = Date.now()`
 * default-parameter idiom (a default parameter is the sole place a clock
 * default lives; everything it calls stays clock-free and takes `now`
 * explicitly). Lost on restart — acceptable, since the scrypt KDF, not this
 * window, is the actual brake.
 */
export class LoginRateLimiter {
  private state: RateState;

  constructor(now = Date.now()) {
    this.state = { windowStart: now, count: 0 };
  }

  /** Persists the (possibly rolled) state and answers whether login may
   *  proceed right now. */
  check(now = Date.now()): { ok: boolean; retryAfter?: number } {
    const verdict = loginVerdict(this.state, now);
    this.state = verdict.state;
    return verdict.retryAfter === undefined
      ? { ok: verdict.ok }
      : { ok: verdict.ok, retryAfter: verdict.retryAfter };
  }

  /** Records one failed login attempt against the window. */
  fail(now = Date.now()): void {
    this.state = recordFailure(this.state, now);
  }

  /** Records a successful login — clears the counter. */
  succeed(now = Date.now()): void {
    this.state = recordSuccess(this.state, now);
  }
}
