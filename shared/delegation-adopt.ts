// Delegation broker wave 5 PR8b (D-8112, D-8113, D-8114; plan docs/superpowers/plans/2026-11-03-delegation-broker-wave5-adopt.md).
// The wire half of the door over the delegation lane's adoption switch (`GET`/`POST /api/coord/delegation-adopt`): its view, its
// request and its refusal words. The rule that decides a refusal is the server's L1 (`server/src/coord/delegation-adopt-switch.ts`);
// nothing here decides. L0: the PWA bundles `shared/`, so this file takes no `node:` module. It sits outside `shared/api.ts` for
// `scope-sweep.ts`'s reason: other programmes append at that file's foot.
import type { DelegationAdoptionHealth, MarkerState } from './api.js';

/** What the fleet box's measured `ccd caps` says of one capability the door reads: listed, not listed, or not read at all. A list
 *  that did not read is never folded into "not listed" (D-8113). */
export type DelegationAdoptCap = 'present' | 'absent' | 'unmeasured';
const DELEGATION_ADOPT_CAP_MAP: Record<DelegationAdoptCap, true> = { present: true, absent: true, unmeasured: true };
/** Every word of `DelegationAdoptCap`, derived (`SESSION_ROLE_MAP`'s idiom), for a reader's wire guard. */
export const DELEGATION_ADOPT_CAPS: readonly DelegationAdoptCap[] = Object.keys(DELEGATION_ADOPT_CAP_MAP) as DelegationAdoptCap[];

/** The door's refusal words, each with its ONE status (D-8113), spread into `shared/refusal.ts`'s `REFUSAL_STATUS`.
 *  `fleet-caps-unmeasured`: the fleet box's `ccd caps` did not read, so neither capability is known (503, try later).
 *  `fleet-switch-missing`: the fleet box's ccd has no `delegation-adopt` verb (501, `unsupported`'s status).
 *  `fleet-audit-missing`: the fleet box's ccd lacks `lease-audit-v1`, so a box that holds trees would keep every finished worktree
 *  without checking it (D-8057), 409: the request was well formed and the box's state refused it. */
export const DELEGATION_ADOPT_REFUSALS = {
  'fleet-caps-unmeasured': 503, 'fleet-switch-missing': 501, 'fleet-audit-missing': 409,
} as const;
export type DelegationAdoptRefusal = keyof typeof DELEGATION_ADOPT_REFUSALS;
export function isDelegationAdoptRefusal(v: unknown): v is DelegationAdoptRefusal {
  return typeof v === 'string' && Object.hasOwn(DELEGATION_ADOPT_REFUSALS, v);
}

/** What `GET /api/coord/delegation-adopt` answers, and what its POST answers after the verb ran.
 *  `state`: the marker, as one registry listing reads it (`unmeasurable` is never read as off). `caps`: the two capabilities the
 *  door's rule reads. `refused`: what a tap of each direction would be refused with now, or null. `adoption`: the lane's last
 *  pass (`DelegationAdoptionHealth`, its `keeps` list included), or null when the lane has counted nothing in this process. */
export interface DelegationAdoptView {
  readonly state: MarkerState;
  readonly caps: { readonly verb: DelegationAdoptCap; readonly audit: DelegationAdoptCap };
  readonly refused: { readonly on: DelegationAdoptRefusal | null; readonly off: DelegationAdoptRefusal | null };
  readonly adoption: DelegationAdoptionHealth | null;
}

/** `POST /api/coord/delegation-adopt`'s body: the switch, and nothing else. */
export interface DelegationAdoptRequest { on: boolean }
