# Overlord W1, the chat, PR A: task note

Plan: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, Tasks 1 to 4 (PR A). Task 5, the replies, is PR B and is not
built here. Spec: `docs/superpowers/specs/2026-11-09-overlord-design.md` §4 (Table 4a row 7), §3.8 H7 and §9.4.

This note is written in two stages, as the run was dispatched. **Stage 1** (done, local) is everything that edits none of the
seam other runs hold: the vocabulary and deciders, the `offRecord` fact, the read runner's operator mode and the counter by
caller, the continuity store's read of one identity's generations, the history measurement, the two doors' decisions as pure
functions, and both doors' route suites written red. **Stage 2** adds the two handlers, their door rows and wiring, every census
that ties a row to a live door, the `CLAUDE.md` paragraph, the mutation floors' registration, and Task 4 (the chat part of the
Overlord place).

## What was built (stage 1)

| Piece | Where | Ring, context |
|---|---|---|
| The chat's vocabulary and wire: ticks from the message moves (`MESSAGE_TICK_MAP`, keyed by `MessageState`), `chatTicksOf`, the server's line for each readiness word (`CHAT_SERVER_LINE_MAP`, total over `ReadinessWord`), `NOT_ON_RECORD`, `ChatThread` and its one reader, the two doors' query readers, the earlier page's answer and its reader, the prompt route's answer as the chat reads it | `shared/overlordChat.ts` (new) | L0, C11 |
| The nudge line's one grammar: `operatorMessageNudgeLine` and its recogniser `operatorMessageNudgeIdOf`, beside `operatorMessageSubject`; `envelope.ts#renderOperatorMessageNudge` types exactly that line | `shared/operatorMessages.ts`, `server/src/coord/envelope.ts` | L0; L1 |
| Two read-ledger door words, `chat` and `chat-history`, and their ceilings (720 and 240 an hour) | `shared/operatorMessages.ts#READ_DOOR_MAP`, `shared/overlordInbox.ts#READ_CEILINGS` | L0 |
| `readinessAt`, `composeChat`, `earlierPagePlan` | `server/src/coord/overlordChat.ts` (new) | L1, C5 |
| Every decision of the two doors: the designation's three arms (`chatDesignation`), each reader's answer as a fact, the thread's ledger line (`chatThreadComposed`), the earlier page's step, scope and answer (`earlierStep`, `earlierScope`, `earlierComposed`), the measured arm `CHAT_EARLIER_PAGEABLE` | `server/src/coord/overlordChatDoor.ts` (new) | L1, C5 |
| `offRecord` on `operator_messages`: the private store's migration 3 (its own sequence), written only by `recordMessage`'s insert, returned by every row reader, echoed on a replay from the stored row | `server/src/operatorModel/schema.ts`, `store.ts` | L3, C11 |
| `messagesPage(beforeId, limit)`, a words reader for the thread door alone | `server/src/operatorModel/store.ts` | L3, C11 |
| `servedReadsSince(door, sinceMs, caller)`: each side counts its own lines, the refused-line query included | `server/src/operatorModel/store.ts` | L3, C11 |
| The prompt route's `offRecord` rule (`true` on a prompt that would be typed refuses `bad-request`, nothing typed) and the answer's echo | `server/src/operatorModel/messages.ts`, `promptRecord.ts` | L1; L4 |
| The read runner's operator mode: one runner, `OverlordReadArgs \| OperatorReadArgs`; the operator's lines carry caller `operator`, a null generation, `not-a-session` and a null turn state | `server/src/coord/overlordRead.ts` | L4, C5 |
| `generationsOf(db, identity)`: every generation of one identity across terms in `(term, n)` order, text-free, with its start's conversation id; all or failure | `server/src/continuity/continuityStore.ts` | L3 |
| The console's words: `draftAfterSend`, `turnOrigin`, `mergeLive`, `historyItemsToChat`, and the tick, divider, origin and notice words | `pwa/src/overlord/chatWords.ts` (new) | L1 |
| The twelve deciders as mutant sets, each case written once | `server/test/sim/chatSets.ts` (new) | test |

