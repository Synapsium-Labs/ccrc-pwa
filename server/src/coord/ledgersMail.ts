// Programme ledgers (plan PL4): the words of the mail an operator's tick queues to the programme's coordinator.
// L4 delivery, context Coordination. Text only: it reads an item, decides nothing and writes nothing (the route queues it,
// in the tick's own transaction, through `insertSystemMailTx`).
//
// What it may say (spec §5): the item's title, its kind, the operator's answer and a standing instruction. A `secret` item
// is refused at the route before this runs, so no secret's value or its path is ever in a body built here.
import { MAIL_BODY_MAX_BYTES, MAIL_SUBJECT_MAX_BYTES } from '../../../shared/api.js';
import type { ItemRow } from './store.js';

/** The title is cut to this many characters in the subject, so a subject stays one readable line. */
const SUBJECT_TITLE_MAX = 80;

const bytesOf = (s: string): number => Buffer.byteLength(s, 'utf8');

/** The subject names the item, so the coordinator's inbox reads it and the newest tick mail of an item is found by it.
 *  `done: item <id>: <title>`: the title is cut to 80 characters and then, if the subject is still past
 *  `MAIL_SUBJECT_MAX_BYTES`, to fewer, always on a code-point boundary (never half of a surrogate pair). */
export function itemMailSubject(item: Pick<ItemRow, 'id' | 'title'>): string {
  const head = `done: item ${item.id}: `;
  let title = [...item.title].slice(0, SUBJECT_TITLE_MAX);
  while (title.length > 0 && bytesOf(head + title.join('')) > MAIL_SUBJECT_MAX_BYTES) title = title.slice(0, -1);
  return head + title.join('');
}

/** The body: what the item was, what the operator answered (or that it takes no answer), and the standing instruction. The
 *  coordinator never takes a tick as proof; it measures, as it does a worker's wave-done (spec Figure 3). */
export function itemMailBody(item: Pick<ItemRow, 'id' | 'program' | 'kind' | 'title'>, answer: string | null): string {
  return [
    `The operator ticked item ${item.id} (${item.kind}) of programme ${item.program}: ${item.title}`,
    answer === null ? 'no answer: this item takes none' : `The operator's answer: ${answer}`,
    `Re-measure before you confirm; return it with what you found if it does not hold. ccrc-api items confirm|return ${item.id}`,
  ].join('\n');
}

/** The tick's subject and body, bounded in bytes (review 1335 F6): the ingress bounds a peer's mail
 *  (`MAIL_BODY_MAX_BYTES`), `insertMail` does not, and the body is typed into a pane, so a body past the cap is refused here
 *  with its measured size rather than queued. The subject is cut to fit by `itemMailSubject`. */
export function tickMail(item: Pick<ItemRow, 'id' | 'program' | 'kind' | 'title'>, answer: string | null):
  { ok: true; subject: string; body: string } | { ok: false; bytes: number; limit: number } {
  const body = itemMailBody(item, answer);
  const bytes = bytesOf(body);
  if (bytes > MAIL_BODY_MAX_BYTES) return { ok: false, bytes, limit: MAIL_BODY_MAX_BYTES };
  return { ok: true, subject: itemMailSubject(item), body };
}
