// D-5850 `feed-writers-pin-outside-coord` (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0c;
// ARCH-54's characterization half; spec K6). PART 1 of the feed writers' pin: how a feed row is written TODAY, by
// `pushOne` and by the four hand-written pairs outside `coord/`, so the funnel W1a introduces (C1e) can be proven to keep
// every observable fact. Part 2 (Task C0d) adds the writers in `coord/` and `stopDoneSweep.ts` to this suite.
//
// CHARACTERIZATION ONLY: every row is green on today's code and pins inputs to outputs, never source text. Each writer
// is reached through its own lane or route (`pushOne` through the `done` push and the `run` lane, never by reaching into
// the private method), over `feedWriterFixture.ts`'s recorder: a real `NotifyLog`, a real `CoordStore`, a fake push, a
// presence fake, and every sink call logged in order. Only what production can observe is asserted: the record gate,
// the push, the archive row, isolation of a throwing archive, the degrade sentence byte for byte, and a flush after the
// ring record. Where the flush sits relative to the archive, and whether a throwing ring record is caught, are NOT
// asserted: `NotifyLog.record` is in-memory and cannot throw, and `flush` is a chained async write (spec K6, rev 2.1).
//
// `pushOne`'s fourth flag combination (`recordOnly` without `recordAlways`) has no caller: every `recordOnly` call site
// also sets `recordAlways`, so no lane can drive it and it has no row here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { buildServer, type Deps } from '../src/server.js';
import { FleetWatcher, type StallTick } from '../src/watch.js';
import type { SessionRecord } from '../src/registry.js';
import { configDirFor } from '../src/config.js';
import { transcriptPath } from '../src/transcript/resolve.js';
import { idleNudgeFeedBody } from '../src/idlenudge.js';
import { recordInterrupt } from '../src/interruptlog.js';
import { askKey } from '../src/askkey.js';
import { COLLECT_FEED_TITLE, COLLECT_SETTING_FEED_TITLE, measureCollectLaneRow } from '../src/collectLane.js';
import {
  IDLE_COMPACT_NUDGE_PROMPT, PRESENCE_OPEN_TTL_MS, STALL_FOLLOW_LABEL, STALL_LEVEL_TEXT,
  type CollectLaneView, type FleetSession,
} from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { IDLE_TAIL, T_NOTICE, T_STOP, jsonl } from './idleNudgeFixtures.js';
import { collectRig } from './collectLaneFixture.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import type { GateDecision } from '../src/auth/gate.js';
import type { FleetState } from '../src/fleetstate.js';
import { FleetIdentityCell } from '../src/fleetidentity.js';
import { ACTOR_FLAGS_CAP, COLLECT_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { collectLaneJournalAt, defaultCollectLaneJournalPath } from '../src/coord/collectLaneJournal.js';
import { parseStallSettings } from '../src/coord/stallsettings.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_KEPT_FEED_TITLE, CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE, reclaimChild,
  recordChildReclaimKeptFeed, recordChildReclaimLeafKeptFeed, type ChildReclaimDeps,
} from '../src/coord/childReclaim.js';
import type { ChildReclaimKeptAttention, ChildReclaimLeafKept } from '../src/childReclaimSweep.js';
import { expireArchived, recordExpireFeed, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import { recordDeadCoordinatorFeed } from '../src/coord/endDeadCoordinator.js';
import type { DeadCoordinatorActOutcome } from '../src/deadCoordinator.js';
import { stopDonePass, type StopDoneSweepDeps } from '../src/sleepLane.js';
import { STOP_DONE_GRACE_MS } from '../src/stopDone.js';
import { CHILD, PARENT, hookInput, requestBody, standardFixture, type Approvals } from './approvalsHarness.js';
import {
  catchUpBody, catchUpExpected, degradeLine, feedRecorder, flushedAfterRecord, interruptDeps, withoutFlush, type FeedRecorder,
} from './feedWriterFixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const A = 'acct-a-project-a';
const B = 'acct-b-project-a';

// ─── pushOne, through the lanes that call it ────────────────────────────────────────────────────────────────────────

/** One registry entry and one live-status file per id (all `busy`, so the priming tick records `busy` and a later
 *  `markIdle` is a real busy→idle edge, the `done` push's lane), under one wrapper. `push-copy.test.ts`'s seeding. */
const pushRig = async (o: { coord?: false; notifyLog?: false } = {}) => {
  const home = mkTmp('ccrc-feed-pin-');
  const rec = await feedRecorder(home);
  const reg = path.join(home, '.cc-sessions');
  const cfgDir = path.join(home, '.claude');
  mkdirSync(reg, { recursive: true });
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const pids = new Map<string, number>([[A, 41001], [B, 41002]]);
  const live = (id: string, status: 'busy' | 'idle'): void => {
    const pid = pids.get(id)!;
    writeFileSync(path.join(cfgDir, 'sessions', `${pid}.json`), JSON.stringify({
      pid, sessionId: `s-${id}`, cwd: '/d', status, statusUpdatedAt: Date.now(),
    }));
  };
  for (const id of pids.keys()) {
    const fields = { wrapper: 'claude', project: 'project-a', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1' };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    live(id, 'busy');
  }
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'list-panes') {
      const id = /^=cc-(.*):$/.exec(args[2] ?? '')?.[1] ?? '';
      const pid = pids.get(id);
      return { ran: true, code: 0, stdout: pid ? `${pid}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: 'ready\n❯ \n', stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const deps = { ...testDeps(home, run), push: rec.push, viewers: rec.viewers,
    ...(o.notifyLog === false ? {} : { notifyLog: rec.notifyLog }), ...(o.coord === false ? {} : { coord: rec.coord }) };
  const w = new FleetWatcher(deps as never, new Bus(), 10_000, path.join(home, 'state-cache.json'));
  await w.tick();                                          // priming: no push, no record
  /** A run bound to session A, its watermark seeded by the priming tick. */
  const openRun = (): number => {
    const r = rec.coord.openRun({ program: 'pin-1', title: 'pin', project: 'project-a', wave: 1, waveOf: 2,
      claimedBy: 'project-a-coordinator' }) as { id: number };
    rec.coord.setSession(r.id, A);
    return r.id;
  };
  return { home, rec, w, markIdle: (id: string) => live(id, 'idle'), openRun };
};

/** The ring as catch-up serves it, against the objects `record` returned: the same bytes, key order included. */
const catchUpMatchesRing = (rec: FeedRecorder): void => {
  expect(JSON.stringify(rec.notifyLog.catchUp(rec.notifyLog.epoch, 0).events)).toBe(JSON.stringify(rec.ring));
};

describe("pushOne's three reachable flag combinations (D-5850)", () => {
  it('not visible, neither flag (the `done` push): ring, archive, push — and a flush after the ring record', async () => {
    const r = await pushRig();
    const at = r.rec.mark();
    r.markIdle(A);
    await r.w.tick();
    expect(withoutFlush(r.rec.since(at))).toEqual(['record', 'archive', 'push']);
    expect(flushedAfterRecord(r.rec.since(at))).toBe(true);
    expect(r.rec.archived.map((e) => [e.kind, e.sessionId])).toEqual([['done', A]]);
    expect(r.rec.pushes.map((p) => p.tag)).toEqual([`done-${A}`]);
    catchUpMatchesRing(r.rec);
  });

  it('visible without recordAlways records nothing: no ring row, no flush, no archive, no push', async () => {
    const r = await pushRig();
    r.rec.setVisible([A]);
    const at = r.rec.mark();
    r.markIdle(A);
    await r.w.tick();
    expect(r.rec.since(at)).toEqual([]);
    expect(r.rec.ring).toEqual([]);
  });

  it('not visible, recordAlways (a `run` transition): ring, archive, push', async () => {
    const r = await pushRig();
    const run = r.openRun();
    r.rec.coord.advance(run, 'dispatched', 'coordinator');
    const at = r.rec.mark();
    await r.w.tick();
    expect(withoutFlush(r.rec.since(at))).toEqual(['record', 'archive', 'push']);
    expect(flushedAfterRecord(r.rec.since(at))).toBe(true);
    expect(r.rec.archived.map((e) => [e.kind, e.runId])).toEqual([['run', run]]);
    expect(r.rec.pushes.map((p) => p.tag)).toEqual([`run-${run}-dispatched`]);
  });

  it('visible, recordAlways: the record and the archive, never the push', async () => {
    const r = await pushRig();
    r.rec.setVisible([A]);
    const run = r.openRun();
    r.rec.coord.advance(run, 'dispatched', 'coordinator');
    const at = r.rec.mark();
    await r.w.tick();
    expect(withoutFlush(r.rec.since(at))).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(r.rec.since(at))).toBe(true);
    expect(r.rec.pushes).toEqual([]);
  });

  it.each([false, true])('recordOnly never pushes (recordAlways + recordOnly, the `run` lane\'s `closing`; visible %s)',
    async (visible) => {
      const r = await pushRig();
      if (visible) r.rec.setVisible([A]);
      const run = r.openRun();
      r.rec.coord.advance(run, 'dispatched', 'coordinator');
      await r.w.tick();
      const pushed = r.rec.pushes.length;
      r.rec.coord.advance(run, 'closing', 'coordinator');
      const at = r.rec.mark();
      await r.w.tick();
      expect(withoutFlush(r.rec.since(at))).toEqual(['record', 'archive']);
      expect(flushedAfterRecord(r.rec.since(at))).toBe(true);
      expect(r.rec.archived.at(-1)).toMatchObject({ kind: 'run', title: '▸ closing › project-a', runId: run });
      expect(r.rec.pushes).toHaveLength(pushed);
    });
});

describe("pushOne's archive-failure isolation (D-5850)", () => {
  it('a failed archive leaves the ring record and the push, and says so byte for byte', async () => {
    const r = await pushRig();
    r.rec.archiveThrowsOn('every');
    const at = r.rec.mark();
    r.markIdle(A);
    await r.w.tick();
    expect(withoutFlush(r.rec.since(at))).toEqual(['record', 'archive', 'push']);
    expect(r.rec.ring.map((e) => e.kind)).toEqual(['done']);
    expect(r.rec.archived).toEqual([]);
    expect(r.rec.pushes.map((p) => p.tag)).toEqual([`done-${A}`]);
    expect(r.rec.warned()).toContain(degradeLine('feed archive degraded, ring/push unaffected'));
    catchUpMatchesRing(r.rec);
  });
});

describe("pushOne at the funnel's edges: catch-up bytes, no coord.db, no notify log (D-5857, Task C1c)", () => {
  it("the catch-up response's bytes, filled through pushOne: pushOne's key order, the response's four keys", async () => {
    const r = await pushRig();
    r.markIdle(A);
    await r.w.tick();
    const [ev] = r.rec.ring;
    expect(await catchUpBody(r.home, r.rec.notifyLog)).toBe(catchUpExpected(r.rec.notifyLog, [
      { kind: 'done', sessionId: A, title: ev!.title, body: ev!.body, runId: null, seq: 1, at: ev!.at },
    ]));
  });

  it('a box with no coord.db still records the ring, pushes, and serves catch-up: no archive is attempted', async () => {
    const r = await pushRig({ coord: false });
    const at = r.rec.mark();
    r.markIdle(A);
    await r.w.tick();
    expect(withoutFlush(r.rec.since(at))).toEqual(['record', 'push']);
    expect(flushedAfterRecord(r.rec.since(at))).toBe(true);
    expect(r.rec.archived).toEqual([]);
    const [ev] = r.rec.ring;
    expect(await catchUpBody(r.home, r.rec.notifyLog)).toBe(catchUpExpected(r.rec.notifyLog, [
      { kind: 'done', sessionId: A, title: ev!.title, body: ev!.body, runId: null, seq: 1, at: ev!.at },
    ]));
  });

  it('a box with no notify log archives nothing ("a feed row that mirrors nothing is not an archive"), and still pushes',
    async () => {
      const r = await pushRig({ notifyLog: false });
      const at = r.rec.mark();
      r.markIdle(A);
      await r.w.tick();
      expect(r.rec.since(at)).toEqual(['push']);
      expect(r.rec.ring).toEqual([]);
      expect(r.rec.archived).toEqual([]);
      expect(r.rec.pushes.map((p) => p.tag)).toEqual([`done-${A}`]);
    });
});

// ─── the idle nudge's landing gate ──────────────────────────────────────────────────────────────────────────────────

const NUDGE_UUID = 'a'.repeat(36);
const NUDGE_PID = 4242;
const NUDGE_WORKDIR = '/w/project-a';
const NUDGE_NOW = T_NOTICE + 40_000;

/** The idle-nudge lane over a fixture HOME: primed on an empty registry, then the happy path's facts seeded
 *  (`idle-compact-nudge-lane.test.ts`'s rig, trimmed to what this gate needs). The pane echoes typed text, so a send
 *  that is attempted would succeed: a row that types nothing typed nothing because of the gate. */
const nudgeRig = async (o: { notifyLog?: boolean } = {}) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const home = mkTmp('ccrc-feed-pin-nudge-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const rec = await feedRecorder(home);
  const sends: string[][] = [];
  let box = '';
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${NUDGE_PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: `❯ ${box}\n`, stderr: '' };
    if (args[0] === 'send-keys') {
      sends.push([...args]);
      box = args[3] === '-l' ? box + args[5]! : '';
      return { ran: true, code: 0, stdout: '', stderr: '' };
    }
    return { ran: true, code: 1, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const deps = { ...base, coord: rec.coord, viewers: rec.viewers, ...(o.notifyLog === false ? {} : { notifyLog: rec.notifyLog }) };
  const w = new FleetWatcher(deps as unknown as Deps, new Bus(), 2000, path.join(home, 'state-cache.json'));
  vi.setSystemTime(T_STOP - 7_200_000);
  await w.tick();
  const cfgDir = configDirFor(base.cfg, 'claude')!;
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'project-a', workdir: NUDGE_WORKDIR, uuid: NUDGE_UUID,
    started: '1' })) writeFileSync(path.join(reg, `${A}.${k}`), v);
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  writeFileSync(path.join(cfgDir, 'sessions', `${NUDGE_PID}.json`), JSON.stringify({
    pid: NUDGE_PID, sessionId: NUDGE_UUID, cwd: NUDGE_WORKDIR, name: null, nameSource: null, status: 'idle',
    statusUpdatedAt: T_NOTICE, startedAt: T_STOP - 3_600_000, version: '2.1.302',
  }));
  writeFileSync(path.join(reg, `${A}.turn.json`), JSON.stringify({
    v: 1, sessionId: NUDGE_UUID, state: 'done', event: 'Stop', at: T_STOP + 1_000, turnAt: T_STOP - 60_000,
    stopAt: T_STOP + 1_000, bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '',
    lostIds: '',
  }));
  const tasks = path.join(cfgDir, 'tasks', NUDGE_UUID);
  mkdirSync(tasks, { recursive: true });
  const t = (NUDGE_NOW - 600_000) / 1000;
  ['completed', 'in_progress', 'pending'].forEach((status, i) => {
    const f = path.join(tasks, `${i + 1}.json`);
    writeFileSync(f, JSON.stringify({ id: String(i + 1), subject: `Step ${i + 1}`, activeForm: `Doing step ${i + 1}`,
      description: '', status }));
    utimesSync(f, t, t);
  });
  const tf = transcriptPath(cfgDir, NUDGE_WORKDIR, NUDGE_UUID);
  mkdirSync(path.dirname(tf), { recursive: true });
  writeFileSync(tf, jsonl(IDLE_TAIL));
  vi.setSystemTime(NUDGE_NOW);
  const row: FleetSession = {
    hibernatedAt: null,
    id: A, wrapper: 'claude', home: '/home/demo', project: 'project-a', workdir: NUDGE_WORKDIR,
    workspace: `${A}-ws`, name: null, title: null, status: 'idle', statusUpdatedAt: T_NOTICE, limits: null,
    dialogPending: false, version: null, model: null, effort: null, ultracode: false,
    branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
    hookState: null, askSummary: null, subagents: null, background: null, lastEnd: null, graphQueries: null,
    graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
    unmeasured: [], statusUnmeasured: false, lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null,
    substrate: null, started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null,
    child: { kind: 'none' }, role: 'coordinator', releasedFrom: null, withCoordinator: null,
  };
  const record: SessionRecord = {
    hibernatedAt: null,
    namedByOperator: false, title: null,
    id: A, wrapper: 'claude', project: 'project-a', workdir: NUDGE_WORKDIR, uuid: NUDGE_UUID,
    started: true, home: null, pool: null, lastswap: null,
    workspace: `${A}-ws`, branch: null, branchEvidence: 'absent', base: null,
    prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
    substrate: null, stopped: null, supervisedAt: null, swapBlocked: null, stranded: null, spawn: null, lastEnd: null,
    lifecycleUnmeasured: [], unmeasured: [], route: null, child: { kind: 'none' },
  };
  const tick: StallTick = { panePids: new Map([[A, NUDGE_PID]]), records: [record], refused: new Set() };
  return { rec, sends, sweep: () => w.sweepIdleCompactNudge([row], [], tick) };
};

describe("the idle nudge's landing gate: a row that did not land types nothing (D-5850)", () => {
  it('CONTROL: the same rig with nothing arranged records, archives and types the nudge once', async () => {
    const r = await nudgeRig();
    await r.sweep();
    expect(r.sends.filter((a) => a[3] === '-l').map((a) => a[5])).toEqual([IDLE_COMPACT_NUDGE_PROMPT]);
    expect(r.rec.archived.map((e) => [e.kind, e.body])).toEqual([['nudge', idleNudgeFeedBody('b1')]]);
    expect(r.rec.pushes).toEqual([]);
  });

  it('a row that did not land types nothing: the archive throws, no key is sent, and the lane says why', async () => {
    const r = await nudgeRig();
    r.rec.archiveThrowsOn('every');
    await r.sweep();
    expect(r.rec.ring.map((e) => e.kind), 'the premise: the ring record was made').toEqual(['nudge']);
    expect(r.sends).toEqual([]);
    expect(r.rec.warned()).toContain(
      `ccrc-server: idle-compact-nudge ${A} compaction b1: the feed record did not land — nothing typed`);
    expect(r.rec.warned()).toContain(degradeLine('feed archive degraded, ring/push unaffected'));
  });

  it('no notify log configured: nothing is recorded and nothing typed', async () => {
    const r = await nudgeRig({ notifyLog: false });
    await r.sweep();
    expect(r.rec.calls).toEqual([]);
    expect(r.sends).toEqual([]);
  });
});

// ─── the hand-written pairs outside coord/ ──────────────────────────────────────────────────────────────────────────

describe("watch.ts's collector `run` row (collectRecordFeed): recorded always, never pushed (D-5850)", () => {
  const live = async (fail: boolean) => {
    const rec = await feedRecorder(mkTmp('ccrc-feed-pin-collect-'));
    if (fail) rec.archiveThrowsOn('every');
    // No session is made visible here: the collector's own presence hold would stop the act job going live. The
    // record gate's independence of presence is pinned on the `coord` row below.
    const f = await collectRig({ coord: rec.coord, notifyLog: rec.notifyLog, push: rec.push });
    f.pastHoldOff();
    const at = rec.mark();
    await f.goLive();
    return { rec, f, calls: rec.since(at) };
  };

  it('the switch row is recorded and archived, never pushed, and flushed after the ring record', async () => {
    const { rec, f, calls } = await live(false);
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.title])).toEqual([['run', COLLECT_FEED_TITLE.switch]]);
    expect(rec.pushes).toEqual([]);
    expect(f.lane().lastSeenLive).toBe(true);
  });

  it("the collector's run row flushes after a failed archive, the lane still goes live, and the sentence is byte for byte",
    async () => {
      const { rec, f, calls } = await live(true);
      expect(withoutFlush(calls)).toEqual(['record', 'archive']);
      expect(flushedAfterRecord(calls)).toBe(true);
      expect(rec.archived).toEqual([]);
      expect(rec.pushes).toEqual([]);
      expect(f.lane().lastSeenLive, 'the act\'s own result is unchanged').toBe(true);
      expect(rec.warned()).toContain(degradeLine(`temp-root collector ${COLLECT_FEED_TITLE.switch}, feed archive degraded`));
    });
});

describe("watch.ts's collector `coord` row (collectRecordCoordFeed): recorded always, never pushed (D-5850)", () => {
  const retire = async (fail: boolean) => {
    const rec = await feedRecorder(mkTmp('ccrc-feed-pin-latch-'));
    const f = await collectRig({ armed: true, coord: rec.coord, notifyLog: rec.notifyLog, push: rec.push });
    f.setVisible(() => true);
    await f.pass(); await f.settled();
    if (fail) rec.archiveThrowsOn('every');
    f.disarm();
    const at = rec.mark();
    f.next(); await f.pass(); await f.settled();
    const m = measureCollectLaneRow(f.coord.collectLaneRow());
    if (m.kind !== 'seed' && m.kind !== 'row') throw new Error(`the switch's row reads ${m.kind}`);
    return { rec, calls: rec.since(at), retiredAt: m.row.markerRetiredAt };
  };

  it('the latch row is recorded and archived, never pushed, and flushed after the ring record', async () => {
    const { rec, calls, retiredAt } = await retire(false);
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title])).toEqual([['coord', '', null, COLLECT_SETTING_FEED_TITLE]]);
    expect(rec.pushes).toEqual([]);
    expect(retiredAt).not.toBeNull();
  });

  it('a failed archive still retires the latch, flushes after the ring record, and says so byte for byte', async () => {
    const { rec, calls, retiredAt } = await retire(true);
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived).toEqual([]);
    expect(rec.pushes).toEqual([]);
    expect(retiredAt, 'the act\'s own result is unchanged').not.toBeNull();
    expect(rec.warned()).toContain(degradeLine(`temp-root collector ${COLLECT_SETTING_FEED_TITLE}, feed archive degraded`));
  });
});

