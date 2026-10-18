// The sheet's sentences for an own-words answer that did not go through, and the sheet's own rule for which text it
// sends (D-5090, plan docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 3). D-5091 (Task 4) adds the same for a
// multiSelect question's boxes: a sentence per `DialogMultiRefuseCode`, and why the commit is held back. Task 5 adds a
// tapped row's (`api.answerDialog`): a sentence per `DialogRefuseCode`, where every 409 once read alike.
//
// Own words answer an AskUserQuestion through its free-text row (`api.answerDialogText`, D-5047). That route refuses
// by code (`DialogTextRefuseCode`, `shared/api.ts`), and a code is not something to show the operator: each one gets a
// sentence here that says what happened and what is left to do. The table is TOTAL over the union, so a code the
// server adds is a compile error here until it has its sentence. Task 5 reconciles these with the other dialog
// routes' tables.
import {
  DIALOG_MULTI_REFUSE_CODES, DIALOG_REFUSE_CODES, DIALOG_TAB_REFUSE_CODES, DIALOG_TEXT_MAX, DIALOG_TEXT_REFUSE_CODES,
  isDialogMultiIndexes, isDialogText, type DialogMulti, type DialogMultiRefuseCode, type DialogRefuseCode,
  type DialogTabRefuseCode, type DialogTextRefuseCode,
} from '../../../shared/api';
import { ApiError, failedTo, sendErrorText } from '../lib/api';

/** The one fact all three dialog routes refuse with first (`stale-dialog`): the pane no longer shows the question the
 *  sheet answered. Each table says it in these words, then what that meant for its own send. */
const MOVED_ON = 'That question moved on in the terminal';

/** Every own-words refusal leaves the text in the field (D-5090: kept until a call answers ok), and the sentences that
 *  could leave the operator wondering say so in these words. */
const TEXT_KEPT = 'Your text is still here.';

/** What the sheet says when the free-text route refuses, by its code. Every refusal leaves the text in the field, so
 *  none of these asks the operator to type it again, and none promises a next step the sheet does not then offer:
 *  what is left to do is said on the sheet itself, under the field, from what the pane shows next. */
export const DIALOG_TEXT_REFUSE_TEXT: Readonly<Record<DialogTextRefuseCode, string>> = {
  'bad-text': `That answer can't be typed into the terminal — one line, no tabs, at most ${DIALOG_TEXT_MAX} characters.`,
  // The composer's own sentence for the same fact, read rather than spelled again.
  'not-alive': sendErrorText('not-alive'),
  'stale-dialog': `${MOVED_ON}, so nothing was typed. ${TEXT_KEPT}`,
  'not-free-text': "The terminal's own-words row holds something else, so nothing was typed. Finish or clear it there.",
  // The footer's edit hint is one of the focus proofs, and a box where no external editor resolves never paints it
  // (D-5047), so a refusal that repeats is the terminal's to answer.
  'focus-failed':
    "The terminal didn't show its own-words row ready for typing, so nothing was typed. If this repeats, answer in the terminal.",
  // The row may be left holding all of the text, part of it, or none. The sheet then says which, under the field
  // (`OwnWords`): all of it is the stranded retry (the server's retry arm submits exactly that text without typing it
  // again), part of it is the terminal's to clear first, none of it is an ordinary Send.
  'echo-failed': `Typed it, but the terminal never showed it back, so it wasn't sent. ${TEXT_KEPT}`,
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
 * Why Send is held back for `text`, or null when the sheet sends it. The text sent is `text` trimmed. Held exactly
 * where the route's own rule refuses it (`isDialogText`, so the route would answer 400 `bad-text` without touching the
 * pane), and for a trailing `;`; the rule's refusal is split only to say WHY, each reason being the operator's to fix
 * differently:
 *  - `blank`: nothing to send, once trimmed;
 *  - `control`: a control character, such as a Tab a paste out of a table carries, or a line break (the answer is one
 *    line). The field keeps it, drawn as a gap, so the line under the field names it (`OwnWords`);
 *  - `long`: longer than `DIALOG_TEXT_MAX`. The field never cuts a paste at the limit (it carries no `maxLength`,
 *    which a browser enforces by dropping the tail without a word): the whole text stays, `ownWordsCount` says by how
 *    much it is over, and Send waits. A long text that also holds a control character is `control`, and the count
 *    still says it is long;
 *  - `semicolon`: it ends in `;`. tmux drops a literal's trailing `;` (measured in #417), so the echo never matches,
 *    nothing is submitted, and the retry the server offers is refused (`not-free-text`): a dead end. Narrower than
 *    the route on purpose, until that is fixed at the source (pending slug `ask-sheet-trailing-semicolon`).
 */
