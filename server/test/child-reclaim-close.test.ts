// Child reclamation, wave 3 — close DECIDES, it does not wait (spec
// 2026-09-22 §5.7). `closeRun` called directly, with a RECORDING port in place
// of the route's queue, so each case can say exactly when the hand-off
// happened relative to the commit, with what request, and what the close
// answered — none of which a route-level test can isolate.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import type { ChildReclaimRequest } from '../src/coord/childReclaim.js';
import type { Runner } from '../src/exec.js';
import type { FleetIO } from '../src/io.js';
import type { RunState } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const ID = 'demo-quiet-basin';
const CLAIMED_BY = 'demo-coordinator';
/** `build()`'s `acts()` returns every verb the runner saw, `pr-state` included
 *  (the A2/P6 cases below make a live gh-shaped call); this narrows to the
 *  three fleet acts a close can ever choose between. */
const fleetActs = (acts: string[]): string[] =>
  acts.filter((a) => a === 'ws-hold' || a === 'ws-release' || a === 'ws-archive');
/** An abandon-shaped ordinary close (`state:'failed'` skips `verifyDone`, D-49)
 *  — the one ordinary-path body a fixture with no git repo can drive. */
const FAILED_CLOSE = { fingerprint: { branchTip: 'x', prNumber: null, prPhase: 'open', handoffCommit: 'x' },
  final: false, state: 'failed' };

interface Handed { req: ChildReclaimRequest; stateAtCall: RunState | undefined }

const build = (over: { io?: FleetIO; port?: 'record' | 'throw' | 'none';
  prState?: { code: number; stdout: string; stderr: string } } = {}) => {
  const home = mkTmp('ccrc-child-reclaim-close-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'pr-state') return over.prState ?? { code: 0, stdout: '', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const handed: Handed[] = [];
  const port = over.port ?? 'record';
  const deps: CloseRunDeps = {
    coord, io: over.io ?? base.io, cfg: base.cfg, runCcd: base.runCcd,
    ...(port === 'none' ? {} : {
      childReclaim: (req: ChildReclaimRequest) => {
        if (port === 'throw') throw new Error('the queue is on fire');
        handed.push({ req, stateAtCall: okRun(coord.run(req.runId))?.state });
      },
    }),
  };
  /** A run of `program`, dispatched into `session`. */
  const dispatched = (session: string, wave = 1, program = 'p'): number => {
    const r = coord.openRun({ program, title: 't', project: 'demo', wave, waveOf: 3, claimedBy: CLAIMED_BY });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, session, session, `ws/${session}`, false);
    expect(coord.advance(r.id, 'dispatched', 'test').ok).toBe(true);
    return r.id;
  };
  /** The registry row `ws-add` writes, and — unless `mark` is null — the
   *  `.child` marker `ws-add --child` writes beside it. */
  const seed = (session: string, mark: string | null): void => {
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${session}`,
      uuid: `u-${session}`, started: '1', workspace: session, branch: `ws/${session}`, base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${session}.${k}`), v);
    if (mark !== null) writeFileSync(path.join(reg, `${session}.child`), mark);
  };
  /** A REVIEW run of `reviews`, dispatched into `session` (spec §5.7):
   *  the reviewer child is minted by THIS run, and the run it reads is
   *  `reviews`. `REVIEW_RUN_TRANSITIONS` has no planned->working edge, so the
   *  `dispatched` hop is the store's own machine. */
  const reviewDispatched = (session: string, reviews: number): number => {
    const r = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 3, claimedBy: CLAIMED_BY,
      kind: 'review', reviews });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, session, session, `ws/${session}`, false);
    expect(coord.advance(r.id, 'dispatched', 'test').ok).toBe(true);
    return r.id;
  };
  const acts = () => calls.map((c) => c[0]);
  return { home, reg, coord, deps, handed, dispatched, reviewDispatched, seed, acts };
};

