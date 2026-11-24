# Wave 169: compact paste chips in the session composer

Task note for desktop-polish wave 169 (Goals modification 90, second half: long pastes show as expandable, removable
chips that keep the full text and its position in the draft). Revised in the fix rounds for reviews 3457 and 3469,
redesigned after review 3480 on the coordinator's ruling that the field's value carries a chip's identity, and revised
after review 3589 on the ruling that the composer never writes in answer to an edit it did not plan. The
delivery-reliability half waits on the supported capture lane (`paste-reliability.md` §5) and is not this wave: the
server's send path, the wire, the terminal, the edge-whitespace policy and the draft's lifetime are unchanged.

## 1. In short

- A text paste of **800 characters or more**, or of **more than 12 lines**, enters the draft as a chip at the caret:
  the label `[Pasted text #N +L lines]` (`+1 line` for one), written with no-break spaces so it never wraps, between two
  reserved invisible markers (U+2062 and U+2063, which draw nothing). Shorter pastes go in as before.
- **The value carries the identity.** A chip is a label between both markers whose number the table holds, with that
  text's line count; anything else is ordinary text, whatever it says. The live chips are an exact parse of the field's
  current value, done after every change. Nothing is tracked between changes: an undo or redo is whatever value the
  browser restores, and its parse is the answer. A chip that comes back whole is a chip again, twice too.
- **Numbers are never reused for the life of the composer.** A send and a slash-command pick clear the table but not
  the counter, so a label an undo or redo brings back from before a send names nothing and can never expand to another
  paste's text.
- **The composer never writes in answer to an edit it did not plan.** A marker outside every chip is inert: never a
  chip, drawn as nothing, stripped by the expansion, stepped over by the caret. Nothing removes it on its own, so the
  browser's undo walks back through a break to the intact chip. While one stands, the chip row says a pasted block was
  broken, with **undo** (one step of the browser's own undo) and **dismiss** (the inert markers go, as one ordinary
  edit), and the send and both draft-conflict choices are held, saying why.
- A chip row above the field lists each chip (number, line count, first non-blank line) with **expand** (the full text
  replaces the chip, as ordinary text) and **×** (the chip leaves the field; its text stays in the table, for an undo).
- A chip is one object to the caret and the selection: a caret never rests inside one, and a selection that touches
  part of one covers all of it before an edit applies. Backspace right after a chip, or Delete right before one, takes
  it whole.
- Sending, retry, both draft-conflict choices, copy and cut go through one expansion: each chip becomes its table text
  byte for byte, its own markers included, and the field's own text loses every marker. Today's whole-message trim and
  whitespace-only guard follow, unchanged.

## 2. Where the decisions live

`pwa/src/session/pasteChips.ts` is L1 (context C3, Session Conversation), pure functions over strings:

| Function | Decides |
|---|---|
| `normalizePaste`, `shouldChip`, `lineCount` | whether a paste becomes a chip: long, or holding a marker; CR LF and a lone CR read as LF; characters counted as code points, lines as the field shows them |
| `linesWord`, `chipToken`, `chipField`, `addChip` | the label grammar (one owner for "1 line" / "N lines"; no-break spaces), the chip as the field holds it, a chip under the number the composer's counter gives |
| `parseChips`, `liveChips` | the chips the value holds, the only identity there is |
| `inertMarkers`, `dismissPlan` | the markers outside every chip, and the user's Dismiss of them |
| `expandValue`, `selectionText` | the one expansion: the send payload and the clipboard's text |
| `snapSelection`, `coverChips` | where a caret and a selection may rest; inert markers stepped over |
| `planEdit`, `planPaste`, `expandChip`, `removeChip` | the edits a chip needs planned, performed as the browser's own |

