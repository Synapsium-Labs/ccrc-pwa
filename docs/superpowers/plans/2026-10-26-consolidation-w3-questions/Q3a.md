# W3 Task Q3a: the census and the characterization pins — task note

The per-task note the W3 plan asks for (`2026-10-26-consolidation-w3-questions.md`, header): what Q3a measured, and each
place it departs from the plan's text, by slug. The coordinator folds these into §Deviations and decisions.

**Base:** `origin/main` `865e1833b` (the plan measured `ce7b94dab`). Every count the plan names was re-measured through
the parser on this base, and every one is unchanged: 4 hold carriers plus `approvalInputs`, 3 pane edges, 2 sweep entry
points, 9 doors (4 claimant, 4 operator, 1 navigation), 4 door-ins, 48 question-store calls in 6 files over the closed
list of 32 `CoordStore` methods (47 counted, 1 excluded by name), and 2 definitions of the normalize-and-prefix rule.

**Placeholder spelling (slug `question-census-spelling`).** `server/test/dtbd.test.ts` reds the tree on any concrete
placeholder of the `D-TBD-<slug>` form in a tracked file. So the code and test comments name this task's decision as
"slug question-census" until the allocator issues its number; the mapping commit swaps that phrase for the number. The
plan file itself carries the literal placeholders, so the plan PR meets the same guard.

## Departures from the plan's text

- **`question-census-module` (where the queries live).** The plan appends W3's queries at `consolidationCensus.ts`'s
  tail. Two open PRs append at that same tail (#1594, W8's census split; #1596, the sleep-lane pin), so under rule 6 W3
  takes its own module, as W8's chains do: `server/test/census-w3/questions.ts`, with its rows in the sibling
  `census-w3/questions.test.ts`. `consolidationCensus.ts` changes by five words only: `sourceFiles`, `sitesOf`, `esc`,
  `watcherFacts` and `siteAt` are exported, so the W3 module reads the tree through the same helpers. Q3b to Q3g quote
  the census from `census-w3/questions.ts`, and their Verify runs `census-w3/questions` where the plan says
  `consolidation-census`.
- **`question-census-table-row` (the store-call table).** The plan's Q3a table lists `watch.ts`'s `answeredLate:
  approvalsForChild (1)`. Measured, `FleetWatcher.answeredLate` makes no store call; the one `approvalsForChild` call
  outside the sweep and the hand-over door is `FleetWatcher.tryHoldApproval`'s. The file's count (22) and the owning task
  (Q3d) are unchanged. `QUESTION_STORE_OWNERS` names `tryHoldApproval`.
- **`question-census-hold-gate` (Step 0's private-field list).** The plan names `hold-gate.test.ts` among the tests that
  read a private question field by cast. On this base it reads none (its casts are the merge sweep's). The list is the
  other four files.
- **`question-pairing-corpus-cross` (the pairing corpus).** The corpus pairs every recorded 2.1.300 ask screen with every
  recorded envelope (`pwa/test/askPanes.ts`'s, copied in as data), not each screen with one envelope: the expectations are
  today's client answers either way, and the cross product holds more of them (406 rows with the ten synthetic ones).
  `cc300-ask-review-cancelled` paints no dialog, so its rows are the synthetic "no pane" row.
- **`question-doors-guard-forbidden` (the rule door).** The rule door's `guard-forbidden` refusal is reached only when the
  classifier answers differently at the rule than at the mint (a forbidden-class request is minted released, and the
  rule door answers that row `approval-released`). The door pin does not construct it; `approvals-routes.test.ts` holds
  it. Every other refusal of the four claimant doors and of `POST /api/approvals` is a row, in today's ladder order, with
  a pair row for each two consecutive positions the fixture can fail together.
- **`question-doors-operator-width` (the operator doors).** The operator doors' press ladders are `inject/send.ts`'s and
  `inject/ask.ts`'s, which W3 calls and never edits; their suites hold every press refusal. The door pin gives each
  operator door its front ladder, one press refusal, its success and, for the two that touch a question table, every
  record arm.

## Step 0's lists, for Q3c to Q3f to re-point from

- **Private question fields read by cast:** `ask-restart.test.ts`, `asks-routes.test.ts`, `asks-sweep.test.ts`,
  `fleet-listing-characterization.test.ts` (`asksDisabled`).
- **Literal source pins:** `registry-refused-census.test.ts`'s "tick() passes registryRead to sweepAsks(";
  `lane-schedule.test.ts`'s `FleetWatcher.sweepApprovals` and `approvalPrune` rows; `single-definition/ask-digest.test.ts`'s
  "both answer routes read their body with readAskAnswer and neither respells the index check" (its two slices).
- **Inventory rows naming a question route or symbol:** `routes.test.ts`'s canonical-id census (the asks and approvals
  `:id` rows) and its `knownId` census (the four operator answer doors and `/dialog/tab`; 22 routes, 18 POST and 4 GET);
  `auth-gate.test.ts`'s `scanRoutes('coord/routes.ts')` count (47), `ROUTES.length` (125), the sorted `EXEMPT` keys, the
  box-token `gated` list and its census title ("thirty-three … thirty-six"); `box-token-census.test.ts`'s number-word sites
  (README, `auth/gate.ts`, the census title) and its `CLAUDE.md` bullet checks; `coord-pause-route.test.ts`'s
  `SESSION_ONLY` set; `registry-refused-census.test.ts`'s `EXPECTED_SITES` rows `coord/routes.ts | POST /api/approvals |
  readRegistry | refuses` and `coord/routes.ts | POST /api/approvals/:id/rule | readRegistry | refuses`.
- **Direct sweep calls:** 46 in 5 files on the base (`asks-sweep` 22, `ask-restart` 11, `lane-coordination-characterization`
  8, `asks-routes` 4, `approvals-sweep` 1). Q3a's `questions-pin.test.ts` adds 2 call sites (its two step helpers). Q3c
  keeps both methods public, so none is edited.
