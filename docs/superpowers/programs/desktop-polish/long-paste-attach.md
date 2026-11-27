# Wave 194: a long paste goes to the session as an attached text file

Task note for desktop-polish wave 194. The operator chose it on 2026-11-27 (item 719: "Attach it: a long paste becomes
a text chip, saved as a file like a picture; the session gets one short line pointing at it") and approved the
coordinator's short design the same day (item 729). The coordinator ruled on what the design left open, approved the
step-1 proposal with nine conditions, and corrected condition 1 on the worker's question (ask 907).

## 1. In short

- **Which pastes:** every paste chip, by the composer's existing rule (`pasteChips.ts`), unchanged. Typed text and a
  paste too short to be a chip go inline as today.
- **At Send:** each chip's text is saved as a `.txt` clip in the session's own folder through the existing upload
  (`api.upload`, unchanged), byte for byte, UTF-8, under the neutral name `paste.txt`, so the stored name is
  `clip-<stamp>-<rand>-paste.txt` and carries no word of the paste. Then the draft goes out with each chip replaced, in
  its place and on a line of its own, by one pointer line.
- **The pointer**, one grammar in `shared/pastePointer.ts`, written by the composer and read by the chat:

  ```text
  The pasted text (1 line) is in <path>; read that file as part of this message.
  The pasted text (214 lines) is in <path>; read that file as part of this message.
  ```

  `<path>` is exactly the path the upload answered. The count is the composer's own (the chip label's). A line is a
  pointer only when it is the whole grammar, its path is a whole clip path (`CLIP_PATH_RE`, anchored) with no `.` or
  `..` segment, its folder after `.cc-clips/` is exactly this session's id, and its name ends `-paste.txt`.
- **A failed save sends nothing**, and types nothing (the prompt call is never made). The chip row shows the reason with
  **retry** and **send as typed text**; neither is ever taken without the operator's tap.
- **In the chat**, a pointer of this session is drawn as a chip in its place (`Pasted text · 214 lines`), in the
  confirmed bubble and in the pending one alike; it opens the saved file in a new tab, by a URL built from the session
  id and the file name alone (`clipUrl`).
- **Unchanged:** the chip rule, the chip's look and editing in the composer, copy and cut (they still give the full
  text), the attachment tray and its limits and words, everything under `server/src` (`server/src/inject` included), the
  upload and serving routes, `shared/api.ts`, the store and the API client file. Nothing under `ui/`.

## 2. Files

| File | Ring | What |
| --- | --- | --- |
| `shared/pastePointer.ts` (new) | L0, C3 | The grammar: `pastePointer`, `readPastePointer`, `splitPastePointers`, `isPastePointerLine` (the list's pricing only), `PASTE_UPLOAD_NAME`, `PASTE_POINTER_MAX` |
| `pwa/src/session/pasteSend.ts` (new) | L1, C3 | The pure plan of a send: `pastesToSave`, `pointerSend`, `sendsAsShellLine`, `pasteBytes` |
| `pwa/src/session/longPasteWords.ts` (new) | L1, C3 | Every new sentence, defined once |
| `pwa/src/session/pastedTurn.ts` (new) | L1, C3 | The chat's view model: `userTurnView`, `pendingTurnParts` |
| `pwa/src/session/usePasteSave.ts` (new) | L4, C3 | The saves: deadline, concurrency, identity, the unmount guard |
| `pwa/src/session/PastedTextChip.tsx` (new) | L4, C3 | The chat chip and the bubble body that places it |
| `pwa/src/session/Composer.tsx` | L4, C3 | `send()` routed through the plan and the hook; the hold while saving (see section 8) |
| `pwa/src/session/PasteChipBar.tsx`, `pasteChips.css` | L4, C3 | The saving line and the failed chip's notice, on the break notice's audited ground and ink |
| `pwa/src/session/MessageBubble.tsx`, `PendingBubble.tsx`, `ChatList.tsx`, `chat.css` | L4, C3 | The chip in the bubbles; the list prices a pointer as one row |

## 3. Every place a draft becomes sent text

1. **Send** (the button, Enter on a desk, Cmd/Ctrl+Enter on glass, all `send()`): with live chips and a session id,
   every chip without a file for its current text is saved, then the pointer text is sent with the tray's attachments
   exactly as today. Any failure: nothing is sent. A draft with no chip sends as today.
2. **The draft-conflict sheet's Replace draft and Append anyway** resend the pending's text, which is already the
   pointer text (the chip table empties at send): no chip, no save, no change.
3. **The failed bubble's Retry**: the store repeats the original call, pointer text, no save.
4. **Send it** presses Enter on what the box already holds.
5. **No client-side queued or offline send exists**: `queued` only marks a pending Claude Code queued in its pane, and
   nothing persists a draft. The slash pick replaces the draft. Copy, cut and Expand give the full text as before.
6. **A composer with no session id** (no live session to save into) sends as today. On `main` the composer is mounted by
   the session screen only, which always passes the id; no other screen sends a draft through the paste-chip rule (a
   search of `pwa/src` for the composer, the chip rule and `api.prompt`). The Overlord chat's record mode in #3488
   (`onRecord`) keeps today's route too: a record goes to the private store, never to a session file (agreed with its
   holder, section 8).