describe("interruptlog.ts's recordInterrupt: recorded always, never pushed (D-5850)", () => {
  it('an interrupt is archived, never pushed, and flushed after the ring record', async () => {
    const rec = await feedRecorder(mkTmp('ccrc-feed-pin-interrupt-'));
    rec.setVisible([A]);                                     // the record gate does not read presence
    recordInterrupt(interruptDeps(rec), A, 'keycap', 'sent');
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.title])).toEqual([['interrupt', A, 'interrupt · keycap']]);
    expect(rec.pushes).toEqual([]);
    catchUpMatchesRing(rec);
  });

  it("recordInterrupt's degrade sentence: a failed archive never fails the interrupt, and the flush still follows", async () => {
    const rec = await feedRecorder(mkTmp('ccrc-feed-pin-interrupt-'));
    rec.archiveThrowsOn('every');
    expect(() => { recordInterrupt(interruptDeps(rec), A, 'keycap', 'sent'); }).not.toThrow();
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(rec.ring.map((e) => e.kind)).toEqual(['interrupt']);
    expect(rec.warned()).toContain(degradeLine('interrupt answered, feed archive degraded'));
  });
});

describe("server.ts's operator-answer pair (POST /api/sessions/:id/ask): recorded always, never pushed (D-5850)", () => {
  const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
  const ASK_KEY = askKey({ questions: [QUESTION] })!;
  const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
  const PARENT = 'acct-a-project-a-coordinator';

  const answered = async (fail: boolean, visible = true) => {
    const home = mkTmp('ccrc-feed-pin-ask-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [id, uuid] of [[B, 'c'.repeat(36)], [PARENT, 'p'.repeat(36)]] as const) {
      for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'project-a', workdir: `/w/${id}`, uuid, started: '1' })) {
        writeFileSync(path.join(reg, `${id}.${k}`), v);
      }
    }
    const now = Date.now();
    writeFileSync(path.join(reg, `${B}.hookstate.json`), JSON.stringify({
      v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: 'c'.repeat(36), pid: 4242,
      updatedAt: now, ask: { questions: [QUESTION] }, subagents: [],
    }));
    const run: Runner = async (_cmd, args) => (args[0] === 'capture-pane'
      ? { ran: true, code: 0, stdout: ASK_PANE, stderr: '' } : { ran: true, code: 0, stdout: '', stderr: '' });
    const rec = await feedRecorder(home);
    rec.setVisible(visible ? [B] : []);                      // the record gate does not read presence
    const app = await buildServer({ ...testDeps(home, run), coord: rec.coord, notifyLog: rec.notifyLog,
      push: rec.push as never, viewers: rec.viewers as never });
    try {
      const id = rec.coord.insertAsk({ childId: B, parentId: PARENT, runId: null, askKey: ASK_KEY, askAt: now,
        dialogId: 'dlg-1', question: QUESTION.question, options: QUESTION.options.map((o) => o.label), now });
      if (fail) rec.archiveThrowsOn('every');
      const at = rec.mark();
      const res = await app.inject({ method: 'POST', url: `/api/sessions/${B}/ask`,
        payload: { askKey: ASK_KEY, optionIndexes: [1] } });
      return { home, rec, res, calls: rec.since(at), id };
    } finally {
      await app.close();
    }
  };

  it('the answer is recorded and archived, never pushed, and flushed after the ring record', async () => {
    const { rec, res, calls } = await answered(false);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.title])).toEqual([['ask', B, 'question answered']]);
    expect(rec.pushes).toEqual([]);
  });

  it('with no one looking at the session the answer is still recorded and archived, and still never pushed (D-5857, Task C1c)',
    async () => {
      const { rec, res, calls } = await answered(false, false);
      expect(res.statusCode).toBe(200);
      expect(withoutFlush(calls)).toEqual(['record', 'archive']);
      expect(rec.archived.map((e) => [e.kind, e.sessionId, e.title])).toEqual([['ask', B, 'question answered']]);
      expect(rec.pushes, "the sink carries deps.push now; only 'record-only' keeps it silent").toEqual([]);
    });

  it("the catch-up response's bytes, filled through the operator-answer pair: the pair's key order (D-5857, Task C1c)",
    async () => {
      const { home, rec } = await answered(false);
      const [ev] = rec.ring;
      expect(await catchUpBody(home, rec.notifyLog)).toBe(catchUpExpected(rec.notifyLog, [
        { kind: 'ask', sessionId: B, runId: null, title: 'question answered', body: ev!.body, seq: 1, at: ev!.at },
      ]));
    });

  it('a failed archive leaves the answer 200 and the row answered, flushes after the record, and says so byte for byte',
    async () => {
      const { rec, res, calls, id } = await answered(true);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(withoutFlush(calls)).toEqual(['record', 'archive']);
      expect(flushedAfterRecord(calls)).toBe(true);
      expect(rec.archived).toEqual([]);
      expect(rec.pushes).toEqual([]);
      const row = rec.coord.askById(id);
      expect(row.ok && row.ask?.state, 'the act\'s own result is unchanged').toBe('answered');
      expect(rec.warned()).toContain(degradeLine('ask answered, feed archive degraded'));
    });
});