`CHIP_OPEN` and `CHIP_CLOSE` are defined once, as escapes, and every pattern is derived from them. `Composer.tsx` holds
the value, the table and the counter, performs every plan as the browser's own edit (`execCommand`), plans at a native
`beforeinput` listener (React's synthetic one carries no `inputType`), snaps the selection on `selectionchange`, and
holds the send while the value has an inert marker. It reads three facts only the browser has: whether an event is
composing or cancelable, the range a word delete would remove (`Selection.modify`), and whether a pointer is making the
selection. `PasteChipBar.tsx` (L4) renders the row and the break notice with the design system's ghost `Button` and
decides nothing.

## 3. Never lose pasted text silently

- **Markers enter the field from typing only as part of a chip.** Typed text (`insertText`, the one input type that can
  only be typing) loses any marker before it lands; a paste that holds one is a chip whatever its length, its text in
  the table untouched. Every other insert (a drop, a yank, a replacement) lands as the browser makes it and the parse
  decides: a chip it brings back whole is a chip again (review 3589 F3).
- **A chip is one object.** A key that moves the caret into a chip carries it on to the far side, in the direction it
  moved; a pointer (a click, a drag) takes the nearer side; a selection whose anchor is inside a chip covers it.
  Measured in Chrome: arrows, Shift+arrows, Ctrl+arrows, Up and Down, Home and End and clicks. An edit over a selection
  that still touches part of a chip (one made in the same task, before `selectionchange` ran) is widened to the whole
  chip first, so a paste over it replaces whole chips and inserts its own new chip, a key typed over it replaces them,
  and a cut takes them whole. A caret inside a chip at an edit stands at the chip's end: a key goes in after it, a
  delete takes it.
- **A label never wraps.** Its spaces are no-break, so it stays on one line (measured at 390 px for every run of 0 to
  39 characters before it), and a soft line delete takes a whole chip or none. Line deletes stay the browser's own.
- **Planned before it lands, and only where a chip needs it** (`planEdit`): Backspace right after a chip and Delete
  right before one take it whole; a word delete whose range, measured by the browser, reaches into a chip takes the chip
  whole; typed text loses its markers.
- **Not scripted: an input method's composition.** Its `beforeinput` cannot be cancelled, so nothing is planned for it
  (nor for any non-cancelable or composing event), and nothing is written while it runs or after it ends. **Enter while
  a composition is open never sends** (`isComposing`, or key code 229).
- **A break is shown and held, never cleaned up.** What an unplanned edit breaks (a composition reaching into a label,
  a drop into one) leaves its markers inert: the field keeps every character as the browser left it, the chip row says
  "The last edit broke a pasted block. Sending is held until you undo it or dismiss it.", Send and both draft-conflict
  choices are disabled and say why, and Enter sends nothing. The notice clears itself as soon as the value has no inert
  marker, however that came about. **undo** is one step of the browser's own undo from the field, which brings the
  intact chip back (measured); **dismiss** takes out the inert markers as one ordinary undoable edit and keeps every
  other character, label-shaped text included. The pasted text stays in the table either way.
- **Copy and cut** of a selection holding a chip carry the chip's full text, never the label; a selection holding part
  of a chip gives that chip's whole text, and a cut takes the whole chip.
- **A drag** of a selection holding a chip is refused at `dragstart`: dragged elsewhere it would carry a label, not the
  text. Copy and cut carry the text instead.
- **A paste with no text** (HTML only, or an image with no session to stage it in) plans nothing; a file pasted with a
  long text is staged and makes no chip.

## 4. The browser's undo history

Undo and redo are the browser's own, and the composer adds none. Every edit the composer makes is the browser's own
(`execCommand`), because a programmatic value change leaves Chrome's undo with nothing to undo (measured), and it makes
none in answer to an edit it did not plan. The markers are characters of the value, so an undo or redo restores them
with the label, and the parse of the restored value is the chips.

**Measured in Chrome (browser leg), each with the chip row and the one request's payload read:** undo and redo of the
paste; of Backspace after a chip and Delete before one; of Expand and × by click and by Enter and Space on the focused
control; of a key typed over a selected chip; of a cut ending inside a chip; of a word delete reaching into a chip from
either side, and undo of an ordinary one beside it; of a composition beside a chip; of a soft line delete beside a chip
at 390 px (the input type read: `deleteSoftLineBackward`); of a composition reaching into a label, back to the intact
chip and forward to the break, and the notice's undo and dismiss; of an Expand of a text starting with `[` (twice); of
select all and Backspace after an Expand that shows the next chip's label as text; of an Expand after the other chip
was removed; and of each review 3480 case (§7).

**Chrome's history survives a send (measured).** After a draft of a typed `x` and a paste is sent and a second paste of
the same line count goes in, four undos leave the field empty, and the redo after them brings back values from before
the send, holding the old label. Because numbers are never reused, that label names nothing: no chip, the break shows,
and no pasted text, old or new, can go out behind it.

**Chrome's own grouping (measured by review 3589 in a bare textarea):** a delete over a selection followed by typing
undoes as one step, and its redo brings back the delete alone, losing the typing; a collapsed Backspace followed by
typing undoes key by key and loses nothing. A chip delete the composer performs (Backspace or Delete beside a chip, ×)
is a delete over a selection, so typing right after one loses that typing on redo. The composer neither causes nor
corrects the grouping itself; the retyped-label case reads undo only for that reason.

## 5. Thresholds and counts, and the terminal's

The composer's floor is the brief's: 800 characters chip. Claude Code's own input box measured differently in this
repo (`docs/superpowers/plans/2026-10-15-paste-chip-send.md`): it took 800 characters as text and chipped from 801.
The composer's `+L lines` is the number of lines the field shows (newlines plus one); Claude Code's `+M lines` is the
newline count, so the same 13-line text reads `+13 lines` here and `+12 lines` in the pane. Nothing crosses: the
composer sends the full text, never a label.

## 6. Draft survival

The draft is the composer's own state today: it is not persisted, and leaving the session screen drops it. Chips live
in it and the table beside it, so they survive exactly where the draft survives, and no further. The counter lives as
long as the composer.

## 7. Tests and what they prove

- `pwa/test/paste-chips.test.ts` (54): floors, grammar (no-break spaces, one marker definition), numbering by the
  counter; the parse as the only identity (a bare, half-wrapped, unheld or miscounted label is text; a hand-typed copy
  is text; a whole chip twice is two chips); the one expansion, field markers stripped and table text byte for byte;
  Expand and Remove by position; the caret snap by key direction and by pointer, the inert step-over, the selection
  cover and a caret inside a chip; review 3480 F1 and F2 as plans; Backspace, Delete and word deletes beside a chip;
  every non-typing insert left to the browser; inert markers and Dismiss keeping every other character; the
  clipboard's text; a paste with no text.
- `pwa/test/composer-paste-chips.test.tsx` (50): the composer in jsdom, which has no `execCommand`, so every edit takes
  the fallback path: focus and caret after Expand and ×; Backspace, Delete and a word delete beside a chip; the caret
  snap through `selectionchange`; the review 3480 cases; review 3589's: label-shaped text dropped after a label's `#`
  keeping every character, the notice, the held send, Dismiss and its one request; the notice clearing on an undo to
  the intact chip; a line delete that broke a chip left as it is; the conflict choices held and saying why; drop, yank
  and replacement inserts left to the browser with and without data, and a chip brought back twice; numbering that goes
  on after a send and a slash pick; a paste with no text; a file with a long text; composition events left alone, a
  broken one shown; copy, cut and a refused drag; Retry, Replace draft and Append anyway through the real store.
- `pwa/browser/paste-chips.browser.test.ts` (33), headless Chrome over the production build with Chrome's own
  clipboard: every sequence in §4 with focus, selection, the chip row and the one request's payload read after a 400 ms
  settling window; caret moves and clicks; compositions driven through Chrome's own (`Input.imeSetComposition`, with a
  replacement range for the one reaching into a label); the notice's controls at the 44px floor; the rendered contrast
  of the chip's label, expand control and remove glyph against the ground composited behind them, at rest, hovered and
  focused, with the focused control asserted, in both skins and two palettes (phosphor, light), each at least 4.5:1; and
  the 44px floor and no sideways scroll at 390.

