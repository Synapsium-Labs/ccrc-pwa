// D-8293: a REVIEW child kept past its ceiling (`review-report-stale`, D-5942) is a Waiting on you item with its own control.
// The sweep raises one `release-review` item per review run, held first for the reviewed run's coordinator; the operator's
// Release (`POST /api/items/:id/act`) is the release, which the sweep reads back so the child is no longer kept for that run.
// Neutral names (prog-a, demo-*).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { childReclaimReviewedRun } from '../src/coord/childReclaimStale.js';
import {
  REVIEW_RELEASE_GONE_NOTE, REVIEW_RELEASE_HANDLED_NOTE, reviewReleasePlan, routeReviewReleases, type ReviewReleaseSighting,
} from '../src/coord/reviewRelease.js';
import { childReclaimSweepVerdict, REVIEW_CHILD_CEILING_MS, CHILD_RECLAIM_SKIP, type ChildReclaimSweepInput, type ChildReclaimSweepVerdict } from '../src/childReclaimSweep.js';
import { ASK_GRACE_MS } from '../src/askwindow.js';
import { actAbandons, isReleaseReviewAction, parseItemAction, releaseReviewAction } from '../../shared/ledgers.js';
import { ID_GATE_TOKEN, recorder } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const NOW = 1_790_000_000_000;
const DAY = 24 * 3_600_000;

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; removeTmpFixtures(); });

// ── the verdict ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A review child on every count eligible but for the run it reviewed, which is open. */
const reviewChild = (closedAgo: number, reviewedRun: ChildReclaimSweepInput['reviewedRun'], over: Partial<ChildReclaimSweepInput> = {}): ChildReclaimSweepInput => ({
  sessionId: 'demo-a', child: { kind: 'child', runId: 7 }, identityMeasured: true, generation: { kind: 'absent' },
  workspace: 'demo-a', held: { kind: 'none' }, terminal: false,
  mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 9 * DAY,
    openedAt: NOW - 9 * DAY, closedAt: NOW - closedAgo } },
  reviewedRun, siblings: { ok: true, open: 0 }, coordinatorClaim: undefined,
  childBornAt: NOW - 9 * DAY, skewMs: 120_000, nowMs: NOW, idle: 'unmeasured', holdDigest: null, ...over,
});

describe('the verdict reads the release', () => {
  it('a released review child is eligible past the ceiling, in place of review-report-stale', () => {
    expect(childReclaimSweepVerdict(reviewChild(REVIEW_CHILD_CEILING_MS + 1, { kind: 'run', state: 'working', released: true })))
      .toEqual({ eligible: true, runId: 7 });
  });

  it('and before it, in place of review-report-live', () => {
    expect(childReclaimSweepVerdict(reviewChild(DAY, { kind: 'run', state: 'working', released: true })))
      .toEqual({ eligible: true, runId: 7 });
  });

  it('unreleased, the keep words stand as before', () => {
    expect(childReclaimSweepVerdict(reviewChild(REVIEW_CHILD_CEILING_MS + 1, { kind: 'run', state: 'working' })))
      .toEqual({ eligible: false, why: 'review-report-stale', runId: 7 });
    expect(childReclaimSweepVerdict(reviewChild(REVIEW_CHILD_CEILING_MS + 1, { kind: 'run', state: 'working', released: false })))
      .toEqual({ eligible: false, why: 'review-report-stale', runId: 7 });
  });

  it('every other keep still wins over a release', () => {
    const rel = { kind: 'run', state: 'working', released: true } as const;
    expect(childReclaimSweepVerdict(reviewChild(REVIEW_CHILD_CEILING_MS + 1, rel, { siblings: { ok: true, open: 1 } })))
      .toEqual({ eligible: false, why: 'siblings-open' });
    expect(childReclaimSweepVerdict(reviewChild(REVIEW_CHILD_CEILING_MS + 1, rel, { held: { kind: 'held', reason: 'mine' } })))
      .toEqual({ eligible: false, why: 'held' });
  });

  it('the banner sentence names the item', () => {
    expect(CHILD_RECLAIM_SKIP['review-report-stale'].sentence).toContain('Release on its item in Waiting on you');
  });
});

