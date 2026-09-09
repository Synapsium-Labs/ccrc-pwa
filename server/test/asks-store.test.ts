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

  // Fix round 1, finding 1: `parentOfSession` must count a run whose raw
  // `state` reads the literal `'unknown'` token as OPEN, the same way
  // `openRunsForSession`/`openCoordinatorIds` already do (`state NOT IN
  // ('done','failed')`) — never `TERMINAL_RUN_STATES`, which is derived from
  // `RUN_TRANSITIONS` and therefore calls `'unknown'` terminal. Written
  // directly at the DB layer, the `coord-store.test.ts` idiom for "a state
  // token this build does not know" (there it uses an ARBITRARY unrecognised
  // token, e.g. `'reconciling'`, to prove the HYDRATE side degrades to
  // `'unknown'` on read; here the raw column is set to the literal word
  // `'unknown'` itself, because that is the one value whose presence in
  // `TERMINAL_RUN_STATES` — and absence from the shipped `('done','failed')`
  // spelling — is the actual divergence between the two predicates).
  it("counts a raw 'unknown' run state as OPEN, not terminal — copies openCoordinatorIds' ruling (fix round 1, finding 1)", () => {
    const s = mk();
    const run = s.openRun({ program: 'prog', title: 'Prog', project: 'p',
      wave: 1, waveOf: null, claimedBy: 'coord-1' }) as { id: number };
    s.setSession(run.id, 'child-1');
    s.db.prepare("UPDATE runs SET state = 'unknown' WHERE id = ?").run(run.id);
    expect(s.parentOfSession('child-1')).toBe('coord-1');
  });

  // Fix round 1, finding 2: the `ORDER BY id DESC` tie-break was a comment,
  // not a mechanism — no test pinned it, so deleting it or flipping it to ASC
  // left the whole suite green. Two DIFFERENT programs (not two waves of one
  // program): `openRun`'s one-coordinator-per-program guard refuses a second
  // `claimedBy` for the SAME program unless a `reclaimProgram` ran in
  // between, and a reclaim rewrites EVERY run of that program to the new
  // claimant — which would make both rows agree and defeat the point of a
  // tie-break test. Two independent programs both dispatching to one
  // `sessionId` is exactly the state `openRunsForSession`'s own docstring
  // says nothing at this layer prevents.
  it("answers the newest run's claimant when two runs name one session (fix round 1, finding 2)", () => {
    const s = mk();
    const first = s.openRun({ program: 'prog-a', title: 'A', project: 'p',
      wave: 1, waveOf: null, claimedBy: 'coord-1' }) as { id: number };
    s.setSession(first.id, 'child-1');
    const second = s.openRun({ program: 'prog-b', title: 'B', project: 'p',
      wave: 1, waveOf: null, claimedBy: 'coord-2' }) as { id: number };
    s.setSession(second.id, 'child-1');
    expect(s.parentOfSession('child-1')).toBe('coord-2');
  });

  // Fix round 1, finding 3: `untakeAsk` — the rollback for a take whose
  // subsequent press was refused. `releaseAsk` cannot serve this: its CAS
  // source is `'held'`, and by the time a caller needs this the row has
  // already moved to `'answering'`.
  it('untakeAsk returns a taken row to held, and a second take then succeeds (fix round 1, finding 3)', () => {
    const s = mk();
    const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
    expect(s.takeAskForAnswer(id, 1000).ok).toBe(true);
    expect(s.untakeAsk(id)).toBe(true);
    expect(s.askById(id)!.state).toBe('held');
    expect(s.takeAskForAnswer(id, 1000).ok).toBe(true);
  });

  // Fix round 1, finding 4: unguarded, `settleAsk` would rewrite a `released`
  // or `stale` row to `'answered'` with a fabricated answerer — a record
  // asserting an answer nobody gave, in a table whose whole job is to BE the
  // record. Guarded to `AND state = 'answering'`, a settle aimed at a row it
  // does not hold is a silent no-op instead: the row stays exactly as it was.
  it('settleAsk refuses to rewrite a row it does not hold (fix round 1, finding 4)', () => {
    const s = mk();
    const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
    expect(s.releaseAsk(id, 2000)).toBe(true);
    s.settleAsk(id, 'operator', 'a', 3000);
    const row = s.askById(id)!;
    expect(row.state).toBe('released');
    expect(row.answeredBy).toBeNull();
  });

  // Task 19: `currentAskFor`, the fleet chip's read — unlike `heldAskFor`
  // above, NOT filtered to `'held'`. Every state the row can be in.
  describe('currentAskFor — the newest row for a child, in ANY state', () => {
    it('is null when the child has never had an ask row', () => {
      const s = mk();
      expect(s.currentAskFor('nobody')).toBeNull();
    });

    it('answers the live held row', () => {
      const s = mk();
      const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
      expect(s.currentAskFor('c')).toEqual(s.askById(id));
      expect(s.currentAskFor('c')!.state).toBe('held');
    });

    it('answers a row that has moved past held — answering, answered, released, stale', () => {
      const s = mk();
      const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
      s.takeAskForAnswer(id, 1000);
      expect(s.currentAskFor('c')!.state).toBe('answering'); // heldAskFor would answer null here
      s.settleAsk(id, 'p', 'a', 2000);
      expect(s.currentAskFor('c')!.state).toBe('answered');
    });

    it('answers the NEWEST row once a second ask is minted for the same child', () => {
      // The precedence a fresh mint relies on (`currentAskFor`'s own
      // docstring): a new insert only ever happens once the previous row has
      // left `held`, so ordering by id DESC always names the CURRENT
      // question, not a stale ruling from an earlier one.
      const s = mk();
      const first = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k1',
        askAt: 1000, dialogId: 'd1', question: 'first?', options: ['a'], now: 1 });
      s.takeAskForAnswer(first, 1000);
      s.settleAsk(first, 'p', 'a', 2000);
      const second = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k2',
        askAt: 3000, dialogId: 'd2', question: 'second?', options: ['a'], now: 3 });
      const current = s.currentAskFor('c')!;
      expect(current.id).toBe(second);
      expect(current.state).toBe('held');
      expect(current.question).toBe('second?');
    });

    it('scopes to the named child — a sibling\'s ask never leaks through', () => {
      const s = mk();
      s.insertAsk({ childId: 'sibling', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a'], now: 1 });
      expect(s.currentAskFor('c')).toBeNull();
    });
  });
});
