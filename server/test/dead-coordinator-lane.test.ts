// THE DEAD-COORDINATOR LANE, wired (workspace lifecycle spec 2026-09-24 §5.4, wave 4). `dead-coordinator-policy` pins
// the L1 verdicts, `end-dead-coordinator` the executor and `sweep-close` the compare-and-set; what is only provable
// HERE is what the lane does over passes and time: SHADOW ends nothing however long a coordinator has been dead; the
// live file lets the act through only after the hour AND two crashed passes; the hour is durable across a restart, and
// the supervisor stamp only raises it; anything but a crash deletes it; the journal clause keeps a deliberately stopped
// coordinator, and a journal the lane cannot trust keeps every one; the breaker holds the whole lane while two die
// together, remembers them through a doubt, and trips on a fleet-wide one; shadow records every due coordinator;
// `reclaim-paused` stops everything; and the list reaches the coord frame. NOTHING here reaches a box: tmux and ccd are
// a scripted recorder, the registry is a fixture HOME's, the lifecycle mirror sweeps the fixture's own (empty) journal
// directory, and the serialiser is the real one only in the last case, built by `buildServer`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { closeRun } from '../src/coord/close.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { buildServer } from '../src/server.js';
import { stallNoticeCounts } from '../src/coord/stallsettings.js';
import { Tmux, type Runner } from '../src/exec.js';
import { DEAD_COORDINATOR_AFTER_MS, DEAD_COORDINATOR_LANE_LIVE_MARKER } from '../src/deadCoordinator.js';
import { NotifyLog } from '../src/notifylog.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;
const OLD_STAMP = String(T0 / 1000 - 7200);   // a supervisor heartbeat long gone: the row reads `orphan`
const A = 'demo-coord-a';
const B = 'demo-coord-b';
const HOUR = DEAD_COORDINATOR_AFTER_MS;

const fixture = async (opts: {
  server?: boolean;
  /** ccd's caps as the fleet state reports them (default: none reported — the mirror sweeps). */
  ccdVerbs?: string[];
  /** Called inside the serialiser, before the act — a revive that lands after the lane measured. */
  beforeAct?: () => void;
  /** The serialiser's act throws. */
  throwAct?: boolean;
  /** The n-th abandon of an act throws (1-based), after the earlier ones committed. */
  abandonThrowsAt?: number;
  /** Called as a ccd verb is composed (the fleet act) — a revive that lands mid-act. */
  onCcd?: (args: string[]) => void;
  /** Called as tmux is asked about a pane, before it answers — time passing, or a write landing, mid-pass. */
  onHasSession?: (id: string) => void;
  /** The breaker's typed state the database starts with (D-4857, D-4916): `sealed` (default) — a deployment whose last
   *  server stopped cleanly after the lane had run, nothing held, the only state a start trusts —, `clean` — the same
   *  after an UNCLEAN exit (a kill, a crash), which a start seeds conservatively —, or `absent`, a database no lane of
   *  this release has written (the deploy that creates it). */
  breakerState?: 'sealed' | 'clean' | 'absent';
} = {}) => {
  let clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-dead-coord-lane-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(path.join(reg, '.lifecycle'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  /** The panes tmux proves live; every other `has-session` answers tmux's one death message. */
  const live = new Set<string>();
  let tmuxDown = false;
  /** While set, every `has-session` waits on it — a pass held in flight. */
  let gate: Promise<void> | null = null;
  const tmuxAsked: string[] = [];
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    if (path.basename(cmd) === 'tmux') {
      if (args[0] !== 'has-session') return { code: 1, stdout: '', stderr: '' };
      const id = (args[2] ?? '').replace(/^=cc-/, '').replace(/:$/, '');
      tmuxAsked.push(id);
      opts.onHasSession?.(id);
      if (gate !== null) await gate;
      if (tmuxDown) return { code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/default' };
      return live.has(id) ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: `can't find session: cc-${id}` };
    }
    calls.push(args);
    opts.onCcd?.(args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = new CoordStore(openCoordDb(dbPath));
  // A deployment whose lane has run before and whose server last stopped cleanly: its breaker state reads SEALED, nothing
  // held (D-4857, D-4916). A fresh database has no row and its first pass is the conservative one (the `absent` cases), as
  // is a start over a `clean` one (an unclean exit). Seeded only where this build has the table, so the file measures
  // red-first against a parent that predates it; `coord-db.test.ts` pins that this build has it.
  if (opts.breakerState !== 'absent' && coord.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'dead_coordinator_breaker_state'").get() !== undefined) {
    coord.db.exec(`INSERT INTO dead_coordinator_breaker_state (id, generation, state, held, writtenAt) VALUES (1, 1, '${opts.breakerState ?? 'sealed'}', 'dead-coordinator-breaker-held:', ${T0})`);
  }
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home, run);
  const deps = { ...base, cfg, coord, notifyLog, tmux: new Tmux(run), presence: { isVisible: () => false },
    ...(opts.ccdVerbs === undefined ? {} : { fleetState: { ccdVerbs: opts.ccdVerbs } }) };
  let acts = 0;
  const newWatcher = (): FleetWatcher => {
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    // The sweep's abandon, as `routes.ts`'s `withSweepAbandon` runs it: the real `closeRun`, `'sweep'`, the crashed id
    // and the executor's re-measure. (The serialiser itself is `buildServer`'s, pinned in the last case.)
    if (opts.server !== true) {
      w.useCoordSerialiser({ withSweepAbandon: (c, fn) => {
        acts += 1;
        if (opts.throwAct === true) throw new Error('database or disk is full');
        opts.beforeAct?.();
        let abandons = 0;
        return fn((runId, crashedId, stillCrashed) => {
          abandons += 1;
          if (opts.abandonThrowsAt === abandons) throw new Error('database or disk is full');
          return closeRun({ coord: c, io: deps.io, cfg, runCcd: deps.runCcd }, runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed });
        });
      } });
    }
    return w;
  };
  let watcher = newWatcher();
  /** A coordinator's registry row: started, its supervisor heartbeat long gone — `orphan` unless `extra` says else. */
  const plant = (id: string, extra: Record<string, string> = {}): void => {
    for (const [f, v] of Object.entries({ uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      started: '1', supervised: OLD_STAMP, ...extra })) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  /** A working run of `program` claimed by `claimant`, dispatched into a fresh worker. */
  let workers = 0;
  const working = (claimant: string, program = `prog-${claimant}`): number => {
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: 2, claimedBy: claimant });
    if (!('id' in r)) throw new Error('openRun refused');
    const w = `demo-worker-${++workers}`;
    coord.markDispatched(r.id, w, w, `ws/${w}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(coord.advance(r.id, to, 'coordinator').ok).toBe(true);
    return r.id;
  };
  /** One lane pass, after the lifecycle mirror's own sweep (as the tick runs both) — unless `mirror: false`. */
  const pass = async (o: { mirror?: boolean } = {}): Promise<void> => {
    if (o.mirror !== false) await watcher.sweepLifecycle();
    await watcher.sweepDeadCoordinators(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; };
  const touch = (name: string): void => writeFileSync(path.join(reg, name), '');
  const stateOf = (id: number) => okRun(coord.run(id))!.state;
  const feed = () => coord.feedEvents(50).map((e) => [e.sessionId, e.title] as const);
  const anchorOf = (id: string) => { const a = coord.deadAnchors(); return a.ok ? a.anchors.get(id) ?? null : 'unreadable'; };
  /** A restart through a CLEAN SHUTDOWN (D-4916): the old process seals what it may, then a new process starts. */
  const restart = (): void => { watcher.sealDeadCoordinatorBreakerNow(); watcher = newWatcher(); };
  /** An UNCLEAN exit — a kill, an OOM kill, a crash, a stop that outlived the timeout: nothing is sealed. */
  const crash = (): void => { watcher = newWatcher(); };
  const journal = (id: string, act: string, over: Record<string, unknown> = {}): void => {
    coord.ingestJournal({ gen: '1790000000000000000', cursor: 1, size: 1, at: 1, rows: [parseJournalLine(JSON.stringify(
      { v: 1, uid: `w4lane.${id}.${act}.${clock}`, at: clock, act, outcome: 'done', id, dec: { surface: 'none' }, ...over }))] });
  };
  /** The attention list as the lane last built it, without a tick. */
  const attention = () => (watcher as unknown as { deadCoordinatorAttentionList: readonly { kind: string; claimants: string[]; sentence: string }[] })
    .deadCoordinatorAttentionList.map((a) => [a.kind, a.claimants] as const);
  return { home, reg, coord, deps, cfg, live, calls, tmuxAsked, plant, working, pass, next, touch, stateOf, feed, anchorOf,
    restart, crash, journal, attention, acts: () => acts, advance: (ms: number) => { clock += ms; },
    setTmuxDown: (v: boolean) => { tmuxDown = v; }, watcher: () => watcher,
    /** Hold every later `has-session` until the returned release is called. */
    holdTmux: (): (() => void) => { let release = (): void => {}; gate = new Promise<void>((r) => { release = r; }); return () => { gate = null; release(); }; } };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Make every prepared statement whose SQL matches `re` throw — a statement failure, or a crash at that statement, inside
 *  the store. Returns the restore. */
const failSql = (f: Fixture, re: RegExp, why = 'injected: disk I/O error'): (() => void) => {
  const db = f.coord.db;
  const real = db.prepare.bind(db);
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    if (re.test(sql)) throw new Error(why);
    return real(sql);
  });
  return () => spy.mockRestore();
};
/** The COMMIT itself throws (the transaction rolls back). Returns the restore. */
const failCommit = (f: Fixture): (() => void) => {
  const db = f.coord.db;
  const real = db.exec.bind(db);
  const spy = vi.spyOn(db, 'exec').mockImplementation((sql: string) => {
    if (sql === 'COMMIT') throw new Error('injected: disk I/O error at COMMIT');
    return real(sql);
  });
  return () => spy.mockRestore();
};
/** The breaker's durable record cannot be written: the `run_events` record throws (what the parent build wrote alone) and
 *  so does the typed state's snapshot (D-4857: the commit that carries it). Returns the restore. */
const failBreakerWrites = (f: Fixture, why = 'database or disk is full'): (() => void) => {
  const record = vi.spyOn(f.coord, 'recordDeadCoordinatorBreakerHeld').mockImplementation(() => { throw new Error(why); });
  const state = failSql(f, /^UPDATE dead_coordinator_breaker_state/, why);
  return () => { record.mockRestore(); state(); };
};
/** The breaker's record cannot be READ: a latest `run_events` record this build cannot parse (what the parent read) and,
 *  where this build has it, a typed state whose snapshot cannot be read (D-4857). */
const plantBadRecord = (f: Fixture, runId: number, id: string = A): void => {
  f.coord.db.exec(`INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) SELECT runId, at, state, state, 'operator', ` +
    `'dead-coordinator-breaker-held:${id}@soon' FROM (SELECT ${runId} AS runId, ${T0} AS at, state FROM runs WHERE id = ${runId})`);
  if (f.coord.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'dead_coordinator_breaker_state'").get() !== undefined) {
    f.coord.db.exec(`UPDATE dead_coordinator_breaker_state SET held = 'dead-coordinator-breaker-held:${id}@soon' WHERE id = 1`);
  }
};

/** Passes across `ms`, nine minutes apart — every gap inside the episode bound, as a live lane's minute passes are. */
const walk = async (f: Fixture, ms: number, o: { mirror?: boolean } = {}): Promise<void> => {
  for (let done = 0; done < ms; done += 9 * 60_000) { f.advance(Math.min(9 * 60_000, ms - done)); await f.pass(o); }
};
/** The first crashed pass, then passes across the hour: due at the last. */
const anHourDead = async (f: Fixture, o: { mirror?: boolean } = {}): Promise<void> => {
  await f.pass(o); await walk(f, HOUR, o);
};

describe('the lane SHIPS SHADOWED', () => {
  it('without the live file a crashed coordinator is RECORDED, once — and no run is ever closed, however long', async () => {
    const f = await fixture();
    f.plant(A);
    const r1 = f.working(A, 'alpha');
    const r2 = f.working(A, 'alpha');
    await anHourDead(f);
    for (let k = 0; k < 10; k += 1) { f.next(); await f.pass(); }
    expect([r1, r2].map(f.stateOf)).toEqual(['working', 'working']);
    expect(f.calls, 'nothing composed on the box').toEqual([]);
    expect(f.feed().filter(([, t]) => t === 'dead coordinator: programme would be ended')).toEqual([[A, 'dead coordinator: programme would be ended']]);
    await f.watcher().tick();
    const list = f.watcher().currentCoord()?.deadCoordinatorAttention ?? [];
    expect(list.map((a) => [a.kind, a.claimants])).toEqual([['would-end', [A]]]);
    expect(list[0]!.sentence).toContain('armed, it would end programme alpha (2 runs)');
    expect(f.watcher().currentCoord()?.expiryAttention, 'never the expiry lane’s list').toEqual([]);
  });

  it('a coordinator that crashes, is revived and crashes again is recorded TWICE in shadow — one row per episode (review 339, F2)', async () => {
    const f = await fixture();
    f.plant(A);
    f.working(A, 'alpha');
    await anHourDead(f);
    const rows = () => f.feed().filter(([, t]) => t === 'dead coordinator: programme would be ended');
    expect(rows(), 'the first episode').toHaveLength(1);
    f.live.add(A);
    f.next(); await f.pass();                      // revived: the episode ends, and its anchor with it
    expect(f.anchorOf(A)).toBeNull();
    f.live.delete(A);                              // and it crashes again
    f.next(); await anHourDead(f);
    expect(rows(), 'the second episode is the operator’s arming evidence too').toHaveLength(2);
  });

  it('with the live file, the programme is ENDED after the hour and two crashed passes — failed, by the sweep, one row per programme', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r1 = f.working(A, 'alpha');
    const r2 = f.working(A, 'beta');
    await f.pass(); await walk(f, HOUR - 60_000);
    expect([r1, r2].map(f.stateOf), 'not before the hour').toEqual(['working', 'working']);
    f.next(); await f.pass();
    expect([r1, r2].map(f.stateOf)).toEqual(['failed', 'failed']);
    expect(f.coord.runEvents(r1).at(-1)?.causedBy).toBe('sweep');
    expect(f.feed().filter(([, t]) => t === 'dead coordinator: programme ended')).toHaveLength(2);
    expect(f.anchorOf(A), 'its runs closed, it left the population — and its anchor with it on the next pass').not.toBeNull();
    f.next(); await f.pass();
    expect(f.anchorOf(A)).toBeNull();
  });

  it('at most ONE claimant is acted on per pass, the longest dead first', async () => {
    const f = await fixture();
    f.plant(A);
    const ra = f.working(A);
    await f.pass(); await walk(f, 15 * 60_000);   // A has been dead a quarter of an hour when B dies: no breaker
    f.plant(B);
    const rb = f.working(B);
    await walk(f, HOUR + 10 * 60_000);             // shadowed: both are due now, and both are only recorded
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    expect(f.attention().map(([k, ids]) => [k, ids[0]]).sort(), 'shadow records EVERY due coordinator, not only the longest dead')
      .toEqual([['would-end', A], ['would-end', B]]);
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.next(); await f.pass();
    expect([ra, rb].map(f.stateOf), 'one a pass: A, dead the longest').toEqual(['failed', 'working']);
    f.next(); await f.pass();
    expect([ra, rb].map(f.stateOf)).toEqual(['failed', 'failed']);
  });

  it('SHADOW records every due coordinator, each once — the list the operator arms on hides none of them', async () => {
    const f = await fixture();
    f.plant(A);
    f.working(A, 'alpha');
    await f.pass(); await walk(f, 15 * 60_000);
    f.plant(B);
    f.working(B, 'beta');
    await walk(f, 2 * HOUR);
    const rows = f.feed().filter(([, t]) => t === 'dead coordinator: programme would be ended');
    expect(rows.map(([id]) => id).sort()).toEqual([A, B]);
    expect(f.attention().map(([k, ids]) => [k, ids[0]]).sort()).toEqual([['would-end', A], ['would-end', B]]);
    expect(f.calls).toEqual([]);
  });

  it('it never pushes — the stall watch’s r3 is the one push about a dead coordinator', async () => {
    const pushed = vi.spyOn(FleetWatcher.prototype as unknown as { pushOne: () => void }, 'pushOne');
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    f.working(A);
    await anHourDead(f);
    expect(pushed).not.toHaveBeenCalled();
  });
});

describe('the hour, made durable', () => {
  it('a single crashed pass is never enough, even an hour after a durable anchor — a restart needs two fresh passes', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    expect(f.anchorOf(A)).toMatchObject({ firstDeadAt: T0 });
    expect(f.stateOf(r)).toBe('working');
    f.restart();
    f.advance(2 * 60_000); await f.pass();
    expect(f.stateOf(r), 'an hour past the durable anchor, but this process has seen one pass').toBe('working');
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the second pass: the hour counted from the durable anchor, not from the restart').toBe('failed');
  });

  it('a pass gap longer than the episode bound restarts the hour — a server down, or an older build running', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass();
    f.advance(2 * HOUR); await f.pass();
    expect(f.anchorOf(A), 'nothing measured it for two hours: a new episode').toMatchObject({ firstDeadAt: T0 + 2 * HOUR });
    f.next(); await f.pass();
    expect(f.stateOf(r)).toBe('working');
  });

  it('the supervisor stamp RAISES the anchor: a heartbeat after the first crashed pass starts a new episode, and the hour counts from the pass that sees it (D-4825)', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, 27 * 60_000);
    writeFileSync(path.join(f.reg, `${A}.supervised`), String(Math.floor((T0 + 20 * 60_000) / 1000)));
    await walk(f, 36 * 60_000);
    expect(f.stateOf(r), 'an hour since firstDeadAt, but not since the stamp').toBe('working');
    await walk(f, 18 * 60_000);
    expect(f.stateOf(r), 'nor an hour since the fresh anchor, taken at the pass that saw the later stamp (minute 36)').toBe('working');
    await walk(f, 27 * 60_000);
    expect(f.stateOf(r)).toBe('failed');
  });
});

describe('the act’s own re-measure', () => {
  it('a revive the act sees inside the serialiser deletes the anchor and the run of passes — a later crash needs a fresh hour', async () => {
    let revive = false;
    const f: Fixture = await fixture({ beforeAct: () => { if (revive) f.live.add(A); } });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    revive = true;
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the act re-measured it alive and stopped').toBe('working');
    expect(f.anchorOf(A), 'evidence: the anchor goes').toBeNull();
    revive = false;
    f.live.delete(A);                                  // and it crashed again
    for (let k = 0; k < 4; k += 1) { f.next(); await f.pass(); }
    expect(f.stateOf(r), 'a fresh hour, not the pre-revive one').toBe('working');
    expect(f.anchorOf(A), 'the episode restarted at the first crashed pass after the revive')
      .toMatchObject({ firstDeadAt: T0 + HOUR - 60_000 + 2 * (CHILD_RECLAIM_SWEEP_MS + 1) });
  });

  it('the act\'s re-measured delete is STAGED (D-4857; review 401, F6; D-4916): a commit that fails on it leaves the anchor standing and the delete pending, and a crash then starts a fresh anchor', async () => {
    let revive = false;
    let restore: (() => void) | null = null;
    const f: Fixture = await fixture({ beforeAct: () => {
      if (!revive) return;
      f.live.add(A);                                    // the revive the act sees inside the serialiser...
      restore = failSql(f, /^UPDATE dead_coordinator_breaker_state SET generation/);   // ...and the commit that carries its delete fails
    } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    revive = true;
    f.next(); await f.pass();
    (restore as (() => void) | null)?.();
    revive = false;
    expect(f.stateOf(r), 'the act re-measured it alive and stopped').toBe('working');
    expect(f.anchorOf(A), 'the delete did not land: the anchor STANDS').not.toBeNull();
    const pending = (f.watcher() as unknown as { deadCoordinatorAnchorsPending: Map<string, unknown> }).deadCoordinatorAnchorsPending;
    expect(pending.has(A) && pending.get(A), 'and the delete is still PENDING').toBeNull();
    expect(pending.has(A)).toBe(true);
    expect(f.coord.deadCoordinatorBreakerState(), 'the commit failed: dirty').toMatchObject({ kind: 'dirty' });
    f.live.delete(A);                                   // it crashed again: the pending delete is laid over the standing anchor
    f.next(); await f.pass();
    expect(f.anchorOf(A), 'a FRESH anchor, not the pre-revive one').toMatchObject({ firstDeadAt: T0 + HOUR - 60_000 + 2 * (CHILD_RECLAIM_SWEEP_MS + 1) });
    expect(f.coord.deadCoordinatorBreakerState()).toMatchObject({ kind: 'clean' });
  });

  it('a mirror that goes STALE between the pass and the act stops it as a hold: the anchor and the run of passes stand (review 339, F4)', async () => {
    let slow = false;
    const f: Fixture = await fixture({ beforeAct: () => { if (slow) f.advance(20_000); } });   // three sweep intervals and more
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    const anchor = f.anchorOf(A);
    slow = true;
    f.next(); await f.pass();
    slow = false;
    expect(f.acts(), 'the act was asked').toBe(1);
    expect(f.stateOf(r), 'nothing ended').toBe('working');
    expect(f.calls, 'nothing composed').toEqual([]);
    expect(f.anchorOf(A), 'a slow mirror never deletes an anchor').toMatchObject({ firstDeadAt: (anchor as { firstDeadAt: number }).firstDeadAt });
    expect(f.watcher().currentDeadCoordinators().get(A)?.crashedPasses, 'nor the run of passes').toBeGreaterThanOrEqual(2);
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the mirror is fresh again: the hour it kept is due on the next pass').toBe('failed');
  });

  it('a mirror that goes STALE DURING the claimant’s measure stops the act as a hold: the anchor and the run of passes stand (wave 6; review 355, F7)', async () => {
    let armed = false;
    let inAct = false;
    const f: Fixture = await fixture({ beforeAct: () => { inAct = armed; },
      onHasSession: () => { if (inAct) { inAct = false; f.advance(20_000); } } });   // three sweep intervals and more
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    const anchor = f.anchorOf(A);
    armed = true;
    f.next(); await f.pass();
    armed = false;
    expect(f.acts(), 'the act was asked').toBe(1);
    expect(f.stateOf(r), 'nothing ended').toBe('working');
    expect(f.calls, 'nothing composed').toEqual([]);
    expect(f.anchorOf(A), 'a slow mirror never deletes an anchor').toMatchObject({ firstDeadAt: (anchor as { firstDeadAt: number }).firstDeadAt });
    expect(f.watcher().currentDeadCoordinators().get(A)?.crashedPasses, 'nor the run of passes').toBeGreaterThanOrEqual(2);
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the mirror is fresh again: the hour it kept is due on the next pass').toBe('failed');
  });

  it('a gap the mirror records DURING the claimant’s measure is read before the commit: nothing ends (wave 6; review 355, F7)', async () => {
    let armed = false;
    let inAct = false;
    const f: Fixture = await fixture({ beforeAct: () => { inAct = armed; }, onHasSession: () => {
      if (inAct) { inAct = false; f.coord.recordGap({ at: T0, gen: '1790000000000000000', reason: 'shrank', detail: 'd', lostFrom: 0, lostTo: 9 }); }
    } });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    f.journal(A, 'spawn', { meas: { rc: '0' } });
    await f.pass(); await walk(f, HOUR - 60_000);
    armed = true;
    f.next(); await f.pass();
    expect(f.acts(), 'the act was asked').toBe(1);
    expect(f.stateOf(r), 'a gap since its last start may hide a deliberate act: nothing ends').toBe('working');
    expect(f.calls, 'nothing composed').toEqual([]);
  });

  it('a HOLD met at the re-measure AFTER the fleet act: the released worker is recorded, the run stays open, the anchor stands — and the next pass ends it (wave 6; wave 5 Task 6’s residual)', async () => {
    let armed = false;
    const f: Fixture = await fixture({ onCcd: (args) => { if (armed && args[0] === 'ws-release') { armed = false; f.advance(20_000); } } });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A, 'alpha');
    await f.pass(); await walk(f, HOUR - 60_000);
    const anchor = f.anchorOf(A);
    armed = true;
    f.next(); await f.pass();
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'its worker WAS released').toHaveLength(1);
    expect(f.stateOf(r), 'the mirror went stale before the commit: the run stays open').toBe('working');
    expect(f.feed().filter(([, t]) => t.startsWith('dead coordinator: programme'))).toEqual([[A, 'dead coordinator: programme partly ended']]);
    const note = (f.watcher() as unknown as { deadCoordinatorAttentionList: readonly { kind: string; sentence: string }[] }).deadCoordinatorAttentionList;
    expect(note.map((a) => a.kind)).toEqual(['stuck']);
    expect(note[0]!.sentence).toContain(`released the worker of run ${r} of programme alpha`);
    expect(f.anchorOf(A), 'a hold is no evidence: the anchor stands').toMatchObject({ firstDeadAt: (anchor as { firstDeadAt: number }).firstDeadAt });
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the mirror is fresh again: the next pass ends it').toBe('failed');
  });

  it('a revive that lands AFTER the worker was released is recorded: a feed row and an attention entry, though no run was closed', async () => {
    const f: Fixture = await fixture({ onCcd: (args) => { if (args[0] === 'ws-release') f.live.add(A); } });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A, 'alpha');
    await f.pass(); await walk(f, HOUR - 60_000);
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the run stays open under the coordinator that came back').toBe('working');
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'its worker WAS released').toHaveLength(1);
    expect(f.feed().filter(([, t]) => t.startsWith('dead coordinator: programme'))).toEqual([[A, 'dead coordinator: programme partly ended']]);
    const note = (f.watcher() as unknown as { deadCoordinatorAttentionList: readonly { kind: string; sentence: string }[] }).deadCoordinatorAttentionList;
    expect(note.map((a) => a.kind)).toEqual(['stuck']);
    expect(note[0]!.sentence).toContain('the programme is NOT ended');
    expect(note[0]!.sentence).toContain(`released the worker of run ${r} of programme alpha`);
    expect(f.anchorOf(A), 'evidence it came back: the anchor goes').toBeNull();
  });

  it('the act re-measures at ITS OWN instant: a heartbeat stamped after the pass measured is a restarting coordinator — nothing ends (review 339, F1)', async () => {
    let beat = false;
    const f: Fixture = await fixture({ beforeAct: () => {
      if (!beat) return;
      // The pass measured A crashed at its own instant. Three seconds later, inside the serialiser and before the act's
      // first re-measure, A's supervisor beats: a stamp AFTER the pass's instant and not after the act's.
      f.advance(3000);
      writeFileSync(path.join(f.reg, `${A}.supervised`), String(Math.floor(Date.now() / 1000)));
    } });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    beat = true;
    f.next(); await f.pass();
    expect(f.acts(), 'the act was asked').toBe(1);
    expect(f.stateOf(r), 'restarting is no crash: the run stays open').toBe('working');
    expect(f.calls, 'nothing composed on the box').toEqual([]);
    expect(f.anchorOf(A), 're-measured restarting — evidence: the anchor goes').toBeNull();
  });

  it('an act that THROWS after closing a programme keeps that programme’s feed row, and the attention entry says what closed', async () => {
    const f = await fixture({ abandonThrowsAt: 2 });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r1 = f.working(A, 'alpha');
    const r2 = f.working(A, 'beta');
    await f.pass(); await walk(f, HOUR - 60_000);
    f.next(); await f.pass();
    expect([r1, r2].map(f.stateOf)).toEqual(['failed', 'working']);
    expect(f.feed().filter(([, t]) => t.startsWith('dead coordinator: programme'))).toEqual([[A, 'dead coordinator: programme ended']]);
    const note = (f.watcher() as unknown as { deadCoordinatorAttentionList: readonly { kind: string; sentence: string }[] }).deadCoordinatorAttentionList;
    expect(note.map((a) => a.kind)).toEqual(['stuck']);
    expect(note[0]!.sentence).toContain('failed (database or disk is full)');
    expect(note[0]!.sentence).toContain('closed failed 1 run of programme alpha');
  });

  it('an act that RELEASED a worker and then THREW, closing nothing, is recorded — a feed row, not only memory (review 339, F13)', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A, 'alpha');
    // The commit throws AFTER the fleet act ran: the release happened, the close did not.
    f.coord.closeRun = () => { throw new Error('database or disk is full'); };
    await anHourDead(f);
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'the CONTROL: the fleet act ran').toHaveLength(1);
    expect(f.stateOf(r)).toBe('working');
    const rows = f.coord.feedEvents(50).filter((e) => e.title === 'dead coordinator: act failed');
    expect(rows.map((e) => e.sessionId), 'one row, in the coordination store — not only in the watcher memory a restart drops').toEqual([A]);
    expect(rows[0]!.body).toContain(`before it closed any run; run ${r}'s abandon is the one that failed`);
  });

  it('an act that THROWS is asked again only after the backoff, and listed', async () => {
    const f = await fixture({ throwAct: true });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    f.working(A);
    await anHourDead(f);
    const counts = [f.acts()];
    for (let k = 0; k < 2; k += 1) { f.next(); await f.pass(); counts.push(f.acts()); }
    expect(counts, 'once, then not on the next pass, then again after two minutes').toEqual([1, 1, 2]);
    expect(f.feed().filter(([, t]) => t === 'dead coordinator: act failed'), 'each thrown act is one row').toHaveLength(2);
    expect(f.attention()).toEqual([['stuck', [A]]]);
  });
});