// ═══ PART 2 (D-5851, Task C0d): the writers in coord/ and stopDoneSweep.ts ═════════════════════════════════════════
//
// The same observable facts as part 1, for the eleven call lines in `coord/` and `stopDoneSweep.ts`: the record gate,
// the push (every one of these is `never`), the archive row, a flush after the ring record, and with the archive
// throwing the act's own result unchanged and the writer's degrade sentence byte for byte. Each route row goes through
// its route under `inject`; each executor row through the executor or the exported writer its lane calls, over fixture
// HOMEs and fake runners only (no `ccd`, no tmux, no live HOME). The approval ruling's row and the three child-reclaim
// rows sit on the approval and destructive paths and were written natively (plan Task C0d, band 3).

// ─── coord/routes.ts's five pairs, each through its route ──────────────────────────────────────────────────────────

const SESSION_OK = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null });

/** The coordination routes on a bare Fastify over a recorder, as `stall-settings-route.test.ts` registers them. */
const coordRoutesApp = (home: string, rec: FeedRecorder, over: Partial<Deps> = {}): FastifyInstance => {
  const base = testDeps(home);
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: false }, coord: rec.coord, notifyLog: rec.notifyLog,
    push: rec.push as never, viewers: rec.viewers as never, ...over };
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), SESSION_OK, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null });
  return app;
};

