import { describe, it, expect } from 'vitest';
import { sortFleet } from '../src/fleet/sortFleet';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: over.id ?? 'x', wrapper: 'claude2', home: 'claude2', project: over.id ?? 'x', workdir: '/w',
  workspace: null,
  name: null, status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null, version: null,
  hookState: null, askSummary: null, subagents: null, held: null, bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null,
  ...over,
});

describe('sortFleet', () => {
  // The server decides which bucket a session is in (`sessionBucket`,
  // shared/api.ts) — including that a dead session is never `attention` even
  // if `dialogPending` lingers, which is why that case is pinned there
  // (server/test/bucket.test.ts), not here. sortFleet only decides what ORDER
  // the seven buckets read in, so every fixture below sets `bucket` directly
  // rather than the `status`/`dialogPending` this function no longer reads.
  it('sorts attention → done → idle → working → cleanup → archived → dead, recent-first within a bucket', () => {
    const fleet: FleetSession[] = [
      s({ id: 'dead-old', bucket: 'dead', statusUpdatedAt: 1 }),
      s({ id: 'working-new', bucket: 'working', statusUpdatedAt: 900 }),
      s({ id: 'idle-old', bucket: 'idle', statusUpdatedAt: 100 }),
      s({ id: 'idle-new', bucket: 'idle', statusUpdatedAt: 500 }),
      s({ id: 'needs', bucket: 'attention', statusUpdatedAt: 10 }),
      s({ id: 'working-old', bucket: 'working', statusUpdatedAt: 200 }),
      s({ id: 'done-1', bucket: 'done', statusUpdatedAt: 50 }),
      s({ id: 'cleanup-1', bucket: 'cleanup', statusUpdatedAt: 20 }),
      s({ id: 'archived-1', bucket: 'archived', statusUpdatedAt: 5 }),
    ];
    expect(sortFleet(fleet).map((x) => x.id)).toEqual([
      'needs',        // attention: 0
      'done-1',       // done: 1
      'idle-new',     // idle: 2, newest first
      'idle-old',
      'working-new',  // working: 3
      'working-old',
      'cleanup-1',    // cleanup: 4
      'archived-1',   // archived: 5
      'dead-old',     // dead: 6
    ]);
  });

  it('orders by the SERVER bucket, not by a local re-derivation', () => {
    // The fixture has to DISAGREE with the deleted derivation, or it proves
    // nothing. The old client rule read `dialogPending` first, then status:
    // it would have called `a` attention (rank 0) and `b` idle (rank 2) and
    // returned exactly the same order as a correct read of `bucket` — which
    // is what the previous fixture (status busy vs idle, buckets agreeing)
    // did. Here the two orders are opposites, so only one of them passes.
    const out = sortFleet([
      s({ id: 'a', status: 'busy', dialogPending: true, bucket: 'idle', bucketSince: 1 }),
      s({ id: 'b', status: 'idle', dialogPending: false, bucket: 'attention', bucketSince: 2 }),
    ]);
    expect(out.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input', () => {
    const fleet = [s({ id: 'b' }), s({ id: 'a' })];
    const copy = [...fleet];
    sortFleet(fleet);
    expect(fleet).toEqual(copy);
  });
});