describe('a crash, and only a crash', () => {
  it('a live pane, a supervisor bringing it back, and a tmux that did not answer each DELETE the anchor', async () => {
    for (const how of ['live', 'restarting', 'unmeasurable'] as const) {
      const f = await fixture();
      f.plant(A);
      f.working(A);
      await f.pass();
      expect(f.anchorOf(A), how).not.toBeNull();
      if (how === 'live') f.live.add(A);
      if (how === 'restarting') writeFileSync(path.join(f.reg, `${A}.supervised`), String(Math.floor((T0 + CHILD_RECLAIM_SWEEP_MS) / 1000)));
      if (how === 'unmeasurable') f.setTmuxDown(true);
      f.next(); await f.pass();
      expect(f.anchorOf(A), how).toBeNull();
    }
  });

  it('a coordinator the operator STOPPED is never ended, nor one whose stop was followed by a failed revive', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A, { stopped: `${T0 / 1000} pwa` });
    f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    // B: a successful spawn, a stop from the PWA, then a revive that FAILED — ensure journaled, spawn rc 1.
    f.journal(B, 'spawn', { meas: { rc: '0' } });
    f.journal(B, 'stop', { dec: { surface: 'pwa' } });
    f.journal(B, 'ensure');
    f.journal(B, 'spawn', { meas: { rc: '1' } });
    for (let k = 0; k < 3; k += 1) { await anHourDead(f); f.next(); }
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    expect([f.anchorOf(A), f.anchorOf(B)]).toEqual([null, null]);
  });

  it('a journal the lane cannot TRUST keeps every coordinator: a read that throws, ccd that does not journal, a gap since its start', async () => {
    for (const how of ['throws', 'unavailable', 'gap'] as const) {
      const f = await fixture(how === 'unavailable' ? { ccdVerbs: ['ws-release'] } : {});
      f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
      f.plant(A);
      const r = f.working(A);
      f.journal(A, 'spawn', { meas: { rc: '0' } });
      if (how === 'throws') f.coord.deadCoordinatorJournalRows = () => { throw new Error('database disk image is malformed'); };
      if (how === 'gap') f.coord.recordGap({ at: T0, gen: '1790000000000000000', reason: 'shrank', detail: 'd', lostFrom: 0, lostTo: 9 });
      await anHourDead(f);
      expect(f.stateOf(r), how).toBe('working');
      expect(f.anchorOf(A), how).toBeNull();
      expect(f.attention(), how).toEqual([['unmeasured', [A]]]);
    }
  });

  it('a mirror not swept since the restart, or gone stale, DECIDES NOTHING — no anchor written or deleted, nothing listed', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass();
    expect(f.anchorOf(A)).not.toBeNull();
    const kept = f.anchorOf(A);
    f.restart();                                       // a new process: its mirror has not swept yet
    await walk(f, 5 * 60_000, { mirror: false });
    expect(f.anchorOf(A), 'the durable anchor stands').toEqual(kept);
    await anHourDead(f, { mirror: false });
    expect(f.stateOf(r)).toBe('working');
  });

  it('an ABSENT row the mirror knows nothing about is listed, never acted on', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(B);                        // the registry lists cleanly — somebody is in it
    const r = f.working(A);            // A has no row at all, and no journal history
    await anHourDead(f);
    expect(f.stateOf(r)).toBe('working');
    await f.watcher().tick();
    expect((f.watcher().currentCoord()?.deadCoordinatorAttention ?? []).filter((a) => a.claimants.includes(A)).map((a) => a.kind))
      .toEqual(['unmeasured']);
  });
});

