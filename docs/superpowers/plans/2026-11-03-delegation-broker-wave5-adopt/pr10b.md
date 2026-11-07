# PR10b: the PWA's worktree controls, finished (run 1625)

Delegation broker wave 5, PR10b: review 1624's findings on PR10 (#2419), which landed at its reviewed head after three
review rounds. Cut from `main` at `0ba6431c6` (PR10 merged). Deploy class PWA, which ships with the server box. Scope as
the coordinator's rulings for this PR set it: every item under "Rows and fixes", each with a row and a mutant, and this
note. No server source file changes, no new storage key, no new string the operator reads beyond the ones PR10 drew; every
drawn string stays in the operator's words (worktree, session, run, kept). The census lines PR10 ruled are unchanged.

## Ledger

No new number. D-8096 (2) is amended in place for F7 (below): a 2xx's `expiresAt` is handed on as it came and read once,
in the words module, by the wire's own reader. D-8095 and D-8097 are unchanged: D-8097's region is still "mounted empty"
(F5 empties its text; the region stays). `pr10.md` is corrected in place where the rulings say so: review 1624 F3, F5
and F11 (e); in fix round 1, review 1626 F7, F10 and F12; in fix round 2, review 1628 F3.
The head commit's `Ledger-Edit` trailer names both.

## What changed

- **F1** (`pwa/src/fleet/ProjectCard.tsx`, `WorktreeControls`): the hand-off clears the box's focus flag, whether or not a
  blur said so, since a removed element fires none. Every focus the row moves (the box after an act, the box after a
  confirm, the hand-off to a heading) passes `{ preventScroll: true }`, as the sheet's do (D-5610).
- **F2** (rows only; the code was right): an unknown word at a status no door sends (`500`) and a `409` body with no `ok`
  each reach `failedTo`'s words.
- **F3**: a dropped ask (the row stops offering the act while its confirm is open) now places the focus unless it is
  already in the row's box. PR10's rule held back whenever anything but the page held the focus. Measured in Chrome
  (below): when the sheet's opener had gone, the closing panel still held the focus through its exit, so the placement
  never fired, and the focus fell to the page once the panel left. A new browser row on the real sheet asserts
  `document.activeElement` after Cancel, Keep, a refusal and a dropped ask, at 390 (the bottom sheet) and 1280 (the
  centred dialog); since fix round 1, in both skins and palettes at 390, 1280 and 1920 (review 1626 F14).
- **F4 (a)**: a row starts two acts inside one `act`, so no render runs between them and no control is disabled yet: a
  confirm then a Keep, a Keep then a confirm, and a confirm twice. Each posts once.
- **F4 (b)**: an unowned row whose controls go (its hidden record is gone) while its box holds the focus hands it to its
  group's toggle, never the card's.
- **F5 (ruled: clear it)**: the words module's `offerOf` spells what a row offers: the record's id first (since fix
  round 1, review 1626 F4), then the worktree's state on the wire, then each control, an attach with its session. When it changes, the refusal sentence is cleared; the region stays mounted.
  `pr10.md`'s F3 (c) text is corrected.
