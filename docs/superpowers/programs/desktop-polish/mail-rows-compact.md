# Mail rows, compact (desktop polish wave 176, run 3691)

The task note for wave 176, goals modification 106 (the operator: "Can mail receipt blocks also be nicely wrapped up?").
Written by its worker for the coordinator to fold into the ledger. Each claim says whether it was **measured** (read on the
tree, or in a test run by this wave) or **inferred**.

## In short

A coordinator's chat was mostly two things drawn whole on every wake: the mail lane's prompt, filed as a bubble from the
person, and the fetched mail card. Now, in both skins:

- the lane's prompt is one quiet line, `▸ ✉ Mail arrived  14:02`, whose full text opens on a tap or Enter;
- a fetched card is one closed line, `▸ ✉ sender  subject  KIND  14:02`, and opens to today's card, whole;
- a fetched card sits inside the tool stretch of the fetch that produced it, and the stretch's row says how many it holds
  (`Tool activity · 3 calls · 1 message · …`), and how many questions it holds that are not drawn under it
  (`2 messages, 1 question`);
- the newest card that asks something of the session shown opens by default, whatever ordinary mail follows it, and is
  drawn under its closed stretch; a card drawn there stays there for the view;
- prompts with nothing a person would read between them are one line with a count (`Mail arrived 3 times, 14:01 to 14:04`),
  opening to their own lines.

On a 30-wake coordinator transcript the mail rows took **24611px before and 3869px after at 390px**, and about
**15.5-16.3k px before and 3790px after at 1280px** (measured, section 6).

## 1. What is built

| Piece | File | Ring |
|---|---|---|
| The recogniser, the run rule, the open-by-default rule, the run fold, the words | `pwa/src/session/mailRows.ts` | L1 |
| The two new item kinds (`mail-prompt`, `mail-prompts`) and the card's `opens` | `pwa/src/session/chatItems.ts` | L1 |
| A fetched card joins its stretch; the row's message count | `pwa/src/session/toolActivity.ts`, `ToolActivityRow.tsx` | L1, L4 |
| The rows, drawing the open state from the list's memo | `pwa/src/session/MailRow.tsx` | L4 |
| The memo keeps a choice in either direction (`choice`) | `pwa/src/session/transcriptRow.tsx` | L4 |
| The row barrier compares the new lists | `pwa/src/session/sameRow.ts` | L1 |
| The `mail-line` height bucket | `pwa/src/session/itemHeight.ts` | L1 |
| The chat list: render cases, the fold at the two `transcriptOf` call sites, the prices | `pwa/src/session/ChatList.tsx` (32 lines, held by wave 175, carried by its leave) | L4 |
| `MailCard`'s closable form (`fold`), `MailPromptLine`, `MailPromptText`, stories | `ui/src/components/mail-card.*`, `ui/src/components/mail-prompt-line.*` | design system |

Nothing changed in what the server types, mail delivery, acknowledgement, the envelope's parsing, which results make a
card, the inbox screen, server or agent source, `pwa/src/docs`, or the list's scroll and place-keeping code (measured:
the diff touches none of them).

## 2. The head match: one shared definition, no new line in the wire file

The console reads the head from `shared/injected-prompts.mjs` (the `mail-nudge` row, `match: 'head'`) through its own
`injectedPromptOf`, imported directly, as `pwa/src/lib/models.ts` already imports `shared/model-advance.mjs`. So
`shared/api.ts`, at its growth cap, gains no line (measured). A turn is the lane's prompt when it is a user turn and
`injectedPromptOf(text) === 'mail-nudge'`: the head at the start of the turn at a word boundary, nothing looser.