describe("coord/routes.ts POST /api/coord/caps: recorded always, never pushed (D-5851)", () => {
  const posted = async (fail: boolean) => {
    const home = mkTmp('ccrc-feed-pin-caps-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const rec = await feedRecorder(home);
    const app = coordRoutesApp(home, rec);
    try {
      if (fail) rec.archiveThrowsOn('every');
      const at = rec.mark();
      const res = await app.inject({ method: 'POST', url: '/api/coord/caps', payload: { maxConcurrentWorkers: 5 } });
      return { rec, res, calls: rec.since(at) };
    } finally { await app.close(); }
  };

  it('the caps change is recorded and archived, never pushed, and flushed after the ring record', async () => {
    const { rec, res, calls } = await posted(false);
    expect(res.statusCode).toBe(200);
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title, e.body]))
      // The body no longer names the retired daily dial (D-7068).
      .toEqual([['coord', '', null, 'caps changed', 'workers 3 → 5']]);
    expect(rec.pushes).toEqual([]);
    catchUpMatchesRing(rec);
  });

  it('a failed archive leaves the caps written and the answer 200, flushes after the record, and says so byte for byte',
    async () => {
      const { rec, res, calls } = await posted(true);
      expect(res.statusCode).toBe(200);
      expect(rec.coord.caps(), 'the act\'s own result is unchanged').toEqual({ maxConcurrentWorkers: 5 });
      expect(withoutFlush(calls)).toEqual(['record', 'archive']);
      expect(flushedAfterRecord(calls)).toBe(true);
      expect(rec.archived).toEqual([]);
      expect(rec.pushes).toEqual([]);
      expect(rec.warned()).toContain(degradeLine('caps written, feed archive degraded'));
    });
  it("caps's answer is the same status and bytes whether the archive lands or throws: a feed write never fails the route (D-5858, Task C1d)",
    async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_790_000_200_000);   // the view carries the write's moment: one clock for both
      const landed = await posted(false);
      const failed = await posted(true);
      expect(landed.res.statusCode, landed.res.body).toBe(200);
      expect(failed.res.statusCode, failed.res.body).toBe(200);
      expect(failed.res.body.startsWith('{"ok":true,')).toBe(true);
      expect(failed.res.body).toBe(landed.res.body);
    });
});

describe("coord/routes.ts POST /api/coord/stall-watch: recorded always, never pushed (D-5851)", () => {
  const posted = async (fail: boolean) => {
    const home = mkTmp('ccrc-feed-pin-stall-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const rec = await feedRecorder(home);
    const app = coordRoutesApp(home, rec);
    try {
      if (fail) rec.archiveThrowsOn('every');
      const at = rec.mark();
      const res = await app.inject({ method: 'POST', url: '/api/coord/stall-watch', payload: { level: 'off' } });
      return { rec, res, calls: rec.since(at) };
    } finally { await app.close(); }
  };

  it('the stall-watch change is recorded and archived, never pushed, and flushed after the ring record', async () => {
    const { rec, res, calls } = await posted(false);
    expect(res.statusCode).toBe(200);
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title, e.body]))
      .toEqual([['coord', '', null, 'stall watch changed', `level: ${STALL_FOLLOW_LABEL} → ${STALL_LEVEL_TEXT.off.label}; by flag-off`]]);
    expect(rec.pushes).toEqual([]);
  });

  it('a failed archive leaves the settings written and the answer 200, and says so byte for byte', async () => {
    const { rec, res, calls } = await posted(true);
    expect(res.statusCode).toBe(200);
    expect(parseStallSettings(rec.coord.stallSettings()).level, 'the act\'s own result is unchanged')
      .toEqual({ kind: 'chosen', level: 'off' });
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived).toEqual([]);
    expect(rec.pushes).toEqual([]);
    expect(rec.warned()).toContain(degradeLine('stall watch settings written, feed archive degraded'));
  });
  it("stall-watch's answer is the same status and bytes whether the archive lands or throws: a feed write never fails the route (D-5858, Task C1d)",
    async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_790_000_200_000);   // the view carries the write's moment: one clock for both
      const landed = await posted(false);
      const failed = await posted(true);
      expect(landed.res.statusCode, landed.res.body).toBe(200);
      expect(failed.res.statusCode, failed.res.body).toBe(200);
      expect(failed.res.body.startsWith('{"ok":true,')).toBe(true);
      expect(failed.res.body).toBe(landed.res.body);
    });
});

