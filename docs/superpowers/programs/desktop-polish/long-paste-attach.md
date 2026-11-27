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
| `shared/pastePointer.ts` (new) | L0, C3 | The grammar: `pastePointer`, `readPastePointer`, `splitPastePointers`, `linesWord` (the line-count word's one owner since review 4119), `PASTE_UPLOAD_NAME`, `PASTE_POINTER_MAX`; `isPastePointerLine` is gone (the list now reads with the bubbles' reader) |
| `pwa/src/session/pasteChips.ts` | L1, C3 | Review 4119: passes on the grammar's `linesWord` instead of defining its own |
| `pwa/src/session/pasteSend.ts` (new) | L1, C3 | The pure plan of a send: `pastesToSave`, `pointerSend`, `sendsAsShellLine`, `pasteBytes` |
| `pwa/src/session/longPasteWords.ts` (new) | L1, C3 | Every new sentence, defined once |
| `pwa/src/session/pastedTurn.ts` (new) | L1, C3 | The chat's view model: `userTurnView`, `pendingTurnParts`, and since review 4119 the list's price of a turn (`pricedParts`, `PASTED_CHIP_LINES`) and the turn's text for its evidence (`partsText`) |
| `pwa/src/session/usePasteSave.ts` (new) | L4, C3 | The saves: deadline, concurrency, identity, the unmount guard; since review 4119 a failure says whether a retry could change it, and a session change ends the hold |
| `pwa/src/session/PastedTextChip.tsx` (new) | L4, C3 | The chat chip and the bubble body that places it |
| `pwa/src/session/Composer.tsx` | L4, C3 | `send()` routed through the plan and the hook, one snapshot from the tap to the delivery; the hold while saving, the tray's fieldset and the drop's cancel included (see section 8) |
| `pwa/src/session/PasteChipBar.tsx`, `pasteChips.css` | L4, C3 | The saving line and the failed chip's notice, on the break notice's audited ground and ink |
| `pwa/src/session/MessageBubble.tsx`, `PendingBubble.tsx`, `ChatList.tsx`, `chat.css` | L4, C3 | The chip in the bubbles, linked on the whole turn's evidence; the list prices a pointer of this session as the chip it draws; the tray hold's rule |

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
  parallel today; more chips wait their turn. **The bound for n chips** is `ceil(n / 4)` × 120 s (each save its own
  deadline, four at a time); the composer does not cap n, so the bound grows with the number of chips in one draft.
  While saving, Send is disabled and `aria-busy`, the row says `Saving pasted text…`, the field is read-only, the chip
  row's Expand and Remove are disabled, the paste and the attach button take nothing new, a dropped file is cancelled
  (so the browser does not open it in place of the page) and taken nowhere, and the tray sits in a disabled fieldset,
  so its remove and retry cannot be used and read as disabled. A session change in place ends the hold too, with no
  failure shown (not reachable today: the session screen remounts per session).
- **One snapshot at the tap (review 4119 F1).** A send takes the text, the chip table and the tray's attachments as the
  tap saw them, decides the shell line on that snapshot, and delivers exactly it after the saves: nothing read after
  the tap changes what goes out. Before this round the delivery read the latest render's attachments, so an image
  removed from the tray during the save turned a `!` draft with an attachment in front into a shell line carrying the
  pointer sentence. A draft changed during the save by a way the hold does not cover (a script writing into the
  read-only field) is not sent, and stays.
- **A failed send after the saves (condition 5), as the coordinator ruled it.** IF the draft comes back into the field
  it comes back with its chips; it does not come back today and need not after this wave. As built: the field clears
  when the send is handed to the store, the failed bubble holds the pointer text with Retry and Discard, and Retry
  saves nothing again (both draft-conflict choices resend the pointer text and save nothing too).
- **A failure no retry can change (review 4119 F2).** A saved file whose pointer would not read back as this session's
  fails its chip with words that say it can go only as typed text, and offers only **send as typed text**: saving again
  would meet the same file for the same text. An upload's refusal and a deadline still offer Retry.
- **Other mounts and dead sessions (condition 6).** Section 3, item 6. The composer is disabled for a dead or asleep
  session, so Send cannot start. If the upload refuses anyway (`404 unknown-session` once the registry row is gone, or
  any other refusal), the chip shows the upload's words and nothing is sent: no pointer is ever sent for a file that was
  not saved.
