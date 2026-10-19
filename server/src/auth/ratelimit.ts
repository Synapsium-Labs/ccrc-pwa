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

/**
 * The PASSKEY assertion budget — deliberately much looser than
 * {@link MAX_FAILURES}, and the reasoning is worth stating because "looser"
 * looks like weaker.
 *
 * THE PASSPHRASE BUDGET IS 8 BECAUSE OF WHAT ONE ATTEMPT COSTS AND WHAT IT
 * BUYS. A passphrase is a low-entropy secret a human chose, so guesses are worth
 * making; and each guess costs ~100 ms of scrypt on a 4-slot libuv threadpool, so
 * eight concurrent ones starve the whole server. The number is bounding a
 * BRUTE-FORCE SEARCH and a DENIAL OF SERVICE at once, and it can be small
 * because a human types one passphrase.
 *
 * NEITHER PRESSURE EXISTS HERE.
 *  - THERE IS NOTHING TO GUESS. Forging an assertion requires the P-256 private
 *    key, which never leaves the authenticator. That is a ~2^128 search, not a
 *    dictionary; a rate limit does not meaningfully change it, and there is no
 *    "wrong passkey" the way there is a wrong passphrase.
 *  - AN ATTEMPT IS ~50 MICROSECONDS. An ECDSA verify is synchronous CPU, three
 *    orders of magnitude cheaper than scrypt, and it never touches the
 *    threadpool — so a flood cannot starve `fs/promises` the way a passphrase
 *    flood could. (This is exactly why the passkey routes still take a slot at
 *    admission: cheap is not free, and the concurrency half of the budget is
 *    what makes a flood a 429 instead of a queue.)
 *
 * SO WHAT IS THIS BRAKE FOR? Two things, and both are satisfied by a loose
 * number: log-flood control (every refusal writes a journal line naming the
 * reason), and a bound on how fast an unauthenticated caller can churn the
 * challenge store (`webauthn.ts`'s `MAX_LIVE_CHALLENGES`, which evicts rather
 * than refuses precisely so this cannot lock the operator out).
 *
 * THE SECOND OF THOSE IS ONLY TRUE BECAUSE ISSUANCE SPENDS THE BUDGET. Both
 * halves of the ceremony charge against this window — `assert/finish` through
 * {@link LoginRateLimiter.fail} on a refusal, and `assert/start` through
 * {@link LoginRateLimiter.spend} on every challenge minted. Until D-131 only the
 * first did, which made the sentence above false in the exact case it was
 * written for: a start-only flood cost nothing and evicted the operator's live
 * challenge for free. A brake that cannot fire on the path that spends the
 * resource is not a brake.
 *
 * 60 PER MINUTE IS ONE PER SECOND — two orders of magnitude above any human
 * tapping a passkey button (a ceremony takes seconds, and three retries is a bad
 * day), and low enough that neither the journal nor the challenge map can be
 * driven anywhere interesting. A TIGHTER number would be actively worse: the
 * window is GLOBAL (see the module docstring), so on a single-operator box a
 * small passkey budget is a denial of service against the one person who is
 * supposed to get in, bought with no security at all.
 */
export const PASSKEY_MAX_FAILURES = 60;

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

/** ms from `now` until `state`'s window ends. The ONE place this arithmetic
 *  lives — `loginVerdict` and `LoginRateLimiter.reserve` both answer with it,
 *  and a second copy is how the two would come to disagree. */
function msUntilWindowEnd(state: RateState, now: number): number {
  return state.windowStart + WINDOW_MS - now;
}

/**
 * The pure gate check: does `state`, as of `now`, permit a login attempt?
 *
 * Rolls an expired window before reading it (so a caller who only ever calls
 * `check()` — never `fail()` — still sees the window reset in time), but NEVER
 * increments: reading the verdict is side-effect-free on the failure count.
 * `retryAfter` (ms until the window ends) is present iff `ok` is false.
 *
 * `inFlight` — logins that have been ADMITTED and are still running — shares the
 * SAME `MAX_FAILURES` ceiling as the recorded failures, and that is the whole
 * point of it (review Important 1). Counting only what has already been RECORDED
 * bounds a sequential attacker and nothing else: a failure is recorded after the
 * ~100 ms scrypt derivation resolves, so N requests fired at once all read
 * `count === 0`, all pass, and all queue a 64 MiB derivation onto libuv's 4-slot
 * threadpool — starving every `fs/promises` caller in the server (fleet
 * assembly, clip reads, the session store's own flush) for as long as the flood
 * lasts. A budget that counts admissions as well as failures is what makes the
 * brake bound CONCURRENCY, not merely history. Defaulted to 0 so a caller that
 * only asks the policy question ("is the window closed?") is unchanged.
 */
