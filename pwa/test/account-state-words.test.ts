// The Accounts screen's one state word per lane (D-5517; spec §4.1; accounts plan Task A12). `stateWordFor` is L0
// policy in `shared/accounts.ts`: the server derives `LaneWire.state` from it, and the screens render what it
// answers. These cases pin the precedence, each source, each threshold at its edge, and the two honest non-readings.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_STATE_WORDS, CREDIT_EXPIRING_FRACTION, KIND_CODES, MINTED_KEY_EXPIRING_MS, MINTED_TOKEN_EXPIRING_MS,
  MINTED_TOKEN_LIFETIME_MS, SIGNED_IN_WITHIN_MS, LANE_IDENTITY_MAX, kindCodeOf, laneStateOf, stateWordFor,
  type AccountStateWord, type LaneState, type StateWordInput,
} from '../../shared/accounts';
import type { AccountUsage, RosterWire } from '../../shared/api';
import {
  NO_LANE_STATE_SOURCE, STATE_LAMPS, TROUBLE_WORDS, cardLines, kindChipWords, laneAnswerOf, offAlso, rollUp, troubleCopy,
  troubleFirst,
} from '../src/fleet/accountWords';

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

// D-5755 (11), D-6058 (3): any fleet-user process can write the lane-state file, so `laneStateOf` holds every field to
// its grammar and keeps only what the wire carries. These pin the grammar itself, not only the mask downstream.
describe('the lane-state file is read as untrusted (D-5755 (11), D-6058 (3))', () => {
  const AT = '2026-10-19T08:00:00Z';
  /** A key with no credential shape, assembled at run time. */
  const WHOLE_KEY = ['compat', 'q'.repeat(30), '7Hd2'].join('-');

  it('a key hint is a short prefix, an ellipsis and the last four; a whole key or a longer prefix is dropped', () => {
    expect(laneStateOf({ keyHint: 'sk-or-v1-…a3f9' })?.keyHint).toBe('sk-or-v1-…a3f9');
    for (const bad of [WHOLE_KEY, `${'a'.repeat(17)}…a3f9`, 'sk-or-v1-…a3f9x', 'sk-or-v1-...a3f9', `${WHOLE_KEY}…a3f9`, '…a3f9']) {
      expect(laneStateOf({ keyHint: bad }), bad).toEqual({});
    }
  });

  it('an identity is 1 to 120 printable characters; 121, blank, or any C0, C1, bidi or format character is dropped', () => {
    const at120 = 'a'.repeat(LANE_IDENTITY_MAX - '@example.invalid'.length) + '@example.invalid';
    expect(at120.length).toBe(120);
    expect(laneStateOf({ identity: at120 })?.identity).toBe(at120);
    expect(laneStateOf({ identity: 'someone@example.invalid' })?.identity).toBe('someone@example.invalid');
    for (const bad of [`${at120}x`, '', '   ', 'some\u0007one', 'some\u0085one', 'some\u202eone', 'some\u200bone',
      'some\u2028one', 'some\u00adone', 'some\ufeffone', 42]) {
      expect(laneStateOf({ identity: bad }), JSON.stringify(bad)).toEqual({});
    }
  });

  it('a verdict or a time off its grammar is dropped, and so is the check it belongs to', () => {
    expect(laneStateOf({ check: { verdict: 'ok', at: AT } })?.check).toEqual({ verdict: 'ok', at: Date.parse(AT) });
    for (const verdict of ['OK', 'ok; rm', '', 'a'.repeat(33), '-ok', 7]) {
      expect(laneStateOf({ check: { verdict, at: AT } }), JSON.stringify(verdict)).toEqual({});
    }
    for (const at of ['2026-10-19 08:00:00Z', '2026-10-19T08:00:00+01:00', '2026-10-19', '2026-13-45T99:99:99Z', 1_760_000_000_000]) {
      expect(laneStateOf({ check: { verdict: 'ok', at } }), JSON.stringify(at)).toEqual({});
      expect(laneStateOf({ validatedAt: at, mintedAt: at }), JSON.stringify(at)).toEqual({});
    }
  });

  it('only the fields the wire carries or the word reads survive: hashes, the identity of the fleet and unknown fields never do', () => {
    const full = laneStateOf({
      check: { verdict: 'ok', at: AT }, identity: 'someone@example.invalid', identitySource: 'stated', keyHint: 'sk-…a3f9',
      keySource: 'minted', validatedAt: AT, mintedAt: AT, keyExpiresAt: AT, seedVerifiedAt: AT, lastRunAt: AT,
      credit: { limit: 20, limit_remaining: 1.2 },
      keyHash: 'h'.repeat(64), retiredKeyHash: 'r'.repeat(64), fleetIdentity: '11111111-2222-4333-8444-555555555555',
      keyLimit: 20, limitReset: 'monthly', secret: WHOLE_KEY,
    });
    expect(Object.keys(full ?? {}).sort()).toEqual(['check', 'credit', 'identity', 'identitySource', 'keyExpiresAt', 'keyHint',
      'keySource', 'lastRunAt', 'mintedAt', 'seedVerifiedAt', 'validatedAt']);
    for (const k of ['keyHash', 'retiredKeyHash', 'fleetIdentity', 'keyLimit', 'limitReset', 'secret']) expect(full, k).not.toHaveProperty(k);
    expect(JSON.stringify(full)).not.toContain(WHOLE_KEY);
    expect(laneStateOf([])).toBeNull();
    expect(laneStateOf('{}')).toBeNull();
  });
});