describe('the circuit breaker', () => {
  it('two coordinators dead within ten minutes of each other: the lane ends NOTHING, and says so once, naming both', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A); f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    for (let k = 0; k < 3; k += 1) { await anHourDead(f); f.next(); }
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    await f.watcher().tick();
    const list = f.watcher().currentCoord()?.deadCoordinatorAttention ?? [];
    expect(list.map((a) => [a.kind, a.claimants])).toEqual([['breaker', [A, B]]]);
    expect(f.feed().filter(([, t]) => t === 'dead coordinator: breaker tripped'), 'its feed row, written once').toHaveLength(1);
  });

  it('IT REMEMBERS: one pass that cannot tell one of them crashed from put down on purpose does not dissolve the cluster', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A); f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    await f.pass(); await walk(f, 27 * 60_000);
    const uuid = path.join(f.reg, `${A}.uuid`);
    rmSync(uuid);                                      // A's row reads absent, and the mirror holds no history: unmeasured
    f.next(); await f.pass();
    expect(f.anchorOf(A), 'its anchor went (ruling E)').toBeNull();
    writeFileSync(uuid, `u-${A}`);                     // back: re-anchored half an hour after B
    await walk(f, HOUR + 20 * 60_000);
    expect([ra, rb].map(f.stateOf), 'B is due on its own anchor, and still held').toEqual(['working', 'working']);
    expect(f.attention()).toEqual([['breaker', [A, B]]]);
  });

  it('a FLEET-WIDE doubt trips it whatever the count: tmux down for one, a row gone for the other — nothing ends', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(B);
    const ra = f.working(A);                           // A has no row, but a history: it reads crashed before tmux is asked
    f.journal(A, 'create');
    const rb = f.working(B);
    f.setTmuxDown(true);
    await anHourDead(f);
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    expect(f.attention()).toEqual([['breaker', [A, B]]]);
    const one = await fixture();
    one.plant(B);
    one.working(B);
    one.setTmuxDown(true);
    await one.pass();
    expect(one.attention(), 'one coordinator facing a tmux that does not answer is a fleet fault too').toEqual([['breaker', [B]]]);
  });

  it('it resumes once they fall back under the threshold — one revived, the other ends', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A); f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    await anHourDead(f);
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    f.live.add(B);
    f.next(); await f.pass();
    expect([ra, rb].map(f.stateOf)).toEqual(['failed', 'working']);
  });

  it('is evaluated in SHADOW too, so the operator sees it before arming', async () => {
    const f = await fixture();
    f.plant(A); f.plant(B);
    f.working(A); f.working(B);
    await anHourDead(f);
    await f.watcher().tick();
    expect((f.watcher().currentCoord()?.deadCoordinatorAttention ?? []).map((a) => a.kind)).toEqual(['breaker']);
    expect(f.feed().filter(([, t]) => t.startsWith('dead coordinator')), 'the trip is recorded; nothing would be ended')
      .toEqual([[A, 'dead coordinator: breaker tripped']]);
  });
});

describe('the breaker’s hold survives a RESTART (review 381, F1)', () => {
  /** The breaker tripped on {A, B}; then B reads unmeasurable (its row gone, no history): its anchor is deleted (ruling E),
   *  so B is held ONLY by the breaker's memory. */
  const tripThenDoubt = async (f: Fixture) => {
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A); f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    await f.pass(); await walk(f, 27 * 60_000);
    expect(breakerItem(f)).toEqual([['breaker', [A, B]]]);
    rmSync(path.join(f.reg, `${B}.uuid`));
    f.next(); await f.pass();
    expect(f.anchorOf(B), 'B’s anchor went (ruling E): its hold is memory alone').toBeNull();
    expect(breakerItem(f)).toEqual([['breaker', [A, B]]]);
    return { ra, rb };
  };
  /** B's own `unmeasured` item rides beside it: the breaker item is what the invariant is about. */
  const breakerItem = (f: Fixture) => f.attention().filter(([k]) => k === 'breaker');
  const latest = (f: Fixture) => f.coord.deadCoordinatorBreakerHeldLatest();

  it('THE INVARIANT: a restart does not dissolve the held cluster — A is not ended while B is unreleased, however long the passes run', async () => {
    const f = await fixture();
    const { ra, rb } = await tripThenDoubt(f);
    f.restart();
    await walk(f, HOUR + 30 * 60_000);
    expect([ra, rb].map(f.stateOf), 'nothing ended: B is still in the population with no evidence').toEqual(['working', 'working']);
    expect(f.calls, 'nothing composed on the box').toEqual([]);
    expect(breakerItem(f), 'the breaker item still names both').toEqual([['breaker', [A, B]]]);
  });

  it('the record is the trip’s own: both members, at their ORIGINAL first-dead instants, on a run the first member coordinates', async () => {
    const f = await fixture();
    const { ra } = await tripThenDoubt(f);
    expect(latest(f)).toEqual({ ok: true, runId: ra, held: [{ id: A, firstDeadAt: T0 }, { id: B, firstDeadAt: T0 }] });
    const rows = f.coord.runEvents(ra).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:'));
    expect(rows, 'written when the set CHANGED, not on every pass').toHaveLength(1);
  });

  it('a restart does not loosen what releases it: B back alive releases B, the breaker clears and A (alone) ends; the clear is recorded', async () => {
    const f = await fixture();
    const { ra, rb } = await tripThenDoubt(f);
    f.restart();
    writeFileSync(path.join(f.reg, `${B}.uuid`), `u-${B}`);
    f.live.add(B);
    f.next(); await f.pass();
    expect(f.attention(), 'A alone is no cluster').toEqual([]);
    expect(latest(f), 'the clear is a row too').toEqual({ ok: true, runId: ra, held: [] });
    expect([ra, rb].map(f.stateOf), 'not yet: A has not been dead an hour').toEqual(['working', 'working']);
    await walk(f, HOUR);
    expect([ra, rb].map(f.stateOf), 'B lives; A, dead past the hour and two passes, ends').toEqual(['failed', 'working']);
  });

  it('a seeded member that LEFT the population is released too — its programme closed while the server was down', async () => {
    const f = await fixture();
    const { ra, rb } = await tripThenDoubt(f);
    f.restart();
    expect(f.coord.closeRun({ runId: rb, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: `prog-${B}`, viaClosing: true })).toMatchObject({ ok: true });
    await f.pass();
    expect(f.attention()).toEqual([]);
    expect(latest(f)).toMatchObject({ ok: true, held: [] });
    expect(f.stateOf(ra)).toBe('working');
  });

  it('a restart seeds the REMEMBERED instants, never the pass’s own: the breaker’s members still read the trip’s first-dead instants (review 382, R4)', async () => {
    const f = await fixture();
    await tripThenDoubt(f);
    f.restart();
    f.next(); await f.pass();
    const members = (f.watcher() as unknown as { deadCoordinatorBreakerState: { tripped: boolean; members?: { id: string; firstDeadAt: number }[] } })
      .deadCoordinatorBreakerState.members;
    expect(members, 'held at the instants the record carries, not at this pass').toEqual([{ id: A, firstDeadAt: T0 }, { id: B, firstDeadAt: T0 }]);
  });

  /** A record this build cannot read: the latest held-set row on the run it sits on, and the typed state's snapshot. */
  const plantMalformed = (f: Fixture, runId: number): void => plantBadRecord(f, runId);
  const heldRows = (f: Fixture, runId: number) =>
    f.coord.runEvents(runId).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:'));
  const unreadableBody = (f: Fixture): string =>
    f.coord.feedEvents(50).find((e) => e.title === 'dead coordinator: breaker record unreadable')?.body ?? '';
  const unreadableRows = (f: Fixture) => f.feed().filter(([, t]) => t === 'dead coordinator: breaker record unreadable');

  it('an UNREADABLE record never freezes the lane: it holds every claimant this pass does not release, writes a READABLE record, and the next pass reads it (review 382, R2)', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const C = 'demo-coord-c';
    f.plant(A); f.plant(B); f.plant(C);
    f.live.add(B); f.live.add(C);
    const ra = f.working(A);
    const rb = f.working(B);
    f.working(C);
    await f.pass(); await walk(f, 30 * 60_000);         // A has been dead half an hour; B and C live
    f.live.delete(B);
    f.next(); await f.pass();                           // B dies now: A's and B's instants are 30 minutes apart — no natural cluster
    expect(f.attention(), 'no cluster of their own').toEqual([]);
    plantMalformed(f, ra);                              // the latest held-set row cannot be read
    f.restart();
    await walk(f, 3 * HOUR);                            // past A's hour and B's, many crashed passes
    expect([ra, rb].map(f.stateOf), 'neither is ended: the fallback held both, at one instant').toEqual(['working', 'working']);
    expect(f.calls, 'nothing composed on the box').toEqual([]);
    const fresh = heldRows(f, ra).filter((e) => !(e.detail ?? '').endsWith('@soon'));
    expect(fresh.length, 'checkpoints on the passes that started an anchor, then the fallback\'s record — never one per pass').toBeLessThanOrEqual(5);
    const rowsBefore = fresh.length;
    expect(fresh.at(-1)!.detail, 'exactly A and B (C lives), each flagged, each at the instants it carries (its anchor, and the pass\'s)').toMatch(new RegExp(`^dead-coordinator-breaker-held:${A}@[0-9+]+\\*,${B}@[0-9+]+\\*$`));
    expect(f.coord.deadCoordinatorBreakerHeldLatest()).toMatchObject({ ok: true, runId: ra, held: [{ id: A }, { id: B }] });
    const warned = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('record of its hold'));
    expect(warned, 'ONE warn line for the bad row').toHaveLength(1);
    expect(warned[0], 'names the row it could not read').toContain('the breaker state row');
    expect(unreadableRows(f), 'and ONE feed row').toEqual([[A, 'dead coordinator: breaker record unreadable']]);
    expect(unreadableBody(f), 'the row says who was held, flagged').toContain(`(${A}, ${B}), each flagged`);
    warn.mockClear();
    f.restart();                                        // a fresh watcher over the same store reads the record: no fallback
    await walk(f, HOUR);
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('record of its hold')), 'seeded from the record, no warn').toEqual([]);
    expect(heldRows(f, ra).filter((e) => !(e.detail ?? '').endsWith('@soon')), 'and nothing rewritten').toHaveLength(rowsBefore);
    expect(unreadableRows(f)).toHaveLength(1);
  });

  it('an unreadable record holds a member only the RECORD held: B, unmeasurable with its anchor gone, stays held by the fallback and A is not ended (review 382, R2)', async () => {
    const f = await fixture();
    const { ra, rb } = await tripThenDoubt(f);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    plantMalformed(f, ra);
    f.restart();
    await walk(f, HOUR + 30 * 60_000);
    expect([ra, rb].map(f.stateOf), 'B is in the population with no evidence: held, so A waits').toEqual(['working', 'working']);
    expect(breakerItem(f)).toEqual([['breaker', [A, B]]]);
    expect(latest(f)).toMatchObject({ ok: true, held: [{ id: A }, { id: B }] });
  });

  it('an unreadable record behind ONE unreleased claimant loosens nothing and freezes nothing: the fallback holds no cluster, an empty record supersedes the bad row, and the claimant ends after its hour (review 382, R2)', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A);
    const ra = f.working(A);
    plantMalformed(f, ra);
    await anHourDead(f);
    expect(f.stateOf(ra)).toBe('failed');
    expect(f.coord.deadCoordinatorBreakerHeldLatest(), 'the carrier is the bad row\'s own run').toEqual({ ok: true, runId: ra, held: [] });
    expect(unreadableBody(f), 'a lone unreleased claimant: the row says nothing was held').toContain('nothing was held');
    expect(unreadableBody(f)).not.toContain('flagged');
  });

  it('a read that THROWS seeds the fallback too, and warns once per process, its reason bounded to 64 characters (review 382, R2)', async () => {
    const f = await fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(f.coord, 'deadCoordinatorBreakerState').mockReturnValue({ kind: 'unreadable', detail: 'x'.repeat(200) });
    f.plant(A); f.plant(B);
    const ra = f.working(A); f.working(B);
    await anHourDead(f);
    expect(f.attention(), 'both held as one cluster').toEqual([['breaker', [A, B]]]);
    expect(f.coord.deadCoordinatorBreakerState).toHaveBeenCalledTimes(1);
    const warned = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('record of its hold'));
    expect(warned).toHaveLength(1);
    expect(warned[0], 'the reason is cut at 64 characters').toContain(`: ${'x'.repeat(64)})`);
    expect(warned[0]).not.toContain('x'.repeat(65));
    expect(unreadableRows(f)).toHaveLength(1);
    expect(f.coord.feedEvents(50).find((e) => e.title === 'dead coordinator: breaker record unreadable')?.body, 'the feed row bounds it too')
      .not.toContain('x'.repeat(65));
    expect(f.stateOf(ra)).toBe('working');
  });

  /** The reviewer's probe (review 382, R2 follow-up): U crashes at minute 0, V at 32, Z lives; a malformed record and a restart
   *  at 32; U reads unmeasurable at 40 (its anchor goes), crashes again at 48 (a fresh anchor); Z crashes at 53; V is back at
   *  143. The TRUE held set at the restart is empty, so a correct seed trips the breaker on {U, Z} and nothing ends. The
   *  fallback must hold at least that: a flagged member clusters with every other entry whatever the instants. */
  const probe = async (restartAgain: boolean): Promise<void> => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const U = 'demo-coord-u'; const V = 'demo-coord-v'; const Z = 'demo-coord-z';
    f.plant(U); f.plant(V); f.plant(Z);
    f.live.add(V); f.live.add(Z);
    const ru = f.working(U); const rv = f.working(V); const rz = f.working(Z);
    let m = 0;
    const to = async (target: number): Promise<void> => {
      while (m < target) { const d = Math.min(9, target - m); f.advance(d * 60_000); m += d; await f.pass(); }
    };
    await f.pass();                                     // minute 0: U crashes
    await to(31);
    f.live.delete(V);
    await to(32);                                       // minute 32: V crashes
    plantMalformed(f, ru);
    f.restart();                                        // the restart, over a record it cannot read
    await to(33);                                       // the fallback pass: {U, V} held, a fresh record written
    expect(f.coord.deadCoordinatorBreakerHeldLatest(), 'the fresh record is readable').toMatchObject({ ok: true, held: [{ id: U }, { id: V }] });
    if (restartAgain) { f.restart(); await to(34); }    // seeded from the record: the flag must be in it
    rmSync(path.join(f.reg, `${U}.uuid`));
    await to(40);                                       // U unmeasurable: its anchor is deleted
    writeFileSync(path.join(f.reg, `${U}.uuid`), `u-${U}`);
    await to(48);                                       // U crashes again, re-anchored at 48
    f.live.delete(Z);
    await to(53);                                       // Z crashes at 53
    await to(140);
    f.live.add(V);
    await to(143);                                      // V is back: released
    await to(143 + 120);                                // far past U's hour and Z's
    expect([ru, rv, rz].map(f.stateOf), 'nothing ends: the true held set is empty, and {U, Z} cluster').toEqual(['working', 'working', 'working']);
    expect(f.calls, 'nothing composed on the box').toEqual([]);
    expect(breakerItem(f)).toEqual([['breaker', [U, Z]]]);
  };
  it('THE FALLBACK NEVER LOOSENS (the reviewer\'s probe): a member the true record would not hold cannot let U and Z be ended once V is released (review 382, R2)', async () => { await probe(false); });
  it('...and a restart after the fallback record was written, before Z crashes, still does not end U (review 382, R2)', async () => { await probe(true); });

  it('A claimant SWEPT INTO a flagged trip is flagged too: its crash instant never becomes an ordinary hold that a later re-anchor loosens (review 382, N1)', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [U, V, W, X, Z] = ['demo-coord-u', 'demo-coord-v', 'demo-coord-w', 'demo-coord-x', 'demo-coord-z'];
    for (const id of [W, X, Z]) { f.plant(id); f.live.add(id); }        // U and V have no registry row: unmeasurable
    const ru = f.working(U); const rv = f.working(V); const rw = f.working(W); const rx = f.working(X); const rz = f.working(Z);
    let m = 0;
    const to = async (target: number): Promise<void> => {
      while (m < target) { const d = Math.min(9, target - m); f.advance(d * 60_000); m += d; await f.pass(); }
    };
    await f.pass();
    plantMalformed(f, ru);
    f.restart();                                        // the restart lands on a record it cannot read
    await to(1);                                        // fallback: U and V held, flagged
    f.live.delete(Z);
    await to(10);                                       // Z crashes at 10: swept into the trip
    rmSync(path.join(f.reg, `${Z}.uuid`));
    await to(19);                                       // Z unmeasurable: its anchor goes
    writeFileSync(path.join(f.reg, `${Z}.uuid`), `u-${Z}`);
    f.live.delete(W);
    await to(28);                                       // Z crashes again, re-anchored at 28; W crashes at 28
    await to(100);
    for (const id of [U, V]) { f.plant(id); f.live.add(id); }
    await to(110);                                      // U and V are back: released
    await to(110 + 150);                                // far past W's hour and Z's
    expect([ru, rv, rw, rx, rz].map(f.stateOf), 'nothing ends: the true held set is empty, and {W, Z} cluster').toEqual(['working', 'working', 'working', 'working', 'working']);
    expect(f.calls, 'nothing composed on the box').toEqual([]);
    expect(breakerItem(f)).toEqual([['breaker', [W, Z]]]);
  });

  it('the unreadable-record feed row keys its words on the breaker: tripped on a fleet-wide doubt it never says "nothing was held" (review 382, N3)', async () => {
    const f = await fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(B);
    const rb = f.working(B);
    plantMalformed(f, rb);
    f.setTmuxDown(true);                                // one claimant and a tmux that does not answer: the unmeasurable arm
    await f.pass();
    expect(f.attention(), 'the breaker tripped on the doubt').toEqual([['breaker', [B]]]);
    const body = unreadableBody(f);
    expect(body).not.toContain('nothing was held');
    expect(body).toContain('fleet-wide doubt');
  });

  it('NO ACT until the hold is recorded: a pass whose held-set write fails composes nothing — a claimant due, the breaker clear — and a later pass whose write lands acts (review 382, R3)', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A); f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    await anHourDead(f);                               // tripped on {A, B}: the hold is recorded
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    const restore = failBreakerWrites(f);
    f.live.add(B);                                     // B back: the set changes to empty, A alone is due
    f.next(); await f.pass();
    expect(f.stateOf(ra), 'not ended while its release of B is unrecorded').toBe('working');
    expect(f.acts(), 'no act composed at all').toBe(0);
    expect(warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('no act this pass'))).toBe(true);
    restore();
    f.next(); await f.pass();
    expect(f.coord.deadCoordinatorBreakerHeldLatest(), 'the clear landed').toEqual({ ok: true, runId: ra, held: [] });
    expect(f.stateOf(ra), 'the pass whose write landed acts').toBe('failed');
  });

  it('NO ACT until the hold is recorded, in SHADOW too: no would-end row on a pass whose write threw (review 382, R3)', async () => {
    const f = await fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A); f.plant(B);
    f.working(A); f.working(B);
    await anHourDead(f);
    const wouldEnd = () => f.feed().filter(([, t]) => t === 'dead coordinator: programme would be ended');
    expect(wouldEnd()).toEqual([]);
    const restore = failBreakerWrites(f);
    f.live.add(B);
    f.next(); await f.pass();
    expect(wouldEnd(), 'nothing recorded while the hold is unrecorded').toEqual([]);
    restore();
    f.next(); await f.pass();
    expect(wouldEnd().map(([s]) => s)).toEqual([A]);
  });

  it('is written in SHADOW too, and only when the set changes', async () => {
    const f = await fixture();
    f.plant(A); f.plant(B);
    const ra = f.working(A); f.working(B);
    await anHourDead(f);
    for (let k = 0; k < 3; k += 1) { f.next(); await f.pass(); }
    const rows = f.coord.runEvents(ra).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:'));
    expect(rows.map((e) => e.detail)).toEqual([`dead-coordinator-breaker-held:${A}@${T0},${B}@${T0}`]);
  });

  it('the stall watch never counts it, and nothing pushes it', async () => {
    const f = await fixture();
    f.plant(A); f.plant(B);
    f.working(A); f.working(B);
    await f.pass();
    const seen = f.coord.stallObservationsSince(0);
    expect(seen.ok && seen.rows.some((r) => (r.detail ?? '').startsWith('dead-coordinator-breaker-held:'))).toBe(true);
    expect(stallNoticeCounts(seen.ok ? seen.rows : []).every((c) => c.sent === 0 && c.shadow === 0)).toBe(true);
  });
});

