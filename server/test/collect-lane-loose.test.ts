// Fleet disk retention DR-15 (D-6627, spec 2026-10-23 section 2.4): the collect lane's LOOSE arm, in shadow.
// The first block CHARACTERISES what the lane did before the arm (green on the old code): a witnessed leaf is the
// whole population, and the open-run hold holds a fresh witnessed collection that names no run. FIXTURE HOME ONLY.
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { collectOpenRunHold } from '../src/coord/collectTempRoot.js';
import { collectPopulation } from '../src/collectLane.js';
import { collectRig } from './collectLaneFixture.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('characterisation: the lane before the loose arm', () => {
  it('a witnessed id is the whole population, and a registry row filters it', () => {
    const pop = collectPopulation({
      tmproots: { kind: 'listed', names: ['demo-a', 'demo-b'] }, tmpquarantine: { kind: 'absent' },
      registryNames: new Set(['demo-b.child']),
    });
    expect(pop.ids).toEqual(['demo-a', 'demo-b']);
    expect(pop.candidates).toEqual(['demo-a']);
    expect(pop.bothMeasured).toBe(true);
  });

  it('a witnessed leaf is audited, and two observations an interval apart record its would-collect', async () => {
    const f = await collectRig();
    f.pastHoldOff();
    f.witness('demo-a');
    await f.passesUntil(() => f.wouldCollects('demo-a').length > 0, 4);
    expect(f.audits('demo-a').length).toBeGreaterThanOrEqual(2);
    expect(f.collects('demo-a')).toEqual([]);
  });

  it('the open-run hold holds a fresh collection whose witness names no run, and clears a finished one', () => {
    const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-loose-char-'), '.ccrc', 'coord.db')));
    expect(collectOpenRunHold(coord, 'demo-a', { resume: null, witnessRun: null, witnessAt: null }))
      .toMatchObject({ kind: 'held', why: 'no-witness-run' });
  });
});
