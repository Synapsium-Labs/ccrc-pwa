# Overlord W1, sequence PR B1: every W1 change is stamped (wave 233, run 3820)

The plan is `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` (its Global Constraints, questions 2, 6, 8
and 17, and Task 5's paragraph "The ladder's lines first"). The coordinator split the plan's PR B in two (call 1216): this run
completes what is stamped, and run 3821 (wave 234) builds the invariant monitor at the same time. No deviation number was
allocated for this run: departures are recorded by slug below.

Measured against `main` at 911372c399. The plan and the review reports (3646, 3675, 3740) are snapshots; where `main` differed,
each piece says so.

## The six pieces

### 1. The operator-message movers stamp (review 3646 F2)

**Where main differed.** No mover has a coordination transaction that commits together with its move. The prompt route's
`queueOperatorNudge` and the boot pass's queue arm commit their coordination transaction *before* the private store's move; the
mail lane's `markDelivered` and `markAcked` are separate transactions on either side of its move (and `tx()` does not nest); a
session's own ack of its nudge (`settleAckedOperatorNudge`, a mover the review's list did not name) moves after the ack route's
transaction committed; the boot pass's unsettle, linked-queue and deliver arms and the hook's pick-up have none at all. The
finding went to the coordinator before any line was written.

**Ruled (call 1218, proposal A).** One rule for every message line: the line is stamped in a coordination transaction of its
own, right after the private move commits, in the same synchronous segment, only when the move changed the state word. Built as:

- `stampMessageLine` (`server/src/coord/overlordSequenceStore.ts`), the one caller of the writer for the `message` kind. The
  acknowledgement's `stampInboxAcknowledgement` is now its `settled` / `acknowledge` case and keeps PR A's door and answer.
- `moveOperatorMessage` and `stampOperatorMessageLine` (`server/src/operatorModel/messageLine.ts`, ring L4, context C11): the
  private store's move, answered exactly as the store answered it, then the line when `from` differs from `state`. The store's
  move answer gains `from` (the state it moved from; `unknown` when the stored word is unreadable).
