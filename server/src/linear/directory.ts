/**
 * THE DIRECTORY (#1444, D-7668, D-7682 R5; spec 2026-10-31 §4.4): each workspace's workflow states (with their team's
 * key), labels, projects and active users, so that a session can name them and the server sends Linear their ids.
 *
 * L3 ADAPTER: process memory the one background refresher fills (`refresher.ts`). It is the only cache in this design,
 * and it holds no secret: names, ids and the key's own user's id, never a key. It is keyed by slot and by the digest
 * of the key that filled it, so a replaced key drops it: a lookup with another digest finds nothing.
 *
 * FILLED IN THE BACKGROUND ONLY. Nothing here calls Linear, and no request fills it: a name the directory does not
 * hold is answered `name-unknown` at once, and the miss queues the refresher (`LinearRefresher#nameMiss`) unless the
 * slot was filled for the same key inside ten minutes (`filledAt`). Lookups are the operation table's
 * (`ops.ts#lookupLinearName`), over what `get` answers.
 */
import type { LinearDirectoryEntries } from './ops.js';
import type { LinearSlotRef } from './store.js';

/** What a request may do with the directory: read one slot's entries, for the key it read. */
export interface LinearDirectoryRead {
  /** The slot's entries, filled with the key whose digest is `keyDigest`; null when none are (never filled, or filled
   *  with another key). */
  get(slot: LinearSlotRef, keyDigest: string): LinearDirectoryEntries | null;
}

/** The legacy slot's own fixed key; a file slot's id is a UUID, so the two never meet. */
const slotKeyOf = (ref: LinearSlotRef): string => (ref.source === 'legacy' ? 'legacy' : `file:${ref.id}`);

interface Held { keyDigest: string; entries: LinearDirectoryEntries; at: number }

/** The one directory. Constructed by the refresher alone, which is its only writer. */
export class LinearDirectory implements LinearDirectoryRead {
  private readonly bySlot = new Map<string, Held>();

  get(slot: LinearSlotRef, keyDigest: string): LinearDirectoryEntries | null {
    const held = this.bySlot.get(slotKeyOf(slot));
    return held !== undefined && held.keyDigest === keyDigest ? held.entries : null;
  }

  /** When the slot's entries for this key were filled, or null. */
  filledAt(slot: LinearSlotRef, keyDigest: string): number | null {
    const held = this.bySlot.get(slotKeyOf(slot));
    return held !== undefined && held.keyDigest === keyDigest ? held.at : null;
  }

  /** The refresher's write: the whole directory of one slot, for the key it was read with. Replaces what was held. */
  put(slot: LinearSlotRef, keyDigest: string, entries: LinearDirectoryEntries, at: number): void {
    this.bySlot.set(slotKeyOf(slot), {
      keyDigest,
      at,
      entries: Object.freeze({
        viewerId: entries.viewerId,
        states: Object.freeze([...entries.states]),
        labels: Object.freeze([...entries.labels]),
        projects: Object.freeze([...entries.projects]),
        users: Object.freeze([...entries.users]),
      }),
    });
  }
}
