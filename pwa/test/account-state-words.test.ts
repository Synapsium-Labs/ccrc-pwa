// The Accounts screen's one state word per lane (D-5517; spec §4.1; accounts plan Task A12). `stateWordFor` is L0
// policy in `shared/accounts.ts`: the server derives `LaneWire.state` from it, and the screens render what it
// answers. These cases pin the precedence, each source, each threshold at its edge, and the two honest non-readings.
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_STATE_WORDS, CREDIT_EXPIRING_FRACTION, MINTED_KEY_EXPIRING_MS, MINTED_TOKEN_EXPIRING_MS,
  MINTED_TOKEN_LIFETIME_MS, SIGNED_IN_WITHIN_MS, stateWordFor, type LaneState, type StateWordInput,
} from '../../shared/accounts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

/** An Anthropic token lane that is not off, not 401 and not limited, with the lane state `lane`. */
const token = (lane: StateWordInput['lane'], over: Partial<StateWordInput> = {}): StateWordInput => ({
  disabled: false, authDead: false, five: 10, seven: 20, provider: 'anthropic', kind: 'token', lane, now: NOW, ...over,
});
const read = (state: LaneState): StateWordInput['lane'] => ({ kind: 'read', state });
const okAt = (ago: number): LaneState => ({ check: { verdict: 'ok', at: NOW - ago } });
const openrouter = (state: LaneState): StateWordInput =>
  token(read(state), { provider: 'openrouter', kind: 'key' });