- **Hostile names (condition 7).** Cases for a dot run, an encoded slash, a second extension, upper and mixed case in
  the suffix, a trailing space, a parent step before the clips folder, and another session's id with this one's as a
  prefix and the reverse: each is text, or (the dot run, an extension inside the stem) a link inside this session's
  clips with the name encoded. An assistant turn and a system line holding a perfect pointer draw no chip. Since
  review 4119 (F12): a right-to-left override, a newline and a carriage return in the file name are text (the grammar
  and the bubble each have a case), and a perfect pointer inside a tool result is drawn as the result's text, never a
  chip (the list draws it, every disclosure opened). **A bidi character in the path's prefix** (before
  `/.cc-clips/`) is accepted and the chip is drawn: the prefix is free text in the clip path pattern. It is harmless
  because nothing of the prefix is used: the link is built from the session id and the file name alone, the chip's
  label and spoken name say only the line count, and a case pins that the link, its decoded form and the chip's markup
  hold no part of the prefix.
- **Words (condition 8).** Every new sentence is in `longPasteWords.ts`; the chat's label and spoken name are composed in
  `pastedTurn.ts`, the failure reasons in the hook from those words; the upload's own words (`uploadErrorText`,
  `tooLargeText`) are reused, never copied. The line-count word ("1 line", "214 lines") has one owner since review
  4119 (F8): the pointer's grammar, `shared/pastePointer.ts`, which checks the word against the count; the composer's
  chip label and row read it through `pasteChips.ts`, which passes it on, and the words module imports it directly.
- **The chat list (review 4119 F6, F9).** The list prices a user turn with the bubbles' own reader, for this session
  only (a look-alike, or another session's pointer, is text in the price as in the drawing), and a chip at
  `PASTED_CHIP_LINES`: its tap floor (`--tap-min`, 44 px) and its two margins (`--sp-1`, 4 px each) over one bubble
  line (`--fs-base` 15 px at `--lh-normal` 1.5), about 2.3 lines. A case reads the four numbers back from the token
  sheet and the chat sheet; the browser leg measures the drawn chip against the price.
- **Links across a chip (review 4119 F4).** A turn with a chip is linked part by part, each part with the whole turn's
  repository evidence, read once; a turn with no pointer is one part, linked as before.
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
- The tray's file input is not a control the hold can disable (only its button is). In a browser it cannot answer
  during a save, since the picker is modal and its button is held, but a file that reached the tray after the tap by
  such a route is not in the send (a case pins it) and goes with the tray when the message is handed over.
- Whether a real Claude Code reads the pointer line without folding it is measured in use after release, as the design
  says; the coordinator carries it.

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
  cases failed by name before their code existed. **Corrected in review 4119 (F13)**, measured on the final files with
  only the named modules swapped for `main`'s (8a7bcacc8b): the composer flow is 31 of its 37 cases red against `main`'s
  composer (the six that pass: a draft with no chip and the two shell-line sends, which are today's route, and three
  cases of the save hook on its own, which no composer reaches); the chat is 10 of its 30 cases red against `main`'s
  bubbles and list (the twenty that pass: every case that a pointer-like line is text, in any turn, a tool result
  included; a pending send with no pointer; the echo, which is the store's; the chip's price constant and its tokens,
  which no list reaches; a look-alike's price; and both reference cases, since on `main` the pointer is text and the
  turn one part). The earlier "20 of 23" was the file's count when it had 23 cases. This round's new cases against the previous head 26697c43c6's modules: the composer 7 of 37 red (the
  three snapshot cases, the drop, the unpointable failure's words and offer, the session change in place), the chat 4
  of 48 red with the grammar file (the chip's price, the price of a turn and of a pending send, this session only, and
  a reference across a chip); the other new cases pin what already held and are each the kill of a mutant in section
  10. The browser leg's first run: 12 of 24 red, 8 because a case gave the
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
- **The compiler checks**, through the supported runner only: the pwa package and the server's source are clean on this
  round's tip. The server's test files (`test/tsconfig.tests.json`) are **unmeasured here**: the test slice's memory cap
  killed that check in both rounds (exit 137). The hosted server shard that runs `test/typecheck-tests.test.ts`
  compiles `server/test` through that config and covers it; it ran green on the first round's head.
- **A slip.** Once, to see why the compiler check kept being killed at the test slice's memory cap, it was run outside
  the supported runner; that is not allowed for any reason, it was reported at once, and it was not repeated.
- **Mutants**, each run in memory against the cases (a scratch copy swapped in by an alias, nothing written in the
  tree), every row re-run on the final tip of review 4119's fix round and listed in section 10 as a row a reviewer can
  replay: the grammar and the plan 24 of 24 red (three more were equivalent, the code they guarded already implied by
  the path pattern or the final trim, and was removed in the first round); the hook, the composer, the view model, the
  chip row and the list 30 of 30; the corrected shell line 3 of 3; this round's 20 of 20, the reviewer's five
  survivors among them by name (M07 as F9c, M15, M19, M21, M23). A no-op swap of each swapped module (the hook, the
  composer) was green 37 of 37 first, so no row is red by the swap itself.
- **The browser leg, this round**, on this head merged with `main` 8a7bcacc8b: 40 of 40. Its new cases, in both skins
  and palettes at 390 and 1440 px: while a send saves the tray's remove is disabled and a real click at its place does
  nothing, a dropped file's drag-over and drop are both cancelled (a dispatched drop never runs Chrome's own open-the-file
  default, so the cancel is what the case can pin; the page's address and the draft stay), and the send that goes is
  the tap's (the attachment, then the pointer); and the drawn chip agrees with its price within half a bubble line, the
  turn holding still (within 1 px) for 600 ms after its row is drawn. Wave 169's leg is 33 of 33 on the same merge.
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

Review 4119's fix round edited the file once more (now claim 7629, the same holder): the exact diff against this
branch's file (`main` 8a7bcacc8b's file plus the hunks above), and the holder's yes (mail 40129), applied byte for byte.
It adds, inside this wave's own lines only, the snapshot (`deliver` takes the tap's attachments), the tray's fieldset
and the drop's cancel. The merged `send()` keeps the order above: the record branch first (it reads no attachments),
then the pointer branch, then today's send through `deliver(text, files)`, whose calls stay `onSend?.(...)` on #3488's
optional prop. Whichever lands second re-runs both sides' composer cases (the record suite and this wave's hold cases)
on the merged file.

