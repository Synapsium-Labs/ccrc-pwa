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
| `running` | `live`: the stretch is the newest one and holds a call with no result | An older resultless call (an interrupted one) never reads as running |
| Attention flags (`1 failed`, `1 question`, `1 waiting on you`) | `attention`, counted per kind in that fixed order | Drawn as tinted flags |
| The newest call's summary | `toolSummary(last).sentence` | Cut first on a narrow column |
| The first attention entry, under the collapsed line | `attention[0]`, drawn by the shared item renderer | Its own card, with its own controls |

**What wants the reader** (`attentionOf`): a call whose result is an error (`failed`); an `AskUserQuestion` with no result
(`question`, its card carries Answer); and the newest tool entry while it has no result and the session holds a live ask or
dialog (`askPending`, from `askSource`) and it is not an ask (`approval`). An approval's own card has no control, so the
row adds the transcript's: `Answer` (raises the sheet), or `Go to approval` when the answer surface is mounted below the
transcript at a desk. Neither sends anything (the tool card's ONE CONTROL rule). Blocking entries (questions, approvals)
lead failures, so the one the reader must act on now is never behind an older failure.

A failed call, an open question and an approval no longer end a stretch (they ended a `groupToolRun` fold, and still do
inside an opened row): they sit inside it in order, and they are surfaced.

## 3. Expansion and scroll

- Collapsed by default. The open choice lives in the list (`ExpansionMemo`, `transcriptRow.tsx`), keyed by the row's key,
  `activity-<first entry's key>`, which does not move while the stretch grows. It outlives virtuoso unmounting the row and
  ends with the session view (a new memo per session id).
- Nothing opens a row on its own: calls arriving in a closed stretch change its words, not its state.
- An append into the newest stretch adds no list item, so no index virtuoso was handed moves (**measured** in jsdom by the
  keys and scroll calls the list was handed, and in Chrome by the row in view and the scroll position, below).
- Opening the newest row at the bottom grows the list below the viewport, so Jump to latest shows, as it does for Refined's
  run groups today (**measured** in a screenshot; inherited behaviour, unchanged).

## 4. Rings and the skin contract

| Piece | Ring | Where |
|---|---|---|
| `foldToolActivity`, `activityWords`, `approvalControlWord` | L1, pure | `pwa/src/session/toolActivity.ts`, beside `toolSummary.ts` |
| `RunItem` (what `groupToolRun` returns) and the widened `TranscriptItem` | L1 types | `toolSummary.ts` |
| `SkinSet.toolActivity: 'stretches' \| 'none'` | data | `pwa/src/skins/types.ts`; both sets say `'stretches'` |
| `transcriptOf`, the one place both folds are applied, before virtuoso | L4 | `ChatList.tsx` |
| `ToolActivityRow`, shared by both skins | L4 | `pwa/src/session/ToolActivityRow.tsx`; Refined's row part draws it for a `tool-activity` item, the frame draws it where a set has no row part (Instrument) |
| `renderRow`, `expansion`, `answer` on the row context | L4 | `transcriptRow.tsx`: an opened row draws its rows back through the set's own row part, so Refined's groups are its own |
| The row barrier compares an activity row element by element | L1 | `sameRow.ts` |
| A height bucket of its own, `activity` (one line plus the surfaced card's lines) | L1 | `itemHeight.ts`, `ChatList.tsx#shapeOf` |

The existing `'tool-runs'` path is extended, not forked: `groupToolRun` is unchanged and runs inside each row. No server
change.

## 5. Tests

| Guard | File | Basis |
|---|---|---|
| One row per stretch over a 14-turn fixture (prose and tools mixed, a failed call, an answered and an open question, an approval); the unfolded list is `buildChatItems`' list exactly; prose never inside | `pwa/test/tool-activity.test.tsx` | Measured |
| Failed, question and approval surfaced, counted and ordered; approval only with `askPending` and only on the newest call; running only on the newest stretch; key stable as a stretch grows; inner grouping per skin | same | Measured |
| Both skins: collapsed rows, the surfaced cards, Answer and Go to approval call `onAnswer`, open in place, expansion kept across unmount and remount, an append moves no key and scrolls nothing | same | Measured, 25 cases green |
| The run fold itself, with the activity fold off | `pwa/test/transcript-rows.test.tsx` | Measured, 8 green |
| Chrome, both skins, both palettes, 390 and 1280: one line, failed surfaced, no loose cards, append while scrolled up moves nothing, opened row holds the column, open state survives scrolling away and back | `pwa/browser/tool-activity.browser.test.ts` | Measured, 8 green |
| Refined's opened groups hold the column, with the activity rows opened first | `pwa/browser/tool-group-fit.browser.test.ts` | Measured, 16 green |

**Red first, measured by mutation.** The new test file was written after the decider, so its red is shown by mutants, not
by commit order: 18 hand-applied mutants (each applied, `tool-activity.test.tsx` run, the file restored) were all killed:
failed, question and approval not surfaced; approval without a live dialog; a failed call ending the stretch; the key
following the newest entry; every resultless stretch running; failures leading blocking entries; no run grouping inside;
the expansion not remembered; open by default; nothing surfaced while collapsed; no approval control; a live stretch
opening itself; `ChatList` not folding; a fresh memo every render; the row priced without its card; no `activity` bucket.

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

- `askPending` is session-wide, so the approval is attributed to the newest resultless call; a dialog that belongs to no
  tool call (a scraped menu) marks that call as waiting too.
- An answered question folds into its row with the other calls; only an open one is surfaced.
- Only the first attention entry is drawn under a collapsed row; the rest are counted on it.
- The expansion memory is per session view, by design: leaving the session forgets it.
- The full pwa suite runs past the fleet test slice's memory cap in one go, so it was run in chunks (all green; one file
  per chunk lost its worker to the cap and did not report, so CI is the arbiter for those).
