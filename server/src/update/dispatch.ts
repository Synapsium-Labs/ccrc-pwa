// L1 — THE DISPATCHER'S DECISION (design 2026-09-20 §9/§10; programme wave 5,
// Task 4). Pure: rows in, a plan out — no fs, no store, no fastify, no link,
// no Runner, no timer, no clock (`now` is a parameter). `converge.ts` (L3,
// Task 5, D-3383) reads the rows, calls planDispatch,
// acquires the one lease with `dispatchNode` in the same synchronous stretch
// (D-3377) and sends the op; the update routes (Task 6) call
// `moveRefusal` for a single node's synchronous 409 — the dispatcher's own
// predicate, never a copy of it. Ring membership is a property of the import
// block below, and update-dispatch.test.ts pins it by reading it.
//
// EVERY TAG IS COMPARED BEHIND isReleaseTag: shared/semver.ts throws
// RangeError on a non-tag, and a row carries whatever an older build and a
// same-user writer left in it.
import {
  SETTLED_UPDATE_STATES, UPDATE_GATE_CAP, compareDispatchOrder, dispatchRank, isReleaseTag,
  type AutoMode, type DispatchRefusal, type NodeRole, type RequestKind, type StampRead, type TagFileRead, type UpdateChannel,
  type UpdateState,
} from '../../../shared/api.js';
import { UPDATE_OP } from '../../../shared/agent-protocol.js';
import { isNewerTag } from '../../../shared/semver.js';
import { floorOf, type EligibilityRow } from './resolve.js';

/** Wave 4's other two ccrc-caps words (`_inst_caps`; `detach` is Linux-only, decision 17). UPDATE_GATE_CAP is
 *  the third's one spelling (shared/api.ts, D-3305); these two have no reader outside this file. */
export const DETACH_CAP = 'detach';
export const ROLLBACK_CAP = 'rollback';
/** Spec §10, verbatim: the lease detail for an update to a node whose stamp reads but names no version. */
export const UNVERSIONED_DETAIL = 'unversioned box — any eligible release is newer';
/** The word W2's `sweepPlanFor` tests before it records a node's refusal of a release: a `failed` row whose
 *  detail begins with it is a verdict on the RELEASE, and does not halt (D-3378). */
export const PROVENANCE_DETAIL_PREFIX = 'provenance:';
/** Spec §10's `failed: deadline` — the detail `runDispatch` (Task 5) releases an expired lease with. */
export const DEADLINE_DETAIL = 'deadline';

/** The columns this module reads. `NodeRow` (coord/store.ts) satisfies it structurally — the consumer declares
 *  the port (L2), so this file never imports the store. `highestVersion` is `~/.ccrc/floor` (NULL = absent =
 *  unconstrained unless `floorRead` is `'unmeasured'` — W2 D-3213: never measured, refused `floor-unread` like the
 *  resolver's `floorUnmeasured`), otherwise read only through W2's `floorOf`. */
export interface DispatchRow {
  nodeId: string; role: NodeRole | null; label: string;
  currentVersion: string | null; highestVersion: string | null; floorRead: TagFileRead;
  stampRead: StampRead; caps: readonly string[]; agentOps: readonly string[] | null;
  reachable: boolean; updateState: UpdateState; updateTarget: string | null; updateStartedAt: number | null;
  updateDetail: string | null; reportedUpdatedAt: number | null;
  channel: UpdateChannel | null; desiredTag: string | null;
  requestedTag: string | null; requestedKind: RequestKind | null; requestedAt: number | null;
}
/** One live node as the dispatcher sees it: its row, the `auto` its intent resolved to, and the tags THIS node
 *  refused (decision 16 — another node's refusal is not an input). */
export interface DispatchNodeView { row: DispatchRow; auto: AutoMode; refusedTags: ReadonlySet<string> }
export interface DispatchInput { nodes: readonly DispatchNodeView[]; releases: readonly EligibilityRow[] }
/** `viaLink` = the row has an agent (`agentOps` not NULL) — the op rides the link; false = the server's own
 *  row, spawned locally (decision 11). */
