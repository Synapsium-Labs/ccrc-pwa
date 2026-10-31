/**
 * The one bounded pool (desktop polish C1, D-6388; the limiter itself is B4's, D-6369). It imports nothing, so it
 * is L1 (pure, no I/O): every caller that needs "many calls, at most N in flight" goes through here,
 * and there is no second pool.
 *
 * DEADLOCK RULE: a call under a bound never awaits another call under the same bound. A limited call that waited
 * on a sibling could hold every slot while the sibling queued for one, and the pool would never drain. Limit the
 * LEAF call (the one io round trip), never a caller that fans out beneath it under the SAME limiter. A caller may sit
 * under one bound while its own calls run unbounded or under another limiter (as `readRegistryMeasured` does: rows
 * under `mapBounded`, each row's field reads unbounded).
 */

/** Runs a call once a slot is free: at most `max` in flight, the rest waiting in arrival order. */
export type Limit = <T>(call: () => Promise<T>) => Promise<T>;

/** A promise limiter (D-6369). The slot is released in `finally`, so a call that rejects still frees it, and a
 *  freed slot is handed straight to the longest waiter, so the count never dips below the bound while any wait. */
export const limiter = (max: number): Limit => {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (call) => {
    if (active < max) active += 1;
    else await new Promise<void>((go) => { waiting.push(go); });   // the slot arrives already counted
    try { return await call(); }
    finally {
      const next = waiting.shift();
      if (next === undefined) active -= 1; else next();
    }
  };
};

/**
 * Runs `fn` over every item with at most `limit` calls in flight, and answers in INPUT order whatever order the
 * calls finish in. It is built ON the limiter above (one pool, not a second mechanism): each item is one limited
 * call. It rejects as `Promise.all` does, with the first rejection; the calls already started or queued still
 * run on, and a rejecting call frees its slot, so the pool drains rather than wedging. `limit` is the bound
 * for THIS call alone, so callers that must share one bound across several maps build a `limiter` and share it.
 * A `limit` that is not an integer >= 1 throws a `RangeError` SYNCHRONOUSLY, before any call starts, although the
 * function is typed `Promise<R[]>` (it would otherwise hang the map): a caller reads that throw, not a rejection.
 */
export const mapBounded = <T, R>(
  items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  // a limit below 1 (or NaN) would never admit a call, and the map would hang forever: refuse it loudly instead
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`mapBounded: limit must be an integer >= 1, got ${limit}`);
  const run = limiter(limit);
  return Promise.all(items.map((item, index) => run(() => fn(item, index))));
};
