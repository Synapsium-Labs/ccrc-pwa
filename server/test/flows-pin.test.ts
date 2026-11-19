// Flows wave 2 (plan 2026-11-19-flows-w2 Task 2): the operator's default flow, and the flow a programme pins once, at its
// row's first write. Fixture homes only.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NO_PLAN_CHANGES, applyPlanChanges } from '../src/coord/planStore.js';
import { skeletonFlowDoc } from '../../shared/flows.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-flows-pin-'), 'coord.db')));
const open = (coord: CoordStore, program: string): void => {
  const r = coord.openRun({ program, title: 'wave 1', project: 'project-a', wave: 1, waveOf: 2, claimedBy: 'lane-a-project-a' });
  expect(r).toHaveProperty('id');
};
/** A flow with `n` published versions. */
const published = (coord: CoordStore, n: number): number => {
  const doc = skeletonFlowDoc('Mine');
  const id = coord.createFlow(doc, null, 1);
  for (let i = 0; i < n; i++) expect(coord.publishFlow(id, doc, 2 + i)).toMatchObject({ ok: true });
  return id;
};

describe('the flow a programme pins', () => {
  it('pins nothing while there is no default', () => {
    const coord = store();
    published(coord, 1);
    open(coord, 'programme-a');
    expect(coord.readProgrammeFlowPin('programme-a')).toBeNull();
  });

  it('pins the default\'s newest version at the first write, and nothing moves it', () => {
    const coord = store();
    const id = published(coord, 2);
    expect(coord.setDefaultFlow(id)).toEqual({ ok: true });
    open(coord, 'programme-a');
    expect(coord.readProgrammeFlowPin('programme-a')).toEqual({ flowId: id, version: 2 });
    const doc = skeletonFlowDoc('Mine');
    expect(coord.publishFlow(id, doc, 9)).toEqual({ ok: true, version: 3 });
    const other = published(coord, 1);
    coord.setDefaultFlow(other);
    coord.openRun({ program: 'programme-a', title: 'wave 2', project: 'project-a', wave: 2, waveOf: 2, claimedBy: 'lane-a-project-a' });
    expect(coord.readProgrammeFlowPin('programme-a')).toEqual({ flowId: id, version: 2 });
    open(coord, 'programme-b');
    expect(coord.readProgrammeFlowPin('programme-b')).toEqual({ flowId: other, version: 1 });
    expect(coord.flowPinnedBy(id)).toBe(1);
  });

  it('the plan put, when it writes the row first, pins the same way', () => {
    const coord = store();
    const id = published(coord, 1);
    coord.setDefaultFlow(id);
    applyPlanChanges(coord.db, 'programme-c', NO_PLAN_CHANGES(), 'lane-a-project-a', 5, { home: 'project-a', title: 'Programme C' });
    expect(coord.readProgrammeFlowPin('programme-c')).toEqual({ flowId: id, version: 1 });
  });
});

describe('the default flow', () => {
  it('refuses a flow with no published version and an unknown one; null clears', () => {
    const coord = store();
    const draftOnly = coord.createFlow(skeletonFlowDoc('Draft'), null, 1);
    expect(coord.setDefaultFlow(draftOnly)).toEqual({ ok: false, refused: 'unpublished' });
    expect(coord.setDefaultFlow(99)).toEqual({ ok: false, refused: 'not-found' });
    const id = published(coord, 1);
    coord.setDefaultFlow(id);
    expect(coord.readDefaultFlow()).toBe(id);
    expect(coord.setDefaultFlow(null)).toEqual({ ok: true });
    expect(coord.readDefaultFlow()).toBeNull();
  });

  it('a pinned flow cannot be deleted; deleting the unpinned default clears it', () => {
    const coord = store();
    const pinned = published(coord, 1);
    coord.setDefaultFlow(pinned);
    open(coord, 'programme-a');
    expect(coord.deleteFlow(pinned)).toEqual({ refused: 'pinned', by: 1 });
    const spare = published(coord, 1);
    coord.setDefaultFlow(spare);
    expect(coord.deleteFlow(spare)).toEqual({ changed: true });
    expect(coord.readDefaultFlow()).toBeNull();
    open(coord, 'programme-b');
    expect(coord.readProgrammeFlowPin('programme-b')).toBeNull();
  });
});
