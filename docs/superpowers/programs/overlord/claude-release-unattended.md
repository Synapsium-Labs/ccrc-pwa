# A new Claude Code release needs no operator: task note

Wave 199 of the Overlord programme (#2491), run 3213. One pull request. The programme's coordinator folds what the ledger
should learn from this note into the ledger. Why: the operator's ruling of 2026-11-22, "I'm tired of you creating manual
tasks for me that you should be able to do yourself … Same with the bloody Claude Code version releases etc."

## What changed

1. **A failed capture is captured again by itself** (slug `capture-retry-ceiling`). `claude_builds` gains `fails`, the
   count of a build's failed capture verdicts (migration 119; the backfill counts the one failure every failed row
   already carries). `shared/claudeBuildTrust.ts#captureStandingOf` is the one decider of where a build stands: trusted,
   queued, retrying (with its time), or given up. `shared/claudeBuildTrust.ts#capturesToRetry` names the failed builds
   whose time has come: an hour after the first failure, two after the second
   (`shared/claudeBuildTrust.ts#captureRetryAfterMs`), up to `BUILD_CAPTURE_FAIL_CEILING` (3) failed verdicts. The lane
   (`server/src/buildCaptureLane.ts#BuildCaptureLane`) re-queues them each pass through the same writer as the
   operator's Capture again (`requeueClaudeBuild`), and pushes only on the failed verdict that gives up. Capture again
   stays on every failed row as a manual option; nothing depends on it.
2. **No Waiting on you item while ccrc handles a build** (slug `item-only-when-given-up`). A prompt on an untrusted build
   raises nothing any more. `server/src/coord/untrustedBuildItem.ts#untrustedBuildItemOf` raises one item per build only
   when ccrc has given up on it, from the lane, and names the act only the operator can do: Capture again, the
   signed-in door, once the cause is fixed. `server/src/coord/untrustedBuildItem.ts#untrustedBuildItemsToSettle` settles
   every open item whose build ccrc has not given up on, with a note saying which: captured, or back in ccrc's hands. So
   the three items open for 2.1.328, 2.1.329 and 2.1.330 settle on the lane's first pass after the deploy, whatever their
   builds' state, unless a build is given up by then.
3. **A prompt on an untrusted build goes to the coordinator first** (slug `untrusted-build-routes-escalate`).
   `server/src/coord/approvalguard.ts#approvalBuildRoute` (L1) decides: a trusted build is routed as ever; a build the
   record names but has not trusted (`not-captured`, `capture-queued`, `capture-failed`) is routed too, held as
   `escalate` (`server/src/coord/approvalguard.ts#classOnBuild`) and never parked; a build or a record that could not be
   read (`unread`, `record-unreadable`) is still refused `version-unverified`. The coordinator may deny the prompt or
   hand it over; its allow is refused `guard-escalate` by the guards that already exist. The brief tells it why
   (`server/src/coord/approvalbrief.ts#renderApprovalBrief`). The PWA's Test box card says it in words.
4. **The roll and select audit** (below).

## The safety argument, and the stronger rule kept

The brief asked for the coordinator to see the prompt "with the `ordinary` allow arm closed". Holding the row as
`escalate` closes it at every allow guard that exists (`signingRefusal`, `parkRecordRefusal`, the rule door), with no new
class word: a fourth class would also reach the child-side ruling checker, which this session may not read, and a deny
carrying a word it does not know might be dropped there.

Closing the coordinator's allow alone would still have loosened one thing. Today an untrusted build's prompt has no row,
so the operator answers it in the pane, and ccrc never prints an allow into that build. An `escalate` row that parks can
be allowed by the operator from Waiting on you, and that allow is signed and printed by the hook into a build whose hook
contract has not passed its capture. The coordinator-first spec's stop rule (§6.9) admits a hook allow only on a build
whose capture proved it. So the stronger rule is kept: **an untrusted build's row is never parked**, so nothing is
allowed through ccrc for it, by anyone. The coordinator denies it or hands it over; if it does neither, the window
lapses as for any `escalate` row and the operator answers in the pane, with the notification, exactly as before.

What this adds for an untrusted build is the coordinator's deny, printed by the hook. A deny the build ignored leaves
the prompt where it is today, with the operator. That residual is below.