## 4. The rulings and conditions, as built

- **Shell line (condition 1, corrected).** When the text the pointer route would send, trimmed as the composer trims it
  and composed with the tray's paths as the prompt is composed, begins with `!`, the chips go as typed text by today's
  route, with no save and no tap (`sendsAsShellLine`). So `!`, and spaces, a tab or newlines then `!`, then a chip, is a
  shell line; a tray attachment in front is not; a chip first is not, even when its pasted text begins with `!`; a `!`
  anywhere but the start is not. **A departure from the design's "every paste chip"**, which the coordinator amends.
  **A change from before this wave:** a draft that opens with a chip whose pasted text begins with `!` was sent as that
  text and ran as a shell line; it now sends a pointer and does not.
- **Slash command (condition 2).** A draft that begins with `/` takes the pointer like any draft. A built-in command that
  reads its argument literally receives the pointer sentence, not the pasted text.
- **Identity (condition 3).** Each saved path is held beside the exact text it was saved from, and the plan uses it only
  while the chip's text is identical; otherwise it saves again.
- **The hold always ends (condition 4).** The upload is a POST and the API client gives a POST no deadline
  (`limitedFetch` bounds GETs only), so the hook races each save against `PASTE_SAVE_DEADLINE_MS` = **120 000 ms** (two
  minutes); past it the chip fails with its reason and Retry. At most `PASTE_SAVES_AT_ONCE` = `CLIP_MAX_PER_MESSAGE`
  (**4**) saves run at once: the tray already uploads its four at once, so the server and the agent link take four in
  parallel today; more chips wait their turn. While saving, Send is disabled and `aria-busy`, the row says
  `Saving pasted text…`, the field is read-only, and the paste, the drop and the attach button take nothing new.
- **A failed send after the saves (condition 5).** Today, and after this wave, the composer clears the field the moment
  the send is handed to the store; the store's pending bubble holds the text, failed, with Retry and Discard. The draft
  never comes back into the field. After this wave that text is the pointer text, so Retry and both draft-conflict
  choices resend it and save nothing.
- **Other mounts and dead sessions (condition 6).** Section 3, item 6. The composer is disabled for a dead or asleep
  session, so Send cannot start. If the upload refuses anyway (`404 unknown-session` once the registry row is gone, or
  any other refusal), the chip shows the upload's words and nothing is sent: no pointer is ever sent for a file that was
  not saved.
- **Hostile names (condition 7).** Cases for a dot run, an encoded slash, a second extension, upper and mixed case in
  the suffix, a trailing space, a parent step before the clips folder, and another session's id with this one's as a
  prefix and the reverse: each is text, or (the dot run, an extension inside the stem) a link inside this session's
  clips with the name encoded. An assistant turn and a system line holding a perfect pointer draw no chip.
- **Words (condition 8).** Every new sentence is in `longPasteWords.ts`; the chat's label and spoken name are composed in
  `pastedTurn.ts`, the failure reasons in the hook from those words; the upload's own words (`uploadErrorText`,
  `tooLargeText`) are reused, never copied.
- **The opened view (condition 9), a known limit.** The clip route serves `.txt` as `text/plain` with `nosniff` and no
  charset: the payload is a Buffer, and Fastify (5.12.7) adds `charset=utf-8` only to a string or JSON payload. The
  browser chooses the encoding, so an emoji or a non-Latin script can show wrongly in the opened tab in some browsers.
  True of every attached text document since the attach wave; it goes on the attach follow-up ticket. Nothing in the
  serve table changed; `server/test/paste-pointer-send.test.ts` pins today's header.
- **Secrets.** No toast for a chip's failure, nothing logged, the pointer carries only a count and a path, and the
  failure notice holds no character of the paste (a case pins it). The composer's chip row still shows the first line
  of the paste in the composer, as it did before this wave.
- **The length bound.** A pointer line is at most `PASTE_POINTER_MAX` = 400 characters, half the sender's collapse
  floor (`PASTE_COLLAPSE_FLOOR`, 800); the words are under 90 characters, the rest is the path. The composer checks every
  pointer it is about to send reads back as this session's and is within the bound; one that does not fails that chip
  with a reason, so nothing unreadable is sent.

## 5. Residuals, stated

- A file saved and then never sent (a save batch where another chip failed, then the operator removed the saved chip
  or used Send as typed text; or the operator left the session during a save) stays on the box until the session's clips
  go. No route deletes a clip, and the design adds none.
