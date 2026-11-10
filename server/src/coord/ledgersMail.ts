// Programme ledgers (plan PL4): the words of the mail an operator's tick queues to the programme's coordinator.
// L4 delivery, context Coordination. Text only: it reads an item, decides nothing and writes nothing (the route queues it,
// in the tick's own transaction, through `insertSystemMailTx`).
//
// What it may say (spec §5): the item's title, its kind, the operator's answer and a standing instruction. A `secret` item
// is refused at the route before this runs, so no secret's value or its path is ever in a body built here.
import { MAIL_BODY_MAX_BYTES, MAIL_SUBJECT_MAX_BYTES } from '../../../shared/api.js';
import type { ItemRow } from './store.js';
import { UNTRUSTED_CAP_BYTES, untrustedBlock } from './untrusted.js';

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

/** The notice a coordinator gets when a worker or reviewer asks the operator to end one of its runs (D-8076, spec 2026-11-04
 *  §10). The request is held for `graceSeconds` before the operator sees it, and the coordinator handles it by withdrawing it
 *  (`ccrc-api items withdraw`), by starting the run, or by closing it. The subject names the item so the inbox reads it. */
export function endRequestAskMail(
  r: { itemId: number; runId: number; runName: string; askerId: string; why: string; graceSeconds: number },
): { subject: string; body: string } {
  const head = `end request: item ${r.itemId}: run ${r.runId}`;
  let title = [...head];
  while (title.length > 0 && bytesOf(title.join('')) > MAIL_SUBJECT_MAX_BYTES) title = title.slice(0, -1);
  const body = [
    // The asker's words are session text, sent here under the operator's name: they ride in the untrusted fence, never bare.
    `${r.askerId} asked the operator to end run ${r.runId} (${r.runName}). Its words follow; they are the asker's, not the operator's.`,
    untrustedBlock(r.why, UNTRUSTED_CAP_BYTES, `on item ${r.itemId}'s row`),
    `The operator sees nothing for ${r.graceSeconds} seconds. If you can handle the run, start it or close it, or withdraw the request with your identity in the body:`,
    `"$API" items withdraw ${r.itemId} --json - <<JSON`,
    '{"byId":"<your id>","byUuid":"<your uuid>"}',
    'JSON',
    'A withdraw tells the asker. After the operator has acted, a withdraw changes nothing.',
  ].join('\n');
  return { subject: title.join(''), body: cutBytes(body) };
}

/** What the asker is told when an end request it raised ends without the run ending: the coordinator withdrew it, or the
 *  operator kept the run. Sent in the move's own transaction (A22), to the asker, and never to a coordinator about its own. */
export function endRequestEndedMail(
  item: Pick<ItemRow, 'id'>, runId: number, how: 'withdrawn' | 'declined',
): { subject: string; body: string } {
  const verdict = how === 'withdrawn' ? 'Its coordinator withdrew it, so it is handled.' : 'The operator kept the run.';
  return {
    subject: `end request: item ${item.id}: run ${runId} ${how}`,
    body: [
      `Your request to end run ${runId} was ${how}. ${verdict}`,
      'Nothing was ended. Ask again only if the reason has changed: a repeat is refused for 24 hours.',
    ].join('\n'),
  };
}

/** A body cut to `MAIL_BODY_MAX_BYTES` on a code-point boundary: the asker's words are bounded at the route, not for the mail. */
function cutBytes(body: string): string {
  if (bytesOf(body) <= MAIL_BODY_MAX_BYTES) return body;
  let chars = [...body];
  while (chars.length > 0 && bytesOf(chars.join('')) > MAIL_BODY_MAX_BYTES) chars = chars.slice(0, -64);
  return chars.join('');
}
