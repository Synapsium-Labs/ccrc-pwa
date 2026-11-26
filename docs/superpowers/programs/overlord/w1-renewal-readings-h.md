# W1 renewal readings, PR H: the launch profile's account hold

Plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md`, Task 11 only, with its Global Constraints, Review
Focus 1, 2, 7 and 8, the PR split's row H, "The hold's window", the Cross-plan seams and open questions 5, 6 and 9 as ruled.
Spec `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.6. Built on `main` at `f97f102979`. No deviation number was
allocated for this run: departures are recorded by slug below, for the coordinator to fold into the ledger.

## What was built

A start of the Overlord that loads something from its account's own configuration that the launch profile does not list holds
that account out of the Overlord's ordered list until the operator clears it. A held account reads as outside the set, so the
existing hard row `account-outside-set` renews the Overlord off it (F7). A hold only narrows: it never empties a list and never
strands the Overlord.

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
  `holdOfStart` over it. `hold` writes; `settled` (a pass, or failures another account would not cure) stops asking for that
  start; `unmeasured` (no report yet, an unmeasured property, an unknown account) holds nothing and is asked again next pass
  (F10). The settled starts are a per-process memo (`GenerationsDeps.holdsSettled`, kept by the watcher). Nobody designated:
  nothing is read or written.
- **What the hold reads of the harness** lives in the sandbox check (`sandboxCheck.ts`), not in the hold's decider: each property
  verdict gains `fromAccount`, true only when the property failed because the start loaded something extra from the account's own
  configuration directory. `holdOfStart` reads only that flag.
- **The account readings**: `accountOutsideSetOf` takes the standing holds (read once a pass) in place of `'not-wired'`; a store
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
| `settled-starts-memo-in-the-watcher` | `GenerationsDeps.holdsSettled`, a memo the watcher keeps across passes, like `retried` and `emptyTries`; `watch.ts` grows by three lines. |
| `newest-start-verdict-in-the-sandbox-check` | `newestStartVerdict` (L1) beside `profileEngagedOf`, which it does not replace (the ladder's mutants pin `profileEngagedOf`'s text). |
| `hold-written-in-shadow-too` | The hold acts on no session, so the pass writes it in shadow and live alike; only the renewal it leads to waits for the `continuity` row. |
| `clear-door-no-step-up` | The clear asks no step-up: it widens back to the operator's own set, and the hold itself was never an authority grant. |

## Rules, and the case that goes red when each is broken

| Rule | Case |
|---|---|
| An unmeasured verdict holds nothing and is asked again | "a verdict that is unmeasured on the first pass ... holds on the next (F10)" and "an unmeasured property never holds an account, and the start is asked again each pass" (`continuity-renewal-holds.test.ts`); mutants H1, H3, H4 |
| A property the workspace loaded never holds an account | "a property the workspace loaded ... never holds an account (H2)"; the sandbox's `fromAccount` case; mutants H2, FA3, FA4 |
| A hold is written once per start | "a hold is written once per start" (`account-holds-route.test.ts`); "settled: the start is not asked again"; "a cleared hold is never put back by the same start" |
| Holds that would empty the list leave it as it was and report it | `heldOutOfList` L1 case; designation "holds that would empty the list leave it as it was, overridden"; mutants L1, L4 |
| An unread hold leaves the list unfiltered and marked, and the reading unmeasured | designation "unread holds leave the list unfiltered and marked unread"; wiring "holds that cannot be read leave the reading unmeasured"; readiness "holds that cannot be read reach the word as unmeasured"; mutants A16, A17, FA-H1 |
| A clear puts the account back | wiring "a clear puts the account back"; route "a clear puts the account back, records the actor" |
| The clear door is the operator's alone, session-gated, never the box token's, and records who cleared | route "with sign-in armed, no session is 401 at both, and the box token is no key to them", "... records the signed-in device, never flag-off", "with no actor port the clear records flag-off" |
| Build skew reads the install-behind reading unmeasured, never behind | "every combination" (`installBehindCases`); wiring "build skew reads the install-behind reading unmeasured"; mutants I1, I2 |
| With nobody designated, nothing is written | "nobody designated: nothing is read and nothing is written" |

## Mutation table

MUTATION_TABLE_PLACEHOLDER

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
