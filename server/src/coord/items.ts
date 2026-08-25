import { type CoordStore, type SettleItem } from './store.js';
import {
  isWorkItemState, WORK_ITEM_MAX,
  type RunItemTally, type RunRefuseCode, type WorkItemState,
} from '../../../shared/api.js';

/**
 * L1 (architecture increment 4). No `reply`, no `node:sqlite`, no `tx` —
 * narrow deps in, typed union out. The all-or-nothing COMMIT belongs to the
 * ring that owns `DatabaseSync`'s synchrony invariant (`architecture:141-142`),
 * so this file validates and maps and `CoordStore.settleItems` commits
 * (D-289 (was D-B4-16)) — the same split `dispatchRun`/`CoordStore.dispatchRun` and
 * `closeRun`/`CoordStore.closeRun` already draw, reached here for the third
 * time rather than reasoned out afresh.
 *
 * It performs no fleet act at all — the ledger is a database fact, and the
 * RE-MEASUREMENT that authorises this write already happened, at
 * `POST /api/runs/:id/advance` (or `/close`), before the coordinator called
 * here. That ordering is spec §3.2's whole argument and it is not restated
 * as a second check here: a per-item done fingerprint is an explicit
 * non-goal (spec §5).
 */
export interface SettleItemsDeps { coord: CoordStore }

export type SettleItemsOutcome =
  | { ok: true; id: number; items: RunItemTally }
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'bad-request' }
  | { ok: false; kind: 'refused';
      code: Extract<RunRefuseCode, 'unknown-item' | 'item-terminal'>;
      itemId: number; state?: WorkItemState };

export function settleItems(deps: SettleItemsDeps, id: number, body: unknown): SettleItemsOutcome {
  const coord = deps.coord;
  if (!coord.run(id)) return { ok: false, kind: 'unknown-run' };

  const b = (body ?? {}) as { items?: unknown };
  // An EMPTY batch is a bad request, not a no-op success: at dispatch `[]` is
  // a legal statement ("this run declares no ledger", spec §3.1), but here it
  // is a settle that names nothing to settle — the caller meant something and
  // sent nothing, and a 200 would tell it the write it never made succeeded.
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > WORK_ITEM_MAX) {
    return { ok: false, kind: 'bad-request' };
  }
  const parsed: SettleItem[] = [];
  for (const raw of b.items) {
    const e = (raw ?? {}) as { id?: unknown; state?: unknown; claimedBy?: unknown };
    // `isWorkItemState` accepts `'unknown'` — the READ-side degradation member.
    // A WRITER may not name it, exactly as `isSendableMailKind` refuses it at
    // the mail ingress (`shared/api.ts`).
    if (typeof e.id !== 'number' || !Number.isInteger(e.id) ||
        !isWorkItemState(e.state) || e.state === 'unknown' ||
        !(e.claimedBy === undefined || e.claimedBy === null || typeof e.claimedBy === 'string')) {
      return { ok: false, kind: 'bad-request' };
    }
    parsed.push({ id: e.id, state: e.state, claimedBy: (e.claimedBy as string | null | undefined) ?? null });
  }

  const res = coord.settleItems(id, parsed);
  if (res.ok) return { ok: true, id, items: res.items };
  return res.why === 'unknown-item'
    ? { ok: false, kind: 'refused', code: 'unknown-item', itemId: res.itemId }
    : { ok: false, kind: 'refused', code: 'item-terminal', itemId: res.itemId, state: res.state };
}