describe('the hand-off happens AFTER the commit, and only after it', () => {
  it('an abandoned child is handed off once, with the MINTING run, after its run went terminal', async () => {
    const b = build();
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    const out = await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
    expect(out).toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'queued' });
    // `deferredSinceMs: null` — close is always a first attempt: it has no wait to report (spec §5.7).
    expect(b.handed).toEqual([{ req: { sessionId: ID, runId: id, trigger: 'close', deferExpired: false,
                                       deferredSinceMs: null },
                                stateAtCall: 'failed' }]);
    expect(b.acts()).toEqual(['ws-release']);
  });

  it('a child that handed over across waves is reclaimed under the run that MINTED it', async () => {
    const b = build();
    const minted = b.dispatched(ID, 1);
    b.seed(ID, String(minted));
    expect(b.deps.coord.closeRun({ runId: minted, finalState: 'done', causedBy: 'test', handoffCommit: null,
      program: 'p', viaClosing: true }).ok).toBe(true);
    const wave2 = b.dispatched(ID, 2);
    const out = await closeRun(b.deps, wave2, { intent: 'abandon' }, 'operator');
    expect(out).toMatchObject({ ok: true, childReclaim: 'queued' });
    expect(b.handed.map((h) => h.req.runId)).toEqual([minted]);
  });

  it('a commit that fails hands nothing off — a reclaim can never outrun an un-closed run', async () => {
    const b = build();
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    b.deps.coord.closeRun = () => ({ ok: false, error: 'unknown-run' });
    const out = await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
    expect(out).toMatchObject({ ok: false, kind: 'advanceFailed' });
    expect(b.handed).toEqual([]);
  });

  it('a port that throws leaves the close committed, answered not-queued with no reason', async () => {
    const b = build({ port: 'throw' });
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    const out = await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
    expect(out).toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'not-queued' });
    expect(okRun(b.deps.coord.run(id))!.state).toBe('failed');
  });

  it('no port wired: an eligible child is not-queued with no reason — the sweep’s to reach', async () => {
    const b = build({ port: 'none' });
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'not-queued' });
  });
});

describe('two authorities, equal — anything else is not a child here', () => {
  it.each<[string, (id: number) => string | null, string]>([
    ['no marker', () => null, 'not-a-child'],
    ['a marker naming a run the database does not have', () => '999', 'not-a-child'],
    ['a marker that is not a run id', () => 'seven', 'marker-unreadable'],
  ])('%s', async (_what, mark, why) => {
    const b = build();
    const id = b.dispatched(ID);
    b.seed(ID, mark(id));
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ ok: true, released: true, childReclaim: 'not-queued', childReclaimWhy: why });
    expect(b.handed).toEqual([]);
  });

  it('a marker naming a run bound to ANOTHER session', async () => {
    const b = build();
    const other = b.dispatched('demo-other-mesa');
    const id = b.dispatched(ID);
    b.seed(ID, String(other));
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
  });

  it('an UNLISTABLE registry defers — and the abandon valve still closes the run (D-275)', async () => {
    const b0 = build();
    const b = build({ io: { ...b0.deps.io, readdir: async () => null } });
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ ok: true, state: 'failed', released: true, childReclaim: 'not-queued', childReclaimWhy: 'marker-unreadable' });
  });

  it('an open sibling keeps the workspace claimed and queues nothing', async () => {
    const b = build();
    const id = b.dispatched(ID, 1);
    b.seed(ID, String(id));
    const next = b.deps.coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 2, waveOf: 3, claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error('openRun refused');
    b.deps.coord.setSession(next.id, ID);
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ ok: true, released: false, childReclaim: 'not-queued', childReclaimWhy: 'siblings-open' });
    expect(fleetActs(b.acts())).toEqual(['ws-hold']);
  });

  // Amendment A6 / controller ruling P5: `readSessionRecord`'s `absent` covers
  // two populations — no `.uuid` in a listing that succeeded, and a row
  // `buildRecord` DROPPED though the workspace is still live and marked. A
  // live marked child whose row could not be built must not read as
  // `not-a-child` — a remedy-bearing word it is not entitled to — so the
  // close re-lists once (`childReclaimRowListing`) and answers `unreadable`
  // when `.child` is still listed.
  it('a DROPPED row (.workdir emptied) whose .child is still listed defers marker-unreadable, never not-a-child', async () => {
    const b = build();
    const id = b.dispatched(ID);
    b.seed(ID, String(id));
    writeFileSync(path.join(b.reg, `${ID}.workdir`), '');   // buildRecord drops this row
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ ok: true, released: true, childReclaim: 'not-queued', childReclaimWhy: 'marker-unreadable' });
    expect(b.handed).toEqual([]);
  });

  // Review m1 (P5): a dropped row with NO `.child` marker at all is a
  // `.uuid`-only listing — `none` at close, never `unreadable`. Without this
  // case, folding `.uuid` into the "still listed" condition (so it reads
  // `unreadable` too) stays green.
  it('a DROPPED row with NO .child marker — a .uuid-only listing is none at close (P5)', async () => {
    const b = build();
    const id = b.dispatched(ID);
    b.seed(ID, null);   // no `.child` marker written at all
    writeFileSync(path.join(b.reg, `${ID}.workdir`), '');   // buildRecord drops this row -> absent
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator'))
      .toMatchObject({ ok: true, released: true, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
    expect(b.handed).toEqual([]);
  });
});

