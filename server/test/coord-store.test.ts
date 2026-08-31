// The store is where a run's authority lives. Three things are worth a test
// each: a transition the machine does not allow is REFUSED (not silently
// applied), every transition that IS allowed writes who caused it, and the caps
// are counts of rows rather than a second copy of a number.
//
// Plus the reconstruction drill spec:82-85 requires: a program is rebuildable
// from the ledger + the registry + .prhistory after the database is LOST.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, MAIL_RECLAIM_CANCELLED_ERROR } from '../src/coord/store.js';
import { releaseIsSafe } from '../src/coord/rundefs.js';
import { PROGRAM_KICKOFF_SUBJECT } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));

const openRun = (s: CoordStore, over: Partial<Parameters<CoordStore['openRun']>[0]> = {}) =>
  s.openRun({ program: 'build4', title: 'Transcript surface', project: 'ccrc-pwa',
              wave: 1, waveOf: 5, claimedBy: 'ccrc-pwa-coordinator', ...over });

describe('CoordStore: runs', () => {
  it('opens a run in `planned`, minting the program row once', () => {
    const s = store();
    // `openRun` returns `OpenRunResult`, a union with the refusal arm — narrow
    // before reading `.state`/`.program`, the same pattern every later
    // assertion in this file uses for its own `{ id: number }` cast. The
    // plan's own draft accessed these fields unnarrowed; `test/typecheck-
    // tests.test.ts` (a stricter, tests-inclusive tsc project the top-level
    // `tsc --noEmit` run does not cover) is what caught it.
    const a = openRun(s) as { id: number; program: string; state: string };
    expect(a.state).toBe('planned');
    const b = openRun(s, { wave: 2 }) as { id: number; program: string; state: string };
    expect(b.program).toBe('build4');
    expect(s.programs().length).toBe(1);          // second open reuses the slug
  });

  it('refuses a second coordinator rather than arbitrating', () => {
    // spec:291-292 — one coordinator per program; `claimedBy` exists so a
    // second one REFUSES.
    const s = store();
    openRun(s);
    expect(openRun(s, { wave: 2, claimedBy: 'ccrc-pwa-other' }))
      .toMatchObject({ refused: 'claimed-by-another' });
  });

  it('records who caused every transition, and refuses one the machine forbids', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    expect(s.advance(r.id, 'dispatched', 'coordinator')).toMatchObject({ ok: true });
    expect(s.advance(r.id, 'working', 'ccrc-pwa-quiet-mesa')).toMatchObject({ ok: true });
    // planned is not reachable from working — and the run is UNCHANGED.
    expect(s.advance(r.id, 'planned', 'operator'))
      .toEqual({ ok: false, error: 'bad-transition', from: 'working', to: 'planned' });
    expect(s.run(r.id)!.state).toBe('working');
    expect(s.runEvents(r.id).map((e) => [e.fromState, e.toState, e.causedBy])).toEqual([
      ['planned', 'dispatched', 'coordinator'],
      ['dispatched', 'working', 'ccrc-pwa-quiet-mesa'],
    ]);
  });

  it('reads a state token this build does not know as `unknown`, never as a raw string', () => {
    // The designated we-do-not-know member (spec:77), the same shape PrPhase's
    // 'unchecked' already has (registry.ts:133-140). Written by a NEWER build.
    const s = store();
    const r = openRun(s) as { id: number };
    s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('reconciling', r.id);
    expect(s.run(r.id)!.state).toBe('unknown');
  });

  it('lets the coordinator close directly from `dispatched` or `working` — the paths Task 9 actually writes (D-9)', () => {
    // RUN_TRANSITIONS review: PR I's dispatch route only ever advances a run
    // to `dispatched` (nothing in this PR writes `awaiting-review`/`merging`
    // — those are PR J's manual advance route), and its close route always
    // does `advance(id, 'closing')` right after. Before this fix every real
    // close in the build would 409 with bad-transition the first time it ran.
    const s = store();
    const a = openRun(s) as { id: number };
    expect(s.advance(a.id, 'dispatched', 'coordinator')).toMatchObject({ ok: true });
    expect(s.advance(a.id, 'closing', 'coordinator')).toMatchObject({ ok: true, from: 'dispatched' });
    expect(s.advance(a.id, 'done', 'coordinator')).toMatchObject({ ok: true });

    const b = openRun(s, { wave: 2 }) as { id: number };
    expect(s.advance(b.id, 'dispatched', 'coordinator')).toMatchObject({ ok: true });
    expect(s.advance(b.id, 'working', 'ccrc-pwa-quiet-mesa')).toMatchObject({ ok: true });
    expect(s.advance(b.id, 'closing', 'coordinator')).toMatchObject({ ok: true, from: 'working' });
  });

  it('writes handoffCommit through a real setter — the close path had none (found in a later Task 3 review, D-25)', () => {
    // `runs.handoffCommit` had exactly one writer in the whole tree before
    // this fix: `reconstruct`'s disaster-recovery INSERT. Every run this
    // build actually closes needs its own write path, the same way
    // `foldPrLineage` gives `prLineage` one.
    const s = store();
    const r = openRun(s) as { id: number };
    expect(s.run(r.id)!.handoffCommit).toBeNull();
    const sha = 'c'.repeat(40);
    s.setHandoffCommit(r.id, sha);
    expect(s.run(r.id)!.handoffCommit).toBe(sha);
  });

  it('refuses a transition from a state token this build does not know, rather than throwing (found in a later Task 3 review, D-27)', () => {
    // advance()'s OWN `isRunState` guard on `from` (store.ts:118) was pinned
    // nowhere — only hydrateRun's copy (the test above) ever was. Without it,
    // `RUN_TRANSITIONS['reconciling']` is `undefined` and `.includes(to)`
    // throws a TypeError instead of answering a typed `bad-transition`
    // refusal — the failure a rollback to a newer-build-written state would
    // hit at `POST /api/runs/:id/advance`.
    const s = store();
    const r = openRun(s) as { id: number };
    s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('reconciling', r.id);
    expect(s.advance(r.id, 'working', 'coordinator'))
      .toEqual({ ok: false, error: 'bad-transition', from: 'unknown', to: 'working' });
  });

  it('reads `clearedAt` from the real column, not a hardcoded null (D-1)', () => {
    // D-1's dispatch route (Task 9) is what WRITES this column; nothing in
    // this diff does, so a freshly opened run's answer is honestly null. The
    // point of this test is the other half: once something else DOES write
    // it (here, directly, the same way the state-token test above bypasses
    // the store to prove the read side rather than the write side), `run()`
    // must report the real value, not a value baked into `hydrateRun`.
    const s = store();
    const r = openRun(s) as { id: number };
    expect(s.run(r.id)!.clearedAt).toBeNull();
    const at = 1_700_000_000_000;
    s.db.prepare('UPDATE runs SET clearedAt = ? WHERE id = ?').run(at, r.id);
    expect(s.run(r.id)!.clearedAt).toBe(at);
  });

  // Test gap, I5 (finding 24): `runs({includeClosed:true, closedLimit})`'s
  // own clamp had no test anywhere in the tree — this file's mail-side
  // `clampMailLimit` coverage (`CoordStore: outstanding mail` below) never
  // reaches this call site, which shares the function but not a test.
  it('closedLimit caps ONLY the finished half, to the newest ids — an active run is never dropped by it, however old (finding 24)', () => {
    const s = store();
    const active = openRun(s) as { id: number };             // never closes — must survive every clamp below

    const closedIds: number[] = [];
    for (let wave = 2; wave <= 4; wave++) {
      const r = openRun(s, { wave }) as { id: number };
      expect(s.advance(r.id, 'failed', 'coordinator')).toMatchObject({ ok: true }); // planned -> failed, terminal
      closedIds.push(r.id);
    }

    // A clamp of 2 keeps the NEWEST 2 (by id) of the 3 closed runs, plus the
    // active one — never the oldest closed run.
    const capped = s.runs({ includeClosed: true, closedLimit: 2 }).map((r) => r.id).sort((a, b) => a - b);
    expect(capped).toEqual([active.id, ...closedIds.slice(1)].sort((a, b) => a - b));
    expect(capped).not.toContain(closedIds[0]);

    // A non-positive/non-finite closedLimit falls back to `clampMailLimit`'s
    // 100 default (never 0, which would silently hide every closed run).
    expect(s.runs({ includeClosed: true, closedLimit: 0 }).map((r) => r.id).sort((a, b) => a - b))
      .toEqual([active.id, ...closedIds].sort((a, b) => a - b));

    // `includeClosed:false` (the live-frame path) carries NO limit at all —
    // every closed run is simply absent because the WHERE clause never names
    // them, clamp or no clamp.
    expect(s.runs().map((r) => r.id)).toEqual([active.id]);
  });
});

describe('CoordStore: caps', () => {
  it('counts running runs and 24h dispatches from the rows, not from a counter', () => {
    const s = store();
    const now = 1_000_000_000_000;
    const a = openRun(s) as { id: number };
    const b = openRun(s, { wave: 2 }) as { id: number };
    s.markDispatched(a.id, 'ccrc-pwa-quiet-mesa', 'quiet-mesa', 'ws/quiet-mesa', false, now);
    s.markDispatched(b.id, 'ccrc-pwa-still-fen', 'still-fen', 'ws/still-fen', true, now - 25 * 3600_000);
    expect(s.capsUsage(now)).toEqual({ running: 2, dispatchedIn24h: 1 });
    expect(s.caps()).toEqual({ maxConcurrentWorkers: 3, maxSessionsPerDay: 12 });
  });

  it('does not count a `planned` run that never dispatched — a botched dispatch must not wedge the cap (D-13)', () => {
    // capsUsage review: `state NOT IN ('done','failed')` alone also matched
    // `planned` — the state `openRun` writes and Task 9's `ambiguous-dispatch`
    // refusal deliberately leaves a run in, with no session and no workspace.
    // Before this fix three botched dispatches on one program would pin
    // `running` at the default `maxConcurrentWorkers` forever.
    const s = store();
    const now = 1_000_000_000_000;
    openRun(s);                                                   // never dispatched
    const dispatched = openRun(s, { wave: 2 }) as { id: number };
    s.markDispatched(dispatched.id, 'ccrc-pwa-quiet-mesa', 'quiet-mesa', 'ws/quiet-mesa', false, now);
    expect(s.capsUsage(now)).toEqual({ running: 1, dispatchedIn24h: 1 });
  });

  it('excludes a dispatch exactly 24h old — the window is `>`, not `>=` (D-59)', () => {
    // Discriminates `capsUsage`: `>` -> `>=`. The only prior fixtures were
    // `now` and `now - 25h`/`now - 23h` — nothing landed exactly on the
    // boundary, so the mutant reproduced every assertion in both
    // coord-store.test.ts and run-routes.test.ts unchanged.
    const s = store();
    const now = 1_000_000_000_000;
    const a = openRun(s) as { id: number };
    s.markDispatched(a.id, 'ccrc-pwa-boundary', 'boundary', 'ws/boundary', false, now - 24 * 3600_000);
    expect(s.capsUsage(now)).toEqual({ running: 1, dispatchedIn24h: 0 });
  });
});

describe('CoordStore: work items', () => {
  it('tallies done/total per run without ever calling them tasks', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    const one = s.addWorkItem(r.id, 'implement the reader', []);
    s.addWorkItem(r.id, 'review it', [one.id]);
    expect(s.itemTally(r.id)).toEqual({ done: 0, total: 2 });
    s.setWorkItemState(r.id, one.id, 'done', 'ccrc-pwa-quiet-mesa');
    expect(s.itemTally(r.id)).toEqual({ done: 1, total: 2 });
  });
});

// ── Build 4, Task 2: one terminality point, and one batch commit ────────────
// Spec §3.2 and `architecture:145-147`: work items have ONE invariant —
// `done`/`failed`/`abandoned` are terminal — carried in the `UPDATE`'s own
// `WHERE` rather than in a transition table or a read above the write.