export interface DispatchMove { nodeId: string; kind: RequestKind; target: string; source: 'request' | 'auto'; viaLink: boolean; detail: string }
export interface PlannedRefusal { nodeId: string; refusal: DispatchRefusal; detail: string }
export interface MetRequest { nodeId: string; tag: string }
/** Over the live rows: `haltedBy` every halting row's nodeId, in nodeId order; `leaseHeldBy` the first busy
 *  row's, or null. */
export interface FleetGate { haltedBy: string[]; leaseHeldBy: string | null }
export interface DispatchPlan {
  gate: FleetGate;
  /** null: nothing dispatchable — the reason is in gate / refusals / met. */
  move: DispatchMove | null;
  /** One per considered IDLE node refused, in compareDispatchOrder. A refused `failed`/`reverted` row is not
   *  listed: its updateDetail is the verdict the halt reads, and a note must never overwrite it (Review Focus 5). */
  refusals: PlannedRefusal[];
  /** D-3380 — an idle node already running its requested tag; settled by the act, never
   *  dispatched. */
  met: MetRequest[];
}
/** The row a refusal sentence names besides the node itself: the halting row, or the fleet row that holds a
 *  server-role node back — by its request, or, with `auto: true`, by the auto move it has not yet made
 *  (D-3402; `tag` is then its desiredTag). */
export interface RefusalBlocker { label: string; tag: string | null; auto?: true }

const SETTLED: readonly string[] = SETTLED_UPDATE_STATES;
/** Busy is NOT settled — W2's stance (`NOT IN SETTLED_UPDATE_SQL`), so `unknown` holds the lease. */
const isSettled = (s: UpdateState): boolean => SETTLED.includes(s);

/** A settled state other than `idle` halts dispatch until `ack` (spec §10) — derived from the settled list the
 *  way W2's store derives HALTED_UPDATE_STATES, so a settled state added later halts by default — EXCEPT a
 *  `failed` row whose detail begins PROVENANCE_DETAIL_PREFIX: a verdict on the release, not a fault of the node. */
export function isHalting(row: Pick<DispatchRow, 'updateState' | 'updateDetail'>): boolean {
  if (!isSettled(row.updateState) || row.updateState === 'idle') return false;
  if (row.updateState === 'failed' && row.updateDetail !== null && row.updateDetail.startsWith(PROVENANCE_DETAIL_PREFIX)) return false;
  return true;
}

const byNodeId = (a: DispatchRow, b: DispatchRow): number => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0);

export function fleetGate(rows: readonly DispatchRow[]): FleetGate {
  const sorted = [...rows].sort(byNodeId);
  return {
    haltedBy: sorted.filter(isHalting).map((r) => r.nodeId),
    leaseHeldBy: sorted.find((r) => !isSettled(r.updateState))?.nodeId ?? null,
  };
}

/** 'off' → false; 'stable' → the node resolved to stable; 'channel' → it resolved to any channel. */
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

/** What the node's version reads as. ONLY a stamp that read (`ok`) with no version is unversioned; a stamp that
 *  could not be read is never "unversioned" (D-3379; wave 3's D-3307 line). */
type Current = { kind: 'versioned'; tag: string } | { kind: 'unversioned' } | { kind: 'unread' };
function currentOf(row: Pick<DispatchRow, 'stampRead' | 'currentVersion'>): Current {
  if (row.stampRead !== 'ok') return { kind: 'unread' };
  if (row.currentVersion === null) return { kind: 'unversioned' };
  return isReleaseTag(row.currentVersion) ? { kind: 'versioned', tag: row.currentVersion } : { kind: 'unread' };
}

type Intended = { kind: RequestKind; target: string; source: 'request' | 'auto' };
/** A request outranks auto — the operator's tap is the stronger intent. A request this build cannot read (a
 *  kind token outside RequestKind reads null, D-3181) moves NOTHING and auto does not take over: the request
 *  stands until ack, like any other refusal of it (decision 7; D-3396). */
