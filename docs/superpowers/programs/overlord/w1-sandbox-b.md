# W1 sandbox, PR B: the builder's notes

What PR B (Tasks 8 and 9 of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`) found and departed from, by slug,
for the coordinator to fold into the ledger. PR A's notes are `w1-sandbox/notes.md` and PR A2's `w1-sandbox/notes-a2.md`
beside the plan; the load-path measurement is `w1-sandbox/load-path.md`.

## What it ships

- `server/src/continuity/sandboxCheck.ts` (L1, C3): `expectedSurfaceOf`, `sandboxVerdict`, `profileEngagedOf`, `sandboxSettle`
  and `skewNoticeOf`. No verdict is stored (slug `verdict-computed-on-read`).
- The ladder's row `launch-profile-unengaged` (`shared/overlord-ladder.ts`), a condition read by `launch-profile-unmet`, the
  gate order's step 6, with no cap; its input in `overlordLadderRead.ts#ladderConditionInputs`.
- The session hook's surface arm (`ccd/session-hook.sh`, after the role-skill deny).
- The loads door's settle step (`continuity/routes.ts#settleLoads`), wired in `server.ts`.
- The skew notice, raised by the launch-profile lane (`profileLane.ts`, wired in `watch.ts`).
- `SANDBOX_MUTANT_SETS` (23 mutants: `sandboxVerdict` 17, `sandboxSettle` with `skewNoticeOf` 6), floor 1 each.

## The builder's departures

| Slug | The plan says | Built |
|---|---|---|
| `own-lists-measured-live` | `CLAUDE_CODE_OWN_LISTS` is a rig lower bound; a live read is a Needs-first of PR B. | Read live on 2.1.330, the build the fleet runs now, as the union over every account's recent sessions on that build: the `agent_listing_delta` attachment's `builtInTypes`, and the `skill_listing` names with no plugin prefix that are not the account's own skills. Accounts differ on the same build (one lists `web-fetch`, some lack `claude-code-guide`, some list `workflow-authoring`), so one account's list would blame an innocent name on another; a union cannot. The rig's 2.1.323 and 2.1.325 entries were lower bounds a live account exceeds (M5), so they are removed and those builds read `unmeasured`, naming the build. Read-only: transcript attachment names only, no content. |
| `settle-takes-the-report-start-id` | `sandboxSettle(designation, start, newestStartId, verdict)`, `start` the report's start. | `sandboxSettle(designation, reportStartId, newest, verdict)`: the door reads only the newest start (the one read of the table), so the report's start is named by its id and the decider checks it is the newest. Same rule, one read fewer. |
| `settle-acts-on-designate-only-until-rebind` | A rebind's first start reaches the same step when designation B lands. | The decider acts only on a pending `designate`; a pending `rebind` answers `none` until designation B adds its arm, as `goLive` itself leaves a rebind alone today. |
| `verdict-rechecks-the-carry` (PR A review 2135 F9, carried) | PR B re-checks `carriedFrom` server-side. | `startLoadsOfNewestStart` reads the carried start and its report in the same statement (`carry`), and `sandboxVerdict` takes it: unless it is a `startup` of the session whose report is not conflicted and records the same digest and build, `instructions`, `hooks` and `workspace` read `unmeasured`. |
| `workspace-read-through-measured-project` | `workspaceOf` reads the registry row's project. | The door's `workspaceOf` is `registry.ts#measuredProjectOf` over `readSessionRecord`, the one decision on `projectEvidence` outside the radar, so an unmeasured project reads `unmeasured`. |
| `ladder-reads-the-workspace-the-settle-measured` | The ladder's input is `profileEngagedOf` with the workspace fact. | The ladder's inputs are synchronous and the registry read is not, so the input passes the project `overlord` for the bound body: the settle step measured that project when this binding went live, and a body's registry project never changes. Its cwd and instruction files are still each start's own report. |
| `settle-runs-after-the-answer` | The door's step runs after `insertStartLoads`. | It runs after the door answers 202, on the coordination serialiser (so it never interleaves with a designate or a retire), so the hook's 3 s send budget never waits on a stop. A resend runs it again; once settled the pending slot is clear and it does nothing. A throw is logged. |
| `settle-drains-through-the-designation-drain` | `fail-pending` clears `profiledigest` through `routeSet`, then stops through `stopCreated`. | `failPending('overlord-sandbox-unmet', owesStop)` then `drainOwedStops`, the designation's one drain: keep-awake off, then the set and `profiledigest` cleared, then the stop, with `stopDone` on success. A failed off still stops, and the id stays owed for the next drain (designation B's sweep, or a retire). |
| `overlord-body-built-once` | `server.ts` wires `stopCreated` into the continuity deps. | The Overlord body (`ccdOverlordBody`, with the stop route's own path) and the designation store are built once, above the continuity routes, and both the designation doors and the settle step take them. `server.ts` grows by 6 net code lines. |
| `surface-arm-reads-the-installed-row-keys` | The arm reads the row's tools, tool server, reader types and skills. | It reads keys the projection already has: `--tools`, `--agents`' keys, `stagedSkills`' keys, and the tool server from the servers the reader types' tools name (`mcp__door__read`). `ccd/lib/launch-profiles.json` and the digest are unchanged by this PR, so door process B2, which regenerates the file, owns its only change. |
| `skill-name-reader-shared` | The arm reads the skill name with the role-skill arm's reader. | The role-skill arm's inline jq became `SKILL_NAME_JQ` (`def skillname`), which both arms use. |
| `skew-notice-keyed-in-the-feed` | Once per session and build pair; a restart does not raise it again. | The lane raises it through `pushOne` (`record-always`) with the key as the feed's once-only `dedupeKey`, and asks `CoordStore.hasNotice` first, so the mark survives a restart with no new table. The body's liveness is the fleet state's `presence` read through `sessionReading.ts#rowStanding` (here is running; gone or asleep is down, since a woken body is refused too; doubt, or a session the state does not list, is unmeasured and raises nothing); the builds are the inventory's (a tag, else a short sha). |
| `failed-attempt-columns-from-designation-a` | Question 3: PR B adds the failed-attempt columns if designation A ships none. | Designation A shipped them (`attemptId`, `attemptOutcome`, `attemptAt`, `stopsOwed`), so PR B adds no migration. |

## What the operator and the fleet see

- **A resume before the first `Stop` fails the attempt.** A resume writes no `prompt_snapshot` (load-path.md §3), so its
  `tools` and `toolServers` read `unmeasured`, and a pending designation whose body respawned before its first `Stop`
  ends `overlord-sandbox-unmet`. That follows the rulings (`resume-carries-its-own-start`); the operator starts it again.
- **Every Claude Code roll holds the Overlord until a release lists the new build.** With the own lists keyed by build in
  the release (question 4, ruled), a roll to a build ccrc has not measured reads `skills` and `agents` `unmeasured`: a
  pending designation fails, and a live Overlord reads `launch-profile-unmet` at its next start. The fleet moved from
  2.1.325 to 2.1.330 in one week. **Proposed follow-up** (for the coordinator to rule): ccrc measures each build's own lists
  itself when it captures or rolls the build (the capture runner already runs every new build), so no release is needed
  per roll; and the agents half needs no list at all, since `agent_listing_delta` names its own built-in types, if the
  hook reported them.

## Not changed here

- `ccd/lib/launch-profiles.json` and the `overlord` digest.
- No route, no table, no migration, no ccd verb, no capability word.

## Measured

- Mutation: 23 of 23 mutants killed. By hand, each from a saved copy and restored: the arm's tool test, its reader-type
  test, its whole-name skill comparison and its unreadable-row deny (each red); the door's drain at `fail-pending` and its
  go-live write (each red).
- `ccd/session-hook.sh` +17 net code lines (estimate +14), `server/src/server.ts` +6 (estimate +10); `growth-check` armed,
  no waiver.
- `continuity-notes-route`'s "200 notes of 500 characters" case times out at 20 s on this loaded box, alone too; it
  designates no Overlord, so nothing in this PR reaches it. CI is the arbiter.
