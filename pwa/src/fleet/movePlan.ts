// The move planner (centralised-update design 2026-09-20 §13 "W4 adds", §18
// "Install names the order and the direction"; programme wave 5 Task 8). PURE
// — no fetch, no React, no clock. Given the last good /api/updates view and
// what the operator tapped, it answers which nodes that tap moves, in the
// order the server will move them, and the request(s) one confirm sends. All
// five move controls (Install / Roll back on a release row, Update / Roll back
// on an inventory row, Update all on the fleet banner) build a MoveIntent and
// hand the plan to the ONE sheet (UpdateMoveSheet), so they cannot disagree.
//
// ORDER IS THE DISPATCHER'S. compareDispatchOrder (shared/api.ts) is the one
// spelling of "fleet-role before server-role, then label, then node id"; the
// server's planDispatch moves nodes in that order and this file lists them in
// it, so the sheet cannot name the server first while the fleet moves first.
//
// THE SET IS WHAT THE MOVE TAKES SOMEWHERE. A fleet-wide update names each
// node the tag takes FORWARD — one running an older tag, or one whose stamp
// was READ and carries no tag (an unversioned box: any eligible release is
// newer, never "not newer") — the not-newer / stamp-unread half of the rule
// POST /api/updates/apply {all: true} skips by (D-3385).
// The route also skips a node its dispatcher would refuse for a reason this
// view cannot decide without a second copy of the dispatcher (a tag the node
// refused, a missing capability —
// MoveSkipWhy, shared/api.ts); the 202 names
// those in `skipped`, and the sheet says the ones it named (moveSkippedText). It never names a
// node whose stamp was not read (unmeasured is not unversioned), one whose floor was never measured
// (floor-unread: `highestVersion` NULL with `floorRead: 'unmeasured'`, W2's NodeWire field), or a macOS
// node (not centrally managed, decision 17 — no PWA surface offers it a move,
// D-3308, D-3309). A fleet-wide rollback names every non-macOS node running a
// NEWER tag than the target, and sends one single-node rollback per node, in
// order (D-3390): the rollback route names one node.
//
// TAG ORDER IS SEMVER: isNewerTag, always behind isReleaseTag (it throws
// RangeError on a non-tag) — v0.0.10 is newer than v0.0.9.
import { compareDispatchOrder, isReleaseTag, rollbackTargetRefusal } from '../../../shared/api';
import type { ApplyUpdateBody, NodeWire, ReleaseWire, RollbackUpdateBody, UpdatesView } from '../../../shared/api';
import { isNewerTag } from '../../../shared/semver';
import { nodeVersion } from './useUpdatesView';

export type MoveIntent =
  | { scope: 'node'; direction: 'update'; nodeId: string; tag: string }
  | { scope: 'node'; direction: 'rollback'; nodeId: string; to: string }
  | { scope: 'fleet'; direction: 'update'; tag: string }
  | { scope: 'fleet'; direction: 'rollback'; to: string };

/** The nodes a move names, sorted by compareDispatchOrder — what the sheet lists and what it sends for — and
 *  the inventory it was planned over, so a node an answer names that the move does not (a halting row) has a
 *  label (moveLabel). */
export interface PlannedMove { intent: MoveIntent; nodes: NodeWire[]; inventory: readonly NodeWire[] }

export type MoveRequest =
  | { route: 'apply'; body: ApplyUpdateBody }
  | { route: 'rollback'; body: RollbackUpdateBody };

/** A node a move can name at all: not macOS (not centrally managed, decision 17; D-3308, D-3309). THE filter —
 *  `planMove` picks fleet-wide sets through it and the release list's direction (`releaseDirection`, D-3410)
 *  asks it too, so a lagging Mac cannot make a row read Install where the sheet would move the Linux nodes back. */
export function isManagedNode(n: NodeWire): boolean {
  return n.os !== 'darwin';
}

/** `tag` takes `n` forward: a tag it runs is older, or its stamp was READ and carries no tag — and in either case
 *  the tag is strictly newer than the node's floor when `highestVersion` is a tag, the dispatcher's rule
 *  (D-3403: `moveRefusal` answers `not-newer` at or below `floorOf(highestVersion,
 *  currentVersion)`, and `{all: true}` skips that node), so the sheet never names a node the route will skip
 *  `not-newer`. A floor that was never measured (`floor-unread`, D-3492) is not named either
 *  (W2's `floorRead`, sent on every NodeWire, read exactly as `resolveOnChannel` reads it; an `undefined` one is an
 *  older server's silence and previews nothing, so the route's `skipped` still names that node, D-3492). */
function takesForward(n: NodeWire, tag: string): boolean {
  if (n.highestVersion === null && n.floorRead === 'unmeasured') return false;   // floor-unread: resolveOnChannel's own test (resolve.ts); undefined = an older server, previews nothing
  if (isReleaseTag(n.highestVersion) && !isNewerTag(tag, n.highestVersion)) return false;
  const v = nodeVersion(n);
  if (v !== null) return isNewerTag(tag, v);
  return n.stampRead === 'ok';
}

/** `n` runs a tag newer than `tag` — the only node a rollback to `tag` has anywhere to take. */
function runsNewer(n: NodeWire, tag: string): boolean {
  const v = nodeVersion(n);
  return v !== null && isNewerTag(v, tag);
}

