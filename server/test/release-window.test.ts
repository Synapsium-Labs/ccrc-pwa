// Console speed S2, U3: the pure release window for GET /api/updates. CoordStore.releases() stays whole; only the
// wire is limited, and every row the PWA's own window (`releaseWindow` in pwa/src/screens/updates.tsx) can need stays.
import { describe, expect, it } from 'vitest';
import { RELEASE_WINDOW_RECENT, RELEASE_WINDOW_STABLE_BACK, releaseWindow } from '../src/update/releaseWindow.js';

interface Row { tag: string; channel: string | null }

// v0.0.1 .. v0.0.80, every 10th Stable, the rest Dev; input order is oldest first, so newest-first is the decider's work.
const catalogue: Row[] = Array.from({ length: 80 }, (_, i) => ({
  tag: `v0.0.${i + 1}`, channel: (i + 1) % 10 === 0 ? 'stable' : 'dev',
}));
const ctx = (over: Partial<Parameters<typeof releaseWindow>[1]> = {}) => ({
  installed: [] as string[], previous: [] as string[], intentTags: [] as string[],
  recent: RELEASE_WINDOW_RECENT, stableBack: RELEASE_WINDOW_STABLE_BACK, ...over,
});
const tags = (rows: readonly Row[]) => rows.map((r) => r.tag);
const v = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => `v0.0.${hi - i}`);

describe('releaseWindow', () => {
  it('uses the plan values', () => {
    expect(RELEASE_WINDOW_RECENT).toBe(30);
    expect(RELEASE_WINDOW_STABLE_BACK).toBe(3);
  });

  it('keeps the newest 30', () => {
    expect(tags(releaseWindow(catalogue, ctx()))).toEqual(v(51, 80));
  });

  it('keeps every release after the oldest installed tag', () => {
    // v0.0.20 is the oldest installed: v0.0.21..v0.0.80 are all newer; v0.0.20 is kept as its own row, nothing older.
    const out = tags(releaseWindow(catalogue, ctx({ installed: ['v0.0.70', 'v0.0.20'], stableBack: 0 })));
    expect(out).toEqual(v(20, 80));
  });

  it('keeps previous and intent tags however old', () => {
    const out = tags(releaseWindow(catalogue, ctx({ previous: ['v0.0.3'], intentTags: ['v0.0.7'] })));
    expect(out).toEqual([...v(51, 80), 'v0.0.7', 'v0.0.3']);
    // an exact match is kept for any string present in the catalogue, a release tag or not
    const odd = [...catalogue, { tag: 'nightly', channel: null }];
    expect(releaseWindow(odd, ctx({ previous: ['nightly'] })).map((r) => r.tag)).toContain('nightly');
  });

  it('keeps three older Stable releases per installed tag', () => {
    // Stable tags are v0.0.10, 20, ... 80. Installed v0.0.45: older Stable are 40, 30, 20 (not 10); the three newest
    // older of any channel (44, 43, 42) ride along. Installed v0.0.15: older Stable is 10 only, any channel 14, 13, 12.
    const out = tags(releaseWindow(catalogue, ctx({ installed: ['v0.0.45', 'v0.0.15'] })));
    // v0.0.15 is the oldest installed, so everything above it is kept too, then its own older rows.
    expect(out).toEqual([...v(12, 80), 'v0.0.10']);
    const one = tags(releaseWindow(catalogue, ctx({ installed: ['v0.0.45'], recent: 0 })));
    expect(one).toEqual([...v(42, 80), 'v0.0.40', 'v0.0.30', 'v0.0.20']);
    // The fourth older Stable and the Dev rows between are not kept.
    expect(one).not.toContain('v0.0.10');
    expect(one).not.toContain('v0.0.41');
  });

  it('keeps three older releases of any channel per installed tag (a Dev fleet\'s Roll back)', () => {
    // v0.0.20 is 60 releases behind the newest, so rules 1 and 2 reach nothing below it. Its Roll back list on a Dev
    // fleet is the three newest older rows of any channel: 19, 18, 17 (Dev rows); the one older Stable (10) rides too.
    const out = tags(releaseWindow(catalogue, ctx({ installed: ['v0.0.20'] })));
    expect(out).toEqual([...v(17, 80), 'v0.0.10']);
    expect(out).not.toContain('v0.0.16');
  });

  it('keeps each installed tag\'s own row however old', () => {
    const out = tags(releaseWindow(catalogue, ctx({ installed: ['v0.0.3'], recent: 0, stableBack: 0 })));
    expect(out).toEqual(v(3, 80));
    // a middle installed tag is its own row too, even where nothing else would keep it
    const mid = tags(releaseWindow(catalogue, ctx({ installed: ['v0.0.2', 'v0.0.1'], recent: 0, stableBack: 0 })));
    expect(mid).toContain('v0.0.1');
    expect(mid).toContain('v0.0.2');
  });

  it('no duplicates and newest first', () => {
    const out = tags(releaseWindow([...catalogue].reverse(), ctx({
      installed: ['v0.0.60', 'v0.0.60'], previous: ['v0.0.75', 'v0.0.5'], intentTags: ['v0.0.5', 'v0.0.80'],
    })));
    expect(new Set(out).size).toBe(out.length);
    expect(out).toEqual([...v(51, 80), 'v0.0.50', 'v0.0.40', 'v0.0.30', 'v0.0.5']);
    // numeric, not lexical, order
    const sorted = [...out].sort((a, b) => Number(b.split('.')[2]) - Number(a.split('.')[2]));
    expect(out).toEqual(sorted);
  });

  it('puts rows whose tag is not a release tag after the tagged ones, in input order', () => {
    const rows: Row[] = [{ tag: 'zzz', channel: null }, { tag: 'v0.0.1', channel: 'dev' }, { tag: 'aaa', channel: null }, { tag: 'v0.0.2', channel: 'dev' }];
    expect(tags(releaseWindow(rows, ctx()))).toEqual(['v0.0.2', 'v0.0.1', 'zzz', 'aaa']);
  });

  it('a non-tag installed value is ignored, never thrown on', () => {
    const bad = ['', 'garbage', 'v1', 'v0.0.x', null as unknown as string, undefined as unknown as string];
    expect(() => releaseWindow(catalogue, ctx({ installed: bad, previous: bad, intentTags: bad }))).not.toThrow();
    expect(tags(releaseWindow(catalogue, ctx({ installed: bad, previous: bad, intentTags: bad })))).toEqual(v(51, 80));
    // one good value among bad ones still counts
    expect(tags(releaseWindow(catalogue, ctx({ installed: ['garbage', 'v0.0.45'], recent: 0 }))))
      .toEqual([...v(42, 80), 'v0.0.40', 'v0.0.30', 'v0.0.20']);
  });

  it('an empty catalogue answers empty', () => {
    expect(releaseWindow([], ctx({ installed: ['v0.0.5'], previous: ['v0.0.4'], intentTags: ['v0.0.3'] }))).toEqual([]);
  });

  it('does not mutate its input', () => {
    const copy = catalogue.map((r) => ({ ...r }));
    releaseWindow(catalogue, ctx({ installed: ['v0.0.45'] }));
    expect(catalogue).toEqual(copy);
  });

  it('returns the original row objects', () => {
    const out = releaseWindow(catalogue, ctx());
    expect(out[0]).toBe(catalogue[79]);
  });
});
