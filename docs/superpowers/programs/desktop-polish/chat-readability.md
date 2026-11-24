# Chat readability, part 1: one collapsed row per stretch of tool activity (desktop polish wave 168, run 3422)

The design note for wave 168, goals modification 98 (the operator, 2026-11-22). Written by its worker for the coordinator to
fold into the ledger. Part 2, loading older turns on scroll-up, is a later wave and is not started here. Each claim says
whether it was **measured** (read on the tree, or in a test run by this wave) or **inferred**.

## In short

In a tool-heavy session the transcript was mostly tool rows: Refined folded only consecutive eligible calls
(`groupToolRun`), and a failed call, a live call or an ask ended each fold, so one turn still showed many groups;
Instrument folded nothing. Now every contiguous **stretch** of tool calls within a turn reads as ONE collapsed line, in
both skins: `▸ Tool activity · 5 calls · running · 1 failed · Ran npm`. Assistant prose stays visible between the lines, in
order. Opened, a row shows exactly what the transcript showed before. Anything the reader must act on is surfaced on the
collapsed row, never only inside.

## 1. Per stretch, not per turn

| Option | What it does to chronology | Ruled |
|---|---|---|
| One disclosure per turn | Prose stays outside (the brief), so the one row must stand above prose that followed some of its calls, or below prose that preceded them: either reorders the turn | Rejected |
| **One disclosure per contiguous tool stretch within a turn** | Every item keeps its place; a turn of `prose, tools, prose, tools` reads as `prose, row, prose, row` | **Chosen** |

A stretch is a maximal run of consecutive tool entries. Anything that is not a tool entry ends it and stays visible:
assistant prose, a user prompt, a mail card (a fetched mail is something the reader reads), a background-task card, a
timestamp divider, a system row, a pending send and the working pulse. A user prompt always ends one, so a stretch never
spans two turns.

## 2. What the row shows

| Part | Source | Notes |
|---|---|---|
| `Tool activity · N calls` | `activityWords` (`pwa/src/session/toolActivity.ts`) | `1 call` / `N calls` |
| `running` | `live`: the session is working (the list's `busy`), the stretch is in the CURRENT turn (after the last user prompt), and any of its calls has no result (parallel calls finish out of order) | A resultless call of an earlier turn never reads as running |
| Flags (`waiting on you`, `1 question`, `1 failed`) | `waiting`, then `attention` counted per kind, in that order | Tinted; they never shrink |
| The newest call's summary | `toolSummary(last).sentence` | Gives way first on a narrow column |
| The wait line (`waiting for you` and the answer control) | `waiting`, on the current turn's newest row only | Open or closed |
| The first attention entry, under the closed line | `attention[0]`, drawn by the shared item renderer | Its own card, with its own controls |

**What wants the reader is the current turn's** (review 3450's fix round). The turn the session is in starts after the
last user prompt; nothing before it runs, waits or holds a live control.

**The fold reads what KIND of wait is live** (review 3478 F2; the worker's reading of the ruling, said in the round's
mail before the push). The screen hands the list `liveWaitOf(askSource(...))`:
`none`; `question`, Claude's own structured question with its words; or `other`, every kind that names no call (an
approval, a menu, the ask's review screen, an ask the pane shows unreadably, a terminal-only menu). Nothing the session
receives carries a call id, so a question's words are the only way a source identifies a call.

- **A failed call** (its result is an error), in any turn: counted, and its card drawn under the closed row.
- **The question asked now**: the wait is a `question`, and exactly one `AskUserQuestion` of the current turn with no
  result asks exactly those questions, in that order (its input read by the card's own parser, `askQuestions`, now
  exported by the design system). Its card carries Answer into the actual sheet, closed (drawn under the row) and open
  (in the body); it leads the failures.
- **No other card offers a control for the wait** (review 3478 F1). Inside a tool-activity row only the entry the fold
  singled out gets the pending state (`rowScope`, `ChatList.tsx#TranscriptRowView`), so an opened row draws no second
  Answer: a stale ask of an earlier turn, a second open ask, or an open ask while an approval is the live wait, reads
  `unanswered` with no control, opened or closed (**measured** in jsdom in both skins by counting the Answer controls on
  screen: exactly one; it was 2 and 3 on b9094fd707).