function intendedMove(v: DispatchNodeView): Intended | null {
  const r = v.row;
  if (r.requestedTag !== null) {
    return r.requestedKind !== null ? { kind: r.requestedKind, target: r.requestedTag, source: 'request' } : null;
  }
  if (autoPermits(v.auto, r.channel) && r.desiredTag !== null) return { kind: 'update', target: r.desiredTag, source: 'auto' };
  return null;
}

/** THE per-node predicate, shared with the routes (Task 6): the first refusal in this order, else null —
 *  halted; (update) stamp-unread, floor-unread — a floor never measured (W2 D-3213), not-newer — the target
 *  not strictly newer than the node's floor, W2's floorOf (D-3403); unknown-tag — for an update, no listed (bundleListed), unyanked
 *  releases row (spec §12's apply rule, D-3395); for a rollback, no releases row at all (yanked PERMITTED: rolling back
 *  to a yanked release is the point); refused-by-node (THIS node's refusals only, either kind,
 *  D-3394); no-detach-cap (every move rides `--detach`, the server's too);
 *  (rollback) no-rollback-cap; (auto) no-update-gate; and for a node reached over the link only (agentOps not
 *  NULL) agent-predates-update-op — the server's row, NULL by construction, is never checked for it
 *  (decision 11). The order is cheapest-and-most-general first: a halted fleet says so before any one node's
 *  capability does. */
export function moveRefusal(view: DispatchNodeView, move: { kind: RequestKind; target: string; source: 'request' | 'auto' }, releases: readonly EligibilityRow[], gate: FleetGate): DispatchRefusal | null {
  const row = view.row;
  if (gate.haltedBy.length > 0) return 'halted';
  const tagOk = isReleaseTag(move.target);
  const known = tagOk ? releases.find((r) => r.tag === move.target) : undefined;
  if (move.kind === 'update') {
    const cur = currentOf(row);
    if (cur.kind === 'unread') return 'stamp-unread';
    // W2 D-3213: a NULL floor never MEASURED (floorRead 'unmeasured') is not "no floor" — the resolver refuses it
    // before floorOf (`resolveOnChannel`), and so does this: a tag sent below a floor nobody read would be refused
    // by the node, and that failed row would halt the fleet (D-3403). D-3492
    if (row.highestVersion === null && row.floorRead === 'unmeasured') return 'floor-unread';
    // THE FLOOR (spec decision 8: a requested update "moves a node only to a strictly NEWER version than its
    // floor"; §10: the dispatcher "re-checks capabilities, direction and the floor"). W2's floorOf is the
    // resolver's own floor — the floor file's tag, or the running tag when that is higher (D-3202) or the file is
    // absent — so a versioned node is never sent a tag at or below what it runs, and a rolled-back node is never
    // sent one at or below its floor: its ccrc would refuse it (`_upd_floor_check`), and the `failed` row that
    // refusal leaves would halt every move in the fleet (D-3403). An unversioned node with
    // no floor has nothing to compare against: it is never "not newer" (spec §10). floorOf answers a tag or null.
    const floor = floorOf(row.highestVersion, row.currentVersion);
    if (tagOk && floor !== null && !isNewerTag(move.target, floor)) return 'not-newer';
    if (known === undefined || known.yanked || !known.bundleListed) return 'unknown-tag';
  } else if (known === undefined) {
    return 'unknown-tag';
  }
  if (view.refusedTags.has(move.target)) return 'refused-by-node';
  if (!row.caps.includes(DETACH_CAP)) return 'no-detach-cap';
  if (move.kind === 'rollback' && !row.caps.includes(ROLLBACK_CAP)) return 'no-rollback-cap';
  if (move.source === 'auto' && !row.caps.includes(UPDATE_GATE_CAP)) return 'no-update-gate';
  if (row.agentOps !== null && !row.agentOps.includes(UPDATE_OP)) return 'agent-predates-update-op';
  return null;
}

