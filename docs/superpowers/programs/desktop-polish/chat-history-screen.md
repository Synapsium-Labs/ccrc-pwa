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
- **Fix round 1** (review 3734): a page that lands never sets back movement made after it, read from the scroller's
  position against the list's own writes, not from input events alone (F1, A7); a page of calls only that joins the top
  stretch keeps it open and holds the reader (F2); an expired place is said (A5); a busy answer is asked again on its
  own (A6); the rest as §8's fix round table and §9 say.
- **Fix round 2** (review 3769): a page after a context reset is told as a page, by the first row after the reset's own
  rows, so it settles like any other (F1); opening the chat again while its top says the older rows cannot be loaded
  connects as a first open does, so a backlog brings a continuation and the words are true (F2); the frames queued before
  a page write nothing while it settles (A2); and the guards the review's mutants left green are pinned (A1, A3).

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
writes nothing and the near-top load waits; once the scroller has been quiet for two frames, `settlePrepend` makes at
most one write. **First, a list that moved after the page landed is left where it went, whoever was where then** (fix
round 1, F1 and A7): the list moving is the reader moving. It is measured by the scroller's position, not by input
events alone: the list reads where each of its own instant writes left the scroller (virtuoso moves it only through the
element's `scrollTo` and `scrollBy`, which `ownWrites` wraps on that element to note the position, every call going
through unchanged), and a scroll event during the settle that finds the scroller anywhere else is movement no input event
announced: a fling's momentum after the finger lifted, a scrollbar thumb dragged, Jump to latest's smooth scroll. A
wheel, a touch, a pointer press or a key since the page came counts too. Otherwise it decides through `heightMove`, with
the place the reader had before the rows came: a reader at the foot is taken back to it, anyone else has their row put
back by its key.

**The anchor is a row and the rows under it** (eight, in order): when the join replaces the row crossing the top (the
first time divider goes, a stretch takes the page's calls), the first of the others still drawn is held. A read of the
anchor still owed to the frame after a scroll when a page comes is made in the page's render, off the rows still drawn
(fix round 2, A2), and the frames queued before the page (a scroll's read, a height change's hold) do nothing while it
settles: virtuoso writes the scroller until it is quiet, and the settle holds once after it.

**How the list tells a page came** (fix round 2, F1): by the first row after the rows a page goes after
(`olderPages.ts#leadOf`): the "Session context reset" row a rotation leaves on top, and its time divider, which a page
never changes (`rowsFrom`). Before, it compared the list's first row, so after a context reset no page was seen: no
settle, no join, and the near-top load chained page after page with the reader still at the top. Measured in Chrome on
the head the review read: the reader's row moved 24,100px at 390 and 15,206px at 1280 after the first page, seven pages
asked, to the transcript's start; after, 0px for each of three pages, three asked.

**A stretch that takes an older page's calls** changes its key (`activity-<first entry's key>`) but is the same stretch,
grown at its top (`stretchJoin.ts`, read off the two lists, never off the key's spelling): it keeps its open or closed
state (`keepOpenAcross`), and the hold keeps the reader's place by the stretch's FOOT, which growth at its top does not
move, following every join since the anchor was read. A page made only of calls renames the top stretch and adds no
row, so virtuoso's first index stays; it settles exactly as a prepend does (`adjusting`, then the one correction), and the
near-top load waits for it (fix round 1, F2). Before, nothing settled: an open stretch closed across that join, and a
closed stretch gaining a failure card grew 50px above the reader unheld; measured in Chrome, virtuoso's own correction of
the renamed row's height (a scroll event) made the hold read the list as moving, and three pages chained before the list
reported a height at all.

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
| `busy` | Another page of older messages was still loading. | Try again, after the request was asked again on its own three times, 800ms apart, one at a time, the top saying Loading meanwhile (fix round 1, A6) |
| `changed` | Older messages cannot be loaded now: the transcript changed. | none |
| `absent` | Older messages cannot be loaded now: the transcript is no longer there. | none |
| `unreadable` | Older messages cannot be loaded now: the transcript could not be read. | Try again |
| `unmeasured` | Older messages cannot be loaded now: the transcript could not be measured. | Try again |
| gap | One or more records here were too long to load and are left out. | a dashed rule, at the gap's place |
| `expired` (the wire's `expired` or `invalid`) | Older messages are there but cannot be loaded here now. Reopen this chat to load them. | none: asking again cannot help. It stands until a backlog brings a continuation (fix round 1, A5: a reconnect after a server restart resumes with no backlog, so a silent end read as nothing older). Opening the chat again brings one (fix round 2, F2): a screen opened while the top reads this connects as a first open does, without its resume position, until that open's backlog comes (`olderPages.ts#opensFresh`); a reconnect of the open screen, and an open in any other state, resume as before |
| `none` | nothing: no control, today's view (an older server, or a stream that cannot page) | |

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
keyboard) take them back. A tap that shrank the list and left the reader at its foot did not move them off it, so its
window ends there: a reader at the foot who closes the newest stretch still follows a live row (fix round 1, A1). A tap
that grows the list keeps its window, which is what keeps a tapped header in view (the 40-tap probe). Position decides it:
measured in Chrome, Instrument draws an open stretch's every call, so a 33-call stretch open at the foot is 1,838px tall
and its header out of view; closing it there leaves the reader 1,770px above the new foot, at the header, which is
leaving the foot by position, and is kept as a leave. The case pinned is the one a reader can tap: a stretch whose
header is in view at the foot (`chat-foot.browser.test.ts`, both skins, 390 and 1280). **A person sees one difference:** an append at the foot is followed at once, not by a smooth
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

