# Overlord W2 carries, second batch: notes for the ledger

Wave 263, run 4222, ticket `w2-carries-2`. Three small fixes carried from reviews of merged pull requests, in one pull request:
the boot line for citations with no message row (#3647, review 4199), the test box admin routes case (#3674, review 4206), and a
measured sweep of three server test files. Main at dispatch: `058409de83`. No deviation number was allocated; departures are
recorded by slug below. Commits: one per task, then this note.

## Task 1: the boot line's words are true for every count (#3647)

The boot pass's line for citations of messages the private store has no row for said "the first 5" pairs for any count, one
included. It now reads, for `n` such citations:

- `n` from one to five: `boot pass: citations with no message row: <n> (request:message: <r>:<m>, …); nothing moved for them`,
  every pair listed and no "first";
- `n` above five: `… <n> (request:message, the first 5: <r>:<m>, …); nothing moved for them`, the first five pairs by request
  then message.

None listed never happens: the line is not written when no citation lacks a row. The line still carries ids and a count only. The
one product change of this pull request is this line's words (`server/src/operatorModel/bootPass.ts`).

**Pins.** The two count-1 pins in `request-citations-boot` (the case naming one absent citation, and the gap-in-ids case) move
with the words, red first. The counts that had no case get one each: three (fewer than five), five (exactly five) and six (more
than five); the existing case for seven stays as it was.

### Mutation rows (task 1)

Each mutant made in the source with the edit tool, run against `request-citations-boot` (43 cases), and reverted.

| Row | Mutant | Red |
|---|---|---|
| B1 | the cap's test `>` written `>=` (exactly five says "the first 5") | 1 of 43 (the five case) |
| B2 | "the first 5" always (the old words) | 4 of 43 (both count-1 pins, the three and five cases) |
| B3 | "the first 5" never | 2 of 43 (the six and seven cases) |

Before the fix, the test change alone was red in the same four cases as B2.

### Corrections for the w2-request-record-a4 note

The ledger guard refuses an edit to an existing file under `docs/superpowers/programs/` from this branch, so these replace
sentences of `overlord/w2-request-record-a4.md` when the coordinator folds the notes (slug
`w2-request-record-a4-corrections-carried-here`):

- §3 point 2: "Both unmeasured shapes are pinned, the line asserted before the port's value, so a reason folded away before the
  pass reds on what the pass did." becomes "The reader has three unmeasured shapes: a failed read, a citation row with no integer
  message id, and one with no integer request id (each pinned at the reader, `bootCitationCases`). The pass's line is pinned for
  two of them, a failed read and a row with no integer message id, the line asserted before the port's value, so a reason folded
  away before the pass reds on what the pass did."
- §3 point 7, second item: "The monitor runs I12's predicate on every watcher tick" becomes "The monitor runs I12's predicate on
  every pass of the invariant monitor (its lane is scheduled once a minute, and runs a pass when one is due)".
- §5, fix round 1's table, row "F1: the port's `unmeasured` folded into `not-applicable` in the adapter", the before cell: "3
  assertions on the port's value; nothing on what the pass does" becomes "3 assertions on the port's value, in
  `request-citations-boot`; nothing on what the pass does". (The three assertions were read at `bdcba7a2f7`, the commit review
  4190 measured, not re-run here.)
