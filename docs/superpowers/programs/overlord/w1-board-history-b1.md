# Overlord W1, PR B1: the history door (run 3653)

What this pull request built, where it departs from the plan, and what the ledger should learn. The plan is
`docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`, Task 5 ("PR B1 ends here"). No D-number is
defined here: each departure has a slug, and the coordinator mints numbers.

## What it ships

- `server/src/coord/overlordHistory.ts` (L1, C5): `historyAgentFor`, the one connected link that advertises
  `overlord-history`, else `no-agent` or `many-agents`; `historyDoorAnswer`, Table 2 total, with
  `HISTORY_UNREACHABLE_CAUSES` and the port's answer type `OverlordHistoryAsked`.
- `FleetIO.overlordHistory(req, signal)`: the remote adapter re-checks the advertised word at the send, reads the reply
  through `readOverlordHistoryAnswer`, and maps errors as the runner does (`bad-request` to `unsupported`,
  `LinkNotSentError` to `not-started`, the client's own `Error('timeout')` to `timeout`, anything else, the agent's own
  `timeout` and an abort included, to `lost`); a 25 s wait, between the agent's 20 s deadline and `curl -m 30`.
  `localIO` answers `unsupported`.
- `POST /api/overlord/history` in `server/src/coord/overlordHistoryRoutes.ts` (L4): the box token in `onRequest`, the
  caller pair, the Overlord gate with the row `history` (fenced, verb class `view`, word `overlord-v1`, others refused),
  then the request through `readOverlordHistoryRequest`, then the one read runner: the ceiling (60 an hour, the inbox
  piece's row), the line (door `history`, the canonical target as its scope, the outcome word, the generation and the
  turn state), and the answer.
- The read runner (`overlordRead.ts`) gains two additive things: a compose kind `answer`, a 200 that hands no session text
  and is never a served line, and a refusal's own closed fields (`extra`, here `cause` and `refusal`).
- `ccrc-api overlord history <search|describe|expand> [--all | --project <name> | --session <id>] [--agents] [args…]`:
  the body built and judged by one jq program, the pane's pair last; one hundred and two rows.
- `server/test/fixtures/overlord-history-requests.json`: the shared corpus, every case run through the reader and the
  client, with three mutant controls (a client without the separator, `--regex` or byte-bound check sends).
- Mutation floors: `historyAgentFor` (four mutants) and `historyDoorAnswer` (five), every mutant killed, floor 1; the
  cases are written once in `server/test/sim/overlordHistoryDoorSets.ts`.

## Departures, by slug

- **`history-door-in-its-own-routes-file`**: the plan puts the handler in `overlordRoutes.ts`. On main that file
  registers only the operator's session-gated doors, and `box-token-census.test.ts` pins that, so the door has a file of
  its own beside the inbox's, which every census reads as a lane source of its own (box-token census, both door
  censuses, the auth-gate scanner, the fastify allowlist). The inbox file's `TOKEN_DETAIL`, `callerOf` and `overlordRow`
  are exported and reused rather than copied.
- **`history-door-bound-allows-the-pair`**: the plan sets the route's `bodyLimit` to
  `OVERLORD_HISTORY_REQUEST_MAX_BYTES`. The reader measures the request less the caller pair, both as sent and as typed
  (the defaults filled in, the target canonical), and the agent reads the typed request the server sends, so any request
  the door passes on reads alike at the agent (fix round 1, review 3730 F2: before it, a request that left `agents` or
  `args` out measured 10 to 15 bytes less at the door). The route bound is that bound plus 512 bytes for the pair. A body past the route bound is `oversize` 413, the word that status belongs to (the plan says
  `bad-request` 413; the inline-send ratchet refuses a word answered at another word's status); a body within it whose
  request is past the request bound is `bad-request` 400 with the reader's `oversize`.
- **`history-request-read-after-the-gate`**: the request is read after the gate and before the read runner, as the
  inbox's message id is: a caller that is not the Overlord learns nothing of the grammar, and a refused request writes no
  line and spends no ceiling. The door's refusal carries the reader's closed word as `refusal`.
- **`history-row-fenced`**: the plan's Task 5 says a read takes no step that binds write doors, but the history row is
  fenced (`write: true`, `act: 'read'`), as the inbox plan's later ruling has every Overlord read fence (`w1-inbox.md`,
  question 18) and as the read runner requires of a row that does not say `unfenced`. A request the reader refuses after
  a pass has spent the act counter and the witness, as the inbox's `messages` and `acknowledge` do. The plan's lines that
  still read unfenced are the coordinator's, on the ledger.
