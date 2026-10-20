import { describe, expect, it, vi } from 'vitest';
import { heldKindOf, stopDonePass, type StopDoneMemory, type StopDoneSweepDeps } from '../src/stopDoneSweep.js';
import { STOP_DONE_DISABLED_MARKER, STOP_DONE_GRACE_MS, STOP_DONE_PER_PASS, STOP_DONE_RETRY_MS } from '../src/stopDone.js';
import { PRESENCE_OPEN_TTL_MS, PRESENCE_TTL_MS, type FleetSession } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';
import type { FleetState } from '../src/fleetstate.js';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { buildServer } from '../src/server.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { CCD_CAPABILITY_TOKENS } from './ccdCapTokens.js';
import { Presence } from '../src/presence.js';
import { readSessionRecord } from '../src/registry.js';
import { liveRowFor, turnReadDeps } from '../src/turnverdict.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, HIBERNATE_HOLD_OK_CAP } from '../src/ccdargv.js';
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
  feed: { kind?: string; sessionId: string; runId: number | null; title?: string; body?: string }[];
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
  /** D-6091: sessions a newer `planned` run names (run 50): today it is their newest run and an open one. */
  planned: Set<string>;
  /** D-6091: run states `run(id)` answers (a hold's `run:` suffix); absent → `working`. 'unreadable' → `ok: false`. */
  runStates: Map<number, string>;
}

