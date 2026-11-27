# Overlord W1, the chat, PR A: task note

Plan: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, Tasks 1 to 4 (PR A). Task 5, the replies, is PR B and is not
built here. Spec: `docs/superpowers/specs/2026-11-09-overlord-design.md` §4 (Table 4a row 7), §3.8 H7 and §9.4.

This note is written in stages, as the run was dispatched. **Stage 1** (done, local) is everything that edits none of the
seam other runs hold: the vocabulary and deciders, the `offRecord` fact, the read runner's operator mode and the counter by
caller, the continuity store's read of one identity's generations, the history measurement, the two doors' decisions as pure
functions, and both doors' route suites written red. **Stage 1b** (done, local) is the part of Task 4 in new files of its own:
the chat part and its pieces, its hook over a port it declares, and the composer's opt-in props. **Stage 2** adds the two
handlers, their door rows and wiring, every census that ties a row to a live door, the `CLAUDE.md` paragraph, the mutation
floors' registration, the shared client's three calls, the mount in the Overlord place, and the browser suite (done, after one
ordinary merge of main `3fda0fc9b1`, which carries home B, #3457, and the sequence doors, #3456).

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

## What was built (stage 1b)

| Piece | Where | Ring, context |
|---|---|---|
| The chat part: dividers with their earlier pages, operator bubbles with ticks and marks, the server's line, the live transcript merged with the record, a line for every part that could not be read, the composer with the off-the-record toggle | `pwa/src/overlord/OverlordChat.tsx` (new), `overlordChat.css` (new) | L4 |
| Its pieces: `ChatTicks`, `ChatDivider`, `ChatServerLine`, `PaneTurn` | `pwa/src/overlord/*.tsx` (new) | L4 |
| The hook: the thread read, one coalescer for every trigger, the earlier pages, the send with its key and term; the port it declares (`OverlordChatPort`: the thread, the earlier page, the send) | `pwa/src/overlord/useOverlordChat.ts` (new) | L4 |
| The refresh's decisions: `chatReadTrigger` (the allow-list), `nextReadAt` (the spacing and a ceiling's wait), `awaitsPickUp` (the timer reads only then; a stage 1b snapshot: fix round 1 replaced it with `pickUpReadEvery`); the part's status words | `pwa/src/overlord/chatWords.ts` | L1 |
| The composer's opt-in props: `onRecord` (the text kept until the answer, cleared only on `clear`; Send held while one answer is on its way; a draft edited meanwhile never cleared by it) and `leading` (a node before Send); `onSend` is optional beside `onRecord` | `pwa/src/session/Composer.tsx` | L4 |
| `ChatItemView` exported, so a live transcript row in the chat is drawn by the session view's own renderer | `pwa/src/session/ChatList.tsx` | L4 |

Tests: `pwa/test/composer-record.test.tsx` (new: five characterization cases, green on the composer before the props landed,
then the props), `pwa/test/overlord-chat.test.tsx` (new, jsdom, a fake port), and one near-miss case in
`overlord-chat-words` and in `sim/chatSets.ts`'s `turnOrigin` set.

