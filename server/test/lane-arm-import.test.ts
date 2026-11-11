// D-8274 (worktree economy spec 2026-10-28 R-6): the roster card's retired marker is imported ONCE, off the watcher's own
// registry listing. The first tick that lists the registry after the upgrade sets the never-written Shadow lanes row Live
// when `$REG/coordinator-roster-card-live` stands, records a feed row naming the file, and from then on the marker is not
// read: removing it, re-creating it, or restarting the server changes nothing. Driven through a real `FleetWatcher.tick()`
// over a fixture HOME (`approvalsHarness.ts`'s fixture), no live box.
import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LANE_ARM_FEED_TITLE } from '../../shared/lane-arm.js';
import { COORDINATOR_ROSTER_CARD_LIVE_MARKER } from '../../shared/switches.js';
import { approvalsFixture, type Approvals } from './approvalsHarness.js';

let f: Approvals | undefined;
afterEach(async () => { if (f) await f.close(); f = undefined; });

const marker = (fx: Approvals): string => path.join(fx.home, '.cc-sessions', COORDINATOR_ROSTER_CARD_LIVE_MARKER);
const imports = (fx: Approvals) => fx.coord.feedEvents(50).filter((e) => e.title === LANE_ARM_FEED_TITLE.imported).map((e) => e.body);

describe('the roster card marker import (D-8274)', () => {
  it('a standing marker sets the row Live on the first listed tick, with one feed row naming the file; then it is never read', async () => {
    f = await approvalsFixture();
    writeFileSync(marker(f), '');
    await f.watcher.tick();
    expect(f.coord.laneArmSetting('roster-card')).toMatchObject({ kind: 'row', choice: 'live', imported: 'stood' });
    expect(imports(f)).toEqual([
      `roster-card: set live from the standing ${COORDINATOR_ROSTER_CARD_LIVE_MARKER} marker; the marker is no longer read and can be removed`,
    ]);
    // The operator sets it back to shadow from the card; the marker still standing does not arm it again, on this
    // watcher or on a restarted one.
    f.coord.setLaneArm('roster-card', 'shadow', Date.now());
    await f.watcher.tick();
    await f.restart();
    await f.watcher.tick();
    expect(f.coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'shadow' });
    expect(imports(f)).toHaveLength(1);
  });

  it('no marker: the row stays shadow, the import is recorded, and a marker created later is never read', async () => {
    f = await approvalsFixture();
    await f.watcher.tick();
    expect(f.coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'shadow', updatedAt: 0, imported: 'absent' });
    writeFileSync(marker(f), '');
    await f.watcher.tick();
    expect(f.coord.laneArmSetting('roster-card')).toMatchObject({ choice: 'shadow', updatedAt: 0 });
    expect(imports(f)).toEqual([]);
    rmSync(marker(f));
  });
});
