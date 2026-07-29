import { describe, it, expect } from 'vitest';
import { groupFleet } from '../src/fleet/groupFleet';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: 'x', wrapper: 'claude2', home: 'claude2', project: 'p', workdir: '/p',
  workspace: null, name: null, status: 'idle', statusUpdatedAt: 0, limits: null,
  dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: null, tasks: null, ...over,
});

describe('groupFleet', () => {
  it('orders groups by their most urgent member, not alphabetically', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy' }),
      s({ id: 'z', project: 'zeta', dialogPending: true }),
    ]);
    expect(g.map((x) => x.project)).toEqual(['zeta', 'alpha']);
  });

  it('surfaces attention on the group, so collapsing cannot hide it', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha' }),
      s({ id: 'b', project: 'alpha', dialogPending: true }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.attention).toBe(true);
  });

  it('counts busy members for the collapsed header', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy' }),
      s({ id: 'b', project: 'alpha', status: 'busy' }),
      s({ id: 'c', project: 'alpha', status: 'idle' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.busy).toBe(2);
  });

  it('sorts within a group by the fleet rule', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy' }),
      s({ id: 'b', project: 'alpha', dialogPending: true }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.sessions.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('is pure — it does not reorder its argument', () => {
    const input = [s({ id: 'a', project: 'zeta' }), s({ id: 'b', project: 'alpha' })];
    const copy = [...input];
    groupFleet(input);
    expect(input).toEqual(copy);
  });

  it('preserves insertion order under integer-like project names', () => {
    // This test would fail under Object.keys() iteration (which sorts integer-like keys numerically),
    // but passes under Map insertion-order. sortFleet puts '99' first (has dialogPending),
    // '1' second (merely busy), so group order must be ['99', '1'] or Map order is lost.
    const g = groupFleet([
      s({ id: 'a', project: '99', dialogPending: true }),
      s({ id: 'b', project: '1', status: 'busy' }),
    ]);
    expect(g.map((x) => x.project)).toEqual(['99', '1']);
  });

  it('excludes dead sessions from attention, even if they are dialogPending', () => {
    // A group whose only dialogPending member is dead must report attention: false,
    // so the screen does not highlight an already-closed session.
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'dead', dialogPending: true }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.attention).toBe(false);
  });
});