### Fix round 1 (review 3734, rulings in mail 35269 and 35294)

Reproduced first, in Chrome, on the head the review read (phosphor; the reader's input before the page, the movement
after it landed; F1's three announced by no input event, A7's by a wheel, so A7 is decided by the input arm, not the
position check: fix round 2, A5):

| Case | Before the fix | After |
|---|---|---|
| F1, a fling's momentum (Refined, 390) | set back 366px | 0px |
| F1, a scrollbar thumb dragged, then held still (Refined, 1280) | set back 302px | 0px |
| F1, Jump to latest pressed while a page was out (Refined, 1280) | 1,651px from the foot | 2px (Jump to latest's own 3px band) |
| A7, at the foot when the page came, then moved up 300px (Refined, 390) | 0px from the foot (thrown back) | 300px, where they went, the row read 0px off |
| F2, a page of calls only into an open top stretch (Refined, 390) | not reproduced before; the mutant that drops the open state's carry closes it | open, the row under it 0px off |
| F2, the same into a closed stretch that gains a failure card | 50px, the card's height | 0px |
| A1, a reader at the foot closes the newest stretch, a live row 150ms later (both skins, 390 and 1280) | red in all four with the fix cut | at the foot, no pill |

The Jump to latest case was not the settle's write alone: virtuoso's instant write for the page's rows stops a smooth
scroll where it is, so a settle with Jump to latest under way ends at the foot. The repeated prepends still hold the row
within 0.50px (mean 0.31px over 32), so nothing the list writes itself is read as the reader moving.

Mutants, each applied alone to the committed source, run against its named files, restored and hash-checked: ten in
jsdom (the settle's position check, cut whole: its distance comparison alone was unguarded in jsdom, fix round 2, A3; the own-write record; A3's drop; A5's word; A6's retries and the store's timer; A4's
marker time and the top case's repeat; F2's renames and the open carry), all killed; three in Chrome (A1's window end,
F2's settle of a join, F2's open carry), each turning its own cases red (A1 in all four views).

The whole suites on the fix round's code, in four parts each: pwa, 605 files, 18,702 passed and 2 skipped, with one file
(`mockup-policy`) whose worker the test slice's memory cap killed under the box's load, green alone (153 of 153); the
browser suite, all 120 files, 4,332 passed, 52 skipped and 1 expected to fail, nothing unrun. No server file changed in
this round.

### Fix round 2 (review 3769, the coordinator's mail 35550)

| Item | Before | After | Pinned |
|---|---|---|---|
| F1, three pages after a context reset (Refined, phosphor, 390 and 1280) | the reader's row moved 24,100px (390) and 15,206px (1280) after the first page; seven pages asked, to the start | 0px each page; three pages asked for three | Chrome, red with the check back on the first row; `leadOf` in jsdom |
| F2, the chat opened again while its top reads `expired` | resumed with no backlog: the words stood | a first open's connect, a backlog, Load older again | jsdom (the store, its socket addresses): reopened fresh; a drop before that backlog asks fresh again; the open screen's reconnect resumes; every other state resumes. Chrome cannot show the bug: its routed socket sends a backlog on every connect |
| A1, the fling and the thumb cases | glided after the page's row was drawn | start in the frame the page grows the list | Chrome, red with round 1's "moved" cut (366px, 302px) |
| A2, a scroll's or a height change's frame after a page | could read the anchor off the page's rows, or write the scroller while virtuoso compensated | the owed read made in the page's render; both frames do nothing while it settles | jsdom, two cases (the scroll frame's and the height change's, `hold-wiring.test.tsx`), each red with its guard cut; three guards, the owed read among them (corrected by wave 179: this cell said three cases) |
| A3, the settle's distance comparison | green in jsdom with it cut to the null arm | a move after the list's own write, no input, is left where it went | jsdom, and Chrome (the fling and the thumb, 366px and 302px) |
| A3, one of the two methods wrapped | green with only `scrollBy` wrapped | a `scrollTo` write is the list's own | jsdom |
| A3, the retry timer's own re-check | green | a reader who left and opened the chat within the pause is asked nothing they did not ask | jsdom (leaving the screen does not clear the timer; without the re-check the old timer asked on the new socket) |

**The absorb of #3358** (wave 176, the compact mail rows; merged to main first, resolved as mails 35524 and 35550 ask).
The list is built (keys made unique as it is built), its one gap divider kept (the absorb's merge commit on the wave's
branch, d0881e707c, says "dropped": the list keeps one divider at a gap and drops only its repeat, `ChatList.tsx#oneDividerAtGap`), then the mail fold, then the live-from
index measured on that folded list, which reads a lone prompt by its event and a run of prompts as live when any prompt
is, then the tool fold; both list builds go through `itemsOf`. The tool fold keeps its position array beside the tool
entries only, and wave 176's members list (calls and joined cards) feeds the inner rows; no position is read off it. The
hold, the prepend shift and the join reader all read that one list, after the mail fold. The join reader follows a run
of prompts the way it follows a stretch (a run is keyed by its first prompt, so a page of same-day prompts renames it, and
a lone prompt there becomes a run), and follows a lone fetched card that a join takes into a stretch to that stretch, for
the hold; the open state carries only within a stretch or a run, since a card's own choice is keyed by the card. A card
drawn under a closed stretch's row makes the stretch's height the reader's choice, and a join's growth there is
virtuoso's own write, read by position as any other: not the reader moving. Pinned in Chrome: an open run at the top
given a page of 28 same-day prompts (Refined 390, Instrument 1280) stays open under its new key with the message under
it 0px off; with the run reader cut, it closes and the message moves 1,182px. In jsdom: the run's growth, the lone prompt
becoming a run, a closed run, the lone card into a stretch (its open state never the stretch's), and the live-from index
over a run that straddles the older rows' boundary.

Mutants this round, each applied alone, run against its file, restored and hash-checked: in jsdom, F2's fresh open and
its clear, the timer's re-check, the distance comparison, the `scrollTo` wrap, the height frame's guard, the scroll
frame's guard and the owed read, eight, and for the absorb the run's live read, the join reader's run, lone and card arms
and the open carry's group check, five: thirteen, all killed; in Chrome, F1's lead, the distance comparison, round 1's
"moved" and the join reader's run arm, four, each turning its own cases red.

The whole suites on the merged code (the head commit adds only this note), in four parts each through the test slice:
pwa, 622 files (the sum of the four parts' counts; how each part's count was read was not recorded, and on `main` at
64ccd3b57f the files vitest's include collects, less `browser/**`, number 617 `*.test.ts(x)` by `git ls-tree` plus the 5
`*.test-d.tsx` type-test files it collects too, 622, so the count was right; wave 179 reports vitest's own `Test Files` line
of one whole run), 19,166 passed and 2 skipped, with `mockup-policy`'s worker killed by the slice's memory cap under the
box's load (green alone, 153 of 153); the browser suite, all 123 files under `pwa/browser`, 4,371 passed, 52 skipped and
1 expected to fail, with 7 cases red in 6 files during the slice's memory-cap kills (`model-sheet-labels`, `chat-links`,
`project-linking-card`, `tool-activity`, `docs-mockup`, `testbox-connect`: timeouts and a crashed page), each file green
alone (16, 14, 12, 48, 23 and 20 of their cases). The named jsdom files, with wave 176's: 11 files, 283 passed. Nothing
unrun. No server file changed in this round.

## 9. Limits

- Two separate records equal in every field the parser gives are one identity across frames (§3).
- A repeated row key is counted from the newest end, so a prepended page renames no row already shown: an older row
  sharing a shown row's key is the one that gets `~n`. What does rename shown rows is a LIVE append sharing a key (calls
  with an empty `toolId` all key as `''`): the older rows sharing it are renamed, so they remount, lose their entry in
  the expansion memo and change the hold's anchor key. Measured no repeated key in 72,842 records here (fix round 1, A8,
  correcting this line, which had the rule backwards).