/** The reviewer's probes (review 384, F1), adapted: one scripted world, run twice with the lane ARMED. The only difference
 *  is that the second run's lane restarts — over an unreadable record (the fallback seed), or over a readable one (a PLAIN
 *  restart) — while the first never does. Every event is ordinary: a pane dying or returning, a registry row absent for
 *  one pass. Whatever the restarted lane ends, the unrestarted lane's breaker must not be standing over: Q is due at the
 *  end, and the unrestarted lane's breaker holds it, so the restarted lane must not end it. */
describe('a restarted lane never ends a claimant the unrestarted lane\'s breaker holds (review 384, F1)', () => {
  const scenario = async (restart: 'none' | 'fallback' | 'plain', tail: boolean, again = false) => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [U, X, Y, Z, Q] = ['demo-coord-u', 'demo-coord-x', 'demo-coord-y', 'demo-coord-z', 'demo-coord-q'];
    for (const id of [X, Y, Z, Q]) f.plant(id);                 // U has no registry row: unmeasurable
    for (const id of [Y, Z, Q]) f.live.add(id);                 // X is crashed from minute 0
    const r = Object.fromEntries([U, X, Y, Z, Q].map((id) => [id, f.working(id)])) as Record<string, number>;
    let m = 0;
    const to = async (target: number): Promise<void> => {
      while (m < target) { const d = Math.min(9, target - m); f.advance(d * 60_000); m += d; await f.pass(); }
    };
    const breaker = () => f.attention().filter(([k]) => k === 'breaker');
    await f.pass();                                             // m0: X crashes; U unmeasurable
    if (restart === 'fallback') {
      plantBadRecord(f, r[X]!, X);
      f.restart();
    }
    await to(1);                                                // the fallback holds {U*, X*}; a plain lane trips on nothing yet
    if (restart === 'plain') { await to(55); f.restart(); }     // a PLAIN restart over a READABLE record at 55
    await to(64);                                               // the unrestarted lane ends X at its hour; the restarted one holds it
    f.plant(U); f.live.add(U);
    rmSync(path.join(f.reg, `${X}.uuid`));
    await to(70);                                               // U back; X doubted (its anchor goes)
    f.live.delete(Q);
    await to(72);                                               // Q crashes at 72
    await to(79);
    writeFileSync(path.join(f.reg, `${X}.uuid`), `u-${X}`);
    f.live.delete(Y);
    await to(88);                                               // X re-anchored at 88; Y crashes at 88
    rmSync(path.join(f.reg, `${Y}.uuid`));
    await to(97);                                               // Y doubted
    writeFileSync(path.join(f.reg, `${Y}.uuid`), `u-${Y}`);
    f.live.delete(Z);
    await to(106);                                              // Y crashes again, Z crashes beside it: {Y, Z} cluster
    await to(133);                                              // Q is due
    f.live.add(X);
    await to(136);                                              // X is back
    if (tail) {                                                 // review 384, F1-N1: a member keeps EVERY instant it carried
      rmSync(path.join(f.reg, `${Y}.uuid`));
      await to(140);                                            // Y is unmeasurable (its anchor goes): held by its instants alone
      if (again) f.restart();                                   // a second restart now: the RECORD is the only place Y's later instant lives
      await to(142);
    }
    return { q: f.stateOf(r[Q]!), breaker: breaker(), states: [U, X, Y, Z, Q].map((id) => f.stateOf(r[id]!)) };
  };
  const against = async (restart: 'fallback' | 'plain', tail = false, again = false): Promise<void> => {
    const c = await scenario('none', tail, again);
    vi.restoreAllMocks();
    const rs = await scenario(restart, tail, again);
    expect(c.q, 'the unrestarted lane holds Q: its breaker stands on {Y, Z}').toBe('working');
    expect(c.breaker).toEqual([['breaker', ['demo-coord-y', 'demo-coord-z']]]);
    expect(rs.q, 'the restarted lane must not end Q while that breaker stands').toBe('working');
    expect(rs.breaker, 'and its breaker stands too').toEqual(c.breaker);
  };
  it('after a restart over an UNREADABLE record (the fallback seed), once its flags clear', async () => { await against('fallback'); });
  it('after a PLAIN restart over a readable record, a delayed act leaves a claimant the unrestarted lane already ended', async () => { await against('plain'); });
  it('...and when a member made one by an EARLIER anchor is later unmeasurable, its LATER instant still clusters (plain restart; review 384, F1-N1)', async () => { await against('plain', true); });
  it('...the same after a restart over an unreadable record (review 384, F1-N1)', async () => { await against('fallback', true); });
  it('...and the instants are DURABLE: a restart after the anchor is gone, when only the record carries the later instant, changes nothing (review 384, F1-N1)', async () => { await against('plain', true, true); });
});

/** THE RETURNING-ID SEAM (D-4825). One scripted world, run as two lanes that differ only in the passes they take. Q is
 *  crashed from minute 4 (anchored at 9) and is due at the pass at 72. X is crashed from 22 (anchored at 27), is ALIVE for
 *  a few minutes (64-70) with its supervisor stamping a heartbeat, and crashes again; Z crashes at 70. Lane U takes a pass
 *  INSIDE X's alive window (minute 66): X reads alive and its anchor is deleted, so at 72 its crash starts a FRESH anchor
 *  and clusters with Z, and the breaker holds Q. Lane R takes no pass inside the window (the passes it skips, a restart's
 *  downtime, a stale mirror), so it sees X crashed throughout and keeps X's OLD anchor (27): without the episode boundary
 *  X@27 and Z@72 do not cluster, and R ends Q while U's breaker on {X, Z} stands. The evidence for the boundary is what
 *  the lane already reads: the claimant's supervisor heartbeat (`supervisedAt`) is LATER than its durable anchor's
 *  `firstDeadAt`. */
describe('a new spawn starts a new episode (D-4825)', () => {
  const [X, Z, Q] = ['demo-coord-x', 'demo-coord-z', 'demo-coord-q'];
  const world = async (lane: 'U' | 'R', o: { restartAt?: number; evidence?: 'heartbeat' | 'journal' } = {}) => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of [X, Z, Q]) f.plant(id);
    for (const id of [X, Z, Q]) f.live.add(id);
    const r = Object.fromEntries([X, Z, Q].map((id) => [id, f.working(id)])) as Record<string, number>;
    const events: Record<number, () => void> = {
      4: () => { f.live.delete(Q); },                            // Q crashes (anchored at the pass at 9)
      22: () => { f.live.delete(X); },                           // X crashes (anchored at the pass at 27)
      // D-4827: a successful spawn that stamps NO heartbeat (an unsupervised fallback) is journaled all the same.
      64: () => { f.live.add(X); if (o.evidence === 'journal') f.journal(X, 'spawn', { meas: { rc: '0' } }); else writeFileSync(path.join(f.reg, `${X}.supervised`), String(Math.floor((T0 + 65 * 60_000) / 1000))); },
      70: () => { f.live.delete(X); f.live.delete(Z); },         // X crashes again, its heartbeat stays at minute 65; Z crashes
    };
    const passes = new Set([0, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99, 108, 117, 126, 135, 144, ...(lane === 'U' ? [66] : [])]);
    const times = [...new Set([...Object.keys(events).map(Number), ...passes, ...(o.restartAt === undefined ? [] : [o.restartAt])])].sort((a, b) => a - b);
    let m = 0;
    for (const t of times) {
      f.advance((t - m) * 60_000); m = t;
      events[t]?.();
      if (o.restartAt === t) f.restart();
      if (passes.has(t)) await f.pass();
    }
    return { states: [X, Z, Q].map((id) => f.stateOf(r[id]!)),
      breaker: f.attention().filter(([k]) => k === 'breaker'), anchorX: f.anchorOf(X) };
  };
  const together = async (o: { restartAt?: number; evidence?: 'heartbeat' | 'journal' } = {}): Promise<void> => {
    const u = await world('U', o.evidence === undefined ? {} : { evidence: o.evidence });
    vi.restoreAllMocks();
    const r = await world('R', o);
    expect(u.breaker, 'the lane that saw X alive trips on {X, Z}').toEqual([['breaker', [X, Z]]]);
    expect(u.states, 'and ends nothing').toEqual(['working', 'working', 'working']);
    expect(r.breaker, 'the lane that skipped the alive pass stands on the same breaker').toEqual(u.breaker);
    expect(r.states, 'and ends nothing either: X, Z and Q all stay').toEqual(['working', 'working', 'working']);
  };
  it('the lane that missed the alive pass starts a fresh anchor from the later heartbeat, clusters X with Z, and ends neither X nor Q while the other lane\'s breaker stands', async () => { await together(); });
  it('...and a restart after the fresh anchor was written changes nothing: the anchor and the held record carry the boundary', async () => { await together({ restartAt: 75 }); });

  it('a JOURNALED successful spawn with no heartbeat starts a new episode too: the lane that missed the alive pass ends neither Q nor the returned claimant (D-4827)', async () => { await together({ evidence: 'journal' }); });
  it('...and a restart after the fresh anchor was written changes nothing (D-4827)', async () => { await together({ evidence: 'journal', restartAt: 75 }); });

  it('a new episode\'s hour counts from its FRESH anchor: the claimant is not ended before it, and is ended after it, not never', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(X);
    const rx = f.working(X);
    let m = 0;
    const to = async (target: number): Promise<void> => {
      while (m < target) { const d = Math.min(9, target - m); f.advance(d * 60_000); m += d; await f.pass(); }
    };
    await f.pass(); await to(18);                               // X crashed since minute 0
    writeFileSync(path.join(f.reg, `${X}.supervised`), String(Math.floor((T0 + 20 * 60_000) / 1000)));   // it was supervised again at 20, and died again
    await to(36);                                               // the pass at 27 sees a heartbeat later than the anchor: a new episode, anchored there
    expect(f.anchorOf(X), 'the anchor is the fresh one, durably').toMatchObject({ firstDeadAt: T0 + 27 * 60_000 });
    await to(81);
    expect(f.stateOf(rx), 'an hour has not passed since the fresh anchor (27 + 60 = 87)').toBe('working');
    await to(99);
    expect(f.stateOf(rx), 'it ends once the hour since the fresh anchor has').toBe('failed');
  });
});

