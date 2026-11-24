// Overlord W1, the renewal readings PR C (plan `w1-renewal-readings.md` Task 6; slug lane-raises-the-latch-as-a-lane): a server
// lane raises a latch through the ladder's one raise path as a `LaneRaiser`, a frozen token only `laneRaiser` makes. It is
// taken on the brake side only, records its lane name in `raisedBy`, and a structurally equal literal is refused.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NO_LADDER_AUTHORITY } from '../src/coord/overlordAuthorityJournal.js';
import { raiseLatch } from '../src/coord/overlordLadderRead.js';
import { ladderActor, laneRaiser } from '../src/coord/overlordLadderStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(async () => { await removeTmpFixtures(); });

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-lane-raiser-'), 'coord.db')));
const deps = (coord: CoordStore) => ({ coord, journal: NO_LADDER_AUTHORITY, clock: { wall: () => 1_000 }, entropy: { hex: (n: number) => 'b'.repeat(2 * n) } });

describe('the lane raiser', () => {
  it('a brake takes it and records the lane name; a widening never does', () => {
    const lane = laneRaiser('renewal-lane');
    expect(Object.isFrozen(lane)).toBe(true);
    expect(ladderActor(lane, 'brake')).toEqual({ ok: true, subject: 'renewal-lane' });
    expect(ladderActor(lane, 'widen')).toEqual({ ok: false, reason: 'actor' });
  });

  it('a structurally equal literal is not one: refused', () => {
    expect(ladderActor({ kind: 'lane', lane: 'renewal-lane' }, 'brake')).toEqual({ ok: false, reason: 'actor' });
  });

  it('only a lane the map names can be made', () => {
    expect(() => laneRaiser('another-lane' as never)).toThrow(/not a lane that raises a latch/);
  });

  it('raises probes-failed-twice through the one raise path: the cap is the row\'s (chat), raisedBy the lane; a second raise changes nothing', () => {
    const coord = store();
    const first = raiseLatch(deps(coord), 'probes-failed-twice', 'generation 4 of the Overlord degraded', laneRaiser('renewal-lane'));
    expect(first).toMatchObject({ ok: true, changed: true, notice: 'none' });
    expect(coord.db.prepare('SELECT cause, cap, detail, raisedBy, clearedAt FROM overlord_latches').all()).toEqual([
      { cause: 'probes-failed-twice', cap: 'chat', detail: 'generation 4 of the Overlord degraded', raisedBy: 'renewal-lane', clearedAt: null },
    ]);
    expect(raiseLatch(deps(coord), 'probes-failed-twice', 'again', laneRaiser('renewal-lane'))).toMatchObject({ ok: true, changed: false });
    expect(coord.db.prepare('SELECT COUNT(*) AS n FROM overlord_latches').get()).toEqual({ n: 1 });
    coord.db.close();
  });

  it('the literal is refused at the store too, and nothing is written', () => {
    const coord = store();
    expect(raiseLatch(deps(coord), 'probes-failed-twice', 'd', { kind: 'lane', lane: 'renewal-lane' } as never)).toMatchObject({ ok: false, reason: 'actor' });
    expect(coord.db.prepare('SELECT COUNT(*) AS n FROM overlord_latches').get()).toEqual({ n: 0 });
    coord.db.close();
  });
});