export function loginVerdict(state: RateState, now: number, inFlight = 0, max = MAX_FAILURES): RateLimitVerdict {
  const next = rolled(state, now);
  if (next.count + inFlight < max) return { ok: true, state: next };
  return { ok: false, state: next, retryAfter: msUntilWindowEnd(next, now) };
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
  /** Logins ADMITTED and not yet finished — the concurrency half of the budget.
   *  Held here rather than in `RateState` because it is not policy: it is a
   *  count of live callers, meaningless to persist and meaningless to a pure
   *  reducer. `loginVerdict` takes it as an argument for exactly that reason. */
  private inFlight = 0;

  /**
   * `max` is the ceiling this instance spends against — {@link MAX_FAILURES} by
   * default (the passphrase door), {@link PASSKEY_MAX_FAILURES} for the passkey
   * lane, which is a different budget for reasons that constant sets out.
   *
   * A PARAMETER, NOT A SECOND CLASS. The window mechanics — rolling, the shared
   * failure/in-flight budget, the idempotent release — are subtle enough that a
   * copy of them under another name is how the two would come to disagree in a
   * way no test compares. One reducer, two ceilings.
   *
   * Each instance carries its OWN `RateState`, so a passkey flood cannot spend
   * the passphrase window (which would let an attacker lock the operator out of
   * the door that actually works) and a wrong passphrase cannot spend the
   * passkey one.
   */
  constructor(now = Date.now(), private readonly max = MAX_FAILURES) {
    this.state = { windowStart: now, count: 0 };
  }

  /** Persists the (possibly rolled) state and answers whether login may
   *  proceed right now. A READ — it neither counts a failure nor takes a slot;
   *  {@link reserve} is the one that admits. */
  check(now = Date.now()): { ok: boolean; retryAfter?: number } {
    const verdict = loginVerdict(this.state, now, this.inFlight, this.max);
    this.state = verdict.state;
    return verdict.retryAfter === undefined
      ? { ok: verdict.ok }
      : { ok: verdict.ok, retryAfter: verdict.retryAfter };
  }

  /**
   * ADMIT one login, taking a slot against the shared budget — the call the
   * route must make, in place of {@link check}, before it spends any scrypt.
   *
   * The difference from `check()` is the whole fix for review Important 1:
   * `check()` READS a count that only moves ~100 ms later, when the derivation
   * resolves and `fail()` runs, so it bounds a sequential attacker and nothing
   * else. `reserve()` takes the slot AT ADMISSION, so N requests fired at once
   * see the budget shrink as they are let in, and only `MAX_FAILURES` scrypt
   * derivations can ever be running at once.
   *
   * THE RELEASE MUST RUN ON EVERY EXIT PATH — success, wrong passphrase, a
   * malformed body, an unconfigured box, and a throw. A leaked slot is
   * permanent: it never times out, so `MAX_FAILURES` of them brick login until
   * the process restarts. `finally` is the only correct shape at the call site,
   * and `release` is IDEMPOTENT so a caller that also releases on an early
   * return cannot double-decrement its way to a budget that never fills.
   */
  reserve(now = Date.now()): { ok: true; release: () => void } | { ok: false; retryAfter: number } {
    const verdict = loginVerdict(this.state, now, this.inFlight, this.max);
    this.state = verdict.state;
    // Recomputed through `msUntilWindowEnd` rather than read off the optional
    // `verdict.retryAfter` with a `!`: the field is optional-shaped (Task 4's
    // tests read it off an `ok:true` verdict to assert it is absent), and one
    // shared helper is what keeps the two answers identical.
    if (!verdict.ok) return { ok: false, retryAfter: msUntilWindowEnd(verdict.state, now) };
    this.inFlight++;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.inFlight--;
      },
    };
  }

  /** How many admitted logins are still running. For tests and diagnostics —
   *  no decision reads it except through `loginVerdict`'s `inFlight` argument. */
  get pending(): number {
    return this.inFlight;
  }

  /**
   * SPEND ONE UNIT of this window's budget — the primitive, under the name that
   * describes what it does rather than why a caller does it.
   *
   * It exists because the passkey lane spends budget on something that is not a
   * failure (D-131): ISSUING A CHALLENGE. `assert/start` is unauthenticated,
   * exempt, takes a bodyless POST, and consumes a bounded resource — a slot in
   * the 64-entry challenge map, which evicts OLDEST-FIRST. Until this existed the
   * route took a reservation and released it in the same tick (the handler is
   * `async` but has no `await`: `issue` and `ids()` are synchronous), and it
   * never called `fail()` — so `count + inFlight` was `0 + 0` on every request
   * and the brake could not fire on the only path that spends the resource.
   *
   * A start-only flood could therefore evict the operator's live challenge in
   * milliseconds, turning a Face ID prompt into `stale-challenge` → 401 →
   * "That passphrase didn't match", for as long as the flood ran. It did not
   * self-heal.
   */
  spend(now = Date.now()): void {
    this.state = recordFailure(this.state, now);
  }

  /** Records one FAILED login attempt against the window — the passphrase door's
   *  name for {@link spend}, where the unit spent really is a failed guess. One
   *  reducer, two names, because the two call sites mean different things and a
   *  second copy of the window arithmetic is how they would come to disagree. */
  fail(now = Date.now()): void {
    this.spend(now);
  }

  /** Records a successful login — clears the counter. */
  succeed(now = Date.now()): void {
    this.state = recordSuccess(this.state, now);
  }
}

