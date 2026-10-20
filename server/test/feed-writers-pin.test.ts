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
import { IDLE_COMPACT_NUDGE_PROMPT, type FleetSession } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { IDLE_TAIL, T_NOTICE, T_STOP, jsonl } from './idleNudgeFixtures.js';
import { collectRig } from './collectLaneFixture.js';
import { degradeLine, feedRecorder, flushedAfterRecord, withoutFlush, type FeedRecorder } from './feedWriterFixture.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const A = 'acct-a-project-a';
const B = 'acct-b-project-a';

// ─── pushOne, through the lanes that call it ────────────────────────────────────────────────────────────────────────

/** One registry entry and one live-status file per id (all `busy`, so the priming tick records `busy` and a later
 *  `markIdle` is a real busy→idle edge, the `done` push's lane), under one wrapper. `push-copy.test.ts`'s seeding. */
const pushRig = async () => {
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
      return { code: 0, stdout: pid ? `${pid}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') return { code: 0, stdout: 'ready\n❯ \n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const deps = { ...testDeps(home, run), push: rec.push, presence: rec.presence, notifyLog: rec.notifyLog, coord: rec.coord };
  const w = new FleetWatcher(deps as never, new Bus(), 10_000, path.join(home, 'state-cache.json'));
  await w.tick();                                          // priming: no push, no record
  /** A run bound to session A, its watermark seeded by the priming tick. */
  const openRun = (): number => {
    const r = rec.coord.openRun({ program: 'pin-1', title: 'pin', project: 'project-a', wave: 1, waveOf: 2,
      claimedBy: 'project-a-coordinator' }) as { id: number };
    rec.coord.setSession(r.id, A);
    return r.id;
  };
  return { rec, w, markIdle: (id: string) => live(id, 'idle'), openRun };
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
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${NUDGE_PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: `❯ ${box}\n`, stderr: '' };
    if (args[0] === 'send-keys') {
      sends.push([...args]);
      box = args[3] === '-l' ? box + args[5]! : '';
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const deps = { ...base, coord: rec.coord, presence: rec.presence, ...(o.notifyLog === false ? {} : { notifyLog: rec.notifyLog }) };
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
    workspace: `${A}-ws`, name: null, status: 'idle', statusUpdatedAt: T_NOTICE, limits: null,
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
    recordInterrupt({ notifyLog: rec.notifyLog, coord: rec.coord }, A, 'keycap', 'sent');
    expect(withoutFlush(rec.calls)).toEqual(['record', 'archive']);
    expect(flushedAfterRecord(rec.calls)).toBe(true);
    expect(rec.archived.map((e) => [e.kind, e.sessionId, e.title])).toEqual([['interrupt', A, 'interrupt · keycap']]);
    expect(rec.pushes).toEqual([]);
    catchUpMatchesRing(rec);
  });

  it("recordInterrupt's degrade sentence: a failed archive never fails the interrupt, and the flush still follows", async () => {
    const rec = await feedRecorder(mkTmp('ccrc-feed-pin-interrupt-'));
    rec.archiveThrowsOn('every');
    expect(() => { recordInterrupt({ notifyLog: rec.notifyLog, coord: rec.coord }, A, 'keycap', 'sent'); }).not.toThrow();
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

  const answered = async (fail: boolean) => {
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
      ? { code: 0, stdout: ASK_PANE, stderr: '' } : { code: 0, stdout: '', stderr: '' });
    const rec = await feedRecorder(home);
    rec.setVisible([B]);                                     // the record gate does not read presence
    const app = await buildServer({ ...testDeps(home, run), coord: rec.coord, notifyLog: rec.notifyLog,
      push: rec.push as never, presence: rec.presence as never });
    try {
      const id = rec.coord.insertAsk({ childId: B, parentId: PARENT, runId: null, askKey: ASK_KEY, askAt: now,
        dialogId: 'dlg-1', question: QUESTION.question, options: QUESTION.options.map((o) => o.label), now });
      if (fail) rec.archiveThrowsOn('every');
      const at = rec.mark();
      const res = await app.inject({ method: 'POST', url: `/api/sessions/${B}/ask`,
        payload: { askKey: ASK_KEY, optionIndexes: [1] } });
      return { rec, res, calls: rec.since(at), id };
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
