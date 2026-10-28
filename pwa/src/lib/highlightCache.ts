// A bounded least-recently-used cache (desktop polish Task C7): the one highlighter (`markdown.tsx#boundedHighlight`)
// keeps what highlight.js answered in one, so a block drawn again (a row that renders again, the same fence in another
// message, a Docs page reopened) is not highlighted again. Bounded twice: by its number of entries and by the total
// weight of its values, and an entry heavier than the whole weight bound is never kept.
//
// L1: imports nothing.

export interface Lru<V> {
  /** The value under `key`, which becomes the most recently used; `undefined` when none is held. */
  get(key: string): V | undefined;
  /** Hold `value` under `key` as the most recently used, then drop the least recently used until both bounds hold. A
   *  value heavier than the weight bound is not kept, and drops whatever `key` held before. */
  set(key: string, value: V): void;
  /** Drop every entry. */
  clear(): void;
  /** The entries held. */
  readonly size: number;
  /** The total weight held. */
  readonly weight: number;
}

/** A cache of at most `maxEntries` entries and at most `maxWeight` total weight, each value weighed once by `weigh`. */
export function createLru<V>(maxEntries: number, maxWeight: number, weigh: (value: V) => number): Lru<V> {
  // A Map iterates in insertion order, so its first key is the least recently used: a read re-inserts its key.
  const entries = new Map<string, { value: V; weight: number }>();
  let total = 0;
  const drop = (key: string): void => {
    const held = entries.get(key);
    if (held === undefined) return;
    entries.delete(key);
    total -= held.weight;
  };
  return {
    get(key) {
      const held = entries.get(key);
      if (held === undefined) return undefined;
      entries.delete(key);
      entries.set(key, held);
      return held.value;
    },
    set(key, value) {
      drop(key);
      const weight = weigh(value);
      if (weight > maxWeight) return;
      entries.set(key, { value, weight });
      total += weight;
      for (const oldest of entries.keys()) {
        if (entries.size <= maxEntries && total <= maxWeight) break;
        drop(oldest);
      }
    },
    clear() {
      entries.clear();
      total = 0;
    },
    get size() { return entries.size; },
    get weight() { return total; },
  };
}
