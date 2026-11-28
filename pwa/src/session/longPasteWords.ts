// The words of a long paste sent as a saved file (desktop-polish wave 194), defined once. Ring L1, context C3 (Session
// Conversation): strings and the pure functions that compose them; the chip row, the composer and the chat bubbles
// render what these return and spell nothing themselves. The upload's own refusals keep their existing words
// (`uploadErrorText`, and `tooLargeText` in `useAttachImage.ts` given `pasteName`), reused, never copied.
//
// No sentence here carries a character of the paste: a paste may hold a secret, so the chip row, the chat chip and
// every failure say a number, a line count and a reason, nothing else.
import { linesWord } from '../../../shared/pastePointer';

/** A pasted text named by its chip number, as the composer's chip row numbers it: `Pasted text #2`. */
export const pasteName = (n: number): string => `Pasted text #${String(n)}`;

/** The chip row's line while the pasted texts are being saved and Send is held. */
export const PASTE_SAVING_TEXT = 'Saving pasted text…';

/** The two acts of a chip whose save failed (the row's lower-case act words, as `expand` and `dismiss` are). */
export const PASTE_RETRY_WORD = 'retry';
export const PASTE_TYPED_WORD = 'send as typed text';

/** Their spoken names, for the chip a failure belongs to. */
export const pasteRetryLabel = (n: number): string => `Retry saving ${pasteName(n).toLowerCase()}`;
export const PASTE_TYPED_LABEL = 'Send the message with every pasted text typed in full instead';

/** A save that did not answer within its deadline (`PASTE_SAVE_DEADLINE_MS`, `usePasteSave.ts`). */
export const pasteTimeoutText = (n: number, seconds: number): string =>
  `${pasteName(n)} was not saved within ${String(seconds)} seconds`;

/** A saved file whose pointer would not read back as this session's own (`pasteSend.ts`, `unpointable`). Saving again
 *  cannot change that (the saved file stands for the same text), so this failure offers no retry and says why. */
export const pasteUnpointableText = (n: number): string =>
  `${pasteName(n)} was saved, but its file cannot be named in this session's message, so it can go only as typed text`;

/** An upload's refusal, in the tray's words (`uploadErrorText(apiErrorText(err))`), said of the pasted text it hit. */
export const pasteFailedText = (n: number, reason: string): string => `${pasteName(n)}: ${reason}`;

/** The chat's chip for a pointer: what it says, and its spoken name. */
export const pastedTextLabel = (lines: number): string => `Pasted text · ${linesWord(lines)}`;
export const pastedTextAria = (lines: number): string => `Open the pasted text, ${linesWord(lines)}, in a new tab`;
