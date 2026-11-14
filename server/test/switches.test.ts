// D-5855 (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1a; ARCH-70 (#805);
// spec 2026-10-19 K12, §2.3). The switchboard: every operator switch is one row of L0 `SWITCHES`, read by one
// `readSwitches(listing)` that answers the wire's `MarkerState` per marker row and never resolves `'unmeasurable'`.
//
// The first describe is the CHARACTERIZATION PIN (spec §5.1 rule 1): every marker constant the server exports today,
// read through the module that exports it, against the value it has on the PR's base. It is green on the old code and
// stays green through every move commit, because the old names keep exporting the same characters.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { sqlStatementsIn, sqlStatementsInFile, symbolOf } from './scan/symbols.js';
import {
  ASKS_DISABLED_MARKER, AUTOCOMPACT_DISABLED_MARKER, CHILD_RECLAIM_DISABLED_MARKER, CHILD_STALE_RECLAIM_LIVE_MARKER, CHILD_SUPERSEDED_RECLAIM_LIVE_MARKER, COLLECT_LOOSE_LIVE_MARKER, DEPS_SHED_LIVE_MARKER, DRIFT_PUSH_LIVE_MARKER,
  DELEGATION_ADOPT_MARKER, NESTED_RESCUE_LIVE_MARKER, ORPHAN_TREE_LIVE_MARKER, RUNS_EXPIRE_NEVER_STARTED_MARKER, RUNS_EXPIRE_COORDINATOR_GONE_MARKER, ORPHAN_TREE_RESCUE_LIVE_MARKER, PANE_SCOPE_STOP_LIVE_MARKER, STALL_WATCH_DISABLED_MARKER, SWITCHES, TESTBOX_REMOTE_LIVE_MARKER, markerSwitchNames, readSwitches,
} from '../../shared/switches.js';
import { STALL_MARKERS, stallArmingOf } from '../src/coord/stall.js';

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
  CHILD_SUPERSEDED_RECLAIM_LIVE_MARKER: 'child-superseded-reclaim-live',
  IDLE_NUDGE_DISABLED_MARKER: 'idle-compact-nudge-disabled',
  MAIL_GATE_STRICT_MARKER: 'mail-gate-strict',
  MAIL_GATE_BUSY_MARKER: 'mail-gate-busy',
  MAIL_GATE_BUSY_SHADOW_MARKER: 'mail-gate-busy-shadow',
};