Tests added or changed: `overlord-chat-vocab`, `overlord-chat-compose`, `overlord-chat-door` (red), `overlord-chat-earlier`
(the measurement and a census green, the door cases red), `continuity-generations-of`, `operator-model-store`,
`overlord-read-runner`, `overlord-prompt-record`, `single-definition/writers-map` (a column check for `offRecord` and `sendKey`),
`sim/operatorModelSets` (an `offRecord` case and mutants PT13, PT14), the two vocabulary tests that pin `READ_DOORS`, nine suites
whose only change is `offRecord: false` on a `recordMessage` fixture, and `pwa/test/overlord-chat-words`.

## Task 3 Step 1: the measured arm is `not-pageable`

On a fixture history store, through the Overlord's own read (`overlord-read.mjs` in its worker): `expand <conversation id>`
reads the id as an entry uuid and finds nothing (exit 3, no items), and `describe` takes node ids only (`bad-args`). No read verb
names a conversation's newest entries. So `CHAT_EARLIER_PAGEABLE` is false: every earlier divider reads "Read generation n in
ccrc history", and the earlier door refuses a page `bad-request` `not-pageable`, with its ledger line. `expand --around <entry>`
does page within one transcript, and its items carry `uuid`, `role`, `type`, `ts_ms` and `text` and no conversation id, so when
paging joins (the history door's cursor) the line's scope names the `around` (step 7's second arm). The characterization case is
the first case of `server/test/overlord-chat-earlier.test.ts`.

## Where main differed from the plan

- **The readiness reader** is `overlordReadinessStore.ts#readinessChanges(db, sinceMs, untilMs)`, answering `{ rows, oldest }`,
  not `readinessHistory(db, sinceMs)`. Its prune already keeps the newest row, the newest `ready` row and an open episode's first
  row, so the plan's condition on the readiness piece holds.
- **Private store B shipped** the `sendKey` column and its replay, `promptTargetVerdict` and `stale-designation`. The chat adds
  the `offRecord` rule to that decider and nothing else.
- **`server/src/server.ts` needs no `offRecord` edit**: the prompt route hands the raw request body to `promptTargetVerdict` and
  `recordOperatorPrompt`, so the field reaches both (slug `offrecord-rides-the-raw-body`). Its edits at stage 2 are the masked
  routes and the doors' wiring only.
- **The fixture history store is built per run** (`makeHistoryBox`, `seedFamily`, `runSweep`), as every history suite builds it,
  not committed under `server/test/fixtures/overlord-chat-history/` (slug `chat-history-fixture-is-built-per-run`).
- **The live transcript's mail nudges** are drawn by today's `buildChatItems` as `mail-prompt` rows, and its quiet gaps as time
  dividers; `mergeLive` reads both.

## Departures, by slug

- **`readiness-at-names-not-on-record`**: the plan's `readinessAt` answered `ReadinessWord | 'unmeasured'`, but `unmeasured` is
  already a readiness word (a stored row saying the state could not be read) with its own line. The two conditions draw
  different lines, so folding them would overload one value at a seam. The no-row case is its own word, `not-on-record`, and
  draws `CHAT_SERVER_LINE_UNMEASURED`.
- **`chat-line-counts-every-read-with-words`**: the plan's thread line recorded "the first unmeasured part's word" as its
  outcome. A thread whose messages were read hands the operator's words whatever else failed, so it is a served line (`rows`)
  and counts against the console's ceiling; only a thread whose messages could not be read records `messages-unmeasured`.
- **`near-miss-nudge-is-pane-text`**: a text that carries an operator message's marker but is not exactly its nudge line opens
  with the mail nudge's head, so the injected-prompt reader calls it ccrc's. `turnOrigin` draws it as pane text, as the plan's
  question 6 rules a near miss.
- **`earlier-door-none-is-no-generation`**: with no designation the earlier door has no identity to read, so it answers 400
  `bad-request` `no-generation` with no line, where the thread door answers its 200 `none` thread.
- **`chat-history-fixture-is-built-per-run`** and **`offrecord-rides-the-raw-body`**, above.

## Mutation rows

Every set scores 1 (each mutant killed), measured by `runMutants` on stage 1's tip. Registration in
`server/test/sim/mutation-floors.test.ts` and its floors file waits for stage 2: both files are held by another run.

| Decider | Mutants | Killed |
|---|---|---|
| `shared/overlordChat.ts#chatTicksOf` | T1 delivery lit by a later state, T2 an unknown state lights its stamps, T3 delivery always queued, T4 a mark-settled row lights delivery, T5 picked-up lit by delivery | 5/5 |
| `shared/overlordChat.ts#readChatThread` | R1 an unknown kind refuses, R2 no `v` check, R3 a part of any kind reads, R4 a missing `offRecord` reads true, R5 a designated thread needs no term | 5/5 |
| `shared/overlordChat.ts#readChatSendAnswer` | S1 a 200 with no `messageId` recorded, S2 `retryAfterS` dropped, S3 the echo defaults true, S4 a refusal with no word refused | 4/4 |
| `shared/overlordChat.ts#readChatEarlierQuery` | Q1 extra keys (a target) admitted, Q2 `around` unchecked, Q3 zero admitted | 3/3 |
| `shared/operatorMessages.ts#operatorMessageNudgeIdOf` | N1 a trailing word admitted, N2 every space trimmed, N3 an unsafe id admitted | 3/3 |
| `server/src/coord/overlordChat.ts#readinessAt` | A1 a change at the time not yet in force, A2 before every row reads `ready` | 2/2 |
| `server/src/coord/overlordChat.ts#composeChat` | C1 `ready` draws a line, C2 unreadable readiness folded into `ready`, C3 a message first on a tie, C4 every first divider a new term, C5 unreadable messages as an empty page, C6 pageable ignored, C7 the live generation not current | 7/7 |
| `server/src/coord/overlordChat.ts#earlierPagePlan` | E1 the live generation read, E2 pageable ignored, E3 the target is the identity not the row's session, E4 a one-entry window | 4/4 |
| `pwa/src/overlord/chatWords.ts#draftAfterSend` | W1 no answer clears, W2 off-shape clears | 2/2 |
| `pwa/src/overlord/chatWords.ts#turnOrigin` | O1 pane text read as a nudge, O2 a near miss is ccrc's | 2/2 |
| `pwa/src/overlord/chatWords.ts#mergeLive` | M1 an id drawn twice, M2 pane text passed through as a live user row, M3 an early message drawn at the end, M4 a nudge outside the page dropped | 4/4 |
| `pwa/src/overlord/chatWords.ts#historyItemsToChat` | H1 a user item drawn as the Overlord's text, H2 an unreadable item drawn as text | 2/2 |
| `server/src/operatorModel/messages.ts#promptTargetVerdict` (existing set) | PT13 `offRecord` on a typed prompt types, PT14 any `offRecord` value counts | 2/2 added |

By hand (each red, each reverted): drop the caller filter from `servedReadsSince` (4 cases red, the operator-ceiling case among
them); let `messagesPage` answer an empty page for a closed store (red); drop the `offRecord` rule from `promptTargetVerdict` (3
red); write `offRecord` in a second statement (the new column check red, the per-table check green, so the column check is the
mechanism); let the runner read the turn in operator mode (2 red).

## Censuses that move with the live doors (stage 2)

`auth-gate.test.ts` (the routes file's count and sentences), `box-token-census.test.ts` (`OVERLORD_OPERATOR_DOORS` and the
`CLAUDE.md` sentence), `secret-mask.test.ts` (`MASKED_GET_ROUTES`), `operator-message-readers.test.ts` (`messagesPage` among the
words readers, the chat's path in `OPERATOR_MESSAGE_DOORS`, `chat` in `TEXT_READING_DOORS`), the gates piece's
`overlord-doors-census`, and `mutation-floors` (the twelve sets above). `time-ports` and `fastify-l4` are measured at build.

## What would change for another harness

The chat records through the server and reads the record, which any harness can use. Two things lean on Claude Code: the live
generation's stream (its transcript, read by today's `SessionStream` and `buildChatItems`) and what a pane turn is (the mail
lane's nudge line in that transcript). Both stay behind those readers; another harness changes the readers, and `chatWords.ts`
keeps its rule that no transcript user turn is ever the operator's words.

## Known limits (so far)

- Earlier generations are not paged in W1 (the measured arm); the divider names `ccrc history` instead.
- The full server test-project type check is killed by the test slice's memory cap on this box; the changed test files are type
  checked in a narrowed project instead, and `typecheck-tests` in CI covers the whole.
