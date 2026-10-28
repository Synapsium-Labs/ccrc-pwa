// When a transcript row is the same row (desktop polish Task C7). `buildChatItems` builds every item again on each
// events frame, while the events themselves keep their identity (`dedupeAppend`), so an item compared by identity is
// never the same twice. `ChatList`'s row barrier compares it by its fields instead: a frame then re-renders only the
// rows it changed (the streaming turn, a new row, a call whose result arrived), never the rest.
//
// L1: pure, and `import type` only.
import type { TranscriptItem } from './toolSummary';

/** The fields an item derives from its own `event`: `buildChatItems` parses them again on every build (a mail item's
 *  envelope, a task item's notification), so they are compared through `event` alone. */
const DERIVED_FROM_EVENT: Readonly<Partial<Record<TranscriptItem['kind'], string>>> = {
  mail: 'envelope',
  task: 'notification',
};

/** Whether every own field of `a` and `b` but `skip` is the same value (`Object.is`). A field one item has and the
 *  other lacks compares `undefined` with its value. */
function sameFields(a: object, b: object, skip: string | undefined): boolean {
  const ra = a as Readonly<Record<string, unknown>>;
  const rb = b as Readonly<Record<string, unknown>>;
  for (const k of Object.keys(ra)) if (k !== skip && !Object.is(ra[k], rb[k])) return false;
  for (const k of Object.keys(rb)) if (k !== skip && !(k in ra) && !Object.is(ra[k], rb[k])) return false;
  return true;
}

/** Whether `a` and `b` draw the same row: the same kind and key, and every own field the same value, except the fields
 *  derived from the item's event (compared through `event`) and a tool group's `entries` (compared element by element,
 *  each entry by this same rule). A field added to an item later is compared by identity, the safe direction: at worst
 *  the row renders again. */
export function sameTranscriptItem(a: TranscriptItem, b: TranscriptItem): boolean {
  if (Object.is(a, b)) return true;
  if (a.kind !== b.kind || a.key !== b.key) return false;
  if (a.kind === 'tool-group' && b.kind === 'tool-group') {
    if (a.entries.length !== b.entries.length) return false;
    for (let i = 0; i < a.entries.length; i += 1) if (!sameTranscriptItem(a.entries[i]!, b.entries[i]!)) return false;
    return sameFields(a, b, 'entries');
  }
  return sameFields(a, b, DERIVED_FROM_EVENT[a.kind]);
}

/** Whether a row's props are the same: its `item` by `sameTranscriptItem`, every other prop by identity. */
export function sameRowProps<P extends { readonly item: TranscriptItem }>(a: P, b: P): boolean {
  if (!sameTranscriptItem(a.item, b.item)) return false;
  return sameFields(a, b, 'item');
}