- **A live wait no card is identified as**: an `other` wait, or a `question` whose words match no open ask of the current
  turn or more than one. It is the current turn's newest row's `waiting`, and no question is counted against a call for
  it: a `waiting on you` flag and a line of the row's own, `waiting for you` with the transcript's control (`Answer`, or
  `Go to the prompt` with the answer surface below the transcript at a desk), drawn open or closed, sending nothing (the
  tool card's ONE CONTROL rule). With no row in the current turn yet (a new prompt before its first call), the
  transcript draws none; the session's own surfaces (the sheet, the inline card, the header) carry it.
- One live wait is drawn once: the question's card, or the wait line, never both, and never a card beside either.
- **Nothing of an earlier turn reads as running** (review 3478 F4). A stretch before the last prompt is `past`, and its
  calls are drawn `settled`: a call with no result shows no breathing dot, no clock and, opened, `no result recorded`
  (the tool card's new `settled` prop). A current turn's resultless call still runs as before.

A failed call and an open question no longer end a stretch (they ended a `groupToolRun` fold, and still do inside an
opened row): they sit inside it in order.

## 3. Expansion and scroll

- Collapsed by default. The open choice lives in the list (`ExpansionMemo`, held in state by `useExpansionMemo`,
  `transcriptRow.tsx`), keyed by the row's key, `activity-<first entry's key>`, which does not move while the stretch
  grows. It outlives virtuoso unmounting the row and ends with the session view (a fresh memo when the session id changes).
- Nothing opens a row on its own: calls arriving in a closed stretch change its words, not its state.
- An append into the newest stretch adds no list item, so no index virtuoso was handed moves (**measured** in jsdom by the
  keys and scroll calls the list was handed, and in Chrome by the row in view and the scroll position, below).
- **A height change no new item explains** (review 3450 F5, review 3478 F5 and F6) is decided by the pure `heightMove`
  (`pwa/src/session/footFollow.ts`) and acted on by the list's `onHeight`:
  - `foot`: the reader was at the foot of the list as it stood before the change (within the pill's band, **measured**
    from the scroller, and the list's own flag agreeing), so the list goes back to it. An append adds no item, so
    `followOutput` never fired: a failure card surfacing under a closed live row had left a reader at the foot 50px above
    it, inside the pill's band, where no pill showed (measured in Chrome before review 3450's fix).
  - `hold`: the reader was anywhere else, so the item at the top of their view is put back where they last saw it, a
    frame later, after virtuoso's own correction (which scrolls, and so re-reads it), so nothing is corrected twice.
    Virtuoso did not move the view for a row above it that grew: a failure card surfacing under a closed row 258px above
    the reader moved everything they were reading down by its 50px (**measured** in Chrome on b9094fd707, both skins, 390
    and 1280).
  - `none`: the reader caused the change by opening or closing a disclosure in the list (anything with `aria-expanded`: a
    tool-activity row, a run group, a card), timed by a click listener on the scroller, within `TAP_SETTLE_MS` (600ms).
    Nothing moves: the header they tapped stays where it was, and what opened grows downward under it, as every
    disclosure did before the fold. On b9094fd707 opening a stretch taller than the view at the foot threw the tapped
    header 1875-2218px up out of view (**measured**).
- **Measured after this round, in Chrome, both skins, 390 and 1280** (`browser/tool-activity.browser.test.ts`): opening
  a 1879-2266px stretch at the foot leaves its header at the same pixel; an opened live row that grows at the foot (Refined
  +52px, Instrument +216px) and a surfaced failure card (+50px) leave the reader 0-1px from the foot; a reader 499-535px
  above the foot keeps the row in view at the same place (within 1px) while the list grows 106-162px below them, and is
  not taken to the foot; a row above the reader that grows by 50px moves the card in view by at most 1px.
- **Correcting what this note claimed after review 3450** (review 3478 F5-F7): the mid-list case then proved nothing grew
  while the reader was mid-list (the growing row was likely not mounted), and Refined's "opened row changes size" case
  measured a 54px shrink, which a browser clamps at the foot with no follow at all, so it stayed green with the follow
  deleted (the reviewer's measurement). "Red before the foot follow" held for Instrument's opened case and the closed
  failure case only. The cases are now signed and guarded: the Refined opened row grows, the mid-list case asserts the
  list's height changed, and each is shown red by a mutant below.

## 4. Rings and the skin contract

| Piece | Ring | Where |
|---|---|---|
| `foldToolActivity`, `activityWords`, `waitWord`, `waitControlWord` | L1, pure | `pwa/src/session/toolActivity.ts`, beside `toolSummary.ts` |
| `RunItem` (what `groupToolRun` returns) | L1 type | `toolSummary.ts` |
| `TranscriptItem`, widened with the activity row | L1 type | `toolActivity.ts`, so the two L1 modules import one way (`toolActivity` reads `toolSummary`, never the reverse) |
| `SkinSet.toolActivity: 'stretches' \| 'none'` | data | `pwa/src/skins/types.ts`; both sets say `'stretches'` |
| `transcriptOf`, the one place both folds are applied, before virtuoso | L4 | `ChatList.tsx` |
| `ToolActivityRow`, shared by both skins | L4 | `pwa/src/session/ToolActivityRow.tsx`; Refined's row part draws it for a `tool-activity` item, the frame draws it where a set has no row part (Instrument) |
| `renderRow`, `expansion`, `answer` on the row context | L4 | `transcriptRow.tsx`: an opened row draws its rows back through the set's own row part, so Refined's groups are its own |
| The row barrier compares an activity row element by element | L1 | `sameRow.ts` |
| A height bucket of its own, `activity` (one line, a line for the wait, and the surfaced card's lines) | L1 | `itemHeight.ts`, `ChatList.tsx#shapeOf` |
| `heightMove`, `holdShift`: what the list does on a height change | L1, pure | `pwa/src/session/footFollow.ts` (review 3478 A8) |
| `onHeight`, the anchor read on scroll, the tap timing: measuring and acting | L4 | `ChatList.tsx`, beside the settle re-pin it shares the pinned flag with |
| `liveWaitOf`, `waitKey`, `waitOf`, `rowScope` | L1, pure | `toolActivity.ts`; the screen computes the wait once (`SessionScreen.tsx`, from `askSource`, the one decider) |
| `ToolCard`'s `settled`, `NO_RESULT_WORD`, `askQuestions` exported | design system | `ui/src/components/tool-card.tsx`: the card's one parser of an ask's questions, read by the fold rather than copied |

The existing `'tool-runs'` path is extended, not forked: `groupToolRun` is unchanged and runs inside each row. No server
change.

## 5. Tests

| Guard | File | Basis |
|---|---|---|
| One row per stretch over a 14-turn fixture (prose and tools mixed, a failed call, an answered question, a stale unanswered ask, the question asked now); the unfolded list is `buildChatItems`' list exactly; prose never inside | `pwa/test/tool-activity.test.tsx` | Measured |
| The question asked now surfaced and leading failures, never a stale one; no card named for an approval, parallel calls (out-of-order results, running while an earlier call lacks its result), an all-answered turn or two open asks, the wait on the newest current row only; a new prompt before its first call leaves the last turn quiet; running only while busy; key stable; inner grouping per skin | same | Measured |
| Both skins: closed rows, the surfaced cards, the question's Answer closed and open (drawn once), the wait line and its control closed and open, `Go to the prompt` below, gone with no wait and after a new prompt; expansion kept across unmount and remount and forgotten on another session; an append into an open row keeps it open and shows the calls; an append into a closed one moves no key and scrolls nothing; the foot follow and its measured guard; the spoken name, `aria-controls`, the wait line priced | same | Measured, 47 cases green after review 3478's round |
| The row barrier: a freshly built row over the same events is the same row; a changed live state, wait, surfaced entry, call, open question or inner grouping is a new row | `pwa/test/same-row.test.ts` | Measured, 12 green (with review 3478's `past` case) |
| The run fold itself, with the activity fold off | `pwa/test/transcript-rows.test.tsx` | Measured, 8 green |
| Chrome, both skins, both palettes, 390 and 1280: one line, failed surfaced, no loose cards, append while scrolled up moves nothing, opened row holds the column, open state survives scrolling away and back | `pwa/browser/tool-activity.browser.test.ts` | Measured locally, 8 green |
| Chrome, both skins, both palettes, 360 and 390: a running row with `waiting on you` and `1 failed` and its wait line, no overflow of the row or the column, neither flag cut (both flags 20-90px inside the row's edge, measured) | same | Measured locally, 8 green |
| Chrome, both skins, 390 and 1280: the live row changing size opened, a failure surfacing closed, and the same while the reader is mid-list (the numbers in section 3) | same | Measured locally, 4 green; see section 3 for what review 3478 corrected |
| Refined's opened groups hold the column, with the activity rows opened first | `pwa/browser/tool-group-fit.browser.test.ts` | Measured locally, 16 green |
| Checks that expand a tool card or read an answered question's chip, now opening the stretch's activity row first: the well colour check (red in all 16 views after round 1, which no CI run had caught) and the wheel checks' `openCard` and `reveal` (`browser/wheel.ts`) | `tool-well-colour`, `wheel-chain`, `wheel-chain-well`, `wheel-chain-chip` | Measured locally: 16, 40, 508 (12 skipped), 16 green |

**The browser shards of a pull request skip their tests** (a fast pull request leaves them to the merge queue), so every
Chrome count above was run on the worker's box, through the fleet test slice, against the production build; the merge
queue runs them again.

**Red first, measured by mutation.** The new test file was written after the decider, so its red is shown by mutants, not
by commit order: 23 hand-applied mutants (each applied, `tool-activity.test.tsx` run, the file restored) were all killed:
failed, question and approval not surfaced; approval without a live dialog; a failed call ending the stretch; the key
following the newest entry; every resultless stretch running; running while idle; failures leading blocking entries; no
run grouping inside; the expansion not remembered; open by default; nothing surfaced while collapsed; no approval control;
a live stretch opening itself; `ChatList` not folding; a fresh memo every render; the memo kept across a session change;
the row priced without its card; the approval line not priced; no `activity` bucket; `aria-controls` naming a missing
body; the row's words running together. One mutant first survived (the memo kept across a session change); the case that
kills it was added in the review round. Review 3450's fix round replaced the fold's live and wait rules, so the mutants
on the lines it rewrote were re-made against the new code: 24 more, all killed (`tool-activity.test.tsx` and
`same-row.test.ts`): a stale ask read as asked now; the first of two open asks named; the turn never starting; running
ignoring the turn, needing the newest call to be resultless, or running while idle; every current row waiting, or every
row from the newest call's; a named question also waiting; failures leading the question; a failure not surfaced; no
waiting flag; the wait line only while closed; no wait control; the card drawn twice when open; the wait line not priced;
the barrier's activity arm deleted, or skipping `live`, `waiting`, `attention` or `inner`; no foot follow; the follow
without the measured foot; the follow for a reader who scrolled up. Two first survived: an equivalent one (the wait's
turn check, which no stretch can fail because none spans a prompt, so the check was removed) and the barrier skipping
`attention` and `inner`, which two cases added to `same-row.test.ts` now kill.

**Review.** One per-task review (Sonnet) found nothing breaking a requirement and five low findings, all taken: running
only while the session works; the memo held in state rather than `useMemo`; the approval line priced; `aria-controls` only
while the body exists, and the spoken name word by word; and the type-only import cycle between the two L1 modules
removed.

**Review 3478's round** (the coordinator's rulings of 2026-11-24): F1 and F4 in scope, F2 fixed (not a limit), F5 the
follow ignores a reader's tap, A8 the decision pure. New and changed cases, each shown red on b9094fd707 first, by test or
by mutant:

| Guard | File | Basis |
|---|---|---|
| F3: opening the stale ask's row, then every row, with the question asked now live: exactly one Answer on screen; two open asks, the wait `other` or naming one: exactly one, closed and opened | `tool-activity.test.tsx`, both skins | Red on the tip (2 and 3 controls); green |
| F2: an open ask while an approval is the live wait: no question counted, one control, on the wait line, none on the ask card, closed and opened | same | Red on the tip; green |
| F4: an opened earlier turn's resultless call: no breathing dot, no clock, `no result recorded`; the current turn's still runs | same | Red on the tip; green |
| The wait kind: every `askSource` kind mapped; the key tells words apart; a call matched by every question, in order, and not by fewer | same | Green; mutants below |
| A2: a divider, a mail card, a task card, a system row and a pending send each end a stretch | same | Green on the tip too (it held by construction); pinned now |
| The barrier: a row whose turn ended (`past`) is a new row | `same-row.test.ts` | Green; mutant below |
| `heightMove` and `holdShift` | `foot-follow.test.ts` | New module; mutants below |
| F5: opening a stretch taller than the view at the foot leaves the tapped header where it was (within 1px) | `tool-activity.browser.test.ts`, both skins, 390 and 1280 | Red on the tip (1875-2218px); green |
| F6: the mid-list case asserts the list grew while the reader was 499-535px up; a row above the reader that grows moves nothing they read | same | The second red on the tip (50px); green |
| F7: Refined's opened row grows at the foot, `> 0` | same | Green; red with the foot move removed (mutant below) |
| A3: the wait control at 360 and 390, both skins, both palettes: inside the column, uncut, 44px against the 44px tap minimum, reached by Tab from the row with a visible ring and the name `Answer` (measured with the approval's sheet closed: at a phone's width the sheet opens over the transcript, which the app hides from assistive technology behind it) | same | Green; mutant below |

Mutants of this round, all killed: any wait naming the one open ask; a question naming any open ask, words unread; words
matched without their count, or in any order; every card in a row given the pending state; a past row's calls not
settled; no stretch past; the card ignoring `settled`, or keeping its clock; the barrier skipping `past`; a tap not the
reader's; nothing held; the foot without the measure; the foot for a reader who left; rounding taken as a move; the wait
keyed by its kind only; a structured question naming no call; the list folding by `askPending` alone; the wait line drawn
beside a named question (19, `tool-activity.test.tsx`, `same-row.test.ts`, `foot-follow.test.ts`). One first survived
(words matched without their count); the case of a call asking fewer questions than the wait kills it. In Chrome
(`tool-activity.browser.test.ts`, each mutant built into its own production bundle): no move to the foot (the four
"opened, calls arrive" cases red, Refined at 1280 among them, which the shrink had let through before); a tap not the
reader's, and no tap seen (the four F5 cases red); the hold putting nothing back (the four F6 cases red). One is
equivalent: the wait control without its `FOCUS_RING` class still draws the same 2px solid ring, from base.css's
`:focus-visible` rule, so A3's ring check (solid, at least 2px, never the browser's default) stays green.

**What else this round changed in the tests.** `ask-inline.browser.test.ts` drew its live ask call with fixed words
(`Which cache should the service use?`) beside a live question in other words, an unreadable or unparsed menu, or an
approval: under F2 no such call is identified, so its card no longer offers "Go to question", and 32 of the file's cases
went red in the first browser run of this round. The fixture now gives the call the live question's own words (the hook
envelope's questions, else the pane's transcript copy), and the cases whose wait names no call raise it from the wait
line's "Go to the prompt", the same raise. No assertion was dropped: the R64 case also pins that the card carries "Go to
question" when its words are the live ones. The first full unit run of the round was red too: the dot's class string,
written as a conditional, read as a new hook class to the two design-system boundary censuses; it is the original
template again.

**Browser evidence, this round, local Chrome over the production build** (the pull request's browser shards skip their
tests; the merge queue runs them): `tool-activity` 28; `ask-inline` 500 (12 skipped); `tool-group-fit`, `tool-well-colour`,
`wheel-chain`, `wheel-chain-chip`, `compaction-fold`, `frame-cost` and `inspector-hide` 121 (1 expected fail, 40
skipped); `wheel-chain-well` 8; `ask-surface`, `chat-colour`, `chat-width`, `chat-links`, `instrument-desk`, `row-fit`,
`sheet-stack-hide`, `helpers-rail` and `session-header` 374. All green.

**Review 3450** (three Opus lenses, Sonnet refuters) confirmed seven findings; the fix round took them all as the
coordinator ruled: F1, F2, F3 and F6 by the current-turn rules and the wait line above; F4 by the row's details giving way
to its flags (title, then count and state, cut with an ellipsis; the flags and the wait control never shrink), measured
at 360; F5 by the foot follow, measured; F7 by the barrier's cases. Advisories A3, A5 and A7 are covered by the cases
above; A1 and A6 are gone with the new rules; A4 is carried as a limit (section 7), and A2, carried then, is pinned since review 3478's round.

**Census registrations** (measured green): the seven new colour rules are grounded on `--bg-page` in `pwa/design/audit.mjs`
(the `.msg-plain-note` reasoning); the two type roles in `role-census.test.ts`; the two buttons in `control-census.test.ts`.

## 6. Screenshots (described)

Taken in Chrome over the production build, over the browser test's fixture (24 turns, the last stretch with a failed call):

- Refined, dark, 1280: the transcript reads as prose turns with one mono line between them, `▸ Tool activity · 3 calls
  Edited a23.ts`; the last line carries an amber `1 failed` flag, and the failed `Bash npm test` card sits under it.
- Instrument, light, 390: the same rhythm on a phone; every line fits the column with its flag and summary.
- Refined, light, 390, the last row opened: the chevron turns, the row's summary is cut with an ellipsis, and the opened
  body shows Refined's `Read last.ts` group and the failed card one step in from the row.

## 7. Known limits

- A user message absorbed mid-turn (typed while the session works) starts the current turn as far as the transcript can
  tell, so a call still running from before it reads as not running until its result arrives.
- A live wait no card is identified as is said on the current turn's newest row, not on a call; with no row in the
  current turn yet it is not in the transcript at all (the session's sheet, inline card and header carry it).
- An answered question folds into its row with the other calls; only the question asked now is surfaced.
- Only the first attention entry is drawn under a closed row; the rest are counted on it.
- The expansion memory is per session view, by design: leaving the session forgets it. Only the outer row's state is kept
  across a virtual unmount: Refined's inner run groups and the tool cards' own disclosures inside an opened row keep local
  state, so a remounted open row shows them closed (review 3450 A4, carried).
- A height change within 600ms of the reader's tap on a disclosure is taken as theirs: a call arriving in that moment is
  neither followed at the foot nor held, and the next change nobody tapped for is acted on again from where the reader
  then is.
- A question is tied to its call by its words: two open asks of one turn asking exactly the same questions single out
  neither (the wait line carries the control). While the pane is on the ask's review screen the wait is `other`, so the
  question's card shows no control and the wait line carries it.
- The hold keeps the item at the top of the view in place; a change inside that item above the reader's line (a card
  opening within an opened stretch, by something other than a tap) is not compensated.
- Per-call failed and live are re-derived in `toolActivity.ts` beside `toolSummary.ts`'s own (review 3478 A5): the two
  agree today; one owner is the follow-up.
- Two arms of the row barrier (`sameList(entries)`, the attention kind) are redundant with `inner` and the attention
  entry, so removing either leaves `same-row.test.ts` green (review 3478 A6): no correctness defect, recorded.
- The run-fold cases of `transcript-rows.test.tsx` mount sets with `toolActivity: 'none'`, which no skin ships, so
  `restoreStateFrom`'s seeded ranges are not pinned against the activity-folded list on the shipped path (review 3478 A7).
- The full pwa suite runs past the fleet test slice's memory cap in one go, so it is run in chunks.
