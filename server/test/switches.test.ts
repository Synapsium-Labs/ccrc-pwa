// D-5855 (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1a; ARCH-70 (#805);
// spec 2026-10-19 K12, §2.3). The switchboard: every operator switch is one row of L0 `SWITCHES`, read by one
// `readSwitches(listing)` that answers the wire's `MarkerState` per marker row and never resolves `'unmeasurable'`.
//
// The first describe is the CHARACTERIZATION PIN (spec §5.1 rule 1): every marker constant the server exports today,
// read through the module that exports it, against the value it has on the PR's base. It is green on the old code and
// stays green through every move commit, because the old names keep exporting the same characters.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER, RECLAIM_PAUSE_MARKER,
} from '../src/coord/rundefs.js';
import { HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER } from '../src/coord/hibernate.js';
import { EXPIRE_CHILD_LIVE_MARKER, EXPIRE_LANE_LIVE_MARKER, STALE_ARCHIVE_LIVE_MARKER } from '../src/archivedExpiry.js';
import { COLLECT_LANE_LIVE_MARKER } from '../src/collectLane.js';
import { DEAD_COORDINATOR_LANE_LIVE_MARKER } from '../src/deadCoordinator.js';
import { IDLE_NUDGE_DISABLED_MARKER } from '../src/idlenudge.js';
import { STOP_DONE_DISABLED_MARKER } from '../src/stopDone.js';
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER } from '../src/turnidle.js';
import { isMarkerState } from '../../shared/api.js';
import {
  ASKS_DISABLED_MARKER, CHILD_RECLAIM_DISABLED_MARKER, CHILD_STALE_RECLAIM_LIVE_MARKER, COLLECT_LOOSE_LIVE_MARKER, DRIFT_PUSH_LIVE_MARKER,
  NESTED_RESCUE_LIVE_MARKER, ORPHAN_TREE_LIVE_MARKER, ORPHAN_TREE_RESCUE_LIVE_MARKER, SWITCHES, markerSwitchNames, readSwitches,
} from '../../shared/switches.js';

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
  EXPIRE_CHILD_LIVE_MARKER: 'expire-child-live',
  STALE_ARCHIVE_LIVE_MARKER: 'stale-archive-live',
  COLLECT_LANE_LIVE_MARKER: 'collect-lane-live',
  DEAD_COORDINATOR_LANE_LIVE_MARKER: 'dead-coordinator-lane-live',
  ORPHAN_TREE_LIVE_MARKER: 'orphan-tree-live',
  ORPHAN_TREE_RESCUE_LIVE_MARKER: 'orphan-tree-rescue-live',
  NESTED_RESCUE_LIVE_MARKER: 'nested-rescue-live',
  CHILD_STALE_RECLAIM_LIVE_MARKER: 'child-stale-reclaim-live',
  IDLE_NUDGE_DISABLED_MARKER: 'idle-compact-nudge-disabled',
  MAIL_GATE_STRICT_MARKER: 'mail-gate-strict',
  MAIL_GATE_BUSY_MARKER: 'mail-gate-busy',
  MAIL_GATE_BUSY_SHADOW_MARKER: 'mail-gate-busy-shadow',
};

describe('characterization: every exported marker constant keeps its value (D-5855)', () => {
  const EXPORTED: Record<string, string> = {
    MAIL_DISABLED_MARKER, COORDINATOR_PAUSE_MARKER, RECLAIM_PAUSE_MARKER, STOP_DONE_DISABLED_MARKER,
    HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER, EXPIRE_LANE_LIVE_MARKER, EXPIRE_CHILD_LIVE_MARKER, STALE_ARCHIVE_LIVE_MARKER, COLLECT_LANE_LIVE_MARKER,
    DEAD_COORDINATOR_LANE_LIVE_MARKER, ORPHAN_TREE_LIVE_MARKER, ORPHAN_TREE_RESCUE_LIVE_MARKER, NESTED_RESCUE_LIVE_MARKER, CHILD_STALE_RECLAIM_LIVE_MARKER,
    IDLE_NUDGE_DISABLED_MARKER, MAIL_GATE_STRICT_MARKER, MAIL_GATE_BUSY_MARKER,
    MAIL_GATE_BUSY_SHADOW_MARKER,
  };

  it('every marker value equals today\'s, read through the module that exports it', () => {
    expect(EXPORTED).toEqual(TODAY);
  });
});

