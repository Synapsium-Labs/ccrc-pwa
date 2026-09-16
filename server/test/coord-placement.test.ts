import { describe, it, expect } from 'vitest';
import { boardPlacement } from '../src/coord/placement.js';

const base = {
  sessionId: 'custom-tools-amber-delta',
  ownProject: 'custom-tools',
  held: true,
  stamped: null as string | null,
  coordOf: (_p: string): string | null => null,
};

describe('boardPlacement', () => {
  it('places a held worker on its run’s stamped coordinator project', () => {
    expect(boardPlacement({ ...base, stamped: 'intake-platform' })).toBe('intake-platform');
  });

  it('falls back to its own project when the run carries no stamp', () => {
    expect(boardPlacement({ ...base, stamped: null })).toBe('custom-tools');
  });

  it('falls back to its own project when the workspace is NOT held', () => {
    expect(boardPlacement({ ...base, held: false, stamped: 'intake-platform' }))
      .toBe('custom-tools');
  });

  it('never places a session under its own project', () => {
    expect(boardPlacement({ ...base, stamped: 'custom-tools' })).toBe('custom-tools');
  });

  it('walks a chain to the ROOT coordinator', () => {
    const chain: Record<string, string> = { mid: 'root' };
    expect(boardPlacement({
      ...base, stamped: 'mid', coordOf: (p) => chain[p] ?? null,
    })).toBe('root');
  });

  it('a CYCLE falls back to its own project rather than looping', () => {
    const cycle: Record<string, string> = { a: 'b', b: 'a' };
    expect(boardPlacement({
      ...base, stamped: 'a', coordOf: (p) => cycle[p] ?? null,
    })).toBe('custom-tools');
  });

  it('a chain longer than the hop cap falls back rather than walking forever', () => {
    expect(boardPlacement({
      ...base, stamped: 'a', coordOf: (p) => `${p}+`,
    })).toBe('custom-tools');
  });

  it('resolves a chain exactly as long as the hop cap', () => {
    const chain: Record<string, string> = { a: 'b', b: 'c', c: 'd' };   // 4th call returns null
    expect(boardPlacement({ ...base, stamped: 'a', coordOf: (p) => chain[p] ?? null })).toBe('d');
  });

  it('falls back on a chain one hop past the cap', () => {
    const chain: Record<string, string> = { a: 'b', b: 'c', c: 'd', d: 'e' };
    expect(boardPlacement({ ...base, stamped: 'a', coordOf: (p) => chain[p] ?? null }))
      .toBe('custom-tools');
  });

  it('stops ON REVISIT rather than walking to the cap', () => {
    const cycle: Record<string, string> = { a: 'b', b: 'a' };
    let calls = 0;
    const coordOf = (p: string): string | null => { calls++; return cycle[p] ?? null; };
    expect(boardPlacement({ ...base, stamped: 'a', coordOf })).toBe('custom-tools');
    expect(calls).toBe(2);   // the revisit is detected on the second call, not after MAX_HOPS
  });
});
