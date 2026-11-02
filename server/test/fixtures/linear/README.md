# The recorded Linear fixtures (FX)

These are the answers Linear gave to the documents ccrc sends, recorded once by the coordinator's fixture capture (the
Linear central key plan's FX act, D-7684) and scrubbed to the public fixture vocabulary. Every task that needs a Linear
answer, an `X-Complexity` value, a rate-limit header, an error code or a schema fact reads it here. No worker makes one up.
The departures from the plan's FX item are D-7743 (`docs/superpowers/plans/2026-11-02-linear-fx-capture.md`).
`server/test/linear-fixtures.test.ts` checks these files.

## The capture

- **When.** 2026-11-02, between 14:55 and 15:06 UTC. Each file's `sentAtMs`, `receivedAtMs` and `date` header are the real ones.
- **Where.** On the operator's Mac, not a test box (D-7743). The key was a throwaway key for a throwaway workspace. The operator
  made it for this capture and revoked it afterwards. The capture never ran on the fleet box and never used the fleet's key.
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

- **The cost at `limit` 50 is not measured.** The lists that take a caller's limit were captured only at `first: 25`, in an
  almost empty workspace. Cost follows `first` (projects: 60 at 25, 600 at 250), so the cost of a full page at the maximum
  limit of 50 is not recorded (D-7743).
- **Errors arrive on HTTP 200.** `data` is null, and the code is in `errors[0].extensions.code`. The `INPUT_ERROR` answers also
  carry `extensions.statusCode` 400. The `INVALID_INPUT` answer has no `statusCode`.
  - A missing issue is `INPUT_ERROR`, "Entity not found: Issue". It is not `data.issue === null`.
  - An out-of-range priority is `INVALID_INPUT`, "Argument Validation Error", with `validationErrors`.
  - An unknown `stateId` is `INPUT_ERROR`, "Entity not found in validateAccess: stateId", with `extensions.meta.missingIds`.
- **No separate forbidden answer.** A team the key cannot see answers the same as a team that does not exist:
  `INPUT_ERROR`, "Entity not found: Team". There is no 403 and no forbidden code. The workspace had one team, so a real
  team out of the key's reach could not be tried. Only a random UUID was (D-7743).
- **A revoked key is an invalid key.** A made-up key and the revoked key both get HTTP 401 `AUTHENTICATION_ERROR` with the
  same body. Neither answer has an `x-complexity` or `x-ratelimit-*` header.
- **The second key-check page is empty.** The workspace has one team. Page 2 was asked with page 1's `endCursor` even though
  `hasNextPage` was false, and it came back with no teams. No non-empty second page is recorded (D-7743).
- **A create keeps a caller-chosen id.** `IssueCreateInput.id` is a nullable `String`, documented as a v4 UUID. Linear keeps
  the id the caller sends. Sending the same id again gets HTTP 200, `data` null, `INPUT_ERROR` "conflict on insert of
  Issue", and creates nothing. That makes it a retry guard. The merged code does not send it.

## The constructed rate-limited answer

`error-429-ratelimited-constructed.json` was **not recorded**. No capture provokes a rate limit. It is built from Linear's
developer documentation, the page titled "Rate limiting" (read 2026-11-02). That page says:

- a request over a rate limit gets HTTP 429;
- its `errors` array carries the `RATELIMITED` code in `extensions.code`;
- `Retry-After` gives the number of seconds to wait;
- `X-RateLimit-Requests-Reset` is the time the window resets, in UTC epoch milliseconds.

Its request limit (2500) is the recorded one. Its remaining count, reset time and `Retry-After` value are made-up
examples, and its message is ours. The file's `constructed` field says the same.

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
  3 label, 4 project, 5 user, 6 issue, 7 comment, and 8 a random UUID the capture made up to provoke an error.
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

1. The operator makes a throwaway key for a throwaway workspace that holds nothing real.
2. Send the new document with the same request shape. Record the status, every response header and the raw body.
3. Scrub it with the same mapping rules. Keep the document and the header numbers as they are.
4. Replace the old file with the new one, update the tables above, and revoke the key.
