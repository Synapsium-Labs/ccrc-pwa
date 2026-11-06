// Cleanup un-wedge R2: `CoordStatus.cleanupHeldBy` is always present, and `emitCoord` composes it through
// `withCleanupHeldBy` exactly once.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChildReclaimAttention, CoordStatus } from '../../shared/api.js';
import { withCleanupHeldBy } from '../src/cleanupHeldBy.js';
import type { HeldByRead } from '../src/cleanupHeldBy.js';

const listed: HeldByRead = { kind: 'rows', own: false, rows: [{ id: 'row-a', word: 'gone-unrecorded', workspace: 'absent' }] };
const lane = (m: Record<string, HeldByRead | undefined>): ReadonlyMap<string, { heldBy?: HeldByRead }> =>
  new Map(Object.entries(m).map(([k, v]) => [k, v === undefined ? {} : { heldBy: v }]));
const none = lane({});
const status = (r: ChildReclaimAttention[]): CoordStatus => ({ childReclaimAttention: r }) as unknown as CoordStatus;
const failing = (id: string): ChildReclaimAttention =>
  ({ kind: 'failing', sessionId: id, runId: null, token: 'probe-unmeasured', sentence: 's', at: 1 });

describe('CoordStatus.cleanupHeldBy', () => {
  it('CoordStatus carries cleanupHeldBy when a row holds', () => {
    const out = withCleanupHeldBy(status([]), { reclaim: none, expire: none, collect: lane({ t1: listed }) }, [{ id: 'row-a', workspace: '/x/ws' }]);
    expect(out.cleanupHeldBy).toHaveLength(1);
    expect(out.cleanupHeldBy![0]!.act).toBe('recheck');
  });
  it('the field is omitted when nothing holds, so the frame is today\'s byte for byte', () => {
    const before = status([failing('c1')]);
    const after = withCleanupHeldBy(before, { reclaim: lane({ c1: { kind: 'none' } }), expire: none, collect: none }, null);
    expect(Object.prototype.hasOwnProperty.call(after, 'cleanupHeldBy')).toBe(false);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
  it('an older lane state (no reads yet) omits the field', () => {
    expect(withCleanupHeldBy(status([]), { reclaim: none, expire: none, collect: none }, []).cleanupHeldBy).toBeUndefined();
  });
  it('the status line composes through withCleanupHeldBy', () => {
    const src = readFileSync(new URL('../src/watch.ts', import.meta.url), 'utf8');
    const lines = src.split('\n').filter((l) => /const status: CoordStatus = withCleanupHeldBy\(/.test(l));
    expect(lines).toHaveLength(1);
    for (const arg of ['this.childReclaimSweepState', 'this.archivedExpiryState', 'this.collectState', 'this.lastFleet']) {
      expect(lines[0], arg).toContain(arg);
    }
  });
});