describe('the switchboard: SWITCHES rows and readSwitches (D-5855)', () => {
  const rows = Object.entries(SWITCHES) as [string, (typeof SWITCHES)[keyof typeof SWITCHES]][];
  const markerRows = rows.filter(([, r]) => 'marker' in r.storage);
  const settingRows = rows.filter(([, r]) => 'setting' in r.storage);

  it('every exported marker constant is a marker row, keyed by its own name', () => {
    const markers = markerRows.map(([k, r]) => { expect('marker' in r.storage && r.storage.marker, k).toBe(k); return k; });
    expect(ASKS_DISABLED_MARKER).toBe('asks-disabled');
    // D-6627: the collector's loose arm joins as a row of its own, with no writer (single-definition pins that).
    expect(COLLECT_LOOSE_LIVE_MARKER).toBe('collect-loose-live');
    // D-5922: the drift reconciler's push arm, a hand-armed row with no writer in the tree.
    expect(DRIFT_PUSH_LIVE_MARKER).toBe('drift-push-live');
    // ARCH-77 (#812): child reclaim's own off switch, a hand-touched row with no writer in the tree.
    expect(CHILD_RECLAIM_DISABLED_MARKER).toBe('child-reclaim-disabled');
    expect(markers.sort()).toEqual([...Object.values(TODAY), 'asks-disabled', 'landing-disabled', 'landing-checks-live', 'collect-loose-live', 'drift-push-live', 'child-reclaim-disabled', 'coordinator-roster-card-live'].sort());
    expect([...markerSwitchNames].sort()).toEqual(markers.sort());
  });

  it('ARCH-77: child reclaim has its own off switch, hand-only, whose absence means armed (#812)', () => {
    const row = SWITCHES[CHILD_RECLAIM_DISABLED_MARKER];
    expect(row.writer).toBe('hand-only');
    expect(row.owner).toBe('C4');
    expect(row.default).toMatch(/^absent: /);
    // No reader yet (the child-spent reader lands with ARCH-44): the operator sentence must not claim the switch acts today.
    expect(row.meaning).toMatch(/Nothing reads it yet/);
    // Absence changes nothing: a listing without the marker reads 'clear' for it and leaves every other row as it was.
    const without = readSwitches(['mail-disabled']);
    const withIt = readSwitches(['mail-disabled', CHILD_RECLAIM_DISABLED_MARKER]);
    expect(without[CHILD_RECLAIM_DISABLED_MARKER]).toBe('clear');
    expect(withIt[CHILD_RECLAIM_DISABLED_MARKER]).toBe('set');
    expect(readSwitches(['reclaim-paused'])[CHILD_RECLAIM_DISABLED_MARKER]).toBe('clear');
    expect({ ...withIt, [CHILD_RECLAIM_DISABLED_MARKER]: 'clear' }).toEqual(without);
    expect(readSwitches(null)[CHILD_RECLAIM_DISABLED_MARKER]).toBe('unmeasurable');
  });

  it('the settings switches are rows that name their table and column', () => {
    expect(Object.fromEntries(settingRows.map(([k, r]) => [k, 'setting' in r.storage ? r.storage.setting : null]))).toEqual({
      'stall-watch-level': 'stall_settings.level',
      'collect-lane-choice': 'collect_lane_settings.choice',
    });
  });

  it('every row has a non-empty meaning, default and writer, and an owner among the spec\'s contexts', () => {
    for (const [k, r] of rows) {
      expect(r.meaning.trim().length, `${k}: meaning`).toBeGreaterThan(10);
      expect(r.default.trim().length, `${k}: default`).toBeGreaterThan(0);
      expect(r.writer.trim().length, `${k}: writer`).toBeGreaterThan(0);
      expect(r.owner, `${k}: owner`).toMatch(/^C[1-9]$/);
    }
  });

  it('the writers are the ones the tree has: two route-backed ccd verbs, two settings routes, the rest by hand', () => {
    const writers = Object.fromEntries(rows.filter(([, r]) => r.writer !== 'hand-only').map(([k, r]) => [k, r.writer]));
    expect(writers).toEqual({
      'coordinator-paused': 'ccd coord-pause, through POST /api/coord/pause',
      'reclaim-paused': 'ccd reclaim-pause, through POST /api/coord/reclaim-pause',
      'stall-watch-level': 'POST /api/coord/stall-watch',
      'collect-lane-choice': 'POST /api/coord/collect-lane',
    });
  });

  it('every ccd-verb writer names a verb ccdargv builds and a route that runs it', () => {
    const argvSrc = readFileSync(new URL('../src/ccdargv.ts', import.meta.url), 'utf8');
    const routesSrc = readFileSync(new URL('../src/coord/routes.ts', import.meta.url), 'utf8');
    for (const [k, r] of rows) {
      const m = /^ccd ([a-z-]+), through POST (\/api\/[a-z/-]+)$/.exec(r.writer);
      if (!r.writer.startsWith('ccd ')) continue;
      expect(m, `${k}: writer shape`).not.toBeNull();
      expect(argvSrc.includes(`argv(['${m![1]}'`), `${k}: ccdargv builds ${m![1]}`).toBe(true);
      expect(routesSrc.includes(`app.post('${m![2]}'`), `${k}: ${m![2]} exists`).toBe(true);
    }
  });

  it('a listing with reclaim-paused is set for it and clear for every other marker row', () => {
    const r = readSwitches(['reclaim-paused', 'unrelated-file']);
    for (const k of markerSwitchNames) expect(r[k], k).toBe(k === 'reclaim-paused' ? 'set' : 'clear');
  });

  it('a marker matches by its exact name, never a substring: a longer name or a prefixed file does not set it', () => {
    const r = readSwitches(['mail-gate-busy-shadow', 'abc.mail-disabled', 'xreclaim-paused']);
    expect(r['mail-gate-busy-shadow']).toBe('set');
    expect(r['mail-gate-busy']).toBe('clear');
    expect(r['mail-disabled']).toBe('clear');
    expect(r['reclaim-paused']).toBe('clear');
  });

  it('an unlistable registry is never clear: a null listing is unmeasurable for every marker row', () => {
    const r = readSwitches(null);
    for (const k of markerSwitchNames) expect(r[k], k).toBe('unmeasurable');
  });

  it('every answer is the wire\'s MarkerState, and a settings row ignores the listing', () => {
    const r: Record<string, unknown> = readSwitches(['stall-watch-level', 'collect-lane-choice', 'mail-disabled']);
    for (const v of Object.values(r)) expect(isMarkerState(v)).toBe(true);
    expect(Object.keys(r).sort()).toEqual([...markerSwitchNames].sort());
    expect(r['stall-watch-level']).toBeUndefined();
    expect(r['collect-lane-choice']).toBeUndefined();
  });
});
