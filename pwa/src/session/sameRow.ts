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

/** Whether every own field of `a` and `b` but those in `skip` is the same value (`Object.is`). A field one item has
 *  and the other lacks compares `undefined` with its value. */
function sameFields(a: object, b: object, skip: readonly string[]): boolean {
  const ra = a as Readonly<Record<string, unknown>>;
  const rb = b as Readonly<Record<string, unknown>>;
  for (const k of Object.keys(ra)) if (!skip.includes(k) && !Object.is(ra[k], rb[k])) return false;
  for (const k of Object.keys(rb)) if (!skip.includes(k) && !(k in ra) && !Object.is(ra[k], rb[k])) return false;
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
    return sameFields(a, b, ['entries']);
  }
  const derived = DERIVED_FROM_EVENT[a.kind];
  return sameFields(a, b, derived === undefined ? [] : [derived]);
}

/** Whether a row's words read the viewer's clock: a usage-limit pill with a reset time, which `MessageBubble` draws
 *  through `resetClock` ("resets 12:00" on the day of the reset, the date on any other). Review 1128: such a row
 *  compares the viewer's day as well, so it draws again at local midnight; no other row does. */
export function readsClock(item: TranscriptItem): boolean {
  return item.kind === 'message' && item.event.kind === 'system' && item.event.origin === 'limit'
    && item.event.resetsAt !== undefined;
}

/** Whether a row's props are the same: its `item` by `sameTranscriptItem`, and every other prop by identity, except
 *  `day` (`lib/clock.ts#dayKey`), which only a row whose words read the clock (`readsClock`) compares. */
export function sameRowProps<P extends { readonly item: TranscriptItem; readonly day?: string }>(a: P, b: P): boolean {
  if (!sameTranscriptItem(a.item, b.item)) return false;
  return sameFields(a, b, readsClock(a.item) ? ['item'] : ['item', 'day']);
}
