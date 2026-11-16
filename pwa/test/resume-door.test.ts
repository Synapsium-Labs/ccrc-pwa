// The words behind the programme page's Resume and Runs section (the runs rebuild, Task 19, D-8075; spec 2026-11-04 §8.5, §9.5).
import { describe, expect, it } from 'vitest';
import type { FleetSession, RunSummary } from '../../shared/api';
import { openWaves, pendingCloseLine, resumeShown } from '../src/fleet/runWords';
import { resumeHeirs } from '../src/fleet/resumeHeirs';
import { fleetSession } from './fleetFixture';

const R = (over: Record<string, unknown>): RunSummary => ({ state: 'working', kind: 'work', wave: 1, reviews: null, ...over }) as unknown as RunSummary;

describe('resumeShown', () => {
  it('is the coordinator reading gone, and the run open or its programme with no open run', () => {
    expect(resumeShown({ state: 'working', coordinatorGone: true }, 'unknown', true)).toBe(true);
    expect(resumeShown({ state: 'done', coordinatorGone: true }, 'unknown', false)).toBe(true);
    expect(resumeShown({ state: 'done', coordinatorGone: true }, 'unknown', true)).toBe(false);
    expect(resumeShown({ state: 'working', coordinatorGone: false }, 'dead', true)).toBe(false);
    expect(resumeShown({ state: 'working' }, 'dead', true)).toBe(true);
    expect(resumeShown({ state: 'working' }, 'unknown', true)).toBe(false);
  });
  it('a runs frame not yet heard (null) hides the door', () => {
    expect(resumeShown({ state: 'working', coordinatorGone: true }, 'dead', null)).toBe(false);
    expect(resumeShown({ state: 'done', coordinatorGone: true }, 'dead', null)).toBe(false);
  });
});

describe('openWaves', () => {
  it('lists newest wave first, newest run within a wave first, a review under the work run that it names', () => {
    const got = openWaves([R({ id: 1, wave: 1 }), R({ id: 2, wave: 2 }), R({ id: 3, wave: 2, kind: 'review', reviews: 2 }), R({ id: 4, wave: 2 })]);
    expect(got.map((e) => [e.run.id, e.reviews.map((x) => x.id)])).toEqual([[4, []], [2, [3]], [1, []]]);
  });
  it('a review whose work run is not open stands as its own entry at its wave', () => {
    const got = openWaves([R({ id: 1, wave: 1 }), R({ id: 9, wave: 3, kind: 'review', reviews: 7 })]);
    expect(got.map((e) => e.run.id)).toEqual([9, 1]);
  });
});

describe('pendingCloseLine', () => {
  const NOW = 1_000_000_000_000;
  it('words an armed clock as closes and a shadow one as would close', () => {
    expect(pendingCloseLine({ reason: 'owner-gone', count: 2, soonestAt: NOW + 2 * 3_600_000, armed: true }, NOW)).toBe('Owner gone: 2 · ccrc closes them in 2 h');
    expect(pendingCloseLine({ reason: 'overtaken', count: 1, soonestAt: NOW + 3 * 86_400_000, armed: false }, NOW)).toBe('Overtaken by later waves: 1 · ccrc would close it in 3 days');
  });
  it('a clock at zero or past reads soon when armed and now in shadow', () => {
    expect(pendingCloseLine({ reason: 'never-started', count: 1, soonestAt: NOW - 1, armed: true }, NOW)).toBe('Never started: 1 · ccrc closes it soon');
    expect(pendingCloseLine({ reason: 'never-started', count: 3, soonestAt: NOW, armed: false }, NOW)).toBe('Never started: 3 · ccrc would close them now');
  });
});

describe('resumeHeirs', () => {
  const co = (over: Partial<FleetSession>): FleetSession => fleetSession({ role: 'coordinator', project: 'project-a', status: 'idle', lifecycle: 'running', ...over } as never);
  it('lists the live coordinators of the project by name, never the claimant, a worker, a dead one or another project\'s', () => {
    const sessions = [
      co({ id: 'b', title: 'Beta' }), co({ id: 'a', title: 'Alpha' }), co({ id: 'claimant', title: 'Old' }),
      co({ id: 'dead', title: 'Dead', status: 'dead', lifecycle: 'orphan' }), co({ id: 'other', title: 'Other', project: 'project-b' }),
      co({ id: 'worker', title: 'Worker', role: 'child' }),
    ];
    expect(resumeHeirs(sessions, 'project-a', 'claimant', true).map((h) => h.id)).toEqual(['a', 'b']);
  });
  it('lists none before a fleet frame has landed', () => {
    expect(resumeHeirs([co({ id: 'a' })], 'project-a', null, false)).toEqual([]);
  });
});
