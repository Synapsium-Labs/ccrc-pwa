/**
 * L3 (console speed S1): the registry reader's memory of the last clean read of each row, so a cold row (see
 * `rowTemperature.ts`) costs no field reads on a quiet tick. Memory only; one instance lives with the watcher.
 *
 * Only a CLEAN record is ever stored (`isCleanRecord`, the one predicate, owned by `rowTemperature.ts`). `put` of
 * an unclean record stores nothing AND evicts the id's older entry: otherwise an older clean entry could make the
 * row cold right after a fresh unclean read. `get` answers copies, so a caller that changes a record cannot change
 * the cache.
 */
import type { SessionRecord } from './registry.js';
import { isCleanRecord, type RowKey } from './rowTemperature.js';

export type CachedRow = { record: SessionRecord; key: RowKey; readAt: number };

const copyKey = (k: RowKey): RowKey => ({ names: [...k.names], times: k.times === null ? null : [...k.times] });

export class RegistryRowCache {
  private readonly rows = new Map<string, CachedRow>();

  get(id: string): CachedRow | undefined {
    const row = this.rows.get(id);
    if (row === undefined) return undefined;
    return { record: structuredClone(row.record), key: copyKey(row.key), readAt: row.readAt };
  }

  put(id: string, record: SessionRecord, key: RowKey, readAt: number): void {
    if (!isCleanRecord(record)) { this.rows.delete(id); return; }
    this.rows.set(id, { record: structuredClone(record), key: copyKey(key), readAt });
  }

  /** Drops one id (a row the reader could not assemble leaves no entry). */
  delete(id: string): void { this.rows.delete(id); }

  /** Drops every id not in `liveIds` (the ids the current listing names). */
  prune(liveIds: ReadonlySet<string>): void {
    for (const id of [...this.rows.keys()]) if (!liveIds.has(id)) this.rows.delete(id);
  }
}
