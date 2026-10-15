// AskUserQuestion's own rows, the ones Claude Code paints under a question's options (D-5045, plan
// docs/superpowers/plans/2026-10-15-ask-server-half.md). L0: imports nothing. The PWA bundles `shared/`, and the drawer's
// menu taps (D-5008, Task 16) need the same rule the server's guard reads.
//
// What lives here, once (`single-definition.test.ts` holds each home):
// - `FREE_TEXT_PLACEHOLDER_RE`: the label of the EMPTY free-text row. Enter on that row while it is empty does not answer
//   the question. It rejects the WHOLE AskUserQuestion ("User declined to answer questions") and throws away every
//   question already answered (measured on Claude Code 2.1.300 and 2.1.291).
// - `CHAT_ABOUT_ROW_RE`: the label of the row below it, which the structural backstop (`server/src/pane/dialog.ts`'s
//   `freeTextRow`) uses to find that row when its label reads differently.
// - `EDIT_HINT_RE` (D-5047): the footer's external-editor chord, painted while the free-text row holds focus.
// - `COMMIT_ROW_RE` (D-5048): the unnumbered row under a multiSelect question's boxes that commits the question.
// - `REVIEW_READY_RE`, `REVIEW_SUBMIT_ROW_RE`, `REVIEW_CANCEL_ROW_RE`, `REVIEW_HEADING_RE` (D-5089, plan
//   docs/superpowers/plans/2026-10-15-ask-sheet-half.md): the review screen a multi-question or multiSelect ask ends on,
//   read by the sheet (`pwa/src/session/askLive.ts`).
//
// D-5008's stage 1b moves the pane-menu reader (`OPTION_RE`, `CHECKBOX_RE`, `leftCol`, `paneOptionRows`, `OptionRow`) to
// `shared/pane-menu.ts`. These rules can join it there or stay here; either way they keep one home. `OptionRow` gained
// `checked` (D-5048) before that move, so the move carries it.

/** The empty free-text row's label, as a pane-menu row reads it (number, cursor and checkbox already gone).
 *  - Single-select paints `n+1. Type something.` (with the period).
 *  - multiSelect paints `n+1. [ ] Type something` (no period).
 *  - A row holding typed text shows that text instead, so this matches only the EMPTY row. */
export const FREE_TEXT_PLACEHOLDER_RE = /^type something\.?$/i;

/** The row that declines the ask so the user can talk it over: `n+2. Chat about this`, below a rule. Measured as a
 *  rejection of the tool call, not an answer. The two-column preview layout paints it UNNUMBERED, with no free-text
 *  row above it. */
export const CHAT_ABOUT_ROW_RE = /^chat about this$/i;

/** The external-editor chord the menu's footer offers while the cursor is on a free-text row: `ctrl+g to edit in Vim`
 *  (the editor's name varies, so only the phrase is matched). D-5047's focus proof needs it before typing, as one of
 *  four facts and never alone: measured on 2.1.300, the hint OUTLIVES the row, so after a walk through the free-text
 *  row it is still painted with the cursor on `Chat about this` or on a multiSelect `Next` row. It also depends on an
 *  external editor resolving in the session's environment, so a box where none does never paints it, and the
 *  free-text route then refuses `focus-failed` every time. */
export const EDIT_HINT_RE = /to edit in/;

/** The unnumbered row Claude Code paints under a multiSelect question's boxes (below its `[ ] Type something` row, above
 *  the rule and `Chat about this`): `Next`, or `Submit` on the question that comes last. Measured on 2.1.280 and 2.1.300.
 *  `server/src/pane/dialog.ts` reads a multiSelect question into `Dialog.multi` only when this row is on screen, because
 *  it is the mark of the layout whose keys were measured: a digit toggles a box, Enter toggles the cursor row, and Tab
 *  from an option row commits. The 2.1.222 shape ("Space to select · Enter to confirm") paints no such row, and its
 *  commit was Enter. Enter on this row commits too (measured), but D-5048's route never walks to it: it commits with Tab
 *  from an option row, and refuses while the cursor rests here, where Tab after a walk through the free-text row was
 *  swallowed. */
export const COMMIT_ROW_RE = /^(?:next|submit)$/i;

// The review screen (D-5089). Claude Code paints it after the last question of an ask that has more than one question
// or a multiSelect one: the tab row, `Review your answers`, a `⚠ You have not answered all questions` line when one was
// skipped, each answered question with its answer under it, `Ready to submit your answers?`, then `1. Submit answers`
// and `2. Cancel`. It paints no footer. Measured on 2.1.300 (`server/test/fixtures/panes/cc300-ask-review-*.txt`).

/** The review's last line above its two rows. It is how the screen is told: a review taller than `parseDialog`'s
 *  20-row climb loses its heading and its title (`cc300-ask-review-4q-long`), never this line, which sits just above
 *  the rows. Tested against a body or a line with its trailing space trimmed. */
export const REVIEW_READY_RE = /ready to submit your answers\?$/i;

/** The review's row 1, which submits every answer the screen lists. */
export const REVIEW_SUBMIT_ROW_RE = /^submit answers$/i;

/** The review's row 2. Measured as a rejection of the WHOLE ask ("User declined to answer questions",
 *  `cc300-ask-review-cancelled`): nothing already answered is sent. */
export const REVIEW_CANCEL_ROW_RE = /^cancel$/i;

/** The review's heading, the first line under its tab row; gone from the capture when the review is too tall
 *  (`cc300-ask-review-4q-long`). Tested against a trimmed line. */
export const REVIEW_HEADING_RE = /^review your answers$/i;
