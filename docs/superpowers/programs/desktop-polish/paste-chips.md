# Wave 169: compact paste chips in the session composer

Task note for desktop-polish wave 169 (Goals modification 90, second half: long pastes show as expandable, removable
chips that keep the full text and its position in the draft). Revised in the fix rounds for reviews 3457 and 3469, and
redesigned after review 3480 on the coordinator's ruling that the field's value carries a chip's identity. The
delivery-reliability half waits on the supported capture lane (`paste-reliability.md` §5) and is not this wave: the
server's send path, the wire, the terminal, the edge-whitespace policy and the draft's lifetime are unchanged.

## 1. In short

- A text paste of **800 characters or more**, or of **more than 12 lines**, enters the draft as a chip at the caret:
  the label `[Pasted text #N +L lines]` (`+1 line` for one), numbered per draft, between two reserved invisible
  markers (U+2062 and U+2063, which draw nothing). Shorter pastes go in as before.
- **The value carries the identity.** A chip is a label wrapped in both markers whose number the draft's table holds,
  with that text's line count; anything else is ordinary text, whatever it says. The live chips are an exact parse of
  the field's current value, done after every change. Nothing is tracked between changes, so there is no position to
  place, no edit to locate and no history of drafts: an undo or redo is whatever value the browser restores, and its
  parse is the answer.
- The table keeps every pasted text, keyed by number, until the draft is sent or replaced, whether or not the field
  still shows its chip. Numbers are never reused while the draft lives.
- A chip row above the field lists each chip (number, line count, first non-blank line) with **expand** (the full text
  replaces the chip, as ordinary text) and **×** (the chip leaves the field; its text stays in the table, for an undo).
- A chip is one object to the caret and the selection: a caret never rests inside one, and a selection that touches
  part of one covers all of it before an edit applies. Backspace right after a chip, or Delete right before one, takes
  it whole.
- Sending, retry, both draft-conflict choices, copy and cut go through one expansion: each chip becomes its table
  text, then every marker is removed. Today's whole-message trim and whitespace-only guard follow, unchanged.

## 2. Where the decisions live

`pwa/src/session/pasteChips.ts` is L1 (context C3, Session Conversation), pure functions over strings:

| Function | Decides |
|---|---|
| `normalizePaste`, `shouldChip`, `lineCount` | whether a paste becomes a chip: long, or holding a marker; CR LF and a lone CR read as LF; characters counted as code points, lines as the field shows them |
| `linesWord`, `chipToken`, `chipField`, `addChip` | the label grammar (one owner for "1 line" / "N lines"), the chip as the field holds it, and the next number |
| `parseChips`, `liveChips` | the chips the value holds, the only identity there is |
| `expandValue`, `selectionText` | the one expansion: the send payload and the clipboard's text |
| `snapSelection`, `coverChips` | where a caret and a selection may rest |
| `planEdit`, `planPaste`, `expandChip`, `removeChip` | the edits a chip needs planned, performed as the browser's own |
| `strayRanges`, `removeRanges` | what an unplanned edit left behind, and its clean-up (§3) |

