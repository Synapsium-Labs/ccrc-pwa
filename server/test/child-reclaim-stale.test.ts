// D-6639 (fleet disk retention DR-27; spec 2026-10-23 §2.7.3 G2): kept children are reclaimed after seven idle days,
// SHADOWED behind `$REG/child-stale-reclaim-live`. Three layers, each proved where it lives:
//   1. the L1 stale step (`childReclaimStaleVerdict`): which kept words lapse, what idle means, who is never reached;
//   2. the lane (`FleetWatcher.sweepChildReclaim`): shadow records once, armed sends `--stale` and the hold digest
//      through the one executor seam, a terminal child is asked once per seven idle days, and a box without
//      `reclaim-stale-v1` is never sent the flag;
//   3. the executor (`reclaimChild`): the argv, and the system mail to the minting run's coordinator naming the
//      attic refs (a run-absent child has no one to tell, so it writes a feed row instead).
// Fixture HOMEs only. No real ccd runs anywhere in this file.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { ACTOR_FLAGS_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP, RECLAIM_STALE_CAP } from '../src/ccdargv.js';
import {
  CHILD_RECLAIM_SKIP, CHILD_STALE_IDLE_MS, childReclaimStaleVerdict, childReclaimSweepVerdict,
  type ChildReclaimSweepInput,
} from '../src/childReclaimSweep.js';
import { CHILD_RECLAIM_FEED_QUIET_NONE, reclaimChild, type ChildReclaimDeps, type ChildReclaimOutcome,
  type ChildReclaimRequest } from '../src/coord/childReclaim.js';
import { CHILD_STALE_RECLAIM_LIVE_MARKER, CHILD_SUPERSEDED_RECLAIM_LIVE_MARKER } from '../../shared/switches.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { holdReason } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const DAY = 24 * 3_600_000;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

// ── 1. the L1 stale step ─────────────────────────────────────────────────────────────────────────────────────────

const NOW = 1_790_000_000_000;
const SKEW = 120_000;
/** A held child on every count a stale step reads: idle past the ceiling, nothing open, never coordinated. */
const idleFor = (ms: number) => ({ runAt: NOW - ms, mailAt: NOW - ms, statusAt: NOW - ms, holdAt: NOW - ms });
const base = (over: Partial<ChildReclaimSweepInput> = {}): ChildReclaimSweepInput => ({
  sessionId: 'demo-a', child: { kind: 'child', runId: 7 }, identityMeasured: true, generation: { kind: 'absent' },
  workspace: 'demo-a', held: { kind: 'none' }, terminal: false,
  mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 40 * DAY,
    openedAt: NOW - 40 * DAY, closedAt: NOW - 39 * DAY } },
  reviewedRun: { kind: 'not-a-review' }, siblings: { ok: true, open: 0 }, coordinatorClaim: undefined,
  childBornAt: NOW - 40 * DAY, skewMs: SKEW, nowMs: NOW, idle: idleFor(8 * DAY), holdDigest: null, ...over,
});
const HAND = 'operator parked this on purpose';
const HAND_DIGEST = sha(HAND);
/** One case per word of the population: the input that makes the base verdict answer it. */
const WORDS: readonly (readonly [string, string, Partial<ChildReclaimSweepInput>])[] = [
  ['held', 'held', { held: { kind: 'held', reason: HAND }, holdDigest: HAND_DIGEST }],
  ['minting-run-absent', 'run-absent', { mintingRun: { ok: true, run: null } }],
  ['review-report-live', 'review', { reviewedRun: { kind: 'run', state: 'working' },
    mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 40 * DAY,
      openedAt: NOW - 40 * DAY, closedAt: NOW - 2 * DAY } } }],
  ['review-report-stale', 'review', { reviewedRun: { kind: 'run', state: 'working' },
    mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 40 * DAY,
      openedAt: NOW - 40 * DAY, closedAt: NOW - 20 * DAY } } }],
  ['terminal-refusal', 'terminal', { terminal: true }],
];

