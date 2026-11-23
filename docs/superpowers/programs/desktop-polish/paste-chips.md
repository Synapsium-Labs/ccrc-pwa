# Wave 169: compact paste chips in the session composer

Task note for desktop-polish wave 169 (Goals modification 90, second half: long pastes show as expandable, removable
chips that keep the full text and its position in the draft), revised in the fix round for review 3457. The
delivery-reliability half waits on the supported capture lane (`paste-reliability.md` §5) and is not this wave: the
server's send path, the wire, the terminal, the edge-whitespace policy and the draft's lifetime are unchanged.

## 1. In short

- A text paste of **800 characters or more**, or of **more than 12 lines**, enters the draft as a label at the caret,
  `[Pasted text #N +L lines]` (`+1 line` for one), numbered per draft. Shorter pastes go in as before.
- **A chip is the label the composer inserted, not any text that looks like one.** The draft is the field's value plus
  the positions of the labels the composer put there; a label typed by hand, pasted from another draft, or exposed by
  expanding a chip whose text contains one is ordinary text and is sent as written.
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
| `applyChange` | the draft after any change: chip positions kept, moved or dropped by where the edit fell; a label the edit broke repaired; a label brought back by the browser's undo or redo re-attached |
| `planInput` | an edit that would break a label, replaced before it lands (§3) |
| `expandDraft`, `liveChips`, `expandChip`, `removeChip` | the send payload and the row's list and acts |
| `selectionText` | what copy, cut and a drag carry |

`Composer.tsx` holds the draft and the table, performs every plan as the browser's own edit (`execCommand`), and plans
at a native `beforeinput` listener (React's synthetic one carries no `inputType`). `PasteChipBar.tsx` (L4) renders the
row with the design system's ghost `Button` and decides nothing.

## 3. Never lose pasted text silently

- **Planned before it lands.** Typing or pasting inside a label expands it to its full text, then what was typed;
  Backspace or Delete with the caret inside a label expands it and deletes nothing; a selection that starts or ends
  inside a label keeps that chip's text and replaces the rest. An edit no plan can be made for (an input method's
  composition, a drop) is repaired after it lands with the same result.
- **The table only grows within a draft.** A chip's text outlives its label in the field, so undo can bring it back.
  A send that empties the field starts a new table, numbered from #1.
- **Copy and cut** of a selection touching a chip carry the chip's full text, never the label, so no other draft can
  read the label as one of its own chips. A label only partly selected gives its whole text. A drag of such a
  selection sets the same text on its data (coded, not measured).

## 4. The browser's undo history

Measured in Chrome (browser leg): a programmatic value change leaves Chrome's undo with nothing to undo and its redo
inserting stale text, so the composer makes no programmatic change it can avoid. **On the native undo stack:** the
paste of a chip's label, Backspace and Delete against a label, Expand, ×, the inside-label expansion of a typed key or
a short paste, and a cut. Undo of each brings the label back and the chip with it (the one place a label's text is
read back: a label of this draft's own chip that the browser's undo or redo restores, and that has no position in the
field, is that chip again). Redo works the same way. **Not on it:** the after-the-fact repair of an unplanned edit
(composition, drop), the send that empties the field (unchanged), and a slash command picked from the menu
(unchanged). Each of those sets the field's value directly; undo after them is the browser's own behaviour, unpinned.

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

- `pwa/test/paste-chips.test.ts` (43): floors, grammar, numbering, byte-for-byte expansion, identity by occurrence
  (a same-label chip from another draft, a label typed beside a live one, a label inside a pasted text before and
  after Expand and after a repair), the plans, repairs, undo re-attachment, and the clipboard's text.
- `pwa/test/composer-paste-chips.test.tsx` (27): the composer in jsdom, which has no `execCommand`, so every edit takes
  the fallback path: focus and caret after Expand, × and a repair; Backspace and Delete with text on both sides; the
  Stop slot during a turn; copy and cut; and Retry, Replace draft and Append anyway through the real session store.
- `pwa/browser/paste-chips.browser.test.ts` (15), headless Chrome over the production build with Chrome's own
  clipboard: one chip and one request carrying the full text after a 400 ms settling window (both skins); with text on
  both sides, Backspace and Delete, Expand and ×, a key typed inside the label, each with focus and selection read, and
  undo bringing the chip back after each, the request counted after the same window; undo and redo of the paste; copy
  and cut read back from the clipboard; the rendered contrast of the chip's label, its expand control and its remove
  glyph against the ground composited behind them, at rest, hovered and keyboard-focused, in both skins and both
  palettes (each at least 4.5:1); and the 44px floor and no sideways scroll at 390.
- **Mutation, measured by hand** (the coordinator's Python helper does not run TypeScript): 21 mutants against the pure
  and composer suites and 6 against the browser leg, each a deletion or inversion of one guard, including the
  `beforeinput` `preventDefault`, the focus before a native edit, history re-attachment, the copy handler, the
  native path itself, and the chip's ground (which reds the light palettes). Every one went red except two: the
  history guard in `planInput`, which was redundant (an undo carries no text) and was removed, and a short paste
  inside a label, which had no case and now has one that the mutant reds. The first build's claim
  in this note that every guard went red was wrong for the Backspace guard, focus and caret, and the Stop slot
  (review 3457 F2, F3, A2); those now have the cases above.

## 8. Known limits

- A label brought back by the browser's undo or redo re-attaches to this draft's chip of the same label when that chip
  has no position in the field. A label typed by hand, undone and redone in a draft whose own removed chip has the same
  label would re-attach to it.
- Undo after the repair of an unplanned edit, after a send and after a slash-command pick is the browser's own, and
  unpinned (§4).
- `paste-reliability.md` §7.1, the edge-whitespace policy, is unchanged: a chip's leading or trailing whitespace at the
  very edge of the message is trimmed like typed text.