/** THE LOST HOLD (D-4826). The record is written at step six, after step five wrote the pass's anchors, so a process that
 *  died between the two, or whose write kept failing before a restart, leaves holds no record carries. On its first pass the
 *  restarted lane flags every claimant whose durable anchor STARTED after the latest record row was written. Each case runs
 *  one scripted world as two lanes, both ARMED: U never dies; R's record write at the dying pass throws and R restarts
 *  right after. Q (crashed from 4, anchored 9, due at 72) must stay `working` in both. */
describe('a restart after a lost held-set write holds what it cannot prove it did not hold (D-4826)', () => {
  type Ev = Record<number, (f: Fixture) => void>;
  const scripted = async (ids: string[], events: Ev, passes: number[], o: { failWriteAt?: number | number[]; restartAfter?: number } = {}) => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of ids) { f.plant(id); f.live.add(id); }
    const r = Object.fromEntries(ids.map((id) => [id, f.working(id)])) as Record<string, number>;
    const ps = new Set(passes);
    const times = [...new Set([...Object.keys(events).map(Number), ...passes, ...(o.restartAfter === undefined ? [] : [o.restartAfter])])].sort((a, b) => a - b);
    let m = 0;
    for (const t of times) {
      f.advance((t - m) * 60_000); m = t;
      events[t]?.(f);
      if (o.restartAfter === t) f.restart();
      if (ps.has(t)) {
        // a process that dies between step five (anchors written) and step six (the record written): the record write does
        // not land on this pass, and the process is restarted before the next one.
        const restore = [o.failWriteAt ?? []].flat().includes(t) ? failBreakerWrites(f, 'process died here') : null;
        await f.pass();
        restore?.();
      }
    }
    return { states: Object.fromEntries(ids.map((id) => [id, f.stateOf(r[id]!)])), breaker: f.attention().filter(([k]) => k === 'breaker') };
  };
  const [P, X, Z, Q, Y] = ['demo-coord-p', 'demo-coord-x', 'demo-coord-z', 'demo-coord-q', 'demo-coord-y'];
  const sup = (f: Fixture, id: string, minute: number) => writeFileSync(path.join(f.reg, `${id}.supervised`), String(Math.floor((T0 + minute * 60_000) / 1000)));
  const doubt = (f: Fixture, id: string) => rmSync(path.join(f.reg, `${id}.uuid`));
  const undoubt = (f: Fixture, id: string) => writeFileSync(path.join(f.reg, `${id}.uuid`), `u-${id}`);
  const PASSES = [0, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90];
  const bothHold = async (ids: string[], ev: Ev, failWriteAt: number | number[], restartAfter: number): Promise<void> => {
    const u = await scripted(ids, ev, PASSES);
    vi.restoreAllMocks();
    const r = await scripted(ids, ev, PASSES, { failWriteAt, restartAfter });
    expect(u.states[Q], 'the lane that never died holds Q').toBe('working');
    expect(r.states[Q], 'the lane restarted over a lost write must not end it').toBe('working');
  };
  // P and X die at 20 (anchored 27, the trip {P, X} is recorded at 27); P is doubted from 30 (held by memory alone). X
  // returns 46-52 unseen (heartbeat at 47) and dies with Z at 52: the pass at 54 starts X's fresh episode and trips
  // {P, X, Z}; R dies there, between step five and step six. From 55 P is back (released) and X is doubted.
  const fresh: Ev = {
    4: (f) => { f.live.delete(Q); },
    20: (f) => { f.live.delete(X); f.live.delete(P); },
    30: (f) => { doubt(f, P); },
    46: (f) => { f.live.add(X); sup(f, X, 47); },
    52: (f) => { f.live.delete(X); f.live.delete(Z); },
    55: (f) => { undoubt(f, P); f.live.add(P); doubt(f, X); },
  };
  it('the fresh-instant form: the new episode\'s instant, lost with the write, is not lost with the restart', async () => { await bothHold([P, X, Z, Q], fresh, 54, 55); });
  it('...doubted on the first pass after the restart ONLY, and crashed again later: the loss does not return with the anchor', async () => {
    await bothHold([P, X, Z, Q], { ...fresh, 64: (f) => { undoubt(f, X); } }, 54, 55);
  });
  // The generic form, no new episode: X and Z die at 40 (anchored 45, the trip); R dies between five and six at 45; X doubted from 46.
  it('the generic form: every hold formed on the dying pass, not only a fresh instant', async () => {
    await bothHold([X, Z, Q], {
      4: (f) => { f.live.delete(Q); },
      40: (f) => { f.live.delete(X); f.live.delete(Z); },
      46: (f) => { doubt(f, X); },
    }, 45, 46);
  });
  // Writes that keep failing lose more than the hold of one pass: P (recorded at 27, held by memory through a doubt) is
  // re-anchored at 54 and doubted again, so its later instant lives in memory alone; X dies at 62 (anchored 63, within the
  // window of P's 54) and the cluster {P, X} outlives Y, who is back at 64. The restart seeds P@27 alone: only X, flagged
  // as an anchor newer than the record, still holds with it.
  it('...writes that keep failing lose a recorded member\'s LATER instant too: the flagged anchor holds with the member as recorded', async () => {
    await bothHold([P, Y, X, Q], {
      4: (f) => { f.live.delete(Q); },
      20: (f) => { f.live.delete(P); f.live.delete(Y); },
      30: (f) => { doubt(f, P); },
      52: (f) => { undoubt(f, P); },                    // P crashed again: re-anchored at the pass at 54
      57: (f) => { doubt(f, P); },                      // doubted at 63: its anchor goes, its instants live in memory
      62: (f) => { f.live.delete(X); },                 // X anchored at 63
      64: (f) => { f.live.add(Y); },
    }, [54, 63], 64);
  });
  it('the record\'s time is the WRITE-time clock: no anchor of the pass that landed it reads as started after it', async () => {
    const f = await fixture({ onHasSession: (id) => { if (id === A) f.advance(3000); } });   // each claimant is measured at its own, later instant
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A); f.plant(B);
    const ra = f.working(A); f.working(B);
    await f.pass();
    const row = f.coord.runEvents(ra).find((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:'))!;
    const anchors = f.coord.deadAnchors();
    const latest = anchors.ok ? Math.max(...[...anchors.anchors.values()].map((a) => a.firstDeadAt)) : -1;
    expect(latest, 'B was anchored after the pass began').toBeGreaterThan(T0);
    expect(row.at, 'the record is no earlier than any anchor of its pass').toBeGreaterThanOrEqual(latest);
  });
  /** A and B crash on separate passes, 30 minutes apart (they never cluster); the lane's passes every nine minutes. */
  const apart = async (failWrites: boolean) => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A); f.plant(B);
    f.live.add(B);
    const ra = f.working(A); const rb = f.working(B);
    let m = 0;
    const to = async (target: number): Promise<void> => {
      while (m < target) { const d = Math.min(9, target - m); f.advance(d * 60_000); m += d; await f.pass(); }
    };
    const restore = failWrites ? failBreakerWrites(f, 'store is broken') : null;
    await f.pass();                                  // A crashed, anchored at 0; B alive
    await to(27);
    f.live.delete(B);                                // B crashes at 27, anchored at the pass at 36
    await to(45);
    restore?.();
    f.restart();
    await to(90);
    return { f, ra, rb, held: f.attention().filter(([k]) => k === 'breaker') };
  };
  it('A QUIET SYSTEM holds nothing after a restart: a pass that starts an anchor checkpoints the unchanged record, so two crashed claimants that never clustered are not held, and the due one ends on schedule (the checkpoint)', async () => {
    const { f, ra, rb, held } = await apart(false);
    expect(held, 'no breaker').toEqual([]);
    expect(f.stateOf(ra), 'A: dead since 0, due at the pass at 63 (two passes after the restart)').toBe('failed');
    expect(f.stateOf(rb), 'B: not before its own hour (36 + 60)').toBe('working');
    // one observation row per pass that STARTED an anchor, none on a quiet pass
    const rows = f.coord.runEvents(ra).filter((e) => (e.detail ?? '').startsWith('dead-coordinator-breaker-held:'));
    expect(rows.length, 'the first crash and B\'s crash each checkpointed, and nothing else').toBeLessThanOrEqual(3);
  });
  it('...a store whose breaker writes keep failing leaves the state DIRTY, so the restart holds every claimant it does not release, flagged, until evidence (D-4857)', async () => {
    // The same world with every breaker write failing: no commit ever lands, the state stays dirty, so after the restart both
    // crashed claimants are held, flagged, until evidence — the cost that remains, said out loud.
    const { f, ra, rb, held } = await apart(true);
    expect([ra, rb].map(f.stateOf), 'held until evidence, not ended').toEqual(['working', 'working']);
    expect(held).toEqual([['breaker', [A, B]]]);
    f.live.add(B);                                   // B comes back: evidence
    f.next(); await f.pass();
    f.next(); await f.pass();
    // No commit landed before the restart, so A's anchor never did either: its hour counts from the first commit after it
    // (the pass at 54), never from an anchor nobody made durable.
    expect(f.anchorOf(A), 'A\'s durable anchor is the first committed one').toMatchObject({ firstDeadAt: T0 + 54 * 60_000 });
    expect(f.stateOf(ra), 'released by evidence on B, but not an hour since that anchor').toBe('working');
    await walk(f, 30 * 60_000);
    expect(f.stateOf(ra), 'A alone ends once it is').toBe('failed');
  });
  it('a pass whose commit fails acts on NOTHING, even with the held set unchanged, and the next pass whose commit lands acts (D-4857: commit success is the only permission to act)', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A); f.plant(B);
    f.live.add(B);
    const ra = f.working(A); f.working(B);
    let m = 0;
    const to = async (target: number): Promise<void> => {
      while (m < target) { const d = Math.min(9, target - m); f.advance(d * 60_000); m += d; await f.pass(); }
    };
    await f.pass(); await to(54);                    // A crashed since 0, due at the pass at 63
    f.live.delete(B);                                // B crashes at 54: its anchor starts at the pass at 63
    const restore = failBreakerWrites(f, 'store is broken');
    await to(63);
    expect(f.stateOf(ra), 'due, but the pass that starts B\'s anchor did not commit: no act').toBe('working');
    restore();
    await to(72);
    expect(f.stateOf(ra), 'the next pass commits, and acts').toBe('failed');
  });
});

/** THE TYPED BREAKER STATE (D-4857, the operator's ruling 4286). Every pass that changes anything durable marks the
 *  breaker's typed state DIRTY alone, then writes the exact held snapshot, every anchor change and the state CLEAN in one
 *  transaction; only a landed commit permits an act; a restart over a state that is dirty, absent or unreadable holds every
 *  claimant it does not release, flagged, beside every member, instant and flag it can still read. */
