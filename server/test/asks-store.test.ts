// The ask pre-emption lane's coord.db table (D-2169), task 4: only that the
// migration lands at the right version with the columns the lane needs.
// Reading/writing it is task 5's job.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');

describe('the asks table', () => {
  it('is created at schema version 9 with the columns the lane needs', () => {
    const home = mkTmp('ccrc-coord-');
    const db = openCoordDb(dbPathIn(home));
    expect(COORD_SCHEMA_VERSION).toBe(9);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('asks')").all() as
      { name: string }[]).map((r) => r.name).sort();
    expect(cols).toEqual([
      'answer', 'answeredAt', 'answeredBy', 'askAt', 'askKey', 'at', 'childId',
      'dialogId', 'id', 'options', 'parentId', 'question', 'releasedAt', 'runId', 'state',
    ]);
    db.close();
  });
});

// Task 5: the store methods the ask pre-emption lane needs — the
// parent-derivation query and the mutex that stops two principals pressing
// two different digits into one menu. `mk()` copies the fixture idiom from
// `coord-store.test.ts`'s own `store()` helper verbatim.
describe('ask store methods', () => {
  const mk = (): CoordStore => new CoordStore(openCoordDb(dbPathIn(mkTmp('ccrc-coord-'))));

  it('derives a program worker parent from the run that dispatched it', () => {
    const s = mk();
    const run = s.openRun({ program: 'prog', title: 'Prog', project: 'p',
      wave: 1, waveOf: null, claimedBy: 'coord-1' }) as { id: number };
    s.setSession(run.id, 'child-1');
    expect(s.parentOfSession('child-1')).toBe('coord-1');
    expect(s.parentOfSession('nobody')).toBeNull();
  });

  it('follows a reclaim, because the parent is derived and not stored', () => {
    const s = mk();
    const run = s.openRun({ program: 'prog', title: 'Prog', project: 'p',
      wave: 1, waveOf: null, claimedBy: 'coord-1' }) as { id: number };
    s.setSession(run.id, 'child-1');
    // `reclaimProgram` takes the RUN id, not the program slug — the store's
    // real signature (`reclaimProgram(runId, to, at)`), not the brief's
    // illustrative `('prog', 'coord-2', ...)`.
    s.reclaimProgram(run.id, 'coord-2', Date.now());
    expect(s.parentOfSession('child-1')).toBe('coord-2');
  });

  it('refuses a second taker — the row is the mutex (D-2171)', () => {
    const s = mk();
    const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
    expect(s.takeAskForAnswer(id, 1000).ok).toBe(true);
    const second = s.takeAskForAnswer(id, 1000);
    expect(second).toEqual({ ok: false, why: 'not-held' });
  });

  it('refuses an answer aimed at a different instance of the same question (D-2170)', () => {
    const s = mk();
    const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
    // The child answered instance 1 and repainted an identical menu: same
    // askKey, same labels, new hookstate write.
    expect(s.takeAskForAnswer(id, 2000)).toEqual({ ok: false, why: 'ask-moved' });
  });
});