/** Wave 8 item C: one node a fleet rollback would name that the server refuses before any spawn, and why. */
export interface RollbackBlocker { label: string; word: 'unknown-tag' | 'no-bundle' }
/** The managed nodes a fleet rollback to `to` names (planMove's own set: isManagedNode and runsNewer), in dispatch
 *  order, whose rollback the L0 predicate refuses — never a copy of it. ANY one blocks the row: D-3390's per-node
 *  sequence would move the nodes before it and stop at the refused one, splitting the fleet. */
export function rollbackBlockers(nodes: readonly NodeWire[], release: ReleaseWire | undefined, to: string): RollbackBlocker[] {
  if (!isReleaseTag(to)) return [];
  const out: RollbackBlocker[] = [];
  for (const n of nodes.filter((x) => isManagedNode(x) && runsNewer(x, to)).sort(compareDispatchOrder)) {
    const word = rollbackTargetRefusal(release, n.provenance);
    if (word !== null) out.push({ label: n.label, word });
  }
  return out;
}

export function planMove(view: UpdatesView, intent: MoveIntent): PlannedMove {
  const all: readonly NodeWire[] = Array.isArray(view.nodes) ? view.nodes : [];
  let picked: NodeWire[];
  if (intent.scope === 'node') {
    picked = all.filter((n) => n.nodeId === intent.nodeId);
  } else if (intent.direction === 'update') {
    const tag = intent.tag;
    picked = isReleaseTag(tag) ? all.filter((n) => isManagedNode(n) && takesForward(n, tag)) : [];
  } else {
    const to = intent.to;
    picked = isReleaseTag(to) ? all.filter((n) => isManagedNode(n) && runsNewer(n, to)) : [];
  }
  // `filter` returned a fresh array, so this sort never reorders the poll's view.
  return { intent, nodes: picked.sort(compareDispatchOrder), inventory: all };
}

export function moveTarget(intent: MoveIntent): string {
  return intent.direction === 'update' ? intent.tag : intent.to;
}

export function moveHeadline(intent: MoveIntent): string {
  return intent.direction === 'update' ? `Update ${intent.tag}` : `Roll back to ${intent.to}`;
}

/** Wave 8 item F3: how a rollback happens, said on every rollback sheet with a node in it. True on every
 *  cmd_rollback path: an intact kept copy flips; otherwise a re-install downloads the tag. Either can be refused
 *  (by the server before any spawn — a 409 shown in this sheet or a notice — or by the node, on its row) or can fail
 *  (a gate that fails is not restored, `_upd_rollback_no_restore`; a kept spine that does not complete). It makes no
 *  per-node claim: the kept state is not inventoried. */
export function rollbackHowText(to: string): string {
  return `A rollback flips each node to its kept copy of ${to} when that copy is intact; otherwise the node downloads ${to} and re-installs it. Either way it can be refused or can fail, and the reason is shown: here or in a notice when the server refuses the move, and on the node's row when the node does.`;
}

/** What a node runs, in the words the inventory row keeps apart (wave 3's currentText): a tag, an unversioned
 *  build (a stamp that was read and carries none), or a stamp that was never read — never folded together. */
function currentWord(n: NodeWire): string {
  const v = nodeVersion(n);
  if (v !== null) return v;
  return n.stampRead === 'ok' ? 'unversioned' : 'stamp not read';
}

export function moveLines(plan: PlannedMove): string[] {
  const target = moveTarget(plan.intent);
  return plan.nodes.map((n, i) => `${i + 1}. ${n.label} (${n.role ?? 'unknown role'}) ${currentWord(n)} → ${target}`);
}

export function moveRequests(plan: PlannedMove): MoveRequest[] {
  if (plan.nodes.length === 0) return [];
  const i = plan.intent;
  if (i.scope === 'node') {
    return i.direction === 'update'
      ? [{ route: 'apply', body: { nodeId: i.nodeId, tag: i.tag } }]
      : [{ route: 'rollback', body: { nodeId: i.nodeId, to: i.to } }];
  }
  if (i.direction === 'update') return [{ route: 'apply', body: { all: true, tag: i.tag } }];
  const to = i.to;
  return plan.nodes.map((n): MoveRequest => ({ route: 'rollback', body: { nodeId: n.nodeId, to } }));
}

/** What an empty plan says — only what was measured. A node move names nothing only when the view no longer
 *  carries the node; a fleet move to a non-tag names nothing; otherwise no managed (non-macOS) node was measured
 *  on the far side of the target (forward: takesForward — older, or unversioned, and above its floor). That is not
 *  "every node is already there": a node can be AHEAD of it (a release row that reads Install because not every
 *  node is newer), or below it but at its floor. */
export function moveEmptyText(intent: MoveIntent): string {
  if (intent.scope === 'node') return 'Nothing to move — that node is no longer in the inventory.';
  const target = moveTarget(intent);
  if (!isReleaseTag(target)) return `Nothing to move — ${target} is not a release tag.`;
  return intent.direction === 'update'
    ? `Nothing to move — ${target} takes no managed node forward.`
    : `Nothing to move — no managed node is measured on a release newer than ${target}.`;
}

/** A node's label from the inventory the move was planned over, else its id (a node that has left it). */
export function moveLabel(plan: PlannedMove, nodeId: string): string {
  return plan.inventory.find((n) => n.nodeId === nodeId)?.label ?? nodeId;
}
