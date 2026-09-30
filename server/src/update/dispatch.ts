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
  PROVENANCE_DETAIL_PREFIX, SETTLED_UPDATE_STATES, UNIX_SECONDS_MAX, UPDATE_GATE_CAP, compareDispatchOrder, dispatchRank, isReleaseTag, isUpdatePhase,
  rollbackTargetRefusal,
  type AutoMode, type DispatchRefusal, type NodeRole, type ProvenanceState, type RequestKind, type StampRead, type TagFileRead, type UpdateChannel,
  type UpdatePhase, type UpdateState,
} from '../../../shared/api.js';
import {
  UPDATE_OP, UPDATE_OP_DETAIL_MAX, firstStderrLine, isUpdateOpError, type UpdateOpError,
} from '../../../shared/agent-protocol.js';
import { isNewerTag } from '../../../shared/semver.js';
import { floorOf, type EligibilityRow } from './resolve.js';

/** Wave 4's other two ccrc-caps words (`_inst_caps`; `detach` is Linux-only, decision 17). UPDATE_GATE_CAP is
 *  the third's one spelling (shared/api.ts, D-3305); these two have no reader outside this file. */
export const DETACH_CAP = 'detach';
export const ROLLBACK_CAP = 'rollback';
/** Spec §10, verbatim: the lease detail for an update to a node whose stamp reads but names no version. */
export const UNVERSIONED_DETAIL = 'unversioned box — any eligible release is newer';
/** The word W2's `sweepPlanFor` tests before it records a node's refusal of a release: a `failed` row whose
 *  detail begins with it is a verdict on the RELEASE, and does not halt (D-3378). Declared ONCE in `shared/api.ts`
 *  (D-3412: the store's heir guard reads the same word), re-exported here for the callers that import it from L1. */
export { PROVENANCE_DETAIL_PREFIX };
/** Spec §10's `failed: deadline` — the detail `runDispatch` (Task 5) releases an expired lease with. */
export const DEADLINE_DETAIL = 'deadline';
/** D-3407 — `reportedUpdatedAt` is the NODE's clock (bounded only by UNIX_SECONDS_MAX) and `dispatchNode` never
 *  resets it, so a node whose clock runs ahead, or a same-user writer, can date a report far enough in the
 *  future that the later-of rule in `deadlineExpired` never fires, holding the fleet's one lease forever with no
 *  operator door (`ackNode` refuses a busy row). A busy row is expired at this multiple of `deadlineMs` measured
 *  from `updateStartedAt` ALONE once it is reached, whatever the report says; the ordinary later-of rule still
 *  governs below the cap. */
export const UPDATE_DEADLINE_HARD_CAP_FACTOR = 4;

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
  channel: UpdateChannel | null; desiredTag: string | null; provenance: ProvenanceState;
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

/** THE refusal source: this node's own refused tags (D-3394) — `moveRefusal`'s `refused-by-node` and, D-3409, the
 *  fleet-hold's exclusion of a row that refused its standing request both ask it. */
const refusedByNode = (v: DispatchNodeView, tag: string): boolean => v.refusedTags.has(tag);

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

/** Wave 8 item C: THE lookup of a move target's catalogue row — moveRefusal's and the fleet holds' — so the two can
 *  never read different rows. A non-tag target has no row. */
const releaseRowFor = (releases: readonly EligibilityRow[], tag: string): EligibilityRow | undefined =>
  isReleaseTag(tag) ? releases.find((r) => r.tag === tag) : undefined;

/** THE per-node predicate, shared with the routes (Task 6): the first refusal in this order, else null —
 *  halted; (update) stamp-unread, floor-unread — a floor never measured (W2 D-3213), not-newer — the target
 *  not strictly newer than the node's floor, W2's floorOf (D-3403); unknown-tag — for an update, no listed (bundleListed), unyanked
 *  releases row (spec §12's apply rule, D-3395); for a rollback, no releases row at all (yanked PERMITTED: rolling back
 *  to a yanked release is the point); and — wave 8 item C — a rollback the node is known to refuse, `rollbackTargetRefusal`
 *  (L0); refused-by-node (THIS node's refusals only, either kind,
 *  D-3394); no-detach-cap (every move rides `--detach`, the server's too);
 *  (rollback) no-rollback-cap; (auto) no-update-gate; and for a node reached over the link only (agentOps not
 *  NULL) agent-predates-update-op — the server's row, NULL by construction, is never checked for it
 *  (decision 11). The order is cheapest-and-most-general first: a halted fleet says so before any one node's
 *  capability does. */
