# Acceptance evidence, 2026-11-26

The programme's coordinator wrote this note from run 3524, the read-only acceptance run of wave 10. It records what
proves each line of the definition of done, and what stays unmeasured. It changes no code and no pinned text.

## The standard used

Every line is judged one of four ways. The second and third rest on two calls the coordinator made on 2026-11-26.
Both are recorded as design-level calls, which the owner sees and may overturn.

- A behaviour that a healthy fleet shows is proved by a live reading of it.
- A behaviour that only shows after a Revert or a fault is accepted from the merged tests at the installed commit,
  plus a live reading of the installed check (call 1494). It is not staged on the live fleet. A fault warning cannot
  occur on a healthy fleet, and a live Revert holds real sessions on an older model until a newer one appears.
- The Models sheet is drawn only on a signed-in device, which no session can read. Its display is accepted from the
  merged browser tests on the commit the server box serves, plus a live reading on every lane of the data the sheet
  draws from (call 1499). The other choices were to ask the owner for one look, or to leave line 5 open.
- A behaviour that a real release shows stays a live wait. That is the move itself: lines 2, 6 and 7.

"Proved, by call" in the table below marks a line that rests partly on tests in this way.

Evidence words: **measured** is a read made on 2026-11-26, **source** is the tree at the installed commit, and
**carried** comes from an earlier record and was not read again.

## What was read

- Both boxes run `v0.0.1486`, commit `812b6c4e4e`. The fleet box says so in `ccrc version` (install complete), and the
  server box in its health answer (`dirty: false`). Both were measured between 13:05Z and 13:10Z.
- `ccrc doctor` ran on the fleet box at 12:46Z (the worker) and again at 13:05Z (the coordinator). The model checks
  read the same both times.
