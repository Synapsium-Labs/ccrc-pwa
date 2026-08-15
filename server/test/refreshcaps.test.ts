import { describe, it, expect } from 'vitest';
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
    const refreshCaps = makeRefreshCaps({ caps: async () => null }, state);

    await refreshCaps();

    expect(state.ccdVerbs).toEqual(['start', 'stop']);
  });

  it('a real list replaces whatever was there, including an empty one', async () => {
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['start'], rosterFp: null, build: null };
    const refreshCaps = makeRefreshCaps({ caps: async () => ['start', 'ws-rename'] }, state);

    await refreshCaps();

    expect(state.ccdVerbs).toEqual(['start', 'ws-rename']);
  });
});