// ── the action ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('the release-review action', () => {
  it('round-trips through the column reader and abandons nothing', () => {
    const a = releaseReviewAction(5, 9, 'demo-rv');
    expect(parseItemAction(JSON.stringify(a))).toEqual(a);
    expect(isReleaseReviewAction(a)).toBe(true);
    expect(actAbandons(a)).toBe(false);
  });

  it('a malformed one reads as no action', () => {
    expect(parseItemAction(JSON.stringify({ verb: 'release-review', runId: 5, sessionId: 'demo-rv' }))).toBeNull();
    expect(parseItemAction(JSON.stringify({ verb: 'release-review', runId: 5, reviewRunId: 9, sessionId: '' }))).toBeNull();
  });
});

// ── the store and the lane ───────────────────────────────────────────────────────────────────────────────────────

/** A store with one open work run of `prog-a` (claimed by `claimedBy`) and one review of it that closed `done`. */
function fixture(dir = mkTmp('ccrc-review-release-'), claimedBy: string | null = 'demo-coord') {
  const coord = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
  const open = (kind: 'work' | 'review', reviews: number | null): number => {
    const r = coord.openRun({ program: 'prog-a', title: 'Prog A', project: 'project-a', wave: 1, waveOf: null,
      claimedBy: 'demo-coord', kind, reviews });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    // An ownerless run: the shape a coordinator-less programme reads as (`readCoordinatorOfRun`'s `id: null`).
    if (claimedBy === null) coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(r.id);
    return r.id;
  };
  const work = open('work', null);
  const review = open('review', work);
  coord.markDispatched(review, 'demo-rv', 'demo-rv', 'ws/demo-rv', false);
  for (const to of ['dispatched', 'working', 'done'] as const) {
    const moved = coord.advance(review, to, 'test');
    if (!moved.ok) throw new Error(`advance refused: ${JSON.stringify(moved)}`);
  }
  const sighting: ReviewReleaseSighting = { sessionId: 'demo-rv', reviewRunId: review, reviewedRunId: work };
  const stale: ChildReclaimSweepVerdict = { eligible: false, why: 'review-report-stale', runId: review };
  return { coord, dir, work, review, sighting, stale };
}

const mailTo = (coord: CoordStore, toId: string) =>
  coord.db.prepare('SELECT subject, body FROM mail WHERE toId = ?').all(toId) as unknown as { subject: string; body: string }[];

