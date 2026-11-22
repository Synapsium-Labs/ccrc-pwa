# A new Claude Code release needs no operator: task note

Wave 199 of the Overlord programme (#2491), run 3213. One pull request. The programme's coordinator folds what the ledger
should learn from this note into the ledger. Why: the operator's ruling of 2026-11-22, "I'm tired of you creating manual
tasks for me that you should be able to do yourself … Same with the bloody Claude Code version releases etc."

## What changed

1. **A failed capture is captured again by itself** (slug `capture-retry-ceiling`).
   - `claude_builds` gains `fails`, the count of a build's failed capture verdicts (migration 119). The backfill counts the
     one failure every failed row already carries.
   - `shared/claudeBuildTrust.ts#captureStandingOf` is the one decider of where a build stands: trusted, queued, retrying
     (with its time) or given up. It is also the one home of "a passed capture is trusted", which `#buildTrustOf` reads.
   - `shared/claudeBuildTrust.ts#capturesToRetry` names the failed builds whose time has come and that a session still
     runs: an hour after the first failure, two after the second (`#captureRetryAfterMs`). The ceiling is
     `BUILD_CAPTURE_FAIL_CEILING`, three failed captures.
   - The lane (`server/src/buildCaptureLane.ts#BuildCaptureLane`) re-queues them each pass through the writer the
     operator's Capture again uses (`requeueClaudeBuild`). The automatic retry keeps the count and the last output
     (`keepLadder`). The operator's Capture again restarts the ladder (`fails` back to 0).
   - A push goes out only on the failed verdict that gives up on a build a session runs
     (`shared/claudeBuildTrust.ts#givenUpToTell`). A build no session runs is not retried, and gives up quietly: no push
     and no item.
   - Capture again stays on every failed row as a manual option; nothing depends on it.
2. **No Waiting on you item while ccrc handles a build** (slug `item-only-when-given-up`).
   - A refused prompt raises nothing any more.
   - Each pass, the lane raises one item for each build ccrc has given up on, that a session runs and that has no open
     item (`server/src/coord/untrustedBuildItem.ts#untrustedBuildItemsToRaise`, over `#untrustedBuildItemOf`). So a raise
     lost to a throw or a restart comes back on a later pass. The item names the act only the operator can do: Capture
     again, the signed-in door, once the cause is fixed.
   - `server/src/coord/untrustedBuildItem.ts#untrustedBuildItemsToSettle` settles every open item whose build ccrc has
     not given up on, with a note saying which: captured, or "ccrc captures this build itself once its capture runner is
     wired; until then a child's prompt on it comes to you in the pane." So the three items open for 2.1.328, 2.1.329 and
     2.1.330 settle on the lane's first pass after the deploy, unless a build is given up by then.
3. **A prompt on an untrusted build is refused at mint, as on `main`** (slug `routing-reverted-until-capture`).
   - This PR first routed such a prompt to the coordinator, held as `escalate` and never parked. Review 3234 (F1 to F3,
     F8, F9) and the coordinator's ruling reverted it.
   - The coordinator could only deny or hand over, and the hook's deny arms already stop the forbidden commands. Against
     that, every prompt on a new build waited 60 to 180 s before the operator was told, while the transport answers
     `no-runner`.
   - The routing also departed from the coordinator-first spec §6.3 and §6.9 with no amendment, and rested on one
     park-key conjunct with no durable mark.
   - So `server/src/coord/questions.ts#createQuestions`'s `raiseApproval` refuses `version-unverified` again for every
     untrusted build, and the prompt comes to the operator in the pane at once. Once the capture runner captures builds,
     an untrusted build is a short window.
4. **The roll and select audit** (below).

## The roll and select audit: what a new Claude Code release still asks of the operator

Read on `main` at 77a1fefe46.

| Step | Where | Operator act before | After this PR |
|---|---|---|---|
| A build is recorded and queued for capture | `server/src/buildCaptureLane.ts#BuildCaptureLane` | none | none |
| A prompt on a waiting build | `server/src/coord/untrustedBuildItem.ts#untrustedBuildItemOf` | a `do` item per build | none until ccrc gives up |
| A failed capture | `server/src/buildCaptureLane.ts#BuildCaptureLane` | a push asking for Capture again | retried by itself; a push and an item only at the ceiling |
| A child's prompt while the build waits | `server/src/coord/questions.ts#createQuestions` | every prompt to the operator, in the pane | unchanged: every prompt to the operator, in the pane, until the build is captured |
| The roll onto the new build | `server/src/coord/rollTarget.ts#rollTargetVerdict` | none: Roll idle sessions is `all` by default (D-8276); `.no-roll` is an opt-out, never a step | none |
| The install of the new build | not in this tree: each lane's own updater installs (binary lifecycle spec §8.2) | none | none |
| Which build a restart runs | the launcher, outside this tree; `shared/claudeVersion.ts#claudeBuildOf` measures its reach | none | none |
| The capture itself | `server/src/testboxCapture.ts#testboxCaptureTransport` (moved there by #3168) | none, but no build was ever captured: the adapter answered `no-runner` (the D-8289 plan's open item) | not an operator act; the capture runner's PRs close it (below) |

**What still falls to the operator per release.**
- Until the capture runner's PR 3 lands, a prompt on a new build is answered by the operator in the pane, one prompt at a
  time.
- The binary lifecycle spec's per-release operator canary (§7.5, §10.1, §10.4 and decision 3: one operator-run canary
  per new build while a node stays `manual`) becomes a per-release operator step when its later waves ship. The
  coordinator carries it as a follow-up to automate.

**The operator's by SAFETY, for the one decision.** These stay the operator's: the Claude Code switch verbs of the binary
lifecycle spec §10.4 (roll and install disable and enable, roll-live, self-update keep and release, the shadow week), the
pin and the halt acknowledgement (spec decisions 9, 10 and 12). The reason, in one line: they are the operator's off
switches and arming acts over ccrc's automatic rolls and installs, so a session or the server able to flip them would
remove the operator's stop. None of them is a step a new release needs. On `main`, neither the canary nor the ccrc
installer exists yet, and every kill switch is off by default.

**Not an operator act, but the gap that matters most.** On `main` at 77a1fefe46 the production capture transport sent
nothing (`no-runner`), so no new build was ever trusted, and every prompt on one is refused and comes to the operator.
This PR makes that state quiet on Waiting on you. The capture runner's first PR (#3168, run 3214) replaced that adapter
with `server/src/testboxCapture.ts#testboxCaptureTransport`, which sends the job through the fleet op. Its later PRs let
the test box hold and capture a new build. Until then a try that sends nothing counts no attempt and no failure, so it
never walks a build to the give-up item, and a failed verdict from the real runner is retried by this PR's lane. Run
3211 fixes the test box's tool sync.

## Measured

- **Mutation.** Every mutant was measured by hand: applied to its source file, its tests run through `ccrc test`, and
  the file restored from a saved copy after each one (`scratchpad/mutate.py` in the worker's session; not committed).
  The results are in the PR body.
- **The item deciders' sets.** They live in `server/test/sim/approvalEnvelopeSets.ts`, rewritten for the new code, at
  floor 1.

## Residuals

- **A build that is run again.** A build rolled past is not retried while no session runs it. If a session runs it
  again, its next retry is already due and goes out on the next pass.
- **A failed row an older build wrote.** After a rollback onto an older build, a failed row carries `fails` 0. The
  server reads it as given up, and the card says only that it failed.

## Departures and reports

- **`hook-refusal-approval-read`:** the session hook's approval-surface arm refused a read-only grep that named the
  child-side ruling checker. Reported, not rerouted; the design avoids that file.
- **`hook-refusal-switch-grep`:** a read-only grep whose pattern spelled the Claude Code switch verbs was refused as if
  it ran them. Reported; the audit read the lifecycle spec and the roll lane as files instead, which the report named.
- **`hook-refusal-door-pin`:** an edit script for the door pin quoted its case names, which spell the approval route's
  path, and the hook refused it. The edit then landed with the Edit tool, on the coordinator's ruling (30076). The
  revert in fix round 1 restores those rows to `main`'s.
- **`routing-reverted-until-capture`:** the coordinator's ruling on review 3234. The prompt is refused at mint again,
  and the rest of the PR stays.
- **`migration-119`:** one column on `claude_builds`, the next free slot by position on `main` at 77a1fefe46. Whichever
  of #3169 and #3170 lands first keeps 119; the second renumbers.