describe("coord/routes.ts POST /api/coord/collect-lane: recorded always, never pushed (D-5851)", () => {
  const posted = async (fail: boolean) => {
    const home = mkTmp('ccrc-feed-pin-collect-route-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const rec = await feedRecorder(home);
    const base = testDeps(home);
    const journal = collectLaneJournalAt(defaultCollectLaneJournalPath(base.cfg.ccrcDir));
    const cell = new FleetIdentityCell();
    cell.invalidate('awaiting-inventory');
    cell.publish(cell.epochNow(), { kind: 'known', nodeId: 'fleet', measuredAt: 1_790_000_000_000 });
    const fleetState: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-collect', COLLECT_CAP, RECLAIM_PAUSE_CAP] };
    // The starting state through the store's one writer, as `collect-lane-route.test.ts` sets it: the latch retired,
    // the switch Live on this node. These two writes record no feed row.
    expect(rec.coord.setCollectLane({ kind: 'retire', expected: rec.coord.collectLaneRow(), expectedJournal: journal.read() },
      1_790_000_100_000, journal).kind).toBe('written');
    expect(rec.coord.setCollectLane({ kind: 'live', fleetNodeId: 'fleet', expected: rec.coord.collectLaneRow(),
      expectedJournal: journal.read() }, 1_790_000_100_000, journal).kind).toBe('written');
    expect(rec.calls, 'the premise: the starting state recorded nothing').toEqual([]);
    const app = coordRoutesApp(home, rec, { fleetState, fleetIdentity: cell, collectLane: { journal, bootNonce: 'boot-1' } });
    try {
      if (fail) rec.archiveThrowsOn('every');
      const at = rec.mark();
      const res = await app.inject({ method: 'POST', url: '/api/coord/collect-lane', payload: { choice: 'off' } });
      return { rec, res, calls: rec.since(at) };
    } finally { await app.close(); }
  };

  it('the collector setting is recorded and archived, never pushed, and flushed after the ring record', async () => {
    const { rec, res, calls } = await posted(false);
    expect(res.statusCode, res.body).toBe(200);
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title])).toEqual([['coord', '', null, COLLECT_SETTING_FEED_TITLE]]);
    expect(rec.archived[0]!.body.endsWith('; by flag-off')).toBe(true);
    expect(rec.pushes).toEqual([]);
  });

  it('a failed archive leaves the setting written and the answer 200, and says so byte for byte', async () => {
    const { rec, res, calls } = await posted(true);
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json() as CollectLaneView;
    expect(view.stored.read === 'row' && view.stored.choice, 'the act\'s own result is unchanged').toBe('off');
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived).toEqual([]);
    expect(rec.pushes).toEqual([]);
    expect(rec.warned()).toContain(degradeLine('collector setting written, feed archive degraded'));
  });
  it("collect-lane's answer is the same status and bytes whether the archive lands or throws: a feed write never fails the route (D-5858, Task C1d)",
    async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_790_000_200_000);   // the view carries the write's moment: one clock for both
      const landed = await posted(false);
      const failed = await posted(true);
      expect(landed.res.statusCode, landed.res.body).toBe(200);
      expect(failed.res.statusCode, failed.res.body).toBe(200);
      expect(failed.res.body.startsWith('{"ok":true,')).toBe(true);
      expect(failed.res.body).toBe(landed.res.body);
    });
});

describe("coord/routes.ts POST /api/asks/:id/answer (the parent's answer): recorded always, never pushed (D-5851)", () => {
  const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
  const ASK_KEY = askKey({ questions: [QUESTION] })!;
  const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
  const TOKEN = 'f'.repeat(64);
  const PARENT = 'acct-a-project-a-coordinator';
  const PARENT_UUID = 'p'.repeat(36);

  const answered = async (fail: boolean) => {
    const home = mkTmp('ccrc-feed-pin-parent-answer-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [id, uuid] of [[B, 'c'.repeat(36)], [PARENT, PARENT_UUID]] as const) {
      for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'project-a', workdir: `/w/${id}`, uuid, started: '1' })) {
        writeFileSync(path.join(reg, `${id}.${k}`), v);
      }
    }
    const now = Date.now();
    writeFileSync(path.join(reg, `${B}.hookstate.json`), JSON.stringify({
      v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: 'c'.repeat(36), pid: 4242,
      updatedAt: now, ask: { questions: [QUESTION] }, subagents: [],
    }));
    const run: Runner = async (_cmd, args) => (args[0] === 'capture-pane'
      ? { ran: true, code: 0, stdout: ASK_PANE, stderr: '' } : { ran: true, code: 0, stdout: '', stderr: '' });
    const rec = await feedRecorder(home);
    rec.setVisible([B]);                                     // the record gate does not read presence
    const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord: rec.coord, notifyLog: rec.notifyLog,
      push: rec.push as never, viewers: rec.viewers as never });
    try {
      const id = rec.coord.insertAsk({ childId: B, parentId: PARENT, runId: null, askKey: ASK_KEY, askAt: now,
        dialogId: 'dlg-1', question: QUESTION.question, options: QUESTION.options.map((o) => o.label), now });
      if (fail) rec.archiveThrowsOn('every');
      const at = rec.mark();
      const res = await app.inject({ method: 'POST', url: `/api/asks/${id}/answer`, headers: { 'x-ccrc-mail-token': TOKEN },
        payload: { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] } });
      return { home, rec, res, calls: rec.since(at), id };
    } finally { await app.close(); }
  };

  it("the parent's answer is recorded and archived, never pushed, and flushed after the ring record", async () => {
    const { rec, res, calls } = await answered(false);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title, e.body])).toEqual([['ask', B, null,
      'question answered', `${PARENT} answered ${B}'s question: Which colour? → Blue`]]);
    expect(rec.pushes).toEqual([]);
  });

  it('a failed archive leaves the answer 200 and the row answered, and says so byte for byte', async () => {
    const { rec, res, calls, id } = await answered(true);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const row = rec.coord.askById(id);
    expect(row.ok && row.ask?.state, 'the act\'s own result is unchanged').toBe('answered');
    expect(withoutFlush(calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(calls)).toBe(true);
    expect(rec.archived).toEqual([]);
    expect(rec.pushes).toEqual([]);
    expect(rec.warned()).toContain(degradeLine('ask answered, feed archive degraded'));
  });
  it("the parent's answer is the same status and bytes whether the archive lands or throws (D-5858, Task C1d)", async () => {
    const landed = await answered(false);
    const failed = await answered(true);
    expect([landed.res.statusCode, landed.res.body]).toEqual([200, '{"ok":true}']);
    expect([failed.res.statusCode, failed.res.body]).toEqual([200, '{"ok":true}']);
  });
});

