// lib/wire — the PWA's ONE wire-guard kit (ARCH-30, #544). Five hand-copied kits disagreed on what a count is
// (`Number.isInteger` here, `Number.isSafeInteger` there); this file pins the one answer.
import { describe, expect, it } from 'vitest';
import { isCount, isNum, isOneOf, isRecord } from '../src/lib/wire';

describe('isRecord', () => {
  it('accepts a plain object and refuses null, arrays, primitives and functions', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    for (const v of [null, undefined, [], [1], 'x', 3, true, () => 1]) expect(isRecord(v)).toBe(false);
  });
});

describe('isNum', () => {
  it('accepts a finite number only', () => {
    expect(isNum(0)).toBe(true);
    expect(isNum(-1.5)).toBe(true);
    for (const v of [NaN, Infinity, -Infinity, '1', null, undefined]) expect(isNum(v)).toBe(false);
  });
});

describe('isCount', () => {
  it('accepts a safe non-negative integer', () => {
    expect(isCount(0)).toBe(true);
    expect(isCount(7)).toBe(true);
    expect(isCount(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
  it('refuses 2^53 + 1 and everything above the safe range', () => {
    expect(isCount(2 ** 53 + 1)).toBe(false);
    expect(isCount(2 ** 53)).toBe(false);
    expect(isCount(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
  });
  it('refuses a negative, a fraction, a non-finite and a non-number', () => {
    for (const v of [-1, 1.5, NaN, Infinity, '3', null, undefined, {}]) expect(isCount(v)).toBe(false);
  });
});

describe('isOneOf', () => {
  it('is membership in the list, never `in`', () => {
    expect(isOneOf(['a', 'b'] as const, 'a')).toBe(true);
    expect(isOneOf(['a', 'b'] as const, 'c')).toBe(false);
    expect(isOneOf(['a'] as const, 'toString')).toBe(false);
    expect(isOneOf(['a'] as const, 1)).toBe(false);
  });
});
