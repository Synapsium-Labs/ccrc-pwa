# Wave 8: team and workspace mapping (run 2862, D-8808, D-8809)

Spec `docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md` §3.1 and §11.1; plan Wave 8, Tasks 8.1 to 8.6. This note
records what the wave built and every departure, for the coordinator to fold into the ledger.

## What was built

| Task | Built | Tests |
|---|---|---|
| 8.0 (move) | The team-link vocabulary (`TeamEvidence`, `TeamLinkSource`, `TeamLinkWire`, `TeamCandidateWire` and their guards and lists) moved from `shared/api.ts` to `shared/linking.ts`, pinned first by characterization tests. `shared/api.ts` gains one type-only import. | `linking-vocab-move`, the two L0 import pins |
| 8.1 | `project_linking.teamWorkspace`; the operator's write takes an optional `workspace`; `workspaceAfterWrite` (L1) decides what is stored; one resolver `routeProjectTeam` for the plan sync, the plan routes and the linking routes; the inbound owner rule takes the issue's workspace at all three lookups; `team-unknown` worded on the card. | `linear-route`, `linking-routes`, `linking-policy`, `linking-store`, `linking-workspace`, `plan-sync` |
| 8.2 | The automatic pass reads teams as (workspace, key) pairs: a key in two workspaces is never merged, links only as one pair, and is otherwise offered once per workspace with its name. | `linking-team-link`, `linear-route` |
| 8.3 | A fixed read `attachmentsForUrl` (constructed fixture), the reader `readAttachedIssues` (L4, pass `team-link`), the pure tally and completeness rule in `teamLink.ts`, and evidence `pr-attachments` weighed beside ticket ids. Off: nothing wires the reader. | `linking-attached-issues`, `linking-attached-off`, `linking-team-link`, `linear-fixtures`, `linear-ops`, `linear-hierarchy-ops`, `rings/outward-edges` |
| 8.4 | `POST /api/linking/suggest` (box token, attribution) and `ccrc-api linking suggest`; suggestions stored in `teamSuggestions`, shown as `suggested` candidates, never linked, cleared when a key is set. | `linking-routes`, `linking-store`, `auth-gate`, `box-token-census`, `ccrc-api`, `ccrc-api-closed`, `mail-routes` |
| 8.5 | `POST /api/linking/confirm`, an Overlord door (act `link-team`, `full` only) through the one gate; the link and one big call under `linear-sync` in one transaction; `teamCallId` and `linkSourceOf`; a `link_team` row in the door process. | `linking-overlord-confirm`, `single-definition/team-link-source`, the Overlord ladder, door and gate censuses, `door-tools`, `door-tools-argv`, `door-process` |
| 8.6 | The project linking card: a workspace picker for a key two workspaces hold, candidates with workspace, evidence and source, an Overlord link shown as a call made for the operator; `## linking suggest` in the coordinator skill's plan reference. | `project-linking-card` (unit and browser), `linking-words` |

## Departures (D-8808, D-8809)

The plan's "Deviations found" carries both entries in full. In short:

- **Storage.** One migration (slot 112 after the absorb of main) holds three columns: `teamWorkspace`, `teamSuggestions` and `teamCallId`. The Overlord's link is
  stored as `teamSource` `auto` plus `teamCallId`, because migration 64's CHECK admits only `manual` and `auto`. Exactly one
  function, `linkSourceOf`, derives the wire's `overlord` source, and a single-definition test fails on any other read
  (the coordinator's condition, mail of 2026-11-20).
- **The write body's workspace.** Absent keeps it (dropped when the new key is not in it), null clears it, and a named one
  must hold the key. An unreadable Linear store answers `unavailable`, never `team-unknown`.
- **The Linear proxy is unchanged.** It knows the caller's identity, not its project.
- **Task 8.3 is off.** Its schema is an assumption until the live capture: `attachmentsForURL(url)` returning nodes of
  `issue { id identifier team { key } }`. A partial answer, where any workspace failed, is unmeasured.
- **The suggest door.**
  - The client takes a JSON body, not the spec's flags, because the identity is spliced from the pane.
  - The door writes only an existing row (`no-project` otherwise).
  - It refuses a reason that names any connected team's ticket id or carries line or bidi control characters.
  - It keeps the newest eight suggestions and answers only what the caller wrote.
  - It checks no project ownership. A coordinator suggests for any keyless project its programme files into, and the
    console shows who suggested.
- **The confirm door.**
  - Its word is `overlord-v1`, so it lights later than the `continuity-v1` doors.
  - Its answer is the link and the call id only.
  - The call names the team and the workspace by display name, never by key. A coordinator's suggested reason is shown as
    written.
- **Final review fixes.** The team owner is decided in the inbound issue's workspace at every plan-routes site and in
  `linearOwnerOfProject`; the suggest door and the confirm re-check the pair against the live Linear store and refuse
  `team-ambiguous` for a shared key with no workspace; a workspace-only change makes the link the operator's.
- **The card.** Save waits for a workspace when the typed key is in two workspaces. The Overlord link's line links to the
  Waiting on you screen, because a call cannot be addressed by id.

## Carried (follow-up tickets in the `mapping` epic)

- `w8-attached-wire`: wire `readAttachedIssues` and the merged pull request URLs into the lane after the operator's go for one
  live capture; update `linking-attached-off.test.ts` deliberately in that commit.
- `w8-readme-count`: resolved in this PR. README.md's machine-lane count word moved to "ninety-five" for the two new doors,
  by the packet the README's holding run approved; the ticket can close with the PR.
- `w8-overlord-skill`: the Overlord skill's door table gains `link_team`, and says when it suggests instead (below `full`).
- `w8-call-anchor`: address one call by id on the Waiting on you screen, so the Overlord link's line links to its call.
- `w8-triage-l1`: move the triage row choice (`triageOf`, `teamHolders` in `planRoutes.ts`) into `planPolicy.ts` beside
  `triageVerdict`, reusing `teamOwnerProject`'s holder predicate. It stayed in the route because `planPolicy.ts` was held by
  another wave; stated as a bend in D-8808.
- `w8-write-ambiguous`: the operator's write door still stores a key two workspaces hold with no workspace when the card
  could not read the workspaces; refuse `team-ambiguous` there too.

## For the merge

Wave 7 (#3109) adds a `locked` state to the card's `LinkingRow`; on merge, this wave's picker and candidate controls take
`disabled={locked}` instead of `busy`. Several branches move the same counts (the migration slot, `ccrc-api` rows,
`auth-gate` routes, box-token lanes, door-tools rows): whoever lands second recounts.
