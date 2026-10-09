// Box-token rotation policy, ring L1: pure decisions over L0 words and plain
// data. It imports nothing but `shared/` (CLAUDE.md "Rings"): no `fs`, no
// Fastify, no clock. The driver (`token/driver.ts`, L4) and the claim door
// (`token/door.ts`, L3) call these and act on the answer; neither decides.
//
// Spec: docs/superpowers/specs/2026-10-07-box-token-lifecycle-design.html,
// §5 (one rotation), §5.1 (timings), §6 (failures), §9.2 (the gate), 4.2.1
// (boot recovery) and 4.6 (the claim door).
import type { NodeOs, NodeRole, UpdatePhase, UpdateState } from '../../../shared/api.js';
import { BUSY_UPDATE_STATES, IN_FLIGHT_UPDATE_PHASES } from '../../../shared/api.js';
import {
  CLAIM_CODE_TTL_MS, TOKEN_SYNC_OP, isTokenVerbMissing,
  type TokenSyncOpError, type TokenTransport,
} from '../../../shared/agent-protocol.js';
import type {
  BoxTokenPhase, GenerationRead, OwedReason, TokenFileProblem, TokenHold, TokenOrigin,
} from '../../../shared/box-token.js';

// ── timings (spec §5.1) ──────────────────────────────────────────────────────
export const GRACE_MS = 5 * 60_000;
export const GRACE_HARD_MS = 60 * 60_000;
export const CONFIRM_DEADLINE_MS = 5 * 60_000;
export const DRIVER_TICK_MS = 60_000;
export const BACKOFF_MIN_MS = 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
export const HOLD_REPROBE_MS = 60 * 60_000;
export const FAILURES_FOR_BANNER = 3;
/** Handed-out values at which the gate holds `pending-cap` (spec §5.1). */
export const MAX_PENDING = 2;
/** Never more than this many pending values (D-4413): the third slot exists only for the cap's exit, a forward
 *  rotation staged while both cap values are past `confirmBy`. `BoxTokenHolder` has this many pending slots and
 *  `isBoxTokenState` refuses a longer list. */
export const PENDING_HARD_CAP = 3;
export const CLAIM_MISS_BUDGET = 30;
export const CLAIM_MISS_WINDOW_MS = 60_000;
export const CLAIM_ALERT_EVERY_MS = 60_000;
export const BURNED_CODES_KEPT = 8;
export const BURNED_CODE_KEEP_MS = 10 * 60_000;
export const ROTATE_NOW_MIN_INTERVAL_MS = 60_000;
/** The driver's run-time re-read of the server's token files, at the readiness sweep's cadence (spec 4.2; watch.ts's
 *  READINESS_SWEEP_MS is 600 s, which this ring cannot import). Added at plan assembly. */
export const TOKEN_FILE_REREAD_MS = 10 * 60_000;
/** A rotation owed and not completed this long raises the console's stall alert (BoxTokenView.stalled): wave 1's
 *  doctor reports the state as SKIP, which no exit code counts. Added at plan assembly. */
export const STALL_ALERT_MS = 24 * 60 * 60_000;