- **`read-runner-answer-kind`**: Table 2's agent outcomes other than `rows` answer 200 and are not served lines (R8); the
  runner had only `rows` and `refuse`, so it gains `answer` and a refusal's `extra`. The inbox doors are unchanged.
- **`history-line-outcome-words`**: a line's outcome word is the agent's outcome (`busy`, `deadline`, …), `rows` for a
  served page, `request-refused` for the agent's refusal, and the cause (`no-agent`, `many-agents`, `unsupported`,
  `not-started`, `lost`, `timeout`) for each `history-unreachable`.
- **`history-mask-pinned-in-the-door-test`**: the plan has `secret-mask.test.ts` assert that the POST answer is masked by
  the write-answer rule. That file is held by a peer, and the egress inventory needs no row for a POST, so the
  assertion (`WRITE_ANSWER_EXEMPT` does not match, `answerMasked('POST', …)` is true) is in
  `overlord-history-door.test.ts`, beside a masker case over the door's own answer and the budget pin.
- **`history-client-grammar-in-jq`**: the client's grammar is one jq program, each argument passed as its own `--arg`
  (every jq since 1.6 reads that as a value, whatever it starts with). Where the two grammars differ (review 3730 F5):
  jq counts a string's length in code points and the reader in UTF-16 units, so an argument of astral characters near
  1024 passes the client and is refused by the server; jq writes the delete character as six bytes where the reader's
  JSON writes one, so a request of many near the byte bound is refused by the client as `oversize` where the server
  would take it (a corpus case pins it, with its `clientVerdict`); and an argument that is not valid UTF-8, which jq
  would change to U+FFFD, is refused by the client as `bad-args` when `iconv` is on PATH, and is changed and sent when it
  is not. The head of the argv takes one target and one `--agents`; a second of either is read as an argument, so
  the reader's own word judges it.

## Known limits

