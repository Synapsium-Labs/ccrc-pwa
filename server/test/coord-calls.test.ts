// D-8126 (coordinator-autonomy-default plan, Task A3-1): the call record's pure core. One `it` per rule.
import { describe, it, expect } from 'vitest';
import {
  BLOCK_CONDITION_TTL_MS, CALL_OPTIONS_MAX, CALL_OPTION_MAX, CALL_SEEN_WINDOW_MS, CALL_TEXT_MAX, CALL_WHY_MAX,
  blockExpiresAt, callBodyOf, callClearedAt, callDecision, callIsForOperator, isLiveBlock, parseWake, type CallRow,
} from '../src/coord/coordCalls.js';
import { CALL_CLASSES, CALL_WAKES } from '../../shared/api.js';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const big = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  class: 'big', question: 'Which store?', options: ['sqlite', 'postgres'], chosen: 'sqlite', why: 'one box, no ops', reversible: true, ...o,
});
const block = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  class: 'block', chosen: 'waiting on disk room', why: 'the volume is full', reversible: true, wakeOn: 'disk', ...o,
});
const ok = (raw: unknown) => {
  const r = callBodyOf(raw, NOW);
  if (!r.ok) throw new Error(`refused: ${r.detail}`);
  return r.call;
};
const refused = (raw: unknown): string => {
  const r = callBodyOf(raw, NOW);
  if (r.ok) throw new Error('accepted');
  return r.detail;
};
const row = (o: Partial<CallRow> = {}): CallRow => ({
  id: 1, program: 'prog-a', runId: null, madeBy: 'coord-1', class: 'big', question: 'q', options: ['a', 'b'], chosen: 'a',
  why: 'w', reversible: true, wakeOn: null, expiresAt: null, at: NOW - 1000, seenAt: null, overturnedAt: null,
  overturnNote: null, wokenAt: null, build: null, ...o,
});

describe('the wire types', () => {
  it('the classes and wakes are lists derived from their types', () => {
    expect([...CALL_CLASSES]).toEqual(['routine', 'big', 'block']);
    expect([...CALL_WAKES]).toEqual(['capacity', 'account-room', 'disk', 'memory', 'update']);
  });
});