describe('childReclaimStaleVerdict: the stale step after the sweep verdict (D-6639)', () => {
  it('the ceiling is seven days', () => {
    expect(CHILD_STALE_IDLE_MS).toBe(7 * DAY);
  });

  for (const [why, word, over] of WORDS) {
    it(`${why}: kept at 6 idle days, stale-eligible as "${word}" at 8`, () => {
      expect(childReclaimSweepVerdict(base({ ...over, idle: idleFor(6 * DAY) })), 'CONTROL: the base verdict is the kept word')
        .toMatchObject({ eligible: false, why });
      expect(childReclaimStaleVerdict(base({ ...over, idle: idleFor(6 * DAY) }))).toEqual({ stale: false });
      expect(childReclaimStaleVerdict(base({ ...over, idle: idleFor(8 * DAY) })))
        .toMatchObject({ stale: true, word, runId: 7 });
    });
  }

  it('exactly at the ceiling is not past it', () => {
    expect(childReclaimStaleVerdict(base({ ...WORDS[1]![2], idle: idleFor(CHILD_STALE_IDLE_MS) }))).toEqual({ stale: false });
    expect(childReclaimStaleVerdict(base({ ...WORDS[1]![2], idle: idleFor(CHILD_STALE_IDLE_MS + 1) })).stale).toBe(true);
  });

  it('a hand hold (text outside the programme grammar) at 8 days is stale-eligible, and carries its text and digest', () => {
    const v = childReclaimStaleVerdict(base({ ...WORDS[0]![2] }));
    expect(v).toEqual({ stale: true, word: 'held', runId: 7, holdDigest: HAND_DIGEST, holdText: HAND });
  });

  it('a programme hold that still has an open run is stale-eligible as held too', () => {
    const reason = holdReason('prog', 2, null, null);
    const v = childReclaimStaleVerdict(base({
      held: { kind: 'program', reason, program: 'prog', accountedRunId: 7, open: { ok: true, count: 1 } },
      holdDigest: sha(reason),
    }));
    expect(v).toMatchObject({ stale: true, word: 'held', holdText: reason });
  });

  it('a hold whose bytes are unknown (no digest) is kept: the box could not be told which hold to pass', () => {
    expect(childReclaimStaleVerdict(base({ ...WORDS[0]![2], holdDigest: null }))).toEqual({ stale: false });
  });

  it('a review child whose reviewed run is still open, at 8 days, is stale-eligible (ruled, spec §9.1 item 16)', () => {
    expect(childReclaimStaleVerdict(base({ ...WORDS[2]![2] }))).toMatchObject({ stale: true, word: 'review' });
    expect(childReclaimStaleVerdict(base({ ...WORDS[3]![2] }))).toMatchObject({ stale: true, word: 'review' });
  });

  it('coordinating is kept at 30 days, and so is a held child that has coordinated', () => {
    expect(childReclaimStaleVerdict(base({ coordinatorClaim: 'open', idle: idleFor(30 * DAY) }))).toEqual({ stale: false });
    for (const [, , over] of WORDS) {
      expect(childReclaimStaleVerdict(base({ ...over, coordinatorClaim: 'open', idle: idleFor(30 * DAY) })), JSON.stringify(over))
        .toEqual({ stale: false });
    }
    expect(childReclaimStaleVerdict(base({ ...WORDS[0]![2], coordinatorClaim: 'unplaced', idle: idleFor(30 * DAY) }))).toEqual({ stale: false });
  });

  it('any idle input unmeasured keeps the child', () => {
    expect(childReclaimStaleVerdict(base({ ...WORDS[1]![2], idle: 'unmeasured' }))).toEqual({ stale: false });
    // one fresh input among old ones is activity
    for (const k of ['runAt', 'mailAt', 'statusAt', 'holdAt'] as const) {
      expect(childReclaimStaleVerdict(base({ ...WORDS[1]![2], idle: { ...idleFor(30 * DAY), [k]: NOW - DAY } })), k)
        .toEqual({ stale: false });
    }
    // no instant at all is no evidence, not idleness
    expect(childReclaimStaleVerdict(base({ ...WORDS[1]![2], idle: { runAt: null, mailAt: null, statusAt: null } })))
      .toEqual({ stale: false });
    // a stamp from the future is activity, and a non-number measures nothing
    expect(childReclaimStaleVerdict(base({ ...WORDS[1]![2], idle: { ...idleFor(30 * DAY), mailAt: NOW + DAY } }))).toEqual({ stale: false });
    expect(childReclaimStaleVerdict(base({ ...WORDS[1]![2], idle: { ...idleFor(30 * DAY), mailAt: Number.NaN } }))).toEqual({ stale: false });
  });

  it('an open run naming the workspace, an unreadable sibling list, or an unplaced birth keeps it', () => {
    expect(childReclaimStaleVerdict(base({ ...WORDS[1]![2], siblings: { ok: true, open: 1 } }))).toEqual({ stale: false });
    expect(childReclaimStaleVerdict(base({ ...WORDS[1]![2], siblings: { ok: false, detail: 'x' } }))).toEqual({ stale: false });
    expect(childReclaimStaleVerdict(base({ ...WORDS[0]![2], childBornAt: null }))).toEqual({ stale: false });
  });

  it('the doubt words and the other kept words never reach it, whatever the idleness', () => {
    const never: readonly Partial<ChildReclaimSweepInput>[] = [
      { workspace: null },                                                                // not-a-workspace
      { held: { kind: 'unmeasured', reason: 'x', detail: 'd' } },                          // hold-unmeasured
      { mintingRun: { ok: false, detail: 'd' } },                                          // minting-run-unreadable
      { reviewedRun: { kind: 'absent' } },                                                 // reviewed-run-absent
      { reviewedRun: { kind: 'unreadable', detail: 'd' } },
      { childBornAt: null },                                                               // child-birth-unplaced
      { identityMeasured: false },
      { child: { kind: 'none' } },
    ];
    for (const over of never) {
      expect(childReclaimStaleVerdict(base({ ...over, idle: idleFor(60 * DAY) })), JSON.stringify(over)).toEqual({ stale: false });
    }
  });

  it('the stale step never changes the sweep verdict: it is a second answer beside it', () => {
    const i = base({ ...WORDS[1]![2] });
    expect(childReclaimSweepVerdict(i)).toEqual({ eligible: false, why: 'minting-run-absent', runId: 7 });
  });

  it('the sentences of the words that lapse say so, and the others do not', () => {
    for (const w of ['held', 'minting-run-absent', 'review-report-stale'] as const) {
      expect(CHILD_RECLAIM_SKIP[w].sentence, w).toContain('seven days');
    }
    expect(CHILD_RECLAIM_SKIP.coordinating.sentence).not.toContain('seven days');
    expect(CHILD_RECLAIM_SKIP['reviewed-run-absent'].sentence).not.toContain('seven days');
  });
});

