// Console speed S2: the serve-or-read decider, and that it agrees with `fleetRowsUsable`, the one decider it
// generalises (`lifecycle.ts` is not edited by S2, so this table is what keeps the two answering the same).
import { describe, it, expect } from 'vitest';
import { servedFromWatcher } from '../src/servedRead.js';
import { fleetRowsUsable, type FleetRowsListing } from '../src/lifecycle.js';

describe('servedFromWatcher', () => {
  it('serves under the bound with ageMs', () => {
    const stamped = { listedAt: 1_000, tag: 'sess-a' };
    const out = servedFromWatcher(stamped, 1_500, 20_000);
    expect(out).toEqual({ serve: true, value: stamped, ageMs: 500 });
    if (out.serve) expect(out.value).toBe(stamped);
  });

  it('does not serve at the bound', () => {
    expect(servedFromWatcher({ listedAt: 1_000 }, 21_000, 20_000)).toEqual({ serve: false });
    expect(servedFromWatcher({ listedAt: 1_000 }, 20_999, 20_000).serve).toBe(true);
  });

  it('does not serve a negative age', () => {
    expect(servedFromWatcher({ listedAt: 5_000 }, 4_999, 20_000)).toEqual({ serve: false });
  });

  it('does not serve null', () => {
    expect(servedFromWatcher(null, 1_000, 20_000)).toEqual({ serve: false });
  });

  it('fleetRowsUsable answers what it answered before', () => {
    const sessions = [{ project: 'project-a', workdir: '/w/project-a' }];
    const listed = (listedAt: number): FleetRowsListing => ({ sessions, listedAt });
    const table: Array<{ name: string; listing: FleetRowsListing | null; now: number; bound: number }> = [
      { name: 'under', listing: listed(1_000), now: 10_000, bound: 20_000 },
      { name: 'at', listing: listed(1_000), now: 21_000, bound: 20_000 },
      { name: 'over', listing: listed(1_000), now: 60_000, bound: 20_000 },
      { name: 'negative age', listing: listed(9_000), now: 1_000, bound: 20_000 },
      { name: 'zero age', listing: listed(1_000), now: 1_000, bound: 20_000 },
      { name: 'null listing', listing: null, now: 1_000, bound: 20_000 },
    ];
    for (const row of table) {
      const rows = fleetRowsUsable(row.listing, row.now, row.bound);
      const served = servedFromWatcher(row.listing, row.now, row.bound);
      expect(served.serve, row.name).toBe(rows !== null);
      if (served.serve) expect(served.value.sessions, row.name).toBe(rows);
      else expect(rows, row.name).toBeNull();
    }
  });
});
