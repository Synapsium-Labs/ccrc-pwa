// The body checks of the console's prompt to the designated session (context C11, L1; Overlord W1 private store plan, Task 5; review
// 2550 F6). Pure: no fs, no clock, no SQL. `promptRecord.ts` (L4) asks it before it records anything and acts on what it answers, so
// the ORDER of these refusals, which a client can see, is decided in one place and pinned by a mutation entry.
import { isSendKey } from '../../../shared/operatorMessages.js';

/** What the act does with a body: record `text` (with the composed `key`, or none), or refuse by a word. */
export type PromptBodyVerdict =
  | { readonly kind: 'ok'; readonly text: string; readonly key: string | null }
  | { readonly kind: 'refuse'; readonly word: 'bad-attachment' | 'bad-request'; readonly detail?: string };

/** Total over the body's three fields, checked in this order: attachments, then the text, then the send key. Attachments are
 *  content, never words (§3.8): no door serves a file to the Overlord in W1, so any attachment but an empty list is
 *  `bad-attachment` (slug `overlord-prompt-takes-no-attachment`). The text must be a non-empty string. A send key that is present
 *  must be an `isSendKey` (16 to 64 characters of A-Z a-z 0-9 _ -). The key is passed apart from the body because `sendKey` is a
 *  pane typer's name, which `single-definition/injected-prompts.test.ts` reserves in `server/src`. */
export function promptBodyVerdict(body: { readonly text?: unknown; readonly attachments?: unknown }, key: unknown): PromptBodyVerdict {
  if (body.attachments !== undefined && !(Array.isArray(body.attachments) && body.attachments.length === 0)) {
    return { kind: 'refuse', word: 'bad-attachment' };
  }
  if (typeof body.text !== 'string' || body.text.length === 0) return { kind: 'refuse', word: 'bad-request' };
  if (key !== undefined && !isSendKey(key)) {
    return { kind: 'refuse', word: 'bad-request', detail: 'sendKey: 16 to 64 characters of A-Z a-z 0-9 _ -' };
  }
  return { kind: 'ok', text: body.text, key: key === undefined ? null : key };
}