// ── The words on the screen (accounts plan Task A2, D-7718; spec §4.1–§4.4) ─────────────────────────────────────────
// `stateWordFor` decides the word; `accountWords.ts` only draws an answer it was given. These pin what the Refined
// card says with it: the precedence as the card sees it, the honest absence, the two ages, the roll-up, the kind chip
// and the trouble order.
describe('the Accounts card says the one word it was given (D-7718)', () => {
  const usage = (over: Partial<AccountUsage> = {}): AccountUsage => ({
    wrapper: 'lane-a', five: 10, seven: 20, ts: Math.floor(NOW / 1000) - 300, fiveResetAt: null, sevenResetAt: null,
    fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
  });

  it('precedence: a disabled, 401 and limited lane reads Off; a 401 and limited one reads Signed out', () => {
    expect(stateWordFor(token(undefined, { disabled: true, authDead: true, five: 100 })).word).toBe('off');
    expect(stateWordFor(token(undefined, { authDead: true, five: 100 })).word).toBe('signed-out');
    expect(stateWordFor(token(undefined, { five: 100 })).word).toBe('rate-limited');
    // The card's own fallback (an answer with no lane state) keeps the same precedence: it is the same function.
    expect(laneAnswerOf(undefined, usage({ disabled: true, authDead: true, five: 100 }), undefined, NOW).word).toBe('off');
    expect(laneAnswerOf(undefined, usage({ authDead: true, five: 100 }), undefined, NOW).word).toBe('signed-out');
    // And Off still names the 401 it outranks.
    const off = laneAnswerOf(undefined, usage({ disabled: true, authDead: true }), undefined, NOW);
    expect(offAlso(off, usage({ disabled: true, authDead: true }))).toBe('also signed out (HTTP 401)');
    expect(offAlso(off, usage({ disabled: true }))).toBeNull();
  });

  it('no lane state is Not checked, never Signed in, and says no check is recorded', () => {
    const a = stateWordFor(token(undefined));
    expect(a).toEqual({ word: 'not-checked', source: 'no check recorded yet' });
    // An answer that carries no lane state at all (a dark gate, an older server) is Not checked too, and says only
    // what it knows: the file was not sent, not that no check was ever recorded.
    const b = laneAnswerOf(undefined, usage(), { provider: 'anthropic', kind: 'sign-in' }, NOW);
    expect(b.word).toBe('not-checked');
    expect(b.source).toBe(NO_LANE_STATE_SOURCE);
    // The server's answer wins whenever the lane carries one.
    const signedIn = stateWordFor(token(read(okAt(60_000))));
    expect(laneAnswerOf({ state: signedIn, ready: false }, usage(), undefined, NOW)).toBe(signedIn);
  });

  it("every word names its source; the state's age and the usage age are two fields", () => {
    const cases: StateWordInput[] = [
      token(undefined, { disabled: true }),
      token(undefined, { authDead: true }),
      token(undefined, { five: 100 }),
      token(read({ ...okAt(60_000), mintedAt: NOW - 340 * DAY })),
      token(read(okAt(60_000))),
      token({ kind: 'unreadable' }),
      token(undefined),
    ];
    const seen = cases.map((c) => stateWordFor(c));
    expect(seen.map((a) => a.word)).toEqual([...ACCOUNT_STATE_WORDS]);
    for (const a of seen) expect(a.source.trim().length, a.word).toBeGreaterThan(0);
    for (const w of ACCOUNT_STATE_WORDS) expect(STATE_LAMPS[w].word.length, w).toBeGreaterThan(0);

    // A state measured 2 h ago, a usage reading 5 m old: two lines, two instants, neither read off the other.
    const checkedAt = NOW - 2 * 3_600_000;
    const answer = stateWordFor(token(read({ check: { verdict: 'ok', at: checkedAt } })));
    const nowSec = Math.floor(NOW / 1000);
    const lines = cardLines(answer, nowSec - 300, nowSec);
    expect(lines.state).toBe('checked 2h ago');
    expect(lines.stateAt).toBe(checkedAt);
    expect(lines.usage).toBe('last reported 5m ago');
    expect(lines.usageAt).toBe((nowSec - 300) * 1000);
    expect(lines.stateAt).not.toBe(lines.usageAt);
    // No state age (a word with no instant) stays absent, never borrowed from the usage reading.
    expect(cardLines(stateWordFor(token(undefined)), nowSec - 300, nowSec).stateAt).toBeNull();
  });

  it('the roll-up omits zero clauses, and counts each word once', () => {
    expect(rollUp(['signed-in', 'signed-out', 'signed-in', 'off', 'not-checked'])).toBe('5 accounts · 1 signed out · 1 off');
    expect(rollUp(['rate-limited', 'rate-limited', 'expiring', 'inconclusive']))
      .toBe('4 accounts · 2 rate-limited · 1 expiring · 1 inconclusive');
    expect(rollUp(['signed-in'])).toBe('1 account');
    expect(rollUp([])).toBe('0 accounts');
    expect(rollUp(['signed-in', 'not-checked'])).not.toMatch(/\b0 /);
  });

  it('the kind codes are derived from `KIND_CODES`, never re-listed', () => {
    for (const [key, code] of Object.entries(KIND_CODES)) {
      const [provider, kind] = key.split('/') as [RosterWire['provider'], RosterWire['kind']];
      expect(kindChipWords({ provider, kind }), key).toBe(code.words);
    }
    expect(kindChipWords({})).toBeNull();
    expect(kindChipWords(undefined)).toBeNull();
    expect(kindCodeOf('anthropic', 'codex')).toBeNull();
    expect(kindCodeOf('__proto__', 'x')).toBeNull();
    // A source scan: no chip word, no short code, is spelled in the screen's words file.
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'accountWords.ts'), 'utf8');
    for (const code of Object.values(KIND_CODES)) {
      expect(src, code.words).not.toContain(`'${code.words}'`);
      expect(src, code.code).not.toContain(`'${code.code}'`);
    }
    expect(src).toMatch(/\bkindCodeOf\b/);
  });

  it('trouble cards lift in their order, and every other lane keeps roster order', () => {
    const words: Record<string, AccountStateWord> = {
      a: 'signed-in', b: 'inconclusive', c: 'off', d: 'rate-limited', e: 'signed-out', f: 'expiring', g: 'not-checked', h: 'signed-out',
    };
    expect(TROUBLE_WORDS).toEqual(['signed-out', 'rate-limited', 'expiring', 'inconclusive']);
    expect(troubleFirst(Object.keys(words), (id) => words[id]!)).toEqual(['e', 'h', 'd', 'f', 'b', 'a', 'c', 'g']);
  });

  it('a trouble card says what is wrong, its effect and its fix, with the fleet-host command', () => {
    const now = NOW;
    const out = troubleCopy({
      id: 'lane-b', answer: stateWordFor(token(read({ check: { verdict: 'auth-dead', at: now - 2 * 3_600_000 } }))),
      entry: { provider: 'anthropic', kind: 'sign-in' }, lane: undefined, usage: usage({ wrapper: 'lane-b' }), sessions: 3, now,
    });
    expect(out?.wrong).toBe("lane-b's sign-in was refused (HTTP 401) 2h ago.");
    expect(out?.effect).toBe('New sessions are not placed here. 3 sessions on it will fail their next turn.');
    expect(out?.commands).toEqual(['ccrc account check --id lane-b']);
    const tok = troubleCopy({
      id: 'lane-b', answer: stateWordFor(token(undefined, { authDead: true })),
      entry: { provider: 'anthropic', kind: 'token' }, lane: undefined, usage: null, sessions: 0, now,
    });
    expect(tok?.wrong).toBe("lane-b's token was refused (HTTP 401).");
    expect(tok?.effect).toBe('New sessions are not placed here.');
    expect(tok?.commands[0]).toMatch(/^ccrc account credential --id lane-b --credential - < /);
    const limited = troubleCopy({
      id: 'lane-c', answer: stateWordFor(token(undefined, { five: 100 })), entry: undefined, lane: undefined,
      usage: usage({ wrapper: 'lane-c', five: 100, fiveResetAt: Math.floor(now / 1000) + 72 * 60 }), sessions: 4, now,
    });
    expect(limited?.wrong).toBe('lane-c reached its 5-hour limit.');
    expect(limited?.effect).toBe('Resets in 1h 12m. 4 sessions on it are waiting.');
    expect(limited?.commands).toEqual(['ccrc account disable --id lane-c']);
    // Not trouble, no card body.
    expect(troubleCopy({
      id: 'lane-a', answer: stateWordFor(token(read(okAt(60_000)))), entry: undefined, lane: undefined, usage: null, sessions: 0, now,
    })).toBeNull();
  });
});