// ── 2. the lane ──────────────────────────────────────────────────────────────────────────────────────────────────

const T0 = 1_790_000_000_000;
const GEN = '1790000000000000000';
const STALE_FEED = 'child would be reclaimed (stale)';

interface LaneOpts { cap?: boolean; armed?: boolean; supersededArmed?: boolean }

const lane = (opts: LaneOpts = {}) => {
  let clock = T0;
  let mono = 5_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-child-stale-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  if (opts.armed === true) writeFileSync(path.join(reg, CHILD_STALE_RECLAIM_LIVE_MARKER), '');
  if (opts.supersededArmed === true) writeFileSync(path.join(reg, CHILD_SUPERSEDED_RECLAIM_LIVE_MARKER), '');
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const requests: ChildReclaimRequest[] = [];
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  const deps = {
    ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), cfg, coord, notifyLog,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP,
        ...(opts.cap === false ? [] : [RECLAIM_STALE_CAP])] },
    viewers: { isVisible: () => false },
    childReclaimExec: async (req: ChildReclaimRequest): Promise<ChildReclaimOutcome> => {
      requests.push(req);
      return answer(req);
    },
    monotonicMs: () => mono,
  };
  let answer = (req: ChildReclaimRequest): ChildReclaimOutcome =>
    ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 });
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  let uidN = 0;
  const journal = (id: string, outcome: string, refusal: string | null, act: 'reclaim' | 'create' = 'reclaim',
    verb: 'ws-reclaim' | 'ws-audit' = 'ws-reclaim'): void => {
    uidN += 1;
    const line = JSON.stringify({ uid: `s.1.${uidN}`, at: clock, act, outcome, verb: act === 'create' ? 'ws-add' : verb, id,
      ...(refusal === null ? {} : { refusal }) });
    coord.ingestJournal({ gen: GEN, rows: [parseJournalLine(line)], cursor: uidN * 200, size: uidN * 200, at: clock });
  };
  const plant = (id: string, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1', ...extra,
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    // the hold's write time is activity: date it on the lane's clock, not the machine's
    if ('hold' in fields) utimesSync(path.join(reg, `${id}.hold`), clock / 1000, clock / 1000);
    journal(id, 'done', null, 'create');
  };
  let progN = 0;
  const openRun = (): { id: number; program: string } => {
    const program = `stale-prog-${++progN}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    return { id: r.id, program };
  };
  const abandon = (r: { id: number; program: string }): void => {
    const res = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: r.program, viaClosing: false });
    if (!res.ok) throw new Error(`abandon refused: ${JSON.stringify(res)}`);
  };
  const pass = async (): Promise<void> => {
    await watcher.sweepChildReclaim(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  const advance = (ms: number): void => { clock += ms; mono += ms; };
  const next = (): void => advance(CHILD_RECLAIM_SWEEP_MS + 1);
  /** Passes spaced one sweep interval apart, `n` of them. */
  const passes = async (n: number): Promise<void> => { for (let k = 0; k < n; k += 1) { await pass(); next(); } };
  const feedTitles = (): string[] => coord.feedEvents(200).map((e) => e.title);
  const mailFromOperator = (): number =>
    (coord.db.prepare("SELECT COUNT(*) AS n FROM mail WHERE fromId = 'operator'").get() as { n: number }).n;
  /** A review of `work` that ended `done`; the work run stays open. */
  const closedReview = (work: { id: number; program: string }): number => {
    const r = coord.openRun({ program: work.program, title: work.program, project: 'demo', wave: 1, waveOf: null,
      claimedBy: 'demo-coord', kind: 'review', reviews: work.id });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    for (const to of ['dispatched', 'working', 'done'] as const) {
      const moved = coord.advance(r.id, to, 'test');
      if (!moved.ok) throw new Error(`advance refused: ${JSON.stringify(moved)}`);
    }
    return r.id;
  };
  return { reg, coord, watcher, requests, closedReview, plant, openRun, abandon, journal, pass, passes, advance, next, feedTitles,
    mailFromOperator, io: deps.io, now: () => clock, answerWith: (f: typeof answer) => { answer = f; } };
};

/** A finished child under a hand hold, abandoned at T0; the clock then moves `days` and a pass is taken. */
const heldChild = (f: ReturnType<typeof lane>, id = 'demo-a'): { runId: number } => {
  const r = f.openRun();
  f.abandon(r);
  f.plant(id, { child: String(r.id), hold: HAND });
  return { runId: r.id };
};

describe('sweepChildReclaim: the stale arm (D-6639)', () => {
  it('armed: a hand-held child idle 6 days is asked of nothing; at 8 days the request carries --stale held and the digest', async () => {
    const f = lane({ armed: true });
    const { runId } = heldChild(f);
    f.advance(6 * DAY); await f.passes(3);
    expect(f.requests, 'kept at six idle days').toEqual([]);
    f.advance(2 * DAY); await f.passes(3);
    expect(f.requests).toEqual([{
      sessionId: 'demo-a', runId, trigger: 'sweep', deferExpired: false, deferredSinceMs: null,
      feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'absent' },
      stale: { word: 'held', holdDigest: HAND_DIGEST, holdText: HAND },
    }]);
  });

  it.each([['a trailing newline, as `echo reason > hold` writes it', 'operator parked this on purpose\n'],
    ['leading and trailing whitespace', '  spaced reason \r\n\n'],
    ['an empty file (touch)', ''],
    ['whitespace only', ' \n']])('armed: a hand hold with %s is asked with the digest of the FILE bytes, not of the trimmed reason', async (_n, bytes) => {
    const f = lane({ armed: true });
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-a', { child: String(r.id), hold: bytes });
    f.advance(8 * DAY); await f.passes(3);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.stale?.word).toBe('held');
    expect(f.requests[0]!.stale?.holdDigest).toBe(sha(bytes));
  });

  it('armed: a hold written at day 8 on an idle child is not asked until 7 days after the hold (writing a hold is activity)', async () => {
    const f = lane({ armed: true });
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-a', { child: String(r.id) });
    f.advance(8 * DAY);
    writeFileSync(path.join(f.reg, 'demo-a.hold'), HAND);
    utimesSync(path.join(f.reg, 'demo-a.hold'), f.now() / 1000, f.now() / 1000);
    await f.passes(4);
    expect(f.requests, 'the hold was just written').toEqual([]);
    f.advance(6 * DAY); await f.passes(3);
    expect(f.requests, 'six days after the hold').toEqual([]);
    f.advance(2 * DAY); await f.passes(3);
    expect(f.requests.map((q) => q.stale?.word)).toEqual(['held']);
  });

  it('armed: a hold whose write time cannot be read keeps the child', async () => {
    const f = lane({ armed: true });
    heldChild(f);
    f.advance(30 * DAY);
    const stat = vi.spyOn(f.io, 'statMeasured').mockResolvedValue({ ok: false, reason: 'unreadable' } as never);
    await f.passes(4);
    expect(stat).toHaveBeenCalled();
    expect(f.requests).toEqual([]);
  });

  it('a hold is not dated for a child that is not yet past the ceiling', async () => {
    const f = lane({ armed: true });
    heldChild(f);
    const read = vi.spyOn(f.io, 'statMeasured');
    f.advance(2 * DAY); await f.passes(3);
    expect(read.mock.calls.filter((c) => String(c[0]).endsWith('.hold'))).toEqual([]);
  });

  it('held stale children are read together in the pass\'s one gather, never one by one inside its loop', async () => {
    const f = lane({ armed: true });
    heldChild(f, 'demo-a'); heldChild(f, 'demo-b');
    f.advance(8 * DAY);
    const real = f.io.statMeasured.bind(f.io);
    let open = 0; let peak = 0;
    vi.spyOn(f.io, 'statMeasured').mockImplementation(async (p: string) => {
      if (!String(p).endsWith('.hold')) return real(p);
      open += 1; peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 20));
      open -= 1;
      return real(p);
    });
    await f.pass();
    expect(peak, 'both holds were being dated at once').toBe(2);
  });

  it('armed: the stale child is asked on the second pass, never the first (twice observed, as every reclaim)', async () => {
    const f = lane({ armed: true });
    heldChild(f);
    f.advance(8 * DAY);
    await f.pass();
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('an ordinary eligible child is asked WITHOUT a stale field, armed or not', async () => {
    const f = lane({ armed: true });
    const r = f.openRun(); f.abandon(r); f.plant('demo-a', { child: String(r.id) });
    await f.passes(2);
    expect(f.requests).toHaveLength(1);
    expect('stale' in f.requests[0]!).toBe(false);
  });

  it('shadow: no request, one "would be reclaimed (stale)" row per child and word, and no mail', async () => {
    const f = lane({});
    const { runId } = heldChild(f);
    f.advance(8 * DAY); await f.passes(4);
    expect(f.requests).toEqual([]);
    expect(f.feedTitles().filter((t) => t === STALE_FEED)).toHaveLength(1);
    expect(f.mailFromOperator(), 'shadow tells nobody').toBe(0);
    const row = f.coord.feedEvents(200).find((e) => e.title === STALE_FEED)!;
    expect(row.body).toContain('demo-a');
    expect(row.body).toContain(`run #${runId}`);
  });

  it('shadow is shadow while the marker is absent, and the same child is asked once it appears', async () => {
    const f = lane({});
    heldChild(f);
    f.advance(8 * DAY); await f.passes(3);
    expect(f.requests).toEqual([]);
    writeFileSync(path.join(f.reg, CHILD_STALE_RECLAIM_LIVE_MARKER), '');
    await f.passes(3);
    expect(f.requests.map((q) => q.stale?.word)).toEqual(['held']);
  });

  it('a box without reclaim-stale-v1 is never sent the flag, and records nothing either', async () => {
    const armed = lane({ armed: true, cap: false });
    heldChild(armed);
    armed.advance(8 * DAY); await armed.passes(4);
    expect(armed.requests).toEqual([]);
    const shadow = lane({ cap: false });
    heldChild(shadow);
    shadow.advance(8 * DAY); await shadow.passes(4);
    expect(shadow.feedTitles().filter((t) => t === STALE_FEED)).toEqual([]);
  });

  it('a held child that has coordinated is kept at 30 days', async () => {
    const f = lane({ armed: true });
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-a', { child: String(r.id), hold: HAND });
    const c = f.coord.openRun({ program: 'own', title: 'own', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-a' });
    if (!('id' in c)) throw new Error('refused');
    f.abandon({ id: c.id, program: 'own' });
    f.advance(30 * DAY); await f.passes(4);
    expect(f.requests).toEqual([]);
  });

  it('mail from the child inside the window is activity: the child is kept', async () => {
    const f = lane({ armed: true });
    heldChild(f);
    f.advance(8 * DAY);
    const m = f.coord.insertMail({ fromId: 'demo-a', fromUuid: 'u', toId: 'demo-coord', runId: null, kind: 'status',
      subject: 's', body: 'b', artifacts: [] });
    expect(m.id).toBeGreaterThan(0);
    await f.passes(4);
    expect(f.requests, 'the child spoke a moment ago').toEqual([]);
  });

  it('a run-absent child (no minting run in the database) is stale-eligible and asked with --stale run-absent', async () => {
    const f = lane({ armed: true });
    f.plant('demo-a', { child: '999' });
    // run-absent has no run events to date its idleness, so the registry's own stamps do
    writeFileSync(path.join(f.reg, 'demo-a.lastend'), `${Math.floor(T0 / 1000)} gone`);
    f.advance(8 * DAY); await f.passes(3);
    expect(f.requests.map((q) => q.stale?.word)).toEqual(['run-absent']);
  });

  it('a terminal child is asked again after 7 more idle days and not before', async () => {
    const f = lane({ armed: true });
    const { runId } = heldChild(f);
    // not held: replace the hold with a terminal refusal from the mirror
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-t', { child: String(r.id) });
    f.journal('demo-t', 'refused', 'containment-unproven');
    f.answerWith((req) => ({ kind: 'refused', sessionId: req.sessionId, runId: req.runId, token: 'containment-unproven',
      sentence: 's', detail: 'd' }));
    expect(runId).toBeGreaterThan(0);
    f.advance(8 * DAY); await f.passes(3);
    const askedT = () => f.requests.filter((q) => q.sessionId === 'demo-t');
    expect(askedT().map((q) => q.stale?.word)).toEqual(['terminal']);
    f.advance(6 * DAY); await f.passes(3);
    expect(askedT(), 'not before seven more days').toHaveLength(1);
    f.advance(2 * DAY); await f.passes(3);
    expect(askedT(), 'asked again once').toHaveLength(2);
  });
});

