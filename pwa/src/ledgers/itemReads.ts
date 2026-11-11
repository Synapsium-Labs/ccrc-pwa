// One item read by its id (D-8194; ring L4: a hook and a module cache). The Waiting on you list carries the open items and the
// last 48 hours of cleared ones; an item named by its number past that (a link in another item's text, a page kept open, an
// address typed) is read from `GET /api/items/:id`, which answers any item the operator was shown, whatever its state and age.
//
// Two readers share the one cache. `useItemRead` reads the item an item page names when the live list does not hold it, so it
// still opens (read-only when it has closed). `useItemRefs` answers which numbers an item's text names are real items, so
// `linkRuns` draws only those as links: a number the list holds is one at once; any other is read once per page life, and
// stays text until the server says it is an item. What the server said of a number is kept for the page's life (an item's
// id never stops naming it); a read that failed (offline, refused, an answer that is not an item) is not kept, so a later
// render asks again.
import { useEffect, useSyncExternalStore } from 'react';
import type { ItemView } from '../../../shared/ledgers';
import { api } from '../lib/api';
import { ApiError } from '../lib/apiError';
import { isRecord } from '../lib/wire';

/** What the server said of a number: the item, or that no item it has (that the operator was shown) has it. */
export type ItemRead = { readonly kind: 'item'; readonly item: ItemView } | { readonly kind: 'unknown' };
/** The read: `api.item` by default; a test passes its own. */
export type ItemLoad = (id: number) => Promise<{ readonly ok: true; readonly item: ItemView }>;

const said = new Map<number, ItemRead>();
const flights = new Map<number, Promise<ItemRead | null>>();
const listeners = new Set<() => void>();
let version = 0;
const changed = (): void => { version += 1; for (const l of listeners) l(); };
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = (): number => version;

/** Read one item by its id, once on the wire per id: the server's answer, kept, or null when nothing was learnt. */
export function readItem(id: number, load: ItemLoad = api.item): Promise<ItemRead | null> {
  const running = flights.get(id);
  if (running !== undefined) return running;
  const flight = (async (): Promise<ItemRead | null> => {
    try {
      const answer: unknown = await load(id);
      if (!isRecord(answer) || answer.ok !== true || !isRecord(answer.item) || answer.item.id !== id) return null;
      return { kind: 'item', item: answer.item as unknown as ItemView };
    } catch (err) {
      return err instanceof ApiError && err.status === 404 ? { kind: 'unknown' } : null;
    }
  })().then((read) => {
    flights.delete(id);
    if (read !== null) { said.set(id, read); changed(); }
    return read;
  });
  flights.set(id, flight);
  return flight;
}

/** What the cache holds of a number, if anything. */
export const itemReadOf = (id: number): ItemRead | undefined => said.get(id);

/** Forget every read: a test's own clean slate. */
export function forgetItemReads(): void { said.clear(); flights.clear(); changed(); }

/** The item `id` as the server last answered it, read once on each visit while `wanted` (the live list does not hold it), or
 *  null: not wanted, not read yet, or no such item. */
export function useItemRead(id: number | null, wanted: boolean, load: ItemLoad = api.item): ItemView | null {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (id !== null && wanted) void readItem(id, load);
  }, [id, wanted, load]);
  if (id === null || !wanted) return null;
  const read = said.get(id);
  return read?.kind === 'item' ? read.item : null;
}

/** Which of `ids` are items: those the page has heard (`heard`, the list's own ids) at once, and the rest once the server has
 *  said so. Each number not heard and not yet answered is read once. The caller keeps `heard` stable while the list is
 *  unchanged (a memo over it), so a failed read is not asked again on every render. */
export function useItemRefs(ids: readonly number[], heard: ReadonlySet<number>, load: ItemLoad = api.item): (id: number) => boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = ids.join(',');
  useEffect(() => {
    for (const id of ids) if (!heard.has(id) && !said.has(id)) void readItem(id, load);
    // `key` stands for `ids`, and the heard set is read fresh: a number heard since needs no read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, heard, load]);
  return (id: number): boolean => heard.has(id) || said.get(id)?.kind === 'item';
}
