# Wave 175: the chat screen loads older turns, and the turn being read does not move

Task note for desktop-polish wave 175 (run 3690): goals modification 98, second half, the half a person sees. The server
half merged as #3284 (wave 171, `chat-paging.md`). Each claim is labelled **measured** (this worker's own run) or
**inferred** (read from the code).

## 1. In short

- **The store keeps the backlog's continuation** and asks for one older page at a time. A page's rows go before the rows
  held, oldest first, each event once (§3). A new backlog on the same socket voids a request outstanding and paging
  starts again from that backlog's continuation; a socket that drops gives its request up and keeps the continuation.
- **Every answer names the request it answers** (`for`, the coordinator's ruling on this wave's wire question, §2). The
  client applies an answer only when `for` equals the continuation of its request outstanding. An answer with no echo
  (the wave 171 server) is decided by the fallback rule.
- **The reader's row keeps its place across a prepend**, by its key, not by counting rows (§4): measured within 0.5px
  over 32 prepends in Chrome, phone and desk, both skins, both palettes.
- **The top of the chat** says one thing per end (§5), and offers Load older, which works by keyboard, is the retry, and
  is there when the list is too short to scroll. No continuation (an older server, a stream that cannot page) shows
  nothing: today's view exactly.
- **One owner of "stay at the foot"** (carried item 6a, the coordinator's ruling A, §6): the virtual list's own follow is
  off, and the chat list keeps a reader at the foot itself. A person sees one difference: an append at the foot is
  followed at once, not by a smooth scroll.
- **No cap on rows held** (§7): 20,000 rows cost 5.7 MiB of heap and a live append is drawn in about 40ms. Pinned with
  room.

## 2. The wire: one field, two send sites (the only server change)

**Why.** An answer named no request. On a reconnect that is enough (the old socket's frames are dropped by the client's
socket guard). It is not enough for a backlog sent on the same open socket (a re-point, a registry move, a shrink): a
request still on the wire when the server sent the backlog is read after it and answered against the new file (case B;
inferred from `sessionws.ts#olderPage` and `olderPageGate.ts`, whose gate checks only the path tag, the identity tag and
the in-flight flag). Same file and identity: a page that may not join the new backlog, shown as contiguous; another
file: `changed`, wrongly saying older messages cannot be loaded. No client-only rule is both safe and live.

**The change** (the coordinator widened the wave for this and nothing else on the server):

- `shared/olderPage.ts`: `OlderPageAnswer.for?: string`, defined once, with one reader (`olderPages.ts#answerPaging`).
  No line in `shared/api.ts`.
- `server/src/transcript/continuation.ts`: `continuationShaped`, the first two checks `open` makes (length and grammar),
  now the one place both are written; `open` calls it.
- `server/src/sessionws.ts#olderPage`: the two send sites spread `{ for: continuation }` when the value is
  continuation-shaped. An over-long or malformed value is never reflected. The gate's order, words and checks are
  unchanged.
- The reply frame's bound moves from the byte cap + 2048 + 128 to the byte cap + 2 × 2048 + 128 (the next continuation
  and the echo). The paging note's §6 carries one line for this.

**The client** (`olderPages.ts#answerPaging`): with `for`, apply exactly when it equals `asked`; drop everything else.
Without `for`: the first answer that is not `busy` after a void is dropped and a request outstanding then is given up
and offered again; an answer that arrives with no request outstanding is dropped; `busy` applies nothing and drops
nothing. Cases A and B pinned on both paths (`older-pages.test.ts`).

## 3. Each row once

**What the parser gives** (`parseTranscriptLine`): every event of a record carries the record's `uuid` and `ts`; a
`tool_result` carries only its call's `toolId`. So a uuid names a record and a toolId a call. The merge used before keyed
on the uuid (a result on its toolId), so a record's second event arriving with its first was dropped: measured, 3 of
72,842 records on this box's transcripts are assistant prose plus a call in one record.

**The identity** (`session/eventIdentity.ts`): kind, source id, time and every field the event shows (a 53-bit hash and
the length of the content), as a JSON array. **Multiplicity, not presence**: an incoming event is a copy only while the
rows held carry its identity as often as the frame has carried it so far, so a record's two equal blocks are two rows. A
frame never splits a record, so a record's blocks are always counted together. One rule for a live `events` frame and a
page (`freshOf`).