describe('callBodyOf', () => {
  it('the limits are the plan\'s', () => {
    expect([CALL_TEXT_MAX, CALL_WHY_MAX, CALL_OPTION_MAX, CALL_OPTIONS_MAX]).toEqual([600, 300, 300, 8]);
    expect(BLOCK_CONDITION_TTL_MS).toBe(DAY);
    expect(CALL_SEEN_WINDOW_MS).toBe(7 * DAY);
  });

  it('accepts a big call and a routine call', () => {
    expect(ok(big())).toMatchObject({ class: 'big', question: 'Which store?', options: ['sqlite', 'postgres'], chosen: 'sqlite', reversible: true, runId: null, wakeOn: null });
    expect(ok(big({ class: 'routine', runId: 7 }))).toMatchObject({ class: 'routine', runId: 7 });
  });

  it('accepts a block with a condition wake and with a future time wake', () => {
    expect(ok(block())).toMatchObject({ class: 'block', question: null, options: null, chosen: 'waiting on disk room', wakeOn: 'disk' });
    expect(ok(block({ wakeOn: `time:${NOW + DAY}` })).wakeOn).toBe(`time:${NOW + DAY}`);
  });

  it('refuses a body that is not an object, and an unknown class', () => {
    expect(refused(null)).toMatch(/object/);
    expect(refused([])).toMatch(/object/);
    expect(refused(big({ class: 'huge' }))).toMatch(/class/);
    expect(refused(big({ class: undefined }))).toMatch(/class/);
  });

  it('refuses a block carrying a question or options', () => {
    expect(refused(block({ question: 'why?' }))).toMatch(/question/);
    expect(refused(block({ options: ['a', 'b'] }))).toMatch(/options/);
  });

  it('refuses a big or routine call with one option, nine options, or an over-long option', () => {
    expect(refused(big({ options: ['only'], chosen: 'only' }))).toMatch(/options/);
    const nine = Array.from({ length: 9 }, (_, i) => `o${i}`);
    expect(refused(big({ options: nine, chosen: 'o0' }))).toMatch(/options/);
    const eight = nine.slice(0, 8);
    expect(ok(big({ options: eight, chosen: 'o3' })).options).toEqual(eight);
    expect(refused(big({ options: ['a', 'x'.repeat(301)], chosen: 'a' }))).toMatch(/options/);
    expect(refused(big({ options: ['a', ''], chosen: 'a' }))).toMatch(/options/);
    expect(refused(big({ options: ['a', 7], chosen: 'a' }))).toMatch(/options/);
  });

  it('refuses a chosen that is not among the options', () => {
    expect(refused(big({ chosen: 'mysql' }))).toMatch(/chosen/);
  });

  it('refuses a big call without a question, or over 600 characters', () => {
    expect(refused(big({ question: undefined }))).toMatch(/question/);
    expect(refused(big({ question: '' }))).toMatch(/question/);
    expect(refused(big({ question: 'q'.repeat(601) }))).toMatch(/question/);
    expect(ok(big({ question: 'q '.repeat(300).trim() })).question).toHaveLength(599);
  });

  it('refuses a big call carrying wakeOn', () => {
    expect(refused(big({ wakeOn: 'disk' }))).toMatch(/wakeOn/);
  });

  it('a block needs a wakeOn that parses; a time wake in the past, now, or 8 days out is refused', () => {
    expect(refused(block({ wakeOn: undefined }))).toMatch(/wakeOn/);
    expect(refused(block({ wakeOn: 'tuesday' }))).toMatch(/wakeOn/);
    expect(refused(block({ wakeOn: `time:${NOW - 1}` }))).toMatch(/wakeOn/);
    expect(refused(block({ wakeOn: `time:${NOW}` }))).toMatch(/wakeOn/);
    expect(refused(block({ wakeOn: `time:${NOW + 8 * DAY}` }))).toMatch(/wakeOn/);
    expect(ok(block({ wakeOn: `time:${NOW + 7 * DAY}` })).wakeOn).toBe(`time:${NOW + 7 * DAY}`);
  });

  it('a block\'s chosen is 1 to 600 characters', () => {
    expect(refused(block({ chosen: '' }))).toMatch(/chosen/);
    expect(refused(block({ chosen: 'c'.repeat(601) }))).toMatch(/chosen/);
  });

  it('refuses a why that is empty, over 300 characters, or has a newline', () => {
    expect(refused(big({ why: '' }))).toMatch(/why/);
    expect(refused(big({ why: 'w'.repeat(301) }))).toMatch(/why/);
    expect(refused(big({ why: 'one\ntwo' }))).toMatch(/why/);
    expect(refused(big({ why: 'one\rtwo' }))).toMatch(/why/);
    expect(refused(big({ why: undefined }))).toMatch(/why/);
  });

  it('refuses a reversible that is not a boolean', () => {
    expect(refused(big({ reversible: 'yes' }))).toMatch(/reversible/);
    expect(refused(big({ reversible: undefined }))).toMatch(/reversible/);
    expect(ok(big({ reversible: false })).reversible).toBe(false);
  });

  it('runId is a positive safe integer or absent', () => {
    for (const bad of [0, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1, null]) expect(refused(big({ runId: bad })), String(bad)).toMatch(/runId/);
    expect(ok(big({ runId: 12 })).runId).toBe(12);
  });

  it('a why holding an sk- shaped key comes back with no 8-character slice of it', () => {
    const secret = 'sk-' + 'Zq9'.repeat(10);
    const call = ok(big({ why: `used ${secret} to check`, question: `is ${secret} ok?`, chosen: `sqlite`, options: [`sqlite`, `x ${secret}`] }));
    for (const text of [call.why, call.question ?? '', ...(call.options ?? [])]) {
      for (let i = 0; i + 8 <= secret.length; i++) expect(text.includes(secret.slice(i, i + 8))).toBe(false);
    }
  });

  it('a why that is only a key is stored as the mask, never as the key', () => {
    const secret = 'sk-' + 'Zq9'.repeat(10);
    const why = ok(big({ why: secret })).why;
    expect(why).not.toContain(secret.slice(0, 8));
    expect(why.length).toBeGreaterThan(0);
  });
});

