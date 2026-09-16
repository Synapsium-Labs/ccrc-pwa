import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    // Same fixture as 'stops ON REVISIT rather than walking to the cap' below,
    // minus the call-count assertion — this pins only the return value (a
    // totality check), not the cycle guard's mechanism. Read this file as ONE
    // pin on the cycle guard, not two.
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

  it('refuses a stamp that walks back to its own project', () => {
    const chain: Record<string, string> = { 'custom-tools': 'elsewhere' };
    expect(boardPlacement({ ...base, stamped: 'custom-tools', coordOf: (p) => chain[p] ?? null }))
      .toBe('custom-tools');          // 'elsewhere' if placement.ts:44 goes
  });

  it('refuses a chain that passes THROUGH its own project', () => {
    const chain: Record<string, string> = { x: 'custom-tools', 'custom-tools': 'z' };
    expect(boardPlacement({ ...base, stamped: 'x', coordOf: (p) => chain[p] ?? null }))
      .toBe('custom-tools');          // 'z' if placement.ts:42's seed goes
  });
});

/**
 * placement.ts's own docstring claims "PURE (L1): no `fs`, no fastify, no
 * clock, no `coord.db`" — this is the check under that claim, mirroring
 * `coord-caps-policy.test.ts`'s scan of `caps.ts` (D-1219: a citation is
 * load-bearing in a way a bare claim is not, so either the claim stands down
 * to a stated convention or it gets a check).
 */
describe('placement.ts is the pure module its own docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'placement.ts'),
    'utf8');

  /** Comments blanked, positions preserved — `caps.ts`'s scan without which
   *  this file's own docstring, which NAMES fs, fastify and coord.db while
   *  promising not to use them, reds every assertion below. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    // The floor every negative assertion below needs: `''` contains none of them.
    expect(code()).toContain('export function boardPlacement');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('has no clock', () => {
    expect(code(), 'placement.ts reads the clock — the decision is no longer pure')
      .not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
  });

  it('has no fs and no other node builtin', () => {
    expect(code(), 'placement.ts imports a node builtin').not.toMatch(/from\s+'node:/);
    expect(code(), 'placement.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
  });

  it('has no fastify, no reply, no store', () => {
    expect(code(), 'placement.ts names a reply — an L1 decision does not answer HTTP')
      .not.toMatch(/\breply\b|\bFastify|\bapp\s*\./);
    expect(code(), 'placement.ts reaches the store — an L1 decision does not read rows')
      .not.toMatch(/CoordStore|\bcoord\s*\.|\bstore\s*\./);
  });

  it('has NO imports at all — stronger than L1\'s "types only" allowance', () => {
    // `architecture:78-81` allows L1 to import L2 as types; this module never
    // needs even that, since every fact it needs arrives as a `PlacementInput`
    // field or the `coordOf` port. Zero imports is the strongest form of the
    // purity claim, not a gap in this scan — there is nothing here for a value
    // import to hide behind.
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!);
    expect(imports, 'placement.ts has grown an import — re-check the purity claim').toEqual([]);
  });
});
