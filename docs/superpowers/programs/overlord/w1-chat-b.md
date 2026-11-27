# Overlord W1, the chat, PR B: task note

Plan: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`, Task 5 (PR B), with its Global Constraints, Review Focus, the PR
split's row B and "Rollback and older builds". Spec: `docs/superpowers/specs/2026-11-09-overlord-design.md` §4 (Table 4a row 7),
§4.3 (C66, C67, C69), §9.4 rules 3, 4, 9 and 12. Chat A's note (`w1-chat-a.md`) and the Known limits of #3488 say how the thread,
its doors and the console part landed. Run 4148, wave 249. No deviation number was allocated: departures are by slug.

Each reply of the Overlord is recorded in the private store when its turn ends (operator item 327): the session hook's `reply`
report at a main-turn `Stop`, the report door's `reply` arm, `recordReply` and `overlord_replies`, the response row after the record
commits, and a boot arm for a row a crash left out. The chat draws the reply rows, pages older messages and replies, posts one
`opened` receipt for each recorded reply on view, and offers "I handled this elsewhere" on a reply with a response row.

## Step 0: the plan's names, read by their merged names

| The plan names | On main (07e8cc51e1) |
|---|---|
| `server/src/responses/responsesStore.ts#insertReplyResponse` | the response store is `server/src/coord/responsesStore.ts`; the insert is new there, beside `insertWaitingResponseInTx` |
| `ResponseRef` `{ kind: 'reply', id }` (responses A) | on main in `shared/responses.ts`, read by `rowByRef`; nothing wrote a `reply` row before this PR |
| `operator_responses_one_reply` | on main (`coord/schema.ts`, migration 82), a partial unique index on `refId` where `kind = 'reply'` |
| the receipts door (C67) and the handled door (C69) | on main: `POST /api/responses/receipts` and `POST /api/responses/:id/handled` (`server/src/responses/routes.ts`); the console's `useOpenedReceipt` and `HandledElsewhere` (`pwa/src/responses/`) |
| `responsesFor` ("a text-free reader beside it") | `responsesForRef` (item and digest only); the chat's `replyResponsesFor` is new beside it |
| the report door, `_hook_door_report`, `HOOK_REPORT_KIND_MAP` | on main: `POST /api/sessions/:id/report` (`server/src/continuity/routes.ts`), `ccd/session-hook.sh#_hook_door_report`, `shared/continuity-reports.ts` |
| the gate door process B1's arms use | `CCRC_DOOR_NONCE_SHA256` in the session's environment and no `$REG/<id>.child` |
| `turn_reply` in `ccd/lib/transcript.jq`, read like `start_loads` | built; the module's own `prompt`, `turn_row` and `jsws` are reused |
| the private store's next migration | 4 (private names B was 2, chat A's `offRecord` 3) |
| `nextReplyId`, `privacy-reply-issued` | not built: the coordinator's ruling (call 1888), below |
| `designationRead()`, `SecretMasker` | `CoordStore#designationRead`, `deps.masker` (absent: `SHAPE_ONLY_MASKER`) |
| `capMessageText` | `server/src/operatorModel/messages.ts#capMessageText`, the one cutter (16 KiB with the mark) |
| the boot pass's reply arm (`bootPass.ts`) | its own function, `server/src/operatorModel/replyBoot.ts#runReplyResponseBoot`, run from `index.ts` after the response stamp (slug `reply-boot-arm-runs-after-the-stamp`) |
| `chained-journal-formats.test.ts#FORMATS` gains the new kind | unchanged: no kind is added |
| `writers-map.test.ts` gains `overlord_replies: [recordReply]` | done, and `operator_responses` gains `insertReplyResponse` |
| `mutation-floors` gains `replyLinks`, `nextReplyId`, `hookReportOf`'s arm | `replyLinks`, `replyTargetVerdict`, `chatPageCut` are new sets; `hookReportOf`'s set gains R21 to R29; `nextReplyId` is `nextMessageId` (no new decider) |

