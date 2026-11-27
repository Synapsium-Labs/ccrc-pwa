// A user turn as the chat draws it, with its pasted-text pointers (desktop-polish wave 194). Ring L1, context C3: the
// view model the confirmed bubble (`MessageBubble`) and the pending one (`PendingBubble`) both render, so the two can
// never disagree about a pointer, and the turn keeps its shape when the echo replaces the pending bubble.
//
// The turn's text is split at every line that reads as a pointer of THIS session (`splitPastePointers`, the one
// grammar); each such line becomes a chip in its place, its label and spoken name composed here from the line count
// alone. Today's attachment reading (`splitClipPaths`: the clip paths come out and are drawn as thumbnails above the
// bubble) runs over the TEXT parts only, so a pointer's path is never pulled up into the thumbnails, and a turn with no
// pointer is exactly today's: its one text part is the whole text.
import { splitClipPaths } from '../../../shared/api';
import { splitPastePointers } from '../../../shared/pastePointer';
import { pastedTextAria, pastedTextLabel } from './longPasteWords';

export type TurnPartView =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'paste'; readonly name: string; readonly label: string; readonly aria: string };

export interface UserTurnView {
  /** The attachment paths, as today: in order, each once. */
  readonly paths: readonly string[];
  /** The bubble's content in order; empty when the turn is attachments alone. */
  readonly parts: readonly TurnPartView[];
}

const pasteView = (name: string, lines: number): TurnPartView =>
  ({ kind: 'paste', name, label: pastedTextLabel(lines), aria: pastedTextAria(lines) });

/** The user turn `text` of session `sessionId`, as the chat draws it. */
export function userTurnView(text: string, sessionId: string): UserTurnView {
  const paths: string[] = [];
  const parts: TurnPartView[] = [];
  for (const part of splitPastePointers(text, sessionId)) {
    if (part.kind === 'paste') {
      parts.push(pasteView(part.pointer.name, part.pointer.lines));
      continue;
    }
    const split = splitClipPaths(part.text);
    for (const p of split.paths) if (!paths.includes(p)) paths.push(p);
    if (split.rest !== '') parts.push({ kind: 'text', text: split.rest });
  }
  return { paths, parts };
}

/** A pending send's text, as its bubble draws it: the same chips in their places, and the text parts as they are,
 *  because the pending bubble draws the tray's attachments from the send itself and its text as typed (today's). */
export function pendingTurnParts(text: string, sessionId: string): TurnPartView[] {
  return splitPastePointers(text, sessionId).flatMap((part): TurnPartView[] => {
    if (part.kind === 'paste') return [pasteView(part.pointer.name, part.pointer.lines)];
    return part.text === '' ? [] : [{ kind: 'text', text: part.text }];
  });
}
