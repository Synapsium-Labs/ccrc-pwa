# Workspace lifecycle wave 5 — review 339's residue, then the expiry lane's follow-ups (CCR-17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The execution method is chosen (a dispatched fleet worker, subagent-driven); there is no hand-off question.

**Goal:** Close review 339's residue on the dead-coordinator lane — its five ARMING BLOCKERS first (F1, F2, F3, F13 and the worker's open item 2), then F4, F5's spec sentence and the wave-4 plan's corrections — and then the expiry lane's four follow-ups: a pre-breadcrumb `state-changed` audited afresh (an arming blocker), the kept-leaf reader, the lane's answer to a repeating resumable failure (a persistent tier that never strands a row), and `ws-expire`'s in-lock window close. Both lanes stay SHADOWED.

**Architecture:** Server-side, every change lives in the files wave 4 and wave 3b shipped: the L1 verdicts (`server/src/deadCoordinator.ts`, `server/src/archivedExpiry.ts`), their one executors (`server/src/coord/endDeadCoordinator.ts`, `server/src/coord/expireArchived.ts`), `closeRun`'s sweep arm (`server/src/coord/close.ts`), the lifecycle mirror (`server/src/coord/mirror.ts`) and the two sibling passes in `server/src/watch.ts`. One ccd change: `_ws_expire_locked` refuses `failed` `state-changed` when its two branch reads disagree, reusing CCR-15 wave 6's three-way read, before the tombstone and the breadcrumb. One wire word is added (`ExpiryAttention.kind` gains `kept`, additive; an older PWA renders it `reported`). No route, no migration, no `FLEET_PROTO` bump, and no arming path: `expire-lane-live` and `dead-coordinator-lane-live` keep NO writer in the tree.

**Tech Stack:** TypeScript (Node ≥ 22.16, `node:sqlite`), vitest, bash (`ccd/ccd`), git ≥ 2.43 for the three-way branch read.

**Spec:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` §5.3 (`ws-expire` and the expiry lane), §5.4 (the dead-coordinator lane and its "What follows" list), §8, §9; review 339's report (`.superpowers/sdd/coordinator-evidence/run314/review-339-701839b5.md` in the coordinator's worktree; findings F1–F13 are quoted where a task needs them); the programme ledger's 2026-10-08 entries at 08:06, 12:02 and 13:12, its Carried constraints and its Next-wave brief.

> **Departure numbers.** This plan names its departures by SLUG under `## Deviations found` and defines no number. The run's brief issues the numbers: the worker writes them bare, in the order `## Deviations found` lists the slugs, each in the entry that defines it, in the commit of the first task that makes the change — never a guessed number. Fourteen slugs; the block issued is sixteen, so two are reported unused. A departure found while executing is reported for a number, never typed.

> **The `state-changed` reading (ruling B1, and the coordinator's ruling of 2026-10-08 on question (h)), decided by measurement.** On `origin/main` `b0647d850` NO `ws-expire` path prints a `{"failed":"state-changed"}` document at all: every `state-changed` the expiry prints is a REFUSAL document (`{"refused":…}`, exit 0 — the token mismatch at `_ws_expire_locked`'s verdict point and the resume's re-archived epoch in `_ws_expire_resume_eval`), already read `retry` by `EXPIRE_TOKEN_KIND`. The only `failed` `state-changed` in ccd is `_ws_reclaim_locked`'s (ws-reclaim's own verb, which an expiry never reaches). Task 11 (B4) adds the expiry's first producer, after the pin and BEFORE the tombstone and the breadcrumb. So the expiry's only `failed` `state-changed` prints on its FRESH arm, before the breadcrumb — nothing was deleted — and Task 8 reads it, red-first, as the reclaim side's "not resumable" means it: START OVER, never final (question (h), ruled). The lane forgets the instant and the sightings it learned and audits the row afresh, so a fresh audit mints a token over what stands; Task 11 measures that nothing the refusal leaves is misread by that audit. A census test over ccd/ccd holds that: it places EVERY non-comment occurrence of either pre-breadcrumb word, however it is spelled, by function and shape (a stopping line, not one spelling), and holds the expiry's `failed` `state-changed` on its fresh arm, before the breadcrumb. `pin-failed` and `tombstone-unwritable` stay resumable: the shared tail prints each after the breadcrumb (eight and five producers, measured), so the word alone cannot say nothing started — that waits for CCR-15 wave 7's `crumb` field. **A known gap, unchanged from `main`, ROUTED to this programme's wave 6 (question (k)) — an ARMING BLOCKER for the expiry lane until then:** `probe-unmeasured`, which `main` already reads as final, is printed at `_ws_expire_locked`'s verdict point on EVERY arm. On a RESUMED expiry an earlier attempt's breadcrumb stands and the tree may be part-deleted (`_ws_expire_resume_eval`'s unmeasured exits: a tombstone it cannot read, or a tmux probe that did not answer), so one transient probe failure there stops the lane for that archive until a restart. This plan does not widen it (the new producer is fresh-arm only) and does not change it: the resumed arm's `probe-unmeasured` keeps `main`'s final reading in this wave. The fix is wave 6's, after CCR-15 wave 7 is on `main`: `_ws_expire_locked` sets wave 7's `crumb` (the global `_WS_RCL_CRUMB`) on its resumed arm, and the parser reads a failed document with `crumb: true` as resumable — so it backs off and, after a day, reaches Task 10's persistent tier.

## Global Constraints

- **SAFETY (CLAUDE.md), absolutely.** Fixture HOMEs and fixture stores only. Never run `ccd` against the live `$HOME`; never run `ws-expire`, `ws-audit --expire`, `ws-reclaim` or any destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service`; never call the live server's run, mail or abandon routes; never print a secret file's contents. **Both lanes this wave touches act on the live fleet once armed** — the expiry lane deletes archived workspaces through `ws-expire`; the dead-coordinator lane closes other coordinators' runs `failed` and gets their children reclaimed — so every case here runs the lane against a fixture store, a fixture HOME and a scripted runner, exactly as wave 4's suites do.
- **Both lanes stay SHADOWED. This wave creates no live file and touches no arming path.** `expire-lane-live` and `dead-coordinator-lane-live` keep NO writer in the tree: `single-definition.test.ts`'s two no-writer pins stay green and this plan does not edit that file. Arming stays the operator's, by hand, after the ledger's arming blockers are checked on the merged lines.
- **The environment.** The fleet box is loaded and other workers run suites. Run vitest in the FOREGROUND, ONE test file per process (`./node_modules/.bin/vitest run <file> --maxWorkers=1`, never bare `npx vitest`, never two suites at once, never in the background). `TMPDIR` on the volume but OUTSIDE every git checkout; delete only fixtures you created; `CCD_DISK_FLOOR_GB=1` for test runs. `cd server && npm ci`, and `agent/` and `pwa/` too (`typecheck-tests` needs `agent/node_modules`; Task 9 needs the PWA's).
- **Known reds not caused by this work:** `tmp-sweep`'s "FAILS CLOSED…", `session-hook`'s "skips a scratch slug" under a `TMPDIR` outside `/tmp`, and `boot.test.ts`'s timing cases under load (measured here: `1 failed` in shard 1 of the full run, the "a valid, instant ccd also boots fast" case).
- **`ccd/ccd` is edited once (Task 11).** Re-stamp it (`~/.local/bin/ccrc restamp ccd/ccd`) after the edit; the edit sits in `_ws_expire_locked`, far below the frozen compaction-card corpus's highest `ccd/ccd` anchor (`:19131`), and the citation census is unchanged — measured, Task 11 Step 5.
- **The five citation cases** run after every task that edits a cited file (README, `shared/api.ts`, `ccd/ccd`):

  ```bash
  ( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
  ```

  Measured: `5 passed | 330 skipped (335)` after every task. This plan's `shared/api.ts` edit (Task 9) changes one line in place and its README edits (Tasks 7 and 12) sit below README's four `shared/api.ts` citations, so nothing is re-pointed.
- **Deviation numbers.** Fourteen departures, by slug; the brief issues the numbers. No `D-<n>` token is written for a new number in any code comment, test title or doc this plan touches: comments name review 339's finding (`review 339, F3`) or the ruling (`wave 5`). This plan's blocks edit two ledger entries of the wave-4 plan (F6, F7): `deviation-refs.test.ts` reads every plan's column-0 entry lines — this plan's blocks included — so those two are FRAGMENT blocks that never quote an entry line whole.
- **No hostnames, IPs, tailnet names or docserver URLs** anywhere in the diff (`topology-clean.test.ts`).
- **Overlap (the coordinator's ruling C).** No live claims on `ccrc-pwa` at planning time. Likely concurrent: CCR-15 child-reclamation wave 7 (`ccd/ccd`'s shared tail and its additive `crumb` field; `server/src/coord/childReclaim.ts`), session-continuity wave 4b (run 308; ccd's spawn environment), ccrc-history (run 302; ccd's history files and `single-definition.test.ts`'s end of file — this plan does not edit that file) and the operator's own #317 (ccd's `_swap_carry_*`). This plan's `ccd/ccd` region is `_ws_expire_locked` alone. **Whichever lands second runs `git merge origin/main` (never a rebase), keeps both sides, re-stamps `ccd/ccd`, re-runs the five citation cases, `cite-remeasure` and the `_reg_get` census, and re-points by content.** `## Re-measure at dispatch` lists every block in a shared file.
- **CCR-15 wave 7's shared terminal word** (`containment-refuted`, raised at its pre-flight beside "persistent per-child failures that retry for ever") is not read specially here. Until CCR-15 wave 7 is on `main`, today's parser reads `containment-refuted` (an unknown `failed` word) as resumable, which wave 7's `containment-refuted-word` test pins, so on the expiry lane it reaches Task 10's persistent tier after a day and is never stranded; attention AT ONCE for it (CCR-15's `stuck` class) is this programme's wave 6.

## Review Focus

What a reviewer looking for a programme ended, or a workspace deleted, that should not have been meets first:

1. **Nothing arms.** No file in the diff writes `expire-lane-live` or `dead-coordinator-lane-live`; `single-definition`'s no-writer pins stay green (Task 13).
2. **The act re-measures at its own instant** — and now the lane's wiring of that clock has a red (Task 1, row T1.1: the survivor of review 339).
3. **A thrown act always leaves a durable record**, and a stop after a fleet act says WHICH act ran: a released worker (unheld) is never worded as a re-held one (still claimed), and the reverse (Tasks 3, 4). Only `sweep-stopped` carries the act: `closeRun`'s two other refusals after the fleet act, `claimant-changed` and `advanceFailed`, need a run writer outside the coordination serialiser, which this build has none of (close.ts's own comment at that arm), so they do not carry it — a writer added outside the serialiser would need them to (Task 3, Interfaces).
4. **A mirror that cannot read a generation is not healthy for long.** One failed tick is absorbed, a persistent one reads `stale`, and a `stale`/`unknown` mirror at the act is a `hold` that keeps the anchor and the run of passes — it never deletes evidence because a mirror was late (Tasks 5, 6).
5. **`ws-expire`'s consent binds the branch.** A branch deleted (or made) inside the lock between the recompute and the pin stops the act BEFORE the tombstone and the breadcrumb; nothing is destroyed; the server reads that `failed` `state-changed` as one to START OVER from — the lane forgets what it learned, audits afresh, lists nothing and writes a feed row — a census over ccd/ccd places every occurrence of the word, however spelled, and holds the expiry's producer on its fresh arm, before the breadcrumb, and a fresh audit after the refusal misreads nothing it left (measured, with a detached HEAD; with HEAD symbolic to `ws/<slug>`, as in every real workspace, a branch DELETED in the window is refused earlier by `_ws_reclaim_pin`'s own check — `pin-failed`, resumable, nothing started, no breadcrumb — so that shape takes the resumable ladder, never `restart`; Task 11's scope note) (Tasks 8, 11). The resumed-arm `probe-unmeasured` (the header's known gap) is `main`'s reading, unchanged — routed to wave 6, an arming blocker until then.
6. **A kept leaf is listed; an older ccd's silence is not an alarm.** `clipsKept`/`tmpRootKept` are read by name; a kept word lists the archive (its row is gone); an absent key is recorded in the feed row only (Task 9).
7. **A day of resumable failures slows the asking, and never stops it** — a standing entry, asked every four hours for as long as the failures last, never a destructive suggestion. No answer that ends no attempt drops it or resets its run: a hold the lane sees, a deferral, a shadow audit (never a "nothing was deleted" said of a workspace that may be part-cleaned), a refusal the box retries (a hold the ACT meets among them), an in-use, ccd's "not yet", an older ccd's silence — each arm has its own assertion and mutation row. Only an attempt that completes, one that finds none had begun (a `failed` `state-changed`: the fresh arm runs only while no breadcrumb stands), a final verdict, or a new archive ends it; a restart forgets it (Task 10). Nothing is stranded behind a breadcrumb.

## File Structure

| File | Tasks | What changes |
|---|---|---|
| `server/src/deadCoordinator.ts` (L1) | 2, 3, 4, 6 | `deadCoordinatorSighted` forgets `lastOutcome` on an episode-ending reading; `reheld` on the outcome and the progress, worded; `SWEEP_FLEET_ACTS` (the two fleet-act words, declared once for the kebab scan); `failedRun` and `deadCoordinatorThrewFeedRow`; the `hold` stop |
| `server/src/coord/close.ts` | 3 | `sweep-stopped.released: boolean` → `fleetAct: SweepFleetAct \| null` |
| `server/src/coord/routes.ts` | 3 | the (unreachable-by-route) `sweep-stopped` 409 body carries `fleetAct` |
| `server/src/coord/endDeadCoordinator.ts` | 3, 4, 6 | pushes `released`/`reheld` by the act that ran; names the in-flight run on a throw; `recordDeadCoordinatorThrew`; `journalTrust` carries `hold` and a `hold` stops the act |
| `server/src/coord/mirror.ts` | 5 | `drain` answers whether it read; `lastOkAt` moves only when every planned read answered |
| `server/src/watch.ts` | 3, 4, 6, 9 | the throw's progress literal; a feed row for every thrown act; the act's `journalTrust` whole; the expiry lane keeps a `kept` entry past its row |
| `server/src/archivedExpiry.ts` (L1) | 8, 9, 10 | `EXPIRE_PRE_CRUMB_FAILED` and the `restart` reading, outcome and memory arm; the kept-leaf reader (`keptLeafWord`, the one word reader, and `expireLeafKept`, its carrier) and its report; `EXPIRE_FAILURE_GIVE_UP_MS`, `EXPIRE_PERSISTENT_RETRY_MS`, the standing report, `expiryReportStands` and `standingThrough` (what a standing report keeps through every answer that ends no attempt) |
| `server/src/coord/expireArchived.ts` | 8, 9 | the `restart` outcome and its feed row; the `expired` outcome carries `kept`; the feed row says what was kept |
| `shared/api.ts` | 9 | `ExpiryAttention.kind` gains `'kept'` (one line, in place) |
| `pwa/src/fleet/expiryWords.ts` | 9 | `kept: 'cleaned up, kept'` (the `Record` makes it a compile error to omit) |
| `ccd/ccd` | 11 | `_ws_expire_locked`: the branch-state agreement check after the pin |
| `server/test/ccd-ws-expire-consent-branch.test.ts` (new) | 11 | the in-lock window, both directions, and two controls |
| tests: `dead-coordinator-lane`, `dead-coordinator-policy`, `end-dead-coordinator`, `sweep-close`, `lifecycle-mirror`, `archived-expiry-policy`, `archived-expiry-lane`, `expire-archived`, `dead-coordinator-prose`, `expiry-lane-prose` | 1–12 | the cases below |
| `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` | 7, 12 | §5.4's "What follows" bullet (F5, measured), "As wave 5 corrects the lane" (with the accepted abstention); §5.3's "As wave 5 closes the lane's follow-ups" |
| `README.md` | 7, 12 | one sentence in the dead-coordinator paragraph; two in the expiry paragraph |
| `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md` | 7 | F6, F7, F8, F10, F11, F12 |

## Measured while planning

Everything below was measured on a prototype of this plan at `origin/main` `b0647d850` (wave 4 at `669b83055` and CCR-15 wave 6 at `b0647d850`), and the revision after the coordinator's rulings of 2026-10-08 (R1–R5) re-measured on a prototype at `origin/main` `226bb881c` (two docs-only commits past `b0647d850`: CCR-15's wave-7 plan, contract and ledger), in an isolated worktree, one test file per process, `TMPDIR` on the volume outside the checkout, `CCD_DISK_FLOOR_GB=1`, load average 10–13. The prototype was then reverted: only this file is committed.

1. **B1's census — every `ws-expire` producer of `{"failed":"state-changed"}`, with its position against the breadcrumb.** Read off ccd/ccd at `b0647d850`:

   | Where | What it prints | Reached by an expiry? | Before the `expire:` breadcrumb? |
   |---|---|---|---|
   | `_ws_expire_locked`, its verdict point (`_reap_refuse state-changed "expected $REAP_TOKEN, was given $token …"`) | `{"refused":"state-changed",…}` at exit 0 — a REFUSAL, not a failure | yes | yes (no intent journaled yet) |
   | `_ws_expire_resume_eval` (`_reap_refuse state-changed "$id was archived again …"`) | `{"refused":"state-changed",…}`, through the same verdict point | yes (resumed arm) | the breadcrumb of the EARLIER attempt stands; this attempt prints at its verdict point, before anything |
   | `_ws_reclaim_locked`, after its pin (`_ws_reclaim_fail "$id" "$lctx" state-changed …`) | `{"failed":"state-changed",…}` at exit 1 | **no** — ws-reclaim's own verb | before its own tombstone and breadcrumb |
   | the shared tail `_ws_reclaim_tail` | none (its `_ws_reclaim_fail` words: 15 `worktree-remove-failed`, 8 `pin-failed`, 5 `tombstone-unwritable`, 4 `unit-still-active`, 4 `branch-moved`, 3 `branch-elsewhere`, 1 each of `branch-unmeasured`, `purge-incomplete`, `purge-mechanism-absent`, `purge-refused`, `reaping-phase-unknown`) | — | — |

   So at `b0647d850` an expiry can print NO `failed` `state-changed`: the parser's `resumable: true` for that word was unreachable. Task 11 adds the one producer, on the fresh arm, after the pin and before the tombstone and the breadcrumb. Task 8's census places every non-comment occurrence of either word in ccd/ccd — ten at `b0647d850`: ws-audit's `journal` row (`_lc_fail reclaim … probe-unmeasured`), six `refused` sites (`_ws_reap_locked` twice, `_ws_reap_tail`, `_ws_reclaim_locked`, `_ws_expire_resume_eval`, `_ws_expire_locked`) and three `failed` ones (`_ws_reclaim_locked`'s two, `_ws_expire_locked`'s `probe-unmeasured`) — and Task 11 adds the eleventh. Any other spelling reads `unplaced` and reds (rows T8.2–T8.4; the review's safety lens measured the drafted, spelling-based census green on four of them).

   **The resumed arm (the known gap).** `_ws_expire_locked` prints `probe-unmeasured` at its verdict point, before `if [[ -z "$phase" ]]`, so on every arm. On a resumed expiry `_ws_expire_fork` runs `_ws_expire_resume_eval`, whose `_ws_reclaim_unmeasured` exits (the tombstone's archive epoch, worktree or workdir unreadable; `whether $(_tmux "$id") is up could not be asked`) reach that point after the earlier attempt's breadcrumb. `parseExpireResult` reads it final, as `main` does. Read, not changed here: routed to this programme's wave 6 (the header), an arming blocker for the expiry lane until then. `pin-failed` (the fresh pin's, plus eight in the tail) and `tombstone-unwritable` (the fresh arm's, plus five in the tail) print after the breadcrumb too, so they stay resumable (the ruling's default, measured here).

2. **The in-lock window, measured at `b0647d850` (Task 11's mutation row T11.1 is this base behaviour).** With the agreement check absent, a branch DELETED between the recompute and the pin's read expires (exit 0, `{"expired":…}`), and a branch MADE in that window expires too — and the tail deletes that new branch at the tip the pin read (its tip is pinned in the attic). CCR-15's §5.5 rule binds the consent in both directions on the reclaim side (`_ws_reclaim_locked`'s `!=`), so Task 11 closes both directions (the departure `expire-consent-binds-the-branch-both-ways`; the ruling named the deleted direction). A deletion between the FRESH pin and the tail's SETTLE is left as CCR-15 wave 6 left it: the settle re-pins and the tail's step 5 reads the branch three ways, and a refusal there would print AFTER the breadcrumb, where the word Task 8 reads as "nothing started, start over" would be untrue (the census forbids it) — so no clean cover exists in this wave; the tip the fresh pin read is already in the attic.

3. **F5, in a fixture store (never live).** A probe (below) opened a run of programme `alpha` claimed by a crashed id, abandoned it through `closeRun`'s sweep arm (`causedBy: 'sweep'`), then reopened the programme as a revived coordinator would:
   - after the sweep's abandon the programme row reads `abandoned`, and `resolveCoordinator(null)` answers `null` (no active programme);
   - `openRun` under the fenced slug succeeds; the programme row STILL reads `abandoned`;
   - `GET /api/runs`' read (`CoordStore.runs()`) lists the new run (`[2, 'alpha', 'planned']`): the board carries no programme state, so the run shows as any open run;
   - `toId:'coordinator'` mail WITH the new run's `runId` resolves to its `claimedBy` (the revived id); WITHOUT a `runId` it resolves through "exactly one ACTIVE programme" — `null` (the route answers 404 `unknown-recipient`) while no other programme is active, and **the OTHER programme's coordinator** once one other programme is active (`resolveCoordinator(null)` answered `demo-coord-other`);
   - the row is NOT permanent: the next close that ends the programme's last open run rewrites it — an abandon left it `abandoned`; a later run closed `done` as the last open run set it to `done` (`store.ts`'s D-51 retirement check, `setProgramState(…, finalState === 'failed' ? 'abandoned' : 'done')`).
   So the spec gains three facts, not two (the departure `an-abandoned-programme-row-is-rewritten-only-by-a-last-close`), and the operator's question (f) — whether a new run should reset the row — has the mail consequence above.

   ```ts
   // The probe, run once as a throwaway server/test file and deleted (never committed).
   const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
   const r1 = coord.openRun({ program: 'alpha', title: 'alpha', project: 'demo', wave: 1, waveOf: 2, claimedBy: CRASHED });
   await closeRun({ coord, io, cfg, runCcd }, r1.id, { intent: 'abandon' }, 'sweep', { claimedBy: CRASHED, stillCrashed: async () => null });
   coord.programs();                    // alpha: 'abandoned'
   coord.resolveCoordinator(null);      // null
   const r2 = coord.openRun({ program: 'alpha', title: 'alpha again', project: 'demo', wave: 2, waveOf: 2, claimedBy: CRASHED });
   coord.programs();                    // alpha: still 'abandoned'
   coord.runs();                        // lists [2, 'alpha', 'planned']
   coord.resolveCoordinator(r2.id);     // CRASHED (the revived id)
   coord.openRun({ program: 'beta', title: 'beta', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-coord-other' });
   coord.resolveCoordinator(null);      // 'demo-coord-other' — another programme's coordinator
   // A third run of alpha carried to working and closed done as alpha's last open run:
   coord.closeRun({ runId: r3.id, finalState: 'done', causedBy: 'coordinator', handoffCommit: null, program: 'alpha', viaClosing: true });
   coord.programs();                    // alpha: 'done'
   ```