describe('the breaker\'s typed state: dirty before any anchor change, clean only with the exact snapshot (D-4857)', () => {
  const [M, N, Q, Z] = ['demo-coord-m', 'demo-coord-n', 'demo-coord-q', 'demo-coord-z'];
  const HEAVY = 180_000;
  const stateOf = (f: Fixture) => f.coord.deadCoordinatorBreakerState();
  const doubt = (f: Fixture, id: string) => rmSync(path.join(f.reg, `${id}.uuid`));
  const undoubt = (f: Fixture, id: string) => writeFileSync(path.join(f.reg, `${id}.uuid`), `u-${id}`);
  const putState = (f: Fixture, state: 'clean' | 'dirty' | 'sealed', held: string | null, generation = 7, at = 1): void => {
    f.coord.db.exec('DELETE FROM dead_coordinator_breaker_state');
    f.coord.db.prepare('INSERT INTO dead_coordinator_breaker_state (id, generation, state, held, writtenAt) VALUES (1, ?, ?, ?, ?)').run(generation, state, held, at);
  };
  const feedTitles = (f: Fixture) => f.feed().map(([, t]) => t).filter((t) => t.startsWith('dead coordinator: no breaker state') || t.startsWith('dead coordinator: breaker state') || t.startsWith('dead coordinator: breaker record'));
  const warned = (w: { mock: { calls: unknown[][] } }) => w.mock.calls.map((c) => String(c[0]));

  /** One scripted world, ARMED, its passes at the given minutes; `fail(minute)` may inject a failure into that pass only;
   *  `restartAfter` restarts the lane right after that minute's pass. */
  const scripted = async (o: {
    ids: string[]; dead: string[]; events: Record<number, (f: Fixture) => void>; passes: number[];
    fail?: (f: Fixture, minute: number) => (() => void) | null; restartAfter?: number; atRestart?: (f: Fixture) => void;
    /** Called after each pass, with the minute — a measurement mid-world. */
    after?: (f: Fixture, minute: number, stateOfRun: (id: string) => string) => void;
  }) => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of o.ids) { f.plant(id); if (!o.dead.includes(id)) f.live.add(id); }
    const r = Object.fromEntries(o.ids.map((id) => [id, f.working(id)])) as Record<string, number>;
    const times = [...new Set([...Object.keys(o.events).map(Number), ...o.passes])].sort((a, b) => a - b);
    let m = 0;
    for (const t of times) {
      f.advance((t - m) * 60_000); m = t;
      o.events[t]?.(f);
      if (o.passes.includes(t)) {
        const restore = o.fail?.(f, t) ?? null;
        await f.pass();
        restore?.();
        o.after?.(f, t, (id) => f.stateOf(r[id]!));
      }
      if (o.restartAfter === t) { o.atRestart?.(f); f.restart(); }
    }
    return { f, states: Object.fromEntries(o.ids.map((id) => [id, f.stateOf(r[id]!)])), breaker: f.attention().filter(([k]) => k === 'breaker') };
  };

  // MAIL 4266'S TRACE (measured at bcb39b146): M and N crash at 0 (the trip is recorded); Q crashes at 30 (anchored, and the
  // record checkpointed, at 30); from 40 to 63 the held-set record cannot be written while anchor changes could land; M is
  // doubted at 45 (its anchor deleted), crashes again at 55 (U holds M at {0, 55}, unrecorded), is doubted again at 63 (that
  // anchor deleted too); R restarts right after 63; Z crashes at 64; N is back at 70. U holds [M, Z] (55 and 64 cluster), so
  // Q, due at 90, must not be ended — by either lane.
  const PASSES_4266 = [0, 9, 18, 27, 30, 36, 40, 45, 50, 54, 55, 60, 63, 64, 70, 72, 79, 81, 88, 90, 95];
  const events4266: Record<number, (f: Fixture) => void> = {
    30: (f) => { f.live.delete(Q); },
    45: (f) => { doubt(f, M); },
    55: (f) => { undoubt(f, M); },
    63: (f) => { doubt(f, M); },
    64: (f) => { f.live.delete(Z); },
    70: (f) => { f.live.add(N); },
  };
  it('MAIL 4266\'S TRACE: the anchor written, the held write failed, a doubt deleted the anchor, a restart — neither lane ends Q', async () => {
    const recordFails = (f: Fixture, minute: number) => (minute >= 40 && minute <= 63 ? failSql(f, /^INSERT INTO run_events/) : null);
    const u = await scripted({ ids: [M, N, Q, Z], dead: [M, N], events: events4266, passes: PASSES_4266, fail: recordFails });
    expect(u.states[Q], 'the lane that never restarted holds Q').toBe('working');
    expect(u.breaker).toEqual([['breaker', [M, Z]]]);
    vi.restoreAllMocks();
    let atRestart: string | null = null;
    const r = await scripted({ ids: [M, N, Q, Z], dead: [M, N], events: events4266, passes: PASSES_4266, fail: recordFails, restartAfter: 63,
      atRestart: (f) => { atRestart = stateOf(f).kind; } });
    expect(atRestart, 'the commits that could not write the record left the state dirty').toBe('dirty');
    expect(r.states[Q], 'the restarted lane must not end Q').toBe('working');
    expect(r.breaker.length, 'its breaker stands').toBe(1);
    expect(feedTitles(r.f)).toEqual(['dead coordinator: breaker state left dirty']);
  }, HEAVY);

  // EACH BOUNDARY OF THE COMMIT (the ruling's item 7), on the pass that re-anchors M at 55 (the witness: M held at {0, 55}),
  // and a restart right after it. A failure exposes the old complete state, dirty; no failure, the new complete state.
  const PASSES_B = [0, 9, 18, 27, 30, 36, 45, 54, 55, 60, 64, 70, 72, 79, 81, 88, 90, 95];
  const eventsB: Record<number, (f: Fixture) => void> = {
    30: (f) => { f.live.delete(Q); }, 45: (f) => { doubt(f, M); }, 55: (f) => { undoubt(f, M); }, 56: (f) => { doubt(f, M); },
    64: (f) => { f.live.delete(Z); }, 70: (f) => { f.live.add(N); },
  };
  const boundaries: [string, ((f: Fixture) => () => void) | null][] = [
    ['right after the dirty mark (the commit\'s first statement)', (f) => failSql(f, /^SELECT CAST\(generation AS TEXT\) AS genText, CAST\(state AS TEXT\) AS state FROM/)],
    ['after an anchor write, inside the transaction (the record that follows it)', (f) => failSql(f, /^INSERT INTO run_events/)],
    ['during the exact-snapshot write', (f) => failSql(f, /^UPDATE dead_coordinator_breaker_state/)],
    ['at the COMMIT', (f) => failCommit(f)],
    ['after clean (the commit landed)', null],
  ];
  for (const [where, inject] of boundaries) {
    it(`a crash ${where} exposes the old complete state, dirty, or the new complete one — never clean without the witness — and the restarted lane ends nothing`, async () => {
      let at: ReturnType<typeof stateOf> | null = null;
      let anchorM: unknown = null;
      const r = await scripted({ ids: [M, N, Q, Z], dead: [M, N], events: eventsB, passes: PASSES_B, restartAfter: 55,
        fail: (f, minute) => (minute === 55 && inject !== null ? inject(f) : null),
        atRestart: (f) => { at = stateOf(f); anchorM = f.anchorOf(M); } });
      const s = at as unknown as ReturnType<typeof stateOf>;
      if (inject === null) {
        expect(s, 'the new complete state carries the witness').toMatchObject({ kind: 'clean' });
        const m = s.kind === 'clean' ? s.held.find((x) => x.id === M) : undefined;
        expect(m?.instants, 'M at both instants').toEqual([T0, T0 + 55 * 60_000]);
        expect(anchorM, 'and its anchor').toMatchObject({ firstDeadAt: T0 + 55 * 60_000 });
      } else {
        expect(s, 'dirty, the last landed snapshot (M at 0 alone)').toMatchObject({ kind: 'dirty', snapshot: { kind: 'members' } });
        const m = s.kind === 'dirty' && s.snapshot.kind === 'members' ? s.snapshot.members.find((x) => x.id === M) : undefined;
        expect(m, 'the old complete state').toEqual({ id: M, firstDeadAt: T0 });
        expect(anchorM, 'no anchor written outside the commit').toBeNull();
      }
      expect(r.states[Q], 'Q is never ended').toBe('working');
      expect(r.breaker.length).toBe(1);
    }, HEAVY);
  }

  // THE REVIEW OF D-4857: one failed write must never let an ARMED lane act sooner. A is crashed from 0, doubted on the pass at
  // 50 ONLY (its anchor deleted: the hour restarts), crashed again from 51: a lane with no failure re-anchors it at 51 and
  // cannot end it before 111.
  const P_A = [0, 9, 18, 27, 36, 45, 50, 51, 60, 69, 78, 87, 96, 105, 111];
  const evA: Record<number, (f: Fixture) => void> = { 50: (f) => { doubt(f, A); }, 51: (f) => { undoubt(f, A); } };
  const hourOfA = async (fail: (f: Fixture, minute: number) => (() => void) | null, restartAfter?: number) => {
    const seen: Record<number, string> = {};
    await scripted({ ids: [A], dead: [A], events: evA, passes: P_A, fail, ...(restartAfter === undefined ? {} : { restartAfter }),
      after: (_f, minute, st) => { seen[minute] = st(A); } });
    expect([seen[60], seen[105]], 'the doubt at 50 restarted the hour: not ended before 111').toEqual(['working', 'working']);
    expect(seen[111], 'ended once an hour has passed since 51, not never').toBe('failed');
  };
  it('P1: a DIRTY MARK that fails on the pass that doubts A keeps its anchor delete PENDING — the hour still restarts, and A is not ended at 60', async () => {
    await hourOfA((f, minute) => (minute === 50 ? failSql(f, /^INSERT INTO dead_coordinator_breaker_state/) : null));
  }, HEAVY);
  it('P3: a COMMIT that fails on that pass, then a restart: the conservative seed continues NO durable anchor, so the hour restarts at its pass', async () => {
    await hourOfA((f, minute) => (minute === 50 ? failSql(f, /^UPDATE dead_coordinator_breaker_state/) : null), 50);
  }, HEAVY);
  it('P2: a DIRTY MARK that fails on the pass that trips {M, N} still moves the in-memory hold: doubted from the next pass, they hold, and Q is not ended', async () => {
    const r = await scripted({ ids: [Q, M, N], dead: [Q], passes: [0, 9, 18, 27, 36, 45, 54, 55, 60, 69],
      events: { 53: (f) => { f.live.delete(M); f.live.delete(N); }, 55: (f) => { doubt(f, M); doubt(f, N); } },
      fail: (f, minute) => (minute === 54 ? failSql(f, /^INSERT INTO dead_coordinator_breaker_state/) : null) });
    expect(r.breaker, 'the trip formed on the failed pass stands').toEqual([['breaker', [M, N]]]);
    expect(r.states[Q], 'Q, due at 60, is held').toBe('working');
  }, HEAVY);

  // FIX ROUND 5, R2 (review 401, F2; D-4916): no exception may drop a computed hold. The pass that forms the trip at 54 has its
  // dirty mark LAND and then a later statement THROWS (not a `{ ok: false }` the store folds itself): the hold must still move
  // and the anchor changes must still be pending, as for a failed mark or commit. The control run has no throw.
  const tripWorld = (fail: (f: Fixture, minute: number) => (() => void) | null) => scripted({
    ids: [Q, M, N], dead: [Q], passes: [0, 9, 18, 27, 36, 45, 54, 55, 60, 69, 78],
    events: { 53: (f) => { f.live.delete(M); f.live.delete(N); }, 55: (f) => { doubt(f, M); doubt(f, N); } },
    fail,
  });
  it('R2.control: with no throw, the trip at 54 holds Q through 78', async () => {
    const r = await tripWorld(() => null);
    expect(r.breaker).toEqual([['breaker', [M, N]]]);
    expect(r.states[Q]).toBe('working');
  }, HEAVY);
  it('R2.P7: the CARRIER READ throws after the dirty mark landed, on the tripping pass: the hold still moves, the pass acts on nothing, and Q is not ended (review 401, F2)', async () => {
    let afterThrow: string | null = null;
    const r = await scripted({
      ids: [Q, M, N], dead: [Q], passes: [0, 9, 18, 27, 36, 45, 54, 55, 60, 69, 78],
      events: { 53: (f) => { f.live.delete(M); f.live.delete(N); }, 55: (f) => { doubt(f, M); doubt(f, N); } },
      fail: (f, minute) => (minute === 54 ? failSql(f, /^SELECT CAST\(id AS TEXT\) AS idText, program, CAST\(wave AS TEXT\)/) : null),
      after: (f, minute) => { if (minute === 54) afterThrow = stateOf(f).kind; },
    });
    expect(afterThrow, 'the throwing pass left the state dirty (the commit-failed path)').toBe('dirty');
    expect(r.breaker, 'the trip formed on the throwing pass stands').toEqual([['breaker', [M, N]]]);
    expect(r.states[Q], 'Q, due at 60, is held').toBe('working');
  }, HEAVY);
  it('R2.commit-throws: the store\'s commit method itself throws (outside its own try) on the tripping pass: the same — hold moved, changes pending, no act', async () => {
    const r = await tripWorld((f, minute) => {
      if (minute !== 54) return null;
      const spy = vi.spyOn(f.coord, 'commitDeadCoordinatorBreakerState').mockImplementation(() => { throw new Error('injected: commit threw'); });
      return () => spy.mockRestore();
    });
    expect(r.breaker).toEqual([['breaker', [M, N]]]);
    expect(r.states[Q]).toBe('working');
    const st = stateOf(r.f);
    expect(st.kind, 'the next pass committed what the throwing pass computed').toBe('clean');
    expect(st.kind === 'clean' && st.held.map((m) => m.id).sort()).toEqual([M, N]);
  }, HEAVY);

  it('A LONE-SURROGATE claimant is held across a restart: its id has a spelling, so the record lands and the act is not withheld for it', async () => {
    const S = 'demo-coord-\ud800';
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A);
    const ra = f.working(A);
    // `claimedBy` cannot carry a lone surrogate through SQLite (it reads back U+FFFD), so the population and the journal
    // clause are given it directly: S has no registry row and, for the first pass only, a journaled successful spawn —
    // so it reads crashed (its row gone) at 0, and unmeasured (no history) after, its anchor deleted.
    let sCrashed = true;
    const ids = f.coord.openCoordinatorIds.bind(f.coord);
    vi.spyOn(f.coord, 'openCoordinatorIds').mockImplementation(() => [...ids(), S]);
    const rows = f.coord.deadCoordinatorJournalRows.bind(f.coord);
    vi.spyOn(f.coord, 'deadCoordinatorJournalRows').mockImplementation((asked: readonly string[]) => {
      const m = rows(asked.filter((id) => id !== S));
      if (asked.includes(S)) {
        m.set(S, sCrashed ? { hasHistory: true, rows: [{ act: 'spawn', outcome: 'done', at: T0 - 7_200_000, gen: '1790000000000000000',
          dec: { surface: 'none' }, meas: { rc: 0 }, raw: '{}' }] } : { rows: [], hasHistory: false });
      }
      return m;
    });
    await f.pass();                                      // A and S crash together: the trip {A, S}
    expect(f.attention().filter(([k]) => k === 'breaker')).toEqual([['breaker', [A, S].sort()]]);
    sCrashed = false;
    f.next(); await f.pass();                            // S unmeasured: its anchor goes, the hold is memory and the record
    const st = f.coord.deadCoordinatorBreakerState();
    expect(st.kind === 'clean' && st.held.map((m) => m.id).sort(), 'the snapshot carries S exactly').toEqual([A, S].sort());
    f.restart();
    await walk(f, 2 * HOUR);
    expect(f.stateOf(ra), 'A is not ended: S is held across the restart').toBe('working');
    expect(f.attention().filter(([k]) => k === 'breaker')).toEqual([['breaker', [A, S].sort()]]);
  }, HEAVY);

  it('a DIRTY state with a READABLE snapshot: every member, instant and flag it carries is kept, every unreleased claimant is added flagged, an exact record is written before clean — and nothing is cleared by its age', async () => {
    const f = await fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const C = 'demo-coord-c'; const Y = 'demo-coord-y';
    f.plant(A); f.plant(B); f.plant(C); f.live.add(C);
    f.working(A); f.working(B); f.working(C);
    const t1 = T0 - 120 * 60_000; const t2 = T0 - 100 * 60_000;
    putState(f, 'dirty', `dead-coordinator-breaker-held:${A}@${t1}+${t2},${C}@${t2},${Y}@${t2}*`, 7, 1);   // written at time 1: ancient
    await f.pass();
    expect(stateOf(f), 'clean, with the exact replacement').toEqual({ kind: 'clean', generation: 9, writtenAt: T0, held: [
      { id: A, firstDeadAt: t1, instants: [t1, t2, T0], fallback: true },     // its instants kept, its anchor added, flagged
      { id: B, firstDeadAt: T0, fallback: true },                               // unreleased, named nowhere: held at the pass
    ] });                                                                       // C alive: released; Y left the population
    expect(warned(warn).filter((m) => m.includes('left dirty (generation 7)')), 'one warn line').toHaveLength(1);
    expect(feedTitles(f)).toEqual(['dead coordinator: breaker state left dirty']);
  });

  const seeds: [string, (f: Fixture, ra: number) => void, string][] = [
    ['an ABSENT row (the deploy that creates the table)', () => {}, 'dead coordinator: no breaker state yet'],
    ['a dirty row with NO snapshot', (f) => { putState(f, 'dirty', null); }, 'dead coordinator: breaker state left dirty'],
    ['a dirty row with a MALFORMED snapshot', (f) => { putState(f, 'dirty', `dead-coordinator-breaker-held:${A}@soon`); }, 'dead coordinator: breaker state left dirty'],
    ['a clean row with a MALFORMED snapshot (unreadable)', (f) => { putState(f, 'clean', `dead-coordinator-breaker-held:${A}@soon`); }, 'dead coordinator: breaker record unreadable'],
  ];
  for (const [what, plant, title] of seeds) {
    it(`${what}: every unreleased claimant held, flagged, beside what the latest readable record carries — and its own words`, async () => {
      const f = await fixture({ breakerState: 'absent' });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      f.plant(A); f.plant(B);
      const ra = f.working(A); f.working(B);
      const t1 = T0 - 30 * 60_000;
      expect(f.coord.recordDeadCoordinatorBreakerHeld(ra, [{ id: A, firstDeadAt: t1 }], t1)).toMatchObject({ recorded: true });
      plant(f, ra);
      await f.pass();
      expect(stateOf(f)).toEqual({ kind: 'clean', generation: expect.any(Number), writtenAt: T0, held: [
        { id: A, firstDeadAt: t1, instants: [t1, T0], fallback: true }, { id: B, firstDeadAt: T0, fallback: true }] });
      expect(feedTitles(f)).toEqual([title]);
    });
  }

  it('THE DEPLOY\'S ONE CONSERVATIVE PASS: with no state yet, every claimant the first pass does not release is held, flagged, and stays held until evidence releases it — across a restart — then the lane resumes', async () => {
    const f = await fixture({ breakerState: 'absent' });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A);                                          // A crashed; B has no registry row and no history: unmeasured
    const ra = f.working(A); const rb = f.working(B);
    await f.pass();
    expect(warned(warn).filter((m) => m.includes('no breaker state yet')), 'said once').toHaveLength(1);
    expect(feedTitles(f)).toEqual(['dead coordinator: no breaker state yet']);
    await walk(f, HOUR);
    f.restart();
    await walk(f, HOUR);
    expect([ra, rb].map(f.stateOf), 'two hours: A is not ended while B, flagged, is unreleased').toEqual(['working', 'working']);
    expect(f.attention().filter(([k]) => k === 'breaker')).toEqual([['breaker', [A, B]]]);
    f.plant(B); f.live.add(B);                           // evidence: B is alive
    f.next(); await f.pass();
    f.next(); await f.pass();
    expect([ra, rb].map(f.stateOf), 'released through the door that exists: A alone ends').toEqual(['failed', 'working']);
  }, HEAVY);

  it('under a SEALED state, an anchor newer than its snapshot — one an older build started, after a rollback — is held FLAGGED beside every member the snapshot carries (D-4826, the rule that stays)', async () => {
    const f = await fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const C = 'demo-coord-c';
    f.plant(A); f.plant(B);
    const ra = f.working(A); f.working(B);
    // The snapshot: A and C held (C has since left the population), written at minute 1. A's anchor is that hold's; B's
    // anchor began at minute 30, after the snapshot, written by a build that does not keep the typed state.
    putState(f, 'sealed', `dead-coordinator-breaker-held:${A}@${T0},${C}@${T0}`, 4, T0 + 60_000);
    f.coord.setDeadAnchor(A, { firstDeadAt: T0, lastDeadAt: T0 + 30 * 60_000 });
    f.coord.setDeadAnchor(B, { firstDeadAt: T0 + 30 * 60_000, lastDeadAt: T0 + 30 * 60_000 });
    f.advance(31 * 60_000);
    await f.pass();
    expect(f.attention().filter(([k]) => k === 'breaker'), 'A, held, and B, flagged, trip though 30 minutes apart').toEqual([['breaker', [A, B]]]);
    const st = stateOf(f);
    expect(st.kind === 'clean' && st.held.find((m) => m.id === B), 'B flagged in the next snapshot').toMatchObject({ id: B, fallback: true });
    expect(feedTitles(f), 'a sealed state: no seed words').toEqual([]);
    expect(f.stateOf(ra)).toBe('working');
  });

  it('an EMPTY population with no state yet: the pass writes the exact empty snapshot and turns the state clean, no carrier needed; an anchor left behind is deleted in the same commit', async () => {
    const f = await fixture({ breakerState: 'absent' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.coord.setDeadAnchor('demo-coord-gone', { firstDeadAt: T0 - 60_000, lastDeadAt: T0 - 60_000 });
    await f.pass();
    expect(stateOf(f)).toEqual({ kind: 'clean', generation: 2, writtenAt: T0, held: [] });
    expect(f.coord.deadAnchors()).toEqual({ ok: true, anchors: new Map() });
    expect(f.coord.deadCoordinatorBreakerHeldLatest(), 'no run carries a record: the table alone does').toEqual({ ok: true, held: [], runId: null });
  });

  /** A dead since 0 (due at the pass at 63); B crashed at 30 (anchored 36, never clustering with A) and back at 63, so the
   *  pass at 63 both moves A's anchor and deletes B's. The failure is injected into that pass only. */
  const dueAt63 = async (inject: (f: Fixture) => () => void) => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A); f.plant(B); f.live.add(B);
    const ra = f.working(A); f.working(B);
    let m = 0;
    const to = async (target: number): Promise<void> => {
      while (m < target) { const d = Math.min(9, target - m); f.advance(d * 60_000); m += d; await f.pass(); }
    };
    await f.pass(); await to(27);
    f.live.delete(B);
    await to(54);
    f.live.add(B);
    const anchorsBefore = f.coord.deadAnchors();
    const before = stateOf(f);
    const restore = inject(f);
    await to(63);
    restore();
    return { f, ra, warn, anchorsBefore, before, to };
  };
  it('a STATEMENT failure inside the commit: no act, the state dirty, no anchor moved or deleted — and the next pass re-sends every change, commits and acts', async () => {
    const { f, ra, warn, anchorsBefore, to } = await dueAt63((f) => failSql(f, /^UPDATE dead_coordinator_breaker_state/));
    expect(f.stateOf(ra), 'due, and the commit failed: no act').toBe('working');
    expect(stateOf(f)).toMatchObject({ kind: 'dirty' });
    expect(f.coord.deadAnchors(), 'neither A\'s move nor B\'s delete landed').toEqual(anchorsBefore);
    expect(warned(warn).some((m) => m.includes('could not commit the breaker\'s state'))).toBe(true);
    await to(72);
    expect(stateOf(f)).toMatchObject({ kind: 'clean' });
    expect(f.anchorOf(B), 'the delete was re-sent').toBeNull();
    expect(f.stateOf(ra)).toBe('failed');
  });
  it('a COMMIT failure: the same — no act, dirty, nothing moved — and the next pass commits and acts', async () => {
    const { f, ra, anchorsBefore, to } = await dueAt63((f) => failCommit(f));
    expect(f.stateOf(ra)).toBe('working');
    expect(stateOf(f)).toMatchObject({ kind: 'dirty' });
    expect(f.coord.deadAnchors()).toEqual(anchorsBefore);
    await to(72);
    expect(f.stateOf(ra)).toBe('failed');
  });
  it('a DIRTY MARK that cannot be written: no anchor change at all, no act, the state as it was — and the next pass marks, commits and acts', async () => {
    const { f, ra, warn, anchorsBefore, before, to } = await dueAt63((f) => failSql(f, /^INSERT INTO dead_coordinator_breaker_state/));
    expect(f.stateOf(ra)).toBe('working');
    expect(f.coord.deadAnchors(), 'no anchor moved or deleted').toEqual(anchorsBefore);
    expect(stateOf(f), 'the state as it was').toEqual(before);
    expect(warned(warn).some((m) => m.includes('could not mark the breaker\'s state dirty'))).toBe(true);
    // A pass not taken leaves A's durable `lastDeadAt` at 54, so the next pass must come inside the episode gap (a minute
    // later, as a live lane's does) to continue the hour; a later one restarts it, as a skipped pass would.
    await to(64);
    expect(f.stateOf(ra)).toBe('failed');
  });
});

