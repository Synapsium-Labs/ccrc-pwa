// The child-reclaim lane, wired (child-reclamation spec §5.7 "On the sweep",
// §5.9 "What the operator sees"). `child-reclaim-sweep-policy.test.ts` pins
// the L1 verdicts (`childReclaimSweepVerdict`, `childReclaimHoldRead`,
// `childReclaimNextEntry`, `childReclaimDue`); what is only provable HERE is
// what reaches the executor, when, how often, with which `deferExpired` and
// `deferredSinceMs`, the fairness/in-flight bound, the two new store reads
// this lane composes (the hold candidates, the coordination history, the
// birth fence), and that everything else reaches nothing.
//
// A `hold-retired` verdict (spec §5.7's "no hold" conjunct, a hold this build
// proved was written by one of this child's own runs whose accounting has
// since retired) never reaches the ordinary reclaim path directly — it takes
// no action on its FIRST sighting, and on the SECOND consecutive one queues
// its own release job (`releaseRetiredChildHold`), which re-reads everything
// it relies on before it ever composes `ws-release`. Only once that job has
// actually unheld the row does the child become an ordinary orphan, judged
// on the ordinary two-pass rule.
//
// The executor is stubbed at `Deps.childReclaimExec`, the ONE seam the
// watcher calls through, so most cases assert on the requests themselves. The
// production-path cases remove the stub and prove the real path composes wave
// 3's own audit argv through `runCcd`, and the SAME ports the close route
// composes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_MAX_IN_FLIGHT, CHILD_RECLAIM_STALL_MS, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { ACTOR_FLAGS_CAP, CCD_ARGV, RECLAIM_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { refusalSentence } from '../src/wsaudit.js';
import { NotifyLog } from '../src/notifylog.js';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_SKIP, childReclaimBackoffMs, childReclaimFailingSentence,
  childReclaimJournalRow, childReclaimKeptManySentence,
} from '../src/childReclaimSweep.js';
import {
  CHILD_RECLAIM_TOKEN_KIND, childReclaimGeneration, childReclaimHasCoordinated, childReclaimLatest,
  childReclaimTokenKind, type ChildReclaimOutcome, type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { CHILD_BIRTH_SKEW_MS } from '../src/coord/childSpent.js';
import { SPAWN_STALL_MS, holdReason, lcRefusalWord } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;
const GEN = '1790000000000000000';

interface FixtureOpts {
  /** false → the fleet host does not advertise `reclaim-v1`. */
  cap?: boolean;
  /** false → the fleet host does not advertise `reclaim-pause-v1`. */
  pauseCap?: boolean;
  /** 'real' → no stub; the production path runs against the recording runner. */
  exec?: 'stub' | 'real';
  /** The stub's answer; defaults to `reclaimed`. */
  outcome?: (req: ChildReclaimRequest) => ChildReclaimOutcome | Promise<ChildReclaimOutcome>;
  /** Reuse a coordination database (the restart case). */
  coord?: CoordStore;
  home?: string;
  /** Wired into `deps.presence` — the ports-composition case. */
  visible?: (id: string) => boolean;
  /** Wired into `deps.notifyLog` — the ports-composition case. */
  notifyLog?: NotifyLog;
  /** false → the fleet host does not advertise `ws-release` — the
   *  hold-release job's own `verbSupported` gate. Default true. */
  releaseCap?: boolean;
  /** The hold-release job's own ccd stub. Default: what `cmd_ws_release`
   *  actually does — unlink `<id>.hold` and answer `released <id>` if it was
   *  there, `not held <id>` if it was not (the box's own idempotent design),
   *  never at ccd's exit 1. Override to simulate a box refusal. */
  release?: (regDir: string, id: string) =>
    { code: number; stdout: string; stderr: string } | Promise<{ code: number; stdout: string; stderr: string }>;
  /** The monotonic clock's first reading. Default 5 000 — deliberately not
   *  `T0`, so a decision clock read as an epoch cannot pass by coincidence. */
  mono0?: number;
  /** 'performance' → `deps.monotonicMs` is left unset, so the lane reads its
   *  production default, `performance.now()`, which this fixture spies on. */
  monoSource?: 'performance';
}

const fixture = (opts: FixtureOpts = {}) => {
  // THREE clocks (spec §5.7): `clock` is the wall clock (`Date.now()`),
  // `mono` the process's monotonic clock (`deps.monotonicMs`, or
  // `performance.now()`), and `trueT` true time, which only the assertions
  // read. `advance` moves all three; `wallStep` moves the wall clock alone;
  // `suspend` moves the wall clock and true time, never the monotonic clock.
  let clock = T0;
  let mono = opts.mono0 ?? 5_000;
  let trueT = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  if (opts.monoSource === 'performance') vi.spyOn(performance, 'now').mockImplementation(() => mono);
  const home = opts.home ?? mkTmp('ccrc-child-reclaim-sweep-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const calls: string[][] = [];
  const releaseAnswer = opts.release ?? ((regDir: string, id: string) => {
    const p = path.join(regDir, `${id}.hold`);
    try { rmSync(p); return { code: 0, stdout: `released ${id}\n`, stderr: '' }; }
    catch { return { code: 0, stdout: `not held ${id}\n`, stderr: '' }; }
  });
  const run = async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === 'ws-release') {
      const i = args.indexOf('--session');
      return releaseAnswer(reg, args[i + 1] ?? '');
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  const coord = opts.coord ?? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const requests: ChildReclaimRequest[] = [];
  const answer = opts.outcome ?? ((req: ChildReclaimRequest): ChildReclaimOutcome =>
    ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 }));
  const deps = {
    ...testDeps(home, run), cfg, coord,
    // The verbs wave 3's executor checks before it reaches the audit — its own
    // test's `CAPS`: `ws-audit` (`verbSupported`, which REFUSES a verb a
    // present list does not name), `reclaim-v1` and `reclaim-pause-v1` (both
    // `capSupported`, the lane's own gate — spec §5.8, "the fourth [reader]
    // is the one that matters", so BOTH tokens must be proven before an
    // automatic reclaim ever runs), `ws-reclaim` + `actor-flags-v1` (the act
    // and its dec) and `ws-release` (the hold-release job's own
    // `verbSupported` gate, the close route's own verb).
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: [
        'ws-audit', 'ws-reclaim',
        ...(opts.cap === false ? [] : [RECLAIM_CAP]),
        ...(opts.pauseCap === false ? [] : [RECLAIM_PAUSE_CAP]),
        ...(opts.releaseCap === false ? [] : ['ws-release']),
        ACTOR_FLAGS_CAP,
      ] },
    presence: { isVisible: (id: string) => opts.visible?.(id) === true },
    ...(opts.notifyLog === undefined ? {} : { notifyLog: opts.notifyLog }),
    ...(opts.exec === 'real' ? {} : {
      childReclaimExec: async (req: ChildReclaimRequest) => { requests.push(req); return answer(req); },
    }),
    ...(opts.monoSource === 'performance' ? {} : { monotonicMs: () => mono }),
  };
  const bus = new Bus();
  const watcher = new FleetWatcher(deps as never, bus, 10_000);

  let uidN = 0;
  /** One journal line, mirrored — a `reclaim` line is what wave 3's ccd
   *  writes (`verb` `ws-reclaim`; or `ws-audit` for a TERMINAL refusal the
   *  reclaim-mode audit answered, spec §5.9); `act: 'create'` is ws-add
   *  minting a workspace under that id. */
  const journal = (id: string, outcome: string, refusal: string | null, act: 'reclaim' | 'create' = 'reclaim',
    verb?: 'ws-reclaim' | 'ws-audit'): void => {
    uidN += 1;
    const line = JSON.stringify({ uid: `w4.1.${uidN}`, at: clock, act, outcome,
      verb: act === 'create' ? 'ws-add' : (verb ?? 'ws-reclaim'), id,
      ...(refusal === null ? {} : { refusal }) });
    coord.ingestJournal({ gen: GEN, rows: [parseJournalLine(line)], cursor: uidN * 200, size: uidN * 200, at: clock });
  };
  /** A registry row, `divergence-sweep.test.ts`'s idiom. `child` is the
   *  marker. ws-add journals the workspace's `create` as it mints it, so the
   *  row gets that line too: without it the mirror holds no generation for
   *  the id at all, and the fence answers nothing (spec §5.6's recycled slugs). */
  const plant = (id: string, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1', ...extra,
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    journal(id, 'done', null, 'create');
  };
  let progN = 0;
  const openRun = (): { id: number; program: string } => {
    const program = `w4-prog-${++progN}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    return { id: r.id, program };
  };
  /** A REVIEW run of `work` (spec §5.7, "A review child is finished later
   *  than its own run") — `runs.reviews` names it. The store writes it as-is;
   *  the route's own checks are not what is tested. */
  const openReview = (work: { id: number; program: string }): { id: number; program: string } => {
    const r = coord.openRun({ program: work.program, title: work.program, project: 'demo', wave: 1, waveOf: null,
      claimedBy: 'demo-coord', kind: 'review', reviews: work.id });
    if (!('id' in r)) throw new Error(`openRun (review) refused: ${JSON.stringify(r)}`);
    return { id: r.id, program: work.program };
  };
  const abandon = (r: { id: number; program: string }): void => {
    const res = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: r.program, viaClosing: false });
    if (!res.ok) throw new Error(`abandon refused: ${JSON.stringify(res)}`);
  };
  const pass = async (): Promise<void> => {
    await watcher.sweepChildReclaim(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  /** Like `pass`, but returns as soon as the decision is MADE, not once it
   *  has SETTLED: `sweepChildReclaim` has no `await` between its own entry
   *  and the per-child loop's `queue.run` call, so by the time the call
   *  below returns (a plain synchronous call, its own promise merely
   *  captured, never adopted by an enclosing `return`), any enqueue for this
   *  pass has already happened — real, awaited fs I/O only for the registry
   *  read ahead of it. The caller gets the still-pending completion back, to
   *  await once whatever it queued behind can proceed — never blocked on it
   *  immediately, which would hang forever if the very guard under test had
   *  failed to guard. */
  const passDispatched = async (): Promise<{ settle: Promise<void> }> => {
    const records = await readRegistry(deps.io, cfg);
    const settle = watcher.sweepChildReclaim(records, readdirSync(reg));
    return { settle };
  };
  /** The poll's own split, made explicit: `listing` reads the registry NOW;
   *  `sweepOn` runs a pass over a listing read EARLIER. The poll reads the
   *  registry, then awaits the lanes ahead of this one, then calls it — so a
   *  release job can answer between a pass's listing and its loop. */
  const listing = async (): Promise<{ records: Awaited<ReturnType<typeof readRegistry>>; names: string[] }> =>
    ({ records: await readRegistry(deps.io, cfg), names: readdirSync(reg) });
  const sweepOn = async (l: { records: Awaited<ReturnType<typeof readRegistry>>; names: string[] }): Promise<void> => {
    await watcher.sweepChildReclaim(l.records, l.names);
  };
  const advance = (ms: number): void => { clock += ms; mono += ms; trueT += ms; };
  /** The wall clock steps (negative: back; positive: forward); nothing else moves. */
  const wallStep = (ms: number): void => { clock += ms; };
  /** The box is suspended: true time and the wall clock run on, the monotonic clock stops. */
  const suspend = (ms: number): void => { clock += ms; trueT += ms; };
  const next = (): void => advance(CHILD_RECLAIM_SWEEP_MS + 1);
  /** The lane's own read of one session's attention input row, at `now` —
   *  the generation fence, the latest-event rule and the L1 row, over the
   *  plain windowed read (every case here fits inside one window; the
   *  window-overflow merge has its own dedicated case). */
  const latestOf = (id: string) => {
    const gen = childReclaimGeneration(coord.lifecycleFor({ sessionId: id }), clock);
    return childReclaimJournalRow(gen, childReclaimLatest(gen));
  };
  const entryOf = (id: string) => watcher.currentChildReclaimDefers().get(id);
  return { home, reg, coord, watcher, bus, calls, requests, plant, openRun, openReview, abandon, journal, pass,
    passDispatched, listing, sweepOn, next, advance, wallStep, suspend, latestOf, entryOf, now: () => clock,
    mono: () => mono, trueNow: () => trueT,
    // The SAME `KeyedQueue` instance `deps.queue` (and so the release job)
    // runs on — exposed so a test can occupy a child's own queue key BEFORE
    // a pass dispatches, giving deterministic control over exactly when the
    // job's own body starts running relative to a state change made between
    // the deciding pass and the job's own re-reads.
    queue: deps.queue };
};

/** A child minted by a run that has since been abandoned — the plain case. */
const finishedChild = (f: ReturnType<typeof fixture>, id = 'demo-a'): number => {
  const r = f.openRun();
  f.abandon(r);
  f.plant(id, { child: String(r.id) });
  return r.id;
};

/** The coordinating case: `id`'s own claim is opened and abandoned at its create's instant (the fixture clock
 *  does not move), inside the coordination fence's skew, so it is this generation's own and the verdict is
 *  `coordinating`. Returns the minting run's id. */
const coordinatingChild = (f: ReturnType<typeof fixture>, id = 'demo-a'): number => {
  const r1 = f.openRun();
  f.abandon(r1);
  f.plant(id, { child: String(r1.id) });
  const coordRun = f.coord.openRun({ program: `other-${id}`, title: `other-${id}`, project: 'demo', wave: 1,
    waveOf: null, claimedBy: id });
  if (!('id' in coordRun)) throw new Error(`coordRun refused: ${JSON.stringify(coordRun)}`);
  f.abandon({ id: coordRun.id, program: `other-${id}` });
  return r1.id;
};

/** The WHOLE attention list as one label per item, `kept-many` (which has no `sessionId`) included, so an
 *  exact-list assertion cannot skip an item it did not expect. */
const attentionLabels = (f: ReturnType<typeof fixture>): string[] =>
  (f.watcher.currentCoord()?.childReclaimAttention ?? [])
    .map((a) => (a.kind === 'kept-many' ? `kept-many:${a.word}` : `${a.kind}:${a.sessionId}`));

const deferredAs = (why: 'presence' | 'state-changed', req: ChildReclaimRequest): ChildReclaimOutcome =>
  ({ kind: 'deferred', sessionId: req.sessionId, runId: req.runId, why, detail: `deferred: ${why}` });

/** A child whose retired hold the lane has RELEASED: two hold-retired passes, the second running the release job,
 *  which the fixture's ccd answers `released` after unlinking the hold. So the answer's mark stands, and no eligible
 *  verdict has consumed it yet. Returns the minting run's id. */
const releasedChild = async (f: ReturnType<typeof fixture>): Promise<number> => {
  const r1 = f.openRun(); f.abandon(r1);
  f.plant('demo-a', { child: String(r1.id), hold: holdReason(r1.program, 2, null, null) });
  await f.pass();                                              // 1st hold-retired sighting
  f.next(); await f.pass();                                    // 2nd — the release runs and answers
  expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(1);
  expect(existsSync(path.join(f.reg, 'demo-a.hold')), 'the hold file is gone').toBe(false);
  expect(f.entryOf('demo-a'), 'the answer left no entry').toBeUndefined();
  return r1.id;
};

describe('sweepChildReclaim — what reaches the executor', () => {
  it('nothing on the FIRST eligible pass; one request on the second — twice observed', async () => {
    const f = fixture();
    const runId = finishedChild(f);
    await f.pass();
    expect(f.requests).toEqual([]);
    f.next();
    await f.pass();
    expect(f.requests).toEqual([{ sessionId: 'demo-a', runId, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('keeps its own clock: a second call inside CHILD_RECLAIM_SWEEP_MS is not a second pass', async () => {
    const f = fixture();
    finishedChild(f);
    await f.pass();
    f.advance(CHILD_RECLAIM_SWEEP_MS - 1);
    await f.pass();
    expect(f.requests).toEqual([]);
    f.advance(2);
    await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('forgets the child once reclaimed — no third request', async () => {
    const f = fixture();
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();
    expect(f.entryOf('demo-a')).toBeUndefined();
  });

  it('never reaches a child whose minting run is ABSENT, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fixture();
    f.plant('demo-a', { child: '999' });
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('demo-a'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('never eligible');
  });

  it('never reaches a review child whose reviewed run is ABSENT, and says so once — as for an absent minting run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fixture();
    const work = f.openRun();
    const review = f.openReview(work);
    f.abandon(review);
    f.plant('demo-r', { child: String(review.id) });
    const real = f.coord.run.bind(f.coord);
    vi.spyOn(f.coord, 'run').mockImplementation((id: number) =>
      (id === work.id ? { ok: true as const, run: null } : real(id)));
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('demo-r'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`reviews run ${work.id}`);
    expect(lines[0]).toContain('kept');
  });

  it('reaches an ORPHAN whose minting run names a different session, outside the stall window', async () => {
    const f = fixture();
    const r = f.openRun();
    f.coord.markDispatchStarted(r.id, f.now() - SPAWN_STALL_MS - 1);
    f.coord.setSession(r.id, 'demo-b');
    f.plant('demo-a', { child: String(r.id) });
    await f.pass(); f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']);
  });

  it('leaves an orphan alone while its run is planned INSIDE the stall window', async () => {
    const f = fixture();
    const r = f.openRun();
    f.coord.markDispatchStarted(r.id, f.now() - 1_000);
    f.coord.setSession(r.id, 'demo-b');
    f.plant('demo-a', { child: String(r.id) });
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
  });

  it('leaves a child an OPEN run names — the hand-over case', async () => {
    const f = fixture();
    finishedChild(f);
    const wave2 = f.openRun();
    f.coord.setSession(wave2.id, 'demo-a');
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
  });

  it('keeps a REVIEW child while the run it reviewed is open, and reclaims it once that run is terminal', async () => {
    const f = fixture();
    const work = f.openRun();
    const review = f.openReview(work);
    f.abandon(review);
    f.plant('demo-r', { child: String(review.id) });
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests, 'reclaimed a review child whose report is still cited').toEqual([]);
    f.abandon(work);
    f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests).toEqual([
      { sessionId: 'demo-r', runId: review.id, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('leaves a held child, a child with an unreadable marker, and a row with no marker', async () => {
    const f = fixture();
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-a', { child: String(r.id), hold: 'a human wrote this — please wait' });
    f.plant('demo-b', { child: 'not-a-run-id' });
    f.plant('demo-c');
    // The PWA's OWN placeholder text, verbatim (`SessionActionsSheet.tsx`'s
    // hold-reason field placeholder, `program:name wave:2/4`) — protects
    // unconditionally too, whatever it happens to say, because it never even
    // reads as `held.kind === 'program'`: no run's own rendering matches a
    // slug literally named "name".
    f.plant('demo-d', { child: String(r.id), hold: 'program:name wave:2/4' });
    // A restored-snapshot hold naming a run this database does not hold
    // (a `run:<id>` rendering for an id nothing minted here) is doubt about a
    // programme this build cannot even look up — `held`, never `program`.
    f.plant('demo-e', { child: String(r.id), hold: holdReason('ghost-programme', 3, null, 999_999) });
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'a hold that never proved its own accounting is never released')
      .toEqual([]);
  });

  it('an ACCOUNTED-LOOKING hold whose minting run is ABSENT is doubly protected: never released, never reclaimed', async () => {
    // A restored/rebuilt-database orphan: the marker names a run this build
    // does not hold, so the minting run itself is absent — the ordinary
    // `minting-run-absent` skip stops the verdict long before it would ever
    // reach the hold at all, and the hold read itself would answer `held`
    // (no minting run to build a candidate from), never `program` — doubly
    // protected, by two independent facts.
    const f = fixture();
    const reason = holdReason('ghost-programme', 2, null, null);
    f.plant('demo-a', { child: '999', hold: reason });
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
  });

  it('a program-accounted hold protects while its programme has an open run (i), then the hold-release job clears it once retired, before the ordinary path ever sees it (ii)', async () => {
    // Spec §5.7's "no hold" conjunct: a hold this build proved was written by
    // one of this child's own runs protects only while that run's programme
    // still has an open run. `ws-reclaim`'s own rung 4 refuses any hold, so
    // once the programme retires, the hold-release job — never the ordinary
    // reclaim path directly — is what clears it, on the SECOND consecutive
    // `hold-retired` sighting.
    const f = fixture();
    const r1 = f.openRun();
    f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    const r2raw = f.coord.openRun({ program: r1.program, title: r1.program, project: 'demo', wave: 2, waveOf: null,
      claimedBy: 'demo-coord' });
    if (!('id' in r2raw)) throw new Error(`openRun r2 refused: ${JSON.stringify(r2raw)}`);
    const r2 = { id: r2raw.id, program: r1.program };
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests, 'protected while its programme has an open run').toEqual([]);
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toEqual([]);

    f.abandon(r2);                                            // the programme retires
    f.next(); await f.pass();                                 // a FIRST hold-retired sighting
    expect(f.requests).toEqual([]);
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'released on the first sighting, not the second').toEqual([]);
    f.next(); await f.pass();                                 // a SECOND — queues the release job
    expect(f.requests, 'reclaimed before it was ever released').toEqual([]);
    const released = f.calls.filter((c) => c[0] === 'ws-release');
    expect(released).toHaveLength(1);
    expect(released[0]).toEqual(['ws-release', '--session', 'demo-a',
      '--surface', 'agent', '--actor', `run:${r1.id} reclaim sweep: program ${r1.program} retired`]);
    expect(existsSync(path.join(f.reg, 'demo-a.hold')), 'the hold file is gone').toBe(false);

    // The release ANSWERED, so the first eligible verdict after it seeds
    // nothing: the lane cannot tell whether that pass's listing predates the
    // answer, and it costs one pass to be sure.
    f.next(); await f.pass();                                 // eligible, but the answer's mark is consumed
    expect(f.requests).toEqual([]);
    expect(f.entryOf('demo-a'), 'no sighting seeded on the pass right after the answer').toBeUndefined();
    f.next(); await f.pass();                                 // the ordinary path's FIRST eligible sighting
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();                                 // …and its second — only now
    expect(f.requests).toEqual([
      { sessionId: 'demo-a', runId: r1.id, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('a release answered after the NEXT pass began still needs two FRESH unheld passes — the in-flight guard covers the release job too', async () => {
    let resolveRelease!: (v: { code: number; stdout: string; stderr: string }) => void;
    const f = fixture({
      release: (regDir, id) => new Promise((resolve) => {
        resolveRelease = (v) => {
          // The box's own effect, applied only when this test tells it to —
          // the fixture's stub stands in for ccd, which the sweep never
          // touches directly.
          if (v.code === 0 && v.stdout.startsWith('released')) {
            try { rmSync(path.join(regDir, `${id}.hold`)); } catch { /* already gone */ }
          }
          resolve(v);
        };
      }),
    });
    const r1 = f.openRun(); f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    await f.pass();                                            // 1st hold-retired sighting
    f.next();
    const second = f.pass();                                  // 2nd — queues the release, still unsettled
    await vi.waitFor(() => expect(f.calls.some((c) => c[0] === 'ws-release')).toBe(true));
    f.next(); await f.pass();                                 // a pass while the release is still in flight
    expect(f.requests, 'no re-queue while the release is in flight').toEqual([]);
    resolveRelease({ code: 0, stdout: 'released demo-a\n', stderr: '' });
    await second;                                              // the release settles, after the next pass began
    f.next(); await f.pass();                                  // eligible, but the answer's mark is consumed: no sighting
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();                                  // the ordinary path's FIRST eligible sighting
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();                                  // …and its second — only now
    expect(f.requests).toEqual([
      { sessionId: 'demo-a', runId: r1.id, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('a SECOND interleaving: ccd unlinks the hold before it answers — the eligible sighting made while the release is in flight dies with the answer, and the reclaim still needs two fresh passes after it', async () => {
    // The first interleaving (above) has the stub apply ccd's effect exactly
    // AT the moment it answers. Here the effect and the answer are pulled
    // apart: the row is unheld first, and a pass reads that BEFORE the
    // release job's own promise ever resolves. The eligible branch sets its
    // first-sighting entry ahead of its own in-flight check, so this pass
    // records a sighting despite the release still being unsettled — and the
    // job's answer DELETES that entry (spec §5.7's twice-observed rule, as
    // the release's own answer must), so the reclaim still needs TWO fresh
    // unheld passes once the answer lands, never one. The answer's mark then
    // makes the first eligible verdict after it seed nothing too, so the
    // sighting count starts on the pass after that.
    let resolveRelease!: (v: { code: number; stdout: string; stderr: string }) => void;
    const f = fixture({ release: () => new Promise((resolve) => { resolveRelease = resolve; }) });
    const r1 = f.openRun(); f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    await f.pass();                                            // 1st hold-retired sighting
    f.next();
    const second = f.pass();                                   // 2nd — queues the release, still unsettled
    await vi.waitFor(() => expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(1));
    rmSync(path.join(f.reg, 'demo-a.hold'));                    // ccd's own unlink, already done on the box
    f.next(); await f.pass();                                   // a pass while still in flight — the eligible
                                                                 // branch's own first sighting lands HERE
    expect(f.requests, 'only the first eligible sighting so far').toEqual([]);
    expect(f.entryOf('demo-a'), 'the in-flight pass did record a sighting').toBeDefined();
    resolveRelease({ code: 0, stdout: 'released demo-a\n', stderr: '' });   // the answer, matching what already happened
    await second;
    expect(f.entryOf('demo-a'), 'the answer deleted the entry').toBeUndefined();
    f.next(); await f.pass();                                   // the FIRST pass after the answer — the mark is consumed
    expect(f.requests, 'never reclaimed one pass after the answer').toEqual([]);
    f.next(); await f.pass();                                   // a fresh first sighting
    expect(f.requests, 'never reclaimed on a sighting made before the answer').toEqual([]);
    f.next(); await f.pass();                                   // its second — only now
    expect(f.requests).toEqual([
      { sessionId: 'demo-a', runId: r1.id, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('a pass whose listing was read BEFORE the release answered seeds nothing after the answer — the reclaim still needs two fresh unheld passes', async () => {
    // The third interleaving: ccd unlinks the hold, the next pass READS the
    // registry (unheld), and only then does the release answer — before that
    // pass's own loop runs. The answer deletes the entry, but a loop running
    // on the older listing would seed a first sighting from it, and the very
    // next pass would dispatch. The answer's mark makes that loop seed nothing.
    let resolveRelease!: (v: { code: number; stdout: string; stderr: string }) => void;
    const f = fixture({ release: () => new Promise((resolve) => { resolveRelease = resolve; }) });
    const r1 = f.openRun(); f.abandon(r1);
    f.plant('demo-a', { child: String(r1.id), hold: holdReason(r1.program, 2, null, null) });
    await f.pass();                                            // 1st hold-retired sighting
    f.next();
    const second = f.pass();                                   // 2nd — queues the release, still unsettled
    await vi.waitFor(() => expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(1));
    rmSync(path.join(f.reg, 'demo-a.hold'));                    // ccd's own unlink, already done on the box
    f.next();
    const stale = await f.listing();                           // the next pass's registry read — BEFORE the answer
    resolveRelease({ code: 0, stdout: 'released demo-a\n', stderr: '' });
    await second;                                              // the answer lands between that read and its loop
    await f.sweepOn(stale);                                    // the pass's loop, on the listing older than the answer
    expect(f.entryOf('demo-a'), 'a listing older than the answer seeded nothing').toBeUndefined();
    f.next(); await f.pass();                                  // the FIRST fresh pass — a first sighting only
    expect(f.requests, 'never reclaimed on the strength of a listing older than the answer').toEqual([]);
    f.next(); await f.pass();                                  // the SECOND fresh pass — only now
    expect(f.requests).toEqual([
      { sessionId: 'demo-a', runId: r1.id, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('a release that FAILS after being in flight across TWO passes is not retried the very next pass, only the one after — and never double-queues while in flight', async () => {
    let resolveFirst!: (v: { code: number; stdout: string; stderr: string }) => void;
    let releaseCalls = 0;
    const f = fixture({
      release: () => {
        releaseCalls += 1;
        // Only the FIRST call is held open — this test controls exactly when
        // IT settles. A later retry (the "one after" step below) answers
        // immediately; it is not this case's own subject and must not hang
        // the test waiting on a resolver nothing ever calls.
        if (releaseCalls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
        return { code: 1, stdout: '', stderr: 'boom again' };
      },
    });
    // `ws-release` only fires once the release job actually RUNS, so while
    // the first job is still in flight (unresolved), counting `ws-release`
    // calls cannot tell a real re-entrancy guard from a second job merely
    // parked behind the first on the same `KeyedQueue` key. Spy on
    // `f.queue.run` itself — the enqueue point — to catch a double-queue the
    // moment it happens, not only once it eventually executes.
    const queueRuns: string[] = [];
    const realQueueRun = f.queue.run.bind(f.queue);
    vi.spyOn(f.queue, 'run').mockImplementation(((key: string, fn: () => Promise<unknown>) => {
      queueRuns.push(key);
      return realQueueRun(key, fn);
    }) as typeof f.queue.run);
    const r1 = f.openRun(); f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    await f.pass();                                            // 1st hold-retired sighting
    f.next();
    const second = f.pass();                                   // 2nd — queues the release, still unsettled
    await vi.waitFor(() => expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(1));
    f.next(); await f.pass();                                  // a SECOND pass while still in flight
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'never double-queues while the first release is still in flight')
      .toHaveLength(1);
    // A THIRD (4th overall) pass, still in flight. Awaiting `f.pass()`
    // directly here would hang under the very mutation this asserts against:
    // dropping the in-flight guard makes THIS pass the one that enqueues a
    // second job behind the still-unresolved first, on the same
    // `KeyedQueue` key — `sweepChildReclaim` then awaits that second job too,
    // which cannot settle until `resolveFirst` runs. So the decision (and any
    // enqueue it makes) is awaited via `passDispatched`, never the settle.
    f.next();
    const fourth = await f.passDispatched();
    expect(queueRuns.filter((k) => k === 'demo-a'), 'never re-enqueues demo-a while the first release is still in flight')
      .toHaveLength(1);
    resolveFirst({ code: 1, stdout: '', stderr: 'boom' });      // the release finally fails
    await fourth.settle;
    await second;
    f.next(); await f.pass();                                  // the very NEXT pass — must NOT retry yet
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'retried on the pass right after a failure').toHaveLength(1);
    f.next(); await f.pass();                                  // the ONE AFTER — retries now
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(2);
  });

  it('the sighting memory resets exactly like the ordinary one: an intervening OTHER-ineligible verdict needs two fresh sightings', async () => {
    // A verdict of the other kind starts a fresh sighting — the
    // OTHER-ineligible branch's own clear (a run of the programme reopens,
    // demoting the verdict from hold-retired to plain held, then it closes
    // again).
    const f = fixture();
    const r1 = f.openRun(); f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    await f.pass();                                            // 1st hold-retired sighting
    const r2raw = f.coord.openRun({ program: r1.program, title: r1.program, project: 'demo', wave: 2, waveOf: null,
      claimedBy: 'demo-coord' });
    if (!('id' in r2raw)) throw new Error(`openRun r2 refused: ${JSON.stringify(r2raw)}`);
    f.next(); await f.pass();                                  // the programme is open again — plain `held`
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
    f.abandon({ id: r2raw.id, program: r1.program });
    f.next(); await f.pass();                                  // hold-retired again — a FRESH 1st sighting
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'queued on one sighting after an intervening held pass')
      .toEqual([]);
    f.next(); await f.pass();                                  // …and its second — only now
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(1);
  });

  it('the sighting memory resets exactly like the ordinary one: an intervening ELIGIBLE verdict needs two fresh sightings', async () => {
    const f = fixture();
    const r1 = f.openRun(); f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    await f.pass();                                            // 1st hold-retired sighting
    rmSync(path.join(f.reg, 'demo-a.hold'));                    // the hold is removed entirely
    f.next(); await f.pass();                                   // fully eligible — its own 1st sighting
    expect(f.requests).toEqual([]);
    writeFileSync(path.join(f.reg, 'demo-a.hold'), reason);      // re-planted with the SAME accounted text
    f.next(); await f.pass();                                   // hold-retired again — a FRESH 1st sighting
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'queued on one sighting after an intervening eligible pass')
      .toEqual([]);
    f.next(); await f.pass();                                   // …and its second — only now
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(1);
  });

  it('the sighting memory resets on the mirror/coordinator-read pass-level fail-shut, exactly like the ordinary one', async () => {
    const f = fixture();
    const r1 = f.openRun(); f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    await f.pass();                                            // 1st hold-retired sighting
    const spy = vi.spyOn(f.coord, 'childReclaimCoordinatorClaims')
      .mockImplementation(() => { throw new Error('coordination history unreadable'); });
    f.next(); await f.pass();                                  // the whole pass fails shut
    spy.mockRestore();
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
    f.next(); await f.pass();                                  // hold-retired again — a FRESH 1st sighting
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'queued on one sighting after a fail-shut pass').toEqual([]);
    f.next(); await f.pass();                                  // …and its second — only now
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(1);
  });

  it('the sighting memory resets when reclaim-paused is raised then lowered, exactly like the ordinary one', async () => {
    const f = fixture();
    const r1 = f.openRun(); f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    await f.pass();                                            // 1st hold-retired sighting
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.next(); await f.pass();                                  // paused: the switches' early return
    rmSync(path.join(f.reg, 'reclaim-paused'));
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
    f.next(); await f.pass();                                  // hold-retired again — a FRESH 1st sighting
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'queued on one sighting after the pause lowered').toEqual([]);
    f.next(); await f.pass();                                  // …and its second — only now
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(1);
  });

  // The release answer's mark is cleared by the same three resets as the sighting memory. A mark that survived one
  // would be consumed by the child's next eligible verdict, landing the reclaim one pass LATER than the two fresh
  // passes every reset otherwise costs — each case below stands a mark, resets, and counts exactly two.
  it('the release answer\'s mark is cleared by the mirror/coordinator-read pass-level fail-shut — two fresh passes, not three', async () => {
    const f = fixture();
    const runId = await releasedChild(f);                     // a mark stands
    const spy = vi.spyOn(f.coord, 'childReclaimCoordinatorClaims')
      .mockImplementation(() => { throw new Error('coordination history unreadable'); });
    f.next(); await f.pass();                                  // the whole pass fails shut
    spy.mockRestore();
    f.next(); await f.pass();                                  // the FIRST fresh pass — a first sighting
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();                                  // the SECOND — the request
    expect(f.requests, 'the mark outlived the fail-shut').toEqual([
      { sessionId: 'demo-a', runId, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('the release answer\'s mark is cleared when reclaim-paused is raised then lowered — two fresh passes, not three', async () => {
    const f = fixture();
    const runId = await releasedChild(f);                     // a mark stands
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.next(); await f.pass();                                  // paused: the switches' early return
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();                                  // the FIRST fresh pass — a first sighting
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();                                  // the SECOND — the request
    expect(f.requests, 'the mark outlived the pause').toEqual([
      { sessionId: 'demo-a', runId, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('the release answer\'s mark leaves with its row: listed again, the child needs two fresh passes, not three', async () => {
    const f = fixture();
    const runId = await releasedChild(f);                     // a mark stands
    for (const n of readdirSync(f.reg)) if (n.startsWith('demo-a.')) rmSync(path.join(f.reg, n));
    f.next(); await f.pass();                                  // the row is gone: the vanished-row loop
    f.plant('demo-a', { child: String(runId) });              // the same id listed again, unheld
    f.next(); await f.pass();                                  // the FIRST fresh pass — a first sighting
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();                                  // the SECOND — the request
    expect(f.requests, 'the mark outlived its row').toEqual([
      { sessionId: 'demo-a', runId, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('a box that does not advertise ws-release never releases the hold — gated exactly as the close route gates it', async () => {
    const f = fixture({ releaseCap: false });
    const r1 = f.openRun();
    f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    const r2raw = f.coord.openRun({ program: r1.program, title: r1.program, project: 'demo', wave: 2, waveOf: null,
      claimedBy: 'demo-coord' });
    if (!('id' in r2raw)) throw new Error(`openRun r2 refused: ${JSON.stringify(r2raw)}`);
    f.abandon({ id: r2raw.id, program: r1.program });
    for (let i = 0; i < 6; i += 1) { f.next(); await f.pass(); }
    expect(f.requests).toEqual([]);
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
  });

  it('sweep-level (iv): the deciding pass queues the job on OLD evidence; the job\'s OWN re-read catches the hold text changing before it ever runs', async () => {
    // The job's own `child-reclaim.test.ts` unit cases prove this check in
    // isolation. This proves the SAME check fires when the job is reached
    // the way it is in production: queued by a real sweep pass, off a real
    // registry snapshot the job never gets to see again. `demo-a`'s own
    // `KeyedQueue` slot is occupied FIRST, so the queued job is registered
    // behind it and cannot start its own body — including its first read —
    // until this test releases it; the deciding pass's registry read and its
    // entire (synchronous, once resolved) per-child loop run to completion
    // well before that, on real fs I/O against a local filesystem.
    const f = fixture();
    const r1 = f.openRun(); f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    await f.pass();                                            // 1st hold-retired sighting
    f.next();
    let releaseQueue!: () => void;
    const occupied = f.queue.run('demo-a', () => new Promise<void>((resolve) => { releaseQueue = resolve; }));
    // A bounded real-time wait here could pass vacuously if the deciding
    // pass had not yet reached its enqueue when the timer fired — spy on
    // `f.queue.run` itself so the await resolves exactly when the job for
    // `demo-a` is queued (behind the occupier), never on a guessed delay.
    const realRun = f.queue.run.bind(f.queue);
    let queued!: () => void;
    const releaseQueued = new Promise<void>((resolve) => { queued = resolve; });
    vi.spyOn(f.queue, 'run').mockImplementation(((key: string, fn: () => Promise<unknown>) => {
      const p = realRun(key, fn);
      if (key === 'demo-a') queued();          // the deciding pass decided hold-retired and queued the job, on OLD evidence
      return p;
    }) as typeof f.queue.run);
    const second = f.pass();                                   // 2nd — queues the release BEHIND the occupier
    await releaseQueued;                                       // replaces the 100 ms wait
    writeFileSync(path.join(f.reg, 'demo-a.hold'), 'a human wrote this over it');
    releaseQueue();
    await occupied;
    await second;
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'no argv composed — the job\'s own byte re-check disagreed')
      .toEqual([]);
    // The row's own text no longer matches any candidate's rendering at all,
    // so it now reads as an ordinary, unconditional `held` — never
    // hold-retired again, and never reclaimed.
    f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
  });

  it('sweep-level (v): the deciding pass queues the job while the programme reads zero open runs; a run of it opens before the job\'s OWN re-count runs', async () => {
    const f = fixture();
    const r1 = f.openRun(); f.abandon(r1);
    const reason = holdReason(r1.program, 2, null, null);
    f.plant('demo-a', { child: String(r1.id), hold: reason });
    await f.pass();                                            // 1st hold-retired sighting
    f.next();
    let releaseQueue!: () => void;
    const occupied = f.queue.run('demo-a', () => new Promise<void>((resolve) => { releaseQueue = resolve; }));
    // See (iv)'s own comment: an event-driven wait on the enqueue itself,
    // never a bounded real-time guess that could pass vacuously.
    const realRun = f.queue.run.bind(f.queue);
    let queued!: () => void;
    const releaseQueued = new Promise<void>((resolve) => { queued = resolve; });
    vi.spyOn(f.queue, 'run').mockImplementation(((key: string, fn: () => Promise<unknown>) => {
      const p = realRun(key, fn);
      if (key === 'demo-a') queued();          // the deciding pass decided hold-retired and queued the job, on OLD evidence
      return p;
    }) as typeof f.queue.run);
    const second = f.pass();                                   // 2nd — queues the release BEHIND the occupier
    await releaseQueued;                                       // replaces the 100 ms wait
    const r2raw = f.coord.openRun({ program: r1.program, title: r1.program, project: 'demo', wave: 2, waveOf: null,
      claimedBy: 'demo-coord' });
    if (!('id' in r2raw)) throw new Error(`openRun r2 refused: ${JSON.stringify(r2raw)}`);
    releaseQueue();
    await occupied;
    await second;
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'no argv composed — the job\'s own count re-check disagreed')
      .toEqual([]);
    // The hold is still held — still `program`, now genuinely protecting
    // again, since the programme really is open.
    f.abandon({ id: r2raw.id, program: r1.program });
    f.next(); await f.pass();                                  // a FRESH 1st sighting
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
    f.next(); await f.pass();
    expect(f.calls.filter((c) => c[0] === 'ws-release')).toHaveLength(1);
  });

  it('a child whose CURRENT generation has coordinated a run is never reclaimed automatically', async () => {
    // Its claim closes at its own `create`'s instant (the fixture clock does
    // not move), inside the coordination fence's skew: this generation's own.
    const f = fixture();
    const r1 = f.openRun();
    f.abandon(r1);
    f.plant('demo-a', { child: String(r1.id) });
    const coordRun = f.coord.openRun({ program: 'other-prog', title: 'other-prog', project: 'demo', wave: 1,
      waveOf: null, claimedBy: 'demo-a' });
    if (!('id' in coordRun)) throw new Error(`coordRun refused: ${JSON.stringify(coordRun)}`);
    f.abandon({ id: coordRun.id, program: 'other-prog' });
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
  });

  it('the run-id fence: a marker naming a run opened well after the child\'s own birth is skipped, with one log line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fixture();
    f.plant('demo-a');
    f.advance(CHILD_BIRTH_SKEW_MS + 10_000);
    const late = f.openRun();
    f.abandon(late);
    writeFileSync(path.join(f.reg, 'demo-a.child'), String(late.id));
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('demo-a') && l.includes('postdates'));
    expect(lines).toHaveLength(1);
  });

  it('the run-id fence is UNCAPPED: a child with more than 500 newer lifecycle rows is still placed', async () => {
    const f = fixture();
    const runId = finishedChild(f);
    for (let i = 0; i < 510; i += 1) f.journal('demo-a', 'refused', 'attached');
    await f.pass(); f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']);
    void runId;
  });

  it('does nothing while reclaim-paused stands, and needs two FRESH passes once it is lowered', async () => {
    const f = fixture();
    finishedChild(f);
    await f.pass();                                           // first sighting
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.next(); await f.pass();                                 // paused: nothing, memory cleared
    expect(f.requests).toEqual([]);
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();                                 // a first sighting again
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('does nothing on a fleet host that does not advertise reclaim-v1 — and still REPORTS', async () => {
    const f = fixture({ cap: false });
    finishedChild(f);
    finishedChild(f, 'demo-b');
    f.journal('demo-b', 'refused', 'tree-unreadable');
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    await f.watcher.tick();
    expect(attentionLabels(f)).toEqual(['terminal:demo-b']);
  });

  it('does nothing on a box that advertises reclaim-v1 but not reclaim-pause-v1, and still REPORTS', async () => {
    const f = fixture({ pauseCap: false });
    finishedChild(f);
    finishedChild(f, 'demo-b');
    f.journal('demo-b', 'refused', 'tree-unreadable');
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    await f.watcher.tick();
    expect(attentionLabels(f)).toEqual(['terminal:demo-b']);
  });

  it('passes deferExpired only once a PRESENCE defer has lasted the ceiling — and hands the executor when deferral began', async () => {
    const f = fixture({ outcome: (req) => deferredAs('presence', req) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → deferred; BOTH clocks start NOW
    const deferredAt = f.now();
    // Presence answered on EVERY pass, exactly one interval apart, so the
    // episode is continuous (spec §5.7) — every request inside the ceiling.
    while (f.now() + CHILD_RECLAIM_SWEEP_MS < deferredAt + CHILD_RECLAIM_DEFER_CEILING_MS) {
      f.advance(CHILD_RECLAIM_SWEEP_MS); await f.pass();
    }
    const inside = f.requests.length;
    expect(inside, 'fourteen more presence answers inside the ceiling').toBe(15);
    f.advance(deferredAt + CHILD_RECLAIM_DEFER_CEILING_MS - f.now()); await f.pass();   // the next request, AT it — LICENSED
    expect(f.requests.map((q) => [q.deferExpired, q.deferredSinceMs])).toEqual([
      [false, null], ...Array.from({ length: inside - 1 }, () => [false, deferredAt]), [true, deferredAt]]);
    // The licensed request STILL came back presence-class:
    // `childReclaimNextEntry`'s own rule (spec §5.7, "Presence, and its
    // bound") RESTARTS the episode at that answer's arrival (the request's
    // own instant here: the stub answers at once), rather
    // than silently keeping the ceiling exhausted forever — a licensed
    // attempt that finds someone still there must get a fresh 15 minutes,
    // not an immediate second bypass.
    expect(f.entryOf('demo-a')).toMatchObject({ firstDeferredAt: deferredAt, firstPresenceDeferredAt: f.mono(),
      lastPresenceDeferredAt: f.mono() });
  });

  it('a non-presence defer starts the any-kind clock, which the request carries, and never the ceiling', async () => {
    const f = fixture({ outcome: (req) => deferredAs('state-changed', req) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → state-changed
    const deferredAt = f.now();
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS + 1); await f.pass();   // request 2, a ceiling later
    expect(f.requests.map((q) => [q.deferExpired, q.deferredSinceMs])).toEqual([[false, null], [false, deferredAt]]);
    expect(f.entryOf('demo-a')).toMatchObject({ firstDeferredAt: deferredAt, firstPresenceDeferredAt: null });
  });

  it('keeps TWO clocks: deferredSinceMs is the first deferral of ANY kind, the ceiling counts PRESENCE alone', async () => {
    let asked = 0;
    const f = fixture({ outcome: (req) => { asked += 1; return deferredAs(asked === 1 ? 'state-changed' : 'presence', req); } });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → state-changed: the ANY-kind clock starts
    const firstDefer = f.now();
    f.advance(CHILD_RECLAIM_SWEEP_MS); await f.pass();        // request 2 → presence: the presence clock starts
    const firstPresence = f.now();
    // Presence answered on EVERY pass from here, one interval apart — a
    // continuous episode (spec §5.7) — up to a ceiling after the FIRST deferral.
    while (f.now() < firstDefer + CHILD_RECLAIM_DEFER_CEILING_MS) { f.advance(CHILD_RECLAIM_SWEEP_MS); await f.pass(); }
    expect(f.now(), 'the last of these requests is a ceiling after the FIRST deferral')
      .toBe(firstDefer + CHILD_RECLAIM_DEFER_CEILING_MS);
    const atAnyKindCeiling = f.requests.length;
    expect(f.requests[atAnyKindCeiling - 1]?.deferExpired, 'a ceiling of the ANY-kind clock licenses nothing').toBe(false);
    f.advance(firstPresence + CHILD_RECLAIM_DEFER_CEILING_MS - f.now()); await f.pass();  // the next: a ceiling of PRESENCE — LICENSED
    expect(f.requests.map((q) => [q.deferExpired, q.deferredSinceMs])).toEqual([
      [false, null], ...Array.from({ length: atAnyKindCeiling - 1 }, () => [false, firstDefer]), [true, firstDefer]]);
    // The licensed request still came back presence-class:
    // `childReclaimNextEntry`'s rule (spec §5.7) restarts the episode at
    // that answer's arrival (the request's own instant here).
    expect(f.entryOf('demo-a')).toMatchObject({ firstDeferredAt: firstDefer, firstPresenceDeferredAt: f.mono(),
      lastPresenceDeferredAt: f.mono() });
  });

  it('never dispatches a child twice while its reclaim is still in flight', async () => {
    // With one slot, an in-flight child holds the slot itself, so the bound
    // alone would hide a missing in-flight check. So demo-a's request never
    // settles and outlives CHILD_RECLAIM_STALL_MS — it stops counting against
    // the bound — and a second child, demo-b, proves the slot really is free:
    // only the in-flight check is left to keep demo-a from being asked again.
    const f = fixture({ outcome: (req) => (req.sessionId === 'demo-a'
      ? new Promise<ChildReclaimOutcome>(() => { /* never resolves, deliberately */ })
      : { kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 }) });
    finishedChild(f, 'demo-a');
    f.next(); finishedChild(f, 'demo-b');
    await f.pass(); f.next();
    void f.pass();                                            // dispatches demo-a, which never answers
    await vi.waitFor(() => expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']));
    // Each later pass is OBSERVED, never awaited: a re-asked demo-a would
    // never settle and would hang an awaited pass, turning this case's red
    // into a timeout. The pass either finishes or makes a new request, and
    // the assertion after it decides which.
    const observedPass = async (): Promise<void> => {
      const before = f.requests.length;
      let settled = false;
      void f.pass().then(() => { settled = true; });
      await vi.waitFor(() => expect(settled || f.requests.length > before).toBe(true));
    };
    f.advance(CHILD_RECLAIM_STALL_MS + 1); f.next();
    await observedPass();                                     // the slot is free: demo-b, never demo-a
    expect(f.requests.map((q) => q.sessionId), 'demo-a was asked again while still in flight')
      .toEqual(['demo-a', 'demo-b']);
    f.next();
    await observedPass();                                     // and not on a later pass either
    expect(f.requests.map((q) => q.sessionId), 'demo-a was asked again while still in flight')
      .toEqual(['demo-a', 'demo-b']);
  });

  it('drops an answer that comes back after a pass cleared the memory — the pause still needs two FRESH passes', async () => {
    let release!: () => void;
    // Only the FIRST dispatch hangs (controlled by `release`, below); every
    // later one resolves immediately, so the trailing passes can be awaited
    // directly without a second, uncontrolled hang.
    let calls = 0;
    const answer = (req: ChildReclaimRequest): ChildReclaimOutcome =>
      ({ kind: 'failed', sessionId: req.sessionId, runId: req.runId, resume: 'resumable', detail: 'ccd exited 1' });
    const f = fixture({ outcome: (req) => {
      calls += 1;
      if (calls > 1) return answer(req);
      return new Promise<ChildReclaimOutcome>((resolve) => { release = () => resolve(answer(req)); });
    } });
    finishedChild(f);
    await f.pass(); f.next();
    const first = f.pass();                                   // request 1, in flight
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.next(); await f.pass();                                 // paused: memory cleared
    release();
    await first;                                              // `failed` comes back to a cleared map
    expect(f.entryOf('demo-a')).toBeUndefined();
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();                                 // a FIRST sighting, not a second
    expect(f.requests).toHaveLength(1);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(2);
  });

  it('backs off a child whose reclaim keeps failing: min(ceiling, pass interval × 2^k) after the k-th failure', async () => {
    const f = fixture({ outcome: (req) => ({ kind: 'failed', sessionId: req.sessionId, runId: req.runId, resume: 'resumable', detail: 'ccd exited 1' }) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → failed: k = 1, wait 2 intervals
    expect(f.requests).toHaveLength(1);
    expect(f.entryOf('demo-a')?.consecutiveFailures).toBe(1);
    f.next(); await f.pass();                                 // one interval later: backing off
    expect(f.requests, 'asked again inside the backoff').toHaveLength(1);
    f.next(); await f.pass();                                 // two intervals (+2 ms) later: asked
    expect(f.requests).toHaveLength(2);
    expect(f.entryOf('demo-a')?.consecutiveFailures).toBe(2);
    for (let i = 0; i < 3; i += 1) { f.next(); await f.pass(); }   // k = 2: four intervals; three passes wait
    expect(f.requests).toHaveLength(2);
    f.next(); await f.pass();                                 // the fourth pass asks
    expect(f.requests).toHaveLength(3);
  });

  it('two passes after a terminal refusal make no second request', async () => {
    const f = fixture({ outcome: (req) => ({ kind: 'refused', sessionId: req.sessionId, runId: req.runId,
      token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), detail: '' }) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
    f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests, 'a terminal refusal is not retried on the ordinary pass cadence').toHaveLength(1);
  });

  it('a licensed request refused with no mirror line → the next request carries deferExpired: false', async () => {
    // The ceiling licensed a presence-class attempt; the box answered a
    // TERMINAL refusal instead — the presence episode's own clock is cleared
    // by ANY non-presence outcome, refusals included, so the entry a much
    // later pass reads (once the terminal-refusal wait has itself elapsed)
    // starts a fresh episode.
    const f = fixture({ outcome: (req) => (req.deferExpired
      ? { kind: 'refused', sessionId: req.sessionId, runId: req.runId, token: 'tree-unreadable',
          sentence: refusalSentence('tree-unreadable'), detail: '' }
      : deferredAs('presence', req)) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → presence
    const deferredAt = f.now();
    // Presence answered on EVERY pass, one interval apart, inside the ceiling.
    while (f.now() + CHILD_RECLAIM_SWEEP_MS < deferredAt + CHILD_RECLAIM_DEFER_CEILING_MS) {
      f.advance(CHILD_RECLAIM_SWEEP_MS); await f.pass();
    }
    f.advance(deferredAt + CHILD_RECLAIM_DEFER_CEILING_MS - f.now()); await f.pass();  // AT the ceiling: licensed → refused
    const licensed = f.requests.length;
    expect(f.requests.map((q) => q.deferExpired)).toEqual([...Array.from({ length: licensed - 1 }, () => false), true]);
    expect(f.entryOf('demo-a'), 'the refusal ended the presence episode')
      .toMatchObject({ firstPresenceDeferredAt: null, lastPresenceDeferredAt: null });
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS + 1); await f.pass();  // due again on the terminal-refusal wait
    expect(f.requests).toHaveLength(licensed + 1);
    expect(f.requests[licensed]?.deferExpired, 'the refusal ended the presence episode; nothing is licensed again').toBe(false);
  });

  it('an executor `failed` with no mirror line is retried with backoff and never listed', async () => {
    const f = fixture({ outcome: (req) => ({ kind: 'failed', sessionId: req.sessionId, runId: req.runId,
      resume: 'not-resumable', detail: 'ws-audit --reclaim answered nothing readable' }) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests, 'backing off, not asked yet').toHaveLength(1);
    f.next(); await f.pass();
    expect(f.requests, 'a retryable failure keeps being retried').toHaveLength(2);
  });

  describe('the in-flight bound', () => {
    it('three finished children → one request, none while it is in flight, and the second after it settles', async () => {
      let release!: () => void;
      let calls = 0;
      const answer = (req: ChildReclaimRequest): ChildReclaimOutcome =>
        ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 });
      const f = fixture({ outcome: (req) => {
        calls += 1;
        if (calls > 1) return answer(req);
        return new Promise<ChildReclaimOutcome>((resolve) => { release = () => resolve(answer(req)); });
      } });
      finishedChild(f, 'demo-a'); finishedChild(f, 'demo-b'); finishedChild(f, 'demo-c');
      await f.pass(); f.next();
      const p1 = f.pass();
      await vi.waitFor(() => expect(f.requests).toHaveLength(1));
      f.next(); await f.pass();
      expect(f.requests, 'the bound holds the other two children back').toHaveLength(1);
      release();
      await p1;
      f.next(); await f.pass();
      expect(f.requests).toHaveLength(2);
    });

    it('A defers every time and B reclaims → B is asked on the pass after A\'s first request (fairness sort)', async () => {
      const f = fixture({ outcome: (req) => (req.sessionId === 'demo-a'
        ? deferredAs('state-changed', req)
        : { kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 }) });
      finishedChild(f, 'demo-a');
      await f.pass();                                            // A: first sighting
      f.next(); finishedChild(f, 'demo-b');
      await f.pass();                                            // A: due (2nd sighting); B: first sighting
      expect(f.requests.map((q) => q.sessionId), 'A goes first (older sighting), and defers').toEqual(['demo-a']);
      f.next(); await f.pass();
      // demo-a's lastAskedAt is now set (non-null, from its deferral above);
      // demo-b's is still null — null sorts FIRST, so B overtakes A even
      // though A was sighted earlier.
      expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a', 'demo-b']);
    });

    it('two NEVER-ASKED children: the one sighted EARLIER goes first, not the lower id', async () => {
      // `lastAskedAt` ties (both null) fall through to `firstEligibleAt` — a
      // steady supply of freshly-minted lower-id children must not starve an
      // older never-asked one. `demo-z` sorts AFTER `demo-a` by id alone, so
      // this only passes when the tie-break actually reaches `firstEligibleAt`.
      let releaseBusy!: () => void;
      const f = fixture({ outcome: (req) => (req.sessionId === 'demo-busy'
        ? new Promise<ChildReclaimOutcome>((resolve) => {
            releaseBusy = () => resolve({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 });
          })
        : { kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 }) });
      finishedChild(f, 'demo-busy');
      await f.pass();                                            // demo-busy: first sighting
      f.next();
      const busyDispatch = f.pass();                              // dispatches demo-busy; occupies the one slot
      await vi.waitFor(() => expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-busy']));
      finishedChild(f, 'demo-z');
      f.next(); await f.pass();                                  // demo-z: first sighting (slot still busy)
      finishedChild(f, 'demo-a');
      f.next(); await f.pass();                                  // demo-z: due (2nd sighting); demo-a: first sighting
      expect(f.requests.map((q) => q.sessionId), 'slot still busy — neither z nor a dispatched yet').toEqual(['demo-busy']);
      f.next(); await f.pass();                                  // demo-z AND demo-a both due now; slot still busy
      expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-busy']);
      releaseBusy();
      await busyDispatch;                                        // demo-busy's in-flight bookkeeping is cleared
      f.next(); await f.pass();                                  // the slot frees: demo-z (sighted first) goes before demo-a
      expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-busy', 'demo-z']);
    });

    it('a request that never settles: after CHILD_RECLAIM_STALL_MS, the next child is asked anyway', async () => {
      const f = fixture({ outcome: (req) => (req.sessionId === 'demo-a'
        ? new Promise<ChildReclaimOutcome>(() => { /* never resolves, deliberately */ })
        : { kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 }) });
      finishedChild(f, 'demo-a');
      f.next(); finishedChild(f, 'demo-b');
      await f.pass(); f.next();
      // demo-a's promise never settles: the dispatching pass must be
      // fire-and-forget, never directly awaited (it would hang forever on its
      // own `Promise.all`), and its effect is observed by polling instead.
      void f.pass();
      await vi.waitFor(() => expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']));
      f.advance(CHILD_RECLAIM_STALL_MS - 1); await f.pass();
      expect(f.requests, 'still within the stall bound').toHaveLength(1);
      f.advance(2); f.next(); await f.pass();
      expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a', 'demo-b']);
      void CHILD_RECLAIM_MAX_IN_FLIGHT;
    });
  });
});

describe('fail-shut on the pass-level reads — a throw stops the WHOLE pass, not just one child', () => {
  it('a throwing childReclaimCoordinatorClaims read: no request to anyone, the entry is cleared, and a clean read needs two FRESH passes', async () => {
    const f = fixture();
    finishedChild(f);
    await f.pass(); f.next();
    // Sighted once already — the next ordinary pass would dispatch.
    const spy = vi.spyOn(f.coord, 'childReclaimCoordinatorClaims')
      .mockImplementation(() => { throw new Error('coordination history unreadable'); });
    await f.pass();
    expect(f.requests).toEqual([]);
    expect(f.entryOf('demo-a')).toBeUndefined();
    spy.mockRestore();
    f.next(); await f.pass();                                 // a first sighting again, not a second
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('a throwing mirror read: no request to anyone, the entry is cleared, and the attention list keeps its LAST value rather than going dark', async () => {
    const f = fixture();
    const runId = finishedChild(f);
    // A SECOND, TERMINAL-refused child, so the attention list is NON-EMPTY
    // before the throw — the single-child version of this case could not
    // tell "kept its last value" apart from "stayed empty either way",
    // because its only planted child had nothing to report yet.
    const termRunId = finishedChild(f, 'demo-term');
    f.journal('demo-term', 'refused', 'tree-unreadable');
    // A RETRYABLE reclaim row (not terminal) on the child under test, so
    // `childReclaimSessionIds()` includes it and the mirror read the try
    // wraps is genuinely exercised for it: a TERMINAL refusal on THIS child
    // would make "no request" true whether or not the read throws, since a
    // terminal child is never due — the case this replaces asserted exactly
    // that and could not fail.
    f.journal('demo-a', 'failed', 'pin-failed');
    await f.pass();                                           // 1st eligible sighting
    // Read the attention list at the SAME clock this pass just stamped —
    // `tick()` void-dispatches its own `sweepChildReclaim`, and calling it at
    // an ALREADY-elapsed clock (after `f.next()`, before the next explicit
    // pass) would let that unawaited dispatch fire the second, throwing pass
    // for us, in the background, before the spy below is even installed.
    await f.watcher.tick();
    const before = f.watcher.currentCoord()?.childReclaimAttention;
    expect(before).toEqual([{
      kind: 'terminal', sessionId: 'demo-term', runId: termRunId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at: T0,
    }]);
    f.next();
    // Sighted once already — the next ordinary pass would dispatch.
    const spy = vi.spyOn(f.coord, 'lifecycleFor')
      .mockImplementation(() => { throw new Error('mirror unreadable'); });
    await f.pass();
    expect(f.requests).toEqual([]);
    expect(f.entryOf('demo-a')).toBeUndefined();
    await f.watcher.tick();                                   // same clock as the pass just above — no side dispatch
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual(before);
    spy.mockRestore();
    f.next(); await f.pass();                                 // a first sighting again, not a second
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests).toEqual([{ sessionId: 'demo-a', runId, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });
});

describe('the attention list — derived from the mirror, carried on the coord frame', () => {
  it('reports a terminal refusal with the server sentence, and never retries that child', async () => {
    const f = fixture();
    const runId = finishedChild(f);
    f.journal('demo-a', 'refused', 'tree-unreadable');
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([{
      kind: 'terminal', sessionId: 'demo-a', runId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at: T0,
    }]);
  });

  it('an AUDIT-TIME terminal refusal reaches the mirror through ws-audit\'s own line — listed, never retried, kept across a restart', async () => {
    const f = fixture({ outcome: (req) => ({ kind: 'refused', sessionId: req.sessionId, runId: req.runId,
      token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), detail: 'audit: tree-unreadable' }) });
    const runId = finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → refused, terminally, at the audit
    expect(f.requests).toHaveLength(1);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention, 'an executor answer fed the frame').toEqual([]);
    f.journal('demo-a', 'refused', 'tree-unreadable', 'reclaim', 'ws-audit');
    const refusedAt = f.now();
    expect(f.latestOf('demo-a')).toMatchObject({ sessionId: 'demo-a', outcome: 'refused', refusal: 'tree-unreadable' });
    for (let i = 0; i < 4; i += 1) { f.next(); await f.pass(); }
    expect(f.requests, 'retried a terminal refusal').toHaveLength(1);
    await f.watcher.tick();
    const item = { kind: 'terminal', sessionId: 'demo-a', runId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at: refusedAt };
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([item]);
    const g = fixture({ coord: f.coord, home: f.home });
    await g.pass(); g.next(); await g.pass(); g.next(); await g.pass();
    expect(g.requests, 'a restart retried a terminal refusal').toEqual([]);
    await g.watcher.tick();
    expect(g.watcher.currentCoord()?.childReclaimAttention).toEqual([item]);
  });

  it('a recycled id does not inherit an old child\'s terminal refusal — and its own is still listed', async () => {
    const f = fixture({ outcome: (req) => ({ kind: 'refused', sessionId: req.sessionId, runId: req.runId,
      token: 'containment-unproven', sentence: refusalSentence('containment-unproven'), detail: 'nested repo' }) });
    f.journal('demo-a', 'done', null, 'create');              // the OLD workspace
    f.journal('demo-a', 'refused', 'tree-unreadable');
    const runId = finishedChild(f);                           // the NEW one — `plant` journals its create
    expect(f.latestOf('demo-a')).toBeNull();
    await f.pass(); f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
    f.advance(1);
    f.journal('demo-a', 'refused', 'containment-unproven');   // the NEW workspace's own refusal
    const at = f.now();
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([{
      kind: 'terminal', sessionId: 'demo-a', runId, token: 'containment-unproven', sentence: refusalSentence('containment-unproven'), at,
    }]);
  });

  it('keeps retrying a RETRYABLE refusal, and never lists it', async () => {
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'refused', 'attached');
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
  });

  it('an INTENT newer than the refusal lists nothing — the latest reclaim event of ANY outcome decides', async () => {
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'refused', 'containment-unproven');
    f.journal('demo-a', 'intent', null);
    expect(f.latestOf('demo-a')).toMatchObject({ outcome: 'intent', refusal: null });
    await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
    f.journal('demo-a', 'refused', 'containment-unproven');   // the attempt answered
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention.map((a) => (a.kind === 'terminal' || a.kind === 'failing' ? a.token : null))).toEqual(['containment-unproven']);
  });

  it('drops the child once its registry row is gone', async () => {
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'refused', 'tree-unreadable');
    await f.pass();
    for (const n of readdirSync(f.reg)) if (n.startsWith('demo-a.')) rmSync(path.join(f.reg, n));
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
  });

  it('survives a restart: a new watcher over the same database rebuilds it on its first pass', async () => {
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'refused', 'tree-unreadable');
    const g = fixture({ coord: f.coord, home: f.home });
    await g.pass();
    await g.watcher.tick();
    expect(attentionLabels(g)).toEqual(['terminal:demo-a']);
  });

  it('lists a child whose reclaim has kept FAILING past the ceiling, with the failure\'s sentence — and keeps asking for it', async () => {
    const f = fixture();
    const runId = finishedChild(f);
    f.journal('demo-a', 'failed', 'pin-failed');
    const since = f.now();
    await f.pass();                                           // a first sighting; failing for 0 ms
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention, 'listed before the ceiling').toEqual([]);
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    f.journal('demo-a', 'intent', null);
    f.journal('demo-a', 'failed', 'pin-failed');              // still failing, a ceiling later
    await f.pass();                                           // listed — AND asked for: the second sighting
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([{
      kind: 'failing', sessionId: 'demo-a', runId, token: 'pin-failed',
      sentence: childReclaimFailingSentence(lcRefusalWord('pin-failed') ?? refusalSentence('pin-failed')), at: since,
    }]);
    expect(f.requests.map((q) => q.sessionId), 'a failing child was excluded like a terminal refusal').toEqual(['demo-a']);
  });

  // ccd journals a pre-lock die as `refused <token>` (it has no `failed` line for it), and the executor
  // reads that same die as a failure the sweep retries (spec §5.9): so the report lists the run of them
  // as failing, never as a settled refusal — and the lane keeps asking, as it does for any failure.
  const lockDieFixture = () => fixture({ outcome: (req) => ({ kind: 'failed', sessionId: req.sessionId, runId: req.runId,
    resume: 'pre-lock-die', detail: 'flock (util-linux) is unavailable — refusing to run the destructive verb unserialised' }) });

  it('a child whose lock die is journaled as a pre-lock refusal is listed FAILING past the ceiling, with the failure\'s sentence', async () => {
    const f = lockDieFixture();
    const runId = finishedChild(f);
    f.journal('demo-a', 'refused', 'flock-unavailable');
    const since = f.now();
    await f.pass();                                           // a first sighting; failing for 0 ms
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention, 'listed before the ceiling').toEqual([]);
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    f.journal('demo-a', 'refused', 'flock-unavailable');      // still dying at the lock, a ceiling later
    await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([{
      kind: 'failing', sessionId: 'demo-a', runId, token: 'flock-unavailable',
      sentence: childReclaimFailingSentence(lcRefusalWord('flock-unavailable')), at: since,
    }]);
  });

  it('…and a child whose lock die is journaled as a pre-lock refusal is still ASKED again after its backoff, never excluded as a terminal refusal', async () => {
    const f = lockDieFixture();
    finishedChild(f);
    f.journal('demo-a', 'refused', 'flock-unavailable');
    await f.pass();
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    f.journal('demo-a', 'refused', 'flock-unavailable');
    await f.pass();                                           // the second sighting: asked
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']);
    f.next(); await f.pass();                                 // backing off after the failure
    expect(f.requests, 'asked again inside the backoff').toHaveLength(1);
    f.next(); await f.pass();                                 // …and asked again once it has elapsed
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a', 'demo-a']);
  });

  // The list is derived BEFORE the lane learns whether it may act, so a
  // failing child stays listed while `reclaim-paused` stands — and nothing
  // retries it then. Its sentence must be true in that state: no
  // unconditional claim that ccrc is retrying.
  it('a failing child listed while reclaim-paused stands is not said to be retried, and is not asked for', async () => {
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'failed', 'pin-failed');
    await f.pass();
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    f.journal('demo-a', 'intent', null);
    f.journal('demo-a', 'failed', 'pin-failed');
    f.next(); await f.pass();
    f.next(); await f.pass();
    await f.watcher.tick();
    const listed = f.watcher.currentCoord()?.childReclaimAttention ?? [];
    expect(attentionLabels(f)).toEqual(['failing:demo-a']);
    expect(listed[0]!.sentence).not.toMatch(/keeps retrying/);
    expect(listed[0]!.sentence).toContain('While automatic reclamation is running, ccrc retries it');
    expect(f.requests, 'the paused lane asked for the child it lists').toEqual([]);
  });

  // `refusalSentence`'s table is a plain object literal: a failure token
  // spelled like an `Object.prototype` member must render the ordinary
  // fallback, never a function's source text.
  it('a failure token spelled `constructor` renders the fallback sentence, not a function\'s source', async () => {
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'failed', 'constructor');
    await f.pass();
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    f.journal('demo-a', 'intent', null);
    f.journal('demo-a', 'failed', 'constructor');
    await f.pass();
    await f.watcher.tick();
    const listed = f.watcher.currentCoord()?.childReclaimAttention ?? [];
    expect(listed.map((a) => a.sentence)).toEqual([childReclaimFailingSentence('ccrc declined: constructor.')]);
    expect(listed[0]!.sentence).not.toMatch(/function|native code/);
  });

  it('reads a run of failures within the current generation: an earlier workspace\'s failures under a recycled id do not count', async () => {
    const f = fixture();
    f.journal('demo-a', 'done', null, 'create');              // the OLD workspace
    f.journal('demo-a', 'failed', 'pin-failed');
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    finishedChild(f);                                         // the NEW demo-a — `plant` journals its create
    f.journal('demo-a', 'failed', 'pin-failed');
    expect(f.latestOf('demo-a')).toMatchObject({ outcome: 'failed', failingSince: f.now() });
    await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
  });

  it('survives its own create scrolling out of the 500-row window', async () => {
    // WITHOUT the window/creates merge, the create row falls out of
    // `lifecycleFor`'s own 500-newest-row window, `childReclaimGeneration`
    // finds no evidence at all, and this terminal refusal — which IS still
    // inside the window — silently stops being listed.
    const f = fixture();
    const runId = finishedChild(f);
    for (let i = 0; i < 505; i += 1) f.journal('demo-a', 'refused', 'attached');
    f.journal('demo-a', 'refused', 'tree-unreadable');
    const at = f.now();
    await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([{
      kind: 'terminal', sessionId: 'demo-a', runId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at,
    }]);
  });
});

describe('lost triggers — orphans the close path never had a chance to reclaim', () => {
  it('(a) the minting run closed done NON-FINALLY while its programme stays open on another session — one request after two passes', async () => {
    const f = fixture();
    const r1 = f.openRun();
    // `planned` has no direct edge to `closing` (RUN_TRANSITIONS): a real
    // wave takes `dispatched` first. Advanced by hand rather than through
    // `closeRun`'s own `markDispatched` plumbing — this test only needs the
    // STATE terminal, not a real worker session bound to it.
    for (const to of ['dispatched', 'closing', 'done'] as const) {
      const adv = f.coord.advance(r1.id, to, 'test');
      if (!adv.ok) throw new Error(`advance to ${to} refused: ${JSON.stringify(adv)}`);
    }
    const r2raw = f.coord.openRun({ program: r1.program, title: r1.program, project: 'demo', wave: 2, waveOf: null,
      claimedBy: 'demo-coord' });
    if (!('id' in r2raw)) throw new Error(`openRun r2 refused: ${JSON.stringify(r2raw)}`);
    f.coord.setSession(r2raw.id, 'demo-b');
    f.plant('demo-a', { child: String(r1.id) });
    await f.pass(); f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']);
  });

  it('(b) a planned run that named the child was unbound (dispatch refusal released it) — one request after two passes', async () => {
    const f = fixture();
    const r1 = f.openRun();
    f.abandon(r1);
    const r2 = f.openRun();
    f.coord.setSession(r2.id, 'demo-a');
    f.coord.clearSession(r2.id, 0);
    f.plant('demo-a', { child: String(r1.id) });
    await f.pass(); f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']);
  });
});

describe('childReclaimTokenKind — wave 3\'s classification, read totally, from ONE place', () => {
  it('answers every token the map classifies, and null for anything else — never a prototype member', () => {
    for (const [token, kind] of Object.entries(CHILD_RECLAIM_TOKEN_KIND)) {
      expect(childReclaimTokenKind(token), token).toBe(kind);
    }
    expect(childReclaimTokenKind('from-a-newer-ccd')).toBeNull();
    expect(childReclaimTokenKind('toString')).toBeNull();
  });

  it('watch.ts imports it rather than keeping a copy', () => {
    const src = readFileSync(path.join(__dirname, '../src/watch.ts'), 'utf8');
    expect(src).not.toContain('CHILD_RECLAIM_TOKEN_KIND');
    expect(src).toMatch(/import \{[^}]*\bchildReclaimTokenKind\b[^}]*\} from '\.\/coord\/childReclaim\.js'/);
  });

  it('watch.ts reads a generation through the ONE fence and its latest event through the ONE rule — imported, never its own', () => {
    const src = readFileSync(path.join(__dirname, '../src/watch.ts'), 'utf8');
    expect(src).toMatch(/import \{[^}]*\bchildReclaimGeneration\b[^}]*\} from '\.\/coord\/childReclaim\.js'/);
    expect(src).toMatch(/import \{[^}]*\bchildReclaimLatest\b[^}]*\} from '\.\/coord\/childReclaim\.js'/);
    expect(src).toContain('childReclaimGeneration(this.childReclaimAttentionGenerationRows(coord, r.id), now)');
    expect(src).toContain('childReclaimJournalRow(gen, childReclaimLatest(gen))');
  });
});

describe('the production path', () => {
  it("reaches wave 3's own audit argv through runCcd — no stub", async () => {
    const f = fixture({ exec: 'real' });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();
    expect(f.calls).toContainEqual([...CCD_ARGV.wsReclaimAudit('demo-a', false)]);
  });

  it("goes through the session's own KeyedQueue — the one the close path and the reap route join", () => {
    const src = readFileSync(path.join(__dirname, '../src/watch.ts'), 'utf8');
    expect(src).toMatch(/this\.deps\.queue\.run\(req\.sessionId, \(\) => reclaimChild\(\{/);
  });

  it('composes the SAME ports the close route does — presence blocks it before any argv is composed', async () => {
    // `presence: true` must reach the executor and defer BEFORE `ws-audit`
    // is ever called — proof the production path wires `deps.presence`
    // through, exactly as `execChildReclaim`'s docstring says.
    const f = fixture({ exec: 'real', visible: (id) => id === 'demo-a' });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();
    expect(f.calls, 'presence should have blocked every argv').toEqual([]);
  });

  it('composes the feed log too: a real reclaim writes one feed row through deps.notifyLog', async () => {
    const home = mkTmp('ccrc-child-reclaim-sweep-notify-');
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const f = fixture({ exec: 'real', home, notifyLog });
    finishedChild(f);
    // `ws-audit --reclaim` at exit 1 (the fixture's blanket refusal) is a
    // FAILURE, which still writes one feed row.
    await f.pass(); f.next(); await f.pass();
    const feed = f.coord.feedEvents(50).filter((e) => e.sessionId === 'demo-a');
    expect(feed).toHaveLength(1);
    expect(feed[0]?.title).toBe('child reclaim failed');
  });
});

describe('R254 SAFETY probe: the entry does not outlive an ineligible gap', () => {
  it('R254-L10: a presence episode is not carried across a pass where the child was ineligible', async () => {
    const f = fixture({ outcome: (req) => deferredAs('presence', req) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 -> presence; the episode starts
    const r2 = f.openRun(); f.coord.setSession(r2.id, 'demo-a');   // re-bound: an open run names it
    f.next(); await f.pass();                                 // ineligible (siblings-open)
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS + 1);
    f.abandon(r2);
    await f.pass();                                           // the first eligible pass after the gap
    expect(f.requests.map((q) => q.deferExpired), 'asked on the first sighting after the gap').toEqual([false]);
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.deferExpired), 'a fresh episode, never a licensed attempt').toEqual([false, false]);
  });

  it('R254-L12: a row that leaves the registry takes its entry with it', async () => {
    const f = fixture({ outcome: (req) => deferredAs('presence', req) });
    const runId = finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 -> presence; the episode starts
    for (const fld of ['uuid', 'wrapper', 'project', 'workdir', 'workspace', 'branch', 'base', 'started', 'child']) {
      rmSync(path.join(f.reg, `demo-a.${fld}`), { force: true });
    }
    f.next(); await f.pass();                                 // the row is gone
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS + 1);
    f.plant('demo-a', { child: String(runId) });              // the same id listed again
    await f.pass();
    expect(f.requests.map((q) => q.deferExpired), 'asked on the first sighting after the gap').toEqual([false]);
  });
});

/** A home whose registry directory an executor stub can reach before the
 *  fixture that uses it exists. */
const leaseHome = (): { home: string; reg: string } => {
  const home = mkTmp('ccrc-child-reclaim-lease-');
  return { home, reg: path.join(home, '.cc-sessions') };
};

/** What a real reclaim leaves behind: the answer `reclaimed`, and the row gone
 *  from the registry. */
const reclaimedAndGone = (reg: string, req: ChildReclaimRequest): ChildReclaimOutcome => {
  for (const n of readdirSync(reg)) if (n.startsWith(`${req.sessionId}.`)) rmSync(path.join(reg, n));
  return { kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 };
};

const asksOf = (f: ReturnType<typeof fixture>, id: string): boolean[] =>
  f.requests.filter((q) => q.sessionId === id).map((q) => q.deferExpired);

/** `n` unlicensed asks, then a licensed one. */
const licensedAt = (n: number): boolean[] => [...Array.from({ length: n - 1 }, () => false), true];

describe('R254 SAFETY probe: how continuous is a presence episode under the in-flight bound', () => {
  it('R254-P′: a stale single sample never licenses across another child\'s lease — the episode runs from the answer after the gap', async () => {
    // The stub answers presence even when LICENSED. No real executor does: the
    // executor skips the server's presence check under `deferExpired`, and ccd
    // skips its presence rungs under `--defer-expired`. Here it keeps demo-a
    // listed after its licence, so its NEXT licence must be earned afresh.
    const f = fixture({ outcome: (req) => deferredAs('presence', req) });
    finishedChild(f, 'demo-a'); finishedChild(f, 'demo-b');
    await f.pass();                                           // both: first sighting
    while (asksOf(f, 'demo-a').length < 16 && f.requests.length < 40) { f.next(); await f.pass(); }
    expect(asksOf(f, 'demo-a'), 'demo-a holds the lease and is licensed at its 16th ask').toEqual(licensedAt(16));
    for (let k = 0; k < 16; k += 1) { f.next(); await f.pass(); }   // demo-b holds the lease from the next pass
    expect(asksOf(f, 'demo-b'), 'demo-b\'s lease: 16 asks, the last licensed').toEqual(licensedAt(16));
    expect(asksOf(f, 'demo-a'), 'demo-a is not asked during demo-b\'s lease').toHaveLength(16);
    f.next(); await f.pass();                                 // demo-a's 17th ask
    expect(asksOf(f, 'demo-a'), 'its episode spans the ceiling, but its latest request is 17 passes old: UNLICENSED')
      .toEqual([...licensedAt(16), false]);
    expect(f.entryOf('demo-a'), 'its answer restarts the episode at the arrival')
      .toMatchObject({ firstPresenceDeferredAt: f.mono(), lastPresenceDeferredAt: f.mono() });
    while (asksOf(f, 'demo-a').length < 32 && f.requests.length < 80) { f.next(); await f.pass(); }
    expect(asksOf(f, 'demo-a'), 'licensed again only at its own 32nd ask, never earlier')
      .toEqual([...licensedAt(16), ...licensedAt(16)]);
  });
});

describe('the presence lease at the lane: the senior presence-held child is asked on every pass it is due', () => {
  it('L1: three presence-held children are licensed IN TURN, each on its own 16th ask', async () => {
    const { home, reg } = leaseHome();
    const f = fixture({ home, outcome: (req) => (req.deferExpired ? reclaimedAndGone(reg, req) : deferredAs('presence', req)) });
    for (const id of ['demo-a', 'demo-b', 'demo-c']) finishedChild(f, id);
    await f.pass();                                           // all three: first sighting
    for (let k = 0; k < 60 && f.requests.length < 48; k += 1) { f.next(); await f.pass(); }
    expect(f.requests.map((q) => q.sessionId)).toEqual([
      ...Array.from({ length: 16 }, () => 'demo-a'), ...Array.from({ length: 16 }, () => 'demo-b'),
      ...Array.from({ length: 16 }, () => 'demo-c')]);
    expect(f.requests.flatMap((q, i) => (q.deferExpired ? [i] : [])), 'licensed exactly at indices 15, 31 and 47')
      .toEqual([15, 31, 47]);
  });

  it('L2: two presence-held children 62 s apart — the senior is licensed at its 16th ask, 930 s after its first, then the other', async () => {
    const f = fixture({ outcome: (req) => deferredAs('presence', req) });
    finishedChild(f, 'demo-a'); finishedChild(f, 'demo-b');
    const spacing = CHILD_RECLAIM_SWEEP_MS + 2_000;
    const askedAt: number[] = [];
    await f.pass();                                           // both: first sighting
    while (asksOf(f, 'demo-b').length < 16 && f.requests.length < 80) {
      f.advance(spacing); await f.pass();
      while (askedAt.length < f.requests.length) askedAt.push(f.mono());
    }
    const aIdx = f.requests.flatMap((q, i) => (q.sessionId === 'demo-a' ? [i] : []));
    expect(asksOf(f, 'demo-a').slice(0, 16), 'demo-a holds the lease').toEqual(licensedAt(16));
    expect(askedAt[aIdx[15]!]! - askedAt[aIdx[0]!]!, '930 s from its first ask to its licence').toBe(15 * spacing);
    expect(f.requests.findIndex((q) => q.sessionId === 'demo-b'), 'demo-b is first asked at overall index 16').toBe(16);
    expect(asksOf(f, 'demo-b'), 'then demo-b holds it').toEqual(licensedAt(16));
  });

  it('L4: the lease\'s stated cost — a reclaimable child sighted beside a presence-held one is first asked on the pass after the holder\'s licence', async () => {
    const { home, reg } = leaseHome();
    const f = fixture({ home, outcome: (req) => (req.sessionId === 'demo-b' || req.deferExpired
      ? reclaimedAndGone(reg, req) : deferredAs('presence', req)) });
    finishedChild(f, 'demo-a'); finishedChild(f, 'demo-b');
    const passOf: number[] = [];
    await f.pass();                                           // pass 1: both sighted
    for (let pass = 2; pass <= 30 && !f.requests.some((q) => q.sessionId === 'demo-b'); pass += 1) {
      f.next(); await f.pass();
      while (passOf.length < f.requests.length) passOf.push(pass);
    }
    const aLicence = f.requests.findIndex((q) => q.sessionId === 'demo-a' && q.deferExpired);
    const bFirst = f.requests.findIndex((q) => q.sessionId === 'demo-b');
    expect([passOf[aLicence], passOf[bFirst]], 'demo-a licensed at pass 17; demo-b first asked at pass 18').toEqual([17, 18]);
    expect(f.entryOf('demo-b'), 'demo-b was reclaimed').toBeUndefined();
  });
});

describe('the lane\'s two clocks: every decision clock is monotonic, the displayed one is the wall clock (spec §5.7)', () => {
  /** The child's own birth sits this far before the lane first sees it, so a
   *  600 s backward wall step does not cross it. The generation fence compares
   *  ccd's `create` `at` with the WALL clock, by necessity: a step back past a
   *  child's birth finds no birth and answers `child-birth-unplaced`, which
   *  fails closed and is the fence's row, not these. */
  const MINTED_AGO = 3_600_000;
  /** A lone presence-held child, asked five times: `f.requests` has five. */
  const fiveAnswers = async (f: ReturnType<typeof fixture>): Promise<void> => {
    finishedChild(f);
    f.advance(MINTED_AGO);
    await f.pass();                                           // the first sighting
    for (let k = 0; k < 5; k += 1) { f.next(); await f.pass(); }
    expect(f.requests).toHaveLength(5);
  };

  it('L5 (R258-C′): a backward wall step neither freezes the lane nor delays the licence', async () => {
    const f = fixture({ outcome: (req) => deferredAs('presence', req) });
    await fiveAnswers(f);
    f.wallStep(-600_000);
    for (let k = 6; k <= 16; k += 1) {
      f.next(); await f.pass();
      expect(f.requests, `one request on every pass after the step (ask ${k})`).toHaveLength(k);
    }
    expect(asksOf(f, 'demo-a')).toEqual(licensedAt(16));
  });

  it('L6: a backward wall step cannot hide a real hole — 200 s of monotonic time the wall reads as 50 s restarts the episode', async () => {
    const f = fixture({ outcome: (req) => deferredAs('presence', req) });
    await fiveAnswers(f);
    f.wallStep(-150_000); f.advance(200_000); await f.pass();  // the 6th answer, across the hole
    expect(f.entryOf('demo-a'), 'the episode restarts at the 6th answer').toMatchObject({ firstPresenceDeferredAt: f.mono() });
    while (f.requests.length < 21) { f.next(); await f.pass(); }
    expect(asksOf(f, 'demo-a'), 'licensed at the 21st ask').toEqual(licensedAt(21));
  });

  it('L7: a suspend restarts the episode — the monotonic clock stopped, the wall clock did not', async () => {
    const f = fixture({ outcome: (req) => deferredAs('presence', req) });
    await fiveAnswers(f);
    f.suspend(400_000); f.next(); await f.pass();             // the 6th answer, after the box slept
    expect(f.entryOf('demo-a'), 'the episode restarts at the 6th answer').toMatchObject({ firstPresenceDeferredAt: f.mono() });
    while (f.requests.length < 21) { f.next(); await f.pass(); }
    expect(asksOf(f, 'demo-a'), 'licensed at the 21st ask').toEqual(licensedAt(21));
  });

  it('L8: a forward wall step does not run a pass early', async () => {
    const f = fixture();
    finishedChild(f);
    await f.pass();                                           // the first sighting
    f.wallStep(120_000); f.advance(2_000); await f.pass();
    expect(f.requests, 'a second pass 2 s after the first').toEqual([]);
    f.advance(CHILD_RECLAIM_SWEEP_MS); await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('L9: a forward wall step past CHILD_RECLAIM_STALL_MS does not free the one slot while a reclaim is in flight', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fixture({ outcome: (req) => (req.sessionId === 'demo-a'
      ? new Promise<ChildReclaimOutcome>(() => { /* never resolves, deliberately */ })
      : { kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 }) });
    finishedChild(f, 'demo-a');
    f.next(); finishedChild(f, 'demo-b');
    await f.pass(); f.next();
    void f.pass();                                            // dispatches demo-a, which never answers
    await vi.waitFor(() => expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']));
    f.wallStep(CHILD_RECLAIM_STALL_MS + 1); f.advance(CHILD_RECLAIM_SWEEP_MS + 1); await f.pass();
    expect(f.requests.map((q) => q.sessionId), 'a wall step freed the slot').toEqual(['demo-a']);
    f.advance(CHILD_RECLAIM_STALL_MS); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a', 'demo-b']);
  });

  it('L10: the throttle\'s never-run sentinel is null — a monotonic clock that starts at 0 makes 0 a real stamp', async () => {
    const f = fixture({ mono0: 0 });
    finishedChild(f);
    await f.pass();                                           // a pass at monotonic 0: the first sighting
    expect(f.entryOf('demo-a'), 'the pass at monotonic 0 ran').toBeDefined();
    f.advance(1_000); await f.pass();
    expect(f.requests, 'a second pass one second after the first').toEqual([]);
    f.advance(CHILD_RECLAIM_SWEEP_MS); await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('L11: the arrival is read in the answer\'s own `.then`, never taken from the pass that sent the request', async () => {
    let answer!: (o: ChildReclaimOutcome) => void;
    const f = fixture({ outcome: () => new Promise<ChildReclaimOutcome>((resolve) => { answer = resolve; }) });
    finishedChild(f);
    await f.pass(); f.next();
    const dispatching = f.pass();
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    const askedMono = f.mono();
    f.advance(30_000);                                        // the answer arrives 30 s after its request
    answer(deferredAs('presence', f.requests[0]!));
    await dispatching;
    expect(f.entryOf('demo-a')).toMatchObject({ firstPresenceDeferredAt: askedMono + 30_000, lastPresenceDeferredAt: askedMono });
  });

  it('L12: the display clock stays WALL while the decision clocks are monotonic', async () => {
    const f = fixture({ outcome: (req) => deferredAs('state-changed', req) });
    expect(f.mono(), 'the two clocks have distinct origins').not.toBe(f.now());
    finishedChild(f);
    await f.pass();                                           // the sighting
    const sightedMono = f.mono();
    f.next(); await f.pass();                                 // request 1 → state-changed
    const deferredWall = f.now();
    expect(f.entryOf('demo-a')).toMatchObject({ firstEligibleAt: sightedMono, firstDeferredAt: deferredWall,
      lastAskedAt: f.mono() });
    f.next(); await f.pass();                                 // request 2 carries it
    expect(f.requests[1]?.deferredSinceMs, 'an epoch, as the executor\'s feed row renders it').toBe(deferredWall);
  });

  it('L13: the production default is performance.now() — a backward wall step still runs the next pass, and the display clock stays wall', async () => {
    const f = fixture({ monoSource: 'performance', outcome: (req) => deferredAs('state-changed', req) });
    finishedChild(f);
    f.advance(MINTED_AGO);
    await f.pass();                                           // the sighting
    f.wallStep(-600_000); f.advance(CHILD_RECLAIM_SWEEP_MS + 1); await f.pass();
    expect(f.requests, 'the pass after a backward wall step asks').toHaveLength(1);
    expect(f.entryOf('demo-a')?.firstDeferredAt).toBe(f.now());
  });
});

describe('the lease\'s tenure: a holder that cannot keep its episode continuous forfeits, and the lane goes on (spec §5.7)', () => {
  it('L14: a persistent slow answer — the holder forfeits at its second ask, and a reclaimable child is reached', async () => {
    const { home, reg } = leaseHome();
    let slowBy: (ms: number) => void = () => { throw new Error('the clock is not wired yet'); };
    const f = fixture({ home, outcome: (req) => {
      if (req.sessionId !== 'demo-a') return reclaimedAndGone(reg, req);
      slowBy(2.5 * CHILD_RECLAIM_SWEEP_MS + 1);               // every demo-a answer arrives more than G after its request
      return deferredAs('presence', req);
    } });
    slowBy = f.advance;
    finishedChild(f, 'demo-a'); finishedChild(f, 'demo-b');
    await f.pass();                                           // pass 1: both sighted
    const passOf: number[] = [];
    const heldAfter: (number | null)[] = [];
    for (let pass = 2; pass <= 6; pass += 1) {
      f.next(); await f.pass();
      while (passOf.length < f.requests.length) passOf.push(pass);
      heldAfter.push(f.entryOf('demo-a')?.presenceHeldSince ?? null);
    }
    expect(f.requests.slice(0, 3).map((q) => q.sessionId)).toEqual(['demo-a', 'demo-a', 'demo-b']);
    expect(passOf.slice(0, 3), 'demo-b\'s first request is the third overall, at pass 4').toEqual([2, 3, 4]);
    expect(heldAfter[0], 'demo-a joins the line at pass 2').not.toBeNull();
    expect(heldAfter[1], 'and forfeits as holder at pass 3').toBeNull();
    expect(asksOf(f, 'demo-a').filter(Boolean), 'no request of demo-a is licensed').toEqual([]);
  });

  it('L15: a rejected request is a FAILED attempt — it ends the episode, backs off, and earns no second licence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fixture({ outcome: (req) => (req.deferExpired
      ? Promise.reject(new Error('an executor defect')) : deferredAs('presence', req)) });
    finishedChild(f);
    await f.pass();
    while (f.requests.length < 16) { f.next(); await f.pass(); }
    expect(asksOf(f, 'demo-a'), 'licensed at its 16th ask, which rejects').toEqual(licensedAt(16));
    expect(f.entryOf('demo-a')).toMatchObject({ consecutiveFailures: 1, firstPresenceDeferredAt: null, presenceHeldSince: null });
    expect(warn.mock.calls.map((c) => String(c[0]))
      .filter((l) => l.endsWith('— recorded as a failed attempt; the sweep retries after its backoff'))).toHaveLength(1);
    expect(childReclaimBackoffMs(1, CHILD_RECLAIM_SWEEP_MS)).toBe(2 * CHILD_RECLAIM_SWEEP_MS);
    f.next(); await f.pass();
    expect(f.requests, 'inside the backoff: nothing').toHaveLength(16);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(17);
    expect(f.requests[16]?.deferExpired, 'the rejection ended the episode: no second licence on it').toBe(false);
  });

  it('L16: a stalled request sent as holder forfeits on its late answer — nothing is written at stall time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let answerA!: (o: ChildReclaimOutcome) => void;
    let aAsks = 0;
    const f = fixture({ outcome: (req) => {
      if (req.sessionId === 'demo-a' && (aAsks += 1) === 2) {
        return new Promise<ChildReclaimOutcome>((resolve) => { answerA = resolve; });
      }
      return deferredAs('presence', req);
    } });
    finishedChild(f, 'demo-a'); finishedChild(f, 'demo-b');
    await f.pass();                                           // pass 1: both sighted
    f.next(); await f.pass();                                 // pass 2: demo-a joins the line
    expect(f.entryOf('demo-a')?.presenceHeldSince).not.toBeNull();
    f.next();
    const held = await f.passDispatched();                    // pass 3: demo-a asked as HOLDER; its answer is held
    await vi.waitFor(() => expect(f.requests).toHaveLength(2));
    f.advance(CHILD_RECLAIM_STALL_MS + 1); await f.pass();    // the slot frees: demo-b asked, joins the line
    f.next(); await f.pass();                                 // demo-b asked as holder
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a', 'demo-a', 'demo-b', 'demo-b']);
    answerA(deferredAs('presence', f.requests[1]!));          // the stalled answer arrives, presence
    await held.settle;
    expect(f.entryOf('demo-a')?.presenceHeldSince, 'its late answer forfeits the senior\'s lease').toBeNull();
    f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId), 'demo-b is asked, and demo-a is not')
      .toEqual(['demo-a', 'demo-a', 'demo-b', 'demo-b', 'demo-b']);
  });
});

describe('one entry describes one workspace generation (spec §5.6, §5.7)', () => {
  it('L17: a recycled slug\'s new workspace starts from a first sighting — never from the old workspace\'s presence', async () => {
    const { home, reg } = leaseHome();
    const f = fixture({ home, outcome: (req) => (req.deferExpired ? reclaimedAndGone(reg, req) : deferredAs('presence', req)) });
    finishedChild(f);
    await f.pass();
    while (f.requests.length < 15) { f.next(); await f.pass(); }
    expect(asksOf(f, 'demo-a'), 'fifteen unlicensed asks: the next would be licensed').toEqual(Array.from({ length: 15 }, () => false));
    f.next();
    const r2 = f.openRun(); f.abandon(r2);
    f.plant('demo-a', { child: String(r2.id) });              // a NEW workspace under the slug: ws-add journals its create
    await f.pass();
    expect(f.requests, 'a fresh first sighting asks nothing').toHaveLength(15);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(16);
    expect(f.requests[15]).toMatchObject({ runId: r2.id, deferExpired: false });
  });
});

// K4 — the coordination fence at the lane (spec §1 rule 4: manual cleanup is
// reserved for a coordinator's own workspace; spec §5.6: slugs recycle, so
// "has coordinated" means THIS incarnation of the workspace). The fixture
// mirrors a `create` on every `plant`, at the fixture clock, and
// `journal(id, 'done', null, 'create')` mirrors an EARLIER generation's. A
// claim that ended before the current generation's birth less
// `CHILD_BIRTH_SKEW_MS` belongs to an earlier workspace under the same slug.
describe('the coordination fence at the lane — a claim counts only in the child\'s current generation (spec §1 rule 4, §5.6)', () => {
  let k4N = 0;
  /** A run `by` claims, in a programme of its own, opened at the fixture clock and abandoned there unless `open`. */
  const coordinatedBy = (f: ReturnType<typeof fixture>, by: string, open = false): { id: number; program: string } => {
    const program = `k4-coord-${++k4N}`;
    const r = f.coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: by });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    if (!open) f.abandon({ id: r.id, program });
    return { id: r.id, program };
  };
  /** A recycled slug: demo-a's minting run opens, a run demo-a coordinated is abandoned and an EARLIER
   *  generation's `create` is mirrored, all at T0; `gap` later the minting run is abandoned and the CURRENT
   *  generation is planted (its `create` mirrored at T0 + gap). */
  const recycled = (f: ReturnType<typeof fixture>, gap: number): number => {
    const r1 = f.openRun();
    coordinatedBy(f, 'demo-a');
    f.journal('demo-a', 'done', null, 'create');
    f.advance(gap);
    f.abandon(r1);
    f.plant('demo-a', { child: String(r1.id) });
    return r1.id;
  };
  const passes = async (f: ReturnType<typeof fixture>, n: number): Promise<void> => {
    await f.pass();
    for (let k = 1; k < n; k += 1) { f.next(); await f.pass(); }
  };
  /** The fence's own answer for demo-a now — what the verdict's `coordinating` is decided from. */
  const fenced = (f: ReturnType<typeof fixture>): boolean => childReclaimHasCoordinated(f.coord, 'demo-a', f.now());

  it('K4a: a recycled slug whose last claim ended before this generation was born is reclaimed — two passes, one request', async () => {
    const f = fixture();
    const runId = recycled(f, CHILD_BIRTH_SKEW_MS + 1);
    await passes(f, 2);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({ sessionId: 'demo-a', runId, trigger: 'sweep' });
  });

  it('K4b: a recycled slug whose CURRENT generation coordinated is never reclaimed — the verdict is coordinating', async () => {
    const f = fixture();
    recycled(f, CHILD_BIRTH_SKEW_MS + 1);
    coordinatedBy(f, 'demo-a');                                // opened and abandoned AFTER the plant
    await passes(f, 3);
    expect(f.requests).toEqual([]);
    expect(fenced(f)).toBe(true);
  });

  it('K4c: an open claim keeps the child, whatever generation it began in', async () => {
    const f = fixture();
    recycled(f, CHILD_BIRTH_SKEW_MS + 1);
    coordinatedBy(f, 'demo-a', true);                          // left open
    await passes(f, 3);
    expect(f.requests).toEqual([]);
    expect(fenced(f)).toBe(true);
  });

  it('K4d: the skew boundary, both sides — a claim exactly the skew before the birth keeps; one ms more does not', async () => {
    const edge = fixture();
    recycled(edge, CHILD_BIRTH_SKEW_MS);
    await passes(edge, 3);
    expect(edge.requests, 'the claim ended exactly CHILD_BIRTH_SKEW_MS before the birth: kept').toEqual([]);
    const past = fixture();
    recycled(past, CHILD_BIRTH_SKEW_MS + 1);
    await passes(past, 2);
    expect(past.requests, 'one ms further: reclaimed').toHaveLength(1);
  });

  it('K4e: an heir that took a finished programme\'s chair after its own birth has coordinated in this generation', async () => {
    const f = fixture();
    const r1 = f.openRun();
    const prog = coordinatedBy(f, 'demo-old');                // the programme's only run, closed at T0
    f.advance(CHILD_BIRTH_SKEW_MS + 1);
    f.abandon(r1);
    f.plant('demo-a', { child: String(r1.id) });
    expect(f.coord.reclaimProgram(prog.id, 'demo-a', f.now(), null)).toMatchObject({ ok: true });
    await passes(f, 3);
    expect(f.requests).toEqual([]);
    expect(fenced(f)).toBe(true);
  });

  it('K4f: a coordinator displaced from its chair before this generation was born is reclaimed — two passes, one request', async () => {
    const f = fixture();
    const r1 = f.openRun();
    const prog = coordinatedBy(f, 'demo-a');
    expect(f.coord.reclaimProgram(prog.id, 'demo-heir', f.now(), null)).toMatchObject({ ok: true });
    f.advance(CHILD_BIRTH_SKEW_MS + 1);
    f.abandon(r1);
    f.plant('demo-a', { child: String(r1.id) });
    await passes(f, 2);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({ sessionId: 'demo-a', runId: r1.id });
  });
});

// S2 — seeded rows at the lane, through the REAL watcher (spec §5.7). The
// children are `demo-p1`…`demo-pN` (presence while unlicensed, reclaimed when
// licensed), `demo-r` (reclaimed) and `demo-x` (state-changed), all sighted on
// pass 1, their ids putting every p before r before x. The stubs answer at
// once, so latency is 0; the policy suite's S1 carries latency. Each check is
// in the fixture's TRUE time.
describe('S2: seeded rows at the lane — every licence rests on a continuous episode, and the lease reaches every child', () => {
  const C = CHILD_RECLAIM_DEFER_CEILING_MS;
  const G = 2.5 * CHILD_RECLAIM_SWEEP_MS;
  const MODES = ['none', 'back-hole', 'suspend', 'slow-persistent'] as const;
  type Mode = typeof MODES[number];
  const mulberry32 = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  };
  const rows: [number, number, Mode][] = [];
  for (const mode of MODES) for (let n = 1; n <= 6; n += 1) for (const seed of [1, 2]) rows.push([seed, n, mode]);

  it.each(rows)('S2 seed %i, N %i, %s', { timeout: 120_000 }, async (seed, n, mode) => {
    const rnd = mulberry32(seed * 7_919 + n * 131 + MODES.indexOf(mode));
    const uni = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
    const { home, reg } = leaseHome();
    const f = fixture({ home, outcome: (req) => {
      if (req.sessionId === 'demo-x') return deferredAs('state-changed', req);
      if (req.sessionId === 'demo-r' || req.deferExpired) return reclaimedAndGone(reg, req);
      return deferredAs('presence', req);
    } });
    const ps = Array.from({ length: n }, (_, k) => `demo-p${k + 1}`);
    for (const id of [...ps, 'demo-r', 'demo-x']) finishedChild(f, id);
    // Minted an hour before the lane first sees them, so `back-hole`'s 600 s
    // step back reads as a gap, never as a step past the children's own
    // births (the generation fence's wall-clock row, which fails closed).
    f.advance(3_600_000);
    const k = uni(3, 3 + 16 * n);                             // the disturbance's pass
    const asks: { id: string; q: number; licensed: boolean; pass: number }[] = [];
    const forfeited = new Set<string>();
    let passN = 0;
    let t2 = 0;
    const doPass = async (): Promise<void> => {
      passN += 1;
      if (passN === 2) t2 = f.trueNow();
      const before = f.requests.length;
      const heldBefore = new Map(ps.map((p) => [p, (f.entryOf(p)?.presenceHeldSince ?? null) !== null]));
      await f.pass();
      for (const q of f.requests.slice(before)) {
        asks.push({ id: q.sessionId, q: f.trueNow(), licensed: q.deferExpired, pass: passN });
        if (heldBefore.get(q.sessionId) === true && !q.deferExpired
            && (f.entryOf(q.sessionId)?.presenceHeldSince ?? null) === null) forfeited.add(q.sessionId);
      }
    };
    const gone = (id: string): boolean => !existsSync(path.join(reg, `${id}.uuid`));
    const done = (): boolean => [...ps, 'demo-r'].every(gone) && asks.some((q) => q.id === 'demo-x');
    const capT = (n + 2) * 1_060_000 + 460_000;
    await doPass();                                           // pass 1: every child sighted
    while (!done() && (mode === 'slow-persistent' ? passN < 2 * n + 4 : passN < 2 || f.trueNow() - t2 < capT)) {
      const i = passN + 1;
      let spacing = mode === 'slow-persistent' ? 160_000 : uni(60_001, 80_000);
      if (mode === 'back-hole' && i === k) { f.wallStep(-600_000); spacing = 200_000; }
      if (mode === 'suspend' && i === k) f.suspend(300_000);
      f.advance(spacing);
      await doPass();
    }
    const out: string[] = [];
    const lic = asks.filter((q) => q.licensed && ps.includes(q.id));
    // (i) the licence rests on a suffix of consecutive presence answers (latency 0: a = q).
    for (const L of lic) {
      const mine = asks.filter((q) => q.id === L.id && q.q < L.q);
      let s = mine.length - 1;
      if (s < 0 || mine[s]!.licensed || L.q - mine[s]!.q > G) { out.push(`(i) ${L.id} at ${L.q}: no fresh presence answer`); continue; }
      while (s > 0 && !mine[s - 1]!.licensed && mine[s]!.q - mine[s - 1]!.q <= G) s -= 1;
      if (L.q - mine[s]!.q < C) out.push(`(i) ${L.id} at ${L.q}: its chain spans ${L.q - mine[s]!.q}`);
    }
    // (ii) licences in id order, except that a holder which forfeited is licensed after the others.
    const order = lic.map((q) => q.id);
    const kept = order.filter((id) => !forfeited.has(id));
    if (kept.join() !== [...kept].sort().join()) out.push(`(ii) licence order ${order.join()}`);
    const lastKept = Math.max(-1, ...kept.map((id) => order.indexOf(id)));
    for (const id of forfeited) if (order.includes(id) && order.indexOf(id) < lastKept) out.push(`(ii) forfeiter ${id} licensed early`);
    const rFirst = asks.find((q) => q.id === 'demo-r');
    const xFirst = asks.find((q) => q.id === 'demo-x');
    if (mode === 'slow-persistent') {
      // (v) no p licensed, and demo-r asked at pass 2N + 2.
      if (lic.length > 0) out.push('(v) a presence-held child was licensed');
      if (rFirst?.pass !== 2 * n + 2) out.push(`(v) demo-r first asked at pass ${String(rFirst?.pass)}`);
    } else {
      // (iii) the bound.
      if (mode === 'none') {
        if (lic.length !== n) out.push(`(iii) ${lic.length} licences for ${n} children`);
        lic.forEach((q, j) => {
          const limit = j === 0 ? t2 + 980_000 : lic[j - 1]!.q + 1_060_000;
          if (q.q > limit) out.push(`(iii) licence ${j + 1} at t2+${q.q - t2}, past its limit`);
        });
      } else {
        const bound = t2 + (n + 1) * 1_060_000 + 460_000;
        for (const p of ps) {
          const t = lic.filter((q) => q.id === p).at(-1)?.q;
          if (t === undefined || !gone(p) || t > bound) out.push(`(iii) ${p} licensed at ${String(t)}`);
        }
        if (rFirst === undefined || !gone('demo-r') || rFirst.q > bound) out.push(`(iii) demo-r reclaimed at ${String(rFirst?.q)}`);
      }
      // (iv) demo-r and demo-x both asked; in `none`, after the last licence.
      if (rFirst === undefined || xFirst === undefined) out.push('(iv) demo-r or demo-x never asked');
      else if (mode === 'none' && lic.length > 0 && Math.min(rFirst.q, xFirst.q) < lic.at(-1)!.q) {
        out.push('(iv) demo-r or demo-x asked before the last licence');
      }
    }
    expect(out).toEqual([]);
  });
});

// The sweep's verdicts, visible (spec §5.9). L4 records each marked child's verdict exactly where
// the per-child loop reaches it, and L1's `childReclaimKeptVerdicts` decides what a pass that judged
// nothing (a raised switch, a missing capability, a failed read) keeps of them: the kept words alone.
// "No verdict yet" is its own value, `null` for every child or an id absent from the map, and never
// reads as eligible.
describe('currentChildReclaimVerdicts — the sweep\'s verdicts, visible (wave 5)', () => {
  /** The three children: demo-a coordinating, demo-b finished (eligible), demo-c under a person's hold.
   *  Returns demo-b's minting run id. */
  const three = (f: ReturnType<typeof fixture>): number => {
    coordinatingChild(f);
    const runId = finishedChild(f, 'demo-b');
    const r = f.openRun();
    f.abandon(r);
    f.plant('demo-c', { child: String(r.id), hold: 'kept by hand' });
    return runId;
  };
  const verdicts = (f: ReturnType<typeof fixture>) => f.watcher.currentChildReclaimVerdicts();
  const COORDINATING = { eligible: false, why: 'coordinating' };
  const HELD = { eligible: false, why: 'held' };

  it('(i) is null before any pass — no verdict yet, for every child', () => {
    const f = fixture();
    three(f);
    expect(verdicts(f)).toBeNull();
  });

  it('(ii) after one pass, each marked child carries the verdict the loop reached', async () => {
    const f = fixture();
    const runId = three(f);
    await f.pass();
    const v = verdicts(f);
    expect(v?.get('demo-b')).toEqual({ eligible: true, runId });
    expect(v?.get('demo-a')).toEqual(COORDINATING);
    expect(v?.get('demo-c')).toEqual(HELD);
  });

  it('(iii) a pause keeps the kept verdicts, and only them; a box without the capability never judged', async () => {
    const f = fixture();
    const runId = three(f);
    await f.pass();
    expect(verdicts(f)?.get('demo-b'), 'judged once').toEqual({ eligible: true, runId });
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.next(); await f.pass();
    const paused = verdicts(f);
    expect(paused).toBeInstanceOf(Map);
    expect(paused?.get('demo-a')).toEqual(COORDINATING);
    expect(paused?.get('demo-b')).toBeUndefined();
    expect(paused?.get('demo-c')).toBeUndefined();
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();
    expect(verdicts(f)?.get('demo-b')).toEqual({ eligible: true, runId });
    expect(verdicts(f)?.get('demo-c')).toEqual(HELD);
    expect(verdicts(f)?.get('demo-a')).toEqual(COORDINATING);

    const g = fixture({ cap: false });
    three(g);
    await g.pass(); g.next(); await g.pass(); g.next(); await g.pass();
    expect(verdicts(g), 'no pass on a box without reclaim-v1 ever judged').toBeNull();
  });

  it('(iv) a failed read reduces the same way: the kept verdict stays, the others go', async () => {
    const f = fixture();
    const runId = three(f);
    await f.pass();
    expect(verdicts(f)?.get('demo-b'), 'judged once').toEqual({ eligible: true, runId });
    f.next();
    const spy = vi.spyOn(f.coord, 'childReclaimSessionIds')
      .mockImplementation(() => { throw new Error('mirror unreadable'); });
    await f.pass();
    spy.mockRestore();
    expect(verdicts(f)?.get('demo-a')).toEqual(COORDINATING);
    expect(verdicts(f)?.get('demo-b')).toBeUndefined();
    expect(verdicts(f)?.get('demo-c')).toBeUndefined();
  });

  it('(v) a row the registry stops listing is absent from the next judging pass\'s map', async () => {
    const f = fixture();
    finishedChild(f, 'demo-a');
    finishedChild(f, 'demo-b');
    await f.pass();
    expect([...(verdicts(f)?.keys() ?? [])].sort()).toEqual(['demo-a', 'demo-b']);
    for (const n of readdirSync(f.reg)) if (n.startsWith('demo-a.')) rmSync(path.join(f.reg, n));
    f.next(); await f.pass();
    expect([...(verdicts(f)?.keys() ?? [])]).toEqual(['demo-b']);
  });

  it('(vi) a non-final close\'s re-hold reads held while its programme has an open run, then hold-retired', async () => {
    const f = fixture();
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-a', { child: String(r.id), hold: holdReason(r.program, 2, null, null) });
    const r2 = f.coord.openRun({ program: r.program, title: r.program, project: 'demo', wave: 2, waveOf: null,
      claimedBy: 'demo-coord' });
    if (!('id' in r2)) throw new Error(`openRun r2 refused: ${JSON.stringify(r2)}`);
    await f.pass();
    expect(verdicts(f)?.get('demo-a')).toEqual(HELD);
    f.abandon({ id: r2.id, program: r.program });
    f.next(); await f.pass();
    expect(verdicts(f)?.get('demo-a')).toMatchObject({ eligible: false, why: 'hold-retired' });
  });

  it('(vii) the coordinating child is logged once, and the line never says "ever"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fixture();
    coordinatingChild(f);
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    const lines = warn.mock.calls.map((c) => String(c[0]))
      .filter((l) => l.includes('demo-a') && l.includes('never reclaimed automatically'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/\bever\b/);
  });
});

// The attention list's kept arm, at the lane (spec §5.9). The list's one write is made on both sides
// of the switch: the mirror arms every pass derive, then the kept arm from the verdicts as they stand
// (the last judging pass's, or its kept verdicts alone), one item per child, and no failing item for a
// child whose recorded verdict is `held`. The kept feed row is written once per child per word per
// process, from a judging pass alone.
describe('the attention list\'s kept arm — the sweep\'s kept verdicts, listed and fed once (wave 5)', () => {
  const KEPT_TITLE = 'child reclaim kept';
  /** A `NotifyLog` loaded as the production path's is, so the kept feed row has somewhere to land. */
  const feedFixture = async () => {
    const home = mkTmp('ccrc-child-reclaim-sweep-kept-');
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    return { home, notifyLog };
  };
  const keptRows = (f: ReturnType<typeof fixture>) => f.coord.feedEvents(50).filter((e) => e.title === KEPT_TITLE);
  const attention = (f: ReturnType<typeof fixture>) => f.watcher.currentCoord()?.childReclaimAttention;
  const keptItem = (sessionId: string, runId: number) => ({
    kind: 'kept', sessionId, runId, word: 'coordinating', sentence: CHILD_RECLAIM_SKIP.coordinating.sentence,
  });
  /** A child whose marker names a run the database does not hold: `minting-run-absent`, a kept word. */
  const orphanedChild = (f: ReturnType<typeof fixture>, id: string): void => { f.plant(id, { child: '9999' }); };

  it('(vi) a coordinating child is listed from the first pass, never asked, and fed ONCE however many passes run', async () => {
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog });
    const runId = coordinatingChild(f);
    await f.pass();
    await f.watcher.tick();
    expect(attention(f)).toEqual([keptItem('demo-a', runId)]);
    f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    expect(keptRows(f)).toHaveLength(1);
    expect(keptRows(f)[0]).toMatchObject({ kind: 'run', sessionId: 'demo-a', runId });
    expect(keptRows(f)[0]!.body).toBe(`demo-a, child of run #${runId}: ${CHILD_RECLAIM_SKIP.coordinating.sentence}`);
  });

  it('(vii) a restart lists the item after its own first pass, and writes exactly one more row', async () => {
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog });
    const runId = coordinatingChild(f);
    await f.pass();
    expect(keptRows(f)).toHaveLength(1);
    const g = fixture({ coord: f.coord, home: f.home, notifyLog });
    await g.pass();
    await g.watcher.tick();
    expect(attention(g)).toEqual([keptItem('demo-a', runId)]);
    expect(keptRows(g)).toHaveLength(2);
    g.next(); await g.pass();
    expect(keptRows(g), 'the same process fed the same word twice').toHaveLength(2);
  });

  it('(vi) the row is per WORD too: a child kept for a second word is fed once for it', async () => {
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog });
    coordinatingChild(f);
    await f.pass();
    expect(keptRows(f)).toHaveLength(1);
    writeFileSync(path.join(f.reg, 'demo-a.child'), '9999');  // now its marker names a run the database does not hold
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentChildReclaimVerdicts()?.get('demo-a')).toEqual({ eligible: false, why: 'minting-run-absent' });
    expect(attentionLabels(f)).toEqual(['kept:demo-a']);
    expect(keptRows(f).map((e) => e.body)).toEqual([
      expect.stringContaining(CHILD_RECLAIM_SKIP.coordinating.sentence),
      expect.stringContaining(CHILD_RECLAIM_SKIP['minting-run-absent'].sentence),
    ]);
    f.next(); await f.pass();
    expect(keptRows(f), 'a word already fed was fed again').toHaveLength(2);
  });

  it('(viii) a raised pause keeps the kept verdict and the item, and writes no new row', async () => {
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog });
    const runId = coordinatingChild(f);
    await f.pass();
    await f.watcher.tick();
    expect(attention(f)).toEqual([keptItem('demo-a', runId)]);
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentChildReclaimVerdicts()?.get('demo-a')).toEqual({ eligible: false, why: 'coordinating' });
    expect(attention(f), 'a pause erased the kept item').toEqual([keptItem('demo-a', runId)]);
    expect(keptRows(f)).toHaveLength(1);
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();
    expect(keptRows(f), 'lowering the pause fed the same word again').toHaveLength(1);
  });

  it('(viii) a box without a reclaim capability lists nothing kept — it never judged — and still reports the mirror arms', async () => {
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog, cap: false });
    coordinatingChild(f);
    finishedChild(f, 'demo-b');
    f.journal('demo-b', 'refused', 'tree-unreadable');
    await f.pass();
    await f.watcher.tick();
    expect(attentionLabels(f)).toEqual(['terminal:demo-b']);
    expect(keptRows(f)).toEqual([]);
  });

  it('(ix) a pass whose mirror read throws leaves the list exactly as it was', async () => {
    const f = fixture();
    const runId = coordinatingChild(f);
    await f.pass();
    await f.watcher.tick();
    const before = attention(f);
    expect(before, 'the kept item must be listed first, or this case is vacuous').toEqual([keptItem('demo-a', runId)]);
    f.next();
    const spy = vi.spyOn(f.coord, 'childReclaimSessionIds')
      .mockImplementation(() => { throw new Error('mirror unreadable'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await f.pass();
    await f.watcher.tick();                                   // same clock as the pass just above — no side dispatch
    spy.mockRestore();
    expect(attention(f)).toEqual(before);
  });

  it('(x) a recycled id is a NEW child: once the registry stops listing it, a later workspace under it is fed again', async () => {
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog });
    orphanedChild(f, 'demo-a');
    await f.pass();
    await f.watcher.tick();
    expect(attentionLabels(f)).toEqual(['kept:demo-a']);
    expect(keptRows(f)).toHaveLength(1);
    for (const n of readdirSync(f.reg)) if (n.startsWith('demo-a.')) rmSync(path.join(f.reg, n));
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(attentionLabels(f), 'a vanished row stayed listed').toEqual([]);
    expect(keptRows(f)).toHaveLength(1);
    orphanedChild(f, 'demo-a');                               // the same id, a new workspace
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(attentionLabels(f)).toEqual(['kept:demo-a']);
    expect(keptRows(f), 'the recycled id was not fed as a new child').toHaveLength(2);
  });

  it('(xi) after a lost database, six children kept for one word are ONE collapsed line, and six feed rows', async () => {
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog });
    const ids = ['demo-m1', 'demo-m2', 'demo-m3', 'demo-m4', 'demo-m5', 'demo-m6'];
    for (const id of ids) orphanedChild(f, id);
    await f.pass();
    await f.watcher.tick();
    expect(attention(f)).toEqual([{
      kind: 'kept-many', word: 'minting-run-absent',
      members: ids.map((sessionId) => ({ sessionId, runId: 9999 })),
      sentence: childReclaimKeptManySentence('minting-run-absent', 6),
    }]);
    expect(keptRows(f).map((e) => e.sessionId).sort()).toEqual(ids);
    f.next(); await f.pass();
    expect(keptRows(f), 'a collapsed line fed again').toHaveLength(6);
  });

  it('(xi) five children kept for one word stay five items', async () => {
    const f = fixture();
    const ids = ['demo-m1', 'demo-m2', 'demo-m3', 'demo-m4', 'demo-m5'];
    for (const id of ids) orphanedChild(f, id);
    await f.pass();
    await f.watcher.tick();
    expect(attentionLabels(f)).toEqual(ids.map((id) => `kept:${id}`));
  });

  it('a feed archive that throws degrades the row and never the list: one warning, the item listed, the log flushed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog });
    const runId = coordinatingChild(f);
    vi.spyOn(f.coord, 'recordFeedEvent').mockImplementation(() => { throw new Error('archive full'); });
    const flush = vi.spyOn(notifyLog, 'flush');
    await f.pass();
    await f.watcher.tick();
    expect(attention(f)).toEqual([keptItem('demo-a', runId)]);
    expect(warn.mock.calls.map((c) => String(c[0])))
      .toContain('ccrc-server: recordFeedEvent failed (archive full) — child reclaim kept, feed archive degraded');
    expect(flush).toHaveBeenCalled();
  });

  it('(xii) a kept child with a standing failure run is listed ONCE, as kept', async () => {
    const f = fixture();
    const runId = coordinatingChild(f);
    f.journal('demo-a', 'failed', 'pin-failed');
    const since = f.now();
    await f.pass();
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    f.journal('demo-a', 'intent', null);
    f.journal('demo-a', 'failed', 'pin-failed');              // still failing, a ceiling later
    expect(f.latestOf('demo-a')).toMatchObject({ outcome: 'failed', failingSince: since });
    await f.pass();
    await f.watcher.tick();
    expect(attention(f)).toEqual([keptItem('demo-a', runId)]);
    expect(f.requests, 'a kept child was asked for').toEqual([]);
  });

  it('(xiv) a held child\'s failure run past the ceiling is not on the banner; with no verdict recorded it is', async () => {
    const f = fixture();
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-c', { child: String(r.id), hold: 'kept by hand' });
    f.journal('demo-c', 'failed', 'pin-failed');
    const since = f.now();
    await f.pass();
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    f.journal('demo-c', 'intent', null);
    f.journal('demo-c', 'failed', 'pin-failed');              // still failing, a ceiling later
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentChildReclaimVerdicts()?.get('demo-c')).toEqual({ eligible: false, why: 'held' });
    expect(attention(f)).toEqual([]);
    expect(f.requests).toEqual([]);
    // A pause drops `held` (a transient verdict), so wave 4's failing arm stands unchanged.
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentChildReclaimVerdicts()?.get('demo-c')).toBeUndefined();
    expect(attention(f)).toEqual([{
      kind: 'failing', sessionId: 'demo-c', runId: r.id, token: 'pin-failed',
      sentence: childReclaimFailingSentence(lcRefusalWord('pin-failed') ?? refusalSentence('pin-failed')), at: since,
    }]);
  });

  it('(xv) a kept verdict retained across a pause does not outlive a terminal refusal the mirror has since recorded', async () => {
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog });
    const runId = coordinatingChild(f);
    await f.pass();
    await f.watcher.tick();
    expect(attention(f)).toEqual([keptItem('demo-a', runId)]);
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.journal('demo-a', 'refused', 'tree-unreadable');
    const at = f.now();
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentChildReclaimVerdicts()?.get('demo-a'), 'the kept verdict was retained').toEqual({ eligible: false, why: 'coordinating' });
    expect(attention(f)).toEqual([{
      kind: 'terminal', sessionId: 'demo-a', runId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at,
    }]);
    expect(keptRows(f)).toHaveLength(1);
  });

  it('a doubt verdict and an ordinary one reach neither the list nor the feed', async () => {
    const { home, notifyLog } = await feedFixture();
    const f = fixture({ home, notifyLog });
    // `hold-unmeasured` (doubt): a hold no run of this child's own can account for is `held`, so the doubt
    // case is a registry row whose marker cannot be read.
    finishedChild(f, 'demo-a');
    writeFileSync(path.join(f.reg, 'demo-a.child'), 'not-a-run-id');
    // `minting-run-open` (ordinary): the minting run is still open and names this session.
    const open = f.openRun();
    f.coord.setSession(open.id, 'demo-b');
    f.plant('demo-b', { child: String(open.id) });
    await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentChildReclaimVerdicts()?.get('demo-a')).toEqual({ eligible: false, why: 'marker-unreadable' });
    expect(f.watcher.currentChildReclaimVerdicts()?.get('demo-b')).toEqual({ eligible: false, why: 'minting-run-open' });
    expect(attentionLabels(f)).toEqual([]);
    expect(keptRows(f)).toEqual([]);
  });
});
