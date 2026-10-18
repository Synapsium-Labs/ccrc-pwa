import { describe, expect, it, vi } from 'vitest';
import { stopDonePass, type StopDoneMemory, type StopDoneSweepDeps } from '../src/stopDoneSweep.js';
import { STOP_DONE_DISABLED_MARKER, STOP_DONE_GRACE_MS, STOP_DONE_PER_PASS, STOP_DONE_RETRY_MS } from '../src/stopDone.js';
import { PRESENCE_OPEN_TTL_MS, PRESENCE_TTL_MS, type FleetSession } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';
import type { FleetState } from '../src/fleetstate.js';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { buildServer } from '../src/server.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { Presence } from '../src/presence.js';
import { readSessionRecord } from '../src/registry.js';
import { liveRowFor, turnReadDeps } from '../src/turnverdict.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP } from '../src/ccdargv.js';
import { HIBERNATE_AFTER_HOURS_FILE, HIBERNATE_DISABLED_MARKER, NO_HIBERNATE_SUFFIX } from '../src/coord/hibernate.js';

// D-5370 (`stop-worker-at-run-done`): the lane. The verdict's holds are pinned in `stop-done-verdict.test.ts`; this
// file pins what the PASS does with them — the kill switch, the serialiser, the per-pass bound, the act-time re-read,
// the declared stop, the one feed row, and the retry memory.

const NOW = 1_800_000_000_000;
const STARTED = NOW - PRESENCE_OPEN_TTL_MS - 60_000;
const HOUR = 3_600_000;
/** A `done` marker seven hours old — past N — nothing in the background, nothing scheduled. */
const MARK_IDLE = { ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 7 * HOUR - 60_000, stopAt: NOW - 7 * HOUR, restartAt: null } as const;

const row = (id: string, o: Partial<FleetSession> = {}): FleetSession => ({
  id, child: { kind: 'child', runId: 1 }, archivedAt: null, held: null, stoppedBy: null, unmeasured: [],
  statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null,
  substrate: null, bucket: 'idle', ...o,
}) as unknown as FleetSession;
const rec = (id: string): SessionRecord => ({ id, uuid: `uuid-${id}` }) as unknown as SessionRecord;

interface Fake {
  deps: StopDoneSweepDeps;
  argv: string[][];
  feed: { sessionId: string; runId: number | null }[];
  serialCalls: number;
  /** Per session: the newest run's state and close time, and whether another open run names it. */
  runs: Map<string, { runId: number; state: string; closedAt: number | null }>;
  openWorkers: Set<string>;
  mailTo: Set<string>;
  ccdOk: boolean;
  /** Per session: what its row reads when the record is re-read at the act (`rowAtAct`); absent → the tick's row. */
  atAct: Map<string, Partial<FleetSession> | 'unreadable'>;
  /** Per session: the open run it reviews, if any (`runsNamingSession` → `run.reviews` → an open state). */
  reviewsOpen: Set<string>;
}

