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
import { claimantsOfSession, openRunsClaimedBy, runsTouching } from '../src/coord/bindingReads.js';
import { mkTmp } from './tmpHelpers.js';
import { okSiblings, parentOfSession } from './coordReadHelpers.js';

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
    expect(parentOfSession(s, 'demo-w', inc)).toBe('coord-2');
    expect(claimantsOfSession(s, 'demo-w', inc)).toEqual(['coord-2', 'coord-1']);
    expect(okSiblings(s.openRunsForSession('demo-w', undefined, inc)).map((r) => r.id)).toEqual([a, b]);
  });

  it('a recycled id: the run of the earlier occupant is no parent, no claimant and no sibling', () => {
    const s = store();
    const { stale, fresh } = recycled(s, true);
    expect(parentOfSession(s, 'demo-w', inc)).toBeNull();
    expect(claimantsOfSession(s, 'demo-w', inc)).toEqual([]);
    expect(okSiblings(s.openRunsForSession('demo-w', undefined, inc))).toEqual([]);
    // Without an incarnation the readers keep the id-string rule (a coordinator, a manual workspace).
    expect(parentOfSession(s, 'demo-w')).toBe('coord-gone');
    expect(claimantsOfSession(s, 'demo-w', unbornIncarnation('demo-w', 'not-a-child'))).toEqual(['coord-gone']);
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
    // The run of ANOTHER claimant, bound to an EARLIER occupant of the name: it is bound before the birth exists, so the
    // bind (which records the occupant's birth, #1407) has none to record, and the run stays undecided.
    const g = open(s, 'prog-g', 'coord-ghost');
    s.setSession(g, 'demo-w');
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id IN (?, ?, ?)').run(BORN - 1000, w1, w2, g);
    s.setSession(w1, 'demo-w', BORN);
    s.db.prepare('UPDATE runs SET dispatchStartedAt = ?, coordProject = ? WHERE id = ?').run(BORN, 'p', w1);
    s.setSession(w2, 'demo-w');
    finish(s, w1);
    const verdict = await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: w1 } as never, [], BORN + 5000);
    expect(verdict).toMatchObject({ kind: 'released', runId: w1 });
    expect(verdict).not.toEqual({ kind: 'not-a-child' });
    // The undecided run of ANOTHER claimant stays no parent.
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

