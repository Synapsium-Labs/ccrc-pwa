# W3 Task Q3e: implementation note (D-7029; ARCH-56 #791, fourth PR)

This note covers Task Q3e of `2026-10-26-consolidation-w3-questions.md`. The plan file is not edited. Departures are
spelled `slug <name>` until the coordinator swaps in issued numbers.

## Step 0: the re-ground

Q3e re-measured the ladder on `origin/main` at `fd32f3ecd`. The words, details and order match the plan's table, steps 1
to 15, with no difference. Every `approvalInputs` touch was in `coord/routes.ts#registerCoordRoutes`:

- the declaration and `forgetExpiredInputs`;
- the raise's `set`;
- the rule handler's `forgetExpiredInputs(now)` and `get`, and its `delete` after the CAS;
- the release handler's `delete`.

The closures the raise needs are `signerFor`, `denyEngaged`, `liveVersionOf`, `journalDigestMismatch`, the masker, and the
server's `coord`, `io`, `cfg` and `tmux`. When the task started, no open PR touched `coord/routes.ts`,
`coord/questions.ts`, `single-definition/ask-digest.test.ts`, `registry-refused-census.test.ts`,
`questions-instances.test.ts` or `census-w3/questions.ts` (rule-6 check).

## The ring (settled)

`coord/questions.ts` stays **L1**. It imports these by type only: `heldFor` (`coord/heldFor.ts`, L3),
`rulingsAllowedHere` and `ApprovalSigner` (`coord/approvalsign.ts`, L3), and `ReclaimDeps` (`coord/reclaim.ts`). The
raise reaches the two functions only through `ApprovalRaiseDeps`, which `registerCoordRoutes` builds once. The file's
runtime imports are all L1 (`registry.ts`, `coord/approvalguard.ts`, `coord/approvalbrief.ts`, `coord/redact.ts`,
`coord/rundefs.ts`, `coord/rundefsTx.ts`, `askwindow.ts`), L0 (`shared/api.ts`) or `node:crypto`, which is a pure
builtin. So `fleet.ts`'s runtime import of `currentFor` still points inward, and `rings/outward-edges.data.ts` gains no
pair.

## Departures

- **slug restart-fresh-watcher.** `approvalsHarness.ts#approvalsFixture`'s `restart()` used to rebuild only the server,
  over the same `FleetWatcher`. Q3b's `buildServer` uses `watcher.questions` when it is given a watcher. Once the input map
  lives in that instance, a server rebuilt over the old watcher keeps the inputs. Without a change, two Q3a rows would go
  red: `question-doors-pin`'s "rule 20 guard-escalate (a restarted server)", and `approvals-routes`'s D-5491 row. A real
  restart is a new process, which makes a new watcher too. So `restart()` now builds a new watcher with the new server
  and replaces `f.watcher`.
  - This change lands in the characterization commit, where it is green against the inline ladder: the map lived in each
    `registerCoordRoutes` call, so both restart forms answered the same. No assertion is edited.
  - The fixture also exposes `deps`, so a row can build a second server over the same store.
- **slug raise-now-at-call.** The route now reads `Date.now()` once, when it calls `raiseApproval`. Before, it read it
  after the version check. The ladder's instant (`askAt`, `notifyAt`, `heldFor`'s `nowMs` and the journal line) is one
  value either way, and `waitS` is computed from it, so no byte changes. It moves earlier only by the two awaited reads.
- **slug approval-input-now.** The plan names the rule handler's read `questions.approvalInput(id)`. It is
  `approvalInput(id, now)`, because the read forgets expired inputs first, as the handler's `forgetExpiredInputs(now)`
  did before.
- **Named exception 3, the count row.** `registry-refused-census.test.ts` has a second row over the same fact as the
  `EXPECTED_SITES` row: `sitesOf('coord/routes.ts', 'readRegistry')` had length 2, "the two approval routes". It now says
  `coord/routes.ts` 1 (the rule route) and `coord/questions.ts` 1 (the raise), in the same commit as the
  `EXPECTED_SITES` re-point. The reader, the word and the total (`readRegistry(` 3 sites, 20 classified) are unchanged.
- **Mutation row for spec §6.7.** `approvals-store.test.ts` reads the store directly and cannot see the raise. The
  "unredacted input persisted onto the row" mutant therefore stays green there. A row in `approval-raise.test.ts`
  catches it instead: the row holds only the masked text, no column holds the raw bytes, and the raw input is held in
  memory. The two masking rows in `approvals-routes.test.ts` also go red.
- **The census count, stated both ways.** `questionStoreCallsOutside` goes from 39 to 38 calls in all. Without the one
  excluded call (`GET /api/approvals/:id/ruling`'s `approvalById`), it goes from 38 to 37 counted.