// ── persisted state (`<dir>/box-token.json`, 0600, no secret) ────────────────
/** fstat of the temp file before its rename: the rename keeps (dev, ino). */
export interface WriteRecord { dev: number; ino: number; writtenAtMs: number }
export interface PendingGen {
  id: string; seq: number; stagedAt: number;
  handedOutAt: number | null; confirmBy: number | null;   // set together at hand-out
  write: WriteRecord;
}
export interface BoxTokenState {
  v: 1;
  origin: TokenOrigin;
  rotationOwed: boolean; owedWhy: OwedReason | null;
  current: { id: string | null; seq: number; since: number; write: WriteRecord | null };
  pending: PendingGen[];
  previous: { id: string | null; seq: number; graceUntil: number; hardUntil: number;
              currentPresented: boolean; write: WriteRecord } | null;
  promoting: { id: string } | null;
  recovering: { source: 'pending' | 'previous' } | null;
  fleetConfirmed: string | null;
  nextSeq: number;
  lastRotationAt: number | null;
  failures: number; lastFailure: string | null;
  hold: TokenHold | null; holdNode: string | null;
  lastSync: { at: number; word: string; transport: TokenTransport | 'unmeasured' } | null;
  counters: { previousPresented: number; retiredPresented: number };
  retiredRefusedAt: number | null;
  mintFailedAt: number | null;
  lastBootRecovery: { at: number; source: 'pending' | 'previous' } | null;
  /** The driver's last run-time re-read finding (A9). Optional: absent in every state written before it. */
  fileProblem?: { at: number; file: 'current' | 'pending' | 'previous'; word: TokenFileProblem } | null;
  /** D-4410: the sha256 hex of every value retired but not yet appended to `box-token-retired.json`. Written with the
   *  state change that retires the value, BEFORE it leaves the accept set, and removed only once the append has landed:
   *  the one exception to "a digest is persisted only in the retired file". Optional: absent reads as none. */
  retiring?: RetiringDigest[];
}
/** One retired value's digest awaiting its append (D-4410). Never a value; never printed. */
export interface RetiringDigest { sha256: string; at: number }

/** A fresh state for a value this server just minted (boot, or the driver's mint retry). Pending and previous
 *  entries of a prior state are kept: boot re-reads their files, and a value the fleet may hold is not dropped.
 *  `id` is a fresh generation id (`mintGenerationId()`): a minted value the fleet has never confirmed then reads
 *  `behind` against an absent or different fleet generation, so the fleet box is handed a value (plan assembly). */
export function mintedState(now: number, write: WriteRecord, prior: BoxTokenState | null, owed: OwedReason | null, id: string): BoxTokenState {
  const seq = prior?.nextSeq ?? 1;
  return {
    v: 1, origin: 'minted', rotationOwed: owed !== null, owedWhy: owed,
    current: { id, seq, since: now, write },
    pending: prior?.pending ?? [], previous: prior?.previous ?? null, promoting: null, recovering: null,
    fleetConfirmed: null, nextSeq: seq + 1, lastRotationAt: prior?.lastRotationAt ?? null,
    failures: 0, lastFailure: null, hold: null, holdNode: null, lastSync: prior?.lastSync ?? null,
    counters: prior?.counters ?? { previousPresented: 0, retiredPresented: 0 },
    retiredRefusedAt: prior?.retiredRefusedAt ?? null, mintFailedAt: null,
    lastBootRecovery: prior?.lastBootRecovery ?? null,
    ...(prior?.retiring ? { retiring: prior.retiring } : {}),   // D-4410: a digest awaiting its append survives a re-mint
  };
}

/** The hand-made value: origin adopted, the first rotation owed (spec 4.2 step 6). */
export function adoptedState(now: number, prior: BoxTokenState | null): BoxTokenState {
  const seq = prior?.nextSeq ?? 1;
  return {
    v: 1, origin: 'adopted', rotationOwed: true, owedWhy: 'adopted',
    current: { id: null, seq, since: now, write: null },
    pending: prior?.pending ?? [], previous: prior?.previous ?? null, promoting: null, recovering: null,
    fleetConfirmed: null, nextSeq: seq + 1, lastRotationAt: prior?.lastRotationAt ?? null,
    failures: 0, lastFailure: null, hold: null, holdNode: null, lastSync: prior?.lastSync ?? null,
    counters: prior?.counters ?? { previousPresented: 0, retiredPresented: 0 },
    retiredRefusedAt: prior?.retiredRefusedAt ?? null, mintFailedAt: null,
    lastBootRecovery: prior?.lastBootRecovery ?? null,
    ...(prior?.retiring ? { retiring: prior.retiring } : {}),   // D-4410: a digest awaiting its append survives a re-mint
  };
}

/** Owe a forward rotation without clearing an earlier, still-standing reason. */
export function owe(s: BoxTokenState, why: OwedReason): BoxTokenState {
  return s.rotationOwed ? s : { ...s, rotationOwed: true, owedWhy: why };
}

// ── D-4410: a retired value's record is never lost ──────────────────────────
export const retiringDigests = (s: BoxTokenState): string[] => (s.retiring ?? []).map((e) => e.sha256);

