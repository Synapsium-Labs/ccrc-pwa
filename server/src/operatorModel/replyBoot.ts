// The reply arm of the Operator Model's boot pass (invariant I8 across the two files; Overlord W1 chat, PR B, plan `w1-chat.md`
// Task 5 step 5). Ring L4, context C11. A reply's record commits in the private store first and its response row in coord.db
// after, in two transactions (index question 31), so a crash between the two leaves a recorded reply with no row. Once a boot,
// after the response stamp exists (`index.ts`, beside `deps.responseStamp`), each reply recorded within `REPLY_WINDOW_MS` that has
// no row gets one, through the door's own insert (`insertReplyResponse`), stamped at the reply's own record time, so the row is
// the one the door would have written. It decides nothing and carries no text: ids and counts only. It is its own function, not an
// arm inside `runOperatorModelBootPass`, because that pass runs before this boot's response epoch is recorded, and a row stamped
// before its epoch would read `unmeasured` (slug `reply-boot-arm-runs-after-the-stamp`).
import type { DatabaseSync } from 'node:sqlite';
import { REPLY_WINDOW_MS, type ResponseStamp } from '../../../shared/responses.js';
import { insertReplyResponse, repliesWithoutResponse } from '../coord/responsesStore.js';
import type { OperatorModelStore } from './store.js';

export interface ReplyBootCounts { readonly inserted: number; readonly standing: number; readonly errors: number }

export function runReplyResponseBoot(deps: {
  readonly store: Pick<OperatorModelStore, 'replyIdsSince'>;
  readonly coordDb: DatabaseSync;
  readonly stamp: () => ResponseStamp;
  readonly now: () => number;
}): { readonly counts: ReplyBootCounts; readonly lines: readonly string[] } {
  const lines: string[] = [];
  const recorded = deps.store.replyIdsSince(Math.max(0, deps.now() - REPLY_WINDOW_MS));
  if (recorded.kind === 'unmeasured') {
    return { counts: { inserted: 0, standing: 0, errors: 1 }, lines: [`reply boot: recorded replies unmeasured (${recorded.why}); no response row re-derived`] };
  }
  let missing: readonly number[];
  try { missing = repliesWithoutResponse(deps.coordDb, recorded.value.map((r) => r.id)); } catch (e) {
    return { counts: { inserted: 0, standing: 0, errors: 1 }, lines: [`reply boot: the response rows could not be read (${e instanceof Error ? e.message : String(e)})`] };
  }
  const atOf = new Map(recorded.value.map((r) => [r.id, r.at]));
  let inserted = 0;
  let errors = 0;
  for (const id of missing) {
    try {
      if (insertReplyResponse(deps.coordDb, id, deps.stamp(), atOf.get(id)!).inserted) inserted += 1;
    } catch (e) {
      errors += 1;
      lines.push(`reply boot: reply ${id}'s response row not inserted (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return { counts: { inserted, standing: recorded.value.length - missing.length, errors }, lines };
}

/** The one `ccrc-server:` line the composition root prints: counts, never a text. */
export const replyBootSummary = (c: ReplyBootCounts): string =>
  `operator model reply boot: inserted ${c.inserted}, standing ${c.standing}, errors ${c.errors}`;