describe('the fleet act for a finished child is a RELEASE — never a hold, never an archive', () => {
  it('an ordinary non-final failed close of a child releases it; of a non-child, it re-holds as ever', async () => {
    const child = build();
    const c = child.dispatched(ID);
    child.seed(ID, String(c));
    child.dispatched('demo-next-wave', 2);                  // keeps program p open — the failed close decides
    expect(await closeRun(child.deps, c, FAILED_CLOSE, 'coordinator'))
      .toMatchObject({ ok: true, released: true, childReclaim: 'queued' });
    expect(child.acts()).toEqual(['ws-release']);
    // Review I1: the ORDINARY arm's hand-off must also run AFTER the commit —
    // `stateAtCall` (read from `coord.run` at the moment the port is called)
    // is the run's OWN post-commit state, `failed`, never a pre-commit one.
    expect(child.handed).toEqual([{ req: { sessionId: ID, runId: c, trigger: 'close', deferExpired: false,
                                          deferredSinceMs: null },
                                    stateAtCall: 'failed' }]);

    const plain = build();
    const p = plain.dispatched(ID);
    plain.seed(ID, null);
    plain.dispatched('demo-next-wave', 2);
    expect(await closeRun(plain.deps, p, FAILED_CLOSE, 'coordinator'))
      .toMatchObject({ ok: true, released: false, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
    expect(plain.acts()).toEqual(['ws-hold']);
  });

  // Review I1: a commit that fails on the ORDINARY arm must hand nothing off
  // either — the abandon arm already pins this (`a commit that fails hands
  // nothing off`), but that case exercises `abandon`'s own early return, never
  // the ordinary path's `handOffChildReclaim(deps, childGate)` at close.ts's
  // final return.
  it('an ordinary close whose commit fails hands nothing off — the ordinary arm too', async () => {
    const b = build();
    const c = b.dispatched(ID);
    b.seed(ID, String(c));
    b.dispatched('demo-next-wave', 2);
    b.deps.coord.closeRun = () => ({ ok: false, error: 'unknown-run' });
    const out = await closeRun(b.deps, c, FAILED_CLOSE, 'coordinator');
    expect(out).toMatchObject({ ok: false, kind: 'advanceFailed' });
    expect(b.handed).toEqual([]);
  });

  it('archive:true on a child releases it instead — a child is never archived; a non-child still is', async () => {
    const child = build();
    const c = child.dispatched(ID);
    child.seed(ID, String(c));
    expect(await closeRun(child.deps, c, { ...FAILED_CLOSE, archive: true }, 'coordinator'))
      .toMatchObject({ ok: true, released: true, childReclaim: 'queued' });
    expect(child.acts()).toEqual(['ws-release']);

    const plain = build();
    const p = plain.dispatched(ID);
    plain.seed(ID, null);
    expect(await closeRun(plain.deps, p, { ...FAILED_CLOSE, archive: true }, 'coordinator'))
      .toMatchObject({ ok: true, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
    expect(plain.acts()).toEqual(['ws-archive']);
  });
});

describe('a REVIEW child lives until the run it reviewed is terminal (spec §5.7)', () => {
  it('the review run’s abandon releases the reviewer but keeps it while the reviewed run is open', async () => {
    const b = build();
    const work = b.dispatched('demo-worker-mesa');
    expect(b.deps.coord.advance(work, 'working', 'test').ok).toBe(true);
    expect(b.deps.coord.advance(work, 'awaiting-review', 'test').ok).toBe(true);
    const review = b.reviewDispatched(ID, work);
    b.seed(ID, String(review));
    expect(await closeRun(b.deps, review, { intent: 'abandon' }, 'operator'))
      .toEqual({ ok: true, id: review, state: 'failed', released: true,
                 childReclaim: 'not-queued', childReclaimWhy: 'review-report-live' });
    expect(b.handed, 'the report the coordinator cites by path is not deleted').toEqual([]);
    expect(b.acts()).toEqual(['ws-release']);
  });

  it('once the reviewed run is terminal, the review child is reclaimed like any other', async () => {
    const b = build();
    const work = b.dispatched('demo-worker-mesa');
    const review = b.reviewDispatched(ID, work);
    b.seed(ID, String(review));
    expect(b.deps.coord.advance(work, 'failed', 'test').ok).toBe(true);
    expect(await closeRun(b.deps, review, { intent: 'abandon' }, 'operator'))
      .toEqual({ ok: true, id: review, state: 'failed', released: true, childReclaim: 'queued' });
    expect(b.handed.map((h) => h.req.runId)).toEqual([review]);
  });

  // Review I1: `closeReviewRun` itself (not the abandon arm — the case above
  // reaches the reclaim through `intent:'abandon'`, which closeRun's own
  // abandon branch special-cases for a review run's `run.kind==='review'`
  // target, never calling `closeReviewRun` at all) must ALSO hand off only
  // after ITS OWN commit. `{state:'failed'}` with no `intent` routes through
  // the ordinary `run.kind === 'review'` dispatch into `closeReviewRun`
  // (D-2812: a dead reviewer's fingerprint is optional on a failed close).
  it('a review close (not an abandon) queues a finished review child’s reclaim, after ITS OWN commit', async () => {
    const b = build();
    const work = b.dispatched('demo-worker-mesa');
    const review = b.reviewDispatched(ID, work);
    b.seed(ID, String(review));
    expect(b.deps.coord.advance(work, 'failed', 'test').ok).toBe(true);   // the reviewed run is already terminal
    const out = await closeRun(b.deps, review, { state: 'failed' }, 'coordinator');
    expect(out).toEqual({ ok: true, id: review, state: 'failed', released: true, childReclaim: 'queued' });
    expect(b.handed).toEqual([{ req: { sessionId: ID, runId: review, trigger: 'close', deferExpired: false,
                                       deferredSinceMs: null },
                                stateAtCall: 'failed' }]);
  });
});

// Amendment A2 / controller ruling P6: the close never reclaims on a
// fast-path spent verdict (registry `.prnumber` or `.prhistory`, always
// `incarnation:'unplaced'`) alone — it re-dates the same PR through the live
// rung and decides on THAT answer only. These three cases drive a REAL
// non-final "done" close (verifyDone must pass), each with the programme
// still open, and each must HOLD (`ws-hold` only, `childReclaimWhy:
// 'not-finished'`) — never release on evidence that cannot be placed against
// this child's own birth (a recycled branch slug, spec §5.5).
describe('A2/P6 — the close never reclaims on a fast-path spent verdict alone', () => {
  const BIRTH_MS = Date.parse('2026-09-24T12:00:00Z');
  const HOUR = 3_600_000;
  const iso = (ms: number): string => new Date(ms).toISOString();
  const TIP = 'c'.repeat(40);
  const prRow = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    number: 42, state: 'OPEN', headRefName: `ws/${ID}`, baseRefName: 'main',
    isCrossRepository: false, ours: true, isDraft: false, ...extra,
  });
  const prLine = (rows: Record<string, unknown>[]): string =>
    JSON.stringify({ id: ID, rows, baseShort: 'main', branch: `ws/${ID}`, ahead: 1, tip: 'f'.repeat(40), checkedAt: 1 });

  /** A real git ref for `ws/<ID>` under `<home>/projects/demo` — `testDeps`'s
   *  own default `projectsRoot` (`loadConfig`'s `path.join(home, 'projects')`)
   *  — so the ordinary "done" close's `verifyDone` step can measure a real
   *  branch tip and pass, reaching the spent decision below it. */
  const gitBranch = (home: string, tip: string): void => {
    const heads = path.join(home, 'projects', 'demo', '.git', 'refs', 'heads', 'ws');
    mkdirSync(heads, { recursive: true });
    writeFileSync(path.join(heads, ID), `${tip}\n`);
  };
  const CLAIM = { branchTip: TIP, prNumber: null, handoffCommit: TIP };

  it('(i) the only same-branch row predates the minting run’s birth — HOLD, ws-hold only', async () => {
    const row = prRow({ createdAt: iso(BIRTH_MS - HOUR) });   // an hour before birth: INHERITED, dropped
    const b = build({ prState: { code: 0, stdout: `${prLine([row])}\n`, stderr: '' } });
    gitBranch(b.home, TIP);
    const id = b.dispatched(ID, 1);
    b.deps.coord.markDispatchStarted(id, BIRTH_MS);
    b.seed(ID, String(id));
    b.dispatched('demo-next-wave', 2);   // keeps the programme open
    const out = await closeRun(b.deps, id, { fingerprint: { ...CLAIM, prPhase: 'open' }, final: false }, 'coordinator');
    expect(out).toMatchObject({ ok: true, released: false, childReclaim: 'not-queued', childReclaimWhy: 'not-finished' });
    expect(fleetActs(b.acts())).toEqual(['ws-hold']);
  });

  it('(ii) that row has no createdAt — spent/unplaced, never proven this incarnation — HOLD, ws-hold only', async () => {
    const row = prRow();   // no createdAt at all — an older ccd's shape
    const b = build({ prState: { code: 0, stdout: `${prLine([row])}\n`, stderr: '' } });
    gitBranch(b.home, TIP);
    const id = b.dispatched(ID, 1);
    b.deps.coord.markDispatchStarted(id, BIRTH_MS);
    b.seed(ID, String(id));
    b.dispatched('demo-next-wave', 2);
    const out = await closeRun(b.deps, id, { fingerprint: { ...CLAIM, prPhase: 'open' }, final: false }, 'coordinator');
    expect(out).toMatchObject({ ok: true, released: false, childReclaim: 'not-queued', childReclaimWhy: 'not-finished' });
    expect(fleetActs(b.acts())).toEqual(['ws-hold']);
  });

  it('(iii) the registry .prnumber names an old merged PR whose live row predates birth (the merge-commit path) — HOLD', async () => {
    const merged = prRow({ state: 'MERGED', createdAt: iso(BIRTH_MS - HOUR),
      mergedAt: '2020-01-01T00:00:00Z', mergeCommit: { oid: 'f'.repeat(40) } });
    const b = build({ prState: { code: 0, stdout: `${prLine([merged])}\n`, stderr: '' } });
    gitBranch(b.home, TIP);
    const id = b.dispatched(ID, 1);
    b.deps.coord.markDispatchStarted(id, BIRTH_MS);
    b.seed(ID, String(id));
    writeFileSync(path.join(b.reg, `${ID}.prnumber`), '42');   // the fast path: rung 1
    b.dispatched('demo-next-wave', 2);
    const out = await closeRun(b.deps, id, { fingerprint: { ...CLAIM, prPhase: 'merged' }, final: false }, 'coordinator');
    expect(out).toMatchObject({ ok: true, released: false, childReclaim: 'not-queued', childReclaimWhy: 'not-finished' });
    expect(fleetActs(b.acts())).toEqual(['ws-hold']);
  });

  // The positive mirror of (iii): the redate step does not just refuse a
  // stale fast-path answer, it can also PROMOTE one — a fast-path spent
  // whose live evidence genuinely dates to THIS incarnation still releases.
  // Without this case nothing in the suite ever proves the redate call can
  // turn `unplaced` into `this` (every other spent-releases case reaches
  // `childSpentLive` through `childSpent`'s OWN rung 3, never through this
  // wrapper, because none of them seed a fast-path `.prnumber`/`.prhistory`).
  it('(iv) the registry .prnumber names a PR whose live row IS dated to this incarnation — redated to spent/this, RELEASE', async () => {
    const row = prRow({ createdAt: iso(BIRTH_MS + HOUR) });   // an hour after birth: THIS incarnation
    const b = build({ prState: { code: 0, stdout: `${prLine([row])}\n`, stderr: '' } });
    gitBranch(b.home, TIP);
    const id = b.dispatched(ID, 1);
    b.deps.coord.markDispatchStarted(id, BIRTH_MS);
    b.seed(ID, String(id));
    writeFileSync(path.join(b.reg, `${ID}.prnumber`), '42');   // the fast path: rung 1, always 'unplaced'
    b.dispatched('demo-next-wave', 2);                         // keeps the programme open — the spent verdict decides
    const out = await closeRun(b.deps, id, { fingerprint: { ...CLAIM, prPhase: 'open' }, final: false }, 'coordinator');
    expect(out).toMatchObject({ ok: true, released: true, childReclaim: 'queued' });
    expect(fleetActs(b.acts())).toEqual(['ws-release']);
  });
});

const coordSrc = (f: string): string =>
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', f), 'utf8');

describe('the two seams a runtime case cannot see', () => {
  it('retiresProgram is D-51’s predicate — the store’s one query, this run set aside, no SQL in close.ts', () => {
    const src = coordSrc('close.ts');
    expect(src).toContain('deps.coord.programOpenRunCount(run.program, run.id) === 0');
    expect(src).not.toMatch(/FROM runs/);
  });

  it('the route’s port runs the executor on the SESSION’S OWN queue — the one ws-reap and the naming sweep join', () => {
    // A reclaim started beside the queue instead of on it would race a
    // `POST /workspace/reap` of the same workspace; the timing a runtime case
    // would need to show that is not deterministic, so the seam is pinned by
    // its text: the executor is reached through `deps.queue.run(sessionId, …)`
    // and nowhere else in the file.
    const src = coordSrc('routes.ts');
    expect(src).toContain('void deps.queue.run(req.sessionId, () => reclaimChild({');
    expect(src.match(/reclaimChild\(/g) ?? []).toHaveLength(1);
  });
});