- Every mover goes through it: the prompt route (`queued`, and a marked message's `settled` line written right after its record
  commits), the mail lane and a session's own ack (`delivered`; no line when the pick-up came first, because a deliver after the
  pick-up leaves the state word `picked-up` and only a move that changes it is stamped), the boot pass (`queued`, `delivered`, and
  the unsettle's delivery stage), and the hook's pick-up (`picked-up`, through the continuity routes' port composed in
  `server/src/server.ts`; only the hook writes a `picked-up` line). Creation as `recorded` stamps no line (slug
  `recorded-creation-stamps-no-line`).

What each mover answers when its line is refused or fails (condition 3): exactly what it answered before. The prompt route answers
200 with the state the move reached; the mail lane still acks the delivery; the ack route answers as before; the boot pass's
counts are unchanged and the log line joins its own lines; the report route answers 200 with `changed`. In every case one
`ccrc-server: operator message <id>: its sequence line (<state>) was not written (<why>)` line is written, with the id and the
state only, never the words (the boot pass takes the line's own prefix off, since the boot prints each of its lines with one;
review 3852 F4). Only the line's own transaction rolls back.

Two cases drive the production bindings end to end (review 3852 F6): the real watcher's mail pass, and the real acknowledgement
route through `buildServer`, each on a real coordination store, write the deliver move's line into that store
(`overlord-prompt-record.test.ts`).

### 2. The census sees the movers' callers (review 3646 F8)

`server/test/sequence-stamp-census.test.ts` now pins, both ways: every caller of the private store's `moveMessage` in
`server/src` (`MESSAGE_MOVERS`: the combinator and the acknowledge door), every caller of the combinator (the boot pass, the mail
lane's deliver, the prompt route, `server.ts`'s pick-up port), the callers of `stampOperatorMessageLine`, and the callers of
`stampMessageLine`. Each list counts the calls in each symbol (review 3852 F1: the boot pass's three arms are three), so a new call
that moves a message (a W2 citing door, say) goes red until it is listed with how its line is written, whether it sits in a new
function or beside a listed call in one already listed, such as the inbox routes' registrar. The scanner names a call by its
rightmost identifier, so an alias of the function, a bracket access (`store['moveMessage']`) or a `.call`/`.apply` spelling still
escapes it. The `message` row's reasons are reworded to what is true now.

### 3. The ladder's writers stamp (slug `ladder-stamps-ride-pr-b`)

**Where main differed.** #3370 added the authority witness and the ladder's two rows; the writers are still `setRungInTx`,
`raiseLatchInTx`, `clearLatchInTx` and `applyRestoreInTx` (plus the catch-up `journalPendingInTx`). The unwitnessed-writes latch
is raised with the *calling session's* actor (the gate runner records a witness check with `caller.actor`), which the coordinator
ruled on (call 1220).

Each writer stamps through `stampLadderLine`, inside its own transaction, after its row; a refused stamp throws
`LadderStampRefused`, so the row rolls back with it (and the guard is fenced when a journal record preceded it). The rung door
and the latch clear door answer a refused line as they answer the ladder's other store failures, `unavailable` with the detail
`the ladder line could not be written`, never a bare 500 (review 3852); the latch raisers already caught and logged it. The catch-up stamps only a record's sequence and writes no line; Confirm's
narrowed cap and its sequence stamps write none either. Five ladder test fixtures that built the ladder's tables without the
sequence's gained the sequence table (slug `ladder-fixtures-carry-the-sequence-table`).

### 4. The journal's receipt duty (review 3646 F4)

`txWithAuthorityReceipt` (`server/src/coord/overlordAuthorityJournal.ts`) is the designation store's transaction-with-receipt,
lifted to the journal's side: `write` runs in one `tx()` with an appender that remembers each durable append's receipt, and a
throw calls the receipt after the rollback is attempted, then propagates the first error. The designation's `txWithAuthorityStamp`
now delegates to it (its own commit, with no behaviour change: the designation, rebind, journal and Confirm suites unchanged and
green). The ladder's three door writers (the coord store's `setRung`, `raiseLatch` and `clearLatch` delegates) and the
decision-model arming store (`inTx` and `move`) open their transactions through it. The journal's duty paragraph names all three.

**Size.** 44 product lines added and 26 removed across the four files (net 18), under the brief's forty-line stop.

### 5. Sequence A's carried cases (review 3675 F2)

Cases only, in `server/test/overlord-confirm-sequence.test.ts`; `main`'s code was already right:

- part 1: a clearing Confirm over a present row holding neither a binding nor a pending attempt stamps no designation line;
- part 2: the pending-only shape's refused stamp rolls back everything but the Confirm record and fences the guard exactly once
  (counted), with nothing offered;
- part 3, as the report words it: a body only the journal binds, ended by Confirm, gets its generation's `ended` line and an owed
  stop, and no designation line. The case pins today's answer on the coordinator's word in this run's brief; review 3675 marked
  its F2.3 as needing a ruling, and no ruling beyond the brief is cited.

The three bound-shape Confirm cases now also expect Confirm's ladder line (the rig has no ladder row, so the stricter rung `off`
is written and stamped as Confirm's).

### 6. The kept line after a rebind (review 3740 F2, call 1077)

**Where main differed.** `main` already kept *two* designation lines from retention (the newest, and the newest `live`), and
`main`'s rebind go-live stamps the old body `retired` before the new body `live` (review 3740 saw the other order at its tip).

`keptDesignationLine` (`server/src/coord/overlordSequence.ts`, L1) decides the one kept line: the newest `live` line while a
binding stands (no later `retired` line of the same id), else the newest line. Retention's `sequenceOldest` marks exactly that
line `keep`, and the new baseline read `designationBaseline(db)` (`overlordSequenceStore.ts`) answers it as served, `null` when
no designation line stands, or `unmeasured`. Cases: after a rebind's go-live (either stamp order), while a rebind is pending,
after a failed rebind, after a retire with no binding, and a retire while a rebind is pending.

## The kind table

No line any B1 writer stamps carries actor kind `session`.

| Kind | Id | States | Stamped by | Actor | Actor kind |
|---|---|---|---|---|---|
| `message` | the message id | the state the move reached: `queued`, `delivered`, `picked-up`, `settled`, the unsettle's stage (`recorded`, `queued`, `delivered`, `picked-up`) | every mover, after its move commits (piece 1) | the move's actor word: `route`, `mail-lane`, `boot-pass`, `hook`, `acknowledge` | `server` (call 1218: the pick-up and the self-ack are driven by the session the message went to, which after a rebind may no longer be designated) |
| `ladder-rung` | `operator` | `RUNGS`: `off`, `chat`, `advise`, `full` | `setRungInTx` when it writes the row (a row-only narrowing too) | the row's actor (the account gate's operator, the console's brake subject, `flag-off`, `unmeasured`, or a lane) | from the writer's input actor (the row has no kind column): `operator` for the account gate and the console; `server` for a lane |
| `ladder-rung` | `operator` | as above | `applyRestoreInTx` when it writes the rung row | `restore` | `server` |
| `ladder-latch` | the cause | `raised` | `raiseLatchInTx` | the row's `raisedBy` as recorded (a lane, the server's authority actor, or the tripping session for the unwitnessed-writes latch) | `server`, always (call 1220) |
| `ladder-latch` | the cause | `raised` | `applyRestoreInTx`, for a journal-only latch it inserts | `restore` | `server` |
| `ladder-latch` | the cause | `cleared` | `clearLatchInTx` | the operator | `operator` |

