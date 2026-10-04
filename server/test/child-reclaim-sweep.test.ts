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
  CHILD_RECLAIM_DEFER_CEILING_MS, childReclaimFailingSentence, childReclaimJournalRow,
} from '../src/childReclaimSweep.js';
import {
  CHILD_RECLAIM_TOKEN_KIND, childReclaimGeneration, childReclaimLatest, childReclaimTokenKind,
  type ChildReclaimOutcome, type ChildReclaimRequest,
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
}

const fixture = (opts: FixtureOpts = {}) => {
  let clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
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
  const advance = (ms: number): void => { clock += ms; };
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
    passDispatched, next, advance, latestOf, entryOf, now: () => clock,
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

const deferredAs = (why: 'presence' | 'state-changed', req: ChildReclaimRequest): ChildReclaimOutcome =>
  ({ kind: 'deferred', sessionId: req.sessionId, runId: req.runId, why, detail: `deferred: ${why}` });

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
    f.next(); await f.pass();                                  // the ordinary path's FIRST eligible sighting
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();                                  // …and its second — only now
    expect(f.requests).toEqual([
      { sessionId: 'demo-a', runId: r1.id, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('a SECOND interleaving: ccd unlinks the hold before it answers — the eligible FIRST sighting lands while the release is still in flight, and the reclaim goes out one pass after the answer', async () => {
    // The first interleaving (above) has the stub apply ccd's effect exactly
    // AT the moment it answers. Here the effect and the answer are pulled
    // apart: the row is unheld first, and a pass reads that BEFORE the
    // release job's own promise ever resolves. The eligible branch sets its
    // first-sighting entry ahead of its own in-flight check, so this pass
    // records the sighting despite the release still being unsettled — and
    // the reclaim still needs only ONE further pass once the answer lands,
    // not two, because that sighting already happened.
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
    resolveRelease({ code: 0, stdout: 'released demo-a\n', stderr: '' });   // the answer, matching what already happened
    await second;
    f.next(); await f.pass();                                   // the FIRST pass after the answer — dispatches
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
    const spy = vi.spyOn(f.coord, 'childReclaimCoordinatorIds')
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

  it('a child that has EVER coordinated a run is never reclaimed automatically', async () => {
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
    expect(f.watcher.currentCoord()?.childReclaimAttention.map((a) => a.sessionId)).toEqual(['demo-b']);
  });

  it('does nothing on a box that advertises reclaim-v1 but not reclaim-pause-v1, and still REPORTS', async () => {
    const f = fixture({ pauseCap: false });
    finishedChild(f);
    finishedChild(f, 'demo-b');
    f.journal('demo-b', 'refused', 'tree-unreadable');
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention.map((a) => a.sessionId)).toEqual(['demo-b']);
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
    // bound") RESTARTS the episode at that request's own instant, rather
    // than silently keeping the ceiling exhausted forever — a licensed
    // attempt that finds someone still there must get a fresh 15 minutes,
    // not an immediate second bypass.
    expect(f.entryOf('demo-a')).toMatchObject({ firstDeferredAt: deferredAt, firstPresenceDeferredAt: f.now(),
      lastPresenceDeferredAt: f.now() });
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
    // that request's own instant.
    expect(f.entryOf('demo-a')).toMatchObject({ firstDeferredAt: firstDefer, firstPresenceDeferredAt: f.now(),
      lastPresenceDeferredAt: f.now() });
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
  it('a throwing childReclaimCoordinatorIds read: no request to anyone, the entry is cleared, and a clean read needs two FRESH passes', async () => {
    const f = fixture();
    finishedChild(f);
    await f.pass(); f.next();
    // Sighted once already — the next ordinary pass would dispatch.
    const spy = vi.spyOn(f.coord, 'childReclaimCoordinatorIds')
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
      sessionId: 'demo-term', runId: termRunId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at: T0,
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
      sessionId: 'demo-a', runId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at: T0,
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
    const item = { sessionId: 'demo-a', runId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at: refusedAt };
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
      sessionId: 'demo-a', runId, token: 'containment-unproven', sentence: refusalSentence('containment-unproven'), at,
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
    expect(f.watcher.currentCoord()?.childReclaimAttention.map((a) => a.token)).toEqual(['containment-unproven']);
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
    expect(g.watcher.currentCoord()?.childReclaimAttention.map((a) => a.sessionId)).toEqual(['demo-a']);
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
      sessionId: 'demo-a', runId, token: 'pin-failed',
      sentence: childReclaimFailingSentence(lcRefusalWord('pin-failed') ?? refusalSentence('pin-failed')), at: since,
    }]);
    expect(f.requests.map((q) => q.sessionId), 'a failing child was excluded like a terminal refusal').toEqual(['demo-a']);
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
    expect(listed.map((a) => a.sessionId)).toEqual(['demo-a']);
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
      sessionId: 'demo-a', runId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at,
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

describe('R254 SAFETY probe: how continuous is a presence episode under the in-flight bound', () => {
  it('R254-P: one presence sample, then sixteen other due children — the child\'s NEXT request does NOT go out licensed', async () => {
    const f = fixture({ outcome: (req) => deferredAs(req.sessionId === 'demo-a' ? 'presence' : 'state-changed', req) });
    const others = Array.from({ length: 16 }, (_, k) => `demo-${String.fromCharCode(98 + k)}`);   // demo-b .. demo-q
    finishedChild(f, 'demo-a');
    for (const id of others) finishedChild(f, id);
    await f.pass(); f.next(); await f.pass();          // pass 2: demo-a asked (sorted first by id) -> presence, ONE sample
    for (let k = 0; k < others.length; k += 1) { f.next(); await f.pass(); }   // one never-asked child per pass
    f.next(); await f.pass();                          // demo-a's turn again
    const asks = f.requests.filter((q) => q.sessionId === 'demo-a');
    expect(asks.map((q) => q.deferExpired), 'demo-a was sampled present exactly once').toEqual([false, false]);
  });
});