export function ownWordsHeld(text: string): 'blank' | 'control' | 'long' | 'semicolon' | null {
  const sent = text.trim();
  if (isDialogText(sent)) return sent.endsWith(';') ? 'semicolon' : null;
  if (sent === '') return 'blank';
  return holdsControl(sent) ? 'control' : 'long';
}

/** Does `sent` hold a character the route will not type? The route's own rule (`isDialogText`) is the one definition
 *  of such a character, so it is asked here too: of the text in pieces short enough for the rule's length limit, each
 *  led by a letter so that no piece reads as blank. A character the rule refuses in a piece, it refuses in the text. */
function holdsControl(sent: string): boolean {
  const piece = DIALOG_TEXT_MAX - 1;
  for (let at = 0; at < sent.length; at += piece) {
    if (!isDialogText(`x${sent.slice(at, at + piece)}`)) return true;
  }
  return false;
}

/** From how many characters the field counts them: four fifths of the route's limit, early enough to shorten an
 *  answer before Send waits, late enough that a short answer never shows a number. */
export const OWN_WORDS_COUNT_FROM = Math.round(DIALOG_TEXT_MAX * 0.8);

/** The own-words field's count, from `OWN_WORDS_COUNT_FROM` characters of the text sent (trimmed, counted as the
 *  route's rule counts): how much of the limit it uses, and once over it, why Send waits. Null below. */
export function ownWordsCount(text: string): string | null {
  const n = text.trim().length;
  if (n < OWN_WORDS_COUNT_FROM) return null;
  const count = `${n} of ${DIALOG_TEXT_MAX} characters`;
  return n > DIALOG_TEXT_MAX
    ? `${count} — the terminal's own-words row takes at most ${DIALOG_TEXT_MAX}, so Send waits until it's shorter. Or answer in the terminal.`
    : `${count}.`;
}

/** The free-text box of a multiSelect question is ticked (typing into its row ticks it), so Tab would commit it with the
 *  boxes, and the route refuses (`free-text-ticked`). Own words inside a multiSelect question are the terminal's in v1
 *  (D-5048). */
export const MULTI_FREE_TEXT_TICKED = "The terminal's own-words box is ticked on this question — finish it there.";

/** The pane's cursor is not on one of the question's boxes: there a digit types into the own-words row, and Tab after a
 *  walk through it was swallowed (measured, D-5048), so the route presses nothing (`cursor-not-on-option`). `place`
 *  says where the cursor is (`cursorPlace`). */
export const cursorOffOptions = (place: string): string =>
  `In the terminal the cursor is ${place} — move it onto an option there first.`;

/** Where the pane's cursor rests on a multiSelect question, for `cursorOffOptions`: the commit row by its own word, the
 *  free-text row, or neither (`Chat about this`, or no cursor on screen). */
export function cursorPlace(multi: DialogMulti): string {
  if (multi.cursor === 'commit') return `on the ${multi.commit.trim()} row`;
  if (multi.freeText !== null && multi.cursor === multi.freeText.index) return 'on the own-words row';
  return 'off the options';
}

/** What the sheet says when the multiSelect route refuses, by its code (D-5091). Total over the union, as the own-words
 *  table is. A refusal keeps the operator's set on the sheet, so a retry sends it again. */
export const DIALOG_MULTI_REFUSE_TEXT: Readonly<Record<DialogMultiRefuseCode, string>> = {
  // The sheet never sends an empty, repeated or out-of-range set (`multiHeld`), so this is the one it could mean.
  'bad-indexes': 'Tick at least one box.',
  'not-alive': sendErrorText('not-alive'),
  'stale-dialog': `${MOVED_ON}, so nothing was sent.`,
  'not-multiselect': 'The terminal no longer shows this as a pick-several question, so nothing was sent.',
  'not-an-option': "One of those isn't an option on the terminal's question, so nothing was sent.",
  'free-text-ticked': MULTI_FREE_TEXT_TICKED,
  'cursor-not-on-option': cursorOffOptions('off the options'),
  // Digits were sent and the ticks never proved, so Tab was not pressed. Boxes may be left part toggled, and a retry
  // with the same set sends only the digits still needed (D-5048).
  'ticks-failed':
    "The terminal didn't show those ticks, so the question wasn't committed. Trying again presses only the boxes still wrong.",
  'commit-failed': "Ticked them, but the terminal didn't move on — check it there.",
};

const isDialogMultiRefuseCode = (code: string): code is DialogMultiRefuseCode =>
  (DIALOG_MULTI_REFUSE_CODES as readonly string[]).includes(code);

/** The sentence for a failed multiSelect commit: the route's refusal by its code, else the app's one sentence for a
 *  write that did not go through. */