**Pinned** (`event-identity.test.ts`): the same event from the live stream and a page once; two events with equal text
both; two blocks of one record both, also when equal; separate records sharing a uuid or a toolId (the empty one too)
both. **The one limit:** two separate records equal in every field the parser gives are one identity across frames
(two within one frame).

**Row keys** (`session/rowKeys.ts`, called by `chatItems.ts`): a key repeated in the item list (two message rows of one
record) gets `~<n>`, counted from the newest end, so a prepend never renames a row already shown.

## 4. The reader's place

**Two writers that never write in the same frame.** Rows put before the first lower virtuoso's `firstItemIndex` in the
render that hands them over, by how far a row the reader can see moved (`footFollow.ts#prependShift`, by key: at the join
a divider can go and a stretch can take the page's calls, so the count of rows added is not how far the rows below moved).
Virtuoso then moves the scroller itself, from its size estimates, over a few frames, and lands rows away from where they
were: **measured 451px** after a page of thirty records at 390px. So while it moves (`adjusting`) the hold reads and
writes nothing and the near-top load waits; once the scroller has been quiet for two frames, `settlePrepend` decides
through `heightMove` (with the place the reader had before the rows came) and makes one write by key. A reader at the
foot is taken back to it; a reader who moved meanwhile (a wheel, a touch, a pointer press or a key since the page came)
is left where they moved.

**The anchor is a row and the rows under it** (eight, in order): when the join replaces the row crossing the top (the
first time divider goes, a stretch takes the page's calls), the first of the others still drawn is held.

**A stretch that takes an older page's calls** changes its key (`activity-<first entry's key>`) but keeps its open or
closed state, the rule a stretch has as it grows (`keepOpenAcross`, read off the two lists, not the key's spelling).

**Older rows are display only.** The store's `older-page` arm touches only the rows and the paging. The tool-activity fold
takes `liveFrom`, the first item drawn from a live row (`olderPages.ts#liveFromOf`): nothing before it runs, waits or
holds a live control, so an older unanswered question asking the live question's words never takes its place, and an
older call without a result never reads as running. A stretch that spans the boundary is current by its newest entry,
and runs only by its entries from the turn's start, by each entry's own item index.

**Loading as the reader nears the top:** only from `more`, never a retry on its own; only for a reader who left the foot;
within 1.5 screens of the top; and asked again after a page lands while the reader is still there. Pressing the control
unpins the reader (they asked for the top), so the hold keeps the row they were reading as the page lands.

**Carried from the tool-stretch reviews** (item 6):

| Item | Done |
|---|---|
| 6a, a tap 40-94ms after an arriving call followed to the foot | Fixed by the coordinator's ruling A (§6). Measured before: Instrument 6 of 10 taps at 390 and 7 of 10 at 1280 thrown 1283-1323px up, Refined 0 of 20; after: 0 of 40. Pinned in Chrome (`chat-foot.browser.test.ts`). |
| 6b, a smooth scroll starting in the frame between a change and the compare | Fixed: the compare also counts the scroller standing elsewhere than at the change with no event yet. Pinned in jsdom, red with that check cut. |
| 6c, the own-scroll exclusion's position check untested | Pinned: a reader who moves the scroller between the hold's write and its event is the list moving. Red with the check cut. |
| 6d, the rounded-position words unguarded | Pinned: a scroller that rounds writes to whole pixels, six changes, the reader within 0.75px of their place. Red when the own-write event re-reads the baseline. |
| 6e, "every scroll" meaning every scroll but the hold's own | The comment now says so. |

## 5. The words at the top of the chat

| State | Sentence | Control |
|---|---|---|
| `more` | none | Load older messages |
| `loading` | none (announced once) | Loading older messages… (the same button, `aria-disabled`, keeps focus) |
| `start` | This is the oldest message available here. | none (the sentence takes focus if the button had it) |
| `busy` | Another page of older messages was still loading. | Try again |
| `changed` | Older messages cannot be loaded now: the transcript changed. | none |
| `absent` | Older messages cannot be loaded now: the transcript is no longer there. | none |
| `unreadable` | Older messages cannot be loaded now: the transcript could not be read. | Try again |
| `unmeasured` | Older messages cannot be loaded now: the transcript could not be measured. | Try again |
| gap | One or more records here were too long to load and are left out. | a dashed rule, at the gap's place |
| `none`, and `invalid` or `expired` | nothing: no control, today's view (a continuation the server no longer accepts is dropped quietly, and the next backlog brings one) | |

"Available here" never claims the session began there: a context reset, a swap or retention can each leave earlier
messages outside this transcript. **The gap's place:** a page that skips a record answers no events (both of the
server's gap arms, inferred from `olderPage.ts` and `olderRange.ts`), and the skipped record is the one nearest the
boundary, so the marker sits between the page and the rows held; two gaps with nothing between are one marker.

The words and both components live in the design system (`ui/src/components/older-edge.tsx`), with a story per state and
for the gap (`older-edge.stories.tsx`).

## 6. One owner of "stay at the foot" (item 6a, ruling A)

**Cause** (read in virtuoso 4.18.20's source): every render republishes every prop, and the item count stream emits on
each publish even when the count is unchanged; a render with an unchanged count arms a 100ms window in which any size
increase that leaves the foot makes the library scroll to the end itself, without consulting the follow callback.

**Now:** `followOutput={false}`. Where the foot stood starts unmeasured: until the list has measured it (an at-the-foot
report, a height report or a scroll that finds the reader at the foot), and with no scroller to measure, the reader
leaving is virtuoso's word, as before. The chat list keeps a reader at the foot in two places that call one writer (`toFoot`):
`heightMove`'s `foot` (a change while the reader was at the foot, measured against the list before it), and
`footFollow.ts#footLeft`, when virtuoso says the reader left the foot: the foot left the reader unless they moved the
scroller up from where the foot last stood or tapped a disclosure, so growth below them and a view that shrinks (a phone
keyboard) take them back. **A person sees one difference:** an append at the foot is followed at once, not by a smooth
scroll.

**Where the foot stood** is written by virtuoso's at-the-foot report and by a scroll event that lands within the pill's
band of the foot, never by one above it. This list's scroll listener runs before virtuoso reports the reader left, so
writing it on every scroll moved it to where the reader went: measured, a reader scrolled up was then taken back to the
foot by a view shrink (Refined, 301px). Written only at the report, it went stale while rows measured under a reader at
the foot, and an append then left them 67-91px above it. Both measured red in Chrome before the rule above.

**What the follow did, proved in Chrome** (`chat-foot.browser.test.ts`, phosphor, both skins, 390 and 1280, unless named):

| The ruling's case | Result |
|---|---|
| At the foot: a row appended; the last row growing in ten 12px steps; a picture in the last rows loading 400ms late; a tool stretch at the foot gaining a call | At the foot after each, no pill |
| Scrolled up: the same four | The row in view within 1px, the pill still up |
| The view shrinking by 300px and growing back, at the foot and scrolled up | At the foot both times; the row in view within 1px both times |
| A window resize (60px narrower) and a new backlog on the same stream, at the foot | At the foot |
| A skin change through the palette's Switch layout, at the foot | At the foot (desk widths: the palette opens by key there) |
| Opening a session | At the foot |
| Jump to latest | As today: its own smooth scroll, ending 3px above the very end (measured the same with virtuoso's follow on), inside the pill's band, the pill gone; an append after it lands at the foot |
| A page prepended at the foot or scrolled up | `chat-history.browser.test.ts`: live rows during a page load at the foot (stays) and scrolled up (the row kept); the repeated prepends (the row within 0.5px) |
| The 40-tap probe | 0 of 40 thrown; red with virtuoso's follow on (Instrument 5 of 10 at 390 and 5 of 10 at 1280 in that run) |

**Measured on main's follow for comparison** (this file run with virtuoso's follow restored): besides the taps and Jump
to latest's 3px, opening the session and a window resize at Instrument 390 left the reader 698px and 746px above the
foot in that run (the column's settling, under load); both pass with this wave's follow.

## 7. Memory: no cap

Measured in Chrome (`chat-history.browser.test.ts`), the whole transcript held, against a 30-event view:

| Events held | Heap | Frame to newest row drawn | One live append drawn |
|---|---|---|---|
| 5,010 | +1.6 MiB | 81 ms | 44 ms (11 ms over 30) |
| 20,010 | +5.7 MiB | 185 ms | 42 ms (16 ms over 30) |

The rows are virtualised, so the list draws a screen and overscan whatever is held; the cost is the store's arrays and the
per-render passes over them. A cap would release rows from the top, where a reader paging back is reading. **The rule:
none.** Pinned with room: the heap the held rows cost stays under 4 MiB per thousand rows.

## 8. Measured

- **The reader's row per prepend** (Chrome, 8 views: both skins, both palettes, 390 and 1280, four prepends each, joins
  inside a tool stretch, on a picture row and across a time divider): max 0.50px, mean 0.31px.
- **Request answered to rows painted:** median 28ms, max 44ms (the page's newest row attached).
- **Pages to the start:** 39 pages to the start of a 1,200-event synthetic transcript, 30 events a page, every message row
  once and in order, the start's sentence drawn (Refined, both palettes, 390).
- **Live rows during a page load**, at the foot (stays at the foot, no pill) and scrolled up (the row kept), all four
  phosphor views. **A rotation** with a request in flight: the late answer never applied. **Keyboard only:** Tab reaches
  Load older, Enter loads, the start's sentence takes focus. **An older server:** no control, no request.
- **Deletion mutants**, each run against its named suites through the test slice, the source restored and hash-checked:
  28 in the client and the server, all killed. Three first survived: the own-write position check (its case let the
  row's growth cancel the reader's move; the numbers now differ) and unique row keys (no case; one added) were killed once
  their cases were fixed, and the near-top load during a settle is killed by the Chrome anchor case (a 1.5px shift).
- **The first full run after the implementation was complete was red** (the wave-done's `suite: red`): `contrast` (the
  two new text rules had no registered ground), `chat-scroll`, `chat-scroller`, `jump-latest` and `tool-activity` (their
  stand-in lists report the reader leaving the foot with no scroller, or one that never moved, which the new foot rule
  read as growth), and `single-definition/vocabularies` (the edge type spelled the read failure pair). Fixed: the grounds
  registered; an unmeasured leave of the foot is the reader's (no scroller, or no foot measured yet), and the case whose
  scroller stayed at the foot moves it up (peer leave); the edge types derive from the wire's end words.
- **After the fixes:** pwa, all 604 files in four parts, 18,695 passed and 2 skipped (151, 154, 153 and 146 files); the whole browser suite, 120 files, 4,320 passed, 52
  skipped, 1 expected to fail, and 2 timed out under load (`archive-unowned`, `testbox-manage`), both green alone (120 of
  120); the server's paging and stream suites with the whole-tree guards, 147 files: green but for load timeouts in
  `retire-executors-pin` (green alone) and one case of `deviation-refs` (two git trees read in 20s; red alone at load 3.9
  too, a timeout, never a collision), and `typecheck-tests` (no `agent` packages installed in this worktree; the server's
  tests-inclusive project compiles clean run directly). Compilers: pwa (with ui), ui, and the server's test project
  clean.

## 9. Limits

- Two separate records equal in every field the parser gives are one identity across frames (§3).
- A repeated row key is counted from the newest end, so a page that brings an older record sharing a later row's uuid
  renames that later row (`~1`). Measured none in 72,842 records here.
- Older rows display only: an older call without a result is drawn settled even if it is still running.
- No echo (the wave 171 server): after a void, the first answer is dropped whichever request it answers, so case A costs
  one extra round trip.
- The list reads an index below virtuoso's first index as a data index (`rowAt`): no virtuoso sends one, and the suites'
  stand-in lists count rows from 0. Done so the nineteen jsdom stand-ins need no edit.
- The screen subscribes to `older` with one more selector, one more of the route-keyed store's CodeQL notes.

## 10. Peer hunks, by leave

- `chatItems.ts`, `toolActivity.ts`, `ui/src/index.ts` (claim 6989, wave 176): each PR carries its own hunks; whoever
  lands second moves `liveFromOf` after wave 176's `foldMailRows`, on the list the fold receives, and gives its two new
  kinds their sources (a run of mail prompts is live when any of its prompts is).
- `SessionScreen.tsx` (claim 6923, wave 173): three hunks, the holder's leave; no overlap with #3283.

## 11. Unmeasured

- Real depth in the session that motivated this: measured later, through the product.
- A real phone's keyboard opening and closing, on both phone systems (the operator's own check). The 300px shrink is the
  shape, measured in Chrome.
- The wave 171 server (no echo) in a browser: the fallback is pinned in the store's suites only.