/** The retiring record for `sha256`, added once (the first stamp is kept). The caller persists this BEFORE the value
 *  leaves the accept set. */
export function retiringRecorded(s: BoxTokenState, sha256: string, at: number): BoxTokenState {
  const have = s.retiring ?? [];
  return have.some((e) => e.sha256 === sha256) ? s : { ...s, retiring: [...have, { sha256, at }] };
}

/** The digests whose append to the retired file has landed leave the record; every other entry stays. */
export function retiringLanded(s: BoxTokenState, landed: readonly string[]): BoxTokenState {
  return { ...s, retiring: (s.retiring ?? []).filter((e) => !landed.includes(e.sha256)) };
}

/** Whether boot must NOT keep the `mail.token` it found. With the retired file unusable, boot cannot tell a retired
 *  value from any other, so only a current it can match to its own write record (`provedWrite`) stays; any other is
 *  foreign: boot mints a fresh current and owes a rotation (D-4410, F1). A usable retired list decides as before. */
export function foreignUnderUnusableRetired(i: { retiredUnusable: boolean; state: BoxTokenState | null; current: FileMetaLike }): boolean {
  if (!i.retiredUnusable) return false;
  return !(i.state !== null && provedWrite(i.current, i.state.current.write));
}

// ── D-4412: a retired value presented on a box-token lane owes one forward rotation, bounded ────────────────
/** `fresh` is the retired presentations the holder counted since the driver last asked. The state returned owes a
 *  rotation for the word `retired-presented`, or null when nothing new is owed: no new presentation; a rotation
 *  already owed, staged, handed out, promoting or running (`busy`); or one already owed for this word within
 *  `HOLD_REPROBE_MS`. The server cannot tell the fleet from the holder of the leaked value, so this bound is the
 *  protection: the gate, the one-rotation-at-a-time rule and the backoff then apply as to every rotation. */
export function oweForRetiredPresentation(i: { state: BoxTokenState; fresh: number; busy: boolean; lastOwedAt: number | null; now: number }): BoxTokenState | null {
  const s = i.state;
  if (i.fresh <= 0 || i.busy || s.rotationOwed || s.pending.length > 0 || s.promoting !== null) return null;
  if (i.lastOwedAt !== null && i.now - i.lastOwedAt < HOLD_REPROBE_MS) return null;
  return owe(s, 'retired-presented');
}

// ── the rotation gate (spec §9.2) ────────────────────────────────────────────
export interface GateNode {
  nodeId: string; nodeIdMeasured: boolean; label: string;
  role: NodeRole | null; reachable: boolean; os: NodeOs;
  caps: readonly string[]; agentOps: readonly string[] | null;
  updateState: UpdateState; reportedPhase: UpdatePhase | null;
}
export interface GateInput {
  fleetMode: 'local' | 'remote'; role: NodeRole; roleSource: 'recorded' | 'derived-absent' | 'derived-invalid';
  agentEnvMarksFleet: boolean;
  nodes: readonly GateNode[] | null;
  linkUp: boolean;
  learned: { hold: 'verb-missing' | 'stale-client' | 'agent-predates-op'; at: number } | null;
  lastReadyAt: number | null;
  handedOutUnconfirmed: number;
  /** D-4413: the cap's exit is open (`pendingExitOpen`): both cap values are past `confirmBy`. Computed by the caller
   *  from the state it holds; the gate only reads the answer. */
  pendingExit: boolean;
  mintFailed: boolean;
  now: number;
}
/** `nodeId` on the open remote verdict is the one measured fleet node a code is bound to (an addition to the
 *  contract's shape: without it the driver would have to pick the row itself, which is a decision). */
export type GateVerdict =
  | { open: true; mode: 'remote' | 'both-local'; nodeId: string | null }
  | { open: false; hold: TokenHold; node: string | null };

/** The cap word and the op word are one spelling: `ccrc`'s `CCRC_CAP_WORDS` gains `token-sync` (Part B). */
const TOKEN_SYNC_CAP = TOKEN_SYNC_OP;

const busy = (n: GateNode): boolean =>
  (BUSY_UPDATE_STATES as readonly string[]).includes(n.updateState)
  || (n.reportedPhase !== null && (IN_FLIGHT_UPDATE_PHASES as readonly string[]).includes(n.reportedPhase));