## 9. Words used here

- **Pointer:** the one line that names a saved pasted text in the sent message.
- **Chip:** in the composer, the paste's label in the field (unchanged); in the chat, the drawn pointer.

## 10. Mutants, row by row (review 4119 F13)

Every row was run on the final tip of the fix round. To replay one: in the named file, replace the first text with the
second (`⏎` is a line break, `…` marks a row shortened here), run the named suite from `pwa/` through the supported
runner (`./node_modules/.bin/vitest run <suite>`), see the named case red, and put the file back. Each row names the
first case that went red; several rows turn more than one case red. The ids are this branch's own; the reviewer's
five survivors are M15, M19, M21 and M23 by their own names, and M07 (the old any-session pricing test, removed this
round) as F9c.

**The grammar and the send plan** (24 rows)

- P1-plural-always: in `shared/pastePointer.ts`, `lines === 1 ? 'line' : 'lines'` becomes `'lines'`; run `test/paste-`; red: test/paste-chips.test.ts: the label grammar, with one owner for the line count > is the console’s, numbered, with the line count, its spaces no-break; in the field it sits between the markers.
- P2-count-zero-lead: in `shared/pastePointer.ts`, `([1-9]\d{0,8})` becomes `(\d{1,9})`; run `test/paste-`; red: test/paste-pointer.test.ts: reading a pointer > reads nothing for a near miss of the words.
- P3-word-agreement: in `shared/pastePointer.ts`, `if ((m[2] === 'line') !== (lines === 1)) return null;` becomes (nothing); run `test/paste-`; red: test/paste-pointer.test.ts: reading a pointer > reads nothing for a near miss of the words.
- P4-whole-clip-path: in `shared/pastePointer.ts`, `if (!WHOLE_CLIP_PATH.test(path)) return null;` becomes (nothing); run `test/paste-`; red: test/paste-pointer.test.ts: reading a pointer > reads nothing for a path outside the clips store or one that climbs.
- P5-dot-segments: in `shared/pastePointer.ts`, `if (segs.some((s) => s === '.' || s === '..')) return null;` becomes (nothing); run `test/paste-`; red: test/paste-pointer.test.ts: reading a pointer > reads nothing for a path outside the clips store or one that climbs.
- P6-session-folder: in `shared/pastePointer.ts`, `  if (segs[segs.length - 2] !== sessionId) return null;⏎` becomes (nothing); run `test/paste-`; red: test/paste-pointer.test.ts: reading a pointer > reads nothing for another session, even one whose id is a prefix or a suffix of this one.
- P8-name-tail: in `shared/pastePointer.ts`, `if (!name.endsWith(PASTE_NAME_TAIL)) return null;` becomes (nothing); run `test/paste-`; red: test/paste-pointer.test.ts: reading a pointer > reads nothing for a clip that is not a pasted text.
- P10-split-keeps-text: in `shared/pastePointer.ts`, `if (pointer === null) {` becomes `if (true) {`; run `test/paste-`; red: test/paste-pointer.test.ts: splitting a turn into text and pointers > keeps the pointer in its place between the text around it.
- P11-words-tail: in `shared/pastePointer.ts`, `'; read that file as part of this message.'` becomes `'; read that file as part of this message'`; run `test/paste-`; red: test/paste-pointer.test.ts: the pointer words > says the count, the path and that the file is part of the message.
- P12-max: in `shared/pastePointer.ts`, `PASTE_POINTER_MAX = 400` becomes `PASTE_POINTER_MAX = 800`; run `test/paste-`; red: test/paste-pointer.test.ts: the pointer words > states its length bound under the collapse floor the sender reads (800).
- P13-upload-name: in `shared/pastePointer.ts`, `PASTE_UPLOAD_NAME = 'paste.txt'` becomes `PASTE_UPLOAD_NAME = 'pasted-text.txt'`; run `test/paste-`; red: test/paste-pointer.test.ts: the pointer words > uploads under a neutral name that carries no word of the paste.
- S1-save-filter: in `pwa/src/session/pasteSend.ts`, `.filter((n) => fileOf(n, chips, saved) === undefined)` becomes (nothing); run `test/paste-send`; red: test/paste-send.test.ts: which pasted texts still need saving > skips a chip already saved, so a retry never saves it twice.
- S2-dedupe: in `pwa/src/session/pasteSend.ts`, `if (!out.includes(s.n)) out.push(s.n)` becomes `out.push(s.n)`; run `test/paste-send`; red: test/paste-send.test.ts: which pasted texts still need saving > names every chip the draft sends that has no file, once each, in field order.
- S3-length-bound: in `pwa/src/session/pasteSend.ts`, `line.length <= PASTE_POINTER_MAX && ` becomes (nothing); run `test/paste-send`; red: test/paste-send.test.ts: a send it refuses to build > refuses a pointer longer than 400 characters.
- S4-read-back: in `pwa/src/session/pasteSend.ts`, ` && readPastePointer(line, sessionId)?.path === path` becomes (nothing); run `test/paste-send`; red: test/paste-send.test.ts: a send it refuses to build > refuses a saved path whose pointer would not read back as this session's.
- S5-no-break-after: in `pwa/src/session/pasteSend.ts`, `(breakNext || isPointer)` becomes `isPointer`; run `test/paste-send`; red: test/paste-send.test.ts: the text that goes out > keeps text before a chip before it and text after it after it, adding only the line breaks.
- S6-no-break-before: in `pwa/src/session/pasteSend.ts`, `(breakNext || isPointer)` becomes `breakNext`; run `test/paste-send`; red: test/paste-send.test.ts: a slash command with a chip > takes the pointer like any draft.
- S7-ends-newline: in `pwa/src/session/pasteSend.ts`, `!out.endsWith('\n') && ` becomes (nothing); run `test/paste-send`; red: test/paste-send.test.ts: the text that goes out > adds no break where a line already ends or begins.
- S8-starts-newline: in `pwa/src/session/pasteSend.ts`, ` && !piece.startsWith('\n')` becomes (nothing); run `test/paste-send`; red: test/paste-send.test.ts: the text that goes out > adds no break where a line already ends or begins.
- S10-trim: in `pwa/src/session/pasteSend.ts`, `text: out.trim()` becomes `text: out`; run `test/paste-send`; red: test/paste-send.test.ts: a shell line > agrees with the pointer text as it will be typed.
- S11-strip-markers: in `pwa/src/session/pasteSend.ts`, `add(stripMarkers(value.slice(at, c.start)), false);` becomes `add(value.slice(at, c.start), false);`; run `test/paste-send`; red: test/paste-send.test.ts: the text that goes out > drops the field's own stray markers, as the expansion does.
- S12-unsaved-gate: in `pwa/src/session/pasteSend.ts`, `if (unsaved.length > 0) return` becomes `if (false) return`; run `test/paste-send`; red: test/paste-send.test.ts: which pasted texts still need saving > saves again a chip whose saved file was made from any other text, so no pointer names another text's file.
- S13-bytes: in `pwa/src/session/pasteSend.ts`, `export const pasteBytes = (text: string): number => utf8Bytes(text);` becomes `export const pasteBytes = (text: string): number => text.length;`; run `test/paste-send`; red: test/paste-send.test.ts: the size a pasted text is saved at > counts UTF-8 bytes, as the file holds them.
- S14-unpointable-gate: in `pwa/src/session/pasteSend.ts`, `if (bad.length > 0) return` becomes `if (false) return`; run `test/paste-send`; red: test/paste-send.test.ts: a send it refuses to build > refuses a saved path whose pointer would not read back as this session's.