What stage 1b stops at, as a prop (home B's files are not on main): the current generation's transcript rows (`live`, the shared
`ChatItem` rows) and its stream's frames (`subscribe`) come from the place's session stream at the mount; the port is built from
the shared client's three calls in stage 2. Nothing outside a test builds the part yet.

## What was built (stage 2)

| Piece | Where | Ring, context |
|---|---|---|
| `GET /api/overlord/chat` and `GET /api/overlord/chat/earlier`: the account gate with no cap (refused `auth-off` while sign-in is off, before any read or line), the query's reader, the designation's three arms, then the read runner in its operator mode (doors `chat` and `chat-history`); each handler only calls the pure functions of `overlordChatDoor.ts` and `overlordChat.ts` | `server/src/coord/overlordRoutes.ts` | L4, C5 |
| The routes' `chat` deps: the one read runner, the private store (so the words are read in the door's handler), `generationsOf` over `coord.db`, `readinessChanges`, and the history door's agent links and port; `MASKED_GET_ROUTES` gains both reads | `server/src/server.ts` (8 lines) | L5-side wiring |
| `OVERLORD_DOORS` gains `chat` and `chat-earlier`, operator `view` rows | `server/src/coord/overlordDoors.ts` | L1 |
| The thread door's answer read by status and body, beside the send answer's reader | `shared/overlordChat.ts#readChatThreadAnswer` | L0, C11 |
| The client's three calls, each read by its L0 reader through one helper (`readAnswer`): a 2xx and a refusal are both answers, only no answer is `no-answer`; a 401 still raises the login screen | `pwa/src/lib/api.ts` (17 lines) | L3 |
| Part 7 of the place: `ChatPart`, mounted below the capacity line, reusing the place's one session store (`useOverlordSessionStream`'s connect): the store's events are the live rows (`buildChatItems`), and a change of its transcript or status is handed to the refresh as the frame it came from, so no second stream and no new frame | `pwa/src/overlord/ChatPart.tsx` (new), `OverlordPlace.tsx` (4 lines added, 2 changed) | L4 |
| The thread bounded at 70dvh, its own scroller | `pwa/src/overlord/overlordChat.css` | L4 |

Censuses moved, each re-derived on the merged tree: the gate census (both reads flag-aware, thirty-nine to forty-one; 343
scanned, 340 HTTP, 222 gated, 118 exempt on stage 2's base, and 344, 341, 222, 119 since the merge of the board's main, under
Known limits) and `gate.ts`'s count; `OVERLORD_OPERATOR_DOORS` and the Overlord file's route count
(sixteen to eighteen); the doors census's landing list; the operator-message readers census (`messagesPage` is a text reader, and
`GET /api/overlord/chat` is the one entry of `OPERATOR_MESSAGE_DOORS`); `MASKED_GET_ROUTES`; the floors (the twelve sets
registered, each at 1); the contrast suite's sheet list; the `CLAUDE.md` sentence beside the witness door's. `time-ports` and
`fastify-l4` needed nothing (green as they stood).

Packets, each a diff against main `3fda0fc9b1` with its size and sha256, each answered yes before its file was edited:
`server.ts` (docs artifacts A3), the floors file (renewal readings G), `pwa/src/lib/api.ts` (home C; a second cut renamed the
helper, because the file already imports `answered`), and the door table, the two censuses, the gate census, `gate.ts` and
`CLAUDE.md` (board B2, as a notice: its PR is on the landing line and lands first, so the counts re-derive at this branch's last
merge). The gate's rows went to the coordinator by diff (call 1687). Home C's packet for this branch's `overlordRoutes.ts` (the
rebind door's pair) was answered yes: it meets none of the chat's lines.

Tests: `pwa/browser/overlord-chat.browser.test.ts` (new: 360, 390, 1280 and 1920 px, both skins, the light and the dark palette
by its id, the stamped theme asserted; 36 cases), `pwa/test/overlord-chat-part.test.tsx` (new: the mount over the session store),
`overlord-chat-vocab` (the thread answer's reader), and the earlier door's query case corrected (its upper-cased uuid was all
digits, so it upper-cased nothing: a uuid with hex letters now). Home B's place suite (128 cases in the browser, 19 in jsdom) is
green with the chat mounted.

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

The coordinator ruled on the first five on 2026-11-26 (call 1543): all stand as built. The stage 1b slugs below stand for review (call 1570).

- **`readiness-at-names-not-on-record`**: the plan's `readinessAt` answered `ReadinessWord | 'unmeasured'`, but `unmeasured` is
  already a readiness word (a stored row saying the state could not be read) with its own line. The two conditions draw
  different lines, so folding them would overload one value at a seam. The no-row case is its own word, `not-on-record`, and
  draws `CHAT_SERVER_LINE_UNMEASURED`. No row in force and a stored `unmeasured` word are two states, never one value.
- **`chat-line-counts-every-read-with-words`**: the plan's thread line recorded "the first unmeasured part's word" as its
  outcome. A thread whose messages were read hands the operator's words whatever else failed, so it is a served line (`rows`)
  and counts against the console's ceiling; only a thread whose messages could not be read records `messages-unmeasured`. A read
  that handed message words counts whatever else in it was unmeasured, the safe direction for a ceiling.
- **`near-miss-nudge-is-pane-text`**: a text that carries an operator message's marker but is not exactly its nudge line opens
  with the mail nudge's head, so the injected-prompt reader calls it ccrc's. `turnOrigin` draws it as pane text, as the plan's
  question 6 rules a near miss. Only the exact line is ccrc's; a near miss by one character at either end (changed, dropped or
  added, at the first and the last character) is pane text, a case in both the words suite and the `turnOrigin` set.