describe('the folded readers, asked through bindingReads (ARCH-62 slice 2)', () => {
  it('claimantsOfSession lists every claimant, newest open run first, and openRunsClaimedBy the open runs a coordinator holds', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    const b = open(s, 'prog-b', 'coord-2');
    s.setSession(b, 'demo-w');
    const planned = open(s, 'prog-c', 'coord-1');
    expect(claimantsOfSession(s, 'demo-w')).toEqual(['coord-2', 'coord-1']);
    expect(okSiblings(openRunsClaimedBy(s, 'coord-1')).map((r) => r.id)).toEqual([a, planned]);
    finish(s, a);
    expect(claimantsOfSession(s, 'demo-w')).toEqual(['coord-2']);
  });

  it('runsTouching walks the runs a session works on or claims, any state, by id', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    const b = open(s, 'prog-b', 'demo-w');
    finish(s, a);
    expect(runsTouching(s, 'demo-w')).toMatchObject({ ok: true, runs: [{ id: a }, { id: b }] });
    expect(runsTouching(s, 'nobody')).toEqual({ ok: true, runs: [] });
  });

  it('runsTouching answers a series the process cannot represent as a named failure, never an empty walk', () => {
    const bad = { bindingRunsOf: () => ({ ok: false as const, detail: 'id out of range' }) };
    expect(runsTouching(bad, 'x')).toEqual({ ok: false, detail: 'runsTouching: id out of range' });
  });

  it('claimantsOfSession throws when the series itself cannot be read, never reads as an empty list', () => {
    const bad = { bindingRunsOf: () => ({ ok: false as const, kind: 'run-unreadable' as const, detail: 'id out of range' }) };
    expect(() => claimantsOfSession(bad, 'x')).toThrow('claimantsOfSession: id out of range');
  });

  // Ruling (a), the worker half: `openClaimantsOf` proved no integers, so a WORKER row beyond 2^53 neither failed it nor,
  // when terminal, entered it. Red on b05c06373 (claimantsOfSession measured every worker row and threw).
  it('claimantsOfSession proves no integers: a done worker run beyond 2^53 is outside the answer, an open one is in it', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-x');
    s.setSession(a, 'demo-w');
    const big = open(s, 'prog-big', 'coord-3');
    s.setSession(big, 'demo-w');
    s.db.prepare("UPDATE runs SET id = ?, state = 'done' WHERE id = ?").run(2n ** 53n + 1n, big);
    expect(claimantsOfSession(s, 'demo-w')).toEqual(['coord-x']);
    s.db.prepare("UPDATE runs SET state = 'planned' WHERE claimedBy = 'coord-3'").run();
    expect(claimantsOfSession(s, 'demo-w')).toEqual(['coord-3', 'coord-x']);
  });

  // Ruling (a): `openClaimantsOf`'s scope exactly. The session's WORKER rows decide it; a run it CLAIMS (here one whose id
  // is beyond 2^53) neither enters the answer nor fails it. Red on the fold over `bindingRunsOf` (it threw).
  it('claimantsOfSession reads the worker rows only: a claimed run beyond 2^53 neither widens nor fails it', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-x');
    s.setSession(a, 'demo-w');
    const own = open(s, 'prog-own', 'demo-w');
    s.db.prepare('UPDATE runs SET id = ? WHERE id = ?').run(2n ** 53n + 1n, own);
    expect(claimantsOfSession(s, 'demo-w')).toEqual(['coord-x']);
    expect(claimantsOfSession(s, 'coord-x')).toEqual([]);
    const solo = store();
    const big = open(solo, 'prog-big', 'coord-big');
    solo.db.prepare('UPDATE runs SET id = ? WHERE id = ?').run(2n ** 53n + 1n, big);
    expect(claimantsOfSession(solo, 'coord-big')).toEqual([]);
  });

  // Ruling (a): heldFor, when the whole series cannot be represented but the worker rows prove a parent, answers with that
  // parent, as `parentOfSession` let it before the fold. Red on the fold (it threw `heldFor: ...`).
  it('heldFor falls back to the proven parent when the series read fails', async () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    s.db.prepare('UPDATE runs SET coordProject = ? WHERE id = ?').run('p', a);
    const own = open(s, 'prog-own', 'demo-w');
    s.db.prepare('UPDATE runs SET id = ? WHERE id = ?').run(2n ** 53n + 1n, own);
    expect(s.bindingRunsOf('demo-w').ok).toBe(false);
    const verdict = await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: a } as never, [], BORN);
    expect(verdict).toEqual({ kind: 'released', parent: 'coord-1', runId: a, reason: 'parent-not-live' });
  });

  // As on main: with no parent proven the parent is null and heldFor goes on to the sibling check, which finds no open run
  // naming the child. Red on b05c06373 (it threw `heldFor: run id is not a positive safe integer`).
  it('heldFor answers not-a-child when the series read fails and no open run names the child', async () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    finish(s, a);
    const own = open(s, 'prog-own', 'demo-w');
    s.db.prepare('UPDATE runs SET id = ? WHERE id = ?').run(2n ** 53n + 1n, own);
    expect(await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: a } as never, [], BORN)).toEqual({ kind: 'not-a-child' });
  });

  // A DONE worker run beyond 2^53 fails the series; the open parent run still holds the prompt for its claimant, as
  // `parentOfSession` let it on main. Red on b05c06373 (the fallback measured that terminal row and threw).
  it('heldFor keeps the open parent when a done worker run beyond 2^53 fails the series', async () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    s.db.prepare('UPDATE runs SET coordProject = ? WHERE id = ?').run('p', a);
    const big = open(s, 'prog-big', 'coord-z');
    s.setSession(big, 'demo-w');
    s.db.prepare("UPDATE runs SET id = ?, state = 'done' WHERE id = ?").run(2n ** 53n + 1n, big);
    expect(s.bindingRunsOf('demo-w').ok).toBe(false);
    const verdict = await heldFor({ coord: s } as never, 'demo-w', { kind: 'child', runId: a } as never, [], BORN);
    expect(verdict).toEqual({ kind: 'released', parent: 'coord-1', runId: a, reason: 'parent-not-live' });
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
  // Slice 1 went on with parentId null for a worker whose series could not be read; the fold must not end the pass.
  it('one worker whose series cannot be represented does not end the pass: another worker\'s real mismatch is still raised', async () => {
    const s = store();
    const mark = open(s, 'prog-a', 'coord-1');
    s.setSession(mark, 'demo-x');
    const newer = open(s, 'prog-b', 'coord-2');
    s.setSession(newer, 'demo-x');
    const bad = Object.create(s) as CoordStore;
    bad.bindingRunsOf = (id: string) => id === 'demo-w' ? { ok: false as const, kind: 'run-unreadable' as const, detail: 'id out of range' } : s.bindingRunsOf(id);
    const warns: string[] = [];
    await runDriftPass({
      coord: bad, names: ['demo-w', 'demo-x'], warn: (m: string) => { warns.push(m); },
      childMarks: new Map([['demo-w', { kind: 'child', runId: mark }], ['demo-x', { kind: 'child', runId: mark }]]) as never,
      measure: () => Promise.resolve({ state: 'alive', why: 'pane live' }),
      notice: () => ({ recorded: true, archived: 'none' }),
    }, BORN + 5000);
    expect(warns.some((w) => w.includes('demo-w'))).toBe(true);
    expect(mismatches(s)).toEqual(['parent-mismatch:demo-x']);
  });

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

  // The drift lane's parent is heldFor's: a done worker run beyond 2^53 fails the series, and the open binding the worker
  // rows prove still is the parent (main's `parentOfSession`). Red on b05c06373 (the lane read no parent, so no finding).
  it('a real mismatch is still raised when a done worker run beyond 2^53 fails the series', async () => {
    const s = store();
    const mark = open(s, 'prog-a', 'coord-1');
    s.setSession(mark, 'demo-w');
    const newer = open(s, 'prog-b', 'coord-2');
    s.setSession(newer, 'demo-w');
    const big = open(s, 'prog-big', 'coord-z');
    s.setSession(big, 'demo-w');
    s.db.prepare("UPDATE runs SET id = ?, state = 'done' WHERE id = ?").run(2n ** 53n + 1n, big);
    expect(s.bindingRunsOf('demo-w').ok).toBe(false);
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