Every form the server types today begins with that head, read from the server's own renderers: the generic nudge
(`renderMailNudge`), the operator-message nudge (`renderOperatorMessageNudge`), the inbox wake (`renderInboxWakeLine`,
with a count, a lapse and the codec's refusal) and the spot-probe notice (`renderSpotProbeLine`). A console test may not
import server source (the reach census, `ci-reach-census.test.ts`, refused the first build's import: the console's tests
skip a change under `server/`), so the forms are rendered once into `server/test/fixtures/mail-prompt-forms.json`, a path
the console's tests may read, and `server/test/mail-prompt-forms.test.ts` holds that fixture equal to the renderers and
each form to the head. A renderer that changes its words reds there, in the server suite that a server change runs.
A person's message that mentions mail, names the head mid-sentence, quotes the prompt lower down, pastes it after other
words, starts with a space, drops the full stop, says "mails", changes case or runs on past the head with no space after
it ("…new mail.Now read it.") stays a bubble.

**A limit, ruled (review 3737 A2): the shared head is the contract.** A person's message that begins with the lane's whole
head and a space, then adds words of their own ("ccrc-mail: you have new mail. Then stop wave 3 before it merges."), is
folded as a prompt; its words are one tap away, in the line's full text. Pinned as a decision by a case in
`mail-rows.test.tsx`.

The server test also walks the table that chooses what the lane types (`FIXED_LINE_MAIL`, which `mailNudgeOf` reads,
review 3737 A8): every row's line, rendered from the table itself, begins with the head, and every row has a form in the
fixture. A new fixed-line mail whose line does not begin with the head is red there (measured: a spot-probe line changed
to start "Notice." failed that case alone, the fixture case staying green; the file was restored).

## 3. Decisions made where the brief said decide

| Question | Decision | Why |
|---|---|---|
| Which card opens by default | A card whose envelope `kind` is `question` AND whose `toId` is the session shown AND which is the newest card of the chat that asks (`opensByDefault`), whatever ordinary mail follows it | `question` is the envelope's one word for a mail that asks for an answer; `toId` is the session the delivery was made to, so a card read about another session asks nothing of this one. "The newest that asks", not "the newest, if it asks", is the coordinator's ruling on review 3737 F2 (the first build read the brief the other way): a question followed by a status mail is open |
| What "nothing a person would read" is | By item kind, one record over every kind (`SAYS_NOTHING`): a timestamp divider and a prompt say nothing; a message (the person's, the session's, a system row), a mail card, a tool call, a task card, a pending send and the working pulse are read | A divider is a time, which the run's line carries itself; a run that swallowed a tool call would move the session's own act out of its place. A new kind is a compile error until placed |
| Dividers in a run | A divider between two members goes inside the run (drawn in the opened list as the chat draws one); one after the last member stays outside | Keeps every time visible where it was |
| Runs across a day | A prompt on another local day than the run's first ends the run (`sameDay`), with or without a divider between them | Review 3737 A3: a run's line shows clock times only, so "23:50 to 00:10" would hide the day; the day's divider stays in the chat |
| Which cards join a stretch | Only a card from the live lane (its event is a `tool_result`, the session's own fetch), and only when a stretch is open before it. A legacy typed card is a user turn, a prompt, and still ends one | "Belongs with the fetch that produced it" |
| What a closed stretch draws under its row (`underRow`) | The card that opens by default, always; and every card drawn there earlier in this view, open or closed as the reader left it, in the stretch's order, so two can show. A card the reader only opened or closed inside the body never appears there. The row draws `underRow`'s cards, and the list prices the same list (`shapeOf`) | The coordinator's ruling on review 3737 F1 and A4. A card drawn there is marked in the list's memo (`under:<key>`) when it is drawn |
| A closed stretch holding a question that is not drawn under it | Its count names it: "2 messages, 1 question" (`hiddenAsks`) | The ruling on F2: a closed stretch never hides an asking card without a sign |
| **A card drawn open by default, then a newer question arrives** | **It stays open for the rest of the view**, and stays under its row (`MailRow.tsx#useOpen`, `underRow`). A card never drawn open while it opened by default opens closed | Measured in Chrome before the rule: letting it close moved the paragraph the reader was reading by the card's height (5 lines) in all four views. The list's hold skips a height change that comes with a new item at the end (`footFollow.ts#heightMove`, `newItem`), and that code is out of bounds for this wave |
| A prompt the reader opened, then a second arrives | The run opens, and the first prompt inside it stays open (`openOf` reads the first member's choice) | "Stays open across live rows arriving" |
| The open state's home | The list's existing `ExpansionMemo`, now recording a choice in either direction (`choice`), keyed by row key | One owner of "what the reader opened", already outliving the virtual list's unmounting; a reload starts fresh |
| The card's head words | Sender, subject, kind, time; spoken as "Mail from X: subject, kind, 14:02" | The brief's list; the run label and the recipient stay in the open card |
| The prompt line's words | "Mail arrived", "N times", the time or the range "first to last", shown and spoken alike ("Mail arrived 3 times, 14:01 to 14:04"), so the shown words are in the name (WCAG 2.5.3) | Says what it is, how many and when; `aria-expanded` says whether it is open |
| Height bucket | A new `mail-line` bucket for every closed line; an open card stays in `mail`, priced with its head line | A closed line is a fixed-height row; mixing it into `mail` would skew that bucket's per-line model |
| Pricing | As the reader left the row: `shapeOf` reads the list's memo, so a card is priced open or closed as it is drawn (`openOf`) and a closed stretch with the cards `underRow` draws, in the opening estimate and in each sample | Review 3737 A5: a card kept open was priced as one line while it drew whole |

## 4. With the tool stretches (measured)

Before: a fetched card ended the stretch it sat in (the A2 pin of wave 168, `tool-activity.test.tsx`), so a wake of
`inbox, fetch, ack` drew two disclosures with a card between them. On the 30-wake transcript that was 60 tool-activity
rows; now 30. The A2 pin still holds for every card that is not a fetch's result (its fixture card's event is not a
`tool_result`); a comment there says so.

## 5. Tests

`pwa/test/mail-rows.test.tsx` (70 cases after fix round 1), `pwa/browser/mail-rows.browser.test.ts` (12 cases, Chrome), and pins updated in
`mail-card.test.tsx` (the closed card is opened before its inside is read; its one control is its own disclosure, closed and
open, with no word of acking, replying or answering; the kind is read from the meta row, `.mail-card-meta .mail-card-kind`,
because the card's head line now holds a kind too), `chat-scroll.test.tsx` (the open card's price gains its head line; a
closed card is one `mail-line`) and `tool-activity.test.tsx` (the words gain `messages`).

**Suite runs on this branch.** The first full pwa run after the build was **red**: 7 cases in 5 files, all censuses this
wave's new names had not been registered in (a module pair differing only in case, `MailRows.tsx` and `mailRows.ts`; two
hook classes and the glyph constant missing from the owned vocabulary; one class string spelled twice; three duplicated
CSS shapes). Fixed by renaming the row file `MailRow.tsx`, reusing the card's own kind and run rules in its head, naming
the glyph class once, and the census entries (`design-system-boundary.test.ts` and `shape-census.test.ts`, the head beside
the tool-activity row with its reason). The second full pwa run: 610 files passed (the 611th is todo-only), no failure. The whole browser suite on this tip
(the coordinator's addition), every file under `pwa/browser`, through the runner in four parts of 30, 30, 30 and 29
files: 119 files, 4292 cases passed, one marked expected-fail, 52 skipped, none failed.
The server's guard suites (the fast run's `guardTests`, 262 files) found one more of this wave's, the reach census
refusing a console test that imported server source (section 2). Their other reds were not this branch's: `ccd-tmux-anchor`
(19) and `ccd-child-tmpdir` (1) fail only from this worktree's location (an extract of the same tree elsewhere fails the
one `ccd-tmux-anchor` case current `main` fails too), `deviation-refs` timed out at 20 s under load and passed alone in
16.5 s, and `typecheck-tests` could not run on the test box (its checkout has no pwa `node_modules`); the new server
test typechecks clean under the server's settings.