describe('routeReviewReleases: the item', () => {
  it('raises one item, held for the coordinator, who is mailed its id', () => {
    const f = fixture();
    const out = routeReviewReleases({ coord: f.coord }, [f.sighting], new Map([['demo-rv', f.stale]]), NOW);
    expect(out.raised).toHaveLength(1);
    const item = f.coord.itemById(out.raised[0]!)!;
    expect(item).toMatchObject({ program: 'prog-a', runId: f.work, raisedBy: 'ccrc', kind: 'do', state: 'open', heldUntil: NOW + ASK_GRACE_MS });
    expect(item.action).toEqual(releaseReviewAction(f.work, f.review, 'demo-rv'));
    expect(item.why.split('\n').at(-1)).toBe('Its coordinator did not answer');
    // Held: not on the operator's list until the grace has run.
    expect(f.coord.itemsFor(null, NOW).open).toHaveLength(0);
    expect(f.coord.itemsFor(null, NOW + ASK_GRACE_MS).open.map((i) => i.id)).toEqual([item.id]);
    const mail = mailTo(f.coord, 'demo-coord');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toContain(`item ${item.id}`);
    expect(mail[0]!.body).toContain(`items withdraw ${item.id}`);
  });

  it('with no coordinator on record the item is raised at once and nobody is mailed', () => {
    const f = fixture(undefined, null);
    const out = routeReviewReleases({ coord: f.coord }, [f.sighting], new Map([['demo-rv', f.stale]]), NOW);
    const item = f.coord.itemById(out.raised[0]!)!;
    expect(item.heldUntil).toBeNull();
    expect(item.why.split('\n').at(-1)).toBe('No coordinator on record');
    expect(f.coord.db.prepare('SELECT COUNT(*) AS n FROM mail').get()).toEqual({ n: 0 });
  });

  it('is raised once per review run: never again, even after its coordinator withdrew it', () => {
    const f = fixture();
    const judged = new Map([['demo-rv', f.stale]]);
    const [id] = routeReviewReleases({ coord: f.coord }, [f.sighting], judged, NOW).raised;
    expect(routeReviewReleases({ coord: f.coord }, [f.sighting], judged, NOW + 1).raised).toEqual([]);
    expect(f.coord.moveItem(id!, 'withdraw', 'coordinator', {}, NOW + 2, { programmeHasOpenRun: true }).ok).toBe(true);
    expect(routeReviewReleases({ coord: f.coord }, [f.sighting], judged, NOW + 3).raised).toEqual([]);
    expect(f.coord.releaseReviewItemRaised(f.review)).toBe(true);
  });

  it('settles when the child is gone, or no longer kept for that run; keeps it on a doubt or a hold', () => {
    const f = fixture();
    const [id] = routeReviewReleases({ coord: f.coord }, [f.sighting], new Map([['demo-rv', f.stale]]), NOW).raised;
    // A doubt this pass answers nothing.
    routeReviewReleases({ coord: f.coord }, [], new Map([['demo-rv', { eligible: false, why: 'minting-run-unreadable' }]]), NOW + 1);
    routeReviewReleases({ coord: f.coord }, [], new Map([['demo-rv', { eligible: false, why: 'held' }]]), NOW + 1);
    expect(f.coord.itemById(id!)!.state).toBe('open');
    // A definite verdict that no longer keeps it for this run settles it.
    const out = routeReviewReleases({ coord: f.coord }, [], new Map([['demo-rv', { eligible: false, why: 'coordinating', runId: f.review }]]), NOW + 2);
    expect(out.settled).toEqual([id]);
    expect(f.coord.itemById(id!)!).toMatchObject({ state: 'done' });
    expect(f.coord.reviewChildReleased(f.review), 'a settle is no release').toBe(false);
  });

  it('the reviewed run closing settles the item as every action item of the run is settled', () => {
    const f = fixture();
    const [id] = routeReviewReleases({ coord: f.coord }, [f.sighting], new Map([['demo-rv', f.stale]]), NOW).raised;
    expect(f.coord.advance(f.work, 'failed', 'operator').ok).toBe(true);
    expect(f.coord.itemById(id!)!.state).toBe('done');
    expect(f.coord.reviewChildReleased(f.review)).toBe(false);
  });
});

describe('reviewReleasePlan', () => {
  const action = releaseReviewAction(5, 9, 'demo-rv');
  const sighting: ReviewReleaseSighting = { sessionId: 'demo-rv', reviewRunId: 9, reviewedRunId: 5 };
  const stale: ChildReclaimSweepVerdict = { eligible: false, why: 'review-report-stale', runId: 9 };

  it('raises a sighting once, and none already open or ever raised', () => {
    expect(reviewReleasePlan({ sightings: [sighting, sighting], judged: new Map(), open: [], raised: () => false }).raise).toEqual([sighting]);
    expect(reviewReleasePlan({ sightings: [sighting], judged: new Map(), open: [], raised: () => true }).raise).toEqual([]);
    expect(reviewReleasePlan({ sightings: [sighting], judged: new Map([['demo-rv', stale]]), open: [{ id: 1, action }], raised: () => false }).raise).toEqual([]);
  });

  it('settles a gone child, an eligible one and a recycled slug; keeps the same stale review', () => {
    const plan = (v: ChildReclaimSweepVerdict | undefined) => reviewReleasePlan({
      sightings: [], judged: v === undefined ? new Map() : new Map([['demo-rv', v]]), open: [{ id: 1, action }], raised: () => true }).settle;
    expect(plan(undefined)).toEqual([{ id: 1, note: REVIEW_RELEASE_GONE_NOTE }]);
    expect(plan({ eligible: true, runId: 9 })).toEqual([{ id: 1, note: REVIEW_RELEASE_HANDLED_NOTE }]);
    expect(plan({ eligible: false, why: 'review-report-stale', runId: 12 })).toEqual([{ id: 1, note: REVIEW_RELEASE_HANDLED_NOTE }]);
    expect(plan(stale)).toEqual([]);
    expect(plan({ eligible: false, why: 'identity-unmeasured' })).toEqual([]);
  });
});

