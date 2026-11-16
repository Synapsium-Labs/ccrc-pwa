# W3 Task Q3d: task note (D-7028)

This is the task note for Task Q3d of `2026-10-26-consolidation-w3-questions.md` (rev 5). The coordinator folds it into that plan's
§Deviations and decisions. This file never edits the plan. Departures are spelled `slug <name>` until the coordinator
issues numbers.

OA-C6 was ruled **(a)** on 2026-10-26: one in-memory carrier, owned by `coord/questions.ts`, keyed by question, kept in
memory per D-2169, re-seeded from the rows per D-5925. Under (a) this task has no behaviour commit and no coord.db
migration, and no row's output changed.

## What landed

- **The carrier.** `coord/questions.ts#createQuestions` holds ONE closure-local carrier, `questionHolds`, keyed
  `ask-<rowId>` or `approval-child-<childId>`. `reseedLoaded` and `asksDisabled` sit beside it. The phases fold the
  four watcher maps:
  - `held` is `heldAsks` and `heldApprovals`;
  - `lapsed` is `lapsedAsks`;
  - `reseed-pending` is `pendingReseed`.
- **The order is kept.** A phase change moves an entry to the end, and a same-phase replacement takes the old entry's
  place, so both lapse halves push in today's order. `questions-sequence-pin.test.ts` pins two children re-seeded in
  different ticks.
- **The members.**
  - `raise`, which answers `none`, `held` with the record, or `released` with the push.
  - `loadReseed`, `reseed`, `reseedGone`, `settleReplaced`, `settleCleared` and `restamp`.
  - `noteAsksSwitch`, `lapseAsks`, `lapseApprovals` and `prune`.
  - The door-ins `released`, `answeredLate`, `approvalReleased` and `approvalRuled`.
  - `currentAskOf`, and the test-only `questionsTestView`.
- **What moved byte for byte.** `askHoldPayload` and `renderAskBrief` moved unchanged; a `diff` of each function is
  empty.
- **watch.ts.** `detectDialogs` keeps the three pane-edge maps and calls `this.questions` at today's call points.
  - `askPass` keeps `await this.fleetFor(fleet)`.
  - `sweepAsks` and `sweepApprovals` stay the public halves that `sweepQuestions` dispatches.
  - The four door-ins are thin forwards.
- **Counted exits**, measured with `census-w3/questions.ts`:

  | Count | Base | Tip |
  |---|---|---|
  | FleetWatcher carriers (pinned) | 4, or 6 with the two flags named | 0 |
  | Watcher door-ins | 4 | 0 |
  | Store calls in `watch.ts` | 22 | 0 |
  | Store calls outside the module | 38 | 16 |
  | Pane edges | 3 | 3 |

  At the tip the carriers are `approvalInputs`, `questionHolds`, `reseedLoaded` and `asksDisabled`, all owned by
  `createQuestions`. The 16 store calls left are 15 counted plus 1 excluded by name.
- **Observation.** `watch.ts` went from 12354 to 11577 lines, and `FleetWatcher` from 233 methods to 225.

## Departures, by slug

- **slug q3d-lapse-sink.** The plan says the module answers what to push and never pushes. The door-ins and `raise` do
  that. The two lapse halves (`lapseAsks`, `lapseApprovals`) instead take a push sink from the watcher. They call it at
  the moment today's sweep called `pushOne`.
  - Why: a list returned at the end would move every push after every later store call. A store throw part-way through
    `sweepApprovals` would then lose the pushes of the entries already dropped. That is Review focus 1's swallowed
    question.
  - The module still imports no push and calls no `notify`.
- **slug q3d-record-after-hold.** `raise` makes the carrier entry and then answers the record (or the released push).
  The watcher sends it after `raise` returns (`pushRaised`). Today `tryHold` pushed first and set the map second, both
  inside its `try`.
  - No pinned row can tell the two apart: the push is synchronous and touches no carrier.
  - The only difference is a throw from `pushOne` itself, from its in-memory ring record, because `notify` guards its
    archive write. Today that throw would fall back to `none` and an immediate raise. Now it would reach `tick`.
