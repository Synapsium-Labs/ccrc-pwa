// The Settings section's state, decided from two measured reads (named workspaces S4b): the pure view, and the
// details file's parser. The routes' own behaviour is `linear-connection-routes.test.ts`.
import { describe, expect, it } from 'vitest';
import { LINEAR_VIEW_STATES, isLinearKeyShape, LINEAR_KEY_MAX_CHARS, LINEAR_KEY_MIN_CHARS } from '../../shared/linear.js';
import { parseLinearDetails } from '../src/linear/connection.js';
import { checkOutcomeOf, linearConnectionView } from '../src/linear/view.js';

const DIGEST = 'a'.repeat(64);
const details = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, org: 'team-a', user: 'user-a', keyTail: 'f2c4', keyDigest: DIGEST, checkedAt: 5, outcome: 'ok', ...over,
});
const present = (over: Record<string, unknown> = {}) => {
  const d = parseLinearDetails(JSON.stringify(details(over)));
  if (d === null) throw new Error('fixture does not parse');
  return { kind: 'details' as const, details: d };
};

describe('linearConnectionView', () => {
  const key = { kind: 'key' as const, digest: DIGEST };

  it('each key-file kind that is not a key has its own state, whatever the details say', () => {
    for (const kind of ['unreadable', 'unusable', 'placeholder'] as const) {
      expect(linearConnectionView({ kind }, present())).toEqual({ state: kind });
    }
    expect(linearConnectionView({ kind: 'absent' }, present())).toEqual({ state: 'not-connected' });
  });

  it('each stored outcome is its own state, with only what the section shows', () => {
    const shown = { org: 'team-a', user: 'user-a', keyTail: 'f2c4', checkedAt: 5 };
    expect(linearConnectionView(key, present())).toEqual({ state: 'connected', outcome: 'ok', ...shown });
    expect(linearConnectionView(key, present({ outcome: 'rejected' }))).toEqual({ state: 'key-rejected', outcome: 'rejected', ...shown });
    expect(linearConnectionView(key, present({ outcome: 'unreachable' }))).toEqual({ state: 'unreachable', outcome: 'unreachable', ...shown });
    expect(JSON.stringify(linearConnectionView(key, present()))).not.toContain(DIGEST);
  });

  it('details that fail or describe another key are details-unknown, saying which', () => {
    expect(linearConnectionView(key, { kind: 'absent' })).toEqual({ state: 'details-unknown', why: 'absent' });
    expect(linearConnectionView(key, { kind: 'malformed' })).toEqual({ state: 'details-unknown', why: 'malformed' });
    expect(linearConnectionView(key, { kind: 'unreadable', code: 'EACCES' })).toEqual({ state: 'details-unknown', why: 'unreadable' });
    expect(linearConnectionView({ kind: 'key', digest: 'b'.repeat(64) }, present())).toEqual({ state: 'details-unknown', why: 'stale' });
  });

  it('every state the view can take is in the shared list', () => {
    const seen = new Set([
      linearConnectionView({ kind: 'absent' }, { kind: 'absent' }).state,
      linearConnectionView({ kind: 'unreadable' }, { kind: 'absent' }).state,
      linearConnectionView({ kind: 'unusable' }, { kind: 'absent' }).state,
      linearConnectionView({ kind: 'placeholder' }, { kind: 'absent' }).state,
      linearConnectionView(key, present()).state,
      linearConnectionView(key, present({ outcome: 'rejected' })).state,
      linearConnectionView(key, present({ outcome: 'unreachable' })).state,
      linearConnectionView(key, { kind: 'absent' }).state,
    ]);
    expect([...seen].sort()).toEqual([...LINEAR_VIEW_STATES].sort());
  });
});

describe('checkOutcomeOf', () => {
  it('only a 401/403 condemns a key; every other arm decided nothing about it', () => {
    expect(checkOutcomeOf('unauthorised')).toBe('rejected');
    for (const r of ['timeout', 'malformed', 'unreachable'] as const) expect(checkOutcomeOf(r)).toBe('unreachable');
  });
});

describe('parseLinearDetails', () => {
  it('reads what this build writes', () => {
    expect(parseLinearDetails(JSON.stringify(details()))).toEqual({
      org: 'team-a', user: 'user-a', keyTail: 'f2c4', keyDigest: DIGEST, checkedAt: 5, outcome: 'ok',
    });
    expect(parseLinearDetails(JSON.stringify(details({ org: null, user: null })))).toMatchObject({ org: null, user: null });
  });

  it('refuses every shape fault', () => {
    for (const bad of [
      '', '{', 'null', '[]', '7',
      details({ v: 2 }), details({ v: undefined }), details({ keyTail: 'abc' }), details({ keyTail: 'abcde' }),
      details({ keyDigest: 'xyz' }), details({ keyDigest: 'A'.repeat(64) }), details({ checkedAt: 'now' }),
      details({ checkedAt: -1 }), details({ outcome: 'maybe' }), details({ org: 5 }), details({ org: '' }),
      details({ user: 'u'.repeat(401) }),
    ]) expect(parseLinearDetails(typeof bad === 'string' ? bad : JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
  });
});

describe('isLinearKeyShape', () => {
  it('accepts letters, digits, underscore and hyphen inside the length bounds, and nothing else', () => {
    expect(isLinearKeyShape('lin_api_Abc-123_xyz-0001')).toBe(true);
    expect(isLinearKeyShape('k'.repeat(LINEAR_KEY_MIN_CHARS))).toBe(true);
    expect(isLinearKeyShape('k'.repeat(LINEAR_KEY_MAX_CHARS))).toBe(true);
    expect(isLinearKeyShape('k'.repeat(LINEAR_KEY_MIN_CHARS - 1))).toBe(false);
    expect(isLinearKeyShape('k'.repeat(LINEAR_KEY_MAX_CHARS + 1))).toBe(false);
    for (const bad of ['a b'.padEnd(20, 'c'), `${'k'.repeat(20)}\n`, `#${'k'.repeat(20)}`, `${'k'.repeat(20)}é`, 7, null, undefined]) {
      expect(isLinearKeyShape(bad), String(bad)).toBe(false);
    }
  });
});