- A reader who stops scrolling within the one pixel where the foot band (`band + 1`) and virtuoso's not-at-the-foot
  threshold overlap is taken back to the foot: the scroll that put them there wrote where the foot stands, so the leave
  reads as the foot leaving them (`footLeft`, `movedUp` needs a fall of more than 1px). Exactly: a reader whose distance
  from the foot ends in `[band, band + 1]` px with no scroll after it. Accepted by the coordinator (fix round 1, A2).
- Older rows display only: an older call without a result is drawn settled even if it is still running.
- A reader who is moving when a page lands keeps virtuoso's own estimate error: the settle makes no write once the list
  moved (the ruled design, fix round 1, F1), so the rows land where virtuoso's estimates put them, up to the 451px
  measured at rest (§4). Writing there re-created the 366px and 302px set-backs (fix round 2, A6).
- Opening the chat again while its top reads `expired` replaces the rows on screen with the fresh backlog: the older rows
  held are dropped with it, and come back by paging (fix round 2, F2).
- The `expired` words do not tell the reader that the pages they loaded are replaced when they reopen the chat: they
  say older messages are there and that reopening loads them. Stated as this limit, not worded on screen (wave 179).
- No echo (the wave 171 server): after a void, the first answer is dropped whichever request it answers, so case A costs
  one extra round trip. A `more` answer whose continuation is the request outstanding's is the request before's, a page
  already applied, and is dropped (fix round 1, A3, the coordinator's ruling 35294). Counting the given-up request as
  voided instead was rejected, and must not come back: the server drops a page read across a backlog, so the voided
  request's answer usually never comes, the count never returns to zero, and every later answer is dropped, so older
  pages stop loading until the next backlog.
- The list reads an index below virtuoso's first index as a data index (`rowAt`): no virtuoso sends one, and the suites'
  stand-in lists count rows from 0. Done so the nineteen jsdom stand-ins need no edit.
- The screen subscribes to `older` with one more selector, one more of the route-keyed store's CodeQL notes.

## 10. Peer hunks, by leave

- `chatItems.ts`, `toolActivity.ts`, `ChatList.tsx`, `ui/src/index.ts` (wave 176, #3358): it landed first, and this
  branch absorbed main in fix round 2 (§8), `liveFromOf` after `foldMailRows` as planned.
- `SessionScreen.tsx` (claim 6923, wave 173): three hunks, the holder's leave; no overlap with #3283.
- `pwa/test/tool-activity.test.tsx` (claim 6989, leave 34946): one case's scroll-up now moves the scroller up from a
  measured foot, as a reader's does (§8, the first full run). What jsdom no longer pins there: a reader's input with no
  upward move counting as leaving the foot. Chrome pins the foot's rule instead (`chat-foot.browser.test.ts`). (Fix round
  1, A11.)

## 11. Unmeasured

- Real depth in the session that motivated this: measured later, through the product.
- A real phone's keyboard opening and closing, on both phone systems (the operator's own check). The 300px shrink is the
  shape, measured in Chrome.
