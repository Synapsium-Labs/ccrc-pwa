// The refusal tables the answer paths word their tokens from (D-7183; ARCH-29 #542), each pinned as a literal object equal
// to today's, so the answer reducer (which carries a refusal TOKEN, never a sentence) changes no surface's words. The sheets
// read `askWords.ts#DIALOG_REFUSE_TEXT`; `refusalWords.ts#ASK_REFUSE_TEXT` words the same family of doors for the
// surfaces that answer a held question. They word some tokens differently on purpose, and W7 changes neither.
// `refusal-words.characterization.test.ts` keeps its own rows.
import { describe, expect, it } from 'vitest';
import { ASK_REFUSE_TEXT } from '../src/lib/refusalWords';
import { DIALOG_REFUSE_TEXT } from '../src/session/askWords';

describe('the answer paths\' refusal tables, pinned (W7 C7e)', () => {
  it('DIALOG_REFUSE_TEXT: the sheets\' words for an option answer\'s refusals', () => {
    expect(DIALOG_REFUSE_TEXT).toEqual({
      'not-alive': 'That session is not running.',
      'stale-dialog': 'That question changed — showing the latest',
      'walk-failed': "The terminal's cursor didn't land on that row, so nothing was pressed. Try again.",
      'free-text-row':
        "That row is the answer box, so nothing was pressed. Finish it in the terminal, or clear it there and answer here.",
      'unparsed-dialog': "The terminal's menu couldn't be read just now, so nothing was pressed. Try again, or answer there.",
    });
  });

  it('ASK_REFUSE_TEXT: the in-app words for an ask answer\'s refusals', () => {
    expect(ASK_REFUSE_TEXT).toEqual({
      'not-alive': 'That session is not running.',
      'not-waiting': 'That session is not waiting on a question.',
      'stale-ask': 'That question has moved on — read the current one first.',
      'ask-mismatch': 'The answer does not match the question on screen.',
      'multi-question': 'That screen asks several questions at once and cannot be answered in one go.',
      range: 'That choice is outside the options offered.',
      multiselect: 'That question allows several choices — answer it as a set.',
      'duplicate-index': 'The same option was chosen twice.',
      'no-menu': 'There is no menu on screen to answer.',
      'menu-mismatch': 'The menu on screen is not the one this answer was written for.',
      'unknown-ask': 'No such question is held.',
      'not-held': 'That question is not held for an answer.',
      'ask-moved': 'The child repainted its question — read the current one and answer that.',
      'not-parent': 'Only the run\'s own coordinator can answer that question.',
      'child-unmeasurable': 'This box could not read the child, so nothing can say whether the question changed.',
      declined: 'That question was released by the coordinator, so it cannot be answered later.',
      'already-answered': 'That question was already answered.',
    });
  });
});