## The roll and select audit: what a new Claude Code release still asks of the operator

Read on `main` at 77a1fefe46.

| Step | Where | Operator act before | After this PR |
|---|---|---|---|
| A build is recorded and queued for capture | `server/src/buildCaptureLane.ts#BuildCaptureLane` | none | none |
| A prompt on a waiting build | `server/src/coord/untrustedBuildItem.ts#untrustedBuildItemOf` | a `do` item per build | none until ccrc gives up |
| A failed capture | `server/src/buildCaptureLane.ts#BuildCaptureLane` | a push asking for Capture again | retried by itself; a push and an item only at the ceiling |
| A child's prompt while the build waits | `server/src/coord/questions.ts#createQuestions` | every prompt to the operator | to the coordinator first |
| The roll onto the new build | `server/src/coord/rollTarget.ts#rollTargetVerdict` | none: Roll idle sessions is `all` by default (D-8276); `.no-roll` is an opt-out, never a step | none |
| The install of the new build | not in this tree: each lane's own updater installs (binary lifecycle spec §8.2) | none | none |
| Which build a restart runs | the launcher, outside this tree; `shared/claudeVersion.ts#claudeBuildOf` measures its reach | none | none |
| The capture itself | `server/src/buildCaptureLane.ts#testboxCaptureTransport` | none, but no build is ever captured: the adapter answers `no-runner` (the D-8289 plan's open item) | unchanged; not an operator act (below) |

**The operator's by SAFETY, for the one decision.** The Claude Code switch verbs of the binary lifecycle spec §10.4
(roll and install disable and enable, roll-live, self-update keep and release, the shadow week) and the pin and the
halt acknowledgement (spec decisions 9, 10 and 12). One line: they are the operator's off switches and arming acts over
ccrc's automatic rolls and installs, so a session or the server able to flip them would remove the operator's stop.
None of them is a step a new release needs: on `main` neither the canary nor the ccrc installer exists yet, and every
kill switch is off by default.

**Not an operator act, but the gap that matters most.** The production capture transport sends nothing
(`no-runner`), so no new build is ever trusted, and on such a build nothing is allowed through ccrc. This PR makes that
state quiet and routes its prompts to the coordinator. Run 3214 (the capture runner) replaces that adapter with one that
sends the job, and deletes the old one from `server/src/buildCaptureLane.ts` by the coordinator's ruling; once it lands,
a failed verdict from the real runner is retried by this PR's lane. Run 3211 fixes the test box's tool sync.

## Measured

Mutation-measured by hand, each mutant applied to the source file, its tests run through `ccrc test`, and the file
restored from a saved copy after every mutant (`scratchpad/mutate.py` in the worker's session; not committed). The
results are in the PR body. The item deciders keep their sets in `server/test/sim/approvalEnvelopeSets.ts`, rewritten
for the new code, at floor 1.

## Residuals

- **A deny an untrusted build ignores.** The hook prints the coordinator's deny into a build whose hook contract is
  unproven. If the build ignores it, the prompt stands in the pane; whether the operator's push then fires for a row
  already `denied` is unmeasured here.
- **PR 6's read-prompt gate** (`server/src/coord/approvalCensus.ts#isReadPrompt`) counts held `escalate` rows. A future
  automation built on it must leave out rows from an untrusted build, which the row does not mark; today they are
  `escalate` rows with no park key.
- **The door pin.** `server/test/question-doors-pin.test.ts`'s rung-10 rows still pin the old refusal of 2.1.299; their
  edit waits on the coordinator's word after a hook refusal (below).

## Departures and reports

- `hook-refusal-approval-read`: a read-only grep that named the child-side ruling checker was refused by the session
  hook's approval-surface arm. Reported; not rerouted; the design avoids that file.
- `hook-refusal-switch-grep`: a read-only grep whose pattern spelled the Claude Code switch verbs was refused as if it
  ran them. Reported; the audit read the lifecycle spec and the roll lane as files instead, which the report named.
- `hook-refusal-door-pin`: an edit script for the door pin quoted its case names, which spell the approval route's
  path. Reported; waiting on the coordinator's word.
- `migration-119`: one column on `claude_builds`, the next free slot by position on `main` at 77a1fefe46; whoever lands
  second renumbers.
