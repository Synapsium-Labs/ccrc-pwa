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
import { LONE_SURROGATE } from '../canonical.js';

/** The fields of a send that make it the same mail. The route passes the request's, the store the stored row's; `toId` is
 *  the address as SENT (a role word stays a role word), which is what `mail.toId` records, and `inReplyTo` is the delivery
 *  id the send named, as sent (review 2725 F1: a different reply target under one key is a different mail, never a silent
 *  merge), which is what `mail.inReplyTo` records. `urgent` (mid-turn mail, ruling N10) is whether the send marked the mail
 *  urgent, which the store reads as `mail.urgentAs` being set: a retry that adds or drops the mark is a different mail. */
export interface KeyedSend {
  readonly toId: string;
  readonly runId: number | null;
  readonly kind: MailKind;
  readonly subject: string;
  readonly body: string;
  readonly artifacts: readonly string[];
  readonly inReplyTo: number | null;
  readonly urgent: boolean;
}

/** A stored mail under a key: its id and the fields above. */
export interface KeyedMail extends KeyedSend {
  readonly id: number;
}

/** The fields compared, in the order a conflict names them. */
export const KEYED_FIELDS = ['toId', 'runId', 'kind', 'subject', 'body', 'artifacts', 'inReplyTo', 'urgent'] as const;
export type KeyedField = (typeof KEYED_FIELDS)[number];

export type MailKeyVerdict =
  | { readonly verdict: 'new' }
  | { readonly verdict: 'same'; readonly id: number; readonly urgent: boolean }
  | { readonly verdict: 'conflict'; readonly id: number; readonly fields: readonly KeyedField[]; readonly detail: string };

/** Text as the store keeps it (review 2725 F4): SQLite stores TEXT as UTF-8, which cannot carry a lone surrogate, so one
 *  is read back as U+FFFD. Both sides are compared in that form, so a genuine retry of such text is `same`, never a false
 *  `conflict`. Text with no lone surrogate is returned unchanged. */
const LONE_SURROGATES = new RegExp(LONE_SURROGATE.source, 'g');
export const storedText = (s: string): string => s.replace(LONE_SURROGATES, '\ufffd');

const sameText = (a: string, b: string): boolean => storedText(a) === storedText(b);
const sameArtifacts = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((p, i) => sameText(p, b[i]!));

/** `prior` is the mail this sender stored under the key, or null when it stored none. */
export function mailKeyVerdict(request: KeyedSend, prior: KeyedMail | null): MailKeyVerdict {
  if (prior === null) return { verdict: 'new' };
  const fields = KEYED_FIELDS.filter((f) => {
    if (f === 'artifacts') return !sameArtifacts(request.artifacts, prior.artifacts);
    const a = request[f], b = prior[f];
    return typeof a === 'string' && typeof b === 'string' ? !sameText(a, b) : a !== b;
  });
  // `urgent` is the STORED mark, so the route's replay echoes what the mail is (ruling N10).
  if (fields.length === 0) return { verdict: 'same', id: prior.id, urgent: prior.urgent };
  return {
    verdict: 'conflict', id: prior.id, fields,
    detail: `this clientKey already names mail ${prior.id} from this sender, which differs in ${fields.join(', ')}; ` +
      'a retry must resend the same mail, and a new mail needs a new key',
  };
}