export function bothRoleWriterArmed(i: { role: NodeRole; roleSource: GateInput['roleSource']; fleetMode: 'local' | 'remote'; agentEnvMarksFleet: boolean }): boolean {
  return i.role === 'both' && i.roleSource === 'recorded' && i.fleetMode === 'local' && !i.agentEnvMarksFleet;
}

/** D-4413: the exit from `pending-cap`. True exactly when the cap's two handed-out values are both past `confirmBy`
 *  (strictly: a value at its deadline still waits, as `nextAction` reads it). Below the cap there is nothing to exit,
 *  and with the third slot in use there is no fourth. Staged (never handed out) values are not cap values. */
export function pendingExitOpen(pending: readonly PendingGen[], now: number): boolean {
  const handedOut = pending.filter((p) => p.handedOutAt !== null);
  return handedOut.length === MAX_PENDING && handedOut.every((p) => p.confirmBy !== null && now > p.confirmBy);
}

/** One verdict for every trigger: there is no trigger kind and no auto input (R1 as amended by R5). */
export function rotationGate(i: GateInput): GateVerdict {
  const held = (hold: TokenHold, node: string | null = null): GateVerdict => ({ open: false, hold, node });
  if (i.mintFailed) return held('mint-failed');
  if (i.nodes === null) return held('no-coord');
  const updating = i.nodes.find(busy);
  if (i.fleetMode === 'local') {
    if (!bothRoleWriterArmed(i)) return held('role-unrecorded');
    if (updating) return held('update-in-flight', updating.label);
    const own = i.nodes.find((n) => n.role === 'both');
    if (own && own.os !== 'unknown' && !own.caps.includes(TOKEN_SYNC_CAP)) return held('verb-missing', own.label);
    return { open: true, mode: 'both-local', nodeId: null };
  }
  if (updating) return held('update-in-flight', updating.label);
  const fleet = i.nodes.filter((n) => n.role === 'fleet' && n.reachable);
  if (fleet.length !== 1) return held('fleet-rows');
  const f = fleet[0];
  if (!f.nodeIdMeasured) return held('node-id-unmeasured', f.label);
  if (!i.linkUp) return held('link-down', f.label);
  if (f.agentOps === null || !f.agentOps.includes(TOKEN_SYNC_OP)) return held('agent-predates-op', f.label);
  if (f.os !== 'unknown' && !f.caps.includes(TOKEN_SYNC_CAP)) return held('verb-missing', f.label);
  if (i.learned !== null) {
    const reprobed = i.lastReadyAt !== null && i.lastReadyAt > i.learned.at;
    if (!reprobed && i.now - i.learned.at < HOLD_REPROBE_MS) return held(i.learned.hold, f.label);
  }
  // D-4413: a third pending slot ONLY while both cap values are past confirmBy; never more than three pending.
  if (i.handedOutUnconfirmed >= PENDING_HARD_CAP) return held('pending-cap', f.label);
  if (i.handedOutUnconfirmed >= MAX_PENDING && !i.pendingExit) return held('pending-cap', f.label);
  return { open: true, mode: 'remote', nodeId: f.nodeId };
}

// ── the claim door's decision (spec 4.6) ─────────────────────────────────────
export interface CodeSlot { digest: string; generation: string; nodeId: string; expiresAt: number }
export interface BurnedCode { digest: string; generation: string; at: number }
export interface ClaimDoorState { live: readonly CodeSlot[]; burned: readonly BurnedCode[]; misses: { windowStart: number; count: number } }
export type ClaimMatch = { kind: 'malformed' } | { kind: 'live'; index: number } | { kind: 'burned'; index: number } | { kind: 'none' };
export type ClaimReply =
  | { status: 200; error: null; generation: string }
  | { status: 400 | 404 | 429; error: 'bad-request' | 'no-claim' | 'rate-limited'; generation: null }
  | { status: 403 | 410; error: 'wrong-node' | 'code-expired' | 'code-used'; generation: string };
