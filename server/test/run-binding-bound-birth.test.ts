// ARCH-62 (#797) slice 4, GitHub #1407: the bind records the occupant's birth, so a run planned BEFORE the worker was
// born and then bound to the live worker (the `openRun` dup arm, a wave N >= 2 run) is `bound`, not `undecidable`, and a
// run bound to an EARLIER occupant of a reused name is `unbound` whatever its `openedAt` (D6 of D-5920, #758).
// Red first: before the stamp, both runs below carried no birth and read `undecidable`.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { bindingOf, bornIncarnation, parentOf, unbornIncarnation } from '../src/coord/runBinding.js';
import { mkTmp } from './tmpHelpers.js';

const OLD = 1_700_000_000_000;
const BORN = OLD + 5_000_000;
const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-bound-birth-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, claimedBy: string, openedAt: number): number => {
  const id = (s.openRun({ program, title: program, project: 'p', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(openedAt, id);
  return id;
};
/** A minting run: bound with an explicit birth, its `dispatchStartedAt` the same instant (as the fresh-spawn dispatch writes). */
const mint = (s: CoordStore, id: number, session: string, born: number): void => {
  s.db.prepare('UPDATE runs SET dispatchStartedAt = ? WHERE id = ?').run(born, id);
  s.setSession(id, session, born);
};
const series = (s: CoordStore, session: string) => {
  const r = s.bindingRunsOf(session);
  if (!r.ok) throw new Error(r.detail);
  return r.runs;
};

describe('the bind records the occupant\'s birth (ARCH-62 slice 4, #1407)', () => {
  it('a wave planned before the birth and bound to the live worker is bound: the dup-arm run keeps its parent', () => {
    const s = store();
    const w1 = open(s, 'prog-a', 'coord-1', BORN - 1000);
    const w2 = open(s, 'prog-b', 'coord-1', BORN - 1000);
    mint(s, w1, 'demo-w', BORN);
    s.setSession(w2, 'demo-w');
    for (const to of ['dispatched', 'closing', 'done'] as const) s.advance(w1, to, 'coordinator');
    const binding = bindingOf(series(s, 'demo-w'), bornIncarnation('demo-w', BORN));
    expect(binding.undecided).toEqual([]);
    expect(binding.open?.id).toBe(w2);
    expect(parentOf(binding)).toBe('coord-1');
  });

  it('a run bound to an EARLIER occupant of a reused name is unbound for the next occupant, whatever its openedAt', () => {
    const s = store();
    const old = open(s, 'prog-old', 'coord-gone', OLD);
    mint(s, old, 'demo-w', OLD);
    const wave2 = open(s, 'prog-old2', 'coord-gone', OLD + 1000);
    s.setSession(wave2, 'demo-w');
    // The name is reused: a new occupant is born later, its minting run stamped with the new birth.
    s.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(old);
    const fresh = open(s, 'prog-new', 'coord-live', BORN + 1000);
    mint(s, fresh, 'demo-w', BORN);
    const binding = bindingOf(series(s, 'demo-w'), bornIncarnation('demo-w', BORN));
    expect(binding.open?.id).toBe(fresh);
    expect(binding.undecided).toEqual([]);
    expect(parentOf(binding)).toBe('coord-live');
  });

  it('the stamp is the session\'s NEWEST placeable birth, and none for a session that never had one', () => {
    const s = store();
    const coord = open(s, 'prog-c', 'coord-1', OLD);
    s.setSession(coord, 'manual-ws');
    const row = s.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(coord);
    expect(row).toEqual({ sessionBornAt: null, sessionBornFor: null });
    expect(bindingOf(series(s, 'manual-ws'), unbornIncarnation('manual-ws', 'not-a-child')).open?.id).toBe(coord);
  });

  it('an adopted bind (an explicit null birth) stays unstamped', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1', OLD);
    mint(s, a, 'demo-w', OLD);
    const b = open(s, 'prog-b', 'coord-1', OLD + 10);
    s.setSession(b, 'demo-w', null);
    const cols = () => s.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(b);
    expect(cols()).toEqual({ sessionBornAt: null, sessionBornFor: null });
    // The dispatch that follows re-states the same session with no birth: it must not date the adopted run to the
    // earlier occupant's birth (a placeable birth of this id exists on run a).
    s.markDispatched(b, 'demo-w', 'demo-w', 'ws/w', false);
    expect(cols()).toEqual({ sessionBornAt: null, sessionBornFor: null });
  });

  it('a stamp is write-once for the bound session: a re-statement of the same session leaves it, even after a newer occupant', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1', OLD);
    mint(s, a, 'demo-w', OLD);
    const b = open(s, 'prog-b', 'coord-1', OLD + 10);
    s.setSession(b, 'demo-w');
    s.setSession(b, 'demo-w');
    const born = () => s.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(b);
    expect(born()).toEqual({ sessionBornAt: OLD, sessionBornFor: 'demo-w' });
    // The name is reused and a newer occupant is minted; run b still belongs to the occupant it was bound to.
    const fresh = open(s, 'prog-new', 'coord-live', BORN + 1000);
    mint(s, fresh, 'demo-w', BORN);
    s.setSession(b, 'demo-w');
    expect(born()).toEqual({ sessionBornAt: OLD, sessionBornFor: 'demo-w' });
  });

  it('the stamp is the NEWEST placeable birth of the session, not the first one it ever had', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1', OLD);
    mint(s, a, 'demo-w', OLD);
    const fresh = open(s, 'prog-new', 'coord-live', BORN + 1000);
    mint(s, fresh, 'demo-w', BORN);
    const c = open(s, 'prog-c', 'coord-live', BORN + 2000);
    s.setSession(c, 'demo-w');
    expect(s.db.prepare('SELECT sessionBornAt FROM runs WHERE id = ?').get(c)).toEqual({ sessionBornAt: BORN });
  });

  it('a birth the minting run cannot place (it differs from the run\'s dispatchStartedAt) is not stamped', () => {
    const s = store();
    const a = open(s, 'prog-a', 'coord-1', OLD);
    mint(s, a, 'demo-w', OLD);
    const adopted = open(s, 'prog-x', 'coord-1', OLD + 1);
    s.setSession(adopted, 'demo-w', BORN);   // dispatchStartedAt is NULL: childBirthOf calls this birth unplaceable
    const c = open(s, 'prog-c', 'coord-1', BORN + 2000);
    s.setSession(c, 'demo-w');
    expect(s.db.prepare('SELECT sessionBornAt FROM runs WHERE id = ?').get(c)).toEqual({ sessionBornAt: OLD });
  });
});
