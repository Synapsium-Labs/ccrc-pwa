import { describe, it, expect } from 'vitest';
import { sameJson } from '../src/lib/sameJson';
import { fleetSession } from './fleetFixture';

describe('sameJson', () => {
  it('equal nested values are equal', () => {
    // Separately built on both sides: only a recursive compare can call these equal.
    expect(sameJson({ a: { b: { c: 1 } }, list: [1, [2, 3], { d: 'x' }] }, { a: { b: { c: 1 } }, list: [1, [2, 3], { d: 'x' }] })).toBe(true);
    expect(sameJson([[1], [2]], [[1], [2]])).toBe(true);
    expect(sameJson(null, null)).toBe(true);
    expect(sameJson('a', 'a')).toBe(true);
    expect(sameJson({ u: undefined }, { u: undefined })).toBe(true);
    const a = fleetSession({ id: 'ws-a', home: 'lane-a', tasks: null, unmeasured: ['uuid'] });
    expect(sameJson(a, structuredClone(a))).toBe(true);
    expect(sameJson(a, JSON.parse(JSON.stringify(a)))).toBe(true);
  });

  it('a nested change is a change', () => {
    expect(sameJson(1, 2)).toBe(false);
    expect(sameJson('a', 'b')).toBe(false);
    expect(sameJson(true, false)).toBe(false);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ a: { list: [1, 2] } }, { a: { list: [1, 3] } })).toBe(false);
    expect(sameJson([1, 2], [1, 2, 3])).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson([{ k: 1 }], [{ k: 2 }])).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson(null, {})).toBe(false);
    expect(sameJson({}, null)).toBe(false);
    expect(sameJson(0, '0')).toBe(false);
    const a = fleetSession({ id: 'ws-a', home: 'lane-a', unmeasured: ['uuid'] });
    expect(sameJson(a, { ...structuredClone(a), status: 'busy' })).toBe(false);
    expect(sameJson(a, { ...structuredClone(a), unmeasured: ['workdir'] })).toBe(false);
    expect(sameJson(a, { ...structuredClone(a), child: { kind: 'none', extra: 1 } })).toBe(false);
  });

  it('key order does not matter', () => {
    expect(sameJson({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    const a = fleetSession({ id: 'ws-a', home: 'lane-a' });
    const reversed = Object.fromEntries(Object.entries(structuredClone(a)).reverse());
    expect(sameJson(a, reversed)).toBe(true);
  });

  it('an extra key is a change', () => {
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJson({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(false);
    // Same number of keys, different key sets.
    expect(sameJson({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    expect(sameJson({ n: { a: 1 } }, { n: { a: 1, b: 2 } })).toBe(false);
    const a = fleetSession({ id: 'ws-a', home: 'lane-a' });
    expect(sameJson(a, { ...structuredClone(a), revived: true })).toBe(false);
    expect(sameJson({ ...structuredClone(a), revived: true }, a)).toBe(false);
  });
});
