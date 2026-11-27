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
| The refresh's decisions: `chatReadTrigger` (the allow-list), `nextReadAt` (the spacing and a ceiling's wait), `awaitsPickUp` (the timer reads only then); the part's status words | `pwa/src/overlord/chatWords.ts` | L1 |
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
| Part 7 of the place: `ChatPart`, mounted below the capacity line, reusing the place's one session store (`useOverlordSessionStream`'s connect): the store's events are the live rows (`buildChatItems`), and a change of its transcript or status is handed to the refresh as the frame it came from, so no second stream and no new frame | `pwa/src/overlord/ChatPart.tsx` (new), `OverlordPlace.tsx` (2 lines) | L4 |
| The thread bounded at 70dvh, its own scroller | `pwa/src/overlord/overlordChat.css` | L4 |

Censuses moved, each re-derived on the merged tree: the gate census (both reads flag-aware, thirty-nine to forty-one; 343
scanned, 340 HTTP, 222 gated, 118 exempt) and `gate.ts`'s count; `OVERLORD_OPERATOR_DOORS` and the Overlord file's route count
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
- **`chat-visibility-through-the-page-clock`** (stage 1b): the hook hears the page turning visible through
  `lib/pageClock.ts#onPageVisible`, the one owner of that subscription (`pwa-one-owner`), and reads `document.visibilityState`
  itself before each read.

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
Another harness changes those readers (its transcript reader, its injected lines, what the sweep ingests); the chat's doors,
deciders and part do not change, and `chatWords.ts` keeps its rule that no transcript user turn is ever the operator's words.

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

## Known limits (so far)

- Earlier generations are not paged in W1 (the measured arm); the divider names `ccrc history` instead. The part draws a
  `readable` divider's page and its "Show earlier" (the next page asks `around` the page's first item) for when paging joins.
- The gate counts are re-derived once more at this branch's last merge, after the board (#3463) lands (the coordinator, call
  1687): expected 344 scanned, 341 HTTP, 222 gated, 119 exempt, the flag-aware count still forty-one.
- The full server test-project type check is killed by the test slice's memory cap on this box; the changed test files are type
  checked in a narrowed project instead, and `typecheck-tests` in CI covers the whole.
