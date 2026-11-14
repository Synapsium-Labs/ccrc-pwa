// server/test/continuity-profile-lane.test.ts
//
// The launch-profile lane (Overlord W1a launch profiles PR B, Task 5; spec §3.6 H1, §3.3.7 H14, §3.3.4 C39): `profileFor`'s
// oracle (from `sim/launchProfileSets.ts`, which the mutation floor runs against each mutant), then the pass over a fake
// store and fake fleet reads: shadow writes nothing; live writes only differing fields, one argv a session, at most five a
// pass; a route it could not read is skipped; compaction moves only with `continuity` live; a session carrying the history
// W3 steer marker is left alone.
import { describe, expect, it } from 'vitest';
import { SWITCHES } from '../../ccd/history/lib.mjs';
import type { ChildMark, RouteFields } from '../../shared/api.js';
import * as profileForModule from '../src/continuity/profileFor.js';
import {
  HISTORY_STEER_ON_DIR, PROFILE_WRITES_PER_PASS, profilePass, type ProfileCoord, type ProfileLaneDeps, type ProfileRow,
} from '../src/continuity/profileLane.js';
import { ACTOR_FLAGS_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import type { CcdArgv } from '../src/ccdargv.js';
import type { CcdResult } from '../src/coord/ports.js';
import type { LaneArmRead } from '../src/coord/laneArm.js';
import type { PlainAutoMemoryRead } from '../src/continuity/profileFor.js';
import type { UsageRead } from '../src/usage.js';
import { profileForCases } from './sim/launchProfileSets.js';

describe('profileFor and plainAutoMemoryOf (Task 5, Task 6)', () => {
  for (const [name, run] of Object.entries(profileForCases(profileForModule))) it(name, run);
});

const NONE: ChildMark = { kind: 'none' };
const row = (id: string, fields: RouteFields | null, over: Partial<ProfileRow> = {}): ProfileRow => ({
  id, child: NONE, route: fields === null ? null : { fields, degraded: null, inert: [], unreadable: [] }, ...over,
});
const armed = (choice: string): LaneArmRead => ({ kind: 'row', choice, updatedAt: 1, importedAt: null, imported: null });

interface World {
  lanes?: Record<string, LaneArmRead>;
  memory?: PlainAutoMemoryRead;
  coordinators?: string[];
  runKinds?: Record<number, 'work' | 'review'>;
  windows?: Record<string, number>;
  steer?: Record<string, 'present' | 'unreadable'>;
  verbs?: string[] | null;
  fail?: Set<string>;
  notRan?: Set<string>;
  openGate?: boolean;
}

function harness(w: World = {}) {
  const sent: string[][] = [];
  const logs: string[] = [];
  const usageAsked: string[] = [];
  const coord: ProfileCoord = {
    laneArmSetting: (lane) => w.lanes?.[lane] ?? armed('shadow'),
    openCoordinatorIds: () => w.coordinators ?? [],
    run: ((id: number) => ({ ok: true, run: w.runKinds?.[id] === undefined ? null : { kind: w.runKinds[id] } })) as unknown as ProfileCoord['run'],
    plainAutoMemorySettings: () => w.memory ?? { kind: 'row', choice: 'off' },
  };
  const deps: ProfileLaneDeps = {
    coord,
    reads: {
      usage: async (id): Promise<UsageRead> => {
        usageAsked.push(id);
        const win = w.windows?.[id];
        return win === undefined ? { kind: 'absent' }
          : { kind: 'reading', usage: { stale: false, ctxWindow: win } as unknown as Extract<UsageRead, { kind: 'reading' }>['usage'] };
      },
      steerMarker: async (id) => w.steer?.[id] ?? 'absent',
    },
    act: {
      runCcd: async (argv: CcdArgv): Promise<CcdResult> => {
        sent.push([...argv]);
        const id = argv[argv.indexOf('--session') + 1]!;
        if (w.notRan?.has(id)) return { ok: false, stdout: '', stderr: 'agent link dropped', ran: false } as unknown as CcdResult;
        return (w.fail?.has(id) ? { ok: false, stdout: '', stderr: 'ccd: unknown routing field profile\n', ran: true }
          : { ok: true, stdout: '', stderr: '', ran: true }) as CcdResult;
      },
      fleetState: w.verbs === null ? undefined : { ccdVerbs: w.verbs ?? [ROUTE_CAP, ACTOR_FLAGS_CAP] },
    },
    log: (l) => logs.push(l),
    memory: { lastLine: null },
    ...(w.openGate ? { gate: () => null } : {}),
  };
  return { deps, sent, logs, usageAsked };
}
const LIVE = { 'launch-profile': armed('live') };
const sets = (argv: readonly string[]): string[] => argv.flatMap((a, i) => (argv[i - 1] === '--set' ? [a] : []));

describe('the launch-profile lane, one pass (Task 5)', () => {
  it('in shadow (the seed) it writes nothing, counts what it would write, and logs one line, once', async () => {
    const h = harness({ coordinators: ['lane-a-project-a'] });
    const rows = [row('lane-a-project-a', null), row('lane-a-project-b', { class: 'opus' })];
    const r = await profilePass(h.deps, rows);
    expect(h.sent).toEqual([]);
    expect(r).toMatchObject({ live: false, would: 2, written: 0, byField: { profile: 2, automem: 2, compact: 0, compactwindow: 0 } });
    expect(h.logs).toEqual(['ccrc-server: launch-profile (shadow): 2 session(s) would get a route write (profile 2, automem 2)']);
    await profilePass(h.deps, rows);
    expect(h.logs).toHaveLength(1);
  });

  it('live, it writes only the fields that differ, in one argv per session, under the lane\'s actor; a settled route gets none', async () => {
    const h = harness({ lanes: LIVE, coordinators: ['lane-a-project-a'], memory: { kind: 'row', choice: 'on' } });
    const r = await profilePass(h.deps, [
      row('lane-a-project-a', { profile: 'coordinator', automem: 'on' }),   // automem differs: a coordinator's is off
      row('lane-a-project-b', { profile: 'plain', automem: 'on' }),         // settled: plain follows the row, on
      row('lane-a-project-c', null),                                        // never routed: both fields
    ]);
    expect(r).toMatchObject({ live: true, would: 2, written: 2, failed: 0 });
    expect(h.sent.map(sets)).toEqual([['automem=off'], ['profile=plain', 'automem=on']]);
    expect(h.sent[0]!.slice(0, 3)).toEqual(['route', '--session', 'lane-a-project-a']);
    expect(h.sent[0]!.join(' ')).toContain('launch-profile lane');
  });

  it('a route field it could not read is skipped and counted, never written blind', async () => {
    const h = harness({ lanes: LIVE });
    const unread: ProfileRow = { id: 'lane-a-project-a', child: NONE, route: { fields: {}, degraded: null, inert: [], unreadable: ['automem'] } };
    const otherUnread: ProfileRow = { id: 'lane-a-project-b', child: NONE, route: { fields: {}, degraded: null, inert: [], unreadable: ['class'] } };
    const r = await profilePass(h.deps, [unread, otherUnread]);
    expect(r.routeUnread).toBe(1);
    expect(h.sent.map((a) => a[2])).toEqual(['lane-a-project-b']);   // an unread field the lane does not write is no reason to skip
  });

  it(`at most ${PROFILE_WRITES_PER_PASS} writes a pass; the rest wait for a later pass`, async () => {
    const h = harness({ lanes: LIVE });
    const rows = Array.from({ length: 8 }, (_, i) => row(`lane-a-project-${i}`, null));
    const r = await profilePass(h.deps, rows);
    expect(h.sent).toHaveLength(PROFILE_WRITES_PER_PASS);
    expect(r).toMatchObject({ written: 5, deferred: 3, would: 8 });
  });

  it('a failed write counts toward the five, is logged naming the session, and the rest go on', async () => {
    const h = harness({ lanes: LIVE, fail: new Set(['lane-a-project-0']) });
    const r = await profilePass(h.deps, [row('lane-a-project-0', null), row('lane-a-project-1', null)]);
    expect(r).toMatchObject({ written: 1, failed: 1 });
    expect(h.logs).toContain('ccrc-server: launch-profile: a route write failed, retried next pass: lane-a-project-0: ccd: unknown routing field profile');
  });

  it('a write that never ran (the agent link dropped) is logged as unmeasured, never as ccd\'s refusal', async () => {
    const h = harness({ lanes: LIVE, notRan: new Set(['lane-a-project-0']) });
    const r = await profilePass(h.deps, [row('lane-a-project-0', null)]);
    expect(r).toMatchObject({ written: 0, failed: 1 });
    expect(h.logs).toContain('ccrc-server: launch-profile: a route write failed, retried next pass: lane-a-project-0: ccd did not run, so the write is unmeasured');
  });

  it('with continuity in shadow, a coordinator gets no compaction field and its window is not read', async () => {
    const h = harness({ lanes: LIVE, coordinators: ['lane-a-project-a'], windows: { 'lane-a-project-a': 200_000 } });
    await profilePass(h.deps, [row('lane-a-project-a', null)]);
    expect(h.sent.map(sets)).toEqual([['profile=coordinator', 'automem=off']]);
    expect(h.usageAsked).toEqual([]);
  });

  it('with continuity live (its gate opened as the renewal act will), a coordinator gets compact and compactwindow from its window', async () => {
    const h = harness({ lanes: { ...LIVE, continuity: armed('live') }, openGate: true, coordinators: ['lane-a-project-a', 'lane-a-project-b'],
      windows: { 'lane-a-project-a': 200_000 } });
    const r = await profilePass(h.deps, [row('lane-a-project-a', null), row('lane-a-project-b', null), row('lane-a-project-c', null)]);
    expect(h.sent.map(sets)).toEqual([
      ['compact=60', 'profile=coordinator', 'automem=off', 'compactwindow=154000'],   // routeSet walks ROUTE_WRITABLE_FIELDS' order
      ['profile=coordinator', 'automem=off'],                                // an unmeasured window leaves both alone
      ['profile=plain', 'automem=off'],
    ]);
    expect(h.usageAsked).toEqual(['lane-a-project-a', 'lane-a-project-b']);  // only long-lived roles' windows are read
    expect(r.continuityLive).toBe(true);
  });

  it('continuity stored live while its gate stands is not live: no compaction field (review 2006 N1)', async () => {
    const h = harness({ lanes: { ...LIVE, continuity: armed('live') }, coordinators: ['lane-a-project-a'], windows: { 'lane-a-project-a': 200_000 } });
    const r = await profilePass(h.deps, [row('lane-a-project-a', null)]);
    expect(r.continuityLive).toBe(false);
    expect(h.sent.map(sets)).toEqual([['profile=coordinator', 'automem=off']]);
  });

  it('a session carrying the history W3 steer marker, or whose marker cannot be read, is left alone; the others are written', async () => {
    const h = harness({ lanes: LIVE, steer: { 'lane-a-project-a': 'present', 'lane-a-project-b': 'unreadable' } });
    const r = await profilePass(h.deps, [row('lane-a-project-a', null), row('lane-a-project-b', null), row('lane-a-project-c', null)]);
    expect(h.sent.map((a) => a[2])).toEqual(['lane-a-project-c']);
    expect(r).toMatchObject({ steered: 1, steerUnread: 1, would: 1 });
    expect(h.logs[0]).toContain('skipped 1 carrying the history W3 steer marker, 1 whose steer marker could not be read');
  });

  it('the steer marker\'s directory is the history library\'s one spelling, under ~/.ccrc', () => {
    expect(`.ccrc/${HISTORY_STEER_ON_DIR}`).toBe(SWITCHES.steerOnDir);
  });

  it('the Settings row unread: a plain session\'s automem is left alone, its profile still written; a worker is unaffected', async () => {
    const h = harness({ lanes: LIVE, memory: { kind: 'unreadable', detail: 'locked' }, runKinds: { 7: 'work' } });
    const r = await profilePass(h.deps, [row('lane-a-project-a', null), row('lane-a-project-b', null, { child: { kind: 'child', runId: 7 } })]);
    expect(h.sent.map(sets)).toEqual([['profile=plain'], ['profile=worker', 'automem=off']]);
    expect(r.memoryUnread).toBe(1);
  });

  it('an undecided reading takes the member that does less: an unreadable child mark reads worker, an unread run list reads plain', async () => {
    const h = harness({ lanes: LIVE });
    h.deps.coord.openCoordinatorIds = () => { throw new Error('locked'); };
    await profilePass(h.deps, [row('lane-a-project-a', null, { child: { kind: 'unreadable' } }), row('lane-a-project-b', null)]);
    expect(h.sent.map(sets)).toEqual([['profile=worker', 'automem=off'], ['profile=plain', 'automem=off']]);
  });

  it('live but ccd here has no route verb: nothing is sent, and the line says why', async () => {
    const h = harness({ lanes: LIVE, verbs: ['actor-flags-v1'] });
    const r = await profilePass(h.deps, [row('lane-a-project-a', null)]);
    expect(h.sent).toEqual([]);
    expect(r.unsupported).toBe(1);
    expect(h.logs[0]).toContain('1 not written: ccd here has no route verb');
  });
});