- **An abort does not reach the agent** (review 3730 F4). A caller that goes away during the gate starts no read (the
  close listener is attached before the gate's awaits). A caller that goes away during the read ends the server's wait
  only: no frame tells the agent, whose one history slot frees when its worker exits, at most its 20 s deadline, so the
  next read may answer `busy` until then. An abandon frame would be a wire addition and is not this PR's.

## The masker budget (question 14)

The densest page the agent may send (`OVERLORD_HISTORY_ANSWER_MAX_BYTES` of items made of 20-byte runs, the masker's
floor, with a fingerprint of that length held, so every run is a candidate) is masked with no fail-closed cut. The test
pins it.

## Red first, measured

Each guard was removed in place, its test file run, then restored:

| Guard | Test file | Removed |
|---|---|---|
| the runner's `answer` kind sends 200 | `overlord-read-runner.test.ts` | 1 failed |
| a refusal carries its `extra` | `overlord-read-runner.test.ts` | 1 failed |
| the door reads the request through the reader | `overlord-history-door.test.ts` | 7 failed |
| the pair is stripped before the reader | `overlord-history-door.test.ts` | 1 failed |
| the route byte bound | `overlord-history-door.test.ts` | 1 failed |
| the adapter's re-check at the send | `overlord-history-door.test.ts` | 1 failed |
| the adapter's client-timeout word | `overlord-history-door.test.ts` | 1 failed |
| `localIO` answers `unsupported` | `overlord-history-door.test.ts` | 1 failed |
| the client's separator, `--regex` and bound checks | `ccrc-api.test.ts` (mutant controls) | each sends |
| `historyAgentFor`, `historyDoorAnswer` | `sim/mutation-floors.test.ts` | 9 of 9 mutants killed |
| the history file in the gate census | `overlord-gate-census.test.ts` (control) | the skipped gate is named |
| `isOverlordHistoryKebab` (the coordination word scan) | `mail-routes.test.ts` | 1 failed |
| the 413 through `refuseRoute` | `overlord-history-door.test.ts` | 1 failed |
| the reader's typed-request bound (fix round 1, F2) | `overlord-history-door.test.ts` | 1 failed |
| a caller gone before the read starts none (F4) | `overlord-history-door.test.ts` | 1 failed |
| the answer reader's family cap, project bound and whole-answer bound (F7) | `overlord-history-door.test.ts` | 1 failed each |
| the client's refusal of an argument that is not valid UTF-8 (F5) | `ccrc-api.test.ts` | 1 failed |
| the read runner's closed `extra` (F6) | `overlord-read-runner.test.ts` | a type case: three `@ts-expect-error` lines the tests type check holds |

Two bugs the corpus caught while it was written: jq's `inside` is a substring test on strings, so an empty or partial
verb passed the client, and the bound case's pad argument was past 1024 characters.

## The first full run

The pull request's first run (tip `04f4de8148`) was red beyond the known README line, on four censuses this branch had not
run locally: `refusal-status` (the 413 was an inline send at another word's status), `mail-routes` (the coordination word
scan did not know `no-agent` and the other causes), `overlord-gate` (the door table's fenced reads) and
`overlord-other-lanes-census` (a write door with no class); and on `fleetio-contract` (the member list), a held file. The
four are fixed here; the member list went to its holder as a packet.

## Method lesson

A new door, word or port member is read by more censuses than the plan's Step 5 names. The first run found five such files
that this branch had not run locally. Before the fix push, every server test file that reads source text and names a door
table, an exemption, a FleetIO member, a refusal status, a kebab word scan, a route table or a mutation set was run, each
on its own: 332 files, listed in the wave-done. Next time, run that set before the first push, not after the first run.

## Files held by others

- `server/src/auth/gate.ts`, `server/test/auth-gate.test.ts` and `server/test/rings/fastify-l4.data.ts` (another
  programme's worker) and `README.md` (another programme's landing work): a packet each, a unified diff against main
  `125a388691b05ba80bc074f827b56aa66b123158`, every line forced by a census; applied only on a yes. The gate packet's yes
  is applied; the README yes is held for the final merge (the coordinator's ruling); `server/test/fleetio-contract.test.ts`
  (the landing work's) went as a third packet after the first run. The coordinator then ruled both held yeses applied
  in the fix push (README, packet 34466; the contract file, packet 34544), each still re-derived in the final merge. The drafts were made
  in the work tree to measure them, then restored to main's text before the packets went.
- Overlord peers' files carry my hunks with a one-line notice: `overlordDoors.ts`, `server.ts`, `CLAUDE.md`, the
  box-token census and the doors census (Authority B); `overlordInboxRoutes.ts` (three exports) and
  `sim/mutation-floors.json` (two rows) (Sequence A).

## Fix round 1 (review 3730)

The coordinator's call 1063 on review 3730's report (its close refused `stale-review`, the merge of main having moved the
branch). F1: the client's no-pane case clears both pane variables at the call. F2, F4, F5, F6 and F7 as above. F8: the
door test drives `card-unread`, `overlord-off` and `renewing` through the real gate on this route's own wiring, beside
`not-the-overlord`, `capability-missing` and `stale-generation`. F3 (the door-process row) is not in this PR: see below.

## For the ledger

- The plan's index changes and spec fixes for B1 stand as the plan lists them; the board (B2) is a later run.
- No migration, no new ccd verb, no exec grant, no writing form of history, and none of the four history gate-code files.
- The door-process row for `history` is owed, under the ticket `history-door-process-row` (review 3730 F3, the
  coordinator's call 1063): the door process's read tool serves only unfenced views, the history row is fenced, and the
  door-process plan expects readers to read history; that conflict between two plans is the coordinator's to settle.