export type ClaimAlert = { kind: 'expired' | 'wrong-node' | 'replay'; generation: string } | { kind: 'misses'; count: number } | null;

/** A code's expiry from its issue time; the door spells TTL nowhere else. */
export function codeExpiresAt(issuedAt: number): number { return issuedAt + CLAIM_CODE_TTL_MS; }

export function keepBurned(burned: readonly BurnedCode[], now: number): BurnedCode[] {
  return burned.filter((b) => now - b.at < BURNED_CODE_KEEP_MS).slice(-BURNED_CODES_KEPT);
}

export function claimVerdict(state: ClaimDoorState, match: ClaimMatch, nodeId: string, now: number):
  { reply: ClaimReply; next: ClaimDoorState; alert: ClaimAlert } {
  if (match.kind === 'live') {
    const slot = state.live[match.index];
    const live = state.live.filter((_, i) => i !== match.index);
    const burned = keepBurned([...state.burned, { digest: slot.digest, generation: slot.generation, at: now }], now);
    const next = { ...state, live, burned };
    if (now > slot.expiresAt) {
      return { reply: { status: 410, error: 'code-expired', generation: slot.generation }, next, alert: { kind: 'expired', generation: slot.generation } };
    }
    if (slot.nodeId !== nodeId) {
      return { reply: { status: 403, error: 'wrong-node', generation: slot.generation }, next, alert: { kind: 'wrong-node', generation: slot.generation } };
    }
    return { reply: { status: 200, error: null, generation: slot.generation }, next, alert: null };
  }
  if (match.kind === 'burned') {
    const b = state.burned[match.index];
    return { reply: { status: 410, error: 'code-used', generation: b.generation }, next: state, alert: { kind: 'replay', generation: b.generation } };
  }
  const fresh = now - state.misses.windowStart >= CLAIM_MISS_WINDOW_MS;
  const misses = { windowStart: fresh ? now : state.misses.windowStart, count: (fresh ? 0 : state.misses.count) + 1 };
  const next = { ...state, misses };
  const alert: ClaimAlert = { kind: 'misses', count: misses.count };
  if (misses.count > CLAIM_MISS_BUDGET) return { reply: { status: 429, error: 'rate-limited', generation: null }, next, alert };
  return match.kind === 'malformed'
    ? { reply: { status: 400, error: 'bad-request', generation: null }, next, alert }
    : { reply: { status: 404, error: 'no-claim', generation: null }, next, alert };
}

// ── one rotation (spec §5) ───────────────────────────────────────────────────
export type GenerationObservation = { read: GenerationRead; measuredAt: number };
export type SyncResult =
  | { kind: 'synced'; generation: string; transport: TokenTransport | 'unmeasured' }
  | { kind: 'refused'; word: TokenSyncOpError; detail: string | null }
  | { kind: 'predates-op' } | { kind: 'unsent' } | { kind: 'lost'; why: 'timeout' | 'disconnected' | 'aborted' };
/** `why` on `stage` is an addition to the contract's shape: the driver records it as `owedWhy`, and it must not
 *  derive it itself. */
export type DriverAction =
  | { kind: 'none' }
  | { kind: 'hold'; hold: TokenHold; node: string | null }
  | { kind: 'retry-mint' }
  | { kind: 'stage'; why: OwedReason | 'rotate-now' }
  | { kind: 'send'; generation: string; nodeId: string }
  | { kind: 'promote'; generation: string; via: 'op-result' | 'generation-read' | 'own-write' }
  | { kind: 'retire'; why: 'grace' | 'hard-bound' }
  | { kind: 'extend-grace' }
  | { kind: 'backoff'; until: number };

/** The id of a handed-out pending generation equal to the read's id, read strictly after the hand-out. */
export function confirmedGeneration(state: BoxTokenState, obs: GenerationObservation): string | null {
  if (obs.read.kind !== 'id') return null;
  const id = obs.read.id;
  const g = state.pending.find((p) => p.id === id);
  return g !== undefined && g.handedOutAt !== null && obs.measuredAt > g.handedOutAt ? g.id : null;
}