function fake(ids: readonly string[], o: { verb?: boolean; serial?: boolean } = {}): Fake {
  const f: Fake = {
    argv: [], feed: [], serialCalls: 0, runs: new Map(), openWorkers: new Set(), mailTo: new Set(), ccdOk: true,
    atAct: new Map(), reviewsOpen: new Set(),
    deps: undefined as unknown as StopDoneSweepDeps,
  };
  ids.forEach((id, i) => f.runs.set(id, { runId: 10 + i, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1 }));
  let seq = 0;
  f.deps = {
    coord: {
      lastRunBySession: (asked: readonly string[]) => ({
        ok: true as const,
        last: asked.flatMap((sessionId) => {
          const r = f.runs.get(sessionId);
          return r === undefined ? [] : [{ sessionId, ...r, program: 'p', programTitle: null, claimedBy: 'lane-a-project-a' }];
        }),
        openWorkers: asked.filter((id) => f.openWorkers.has(id)),
        openClaimants: ['lane-a-project-a'],
      }),
      activeClaims: () => [],
      outstandingMailFor: (toId: string) => (f.mailTo.has(toId) ? [{}] : []) as never,
      recordFeedEvent: () => undefined,
      runsNamingSession: (id: string) => ({ ok: true as const, runs: f.reviewsOpen.has(id) ? [{ id: 900 }] : [] }) as never,
      run: (runId: number) => ({ ok: true as const, run: runId === 900 ? { reviews: 901 } : { state: 'working', reviews: null } }) as never,
    },
    runCcd: async (a) => { f.argv.push([...a]); return { ok: f.ccdOk, stdout: '', stderr: f.ccdOk ? '' : 'refused', killed: false, signal: null }; },
    fleetState: { ccdVerbs: o.verb === false ? ['stop-surface', ACTOR_FLAGS_CAP] : ['hibernate', ACTOR_FLAGS_CAP] } as unknown as FleetState,
    presence: { isOpen: () => false },
    notifyLog: {
      epoch: 'e', record: (e: { sessionId: string; runId: number | null }) => { f.feed.push({ sessionId: e.sessionId, runId: e.runId }); return { ...e, seq: ++seq, at: NOW }; },
      flush: async () => undefined,
    } as unknown as StopDoneSweepDeps['notifyLog'],
    liveWord: async () => ({ ok: true, word: 'idle', since: null }),
    turnVerdict: async () => 'idle',
    mark: async () => MARK_IDLE,
    readAfterHours: async () => null,
    rowAtAct: async (r) => {
      const a = f.atAct.get(r.id);
      return a === 'unreadable' ? { ok: false } : { ok: true, row: row(r.id, a ?? {}) };
    },
    serial: o.serial === false ? null : async (fn) => { f.serialCalls++; return fn(); },
    queueRun: async (_id, fn) => fn(),
    startedAt: STARTED,
    now: () => NOW,
  };
  return f;
}

const mem = (): StopDoneMemory => ({ retryAt: new Map() });
/** The argv the lane composes since Task 17b (stop-done-composes-hibernate (D-5427)): `ccd hibernate`, declared. */
const HIB = (id: string): string[] => ['hibernate', id, '--surface', 'agent', '--actor', 'sweep:stop-done'];
const ID = 'project-a-quiet-basin';