type Sentence = (row: DispatchRow, target: string, blocker: RefusalBlocker | null) => string;
/** One sentence per word; a Record over the type, so a word added to DISPATCH_REFUSALS without its sentence is a
 *  compile error. Each names the node's label and the tag, so a note read out of context still says whose. */
const REFUSAL_SENTENCE: Record<DispatchRefusal, Sentence> = {
  'unknown-tag': (r, t) =>
    `${t} is not a release ${r.label} can be moved to — an update needs a catalogue row listed with its provenance bundle and not yanked, a rollback a catalogue row`,
  'not-newer': (r, t) => {
    const floor = floorOf(r.highestVersion, r.currentVersion);
    return floor !== null && floor !== r.currentVersion
      ? `${t} is not newer than ${r.label}'s floor ${floor} (it runs ${r.currentVersion ?? 'an unversioned build'}) — pin a newer tag, or use rollback`
      : `${t} is not newer than ${r.label}'s ${r.currentVersion ?? 'version'} — moving a node down is a rollback`;
  },
  'refused-by-node': (r, t) =>
    `${r.label} refused ${t} on a provenance verdict — ack the node to clear the refusal`,
  'stamp-unread': (r, t) =>
    `${r.label}'s build stamp reads ${r.stampRead}, so its version is unknown — ${t} waits until the stamp reads`,
  'floor-unread': (r, t) =>
    `${r.label}'s floor has not been measured — ${t} waits until it is`,
  'no-detach-cap': (r, t) =>
    `${r.label}'s ccrc-caps has no ${DETACH_CAP} — its ccrc predates the one-tap, or it is macOS (decision 17); ${t} waits`,
  'no-update-gate': (r, t) =>
    `auto is on for ${r.label} but its ccrc-caps has no ${UPDATE_GATE_CAP}, so auto will not move it to ${t}; an operator request still can`,
  'no-rollback-cap': (r, t) =>
    `${r.label}'s ccrc-caps has no ${ROLLBACK_CAP} — its ccrc cannot roll back to ${t}`,
  'agent-predates-update-op': (r, t) =>
    `${r.label}'s agent does not advertise the ${UPDATE_OP} op — update its agent first; ${t} waits`,
  halted: (r, t, b) =>
    `a failed or reverted node${b === null ? '' : ` (${b.label})`} halts every move until it is acked — ${r.label} waits for ${t}`,
  'waiting-for-fleet': (r, t, b) =>
    b?.auto === true
      ? `${b.label}'s auto update to ${b.tag ?? 'a release'} has not landed — ${r.label} moves to ${t} after it does, or once that node's own auto is off`
      : `${b?.label ?? 'a fleet node'}'s request for ${b?.tag ?? 'a release'} is outstanding — ${r.label} moves to ${t} after it is settled or acked`,
};

/** `${refusal} — ${sentence}`. `blocker` names the halting row (halted) or the fleet row holding a server-role
 *  node back (waiting-for-fleet); every other word ignores it. Deterministic, so a refusal re-planned every run
 *  renders the same text and `noteDispatchRefusal` writes it once (Review Focus 5). */
export function dispatchRefusalDetail(refusal: DispatchRefusal, view: DispatchNodeView, target: string, blocker: RefusalBlocker | null = null): string {
  return `${refusal} — ${REFUSAL_SENTENCE[refusal](view.row, target, blocker)}`;
}

/** Busy AND (neither timestamp set — a lease nothing ever dated, bounded all the same — OR now − max(
 *  updateStartedAt, reportedUpdatedAt) > deadlineMs). Both columns are epoch ms (W2's validator converted the
 *  report's seconds once). A settled row never expires. */
export function deadlineExpired(row: Pick<DispatchRow, 'updateState' | 'updateStartedAt' | 'reportedUpdatedAt'>, now: number, deadlineMs: number): boolean {
  if (isSettled(row.updateState)) return false;
  const marks = [row.updateStartedAt, row.reportedUpdatedAt].filter((t): t is number => t !== null);
  if (marks.length === 0) return true;
  return now - Math.max(...marks) > deadlineMs;
}

