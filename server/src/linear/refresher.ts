/**
 * The key check through the one rate service (#1444, D-7668; spec 2026-10-31 §4.1, §6.7).
 *
 * L3 ADAPTER: it reads a slot's key from its file before each page and calls Linear through `client.ts`. It decides
 * nothing the rate service (`rate.ts`) or the key check (`checkLinearKey`) has not decided, and it writes nothing: the
 * caller records what the check found, under the lock, by the digest rule.
 */
import { checkLinearKey, type FetchLike, type LinearKeyCheck } from './client.js';
import type { LinearRateGrant, LinearRateLane, LinearRateRefusal, LinearRateService } from './rate.js';
import { readLinearSlotKey, type LinearSlotRef } from './store.js';

/** A key check's answer through the rate service: refused before any call, or checked. */
export type LinearSlotCheck =
  | { kind: 'refused'; detail: LinearRateRefusal; retryAfterS: number }
  | { kind: 'checked'; check: LinearKeyCheck };

export interface LinearSlotCheckOpts {
  ccrcDir: string;
  slot: LinearSlotRef;
  /** Whose call this is (spec §6.7): `request` for the legacy Check again, `floor` for the background refresher and
   *  the account-gated key acts. */
  lane: LinearRateLane;
  rate: LinearRateService;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * The §4.1 key check of one slot's STORED key: one call taken from the slot's lane before the first page, one more
 * before the second (and only if Linear says there is one), each settled with what it spent, so a refusal of the
 * second page costs the first nothing and Linear's own rate limit closes the slot for the wait it gave. The key is
 * read from its file before each page (`readLinearSlotKey`); nothing here holds it.
 */
export async function checkLinearSlot(o: LinearSlotCheckOpts): Promise<LinearSlotCheck> {
  const first = o.rate.take({ lane: o.lane, slot: o.slot, calls: 1 });
  if (!first.ok) return { kind: 'refused', detail: first.detail, retryAfterS: first.retryAfterS };
  let second: LinearRateGrant | null = null;
  const check = await checkLinearKey(() => readLinearSlotKey(o.ccrcDir, o.slot), {
    fetch: o.fetch, timeoutMs: o.timeoutMs,
    mayAskMore: () => {
      const t = o.rate.take({ lane: o.lane, slot: o.slot, calls: 1 });
      if (t.ok) second = t.grant;
      return t.ok;
    },
  });
  const closeForS = !check.ok && check.reason === 'rate-limited' ? check.retryAfterS : null;
  o.rate.settle(first.grant, { spent: check.pagesSent >= 1 ? 1 : 0, closeForS: check.pagesSent === 1 ? closeForS : null });
  const late: LinearRateGrant | null = second;
  if (late !== null) o.rate.settle(late, { spent: check.pagesSent >= 2 ? 1 : 0, closeForS: check.pagesSent === 2 ? closeForS : null });
  return { kind: 'checked', check };
}
