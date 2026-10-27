# W3 Task Q3c: task note (D-7027)

The per-task note for Task Q3c of `2026-10-26-consolidation-w3-questions.md` (rev 5). The coordinator folds it into
that plan's §Deviations and decisions; this file never edits the plan.

## What landed

- `server/src/coord/questionPolicy.ts` (L1 by its facts, C6 under the existing `coord/question*.ts` row): three pure
  deciders, `decideAskLapse`, `decideApprovalLapse` and `decideDeferredApprovalPush`, each with one answer union and a
  sibling `Record<…, true>` of its words.
- `FleetWatcher#sweepQuestions(registryRead)`: synchronous, its body today's two dispatches in today's order, neither
  awaited. `tick` calls it once, where it dispatched the two halves. `sweepAsks` and `sweepApprovals` stay public.
- `askPass` and `sweepApprovals` ask the deciders; the acts (`pushOne`, the store calls, the carrier edits) and every
  warn sentence stay in `watch.ts`.
- Question sweep entry points `tick` calls: 2 at the base, 1 at the tip, pinned exactly in
  `single-definition/ask-digest.test.ts`.
- `questionStoreCallsOutside()`: 39 at the base, 39 at the tip.

## Departures, by slug

- **slug q3c-clock-pin-file.** Step 1's four clock rows live in a new file, `server/test/questions-clock-pin.test.ts`,
  with `questions-pin.test.ts`'s fixture trimmed into it. The rows assert facts (states, push counts, `laneDue`), not
  recorded traces, so they need no `expected.json` entry, and `questions-pin.test.ts` runs unedited.
- **slug q3c-ask-lapse-stages.** `decideAskLapse(carrier, read, now)` keeps the plan's signature and its five words, and
  the `read` is staged in the order `askPass` reads: `window` before the release CAS is tried, then the CAS's outcome
  (`release-threw`, `release-won`), then the re-read (`row-refused`, `row-threw`, `row`). A due hold before its release
  is tried answers `keep` (the hold stays; the CAS is the next act), because the plan's union has no `release` word and
  the CAS is an act, so it stays in `watch.ts`. After a won CAS the act for `push-and-drop` also records the lapse for a
  late answer (D-5289); the other `push-and-drop` arms do not, as today.
- **slug q3c-grace-param.** `decideDeferredApprovalPush` takes a fifth argument, `graceMs`. `APPROVAL_RULED_GRACE_MS`
  is a module constant of `watch.ts`, which the decider cannot import (it would point the ring outward), and the task
  forbids editing the constant. `sweepApprovals` passes it in unchanged.
- **slug q3c-policy-askwindow.** The plan says the module imports `shared/` and types only. It also imports
  `ASK_ANSWERING_MAX_MS` from `askwindow.ts`, the constant's home: a pure L1 module with no imports of its own (the
  same import `coord/questions.ts` already makes). `watch.ts` no longer imports `ASK_ANSWERING_MAX_MS`.
- **slug q3c-approval-pass-states.** `sweepApprovals` keeps its two reads and their order. Each pass asks
  `decideApprovalLapse` of a row as the state its read selected: the window pass treats the `held` read's rows as
  `held`, and the ceiling pass treats every row as the `released` row it is or lapses to. That is today's predicates
  exactly: the window pass reads `notifyAt` alone, and the ceiling pass reads `askAt` alone, even for a `held` row still
  due its lapse because the window pass's read was refused. Asking the row's own state instead redded
  `lane-coordination-characterization.test.ts`'s prune row, whose fake read returns rows with no `state`. That attempt
  never landed.
- **slug q3c-hook-wait-import.** `watch.ts` no longer reads `APPROVAL_HOOK_WAIT_S` (the decider does), but its
  import line stays. That line is context in an open PR's import hunk, and removing it would make the two hunks touch.
  The next `watch.ts` PR after that one lands removes it.
- **slug q3c-red-between.** The plan orders "the one entry point; then the re-pointed pins". So in the entry-point
  commit alone, one row is red: `registry-refused-census.test.ts`'s old `tick` hand-off row. The next commit, named
  exception 2, re-points it. Every other commit is green.
- **slug q3c-kebab-union.** `mail-routes.test.ts`'s scan of quoted kebab tokens under `server/src/coord` reds on the
  new module's words (`push-and-drop`, `keep-reset`, `release-won`, `row-refused` and the rest). Like every vocabulary
  before it, they are admitted through an exported guard derived from the module's tables
  (`coord/questionPolicy.ts#isQuestionPolicyKebab`), never through `NOT_CODES`. That test was not in the plan's Files
  list. The edit adds one import line, one `||` arm and the message's last words, all line-disjoint from the open PR that
  holds the same file.
