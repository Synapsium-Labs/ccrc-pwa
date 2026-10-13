// Child reclamation wave 9 (spec §5.10): THE collector lane's rig, shared by `collect-lane-pass.test.ts` and
// `collect-lane-slot.test.ts`. A later task that needs more of it adds a member here, additively, and never builds a
// second watcher rig for this lane. What it is:
// - a real `FleetWatcher`, a real `CoordStore` and a real `KeyedQueue` (`testDeps`'s), with the registry, its
//   `tmproots/`, its `tmpquarantine/` and its switches under a fixture HOME, read through the real `localIO`;
// - the REAL population read, switches, learning audit and executor (`coord/collectTempRoot.ts`), and the real L1;
// - a scripted ccd behind the agent's real exec whitelist: a MODEL of `ws-audit --collect` and `ws-collect`, printing
//   the documents ccd prints (`_ws_collect_audit_doc`'s keys, the verb's done line), one token per id, spent only while
//   it is the current one. A case can script any id's answers, and HOLD any call, or the next registry listing, until it
//   releases it;
// - two clocks a case moves together: the wall clock (`Date.now`) and the lane's monotonic clock (`monotonicMs`);
// - `pass()` resolves when the pass has decided and enqueued, as the lane's own pass does (spec §5.10: a pass never
//   awaits a call it queued), and `settled()` waits for those calls, all but the ones a case is holding.
// The witness's run is a CLOSED run, opened before the witness was written, so the open-run hold never applies unless a
// case makes it. FIXTURE HOME ONLY: every path derives from `mkTmp`; no `ccd` runs and nothing reaches a box.
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_STALL_MS, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { COLLECT_FEED_TITLE, COLLECT_LANE_LIVE_MARKER } from '../src/collectLane.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetIO } from '../src/io.js';
import type { Runner } from '../src/exec.js';
import { COLLECT_BOX_LABELS, type ChildReclaimAttention, type ChildReclaimCollectAttention } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { FULL_CAPS } from './collectTempRootFixture.js';

export type CollectVerb = 'audit' | 'collect';
export interface CcdAnswer { readonly code: number; readonly stdout: string; readonly stderr?: string }
/** One collector call ccd received, in arrival order: the verb, the id, the token a `ws-collect` spent, and the rig's
 *  monotonic clock when the server composed it. */
export interface CollectCall { readonly verb: CollectVerb; readonly id: string; readonly token: string | null; readonly mono: number }

export interface CollectRigOpts {
  /** A RESTART: an earlier rig's HOME, coord.db, feed log, witness run and clocks. */
  readonly home?: string;
  readonly coord?: CoordStore;
  readonly notifyLog?: NotifyLog;
  readonly mintingRun?: number;
  readonly clock?: number;
  readonly mono?: number;
  /** The live marker already stands when the watcher is built. */
  readonly armed?: boolean;
}

/** The rig's WALL-clock origin. Module-private: Task 6's fixture exports a monotonic `T0`, and one name must not mean
 *  two clocks. The advertised verbs are Task 6's `FULL_CAPS`, never a copy. */
const WALL_T0 = 1_790_000_000_000;
const LABELS: ReadonlySet<string> = new Set(Object.values(COLLECT_BOX_LABELS) as string[]);
let progN = 0;

