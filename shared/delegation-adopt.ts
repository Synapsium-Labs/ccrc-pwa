// Delegation broker wave 5 PR8b (D-8112, D-8113, D-8114; plan docs/superpowers/plans/2026-11-03-delegation-broker-wave5-adopt.md).
// The wire half of the door over the delegation lane's adoption switch (`GET`/`POST /api/coord/delegation-adopt`): its view, its
// request and its refusal words. The rule that decides a refusal is the server's L1 (`server/src/coord/delegation-adopt-switch.ts`);
// nothing here decides. L0: the PWA bundles `shared/`, so this file takes no `node:` module. It sits outside `shared/api.ts` for
// `scope-sweep.ts`'s reason: other programmes append at that file's foot.
import type { DelegationAdoptionHealth, MarkerState } from './api.js';

// The caps words' one table: the union below is derived from it (`DELEGATION_ADOPT_REFUSALS`' idiom), so a word is spelled once. Its
// derived list has one reader, the Settings card's wire guard, so it lands with the card in PR8c (D-8114; review 1659 F6, ruled).
const DELEGATION_ADOPT_CAP_MAP = { present: true, absent: true, unmeasured: true } as const;
/** What the fleet box's measured `ccd caps` says of one capability the door reads: listed, not listed, or not read at all. A list
 *  that did not read is never folded into "not listed" (D-8113). */
export type DelegationAdoptCap = keyof typeof DELEGATION_ADOPT_CAP_MAP;

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
/** What a tap of `on` can be refused with (D-8113, review 1659 F2): the three words above, and the collect-lane door's own
 *  `sign-in-unarmed` (403, already in `REFUSAL_STATUS`), when sign-in is dark or the caller holds no session. `off` is never refused
 *  for it. */
export type DelegationAdoptOnRefusal = DelegationAdoptRefusal | 'sign-in-unarmed';

/** What `GET /api/coord/delegation-adopt` answers, and what its POST answers after the verb ran.
 *  `state`: the marker, as one registry listing reads it (`unmeasurable` is never read as off). `caps`: the two capabilities the
 *  door's rule reads. `refused`: what a tap of each direction would be refused with now, for the caller that asked, or null (`on`
 *  reads `sign-in-unarmed` for a caller that is not a signed-in operator). `adoption`: the lane's last
 *  pass (`DelegationAdoptionHealth`, its `keeps` list included), or null when the last pass counted nothing (review 1665 N7). The
 *  switch's own position is `state`, read from the marker, never from `adoption`. */
export interface DelegationAdoptView {
  readonly state: MarkerState;
  readonly caps: { readonly verb: DelegationAdoptCap; readonly audit: DelegationAdoptCap };
  readonly refused: { readonly on: DelegationAdoptOnRefusal | null; readonly off: DelegationAdoptRefusal | null };
  readonly adoption: DelegationAdoptionHealth | null;
}

/** `POST /api/coord/delegation-adopt`'s body: the switch, and nothing else. The route's body parse is typed by it. */
export interface DelegationAdoptRequest { on: boolean }