describe('setWorkItemState — one terminality point', () => {
  it('settles a pending item and answers ok', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    const one = s.addWorkItem(r.id, 'write it', []);
    expect(s.setWorkItemState(r.id, one.id, 'done', 'ccrc-pwa-quiet-mesa'))
      .toEqual({ ok: true, state: 'done' });
    expect(s.workItems(r.id)).toEqual([
      { id: one.id, title: 'write it', state: 'done', claimedBy: 'ccrc-pwa-quiet-mesa' },
    ]);
  });

  it('settles a CLAIMED item — only done/failed/abandoned are terminal', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    const direct = s.addWorkItem(r.id, 'claimed then done, directly', []);
    const batched = s.addWorkItem(r.id, 'claimed then done, in a batch', []);
    expect(s.setWorkItemState(r.id, direct.id, 'claimed', 'ccrc-pwa-quiet-mesa'))
      .toEqual({ ok: true, state: 'claimed' });
    expect(s.setWorkItemState(r.id, direct.id, 'done', 'ccrc-pwa-quiet-mesa'))
      .toEqual({ ok: true, state: 'done' });
    // The batch must agree with the `WHERE`: a pre-pass that called `claimed`
    // terminal would refuse this and the two would have drifted.
    expect(s.setWorkItemState(r.id, batched.id, 'claimed', null)).toEqual({ ok: true, state: 'claimed' });
    expect(s.settleItems(r.id, [{ id: batched.id, state: 'done', claimedBy: null }]))
      .toEqual({ ok: true, items: { done: 2, total: 2 } });
  });

  it('answers unknown-item for an id that belongs to ANOTHER run', () => {
    // D-278 (was D-B4-5): the signature is run-scoped, so a settle body can never move
    // another run's item.
    const s = store();
    const mine = openRun(s) as { id: number };
    const theirs = openRun(s, { wave: 2 }) as { id: number };
    const other = s.addWorkItem(theirs.id, 'not yours', []);
    expect(s.setWorkItemState(mine.id, other.id, 'done', null)).toEqual({ ok: false, why: 'unknown-item' });
    expect(s.workItems(theirs.id)).toEqual([
      { id: other.id, title: 'not yours', state: 'pending', claimedBy: null },
    ]);
  });

  it('answers unknown-item for an id no run has', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    expect(s.setWorkItemState(r.id, 9999, 'done', null)).toEqual({ ok: false, why: 'unknown-item' });
  });

  it('refuses to move a settled item, and names the state it is already in', () => {
    // Mutant A: deleting the `AND state NOT IN (…)` clause from the UPDATE.
    // Driven DIRECTLY, never through `settleItems` — the batch refuses in its
    // pre-pass, one statement earlier, and cannot discriminate this clause.
    const s = store();
    const r = openRun(s) as { id: number };
    for (const terminal of ['done', 'failed', 'abandoned'] as const) {
      const it0 = s.addWorkItem(r.id, `already ${terminal}`, []);
      expect(s.setWorkItemState(r.id, it0.id, terminal, 'ccrc-pwa-quiet-mesa'))
        .toEqual({ ok: true, state: terminal });
      expect(s.setWorkItemState(r.id, it0.id, 'claimed', 'ccrc-pwa-other'))
        .toEqual({ ok: false, why: 'terminal', state: terminal });
    }
  });

  it('leaves a refused row EXACTLY as it was — same state, same claimedBy', () => {
    // Mutant B: UPDATE first, then check. A guard that runs after the write
    // MOVES the row and then reports the refusal.
    const s = store();
    const r = openRun(s) as { id: number };
    const one = s.addWorkItem(r.id, 'settled once', []);
    s.setWorkItemState(r.id, one.id, 'done', 'ccrc-pwa-quiet-mesa');
    expect(s.setWorkItemState(r.id, one.id, 'failed', 'ccrc-pwa-vandal'))
      .toEqual({ ok: false, why: 'terminal', state: 'done' });
    expect(s.workItems(r.id)).toEqual([
      { id: one.id, title: 'settled once', state: 'done', claimedBy: 'ccrc-pwa-quiet-mesa' },
    ]);
    expect(s.itemTally(r.id)).toEqual({ done: 1, total: 1 });
  });

  it('reads every state back through isWorkItemState, never a cast', () => {
    // `hydrateRun`'s rule, one file over: a token this build does not know —
    // a newer server's seventh state, a rolled-back binary — reads as the
    // designated `unknown` member, never as a raw string.
    const s = store();
    const r = openRun(s) as { id: number };
    const one = s.addWorkItem(r.id, 'from the future', []);
    s.db.prepare('UPDATE work_items SET state = ? WHERE id = ?').run('transcending', one.id);
    expect(s.workItems(r.id)).toEqual([
      { id: one.id, title: 'from the future', state: 'unknown', claimedBy: null },
    ]);
  });
});

describe('settleItems — the batch, all-or-nothing, in ONE transaction', () => {
  /** Three pending items on one run, plus the run id. */
  const seeded = () => {
    const s = store();
    const r = openRun(s) as { id: number };
    const ids = ['one', 'two', 'three'].map((t) => s.addWorkItem(r.id, t, []).id);
    return { s, runId: r.id, ids: ids as [number, number, number] };
  };

  it('settles every item in the body and answers the fresh tally', () => {
    const { s, runId, ids } = seeded();
    expect(s.settleItems(runId, [
      { id: ids[0], state: 'done', claimedBy: 'ccrc-pwa-quiet-mesa' },
      { id: ids[1], state: 'failed', claimedBy: null },
    ])).toEqual({ ok: true, items: { done: 1, total: 3 } });
    expect(s.workItems(runId).map((i) => [i.state, i.claimedBy])).toEqual([
      ['done', 'ccrc-pwa-quiet-mesa'], ['failed', null], ['pending', null],
    ]);
  });

  it('settles NOTHING when one id in the batch is unknown — the earlier ids are untouched', () => {
    const { s, runId, ids } = seeded();
    expect(s.settleItems(runId, [
      { id: ids[0], state: 'done', claimedBy: null },
      { id: 9999, state: 'done', claimedBy: null },
      { id: ids[1], state: 'done', claimedBy: null },
    ])).toEqual({ ok: false, itemId: 9999, why: 'unknown-item' });
    expect(s.itemTally(runId)).toEqual({ done: 0, total: 3 });
    expect(s.workItems(runId).every((i) => i.state === 'pending')).toBe(true);
  });

  it('settles NOTHING when one id in the batch is already terminal, and names it', () => {
    const { s, runId, ids } = seeded();
    s.setWorkItemState(runId, ids[2], 'abandoned', null);
    expect(s.settleItems(runId, [
      { id: ids[0], state: 'done', claimedBy: null },
      { id: ids[2], state: 'done', claimedBy: null },
    ])).toEqual({ ok: false, itemId: ids[2], why: 'terminal', state: 'abandoned' });
    expect(s.itemTally(runId)).toEqual({ done: 0, total: 3 });
    expect(s.workItems(runId).map((i) => i.state)).toEqual(['pending', 'pending', 'abandoned']);
  });

  it('refuses a body naming the SAME id twice when the first settle is terminal, and writes nothing', () => {
    // The pre-pass carries the batch's OWN effect forward: the second write
    // lands on a now-terminal row and earns the refusal the `WHERE` clause
    // would have given it — reached BEFORE the first write instead of after.
    const { s, runId, ids } = seeded();
    expect(s.settleItems(runId, [
      { id: ids[0], state: 'done', claimedBy: null },
      { id: ids[0], state: 'failed', claimedBy: null },
    ])).toEqual({ ok: false, itemId: ids[0], why: 'terminal', state: 'done' });
    expect(s.itemTally(runId)).toEqual({ done: 0, total: 3 });
    expect(s.workItems(runId).every((i) => i.state === 'pending')).toBe(true);
  });

  it('allows the same id twice when the first target is NOT terminal (pending -> claimed -> done)', () => {
    const { s, runId, ids } = seeded();
    expect(s.settleItems(runId, [
      { id: ids[0], state: 'claimed', claimedBy: 'ccrc-pwa-quiet-mesa' },
      { id: ids[0], state: 'done', claimedBy: 'ccrc-pwa-quiet-mesa' },
    ])).toEqual({ ok: true, items: { done: 1, total: 3 } });
    expect(s.workItems(runId)[0]).toMatchObject({ state: 'done', claimedBy: 'ccrc-pwa-quiet-mesa' });
  });

  it('scopes every id to the run: another run\'s item is unknown-item, and that run is untouched', () => {
    const { s, runId, ids } = seeded();
    const theirs = openRun(s, { wave: 2 }) as { id: number };
    const other = s.addWorkItem(theirs.id, 'not yours', []);
    expect(s.settleItems(runId, [
      { id: ids[0], state: 'done', claimedBy: null },
      { id: other.id, state: 'done', claimedBy: null },
    ])).toEqual({ ok: false, itemId: other.id, why: 'unknown-item' });
    expect(s.itemTally(runId)).toEqual({ done: 0, total: 3 });
    expect(s.itemTally(theirs.id)).toEqual({ done: 0, total: 1 });
    expect(s.workItems(theirs.id)[0]).toMatchObject({ state: 'pending' });
  });

  it('rolls the whole batch back if a write throws inside the transaction', () => {
    // The pre-pass is a PRECHECK, not a second guard: if it and the `WHERE`
    // ever disagreed, the write loop throws rather than half-writing, and
    // `tx` rolls the batch back.
    const { s, runId, ids } = seeded();
    const real = s.setWorkItemState.bind(s);
    let n = 0;
    s.setWorkItemState = (rid, id, state, claimedBy) => {
      if (++n === 2) throw new Error('disk full mid-batch');
      return real(rid, id, state, claimedBy);
    };
    try {
      expect(() => s.settleItems(runId, [
        { id: ids[0], state: 'done', claimedBy: null },
        { id: ids[1], state: 'done', claimedBy: null },
      ])).toThrow('disk full mid-batch');
    } finally {
      s.setWorkItemState = real;
    }
    expect(s.itemTally(runId)).toEqual({ done: 0, total: 3 });
    expect(s.workItems(runId).every((i) => i.state === 'pending')).toBe(true);
  });
});