describe('the one cleanup switch', () => {
  it('`reclaim-paused` stops the lane ENTIRELY, shadow included: nothing measured, recorded or written — and a lowered switch needs two FRESH passes', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    f.touch('reclaim-paused');
    const asked = f.tmuxAsked.length;
    await walk(f, 5 * 60_000);         // inside the episode bound: the anchor is still this episode's when it lifts
    expect(f.tmuxAsked.length, 'nothing measured').toBe(asked);
    expect(f.stateOf(r)).toBe('working');
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();
    expect(f.stateOf(r), 'one pass after the pause is not two').toBe('working');
    f.next(); await f.pass();
    expect(f.stateOf(r)).toBe('failed');
  });
});

describe('the one cleanup switch, shadowed', () => {
  it('`reclaim-paused` stops the SHADOWED lane too: nothing asked, no anchor moved, no record, the list as it was', async () => {
    const f = await fixture();
    f.plant(A);
    f.working(A);
    await f.pass(); await walk(f, 30 * 60_000);
    f.touch('reclaim-paused');
    const asked = f.tmuxAsked.length;
    const anchor = f.anchorOf(A);
    const listed = f.attention();
    const fed = f.feed().length;
    await walk(f, 2 * HOUR);
    expect(f.tmuxAsked.length, 'nothing measured').toBe(asked);
    expect(f.anchorOf(A), 'no anchor written or deleted').toEqual(anchor);
    expect(f.attention()).toEqual(listed);
    expect(f.feed().length, 'nothing recorded').toBe(fed);
  });
});

describe('wired by buildServer', () => {
  it('the watcher is handed the coordination serialiser’s sweep handle, and ends a programme through it', async () => {
    const f = await fixture({ server: true });
    const app = await buildServer({ ...f.deps, mailToken: 'f'.repeat(64) } as never, new Bus(), f.watcher());
    try {
      f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
      f.plant(A);
      const r = f.working(A);
      await anHourDead(f);
      expect(f.stateOf(r)).toBe('failed');
      expect(f.coord.runEvents(r).at(-1)?.causedBy).toBe('sweep');
    } finally {
      await app.close();
    }
  });
});

describe('each claimant is measured at the instant it is measured', () => {
  it('a heartbeat written after the pass began — while an EARLIER claimant was being measured — is a restarting coordinator, not a crashed one', async () => {
    let beat = false;
    const f: Fixture = await fixture({ onHasSession: (id) => {
      if (id !== A || !beat) return;
      f.advance(3000);   // the pass is three seconds old when B is measured, and B's supervisor has just beaten
      writeFileSync(path.join(f.reg, `${B}.supervised`), String((T0 + 3000) / 1000));
    } });
    f.plant(A); f.plant(B);
    f.working(A); f.working(B);
    f.live.add(A);
    beat = true;
    await f.pass();
    expect(f.tmuxAsked[0], 'A was asked first: the heartbeat landed mid-pass').toBe(A);
    expect(f.anchorOf(B), 'restarting is no crash: no anchor written').toBeNull();
    expect(f.watcher().currentDeadCoordinators().get(B)?.crashedPasses).toBe(0);
    expect(f.attention()).toEqual([]);
  });
});

describe('the pass guards', () => {
  it('a tick inside the cadence window does not run the lane: nothing measured, no second crashed pass', async () => {
    const f = await fixture();
    f.plant(A);
    f.working(A);
    await f.pass();
    const asked = f.tmuxAsked.length;
    expect(f.watcher().currentDeadCoordinators().get(A)?.crashedPasses).toBe(1);
    f.advance(CHILD_RECLAIM_SWEEP_MS - 1);
    await f.pass();
    expect(f.tmuxAsked.length, 'inside the window: not measured').toBe(asked);
    expect(f.watcher().currentDeadCoordinators().get(A)?.crashedPasses, 'two ticks are not two passes').toBe(1);
    f.advance(1);
    await f.pass();
    expect(f.watcher().currentDeadCoordinators().get(A)?.crashedPasses).toBe(2);
  });

  it('a tick while a pass is still IN FLIGHT does not start a second pass', async () => {
    const f = await fixture();
    f.plant(A);
    f.working(A);
    await f.watcher().sweepLifecycle();
    const records = await readRegistry(f.deps.io, f.cfg);
    const names = readdirSync(f.reg);
    const release = f.holdTmux();
    try {
      const first = f.watcher().sweepDeadCoordinators(records, names);
      for (let k = 0; k < 200 && f.tmuxAsked.length === 0; k += 1) await new Promise((r) => setTimeout(r, 5));
      expect(f.tmuxAsked, 'the first pass is parked on tmux').toEqual([A]);
      f.next();                                        // past the cadence window: only the in-flight flag can refuse it
      await f.watcher().sweepLifecycle();              // the mirror is fresh again: a second pass would reach tmux
      const second = await Promise.race([
        f.watcher().sweepDeadCoordinators(records, names).then(() => 'returned'),
        new Promise<string>((r) => setTimeout(() => r('started a second pass'), 100)),
      ]);
      expect(second).toBe('returned');
      expect(f.tmuxAsked, 'one pass, one question').toEqual([A]);
      release();
      await first;
    } finally {
      release();
    }
  });
});

