# Wave 8: team and workspace mapping (run 2862, D-8808, D-8809)

Spec `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md` §3.1 and §11.1; plan Wave 8, Tasks 8.1 to 8.6. This note
records what the wave built and every departure, for the coordinator to fold into the ledger.

## What was built

| Task | Built | Tests |
|---|---|---|
| 8.0 (move) | The team-link vocabulary (`TeamEvidence`, `TeamLinkSource`, `TeamLinkWire`, `TeamCandidateWire` and their guards and lists) moved from `shared/api.ts` to `shared/linking.ts`, pinned first by characterization tests. `shared/api.ts` gains one type-only import. | `linking-vocab-move`, the two L0 import pins |
| 8.1 | `project_linking.teamWorkspace`; the operator's write takes an optional `workspace`; `workspaceAfterWrite` (L1) decides what is stored; one resolver `routeProjectTeam` for the plan sync, the plan routes and the linking routes; the inbound owner rule takes the issue's workspace at all four key lookups (the fourth by fix round 1, F1); `team-unknown` worded on the card. | `linear-route`, `linking-routes`, `linking-policy`, `linking-store`, `linking-workspace`, `plan-sync` |
| 8.2 | The automatic pass reads teams as (workspace, key) pairs: a key in two workspaces is never merged, links only as one pair, and is otherwise offered once per workspace with its name. | `linking-team-link`, `linear-route` |
| 8.3 | A fixed read `attachmentsForUrl` (constructed fixture), the reader `readAttachedIssues` (L4, pass `team-link`), the pure tally and completeness rule in `teamLink.ts`, and evidence `pr-attachments` weighed beside ticket ids. Off: nothing wires the reader. | `linking-attached-issues`, `linking-attached-off`, `linking-team-link`, `linear-fixtures`, `linear-ops`, `linear-hierarchy-ops`, `rings/outward-edges` |
| 8.4 | `POST /api/linking/suggest` (box token, attribution) and `ccrc-api linking suggest`; suggestions stored in `teamSuggestions`, shown as `suggested` candidates, never linked, cleared when a key is set. | `linking-routes`, `linking-store`, `auth-gate`, `box-token-census`, `ccrc-api`, `ccrc-api-closed`, `mail-routes` |
| 8.5 | `POST /api/linking/confirm`, an Overlord door (act `link-team`, `full` only) through the one gate; the link and one big call under `linear-sync` in one transaction; `teamCallId` and `linkSourceOf`; a `link_team` row in the door process. | `linking-overlord-confirm`, `single-definition/team-link-source`, the Overlord ladder, door and gate censuses, `door-tools`, `door-tools-argv`, `door-process` |
| 8.6 | The project linking card: a workspace picker for a key two workspaces hold, candidates with workspace, evidence and source, an Overlord link shown as a call made for the operator. The skill section was carried (`w8-skill-section`, built by run 3238, below). | `project-linking-card` (unit and browser), `linking-words` |

## Departures (D-8808, D-8809)

The plan's "Deviations found" carries both entries in full. In short:

- **Storage.** One migration (slot 116 after the absorbs of main) holds three columns: `teamWorkspace`, `teamSuggestions` and `teamCallId`. The Overlord's link is
  stored as `teamSource` `auto` plus `teamCallId`, because migration 64's CHECK admits only `manual` and `auto`. Exactly one
  function, `linkSourceOf`, derives the wire's `overlord` source. `single-definition/team-link-source.test.ts` fails when
  a file of `shared/` or `server/src` other than `linkingStore.ts` and the migration that declares the column
  (`coord/schema.ts`) names `teamCallId` (review 3020 A-3), or when code outside `linkSourceOf`
  (and the migration's CHECK) compares `teamSource` to `'auto'` in one of the shapes it lists (=, <>, IN, IS, CASE, a
  switch case); an alias or a word built at run time is out of its reach (the coordinator's condition, mail of
  2026-11-20; review 2997 A2).