**The hook, the composer, the view model, the chip row and the list** (30 rows)

- H1-deadline: in `pwa/src/session/usePasteSave.ts`, `if (clip === 'late') return` becomes `if (false) return`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > a save past its deadline fails with Retry, so the hold always ends.
- H2-busy: in `pwa/src/session/usePasteSave.ts`, `if (busy.current) return null;` becomes (nothing); run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: the save hook on its own > answers null to a second save while one runs, and uploads nothing more for it.
- H3-mounted: in `pwa/src/session/usePasteSave.ts`, `    if (!mounted.current) return null;⏎` becomes (nothing); run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > leaving the session while a save is in flight sends nothing.
- H4-at-once: in `pwa/src/session/usePasteSave.ts`, `Math.min(PASTE_SAVES_AT_ONCE, todo.length)` becomes `todo.length`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > runs at most four saves at once; the rest wait their turn.
- H5-too-large: in `pwa/src/session/usePasteSave.ts`, `if (bytes > CLIP_MAX_BYTES) return` becomes `if (false) return`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a failed save sends nothing > a pasted text over the limit is refused before any request, in the tray's words.
- H6-failures: in `pwa/src/session/usePasteSave.ts`, `setFailures(failed);` becomes `setFailures(new Map());`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a failed save sends nothing > nothing is sent and nothing typed: the prompt call is never made; the chip says why, with no paste text.
- H7-saving: in `pwa/src/session/usePasteSave.ts`, `setSaving(true);` becomes (nothing); run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > visibly; the field and the tray take nothing; a second tap or Enter sends nothing twice.
- H9-name: in `pwa/src/session/usePasteSave.ts`, `new File([text], PASTE_UPLOAD_NAME,` becomes `new File([text], 'x.txt',`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a send with chips saves each pasted text and sends pointers > one chip: one file of its text, and the message is its pointer line.
- H11-words: in `pwa/src/session/usePasteSave.ts`, `pasteFailedText(n, uploadErrorText(apiErrorText(err)))` becomes `pasteFailedText(n, String(err))`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a failed save sends nothing > nothing is sent and nothing typed: the prompt call is never made; the chip says why, with no paste text.
- H12-identity-store: in `pwa/src/session/usePasteSave.ts`, `saved.current.set(n, { path: clip.path, text });` becomes `saved.current.set(n, { path: clip.path, text: chips0 });`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a send with chips saves each pasted text and sends pointers > one chip: one file of its text, and the message is its pointer line.
- C1-shell: in `pwa/src/session/Composer.tsx`, ` && !sendsAsShellLine(v, table, files.length)` becomes (nothing); run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a shell line goes as typed text > `!` then a chip sends today's text and saves nothing.
- C2-shell-attach: in `pwa/src/session/Composer.tsx`, `sendsAsShellLine(v, table, files.length)` becomes `sendsAsShellLine(v, table, 0)`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a shell line goes as typed text > a tray attachment in front makes it no shell line: the chip takes the pointer.
- C3-cansend-saving: in `pwa/src/session/Composer.tsx`, `!broken && !saving` becomes `!broken`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > visibly; the field and the tray take nothing; a second tap or Enter sends nothing twice.
- C4-readonly: in `pwa/src/session/Composer.tsx`, `readOnly={saving}` becomes `readOnly={false}`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > visibly; the field and the tray take nothing; a second tap or Enter sends nothing twice.
- C5-paste-guard: in `pwa/src/session/Composer.tsx`, `if (saving) {` becomes `if (false) {`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > visibly; the field and the tray take nothing; a second tap or Enter sends nothing twice.
- C6-deliver-guard: in `pwa/src/session/Composer.tsx`, `    if (disabled || askUp) return;⏎    // An explicit` becomes `    // An explicit`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > a question card that comes up while saving keeps the draft: nothing is sent, and the saved file is reused later.
- C8-unpointable: in `pwa/src/session/Composer.tsx`, `else if (plan.kind === 'unpointable')` becomes `else if (false)`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a failed save sends nothing > a saved path that would not read back as this session's is refused, and nothing is sent.
- C9-typed: in `pwa/src/session/Composer.tsx`, `onSendTyped={sendTyped}` becomes `onSendTyped={send}`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a failed save sends nothing > that failure offers only "Send as typed text" (Retry could change nothing), and its tap sends the typed text.
- C10-retry: in `pwa/src/session/Composer.tsx`, `onRetry={send}` becomes `onRetry={sendTyped}`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a failed save sends nothing > Retry saves only what is still missing and reuses the saved file.
- C11-busy: in `pwa/src/session/Composer.tsx`, `aria-busy={saving || undefined}` becomes (nothing); run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > visibly; the field and the tray take nothing; a second tap or Enter sends nothing twice.
- C12-attach: in `pwa/src/session/Composer.tsx`, `disabled={disabled || saving} onPick` becomes `disabled={disabled} onPick`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > visibly; the field and the tray take nothing; a second tap or Enter sends nothing twice.
- C13-drop: in `pwa/src/session/Composer.tsx`, `        if (saving) return;⏎` becomes (nothing); run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > visibly; the field and the tray take nothing; a second tap or Enter sends nothing twice.
- C16-pointer-route: in `pwa/src/session/Composer.tsx`, `if (plan.kind === 'ready') deliver.current(plan.text, files);` becomes `if (plan.kind === 'ready') deliver.current(expanded.trim(), files);`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a send with chips saves each pasted text and sends pointers > one chip: one file of its text, and the message is its pointer line.
- T1-paste-part: in `pwa/src/session/pastedTurn.ts`, `parts.push(pasteView(part.pointer.name, part.pointer.lines));` becomes `parts.push({ kind: 'text', text: '' });`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: a user turn with a pointer > draws the chip in its place, between the text around it, linking to this session's clip.
- T2-pending-paste: in `pwa/src/session/pastedTurn.ts`, `if (part.kind === 'paste') return [pasteView(part.pointer.name, part.pointer.lines)];` becomes (nothing); run `test/pasted-turn`; red: test/pasted-turn.test.tsx: the pending bubble > draws the same chip in its place before the echo arrives, and when the send failed.
- T4-split-whole: in `pwa/src/session/pastedTurn.ts`, `for (const part of splitPastePointers(text, sessionId)) {⏎    if (part.kind === 'paste') {⏎      parts.push` becomes `for (const part of [{ kind: 'text' as const, text }]) {⏎    if (part.kind === 'paste') {⏎      parts.push`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: a user turn with a pointer > draws the chip in its place, between the text around it, linking to this session's clip.
- B1-saving-line: in `pwa/src/session/PasteChipBar.tsx`, `{saving && <p` becomes `{false && <p`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > visibly; the field and the tray take nothing; a second tap or Enter sends nothing twice.
- B3-live-only: in `pwa/src/session/PasteChipBar.tsx`, `[...new Set(chips.map((c) => c.n))]` becomes `[...(failures?.keys() ?? [])]`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a failed save sends nothing > a failed chip that is removed takes its notice with it.
- L1-price: in `pwa/src/session/ChatList.tsx`, `lines: turnLines(pricedParts(parts), m.bubble)` becomes `lines: plainLines(pricedParts(parts).text, m.bubble)`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: the list prices a pointer as the chip it draws > for a confirmed turn and for a pending one.
- L2-price-pending: in `pwa/src/session/ChatList.tsx`, `lines: turnLines(pricedParts(pendingTurnParts(item.send.text, session)), m.bubble)` becomes `lines: plainLines(item.send.text, m.bubble)`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: the list prices a pointer as the chip it draws > for a confirmed turn and for a pending one.

