# Wave 169: compact paste chips in the session composer

Task note for desktop-polish wave 169 (Goals modification 90, second half: long pastes show as expandable, removable
chips that keep the full text and its position in the draft). The delivery-reliability half waits on the supported
capture lane (`paste-reliability.md` §5) and is not this wave: the server's send path is unchanged.

## 1. In short

- A text paste of **800 characters or more**, or of **more than 12 lines**, enters the draft as a token at the caret,
  `[Pasted text #N +L lines]` (`+1 line` for one), numbered per draft. Shorter pastes go in as before.
- The full text is kept beside the draft; the token's position in the field is the text's position. Several chips may
  sit anywhere among typed text.
- A chip row above the field (beside the attachment tray) lists each chip: its number, line count and first non-blank
  line, with **expand** (the full text replaces the token, as ordinary text) and **×** (the token and its text go
  together). Backspace right after a token, or Delete right before one, takes the whole token.
- A send replaces every token with its full text at its position, byte for byte, then applies today's rules unchanged:
  the whole-message trim, the whitespace-only guard. Retry and both draft-conflict choices resend that expanded text,
  because the store's pending record only ever held it.

## 2. Where the decision lives

`pwa/src/session/pasteChips.ts` is L1 (context C3, Session Conversation), pure functions over strings:

| Function | Decides |
|---|---|
| `normalizePaste`, `shouldChip`, `lineCount` | whether a paste becomes a chip: CR LF and a lone CR read as LF (what the field does with a pasted text), characters counted as code points, lines as the field shows them |
| `chipToken`, `addChip`, `findTokens` | the grammar, the next number, and which token-shaped strings are chips (a number this draft issued, with the line count it issued) |
| `expandDraft` | the send payload before the send rules, in one pass, so a token inside a pasted text is never expanded again |
| `expandChip`, `removeChip`, `liveChips` | the row's two acts and what it lists |
| `tokenToRemove` | the whole token a Backspace or Delete takes |
| `locateEdit`, `reconcileEdit` | broken-token recovery (§3) |

`Composer.tsx` holds the table beside `value` (so chips survive exactly where the draft does), routes every change
through `reconcileEdit`, and inserts and deletes tokens with `document.execCommand`, so the browser's own undo history
holds them; jsdom, which has no `execCommand`, takes the same path through the pure functions. `PasteChipBar.tsx` (L4)
renders the row with the design system's ghost `Button` (44px floor at every width) and decides nothing.

## 3. Never lose pasted text silently

- **The table only grows within a draft.** A token that leaves the field (×, Backspace, a cut, the browser's undo)
  keeps its text, so the same token coming back (redo, undo of a removal, a paste of the cut token) expands again. A
  send that empties the field starts a new table, and numbering starts at #1 again.
- **A broken token is expanded back.** An edit that starts or ends strictly inside a token, or types inside one, puts
  the full text where the token stood; what the edit inserted is kept (after the text when the edit began inside the
  token, before it when it began outside), what it removed outside tokens stays removed, and only the token's own
  characters are let go. The caret after the edit, read from the field, places the edit, so a repeated character is
  located where it was typed.
- **Measured in Chrome** (the browser leg): a paste, Ctrl+Z (the field empties), Ctrl+Shift+Z (the token is back with
  its chip), Backspace (the whole token goes), Ctrl+Z (the token is back), Enter: one request whose `text` is the full
  pasted text.

## 4. Draft survival

The draft is the composer's own state today: it is not persisted, and leaving the session screen drops it. Chips live
in the same component beside it, so they survive exactly where the draft survives, and no further. Persisting drafts
is not this wave.

## 5. Tests

- `pwa/test/paste-chips.test.ts`: the floors (799/800 characters, 12/13 lines, code points), CR LF, the grammar and
  numbering, byte-for-byte expansion (one chip, several among typed text, at the start and end, CR LF, tabs and edge
  whitespace, a copied token, a token inside a pasted text), expand, remove, Backspace and Delete, edit location, and
  recovery.
- `pwa/test/composer-paste-chips.test.tsx`: the composer end to end in jsdom, including the whitespace-only guard, a
  hand-edited token, undo and redo, and Retry, Replace draft and Append anyway through the real session store.
- `pwa/browser/paste-chips.browser.test.ts`: headless Chrome over the production build, Chrome's own clipboard; one
  chip, one request carrying the full text, in both skins at 1280; undo, redo and Backspace; at 390 with a touch
  screen, both skins and both palettes, the controls measure at least 44px and the page does not scroll sideways.
- Each guard was mutated by hand and the suite went red, except one equivalent mutant (`addChip`'s numbering written
  as a maximum over the keys); that code is now the table's size plus one.

## 6. Known limits

- A token is recognised by its exact text. A short paste that is literally a live token's text, or a pasted text that
  contains one and is later expanded into the draft, reads as that chip at the next send.
- Expand and × replace the field's value directly; whether the browser's undo can step back over them is not pinned
  (the text stays in the table either way).
- `paste-reliability.md` §7.1, the edge-whitespace policy, is unchanged: a chip's leading or trailing whitespace at the
  very edge of the message is trimmed like typed text.