function moveDetail(row: DispatchRow, m: Intended): string {
  const cur = currentOf(row);
  if (m.kind === 'update' && cur.kind === 'unversioned') return UNVERSIONED_DETAIL;
  const from = cur.kind === 'versioned' ? cur.tag : cur.kind === 'unversioned' ? 'an unversioned build' : 'an unread stamp';
  return `${m.source === 'auto' ? 'auto' : 'requested'} ${m.kind} from ${from} to ${m.target}`;
}

/** Pure. Considered = live (the store's `nodes()` returns no other), reachable, settled rows with a request, or
 *  with auto permitting and a desiredTag. For each, in compareDispatchOrder: a request an IDLE row already runs
 *  is `met`; otherwise moveRefusal decides, and a node it clears whose rank is not fleet's (1 or 2) is deferred
 *  `waiting-for-fleet` while any live fleet-role row holds a request — whatever that row's state or
 *  reachability (D-3381) — and, when its own move is AUTO, while any live fleet-role row
 *  is one auto has not converged: auto permits it and it has a desiredTag (a converged row's is NULL), whatever
 *  its state, reachability or refusal (D-3402; a request is never held by it). The
 *  move is the first cleared node, unless a lease is held (one node at a time, fleet-wide); a cleared node after
 *  it waits its turn un-noted. */
export function planDispatch(input: DispatchInput): DispatchPlan {
  const gate = fleetGate(input.nodes.map((v) => v.row));
  const ordered = [...input.nodes].sort((a, b) => compareDispatchOrder(a.row, b.row));
  const fleetAsk = ordered.find((v) => dispatchRank(v.row.role) === 0 && v.row.requestedTag !== null) ?? null;
  const fleetAuto = ordered.find((v) =>
    dispatchRank(v.row.role) === 0 && autoPermits(v.auto, v.row.channel) && v.row.desiredTag !== null) ?? null;
  const haltedRow = gate.haltedBy.length > 0 ? ordered.find((v) => v.row.nodeId === gate.haltedBy[0]) ?? null : null;
  const met: MetRequest[] = [];
  const refusals: PlannedRefusal[] = [];
  let move: DispatchMove | null = null;
  for (const v of ordered) {
    const row = v.row;
    if (!isSettled(row.updateState) || !row.reachable) continue;
    const m = intendedMove(v);
    if (m === null) continue;
    if (m.source === 'request' && row.updateState === 'idle' && row.stampRead === 'ok' && row.currentVersion === m.target) {
      met.push({ nodeId: row.nodeId, tag: m.target });
      continue;
    }
    let refusal = moveRefusal(v, m, input.releases, gate);
    let blocker: RefusalBlocker | null = refusal === 'halted' && haltedRow !== null ? { label: haltedRow.row.label, tag: null } : null;
    if (refusal === null && dispatchRank(row.role) !== 0) {
      if (fleetAsk !== null) {
        refusal = 'waiting-for-fleet';
        blocker = { label: fleetAsk.row.label, tag: fleetAsk.row.requestedTag };
      } else if (m.source === 'auto' && fleetAuto !== null) {
        refusal = 'waiting-for-fleet';
        blocker = { label: fleetAuto.row.label, tag: fleetAuto.row.desiredTag, auto: true };
      }
    }
    if (refusal !== null) {
      if (row.updateState === 'idle') {
        refusals.push({ nodeId: row.nodeId, refusal, detail: dispatchRefusalDetail(refusal, v, m.target, blocker) });
      }
      continue;
    }
    if (move === null && gate.leaseHeldBy === null) {
      move = { nodeId: row.nodeId, kind: m.kind, target: m.target, source: m.source, viaLink: row.agentOps !== null, detail: moveDetail(row, m) };
    }
  }
  return { gate, move, refusals, met };
}