export function retireDue(prev: NonNullable<BoxTokenState['previous']>, now: number): 'no' | 'grace' | 'hard-bound' | 'extend' {
  if (now >= prev.hardUntil) return prev.currentPresented ? 'grace' : 'hard-bound';
  if (now < prev.graceUntil) return 'no';
  return prev.currentPresented ? 'grace' : 'extend';
}

export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_MIN_MS * 2 ** Math.min(failures - 1, 30), BACKOFF_MAX_MS);
}

/** `state` may be null: a boot whose mint failed with no history has none (an addition to the contract's
 *  non-null parameter). */
export function nextAction(i: { state: BoxTokenState | null; gate: GateVerdict; generation: GenerationObservation | null;
  rotateRequested: boolean; backoffUntil: number | null; now: number }): DriverAction {
  const { state, gate, now } = i;
  if (state === null || (!gate.open && gate.hold === 'mint-failed')) return { kind: 'retry-mint' };
  if (state.promoting !== null) return { kind: 'promote', generation: state.promoting.id, via: 'op-result' };
  if (i.generation !== null) {
    const confirmed = confirmedGeneration(state, i.generation);
    if (confirmed !== null) return { kind: 'promote', generation: confirmed, via: 'generation-read' };
  }
  const staged = state.pending.find((p) => p.handedOutAt === null);
  // F3(c): the own-write promote waits out the backoff like every other retry; "Rotate now" asks for a stage, not for this.
  if (staged && gate.open && gate.mode === 'both-local') {
    if (i.backoffUntil !== null && now < i.backoffUntil) return { kind: 'backoff', until: i.backoffUntil };
    return { kind: 'promote', generation: staged.id, via: 'own-write' };
  }
  if (state.previous !== null) {
    const due = retireDue(state.previous, now);
    if (due === 'grace' || due === 'hard-bound') return { kind: 'retire', why: due };
    if (due === 'extend' && !state.rotationOwed) return { kind: 'extend-grace' };
  }
  if (staged) {
    if (!gate.open) return { kind: 'hold', hold: gate.hold, node: gate.node };
    if (gate.mode === 'remote' && gate.nodeId !== null) return { kind: 'send', generation: staged.id, nodeId: gate.nodeId };
  }
  const handedOut = state.pending.filter((p) => p.handedOutAt !== null);
  const waiting = handedOut.some((p) => p.confirmBy !== null && now <= p.confirmBy);
  if (waiting) return { kind: 'none' };   // a rotation is in flight; a second trigger joins it
  const overdue = handedOut.length > 0;
  const behind = i.generation !== null && state.current.id !== null && state.pending.length === 0
    && (state.lastRotationAt === null || i.generation.measuredAt > state.lastRotationAt)
    && (i.generation.read.kind === 'absent' || (i.generation.read.kind === 'id' && i.generation.read.id !== state.current.id));
  const why: OwedReason | 'rotate-now' | null = state.rotationOwed ? (state.owedWhy ?? 'adopted')
    : overdue ? 'confirm-deadline' : behind ? 'fleet-behind' : i.rotateRequested ? 'rotate-now' : null;
  if (why === null) return { kind: 'none' };
  if (!gate.open) return { kind: 'hold', hold: gate.hold, node: gate.node };
  // D-4413: never a fourth pending value, whatever the gate said (the gate counts handed-out values, this counts all).
  if (state.pending.length >= PENDING_HARD_CAP) return { kind: 'hold', hold: 'pending-cap', node: null };
  if (i.backoffUntil !== null && now < i.backoffUntil && !i.rotateRequested) return { kind: 'backoff', until: i.backoffUntil };
  return { kind: 'stage', why };
}

/** Fold one op answer into the state. The generation is promoted only on `synced` naming the sent id, and only
 *  if it is still outstanding and was handed out; anything else confirms nothing. A value never handed out is
 *  dropped from `pending` (the driver removes its file and revokes its code). */
