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