// ── 3. the executor ──────────────────────────────────────────────────────────────────────────────────────────────

const ID = 'demo-quiet-basin';
const TOK = 'a'.repeat(64);
const REF = `refs/ccrc/attic/${ID}/0123456789abcdef`;
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-reclaim', 'ws-attic', 'reclaim-v1', 'actor-flags-v1', RECLAIM_STALE_CAP] };

const rig = async (over: { fleetState?: FleetState; claimedBy?: string | null; program?: string } = {}) => {
  const home = mkTmp('ccrc-child-stale-exec-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: over.claimedBy ?? 'demo-coordinator' });
  if (!('id' in opened)) throw new Error('openRun refused');
  const runId = opened.id;
  coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
  expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p', viaClosing: false }).ok).toBe(true);
  const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
    started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main', child: String(runId) };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'ws-audit') return { ran: true, code: 0, stdout: JSON.stringify({ id: ID, mode: 'reclaim', childOf: runId, verdict: 'reclaimable', token: TOK, detail: '' }), stderr: '' };
    if (args[0] === 'ws-reclaim') return { ran: true, code: 0, stdout: JSON.stringify({ reclaimed: ID, childOf: runId, wip: null, attic: 1, residueBytes: null, secretsDropped: 0 }), stderr: '' };
    if (args[0] === 'ws-attic') return { ran: true, code: 0, stdout: `${REF} ${'c'.repeat(40)}\n`, stderr: '' };
    return { ran: true, code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: over.fleetState ?? CAPS,
    viewers: { isVisible: () => false }, notifyLog };
  const req = (stale: ChildReclaimRequest['stale']): ChildReclaimRequest =>
    ({ sessionId: ID, runId, trigger: 'sweep', deferExpired: false, deferredSinceMs: null,
       feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'absent' }, ...(stale === undefined ? {} : { stale }) });
  const mail = () => coord.db.prepare("SELECT toId, kind, subject, body FROM mail WHERE fromId = 'operator'").all() as
    { toId: string; kind: string; subject: string; body: string }[];
  const feed = () => coord.feedEvents(50).map((e) => e.title);
  return { coord, deps, calls, req, mail, feed, runId };
};