function fake(ids: readonly string[], o: { verb?: boolean; serial?: boolean; holdOk?: boolean } = {}): Fake {
  const f: Fake = {
    argv: [], feed: [], serialCalls: 0, runs: new Map(), openWorkers: new Set(), mailTo: new Set(), ccdOk: true,
    atAct: new Map(), reviewsOpen: new Set(), planned: new Set(), runStates: new Map(),
    deps: undefined as unknown as StopDoneSweepDeps,
  };
  ids.forEach((id, i) => f.runs.set(id, { runId: 10 + i, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1 }));
  let seq = 0;
  f.deps = {
    coord: {
      lastRunBySession: (asked: readonly string[]) => ({
        ok: true as const,
        last: asked.flatMap((sessionId) => {
          const r = f.planned.has(sessionId) ? { runId: 50, state: 'planned', closedAt: null } : f.runs.get(sessionId);
          return r === undefined ? [] : [{ sessionId, ...r, program: 'p', programTitle: null, claimedBy: 'lane-a-project-a' }];
        }),
        lastPlaced: asked.flatMap((sessionId) => {
          const r = f.runs.get(sessionId);
          return r === undefined ? [] : [{ sessionId, ...r, program: 'p', programTitle: null, claimedBy: 'lane-a-project-a' }];
        }),
        openWorkers: asked.filter((id) => f.openWorkers.has(id) || f.planned.has(id)),
        openPlacedWorkers: asked.filter((id) => f.openWorkers.has(id)),
        openClaimants: ['lane-a-project-a'],
      }),
      activeClaims: () => [],
      outstandingMailFor: (toId: string) => (f.mailTo.has(toId) ? [{}] : []) as never,
      recordFeedEvent: () => undefined,
      run: (runId: number) => {
        const st = f.runStates.get(runId);
        if (st === 'unreadable') return { ok: false as const, kind: 'run-unreadable' as const, detail: 'locked' };
        return { ok: true as const, run: (runId === 900 ? { reviews: 901 } : { id: runId, state: st ?? 'working', reviews: null }) as never };
      },
    },
    runCcd: async (a) => { f.argv.push([...a]); return { ok: f.ccdOk, stdout: '', stderr: f.ccdOk ? '' : 'refused', killed: false, signal: null }; },
    fleetState: {
      ccdVerbs: [...(o.verb === false ? ['stop-surface'] : ['hibernate']), ACTOR_FLAGS_CAP, ...(o.holdOk ? [HIBERNATE_HOLD_OK_CAP] : [])],
    } as unknown as FleetState,
    presence: { isOpen: () => false },
    notifyLog: {
      epoch: 'e',
      record: (e: { kind: string; sessionId: string; runId: number | null; title: string; body: string }) => {
        f.feed.push(e.kind === 'coord' ? { kind: e.kind, sessionId: e.sessionId, runId: e.runId, title: e.title, body: e.body }
          : { sessionId: e.sessionId, runId: e.runId });
        return { ...e, seq: ++seq, at: NOW };
      },
      flush: async () => undefined,
    } as unknown as StopDoneSweepDeps['notifyLog'],
    liveWord: async () => ({ ok: true, word: 'idle', since: null }),
    turnVerdict: async () => 'idle',
    mark: async () => MARK_IDLE,
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
/** The `Worker asleep` rows alone: a process's first pass also writes its mail-only count, zero included (D-6091). */
const sleepRows = (f: Fake) => f.feed.filter((e) => !('kind' in e));
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

  it('recent: a worker quiet less than the grace since its marker\'s last stamp is left awake (D-6091: not N)', async () => {
    const f = fake([ID]);
    const mark: StopDoneSweepDeps['mark'] = async () => ({ ...MARK_IDLE, turnAt: NOW - 5 * 60_000, stopAt: NOW - 5 * 60_000 });
    await stopDonePass({ ...f.deps, mark }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
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
    expect(sleepRows(f)).toEqual([]);
    await stopDonePass({ ...f.deps, runCcd }, m, [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([HIB(ID)]);
  });

  it('happy path: one declared stop of the worker, on the serialiser, and one feed row naming its run', async () => {
    const f = fake([ID]);
    const out = await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'hibernated', runId: 10 }]);
    expect(f.argv).toEqual([HIB(ID)]);
    expect(f.serialCalls).toBe(1);
    expect(sleepRows(f)).toEqual([{ sessionId: ID, runId: 10 }]);
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

  it('a worker whose only outstanding mail is PARKED is stopped (D-5838); a parked row beside an unparked one still holds', async () => {
    const f = fake([ID]);
    const mailOf = (rows: object[]) => ({ ...f.deps.coord, outstandingMailFor: () => rows as never });
    await stopDonePass({ ...f.deps, coord: mailOf([{ parkedAt: NOW }, { parkedAt: null }]) }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
    await stopDonePass({ ...f.deps, coord: mailOf([{ parkedAt: NOW }]) }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).not.toEqual([]);
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

  it('no presence port handed over reads as a viewer, as hibernation\'s own sweep does (fail closed)', async () => {
    const f = fake([ID]);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([HIB(ID)]);
    const g = fake([ID]);
    const out = await stopDonePass({ ...g.deps, presence: undefined }, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([]);
    expect(g.argv).toEqual([]);
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
    expect(sleepRows(f)).toEqual([]);
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

  it('within the grace after the run closed, the worker is left alone', async () => {
    const f = fake([ID]);
    f.runs.set(ID, { runId: 10, state: 'done', closedAt: NOW - 60_000 });
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });
});

// D-6091 (fleet capacity W1-1), the characterization: today's pass answers for the rows the behaviour commit flips.
describe('stopDonePass: run-close timing, before and after (D-6091)', () => {
  it('kept: a hold raised between pass and act holds (none at the pass, an operator hold at the act)', async () => {
    const f = fake([ID]);
    f.atAct.set(ID, { held: 'keep: debugging' });
    const out = await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason: 'held' } }]);
    expect(f.argv).toEqual([]);
  });
});

// D-6091, the new pass rows: what the lane does once the verdict's clock is the close.
describe('stopDonePass: finished workers sleep at run close (D-6091)', () => {
  const PROG = 'program:programme-a wave:3';
  const HIB_OK = (id: string, text: string): string[] =>
    ['hibernate', '--hold-ok', text, id, '--surface', 'agent', '--actor', 'sweep:stop-done'];

  it('a programme-held hibernate passes --hold-ok with the exact text', async () => {
    const f = fake([ID], { holdOk: true });
    f.atAct.set(ID, { held: PROG });   // the record re-read at the act still carries it
    const out = await stopDonePass(f.deps, mem(), [row(ID, { held: PROG })], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'hibernated', runId: 10 }]);
    expect(f.argv).toEqual([HIB_OK(ID, PROG)]);
  });

  it('a terminal run\'s hold passes --hold-ok; an open run\'s hold and an unreadable one hold', async () => {
    const held = 'program:programme-a wave:2 run:7';
    const f = fake([ID], { holdOk: true });
    f.runStates.set(7, 'done');
    f.atAct.set(ID, { held });
    await stopDonePass(f.deps, mem(), [row(ID, { held })], [rec(ID)], []);
    expect(f.argv).toEqual([HIB_OK(ID, held)]);
    for (const st of ['working', 'unreadable']) {
      const g = fake([ID], { holdOk: true });
      g.runStates.set(7, st);
      g.atAct.set(ID, { held });
      await stopDonePass(g.deps, mem(), [row(ID, { held })], [rec(ID)], []);
      expect(g.argv, st).toEqual([]);
    }
  });

  it('without the hibernate-hold-ok token a programme-held child is held', async () => {
    const f = fake([ID]);
    await stopDonePass(f.deps, mem(), [row(ID, { held: PROG })], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('an operator\'s own hold holds even with the token', async () => {
    const f = fake([ID], { holdOk: true });
    await stopDonePass(f.deps, mem(), [row(ID, { held: 'keep: debugging' })], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a hold raised between pass and act holds (a programme hold at the pass, an operator hold at the act)', async () => {
    const f = fake([ID], { holdOk: true });
    f.atAct.set(ID, { held: 'keep: debugging' });
    const out = await stopDonePass(f.deps, mem(), [row(ID, { held: PROG })], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason: 'held' } }]);
    expect(f.argv).toEqual([]);
  });

  it('a hold changed between pass and act is passed with the ACT\'s text, which ccd then re-reads', async () => {
    const f = fake([ID], { holdOk: true });
    f.atAct.set(ID, { held: 'program:programme-a wave:4' });
    await stopDonePass(f.deps, mem(), [row(ID, { held: PROG })], [rec(ID)], []);
    expect(f.argv).toEqual([HIB_OK(ID, 'program:programme-a wave:4')]);
  });

  it('a planned run naming the child does not hold sleep', async () => {
    const f = fake([ID]);
    f.planned.add(ID);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([HIB(ID)]);
  });

  it('a reviewer of an open run sleeps', async () => {
    const f = fake([ID]);
    f.reviewsOpen.add(ID);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([HIB(ID)]);
  });

  it('the lane reads no hibernate-after-hours: a worker 11 minutes quiet after close sleeps, the file unread', async () => {
    const f = fake([ID]);
    f.runs.set(ID, { runId: 10, state: 'done', closedAt: NOW - 11 * 60_000 });
    const mark: StopDoneSweepDeps['mark'] = async () => ({ ...MARK_IDLE, turnAt: NOW - 11 * 60_000, stopAt: NOW - 11 * 60_000 });
    const after = vi.fn(async () => '24');
    await stopDonePass({ ...f.deps, mark, readAfterHours: after } as StopDoneSweepDeps, mem(), [row(ID)], [rec(ID)],
      [HIBERNATE_AFTER_HOURS_FILE]);
    expect(f.argv).toEqual([HIB(ID)]);
    expect(after).not.toHaveBeenCalled();
  });

  it('HIBERNATE_HOLD_OK_CAP is a token ccd advertises (ccdCapTokens.ts)', () => {
    expect(CCD_CAPABILITY_TOKENS).toContain(HIBERNATE_HOLD_OK_CAP);
  });
});

// D-6091: the excluded row — the finished workers nothing but unread mail keeps awake, counted on the lane's feed.
describe('stopDonePass: the mail-only feed row (D-6091)', () => {
  const coordRows = (f: Fake) => f.feed.filter((e) => e.kind === 'coord');

  it('the excluded row carries the mail-only count, once per change', async () => {
    const f = fake([ID, 'project-a-other-basin']);
    f.mailTo.add(ID);
    f.mailTo.add('project-a-other-basin');
    const m = mem();
    const rows = [row(ID), row('project-a-other-basin')];
    const recs = [rec(ID), rec('project-a-other-basin')];
    await stopDonePass(f.deps, m, rows, recs, []);
    expect(coordRows(f).map((e) => e.title)).toEqual(['Workers kept awake by unread mail: 2']);
    expect(coordRows(f)[0]).toMatchObject({ sessionId: '', runId: null });
    await stopDonePass(f.deps, m, rows, recs, []);
    expect(coordRows(f), 'unchanged: no second row').toHaveLength(1);
    f.mailTo.delete(ID);
    await stopDonePass(f.deps, m, rows, recs, []);
    expect(coordRows(f).map((e) => e.title)).toEqual(['Workers kept awake by unread mail: 2', 'Workers kept awake by unread mail: 1']);
  });

  it('the first pass of a process writes its count, zero included; then only a change writes one', async () => {
    const f = fake([ID]);
    const m = mem();
    await stopDonePass(f.deps, m, [row(ID)], [rec(ID)], []);
    expect(coordRows(f).map((e) => e.title), 'a restart writes one row, so zero reads apart from never-ran')
      .toEqual(['Workers kept awake by unread mail: 0']);
    await stopDonePass(f.deps, m, [row(ID)], [rec(ID)], []);
    expect(coordRows(f), 'still zero: no second row').toHaveLength(1);
    const e = fake([]);
    await stopDonePass(e.deps, mem(), [], [], []);
    expect(coordRows(e).map((r) => r.title), 'an empty population writes its zero too')
      .toEqual(['Workers kept awake by unread mail: 0']);
    const g = fake([ID]);
    g.mailTo.add(ID);
    await stopDonePass(g.deps, m, [row(ID)], [rec(ID)], []);
    g.mailTo.delete(ID);
    await stopDonePass(g.deps, m, [row(ID)], [rec(ID)], []);
    expect(coordRows(g).map((e) => e.title)).toEqual(['Workers kept awake by unread mail: 1', 'Workers kept awake by unread mail: 0']);
  });

  it('mail beside another hold is not counted', async () => {
    const f = fake([ID]);
    f.mailTo.add(ID);
    f.openWorkers.add(ID);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(coordRows(f).map((e) => e.title)).toEqual(['Workers kept awake by unread mail: 0']);
  });

  it('the sleep row names the run\'s state', async () => {
    const f = fake([ID]);
    const bodies: string[] = [];
    const log = { ...f.deps.notifyLog!, record: (e: { kind: string; body: string }) => {
      if (e.kind === 'run') bodies.push(e.body);
      return { ...e, seq: 1, at: NOW };
    } };
    await stopDonePass({ ...f.deps, notifyLog: log as unknown as StopDoneSweepDeps['notifyLog'] }, mem(), [row(ID)], [rec(ID)], []);
    expect(bodies).toEqual([`${ID} was put to sleep: its run 10 is done and it sat idle. Mail, a re-dispatch or a restart wakes it.`]);
  });

  it('the feed archive keeps one writer site', () => {
    const src = readFileSync(path.join(__dirname, '..', 'src', 'stopDoneSweep.ts'), 'utf8');
    expect(src.match(/\.recordFeedEvent\(/g) ?? []).toHaveLength(1);
    expect(src.match(/\.record\(/g) ?? []).toHaveLength(1);
  });
});

// D-6091: the sweep classifies the row's `.hold` for the verdict. Every read it cannot make holds.
describe('heldKindOf: the row\'s hold, classified (D-6091)', () => {
  const coord = (states: Record<number, string | 'unreadable' | 'absent' | 'throws'>) => ({
    run: (id: number) => {
      const st = states[id];
      if (st === 'throws') throw new Error('locked');
      if (st === 'unreadable') return { ok: false as const, kind: 'run-unreadable' as const, detail: 'x' };
      if (st === undefined || st === 'absent') return { ok: true as const, run: null };
      return { ok: true as const, run: { state: st } };
    },
  }) as unknown as Pick<StopDoneSweepDeps['coord'], 'run'>;

  it('no hold, an operator text, the unreadable and empty placeholders, a programme hold', () => {
    const c = coord({});
    expect(heldKindOf(null, c)).toBe('none');
    expect(heldKindOf('keep: debugging', c)).toBe('operator');
    expect(heldKindOf('<hold file unreadable — treated as held>', c)).toBe('operator');
    expect(heldKindOf('', c)).toBe('operator');
    expect(heldKindOf('program:programme-a wave:3', c)).toBe('programme');
  });

  it('a run: suffix reads the run: done and failed are terminal, every other state open', () => {
    const c = coord({ 7: 'done', 8: 'failed', 9: 'working', 10: 'planned', 11: 'awaiting-review' });
    expect(heldKindOf('program:programme-a wave:2 run:7', c)).toBe('run-terminal');
    expect(heldKindOf('program:programme-a wave:2 run:8', c)).toBe('run-terminal');
    for (const id of [9, 10, 11]) expect(heldKindOf(`program:programme-a wave:2 run:${id}`, c)).toBe('run-live');
  });

  it('a run: suffix whose run cannot be read — refused, absent or throwing — is unreadable', () => {
    const c = coord({ 7: 'unreadable', 8: 'absent', 9: 'throws' });
    for (const id of [7, 8, 9]) expect(heldKindOf(`program:programme-a wave:2 run:${id}`, c)).toBe('unreadable');
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
    // buildServer always hands the watcher a Presence; an absent port reads as a viewer (fail closed).
    const deps = { ...testDeps(home, run), cfg, coord, fleetState: { ccdVerbs: ['hibernate'] }, presence: new Presence(() => Date.now()) };
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    (w as unknown as { stopDoneStartedAt: number }).stopDoneStartedAt = startedAt;
    w.useStopDoneSerialiser({ serial: async (fn: () => Promise<unknown>) => fn() } as never);
    // The tick's rows and records, assembled now — before anything a case writes afterwards.
    const tick = async () => {
      const r = await readSessionRecord(deps.io, cfg, WID);
      if (r.kind !== 'found') throw new Error('fixture record not found');
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
