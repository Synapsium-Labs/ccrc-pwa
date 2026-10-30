// The refusal tables the answer paths word their tokens from (D-7183; ARCH-29 #542), each pinned as a literal object equal
// to today's, so the answer reducer (which carries a refusal TOKEN, never a sentence) changes no surface's words. The sheets
// read `askWords.ts#DIALOG_REFUSE_TEXT`; `refusalWords.ts#ASK_REFUSE_TEXT` words the same family of doors for the
// surfaces that answer a held question; `refusalWords.ts#NOTIFICATION_REFUSAL_TEXT` words the notification's (push-sw.js's
// generated region, OA-C17 (a), D-7265). They word some tokens differently on purpose, and W7 changes neither.
// `refusal-words.characterization.test.ts` keeps its own rows.
import { describe, expect, it } from 'vitest';
import { QUESTION_DOOR_REFUSALS } from '../../shared/api';
import { ApiError } from '../src/lib/api';
import { ASK_REFUSE_TEXT, NOTIFICATION_QUESTION_DOOR_TEXT, NOTIFICATION_REFUSAL_TEXT } from '../src/lib/refusalWords';
import { DIALOG_REFUSE_TEXT, QUESTION_DOOR_REFUSE_TEXT, dialogMultiRefusal, dialogRefusal, dialogTextRefusal } from '../src/session/askWords';

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

  it('NOTIFICATION_REFUSAL_TEXT: the notification\'s words for an ask answer\'s refusals (push-sw.js\'s table, moved)', () => {
    expect(NOTIFICATION_REFUSAL_TEXT).toEqual({
      'stale-ask': 'That question is gone.',
      'not-waiting': 'The session has moved on.',
      'ask-mismatch': 'The question changed — open the session and read it.',
      'multi-question': 'This one asks more than one thing — open the session.',
      multiselect: 'This one takes more than one answer — open the session.',
      'duplicate-index': 'That option was sent twice — open the session.',
      range: 'That option is no longer there.',
      'no-menu': 'The question is no longer on screen.',
      'menu-mismatch': 'The terminal is showing something else now.',
      'not-alive': 'That session is no longer running.',
      'unknown-session': 'That session is gone.',
    });
  });
});

// W7 C7g (D-7185, D-7485): W3 Q3f's door family adds one word of its own, `kind-mismatch` (`shared/api.ts`
// `#QUESTION_DOOR_REFUSALS`). Each surface words it once, in a table of its own beside the ones above, which stay as
// they were: the sheets (`askWords.ts#QUESTION_DOOR_REFUSE_TEXT`, read by the row's, the own words' and the set's
// refusal) and the notification (`refusalWords.ts#NOTIFICATION_QUESTION_DOOR_TEXT`, rendered into push-sw.js's region).
describe('the question door family\'s own word, worded once per surface (W7 C7g)', () => {
  const SHEET = "The server couldn't take that answer for this session's question, so nothing was pressed. Answer it in the terminal.";
  it('QUESTION_DOOR_REFUSE_TEXT and NOTIFICATION_QUESTION_DOOR_TEXT, total over QUESTION_DOOR_REFUSALS', () => {
    expect(Object.keys(QUESTION_DOOR_REFUSALS)).toEqual(['kind-mismatch']);
    expect(QUESTION_DOOR_REFUSE_TEXT).toEqual({ 'kind-mismatch': SHEET });
    expect(NOTIFICATION_QUESTION_DOOR_TEXT).toEqual({ 'kind-mismatch': "That answer didn't fit this session's question — open the session." });
  });
  it('the sheets word kind-mismatch with it, whichever answer was refused; other codes keep their own tables', () => {
    const refused = new ApiError(400, { ok: false, error: 'kind-mismatch' });
    expect(dialogRefusal(refused, false)).toBe(SHEET);
    expect(dialogRefusal(refused, true)).toBe(SHEET);
    expect(dialogTextRefusal(refused)).toBe(SHEET);
    expect(dialogMultiRefusal(refused)).toBe(SHEET);
    expect(dialogRefusal(new ApiError(409, { ok: false, error: 'stale-dialog' }), false)).toBe(DIALOG_REFUSE_TEXT['stale-dialog']);
  });
});