- The wave 171 server (no echo) in a browser: the fallback is pinned in the store's suites only.
- iOS WebKit's momentum scrolling (fix round 2, A4): while the reader scrolls there, virtuoso defers its compensation
  into a CSS offset and commits it with `scrollBy` later, so the settle's reading of a fling there is unmeasured; the
  fling was measured in Chrome at 390px only.

## 12. Wave 179, the follow-up (2026-11-25, run 3814)

What the reviews of #3361 left in the scroll back, built on `main` after it merged. Measured unless marked.

| Item | Before | After | Pinned by |
|---|---|---|---|
| A1, the shift after a transcript change | `prependShift` answered 0 both for "the first rows are the same" and for "no row in common", and the list added the lead difference after either: a context reset, then a backlog onto another file with no rotation notice, moved virtuoso's first index by 2 on a list nothing was put before | "No row in common" is its own answer (`null`); the list adds the lead difference to a found shift only; and (fix round 1, F1) the working pulse and a pending send, which belong to no file and outlive a change of it, are never that row: `chatItems.ts#fromNoFile` names them where they are built, the list hands them to `prependShift` as null keys, and a null never matches | `foot-follow.test.ts` (the answer, and null keys), `hold-wiring.test.tsx` (the list idle, busy and with a send pending, each red first: the first index moved from 1000000000 to 1000000002; and a new list that opens with the reset row) |
| A2a, the build order | a mutant measuring the live-from index before the mail fold survived every jsdom file | A list-level case: older rows holding a run of prompts that crosses the boundary, then a live call, which reads as running | `chat-history.test.tsx`, both skins |
| A2b, the reset lead at the call site | a mutant forcing both leads to 0 survived jsdom (only Chrome killed it) | A case that opens with the reset row, lands a page under it and holds the reader's row | `hold-wiring.test.tsx` |
| A3, a list that is only the reset row and its divider | unmeasured | measured idle and busy, and pinned as the list's own rule has it (the coordinator's ruling (a) on fix round 1, mail 36263): see below | `chat-history.browser.test.ts`, `hold-wiring.test.tsx` |
| A4, reopening a chat whose older edge reads `expired` | unmeasured on screen | measured: no defect of the reopen; see below | `chat-history.browser.test.ts` |