**The corrected shell line** (3 rows)

- SH1-before-trim: in `pwa/src/session/pasteSend.ts`, `return stripMarkers(value.slice(0, first?.start ?? value.length)).trim().startsWith('!');` becomes `return stripMarkers(value.slice(0, first?.start ?? value.length)).startsWith('!');`; run `test/paste-send`; red: test/paste-send.test.ts: a shell line > is one after a leading space or newline too, which the send trims away.
- SH2-typed-text: in `pwa/src/session/pasteSend.ts`, `return stripMarkers(value.slice(0, first?.start ?? value.length)).trim().startsWith('!');` becomes `return expandValue(value, chips).trim().startsWith('!');`; run `test/paste-send`; red: test/paste-send.test.ts: a shell line > is a draft whose typed text, as it will be typed, begins with `!`.
- SH3-attachments: in `pwa/src/session/pasteSend.ts`, `if (attachments > 0) return false;` becomes (nothing); run `test/paste-send`; red: test/paste-send.test.ts: a shell line > is not one when a tray attachment leads the composed prompt.

**This round (review 4119)** (20 rows)

- F1a-deliver-latest: in `pwa/src/session/Composer.tsx`, `    if (files.length > 0) onSend(text, { attachments: files });` becomes `    if (attachments.length > 0) onSend(text, { attachments });`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a send is one snapshot taken at the tap (review 4119 F1) > a `!` draft with an attachment in front: the attachment removed during the save still goes, so no shell line.
- F1b-tray-hold: in `pwa/src/session/Composer.tsx`, `<fieldset className="attach-tray-hold" disabled={saving}>` becomes `<fieldset className="attach-tray-hold" disabled={false}>`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a send is one snapshot taken at the tap (review 4119 F1) > the tray's remove control cannot be used while saving, and says so.
- F7a-drop-cancel: in `pwa/src/session/Composer.tsx`, `        if (id === undefined || disabled) return;⏎        if (e.dataTransfer.files.length === 0) return;` becomes `        if (id === undefined || disabled || saving) return;⏎        if (e.dataTransfer.files.length === 0) …`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a send is one snapshot taken at the tap (review 4119 F1) > a file dropped during a save is cancelled, so the browser keeps the page, and is taken nowhere.
- F7b-dragover-target: in `pwa/src/session/Composer.tsx`, `if (!saving) setDropping(true);` becomes `setDropping(true);`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a send is one snapshot taken at the tap (review 4119 F1) > a file dropped during a save is cancelled, so the browser keeps the page, and is taken nowhere.
- M19-stale-draft: in `pwa/src/session/Composer.tsx`, `if (saved === null || valueNow.current !== v) return;` becomes `if (saved === null) return;`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > a draft changed while saving by any way the hold does not cover is not sent, and stays.
- M21-chip-row-hold: in `pwa/src/session/Composer.tsx`, `onRemove={removePaste} disabled={disabled || saving}` becomes `onRemove={removePaste} disabled={disabled}`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > the chip row's Expand and Remove cannot be used while saving.
- M15-four-at-once: in `pwa/src/session/usePasteSave.ts`, `export const PASTE_SAVES_AT_ONCE = CLIP_MAX_PER_MESSAGE;` becomes `export const PASTE_SAVES_AT_ONCE = 100;`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: Send is held while saving > runs at most four saves at once; the rest wait their turn.
- M23-session-table: in `pwa/src/session/usePasteSave.ts`, `  useEffect(() => { saved.current = new Map(); }, [id]);` becomes (nothing); run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: the save hook on its own > another session starts the saved table again: the same draft is saved anew there.
- F3-session-change-hold: in `pwa/src/session/usePasteSave.ts`, `    if (!mounted.current) return null;` becomes `    if (!mounted.current || idNow.current !== sid) return null;`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: the save hook on its own > a session change in place while a save runs ends the hold: the answer is dropped, nothing fails.
- F2a-retry-offered: in `pwa/src/session/PasteChipBar.tsx`, `{why.retry && (` becomes `{(why.retry || true) && (`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a failed save sends nothing > that failure offers only "Send as typed text" (Retry could change nothing), and its tap sends the typed text.
- F2b-unpointable-retry: in `pwa/src/session/usePasteSave.ts`, `[n, { text, retry: false }]` becomes `[n, { text, retry: true }]`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a failed save sends nothing > that failure offers only "Send as typed text" (Retry could change nothing), and its tap sends the typed text.
- F5-echo-match: in `pwa/src/stores/session.ts`, `if (e.kind === 'user') echoes = (p) => sameSent(composePrompt(p.text, pathsOf(p) ?? []), e.text);` becomes `if (e.kind === 'user') echoes = () => true;`; run `test/composer-long-paste`; red: test/composer-long-paste.test.tsx: a send that fails after the saves (condition 5) > the store clears the pending send on the echo of the pointer text, and on no other.
- F6a-chip-one-line: in `pwa/src/session/ChatList.tsx`, `priced.chips * PASTED_CHIP_LINES` becomes `priced.chips`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: the list prices a pointer as the chip it draws > for a confirmed turn and for a pending one.
- F6b-chip-lines-value: in `pwa/src/session/pastedTurn.ts`, `(44 + 2 * 4) / (15 * 1.5)` becomes `1`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: the list prices a pointer as the chip it draws > the chip costs its tap floor and its two margins over one line of the bubble: 52 over 22.5, about 2.3 lines.
- F9a-any-session-confirmed: in `pwa/src/session/ChatList.tsx`, `const { paths, parts } = userTurnView(event.text, session);` becomes `const { paths, parts } = userTurnView(event.text, /\.cc-clips\/([^/\s]+)\//.exec(event.text)?.[1] ?? session);`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: the list prices a pointer as the chip it draws > only a pointer of this session is a chip, as the bubble draws it: another session's is text here.
- F9b-any-session-pending: in `pwa/src/session/ChatList.tsx`, `pendingTurnParts(item.send.text, session)` becomes `pendingTurnParts(item.send.text, /\.cc-clips\/([^/\s]+)\//.exec(item.send.text)?.[1] ?? session)`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: the list prices a pointer as the chip it draws > only a pointer of this session is a chip, as the bubble draws it: another session's is text here.
- F9c-look-alike-priced: in `pwa/src/session/ChatList.tsx`, `lines: turnLines(pricedParts(parts), m.bubble)` becomes `lines: turnLines({ ...pricedParts(parts), chips: event.text.split('\n').filter((l) => l.startsWith('The pas…`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: the list prices a pointer as the chip it draws > a look-alike is priced as the text it is drawn as.
- F4-turn-evidence: in `pwa/src/session/MessageBubble.tsx`, `linkify(t, refs, said)` becomes `linkify(t, refs)`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: a turn's repository evidence is the whole turn's (review 4119 F4) > a repository named before a chip still qualifies a bare reference after it.
- F12-link-from-prefix: in `pwa/src/session/pastedTurn.ts`, `parts.push(pasteView(part.pointer.name, part.pointer.lines));` becomes `parts.push(pasteView(part.pointer.path, part.pointer.lines));`; run `test/pasted-turn`; red: test/pasted-turn.test.tsx: a user turn with a pointer > draws the chip in its place, between the text around it, linking to this session's clip.
- F8-word-owner: in `shared/pastePointer.ts`, `` export const linesWord = (lines: number): string => `${String(lines)} ${lines === 1 ? 'line' : 'lines'}`; `` becomes `` export const linesWord = (lines: number): string => `${String(lines)} lines`; ``; run `test/paste-`; red: test/paste-chips.test.ts: the label grammar, with one owner for the line count > is the console’s, numbered, with the line count, its spaces no-break; in the field it sits between the markers.
