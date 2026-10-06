// What the home screen says about a halted or skewed fleet (centralised-update design 2026-09-20 §10, §13;
// programme wave 14, R15). Pure reads of FleetScreen's one /api/updates answer, with no poll of their own. Three
// callers: the halt banner (HaltBanner.tsx), Update all (UpdateBanner.tsx) and the skew arm (FleetHostBanner.tsx).
//
// WHO HALTS is the dispatcher's own rule, `isHaltingUpdate` (shared/update-move.ts, L0), the same predicate
// `server/src/update/dispatch.ts`'s `isHalting` calls. The wire carries no "halted" word, so the PWA asks the rule
// of each row's lease (`update.state`, `update.detail`). `isNodeElement` (useUpdatesView.ts) does not validate
// `update`, so every read here is defensive, the way `canAck`'s is. A throw would blank the home screen: pwa/src
// has no error boundary. A lease that cannot be read is NOT folded into "clear" where it would vouch for a move:
// `skewRemedy` answers `cli` for it (Reading 14 holds what the halt banner and Update all do with it).
//
// WHETHER AUTO MOVES A NODE is the dispatcher's own auto path, from L0 too: `autoPermits` (intendedMove's auto
// clause), a `desiredTag` to move to (a converged row's is NULL), and moveRefusal's capability clauses for an auto
// move — `carriesDetachCap`, `carriesUpdateGate` (`no-update-gate`), `agentPredatesUpdateOp`.
import type { AutoMode, NodeWire, UpdateIntentWire } from '../../../shared/api';
import { FLEET_SCOPE, isAutoMode, isUpdateChannel } from '../../../shared/api';
import {
  agentPredatesUpdateOp, autoPermits, carriesDetachCap, carriesUpdateGate, isHaltingUpdate,
} from '../../../shared/update-move';
import { isManagedNode } from './movePlan';

/** The rows that halt the fleet, in inventory order. Empty for a view with no node array. */
export function haltingNodes(nodes: readonly NodeWire[] | null | undefined): NodeWire[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((n) => {
    const state: unknown = n.update?.state;
    const detail: unknown = n.update?.detail;
    return typeof state === 'string' && isHaltingUpdate(state, typeof detail === 'string' ? detail : null);
  });
}

/** This row's lease could not be read: no `update` object, or a state that is not a string. */
export const leaseUnreadable = (n: NodeWire): boolean => typeof n.update?.state !== 'string';

/** One halting row, said: `fleet: failed (last tried v0.0.84) — gate: unit not up`. A settled lease is not moving:
 *  its `target` survives the settle only so that "last tried" stays readable (store.ts `ackNode`), and it may be a
 *  rollback's target, so it is said as what was tried, never as a direction. The target and the detail are left out
 *  when the lease carries none. Text only: every part reaches the DOM as a React text child. */
export function haltLine(n: NodeWire): string {
  const state = typeof n.update?.state === 'string' ? n.update.state : 'unknown';
  const target = typeof n.update?.target === 'string' && n.update.target !== '' ? ` (last tried ${n.update.target})` : '';
  const detail = typeof n.update?.detail === 'string' && n.update.detail !== '' ? ` — ${n.update.detail}` : '';
  return `${n.label}: ${state}${target}${detail}`;
}

/** The labels a halt names, `, `-joined. */
export const haltLabels = (halting: readonly NodeWire[]): string => halting.map((n) => n.label).join(', ');

/** `fleet is acknowledged — tap Ack on it` / `fleet, server are acknowledged — tap Ack on each`. */
const untilAcked = (halting: readonly NodeWire[]): string => halting.length === 1
  ? `${haltLabels(halting)} is acknowledged — tap Ack on it in the halt banner`
  : `${haltLabels(halting)} are acknowledged — tap Ack on each in the halt banner`;

/** Update all's reason while a halt stands (R15(b)): who halts, and where the remedy is. It promises nothing about
 *  what moves after the ack: that is Update all's own sheet, once it is enabled again. */
