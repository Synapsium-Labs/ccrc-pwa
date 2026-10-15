// AskUserQuestion's own rows, the ones Claude Code paints under a question's options (D-5045, plan
// docs/superpowers/plans/2026-10-15-ask-server-half.md). L0: imports nothing. The PWA bundles `shared/`, and the drawer's
// menu taps (D-5008, Task 16) need the same rule the server's guard reads.
//
// What lives here, once (`single-definition.test.ts` holds both homes):
// - `FREE_TEXT_PLACEHOLDER_RE`: the label of the EMPTY free-text row. Enter on that row while it is empty does not answer
//   the question. It rejects the WHOLE AskUserQuestion ("User declined to answer questions") and throws away every
//   question already answered (measured on Claude Code 2.1.300 and 2.1.291).
// - `CHAT_ABOUT_ROW_RE`: the label of the row below it, which the structural backstop (`server/src/pane/dialog.ts`'s
//   `freeTextRow`) uses to find that row when its label reads differently.
//
// D-5008's stage 1b moves the pane-menu reader (`OPTION_RE`, `CHECKBOX_RE`, `leftCol`, `paneOptionRows`, `OptionRow`) to
// `shared/pane-menu.ts`. These two rules can join it there or stay here; either way they keep one home.

/** The empty free-text row's label, as a pane-menu row reads it (number, cursor and checkbox already gone).
 *  - Single-select paints `n+1. Type something.` (with the period).
 *  - multiSelect paints `n+1. [ ] Type something` (no period).
 *  - A row holding typed text shows that text instead, so this matches only the EMPTY row. */
export const FREE_TEXT_PLACEHOLDER_RE = /^type something\.?$/i;

/** The row that declines the ask so the user can talk it over: `n+2. Chat about this`, below a rule. Measured as a
 *  rejection of the tool call, not an answer. The two-column preview layout paints it UNNUMBERED, with no free-text
 *  row above it. */
export const CHAT_ABOUT_ROW_RE = /^chat about this$/i;
