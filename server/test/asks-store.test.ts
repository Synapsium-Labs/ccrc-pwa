// The ask pre-emption lane's coord.db table (D-2169), task 4: only that the
// migration lands at the right version with the columns the lane needs.
// Reading/writing it is task 5's job.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { COORD_SCHEMA_VERSION, openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { okAsk, okAsksByChild } from './coordReadHelpers.js';
import { ASK_STATES, isAskState, RUN_HOLD_NUMBER_MAX } from '../../shared/api.js';

const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');

describe('the asks table', () => {
  it('the cross-repo columns added at schema version 10 are still present at the current version', () => {
    const home = mkTmp('ccrc-coord-');
    const db = openCoordDb(dbPathIn(home));
    // TWELVE migrations have landed since this test's own version: MIGRATIONS[10]
    // (`runs.kind`/`runs.reviews`, review runs, design 2026-09-14 §5.1),
    // MIGRATIONS[11] (`runs.coordProject`, board placement wave 1 Task 1),
    // MIGRATIONS[12] (`pool_edges`/`pool_epoch`, account-pool membership wave 1
    // Task 6), MIGRATIONS[13] (the update control plane's five tables,
    // centralised update management W2 Task 3), MIGRATIONS[14] (the stall mail
    // read's indexes, worker stall watch wave 5), MIGRATIONS[15]
    // (`runs.sessionBornAt`/`sessionBornFor`, child-reclamation spec §5.1,
    // §5.3), MIGRATIONS[16] (`stall_settings` and `run_events_by_at`, stall
    // watch settings §8), MIGRATIONS[17] (`dead_claimants`, workspace
    // lifecycle §5.4), MIGRATIONS[18] (`dead_coordinator_breaker_state`,
    // workspace lifecycle §5.4), MIGRATIONS[19] (`collect_lane_settings`,
    // path-identity §5.2), MIGRATIONS[20] (`asks.releaseReason`, D-5290,
    // coordinator-first routing §5.2) and MIGRATIONS[21] (the six
    // `delegation_*` tables, delegation broker wave 3). Only MIGRATIONS[20]
    // touches the asks table. This pin only needs the CURRENT total — it
    // asserts "no migration after the one this test knows about has changed
    // the asks table's columns", not anything about any of the twelve.
    expect(COORD_SCHEMA_VERSION).toBe(22);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('asks')").all() as
      { name: string }[]).map((r) => r.name).sort();
    expect(cols).toEqual([
      'answer', 'answeredAt', 'answeredBy', 'askAt', 'askKey', 'at', 'childId',
      'dialogId', 'id', 'options', 'parentId', 'question', 'releaseReason', 'releasedAt', 'runId', 'state',
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
    // real signature (`reclaimProgram(runId, to, at, null)`), not the brief's
    // illustrative `('prog', 'coord-2', ...)`.
    s.reclaimProgram(run.id, 'coord-2', Date.now(), null);
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
    expect(s.untakeAsk(id, 'held')).toBe(true);
    expect(okAsk(s.askById(id))!.state).toBe('held');
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
    const row = okAsk(s.askById(id))!;
    expect(row.state).toBe('released');
    expect(row.answeredBy).toBeNull();
  });

  // WHOLE-BRANCH REVIEW, F2(a) — the RULING: `staleAsk`'s CAS source was
  // `'held'` ALONE, so a dialog that vanished while a row sat `'answering'`
  // changed zero rows and the row was stranded in that state FOREVER. No
  // restart needed to reach it: `detectDialogs`'s clear branch deletes the
  // `heldAsks` entry unconditionally, so the sweep can never see the row
  // again either, and `fleet.ts`'s `fleetAsk` folds `answering` onto `held`
  // — a permanent "held — <parent> may answer" chip on a question that no
  // longer exists. A vanished dialog is stale WHICHEVER principal was
  // mid-answer, so the CAS names both live states.
  it('marks an ANSWERING row stale when its dialog vanishes — the stranding F2(a) closes', () => {
    const s = mk();
    const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
    expect(s.takeAskForAnswer(id, 1000).ok).toBe(true);      // held -> answering
    expect(okAsk(s.askById(id))!.state).toBe('answering');
    expect(s.staleAsk('d', 'c', 4000)).toBe(true);
    const row = okAsk(s.askById(id))!;
    expect(row.state).toBe('stale');
    expect(row.releasedAt).toBe(4000);
  });

  // THE CONTROL for the widen above (a green mutation needs one): the CAS
  // names exactly two states, not "any state". A row that has already
  // SETTLED is a decision that was really made, and a late clear tick must
  // never rewrite it — `answered`, `released` and `stale` are all terminal
  // to this call.
  it('leaves an already-settled row alone — the widened CAS names two states, not all six', () => {
    const s = mk();
    for (const settle of [
      (id: number) => { s.takeAskForAnswer(id, 1000); s.settleAsk(id, 'p', 'a', 3000); },
      (id: number) => { s.releaseAsk(id, 3000); },
      (id: number) => { s.staleAsk('d', 'c', 3000); },
    ]) {
      const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
      settle(id);
      const before = okAsk(s.askById(id))!.state;
      expect(s.staleAsk('d', 'c', 9000)).toBe(false);
      expect(okAsk(s.askById(id))!.state).toBe(before);
    }
  });

  // Task 19: `currentAskFor`, the fleet chip's read — unlike `heldAskFor`
  // above, NOT filtered to `'held'`. Every state the row can be in.
  describe('currentAskFor — the newest row for a child, in ANY state', () => {
    it('is null when the child has never had an ask row', () => {
      const s = mk();
      expect(okAsk(s.currentAskFor('nobody'))).toBeNull();
    });

    it('answers the live held row', () => {
      const s = mk();
      const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
      expect(okAsk(s.currentAskFor('c'))).toEqual(okAsk(s.askById(id)));
      expect(okAsk(s.currentAskFor('c'))!.state).toBe('held');
    });

    it('answers a row that has moved past held — answering, answered, released, stale', () => {
      const s = mk();
      const id = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });
      s.takeAskForAnswer(id, 1000);
      expect(okAsk(s.currentAskFor('c'))!.state).toBe('answering'); // heldAskFor would answer null here
      s.settleAsk(id, 'p', 'a', 2000);
      expect(okAsk(s.currentAskFor('c'))!.state).toBe('answered');
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
      const current = okAsk(s.currentAskFor('c'))!;
      expect(current.id).toBe(second);
      expect(current.state).toBe('held');
      expect(current.question).toBe('second?');
    });

    it('scopes to the named child — a sibling\'s ask never leaks through', () => {
      const s = mk();
      s.insertAsk({ childId: 'sibling', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a'], now: 1 });
      expect(okAsk(s.currentAskFor('c'))).toBeNull();
    });
  });

  // Fix round 1, item 3 (coordinator review): `currentAskFor`'s batched
  // form, for `assembleFleet`'s one-query-per-frame read.
  describe('currentAsksFor — the batched form, one query for many children', () => {
    it('answers an empty map for an empty id list, without touching the db', () => {
      const s = mk();
      expect(okAsksByChild(s.currentAsksFor([]))).toEqual(new Map());
    });

    it('answers an empty map when none of the named children has ever had a row', () => {
      const s = mk();
      expect(okAsksByChild(s.currentAsksFor(['nobody', 'nobody-else']))).toEqual(new Map());
    });

    it('is keyed by childId, one entry per child that has a row, absent entirely for one that does not', () => {
      const s = mk();
      s.insertAsk({ childId: 'a', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['x'], now: 1 });
      const out = okAsksByChild(s.currentAsksFor(['a', 'b']));
      expect(out.size).toBe(1);
      expect(out.get('a')!.state).toBe('held');
      expect(out.has('b')).toBe(false);
    });

    it('matches currentAskFor row-for-row across every state, for the same set of children', () => {
      const s = mk();
      s.insertAsk({ childId: 'held-child', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a'], now: 1 });
      const answering = s.insertAsk({ childId: 'answering-child', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a'], now: 1 });
      s.takeAskForAnswer(answering, 1000);
      const answered = s.insertAsk({ childId: 'answered-child', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a'], now: 1 });
      s.takeAskForAnswer(answered, 1000);
      s.settleAsk(answered, 'p', 'a', 2000);
      const children = ['held-child', 'answering-child', 'answered-child'];
      const batch = okAsksByChild(s.currentAsksFor(children));
      for (const c of children) expect(batch.get(c)).toEqual(okAsk(s.currentAskFor(c)));
    });

    it('answers the NEWEST row per child, the same precedence currentAskFor gives one child', () => {
      const s = mk();
      const first = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k1',
        askAt: 1000, dialogId: 'd1', question: 'first?', options: ['a'], now: 1 });
      s.takeAskForAnswer(first, 1000);
      s.settleAsk(first, 'p', 'a', 2000);
      const second = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k2',
        askAt: 3000, dialogId: 'd2', question: 'second?', options: ['a'], now: 3 });
      const out = okAsksByChild(s.currentAsksFor(['c']));
      expect(out.get('c')!.id).toBe(second);
      expect(out.get('c')!.question).toBe('second?');
    });
  });
});

// ── D-2545: the ASK half of the persisted-integer read surface ──────────────
//
// `hydrateAsk` guards `state` and nothing else; `id` and `runId` coerced
// straight into numbers, so a row wider than the JavaScript safe domain crashed
// every ask reader with a bare `RangeError`. The two in-domain columns are now
// CAST to TEXT and proven; the four epoch-millisecond columns deliberately are
// NOT (see `ASK_COLS`'s own comment — that wider surface is D-2560's).
describe('the ask read surface refuses an unrepresentable row, and tells absent from unreadable', () => {
  const mk = (): CoordStore => new CoordStore(openCoordDb(dbPathIn(mkTmp('ccrc-coord-'))));
  const UNSAFE = BigInt(Number.MAX_SAFE_INTEGER) + 1n;

  /** Plant an `asks` row whose named column is outside the safe domain. */
  const plantUnsafe = (s: CoordStore, column: 'id' | 'runId', childId = 'c', parentId = 'p'): void => {
    s.db.prepare(
      'INSERT INTO asks (id, at, childId, parentId, runId, askKey, askAt, dialogId, ' +
      "question, options, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held')",
    ).run(
      column === 'id' ? UNSAFE : 9,
      1, childId, parentId,
      column === 'runId' ? UNSAFE : null,
      'k', 1000, 'd', 'q', JSON.stringify(['a']),
    );
  };

  it.each([
    ['id', 'ask id is not a positive safe integer'],
    ['runId', 'ask runId is not a positive safe integer'],
  ] as const)('askById refuses an unrepresentable %s, naming the COLUMN and no value', (column, detail) => {
    const s = mk();
    plantUnsafe(s, column);
    const id = column === 'id' ? Number(UNSAFE) : 9;
    expect(s.askById(id)).toEqual({ ok: false, kind: 'ask-unreadable', detail });
    expect(detail).not.toMatch(/[0-9]/);
  });

  it('askById answers {ok:true, ask:null} for a genuinely ABSENT row', () => {
    expect(mk().askById(4242)).toEqual({ ok: true, ask: null });
  });

  it('every ask reader refuses the same row, and answers absent as absent', () => {
    const s = mk();
    plantUnsafe(s, 'runId', 'c1', 'p1');
    const refusal = { ok: false, kind: 'ask-unreadable',
                      detail: 'ask runId is not a positive safe integer' };
    expect(s.heldAskFor('c1')).toEqual(refusal);
    expect(s.currentAskFor('c1')).toEqual(refusal);
    expect(s.asksForParent('p1')).toEqual(refusal);
    expect(s.currentAsksFor(['c1'])).toEqual(refusal);
    // …and the absent answers stay positively absent.
    expect(s.heldAskFor('nobody')).toEqual({ ok: true, ask: null });
    expect(s.currentAskFor('nobody')).toEqual({ ok: true, ask: null });
    expect(s.asksForParent('nobody')).toEqual({ ok: true, asks: [] });
    expect(okAsksByChild(s.currentAsksFor(['nobody'])).size).toBe(0);
    expect(okAsksByChild(s.currentAsksFor([])).size).toBe(0);
  });

  it('currentAsksFor fails the WHOLE frame on one unreadable row, never a partial map', () => {
    const s = mk();
    s.insertAsk({ childId: 'good', parentId: 'p', runId: null, askKey: 'k',
      askAt: 1000, dialogId: 'd', question: 'q', options: ['a'], now: 1 });
    plantUnsafe(s, 'id', 'bad', 'p');
    expect(s.currentAsksFor(['good', 'bad'])).toMatchObject({ ok: false, kind: 'ask-unreadable' });
    expect(s.asksForParent('p')).toMatchObject({ ok: false, kind: 'ask-unreadable' });
  });

  it('insertAsk refuses an unsafe generated id inside its transaction', () => {
    const s = mk();
    s.db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES ('asks', ?)")
      .run(RUN_HOLD_NUMBER_MAX);

    let escaped: number | undefined;
    expect(() => {
      escaped = s.insertAsk({ childId: 'c', parentId: 'p', runId: null, askKey: 'k',
        askAt: 1000, dialogId: 'd', question: 'q', options: ['a'], now: 1 });
    }).toThrow('insertAsk: generated ask id is not a positive safe integer');
    expect(escaped).toBeUndefined();
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM asks').get() as { n: number }).n).toBe(0);
  });

  // The DEFENSIVE write-side guard. Unreachable by construction today — its one
  // production call site takes `runId` off `openRunsForSession`, which now
  // proves it — so this is the mechanism that keeps it from being deleted as
  // dead code, and the second half is the one that matters: null stays LEGAL.
  it('insertAsk refuses a non-null out-of-domain runId, and still accepts null', () => {
    const s = mk();
    const mint = (runId: number | null) => s.insertAsk({ childId: 'c', parentId: 'p', runId,
      askKey: 'k', askAt: 1000, dialogId: 'd', question: 'q', options: ['a'], now: 1 });
    expect(() => mint(Number.MAX_SAFE_INTEGER + 1))
      .toThrow(/ask runId is not a positive safe integer/);
    expect(() => mint(0)).toThrow(/ask runId is not a positive safe integer/);
    expect(() => mint(-1)).toThrow(/ask runId is not a positive safe integer/);
    // REFUSED, NOT COERCED: nothing was written by any of the three.
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM asks').get() as { n: number }).n).toBe(0);
    expect(typeof mint(null)).toBe('number');
    expect(okAsk(s.currentAskFor('c'))!.runId).toBeNull();
  });
});

// D-5289 (coordinator-first routing, Task 4; spec §5.1): late answer wins.
// A lapse moves the row `held -> released` and fires the operator's push, but
// the row stays answerable by either principal until one of them acts — the
// `askAt` instance guard still decides WHICH dialog an answer may land in. A
// parent's own release is a different fact, a terminal `declined`, after which
// the parent may not answer at all.
describe('late answer wins; declined (D-5289)', () => {
  const CHILD = 'project-a-quiet-basin';
  const PARENT = 'project-a-calm-mesa';
  const mk = (): CoordStore => new CoordStore(openCoordDb(dbPathIn(mkTmp('ccrc-coord-'))));
  const mint = (s: CoordStore): number => s.insertAsk({ childId: CHILD, parentId: PARENT, runId: null,
    askKey: 'k', askAt: 1000, dialogId: 'd', question: 'q', options: ['a', 'b'], now: 1 });

  it('isAskState knows declined', () => {
    expect(isAskState('declined')).toBe(true);
  });

  it('takes a row the lapse released, and settles it answered', () => {
    const s = mk();
    const id = mint(s);
    expect(s.releaseAsk(id, 2)).toBe(true);
    const taken = s.takeAskForAnswer(id, 1000);
    expect(taken.ok).toBe(true);
    s.settleAsk(id, PARENT, 'b', 3);
    expect(okAsk(s.askById(id))).toMatchObject({ state: 'answered', answeredBy: PARENT, answer: 'b' });
  });

  it('a refused press after a late take rolls the row back to released, not held', () => {
    const s = mk();
    const id = mint(s);
    expect(s.releaseAsk(id, 2)).toBe(true);
    const taken = s.takeAskForAnswer(id, 1000);
    expect(taken.ok && taken.from).toBe('released');
    expect(s.untakeAsk(id, 'released')).toBe(true);
    expect(okAsk(s.askById(id))!.state).toBe('released');
  });

  it('keeps the instance guard on a released row — a re-minted dialog is refused', () => {
    const s = mk();
    const id = mint(s);
    expect(s.releaseAsk(id, 2)).toBe(true);
    expect(s.takeAskForAnswer(id, 2000)).toEqual({ ok: false, why: 'ask-moved' });
    expect(okAsk(s.askById(id))!.state).toBe('released');
  });

  it('declineAsk moves held -> declined, and a declined row is refused declined', () => {
    const s = mk();
    const id = mint(s);
    expect(s.declineAsk(id, 2)).toBe(true);
    expect(okAsk(s.askById(id))).toMatchObject({ state: 'declined', releasedAt: 2 });
    expect(s.declineAsk(id, 3)).toBe(false);
    expect(s.takeAskForAnswer(id, 1000)).toEqual({ ok: false, why: 'declined' });
    expect(okAsk(s.askById(id))!.state).toBe('declined');
  });

  it('an answered row is refused already-answered', () => {
    const s = mk();
    const id = mint(s);
    expect(s.takeAskForAnswer(id, 1000).ok).toBe(true);
    s.settleAsk(id, PARENT, 'a', 2);
    expect(s.takeAskForAnswer(id, 1000)).toEqual({ ok: false, why: 'already-answered' });
  });

  it('heldAskFor returns a released row, so the operator after a lapse is recorded', () => {
    const s = mk();
    const id = mint(s);
    expect(s.releaseAsk(id, 2)).toBe(true);
    expect(okAsk(s.heldAskFor(CHILD))?.id).toBe(id);
  });

  it('heldAskFor never returns a declined row', () => {
    const s = mk();
    const id = mint(s);
    expect(s.declineAsk(id, 2)).toBe(true);
    expect(okAsk(s.heldAskFor(CHILD))).toBeNull();
  });

  it('reads a declined row back as declined, never unknown', () => {
    const s = mk();
    const id = mint(s);
    s.db.prepare("UPDATE asks SET state = 'declined' WHERE id = ?").run(id);
    expect(okAsk(s.askById(id))!.state).toBe('declined');
  });

  // The compatibility claim in D-5289: a build whose vocabulary predates
  // `declined` reads it through the same fold every reader uses
  // (`isAskState(x) ? x : 'unknown'`). The six members are frozen here as that
  // older build's map; this build's map must be them plus `declined`.
  it('an older reader, without the member, degrades declined to unknown', () => {
    const OLDER: readonly string[] = ['held', 'answering', 'answered', 'released', 'stale', 'unknown'];
    const olderFold = (v: string): string => (OLDER.includes(v) ? v : 'unknown');
    expect(olderFold('declined')).toBe('unknown');
    expect([...ASK_STATES].sort()).toEqual([...OLDER, 'declined'].sort());
  });
});

describe('a row minted released, with its reason (D-5290)', () => {
  const CHILD = 'project-a-quiet-basin';
  const PARENT = 'project-a-calm-mesa';
  const mk = (): CoordStore => new CoordStore(openCoordDb(dbPathIn(mkTmp('ccrc-coord-'))));

  it('insertAsk with a release reason mints the row released at once, and reads the reason back', () => {
    const s = mk();
    const id = s.insertAsk({ childId: CHILD, parentId: PARENT, runId: null, askKey: 'k', askAt: 1000,
      dialogId: 'd', question: 'q', options: ['a', 'b'], now: 7, releaseReason: 'parent-not-live' });
    const row = okAsk(s.askById(id));
    expect(row).toMatchObject({ state: 'released', releasedAt: 7, releaseReason: 'parent-not-live' });
    // the operator's route still finds it (`heldAskFor` takes held or released)
    expect(okAsk(s.heldAskFor(CHILD))?.id).toBe(id);
  });

  it('a held mint carries no reason, and the lapse leaves it so', () => {
    const s = mk();
    const id = s.insertAsk({ childId: CHILD, parentId: PARENT, runId: null, askKey: 'k', askAt: 1000,
      dialogId: 'd', question: 'q', options: ['a', 'b'], now: 7 });
    expect(okAsk(s.askById(id))).toMatchObject({ state: 'held', releaseReason: null });
    expect(s.releaseAsk(id, 8)).toBe(true);
    expect(okAsk(s.askById(id))).toMatchObject({ state: 'released', releaseReason: null });
  });

  it('an out-of-vocabulary reason a newer build wrote reads back as unknown, never cast', () => {
    const s = mk();
    const id = s.insertAsk({ childId: CHILD, parentId: PARENT, runId: null, askKey: 'k', askAt: 1000,
      dialogId: 'd', question: 'q', options: ['a'], now: 7, releaseReason: 'parent-not-live' });
    s.db.prepare("UPDATE asks SET releaseReason = 'a-later-word' WHERE id = ?").run(id);
    expect(okAsk(s.askById(id))?.releaseReason).toBe('unknown');
  });
});