export const updateAllHaltedText = (halting: readonly NodeWire[]): string =>
  `Update all waits: nothing moves until ${untilAcked(halting)}.`;

/** The skew arm's lead while a halt stands; FleetHostBanner ends it per `SkewRemedy.then`. */
export const skewHaltLead = (halting: readonly NodeWire[]): string => `Nothing moves until ${untilAcked(halting)}`;

/** The skew arm's sentence when auto moves the lagging box (with no halt, or after the ack). */
export const SKEW_AUTO_TEXT = 'Auto-install is on and the console can move the lagging box — follow the move in Settings.';
export const SKEW_HALT_THEN_AUTO_TAIL = '; auto-install then moves the lagging box.';

/** The console can move this node on a REQUEST: it is managed (not macOS, decision 17), its last measurement reached
 *  it, its ccrc carries the one-tap, and its agent (if it has one) knows the update op. These are moveRefusal's own
 *  capability clauses, from L0. A live agent link is not on the wire, so this is what the server last measured,
 *  never a promise. */
export function consoleCanMove(n: NodeWire): boolean {
  if (!isManagedNode(n) || n.reachable !== true || !Array.isArray(n.caps)) return false;
  if (n.agentOps !== null && !Array.isArray(n.agentOps)) return false;
  return carriesDetachCap(n.caps) && !agentPredatesUpdateOp(n.agentOps);
}

/** AUTO moves this node by itself: the console can move it, its ccrc carries the health gate auto requires
 *  (`no-update-gate`), auto permits its resolved channel, and the resolver gave it a tag to move to. */
export function autoWouldMove(n: NodeWire, auto: AutoMode): boolean {
  if (!consoleCanMove(n) || !carriesUpdateGate(n.caps)) return false;
  const channel = isUpdateChannel(n.channel) ? n.channel : null;
  return autoPermits(auto, channel) && typeof n.desiredTag === 'string' && n.desiredTag !== '';
}

/** What the skew banner advises (R15(c)):
 *   - `halt`: a node halts the fleet, so nothing moves until it is acked. This outranks everything. `then` says what
 *     happens AFTER the ack, by the same rule as the two arms below over the same rows (an ack clears the lease and
 *     the request, never the channel, the caps or the desired tag);
 *   - `auto`: the fleet intent's auto-install is on, at least one node has a tag auto would move it to, and every such
 *     node is one auto would move (`autoWouldMove`), so the console moves the lagging box itself;
 *   - `cli`: anything else, including no inventory answer (a box with no control plane, or a first poll still in
 *     flight) and a lease that could not be read. The console cannot vouch for a move then, so the terminal verbs
 *     stand. */
export type SkewRemedy =
  | { kind: 'halt'; halting: NodeWire[]; then: 'auto' | 'cli' } | { kind: 'auto' } | { kind: 'cli' };

function autoArm(nodes: readonly NodeWire[], intent: readonly UpdateIntentWire[] | null | undefined): 'auto' | 'cli' {
  const fleet = Array.isArray(intent) ? intent.find((i) => i.scope === FLEET_SCOPE) ?? null : null;
  // A word this build cannot name is not "on": the console cannot say what it would do.
  if (fleet === null || !isAutoMode(fleet.auto)) return 'cli';
  const auto = fleet.auto;
  const pending = nodes.filter((n) => typeof n.desiredTag === 'string' && n.desiredTag !== '');
  return pending.length > 0 && pending.every((n) => autoWouldMove(n, auto)) ? 'auto' : 'cli';
}

export function skewRemedy(
  nodes: readonly NodeWire[] | null | undefined, intent: readonly UpdateIntentWire[] | null | undefined,
): SkewRemedy {
  // An empty inventory needs no guard of its own: no node has a tag to move to, so autoArm answers `cli`.
  if (!Array.isArray(nodes)) return { kind: 'cli' };
  const halting = haltingNodes(nodes);
  const then = nodes.some(leaseUnreadable) ? 'cli' : autoArm(nodes, intent);
  if (halting.length > 0) return { kind: 'halt', halting, then };
  return { kind: then };
}