describe('CoordStore: programs', () => {
  it('reads a programs.state token this build does not know as `unknown`, never as a raw string (found in a later Task 3 review, D-27)', () => {
    // `programs()`'s OWN `isProgramState` guard (store.ts, formerly :179) was
    // pinned nowhere — D-8's closing note (plan:88) and schema.ts's header
    // both say the gap is shut on the strength of the guard existing, but a
    // green suite that cannot tell the guard from `r.state as ProgramState`
    // is not the mechanism that record claims (shared/api.ts:1331: "a
    // comment is a request and a red suite is a mechanism").
    const s = store();
    openRun(s);
    s.db.prepare('UPDATE programs SET state = ? WHERE slug = ?').run('archived', 'build4');
    expect(s.programs()).toEqual([{ slug: 'build4', title: 'Transcript surface', state: 'unknown' }]);
  });

  it('writes programs.state through a real setter, and unwedges resolveCoordinator once a finished program is retired (found in a later Task 3 review, D-26)', () => {
    // Before this fix `programs.state` had no writer beyond `openRun`'s
    // hardcoded 'active' at first open — so once a SECOND program opened,
    // `resolveCoordinator(null)` (the shipped ingress's `toId:'coordinator'`
    // resolution) died permanently: two 'active' rows is `ambiguous`, and
    // nothing in the build could ever move the first one out of `active`,
    // even after every one of its runs was done. This is the failure
    // scenario, demonstrated at the store level, and its fix.
    const s = store();
    s.openRun({ program: 'p1', title: 'Program one', project: 'ccrc-pwa',
                wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordA' });
    expect(s.resolveCoordinator(null)).toBe('ccrc-pwa-coordA');

    s.openRun({ program: 'p2', title: 'Program two', project: 'ccrc-pwa',
                wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordB' });
    expect(s.resolveCoordinator(null)).toBeNull();          // two active programs: ambiguous

    s.setProgramState('p1', 'done');
    expect(s.programs()).toContainEqual({ slug: 'p1', title: 'Program one', state: 'done' });
    expect(s.resolveCoordinator(null)).toBe('ccrc-pwa-coordB');   // unwedged: p2 is the sole active program
  });

  it('resolves \'coordinator\' to the NAMED RUN\'s own claim when a runId is given (fix-round finding 6) — zero coverage anywhere in the tree before this', () => {
    // Every prior test of `resolveCoordinator` called it with `null` only
    // (`coord-store.test.ts:195/199/203`, above) — the `runId !== null` arm
    // ("the run's own claim", `store.ts`'s own docstring) had no test
    // anywhere, and `routes.ts:185`'s `toId === 'coordinator' ?
    // coord.resolveCoordinator(runId) : toId` is the only caller outside this
    // file. Two programs, each claimed by a DIFFERENT session, so a mutant
    // that ignored `runId` and fell through to the ambiguous `null` path (or
    // that returned the wrong program's claim) is distinguishable.
    const s = store();
    const a = s.openRun({ program: 'pA', title: 'A', project: 'ccrc-pwa',
      wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordA' }) as { id: number };
    const b = s.openRun({ program: 'pB', title: 'B', project: 'ccrc-pwa',
      wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordB' }) as { id: number };
    expect(s.resolveCoordinator(a.id)).toBe('ccrc-pwa-coordA');
    expect(s.resolveCoordinator(b.id)).toBe('ccrc-pwa-coordB');
    expect(s.resolveCoordinator(4242)).toBeNull();   // no such run — absent, not ambiguous
  });

  it('setDeliveryEnvelope overwrites a delivery\'s stored envelope in place, without touching mailId/toId/state', () => {
    // The second half of the mail-id/delivery-id fix (fix-round finding 5 /
    // D-41): the ingress route inserts a delivery with a placeholder
    // envelope, THEN calls this once it can name the delivery's own id.
    const s = store();
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '');
    s.setDeliveryEnvelope(d.id, `<mail>id ${d.id}</mail>`);
    const [row] = s.dueDeliveries(Date.now(), 60_000);
    expect(row).toMatchObject({ id: d.id, mailId: mail.id, envelope: `<mail>id ${d.id}</mail>` });
    expect(s.delivery(d.id)).toMatchObject({ toId: 'ccrc-pwa-quiet-mesa', state: 'queued' });
  });
});

describe('the disaster-recovery path (spec:82-85)', () => {
  it('reconstructs a representative program from the ledger, the registry and .prhistory', () => {
    // The DATABASE IS THE ONE THING NOT AVAILABLE. This drill proves the three
    // surviving artefacts carry enough: the ledger names the program and its
    // waves, the registry names the workspace/branch/hold, and .prhistory names
    // the PR lineage. It asserts the REBUILT run rows, so a future column that
    // cannot be reconstructed fails here and has to justify itself.
    //
    // The wave/state/handoffCommit triple below is NOT the whole contract:
    // `reconstruct`'s own docstring names further judgment calls this test
    // must also pin, or nothing stops them silently regressing (found in
    // Task 3 review, finding 5) — binding sessionId/workspace/branch to
    // null, or leaving `dispatchedAt` unbound for the `working` wave, both
    // used to pass every assertion that used to be here.
    const s = store();
    const before = Date.now();
    const rebuilt = s.reconstruct({
      ledger: {
        slug: 'build4', title: 'Transcript surface',
        waves: [{ wave: 1, of: 5, handoffCommit: 'a'.repeat(40) }, { wave: 2, of: 5, handoffCommit: null }],
      },
      registry: { sessionId: 'ccrc-pwa-quiet-mesa', project: 'ccrc-pwa',
                  workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
                  held: 'program:build4 wave:2/5' },
      prHistory: [{ pr: 31, branch: 'ws/quiet-mesa', phase: 'merged', recordedAt: 1 }],
    });
    const after = Date.now();
    expect(rebuilt.map((r) => [r.wave, r.state, r.handoffCommit])).toEqual([
      [1, 'done', 'a'.repeat(40)],
      [2, 'working', null],
    ]);
    // Judgment call 1 (registry-derived triple): shared by EVERY wave.
    for (const r of rebuilt) {
      expect(r.sessionId).toBe('ccrc-pwa-quiet-mesa');
      expect(r.workspace).toBe('quiet-mesa');
      expect(r.branch).toBe('ws/quiet-mesa');
      expect(r.resumed).toBe(false);
      expect(r.openedAt).toBeGreaterThanOrEqual(before);
      expect(r.openedAt).toBeLessThanOrEqual(after);
    }
    // Judgment call 3 (fix, found in Task 3 review): `dispatchedAt` is bound
    // ONLY for the wave that actually holds a live session — otherwise a
    // rebuilt live run is invisible to `capsUsage().running` no matter its
    // state (see the dedicated test below).
    expect(rebuilt[0]!.dispatchedAt).toBeNull();
    expect(rebuilt[1]!.dispatchedAt).toBe(rebuilt[1]!.openedAt);

    // Judgment call 2 (.prhistory folds onto the last DONE wave only).
    expect(s.run(rebuilt[1]!.id)!.prLineage).toEqual([]);       // wave 2 has retired no PR yet
    expect(s.run(rebuilt[0]!.id)!.prLineage).toEqual([
      { pr: 31, branch: 'ws/quiet-mesa', phase: 'merged', recordedAt: 1 },
    ]);
  });

  it('marks the last wave `failed`, not `working`, when the workspace is no longer held — plan Step-4 rule 2 (D-11)', () => {
    // reconstruct review: the shipped code derived state purely from
    // `handoffCommit !== null`, never reading `registry.held` at all — so this
    // test would have passed with `held: null` byte-identically to the test
    // above passing with a hold, before the fix. That was the whole gap: the
    // rule the plan pins is exactly "a held workspace with no handoff commit
    // is working" — silence on the unheld case was read as "still working"
    // instead of "nothing backs this any more".
    const s = store();
    const rebuilt = s.reconstruct({
      ledger: {
        slug: 'build5', title: 'Another program',
        waves: [{ wave: 1, of: 2, handoffCommit: 'b'.repeat(40) }, { wave: 2, of: 2, handoffCommit: null }],
      },
      registry: { sessionId: 'ccrc-pwa-still-fen', project: 'ccrc-pwa',
                  workspace: 'still-fen', branch: 'ws/still-fen', held: null },
      prHistory: [],
    });
    expect(rebuilt.map((r) => [r.wave, r.state])).toEqual([[1, 'done'], [2, 'failed']]);
  });

  it('stays claimable exactly once after a reconstruction — a rebuilt program\'s NULL claimedBy must not disarm the guard (D-12)', () => {
    // openRun review: `reconstruct` inserts every rebuilt run with
    // `claimedBy = NULL` (it cannot know who will resume the program), and
    // the ORIGINAL guard query read the absolute first run row regardless of
    // whether it was ever claimed — so after a rebuild the lowest-id row's
    // NULL disarmed the one-coordinator refusal for good. Two coordinators
    // could then both "successfully" open the same program.
    const s = store();
    s.reconstruct({
      ledger: { slug: 'build6', title: 'Recovered', waves: [{ wave: 1, of: 1, handoffCommit: null }] },
      registry: { sessionId: 'ccrc-pwa-quiet-mesa', project: 'ccrc-pwa',
                  workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
                  held: 'program:build6 wave:1/1' },
      prHistory: [],
    });
    const a = s.openRun({ program: 'build6', title: 'Recovered', project: 'ccrc-pwa',
                          wave: 2, waveOf: 1, claimedBy: 'ccrc-pwa-coordinator' });
    expect(a).toMatchObject({ program: 'build6' });
    expect(s.openRun({ program: 'build6', title: 'Recovered', project: 'ccrc-pwa',
                       wave: 3, waveOf: 1, claimedBy: 'ccrc-pwa-other' }))
      .toMatchObject({ refused: 'claimed-by-another', by: 'ccrc-pwa-coordinator' });
  });

  it('counts a rebuilt `working` run against the cap — a reconstructed live session must not be invisible to capsUsage (found in Task 3 review)', () => {
    // reconstruct review: `dispatchedAt` was never bound on ANY rebuilt run,
    // so `capsUsage().running`'s `dispatchedAt IS NOT NULL` predicate (D-13)
    // could not count this wave no matter its state — after a disaster
    // rebuild, a coordinator resuming this program would see `running: 0`
    // against a live session and be free to dispatch a full
    // `maxConcurrentWorkers` on top of it.
    const s = store();
    s.reconstruct({
      ledger: { slug: 'build7', title: 'Recovered live wave', waves: [{ wave: 1, of: 1, handoffCommit: null }] },
      registry: { sessionId: 'ccrc-pwa-quiet-mesa', project: 'ccrc-pwa',
                  workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
                  held: 'program:build7 wave:1/1' },
      prHistory: [],
    });
    expect(s.capsUsage().running).toBe(1);
  });

  it('does NOT count a rebuilt `failed` (unheld) run against the cap — no live session backs it', () => {
    const s = store();
    s.reconstruct({
      ledger: { slug: 'build8', title: 'Recovered, unheld', waves: [{ wave: 1, of: 1, handoffCommit: null }] },
      registry: { sessionId: 'ccrc-pwa-still-fen', project: 'ccrc-pwa',
                  workspace: 'still-fen', branch: 'ws/still-fen', held: null },
      prHistory: [],
    });
    expect(s.capsUsage().running).toBe(0);
  });
});

describe('CoordStore: mail delivery replay (spec:174-180)', () => {
  it('reads a mail_deliveries.state token this build does not know as `unknown`, never as a raw string (found in a later Task 3 review, D-27)', () => {
    // `delivery()`'s OWN `isMailDeliveryState` guard (store.ts, formerly
    // :332) was pinned nowhere: mail-routes.test.ts's one assertion on this
    // method reads a genuinely-'queued' row, which `row.state as
    // MailDeliveryState` would return identically — not discriminating.
    const s = store();
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');
    s.db.prepare('UPDATE mail_deliveries SET state = ? WHERE id = ?').run('archiving', d.id);
    expect(s.delivery(d.id)).toMatchObject({ state: 'unknown' });
  });

  it('dueDeliveries: queued is due at nextAttemptAt; delivered replays after replayMs; acked never returns (D-10)', () => {
    // dueDeliveries review: the shipped WHERE clause matched only
    // `state = 'queued'`, so once `markDelivered` moved a row to `delivered`
    // nothing in the file could ever select it again — replay-until-ack
    // (spec:174-177) was structurally impossible, and no test in this file
    // touched a mail method before this fix.
    const s = store();
    const now = 1_000_000_000_000;
    const replayMs = 600_000;
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');

    expect(s.dueDeliveries(now, replayMs).map((x) => x.id)).toEqual([d.id]);

    s.markDelivered(d.id, now);
    expect(s.dueDeliveries(now, replayMs)).toEqual([]);                        // just delivered
    expect(s.dueDeliveries(now + replayMs - 1, replayMs)).toEqual([]);         // inside the window
    expect(s.dueDeliveries(now + replayMs, replayMs).map((x) => x.id)).toEqual([d.id]); // due again

    // The UserPromptSubmit edge re-dates the clock from ingestedAt, not
    // deliveredAt (spec:178-180).
    s.markIngested(d.id, now + 100);
    expect(s.dueDeliveries(now + replayMs, replayMs)).toEqual([]);
    expect(s.dueDeliveries(now + 100 + replayMs, replayMs).map((x) => x.id)).toEqual([d.id]);

    s.markAcked(d.id, now + 100 + replayMs);
    expect(s.dueDeliveries(now + 100 + replayMs, replayMs)).toEqual([]);       // acked is never due
  });

  it('dueDeliveries: a REPLAY\'s own markDelivered advances the due-clock past a stale ingestedAt — MAX, not COALESCE (review findings 2/6)', () => {
    // The pre-fix bug: the replay arm read COALESCE(ingestedAt, deliveredAt),
    // so once `markIngested` had EVER written a value, that value was picked
    // forever and a later successful REPLAY's own fresh `markDelivered` call
    // — which never touches `ingestedAt` — was silently ignored. The clock
    // froze at the first ingested edge, and every replay after that one was
    // due again almost immediately, spaced only by the caller's
    // MAIL_COOLDOWN_MS instead of the intended `replayMs`.
    const s = store();
    const now = 1_000_000_000_000;
    const replayMs = 600_000;
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');

    s.markDelivered(d.id, now);                    // first delivery: deliveredAt = now
    s.markIngested(d.id, now + 599_000);            // the UserPromptSubmit edge, well inside the window

    // The row replays successfully later (a FRESH markDelivered call):
    const replayAt = now + replayMs + 1_000;
    s.markDelivered(d.id, replayAt);                // deliveredAt advances; ingestedAt is untouched

    // Under the old COALESCE, the clock would still read the STALE ingestedAt
    // (now + 599_000), so `now + 599_000 + replayMs` — already in the past
    // relative to `replayAt` — would make the row due again immediately.
    expect(s.dueDeliveries(replayAt, replayMs)).toEqual([]);                        // just replayed
    expect(s.dueDeliveries(replayAt + replayMs - 1, replayMs)).toEqual([]);         // inside the window
    expect(s.dueDeliveries(replayAt + replayMs, replayMs).map((x) => x.id)).toEqual([d.id]); // due, from the REPLAY
  });

  it('deliveredUnacked: every delivered row regardless of replay timing, and none once acked or still queued (review finding 3)', () => {
    const s = store();
    const now = 1_000_000_000_000;
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>still queued</mail>');
    const delivered = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>delivered</mail>');
    s.markDelivered(delivered.id, now);
    const acked = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>acked</mail>');
    s.markDelivered(acked.id, now);
    s.markAcked(acked.id, now + 1);

    // A `delivered` row appears here EVEN THOUGH it is nowhere near due for
    // replay yet — the whole point (review finding 3): the caller must be
    // able to sample the ingestion edge long before `dueDeliveries` would
    // ever select the row.
    expect(s.deliveredUnacked().map((x) => x.id)).toEqual([delivered.id]);
  });

  it('backs off a replay the same way it backs off a first attempt — the replay arm gates on nextAttemptAt too (found in Task 3 review)', () => {
    // dueDeliveries review: the replay arm (`state = 'delivered' AND
    // COALESCE(ingestedAt, deliveredAt) + replayMs <= now`) never read
    // `nextAttemptAt`, so a `backOff` call on an already-delivered row was
    // written and then never read — the row was re-selected on the very next
    // sweep regardless of the spacing `backOff` had just written. This is
    // the negative case: a delivery that is due for replay, fails to inject
    // (e.g. `draft-present`), backs off, and must not be due again until its
    // new `nextAttemptAt`.
    const s = store();
    const now = 1_000_000_000_000;
    const replayMs = 600_000;
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');
    s.markDelivered(d.id, now);

    const dueAt = now + replayMs;
    expect(s.dueDeliveries(dueAt, replayMs).map((x) => x.id)).toEqual([d.id]);  // due for replay

    s.backOff(d.id, 'draft-present', dueAt + 30_000);
    expect(s.dueDeliveries(dueAt + 1_000, replayMs)).toEqual([]);               // backed off: not due
    expect(s.dueDeliveries(dueAt + 30_000, replayMs).map((x) => x.id)).toEqual([d.id]); // due again
  });

  // Registry ladder (architecture doc, increment 1's second half): `backOff`'s
  // fourth argument. `attempts` is SEND-FAILURE budget — `sweepMail`'s own
  // "recipient found but unmeasurable" branch never even reaches a send
  // attempt, so it must not ratchet toward the SAME park ceiling a genuine
  // failure does. Every EXISTING caller (the test right above this one, and
  // `watch.ts`'s own two ordinary-failure call sites) omits the argument and
  // must see the OLD, unchanged behaviour — that is what the first case below
  // pins; the second is the new one.
  it('backOff bumps attempts by default (countsAsAttempt omitted) but NOT when countsAsAttempt is false', () => {
    const s = store();
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: null, kind: 'status', subject: 'wave-brief', body: 'go', artifacts: [] });
    const a = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');
    s.backOff(a.id, 'recipient not in registry', 1_000);
    expect(s.dueDeliveries(1_000, 600_000).find((d) => d.id === a.id)?.attempts).toBe(1);

    const b = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');
    s.backOff(b.id, 'registry row listed but unreadable (registry-unmeasurable)', 1_000, false);
    expect(s.dueDeliveries(1_000, 600_000).find((d) => d.id === b.id)?.attempts).toBe(0);

    // Both still write lastError/nextAttemptAt regardless of the flag — only
    // the counter is gated.
    const row = (id: number) => s.db.prepare('SELECT lastError, nextAttemptAt FROM mail_deliveries WHERE id = ?')
      .get(id) as { lastError: string; nextAttemptAt: number };
    expect(row(a.id)).toEqual({ lastError: 'recipient not in registry', nextAttemptAt: 1_000 });
    expect(row(b.id)).toEqual({ lastError: 'registry row listed but unreadable (registry-unmeasurable)', nextAttemptAt: 1_000 });
  });

  it('markDelivered/rejectDelivery refuse to reopen an already-parked row — a send in flight when a ' +
     'close commits the park must not un-park it (scoped-verify R1)', () => {
    // The interleaving the verifier reproduced: `sweepMail` reads a row
    // (state='queued'), starts `await sendPrompt(...)`, and — before that
    // resolves — `POST /api/runs/:id/close` commits in a SEPARATE request,
    // parking this run's own outstanding mail via `cancelOutstandingDeliveries`
    // (the same write `closeRun`'s own transaction performs). The in-flight
    // send then resolves `ok`, and the sweep's own `markDelivered` call lands
    // AFTER the park. Before this fix, `markDelivered`'s guard was only
    // `state != 'acked'`, so it overwrote the park unconditionally, leaving
    // the row self-contradictory (`state='delivered'`, `rejectCode`
    // non-null) and — via `dueDeliveries`'s replay arm — eligible to replay
    // wave N's mail into wave N+1's freshly `/clear`-ed context, exactly the
    // harm `cancelOutstandingDeliveries` exists to prevent.
    const s = store();
    const now = 1_000_000_000_000;
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');

    // The close commits first — the same write `cancelOutstandingDeliveries`
    // performs from inside `closeRun`'s own transaction.
    s.cancelOutstandingDeliveries(r.id);
    const rowAfterClose = () => s.db.prepare(
      'SELECT state, rejectCode, lastError FROM mail_deliveries WHERE id = ?',
    ).get(d.id) as { state: string; rejectCode: string | null; lastError: string | null };
    expect(rowAfterClose()).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', lastError: 'run closed' });

    // The in-flight send now resolves `ok` and the sweep calls markDelivered
    // — the park must survive it, byte for byte.
    s.markDelivered(d.id, now);
    expect(rowAfterClose()).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', lastError: 'run closed' });
    // Never re-enters the replay arm — `dueDeliveries` must not select it no
    // matter how far the clock advances.
    expect(s.dueDeliveries(now + 10_000_000, 1).map((x) => x.id)).not.toContain(d.id);

    // Symmetric guard on rejectDelivery: a SECOND, later park racing the same
    // row (e.g. sweepMail's own replay-ceiling or reaped-recipient park,
    // resolving after this one already landed) must not clobber the FIRST
    // park's own recorded reason either.
    s.rejectDelivery(d.id, 'undeliverable', 'replayed without ack past the replay ceiling');
    expect(rowAfterClose()).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', lastError: 'run closed' });
  });

  it('backOff refuses to clobber an already-parked row\'s recorded reason — a send failure resolving ' +
     'after a close-time park must not overwrite it (scoped-verify H1)', () => {
    // The sibling gap to the R1 test above: `backOff` is the SWEEP's own
    // send-failure path, on the identical delayed timeline `markDelivered`
    // races against — before this fix it carried no guard at all
    // (`WHERE id = ?`), so a `sendPrompt` in flight when a close's own
    // `cancelOutstandingDeliveries` parked the row could still resolve
    // `error` afterwards and bump `attempts`/overwrite `lastError` on a row
    // already terminally `rejected`. `state`/`rejectCode` never move (only
    // `rejectDelivery` writes them), so the harm is a wrong `lastError` on a
    // closed row, not a resurrected replay — guarded anyway, for the same
    // reason every other writer of this column now is.
    const s = store();
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');

    s.cancelOutstandingDeliveries(r.id);   // the close-time park, as in R1
    const row = () => s.db.prepare(
      'SELECT state, rejectCode, lastError, attempts FROM mail_deliveries WHERE id = ?',
    ).get(d.id) as { state: string; rejectCode: string | null; lastError: string | null; attempts: number };
    expect(row()).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', lastError: 'run closed', attempts: 0 });

    // The in-flight send now resolves an ERROR and the sweep calls backOff —
    // the park's own reason and attempt count must survive it, byte for byte.
    s.backOff(d.id, 'verify-failed', Date.now() + 30_000);
    expect(row()).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', lastError: 'run closed', attempts: 0 });
  });

  it('markAcked refuses to reopen an already-parked row — a late ack racing a close-time park must not ' +
     'flip it back to acked (scoped-verify H2)', () => {
    // `markAcked` read-before-wrote only `state === 'acked'`, so an ack
    // landing after `cancelOutstandingDeliveries` (or a replay-ceiling/
    // reaped-recipient park) already committed flipped the row to
    // `{state:'acked', rejectCode:'undeliverable'}` — self-contradictory,
    // and the exact case `markDelivered`'s own docstring already claimed
    // this method covered ("`acked` and `rejected` are this build's only two
    // states a concurrent writer must never reopen... `markAcked` itself
    // already reads-before-writing for the identical reason") before this
    // fix made that claim true.
    const s = store();
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');

    s.cancelOutstandingDeliveries(r.id);   // the close-time park
    const row = () => s.db.prepare(
      'SELECT state, rejectCode, ackedAt FROM mail_deliveries WHERE id = ?',
    ).get(d.id) as { state: string; rejectCode: string | null; ackedAt: number | null };
    expect(row()).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', ackedAt: null });

    // The late ack lands after the park — `markAcked` must refuse it and say
    // so honestly (`landed === false`, the same signal a double-ack gives).
    const landed = s.markAcked(d.id, Date.now());
    expect(landed).toBe(false);
    expect(row()).toMatchObject({ state: 'rejected', rejectCode: 'undeliverable', ackedAt: null });
  });

  // Orchestrator ruling I2, part (b): the ONE named exception to the H2 guard
  // just above. Unlike a LATE ack racing a park (nothing racing here — the
  // park is long since committed and the caller is asking, explicitly, to
  // ack an abandoned message), this is the recipient finally seeing it —
  // exactly what "acked" means — and the row it leaves behind still carries
  // its park history in `lastError`, an honest record of both things that
  // happened to it.
  it('markAcked accepts an EXPLICIT ack of the replay-ceiling park specifically — the one abandoned row a recipient can finally clear (I2(b))', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');
    s.rejectDelivery(d.id, 'undeliverable', 'replayed without ack past the replay ceiling');

    const at = Date.now();
    const landed = s.markAcked(d.id, at);
    expect(landed).toBe(true);
    // The park history survives IN the now-acked row (I2(b)'s own text: "the
    // resulting row … is the honest record") — `lastError` is untouched,
    // only `state`/`ackedAt` move.
    expect(s.db.prepare('SELECT state, rejectCode, lastError, ackedAt FROM mail_deliveries WHERE id = ?')
      .get(d.id)).toEqual({ state: 'acked', rejectCode: 'undeliverable',
        lastError: 'replayed without ack past the replay ceiling', ackedAt: at });

    // Idempotent the same way an ordinary ack is: a second call answers
    // `false` (already acked), never re-applies.
    expect(s.markAcked(d.id, at + 1)).toBe(false);
  });

  // The exception is NARROW — exact match on BOTH `rejectCode` AND
  // `lastError`, never a bare `state === 'rejected'` widened to admit every
  // park (the mutant the ruling names explicitly: "widen the markAcked
  // exception to ALL rejected rows"). A DIFFERENT `rejectCode:'undeliverable'`
  // park (the never-delivered `MAIL_MAX_ATTEMPTS` ceiling, or the
  // `enter-ignored` terminal park — both `watch.ts` writes with this same
  // code but a different `lastError`) must stay refused exactly like the
  // `'run closed'` case the H2 test above already pins.
  it('markAcked still refuses a DIFFERENT rejectCode:\'undeliverable\' park — only the exact replay-ceiling lastError qualifies', () => {
    const s = store();
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: null, kind: 'status', subject: 'wave-brief', body: 'go', artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');
    s.rejectDelivery(d.id, 'undeliverable', 'enter-ignored');   // same code, different reason

    expect(s.markAcked(d.id, Date.now())).toBe(false);
    expect(s.db.prepare('SELECT state, ackedAt FROM mail_deliveries WHERE id = ?').get(d.id))
      .toEqual({ state: 'rejected', ackedAt: null });
  });
});

describe('CoordStore: feed (Task 10)', () => {
  // Review finding 2. `feed_events.kind` was cast straight into
  // `NotifyEvent['kind']` on the theory that this server only ever writes a
  // value it already typed — false the moment a rollback (deploy.sh's
  // per-timestamp backups) puts an OLDER server behind a store a NEWER build
  // already wrote a seventh kind into. Same pattern as `run()`'s own
  // `reads a state token this build does not know` test above: land the
  // out-of-vocabulary token with a raw statement `recordFeedEvent`'s typed
  // signature would never let a caller pass, then read it back.
  it('reads a kind token this build does not know as `unknown`, never as a raw string', () => {
    const s = store();
    s.recordFeedEvent('epoch-1', { seq: 1, at: 1000, kind: 'done', sessionId: 'cc-a', title: 't', body: 'b' });
    s.db.prepare('UPDATE feed_events SET kind = ? WHERE seq = ?').run('review', 1);
    expect(s.feedEvents(10).map((e) => e.kind)).toEqual(['unknown']);
  });

  it('still reads every KNOWN kind through the same guard, unchanged', () => {
    const s = store();
    for (const kind of ['ask', 'done', 'merged', 'mail', 'run'] as const) {
      s.recordFeedEvent('epoch-1', { seq: 1, at: 1000, kind, sessionId: 'cc-a', title: 't', body: 'b' });
    }
    expect(s.feedEvents(10).map((e) => e.kind)).toEqual(['ask', 'done', 'merged', 'mail', 'run']);
  });
});

// Fix round 1, findings 2/4: `mailForRecipient`'s LIMIT used to be applied
// over ALL deliveries (any state), and the `queued`/`delivered` filter ran
// AFTER — in `sessionws.ts`'s `checkMail`, outside the store entirely. An
// outstanding delivery older than the newest N deliveries to that recipient
// therefore fell out of the window and vanished, even though it was still
// genuinely queued. `outstandingMailFor` puts the state predicate IN the
// WHERE clause, so `limit` bounds outstanding rows, never history.
describe('CoordStore: outstanding mail (fix round 1, findings 2/4)', () => {
  const FROM_ID = 'coordinator';
  const FROM_UUID = 'c'.repeat(36);
  const queue = (s: CoordStore, toId: string, subject: string): number => {
    const mail = s.insertMail({ fromId: FROM_ID, fromUuid: FROM_UUID, toId, runId: null,
      kind: 'question', subject, body: 'body', artifacts: [] });
    return s.queueDelivery(mail.id, toId, 'envelope').id;
  };

  it('a LIMIT of N still surfaces an outstanding delivery older than N newer, acked ones', () => {
    const s = store();
    const toId = 'ccrc-pwa-clear-cove';
    // The oldest delivery (smallest id) is the one that stays outstanding.
    const staleId = queue(s, toId, 'still outstanding');
    // Three newer deliveries, all acked — under the OLD "limit-then-filter"
    // shape, a `limit` of 3 would return exactly these three (newest-first)
    // and the filter would have nothing outstanding left to keep.
    for (let i = 0; i < 3; i++) {
      const id = queue(s, toId, `acked #${i}`);
      s.markDelivered(id, Date.now());
      s.markAcked(id, Date.now());
    }
    const outstanding = s.outstandingMailFor(toId, 3);
    expect(outstanding.map((m) => m.id)).toEqual([staleId]);
    expect(outstanding[0]!.subject).toBe('still outstanding');
    expect(outstanding[0]!.state).toBe('queued');
  });

  // MAIL_ROW_COLUMNS (store.ts) had two literal columns with zero coverage
  // anywhere in server/test: `m.at AS at` and `m.runId AS runId` — mutating
  // either to a constant (`0 AS at` / `NULL AS runId`) left the full suite
  // green. `at` is not cosmetic: pwa/src/session/MailStrip.tsx:47 picks the
  // strip's headline with `[...mail].sort((a,b) => b.at - a.at)[0]`, so a
  // broken `at` column silently shows an arbitrary subject. `runId` is read
  // straight off `MailSummary` on the `mail` WS frame (shared/api.ts) with
  // no consumer today, but the row is addressed BY a runId
  // (`insertMail({..., runId: r.id})`) and must read back the one that was
  // actually written, not `null`, through both read paths that share
  // `hydrateMail`.
  it('reads `at` and `runId` back off the row exactly as written, through both mailForRecipient and outstandingMailFor', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    const toId = 'ccrc-pwa-clear-cove';
    const before = Date.now();
    const mail = s.insertMail({ fromId: FROM_ID, fromUuid: FROM_UUID, toId, runId: r.id,
      kind: 'question', subject: 'attributed to a run', body: 'body', artifacts: [] });
    const after = Date.now();
    s.queueDelivery(mail.id, toId, 'envelope');

    for (const rows of [s.outstandingMailFor(toId), s.mailForRecipient(toId)]) {
      expect(rows).toHaveLength(1);
      expect(rows[0]!.runId).toBe(r.id);
      expect(rows[0]!.at).toBeGreaterThanOrEqual(before);
      expect(rows[0]!.at).toBeLessThanOrEqual(after);
    }
  });

  it('excludes acked mail and a run-closed cancellation, includes queued/delivered and an abandoned park (review finding 2)', () => {
    const s = store();
    const toId = 'ccrc-pwa-clear-cove';
    const queuedId = queue(s, toId, 'queued');
    const deliveredId = queue(s, toId, 'delivered');
    s.markDelivered(deliveredId, Date.now());
    const ackedId = queue(s, toId, 'acked');
    s.markDelivered(ackedId, Date.now());
    s.markAcked(ackedId, Date.now());
    // A genuine abandonment — the lane gave up (a replay-ceiling park, or any
    // other `rejectDelivery` the delivery lane itself performs) before anyone
    // ever acted on the message. Fix, review finding 2: this must STAY
    // outstanding — never acked, never acted on — distinguishable by its own
    // `state:'rejected'`, not simply invisible.
    const abandonedId = queue(s, toId, 'rejected (abandoned)');
    s.rejectDelivery(abandonedId, 'undeliverable', 'replayed without ack past the replay ceiling');
    // A run-closed cancellation is NOT abandonment — the run itself is done,
    // so the message is moot BY DESIGN (`cancelOutstandingDeliveries`'s own
    // `lastError:'run closed'`). This one stays excluded.
    const runClosedId = queue(s, toId, 'rejected (run closed)');
    s.rejectDelivery(runClosedId, 'undeliverable', 'run closed');

    const ids = s.outstandingMailFor(toId).map((m) => m.id).sort((a, b) => a - b);
    expect(ids).toEqual([queuedId, deliveredId, abandonedId].sort((a, b) => a - b));
    expect(ids).not.toContain(ackedId);
    expect(ids).not.toContain(runClosedId);
  });

  // Orchestrator ruling I2, part (a): before this fix, an abandoned park
  // (the replay ceiling, above) was PERMANENTLY outstanding —
  // `cancelOutstandingDeliveries` only ever matches `queued`/`delivered`
  // rows, so a run's close never touches a delivery already `rejected` for a
  // different reason, and no writer ever revisited it. The fix is a pure
  // read-side derivation (a `LEFT JOIN runs` inside `OUTSTANDING_OR_ABANDONED_SQL`
  // itself) — no park is ever restamped, so the row's own `state`/`lastError`
  // stay exactly what the park wrote, forever.
  it('clears an abandoned park by DERIVATION once its own run reaches a terminal state — never by mutating the row (I2(a))', () => {
    const s = store();
    const toId = 'ccrc-pwa-clear-cove';
    const activeRun = openRun(s) as { id: number };
    const willCloseRun = openRun(s, { wave: 2 }) as { id: number };

    const abandonOn = (runId: number, subject: string): number => {
      const mail = s.insertMail({ fromId: FROM_ID, fromUuid: FROM_UUID, toId, runId,
        kind: 'question', subject, body: 'body', artifacts: [] });
      const deliveryId = s.queueDelivery(mail.id, toId, 'envelope').id;
      s.rejectDelivery(deliveryId, 'undeliverable', 'replayed without ack past the replay ceiling');
      return deliveryId;
    };
    const onActive = abandonOn(activeRun.id, 'abandoned, run still open');
    const onWillClose = abandonOn(willCloseRun.id, 'abandoned, run about to close');

    // Both stay outstanding while both runs are live — the bug this ruling
    // fixes: an abandoned park has no writer that ever revisits it.
    expect(s.outstandingMailFor(toId).map((m) => m.id).sort((a, b) => a - b))
      .toEqual([onActive, onWillClose].sort((a, b) => a - b));

    // `planned` -> `failed` directly (RUN_TRANSITIONS): reaches a terminal
    // state without needing a live dispatch. `cancelOutstandingDeliveries`
    // is not even called by a bare `advance` (only `closeRun` calls it, and
    // only on `queued`/`delivered` rows anyway) — nothing writes this row.
    expect(s.advance(willCloseRun.id, 'failed', 'coordinator')).toMatchObject({ ok: true });

    const idsAfterClose = s.outstandingMailFor(toId).map((m) => m.id);
    expect(idsAfterClose).toContain(onActive);          // its run is still open: stays visible
    expect(idsAfterClose).not.toContain(onWillClose);    // its run is now terminal: cleared

    // Derivation, not mutation — the row itself never moved.
    expect(s.delivery(onWillClose)).toMatchObject({ state: 'rejected' });
    expect(s.db.prepare('SELECT rejectCode, lastError FROM mail_deliveries WHERE id = ?').get(onWillClose))
      .toEqual({ rejectCode: 'undeliverable', lastError: 'replayed without ack past the replay ceiling' });

    // `unreadMailCount` (the run row's own `RunSummary.unreadMail`, read
    // through `run()`) derives off the SAME predicate — the MailStrip/badge
    // count this ruling names must clear too, not just the list read.
    expect(s.run(willCloseRun.id)!.unreadMail).toBe(0);
  });

  // I7 (subsumed by I2(a)'s rewrite, as its own text anticipates): a NULL
  // `lastError` on a `rejected` row is NULL-false against SQLite's bare `!=`,
  // which would silently drop the row out of the whole OR chain instead of
  // counting it as abandoned. No real park ever leaves `lastError` NULL
  // today (every `rejectDelivery` caller passes a reason) — this pins the
  // guard defensively, the same way `hydrateMail`'s `unknown` tests pin
  // guards against tokens no current writer produces either.
  it('a rejected row with a NULL lastError still counts as abandoned — COALESCE, not a bare != (nit I7)', () => {
    const s = store();
    const toId = 'ccrc-pwa-clear-cove';
    const deliveryId = queue(s, toId, 'no lastError ever recorded');
    s.db.prepare("UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'undeliverable' WHERE id = ?")
      .run(deliveryId);
    expect(s.delivery(deliveryId)).toMatchObject({ state: 'rejected' });
    expect(s.outstandingMailFor(toId).map((m) => m.id)).toEqual([deliveryId]);
  });

  it('never crosses recipients — mail addressed to a different session is invisible here', () => {
    const s = store();
    queue(s, 'some-other-session', 'not for you');
    expect(s.outstandingMailFor('ccrc-pwa-clear-cove')).toEqual([]);
  });

  // Task 8 fix round 1, finding 1: `hydrateMail` (the row-shaping helper
  // `outstandingMailFor` and `mailForRecipient` both delegate to, never
  // reimplementing it) degrades a `mail.kind` this build does not recognise
  // to `'unknown'` — the exact same discipline `feedEvents`' own "reads a
  // kind token this build does not know" test pins for the feed, and
  // `delivery()`'s own state-degrade test pins for `mail_deliveries.state`
  // two describes up. Nothing pinned the MAIL side of that same guard.
  it('reads a mail.kind token this build does not know as `unknown`, never as a raw string', () => {
    const s = store();
    const toId = 'ccrc-pwa-clear-cove';
    const mail = s.insertMail({ fromId: FROM_ID, fromUuid: FROM_UUID, toId, runId: null,
      kind: 'question', subject: 'from a newer build', body: 'body', artifacts: [] });
    s.queueDelivery(mail.id, toId, 'envelope');
    s.db.prepare('UPDATE mail SET kind = ? WHERE id = ?').run('escalation', mail.id);
    expect(s.outstandingMailFor(toId).map((m) => m.kind)).toEqual(['unknown']);
  });

  // `hydrateMail`'s SIBLING guard, same file, same helper — `delivery()`'s
  // own state-degrade test (two describes up) pins a completely different
  // read path (`delivery()` reads one row by id, never through
  // `hydrateMail`), so it does not reach this one. A state this build does
  // not recognise cannot be read through `outstandingMailFor` itself — its
  // own WHERE clause (`OUTSTANDING_STATES_SQL`) would just exclude the row —
  // so this goes through `mailForRecipient`, the sibling `hydrateMail`
  // caller with no state filter, which is exactly why the shared helper
  // exists rather than two copies of the guard.
  it('reads a mail_deliveries.state token this build does not know as `unknown` via `mailForRecipient` too, not just `delivery()`', () => {
    const s = store();
    const toId = 'ccrc-pwa-clear-cove';
    const mail = s.insertMail({ fromId: FROM_ID, fromUuid: FROM_UUID, toId, runId: null,
      kind: 'question', subject: 'from a newer build', body: 'body', artifacts: [] });
    const d = s.queueDelivery(mail.id, toId, 'envelope');
    s.db.prepare('UPDATE mail_deliveries SET state = ? WHERE id = ?').run('archiving', d.id);
    expect(s.mailForRecipient(toId).map((m) => m.state)).toEqual(['unknown']);
  });

  // Task 8 fix round 1, finding 1: `clampMailLimit` (shared by
  // `outstandingMailFor` and `mailForRecipient`) had no test at either call
  // site — neither the 100-row default for a non-positive/non-finite ask,
  // nor the 500-row ceiling, nor that the ceiling still keeps the NEWEST
  // rows rather than an arbitrary 500. 510 outstanding rows is the minimum
  // that can discriminate the ceiling from a smaller one.
  it('clamps a non-positive or non-finite limit to the 100 default, and anything above 500 to the 500 ceiling — keeping the newest rows either way', () => {
    const s = store();
    const toId = 'ccrc-pwa-clear-cove';
    const ids: number[] = [];
    for (let i = 0; i < 510; i++) ids.push(queue(s, toId, `m${i}`));

    expect(s.outstandingMailFor(toId, 0)).toHaveLength(100);
    expect(s.outstandingMailFor(toId, -5)).toHaveLength(100);
    expect(s.outstandingMailFor(toId, NaN)).toHaveLength(100);

    const ceiling = s.outstandingMailFor(toId, 10_000);
    expect(ceiling).toHaveLength(500);
    // Newest-first still holds under the ceiling: ids[509]..ids[10], not an
    // arbitrary 500 — a mutant clamping from the wrong end would still pass
    // the length assertions above and fail only here.
    expect(ceiling[0]!.id).toBe(ids[ids.length - 1]);
    expect(ceiling[ceiling.length - 1]!.id).toBe(ids[ids.length - 500]);
  }, 20_000);
});

describe('CoordStore.openRunsForSession', () => {
  it('names every OPEN run on a session, in id order, and is SYNCHRONOUS', () => {
    const s = store();
    const a = openRun(s) as { id: number };
    const b = openRun(s, { wave: 2 }) as { id: number };
    s.setSession(a.id, 'demo-alpha');
    s.setSession(b.id, 'demo-alpha');
    const got = s.openRunsForSession('demo-alpha');
    // Not a promise: the whole point. `await`ing this would be the one move
    // that threatens coord.db's stated synchrony invariant.
    expect(got).toBeInstanceOf(Array);
    expect(got).toEqual([
      { id: a.id, program: 'build4', wave: 1, waveOf: 5 },
      { id: b.id, program: 'build4', wave: 2, waveOf: 5 },
    ]);
  });

  it('honours excludeRunId — the closing run is never its own sibling', () => {
    const s = store();
    const a = openRun(s) as { id: number };
    const b = openRun(s, { wave: 2 }) as { id: number };
    s.setSession(a.id, 'demo-alpha');
    s.setSession(b.id, 'demo-alpha');
    expect(s.openRunsForSession('demo-alpha', a.id).map((r) => r.id)).toEqual([b.id]);
    expect(s.openRunsForSession('demo-alpha', b.id).map((r) => r.id)).toEqual([a.id]);
  });

  it('excludes done and failed, and answers [] for a session no run names', () => {
    const s = store();
    const a = openRun(s) as { id: number };
    s.setSession(a.id, 'demo-alpha');
    expect(s.advance(a.id, 'dispatched', 'coordinator')).toMatchObject({ ok: true });
    expect(s.advance(a.id, 'closing', 'coordinator')).toMatchObject({ ok: true });
    expect(s.advance(a.id, 'done', 'coordinator')).toMatchObject({ ok: true });
    expect(s.openRunsForSession('demo-alpha')).toEqual([]);
    expect(s.openRunsForSession('demo-nobody')).toEqual([]);
  });

  it('does NOT filter on dispatchedAt — the open-time hold belongs to an undispatched run (F9)', () => {
    // `POST /api/runs` places the wave-N+1 hold at OPEN time, before any
    // dispatch. A `dispatchedAt IS NOT NULL` predicate here — D-13's shape,
    // which guards a DIFFERENT problem class (a global, session-less count) —
    // would make that live claim invisible and reintroduce F9.
    const s = store();
    const a = openRun(s, { wave: 2 }) as { id: number };
    s.setSession(a.id, 'demo-alpha');
    expect(s.run(a.id)!.dispatchedAt).toBeNull();
    expect(s.openRunsForSession('demo-alpha').map((r) => r.id)).toEqual([a.id]);
  });
});

describe('releaseIsSafe', () => {
  it('is true only when NOTHING else names the session', () => {
    expect(releaseIsSafe([])).toBe(true);
  });

  it('is false for one sibling and for many — a claim is not a majority vote', () => {
    expect(releaseIsSafe([{ id: 7, program: 'build4', wave: 2, waveOf: 3 }])).toBe(false);
    expect(releaseIsSafe([
      { id: 7, program: 'build4', wave: 2, waveOf: 3 },
      { id: 8, program: 'build4', wave: 3, waveOf: null },
    ])).toBe(false);
  });
});

// TASK 407 — the provenance behind a stranded `/clear`.
//
// `dispatch.ts` types a literal `/clear` into a resumed worker's box and, on
// `enter-ignored`, records `clear-refused:enter-ignored` on the run. That row
// is the ONLY durable proof this system typed those four characters into that
// box and never had them taken. `sendPrompt` will not clear a `/clear`
// without it, because the text alone cannot tell ours from an operator's.
describe('CoordStore: the /clear a dispatch stranded', () => {
  const dispatchedWith = (s: CoordStore, sessionId: string, detail: string | undefined,
                          clearedAt: number | null = null): number => {
    const r = openRun(s, { wave: 2 }) as { id: number };
    const adv = s.dispatchRun({ runId: r.id, sessionId, workspace: '/w/x', branch: 'ws/x',
      resumed: true, clearedAt, items: [], ...(detail !== undefined ? { detail } : {}) });
    expect(adv).toMatchObject({ ok: true });
    return r.id;
  };

  it('reads TRUE for a session whose dispatch recorded an ignored Enter on its /clear', () => {
    const s = store();
    dispatchedWith(s, 'demo-quiet-mesa', 'clear-refused:enter-ignored');
    expect(s.strandedClear('demo-quiet-mesa')).toBe(true);
  });

  it('reads FALSE for a session with no such record — the default, not a fallback', () => {
    const s = store();
    dispatchedWith(s, 'demo-quiet-mesa', undefined, 1_800_000_000_000);
    expect(s.strandedClear('demo-quiet-mesa')).toBe(false);
  });

  it('is scoped to the SESSION the /clear was typed into', () => {
    const s = store();
    dispatchedWith(s, 'demo-quiet-mesa', 'clear-refused:enter-ignored');
    expect(s.strandedClear('demo-other-mesa')).toBe(false);
  });

  // THE RULING, pinned. Only `enter-ignored` proves the text is SITTING there:
  // the server watched it echo into the box and watched two Enters fail to
  // move it. `verify-failed` — which since Build 8 also leaves the text in the
  // box — proves the opposite about the evidence: the box never showed our
  // text on any poll, so what is in it now is exactly the thing this gate must
  // not guess at. Refuse.
  it('reads FALSE for any other refusal code, verify-failed included', () => {
    const s = store();
    dispatchedWith(s, 'demo-quiet-mesa', 'clear-refused:verify-failed');
    dispatchedWith(s, 'demo-two', 'clear-refused:draft-present');
    dispatchedWith(s, 'demo-three', 'clear-refused:dialog-open');
    expect(s.strandedClear('demo-quiet-mesa')).toBe(false);
    expect(s.strandedClear('demo-two')).toBe(false);
    expect(s.strandedClear('demo-three')).toBe(false);
  });

  // ONE of the two things that expire the permission (the other is below): a
  // run that has reached a terminal state is no longer waiting on a brief, and
  // a durable row that grants a C-u forever is a standing licence to clear a
  // box nobody is looking at any more.
  it('reads FALSE once the run reaches a terminal state', () => {
    const s = store();
    const id = dispatchedWith(s, 'demo-quiet-mesa', 'clear-refused:enter-ignored');
    expect(s.strandedClear('demo-quiet-mesa')).toBe(true);
    expect(s.advance(id, 'failed', 'operator')).toMatchObject({ ok: true });
    expect(s.strandedClear('demo-quiet-mesa')).toBe(false);
  });

  // THE PROOF IS ABOUT A BOX, AND THE BOX MOVES ON (review, W4c finding 1).
  //
  // `run_events` rows are durable forever, so a proof scoped only by the run's
  // state kept answering TRUE for the run's whole life — licensing a C-u at
  // that box on EVERY later delivery, long after the strand it was about had
  // been resolved and an operator had typed something new. The ruling is
  // refuse-only except where the lane can prove it typed THAT text, and a
  // permanent proof is not a proof of that.
  //
  // What retires it is a MEASUREMENT, not a clock: a delivery that LANDED in
  // this session at or after the strand. `sweepMail` calls `markDelivered`
  // only on `sendPrompt`'s ok — which means the box echoed our text and was
  // empty after Enter — so a landed delivery is durable evidence that the
  // stranded `/clear` is no longer in there. The first delivery to inherit the
  // wedge therefore spends the proof, and everything after it is back to the
  // ordinary `draft-present` refusal.
  const delivered = (s: CoordStore, toId: string, at: number | null): void => {
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId,
      runId: null, kind: 'status', subject: 'wave-brief', body: 'go', artifacts: [] });
    const d = s.queueDelivery(mail.id, toId, 'env');
    if (at !== null) s.markDelivered(d.id, at);
  };

  it('reads FALSE once a delivery has LANDED in that box since the strand', () => {
    const s = store();
    dispatchedWith(s, 'demo-quiet-mesa', 'clear-refused:enter-ignored');
    expect(s.strandedClear('demo-quiet-mesa')).toBe(true);
    delivered(s, 'demo-quiet-mesa', Date.now() + 1_000);
    // The operator may have typed a fresh `/clear` in the meantime; this lane
    // cannot see that and never could. What it CAN see is that the box it had
    // proof about was emptied — so it stops claiming proof.
    expect(s.strandedClear('demo-quiet-mesa')).toBe(false);
  });

  // The positive half, against the mutant that retires on ANY delivery row:
  // mail that landed BEFORE the strand says nothing about the box the strand
  // left behind, and must not spend a proof it predates.
  it('is NOT retired by a delivery that landed before the strand', () => {
    const s = store();
    dispatchedWith(s, 'demo-quiet-mesa', 'clear-refused:enter-ignored');
    delivered(s, 'demo-quiet-mesa', 1);   // epoch ms 1 — older than any strand
    expect(s.strandedClear('demo-quiet-mesa')).toBe(true);
  });

  it('is NOT retired by a queued delivery, nor by one that landed in ANOTHER box', () => {
    const s = store();
    dispatchedWith(s, 'demo-quiet-mesa', 'clear-refused:enter-ignored');
    delivered(s, 'demo-quiet-mesa', null);              // queued, never landed
    delivered(s, 'demo-other-mesa', Date.now() + 1_000); // landed, wrong box
    expect(s.strandedClear('demo-quiet-mesa')).toBe(true);
  });
});

// TASK 408 — a blocked delivery is visible on the wire BEFORE it is lost.
// `mail_deliveries.attempts` and `.lastError` are written on every back-off
// and read by nothing: `MailSummary` carried `state` alone, so a delivery
// blocked against a dirty input box for fifteen minutes was byte-identical to
// one merely waiting its turn.
describe('CoordStore: a blocked delivery is visible on the wire', () => {
  it('hydrateMail carries attempts and lastError straight off mail_deliveries', () => {
    const s = store();
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: 'w1',
      runId: null, kind: 'status', subject: 'wave-brief', body: 'go', artifacts: [] });
    const d = s.queueDelivery(mail.id, 'w1', 'env');
    s.backOff(d.id, 'draft-present', Date.now() + 30_000);
    s.backOff(d.id, 'draft-present', Date.now() + 60_000);

    const [row] = s.outstandingMailFor('w1');
    expect(row!.attempts).toBe(2);
    expect(row!.lastError).toBe('draft-present');
    // The back-off leaves the row QUEUED — which is why `outstandingMailFor`'s
    // predicate needs no change, and why a strip can render a live count
    // rather than waiting for a park.
    expect(row!.state).toBe('queued');
  });

  it('a delivery that has never failed reports 0 and null, not a guess', () => {
    const s = store();
    const mail = s.insertMail({ fromId: 'w1', fromUuid: 'u1', toId: 'coordinator',
      runId: null, kind: 'status', subject: 'done', body: 'ok', artifacts: [] });
    s.queueDelivery(mail.id, 'coordinator', 'env');
    const [row] = s.outstandingMailFor('coordinator');
    expect(row!.attempts).toBe(0);
    expect(row!.lastError).toBeNull();
  });

  it('mailForRecipient reads the same two columns — one hydrator, not two', () => {
    const s = store();
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: 'w1',
      runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    const d = s.queueDelivery(mail.id, 'w1', 'env');
    s.backOff(d.id, 'dialog-open', Date.now() + 1000);
    expect(s.mailForRecipient('w1')[0]!.lastError).toBe('dialog-open');
    expect(s.mailForRecipient('w1')[0]!.attempts).toBe(1);
  });

  // The counter on the wire is the SEND-FAILURE budget, and `backOff`'s
  // `countsAsAttempt: false` arm exists precisely because one gate (a registry
  // row that could not be measured) must never ratchet toward the park. What
  // the wire shows has to agree with what the ceiling counts, or the number
  // becomes a second, disagreeing story about the same row.
  it('an attempt the lane deliberately did not count is not counted here either', () => {
    const s = store();
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId: 'w1',
      runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    const d = s.queueDelivery(mail.id, 'w1', 'env');
    s.backOff(d.id, 'registry row listed but unreadable (registry-unmeasurable)', Date.now() + 1000, false);
    const [row] = s.outstandingMailFor('w1');
    expect(row!.attempts).toBe(0);
    expect(row!.lastError).toBe('registry row listed but unreadable (registry-unmeasurable)');
  });
});

