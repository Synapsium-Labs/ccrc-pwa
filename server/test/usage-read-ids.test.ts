// usageReadIds: which rows one usage lane run reads (console speed S1). A pure decider, pinned at its edges.
import { describe, it, expect } from 'vitest';
import { usageReadIds } from '../src/tickPlan.js';
import { COLD_ROW_REREAD_MS } from '../src/rowTemperature.js';
import type { SessionRecord } from '../src/registry.js';

const rec = (id: string): SessionRecord => ({ id }) as SessionRecord;
const ids = (hot: string[], last: Record<string, number>, now: number): string[] =>
  [...usageReadIds([rec('a'), rec('b')], new Set(hot), new Map(Object.entries(last)), now)].sort();

describe('usageReadIds', () => {
  const now = 1_000_000;
  it('a cold row last read just under the bound is carried', () => {
    expect(ids([], { a: now - (COLD_ROW_REREAD_MS - 1), b: now - (COLD_ROW_REREAD_MS - 1) }, now)).toEqual([]);
  });
  it('a cold row last read exactly 30 000 ms ago is read', () => {
    expect(COLD_ROW_REREAD_MS).toBe(30_000);
    expect(ids([], { a: now - 30_000, b: now - 29_999 }, now)).toEqual(['a']);
  });
  it('a negative age (the clock stepped back) reads', () => {
    expect(ids([], { a: now + 1, b: now }, now)).toEqual(['a']);
  });
  it('a hot row and a row with no recorded read are read whatever their age', () => {
    expect(ids(['a'], { a: now, b: now }, now)).toEqual(['a']);
    expect(ids([], { a: now }, now)).toEqual(['b']);
  });
});