describe('reclaimChild on the stale arm (D-6639)', () => {
  it('the audit and the verb carry --stale and the digest; the coordinator is mailed the attic refs and the hold’s text', async () => {
    const r = await rig();
    const out = await reclaimChild(r.deps, r.req({ word: 'held', holdDigest: HAND_DIGEST, holdText: HAND }));
    expect(out.kind).toBe('reclaimed');
    const audit = r.calls.find((c) => c[0] === 'ws-audit')!;
    const verb = r.calls.find((c) => c[0] === 'ws-reclaim')!;
    for (const argv of [audit, verb]) {
      expect(argv).toContain('--stale');
      expect(argv[argv.indexOf('--stale') + 1]).toBe('held');
      expect(argv[argv.indexOf('--hold-digest') + 1]).toBe(HAND_DIGEST);
    }
    const mails = r.mail();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ toId: 'demo-coordinator', kind: 'status' });
    expect(mails[0]!.body).toContain(ID);
    expect(mails[0]!.body).toContain(REF);
    expect(mails[0]!.body).toContain(HAND);
    expect(mails[0]!.body).toContain('git worktree add');
  });

  it('a review word passes no digest and says so in the mail', async () => {
    const r = await rig();
    await reclaimChild(r.deps, r.req({ word: 'review', holdDigest: null, holdText: null }));
    const verb = r.calls.find((c) => c[0] === 'ws-reclaim')!;
    expect(verb).toContain('--stale');
    expect(verb).not.toContain('--hold-digest');
    expect(r.mail()[0]!.body).toContain('review');
  });

  it('an ordinary request carries no stale flag and mails nobody', async () => {
    const r = await rig();
    await reclaimChild(r.deps, r.req(undefined));
    for (const c of r.calls) expect(c).not.toContain('--stale');
    expect(r.mail()).toEqual([]);
  });

  it('a run-absent child has no coordinator: a coord feed row, and no mail', async () => {
    const r = await rig();
    // the run the marker names is gone from the database; the coordinator read has nobody to answer
    const spy = vi.spyOn(r.coord, 'run').mockReturnValue({ ok: true, run: null });
    const out = await reclaimChild(r.deps, r.req({ word: 'run-absent', holdDigest: null, holdText: null }));
    expect(out.kind).toBe('reclaimed');
    expect(spy).not.toHaveBeenCalledWith(r.runId);
    expect(r.mail()).toEqual([]);
    expect(r.feed()).toContain('stale child reclaimed');
  });

  it('the mail is not sent when the reclaim did not finish', async () => {
    const r = await rig();
    const run: Runner = async (_c, args) => (args[0] === 'ws-audit'
      ? { ran: true, code: 0, stdout: JSON.stringify({ id: ID, mode: 'reclaim', childOf: r.runId, verdict: 'not-idle', detail: 'worked yesterday' }), stderr: '' }
      : { ran: true, code: 1, stdout: '', stderr: '' });
    const base = testDeps(mkTmp('ccrc-child-stale-exec2-'), run);
    const out = await reclaimChild({ ...r.deps, runCcd: base.runCcd }, r.req({ word: 'review', holdDigest: null, holdText: null }));
    expect(out).toMatchObject({ kind: 'deferred', why: 'not-idle' });
    expect(r.mail()).toEqual([]);
  });

  it('a box without reclaim-stale-v1 defers a stale request unsupported and sends nothing', async () => {
    const r = await rig({ fleetState: { ...CAPS, ccdVerbs: CAPS.ccdVerbs!.filter((v) => v !== RECLAIM_STALE_CAP) } });
    const out = await reclaimChild(r.deps, r.req({ word: 'review', holdDigest: null, holdText: null }));
    expect(out).toMatchObject({ kind: 'deferred', why: 'unsupported' });
    expect(r.calls).toEqual([]);
  });
});