- **F7** (the coordinator's ruling on a conflict, below): `readDoorAnswer` reads `ok` and hands `expiresAt` on as it came;
  `actDoneWord`, in the words module, reads it once through `delegationLeaseExpiresAtOf`, the wire's own reader, so the
  field has one reader and one absence rule. D-8096 (2) is amended in place to say so.
- **F8** (browser): the resting-place check also hit-tests the Add project row, which follows the fleet list outside it,
  and its comment says what it measures. It also counts the floating buttons: one at 390, none at 1280 and 1920, where
  neither skin mounts one. There the overlap half of the check is empty by design, and the tap half still runs.
- **F11 (a)**: an open ask remembers the record it was asked about, and `offered` compares that too. A record replaced on
  the same worktree while the confirm is open drops the ask, which posts to neither record.
- **F11 (e)**: `pr10.md`'s "Goes red" column now matches round 2's log in the five rows that understated it (W5-UM2,
  W5-UM3, W5-UM4, W5-UM5, W5-UM7). Which of PR10's mutants have their edit text recorded, and which keep that table's
  text as their record, is listed under fix round 1 (F7) below.

## Rows

| Ruling | Row | File | Red before | Green after |
|---|---|---|---|---|
| F1 | "F1 (review 1624): a hand-off clears the box's hold …" | `project-card.test.tsx` | red on the base's hand-off (F1-flag) and on each focus without `preventScroll` | green |
| F2 | "F2 (review 1624): an unknown word at a status no door sends, and a 409 body with no ok …" | `project-card.test.tsx` | the code it pins is the base's, which is right: red under each part's mutant | green |
| F3 | "F3 (review 1624): an ask its row stops offering … places it in the box" | `project-card.test.tsx` | green under the base's placement (F3-old-placement: jsdom unmounts the sheet at once, so the page holds the focus); red under F3-dropped | green |
| F3 | "the focus around a worktree control's real sheet (review 1624 F3)", at 390 and 1280 (since fix round 1, at 390, 1280 and 1920 in both skins and palettes) | `delegation-rows.browser.test.ts` | red on the base's placement (F3-old-placement): "after a dropped ask: expected 'body'" | green |
| F4 (a) | "an act in flight (review 1624 F4 (a))" | `worktree-confirm-close.test.tsx` | the code it pins is the base's, which is right: red under F4a-inflight and F4a-send-only | green |
| F4 (b) | "F4 (b) (review 1624): an unowned row that loses its controls …" | `project-card.test.tsx` | the code it pins is the base's, which is right: red under F4b-grouped | green |
| F5 | "F5 (review 1624): a refusal is cleared when the row's state moves …", and F3 (c)'s last assertion | `project-card.test.tsx` | red without the clearing (F5-clear) and without the state in `offerOf` (F5-state) | green |
| F7 | "a door's accepted answer (review 1624 F7)" | `delegation-words.test.ts` | red under a client that applies its own rule, as the base's did (F7r-client-reads), and under a copy of the rule in the words (F7r-words-respell) | green |
| F8 | the resting-place check, now with the Add project row and the floating-button count | `delegation-rows.browser.test.ts` | green under F8-pad2 on the base (review 1624 measured it) | green; red under F8-pad2 |
| F11 (a) | "F11 (a) (review 1624): an open Not delegated drops its ask when the record … is replaced" | `project-card.test.tsx` | red under the base's `offered` (F11a-lease) | green |

The F7 row loads a fresh `wireReaders` and words module over a wrapped `shared/api`: the test setup loads both through the
fleet store before any test file's mock applies, so a static import would read the real reader.

## Mutation table

One mutant at a time, applied to a saved copy and restored with its sha checked (every restore sha-ok), each run through
`ccrc test` under `timeout -k` and a process cap. The raw log records each mutant's edit text beside its run line and
result.

| Mutant | Edit | Goes red |
|---|---|---|
| F2-door-status | `readDoorRefusal`: `&& DOOR_STATUSES.has(status)` dropped | F2 (review 1624) |
| F2-ok | `readDoorRefusal`: `body.ok !== false` dropped | F2 (review 1624) |
| F1-flag | the hand-off keeps the flag (the base's) | F1 (review 1624): "no focus moved at an unrelated moment" |
| F1-scroll-handoff | the hand-off's focus without `preventScroll` | F1 (review 1624) |
| F1-scroll-send | the box's focus as an act starts, without `preventScroll` | F1 (review 1624) |
| F1-scroll-settle | the box's focus after a confirm, without `preventScroll` | F1 (review 1624) |
| F3-dropped | `settle.current = 'dropped'` deleted | F3 (review 1624) in jsdom; the browser row at 390 and 1280 |
| F3-old-placement | the base's placement (hold back unless the page holds the focus) | the browser row at 390 and 1280; the jsdom file stays green, since jsdom unmounts the sheet at once |
| F4a-inflight | both in-flight checks deleted (the confirm's and the act's) | F4 (a) |
| F4a-send-only | the act's in-flight check deleted | F4 (a) |
| F4a-confirm-only | the confirm's in-flight check deleted | GREEN, measured: the act's own check stops the second post; see below |
| F4b-grouped | the unowned row's `grouped` dropped | F4 (b) (review 1624) |
| F5-clear | the clearing effect deleted | F5 (review 1624), F3 (c) |
| F5-state | `offerOf` without the worktree's state | F5 (review 1624) |
| F7r-client-reads | `readDoorAnswer` applies the rule itself again, as the base did | the F7 row ("42: expected { ok: true, expiresAt: null }"); the card file stays green, since the behaviour is the same |
| F7r-words-respell | `actDoneWord` spells the rule itself instead of calling the reader | the F7 row (the reader's answer is not the note's date); the card file green, as above |
| F7r-words-respell-changed | `actDoneWord` spells the rule itself and changes it: an absent date reads as today | the F7 row; F8 (a) (review 1623) in the card file |
| F7r-caller-changed | the card's toast call re-spells the rule and changes it: any value that is no string reads as today | F8 (a) (review 1623) in the card file |
| F7r-shared | the wire's reader reads absence as an empty date | W5-U1 and F9 (g) in the words file, and F8 (a) (review 1623) in the card file, all through the row's own kept words; the F7 row stays green (an empty date is no date to `keptWord`) |
| F11a-lease | `offered` without the record's id | F11 (a) (review 1624) |
| F8-pad2 | `.fleet-list`'s end padding 0 and `.fleet`'s bottom padding cut to `--safe-bottom` | the browser suite at 390, 4 failed: "+ Add project: clear of the floating button at the end of the list" |
| F7-respell, F7-shared, F7-shared-on-base, F7-base-line, F7-respell-changed | F7's first shape (`readDoorAnswer` calling the reader), which the census turned red | replaced at the tip by the `F7r-*` mutants above; their edit text no longer applies to the code, and their results stay in the log |

PR10's table mutants that sit on code this round changed, re-run on it: F1-guard (3 rows), F2-any (2: round 2's F2 row and
this round's), F2-place (6), F2-leave (2), F3a-none (4), F3b-removed (2), F3-group (2), F4-clear (worktree-confirm-close 1,
project-card 1), F4-act-only (1), F4-open-gate (worktree-confirm-close 1; the card file green, as PR10 disclosed),
F9b-offered (project-card 5, worktree-confirm-close 1), F8a-absent (1). Each is red where its table row says, and some now
red this round's rows too.

## Measured, not departures

- **The dropped placement in a real browser (F3).** Chrome at 390 and 1280, Refined, light: the lone session's raw
  worktree, Attach open, then a frame moves the row to `promoted`. On PR10's code the focus ends on the page
  ("after a dropped ask: expected 'body'"); on this round's it ends on the row's box. Cancel gives the focus back to the
  control that opened the confirm, Keep leaves it on the box, and a refused confirm leaves it on the box with the
  sentence said, on both arms.
- **F4 (a)'s shape.** The ruling's literal shape, a confirm tapped twice inside one `act`, is stopped by the confirm's
  own ref (review 1623 F1) before either in-flight check is reached, so that shape alone pins neither. The row also starts
  a confirm and a Keep together, in both orders, and that pins the pair (F4a-inflight) and the act's own check
  (F4a-send-only). The confirm's check alone stays green: whenever it would refuse, the act's check refuses the same post
  one call later. So it is redundant for posts, but not for focus: without it, a refused confirm would still clear its
  ref and settle as an act, and the sheet's close would then place the focus for an act this confirm never started
  (review 1626 F11). The guard stays.
- **F7 and the scope census.** The ruled fix, `readDoorAnswer` calling `delegationLeaseExpiresAtOf`, turned the wave-3 scope
  census red ("8. the closed scope census": "a PWA file outside PR2's list that names the broker: `wireReaders.ts`"): its
  wave-4 word is `/delegation/i` with no word boundary, so any import naming the reader, or a path through the words
  module, names the broker in a file the census does not allow it in, and the brief keeps the census lines as they are.
  Asked as a structured question; the coordinator ruled "read it in the words module", which this round builds, with
  D-8096 (2) amended in place. No census line changes. The ruling asked that a mutant which re-spells the rule in the
  caller and changes it red a row: F7r-words-respell-changed and F7r-caller-changed each red F8 (a) (review 1623).
- **F7's mutants.** Re-spelling the rule cannot change a toast: both spellings agree on every string, and `keptWord`
  reads an empty date as none. So F8 (a) (review 1623) stays green under a re-spelling, as the ruling expected ("the
  existing F8 (a) row still passes"). The F7 row is the one that tells the reader's answer from a copy's.
- **F8 at the desk.** At 1280 and 1920 neither skin mounts a floating button, so the overlap half of the check is empty
  there by design; the row now asserts the count (one at 390, none at the desk).
- **F5 and the status sentence.** Only the refusal is cleared when what the row offers changes. The accepted-unread
  sentence (a `role="status"` one) is left as built: the rulings name the refusal alone.
- **The F1 row's shape (review 1626 F3 (a)).** The ruling's row reads "focus lost by removal with no blur, then the row
  goes `transferring`: focus does not move". The committed row follows review 1623 F3 (b), which rules that a focused
  button the row removes counts as the box holding the focus (pinned by its own row): so the first `transferring` after
  such a removal hands the focus to the heading, as it must, and "does not move" holds after that hand-off, once the
  operator has moved on. That is the one reading that meets both the ruling's fix and F3 (b); the F1-flag mutant reds
  exactly that second step.

## Fix round 1 (review 1626 at `536b151b2`)

Every item is the coordinator's ruling; nothing beyond them changes.

| Item | What changed | Row | Mutant, measured |
|---|---|---|---|
| F1 | The settle effect tests "no controls" first, so a row left with none hands the focus to its heading even when the sheet gave it back to the box; the dropped-ask early return applies only to the arm that focuses the box | project-card "F1 (review 1626)": the box is the opener (focused, then the confirm opened with a click that moves no focus), Attach open, the row goes `transferring` | FR1-F1-order (the old order) RED 1 ("the heading, never the empty box") |
| F2 | A row that unmounts while its own confirm is open hands the focus to its heading: in the cleanup, the focus inside this row's own open sheet (its confirm is open, and the flag says the focus came in through it) counts as the box holding it | browser "a row that leaves while its confirm is open …", both variants (the record dropped; a state this build cannot read), both skins, both themes, 390, 1280 and 1920 | FR1-F2-sheet RED 12 of 12 ("its record dropped: expected 'body' to be 'card: project-a'") |
| F3 (a) | pr10b.md says why the F1 row follows review 1623 F3 (b) (above) | — | — |
| F3 (b) | Every close of the confirm clears the focus flag: Cancel, Escape, the scrim, and the close after a confirm (the clear is in the confirm's `onClose`, review 1628 F5); an opener the sheet gives the focus back to sets it again | project-card "F3 (b) (review 1626)": jsdom reaches a null opener (the confirm opened with a click while the page holds the focus), then Cancel, then `transferring`: nothing moves | FR1-F3b-cancel RED 1 ("nothing moved") |
| F4 (ruled) | `offerOf` starts with the record's id, so a replaced record clears the refusal; an answer, or a failure, for the old record that lands after the swap draws nothing | project-card "F4 (review 1626)": a refusal, the same record (CONTROL: kept), a replaced record (emptied); then a late refusal and a late failure for the old record (nothing drawn) | FR1-F4-offer RED 1; FR1-F4-late RED 1; FR1-F4-late-failure RED 1 |
| F5 | — (a row for the controls half of the offer) | project-card "F5 (review 1626)": a refusal, then Attach goes because its session left the list, the state unchanged: the alert empties | FR1-F5-controls (the offer without its controls) RED 1 |
| F6 | The resting check's comment says it measures the screen's own reservation, not the list's end padding | — | — |
| F7 (ruled) | `pr10.md` no longer cites a file outside the repository. Of PR10's round-2 mutants, the ones PR10b re-ran have their edit text recorded in this round's log (`-`/`+` lines): F1-guard, F2-any, F2-place, F2-leave, F3a-none, F3b-removed, F3-group, F4-clear, F4-act-only, F4-open-gate, F9b-offered, F8a-absent, FOCUS-mut and TONE-mut. Every other round-2 mutant keeps `pr10.md`'s table text as its record: the W5-UM, W5-CM and CMx rows, UM6b-guard-only, F6-toast, F6-busy, F3-mount, F4-live, F5-detail, F5-table, F5-presence, F9a-words, F9c-read, F9e-date, F9f-name, F9g-once, F9h-bracket, F9k-retry, F3c-mount, F3-null-guard, F8b-alert, F8c-title, F8d-group, F8d-ring, F9i-pad and F9i-fab | — | — |
| F8 | Every RED line of this round's log has its first failure, a timeout's included; the four named (PR10-F8a-absent, PR10-F8a-absent-r, F7r-words-respell-changed and F7r-caller-changed) are re-measured with it ("Unable to find an element with the text: Worktree kept") | — | each RED 1, F8 (a) (review 1623) |
| F9 | The table names F7's five first-shape mutants as replaced, and F7r-caller-changed's edit as it is | — | — |
| F10 | `pr10.md`, the browser row's comment and `ProjectCard.tsx`'s comment say the dropped ask's focus is placed in the commit that closes the ask, while the closing panel still holds the focus | — | — |
| F11 | The guard stays; the note says it is redundant for posts, not for focus (above) | — | — |
| F12 | The fix commit's message says 4d0876bda's F7 sentence was replaced by 536b151b2; `pr10.md`'s lines on `readDoorAnswer` are corrected | — | — |
| F14 | The browser focus row runs both skins, both themes, at 390, 1280 and 1920 (12 cases) | — | F3-dropped RED 12 of 12 in the browser, RED 2 in jsdom (F3 (review 1624) and F1 (review 1626)) |

Re-measured on this round's code: F1-flag RED 1, F5-clear RED 4 (F3 (c), F5 (review 1624), F4 (review 1626) and F5
(review 1626)), F11a-lease RED 1, F3-dropped (above), FOCUS-mut RED 1 and TONE-mut RED 1 (both W5-U7).

## Fix round 2 (review 1628 at `cb66d3bf7`)

Every item is the coordinator's ruling; nothing beyond them changes.

| Item | What changed | Row | Mutant, measured |
|---|---|---|---|
| F1 | A row that leaves while its confirm is open finds its heading as it unmounts and focuses it once the confirm's focus trap has gone (`setTimeout(0)`, its handle a local of the cleanup), and only if that heading is still drawn and the focus is then on the page or in the departed panel, so it never takes the focus from where the user moved it. The immediate hand-off lost to the trap once the keyboard focus had moved inside the confirm: the trap pulled it back into the leaving panel, and it fell to the page. A row that leaves while its box holds the focus hands it on at once, as before | browser "a row that leaves while its confirm is open …" gains two variants that press `Tab` inside the confirm before the frame (the record dropped; a state this build cannot read), both skins, both themes, 390, 1280 and 1920 | FR2-F1-immediate (the immediate hand-off again) RED 12 of 12 ("its record dropped, after a Tab inside the confirm: expected 'body' to be 'card: project-a'") |
| F2 | — (rows for the other two arms of the late-answer guard) | project-card "F4 (review 1626)": a late success for the old record toasts nothing; a late answer that cannot be read says nothing in the status | FR2-F2-success RED 1 ("a late success: no toast"); FR2-F2-unreadable RED 1 ("a late unreadable answer: no status") |
| F3 | `ProjectCard.tsx`'s comments say once that the dropped ask's focus is placed in the commit that closes the ask, while the closing panel still holds it, and that a late answer draws nothing on an unowned row, whose key outlives the record (a lease row remounts with its record). This note and `pr10.md` cite nothing outside the repository; this note lists every `pr10.md` correction and describes `offerOf` as it is | — | — |
| F4 | The mutation log's four RED lines that had no first failure (PR10-F8a-absent, PR10-F8a-absent-r, F7r-words-respell-changed and F7r-caller-changed, first round) carry one beside them, the line the same mutant printed when re-run in fix round 1, marked as such. Every RED line of the log now has one | — | — |
| F5 | The F3 (b) row of the fix round 1 table says the flag clears on every close of the confirm | — | — |
| F6 (b) | — (a measurement) | — | FR1-F2-sheet with the browser row cut to the unreadable-state variant alone: RED 12 of 12 ("its state one this build cannot read: expected 'body' to be 'card: project-a'") |

Re-measured on this round's code: FR1-F2-sheet (the confirm's arm of the cleanup returning at once) RED 12 of 12 ("its
record dropped"), FR1-F4-late RED 1, FR1-F4-late-failure RED 1, F3-dropped RED 2 in jsdom and RED 12 of 12 in the
browser, FOCUS-mut RED 1 and TONE-mut RED 1 (both W5-U7).
