# W2 request record, PR A (second part, Task A4): task note

The task note of plan [`w2-requests.md`](../../plans/2026-11-16-overlord-w2/w2-requests.md) Task A4: the private store's
reader of cited messages (`citedMessageFacts`), the boot pass's spend arm and restore floor, and invariant I12's predicate
and gatherer. The first part (Tasks A1 to A3, #3609) is on `main`; its note is
[`w2-request-record-a.md`](w2-request-record-a.md). The coordinator folds this note into the programme ledger; this pull
request edits no plan, spec or ledger.

## 1. The kept commit, and what changed in bringing it over

The first part's worker built Task A4 on its branch and kept it as one commit, `b07959900a`, whose parent is that branch's
Task A3 commit, before its two merges of `main` and its fix round. It was brought onto `main` at `1efcbe78cb` by a
cherry-pick with no commit, and re-proved here as a draft, not as reviewed work.

**Conflicts (four), each resolved by reading both sides:**

| File | `main` | The kept commit | Resolution |
|---|---|---|---|
| `shared/operatorMessages.ts`, `READ_DOOR_MAP` | The chat's two doors, `chat` and `chat-history` | `open-request` after `sequence` | Both: `open-request` after `chat-history`. The file is held by the chat's second PR (#3632), so the line went to its holder as a packet first and was applied after its yes, byte for byte |
| `shared/overlordInbox.ts`, `READ_CEILINGS` | The chat's two ceilings, 720 and 240 an hour | `open-request` at 240 an hour, with its comment | Both, the chat's first |
| `server/src/coord/invariants.ts`, I12's row | `predicate-not-built`, waiting on this part (#3609's split) | `waitsOn: null`, `w1: 'runs'` | The kept commit's: the predicate is this part |
| `server/test/sim/invariantSets.ts`, the not-built list | `I8`, `I12`, `I13` | `I8`, `I13` | The kept commit's, for the same reason |

**Merged by git, and read:** the private store (`store.ts`: the chat's `offRecord` column beside the reader), the boot
pass, the messages file, the server's index file (the composition of the citations port), the boot test's summary line.

**What `main` moved under the kept commit, found by re-running it:**

- **The stamp census's boot movers.** `COMBINATOR_CALLERS` counted three calls of the one mover in the boot pass (its
  unsettle, queue and deliver arms). The spend arm is the fourth; the count is four, as the first part's note expected.
- **The read-door pins.** Two suites list every read door (`operator-messages-moves`, `overlord-inbox-vocab`); each
  gains `open-request`, and the ceilings pin its 240.
- **`MessageRecordInput.offRecord`** (the chat's first PR) is required. The kept tests built a record without it; both
  helpers now pass `offRecord: false`, and two cases cite and spend a message sent off the record (point 4).
- **A mutant set made invalid.** `bootSpend`'s guard repeated `bootSettlement`'s line
  `if (cites.kind !== 'measured') return 'unjudged';`, which is the `old` text of two mutants of `bootSettlement`'s set and
  must occur once in the file. That set's file is held by the chat's second PR, so `bootSpend`'s guard is spelled apart
  (slug `boot-spend-guard-spelled-apart`); the two answers are the same.
- **No floor rows.** The kept commit registered I12's mutant set and no floor; the floors' two-way check reds on that.
  Three floor rows are added (§5), through two packets to the floors file's holder.

## 2. Step 0: what `main` held at `1efcbe78cb`

| Question | Answer on `main` |
|---|---|
| A migration of the private store for RQ11's unique index | None needed. RQ11: the unique index (`overlord_request_messages_one_root`) is the fact, in `coord.db`, and the private store's `spent` is a copy, written after the commit or repaired by the boot pass. This part adds no migration of either database. |
| A coordination-database migration | None. |
| Tests or a mutant row of `citedMessagesForBoot` | None: one definition, no reader in `server/test` (the first part's ruling left both to this part). |
| The boot pass's calls of the one message mover | Three (unsettle, queue, deliver). |
| The read doors | `board`, `messages`, `inbox`, `history`, `sequence`, `chat`, `chat-history`. |
| A message state named `gone` | None. A cited id with no row answers `absent`. |
| Message ids | Issued by the privacy issuer; the chat's second PR (open) will issue a reply's id from the same sequence, so the messages table's ids may have gaps. |
| Who writes a `cite` settlement | No caller in `server/src`: the citing door is PR B's. |

## 3. The brief's eight points

1. **One mover.** The spend arm moves a row only through `messageLine.ts#moveOperatorMessage`, which stamps the message's
   sequence line. The stamp census counts four boot movers and lists no new caller of the store's bare move. Hand mutation:
   the spend made through `store.moveMessage` reds the census (two cases) and the boot test (eight).
2. **The reader of cited messages, three answers.** `citedMessagesForBoot` answers measured, absent (no table) or
   unmeasured (a failed read, or a citation row with no integer id), never one folded into another. Its cases are written
   once (`server/test/bootCitationCases.ts`) for the boot test and its mutant set (six mutants, §5), among them the filter
   that reads roots only, a non-root citation alone, a gap in the ids, and an empty migrated table.
3. **I12.** The row moves to `runs` with its predicate `i12FollowUpClock` and its gatherer `i12Facts` (through the request
   store's `openRequests`). The invariant table's two-way check against the spec still holds (`invariant-table`,
   `invariants`), and the simulator's two lists move: I12 leaves the not-built list and joins the running rows. A request
   cited by no message is not I12's question; I12's three verdicts are `holds`, a finding per request (`request:<id>`), and
   `unmeasured` when the facts could not be read (`not-applicable` with `tables-absent` before the migration).
   For the citations themselves the boot pass keeps the same three apart: a citation of a message the private store lacks
   is left alone (no row is inferred), a store read that fails is logged and defers its spends, and a citation read that
   fails changes nothing.
4. **Ids and hashes only.** `citedMessageFacts` answers state, time, stored hash and whether the stored text still hashes
   to it; its type has no text field (a type-level test). Its ledger line holds the door, `message:<id>`, a count and an
   outcome. Every boot line names ids and counts. A message sent off the record is cited and spent like any other, by its
   id, and two cases pin that no answer, ledger line or sequence line holds its words.
5. **The restore floor and "the highest id".** Nothing in this part reads a highest id. The floor is an input (`none`
   until act journal B supplies one; `unreadable` spends nothing by the floor), and the arm spends the rows that exist at
   or below it (`unspentThrough`), never an id inferred from a count. A case issues ids 1, 2, 5 and 6 (3 and 4 taken by
   another record of the same sequence), puts the floor on 4, and pins that rows 1 and 2 are spent, 5 and 6 are not, and
   no line names 3 or 4; a root citation of 3 moves nothing.
6. **The test titled "six columns"** in `overlord-requests-transitions.test.ts` now says seven, which it asserts.
7. **Nothing reachable beyond the boot pass.** No route, door, gate row or client row. What the boot pass now does at
   start on a box with no request rows (the state of every box today), measured against W1's adapter on twin fixture
   worlds: the same counts, the same lines, the same rows in the private store, its read ledger, the sequence and the mail;
   two more reads (the citations table, and the private store's unspent rows among an empty set); and its one summary line
   gains `, spent 0`. One difference cannot occur on any box: a row settled by a citation, which no request cites, is now
   unsettled where W1's adapter left it unjudged; no caller on `main` writes that settlement. Both are pinned.
8. **The programme's design rule.** Everything here is the product's own stores, deciders and boot pass; nothing depends
   on one agent harness.

## 4. Departures, by slug

- **`boot-spend-guard-spelled-apart`** (§1).
- **`boot-reader-has-a-mutant-set`.** `citedMessagesForBoot` is an L3 reader, not a decider, and has a mutant set and a
  floor by the coordinator's ruling: its two sets decide what the boot pass spends.
- **`boot-spend-has-its-floor`.** The plan names no floor for `bootSpend`, the spend arm's L1 decider; it gets one (nine
  mutants). Its set lives in `sim/requestSets.ts` beside the reader's, because `sim/operatorModelSets.ts` is held by the
  chat's second PR.
- **`boot-citation-cases-shared`.** The two sets' cases are one new file, `server/test/bootCitationCases.ts`, which the
  boot test runs.
- **`restore-floor-three-words`.** The plan says `restoreFloor: number | null`; the kept commit's
  `RestoreFloorRead` is `floor`, `none` or `unreadable`, so a floor that could not be read is never folded into "no floor"
  (no overloaded null). Both of the latter spend nothing by the floor; `unreadable` logs one line.
- **`cited-reader-takes-the-ledger-caller`.** The plan's `reader: { door, caller, at }`; the reader takes the read
  ledger's caller fields (`at`, `caller`, `generation`, `generationRead`, `turnState`) and fixes the door itself.
- **`no-gone-state`.** The plan's "a gone row is absent": no `gone` state exists, so absent is "no row" only.
- **`unknown-state-word`.** A stored state this build cannot name reads as `unknown`, in the reader's answer and in the
  spend arm, which spends an unknown root-cited row (the closed direction: the citation is the fact).
- **`summary-line-gains-spent`** and **`cite-settlement-judged`** (point 7).
- **`non-root-citation-not-settled-at-boot`** (the kept commit's known limit). The boot pass does not settle a delivered
  row that only a child cites: W1's actor map lets only the citing door settle. The cited set keeps a `cite`-settled row.
- **`sequence-sets-untouched`.** The plan lists `server/test/sim/sequenceSets.ts`; no sequence decider changed, so it is
  not edited.
- **Process.** Both packets to the chat's second PR (the read door row and three floor rows) were sent before the edit
  and applied byte for byte after its yes. One narrow type-check configuration was first written inside the work tree,
  removed at once and rewritten in the session's temp root; it was never committed.

## 5. Mutation rows

| Set | Mutants | Before | After |
|---|---|---|---|
| `invariants.ts#i12FollowUpClock` | 7 | not registered | 1 |
| `overlordRequestStore.ts#citedMessagesForBoot` | 6 | not registered | 1 |
| `messages.ts#bootSpend` | 9 | not registered | 1 |
| `messages.ts#bootSettlement` | 6 | 1, two mutants invalid with the kept commit's text | 1 |

Each set runs through the floors' own runner, and every mutant is killed. Hand mutations of the L3 and L4 parts, each
run against its suite and restored (the tree measured clean with `git status` after the last):

| Mutation | What reds |
|---|---|
| The spend arm switched off in the boot pass | The boot test, 11 cases |
| The spend made through the store's bare move, not the one mover | The stamp census, 2 cases; the boot test, 8 |
| The read-ledger line removed after it is written | `cited-message-facts`, 3 cases |
| The rehash replaced by `true` | `cited-message-facts`, 1 case |
| I12's gatherer reading no request | `invariant-i12`, 4 cases |

## 6. Known limits

- **The tests' whole type check** is killed by the test slice's memory cap (6 GiB, exit 137). It ran narrowed to every
  test file this part adds or changes and their imports, clean; CI's typecheck is the arbiter for the rest.
- **Two floor sets of the face** (`pwa/src/face/mood.ts`) fail their baseline in this tree, which has no design-system
  package installed; they are not this part's.
- **The chat's second PR adds a private-store migration and issues reply ids from the message sequence.** This part
  carries no migration, and reads no highest id, so whichever lands second has nothing to renumber here.
- **A gap for a ticket (carried from the first part):** nothing checks that a `tables-absent` row names no table the
  schema has.