// Written natively (band 3: the approval path).
describe("coord/routes.ts POST /api/approvals/:id/rule (the ruling's journal row): recorded always, never pushed (D-5851)",
  () => {
    let fx: Approvals | undefined;
    afterEach(async () => { if (fx) await fx.close(); fx = undefined; });

    // The ruling route reads the harness's own Presence and pushes through the harness's own sink (`f.sent`), not the
    // recorder's: each row sets the child visible (or not) on `f.viewers` and asserts `f.sent` gained nothing, so a
    // push added to the writer, or a record gated on presence, is seen.
    const ruled = async (fail: boolean, verdict: 'allow' | 'deny', visible: boolean) => {
      const f = await standardFixture();
      fx = f;
      const rec = await feedRecorder(f.home, { coord: f.coord, notifyLog: f.log });
      if (visible) f.viewers.setVisible(Symbol('pin'), CHILD);
      const minted = await f.request(requestBody(hookInput({ command: 'rm -rf build' })));
      expect(minted.statusCode, 'the premise: the request is held').toBe(201);
      const id = (minted.json() as { id: number }).id;
      if (fail) rec.archiveThrowsOn('every');
      const at = rec.mark();
      const sentAt = f.sent.length;
      const res = await f.rule(id, PARENT, verdict);
      await new Promise((r) => setImmediate(r));
      return { f, rec, res, id, calls: rec.since(at), pushed: f.sent.slice(sentAt) };
    };

    it.each([['allow', false], ['allow', true], ['deny', false], ['deny', true]] as const)(
      'a %s ruling (child visible %s) is recorded and archived, never pushed by the writer, and flushed after the record',
      async (verdict, visible) => {
        const { rec, res, calls, pushed } = await ruled(false, verdict, visible);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, state: verdict === 'allow' ? 'allowed' : 'denied' });
        expect(withoutFlush(calls)).toEqual(['record', 'archive']);
        expect(flushedAfterRecord(calls)).toBe(true);
        expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title, e.body])).toEqual([['ask', CHILD, null,
          'permission ruled', `${PARENT} ${verdict === 'allow' ? 'allowed' : 'denied'} ${CHILD}'s Bash call: ${verdict} by the fixture`]]);
        expect(pushed, 'the ruling is never pushed').toEqual([]);
        catchUpMatchesRing(rec);
      });

    it('ruling stored, feed archive degraded: a failed archive leaves the ruling stored and signed, the answer 200, and says so byte for byte',
      async () => {
        const { f, rec, res, id, calls, pushed } = await ruled(true, 'allow', true);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, state: 'allowed' });
        const row = f.coord.approvalById(id);
        expect(row.ok && row.row !== null && [row.row.state, row.row.answeredBy], 'the act\'s own result is unchanged')
          .toEqual(['allowed', PARENT]);
        const stored = row.ok && row.row !== null && row.row.ruling !== null
          ? JSON.parse(row.row.ruling) as { record?: { verdict?: string }; sig?: unknown } : null;
        expect(stored?.record?.verdict, 'the stored ruling carries the verdict').toBe('allow');
        expect(typeof stored?.sig === 'string' && stored.sig.length > 0, 'and its signature').toBe(true);
        expect(withoutFlush(calls)).toEqual(['record', 'archive']);
        expect(flushedAfterRecord(calls)).toBe(true);
        expect(rec.ring.map((e) => e.title)).toEqual(['permission ruled']);
        expect(rec.archived).toEqual([]);
        expect(pushed, 'the ruling is never pushed').toEqual([]);
        expect(rec.warned()).toContain(degradeLine('ruling stored, feed archive degraded'));
      });
    it('the ruling answers the same status and bytes whether the archive lands or throws (D-5858, Task C1d)', async () => {
      const landed = await ruled(false, 'deny', false);
      const landedAnswer = [landed.res.statusCode, landed.res.body];
      await landed.f.close();
      fx = undefined;
      const failed = await ruled(true, 'deny', false);
      expect(landedAnswer).toEqual([200, '{"ok":true,"state":"denied"}']);
      expect([failed.res.statusCode, failed.res.body]).toEqual([200, '{"ok":true,"state":"denied"}']);
    });
  });

// ─── coord/childReclaim.ts's three writers (written natively, band 3: the destructive path) ──────────────────────────
//
// The operator's ruling at `recordChildReclaimFeed`: every reclaim lands in the feed; no push per reap. None of the
// three writers' deps carries a push sink in production; each row hands one anyway (and a visible presence), so a push
// added to a writer, or a record gated on presence, is seen.

const CLAIM_RUN = 7;

/** A marked child of a FAILED run with nothing open on it, the reclaim switch raised, under a fixture HOME: the
 *  executor defers `paused-at-server` before any argv (`child-reclaim-paused-at-server.test.ts`'s fixture), so its one
 *  feed row is written and no `ccd` verb is ever composed. */
const reclaimRig = async (visible: boolean) => {
  const home = mkTmp('ccrc-feed-pin-reclaim-');
  const argv: string[][] = [];
  const base = testDeps(home, async (_cmd, args) => { argv.push(args); return { ran: true, code: 1, stdout: '', stderr: '' }; });
  const reg = base.cfg.registryDir;
  mkdirSync(reg, { recursive: true });
  const rec = await feedRecorder(home);
  const opened = rec.coord.openRun({ program: 'pin-2', title: 'pin', project: 'project-a', wave: 1, waveOf: null,
    claimedBy: 'project-a-coordinator' });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  const closed = rec.coord.closeRun({ runId: opened.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null,
    program: 'pin-2', viaClosing: false });
  if (!closed.ok) throw new Error(`close refused: ${JSON.stringify(closed)}`);
  for (const [k, v] of Object.entries({ uuid: `u-${A}`, wrapper: 'claude', project: 'project-a', workdir: `/w/${A}`,
    workspace: 'a', branch: `ws/${A}`, base: 'origin/main', started: '1', child: String(opened.id) })) {
    writeFileSync(path.join(reg, `${A}.${k}`), v);
  }
  writeFileSync(path.join(reg, RECLAIM_PAUSE_MARKER), '');
  if (visible) rec.setVisible([A]);
  const deps = {
    coord: rec.coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, ACTOR_FLAGS_CAP] },
    viewers: rec.viewers, notifyLog: rec.notifyLog, push: rec.push,
  };
  const reclaim = () => reclaimChild(deps as ChildReclaimDeps, {
    sessionId: A, runId: opened.id, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'none' },
  });
  return { rec, reclaim, runId: opened.id, argv };
};

describe("coord/childReclaim.ts's executor row (recordChildReclaimFeed): recorded always, no push per reap (D-5851)", () => {
  it.each([false, true])('every reclaim lands in the feed and no push per reap (visible %s): ring, archive, never a push',
    async (visible) => {
      const r = await reclaimRig(visible);
      const at = r.rec.mark();
      expect(await r.reclaim()).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
      expect(r.argv, 'SAFETY: no ccd verb was composed').toEqual([]);
      expect(withoutFlush(r.rec.since(at))).toEqual(['record', 'archive']);
      expect(flushedAfterRecord(r.rec.since(at))).toBe(true);
      expect(r.rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title]))
        .toEqual([['run', A, r.runId, 'child reclaim deferred']]);
      expect(r.rec.pushes).toEqual([]);
      catchUpMatchesRing(r.rec);
    });

  it('a failed archive leaves the outcome unchanged, flushes after the record, and says so byte for byte', async () => {
    const r = await reclaimRig(false);
    r.rec.archiveThrowsOn('every');
    const at = r.rec.mark();
    expect(await r.reclaim(), 'the act\'s own result is unchanged').toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(withoutFlush(r.rec.since(at))).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(r.rec.since(at))).toBe(true);
    expect(r.rec.ring.map((e) => e.title)).toEqual(['child reclaim deferred']);
    expect(r.rec.archived).toEqual([]);
    expect(r.rec.pushes).toEqual([]);
    expect(r.rec.warned()).toContain(degradeLine('child reclaim deferred, feed archive degraded'));
  });
});

/** The deps the sweep hands the kept writers (`{ coord, notifyLog }`), plus a push sink and a presence that says
 *  visible, which no production caller passes: a writer that pushed or read presence would show it. */
const keptDeps = async (fail: boolean) => {
  const rec = await feedRecorder(mkTmp('ccrc-feed-pin-kept-'));
  rec.setVisible([A]);
  if (fail) rec.archiveThrowsOn('every');
  const deps = { coord: rec.coord, notifyLog: rec.notifyLog, viewers: rec.viewers, push: rec.push };
  return { rec, deps };
};
const KEPT: ChildReclaimKeptAttention = { kind: 'kept', sessionId: A, runId: CLAIM_RUN, word: 'coordinating',
  sentence: 'kept: it has coordinated a run of its own.' };
const LEAF: ChildReclaimLeafKept = { item: { kind: 'leaf-kept', sessionId: A, runId: CLAIM_RUN,
  sentence: 'its leaf was kept.', at: null }, source: 1, detail: null, clipsClause: null, foundNothing: false };

