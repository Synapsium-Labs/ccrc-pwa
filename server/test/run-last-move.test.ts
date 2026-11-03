// Task G1 (D-7334): a run says when it last moved. `CoordStore.runLastMoves` is the one read of "a move": the newest act
// row the drift reader counts (not a stall observation, not `causedBy = 'operator'`), or the newest mail naming the run
// from its worker, its reviewer or its coordinator session (programme-boxes spec §2.5; fix round 1, F3), never from one of
// the role senders (`MAIL_ROLE_IDS`). `withLastMoves` carries it onto the runs frame's summaries, once per frame, and
// leaves the field off when the read fails (absence permits).
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RunSummary } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { MAIL_ROLE_IDS } from '../src/coord/rundefs.js';
import { withLastMoves } from '../src/coord/runWire.js';
import { stallDetail } from '../src/coord/stall.js';
import { CoordStore, toRunSummary } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_790_000_000_000;
const H = 3_600_000;

const fresh = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-run-last-move-'), '.ccrc', 'coord.db')));
/** A work run claimed by `coord-a`, its worker session `worker`. */
const open = (coord: CoordStore, program = 'program-a', worker = 'worker-1'): number => {
  const r = coord.openRun({ program, title: 'T', project: 'project-a', wave: 1, waveOf: 3, claimedBy: 'coord-a' });
  if (!('id' in r)) throw new Error('fixture openRun refused');
  coord.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(worker, r.id);
  return r.id;
};
/** A review run of `reviewed`, its reviewer session `reviewer` (its own program row: `openRun` answers an open program's
 *  wave with the run already there). */
const openReview = (coord: CoordStore, reviewed: number, reviewer: string): number => {
  const id = open(coord, `review-of-${reviewed}`, reviewer);
  coord.db.prepare("UPDATE runs SET kind = 'review', reviews = ? WHERE id = ?").run(reviewed, id);
  return id;
};
const event = (coord: CoordStore, runId: number, at: number, causedBy: string, detail: string | null = null): void => {
  coord.db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(runId, at, 'working', 'working', causedBy, detail);
};
const mail = (coord: CoordStore, runId: number | null, at: number, fromId: string): void => {
  coord.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (?, ?, 'u', 'coordinator', ?, 'status', 's', 'b')")
    .run(at, fromId, runId);
};
const movesOf = (coord: CoordStore, ids: readonly number[]): ReadonlyMap<number, number | null> => {
  const read = coord.runLastMoves(ids);
  if (!read.ok) throw new Error(`runLastMoves refused: ${read.detail}`);
  return read.moves;
};