export function moveRefusal(view: DispatchNodeView, move: { kind: RequestKind; target: string; source: 'request' | 'auto' }, releases: readonly EligibilityRow[], gate: FleetGate): DispatchRefusal | null {
  const row = view.row;
  if (gate.haltedBy.length > 0) return 'halted';
  const tagOk = isReleaseTag(move.target);
  const known = releaseRowFor(releases, move.target);
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
  } else {
    // Wave 8 item C: a rollback the node is KNOWN to refuse is refused here, before any lease or spawn, with
    // L0's predicate (the PWA calls the same one). A non-tag target leaves `known` undefined: 'unknown-tag', as
    // before. Before refused-by-node, as unknown-tag already was: the target's own fact comes first.
    const rb = rollbackTargetRefusal(known, row.provenance);
    if (rb !== null) return rb;
  }
  if (refusedByNode(view, move.target)) return 'refused-by-node';
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
  'no-bundle': (r, t) =>
    `the catalogue lists no provenance bundle for ${t} and ${r.label}'s install is verified, so the one-tap is not sent — its ccrc refuses to download ${t} without --allow-unsigned, which a one-tap never passes; on that box, ccrc rollback --to ${t} flips to a kept copy if it keeps one, and otherwise ccrc update --to ${t} --downgrade --allow-unsigned installs it; or Refresh if a bundle was published since the last poll, or pick a newer release`,
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
 *  updateStartedAt, reportedUpdatedAt) > deadlineMs) OR — D-3407, a hard cap `reportedUpdatedAt` cannot push out —
 *  now − updateStartedAt ≥ UPDATE_DEADLINE_HARD_CAP_FACTOR × deadlineMs. Both columns are epoch ms (W2's
 *  validator converted the report's seconds once). A settled row never expires. */
export function deadlineExpired(row: Pick<DispatchRow, 'updateState' | 'updateStartedAt' | 'reportedUpdatedAt'>, now: number, deadlineMs: number): boolean {
  if (isSettled(row.updateState)) return false;
  if (row.updateStartedAt !== null && now - row.updateStartedAt >= UPDATE_DEADLINE_HARD_CAP_FACTOR * deadlineMs) return true;
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
 *  reachability (D-3381), unless it is a request that row has itself refused (D-3409) — and, when its own move is AUTO, while any live fleet-role row
 *  is one auto has not converged: auto permits it and it has a desiredTag (a converged row's is NULL), whatever
 *  its state or reachability, unless the row has refused that tag (D-3402, D-3409; a request is never held by it), or —
 *  wave 8 item C, D-3588 — it is a standing rollback request `rollbackTargetRefusal` already refuses: never sent, so
 *  never a refusedByNode record, so excluded by name from both holds. The
 *  move is the first cleared node, unless a lease is held (one node at a time, fleet-wide); a cleared node after
 *  it waits its turn un-noted. */
export function planDispatch(input: DispatchInput): DispatchPlan {
  const gate = fleetGate(input.nodes.map((v) => v.row));
  const ordered = [...input.nodes].sort((a, b) => compareDispatchOrder(a.row, b.row));
  // Wave 8 item C: a fleet row whose standing request is a rollback the server refuses before any spawn
  // (rollbackTargetRefusal, L0). It is never sent, so it never becomes a refusedByNode record; and while it stands it
  // outranks that row's auto (intendedMove), so that auto cannot land either. Neither hold may wait on it — without
  // this, every server-role move would wait for an ack. ONE test, asked by both holds.
  const knownRefusedAsk = (v: DispatchNodeView): boolean =>
    v.row.requestedTag !== null && v.row.requestedKind === 'rollback'
    && rollbackTargetRefusal(releaseRowFor(input.releases, v.row.requestedTag), v.row.provenance) !== null;
  // D-3409: a fleet row whose standing request (or auto desiredTag) is one THIS node has refused on a provenance
  // verdict can never move it (refused-by-node, D-3396) — it is not an outstanding move, so it holds nothing;
  // else D-3378's non-halting refusal would hold every server move until an ack.
  const fleetAsk = ordered.find((v) =>
    dispatchRank(v.row.role) === 0 && v.row.requestedTag !== null && !refusedByNode(v, v.row.requestedTag)
    && !knownRefusedAsk(v)) ?? null;
  const fleetAuto = ordered.find((v) =>
    dispatchRank(v.row.role) === 0 && autoPermits(v.auto, v.row.channel) && v.row.desiredTag !== null
    && !refusedByNode(v, v.row.desiredTag) && !knownRefusedAsk(v)) ?? null;
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

// ── the op's answer (wave 5, Task 5) ─────────────────────────────────────────

/** Spec §10, verbatim: the words a HALTING `failed` carries when an agent that ADVERTISES the op still answered
 *  `bad-request` — it has the op and refused this frame, which only a server-side bug produces. */
export const AGENT_REJECTED_DETAIL = 'agent rejected the update op';
const ACCEPTED_DETAIL = 'accepted — the node queued a detached run';
const SKEW_DETAIL =
  `agent-predates-update-op — the agent answered bad-request and does not advertise the ${UPDATE_OP} op; the request stands`;

/** What came back from ONE op: the agent's reply over the link, or the server-role spawn's exit. `refused` is a
 *  word the NODE said (an AgentOpError, or a non-zero local exit as `spawn-failed`); `transport` is the link or
 *  the spawn failing to answer at all — never a word the node said. */
export type OpAnswer =
  | { kind: 'accepted'; detail?: string }
  | { kind: 'refused'; err: string; detail: string | null }
  | { kind: 'transport'; why: 'disconnected' | 'timeout' | 'aborted' | 'other'; message: string; reached: 'never' | 'maybe' };

/** What the act does to the lease it holds. `hold` settles nothing: only the inventory sweep (or a met request)
 *  settles a lease, so the row reads `pending` until then (D-3382) — the dispatcher may NOTE the hold's words on
 *  the lease (D-3413's arms B/D; D-3555's link-failure hold). */
export type AnswerAction =
  | { kind: 'hold'; detail: string }
  | { kind: 'release'; to: 'idle' | 'failed'; detail: string };

/** A node-supplied word or detail, as ONE printable line of at most UPDATE_OP_DETAIL_MAX characters — the row's
 *  `updateDetail` is rendered on the PWA and must not carry a second line, a control byte or a megabyte. */
const said = (text: string | null, none: string): string => (text === null ? none : firstStderrLine(text));

/**
 * THE ANSWER MAPPING (spec §10). `advertised` is whether the LIVE `FleetState.agentOps` names the op when the
 * answer arrives (always `true` for the server-role spawn): an agent that advertises the op and still answers
 * `bad-request` HALTS, one that does not is version skew and waits. `busy`, `not-queued` (D-3413: the bound's arm A)
 * and a transport failure that NEVER reached the agent release
 * the lease `idle` with the request standing (decision 7: a refusal never consumes it); one that MAY have reached
 * it HOLDS instead, exactly like `accepted` (D-3555) — only a report or the deadline settles it. `bad-tag`, `bad-kind`,
 * `spawn-failed` and any word this build cannot name release it `failed`, which halts until `ack`.
 * Exhaustive over `UpdateOpError`: a word added to UPDATE_OP_ERRORS and not here is a compile error at the
 * `never` below (D-3370).
 */
export function classifyOpAnswer(a: OpAnswer, advertised: boolean): AnswerAction {
  // An `accepted` that carries a detail is the bound's arm B or D (D-3400 amended, D-3413): the parent was killed at the
  // bound and the node HOLDS the lease, saying what it measured. Read through `said()` like every node-supplied text. A
  // plain `accepted` (the parent exited 0, or an agent that omits the field) keeps ACCEPTED_DETAIL.
  if (a.kind === 'accepted') {
    const words = said(a.detail ?? null, 'no message');
    return { kind: 'hold', detail: words === 'no message' ? ACCEPTED_DETAIL : words };
  }
  if (a.kind === 'transport') {
    // D-3555: a failure after the op was handed to the link may follow a spawn, so the lease HOLDS
    // like `accepted`; only a failure proven before the hand-off releases, and the request stands.
    if (a.reached === 'maybe') return { kind: 'hold', detail: linkFailedHoldDetail(a.why, a.message) };
    const what = a.why === 'other' ? said(a.message, 'no message') : 'the op never reached the fleet link';
    return { kind: 'release', to: 'idle', detail: `${a.why} — ${what}; the request stands` };
  }
  if (a.err === 'bad-request') {
    return advertised
      ? { kind: 'release', to: 'failed', detail: AGENT_REJECTED_DETAIL }
      : { kind: 'release', to: 'idle', detail: SKEW_DETAIL };
  }
  if (!isUpdateOpError(a.err)) return { kind: 'release', to: 'failed', detail: `agent answered ${said(a.err, 'no word')}` };
  const err: UpdateOpError = a.err;
  switch (err) {
    case 'busy': return { kind: 'release', to: 'idle', detail: `busy — ${said(a.detail, 'the node gave no detail')}` };
    case 'bad-tag':
    case 'bad-kind': return { kind: 'release', to: 'failed', detail: `agent refused the op: ${err}` };
    case 'spawn-failed': return { kind: 'release', to: 'failed', detail: `spawn-failed — ${said(a.detail, 'no message')}` };
    // D-3413 (arm A of the bound): the parent was stopped before it queued anything, so nothing started and nobody else is
    // updating. Not `busy` (another actor) and not `spawn-failed` (a fault, which halts): idle, the request standing.
    case 'not-queued': return { kind: 'release', to: 'idle', detail: `not-queued — ${said(a.detail, 'the parent was stopped before it queued anything')}` };
    default: {
      const unhandled: never = err;
      return unhandled;
    }
  }
}

// ── the deadline's verdict (D-3405 amended, fix round 1 item 4 / review 175 F6) ─────────────────────────────────

/** What a `~/.ccrc/update.json` text says about WHO wrote it and what it says, read by name from any one-line JSON
 *  object, or `null` when the text is not one. `updatedAt` is converted to epoch ms exactly as W2's `reportFrom`
 *  reads it (a positive safe integer of unix SECONDS within UNIX_SECONDS_MAX, else `null`, never divided) and `from`
 *  is the one field W2's reader drops. THE one parse of these five: L1 owns it (rather than L0's update block)
 *  because it needs nothing from L0 but a guard and a bound this file already imports, and a second reader of
 *  `from` in `shared/` would put the watchdog's word where the PWA bundles it. */
export interface ReportOrigin {
  from: string | null; phase: UpdatePhase; target: string | null; updatedAt: number | null; detail: string | null;
}
export function parseReportOrigin(text: string): ReportOrigin | null {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return null; }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  const at = d.updatedAt;
  return {
    from: typeof d.from === 'string' ? d.from : null,
    phase: isUpdatePhase(d.phase) ? d.phase : 'unknown',
    target: isReleaseTag(d.target) ? d.target : null,
    updatedAt: typeof at === 'number' && Number.isSafeInteger(at) && at > 0 && at <= UNIX_SECONDS_MAX ? at * 1000 : null,
    detail: typeof d.detail === 'string' ? d.detail : null,
  };
}

/** The `updateDetail` an expired lease is released `failed` with: `DEADLINE_DETAIL`, plus — for the SERVER-ROLE row only
 *  (`agentOps` NULL: the watchdog runs on `server`/`both` boxes and nowhere else) — what THIS box's own report says
 *  when the watchdog wrote it after the lease began. `own` is that box's `update.json`, parsed.
 *
 *  Comparing the report's `updatedAt` with the lease's `updateStartedAt` is sound HERE and only here: both are read
 *  off the SAME box's clock (the report is written by that box's `date +%s`, the lease by this server process), so no
 *  two clocks are ordered against each other — which is what D-3405 refuses for a fleet node. The report's seconds are
 *  truncated, so a revert inside the acquire's own second reads as not later and keeps the plain word: the safe side.
 *
 *  This is a WORDING of a verdict the deadline already reached; it settles nothing. A `--from watchdog` run never
 *  writes `reverted`: a successful revert ends `done <prev>` and a failed one ends `failed` (through
 *  `_upd_rollback_no_restore`), so a report-driven settle would record a revert as a success. The identity clause of
 *  `leaseActionFor` marks both `stale-report` (their target is the previous tag, not the lease's), and the row waits for
 *  the deadline, which this sentence then explains. Any other report — another writer's, an earlier run's, a phase the
 *  watchdog does not end on, a target that is not a tag — keeps the plain word. The whole detail stays within
 *  UPDATE_OP_DETAIL_MAX; it is the node's own words that are cut. */
export function deadlineDetail(row: Pick<DispatchRow, 'agentOps' | 'updateStartedAt'>, own: ReportOrigin | null): string {
  if (row.agentOps !== null || own === null || row.updateStartedAt === null) return DEADLINE_DETAIL;
  if (own.from !== 'watchdog' || own.target === null) return DEADLINE_DETAIL;
  if (own.updatedAt === null || own.updatedAt <= row.updateStartedAt) return DEADLINE_DETAIL;
  if (own.phase === 'done') return `${DEADLINE_DETAIL} — the watchdog reverted this box to ${own.target}`.slice(0, UPDATE_OP_DETAIL_MAX);
  if (own.phase !== 'failed') return DEADLINE_DETAIL;
  const head = `${DEADLINE_DETAIL} — the watchdog's rollback to ${own.target} failed: `;
  return (head + said(own.detail, 'no message').slice(0, Math.max(0, UPDATE_OP_DETAIL_MAX - head.length))).slice(0, UPDATE_OP_DETAIL_MAX);
}

// ── a fleet-link failure after the hand-off (D-3555, residue R1) ────────────────────────────────────────────────

/** D-3555: the words a lease HELD after the fleet link failed mid-op begins with. This server writes
 *  them (`converge.ts`, through `noteLeaseDetail`) and `linkFailedDeadlineDetail` reads them back. A node could spell
 *  them in an arm-B/D detail; that changes only the deadline's WORDS, never its verdict. */
export const LINK_FAILED_HOLD_PREFIX = 'link failed mid-op';

export function linkFailedHoldDetail(why: 'disconnected' | 'timeout' | 'aborted' | 'other', message: string): string {
  // Fix round 1 (review 178 O1): the three named post-send arms are measured AFTER `ws.send` returned — the op
  // DID reach the fleet link, full stop. `other` covers a non-`Error` rejection and any error `request()` does not
  // name, so it carries no such proof: it says only that the op MAY have reached the link.
  const reached = why === 'other' ? 'may have reached' : 'reached';
  const headPrefix = `${LINK_FAILED_HOLD_PREFIX} (`;
  const tail =
    `) — the op ${reached} the fleet link and no answer came back, so the node may have started the run; ` +
    `the lease holds until its report or the deadline`;
  if (why !== 'other') return `${headPrefix}${why}${tail}`.slice(0, UPDATE_OP_DETAIL_MAX);
  // Fix round 1 (review 178, item 3): cap the MESSAGE part alone, computed from the fixed parts' own lengths, so
  // the whole sentence always fits UPDATE_OP_DETAIL_MAX and always ENDS with the tail above — a `.slice` over the
  // whole string (the old shape) could cut the tail off a long `other` message instead.
  const budget = Math.max(0, UPDATE_OP_DETAIL_MAX - headPrefix.length - 'other: '.length - tail.length);
  return `${headPrefix}other: ${said(message, 'no message').slice(0, budget)}${tail}`;
}

/** The columns `linkFailedDeadlineDetail` reads. `NodeRow` (coord/store.ts) satisfies it structurally. */
export interface LinkHoldRow { updateDetail: string | null; updateTarget: string | null; reportedTarget: string | null }

/** The failed-deadline words for a lease held after a link failure, or `null` (the caller then uses `deadlineDetail`).
 *  Only when the row's detail begins `${LINK_FAILED_HOLD_PREFIX} (` and it names a tag. The words always say the link
 *  failed mid-op; they say "the row's last report does not name <tag>" only when that is true (fix round 1, review
 *  178 F1) — the row's LAST STORED report is all `reportedTarget` can prove, and the sentence must not claim more
 *  history than that: a later writer's report can replace this run's own, and D-3214's `stamp-unmeasured` override
 *  (`inventory.ts`) can write a PREVIOUS report back over a genuine one, so "no run of <tag> was reported" could be
 *  false in either case. A same-tag report — which may be a previous run's (D-3405's accepted hole; no column keeps
 *  the report as it stood at the acquire) — gets the qualified sentence instead. */
export function linkFailedDeadlineDetail(row: LinkHoldRow): string | null {
  if (row.updateDetail?.startsWith(`${LINK_FAILED_HOLD_PREFIX} (`) !== true || row.updateTarget === null) return null;
  const target = row.updateTarget;
  const text = row.reportedTarget !== target
    ? `${DEADLINE_DETAIL} — the fleet link failed mid-op; the row's last report does not name ${target}`
    : `${DEADLINE_DETAIL} — the fleet link failed mid-op; the row's last report names ${target}, which may be an earlier run's`;
  return text.slice(0, UPDATE_OP_DETAIL_MAX);
}

// ── the answer follows the lease, not the node id (D-3412 amended, residue R5) ───────────────────────────────────

/** R5 (review 176 F1; D-3412 amended): the LIVE row that holds the lease a dispatch run acquired — the same `label`, the
 *  same `updateStartedAt` (the acquire's `now`, which `handOffLease` copies onto a revived heir), still busy. A revive
 *  during the op hands the lease to the heir, so the heir is found here and the retired donor (not live) is not. `null`
 *  unless EXACTLY one row matches — none (a report or the deadline settled it first, or R2's no-revive supersede dropped
 *  it) or two (a state the one-lease invariant forbids) — and the caller then writes to the id it acquired, whose own
 *  guards name what happened. `rows` are `nodes()`'s: live rows only. */
export function leaseHolder(
  rows: readonly Pick<DispatchRow, 'nodeId' | 'label' | 'updateState' | 'updateStartedAt'>[], label: string, startedAt: number,
): string | null {
  const held = rows.filter((r) => r.label === label && r.updateStartedAt === startedAt && !isSettled(r.updateState));
  return held.length === 1 ? held[0]!.nodeId : null;
}
