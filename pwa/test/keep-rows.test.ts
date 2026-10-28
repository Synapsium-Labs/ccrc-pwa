import { describe, it, expect } from 'vitest';
import { keepRows } from '../src/fleet/keepRows';
import { fleetSession } from './fleetFixture';

const row = (id: string, over: Parameters<typeof fleetSession>[0] = {}) => fleetSession({ id, home: 'lane-a', ...over });
const fresh = <T,>(rows: T[]): T[] => structuredClone(rows);

describe('keepRows', () => {
  it('an unchanged row keeps its object', () => {
    const prev = [row('ws-a'), row('ws-b')];
    const next = fresh(prev);
    next[1] = row('ws-b', { status: 'busy' });
    const out = keepRows(prev, next);
    expect(out[0]).toBe(prev[0]);
    expect(out[0]).not.toBe(next[0]);
  });

  it('an identical frame keeps the array', () => {
    const prev = [row('ws-a'), row('ws-b')];
    const out = keepRows(prev, fresh(prev));
    expect(out).toBe(prev);
    expect(keepRows([], [])).toEqual([]);
  });

  it('a changed row is new, its neighbours kept', () => {
    const prev = [row('ws-a'), row('ws-b'), row('ws-c')];
    const next = fresh(prev);
    next[1] = row('ws-b', { status: 'busy' });
    const out = keepRows(prev, next);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
    expect(out[1]).not.toBe(prev[1]);
    expect(out[2]).toBe(prev[2]);
    // An extra key is a change: a revived row takes the live object.
    const live = { ...fresh(prev)[0], extra: 1 } as typeof prev[0];
    expect(keepRows(prev, [live, ...fresh(prev).slice(1)])[0]).toBe(live);
  });

  it('a reordered frame keeps each object', () => {
    const prev = [row('ws-a'), row('ws-b'), row('ws-c')];
    const next = fresh([row('ws-c'), row('ws-a'), row('ws-b')]);
    const out = keepRows(prev, next);
    expect(out).not.toBe(prev);
    expect(out.map((r) => r.id)).toEqual(['ws-c', 'ws-a', 'ws-b']);
    expect(out[0]).toBe(prev[2]);
    expect(out[1]).toBe(prev[0]);
    expect(out[2]).toBe(prev[1]);
  });

  it('an added or removed row gives a new array', () => {
    const prev = [row('ws-a'), row('ws-b')];
    const added = fresh(prev);
    added.push(row('ws-c'));
    const outAdded = keepRows(prev, added);
    expect(outAdded).not.toBe(prev);
    expect(outAdded).toHaveLength(3);
    expect(outAdded[0]).toBe(prev[0]);
    expect(outAdded[1]).toBe(prev[1]);
    expect(outAdded[2]).toBe(added[2]);
    const removed = fresh(prev).slice(0, 1);
    const outRemoved = keepRows(prev, removed);
    expect(outRemoved).not.toBe(prev);
    expect(outRemoved).toHaveLength(1);
    expect(outRemoved[0]).toBe(prev[0]);
    expect(keepRows(prev, [])).toEqual([]);
  });
});
