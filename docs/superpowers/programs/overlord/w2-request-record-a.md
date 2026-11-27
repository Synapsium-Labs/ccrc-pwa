# W2 request record, PR A (first part): task note

The task note of the W2 piece "Request record", PR A, first part: plan
[`w2-requests.md`](../../plans/2026-11-16-overlord-w2/w2-requests.md) Tasks A1 to A3, with the W2 index's row "Request
record". It records what Step 0 measured on `main`, what was built, the index-row differences the coordinator ruled,
every departure by slug, the mutation rows, what later pieces read from this one, and the known limits. The coordinator
folds it into the programme ledger; this pull request edits no plan, spec or ledger.

**The split (coordinator's ruling on size).** PR A passed about 2,500 changed lines before Task A4, so it is two pull
requests. This one carries Tasks A1 to A3, the record. Task A4 (the private store's citing reader, the boot pass's spend
arm and restore floor, and I12's predicate) is built, held locally and never pushed, and follows as its own pull request
once this one and #3488 are on `main`.

## 1. Step 0: what `main` held

Measured at `5576023f25` (2026-11-27).

| Question | Answer on `main` |
|---|---|
| The coordination database's migrations | 133 entries. This piece takes the next free slot by position; whoever lands second renumbers. |
| `REQUEST_TRANSITIONS`, its store, its tables | None: every file and table here is new. |
| The sequence kinds | `generation`, `designation`, `message`, `ladder-rung`, `ladder-latch`, `readiness`. This piece adds `request`. |
| The row-revision census | Typed over `asks` and `operator_items` only. |
| I12 | A row of `INVARIANT_MAP` with `waitsOn: 'W2, the requests'`, `w1: 'tables-absent'`; the predicate map held four rows (I2, I5, I7, I17). |
| The simulator's own I12 model | None under `server/test/sim/`: the only I12 references are the row lists in `invariantSets.ts`. |
| A message state named `gone` | None (`MESSAGE_STATES` ends at `spent`). No state was built for it; a cited id with no row is the citation decider's `absent` arm, never folded into another. |
| For the second part | The private store's boot pass re-judges `settled` rows only, with a W1 citations port answering `not-applicable`, and has no reader for the rows a spend arm needs. Its one message mover that stamps the sequence line is `messageLine.ts#moveOperatorMessage`. |

## 2. What was built

- **L0, `shared/overlordRequests.ts` (Task A1).** The ten states, the four actors, `REQUEST_TRANSITIONS` (27 moves), the
  derived open and terminal states, the unclocked states, the one entry rule (`transitionEntersNeedsYou`,
  `requestMoveEntersNeedsYou`), `REQUEST_MOVE_FIELDS` and `REQUEST_MOVE_REQUIRED_FIELDS`, the reason map, the bounds,
  the windows, `REQUEST_ACTOR_SEQUENCE_KIND`, `RequestOrigin` and `ExpectedPath`. Every list derives from its key map or
  from the table.
- **L1, `server/src/coord/overlordRequests.ts` (Task A2).** `nextRequestState` with its guards in order (taken,
  not answered, not from, wrong actor, not taken from, not acknowledged, has open children, has children, the fields,
  the reasons), `openMoveVerdict`, `followUpAfterMove`, `parentClockAfterChildMove`, `answeredSinceNeedsYou`,
  `closeUnownedVerdict`, `citationVerdict` and `nextRequestId`. Pure: no clock, no `node:*`.
- **L3, `server/src/coord/overlordRequestStore.ts` (Task A3).** The one owner of the three tables' SQL:
  `planRequestInsertInTx` and `applyRequestInsertInTx`, `planRequestMoveInTx` and `applyRequestMoveInTx` (each apply
  re-runs its plan and throws if it disagrees), the private `appendMove`, `setParentClockInTx` and `stampRequestLine`,
  and the readers `requestById`, `movesOf`, `openRequests`, `highestRequestId` and `citedMessagesForBoot` (three
  answers: measured, absent, unmeasured; its consumer is the second part).
- **The migration:** `overlord_requests`, `overlord_request_messages` and `overlord_request_moves`, four indexes, the
  partial unique `overlord_request_messages_one_root`. No CHECK holds a word or a close note.
- **The sequence:** the `request` row of `SEQUENCE_KIND_MAP`, the stamp census's `request` row and its helper.
- **The censuses:** the writers map (three tables), the stamp census, the row revisions (widened to `overlord_requests`,
  the move writer alone raising, with three new controls), the coord ring's handle list (`core-vocab`), and the new
  call-site census `request-move-callers.test.ts` (an empty map: nothing calls a planner yet).
- **The floors:** the eight deciders join `MUTANT_SETS` through `REQUEST_MUTANT_SETS`, each at floor 1.
- **I12 at this tip:** its row now reads `w1: 'predicate-not-built'`, waiting on this piece's second part, because its
  table is migrated here and its predicate is the second part's.

Nothing is reachable at merge: no route, door or lane calls the planners, so no row is written until PR B's doors exist.
This is the product's own tables and deciders (the programme's design rule): nothing here depends on one harness.

## 3. Item 1, as ruled

The coordinator said yes to P1 to P6, with any child for P1 and the wide reason map for P5. Each is a departure from the
plan's text, following the index's later sentence.

| Slug | Index sentence it follows | What was built |
|---|---|---|
| `guard-8-refuses-a-parent-route` | "its guard 8, which refuses `route`, `route-elsewhere` and `re-relay` on a request with children with `bad-transition`, detail `has-children`" | Guard 8 reads `hasChildren`: any child row, open or ended. Internal word `has-children`. |
| `taken-from-cleared-leaving-needs-you` | "clearing `takenFrom` on every move out of `needs-you`" | The move plan clears it on every move whose row leaves `needs-you`; `answer-recorded` keeps it; `take` sets it from the state it left. Tested through `resume-parent`. |
| `relay-held-enters-needs-you` | "`answeredSinceNeedsYou`, which reads relay A's `relay-held` move as entering `needs-you`" | One rule: a move enters `needs-you` when its row's `to` is `needs-you` and its `from` holds another state. The answered-since read and the reason check both ask it; a case builds a synthetic self-loop row from `needs-you` that enters, and `answer-recorded` does not. |
| `entering-needs-you-carries-a-reason` | "every move that enters `needs-you` from another state carries a reason, so the `answer-recorded` self-loop is exempt" | `reason-required` and `reason-not-allowed`, internal words, decided read-only in the plan before any append; the store test proves a refused move writes nothing. |
| `reason-map-is-the-one-home` | "`REQUEST_MOVE_REASONS` (the coordinator doors' words, `restore` and `off-after-decline` among them)" | The wide map of §3.1, each word with the moves that may carry it. |
| `counter-sets-counters` | "`REQUEST_MOVE_FIELDS` (`counter` includes `counters`)" | `RequestColumn` gains `counters`; `counter` appends one entry. |

### 3.1 Where each reason word comes from

No word was coined here. Each is copied from the plan that names it.

| Word | Move | Source |
|---|---|---|
| `needs-start`, `needs-proposal`, `unnamed-widening` | `escalate` | `w2-requests.md` §5 "Move reasons" and RQ13; the index's question 7 (ruling F6) |
| `dropped` | `drop` | `w2-requests.md` RQ17 |
| `outside-goals`, `goal-conflict`, `impossible`, `duplicate` | `decline` | `w2-coordinator-doors.md` RD9 |
| `two-counters` | `needs-you` | `w2-coordinator-doors.md` RD7 (the second counter's server move) |
| `two-silent-nudges`, `due-unarmed` | `needs-you` | `w2-follow-up.md`, its vocabulary interface ("`REQUEST_MOVE_REASONS` gains") |
| `off-before-ack`, `off-after-decline` | `needs-you` | `w2-overlord-route-v1.md` Table RV2 |
| `restore` | `needs-you` | `w2-act-journal.md`, Confirm the restore's request moves |
| `child-ended`, `dependency-ended` | `needs-you` | `w2-done-tests.md` §7 "The move reasons" |
| `operator-took-it` | `take` | `w2-operator-request-doors.md` OD9 |

Relay A's `relay-held` and its three words stay relay A's: the move is not in this piece's table.

## 4. Other departures

- **`open-is-its-own-verdict`.** The insert checks its actor through `openMoveVerdict`, because `nextRequestState` reads
  a row's state and `open` has none; `nextRequestState` answers `not-from` for `open`.
- **`a-required-field`.** `REQUEST_MOVE_REQUIRED_FIELDS` holds `drop`'s `closeNote` (Table 5.1a: "A drop carries the
  dropper's reason"), and the decider answers `field-required` (internal) when it is missing.
- **`plan-refuses-bad-fields`.** Both plans refuse an ill-shaped input with the internal word `bad-field` (a summary or
  close note past its bound, a repeated cite, a root that cites as a child, an origin that does not match its cites),
  read-only and before any append, beside the unique index's backstop.
- **`parent-clock-reads-the-clocked-set`.** `parentClockAfterChildMove` gives a parent its clock back when it is in any
  clocked open state (open, minus `needs-you`, `done-unverified` and `blocked`), where the plan names `received` and
  `in-progress`. Guard 8 keeps a parent out of `routed` and `declined`, so the two agree in practice, and the set is the
  one I12 reads.
- **`a-word-this-build-lacks`.** A stored state word this build cannot name is carried as text: no move leaves it
  (`not-from`), `openRequests` counts it as open, and a stored `takenFrom` it cannot name reads as taken. Each is the
  closed direction.
- **`citation-at-is-the-citing-time`.** `overlord_request_messages.at` is when the request cited the message; the
  24-hour window is judged at the door from the message's own `at`, and never written (RQ11).
- **`i12-row-before-its-predicate`** (coordinator's split). At this tip I12's row reads `predicate-not-built`, waiting on
  this piece's second part, since its table now exists.
- **Process.** Two edits were made with a script rather than the Edit tool, against the brief's first sentence: the
  `request` row of `shared/overlord-sequence.ts` (by me), and one replace in `server/test/requestCases.ts` (by an
  implementer subagent). Both are in the files as committed and were reviewed in the diff.

## 5. Mutation rows

Every decider registered at floor 1; each set was run through the floors' own runner, and every mutant was killed.

| Decider | Mutants | Before | After |
|---|---|---|---|
| `nextRequestState` | 36 | not registered | 1 |
| `openMoveVerdict` | 4 | not registered | 1 |
| `followUpAfterMove` | 8 | not registered | 1 |
| `parentClockAfterChildMove` | 5 | not registered | 1 |
| `answeredSinceNeedsYou` | 9 | not registered | 1 |
| `closeUnownedVerdict` | 9 | not registered | 1 |
| `citationVerdict` | 28 | not registered | 1 |
| `nextRequestId` | 7 | not registered | 1 |

One mutant is left out on purpose: dropping the entry rule from the reason guard is equivalent today, because every
move that enters `needs-you` already carries a reason word. It becomes killable when one does not.

Hand mutations on the guards (each reds, then restored): `hand-back-blocked` pointed at `routed` (two cases red);
`done` added to `withdraw`'s `from` (three red); the revision raise removed from the move writer, a raise added to the
parent's clock stamp, and an unclassified `UPDATE` of `overlord_requests` (the row-revision census's three new
controls); a caller with no row, a non-literal actor and a wrong literal (the call-site census's controls).

## 6. What PR B and the later pieces read from this one

| Reader | What it reads |
|---|---|
| This piece's second part (Task A4) | `citedMessagesForBoot` for the boot pass's measured adapter, `openRequests` for I12's gatherer |
| PR B, the Overlord's four doors | `planRequestInsertInTx`/`applyRequestInsertInTx`, `planRequestMoveInTx`/`applyRequestMoveInTx`, `citationVerdict`, `closeUnownedVerdict`, `nextRequestId`'s second argument, `ESCALATE_REASONS`, `REQUEST_BOUNDS`, `ExpectedPath`; each door adds its file's row to `request-move-callers.test.ts` |
| Relay A | The move writer with `route`, `re-relay`, `route-elsewhere`; it adds `relay-held` and its three reasons as rows, and needs no edit of the entry rule |
| Coordinator doors, done tests, the operator's doors, the follow-up, overlord-route-v1 | The move writer with their moves; their reason words are already rows here (§3.1) |
| Request ids A, the follow-up | Their bookkeeping writers join this store, each classified `bookkeeping` in the row-revision census |
| Act journal B | `nextRequestId(storeHighest, journalHighest)`'s second argument after a restore |
| Later feeds and the chat's off-the-record mark | The record keeps message ids and hashes, never text; a later feed reads a message's off-the-record mark through the cited id |

## 7. Known limits

- **Id reuse without the journal's highest.** Until act journal B supplies `journalHighest`, the store's highest is
  `max(id)`, so a top row deleted by hand would be reissued. No writer deletes a request.
- **The tests' type check** cannot run on the test box (no `typescript` for the console package there); CI's typecheck
  is its arbiter. The server's own type check is clean.
- **No caller yet.** Every planner is tested through the store test only; the doors' cases arrive with PR B.
- **A gap for a ticket: `tables-absent` is not checked against the schema.** Nothing holds that a row of
  `INVARIANT_MAP` marked `tables-absent` names no table the coordination schema has (the I12 row read so until this tip).
  It is more than a few lines: a row's `tables` are prose words (`hold rows`, `requests`, `act rows`), with no map to the
  schema's table names, so the check needs that map first.
