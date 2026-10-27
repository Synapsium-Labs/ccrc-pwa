// ARCH-60 (#795), characterization. Green on the code BEFORE `coord/runBinding.ts` exists: today's session-keyed run
// readers on the shapes the binding epic (#771) is about, pinned as they answer now. These are the readers ARCH-62
// routes through `bindingOf`/`childrenOf`; a later commit changes a pin here only with a line saying why.
//
// The #746 shape is the one worth stating: a name is reused while an old run still names it, and the readers match on
// the id string alone, so the old run answers for the new occupant.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { okSiblings, parentOfSession } from './coordReadHelpers.js';
import { claimantsOfSession, coordinatorOfRun, openRunsClaimedBy, workerOfRun } from '../src/coord/bindingReads.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-binding-char-'), '.ccrc', 'coord.db')));

const open = (s: CoordStore, program: string, claimedBy: string): number =>
  (s.openRun({ program, title: program, project: 'p', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;

const finish = (s: CoordStore, id: number): void => {
  for (const to of ['dispatched', 'closing', 'done'] as const) {
    expect(s.advance(id, to, 'coordinator')).toMatchObject({ ok: true });
  }
};

describe('today\'s session-keyed run readers (characterization, ARCH-60)', () => {
  it('two runs naming one worker: the newest open run is the parent, the set holds both claimants', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    const b = open(s, 'prog-b', 'coord-2');
    s.setSession(b, 'demo-w');
    expect(parentOfSession(s, 'demo-w')).toBe('coord-2');
    expect(claimantsOfSession(s, 'demo-w')).toEqual(['coord-2', 'coord-1']);
  });

  it('the open-vs-newest pair: runsNamingSession lists every state, openRunsForSession only the open ones', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    finish(s, a);
    const b = open(s, 'prog-b', 'coord-2');
    s.setSession(b, 'demo-w');
    const named = s.runsNamingSession('demo-w');
    expect(named.ok && named.runs.map((r) => [r.id, r.state])).toEqual([[a, 'done'], [b, 'planned']]);
    expect(okSiblings(s.openRunsForSession('demo-w')).map((r) => r.id)).toEqual([b]);
  });

  it('a recycled id inherits the old run (#746): the stale open run answers for the new occupant', () => {
    const s = store();
    const stale = open(s, 'prog-old', 'coord-gone');
    s.setSession(stale, 'demo-w');
    // The reused name's new occupant: a later run of another coordinator, bound with a birth, already closed.
    const fresh = open(s, 'prog-new', 'coord-live');
    s.setSession(fresh, 'demo-w', 1_700_000_000_000);
    finish(s, fresh);
    expect(parentOfSession(s, 'demo-w')).toBe('coord-gone');
    expect(claimantsOfSession(s, 'demo-w')).toEqual(['coord-gone']);
  });

  it('the birth is stamped with the session it was recorded for, and cleared when the occupant changes', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w', 1_700_000_000_000);
    const row = (): { sessionBornAt: number | null; sessionBornFor: string | null } =>
      s.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(a) as never;
    expect(row()).toEqual({ sessionBornAt: 1_700_000_000_000, sessionBornFor: 'demo-w' });
    s.setSession(a, 'demo-w');
    expect(row()).toEqual({ sessionBornAt: 1_700_000_000_000, sessionBornFor: 'demo-w' });
    tx(s.db, () => { s.db.prepare('UPDATE runs SET sessionId = NULL WHERE id = ?').run(a); });
    s.setSession(a, 'demo-x');
    expect(row()).toEqual({ sessionBornAt: null, sessionBornFor: null });
  });
});

// ARCH-62 (#797), characterization: the rest of the session-keyed readers the store holds, pinned before they are
// routed through `bindingOf`. Green on the code before the routing; the routing commit changes none of these.
describe('the other session-keyed readers as they answer before ARCH-62', () => {
  it('openRunsForSession excludes the named run and lists the rest in id order', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    const b = open(s, 'prog-b', 'coord-2');
    s.setSession(b, 'demo-w');
    expect(okSiblings(s.openRunsForSession('demo-w')).map((r) => r.id)).toEqual([a, b]);
    expect(okSiblings(s.openRunsForSession('demo-w', a)).map((r) => r.id)).toEqual([b]);
    expect(okSiblings(s.openRunsForSession('demo-other')).map((r) => r.id)).toEqual([]);
  });

  it('a run in a state this build cannot name counts as open, for the parent, the set and the sibling list', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    tx(s.db, () => { s.db.prepare("UPDATE runs SET state = 'from-a-newer-build' WHERE id = ?").run(a); });
    expect(parentOfSession(s, 'demo-w')).toBe('coord-1');
    expect(claimantsOfSession(s, 'demo-w')).toEqual(['coord-1']);
    expect(okSiblings(s.openRunsForSession('demo-w')).map((r) => r.id)).toEqual([a]);
    const named = s.runsNamingSession('demo-w');
    expect(named.ok && named.runs.map((r) => r.state)).toEqual(['unknown']);
  });

  it('an ownerless open run makes the parent null and is no entry in the claimant set', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    const b = open(s, 'prog-b', 'coord-2');
    s.setSession(b, 'demo-w');
    tx(s.db, () => { s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(b); });
    expect(parentOfSession(s, 'demo-w')).toBeNull();
    expect(claimantsOfSession(s, 'demo-w')).toEqual(['coord-1']);
  });

  it('a finished worker has no parent and no claimants', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    finish(s, a);
    expect(parentOfSession(s, 'demo-w')).toBeNull();
    expect(claimantsOfSession(s, 'demo-w')).toEqual([]);
  });

  it('openRunsClaimedBy lists a claimant\'s open runs, session-less planned ones included', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    s.setSession(a, 'demo-w');
    const b = open(s, 'prog-b', 'coord-1');
    const c = open(s, 'prog-c', 'coord-1');
    finish(s, c);
    expect(okSiblings(openRunsClaimedBy(s, 'coord-1')).map((r) => r.id)).toEqual([a, b]);
  });

  it('resolveWorker and resolveCoordinator read one run\'s own columns', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1');
    expect(workerOfRun(s, a)).toBeNull();
    s.setSession(a, 'demo-w');
    expect(workerOfRun(s, a)).toBe('demo-w');
    expect(coordinatorOfRun(s, a)).toBe('coord-1');
  });
});
