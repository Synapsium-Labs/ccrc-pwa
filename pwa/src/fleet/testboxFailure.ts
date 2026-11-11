// D-8289: the ONE reader of a failed test box write, shared by the card's switch and Bring tools up to date
// (`TestBoxSection`) and the build list's Capture again (`TestBoxBuilds`). An `ApiError` is the server's answer, a refusal:
// its `detail` when it sent one, else the client's one reading of the error (`apiErrorText`). Anything else (the fetch
// rejected: a network drop, a TypeError) is no answer at all, so the line says so in the answer tone and never shows the
// raw error's message.
import { ApiError, apiErrorText } from '../lib/api';
import { isRecord } from '../lib/wire';
import type { ResultLineValue } from './settingsText';

/** What a write that got no answer from the server says. */
export const TESTBOX_UNANSWERED = 'No answer from the server';

/** A failed test box write, as its result line. */
export function testboxFailure(err: unknown): ResultLineValue {
  if (!(err instanceof ApiError)) return { text: TESTBOX_UNANSWERED, tone: 'answer' };
  const body = isRecord(err.body) ? err.body : {};
  const detail = typeof body.detail === 'string' && body.detail.trim() !== '' ? body.detail.trim() : null;
  return { text: detail ?? apiErrorText(err), tone: 'refusal' };
}