- A save that passed its deadline is not cancelled: its late answer may still leave a file, and a retry saves another.
- A lone UTF-16 surrogate in a paste is saved as U+FFFD (the encoder's one exception to byte for byte).

## 6. The existing composer cases

No assertion of `pwa/test/composer-paste-chips.test.tsx` changed. Every case there that sends mounts the composer
without a session id, and a composer with no session to save into sends today's text (section 3, item 6), so each
keeps its pin on today's route as it was: the one chip, several chips, a chip at each end, CR LF, tabs, a
whitespace-only chip, Expand, Remove and undo, Backspace, Delete and a word delete beside a chip, typed text losing a
marker, a selection ending inside a chip, review 3480's F1, and the retry and both draft-conflict paths. The two cases
there that mount with an id (the slash pick and a file pasted with text) send nothing. The new
`pwa/test/composer-long-paste.test.tsx` mounts with an id, as the session screen does, and pins the pointer route; its
"send as typed text" case pins that the operator's tap sends today's text.

The browser leg of wave 169, `pwa/browser/paste-chips.browser.test.ts`, opens the real session screen, which passes the
id, so its sends changed by intent: run on this head merged with `main`, 19 of its 33 cases failed at its one send
helper (a chip's send now saves first, and that leg simulated no upload route, so nothing went out). Every assertion
it held is kept, unchanged, on today's route through the operator's tap: the leg's upload route now refuses (502), and
its send helper (`sendAndSettle`, which now takes the key: Enter, or Ctrl+Enter in the touch-width case that used to
send inline) taps **send as typed text** when the save is refused, so each case still asserts one request whose `text`
is the full pasted text, byte for byte (`{ text: LONG }`, `` `a${LONG}b` ``, `` `www ${LONG} tail` ``, `` `x${LONG}` ``
and the rest as they were). A send with no chip goes out at once, as before. 33 of 33 green after the change.

## 7. Evidence

- **Red first.** The grammar's and the plan's cases failed on missing modules, then the plan's identity and shell-line
  cases failed by name before their code existed. The composer flow: 20 of its first 23 cases red against `main`'s
  composer (the three that passed are today's-route pins). The chat: 8 of 19 red against `main`'s bubbles and list (the
  11 that passed pin that look-alikes stay text). The browser leg's first run: 12 of 24 red, 8 because a case gave the
  chat no transcript (fixed in the case) and 4 on a real defect: the bubble's own `.msg-user a { color: inherit }`
  outranked `.msg-paste`, so the chip drew the bubble's ink (`--ink-primary`) on the well. Before the fix, in both skins
  at both widths: 1.09:1 in the light palette (measured; `#1A201B` on `#141715`) and 17.42:1 in phosphor (`#ECF0EC` on
  `#070808`, which passed by luck). After scoping the chip's rules under the bubble (`.msg-user .msg-paste`) it draws the
  document chip's pair, `--ink-on-well` on `--bg-well`: 13.98:1 in light and 15.52:1 in phosphor (the token values; the
  leg asserts at least 4.5:1 in each skin, palette and width). The server cases pin unchanged server behaviour, so their
  red is the grammar's mutants.
- **The tap floor.** The chat chip is a new hand-drawn control, so the control census registers it
  (`session/PastedTextChip.tsx <a> msg-paste`, TOKEN): the floor is the token on the tapped element itself, the anchor,
  from its own rule `.msg-user .msg-paste { min-height: var(--tap-min) }`. The browser leg measures the chip's height at
  44 px or more at 390 and at 1440 px, in both skins and palettes. The census file was held by #3488's claim; the entry
  went to its holder as an exact diff first. The first full pwa suite run after the implementation was red on exactly
  this missing entry (`control-census.test.ts`, "registers every one"), so the wave reports `suite: red`.
- **A slip.** Once, to see why the compiler check kept being killed at the test slice's memory cap, it was run outside
  the supported runner; that is not allowed for any reason, it was reported at once, and it was not repeated.
- **Mutants**, each run in memory against the cases (a scratch copy swapped in by an alias, nothing written in the
  tree): the grammar and the plan 24 of 24 killed (three more were equivalent, the code they guarded already implied by
  the path pattern or the final trim, and was removed); the hook, the composer, the view model, the chip row and the
  list 31 of 31 killed; the corrected shell line 3 of 3 (before the trim, the typed text in place of the pointer text,
  and the tray's count), killed.
- **Server tests naming a changed file**, each run alone: `server/test/rings/pwa-rings.test.ts`,
  `server/test/w7-compaction-parity.test.ts` (green). The guard suites (rings, single-definition, the censuses and the
  tree scanners that use the source-scan helper) ran as one batch: one red, the UTF-8 byte counter defined a second time
  in the send plan, fixed to call `shared/utf8.ts`.
- **Browser files** run one at a time on this head merged with `main`: listed in the wave-done mail.

## 8. The held composer file

`pwa/src/session/Composer.tsx` was held by claim 7542 (#3488, the Overlord chat). Its holder received the exact diff
against `main` 197665f6a0 and said yes (mail 39817); the diff was applied byte for byte. The merge rule both sides
agreed: the second to land keeps the record branch first in `send()`, on `expanded.trim()`, before any paste save;
`deliver()` calls `onSend?.(...)` as the optional prop; `canSend` holds both guards (`!recording` and `!saving`); and
#3488's three props (`onRecord`, `leading`, `onRecordCleared`) with their destructuring and the `{leading}` slot stay.

## 9. Words used here

- **Pointer:** the one line that names a saved pasted text in the sent message.
- **Chip:** in the composer, the paste's label in the field (unchanged); in the chat, the drawn pointer.
