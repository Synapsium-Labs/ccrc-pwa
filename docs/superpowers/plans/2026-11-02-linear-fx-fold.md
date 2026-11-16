# Linear central key: the FX findings folded into the code

The FX capture (#1444; plan item FX, D-7684; its departures D-7743) recorded what Linear answers ccrc's documents, and
landed the recordings under `server/test/fixtures/linear/`. This change folds what they show into the Linear code, one
commit per behaviour change, and turns every `it.todo` row that named FX into a row driven by the recordings:

- **The reset header.** `X-RateLimit-Requests-Reset` is an absolute Unix time in milliseconds, so a rate-limited answer
  with no `Retry-After` waits until it: the reset minus now, held to 1 to 3,600 seconds (spec §6.7; the plan's build
  note for LK2).
- **The closed error table** (spec §6.8), built from the recorded error answers. A missing issue (`INPUT_ERROR` "Entity
  not found: Issue") is `not-found`, a missing parent `not-found` `parent`. A team the key cannot see is `not-found`
  `team`. An input Linear refuses (`INVALID_INPUT`, or `INPUT_ERROR` "Entity not found in validateAccess: …") is
  `linear-invalid`, with the body field it came from. A 401 (`AUTHENTICATION_ERROR`) stays `linear-unauthorised`.
- **The caller-chosen id** (spec §6.6). `IssueCreateInput.id` takes a v4 UUID that Linear keeps, so a create's `requestId`
  is sent as the new issue's id.
- **The page sizes.** Every recorded `X-Complexity` is under the 10,000-point cap, so no page size changes.

Two of these depart from the spec, and one number records them.

## Deviations found

- **D-7787 (2026-11-02)** — `linear-fx-fold`: two departures from spec §6.6 and §6.8 when the FX findings are folded in.
  First, a team the key cannot see answers `not-found` with the detail `team`, not `linear-forbidden`. Linear answered
  `INPUT_ERROR` "Entity not found: Team" on HTTP 200, with no 403 and no forbidden code, so the closed table has no
  forbidden row. `linear-forbidden` stays only for Linear's HTTP 403, which no recording holds. Second, a create
  retried with the same `requestId` gets Linear's `INPUT_ERROR` "conflict on insert of Issue", and the proxy answers
  `linear-invalid` with the detail `requestId`, journaled `failed`. The spec does not say how to read that answer, and
  the proxy does not treat it as the earlier create's success.

**Forbidden folds into not-found.** Spec §6.8 lists `linear-forbidden` (403) for "Linear answered 403, or refused the
operation for the key's permissions", and the plan's FX item expected a forbidden-team answer to map to it. The capture
could try only a random team UUID, because the key reached one team (D-7743). That team answered `INPUT_ERROR` "Entity
not found: Team", with `data` null, on HTTP 200. Nothing in it says forbidden, so the table maps it to `not-found` and
names the team in the detail. A team out of the key's reach may answer the same way. If so, a session is told the team
is not found, which is true from that key's side, and the remedy (a key whose user reaches the team) is the same. If a
later capture records a distinct forbidden code, it becomes a row of its own. `callLinear`'s `forbidden` arm still turns
an HTTP 403 into `linear-forbidden`, so the word stays in use.

**A retry's conflict is a refusal, not a success.** Spec §6.6 says the server sends `requestId` as the new issue's id
"so a retry with the same `requestId` cannot make a second issue". It does not say what the retry answers. Linear's
answer to the second create is `INPUT_ERROR` "conflict on insert of Issue", and nothing was created. The proxy could
read the issue back by that id and answer it as the create's success. It does not, for two reasons. First, a create
with a parent has already made two Linear calls (the resolve, then the create), and §6.6 allows no third. Second, the id
is the caller's choice. An `ok` answer for it would let a session that names the UUID of an issue it did not create get
that issue answered as its own and journaled `ok`, which marks the issue `viaFleet` for every reader. So the answer is
`linear-invalid` (422) with the detail `requestId`, and the journal row says `failed`. A session that gets it after a
timeout knows the earlier create went through, and finds the issue by search rather than creating it again.

## Known limits

- **The cost of a list at `limit` 50 is not measured** (D-7743). Search, comments, projects and users were recorded at
  `first: 25` in a workspace with few issues and comments. What guards the maximum: the validator caps `limit` at 50
  (`LINEAR_LIST_LIMIT`); projects and users at 50 are bounded by their recorded 250-entry directory pages of the same
  nodes (600 and 651); and a query over Linear's cap is refused by Linear, an answer the closed table holds no row for, so the proxy
  answers it `unreachable`.
  Search and comments have no 250-entry recording, and cost follows `first`.
- **A forbidden team is not measured** (above, and D-7743).
- **The missing parent's path.** A missing parent is read by its error's path, the `parent` alias. The capture
  recorded the missing issue's path only (`issue`), and GraphQL names the response key in `path`.
- **`AUTHENTICATION_ERROR` on a 2xx** is not read. Both 401 recordings carry it on HTTP 401, which `callLinear` reads
  by its status. An `errors` answer on a 200 with that code is `unreachable`.
- **`RATELIMITED` is still constructed.** No capture provokes a rate limit, so its answer is built from Linear's
  published page (`error-429-ratelimited-constructed.json`).
- **The reset header only for the requests window.** The wait reads `X-RateLimit-Requests-Reset`, as spec §6.7 names
  it, not `X-RateLimit-Complexity-Reset`. On every recording the two are the same rolling hour.
