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
// - `COMMIT_LAST_RE` (D-5091, plan docs/superpowers/plans/2026-10-15-ask-sheet-half.md): that row's word on the question
//   that comes last, read by the sheet (`pwa/src/session/askLive.ts`).
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

/** The commit row's word on the question that comes last (`Dialog.multi.commit`). Tab from it does not submit the ask:
 *  it lands on the review screen, whose `Submit answers` does (measured on 2.1.300: `cc300-ask-multiselect-submit-open`,
 *  then `cc300-ask-review-multiselect`). The sheet names its commit after where it lands (D-5091). Tested against the
 *  row's word as `Dialog.multi.commit` carries it. */
export const COMMIT_LAST_RE = /^submit$/i;

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

/** The tab row a multi-question ask paints at the top of its box: `←  ☒ Caching  ☐ Tracing  ✔ Submit  →` (measured on
 *  2.1.296, 2.1.300 and 2.1.302). Tested against a trimmed line. The active tab is marked by colour alone, so a plain
 *  capture cannot say which tab is up. */
export const ASK_TAB_ROW_RE = /^←.*→$/;

/** One question's tab on that row: its header, and whether it is answered (`☒`) or not yet (`☐`). */
export interface AskTab {
  readonly header: string;
  readonly answered: boolean;
}

/** The tab row an ask paints (`parseAskTabs`): its question tabs in order, and the `✔ Submit` tab after them. */
export interface AskTabs {
  readonly tabs: readonly AskTab[];
}

/** One tab on the tab row: a box, one space, the header. */
const ASK_TAB_RE = /^([☐☒]) (.+)$/;

/** The row's last tab, which reaches the review screen. */
const ASK_SUBMIT_TAB = '✔ Submit';

/**
 * The tab row of the ask on screen (decision `ask-dialog-tab-route`), read off a plain capture: `←`, one `☐`/`☒ header`
 * per question, `✔ Submit`, `→`, the tabs two or more spaces apart (measured on 2.1.296 at 220, 80 and 49 columns, and
 * on 2.1.302). Null when the screen paints no such row: a one-question single-select ask paints none (2.1.296,
 * `ask-user-question-real`), and a row that does not read exactly this way (wrapped, cut, or another `← … →` line) is
 * no tab row, so nothing is moved on a guess. The LAST such row counts, since the live menu sits at the foot of the pane.
 * The active tab is marked by colour alone, so this never says which tab is up.
 */
export function parseAskTabs(raw: string): AskTabs | null {
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => ASK_TAB_ROW_RE.test(l));
  const row = lines.at(-1);
  if (row === undefined) return null;
  const cells = row.slice(1, -1).split(/\s{2,}/).map((c) => c.trim()).filter((c) => c !== '');
  if (cells.at(-1) !== ASK_SUBMIT_TAB) return null;
  const tabs: AskTab[] = [];
  for (const cell of cells.slice(0, -1)) {
    const m = ASK_TAB_RE.exec(cell);
    if (m === null) return null;
    tabs.push({ header: m[2]!, answered: m[1] === '☒' });
  }
  return tabs.length > 0 ? { tabs } : null;
}

/** The review screen's two rows, as the option indexes the pane printed them under (`Submit answers`, `Cancel`). */
export interface ReviewRows {
  readonly submit: number;
  readonly cancel: number;
}

/** What `reviewRows` reads off a parsed pane menu: `shared/api.ts`'s `Dialog`, structurally (this file imports nothing). */
export interface ReviewScreen {
  readonly parsed: boolean;
  readonly options: readonly { readonly index: number; readonly label: string }[];
  readonly body?: string;
  readonly raw: string;
}

/**
 * Is a parsed pane menu the review screen an ask ends on, and which of its rows are Submit and Cancel? Null when it is
 * not one. Two arms:
 * - strict (D-5089): exactly two rows, `Submit answers` then `Cancel`, under a body whose last line is the ready line
 *   (`REVIEW_READY_RE`). Every recorded review reads this way.
 * - lenient (decision `ask-review-lenient-arm`): one row `Submit answers` and one row `Cancel`, wherever they sit, on a
 *   screen that paints the ready line. A review with anything numbered painted after its rows (a rule and a status row
 *   under the box, which `parseDialog` reads as more options) or a changed body tail is still a review, and the sheet
 *   still offers Submit. The rows are found by label, never by position.
 * The ready line is required by both, so a question whose own options read `Submit answers` and `Cancel` is never taken
 * for the review. Unparsed menus are never one.
 */
export function reviewRows(dialog: ReviewScreen | null): ReviewRows | null {
  if (dialog === null || !dialog.parsed) return null;
  const submit = dialog.options.filter((o) => REVIEW_SUBMIT_ROW_RE.test(o.label.trim()));
  const cancel = dialog.options.filter((o) => REVIEW_CANCEL_ROW_RE.test(o.label.trim()));
  if (submit.length !== 1 || cancel.length !== 1) return null;
  const rows = { submit: submit[0]!.index, cancel: cancel[0]!.index };
  const strict = dialog.options.length === 2 && rows.submit === 1 && rows.cancel === 2
    && REVIEW_READY_RE.test((dialog.body ?? '').trimEnd());
  if (strict) return rows;
  return dialog.raw.split('\n').some((l) => REVIEW_READY_RE.test(l.trim())) ? rows : null;
}
