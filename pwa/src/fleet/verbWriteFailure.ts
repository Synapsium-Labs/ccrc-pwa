// D-7902, D-7994: a Settings switch written through a ccd verb (`Stop leftovers`, `Leftover processes`), the words its wait
// and its failed write share, and the ONE reader of that failure. Both doors answer through `refuseRoute`, so a rejection
// is either the route's own refusal, which moved nothing, or an answer that proves nothing about the write.
import { DISPATCH_ABANDON_TEXT } from '../../../shared/dispatch-abandon';
import { ApiError } from '../lib/apiError';
import { COORD_UNSUPPORTED_TEXT, apiErrorText } from '../lib/refusalWords';
import { isRecord } from '../lib/wire';

export const VERB_WRITE_TEXT = {
  asked: 'Asked the fleet box; this card changes when the fleet confirms it.',
  unconfirmed: 'The fleet has not confirmed the change yet, so the choice above is the last one it reported.',
  refused: DISPATCH_ABANDON_TEXT.refused,
  unanswered: 'No answer from the server, so the choice may have been saved; this card changes if the fleet confirms it.',
} as const;

/** `fleetFailed` carries two answers, and only `stderr` tells them apart. With it, ccd ran and died before moving the
 *  marker. Without it, the route's not-ran arm: its `detail` says the verb went unanswered, so whether the marker moved
 *  is unknown. */
export const isVerbNotRan = (body: Readonly<Record<string, unknown>>): boolean =>
  body.error === 'fleetFailed' && typeof body.stderr !== 'string';

/** The answers that prove the verb moved nothing, spelled once. Any other failure proves nothing about the write. */
const VERB_REFUSALS: readonly unknown[] = ['bad-request', 'unsupported', 'fleetFailed'];
export const isVerbRefusal = (body: Readonly<Record<string, unknown>>): boolean =>
  VERB_REFUSALS.includes(body.error) && !isVerbNotRan(body);

/** A write's rejection, as its line: the route's own refusal moved nothing; anything else proves nothing about the write.
 *  The not-ran arm's sentence is left out: it promises a later pass, and nothing retries this write. */
export function verbWriteFailure(err: unknown): { text: string; tone: 'refusal' | 'answer' } {
  const T = VERB_WRITE_TEXT;
  if (!(err instanceof ApiError)) return { text: T.unanswered, tone: 'answer' };
  const body = isRecord(err.body) ? err.body : {};
  if (isVerbNotRan(body)) return { text: T.unanswered, tone: 'answer' };
  const said = typeof body.detail === 'string' && body.detail.trim() !== '' ? body.detail.trim() : apiErrorText(err);
  const detail = err.status === 501 ? COORD_UNSUPPORTED_TEXT : said;
  return isVerbRefusal(body)
    ? { text: `${T.refused} (${detail})`, tone: 'refusal' }
    : { text: `${T.unanswered} (${detail})`, tone: 'answer' };
}