- **The write body's workspace (fix round 1, F4 and F2).** A key's workspace is set in the same write (spec §3.1.1). A named
  workspace must hold the key (`team-unknown`). With the workspace absent, the stored key sent back keeps the stored workspace
  without reading the store (review 2997 A5). Every other write with a key reads the store, an explicit `workspace: null` with
  the unchanged key included (the code is the rule, review 3020 F1): the one connected workspace that holds the key is stored,
  a key two hold is refused `team-ambiguous` (the card points at its picker), and a key none holds is stored with none. An
  unreadable Linear store is `unavailable`, never `team-unknown` and never stored as none. A cleared key, and the stored key
  sent back with the workspace absent, read no store (`writeReadsStore`); the shipped card never sends null, so only a direct
  API caller meets the null arm. A row stored with no workspace (before this wave's migration) whose key one connected
  workspace holds already resolves there, so Save of the unchanged key, with that workspace or none, keeps the stored none: the
  source, team name, evidence and time stay (the coordinator's ruling: no change of source). Another key or a workspace among
  two holders is still the operator's decision.
- **The Linear proxy is unchanged.** It knows the caller's identity, not its project.
- **Task 8.3 is off.** Its schema is an assumption until the live capture: `attachmentsForURL(url)` returning nodes of
  `issue { id identifier team { key } }`. A partial answer, where any workspace failed, is unmeasured.
- **The suggest door.**
  - The client takes a JSON body, not the spec's flags, because the identity is spliced from the pane.
  - The door writes only an existing row (`no-project` otherwise).
  - It refuses a reason that names any connected team's ticket id or carries line or bidi control characters.
  - It keeps the newest eight suggestions and answers only what the caller wrote.
  - Only a coordinator suggests (fix round 1, F7, the coordinator's ruling): the caller must claim an open run, decided by the
    role's own decider `claimsOpenRunOf` (`roleOf.ts`) over the open claimants `coord.openCoordinatorIds()` reads, the same
    fact the card and the sleep lane read (round 2, A4); none is `not-a-coordinator` (403, a new word: `not-coordinator` is
    already the digest's word, 409, with another meaning), and open claimants that cannot be read are `run-unreadable` (503),
    never a pass. A4 narrowed what refuses `run-unreadable`: the old gate read the caller's binding series, which refused a run
    row the box could not represent; `openCoordinatorIds()` parses no row, so only a thrown read refuses now, and a caller that
    claims such a row passes, as it does for every other reader of the role fact (review 3020 A-1). It checks no project
    ownership beyond that; the console shows who
    suggested. One suggestion per suggester, a resend replaces its own, and at most eight suggesters, the oldest by time
    evicted, never the one just written.
- **The confirm door.**
  - Its word is `overlord-v1`, so it lights later than the `continuity-v1` doors.
  - Its answer is the link and the call id only.
  - The call names the team and the workspace by display name, never by key. A suggestion's evidence reads "suggested by a
    coordinator, with the reason "…"" (fix round 1, F6): a call may be mirrored, so it names no session; the session stays on
    the card.
- **Final review fixes.** The team owner is decided in the inbound issue's workspace at every plan-routes site (the plan-map route
  and wave 7's migration lane since run 3027's `w8-migration-workspace`, below; review 2997 F1, F2), at all four
  key lookups of the inbound lane (fix round 1, F1: the close comment's public-text re-check was the fourth; D-8808 said
  three) and in `linearOwnerOfProject`; the suggest door and the confirm re-check the pair against the live Linear store and refuse
  `team-ambiguous` for a shared key with no workspace; a workspace-only change makes the link the operator's.
- **Delivery decides nothing new (fix round 1, F5).** When the write reads the Linear store (`writeReadsStore`) and the
  confirm's stored workspace name (`confirmedWorkspaceName`) are L1 deciders in `linking/policy.ts`; the triage row choice,
  the one stated bend, moved into `planPolicy.ts` with run 3155 (`w8-triage-l1`, below), so no bend remains.
- **The card.** Save waits for a workspace when the typed key is in two workspaces. A candidate row's React key names its
  evidence kind and suggester too, so one pair offered twice is two rows (fix round 1, A2).
  The picker offers the legacy key's workspace too while it routes like a slot (learned, not superseded): the workspaces
  answer's legacy row carries `workspace.workspaceId`, additive (an older server omits it and the picker leaves it out), read
  once in `wireReaders.ts` and merged by `pickerWorkspacesOf` (fix round 1, A1). The Overlord link's line opens its own
  call on the Waiting on you screen (run 3209, below); before that run it linked to the screen, because a call had no address.

## Carried (follow-up tickets in the `mapping` epic)

- `w8-migration-workspace`: built by run 3027 (below).
- `w8-attached-wire`: wire `readAttachedIssues` and the merged pull request URLs into the lane after the operator's go for one
  live capture; update `linking-attached-off.test.ts` deliberately in that commit.
- `w8-readme-count`: resolved in this PR. README.md's machine-lane count word moved to the census-derived count ("ninety-six" after the absorbs) for the two new doors,
  by the packet the README's holding run approved; the ticket can close with the PR.
- `w8-overlord-skill`: built by run 3251 (below). The Overlord skill's door table gains `link team`, and says what it does below `full`.
- `w8-confirm-unmeasured`: built by run 3279 (below). The Overlord's confirm route answered `team-unknown` for an
  unreadable slot or no connected workspace. The operator's write answered `team-unknown` there only when it named a
  workspace; with none named it stored the key with no workspace. Found by review 3253 F1 on run 3251, corrected by reviews
  3261 F1 and 3266 F4.
- `w8-suggest-pair-last`: built by run 3264 (below). The client puts the pane's pair last on the linking suggest and
  confirm doors and on the call record.
- `w8-call-anchor`: built by run 3209 (below).
- `w8-triage-l1`: built by run 3155 (below). It moved the triage row choice (`triageOf`, `teamHolders` in `planRoutes.ts`)
  into `planPolicy.ts` beside `triageVerdict`, reusing `teamOwnerProject`'s holder predicate. It had stayed in the route because
  `planPolicy.ts` was held by another wave; D-8808 stated it as a bend.
- `w8-skill-section`: built by run 3238 (below). The coordinator skill's plan reference gained its `## linking suggest`
  section after `## plan take`, in a PR of its own: the review judge refuses a PR that changes a rules file and anything else
  (`rules-mixed`), so wave 8's PR left it.
- `w8-folded-pin`: built by run 3230 (#3172, below).

## For the merge

Done: wave 7's `locked` state reached the card, and this wave's picker and candidate controls take `disabled={locked}`
(`locked = busy || listBusy`), pinned by review 2997 A1's two tests (review 3020 A-2). Several branches move the same counts
(the migration slot, `ccrc-api` rows, `auth-gate` routes, box-token lanes, door-tools rows): whoever lands second recounts.

## Run 3027 (`w8-migration-workspace`): what was built

The follow-up the final review named (review 2997 F1, F2), built with wave 7's `w7-race` in one pull request because both edit
`server/src/linear/migration.ts`. Every team lookup the migration makes now goes through the project row's workspace, through
the one resolver `routeProjectTeam`; none falls back to the first workspace holding the key, and a key two workspaces hold with
no workspace on the row is refused `team-ambiguous` (409), as the rest of the hierarchy refuses it.

| Lookup | Built | Test |
|---|---|---|
| Start ("Reshape in Linear") | `workspaceOfProject` routes the row's key and workspace. `start` returns a routing refusal before checking migration state; otherwise it inserts the migration in that workspace and decides its owning project there with `teamOwnerProject` | `migration-workspace.test.ts`: each project starts in its own workspace; an unpinned shared key is `team-ambiguous` even when another workspace has a proposing or applied migration; a project without a key still reads `no-team-key` |
| The open-issue read | `readOpen` uses the migration's own workspace's slot from the snapshot that authorized the read | Fixtures pin the workspace, slot, and snapshot; the route passes its actual read result to the proposal inside the mutex |
| The Linear owner | `ownerOf` passes the workspace and routing facts to `linearOwnerOfTeam`: the map mail, the map's owner check and the Return mail. Return cannot settle without a concrete recipient | `migration-workspace.test.ts` checks the workspace's recipient and proposer; `migration-propose.test.ts` checks the intact map and item on refusal and delivery of the note on retry |
| The plan-map route | The pure `mapProposerVerdict` judges the caller in each waiting workspace. With nothing waiting, an owner learns `plan-bad-body` and anyone else `not-linear-owner`; two owned waiting workspaces answer `team-ambiguous` without reading issues. Unmeasured ownership also blocks the read | The policy and route fixtures pin owner scope, the selected read, the no-wait diagnostic and the refusal words. Filtering out **stored** null holders made the no-wait diagnostic test fail; removing the unused zero-holder `[null]` fallback did not |
| The console's state | `stateOfProject` through the pure `migrationOfProject`: a pinned row reads its workspace's migrations without needing routing facts; an unpinned row uses the request's shared routing snapshot, a shared key showing "Not migrated" and a row that cannot be measured (an unreadable slot, no listing at all, a pinned row outranked by an unpinned holder whose routing cannot be read, or a pinned row whose own workspace cannot be measured) showing "Not measured" with no Reshape (run 3082). A key no slot serves matches by key alone only while all its migrations sit in one workspace | ten `stateOfProject` cases: four for the row's own workspace and six for the unmeasured state (run 3082) |
| Programme matches | The declare mails, `finishApply`'s declared programmes and the map's epic and leaf team checks (`MapContext.sameWorkspace`) ask `projectOnTeam` (L1): key and workspace | Two-workspace regressions reject both wrong-workspace epic and leaf placements, send declare mail only to the matching workspace's programme, and leave the other workspace's `planRequired` unchanged |

The inbound and migration lanes share `teamOwnerProject`'s owner rule. It uses the same workspace resolver as
`projectOnTeam`: a pinned project belongs to its stored workspace; an unpinned one belongs only to the workspace its
key resolves to, and to neither when that key is shared. The two-workspace regression shows
that a lower-order unpinned project cannot take the pinned project's migration, map mail, or inbound issue. The key-only
owner lookup used when no map waits can supply a diagnostic, not permission to read or store a map. A Name a Linear owner
item does not settle on a project fallback while its issues wait for routing (`plan-inbound.test.ts`).

Fix round 1 also passes measured routing to the hierarchy owner display, the drift Hand fallback, and Upkeep sync mail. The
hierarchy and drift doors read it outside the mutex; Upkeep reuses the snapshot that routed its pass. The tests in
`hierarchy-routes.test.ts`, `drift-pass.test.ts` and `plan-sync.test.ts` each show that the lower-order unpinned holder wins
when its key does resolve uniquely to the pinned row's workspace.

**Fix round 2 (review 3048).** The rule distinguishes an owner, measured none, and an unmeasured decision. A listed
slot with an unreadable, missing, or stale team record for its configured key does not count as a measured empty
workspace. Close and Raise refuse `unreachable` before a re-read or write. Inbound waiting and answered mail and close
notices cannot stamp or send to a substitute; key refusal still sets its retry hold. Take Return refuses before effects,
and a handed issue or bound Upkeep ticket stays put when its destination workspace is unmeasured. Drift Hand refuses when it needs an unmeasured owner;
the hierarchy card says the owner could not be measured, and Upkeep does not send a substitute notice. The project
fallback belongs to measured none only. Map Return preserves the item and stored map on `unreachable`, `team-ambiguous`
or `no-linear-owner`, pairing a successful settlement with its recipient mail in one transaction. Apply completion retries
if needed to classify an unnamed declared programme rather than omitting it. The ownerless ambiguous inbound issue
waits and counts in the console; since run 3187 (`w8-ambiguous-notice`, below) it raises the shared-key item.

## Run 3082 (`w8-pilot-guards`): what was built

The rulings on review 3073, built before the pilot team's migration starts from the console. Every fix has a test seen red
first; each guard below was removed alone and its test went red.

| Item | Built | Test |
|---|---|---|
| F1, the console state | The hierarchy state gains the word `unmeasured`, decided in the pure `hierarchyStateOfRow` (`migrationPolicy.ts`) from two measurements, each the one its reader makes: the row's own workspace (`measuredProjectTeam` with the row's pin, the measurement Reshape's `workspaceOfProject` makes) and its team owner (`teamOwnerUnmeasured` in `planPolicy.ts`, the pick the card's owner line reads). A row either cannot measure says "Not measured", never "Not migrated", and Reshape is not offered for it. That is an unpinned row whose routing cannot be read (an unreadable slot, or no listing at all); from the final review, a pinned row outranked by such a row; and from review 3087 F1, a pinned row whose own slot cannot be read or whose listing failed, even with a migration stored (Reshape refuses both `unreachable`; the guard has no top-row condition, though its tests use a top row: review 3096 F1, words fixed by run 3102). There the owner line still names the owner, measured by F8, beside "Not measured" for the state. A row with no key is unchanged. Reshape's `unreachable` sentence now names both causes: no readable key serves the team, or its owner could not be measured | `migration-workspace.test.ts`, each case making ONE workspace's team record unreadable or failing the whole listing: an unpinned row with one unreadable slot record, and with no listing, shows `unmeasured` although a migration exists; so does a pinned row outranked by an unpinned holder while only the OTHER workspace's record is unreadable (red alone without the owner arm); a pinned top row with its own record unreadable and no migration, and one with no listing even with a migration, show `unmeasured` (red before review 3087's fix); a pinned top row whose other workspace is unreadable still shows its migration. `linking-words.test.ts`: "Not measured", and no Reshape; `project-linking-card.test.tsx` draws no Reshape control for it |
| F8, one owner answer | `teamOwnerProject`: a holder pinned to the workspace that outranks every row naming the key there, pinned or not, is the owner whatever the routing, so a failed listing and an unreadable slot answer alike; the answer is unmeasured only when an unpinned row outranks it and that row's routing cannot be read. One case moves with it: an unpinned top row whose key two readable workspaces hold joins neither (its routing is measured), so a pinned holder in an unreadable third workspace now owns there | `plan-policy.test.ts` pins both shapes. `plan-inbound.test.ts`: the triage test of an unreadable workspace whose pinned top holder is the caller now answers 200 `raised`, opens one decide item and makes no Linear call; it used to answer `unreachable` |
| F11 | `ownerItemReady` keeps its live-owner check | `plan-policy.test.ts`: an owner item does not settle while the workspace-qualified owner is not live |
| F2 | The close step's unmeasured return | `plan-inbound.test.ts`: the by-id read measured, the owner unmeasured: no comment, no cancel, `actedAt` stays null |
| F3 | `mailForMap`'s unmeasured return | `migration-propose.test.ts`: an unreadable slot record: no map mail and no Name a Linear owner item (the item is the line that goes red; the mail alone does not tell the two apart in that fixture) |
| F4 | Both lookup terms of `triageOf` stay and each is pinned. The unreadable-workspace term: an unpinned top holder, its row in the unreadable workspace beside a readable second one holding the key, answers 503 `unreachable` (without the term, 409 `issue-not-inbound`). The pin-unmeasured term is reachable only through an unreadable legacy slot whose workspace no file slot carries; it is not dead | `plan-inbound.test.ts`, with a `legacy-unreadable` store mode in its rig |
| F10 | `workspaces()` reads the store whenever the coordination store exists, even for an empty project set | `plan-inbound.test.ts`: `plan take` Close of a handed row for a programme with no home and no epics, with a readable store, answered 503 `unreachable` before and 200 now; the plan routes now read the store once for such a write too |
| F5, F6, the console words | `linearItemErrorText(err, act)` (`refusalWords.ts`) takes the act the controls sent: Return says its own sentence for `no-linear-owner` and `team-ambiguous` (the map and the note are kept, and why), and `unreachable` says "The Linear owner could not be measured, so nothing was changed. Try again." on Hand and Return alike. Hand's `no-linear-owner` sentence is unchanged. No new wire word | `linear-item-controls.test.tsx`: each word on Return and Hand, and the note kept after a Return refusal |

**Recorded, not changed.** F7: the close step re-reads a closed, unacted row by id before it decides ownership, so while
routing stays unmeasured it spends one governed read per such row a beat and makes no progress. That is accepted as this
lane's retry pattern: the read is rate-governed, and reading first keeps the retire outcome for a row that left the managed
teams. F9: `plan take` refuses `unreachable` for Close as well as Return when the handed row's owner cannot be measured; it is
recorded in D-8808.

## Run 3155 (`w8-triage-l1`): what was built

A behaviour-preserving move: no answer any caller of `plan triage` sees changed. D-8808's bend sentence now records the move.

| Step | Built | Test |
|---|---|---|
| Characterization first | Route-level pins of today's triage answers, green against the old code in their own commit: one workspace (the owner's raise, another caller's `not-linear-owner`, `issue-not-inbound` for a row no longer waiting and for an identifier with no row), a shared key with both holders pinned (each caller's own row is chosen, even when it is not the first found), a shared key with an unpinned holder (the marked unpinned holder owns in neither workspace, per F8 above, so its triage is `not-linear-owner` while the pinned holder's is taken), an unreadable store (`unreachable` for a possible owner, `not-linear-owner` for anyone else) and a team no project holds (`not-linear-owner` for the one caller the pin runs; the same answer with a row found or not, so this pins the answer only). The two lookup terms (F4 above) were already pinned | `plan-inbound.test.ts`, the describe headed D-8808 (`w8-triage-l1`); every case asserts the status and word, which row moved, that every other row is unchanged, and no Linear write |
| The move | `planPolicy.ts#triageLookup` answers the workspaces whose row the route reads, or `[null]` for the identifier unique across workspaces; `planPolicy.ts#triageChoice` picks the row (the caller's owner row, else one the caller may own while ownership is unmeasured, else the first, else the key-only diagnostic). Both use the policy's one holder predicate, `teamHolders`, now exported; the route's `plan map-propose` reads it too, in place of its own copy of the predicate. The route's `triageOf` reads the rows and the inbound rows and acts on the answer; it decides nothing. The move commit changes no test | the pins above, unchanged and green |
| `teamHolders` | The route-local copy is removed; `teamDoor` reads the policy's for the projects whose workspaces it loads | as above |
| Unit pins | The two deciders' cases as pure functions. Each preference step was removed alone and a pin went red: the caller's owner row at the route and in a unit pin, the row the caller may own while ownership is unmeasured in a unit pin only (no route pin reaches it). The order of those two steps is pinned by `an owned row beats an earlier unmeasured one`, red when they are swapped (fix round 1). The `[null]` answer changed to `[]` reds three unit pins and six route pins, two of them in the describe headed D-8808 (review 3180 F1) | `plan-policy.test.ts`, describe `triageLookup and triageChoice` |

**Fix round 1 (review 3172).** F1: the order pin gave the earlier unmeasured row a possible owner other than the caller, so
swapping the owner and unmeasured steps left it green; project-b's named owner is now the caller, and the swap reds it. F2:
D-8808's follow-up list moves `w8-triage-l1` to its built clause. F3: a route pin now separates the identifier lookup across
workspaces from the key-only path: one unpinned holder whose key two readable workspaces hold resolves to no workspace, the
lookup finds its row, and the row's workspace has no owner (403 `not-linear-owner`); with `[null]` changed to `[]` the key-only
owner is told the issue is not inbound (409). It passes against the code before the move. The pin for a team no project holds
is named for the answer it pins. A1: the shared-key pin's label reaches its case name.

## Run 3187 (`w8-ambiguous-notice`): what was built

Review 3048 F5 asked whether an issue should wait with no word to anyone when its team key's only holders are rows naming no
workspace and two connected workspaces hold the key. It now raises an item; D-8808 records the departure.

| Step | Built | Test |
|---|---|---|
| The decision | `planPolicy.ts#sharedKeyItemVerdict` reads the route step's owner verdicts for the waiting issues: it raises each key measured `team-ambiguous` (upper-case, once) that no open item carries, and settles an open item when no waiting issue of its key is ambiguous or unmeasured, and only when the Linear store could be listed (an unreadable slot with nothing waiting does not hold it: a new ambiguous issue raises it again). `sharedKeyProjects` names the rows holding the key that name no workspace | `plan-policy.test.ts`, describe `the shared-key item decision`; removing the read-routing guard reds a unit pin and a lane pin |
| The lane | The route step collects each waiting issue's verdict, raises with `coord.raiseItem` and settles with `coord.moveItem`, as it does the owner item; no new notifier | `plan-inbound.test.ts`, the describe headed `a team key two workspaces hold`: one item for two issues in two workspaces over two beats, no owner item and no mail; settled when the row is pinned and the issue is mailed; held open while the store cannot be listed even with nothing waiting; nothing raised on an unread store or an unread second workspace; nothing for a key one workspace holds. Without the lane change the first three go red |
| The item kind | A new `ItemAction` verb, `linear-team-workspace` `{ teamKey }`, with no acts (the coordinator's ruling on the departure question, run 3187: a new verb rather than a reason on `linear-owner`, whose Name control does not fix this shape, or a prose-keyed item). The settings path is `LINEAR_PROJECTS_SETTINGS_PATH` in `shared/ledgers.ts`, beside the verb | `plan-vocabulary.test.ts`: the verb parses, a missing or empty key does not, and a verb the build does not know reads as no action |
| The console | `LinearItemControls` draws the step's sentence and a link to Settings, Security, on the item page and on a Waiting row; an act sent anyway is `item-act-mismatch` at the route. A console that does not know a verb draws no controls and shows the item plain | `linear-item-controls.test.tsx`, describe `the shared-key item`: the sentence, the link and its route, no button, the row, and an unknown verb drawn plain |

Review (the per-task reviewer's five minors, all taken): the settings path is defined once, in `shared/ledgers.ts`, and the
console's `LINEAR_SETTINGS_PATH` is that constant; the plan's follow-up list moves `w8-ambiguous-notice` to its built clause;
the item's how line no longer promises a mail or an ask on every close; this note and D-8808 say "cannot be listed" for the
settle guard; D-8808 says what a rollback leaves.

**Fix round 1 (review 3196).** F1: the console's sentence said the item closes once the team's waiting issues route,
which is untrue when the chosen project's owner is gone (the issues then wait on a Name a Linear owner item while this one
settles); it now says the item closes once no waiting issue of the team depends on the workspace choice, as the server's how
line does, in `migrationWords.ts`, its pinned test and the verb's comment. F2: `single-definition/plan.test.ts` pins the
settings path to its one declaration in `shared/ledgers.ts`, forbids a literal `LINEAR_SETTINGS_PATH`, and lists every literal
spelling of the page (the shared constant and the two sign-in links, which name Security for passkeys); a second literal
copy, measured by restoring the console's old one, reds it. D-8808 says the item was built before the pilot, at the
coordinator's call.

The test typecheck (`test/tsconfig.tests.json`) was killed by the test slice's memory cap here; CI's run on the tip checks it.

## Run 3209 (`w8-call-anchor`): what was built

A call made for the operator has an address on the Waiting on you screen, and the project card's line for an Overlord link
opens that call, open and marked, ready for Seen or Overturn…. No wire change: the card already received the link's call id
(`TeamLinkWire`'s `overlord` arm, D-8809).

| Step | Built | Test |
|---|---|---|
| The address | `/waiting?call=<id>`, built by `callPath` and read by `callParamOf` beside `waitingPath` in `pwa/src/lib/routes.ts`. An item's address is a route of its own (`/waiting/<id>`) because an item has a page; a call has none, only a place in the list, so its address is a query on the list's route, as the side rail's filter is (`?programme=`). It is in the URL, so a reload and a cold start keep it; changing the filter drops it. The id takes a run id's grammar (`isRunId`) | `waiting-routes.test.tsx`: the path is the list's route and reads back; `0`, a leading zero, a sign, letters, an absent query and one past the safe integers name no call |
| Where it lands | `callTargetOf` (`callWords.ts`, L1) answers from the list the screen draws: the waiting view, the page clock and the side rail's filter. `open`: the call is still to see and the filter shows its programme; that programme's "Calls made for you" opens once per address (a ref and an effect, so a Seen that takes the call away does not fold the group), and the call is marked (`aria-current`) and scrolled to. `cleared`: the call is in the Recently cleared trail's own window (`clearedTrail` decides it, the one 48-hour rule) and the filter shows its programme; a one-line notice, and the trail's entry marked and scrolled to. When the entry lies past the newest rows shown, the trail expands and opens its programme's group (`clearedCallPlace`, L1), adjusting its state during render and only ever expanding, so the operator's Show all and open groups survive the target's place changing. The notice never outlives the row (review 3222's ruling): Show all opens the target's programme group (`clearedOpenOnShowAll`), and the folded trail draws the target's row after the shown rows when it lies past them (`clearedFolded`), both L1 in `ledgerWords.ts`; an operator who collapses the target's group by hand closes the row themselves. `hidden`: the filter in the same URL hides the call's programme, open or cleared; one line says so and nothing is marked (`callFilterShows` is the one predicate the target, `callsApartOf` and `clearedCallsOf` all ask). `gone`: the call cleared outside the window, or, on a live list, is on neither list; one line says it has cleared and is no longer on this list. `unheard`: the VIEW is the device's saved list (`listSaved`, set by the route from the `saved-list` source only; `saved-rows` draws the live view) and holds no such call; one line says it shows once the list is current, never that it cleared. The page scrolls once per address, across the group and the trail (a ref on the screen), so a Seen on the call, re-opening its trail group, or its programme gaining rows (a calls-only section redrawn as a group with rows, a new `CallsGroup`) never scrolls the operator away (review 3217's rulings). A malformed `?call=` names no call: the plain list, with no notice. The notice is the screen's status line (`wl-note`, `role="status"`) and the mark is the console's existing marked-row ring (one rule in `ledgers.css`) | `call-words.test.ts`: every answer, a clear outside the window, the filter; `waiting-screen.test.tsx`, describe `calls made for you (D-8126)`: open, apart, cleared, cleared past the shown rows in a grouped trail, outside the window, hidden open and hidden cleared, gone, unheard on a saved list, the trail following a call that arrives later and keeping the operator's choices when the target moves past the shown rows and back, Show all and Show fewer keeping the target's row drawn, one scroll per address through a Seen, a re-opened group and a calls-only programme gaining a row; and a pin, which also passes on round 1's code because `CallsGroup`'s effect already depended on the target, that a mounted group gaining the call opens and marks it (review 3222 A-iv); `waiting-routes.test.tsx`: the URL alone opens and marks it, also when the list arrives after the page, a live view with the device's rows says gone, not unheard, and a saved list says unheard (the route's `listSaved` arm, review 3222 F1) |
| The card | `overlordCallLink` (`linkingWords.ts`, L1): with a readable call id the line reads "Open this call in Calls made for you" and links to `callPath`; without one (absence permits) it keeps "See it in Calls made for you" and the screen | `linking-words.test.ts`; `project-linking-card.test.tsx`: the id present and absent |

**The folded trail's pin (run 3230, `w8-folded-pin`; review 3225 F1).** `clearedFolded`'s `place.beyond` check, which keeps the
folded trail from drawing the addressed call a second time when it is already among the shown rows, had no test: with it
deleted every suite stayed green and the trail held the call twice under one React key. The A-i shown-target test in
`waiting-screen.test.tsx` ("Show all with a shown target keeps its row drawn and marked") now asserts, before its Show all click,
that the call's cleared row is drawn exactly once. Measured: with the check deleted it reds (`expected 2 to be 1`), and it passes
on the committed code. A test only; no code and no ledger entry change (D-8809).

## Run 3238 (`w8-skill-section`): what was built

`ccd/coordinator-skill/references/plan.md` gains `## linking suggest` after `## plan take`: the text this note carried from
Task 8.6 and the final fixes, checked sentence by sentence against the suggest door (`POST /api/linking/suggest` in
`server/src/linking/routes.ts`, its deciders `parseTeamSuggestion`, `suggesterVerdict`, `teamPairVerdict` and
`suggestionReasonVerdict` in `linking/policy.ts`, the store's `recordTeamSuggestion`) and the client's `linking.suggest` row.
The changes, each where the code says more than the carried text did (round 1 and its fix rounds, reviews 3242 and 3245):

| Change | The code it follows |
|---|---|
| Added: "Each session keeps one suggestion per project: sending again replaces your earlier one." | `recordTeamSuggestion` keeps one element per suggesting session (a resend replaces it) |
| Added: a project keeps at most eight suggestions, so one can drop off when other sessions suggest, and setting the key clears them all (review 3242 A1) | `TEAM_SUGGESTIONS_MAX` and its eviction of the oldest of the other sessions' suggestions in `recordTeamSuggestion`; a key write clears the cell (`setLinking`, and the automatic and Overlord links) |
| Added the refusal `unavailable` (the Linear store could not be read: try again later) | the route refuses `unavailable` when the Linear store is not listed, before the pair is checked |
| Added the refusal `write-failed` (the store write failed: try once more, then tell the operator; review 3242 F1) | the route refuses `write-failed` when the store write throws |
| `bad-request`: "a body that is not exactly these keys, or a reason over its length" became a body with another key, or a field missing or malformed (the project, the team key, a `workspace` present but not a Linear id, a reason that is empty, over 280 characters (an emoji counts as two) or not one plain line; the detail names the field), and `workspace` is said to be optional (review 3242 A2, 3245 A1) | `parseTeamSuggestion` checks each field in turn and names the one it refuses; `TEAM_SUGGESTION_WHY_MAX` is 280, compared with the string's length, which counts an emoji as two |
| The example drops its `"workspace":"<id, optional>"` placeholder, which copied as written is refused, so it can be sent as it stands (review 3242 A3) | `parseTeamSuggestion` refuses a `workspace` that is present but not a Linear id |

The section names the suggest door's own refusal words, as `## plan take` does for its door (the coordinator's ruling on
review 3242 F1). The other words a suggestion can meet (review 3245 F1): the attribution and token words the
door passes through (`stale-uuid`, `unknown-sender`, `registry-unmeasurable`, `unauthenticated`) are the ones
`references/api.md` lists for the mail routes, with the `stale-uuid` remedy in `SKILL.md`; `no-body` and `bad-body` are the
client's own, and the section's identity sentence describes `bad-body`'s cause. No pin checks either.

`'linking.suggest'` joined the executable-corpus list of `server/test/ccrc-api-closed.test.ts`, a census that maps the
section's client command to a row of the client's route table (it does not run the example). `server/test/coordinator-plan-reference.test.ts`
pins, inside the section, who may suggest, one suggestion each, the identity the client fills, the candidate rule and the
suggest door's own refusal words, from a list kept by hand (it reads the section, never the route, so it cannot see a word the
door gains). It parses the example as written, with the client's pair added, and with a workspace added. Measured: against
`plan.md` without the section all seven new cases and the corpus list are red; with it they pass; the word pin is red against
the section without `write-failed`. A rules file and the tests that pin it, landed as one PR, as ruled for #3151, #3155 and
#3163. No code change and no new deviation number (D-8808, D-8809).

## Run 3251 (`w8-overlord-skill`): what was built

The Overlord skill's `starting.md` gains a `link team` door row and one paragraph, each sentence checked against the code it follows:

| Change | The code it follows |
|---|---|
| The door row `link team`, with the word `overlord-v1` | `OVERLORD_DOORS['link-team'].word` in `overlordDoors.ts` |
| The rung sentence: `full` may confirm, `chat` and `advise` get `rung-below` and leave the candidate for the Project linking card | `RUNG_CELLS['link-team']` (`refuse`, `refuse`, `allow`); a refused cell is the gate's `rung-below` |
| Each door refusal: `team-set`, `team-unknown`, `team-ambiguous`, `no-project`, `unavailable`, `write-failed` | the confirm route's refusals in `linking/routes.ts`; `team-unknown` is its candidate check's and, with `team-ambiguous`, the live check's, from `teamPairVerdict` through `pair.error` |
| `DOOR_ONLY_TOOLS` loses `link_team` | `door-tools.test.ts` demands a tool in the skill's table is not in that list |
| The pin's `OUTSIDE_SPEC` carve-out for `link team`: its word is read from `OVERLORD_DOORS`, not the spec | Table 11.1e has no link door |

Measured: with the row and paragraph in place and the `link_team` entry kept, `door-tools.test.ts` is red on "drop it from
`DOOR_ONLY_TOOLS`" and green after the deletion. Removing the row, removing the paragraph, changing the row's word and deleting
`team-ambiguous` from the paragraph each turn the matching pin red, and restoring turns it green. A rules file and the index
entry and pins that hold it in step, landed as one PR, as ruled for #3151, #3155, #3163 and #3174. No new deviation number
(D-8808, D-8809).

The refusal pin reads the confirm route through `scan/symbols.ts` (parsed calls of `registerLinkingRoutes`, and
`teamPairVerdict`'s declared error words for `pair.error`): the first push read the files as text, and the single-definition
ratchet (ARCH-06) refused it in CI. Fix round 1 (review 3253, as the coordinator ruled):

- F1: the `team-unknown` sentence now says what the route measures. The pair is not a current candidate, or is not held in
  a workspace the door could read now. The route folds an unreadable slot, or no connected workspace, into that word. So
  the Overlord leaves the candidate on the card for the operator, names it in its brief and does not retry it in a loop.
  Making the route answer `unavailable` when the pair is unmeasured is the follow-up `w8-confirm-unmeasured`.
- F2: the rung pin is exact. `full` alone allows, and no refused rung is named in the paragraph's first sentence. Measured:
  narrowing `full` to `refuse` turns it red.
- A1: a `refuseRoute` whose word the pin cannot read, anything but a literal or `pair.error`, fails the pin. Measured: a
  variable word turns it red.
- A2: the paragraph's listed refusals, each a word before a colon, must equal the door's. Measured: an invented `team-gone`
  turns it red.
- A3: the carve-out's `toThrow` expects the no-row message.

The remedies are not pinned word for word, as before.

Fix round 2 (review 3260, as the coordinator ruled):

- F1: the carve-out's guard now fires when the spec gains the door under its kebab spelling. `waveOf` tries `link-team` for
  `link team` before it throws. Measured: a `link-team` row added to Table 11.1e turns the guard red; the spec as it stands
  is green.
- A1: `team-unknown` is split by its two causes, which the refusal's detail names. A pair that is not a current candidate
  leaves nothing to confirm, so the Overlord drops it. A pair not held in a workspace the door could read keeps the earlier
  remedy.
- A2: the rung pin is exact on the words' side too: no sentence that says the Overlord may confirm names a refused rung.
  Measured: appending "At `chat` or `advise` you may confirm too." turns it red.
- A3: `w8-confirm-unmeasured` is carried above and in D-8808's follow-up list, as open.

## Run 3264 (`w8-suggest-pair-last`): what was built

Review 3245 A2 of #3174 measured it: on `linking.suggest` and `linking.confirm`, `ccd/ccrc-api` refused a body naming `byId`
or `byUuid` by a text match, then spliced the pane's pair in FIRST with `splice_body_field`. A key the text match misses (a
JSON escape such as `"by\u0049d"`) passed, and the server's JSON parse, which keeps the later of two duplicate keys, then
kept the body's value, not the pane's. The `calls.record` door, whose rule the linking doors follow, had the same shape. The
server still checks the registry's uuid for the named id, so this was defence in depth, not a measured spoof.

- The three doors now call `append_body_field`, `byId` then `byUuid`, as the note, goals, probe and remaining-work doors do
  (review 2039 F7), and their comments say why. The text refusal of a plain `byId` or `byUuid` key stays, and the body the
  server reads is otherwise unchanged.
- `server/test/ccrc-api.test.ts` gains one case per door: a body with escaped `byId` and `byUuid` keys reaches the server
  with the pane's pair as the last two keys, and a plain body arrives as itself with the pair appended. Measured red on
  `main` on all three doors (the parsed `byId` was the forged one), green with the change.
- `server/test/ccrc-api-closed.test.ts`'s append-last census lists the three doors, and its refusal-and-order check covers
  them beside the remaining-work door.

`runs review-rounds` still splices its identity in first. That is safe there, and not the review 3245 A2 gap: its refusal
is structural, because `jq` parses the body and refuses every `byId` or `byUuid` key at any depth, case-folded.

Fix round 1 (review 3266, as the coordinator ruled):

- F1: `ccrc-api-closed.test.ts`'s call record and note door assertions still named `splice_body_field`, and passed only by
  matching the `runs.review-rounds` block later in the file. Each slice now ends at its own block's closing `fi` and asserts
  the refusal, no splice, and `append_body_field` for `byId` before `byUuid`. Measured: each door reverted to
  `splice_body_field` turns its assertion red; restored, it passes.
- F2: the call record's comment no longer says the server refuses an escaped key (`bad-field`): a `\u`-escaped spelling
  passes the text test and is outranked by the appended pair at the server's parse.
- F3: the `runs review-rounds` sentence above says why its splice-first order is safe.
- F4: the `w8-confirm-unmeasured` entry is exact about the operator's write, which answers `team-unknown` only when it names
  a workspace. A store with no slot measures `not-configured`, which today's verdict folds into `team-unknown`, so the
  measured resolver alone would not tell the operator that no workspace is connected.

Fix round 2 (review 3271, as the coordinator ruled):

- F1: fix round 1's comment and note sentence said a nested key passes the text test too. It does not: the test is a
  substring match over the whitespace-stripped body, so a nested or a whitespace-padded `byId` or `byUuid` key matches and
  is refused (`bad-body`); only a `\u`-escaped spelling passes. The comment says so, and says how this door differs from the
  `byId` fill, where the same match suppresses the fill instead of refusing.
- F2: the probe answer's slice ends at its own block's closing `fi` too, through the same helper, so the `programme.remaining`
  block can no longer satisfy it. Measured: the probe door reverted to `splice_body_field` turns its assertion red; restored,
  it passes.

## Run 3279 (`w8-confirm-unmeasured`): what was built

The three team doors resolve a (key, workspace) pair through the measured resolver (`measuredTeamRoutes`,
`measuredProjectTeam`), as the plan, migration and triage paths already did, so an unreadable slot is no longer read as a
slot with no teams.

- `teamPairVerdict` (`server/src/linking/policy.ts`) takes the measured answer: `unavailable` when a slot the answer depends
  on could not be read, `not-configured` (the router's existing word, 501) when no Linear workspace is connected,
  `team-ambiguous` as before, and `team-unknown` only when every workspace was read and none holds the pair. Each refusal
  carries its fixed detail, decided there. `measuredPairRoute` beside `PairRoute` hands the operator's write the same
  measured route; `workspaceAfterWrite` itself is unchanged.
- The suggest and confirm doors answer `unavailable` for an unread workspace and `not-configured` for none. The operator's
  write answers `unavailable` when a slot the answer depends on cannot be read (it stored the key with none, or with the one
  readable holder, before). With no workspace connected it keeps its answers, as the coordinator ruled: a named workspace is
  `team-unknown`, and with none named the key is stored with none, because the console has no sentence for `not-configured`
  on that write.
- An intended change on all three doors: a key one readable slot holds, while another slot is unreadable and no workspace is
  named, answers `unavailable`, because the unread slot could hold it too (the measured resolver's fail-closed reading).
- Characterization pins (`linking-routes.test.ts` for the write and the suggestion, `linking-overlord-confirm.test.ts` for
  the confirm) were green on `main` first; each door's changed cells moved in that door's own commit and were measured red
  before it.
- The Overlord skill's team candidate paragraph and the coordinator plan reference's `## linking suggest` say what each word
  now means: `unavailable`, try once more later, then tell the operator; `not-configured`, do not retry, tell the operator
  that no Linear workspace is connected. Their pins name `not-configured` beside the other words.