`LADDER_LATCH_SEQUENCE_STATES` (`raised`, `cleared`) lives in `shared/overlord-sequence.ts`, because the ladder's latch rows carry
no state column (a latch stands while its clear is unset). The table went to run 3821 by mail before it was fixed in code.

## Departures, by slug

- `message-lines-stamp-after-the-move` (call 1218): the plan's question 17 makes the acknowledgement the one line written in a
  second transaction, and question 31 has the delivery, the nudge and the settlement mark stamped by the coordination transaction
  that causes them. `main` has no such transaction committing with any move, so every message line is written after its move, by
  one helper. A line can be missing; it is never written for a move that did not commit.
- `latch-lines-are-the-servers` (call 1220): the plan's question 6 has a line copy the row's actor and its kind. A latch raise's
  line carries the server's kind whoever tripped it, because a check raises a latch, never a session's ask; the row keeps its
  raiser and the line keeps the row's text. The line's verdict ties no text shape to a kind, so the session's subject is the
  line's actor text.
- `recorded-creation-stamps-no-line` (call 1293): the plan's question 2 writes a line when a row is created. A message created
  `recorded` writes none: creation of a recorded message is not a move, and call 1218 stamps moves. A reader takes a recorded
  message with no line as not yet moved, never as a missing line. A marked message, created `settled`, gets its `settled` line.
- `ladder-line-kind-from-the-writers-actor` (call 1293): the plan's question 6 takes a line's actor kind from the row being written.
  The ladder's rows have no kind column, so a ladder line's kind comes from the writer's input actor and exists only on the line
  (`ladderActorKind`); a latch raise is always the server's (above).
- `kept-line-is-the-standing-binding` (call 1077): retention keeps one designation line, the standing binding's `live` line,
  where `main` kept two.
- `receipt-lifted-to-the-journal`: the lift generalises the helper's signature (it takes the appender, not an `add` callback), so
  the first commit is a lift with the designation delegating, not a byte-for-byte move. Its four receipt mutants moved with it
  (below).
- `ladder-latch-states-in-the-sequence-file`: the latch's two words are named beside the kind, in `shared/overlord-sequence.ts`,
  since the ladder has no state word for a latch and its L0 file was held by run 3821.
- `sequence-kinds-are-stamp-words`: `isSequenceStampKebab` also admits the sequence's kind names, so the coordination kebab scan
  reads `ladder-rung` and `ladder-latch` as a line's labels, never as refusal codes.
- `ladder-fixtures-carry-the-sequence-table`: five ladder suites' fixtures gained the sequence's table.

## Peer packets (each agreed before the edit, applied exactly)

| File | Holder | Packet | Answer |
|---|---|---|---|
| `server/test/sim/sequenceSets.ts` | run 3821 | the ladder kinds' cases, `keptDesignationLine`'s cases and seven mutants | yes, apply on B1; 3821 stays out of the file |
| `server/test/sim/mutation-floors.json` | run 3773 | one added key, `keptDesignationLine` | yes, apply on B1 |
| `server/src/coord/store.ts` | run 3819 | the three ladder delegates through the receipt, one import | yes, apply on B1 |
| `server/src/server.ts` | run 3796 | the pick-up port through the combinator, one import | yes, apply on B1 |