- `ccrc models <lane> show` was read on all 17 lanes, at 12:46Z and again at 13:06Z.
- Every pull request named under lines 1 to 6 below passed the merge queue: its merge commit carries the queue's own
  check suite, in which `test (server)`, `test (agent)`, `test (pwa)` and `build-pwa` passed. The coordinator read
  four of them again (#2943, #3041, #3237, #3246).
- Every test file named below exists at `812b6c4e4e`.

Lanes are counted, never named. Two of the 17 are Codex lanes and 15 are Anthropic lanes.

## Line by line

| Line | Checkpoint | Verdict |
|---|---|---|
| 1 | `catalogue-lists-current` | Proved |
| 2 | `moves-only-forward` | Open: waits for a real Codex model release |
| 3 | `doctor-live` | Proved, by call 1494 |
| 4 | `grant-retired` | Proved, by call 1494 |
| 5 | `sheet-live` | Proved, by calls 1494 and 1499 |
| 6 | `anthropic-follows` | Open: waits for a real alias change |
| 7 | `natural-move` | Open: waits for a real release |
| 8 | `docs-true` | Proved on 2026-11-23 (#3250) |

### Line 1: the catalogue follows the current Codex client

Proved.

- Measured: each Codex lane's catalogue records the client version it was fetched as, and both read `0.172.0`. Both
  were fetched at 11:49Z, are not stale and list 12 ids.
- Measured: Codex `0.172.0` was published on 2026-11-24T00:03:55Z, and doctor reads `PASS model-release-lookup: the
  Codex release lookup read 0.172.0`. On 2026-11-23 the same check read `0.171.0`, which was published on
  2026-11-20T00:44:47Z.
- Source: the floor is still `0.170.0` (`ccd/ccgpt-auth.py#CLIENT_VERSION_FLOOR`), and no commit between the two
  installed builds touched the probe. So the version followed two releases with no hand raise.
- Source: the probe's `client_version` runs the release lookup and applies the floor, and the probe sends the result
  as its user agent and as the `client_version` of the catalogue request (`ccd/ccrc-models-probe`, from #3023). The
  catalogue is therefore what OpenAI offers that client.
- Tests: `server/test/models-probe.test.ts`, `server/test/codex-auth-lib.test.ts`, `server/test/ccgpt-usage.test.ts`
  and the release-lookup cases of `server/test/ccrc-doctor-model-advance.test.ts` (#3025, #3085, #3118, #3216).
- Unmeasured: a release that brings a new model id. Neither release did, and both lists hold the same 12 ids.

### Line 2: forward only, within one refresh, after a passing canary

Open. It waits for a real Codex model release, with line 7.

- Measured: the two Codex lanes retain eight automatic moves, and each passed its canary. The newest four are those
  of 2026-11-18T12:28Z, each to its family's newest model. No hold stands.
- Carried: on 2026-11-18 the first refresh that listed the two new ids made those moves.
- Source and tests: the forward-only rule and the retire grace (#3118; `server/test/model-advance-rule.test.ts`,
  `server/test/model-advance-file.test.ts`, `server/test/models-op.test.ts`).
- Why it stays open: no class has moved since the forward-only rule merged on 2026-11-22. The one backward step, on
  2026-11-10, predates the rule. The line describes a move, and no move has run on a build that holds every wave.

### Line 3: doctor warns by cause

Proved, by call 1494.

- Measured, 13:05Z: `model-advance-held-back`, `model-held-behind` and `model-sessions-behind` each PASS over 17 lanes.
  Sessions-behind lists no session it could not measure. `model-release-lookup` reads PASS.
- Measured: `model-advance-blocked` WARNs by cause on 11 lanes, `alias-source-absent` on 8 and `alias-cache-stale` on
  3. So "a lane or class that cannot advance" has warned live, by cause.
- Tests, for the three warnings a healthy fleet cannot show (a hold whose end has come and which still stands, a held
  pin gone from the catalogue, and a session still on a replaced model a day after the move):
  `server/test/ccrc-doctor-model-advance.test.ts` and `server/test/ccrc-doctor-caps-reader.test.ts` (#2943, #3107,
  #3118, #3216, #3222, #3237).
- Unmeasured: a live WARN from held-behind, held-back or sessions-behind, or with the cause `pin-missing` (a held pin
  gone from the catalogue).
- Noted, and not part of this line: the three `alias-cache-stale` lanes are new since 2026-11-23. A catalogue cache in
  an older format appeared in each of those homes on 2026-11-26. What wrote it is not measured.

### Line 4: one read path, and the grant retired

Proved, by call 1494. The read path is measured; a refused read of a model file is accepted from source and tests.

- Measured: both boxes run `812b6c4e4e`, which holds #2960, #3041 and #3246. The `models` op answered for all 17
  lanes.
- Source at that commit: the agent's file-read whitelist admits under `~/.ccrc` only the node files it names, and its
  comment reads "No file under `~/.ccrc/models`: the lane-models read grant (D-8406) is retired (R3b)"
  (`agent/src/whitelist.ts#isCcrcNodeFile`).
- Tests: `server/test/lane-models-grant-retired.test.ts` pins that "no server source file builds a lane model file's
  path: nothing on the server reads model files", and both mixed pairs of old and new server and agent. Also
  `server/test/lane-models-op.test.ts`, `server/test/lane-models.test.ts`, `agent/test/models-op.test.ts` and
  `agent/test/whitelist.test.ts`.
- Unmeasured: a refused file read was not probed on the live agent.

### Line 5: the Models sheet, Revert, and the hold ending

Proved, by calls 1494 and 1499. The display rests on call 1499, and Revert and the end of its hold on call 1494.

- Measured: the server box serves `v0.0.1486`, which holds the Revert-only sheet (#3246).
- Measured: the `models` op, which the sheet's route reads, answers on all 17 lanes with each lane's classes, pins and
  advance state.
- Measured: all 17 lanes answer `revertHoldEnds: true`, the fact the sheet reads before it offers Revert. No hold
  stands on any lane. The issue #1441 closed on 2026-11-18T16:21:53Z.
- Tests that drive Revert through the route and the sheet: `server/test/lane-models-revert-door.test.ts`,
  `server/test/lane-models-post.test.ts`, `server/test/lane-models-hold-race.test.ts`,
  `server/test/lane-models-audit.test.ts`, `pwa/test/models-sheet.test.tsx`, `pwa/test/models-sheet-words.test.ts`
  and, in a real browser, `pwa/browser/models-sheet.browser.test.ts`, which the merge queue runs (#3028, #3086, #3237,
  #3246). The browser test answers the sheet's requests itself, so it shows the drawing and not the installed route.
- Tests that refuse a Revert before any write: `server/test/models-op.test.ts` and `server/test/ccrc-models.test.ts`
  (#3118).
- Tests that end a hold on a newer model: `server/test/models-op-hold-ends.test.ts` and
  `server/test/model-hold-ends.test.ts` (#3237, #3246).
- Unmeasured: the sheet as drawn on a signed-in phone, the installed route answering it, and a live Revert with the
  end of its hold. None is staged, and nobody is asked to look (calls 1494 and 1499).

### Line 6: Anthropic lanes follow the alias, and revert

Open. It waits for a real alias change.

- Measured: of the 15 Anthropic lanes, 3 take their class ids from a current catalogue cache, 4 from marked launches
  and 8 have none. No hold stands. No class id has changed since 2026-11-22T21:45:51Z, so no alias resolved to a new
  model during the run.
- Tests: Revert on an Anthropic lane (`server/test/models-op-hold-ends.test.ts`, its Anthropic block;
  `server/test/model-hold-ends.test.ts`; `server/test/lane-models-revert-door.test.ts`). Labels, effort and the idle
  relaunch (`server/test/model-aliases-file.test.ts`, `server/test/model-aliases-resolve.test.ts`,
  `server/test/model-aliases-cache.test.ts`, `server/test/ccd-spawn-held-model.test.ts`,
  `server/test/ccd-route-effort-levels.test.ts`, `server/test/ccd-alias-launch.test.ts`,
  `server/test/alias-model-behind.test.ts`, `server/test/roll-target.test.ts`,
  `pwa/browser/models-sheet-anthropic.browser.test.ts`; #3107, #3122, #3221, #3223, #3238).
- Why it stays open: labels and effort following a new alias is what a real alias change shows, and none has come.

### Line 7: a real release

Open. No first appearance, canary, move, new-session reply or 24-hour doctor reading exists yet, on either kind of
lane. The worker holds one read-only recheck, set for seven days on (call 1495). Move history is kept, so a later read
loses no evidence.

## What this note does not settle

- **The context window after a move.** Both Codex lanes read 272000 tokens, from the provider's own figure, because
  three of their models have no measured window. Doctor's `models` check WARNs and names the hand remedy, the command
  that sets a model's window. Call 628 of
  2026-11-23 kept the provider-derived value. Whether a move should carry a measured window forward is a question for
  a later change, not for acceptance.
- **Session renewal.** Any claim about it belongs to the renewal programme's evaluation.
