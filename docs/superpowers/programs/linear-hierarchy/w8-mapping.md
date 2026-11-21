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
| 8.6 | The project linking card: a workspace picker for a key two workspaces hold, candidates with workspace, evidence and source, an Overlord link shown as a call made for the operator. The skill section is carried (`w8-skill-section`, below). | `project-linking-card` (unit and browser), `linking-words` |

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
  confirm's stored workspace name (`confirmedWorkspaceName`) are L1 deciders in `linking/policy.ts`; the triage row choice
  (`w8-triage-l1`) stays the one stated bend.
- **The card.** Save waits for a workspace when the typed key is in two workspaces. A candidate row's React key names its
  evidence kind and suggester too, so one pair offered twice is two rows (fix round 1, A2).
  The picker offers the legacy key's workspace too while it routes like a slot (learned, not superseded): the workspaces
  answer's legacy row carries `workspace.workspaceId`, additive (an older server omits it and the picker leaves it out), read
  once in `wireReaders.ts` and merged by `pickerWorkspacesOf` (fix round 1, A1). The Overlord link's line links to the
  Waiting on you screen, because a call cannot be addressed by id.

## Carried (follow-up tickets in the `mapping` epic)

- `w8-migration-workspace`: built by run 3027 (below).
- `w8-attached-wire`: wire `readAttachedIssues` and the merged pull request URLs into the lane after the operator's go for one
  live capture; update `linking-attached-off.test.ts` deliberately in that commit.
- `w8-readme-count`: resolved in this PR. README.md's machine-lane count word moved to the census-derived count ("ninety-six" after the absorbs) for the two new doors,
  by the packet the README's holding run approved; the ticket can close with the PR.
- `w8-overlord-skill`: the Overlord skill's door table gains `link_team`, and says when it suggests instead (below `full`).
- `w8-call-anchor`: address one call by id on the Waiting on you screen, so the Overlord link's line links to its call.
- `w8-triage-l1`: move the triage row choice (`triageOf`, `teamHolders` in `planRoutes.ts`) into `planPolicy.ts` beside
  `triageVerdict`, reusing `teamOwnerProject`'s holder predicate. It stayed in the route because `planPolicy.ts` was held by
  another wave; stated as a bend in D-8808.
- `w8-skill-section`: the coordinator skill's plan reference gains the section below, in a PR of its own: the review
  judge refuses a PR that changes a rules file and anything else (`rules-mixed`), so it left this one. Its text, as built
  and reviewed in Task 8.6 and the final fixes, to append after `## plan take` in `ccd/coordinator-skill/references/plan.md`
  (with `'linking.suggest'` added to the executable-corpus list of `server/test/ccrc-api-closed.test.ts`):

````markdown
## linking suggest

A project with no Linear team key, whose programme files into it, has nowhere for its tickets to go. A coordinator that knows
which team it should be suggests one, with exactly one body:

```bash
"$API" linking suggest --json - <<JSON
{"project":"project-a","team":"AAA","workspace":"<id, optional>","why":"<reason>"}
JSON
```