- **`earlier-door-none-is-no-generation`**: with no designation the earlier door has no identity to read, so it answers 400
  `bad-request` `no-generation` with no line, where the thread door answers its 200 `none` thread. There is no line only because
  no read is attempted and nothing is counted. After a retire the thread reads `none` and earlier generations are not offered
  until the next start, while the messages stay in the record (the part says so, and holds the composer).
- **An unreadable designation answers 502 `unmeasured` on both doors**, as the plan says, where the designation read's own door
  answers 503 `unavailable`: deliberate, not a slip; the chat doors speak the plan's word for a read they could not measure, and
  the designation door keeps its own answer.
- **`chat-history-fixture-is-built-per-run`** and **`offrecord-rides-the-raw-body`**, above.
- **`chat-composer-passes-no-id`** (stage 1b): the measured way to turn off attachments and slash completion is to pass no session
  id. Without one, the composer draws no attach control and asks no command list (a characterization case pins both), so no prop
  was added for them.
- **`on-record-answers-clear-or-keep`** (stage 1b): `onRecord` answers `'clear' | 'keep'`, which the hook takes from
  `draftAfterSend`, so the session's composer imports nothing of the Overlord's.
- **`stale-designation-reads-at-once`** (stage 1b): every send's answer asks for a read through the coalescer, but a
  `stale-designation` answer asks past the 10-second spacing (never past a ceiling's wait), because the next send must carry the
  new thread's term. A case pins that the resend carries the new term and a new key.
- **`chat-css-of-its-own`** (stage 1b): the part's styles are `overlordChat.css` beside it, since the place's `overlord.css` is
  another run's file.
- **`chat-controls-are-the-design-systems`** (stage 1b): "Show generation n", "Show earlier" and the toggle are `@ccrc/ui`'s
  `Button` (ghost; the toggle primary while pressed), never hand-drawn (`control-census`), so no rule of the part paints a
  translucent ground (`ink-tiers`, `audit-refusals`).
- **`chat-part-grounds-itself`** (stage 1b): `.oc-chat` sets its own ground and ink (`--bg-page`, `--ink-primary`), and every rule
  of `overlordChat.css` names it, so the contrast audit measures each pair by its descendant route with no registry entry.
- **`chat-refusals-by-lookup`** (stage 1b): the two refusal words the chat acts on (`stale-designation`, `read-ceiling`) are read
  through one table, `chatWords.ts#chatRefusalRole`, so no branch spells a refusal word (`refusal-literal-ratchet` stays at its
  pin; `sendNotice`'s stage-1 branch moved onto the table too).
- **`chat-part-reads-the-store-not-the-socket`** (stage 2): the session store has no frame hook, and adding one would be a second
  path beside its socket handler. The mount subscribes to the store itself: new transcript events are handed on as an `events`
  frame and a status change as a `status` frame, so the refresh's allow-list reads exactly what the store applied. A `beat` changes
  neither, so it can never trigger a read.
- **`chat-thread-is-an-operator-message-door`** (stage 2): the plan put `chat` in `TEXT_READING_DOORS`, but that list is the
  refusing Overlord doors' (group `overlord`, others refused) and the chat's rows are operator doors. So the thread is the one
  entry of `OPERATOR_MESSAGE_DOORS`, which is what that list is for, and `TEXT_READING_DOORS` stays `['messages']`.
- **`chat-door-reads-the-store-in-its-handler`** (stage 2): the routes take the private store itself, not a closure over it, so
  the census sees the words read inside the door's own handler; a call in `server.ts` would be a call outside every door.
- **`chat-thread-answer-has-one-reader`** (stage 2): the client's calls hand status and body to L0 readers, so the client imports
  nothing from the console and the hook's port type is the L0 answer type.
- **`chat-pick-up-wait-ten-minutes`** (fix round 1, review 4070 F1): the plan's pick-up timer had no end; the timer now reads
  for a message waiting for its pick-up only while it is younger than ten minutes (every 10 s in its first minute, then every
  30 s). The bound and why are under Fix round 1.
- **`chat-toggle-follows-the-box`** (fix round 1, review 4070 F4; fix round 2, review 4084 F2): the plan reset the toggle after a
  recorded send; it resets only when the composer really cleared the box (`onRecordCleared`), and it is held while a send is on
  its way, so the clear never undoes a press made during the wait.
- **`chat-visibility-through-the-page-clock`** (stage 1b): the hook hears the page turning visible through
  `lib/pageClock.ts#onPageVisible`, the one owner of that subscription (`pwa-one-owner`), and reads `document.visibilityState`
  itself before each read.

## Mutation rows

Every set scores 1 (each mutant killed), measured by `runMutants` on stage 1's tip. They were registered in
`server/test/sim/mutation-floors.test.ts` and its floors file in stage 2 (renewal readings G's yes on the floors file), each at 1;
fix round 1 added the refresh's three deciders, below.

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
| `pwa/src/overlord/chatWords.ts#chatReadTrigger` (fix round 1) | RT1 any events frame asks, RT2 idle after anything asks, RT3 busy asks | 3/3 |
| `pwa/src/overlord/chatWords.ts#nextReadAt` (fix round 1) | N1 the ceiling's wait ignored, N2 no spacing after a read, N3 no default spacing | 3/3 |
| `pwa/src/overlord/chatWords.ts#pickUpReadEvery` (fix round 1) | P1 no bound, P2 an unknown state awaited, P3 the oldest decides, P4 no slowdown, P5 a pick-up awaited, P6 a settlement awaited | 6/6 |
| `server/src/operatorModel/messages.ts#promptTargetVerdict` (existing set) | PT13 `offRecord` on a typed prompt types, PT14 any `offRecord` value counts | 2/2 added |

By hand (each red, each reverted): drop the caller filter from `servedReadsSince` (4 cases red, the operator-ceiling case among
them); let `messagesPage` answer an empty page for a closed store (red); drop the `offRecord` rule from `promptTargetVerdict` (4
red, re-measured in fix round 1; the note said 3); write `offRecord` in a second statement (the new column check red, the per-table check green, so the column check is the
mechanism); let the runner read the turn in operator mode (2 red).

By hand in stage 2, each red and reverted: the thread's height cap removed (the long-thread cases, 4 red, in the browser); a pane
turn drawn with a bubble's ground on the right (2 red, in the browser).

By hand for Task 4's Step 5 (stage 1b; each red, each reverted, on the local tip): K1 clear the box before the answer under
`onRecord` (3 red); K2 a new key on every retry (the double-send case red); K3 pane text drawn as an operator bubble (2 red); K4
refresh on `beat` (red); K5 poll while hidden (red); K6 the composer clears late without `onRecord` (the characterization, 3
red); K7 the timer reads with nothing waiting (5 red); K8 `stale-designation` keeps the key and term (red); K9 the toggle never
resets (red). `draftAfterSend` clearing on no answer is the set's W1 above.

## What would change for another harness

The chat records through the server and reads the record, mechanisms ccrc owns that any harness can use: the private store, the
read runner and its ledger, the continuity store's generations and the readiness word. Three things lean on one harness, Claude
Code, and each stays behind a reader that already exists:
- the live generation's transcript (`SessionStream` on the server, `buildChatItems` in the console): its file layout and event
  kinds are Claude Code's;
- what a pane turn is (the mail lane's nudge line typed into that transcript, and `INJECTED_PROMPTS`' other lines);
- an earlier generation's text, read through the history door (`ccrc history`'s store, which today's sweep fills from Claude
  Code's transcripts).
Two facts the chat draws come from the session hook, a Claude Code hook today: each divider's time and each generation's
conversation id come from the session hook's start report, and the picked-up tick is written by the session hook. Another
harness needs its own arms for both, beside its readers (review F13).
Another harness changes those readers (its transcript reader, its injected lines, what the sweep ingests) and those two arms; the
chat's doors, deciders and part do not change, and `chatWords.ts` keeps its rule that no transcript user turn is ever the
operator's words.

## The first CI runs on the tip (red), and the fixes

The fast run and the dispatched full run on `bcd3d9068047` were red in five server files, all this branch's own; the browser shards
and every pwa leg were green (the chat's browser file, 36 cases, and the place's, 128). These are tests I had not run locally:
- `mail-routes` (the coordination kebab census): the chat's literals were undeclared. They are now admitted through guards
  derived from their maps: `isChatKebab` (`coord/overlordChat.ts`: an earlier page's refusal reasons and a thread entry's kinds)
  inside `isChatDoorKebab` (`coord/overlordChatDoor.ts`: the doors' two ledger outcomes), plus the read ledger's own guards
  `isReadDoor` and `isGenerationRead` (`chat-history`, `not-a-session`).
- `overlord-sequence-route` and `typecheck-tests`: the sequence route's rig still passed two arguments to the ceiling counter,
  which takes the caller as its third since this branch (the `servedReadsSince` row of the table above).
- `private-names-store`: it pinned the private store at schema 2; migration 3 (the chat's `offRecord`) makes it 3, and its
  schema-1 case now drops that column too.
- `mutation-floors`, the send answer's set: the thread answer's reader repeated the send's refusal lines, so two mutants' old text
  occurred twice. Both readers now read a refusal through one helper (`refusalOf`, `shared/overlordChat.ts`), and S4 mutates it.

## Fix round 1 (review 4070, the coordinator's call 1737)

Thirteen findings survived, none critical; eleven were built here. The diff adds 25 cases; 19 is the red-first count (19 new cases, every one red
before the code: 10 in the words suite, 8 in the part's, 1 in the composer's; then green), and two are known limits below.

| Finding | What changed | Where |
|---|---|---|
| F1, the pick-up poll had no end | The timer reads only for a message still waiting for its pick-up, in a state this console can read, and younger than ten minutes; every 10 s in its first minute, then every 30 s; the youngest decides. The stream's triggers still read | `chatWords.ts#pickUpReadEvery`, `PICK_UP_WAIT_MS`, `PICK_UP_READ_LATER_MS`; the hook |
| F2, older messages were silent | One line, "Older messages are in the record; this shows the newest 100.", when the door answers `more`; the page's bound moved to `shared/overlordChat.ts#CHAT_PAGE_ROWS` (the door re-exports it), so the line and the door name one number. No paging control: the client's `before` and its control are PR B's | `chatWords.ts#OLDER_MESSAGES_WORDS`, the part |
| F3, the replay notice | A replay answers the first record's fact; when that differs from the toggle now, the notice says the first record stands, and which way. The toggle is not in the key | `chatWords.ts#sendNotice` |
| F4, the toggle reset under an edited draft | The toggle resets only when the composer really cleared the box: the composer's record mode gains `onRecordCleared`, called after it clears, never on keep, a throw or an edited draft (chosen over holding the toggle during a send, because the clear is the composer's own decision and the toggle should follow the box, not the answer) | `pwa/src/session/Composer.tsx`, the part |
| F5, the at-once read waited out the timer | An ask that must read sooner replaces a pending later timer, so a moved designation's re-read runs at once, and a trigger past a slower pick-up timer runs at the coalescer's spacing | the hook's `ask` |
| F7, the first read's words | Before any thread was read, a failure says "the conversation could not be read yet", never "as last read" | `chatWords.ts#threadTroubleWords` |
| F10, decisions in the hook | What an earlier page answer becomes and what "Show earlier" asks next (`earlierPageOf`), and the no-Overlord sentence (`NOBODY_TO_SEND_WORDS`), moved to the words module; the hook's header names every decider | `chatWords.ts`, the hook |
| F11, the refresh's deciders | Direct cases for `chatReadTrigger`, `nextReadAt` and `pickUpReadEvery`, and the three registered as mutant sets (the floors pair was unclaimed): RT1-RT3, N1-N3, P1-P6, each killed, each floor 1 | the words suite, `sim/chatSets.ts`, the floors file |
| F9, the GET mask | The thread door's suite plants a secret the masker knows in a message, through a server holding that masker, and the answer leaves masked while the store holds it raw; the earlier door's suite pins both routes in `MASKED_GET_ROUTES` and masks a paged body built by the door's own composer (W1's arm refuses before any text) | both door suites |
| F8, part | The plan's door mutations on the live arms, by hand, below; one case pins `CHAT_EARLIER_PAGEABLE` false, with the comment that whoever turns it on builds the paged route cases through the fleet fake first | the earlier door's suite |
| F12, F13, prose | The shared operator-messages header; this note's pre-merge counts, its registration line, the re-measured row above, the place file's lines; the two comments that said the client comes in the second stage; the harness section's two sentences | here, the hook, the part, `shared/operatorMessages.ts` |

THE BOUND, F1: ten minutes. The mail lane types the nudge when the Overlord's turn ends, and a long turn runs some minutes, so
the timer covers that quiet gap; past it, a message that never reaches its pick-up (a retire, a rebind, a nudge that never lands)
stops costing reads, about 24 timer reads at most for such a message. A pick-up typed later still shows, at that turn's end,
because its typing and the turn's end each ask through the stream's allow-list.

Door mutations by hand (F8, F9), each red, each reverted, on the fix round's tree, each suite alone:
- D1 the thread door skips the account gate: its suite 1 red of 17;
- D2 the earlier door skips the account gate: its suite 1 red of 17;
- D3 readiness read as ready when its read fails: the thread door's suite 1 red;
- D4 the ledger line written before the ceiling: the thread door's suite 7 red;
- D5 a lane function calls the words reader: the message-readers census 1 red of 10;
- D6 no line on a composed refusal (the arm a W1 earlier answer takes): the earlier door's suite 7 red;
- D7 the thread dropped from `MASKED_GET_ROUTES`: the thread door's suite 1 red (the new mask case).

## Fix round 2 (review 4084, the coordinator's call 1767)

Round 1 held; five items survived, none critical. Three cases were added: one red first (the toggle under a send in flight), two
pins of behaviour round 1 already had, each proven by a mutant that reds it.

| Item | What changed | Where |
|---|---|---|
| F2, the toggle under a send in flight (the privacy direction) | The toggle is HELD while a send is on its way: disabled, and described to a screen reader by `TOGGLE_HELD_WORDS`, "Held while the message is sent.". Chosen over resetting on a clear only when the toggle still holds the value the send carried, because that compare cannot tell a press made twice during the wait (off, then on again for the next message) from no press, and would reset it to on the record. Red first: the part's case pressing the toggle in flight | the part, `chatWords.ts#TOGGLE_HELD_WORDS` |
| F1, a trigger past a slower pick-up timer | One part case: a message past its first minute sets the 30 s timer, a user turn 3 s after the read is read at 10 s, then the 30 s timer again | the part's suite |
| F3, a stamp in the future | A words case and a sim case: a message stamped after the console's now is young (every 10 s), never skipped; mutant P7 registered; the clock limit below | the words suite, `sim/chatSets.ts` |
| F5, prose | The hook's, the part's and the words module's headers say the hook and the part keep the timer's bookkeeping, the view's state and a few guards, never policy; the 19 is the red-first count of round 1's 25 cases; the stage 1b table row naming `awaitsPickUp` is marked a snapshot; the slugs `chat-pick-up-wait-ten-minutes` and `chat-toggle-follows-the-box` under Departures | here, the three headers |

Mutants, each red, each reverted, the part's suite alone (31 cases):
- K-R1 a sooner ask never replaces a pending timer (`return;` for the comparison): 2 red, the F5 case and the new case;
- K-R2 the comparison off by the slow spacing (`at > timerAt - 25_000`): 2 red, the same two;
- K-R3 only an at-once ask replaces a timer (`at >= timerAt || at > now`, the shape the reviewer's mutant took): 1 red, the new case
  alone, which no case caught before this round;
- K-T1 the toggle not held in flight (`disabled={!designated}`): 1 red, the new toggle case;
- P7 a stamp in the future skipped (`age >= PICK_UP_WAIT_MS || age < 0`), registered in `sim/chatSets.ts` under
  `pickUpReadEvery`'s set: killed; the chat words sets 7 of 7 with every mutant killed.

## Known limits (so far)

- `chat-thread-shows-the-newest-100` (F2): the thread holds the newest 100 messages; when older ones exist one line says so, and
  the console cannot page to them in this PR. The client's `before` argument and its control are PR B's (the coordinator's
  ticket).
- `chat-server-line-needs-the-readiness-history` (F6): a message older than the readiness store's ninety-day prune can draw no
  server line, because the history that would say the Overlord's state at its time is gone.
- `chat-earlier-paged-arm-unbuilt` (F8's rest): the paged arm's route cases and its two door mutations (the target from the
  designated session; step 7's filter dropped) wait for the arm. Under the not-pageable arm every earlier-door answer is a
  refusal, so that door's ceiling never refuses and its lines are bounded only by the sign-in.

- `chat-pick-up-age-is-the-console-clock` (review 4084 F3): a message's age is the console's clock against the server's stamp,
  so the timer's read count holds while the two clocks roughly agree; a console far ahead of the server reads nothing on the
  timer for a new message, and one far behind reads for longer and still stops. Ageing against a server time is an additive wire
  field, the coordinator's ticket.
- `chat-at-once-read-waits-for-a-read-in-flight` (review 4084 F4): a read already in flight makes the at-once read wait for the
  next spacing, since the coalescer marks it to run again after that read rather than at once.
- `chat-first-read-failure-waits-for-a-trigger`: a first read that fails is retried only by the next trigger (a stream frame, a
  send, the tab shown again), not on a timer.
- `chat-part-mounted-mid-turn-misses-its-end`: a part mounted while the Overlord is already busy has no `busy` status before the
  turn's `idle`, so it can miss that turn's end as a trigger; the next trigger reads.
- Earlier generations are not paged in W1 (the measured arm); the divider names `ccrc history` instead. The part draws a
  `readable` divider's page and its "Show earlier" (the next page asks `around` the page's first item) for when paging joins.
- The gate counts were re-derived at this branch's merge of main 9e5f592c24, the board (#3463) on main (the coordinator, calls
  1687 and 1713), measured on the merged tree: 344 scanned, 341 HTTP, 222 gated, 119 exempt, the flag-aware count still
  forty-one, thirty-three route files. The merge's resolutions: the masked GET routes keep the board's line, then the chat's; the
  gate's docstring reads 341; the gate suite keeps the board's history comment, then the chat's, re-based on it (339 -> 341, 220
  -> 222, 119 exempt), and its three count lines; the read runner's header keeps the board's attribution sentence inside the two
  callers' paragraph; its suite imports both sides' types; the kebab census admits the board's guard, then the chat's and the read
  ledger's. The board's door suite's rig passes the ceiling counter's caller too (as the sequence route's does).
- The full server test-project type check is killed by the test slice's memory cap on this box; the changed test files are type
  checked in a narrowed project instead, and `typecheck-tests` in CI covers the whole.