describe('stopDonePass (D-5370)', () => {
  // TASK 17b (stop-done-composes-hibernate (D-5427)): the lane puts a finished worker to sleep with `ccd hibernate`, and
  // holds what hibernation holds and it lacked.
  it('hibernate-disabled stops this lane too: nothing is read and nothing is composed', async () => {
    const f = fake([ID]);
    const live = vi.fn(f.deps.liveWord);
    expect(await stopDonePass({ ...f.deps, liveWord: live }, mem(), [row(ID)], [rec(ID)], [HIBERNATE_DISABLED_MARKER])).toEqual([]);
    expect(f.argv).toEqual([]);
    expect(live).not.toHaveBeenCalled();
  });

  it('recent: a worker idle less than N (6 h) since its marker\'s last stamp is left awake', async () => {
    const f = fake([ID]);
    const mark: StopDoneSweepDeps['mark'] = async () => ({ ...MARK_IDLE, turnAt: NOW - 5 * HOUR, stopAt: NOW - 5 * HOUR });
    await stopDonePass({ ...f.deps, mark }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('N is the operator\'s hibernate-after-hours, read only when listed: 2 puts a 3 h worker to sleep', async () => {
    const f = fake([ID]);
    const mark: StopDoneSweepDeps['mark'] = async () => ({ ...MARK_IDLE, turnAt: NOW - 3 * HOUR, stopAt: NOW - 3 * HOUR });
    const after = vi.fn(async () => '2');
    await stopDonePass({ ...f.deps, mark, readAfterHours: after }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv, 'unlisted: the default N holds the 3 h worker').toEqual([]);
    expect(after).not.toHaveBeenCalled();
    await stopDonePass({ ...f.deps, mark, readAfterHours: after }, mem(), [row(ID)], [rec(ID)], [HIBERNATE_AFTER_HOURS_FILE]);
    expect(f.argv).toEqual([HIB(ID)]);
  });

  it('opted-out: a worker with $REG/<id>.no-hibernate is left awake', async () => {
    const f = fake([ID]);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], [`${ID}.${NO_HIBERNATE_SUFFIX}`]);
    expect(f.argv).toEqual([]);
  });

  it('scheduled: a marker that lists a session cron, or carries none (an older hook), leaves the worker awake', async () => {
    for (const crons of [1, null]) {
      const f = fake([ID]);
      await stopDonePass({ ...f.deps, mark: async () => ({ ...MARK_IDLE, crons }) }, mem(), [row(ID)], [rec(ID)], []);
      expect(f.argv, String(crons)).toEqual([]);
    }
  });

  it('ccd refusing session-busy (attached, at the act) is not asked again for the retry interval, and writes no feed row', async () => {
    const f = fake([ID]);
    const m = mem();
    const runCcd: StopDoneSweepDeps['runCcd'] = async (a) => { f.argv.push([...a]); return { ok: false, stdout: '', stderr: 'ccd: session-busy: attached — 1 terminal(s) attached to the pane', killed: false, signal: null }; };
    const out = await stopDonePass({ ...f.deps, runCcd }, m, [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'skipped', detail: 'attached' }]);
    expect(f.feed).toEqual([]);
    await stopDonePass({ ...f.deps, runCcd }, m, [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([HIB(ID)]);
  });

  it('happy path: one declared stop of the worker, on the serialiser, and one feed row naming its run', async () => {
    const f = fake([ID]);
    const out = await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'hibernated', runId: 10 }]);
    expect(f.argv).toEqual([HIB(ID)]);
    expect(f.serialCalls).toBe(1);
    expect(f.feed).toEqual([{ sessionId: ID, runId: 10 }]);
  });

  it('the kill switch: with stop-done-disabled listed, nothing is read and nothing is stopped', async () => {
    const f = fake([ID]);
    const live = vi.fn(f.deps.liveWord);
    const out = await stopDonePass({ ...f.deps, liveWord: live }, mem(), [row(ID)], [rec(ID)], [STOP_DONE_DISABLED_MARKER]);
    expect(out).toEqual([]);
    expect(f.argv).toEqual([]);
    expect(live).not.toHaveBeenCalled();
  });

  it('the fleet\'s one cleanup switch: with reclaim-paused listed, nothing is stopped', async () => {
    const f = fake([ID]);
    expect(await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], [RECLAIM_PAUSE_MARKER])).toEqual([]);
    expect(f.argv).toEqual([]);
  });

  it('without the coordination serialiser handed over, it stops nothing', async () => {
    const f = fake([ID], { serial: false });
    expect(await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], [])).toEqual([]);
    expect(f.argv).toEqual([]);
  });

  it('the operator\'s own session (no child marker) is never stopped, and is not even measured', async () => {
    const f = fake([ID]);
    const live = vi.fn(f.deps.liveWord);
    await stopDonePass({ ...f.deps, liveWord: live }, mem(), [row(ID, { child: { kind: 'none' } })], [rec(ID)], []);
    expect(f.argv).toEqual([]);
    expect(live).not.toHaveBeenCalled();
  });

  it('a busy worker is not stopped', async () => {
    const f = fake([ID]);
    await stopDonePass({ ...f.deps, turnVerdict: async () => 'busy' }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker that another open run names is not stopped (the coordinator re-dispatched it)', async () => {
    const f = fake([ID]);
    f.openWorkers.add(ID);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker holding a live claim is not stopped', async () => {
    const f = fake([ID]);
    const coord = { ...f.deps.coord, activeClaims: () => [{ heldBy: ID }] } as unknown as StopDoneSweepDeps['coord'];
    await stopDonePass({ ...f.deps, coord }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker that claims an open run (it coordinates) is not stopped', async () => {
    const f = fake([ID]);
    const base = f.deps.coord.lastRunBySession;
    const coord = { ...f.deps.coord, lastRunBySession: (ids: readonly string[]) => {
      const r = base(ids); return r.ok ? { ...r, openClaimants: [ID] } : r;
    } } as unknown as StopDoneSweepDeps['coord'];
    await stopDonePass({ ...f.deps, coord }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a store read that throws holds every candidate', async () => {
    const f = fake([ID]);
    const coord = { ...f.deps.coord, lastRunBySession: () => { throw new Error('database is locked'); } } as unknown as StopDoneSweepDeps['coord'];
    await stopDonePass({ ...f.deps, coord }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker with outstanding mail is not stopped', async () => {
    const f = fake([ID]);
    f.mailTo.add(ID);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker somebody has on screen is not stopped', async () => {
    const f = fake([ID]);
    await stopDonePass({ ...f.deps, presence: { isOpen: (id) => id === ID } }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('D-5242\'s presence contract: an open screen in a hidden tab holds the worker as it holds a sleeping session', async () => {
    const f = fake([ID]);
    const presence = new Presence(() => NOW);
    const tok = Symbol('fixture');
    presence.markOpen(tok, ID);
    presence.setVisible(tok, null);
    expect(presence.isVisible(ID)).toBe(false);
    await stopDonePass({ ...f.deps, presence }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('straight after a server start nothing is stopped: presence has not been re-established', async () => {
    const f = fake([ID]);
    await stopDonePass({ ...f.deps, startedAt: NOW - 1000 }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('the post-start hold lasts PRESENCE_OPEN_TTL_MS (D-5242): past the visible TTL it still holds, past the open one it stops', async () => {
    const f = fake([ID]);
    await stopDonePass({ ...f.deps, startedAt: NOW - PRESENCE_TTL_MS - 1 }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
    await stopDonePass({ ...f.deps, startedAt: NOW - PRESENCE_OPEN_TTL_MS }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([HIB(ID)]);
  });

  it('a box whose ccd caps do not list hibernate is not touched (no-verb, D-5427)', async () => {
    const f = fake([ID], { verb: false });
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('AT THE ACT the store is read again: a run opened onto the worker inside the serialiser holds it', async () => {
    const f = fake([ID]);
    const serial: StopDoneSweepDeps['serial'] = async (fn) => { f.openWorkers.add(ID); return fn(); };
    const out = await stopDonePass({ ...f.deps, serial }, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason: 'run-worker' } }]);
    expect(f.argv).toEqual([]);
  });

  it('AT THE ACT the live state is read again: a turn that started holds it', async () => {
    const f = fake([ID]);
    let calls = 0;
    const turnVerdict: StopDoneSweepDeps['turnVerdict'] = async () => (++calls === 1 ? 'idle' : 'busy');
    const out = await stopDonePass({ ...f.deps, turnVerdict }, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason: 'turn' } }]);
    expect(f.argv).toEqual([]);
  });

  it(`at most ${STOP_DONE_PER_PASS} stops a pass, fleet-wide; the next pass takes the rest`, async () => {
    const ids = ['project-a-a', 'project-a-b', 'project-a-c', 'project-a-d', 'project-a-e'];
    const f = fake(ids);
    const m = mem();
    await stopDonePass(f.deps, m, ids.map((i) => row(i)), ids.map(rec), []);
    expect(f.argv.map((a) => a[1])).toEqual(['project-a-a', 'project-a-b', 'project-a-c']);
    const stopped = new Set(f.argv.map((a) => a[1]));
    await stopDonePass(f.deps, m, ids.map((i) => row(i, stopped.has(i) ? { stoppedBy: { at: NOW, surface: 'agent' } } : {})), ids.map(rec), []);
    expect(f.argv.map((a) => a[1])).toEqual(['project-a-a', 'project-a-b', 'project-a-c', 'project-a-d', 'project-a-e']);
  });

  it('idempotent: a row that already carries its stop stamp is not stopped again', async () => {
    const f = fake([ID]);
    await stopDonePass(f.deps, mem(), [row(ID, { stoppedBy: { at: NOW, surface: 'agent' } })], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a stop the box refused is not asked again for the retry interval, and no feed row is written', async () => {
    const f = fake([ID]);
    f.ccdOk = false;
    const m = mem();
    expect((await stopDonePass(f.deps, m, [row(ID)], [rec(ID)], []))[0]?.kind).toBe('failed');
    expect(f.feed).toEqual([]);
    await stopDonePass(f.deps, m, [row(ID)], [rec(ID)], []);
    expect(f.argv.length).toBe(1);
    f.ccdOk = true;
    await stopDonePass({ ...f.deps, now: () => NOW + STOP_DONE_RETRY_MS }, m, [row(ID)], [rec(ID)], []);
    expect(f.argv.length).toBe(2);
  });

  it('a stale hookstate (row background null) whose turn marker lists a background shell is not stopped', async () => {
    const f = fake([ID]);
    const out = await stopDonePass({ ...f.deps, mark: async () => ({ ...MARK_IDLE, bg: 1 }) }, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([]);
    expect(f.argv).toEqual([]);
  });

  it('a turn marker that cannot be read holds (marker), never a stop', async () => {
    const f = fake([ID]);
    await stopDonePass({ ...f.deps, mark: async () => ({ ok: false, reason: 'unmeasured' }) }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('AT THE ACT the registry record is read again: a hold written in the window holds it', async () => {
    const f = fake([ID]);
    f.atAct.set(ID, { held: 'wave 4 next' });
    const out = await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason: 'held' } }]);
    expect(f.argv).toEqual([]);
  });

  it('AT THE ACT a record that cannot be re-read holds as unmeasured', async () => {
    const f = fake([ID]);
    f.atAct.set(ID, 'unreadable');
    const out = await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason: 'unmeasured' } }]);
    expect(f.argv).toEqual([]);
  });

  it('a reviewer whose reviewed run is still open is not stopped (reviewing)', async () => {
    const f = fake([ID]);
    f.reviewsOpen.add(ID);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('within the grace after the run closed, the worker is left alone', async () => {
    const f = fake([ID]);
    f.runs.set(ID, { runId: 10, state: 'done', closedAt: NOW - 60_000 });
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });
});

describe('wired by buildServer (D-5370)', () => {
  it('the watcher is handed the coordination serialiser, and the lane\'s act runs through it', async () => {
    const home = mkTmp('ccrc-stop-done-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps = { ...testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' })), cfg, coord };
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    const before = (w as unknown as { stopDoneSerial: unknown }).stopDoneSerial;
    const app = await buildServer({ ...deps, mailToken: 'f'.repeat(64) } as never, new Bus(), w);
    try {
      expect(before, 'nothing is handed before buildServer').toBeNull();
      const serial = (w as unknown as { stopDoneSerial: StopDoneSweepDeps['serial'] }).stopDoneSerial;
      expect(serial).not.toBeNull();
      expect(await serial!(async () => 42)).toBe(42);
    } finally {
      await app.close();
      coord.db.close();
    }
  });
});

describe('run by the watcher\'s tick (D-5370)', () => {
  it('the tick runs the lane on its assembled rows and listing, and never on the priming tick', async () => {
    const home = mkTmp('ccrc-stop-done-tick-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    try {
      const deps = { ...testDeps(home, async () => ({ code: 1, stdout: '', stderr: '' })), cfg, coord };
      const w = new FleetWatcher(deps as never, new Bus(), 10_000);
      const spy = vi.spyOn(w, 'sweepStopDone').mockResolvedValue(undefined);
      await w.tick();
      expect(spy, 'the priming tick judges nothing').not.toHaveBeenCalled();
      await w.tick();
      expect(spy).toHaveBeenCalledTimes(1);
      const [sessions, records, names] = spy.mock.calls[0]!;
      expect(Array.isArray(sessions) && Array.isArray(records) && Array.isArray(names)).toBe(true);
    } finally {
      coord.db.close();
    }
  });
});

// The pass's own suite stubs `mark` and `rowAtAct`; this one runs the REAL `sweepStopDone`, so the closures the watcher
// wires (`turnMarkFor` judged against the live process, the record re-read at the act) are what decides. A temp
// registry, a real coordination store, a pane whose pid and live file the fixture writes, and one runner that answers
// tmux and ccd, so a stop is one `stop` argv in its log.
describe('the watcher\'s own pass, its deps unmocked (D-5370)', () => {
  const WID = 'project-a-quiet-basin';
  const WUUID = `u-${WID}`;
  const WRAPPER = 'claude-a';
  const PANE = 4242;

  const harness = async () => {
    const home = mkTmp('ccrc-stop-done-real-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'p', title: 't', project: 'project-a', wave: 1, waveOf: 1, claimedBy: 'c' });
    if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
    coord.markDispatched(opened.id, WID, WID, `ws/${WID}`, false);
    for (const to of ['dispatched', 'working'] as const) {
      const a = coord.advance(opened.id, to, 'test');
      if (!a.ok) throw new Error(`fixture advance to ${to} refused: ${JSON.stringify(a)}`);
    }
    const closed = coord.closeRun({ runId: opened.id, finalState: 'done', causedBy: 'test', handoffCommit: null,
      program: 'p', viaClosing: true });
    if (!closed.ok) throw new Error(`fixture closeRun refused: ${JSON.stringify(closed)}`);
    coord.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(Date.now() - STOP_DONE_GRACE_MS - 60_000, opened.id);
    const fields: Record<string, string> = {
      wrapper: WRAPPER, project: 'project-a', workdir: `/w/${WID}`, uuid: WUUID, started: '1',
      workspace: WID, branch: `ws/${WID}`, base: 'origin/main', child: String(opened.id),
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${WID}.${k}`), v);
    const startedAt = Date.now() - 24 * 3_600_000;
    const sessions = path.join(home, `.${WRAPPER}`, 'sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, `${PANE}.json`), JSON.stringify({
      pid: PANE, sessionId: WUUID, status: 'idle', statusUpdatedAt: Date.now() - 20 * 60_000, startedAt }));
    const markAt = Date.now() - 7 * 3_600_000;
    const turnMark = (at: number): void => writeFileSync(path.join(reg, `${WID}.turn.json`), `${JSON.stringify({
      v: 1, sessionId: WUUID, state: 'done', event: 'Stop', at, turnAt: at - 60_000, stopAt: at,
      bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: 0 })}\n`);
    turnMark(markAt);
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PANE}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const deps = { ...testDeps(home, run), cfg, coord, fleetState: { ccdVerbs: ['hibernate'] } };
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    (w as unknown as { stopDoneStartedAt: number }).stopDoneStartedAt = startedAt;
    w.useStopDoneSerialiser({ serial: async (fn: () => Promise<unknown>) => fn() } as never);
    // The tick's rows and records, assembled now — before anything a case writes afterwards.
    const tick = async () => {
      const r = await readSessionRecord(deps.io, cfg, WID);
      if (!r.found) throw new Error('fixture record not found');
      const row = await liveRowFor(turnReadDeps(deps as never, w), r.record, WUUID);
      if (row === null) throw new Error('fixture row not assembled');
      return { rows: [row], records: [r.record] };
    };
    const stops = () => calls.filter((c) => c[0] === 'hibernate' || c[0] === 'stop');
    return { home, reg, coord, w, tick, stops, turnMark, startedAt };
  };

  it('control: an idle worker whose run is done, with a fresh `done` marker, is stopped', async () => {
    const h = await harness();
    try {
      const t = await h.tick();
      expect(t.rows[0]).toMatchObject({ held: null, bucket: 'idle', child: { kind: 'child' } });
      await h.w.sweepStopDone(t.rows, t.records, []);
      expect(h.stops()).toEqual([['hibernate', WID]]);
    } finally {
      h.coord.db.close();
    }
  });

  it('a `.hold` written after the tick\'s rows were assembled holds at the act: the record is re-read there', async () => {
    const h = await harness();
    try {
      const t = await h.tick();
      expect(t.rows[0]!.held).toBeNull();
      writeFileSync(path.join(h.reg, `${WID}.hold`), 'a program claimed it');
      await h.w.sweepStopDone(t.rows, t.records, []);
      expect(h.stops()).toEqual([]);
    } finally {
      h.coord.db.close();
    }
  });

  it('a `.turn.json` older than the live process holds `marker`: the background it would have vouched for is unknown', async () => {
    const h = await harness();
    try {
      h.turnMark(h.startedAt - 60_000);
      const t = await h.tick();
      await h.w.sweepStopDone(t.rows, t.records, []);
      expect(h.stops()).toEqual([]);
    } finally {
      h.coord.db.close();
    }
  });

  it('a live marker counting a background task holds: the real count reaches the verdict', async () => {
    const h = await harness();
    try {
      const at = Date.now() - 7 * 3_600_000;
      writeFileSync(path.join(h.reg, `${WID}.turn.json`), `${JSON.stringify({
        v: 1, sessionId: WUUID, state: 'done', event: 'Stop', at, turnAt: at - 60_000, stopAt: at,
        bg: 1, bgKinds: 'monitor', bgIds: 'b1', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: 0 })}\n`);
      const t = await h.tick();
      await h.w.sweepStopDone(t.rows, t.records, []);
      expect(h.stops()).toEqual([]);
    } finally {
      h.coord.db.close();
    }
  });
});
