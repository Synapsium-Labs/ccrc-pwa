import { describe, it, expect } from 'vitest';
import { FleetIdentityCell } from '../src/fleetidentity.js';
import { recordCcdVerbs } from '../src/fleetstate.js';
import { makeRefreshCaps } from '../src/refreshcaps.js';
import type { FleetState } from '../src/remote/client.js';

// `index.ts` (the composition root) is never imported by a test — it loads
// real config and opens a real port as side effects of module load alone, so
// importing it here would mean bootstrapping the whole process. This is the
// contract `index.ts` wires `makeRefreshCaps` into, tested where it's
// actually reachable: `null` (no evidence) must never overwrite a working
// list, and a real list always replaces whatever was there.
describe('makeRefreshCaps — the guard index.ts wires into Deps.refreshCaps', () => {
  it('null is no evidence — leaves a working list untouched', async () => {
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['start', 'stop'], rosterFp: null, build: null };
    const refreshCaps = makeRefreshCaps({ caps: async () => null }, state, new FleetIdentityCell(), recordCcdVerbs);

    await refreshCaps();

    expect(state.ccdVerbs).toEqual(['start', 'stop']);
  });

  it('a refresh answering null keeps the list', async () => {
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['start', 'ws-audit'], rosterFp: null, build: null };
    const cell = new FleetIdentityCell();
    cell.invalidate('awaiting-inventory');
    await makeRefreshCaps({ caps: async () => null }, state, cell, recordCcdVerbs)();
    expect(state.ccdVerbs).toEqual(['start', 'ws-audit']);
  });

  // index.ts's local mode: its identity cell is never invalidated (epoch 0), and its one read answers null when
  // `ccd caps` gave no evidence. That null keeps the null the boot path seeded; it is not turned into a list or [].
  it('local mode\'s null keeps null (epoch 0, the never-invalidated cell)', async () => {
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null };
    const cell = new FleetIdentityCell();
    expect(cell.epochNow()).toBe(0);
    await makeRefreshCaps({ caps: async () => null }, state, cell, recordCcdVerbs)();
    expect(state.ccdVerbs).toBeNull();
  });

  it('a real list replaces whatever was there, including an empty one', async () => {
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['start'], rosterFp: null, build: null };
    const refreshCaps = makeRefreshCaps({ caps: async () => ['start', 'ws-rename'] }, state, new FleetIdentityCell(), recordCcdVerbs);

    await refreshCaps();

    expect(state.ccdVerbs).toEqual(['start', 'ws-rename']);
  });
});
