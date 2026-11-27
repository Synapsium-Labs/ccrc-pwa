# W1 renewal readings, PR H: the launch profile's account hold

Plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md`, Task 11 only, with its Global Constraints, Review
Focus 1, 2, 7 and 8, the PR split's row H, "The hold's window", the Cross-plan seams and open questions 5, 6 and 9 as ruled.
Spec `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.6. Built on `main` at `f97f102979`. No deviation number was
allocated for this run: departures are recorded by slug below, for the coordinator to fold into the ledger.

## What was built

A start of the Overlord that loads something from its account's own configuration that the launch profile does not list holds
that account out of the Overlord's ordered list until the operator clears it. A held account reads as outside the set, so the
existing hard row `account-outside-set` renews the Overlord off it (F7). A hold only narrows: it never empties a list (holds that
would leave none are overridden, in the list builder and the account readings alike), and when the holds leave no account that
serves, readiness reads `stranded`, as for any other reason nothing serves.

- **The table** `overlord_account_holds` (coordination migration 133 on today's `main`): one row per lane, the one cause word
  `launch-profile-unmet`, the start that held it, when, and the clear's time and actor. Its store is
  `server/src/continuity/accountHolds.ts`, with four `CoordStore` delegates. **Two writers**, each a different move of the one
  fact: `holdAccount` (the generations pass only) and `clearAccountHold` (the operator's door only); `writers-map.test.ts` names
  both. A hold is written once per start: the same start (or an earlier one) asked again answers `changed: false`, so a restart
  that re-asks never undoes the operator's clear; a later failing start holds a cleared lane again.
- **The operator's two doors**, in `server/src/continuity/routes.ts` beside the backstop's: `GET /api/continuity/account-holds`
  (the standing holds: lane, cause word, start id and time; no session text; an unreadable table answers its own `unmeasured`
  kind, 502, never an empty list) and `POST /api/continuity/account-holds/:lane/clear` (records who cleared it, through the
  doors' `operatorActor`: the signed-in device, or `flag-off` while sign-in is dark; `not-found` when no hold stands;
  `bad-request` for a path that names no account id). Both are session-gated when sign-in is armed, never EXEMPT, and consult no
  box token. No step-up: a clear widens back to the set the operator chose. The read ships here as ruled (the home plan's
  question 7), so home C can draw the control.
- **The list filter** `heldOutOfList` (L0, `shared/renewal-readings.ts`) inside designation A's one builder, `overlordAccounts`:
  `AccountFacts` gains `held` (L0's `AccountHoldsRead`), the list leaves every held account out, holds that would leave none keep
  the list as it was (`holds: 'overridden'`), and holds that could not be read keep it unfiltered (`holds: 'unread'`). `counted`
  is over the list before the holds (C56 counts the accounts that can serve; a hold orders, it does not disable). Every builder of
  `AccountFacts` reads the holds once per call: the Overlord doors' `readAccountFacts` (the designate, rebind, model and account
  set doors, the designation read and designation B's write-set before each renewal), `accountLoad.ts#loadFactsOf` (the ladder's
  load line and readiness), and the readings wiring's facts. No second list exists.
- **The hold** (`generationsLane.ts#holdOverlordStart`, called once a pass): for the designated Overlord's live generation
  (`holdTargetOf`), the sandbox check's verdict of its newest `startup` or `resume` start (`newestStartVerdict`) and
  `holdOfStart` over it. `hold` writes; `settled` (a pass, or failures another account would not cure) ends the decision for
  that start: its loads report is still read every pass, but nothing is decided or written for it again; `unmeasured` (no report
  yet, an unmeasured property, an unknown account) holds nothing and is decided again next pass (F10), except a `profile` property that reads `unmeasured` because the report names no profile, which settles (next sentence). A start that ran another
  launch profile (its `profile` property not held: the role or the digest differs, or the report names none) is settled with no
  hold, whatever else it loaded: its extras say nothing about the account (fix round 1, F2, the stance `overlordInstallBehindOf`
  takes on build skew). The settled starts are a per-process memo (`GenerationsDeps.holdsSettled`, kept by the watcher). Nobody designated:
  nothing is read or written.
- **What the hold reads of the harness** lives in the sandbox check (`sandboxCheck.ts`), not in the hold's decider: each property
  verdict gains `fromAccount`, true only when the property failed because the start loaded something extra from the account's own
  configuration directory. `holdOfStart` reads only that flag.
- **The account readings**: `accountOutsideSetOf` takes the holds as the list builder applied them, from the same
  `overlordAccounts` result as the candidates (`overlordCandidatesAndHoldsOf`, mapped by `holdsAppliedOf`), in place of
  `'not-wired'`: an overridden hold reads exactly as no hold, so the reading and the list cannot disagree (fix round 1, F1). A store
  without the read keeps `'not-wired'`.
- **The Overlord's `installBehind`** (question 5, ruled Q5): `overlordInstallBehindOf` over the gather's roll test, the newest
  start's digest against the server's (`startDigestDiffersOf`) and the fleet's build agreement (`buildsAgreeOf` over
  `inventoryBuildAgreement`, the profile lane's read): build skew reads unmeasured `build skew`, never behind. A coordinator's is
  unchanged.
- **Readiness reads the holds**: `overlordReadinessWiring.ts` answers the holds fact from the store in place of `not-wired`; the
  lane reads it once a pass and hands it to the candidates (`candidates(d, held)`), so a hold that leaves only unserving accounts
  reaches the word as `stranded`, and holds that cannot be read make the stranded fact unmeasured (`stranded: holds unread`),
  never "no holds". The hold items (one per held lane) were already built and are now fed.

## Where `main` differed from the plan

- **Designation B's write-set step is on `main`** (`overlordDesignation.ts#renewalSetOf`, called from the lane port's
  `beforeRenew`). It reads `overlordAccounts` through `readAccountFacts`, so the holds reach the list written before each renewal
  with no further code. The plan asked this pull request to edit `w1-designation.md` to add that step (question 9, F9); that step
  has since been built and merged, so there is nothing for the plan text to carry beyond what the ledger already says. I edited
  no plan.
- **No sandbox verdict is stored** (`verdict-computed-on-read`), so there is no "start-verdict read" to add to
  `GenerationsCoord`: the pass reads `startLoadsOfNewestStart` and composes the verdict with the sandbox check's own
  `newestStartVerdict`, over the workspace the settle measured (as the ladder's `launch-profile-unengaged` reads it).
- **The seats were already cut**: `accountOutsideSetOf` took `holds` with a `'not-wired'` arm, readiness had a `holds` fact
  reading `not-wired` and raised one `hold` item per held lane. This piece fills them.
- **The ladder's load line** (`load-past-95`) also builds the list through `loadFactsOf`, in `server.ts`; its one line changed in
  place to hand the holds over (no line added).
- **No `server.ts` deps change for the doors**: the continuity routes reach the store directly, so the plan's "+2" for the doors'
  deps was not needed.
- **`Holds` existed as `{ ok: false; detail }`** in the L1 module; the plan wrote `AccountFacts.held` as `{ ok: false }`. Both now
  use L0's one shape, `AccountHoldsRead`, with its detail.

- **Two more files the plan did not name, found by this pull request's first CI run** (red on both, fixed in the second push):
  the Overlord door census reads `continuity/routes.ts` and wants every registration there to be a door row or a
  `NOT_OVERLORD_DOORS` entry, so the two operator doors joined that list in `overlordDoors.ts` (by peer packet, with its holder's
  and the coordinator's yes); and the limit samples migration case rolls back every later migration, so it drops
  `overlord_account_holds` too and counts eight later migrations, not seven.

## Fix round 1 (review run 3981, ruled in call 1605)

- **The merge of `main` 87c64a957a** (the sequence doors, #3456) is commit 937eef091b, an ordinary merge before the fixes.
  Hand-resolved: `server/test/auth-gate.test.ts` (one comment conflict beside sequence C's count paragraph, and one count
  sentence). That file and `server/src/auth/gate.ts` are another run's claim, so the merge takes `main`'s side of both, and this
  PR's two doors' counts are re-derived on the merged tree in a commit of their own, sent to their holder first. Everything else
  merged without a hand: `overlordDoors.ts` keeps both sets (`main`'s sequence and invariants rows, this PR's two not-Overlord
  entries), and the other count files took both sides. Main's last migration is still 132, so 133 stays this PR's.
- **The gate counts on the merged tree**, measured by the gate file's own suite: 336 scanned, 333 HTTP, 215 gated, 118 exempt.
- **F1, fixed**: when the holds cover every listed account, the list builder keeps the list as it was, and the account-outside-set
  reading used to read a held account outside the set and find another held one serving, so a Live lane would renew at every turn
  end. The reading now takes its holds from the list builder's own result (above).
- **F2, fixed**: a start whose `profile` property is not held holds no account (above).
- **F3, a recorded limit** (below, and the departure `first-start-failure-writes-no-hold`).
- **F4, fixed (tests)**: a case at each of the three builders the first round left unpinned, each with a standing hold, and the
  readiness lane's case now builds its candidates from the hold the lane hands over. Each by-hand mutant that swaps the holds for
  an empty answer is red (the mutation table).
- **A1**: the comments and this note say what the code does (the report is read every pass; only the decision and the write stop
  once settled), and the asked-again case asserts the start is never settled, so a mutant that settles an unmeasured verdict is red
  there too. **A2**: a pass-level case reaches `settled` with no hold, through F2's fixture (a start that reports another profile);
  a fixture with a listed Claude Code version is not cheap, since the release lists no build's own skills and agents yet.

## Departures, by slug

| Slug | What and why |
|---|---|
| `holds-store-in-its-own-module` | The holds' SQL is `continuity/accountHolds.ts`, not `continuityStore.ts` (accepted, call 1520). One table and its two writers; the shared store grows by nothing, and its file was another run's claim. |
| `hold-of-start-answers-three-arms` | `holdOfStart` answers `hold`, `settled` or `unmeasured` in place of the plan's `{ lane } \| null` (accepted, call 1520). A pass and an unread verdict are handled differently (stop asking, ask again), so they are never one value. |
| `sandbox-check-marks-the-account-load` | `PropertyVerdict.fromAccount`, set by the sandbox check (accepted, call 1520; the programme's design rule): what the harness loads from where is known in one module. |
| `designate-pick-avoids-a-held-account` | The create's pick is inside the counted accounts that the held-out list keeps, and only falls back to every counted account when none is left there (accepted, call 1520). The count is unchanged. |
| `hold-target-through-the-binding-reader` | `holdTargetOf` (L1) finds the bound session's live Overlord generation through `boundTo`, the module's one binding reader, so no session comparison is made by hand (`run-session-census.test.ts`). |
| `holds-read-shape-in-l0` | `AccountHoldsRead` in `shared/renewal-readings.ts` is the one shape of the read for the store, the list, the account readings and readiness. |
| `install-behind-rides-w1-inputs` | `W1Inputs` gains `installBehind`, so the wiring answers the Overlord's and the lane's spread lays it over the gather's `behind`; a coordinator's, and a store without the two reads, keep the gather's. |
| `readiness-candidates-take-the-holds` | The readiness port's `candidates(d, held)`: the lane reads the holds once a pass and hands them to the candidates, the word and the items. |
| `first-start-failure-writes-no-hold` | A start that fails the check during designate or rebind writes no hold (fix round 1, F3, ruled a recorded limit): the hold is written by the generations pass, which sees only live generations, and the settle retires a failing pending generation in the same transaction. A second, independent cause: `holdTargetOf` answers only for a session `boundTo` reads as designated, so a pending generation is never a target even while it is still live. The fix rides the next readings PR (ticket `first-start-failure-holds-its-account`). |
| `another-profile-holds-nothing` | `holdOfStart` settles a start whose `profile` property is not held, with no hold (fix round 1, F2): the plan's Task 11 reads the extras alone (not its question 6, which is about where the hold's operator item lives). |
| `holds-read-unreadable-answers-502` | The account holds' read answers 502 `unmeasured` when the table cannot be read, the `unmeasured` refusal's own status, as for every sibling in `continuity/routes.ts`; the home plan says "or 503". |
| `settled-starts-memo-in-the-watcher` | `GenerationsDeps.holdsSettled`, a memo the watcher keeps across passes, like `retried` and `emptyTries`; `watch.ts` grows by three lines. |
| `newest-start-verdict-in-the-sandbox-check` | `newestStartVerdict` (L1) beside `profileEngagedOf`, which it does not replace (the ladder's mutants pin `profileEngagedOf`'s text). |
| `hold-written-in-shadow-too` | The hold acts on no session, so the pass writes it in shadow and live alike; only the renewal it leads to waits for the `continuity` row. |
| `clear-door-no-step-up` | The clear asks no step-up: it widens back to the operator's own set, and the hold itself was never an authority grant. |

## Rules, and the case that goes red when each is broken

| Rule | Case |
|---|---|
| An unmeasured verdict holds nothing and is asked again | "a verdict that is unmeasured on the first pass ... holds on the next (F10)" and "an unmeasured property never holds an account, and the start is asked again each pass" (`continuity-renewal-holds.test.ts`); mutants H1, H3, H4 |
| A property the workspace loaded never holds an account | "a property the workspace loaded ... never holds an account (H2)"; the sandbox's `fromAccount` case; mutants H2, FA3, FA4 |
| A hold is written once per start | "a hold is written once per start" (`account-holds-route.test.ts`); the first pass case (one write over two passes); "a cleared hold is never put back by the same start" |
| An overridden hold is overridden everywhere | wiring "holds over every candidate are overridden everywhere" (F1); `holdsAppliedOf` cases; mutants HA1, HA2; by hand M7, M8 |
| A start that ran another profile holds no account | "a start that ran another launch profile holds nothing" (the set, and the pass-level case); mutants H6, H7; by hand M6 |
| Every builder of the account facts reads the holds | readiness wiring "the candidates the wiring builds leave a standing hold out"; lane port "a standing hold leaves its account out of the order written"; ladder "a hold on the one account under the line ..."; readings wiring "a held account is left out of the candidates"; by hand M1 to M4 |
| Holds that would empty the list leave it as it was and report it | `heldOutOfList` L1 case; designation "holds that would empty the list leave it as it was, overridden"; mutants L1, L4 |
| An unread hold leaves the list unfiltered and marked, and the reading unmeasured | designation "unread holds leave the list unfiltered and marked unread"; wiring "holds that cannot be read leave the reading unmeasured"; readiness "holds that cannot be read reach the word as unmeasured"; mutants A16, A17, FA-H1 |
| A clear puts the account back | wiring "a clear puts the account back"; route "a clear puts the account back, records the actor" |
| The clear door is the operator's alone, session-gated, never the box token's, and records who cleared | route "with sign-in armed, no session is 401 at both, and the box token is no key to them", "... records the signed-in device, never flag-off", "with no actor port the clear records flag-off" |
| Build skew reads the install-behind reading unmeasured, never behind | "every combination" (`installBehindCases`); wiring "build skew reads the install-behind reading unmeasured"; mutants I1, I2 |
| With nobody designated, nothing is written | "nobody designated: nothing is read and nothing is written" |

## Mutation table

**Before:** each set's baseline (the real module) passes its suite; `mutation-floors.test.ts` refuses a set whose baseline
fails. **After:** every mutant below is applied in memory by the floors harness and killed. Six new sets join `MUTANT_SETS`
at floor 1 (`holdOfStart`, `holdTargetOf`, `overlordInstallBehindOf`, `heldOutOfList`, `newestStartVerdict`, and in fix round 1
`holdsAppliedOf`), and four existing sets gain mutants (`sandboxVerdict`, `overlordAccounts`, `designateVerdict`, `readinessFactsOf`); no floor was lowered. On the
first floors run one new mutant survived (FA4, a `User` file inside the workspace read as the account's); its case was added and
the set re-run killed every mutant.

| Set | Mutant | Killed by |
|---|---|---|
| `holdOfStart` | H1 hold on an unmeasured property (the plan's) | "an unmeasured property never holds an account" |
| | H2 hold on a workspace-loaded property (the plan's) | "a property the workspace loaded ... never holds an account (H2)" |
| | H3 an unmeasured property settles | "an unmeasured property never holds an account" |
| | H4 no verdict settles | "no verdict yet holds nothing and asks again" |
| | H5 an unknown account settles | "an account load on a start whose account is unknown" |
| | H6 the profile state ignored; H7 only a failed profile settles (fix round 1, F2) | "a start that ran another launch profile holds nothing" |
| `holdsAppliedOf` | HA1 the readings see the holds while the list is overridden; HA2 every answer reads as no hold (fix round 1, F1) | the two `holdsAppliedOf` cases |
| `overlordCandidatesOf` | C1 the ordered list not asked (PR D's, re-pinned to the one `overlordAccounts` result) | PR D's candidates case |
| `heldOutOfList` | L1 drop the empty-list arm (the plan's) | "holds that would leave none keep the list as it was" |
| | L2 an empty list overridden; L3 the holds kept; L4 an override that empties | the four `heldOutOfList` cases |
| `overlordInstallBehindOf` | I1 read skew as agreement (the plan's); I2 unknown builds read as agreement | "every combination" |
| | I3 the digest ignored; I4 an unmeasured digest read as no; I5 `and` for `or` | "every combination", "an unmeasured behind keeps its own reason" |
| | D1, D2 (`startDigestDiffersOf`), B1 (`buildsAgreeOf`) | the digest and build-agreement cases |
| `holdTargetOf` | T1 any role; T2 an unreadable row binds; T3 any Overlord generation | the three `holdTargetOf` cases |
| `newestStartVerdict` | N1 another start's report read; N2 no start read as unmeasured; N3 the carry dropped | the `newestStartVerdict` case |
| `sandboxVerdict` | FA1 a missing skill is the account's; FA2 an extra skill is not; FA3 any outside file is; FA4 a `User` file in the workspace is; FA5 an extra tool is not; FA6 a foreign hook is not; FA7 only the door server is | the `fromAccount` case |
| `overlordAccounts` | A14 the holds ignored; A15 held accounts not counted; A16 unread holds read as none; A17 unread holds empty the list | the four "PR H" `overlordAccounts` cases |
| `designateVerdict` | D4 (re-pinned to the new pick); D14 a held account picked; D15 a hold strands the pick | the two "PR H" designate cases |
| `readinessFactsOf` | FA-H1 unread holds read as no holds; FA-H2 any holds answer doubts the strand | "strand (renewal readings PR H) ..." |

**By hand** (each applied to the committed source, the named file run alone through the test wrapper, the source restored).
Before: every named file green. After:

| Mutation | File run | Red |
|---|---|---|
| drop rule 3 of `accountOutsideSetOf`, the held check (the plan's) | `continuity-renewal-readings-wiring.test.ts` | 1 of 57 (and the F7 unit cases) |
| stop asking after the first pass (the plan's) | `continuity-renewal-holds.test.ts` | 1 of 28 (the late verdict case) |
| the pass never asks the hold step | `continuity-renewal-holds.test.ts` | 1 of 28 (the source pin) |
| the readiness wiring's holds back to `not-wired` | `continuity-renewal-holds.test.ts` | 1 of 28 |
| the readings wiring hands the account readings `'not-wired'` again | `continuity-renewal-readings-wiring.test.ts` | 2 of 57 |
| the facts carry no holds (the list unfiltered) | `continuity-renewal-readings-wiring.test.ts` | 1 of 57 |
| the clear records `flag-off` whatever the actor | `account-holds-route.test.ts` | 2 of 15 |

Fix round 1, on the merged tree (`handmut` script in the worker's scratch, each mutation applied, the file run alone, the source
restored). Before: every named file green (holds 34, wiring 58, lane port 16, readiness lane 50). After:

| Mutation | File run | Red |
|---|---|---|
| M1 the readiness wiring hands the candidates an empty holds answer | `continuity-renewal-holds.test.ts` | 1 of 34 |
| M2 the doors' account facts carry an empty holds answer | `overlord-lane-port.test.ts` | 1 of 16 |
| M3 the composed server's ladder load line carries an empty holds answer | `continuity-renewal-holds.test.ts` | 1 of 34 |
| M4 the readiness lane hands the candidates an empty holds answer | `overlord-readiness-lane.test.ts` | 3 of 50 (the real-hold case among them) |
| M5 an unmeasured verdict settles | `continuity-renewal-holds.test.ts` | 2 of 34 |
| M6 only a hold settles (A2's mutant) | `continuity-renewal-holds.test.ts` | 1 of 34 |
| M7 the readings wiring hands the reading the holds as read | `continuity-renewal-readings-wiring.test.ts` | 1 of 58 |
| M8 the candidates-and-holds builder answers the holds as read | `continuity-renewal-readings-wiring.test.ts` | 1 of 58 |

Red first: on the old source with the new cases, the F1 wiring case is red (1 of 58) and the F1 and F2 set and pass cases are red
(4 of 34).

## What a merge arms

From the merge, with the server on this build:

- **Nothing acts on a session.** The hold writes a row; the renewal it leads to is the renewal act's, which acts only while the
  `continuity` row on the Shadow lanes card is Live and the box can renew. In shadow the Overlord's due record and `blind` are
  written as before.
- **The hold is written in shadow and live alike**, once per Overlord start whose loads report shows something extra loaded from
  the account's own configuration (an extra tool, tool server, skill, agent type or SessionStart hook, or Claude Code's `User`
  memory file outside the workspace). Each generations pass reads the designated Overlord's newest start's report once (one read
  of `continuity_start_loads`). **With nobody designated, nothing is read and nothing is written** (measured by its case).
- **A standing hold takes effect at once** in every list built from then on: the designate, rebind and Settings doors, the
  write-set before each Overlord renewal, the account readings, the ladder's load line and readiness. `accountOutsideSet` reads a
  held account outside the set (the hard row is due when another account serves).
- **Readiness raises one operator item per held lane** (its existing `hold` item, now fed), and reads `unmeasured`
  (`stranded: holds unread`) if the holds table cannot be read.
- **The Overlord's `installBehind`** now also reads a launch-profile digest that differs from the server's while the builds
  agree; under build skew it reads unmeasured.
- **The hold's window** (the plan's paragraph): the clear door exists, but no console control calls it until home C ships, so a
  hold stands until then or until the door is called by hand. A hold only narrows, and the never-empty arm keeps a list.

## Known limits

- **What the hold assumes about the harness** (the programme's design rule): it trusts the sandbox check's reading of one
  harness's configuration (Claude Code's). An extra tool, tool server, skill, agent type or SessionStart hook is read as the
  account's own load, because the launch profile pins the setting sources to the project, names the one tool server under the
  strict tool-server config, stages the workspace's only skills and file, and no project settings file can stand in the workspace
  (§3.6). An extra instruction file is the account's only when Claude Code types it `User` and it lies outside the workspace; a
  parent directory's `CLAUDE.md` never holds an account (another account would load it too). A missing load, the launch's own
  composition (profile digest, remote control, permission mode) and the workspace never hold one. If the workspace ever holds a
  skill or agent the profile does not stage, the hold would read it as the account's.
- The skills and agents properties read `unmeasured` for a Claude Code build whose own lists are not measured (today the release
  lists none), which keeps a start asked again each pass; a failure from the account's own hooks or tool servers still holds.
- The plan's question 8 (the cost of the reads per pass) was not measured on the fleet box: this piece adds one start-loads read
  per pass for the Overlord, and one holds read per pass in the readings, in readiness and per ladder read.
- The clear has no console control until home C (the hold's window above).
- **A start that fails the check during designate or rebind holds no account** (F3, `first-start-failure-writes-no-hold`): a
  retry is likely to pick the same account and fail the same way. The operator sees the refusal by name
  (`overlord-sandbox-unmet`) and can change the account set; the hold for a first start rides the next readings PR.
