// The sheet's sentences for an own-words answer that did not go through, and the sheet's own rule for which text it
// sends (D-5090, plan docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 3).
//
// Own words answer an AskUserQuestion through its free-text row (`api.answerDialogText`, D-5047). That route refuses
// by code (`DialogTextRefuseCode`, `shared/api.ts`), and a code is not something to show the operator: each one gets a
// sentence here that says what happened and what is left to do. The table is TOTAL over the union, so a code the
// server adds is a compile error here until it has its sentence. Task 5 reconciles these with the other dialog
// routes' tables.
import {
  DIALOG_TEXT_MAX, DIALOG_TEXT_REFUSE_CODES, isDialogText, type DialogTextRefuseCode,
} from '../../../shared/api';
import { ApiError, failedTo, sendErrorText } from '../lib/api';

/** What the sheet says when the free-text route refuses, by its code. Every refusal leaves the text in the field
 *  (D-5090: kept until a call answers ok), so none of these asks the operator to type it again. */
export const DIALOG_TEXT_REFUSE_TEXT: Readonly<Record<DialogTextRefuseCode, string>> = {
  'bad-text': `That answer can't be typed into the terminal — one line, no tabs, at most ${DIALOG_TEXT_MAX} characters.`,
  // The composer's own sentence for the same fact, read rather than spelled again.
  'not-alive': sendErrorText('not-alive'),
  'stale-dialog': 'That question moved on in the terminal, so nothing was typed. Your text is still here.',
  'not-free-text': "The terminal's own-words row holds something else, so nothing was typed. Finish or clear it there.",
  // The footer's edit hint is one of the focus proofs, and a box where no external editor resolves never paints it
  // (D-5047), so a refusal that repeats is the terminal's to answer.
  'focus-failed':
    "The terminal didn't show its own-words row ready for typing, so nothing was typed. If this repeats, answer in the terminal.",
  // The text may be left in the row, and the server's retry arm submits exactly that text without typing it again:
  // the sheet then offers the stranded retry (`OwnWords`).
  'echo-failed': "Typed it, but the terminal never showed it back, so it wasn't sent. Send again submits what's there.",
};

const isDialogTextRefuseCode = (code: string): code is DialogTextRefuseCode =>
  (DIALOG_TEXT_REFUSE_CODES as readonly string[]).includes(code);

/** The sentence for a failed own-words call: the route's refusal by its code (`ApiError`'s message is the body's
 *  `error`), else the app's one sentence for a write that did not go through. */
export function dialogTextRefusal(err: unknown): string {
  if (err instanceof ApiError && isDialogTextRefuseCode(err.message)) return DIALOG_TEXT_REFUSE_TEXT[err.message];
  return failedTo('answer', err);
}

/**
 * Why Send is held back for `text`, or null when the sheet sends it. The text sent is `text` trimmed, and:
 *  - `invalid`: the route's own rule refuses it (`isDialogText`: blank, a control character such as a Tab or a line
 *    break, or longer than `DIALOG_TEXT_MAX`), so the route would answer 400 `bad-text` without touching the pane;
 *  - `semicolon`: it ends in `;`. tmux drops a literal's trailing `;` (measured in #417), so the echo never matches,
 *    nothing is submitted, and the retry the server offers is refused (`not-free-text`): a dead end. Narrower than
 *    the route on purpose, until that is fixed at the source (pending slug `ask-sheet-trailing-semicolon`).
 */
export function ownWordsHeld(text: string): 'invalid' | 'semicolon' | null {
  const sent = text.trim();
  if (!isDialogText(sent)) return 'invalid';
  return sent.endsWith(';') ? 'semicolon' : null;
}