The diff adds a second key to `mutation-floors.json`, `txWithAuthorityReceipt` (piece 4). No agreement covers it: it was committed
at 15:07Z, after run 3773's PR (#3377) merged at 14:59Z, without a second packet, and I did not measure then whether the file was
still held. Run 3821 has held the file since 15:44Z; the fix round told it of the key (review 3852 F10).

Run 3821's own packet (`OVERLORD_ITEM_PROGRAMME` at the foot of `shared/overlord-sequence.ts`) was answered yes: it commits it on
its own branch.

## Mutation tables

Each mutant was run by replacing its text once, running the named file through the fleet test wrapper, and restoring the exact
bytes (checked by hash; the tree clean after each batch). Before: the file green. After: the failures named.

| Id | Mutant | File run | After |
|---|---|---|---|
| M1 | a line for every accepted move | `operator-message-line` | killed, 2 failed |
| M2 | the combinator never stamps | `operator-message-line` | killed, 9 failed |
| M3 | a refused stamp is not logged | `operator-message-line` | killed, 1 failed |
| M4 | the marked message's settled line dropped | `operator-message-line` | killed, 1 failed |
| M5 | the mail lane bypasses the combinator | `operator-message-line` | killed, 1 failed |
| M6 | the boot pass's deliver arm moves unlisted | `sequence-stamp-census` | killed, 1 failed |
| M7 | a message line takes the session's kind | `operator-message-line` | killed, 7 failed |
| M8 | the boot pass's queue arm bypasses the combinator | `operator-message-line` | killed, 1 failed |
| M9 | the hook pick-up bypasses the combinator | `continuity-report-route`, census | killed, 3 failed |
| L1 | `setRungInTx` stamps nothing | `overlord-ladder-store` | killed, 6 failed |
| L2 | a latch raise stamps nothing | `overlord-ladder-store` | killed, 6 failed |
| L3 | a clear stamps nothing | `overlord-ladder-store` | killed, 3 failed |
| L4 | Confirm's rung stamps nothing | `overlord-ladder-store` | killed, 3 failed |
| L5 | Confirm's inserted latch stamps nothing | `overlord-ladder-store` | killed, 1 failed |
| L6 | a refused ladder stamp is ignored | `overlord-ladder-store` | killed, 7 failed |
| L7 | a latch raise takes its raiser's kind | `overlord-ladder-store` | killed, 3 failed |
| L8 | a lane's rung brake is the operator's | `overlord-ladder-store` | killed, 1 failed (survived until the lane-brake case was added) |
| S2 | `setRung` opens a bare transaction | `overlord-ladder-store` | killed, 1 failed |
| S3 | `raiseLatch` opens a bare transaction | `overlord-ladder-store` | killed, 1 failed |
| S4 | `clearLatch` opens a bare transaction | `overlord-ladder-store` | killed, 1 failed |
| A1 | the decision transaction opens bare | `decision-model-arming` | killed, 1 failed |
| A2 | the one-move door opens bare | `decision-model-arming` | killed, 1 failed |
| P1 | Confirm stamps `retired` for every id the journal names | `overlord-confirm-sequence` | killed, 3 failed |
| P2 | the neither shape stamps its last attempt `retired` | `overlord-confirm-sequence` | killed, 2 failed |
| P3 | Confirm fences twice | `overlord-confirm-sequence` | killed, 1 failed |
| P4 | the pending-only shape stamps nothing | `overlord-confirm-sequence` | killed, 2 failed |
| K1 | the kept line is the newest line | sequence store, rebind | killed, 5 failed |
| K2 | the read window starts after the live line | sequence store, rebind | killed, 6 failed |
| K3 | the baseline read answers none | sequence store | killed, 5 failed |
| K4 | retention keeps nothing | sequence store, rebind, retention lane | killed, 8 failed |
| C1 | a second `moveMessage` call inside the inbox routes' registrar | `sequence-stamp-census` | killed, 1 failed (survived the census before review 3852 F1: 8 of 8 green) |
| C2 | a second combinator call in the mail lane's deliver | `sequence-stamp-census` | killed, 1 failed |
| C3 | a second line-stamp call in the combinator | `sequence-stamp-census` | killed, 1 failed |
| G1 | the rung door does not catch a refused ladder line | `overlord-ladder-route` | killed, 1 failed (a bare 500) |
| G2 | the latch clear door does not catch a refused ladder line | `overlord-ladder-route` | killed, 1 failed (a bare 500) |
| W1 | the mail pass hands the lane another database (`watch.ts`'s `settleNudge` binding) | `overlord-prompt-record` | killed, 1 failed |
| W2 | the ack route hands the lane another database (`coord/routes.ts`'s `settleAckedOperatorNudge` binding) | `overlord-prompt-record` | killed, 1 failed |
| B4 | the boot pass keeps the message line's own prefix | `operator-model-boot` | killed, 1 failed |

The L counts are measured at the fix round's tip (review 3852 F11); round 1's note had counts from before the three receipt door
cases were wired. M9 and A1, A2 were S1 and D1, D2 in round 1, renamed so no id is used twice. W1 and W2 were run against held files
(`watch.ts` and `coord/routes.ts`, run 3796's) in this worktree only and restored by hash; neither file is in the diff.

In the PR's commit order the `keptDesignationLine` floor key lands one commit before its set, so `mutation-floors` is red between
those two commits; at the tip it is green.

The mutation floors (`server/test/sim/mutation-floors.test.ts`), keys added only, no floor lowered:

| Key | Mutants | Score |
|---|---|---|
| `server/src/coord/overlordSequence.ts#keptDesignationLine` (new) | D1 to D7 | 7 of 7 killed, floor 1 |
| `server/src/coord/overlordAuthorityJournal.ts#txWithAuthorityReceipt` (new) | R1 to R4 (the fence set's F1, F2, F4 and F5, moved), R5, R6 | 6 of 6 killed, floor 1 |
| `server/src/coord/overlordDesignationStore.ts#txWithAuthorityStamp` | the three `withoutFence` mutants and F6 (F1, F2, F4, F5 moved to the receipt set) | all killed, floor 1 unchanged |
| the four sequence keys on `main` | their sets, with the ladder kinds' cases added | all killed, floors unchanged |

## What a merge arms

From the merge on: every rung or latch change and every Confirm that writes a ladder row writes a line; every operator-message move
that changes its state word writes a line after its move; retention keeps one designation line, the standing binding's. Nothing
reads the new lines but the tests until run 3821's monitor lands, in shadow. No route, setting, table or migration is added.

**A quiet hour.** Measured once, on a fixture that is not committed (review 3852 F12): a designated session, the boot pass once,
sixty minutes of the mail lane settling an ordinary mail and a fixed line, and sixty ladder reads wrote **0** lines. By reading, the
same holds: ladder reads never write, an ordinary mail and a fixed line never reach the line writer, and an empty boot pass moves
nothing. B1's writers write only on an operator's prompt, a
message's delivery, pick-up or ack, a rung or latch change, or Confirm; PR A's generation lines are unchanged.

## Known limits

- A message line is missing for good if the process stops between the move's commit and its stamp, or if its stamp is refused;
  nothing heals it. A reader takes a stored state with no line as `unmeasured`, never a violation (the coordinator carries this to
  the message predicates' ticket).
- Whether a pending designate's session can reach the witness path (and so trip the unwitnessed-writes latch) is **unmeasured**.
  The latch line takes the server's kind either way (call 1220).
- The acknowledge door keeps PR A's own path and answer (503 when its line is refused); it does not go through the combinator.
- Creation as `recorded` stamps no line (`recorded-creation-stamps-no-line`).
- Locally, the mutation floors' two `pwa/src/face/mood.ts` sets fail their baseline because this checkout's test-box copy has no
  `@ccrc/ui` package; they are not touched here.
- The judge's `test-weakened` reasons (non-blocking) on the rebind, sequence-store and sequence suites are the ruled changes, not
  a lost check: retention keeps one designation line where `main` kept two (call 1077), and the sequence's example of an unknown
  kind moved from `ladder-rung`, now a real kind, to `grant`. Each changed case still goes red against its mutant (K1 to K4).
- CI's first run on this PR found test fakes in suites this PR did not edit that no longer type-checked (the mail lane's port and
  the move answer's `from`); the local type check had been narrowed to the edited test files when the memory cap killed the whole
  one. The fix round re-ran it over every test file that imports a changed module.
