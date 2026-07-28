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
  it('leaves a one-session project ungrouped, so the screen is unchanged today', () => {
    const g = groupFleet([s({ id: 'a', project: 'alpha' })]);
    expect(g).toHaveLength(1);
    expect(g[0]!.grouped).toBe(false);
  });

  it('groups a project holding two or more sessions', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha' }),
      s({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.grouped).toBe(true);
    expect(g[0]!.sessions).toHaveLength(2);
  });

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
});
