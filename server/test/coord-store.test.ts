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
    s.setWorkItemState(one.id, 'done', 'ccrc-pwa-quiet-mesa');
    expect(s.itemTally(r.id)).toEqual({ done: 1, total: 2 });
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
