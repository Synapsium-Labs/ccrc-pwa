# Overlord W2: the request record, its moves and the Overlord's request doors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## In short

- **What this is.** The plan for the W2 piece "Request record" (the W2 index, Table W2, lane R). It is the spine every
  request piece waits on: one table of requests, one table of moves, one writer that moves a request, and the
  Overlord's four request doors. Two pull requests, nine tasks: PR A four, PR B five.
- **PR A, the record.** `overlord_requests`, its cited messages and its moves, in one migration. `REQUEST_TRANSITIONS` in
  a new `shared/overlordRequests.ts`, shaped as `shared/ledgers.ts#ITEM_TRANSITIONS`, with its tests: no open state
  without an exit, hand back as three rows, and close and close unverified apart. One move writer stamps the `request`
  row of `SEQUENCE_KIND_MAP`, raises `revision`, and sets the follow-up clock, a parent's included. Each writer is a
  read-only plan and an apply that cannot refuse, so nothing refuses after the act journal's record (RQ18). One message
  founds one root request within 24 hours. The private store gains a citing reader that never hands out the text, and
  its boot pass gains the measured citation reader, the `spent` arm and the restore floor. I12's predicate joins
  sequence B's invariant table.
- **PR B, the doors.** Open, drop, `close-request` and escalate (index questions 2 and 7), each with its
  `OVERLORD_DOORS` row through `overlordGateRun` and an act row per move. `said-not-operator` on a bad citation, and
  `operator-has-it` on a stale revision. The code shortlist (ruling F5): a pure decider that names at most six candidate
  programmes from `expectedPaths`, live claims and history's `touched`, which the open door returns and asks
  `programme.pick` about. History is read once per open, under a budget sized to the agent's one history slot. Their
  `ccrc-api` verbs and `DOOR_TOOLS` rows.
- **Q28 is built as ruled.** A request that needs a start or a proposal goes to the operator through the escalate door,
  and nothing raises an item before W3.
- **What changes at merge.** Nothing a running session sees. PR A writes no row until a door exists. PR B's doors refuse
  `capability-missing` naming `overlord-route-v1` until the index's last piece ships that word.
- **What the reader must check.** Nineteen questions (§2). Five are ruled by the coordinator: question 13, and in fix
  round 1 (review 2273) questions 5, 6's parent clock, 18 and 19. The rest carry a recommendation. None is for the
  operator.

## 1. Goal, scope and the rulings this plan builds on

This section says what the piece builds, why, and which rulings it builds on.

**Goal:** a request the operator asked for is a row in `coord.db` that outlives any generation of the Overlord. It
moves only through one table of moves and one writer, and it cites the operator's whole messages by id and hash, never
their words. The Overlord opens, drops, closes and escalates requests through four doors behind the gate order.

**Why:** C9, H7 and H22 (§5.1): "One table, `overlord_requests`, in `coord.db`, moved only through doors", "A request
cites whole messages", "One message founds one root request, within 24 hours", and "One table of moves,
`REQUEST_TRANSITIONS`". §5.3 adds the code shortlist and Figure 4. §10.4 and Table 11.7a add I12: "Every open request
outside `needs-you`, `done-unverified` and `blocked` has a follow-up time, or is a parent with at least one open child,
each of which meets this invariant itself".

**Architecture.** Context C5 (Coordination) owns the request record. The cited messages live in C11 (the private
store), which the open door reads and moves through its own writer.

