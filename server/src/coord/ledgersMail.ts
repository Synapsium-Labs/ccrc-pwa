// Programme ledgers (plan PL4): the words of the mail an operator's tick queues to the programme's coordinator.
// L4 delivery, context Coordination. Text only: it reads an item, decides nothing and writes nothing (the route queues it,
// in the tick's own transaction, through `insertSystemMailTx`).
//
// What it may say (spec §5): the item's title, its kind, the operator's answer and a standing instruction. A `secret` item
// is refused at the route before this runs, so no secret's value or its path is ever in a body built here.
import type { ItemRow } from './store.js';

/** The title is cut to this many characters in the subject, so a subject stays one readable line. */
const SUBJECT_TITLE_MAX = 80;

/** The subject names the item, so the coordinator's duplicate guard (`hasOutstandingMail`) and its inbox both read it.
 *  `done: item <id>: <title cut to 80>`. */
export function itemMailSubject(item: Pick<ItemRow, 'id' | 'title'>): string {
  return `done: item ${item.id}: ${item.title.slice(0, SUBJECT_TITLE_MAX)}`;
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
