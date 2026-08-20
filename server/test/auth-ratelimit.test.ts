// ratelimit.ts is the login rate limiter — a coarse GLOBAL brake, not the real
// defense (that's Task 2's scrypt KDF). These tests pin the pure fixed-window
// policy: under/at/over the limit, window rollover, and the "reset on success"
// behavior that is the whole reason failures are counted instead of attempts —
// a fat-finger-then-correct login must not spend the same budget an attacker's
// guesses would. `now` is always passed explicitly; one test asserts the pure
// functions never fall back to the real clock.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  loginVerdict, recordFailure, recordSuccess, LoginRateLimiter,
  WINDOW_MS, MAX_FAILURES,
} from '../src/auth/ratelimit.js';
import type { RateState } from '../src/auth/ratelimit.js';

afterEach(() => vi.restoreAllMocks());

function freshState(now: number): RateState {
  return { windowStart: now, count: 0 };
}

describe('pure functions never read the real clock', () => {
  it('loginVerdict/recordFailure/recordSuccess never call Date.now()', () => {
    const spy = vi.spyOn(Date, 'now');
    const state = freshState(1_000_000);
    loginVerdict(state, 1_000_500);
    recordFailure(state, 1_000_500);
    recordSuccess(state, 1_000_500);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('under the limit', () => {
  it('MAX_FAILURES - 1 failures still reads ok, with no retryAfter, and does not mutate the state it read', () => {
    const now = 1_000_000;
    let state = freshState(now);
    for (let i = 0; i < MAX_FAILURES - 1; i++) state = recordFailure(state, now);
    const verdict = loginVerdict(state, now);
    expect(verdict.ok).toBe(true);
    expect(verdict.retryAfter).toBeUndefined();
    // Read-purity (I-2): an `ok: true` verdict inside an UNROLLED window must
    // hand back the exact state it was given — not a copy with a creeping
    // increment stashed in it. `.toBe` (identity), not just `.toEqual`: the
    // correct implementation returns the same object reference here, since
    // there is nothing to roll, and a mutant that fabricates a new object
    // with `count + 1` would still pass a weaker `.toEqual` if the count
    // stayed under MAX_FAILURES, but fails identity outright.
    expect(verdict.state).toBe(state);
    expect(verdict.state).toEqual({ windowStart: now, count: MAX_FAILURES - 1 });
  });
});

describe('at and over the limit', () => {
  it('exactly MAX_FAILURES failures locks, with a correct retryAfter', () => {
    const start = 1_000_000;
    let state = freshState(start);
    for (let i = 0; i < MAX_FAILURES; i++) state = recordFailure(state, start);

    const laterNow = start + 10_000;
    const verdict = loginVerdict(state, laterNow);
    expect(verdict.ok).toBe(false);
    expect(verdict.retryAfter).toBe(state.windowStart + WINDOW_MS - laterNow);
  });

  it('failures past MAX_FAILURES stay locked', () => {
    const now = 1_000_000;
    let state = freshState(now);
    for (let i = 0; i < MAX_FAILURES + 3; i++) state = recordFailure(state, now);
    expect(loginVerdict(state, now).ok).toBe(false);
  });

  it('loginVerdict never increments — reading the verdict twice does not itself lock', () => {
    const now = 1_000_000;
    let state = freshState(now);
    for (let i = 0; i < MAX_FAILURES - 1; i++) state = recordFailure(state, now);
    loginVerdict(state, now);
    loginVerdict(state, now);
    expect(loginVerdict(state, now).ok).toBe(true);
  });

  it('retryAfter has an exact hard-coded value (M-2 — not just the source\'s own formula echoed back)', () => {
    const start = 1_000_000;
    let state = freshState(start);
    for (let i = 0; i < MAX_FAILURES; i++) state = recordFailure(state, start);
    // Locked one ms into the window: 60_000ms window, 1ms elapsed → 59_999ms left.
    const oneMsIn = start + 1;
    const verdict = loginVerdict(state, oneMsIn);
    expect(verdict.ok).toBe(false);
    expect(verdict.retryAfter).toBe(59_999);
    expect(verdict.retryAfter).toBe(WINDOW_MS - 1);
  });
});

describe('window rollover resets the count', () => {
  it('at EXACTLY now = windowStart + WINDOW_MS the window is already fresh (I-1 — pins >=, not >)', () => {
    const start = 1_000_000;
    let state = freshState(start);
    for (let i = 0; i < MAX_FAILURES; i++) state = recordFailure(state, start);
    expect(loginVerdict(state, start).ok).toBe(false);

    const boundaryNow = start + WINDOW_MS;
    const verdict = loginVerdict(state, boundaryNow);
    expect(verdict.ok).toBe(true);
    expect(verdict.state).toEqual({ windowStart: boundaryNow, count: 0 });
  });

  it('a locked state read past WINDOW_MS comes back ok, on a fresh window', () => {
    const start = 1_000_000;
    let state = freshState(start);
    for (let i = 0; i < MAX_FAILURES; i++) state = recordFailure(state, start);
    expect(loginVerdict(state, start).ok).toBe(false);

    const rolledNow = start + WINDOW_MS + 1;
    const verdict = loginVerdict(state, rolledNow);
    expect(verdict.ok).toBe(true);
    expect(verdict.state).toEqual({ windowStart: rolledNow, count: 0 });
  });

  it('recordFailure itself rolls an expired window before counting the new failure', () => {
    const start = 1_000_000;
    let state = freshState(start);
    for (let i = 0; i < MAX_FAILURES; i++) state = recordFailure(state, start);

    const rolledNow = start + WINDOW_MS + 1;
    const next = recordFailure(state, rolledNow);
    expect(next).toEqual({ windowStart: rolledNow, count: 1 });
  });
});

describe('success resets the count — the fat-finger-then-succeed case', () => {
  it('N-1 failures then a success clears the counter, so failures are allowed again', () => {
    const now = 1_000_000;
    let state = freshState(now);
    for (let i = 0; i < MAX_FAILURES - 1; i++) state = recordFailure(state, now);
    expect(loginVerdict(state, now).ok).toBe(true);

    state = recordSuccess(state, now);
    expect(state).toEqual({ windowStart: now, count: 0 });

    // The budget is back: another MAX_FAILURES - 1 failures still reads ok...
    for (let i = 0; i < MAX_FAILURES - 1; i++) state = recordFailure(state, now);
    expect(loginVerdict(state, now).ok).toBe(true);
    // ...but a full MAX_FAILURES worth locks it, same as it would for a fresh attacker.
    state = recordFailure(state, now);
    expect(loginVerdict(state, now).ok).toBe(false);
  });
});

describe('LoginRateLimiter — the L4 in-memory holder', () => {
  it('check()/fail()/succeed() persist state across calls, mirroring the pure reducers', () => {
    const limiter = new LoginRateLimiter(1_000_000);
    for (let i = 0; i < MAX_FAILURES; i++) limiter.fail(1_000_000);
    expect(limiter.check(1_000_000)).toEqual({
      ok: false,
      retryAfter: 1_000_000 + WINDOW_MS - 1_000_000,
    });

    limiter.succeed(1_000_000);
    expect(limiter.check(1_000_000)).toEqual({ ok: true });
  });

  it('defaults `now` at the boundary when no argument is given', () => {
    // Only asserts the call SHAPE works with no args — the default is the
    // real clock, which is exactly why the pure functions never take one.
    const limiter = new LoginRateLimiter();
    expect(() => limiter.check()).not.toThrow();
    expect(() => limiter.fail()).not.toThrow();
    expect(() => limiter.succeed()).not.toThrow();
  });
});

// ── reserve(): the concurrency half of the budget (Task 5 review, Important 1) ──
//
// `check()` is a READ of a counter that only moves when a failure is RECORDED —
// which happens ~100 ms after admission, once the scrypt derivation resolves. So
// a budget spent only by `fail()` bounds a sequential attacker and nothing else:
// N requests fired at once all read the same zero, all pass, and all queue a
// 64 MiB derivation onto libuv's 4-slot threadpool. `reserve()` takes the slot at
// ADMISSION, against the same ceiling, which is what makes the brake bound
// concurrency rather than history.
describe('reserve — a slot taken at admission, not at completion', () => {
  it('admits at most MAX_FAILURES at once, with nothing recorded as a failure', () => {
    const limiter = new LoginRateLimiter(1_000_000);
    const held = [];
    for (let i = 0; i < MAX_FAILURES; i++) {
      const slot = limiter.reserve(1_000_000);
      expect(slot.ok, `admission ${i + 1}`).toBe(true);
      if (slot.ok) held.push(slot);
    }
    expect(limiter.pending).toBe(MAX_FAILURES);
    // The budget is spent by admissions alone — no failure has been recorded.
    const over = limiter.reserve(1_000_000);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.retryAfter).toBe(WINDOW_MS);
    // …and one release is one slot back, immediately.
    held[0]!.release();
    expect(limiter.pending).toBe(MAX_FAILURES - 1);
    expect(limiter.reserve(1_000_000).ok).toBe(true);
  });

  it('shares ONE ceiling with the recorded failures', () => {
    const limiter = new LoginRateLimiter(1_000_000);
    for (let i = 0; i < MAX_FAILURES - 1; i++) limiter.fail(1_000_000);
    // One of the budget left: one admission, then locked.
    const first = limiter.reserve(1_000_000);
    expect(first.ok).toBe(true);
    expect(limiter.reserve(1_000_000).ok).toBe(false);
  });

  it('release is IDEMPOTENT — a double release cannot inflate the budget', () => {
    // The failure this closes is quieter than a leak and worse: a slot given back
    // twice makes `inFlight` go negative, and a negative in-flight count raises
    // the effective ceiling for everyone.
    const limiter = new LoginRateLimiter(1_000_000);
    const slot = limiter.reserve(1_000_000);
    expect(slot.ok).toBe(true);
    if (!slot.ok) return;
    slot.release();
    slot.release();
    slot.release();
    expect(limiter.pending).toBe(0);
  });

  it('a leaked slot is PERMANENT — which is why the route releases in a `finally`', () => {
    // Not a bug being asserted: the honest cost of the design, written down. A
    // slot has no timeout, so MAX_FAILURES of them brick login until restart, and
    // that is exactly why `server.ts`'s login route wraps its whole body.
    const limiter = new LoginRateLimiter(1_000_000);
    for (let i = 0; i < MAX_FAILURES; i++) limiter.reserve(1_000_000);
    expect(limiter.reserve(1_000_000).ok).toBe(false);
    // Even a whole window later: the window rolls, the failures reset — and the
    // in-flight count does not, because nothing ever gave those slots back.
    expect(limiter.reserve(1_000_000 + WINDOW_MS + 1).ok).toBe(false);
  });

  it('a rolled window frees the FAILURE half of the budget as it always did', () => {
    const limiter = new LoginRateLimiter(1_000_000);
    for (let i = 0; i < MAX_FAILURES; i++) limiter.fail(1_000_000);
    expect(limiter.reserve(1_000_000).ok).toBe(false);
    expect(limiter.reserve(1_000_000 + WINDOW_MS).ok).toBe(true);
  });

  it('check() sees the in-flight slots too, so `mode` cannot say `passphrase` while login is closed', () => {
    const limiter = new LoginRateLimiter(1_000_000);
    for (let i = 0; i < MAX_FAILURES; i++) limiter.reserve(1_000_000);
    expect(limiter.check(1_000_000).ok).toBe(false);
  });
});