**A3, as fix round 1 found it** (the first text of this section was wrong; corrected here). The list fits the view, so
before the press the scroller is at 0, the reset row is whole in view, and the reader is pinned at the foot. While they
are, nothing asks a page: the near-top load asks only for a reader who left the foot (`ChatList.tsx#nearTop`, "a list too
short to scroll offers the control instead"), and the control is the only other caller, so on a reset-only list that fits
the view **no page lands without the press**, and a reader who never presses stays pinned. Pressing Load older un-pins the
reader by design (`ChatList.tsx#loadFromControl`: the reader asked for the top, so the foot no longer holds them). Then, in
both states:

1. The first page goes under the reset row. Nothing was put before the first row, so virtuoso's first index does not move
   (1000000000 before and after) and no settle runs (the scroller stays at 0); the page's rows draw under the reset row.
2. The reader is un-pinned and near the top, so the list asks the next page by itself. That page goes above the first
   page's rows, under the reset row: a real prepend (the first index moves by 26), and its settle holds the row in view
   (`rm87` at 236.5 px before and after, in every view). Exactly two pages are asked.
3. At rest nothing moves, and the reader is on the first page's rows, off the foot:

| View | Idle: from the foot at rest | Busy: from the foot at rest |
|---|---|---|
| Refined 390 | 2,495 px | 2,704 px |
| Instrument 390 | 2,522 px | 2,650 px |
| Refined 1280 | 1,500 px | 1,536 px |
| Instrument 1280 | 1,508 px | 1,543 px |

**What changes for a reader.** Idle, a reset-only list behaved this way on `main` already. Measured on the reviewed head's
source (2,054, 2,136, 2,081 and 1,508 px from the foot, the case's idle variant green there), whose path here is `main`'s by
reading: idle, neither of round 0's A1 changes is reached (no lead difference, no shift found). Only the busy state changes.
On the reviewed head, busy, the working pulse below the reset row was taken for a row in common: the rotation itself moved
the first index by 26 (1000000026 before the press), the first page moved it back by 25, and the hold's anchor was the pulse
at the foot, so holding it put the reader at the foot, 108 px (Refined) and 147 px (Instrument) short of it for about five
frames at 390, then a snap. That accident is the only reason busy ended at the foot, and it is why the first text of this
section gave the wrong cause ("no shift and no settle, the foot follow alone") and why the coordinator's first ruling
(mail 35942: pin the reader at the foot, the snap a stated limit) rested on a false premise. **That ruling is withdrawn**
(mail 36263), and the limit about a late snap no longer applies: with F1 neither state snaps. Holding the reader at the
foot after a press (changing the foot follow against the control's stated rule) and backing F1 out for this shape were
considered and refused (the ruling).

Pinned in Chrome at 390 and 1280 in both skins, idle and busy: before the press scrollTop 0, the reset row whole in view,
no page asked; after the first page the first index unchanged, the scroller at 0, the page's rows under the reset row;
across the second page the row in view within 1 px, and two pages asked, not a chain; at rest the last 8 sampled frames
identical and the reader on the first page's rows, not at the foot (the distance printed, never bound). In jsdom
(`hold-wiring.test.tsx`), idle and busy: a page under a reset-only list moves no first index. The busy variant is red on
the reviewed head's source (`expected 1000000001 to be 1000000026`), so the case guards F1 too.

**A4.** The harness gained one opt-in hook (`AppFixture.onSessionSocket`, off by default; no existing case changes its
routing): a case answers each session connect itself, told whether the connect resumes (`?since=`). A resuming connect gets
no backlog and a fresh one a backlog, as the server does. The chat is opened, paged once, its edge brought to `expired` by
a stubbed answer, left for another screen inside the app and returned to by history, with no reload. The return connects
fresh (`opensFresh`). The page is asserted before the edge is switched (fix round 1, F4): an answer with rows sent, and a
row older than the fresh backlog's first drawn (the list draws 1,200 px above the view, so the page's newest rows are);
before, the precondition was only printed. In all four views (Refined and Instrument, 390 and 1280 px): no frame draws a cached older row before
the fresh backlog replaces them (no flash); no empty frame once rows are drawn; the reader ends at the foot (0 to 1 px from
it); at 1280 the first drawn frame is already at rest. At 390 rows move 196 px (Refined) and 273 px (Instrument) over about
five frames after the first drawn frame, and before it the scroller stands mounted with no rows for about four frames
(about 65 ms).

**A4 against a plain first open** (the coordinator's ask, mail 35942), the same hook and sampler, sampled from navigation
for a first open and from the return for a reopen; every open ends 0 to 1 px from the foot:

| View | Open | Frames with the scroller mounted and no rows | Frames to rest after the first drawn frame | Biggest move of a row drawn in two frames |
|---|---|---|---|---|
| Refined 390 | first | 4 | 2 | 618.5 px |
| Refined 390 | reopen | 4 | 5 | 196.5 px |
| Instrument 390 | first | 4 | 2 | 617.5 px |
| Instrument 390 | reopen | 4 | 5 | 273.5 px |
| Refined 1280 | first | 4 | 0 | 0 px |
| Refined 1280 | reopen | 4 | 0 | 0 px |
| Instrument 1280 | first | 4 | 0 | 0 px |
| Instrument 1280 | reopen | 4 | 0 | 0 px |

So the reopen is no worse than a first open: the same at 1280; at 390 three frames longer to rest, with rows moving a
third as far. Pinned as invariants only: the reopen connects fresh, the fresh backlog's live rows are drawn, the edge no
longer reads `expired`, and no cached older row is drawn, bounded by the reopen's own backlog's first row (fix round 1,
M5: the reopen's backlog carries three live rows, so it starts three events after the first open's, `em142` not `em139`;
the oldest row drawn in any frame was `em160`); the first open draws rows and ends at the foot. Re-measured on the fix
round's head: frames to rest 3 against 2 at 390, 0 against 0 at 1280; biggest move 299.5 and 241.5 px against about 618.

**Mutants** (each applied alone, run against its file, restored):

| Mutant | Red by |
|---|---|
| A1, the lead difference added after either answer | `hold-wiring`: "A1: a context reset, then another transcript with no rotation notice, moves no first index" |
| A2a, the live-from index measured on the list before the mail fold | `chat-history`: "Refined/Instrument: a run of prompts across the boundary, then a live call: the call still reads as running" |
| A2b, both leads forced to 0 at the call site | `hold-wiring`: "A2: a page under the reset row holds the reader's row" (the row moved 1200 px) |
| F1, the list hands the working pulse and a pending send to `prependShift` as keys | `hold-wiring`: "A1 ... (busy (the working pulse trails))" and "(with a send pending)" |
| M1, the lead of a new list added on no row in common (`found === null ? ln : …`) | `hold-wiring`: "fix round 1 (M1): a new list that opens with the reset row moves no first index" (it survived 243 cases in review 3838) |
| A3, the reviewed head's `ChatList.tsx`, `chatItems.ts` and `footFollow.ts` | `chat-history` (Chrome): the four busy cases, "the first page under the reset row moved virtuoso's first index" (idle green, as on `main`) |

**Suites.** Through the runner, on this wave's code (eafe13d2da; the head adds only the notes). The **first full pwa
run was red**: three census cases, from B2's stylesheet. The shape census's registered pair, the stretch row with the mail
card's head, no longer clusters once the row wraps (a stale entry, and 12 clusters against 13), and the contrast census met
`.tool-activity-asks`' own colour. Fixed by removing the stale entry and letting the question words take the row's own
ink. (That run's process was then killed by the test slice's memory cap.) Then the whole pwa set in four parts: 156, 156,
155 and 155 files (622 by vitest's own `Test Files` lines), 18,752 cases passed, 1 failed and 11 skipped. Eight files failed
to run only for this worktree's missing server-package dependencies (seven could not import the server's scanner, one
could not build the worker), and the one case, `settings-screen`'s release window, failed under load. After installing
those dependencies, the nine files ran together, green: 689 cases. Every file under `pwa/browser` (123) in four parts of 30, 31,
31 and 31: parts three and four green; parts one and two green but for one case each while the slice's memory cap killed
processes (2 and 7 kills): `connect-sheet` (instrument 1280, the clock's fast-forward) and `tool-activity` (refined 1280,
a page key, "the case measures nothing"). Each file then ran alone, green: 20 of 20 and 48 of 48. In all: 123 files, 4,400
cases passed, 1 expected to fail, 52 skipped, none failed. On a scratch merge of this branch with `main` at 861cd77728
(after #3370, the coordinator's heads-up 35952): the changed and neighbouring jsdom files, 11 files and 686 cases, and the
two changed browser files, `chat-history` and `mail-rows`, 68 cases: all green. The merge probe against `main` was clean,
so nothing was absorbed.
