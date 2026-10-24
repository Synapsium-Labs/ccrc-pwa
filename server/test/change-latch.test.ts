// `changeLatch` (D-5861; ARCH-76 #811): "warn once until it changes", defined once.
import { describe, it, expect } from 'vitest';
import { changeLatch, changeLatchMap } from '../src/changeLatch.js';

describe('changeLatch', () => {
  it('answers true for the first key, false for the same key, true for a new key', () => {
    const l = changeLatch<string>();
    expect(l.changed('a')).toBe(true);
    expect(l.changed('a')).toBe(false);
    expect(l.changed('b')).toBe(true);
    expect(l.changed('b')).toBe(false);
  });

  it('re-arms on clear, so the same key answers true again', () => {
    const l = changeLatch<string>();
    expect(l.changed('a')).toBe(true);
    l.clear();
    expect(l.changed('a')).toBe(true);
    expect(l.changed('a')).toBe(false);
  });

  it('treats null as a key like any other (a success records "no failure")', () => {
    const l = changeLatch<string | null>();
    expect(l.changed('a')).toBe(true);
    expect(l.changed(null)).toBe(true);
    expect(l.changed('a')).toBe(true);
  });
});

describe('changeLatchMap', () => {
  it('keeps one latch per group', () => {
    const m = changeLatchMap<string, string>();
    expect(m.changed('p1', 'x')).toBe(true);
    expect(m.changed('p2', 'x')).toBe(true);
    expect(m.changed('p1', 'x')).toBe(false);
    expect(m.changed('p2', 'y')).toBe(true);
    expect(m.changed('p1', 'x')).toBe(false);
  });
});
