import { describe, it, expect } from 'vitest';
import { sortFleet } from '../src/fleet/sortFleet';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: over.id ?? 'x', wrapper: 'claude2', home: 'claude2', project: over.id ?? 'x', workdir: '/w',
  name: null, status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false, model: null, effort: null, ultracode: false, branch: null, version: null,
  ...over,
});

describe('sortFleet', () => {
  it('buckets needs-you → idle → working → dead, recent-first within a bucket', () => {
    const fleet: FleetSession[] = [
      s({ id: 'dead-old', status: 'dead', statusUpdatedAt: 1 }),
      s({ id: 'busy-new', status: 'busy', statusUpdatedAt: 900 }),
      s({ id: 'idle-old', status: 'idle', statusUpdatedAt: 100 }),
      s({ id: 'idle-new', status: 'idle', statusUpdatedAt: 500 }),
      s({ id: 'needs', status: 'idle', dialogPending: true, statusUpdatedAt: 10 }),
      s({ id: 'busy-old', status: 'busy', statusUpdatedAt: 200 }),
    ];
    expect(sortFleet(fleet).map((x) => x.id)).toEqual([
      'needs',      // bucket 0
      'idle-new',   // bucket 1, newest first
      'idle-old',
      'busy-new',   // bucket 2
      'busy-old',
      'dead-old',   // bucket 3
    ]);
  });

  it('a dead session is never treated as needs-you even if dialogPending lingers', () => {
    const fleet = [s({ id: 'a', status: 'idle' }), s({ id: 'z', status: 'dead', dialogPending: true })];
    expect(sortFleet(fleet).map((x) => x.id)).toEqual(['a', 'z']);
  });

  it('does not mutate the input', () => {
    const fleet = [s({ id: 'b' }), s({ id: 'a' })];
    const copy = [...fleet];
    sortFleet(fleet);
    expect(fleet).toEqual(copy);
  });
});