describe('parseWake', () => {
  it('reads the five conditions and a time wake, and nothing else', () => {
    for (const w of ['capacity', 'account-room', 'disk', 'memory', 'update']) expect(parseWake(w)).toBe(w);
    expect(parseWake('time:1800000000000')).toBe('time:1800000000000');
    for (const bad of ['', 'time:', 'time:abc', 'time:-5', 'time:1.5', 'time:0', 'Disk', 'disk ']) expect(parseWake(bad), bad).toBeNull();
  });
});

describe('blockExpiresAt', () => {
  it('a time wake expires at its time; a condition wake a day after the call', () => {
    expect(blockExpiresAt('disk', 0)).toBe(86_400_000);
    expect(blockExpiresAt('update', 5)).toBe(5 + BLOCK_CONDITION_TTL_MS);
    expect(blockExpiresAt('time:123456', 5)).toBe(123456);
  });
});

describe('isLiveBlock', () => {
  const b = (o: Partial<CallRow> = {}) => row({ class: 'block', question: null, options: null, wakeOn: 'disk', expiresAt: NOW + 1000, ...o });
  it('is true for an unwoken block before its expiry', () => expect(isLiveBlock(b(), NOW)).toBe(true));
  it('is false once woken', () => expect(isLiveBlock(b({ wokenAt: NOW - 1 }), NOW)).toBe(false));
  it('is false at expiresAt and after', () => {
    expect(isLiveBlock(b({ expiresAt: NOW }), NOW)).toBe(false);
    expect(isLiveBlock(b({ expiresAt: NOW - 1 }), NOW)).toBe(false);
  });
  it('is false for a row without an expiry, and for other classes', () => {
    expect(isLiveBlock(b({ expiresAt: null }), NOW)).toBe(false);
    expect(isLiveBlock(row({ expiresAt: NOW + 1000 }), NOW)).toBe(false);
  });
});

describe('the operator\'s group', () => {
  it('callIsForOperator: a big call, not seen, not overturned, inside seven days', () => {
    expect(callIsForOperator(row(), NOW)).toBe(true);
    expect(callIsForOperator(row({ class: 'routine' }), NOW)).toBe(false);
    expect(callIsForOperator(row({ class: 'block' }), NOW)).toBe(false);
    expect(callIsForOperator(row({ seenAt: NOW - 5 }), NOW)).toBe(false);
    expect(callIsForOperator(row({ overturnedAt: NOW - 5 }), NOW)).toBe(false);
    expect(callIsForOperator(row({ at: NOW - CALL_SEEN_WINDOW_MS }), NOW)).toBe(false);
    expect(callIsForOperator(row({ at: NOW - CALL_SEEN_WINDOW_MS + 1 }), NOW)).toBe(true);
  });

  it('callClearedAt: null while in the group; else the earliest of seen, overturned and aged', () => {
    expect(callClearedAt(row(), NOW)).toBeNull();
    expect(callClearedAt(row({ seenAt: NOW - 50 }), NOW)).toBe(NOW - 50);
    expect(callClearedAt(row({ seenAt: NOW - 50, overturnedAt: NOW - 90 }), NOW)).toBe(NOW - 90);
    const at = NOW - CALL_SEEN_WINDOW_MS - 10;
    expect(callClearedAt(row({ at }), NOW)).toBe(at + CALL_SEEN_WINDOW_MS);
    expect(callClearedAt(row({ at, seenAt: at + 5 }), NOW)).toBe(at + 5);
  });

  it('callClearedAt is null for a routine or block row (never in the group)', () => {
    expect(callClearedAt(row({ class: 'routine' }), NOW)).toBeNull();
    expect(callClearedAt(row({ class: 'block' }), NOW)).toBeNull();
  });
});

describe('callDecision', () => {
  it('names a big call only', () => {
    expect(callDecision(row({ at: 42 }))).toEqual({ kind: 'big-call', at: 42 });
    expect(callDecision(row({ class: 'routine' }))).toBeNull();
    expect(callDecision(row({ class: 'block' }))).toBeNull();
  });
});