**The Stop payload, measured** (the plan's Step 1): the pinned builds' `Stop` payload carries the turn's last assistant text as
`last_assistant_message`, a string (the captured payloads of builds 2.1.280 to 2.1.319 under `server/test/fixtures/delegation/` and
2.1.296 to 2.1.302 under `server/test/fixtures/approvals/captures/`; `hook-capture-reduce.test.ts`). It is the LAST message only, so
the hook reads the transcript: one turn may hold several text entries.

**Ruling 7, measured:** no route, door, gate row or count line is added. The report kind rides the existing report door and the
replies ride the existing thread door; `MASKED_GET_ROUTES`, the gate census, `OVERLORD_DOORS` and the box-token census are unchanged.
The gate's file gains one exported value, `NOT_THE_OVERLORD`, so the reply arm refuses with the gate's step 1 word without spelling
it a second time (`single-definition/core-vocab` holds the word to that file).

## What was built

| Piece | Where | Ring, context |
|---|---|---|
| The reply's wire row (`OverlordReplyRow`), its bounds (`REPLY_READ_MAX_BYTES` 4 MiB, `REPLY_REPORT_MAX_BYTES` 64 KiB, `REPLY_SPOOL_MAX` 8) and `replyLinks` | `shared/operatorMessages.ts` | L0, C11 |
| The report kind `reply` and its `HookReport` arm | `shared/continuity-reports.ts` | L0, K |
| `hookReportOf`'s `reply` arm (a lowercase uuid, an integer `turnAt`, a text of 1 to 64 KiB in UTF-8 bytes, a boolean, an optional positive count); a reply is never a hook report row | `server/src/continuity/hookReports.ts`, `hookReportStore.ts` | L1; L3, C3 |
| `replyTargetVerdict`: only the designated session at the current term records | `server/src/operatorModel/replies.ts` (new) | L1, C11 |
| `overlord_replies`, the private store's migration 4 | `server/src/operatorModel/schema.ts` | L1 data, C11 |
| `recordReply` (one row a turn, keyed by session and entry; replay; `entry-reused`; capped; the id from the one issued-id sequence; `replyLinks`), the readers `repliesPage`, `repliesSince`, `replyIdsSince`, and `HIGHEST_ISSUED_SQL` in both writers and the open | `server/src/operatorModel/store.ts` | L3, C11 |
| The report door's `reply` arm and its port `ReplyRecord`: the designation, the mask, the record, then the response row | `server/src/continuity/routes.ts` | L4, C3 |
| `insertReplyResponse`, `replyResponsesFor`, `repliesWithoutResponse`; `REPLY_WINDOW_MS` and the `reply` kind's words | `server/src/coord/responsesStore.ts`, `shared/responses.ts` | L3, C6; L0 |
| The boot arm of I8 for replies | `server/src/operatorModel/replyBoot.ts` (new), `server/src/index.ts` (4 lines) | L4, C11; L5 |
| The adapters: the reply port and the chat's response reader | `server/src/server.ts` (6 lines) | L5-side wiring |
| `NOT_THE_OVERLORD`, the gate's step 1 word as a value | `server/src/coord/overlordGate.ts` (3 lines, act catalogue A's yes) | L1, C5 |
| The thread's reply entry, `ReplyResponse`, the `replies` part, the `older` cursor, the query's `replyBefore` and `end`, `chatThreadPath`; an older server's thread read as one (replies `null`, older from `more`) | `shared/overlordChat.ts` | L0, C11 |
| `chatPageCut` and the page in `composeChat` (replies by time after a message at the same millisecond, the divider floor, the cursor) | `server/src/coord/overlordChat.ts` | L1, C5 |
| The door's facts (`repliesFact`, `responsesFact`, `pageByCursor`) and the line counting replies | `server/src/coord/overlordChatDoor.ts`, `overlordRoutes.ts` | L1; L4, C5 |
| `turn_reply`, `reply_cut`, `reply_report` | `ccd/lib/transcript.jq` | ccd library |
| The Stop arm and its spool `$REG/<id>.replyspool` (0600) | `ccd/session-hook.sh` | hook |
| The purge's post-lock `rm` names the spool | `ccd/ccd` (the census to 64) | ccd |
| The client's thread call takes the cursor | `pwa/src/lib/api.ts` (W2 settings' yes) | L3 |
| The console's words: `mergeLive` (a recorded reply takes its live row's place and the turn's live text rows go), `historyItemsToChat` the same, `foldNewestPage`, `foldOlderPage`, `visibleEntries`, `ceilingNotBefore` (ruling 8), the receipt and handled deciders | `pwa/src/overlord/chatWords.ts` | L1 |
| The reply row (text as data, the off-the-record and cut marks, "I handled this elsewhere" on a row only), the receipt queue (half visible for one second, the document visible, once per reply per page load, at most one request a second) | `pwa/src/overlord/ChatReply.tsx` (new) | L4 |
| The pages and "Show older" | `useOverlordChat.ts`, `OverlordChat.tsx`, `ChatPart.tsx`, `overlordChat.css` | L4 |

