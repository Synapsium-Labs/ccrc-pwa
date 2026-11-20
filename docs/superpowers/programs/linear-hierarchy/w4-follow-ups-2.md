# Linear hierarchy, wave 4 follow-ups, second set (D-8183) — task note

This note is run 2810's record for the programme ledger; the coordinator folds it into the ledger on its own pull request.
The run closes the findings that #3021's review rounds 3 to 5 (review runs 2571, 2753 and 2798) carried here under the
coordinator's rulings, before wave 7's pilot touches another team. It edits the plan in one place: D-8735 is amended in
place (item 9, a `Ledger-Edit:` trailer on the head commit, no new number). It defines no departure: D-8740 and D-8741,
issued to this run, are unused. No migration.

## In short

- **Fourteen items, in the brief's order**, each fixed with a test seen red, or worded to the code (item 14, after #3075
  merged, in the round after fix round 1).
- **Correctness first:** a returned or reopened inbound note no longer outlives its `waiting` row (1); `plan take` fails
  closed on an unmeasured home (2); the drift record names a one-way set's value for what it is (3); the inbound lane's close
  re-runs the public-text check before it posts (6).
- **Tests and words:** a workspace-keyed malformed count reds (4); the lowest-id twins name each other and a test holds them
  together (5); single-definition rows (7); `ccrc-api`'s ticket-done gate is a row of the one table gate (8); the refusal
  lists, comments and walk words say what the code does (9 to 12); the first note's figures are corrected in place (13).
- **No live Linear call, capture or probe**, and no Linear key read: every test runs on the fixtures, faked at the pass's
  `call` or at callLinear's FetchLike.

## The items