export function applySyncResult(state: BoxTokenState, sent: string, r: SyncResult, now: number):
  { state: BoxTokenState; promote: string | null; learned: { hold: 'verb-missing' | 'stale-client' | 'agent-predates-op'; at: number } | null } {
  const gen = state.pending.find((p) => p.id === sent);
  if (gen === undefined) return { state, promote: null, learned: null };
  const transportOf = (t: TokenTransport | 'unmeasured' | null): TokenTransport | 'unmeasured' => t ?? state.lastSync?.transport ?? 'unmeasured';
  const dropUnclaimed = (s: BoxTokenState): BoxTokenState =>
    gen.handedOutAt === null ? { ...s, pending: s.pending.filter((p) => p.id !== sent) } : s;
  if (r.kind === 'synced') {
    const lastSync = { at: now, word: 'synced', transport: r.transport };
    if (r.generation === sent && gen.handedOutAt !== null) {
      return { state: { ...state, lastSync, failures: 0, lastFailure: null }, promote: sent, learned: null };
    }
    return { state: dropUnclaimed({ ...state, lastSync }), promote: null, learned: null };
  }
  // An agent that advertised the op yet answers bad-request is a learned hold, never a failure (D-4401): without it the
  // driver would re-stage and re-send every tick, invisibly. The gate re-probes it on a fresh ready or after an hour.
  if (r.kind === 'predates-op') return { state: dropUnclaimed(state), promote: null, learned: { hold: 'agent-predates-op', at: now } };
  if (r.kind === 'unsent') return { state: dropUnclaimed(state), promote: null, learned: null };
  if (r.kind === 'lost') {
    const s = { ...state, failures: state.failures + 1, lastFailure: r.why };
    return { state: dropUnclaimed(s), promote: null, learned: null };
  }
  const lastSync = { at: now, word: r.word, transport: transportOf(null) };
  if (r.word === 'stale-client') {
    return { state: dropUnclaimed({ ...state, lastSync }), promote: null, learned: { hold: 'stale-client', at: now } };
  }
  if (r.word === 'spawn-failed' && isTokenVerbMissing(r.detail)) {
    return { state: dropUnclaimed({ ...state, lastSync }), promote: null, learned: { hold: 'verb-missing', at: now } };
  }
  if (r.word === 'code-used') {
    // Someone else holds this value and it never reached the fleet: discard it even if handed out (spec §6 row 2).
    const s = owe({ ...state, lastSync, failures: state.failures + 1, lastFailure: r.word,
      pending: state.pending.filter((p) => p.id !== sent) }, 'code-used');
    return { state: s, promote: null, learned: null };
  }
  return { state: dropUnclaimed({ ...state, lastSync, failures: state.failures + 1, lastFailure: r.word }), promote: null, learned: null };
}

/** Stage a new generation (its pending file already written). */
export function stagedState(state: BoxTokenState, id: string, now: number, write: WriteRecord): BoxTokenState {
  return { ...state, nextSeq: state.nextSeq + 1,
    pending: [...state.pending, { id, seq: state.nextSeq, stagedAt: now, handedOutAt: null, confirmBy: null, write }] };
}

/** The hand-out, recorded before the claim's 200 (D-4394). */
export function handedOutState(state: BoxTokenState, id: string, at: number): BoxTokenState {
  return { ...state, pending: state.pending.map((p) => (p.id === id ? { ...p, handedOutAt: at, confirmBy: at + CONFIRM_DEADLINE_MS } : p)) };
}

/** Whether a promotion already counts as a presentation of the new current (final review, D-4409 item 6): an own-write
 *  promotion does (the server's own write of the fleet file is the presentation), and so does a generation that was
 *  presented in its pending slot after its hand-out (spec §5: "the fleet's own proof call does that"). The driver
 *  only counts; this is the decision. */
export function promotionPresentsCurrent(p: { via?: 'op-result' | 'generation-read' | 'own-write'; presented?: boolean }): boolean {
  return p.via === 'own-write' || p.presented === true;
}

/** Promotion step (d): G is current, the old current is previous with its grace deadline, and the owed flag clears.
 *  Every other pending value is discarded except one handed out AFTER G (a later seq): that value may be the one the
 *  fleet holds, so it stays accepted (D-4400). `previousWrite` is null only when the old current could not be
 *  copied (a promotion finished at boot over a broken file): then no previous slot is kept. */
