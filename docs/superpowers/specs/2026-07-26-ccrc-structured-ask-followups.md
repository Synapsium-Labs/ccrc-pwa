# ccrc structured questions — what shipped, and what did not

Companion to the [spec](2026-07-26-ccrc-structured-ask-design.md) and
[plan](../plans/2026-07-26-ccrc-structured-ask.md). Every Critical and Important
finding raised against this branch was fixed and independently re-verified. What
follows is the Minor residue, so it survives outside a workflow transcript.

## The two defects worth remembering

**A mid-redraw capture could label a row with an answer it does not send.** The
pane scraper fills a not-yet-repainted option row with the TUI's own trailing row
("Chat about this"), `alignAsk`'s one-miss tolerance for `n >= 4` accepted the
match, and the sheet then rendered that row with the transcript's copy — in the
reproduction, `Roll back the migration entirely / ABANDON THE WORK` on the row
whose keystroke selects the free-text escape hatch. `n >= 4` is 19% of real asks.
The keystroke was never wrong; the copy the reader *chooses by* was. Alignment now
reports per position, a position the server could not confirm ships `null`, and
the row keeps the pane's own label with no preview. The wire type is
`(AskOption | null)[]`.

**The safety property had no test.** "Enrichment rides alongside the scraped
options and never rewrites them" is what makes this feature safe, and a mutation
that rewrote every label *and* corrupted `selectedIndex` passed all 252 server
tests. `Dialog.id` is hashed inside `parseDialog` **before** enrichment, so the
existing "same id with and without ask" test structurally cannot catch a
post-parse rewrite. Now pinned by comparing the whole options array, and
`selectedIndex`, between an enriched and unenriched run of the identical pane.

## Open — worth doing

**`alignAsk` does not skip `multiSelect: true` questions.** The spec puts them out
of scope because the pane returns them `unparsed` — but that only covers the case
where the multiSelect question *is* the on-screen menu. In a multi-question ask
(152 of 817 real asks) where question 1 is single-select and question 2 is
multiSelect, both are returned and the multiSelect one can win alignment on a
prefix match, so Space-to-select options get presented as if one Enter answered
them. `questions.filter(q => !q.multiSelect && …)` closes the class.

**A whitespace-only transcript label blanks a valid row.** `question` and
`description` got a `.trim() ||` guard; `const label = rich?.label ?? o.label`
did not, so an all-whitespace label yields an unlabelled 52px tap target.

**`AskOutcome` states "no answer" as fact** whenever `askAnswers` fails to parse.
That parse is a hand-rolled scrape of unversioned harness prose, so an upstream
wording change would relabel every answered ask in every transcript as
unanswered. Neutral copy, or falling back to the generic card on a non-error
unparseable result, removes the false claim. Related: `ANSWER_TAIL` is a
leftmost match despite a comment claiming it anchors at the end, so a free-text
answer containing "you can now continue" truncates.

**An open ask has no living-state affordance.** `AskCard` with no result renders
identically to a settled one — the generic card it replaced had a breathing dot
and an elapsed clock, which `DIRECTION.md` reserves for exactly this. Scrolling
back, the one thing in the transcript that owes the reader an action is
indistinguishable from history.

**An open preview follows the wrong row once the cursor moves.** `defaultOpen` is
read only at mount and the fragment key deliberately excludes `selectedIndex`, so
after an arrow-walk the ❯ row can show a folded preview while an unselected row
shows an open one.

## Open — tests that cannot fail

Each verified by mutation: the change was applied, the suite stayed green.

- `readPendingAsk`: deleting the empty-label guard, deleting the
  `name === 'AskUserQuestion'` filter, hard-coding `multiSelect: false`, or
  deleting the partial-first-line `lines.shift()` all leave 6/6 passing. The tail
  convention the module is built around is never exercised — every fixture is far
  under the 256 KB read.
- `alignAsk`: replacing `norm` with the identity function, or dropping its
  case-fold or whitespace collapse, changes nothing — every label in the suite
  compares byte-identically. The `n === 0` guard is likewise unpinned, though
  `parseQuestions` really does admit `options: []`.
- `dialog-sheet.test.tsx` "answers with the pane index even when the transcript
  relabels the row" clicks a row whose two labels are byte-identical, so it
  passes on an implementation that looks the index up by matching text — the
  exact bug it is named for.
- The fold-reset test fabricates `d1 -> d2` while keeping the labels and title
  that actually derive the id, a transition production ids cannot produce that
  way. Two consecutive asks with the same option labels under the same title
  share an id, and the previous question's fold state carries over.
- The `!result.isError` guard has no regression test; deleting it stays green.
- The `/model-confirm` fixture declines enrichment on an option-count mismatch,
  so it never reaches a label comparison — if 2-option strictness regressed from
  `miss === 0` to `miss <= 1` it would still pass.

## Deliberately left

`.dlg-header-chip` clears AA by **0.08** in the light theme (#0E7B3F on #DFF2E5 =
4.58:1, floor 4.5). It is now measured by the gate rather than invisible to it —
78 pairs, up from 74 — so `--accent-tint` is effectively pinned: any nudge fails
the build rather than silently dropping below AA.

`chat.css` carries `letter-spacing: var(--tracking-caps)` on the lowercase
"preview" toggle and a dead `overflow-wrap: normal` under `white-space: pre`.

## What the browser actually measured

The layout guards were verified by rendering the **real** `DialogSheet` through
the project's harness, dumping the shipped DOM, and measuring it under the
production CSS bundle plus vaul's runtime stylesheet — the before/after pages
differing by exactly four stripped declarations. Reachability was proven by
setting `scrollTop` and re-measuring, never assumed.

| case, 360x640 | before | after |
|---|---|---|
| 80-char unbroken token in the question | 490px hidden | 0 clipped, wraps to 3 lines |
| 391-char token | 4093px hidden | 0 clipped, capped, all rows reachable |
| 45-char unbroken header chip | 33px clipped | 0 clipped, wraps, keeps its line-height |
| ~600-char question | rows reachable, opt1 at y=462 | title capped at exactly 38vh, opt1 at y=366 |
| short question (the common case) | — | probe JSON **byte-identical** to before |

One correction to the record: the "options unreachable" half of that finding was
already closed before this pass, by moving the title inside `.sheet-body`. The
38vh cap that followed buys above-the-fold position, not rescue from
unreachability — at 600 chars the rows were reachable either way.
