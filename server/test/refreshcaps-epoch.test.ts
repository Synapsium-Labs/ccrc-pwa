// Path-identity spec 2026-10-12 §5.2: capabilities never cross a reconnect. `ccdVerbs` survives a close, so a
// `caps` answer asked on one connection and landing after a close and a fresh ready would describe the old agent
// to every reader of the new one. The refresh writes only on the epoch it asked under.
import { describe, expect, it } from 'vitest';
import { FleetIdentityCell } from '../src/fleetidentity.js';
import { makeRefreshCaps } from '../src/refreshcaps.js';
import type { FleetState } from '../src/remote/client.js';

describe('caps never cross a reconnect', () => {
  it('a caps answer that resolves after an invalidation writes nothing', async () => {
    const state: FleetState = { connected: true, downSince: null, ccdVerbs: ['start', 'ws-audit'], rosterFp: null, build: null };
    const cell = new FleetIdentityCell();
    cell.invalidate('awaiting-inventory');
    // Asked on epoch 1; while it is out, the link closes and a new ready is accepted.
    const crossing = makeRefreshCaps({
      caps: async () => { cell.invalidate('link-down'); cell.invalidate('awaiting-inventory'); return ['start']; },
    }, state, cell);
    await crossing();
    expect(state.ccdVerbs).toEqual(['start', 'ws-audit']);
    // CONTROL: the same answer on an unchanged epoch writes, so the guard is the epoch and nothing else.
    const steady = makeRefreshCaps({ caps: async () => ['start'] }, state, cell);
    await steady();
    expect(state.ccdVerbs).toEqual(['start']);
  });
});
