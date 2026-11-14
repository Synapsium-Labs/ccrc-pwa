# The recorded Linear fixtures (FX)

These are the answers Linear gave to the documents ccrc sends, recorded once by the coordinator's fixture capture (the
Linear central key plan's FX act, D-7684) and scrubbed to the public fixture vocabulary. Every task that needs a Linear
answer, an `X-Complexity` value, a rate-limit header, an error code or a schema fact reads it here. No worker makes one up.
The departures from the plan's FX item are D-7743 (`docs/superpowers/plans/2026-11-02-linear-fx-capture.md`).
The hierarchy documents were recorded by a second capture, FX2 (D-8407, the Linear hierarchy plan's FX2 act), on
2026-11-13: see "What FX2 measured" below. `server/test/linear-fixtures.test.ts` checks these files.

## The capture

- **When.** 2026-11-02, between 14:55 and 15:06 UTC. Each file's `sentAtMs`, `receivedAtMs` and `date` header are the real ones.
- **Where.** On the operator's Mac, not a test box (D-7743). The key was a throwaway key: the operator made it for this
  capture and revoked it afterwards. The capture never ran on the fleet box and never used the fleet's key.
- **Which workspace.** Not a throwaway test workspace, as the plan asks, but an existing one with other members, issues
  and a project (D-7743). The capture wrote only its own three issues and one comment, and deleted them afterwards. It
  changed nothing else. Every identity its reads returned is scrubbed (below).
- **How.** Each request was one `POST` with the bare key as `authorization` (no `Bearer`) and the JSON body in
  `requestBody`. The calls were 1.5 s apart and nothing was retried. The capture's own issues and comment were deleted
  afterwards. Those cleanup calls are not kept here.

One file per answer. Each file holds the document as sent (`document`, byte for byte), its `variables`, the request body,
the HTTP status, every response header in the order Linear sent it, the parsed `body` and the raw body (`bodyRaw`).

| File | What it is | Document |
|---|---|---|
| `key-check-page-1`, `key-check-page-2` | the key check, both pages (spec §4.1) | `client.ts` `KEY_CHECK_QUERY` |
| `directory-{states,labels,projects,users}-page-1` | each directory collection's first page (§4.4) | `LINEAR_DOCUMENTS.directory*` |
| `read-{issue,search,comments,statuses,projects,labels,users}` | each read verb (§5, §6.4) | `LINEAR_DOCUMENTS.<verb>` |
| `read-title` | the title lookup | `client.ts` `QUERY` |
| `resolve-issue`, `resolve-parent`, `resolve-issue-and-parent` | the three resolve documents (§4.5) | `LINEAR_DOCUMENTS.resolve*` |
| `mutation-issue-create`, `mutation-issue-create-with-parent`, `mutation-issue-update`, `mutation-comment-create` | the three mutations | `LINEAR_DOCUMENTS.{create,update,comment}` |
| `extra-issue-create-caller-id`, `extra-issue-create-caller-id-retry` | a create that sends its own `input.id`, then the same id again | `LINEAR_DOCUMENTS.create` (the merged code does not send `id`) |
| `introspection-issue-create-input` | the schema of `IssueCreateInput` (for spec §6.6's caller-chosen `id`) | the capture's own introspection query |
| `error-not-found`, `error-not-found-resolve` | a missing issue (`AAA-999999`) | `issue`, `resolveIssue` |
| `error-linear-invalid-priority` | `priority: 99` | `update` |
| `error-linear-invalid-state` | a random UUID as `stateId` | `create` |
| `error-linear-forbidden` | a random UUID as `teamId` | `create` |
| `error-401-invalid-key` | a made-up key of the right shape | `KEY_CHECK_QUERY` |
| `error-401-revoked-key` | the capture's own key, after the operator revoked it | `KEY_CHECK_QUERY` |
| `error-429-ratelimited-constructed` | **constructed, not recorded**: see below | `KEY_CHECK_QUERY` |
| `mutation-attachment-link-url-constructed` | **constructed, not recorded**: see below | `LINEAR_DOCUMENTS.link` |
| `read-{initiative-by-id,project-by-id,project-statuses,initiatives-probe,initiatives-by-name,projects-by-name,changed-initiatives,issue-owned}` | FX2: the hierarchy reads (D-8407). `read-project-statuses` is also the directory's page of project statuses | `LINEAR_HIERARCHY_DOCUMENTS.<name>` |
| `read-initiatives-by-name-near-miss` | FX2: the initiative's name less its last character | `LINEAR_HIERARCHY_DOCUMENTS.initiativesByName` |
| `read-project-by-id-milestone-update-{before,after}` | FX2 item 4: the project read around a milestone update | `LINEAR_HIERARCHY_DOCUMENTS.projectById` |
| `mutation-{initiative-create,initiative-to-project-create,project-create,project-milestone-create,project-milestone-update,issue-relation-create}` | FX2: the hierarchy mutations (D-8407) | `LINEAR_HIERARCHY_DOCUMENTS.<name>` |
| `mutation-{initiative,project,project-milestone}-create-same-id` | FX2: each create sent again with the same caller-chosen id | `LINEAR_HIERARCHY_DOCUMENTS.<name>Create` |
| `mutation-initiative-update-status-{proposed,planned,active,completed,canceled}` | FX2: each `InitiativeStatus` value set in turn | `LINEAR_HIERARCHY_DOCUMENTS.initiativeUpdate` |
| `mutation-comment-create-on-{initiative,project}` | FX2: a comment on an initiative and on a project | `LINEAR_DOCUMENTS.comment` |
| `extra-issue-create-in-milestone-{a,b}` | FX2: two issues in the capture's project and milestone | `LINEAR_DOCUMENTS.create` |
| `extra-viewer` | FX2: the key's viewer, which the creator reads name | the capture's own `viewer { id }` query |
| `introspection-{initiative-create-input,project-create-input,project-milestone-create-input,comment-create-input,project-milestone,initiative-status}` | FX2: the schema answers to the plan's questions 1 to 3 and 7 | the capture's own introspection query |
| `error-graphql-validation-milestone-creator` | FX2: `changedMilestones` as merged before D-8407, selecting a milestone `creator` | the document before D-8407 |
| `error-project-name-too-long` | FX2: a project name of 85 characters | `LINEAR_HIERARCHY_DOCUMENTS.projectCreate` |
| `read-{changed-projects,changed-milestones,changed-issues,team-open-issues}-constructed`, `mutation-{initiative-to-project-delete,project-update}-constructed` | **constructed, not recorded**: the six hierarchy documents FX2 did not record (D-8180), see below | `LINEAR_HIERARCHY_DOCUMENTS.<name>` |

## What the fixtures show

- **The reset headers are a time, not a wait.** `X-RateLimit-Requests-Reset` and `X-RateLimit-Complexity-Reset` are absolute
  Unix times in **milliseconds**. The window rolls: each answer's reset is about 3,600.5 s after its own send. Code that
  reads them as seconds to wait is wrong. Linear's developer documentation says the same ("UTC epoch milliseconds").
- **The limits.** 2,500 requests and 3,000,000 complexity points per hour (`x-ratelimit-*-limit`). No answer carried
  `Retry-After`.
- **`X-Complexity`.** Every recorded value is under the 10,000-point single-query cap:

  | Document | X-Complexity |
  |---|---|
  | key check, page 1 and page 2 | 628 (follows `first: 250`, not the data) |
  | directory states / labels / projects / users | 901 / 875 / 600 / 651 |
  | statuses / labels (their fixed `first: 250`) | 601 / 575 |
  | projects / users / search / comments (`first: 25`) | 60 / 65 / 12 / 6 |
  | issue, title | 10, 2 |
  | resolves | 3 to 5 |
  | create, update / comment | 11 / 3 |

- **The cost at `limit` 50 is not measured.** The lists that take a caller's limit were captured only at `first: 25`, and
  no answer filled a page of 50 (users 21 rows, search 2, projects and comments 1). Cost follows `first` (projects: 60 at 25, 600 at 250), so the cost of a full page at the maximum
  limit of 50 is not recorded (D-7743).
- **Errors arrive on HTTP 200.** `data` is null, and the code is in `errors[0].extensions.code`. The `INPUT_ERROR` answers also
  carry `extensions.statusCode` 400. The `INVALID_INPUT` answer has no `statusCode`.
  - A missing issue is `INPUT_ERROR`, "Entity not found: Issue". It is not `data.issue === null`.
  - An out-of-range priority is `INVALID_INPUT`, "Argument Validation Error", with `validationErrors`.
  - An unknown `stateId` is `INPUT_ERROR`, "Entity not found in validateAccess: stateId", with `extensions.meta.missingIds`.
- **Forbidden is not measured.** `error-linear-forbidden` sends a random team UUID that names no team. It answers
  `INPUT_ERROR`, "Entity not found: Team", with no 403 and no forbidden code: a not-found answer. The key reached one team,
  so a real team out of the key's reach could not be tried, and whether one answers the same way is unknown (D-7743).
- **A revoked key is an invalid key.** A made-up key and the revoked key both get HTTP 401 `AUTHENTICATION_ERROR` with the
  same body. Neither answer has an `x-complexity` or `x-ratelimit-*` header.
- **The second key-check page is empty.** The workspace has one team. Page 2 was asked with page 1's `endCursor` even though
  `hasNextPage` was false, and it came back with no teams. No non-empty second page is recorded (D-7743).
- **A create keeps a caller-chosen id.** `IssueCreateInput.id` is a nullable `String`, documented as a v4 UUID. Linear keeps
  the id the caller sends. Sending the same id again gets HTTP 200, `data` null, `INPUT_ERROR` "conflict on insert of
  Issue", and creates nothing. That makes it a retry guard. The merged code does not send it.

## What FX2 measured

FX2 (D-8407) answered the Linear hierarchy plan's seven capture questions on 2026-11-13, between 16:12 and 16:14 UTC,
on the operator's Mac with a throwaway key, in a scratch team of an existing workspace. It created its own initiative,
project, milestone, link, two issues, a relation and two comments, and deleted them afterwards with calls that are
not kept. `linear-fixtures.test.ts` ("what FX2 measured") reads each answer below off the recordings.

1. **Every hierarchy create takes a caller-chosen id.** `InitiativeCreateInput`, `ProjectCreateInput` and
   `ProjectMilestoneCreateInput` each have a nullable `id`, and Linear keeps the id sent. A repeated initiative or
   project create with the same id answers HTTP 200, `data` null, `INPUT_ERROR` "conflict on insert of Initiative" /
   "conflict on insert of Project", and creates nothing. A repeated milestone create with the same id and name answers
   `INPUT_ERROR` "name not unique" instead: Linear checks a milestone's name in its project before its id.
2. **`InitiativeStatus` is `Proposed`, `Planned`, `Active`, `Completed`, `Canceled`**, so there is a canceled one, and
   each was set in turn. An initiative made with no status reads `Active`. The workspace's project statuses come with
   the types `planned`, `backlog`, `canceled`, `completed` and `started` (Linear's default names: Planned, Backlog,
   Canceled, Completed, In Progress).
3. **`CommentCreateInput` takes `issueId`, `projectId`, `initiativeId`, `projectUpdateId` and `initiativeUpdateId`, not a
   milestone.** A comment on an initiative and one on a project were each made.
4. **A milestone update does not move its project's `updatedAt`** (`read-project-by-id-milestone-update-{before,after}`:
   the same value before and after). A drift pass reads changed milestones on their own, not through their projects.
   In both runs the milestone's own `updatedAt` also stayed where its create left it after a description-only update,
   so whether `changedMilestones` sees such an edit is not measured.
5. **The initiatives-off probe was not measured.** No workspace the operator has has initiatives off. On a workspace
   that has them on with none made, the probe answers HTTP 200 with an empty list (`read-initiatives-probe`), so the
   probe cannot by itself tell off from empty. Its off answer stays awaited (`AWAITING_ANSWER` in the test), and
   `readInitiativesProbe` answers `unknown`, never `off`, for anything but nodes.
6. **The GitHub mirror observation is deferred** to the pilot team: whether the mirror of a synced issue shows an
   issue relation and an attachment link is to be watched there, not in a capture.
7. **Exact-name filters hold, and `creator` reads the key's viewer for initiatives and projects.** `initiativesByName`
   and `projectsByName` find the object made, and its `creator.id` equals the key's viewer (`extra-viewer`); a name one
   character short finds none (`read-initiatives-by-name-near-miss`). **`ProjectMilestone` has no `creator`**: its
   introspection lists none, and `projectById`, `changedProjects` and `changedMilestones`, which selected one, each
   answered HTTP 400 `GRAPHQL_VALIDATION_FAILED`, 'Cannot query field "creator" on type "ProjectMilestone"'
   (`error-graphql-validation-milestone-creator`; that error carries no `x-complexity` and no rate-limit header).
   D-8407 removes the milestone `creator` from the three documents, and a milestone binds by name inside its project.

Also measured:
- **A project name is at most 80 characters.** An 85-character name answers `INVALID_INPUT`, "Argument Validation Error",
  with `userPresentableMessage` "name must be shorter than or equal to 80 characters." (`error-project-name-too-long`).
- **`X-Complexity`** of the hierarchy documents, all far under the 10,000 cap:

  | Document | X-Complexity |
  |---|---|
  | `changedInitiatives` (`first: 100`) | 1360 |
  | `projectsByName` / `projectById` / `projectStatuses` | 235 / 153 / 111 |
  | `initiativesByName` / `initiativeById` / `issueOwned` / `initiativesProbe` | 15 / 13 / 6 / 1 |
  | each hierarchy mutation / the introspections | 2 / 14 |

What FX2 left unrecorded: `changedProjects` and `changedMilestones` (their recorded answers are the 400 above, and their
corrected documents are unsent), `changedIssues`, `teamOpenIssues` and `projectUpdate` (not in the run), and
`initiativeToProjectDelete` (sent only as the capture's cleanup, which is not kept). Their constructed files stay, each
named by its `AWAITING_RECAPTURE` row.

How FX2's files differ from FX1's: the capture kept no clock and no status line, so `sentAtMs`, `receivedAtMs`,
`sentAt` and `statusLine` are null; it kept only the `content-type`, `x-complexity`, `x-ratelimit-*` and `retry-after`
response headers (none sent `retry-after`), in the fetch API's order, and no `date` or `content-length`; `bodyRaw` is
the parsed body written compactly, as Linear sends it. The item-4 run (the two `read-project-by-id-milestone-update`
files) kept no header at all. Each reset header is about an hour after the run, as in FX1.

## The constructed rate-limited answer

`error-429-ratelimited-constructed.json` was **not recorded**. No capture provokes a rate limit. It is built from Linear's
developer documentation, the page titled "Rate limiting" (read 2026-11-02). That page says:

- a request over a rate limit gets HTTP 429;
- its `errors` array carries the `RATELIMITED` code in `extensions.code`;
- `Retry-After` gives the number of seconds to wait;
- `X-RateLimit-Requests-Reset` is the time the window resets, in UTC epoch milliseconds.

Its request limit (2500) is the recorded one. Its remaining count, reset time and `Retry-After` value are made-up
examples, and its message is ours. The file's `constructed` field says the same.

## The constructed link answer

`mutation-attachment-link-url-constructed.json` was **not recorded** (D-8141). The capture ran before the `link` verb
existed. It is built from the document `ops.ts` sends and Linear's published schema for `attachmentLinkURL` (an issue id,
a URL, an optional title; the payload carries `success` and the `attachment`). Its attachment id is a fixture id, and its
complexity and rate-limit headers are copied from the recorded comment mutation as illustrative values. It is to be
replaced by a recorded `mutation-attachment-link-url.json` against a throwaway issue, after which the exception in
`linear-fixtures.test.ts` goes. The file's `constructed` field says the same.

## The constructed hierarchy answers

Six hierarchy `*-constructed.json` files (D-8180) are **not recorded**: the documents FX2 did not record (above). The
22 constructed files D-8180 landed, one for each of the 21 `LINEAR_HIERARCHY_DOCUMENTS` and the directory's page of
project statuses, were written before any session could call Linear; FX2's recordings replaced 16 of them (D-8407). Each is built from the document `ops.ts` sends and Linear's
published schema. Every id is a fixture id (kind word 8 for an object the capture has no kind for: an initiative, a
milestone, a project status, a link, a relation), and the files carry no `x-complexity` and no rate-limit header, so no
number in them is a measurement. Each is named by its document's `AWAITING_RECAPTURE` row in `linear-fixtures.test.ts` (the
`projectStatuses` row names both of its files), and FX2 (the operator's capture) replaces it with a recorded file and
removes the row; a constructed answer no row names fails the suite. The initiatives probe's "off" answer is
still unrecorded (FX2 item 5), which is why `readInitiativesProbe` answers `unknown`, never `off`, for anything but nodes.

## The scrub

Before the capture was committed, a script that is not in this repository rewrote every identity in it. Its mapping from
real values to fixture values never left the machine the capture ran on.

- **Workspace.** The organization is `Workspace A` and its URL key is `ws-a`. The team is `AAA`, `Team A`. Issue
  identifiers are `AAA-<n>`, with Linear's numbers kept. The project is `Project A`.
- **People.** Every user is `User A`, `User B`, … with display names `user-a`, `user-b`, …. The key's own user is
  `User A`. The workspace's users answer has no email field. If an email were ever added, it would use `example.invalid`.
- **UUIDs.** Every UUID is a fixed fixture UUID, `00000000-000K-4000-8000-0000000000NN`. The same real id always maps to
  the same fixture id, so references across files still line up: a cursor that was an id, an id inside an error message, a
  variable that names an entity from another file. The kind word `K` is 0 organization, 1 team, 2 workflow state,
  3 label, 4 project, 5 user, 6 issue, 7 comment, and 8 a random UUID the capture made up to provoke an error or an
  object with no kind of its own (an initiative, a milestone, a project status, a link, a relation).
- **FX2 (D-8407).** The same vocabulary, with FX2's ids from serial `20` up so none meets an FX1 id. Its scratch team
  is `AAA`, `Team A`; the key's viewer, which every `creator` it read names, is `User A`. Its objects are named
  `Capture initiative temp`, `Capture project temp`, `Capture milestone temp` and so on, keeping each real name's shape
  (a near miss is still the name less its last character, the refused long name is still 85 characters). Its two issues
  are `AAA-101` and `AAA-102`: unlike FX1, Linear's numbers are not kept. Every timestamp, every header number and every
  Linear message that names no identity is kept as captured.
- **Headers.** `x-request-id`, `cf-ray` and `etag` are fixed placeholders. `content-length` is recomputed for the
  scrubbed body.
- **Keys.** No key appears in any file. The request headers record only that the key was sent bare.
- **What was kept as captured.**
  - Every document text, byte for byte. Each must still equal the merged constant, and the test checks that.
  - Every number in the headers: `x-complexity`, every `x-ratelimit-*` value, the limits and the reset times.
  - The timestamps.
  - Linear's default workflow state and label names.
  - The capture's own neutral titles, descriptions and comment body.
  - Every error code, and every error message that names no identity.
  - The bodies' shapes, field order and data types.

## Re-capturing a changed document

If a later task changes a document (for example a lower page size in LK3 or LK8), the document is re-captured the same way
before that task lands. The test turns red until it is.

1. The operator makes a throwaway key for a throwaway test workspace that holds nothing real (the plan's FX item).
2. Send the new document with the same request shape. Record the status, every response header and the raw body.
3. Scrub it with the same mapping rules. Keep the document and the header numbers as they are.
4. Replace the old file with the new one, update the tables above, and revoke the key.