describe('one state word per lane (D-5517)', () => {
  it('the seven words, in their precedence', () => {
    expect(ACCOUNT_STATE_WORDS).toEqual(
      ['off', 'signed-out', 'rate-limited', 'expiring', 'signed-in', 'inconclusive', 'not-checked']);
  });

  it('an absent lane state is Not checked, never Signed in', () => {
    expect(stateWordFor(token({ kind: 'absent' })).word).toBe('not-checked');
    expect(stateWordFor(token(undefined)).word).toBe('not-checked');
    expect(stateWordFor(token({ kind: 'absent' })).source).toBe('no check recorded yet');
  });

  it('an unreadable lane state is Inconclusive with its reason', () => {
    const a = stateWordFor(token({ kind: 'unreadable' }));
    expect(a.word).toBe('inconclusive');
    expect(a.source).toBe('lane state unreadable');
  });

  it('Signed in needs a last check of ok inside 7 d', () => {
    expect(SIGNED_IN_WITHIN_MS).toBe(7 * DAY);
    const fresh = stateWordFor(token(read(okAt(4 * 60_000))));
    expect(fresh.word).toBe('signed-in');
    expect(fresh.source).toBe('checked 4m ago');
    expect(fresh.at).toBe(NOW - 4 * 60_000);
    expect(stateWordFor(token(read(okAt(7 * DAY - 1)))).word).toBe('signed-in');
    const old = stateWordFor(token(read(okAt(7 * DAY))));
    expect(old.word).toBe('not-checked');
    expect(old.source).toBe('last checked 7d ago');
    expect(stateWordFor(token(read(okAt(9 * DAY)))).source).toBe('last checked 9d ago');
  });

  it('a check that could not reach the provider is Inconclusive, and an old one is Not checked', () => {
    for (const verdict of ['unreachable', 'timeout', 'unknown']) {
      const a = stateWordFor(token(read({ check: { verdict, at: NOW - 2 * 3_600_000 } })));
      expect(a.word, verdict).toBe('inconclusive');
      expect(a.source, verdict).toContain('nothing was learned about the credential');
    }
    expect(stateWordFor(token(read({ check: { verdict: 'unreachable', at: NOW - 8 * DAY } }))).word).toBe('not-checked');
  });

  it('a 401 is Signed out, from the marker or from the last check, whatever its age', () => {
    expect(stateWordFor(token(read(okAt(60_000)), { authDead: true })).word).toBe('signed-out');
    const a = stateWordFor(token(read({ check: { verdict: 'auth-dead', at: NOW - 30 * DAY } })));
    expect(a.word).toBe('signed-out');
    expect(a.source).toBe('HTTP 401 · checked 30d ago');
  });

  it('Off outranks everything', () => {
    expect(stateWordFor(token(read(okAt(60_000)), { disabled: true, authDead: true, five: 100 })).word).toBe('off');
  });

  it('a 5h or 7d window at 100% is Rate-limited, and outranks Signed in', () => {
    expect(stateWordFor(token(read(okAt(60_000)), { five: 100 })).word).toBe('rate-limited');
    expect(stateWordFor(token(read(okAt(60_000)), { seven: 100 })).source).toBe('7d limit reached');
    expect(stateWordFor(token(read(okAt(60_000)), { five: 99.9 })).word).toBe('signed-in');
  });

  it('a pasted token is never Expiring', () => {
    // No `mintedAt`: a paste clears it (D-5517), so its age is unknown.
    expect(stateWordFor(token(read(okAt(60_000)))).word).toBe('signed-in');
  });

  it('a minted token is Expiring at mintedAt + 335 d plus 1 ms and not at 335 d minus 1 ms', () => {
    expect(MINTED_TOKEN_LIFETIME_MS).toBe(365 * DAY);
    expect(MINTED_TOKEN_EXPIRING_MS).toBe(30 * DAY);
    const at = (ago: number): StateWordInput => token(read({ ...okAt(60_000), mintedAt: NOW - ago }));
    expect(stateWordFor(at(335 * DAY + 1)).word).toBe('expiring');
    expect(stateWordFor(at(335 * DAY - 1)).word).toBe('signed-in');
    expect(stateWordFor(at(344 * DAY)).source).toBe('token minted 11 months ago · about 3 weeks left · estimated');
  });

  it('an OpenRouter key is Expiring at 10% of its limit left and not at 10.01%', () => {
    expect(CREDIT_EXPIRING_FRACTION).toBe(0.1);
    const at = (remaining: number): StateWordInput => openrouter({ ...okAt(60_000), credit: { limit: 20, remaining } });
    expect(stateWordFor(at(2)).word).toBe('expiring');
    expect(stateWordFor(at(2.002)).word).toBe('signed-in');
    expect(stateWordFor(at(1.2)).source).toBe('credit low · $1.20 of $20 left');
  });

  it('a minted key is Expiring under 14 d before keyExpiresAt and not at 14 d', () => {
    expect(MINTED_KEY_EXPIRING_MS).toBe(14 * DAY);
    const at = (left: number): StateWordInput =>
      openrouter({ ...okAt(60_000), keySource: 'minted', keyExpiresAt: NOW + left });
    expect(stateWordFor(at(14 * DAY - 1)).word).toBe('expiring');
    expect(stateWordFor(at(14 * DAY)).word).toBe('signed-in');
    expect(stateWordFor(at(9 * DAY)).source).toBe('key expires in 9 days · set when minted');
    // A key the operator pasted keeps whatever expiry its file claims to itself: only ccrc's mint sets one.
    expect(stateWordFor(openrouter({ ...okAt(60_000), keySource: 'pasted', keyExpiresAt: NOW + DAY })).word)
      .toBe('signed-in');
  });

  it('an OpenRouter key whose limit_remaining is 0 is Rate-limited, and Rate-limited outranks Expiring', () => {
    const a = stateWordFor(openrouter({
      ...okAt(60_000), credit: { limit: 20, remaining: 0 }, keySource: 'minted', keyExpiresAt: NOW + DAY,
    }));
    expect(a.word).toBe('rate-limited');
    expect(a.source).toBe('credit used up · $0.00 of $20 left');
    expect(stateWordFor(openrouter({ ...okAt(60_000), credit: { limit: 20, remaining: -1 } })).word).toBe('rate-limited');
  });

  it('a login lane and a Codex lane are never Expiring, whatever their files hold', () => {
    const everything: LaneState = {
      ...okAt(60_000), mintedAt: NOW - 360 * DAY, credit: { limit: 20, remaining: 1 },
      keySource: 'minted', keyExpiresAt: NOW + DAY,
    };
    expect(stateWordFor(token(read(everything), { kind: 'sign-in' })).word).toBe('signed-in');
    expect(stateWordFor(token(read(everything), { provider: 'openai', kind: 'codex' })).word).toBe('signed-in');
    // Nor Rate-limited by a credit their files claim.
    const spent: LaneState = { ...okAt(60_000), credit: { limit: 20, remaining: 0 } };
    expect(stateWordFor(token(read(spent), { kind: 'sign-in' })).word).toBe('signed-in');
  });

  it('a key with no limit (`limit: null`) is never credit-Expiring', () => {
    expect(stateWordFor(openrouter({ ...okAt(60_000), credit: { limit: null, remaining: null } })).word).toBe('signed-in');
    expect(stateWordFor(openrouter({ ...okAt(60_000), credit: { limit: null, remaining: 1 } })).word).toBe('signed-in');
  });
});