describe("coord/childReclaim.ts's kept row (recordChildReclaimKeptFeed): recorded always, never pushed (D-5851)", () => {
  it('every reclaim lands in the feed: the kept row is recorded and archived whatever the presence, never pushed', async () => {
    const { rec, deps } = await keptDeps(false);
    recordChildReclaimKeptFeed(deps, KEPT);
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title, e.body])).toEqual([['run', A, CLAIM_RUN,
      CHILD_RECLAIM_KEPT_FEED_TITLE, `${A}, child of run #${CLAIM_RUN}: ${KEPT.sentence}`]]);
    expect(rec.pushes).toEqual([]);
  });

  it('child reclaim kept, feed archive degraded: a failed archive never throws, flushes after the record, byte for byte',
    async () => {
      const { rec, deps } = await keptDeps(true);
      expect(() => { recordChildReclaimKeptFeed(deps, KEPT); }).not.toThrow();
      expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
      expect(flushedAfterRecord(rec.calls)).toBe(true);
      expect(rec.ring.map((e) => e.title)).toEqual([CHILD_RECLAIM_KEPT_FEED_TITLE]);
      expect(rec.archived).toEqual([]);
      expect(rec.warned()).toContain(degradeLine('child reclaim kept, feed archive degraded'));
    });
});

describe("coord/childReclaim.ts's kept-leaf row (recordChildReclaimLeafKeptFeed): recorded always, never pushed (D-5851)",
  () => {
    it('the kept-leaf row is recorded and archived whatever the presence, never pushed, and flushed after the record',
      async () => {
        const { rec, deps } = await keptDeps(false);
        recordChildReclaimLeafKeptFeed(deps, LEAF);
        expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
        expect(flushedAfterRecord(rec.calls)).toBe(true);
        expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title, e.body])).toEqual([['run', A, CLAIM_RUN,
          CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE, `${A}, child of run #${CLAIM_RUN}: its leaf was kept. ccd recorded no detail.`]]);
        expect(rec.pushes).toEqual([]);
      });

    it('a failed archive never throws, flushes after the record, and says so byte for byte', async () => {
      const { rec, deps } = await keptDeps(true);
      expect(() => { recordChildReclaimLeafKeptFeed(deps, LEAF); }).not.toThrow();
      expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
      expect(flushedAfterRecord(rec.calls)).toBe(true);
      expect(rec.archived).toEqual([]);
      expect(rec.warned()).toContain(degradeLine('child reclaim leaf kept, feed archive degraded'));
    });
  });

// ─── coord/expireArchived.ts and coord/endDeadCoordinator.ts ─────────────────────────────────────────────────────────

describe("coord/expireArchived.ts's row (recordExpireFeed): recorded always, never pushed (D-5851)", () => {
  const ID = 'acct-a-project-a';
  /** The executor over a fixture HOME whose fleet advertises no expire capability: it answers `deferred` before any
   *  read or argv, and the lane hands that outcome to the writer. */
  const expired = async (fail: boolean) => {
    const home = mkTmp('ccrc-feed-pin-expire-');
    const argv: string[][] = [];
    const base = testDeps(home, async (_cmd, args) => { argv.push(args); return { ran: true, code: 1, stdout: '', stderr: '' }; });
    mkdirSync(base.cfg.registryDir, { recursive: true });
    const rec = await feedRecorder(home);
    rec.setVisible([ID]);                                    // the record gate does not read presence
    const deps: ExpireArchivedDeps = { coord: rec.coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: [] },
      viewers: rec.viewers, notifyLog: rec.notifyLog };
    const out = await expireArchived(deps, { sessionId: ID, archivedAt: 1_789_000_000, expiresAt: 1_789_604_800 });
    expect(out, 'the premise').toMatchObject({ kind: 'deferred', why: 'unsupported' });
    expect(argv, 'SAFETY: no ccd verb was composed').toEqual([]);
    if (fail) rec.archiveThrowsOn('every');
    expect(() => { recordExpireFeed(deps, out); }).not.toThrow();
    return { rec, out };
  };

  it("expiry's row is flushed: recorded and archived, never pushed, and flushed after the ring record", async () => {
    const { rec } = await expired(false);
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title])).toEqual([['run', ID, null, 'archived workspace cleanup deferred']]);
    expect(rec.pushes).toEqual([]);
  });

  it('a failed archive never throws, flushes after the record, and says so byte for byte', async () => {
    const { rec } = await expired(true);
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(rec.ring.map((e) => e.title)).toEqual(['archived workspace cleanup deferred']);
    expect(rec.archived).toEqual([]);
    expect(rec.warned()).toContain(degradeLine('archived expiry deferred, feed archive degraded'));
  });
});

describe("coord/endDeadCoordinator.ts's batch (recordRows): one try over the rows, never pushed (D-5851)", () => {
  const CLAIMANT = 'acct-a-project-a-coordinator';
  const SINCE = Date.UTC(2026, 9, 1, 0, 0, 0);
  const TWO: DeadCoordinatorActOutcome = { kind: 'would-end', programmes: [
    { slug: 'prog-a', runIds: [11] }, { slug: 'prog-b', runIds: [12, 13] }] };
  const batch = async (fail: boolean) => {
    const rec = await feedRecorder(mkTmp('ccrc-feed-pin-dead-'));
    rec.setVisible([CLAIMANT]);                              // the record gate does not read presence
    if (fail) rec.archiveThrowsOn(1);
    expect(() => { recordDeadCoordinatorFeed({ coord: rec.coord, notifyLog: rec.notifyLog }, CLAIMANT, TWO, SINCE); }).not.toThrow();
    return rec;
  };

  it('two programmes: two rows, each recorded then archived, one flush after the records, never a push', async () => {
    const rec = await batch(false);
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive', 'record', 'archive']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(rec.calls.filter((c) => c === 'flush')).toHaveLength(1);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title])).toEqual([
      ['run', CLAIMANT, null, 'dead coordinator: programme would be ended'],
      ['run', CLAIMANT, null, 'dead coordinator: programme would be ended']]);
    expect(rec.archived.map((e) => e.body.split(' (')[0])).toEqual(['would end programme prog-a', 'would end programme prog-b']);
    expect(rec.pushes).toEqual([]);
    catchUpMatchesRing(rec);
  });

  it('a failed archive mid-batch drops the rows after it: the first row is in the ring only, the second in neither, one sentence',
    async () => {
      const rec = await batch(true);
      expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
      expect(flushedAfterRecord(rec.calls)).toBe(true);
      expect(rec.ring.map((e) => e.body.split(' (')[0])).toEqual(['would end programme prog-a']);
      expect(rec.archived).toEqual([]);
      expect(rec.warned().filter((l) => l.includes('recordFeedEvent failed')))
        .toEqual([degradeLine('dead coordinator would-end, feed archive degraded')]);
    });
});

// ─── stopDoneSweep.ts ───────────────────────────────────────────────────────────────────────────────────────────────