The tests were written after the code, so each guard was proven by a mutant instead of a red-first run: 34 mutants, every
one killed by the jsdom suites (`mail-rows`, `tool-activity`, `mail-card`, `chat-scroll`, `same-row`). One survived at
first (the recogniser's own user-turn check, which the builder's call site made redundant) and is now killed by a direct
pin. The Chrome "row above" case was red on the first build (the paragraph moved 5 lines) and is green with the rule in
section 3.

**Label in name (after the first push).** The pull request's `storybook-a11y` leg was red on the new stories: axe's
`label-content-name-mismatch` on every mail line (6 stories). The parts of a line are adjacent spans with no space between
them, so the words it shows ran together ("coordinatorwave-brief"), and a run's range showed "14:02–14:40" while its name
said "14:02 to 14:40". So the words a voice user reads off the line were not an unbroken run of its spoken name. Fixed in
`ui`: a space between the parts (a flex line draws none), and a run's range reads "14:02 to 14:40" on screen as well. The
guard, red first with that failure and green after, is the jsdom case "every mail line, closed and open, single and a run,
holds the words it shows in its name" in both skins, through the repo's own measure of the rule (`labelInName.ts`,
`namesWithoutTheirLabel`).
Then Storybook's own axe run, as CI runs it (a static build served by `vite preview`, `test-storybook`), over the two
mail story files in each skin: Refined 12 of 12 stories passed, Instrument 12 of 12. The runner's pinned Chromium build
is not installed on this box, so it ran on the Chromium the console's browser suite uses, through a temporary browsers
folder in the session's temp root.