describe('CoordStore.recordRunEvent — the caller owns the moment', () => {
  it('stamps the moment it is given, and still reads the clock when it is not', () => {
    // `markDispatchStarted` (store.ts:832-835) already states the precedent this
    // widening applies: "the caller owns the moment being recorded." The default
    // is what keeps dispatch.ts:370/409/615 byte-identical.
    const s = store();
    const r = openRun(s) as { id: number };
    s.recordRunEvent(r.id, 'coordinator', 'skill-preflight:absent', 1_700_000_000_000);
    const before = Date.now();
    s.recordRunEvent(r.id, 'coordinator', 'skill-preflight:present');
    const [given, defaulted] = s.runEvents(r.id);
    expect(given!.at).toBe(1_700_000_000_000);
    expect(defaulted!.at).toBeGreaterThanOrEqual(before);
  });
});

describe('CoordStore.reclaimProgram — the whole program, in one transaction', () => {
  const DEAD = 'ccrc-pwa-old-coordinator';
  const LIVE = 'ccrc-pwa-new-coordinator';

  /** The program as the wedge is actually found: five waves opened by ONE
   *  coordinator, wave 1 already closed. The closed row is the LOWEST id, and
   *  lowest-id-claimed is exactly the row both `claimedBy` readers pick
   *  (store.ts:382 and store.ts:1283, both `ORDER BY id LIMIT 1` with no state
   *  predicate). A fixture whose waves were all still open could not tell a
   *  whole-program rewrite from a non-terminal-only one — it would pass both. */
  const fiveWaves = (s: CoordStore): number[] => {
    const ids: number[] = [];
    for (let w = 1; w <= 5; w++) {
      ids.push((openRun(s, { wave: w, waveOf: 5, claimedBy: DEAD }) as { id: number }).id);
    }
    expect(s.advance(ids[0]!, 'dispatched', 'coordinator')).toMatchObject({ ok: true });
    expect(s.advance(ids[0]!, 'closing', 'coordinator')).toMatchObject({ ok: true });
    expect(s.advance(ids[0]!, 'done', 'coordinator')).toMatchObject({ ok: true });
    expect(s.run(ids[0]!)!.state).toBe('done');   // anti-vacuity: the fixture is really terminal
    return ids;
  };

  it('rewrites the TERMINAL run too, so the next wave stops being refused (R1)', () => {
    const s = store();
    const ids = fiveWaves(s);
    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000))
      .toEqual({ ok: true, program: 'build4', runIds: ids, from: DEAD });
    // The closed wave-1 row is the whole assertion: it is the id both readers
    // reach first, and a rewrite that skipped it leaves them on the corpse.
    expect(s.run(ids[0]!)!.state).toBe('done');
    expect(ids.map((id) => s.run(id)!.claimedBy)).toEqual([LIVE, LIVE, LIVE, LIVE, LIVE]);
    expect(s.resolveCoordinator(null)).toBe(LIVE);
    expect(openRun(s, { wave: 6, waveOf: 6, claimedBy: LIVE })).toMatchObject({ state: 'planned' });
  });

  it('leaves a reconstructed row NULL rather than inventing a claimant for it (D-12)', () => {
    const s = store();
    const ids = fiveWaves(s);
    // `reconstruct` mints every rebuilt run with `claimedBy` NULL — it cannot
    // know who will resume the program — and D-12's clause (store.ts:373-380)
    // exists to SKIP those rows. Written with the store's own handle, the shape
    // this file already uses at :67 for a row no public method can produce.
    s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(ids[2]!);
    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000))
      .toEqual({ ok: true, program: 'build4', runIds: [ids[0]!, ids[1]!, ids[3]!, ids[4]!], from: DEAD });
    expect(s.run(ids[2]!)!.claimedBy).toBeNull();
    expect(s.runEvents(ids[2]!)).toEqual([]);     // and no trail invented for it either
  });

  it('writes one attribution row per rewritten run, every one carrying the SAME moment', () => {
    const s = store();
    const ids = fiveWaves(s);
    const at = 1_777_000_123_456;
    s.reclaimProgram(ids[4]!, LIVE, at);
    for (const id of ids) {
      const mine = s.runEvents(id).filter((e) => e.causedBy === 'operator');
      expect(mine.length).toBe(1);
      expect(mine[0]!.at).toBe(at);
      expect(mine[0]!.detail).toBe(`reclaim:${DEAD} -> ${LIVE}`);
      // A non-transition encoded as one — `fromState === toState`, which is also
      // what keeps the row off the notify lane (store.ts:566-569).
      expect(mine[0]!.fromState).toBe(mine[0]!.toState);
    }
    const ats = ids.flatMap((id) =>
      s.runEvents(id).filter((e) => e.causedBy === 'operator').map((e) => e.at));
    expect(ats.length).toBe(5);
    expect(new Set(ats).size).toBe(1);           // one operator act, one moment, not five
  });

  it('a `to` that is already the claimant is a no-op SUCCESS — never a refusal, never a trail', () => {
    const s = store();
    const ids = fiveWaves(s);
    const before = ids.flatMap((id) => s.runEvents(id)).length;
    expect(s.reclaimProgram(ids[4]!, DEAD, 1_777_000_000_000))
      .toEqual({ ok: true, program: 'build4', runIds: [], from: DEAD });
    expect(ids.flatMap((id) => s.runEvents(id)).length).toBe(before);
    expect(ids.map((id) => s.run(id)!.claimedBy)).toEqual([DEAD, DEAD, DEAD, DEAD, DEAD]);
  });

  it('refuses an id no run carries, and a run whose claimant is NULL — writing nothing either way', () => {
    const s = store();
    const ids = fiveWaves(s);
    expect(s.reclaimProgram(ids[4]! + 999, LIVE, 1_777_000_000_000))
      .toEqual({ ok: false, kind: 'unknown-run' });
    s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(ids[4]!);
    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000))
      .toEqual({ ok: false, kind: 'no-claimant' });
    // The refusal returned BEFORE the UPDATE: the other four rows are untouched.
    expect(s.run(ids[0]!)!.claimedBy).toBe(DEAD);
  });

  it('is ONE transaction — an attribution row that throws rolls the whole rewrite back', () => {
    const s = store();
    const ids = fiveWaves(s);
    // The property `tx()` buys (db.ts:245-257, `BEGIN IMMEDIATE`) and the reason
    // this method may not be three public store calls in a row: a crash between
    // the UPDATE and the attribution rows leaves a program whose runs name a
    // coordinator no `run_events` row ever says arrived. Patched on the instance
    // because nothing else in this store can be made to fail on demand.
    const patched = s as unknown as { recordRunEvent: () => void };
    patched.recordRunEvent = () => { throw new Error('attribution failed'); };
    expect(() => s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toThrow('attribution failed');
    expect(ids.map((id) => s.run(id)!.claimedBy)).toEqual([DEAD, DEAD, DEAD, DEAD, DEAD]);
  });
});

