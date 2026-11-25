// The provider-failure ladder's vocabulary (plan `docs/superpowers/plans/2026-11-25-provider-retry.md`). Ring L0, context C5:
// it imports only its `./` siblings. Pure: the mail's subject with the due time inside, its reader, the body and the line the
// mail lane types (wave 1); and what the console is told of a session's retry, with its one reader (wave 2).
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

/** `FleetSession.providerRetry` (wave 2): a session whose turn ended on a provider error and that the ladder retries by itself.
 *  ABSENT (or null) says no more than that no retry is known: none owed, a stopped ladder, not measured, an older server. */
export interface ProviderRetryWire {
  /** The turn marker's error token (`overloaded`, `server_error`); null when it names none. */
  readonly err: string | null;
  /** Epoch ms of the oldest of the consecutive failures, and how many there were. */
  readonly since: number;
  readonly attempts: number;
  /** Epoch ms at which the next nudge falls due; null while something keeps it out, so no time is promised. */
  readonly nextAt: number | null;
  readonly phase: 'retrying';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The one reader of `FleetSession.providerRetry`, for a revived row and for a live frame, which is cast. A phase this build
 *  does not know, and anything malformed, is absent: the words are never a guess. */
export function providerRetryOf(v: unknown): ProviderRetryWire | null {
  if (typeof v !== 'object' || v === null) return null;
  const { err, since, attempts, nextAt, phase } = v as Record<string, unknown>;
  if (phase !== 'retrying' || !(err === null || typeof err === 'string') || !isNum(since) || !isNum(attempts) || !(nextAt === null || isNum(nextAt))) return null;
  return { err, since, attempts, nextAt, phase };
}
