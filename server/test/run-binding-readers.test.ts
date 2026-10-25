// ARCH-62 (#797): the store's session-keyed readers answer through `bindingOf` (coord/runBinding.ts), and the sites
// that know a worker's birth pass its incarnation. Red first: before this change a reader ignored an incarnation, so a
// reused workspace name inherited the run opened for the occupant before it (#746, D6 of D-5920).
//
// The fixture is the one the wave exit names: two runs naming one worker; a recycled id; the open-vs-newest pair.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { bornIncarnation, unbornIncarnation } from '../src/coord/runBinding.js';
import { heldFor } from '../src/coord/heldFor.js';
import { runDriftPass, type DriftLaneDeps } from '../src/coord/driftLane.js';
import { mkTmp } from './tmpHelpers.js';
import { okSiblings } from './coordReadHelpers.js';

const BORN = 1_700_000_000_000;
const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-binding-readers-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, claimedBy: string): number =>
  (s.openRun({ program, title: program, project: 'p', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
const finish = (s: CoordStore, id: number): void => {
  for (const to of ['dispatched', 'closing', 'done'] as const) s.advance(id, to, 'coordinator');
};
const inc = bornIncarnation('demo-w', BORN);

/** A reused name: a run of an earlier occupant is still open, unstamped, opened before the new occupant was born. */
function recycled(s: CoordStore, finishFresh: boolean): { stale: number; fresh: number } {
  const stale = open(s, 'prog-old', 'coord-gone');
  s.setSession(stale, 'demo-w');
  s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN - 1000, stale);
  const fresh = open(s, 'prog-new', 'coord-live');
  s.setSession(fresh, 'demo-w', BORN);
  s.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(BORN, fresh);
  if (finishFresh) finish(s, fresh);
  return { stale, fresh };
}

describe('the readers take the worker\'s incarnation (ARCH-62)', () => {
  it('two runs naming one worker: the newest open run is the parent, the set holds both claimants', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w', BORN);
    const b = open(s, 'prog-b', 'coord-2');
    s.setSession(b, 'demo-w');
    expect(s.parentOfSession('demo-w', inc)).toBe('coord-2');
    expect(s.openClaimantsOf('demo-w', inc)).toEqual(['coord-2', 'coord-1']);
    expect(okSiblings(s.openRunsForSession('demo-w', undefined, inc)).map((r) => r.id)).toEqual([a, b]);
  });

  it('a recycled id: the run of the earlier occupant is no parent, no claimant and no sibling', () => {
    const s = store();
    const { stale, fresh } = recycled(s, true);
    expect(s.parentOfSession('demo-w', inc)).toBeNull();
    expect(s.openClaimantsOf('demo-w', inc)).toEqual([]);
    expect(okSiblings(s.openRunsForSession('demo-w', undefined, inc))).toEqual([]);
    // Without an incarnation the readers keep the id-string rule (a coordinator, a manual workspace).
    expect(s.parentOfSession('demo-w')).toBe('coord-gone');
    expect(s.openClaimantsOf('demo-w', unbornIncarnation('demo-w', 'not-a-child'))).toEqual(['coord-gone']);
    expect([stale, fresh].length).toBe(2);
  });

  it('the open-vs-newest pair: runsNamingSession lists every bound run in any state, openRunsForSession the open ones', () => {
    const s = store();
    const { stale, fresh } = recycled(s, true);
    const later = open(s, 'prog-later', 'coord-live');
    s.setSession(later, 'demo-w');
    const named = s.runsNamingSession('demo-w', inc);
    expect(named.ok && named.runs.map((r) => [r.id, r.state])).toEqual([[fresh, 'done'], [later, 'planned']]);
    expect(okSiblings(s.openRunsForSession('demo-w', undefined, inc)).map((r) => r.id)).toEqual([later]);
    const every = s.runsNamingSession('demo-w');
    expect(every.ok && every.runs.map((r) => r.id)).toEqual([stale, fresh, later]);
  });

  it('heldFor on a recycled name: the stale claimant is no "other programme" for the new occupant', async () => {
    const s = store();
    const { fresh } = recycled(s, true);
    const verdict = await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: fresh } as never, [], BORN + 5000);
    expect(verdict).toEqual({ kind: 'not-a-child' });
  });

  it('heldFor on a live occupant is unchanged: the claimant of the run the mark names holds the ask', async () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w', BORN);
    s.db.prepare('UPDATE runs SET dispatchStartedAt = ?, coordProject = ? WHERE id = ?').run(BORN, 'p', a);
    const verdict = await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: a } as never, [], BORN + 5000);
    expect(verdict).toMatchObject({ kind: 'released', runId: a });
  });

  it('heldFor keeps the hold for a pre-planned wave 2 bound without a birth, once wave 1 (the mark) closed', async () => {
    const s = store();
    const w1 = open(s, 'prog-a', 'coord-1');
    const w2 = open(s, 'prog-b', 'coord-1');
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id IN (?, ?)').run(BORN - 1000, w1, w2);
    s.setSession(w1, 'demo-w', BORN);
    s.setSession(w2, 'demo-w');
    s.db.prepare('UPDATE runs SET dispatchStartedAt = ?, coordProject = ? WHERE id = ?').run(BORN, 'p', w1);
    finish(s, w1);
    const verdict = await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: w1 } as never, [], BORN + 5000);
    expect(verdict).toMatchObject({ kind: 'released', runId: w1 });
    expect(verdict).not.toEqual({ kind: 'not-a-child' });
    // The undecided run of ANOTHER claimant stays no parent.
    const g = open(s, 'prog-g', 'coord-ghost');
    s.setSession(g, 'demo-w');
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN - 1000, g);
    finish(s, w2);
    const after = await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: w1 } as never, [], BORN + 5000);
    expect(after).toEqual({ kind: 'not-a-child' });
  });

  it('heldFor: an ownerless undecided open run still counts as a sibling, so the answer is released / run-unclaimed (ruling on slice 1)', async () => {
    // An unstamped wave 2 opened before the birth (undecidable), and an ownerless closed wave 1 (the mark).
    const s = store();
    const w1 = open(s, 'prog-a', 'coord-1');
    const w2 = open(s, 'prog-b', 'coord-1');
    s.db.prepare('UPDATE runs SET openedAt = ?, claimedBy = NULL WHERE id IN (?, ?)').run(BORN - 1000, w1, w2);
    s.setSession(w1, 'demo-w', BORN);
    s.setSession(w2, 'demo-w');
    s.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(BORN, w1);
    finish(s, w1);
    const verdict = await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: w1 } as never, [], BORN + 5000);
    expect(verdict).toMatchObject({ kind: 'released', runId: w1, reason: 'run-unclaimed' });
    // Once that run closes too, nothing is open any more: not a child.
    finish(s, w2);
    const after = await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: w1 } as never, [], BORN + 5000);
    expect(after).toEqual({ kind: 'not-a-child' });
  });
});