| Guard | Mutant(s) |
|---|---|
| The head match, exact and user-only | M1 (loosened to "includes"), M2 (any turn kind), M3 (the builder's arm removed) |
| The exception and its negatives | M4 (kind), M5 (addressee), M6 (newest), M7 (none), M8 (every card open) |
| The open state | M9 (the choice ignored), M10 (the run's first prompt), M21 (drawn open not kept), M22 (a close forgotten) |
| Runs | M11 (a divider ends one), M12 (a message joins), M13 (a tool joins), M14 (never folds), M27 (priced by members), M33 (no count) |
| Stretches | M15 (a fetched card ends one), M16 (a legacy card joins), M17 (a prompt starts no turn), M18 and M34 (no count), M19 and M20 (surfacing), M26 (not priced) |
| The row barrier | M23 (run members by identity), M24 (stretch cards by identity) |
| The design system | M25 (closed priced whole), M28 (label without time), M29 and M30 (no `aria-expanded`), M31 (text not verbatim), M32 (closed draws its rows) |

Chrome, Refined and Instrument at 390px and 1280px (Phosphor): every closed line on screen is at least the tap floor and
at most one line (`--tap-min`, 44px), inside the column, with no overflow; Tab reaches the next line with a visible focus,
Enter opens a line and Space closes it; the header the reader taps stays where it was (0px moved) when its row opens and
when it closes, mid-list and at the foot; and newer mail arriving below leaves the question card the reader saw open, and
the paragraph they are reading where it was (0px).

## 6. Measurements

A 30-wake coordinator transcript (`mail-rows.browser.test.ts`'s fixture: the lane's prompt, twice in a row every fifth
wake; the inbox read; the fetch and its card; the ack; a line of prose; the last mail a question), scrolled top to bottom
in Chrome and every row summed once by what it is. "Before" is the same pass over a build of `main` at 7b0dc02ff9.

| View | Prompts before | Cards before | Stretches before | **Mail rows before** | Prompts after | Stretches after (cards inside) | **Mail rows after** |
|---|---|---|---|---|---|---|---|
| Refined, 390px | 36 rows, 14004px | 30 rows, 7007px | 60 rows, 3600px | **24611px** | 30 rows, 1800px | 30 rows, 2069px | **3869px** |
| Instrument, 390px | 36 rows, 14004px | 30 rows, 7007px | 60 rows, 3600px | **24611px** | 30 rows, 1800px | 30 rows, 2069px | **3869px** |
| Refined, 1280px | 36 rows, 6696px | 30 rows, 5188px | 60 rows, 3600px | **15484px** | 30 rows, 1800px | 30 rows, 1990px | **3790px** |
| Instrument, 1280px | 36 rows, 7524px | 30 rows, 5188px | 60 rows, 3600px | **16312px** | 30 rows, 1800px | 30 rows, 1990px | **3790px** |

The rows that are neither (the prose lines and the first divider) measured the same before and after (2018px and 1298px).
The after-stretch figure includes the one question card drawn open under its row.

## 7. Limits

- **A card drawn open by default stays open for the view** (section 3), and looks the same as the card that opens by
  default now: nothing marks an answered or superseded question (review 3737 A1, accepted as a limit). It stays open
  until the reader closes it or reloads, so a long live view can hold several open question cards.
- An open card is never sampled for the height model: the meter samples only rows with nothing expanded
  (`inOpeningForm`), and a card open by default, or kept open, has `aria-expanded="true"`. So the `mail` bucket's open
  price rests on its older samples or the nominal model, for every open card (review 3737 A5 corrected the note's earlier
  "a card the reader opened" and "one row per chat").
- A mail prompt the reader opened is priced as one line when the list re-seeds, as a tool-activity row the reader opened
  is today; a card is priced as it is drawn (section 3).
- The prompt line's time is the transcript record's time, which for a prompt absorbed mid-turn is its enqueue time
  (D-4950's note in `chatItems.ts`).
- Runs are rare in practice: a prompt is usually followed by the session's own fetch. They fold back-to-back prompts,
  such as replays of an unacked delivery or prompts typed while the last was being read.

## 8. The peer arrangement with wave 175 (run 3690)

Wave 175 holds `ChatList.tsx` (claim 6991); this wave holds the item builder, `toolActivity.ts` and the mail files (claims
6989, 6992). Agreed by mail (34661, 34674): each PR carries its own hunks in the other's held file, by consent, because
neither branch compiles the other's hunks alone; the second to land absorbs `main` and resolves. Known overlaps: the two
`transcriptOf` call sites (this wave wraps the items in `foldMailRows`, wave 175 adds `liveFrom`), and the `ui/src/index.ts`
exports. Two cautions passed to the second lander and taken: `liveFrom` must be measured on the list `foldToolActivity`
receives (after `foldMailRows`, a run being live when any of its prompts is), and a stretch's running check reads each
entry's own index (wave 175 changed this on its branch).

Fix round 1 adds one more peer leave (mail 34943): wave 175 carries a 3-line hunk of its own in this wave's claimed
`pwa/test/tool-activity.test.tsx`, which does not touch this wave's two hunks there (measured: its diff applies clean on
this branch). #3361 (wave 175's PR) was not on `main` when this round pushed, so it was pushed without it, and #3361's
worker resolves by review 3737's merge notes 1 to 4 (the live-from index measured on the folded list and accepting both
prompt kinds; its position array beside the tool entries only; mail rows' open state across a prepend, or a run keyed by
something a prepend cannot change; unique keys before the fold). This round adds to those notes: the drawn-under-row
marks live in the same memo, as `under:<card key>`, and a card's key (`mail-<toolId>`) does not change on a prepend.

## 9. Fix round 1 (review run 3737 at 5155197cc9)

The coordinator's rulings, and what changed (measured unless marked):

| Finding | Ruling | Change |
|---|---|---|
| F2 | The card that opens by default is the newest that asks something of the session shown, whatever mail follows it; a closed stretch never hides an asking card without a sign | `foldMailRows` marks `asks` and `opens` (the newest asking card); the row's count says "2 messages, 1 question" for asking cards not drawn under it (`hiddenAsks`) |
| F1 | The default card is always drawn under a closed stretch; a card drawn there earlier stays, open or closed as left; so two can show, in order; the list prices what the row draws, from one function | `underRow` replaces `surfacedOf` (and the item's `surfaced` field, so the row barrier compares one fewer field); the row marks each card it draws there (`under:<key>` in the memo); `shapeOf` reads the memo |
| A4 | A card only opened or closed in the body never appears under the row | `underRow` reads the drawn mark, never the open choice |
| A3 | A day divider ends a run | `sameDay`: a prompt on another local day ends the run, with or without a divider |
| A2 | Accepted as a limit | The note says it (section 2) and a case pins it |
| A1, A5 | Accepted as a limit; correct the note; price a kept-open card as drawn | Section 7 rewritten; `shapeOf` prices a card by `openOf`, and the meter samples a row with the reader's choices. The opening estimate keeps no choice: the memo is made fresh with the list, so at the opening it holds none (the mutant that dropped it there was equivalent, and the wiring was taken out) |
| A6, A7 | Add the guards | Cases for both halves of the run branch in `sameRow`, the run arm of the prompt count, a run's one time when its ends are the same minute, a card with no readable time, `aria-controls` on the card, and a run's member divider drawn as the chat's |
| A8 | Derive from the table, no server source change | Section 2 |
| A9 | Tighten the browser file | The measure cases assert a bound under a third of `main`'s figure and one prompt row per wake; the in-view check asserts a single prompt's line; the Tab check names its target (the stretch after the prompt line) before the key; the newer-mail case sends a newer question, since a status mail no longer moves the default |

**Mutants, round 1** (each applied alone and restored; the five jsdom files in turn, `mail-rows`, `chat-scroll`,
`tool-activity`, `same-row`, `mail-card`, one at a time; killed at the first red file):

| Mutant | Result |
|---|---|
| R1 the newest mail opens, not the newest asking card | killed |
| R2 `underRow` keeps the first card only; R3 last first; R4 any recorded choice (A4); R5 without the default card | killed, each |
| R6 the row never records a card drawn under it | killed |
| R7 `hiddenAsks` always 0; R8 counts drawn cards too; R9 the count names no question | killed, each |
| R10 the day rule removed; R11 `sameDay` always true | killed, each |
| R12 a card priced by its default only; R13 a stretch priced with no choice; R14 the meter samples with no choice | killed, each (R14 survived the first pass; a `chat-scroll` case now samples a stretch with a card the reader closed under it) |
| R15 the opening estimate with no choice | equivalent (the memo is empty at the opening); the wiring was removed |
| R16, R17 (A6) the run barrier without `sameList`, without `sameFields`; R18 (A7) `isPrompt` without the run arm | killed, each (the reviewer's survivors) |
| R19 (A7) a run's span whenever it has two prompts (the reviewer's survivor); R20 `cardTime` never null; R21 the card's `aria-controls` removed; R22 a run's divider drawn as nothing | killed, each |
| R23, R24, R25 (the accessibility fix) no space between the card's parts; none after the prompt line's title; a run's range shown with a dash again | killed, each |

**The accessibility guard, red with the fix reverted** (the coordinator's ask): with the spaces between the line's parts
and the range word reverted together, the guard alone (`-t "holds the words it shows"`) failed in both skins, 2 of 2,
naming `"▸Mail arrived3 times10:01–10:04" in "Mail arrived 3 times, 10:01 to 10:04"` and
`"▸Mail arrived10:06" in "Mail arrived, 10:06"`; restored, it passes.

**Suites on this round's code (commit 034826c219, through the runner).** The whole pwa suite once: 611 files passed,
18883 cases passed, 2 skipped, no type errors. Every file under `pwa/browser` (119), in four parts of 30, 30, 30 and 29:
parts one and two green; part three green but for `reader-frame.browser.test.ts` M8.B5 (the frame did not reach `ready`
while the test slice's memory cap killed 17 processes), and part four green but for `tool-group-fit.browser.test.ts`,
whose worker the memory cap killed mid-file (7 kills); each of those two files then ran alone, green (54 of 54 and 16 of
16). In all: 119 files, 4292 cases passed, 1 marked expected-fail, 52 skipped, none failed. The server pin: 3 of 3. The
measurements of section 6 ran again on this code and read the same, row for row (Refined and Instrument, 390px: prompts
30 rows 1800px, stretches 30 rows 2069px; 1280px: 1800px and 1990px), each now under its bound of a third of `main`'s.

## 10. Unmeasured

- The light palette in Chrome (Phosphor only was run); the stylesheet uses the same tokens in both.
- A real coordinator transcript from the fleet (the fixture is synthetic, with neutral names).
- Screen-reader speech itself: the accessible names and `aria-expanded` are pinned, not listened to.