- **slug q3d-one-switch-commit.** The plan lists the move commits as raise (asks), raise (approvals), reseed, the
  settles, the lapse half and the door-ins.
  - What I did: one commit adds every member to the module, unused by `watch.ts` and green on the red suite. One
    commit then switches `watch.ts` and deletes the old code.
  - Why: every piece reads and writes the same carrier. Switching them one at a time needs temporary bridge members
    that the next commit deletes.
  - Between the switch and the re-points, the four private-field suites and seven `ask-digest` source pins are red.
    The plan already orders the pinned tests after the moves (Q3c's slug q3c-red-between is the precedent). Every
    other commit is green.
- **slug q3d-rules-param.** `heldFor` is L3, so the instance takes it as a second parameter:
  `createQuestions(deps, { heldFor })`. That keeps the file at L1.
  - `QuestionsDeps` gains `io`, `cfg` and `tmux`, read at the call.
  - An instance made without the rule (a server's own, which never raises) answers `none` through `raise`'s any-failure
    arm.
- **slug q3d-door-in-args.** The pane-edge maps and `lastFleet` stay the watcher's, so the watcher passes in what each
  member needs from them:
  - `approvalReleased(childId, paintedDialogId)` takes the dialog the pane shows.
  - `approvalRuled(childId, agentId, parent, verdict, painted, projectOf)` takes whether the dialog is painted, and a
    lazy project lookup. It is called after the same early returns as today.
  - `lapseApprovals({ now, graceMs, paintedDialogOf, push })` receives `APPROVAL_RULED_GRACE_MS`, which stays a
    `watch.ts` constant as in Q3c's slug q3c-grace-param.
- **slug q3d-step0-members.** Step 0 names these members:
  - `noteAsksSwitch(disabled)` hands the switch verdict to the instance (the plan's own first option).
  - `loadReseed()` is once per instance.
  - `reseedGone(listing, recs)` is spec §5.2 step 3.
  - `prune(now)` runs under the `approvalPrune` row, which stays the watcher's.
- **slug q3d-split-reseed-keys.** A child's `reseed-pending` state is up to two entries, under the plan's two key
  shapes: one `ask-<rowId>` and one `approval-child-<childId>`. The ask half and the prompt half each leave when
  decided, which is today's single entry exactly, because `heldApprovalRowsByChild` never answers an empty list.
- **slug q3d-hold-phase-words.** The phase `reseed-pending` is a quoted kebab token under `server/src/coord`, and
  `mail-routes.test.ts`'s scan refuses an undeclared one. That test is held by an open PR (#1614), so it is not edited.
  Instead `QuestionHoldPhase` and its sibling `QUESTION_HOLD_PHASES` map are declared in `coord/questionPolicy.ts`, and
  the existing `isQuestionPolicyKebab` guard admits them (slug q3c-kebab-union's route).
- **slug q3d-notify-at-count.** The plan pins `askNotifyAt(` at 2 in `coord/questions.ts`, but Q3b's read side
  (`askQuestion`) already holds a third there. The re-pointed row counts inside `createQuestions`'s body, which holds
  the hold's read and the re-seed's, so the fact is unchanged. `watch.ts` holds none.
- **slug q3d-walk-pin.** Q3c's "the walk is real" row in `ask-digest.test.ts` read `store.releaseAsk(` in `askPass` and
  `coord.lapseApproval(` in `sweepApprovals`. Both are moved text. The plan's named-exception-2 list for Q3d did not name
  this row. It is a `sourceOfSymbol` pin over a moved method in a listed file, so it is re-pointed in its own commit and
  keeps its fact: each half reaches its act through `this.questions.<member>(`.
- **slug q3d-sequence-pin-file.** Step 1's sequences live in a new file, `server/test/questions-sequence-pin.test.ts`,
  with its traces recorded on the base in `server/test/fixtures/questions-sequence-pin/expected.json`. That is Q3a's
  `questions-pin` discipline. `questions-pin.test.ts` runs unedited.
- **slug q3d-raise-pattern.** The D-5290 row's definition pattern takes the async forms (`const raise = async (`,
  `async raise(`, `async function raise`). Otherwise `notice.ts`'s synchronous `function raise`, the notice funnel's
  own step, would read as a second definition. The CONTROL row states both.
- **slug q3d-literal-pin-ceiling.** `single-definition/advance-switches.test.ts` is not in the plan's Files list. Its
  ARCH-06 ratchet counts literal source pins per `server/src` file, and the count is exact.
  - Ten literal pins over `watch.ts` read text this task moved. Their re-pointed rows read the moved text through
    `scan/symbols.ts` (`sourceOfSymbol`, `symbolOf`, `parsedFile`) rather than as new literal pins over
    `coord/questions.ts`.
  - `watch.ts`'s two ceilings (W1a's row and W1b's row) are lowered 79 → 69, in a commit of their own. That is a
    shrink, which the ratchet itself asks for. Nothing is loosened.
- **slug q3c-hook-wait-import (not done, and why).** `watch.ts`'s `APPROVAL_HOOK_WAIT_S` import line is still context in
  #1614's import hunk, so it stays.
  - The `AskMintReleaseReason` name on the next line (the line #1614 rewrites) is unused now too, and stays.
  - So do `HookAsk` and `HookAskQuestion`, on a line just above that hunk.
  - The next `watch.ts` PR after #1614 lands removes them.

## The ring (settled again)

`coord/questions.ts` stays **L1**. Its new runtime imports are all L1 or L0:

- `askbody.ts` and `askkey.ts`;
- `coord/untrusted.ts`, `coord/redact.ts` and `coord/rundefs.ts`;
- `coord/questionPolicy.ts`;
- `shared/api.ts`.

`heldFor` (L3) is imported by type only and passed in. So `fleet.ts`'s runtime import of `currentFor` still points
inward, and `rings/outward-edges.test.ts` stays green with no new pair.

The new imports close a runtime cycle: `fleet.ts` imports `coord/questions.ts`, which imports `askbody.ts`, which
imports `fleet.ts` for `ASK_SUMMARY_MAX_LEN`. The cycle is safe, because `askbody.ts` reads that constant only inside
its functions, never at module evaluation.

## Mutation table (run, then reverted)

| Mutant | Suite | Red |
|---|---|---|
| `raise` without the compensation `staleAsk` | questions-pin | "ask: a half-committed mint (a throw after insertAsk) leaves no held row: staleAsk compensates, pushed at once" |
| `settleCleared` marks the child's subagent row `operator` too | questions-pin | "approval: a cleared dialog marks only its covered main-thread rows operator; a subagent's row is neither withholding nor marked (D-5491)" |
| `answeredLate` replaces the child's lapse whatever its row | questions-pin | "ask: a late answer after the lapse replaces it under the same tag, answeredByBody, no actions (D-5289)" (its "another row's late answer: nothing" step; the plan's expected title was a paraphrase) |
| the re-seed skips the `askKey` check | ask-restart | "the same menu under a changed question (another askKey) settles stale, re-seeds nothing and pushes nothing" |
| a `heldAsks` Map field back in `FleetWatcher` | single-definition/ask-digest | "watch.ts holds no question state: no hold carrier is a FleetWatcher field or module scope; the one carrier is createQuestions's" |