const laneDeps = (s: CoordStore, markRunId: number): DriftLaneDeps => ({
  coord: s, names: ['demo-w'], childMarks: new Map([['demo-w', { kind: 'child', runId: markRunId }]]) as never,
  measure: () => Promise.resolve({ state: 'alive', why: 'pane live' }),
  notice: () => ({ recorded: true, archived: 'none' }), warn: () => {},
});
const mismatches = (s: CoordStore): string[] => {
  const found = s.driftFindingRows();
  return found.ok ? found.rows.map((r) => r.key).filter((k) => k.includes('parent-mismatch')) : ['unreadable'];
};

describe('the drift lane reads the worker\'s parent through its incarnation (ARCH-62)', () => {
  // The positive arm: a real parent mismatch is still raised. A lane whose parent always read null (the `parentId =
  // null` mutant) passes every negative test below; these go red under it.
  it('a real mismatch is raised: the mark\'s run is claimed by coord-1, a newer open run of the same worker by coord-2', async () => {
    const s = store();
    const mark = open(s, 'prog-a', 'coord-1');
    s.setSession(mark, 'demo-w');
    const newer = open(s, 'prog-b', 'coord-2');
    s.setSession(newer, 'demo-w');
    await runDriftPass(laneDeps(s, mark), BORN + 5000);
    expect(mismatches(s)).toEqual(['parent-mismatch:demo-w']);
  });

  it('a real mismatch is raised for a born incarnation: the newer run is stamped with the birth', async () => {
    const s = store();
    const mark = open(s, 'prog-a', 'coord-1');
    s.setSession(mark, 'demo-w', BORN);
    const newer = open(s, 'prog-b', 'coord-2');
    s.setSession(newer, 'demo-w', BORN);
    await runDriftPass(laneDeps(s, mark), BORN + 5000);
    expect(mismatches(s)).toEqual(['parent-mismatch:demo-w']);
  });

  it('a real mismatch is raised for a born incarnation: the newer run is unstamped but opened after the birth', async () => {
    const s = store();
    const mark = open(s, 'prog-a', 'coord-1');
    s.setSession(mark, 'demo-w', BORN);
    const newer = open(s, 'prog-b', 'coord-2');
    s.setSession(newer, 'demo-w');
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN + 1000, newer);
    await runDriftPass(laneDeps(s, mark), BORN + 5000);
    expect(mismatches(s)).toEqual(['parent-mismatch:demo-w']);
  });

  // A deliberate fix, not a recycled-name case: before ARCH-62 the lane read the mark run's claimant from the OPEN
  // runs only, so a plain wave N >= 2 resume (wave 1, the mark, closed; same claimant) raised a false parent-mismatch.
  // Per the D-5362 rule the claimant of a closed mark is the minting run's own.
  it('a stamped wave 2 opened after the birth, wave 1 (the mark) closed, same claimant: no parent-mismatch', async () => {
    const s = store();
    const w1 = open(s, 'prog-a', 'coord-1');
    s.setSession(w1, 'demo-w', BORN);
    s.db.prepare('UPDATE runs SET dispatchStartedAt = ?, coordProject = ? WHERE id = ?').run(BORN, 'p', w1);
    finish(s, w1);
    const w2 = open(s, 'prog-a', 'coord-1');
    s.setSession(w2, 'demo-w', BORN);
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN + 1000, w2);
    await runDriftPass(laneDeps(s, w1), BORN + 5000);
    expect(mismatches(s)).toEqual([]);
  });

  it('a recycled name raises no parent-mismatch finding for the run of the earlier occupant', async () => {
    const s = store();
    const { fresh } = recycled(s, true);
    const sent: unknown[] = [];
    const deps = (marks: ReadonlyMap<string, { kind: 'child'; runId: number }>): DriftLaneDeps => ({
      coord: s, names: ['demo-w'], childMarks: marks as never, measure: () => Promise.resolve({ state: 'alive', why: 'pane live' }),
      notice: (e) => { sent.push(e); return { recorded: true, archived: 'none' }; }, warn: () => {},
    });
    await runDriftPass(deps(new Map([['demo-w', { kind: 'child', runId: fresh }]])), BORN + 5000);
    const found = s.driftFindingRows();
    expect(found.ok && found.rows.map((r) => r.key).filter((k) => k.includes('parent-mismatch'))).toEqual([]);
  });

  it('a pre-planned wave 2 (wave 1 is the mark and closed; wave 2 unstamped, opened before the birth, same claimant) raises no parent-mismatch', async () => {
    const s = store();
    const w1 = open(s, 'prog-a', 'coord-1');
    const w2 = open(s, 'prog-b', 'coord-1');
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id IN (?, ?)').run(BORN - 1000, w1, w2);
    s.setSession(w1, 'demo-w', BORN);
    s.setSession(w2, 'demo-w');
    s.db.prepare('UPDATE runs SET dispatchStartedAt = ?, coordProject = ? WHERE id = ?').run(BORN, 'p', w1);
    finish(s, w1);
    const deps: DriftLaneDeps = {
      coord: s, names: ['demo-w'], childMarks: new Map([['demo-w', { kind: 'child', runId: w1 }]]) as never,
      measure: () => Promise.resolve({ state: 'alive', why: 'pane live' }),
      notice: () => ({ recorded: true, archived: 'none' }), warn: () => {},
    };
    await runDriftPass(deps, BORN + 5000);
    const found = s.driftFindingRows();
    expect(found.ok && found.rows.map((r) => r.key).filter((k) => k.includes('parent-mismatch'))).toEqual([]);
  });
});