describe("stopDoneSweep.ts's row (stopDonePass → recordFeed): recorded always, never pushed (D-5851)", () => {
  const NOW = 1_800_000_000_000;
  const HOUR = 3_600_000;
  const ID = 'acct-a-project-a';
  const RUN = 10;
  /** `stop-done-sweep.test.ts`'s fake, trimmed to the happy path, over the recorder's real log and store: one finished
   *  worker, idle seven hours, a fake `runCcd` that only records its argv (no fleet is touched). */
  const passed = async (fail: boolean) => {
    const rec = await feedRecorder(mkTmp('ccrc-feed-pin-stop-done-'));
    if (fail) rec.archiveThrowsOn('every');
    const argv: string[][] = [];
    const row = { id: ID, child: { kind: 'child', runId: 1 }, archivedAt: null, held: null, stoppedBy: null, unmeasured: [],
      statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null,
      substrate: null, bucket: 'idle' } as unknown as FleetSession;
    const record = { id: ID, uuid: `uuid-${ID}` } as unknown as SessionRecord;
    const deps: StopDoneSweepDeps = {
      coord: {
        lastRunBySession: (asked: readonly string[]) => ({ ok: true as const,
          last: asked.map((sessionId) => ({ sessionId, runId: RUN, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1,
            program: 'p', programTitle: null, claimedBy: 'project-a-coordinator' })),
          openWorkers: [], openClaimants: ['project-a-coordinator'],
          // D-6091: the run-done policy's placed reads — the same finished run, and no placed open one.
          lastPlaced: asked.map((sessionId) => ({ sessionId, runId: RUN, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1,
            program: 'p', programTitle: null, claimedBy: 'project-a-coordinator' })),
          openPlacedWorkers: [], parkedPlacedWorkers: [] }),
        activeClaims: () => [],
        outstandingMailFor: () => [] as never,
        recordFeedEvent: (epoch, ev) => rec.coord.recordFeedEvent(epoch, ev),
        run: () => ({ ok: true as const, run: { state: 'working', reviews: null } }) as never,
      },
      runCcd: async (a) => { argv.push([...a]); return { ran: true, ok: true, stdout: '', stderr: '', killed: false, signal: null }; },
      fleetState: { ccdVerbs: ['hibernate', ACTOR_FLAGS_CAP] } as unknown as FleetState,
      viewers: { isOpen: () => false },
      notifyLog: rec.notifyLog,
      liveWord: async () => ({ ok: true, word: 'idle', since: null }),
      turnVerdict: async () => 'idle',
      mark: async () => ({ ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 7 * HOUR - 60_000, stopAt: NOW - 7 * HOUR,
        restartAt: null }),
      rowAtAct: async () => ({ ok: true, row: row as never }),
      serial: async (fn) => fn(),
      queueRun: async (_id, fn) => fn(),
      startedAt: NOW - PRESENCE_OPEN_TTL_MS - 60_000,
      now: () => NOW,
    };
    // D-6091: a lane that already wrote its mail-only zero, so the one row here is the sleep's.
    const out = await stopDonePass(deps, { retryAt: new Map(), mailOnly: 0 }, [row], [record], []);
    return { rec, out, argv };
  };

  it("stop-done's sleep has a feed row: recorded and archived, never pushed, and flushed after the ring record", async () => {
    const { rec, out, argv } = await passed(false);
    expect(out).toEqual([{ id: ID, kind: 'hibernated', runId: RUN }]);
    expect(argv).toEqual([['hibernate', ID, '--surface', 'agent', '--actor', 'sweep:stop-done']]);
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.runId, e.title, e.body])).toEqual([['run', ID, RUN, 'Worker asleep',
      `${ID} was put to sleep: its run ${RUN} is done and it sat idle. Mail, a re-dispatch or a restart wakes it.`]]);
    expect(rec.pushes).toEqual([]);
  });

  it('a failed archive leaves the worker asleep and the outcome unchanged, and says so byte for byte', async () => {
    const { rec, out } = await passed(true);
    expect(out, 'the act\'s own result is unchanged').toEqual([{ id: ID, kind: 'hibernated', runId: RUN }]);
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(rec.archived).toEqual([]);
    expect(rec.warned()).toContain(`ccrc-server: stop-done: recordFeedEvent failed (disk full) — ${ID}'s sleep has no feed row`);
  });
});


// ─── D-5859 (plan docs/superpowers/plans/2026-10-19-consolidation-w1a-switches-notify.md, Task C1e; ARCH-54 (#789)) ──
//
// APPENDED. The executors' five writers move onto the funnel (`notice.ts`). Every row above stays as it is; these add
// what a move could break unseen: each writer HANDED a push sink, with the operator looking and not looking, records
// and never pushes (a funnel mode that pushes when no one looks would show here, and nowhere above for the kept, expiry
// and dead-coordinator rows, whose rigs hand no push or only a visible presence); and a failed archive leaves the
// reclaim executor's own result and its run's stored rows exactly as a landing archive leaves them.

describe('the executors\' writers, handed a push sink: recorded whatever the presence, never pushed (D-5859)', () => {
  const EXPIRE_ID = 'acct-a-project-a';
  const CLAIMANT = 'acct-a-project-a-coordinator';
  const ONE: DeadCoordinatorActOutcome = { kind: 'would-end', programmes: [{ slug: 'prog-a', runIds: [11] }] };
  /** Sinks with a push and a presence that says `visible` for every session the rows below name. */
  const sinks = async (visible: boolean) => {
    const home = mkTmp('ccrc-feed-pin-c1e-');
    const rec = await feedRecorder(home);
    rec.setVisible(visible ? [A, EXPIRE_ID, CLAIMANT] : []);
    return { home, rec, deps: { coord: rec.coord, notifyLog: rec.notifyLog, viewers: rec.viewers, push: rec.push } };
  };
  /** The expiry writer's input, from the executor itself (no expire capability: `deferred` before any argv). */
  const expiryOutcome = async (home: string, rec: FeedRecorder) => {
    const base = testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' }));
    mkdirSync(base.cfg.registryDir, { recursive: true });
    const deps: ExpireArchivedDeps = { coord: rec.coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
      fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: [] },
      viewers: rec.viewers, notifyLog: rec.notifyLog };
    return { deps, out: await expireArchived(deps, { sessionId: EXPIRE_ID, archivedAt: 1_789_000_000, expiresAt: 1_789_604_800 }) };
  };

  it.each([false, true])('the kept row and the kept-leaf row (visible %s): ring and archive, never a push', async (visible) => {
    const { rec, deps } = await sinks(visible);
    recordChildReclaimKeptFeed(deps, KEPT);
    recordChildReclaimLeafKeptFeed(deps, LEAF);
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive', 'record', 'archive']);
    expect(rec.archived.map((e) => e.title)).toEqual([CHILD_RECLAIM_KEPT_FEED_TITLE, CHILD_RECLAIM_LEAF_KEPT_FEED_TITLE]);
    expect(rec.pushes).toEqual([]);
  });

  it.each([false, true])("expiry's row (visible %s): ring and archive, never a push", async (visible) => {
    const { home, rec } = await sinks(visible);
    const { deps, out } = await expiryOutcome(home, rec);
    const at = rec.mark();
    // Handed a push sink: bound first, so the writer's narrower deps type admits the extra member.
    const handed = { ...deps, push: rec.push };
    recordExpireFeed(handed, out);
    expect(withoutFlush(rec.since(at))).toEqual(['record', 'archive']);
    expect(rec.archived.map((e) => [e.sessionId, e.title])).toEqual([[EXPIRE_ID, 'archived workspace cleanup deferred']]);
    expect(rec.pushes).toEqual([]);
  });

  it.each([false, true])("the dead coordinator's batch (visible %s): ring and archive, never a push", async (visible) => {
    const { rec, deps } = await sinks(visible);
    recordDeadCoordinatorFeed(deps, CLAIMANT, ONE, Date.UTC(2026, 9, 1));
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
    expect(rec.archived.map((e) => [e.sessionId, e.title])).toEqual([[CLAIMANT, 'dead coordinator: programme would be ended']]);
    expect(rec.pushes).toEqual([]);
  });

  it("a failed archive leaves the reclaim executor's result and its run's stored rows as a landing archive leaves them",
    async () => {
      const stored = async (fail: boolean) => {
        const r = await reclaimRig(false);
        if (fail) r.rec.archiveThrowsOn('every');
        const out = await r.reclaim();
        const run = r.rec.coord.run(r.runId);
        const events = r.rec.coord.runEvents(r.runId).map(({ at: _at, ...e }) => e);
        return { out, run: JSON.stringify(run).replace(/"(?:[a-zA-Z]*At|at|updated|created)":\d+/g, ''), events,
          archived: r.rec.archived.length, pushes: r.rec.pushes.length };
      };
      const landed = await stored(false);
      const failed = await stored(true);
      expect([landed.archived, failed.archived], 'the premise: one archive landed, one failed').toEqual([1, 0]);
      expect(failed.out).toEqual(landed.out);
      expect(failed.run).toEqual(landed.run);
      expect(failed.events).toEqual(landed.events);
      expect([landed.pushes, failed.pushes]).toEqual([0, 0]);
    });
});