**Review 3589's cases, red on the reviewed tip (9c61fc70's composer sources, these tests) and green now.** Each reads
the outgoing text and the settled request count:

| Case | jsdom, reviewed tip | Chrome, reviewed tip | Outgoing now |
|---|---|---|---|
| A label at 390 px, 0 to 39 characters before it on its line | — | red (wraps from 3 characters on) | — |
| Soft line delete beside a chip at 390 px, undo and redo | — | red (undo stuck after the clean-up) | one request: `www `, the pasted text, ` tail` |
| Composition reaching into a label, undo, redo, notice Undo | red (label cleaned away) | red (label cleaned away) | nothing while broken; after Undo one request: `a`, the pasted text, `b` |
| Dismiss, undo and redo of it | — | red (no notice) | nothing while broken; after Dismiss one request: the text as shown |
| Label-shaped text dropped after a label's `#` | red (dropped digits eaten) | — (no native drop lands in Chrome) | nothing while broken; after Dismiss one request: every dropped character |
| Line delete that broke a chip (unwrapped field) | red (cleaned) | — | nothing while broken |
| Draft-conflict choices while broken | red (not held) | — | none |
| Drop, yank, replacement with a chip in their data | red (stripped to a bare label) | — | both chips' texts |
| After a send, an undone or redone old label | red (read as the new #1) | red (read as the new #1) | nothing while broken; after Dismiss the label as text, no pasted text |
| Numbers go on after a send and a slash pick | red (#1 again) | — | — |
| A paste with no text over part of a chip | red (chip deleted) | — | — |

The whole reviewed-tip runs: jsdom 22 of 50 red; Chrome, the review cases, 8 of 12 red (the four green there as here
are review 3480's F1 and F2 cases; three of the eight are review 3480's F3 and F6 cases, which read the label's exact
spaces and are red there by that alone). Neighbouring composer and audit suites: 51 files, 2386 tests
green. The full pwa typecheck is clean. Those neighbours left out the markup census, and the pull request's first
fast run on this round's tip went red there: the notice's two acts and Expand spelled the same ghost Button three
times. The act is now one helper in `PasteChipBar.tsx`; the census, the chip suites (pure, composer, Chrome 33) and the
typecheck are green again on the follow-up commit.

**Mutation, by hand** (the coordinator's helper drives Python only), each deleting or inverting one guard. Against the
pure and composer suites, 37: the exact label check, a marker paste as a chip, the field-text strip and the table
text's byte-for-byte expansion, the strip in Expand, the key direction, the pointer's nearer side, the anchor cover, the
inert step-over, a caret inside a chip standing at its end, the edit's selection cover, Backspace or Delete beside a
chip, the word cover, the strip limited to typing, the strip of typed text, the paste's cover, a paste with no text,
the clipboard's cover, Dismiss keeping characters, inert meaning outside every chip, the composing and cancelable
guards, the Enter guard, the snap, the pointer flag, the refused drag, the cut's cover, the table's reset on a send and
on a slash pick, the counter counting and never resetting, the send's hold, the conflict choices' hold, Dismiss acting,
the plan at `beforeinput`, nothing written back, and the conflict handler's own hold: 36 red. The survivor, the
conflict handler's hold behind its disabled buttons, is deleted. Against the browser leg, 6: the notice's undo, the
no-break label, the snap, the Enter guard, edits not the browser's own, and no word range: all red.

## 8. Why this design, and not another

- Leaving the field untouched and showing a summary row above it is trivially lossless, but leaves the whole pasted
  block in the field, which is what this goal exists to fix.
- A rich editable surface with real chip elements gives truly atomic chips, but replaces the text field, its input
  method behaviour and every test that types into it: larger, and riskier on phones.
- An attachment row with the text held outside the field loses the paste's position in the message.
- The three rounds before review 3480 placed a chip by working out a position from text where the value changed
  without a plan; review 3589 found the same class in the clean-up of a broken chip, which worked out from text where
  a label had been and wrote that back, deleting user text that continued the grammar and locking undo in a loop. The
  markers remove the first guess; showing the break and leaving the fix to the user removes the second.

## 9. Known limits

- A composition was driven through Chrome's own (DevTools), not an operating system's input method, a phone keyboard or
  Android Chrome; there, Enter's newline landed after the composed text, and the trim took it. A real input method's
  Enter (key code 229 is pinned in jsdom only), and the snap during a long Android composition, are not measured.
- Whether a drop, a yank (macOS Ctrl+K then Ctrl+Y) or a replacement insert carries its text in a textarea's
  `beforeinput` is not measured: none could be landed in headless Chrome here. Both branches are pinned in jsdom, and
  neither is planned: they land natively and the parse decides.
- Firefox and Safari are not measured: `Selection.modify` on a textarea, the order of the last `input` and
  `compositionend`, `selectionchange` on a textarea and `execCommand`'s undo are Chrome's, as measured here.
- A drag and a touch selection handle are not measured in Chrome.
- How a screen reader speaks U+2062 and U+2063 around every label, read by character or by word, is not measured.
- Two selection moves in one task reach the snap as one `selectionchange` (Chrome coalesces them), so the snap reads the
  direction from where the focus was before both. Either result covers the chip or leaves it whole.
- An inert marker takes no arrow press of its own, but Backspace or Delete beside one removes it (an invisible change,
  which clears the notice when it was the last).
- A pasted text holding U+2062 or U+2063 goes out byte for byte; a short one becomes a chip (MathML writes U+2062 for
  implicit multiplication). If a draft-conflict choice later puts such a text back into the field, it shows those
  markers as inert, with the break notice: an accepted limit.
- Two copies of one chip share an accessible name in the row (`Expand pasted text #1, …`); each acts on its own copy.
- Contrast is measured in two of the twelve palettes (phosphor and light) and not in the pressed state; by the
  palettes' tokens the ink on the chip's grounds is at least 6.75:1 in all twelve (review 3469's arithmetic, not
  measured). The focused reading equals the resting one, since the ghost control changes its ground only on hover and
  press; the focus ring is not measured. The break notice uses the chip's ground and ink.
- The 44px floor is measured at 390 px wide, and for the notice's controls at 1280.
- `paste-reliability.md` §7.1, the edge-whitespace policy, is unchanged: a chip's leading or trailing whitespace at the
  very edge of the message is trimmed like typed text.
- This does not close the separate end-to-end paste delivery goal.
