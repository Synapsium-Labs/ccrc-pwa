# Wave 169: compact paste chips in the session composer

Task note for desktop-polish wave 169 (Goals modification 90, second half: long pastes show as expandable, removable
chips that keep the full text and its position in the draft), revised in the fix rounds for reviews 3457 and 3469. The
delivery-reliability half waits on the supported capture lane (`paste-reliability.md` §5) and is not this wave: the
server's send path, the wire, the terminal, the edge-whitespace policy and the draft's lifetime are unchanged.

## 1. In short

- A text paste of **800 characters or more**, or of **more than 12 lines**, enters the draft as a label at the caret,
  `[Pasted text #N +L lines]` (`+1 line` for one), numbered per draft. Shorter pastes go in as before.
- **A chip is the label the composer inserted, not any text that looks like one.** The draft is the field's value plus
  the positions of the labels the composer put there; a label typed by hand, pasted from another draft, or exposed by
  expanding a chip whose text contains one is ordinary text and is sent as written. No label's text is ever searched
  for: a new chip is placed where its plan put the label, and the browser's undo and redo return to a draft the field
  has already held, with exactly its positions (§4).
- A chip row above the field lists each chip (number, line count, first non-blank line) with **expand** (the full text
  replaces the label, as ordinary text) and **×** (the label and its text go together). Backspace right after a label,
  or Delete right before one, takes the whole label; typed text on either side stays.
- A send replaces every chip with its full text at its position, byte for byte, then applies today's rules unchanged:
  the whole-message trim and the whitespace-only guard. Retry and both draft-conflict choices resend that expanded
  text, because the store's pending record only ever held it.

## 2. Where the decisions live

`pwa/src/session/pasteChips.ts` is L1 (context C3, Session Conversation), pure functions over strings:

| Function | Decides |
|---|---|
| `normalizePaste`, `shouldChip`, `lineCount` | whether a paste becomes a chip: CR LF and a lone CR read as LF (what the field does with a pasted text), characters counted as code points, lines as the field shows them |
| `linesWord`, `chipToken`, `addChip` | the label grammar (one owner for "1 line" / "N lines", used by the label and the chip row) and the next number |
| `applyChange` | the draft after any change that is no undo or redo: chip positions kept, moved or dropped by where the edit fell; a new chip attached at the position its plan states; a label the edit broke repaired |
| `planInput`, `planPaste`, `planWordDelete` | an edit that would break a label, replaced before it lands (§3); where a pasted chip's label goes |
| `DraftLog`: `startLog`, `logChange`, `logStep`, `canStep` | the drafts the field has held, in the browser's undo order, and which one an undo or redo restored (§4) |
| `expandDraft`, `liveChips`, `expandChip`, `removeChip` | the send payload and the row's list and acts |
| `selectionText` | what copy, cut and a drag carry |