export function dialogMultiRefusal(err: unknown): string {
  if (err instanceof ApiError && isDialogMultiRefuseCode(err.message)) return DIALOG_MULTI_REFUSE_TEXT[err.message];
  return failedTo('answer', err);
}

/**
 * Why the commit is held back for the set `wanted` on this pane, or null when the sheet sends it. The route's own
 * refusals, read ahead of the call, so a tap never asks for what the pane already says no to:
 *  - `free-text`: the free-text box is ticked (`MULTI_FREE_TEXT_TICKED`);
 *  - `cursor`: the cursor is not on one of the question's boxes (`cursorOffOptions`);
 *  - `empty`: `isDialogMultiIndexes` refuses the set. Empty, in practice: Tab on a question with no box ticked skips
 *    it, which is not an answer.
 */
export function multiHeld(multi: DialogMulti, wanted: readonly number[]): 'free-text' | 'cursor' | 'empty' | null {
  if (multi.freeText?.checked === true) return 'free-text';
  if (!multi.options.some((o) => o.index === multi.cursor)) return 'cursor';
  return isDialogMultiIndexes(wanted) ? null : 'empty';
}

/** What the sheet says when a tapped row's answer (`api.answerDialog`) is refused, by its code (plan, Task 5). Total
 *  over the union, as the other two tables are. Nothing was pressed in any of these: the route refuses before Enter.
 *  `stale-dialog` here is the SCRAPED sheet's sentence, which redraws from the store's menu right after, so "showing
 *  the latest" is true there; under the envelope it is `STALE_UNDER_ENVELOPE` (`dialogRefusal`). */
export const DIALOG_REFUSE_TEXT: Readonly<Record<DialogRefuseCode, string>> = {
  'not-alive': sendErrorText('not-alive'),
  'stale-dialog': 'That question changed — showing the latest',
  'walk-failed': "The terminal's cursor didn't land on that row, so nothing was pressed. Try again.",
  // The scraped sheet offers no row it knows to be the free-text one; this is a row holding text typed in the
  // terminal on a pane the transcript could not match, which only the server could tell (D-5045).
  'free-text-row':
    "That row holds the question's own words, so nothing was pressed. Finish it in the terminal, or clear it there and answer here.",
  'unparsed-dialog': "The terminal's menu couldn't be read just now, so nothing was pressed. Try again, or answer there.",
};

/** N1: the envelope sheet renders the hook's envelope, not the pane, so a refused tap there changes nothing on screen
 *  and "showing the latest" would be false: it says what happened instead. */
export const STALE_UNDER_ENVELOPE = `${MOVED_ON} — this answer didn't land`;

const isDialogRefuseCode = (code: string): code is DialogRefuseCode =>
  (DIALOG_REFUSE_CODES as readonly string[]).includes(code);

/** The sentence for a refused tap: the route's refusal by its code (`stale-dialog` by which sheet is showing,
 *  `underEnvelope`), else the app's one sentence for a write that did not go through. */
export function dialogRefusal(err: unknown, underEnvelope: boolean): string {
  if (!(err instanceof ApiError) || !isDialogRefuseCode(err.message)) return failedTo('answer', err);
  return err.message === 'stale-dialog' && underEnvelope ? STALE_UNDER_ENVELOPE : DIALOG_REFUSE_TEXT[err.message];
}

/** What the sheet says when a tab move (`api.answerDialogTab`, decision `ask-dialog-tab-route`) is refused, by its code.
 *  Total over the union, as the other tables are. No refusal pressed Enter, and none closes the sheet. */
export const DIALOG_TAB_REFUSE_TEXT: Readonly<Record<DialogTabRefuseCode, string>> = {
  'bad-request': "The sheet couldn't tell which tab is up, so the terminal wasn't moved.",
  'not-alive': sendErrorText('not-alive'),
  'stale-dialog': `${MOVED_ON}, so the terminal wasn't moved.`,
  'no-tabs': 'This ask has no other questions to move to.',
  'unparsed-dialog': "The terminal's menu couldn't be read just now, so it wasn't moved. Try again, or move it there.",
  'walk-failed': "The terminal's cursor didn't leave the own-words row, so it wasn't moved. Try again.",
  'no-move': "The terminal didn't move to another question.",
  'menu-gone': "The terminal's question went away while moving — check it there.",
};

const isDialogTabRefuseCode = (code: string): code is DialogTabRefuseCode =>
  (DIALOG_TAB_REFUSE_CODES as readonly string[]).includes(code);

/** The sentence for a refused tab move: the route's refusal by its code, else the app's one sentence for a write that
 *  did not go through. */
export function dialogTabRefusal(err: unknown): string {
  if (err instanceof ApiError && isDialogTabRefuseCode(err.message)) return DIALOG_TAB_REFUSE_TEXT[err.message];
  return failedTo('move', err);
}
