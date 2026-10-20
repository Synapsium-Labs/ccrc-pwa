// D-5855 (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1a; ARCH-70 (#805);
// spec 2026-10-19 K12, §2.3). The switchboard: every operator switch is one row of L0 `SWITCHES`, read by one
// `readSwitches(listing)` that answers the wire's `MarkerState` per marker row and never resolves `'unmeasurable'`.
//
// The first describe is the CHARACTERIZATION PIN (spec §5.1 rule 1): every marker constant the server exports today,
// read through the module that exports it, against the value it has on the PR's base. It is green on the old code and
// stays green through every move commit, because the old names keep exporting the same characters.
import { describe, expect, it } from 'vitest';
import {
  COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER, RECLAIM_PAUSE_MARKER,
} from '../src/coord/rundefs.js';
import { HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER } from '../src/coord/hibernate.js';
import { EXPIRE_LANE_LIVE_MARKER } from '../src/archivedExpiry.js';
import { COLLECT_LANE_LIVE_MARKER } from '../src/collectLane.js';
import { DEAD_COORDINATOR_LANE_LIVE_MARKER } from '../src/deadCoordinator.js';
import { IDLE_NUDGE_DISABLED_MARKER } from '../src/idlenudge.js';
import { STOP_DONE_DISABLED_MARKER } from '../src/stopDone.js';
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER } from '../src/turnidle.js';

/** Today's marker values, typed once here as the table the switchboard must equal. `asks-disabled` is `watch.ts`'s
 *  private constant on the base, so it has no export to read; the switchboard rows below hold it. */
const TODAY: Record<string, string> = {
  MAIL_DISABLED_MARKER: 'mail-disabled',
  COORDINATOR_PAUSE_MARKER: 'coordinator-paused',
  RECLAIM_PAUSE_MARKER: 'reclaim-paused',
  STOP_DONE_DISABLED_MARKER: 'stop-done-disabled',
  HIBERNATE_DISABLED_MARKER: 'hibernate-disabled',
  HIBERNATE_LIVE_MARKER: 'hibernate-live',
  EXPIRE_LANE_LIVE_MARKER: 'expire-lane-live',
  COLLECT_LANE_LIVE_MARKER: 'collect-lane-live',
  DEAD_COORDINATOR_LANE_LIVE_MARKER: 'dead-coordinator-lane-live',
  IDLE_NUDGE_DISABLED_MARKER: 'idle-compact-nudge-disabled',
  MAIL_GATE_STRICT_MARKER: 'mail-gate-strict',
  MAIL_GATE_BUSY_MARKER: 'mail-gate-busy',
  MAIL_GATE_BUSY_SHADOW_MARKER: 'mail-gate-busy-shadow',
};

describe('characterization: every exported marker constant keeps its value (D-5855)', () => {
  const EXPORTED: Record<string, string> = {
    MAIL_DISABLED_MARKER, COORDINATOR_PAUSE_MARKER, RECLAIM_PAUSE_MARKER, STOP_DONE_DISABLED_MARKER,
    HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER, EXPIRE_LANE_LIVE_MARKER, COLLECT_LANE_LIVE_MARKER,
    DEAD_COORDINATOR_LANE_LIVE_MARKER, IDLE_NUDGE_DISABLED_MARKER, MAIL_GATE_STRICT_MARKER, MAIL_GATE_BUSY_MARKER,
    MAIL_GATE_BUSY_SHADOW_MARKER,
  };

  it('every marker value equals today\'s, read through the module that exports it', () => {
    expect(EXPORTED).toEqual(TODAY);
  });
});