describe('characterization: every exported marker constant keeps its value (D-5855)', () => {
  const EXPORTED: Record<string, string> = {
    MAIL_DISABLED_MARKER, COORDINATOR_PAUSE_MARKER, RECLAIM_PAUSE_MARKER, STOP_DONE_DISABLED_MARKER,
    HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER, EXPIRE_LANE_LIVE_MARKER, EXPIRE_CHILD_LIVE_MARKER, STALE_ARCHIVE_LIVE_MARKER, COLLECT_LANE_LIVE_MARKER,
    DEAD_COORDINATOR_LANE_LIVE_MARKER, ORPHAN_TREE_LIVE_MARKER, ORPHAN_TREE_RESCUE_LIVE_MARKER, NESTED_RESCUE_LIVE_MARKER, CHILD_STALE_RECLAIM_LIVE_MARKER, CHILD_SUPERSEDED_RECLAIM_LIVE_MARKER,
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
    // D-7278: the deps-shed arm's live switch, a hand-armed row with no writer in the tree.
    expect(DEPS_SHED_LIVE_MARKER).toBe('deps-shed-live');
    // D-7404: the test box's remote switch, written later by a ccd verb behind a route (TB9); read by the wrapper (TB8).
    expect(TESTBOX_REMOTE_LIVE_MARKER).toBe('testbox-remote-live');
    // D-7902: the deliberate stop's pane-scope stop switch, written by a ccd verb behind a route, read by ccd's own act.
    expect(PANE_SCOPE_STOP_LIVE_MARKER).toBe('pane-scope-stop-live');
    // D-8339: the stall watch's kill switch, a hand-touched row with no writer in the tree; the Stall watch card names it.
    expect(STALL_WATCH_DISABLED_MARKER).toBe('stall-watch-disabled');
    // Delegation PR7 (W5-X1): the adoption marker; since PR8b (D-8112) written by a ccd verb behind a route, read by the lane.
    expect(DELEGATION_ADOPT_MARKER).toBe('delegation-adopt');
    // D-8382: ccd's proactive compaction kill switch, a hand-touched row with no writer in the tree.
    expect(AUTOCOMPACT_DISABLED_MARKER).toBe('autocompact-disabled');
    expect(markers.sort()).toEqual([...Object.values(TODAY), 'asks-disabled', 'landing-disabled', 'landing-checks-live', 'collect-loose-live', 'drift-push-live', 'child-reclaim-disabled', 'coordinator-roster-card-live', 'deps-shed-live', TESTBOX_REMOTE_LIVE_MARKER, PANE_SCOPE_STOP_LIVE_MARKER, 'scope-sweep-live', 'scope-sweep-busy-live', DELEGATION_ADOPT_MARKER, RUNS_EXPIRE_NEVER_STARTED_MARKER, RUNS_EXPIRE_COORDINATOR_GONE_MARKER, STALL_WATCH_DISABLED_MARKER, AUTOCOMPACT_DISABLED_MARKER].sort());
    expect([...markerSwitchNames].sort()).toEqual(markers.sort());
  });

  it('ARCH-77: child reclaim has its own off switch, hand-only, whose absence means armed (#812)', () => {
    const row = SWITCHES[CHILD_RECLAIM_DISABLED_MARKER];
    expect(row.writer).toBe('hand-only');
    expect(row.owner).toBe('C4');
    expect(row.default).toMatch(/^absent: /);
    // The reader landed ahead of ARCH-44 by operator need: the sentence says what it stops and what it leaves running.
    expect(row.meaning).toMatch(/Switches off child reclaim alone/);
    expect(row.meaning).toMatch(/Expiry, collect, the dead-coordinator lane and stop-done keep running/);
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
      'roll-idle-targets': 'roll_settings.targets',
      'dispatch-abandon-choice': 'dispatch_abandon_settings.choice',
      'run-close-never-started-choice': 'run_close_settings.neverStarted',
      'run-close-claimant-crashed-choice': 'run_close_settings.claimantCrashed',
      'run-close-claimant-gone-choice': 'run_close_settings.claimantGone',
      'plain-auto-memory': 'plain_memory_settings.choice',
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

  it('the writers are the ones the tree has or a named task adds: six route-backed ccd verbs, five settings routes, the rest by hand (the sixth, delegation-adopt, D-8112; the fifth route, plain-auto-memory)', () => {
    const writers = Object.fromEntries(rows.filter(([, r]) => r.writer !== 'hand-only').map(([k, r]) => [k, r.writer]));
    expect(writers).toEqual({
      'coordinator-paused': 'ccd coord-pause, through POST /api/coord/pause',
      'reclaim-paused': 'ccd reclaim-pause, through POST /api/coord/reclaim-pause',
      'stall-watch-level': 'POST /api/coord/stall-watch',
      'collect-lane-choice': 'POST /api/coord/collect-lane',
      'testbox-remote-live': 'ccd testbox-remote, through POST /api/testbox/switch',
      'pane-scope-stop-live': 'ccd pane-scope-stop, through POST /api/coord/pane-scope-stop',
      'scope-sweep-busy-live': 'ccd scope-sweep-busy, through POST /api/coord/scope-sweep',
      'delegation-adopt': 'ccd delegation-adopt, through POST /api/coord/delegation-adopt',
      'roll-idle-targets': 'POST /api/coord/roll-idle',
      'dispatch-abandon-choice': 'POST /api/coord/dispatch-abandon',
      'run-close-never-started-choice': 'POST /api/coord/run-close',
      'run-close-claimant-crashed-choice': 'POST /api/coord/run-close',
      'run-close-claimant-gone-choice': 'POST /api/coord/run-close',
      'plain-auto-memory': 'POST /api/coord/plain-auto-memory',
    });
  });

  /** D-7404: a row whose writer a later task of its plan builds. Each entry names that task, and its row below asserts
   *  the verb and the route are still ABSENT, so the entry goes red the day the writer lands and must be deleted then.
   *  D-7411: the test box switch's entry is deleted with its writer (`ccd testbox-remote`, `CCD_ARGV.testboxRemote`,
   *  `POST /api/testbox/switch`, test box plan TB9), so the row above now checks it like every other ccd-verb writer. */
  const PENDING_WRITERS: Readonly<Record<string, string>> = {};

  it('every ccd-verb writer names a verb ccdargv builds and a route that runs it', () => {
    const argvSrc = readFileSync(new URL('../src/ccdargv.ts', import.meta.url), 'utf8');
    const routesSrc = readFileSync(new URL('../src/coord/routes.ts', import.meta.url), 'utf8');
    for (const [k, r] of rows) {
      const m = /^ccd ([a-z-]+), through POST (\/api\/[a-z/-]+)$/.exec(r.writer);
      if (!r.writer.startsWith('ccd ')) continue;
      expect(m, `${k}: writer shape`).not.toBeNull();
      if (k in PENDING_WRITERS) continue;
      expect(argvSrc.includes(`argv(['${m![1]}'`), `${k}: ccdargv builds ${m![1]}`).toBe(true);
      expect(routesSrc.includes(`app.post('${m![2]}'`), `${k}: ${m![2]} exists`).toBe(true);
    }
  });

  it('a pending writer is still absent: no ccdargv builder and no server route spells it yet (delete the entry when its task lands)', () => {
    const argvSrc = readFileSync(new URL('../src/ccdargv.ts', import.meta.url), 'utf8');
    const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));
    const serverSrc = (readdirSync(srcRoot, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(path.join(srcRoot, f), 'utf8'));
    expect(serverSrc.length, 'the walk reached server/src').toBeGreaterThan(100);
    expect(Object.keys(PENDING_WRITERS), 'no row waits on a writer since TB9 (D-7411)').toEqual([]);
    for (const [k, why] of Object.entries(PENDING_WRITERS)) {
      const row = (SWITCHES as Readonly<Record<string, { writer: string }>>)[k];
      expect(row, `${k} is a row`).toBeDefined();
      const m = /^ccd ([a-z-]+), through POST (\/api\/[a-z/-]+)$/.exec(row!.writer);
      expect(m, `${k}: writer shape`).not.toBeNull();
      expect(argvSrc.includes(`argv(['${m![1]}'`), `${k}: ccdargv already builds ${m![1]} (${why}): delete the pending entry`).toBe(false);
      expect(serverSrc.some((src) => src.includes(m![2]!)), `${k}: ${m![2]} already exists in server/src (${why}): delete the pending entry`).toBe(false);
    }
  });

  it('D-7404: the test box\'s switch is C2\'s, absent means every run is local, and its writer is the switch route', () => {
    const row = SWITCHES[TESTBOX_REMOTE_LIVE_MARKER];
    expect(row).toEqual({
      storage: { marker: 'testbox-remote-live' }, default: 'absent: every run is local', owner: 'C2',
      meaning: expect.stringMatching(/test box/), writer: 'ccd testbox-remote, through POST /api/testbox/switch',
    });
    // Appended: the last row of the table, after every row the base had.
    expect(Object.keys(SWITCHES).at(-1)).toBe(TESTBOX_REMOTE_LIVE_MARKER);
    expect(readSwitches([TESTBOX_REMOTE_LIVE_MARKER])[TESTBOX_REMOTE_LIVE_MARKER]).toBe('set');
    expect(readSwitches([])[TESTBOX_REMOTE_LIVE_MARKER]).toBe('clear');
    expect(readSwitches(null)[TESTBOX_REMOTE_LIVE_MARKER]).toBe('unmeasurable');
  });

  it('the table has 48 rows: 37 markers, 8 settings and 3 ~/.ccrc files (30 at the test box contract\'s base; roll-idle-targets the third setting, dispatch-abandon-choice the fourth; pane-scope-stop-live, D-7902; the sweep\'s two switches, D-7994; delegation-adopt, delegation PR7; runs-expire-never-started, D-8077; the two run-close choices, D-8077; runs-expire-coordinator-gone and its choice, D-8078; stall-watch-disabled, D-8339; autocompact-disabled and the three ~/.ccrc off switches, D-8382; plain-auto-memory, Overlord W1a launch profiles PR B)', () => {
    const fileRows = rows.filter(([, r]) => 'ccrcFile' in r.storage);
    expect([rows.length, markerRows.length, settingRows.length, fileRows.length]).toEqual([48, 37, 8, 3]);
  });

  it('D-8339: stall-watch-disabled is C5\'s, hand-only, absent means the watch runs, and the stall lane reads the same constant', () => {
    const row = SWITCHES[STALL_WATCH_DISABLED_MARKER];
    expect(row.storage).toEqual({ marker: 'stall-watch-disabled' });
    expect(row.owner).toBe('C5');
    expect(row.writer).toBe('hand-only');
    expect(row.default).toMatch(/^absent: /);
    expect(row.meaning).toMatch(/stall watch/);
    // The lane's own marker list holds the row's name, and its arming reads the row's constant.
    expect(STALL_MARKERS).toContain(STALL_WATCH_DISABLED_MARKER);
    expect(stallArmingOf([STALL_WATCH_DISABLED_MARKER]).disabled).toBe(true);
    expect(stallArmingOf([]).disabled).toBe(false);
    expect(readSwitches([STALL_WATCH_DISABLED_MARKER])[STALL_WATCH_DISABLED_MARKER]).toBe('set');
    expect(readSwitches([])[STALL_WATCH_DISABLED_MARKER]).toBe('clear');
    expect(readSwitches(null)[STALL_WATCH_DISABLED_MARKER]).toBe('unmeasurable');
  });

  it('D-8077: runs-expire-never-started is C5\'s, absent means shadow, and nothing in the tree writes it', () => {
    const row = SWITCHES[RUNS_EXPIRE_NEVER_STARTED_MARKER];
    expect(row.owner).toBe('C5');
    expect(row.writer).toBe('hand-only');
    expect(row.default).toMatch(/^absent: shadow/);
    expect(row.meaning).toMatch(/never-started/);
    expect(readSwitches([RUNS_EXPIRE_NEVER_STARTED_MARKER])[RUNS_EXPIRE_NEVER_STARTED_MARKER]).toBe('set');
    expect(readSwitches([DEAD_COORDINATOR_LANE_LIVE_MARKER])[RUNS_EXPIRE_NEVER_STARTED_MARKER]).toBe('clear');
    expect(readSwitches(null)[RUNS_EXPIRE_NEVER_STARTED_MARKER]).toBe('unmeasurable');
  });

  it('D-8078: runs-expire-coordinator-gone is C5\'s, absent means shadow, and nothing in the tree writes it', () => {
    const row = SWITCHES[RUNS_EXPIRE_COORDINATOR_GONE_MARKER];
    expect(row.owner).toBe('C5');
    expect(row.writer).toBe('hand-only');
    expect(row.default).toMatch(/^absent: shadow/);
    expect(readSwitches([RUNS_EXPIRE_COORDINATOR_GONE_MARKER])[RUNS_EXPIRE_COORDINATOR_GONE_MARKER]).toBe('set');
    expect(readSwitches([RUNS_EXPIRE_NEVER_STARTED_MARKER])[RUNS_EXPIRE_COORDINATOR_GONE_MARKER]).toBe('clear');
    expect(readSwitches(null)[RUNS_EXPIRE_COORDINATOR_GONE_MARKER]).toBe('unmeasurable');
  });

  it('D-7902: the pane-scope stop switch is C2\'s, absent means shadow, its writer is the Settings route, and it sits before the test box row', () => {
    expect(SWITCHES[PANE_SCOPE_STOP_LIVE_MARKER]).toEqual({
      storage: { marker: 'pane-scope-stop-live' }, default: expect.stringMatching(/^absent: shadow/), owner: 'C2',
      meaning: expect.stringMatching(/pane/), writer: 'ccd pane-scope-stop, through POST /api/coord/pane-scope-stop',
    });
    expect(Object.keys(SWITCHES).at(-2)).toBe(PANE_SCOPE_STOP_LIVE_MARKER);
  });

  it('D-7319: the dispatch abandon switch is Coordination\'s settings row, seeded on, written by its route and read by the store', () => {
    expect(SWITCHES['dispatch-abandon-choice']).toEqual({
      storage: { setting: 'dispatch_abandon_settings.choice' }, default: 'on', owner: 'C5',
      meaning: expect.stringMatching(/never came back/), writer: 'POST /api/coord/dispatch-abandon',
    });
    // The row describes what the tree has: the table its migration creates and seeds on, the store's one reader of it
    // and the store's one writer, which only the route calls. The abandon pass reads the store, never this row.
    const store = 'server/src/coord/store.ts';
    expect(sqlStatementsIn(symbolOf(store, 'CoordStore.dispatchAbandonSetting')).map((q) => [q.verb, q.table]))
      .toEqual([['SELECT', 'dispatch_abandon_settings']]);
    expect(sqlStatementsIn(symbolOf(store, 'CoordStore.setDispatchAbandon')).map((q) => [q.verb, q.table]))
      .toEqual([['INSERT', 'dispatch_abandon_settings']]);
    const ddl = sqlStatementsInFile('server/src/coord/schema.ts').filter((q) => /\bdispatch_abandon_settings\b/.test(q.text));
    expect(ddl.map((q) => q.verb)).toEqual(['CREATE', 'INSERT']);
    expect(ddl[1]!.text).toContain("VALUES (1, 'on', 0)");
    // The test box row stays the last: this row sits with the other settings rows, ahead of it.
    const keys = Object.keys(SWITCHES);
    expect(keys.indexOf('dispatch-abandon-choice')).toBe(keys.indexOf('roll-idle-targets') + 1);
    expect(keys.at(-1)).toBe(TESTBOX_REMOTE_LIVE_MARKER);
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
