# PR10b: the PWA's worktree controls, finished (run 1625)

Delegation broker wave 5, PR10b: review 1624's findings on PR10 (#2419), which landed at its reviewed head after three
review rounds. Cut from `main` at `0ba6431c6` (PR10 merged). Deploy class PWA, which ships with the server box. Scope as
the coordinator's rulings for this PR set it: every item under "Rows and fixes", each with a row and a mutant, and this
note. No server source file changes, no new storage key, no new string the operator reads beyond the ones PR10 drew; every
drawn string stays in the operator's words (worktree, session, run, kept). The census lines PR10 ruled are unchanged.

## Ledger

No new number. D-8096 (2) is amended in place for F7 (below): a 2xx's `expiresAt` is handed on as it came and read once,
in the words module, by the wire's own reader. D-8095 and D-8097 are unchanged: D-8097's region is still "mounted empty"
(F5 empties its text; the region stays). `pr10.md` is corrected in place where these rulings say so (F3, F5, F11 (e)).
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
  centred dialog).
- **F4 (a)**: a row starts two acts inside one `act`, so no render runs between them and no control is disabled yet: a
  confirm then a Keep, a Keep then a confirm, and a confirm twice. Each posts once.
- **F4 (b)**: an unowned row whose controls go (its hidden record is gone) while its box holds the focus hands it to its
  group's toggle, never the card's.
- **F5 (ruled: clear it)**: the words module's `offerOf` spells what a row offers: the worktree's state on the wire and
  each control, an attach with its session. When it changes, the refusal sentence is cleared; the region stays mounted.
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
  W5-UM3, W5-UM4, W5-UM5, W5-UM7). The wave-done report carries a copy of that log with each mutant's edit text beside
  its run line.

## Rows

| Ruling | Row | File | Red before | Green after |
|---|---|---|---|---|
| F1 | "F1 (review 1624): a hand-off clears the box's hold …" | `project-card.test.tsx` | red on the base's hand-off (F1-flag) and on each focus without `preventScroll` | green |
| F2 | "F2 (review 1624): an unknown word at a status no door sends, and a 409 body with no ok …" | `project-card.test.tsx` | the code it pins is the base's, which is right: red under each part's mutant | green |
| F3 | "F3 (review 1624): an ask its row stops offering … places it in the box" | `project-card.test.tsx` | green under the base's placement (F3-old-placement: jsdom unmounts the sheet at once, so the page holds the focus); red under F3-dropped | green |
| F3 | "the focus around a worktree control's real sheet (review 1624 F3)", at 390 and 1280 | `delegation-rows.browser.test.ts` | red on the base's placement (F3-old-placement): "after a dropped ask: expected 'body'" | green |
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
| F7r-caller-changed | the card's toast call re-spells the rule and changes it the same way | F8 (a) (review 1623) in the card file |
| F7r-shared | the wire's reader reads absence as an empty date | W5-U1 and F9 (g) in the words file, and F8 (a) (review 1623) in the card file, all through the row's own kept words; the F7 row stays green (an empty date is no date to `keptWord`) |
| F11a-lease | `offered` without the record's id | F11 (a) (review 1624) |
| F8-pad2 | `.fleet-list`'s end padding 0 and `.fleet`'s bottom padding cut to `--safe-bottom` | the browser suite at 390, 4 failed: "+ Add project: clear of the floating button at the end of the list" |

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
  one call later. It is kept as it stands; deleting it is no part of these rulings.
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
