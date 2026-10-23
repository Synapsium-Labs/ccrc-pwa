/**
 * The one bounded pool (desktop polish C1, D-6388; the limiter itself is B4's, D-6369). It imports nothing, so it
 * is L1 (pure vocabulary, no io): every caller that needs "many calls, at most N in flight" goes through here,
 * and there is no second pool.
 *
 * DEADLOCK RULE: a call under a bound never awaits another call under the same bound. A limited call that waited
 * on a sibling could hold every slot while the sibling queued for one, and the pool would never drain. Limit the
 * LEAF call (the one io round trip), never a caller that fans out beneath it.
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
