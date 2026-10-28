// The bounded cache behind the one highlighter (desktop polish Task C7). `createLru` keeps at most `maxEntries` entries
// and at most `maxWeight` total weight, dropping the least recently used first, and never keeps an entry heavier than
// `maxWeight` on its own.
import { describe, expect, it } from 'vitest';
import { createLru } from '../src/lib/highlightCache';

const len = (s: string): number => s.length;

describe('createLru', () => {
  it('it keeps its entry and size bounds, dropping the least recently used', () => {
    // The entry bound: three entries at most.
    const byCount = createLru<string>(3, 1_000, len);
    byCount.set('a', 'x');
    byCount.set('b', 'x');
    byCount.set('c', 'x');
    expect(byCount.get('a')).toBe('x'); // a read makes `a` the most recent, so `b` is now the oldest
    byCount.set('d', 'x');
    expect(byCount.size).toBe(3);
    expect(byCount.get('b')).toBeUndefined();
    expect(byCount.get('a')).toBe('x');
    expect(byCount.get('c')).toBe('x');
    expect(byCount.get('d')).toBe('x');

    // The weight bound: ten characters at most, however few the entries.
    const byWeight = createLru<string>(100, 10, len);
    byWeight.set('a', 'xxxx');
    byWeight.set('b', 'xxxx');
    expect(byWeight.weight).toBe(8);
    byWeight.set('c', 'xxxx'); // 12 > 10: the oldest, `a`, goes
    expect(byWeight.get('a')).toBeUndefined();
    expect(byWeight.get('b')).toBe('xxxx');
    expect(byWeight.get('c')).toBe('xxxx');
    expect(byWeight.size).toBe(2);
    expect(byWeight.weight).toBe(8);

    // Setting a key again replaces its value and its weight; it is not a second entry.
    byWeight.set('b', 'xx');
    expect(byWeight.size).toBe(2);
    expect(byWeight.weight).toBe(6);
  });

  it('an over-size entry is not kept', () => {
    const lru = createLru<string>(10, 5, len);
    lru.set('small', 'xxx');
    lru.set('big', 'xxxxxx'); // 6 > 5 on its own
    expect(lru.get('big')).toBeUndefined();
    // Refusing it evicts nothing that was there.
    expect(lru.get('small')).toBe('xxx');
    expect(lru.size).toBe(1);
    expect(lru.weight).toBe(3);
    // A key whose new value is over-size is dropped rather than left holding the old value.
    lru.set('small', 'xxxxxxx');
    expect(lru.get('small')).toBeUndefined();
    expect(lru.size).toBe(0);
    expect(lru.weight).toBe(0);
  });
});
