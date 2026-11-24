# W1 sandbox, PR B: the builder's notes

What PR B (Tasks 8 and 9 of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`) found and departed from, by slug,
for the coordinator to fold into the ledger. PR A's notes are `w1-sandbox/notes.md` and PR A2's `w1-sandbox/notes-a2.md`
beside the plan; the load-path measurement is `w1-sandbox/load-path.md`. Revised in fix round 1 (review 3325), fix round 2
(review 3346) and fix round 3 (review 3366: a merge of main and words only, no behaviour change).

## What it ships

- `server/src/continuity/sandboxCheck.ts` (L1, C3): `expectedSurfaceOf`, `sandboxVerdict`, `profileEngagedOf`, `sandboxSettle`,
  `settleEvidenceStands`, `skewNoticeOf` and `skewRunningOf`. No verdict is stored (slug `verdict-computed-on-read`).
- The ladder's row `launch-profile-unengaged` (`shared/overlord-ladder.ts`), a condition read by `launch-profile-unmet`, the
  gate order's step 6, with no cap; its input in `overlordLadderRead.ts#ladderConditionInputs`.
- The loads door's settle step (`continuity/routes.ts#settleLoads`), wired in `server.ts`.
- The skew notice, raised by the launch-profile lane (`profileLane.ts`, wired in `watch.ts`).
- `SANDBOX_MUTANT_SETS`: four deciders with a floor of 1 each, 31 mutants (`sandboxVerdict` 16, `profileEngagedOf` 3,
  `sandboxSettle` 5, `skewNoticeOf` with `skewRunningOf` 7).

**Not in this PR any more (the coordinator's split ruling, fix round 1).** The session hook's surface arm, the shared
skill-name reader and their test (`session-hook-surface-arm.test.ts`, with review 3325 F5) moved to a hook-only packet, now
#3213, a prerequisite that lands first: enforcement before the settle step can take a designation live. They are kept in this
branch's history (commit `b43313cf49`) and removed by the commit after it. Their slugs below are kept for the ledger and
marked as moved.

## The builder's departures

| Slug | The plan says | Built |
|---|---|---|
| `own-lists-list-no-build` (review 3325 F4, ruled) | `CLAUDE_CODE_OWN_LISTS` is a rig lower bound; a live read is a Needs-first of PR B. | The table lists no build. The first build of this PR read 2.1.330 from account sessions, which is account inventory, not built-in provenance: an account's own configuration can supply a name. The coordinator ruled it out: every build, 2.1.330 included, reads `skills` and `agents` `unmeasured`, so no designation goes live on real skills or agents until the queued capture inventory supplies the provenance. The rig's 2.1.323 and 2.1.325 lower bounds stay removed. Tests use an isolated fixture build (`0.0.0-fixture`) and its own lists, passed to `expectedSurfaceOf` (and, at the door, through the server's `overlordSandbox.ownLists` test seam); the exact 2.1.330 fail-closed case is pinned in the decider cases (`sandboxCases`) and the ladder input suite (`sandbox-ladder-input`); `sandbox-check`'s expected-surface describe pins only that the release's table is empty and is the default (review 3346 F12). Listing a build, as built today, takes a ccrc release that edits this table: the ruled cost of question 4, unchanged here (review 3346 F7). |
| `settle-takes-the-report-start-id` | `sandboxSettle(designation, start, newestStartId, verdict)`, `start` the report's start. | `sandboxSettle(designation, reportStartId, newest, verdict)`: the door reads only the newest start (the one read of the table), so the report's start is named by its id and the decider checks it is the newest. Same rule, one read fewer. |
| `settle-acts-on-designate-only-until-rebind` | A rebind's first start reaches the same step when designation B lands. | The decider acts only on a pending `designate`; a pending `rebind` answers `none` until designation B adds its arm, as `goLive` itself leaves a rebind alone today. |
| `verdict-rechecks-the-carry` (PR A review 2135 F9, carried) | PR B re-checks `carriedFrom` server-side. | `startLoadsOfNewestStart` reads the carried start and its report in the same statement (`carry`), and `sandboxVerdict` takes it: unless it is a `startup` of the session whose report is not conflicted and records the same digest and build, `instructions`, `hooks` and `workspace` read `unmeasured`. |
| `profile-engaged-needs-the-newest-report` (review 3325 F8) | `profileEngagedOf` reads the newest start's own report. | It also refuses a report whose `startId` is not the newest start's id, so a reader handed an older start's report reads `not-engaged`; mutant P1 pins it. |
| `workspace-read-through-measured-project` | `workspaceOf` reads the registry row's project. | The door's `workspaceOf` is `registry.ts#measuredProjectOf` over `readSessionRecord`, the one decision on `projectEvidence` outside the radar, so an unmeasured project reads `unmeasured`. |
| `ladder-reads-the-workspace-the-settle-measured` | The ladder's input is `profileEngagedOf` with the workspace fact. | The ladder's inputs are synchronous and the registry read is not, so the input passes the project `overlord` for the bound body: the settle step measured that project when this binding went live, and a body's registry project never changes. Its cwd and instruction files are still each start's own report. A binding made without the settle step (designation B's rebind, a restore) would read the constant as a measurement; that follow-up has to change this input. |
| `settle-runs-after-the-answer` (corrected, review 3325 F2) | The door's step runs after `insertStartLoads`. | It runs after the door answers 202, on the coordination serialiser (so it never interleaves with a designate or a retire), so the hook's 3 s send budget never waits on a stop. A 202 clears the hook's spool, so nothing resends an answered report: a settle lost after the answer (a restart, a throw, a go-live the journal refuses) leaves the attempt pending with its body running until something re-runs `settleLoads` from the stored report. The first build of this note said a resend retries it; that was wrong. Ruled in fix round 1 (option a): designation B's deadline sweep owns the re-run, feeding matching stored reports through this same `settleLoads` with the same ports and writers; no caller, scheduler or writer is added here. `settleLoads` acts on nothing for a newest start with no stored report yet. The re-run is pinned at the function, and the door posts the same cases except one (review 3346 F2, F10, F11; review 3366 F10): go-live once; a stored failed report's fail-pending and drain; a duplicate after success; a stale start whose newer start has its own stored report, held and failed; a newest start with no report (`no-report`, told apart from a stale start); another session's report, held and failed; another generation's report, held and failed, which is pinned at the function only; no go-live from missing or unmeasured facts; each stored body asserted 202. **Restart and loss recovery is not shipped:** no end-to-end proof exists until designation B's sweep lands, and no first live designation or readiness claim rests on it. |
| `settle-reports-its-outcome` (review 3325 F6, review 3346 F1 and F2) | (none) | `settleLoads` answers what it decided and tells the port's optional `settled` once done: `none` (the decider's), `no-report`, `stale`, `go-live`, `refused`, `fail-pending` (recorded and drained), `fail-refused` and `fail-threw` (the record could not be written), `fail-noop` (no longer pending), `unread` and `threw`. Production passes no `settled`; the door suite waits on it, so a case that expects nothing proves the settle ran and decided. |
| `settle-rereads-after-the-registry-read` (review 3346 F3) | (none) | The start and loads doors write outside the coordination serialiser, so a newer start or a second body can land while the settle awaits the registry read. `settleLoads` reads the designation and the newest start again after that await, and `settleEvidenceStands` (L1) answers whether they still match; if not, the settle answers `stale` and acts on nothing. Pinned with a newer start and its report, and with a conflicting second body, each landing during the await. |
| `settle-stops-an-unrecorded-failure` (review 3346 F1, ruled in fix round 2) | (none) | When the check fails for the measured pending session and generation but `failPending` is refused or throws, the settle still stops that one body through the designation's drain with the id passed as unrecorded, for a refused record and for a thrown one alike: the drain logs it as a residual and claims no stop debt, the record is not retried, and the pending row still names it for designation B's sweep or a retire. This is not the designate door's handling of a throw, which counts the record as written, drains the id as owed and retries the record while the stop stays owed (review 3366 F7). If the drain's stop-done write throws after the stop, the settle answers `threw` with the body already stopped (review 3366 F8). A `changed: false` record (no longer pending) stops nothing. Pinned with stub ports: refused, thrown, no-op, recorded, a drain that throws, the exact target, and negative controls that never reach the write. |
| `settle-drains-through-the-designation-drain` | `fail-pending` clears `profiledigest` through `routeSet`, then stops through `stopCreated`. | `failPending('overlord-sandbox-unmet', owesStop)` then `drainOwedStops`, the designation's one drain: keep-awake off, then the set and `profiledigest` cleared, then the stop, with `stopDone` on success. A failed off still stops, and the id stays owed for the next drain (designation B's sweep, or a retire). The settle runs on the serialiser it is handed (`coordRoutes.serial` in `server.ts`); its ordering is pinned with a fixture serialiser held by an earlier step (review 3346 F13). |
| `overlord-body-built-once` | `server.ts` wires `stopCreated` into the continuity deps. | The Overlord body (`ccdOverlordBody`, with the stop route's own path) and the designation store are built once, above the continuity routes, and both the designation doors and the settle step take them. |
| `surface-arm-reads-the-installed-row-keys` (moved to the hook packet) | The arm reads the row's tools, tool server, reader types and skills. | It reads keys the projection already has: `--tools`, `--agents`' keys, `stagedSkills`' keys, and the tool server from the servers the reader types' tools name (`mcp__door__read`). Flags that lack `--tools` or `--agents` are a malformed row and deny every call (review 3325 F5). |
| `skill-name-reader-shared` (moved to the hook packet) | The arm reads the skill name with the role-skill arm's reader. | The role-skill arm's inline jq became `SKILL_NAME_JQ` (`def skillname`), which both arms use. |
| `skew-notice-keyed-in-the-feed` (wording ruled in fix round 1; scope and wiring, review 3346 F5, F8, F9) | Once per session and build pair; a restart does not raise it again. Task 9's text: the notice "says that a dead Overlord stays dead until the two boxes run one build"; Table W1: the designated Overlord's session. | The lane raises it through `pushOne` (`record-always`) with the key as the feed's once-only `dedupeKey`, and asks `CoordStore.hasNotice` first, so the mark survives a restart with no new table; pinned through the real watcher, feed and `hasNotice`, across a second pass and a restarted watcher (`sandbox-skew-watcher`), with the inventory and fleet reads stubbed. It judges the designated body only, as the plan says; a pending attempt raises nothing. The ruled build-skew proxy stands, but the words differ from Task 9's text, as the coordinator ruled in fix round 1 (mail of review 3325's F1): they say only what is measured, that the builds differ and that a digest mismatch can keep the body from respawning, never that it stays dead or was refused. Nothing reads whether a respawn was refused, and a release that leaves the `overlord` row alone keeps its digest. The body's liveness is `skewRunningOf` over its fleet-state row (`rowStanding`: here runs; gone or asleep is down; doubt, or a session the state does not list, is unmeasured and raises nothing), pinned with its mutants R1 to R3. The builds are the inventory's (a tag, else a short sha). |
| `failed-attempt-columns-from-designation-a` | Question 3: PR B adds the failed-attempt columns if designation A ships none. | Designation A shipped them (`attemptId`, `attemptOutcome`, `attemptAt`, `stopsOwed`), so PR B adds no migration. |

## What the operator and the fleet see

- **No Overlord designation can go live yet.** With no build listed, a pending designation's first report reads `skills`
  and `agents` `unmeasured`, and the attempt ends `overlord-sandbox-unmet` (the profile digest cleared, the body stopped). A
  bound Overlord, if one existed, would stand at the gate order's step 6 (`launch-profile-unmet`) as soon as this build
  runs, because the ladder recomputes the verdict on every read; also between a respawn and its first report (review 3346
  F4). This lasts until a ccrc release lists a build with built-in provenance from the capture inventory. The hook's
  call-time enforcement (#3213) lands first, and no first live designation is claimed from this PR.
- **A resume before the first `Stop` fails the attempt.** A resume writes no `prompt_snapshot` (load-path.md §3), so its
  `tools` and `toolServers` read `unmeasured`, and a pending designation whose body respawned before its first `Stop`
  ends `overlord-sandbox-unmet`. That follows the rulings (`resume-carries-its-own-start`); the operator starts it again.
- **A settle lost after the answer leaves the attempt pending, its body running,** until designation B's deadline sweep
  re-runs it from the stored report (`settle-runs-after-the-answer`). That sweep is not in this tree. A silent `stale`
  settle is one way to lose it (Known limits, F5 and F6).
- **Every Claude Code roll will hold the Overlord until its build is listed.** The lists are keyed by build (question 4) and
  are a constant in the release, so, as built today, each roll needs a ccrc release that lists the new build. The queued
  capture inventory is where that list's provenance would come from; making it a runtime read is not built.

## A relied-on contract (review 3366 F6, ruled in fix round 3)

The server relies on the session hook's shipped order. At a resume, the hook names a carried start (`carriedFrom`) only
from its `loadlast` file. It writes that file only after the carried `startup` report was answered 202
(`ccd/session-hook.sh#_hook_start_loads`). So the carried start's report is already stored when the resume report that
names it arrives, and the carry cannot change while the newest start's settle waits on the registry read.

If that order is ever broken, the carried report, or its conflict flag, can land during that wait. The newest start's
settle then answers `stale`. The carried report's own settle answers `none`, because it is not the newest start. Nothing
resends the newest report, which was already answered, so the attempt stays pending behind a stale settle until
designation B's sweep. That is a known limit (below).

**Carried constraint for designation B's wave:** its deadline sweep retries a pending attempt whose settle was stale or
lost, through `settleLoads`, and logs each retry. No code for it is in this PR.

## Known limits (follow-up ticket `sandbox-b-door-pins`, review 3366)

- **F2.** Nothing pins that the composition root hands the drain the unrecorded set: the id when the record failed, empty
  otherwise. The door cases never make the record refuse or throw, and the function cases replace the drain with a
  recorder.
- **F3.** Nothing pins that the composition root hands the settle the coordination serialiser the designation doors use.
  The serialiser case proves only that the settle waits on the serialiser it is handed.
- **F4.** Nothing pins the designation half of `settleEvidenceStands`. No case changes the designation during the registry
  read, and the helper has no mutant set or floor. Every designation writer runs on the same serialiser, so this half is
  defence in depth, but the rule that a guard ships with a test that goes red when it is removed is not met for it.
- **F5.** The outcome `stale` covers three conditions: evidence that changed during the registry read, a re-read of the
  newest start that failed, and a designation that reads unmeasured the second time. All three act on nothing. Neither
  re-read failure has a case. A `stale` settle is also silent in production: it writes no log, and production passes no
  `settled`. It is one more way a settle can be lost after the answer.
- **F6.** The carry order above is relied on, not checked. If it breaks, the attempt stays pending behind a stale settle
  until designation B's sweep.

The reviewer's three mutants for F2, F3 and F4 each survive every door case.

## Not changed here

- `ccd/lib/launch-profiles.json`, the `overlord` digest and, since the split, `ccd/session-hook.sh`.
- No route, no table, no migration, no ccd verb, no capability word.

## Measured

Scoped runs on this box, each file or group through `ccrc test`, fixture HOMEs and stub ports only. None of these is a whole
suite run: the whole suite, the browser suite and the whole-tests typecheck have not been run for this PR, and CI and the
merge queue are the arbiters for everything else.

Fix round 2, at the round's own commits:
- Suites, each green: `sandbox-check`, `sandbox-settle` and `sandbox-ladder-input` (3 files, 39 tests);
  `continuity-start-loads-route` (43), `continuity-profile-lane`, `run-session-census` and `sandbox-skew-watcher` (4 files,
  102 tests; in that batch the watcher file's second case timed out at the 20 s default, so its describe got the door
  suite's 90 s budget, and the file then passed alone, 2 of 2, in 40 s); the five `overlord-ladder*` suites (149); `rings` and
  `single-definition` (56 files, 1711 tests); `growth-check` armed, `growth-caps`, `anchors` and `citations` (4 files, 122).
- Mutation, scoped to the four sandbox keys plus BASELINE, CONTROL, the decider-name match and the merge-base floor check: 8
  of 8 tests, 31 of 31 mutants killed. The whole mutation-floors file was not run.
- By hand, each from a saved copy and restored, against `continuity-start-loads-route`: the stale-start check dropped (5 red);
  the freshness re-check dropped (2 red); the serialiser bypassed (1 red); a refused record not drained (2 red); a no-op
  record drained (1 red); a thrown record not drained (1 red); the generation check dropped (2 red). Against
  `sandbox-skew-watcher`: `noticed` mis-keyed (1 red), the raise without its `dedupeKey` (1 red), the builds read as a sha only
  (1 red: the first case; the second is a negative control that raises nothing whatever the build format, corrected in fix
  round 3 from 2, review 3366 F1), the fleet lookup missing the body (1 red).
- The server typecheck, and a typecheck of the touched test files with everything they import: clean.
- Growth, armed, no waiver: `server/src/server.ts` +8, `server/src/watch.ts` +7 (`watch.ts` unchanged this round).

Fix round 1, kept for the record: the drain's stop replaced by a success stub, the settle's drain call removed, and a pending
designation read as standing by the ladder input each turned their cases red. The hook packet's `session-hook-surface-arm`
(10) and `session-hook-role-skill-deny` (20) ran in this tree before the split; they belong to #3213 now.
