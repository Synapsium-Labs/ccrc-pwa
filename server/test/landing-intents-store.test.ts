// Landing order wave 5g (Task 1): `CoordStore.dispatchRun` is the one writer of landing intents and
// `CoordStore.heldLandingIntents` the one reader. Temporary coord.db files only.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const P = 'project-a';
let coord: CoordStore;
beforeEach(() => {
  coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-intents-'), '.ccrc', 'coord.db')));
});

let wave = 0;
const open = (project: string = P, claimedBy = 'coord-a', program = 'prog-a'): number => {
  const r = coord.openRun({ program, title: 't', project, wave: ++wave, waveOf: null, claimedBy });
  if (!('id' in r)) throw new Error('fixture openRun refused');
  return r.id;
};
const dispatch = (id: number, intents?: readonly string[], items: readonly string[] = []) =>
  coord.dispatchRun({ runId: id, sessionId: `ws-${id}`, workspace: null, branch: null, resumed: false, clearedAt: null, items, ...(intents === undefined ? {} : { intents }) });
const dispatched = (intents: readonly string[], project: string = P, program = 'prog-a'): number => {
  const id = open(project, 'coord-a', program);
  expect(dispatch(id, intents).ok).toBe(true);
  return id;
};
const step = (id: number, to: Parameters<CoordStore['advance']>[1]): void => {
  if (!coord.advance(id, to, 'test').ok) throw new Error(`fixture advance to ${to} refused`);
};
const rows = (id: number) => coord.db.prepare('SELECT key FROM landing_intents WHERE runId = ? ORDER BY key').all(id);
const setRaw = (id: number, state: string): void => { coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, id); };

describe('a dispatched run holds its keys', () => {
  it('holds them, ordered by key then run id, with the run and its programme', () => {
    const a = dispatched(['#2', 'D-5'], P, 'prog-a');
    const b = dispatched(['#2'], P, 'prog-b');
    expect(coord.heldLandingIntents(P, ['#2', 'D-5', '#9'])).toEqual([
      { key: '#2', runId: a, program: 'prog-a' }, { key: '#2', runId: b, program: 'prog-b' },
      { key: 'D-5', runId: a, program: 'prog-a' },
    ]);
  });
  it('answers [] for no keys', () => {
    dispatched(['#1']);
    expect(coord.heldLandingIntents(P, [])).toEqual([]);
  });
  it('a run closed done holds nothing', () => {
    const id = dispatched(['#1']);
    step(id, 'working'); step(id, 'closing'); step(id, 'done');
    expect(coord.heldLandingIntents(P, ['#1'])).toEqual([]);
  });
  it.each(['operator', 'sweep'])('a run abandoned failed (causedBy %s) holds nothing', (causedBy) => {
    const id = dispatched(['#1']);
    expect(coord.closeRun({ runId: id, finalState: 'failed', causedBy, handoffCommit: null, program: 'prog-a', viaClosing: false }).ok).toBe(true);
    expect(coord.heldLandingIntents(P, ['#1'])).toEqual([]);
  });
  it.each(['awaiting-review', 'merging', 'closing', 'unknown', 'queued'])('a run whose state reads %s still holds', (state) => {
    const id = dispatched(['#1']);
    setRaw(id, state);
    expect(coord.heldLandingIntents(P, ['#1']).map((h) => h.runId)).toEqual([id]);
  });
  it('another project\'s row with the same key is not returned', () => {
    dispatched(['#1'], 'project-b');
    expect(coord.heldLandingIntents(P, ['#1'])).toEqual([]);
  });
});

describe('the write', () => {
  it('a dispatch whose transition is refused writes no row', () => {
    const id = dispatched(['#1']);
    const again = dispatch(id, ['#2']);
    expect(again.ok).toBe(false);
    expect(rows(id)).toEqual([{ key: '#1' }]);
    const closed = open();
    step(closed, 'dispatched');
    step(closed, 'working'); step(closed, 'closing'); step(closed, 'done');
    expect(dispatch(closed, ['#3']).ok).toBe(false);
    expect(rows(closed)).toEqual([]);
  });
  it('a repeated key throws and the run is still planned, with no row and no items', () => {
    const id = open();
    expect(() => dispatch(id, ['#1', '#1'], ['an item'])).toThrow();
    expect(coord.db.prepare('SELECT state, sessionId FROM runs WHERE id = ?').get(id)).toEqual({ state: 'planned', sessionId: null });
    expect(rows(id)).toEqual([]);
    expect(coord.db.prepare('SELECT COUNT(*) AS n FROM work_items WHERE runId = ?').get(id)).toEqual({ n: 0 });
  });
  it('setBy is the run\'s claimedBy and takenAt its dispatchedAt', () => {
    const id = open(P, 'lane-a');
    dispatch(id, ['#1']);
    const run = coord.db.prepare('SELECT claimedBy, dispatchedAt FROM runs WHERE id = ?').get(id) as { claimedBy: string; dispatchedAt: number };
    expect(coord.db.prepare('SELECT project, setBy, takenAt FROM landing_intents WHERE runId = ?').get(id))
      .toEqual({ project: P, setBy: 'lane-a', takenAt: run.dispatchedAt });
    expect(run.dispatchedAt).toBeGreaterThan(0);
  });
  it('no intents writes nothing', () => {
    const id = dispatched([]);
    expect(rows(id)).toEqual([]);
  });
});
