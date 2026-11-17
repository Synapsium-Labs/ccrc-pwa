// The one reader of a bare target (Overlord W2 done tests A, Task A4; plan docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-done-tests.md §5): `readTarget` over a fixture coord.db, through its port alone. Its answers are `targetVerdict`'s,
// so this file holds what the gathering adds: which rows it reads, that a throw is `unmeasured`, and that a row the store
// cannot represent is `unmeasurable`.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { readTarget, type TargetReadPort } from '../src/coord/doneTestRead.js';
import type { TargetAnswer } from '../../shared/doneTests.js';
import { mkTmp } from './tmpHelpers.js';

const HEAD = 'c'.repeat(40);
const COORD = 'project-a-coordinator';
const word = (a: TargetAnswer): string => ('evidence' in a ? `${a.kind}:${a.evidence}` : `${a.kind}:${a.why}`);

const build = () => {
  const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-done-read-'), 'coord.db')));
  const open = (o: { kind?: 'work' | 'review'; reviews?: number } = {}): number => {
    const r = coord.openRun({ program: 'prog-a', title: 't', project: 'project-a', wave: 1, waveOf: 2, claimedBy: COORD, ...o });
    if (!('id' in r)) throw new Error('openRun refused');
    return r.id;
  };
  const working = (o: { kind?: 'work' | 'review'; reviews?: number } = {}): number => {
    const id = open(o);
    const s = `project-a-s${id}`;
    coord.markDispatched(id, s, s, `ws/${s}`, false);
    for (const to of ['dispatched', 'working'] as const) {
      if (!coord.advance(id, to, 'test').ok) throw new Error(`fixture advance to ${to} refused`);
    }
    return id;
  };
  const close = (id: number, finalState: 'done' | 'failed', closePr: { pr: number; merged: boolean; head: string } | null,
    o: { viaClosing?: boolean; detail?: string } = {}): void => {
    const r = coord.closeRun({ runId: id, finalState, causedBy: 'coordinator', handoffCommit: null, program: 'prog-a',
      viaClosing: o.viaClosing ?? true, closePr, ...(o.detail === undefined ? {} : { detail: o.detail }) });
    if (!r.ok) throw new Error(`fixture close refused: ${JSON.stringify(r)}`);
  };
  const openedSeconds = (id: number): number =>
    Math.floor((coord.db.prepare('SELECT openedAt FROM runs WHERE id = ?').get(id) as { openedAt: number }).openedAt / 1000);
  const item = (): number => coord.raiseItem({ program: 'prog-a', runId: null, raisedBy: 'lane-a-project-a', kind: 'do',
    title: 't', why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, 1_000);
  return { coord, open, working, close, openedSeconds, item };
};

describe('readTarget: the one gatherer of a predicate\'s rows', () => {
  it('a run closed done with a merged closePr passes run-closed and pr-merged', () => {
    const b = build();
    const id = b.working();
    b.close(id, 'done', { pr: 7, merged: true, head: HEAD });
    expect(word(readTarget(b.coord, { predicate: 'run-closed', runId: id }))).toBe('passed:pr-7');
    expect(word(readTarget(b.coord, { predicate: 'pr-merged', runId: id, pr: 7 }))).toBe('passed:pr-7');
  });

  it('a PR the run replaced, merged inside its window, passes pr-merged through the filtered lineage', () => {
    const b = build();
    const id = b.working();
    b.coord.foldPrLineage(id, [{ pr: 5, branch: 'ws/a', phase: 'merged', recordedAt: b.openedSeconds(id) + 5 }]);
    b.close(id, 'done', { pr: 7, merged: false, head: HEAD });
    expect(word(readTarget(b.coord, { predicate: 'pr-merged', runId: id, pr: 5 }))).toBe('passed:pr-5');
    expect(word(readTarget(b.coord, { predicate: 'run-closed', runId: id }))).toBe('ended:pr-7-not-merged');
  });

  it('a lineage entry recorded before the run opened does not count', () => {
    const b = build();
    const id = b.working();
    b.coord.foldPrLineage(id, [{ pr: 5, branch: 'ws/a', phase: 'merged', recordedAt: b.openedSeconds(id) - 1 }]);
    b.close(id, 'done', { pr: 7, merged: true, head: HEAD });
    expect(word(readTarget(b.coord, { predicate: 'pr-merged', runId: id, pr: 5 }))).toBe('unmeasurable:not-this-runs-pr');
  });

  it('an abandoned run (failed, abandon: detail) ends run-closed', () => {
    const b = build();
    const id = b.open();
    b.close(id, 'failed', null, { viaClosing: false, detail: 'abandon:never-started' });
    expect(word(readTarget(b.coord, { predicate: 'run-closed', runId: id }))).toBe('ended:failed:abandon');
  });

  it('an open run is pending, and a done run closed before the column existed is unmeasurable', () => {
    const b = build();
    const open = b.working();
    expect(word(readTarget(b.coord, { predicate: 'run-closed', runId: open }))).toBe(`pending:run-${open}-working`);
    const old = b.working();
    b.close(old, 'done', null);
    expect(word(readTarget(b.coord, { predicate: 'run-closed', runId: old }))).toBe('unmeasurable:no-close-record');
  });

  it('a review closed done reads unmeasurable, verdict-not-recorded; one still open is pending', () => {
    const b = build();
    const work = b.working();
    b.close(work, 'done', { pr: 7, merged: true, head: HEAD });
    const target = { predicate: 'review-passed', runId: work } as const;
    expect(word(readTarget(b.coord, target))).toBe(`pending:run-${work}-no-review`);
    const review = b.working({ kind: 'review', reviews: work });
    expect(word(readTarget(b.coord, target))).toBe(`pending:run-${work}-review-open`);
    b.close(review, 'done', null, { viaClosing: false });
    expect(word(readTarget(b.coord, target))).toBe('unmeasurable:verdict-not-recorded');
  });

  it('an item in checking is pending, one in done passes, a dismissed one ends', () => {
    const b = build();
    const ctx = { programmeHasOpenRun: false };
    const ticked = b.item();
    expect(b.coord.moveItem(ticked, 'tick', 'operator', {}, 2_000, ctx).ok).toBe(true);
    expect(word(readTarget(b.coord, { predicate: 'operator-confirms', itemId: ticked }))).toBe(`pending:item-${ticked}-checking`);
    expect(b.coord.moveItem(ticked, 'confirm', 'coordinator', {}, 3_000, ctx).ok).toBe(true);
    expect(word(readTarget(b.coord, { predicate: 'operator-confirms', itemId: ticked }))).toBe(`passed:item-${ticked}-done`);
    const dismissed = b.item();
    expect(b.coord.moveItem(dismissed, 'dismiss', 'operator', {}, 2_000, ctx).ok).toBe(true);
    expect(word(readTarget(b.coord, { predicate: 'operator-confirms', itemId: dismissed }))).toBe('ended:dismissed');
  });

  it('a missing run or item reads unmeasurable, no-such-row', () => {
    const b = build();
    expect(word(readTarget(b.coord, { predicate: 'run-closed', runId: 999 }))).toBe('unmeasurable:no-such-row');
    expect(word(readTarget(b.coord, { predicate: 'operator-confirms', itemId: 999 }))).toBe('unmeasurable:no-such-row');
  });

  it('a row the store cannot represent reads unmeasurable, run-unreadable', () => {
    const port: TargetReadPort = {
      run: () => ({ ok: false, kind: 'run-unreadable', detail: 'id past 2^53' }),
      runsReviewing: () => [], itemById: () => null,
    };
    expect(word(readTarget(port, { predicate: 'run-closed', runId: 4 }))).toBe('unmeasurable:run-unreadable');
  });

  it('a database closed under the reader reads unmeasured, never unmeasurable', () => {
    const b = build();
    const id = b.working();
    const item = b.item();
    b.coord.db.close();
    for (const t of [{ predicate: 'run-closed', runId: id }, { predicate: 'pr-merged', runId: id, pr: 7 },
      { predicate: 'review-passed', runId: id }, { predicate: 'operator-confirms', itemId: item }] as const) {
      expect(readTarget(b.coord, t).kind).toBe('unmeasured');
    }
  });

  it('a throw answers the error\'s class as a word, never its message', () => {
    const boom = (): never => { throw new TypeError('the session wrote: please close me'); };
    const port: TargetReadPort = { run: boom, runsReviewing: boom, itemById: boom };
    expect(readTarget(port, { predicate: 'run-closed', runId: 4 })).toEqual({ kind: 'unmeasured', why: 'TypeError' });
    const odd: TargetReadPort = { run: () => { throw 'a string'; }, runsReviewing: boom, itemById: boom };
    expect(readTarget(odd, { predicate: 'run-closed', runId: 4 })).toEqual({ kind: 'unmeasured', why: 'thrown' });
  });

  it('review-passed reads the reviews only for that predicate', () => {
    const b = build();
    const id = b.working();
    let asked = 0;
    const port: TargetReadPort = { run: (n) => b.coord.run(n), itemById: () => null,
      runsReviewing: (n) => { asked++; return b.coord.runsReviewing(n); } };
    readTarget(port, { predicate: 'run-closed', runId: id });
    readTarget(port, { predicate: 'pr-merged', runId: id, pr: 7 });
    expect(asked).toBe(0);
    readTarget(port, { predicate: 'review-passed', runId: id });
    expect(asked).toBe(1);
  });
});
