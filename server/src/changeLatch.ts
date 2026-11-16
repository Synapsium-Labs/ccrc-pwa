/**
 * "Warn once until it changes" (D-5861; ARCH-76 #811; spec 2026-10-19 §2.3's change-latch row), defined once.
 *
 * A standing cause (an unwritable directory, a locked database) must speak once, not on every beat, and speak again
 * when the cause changes or comes back after a recovery. `changed(key)` answers true for the first key and for any
 * key that differs (`===`) from the last one it saw, and remembers it; `clear` forgets it, so the next key reads as
 * new. Pure: it prints nothing and reads no clock. The caller owns the sentence and the places it clears.
 *
 * Not this: a rate limit (`registry.ts`'s `warnState` is a cooldown with an escalation clock), a set of keys warned
 * and pruned by a lane, or a flag that never re-arms.
 */

export interface ChangeLatch<K> {
  /** True the first time and whenever `key` differs from the last key seen; records `key` either way. */
  changed(key: K): boolean;
  /** Re-arms: the next `changed` answers true whatever the key. */
  clear(): void;
}

export function changeLatch<K = string>(): ChangeLatch<K> {
  let seen = false;
  let last: K | undefined;
  return {
    changed(key: K): boolean {
      const differs = !seen || key !== last;
      seen = true;
      last = key;
      return differs;
    },
    clear(): void {
      seen = false;
      last = undefined;
    },
  };
}

/** One latch per group (`lastOrphanReport`'s per-project shape). It never prunes a group: none does today. */
export interface ChangeLatchMap<G, K> {
  changed(group: G, key: K): boolean;
}

export function changeLatchMap<G, K = string>(): ChangeLatchMap<G, K> {
  const latches = new Map<G, ChangeLatch<K>>();
  return {
    changed(group: G, key: K): boolean {
      let latch = latches.get(group);
      if (latch === undefined) {
        latch = changeLatch<K>();
        latches.set(group, latch);
      }
      return latch.changed(key);
    },
  };
}
