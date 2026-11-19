/**
 * THE MAIL IDEMPOTENCY KEY'S DECISION (Overlord wave 164; note `docs/superpowers/programs/overlord/mail-idempotency-key.md`).
 * L1, pure: no I/O and no clock, context C5 by the `coord/**` row.
 *
 * A sender that may retry a send (an unclear timeout, the client's exit 3) names an optional `clientKey` on `POST /api/mail`.
 * Uniqueness is per sender, (`fromId`, `clientKey`): the route reads the mail this sender already stored under the key
 * (`CoordStore.mailByClientKey`) and acts on what this module decides. `same` answers the original id and queues nothing;
 * `conflict` is refused `key-conflict` (409), because a key reused for a different message is a caller defect and accepting
 * either copy would guess which one the caller meant. The comparison is over what the mail row records, so a retry is judged
 * against the stored mail, never against a second copy of the request.
 */
import type { MailKind } from '../../../shared/api.js';

/** The fields of a send that make it the same mail. The route passes the request's, the store the stored row's; `toId` is
 *  the address as SENT (a role word stays a role word), which is what `mail.toId` records. */
export interface KeyedSend {
  readonly toId: string;
  readonly runId: number | null;
  readonly kind: MailKind;
  readonly subject: string;
  readonly body: string;
  readonly artifacts: readonly string[];
}

/** A stored mail under a key: its id and the fields above. */
export interface KeyedMail extends KeyedSend {
  readonly id: number;
}

/** The fields compared, in the order a conflict names them. */
export const KEYED_FIELDS = ['toId', 'runId', 'kind', 'subject', 'body', 'artifacts'] as const;
export type KeyedField = (typeof KEYED_FIELDS)[number];

export type MailKeyVerdict =
  | { readonly verdict: 'new' }
  | { readonly verdict: 'same'; readonly id: number }
  | { readonly verdict: 'conflict'; readonly id: number; readonly fields: readonly KeyedField[]; readonly detail: string };

const sameArtifacts = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((p, i) => p === b[i]);

/** `prior` is the mail this sender stored under the key, or null when it stored none. */
export function mailKeyVerdict(request: KeyedSend, prior: KeyedMail | null): MailKeyVerdict {
  if (prior === null) return { verdict: 'new' };
  const fields = KEYED_FIELDS.filter((f) => f === 'artifacts'
    ? !sameArtifacts(request.artifacts, prior.artifacts)
    : request[f] !== prior[f]);
  if (fields.length === 0) return { verdict: 'same', id: prior.id };
  return {
    verdict: 'conflict', id: prior.id, fields,
    detail: `this clientKey already names mail ${prior.id} from this sender, which differs in ${fields.join(', ')}; ` +
      'a retry must resend the same mail, and a new mail needs a new key',
  };
}