export const collectRig = async (opts: CollectRigOpts = {}) => {
  let clock = opts.clock ?? WALL_T0;
  let mono = opts.mono ?? 5_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = opts.home ?? mkTmp('ccrc-collect-lane-');
  seedRoster(home);
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const reg = cfg.registryDir;
  const tmproots = path.join(reg, 'tmproots');
  const quarantine = path.join(reg, 'tmpquarantine');
  mkdirSync(tmproots, { recursive: true });
  const coord = opts.coord ?? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let notifyLog = opts.notifyLog;
  if (notifyLog === undefined) {
    notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
  }
  // THE WITNESS'S RUN: closed (terminal), present, and opened before the witness was written (spec §5.10's hold).
  const mintingRun = opts.mintingRun ?? (() => {
    const program = `w9-collect-${++progN}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    const c = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program,
      viaClosing: false });
    if (!c.ok) throw new Error(`abandon refused: ${JSON.stringify(c)}`);
    return r.id;
  })();
  const witnessAt = WALL_T0 + 1_000;

  // ── the scripted ccd ──
  const tokenOf = (id: string): string => createHash('sha256').update(`collect ${id}`).digest('hex');
  const collectable = (id: string): CcdAnswer => ({ code: 0, stdout: JSON.stringify({
    session: id, mode: 'collect', exists: true,
    collect: { leaf: path.join(home, '.cc-tmp', id), records: [], newestCtimeNs: '1789990000000000000', entries: 3,
      floorS: 86400, idleAt: 1_789_990_000 + 86_400, unmeasured: null,
      witness: { dev: '2049', ino: '77', btime: '1789990000', run: String(mintingRun), at: String(witnessAt) } },
    verdict: 'collectable', detail: '', token: tokenOf(id) }) });
  const lockPath = (id: string): string => path.join(reg, `.reap-${id}.lock`);
  const answers = {
    collectable,
    /** No document, no recognised die: a runner kill, a timeout, a link failure (arms 2 and 3). It MAY have acted. */
    noDocument: (): CcdAnswer => ({ code: 1, stdout: '', stderr: '' }),
    /** ccd's own lock-unopenable die: bash's line for the lock path, then ccd's. It acted nothing. */
    lockUnopenable: (id: string): CcdAnswer => ({ code: 1, stdout: '',
      stderr: `${cfg.ccdBin}: line 34101: ${lockPath(id)}: Is a directory\nccd: cannot open the reap lock at ${lockPath(id)}\n` }),
    flockUnavailable: (): CcdAnswer => ({ code: 1, stdout: '',
      stderr: 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised\n' }),
  };
  const model = (verb: CollectVerb, id: string, args: readonly string[]): CcdAnswer => {
    if (verb === 'audit') return collectable(id);
    if (args[args.indexOf('--expect') + 1] !== tokenOf(id)) {
      return { code: 0, stdout: JSON.stringify({ refused: 'state-changed', detail: 'the token no longer binds it', paths: [] }) };
    }
    rmSync(path.join(tmproots, id), { force: true });                      // the witness is dropped with the leaf
    return { code: 0, stdout: JSON.stringify({ collected: id, record: `${id}.1790000000000000000.4242`, resumed: false,
      witness: 'dropped' }) };
  };
  const scripts = new Map<string, (verb: CollectVerb, args: readonly string[]) => CcdAnswer | undefined>();
  const holds = new Map<string, { promise: Promise<void>; reached: boolean }>();
  /** Per id, how many of its calls a case is holding (`hold` or `holdListing` reached, `occupy` standing): `settled()`
   *  waits on none. */
  const parked = new Map<string, number>();
  const park = (id: string, by: number): void => {
    const n = (parked.get(id) ?? 0) + by;
    if (n > 0) parked.set(id, n); else parked.delete(id);
  };
  const onCall: ((c: CollectCall) => void)[] = [];
  const calls: CollectCall[] = [];
  const run: Runner = async (cmd, args) => {
    if (path.basename(cmd) === 'tmux') return { code: 1, stdout: '', stderr: '' };   // the tick's pane reads, not ccd
    const verb: CollectVerb | null = args[0] === 'ws-audit' && args.includes('--collect') ? 'audit'
      : args[0] === 'ws-collect' ? 'collect' : null;
    if (verb === null) return { code: 1, stdout: '', stderr: `unscripted ${args[0] ?? ''}` };
    const id = args[args.indexOf('--session') + 1] ?? '';
    const call: CollectCall = { verb, id, token: verb === 'collect' ? (args[args.indexOf('--expect') + 1] ?? null) : null, mono };
    calls.push(call);
    for (const f of onCall) f(call);
    const key = `${verb} ${id}`;
    const h = holds.get(key);
    if (h !== undefined) {
      holds.delete(key); h.reached = true; park(id, 1);
      try { await h.promise; } finally { park(id, -1); }
    }
    const a = scripts.get(id)?.(verb, args) ?? model(verb, id, args);
    return { code: a.code, stdout: a.stdout, stderr: a.stderr ?? '' };
  };

  // ── the io: the real one, with three switches a case throws ──
  const base = testDeps(home, run);
  let gate: Promise<void> | null = null;   // while set, the population's lstat of `tmproots` waits on it
  let gatherReached = 0;                   // how many gathers reached the population read
  let unlistable = false;                  // the registry's own listing fails (null), as an unreadable `$REG` does
  let rejecting = false;                   // the population's lstat of EITHER listing rejects, as a port gone mid-call does
  let listingHold: { readonly promise: Promise<void>; readonly id: string } | null = null;   // the NEXT `$REG` listing waits
  let registryListings = 0;               // how many listings of the registry itself were BEGUN (a gather's, a job's)
  const io: FleetIO = {
    ...base.io,
    async lstatMeasured(p) {
      const leaf = path.basename(p);
      if (leaf === 'tmproots') gatherReached += 1;
      if (rejecting && (leaf === 'tmproots' || leaf === 'tmpquarantine')) throw new Error('agent gone');
      if (leaf === 'tmproots' && gate !== null) await gate;
      return base.io.lstatMeasured(p);
    },
    async readdir(p, timeoutMs, signal) {
      if (p === reg) registryListings += 1;
      if (p === reg && listingHold !== null) {
        const h = listingHold;
        listingHold = null; park(h.id, 1);
        try { await h.promise; } finally { park(h.id, -1); }
      }
      if (p === reg && unlistable) return null;
      return base.io.readdir(p, timeoutMs, signal);
    },
  };
  const fleetState = { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: [...FULL_CAPS] };
  let visible: (id: string) => boolean = () => false;
  const deps = { ...base, cfg, io, coord, notifyLog, fleetState, presence: { isVisible: (id: string) => visible(id) },
    monotonicMs: () => mono };
  if (opts.armed === true) writeFileSync(path.join(reg, COLLECT_LANE_LIVE_MARKER), '');
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  const startMono = mono;

  // ── helpers ──
  const names = (): string[] => readdirSync(reg);
  /** A witnessed temp root: `$REG/tmproots/<id>` (the lane never reads its bytes; ccd does). */
  const witness = (id: string): void => {
    writeFileSync(path.join(tmproots, id), `dev=2049 ino=77 btime=1789990000 run=${mintingRun} uid=1000 at=${witnessAt}\n`);
  };
  const unwitness = (id: string): void => { rmSync(path.join(tmproots, id), { force: true }); };
  const touch = (name: string): void => { writeFileSync(path.join(reg, name), ''); };
  const remove = (name: string): void => { rmSync(path.join(reg, name), { force: true }); };
  /** One pass, over a listing the tick would hand it (default: the registry as it stands). Resolves when the pass has
   *  decided and enqueued: it never awaits a call it queued (spec §5.10). `settled()` waits for those. */
  const pass = async (listing: readonly string[] = names()): Promise<void> => {
    await watcher.sweepTempRootCollect([], listing);
  };
  /** Waits until every collector call the lane has queued has settled (its fold, its slot effect and its feed row
   *  applied), but for the calls a case is holding (`hold` or `holdListing` reached, `occupy` standing). Read what a
   *  pass's calls did after this. */
  const settled = async (): Promise<void> => {
    // A call or job a case has just RELEASED is unparked a microtask later (`hold`'s and `occupy`'s `finally`): let
    // those run first, or this resolves before the released call has even been composed.
    await new Promise<void>((r) => { setImmediate(r); });
    await vi.waitFor(() => {
      const open = [...watcher.currentCollectLane().inFlight.keys()].filter((id) => !parked.has(id));
      if (open.length > 0) throw new Error(`collector calls not settled: ${open.join(', ')}`);
    }, { timeout: 5_000, interval: 1 });
  };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; mono += CHILD_RECLAIM_SWEEP_MS + 1; };
  const advance = (ms: number): void => { clock += ms; mono += ms; };
  /** Past the lane's start hold-off: `CHILD_RECLAIM_STALL_MS` after the watcher was built. */
  const pastHoldOff = (): void => { advance(CHILD_RECLAIM_STALL_MS); };
  /** `next()`, a pass and its calls settled, until `pred` holds; the number of passes it took. Throws past `max`. */
  const passesUntil = async (pred: () => boolean, max = 30): Promise<number> => {
    for (let n = 1; n <= max; n += 1) {
      next();
      await pass();
      await settled();
      if (pred()) return n;
    }
    throw new Error(`not reached within ${max} passes`);
  };
  /** The NEXT `verb` for `id` waits until released. */
  const hold = (verb: CollectVerb, id: string): { release: () => void; reached: () => boolean } => {
    let release: () => void = () => {};
    const h = { promise: new Promise<void>((r) => { release = r; }), reached: false };
    holds.set(`${verb} ${id}`, h);
    return { release: () => release(), reached: () => h.reached };
  };
  /** Every gather's population read waits until released. */
  const holdGather = (): { release: () => void } => {
    let release: () => void = () => {};
    gate = new Promise<void>((r) => { release = r; });
    return { release: () => { gate = null; release(); } };
  };
  /** The NEXT listing of the registry itself (a switches read: a pass's gather, or an act job's step 2 or step 5) waits
   *  until released, counted as one of `id`'s held calls. Arm it from `onCall` at the job's own audit to hold its step 5. */
  const holdListing = (id: string): { release: () => void } => {
    let release: () => void = () => {};
    listingHold = { promise: new Promise<void>((r) => { release = r; }), id };
    return { release: () => release() };
  };
  /** A job on the id's queue key that holds it until released: another lane's executor (a reclaim, an expiry). The
   *  id's collector calls queued behind it are held with it. */
  const occupy = (id: string): (() => void) => {
    let release: () => void = () => {};
    const p = new Promise<void>((r) => { release = r; });
    park(id, 1);
    void base.queue.run(id, () => p).finally(() => park(id, -1));
    return () => release();
  };
  /** Makes the lane LIVE as the operator does: the marker touched, and one act job (on `via`, which then leaves the
   *  listing) seeing it, composing nothing. Call it past the start hold-off, before planting the ids a case asks about. */
  const goLive = async (via = 'demo-z'): Promise<void> => {
    touch(COLLECT_LANE_LIVE_MARKER);
    witness(via);
    await passesUntil(() => watcher.currentCollectLane().lastSeenLive);
    unwitness(via);
  };
  const audits = (id?: string): CollectCall[] => calls.filter((c) => c.verb === 'audit' && (id === undefined || c.id === id));
  const collects = (id?: string): CollectCall[] => calls.filter((c) => c.verb === 'collect' && (id === undefined || c.id === id));
  const feed = () => coord.feedEvents(500).map((e) => ({ sessionId: e.sessionId, title: e.title, body: e.body }));
  /** The would-collect rows for `id` (spec §5.10: shadow writes "would collect <id>"), by Task 5's title. */
  const wouldCollects = (id: string) => feed().filter((e) => e.title === COLLECT_FEED_TITLE['would-collect']
    && e.body.includes(`would collect ${id}`));
  /** The attention list as the frame carries it: the child lane's pass PUBLISHES (its one write merges the collector's
   *  items), then a tick emits the frame. Call it right after a pass, at that pass's clock, so the tick's own dispatch of
   *  both lanes is throttled. */
  const attention = async (): Promise<readonly ChildReclaimAttention[]> => {
    await watcher.sweepChildReclaim([], names());
    await watcher.tick();
    return watcher.currentCoord()?.childReclaimAttention ?? [];
  };
  /** The box-wide collector items: a `collect` item whose `sessionId` is one of the fixed labels, never an id. */
  const boxWide = (items: readonly ChildReclaimAttention[]): ChildReclaimCollectAttention[] =>
    items.filter((a): a is ChildReclaimCollectAttention => a.kind === 'collect' && LABELS.has(a.sessionId));
  return {
    home, reg, cfg, coord, notifyLog, watcher, mintingRun, startMono, fleetState, calls, onCall, scripts, answers,
    now: (): number => clock, mono: (): number => mono, names, witness, unwitness, touch, remove, pass, settled, next, advance,
    pastHoldOff, passesUntil, hold, holdGather, holdListing, occupy, goLive, audits, collects, feed, wouldCollects, attention,
    boxWide,
    gatherReached: (): number => gatherReached,
    /** How many listings of the registry itself have begun: one per pass's gather, and one per act job's step 2 and
     *  step 5. Counted as each BEGINS, so a job that started at once is counted before the pass that queued it returns. */
    registryListings: (): number => registryListings,
    setUnlistable: (v: boolean): void => { unlistable = v; },
    setRejecting: (v: boolean): void => { rejecting = v; },
    setVisible: (f: (id: string) => boolean): void => { visible = f; },
    pause: (): void => touch(RECLAIM_PAUSE_MARKER),
    unpause: (): void => remove(RECLAIM_PAUSE_MARKER),
    disarm: (): void => remove(COLLECT_LANE_LIVE_MARKER),
    /** `tmproots` replaced by a LINK: never followed, so that listing is unmeasured. */
    breakTmproots: (): void => { rmSync(tmproots, { recursive: true, force: true }); symlinkSync(mkTmp('ccrc-elsewhere-'), tmproots); },
    /** `tmpquarantine` is a LINK (unmeasured), then gone again (a proven absence: an empty, measured listing). */
    breakQuarantine: (): void => { symlinkSync(mkTmp('ccrc-elsewhere-'), quarantine); },
    mendQuarantine: (): void => { rmSync(quarantine, { force: true }); },
    lane: () => watcher.currentCollectLane(),
  };
};
export type CollectRig = Awaited<ReturnType<typeof collectRig>>;
