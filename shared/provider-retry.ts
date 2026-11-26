// The provider-failure ladder's vocabulary (plan `docs/superpowers/plans/2026-11-25-provider-retry.md`). Ring L0, context C5:
// it imports only its `./` siblings. Pure: the mail's subject with the due time inside, its reader, the body and the line the
// mail lane types. What the console is told of a session's retry is `provider-retry-wire.ts`.
//
// The due time is in the subject because the run-less notice dedupes on the subject over every delivery state
// (`rundefsTx.ts#queueRunlessNotice`): one due time is one mail, across restarts.
import { INJECTED_PROMPTS } from './injected-prompts.mjs';
import { OPERATOR_MESSAGE_SENDER } from './operatorMessages.js';

export const PROVIDER_RETRY_PREFIX = 'provider retry:';
const DUE_RE = /^provider retry: your turn ended on a provider error \(due (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)\)$/;

/** The mail's subject. `dueAt` is an epoch the caller measured as not later than now, so it is a date. */
export function providerRetrySubject(dueAt: number): string {
  return `${PROVIDER_RETRY_PREFIX} your turn ended on a provider error (due ${new Date(dueAt).toISOString()})`;
}
/** The due time a subject names, or null for a subject that is not this mail's. */
export function providerRetryDueOf(subject: string): number | null {
  const m = DUE_RE.exec(subject);
  if (m === null) return null;
  const at = Date.parse(m[1]!);
  return Number.isNaN(at) ? null : at;
}
/** A retry mail is the server's own: a session's mail under the same subject is ordinary mail. */
export const isProviderRetryMail = (m: { readonly fromId: string; readonly subject: string }): boolean =>
  m.fromId === OPERATOR_MESSAGE_SENDER && providerRetryDueOf(m.subject) !== null;

/** The mail's whole body. It asks for nothing else: no mail to a coordinator, no report. */
export const PROVIDER_RETRY_BODY = 'Your turn ended on a provider error; continue where you stopped.';
/** The line the mail lane types: the mail nudge's head, then the body. A session with no mail client (the designated Overlord)
 *  reads it as well as any other, and there is nothing to fetch. */
export function renderProviderRetryLine(): string {
  return `${INJECTED_PROMPTS['mail-nudge'].text} ${PROVIDER_RETRY_BODY}`;
}