4. **The mirror's two shapes (the worker's open item 2).** (a) `drain` answers whether it read, and `run()` moves `lastOkAt` only when every planned read answered: one file, eleven lines; a single failed tick is absorbed (the last `lastOkAt` stands inside `staleAfterMs` = 15 s), a failure that persists three sweep intervals reads `stale` on `/api/fleet/health` and is the dead-coordinator lane's `hold` (it decides nothing). (b) Carrying an "unread generations" set on `LifecycleHealth` for the lane's clause to read as doubt: a new L0 wire field (`shared/api.ts`, one reader in the PWA's health card), the adapter in `endDeadCoordinator.ts`, and a threshold constant — three files and a wire change, and a transient failure would delete anchors (an untrusted journal is `unmeasured`, which deletes them under ruling E). **(a) is the smaller and the truthful one** (the departure `an-unread-generation-is-no-successful-sweep`). The other readers of `lifecycleHealth()` are `server.ts`'s `/api/fleet/health` and the lane; nothing else gates on it.

5. **What CCR-15 wave 6 (#326) landed for this programme, read at `b0647d850`.** `_ws_expire_cwd_users` resolves its parent through the shared helper — `_ws_dir_physical "$parent" && preal="$_WS_PHYS" \` (ccd/ccd:30649) — so the newline fail-open ARMING BLOCKER is cleared on `main` (check the merged lines again before arming). The tail's stdout document carries `"clipsKept":%s,"tmpRootKept":%s`, each printed by a `case` over `refused|unmeasured|in-use` (any other value prints `"unmeasured"`; only an empty value prints `null`; ccd/ccd:30115-30120). An older ccd omits both keys.

6. **The citation census, after the whole prototype** (`cite-remeasure.py`, extracted from `docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md` as earlier plans do, read-only against `origin/main`): `byFile['ccd/ccd'] stated 147 base 147 tree 147`; `total stated 197 base 197 tree 197`; `other byFile keys moved: none`; `row array 54/54/54`, `site array 35/35/35`, nothing ENTERED or LEFT. `ccd-reg-get-census` `3 passed (3)`. The five citation cases `5 passed | 330 skipped (335)`.

7. **The replay.** The 132 blocks below, applied to `origin/main` `226bb881c` in the order given (each task's test blocks, then its source blocks, then its docs blocks), each matching exactly once at its turn, reproduce the revised prototype byte for byte in all 25 files it touches (`ccd/ccd` re-stamped: `sha256=940c0208…fc3b`) — in one pass, and again task by task, each task's test blocks measured red and then its source and docs blocks measured green, every mutation row of Tasks 8–11 measured at its own stage. (The drafted plan's 119 blocks had been replayed the same way on `b0647d850`, and again after the four review lenses.) The revision after the act-safety lens on `0459dcb73` — a standing entry kept through every answer that ends no attempt — changed the text of Task 10's blocks 113, 115, 118, 120 (widened to the four arms it touches) and 123 and Task 12's 129–132, added no block, and was replayed the same way on `226bb881c`: in one pass and stage by stage, byte-identical in all 25 files (the same `ccd/ccd` stamp); Task 10 red `1 failed | 57 passed (58)` and `1 failed | 32 passed (33)`, green `58 passed (58)` and `33 passed (33)`, all fourteen of its mutation rows red at its stage; Task 12 red `2 failed | 8 passed (10)`, green `10 passed (10)`.

## How to read the blocks

Each edit is a block headed by an HTML comment. A **replace** (`<!-- replay: replace <path> -->`) names its file (an `In <path>, find:` line), shows the text to find — whole lines, occurring EXACTLY ONCE in the file at that point of the plan (earlier blocks already applied) — and the text that replaces it; a block that only adds lines quotes its anchor line(s) in both halves. A **create** (`<!-- replay: create <path> -->`) shows a whole new file. A **fragment** (`<!-- replay: fragment <path> -->`) shows a PART of one line, occurring exactly once in the file, and the text that replaces that part: used for the wave-4 plan's two ledger entries (a whole column-0 entry line quoted here would be read by `deviation-refs.test.ts` as a second definition of its number) and for that plan's long table rows and callout lines, where only a phrase changes. A block's text is the lines between its fences and ends with a newline (a fragment's, without one). Apply the blocks in the order given: Step 1 of each task holds its test edits (the red stage), Step 3 its source edits (the green stage), and a docs step where it has one. The replay check applied exactly these 132 blocks to `origin/main` `226bb881c` in one pass, and again stage by stage (each task's test blocks, measured red; then its source and docs blocks, measured green), and reproduced the prototype byte for byte in every file the plan touches (25 files; `ccd/ccd` re-stamped).

**Model routing** follows the fleet's policy: `sonnet` for implementation from these blocks, `opus` for each task's review under the act-safety lens and for the whole-branch review; never `fable` unless the operator names it.

---

### Task 1: The lane's wiring of the act's own clock has a red (review 339, F1 — an ARMING BLOCKER)

**Model routing:** `sonnet`, effort `medium` — one lane case; the code is already right, and the case pins it.

**Files:** test `server/test/dead-coordinator-lane.test.ts`. No source change.

**Interfaces:** none change. `deadCoordinatorAct` (watch.ts) hands the executor `now: (): number => Date.now()`; review 339 measured that mutating it to the pass's instant (`now: (): number => now`) left the lane suite green (`28 passed (28)`), so the one live caller could hand the executor the stale pass clock again and nothing would red. Once armed, that regression would close a RESTARTING coordinator's runs: its heartbeat, stamped after the pass's instant, reads as a future stamp, so it reads `orphan`.

- [ ] **Step 0: Install each package's own modules, and the scratch directory**

```bash
( cd server && npm ci ) && ( cd agent && npm ci ) && ( cd pwa && npm ci )
mkdir -p <the volume's mount>/scratch-<run>-tmp   # OUTSIDE every git checkout; export TMPDIR to it, and CCD_DISK_FLOOR_GB=1
```

- [ ] **Step 1: The case.** The pass measures the claimant crashed at its own instant; inside the serialiser, before the act's first re-measure, three seconds pass and the supervisor beats (a stamp after the pass's instant, not after the act's). Fresh, the re-measure reads `restarting` — alive — and the act stops before any fleet act.

<!-- replay: replace server/test/dead-coordinator-lane.test.ts -->
In `server/test/dead-coordinator-lane.test.ts`, find (block 1):

````ts
  it('an act that THROWS after closing a programme keeps that programme’s feed row, and the attention entry says what closed', async () => {
````

Replace with:

````ts
  it('the act re-measures at ITS OWN instant: a heartbeat stamped after the pass measured is a restarting coordinator — nothing ends (review 339, F1)', async () => {
    let beat = false;
    const f: Fixture = await fixture({ beforeAct: () => {
      if (!beat) return;
      // The pass measured A crashed at its own instant. Three seconds later, inside the serialiser and before the act's
      // first re-measure, A's supervisor beats: a stamp AFTER the pass's instant and not after the act's.
      f.advance(3000);
      writeFileSync(path.join(f.reg, `${A}.supervised`), String(Math.floor(Date.now() / 1000)));
    } });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    beat = true;
    f.next(); await f.pass();
    expect(f.acts(), 'the act was asked').toBe(1);
    expect(f.stateOf(r), 'restarting is no crash: the run stays open').toBe('working');
    expect(f.calls, 'nothing composed on the box').toEqual([]);
    expect(f.anchorOf(A), 're-measured restarting — evidence: the anchor goes').toBeNull();
  });

  it('an act that THROWS after closing a programme keeps that programme’s feed row, and the attention entry says what closed', async () => {
````

- [ ] **Step 2: Run — green (the code is right); the red is the mutation.**

```bash
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-lane.test.ts --maxWorkers=1 )
```

Measured: `29 passed (29)`.

- [ ] **Step 3: The mutation row — it must red.**

| Row | Mutation | Red |
|---|---|---|
| T1.1 | `server/src/watch.ts`: `      now: (): number => Date.now(),` → `      now: (): number => now,` | `dead-coordinator-lane.test.ts`: `1 failed \| 28 passed (29)` — the act re-measures at ITS OWN instant: a heartbeat stamped after the pass measured is a restarting coordinator — nothing ends (review 339, F1) (`expected 'failed' to be 'working'`) |

Restore the line byte for byte and re-run green.

- [ ] **Step 4: Commit.**

```bash
git add server/test/dead-coordinator-lane.test.ts
git commit -m "test(lifecycle): the lane's wiring of the act's fresh clock is pinned (review 339, F1)"
```

---

### Task 2: A reading that ends the episode forgets the last recorded outcome (review 339, F2 — an ARMING BLOCKER)

**Model routing:** `sonnet`, effort `medium`.

**Files:** `server/src/deadCoordinator.ts` (`deadCoordinatorSighted`); tests `server/test/dead-coordinator-policy.test.ts`, `server/test/dead-coordinator-lane.test.ts`.

**Interfaces:** `deadCoordinatorSighted(e, c, nowMs)` keeps its signature. A reading that is not `crashed` — `alive`, `stopped`, `deliberate`, `unmeasured`, `unmeasurable`, each of which deletes the anchor (ruling E) — now also sets `lastOutcome: null`, so the lane's "write a feed row when the outcome CHANGES" guard writes the second episode's `would-end` row. A `crashed` reading keeps it. Review 339 measured the gap: in shadow, crash → revive → crash wrote NO second "programme would be ended" row (`deadCoordinatorSighted` kept `lastOutcome`, and the second episode's `would-end:<slug>=<runIds>` key equalled it), and that durable row is spec §9's instrument and the operator's arming evidence.

- [ ] **Step 1: The tests (red).** A policy case (every episode-ending reading forgets the outcome; a crashed one keeps it) and a lane case (crash, revive, crash in shadow: two feed rows). The lane case moves the clock one cadence (`f.next()`) before the second hour: a pass inside the cadence window is skipped.

<!-- replay: replace server/test/dead-coordinator-policy.test.ts -->
In `server/test/dead-coordinator-policy.test.ts`, find (block 2):

````ts
  it('unmeasured IS a report, kept with its first instant until a pass can tell; stuck stands until its runs move', () => {
````

Replace with:

````ts
  it('a reading that ENDS the episode forgets the last recorded outcome, so a second episode is recorded again (review 339, F2)', () => {
    let e = deadCoordinatorSighted(deadCoordinatorEntry(), { kind: 'crashed', cause: 'orphan' }, NOW);
    e = deadCoordinatorNextEntry(e, { kind: 'would-end', programmes: [{ slug: 'p', runIds: [1] }] }, 'orphan', NOW, NOW, PASS);
    expect(e.lastOutcome, 'the CONTROL: the shadow record is remembered').toBe('would-end:p=1');
    expect(deadCoordinatorSighted(e, { kind: 'crashed', cause: 'orphan' }, NOW + PASS).lastOutcome, 'a crashed pass keeps it').toBe('would-end:p=1');
    for (const c of [{ kind: 'alive', why: 'x' }, { kind: 'stopped' }, { kind: 'deliberate', act: 'stop' },
      { kind: 'unmeasured', why: 'w' }, { kind: 'unmeasurable', why: 'u' }] as const) {
      expect(deadCoordinatorSighted(e, c, NOW + PASS).lastOutcome, c.kind).toBeNull();
    }
  });

  it('unmeasured IS a report, kept with its first instant until a pass can tell; stuck stands until its runs move', () => {
````

<!-- replay: replace server/test/dead-coordinator-lane.test.ts -->
In `server/test/dead-coordinator-lane.test.ts`, find (block 3):

````ts
  it('with the live file, the programme is ENDED after the hour and two crashed passes — failed, by the sweep, one row per programme', async () => {
````

Replace with:

````ts
  it('a coordinator that crashes, is revived and crashes again is recorded TWICE in shadow — one row per episode (review 339, F2)', async () => {
    const f = await fixture();
    f.plant(A);
    f.working(A, 'alpha');
    await anHourDead(f);
    const rows = () => f.feed().filter(([, t]) => t === 'dead coordinator: programme would be ended');
    expect(rows(), 'the first episode').toHaveLength(1);
    f.live.add(A);
    f.next(); await f.pass();                      // revived: the episode ends, and its anchor with it
    expect(f.anchorOf(A)).toBeNull();
    f.live.delete(A);                              // and it crashes again
    f.next(); await anHourDead(f);
    expect(rows(), 'the second episode is the operator’s arming evidence too').toHaveLength(2);
  });

  it('with the live file, the programme is ENDED after the hour and two crashed passes — failed, by the sweep, one row per programme', async () => {
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-lane.test.ts --maxWorkers=1 )
```

Measured: `dead-coordinator-policy.test.ts`: `1 failed | 39 passed (40)` — × a reading that ENDS the episode forgets the last recorded outcome, so a second episode is recorded again (review 339, F2); `dead-coordinator-lane.test.ts`: `1 failed | 29 passed (30)` — × a coordinator that crashes, is revived and crashes again is recorded TWICE in shadow — one row per episode (review 339, F2).

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 4):

````ts
/** One pass's reading, folded into memory: a crashed pass extends the run (and ends an `unmeasured` report — the lane
 *  can tell now); anything else ends it, and the report goes with it — save `unmeasured`, which IS a report, and
 *  `stuck`, which stands until the runs move. */
````

Replace with:

````ts
/** One pass's reading, folded into memory: a crashed pass extends the run (and ends an `unmeasured` report — the lane
 *  can tell now); anything else ends it, and the report goes with it — save `unmeasured`, which IS a report, and
 *  `stuck`, which stands until the runs move. Anything else also ENDS THE EPISODE (its anchor is deleted, ruling E), so
 *  the last recorded outcome goes too: a coordinator that crashes, is revived and crashes again is a second episode,
 *  and its shadow record is written again (review 339, F2). */
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 5):

````ts
  return { ...e, crashedPasses: 0, report };
}
````

Replace with:

````ts
  return { ...e, crashedPasses: 0, report, lastOutcome: null };
}
````

- [ ] **Step 4: Run — green.** Same two commands. Measured: `40 passed (40)`; `30 passed (30)`.

- [ ] **Step 5: The mutation row.**

| Row | Mutation | Red |
|---|---|---|
| T2.1 | `server/src/deadCoordinator.ts`: `  return { ...e, crashedPasses: 0, report, lastOutcome: null };` → `  return { ...e, crashedPasses: 0, report };` | `dead-coordinator-policy.test.ts`: `1 failed \| 39 passed (40)` — a reading that ENDS the episode forgets …<br>`dead-coordinator-lane.test.ts`: `1 failed \| 29 passed (30)` — a coordinator that crashes, is revived and crashes again is recorded TWICE in shadow |

- [ ] **Step 6: Commit.** `git add` the three files; `fix(lifecycle): a second crash is a second shadow record (review 339, F2)`.

---

### Task 3: A release and a re-hold are two acts, and two words (review 339, F3 — an ARMING BLOCKER)

**Model routing:** `sonnet`, effort `high` — a wire-shaped union changes at a seam, and the operator's words follow it.

**Files:** `server/src/coord/close.ts` (`CloseOutcome`'s `sweep-stopped`, `closeRun`'s sweep arm), `server/src/coord/routes.ts` (the `sweep-stopped` 409 body), `server/src/coord/endDeadCoordinator.ts`, `server/src/deadCoordinator.ts`, `server/src/watch.ts` (the throw's progress literal); tests `server/test/sweep-close.test.ts`, `server/test/end-dead-coordinator.test.ts`, `server/test/dead-coordinator-policy.test.ts`.

**Interfaces:**
- `deadCoordinator.ts` (L1) declares the two fleet-act words ONCE: `export const SWEEP_FLEET_ACTS = ['released', 're-held'] as const; export type SweepFleetAct = typeof SWEEP_FLEET_ACTS[number];` and `isDeadCoordinatorKebab` admits them (`mail-routes.test.ts` scans every quoted kebab token in `server/src/coord`, and `close.ts` now spells `'re-held'` — measured: without the declaration that scan reds, row T3.6).
- `CloseOutcome`'s `{ ok: false; kind: 'sweep-stopped'; stop; released: boolean }` becomes `{ …; fleetAct: SweepFleetAct | null }`: `null` before any fleet act, `'released'` after a `ws-release`, `'re-held'` after a `ws-hold` under a surviving run's reason. (`null` has one meaning here: no fleet act ran.)
- `DeadCoordinatorActOutcome`'s `ended` arm gains `reheld?: DeadCoordinatorProgramme[]` beside `released?`; `DeadCoordinatorProgress` gains `reheld` (required). The executor pushes by the act that ran. The feed row and the attention sentence word a released worker as "released and unheld until its coordinator re-holds it" and a re-held one as "re-held under a surviving run and stays claimed" — review 339 measured the old text saying "was released and is unheld …" after a re-hold, which is false.
- **Only `sweep-stopped` carries `fleetAct`.** After the fleet act `closeRun` can still refuse `claimant-changed` or `advanceFailed` (close.ts's sweep arm), and neither carries it: both need a write to the run between this serialiser's read and its commit, and `reclaimProgram`, the one rewriter of `claimedBy`, and every advance run behind the same `CoordMutex` (close.ts's own comment at that arm says so for the first). Not reachable in this build, so not widened here; a run writer added outside the serialiser would have to carry the act on those two arms too.
- The 409 body of `POST /api/runs/:id/close` names `fleetAct` in place of `released`. No route can produce `sweep-stopped` (only the lane's `withSweepAbandon` reaches the sweep arm); the switch over `CloseOutcome` is exhaustive, so its arm changes with the union (the departure `sweep-stopped-names-the-fleet-act`).

- [ ] **Step 1: The tests (red).** Four existing `sweep-close` assertions name the new field (`released: false` → `fleetAct: null`, `released: true` → `fleetAct: 'released'`); a new `sweep-close` case re-holds (a second open run on the same workspace, another programme's) and a revive lands after the hold; an executor case carries `reheld`, never `released`; the stop-before case also has no `reheld`; a policy case words a re-hold; and the throw's progress literal in the policy case gains `reheld: []`.

<!-- replay: replace server/test/sweep-close.test.ts -->
In `server/test/sweep-close.test.ts`, find (block 6):

````ts
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', revived)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }, released: false });
````

Replace with:

````ts
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', revived)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }, fleetAct: null });
````

<!-- replay: replace server/test/sweep-close.test.ts -->
In `server/test/sweep-close.test.ts`, find (block 7):

````ts
      stop: { kind: 'remeasured', why: 're-measured alive' }, released: true });
````

Replace with:

````ts
      stop: { kind: 'remeasured', why: 're-measured alive' }, fleetAct: 'released' });
````

<!-- replay: replace server/test/sweep-close.test.ts -->
In `server/test/sweep-close.test.ts`, find (block 8):

````ts
    expect(await closeRun(b.deps, r.id, { intent: 'abandon' }, 'sweep', revived)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }, released: false });
````

Replace with:

````ts
    expect(await closeRun(b.deps, r.id, { intent: 'abandon' }, 'sweep', revived)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }, fleetAct: null });
````

<!-- replay: replace server/test/sweep-close.test.ts -->
In `server/test/sweep-close.test.ts`, find (block 9):

````ts
      .toMatchObject({ ok: false, kind: 'sweep-stopped', released: false });
````

Replace with:

````ts
      .toMatchObject({ ok: false, kind: 'sweep-stopped', fleetAct: null });
````

<!-- replay: replace server/test/sweep-close.test.ts -->
In `server/test/sweep-close.test.ts`, find (block 10):

````ts
  it('THE RE-MEASURE, for a run with NO session (planned, never dispatched): a revive of the SAME id keeps it open — nothing is acted on', async () => {
````

Replace with:

````ts
  it('THE RE-MEASURE, after a RE-HOLD: the stop says the worker was re-held under the surviving run — not released (review 339, F3)', async () => {
    let held = false;
    const b = build((verb) => { if (verb === 'ws-hold') held = true; });
    const id = b.working();
    // A second open run on the same workspace, another programme's: it survives the abandon, so the arm re-holds.
    const s = b.coord.openRun({ program: 'q', title: 'q', project: 'demo', wave: 1, waveOf: 2, claimedBy: HEIR });
    if (!('id' in s)) throw new Error('openRun refused');
    b.coord.markDispatched(s.id, W, W, `ws/${W}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(b.coord.advance(s.id, to, 'coordinator').ok).toBe(true);
    const guard: SweepCloseGuard = { claimedBy: CRASHED,
      stillCrashed: async () => (held ? { kind: 'remeasured', why: 're-measured alive' } : null) };
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', guard)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive' }, fleetAct: 're-held' });
    expect(b.calls.map((c) => c[0]), 'the CONTROL: the fleet act was a hold, not a release').toEqual(['ws-hold']);
    expect(okRun(b.coord.run(id))!.state).toBe('working');
  });

  it('THE RE-MEASURE, for a run with NO session (planned, never dispatched): a revive of the SAME id keeps it open — nothing is acted on', async () => {
````

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 11):

````ts
  it('a stop BEFORE the fleet act released nothing: no `released` at all', async () => {
````

Replace with:

````ts
  it('a revive after a RE-HOLD is carried as re-held, never as released (review 339, F3)', async () => {
    let held = 0;
    const r = await rig({ onVerb: (v) => { if (v === 'ws-hold') held = 1; },
      verdict: () => (held === 1 ? { verdict: 'live' } : { verdict: 'gone' }) });
    const a = r.working('alpha', 'demo-w1');
    // ANOTHER open run on the same workspace — another programme's, under another coordinator — survives the abandon,
    // so the arm hands the claim over with `ws-hold` under that run's reason instead of releasing.
    const s = r.coord.openRun({ program: 'gamma', title: 'gamma', project: 'demo', wave: 1, waveOf: 2, claimedBy: HEIR });
    if (!('id' in s)) throw new Error('openRun refused');
    r.coord.markDispatched(s.id, 'demo-w1', 'demo-w1', 'ws/demo-w1', false);
    for (const to of ['dispatched', 'working'] as const) expect(r.coord.advance(s.id, to, 'coordinator').ok).toBe(true);
    const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
    expect(out).toMatchObject({ kind: 'ended', programmes: [], reheld: [{ slug: 'alpha', runIds: [a] }], stoppedBy: { kind: 'remeasured' } });
    expect(out, 'nothing was released').not.toHaveProperty('released');
    expect(r.calls.map((c) => c[0]), 'the CONTROL: the fleet act was a hold').toEqual(['ws-hold']);
    expect(r.stateOf(a)).toBe('working');
  });

  it('a stop BEFORE the fleet act released nothing: no `released` at all', async () => {
````

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 12):

````ts
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).not.toHaveProperty('released');
````

Replace with:

````ts
    const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
    expect(out).not.toHaveProperty('released');
    expect(out).not.toHaveProperty('reheld');
````

<!-- replay: replace server/test/dead-coordinator-policy.test.ts -->
In `server/test/dead-coordinator-policy.test.ts`, find (block 13):

````ts
    const t = deadCoordinatorThrew(e, 'SQLITE_FULL', NOW, PASS, { closed: [{ slug: 'alpha', runIds: [7] }], released: [], stop: null });
````

Replace with:

````ts
    const t = deadCoordinatorThrew(e, 'SQLITE_FULL', NOW, PASS, { closed: [{ slug: 'alpha', runIds: [7] }], released: [], reheld: [], stop: null });
````

<!-- replay: replace server/test/dead-coordinator-policy.test.ts -->
In `server/test/dead-coordinator-policy.test.ts`, find (block 14):

````ts
  it('an act that FAILED part-way keeps the rows of what it had closed, and says it failed', () => {
````

Replace with:

````ts
  it('a RE-HELD worker is worded as re-held and still claimed — never as released and unheld (review 339, F3)', () => {
    const o = { kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [7] }], stuck: [], reheld: [{ slug: 'alpha', runIds: [7] }],
      stoppedBy: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' } } as const;
    const rows = deadCoordinatorFeedRows('demo-coord', o, NOW);
    expect(rows).toEqual([{ title: 'dead coordinator: programme partly ended',
      body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; programme alpha was NOT ended: '
        + '0 of 1 run closed failed and 1 stay open — the act stopped: re-measured alive: tmux reports the pane live; '
        + 'run 7\'s worker was re-held under a surviving run and stays claimed.' }]);
    expect(rows[0]!.body).not.toMatch(/released|unheld/);
    const n = deadCoordinatorNextEntry({ ...deadCoordinatorEntry(), crashedPasses: 3 }, o, 'orphan', NOW, NOW, PASS);
    expect(n.report, 'a re-hold alone is news: the act did something').toMatchObject({ kind: 'stuck', runs: [] });
    const sentence = deadCoordinatorReportSentence('demo-coord', n.report!);
    expect(sentence).toContain('re-held the worker of run 7 of programme alpha under a surviving run (it stays claimed)');
    expect(sentence).not.toMatch(/released|unheld/);
  });

  it('an act that FAILED part-way keeps the rows of what it had closed, and says it failed', () => {
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/sweep-close.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/end-dead-coordinator.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-policy.test.ts --maxWorkers=1 )
```

Measured: `sweep-close.test.ts`: `5 failed | 8 passed (13)` — × THE RE-MEASURE, before the fleet act …; × … after the fleet act and before the commit …; × … after a RE-HOLD …; × … for a run with NO session …; × runs the abandon arm with causedBy sweep and the compare-and-set …; `end-dead-coordinator.test.ts`: `1 failed | 21 passed (22)` — × a revive after a RE-HOLD is carried as re-held, never as released (review 339, F3); `dead-coordinator-policy.test.ts`: `1 failed | 40 passed (41)` — × a RE-HELD worker is worded as re-held and still claimed — never as released and unheld (review 339, F3).

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 15):

````ts
      readonly released?: readonly DeadCoordinatorProgramme[];
````

Replace with:

````ts
      readonly released?: readonly DeadCoordinatorProgramme[];
      /** The runs whose worker the act RE-HELD under a surviving run's reason (another open run claims the workspace)
       *  and whose run it then left open — the worker stays claimed. Absent when the act re-held none. */
      readonly reheld?: readonly DeadCoordinatorProgramme[];
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 16):

````ts
/** What an act DID before it stopped or failed, for the attention list: the runs it closed failed (by programme), the
 *  workers it released (their runs stay open), and why it stopped (`null`: it threw, and which run moved is unknown). */
export interface DeadCoordinatorProgress {
  readonly closed: readonly DeadCoordinatorProgramme[];
  readonly released: readonly DeadCoordinatorProgramme[];
````

Replace with:

````ts
/** What an act DID before it stopped or failed, for the attention list: the runs it closed failed (by programme), the
 *  workers it released and those it re-held under a surviving run (their runs stay open), and why it stopped (`null`:
 *  it threw, and which run moved is unknown). */
export interface DeadCoordinatorProgress {
  readonly closed: readonly DeadCoordinatorProgramme[];
  readonly released: readonly DeadCoordinatorProgramme[];
  readonly reheld: readonly DeadCoordinatorProgramme[];
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 17):

````ts
      const released = o.released ?? [];
      const after: DeadCoordinatorProgress | undefined = o.stoppedBy !== null && (o.programmes.length > 0 || released.length > 0)
        ? { closed: o.programmes, released, stop: o.stoppedBy.why } : undefined;
````

Replace with:

````ts
      const released = o.released ?? [];
      const reheld = o.reheld ?? [];
      const after: DeadCoordinatorProgress | undefined = o.stoppedBy !== null
        && (o.programmes.length > 0 || released.length > 0 || reheld.length > 0)
        ? { closed: o.programmes, released, reheld, stop: o.stoppedBy.why } : undefined;
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 18):

````ts
      // A programme with a closed run, then one the act only RELEASED a worker of: its record is the same fact — the
      // programme is NOT ended, and its worker is unheld.
      const released = o.released ?? [];
      const slugs = [...o.programmes, ...released.filter((r) => !o.programmes.some((p) => p.slug === r.slug))];
````

Replace with:

````ts
      // A programme with a closed run, then one the act only RELEASED or RE-HELD a worker of: its record is the same
      // fact — the programme is NOT ended — and says which act ran on that worker.
      const released = o.released ?? [];
      const reheld = o.reheld ?? [];
      const slugs = [...o.programmes];
      for (const r of [...released, ...reheld]) if (!slugs.some((p) => p.slug === r.slug)) slugs.push(r);
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 19):

````ts
        const rel = released.find((x) => x.slug === s.slug)?.runIds ?? [];
        const base = o.failed !== undefined ? `the act then failed: ${o.failed}`
          : o.stoppedBy !== null ? `the act stopped: ${o.stoppedBy.why}` : 'the abandon arm could not move the rest';
        const why = rel.length === 0 ? base
          : `${base}; ${rel.map((id) => `run ${id}'s worker`).join(', ')} ${rel.length === 1 ? 'was' : 'were'} released and `
            + `${rel.length === 1 ? 'is' : 'are'} unheld until its coordinator re-holds it`;
````

Replace with:

````ts
        const rel = released.find((x) => x.slug === s.slug)?.runIds ?? [];
        const reh = reheld.find((x) => x.slug === s.slug)?.runIds ?? [];
        const base = o.failed !== undefined ? `the act then failed: ${o.failed}`
          : o.stoppedBy !== null ? `the act stopped: ${o.stoppedBy.why}` : 'the abandon arm could not move the rest';
        const workers = (ids: readonly number[]): string => `${ids.map((id) => `run ${id}'s worker`).join(', ')} ${ids.length === 1 ? 'was' : 'were'}`;
        const parts = [base];
        if (rel.length > 0) parts.push(`${workers(rel)} released and ${rel.length === 1 ? 'is' : 'are'} unheld until its coordinator re-holds it`);
        if (reh.length > 0) parts.push(`${workers(reh)} re-held under a surviving run and ${reh.length === 1 ? 'stays' : 'stay'} claimed`);
        const why = parts.join('; ');
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 20):

````ts
  for (const x of p.released) {
    parts.push(`released the worker of run ${x.runIds.join(', ')} of programme ${x.slug} (it is unheld until its coordinator re-holds it)`);
  }
````

Replace with:

````ts
  for (const x of p.released) {
    parts.push(`released the worker of run ${x.runIds.join(', ')} of programme ${x.slug} (it is unheld until its coordinator re-holds it)`);
  }
  for (const x of p.reheld) {
    parts.push(`re-held the worker of run ${x.runIds.join(', ')} of programme ${x.slug} under a surviving run (it stays claimed)`);
  }
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 21):

````ts
export const SWEEP_STOPPED = 'sweep-stopped';
````

Replace with:

````ts
export const SWEEP_STOPPED = 'sweep-stopped';

/** WHICH fleet act the sweep's abandon ran before an in-arm stop (`sweep-stopped.fleetAct`, `coord/close.ts`): the
 *  worker RELEASED (nothing else claimed the workspace — unheld until its coordinator re-holds it) or RE-HELD under a
 *  surviving run's reason (still claimed). Two acts, two words (review 339, F3). Spelled here, once. */
export const SWEEP_FLEET_ACTS = ['released', 're-held'] as const;
export type SweepFleetAct = typeof SWEEP_FLEET_ACTS[number];
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 22):

````ts
  return v === CLAIMANT_CHANGED || v === SWEEP_STOPPED || own(DEAD_COORDINATOR_OUTCOME_KINDS) || own(DEAD_COORDINATOR_REPORT_KINDS);
````

Replace with:

````ts
  return v === CLAIMANT_CHANGED || v === SWEEP_STOPPED || (SWEEP_FLEET_ACTS as readonly string[]).includes(v)
    || own(DEAD_COORDINATOR_OUTCOME_KINDS) || own(DEAD_COORDINATOR_REPORT_KINDS);
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find (block 23):

````ts
import type { DeadCoordinatorStop } from '../deadCoordinator.js';
````

Replace with:

````ts
import type { DeadCoordinatorStop, SweepFleetAct } from '../deadCoordinator.js';
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find (block 24):

````ts
   *  is no longer crashed, or that cannot be told, or the operator raised `reclaim-paused` or disarmed the lane.
   *  `released`: the stop came AFTER the fleet act, so the worker was released (or re-held) and the run stays open. */
  | { ok: false; kind: 'sweep-stopped'; stop: DeadCoordinatorStop; released: boolean };
````

Replace with:

````ts
   *  is no longer crashed, or that cannot be told, or the operator raised `reclaim-paused` or disarmed the lane.
   *  `fleetAct`: WHICH fleet act ran before the stop — `released` (nothing else claimed the workspace: it is unheld
   *  until its coordinator re-holds it) or `re-held` (a surviving run's reason now holds it: it stays claimed) — and
   *  `null` when the stop came before any fleet act. Two acts, two words: a boolean folded them (review 339, F3). */
  | { ok: false; kind: 'sweep-stopped'; stop: DeadCoordinatorStop; fleetAct: SweepFleetAct | null };
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find (block 25):

````ts
      if (stop !== null) return { ok: false, kind: 'sweep-stopped', stop, released: false };
````

Replace with:

````ts
      if (stop !== null) return { ok: false, kind: 'sweep-stopped', stop, fleetAct: null };
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find (block 26):

````ts
        if (stop !== null) return { ok: false, kind: 'sweep-stopped', stop, released: true };
````

Replace with:

````ts
        if (stop !== null) return { ok: false, kind: 'sweep-stopped', stop, fleetAct: release ? 'released' : 're-held' };
````

<!-- replay: replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find (block 27):

````ts
    case 'sweep-stopped': return reply.code(409).send({ ok: false, error: 'sweep-stopped', stop: r.stop, released: r.released });
````

Replace with:

````ts
    case 'sweep-stopped': return reply.code(409).send({ ok: false, error: 'sweep-stopped', stop: r.stop, fleetAct: r.fleetAct });
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 28):

````ts
  const released: { id: number; program: string }[] = [];
````

Replace with:

````ts
  const released: { id: number; program: string }[] = [];
  const reheld: { id: number; program: string }[] = [];
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 29):

````ts
      stuck, stoppedBy, ...(released.length === 0 ? {} : { released: byProgramme(released) }),
````

Replace with:

````ts
      stuck, stoppedBy, ...(released.length === 0 ? {} : { released: byProgramme(released) }),
      ...(reheld.length === 0 ? {} : { reheld: byProgramme(reheld) }),
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 30):

````ts
        // The stop came after the fleet act: the worker is released (or re-held) and its run stays open. A TYPED fact, so
        // the lane records it whether or not the act closed anything (`released` on the outcome).
        if (out.released) released.push(run);
````

Replace with:

````ts
        // The stop came after the fleet act: the worker is released, or re-held under a surviving run, and its run stays
        // open. A TYPED fact, carried as the act that ran, so the lane records it whether or not the act closed anything
        // (`released` or `reheld` on the outcome) and words each as what it is (review 339, F3).
        if (out.fleetAct === 'released') released.push(run);
        else if (out.fleetAct === 're-held') reheld.push(run);
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find (block 31):

````ts
        done !== null && done.programmes.length > 0 ? { closed: done.programmes, released: [], stop: null } : undefined));
````

Replace with:

````ts
        done !== null && done.programmes.length > 0 ? { closed: done.programmes, released: [], reheld: [], stop: null } : undefined));
````

- [ ] **Step 4: Run — green.** The three commands above, then `mail-routes.test.ts` and `dead-coordinator-lane.test.ts`, and `( cd server && ./node_modules/.bin/tsc --noEmit -p . )`. Measured: `13 passed (13)`; `22 passed (22)`; `41 passed (41)`; `59 passed (59)`; `30 passed (30)`; tsc rc 0.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T3.1 | `server/src/coord/close.ts`: `fleetAct: release ? 'released' : 're-held' };` → `fleetAct: 'released' };` | `sweep-close.test.ts`: `1 failed \| 12 passed (13)` — THE RE-MEASURE, after a RE-HOLD …<br>`end-dead-coordinator.test.ts`: `1 failed \| 21 passed (22)` — a revive after a RE-HOLD is carried as re-held … |
| T3.2 | `server/src/coord/endDeadCoordinator.ts`: `        else if (out.fleetAct === 're-held') reheld.push(run);` → `        else if (out.fleetAct === 're-held') released.push(run);` | `end-dead-coordinator.test.ts`: `1 failed \| 21 passed (22)` — a revive after a RE-HOLD … |
| T3.3 | `server/src/deadCoordinator.ts`: `        if (reh.length > 0) parts.push(` → `        if (reh.length < 0) parts.push(` | `dead-coordinator-policy.test.ts`: `1 failed \| 40 passed (41)` — a RE-HELD worker is worded as re-held … |
| T3.4 | `server/src/deadCoordinator.ts`: `  for (const x of p.reheld) {` → `  for (const x of [] as typeof p.reheld) {` | `dead-coordinator-policy.test.ts`: `1 failed \| 40 passed (41)` — the same case (the attention sentence) |
| T3.5 | `server/src/deadCoordinator.ts`: `(o.programmes.length > 0 \|\| released.length > 0 \|\| reheld.length > 0)` → `(o.programmes.length > 0 \|\| released.length > 0)` | `dead-coordinator-policy.test.ts`: `1 failed \| 40 passed (41)` — the same case (`a re-hold alone is news`) |
| T3.6 | `server/src/deadCoordinator.ts`: `  return v === CLAIMANT_CHANGED \|\| v === SWEEP_STOPPED \|\| (SWEEP_FLEET_ACTS as readonly string[]).includes(v)` → `  return v === CLAIMANT_CHANGED \|\| v === SWEEP_STOPPED` | `mail-routes.test.ts`: `1 failed \| 58 passed (59)` — every quoted kebab token in server/src/coord that looks like a code is declared (`re-held is not a declared … dead-coordinator word`) |

- [ ] **Step 6: Commit.** `fix(lifecycle): a stop after the fleet act says which act ran — released or re-held (review 339, F3)`.

---

### Task 4: Every thrown act writes a feed row (review 339, F13 — an ARMING BLOCKER)

**Model routing:** `sonnet`, effort `high`.

**Files:** `server/src/deadCoordinator.ts`, `server/src/coord/endDeadCoordinator.ts`, `server/src/watch.ts` (`deadCoordinatorAct`'s catch); tests `server/test/end-dead-coordinator.test.ts`, `server/test/dead-coordinator-policy.test.ts`, `server/test/dead-coordinator-lane.test.ts`.

**Interfaces:**
- The `ended` outcome gains `failedRun?: number`, set only with `failed`: the run whose abandon threw. The executor tracks the in-flight run (`current`) and the thrown outcome carries it.
- `deadCoordinatorThrewFeedRow(claimantId, done | null, error, since)` (L1) → `{ title: 'dead coordinator: act failed', body }`, naming the programmes closed (if any), the run whose abandon failed and that whether its worker was released or re-held before the failure is not known, and that nothing more is known. `recordDeadCoordinatorThrew` (the executor's file) records it.
- The lane's catch writes that row for EVERY thrown act — a `DeadCoordinatorActThrew` or any other throw (`done` null) — after the existing per-programme rows for what it closed. Review 339 measured the gap: an act whose abandon threw after its fleet act ran, having closed nothing, wrote no feed row; its only record was the in-memory `stuck` entry, which a restart loses. On a throw `released`/`reheld` are always empty (both are filled only on a `sweep-stopped`, which ends the loop without a throw), so the row names the failed run instead.

- [ ] **Step 1: The tests (red).** The executor's throw case gains `failedRun`; a policy case words the row three ways; a lane case makes the commit throw after the release (`coord.closeRun` replaced on the fixture store) and reads the row back from the coordination store (the durable record; the watcher's memory is what a restart drops); the backoff case counts one row per thrown act.

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 32):

````ts
      open: [{ slug: 'beta', runIds: [b] }], stuck: [], stoppedBy: null, failed: 'database or disk is full' });
````

Replace with:

````ts
      open: [{ slug: 'beta', runIds: [b] }], stuck: [], stoppedBy: null, failed: 'database or disk is full', failedRun: b });
````

<!-- replay: replace server/test/dead-coordinator-policy.test.ts -->
In `server/test/dead-coordinator-policy.test.ts`, find (block 33):

````ts
  deadCoordinatorNextEntry, deadCoordinatorReportSentence, deadCoordinatorSighted, deadCoordinatorSince,
````

Replace with:

````ts
  deadCoordinatorNextEntry, deadCoordinatorReportSentence, deadCoordinatorSighted, deadCoordinatorSince, deadCoordinatorThrewFeedRow,
````

<!-- replay: replace server/test/dead-coordinator-policy.test.ts -->
In `server/test/dead-coordinator-policy.test.ts`, find (block 34):

````ts
  it('an act that FAILED part-way keeps the rows of what it had closed, and says it failed', () => {
````

Replace with:

````ts
  it('an act that THREW gets ONE row naming what is known, whatever it had done — and that nothing more is known (review 339, F13)', () => {
    const none = deadCoordinatorThrewFeedRow('demo-coord', { kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [7] }],
      stuck: [], stoppedBy: null, failed: 'database or disk is full', failedRun: 7 }, 'database or disk is full', NOW);
    expect(none).toEqual({ title: 'dead coordinator: act failed',
      body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; the lane\'s act failed '
        + '(database or disk is full) before it closed any run; run 7\'s abandon is the one that failed, and whether its worker was '
        + 'released or re-held before the failure is not known. Nothing more is known about which runs or workspaces moved — '
        + 'check its runs on /runs. It is asked again only after a backoff.' });
    expect(deadCoordinatorThrewFeedRow('demo-coord', { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [6] }],
      open: [{ slug: 'beta', runIds: [7] }], stuck: [], stoppedBy: null, failed: 'x', failedRun: 7 }, 'x', NOW).body)
      .toContain('failed (x) after it closed failed 1 run of programme alpha; run 7\'s abandon is the one that failed');
    expect(deadCoordinatorThrewFeedRow('demo-coord', null, 'SQLITE_BUSY', NOW).body, 'the serialiser threw: nothing is known')
      .toContain('failed (SQLITE_BUSY) before it closed any run. Nothing more is known');
  });

  it('an act that FAILED part-way keeps the rows of what it had closed, and says it failed', () => {
````

<!-- replay: replace server/test/dead-coordinator-lane.test.ts -->
In `server/test/dead-coordinator-lane.test.ts`, find (block 35):

````ts
  it('an act that THROWS is asked again only after the backoff, and listed', async () => {
````

Replace with:

````ts
  it('an act that RELEASED a worker and then THREW, closing nothing, is recorded — a feed row, not only memory (review 339, F13)', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A, 'alpha');
    // The commit throws AFTER the fleet act ran: the release happened, the close did not.
    f.coord.closeRun = () => { throw new Error('database or disk is full'); };
    await anHourDead(f);
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'the CONTROL: the fleet act ran').toHaveLength(1);
    expect(f.stateOf(r)).toBe('working');
    const rows = f.coord.feedEvents(50).filter((e) => e.title === 'dead coordinator: act failed');
    expect(rows.map((e) => e.sessionId), 'one row, in the coordination store — not only in the watcher memory a restart drops').toEqual([A]);
    expect(rows[0]!.body).toContain(`before it closed any run; run ${r}'s abandon is the one that failed`);
  });

  it('an act that THROWS is asked again only after the backoff, and listed', async () => {
````

<!-- replay: replace server/test/dead-coordinator-lane.test.ts -->
In `server/test/dead-coordinator-lane.test.ts`, find (block 36):

````ts
    expect(counts, 'once, then not on the next pass, then again after two minutes').toEqual([1, 1, 2]);
````

Replace with:

````ts
    expect(counts, 'once, then not on the next pass, then again after two minutes').toEqual([1, 1, 2]);
    expect(f.feed().filter(([, t]) => t === 'dead coordinator: act failed'), 'each thrown act is one row').toHaveLength(2);
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/end-dead-coordinator.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-lane.test.ts --maxWorkers=1 )
```

Measured: `end-dead-coordinator.test.ts`: `1 failed | 21 passed (22)` — × an act that THROWS part-way hands back what it had closed …; `dead-coordinator-policy.test.ts`: `1 failed | 41 passed (42)` — × an act that THREW gets ONE row naming what is known …; `dead-coordinator-lane.test.ts`: `2 failed | 29 passed (31)` — × an act that RELEASED a worker and then THREW, closing nothing, is recorded …; × an act that THROWS is asked again only after the backoff, and listed.

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 37):

````ts
      /** Set only on the outcome a THROWN act hands back (`DeadCoordinatorActThrew`): what it had closed is real, and
       *  this is what failed. */
      readonly failed?: string }
````

Replace with:

````ts
      /** Set only on the outcome a THROWN act hands back (`DeadCoordinatorActThrew`): what it had closed is real, and
       *  this is what failed. */
      readonly failed?: string;
      /** Set only with `failed`, when the throw came from one run's abandon: that run. Whether ITS fleet act ran before
       *  the throw is not known — the abandon arm answered nothing (review 339, F13). */
      readonly failedRun?: number }
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 38):

````ts
/** One report's sentence. */
````

Replace with:

````ts
/** The feed row for an act that THREW (review 339, F13), written for EVERY thrown act — beside the rows of any
 *  programme it had closed — so a throw that closed nothing is still a durable record, not only an in-memory entry a
 *  restart loses. It names what is known — the runs the act closed, the run whose abandon failed — and says nothing
 *  more is. `done` is the executor's own outcome up to the throw, or `null` when the act failed before the executor
 *  could say anything (the serialiser itself threw). */
export function deadCoordinatorThrewFeedRow(
  claimantId: string, done: Extract<DeadCoordinatorActOutcome, { kind: 'ended' }> | null, error: string, since: number,
): { readonly title: string; readonly body: string } {
  const closed = done === null || done.programmes.length === 0 ? 'before it closed any run'
    : `after it closed failed ${done.programmes.map((x) => `${runs(x.runIds.length)} of programme ${x.slug}`).join(', ')}`;
  const at = done?.failedRun === undefined ? ''
    : `; run ${done.failedRun}'s abandon is the one that failed, and whether its worker was released or re-held before the failure is not known`;
  return { title: 'dead coordinator: act failed',
    body: `coordinator ${claimantId} crashed (dead since ${iso(since)}) and stayed dead an hour; the lane's act failed (${error}) `
      + `${closed}${at}. Nothing more is known about which runs or workspaces moved — check its runs on /runs. It is asked `
      + 'again only after a backoff.' };
}

/** One report's sentence. */
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 39):

````ts
  deadCoordinatorJournal,
````

Replace with:

````ts
  deadCoordinatorJournal, deadCoordinatorThrewFeedRow,
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 40):

````ts
  const outcome = (failed?: string): Extract<DeadCoordinatorActOutcome, { kind: 'ended' }> => {
````

Replace with:

````ts
  // The run whose abandon is in flight — what a throw names, since the arm answered nothing about it.
  let current: number | null = null;
  const outcome = (failed?: string): Extract<DeadCoordinatorActOutcome, { kind: 'ended' }> => {
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 41):

````ts
      ...(failed === undefined ? {} : { failed }) };
````

Replace with:

````ts
      ...(failed === undefined ? {} : { failed, ...(current === null ? {} : { failedRun: current }) }) };
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 42):

````ts
    for (const run of runs) {
````

Replace with:

````ts
    for (const run of runs) {
      current = run.id;
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 43):

````ts
      stuck.push({ runId: run.id, why: why.detail === undefined ? why.kind : `${why.kind}: ${why.detail}` });
    }
````

Replace with:

````ts
      stuck.push({ runId: run.id, why: why.detail === undefined ? why.kind : `${why.kind}: ${why.detail}` });
    }
    current = null;
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 44):

````ts
/** The breaker's feed row, under its first claimant — written by the lane when the trip begins or names a new set. */
````

Replace with:

````ts
/** The feed row for an act that THREW — every one, whatever it had done (review 339, F13). */
export function recordDeadCoordinatorThrew(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'notifyLog'>, claimantId: string,
  done: Extract<DeadCoordinatorActOutcome, { kind: 'ended' }> | null, error: string, since: number,
): void {
  recordRows(deps, claimantId, [deadCoordinatorThrewFeedRow(claimantId, done, error, since)], 'act failed');
}

/** The breaker's feed row, under its first claimant — written by the lane when the trip begins or names a new set. */
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find (block 45):

````ts
  recordDeadCoordinatorFeed,
} from './coord/endDeadCoordinator.js';
````

Replace with:

````ts
  recordDeadCoordinatorFeed, recordDeadCoordinatorThrew,
} from './coord/endDeadCoordinator.js';
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find (block 46):

````ts
      if (done !== null && done.programmes.length > 0) {
        recordDeadCoordinatorFeed({ coord, notifyLog: this.deps.notifyLog }, pick.id, done, pick.since);
      }
````

Replace with:

````ts
      if (done !== null && done.programmes.length > 0) {
        recordDeadCoordinatorFeed({ coord, notifyLog: this.deps.notifyLog }, pick.id, done, pick.since);
      }
      // EVERY thrown act is recorded, whatever it had done (review 339, F13): one that released a worker and then threw,
      // having closed nothing, is otherwise only an in-memory entry a restart loses.
      recordDeadCoordinatorThrew({ coord, notifyLog: this.deps.notifyLog }, pick.id, done, detail, pick.since);
````

- [ ] **Step 4: Run — green.** Measured: `22 passed (22)`; `42 passed (42)`; `31 passed (31)`.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T4.1 | `server/src/watch.ts`: `      recordDeadCoordinatorThrew({ coord, notifyLog: this.deps.notifyLog }, pick.id, done, detail, pick.since);` → `      void recordDeadCoordinatorThrew;` | `dead-coordinator-lane.test.ts`: `2 failed \| 29 passed (31)` — an act that RELEASED a worker and then THREW …; an act that THROWS is asked again only after the backoff … |
| T4.2 | `server/src/coord/endDeadCoordinator.ts`: `      current = run.id; ⏎ ` → (removed) | `end-dead-coordinator.test.ts`: `1 failed \| 21 passed (22)` — an act that THROWS part-way …<br>`dead-coordinator-lane.test.ts`: `1 failed \| 30 passed (31)` — an act that RELEASED a worker and then THREW … |

- [ ] **Step 6: Commit.** `fix(lifecycle): every thrown act writes a feed row naming what is known (review 339, F13)`.

---

### Task 5: A generation the mirror could not read is no successful sweep (review 339, the worker's open item 2 — an ARMING BLOCKER)

**Model routing:** `sonnet`, effort `medium`.

**Files:** `server/src/coord/mirror.ts` (`run`, `drain`); test `server/test/lifecycle-mirror.test.ts`.

**Interfaces:** `drain(…)` returns `Promise<boolean>` — `false` when the generation's first read answered nothing (its cursor did not move; the next tick retries), `true` otherwise (a truncation whose re-read failed is a recorded gap row, so it counts as read). `run()` moves `lastOkAt` only when every planned read answered. A truncation whose re-read fails answers `true`: the loss is a recorded gap row, which the lane's journal clause reads as doubt, so it is no silence — a case pins that choice (row T5.3). `LifecycleHealth` and `lifecycleState` are unchanged: one failed tick is absorbed (the last `lastOkAt` stands inside `staleAfterMs`), and a failure that persists three sweep intervals reads `stale` — on `/api/fleet/health` and as the dead-coordinator lane's `hold`, which decides nothing. The shape chosen and the one rejected are measured under "Measured while planning", item 4 (the departure `an-unread-generation-is-no-successful-sweep`).

- [ ] **Step 1: The tests (red).** A FleetIO whose `readFileFrom` answers null for one generation while `failing`: the first such pass keeps the last ok; three intervals on, `stale`; read again, `ok`, and every row ingested. And a truncation whose re-read from 0 answers null: a gap row is recorded and that sweep is the last ok (green at `main`, whose every sweep moves `lastOkAt`; it pins the `true` the source gives that arm).

<!-- replay: replace server/test/lifecycle-mirror.test.ts -->
In `server/test/lifecycle-mirror.test.ts`, find (block 47):

````ts
  it('goes `stale` once three sweep intervals pass with no successful sweep', async () => {
````

Replace with:

````ts
  it('a generation it could not READ is no successful sweep: one failed tick is absorbed, a persistent one reads stale (review 339, open item 2)', async () => {
    let failing = false;
    const io: FleetIO = { ...localIO,
      readFileFrom: async (p, from) => (failing && p.includes(G2) ? null : localIO.readFileFrom(p, from)) };
    const r = rig(io);
    fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
    await r.mirror.sweep();
    expect(r.mirror.health()).toMatchObject({ state: 'ok', lastOk: 1_000_000 });
    fs.writeFileSync(path.join(r.dir, genFile(G2)), `${line('b.1')}\n`);
    failing = true;
    r.now.v += 5000;
    await r.mirror.sweep();
    expect(r.mirror.health(), 'the pass that could not read G2 is not an ok sweep — the last ok stands').toMatchObject({ state: 'ok', lastOk: 1_000_000 });
    r.now.v += STALE_AFTER;
    await r.mirror.sweep();
    expect(r.mirror.health().state, 'unreadable for three intervals: stale, so the dead-coordinator lane decides nothing').toBe('stale');
    failing = false;
    r.now.v += 5000;
    await r.mirror.sweep();
    expect(r.mirror.health().state, 'read again: ok').toBe('ok');
    expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1', 'b.1']);
  });

  it('a truncation whose re-read fails is a RECORDED loss, not an unread generation: that sweep is the last ok (review 339, open item 2)', async () => {
    let failReread = false;
    const io: FleetIO = { ...localIO,
      readFileFrom: async (p, from) => (failReread && from === 0 ? null : localIO.readFileFrom(p, from)) };
    const r = rig(io);
    const f = path.join(r.dir, genFile(G1));
    fs.writeFileSync(f, `${line('a.1')}\n${line('a.2')}\n`);
    await r.mirror.sweep();
    fs.writeFileSync(f, `${line('a.3')}\n`);          // truncated in place; the re-read from 0 answers nothing
    failReread = true;
    r.now.v += 5000;
    await r.mirror.sweep();
    expect(r.store.lifecycleGaps(10)[0], 'the loss is a gap row, which the lane\'s journal clause reads').toMatchObject({ gen: G1, reason: 'shrank' });
    expect(r.mirror.health(), 'a recorded loss is no silence: this sweep counts').toMatchObject({ state: 'ok', lastOk: 1_005_000 });
  });

  it('goes `stale` once three sweep intervals pass with no successful sweep', async () => {
````

- [ ] **Step 2: Run — red.** `( cd server && ./node_modules/.bin/vitest run test/lifecycle-mirror.test.ts --maxWorkers=1 )`. Measured: `1 failed | 18 passed (19)` — × a generation it could not READ is no successful sweep: one failed tick is absorbed, a persistent one reads stale (review 339, open item 2).

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/coord/mirror.ts -->
In `server/src/coord/mirror.ts`, find (block 48):

````ts
    for (const r of plan.reads) await this.drain(dir, r.gen, r.from, r.lastSize, at);

    this.writeErrors = await this.readErrors(dir);
    this.lastOkAt = at;
  }
````

Replace with:

````ts
    let unread = 0;
    for (const r of plan.reads) if (!(await this.drain(dir, r.gen, r.from, r.lastSize, at))) unread += 1;

    this.writeErrors = await this.readErrors(dir);
    // A GENERATION THIS PASS COULD NOT READ IS NOT A SUCCESSFUL SWEEP (review 339, the worker's open item 2). Its
    // cursor did not move and the next tick retries it, but a health that read `ok` across it would tell the
    // dead-coordinator lane's journal clause it holds every act — and a deliberate `stop` sitting in that generation
    // would be invisible to it for as long as the read keeps failing. So `lastOkAt` moves only when every planned
    // read answered: one failed tick is absorbed (the last ok stands, inside `staleAfterMs`), and a failure that
    // PERSISTS reads `stale` — on `/api/fleet/health`, and as the lane's `hold`, which decides nothing.
    if (unread === 0) this.lastOkAt = at;
  }
````

<!-- replay: replace server/src/coord/mirror.ts -->
In `server/src/coord/mirror.ts`, find (block 49):

````ts
  /** One generation, one pass — and at most TWO reads: the second happens only
   *  when the first proved a truncation, which is the one condition under
   *  which the offset we asked from was wrong. */
  private async drain(
    dir: string, gen: string, from: number, lastSize: number, at: number,
  ): Promise<void> {
    const file = path.join(dir, `${LC_GEN_PREFIX}${gen}${LC_GEN_SUFFIX}`);
    const first = await this.deps.io.readFileFrom(file, from);
    if (first === null) return;                       // unreadable; retry next tick
    const framed = frameRead(from, first.data, first.size, lastSize);
    if (!framed.shrank) {
      this.commit(gen, framed.lines, framed.nextCursor, first.size, at);
      return;
    }
````

Replace with:

````ts
  /** One generation, one pass — and at most TWO reads: the second happens only
   *  when the first proved a truncation, which is the one condition under
   *  which the offset we asked from was wrong. `false` when the generation
   *  could not be read at all: nothing moved, and the next tick retries it. */
  private async drain(
    dir: string, gen: string, from: number, lastSize: number, at: number,
  ): Promise<boolean> {
    const file = path.join(dir, `${LC_GEN_PREFIX}${gen}${LC_GEN_SUFFIX}`);
    const first = await this.deps.io.readFileFrom(file, from);
    if (first === null) return false;                 // unreadable; retry next tick
    const framed = frameRead(from, first.data, first.size, lastSize);
    if (!framed.shrank) {
      this.commit(gen, framed.lines, framed.nextCursor, first.size, at);
      return true;
    }
````

<!-- replay: replace server/src/coord/mirror.ts -->
In `server/src/coord/mirror.ts`, find (block 50):

````ts
      this.commit(gen, [], 0, first.size, at);
      return;
    }
    const re = frameRead(0, second.data, second.size, 0);
    this.commit(gen, re.lines, re.nextCursor, second.size, at);
  }
````

Replace with:

````ts
      this.commit(gen, [], 0, first.size, at);
      return true;   // the loss is a recorded gap row, which the lane's clause reads — not a silence
    }
    const re = frameRead(0, second.data, second.size, 0);
    this.commit(gen, re.lines, re.nextCursor, second.size, at);
    return true;
  }
````

- [ ] **Step 4: Run — green**, and the mirror's neighbours. Measured: `lifecycle-mirror` `19 passed (19)`; `lifecycle-sweep` `8 passed (8)`; `lifecycle-replay` `3 passed (3)`; `child-reclaim-done-at` `12 passed (12)`.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T5.1 | `server/src/coord/mirror.ts`: `    if (unread === 0) this.lastOkAt = at;` → `    this.lastOkAt = at;` | `lifecycle-mirror.test.ts`: `1 failed \| 18 passed (19)` — a generation it could not READ is no successful sweep … |
| T5.2 | `server/src/coord/mirror.ts`: `    if (first === null) return false;` → `    if (first === null) return true;` | `lifecycle-mirror.test.ts`: `1 failed \| 18 passed (19)` — the same case |
| T5.3 | `server/src/coord/mirror.ts`: `      return true;   // the loss is a recorded gap row, which the lane's clause reads — not a silence` → `      return false;   // the loss is a recorded gap row, which the lane's clause reads — not a silence` | `lifecycle-mirror.test.ts`: `1 failed \| 18 passed (19)` — a truncation whose re-read fails is a RECORDED loss … (`a recorded loss is no silence: this sweep counts`) |

- [ ] **Step 6: Commit.** `fix(lifecycle): the mirror's health never reads ok across an unreadable generation (review 339, open item 2)`.

---

### Task 6: A mirror gone stale at the act is a hold — the anchor and the run of passes stand (review 339, F4, ruled)

**Model routing:** `sonnet`, effort `high` — a port's type widens and every reader moves with it.

**Files:** `server/src/deadCoordinator.ts` (`DeadCoordinatorStop`, `deadCoordinatorNextEntry`), `server/src/coord/endDeadCoordinator.ts` (`EndDeadCoordinatorDeps.journalTrust`, `stillCrashed`), `server/src/watch.ts` (the act's deps); tests `server/test/end-dead-coordinator.test.ts`, `server/test/dead-coordinator-policy.test.ts`, `server/test/dead-coordinator-lane.test.ts`.

**Interfaces:**
- `EndDeadCoordinatorDeps.journalTrust: () => Promise<{ hold: string | null; trust: DeadCoordinatorJournalTrust }>` — `readDeadCoordinatorJournalTrust`'s whole answer, where it handed the executor `.trust` alone.
- `stillCrashed` reads the journal's trust FIRST (after the switches): a `hold` returns `{ kind: 'hold', why: '<hold> — the act waits, and its hour stands' }`. `DeadCoordinatorStop` gains `{ kind: 'hold'; why: string }`.
- **The two reads swap, and that is named (part of the departure `a-stale-mirror-at-the-act-is-a-hold`).** On `main` `stillCrashed` measures the claimant (tmux, the heartbeat) and THEN reads the journal's trust. Here the trust is read first, so a hold stops the act before any tmux call, and the claimant's own measure becomes the LAST awaited step before `closeRun`'s synchronous commit. Review 339 sized its accepted item 3 (ruling G) on the old order — "after the post-act stillCrashed's tmux answer, the only awaited step left is journalTrust()" — and that sizing is now stale: the window between the last measure and the commit narrows to that measure's own round trip. Safe in direction (a revive is read later, never earlier); the coordinator should restate item 3 in the ledger's arming notes.
- `deadCoordinatorNextEntry`: a `hold` stop keeps `crashedPasses` (as `successor` does) and waits one pass (`nextAskAt = now + passMs`, as `switch` does); the lane deletes the anchor only on `remeasured`, so a `hold` keeps it.
- **The ruling, read whole.** "Stops the act like the switch does: the anchor and the run of passes are KEPT." The switch keeps the anchor and RESETS the run of passes (`deadCoordinatorNextEntry` zeroes `crashedPasses` on `switch`), so the two halves of the sentence disagree on the run of passes. This plan follows the explicit words — both kept — and takes from the switch only its one-pass wait (the departure `a-stale-mirror-at-the-act-is-a-hold`; the operator's question (g)). Either reading fails safe: with the passes kept, the next pass whose mirror is fresh re-measures the claimant, counts a third crashed pass and may act; reset, it needs two more.

- [ ] **Step 1: The tests (red).** The executor's rig answers `{ hold, trust }` and takes a `hold` option; an executor case stops on a `hold` with nothing composed; the policy's stop case takes `'hold'` (passes kept, one pass's wait); a lane case advances the clock twenty seconds inside the serialiser (the mirror turns `stale`), then sees the anchor and the passes stand and the act run on the next fresh pass.

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 51):

````ts
  /** The lane's reading of the journal itself (default: trusted). */
  trust?: DeadCoordinatorJournalTrust;
````

Replace with:

````ts
  /** The lane's reading of the journal itself (default: trusted). */
  trust?: DeadCoordinatorJournalTrust;
  /** The mirror's hold, as the lane reads it at the act (default: none). */
  hold?: string;
````

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 52):

````ts
    journalTrust: async () => o.trust ?? DEAD_COORDINATOR_JOURNAL_TRUSTED,
````

Replace with:

````ts
    journalTrust: async () => ({ hold: o.hold ?? null, trust: o.trust ?? DEAD_COORDINATOR_JOURNAL_TRUSTED }),
````

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 53):

````ts
  it('a deliberate act journaled since the pass — the operator stopped it — ends the act too', async () => {
````

Replace with:

````ts
  it('a mirror gone stale since the pass is a HOLD, never a re-measure: nothing composed, nothing closed (review 339, F4)', async () => {
    const r = await rig({ hold: 'the lifecycle mirror is stale' });
    const a = r.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      stoppedBy: { kind: 'hold', why: 'the lifecycle mirror is stale — the act waits, and its hour stands' } });
    expect(r.calls, 'nothing composed').toEqual([]);
    expect(r.stateOf(a)).toBe('working');
  });

  it('a deliberate act journaled since the pass — the operator stopped it — ends the act too', async () => {
````

<!-- replay: replace server/test/dead-coordinator-policy.test.ts -->
In `server/test/dead-coordinator-policy.test.ts`, find (block 54):

````ts
    const ended = (stoppedBy: { kind: 'remeasured' | 'switch' | 'successor'; why: string }) =>
````

Replace with:

````ts
    const ended = (stoppedBy: { kind: 'remeasured' | 'switch' | 'successor' | 'hold'; why: string }) =>
````

<!-- replay: replace server/test/dead-coordinator-policy.test.ts -->
In `server/test/dead-coordinator-policy.test.ts`, find (block 55):

````ts
    expect(ended({ kind: 'successor', why: 'x' })).toMatchObject({ crashedPasses: 61 });
````

Replace with:

````ts
    expect(ended({ kind: 'successor', why: 'x' })).toMatchObject({ crashedPasses: 61 });
    // A mirror gone stale at the act learned nothing: the passes stand, and it waits one pass (review 339, F4).
    expect(ended({ kind: 'hold', why: 'the lifecycle mirror is stale' })).toMatchObject({ crashedPasses: 61, nextAskAt: NOW + PASS });
````

<!-- replay: replace server/test/dead-coordinator-lane.test.ts -->
In `server/test/dead-coordinator-lane.test.ts`, find (block 56):

````ts
  it('a revive that lands AFTER the worker was released is recorded: a feed row and an attention entry, though no run was closed', async () => {
````

Replace with:

````ts
  it('a mirror that goes STALE between the pass and the act stops it as a hold: the anchor and the run of passes stand (review 339, F4)', async () => {
    let slow = false;
    const f: Fixture = await fixture({ beforeAct: () => { if (slow) f.advance(20_000); } });   // three sweep intervals and more
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    const anchor = f.anchorOf(A);
    slow = true;
    f.next(); await f.pass();
    slow = false;
    expect(f.acts(), 'the act was asked').toBe(1);
    expect(f.stateOf(r), 'nothing ended').toBe('working');
    expect(f.calls, 'nothing composed').toEqual([]);
    expect(f.anchorOf(A), 'a slow mirror never deletes an anchor').toMatchObject({ firstDeadAt: (anchor as { firstDeadAt: number }).firstDeadAt });
    expect(f.watcher().currentDeadCoordinators().get(A)?.crashedPasses, 'nor the run of passes').toBeGreaterThanOrEqual(2);
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the mirror is fresh again: the hour it kept is due on the next pass').toBe('failed');
  });

  it('a revive that lands AFTER the worker was released is recorded: a feed row and an attention entry, though no run was closed', async () => {
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/end-dead-coordinator.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-lane.test.ts --maxWorkers=1 )
```

Measured: `end-dead-coordinator.test.ts`: `13 failed | 10 passed (23)` — the rig now answers `{ hold, trust }`, which the old executor hands to the journal clause as the trust itself, so every live re-measure reads an untrusted journal (× ends every run of every programme …; × the claimant is re-measured before EACH close …; × a revive DURING the fleet act …; and nine more), and × a mirror gone stale since the pass is a HOLD …; `dead-coordinator-policy.test.ts`: `1 failed | 41 passed (42)` — × an act that STOPPED on a re-measure or a switch forgets its passes; a successor does not; `dead-coordinator-lane.test.ts`: `1 failed | 31 passed (32)` — × a mirror that goes STALE between the pass and the act stops it as a hold …

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 57):

````ts
 *   - `successor`: a run's claimant is no longer the crashed id (`claimant-changed`). Nothing about the crashed
 *     claimant is learned, so nothing resets. */
export type DeadCoordinatorStop =
  | { readonly kind: 'remeasured'; readonly why: string }
  | { readonly kind: 'switch'; readonly why: string }
  | { readonly kind: 'successor'; readonly why: string };
````

Replace with:

````ts
 *   - `successor`: a run's claimant is no longer the crashed id (`claimant-changed`). Nothing about the crashed
 *     claimant is learned, so nothing resets;
 *   - `hold`: the lifecycle mirror turned `unknown` or `stale` between the pass and the act (review 339, F4, ruled). The
 *     journal could not be read, so nothing about the claimant was learned — the adapter's own contract, "a slow mirror
 *     never deletes an anchor": the anchor AND the run of passes stand, and the act waits one pass, as the switch's
 *     does. Never `remeasured`, which would delete the anchor on a mirror's lateness. */
export type DeadCoordinatorStop =
  | { readonly kind: 'remeasured'; readonly why: string }
  | { readonly kind: 'switch'; readonly why: string }
  | { readonly kind: 'successor'; readonly why: string }
  | { readonly kind: 'hold'; readonly why: string };
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 58):

````ts
      const crashedPasses = stop === 'remeasured' || stop === 'switch' ? 0 : e.crashedPasses;
````

Replace with:

````ts
      const crashedPasses = stop === 'remeasured' || stop === 'switch' ? 0 : e.crashedPasses;   // `hold` keeps them
````

<!-- replay: replace server/src/deadCoordinator.ts -->
In `server/src/deadCoordinator.ts`, find (block 59):

````ts
        return { ...base, crashedPasses, attempts: 0, nextAskAt: stop === 'switch' ? nowMs + passMs : 0,
````

Replace with:

````ts
        return { ...base, crashedPasses, attempts: 0, nextAskAt: stop === 'switch' || stop === 'hold' ? nowMs + passMs : 0,
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 60):

````ts
/** The executor's ports (L2, declared by this consumer). `abandon` is the ONLY way it ends a run. `journalTrust` is the
 *  lane's own reading of the lifecycle mirror's health, gaps and ccd's write failures, asked fresh at each re-measure. */
````

Replace with:

````ts
/** The executor's ports (L2, declared by this consumer). `abandon` is the ONLY way it ends a run. `journalTrust` is the
 *  lane's own reading of the lifecycle mirror's health, gaps and ccd's write failures, asked fresh at each re-measure —
 *  WHOLE, `hold` with `trust`, so a mirror that turned `unknown` or `stale` since the pass stops the act as a `hold`
 *  (the anchor stands) and is never read as an untrusted journal (`remeasured`, which deletes it; review 339, F4). */
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 61):

````ts
  journalTrust: () => Promise<DeadCoordinatorJournalTrust>;
````

Replace with:

````ts
  journalTrust: () => Promise<{ readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust }>;
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 62):

````ts
  if (!deadCoordinatorLaneArmed(names)) return { kind: 'switch', why: 'the lane was disarmed during the act' };
  const m = await measureClaimant({ coord: deps.coord, io: deps.io, cfg: deps.cfg, tmux: deps.tmux }, id, deps.now());
  const c = deadCoordinatorCrash(m, deadCoordinatorJournalOf(deps.coord, id, await deps.journalTrust()));
````

Replace with:

````ts
  if (!deadCoordinatorLaneArmed(names)) return { kind: 'switch', why: 'the lane was disarmed during the act' };
  // The journal's own trust FIRST, and whole: a mirror gone `unknown` or `stale` since the pass stops the act as the
  // pass's own hold does — nothing learned, the anchor standing (review 339, F4).
  const journal = await deps.journalTrust();
  if (journal.hold !== null) return { kind: 'hold', why: `${journal.hold} — the act waits, and its hour stands` };
  const m = await measureClaimant({ coord: deps.coord, io: deps.io, cfg: deps.cfg, tmux: deps.tmux }, id, deps.now());
  const c = deadCoordinatorCrash(m, deadCoordinatorJournalOf(deps.coord, id, journal.trust));
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find (block 63):

````ts
      journalTrust: async () => (await readDeadCoordinatorJournalTrust({ coord, io: this.deps.io, cfg: this.deps.cfg },
        this.lifecycleHealth())).trust };
````

Replace with:

````ts
      // WHOLE — the hold with the trust — so a mirror gone stale since the pass is a `hold` stop (review 339, F4).
      journalTrust: () => readDeadCoordinatorJournalTrust({ coord, io: this.deps.io, cfg: this.deps.cfg }, this.lifecycleHealth()) };
````

- [ ] **Step 4: Run — green**, and `tsc`. Measured: `23 passed (23)`; `42 passed (42)`; `32 passed (32)`; tsc rc 0.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T6.1 | `server/src/coord/endDeadCoordinator.ts`: `  if (journal.hold !== null) return { kind: 'hold',` → `  if (journal.hold === '\0') return { kind: 'hold',` | `end-dead-coordinator.test.ts`: `1 failed \| 22 passed (23)` — a mirror gone stale since the pass is a HOLD …<br>`dead-coordinator-lane.test.ts`: `1 failed \| 31 passed (32)` — a mirror that goes STALE … (`a slow mirror never deletes an anchor: expected null`) |
| T6.2 | `server/src/deadCoordinator.ts`: `nextAskAt: stop === 'switch' \|\| stop === 'hold' ? nowMs + passMs : 0,` → `nextAskAt: stop === 'switch' ? nowMs + passMs : 0,` | `dead-coordinator-policy.test.ts`: `1 failed \| 41 passed (42)` — an act that STOPPED on a re-measure or a switch forgets its passes … |
| T6.3 | `server/src/deadCoordinator.ts`: `      const crashedPasses = stop === 'remeasured' \|\| stop === 'switch' ? 0 : e.crashedPasses;` → `      const crashedPasses = stop === 'remeasured' \|\| stop === 'switch' \|\| stop === 'hold' ? 0 : e.crashedPasses;` | `dead-coordinator-policy.test.ts`: `1 failed \| 41 passed (42)` — the same case<br>`dead-coordinator-lane.test.ts`: `1 failed \| 31 passed (32)` — `nor the run of passes: expected 0 to be greater than or equal to 2` |

- [ ] **Step 6: Commit.** `fix(lifecycle): a mirror gone stale at the act is a hold — the anchor and the passes stand (review 339, F4)`.

---

### Task 7: The residue's words — §5.4 (F5, measured; the accepted abstention), README, and the wave-4 plan's corrections (F6, F7, F8, F10, F11, F12)

**Model routing:** `sonnet`, effort `medium` — words and tables, every count in them measured.

**Files:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` (§5.4), `README.md` (the dead-coordinator paragraph), `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`; test `server/test/dead-coordinator-prose.test.ts`.

**What it says, and why:**
- **F5 (ruled: no code change; both texts true; the spec gains the missing sentence).** §5.4's "The programme retires as `abandoned`, permanently." is replaced by the MEASURED facts (Measured while planning, item 3): the row reads `abandoned`; opening a run does not change it (`openRun`'s conflict arm updates only the title), so a revived coordinator's new run under the fenced slug leaves the row reading `abandoned` while it is open; and the row is rewritten only when a later close ends the programme's last open run (`done` or `abandoned` by that close). **The ruling's "nothing resets it" is measured FALSE:** a later close of the programme's last open run rewrites the row (`store.ts`'s D-51 retirement check), so "permanently" goes and the third fact replaces it (the departure `an-abandoned-programme-row-is-rewritten-only-by-a-last-close`). The coordinator should correct the ledger's 2026-10-08 12:02 entry and the Next-wave brief's question (f), whose framing ("Today it stays `abandoned`") holds only until that close. `ccd/coordinator-skill/references/resume.md` keeps its wording (its "can open it again with a new `POST /api/runs`" stays pinned by `dead-coordinator-prose`).
- **The accepted abstention (CCR-15's cross-side record, mail 4011; ruled: no code change).** The journal clause (`deadCoordinator.ts`'s `isDeliberate`: any non-refused row of an act in `DEAD_COORDINATOR_DELIBERATE_ACTS`, `reclaim` among them) counts a child's pre-start `reclaim` `failed` `probe-unmeasured` row as deliberate, so the lane abstains from that claimant; abstention ends nothing. Reachable only by a marked child that becomes a claimant or an heir before any successful reclaim of it (the departure `a-pre-start-reclaim-failure-reads-deliberate`).
- **"As wave 5 corrects the lane"** lists Tasks 2–6's behaviour in one short sentence each.
- **README**: one sentence at the end of the dead-coordinator paragraph (a stale mirror at the act keeps the hour; every failed act writes a feed row). It sits below README's `shared/api.ts` citations: nothing re-points.
- **The wave-4 plan's corrections** (review 339): F6 re-words the 4348 entry (`unlearnable-row-backs-off-is-reported-and-yields-its-slot`) to the qualified rule — an older ccd's audit with no `expiresAt` key reads `no-evidence`; F7 ends the 4454 entry (`a-hold-never-hides-a-stopped-row`) with its number's issue instead of "Reported for a number; none minted."; F8 says twenty-one at its lines 13 and 47; F10 and F11 restate rows T3.1, T3.3, T3.4 and T13.5 with review 339's counts at their commits AND this plan's at `b0647d850` (row T3.4's anchor gained `nextAskAt: 0` in the final review's B-F1 fix, which the row now says), both halves of row T3.1 (its `archived-expiry-lane` half reds `2 failed | 27 passed (29)` at `b0647d850`: the B-F1 fix's own case joins it) and the lane half row T3.4 never named (`1 failed | 28 passed (29)`, the B-F1 case); F12 writes rows T6.30–T6.33 (cited by commits `b238e51f2` and `acffc9319`, absent from the plan) and a row per review fix the PR body lists, each re-measured on a clean `b0647d850` tree, one file per process, every one red. F9 needs nothing (its commit message was squashed away).

- [ ] **Step 1: The prose pins (red).**

<!-- replay: replace server/test/dead-coordinator-prose.test.ts -->
In `server/test/dead-coordinator-prose.test.ts`, find (block 64):

````ts
  it('CCR-15 §5.8: the one cleanup switch stops the dead-coordinator lane too', () => {
````

Replace with:

````ts
  it('§5.4 says both measured facts of an abandoned programme, records wave 5’s corrections and the accepted abstention (review 339, F5)', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s, 'the old absolute is gone').not.toContain('The programme retires as `abandoned`, permanently.');
    expect(s).toContain('while that run is open the programme row still reads `abandoned`');
    expect(s).toContain('The row is rewritten only when a later close ends the programme\'s last open run');
    expect(s).toContain('**As wave 5 corrects the lane**');
    for (const item of ['**A second crash is a second record.**', '**A release and a re-hold are two acts.**',
      '**Every thrown act is recorded.**', '**A generation the mirror could not read is not a successful sweep.**',
      '**A mirror gone stale at the act is a hold.**', '**An accepted abstention.**']) expect(s).toContain(item);
  });
  it('README says a stale mirror at the act keeps the hour, and every failed act is recorded (wave 5)', () => {
    expect(flat('README.md')).toContain('A mirror that goes stale between the pass and the act stops the act and keeps the hour, and every act that fails writes a feed row, whatever it had done.');
  });
  it('CCR-15 §5.8: the one cleanup switch stops the dead-coordinator lane too', () => {
````

- [ ] **Step 2: Run — red.** `( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-prose.test.ts --maxWorkers=1 )`. Measured: `2 failed | 10 passed (12)` — × §5.4 says both measured facts of an abandoned programme, records wave 5's corrections and the accepted abstention (review 339, F5); × README says a stale mirror at the act keeps the hour, and every failed act is recorded (wave 5).

- [ ] **Step 3: The words.** §5.4, README, then the wave-4 plan (fragments first, the F12 rows last).

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find (block 65):

````markdown
- The programme retires as `abandoned`, permanently.
````

Replace with:

````markdown
- The programme retires as `abandoned`. Opening a run does not change that: a coordinator revived under the crashed id
  can still open a new run under its fenced slug (`openRun`'s conflict arm updates only the title), and while that run
  is open the programme row still reads `abandoned`. The row is rewritten only when a later close ends the programme's
  last open run, to `done` or `abandoned` by that close (measured in a fixture store, wave 5).
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find (block 66):

````markdown
- **Not changed:** the reclaim door and the stall watch ignore the verdict's new `cause`; landing reads a run the sweep
  failed exactly as one the operator abandoned (it keys on open runs, never on `causedBy`).
````

Replace with:

````markdown
- **Not changed:** the reclaim door and the stall watch ignore the verdict's new `cause`; landing reads a run the sweep
  failed exactly as one the operator abandoned (it keys on open runs, never on `causedBy`).

**As wave 5 corrects the lane** (review 339's residue; each a departure named in the wave-5 plan,
`docs/superpowers/plans/2026-10-08-workspace-lifecycle-wave5-residue-and-expiry-follow-ups.md`).
- **A second crash is a second record.** A reading that ends an episode (anything but a crash) forgets the last
  recorded outcome, so a coordinator that crashes, is revived and crashes again is recorded again in shadow.
- **A release and a re-hold are two acts.** An act the re-measure stopped after its fleet act says which one ran: a
  released worker is unheld until its coordinator re-holds it, and a worker re-held under a surviving run stays claimed.
- **Every thrown act is recorded.** Each thrown act writes one feed row naming the runs it closed, the run whose
  abandon failed, and that nothing more is known.
- **A generation the mirror could not read is not a successful sweep.** One failed read is absorbed; a failure that
  persists turns the mirror's health `stale`, so the lane decides nothing.
- **A mirror gone stale at the act is a hold.** The act stops, the anchor and the run of crashed passes stand (the
  adapter's own rule: a slow mirror never deletes an anchor), and the act waits a pass.
- **An accepted abstention.** The journal clause counts any non-refused `reclaim` row as deliberate, so a child's
  pre-start `reclaim` `failed` `probe-unmeasured` row reads as a deliberate act and the lane abstains from that
  claimant. Abstention ends nothing. It is reachable only by a marked child that becomes a claimant or an heir before
  any successful reclaim of it.
````

<!-- replay: replace README.md -->
In `README.md`, find (block 67):

````markdown
seen dead, and one when the breaker trips) are records of the same incident.
````

Replace with:

````markdown
seen dead, and one when the breaker trips) are records of the same incident. A mirror that goes stale between the pass
and the act stops the act and keeps the hour, and every act that fails writes a feed row, whatever it had done.
````

<!-- replay: fragment docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find this part of one line (block 68):

````text
**Departure numbers — twenty slugs, twenty numbers.** The plan names twenty departures by SLUG
````

Replace that part with:

````text
**Departure numbers — twenty-one slugs, twenty-one numbers** (corrected by wave 5, review 339's F8). The plan names twenty-one departures by SLUG (twenty issued with the brief, the twenty-first after the review)
````

<!-- replay: fragment docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find this part of one line (block 69):

````text
Twenty departures, by slug; the brief issues the numbers for all twenty (the callout above).
````

Replace that part with:

````text
Twenty-one departures, by slug; the brief issued the numbers for twenty, and the twenty-first was issued after the review (the callout above).
````

<!-- replay: fragment docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find this part of one line (block 70):

````text
`archived-expiry-policy.test.ts`: `1 failed \| 48 passed (49)` — an ineligible sighting clears a would-expire or in-use report as well as a held one (review 313, F1)<br>`archived-expiry-lane.test.ts`: `1 failed \| 26 passed (27)` — a would-expire entry goes when the row stops being eligible — a run binds it
````

Replace that part with:

````text
`archived-expiry-policy.test.ts`: `1 failed \| 49 passed (50)` at `33bb057cb` (review 339, F10; this row first said 48 of 49), `1 failed \| 51 passed (52)` at `b0647d850` — an ineligible sighting clears a would-expire or in-use report as well as a held one (review 313, F1)<br>`archived-expiry-lane.test.ts`: `1 failed \| 26 passed (27)` as first written, `2 failed \| 27 passed (29)` at `b0647d850` (wave 5) — a would-expire entry goes when the row stops being eligible — a run binds it; and, since the final review's B-F1 fix, a report an ineligible pass clears is re-audited as soon as the row is due again, not after its old wait
````

<!-- replay: fragment docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find this part of one line (block 71):

````text
`archived-expiry-policy.test.ts`: `1 failed \| 48 passed (49)` — the held sentence names the instant
````

Replace that part with:

````text
`archived-expiry-policy.test.ts`: `1 failed \| 49 passed (50)` at `33bb057cb` (review 339, F10), `1 failed \| 51 passed (52)` at `b0647d850` — the held sentence names the instant
````

<!-- replay: fragment docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find this part of one line (block 72):

````text
`single-definition.test.ts` `-t type no period`: `1 failed \| 406 skipped (407)`
````

Replace that part with:

````text
`single-definition.test.ts` `-t type no period`: `1 failed \| 408 skipped (409)` (the arm first exists at `f367a4a9c`, review 339's F10; the same at `b0647d850`)
````

<!-- replay: fragment docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find this part of one line (block 73):

````text
| T3.4 | `server/src/archivedExpiry.ts`: `  const run = ends ? { inUseRun: 0, inUse: [] as readonly ExpireInUse[] } : {};` → `  const run = {};` | `archived-expiry-policy.test.ts`: `1 failed \| 48 passed (49)` — an ineligible sighting clears a would-expire or in-use report as well as a held one (review 313, F1) |
````

Replace that part with:

````text
| T3.4 | `server/src/archivedExpiry.ts`: `  const run = ends ? { inUseRun: 0, inUse: [] as readonly ExpireInUse[] } : {};` → `  const run = {};` (the line reads `  const run = ends ? { inUseRun: 0, inUse: [] as readonly ExpireInUse[], nextAskAt: 0 } : {};` since the final review's B-F1 fix; the mutation is the same) | `archived-expiry-policy.test.ts`: `1 failed \| 49 passed (50)` at `33bb057cb` (review 339, F10), `1 failed \| 51 passed (52)` at `b0647d850` — an ineligible sighting clears a would-expire or in-use report as well as a held one (review 313, F1)<br>`archived-expiry-lane.test.ts`: `1 failed \| 28 passed (29)` at `b0647d850` (wave 5; the B-F1 fix's own case) — a report an ineligible pass clears is re-audited as soon as the row is due again, not after its old wait |
````

<!-- replay: fragment docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find this part of one line (block 74):

````text
`dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — imports L0 alone
````

Replace that part with:

````text
`dead-coordinator-policy.test.ts`: `1 failed \| 32 passed (33)` at `9a5c6e06d` (review 339, F11; this row first said 30 of 31), `1 failed \| 38 passed (39)` at `b0647d850` — imports L0 alone
````

<!-- replay: fragment docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find this part of one line (block 75):

````text
or that read no archive and is not a return, climbs the failure ladder and is listed at once;
````

Replace that part with:

````text
or that read no archive from a ccd that prints the instant and is not a return, climbs the failure ladder and is listed at once — an older ccd's audit with no `expiresAt` key reads `no-evidence` first, never a failure (the spec's own design, as ruled 2026-10-07; corrected by wave 5, review 339's F6);
````

<!-- replay: fragment docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find this part of one line (block 76):

````text
so a hold can never take it off the list. Reported for a number; none minted.
````

Replace that part with:

````text
so a hold can never take it off the list. Its number was issued after the review (corrected by wave 5, review 339's F7).
````

<!-- replay: replace docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md -->
In `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`, find (block 77):

````markdown
| T6.29 | `server/src/deadCoordinator.ts`: `  const allUnmeasurable = measured >= 2 && unmeasurable.length === measured;` → `  const allUnmeasurable = false;` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a pass that could measure none of two or more claimants trips it; one unmeasurable of several, with tmux answering, does not |
````

Replace with:

````markdown
| T6.29 | `server/src/deadCoordinator.ts`: `  const allUnmeasurable = measured >= 2 && unmeasurable.length === measured;` → `  const allUnmeasurable = false;` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a pass that could measure none of two or more claimants trips it; one unmeasurable of several, with tmux answering, does not |
| T6.30 | `server/src/deadCoordinator.ts`: `  if (start === null && rows.some((r) => r.act === 'spawn')) return { kind: 'quiet', started: false, failedSpawn: true }; ⏎ ` → (removed) | `dead-coordinator-policy.test.ts`: `1 failed \| 38 passed (39)` at `b0647d850` — a horizon whose only spawn rows FAILED says so — `failedSpawn`; a horizon with no spawn row at all does not (written by wave 5, review 339's F12; the commit `b238e51f2` cited this row) |
| T6.31 | `server/src/deadCoordinator.ts`: `  if (j.kind === 'quiet' && !j.started && j.failedSpawn === true) {` → `  if (false) {` | `dead-coordinator-policy.test.ts`: `1 failed \| 38 passed (39)` at `b0647d850` — the table (written by wave 5, F12) |
| T6.32 | `server/src/deadCoordinator.ts`: `    const before = start !== null && GEN_DIGITS.test(g) && GEN_DIGITS.test(start.gen)` → `    const before = start !== null && GEN_DIGITS.test(start.gen)` | `dead-coordinator-policy.test.ts`: `1 failed \| 38 passed (39)` at `b0647d850` — a journal the lane cannot TRUST is unreadable, never quiet: a mirror not ok, a gap that may hold the act, a write ccd could not make (the short, real-shaped unplaceable name `journal-x.ndjson`; written by wave 5, F12) |
| T6.33 | `server/src/deadCoordinator.ts`: `could not be moved, so the programme is NOT ended (runs the lane did close stay closed).` → `could not be moved.` | `dead-coordinator-policy.test.ts`: `1 failed \| 38 passed (39)` at `b0647d850` — the `stuck` sentence of a partly-ended programme never reads as ended — the feed row says NOT ended, so must this (written by wave 5, F12; the commit `acffc9319` cited this row) |

**The review-fix rows** (the PR's "a row per review fix", written into this plan by wave 5 — review 339's F12 — and each measured at `b0647d850`, one file per process; every row red). The fresh-instant fix's third half — the lane's wiring of the executor's clock — had no red at `701839b52` (review 339's F1); wave 5's Task 1 adds its case and its row.

| Row | Mutation | Red |
|---|---|---|
| RF.1 | `server/src/coord/endDeadCoordinator.ts`: `      const out = await deps.abandon(run.id, claimantId, () => stillCrashed(deps, claimantId));` → `      const out = await deps.abandon(run.id, claimantId, () => stillCrashed({ ...deps, now: () => _passNowMs }, claimantId));` | `end-dead-coordinator.test.ts`: `1 failed \| 20 passed (21)` — a RESTARTING coordinator is alive: a heartbeat written AFTER the pass instant (the clock has moved on) stops the act — nothing closed, no worker released |
| RF.2 | `server/src/watch.ts`: `      const at = Date.now();` → `      const at = now;` | `dead-coordinator-lane.test.ts`: `1 failed \| 27 passed (28)` — a heartbeat written after the pass began — while an EARLIER claimant was being measured — is a restarting coordinator, not a crashed one |
| RF.3 | `server/src/coord/endDeadCoordinator.ts`: `  if (health.writeErrors === null \|\| health.writeErrors > 0) {` → `  if (health.writeErrors !== null && health.writeErrors > 0) {` | `end-dead-coordinator.test.ts`: `2 failed \| 19 passed (21)` — a null count with an errors file PRESENT (the mirror could not read it) places the last failure at its mtime; a null count whose errors file cannot be statted — present, unreadable — is `unknown`, never "none" |
| RF.4 | `server/src/deadCoordinator.ts`: `  const rows = [...mirrorRows].sort((a, b) => compareGenerations(a.gen, b.gen));` → `  const rows = [...mirrorRows];` | `dead-coordinator-policy.test.ts`: `1 failed \| 38 passed (39)` — rows are read in JOURNAL order — (generation, then the mirror id) — not ingest order: a newer generation ingested FIRST still comes after an older one |
| RF.5 | `server/src/deadCoordinator.ts`: `  if (unplaced !== undefined) {` → `  if (false) {` | `dead-coordinator-policy.test.ts`: `1 failed \| 38 passed (39)` — a row whose generation name cannot be placed makes the journal UNREADABLE — never a guessed order |
| RF.6 | `server/src/deadCoordinator.ts`: `      const slugs = [...o.programmes, ...released.filter((r) => !o.programmes.some((p) => p.slug === r.slug))];` → `      const slugs = [...o.programmes];` | `dead-coordinator-policy.test.ts`: `1 failed \| 38 passed (39)` — an act that RELEASED a worker and stopped is recorded though it closed nothing<br>`dead-coordinator-lane.test.ts`: `1 failed \| 27 passed (28)` — a revive that lands AFTER the worker was released is recorded |
| RF.7 | `server/src/watch.ts`: `      if (done !== null && done.programmes.length > 0) { ⏎         recordDeadCoordinatorFeed(` → `      if (false) { ⏎         recordDeadCoordinatorFeed(` | `dead-coordinator-lane.test.ts`: `1 failed \| 27 passed (28)` — an act that THROWS after closing a programme keeps that programme’s feed row, and the attention entry says what closed |
| RF.8 | `server/src/deadCoordinator.ts`: `        if (closed > 0 && left === 0) {` → `        if (closed > 0) {` | `dead-coordinator-policy.test.ts`: `3 failed \| 36 passed (39)` — a programme the act closed only PART of is never announced as ended (and two more of the words cases) |
| RF.9 | `server/src/deadCoordinator.ts`: the breaker sentence's line ``      + `A lane gap of more than ${DEAD_COORDINATOR_GAP_MS / 60_000} minutes (a restart, a pause, a stale mirror) trips it too: it re-anchors every crashed coordinator together. ` ⏎ `` → (removed) | `dead-coordinator-policy.test.ts`: `1 failed \| 38 passed (39)` — a cluster is not blamed on a box fault alone: a lane gap of over ten minutes re-anchors every crashed coordinator together |
| RF.10 | `server/src/archivedExpiry.ts`: `    if (expiryReportIsFinal(entry.report)) return eligibleSince === entry.eligibleSince ? entry : { ...entry, eligibleSince };` → `    if (false) return eligibleSince === entry.eligibleSince ? entry : { ...entry, eligibleSince };` | `archived-expiry-policy.test.ts`: `2 failed \| 50 passed (52)` — a hold never hides a row the lane has stopped asking; a hold that REPLACES a would-expire, in-use or retryable failing report resets nextAskAt |
| RF.11 | `server/src/archivedExpiry.ts`: `...(replaces ? { nextAskAt: 0 } : {}),` → `...({}),` | `archived-expiry-policy.test.ts`: `1 failed \| 51 passed (52)`<br>`archived-expiry-lane.test.ts`: `1 failed \| 28 passed (29)` — would-expire, then held, then released: the row is listed again within the twice-observed passes |
````

- [ ] **Step 4: Run — green**, and the guards the plan's files feed: `dead-coordinator-prose` `12 passed (12)`; `deviation-refs` (after `git fetch origin main`) `31 passed (31)`; the five citation cases `5 passed | 330 skipped (335)`.

- [ ] **Step 5: The mutation rows** are Step 2's red stage: withholding Step 3's §5.4 blocks reds the first pin, withholding the README block reds the second (measured together, `2 failed | 10 passed (12)`). The F12 rows Step 3 writes are themselves measured mutation rows (each red at `b0647d850`, one file per process).

- [ ] **Step 6: Commit.** `docs(lifecycle): §5.4 says what an abandoned programme row does; the wave-4 plan's counts and rows corrected (review 339, F5–F12)`.

---

### Task 8: A `failed` `state-changed` is printed before the breadcrumb — and audited afresh (ruling B1; its reading ruled on question (h) — an ARMING BLOCKER for the expiry lane)

**Model routing:** `sonnet`, effort `high` — a census over ccd/ccd is the guard, and it must red on a producer it has not placed.

**Files:** `server/src/archivedExpiry.ts` (`EXPIRE_PRE_CRUMB_FAILED`, `isExpirePreCrumbFailed`, `parseExpireResult`, the `restart` reading and outcome, `archivedExpiryNextEntry`'s `restart` arm), `server/src/coord/expireArchived.ts` (the `restart` outcome and its feed row); tests `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts`.

**Interfaces:** `export const EXPIRE_PRE_CRUMB_FAILED = ['probe-unmeasured', 'state-changed'] as const;` and `isExpirePreCrumbFailed(word)` — the words ccd prints before THIS attempt's tombstone and breadcrumb. Each is READ its own way, and **the coordinator ruled question (h) on 2026-10-08: a `failed` `state-changed` is AUDITED AFRESH, not final** — the reclaim side's "not resumable" means "start over". So `parseExpireResult`'s `failed` arm reads any other word `resumable: true` (unchanged), `probe-unmeasured` `resumable: false` (unchanged: final, `main`'s reading), and `state-changed` as a new reading, `{ kind: 'restart', detail }` — a third arm of `ExpireVerbRead`, never an overloaded `resumable` (a boolean cannot carry three readings). `ArchivedExpiryOutcome` gains the same arm (`EXPIRY_OUTCOME_KINDS` with it), `expireArchived` passes it through, and `archivedExpiryNextEntry`'s `restart` arm FORGETS what the lane learned of the row: `expiresAt: null`, `eligibleSince: null`, the failure run reset, `report: null`, `nextAskAt` one pass on. The lane holds no token — every act audits first and spends THAT audit's token (`expireArchived`, step 5) — so what it forgets is the instant and the sightings: the row returns to LEARNING, on the learning audit's own cadence and backoff, and is asked again only once seen eligible twice past its instant, with a token a fresh audit minted over what stands. No attention entry (nothing was deleted); the feed row (`archived workspace changed under its cleanup`) says the workspace changed under the expiry's consent — its branch was deleted or made inside the lock — so nothing was deleted, and the lane audits it afresh (the departure `a-failed-state-changed-audits-afresh`). The census test is a STOPPING LINE, not a spelling: it walks every non-comment line of ccd/ccd, takes EVERY occurrence of either word as a bare token, and places each by the function that holds it and by its shape — `failed` (`_ws_reclaim_fail "<id>" "<lctx>" <word>` or `_ws_reclaim_failed_json <word>`), `refused` (`_reap_refuse <word>`, or a `{"refused":"<word>"` printf), `journal` (ws-audit's `_lc_fail reclaim … <word>`) or `unplaced` — and holds the whole list exactly. So a producer spelled any other way (a quoted word, the word on a continuation line, a raw printf, a variable that carries it) reds as `unplaced`, and a placed shape anywhere new (the shared tail, a pin, a helper) reds by the list. The one shape no text scan sees, a word assembled at run time from parts, does not occur in ccd. It also requires `_ws_expire_locked`'s `failed` `state-changed` to lie on the FRESH arm — after `if [[ -z "$phase" ]]` and before the `_reg_set "$id" reaping "expire:$start"` breadcrumb write — so moving the check to the verdict point (every arm) or below the breadcrumb reds (rows T11.3, T11.4). The census is what proves that a `state-changed` the expiry prints deleted nothing, and so that starting over is safe. The docstring of `EXPIRE_PRE_CRUMB_FAILED` says what is true of `probe-unmeasured`: printed before THIS attempt's tombstone and breadcrumb, on every arm, so after an earlier attempt's breadcrumb on a resumed one — read final in this wave, routed to this programme's wave 6 (the header's known gap, an arming blocker until then). **Residual, stated (the act-safety lens of 2026-10-08): the `restart` arm carries no count.** A `state-changed` that recurs on every attempt composes `ws-expire` again about every three passes (two eligible sightings at `CHILD_RECLAIM_SWEEP_MS`), writes its feed row once (`lastOutcome` stays `restart` across the learn), and is never listed and never reaches the persistent tier. Only a racing actor that keeps making or deleting `ws/<slug>` inside the lock can cause that — both reads go through `_ws_reclaim_tip_read` against the same `main`, and an unmeasured read fails the pin first — and every attempt is non-destructive under a fresh consent (Task 11), so it is invisibility, not deletion. A restart count that climbs the failure ladder is this programme's wave 6.

- [ ] **Step 1: The tests (red).** The parser's three readings; the census; a memory case for the `restart` arm; and a lane case — an armed expiry answered `failed` `state-changed` once is learned again, seen eligible twice, composed again with a fresh audit's token, and finished, with no attention entry and a feed row that says why.

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 78):

````ts
  expireTokenKind, expiryAttention, expiryInUseSentence, expiryReportSentence, parseExpireAudit, parseExpireResult, reviewKeeps,
````

Replace with:

````ts
  EXPIRE_PRE_CRUMB_FAILED, expireTokenKind, expiryAttention, expiryInUseSentence, expiryReportSentence, parseExpireAudit, parseExpireResult, reviewKeeps,
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 79):

````ts
    expect(parseExpireResult(ID, '', '')).toMatchObject({ kind: 'failed', resumable: true });
    expect(parseExpireResult(ID, JSON.stringify({ expired: 'other' }), '').kind, 'another row’s expiry').toBe('failed');
  });
});
````

Replace with:

````ts
    expect(parseExpireResult(ID, '', '')).toMatchObject({ kind: 'failed', resumable: true });
    expect(parseExpireResult(ID, JSON.stringify({ expired: 'other' }), '').kind, 'another row’s expiry').toBe('failed');
  });

  it('a `failed` state-changed is printed before the breadcrumb: read `restart` (audit afresh), never final — probe-unmeasured stays final, pin-failed and tombstone-unwritable resumable (wave 5)', () => {
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'state-changed', detail: 'x' }), ''))
      .toEqual({ kind: 'restart', detail: 'state-changed: x' });
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'probe-unmeasured', detail: 'x' }), ''))
      .toEqual({ kind: 'failed', resumable: false, detail: 'probe-unmeasured: x' });
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'tombstone-unwritable', detail: 'x' }), ''))
      .toEqual({ kind: 'failed', resumable: true, detail: 'tombstone-unwritable: x' });
    expect([...EXPIRE_PRE_CRUMB_FAILED].sort()).toEqual(['probe-unmeasured', 'state-changed']);
  });

  it('THE CENSUS: every site of either word in ccd/ccd is placed, and the expiry’s failed state-changed is on its FRESH arm, before the breadcrumb (wave 5)', () => {
    // A STOPPING LINE, not a spelling. EVERY non-comment occurrence of either word anywhere in ccd/ccd is placed: by the
    // function that holds it, and by what the line does with it — `failed` (`_ws_reclaim_fail "<id>" "<lctx>" <word>`
    // or `_ws_reclaim_failed_json <word>`), `refused` (`_reap_refuse <word>`, or a `{"refused":"<word>"` printf) or
    // `journal` (ws-audit's `_lc_fail reclaim … <word>` row). The whole list is held exactly, so a producer spelled any
    // other way — a quoted word, the word on a continuation line, a raw printf, a variable that carries it — still
    // carries the bare token, reads `unplaced`, and reds; so does a new site of a placed shape anywhere else (the
    // shared tail, a pin, a helper an expiry calls). The one shape no text scan sees is a word assembled at run time
    // from parts; ccd has none. `_ws_reclaim_locked` is ws-reclaim's own verb, which an expiry never reaches.
    //   `_ws_expire_locked`'s failed `state-changed` must lie on its FRESH arm — after `if [[ -z "$phase" ]]` and
    // before the `expire:` breadcrumb write — so nothing this verb started stands when it prints. Its
    // `probe-unmeasured` prints at the verdict point, on EVERY arm: on a fresh expiry before anything, and on a
    // RESUMED one after an earlier attempt's breadcrumb (`_ws_expire_resume_eval`'s unmeasured exits). That is main's
    // reading, a known gap routed to this programme's wave 6 (an arming blocker until then), and this census records it
    // rather than hides it.
    const fnStarts = [...ccd.matchAll(/\n([A-Za-z_][A-Za-z0-9_]*)\(\) \{/g)].map((m) => ({ name: m[1]!, at: m.index! }));
    const holder = (at: number): string => fnStarts.filter((f) => f.at < at).at(-1)?.name ?? '';
    const lockedAt = ccd.indexOf('\n_ws_expire_locked() {');
    const freshAt = ccd.indexOf('\n  if [[ -z "$phase" ]]; then', lockedAt);
    const crumbAt = ccd.indexOf('_reg_set "$id" reaping "expire:$start"', lockedAt);
    expect(lockedAt, 'the expiry\'s locked body').toBeGreaterThan(-1);
    expect(freshAt, 'its fresh arm').toBeGreaterThan(lockedAt);
    expect(crumbAt, 'its breadcrumb write, on that arm').toBeGreaterThan(freshAt);
    const shape = (w: string, pre: string): string =>
      new RegExp(`(?:_ws_reclaim_fail "[^"\\n]*" "[^"\\n]*" |_ws_reclaim_failed_json )${w}$`).test(pre) ? 'failed'
        : new RegExp(`(?:_reap_refuse |\\{"refused":")${w}$`).test(pre) ? 'refused'
          : new RegExp(`_lc_fail reclaim "[^"\\n]*" "[^"\\n]*" ${w}$`).test(pre) ? 'journal' : 'unplaced';
    const word = new RegExp(`(?<![\\w-])(${EXPIRE_PRE_CRUMB_FAILED.join('|')})(?![\\w-])`, 'g');
    const placed: string[] = [];
    let at = 0;
    for (const l of ccd.split('\n')) {
      if (!/^\s*#/.test(l)) {
        for (const m of l.matchAll(word)) {
          const w = m[1]!;
          const where = at + m.index!;
          const fn = holder(where);
          const kind = shape(w, l.slice(0, m.index! + w.length));
          if (fn === '_ws_expire_locked' && kind === 'failed' && w === 'state-changed') {
            expect(where, 'state-changed in _ws_expire_locked is not on its fresh arm').toBeGreaterThan(freshAt);
            expect(where, 'state-changed in _ws_expire_locked prints after the breadcrumb').toBeLessThan(crumbAt);
          }
          placed.push(`${fn} ${kind} ${w}`);
        }
      }
      at += l.length + 1;
    }
    expect(placed).toEqual([
      'cmd_ws_audit journal probe-unmeasured',
      '_ws_reap_locked refused state-changed',
      '_ws_reap_locked refused state-changed',
      '_ws_reap_tail refused state-changed',
      '_ws_reclaim_locked refused state-changed',
      '_ws_reclaim_locked failed probe-unmeasured',
      '_ws_reclaim_locked failed state-changed',
      '_ws_expire_resume_eval refused state-changed',
      '_ws_expire_locked refused state-changed',
      '_ws_expire_locked failed probe-unmeasured',
    ]);
  });
});
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 80):

````ts
  it('a `not-expired` at the act learns the AUDIT’s instant and starts the twice-observed rule again', () => {
````

Replace with:

````ts
  it('a failed state-changed (`restart`) starts over: the instant and the sightings are forgotten and learned afresh — no report, never final (wave 5)', () => {
    // The coordinator's ruling on the wave-5 plan's question (h): the reclaim side's "not resumable" means start over.
    // Nothing was deleted, so nothing is listed; a run of failures before it is about a state that no longer stands.
    const failing = archivedExpiryNextEntry(e(), { kind: 'failed', resumable: true, detail: 'pin-failed' }, NOW - EXPIRE_FAILURE_CEILING_MS, PASS)!;
    const x = archivedExpiryNextEntry({ ...failing, report: { kind: 'failing', at: NOW - EXPIRE_FAILURE_CEILING_MS, detail: 'pin-failed' } },
      { kind: 'restart', detail: 'state-changed: moved' }, NOW, PASS)!;
    expect(x).toMatchObject({ expiresAt: null, eligibleSince: null, nextAskAt: NOW + PASS, report: null, failures: 0,
      failingSince: null, lastOutcome: 'restart' });
    expect(archivedExpiryDue(x, NOW + PASS), 'not due: it is learned again first').toBe(false);
  });

  it('a `not-expired` at the act learns the AUDIT’s instant and starts the twice-observed rule again', () => {
````

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 81):

````ts
describe('a failure that will not resume (review 313, parked item 4)', () => {
````

Replace with:

````ts
describe('a failed state-changed is audited afresh (wave 5)', () => {
  it('the lane forgets what it learned, audits again, and composes again only once seen eligible twice — no attention entry; the feed row says why', async () => {
    let n = 0;
    const f = await fixture({ expire: (id) => (n += 1) === 1
      ? { code: 1, stdout: JSON.stringify({ failed: 'state-changed', detail: `ws/${id} read present when the token was checked inside the lock, but absent when the pin read it again` }), stderr: '' }
      : { code: 0, stdout: JSON.stringify({ expired: id, archivedAt: OLD, wip: null, attic: 2, residueBytes: 0, secretsDropped: 0, clipsKept: null, tmpRootKept: null }), stderr: '' } });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    expect(f.verbsFor('ws-expire')).toEqual(['demo-a']);
    expect(f.entry('demo-a'), 'back to learning').toMatchObject({ expiresAt: null, eligibleSince: null, report: null });
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention ?? [], 'nothing was deleted: nothing is listed').toEqual([]);
    expect(f.coord.feedEvents(5).find((e) => e.title === 'archived workspace changed under its cleanup')?.body)
      .toContain('its branch was deleted or made inside the lock (state-changed: ws/demo-a read present');
    const audits = f.verbsFor('ws-audit').length;
    f.next(); await f.pass();
    expect(f.verbsFor('ws-audit'), 'the next pass learns the instant afresh').toHaveLength(audits + 1);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'seen eligible once: not yet').toEqual(['demo-a']);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'seen twice: composed again, with its own fresh audit’s token').toEqual(['demo-a', 'demo-a']);
    expect(f.verbsFor('ws-audit'), 'the act audited first').toHaveLength(audits + 2);
    expect(f.entry('demo-a'), 'and finished').toBeUndefined();
  });
});

describe('a failure that will not resume (review 313, parked item 4)', () => {
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
```

Measured: `archived-expiry-policy.test.ts`: `3 failed | 52 passed (55)` — × a `failed` state-changed is printed before the breadcrumb: read `restart` …; × THE CENSUS … (the import is not there yet); × a failed state-changed (`restart`) starts over …; `archived-expiry-lane.test.ts`: `1 failed | 29 passed (30)` — × the lane forgets what it learned … (`back to learning`: the row kept its instant).

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 82):

````ts
/** `ccd ws-expire …`'s answer (wave 3's plan, "Wave 3b inherits", the verb). Three documents — `expired` and
````

Replace with:

````ts
/** The ws-expire `{"failed":…}` words that ccd prints before THIS attempt's tombstone and breadcrumb — so this attempt
 *  started nothing, and neither is retried from where it stopped (the reclaim side's twin is CCR-15's 4457). Each is
 *  READ its own way (`parseExpireResult`):
 *   - `probe-unmeasured`: `_ws_expire_locked`'s unmeasured verdict, printed at its verdict point, before any intent —
 *     on EVERY arm. Read FINAL: reported at once and not asked again for this archive (review 313's parked item 4).
 *     On a fresh expiry nothing stands. On a RESUMED one an earlier attempt's breadcrumb stands and its tree may be
 *     part-deleted (`_ws_expire_resume_eval`'s unmeasured exits: a tombstone it cannot read, or a tmux probe that did
 *     not answer), and the word reads final there too. That is main's reading, kept in this wave: the fix is this
 *     programme's wave 6, once CCR-15 wave 7 is on main — `_ws_expire_locked` sets wave 7's `crumb` on its resumed
 *     arm, and a failed document with `crumb: true` reads resumable — and until then it is an ARMING BLOCKER for the
 *     expiry lane;
 *   - `state-changed`: the consent binding — the in-lock recompute and the pin read the branch differently — printed
 *     on the FRESH arm only, after the pin (which only keeps) and before the tombstone and the breadcrumb (workspace
 *     lifecycle wave 5). Read `restart`: the reclaim side's "not resumable", which means START OVER, never final —
 *     the lane forgets what it learned of the row and audits it afresh (the coordinator's ruling on the wave-5 plan's
 *     question (h)). Also a REFUSAL word (`EXPIRE_TOKEN_KIND`, retried), which is a different document:
 *     `{"refused":…}` at exit 0.
 *  MEASURED, not assumed: `archived-expiry-policy.test.ts` places every occurrence of either word in ccd/ccd, by its
 *  function and its shape, and holds the expiry's `failed` `state-changed` on its fresh arm, before the breadcrumb.
 *  `pin-failed` and `tombstone-unwritable` are NOT here: the shared tail prints each after the breadcrumb (eight and
 *  five producers), so the word alone cannot say nothing started — they stay resumable until that `crumb` field. */
export const EXPIRE_PRE_CRUMB_FAILED = ['probe-unmeasured', 'state-changed'] as const;

/** Is this `{"failed":…}` word one printed before this attempt's tombstone and breadcrumb (`EXPIRE_PRE_CRUMB_FAILED`)? */
export const isExpirePreCrumbFailed = (word: string): boolean => (EXPIRE_PRE_CRUMB_FAILED as readonly string[]).includes(word);

/** `ccd ws-expire …`'s answer (wave 3's plan, "Wave 3b inherits", the verb). Three documents — `expired` and
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 83):

````ts
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string };

export function parseExpireResult(sessionId: string, stdout: string, stderr: string): ExpireVerbRead {
````

Replace with:

````ts
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
  /** A `failed` document the lane must START OVER from (wave 5, the coordinator's ruling on question (h)): ccd printed
   *  it before anything started, and what it consented to has changed, so neither a retry of this attempt nor a final
   *  report is the truth — a fresh audit of what stands is (`state-changed`, `EXPIRE_PRE_CRUMB_FAILED`). */
  | { readonly kind: 'restart'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string };

export function parseExpireResult(sessionId: string, stdout: string, stderr: string): ExpireVerbRead {
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 84):

````ts
      return { kind: 'failed', resumable: v.failed !== 'probe-unmeasured', detail: detail === '' ? v.failed : `${v.failed}: ${detail}` };
````

Replace with:

````ts
      const said = detail === '' ? v.failed : `${v.failed}: ${detail}`;
      if (!isExpirePreCrumbFailed(v.failed)) return { kind: 'failed', resumable: true, detail: said };
      // Printed before this attempt's tombstone and breadcrumb: `state-changed` starts over, `probe-unmeasured` is final.
      return v.failed === 'state-changed' ? { kind: 'restart', detail: said } : { kind: 'failed', resumable: false, detail: said };
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 85):

````ts
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string }
  | { readonly kind: 'no-evidence' };
````

Replace with:

````ts
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
  /** ccd stopped before anything started because what the expiry consented to changed (`ExpireVerbRead.restart`):
   *  the lane forgets what it learned of the row and audits it afresh (wave 5). */
  | { readonly kind: 'restart'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string }
  | { readonly kind: 'no-evidence' };
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 86):

````ts
  expired: true, 'would-expire': true, deferred: true, refused: true, gone: true, failed: true, box: true,
````

Replace with:

````ts
  expired: true, 'would-expire': true, deferred: true, refused: true, gone: true, failed: true, restart: true, box: true,
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 87):

````ts
    case 'composition':
      return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
````

Replace with:

````ts
    case 'restart':
      // START OVER (wave 5, question (h) ruled): ccd stopped before anything started because what the expiry consented
      // to changed. The instant learned and the sightings are forgotten — the row goes back to learning, on the
      // learning audit's own cadence and backoff, and is asked again only once seen eligible twice past its instant,
      // with a token a fresh audit minted over what stands. No report: nothing was deleted (the feed row says so).
      return { ...base, ...steady, expiresAt: null, eligibleSince: null, nextAskAt: nowMs + passMs, report: null };
    case 'composition':
      return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 88):

````ts
    case 'failed': return answer({ kind: 'failed', resumable: verb.resumable, detail: verb.detail });
````

Replace with:

````ts
    case 'failed': return answer({ kind: 'failed', resumable: verb.resumable, detail: verb.detail });
    case 'restart': return answer({ kind: 'restart', detail: verb.detail });
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 89):

````ts
  failed: 'archived workspace cleanup failed',
````

Replace with:

````ts
  failed: 'archived workspace cleanup failed',
  restart: 'archived workspace changed under its cleanup',
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 90):

````ts
      : 'It is not retried: the box said it will not resume, so the lane stops asking for this archive.'}`;
````

Replace with:

````ts
      : 'It is not retried: the box said it will not resume, so the lane stops asking for this archive.'}`;
    case 'restart': return `${who}: the workspace changed under the expiry's consent — its branch was deleted or made `
      + `inside the lock (${r.detail}) — so nothing was deleted, and the lane audits it afresh.`;
````

- [ ] **Step 4: Run — green.** Measured: `archived-expiry-policy` `55 passed (55)`; `archived-expiry-lane` `30 passed (30)`; `expire-archived` `19 passed (19)`; `mail-routes` `59 passed (59)` (its kebab scan of `server/src/coord` meets the new `restart` literal, which has no hyphen); `( cd server && ./node_modules/.bin/tsc --noEmit -p . )` rc 0.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T8.1 | `server/src/archivedExpiry.ts`: `      return v.failed === 'state-changed' ? { kind: 'restart', detail: said } : { kind: 'failed', resumable: false, detail: said };` → `      return { kind: 'failed', resumable: false, detail: said };` (the drafted plan's FINAL reading) | `archived-expiry-policy.test.ts`: `1 failed \| 54 passed (55)` — a `failed` state-changed is printed before the breadcrumb: read `restart` …<br>`archived-expiry-lane.test.ts`: `1 failed \| 29 passed (30)` — the lane forgets what it learned … (`back to learning`) |
| T8.2 | `ccd/ccd` (the shared tail, a post-breadcrumb site): `_ws_reclaim_fail "$id" "$lctx" branch-moved "$branch moved after it was pinned` → `_ws_reclaim_fail "$id" "$lctx" state-changed "$branch moved after it was pinned` | `archived-expiry-policy.test.ts`: `1 failed \| 54 passed (55)` — THE CENSUS … (`_ws_reclaim_tail failed state-changed`, a site the list does not hold: `expected [ …(11) ] to deeply equal [ …(10) ]`) |
| T8.3 | the same line → `_ws_reclaim_fail "$id" "$lctx" "state-changed" "$branch moved after it was pinned` (the word QUOTED — the safety lens's spelling the drafted regex missed) | `archived-expiry-policy.test.ts`: `1 failed \| 54 passed (55)` — THE CENSUS … (`_ws_reclaim_tail unplaced state-changed`: `expected [ …(11) ] to deeply equal [ …(10) ]`) |
| T8.4 | the same line → `_ws_reclaim_fail "$id" "$lctx" \ ⏎           state-changed "$branch moved after it was pinned` (the word on a continuation line) | `archived-expiry-policy.test.ts`: `1 failed \| 54 passed (55)` — THE CENSUS … (`unplaced`) |
| T8.5 | `server/src/archivedExpiry.ts`: `      if (!isExpirePreCrumbFailed(v.failed)) return { kind: 'failed', resumable: true, detail: said };` → `      if (v.failed !== 'probe-unmeasured') return { kind: 'failed', resumable: true, detail: said };` (`main`'s RESUMABLE reading of `state-changed`) | `archived-expiry-policy.test.ts`: `1 failed \| 54 passed (55)` — a `failed` state-changed is printed before the breadcrumb: read `restart` …<br>`archived-expiry-lane.test.ts`: `1 failed \| 29 passed (30)` — the lane forgets what it learned … (`back to learning`) |
| T8.6 | `server/src/archivedExpiry.ts`: `      return { ...base, ...steady, expiresAt: null, eligibleSince: null, nextAskAt: nowMs + passMs, report: null };` → `      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null };` (the instant and the sightings KEPT: asked again at once over the old learning) | `archived-expiry-policy.test.ts`: `1 failed \| 54 passed (55)` — a failed state-changed (`restart`) starts over …<br>`archived-expiry-lane.test.ts`: `1 failed \| 29 passed (30)` — the lane forgets what it learned … (`back to learning`) |

- [ ] **Step 6: Commit.** `fix(lifecycle): the expiry audits afresh after a failed state-changed — every producer prints before the breadcrumb (ruling B1; question (h) ruled)`.

---

### Task 9: The kept-leaf reader (ruling B2)

**Model routing:** `sonnet`, effort `high` — a wire word, a reader of an additive key, and an entry that outlives its row.

**Files:** `server/src/archivedExpiry.ts`, `server/src/coord/expireArchived.ts`, `server/src/watch.ts` (the expiry lane's forgetting), `shared/api.ts` (`ExpiryAttention.kind`), `pwa/src/fleet/expiryWords.ts`; tests `server/test/archived-expiry-policy.test.ts`, `server/test/expire-archived.test.ts`, `server/test/archived-expiry-lane.test.ts`.

**Interfaces:**
- **One kept-word reader, two carriers** (the coordinator's R3 of 2026-10-08, agreed with CCR-15). `export function keptLeafWord(v: unknown): KeptLeafWord` — `KeptLeafWord` is `'refused' | 'unmeasured' | 'in-use'`, derived from one `as const` list — is THE WORD HALF and the ONE word reader of `clipsKept`/`tmpRootKept`: ccd's three words map to themselves; any other value is `'unmeasured'` (ccd prints only its three, so another value means a leaf stood). `export type ExpireLeafKept = KeptLeafWord | null | 'unreported';` and `expireLeafKept(doc, 'clipsKept' | 'tmpRootKept')` keep their type and behaviour: the done document's CARRIER composed with `keptLeafWord` — ABSENT → `'unreported'` (an older ccd — never folded into `null`, which reads "removed"); `null` → `null`; any other value → its word. The docstring says `keptLeafWord` is the ONE word reader of `clipsKept`/`tmpRootKept`, and that CCR-15 wave 8's mirror carrier (a word, `'unreported'` or `'truncated'`) imports it, or moves it to a neutral L1 home — a move, never a second copy. Named keys only: a newer ccd's other keys change nothing here (agent-first stays safe). `ExpireKept = { clips; tmpRoot }`; `expireKeptAny(k)` is true only for a WORD on either leaf.
- `ExpireVerbRead`'s and `ArchivedExpiryOutcome`'s `expired` arms carry `kept: ExpireKept`. `expireArchived` passes it through.
- **The decision on absence (the coordinator's lean, adopted).** A kept word raises an attention entry; an absent key is recorded in the feed row only ("whether its clips directory and temp root were removed is not reported by this box's ccd (an older build), so it is unmeasured"). Justification: absence is not evidence that anything was kept — the tail always removes or keeps and an older ccd only cannot say which — and during the agent-first rollout skew every expiry would otherwise raise an alarm the operator can do nothing about; the feed row is the durable record, so nothing is hidden (the departure `an-older-ccds-silence-is-the-feed-rows-only`).
- `archivedExpiryNextEntry`'s `expired` arm: a kept word returns an entry whose report is `{ kind: 'kept', at, clips, tmpRoot }`, with `nextAskAt` +∞ and `eligibleSince` null; anything else finishes the row (`null`) as before. `expiryReportIsFinal` counts `kept`, so a hold never replaces it. The lane's pass keeps a `kept` entry although its row has left the registry (ccd purged it): it is the only trace of what stays on disk, and it is listed until a restart forgets it (the departure `a-kept-leaf-is-listed-until-restart`). If the same id is archived again later, its new archive starts a fresh entry, as today.
- The sentence: "cleaned up, but ccd kept its clips directory (in-use: a process still used it after the bounded wait). The worktree, the branch and the registry row are gone and its commits are in the attic; what was kept stays on disk, and the lane deletes nothing more of it. Find out what holds it before removing it by hand." The feed row of an `expired` outcome appends what was kept and why (`; ccd kept … — it stays on disk`). No new `ExpireToken` word.
- `ExpiryAttention.kind` gains `'kept'` (additive; one line in place); the PWA's `EXPIRY_KIND_WORD` gains `kept: 'cleaned up, kept'` (a `Record` over the union, so omitting it fails `tsc` — row T9.6). An older PWA reads an unknown kind as `reported` (`expiryKindWord`'s fallback).

- [ ] **Step 1: The tests (red).** The parser's `expired` case carries `kept` (both keys absent there: `unreported`); the `expired` next-entry case passes `kept: { clips: null, tmpRoot: null }`; a policy case pins `keptLeafWord` on its own; a policy case reads the keys four ways, words the entry, and lists a temp root kept on its own (clips `null`) as well as a kept clips directory; an executor case reads a kept temp root into the outcome and the feed row, and an older ccd's silence into the feed row; two lane cases — a kept clips directory listed after ccd purged the row, and an older ccd's expiry raising nothing.

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 91):

````ts
  EXPIRE_PRE_CRUMB_FAILED, expireTokenKind, expiryAttention, expiryInUseSentence, expiryReportSentence, parseExpireAudit, parseExpireResult, reviewKeeps,
````

Replace with:

````ts
  EXPIRE_PRE_CRUMB_FAILED, expireTokenKind, expiryAttention, expiryInUseSentence, expiryReportSentence, keptLeafWord, parseExpireAudit, parseExpireResult, reviewKeeps,
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 92):

````ts
      residueBytes: 0, secretsDropped: 0 }), '')).toEqual({ kind: 'expired', archivedAt: 1_789_000_000, wip: null, secretsDropped: 0 });
````

Replace with:

````ts
      residueBytes: 0, secretsDropped: 0 }), '')).toEqual({ kind: 'expired', archivedAt: 1_789_000_000, wip: null, secretsDropped: 0,
      kept: { clips: 'unreported', tmpRoot: 'unreported' } });
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 93):

````ts
    expect(archivedExpiryNextEntry(e(), { kind: 'expired' }, NOW, PASS)).toBeNull();
````

Replace with:

````ts
    expect(archivedExpiryNextEntry(e(), { kind: 'expired', kept: { clips: null, tmpRoot: null } }, NOW, PASS)).toBeNull();
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 94):

````ts
  it('expired and gone finish the row; a terminal refusal and a composition error are never asked again, and reported', () => {
````

Replace with:

````ts
  it('keptLeafWord is the ONE word reader of a kept leaf: ccd’s three words are themselves, any other value is a leaf that stood (wave 5)', () => {
    for (const w of ['refused', 'unmeasured', 'in-use'] as const) expect(keptLeafWord(w)).toBe(w);
    for (const v of ['gone-sideways', '', 'IN-USE', ' in-use', 7, true, null, {}, []]) expect(keptLeafWord(v), JSON.stringify(v)).toBe('unmeasured');
  });

  it('THE KEPT-LEAF READER: clipsKept and tmpRootKept are read by name — a word, null, or ABSENT (an older ccd: unreported, never null) (wave 5)', () => {
    const doc = (over: Record<string, unknown>): string => JSON.stringify({ expired: ID, archivedAt: 1_789_000_000, wip: null, secretsDropped: 0, ...over });
    const kept = (over: Record<string, unknown>) => (parseExpireResult(ID, doc(over), '') as { kept?: unknown }).kept;
    expect(kept({ clipsKept: null, tmpRootKept: null })).toEqual({ clips: null, tmpRoot: null });
    expect(kept({ clipsKept: 'in-use', tmpRootKept: 'refused' })).toEqual({ clips: 'in-use', tmpRoot: 'refused' });
    expect(kept({ clipsKept: 'unmeasured', tmpRootKept: null })).toEqual({ clips: 'unmeasured', tmpRoot: null });
    expect(kept({}), 'an older ccd says nothing — never "removed"').toEqual({ clips: 'unreported', tmpRoot: 'unreported' });
    expect(kept({ clipsKept: 'gone-sideways', tmpRootKept: 7 }), 'a value this build does not know is a KEPT leaf').toEqual({ clips: 'unmeasured', tmpRoot: 'unmeasured' });
    // A kept word is reported, and never asked again; an older ccd's silence finishes the row like a clean expiry.
    const k = archivedExpiryNextEntry(e(), { kind: 'expired', kept: { clips: 'in-use', tmpRoot: null } }, NOW, PASS)!;
    expect(k).toMatchObject({ nextAskAt: Number.POSITIVE_INFINITY, report: { kind: 'kept', at: NOW, clips: 'in-use', tmpRoot: null } });
    expect(expiryReportSentence(k.report!, null)).toBe('cleaned up, but ccd kept its clips directory (in-use: a process still used it after '
      + 'the bounded wait). The worktree, the branch and the registry row are gone and its commits are in the attic; what was kept '
      + 'stays on disk, and the lane deletes nothing more of it. Find out what holds it before removing it by hand.');
    expect(archivedExpiryNextEntry(e(), { kind: 'expired', kept: { clips: null, tmpRoot: 'in-use' } }, NOW, PASS),
      'a temp root kept on its own is listed too').toMatchObject({ nextAskAt: Number.POSITIVE_INFINITY,
      report: { kind: 'kept', clips: null, tmpRoot: 'in-use' } });
    expect(archivedExpiryNextEntry(e(), { kind: 'expired', kept: { clips: 'unreported', tmpRoot: 'unreported' } }, NOW, PASS),
      'the rollout skew raises no alarm').toBeNull();
    expect(archivedExpirySighted(k, { eligible: false, why: 'held' }, 'x', NOW + PASS).report, 'a hold never takes its place').toEqual(k.report);
  });

  it('expired and gone finish the row; a terminal refusal and a composition error are never asked again, and reported', () => {
````

<!-- replay: replace server/test/expire-archived.test.ts -->
In `server/test/expire-archived.test.ts`, find (block 95):

````ts
  it('SHADOW (no `expire-lane-live`): audits and answers "would expire" — ws-expire is never composed', async () => {
````

Replace with:

````ts
  it('an expiry that KEPT a leaf carries the words, and its feed row says what was kept and why; an older ccd’s silence is said too (wave 5)', async () => {
    const doc = (over: Record<string, unknown>): string => JSON.stringify({ expired: ID, archivedAt: ARCH, wip: null, attic: 3, residueBytes: 0, secretsDropped: 0, ...over });
    const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) },
      verb: { code: 0, stdout: doc({ clipsKept: null, tmpRootKept: 'in-use' }) } } });
    const out = await expireArchived(s.deps, s.req);
    expect(out).toMatchObject({ kind: 'expired', kept: { clips: null, tmpRoot: 'in-use' } });
    recordExpireFeed({ coord: s.coord, notifyLog: s.deps.notifyLog }, out);
    expect(s.coord.feedEvents(5)[0]!.body).toContain('; ccd kept its temp root (in-use: a process still used it after the bounded wait) — it stays on disk.');
    const old = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) }, verb: { code: 0, stdout: doc({}) } } });
    const o2 = await expireArchived(old.deps, old.req);
    recordExpireFeed({ coord: old.coord, notifyLog: old.deps.notifyLog }, o2);
    expect(old.coord.feedEvents(5)[0]!.body).toContain('whether its clips directory and temp root were removed is not reported by this box’s ccd (an older build), so it is unmeasured');
  });

  it('SHADOW (no `expire-lane-live`): audits and answers "would expire" — ws-expire is never composed', async () => {
````

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 96):

````ts
  it('at most ONE ws-expire is composed per pass, fleet-wide', async () => {
````

Replace with:

````ts
  it('an expiry that KEPT a leaf is listed after its row is gone — the only trace of what stays on disk (wave 5)', async () => {
    const f: Fixture = await fixture({ expire: (id) => {
      for (const n of readdirSync(f.reg).filter((x) => x.startsWith(`${id}.`))) rmSync(path.join(f.reg, n));   // ccd purges the row
      return { code: 0, stdout: JSON.stringify({ expired: id, archivedAt: OLD, wip: null, attic: 2, residueBytes: 0, secretsDropped: 0,
        clipsKept: 'refused', tmpRootKept: null }), stderr: '' };
    } });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    expect(f.verbsFor('ws-expire')).toEqual(['demo-a']);
    for (let k = 0; k < 3; k += 1) { f.next(); await f.pass(); }
    await f.watcher.tick();
    const list = f.watcher.currentCoord()?.expiryAttention ?? [];
    expect(list.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'kept']]);
    expect(list[0]!.sentence).toContain('ccd kept its clips directory (refused');
    expect(f.verbsFor('ws-expire'), 'composed once — its row is gone, so there is nothing to ask again (the policy case pins the +∞)').toEqual(['demo-a']);
  });

  it('an OLDER ccd that reports no kept leaves raises no entry — the feed row says it is unmeasured (wave 5)', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    expect(f.entry('demo-a'), 'finished with').toBeUndefined();
    expect(f.coord.feedEvents(5).find((e) => e.title === 'archived workspace cleaned up')?.body).toContain('so it is unmeasured');
  });

  it('at most ONE ws-expire is composed per pass, fleet-wide', async () => {
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
```

Measured: `archived-expiry-policy.test.ts`: `3 failed | 54 passed (57)` — × the three documents, and an empty answer that is no die is a call cut short — resumable; × keptLeafWord is the ONE word reader of a kept leaf …; × THE KEPT-LEAF READER …; `expire-archived.test.ts`: `1 failed | 19 passed (20)` — × an expiry that KEPT a leaf carries the words …; `archived-expiry-lane.test.ts`: `2 failed | 30 passed (32)` — × an expiry that KEPT a leaf is listed after its row is gone …; × an OLDER ccd that reports no kept leaves raises no entry ….

- [ ] **Step 3: The source** (server, then the wire word, then the PWA's word).

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 97):

````ts
/** The ws-expire `{"failed":…}` words that ccd prints before THIS attempt's tombstone and breadcrumb — so this attempt
````

Replace with:

````ts
/** One leaf the shared tail removes last (the clips directory, the per-session temp root), as the `expired` document
 *  reports it (`clipsKept`, `tmpRootKept`; CCR-15's 4462): ccd's word for a leaf it KEPT — `refused` (its removal
 *  helper refused it), `unmeasured` (whether it could be removed could not be measured) or `in-use` (a process still
 *  used it after the bounded wait) — or `null` when nothing was kept. A key that is ABSENT is an older ccd's document,
 *  which says nothing either way: `unreported`, never folded into `null` (that would read "removed"). A value this
 *  build does not know is a kept leaf, `unmeasured` — ccd prints only its three words, and any other value means a
 *  leaf stood. Named keys only, so a newer ccd's other keys change nothing here (agent-first stays safe). */
export type ExpireLeafKept = KeptLeafWord | null | 'unreported';
const KEPT_LEAF_WORDS = ['refused', 'unmeasured', 'in-use'] as const;
/** ccd's three words for a leaf it kept. */
export type KeptLeafWord = typeof KEPT_LEAF_WORDS[number];

/** THE WORD HALF: the ONE word reader of `clipsKept`/`tmpRootKept`. ccd's three words map to themselves; any other
 *  value is `unmeasured` — a leaf stood. `null` and an absent key are the carrier's to tell, never this reader's: the
 *  caller asks them first (`expireLeafKept`, the done document's carrier). CCR-15 wave 8's mirror carrier (a word,
 *  `unreported` or `truncated`) imports this, or moves it to a neutral L1 home — a move, never a second copy. */
export function keptLeafWord(v: unknown): KeptLeafWord {
  return typeof v === 'string' && (KEPT_LEAF_WORDS as readonly string[]).includes(v) ? v as KeptLeafWord : 'unmeasured';
}

/** THE ONE READER of a kept-leaf key on the `expired` document — the done document's CARRIER composed with
 *  `keptLeafWord`, the one word reader of `clipsKept`/`tmpRootKept`: `null` → `null` (removed), ABSENT → `unreported`
 *  (an older ccd), and any other value → its word. */
export function expireLeafKept(doc: Record<string, unknown>, key: 'clipsKept' | 'tmpRootKept'): ExpireLeafKept {
  if (!Object.prototype.hasOwnProperty.call(doc, key)) return 'unreported';
  const v = doc[key];
  return v === null ? null : keptLeafWord(v);
}

/** What an expiry kept of its two leaves. */
export interface ExpireKept { readonly clips: ExpireLeafKept; readonly tmpRoot: ExpireLeafKept }

/** Did it keep anything — a word on either leaf? `unreported` is not a kept leaf: an older ccd said nothing, and a
 *  rollout skew must not raise an alarm on every expiry (it is recorded in the feed row only). */
export const expireKeptAny = (k: ExpireKept): boolean =>
  (k.clips !== null && k.clips !== 'unreported') || (k.tmpRoot !== null && k.tmpRoot !== 'unreported');

/** The ws-expire `{"failed":…}` words that ccd prints before THIS attempt's tombstone and breadcrumb — so this attempt
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 98):

````ts
      readonly secretsDropped: number | 'unreadable' }
````

Replace with:

````ts
      readonly secretsDropped: number | 'unreadable'; readonly kept: ExpireKept }
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 99):

````ts
      return { kind: 'expired', archivedAt: epochOrNull(v.archivedAt), wip, secretsDropped };
````

Replace with:

````ts
      return { kind: 'expired', archivedAt: epochOrNull(v.archivedAt), wip, secretsDropped,
        kept: { clips: expireLeafKept(v, 'clipsKept'), tmpRoot: expireLeafKept(v, 'tmpRootKept') } };
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 100):

````ts
  | { readonly kind: 'no-evidence'; readonly at: number };
````

Replace with:

````ts
  | { readonly kind: 'no-evidence'; readonly at: number }
  /** The expiry COMPLETED and kept a leaf (wave 5, the kept-leaf reader): the row is gone, so this report outlives it in
   *  the lane's memory — until a restart, which forgets it; the feed row is the durable record. */
  | { readonly kind: 'kept'; readonly at: number; readonly clips: ExpireLeafKept; readonly tmpRoot: ExpireLeafKept };
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 101):

````ts
  r !== null && ((r.kind === 'failing' && r.final === true) || (r.kind === 'refused' && EXPIRE_TOKEN_KIND[r.token] === 'terminal'));
````

Replace with:

````ts
  r !== null && ((r.kind === 'failing' && r.final === true) || (r.kind === 'refused' && EXPIRE_TOKEN_KIND[r.token] === 'terminal')
    || r.kind === 'kept');
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 102):

````ts
export type ArchivedExpiryOutcome =
  | { readonly kind: 'expired' }
````

Replace with:

````ts
export type ArchivedExpiryOutcome =
  /** `kept`: what the tail kept of its two leaves, CARRIED from the document (wave 5). */
  | { readonly kind: 'expired'; readonly kept: ExpireKept }
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 103):

````ts
    case 'expired': case 'gone': return null;
````

Replace with:

````ts
    case 'expired':
      // A completed expiry that KEPT a leaf is reported (wave 5): the row is gone, but what stays on disk is listed,
      // and never asked about again. An older ccd's silence (`unreported`) is the feed row's to say, not a report.
      return expireKeptAny(o.kept) ? { ...base, ...steady, eligibleSince: null, nextAskAt: Number.POSITIVE_INFINITY,
        report: { kind: 'kept', at: nowMs, clips: o.kept.clips, tmpRoot: o.kept.tmpRoot } } : null;
    case 'gone': return null;
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 104):

````ts
/** The words for one report. */
````

Replace with:

````ts
/** Why ccd kept a leaf, in words — the done document's word, never more (the reason itself is in the journal row). */
const LEAF_KEPT_WHY: Readonly<Record<KeptLeafWord, string>> = {
  refused: 'ccd’s removal helper refused it',
  unmeasured: 'whether it could be removed could not be measured',
  'in-use': 'a process still used it after the bounded wait',
};

/** The leaves an expiry kept, in words — `[]` when it kept none. `unreported` is not one (see `expireKeptAny`). */
export function expireKeptParts(k: Pick<ExpireKept, 'clips' | 'tmpRoot'>): string[] {
  const parts: string[] = [];
  for (const [what, w] of [['its clips directory', k.clips], ['its temp root', k.tmpRoot]] as const) {
    if (w !== null && w !== 'unreported') parts.push(`${what} (${w}: ${LEAF_KEPT_WHY[w]})`);
  }
  return parts;
}

/** The words for one report. */
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 105):

````ts
      return 'not cleaned up: the fleet box’s ccd does not say when this archive expires (an older build), so the '
        + 'server composes nothing for it until the box is updated.';
  }
````

Replace with:

````ts
      return 'not cleaned up: the fleet box’s ccd does not say when this archive expires (an older build), so the '
        + 'server composes nothing for it until the box is updated.';
    case 'kept':
      return `cleaned up, but ccd kept ${expireKeptParts(r).join(' and ')}. The worktree, the branch and the registry row are `
        + 'gone and its commits are in the attic; what was kept stays on disk, and the lane deletes nothing more of it. '
        + 'Find out what holds it before removing it by hand.';
  }
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 106):

````ts
  EXPIRE_LANE_LIVE_MARKER, EXPIRE_TOKEN_KIND, archivedExpiryStoreSkip, parseExpireAudit, parseExpireResult, reviewKeeps,
````

Replace with:

````ts
  EXPIRE_LANE_LIVE_MARKER, EXPIRE_TOKEN_KIND, archivedExpiryStoreSkip, expireKeptParts, parseExpireAudit, parseExpireResult, reviewKeeps,
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 107):

````ts
    case 'expired': return answer({ kind: 'expired' }, { wip: verb.wip, secretsDropped: verb.secretsDropped });
````

Replace with:

````ts
    case 'expired': return answer({ kind: 'expired', kept: verb.kept }, { wip: verb.wip, secretsDropped: verb.secretsDropped });
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 108):

````ts
      return `${who} was cleaned up: its commits are kept in the attic (ccd ws-attic --session ${r.sessionId}), ${wip}${secrets}.`;
````

Replace with:

````ts
      // What the tail kept of its two leaves (wave 5): each kept word, or — an older ccd that does not report them — that
      // whether they went is not known. Recorded here; only a kept word is an attention entry.
      const kept = expireKeptParts(r.kept);
      const leaves = kept.length > 0 ? `; ccd kept ${kept.join(' and ')} — it stays on disk`
        : r.kept.clips === 'unreported' || r.kept.tmpRoot === 'unreported'
          ? '; whether its clips directory and temp root were removed is not reported by this box’s ccd (an older build), so it is unmeasured'
          : '';
      return `${who} was cleaned up: its commits are kept in the attic (ccd ws-attic --session ${r.sessionId}), ${wip}${secrets}${leaves}.`;
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find (block 109):

````ts
    for (const id of [...this.archivedExpiryState.keys()]) if (!seen.has(id)) this.archivedExpiryState.delete(id);
````

Replace with:

````ts
    // A row that left the population is forgotten — save one whose expiry COMPLETED and kept a leaf (wave 5): it is gone
    // from the registry by definition, and its report is the only trace of what stays on disk until a restart.
    for (const [id, e] of [...this.archivedExpiryState]) if (!seen.has(id) && e.report?.kind !== 'kept') this.archivedExpiryState.delete(id);
````

<!-- replay: replace shared/api.ts -->
In `shared/api.ts`, find (block 110):

````ts
  readonly kind: 'would-expire' | 'held' | 'in-use' | 'refused' | 'failing' | 'no-evidence';
````

Replace with:

````ts
  readonly kind: 'would-expire' | 'held' | 'in-use' | 'refused' | 'failing' | 'no-evidence' | 'kept';
````

<!-- replay: replace pwa/src/fleet/expiryWords.ts -->
In `pwa/src/fleet/expiryWords.ts`, find (block 111):

````ts
  'no-evidence': 'no evidence',
};
````

Replace with:

````ts
  'no-evidence': 'no evidence',
  kept: 'cleaned up, kept',
};
````

- [ ] **Step 4: Run — green**, both typechecks and the PWA's row suite. Measured: `57 passed (57)`; `20 passed (20)`; `32 passed (32)`; `( cd server && ./node_modules/.bin/tsc --noEmit -p . )` rc 0; `( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )` rc 0; `( cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx --maxWorkers=1 )` `41 passed (41)`.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T9.1 | `server/src/archivedExpiry.ts`: `  if (!Object.prototype.hasOwnProperty.call(doc, key)) return 'unreported';` → `  if (!Object.prototype.hasOwnProperty.call(doc, key)) return null;` | `archived-expiry-policy.test.ts`: `2 failed \| 55 passed (57)`<br>`expire-archived.test.ts`: `1 failed \| 19 passed (20)`<br>`archived-expiry-lane.test.ts`: `1 failed \| 31 passed (32)` — an OLDER ccd … the feed row says it is unmeasured |
| T9.2 | `server/src/archivedExpiry.ts`: `      return expireKeptAny(o.kept) ? {` → `      return false ? {` | `archived-expiry-policy.test.ts`: `1 failed \| 56 passed (57)` — THE KEPT-LEAF READER …<br>`archived-expiry-lane.test.ts`: `1 failed \| 31 passed (32)` — an expiry that KEPT a leaf is listed after its row is gone … |
| T9.3 | `server/src/archivedExpiry.ts`: `  (k.clips !== null && k.clips !== 'unreported') \|\|` → `  (k.clips !== null) \|\|` | `archived-expiry-policy.test.ts`: `1 failed \| 56 passed (57)` — `the rollout skew raises no alarm`<br>`archived-expiry-lane.test.ts`: `2 failed \| 30 passed (32)` — the armed expiry and the OLDER-ccd case (`finished with`) |
| T9.4 | `server/src/watch.ts`: `if (!seen.has(id) && e.report?.kind !== 'kept') this.archivedExpiryState.delete(id);` → `if (!seen.has(id) && e !== undefined) this.archivedExpiryState.delete(id);` | `archived-expiry-lane.test.ts`: `1 failed \| 31 passed (32)` — an expiry that KEPT a leaf is listed after its row is gone … |
| T9.5 | `server/src/archivedExpiry.ts`: `    \|\| r.kind === 'kept');` → `);` (the line joined to the one above) | `archived-expiry-policy.test.ts`: `1 failed \| 56 passed (57)` — `a hold never takes its place` |
| T9.7 | `server/src/archivedExpiry.ts`: `  (k.clips !== null && k.clips !== 'unreported') \|\| (k.tmpRoot !== null && k.tmpRoot !== 'unreported');` → `  (k.clips !== null && k.clips !== 'unreported');` (the tmpRoot half dropped — the tests lens's survivor) | `archived-expiry-policy.test.ts`: `1 failed \| 56 passed (57)` — THE KEPT-LEAF READER … (`a temp root kept on its own is listed too: expected null`) |
| T9.6 | `pwa/src/fleet/expiryWords.ts`: `  kept: 'cleaned up, kept', ⏎ ` → (removed) | `( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )`: `error TS2741: Property 'kept' is missing in type …` (rc 2) |
| T9.8 | `server/src/archivedExpiry.ts`: `  return typeof v === 'string' && (KEPT_LEAF_WORDS as readonly string[]).includes(v) ? v as KeptLeafWord : 'unmeasured';` → `  return typeof v === 'string' ? v as KeptLeafWord : 'unmeasured';` (the word half reads any string as a word) | `archived-expiry-policy.test.ts`: `2 failed \| 55 passed (57)` — keptLeafWord is the ONE word reader … (`"gone-sideways": expected 'gone-sideways' to be 'unmeasured'`); THE KEPT-LEAF READER … (`a value this build does not know is a KEPT leaf`) |

- [ ] **Step 6: Commit.** `feat(lifecycle): an expiry that kept a leaf is listed; an older ccd's silence is the feed row's (ruling B2)`.

---

### Task 10: A day of resumable failures slows the asking — the persistent tier (ruling B3, revised)

**Model routing:** `sonnet`, effort `medium`.

**Files:** `server/src/archivedExpiry.ts` (`EXPIRE_FAILURE_GIVE_UP_MS`, `EXPIRE_PERSISTENT_RETRY_MS`, the `failing` report's `attempts`, `expiryReportStands` and the hold guard, `standingThrough`, `archivedExpiryNextEntry`'s failure arm and its shadow, no-evidence, deferral and refusal arms, the sentence); tests `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts`.

**Interfaces:** the coordinator REVISED B3 on 2026-10-08 (agreed with CCR-15's coordinator, answering its R69): the day-long STOP is a PERSISTENT TIER. Parked at +∞, a row stopped by a day of resumable failures — which may have failed after its breadcrumb, leaving a part-cleaned workspace — was asked again only after a server restart, however soon the operator fixed the cause. So: `export const EXPIRE_FAILURE_GIVE_UP_MS = 24 * 60 * 60_000;` (unchanged, a test holds it at 24 ceilings) and `export const EXPIRE_PERSISTENT_RETRY_MS = 4 * 60 * 60_000;`, defined ONCE beside `EXPIRE_FAILURE_CEILING_MS` and `EXPIRE_FAILURE_GIVE_UP_MS` (a test holds it at four ceilings). In the `failed` (resumable) / `box` arm, a run of failures whose first (`failingSince`) is a day old returns `nextAskAt` = now + `EXPIRE_PERSISTENT_RETRY_MS` — NEVER +∞ — and the report `{ kind: 'failing', at: failingSince, detail: <the last>, attempts: <failures> }`: the STANDING attention entry, with `attempts` and never `final` (the row is still asked). Each later failure updates it (attempts, the last detail) and keeps the four-hour cadence; a completed expiry finishes the row as today; a new `archivedAt` starts a fresh entry (`archivedExpiryEntryFor`, unchanged); the lane's memory is in-memory, so a restart re-learns. The sentence names the first failure's instant, the attempts and the last detail; says the expiry may have stopped part-way — failures after the breadcrumb (`worktree-remove-failed`, the tail's `pin-failed` and `tombstone-unwritable`) leave a part-cleaned workspace, and the server cannot tell until CCR-15 wave 7's `crumb` field — so what is left on disk is not known; says the lane asks again every four hours and keeps this entry until an attempt completes, finds that none had begun or stops for good, or the workspace is archived again; and never names a destructive verb. **Every reader of "final" was checked** (the ruling's ask), and — after the act-safety lens on the revised plan found three more — every ARM of `archivedExpiryNextEntry` a persistent row can reach, because unlike a final row it is still acted on:
>
> | Reader / arm | On `main` (with the tier added) | Here |
> |---|---|---|
> | `expiryReportIsFinal` | never asked again | unchanged; its one caller is the hold guard |
> | `archivedExpirySighted`'s hold guard (a hold the LANE sees) | a hold replaced the entry and reset its wait | asks `expiryReportStands` (final OR the tier's `attempts`): the entry and its cadence stand (row T10.6) |
> | `archivedExpirySighted`'s other ineligible sightings | end only `would-expire`/`in-use` reports | unchanged: a `failing` report stands |
> | `archivedExpiryDue`, the act's pick | read `nextAskAt` alone | unchanged: a finite four-hour wait is asked like any other |
> | `expiryAttention` | lists any report | unchanged |
> | `archivedExpiryLearned` | clears a `failing` report on a learn | unchanged, and never reached by a standing row: every arm below that would send a row back to learning keeps a standing row's learned instant instead |
> | `deferred` (it asks nothing of the box) | `...steady`, `report: null` — dropped the entry, reset the run | keeps the report and its run (`standingThrough`; row T10.7) |
> | `would-expire` (the operator took `expire-lane-live` away to look) | replaced the entry with "would be cleaned up now … so nothing was deleted", said of a workspace that may be part-deleted, and reset the run | keeps them (row T10.8, and the lane case) |
> | `refused`, a retry word (a hold, a pause or the lock the ACT meets: `held`, `paused`, `in-progress`, `reap-in-progress`, `live`, `state-changed` …) | `report: null`, run reset | keeps them (row T10.9) |
> | `refused` `in-use` (a cwd user on a `worktree`-phase resume, 3964) | `failures: 0`, `report: null` for two passes, then the in-use entry | keeps them, and counts the passes; while it stands the in-use processes are in the feed row, not listed in its place (row T10.10) |
> | `refused` `not-expired` | `report: null`, run reset, and with no instant from the audit back to learning | keeps them, and with no instant keeps the learned one (rows T10.11, T10.12) |
> | `no-evidence` (a box rolled back below wave 3b's ccd) | the no-evidence entry, run reset, back to learning | keeps them and the learned instant (rows T10.13, T10.14) |
> | `restart` (a `failed` `state-changed`, Task 8) | ends it | ENDS it, truthfully: the fresh arm runs only while no breadcrumb stands (`_ws_expire_fork`), so every earlier failure was before the breadcrumb and nothing was deleted; the row starts over |
> | `expired`, `gone` | finish the row | unchanged |
> | terminal refusal, non-resumable failure, composition | a final entry, never asked again | unchanged: R1 keeps `main`'s "never asked again" for them — the attempt stops for good, and its own entry says so |
>
> So a standing report keeps its report, its run of failures and (where an arm would forget it) its learned instant through every answer that ends no attempt — one helper, `standingThrough`, spread last in each of those arms — and the next failure is the tier's at once. Terminal refusals and composition errors keep `main`'s "never asked again"; this covers only the resumable-failure horizon.

**Scope:** the ACT's failures. The learning audit's own ladder (`archivedExpiryLearned`) composes nothing destructive and keeps its backoff (the departure `the-day-long-stop-covers-the-act-not-the-learn`). Until CCR-15 wave 7 is on `main`, today's parser reads `containment-refuted` (an unknown `failed` word) as resumable, which wave 7's `containment-refuted-word` test pins, so on the expiry lane it reaches the persistent tier after a day and is never stranded; attention AT ONCE for it (CCR-15's `stuck` class) is this programme's wave 6.

- [ ] **Step 1: The tests (red).** A policy case walks a day of failures through the backoff to the persistent tier, then a later failure, a deferral, every other answer that ends no attempt (a shadow audit, a hold the act met, an in-use, ccd's "not yet", an older ccd's silence — each labelled, each keeping the report, the run and the learned instant), a restart that ends it, a hold the lane sees, a completed attempt and a new archive; a lane case lets an armed expiry fail every hour and counts the asks over two days: twenty-five on the first (the first, then one an hour; the 25th lands a day after the first), then one every four hours — never zero after the day — and then takes `expire-lane-live` away: the next act audits, composes nothing, and the standing entry stands.

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 112):

````ts
  EXPIRE_FAILURE_CEILING_MS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
````

Replace with:

````ts
  EXPIRE_FAILURE_CEILING_MS, EXPIRE_FAILURE_GIVE_UP_MS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
  EXPIRE_PERSISTENT_RETRY_MS,
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 113):

````ts
  it('a failure the box says will NOT resume stops at once: reported, never asked again for this archive (review 313, parked item 4)', () => {
````

Replace with:

````ts
  it('a DAY of failures the box called resumable: the PERSISTENT TIER — a standing entry, asked every four hours, never stopping (wave 5)', () => {
    let x = e();
    let t = NOW;
    for (let k = 0; k < 30 && t - NOW < EXPIRE_FAILURE_GIVE_UP_MS; k += 1) {
      x = archivedExpiryNextEntry(x, { kind: 'failed', resumable: true, detail: `worktree-remove-failed: try ${k + 1}` }, t, PASS)!;
      expect(x.nextAskAt, `still backing off after ${k + 1}`).toBeLessThan(Number.POSITIVE_INFINITY);
      expect((x.report as { attempts?: number } | null)?.attempts, `not yet standing after ${k + 1}`).toBeUndefined();
      t = x.nextAskAt;
    }
    const DAY = NOW + EXPIRE_FAILURE_GIVE_UP_MS;
    x = archivedExpiryNextEntry(x, { kind: 'box', word: 'lock-unopenable', detail: 'cannot open the reap lock at /r' }, DAY, PASS)!;
    expect(x.nextAskAt, 'it asks again in four hours — never +∞').toBe(DAY + EXPIRE_PERSISTENT_RETRY_MS);
    const attempts = x.failures;
    expect(x.report).toEqual({ kind: 'failing', at: NOW, detail: 'cannot open the reap lock at /r', attempts });
    expect(expiryReportSentence(x.report!, null)).toBe('cleanup has failed for a day in ways the box said it could resume: the '
      + `first at 2026-09-21 14:13 UTC, ${attempts} attempts, the last: cannot open the reap lock at /r. It may have stopped part-way — `
      + 'the box does not yet say whether an attempt began its cleanup — so what is left on disk is not known. The lane asks again '
      + 'every 4 hours and keeps this entry until an attempt completes, finds that none had begun or stops for good, or the '
      + 'workspace is archived again.');
    expect(expiryReportSentence(x.report!, null), 'it never suggests a destructive verb').not.toMatch(/ws-reap|ws-rm|ws-expire|delete|remove/);
    // Each later failure updates the entry and keeps the cadence; the first failure's instant stands.
    const later = archivedExpiryNextEntry(x, { kind: 'failed', resumable: true, detail: 'worktree-remove-failed: still busy' }, x.nextAskAt, PASS)!;
    expect(later.nextAskAt, 'and again four hours on').toBe(x.nextAskAt + EXPIRE_PERSISTENT_RETRY_MS);
    expect(later.report).toEqual({ kind: 'failing', at: NOW, detail: 'worktree-remove-failed: still busy', attempts: attempts + 1 });
    // A deferral asks nothing of the box: the entry and its run stand, and it is asked again next pass.
    const deferred = archivedExpiryNextEntry(later, { kind: 'deferred', why: 'presence', detail: 'someone is viewing this session' }, later.nextAskAt, PASS)!;
    expect(deferred, 'a deferral ends nothing').toMatchObject({ report: later.report, failures: attempts + 1, failingSince: NOW,
      nextAskAt: later.nextAskAt + PASS });
    // Nor does any other answer that ends no attempt: a shadow audit (never a "nothing was deleted" said of a workspace
    // that may be part-cleaned), a refusal the box retries (a hold the ACT met), an in-use, ccd's "not yet" and an older
    // ccd's silence each keep the entry, its run and the learned instant.
    const keeps: ReadonlyArray<readonly [string, Parameters<typeof archivedExpiryNextEntry>[1]]> = [
      ['a shadow audit', { kind: 'would-expire', sensitive: 0 }],
      ['a hold the act met', { kind: 'refused', token: 'held', detail: 'on hold', inUse: [] }],
      ['an in-use', { kind: 'refused', token: 'in-use', detail: 'a process works in it', inUse: [] }],
      ['ccd’s not-yet', { kind: 'refused', token: 'not-expired', detail: 'young', inUse: [] }],
      ['an older ccd', { kind: 'no-evidence' }],
    ];
    for (const [what, o] of keeps) {
      expect(archivedExpiryNextEntry(later, o, later.nextAskAt, PASS), `${what} ends nothing`)
        .toMatchObject({ report: later.report, failures: attempts + 1, failingSince: NOW, expiresAt: later.expiresAt });
    }
    // A failed state-changed shows that none had begun (the fresh arm runs only while no breadcrumb stands): it ends the
    // entry and starts over.
    expect(archivedExpiryNextEntry(later, { kind: 'restart', detail: 'state-changed: moved' }, later.nextAskAt, PASS),
      'a restart ends it').toMatchObject({ report: null, failures: 0, failingSince: null, expiresAt: null });
    // A hold never takes its place nor resets its cadence; an attempt that completes finishes the row; a new archive starts afresh.
    const held = archivedExpirySighted(later, { eligible: false, why: 'held' }, 'h', later.nextAskAt - PASS);
    expect(held.report, 'a hold never hides it').toEqual(later.report);
    expect(held.nextAskAt, 'nor resets its cadence').toBe(later.nextAskAt);
    expect(archivedExpiryNextEntry(later, { kind: 'expired', kept: { clips: null, tmpRoot: null } }, later.nextAskAt, PASS),
      'a completed attempt finishes it').toBeNull();
    expect(archivedExpiryEntryFor(later, later.archivedAt + 1), 'a new archive starts afresh').toMatchObject({ failures: 0, report: null, nextAskAt: 0 });
    expect(EXPIRE_FAILURE_GIVE_UP_MS).toBe(24 * EXPIRE_FAILURE_CEILING_MS);
    expect(EXPIRE_PERSISTENT_RETRY_MS, 'the persistent cadence: four ceilings, inside the day').toBe(4 * EXPIRE_FAILURE_CEILING_MS);
  });

  it('a failure the box says will NOT resume stops at once: reported, never asked again for this archive (review 313, parked item 4)', () => {
````

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 114):

````ts
  EXPIRE_AUDITS_PER_PASS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
````

Replace with:

````ts
  EXPIRE_AUDITS_PER_PASS, EXPIRE_FAILURE_CEILING_MS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
````

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 115):

````ts
describe('the record follows the row (review 313, F1)', () => {
````

Replace with:

````ts
describe('a failure that keeps resuming (wave 5)', () => {
  it('a day of resumable failures on one archive: then the persistent tier — asked every four hours, never stopping, and listed with the first failure, the attempts and the last', async () => {
    const f = await fixture({ expire: () => ({ code: 1, stdout: JSON.stringify({ failed: 'worktree-remove-failed', detail: 'the tree is busy' }), stderr: '' }) });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    const hourly = async (): Promise<number> => {
      const before = f.verbsFor('ws-expire').length;
      f.advance(EXPIRE_FAILURE_CEILING_MS); f.next(); await f.pass();
      return f.verbsFor('ws-expire').length - before;
    };
    for (let k = 0; k < 24; k += 1) await hourly();
    // The first failure, then one an hour (the backoff's ceiling): the 25th lands a day after the first.
    expect(f.verbsFor('ws-expire'), 'retried for a day').toHaveLength(25);
    const dayTwo: number[] = [];
    for (let k = 0; k < 24; k += 1) dayTwo.push(await hourly());
    expect(dayTwo.join(''), 'then one every four hours, never stopping').toBe('000100010001000100010001');
    const asked = f.verbsFor('ws-expire').length;
    await f.watcher.tick();
    const list = f.watcher.currentCoord()?.expiryAttention ?? [];
    expect(list.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'failing']]);
    expect(list[0]!.sentence).toContain(`${asked} attempts, the last: worktree-remove-failed: the tree is busy`);
    expect(list[0]!.sentence).toContain('The lane asks again every 4 hours');
    // The operator takes the arming away to look into it: the next act stops at the shadow, and the entry STANDS — never
    // replaced by a "nothing was deleted" said of a workspace that may be part-cleaned.
    rmSync(path.join(f.reg, EXPIRE_LANE_LIVE_MARKER));
    const audits = f.verbsFor('ws-audit').length;
    f.advance(4 * EXPIRE_FAILURE_CEILING_MS); f.next(); await f.pass();
    expect(f.verbsFor('ws-audit'), 'the act audited').toHaveLength(audits + 1);
    expect(f.verbsFor('ws-expire'), 'and composed nothing: shadow').toHaveLength(asked);
    expect(f.entry('demo-a')?.report, 'a shadow audit ends nothing').toMatchObject({ kind: 'failing', attempts: asked });
  });
});

describe('the record follows the row (review 313, F1)', () => {
````

- [ ] **Step 2: Run — red.** Measured: `archived-expiry-policy.test.ts`: `1 failed | 57 passed (58)` — × a DAY of failures the box called resumable: the PERSISTENT TIER … (the constants are not exported yet); `archived-expiry-lane.test.ts`: `1 failed | 32 passed (33)` — × a day of resumable failures on one archive: then the persistent tier … (`expected '111111111111111111111111' to be '000100010001000100010001'`: hourly for ever, as on `main`).

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 116):

````ts
export const EXPIRE_FAILURE_CEILING_MS = 60 * 60_000;
````

Replace with:

````ts
export const EXPIRE_FAILURE_CEILING_MS = 60 * 60_000;

/** THE LANE'S ANSWER TO A REPEATING RESUMABLE FAILURE (the coordinator's ruling, wave 5, revised): a run of `failed`
 *  (resumable) or `lock-unopenable` answers to the ACT that has lasted this long moves the row to the PERSISTENT TIER
 *  (`EXPIRE_PERSISTENT_RETRY_MS`): its report becomes a STANDING attention entry, and the lane asks again every four
 *  hours, never stopping — never +∞, because an expiry that failed after its breadcrumb leaves a part-cleaned
 *  workspace that only a completed attempt finishes once the operator fixes the cause. A completed attempt finishes
 *  the row, and a new `archivedAt` starts a fresh entry. In memory, as all of the lane's memory: a restart re-learns.
 *  The learning audit's own ladder is not this one: it composes nothing destructive, and keeps its backoff. */
export const EXPIRE_FAILURE_GIVE_UP_MS = 24 * 60 * 60_000;

/** THE PERSISTENT TIER's cadence: a row past `EXPIRE_FAILURE_GIVE_UP_MS` of resumable failures is asked again this
 *  long after each attempt, for as long as its failures last (wave 5, the coordinator's revised ruling). */
export const EXPIRE_PERSISTENT_RETRY_MS = 4 * 60 * 60_000;
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 117):

````ts
  | { readonly kind: 'failing'; readonly at: number; readonly detail: string; readonly final?: true }
````

Replace with:

````ts
  | { readonly kind: 'failing'; readonly at: number; readonly detail: string; readonly final?: true;
      /** Set only on the PERSISTENT TIER — a row past `EXPIRE_FAILURE_GIVE_UP_MS` of resumable failures, asked every
       *  `EXPIRE_PERSISTENT_RETRY_MS` — whose report is a STANDING entry: how many attempts failed (`at` is the first
       *  failure, `detail` the last). Never with `final`: the row is still asked. */
      readonly attempts?: number }
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 118):

````ts
  r !== null && ((r.kind === 'failing' && r.final === true) || (r.kind === 'refused' && EXPIRE_TOKEN_KIND[r.token] === 'terminal')
    || r.kind === 'kept');
````

Replace with:

````ts
  r !== null && ((r.kind === 'failing' && r.final === true) || (r.kind === 'refused' && EXPIRE_TOKEN_KIND[r.token] === 'terminal')
    || r.kind === 'kept');

/** A STANDING report — one a hold must not take the place of: a FINAL one (`expiryReportIsFinal`), or the PERSISTENT
 *  tier's (a `failing` report with `attempts`: the row is still asked, every `EXPIRE_PERSISTENT_RETRY_MS`, and the
 *  report is its record of a day of failures that may have left the workspace part-cleaned). A hold that replaced it
 *  would be cleared by the release, and the record with it (wave 5). */
export const expiryReportStands = (r: ExpiryReport | null): boolean =>
  expiryReportIsFinal(r) || (r !== null && r.kind === 'failing' && r.attempts !== undefined);

/** What a STANDING report keeps through an answer that ends no attempt — a deferral, a shadow audit, a refusal the box
 *  retries (a hold the ACT met among them), an in-use, ccd's "not yet", an older ccd's silence: the report and its run
 *  of failures, so the next failure is the persistent tier's at once, and the record of a workspace that may be
 *  part-cleaned is never replaced by a sentence about this one answer — a shadow's "nothing was deleted" least of all.
 *  Nothing for any other report. Only an attempt that completes, one that finds none had begun (`restart`: the fresh
 *  arm runs only while no breadcrumb stands), a final verdict or a new archive ends a standing report (wave 5). */
const standingThrough = (entry: ArchivedExpiryEntry): Partial<Pick<ArchivedExpiryEntry, 'report' | 'failures' | 'failingSince'>> =>
  expiryReportStands(entry.report) ? { report: entry.report, failures: entry.failures, failingSince: entry.failingSince } : {};
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 119):

````ts
    // A row the lane has stopped asking keeps its own report — listed with its reason while held and after the hold goes.
    if (expiryReportIsFinal(entry.report)) return eligibleSince === entry.eligibleSince ? entry : { ...entry, eligibleSince };
````

Replace with:

````ts
    // A STANDING report — a row the lane has stopped asking, or one on the persistent tier — keeps its own report and its
    // wait, listed while held and after the hold goes.
    if (expiryReportStands(entry.report)) return eligibleSince === entry.eligibleSince ? entry : { ...entry, eligibleSince };
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 120):

````ts
    case 'would-expire':
      return { ...base, ...steady, nextAskAt: nowMs + EXPIRE_SHADOW_REAUDIT_MS,
        report: { kind: 'would-expire', at: entry.report?.kind === 'would-expire' ? entry.report.at : nowMs, sensitive: o.sensitive } };
    case 'no-evidence':
      return { ...base, ...steady, expiresAt: null, nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS, report: { kind: 'no-evidence', at: nowMs } };
    case 'deferred':
      // A pause or a missing verb the EXECUTOR saw (its own registry listing, its own caps read) is one the tick's
      // listing may never have shown — a switch raised and lowered inside one cadence window — so the sighting from
      // before it is forgotten here too: a lowered switch needs two FRESH passes, whoever saw it.
      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null,
        ...(o.why === 'paused-at-server' || o.why === 'unsupported' ? { eligibleSince: null } : {}) };
    case 'refused': {
      const kind = EXPIRE_TOKEN_KIND[o.token];
      if (kind === 'gone') return null;
      if (kind === 'terminal') {
        return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
          report: { kind: 'refused', at: nowMs, token: o.token, detail: o.detail } };
      }
      if (o.token === 'not-expired') {
        // ccd says the instant has not come — the lane's learned one is stale (the threshold was raised, or the two
        // clocks disagree). Learn the audit's instant, and start the twice-observed rule again from it: never
        // re-asked every pass on the old one. No instant given: unknown, so the next pass learns it.
        return { ...base, ...steady, expiresAt: o.auditExpiresAt ?? null, eligibleSince: null, nextAskAt: nowMs + passMs,
          report: null };
      }
      if (o.token === 'in-use') {
        const passes = entry.inUseRun + 1;
        return { ...base, failures: 0, failingSince: null, inUseRun: passes, inUse: o.inUse, nextAskAt: nowMs + passMs,
          report: passes >= EXPIRE_IN_USE_ATTENTION_PASSES
            ? { kind: 'in-use', at: entry.report?.kind === 'in-use' ? entry.report.at : nowMs, inUse: o.inUse, passes }
            : null };
      }
      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null };
````

Replace with:

````ts
    // A STANDING report — the persistent tier's (wave 5) — and its run of failures stand through every arm from here to
    // `refused`'s last that ends no attempt (`standingThrough`); a standing row keeps its learned instant too, so it
    // never goes back to learning, whose success would clear it.
    case 'would-expire':
      return { ...base, ...steady, nextAskAt: nowMs + EXPIRE_SHADOW_REAUDIT_MS,
        report: { kind: 'would-expire', at: entry.report?.kind === 'would-expire' ? entry.report.at : nowMs, sensitive: o.sensitive },
        ...standingThrough(entry) };
    case 'no-evidence':
      return { ...base, ...steady, expiresAt: expiryReportStands(entry.report) ? entry.expiresAt : null,
        nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS, report: { kind: 'no-evidence', at: nowMs }, ...standingThrough(entry) };
    case 'deferred':
      // A pause or a missing verb the EXECUTOR saw (its own registry listing, its own caps read) is one the tick's
      // listing may never have shown — a switch raised and lowered inside one cadence window — so the sighting from
      // before it is forgotten here too: a lowered switch needs two FRESH passes, whoever saw it.
      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null,
        ...(o.why === 'paused-at-server' || o.why === 'unsupported' ? { eligibleSince: null } : {}), ...standingThrough(entry) };
    case 'refused': {
      const kind = EXPIRE_TOKEN_KIND[o.token];
      if (kind === 'gone') return null;
      if (kind === 'terminal') {
        return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
          report: { kind: 'refused', at: nowMs, token: o.token, detail: o.detail } };
      }
      if (o.token === 'not-expired') {
        // ccd says the instant has not come — the lane's learned one is stale (the threshold was raised, or the two
        // clocks disagree). Learn the audit's instant, and start the twice-observed rule again from it: never
        // re-asked every pass on the old one. No instant given: unknown, so the next pass learns it — save on a standing
        // row, which keeps the instant it learned, so the act's own audit gives the new one (wave 5).
        return { ...base, ...steady, expiresAt: o.auditExpiresAt ?? (expiryReportStands(entry.report) ? entry.expiresAt : null),
          eligibleSince: null, nextAskAt: nowMs + passMs, report: null, ...standingThrough(entry) };
      }
      if (o.token === 'in-use') {
        const passes = entry.inUseRun + 1;
        return { ...base, failures: 0, failingSince: null, inUseRun: passes, inUse: o.inUse, nextAskAt: nowMs + passMs,
          report: passes >= EXPIRE_IN_USE_ATTENTION_PASSES
            ? { kind: 'in-use', at: entry.report?.kind === 'in-use' ? entry.report.at : nowMs, inUse: o.inUse, passes }
            : null, ...standingThrough(entry) };
      }
      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null, ...standingThrough(entry) };
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 121):

````ts
      const failures = entry.failures + 1;
      const failingSince = entry.failingSince ?? nowMs;
      return { ...base, inUseRun: 0, inUse: [], failures, failingSince,
````

Replace with:

````ts
      const failures = entry.failures + 1;
      const failingSince = entry.failingSince ?? nowMs;
      if (nowMs - failingSince >= EXPIRE_FAILURE_GIVE_UP_MS) {
        // A DAY of failures the box called resumable (the coordinator's revised ruling, wave 5): the PERSISTENT TIER. The
        // report is a standing entry — the first failure, the attempts, the last detail, never a destructive verb — and
        // the lane asks again every `EXPIRE_PERSISTENT_RETRY_MS`, never stopping: each later failure updates the entry.
        return { ...base, inUseRun: 0, inUse: [], failures, failingSince, nextAskAt: nowMs + EXPIRE_PERSISTENT_RETRY_MS,
          report: { kind: 'failing', at: failingSince, detail: o.detail, attempts: failures } };
      }
      return { ...base, inUseRun: 0, inUse: [], failures, failingSince,
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 122):

````ts
const iso = (epochS: number): string => new Date(epochS * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
````

Replace with:

````ts
const iso = (epochS: number): string => new Date(epochS * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const isoMs = (ms: number): string => iso(Math.floor(ms / 1000));
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 123):

````ts
    case 'failing':
      return r.final === true ? `cleanup stopped: ${r.detail}. It is not asked again for this archive.`
````

Replace with:

````ts
    case 'failing':
      if (r.attempts !== undefined) {
        return `cleanup has failed for a day in ways the box said it could resume: the first at ${isoMs(r.at)}, `
          + `${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'}, the last: ${r.detail}. It may have stopped part-way — the box `
          + 'does not yet say whether an attempt began its cleanup — so what is left on disk is not known. The lane asks again '
          + `every ${EXPIRE_PERSISTENT_RETRY_MS / 3_600_000} hours and keeps this entry until an attempt completes, finds `
          + 'that none had begun or stops for good, or the workspace is archived again.';
      }
      return r.final === true ? `cleanup stopped: ${r.detail}. It is not asked again for this archive.`
````

- [ ] **Step 4: Run — green.** Measured: `58 passed (58)`; `33 passed (33)`; `( cd server && ./node_modules/.bin/tsc --noEmit -p . )` rc 0.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T10.1 | `server/src/archivedExpiry.ts`: `      if (nowMs - failingSince >= EXPIRE_FAILURE_GIVE_UP_MS) {` → `      if (nowMs - failingSince >= Number.POSITIVE_INFINITY) {` (no tier: hourly for ever) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `it asks again in four hours — never +∞`<br>`archived-expiry-lane.test.ts`: `1 failed \| 32 passed (33)` — `then one every four hours, never stopping: expected '111111111111111111111111'` |
| T10.2 | `server/src/archivedExpiry.ts`: `export const EXPIRE_FAILURE_GIVE_UP_MS = 24 * 60 * 60_000;` → `export const EXPIRE_FAILURE_GIVE_UP_MS = 48 * 60 * 60_000;` | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` (`expected 172800000 to be 86400000`)<br>`archived-expiry-lane.test.ts`: `1 failed \| 32 passed (33)` — `expected '111111111111111111111111'` |
| T10.3 | `server/src/archivedExpiry.ts`: `      if (r.attempts !== undefined) {` → `      if (r.attempts === -1) {` | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)`<br>`archived-expiry-lane.test.ts`: `1 failed \| 32 passed (33)` — the sentence names the attempts |
| T10.4 | `server/src/archivedExpiry.ts`: `        return { ...base, inUseRun: 0, inUse: [], failures, failingSince, nextAskAt: nowMs + EXPIRE_PERSISTENT_RETRY_MS,` → `        return { ...base, inUseRun: 0, inUse: [], failures, failingSince, nextAskAt: Number.POSITIVE_INFINITY,` (+∞ put back: the drafted plan's stop) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `it asks again in four hours — never +∞: expected Infinity`<br>`archived-expiry-lane.test.ts`: `1 failed \| 32 passed (33)` — `expected '000000000000000000000000' to be '000100010001000100010001'` (never asked after the day) |
| T10.5 | `server/src/archivedExpiry.ts`: `export const EXPIRE_PERSISTENT_RETRY_MS = 4 * 60 * 60_000;` → `export const EXPIRE_PERSISTENT_RETRY_MS = 2 * 60 * 60_000;` | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — the sentence (`every 2 hours`)<br>`archived-expiry-lane.test.ts`: `1 failed \| 32 passed (33)` — `expected '010101010101010101010101'` |
| T10.6 | `server/src/archivedExpiry.ts`: `    if (expiryReportStands(entry.report)) return eligibleSince === entry.eligibleSince ? entry : { ...entry, eligibleSince };` → `    if (expiryReportIsFinal(entry.report)) return eligibleSince === entry.eligibleSince ? entry : { ...entry, eligibleSince };` (the hold guard reads "final" alone) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `a hold never hides it: expected { kind: 'held', … }` |
| T10.7 | `server/src/archivedExpiry.ts`: `        ...(o.why === 'paused-at-server' \|\| o.why === 'unsupported' ? { eligibleSince: null } : {}), ...standingThrough(entry) };` → `        ...(o.why === 'paused-at-server' \|\| o.why === 'unsupported' ? { eligibleSince: null } : {}) };` (a deferral drops the standing entry) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `a deferral ends nothing` |
| T10.8 | `server/src/archivedExpiry.ts`, the `would-expire` arm's last line: `        ...standingThrough(entry) };` → `        };` (a shadow audit replaces the entry with "nothing was deleted" — the act-safety lens's finding) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `a shadow audit ends nothing`<br>`archived-expiry-lane.test.ts`: `1 failed \| 32 passed (33)` — `a shadow audit ends nothing: expected { kind: 'would-expire', … } to match object { kind: 'failing', attempts: 31 }` |
| T10.9 | `server/src/archivedExpiry.ts`: `      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null, ...standingThrough(entry) };` → `      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null };` (a retry refusal — a hold the act met — drops it) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `a hold the act met ends nothing` |
| T10.10 | `server/src/archivedExpiry.ts`: `            : null, ...standingThrough(entry) };` → `            : null };` (an in-use drops it and resets the run) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `an in-use ends nothing` |
| T10.11 | `server/src/archivedExpiry.ts`: `          eligibleSince: null, nextAskAt: nowMs + passMs, report: null, ...standingThrough(entry) };` → `          eligibleSince: null, nextAskAt: nowMs + passMs, report: null };` (ccd's "not yet" drops it) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `ccd’s not-yet ends nothing` |
| T10.12 | `server/src/archivedExpiry.ts`: `o.auditExpiresAt ?? (expiryReportStands(entry.report) ? entry.expiresAt : null)` → `o.auditExpiresAt ?? null` (a standing row sent back to learning, whose success clears it) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `ccd’s not-yet ends nothing` (`expiresAt`) |
| T10.13 | `server/src/archivedExpiry.ts`: `report: { kind: 'no-evidence', at: nowMs }, ...standingThrough(entry) };` → `report: { kind: 'no-evidence', at: nowMs } };` (an older ccd's silence drops it) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `an older ccd ends nothing` |
| T10.14 | `server/src/archivedExpiry.ts`: `      return { ...base, ...steady, expiresAt: expiryReportStands(entry.report) ? entry.expiresAt : null,` → `      return { ...base, ...steady, expiresAt: null,` (back to learning) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — `an older ccd ends nothing` (`expiresAt`) |

- [ ] **Step 6: Commit.** `feat(lifecycle): after a day of resumable failures the expiry lane asks every four hours, never stopping — the persistent tier (ruling B3, revised)`.

---

### Task 11: `ws-expire`'s consent binds the branch — the in-lock window closed (ruling B4; ccd, AGENT-FIRST)

**Model routing:** `sonnet`, effort `high` — the destructive verb's body, inside its lock.

**Files:** `ccd/ccd` (`_ws_expire_locked`); tests `server/test/ccd-ws-expire-consent-branch.test.ts` (new), `server/test/archived-expiry-policy.test.ts` (the census map).

**Interfaces:** `_ws_expire_locked` captures `lbstate="$RECLAIM_BRANCHSTATE"` — the in-lock recompute's three-way read, the one the token was checked against — before the pin; the pin (`_ws_reclaim_pin` or `_ws_reclaim_pin_absent`) reads the branch again through `_ws_reclaim_tip_read`; if the two differ, `_ws_reclaim_fail "$id" "$lctx" state-changed "…"`: the journal's `failed` line and the `{"failed":"state-changed",…}` document at exit 1, AFTER the pin (which only keeps) and BEFORE the tombstone and the breadcrumb — nothing destroyed, no breadcrumb, the unit untouched. Both directions refuse, as on the reclaim side (the departure `expire-consent-binds-the-branch-both-ways`; measured at `b0647d850`: with no check, a branch made in the window was deleted at the tip the pin read). A branch already absent when the token was minted reads absent twice and expires, its work in the attic (unchanged — a control case pins it). A deletion between the FRESH pin and the tail's SETTLE stays as CCR-15 wave 6 left it (Measured while planning, item 2). Task 8's reading and this refusal agree: the census list gains `_ws_expire_locked failed state-changed`, on the fresh arm, before the breadcrumb, and the server reads the refusal as `restart` — it audits afresh (question (h), ruled). **MEASURED here, in both window cases (the coordinator's ask with that ruling): a refusal after the pin leaves nothing a fresh audit misreads.** After it, the attic pin, the journal's `intent` and `failed` lines and the registry row stand, with no breadcrumb and no tombstone; the stale token is refused (`{"refused":"state-changed"}`, exit 0) before anything, the tree and row untouched; a fresh `ws-audit --expire` reads `expirable` with `reaping: null` and no `resume`, and mints a token other than the stale one; and that token expires the archive, the tip the refused pin read in the attic — in the MADE direction, deleting the branch made in the window at that tip, which is what a fresh consent over what stands covers. **Scope of that measurement (the act-safety lens of 2026-10-08):** both window cases detach HEAD, so the pin meets no HEAD symbolic to the branch. In a real workspace HEAD is symbolic to `ws/<slug>`, and there a branch DELETED in the window is refused before this check runs, by `_ws_reclaim_pin`'s own check (the branch reads absent while HEAD names it → `pin-failed`, resumable): nothing started, no breadcrumb, and the lane retries it on the resumable ladder — never as `restart` — so if it recurred for a day the persistent tier's "may have stopped part-way" would say more than happened (safe: nothing is destroyed and every retry audits afresh). The MADE direction reaches this check with a symbolic HEAD too (the pin reads the branch present). A symbolic-HEAD control case pinning the `pin-failed` shape is this programme's wave 6.

- [ ] **Step 1: The tests (red).** A new file (the 600 s foreground ceiling keeps it out of the verb suite): `IN_THE_WINDOW` shims `_ws_reclaim_branch_state` to act on the SECOND read (the pin's) inside the verb's own lock — the reclaim side's measured idiom; a branch deleted there, and one made there, each refuse `failed` `state-changed` with nothing started, and each then measures what the refusal leaves for a fresh audit; the server's parser reads the first as `restart`; two controls. And the census map's `state-changed` entry names `_ws_expire_locked` — red until the ccd edit lands.

<!-- replay: create server/test/ccd-ws-expire-consent-branch.test.ts -->
Create `server/test/ccd-ws-expire-consent-branch.test.ts` (block 124):

````ts
// Workspace lifecycle wave 5 (spec 2026-09-24 §5.3; CCR-15 spec §5.5's consent rule): `ws-expire`'s consent BINDS THE
// BRANCH. The token is checked against the in-lock recompute's branch read, and the pin reads the branch again,
// itself; a branch deleted (or made) between the two reads stops the act there — `failed` `state-changed`, exit 1 —
// AFTER the pin, which only keeps, and BEFORE the tombstone and the breadcrumb, so nothing has started. A branch
// already absent when the token was minted reads absent twice and the expiry goes on, its work kept in the attic.
// The server reads that refusal as one to START OVER from (the coordinator's ruling on the wave-5 plan's question (h)),
// so each window case also measures what the refusal leaves: the stale token is refused before anything, and a fresh
// audit reads what stands and its token expires the archive.
//
// FIXTURE HOME ONLY (`makePrHarness`): the unit and pane calls are RECORDED (`EXP_STUBS`), never made, and the only
// ref this file deletes or makes is the fixture repository's. A new file, not an addition to the verb suite (the
// 600 s foreground ceiling).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { eventsOf } from './lifecycleHelpers.js';
import { EXP_BRANCH, EXP_ID, expireAudit, expireEvalOf, expireVerb, makeArchived, type Archived } from './wsExpireFixture.js';
import { parseExpireResult } from '../src/archivedExpiry.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-consent-'); });
afterEach(() => { h.cleanup(); });

/** This runner's own git, MEASURED: the three-way branch read needs `git show-ref --exists` (git 2.43 and newer). */
const GIT_VERSION = /git version (\d+)\.(\d+)/.exec(execFileSync('git', ['--version'], { encoding: 'utf8', env: inheritedEnv() }));
const MODERN_GIT = GIT_VERSION !== null
  && (Number(GIT_VERSION[1]) > 2 || (Number(GIT_VERSION[1]) === 2 && Number(GIT_VERSION[2]) >= 43));

/** `act`, run INSIDE the verb's lock at the second branch read — the pin's, after the in-lock recompute's — then the
 *  real read. The count lives in the fixture HOME, because every read runs in `$( … )`. */
const IN_THE_WINDOW = (act: string): string => [
  `eval "$(declare -f _ws_reclaim_branch_state | sed '1s/^_ws_reclaim_branch_state /_ws_real_branch_state /')";`,
  `_ws_reclaim_branch_state() { local n; n=$(cat "$HOME/bs-reads" 2>/dev/null || echo 0); echo $(( n + 1 )) > "$HOME/bs-reads";`,
  ` if (( n == 1 )); then ${act}; fi; _ws_real_branch_state "$@"; };`,
].join(' ');

const atticReach = (a: Archived): string[] => {
  const refs = h.git(a.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${EXP_ID}/`).split('\n').filter(Boolean);
  return refs.length ? h.git(a.main, 'rev-list', ...refs).split('\n').filter(Boolean) : [];
};
const unsupervised = (): string[] => h.calls().filter((l) => l.startsWith('unsupervise'));
/** Nothing started: the tree, the row and the archive stand, no breadcrumb, no tombstone, the unit untouched. */
const nothingStarted = (a: Archived): void => {
  expect(fs.existsSync(a.wt), 'the tree stands').toBe(true);
  expect(h.reg(EXP_ID, 'uuid'), 'the row stands').not.toBeNull();
  expect(h.reg(EXP_ID, 'archived'), 'the archive stands').not.toBeNull();
  expect(h.reg(EXP_ID, 'reaping'), 'no breadcrumb').toBeNull();
  expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', `${EXP_ID}.json`)), 'no tombstone').toBe(false);
  expect(unsupervised(), 'the unit was not touched').toEqual([]);
};
/** AFTER the refusal, what it left is never misread (wave 5: a failed state-changed audits afresh). The attic pin, the
 *  journal's intent and failure, and the row stand, with no breadcrumb and no tombstone. The stale token is
 *  refused before anything. A fresh audit reads the row as it now stands, expirable with nothing to resume, and its
 *  token expires the archive, the tip the refused pin read still in the attic. */
const auditsAfresh = (a: Archived, stale: string): void => {
  const again = expireVerb(h, stale);
  expect(again.code, again.stdout + again.stderr).toBe(0);
  expect((JSON.parse(again.stdout) as { refused?: string }).refused, 'the stale token is refused before anything').toBe('state-changed');
  nothingStarted(a);
  const audit = expireAudit(h);
  expect(audit.code, audit.stdout + audit.stderr).toBe(0);
  const doc = JSON.parse(audit.stdout) as Record<string, unknown>;
  expect(doc, 'a fresh audit reads what stands').toMatchObject({ verdict: 'expirable', reaping: null });
  expect(doc, 'nothing to resume').not.toHaveProperty('resume');
  expect(doc['token'], 'a token over what stands, not the stale one').not.toBe(stale);
  const r = expireVerb(h, String(doc['token']));
  expect(r.code, r.stdout + r.stderr).toBe(0);
  expect((JSON.parse(r.stdout) as { expired: string }).expired).toBe(EXP_ID);
  expect(fs.existsSync(a.wt), 'the tree is gone').toBe(false);
  expect(atticReach(a), 'the tip the refused pin read is in the attic').toContain(a.tip);
};

describe.skipIf(!MODERN_GIT)('ws-expire: the consent binds the branch (wave 5)', () => {
  it('a branch DELETED between the in-lock recompute and the pin stops the act: failed state-changed, before the breadcrumb', () => {
    const a = makeArchived(h);
    h.git(a.wt, 'checkout', '-q', '--detach');      // so the pin meets no HEAD symbolic to the branch
    const token = expireEvalOf(h).token;              // minted over branchState=present
    const r = expireVerb(h, token, { pre: IN_THE_WINDOW(`git -C "$1" update-ref -d "refs/heads/$2" >/dev/null 2>&1`) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('state-changed');
    expect(fs.readFileSync(path.join(h.home, 'bs-reads'), 'utf8').trim(), 'the recompute read, then the pin, and nothing after').toBe('2');
    expect(o.detail).toMatch(new RegExp(`${EXP_BRANCH} read present when the token was checked inside the lock, but absent when the pin read it again`));
    expect(eventsOf(h.home, 'expire').map((e) => e['outcome']), 'one act: its intent, then its failure').toEqual(['intent', 'failed']);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the CONTROL: the other actor did delete the branch').toBe('');
    expect(atticReach(a), 'the pin only kept: the tip it read is in the attic').toContain(a.tip);
    nothingStarted(a);
    // And the server reads this document as one to START OVER from — nothing started, so nothing is resumed, and what
    // stands is audited afresh.
    expect(parseExpireResult(EXP_ID, r.stdout, r.stderr)).toEqual({ kind: 'restart', detail: `state-changed: ${o.detail}` });
    auditsAfresh(a, token);
  }, 180_000);

  it('a branch MADE between the in-lock recompute and the pin stops it too: the consent binds both ways', () => {
    const a = makeArchived(h);
    h.git(a.wt, 'checkout', '-q', '--detach');
    h.git(a.main, 'update-ref', '-d', `refs/heads/${EXP_BRANCH}`);
    const token = expireEvalOf(h).token;              // minted over branchState=absent
    const r = expireVerb(h, token, { pre: IN_THE_WINDOW(`git -C "$1" update-ref "refs/heads/$2" ${a.tip} >/dev/null 2>&1`) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('state-changed');
    expect(o.detail).toMatch(new RegExp(`${EXP_BRANCH} read absent when the token was checked inside the lock, but present when the pin read it again`));
    expect(h.git(a.main, 'rev-parse', `refs/heads/${EXP_BRANCH}`), 'the branch made in the window stands').toBe(a.tip);
    nothingStarted(a);
    auditsAfresh(a, token);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the fresh consent covered the branch made in the window').toBe('');
  }, 180_000);

  it('the CONTROL: a branch ALREADY ABSENT when the token was minted still expires, its work kept in the attic', () => {
    const a = makeArchived(h);
    h.git(a.wt, 'checkout', '-q', '--detach');
    h.git(a.main, 'update-ref', '-d', `refs/heads/${EXP_BRANCH}`);
    const r = expireVerb(h, expireEvalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { expired: string }).expired).toBe(EXP_ID);
    expect(fs.existsSync(a.wt), 'the tree is gone').toBe(false);
    expect(atticReach(a), 'HEAD — the work — is kept in the attic').toContain(a.tip);
  }, 120_000);

  it('the CONTROL: a branch that stands at both reads expires as ever', () => {
    const a = makeArchived(h);
    h.git(a.wt, 'checkout', '-q', '--detach');
    const r = expireVerb(h, expireEvalOf(h).token, { pre: IN_THE_WINDOW(':') });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { expired: string }).expired).toBe(EXP_ID);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the branch was deleted at its tip').toBe('');
  }, 120_000);
});
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 125):

````ts
      '_ws_expire_locked failed probe-unmeasured',
    ]);
````

Replace with:

````ts
      '_ws_expire_locked failed probe-unmeasured',
      '_ws_expire_locked failed state-changed',
    ]);
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-consent-branch.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
```

Measured: `ccd-ws-expire-consent-branch.test.ts`: `2 failed | 2 passed (4)` — × a branch DELETED between the in-lock recompute and the pin stops the act … (the verb expired it: exit 0, `{"expired":…}`); × a branch MADE between the in-lock recompute and the pin stops it too …; `archived-expiry-policy.test.ts`: `1 failed | 57 passed (58)` — × THE CENSUS … (`expected [ …(10) ] to deeply equal [ …(11) ]`).

- [ ] **Step 3: The ccd edit, then the re-stamp.**

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find (block 126):

````bash
  local phase="" resumed="" declared="" lctx project workdir main clips pinned=0 start=children
  [[ "$surface" == none ]] || declared="$surface"
  _ws_expire_fork "$id"
````

Replace with:

````bash
  local phase="" resumed="" declared="" lctx project workdir main clips pinned=0 start=children lbstate=""
  [[ "$surface" == none ]] || declared="$surface"
  _ws_expire_fork "$id"
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find (block 127):

````bash
    # outlives the row. A vanished worktree takes the RECLAIM region's own arm.
    if [[ "$RECLAIM_WORKTREE" == absent ]]; then
````

Replace with:

````bash
    # outlives the row. A vanished worktree takes the RECLAIM region's own arm.
    lbstate="$RECLAIM_BRANCHSTATE"   # the in-lock recompute's read, the one the token was checked against
    if [[ "$RECLAIM_WORKTREE" == absent ]]; then
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find (block 128):

````bash
      _ws_reclaim_pin "$id" "$workdir" "$main" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT" && pinned=1
    fi
    if (( ! pinned )); then
      _ws_reclaim_fail "$id" "$lctx" pin-failed "$RECLAIM_PIN_WHY"
      return 1
    fi
````

Replace with:

````bash
      _ws_reclaim_pin "$id" "$workdir" "$main" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT" && pinned=1
    fi
    if (( ! pinned )); then
      _ws_reclaim_fail "$id" "$lctx" pin-failed "$RECLAIM_PIN_WHY"
      return 1
    fi
    # THE CONSENT BINDS THE BRANCH, as a reclaim's does (CCR-15 spec §5.5;
    # workspace lifecycle wave 5). The token was checked against the in-lock
    # recompute, and the pin read the branch again, itself. A branch deleted
    # (or made) between the two reads would have the act go on over what the
    # PIN read, not what the token consented to. So the two reads agree, or the
    # act stops HERE — after the pin, which only kept, and BEFORE the tombstone
    # and the breadcrumb, so nothing has started and there is nothing to resume.
    # Every `failed` `state-changed` this verb prints is printed here, before
    # the breadcrumb, and the server reads the word so: it starts over from a
    # fresh audit (`archivedExpiry.ts`). A branch already absent when the token
    # was minted reads absent twice and goes on, its work kept in the attic.
    if [[ "$RECLAIM_BRANCHSTATE" != "$lbstate" ]]; then
      _ws_reclaim_fail "$id" "$lctx" state-changed \
        "$REAP_BRANCH read $lbstate when the token was checked inside the lock, but $RECLAIM_BRANCHSTATE when the pin read it again — it changed in between, so nothing was destroyed"
      return 1
    fi
````

```bash
~/.local/bin/ccrc restamp ccd/ccd     # line 2's `ccrc:generated` marker; the prototype's stamp read sha256=940c0208…fc3b
bash -n ccd/ccd
```

- [ ] **Step 4: Run — green**, and every suite the verb's region feeds. Measured: `ccd-ws-expire-consent-branch` `4 passed (4)`; `archived-expiry-policy` `58 passed (58)`; `ccd-ws-expire-verb` `32 passed (32)`; `ccd-ws-expire-audit` `20 passed (20)`; `ccd-ws-expire-ladder` `55 passed (55)`; `ccd-ws-expire-reach` `3 passed (3)`; `ccd-ws-expire-return-race` `8 passed (8)`; `ccd-ws-expire-spawn` `17 passed (17)`; `ccd-child-reclaim-leaf-moved-expire` `3 passed (3)`; `ccd-lifecycle-emit` `59 passed (59)`; `ccd-refusal-scan` `11 passed (11)` (the refusal-emit count is unchanged: the new line is a `failed` journal line); `verb-gate` `12 passed (12)`.

- [ ] **Step 5: The citation tax — none, measured.** `ccd-reg-get-census` `3 passed (3)`; the five citation cases `5 passed | 330 skipped (335)`; `cite-remeasure.py` (extracted as Measured while planning item 6 says; read-only, never `--write`): `byFile['ccd/ccd'] stated 147 base 147 tree 147`, `total stated 197 base 197 tree 197`, nothing ENTERED or LEFT, row array `54/54/54`, site array `35/35/35`.

- [ ] **Step 6: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T11.1 | `ccd/ccd` (`_ws_expire_locked`): `    if [[ "$RECLAIM_BRANCHSTATE" != "$lbstate" ]]; then ⏎       _ws_reclaim_fail "$id" "$lctx" state-changed \ ⏎         "$REAP_BRANCH read $lbstate … so nothing was destroyed"` → the same with `    if false && [[ "$RECLAIM_BRANCHSTATE" != "$lbstate" ]]; then` (the three lines quoted together: the first alone also matches `_ws_reclaim_locked`'s) | `ccd-ws-expire-consent-branch.test.ts`: `2 failed \| 2 passed (4)` — both window cases expire (`expected +0 to be 1`) |
| T11.2 | the same three lines, the condition → `    if [[ "$lbstate" == present && "$RECLAIM_BRANCHSTATE" == absent ]]; then` (the ruling's one direction) | `ccd-ws-expire-consent-branch.test.ts`: `1 failed \| 3 passed (4)` — a branch MADE … the consent binds both ways |
| T11.3 | `ccd/ccd` (`_ws_expire_locked`): the new producer's word `state-changed` → `x-moved` (its line and the next quoted together, as T11.1 does), and below the breadcrumb, after `    phase="$start"`, a line `    [[ "$RECLAIM_BRANCHSTATE" != "$lbstate" ]] && { _ws_reclaim_fail "$id" "$lctx" state-changed "moved after"; return 1; }` — the census list unchanged, the producer AFTER the breadcrumb (the replay lens's row) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — THE CENSUS … (`state-changed in _ws_expire_locked prints after the breadcrumb`) |
| T11.4 | the same rename, and at the verdict point, after `    _ws_reclaim_failed_json probe-unmeasured "$REAP_DETAIL" ⏎     return 1 ⏎   fi`, a line `  [[ -n "$phase" && "$RECLAIM_BRANCHSTATE" == absent ]] && { _ws_reclaim_fail "$id" "" state-changed "moved"; return 1; }` — a producer on EVERY arm, so after a standing breadcrumb on a resumed one (the safety lens's row) | `archived-expiry-policy.test.ts`: `1 failed \| 57 passed (58)` — THE CENSUS … (`state-changed in _ws_expire_locked is not on its fresh arm`) |

Restore and re-stamp after each.

- [ ] **Step 7: Commit.** `fix(ccd): ws-expire's consent binds the branch — a change inside the lock stops the act before the breadcrumb (ruling B4)`.

---

### Task 12: The expiry follow-ups' words — §5.3 and README

**Model routing:** `sonnet`, effort `low`.

**Files:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` (§5.3), `README.md` (the expiry paragraph); test `server/test/expiry-lane-prose.test.ts`.

- [ ] **Step 1: The prose pins (red).**

<!-- replay: replace server/test/expiry-lane-prose.test.ts -->
In `server/test/expiry-lane-prose.test.ts`, find (block 129):

````ts
  it('the coordinator’s own workspace: by a human — or, with no child marker, by the server seven days after its archive', () => {
````

Replace with:

````ts
  it('says a kept leaf is listed, an older ccd’s silence is the feed row’s, and a day of resumable failures slows the asking (wave 5)', () => {
    const at = readme.indexOf('**Archived workspaces are cleaned up after seven days**');
    const para = readme.slice(at, at + 4200);
    expect(para).toContain('is listed, saying what was kept and why, until the server restarts');
    expect(para).toContain('a fleet box whose ccd predates that report says so in the feed row only');
    expect(para).toContain('is retried, backing off, for a day;');
    expect(para).toContain('and asked again every four hours, never stopping.');
    expect(para).toContain('The entry stays through a hold, a shadow audit or any other answer that ends no attempt, until an attempt completes, finds that none had begun or stops for good, or the workspace is archived again');
    expect(para).not.toContain('stops asking for that archive');
  });
  it('the coordinator’s own workspace: by a human — or, with no child marker, by the server seven days after its archive', () => {
````

<!-- replay: replace server/test/expiry-lane-prose.test.ts -->
In `server/test/expiry-lane-prose.test.ts`, find (block 130):

````ts
    // An ineligible sighting does NOT clear every report: the box's own verdicts stand (review of wave 4's Task 4, I1).
    expect(s).not.toContain('clears every report');
  });
});
````

Replace with:

````ts
    // An ineligible sighting does NOT clear every report: the box's own verdicts stand (review of wave 4's Task 4, I1).
    expect(s).not.toContain('clears every report');
  });
  it('§5.3 records wave 5’s follow-ups: the consent binds the branch, a failed state-changed is audited afresh, a kept leaf, a day of failures', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s).toContain("**As wave 5 closes the lane's follow-ups**");
    for (const item of ['**The consent binds the branch.**', '**A `failed` `state-changed` is audited afresh.**', '**A kept leaf is listed.**',
      '**A day of resumable failures slows the asking.**', 'A branch already absent when the token was minted reads absent twice and expires with its work in the attic',
      'An absent key (an older ccd) is recorded in the feed row as unmeasured and lists nothing',
      'mints a fresh token over what stands', 'The lane asks again every four hours, never stopping',
      'No answer that ends no attempt replaces the entry or resets its run', 'finds that none had begun']) expect(s).toContain(item);
    for (const gone of ['is final.**', 'stops the asking.**', 'The lane does not ask again until the archive changes']) expect(s).not.toContain(gone);
  });
});
````

- [ ] **Step 2: Run — red.** Measured: `expiry-lane-prose.test.ts`: `2 failed | 8 passed (10)` — × says a kept leaf is listed, an older ccd's silence is the feed row's, and a day of resumable failures slows the asking (wave 5); × §5.3 records wave 5's follow-ups ….

- [ ] **Step 3: The words.** README's sentences sit below its `shared/api.ts` citations: nothing re-points.

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find (block 131):

````markdown
  evidence) are mostly never journaled, so the lane lists them from its own passes and a restart rebuilds the list over
  the next ones, which can delay an expiry and never cause one.
````

Replace with:

````markdown
  evidence) are mostly never journaled, so the lane lists them from its own passes and a restart rebuilds the list over
  the next ones, which can delay an expiry and never cause one.
- **As wave 5 closes the lane's follow-ups** (each a departure named in the wave-5 plan,
  `docs/superpowers/plans/2026-10-08-workspace-lifecycle-wave5-residue-and-expiry-follow-ups.md`).
  - **The consent binds the branch.** Inside its lock `ws-expire` reads the branch three ways at the recompute and
    again at the pin; if the two reads differ (a branch deleted, or made, in between) it stops there, `failed`
    `state-changed`, after the pin, which only keeps, and before the tombstone and the breadcrumb. A branch already
    absent when the token was minted reads absent twice and expires with its work in the attic. A branch deleted
    between the fresh pin and the tail's settle is as wave 6 of CCR-15 left it: its tip was pinned at the fresh pin.
  - **A `failed` `state-changed` is audited afresh.** ccd prints that document only on a fresh expiry, before the
    tombstone and the breadcrumb, so nothing started. As on the reclaim side, "not resumable" means start over, not
    final: the lane forgets the instant it learned and its sightings and returns to learning, so a later pass's audit
    mints a fresh token over what stands, and the row is asked again only once seen eligible twice past its instant. A
    feed row records it, and nothing is listed. `probe-unmeasured` is still read as final, but ccd prints it on a
    resumed expiry too, after an earlier attempt's breadcrumb (a tombstone it cannot read, or a tmux probe that did not
    answer), so there it can stop the lane on a part-expired archive until a restart. That is a known gap, routed to
    this programme's wave 6 once CCR-15 wave 7's `crumb` field is on `main`, and an arming blocker for the lane until
    then. `pin-failed` and `tombstone-unwritable` stay resumable, because the shared tail prints each after the
    breadcrumb too; the `crumb` field is what can tell those apart.
  - **A kept leaf is listed.** The `expired` document's `clipsKept` and `tmpRootKept` are read by name. A kept word
    (`refused`, `unmeasured`, `in-use`) lists the archive, though its row is gone, saying what was kept and why, until
    the server restarts. An absent key (an older ccd) is recorded in the feed row as unmeasured and lists nothing, so a
    rollout skew raises no alarm on every expiry.
  - **A day of resumable failures slows the asking.** After 24 hours of `failed` (resumable) or `lock-unopenable`
    answers to the act on one archive, the row moves to a persistent tier. Its report stands on the list, naming the
    first failure, the attempts and the last detail, saying the expiry may have stopped part-way (the server cannot
    yet tell), and suggesting no destructive verb. The lane asks again every four hours, never stopping. No answer
    that ends no attempt replaces the entry or resets its run: a hold, a deferral, a shadow audit (its feed row's
    "nothing was deleted" is about that audit alone), a refusal the box retries, an in-use, ccd's "not yet", an older
    ccd's silence.
    The entry goes when an attempt completes, finds that none had begun (a `failed` `state-changed`, which ccd prints
    only before the breadcrumb) or stops for good, or when the workspace is archived again; a restart re-learns. A
    terminal refusal and a composition error are still never asked again.
````

<!-- replay: replace README.md -->
In `README.md`, find (block 132):

````markdown
also a `tmux: server`. A workspace held past its seven days is listed, never touched.
````

Replace with:

````markdown
also a `tmux: server`. A workspace held past its seven days is listed, never touched. A cleanup that completed but kept
the workspace's clips or temp root (ccd's removal refused it, could not measure it, or a process still used it) is
listed, saying what was kept and why, until the server restarts; a fleet box whose ccd predates that report says so in
the feed row only. A cleanup the box keeps failing in a way it says it can resume is retried, backing off, for a day;
then it is listed, with the first failure, the attempts and the last error, and asked again every four hours, never
stopping. The entry stays through a hold, a shadow audit or any other answer that ends no attempt, until an attempt
completes, finds that none had begun or stops for good, or the workspace is archived again.
````

- [ ] **Step 4: Run — green.** Measured: `expiry-lane-prose` `10 passed (10)`; `ws-expire-prose` `7 passed (7)`; `dead-coordinator-prose` `12 passed (12)`; the five citation cases `5 passed | 330 skipped (335)`.

- [ ] **Step 5: Commit.** `docs(lifecycle): §5.3 and README say what wave 5 closed in the expiry lane`.

---

### Task 13: The whole branch, and the PR

**Model routing:** `opus`, effort `high` for the whole-branch review (act-safety lens: nothing arms, nothing deletes or ends what it should not); `sonnet` for the runs.

- [ ] **Step 1: Merge `origin/main` if it moved** (never a rebase), keep both sides, re-stamp `ccd/ccd`, and re-point by content — `## Re-measure at dispatch` lists every block in a shared file. Re-run the five citation cases, `cite-remeasure` and `ccd-reg-get-census`.

- [ ] **Step 2: The full server suite, sharded, one worker each, in the foreground** (twenty-four shards measured ~2–6 minutes each on the loaded box; one or two shards per command keeps each inside a ten-minute foreground limit):

```bash
( cd server && ./node_modules/.bin/vitest run --shard=<k>/24 --maxWorkers=1 )   # k = 1 … 24
```

Measured on the final prototype: 563 test files across the 24 shards; `26296 passed | 2 failed | 93 skipped` tests, 4 files red, every one a known or load red, none this wave's: shard 1 — `boot.test.ts` (`1 failed`: "a valid, instant ccd also boots fast", the known timing case); shard 4 — `session-hook.test.ts` (`1 failed`: "skips a scratch slug", the known `TMPDIR`-outside-`/tmp` red); shards 14 and 16 — `ccrc-install.test.ts` and `ccrc-doctor.test.ts`, each with every test passing and only `tmpHelpers.ts`'s `afterAll(removeTmpFixtures)` timing out at 20 s (`Hook timed out`) while another shard ran beside it; re-run alone, `ccrc-install` `296 passed | 20 skipped (316)` and `ccrc-doctor` `759 passed | 15 skipped (774)`. Every other shard green (e.g. shard 18 `4979 passed (4979)`, shard 24 `817 passed (817)`). That run was the drafted plan's prototype; the revision after review adds one test (`lifecycle-mirror`, Task 5), and the revision after the coordinator's rulings of 2026-10-08 adds three (`archived-expiry-policy`: the `restart` memory case and `keptLeafWord`; `archived-expiry-lane`: the `restart` lane case) and changes test bodies only in files each re-measured alone on the revised prototype, so expect `26300 passed`; the revision after the act-safety lens adds no test (it extends one `archived-expiry-policy` case, one `archived-expiry-lane` case and two `expiry-lane-prose` cases), so the expectation stands. The full sharded run was NOT repeated for any revision (the box's load); every file the revisions touch was re-run alone.

- [ ] **Step 3: The PWA and agent suites, and both typechecks.**

```bash
( cd pwa && ./node_modules/.bin/vitest run --shard=1/2 --maxWorkers=1 ) && ( cd pwa && ./node_modules/.bin/vitest run --shard=2/2 --maxWorkers=1 )
( cd agent && ./node_modules/.bin/vitest run --maxWorkers=1 )
( cd server && ./node_modules/.bin/tsc --noEmit -p . ) && ( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: PWA shard 1/2 `55 passed (55)` files, `1762 passed (1762)` tests; shard 2/2 `54 passed (54)` files, `1693 passed (1693)` tests; agent `25 passed (25)` files, `465 passed (465)` tests; server and PWA `tsc` rc 0.

- [ ] **Step 4: The repo-wide guards, one file per process** (after `git fetch origin main` for `deviation-refs`). Measured on the final prototype (the revision after the coordinator's rulings re-ran `single-definition`, `typecheck-tests`, `topology-clean`, `deviation-refs`, `mail-routes`, `ccd-reg-get-census`, `ccd-refusal-scan`, the five citation cases and both `tsc`s; the revision after the act-safety lens re-ran `single-definition`, `typecheck-tests`, `topology-clean`, `deviation-refs` (this plan copied into the prototype), the five citation cases, `expire-archived` `20 passed (20)`, `ws-expire-prose`, `dead-coordinator-prose` and both `tsc`s, every count as below; the others' files are untouched by it): `single-definition` `409 passed (409)` (this plan adds no case to it; both no-writer pins green); `modelenv-single-writer` `7 passed (7)`; `box-token-census` `23 passed (23)`; `coord-pause-route` `20 passed (20)`; `routing-references` `11 passed (11)`; `typecheck-tests` `12 passed (12)` (needs `agent/node_modules`); `topology-clean` `55 passed (55)`; `ownership` `14 passed (14)`; `coordinator-skill` `161 passed (161)`; `deviation-refs` `31 passed (31)`; `mail-routes` `59 passed (59)`; `ccd-reg-get-census` `3 passed (3)`; `ccd-refusal-scan` `11 passed (11)`; the five citation cases `5 passed | 330 skipped (335)`.

- [ ] **Step 5: The no-writer check by hand.** `git grep -n "expire-lane-live\|dead-coordinator-lane-live" -- server/src ccd agent pwa/src deploy` names only the two definers and their readers; the diff adds no write of either.

- [ ] **Step 6: The PR.** Title: `Workspace lifecycle wave 5: review 339's residue (the dead-coordinator lane's arming blockers), then the expiry lane's follow-ups (CCR-17)`. The body lists each task with its red/green counts, every mutation row, the departures with their issued numbers, the B1 census, the F5 measurement and the questions below, and says both lanes stay SHADOWED. The worker opens it; the coordinator rules.

## Re-measure at dispatch

Drafted on `origin/main` `b0647d850`; revised on `226bb881c`. Before Task 1, `git fetch origin` and, if `main` moved, replay each block below against the new tip: each must still match exactly once at its turn. A block that does not is a moved anchor — re-point it BY CONTENT (the block's own text says where), never by a line delta, and say so in the PR. Every block in a file another in-flight wave edits:

| Block | Task | File | Its anchor begins |
|---|---|---|---|
| 126 | 11 | `ccd/ccd` | `local phase="" resumed="" declared="" lctx project workdir main clips pinned=0 start=children` |
| 127 | 11 | `ccd/ccd` | `# outlives the row. A vanished worktree takes the RECLAIM region's own arm.` |
| 128 | 11 | `ccd/ccd` | `_ws_reclaim_pin "$id" "$workdir" "$main" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT" && pinned=1` |
| 67 | 7 | `README.md` | `seen dead, and one when the breaker trips) are records of the same incident.` |
| 132 | 12 | `README.md` | `` also a `tmux: server`. A workspace held past its seven days is listed, never touched. `` |
| 31 | 3 | `server/src/watch.ts` | `done !== null && done.programmes.length > 0 ? { closed: done.programmes, released: [], stop: null } : undef…` |
| 45 | 4 | `server/src/watch.ts` | `recordDeadCoordinatorFeed,` |
| 46 | 4 | `server/src/watch.ts` | `if (done !== null && done.programmes.length > 0) {` |
| 63 | 6 | `server/src/watch.ts` | `journalTrust: async () => (await readDeadCoordinatorJournalTrust({ coord, io: this.deps.io, cfg: this.deps.…` |
| 109 | 9 | `server/src/watch.ts` | `for (const id of [...this.archivedExpiryState.keys()]) if (!seen.has(id)) this.archivedExpiryState.delete(id);` |
| 110 | 9 | `shared/api.ts` | `readonly kind: 'would-expire' \| 'held' \| 'in-use' \| 'refused' \| 'failing' \| 'no-evidence';` |
| 65 | 7 | `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` | `` - The programme retires as `abandoned`, permanently. `` |
| 66 | 7 | `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` | `` - **Not changed:** the reclaim door and the stall watch ignore the verdict's new `cause`; landing reads a r… `` |
| 131 | 12 | `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` | `evidence) are mostly never journaled, so the lane lists them from its own passes and a restart rebuilds the…` |

`server/test/single-definition.test.ts`: no block (run 302 appends at its end; nothing here moves). `server/src/coord/childReclaim.ts`: no block (CCR-15 wave 7's).

## Deviations found

Named by slug, in the order the brief's numbers are written against them (the callout at the top). Each reaches the spec by its effect — the residue's through §5.4's "As wave 5 corrects the lane" (Task 7), the expiry's through §5.3's "As wave 5 closes the lane's follow-ups" (Task 12) — one short sentence each, no number spelled there.

- **D-4480** `a-second-crash-is-a-second-record` (Task 2) — §5.4 and wave 4 write a shadow row when the outcome CHANGES; an episode-ending reading now forgets the last outcome, so crash → revive → crash writes a second `would-end` row (review 339, F2).
- **D-4481** `a-release-and-a-re-hold-are-two-acts` (Task 3) — `sweep-stopped` carried `released: boolean` for a release AND a re-hold; it now carries which act ran (`fleetAct`), and the feed row and the attention sentence word each (review 339, F3).
- **D-4482** `sweep-stopped-names-the-fleet-act` (Task 3) — the `POST /api/runs/:id/close` 409 body for `sweep-stopped` names `fleetAct` in place of `released` (no route reaches that arm; the exhaustive switch moves with the union).
- **D-4483** `every-thrown-act-is-recorded` (Task 4) — every thrown act writes one `dead coordinator: act failed` feed row naming the programmes it closed, the run whose abandon failed, and that nothing more is known; the outcome gains `failedRun` (review 339, F13).
- **D-4484** `an-unread-generation-is-no-successful-sweep` (Task 5) — the lifecycle mirror's `lastOkAt` moves only when every planned generation read answered, so a persistent unreadable generation reads `stale` (and the lane decides nothing) instead of `ok` (the worker's open item 2).
- **D-4485** `a-stale-mirror-at-the-act-is-a-hold` (Task 6) — a mirror gone `unknown`/`stale` between the pass and the act stops it as a `hold`: the anchor and the run of crashed passes are kept, and it waits one pass (review 339, F4, ruled; the ruling's "like the switch does" is read for the anchor and the wait, its "the run of passes is KEPT" for the passes — the switch itself resets them). `stillCrashed` now reads the journal's trust BEFORE measuring the claimant (main reads it after), so the claimant's measure is the last awaited step before the commit and review 339's sized item 3 window ("the only awaited step left is journalTrust()") is stale. Two windows move, in opposite directions: the REVIVE window narrows to the claimant measure's own round trip; the JOURNAL window (the mirror's gap list and the last write-error instant) is no longer narrow — it now spans that same round trip, so a gap or write error recorded during the measure is not seen until the next pass. The trade is accepted because a missed revive is the costlier error: it closes a live coordinator's runs, while a missed gap fails open only if it also hides a deliberate act by that same claimant (the coordinator's ruling, mail 4062; wave 6 re-reads the synchronous gap list after the measure, and both windows go into the lane's arming notes).
- **D-4486** `an-abandoned-programme-row-is-rewritten-only-by-a-last-close` (Task 7) — §5.4's "retires as `abandoned`, permanently" becomes three measured facts: it reads `abandoned`, a new run under the fenced slug leaves it so, and the next close of the programme's last open run rewrites it (`done` or `abandoned`) (review 339, F5). The ruling's own "nothing resets it" is measured false by the third fact; the ledger's 12:02 entry and question (f)'s framing need the same correction.
- **D-4487** `a-pre-start-reclaim-failure-reads-deliberate` (Task 7) — the journal clause reads a child's pre-start `reclaim` `failed` `probe-unmeasured` row as deliberate and abstains; accepted, stated in §5.4 with where it is reachable (CCR-15's cross-side record, ruled: no code change).
- **D-4488** `a-failed-state-changed-audits-afresh` (Task 8) — `parseExpireResult` reads a `failed` `state-changed` as `restart` — neither resumable nor final (the expiry's one producer prints on its fresh arm, before the breadcrumb; a census of every occurrence of the word in ccd/ccd holds that): the lane forgets the instant and the sightings it learned and audits the row afresh, lists nothing, and writes a feed row — the reclaim side's "not resumable", which means start over (ruling B1; question (h) ruled by the coordinator 2026-10-08). `probe-unmeasured` keeps `main`'s final reading, though it also prints on a resumed arm after a standing breadcrumb — a known gap, routed to wave 6, question (k). A `restart` that recurs is uncounted (Task 8's stated residual; a count is wave 6's).
- **D-4489** `a-kept-leaf-is-listed-until-restart` (Task 9) — an `expired` document with a kept word on `clipsKept`/`tmpRootKept` raises a `kept` attention entry that outlives the purged row in the lane's memory until a restart (ruling B2). ccd's three words are read by ONE word reader, `keptLeafWord`, which `expireLeafKept` composes with the done document's carrier and CCR-15 wave 8's mirror carrier imports (the coordinator's R3, agreed with CCR-15).
- **D-4490** `an-older-ccds-silence-is-the-feed-rows-only` (Task 9) — an absent key reads `unreported`, never `null`, and is said in the feed row only — no attention entry — so the rollout skew raises no alarm (ruling B2, the coordinator's lean). The ruling's word for absence, `unmeasured`, becomes the internal token `unreported` because ccd's own `unmeasured` kept word must raise an entry and absence must not — one value at the seam would carry both; the feed row and §5.3 still word absence as unmeasured.
- **D-4491** `a-day-of-resumable-failures-slows-the-asking` (Task 10) — after `EXPIRE_FAILURE_GIVE_UP_MS` (24 hours) of resumable failures of the act on one archive, the row moves to a PERSISTENT TIER: its report is a standing entry naming the first failure, the attempts and the last detail and saying the expiry may have stopped part-way, and the lane asks again every `EXPIRE_PERSISTENT_RETRY_MS` (four hours), never stopping. No answer that ends no attempt — a hold, a deferral, a shadow audit, a refusal the box retries, an in-use, ccd's "not yet", an older ccd's silence — drops it or resets its run (the act-safety lens on the revised plan); it goes when an attempt completes, finds that none had begun (a `failed` `state-changed`, fresh-arm only) or stops for good, or the archive changes; while it stands an in-use is recorded in the feed row, not listed in its place (ruling B3, revised by the coordinator 2026-10-08 and agreed with CCR-15's coordinator, answering its R69: nothing is stranded behind an expire breadcrumb).
- **D-4492** `the-day-long-stop-covers-the-act-not-the-learn` (Task 10) — the day-long horizon and its persistent tier cover the ACT only: the learning audit's own failure ladder keeps its backoff and never reaches the tier, because it composes nothing destructive.
- **D-4493** `expire-consent-binds-the-branch-both-ways` (Task 11) — `ws-expire` refuses `failed` `state-changed` when the in-lock recompute and the pin read the branch differently, in BOTH directions as CCR-15 §5.5 binds a reclaim's (the ruling named the deleted direction; measured: with no check, a branch made in the window is deleted at the pin's tip), before the tombstone and the breadcrumb (ruling B4).
- **D-TBD-an-audit-failure-never-reaches-the-tier** (Task 10, final review I1) — only a failure of the `ws-expire` verb (and `box`, which only the verb meets) moves a row onto the persistent tier; a failure of the act's own audit is its own outcome (`audit-failed`), keeps the backoff ladder and the hour-ceiling report, which `would-expire` replaces, and under a standing entry ends no attempt, so a shadow lane never shows a part-way sentence for a workspace no verb touched (extends D-4492's learn-audit rule to the act's audit).

## Deploy note

- **Class: AGENT-FIRST, then server (the PWA ships with the server).** Task 11 edits `ccd/ccd`. Move the fleet with `ccrc rollout --to vX.Y.Z` (fleet box first by default) once the release exists; a hand placement is never the path.
- **Either order is safe, measured by reading and in the prototype.** A NEW ccd under an OLD server: the old parser reads the new `failed` `state-changed` as resumable and asks again after its backoff. The lane holds no token — every act audits first and spends THAT audit's token (`expireArchived`, step 5) — so the old server's retry is itself a fresh audit over what stands, the same end the new server's `restart` reaches by re-learning; and a stale token, were one ever presented, is refused (`{"refused":"state-changed"}`, exit 0) before anything (measured, Task 11). Harmless. Were it to keep failing, an OLD server retries it hourly for ever (it has no day horizon) and a new one reaches Task 10's persistent tier after a day — neither strands it. An old server ignores `clipsKept`/`tmpRootKept` (it reads named keys only). A NEW server over an OLD ccd: no expiry `failed` `state-changed` is printed at all (item 1 of Measured while planning), and an absent kept-leaf key reads `unreported` — recorded in the feed row, no alarm.
- **No migration, no route, no `FLEET_PROTO` bump.** `ExpiryAttention.kind` gains `'kept'` (additive; an older PWA renders it `reported`). The `sweep-stopped` 409 body's field rename is on an arm no route reaches.
- **Both lanes stay SHADOWED.** Nothing here writes `$REG/expire-lane-live` or `$REG/dead-coordinator-lane-live`. After merge, the ledger's arming blockers read: the dead-coordinator lane's five (F1, F2, F3, F13, the mirror) closed by Tasks 1–5; the expiry lane's `state-changed` reading closed by Task 8 (audit afresh, question (h) ruled); the resumed-arm `probe-unmeasured` reading stays `main`'s — question (k), ROUTED to this programme's wave 6, after CCR-15 wave 7 is on `main` (`_ws_expire_locked` sets wave 7's `crumb`, the global `_WS_RCL_CRUMB`, on its resumed arm, and the parser reads a failed document with `crumb: true` as resumable, so it backs off and reaches Task 10's persistent tier) — and it is an ARMING BLOCKER for the expiry lane until then; `_ws_expire_cwd_users`' newline fail-open closed by #326 (`_ws_dir_physical "$parent"`, ccd/ccd:30649 at `b0647d850`). Check the merged lines before arming; arming stays the operator's, by hand.

## Questions for the operator

Lettered to continue the programme ledger's own open questions — (a)–(d) in its 2026-10-07 06:01 entry and (f) from review 339 — so a relayed letter is never ambiguous.

- **(g) F4's two halves.** The ruling says a stale mirror at the act "stops the act like the switch does: the anchor and the run of passes are KEPT". The switch resets the run of passes. This plan keeps them (and the switch's one-pass wait). Resetting would only delay. Confirm, or say "reset".
- **(h) B1's "final" — RULED by the coordinator 2026-10-08: audit afresh (the reclaim side's meaning).** A `failed` `state-changed` starts over: the lane forgets the instant and the sightings it learned, a later pass's audit mints a fresh token over what stands, and the row is asked again once seen eligible twice past its instant; a feed row records it and nothing is listed (Task 8). Measured in Task 11: nothing the refusal leaves is misread by that audit. No longer an open ask.
- **(f) F5 — should a new run reset an `abandoned` programme row?** Measured in a fixture store: the row stays `abandoned` while the revived coordinator's new run is open; the board lists the run normally (it carries no programme state); `toId:'coordinator'` mail WITHOUT a `runId` resolves through "exactly one ACTIVE programme", so it is refused `unknown-recipient` while nothing else is active — and is delivered to ANOTHER programme's coordinator when exactly one other programme is active; WITH a `runId` it reaches the revived coordinator. The row is rewritten by the next close of the programme's last open run. By reading `resolveCoordinator` (not measured): resetting the row to `active` on `openRun` would make that role mail resolve to the revived coordinator while it is the only active programme, and refuse it as ambiguous while another is active, instead of misdirecting it.
- **(i) B2's kept entries** stay on the attention list until a server restart (the row is gone, so nothing else clears them); the feed row is the durable record. Is that the life you want, or should a kept entry expire after a set time?
- **(j) B4's direction.** This plan refuses a branch MADE inside the lock as well as one deleted (the reclaim side's rule), where the ruling named the deleted direction. Say if the made direction should go on as before.
- **(k) The resumed arm's `probe-unmeasured` — routed to wave 6; an ARMING BLOCKER for the expiry lane until then** (found by the review's safety lens; unchanged from `main`). `_ws_expire_locked` prints `probe-unmeasured` at its verdict point on every arm, so on a resumed expiry it follows an earlier attempt's standing breadcrumb with the tree possibly part-deleted (a tombstone it cannot read, or one tmux probe that did not answer). The parser reads it final, so one transient failure stops the lane for that archive until a server restart. It keeps that reading in this wave. The coordinator routed the fix to this programme's WAVE 6, after CCR-15 wave 7 is on `main`: `_ws_expire_locked` sets wave 7's `crumb` (the global `_WS_RCL_CRUMB`) on its resumed arm, and the parser reads a failed document with `crumb: true` as resumable (→ backoff → Task 10's persistent tier). No longer an open ask; the expiry lane is not armed before wave 6.
