# Reader mode's block exit and re-entry, and the comment record (wave 62), task note for the ledger

Run 4171, wave 62, the native Docs reader programme, on `main` at `567723861a`. By the coordinator's ruling C: `x6-fu-block-focus`,
`x6-fu-reentry-flag` and `x2-fu-p6-1-record-wording` ship; the cure of `x2-fu-comment-in-container` and
`x2-fu-comment-paragraph-shapes` is carried to a wave of its own. Full records: the reader-mode plan's Results section "Follow-up
wave, the block exit and re-entry" (`docs/superpowers/plans/2026-11-20-native-docs-reader-mode.md`) and the parity plan's
"Follow-up wave, comments in parts" (`docs/superpowers/plans/2026-11-18-native-docs-parity.md`). This note is what the ledger
should learn.

## What shipped

- **A block exit moves no focus** (review 4092 F1): the sign-in cover's passphrase field keeps the focus it took. The exit
  focus's unreachable head-action answer is deleted (F2); row XRF2-3e is corrected (F3).
- **A re-entry while an exit's own step back is still landing is refused** (`x6-fu-reentry-flag`): decided in
  `readerModeOffered`, from a fact the hook keeps itself, bounded by `READER_EXIT_LANDING_MS` (1 s).
- **The comment record** (review 4131 A1 to A3): the `<!-->` or `<!--->` opener at the start of its line is dropped from class 10
  (it hides nothing there); the
  visit's `rangeOpened` comment says Export reads its bytes; row F3-C1 counts 14 of 20. Class 10 names what is measured to show
  hidden text today, with its sizes, and claims no cure.

## Commits, in order

| Commit | Item |
|---|---|
| `2300bf6f53` | item 4, `x6-fu-block-focus` |
| `b245fceb1b` | item 5, `x6-fu-reentry-flag` |
| (next) | item 3, `x2-fu-p6-1-record-wording`, and the records of items 4 and 5 |

## Carried to a wave of its own

The cure of comments in parts (tickets `x2-fu-comment-in-container`, `x2-fu-comment-paragraph-shapes`). The attempt is kept,
unmerged and unpushed, at the local ref `refs/kept/w62-comments` (`3c6f0284788245697b8a44be21e8b265a6cb9c4c`) on the fleet box's
clone (whether to push it is the coordinator's call), with its cases and mutation
rows. Its two Opus reviews found shapes still open: two critical regressions in the first round, fixed there, and eight more in
the second, listed in the parity plan. The next wave first chooses its design: a container-aware cure, or a conservative rule (no
cut inside a container larger than a part that holds a comment opener).

## Carried, not built

- In reader mode, Back, a new version, Forward and Exit: the next Back does nothing (wave PH's history rule).
- A landing of the hook's own step that the dispatcher answers otherwise (a new visit, an unnumbered entry) is cleared by the 1 s
  bound only; a Back already in flight when an exit is marked is taken as its landing. Not measured in a browser.

## Deviation numbers

The run was issued 9174 and 9175. Neither is defined; both are returned unused.

## Not measured here

Real browsers and devices for the focus and re-entry changes (jsdom only); Firefox and phones, as before.