// ─── program-leverage wave 5, fix round: the reclaim's MAIL half ────────────
//
// Blocking review MAJOR 1 (`D-1141`/`D-1142`) and MINOR 9 (`D-1143`). The
// reclaim used to rewrite `runs.claimedBy` and nothing else, so a wave-done the
// worker queued minutes earlier stayed addressed to the corpse — `GET /api/mail`
// is recipient-scoped, `mail_deliveries.toId` is frozen at queue time, and the
// heir's box read empty while the sweep walked the report to `undeliverable`.
//
// The four arms of the ruling are four CLAUSES of one statement, not four
// branches, so each one gets a test that dies when its clause is removed — the
// mutation table records which. `mail.toId` is what decides: it keeps the
// PRE-resolution addressing (`coordinator`, or a literal id) beside
// `mail_deliveries.toId`'s resolved answer.
describe('CoordStore.reclaimProgram — the mail follows the chair (D-1141/D-1142/D-1143)', () => {
  const DEAD = 'ccrc-pwa-old-coordinator';
  const LIVE = 'ccrc-pwa-new-coordinator';
  const WORKER = 'ccrc-pwa-wave-worker';

  /** The wedge as it is actually found: five waves under ONE coordinator, wave 1
   *  already closed — `fiveWaves` above, minus the export. Re-declared rather
   *  than shared because this block's fixtures also queue mail against those ids
   *  and a shared helper would have to grow a mail argument for one caller. */
  const waves = (s: CoordStore): number[] => {
    const ids: number[] = [];
    for (let w = 1; w <= 5; w++) {
      ids.push((openRun(s, { wave: w, waveOf: 5, claimedBy: DEAD }) as { id: number }).id);
    }
    return ids;
  };

  /** One mail plus its one delivery, the way `POST /api/mail` writes the pair:
   *  `mail.toId` is what the SENDER addressed (the role, or a literal id) and
   *  `mail_deliveries.toId` is the RESOLVED recipient. Handing both separately is
   *  the whole point — the fix turns on them being able to differ. */
  const queue = (
    s: CoordStore,
    m: { fromId?: string; toId: string; runId: number | null; subject?: string },
    deliverTo: string,
  ): number => {
    const mail = s.insertMail({
      fromId: m.fromId ?? WORKER, fromUuid: `u-${m.fromId ?? WORKER}`, toId: m.toId,
      runId: m.runId, kind: 'status', subject: m.subject ?? 'wave-done',
      body: 'the wave is done', artifacts: [],
    });
    return s.queueDelivery(mail.id, deliverTo, 'envelope rendered once, at queue time').id;
  };

  /** The delivery row's four load-bearing columns. Read with the store's own
   *  handle: no public method returns `rejectCode`, and `delivery(id)` narrows
   *  away exactly the columns these assertions are about. */
  const del = (s: CoordStore, id: number) =>
    s.db.prepare('SELECT toId, state, rejectCode, lastError FROM mail_deliveries WHERE id = ?')
      .get(id) as { toId: string; state: string; rejectCode: string | null; lastError: string | null };

  /** An outstanding `program-kickoff` to `toId`, keyed exactly as
   *  `queueProgramKickoff` keys it: sender `operator`, no run, the literal
   *  session id as `mail.toId`, and the shared subject constant. */
  const kickoff = (s: CoordStore, toId: string): number =>
    queue(s, { fromId: 'operator', toId, runId: null, subject: PROGRAM_KICKOFF_SUBJECT }, toId);

  it('ARM (a): a role-addressed wave-done for THIS program is repointed to the heir', () => {
    const s = store();
    const ids = waves(s);
    const d = queue(s, { toId: 'coordinator', runId: ids[3]! }, DEAD);
    // Anti-vacuity, in the direction the bug was actually reported: the heir's
    // box is EMPTY before the reclaim and the corpse holds the report.
    expect(s.outstandingMailFor(LIVE)).toEqual([]);
    expect(s.outstandingMailFor(DEAD).map((m) => m.deliveryId)).toEqual([d]);

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    expect(del(s, d).toId).toBe(LIVE);
    // Repointed, NOT parked: the delivery is still exactly as outstanding as it
    // was, which is what makes it reachable at all.
    expect(del(s, d).state).toBe('queued');
    expect(del(s, d).lastError).toBeNull();
    expect(s.outstandingMailFor(LIVE).map((m) => m.deliveryId)).toEqual([d]);
    expect(s.outstandingMailFor(DEAD)).toEqual([]);
  });

  it('ARM (b): a mail addressed to a literal session id is LEFT — it was sent to a session', () => {
    const s = store();
    const ids = waves(s);
    // Identical in every way to arm (a)'s row except `mail.toId`, which is the
    // only column that distinguishes "sent to the chair" from "sent to you".
    const d = queue(s, { toId: DEAD, runId: ids[3]! }, DEAD);
    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });
    expect(del(s, d)).toMatchObject({ toId: DEAD, state: 'queued' });
  });

  it('ARM (c): an acked delivery and an already-parked one are NEVER moved', () => {
    const s = store();
    const ids = waves(s);
    const acked = queue(s, { toId: 'coordinator', runId: ids[3]! }, DEAD);
    const parked = queue(s, { toId: 'coordinator', runId: ids[3]! }, DEAD);
    expect(s.markAcked(acked, 1_776_000_000_000)).toBe(true);
    s.rejectDelivery(parked, 'undeliverable', 'recipient session is stopped');
    // …and one live row beside them, so a mutation that drops the state clause
    // cannot pass by moving nothing at all.
    const live = queue(s, { toId: 'coordinator', runId: ids[3]! }, DEAD);

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    expect(del(s, acked)).toMatchObject({ toId: DEAD, state: 'acked' });
    expect(del(s, parked)).toMatchObject({ toId: DEAD, state: 'rejected' });
    expect(del(s, live).toId).toBe(LIVE);
  });

  it('ARM (d) — THE FOLD (D-1142), pinned as a decision: role-addressed with NO runId is LEFT', () => {
    const s = store();
    const ids = waves(s);
    // Reachable, not hypothetical: `POST /api/mail` accepts `{toId:'coordinator',
    // runId:null}` and resolves it through `resolveCoordinator(null)`'s
    // single-active-program arm. Once queued, nothing on the row records WHICH
    // program the sender meant — the resolution is spent — so repointing it would
    // be a guess on a door whose whole discipline is refusing to guess. The inner
    // JOIN drops it; this pins that as a decision rather than an accident.
    const d = queue(s, { toId: 'coordinator', runId: null }, DEAD);
    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });
    // Not repointed AND not cancelled: it is not a kickoff either.
    expect(del(s, d)).toMatchObject({ toId: DEAD, state: 'queued', lastError: null });
    // …and it is still visible to the party who CAN tell which program it meant.
    expect(s.outstandingMailFor(DEAD).map((m) => m.deliveryId)).toEqual([d]);
  });

  it('scopes the repoint to THIS program: a sibling program’s coordinator mail is untouched', () => {
    const s = store();
    const ids = waves(s);
    const other = (openRun(s, { program: 'sibling', wave: 1, waveOf: 1, claimedBy: DEAD }) as
      { id: number }).id;
    const mine = queue(s, { toId: 'coordinator', runId: ids[3]! }, DEAD);
    const theirs = queue(s, { toId: 'coordinator', runId: other }, DEAD);

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    expect(del(s, mine).toId).toBe(LIVE);
    // The sibling program still names DEAD as its own coordinator — this door
    // hands over ONE program — so its mail must stay where its chair is.
    expect(s.run(other)!.claimedBy).toBe(DEAD);
    expect(del(s, theirs).toId).toBe(DEAD);
  });

  it('D-1143 + THE DISJOINTNESS: one reclaim repoints the report and CANCELS the kickoff', () => {
    // The two statements are disjoint BY CONSTRUCTION — the cancel matches only
    // `mail.runId IS NULL`, the repoint only rows that JOIN a `runs` row — and
    // this is the measurement rather than the claim: after ONE reclaim, each row
    // wears exactly one of the two outcomes and neither wears the other's.
    const s = store();
    const ids = waves(s);
    const report = queue(s, { toId: 'coordinator', runId: ids[3]! }, DEAD);
    const k = kickoff(s, DEAD);

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    // The report moved and was NOT parked by the cancel.
    expect(del(s, report)).toMatchObject({ toId: LIVE, state: 'queued', lastError: null });
    // The kickoff was parked and was NOT moved by the repoint: it is an
    // instruction to take a chair that has just been given to somebody else, and
    // handing it to the heir would brief the heir to do what it is already doing.
    expect(del(s, k)).toMatchObject({
      toId: DEAD, state: 'rejected', rejectCode: 'undeliverable',
      lastError: MAIL_RECLAIM_CANCELLED_ERROR,
    });
    // …and the heir's box holds the report ALONE.
    expect(s.outstandingMailFor(LIVE).map((m) => m.deliveryId)).toEqual([report]);
  });

  it('D-1143 read side: the cancelled kickoff stops reading as mail that needs attention', () => {
    // The half a writer cannot fix. `OUTSTANDING_OR_ABANDONED_SQL` keeps a
    // `rejected` row VISIBLE unless its park is a deliberate one, and the
    // kickoff's `mail.runId` is NULL so the terminal-run arm cannot reach it
    // either. Without `MAIL_RECLAIM_CANCELLED_ERROR` in the exclusion, the corpse
    // — an id `ccd start`/`ws-restore` can bring back, and `_ws_slug_new` can
    // re-mint — would open its mail strip on a kickoff for a program somebody
    // else now holds: MINOR 9's own hazard, re-entered through the READ side.
    const s = store();
    const ids = waves(s);
    s.setSession(ids[4]!, DEAD);
    const k = kickoff(s, DEAD);
    expect(s.outstandingMailFor(DEAD).map((m) => m.deliveryId)).toEqual([k]);
    // …and it never reached `RunSummary.unreadMail` in the first place, before or
    // after: that count is `m.runId = ?`-scoped and a kickoff names no run.
    expect(s.run(ids[4]!)!.unreadMail).toBe(0);

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    expect(s.outstandingMailFor(DEAD)).toEqual([]);
    expect(s.outstandingMailFor(LIVE)).toEqual([]);
    expect(s.run(ids[4]!)!.unreadMail).toBe(0);
    // The record itself survives — nothing DELETEs from `mail_deliveries` — so
    // the operator's own history read still finds it.
    expect(s.mailForRecipient(DEAD).map((m) => m.deliveryId)).toEqual([k]);
  });

  it('cancels ONLY the displaced claimant’s kickoff — never a bystander’s, never on a no-op', () => {
    const s = store();
    const ids = waves(s);
    const bystander = kickoff(s, 'ccrc-pwa-uninvolved');
    const heirs = kickoff(s, LIVE);
    const mine = kickoff(s, DEAD);

    // A `to` that already holds the chair displaces nobody: `moved` is empty, so
    // the mail half never runs at all and the current coordinator's own unread
    // kickoff survives the operator re-typing the id the board already shows.
    expect(s.reclaimProgram(ids[4]!, DEAD, 1_777_000_000_000))
      .toMatchObject({ ok: true, runIds: [] });
    expect(del(s, mine).state).toBe('queued');

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });
    expect(del(s, mine).state).toBe('rejected');
    // The heir's own kickoff is the one message that must survive: it is what
    // told this session to take the chair it is now taking.
    expect(del(s, heirs).state).toBe('queued');
    expect(del(s, bystander).state).toBe('queued');
  });

  it('a PEER mail that happens to carry the kickoff subject is not cancelled', () => {
    // `subject` on the peer lane is caller-chosen free text (D-1041's own
    // finding), so the cancel keys on the whole dedupe triple — sender, no run,
    // subject — and not on the subject alone. Without `fromId`, an operator
    // clearing a wedge would terminate an unrelated worker-to-worker message.
    const s = store();
    const ids = waves(s);
    const peer = queue(s,
      { fromId: WORKER, toId: DEAD, runId: null, subject: PROGRAM_KICKOFF_SUBJECT }, DEAD);
    const real = kickoff(s, DEAD);

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    expect(del(s, peer).state).toBe('queued');
    expect(del(s, real).state).toBe('rejected');
  });

  it('the MAIL half is inside the SAME transaction — a throw rolls back runs AND mail', () => {
    // `DatabaseSync` transactions do not nest, so the mail statements had to be
    // plain statements inside `reclaimProgram`'s own `tx()` rather than public
    // methods holding one. This is the property that buys: patched on the
    // instance (the idiom the sibling suite above already uses for
    // `recordRunEvent`, because nothing else here can be made to fail on demand).
    const s = store();
    const ids = waves(s);
    const report = queue(s, { toId: 'coordinator', runId: ids[3]! }, DEAD);
    const k = kickoff(s, DEAD);
    const patched = s as unknown as { repointCoordinatorMail: () => void };
    patched.repointCoordinatorMail = () => { throw new Error('repoint failed'); };

    expect(() => s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toThrow('repoint failed');

    expect(ids.map((id) => s.run(id)!.claimedBy)).toEqual([DEAD, DEAD, DEAD, DEAD, DEAD]);
    expect(del(s, report).toId).toBe(DEAD);
    // The cancel ran BEFORE the throw and is gone with it: one commit, not three.
    expect(del(s, k).state).toBe('queued');
  });
});