`Composer.tsx` holds the draft, the table and the log, performs every plan as the browser's own edit (`execCommand`),
and plans at a native `beforeinput` listener (React's synthetic one carries no `inputType`). It reads two facts only
the browser has: whether an event is composing or cancelable, and the range a word delete would remove (§3).
`PasteChipBar.tsx` (L4) renders the row with the design system's ghost `Button` and decides nothing.

## 3. Never lose pasted text silently

- **Planned before it lands.** Typing or pasting inside a label expands it to its full text, then what was typed;
  Backspace or Delete with the caret inside a label expands it and deletes nothing; a selection that starts or ends
  inside a label keeps that chip's text and replaces the rest.
- **A word delete** (Ctrl+Backspace, Ctrl+Delete) is planned the same way over the range the browser itself would
  delete. A textarea's `beforeinput` exposes no target range (`getTargetRanges()` is empty, measured in Chrome), so the
  composer extends the selection by one word with `Selection.modify` and reads it back; in Chrome that is exactly the
  range the key deletes (measured). With the caret touching a label it is Backspace's or Delete's plan; a word that
  reaches into a label keeps the chip's text and deletes the rest of the word; an ordinary word stays the browser's own.
- **Not scripted: an input method's composition.** Its `beforeinput` cannot be cancelled, so no plan is performed for
  it (nor for any non-cancelable or composing event). It lands as the input method makes it; while it runs, positions
  only move with it, and when it ends a label it broke is repaired, the label becoming its full text with the composed
  text after it, once. A repair written mid-composition left the input method's first character behind (measured), so
  the repair waits for `compositionend`.
- **Repaired after it lands:** an edit no plan exists for (a drop, a line delete such as Cmd+Backspace on a Mac) gets
  the same result as its plan would.
- **The table only grows within a draft.** A chip's text outlives its label in the field, so undo can bring it back.
  A send that empties the field starts a new table, numbered from #1.
- **Copy and cut** of a selection touching a chip carry the chip's full text, never the label, so no other draft can
  read the label as one of its own chips. A label only partly selected gives its whole text.
- **A drag** of a selection holding any part of a chip is refused at `dragstart`, since a move would leave the chip's
  text at the source and drop it again at the target; copy and cut carry it instead. A drag of other text is the
  browser's own.

## 4. The browser's undo history

A programmatic value change leaves Chrome's undo with nothing to undo (measured), so the composer makes no programmatic
change it can avoid and adds no undo of its own: undo and redo are the browser's.

**Where a chip is after an undo or redo.** The browser's history event carries no range and no text. The composer
keeps the drafts the field has held (`DraftLog`): every change appends one and drops those after the current one, as a
new edit drops the browser's redo entries, and an undo or redo moves to the nearest held draft, before or after the
current one, whose value is exactly the value the browser restored. That draft's positions are the chips. Each
keystroke is one held draft where the browser's undo takes a run of typing in one step, which is why the nearest
equal value is taken. While the draft has pasted texts, an undo or redo with no held draft in its direction (before
a value the composer wrote itself, or past the oldest of the 1000 drafts kept) is cancelled at `beforeinput`; a step
to a value never held is placed by no guess (a label it broke stays text).

**Measured in Chrome (browser leg), each with undo and then redo, the chip row and the payload read:** the paste;
Backspace after a label and Delete before one; Expand (also with a text starting with `[`) and ×, by click and by
Enter and Space on the focused control; a key typed inside a label; a short paste inside a label; a cut; a word
delete reaching into a label from either side, and an ordinary word delete beside a chip; a long paste inside a label
whose text holds the new chip's label; Expand, select all and Backspace, then undo and redo, with a second chip whose
label appears inside the first chip's text; and a removed chip whose label an Expand exposes, through undo and redo.

**Not on the browser's stack (each a value the composer writes):** the repair after a composition inside a label,
after which Chrome's undo does nothing (measured; nothing is lost or doubled); the repair of a drop or a line delete
(not measured); the send that empties the field, after which undo brings nothing back (measured); and a slash command
picked from the menu (unchanged, not measured).

## 5. Thresholds and counts, and the terminal's

The composer's floor is the brief's: 800 characters chip. Claude Code's own input box measured differently in this
repo (`docs/superpowers/plans/2026-10-15-paste-chip-send.md`): it took 800 characters as text and chipped from 801.
The composer's `+L lines` is the number of lines the field shows (newlines plus one); Claude Code's `+M lines` is the
newline count, so the same 13-line text reads `+13 lines` here and `+12 lines` in the pane. Nothing crosses: the
composer sends the full text, never a label.

## 6. Draft survival

The draft is the composer's own state today: it is not persisted, and leaving the session screen drops it. Chips live
beside it, so they survive exactly where the draft survives, and no further.

## 7. Tests and what they prove

- `pwa/test/paste-chips.test.ts` (53): floors, grammar, numbering, byte-for-byte expansion, identity by occurrence
  (a same-label chip from another draft, a label typed beside a live one, a label inside a pasted text before and
  after Expand and after a repair, a long paste inside a label whose text holds the new label, an attach only where its
  label is), the plans, word deletes, repairs, the log (undo and redo of a removal and an Expand, a `[`-leading Expand,
  both collision sequences of review 3469, one value held both as a chip and as a typed label), and the clipboard's
  text. History steps there carry the restored value only, as the browser's event does: no range, no caret.
- `pwa/test/composer-paste-chips.test.tsx` (38): the composer in jsdom, which has no `execCommand`, so every edit takes
  the fallback path: focus and caret after Expand, × and a repair; Backspace and Delete with text on both sides; the
  Stop slot during a turn; composition events left alone and repaired at their end; the review 3469 sequences with
  history events carrying a value only; the cancel of an undo with no held draft; a refused drag; copy and cut; and
  Retry, Replace draft and Append anyway through the real session store.
- `pwa/browser/paste-chips.browser.test.ts` (23), headless Chrome over the production build with Chrome's own
  clipboard: every sequence listed in §4 with focus, selection, the chip row and the one request's payload read after
  a 400 ms settling window; a composition driven through Chrome's own (`Input.imeSetComposition`) beside and inside a
  label; copy and cut read back from the clipboard; the rendered contrast of the chip's label, expand control and
  remove glyph against the ground composited behind them, at rest, hovered and focused, with the focused control
  asserted, in both skins and two palettes (phosphor, light), each at least 4.5:1; and the 44px floor and no sideways
  scroll at 390.
- **Red first on the reviewed revision (review 3469):** with the source of `3469d414` and these tests, the browser leg
  had 6 of 23 red (F1, F2, F3 (a), F3 (b), F4, F5) and the composer suite 8 of 36; with the fix, all green.
- **Mutation, measured by hand** (the coordinator's Python helper does not run TypeScript), each a deletion or
  inversion of one guard. This round: 20 against the pure and composer suites (the composing and cancelable guards,
  the history cancel and its pasted-text condition, the log step, the mid-composition hold and its end, the drag
  refusal, the send's log reset, the attach position and its check, `repair: false`, the log's redo drop, cap, step
  order and edge, and both word-delete rules) and 3 against the browser leg (no word range, no mid-composition hold, no
  log step): all red, one (the send's log reset) only after a case was added for it. The earlier rounds' mutants are
  as their reports state; the guards they named that this round removed (history re-attachment by text) are gone.

## 8. Known limits

- Undo after the repair of a composition inside a label does nothing in Chrome (measured): the repair is a value the
  composer writes (§4). Nothing is lost or doubled. A drop or a line delete is repaired the same way (not measured).
- An undo or redo that no held draft explains is cancelled while the draft has pasted texts; after a slash-command pick
  or past 1000 held drafts, such an undo does nothing.
- A composition was driven through Chrome's own (DevTools), not an operating system's input method, a phone keyboard
  or Android Chrome; those, a drop, a line delete and a drag are not measured. Android Chrome's handling of a cancelled
  Backspace `beforeinput` is not measured either.
- Contrast is measured in two of the twelve palettes (phosphor and light) and not in the pressed state; by the
  palettes' tokens the ink on the chip's grounds is at least 6.75:1 in all twelve (review 3469's arithmetic, not
  measured). A hovered control's ground differs little from the chip's own in some palettes; the text still reads.
- The 44px floor is measured at 390 px wide only.
- `paste-reliability.md` §7.1, the edge-whitespace policy, is unchanged: a chip's leading or trailing whitespace at the
  very edge of the message is trimmed like typed text.
