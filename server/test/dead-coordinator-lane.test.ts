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
  const restart = (): void => { watcher = newWatcher(); };
  const journal = (id: string, act: string, over: Record<string, unknown> = {}): void => {
    coord.ingestJournal({ gen: '1790000000000000000', cursor: 1, size: 1, at: 1, rows: [parseJournalLine(JSON.stringify(
      { v: 1, uid: `w4lane.${id}.${act}.${clock}`, at: clock, act, outcome: 'done', id, dec: { surface: 'none' }, ...over }))] });
  };
  /** The attention list as the lane last built it, without a tick. */
  const attention = () => (watcher as unknown as { deadCoordinatorAttentionList: readonly { kind: string; claimants: string[]; sentence: string }[] })
    .deadCoordinatorAttentionList.map((a) => [a.kind, a.claimants] as const);
  return { home, reg, coord, deps, cfg, live, calls, tmuxAsked, plant, working, pass, next, touch, stateOf, feed, anchorOf,
    restart, journal, attention, acts: () => acts, advance: (ms: number) => { clock += ms; },
    setTmuxDown: (v: boolean) => { tmuxDown = v; }, watcher: () => watcher,
    /** Hold every later `has-session` until the returned release is called. */
    holdTmux: (): (() => void) => { let release = (): void => {}; gate = new Promise<void>((r) => { release = r; }); return () => { gate = null; release(); }; } };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

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

  it('the supervisor stamp RAISES the anchor: a heartbeat after the first crashed pass delays the act', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, 27 * 60_000);
    writeFileSync(path.join(f.reg, `${A}.supervised`), String(Math.floor((T0 + 20 * 60_000) / 1000)));
    await walk(f, 36 * 60_000);
    expect(f.stateOf(r), 'an hour since firstDeadAt, but not since the stamp').toBe('working');
    await walk(f, 18 * 60_000);
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

  it('an act that THROWS is asked again only after the backoff, and listed', async () => {
    const f = await fixture({ throwAct: true });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    f.working(A);
    await anHourDead(f);
    const counts = [f.acts()];
    for (let k = 0; k < 2; k += 1) { f.next(); await f.pass(); counts.push(f.acts()); }
    expect(counts, 'once, then not on the next pass, then again after two minutes').toEqual([1, 1, 2]);
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
