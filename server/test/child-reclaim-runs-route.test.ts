// Child-reclamation wave 5, Task 5: GET /api/runs composes each run's reclaim
// chip. It uses the mirror (one statement) and the watcher's in-memory registry
// listing, sweep state, sweep verdicts and fleet-wide switch. There are no
// registry reads and no ccd calls. A failed mirror read costs the chip, never
// the board.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { CHILD_RECLAIM_STATUS_SENTENCE as S } from '../src/coord/childReclaim.js';
import {
  CHILD_RECLAIM_SKIP, childReclaimFailingSentence, childReclaimFirstSighting,
  type ChildReclaimSweepVerdict,
} from '../src/childReclaimSweep.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { refusalSentence } from '../src/wsaudit.js';
import { lcRefusalWord } from '../../shared/api.js';
import type { ChildMark, CoordStatus, RunSummary } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const COORD = 'ccrc-pwa-coordinator';
const SID = 'ccrc-pwa-quiet-mesa';
const T_CREATE = 1_758_500_000_000;
const T_CLOSE = T_CREATE + 3_600_000;
const GEN = '1758500000000000000';

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; vi.restoreAllMocks(); });

const harness = async (): Promise<{ coord: CoordStore; watcher: FleetWatcher; app: FastifyInstance }> => {
  const home = mkTmp('ccrc-cr-route-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = { ...testDeps(home), coord };
  const bus = new Bus();
  const watcher = new FleetWatcher(deps, bus);
  app = await buildServer(deps, bus, watcher);
  return { coord, watcher, app };
};

let n = 0;
/** A run opened, dispatched onto `sessionId` and closed `done`, with `closedAt`
 *  pinned so the generation fence can be placed around it. A program per run,
 *  because closing a program's last run retires it. */
const closedRun = (coord: CoordStore, sessionId: string, closedAt = T_CLOSE): number => {
  const program = `w5-route-${++n}`;
  const r = coord.openRun({ program, title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 1, claimedBy: COORD }) as { id: number };
  const slug = sessionId.slice('ccrc-pwa-'.length);
  coord.dispatchRun({ runId: r.id, sessionId, workspace: slug, branch: `ws/${slug}`, resumed: false, clearedAt: null, items: [] });
  expect(coord.closeRun({ runId: r.id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null,
                          program, viaClosing: true }).ok).toBe(true);
  coord.db.prepare('UPDATE runs SET closedAt = ? WHERE id = ?').run(closedAt, r.id);
  return r.id;
};
const openRunOn = (coord: CoordStore, sessionId: string): number => {
  const program = `w5-route-${++n}`;
  const r = coord.openRun({ program, title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 1, claimedBy: COORD }) as { id: number };
  const slug = sessionId.slice('ccrc-pwa-'.length);
  coord.dispatchRun({ runId: r.id, sessionId, workspace: slug, branch: `ws/${slug}`, resumed: false, clearedAt: null, items: [] });
  return r.id;
};

let seq = 0;
const journal = (coord: CoordStore, lines: Record<string, unknown>[]): void => {
  const rows = lines.map((l) => parseJournalLine(JSON.stringify({ uid: `w5rt.1.${++seq}`, ...l })));
  coord.ingestJournal({ gen: GEN, rows, cursor: seq * 100, size: seq * 100, at: 9 });
};

const getRuns = async (a: FastifyInstance, closed = true): Promise<RunSummary[]> => {
  const res = await a.inject({ method: 'GET', url: closed ? '/api/runs?closed=1' : '/api/runs' });
  expect(res.statusCode).toBe(200);
  return (res.json() as { runs: RunSummary[] }).runs;
};
const chipOf = (runs: RunSummary[], id: number) => runs.find((r) => r.id === id)!.childReclaim;
const markedAs = (w: FleetWatcher, runId: number): void => {
  vi.spyOn(w, 'currentChildMarks').mockReturnValue(new Map<string, ChildMark>([[SID, { kind: 'child', runId }]]));
};
/** The sweep's last verdict for SID, as the watcher would hand it to the route. */
const judgedAs = (w: FleetWatcher, v: ChildReclaimSweepVerdict): void => {
  vi.spyOn(w, 'currentChildReclaimVerdicts').mockReturnValue(new Map([[SID, v]]));
};
const coordAs = (w: FleetWatcher, reclaim: CoordStatus['reclaim']): void => {
  vi.spyOn(w, 'currentCoord').mockReturnValue(
    { pause: 'clear', mail: 'clear', reclaim, childReclaimAttention: [] });
};

describe('GET /api/runs composes the reclaim chip (wave 5, spec §5.9)', () => {
  it('reads reclaimed off the mirror alone — the registry row is gone by design', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    journal(h.coord, [
      { at: T_CREATE, act: 'create', outcome: 'done', id: SID },
      { at: T_CLOSE + 5_000, act: 'reclaim', outcome: 'done', id: SID },
    ]);
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'reclaimed', sentence: S.reclaimed, at: T_CLOSE + 5_000 });
  });

  it('ships the SERVER’s sentence for a terminal refusal — the phone is handed it, never maps it', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    journal(h.coord, [
      { at: T_CREATE, act: 'create', outcome: 'done', id: SID },
      { at: T_CLOSE + 5_000, act: 'reclaim', outcome: 'refused', refusal: 'containment-unproven', id: SID },
    ]);
    expect(chipOf(await getRuns(h.app), id)).toEqual({
      word: 'refused', sentence: refusalSentence('containment-unproven'), at: T_CLOSE + 5_000,
    });
  });

  it('is not repainted by a LATER workspace under the same recycled id', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    journal(h.coord, [
      { at: T_CREATE, act: 'create', outcome: 'done', id: SID },
      { at: T_CLOSE + 5_000, act: 'reclaim', outcome: 'done', id: SID },
      { at: T_CLOSE + 600_000, act: 'create', outcome: 'done', id: SID },
      { at: T_CLOSE + 700_000, act: 'reclaim', outcome: 'refused', refusal: 'held', id: SID },
    ]);
    expect(chipOf(await getRuns(h.app), id)?.word).toBe('reclaimed');
  });

  it('reads pending exactly while the watcher’s last listing carries THIS run’s marker', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    judgedAs(h.watcher, { eligible: true, runId: id });
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'pending', sentence: S.pending, at: null });
    markedAs(h.watcher, id + 99);
    expect(chipOf(await getRuns(h.app), id)).toBeNull();
  });

  it('carries the sweep’s defer through to the chip, dated from its first deferral of any kind (spec §5.7)', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    // A non-presence defer first (a sibling was open), a presence defer later:
    // the chip reads the first, never the clock the ceiling runs on. The
    // entry's decision clocks are the sweep's monotonic clock, so none of them
    // reads as an epoch near T_CLOSE: a chip that dated itself from one would
    // miss the expected `at`.
    vi.spyOn(h.watcher, 'currentChildReclaimDefers').mockReturnValue(new Map([[SID, {
      ...childReclaimFirstSighting(5_000, null, id),
      firstDeferredAt: T_CLOSE + 9_000,
      firstPresenceDeferredAt: 35_000,
      lastPresenceDeferredAt: 35_000,
      lastPresenceWallAt: T_CLOSE + 30_000,
      presenceHeldSince: 35_000,
      lastAskedAt: 35_000,
    }]]));
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'deferred', sentence: S.sweepDeferred, at: T_CLOSE + 9_000 });
  });

  it('reads the fleet-wide switch off the watcher’s last coord measurement, and only a SET one (spec §5.8)', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    coordAs(h.watcher, 'set');
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'paused', sentence: S.fleetPaused, at: null });
    // An unmeasurable switch is not a switch this read saw: the chip claims none.
    coordAs(h.watcher, 'unmeasurable');
    judgedAs(h.watcher, { eligible: true, runId: id });
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'pending', sentence: S.pending, at: null });
  });

  it('keeps a review child pending while the run it reviewed is open, then reads it like any child (spec §5.7)', async () => {
    const h = await harness();
    const program = `w5-route-${++n}`;
    const work = h.coord.openRun({ program, title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 1, claimedBy: COORD }) as { id: number };
    h.coord.dispatchRun({ runId: work.id, sessionId: 'ccrc-pwa-busy-reef', workspace: 'busy-reef', branch: 'ws/busy-reef',
                          resumed: false, clearedAt: null, items: [] });
    const review = h.coord.openRun({ program, title: 'W5', project: 'ccrc-pwa', wave: 1, waveOf: 1, claimedBy: COORD,
                                     kind: 'review', reviews: work.id }) as { id: number };
    h.coord.dispatchRun({ runId: review.id, sessionId: SID, workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
                          resumed: false, clearedAt: null, items: [] });
    // REVIEW_RUN_TRANSITIONS has no `closing`: working → done, as `closeReviewRun` closes it.
    expect(h.coord.advance(review.id, 'working', 'coordinator').ok).toBe(true);
    expect(h.coord.closeRun({ runId: review.id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null,
                              program, viaClosing: false }).ok).toBe(true);
    markedAs(h.watcher, review.id);
    expect(chipOf(await getRuns(h.app), review.id)).toEqual({ word: 'pending', sentence: S.reviewKept, at: null });
    expect(h.coord.closeRun({ runId: work.id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null,
                              program, viaClosing: true }).ok).toBe(true);
    judgedAs(h.watcher, { eligible: true, runId: review.id });
    const read = vi.spyOn(h.coord, 'childReclaimEvents');
    expect(chipOf(await getRuns(h.app), review.id)).toEqual({ word: 'pending', sentence: S.pending, at: null });
    // ONE mirror read per board load, though two terminal sessions are on this board.
    expect(read).toHaveBeenCalledTimes(1);
    expect([...read.mock.calls[0]![0]].sort()).toEqual(['ccrc-pwa-busy-reef', SID].sort());
  });

  it('says nothing on a handed-over child while the next wave’s run is open on it', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    openRunOn(h.coord, SID);
    markedAs(h.watcher, id);
    expect(chipOf(await getRuns(h.app), id)).toBeNull();
  });

  it('says nothing on a closed run whose workspace is not a child', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    vi.spyOn(h.watcher, 'currentChildMarks').mockReturnValue(new Map<string, ChildMark>([[SID, { kind: 'none' }]]));
    expect(chipOf(await getRuns(h.app), id)).toBeNull();
  });

  it('reads no mirror row for a board with nothing terminal on it', async () => {
    const h = await harness();
    openRunOn(h.coord, SID);
    const read = vi.spyOn(h.coord, 'childReclaimEvents');
    for (const r of await getRuns(h.app, false)) expect(r.childReclaim).toBeNull();
    for (const r of await getRuns(h.app, true)) expect(r.childReclaim).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('degrades the chip, never the board, when the mirror read fails', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    vi.spyOn(h.coord, 'childReclaimEvents').mockImplementation(() => { throw new Error('disk I/O error'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(chipOf(await getRuns(h.app), id)).toBeNull();
    const line = warn.mock.calls.map(([l]) => String(l)).find((l) => l.includes('reclaim chip'));
    expect(line).toBeDefined();
    // The server's log prefix: it runs with fastify's logger off, so this line is its only trace.
    expect(line!.startsWith('ccrc-server: ')).toBe(true);
  });

  // What the sweep decides, made visible (spec §5.9).
  it('before the sweep has judged anything, a marked child reads not-judged-yet, never plain pending', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'pending', sentence: S.unjudged, at: null });
  });

  it('a child the sweep keeps as a coordinator’s reads refused with the kept sentence, under the switch too', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    judgedAs(h.watcher, { eligible: false, why: 'coordinating', runId: id });
    const kept = { word: 'refused', sentence: CHILD_RECLAIM_SKIP.coordinating.sentence, at: null };
    expect(chipOf(await getRuns(h.app), id)).toEqual(kept);
    // A pass that judged nothing keeps its kept verdicts: the switch never replaces this answer.
    coordAs(h.watcher, 'set');
    expect(chipOf(await getRuns(h.app), id)).toEqual(kept);
  });

  it('the sweep’s own run of failures, with nothing in the mirror, reads deferred', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    vi.spyOn(h.watcher, 'currentChildReclaimDefers').mockReturnValue(new Map([[SID, {
      ...childReclaimFirstSighting(5_000, null, id), consecutiveFailures: 2,
    }]]));
    expect(chipOf(await getRuns(h.app), id)).toEqual({ word: 'deferred', sentence: S.sweepFailing, at: null });
  });

  it('a pre-lock refused line reads deferred with its journal word, never refused', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    const at = Date.now() - 60_000;
    journal(h.coord, [
      { at: T_CREATE, act: 'create', outcome: 'done', id: SID },
      { at, act: 'reclaim', outcome: 'refused', refusal: 'flock-unavailable', id: SID },
    ]);
    expect(chipOf(await getRuns(h.app), id)).toEqual({
      word: 'deferred', sentence: lcRefusalWord('flock-unavailable'), at,
    });
    // The same line on a child that no longer stands as this run's promises no retry, and is
    // never refused either: the row rule's silence (spec §5.9).
    markedAs(h.watcher, id + 99);
    expect(chipOf(await getRuns(h.app), id)).toBeNull();
  });

  it('a failure run past the ceiling reads the attention list’s own sentence', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    journal(h.coord, [
      { at: T_CREATE, act: 'create', outcome: 'done', id: SID },
      { at: T_CLOSE + 5_000, act: 'reclaim', outcome: 'failed', refusal: 'pin-failed', id: SID },
    ]);
    expect(chipOf(await getRuns(h.app), id)).toEqual({
      word: 'deferred', sentence: childReclaimFailingSentence(lcRefusalWord('pin-failed')), at: T_CLOSE + 5_000,
    });
  });

  it('a not-finished child of an open programme reads deferred with the hold sentence', async () => {
    const h = await harness();
    const id = closedRun(h.coord, SID);
    markedAs(h.watcher, id);
    judgedAs(h.watcher, { eligible: false, why: 'held' });
    expect(chipOf(await getRuns(h.app), id)).toEqual({
      word: 'deferred', sentence: CHILD_RECLAIM_SKIP.held.sentence, at: null,
    });
  });
});