Tests: `operator-model-replies` (new), `ccd-transcript-turn-reply` (new), `continuity-report-route`, `continuity-hook-reports` (through
`sim/hookReportSets.ts`), `session-hook-door-reports`, `ccd-lifecycle-purge`, `overlord-chat-door`, `overlord-chat-compose`,
`overlord-chat-vocab`, `operator-message-readers` (the reply readers and table), `operator-model-store` and `private-names-store`
(schema 4), `single-definition/writers-map`, `single-definition/switches-history` (the purge line), `sim/replySets.ts` (new),
`sim/chatSets.ts`, `sim/mutation-floors.json`; in the console `overlord-chat-receipts` (new), `overlord-chat-words`,
`overlord-chat`, `overlord-chat-part` and `browser/overlord-chat.browser.test.ts` (an older page and the reply row with its control
at 360, 390, 1280 and 1920 px, both skins, both palettes).

Reuse: `pwa/src/responses/responseWords.ts` (`HANDLED_WORDS`) is reused. `useOpenedReceipt` posts once a mount on first render with
no dwell, no spacing and memory per mount, and `HandledElsewhere` reads the rows of an item or digest ref and marks them all, while a
reply carries its one row id; so the reply row keeps their body shapes and their swallow-and-never-retry rule, and says why in its
header (slug `reply-receipts-dwell-on-view`).

## Departures, by slug

