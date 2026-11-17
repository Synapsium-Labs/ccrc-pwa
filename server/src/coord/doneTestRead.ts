// The one reader of a done-test target (Overlord W2 done tests A; plan docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-done-tests.md §5, index question 13). `readTarget` gathers the rows a bare target names and asks `targetVerdict`; no
// other file reads a run's `closePr` or `prLineage` to decide a predicate (`single-definition/done-test-reader.test.ts`).
// Remaining work B clears its programme edges through it, and done tests B binds a request's test to it.
//
// Ring: L3, context C5 Coordination. It reads through its port alone, decides nothing (the answer is `targetVerdict`'s),
// and reads no clock and no fleet box: only stored columns.
import type { DoneTarget, TargetAnswer } from '../../../shared/doneTests.js';
import { targetVerdict, type TargetFacts } from './doneTests.js';
import type { CoordStore } from './store.js';

/** What the reader needs of coordination, declared by this consumer: one run, the runs that review it, one item. */
export type TargetReadPort = Pick<CoordStore, 'run' | 'runsReviewing' | 'itemById'>;

/** A throw's class as one word, never its message: a message can carry text a session wrote. */
const thrownWord = (err: unknown): string => {
  const name = err instanceof Error ? err.name : null;
  return name !== null && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'thrown';
};

function gather(coord: TargetReadPort, target: DoneTarget): TargetFacts {
  if (target.predicate === 'operator-confirms') {
    const item = coord.itemById(target.itemId);
    return { kind: 'item', item: item === null ? 'absent' : { state: item.state } };
  }
  const read = coord.run(target.runId);
  if (!read.ok) return { kind: 'run', run: 'unreadable' };
  const r = read.run;
  if (r === null) return { kind: 'run', run: 'absent' };
  const run = { state: r.state, kind: r.kind, openedAt: r.openedAt, closeDetail: r.closeDetail,
    closePr: r.closePr, lineage: r.prLineage };
  if (target.predicate !== 'review-passed') return { kind: 'run', run };
  return { kind: 'run', run, reviews: coord.runsReviewing(target.runId).map((v) => ({ state: v.state })) };
}

/** One bare target's answer. A read that throws (a locked or closed database) is `unmeasured` and holds; a row the store
 *  cannot represent is `unmeasurable`; everything else is Table 3's. */
export function readTarget(coord: TargetReadPort, target: DoneTarget): TargetAnswer {
  let facts: TargetFacts;
  try {
    facts = gather(coord, target);
  } catch (err) {
    facts = { kind: 'threw', why: thrownWord(err) };
  }
  return targetVerdict(target, facts);
}
