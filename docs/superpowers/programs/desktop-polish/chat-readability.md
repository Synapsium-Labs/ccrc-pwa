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

- **A failed call** (its result is an error), in any turn: counted, and its card drawn under the closed row.
- **The question asked now**: the current turn's only `AskUserQuestion` with no result, while the session holds a live ask
  or dialog (`askPending`, from `askSource`). Its card carries Answer into the actual sheet, closed (drawn under the row)
  and open (in the body); it leads the failures. A resultless ask of an earlier turn, or one with no live wait, is not
  asked now: no flag and no card; opened, its card reads unanswered as before.
- **A live wait no card is identified as**: `askPending` says the session waits, not on which call. An approval names a
  tool, never a call (the hook's envelope is `{tool, summary}`), so no card is inferred for it, nor for a menu, two open
  asks, or a wait whose calls all have results. It is the current turn's newest row's `waiting`: a `waiting on you` flag
  and a line of the row's own, `waiting for you` with the transcript's control (`Answer`, or `Go to the prompt` with the
  answer surface below the transcript at a desk), drawn open or closed, sending nothing (the tool card's ONE CONTROL rule).
  With no row in the current turn yet (a new prompt before its first call), the transcript draws none; the session's own
  surfaces (the sheet, the inline card, the header) carry it.
- One live wait is drawn once: the question's card, or the wait line, never both.

A failed call and an open question no longer end a stretch (they ended a `groupToolRun` fold, and still do inside an
opened row): they sit inside it in order.

## 3. Expansion and scroll

- Collapsed by default. The open choice lives in the list (`ExpansionMemo`, held in state by `useExpansionMemo`,
  `transcriptRow.tsx`), keyed by the row's key, `activity-<first entry's key>`, which does not move while the stretch
  grows. It outlives virtuoso unmounting the row and ends with the session view (a fresh memo when the session id changes).
- Nothing opens a row on its own: calls arriving in a closed stretch change its words, not its state.
- An append into the newest stretch adds no list item, so no index virtuoso was handed moves (**measured** in jsdom by the
  keys and scroll calls the list was handed, and in Chrome by the row in view and the scroll position, below).
- **A reader at the foot follows a row that changes size there** (review 3450 F5). An append adds no item, so
  `followOutput` never fired: a failure card surfacing under a closed live row left a reader at the foot 50px above it,
  inside the pill's band, so no pill showed (**measured** in Chrome, Instrument at 390 and 1280 and Refined at 390,
  before the fix). The list now goes back to the foot on a height change when the reader was at the foot of the list as
  it stood before the change, **measured** from the scroller, never remembered: the pinned flag alone pulled a reader
  who jumped up the list straight back down (measured too). After the fix, in both skins at 390 and 1280: an opened live
  row that changes size (Refined's shrinks 54px as the answered call joins its run group, Instrument's grows 216px) and a
  surfaced failure card (+50px) leave the reader 0-1px from the foot, and a reader in the middle keeps the row in view at
  the same place.

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
| The foot follow on a height change (`onHeight`) | L4 | `ChatList.tsx`, beside the settle re-pin it shares the pinned flag with |

The existing `'tool-runs'` path is extended, not forked: `groupToolRun` is unchanged and runs inside each row. No server
change.

## 5. Tests

| Guard | File | Basis |
|---|---|---|
| One row per stretch over a 14-turn fixture (prose and tools mixed, a failed call, an answered question, a stale unanswered ask, the question asked now); the unfolded list is `buildChatItems`' list exactly; prose never inside | `pwa/test/tool-activity.test.tsx` | Measured |
| The question asked now surfaced and leading failures, never a stale one; no card named for an approval, parallel calls (out-of-order results, running while an earlier call lacks its result), an all-answered turn or two open asks, the wait on the newest current row only; a new prompt before its first call leaves the last turn quiet; running only while busy; key stable; inner grouping per skin | same | Measured |
| Both skins: closed rows, the surfaced cards, the question's Answer closed and open (drawn once), the wait line and its control closed and open, `Go to the prompt` below, gone with no wait and after a new prompt; expansion kept across unmount and remount and forgotten on another session; an append into an open row keeps it open and shows the calls; an append into a closed one moves no key and scrolls nothing; the foot follow and its measured guard; the spoken name, `aria-controls`, the wait line priced | same | Measured, 34 cases green |
| The row barrier: a freshly built row over the same events is the same row; a changed live state, wait, surfaced entry, call, open question or inner grouping is a new row | `pwa/test/same-row.test.ts` | Measured, 12 green |
| The run fold itself, with the activity fold off | `pwa/test/transcript-rows.test.tsx` | Measured, 8 green |
| Chrome, both skins, both palettes, 390 and 1280: one line, failed surfaced, no loose cards, append while scrolled up moves nothing, opened row holds the column, open state survives scrolling away and back | `pwa/browser/tool-activity.browser.test.ts` | Measured locally, 8 green |
| Chrome, both skins, both palettes, 360 and 390: a running row with `waiting on you` and `1 failed` and its wait line, no overflow of the row or the column, neither flag cut (both flags 20-90px inside the row's edge, measured) | same | Measured locally, 8 green |
| Chrome, both skins, 390 and 1280: the live row changing size opened, a failure surfacing closed, and the same while the reader is mid-list (the numbers in section 3) | same | Measured locally, 4 green; red before the foot follow |
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

**Review 3450** (three Opus lenses, Sonnet refuters) confirmed seven findings; the fix round took them all as the
coordinator ruled: F1, F2, F3 and F6 by the current-turn rules and the wait line above; F4 by the row's details giving way
to its flags (title, then count and state, cut with an ellipsis; the flags and the wait control never shrink), measured
at 360; F5 by the foot follow, measured; F7 by the barrier's cases. Advisories A3, A5 and A7 are covered by the cases
above; A1 and A6 are gone with the new rules; A2 and A4 are carried as limits (section 7).

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
- The fixtures end a stretch at user and assistant prose; that a divider, a mail or task card, a system row or a pending
  send ends one too holds by construction (anything but a tool entry closes it) and is not pinned by a case of its own
  (review 3450 A2, carried).
- The full pwa suite runs past the fleet test slice's memory cap in one go, so it is run in chunks.
