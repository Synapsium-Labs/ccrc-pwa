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
import { okSiblings } from './coordReadHelpers.js';

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
    expect(s.parentOfSession('demo-w')).toBe('coord-2');
    expect(s.openClaimantsOf('demo-w')).toEqual(['coord-2', 'coord-1']);
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
    expect(s.parentOfSession('demo-w')).toBe('coord-gone');
    expect(s.openClaimantsOf('demo-w')).toEqual(['coord-gone']);
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