describe('sweepChildReclaim: the superseded review release (D-6922)', () => {
  const SUPERSEDED_FEED = 'review report would be reclaimed (superseded)';
  /** Two closed reviews of one open work run, each with a child workspace: `demo-a` the earlier, `demo-b` the newest. */
  const twoReviews = (f: ReturnType<typeof lane>): void => {
    const work = f.openRun();
    f.plant('demo-a', { child: String(f.closedReview(work)) });
    f.plant('demo-b', { child: String(f.closedReview(work)) });
  };

  it('shadowed: records once for the earlier review child, requests nothing, and never names the newest', async () => {
    const f = lane();
    twoReviews(f);
    await f.passes(4);
    expect(f.requests).toEqual([]);
    const rows = f.coord.feedEvents(200).filter((e) => e.title === SUPERSEDED_FEED);
    expect(rows.map((e) => e.sessionId)).toEqual(['demo-a']);
  });

  it('armed: the earlier review child is reclaimed after two sightings, the newest stays', async () => {
    const f = lane({ supersededArmed: true });
    twoReviews(f);
    await f.passes(4);
    expect([...new Set(f.requests.map((q) => q.sessionId))], 'the fixture box leaves the row standing, so it is asked again').toEqual(['demo-a']);
    expect(f.requests[0]!.stale, 'an ordinary sweep reclaim, not the stale arm').toBeUndefined();
    expect(f.feedTitles()).not.toContain(SUPERSEDED_FEED);
  });

  it('shadowed: a superseded review child kept for another reason (a hand hold) is not recorded', async () => {
    const f = lane();
    const work = f.openRun();
    f.plant('demo-a', { child: String(f.closedReview(work)), hold: HAND });
    f.plant('demo-b', { child: String(f.closedReview(work)) });
    await f.passes(4);
    expect(f.feedTitles()).not.toContain(SUPERSEDED_FEED);
  });

  it('shadowed: a superseded review child with a sibling run open is not recorded (armed, it would still be kept)', async () => {
    const f = lane();
    twoReviews(f);
    const sibling = f.openRun();
    f.coord.markDispatched(sibling.id, 'demo-a', 'demo-a', 'ws/demo-a', false);
    await f.passes(4);
    expect(f.requests).toEqual([]);
    expect(f.feedTitles()).not.toContain(SUPERSEDED_FEED);
  });

  it('a later review that has not closed, or the work run closing, changes nothing for the newest and releases as before', async () => {
    const f = lane({ supersededArmed: true });
    const work = f.openRun();
    f.plant('demo-a', { child: String(f.closedReview(work)) });
    await f.passes(4);
    expect(f.requests, 'the only review is the newest').toEqual([]);
    f.abandon(work);
    await f.passes(4);
    expect([...new Set(f.requests.map((q) => q.sessionId))], 'the reviewed run closed: released as before').toEqual(['demo-a']);
  });
});