// ══ FIX ROUND 5 — THE SEAL (D-4916; the operator's choice of 2026-10-13, "Seal on clean shutdown"; review 401, residual (7)) ══
// A start trusts the breaker's stored snapshot ONLY when it reads `sealed`, which the server's shutdown handler writes over a
// clean state when nothing is pending. Anything else — clean (an unclean exit), dirty, absent, unreadable — seeds the
// conservative hold. The first pass of a process that read `sealed` writes `clean` back at once; until a write of THIS process
// has landed, the `unchanged` fast path is refused and nothing seals.
describe('the seal: a clean shutdown is trusted, an unclean one is not (D-4916)', () => {
  const [M, N, Q] = ['demo-coord-m', 'demo-coord-n', 'demo-coord-q'];
  const HEAVY = 240_000;
  const doubt = (f: Fixture, id: string) => rmSync(path.join(f.reg, `${id}.uuid`));
  const undoubt = (f: Fixture, id: string) => writeFileSync(path.join(f.reg, `${id}.uuid`), `u-${id}`);
  const stateOf = (f: Fixture) => f.coord.deadCoordinatorBreakerState();
  const SEALED_ROW = "SELECT 1 FROM dead_coordinator_breaker_state WHERE state = 'sealed'";
  const isSealed = (f: Fixture): boolean => f.coord.db.prepare(SEALED_ROW).get() !== undefined;
  const poke = (f: Fixture, field: string, value: unknown): void => { (f.watcher() as unknown as Record<string, unknown>)[field] = value; };
  const scripted = async (o: {
    ids: string[]; dead: string[]; events: Record<number, (f: Fixture) => void>; passes: number[];
    fail?: (f: Fixture, minute: number) => (() => void) | null; restartAfter?: number; restartMode?: 'seal' | 'crash';
    atRestart?: (f: Fixture) => void;
    after?: (f: Fixture, minute: number, st: (id: string) => string) => void;
  }) => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of o.ids) { f.plant(id); if (!o.dead.includes(id)) f.live.add(id); }
    const r = Object.fromEntries(o.ids.map((id) => [id, f.working(id)])) as Record<string, number>;
    const times = [...new Set([...Object.keys(o.events).map(Number), ...o.passes])].sort((a, b) => a - b);
    let m = 0;
    for (const t of times) {
      f.advance((t - m) * 60_000); m = t;
      o.events[t]?.(f);
      if (o.passes.includes(t)) {
        const restore = o.fail?.(f, t) ?? null;
        await f.pass();
        restore?.();
        o.after?.(f, t, (id) => f.stateOf(r[id]!));
      }
      if (o.restartAfter === t) { o.atRestart?.(f); if (o.restartMode === 'seal') f.restart(); else f.crash(); }
    }
    return { f, states: Object.fromEntries(o.ids.map((id) => [id, f.stateOf(r[id]!)])), r };
  };
  const markFails = (minute: number) => (f: Fixture, m: number) => (m === minute ? failSql(f, /^INSERT INTO dead_coordinator_breaker_state/) : null);
  /** The minute `id`'s programme is first ended (`failed`), or null. */
  const firstEnd = async (o: Parameters<typeof scripted>[0], id: string) => {
    let ended: number | null = null;
    const r = await scripted({ ...o, after: (_f, minute, st) => { if (ended === null && st(id) === 'failed') ended = minute; } });
    vi.restoreAllMocks();
    return { ended, r };
  };
  /** R never acts earlier than U (null = never). */
  const noEarlier = (r: number | null, u: number | null): boolean => u === null ? r === null : (r === null || r >= u);

  // ── (7), closed: a restart after a failed write is an UNCLEAN one for the state, because nothing was sealed ──────────
  // DOUBT FORM: A crashed from 0; doubted on the pass at 50 ONLY, whose dirty mark fails; crashed again from 51.
  const P_A = [0, 9, 18, 27, 36, 45, 50, 51, 60, 69, 78, 87, 96, 105, 111, 120];
  const evA: Record<number, (f: Fixture) => void> = { 50: (f) => { doubt(f, A); }, 51: (f) => { undoubt(f, A); } };
  it('R7.doubt: a restart right after the failed mark at 50 (an unclean exit; first pass 51, 6 min after the last commit) never ends A before the unrestarted lane does', async () => {
    const u = await firstEnd({ ids: [A], dead: [A], events: evA, passes: P_A, fail: markFails(50) }, A);
    let at: string | null = null;
    const r = await firstEnd({ ids: [A], dead: [A], events: evA, passes: P_A, fail: markFails(50), restartAfter: 50, atRestart: (f) => { at = stateOf(f).kind; } }, A);
    expect(u.ended).toBe(111);
    expect(at, 'the state the restart finds: clean, but NOT sealed').toBe('clean');
    expect(noEarlier(r.ended, u.ended), `R ended A at ${r.ended}, U at ${u.ended}`).toBe(true);
  }, HEAVY);
  it('R7.doubt-gap: the same, the restarted lane\'s first pass at 56 (11 min after the last commit)', async () => {
    const passes = [0, 9, 18, 27, 36, 45, 50, 56, 60, 69, 78, 87, 96, 105, 111, 116, 120];
    const u = await firstEnd({ ids: [A], dead: [A], events: evA, passes, fail: markFails(50) }, A);
    const r = await firstEnd({ ids: [A], dead: [A], events: evA, passes, fail: markFails(50), restartAfter: 50 }, A);
    expect(noEarlier(r.ended, u.ended), `R ended A at ${r.ended}, U at ${u.ended}`).toBe(true);
  }, HEAVY);

  // TRIP FORM: Q crashed from 0; M and N crash at 53; the pass at 54 trips {M, N} and its dirty mark fails; M and N are
  // doubted from 55. U holds {M, N}, so Q, due at 60, is held.
  const evT: Record<number, (f: Fixture) => void> = { 53: (f) => { f.live.delete(M); f.live.delete(N); }, 55: (f) => { doubt(f, M); doubt(f, N); } };
  it('R7.trip: the restart after the tripping pass\'s failed mark (first pass at 55, 10 min after the last commit) never ends Q before U does', async () => {
    const P_T = [0, 9, 18, 27, 36, 45, 54, 55, 60, 69, 78];
    const u = await firstEnd({ ids: [Q, M, N], dead: [Q], events: evT, passes: P_T, fail: markFails(54) }, Q);
    const r = await firstEnd({ ids: [Q, M, N], dead: [Q], events: evT, passes: P_T, fail: markFails(54), restartAfter: 54 }, Q);
    expect(u.ended, 'U holds Q').toBeNull();
    expect(noEarlier(r.ended, u.ended), `R ended Q at ${r.ended}`).toBe(true);
  }, HEAVY);
  it('R7.trip-gap: the same, the restarted lane\'s first pass at 63 (18 min after the last commit, past the episode gap)', async () => {
    const passes = [0, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99, 108, 117, 126, 135, 144];
    const u = await firstEnd({ ids: [Q, M, N], dead: [Q], events: evT, passes, fail: markFails(54) }, Q);
    const r = await firstEnd({ ids: [Q, M, N], dead: [Q], events: evT, passes, fail: markFails(54), restartAfter: 54 }, Q);
    expect(u.ended, 'U holds Q').toBeNull();
    expect(noEarlier(r.ended, u.ended), `R ended Q at ${r.ended}`).toBe(true);
  }, HEAVY);

  // THE COST, and what a clean shutdown saves.
  const passesCost = Array.from({ length: 14 }, (_, i) => i * 9).concat([30, 60, 90, 99]).sort((a, b) => a - b);
  it('COST.one: A crashed alone from 0 is ended at 60. A restart at 30 through a CLEAN shutdown (sealed) ends it at 60 too; an UNCLEAN one restarts its hour', async () => {
    const u = await firstEnd({ ids: [A], dead: [A], events: {}, passes: passesCost }, A);
    const sealed = await firstEnd({ ids: [A], dead: [A], events: {}, passes: passesCost, restartAfter: 30, restartMode: 'seal' }, A);
    const unclean = await firstEnd({ ids: [A], dead: [A], events: {}, passes: passesCost, restartAfter: 30, restartMode: 'crash' }, A);
    expect(u.ended).toBe(60);
    expect(sealed.ended, 'the sealed restart continues the anchor').toBe(60);
    expect(unclean.ended, 'the unclean one restarts each crashed claimant\'s hour (the COST)').toBeGreaterThan(60);
  }, HEAVY);
  it('COST.two: A crashed from 0 and B from 30 are ended by U at 63 and 90; an UNCLEAN restart at 40 holds both, flagged, and a sealed one holds neither', async () => {
    const passes = Array.from({ length: 30 }, (_, i) => i * 9).concat([30, 40]).sort((a, b) => a - b);
    const ev = { 30: (f: Fixture) => { f.live.delete(B); } };
    const o = { ids: [A, B], dead: [A], events: ev, passes };
    const ua = await firstEnd(o, A);
    const sealA = await firstEnd({ ...o, restartAfter: 40, restartMode: 'seal' }, A);
    const crashA = await firstEnd({ ...o, restartAfter: 40, restartMode: 'crash' }, A);
    const crashB = await firstEnd({ ...o, restartAfter: 40, restartMode: 'crash' }, B);
    expect(ua.ended).toBe(63);
    expect(sealA.ended, 'sealed: continues, as U').toBe(63);
    expect(crashA.ended, 'unclean: two unreleased claimants hold the lane, flagged').toBeNull();
    expect(crashB.ended).toBeNull();
  }, HEAVY);

  // ── the start: trust ONLY `sealed` ──────────────────────────────────────────────────────────────────────────────────
  it('a start trusts ONLY a sealed state: the same world over a state that reads `clean` seeds the conservative hold (its own words), and over `sealed` it does not', async () => {
    const run = async (st: 'sealed' | 'clean') => {
      const f = await fixture({ breakerState: st });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      f.plant(A); f.plant(B);
      f.working(A); f.working(B);
      await f.pass();
      return { f, warned: warn.mock.calls.map((c) => String(c[0])) };
    };
    const sealed = await run('sealed');
    expect(sealed.warned.filter((m) => m.includes('not sealed'))).toEqual([]);
    expect(sealed.f.feed().filter(([, t]) => t.startsWith('dead coordinator: breaker state')), 'no seed words').toEqual([]);
    vi.restoreAllMocks();
    const clean = await run('clean');
    expect(clean.warned.filter((m) => m.includes('not sealed')), 'one warn line').toHaveLength(1);
    expect(clean.f.feed().filter(([, t]) => t === 'dead coordinator: breaker state not sealed'), 'one feed row').toHaveLength(1);
    expect(clean.f.attention().filter(([k]) => k === 'breaker'), 'A and B, both unreleased, are held, flagged').toEqual([['breaker', [A, B]]]);
  });

  // ── the eager unseal ───────────────────────────────────────────────────────────────────────────────────────────────
  it('EAGER UNSEAL: the first pass of a sealed start writes `clean` back, same snapshot, before anything else — in a quiet world too', async () => {
    const f = await fixture();
    expect(stateOf(f)).toMatchObject({ kind: 'sealed', generation: 1 });
    await f.pass();
    expect(stateOf(f), 'unsealed: the same (empty) snapshot, the generation moved on').toEqual({ kind: 'clean', generation: 2, held: [], writtenAt: T0 });
  });
  it('...and NOT deferred to the first change: a first pass whose dirty mark FAILS has still unsealed, so a crash then is not trusted', async () => {
    const f = await fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A);
    f.working(A);
    const restore = failSql(f, /^INSERT INTO dead_coordinator_breaker_state/);
    await f.pass();
    restore();
    expect(stateOf(f), 'unsealed although its first change did not land').toMatchObject({ kind: 'clean' });
    f.crash();
    expect(isSealed(f)).toBe(false);
  });
  it('a FAILED unseal means no act, however long the claimant has been dead, and the state still reads sealed; once writes land the lane unseals, commits and acts', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A);
    const ra = f.working(A);
    const restore = failSql(f, /^(UPDATE|INSERT INTO) dead_coordinator_breaker_state/);
    await f.pass(); await walk(f, 2 * HOUR);
    expect(f.stateOf(ra), 'every write fails from the first pass: nothing acts').toBe('working');
    expect(isSealed(f), 'and nothing was written').toBe(true);
    restore();
    await walk(f, 2 * 9 * 60_000);
    expect(stateOf(f)).toMatchObject({ kind: 'clean' });
    await walk(f, 2 * HOUR);
    expect(f.stateOf(ra)).toBe('failed');
  }, HEAVY);
  it('the `unchanged` fast path is refused before a write of THIS process has landed: a failed unseal in a quiet world goes through the mark and the commit', async () => {
    const f = await fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = failSql(f, /^UPDATE dead_coordinator_breaker_state SET state = 'clean'/);
    await f.pass();
    restore();
    expect(stateOf(f), 'the mark and the commit wrote it: no longer sealed').toMatchObject({ kind: 'clean', generation: 3 });
  });

  it('`unchanged` also needs the state KNOWN clean (review 401, F7; D-4916): a failed unseal, a landed mark and a failed commit over a quiet world leave it dirty, and the next pass commits rather than skipping', async () => {
    const f = await fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = failSql(f, /^UPDATE dead_coordinator_breaker_state/);      // the unseal and the commit both fail; the mark lands
    await f.pass();
    restore();
    expect(stateOf(f), 'dirty: the mark landed and nothing after it').toMatchObject({ kind: 'dirty' });
    f.next(); await f.pass();
    expect(stateOf(f), 'the next pass wrote it clean again, no changes pending').toMatchObject({ kind: 'clean' });
  });

  // ── the seal, and its refusals ─────────────────────────────────────────────────────────────────────────────────────
  const quiet = async () => {
    const f = await fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await f.pass();
    return f;
  };
  it('SEAL: after a landed write, with nothing pending and the state durably clean, it writes `sealed` over the same snapshot, once; a second attempt says so', async () => {
    const f = await quiet();
    expect(stateOf(f)).toMatchObject({ kind: 'clean', generation: 2 });
    expect(f.watcher().sealDeadCoordinatorBreakerNow()).toEqual({ sealed: true, generation: 3 });
    expect(stateOf(f)).toEqual({ kind: 'sealed', generation: 3, held: [], writtenAt: T0 });
    expect(f.watcher().sealDeadCoordinatorBreakerNow()).toEqual({ sealed: false, reason: 'already-sealed' });
  });
  const parkedPass = async (alive: boolean) => {
    const f = await fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.plant(A); if (alive) f.live.add(A);
    f.working(A);
    await f.pass();
    f.next();
    await f.watcher().sweepLifecycle();
    const records = await readRegistry(f.deps.io, f.cfg);
    const release = f.holdTmux();
    const inFlight = f.watcher().sweepDeadCoordinators(records, readdirSync(f.reg));
    for (let k = 0; k < 200 && f.tmuxAsked.length < 2; k += 1) await new Promise((r) => setTimeout(r, 5));
    return { f, release, inFlight };
  };
  it('SEAL REFUSED, a pass in flight: one parked on tmux is awaited within the bound, and past it nothing is written', async () => {
    const { f, release, inFlight } = await parkedPass(false);
    try {
      expect(await f.watcher().sealDeadCoordinatorBreaker(40)).toEqual({ sealed: false, reason: 'pass-in-flight' });
      expect(isSealed(f)).toBe(false);
    } finally { release(); }
    await inFlight;
    expect(isSealed(f), 'the awaited pass did not seal behind the refusal').toBe(false);
  });
  it('SEAL waits for a pass in flight, with a bound, and seals once it is done', async () => {
    const { f, release, inFlight } = await parkedPass(true);
    try {
      const sealing = f.watcher().sealDeadCoordinatorBreaker(5_000);
      setTimeout(release, 30);
      await inFlight;
      expect(await sealing).toMatchObject({ sealed: true });
    } finally { release(); }
    expect(isSealed(f)).toBe(true);
  });
  it('SEAL REFUSED, changes pending: a failed dirty mark leaves the anchor changes pending, and the state is not sealed', async () => {
    const f = await quiet();
    f.plant(A);
    f.working(A);
    f.next();
    const restore = failSql(f, /^INSERT INTO dead_coordinator_breaker_state/);
    await f.pass();
    restore();
    expect(f.watcher().sealDeadCoordinatorBreakerNow()).toEqual({ sealed: false, reason: 'changes-pending' });
    expect(isSealed(f)).toBe(false);
  });
  it('SEAL REFUSED, not durably clean: a state this process marked dirty and did not commit', async () => {
    const f = await quiet();
    poke(f, 'deadCoordinatorBreakerDurableClean', false);
    expect(f.watcher().sealDeadCoordinatorBreakerNow()).toEqual({ sealed: false, reason: 'not-durably-clean' });
    expect(isSealed(f)).toBe(false);
  });
  it('SEAL REFUSED, key mismatch: a held set that is not the one the last commit wrote', async () => {
    const f = await quiet();
    poke(f, 'deadCoordinatorBreakerHeld', [{ id: A, firstDeadAt: T0 }]);
    expect(f.watcher().sealDeadCoordinatorBreakerNow()).toEqual({ sealed: false, reason: 'key-mismatch' });
    expect(isSealed(f)).toBe(false);
  });
  it('SEAL REFUSED, no landed write: a process that has written nothing seals nothing — the state it found stands', async () => {
    const fresh = await fixture();
    expect(fresh.watcher().sealDeadCoordinatorBreakerNow(), 'no pass yet').toEqual({ sealed: false, reason: 'no-landed-write' });
    expect(isSealed(fresh)).toBe(true);
    const other = await fixture();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = failSql(other, /^(UPDATE|INSERT INTO) dead_coordinator_breaker_state/);
    await other.pass();
    restore();
    expect(other.watcher().sealDeadCoordinatorBreakerNow(), 'every write failed').toEqual({ sealed: false, reason: 'no-landed-write' });
    expect(isSealed(other)).toBe(true);
  });
  it('a seal attempt STOPS the lane: no pass runs after it, whatever the answer', async () => {
    const f = await fixture();
    f.plant(A);
    f.working(A);
    expect(f.watcher().sealDeadCoordinatorBreakerNow()).toMatchObject({ sealed: false });
    const asked = f.tmuxAsked.length;
    await f.pass();
    expect(f.tmuxAsked.length, 'nothing measured').toBe(asked);
    expect(isSealed(f)).toBe(true);
  });
  it('a seal whose statement FAILS says so and writes nothing', async () => {
    const f = await quiet();
    const restore = failSql(f, /^UPDATE dead_coordinator_breaker_state SET state = 'sealed'/);
    expect(f.watcher().sealDeadCoordinatorBreakerNow()).toMatchObject({ sealed: false, reason: 'write-failed' });
    restore();
    expect(stateOf(f)).toMatchObject({ kind: 'clean' });
  });

  // ── the one case no durable design can close, pinned so the words stay true ────────────────────────────────────────
  it('THE INHERENT CASE: sealed; a sealed start whose every write fails; a crash; the next start trusts the older seal — and the trip the dead process held in memory is gone', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of [Q, M, N]) { f.plant(id); if (id !== Q) f.live.add(id); }
    const rq = f.working(Q); f.working(M); f.working(N);
    let atCrash: string | null = null;
    let m = 0;
    let restore: (() => void) | null = null;
    // Process 1 passes to 45 and stops cleanly (SEALED). Process 2 can write nothing from its start: M and N crash at 47, its
    // pass at 48 trips them in memory, they are doubted from 49, and it dies after 50. Process 3's first pass is at 54, 9 min
    // after Q's last COMMITTED crashed instant (45), so it continues Q's anchor from the older seal.
    for (const t of [0, 9, 18, 27, 36, 45, 48, 50, 54, 60]) {
      f.advance((t - m) * 60_000); m = t;
      if (t === 48) { f.live.delete(M); f.live.delete(N); }
      if (t === 50) { doubt(f, M); doubt(f, N); }
      if (t === 48) {
        f.restart();                                         // process 1 stops cleanly after 45: SEALED
        restore = failSql(f, /^(UPDATE|INSERT INTO) dead_coordinator_breaker_state/);   // ...and process 2 can write nothing at all
      }
      if (t === 54) {
        restore?.(); restore = null;
        atCrash = stateOf(f).kind;
        f.crash();
      }
      await f.pass();
      if (t === 50) expect(f.stateOf(rq), 'the process that cannot write acts on nothing').toBe('working');
    }
    expect(atCrash, 'the older seal is all the next start finds').toBe('sealed');
    expect(f.stateOf(rq), 'the trip {M, N} died with the process that held it; the next start trusts the older seal and ends Q on its anchor (the floor of any durable design)').toBe('failed');
  }, HEAVY);
});