/**
 * Failed step-ups one session may make before its step-up locks (D-5512, spec §3.2). Single source.
 *
 * FIVE, AND NOT A WINDOW. The caller already holds a live session, so this is not a login brake: it bounds a
 * stolen or left-open browser guessing the passphrase (or replaying assertions) to raise its own session's
 * freshness. A window would let that browser wait and guess again; a lock that lasts until the session ends
 * does not, and the operator's way out is the ordinary one, signing in again, which mints a new session with
 * its own budget.
 */
export const STEP_UP_MAX_FAILURES = 5;

/** What {@link StepUpRateLimiter.reserve} refuses with: the session's budget is spent (`locked`), or one of
 *  its step-ups is already running (`busy`). Two answers, two words on the wire. */
export type StepUpReserveRefusal = 'locked' | 'busy';

/**
 * THE STEP-UP BUDGET, PER SESSION (D-5512) — separate from {@link LoginRateLimiter} in state AND in shape.
 *
 * Separate state, so a failed step-up never spends the login door's window (a stolen session must not be able
 * to lock the operator out of signing in) and a login flood never spends a step-up budget. Keyed by the
 * session's `idHash`, so one session exhausting its budget locks that session only; another session keeps its
 * own. A success clears the session's failure count; it never clears a lock, which lasts until the session
 * ends (its row is gone, so its key is never presented again) or the operator signs in again (a new session,
 * a new key).
 *
 * THE CONCURRENCY HALF: one step-up in flight per session (`busy`), so a session cannot queue passphrase
 * derivations onto the threadpool, the reason `LoginRateLimiter.reserve` exists. The map holds one small entry
 * per session that has failed or is in flight; sessions are minted only through the login doors, whose own
 * limiters bound how many exist.
 *
 * In memory, like the login limiter: a restart forgets the counts, and the session store's own TTLs and the
 * scrypt cost remain.
 */
export class StepUpRateLimiter {
  private readonly bySession = new Map<string, { failures: number; locked: boolean; inFlight: boolean }>();

  constructor(private readonly max = STEP_UP_MAX_FAILURES) {}

  private entry(idHash: string): { failures: number; locked: boolean; inFlight: boolean } {
    let e = this.bySession.get(idHash);
    if (e === undefined) {
      e = { failures: 0, locked: false, inFlight: false };
      this.bySession.set(idHash, e);
    }
    return e;
  }

  /** Is this session's step-up locked? A read. */
  isLocked(idHash: string): boolean {
    return this.bySession.get(idHash)?.locked === true;
  }

  /** ADMIT one step-up for this session, or say why not. `release` must run on every exit path (a `finally`),
   *  and is idempotent. */
  reserve(idHash: string): { ok: true; release: () => void } | { ok: false; reason: StepUpReserveRefusal } {
    const e = this.entry(idHash);
    if (e.locked) return { ok: false, reason: 'locked' };
    if (e.inFlight) return { ok: false, reason: 'busy' };
    e.inFlight = true;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        e.inFlight = false;
        if (!e.locked && e.failures === 0) this.bySession.delete(idHash);
      },
    };
  }

  /** Count one failed step-up for this session. `true` exactly when this failure engaged the lock, so the
   *  caller writes the `step-up-locked` record once (A7's audit row hangs off it). */
  fail(idHash: string): boolean {
    const e = this.entry(idHash);
    if (e.locked) return false;
    e.failures += 1;
    if (e.failures >= this.max) {
      e.locked = true;
      return true;
    }
    return false;
  }

  /** A proven step-up: this session's failure count is cleared. A lock is never cleared here. */
  succeed(idHash: string): void {
    const e = this.bySession.get(idHash);
    if (e !== undefined && !e.locked) e.failures = 0;
  }
}