describe('CoordStore.runLastMoves: the newest act on a run', () => {
  it('a run with no act reads null', () => {
    const coord = fresh();
    const id = open(coord);
    expect(movesOf(coord, [id])).toEqual(new Map([[id, null]]));
  });

  it('a dispatch transition sets it', () => {
    const coord = fresh();
    const id = open(coord);
    const before = Date.now();
    expect(coord.advance(id, 'dispatched', 'coordinator')).toMatchObject({ ok: true });
    const at = movesOf(coord, [id]).get(id);
    expect(at).not.toBeNull();
    expect(at as number).toBeGreaterThanOrEqual(before);
  });

  it('a later worker mail naming the run moves it', () => {
    const coord = fresh();
    const id = open(coord);
    event(coord, id, NOW - 3 * H, 'coordinator');
    mail(coord, id, NOW - H, 'worker-1');
    expect(movesOf(coord, [id]).get(id)).toBe(NOW - H);
  });

  it('a transition newer than the mail wins', () => {
    const coord = fresh();
    const id = open(coord);
    mail(coord, id, NOW - 3 * H, 'worker-1');
    event(coord, id, NOW - H, 'worker-1');
    expect(movesOf(coord, [id]).get(id)).toBe(NOW - H);
  });

  it('mail under either role sender does not move it', () => {
    const coord = fresh();
    const id = open(coord);
    event(coord, id, NOW - 3 * H, 'coordinator');
    expect([...MAIL_ROLE_IDS].sort()).toEqual(['coordinator', 'operator']);
    for (const role of MAIL_ROLE_IDS) mail(coord, id, NOW - H, role);
    expect(movesOf(coord, [id]).get(id)).toBe(NOW - 3 * H);
  });

  it('a stall observation does not move it', () => {
    const coord = fresh();
    const id = open(coord);
    event(coord, id, NOW - 3 * H, 'coordinator');
    event(coord, id, NOW - H, 'coordinator', stallDetail('live', 'quiet', 1, 1));
    expect(movesOf(coord, [id]).get(id)).toBe(NOW - 3 * H);
  });

  it('an operator-caused transition does not move it', () => {
    const coord = fresh();
    const id = open(coord);
    event(coord, id, NOW - 3 * H, 'coordinator');
    event(coord, id, NOW - H, 'operator', 'reclaim:coord-a -> coord-b');
    expect(movesOf(coord, [id]).get(id)).toBe(NOW - 3 * H);
  });

  it('only the run named counts: another run\'s act and run-less mail do not move it', () => {
    const coord = fresh();
    const a = open(coord, 'program-a');
    const b = open(coord, 'program-b', 'worker-2');
    event(coord, b, NOW - H, 'worker-2');
    mail(coord, b, NOW - H, 'worker-2');
    mail(coord, null, NOW - H, 'worker-1');
    expect(movesOf(coord, [a, b])).toEqual(new Map([[a, null], [b, NOW - H]]));
  });

  it('a mail from the run\'s reviewer session moves it', () => {
    const coord = fresh();
    const id = open(coord);
    openReview(coord, id, 'reviewer-1');
    event(coord, id, NOW - 3 * H, 'coordinator');
    mail(coord, id, NOW - H, 'reviewer-1');
    expect(movesOf(coord, [id]).get(id)).toBe(NOW - H);
  });

  it('a mail from the run\'s coordinator session (its claimedBy) moves it', () => {
    const coord = fresh();
    const id = open(coord);
    event(coord, id, NOW - 3 * H, 'coordinator');
    mail(coord, id, NOW - H, 'coord-a');
    expect(movesOf(coord, [id]).get(id)).toBe(NOW - H);
  });

  it('a mail from a session unrelated to the run moves nothing: a peer worker, another coordinator, a reviewer of another run', () => {
    const coord = fresh();
    const id = open(coord);
    const other = open(coord, 'program-b', 'worker-2');
    openReview(coord, other, 'reviewer-2');
    event(coord, id, NOW - 3 * H, 'coordinator');
    for (const sender of ['worker-2', 'coord-b', 'reviewer-2']) mail(coord, id, NOW - H, sender);
    expect(movesOf(coord, [id]).get(id)).toBe(NOW - 3 * H);
  });

  it('agrees with the drift reader on the act half: one predicate', () => {
    const coord = fresh();
    const id = open(coord);
    coord.db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(id);
    event(coord, id, NOW - 5 * H, 'coordinator');
    event(coord, id, NOW - 2 * H, 'coordinator', stallDetail('live', 'quiet', 1, 1));
    event(coord, id, NOW - H, 'operator', 'reclaim:coord-a -> coord-b');
    const drift = coord.driftOpenRuns();
    expect(drift.ok && drift.rows.find((r) => r.id === id)?.lastActAt).toBe(NOW - 5 * H);
    expect(movesOf(coord, [id]).get(id)).toBe(NOW - 5 * H);
  });

  it('an empty id list reads an empty map, and a broken database is a failure with its detail, never a throw', () => {
    const coord = fresh();
    expect(movesOf(coord, [])).toEqual(new Map());
    const id = open(coord);
    coord.db.exec('DROP TABLE mail_deliveries; DROP TABLE mail');
    const read = coord.runLastMoves([id]);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.detail).toMatch(/mail/);
  });
});

describe('withLastMoves: the runs frame carries lastMoveAt, once per frame', () => {
  const summaries = (coord: CoordStore): RunSummary[] => {
    const read = coord.runs();
    if (!read.ok) throw new Error('fixture runs() refused');
    return read.runs.map(toRunSummary);
  };

  it('every summary gets its run\'s move, null included', () => {
    const coord = fresh();
    const a = open(coord, 'program-a');
    const b = open(coord, 'program-b', 'worker-2');
    mail(coord, b, NOW - H, 'worker-2');
    const out = withLastMoves(coord, summaries(coord), () => { throw new Error('no failure expected'); });
    expect(out.map((r) => [r.id, r.lastMoveAt])).toEqual([[a, null], [b, NOW - H]]);
  });

  it('one read for the whole frame', () => {
    const coord = fresh();
    open(coord, 'program-a');
    open(coord, 'program-b');
    const spy = vi.spyOn(coord, 'runLastMoves');
    withLastMoves(coord, summaries(coord), () => undefined);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a failed read leaves the field off every summary and says why', () => {
    const coord = fresh();
    open(coord);
    const runs = summaries(coord);
    const port = { runLastMoves: () => ({ ok: false as const, detail: 'boom' }) };
    const why: string[] = [];
    const out = withLastMoves(port, runs, (d) => why.push(d));
    expect(out.every((r) => !('lastMoveAt' in r))).toBe(true);
    expect(why).toEqual(['boom']);
  });
});