`workspace` is needed only when the key exists in more than one connected workspace; without it, the one workspace that
holds the key is recorded. Never put `byId` or `byUuid` in the
body: the client adds the pane's own pair and refuses a body that names either. A suggestion is a candidate and never a
link: it appears on the console's Project linking card, under the project, with the workspace and your reason, and the
operator taps it, or the Overlord confirms it within its authority. The reason is shown in the console only, never written
to Linear, so keep it to a sentence, with no ticket ids and no private names (refused `linear-text-public`). Refusals:
`team-set` (the project already has a key; a project whose key the operator cleared still takes suggestions),
`team-unknown` (no connected workspace has that team, or the named workspace does not), `team-ambiguous` (no workspace named
and the key is in more than one connected workspace: send it again with `workspace`), `not-a-coordinator` (the session claims
no open run: only a programme's coordinator suggests), `run-unreadable` (the open run claimants could not be read: try again),
`no-project`, `linear-text-public` and `bad-request` (a body that is not exactly these keys, or a reason over its length).
````

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
| The console's state | `stateOfProject` through the pure `migrationOfProject`: a pinned row reads its workspace's migrations without needing routing facts; an unpinned row uses the request's shared routing snapshot, a shared key showing "Not migrated" and routing that cannot be measured (an unreadable slot, or no listing at all) showing "Not measured" with no Reshape (run 3082). A key no slot serves matches by key alone only while all its migrations sit in one workspace | four `stateOfProject` cases |
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
still waits quietly and counts in the console; `w8-ambiguous-notice` is carried until after the pilot.

## Run 3082 (`w8-pilot-guards`): what was built

The rulings on review 3073, built before the pilot team's migration starts from the console. Every fix has a test seen red
first; each guard below was removed alone and its test went red.

| Item | Built | Test |
|---|---|---|
| F1, the console state | The hierarchy state gains the word `unmeasured`, decided in the pure `hierarchyStateOfRow` (`migrationPolicy.ts`), which reads the routing itself: an unpinned row with a team key whose routing cannot be measured, an unreadable slot or no listing at all, says "Not measured", never "Not migrated", and Reshape is not offered for it. A pinned row and a row with no key are unchanged | `migration-workspace.test.ts`: an unpinned row with one unreadable slot record, and with the whole store unreadable, shows `unmeasured` although a migration exists; a pinned row still shows its migration. `linking-words.test.ts`: "Not measured", and no Reshape; `project-linking-card.test.tsx` draws no Reshape control for it |
| F8, one owner answer | `teamOwnerProject`: a holder that outranks every row naming the key in the workspace, pinned or not, is the owner whatever the routing, so a failed listing and an unreadable slot answer alike; the answer is unmeasured only when an unpinned row that outranks it exists and its routing cannot be read. One case moves with it: an unpinned top row whose key two readable workspaces hold joins neither (its routing is measured), so a pinned holder in an unreadable third workspace now owns there | `plan-policy.test.ts` pins both shapes. `plan-inbound.test.ts`: the triage test of an unreadable workspace whose pinned top holder is the caller now answers 200 `raised`, opens one decide item and makes no Linear call; it used to answer `unreachable` |
| F11 | `ownerItemReady` keeps its live-owner check | `plan-policy.test.ts`: an owner item does not settle while the workspace-qualified owner is not live |
| F2 | The close step's unmeasured return | `plan-inbound.test.ts`: the by-id read measured, the owner unmeasured: no comment, no cancel, `actedAt` stays null |
| F3 | `mailForMap`'s unmeasured return | `migration-propose.test.ts`: an unreadable slot record: no map mail and no Name a Linear owner item (the item is the line that goes red; the mail alone does not tell the two apart in that fixture) |
| F4 | Both lookup terms of `triageOf` stay and each is pinned. The unreadable-workspace term: an unpinned top holder, its row in the unreadable workspace beside a readable second one holding the key, answers 503 `unreachable` (without the term, 409 `issue-not-inbound`). The pin-unmeasured term is reachable only through an unreadable legacy slot whose workspace no file slot carries; it is not dead | `plan-inbound.test.ts`, with a `legacy-unreadable` store mode in its rig |
| F10 | `workspaces()` reads the store whenever the coordination store exists, even for an empty project set | `plan-inbound.test.ts`: `plan take` Close of a handed row for a programme with no home and no epics, with a readable store, answered 503 `unreachable` before and 200 now |
| F5, F6, the console words | `linearItemErrorText(err, act)` (`refusalWords.ts`) takes the act the controls sent: Return says its own sentence for `no-linear-owner` and `team-ambiguous` (the map and the note are kept, and why), and `unreachable` says "The Linear owner could not be measured, so nothing was changed. Try again." on Hand and Return alike. Hand's `no-linear-owner` sentence is unchanged. No new wire word | `linear-item-controls.test.tsx`: each word on Return and Hand, and the note kept after a Return refusal |

**Recorded, not changed.** F7: the close step re-reads a closed, unacted row by id before it decides ownership, so while
routing stays unmeasured it spends one governed read per such row a beat and makes no progress. That is accepted as this
lane's retry pattern: the read is rate-governed, and reading first keeps the retire outcome for a row that left the managed
teams. F9: `plan take` refuses `unreachable` for Close as well as Return when the handed row's owner cannot be measured; it is
recorded in D-8808.
