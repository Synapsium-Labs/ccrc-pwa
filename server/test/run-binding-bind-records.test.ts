// ARCH-60 follow-up (#1407, part of #795): every bind records the incarnation it binds to. This file pins, by name, what
// `CoordStore.bindSession` writes for the bound incarnation, and the two gaps #1407 names. Written first as a
// characterization (green on the code before the fix); the gap cases carry a WRONG-ANSWER comment and flip with the fix.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { bindingOf, bornIncarnation, parentOf, unbornIncarnation } from '../src/coord/runBinding.js';
import { callsIn, sqlStatementsInFile, symbolOf } from './scan/symbols.js';
import { mkTmp } from './tmpHelpers.js';

const STORE = 'server/src/coord/store.ts';
const OLD = 1_700_000_000_000;
const BORN = OLD + 5_000_000;
const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-bind-records-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, claimedBy: string, openedAt: number): number => {
  const id = (s.openRun({ program, title: program, project: 'p', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(openedAt, id);
  return id;
};
const born = (s: CoordStore, id: number) => s.db.prepare('SELECT sessionBornAt, sessionBornFor FROM runs WHERE id = ?').get(id);
const series = (s: CoordStore, session: string) => {
  const r = s.bindingRunsOf(session);
  if (!r.ok) throw new Error(r.detail);
  return r.runs;
};

describe('the bound incarnation has one writer (ARCH-60 follow-up, #1407)', () => {
  // The statements of the store that SET a non-null birth from a bind: the explicit stamp in bindSession and the
  // occupant stamp. `clearSession` and the backfill write NULL or seed it, and are not binds.
  const setsBirth = (set: string | null): boolean => /sessionBornAt\s*=\s*(\?|b\.at)/.test(set ?? '');
  it('exactly the bind and the occupant stamp write a birth, and bindSession reaches the occupant stamp', () => {
    const writers = sqlStatementsInFile(STORE).filter((st) => st.verb === 'UPDATE' && st.table === 'runs' && setsBirth(st.set));
    const holders = writers.map((st) => [symbolOf(STORE, 'CoordStore.bindSession'), symbolOf(STORE, 'CoordStore.stampOccupantBirth')]
      .find((sym) => st.start >= sym.start && st.end <= sym.end)?.name);
    expect(holders.sort()).toEqual(['CoordStore.bindSession', 'CoordStore.stampOccupantBirth']);
    expect(callsIn(symbolOf(STORE, 'CoordStore.bindSession')).map((c) => c.callee)).toContain('this.stampOccupantBirth');
  });
});

describe('a bind with no placeable birth records nothing (the gaps of #1407, characterization)', () => {
  it('GAP 2, wrong answer: a wave bound to a live worker whose minting run cannot be placed stays undecided', () => {
    const s = store();
    const w1 = open(s, 'prog-a', 'coord-1', BORN - 1000);
    // The minting run recorded a birth but its dispatchStartedAt does not agree, so `childBirthOf` cannot place it.
    s.setSession(w1, 'demo-w', BORN);
    const w2 = open(s, 'prog-b', 'coord-1', BORN - 1000);
    s.setSession(w2, 'demo-w');
    // WRONG ANSWER (today): no birth is recorded for the later wave, so it reads undecidable, never a parent.
    expect(born(s, w2)).toEqual({ sessionBornAt: null, sessionBornFor: null });
    const binding = bindingOf(series(s, 'demo-w'), bornIncarnation('demo-w', BORN));
    expect(binding.undecided.map((r) => r.id)).toEqual([w2]);
  });

  it('GAP 1, residual: an unborn incarnation binds every run that names the id, whatever birth the run recorded', () => {
    const s = store();
    const old = open(s, 'prog-old', 'coord-gone', OLD);
    s.setSession(old, 'demo-w', OLD);
    const binding = bindingOf(series(s, 'demo-w'), unbornIncarnation('demo-w', 'not-a-child'));
    // Accepted until the registry names an occupant epoch (#1532): the id-string rule holds for an unborn session.
    expect(binding.open?.id).toBe(old);
    expect(parentOf(binding)).toBe('coord-gone');
  });
});