// The sweep asks one question of this store and nothing else asked it before:
// which sessions are COORDINATING something live. Three of the four tests below
// exist for a direction the obvious implementation gets wrong — the worker
// column, a terminal row, a repeated coordinator (D-1160).
describe('CoordStore: openCoordinatorIds', () => {
  it('names a session that is the claimedBy of a non-terminal run', () => {
    const s = store();
    openRun(s, { claimedBy: 'the-coordinator' });
    expect(s.openCoordinatorIds()).toEqual(['the-coordinator']);
  });

  it('does NOT name a session whose only claimed run is terminal', () => {
    // The reclaim trap. `reclaimProgram` rewrites `claimedBy` across EVERY run
    // of a programme, terminal rows included, so "appears in some claimedBy" is
    // not the fact this method answers.
    const s = store();
    const r = openRun(s, { claimedBy: 'the-corpse' }) as { id: number };
    expect(s.advance(r.id, 'dispatched', 'operator')).toMatchObject({ ok: true });
    expect(s.advance(r.id, 'closing', 'operator')).toMatchObject({ ok: true });
    expect(s.advance(r.id, 'done', 'operator')).toMatchObject({ ok: true });
    expect(s.openCoordinatorIds()).toEqual([]);
  });

  it('does NOT name a session whose only claimed run FAILED', () => {
    // The other terminal state, which the shipped predicate names explicitly
    // and a predicate derived from RUN_TRANSITIONS would too — but a predicate
    // that only excluded 'done' would not.
    const s = store();
    const r = openRun(s, { claimedBy: 'the-corpse' }) as { id: number };
    expect(s.advance(r.id, 'failed', 'operator')).toMatchObject({ ok: true });
    expect(s.openCoordinatorIds()).toEqual([]);
  });

  it('names the COORDINATOR and not the WORKER — sessionId is not claimedBy', () => {
    // The direction `openRunsForSession` would have got exactly backwards.
    const s = store();
    const r = openRun(s, { claimedBy: 'the-coordinator' }) as { id: number };
    s.markDispatched(r.id, 'the-worker', 'ws-1', 'ws/ws-1', false);
    expect(s.openCoordinatorIds()).toEqual(['the-coordinator']);
  });

  it('names one coordinator once, however many open runs it holds', () => {
    const s = store();
    openRun(s, { claimedBy: 'the-coordinator' });
    openRun(s, { claimedBy: 'the-coordinator', wave: 2 });
    expect(s.openCoordinatorIds()).toEqual(['the-coordinator']);
  });

  it('names two different coordinators when two programs are live', () => {
    // The fixture that could witness a scan collapsing to a single row.
    const s = store();
    openRun(s, { claimedBy: 'coordinator-a' });
    openRun(s, { program: 'other', title: 'Other', claimedBy: 'coordinator-b' });
    expect(s.openCoordinatorIds().sort()).toEqual(['coordinator-a', 'coordinator-b']);
  });

  it('skips a RECONSTRUCTED run, whose claimedBy is null — and does not answer [null]', () => {
    // The `claimedBy IS NOT NULL` half, and it needs this fixture because
    // `openRun` cannot produce the row: `reconstruct`'s disaster-recovery
    // INSERT is the one writer in the tree that binds `claimedBy` to null
    // (`store.ts:2406`), and it rebuilds a live, NON-terminal wave. Without the
    // guard the method answers `[null]` typed `string[]` — a null wearing a
    // session id's type, straight into a `Set` the mail lane then asks about.
    const s = store();
    const rebuilt = s.reconstruct({
      ledger: { slug: 'build4', title: 'Transcript surface',
                waves: [{ wave: 1, of: 5, handoffCommit: null }] },
      registry: { sessionId: 'ccrc-pwa-quiet-mesa', project: 'ccrc-pwa',
                  workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
                  held: 'program:build4 wave:1/5' },
      prHistory: [],
    });
    // The premise, established rather than assumed: a NON-terminal row exists,
    // and its claimedBy really is null.
    expect(rebuilt.map((r) => r.state)).toEqual(['working']);
    expect(s.run(rebuilt[0]!.id)!.claimedBy).toBeNull();
    expect(s.openCoordinatorIds()).toEqual([]);
  });

  it('is empty on a store with no runs at all', () => {
    expect(store().openCoordinatorIds()).toEqual([]);
  });
});