| # | Finding | What changed | Test (red measured) |
|---|---|---|---|
| 1 | A returned or reopened note outlives its row (round 4 F2) | One rule, one writer: a note lives only while its row is `waiting`. `setInboundState` (`planStore.ts`), the one writer of an inbound row's state, deletes the row's note whenever it moves the row to any other state, inside the caller's transaction or one of its own. So a triage (`handed`, `placed`, `closed`, `raised`), a take (`taken`), a return to a live owner (`mailed`) and the lane's own mail each clear it in their own transaction. The lane's and the retire's separate clears are gone (one clear, not three). Migration 107's comment now says so. | `plan-inbound.test.ts`: a `returned` and a `reopened` note on a `waiting` row, then the owner triages it each way, a hand to the owner's own programme taking it at once included, before the lane's beat: the note is gone and the next beat mails nothing (10 red against the code before: `expected { kind: 'returned', …(3) } to be null`); `plan-store.test.ts`: every non-waiting state deletes it, no `state` or `waiting` keeps it, a rolled-back outer transaction keeps both |
| 2 | An unmeasured home resolves a foreign Upkeep ticket (round 3 F10, the coordinator's ruling) | `upkeepLookupOf` (`inboundPolicy.ts`, L1): with no handed row, a take into an epic or a close looks the Upkeep ticket up in the programme home's measured workspace only. No home, or a home with no team key, is `issue-not-inbound`; a home with a team key whose workspace could not be resolved (the Linear store read failed, was not listed, or no slot routes the team) is `unreachable` (503; a retry helps when the read failed, while no slot for the team needs the project's linking set: fix round 1, A4). A return keeps its path. | `plan-inbound.test.ts` "review 2571 F10": no home, no team key and an unreadable store, each for a take into an epic and a close, with zero handed rows: refused, the ticket unchanged (the unreadable-store case's ticket sits in the home's own workspace, so an unresolvable home refuses even its own; fix round 1, A8, adds a ticket in another workspace) (red: `expected [ 200, '' ] to deeply equal [ 503, 'unreachable' ]`, and `[ 409, 'ticket-workspace-mismatch' ]` where `issue-not-inbound` was due); `plan-inbound-policy.test.ts` the three cases |
| 3 | The drift record reads a one-way set as Linear's value (round 3 F1) | `driftEventText` (`driftPolicy.ts`, L1, keyed on `ONE_WAY_LINKS` beside `driftEventValue`): a one-way field's line reads `<field>: planned, missing in Linear: <ids>`, any other `<field> = <value>`. `DriftPass#recordBlock` uses it for the item's why and the Hand mail. An event stored before reads right too: it already held the planned members Linear lacks. | `drift-pass.test.ts`: a project missing a planned milestone, persistently drifted: the item's why and the Hand mail body both carry the new line and neither `milestoneIds = ` (red: `expected 'Linear holds this epic differently fr…' to contain 'milestoneIds: planned, missing in Lin…'`); a scalar line unchanged; `drift-policy.test.ts` each one-way field and a scalar |
| 4 | Nothing pins a per-issue malformed count against a workspace-keyed one (round 3 F3) | Test only (the brief preferred a test to correcting the note). | `plan-inbound.test.ts`: issue A is left with three malformed close answers and leaves the lane; issue B in the same workspace must still need its own four. Every use of the count keyed by `row.workspaceId`: red, `expected 'malformed' to be null` (B given up at its second answer); restored from a saved copy, `cmp` equal |
| 5 | The lowest-id rule is written twice (round 3 F6, the coordinator's ruling: accept) | `bindingByLinearIdOf` (`driftPolicy.ts`, an L1 reader over rows the pass already holds) and the store's `bindingByLinearId` (`planStore.ts`, an SQL point read) each name the other as its legitimately different twin, and the test that holds them together. | `drift-pass.test.ts`: on a duplicate, both answer the same binding, with the rows in id order and reversed; a first-wins `bindingByLinearIdOf` reds (`expected 5 to be 4`) |
| 6 | The lane's close posts the stored reason unchecked (round 4 F6; round 5 A5's second half) | `InboundLane#act` re-runs the one text check (`textRefusalOf`) inside the flight, after the by-id re-read and before the comment, with the facts of the project that owns the row's team (a team no project claims: mode `unknown`, public, with its team key) and the installer's private tracker keys (`PlanSync#privateKeys`, the list the sync's own check reads). Refused: the close still happens, with a fallback comment carrying no stored text (`closeRefusedCommentBody`), then the cancel; the owner gets one mail naming the identifier, the team and the class, never the text (`closeTextRefusedMail`). | `plan-inbound.test.ts`: a reason that fails the check at act time: the comment carries none of it, the cancel is sent, one owner mail over two passes (red: `expected 'Closed: see AAA-99 for the dupe…' not to contain 'AAA-99'`); a clean reason still posts `Closed: <reason>`; `plan-inbound-policy.test.ts` the two builders |
| 7 | No single-definition rows for three new lists (round 4 F5) | Each stays where it is, for a recorded reason (in the test): `RETIRE_WHYS` is a server-only stored word no wire or PWA file reads, in an L1 file of its own so the store and the policy both reach it; `DRIFT_KEEP_NOTE` is a server-only note the pass writes and reads back; `HIERARCHY_ITEM_REFUSALS` is a refusal word, whose home is the refusal table. | `single-definition/plan.test.ts` (co-edit by its holder's consent): each declared once at its home, the Keep note's words spelled once (red with a second `RETIRE_WHYS`: `RETIRE_WHYS: expected [ …(2) ] to deeply equal [ Array(1) ]`) |
| 8 | `ccrc-api`'s ticket-done gate stands beside the table gate (#2997, D-8727) | The table carries row key, cap word and refusal text, and one check reads it: `plan.phase-ref`, `plan.take`, `plan.triage` and `plan.ticket-done` are rows of it. Every refusal text is unchanged byte for byte. The cap-reader census pins seven call lines (was eight), and its reader drops the two dead literal arms. | `ccrc-api.test.ts` both sides' cases green; the census reds with the table gate's check line deleted; the ticket-done refused case reds with its row removed |
| 9 | The refusal lists omit `unreachable` and `capability-missing` (round 3 F2, round 4 F4) | `references/plan.md` (plan triage and plan take) and, by its holder's consent, `references/api.md` name the doors' `unreachable` (a retry helps) and the client's `capability-missing` for `plan-inbound-v1`. D-8735 is amended in place to state the `unreachable` refusal of a binding door decision when the by-id re-read cannot be made. | `coordinator-plan-reference.test.ts`: both sections and api.md (red before: `expected ' ## The Linear owner: plan triage An …' to match /`unreachable` …/`) |
| 10 | Three comments overstate or misplace (round 3 F4, round 4 F1, F3) | `inboundRecheck`'s and `recheckRows`' comments (`planRoutes.ts`): an unmeasured re-read refuses only a decision that binds the issue. `keepIssueNode`'s doc: the watermark still reads a dropped issue's `updatedAt` (`DriftPass#passOf` leaves `read.changed` whole). | Words only |
| 11 | A malformed page past `DRIFT_MAX_PAGES` re-reads the cap every second pass (round 3 F5) | Recorded as a tolerance (below), not bounded. | — |
| 12 | `not-found` is a walk word the lane never asks about (round 3 F9) | Dropped from `ROW_WORDS` (`inboundPolicy.ts`): the by-id read retires the row `moved-out`, so the walk rule is never asked, and asked anyway it stops the walk, the safe side. | `plan-inbound-policy.test.ts` (red with the word put back: `expected false to be true`) |
| 13 | The first note's figures and words (round 3 F7, F8; round 4 F7, F8; round 5 A1) | Corrected in place in `w4-follow-ups.md`: where D-8733..D-8736 sit (after D-8739); the round 2 reds (10 red and 6 test-only, not seventeen); the F4 and A6 mutation rows re-measured at this run's tip; WM1's cap word on its own `SERVER_CAP_MAP` entry; and the walk words. | Measured below |
| 14 | The plan's wave-epic words for an epic with no waves (after #3075) | Done after fix round 1, once #3075 merged (mail 27224): see "Item 14" below. | — (words only) |

## Tolerance recorded (item 11)

A changed* read refused `malformed` drops the kind's cursor and restarts the sweep from `since`
(`driftCursorAfterFailure`), so a stale cursor cannot wedge a kind. If the malformed page lies past `DRIFT_MAX_PAGES` (10),
each sweep reads 10 pages, stores a cursor, fails on that page at the next pass and restarts: the kind's watermark stays at
`since` and the kind re-reads 10 pages every second pass, one rate-service call a page on lane `sync`. That is at most
10 extra calls a pass for one kind of one workspace, for as long as Linear keeps answering that page malformed; before the
cursor (D-8734) the page cap alone applied, so it is not a regression. Nothing is skipped: the watermark never moves past a
change it did not read. It is accepted, not bounded; a later run can count the restarts and back off if the fleet shows it.

## Rulings the build made

- **Item 1:** the note is deleted on any move out of `waiting`, not mailed: the owner or a coordinator who acts on the row has
  acted, and the note only ever spoke to the owner's next mail about a `waiting` row. Cost if wrong: an owner who triages a
  returned issue without reading the return's note never sees it.
- **Item 2:** a home with a team key whose workspace cannot be resolved answers `unreachable`, a misconfigured slot included.
  Cost: a slot that will never route reads as retryable.
- **Item 6:** a reason refused at act time still closes and cancels, with a fallback comment, as the drift restore's refused
  comment does (review 2457 F3), rather than giving the close up. (The lane judged a team no project owns as `unknown`,
  public, while `plan take`'s close judged it under the programme's home; fix round 1, F1, aligned the door to the lane.)
- **Item 6:** the owner's mail (superseded by fix round 1, A1, A2 and A6: it is now sent only when the fallback comment is
  freshly made, and says what is true on every path).
- **The final review's minors:** `InboundLane#retire` now drops the issue's malformed count, so a reopened issue's close
  counts afresh and the map does not grow with retired issues (a test, red first).
- **Tasks 1 and 3** measured their red by reverting the source after the fix was written; the red is recorded, only the
  order departs from red first.

## Co-edits by consent

`server/src/coord/planRoutes.ts` and `server/test/single-definition/plan.test.ts` (desktop polish WM2, mail 26625): the two
doc comments, `plan take`'s Upkeep lookup (8 lines, told to the holder, mail 26668) and one import name; one appended
`it()`. `ccd/coordinator-skill/references/api.md` (Overlord D-8126 A5, mail 26634): the inbound refusal list only.

## Carried, not built here

- `plan take` reads `coord.programHome(slug)` twice (in `takeRowOf` and at the new lookup), inside one `serial`, so they
  cannot disagree; returning it from `takeRowOf` is past the consented lines.

## Fix round 1 (review run 2834)

The coordinator's rulings (mail 26945): F1 fixed as ruled, the advisories taken in the same round. Each behaviour change has a
test seen red first; a test of code already right says so and is proved by mutation.

| # | What changed | Test (red measured) |
|---|---|---|
| F1 | Align the door to the lane (the coordinator's ruling; spec §6.1 as written, no departure). `textFactOfTeam` (`planSyncPolicy.ts`, L1, beside `textRefusalOf`) is the one writer of "a team no project claims is `unknown`, public": the lane's `InboundLane#textRefusal` and the route's `textRefusal` gather readings and call it. `plan take`'s close judges a handed row under the team's owning project only (no fall-back to the programme's home); an Upkeep ticket keeps its project. | `plan-inbound.test.ts`: a take close on a managed team no project claims, under a private home, with a reason `unknown` refuses: `[409, 'linear-text-public']`, the row still handed (red: `expected [ 200, '' ] to deeply equal [ 409, 'linear-text-public' ]`); `plan-sync-policy.test.ts` the helper |
| A1, A2, A6 | The refused-text close has an identity of its own, from stored facts only (no migration): the close's time (`mailedAt`, else `seenAt`) and, where text may show, a digest of its reason (`closeTimeOf`, `reasonDigestOf`, `closeIdOf`, `closeCommentSeedOf` in `inboundPolicy.ts`, L1, digest through `uuidOf`). The comment's key tells the body kind and the close apart; the fallback kind's key carries nothing of the refused reason (the comment id is visible in Linear: review of this round, Important). The owner's "closed without its reason" mail is sent once per close (its subject carries the close's identity) whenever the fallback comment landed, made now or by an earlier attempt, and its body is true on every path: a comment without the reason is on the issue, an earlier comment carrying it stays, ccrc is canceling, and a cancel given up gets its own mail while one Linear asks to retry is retried. | `plan-inbound.test.ts`: a re-close after a real retire and reopen posts its own comment (red: `expected false to be true`, conflict on the shared key); two refused closes give two mails (red: `expected [ { …(4) } ] to have a length of 2 but got 1`); one close's retried pass mails nothing more; the fallback's key does not change with the reason (red: `expected 'a21a1674-…' to be '5ac0fcad-…'`); a fallback answered `conflict` still mails once; same-reason closes told apart by `mailedAt`; `plan-inbound-policy.test.ts` the identity functions |
| A3 | Test only. | `plan-store.test.ts`: outside a transaction, a move out of `waiting` whose note delete fails leaves the row `waiting`; passed first time; red with the own-transaction branch made a bare write (`"handedTo": "coord-a"` received) |
| A4 | `unreachable` keeps its word; `upkeepLookupOf`'s comment and detail name both causes: a failed store read (a retry helps) and a team no slot routes (no retry helps; the project's linking needs a slot). The two references say when a retry helps. | `plan-inbound-policy.test.ts` (red: `expected 'the workspace of the programme's hom…' to match /could not be read \(a retry helps\).*no slot routes.*retry does not help/`) |
| A5 | `references/api.md`'s `unreachable` says what `plan.md` says (binding decisions only; take's unresolvable home; when a retry helps), by its holder's consent (told, mail 26947). | `coordinator-plan-reference.test.ts` pins both (red: `expected '# The coordinator's API calls Part o…' to match /`unreachable` \([^)]*refused only for…/`) |
| A7 | No test, by finding: no real path leaves a note on a row `plan take` can take. A note is written only with a move to `waiting` (a return to a gone owner, a reopen); `plan take` reads `handed` rows only; every move to `handed`, `taken` or `placed` clears the note. Item 1's row now cites the hand to the owner's own programme, the test that exists. | — |
| A8 | Test only: zero handed rows, the home's workspace unresolvable, the Upkeep ticket bound in another workspace: a take into an epic and a close each `unreachable`, the ticket unchanged. Item 2's row corrected. | `plan-inbound.test.ts`; passed first time; red with the route falling back to an any-workspace lookup (`expected [ 200, '' ] to deeply equal [ 503, 'unreachable' ]`) |

**Residuals recorded, not built:** two refused closes of one issue with no mail between them share the fallback's key, so the
second posts nothing new (the issue already carries a fallback); two different refused reasons in one close round get two
subjects, so two mails; and if the facts loosen between passes of one close, a later pass may post the reason after the mail
said it was withheld (no leak: the text then passes the check).

## Item 14 (after #3075 merged at `208afddca`; the coordinator's mail 27224)

`origin/main` merged into this branch with `git merge` (clean; the coordinator's licence). Words only, each read against the
code (`epicForOpen` and `listedWaves`, `server/src/coord/planPolicy.ts`; `PlanEpicBody`, `shared/plan.ts`), taking the
sentences and the two narrowings from the WM6 task note's section 6:

- The plan, Task 2's refusal list for `runs open`: `wave-epic-mismatch` now holds for an epic that lists no waves (no live epic
  lists the wave and the run names no ticket of a live waveless epic, or the named ticket's epic lists waves and is not the
  wave's), and `ticket-required` is named for a run with no ticket, at a wave no live epic lists, in a plan where a live epic
  lists none. Only live epics count: a dropped waveless epic leaves `wave-epic-mismatch`.
- The plan, Task 2.1's wire contract: `PlanEpicBody` reads `waves?: number[]` (an absent field keeps a stored epic's range and
  a new epic lists none; an explicit `[]` clears it); the stored row stays `number[]`.
- `ccd/coordinator-skill/references/plan.md`, which this pull request already edits: its line 4 (an epic may list no waves,
  and each of its runs names its ticket), the `runs open` ticket sentence, and the `wave-epic-mismatch` and `ticket-required`
  lines (WM6's case beside WM1's). It is a rules file, so the review judge's rules-mixed reason stands on this pull request as
  it did before (the coordinator's ruling, mail 26858: no split).

The spec's side (§4.1 and §16 call 2) is the coordinator's, on its ledger pull request. No test pins these sentences; the
plan reference's pins still pass.

## Suites run (fleet slice, `--maxWorkers=2`, at most 12 files a command)

Every command through `ccrc test --`, in `server/`, at the pushed tip's tree:

- drift-pass, drift-policy, plan-inbound, plan-inbound-policy, plan-store, plan-routes, plan-sync, plan-sync-lane,
  plan-sync-lifecycle, plan-sync-policy, linear-items, hierarchy-routes: 674 passed.
- ccrc-api, ccrc-api-closed, census-w3/claimant, coordinator-plan-reference, coordinator-skill, single-definition/plan,
  public-text, refusal-status, plan-vocabulary, plan-ticket-done, plan-sync-owned, plan-dispatch-wait: 810 passed.
- plan-sync-description, plan-dispatch-route, lane-schedule, linear-proxy-routes, overlord-other-lanes-census,
  overlord-other-lanes-routes, auth-gate, box-token-census, token-shared, single-definition/late-census, core-vocab,
  writers-map: 894 passed.
- growth-check, growth-caps, deviation-refs (after `git fetch origin main`), anchors, citations, topology-clean,
  single-definition/refusal-table, vocabularies, mail-routes, coord-policy-rings, oss-metadata, ownership: 487 passed,
  3 skipped, and one load timeout (deviation-refs' "two real trees" case at 20 s, on a loaded box); deviation-refs re-run
  alone: 34 passed. The first run of this group, after the six tasks, was 488 passed, 3 skipped.
- The server typecheck (`tsc --noEmit -p tsconfig.json`): clean. No migration changed, so coord-db was not run.

**The first note's mutation rows, re-measured at this tip** (item 13; each mutant applied from a saved copy, three files run,
restored byte for byte and compared): the take gate out, 8 red in plan-inbound; the triage gate out, 9; the close's by-id
re-read replaced, 4; the interval at 0, 11; the call after `detect` out, 12; the note's clear out of `setInboundState`, 11 in
plan-inbound and 2 in plan-store; the retirable guard out, 1 in plan-store. drift-pass stayed green under every one.

**Fix round 1, at its tip:** drift-pass, drift-policy, plan-inbound, plan-inbound-policy, plan-store, plan-routes, plan-sync,
plan-sync-lane, plan-sync-policy, public-text, linear-items, hierarchy-routes: 643 passed. coordinator-plan-reference,
coordinator-skill, single-definition/plan and vocabularies, refusal-status, growth-check, growth-caps, anchors, citations,
topology-clean, coord-policy-rings, mail-routes: 714 passed, 3 skipped, with mail-routes killed by the slice's memory cap under
load; re-run alone, 61 passed. The server typecheck: clean.
