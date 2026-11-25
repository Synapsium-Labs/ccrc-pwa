// The one sequence's retention lane (Overlord spec §10.4; Table 11.5b's row "90 days | How long `overlord_sequence` is kept | W1 |
// wall"; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Task 3). Ring L4, context C5. It decides
// nothing: it reads the oldest `SEQUENCE_PRUNE_BATCH` lines, asks `overlordSequence.ts#retentionCut` against the wall clock (read
// through the time port), and acts on the answer through the store's one prune. Its `LANE_SCHEDULE` row, `sequenceRetention`,
// throttles it hourly on the monotonic clock; `FleetWatcher.sweepSequenceRetention` runs it, never awaited.
import { SEQUENCE_PRUNE_BATCH } from '../../../shared/overlord-sequence.js';
import type { Clock } from '../time/ports.js';
import { retentionCut } from './overlordSequence.js';
import type { SequenceRead } from './overlordSequenceStore.js';

/** What the lane needs of `coord.db`, declared here by its consumer. */
export interface SequenceRetentionCoord {
  sequenceOldest(limit: number): SequenceRead<readonly { seq: number; at: number; keep: boolean }[]>;
  pruneSequenceThrough(through: number, keep: readonly number[]): { pruned: number } | { error: string };
}
export interface SequenceRetentionDeps {
  readonly coord: SequenceRetentionCoord;
  readonly clock: Pick<Clock, 'wall'>;
  readonly log: (line: string) => void;
}

/** One pass: at most one prune of at most `SEQUENCE_PRUNE_BATCH` lines. An unreadable sequence or a failed prune logs one line
 *  and deletes nothing; the next pass tries again. Answers how many lines it deleted. */
export function runSequenceRetentionLane(deps: SequenceRetentionDeps): number {
  const read = deps.coord.sequenceOldest(SEQUENCE_PRUNE_BATCH);
  if (read.kind === 'unmeasured') {
    deps.log(`ccrc-server: the sequence retention lane read nothing: ${read.why}`);
    return 0;
  }
  const cut = retentionCut(deps.clock.wall(), read.value);
  if (cut.through === null) return 0;
  const done = deps.coord.pruneSequenceThrough(cut.through, cut.keep);
  if ('error' in done) {
    deps.log(`ccrc-server: the sequence retention lane deleted nothing: ${done.error}`);
    return 0;
  }
  return done.pruned;
}