describe('the release is read back', () => {
  it('reviewChildReleased is true only after the operator acted on the item, and the sweep then reads it', () => {
    const f = fixture();
    const [id] = routeReviewReleases({ coord: f.coord }, [f.sighting], new Map([['demo-rv', f.stale]]), NOW).raised;
    expect(f.coord.reviewChildReleased(f.review)).toBe(false);
    expect(childReclaimReviewedRun(f.coord, f.review, f.work, 'working', [])).toEqual({ kind: 'run', state: 'working' });
    expect(f.coord.moveItem(id!, 'act', 'operator', {}, NOW + ASK_GRACE_MS, { programmeHasOpenRun: true }).ok).toBe(true);
    expect(f.coord.reviewChildReleased(f.review)).toBe(true);
    expect(childReclaimReviewedRun(f.coord, f.review, f.work, 'working', [])).toEqual({ kind: 'run', state: 'working', released: true });
    // Another review run's report is not released by it.
    expect(f.coord.reviewChildReleased(f.review + 100)).toBe(false);
  });
});

// ── the route ────────────────────────────────────────────────────────────────────────────────────────────────────

async function rig(claimedBy: string | null = 'demo-coord') {
  const home = mkTmp('ccrc-review-release-route-');
  const f = fixture(path.join(home, '.ccrc'), claimedBy);
  const rec = recorder();
  app = await buildServer({ ...testDeps(home, rec.run), mailToken: ID_GATE_TOKEN, coord: f.coord }, new Bus());
  return { ...f, app, calls: rec.calls as string[][] };
}

describe('POST /api/items/:id/act on a release-review item', () => {
  it('Release closes the item done, records the release, and runs no fleet act', async () => {
    const r = await rig(null);
    const [id] = routeReviewReleases({ coord: r.coord }, [r.sighting], new Map([['demo-rv', r.stale]]), Date.now() - 1000).raised;
    const before = r.calls.length;
    const res = await r.app.inject({ method: 'POST', url: `/api/items/${id}/act` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, released: true, item: { id, state: 'done' } });
    expect(r.coord.reviewChildReleased(r.review)).toBe(true);
    // The reviewed run is untouched, and nothing went to the fleet.
    expect((r.coord.run(r.work) as { run: { state: string } }).run.state).toBe('planned');
    expect(r.calls.length).toBe(before);
    // A second tap is refused: the item is no longer open.
    const again = await r.app.inject({ method: 'POST', url: `/api/items/${id}/act` });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'not-open' });
  });

  it('a held item is refused, and has no decline', async () => {
    const r = await rig('demo-coord');
    const [id] = routeReviewReleases({ coord: r.coord }, [r.sighting], new Map([['demo-rv', r.stale]]), Date.now()).raised;
    const res = await r.app.inject({ method: 'POST', url: `/api/items/${id}/act` });
    expect(res.statusCode).toBe(409);
    expect(r.coord.reviewChildReleased(r.review)).toBe(false);
    const decline = await r.app.inject({ method: 'POST', url: `/api/items/${id}/decline` });
    expect(decline.statusCode).toBe(409);
    expect(r.coord.itemById(id!)!.state).toBe('open');
  });
});
