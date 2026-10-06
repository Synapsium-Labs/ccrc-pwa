// L0 — what the update dispatcher and the PWA must answer ALIKE about one node (centralised-update design
// 2026-09-20 §10, §13; programme wave 14, R15). Pure; it imports nothing but its `shared/` siblings, not even
// `node:*`, because the PWA bundles it.
//
// The dispatcher (`server/src/update/dispatch.ts`, L1) decided these alone until wave 14. Then the home screen had
// to say WHO halts the fleet, and whether the console can move a node at all, before the operator taps. A
// PWA-local copy would be a second spelling of the dispatcher's own rule that nothing forces to agree with it. So
// the rule moved here, and `dispatch.ts` calls it: `isHalting` delegates to `isHaltingUpdate`; `moveRefusal`'s
// `no-detach-cap`, `no-update-gate` and `agent-predates-update-op` clauses ask the three predicates below; and
// `autoPermits` (the auto clause of `intendedMove` and the fleet hold) moved here whole. Every caller keeps its
// path, because `dispatch.ts` re-exports DETACH_CAP and autoPermits.
//
// NOT HERE: `server/src/coord/store.ts`'s SQL (`haltingRowSql`) and JS (`rowHalts`) forms of the halt. They are
// the store's own notion and are pinned equal to `isHalting` by `update-store-nodes.test.ts`.
import {
  PROVENANCE_DETAIL_PREFIX, SETTLED_UPDATE_STATES, UPDATE_GATE_CAP, type AutoMode, type UpdateChannel,
} from './api.js';
import { UPDATE_OP } from './agent-protocol.js';

/** The `ccrc-caps` word for `ccrc update --detach` (wave 4's `_inst_caps`; Linux-only, decision 17). Every
 *  console move rides it, the server's own row's too. */
export const DETACH_CAP = 'detach';

/** A settled state other than `idle` halts dispatch until `ack` (spec §10). It is derived from the settled list,
 *  the way the store derives HALTED_UPDATE_STATES, so a settled state added later halts by default. The EXCEPTION
 *  is a `failed` row whose detail begins PROVENANCE_DETAIL_PREFIX: that is a verdict on the release, not a fault
 *  of the node (D-3378). A state this build cannot name is not settled, so it does not halt. */
export function isHaltingUpdate(state: string, detail: string | null): boolean {
  if (!(SETTLED_UPDATE_STATES as readonly string[]).includes(state) || state === 'idle') return false;
  if (state === 'failed' && detail !== null && detail.startsWith(PROVENANCE_DETAIL_PREFIX)) return false;
  return true;
}

/** The node's `ccrc-caps` carry the one-tap (`moveRefusal`'s `no-detach-cap` when false). */
export function carriesDetachCap(caps: readonly string[]): boolean {
  return caps.includes(DETACH_CAP);
}

/** The node's `ccrc-caps` carry the post-install health gate (`moveRefusal`'s `no-update-gate` for an AUTO move
 *  when false: auto never moves a node that cannot prove the move worked; an operator request still can). */
export function carriesUpdateGate(caps: readonly string[]): boolean {
  return caps.includes(UPDATE_GATE_CAP);
}

/** 'off' → false; 'stable' → the node resolved to stable; 'channel' → it resolved to any channel. Moved whole from
 *  `dispatch.ts` in wave 14 (D-4266): the skew banner says "auto moves the lagging box" only where this says so. */
export function autoPermits(auto: AutoMode, channel: UpdateChannel | null): boolean {
  switch (auto) {
    case 'off': return false;
    case 'stable': return channel === 'stable';
    case 'channel': return channel !== null;
    default: {
      const unhandled: never = auto;
      return unhandled;
    }
  }
}

/** The node is reached over an agent link (`agentOps` not NULL) whose agent does not list the update op
 *  (`moveRefusal`'s `agent-predates-update-op`). NULL is the server's own row, which no link carries, so it is
 *  never checked (decision 11). */
export function agentPredatesUpdateOp(agentOps: readonly string[] | null): boolean {
  return agentOps !== null && !agentOps.includes(UPDATE_OP);
}
