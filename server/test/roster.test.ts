import { describe, it, expect } from 'vitest';
import { parseRoster, RosterError } from '../../shared/roster.js';

const one = (over: Record<string, unknown> = {}) => ({
  version: 1,
  accounts: [{
    id: 'claude', label: 'claude', configDirSuffix: '.claude',
    exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    ...over,
  }],
});

describe('parseRoster', () => {
  it('parses the shipped single-account default', () => {
    const r = parseRoster(one());
    expect(r.accounts.map((a) => a.id)).toEqual(['claude']);
    expect(r.upstreamId).toBe('claude');
    expect(r.homeAble.map((a) => a.id)).toEqual(['claude']);
    expect(r.byId.get('claude')!.configDirSuffix).toBe('.claude');
  });

  it('orders byIdLengthDesc longest-first so a prefix id never wins over a longer one', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'a', label: 'a', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'a-b-c', label: 'abc', configDirSuffix: '.abc', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
      { id: 'a-b', label: 'ab', configDirSuffix: '.ab', exec: { kind: 'generated' }, homeAble: true, hue: 'blue', telemetry: 'anthropic' },
    ] });
    expect(r.byIdLengthDesc.map((a) => a.id)).toEqual(['a-b-c', 'a-b', 'a']);
    // declaration order is preserved separately — the accounts strip depends on it
    expect(r.accounts.map((a) => a.id)).toEqual(['a', 'a-b-c', 'a-b']);
  });

  it('assigns hues by position when absent, and never leaves one unset', () => {
    const r = parseRoster({ version: 1, accounts: [
      { id: 'x', label: 'x', configDirSuffix: '.x', exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' },
      { id: 'y', label: 'y', configDirSuffix: '.y', exec: { kind: 'generated' }, homeAble: true, telemetry: 'anthropic' },
    ] });
    expect(r.accounts.map((a) => a.hue)).toEqual(['cyan', 'violet']);
  });

  it.each([
    ['unknown version', { version: 2, accounts: [] }, /version/i],
    ['no upstream', { version: 1, accounts: [{ ...one().accounts[0], exec: { kind: 'generated' } }] }, /upstream/i],
    ['two upstreams', { version: 1, accounts: [one().accounts[0], { ...one().accounts[0], id: 'other', configDirSuffix: '.other' }] }, /upstream/i],
    ['duplicate id', { version: 1, accounts: [one().accounts[0], { ...one().accounts[0], exec: { kind: 'generated' } }] }, /duplicate/i],
    ['bad id charset', one({ id: 'Claude' }), /id/i],
    ['id with whitespace', one({ id: 'my claude' }), /id/i],
    ['suffix without dot', one({ configDirSuffix: 'claude' }), /configDirSuffix/i],
    ['suffix with slash', one({ configDirSuffix: '.a/b' }), /configDirSuffix/i],
    ['suffix with dotdot', one({ configDirSuffix: '../x' }), /configDirSuffix/i],
    ['empty roster', { version: 1, accounts: [] }, /at least one/i],
  ])('refuses %s', (_name, bad, pattern) => {
    expect(() => parseRoster(bad)).toThrow(RosterError);
    try { parseRoster(bad); } catch (e) { expect((e as RosterError).message).toMatch(pattern); expect((e as RosterError).remedy).toBeTruthy(); }
  });

  it('warns but does not fail on an unknown field', () => {
    const r = parseRoster({ version: 1, accounts: [{ ...one().accounts[0], futureThing: 42 }] });
    expect(r.accounts).toHaveLength(1);
  });
});