- §3 point 3: "`boot pass: citations with no message row: <n> (request:message, the first 5: <r>:<m>, …); nothing moved for
  them`, the count of all and the first five pairs" becomes "`boot pass: citations with no message row: <n> (request:message:
  <r>:<m>, …); nothing moved for them`, the count of all and every pair when there are five or fewer, and `(request:message, the
  first 5: …)` with the first five pairs when there are more" (this pull request's task 1).

## Task 2: the admin routes case measures each event's time (#3674)

`server/test/testbox-admin-routes.test.ts`, the case "a POST answers the status read AFTER the act, …", checked each event's time
and actor against their grammar, replaced both with placeholders, then searched the answer for the port, the address and the user
sent. Review 4206 found two plants that passed: the port as an integer event time, and the port as the actor's hex tail.

- **The time, closed by measurement.** The case reads the clock just before and just after the request, and holds every event's
  time between the two reads. A time equal to the port (or anything else the caller sent) falls outside that window and fails.
  The events in the answer are this act's only: the ledger holds no row before it.
- **The actor's tail, a stated limit.** The account gate in front of the route mints the tail (`gateActorOf`): the first eight
  hex characters of the hash of the session id the server issued at sign-in. Nothing the caller sends to this route reaches it.
  The comment now says exactly that, and that this one field is held to its grammar and not searched. The old comment's "an echo
  anywhere in the answer still shows" now reads "anywhere else".

### Mutation rows (task 2)

Each mutant placed at the answer (`registerTestboxAdminRoutes`' act answer in `server/src/testboxAdmin.ts`), run against the case
(two rows), and reverted.

| Row | Mutant | Before the fix | After the fix |
|---|---|---|---|
| A1 | every event's `at` answered as the port sent | 0 of 2 red (survived) | 2 of 2 red (`expected 2222 to be greater than or equal to <before>`) |
| A2 | every event's actor tail answered as the port's digits, zero-padded to eight (`… 00002222`, which the grammar takes) | 0 of 2 red | 0 of 2 red: the stated limit, kept on purpose |

A2 was checked to reach the answer: a probe read the actors as `lightMyRequest 00002222` and `device 2222 00002222`.

### Corrections for the w2-carries-1 note

These replace sentences of `overlord/w2-carries-1.md` when the coordinator folds the notes (slug
`w2-carries-1-corrections-carried-here`):

- Task 1, mutation row T2 ("the route writes `port <port>` into each event's `code`"): add "placed at the answer. Placed at the
  ledger's write instead, it is red earlier, at the events assertion."
- Task 1, "What it checks now": "each event's actor is the session's own device label and eight hex characters, and each event
  time is an integer" becomes "each event's actor is the session's own device label and eight hex characters, and each event time
  lies between two clock reads taken around the request"; and "So an echo anywhere in the answer still shows, and chance never
  does" becomes "So an echo anywhere in the answer except the actor's tail still shows, and chance never does. The tail is minted
  by the account gate from the session id's hash, from nothing the caller sends, and is not searched (#3674's follow-up)".

## Task 3: three server test files, measured

For each file, the case's searched text was read off a run: a temporary failing assertion printed the exact body, and was then
removed.

| File | The search | What the searched text holds | Verdict |
|---|---|---|---|
| `server/test/fleet-health.test.ts`, "remote mode with neither key, …" (`rebootConfigured`) | `12345` (and `hetzner-secret`) in the health answer | `{"mode":"remote","connected":false,"downSince":1,"roster":"unknown","build":"unknown","projectPools":"unknown","rebootConfigured":false}`: words, a boolean and the fixture's `downSince` of 1. The case builds the server with no watcher, no coordination database and no timer recorder, so none of the health answer's measured blocks (lifecycle, delegation, disk, pressure, backup, timers) is present | Cannot collide: no random or clock value. Unchanged |
| `server/test/collect-lane-route.test.ts`, the three 503 `write-failed` cases | `EIO`, `/EIO\|ERR_SQLITE/`, `/locked\|ERR_SQLITE/` (and the fixture home, the journal's file name) in the 503 answer | `{"ok":false,"error":"write-failed","detail":"the write failed at its append step"}` (both cases of the first two) and `… "detail":"the write could not begin"}`: fixed words. No digit literal is searched in this file | Cannot collide: no random or clock value, and the literals hold letters no hex id or time can. Unchanged |
| `server/test/codex-bridge-backend.test.ts`, "the forbidden keys are never sent" | `32000` (the request's `max_tokens`) in the sent body | The fixture's model, texts and effort, the bridge's own words, and `prompt_cache_key`: with no session id, `ccrc:anon-<uuid4>` (measured: `ccrc:anon-8d773b10-460f-4097-a2e5-5c8c22c5f467`). Its random hex can hold five digits in a row (twelve places, each about one in a million) | Can collide. Fixed |

**The fix**, as #3674 fixed the admin routes case: the cache key is held to its form first (the uuid4 grammar with no session
id; exactly `ccrc:<session>` with one) and replaced by a placeholder, and the search runs over what is left. The case now runs
twice (`it.each`): the second row sends the session id `sess-32000`, so the cache key holds the digits.

| Row | Mutant | Before the fix | After the fix |
|---|---|---|---|
| C1 | the forced collision (session id `sess-32000`) | 1 of 2 red | 0 of 2 red |
| C2 | the bridge writes the request's `max_tokens` into the model it sends (`ccd/codexbridge/inbound.py`, `from_anthropic`) | 1 of 1 red (the case as it was) | 2 of 2 red |

**Noticed, not widened:** `collect-lane-route`'s "neither verb consults the box token" compares the whole answers for three
token headers by equality. That is not a search, and whether its GET view carries a clock value was not measured here.

## Departures (slugs)

- `w2-request-record-a4-corrections-carried-here` and `w2-carries-1-corrections-carried-here`: the corrections are written above
  for the fold, not edited in place (ledger guard).
- `boot-line-correction-of-point-3`: a fourth correction of the w2-request-record-a4 note, for the line's own words that task 1
  changed; the brief named three.
- `w2-carries-1-what-it-checks-corrected`: a second correction of the w2-carries-1 note, for the two sentences task 2 made
  untrue; the brief named T2's only.
- `bridge-collision-forced-by-session-id`: the bridge's uuid cannot be chosen from the test, so the forced collision sends a
  session id holding the digits, which the bridge sends as the cache key. The search treats both forms of the key alike.
- `probes-by-failing-assertion`: the searched text in task 3 was read by temporary failing assertions in the three files, each
  removed; the files were checked byte-identical to the branch's text afterwards (`git status`).
- `server-test-typecheck-narrowed`: the server's whole test type check was not run (the test slice's memory cap has killed it
  before); the three touched test files and the touched source file were type-checked alone, clean. CI's typecheck runs the whole.

## Harness dependence

None added: the three tasks change tests, comments and one boot line's words; nothing depends on one agent harness.

## Verified

Each file alone through the fleet test wrapper, two workers at most, fixture homes only:

- `request-citations-boot` 43 of 43 (it reads the composition root as text, so a pull request's fast run may not select it: run
  here); `sequence-stamp-census` and `operator-model-boot`, which read the boot pass, 38 of 38;
- `testbox-admin-routes` 45: 44 and 43 on two loaded runs, the reds being two other cases' 20-second timeouts ("a timeout, a lost
  answer and an output past its cap …" and "an agent without the op …"), each green alone; the changed case green in every run;
- `codex-bridge-backend` 31 of 31;
- the narrowed type check of the four touched files, clean.

## Known limits

- The admin routes case does not search the actor's tail (task 2, A2).
- `fleet-health` and `collect-lane-route` are unchanged on a measured argument: a later change that puts a random id or a clock
  value into those answers would reopen the question.