export function promotedState(state: BoxTokenState, id: string, now: number, previousWrite: WriteRecord | null,
  presentation: { via?: 'op-result' | 'generation-read' | 'own-write'; presented?: boolean } = {}): BoxTokenState {
  const g = state.pending.find((p) => p.id === id);
  if (g === undefined) throw new RangeError('promotedState: the generation is not pending');
  return {
    ...state, origin: 'rotated', rotationOwed: false, owedWhy: null,
    current: { id: g.id, seq: g.seq, since: now, write: g.write },
    // Only values handed out AFTER this one stay accepted (spec: a handed-out value is dropped only when a later value
    // is confirmed or the fleet reports the code used; D-4400). Earlier and never-handed-out values go.
    pending: state.pending.filter((p) => p.handedOutAt !== null && p.seq > g.seq),
    previous: previousWrite === null ? null : { id: state.current.id, seq: state.current.seq, graceUntil: now + GRACE_MS,
      hardUntil: now + GRACE_HARD_MS, currentPresented: promotionPresentsCurrent(presentation), write: previousWrite },
    promoting: null, recovering: null, fleetConfirmed: g.id, lastRotationAt: now,
    failures: 0, lastFailure: null, hold: null, holdNode: null,
  };
}

/** Grace extended because the new current value has not been presented; a forward rotation is owed. */
export function extendedGraceState(state: BoxTokenState, now: number): BoxTokenState {
  if (state.previous === null) return state;
  const graceUntil = Math.min(now + GRACE_MS, state.previous.hardUntil);
  return owe({ ...state, previous: { ...state.previous, graceUntil } }, 'fleet-behind');
}

export function phaseOf(state: BoxTokenState | null, hold: TokenHold | null, hasCurrent: boolean): BoxTokenPhase {
  if (!hasCurrent) return 'unconfigured';
  if (state === null) return 'idle';
  if (state.promoting !== null) return 'promoting';
  if (hold !== null) return 'held';
  if (state.pending.some((p) => p.handedOutAt !== null)) return 'handed-out';
  if (state.pending.length > 0) return 'staged';
  if (state.failures > 0) return 'failed';
  if (state.previous !== null) return 'grace';
  return 'idle';
}

// ── boot recovery (spec 4.2.1) ───────────────────────────────────────────────
/** Structural copy of `token/files.ts`'s `FileMeta` (L1 imports no L3). */
export interface FileMetaShape { dev: number; ino: number; mtimeMs: number; mode: number; kind: 'regular' | 'symlink' | 'other' }
/** `meta: null` means the file is absent. `digest` is the sha256 hex of a usable value, else null. */
export interface FileMetaLike { meta: FileMetaShape | null; usable: boolean; placeholder: boolean; digest: string | null }
export type RecoveryPlan = { kind: 'refuse' } | { kind: 'finish-promotion'; id: string } | { kind: 'from-previous' };

/** Server-written: a regular file whose (dev, ino) is the write record's and whose mtime is no later. */
export function provedWrite(f: FileMetaLike, w: WriteRecord | null): boolean {
  return w !== null && f.meta !== null && f.meta.kind === 'regular'
    && f.meta.dev === w.dev && f.meta.ino === w.ino && f.meta.mtimeMs <= w.writtenAtMs;
}

export function recoveryPlan(i: { state: BoxTokenState | null; current: FileMetaLike; pending: FileMetaLike | null;
  previous: FileMetaLike | null; retired: readonly string[] }): RecoveryPlan {
  const s = i.state;
  if (s === null || s.origin === 'adopted') return { kind: 'refuse' };
  if (i.current.meta !== null && !provedWrite(i.current, s.current.write)) return { kind: 'refuse' };
  const sibling = (f: FileMetaLike | null, w: WriteRecord | null): boolean =>
    f !== null && provedWrite(f, w) && f.usable && !f.placeholder && f.digest !== null && !i.retired.includes(f.digest);
  if (s.promoting !== null) {
    const g = s.pending.find((p) => p.id === s.promoting?.id);
    if (g !== undefined && sibling(i.pending, g.write)) return { kind: 'finish-promotion', id: g.id };
  }
  if (s.previous !== null && sibling(i.previous, s.previous.write)) return { kind: 'from-previous' };
  return { kind: 'refuse' };
}