`Composer.tsx` holds the value and the table, performs every plan as the browser's own edit (`execCommand`), plans at a
native `beforeinput` listener (React's synthetic one carries no `inputType`) and snaps the selection on
`selectionchange`. It reads three facts only the browser has: whether an event is composing or cancelable, the range a
word delete would remove (`Selection.modify`, as before), and whether a pointer is making the selection.
`PasteChipBar.tsx` (L4) renders the row with the design system's ghost `Button` and decides nothing.

## 3. Never lose pasted text silently

- **Markers enter the field only as part of a chip.** Typed text loses any marker before it lands; a paste that holds
  one is a chip whatever its length, its text in the table untouched. A composition or a drop that brings one in is
  cleaned up after it lands (below).
- **A chip is one object.** A key that moves the caret into a chip carries it on to the far side, in the direction it
  moved; a pointer (a click, a drag) takes the nearer side; a selection whose anchor is inside a chip covers it.
  Measured in Chrome: arrows, Shift+arrows, Ctrl+arrows, Up and Down, Home and End (also with the label wrapped across
  lines in a narrow field) and clicks. An edit over a selection that still touches part of a chip (one made in the same
  task, before `selectionchange` ran) is widened to the whole chip before it applies, so a paste over it replaces whole
  chips and inserts its own new chip, and a key typed over it replaces them.
- **Planned before it lands, and only where a chip needs it** (`planEdit`): Backspace right after a chip and Delete
  right before one take it whole; a word delete (Ctrl+Backspace, Ctrl+Delete) whose range, measured by the browser,
  reaches into a chip takes the chip whole; typed text loses its markers. Line deletes and every other edit kind land as
  the browser makes them and are parsed (review 3480 F5).
- **Not scripted: an input method's composition.** Its `beforeinput` cannot be cancelled, so nothing is planned for it
  (nor for any non-cancelable or composing event), and nothing is written while it runs (a value written
  mid-composition left the input method's first character behind in Chrome, review 3469). The chip row reads the parse
  throughout, so a composition beside a chip keeps it listed. **Enter while a composition is open never sends**
  (review 3480 F6): the keydown is the input method's (`isComposing`, or key code 229).
- **Cleaned up after it lands** (`strayRanges`): a marker that is not part of a chip is removed together with the piece
  of label beside it (after a lone opening marker, the longest start of a label; before a lone closing one, the longest
  end of one, by the label grammar). So a drop into a label, or a line delete that took part of a chip, leaves the
  field showing exactly what will be sent: the broken chip is gone, the dropped or remaining text stays, and no label is
  ever sent without its text. Nothing the user removed comes back; the chip's text stays in the table, so the browser's
  undo brings the chip back. A wrapped label whose number the table does not hold, or a second copy of one, goes the
  same way. The clean-up is one more edit of the browser's own where it can be (`execCommand`), else a written value.
- **Copy and cut** of a selection holding a chip carry the chip's full text, never the label; a selection holding part
  of a chip gives that chip's whole text, and a cut takes the whole chip, so a cut and a paste back send the text once
  (review 3480 A1).
- **A drag** of a selection holding a chip is refused at `dragstart`: dragged elsewhere it would carry a label, not the
  text. Copy and cut carry the text instead.
- **The table** is replaced when a send empties the field and when a slash command picked from the menu replaces the
  draft (review 3480 A9), so the next chip is #1. Chrome's undo after either does nothing (measured for the send).

## 4. The browser's undo history

Undo and redo are the browser's own, and the composer adds none. Every edit the composer makes is the browser's own
(`execCommand`), because a programmatic value change leaves Chrome's undo with nothing to undo (measured). The markers
are characters of the value, so an undo or redo restores them with the label, and the parse of the restored value is
the chips (measured in a plain textarea and through the composer). A hand-typed copy of a label is never a chip, before
or after any step, because it carries no markers.

**Measured in Chrome (browser leg), each with the chip row and the one request's payload read:** undo and redo of the
paste; of Backspace after a chip and Delete before one; of Expand and × by click and by Enter and Space on the focused
control; of a key typed over a selected chip; of a cut ending inside a chip; of a word delete reaching into a chip from
either side, and undo of an ordinary one beside it; of a composition beside a chip; of an Expand of a text starting
with `[` (twice); of select all and Backspace after an Expand that shows the next chip's label as text; of an Expand
after the other chip was removed; and of each review 3480 case (§7).

**Chrome's own grouping, measured in a plain textarea with no composer:** a delete followed by typing undoes as one
step, and the redo of that step brings back the delete alone, losing the typing. The composer neither causes nor
corrects this; the retyped-label case reads undo only for that reason.

**Not the browser's own edit:** the send that empties the field, after which Chrome's undo does nothing (measured), and
a slash command picked from the menu (unchanged, not measured). The clean-up of §3 falls back to a written value where
the browser refuses the edit (not measured in Chrome: no unplanned edit there broke a chip).

## 5. Thresholds and counts, and the terminal's

The composer's floor is the brief's: 800 characters chip. Claude Code's own input box measured differently in this
repo (`docs/superpowers/plans/2026-10-15-paste-chip-send.md`): it took 800 characters as text and chipped from 801.
The composer's `+L lines` is the number of lines the field shows (newlines plus one); Claude Code's `+M lines` is the
newline count, so the same 13-line text reads `+13 lines` here and `+12 lines` in the pane. Nothing crosses: the
composer sends the full text, never a label.

## 6. Draft survival

The draft is the composer's own state today: it is not persisted, and leaving the session screen drops it. Chips live
in it and the table beside it, so they survive exactly where the draft survives, and no further.

## 7. Tests and what they prove

- `pwa/test/paste-chips.test.ts` (52): floors, grammar, numbering; the parse as the only identity (a bare, half-wrapped,
  unheld, miscounted or second copy of a label is text; a hand-typed copy beside the chip is text); the one expansion,
  byte for byte, markers stripped; Expand and Remove; the caret snap by key direction and by pointer, and the selection
  cover; review 3480 F1 and F2 as plans; Backspace, Delete and word deletes beside a chip; line deletes left to the
  browser; the clean-up of a drop, a line delete, a lone marker and an unheld label; the clipboard's text.
- `pwa/test/composer-paste-chips.test.tsx` (45): the composer in jsdom, which has no `execCommand`, so every edit takes
  the fallback path: focus and caret after Expand and ×; Backspace, Delete and a word delete beside a chip; the caret
  snap through `selectionchange`; the review 3480 cases; the clean-up of a drop and a line delete, and undo after it;
  composition events left alone and cleaned up at their end; a label that is only text; a paste holding a marker; copy,
  cut and a refused drag; the slash-command pick; Retry, Replace draft and Append anyway through the real session
  store.
- `pwa/browser/paste-chips.browser.test.ts` (28), headless Chrome over the production build with Chrome's own
  clipboard: every sequence in §4 with focus, selection, the chip row and the one request's payload read after a 400 ms
  settling window; caret moves and clicks; a composition driven through Chrome's own (`Input.imeSetComposition`); the
  rendered contrast of the chip's label, expand control and remove glyph against the ground composited behind them, at
  rest, hovered and focused, with the focused control asserted, in both skins and two palettes (phosphor, light), each
  at least 4.5:1; and the 44px floor and no sideways scroll at 390.
- **Feasibility, before the build** (a plain textarea in Chrome): the markers draw at zero width; undo and redo of an
  inserted chip, an Expand, a removal and a `[` typed over a selected chip restore the markers with the label; the snap
  rule keeps the caret off a chip's inside through every move listed in §3.

**Review 3480's cases, red on the reviewed tip (9bc4c040's composer sources, these tests) and green now.** Each reads
the outgoing text and the request count after the settling window:

| Case | jsdom, reviewed tip | Chrome, reviewed tip | Outgoing now (one request each) |
|---|---|---|---|
| F1, long paste over plain text into a chip | red (no chip: the new label is text) | red (new label as text, the replaced chip's text revived) | the 20-line text, then `b` |
| F1, long paste from one chip into another | red (no chip) | red (a replaced chip's text revived) | `a`, the 16-line text, `b` |
| F2, `[` typed over the selected chip | red (chip's text revived) | red (chip's text revived) | `[` |
| F2, short paste `[x]` / `[short]` over it | red (chip's text revived) | red (chip's text revived) | `[x]` / `[short]` |
| F3, undo across a retyped label in one step | red (chip lost; label sent bare) | — | the pasted text |
| F3, hand-typed copy beside the chip, every undo and redo | green | green (per-key undo) | the pasted text, a space, the bare label |
| F3, label retyped after the chip was deleted, undo to the chip | — | red only by its marker reading | the pasted text |
| F6, Enter while composing | red (sent) | red (sent at once) | nothing while composing, then the pasted text and `か` |
| A9, a slash command picked after a paste | red (next chip numbered #2) | — | (numbering only) |

The Chrome F3 cases do not reproduce the reviewed failure: Chrome undid that typing a key at a time here, as the
review found. The coalesced step is the jsdom case, whose history event carries the value captured from the field.
The whole reviewed-tip run: jsdom 32 of 45 red, Chrome 28 of 28 red; every case outside the table reads the markers
and is red by that alone. Neighbouring composer and audit suites: 51 files, 2379 tests green. The full pwa typecheck
is clean.

**Mutation, by hand** (the coordinator's helper drives Python only), each deleting or inverting one guard, against the
pure and composer suites: one chip per number, the exact label check, a marker paste as a chip, the strip in the
expansion and in Expand, the key direction, the pointer's nearer side, the anchor cover, the edit's selection cover,
Backspace or Delete beside a chip, the word cover, the strip of typed text, the paste's cover, the clipboard's cover,
both pieces of the clean-up, the composing and cancelable guards, the hold while composing, the clean-up at its end,
the Enter guard, the snap itself, the pointer flag, the refused drag, the table's reset on a send and on a slash pick,
the clean-up itself, and the plan at `beforeinput`; and a bound in the clean-up: 27 of 29 red. Two survived: that
bound, which was redundant (a marker already stops the scan) and is removed; and the cut's own cover, which the
clean-up makes equivalent in jsdom (the field ends the same; the cover keeps a cut one undo step in Chrome). Against the browser leg: no word range, no snap, no Enter
guard, and edits not the browser's own: 4 of 4 red.

## 8. Why this design, and not another

- Leaving the field untouched and showing a summary row above it is trivially lossless, but leaves the whole pasted
  block in the field, which is what this goal exists to fix.
- A rich editable surface with real chip elements gives truly atomic chips, but replaces the text field, its input
  method behaviour and every test that types into it: larger, and riskier on phones.
- An attachment row with the text held outside the field loses the paste's position in the message.
- The three earlier rounds placed a chip by working out a position from text where the value changed without a plan (an
  end position, a common prefix, the nearest equal draft); each review found a case where that guess was wrong. The
  markers remove the guess: the value says which chips it holds.

## 9. Known limits

- A composition was driven through Chrome's own (DevTools), not an operating system's input method, a phone keyboard or
  Android Chrome; there, Enter's newline landed after the composed text, and the trim took it. A real input method's
  Enter, and the snap during a long Android composition, are not measured.
- Firefox and Safari are not measured: `Selection.modify` on a textarea, the order of the last `input` and
  `compositionend`, `selectionchange` on a textarea and `execCommand`'s undo are Chrome's, as measured here.
- A drop, a drag, a line delete and a touch selection handle are not measured in Chrome; the clean-up of a drop and a
  line delete is pinned in jsdom only.
- Two selection moves in one task reach the snap as one `selectionchange` (Chrome coalesces them), so the snap reads the
  direction from where the focus was before both. Either result covers the chip or leaves it whole.
- A pasted text holding U+2062 or U+2063 is sent without them (the one expansion strips every marker).
- Contrast is measured in two of the twelve palettes (phosphor and light) and not in the pressed state; by the
  palettes' tokens the ink on the chip's grounds is at least 6.75:1 in all twelve (review 3469's arithmetic, not
  measured). The focused reading equals the resting one, since the ghost control changes its ground only on hover and
  press; the focus ring is not measured.
- The 44px floor is measured at 390 px wide only.
- `paste-reliability.md` §7.1, the edge-whitespace policy, is unchanged: a chip's leading or trailing whitespace at the
  very edge of the message is trimmed like typed text.
- This does not close the separate end-to-end paste delivery goal.
