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
import { CoordStore } from '../src/coord/store.js';
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
});

describe('CoordStore: work items', () => {
  it('tallies done/total per run without ever calling them tasks', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    const one = s.addWorkItem(r.id, 'implement the reader', []);
    s.addWorkItem(r.id, 'review it', [one.id]);
    expect(s.itemTally(r.id)).toEqual({ done: 0, total: 2 });
    s.setWorkItemState(one.id, 'done', 'ccrc-pwa-quiet-mesa');
    expect(s.itemTally(r.id)).toEqual({ done: 1, total: 2 });
  });
});

describe('the disaster-recovery path (spec:82-85)', () => {
  it('reconstructs a representative program from the ledger, the registry and .prhistory', () => {
    // The DATABASE IS THE ONE THING NOT AVAILABLE. This drill proves the three
    // surviving artefacts carry enough: the ledger names the program and its
    // waves, the registry names the workspace/branch/hold, and .prhistory names
    // the PR lineage. It asserts the REBUILT run rows, so a future column that
    // cannot be reconstructed fails here and has to justify itself.
    const s = store();
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
    expect(rebuilt.map((r) => [r.wave, r.state, r.handoffCommit])).toEqual([
      [1, 'done', 'a'.repeat(40)],
      [2, 'working', null],
    ]);
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
});

describe('CoordStore: mail delivery replay (spec:174-180)', () => {
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
});
