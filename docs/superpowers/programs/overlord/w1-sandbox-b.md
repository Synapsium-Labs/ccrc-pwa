# W1 sandbox, PR B: the builder's notes

What PR B (Tasks 8 and 9 of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`) found and departed from, by slug,
for the coordinator to fold into the ledger. PR A's notes are `w1-sandbox/notes.md` and PR A2's `w1-sandbox/notes-a2.md`
beside the plan; the load-path measurement is `w1-sandbox/load-path.md`. Revised in fix round 1 (review 3325).

## What it ships

- `server/src/continuity/sandboxCheck.ts` (L1, C3): `expectedSurfaceOf`, `sandboxVerdict`, `profileEngagedOf`, `sandboxSettle`,
  `skewNoticeOf` and `skewRunningOf`. No verdict is stored (slug `verdict-computed-on-read`).
- The ladder's row `launch-profile-unengaged` (`shared/overlord-ladder.ts`), a condition read by `launch-profile-unmet`, the
  gate order's step 6, with no cap; its input in `overlordLadderRead.ts#ladderConditionInputs`.
- The loads door's settle step (`continuity/routes.ts#settleLoads`), wired in `server.ts`.
- The skew notice, raised by the launch-profile lane (`profileLane.ts`, wired in `watch.ts`).
- `SANDBOX_MUTANT_SETS`: four deciders with a floor of 1 each, 31 mutants (`sandboxVerdict` 16, `profileEngagedOf` 3,
  `sandboxSettle` 5, `skewNoticeOf` with `skewRunningOf` 7).

**Not in this PR any more (the coordinator's split ruling, fix round 1).** The session hook's surface arm, the shared
skill-name reader and their test (`session-hook-surface-arm.test.ts`, with review 3325 F5) moved to a hook-only packet for
a separate PR that lands first: enforcement before the settle step can take a designation live. They are kept in this
branch's history (commit `b43313cf49`) and removed by the commit after it. Their slugs below are kept for the ledger and
marked as moved.

## The builder's departures

| Slug | The plan says | Built |
|---|---|---|
| `own-lists-list-no-build` (review 3325 F4, ruled) | `CLAUDE_CODE_OWN_LISTS` is a rig lower bound; a live read is a Needs-first of PR B. | The table lists no build. The first build of this PR read 2.1.330 from account sessions, which is account inventory, not built-in provenance: an account's own configuration can supply a name. The coordinator ruled it out: every build, 2.1.330 included, reads `skills` and `agents` `unmeasured`, so no designation goes live on real skills or agents until the queued capture inventory supplies the provenance. The rig's 2.1.323 and 2.1.325 lower bounds stay removed. Tests use an isolated fixture build (`0.0.0-fixture`) and its own lists, passed to `expectedSurfaceOf` (and, at the door, through the server's `overlordSandbox.ownLists` test seam); the exact 2.1.330 fail-closed case is pinned in the decider, ladder and expected-surface suites. |
| `settle-takes-the-report-start-id` | `sandboxSettle(designation, start, newestStartId, verdict)`, `start` the report's start. | `sandboxSettle(designation, reportStartId, newest, verdict)`: the door reads only the newest start (the one read of the table), so the report's start is named by its id and the decider checks it is the newest. Same rule, one read fewer. |
| `settle-acts-on-designate-only-until-rebind` | A rebind's first start reaches the same step when designation B lands. | The decider acts only on a pending `designate`; a pending `rebind` answers `none` until designation B adds its arm, as `goLive` itself leaves a rebind alone today. |
| `verdict-rechecks-the-carry` (PR A review 2135 F9, carried) | PR B re-checks `carriedFrom` server-side. | `startLoadsOfNewestStart` reads the carried start and its report in the same statement (`carry`), and `sandboxVerdict` takes it: unless it is a `startup` of the session whose report is not conflicted and records the same digest and build, `instructions`, `hooks` and `workspace` read `unmeasured`. |
| `profile-engaged-needs-the-newest-report` (review 3325 F8) | `profileEngagedOf` reads the newest start's own report. | It also refuses a report whose `startId` is not the newest start's id, so a reader handed an older start's report reads `not-engaged`; mutant P1 pins it. |
| `workspace-read-through-measured-project` | `workspaceOf` reads the registry row's project. | The door's `workspaceOf` is `registry.ts#measuredProjectOf` over `readSessionRecord`, the one decision on `projectEvidence` outside the radar, so an unmeasured project reads `unmeasured`. |
| `ladder-reads-the-workspace-the-settle-measured` | The ladder's input is `profileEngagedOf` with the workspace fact. | The ladder's inputs are synchronous and the registry read is not, so the input passes the project `overlord` for the bound body: the settle step measured that project when this binding went live, and a body's registry project never changes. Its cwd and instruction files are still each start's own report. A binding made without the settle step (designation B's rebind, a restore) would read the constant as a measurement; that follow-up has to change this input. |
| `settle-runs-after-the-answer` (corrected, review 3325 F2) | The door's step runs after `insertStartLoads`. | It runs after the door answers 202, on the coordination serialiser (so it never interleaves with a designate or a retire), so the hook's 3 s send budget never waits on a stop. A 202 clears the hook's spool, so nothing resends an answered report: a settle lost after the answer (a restart, a throw, a go-live the journal refuses) leaves the attempt pending with its body running until something re-runs `settleLoads` from the stored report. The first build of this note said a resend retries it; that was wrong. Ruled in fix round 1 (option a): designation B's deadline sweep owns the re-run, feeding matching stored reports through this same `settleLoads` with the same ports and writers; no caller, scheduler or writer is added here. `settleLoads` acts on nothing for a newest start with no stored report yet. The re-run is pinned at the function (go-live once, a stored failed report's fail-pending and drain, a duplicate after success, a stale start, a start with no report, another session, another generation, and no go-live from missing or unmeasured facts). **Recovery is outstanding:** no end-to-end restart or loss proof exists until designation B's sweep lands, and no first live designation or readiness claim rests on it. |
| `settle-reports-its-outcome` (review 3325 F6) | (none) | `settleLoads` answers what it decided (`none`, `go-live`, `fail-pending`, `unread`, `refused`, `threw`) and tells the port's optional `settled` once done. Production passes none; the door suite waits on it, so a case that expects nothing proves the settle ran and decided `none`. |
| `settle-drains-through-the-designation-drain` | `fail-pending` clears `profiledigest` through `routeSet`, then stops through `stopCreated`. | `failPending('overlord-sandbox-unmet', owesStop)` then `drainOwedStops`, the designation's one drain: keep-awake off, then the set and `profiledigest` cleared, then the stop, with `stopDone` on success. A failed off still stops, and the id stays owed for the next drain (designation B's sweep, or a retire). |
| `overlord-body-built-once` | `server.ts` wires `stopCreated` into the continuity deps. | The Overlord body (`ccdOverlordBody`, with the stop route's own path) and the designation store are built once, above the continuity routes, and both the designation doors and the settle step take them. |
| `surface-arm-reads-the-installed-row-keys` (moved to the hook packet) | The arm reads the row's tools, tool server, reader types and skills. | It reads keys the projection already has: `--tools`, `--agents`' keys, `stagedSkills`' keys, and the tool server from the servers the reader types' tools name (`mcp__door__read`). Flags that lack `--tools` or `--agents` are a malformed row and deny every call (review 3325 F5). |
| `skill-name-reader-shared` (moved to the hook packet) | The arm reads the skill name with the role-skill arm's reader. | The role-skill arm's inline jq became `SKILL_NAME_JQ` (`def skillname`), which both arms use. |
| `skew-notice-keyed-in-the-feed` (wording corrected, review 3325 F1) | Once per session and build pair; a restart does not raise it again. | The lane raises it through `pushOne` (`record-always`) with the key as the feed's once-only `dedupeKey`, and asks `CoordStore.hasNotice` first, so the mark survives a restart with no new table. The ruled build-skew proxy stands, but the words say only what is measured: the builds differ, and a digest mismatch can keep the body from respawning. Nothing reads whether a respawn was refused, and a release that leaves the `overlord` row alone keeps its digest. The body's liveness is `skewRunningOf` over its fleet-state row (`rowStanding`: here runs; gone or asleep is down; doubt, or a session the state does not list, is unmeasured and raises nothing), pinned with its mutants R1 to R3. The builds are the inventory's (a tag, else a short sha). |
| `failed-attempt-columns-from-designation-a` | Question 3: PR B adds the failed-attempt columns if designation A ships none. | Designation A shipped them (`attemptId`, `attemptOutcome`, `attemptAt`, `stopsOwed`), so PR B adds no migration. |

## What the operator and the fleet see

- **No Overlord designation can go live yet.** With no build listed, a pending designation's first report reads `skills`
  and `agents` `unmeasured`, and the attempt ends `overlord-sandbox-unmet` (the profile digest cleared, the body stopped). A
  bound Overlord, if one exists, reads `launch-profile-unmet` at its next start. This lasts until the capture inventory
  lists a build with built-in provenance.
- **A resume before the first `Stop` fails the attempt.** A resume writes no `prompt_snapshot` (load-path.md §3), so its
  `tools` and `toolServers` read `unmeasured`, and a pending designation whose body respawned before its first `Stop`
  ends `overlord-sandbox-unmet`. That follows the rulings (`resume-carries-its-own-start`); the operator starts it again.
- **A settle lost after the answer leaves the attempt pending, its body running,** until designation B's deadline sweep
  re-runs it from the stored report (`settle-runs-after-the-answer`).
- **Every Claude Code roll will hold the Overlord until its build is listed.** The lists are keyed by build (question 4). The
  capture inventory, queued, is where each build's own lists come from, so no release is needed per roll.

## Not changed here

- `ccd/lib/launch-profiles.json`, the `overlord` digest and, since the split, `ccd/session-hook.sh`.
- No route, no table, no migration, no ccd verb, no capability word.

## Measured

Scoped runs on this box, each file or group through `ccrc test`, fixture HOMEs and stub ports only. None of these is a whole
suite run; the whole suite has not been run for this PR, and CI is the arbiter for everything else.

- Mutation, scoped to the four sandbox keys plus BASELINE, CONTROL, the decider-name match and the merge-base floor check: 8
  of 8 tests green, 31 of 31 mutants killed (one scoped run). The whole mutation-floors file was not run: in the reviewer's run this box's
  6 GiB test slice killed a worker, so that run says nothing either way.
- By hand, each from a saved copy and restored: the drain's stop replaced by a success stub (the door's fail-pending and
  stop-throws cases red); the settle's drain call removed (the same two red); the settle's no-report guard removed (the
  re-run's stale-start case red); a pending designation read as standing by the
  ladder input (the pending-only case red); the surface arm's `--tools`/`--agents` guard removed (the `--tools` case red; the
  `--agents` case stays green without it, because `fromjson` on a missing value already errors).
- Suites, each green: `sandbox-check` and `sandbox-settle` (32 tests); `sandbox-ladder-input` (7); `continuity-start-loads-route`
  (29, the re-run cases included); `continuity-profile-lane` with `run-session-census` (56); the five `overlord-ladder*` suites (149); `growth-check`
  armed, `growth-caps`, `anchors` and `citations` (97 armed); `rings` and `single-definition` (56 files, 1711 tests). The
  hook packet's `session-hook-surface-arm` (10) and `session-hook-role-skill-deny` (20) ran in this tree before the split.
- The server typecheck, and a typecheck of the touched test files with everything they import: clean. The whole-tests
  typecheck was not run here.
- Growth, armed, no waiver: `server/src/server.ts` and `server/src/watch.ts` within their caps (the summary table of the armed
  run).