| Ring | File | What it holds | PR |
|---|---|---|---|
| L0 | `shared/overlordRequests.ts` (new) | The ten states, the actors, `REQUEST_TRANSITIONS`, the move reasons, the fields each move may set, the bounds | A |
| L1 | `server/src/coord/overlordRequests.ts` (new) | `nextRequestState`, `followUpAfterMove`, `parentClockAfterChildMove`, `citationVerdict`, `nextRequestId`, `answeredSinceNeedsYou`, `closeUnownedVerdict` | A |
| L1 | `server/src/coord/requestShortlist.ts` (new) | `codeShortlist` | B |
| L3 | `server/src/coord/overlordRequestStore.ts` (new) | The insert and the move writer, each a read-only plan and an apply, the private `appendMove`, and the readers | A |
| L3 | `server/src/coord/requestShortlistRead.ts` (new) | Live claims by programme, and history's `touched` by programme, for the shortlist | B |
| L4 | `server/src/coord/overlordRoutes.ts` (W1's) | The four door handlers | B |
| L1, L3 | `server/src/coord/invariants.ts`, `invariantFacts.ts` (sequence B's) | I12's predicate and its gatherer | A |
| L1, L3, L4 | `server/src/operatorModel/messages.ts`, `store.ts`, `bootPass.ts` (private store's) | `citedMessageFacts` with its ledger line (RQ19), the boot pass's `spent` arm and restore floor, and its measured citation reader wired | A |

*Table 1. Where the code goes.*

No row is added to the architecture spec's path table: `server/src/coord/**` is C5 by its directory row, and a
`shared/*.ts` file states its ring and context in its header, as `shared/ledgers.ts` does (§3).

**The rulings this plan builds on.** The coordinator accepted every recommendation of the W2 index's questions 2 to
23, and questions 24 to 28 are settled. This plan builds on these:

- **Q2:** routing is a relay. The relay door makes route, re-relay and route elsewhere (relay A's piece). The
  Overlord's request doors here are open, drop, `close-request` and escalate. This plan defines the moves the relay
  makes, and relay A calls the move writer.
- **Q5, as amended:** `revision INTEGER NOT NULL DEFAULT 0` on `overlord_requests`, raised only by a writer that
  changes what an answer acts on, in that writer's transaction. An Overlord door that carries an older revision changes
  nothing and answers `operator-has-it` with the row and the act that moved it. An operator's tap is never refused for
  a stale revision.
- **Q7, as amended:** the paths `POST /api/overlord/requests` and `POST /api/overlord/requests/:id/drop`, `.../close` and
  `.../escalate`, all in the Overlord door group. The escalate door (ruled, fix round 1) moves `received` or `declined`
  to `needs-you` with one of three reasons, writes an act row, sends no mail, and has the act kind `escalate-request`.
- **Q8:** `widens` is a column of `overlord_acts`, not of this table.
- **Q13:** the done-test predicates and their one reader are the done tests piece's. This plan stores `doneTest` as an
  opaque column that only the relay writes.
- **Q23:** this plan is written now, against W1 plans not yet built, and takes each interface from the W1 plan that
  defines it.
- **Q27:** `overlordMayAct` is act catalogue B's. Every act kind here is class none, so in W2 it answers `allow` or
  `identity-too-weak`.
- **Q28:** before W3 and W5, a request that needs a proposal or a start goes to the operator. The escalate door moves
  it to `needs-you`, and nothing raises an item before W3.
- **F5 (the index review):** the code shortlist is a pure decider here. The open door returns it, and decision model A
  takes it as `programme.pick`'s input.
- **F6 (the index review):** the escalate door, its three reasons, and its act row.
- **I12:** its predicate goes in through sequence B's invariant table.

## 2. Open questions

Each question carries a recommendation, which this plan builds unless the coordinator rules otherwise. None needs the
operator: each is an implementation choice under a direction the spec already gives.

- **RQ1. Every move is a row of its own** (slug `request-moves-are-rows`). §5.1 says "Every move is a row and an event"
  and names no table. The Overlord's `operator-has-it` must name "the act that moved it" (index question 5). The drop
  door must know whether the operator answered since the request reached `needs-you`. The take's reason
  `operator-took-it` is "carried on the move's news row". **Recommendation:** `overlord_request_moves`, append-only. It
  has one row per move: the move, the actor's kind and id, the states before and after, a closed reason word or none,
  the act id when an act caused it, the revision after, and the time. No text. The move writer writes it in the move's
  own transaction.
- **RQ2. Cited messages are a child table** (slug `citations-are-a-child-table`). "One message founds one root request
  … by a unique index" needs a row per message. **Recommendation:** `overlord_request_messages (requestId, messageId,
  sha256, root)`, with `UNIQUE (messageId) WHERE root = 1`. `root` is 1 for each message a root request cites.
- **RQ3. An expected path names its project, and is a path, never a glob** (slug `expected-paths-name-their-project`).
  Claims are per project (`shared/api.ts#ClaimSummary`), and a request has no project column. No glob matcher exists:
  `server/src/coord/claims.ts#pathsOverlap` is exact or directory-prefix only. **Recommendation:** each entry is
  `{ project, path }`. The path is normalised by `server/src/coord/claims.ts#normalizeClaimPath`, and matched by
  `pathsOverlap`, so a directory covers what is under it. A second matcher is not added. A path that
  `normalizeClaimPath` refuses (it answers null for an empty, absolute or `..` path), or one that holds `*`, `?` or `[`,
  refuses `bad-request`, so "never a glob" is enforced at the door (F12). History's `touched` matches files only, so a
  directory reaches a programme through claims alone (§7).
- **RQ4. An empty `expectedPaths` shortlists the programmes that hold live claims** (§5.3: "When it is empty, the
  shortlist matches on live claims alone"). With no path there is nothing to match, so the sentence can only mean that
  a live claim alone qualifies a programme. **Recommendation:** with no expected path, every programme holding a live
  claim is a candidate, ranked by its count of live claimed paths, then by its newest claim, then by slug, and cut at
  six. No `touched` read is made. The answer says `basis: 'claims-only'`.
- **RQ5. History's `touched` reaches the server as a fourth verb of the history op** (slug
  `touched-is-a-fourth-history-verb`). Measured: `touched` lives only in the fleet box's history store
  (`ccd/history/recall.mjs`, its "touched" section). The agent op `overlord-history` runs three verbs
  (`shared/overlordHistory.ts#OverlordHistoryVerb`), and `touched` is not among them. Each `touched` row names its
  session's ccrc id. The op has one slot per agent process, answers a second request `busy`, and frees the slot only
  when its worker exits (`agent/src/historyOp.ts`, 20 s deadline). **Recommendation, as ruled in fix round 1 (F3):**
  - **One history read per open.** `touched` joins `OverlordHistoryVerb` and `overlord-read.mjs`'s `CLI_VERB` and
    `VERBS` maps. One op call carries the first eight expected paths, in the request's stated order.
  - **A budget sized to the one slot.** The runner stops itself between paths after 4 s and answers what it read, so
    its worker exits and frees the slot. The door waits at most 5 s.
  - **What reads as not measured.** `busy` reads as `unmeasured`. `partial` covers a `shown` below its `total`, more
    than eight expected paths, and a cut by the budget.
  - **The directory rule:** `touched` matches a file exactly or by suffix, so a directory expected path reaches a
    programme only through claims.
  - **The multi-programme rule:** a ccrc id that matches runs of several programmes, through `runs.sessionId` or
    `runs.claimedBy`, counts toward each of them.

  The shortlist fails open: a read that did not answer leaves the claims standing alone, and the answer says which
  (§7). The history door of W1's board-history piece then serves `touched` to the Overlord too, which C54 asks for.
- **RQ6. The move writer stamps the follow-up clock** (slug `move-writer-stamps-the-clock`). I12 must hold from the
  first row, and the follow-up piece lands after this one. **Recommendation:** `followUpAfterMove` (L1) gives the clock
  at each move:
  - **Entering `received`, `routed`, `in-progress` or `declined`:** the time of the move plus one hour
    (`REQUEST_NEXT_MOVE_MS`, Table 11.5b's "One hour"), or the read-back's promise when the move carries one.
  - **Entering `needs-you`, `done-unverified`, `blocked` or a terminal state:** none.
  - **A parent with an open child:** none. The insert of a child clears its parent's clock in the same transaction.
  - **The insert stamps its own clock** (F6): a new request is `received`, so its clock is an hour on.
  - **A parent left with no open child** (ruled, fix round 1, F2): when a move ends a parent's last open child and the
    parent is `received` or `in-progress`, the move writer stamps the parent's clock an hour on, in the same
    transaction, as a bookkeeping write.

  The follow-up piece keeps `followUpDue`, the arm, the nudges and the re-time after a nudge. It calls a bookkeeping
  writer of this store and never stamps a move's clock itself.
- **RQ7. Every move raises the revision, and nothing else does** (index question 5, applied to requests). Every move,
  the self-loops included, changes what an answer acts on: the state, the owner, the done test, a counter, the
  operator's recorded answer or `takenFrom`. News, `followUpAt`, `nudges` and `expectedPaths` alone are bookkeeping.
  **Recommendation:** the move writer raises it, and every other writer of the table is classified `bookkeeping` in the
  row-revisions census.
- **RQ8. Which word a refused move answers.** **Recommendation:**
  - an unknown request: `not-found`;
  - a stale revision, a request in `needs-you` the operator has not answered, or a request the operator took:
    `operator-has-it`, with the row and its last move;
  - any other move the table does not allow: `bad-transition`.

  The order matters (F5): for an Overlord move, `nextRequestState` reads a taken row and an unanswered `needs-you` row
  first, before the move's `from`. Otherwise a close or an escalate on such a row would fail its `from` and answer
  `bad-transition`, where Table 11.6 says `operator-has-it`.

  Both `not-found` and `bad-transition` are in `shared/refusal.ts#GENERIC_REFUSALS` today, so no word is added.
- **RQ9. A child is one level deep, and cites only its root's messages.** Figure 4 makes "a parent request, one child
  per owner". **Recommendation:** a child's parent must be a root request that is not terminal. A child cites a subset
  of its root's messages with `root` 0, takes its root's `origin`, and may not itself be a parent. I12's predicate stays
  recursive, so a deeper tree would need only this rule relaxed.
- **RQ10. A request id is never issued twice.** The act journal's `open-request` record carries the request's id
  (index question 4), and act journal B puts the highest request id in the witness. **Recommendation:** the insert
  takes `id = nextRequestId(storeHighest, journalHighest)`, `max(storeHighest, journalHighest) + 1`, as the private
  store's `nextMessageId` does. The caller passes the act journal's highest request id, or `null` until act journal B
  supplies it. The table is never `AUTOINCREMENT`.
- **RQ11. The `spent` mark is a copy, written after the commit** (slug `age-spent-is-derived`).
  - **The unique index is the fact.** The private store's `spent` is a copy, and no transaction spans the two files
    (the W1 index's question 31).
  - **After the `coord.db` commit:** the open door calls `moveMessage(id, 'spend', 'citing-door')` for each root
    citation, and `moveMessage(id, 'settle', 'citing-door')` for any other citation not yet settled. A failed copy is
    logged, and the boot pass's `spent` arm repairs it.
  - **The 24-hour window is checked at the door from the message's `at`, and never written.** A message past the window
    is spent by its age, and no lane writes it.
  - **After a confirmed restore** every message up to the highest id on record is spent (§5.1). Request record A builds
    the boot pass's arm for it, which takes that floor as an input, and act journal B supplies the floor from Confirm
    the restore (F14).
- **RQ12. `close-request` on `received` is this plan's, and on other states the done tests piece's.** The server's
  close from `received` to `done` happens "at the Overlord's close door", when every act on the request was a read or an
  answer. The close of an `in-progress` request is the done-test lane's. **Recommendation:** PR B's close door moves
  `received` to `done` when `closeUnownedVerdict` allows: every act on the request is its own `open-request` or an
  answer kind (W3's), and it has no open child. On any other state it answers `bad-transition` until the done tests piece adds its arm to the same handler.
- **RQ13. The escalate door's act kind is `escalate-request`, a catalogue kind** (index question 7; **ruled by the
  coordinator** on run 2263, from the act catalogue review, run 2271). It is class none and reversible, refused at
  `chat` and allowed at `advise` and `full`, in the `request` ceiling group (6 an hour per programme, 30 in all). It is
  not W3's `escalate`, which hands a held ask or item to the operator. The act catalogue piece carries the row. If the
  catalogue has landed without it, PR B adds the row in Task B4, with those values.
- **RQ14. `server/src/coord/requestRoutes.ts` is created with its first route** (slug
  `request-routes-file-with-its-first-route`). The index has PR B create it with every census site. But PR B's four
  doors are the Overlord's, and they belong in `overlordRoutes.ts` (index question 7). A lane source with no route
  would give the censuses nothing to read. **Recommendation:** the coordinator request doors piece or the operator's
  request doors piece creates it, whichever lands first, with every census site.
- **RQ15. The open door asks `programme.pick`, so PR B needs decision model A** (the decision-model plan, #2922, Figure
  2). **Recommendation:** the open door calls decision model A's `gatherDecisions` before its transaction, with the rows
  `programme.pick` and `programme.any`. It records the checks on its act row and returns each check's mark. With every
  row `off` (Q29), the check is `disarmed` and costs nothing. When the row is not `off`, the door reads each
  candidate's ratified goals version and text through `server/src/coord/ledgersStore.ts#goalsFor` and passes them as
  the row asks (F15).
- **RQ16. The bounds.** **Recommendation**, as starting values for Table 11.5b:
  - at most 8 cited messages;
  - a summary of at most 200 characters (the act row's own cap);
  - at most 32 expected paths, each path at most 512 bytes;
  - at most 6 consulted programmes;
  - a close note of at most 600 characters.

  Summary and close note are masked on the way in by the server's masker, `SecretMasker`'s `maskText` method
  (`server/src/accounts/mask.ts#SecretMasker`).
  A larger body refuses `too-large`, an existing word.
- **RQ17. Where the drop's reason sits.** Table 5.1a: "A drop carries the dropper's reason". **Recommendation:** the
  drop door requires a reason of 1 to 600 characters, masked, in `closeNote`. Its move row carries the reason word
  `dropped`. The text is the Overlord's own words, never the operator's.
- **RQ18. Nothing refuses after the journal record** (ruled, fix round 1, F1; slug `decide-before-the-append`). An act
  journal record appended before a refusal stays in the file when the transaction rolls back. It trails the database,
  and the guard fences every Overlord door.
  - **Decide first.** Each writer is split into a read-only plan and an apply that cannot refuse. Inside the
    transaction and before the act writer, the open door runs `planRequestInsertInTx`: is each root citation free, and
    is the parent open? The move doors run `planRequestMoveInTx`: the row, its revision and `nextRequestState`.
    `DatabaseSync` is synchronous, so that check is final. The unique index stays as a backstop.
  - **The open door** then keeps the act journal's insert-first order (`open-request-after-its-row`). The request row
    is inserted, and then the act writer runs with `opens: <request id>`.
  - **The link:** the `open` move row carries `actId` null, and links to its act through the act's `opens` (ruled). A
    test pins the link.
  - **A move door** runs the act writer, and then applies its move with that act's id.
- **RQ19. The open door's read of the private store** (ruled, fix round 1, F11).
  - **The reader:** a C11 reader, `citedMessageFacts`, answers `{ state, at, sha256, hashMatches }`, as
    `messageSessionOf` does for the session. So the open door never holds the text, and the rehash is the reader's.
  - **The ledger line:** each read leaves one line in the read ledger, under a new read door `open-request` (§9.4 rule
    3).

## 3. What exists today

Measured on `main` at `fb763bef8` (2026-11-16), each cited by symbol. None of the W1 pieces this plan builds on is
merged: private store A is open (#2896), and private store B, sequence A, B and C, gates A and B, the ladder, door
process A2 and the Overlord's routes file are planned only.

| What | Where | What this plan does with it |
|---|---|---|
| The item moves table, keyed by move, `{ actor, from: readonly ItemState[], to }` | `shared/ledgers.ts#ITEM_TRANSITIONS` | The shape `REQUEST_TRANSITIONS` copies |
| Open states derived as those some row leaves | `shared/ledgers.ts#OPEN_ITEM_STATES` | Derived the same way: no hand list of open or terminal states |
| The item decider, refusal order `not-open`, `wrong-actor`, `programme-live` | `shared/ledgers.ts#nextItemState` | `nextRequestState` follows its shape |
| The one writer of an item's state, refusing by return value | `server/src/coord/ledgersStore.ts#moveItemInTx` | The move writer's model |
| The item policy tests (vocabulary, derived open states, every state, act and actor) | `server/test/ledgers-policy.test.ts` | The request policy tests' model |
| Migrations: an array of SQL strings, version = length = 82 | `server/src/coord/schema.ts#MIGRATIONS`, `#COORD_SCHEMA_VERSION` | One new entry, numbered when it lands |
| Partial unique indexes | `MIGRATIONS` entries 75 (`push_outbox_one_per_source`) and 82 (`operator_responses_one_waiting`) | The model for the one-root index |
| The version pins | `server/test/coord-db.test.ts` (three `toBe(82)`), `server/test/run-close-switch.test.ts` (drops back to 53) | Bumped and extended when the migration lands |
| Live claims, with paths | `server/src/coord/store.ts#activeClaims`, `shared/api.ts#ClaimSummary` | The shortlist's claim input |
| Claim paths, normalised and overlapped | `server/src/coord/claims.ts#normalizeClaimPath`, `#pathsOverlap` | Reused for expected paths (RQ3) |
| A claim's programme | None. A claim names `runId`, and `runs.program` names the programme. A claim with no run has none | The shortlist reader joins through runs |
| A session's programme | `runs.sessionId` (a worker) and `runs.claimedBy` (a coordinator), in `MIGRATIONS` entry 1 | Maps a `touched` row to a programme (RQ5) |
| `touched` | `ccd/history/recall.mjs` (the "touched" section), rows typed `ccd/history/lib.d.mts#TouchedRow`, each naming its session's ccrc id | Not reachable from the server today (RQ5) |
| The Overlord's history op | `shared/overlordHistory.ts#OverlordHistoryVerb` (`search`, `describe`, `expand`), `ccd/history/overlord-read.mjs#overlordRead` | Gains `touched` (RQ5) |
| Generic words | `shared/refusal.ts#GENERIC_REFUSALS`: `not-found` (404), `bad-transition` (409), `too-large`, `unmeasured` | Reused (RQ8, RQ16) |
| The Overlord's words | `shared/refusal.ts#OVERLORD_REFUSALS`: W1's words. `said-not-operator` and `operator-has-it` arrive with the W2 vocabulary piece or W1's inbox | Read from the group, never re-declared |
| The masker | `server/src/accounts/mask.ts#SecretMasker`, its `maskText` method | Masks the summary and the close note |
| A routes file registered from the coordination routes | `server/src/coord/coordCallsRoute.ts#registerCoordCallsRoute` | Not used: the doors go in W1's `overlordRoutes.ts` (RQ14) |
| The growth check | `server/test/growthCheck.ts#GROWTH_LIMIT` (40 net lines per growth-checked file) | `schema.ts` is the only growth-checked file this plan grows |
| The table, clock and mutation registries | `server/test/single-definition/writers-map.test.ts#TABLES`, `server/test/single-definition/time-ports.test.ts#TIME_PORT_FILES`, `server/test/sim/mutation-floors.test.ts#MUTANT_SETS` with `mutation-floors.json` | Each new table, clock-free file and decider joins |
| The `ccrc-api` routes | `ccd/ccrc-api`'s `ROUTES`, 84 rows, pinned by `server/test/ccrc-api.test.ts` (length and `WORDS`) | Four rows; the count words re-derived when it lands |
| The skill's door tables | `ccd/overlord-skill/references/routing.md` and `starting.md` name `relay`, `close-request`, `drop-request` and `nudge-owner` | Gain `open-request` and `escalate-request` |

*Table 2. What exists today.*

**From the W1 plans, not yet built** (each taken from the plan that defines it, as the index asks):

- **Private store** (`w1-private-store.md`): `operator-model.db`, a second file. `operator_messages` has
  `sha256` (of the stored text), `state` (`recorded`, `queued`, `delivered`, `picked-up`, `settled`, `spent`) and
  `spentAt`. Its one writer is `moveMessage(id, event, actor, at)`, where `spend` is accepted from every state but
  `spent` and `citing-door` may `settle` and `spend`. The reader is `messageById(id): StoreRead<OperatorMessageRow |
  'absent'>`. Private store B's boot pass takes a citation reader as a port:
  `CitationRead = { kind: 'measured'; cited } | { kind: 'not-applicable' } | { kind: 'unmeasured'; why }`. Its W1
  adapter answers `not-applicable`, and "W2 adds the measured adapter and the `spent` arm".
- **Sequence** (`w1-sequence-monitor.md`): `SEQUENCE_KIND_MAP` in `shared/overlord-sequence.ts`, a row per kind
  (`states`, `id`, `spec`). `stampSequenceInTx(db, line)` refuses outside a transaction, and the order inside a stamped
  transaction is "authority append first, then the row write, then the stamp". The stamp census is
  `server/test/sequence-stamp-census.test.ts`, with `STAMPED_TABLES`. Sequence B's `INVARIANT_MAP` in
  `server/src/coord/invariants.ts` reads `not-applicable` for a row with no predicate, and "the piece that creates a
  row's tables adds the predicate and its gatherer".
- **Gates** (`w1-gates.md`): `OVERLORD_DOORS` in `server/src/coord/overlordDoors.ts`, each row
  `{ method, path, file, verbClass, group, write, word, others, ladderClass, act }`. Every handler calls
  `deps.gate(req, reply, '<key>', claim)` before its first `coord` access, and the next statement is
  `if (g.kind === 'refused') return`. On a pass it gets `{ caller, generation }`.
- **Door process** (`w1-door-process.md`): `DOOR_TOOLS` in `ccd/door-process.mjs`, each row
  `{ name, verb, class, fenced, reader, input, argv }`. Every `operate` row is fenced, and no input names attribution.
- **The ladder** (`w1-ladder.md`): `RUNG_MAP.advise.needs = 'overlord-route-v1'`. W2's act kinds are allowed at
  `advise` and `full`.

## 4. The record

This section gives the three tables and the writers of each column. One migration creates all three.

```mermaid
flowchart LR
  R["overlord_requests<br/>one row per request"]
  M["overlord_request_messages<br/>one row per cited message"]
  V["overlord_request_moves<br/>one row per move"]
  P["operator_messages<br/>(private store, another file)"]
  S["overlord_sequence<br/>(sequence A)"]
  A["overlord_acts<br/>(act rows A)"]
  M -->|"requestId"| R
  V -->|"requestId"| R
  R -->|"parentRequestId"| R
  M -.->|"messageId and sha256, no key across files"| P
  V -.->|"actId"| A
  V -.->|"stamped in the same transaction"| S
```
*Figure 1. The request record. Solid edges are keys inside `coord.db`. Dashed edges are references to another table or
another file, written in the same transaction where the target is in `coord.db`.*

| Column | Holds | Written by |
|---|---|---|
| `id` | The request's number, from `nextRequestId` (RQ10) | `applyRequestInsertInTx` |
| `origin` | `operator` when it cites a message, else `overlord`. A child takes its root's | `applyRequestInsertInTx` |
| `summary` | The Overlord's one line, masked, at most 200 characters | `applyRequestInsertInTx` |
| `owner` | One programme slug, or none before routing | `applyRequestMoveInTx` (route, re-relay, route elsewhere) |
| `parentRequestId` | The parent, for a child (RQ9) | `applyRequestInsertInTx` |
| `consulted` | Programmes consulted, a JSON list of at most 6 slugs | `applyRequestInsertInTx` |
| `state` | One of ten states | `applyRequestMoveInTx` only (the insert writes `received`) |
| `doneTest` | Typed predicates, opaque here (index question 13) | `applyRequestMoveInTx` (route, re-relay), for the relay |
| `expectedPaths` | `{ project, path }[]`, at most 32 (RQ3) | `applyRequestInsertInTx`. The relay refines it in its route move |
| `dependsOn` | `request:<id>` or `programme:<slug>` | `applyRequestMoveInTx` (block), for the coordinator doors |
| `takenFrom` | `routed`, `in-progress` or `blocked`, or none | `applyRequestMoveInTx` (take sets it, hand back clears it) |
| `openedAt` | When it was opened | `applyRequestInsertInTx` |
| `lastNewsAt`, `news` | The latest news and its time, masked | A bookkeeping writer, added by request ids A |
| `followUpAt` | The next follow-up time (RQ6) | `applyRequestInsertInTx` (its own, an hour on, and a child clears its parent's), `applyRequestMoveInTx` (the moved row's, and a parent's when its last open child ends, F2), and the follow-up piece's bookkeeping writer |
| `nudges` | The nudges sent | The follow-up piece's bookkeeping writer |
| `counters` | The counters received | `applyRequestMoveInTx` (counter) |
| `closedAt`, `closeNote` | When and why it ended, the note masked, at most 600 characters | `applyRequestMoveInTx` (every move to a terminal state) |
| `revision` | The counter of RQ7 | `applyRequestMoveInTx` only |

*Table 3. `overlord_requests`. Every writer is a function of `server/src/coord/overlordRequestStore.ts`, the one owner
of the table's SQL.*

- **`overlord_request_messages`:** `requestId`, `messageId`, `sha256`, `root`, `at`, with primary key
  `(requestId, messageId)` and the unique index `overlord_request_messages_one_root ON (messageId) WHERE root = 1`.
  `applyRequestInsertInTx` is its one writer.
- **`overlord_request_moves`:** `id`, `requestId`, `move`, `actorKind`, `actor`, `fromState` (none for `open`),
  `toState`, `reason`, `actId` (none for `open`, whose act links back through its `opens`), `revision`, `at`. One
  private function of the store, `appendMove`, writes it for both appliers (F7), and nothing updates or deletes it.
- **The four indexes:** `overlord_requests_by_state (state)`, `overlord_requests_by_parent (parentRequestId)`,
  `overlord_request_messages_one_root (messageId) WHERE root = 1` (unique), and `overlord_request_moves_by_request
  (requestId, id)`.
- **No CHECK holds a word or a close note** (the private store's slug `no-vocabulary-in-check`). The L0 table governs
  every word. `close-unowned`, `close` and `fail` may end a request with no note, so no CHECK ties `closeNote` to
  `closedAt` (F10).
- **A newer column is additive.** An older build ignores all three tables (Table 11.5, "Ignored").

## 5. The moves

This section gives `REQUEST_TRANSITIONS`, the one table every door moves a request through.

It is keyed by move, as `ITEM_TRANSITIONS` is, with one actor and one target state per move. So close and close
unverified are two rows, and hand back is three, one per state it returns to. `open` is a row whose `from` is empty:
only the insert honours it.

| Move | Actor | From | To | Who calls it (piece) |
|---|---|---|---|---|
| `open` | overlord | (none) | `received` | The open door (this plan, B) |
| `route` | overlord | `received` | `routed` | The relay door (relay A) |
| `re-relay` | overlord | `routed` | `routed` | The relay door (relay A) |
| `route-elsewhere` | overlord | `declined`, `needs-you` | `routed` | The relay door (relay A). From `needs-you` only after the operator's answer |
| `drop` | overlord | `received`, `declined`, `needs-you` | `dropped` | The drop door (this plan, B). From `needs-you` only after the operator's answer |
| `escalate` | overlord | `received`, `declined` | `needs-you` | The escalate door (this plan, B) |
| `acknowledge` | owner | `routed` | `in-progress` | The coordinator doors |
| `counter` | owner | `routed` | `routed` | The coordinator doors |
| `decline` | owner | `routed` | `declined` | The coordinator doors |
| `block` | owner | `in-progress` | `blocked` | The coordinator doors |
| `fail` | owner | `in-progress` | `failed` | The coordinator doors |
| `close` | server | `in-progress`, `done-unverified` | `done` | The done-test lane (done tests) |
| `close-unowned` | server | `received` | `done` | The close door (this plan, B) |
| `close-unverified` | server | `in-progress` | `done-unverified` | The done-test lane (done tests) |
| `start-parent` | server | `received` | `in-progress` | Done tests |
| `close-parent` | server | `in-progress`, `needs-you` | `done` | Done tests |
| `resume-parent` | server | `needs-you` | `in-progress` | Done tests |
| `unblock` | server | `blocked` | `in-progress` | Done tests |
| `needs-you` | server | `received`, `routed`, `in-progress`, `blocked`, `declined` | `needs-you` | Coordinator doors (two counters), follow-up, done tests, `overlord-route-v1` (`off`) |
| `answer` | operator | `needs-you` | `in-progress` | The operator's request doors, when the owner has acknowledged |
| `answer-recorded` | operator | `needs-you` | `needs-you` | The operator's request doors, otherwise |
| `take` | operator | `routed`, `in-progress`, `blocked` | `needs-you` | The operator's request doors |
| `hand-back-routed` | operator | `needs-you` | `routed` | The operator's request doors, when `takenFrom` is `routed` |
| `hand-back-in-progress` | operator | `needs-you` | `in-progress` | As above, for `in-progress` |
| `hand-back-blocked` | operator | `needs-you` | `blocked` | As above, for `blocked` |
| `confirm` | operator | `done-unverified` | `done` | The operator's request doors |
| `withdraw` | operator | every open state | `dropped` | The operator's request doors |

*Table 4. `REQUEST_TRANSITIONS`, as Table 5.1b states it. The terminal states are those no row leaves: `done`, `failed`
and `dropped`. A test derives them and compares the result to §5.1's list.*

```mermaid
stateDiagram-v2
  [*] --> received: open
  received --> routed: route
  received --> needs_you: escalate, needs-you
  received --> done: close-unowned
  received --> in_progress: start-parent
  received --> dropped: drop, withdraw
  routed --> routed: re-relay, counter
  routed --> in_progress: acknowledge
  routed --> declined: decline
  routed --> needs_you: needs-you, take
  routed --> dropped: withdraw
  declined --> routed: route-elsewhere
  declined --> needs_you: escalate, needs-you
  declined --> dropped: drop, withdraw
  in_progress --> blocked: block
  in_progress --> failed: fail
  in_progress --> done: close, close-parent
  in_progress --> done_unverified: close-unverified
  in_progress --> needs_you: needs-you, take
  in_progress --> dropped: withdraw
  blocked --> in_progress: unblock
  blocked --> needs_you: needs-you, take
  blocked --> dropped: withdraw
  needs_you --> needs_you: answer-recorded
  needs_you --> in_progress: answer, resume-parent,<br/>hand-back-in-progress
  needs_you --> routed: route-elsewhere,<br/>hand-back-routed
  needs_you --> blocked: hand-back-blocked
  needs_you --> done: close-parent
  needs_you --> dropped: drop, withdraw
  done_unverified --> done: close, confirm
  done_unverified --> dropped: withdraw
  done --> [*]
  failed --> [*]
  dropped --> [*]
```
*Figure 2. Every edge of `REQUEST_TRANSITIONS`, labelled by its moves. It is Figure 3 of the spec with each edge named
by the move that makes it. A self-loop is a move that keeps the state and still raises the revision.*

**The guards the table cannot hold.** `nextRequestState(row, move, actor, ctx)` reads four facts from `ctx`, which the
move writer's plan reads in its transaction. For an Overlord move it reads the first two before anything else (F5),
so a move on a row the operator holds answers `operator-has-it` whatever its `from`:

| Order | Fact | Guards | Refusal (internal) | Door word |
|---|---|---|---|---|
| 1 | `takenFrom` | Any Overlord move on a taken row | `taken` | `operator-has-it` |
| 2 | `answered`: the operator answered since the row last entered `needs-you` (`answeredSinceNeedsYou`; "entered" means a move whose `fromState` is not `needs-you`, F9) | Any Overlord move on a `needs-you` row before that answer | `not-answered` | `operator-has-it` |
| 3 | The move's `from` | Every move | `not-from` | `bad-transition` |
| 4 | The move's actor | Every move | `wrong-actor` | `bad-transition` (a programming error at a door, which the call-site census prevents) |
| 5 | `takenFrom` again | Each `hand-back-*` needs `takenFrom` equal to its target | `not-taken-from` | `bad-transition` |
| 6 | `ownerAcknowledged`: the row's moves hold an `acknowledge` | `answer` (else `answer-recorded`) | `not-acknowledged` | (the operator's door picks the move) |
| 7 | `openChildren` | `close-unowned`, `drop` and `escalate` on a parent | `has-open-children` | `bad-transition` |

*Table 5. The guards, in the order `nextRequestState` reads them. Rows 3 and 4 follow `shared/ledgers.ts#nextItemState`,
which reads `from` before the actor.*

**What each move may set.** `REQUEST_MOVE_FIELDS` is an L0 map from each move to the columns it may set:

- `route`, `re-relay` and `route-elsewhere`: `owner`, `doneTest` and `expectedPaths`;
- `block`: `dependsOn`;
- `take`: `takenFrom`, from the state it leaves. Each `hand-back-*` clears it;
- every move to a terminal state: `closeNote`, which `drop` requires.

The move writer refuses a field the move may not set, and writes nothing.

**Move reasons.** `REQUEST_MOVE_REASONS` is an L0 key map of closed words, carried on the move row. This plan adds
the escalate door's three, `needs-start`, `needs-proposal` and `unnamed-widening`, and `dropped` (RQ17). Each later
piece adds its own words in its own pull request: `two-counters`, `two-silent-nudges`, `off-before-ack`,
`child-ended`, `dependency-ended` and `operator-took-it`. A test holds that every move to `needs-you` carries a reason.

## 6. Citing the operator's messages, and the order inside the transaction

This section says how the open door binds a request to whole operator messages across the two files, and fixes the one
order every door of this plan keeps: **nothing may refuse after the journal record** (ruled, fix round 1, F1).

```mermaid
sequenceDiagram
  participant O as The Overlord
  participant D as Open door
  participant PS as Private store
  participant H as Agent history op
  participant DM as Decision model A
  participant C as coord.db
  O->>D: cites, summary, expectedPaths, parent
  D->>D: bounds, then gate steps 1 to 10 and the op-key lookup
  D->>PS: citedMessageFacts, for each cited id
  PS-->>D: state, at, hashMatches, or absent, or unmeasured
  D->>D: citationVerdict
  D->>C: live claims and programmes, each candidate's goals
  D->>H: one touched read, the first eight paths
  D->>D: codeShortlist
  D->>DM: gatherDecisions, programme.pick
  D->>C: one transaction, decide then apply
  C-->>D: committed
  D->>PS: moveMessage spend or settle, the copy
  D-->>O: request, shortlist, marks
```
*Figure 3. The open door. Every read that can be slow, the private store's and the agent's, happens before the
transaction, as `gatherDecisions` requires. Inside it the door decides everything that can refuse, read-only, and only
then appends and writes.*

**Inside the one transaction.** `coord.db` is a synchronous `DatabaseSync` under `BEGIN IMMEDIATE`, so a read-only check
made inside the transaction is final: nothing can change between the check and the write. Each door runs in this order.

1. **Decide, read-only.**
   - The open door calls `planRequestInsertInTx`. It checks that each root citation is free, that the parent is open,
     and that the parent is a root. It returns the plan, with the id from `nextRequestId`, or a refusal.
   - The move doors call `planRequestMoveInTx`. It re-reads the row, checks the revision, and runs `nextRequestState`
     with the guards of Table 5. It returns the plan, or a refusal with the row and its last move.
   - Then `overlordMayAct` (act catalogue B) runs. The act writer's own checks run inside `writeActInTx` before its
     append (act rows A: the allow, the ceilings, the natural key and the operation key).
2. **Apply, which cannot refuse.**
   - **The open door,** in the act journal's insert-first order (`open-request-after-its-row`):
     - `applyRequestInsertInTx` writes the request, its cited messages and its `open` move row, and stamps its
       `request` line. The `open` move row carries `actId` null (ruled, F1).
     - Then `writeActInTx` runs with `opens: <request id>`. It appends `act-settle` and then `act-open-request`, writes
       the act row, and stamps the `act` line. The act's `opens` is the one link from the request to the act that
       opened it.
   - **A move door:**
     - `writeActInTx` appends its record, writes the act row and stamps its line.
     - Then `applyRequestMoveInTx` writes the move with that act's id, and stamps the `request` line when the state word
       changed.
3. **What can still fail after the append** is the disk, and the act journal plan reads that as `trailing`. A refusal
   from an apply step is a programming error. The door answers 500 and logs it, and the test of step 1 pins that each
   apply re-decides with the same decider and agrees with its plan.
4. **The unique index stays as a backstop.** `overlord_request_messages_one_root` can only meet a second root citation
   that step 1 already refused, inside the same transaction.

**`citedMessageFacts` (C11, PR A; ruled, F11)** is the private store's reader for a citing door, beside
`messageSessionOf`. It never hands the text out:

```ts
// server/src/operatorModel/store.ts (C11, L3), a method of OperatorModelStore
citedMessageFacts(id: number, reader: { door: 'open-request'; caller: ReadCaller; at: number }):
  StoreRead<{ readonly state: MessageState; readonly at: number; readonly sha256: string;
    readonly hashMatches: boolean } | 'absent'>;
```

- **It rehashes.** The private store rehashes the stored text with its own `sha256Of` and compares the result with the
  row's `sha256`. The open door holds no text and computes no hash.
- **It leaves a ledger line** (§9.4 rule 3, "every read leaves a ledger line"): one `recordRead` line per call, under
  the new read door `open-request` in `READ_DOOR_MAP`.
- **A gone row is absent.** A row W4's wipe made `gone` answers `absent`.

**`citationVerdict` (L1)** decides from those facts. It is first match:

| Case | Answer |
|---|---|
| More than 8 ids | `too-large` |
| An id repeated | `bad-request` |
| A read failed for an id | `unmeasured` (502): never folded into absent |
| An id is absent | `said-not-operator`, `absent` |
| `hashMatches` is false | `said-not-operator`, `changed` |
| A root request cites a row whose state is `spent` | `said-not-operator`, `spent` |
| A root request cites a row older than 24 hours (`ROOT_FOUND_WINDOW_MS`) | `said-not-operator`, `spent` |
| A child cites an id its root does not cite (RQ9) | `said-not-operator`, `not-in-root` |
| Otherwise | `ok`, with each id's stored hash and whether it is a root citation |

*Table 6. `citationVerdict`. The bounds come first (F13), so a bad body never waits on a read. A request with no
citation is the Overlord's own (`origin: overlord`) and needs no verdict. A root citation another request already holds
is refused by `planRequestInsertInTx`, inside the transaction, with the same word and detail `spent`.*

**The boot pass's three inputs** (private store B's pass, PR A here):

- **The measured citation reader.** `citedMessagesForBoot(db)` reads `overlord_request_messages`. The cited set settles
  a `cite` row, as private store B's open question 9 foresees.
- **The `spent` arm.** `CitationRead`'s measured arm gains `rootCited` (additive). `bootSettlement` gains the answer
  `spend` for a row whose id is root-cited and whose state is not `spent`. It never takes a mark away.
- **The restore floor** (F14). `CitationRead`'s measured arm also gains `restoreFloor: number | null`. After a confirmed
  restore, §5.1 spends "every message up to the highest id the privacy journal or a witness holds". Request record A
  builds the arm, which answers `spend` for every row with `id <= restoreFloor`. Act journal B, which owns the
  reconciliation pass of Confirm the restore, supplies the floor. It is `null` until then, and the arm spends nothing on
  it.
- **A table not yet migrated answers `not-applicable`,** as W1's adapter did. A read that throws answers `unmeasured`,
  which changes nothing.

## 7. The code shortlist

This section gives the decider that names at most six candidate programmes (ruling F5, §5.3, Table 3.7a), and the one
history read that feeds it (ruled, fix round 1, F3).

`codeShortlist(input): Shortlist` is L1, pure and total. Its inputs come from `requestShortlistRead.ts` (L3), which the
open door calls before its transaction:

```ts
// server/src/coord/requestShortlist.ts (C5, L1)
export type ExpectedPath = { readonly project: string; readonly path: string };   // normalised (RQ3)
export type ClaimByProgramme = { readonly programme: string; readonly project: string;
  readonly paths: readonly string[]; readonly renewedAt: number };                  // live claims with a run only
export type TouchedRead =
  | { readonly kind: 'measured'; readonly hits: readonly TouchedHit[] }
  | { readonly kind: 'partial'; readonly hits: readonly TouchedHit[];
      readonly why: 'more-than-eight' | 'shown-below-total' | 'budget' }
  | { readonly kind: 'unmeasured'; readonly why: 'busy' | 'deadline' | 'unavailable' | 'refused' }
  | { readonly kind: 'not-asked' };                                                 // no expected path (RQ4)
export type TouchedHit = { readonly programme: string; readonly project: string; readonly file: string;
  readonly latestMs: number | null };
export type ShortlistCandidate = { readonly programme: string; readonly claimHits: number;
  readonly touchedHits: number; readonly newest: number | null };
export type Shortlist = { readonly candidates: readonly ShortlistCandidate[];        // at most SHORTLIST_MAX (6)
  readonly basis: 'paths' | 'claims-only'; readonly touched: TouchedRead['kind'] };
export function codeShortlist(input: { expected: readonly ExpectedPath[]; claims: readonly ClaimByProgramme[];
  touched: TouchedRead; live: ReadonlySet<string> }): Shortlist;
```

**The rule**, first match per programme, then ranked:

| Step | Rule |
|---|---|
| 1 | A programme not in `live` is never a candidate |
| 2 | With no expected path: every programme with a live claim is a candidate, `claimHits` = its live claimed paths (RQ4) |
| 3 | Otherwise `claimHits` counts the expected paths that `pathsOverlap` a live claimed path of that programme in the same project. A directory covers what is under it |
| 4 | `touchedHits` counts the expected paths that a `touched` hit of that programme names in the same project. `touched` matches a file exactly or by suffix, never by directory, so a directory expected path reaches a programme only through claims. An `unmeasured` read adds none |
| 5 | A programme with no hit of either kind is not a candidate |
| 6 | Rank: more `claimHits` first, then more `touchedHits`, then the newest claim or touch, then slug. Cut at six |

*Table 7. `codeShortlist`. A claim outranks history, because a live claim is work in hand.*

**Properties the tests hold** (Table 11.7b asks them of a first-match decider):

- **Monotone:** adding a live claim to a programme never lowers its rank.
- **Fail-open:** turning `touched` from `measured` into `unmeasured` removes no programme that had a claim hit.
- **Capped:** never more than six candidates.
- **No goals:** the decider reads no goals text. Nothing parses `doneWhen` (§5.3).
- **Deterministic:** the same input gives the same order. The paths read are named (below), so the input is fixed by
  the request.

**`requestShortlistRead.ts` (L3)** composes its readers and decides nothing:

- **`liveProgrammes(db)`:** the slugs of `programs` whose state is `active`, `paused` or `unknown`, that is, not `done`
  and not `abandoned` (`shared/api.ts#ProgramState`). A paused programme still holds its claims.
- **`claimsByProgramme(coord, now)`:** `CoordStore.activeClaims()`, kept where `expiresAt > now` (the route's own
  filter), joined to `runs.program` through `runId`. A claim with no run is dropped.
- **`touchedByProgramme(fleet, db, expected, time)`**, one history read per open:
  - **Which paths:** the first eight expected paths, in the request's stated order (`SHORTLIST_TOUCHED_PATHS`, 8). One
    op call carries them all, so the open door holds the agent's one history slot once. More than eight answers
    `partial` (`more-than-eight`).
  - **Its budget, sized to the slot.** Measured on `main`: `agent/src/historyOp.ts` runs one read at a time, answers a
    second request `busy`, and frees its slot only when the worker exits, under a 20 s deadline. So the `touched` runner
    in `ccd/history/overlord-read.mjs` stops itself between paths once `TOUCHED_OPEN_BUDGET_MS` (4 s) has passed, and
    answers `partial` (`budget`) with what it read. The worker then exits and frees the slot. The door waits at most
    `TOUCHED_OPEN_WAIT_MS` (5 s), read through the time port. A wait past that answers `unmeasured` (`deadline`), and the
    slot frees when the runner's own budget ends.
  - **`busy`:** the op's `busy` answer reads as `unmeasured` (`busy`). The door never retries, and the shortlist falls
    back to the claims.
  - **A cut answer:** an answer whose `shown` is below its `total` reads as `partial` (`shown-below-total`), with the
    hits it holds. So does a read that hit `touched`'s candidate cap: the runner keeps that answer's
    `candidatesCapped`, which `ccd/history/overlord-read.mjs`'s `outcomeOf` drops today.
  - **Mapping a row to programmes:** each row's ccrc id maps through `runs.sessionId` and `runs.claimedBy`. An id
    that matches runs of several programmes counts toward each of them. An id that matches none is dropped.

## 8. The Overlord's four doors

This section gives the doors of PR B. Each is a row of `OVERLORD_DOORS`, registered in `overlordRoutes.ts`, and runs
`overlordGateRun` first.

| Door | Path | Act kind | Body | Moves | Answer |
|---|---|---|---|---|---|
| Open | `POST /api/overlord/requests` | `open-request` | `cites` (ids), `summary`, `expectedPaths`, `parentRequestId`, `consulted` | `open` | The request, the shortlist, the decision marks |
| Drop | `POST /api/overlord/requests/:id/drop` | `drop-request` | `revision`, `reason` | `drop` | The request and its move |
| Close | `POST /api/overlord/requests/:id/close` | `close-request` | `revision` | `close-unowned` (RQ12) | The request and its move |
| Escalate | `POST /api/overlord/requests/:id/escalate` | `escalate-request` (RQ13) | `revision`, `reason` (`needs-start`, `needs-proposal`, `unnamed-widening`) | `escalate` | The request and its move. No mail |

*Table 8. The four doors. Attribution is the client's: no body names `fromId` or `fromUuid` (the door process plan).*

Every row is `group: 'overlord'`, `verbClass: 'operate'`, `write: true`, `word: 'overlord-route-v1'` and `others:
'refuse'`. The `ladderClass` is the one the act catalogue gives the kind.

```mermaid
flowchart TD
  T["box token at onRequest"] --> B["body parse and bounds<br/>(too-large, bad-request)"]
  B --> G["overlordGateRun, steps 1 to 10<br/>(the op-key lookup after 7, act rows A)"]
  G -->|"refused"| X["the gate's word"]
  G -->|"pass"| S["slow reads, outside any transaction<br/>(the open door only)"]
  S --> P["in the transaction: the read-only plan<br/>(the row, its revision, the move, the citations)"]
  P -->|"no row"| NF["not-found"]
  P -->|"taken, unanswered, or a stale revision"| OH["operator-has-it,<br/>the row and its last move"]
  P -->|"not a move of the table"| BT["bad-transition"]
  P -->|"allowed"| M["overlordMayAct, then the act writer's own checks"]
  M -->|"refused"| AW["its word, nothing appended"]
  M -->|"allowed"| AP["apply: the journal, the rows, the stamps"]
  AP --> OK["the answer"]
```
*Figure 4. One door's order. Steps 1 to 10 are the gate runner's. Step 11 is the door's own, and it runs inside the
transaction: the target row and its revision, the citations, then `overlordMayAct`. Every refusal comes before the
first journal append, so no refusal can leave a trailing record (F1).*

**Each door's act row** carries the kind, the target `request:<id>`, the revision it acted on, and the summary (for
drop, the first 200 characters of the reason). For the open door it also carries the decision checks and `opens`. Act
rows A owns the row, its natural key and the operation key. A retry with the same operation key returns the stored
answer and writes nothing (index question 3).

**The open door reads each candidate's goals** (F15). For each shortlisted programme, `goalsFor`
(`server/src/coord/ledgersStore.ts#goalsFor`) gives the ratified goals version and its text. The door passes the
programme slugs and versions to `programme.pick` as `candidates`, and the goals text as its quoted `goals` field, as
the decision-model plan's row asks. It reads them only when that row is not `off`, so a disarmed row reads nothing.

## 9. I12, the sequence line and the revision

This section gives the three facts the move writer keeps true in every transaction.

- **The `request` row of `SEQUENCE_KIND_MAP`:** `request: { states: REQUEST_STATES, id: 'the request id, in decimal',
  spec: '§10.4 "a request"' }`.
  - **When a line is stamped:** at the insert, and at every move whose state word changes. A self-loop (`re-relay`,
    `counter`, `answer-recorded`) changes no state word, so it stamps nothing.
  - **The census:** `applyRequestInsertInTx` and `applyRequestMoveInTx` are the stampers in `STAMPED_TABLES`. That a
    self-loop stamps nothing is pinned by the store test, because the census lists writer functions, not moves.
  - **The actor kind:** the line's actor kind comes from one L0 map, `REQUEST_ACTOR_SEQUENCE_KIND`, which maps each
    request actor to the sequence's actor kind.
- **The revision (RQ7):** the move writer adds one in the row's `UPDATE`, and the move row records the new value. The
  row-revisions census gains `overlord_requests`, with `applyRequestMoveInTx` as `raises` and every other writer as
  `bookkeeping`, the parent's clock stamp included.
- **I12:** `i12FollowUpClock(lines, facts)` goes into `INVARIANT_MAP`'s I12 row, in place of its `waitsOn`. Its gatherer
  `requestClockFacts(db)` reads every open request's `id`, `state`, `followUpAt` and `parentRequestId`. The predicate
  is first match per open request:

| Case | Verdict |
|---|---|
| The table is absent | `not-applicable` (sequence B's `absent` arm) |
| State `needs-you`, `done-unverified` or `blocked` | holds for it |
| `followUpAt` is set | holds for it |
| It has an open child, and every open child holds | holds for it |
| Otherwise | a finding, subject `request:<id>` |

*Table 9. I12. A child depth beyond one is refused by the insert (RQ9), and the predicate still carries a visited set,
so a planted cycle is a finding, never a loop.*

**Why I12 holds between PR B and done tests** (ruled, fix round 1, F2):

- **The insert** stamps the new request's own clock, an hour on (F6), and clears its parent's.
- **When a move leaves a parent with no open child,** in a clocked state (`received` or `in-progress`), the move writer
  stamps the parent's `followUpAt` an hour on, in the same transaction. This is a bookkeeping write, and it raises no
  revision. Both of PR B's doors can end a child without its parent: a drop, or a `close-unowned` of a received child.
- **Done tests' later moves** (`close-parent` and the move of a parent to `needs-you`) go through the same writer, so
  the stamp never fights them: a parent they move out of a clocked state needs no clock.

## 10. Cross-plan seams

This section names what this plan takes from other pieces, and what it hands them.

| Piece | What this plan takes or hands | Direction |
|---|---|---|
| Private store B | `moveMessage`, `recordRead`, the boot pass and its `CitationRead` port | takes; adds `citedMessageFacts` with its ledger line, the measured adapter, the `spent` arm and the restore floor's input |
| Sequence A, B | `stampSequenceInTx`, `SEQUENCE_KIND_MAP`, the stamp census; `INVARIANT_MAP`, its gatherer | takes; adds `request` and I12 |
| Row revisions | The census of writers of revised tables | adds `overlord_requests`. Whichever lands second adds the row |
| Gates A, B | `OVERLORD_DOORS`, `overlordGateRun`, `CallerIdentity` | takes; adds four rows |
| Act catalogue A, B | The four kinds, their ceilings, `overlordMayAct` | takes; `escalate-request` is its row (RQ13) |
| Act rows A | `writeActInTx` with its `opens` field, the natural key, the operation key | takes; the open door inserts its row first and passes `opens` (RQ18) |
| Act journal A | The `open-request` record, appended through the act writer after the request row (`open-request-after-its-row`) | takes |
| Act journal B | The highest request id after a restore (RQ10), and the restore floor of messages to spend (F14) | hands it `nextRequestId`'s second argument and the boot pass's `restoreFloor` |
| Decision model A | `gatherDecisions`, `decisionMarkOf` (RQ15) | takes |
| Relay A | Calls the move writer (`planRequestMoveInTx`, then `applyRequestMoveInTx`) with `route`, `re-relay` and `route-elsewhere`, and sets `owner`, `doneTest` and `expectedPaths` | hands |
| Request ids A | Adds the news writer, a bookkeeping writer of this store | hands |
| Coordinator doors, done tests, operator's doors, follow-up | Call the move writer with their moves, add their reason words, and add their file's row to the call-site census (F8) | hand |
| Board W2 parts, home requests | Read through this store's readers | hand |
| W1's board history (its history door) | `touched` becomes a verb its door also serves (RQ5) | adds |

*Table 10. The seams.*

## 11. Global constraints and review focus

This section lists the rules every task keeps and what a reviewer should check first.

**Constraints:**

- **One writer per fact.** `overlordRequestStore.ts` is the only file that writes the three tables, and
  `writers-map.test.ts` names each writer function. A later piece adds a writer there, never elsewhere.
- **Nothing refuses after the journal record** (RQ18). Every check that can refuse runs inside the transaction and
  before the act writer's append, and an apply step cannot refuse.
- **Decide in L1, act in L4.** The handlers in `overlordRoutes.ts` read, call the deciders and call the writers. Every
  rule of §5 to §7 is in an L1 or L0 file.
- **Rings by imports.** `shared/overlordRequests.ts` imports only `./` modules, and every exported literal union has a
  `Record<X, true>` map (`rings/wire-totality.test.ts`). The deciders import no `node:*` module. The one rehash is
  the private store's, inside `citedMessageFacts` (RQ19).
- **No operator words in `coord.db`.** Message ids and hashes only. The summary, the news and the close note are the
  Overlord's or a coordinator's words, masked.
- **No overloaded null.** A failed private store read is `unmeasured`, never `absent`. An unread `touched` is
  `unmeasured` or `partial`, never an empty `measured`.
- **The migration is numbered when it lands.** The plan names no number (the index's order rule).
- **Tests run one file at a time**, through `ccrc test -- ./node_modules/.bin/vitest run test/<file>` from `server/`.

**Review focus:**

1. `REQUEST_TRANSITIONS` against Table 5.1b, edge by edge, and Figure 2 against the spec's Figure 3.
2. The order inside the transaction (RQ18): every refusal before the first journal append, and the race test's journal
   count.
3. The guards of Table 5, in their order: no Overlord move on a taken row, and no Overlord move on `needs-you` before
   the operator's answer.
4. The parent's clock when its last child ends (F2), and I12's test for it.
5. The `spent` arm never unspends, and spends up to the restore floor only when one is given.
6. The shortlist's fail-open property, and the one `touched` read's budget against the agent's one slot.

## 12. The PR split

This section gives the two pull requests, their files and their growth against the 40-line cap.

| PR | Tasks | Ships | Needs first |
|---|---|---|---|
| A | A1 to A4 | The three tables, `REQUEST_TRANSITIONS`, the deciders, the insert and move writers as plan and apply, the `request` sequence kind, the call-site census, `citedMessageFacts`, the boot pass's citation reader, `spent` arm and restore floor, I12 | Private store B, sequence A and B |
| B | B1 to B5 | The code shortlist and its reader, `touched` on the history op, the four doors, their `ccrc-api` and `DOOR_TOOLS` rows | PR A, gates B, act rows A, act journal A, act catalogue B, decision model A |

*Table 11. The pull requests. Decision model A is added to PR B's needs (RQ15).*

| Growth-checked file | PR A | PR B |
|---|---|---|
| `server/src/coord/schema.ts` | +30 (one migration, three tables, four indexes) | 0 |
| `server/src/coord/store.ts` | 0 (the store is its own module) | 0 |
| `server/src/coord/routes.ts`, `server/src/server.ts`, `server/src/watch.ts` | 0 | 0 |
| `shared/api.ts`, `pwa/src/lib/api.ts`, `ccd/ccrc-doctor-checks` | 0 | 0 |

*Table 12. Growth. `ccd/ccrc-api`, `ccd/door-process.mjs`, `overlordRoutes.ts` and `server/src/index.ts` are not
growth-checked. The migration's comment header does not count.*

```mermaid
flowchart LR
  PSB["private store B"] --> A["PR A<br/>the record"]
  SQA["sequence A"] --> A
  SQB["sequence B"] --> A
  A --> B["PR B<br/>the doors"]
  GB["gates B"] --> B
  ARA["act rows A"] --> B
  AJA["act journal A"] --> B
  ACB["act catalogue B"] --> B
  DMA["decision model A"] --> B
  A --> RIA["request ids A"]
  A --> CD["coordinator doors"]
  A --> DT["done tests"]
  A --> ORD["operator request doors"]
  A --> FU["follow-up"]
  B --> RLA["relay A"]
  B --> RV1["overlord-route-v1"]
```
*Figure 5. The order. Every request piece waits on PR A. PR B waits on the act spine and on decision model A, and relay
A and `overlord-route-v1` wait on it.*

## 13. Tasks

Each task is red first, then green, then its mutation step where it adds a guard. Run every command from `server/`.

### Task A1: The vocabulary and `REQUEST_TRANSITIONS` (L0, PR A)

**Files:**
- Create: `shared/overlordRequests.ts`
- Create: `server/test/overlord-requests-transitions.test.ts`
- No `TIME_PORT_FILES` row: `shared/overlord*.ts` is already in `TIME_PORT_FAMILIES`
  (`server/test/single-definition/time-ports.test.ts`).

**Interfaces:**

```ts
// shared/overlordRequests.ts (L0, context C5 Coordination). Imports only ./ modules.
export type RequestState = 'received' | 'routed' | 'in-progress' | 'blocked' | 'declined' | 'needs-you'
  | 'done-unverified' | 'done' | 'failed' | 'dropped';
export const REQUEST_STATES: readonly RequestState[];          // Object.keys of a Record<RequestState, true>
export type RequestActor = 'overlord' | 'owner' | 'server' | 'operator';
export type RequestMove = 'open' | 'route' | 're-relay' | 'route-elsewhere' | 'drop' | 'escalate' | 'acknowledge'
  | 'counter' | 'decline' | 'block' | 'fail' | 'close' | 'close-unowned' | 'close-unverified' | 'start-parent'
  | 'close-parent' | 'resume-parent' | 'unblock' | 'needs-you' | 'answer' | 'answer-recorded' | 'take'
  | 'hand-back-routed' | 'hand-back-in-progress' | 'hand-back-blocked' | 'confirm' | 'withdraw';
export const REQUEST_TRANSITIONS: Readonly<Record<RequestMove, {
  actor: RequestActor; from: readonly RequestState[]; to: RequestState }>>;
export const OPEN_REQUEST_STATES: readonly RequestState[];     // derived: the states some row leaves
export const TERMINAL_REQUEST_STATES: readonly RequestState[]; // derived: the complement
export const UNCLOCKED_REQUEST_STATES: readonly RequestState[]; // 'needs-you', 'done-unverified', 'blocked' (I12)
export type RequestColumn = 'owner' | 'doneTest' | 'expectedPaths' | 'dependsOn' | 'takenFrom' | 'closeNote';
export const REQUEST_MOVE_FIELDS: Readonly<Record<RequestMove, readonly RequestColumn[]>>;
export type RequestMoveReason = 'needs-start' | 'needs-proposal' | 'unnamed-widening' | 'dropped';
export const REQUEST_MOVE_REASONS: readonly RequestMoveReason[];
export type EscalateReason = Extract<RequestMoveReason, 'needs-start' | 'needs-proposal' | 'unnamed-widening'>;
export const ESCALATE_REASONS: readonly EscalateReason[];
export const REQUEST_BOUNDS: { readonly cites: 8; readonly summaryChars: 200; readonly expectedPaths: 32;
  readonly pathBytes: 512; readonly consulted: 6; readonly closeNoteChars: 600 };
export const ROOT_FOUND_WINDOW_MS: number;   // 24 hours (Table 11.5b)
export const REQUEST_NEXT_MOVE_MS: number;   // one hour (Table 11.5b)
export const SHORTLIST_MAX: 6;
```

- [ ] **Step 1: Write the failing tests.**
  - **Vocabulary:** each list equals its type's map, and its spelled `EXPECTED` list.
  - **Table 4:** each row `toEqual` an independently spelled row.
  - **Derived states:** `TERMINAL_REQUEST_STATES` equals `['done', 'failed', 'dropped']`, the list §5.1 states.
  - **Exits:** every state that is not terminal has at least one exit. Exactly one row (`open`) has an empty `from`.
  - **Hand back:** three rows, each from `needs-you`, one to each of `routed`, `in-progress` and `blocked`.
  - **Close apart:** `close` and `close-unverified` are separate rows with different targets.
  - **Fields:** every move to a terminal state lists `closeNote`, and only the three relay moves list `doneTest`.
  - **Reasons:** `ESCALATE_REASONS` is the three words of index question 7.
  - **Withdraw:** `withdraw`'s `from` equals the derived `OPEN_REQUEST_STATES`, so a new open state cannot miss it.
- [ ] **Step 2: Run red:** `ccrc test -- ./node_modules/.bin/vitest run test/overlord-requests-transitions.test.ts`.
- [ ] **Step 3: Implement** `shared/overlordRequests.ts`. Every list is derived from its key map, never kept by hand.
- [ ] **Step 4: Run green**, then `rings/wire-totality`, `rings/shared-imports` and `single-definition/time-ports`, one
  file at a time.
- [ ] **Step 5: Mutation.** Point `hand-back-blocked` at `routed`, and the hand-back test reds. Add `done` to
  `withdraw`'s `from`, and the derived terminal states red. Restore each from a saved copy.
- [ ] **Step 6: Commit** (no push: PR A pushes once, at A4).

### Task A2: The deciders (L1, PR A)

**Files:**
- Create: `server/src/coord/overlordRequests.ts`
- Create: `server/test/overlord-requests-policy.test.ts`, `server/test/requestCases.ts`, `server/test/sim/requestSets.ts`
- Modify: `server/test/sim/mutation-floors.test.ts` (`MUTANT_SETS` spreads `REQUEST_MUTANT_SETS`),
  `server/test/sim/mutation-floors.json`. No `TIME_PORT_FILES` row: `server/src/coord/overlord*.ts` is in
  `TIME_PORT_FAMILIES`.

**Interfaces:**

```ts
// server/src/coord/overlordRequests.ts (C5, L1)
export type RequestMoveRefusal = 'taken' | 'not-answered' | 'not-from' | 'wrong-actor' | 'not-taken-from'
  | 'not-acknowledged' | 'has-open-children' | 'field-not-allowed';
export type RequestMoveCtx = { answered: boolean; takenFrom: RequestState | null; ownerAcknowledged: boolean;
  openChildren: number; fields: readonly RequestColumn[] };
export function nextRequestState(state: RequestState, move: RequestMove, actor: RequestActor, ctx: RequestMoveCtx):
  { ok: true; to: RequestState } | { ok: false; why: RequestMoveRefusal };
export function followUpAfterMove(m: { to: RequestState; openChildren: number; at: number;
  promiseAt: number | null }): number | null;
/** The parent's clock after a move of one of its children (F2): an hour on, or none. */
export function parentClockAfterChildMove(p: { parentState: RequestState; openChildrenAfter: number; at: number }):
  number | null;
export function answeredSinceNeedsYou(moves: readonly { move: RequestMove; fromState: RequestState | null;
  toState: RequestState }[]): boolean;
export function closeUnownedVerdict(f: { state: RequestState; actKindsOnIt: readonly string[];
  openChildren: number }): 'allow' | 'has-acts' | 'has-open-children' | 'not-received';
export function citationVerdict(c: { root: boolean; rootCites: ReadonlySet<number> | null; now: number;
  ids: readonly number[];
  facts: ReadonlyMap<number, { read: 'ok'; state: string; at: number; sha256: string; hashMatches: boolean }
    | { read: 'absent' } | { read: 'unmeasured'; why: string }> }): CitationAnswer;
export function nextRequestId(storeHighest: number | null, journalHighest: number | null): number;
```

- [ ] **Step 1: Write the failing tests**, an exhaustive table per decider in `requestCases.ts`:
  - **`nextRequestState`:** every state, move, actor and guard fact (the cube, as `ledgers-policy.test.ts` does for
    items). The order is Table 5's: an Overlord move on a taken row is `taken`, and on a `needs-you` row the operator
    has not answered it is `not-answered`, before `from` and the actor are read (F5). So a close or an escalate on a
    taken or unanswered row answers `operator-has-it` at the door, never `bad-transition`.
  - **`followUpAfterMove`:** every target state, with and without a promise and an open child.
  - **`parentClockAfterChildMove`:** an hour on for a `received` or `in-progress` parent left with no open child, and
    none otherwise (F2).
  - **`answeredSinceNeedsYou`:** true only for an `answer-recorded` after the last move into `needs-you`. "Into" means a
    move whose `fromState` is not `needs-you`, so the `answer-recorded` self-loop never counts as an entry (F9).
  - **`closeUnownedVerdict`:** the close rule of RQ12.
  - **`citationVerdict`:** every row of Table 6, in its order. The bounds come before any read, and an `unmeasured`
    read is never answered as absent.
  - **`nextRequestId`:** both nulls, either null, and the larger of the two.
  - **Monotonicity:** a fact that is unknown or worse never turns a refusal into an allow.
- [ ] **Step 2: Run red:** `ccrc test -- ./node_modules/.bin/vitest run test/overlord-requests-policy.test.ts`.
- [ ] **Step 3: Implement.** Each decider is first match and total, and takes the time as an argument.
- [ ] **Step 4: Run green.** Register each decider in `requestSets.ts` and `mutation-floors.json` at floor 1, then run
  `ccrc test -- ./node_modules/.bin/vitest run test/sim/mutation-floors.test.ts`. Every mutant dies.
- [ ] **Step 5: Commit.**

### Task A3: The migration, the one insert and the move writer, each a plan and an apply (L3, PR A)

**Files:**
- Create: `server/src/coord/overlordRequestStore.ts`, `server/test/overlord-request-store.test.ts`,
  `server/test/single-definition/request-move-callers.test.ts`
- Modify: `server/src/coord/schema.ts` (one migration), `server/test/coord-db.test.ts` (the version pins and the
  entry's comment line), `server/test/run-close-switch.test.ts` (three `DROP TABLE`s, and the replay count in its
  prose), `server/test/single-definition/writers-map.test.ts` (`TABLES` and the writers of the three tables),
  `shared/overlord-sequence.ts` (the `request` row), `server/test/sequence-stamp-census.test.ts` (`STAMPED_TABLES`),
  `server/test/single-definition/row-revisions.test.ts` (the `overlord_requests` writers)

**Interfaces:**

```ts
// server/src/coord/overlordRequestStore.ts (C5, L3). The one owner of the three tables' SQL.
/** Read-only, inside the caller's tx(): everything that can refuse an insert (F1). */
export function planRequestInsertInTx(db: DatabaseSync, r: { origin: 'operator' | 'overlord'; summary: string;
  parentRequestId: number | null; consulted: readonly string[]; expectedPaths: readonly ExpectedPath[];
  cites: readonly { messageId: number; sha256: string; root: boolean }[]; journalHighest: number | null;
  actor: RequestActor; actorId: string; at: number }):
  { ok: true; plan: RequestInsertPlan }
  | { ok: false; why: 'root-taken' | 'parent-not-open' | 'parent-is-child'; detail: string };
/** Applies a plan made in the same tx(). Writes the row, its citations and its `open` move (actId null), and stamps. */
export function applyRequestInsertInTx(db: DatabaseSync, plan: RequestInsertPlan): { row: RequestRow; seq: number };
/** Read-only, inside the caller's tx(): the row, its revision, nextRequestState and the fields (F1). */
export function planRequestMoveInTx(db: DatabaseSync, m: { id: number; move: RequestMove; actor: RequestActor;
  actorId: string; at: number; expectRevision: number | null; reason: RequestMoveReason | null;
  promiseAt: number | null; set: Partial<Record<RequestColumn, unknown>> }):
  { ok: true; plan: RequestMovePlan }
  | { ok: false; why: 'not-found' | 'stale-revision' | RequestMoveRefusal; row: RequestRow | null;
      lastMove: RequestMoveRow | null };
/** Applies a plan made in the same tx(): the row, the move row with actId, the parent's clock (F2), and the stamp. */
export function applyRequestMoveInTx(db: DatabaseSync, plan: RequestMovePlan, actId: number | null):
  { row: RequestRow; move: RequestMoveRow; seq: number | null };
export function requestById(db: DatabaseSync, id: number): RequestRow | 'absent';
export function movesOf(db: DatabaseSync, id: number): readonly RequestMoveRow[];
export function openRequests(db: DatabaseSync): readonly RequestRow[];
export function highestRequestId(db: DatabaseSync): number | null;
export function citedMessagesForBoot(db: DatabaseSync): { cited: ReadonlySet<number>; rootCited: ReadonlySet<number> };
```

Inside the module, one private `appendMove(db, row)` writes `overlord_request_moves` for both appliers (F7). The insert
takes a `RequestActor` like the move, so `open` passes the actor check of its `REQUEST_TRANSITIONS` row and fills the
move row's `actorKind` and the line's actor kind. An apply re-runs its plan's decider on the rows it reads, and throws
if the answer differs. Inside the caller's transaction that throw rolls everything back. It is a programming error,
never a refusal word.

- [ ] **Step 1: Measure the slot**, then write the failing tests:
  `git fetch origin main && git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`.
  - **Insert:** the plan refuses a root citation another root request holds (`root-taken`), a closed parent, and a
    child of a child, and writes nothing. The apply writes `received` with its own `followUpAt` an hour on (F6), its
    cited messages, and its `open` move row with `actId` null. It stamps one `request` line. A child clears its
    parent's `followUpAt`.
  - **Move:** each move goes through `nextRequestState`. The plan refuses and writes nothing. A stale `expectRevision`
    answers `stale-revision` with the row and its last move. The apply raises `revision` by one and writes a move row
    with the act id it was given. It sets `followUpAt` by `followUpAfterMove`, and `closedAt` on a terminal state. It
    stamps a line only when the state word changes, so a self-loop stamps nothing (pinned here, because the stamp census lists writer functions). A field not in
    `REQUEST_MOVE_FIELDS` answers `field-not-allowed`.
  - **The parent's clock (F2):** dropping a child, or closing it unowned, when it is its parent's last open child,
    stamps the parent's `followUpAt` an hour on in the same transaction. The parent's `revision` does not move.
  - **Apply agrees with plan:** an apply given a plan whose row changed under it throws. The test builds that case by
    hand, since a real transaction cannot see it.
  - **The unique index backstop:** a planted second root citation, written past the plan, is refused by
    `overlord_request_messages_one_root`.
  - **Outside a transaction,** every function refuses, as `stampSequenceInTx` does.
  - **The censuses** go red until the rows are added: writers-map, the stamp census (the two appliers) and row
    revisions (`applyRequestMoveInTx` raises, nothing else does).
  - **The call sites (F8):** `request-move-callers.test.ts` scans `server/src` for every call of `planRequestMoveInTx`
    and `planRequestInsertInTx`, and holds each call's literal `actor` to its file's door group. `overlordRoutes.ts` may
    pass only `'overlord'`, the coordinator doors only `'owner'`, the operator's doors only `'operator'`, and the lane
    modules only `'server'`. An actor that is not a literal is red. Today the census has no caller and passes, and each
    later piece adds its file's row.
- [ ] **Step 2: Run red**, one file at a time: `overlord-request-store`, `coord-db`, `run-close-switch`,
  `single-definition/writers-map`, `sequence-stamp-census`, `single-definition/row-revisions`,
  `single-definition/request-move-callers`.
- [ ] **Step 3: Implement** the migration (compact, as entry 82 is, with no CHECK on vocabulary or on `closeNote`, F10)
  and the store.
- [ ] **Step 4: Run green**, the same files, then `growth-check` (schema.ts within 40) and `typecheck-tests`.
- [ ] **Step 5: Mutation.** Drop the root check from the insert plan: the `root-taken` test reds before the index is
  reached. Remove the revision raise: the stale-revision test reds. Remove the parent's clock stamp: the F2 test reds.
  Remove the stamp call: the stamp census reds. Restore each.
- [ ] **Step 6: Commit.**

### Task A4: The private store's citing reader, the boot pass's arms, and I12 (PR A)

**Files:**
- Modify:
  - `shared/operatorMessages.ts`: `READ_DOOR_MAP` gains `open-request`;
  - `server/src/operatorModel/store.ts`: `citedMessageFacts`, which rehashes and writes a read-ledger line (F11);
  - `server/src/operatorModel/bootPass.ts`: `CitationRead`'s measured arm gains `rootCited` and `restoreFloor`;
  - `server/src/operatorModel/messages.ts`: `bootSettlement` gains `spend`;
  - `server/src/index.ts`: wires `citedMessagesForBoot` as the port's adapter, with `restoreFloor` null;
  - `server/src/coord/invariants.ts` (I12's predicate), `server/src/coord/invariantFacts.ts` (its gatherer);
  - `server/test/sim/sequenceSets.ts` and `mutation-floors.json`.
- Create: `server/test/cited-message-facts.test.ts`, `server/test/request-citations-boot.test.ts`,
  `server/test/invariant-i12.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - **`citedMessageFacts`:**
    - it answers `hashMatches` true for a stored row and false for a planted text change;
    - it answers `absent` for no row and for a `gone` one;
    - it writes exactly one read-ledger line, under `open-request`, per call;
    - its answer type has no field that carries text: a type-level test fails if one is added.
  - **Boot:**
    - a root-cited row in `settled` answers `spend`, and a cited row in `delivered` settles as a `cite`;
    - a `spent` row with no root citation stays `spent`;
    - with `restoreFloor` 40, rows up to 40 answer `spend` and row 41 does not;
    - with `restoreFloor` null, nothing is spent by the floor;
    - a table not yet migrated answers `not-applicable`, and a read that throws answers `unmeasured`, which changes
      nothing.
  - **I12:**
    - every row of Table 9;
    - a parent whose open children hold;
    - a parent with one child that fails;
    - a parent whose last child was dropped, or closed unowned: it holds, through the parent's restamped clock (F2);
    - a planted cycle: a finding, and no loop;
    - monotonicity: an extra open child with a clock never removes a finding from another request.
- [ ] **Step 2: Run red**, one file at a time: `cited-message-facts`, `request-citations-boot`, `invariant-i12`, then
  `invariants` (the table's two-way check against Table 11.7a).
- [ ] **Step 3: Implement.** The `spent` arm calls `moveMessage(id, 'spend', 'boot-pass', at)`, which the private
  store's actor map already allows.
- [ ] **Step 4: Run green**, then `sim/mutation-floors`, `rings/totality`, `rings/outward-edges`,
  `privacy-journal-census`, `anchors`, `citations` and `typecheck-tests`.
- [ ] **Step 5: Mutation.** Remove the `spend` arm: the boot test reds. Drop the ledger line: its test reds. Make the
  predicate accept a missing clock: I12's table reds.
- [ ] **Step 6: Commit and push once** (worker clause 20). Open PR A against `main`. Its body names RQ1, RQ2, RQ6, RQ7,
  RQ9 to RQ11, RQ18 and RQ19, says nothing is reachable, and gives the migration's measured slot.

**PR A ends here.**

### Task B1: The code shortlist (L1, PR B)

**Files:**
- Create: `server/src/coord/requestShortlist.ts`, `server/test/request-shortlist.test.ts`,
  `server/test/shortlistCases.ts`
- Modify: `server/test/sim/requestSets.ts`, `mutation-floors.json`, and `TIME_PORT_FILES`, which gains
  `server/src/coord/requestShortlist.ts` (outside the `overlord*` family)

- [ ] **Step 1: Write the failing tests:** every row of Table 7, the directory rule of step 4 (a directory expected path
  meets claims and never `touched`), and the five properties of §7 (monotone, fail-open, capped, no goals,
  deterministic) as fast-check properties over generated claims and hits.
- [ ] **Step 2: Run red:** `ccrc test -- ./node_modules/.bin/vitest run test/request-shortlist.test.ts`.
- [ ] **Step 3: Implement**, reusing `pathsOverlap` and `normalizeClaimPath`. No second matcher.
- [ ] **Step 4: Run green**, then `sim/mutation-floors`.
- [ ] **Step 5: Mutation.** Swap the first two ranking keys: the "claim outranks history" row reds. Remove the cut: the
  cap property reds.
- [ ] **Step 6: Commit.**

### Task B2: `touched` on the history op, and the shortlist's reader (L3, PR B)

**Files:**
- Modify:
  - `shared/overlordHistory.ts`: `HISTORY_VERB_MAP` gains `touched`;
  - `ccd/history/overlord-read.mjs`:
    - `CLI_VERB` gains `touched: 'touched'`;
    - `VERBS` gains a `touched` runner over `recall.mjs`'s touched read, taking up to eight paths with its budget and
      keeping `candidatesCapped` (F4, F3);
  - `server/test/overlord-read.test.ts`;
  - `server/test/overlord-read-scope.test.ts`, which pins `overlord-read.mjs`'s import set and gains the touched
    runner's import (F4);
  - `TIME_PORT_FILES`, which gains `server/src/coord/requestShortlistRead.ts`.
- Create: `server/src/coord/requestShortlistRead.ts`, `server/test/request-shortlist-read.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - the op accepts `touched` with up to eight paths in one request, and refuses a regex as before;
  - the runner stops between paths after `TOUCHED_OPEN_BUDGET_MS` and answers `partial` (`budget`), so the worker exits
    and frees the slot;
  - a capped read, and an answer whose `shown` is below its `total`, answer `partial` (`shown-below-total`);
  - more than eight expected paths read the first eight in stated order and answer `partial` (`more-than-eight`);
  - a `busy` op answer reads `unmeasured` (`busy`), and a wait past `TOUCHED_OPEN_WAIT_MS` reads `unmeasured`
    (`deadline`), through a fake time port;
  - a ccrc id maps through `runs.sessionId` and `runs.claimedBy`, an id in runs of two programmes counts toward both,
    and an unmapped id is dropped;
  - `claimsByProgramme` drops a claim with no run and an expired one;
  - `liveProgrammes` keeps `active`, `paused` and `unknown`, and drops `done` and `abandoned`.
- [ ] **Step 2: Run red**, one file at a time: `request-shortlist-read`, `overlord-read`, `overlord-read-scope`.
- [ ] **Step 3: Implement.** The door's wait reads the time port, and its handle is a local of the call (L3, not a
  scheduler).
- [ ] **Step 4: Run green**, then `rings/outward-edges`, `single-definition/time-ports`, and the agent's own op tests
  from `agent/`: `ccrc test -- ./node_modules/.bin/vitest run test/overlord-history-op.test.ts`.
- [ ] **Step 5: Commit.**

### Task B3: The open door (L4, PR B)

**Files:**
- Modify: `server/src/coord/overlordRoutes.ts` (the handler), `server/src/coord/overlordDoors.ts` (the
  `open-request` row), `server/src/index.ts` (its deps), the call-site census (`overlordRoutes.ts` passes `'overlord'`)
- Create: `server/test/overlord-request-open.test.ts`

- [ ] **Step 1: Write the failing tests**, with the gate stubbed to pass, and doubles for the private store, the agent,
  the decision model and the act journal port. The journal double counts its appends.
  - **The happy path:** a root request citing two settled messages opens, spends both after the commit, and answers
    the shortlist and the marks.
  - **The citations:** every row of Table 6 answers its word. An unreadable private store answers `unmeasured`, never
    `said-not-operator`.
  - **The race (F1):** two opens citing one message give one request and one `said-not-operator` (`spent`). The
    losing open is refused by `planRequestInsertInTx`, before any journal append: the journal double counts exactly
    one `act-settle` and one `act-open-request`, and no fence is raised.
  - **The order:** the request row is inserted before the act writer runs. The `open` move row carries `actId` null,
    and the act row's `opens` equals the request's id. A test reads the link back through the act, as the ruling asks.
  - **After the commit:** a failed `moveMessage` still answers the request, and is logged.
  - **The body:** a body over a bound answers `too-large`. An expected path that `normalizeClaimPath` refuses, or one
    holding `*`, `?` or `[`, answers `bad-request` (F12). A body that names `fromId` is refused by the client, not the
    door.
  - **The decision model:** with every decision row `off`, the open door makes no model call and reads no goals. With
    `programme.pick` in shadow, it reads each candidate's goals through `goalsFor` (F15).
  - **Its own request:** an open request with no citation is `origin: overlord`.
- [ ] **Step 2: Run red:** `ccrc test -- ./node_modules/.bin/vitest run test/overlord-request-open.test.ts`.
- [ ] **Step 3: Implement** in the order of Figure 3 and §6. The gate call is the handler's first statement after the
  body parse, as the gates census requires.
- [ ] **Step 4: Run green**, then `overlord-doors-census`, `rings/fastify-l4`, `secret-mask` and
  `single-definition/request-move-callers`.
- [ ] **Step 5: Mutation.** Move the insert plan after the act writer: the race test's journal count reds. Move the
  private store read inside the transaction: the "slow reads before the transaction" test reds. Fold `unmeasured`
  into absent: its test reds.
- [ ] **Step 6: Commit.**

### Task B4: The drop, close and escalate doors (L4, PR B)

**Files:**
- Modify: `server/src/coord/overlordRoutes.ts` (three handlers), `server/src/coord/overlordDoors.ts` (three rows)
- Create: `server/test/overlord-request-moves.test.ts`

- [ ] **Step 1: Write the failing tests**, with the act journal port's double counting appends:
  - **Drop:** from `received` and `declined` it moves, and writes the reason, masked. From `needs-you` before the
    operator's answer it is `operator-has-it`, and after it the drop moves. From `routed` it is `bad-transition`.
  - **Close:** from `received` with no other act and no open child it moves to `done`. With a planted act of another
    kind on it, or an open child, it is `bad-transition`. From `in-progress` it is `bad-transition` (RQ12).
  - **Escalate:** from `received` and `declined` it moves to `needs-you` with its reason, writes an act row and sends
    no mail. An unknown reason is `bad-request`.
  - **All three:**
    - a stale revision is `operator-has-it`, with the row and its last move;
    - a taken row, and an unanswered `needs-you` row, are `operator-has-it`, never `bad-transition` (F5);
    - an unknown id is `not-found`;
    - every refusal leaves the journal double's count at zero (F1);
    - every success writes one act row, then one move row carrying that act's id, and one line when the state word
      changes.
  - **A child ended:** dropping or closing the last open child of a parent restamps the parent's clock (F2).
- [ ] **Step 2: Run red:** `ccrc test -- ./node_modules/.bin/vitest run test/overlord-request-moves.test.ts`.
- [ ] **Step 3: Implement.** If act catalogue A landed without `escalate-request` (RQ13), add its row first (class
  none, reversible, refuse, allow, allow, the `request` ceiling group), with its three tests' rows.
- [ ] **Step 4: Run green**, then `overlord-doors-census`, and the act catalogue's three tests (its single definition,
  its D-8126 class map and `overlord-act-compensators`).
- [ ] **Step 5: Mutation.** Drop the `answered` guard: the drop-before-answer test reds. Skip the revision compare: the
  stale test reds. Move the plan after the act writer: the zero-append test reds.
- [ ] **Step 6: Commit.**

### Task B5: The client rows, the skill's door tables and the censuses (PR B)

**Files:**
- Modify: `ccd/ccrc-api` (`ROUTES`: `request.open`, `request.drop`, `request.close`, `request.escalate`, and its count
  word), `server/test/ccrc-api.test.ts` (length and `WORDS`), `ccd/door-process.mjs` (`DOOR_TOOLS`: `open-request`,
  `drop-request`, `close-request`, `escalate-request`, each `operate` and fenced), `ccd/overlord-skill/references/routing.md`
  and `starting.md` (the two new doors), `server/src/auth/gate.ts` (`EXEMPT`, four rows with one reason each, and its
  count words), `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts` (the Overlord door set and its
  number words), `README.md` (the auth paragraph), `server/test/overlord-act-compensators.test.ts` (remove
  `POST /api/overlord/requests` from `LATER_DOORS`)

- [ ] **Step 1: Run the censuses red**, one file at a time: `ccrc-api`, `door-tools`, `door-tools-argv`,
  `auth-gate`, `box-token-census`, `overlord-skill`, `overlord-act-compensators`.
- [ ] **Step 2: Add the rows.** Each `DOOR_TOOLS` input schema names no attribution. Each `ccrc-api` verb takes its
  body on `--json -`.
- [ ] **Step 3: Run green**, the same files, then `topology-clean`, `anchors`, `citations`, `typecheck-tests` and
  `growth-check`.
- [ ] **Step 4: Run the private-name scan** over every changed file.
- [ ] **Step 5: Commit and push once.** Open PR B against `main`. Its body names RQ5, RQ12 to RQ15, the four doors, and
  that each refuses `capability-missing` until `overlord-route-v1`.

**PR B ends here.**

## Deviations found

Each entry is a departure from the spec's or the index's text, by slug. The coordinator mints numbers.

- **`request-moves-are-rows`:** §5.1's "Every move is a row" names no table. It is `overlord_request_moves` (RQ1).
- **`citations-are-a-child-table`:** Table 5.1a's "cited message ids" is a child table, so the one-root rule is a
  unique index (RQ2).
- **`expected-paths-name-their-project`:** Table 5.1a's "paths" are `{ project, path }`, with no glob (RQ3).
- **`touched-is-a-fourth-history-verb`:** §5.3's "history's `touched`" has no server reader. It becomes a fourth verb of
  the history op (RQ5).
- **`move-writer-stamps-the-clock`:** the index gives `followUpAt` at the moves to the follow-up piece. The move writer
  stamps it, so I12 holds from the first row (RQ6).
- **`age-spent-is-derived`:** §5.1's "after that the message is spent" is checked from the message's time and never
  written. Only a root citation writes the `spent` copy (RQ11).
- **`close-unowned-is-its-own-move`:** Table 5.1b's server close has three sources. The close from `received` at the
  Overlord's door is a move of its own, `close-unowned`, apart from the done-test lane's `close`.
- **`answer-recorded-is-a-move`:** Table 5.1b's "the answer is recorded, and it stays `needs-you`" is a self-loop move,
  `answer-recorded`, so the drop and route-elsewhere guards can read it.
- **`request-routes-file-with-its-first-route`:** the index has PR B create `requestRoutes.ts`. Its first route's piece
  creates it (RQ14).
- **`decide-before-the-append`:** §7.6 appends each record "before the row" and says nothing of refusals. Every request
  writer is a read-only plan and an apply, and every refusal comes before the first append (RQ18, ruled).
- **`open-row-links-through-opens`:** §5.1's "every move is a row" would give the `open` move its act. The `open` move
  row carries no act id, and the act's `opens` is the link, because the request row is inserted before its act
  (RQ18, ruled).
- **`parent-clock-restamped`:** §5.4 gives a parent no clock of its own. A parent left with no open child, before done
  tests can move it, gets its clock back from the move writer, so I12 holds (F2, ruled).
- **`one-touched-read-per-open`:** §5.3 matches every expected path against `touched`. One op call reads the first eight,
  under a budget sized to the agent's one history slot (RQ5, ruled).
- **`citing-reader-in-the-private-store`:** §9.4's citing doors read the message rows. They read facts with no text
  through `citedMessageFacts`, which rehashes and leaves a ledger line (RQ19, ruled).

## What the index should change

- **Table W2's request record row:** PR B's "Needs first" gains decision model A (RQ15). PR B is "the code shortlist
  and its `touched` reader" (RQ5). The row names `overlord_request_messages` and `overlord_request_moves` beside
  `overlord_requests`.
- **The follow-up row:** "`followUpAt` stamped at the §5.4 moves" becomes "the read-back's promise passed to the move
  writer, `followUpDue`, the arm, and the re-time after a nudge through the store's bookkeeping writer" (RQ6).
- **"Where lanes meet", the censuses bullet:** `requestRoutes.ts` is created by the first piece that registers a route
  in it (RQ14).
- **Lane R's "The record" bullet** gains `server/src/coord/requestShortlist.ts`, `requestShortlistRead.ts`, and
  `shared/overlordHistory.ts` and `ccd/history/overlord-read.mjs` (the `touched` verb, shared with W1's board history).
- **Question 7's paragraph:** the escalate door's act kind `escalate-request` sits in the act catalogue's `request`
  ceiling group, 6 and 30 (RQ13, ruled).
- **The architecture spec's path table:** no row is needed for `coord/**` or a `shared/*.ts` sibling. The index's "the
  new `shared/*.ts` siblings among them" can drop that clause (measured: the table has no `shared/` rows).
- **Table 11.5b's spec-fix list** gains the starting values of RQ16, and the budget of one `touched` read (4 s in the
  runner, 5 s at the door).
- **The act journal row and its question 4:** one order for the open door, reconciled with RQ18. The plan checks
  everything inside the transaction, then inserts the request row, then the act writer appends with `opens`.
- **The `server/src/coord/routes.ts` bullet:** drop "one registration line for `requestRoutes.ts` (request record B)",
  following RQ14.
- **A named owner for spending every message after a confirmed restore** (F14): request record A builds the boot pass's
  arm with a `restoreFloor` input, and act journal B supplies the floor from Confirm the restore.
- **Lane R's file list** also gains `ccd/history/overlord-read.mjs`'s `VERBS` map, `server/test/overlord-read-scope.test.ts`
  (F4), and the private store's `citedMessageFacts` with its read door `open-request` (RQ19).
- **Table W2's request record row:** F2's window is closed in PR A, because the move writer restamps a parent's clock,
  so the row needs no note that a parent goes without a clock until done tests ships.

## States W3 may read

- **`overlord_requests` and its two child tables,** `REQUEST_TRANSITIONS`, the move reasons and the fields each move
  may set. W3 adds reason words for the items it raises, and changes no move.
- **The move writer** (`planRequestMoveInTx`, then `applyRequestMoveInTx`), the one writer every later move goes
  through. W5's start door calls it with `route` and adds
  its own act kind.
- **`citationVerdict` and the cited messages,** which W3's answer and brief doors reuse for `said-not-operator`.
- **`codeShortlist`,** which W5's start door reads for `split-overlaps`.
- **I12's predicate,** unchanged by W3.

## Where things stand

**Agreed:**
- The index's ruling on the request record row, with F5, F6, Q2, Q5 as amended, Q7, Q13, Q27, Q28 and I12, built as
  stated.
- RQ13: the escalate door's act kind is `escalate-request`, in the `request` ceiling group (the coordinator, run 2263).
- Fix round 1 (review 2273), every finding folded, with the coordinator's rulings:
  - F1 is RQ18;
  - F2 is RQ6's parent clock;
  - F3 is RQ5;
  - F11 is RQ19;
  - F4 to F10, F12 to F15 and the nits are folded where the report places them.
- One table of moves, keyed by move, in the shape of `ITEM_TRANSITIONS`.

**Waiting on the coordinator** (at this plan's review):
- RQ1 to RQ17 but RQ13, each with its recommendation. RQ5, RQ18 and RQ19 are built as ruled in fix round 1.

**Waiting on the operator:** nothing.

**Later:**
- The follow-up piece's `followUpDue` and the re-time, through this store.
- W4's wipe, which moves every open request that cites only wiped messages to `needs-you` in the same step (§5.1),
  through the move writer with a reason word of its own.
- W3's items on `needs-you`, and W5's start door.