- **`reply-ids-ride-the-one-id-sequence`** (the coordinator's ruling, call 1888): the plan had `recordReply` append a new journal
  kind, `privacy-reply-issued`, over a reply sequence of its own. The privacy journal's grammar is closed, so a server below this PR
  would read the whole journal as malformed and record no operator message until the journal was moved aside. Instead a reply takes
  its id from the ONE issued-id sequence, recorded with the journal's existing `privacy-message-issued` record: `HIGHEST_ISSUED_SQL`
  (the highest id over `operator_messages` and `overlord_replies`) is the store's highest in both writers' next id and in the open's
  coherence. No journal kind is added in this PR, so the chained kernel, the file adapter and the formats census are unchanged. Ids
  are not dense in either table (they were not before: a crash between an append and a commit leaves a gap); an id names exactly
  one row of the private store.
- **`reply-boot-arm-runs-after-the-stamp`**: the boot pass runs before this boot's response epoch is recorded, and a row stamped
  before it would read `unmeasured`; so the reply arm of I8 is its own function, run from `index.ts` beside `deps.responseStamp`.
- **`reply-arm-refuses-with-the-gate-word`**: the reply arm's `not-the-overlord` is the gate's step 1 word, imported as a value
  from `coord/overlordGate.ts` (`NOT_THE_OVERLORD`), never spelled again.
- **`reply-store-refusal-words`**: the plan said a store refusal answers 502 with the store's word; the words are `RouteRefusal`s
  with their own statuses: `write-failed`, `journal-unreadable` and `journal-unwritable` 503, `not-open` 409, and `refused` (the same
  entry with other text, `entry-reused`) 409 `conflict`. The detail never names the text.
- **`reply-spool-drops-refused-for-good`**: a spooled body answered 403, 400, 409 or another 4xx but 401, 404, 408 and 429 is
  refused for good and dropped, as the loads report's sender drops one; only 200 removes a body otherwise.
- **`dropped-count-rides-the-spool-head`**: past `REPLY_SPOOL_MAX` the oldest body is dropped and its count, with any count it
  carried, moves to the body that now stands oldest, so the count lives in the one spool file and is never lost.
- **`api-error-rows-are-not-the-reply`**: an assistant row with `isApiErrorMessage: true` is Claude Code's error notice, not the
  Overlord's words: its text is left out and it never keys the reply.
- **`chat-pages-both-lists-by-one-floor`** (ruling 4): the thread pages messages and replies with one cursor each (`before`,
  `replyBefore`, each a positive id or `end`), and `chatPageCut` cuts both at one time floor (the later of the two lists' oldest
  times among the lists that say `more`), so a page never shows one list's older rows without the other's.
- **`chat-older-needs-both-lists`**: a page whose messages or replies could not be read offers no older page, because the floor
  cannot be placed.
- **`reply-takes-its-turns-live-text`** (ruling 5): a recorded reply whose entry is on screen from the live transcript takes that
  row's place, and the live assistant text rows of the same turn go too, because the reply's text is every text block of the turn;
  the turn's tool rows, dividers and user turns stay.
- **`reply-receipts-dwell-on-view`**: the reply row posts its own receipts (half visible for one second, the document visible, once
  per reply per page load, at most one request a second) rather than through `useOpenedReceipt`, which posts once a mount on render.
- **`ceiling-wait-bounded-at-the-window`** (ruling 8): `ceilingNotBefore` caps a ceiling's retry wait at one hour, the read
  ceiling's own window (`READ_CEILING_WINDOW_MS`), and waits 60 s when the refusal carries no retry time.
- **`chat-line-counts-replies`**: the thread's ledger line counts the replies it hands too, and a thread whose messages could not be
  read is still a served line when it hands a reply's words.

## Mutation rows

| Decider | Mutants | Killed |
|---|---|---|
| `shared/operatorMessages.ts#replyLinks` (new) | L1 offRecord ignored, L2 the oldest id answered, L3 the last message decides offRecord | 3/3 |
| `server/src/operatorModel/replies.ts#replyTargetVerdict` (new) | V1 any session records, V2 unmeasured records | 2/2 |
| `server/src/coord/overlordChat.ts#chatPageCut` (new) | P1 the floor ignored, P2 the earlier time, P3 rows left out not counted as more, P4 the next cursor from the newest kept row, P5 a list with none kept skips its rows, P6 an older page with a list unreadable, P7 a row at the floor dropped | 7/7 |
| `server/src/coord/overlordChat.ts#composeChat` (existing set, 7 before) | C8 unreadable replies read as an empty page, C9 unreadable response rows read as no row, C10 the divider floor ignored, C11 a reply before a message at the same millisecond | 11/11 |
| `shared/overlordChat.ts#readChatThread` (existing set, 5 before) | R6 absent replies read as an empty part, R7 an unknown response kind reads no-row, R8 an older server's older page dropped | 8/8 |
| `server/src/continuity/hookReports.ts#hookReportOf` (existing set, 20 before) | R21 entryUuid, R22 turnAt, R23 text, R24 the length bound dropped, R25 the bound in characters, R26 an empty text, R27 truncated, R28 droppedBefore, R29 the uuid in any case | 29/29 |

By hand (each red, each reverted, each suite alone):
- M1 the reply arm's designation check dropped: the route suite 2 red (not the designated session; an unreadable designation);
- M2 the egress mask skipped: 1 red (the masked text);
- M3 `recordReply`'s key lookup skipped: the replies suite 1 red and the route suite 2 red (the replay, the log case);
- M4 the reply id issued without the journal: 6 red, the restore case among them;
- M5 the store's highest read from the messages alone: 2 red (a journal below a reply's id; a missing journal beside replies);
- M6 the boot arm's insert skipped: 1 red (the crash-between case);
- M7 the reply's text in the arm's log line: 1 red (no line names the text);
- M8 the journal grammar gains a kind: 1 red (the characterization of main's grammar).

The console's rows (the PWA's words sets in `sim/chatSets.ts`, each killed): `mergeLive` gains M5 to M12 (a recorded reply drawn
beside its live row, the turn's earlier text drawn beside it, the turn start ignored, the tool row dropped, among them),
`historyItemsToChat` H3 and H4, and `ceilingNotBefore` (new) CB1 to CB4 (the bound dropped; the missing-time default dropped). By hand
in the console, each red and reverted: a receipt posted on render (8 red); the posted set forgotten (the same reply twice posts
one); no spacing between requests (2 red); the hidden-document guard removed at both places (red; at one place alone the other
covers it); the retry bound dropped (2 red); the missing-time default dropped (3 red). By hand in the hook (the subagent's runs):
`turn_reply` reading thinking blocks (3 red), taking the previous turn's text (2 red), no spool on a failed send (11 red), the gate
moved after the read (1 red), a 4xx for good kept (2 red), `umask 077` removed (2 red), error rows read as text (2 red).

## The hook's measured cost

Median of five runs at a main `Stop`, load 8 to 11, the script in the run's temp root:

| Case | Median |
|---|---|
| A session with no door, a 4 MiB transcript | 22 ms, the hook's own baseline: the gate is builtins only and asked before any read, so no process is added |
| A door, no reply in the tail | 28 ms |
| A door, a 4 MiB transcript whose last turn is at its end, sent | 76 ms, about 54 ms added |
| A door, one turn spanning the whole 4 MiB, the text cut to 64 KiB | 69 ms |

A slow or dead door costs at most `REPORT_TIMEOUT_S` (3 s), one deadline over the read, the jq, every resend and the send, and a send
that runs out its bound stops every later send of the invocation; the arm prints nothing and never changes how a `Stop` ends.

## Known limits

- `reply-lost-past-the-arm-deadline`: a turn whose newest prompt is a pasted text of about 3.5 MB takes about 5.4 s in jq (the
  module's `prompttext` explodes the whole string), past the 3 s deadline, so that turn's reply is never built and never spooled.
  Changing `prompt` would change the continuation reader that shares it, so it is left.
- `reply-read-at-stop-assumes-the-flush`: the arm reads the transcript at `Stop` and assumes the last assistant row is written; if
  Claude Code ever fires `Stop` before that flush, the key would be the turn's previous entry. Not measured.
- `reply-spool-has-no-lock`: two overlapping main `Stop`s of one session could lose an append; a turn lies between two `Stop`s, and
  the store's key makes a resent body a replay.
- A line that needs `unsurrogate` mangles its surrogate escapes, valid pairs on that line included (rare; noted in the module).
- jq 1.6 is untested on this box (only 1.8.1); the module keeps the 1.6 rules its header lists.
- `chat-older-needs-both-lists`: while either list cannot be read, no older page is offered.
- An older page's `read-ceiling` refusal does not set the refresh's not-before; only a later refresh of the newest page feels it.
- The scroll anchor that keeps the reader's place when an older page lands above is not asserted in jsdom or the browser suite.
- The paging and receipt deciders have unit cases, not mutant sets.
- `repliesSince` has no caller yet: the checkpoint's thread (C37) reads it when that piece ships.
- In `session-hook.test.ts` two "real tmux, private socket" cases failed in this box's runs, the same with the reply arm switched off.

## Older builds

- **A server below this PR** (a rollback): the hook's `reply` report is refused `bad-request` (`kind`), a 400, so the body is dropped,
  never spooled. The private store's file stays at schema 4: the shared opener reads a higher `user_version` and never migrates it,
  and the older build's statements name their columns, so `overlord_replies` is left as it stands. Its privacy journal holds only
  `privacy-message-issued` and `privacy-anchor` records, so the older server reads it coherent and keeps recording operator messages;
  its own store's highest is the messages' alone, below the journal's, which is the "journal ahead of the store" case main already
  reads as coherent, and the next message id starts above the journal's highest. No id is reused. Reply response rows stay in
  `coord.db` and seal as any other row with no owner.
- **An older hook** with a current server: no `reply` report is sent, so no reply is recorded; the chat shows the replies part read
  and empty, and the live transcript as before.
- **An older PWA** with a current server: a thread entry of kind `reply` is skipped and counted, never a refusal, and `older` is an
  unknown key it ignores: it shows the messages as chat A does.
- **A newer PWA with a server below PR B**: `replies` is absent and reads `null`, one quiet line; `older` is derived from the messages'
  `more`, so "Show older" pages the messages alone.
- **What a later piece must know** (the coordinator's ruling): a NEW privacy journal kind is a rollback break, because the grammar is
  closed; it needs its own design.

## What would change for another harness

The record, the door and the chat are the product's: everything behind the report door reads the body alone, and the body names
nothing of Claude Code. Two parts know one harness's files, the transcript definition (`turn_reply` over Claude Code's JSONL) and the
`Stop` arm; another harness's adapter sends the same report from its own turn end. Where that does not hold:
- `entryUuid` must be a lowercase uuid (`hookReportOf`), which is Claude Code's entry key: a harness without one mints a stable uuid
  per turn;
- the console's merge matches `entryUuid` against Claude Code's live transcript rows (`buildChatItems`), so another harness's live
  view needs its own key there, as chat A's note says of the live generation;
- `turnAt` is the hook's clock, as every hook report's `at` is.
