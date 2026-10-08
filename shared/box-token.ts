// L0 — the box-token lifecycle's wire and words (spec 2026-10-07 §4, §8 "Single definition"), shared by the
// server (its claim door, rotate route, driver and doctor-facing state), the agent and, from Part B, the PWA's card.
// It imports nothing but its `shared/` siblings, never `node:*`: the PWA bundles it.
//
// Nothing here is a secret or derives from one. A token value, a claim code and the sha256 of either never appear in
// a type this file declares except `ClaimResponse.value`, the one 200 body the claim door hands the fleet box.
import type { NodeRole } from './api.js';
import { GENERATION_ID_HEX, type ReadFailure, type TokenTransport } from './agent-protocol.js';

/** The fleet box's one door: it trades a single-use code for the staged value (spec 4.6). */
export const TOKEN_CLAIM_PATH = '/api/token/claim';
/** The console's "Rotate now" (session-gated, not EXEMPT). */
export const TOKEN_ROTATE_PATH = '/api/token/rotate';
/** The claim route's `bodyLimit`: a code and a node-id fit many times over; past it Fastify answers 413. */
export const CLAIM_BODY_LIMIT_BYTES = 1024;
/** A box-token value: 32 random bytes as 64 lowercase hex. */
export const TOKEN_VALUE_RE = /^[0-9a-f]{64}$/;
/** A generation id, built from the one spelling (`GENERATION_ID_HEX`, `shared/agent-protocol.ts`). */
export const GENERATION_ID_RE = new RegExp(`^${GENERATION_ID_HEX}$`);

/** `nodeId` is checked against the store's `NODE_ID_RE` (`server/src/coord/store.ts`) in the door; never re-spelled. */
export interface ClaimRequestBody { code: string; nodeId: string }
export const CLAIM_REFUSALS = ['bad-request', 'wrong-node', 'no-claim', 'code-expired', 'code-used', 'rate-limited', 'unavailable'] as const;
export type ClaimRefusal = (typeof CLAIM_REFUSALS)[number];
/** Status codes: 200 hand-out; 400 bad-request; 403 wrong-node; 404 no-claim; 410 code-expired | code-used;
 *  413 bad-request (route bodyLimit, same small body); 429 rate-limited; 503 unavailable (the hand-out could not be
 *  recorded, D-4394). */
export type ClaimResponse = { ok: true; value: string; generation: string } | { ok: false; error: ClaimRefusal };

export const TOKEN_ORIGINS = ['adopted', 'minted', 'rotated'] as const;
export type TokenOrigin = (typeof TOKEN_ORIGINS)[number];
export const OWED_REASONS = ['adopted', 'fleet-behind', 'confirm-deadline', 'retired-written-back', 'recovered',
  'aux-unusable', 'unverifiable-files', 'code-used', 'claim-misbound'] as const;
export type OwedReason = (typeof OWED_REASONS)[number];
export const TOKEN_HOLDS = ['update-in-flight', 'agent-predates-op', 'verb-missing', 'stale-client', 'fleet-rows',
  'node-id-unmeasured', 'link-down', 'pending-cap', 'no-coord', 'role-unrecorded', 'mint-failed'] as const;
export type TokenHold = (typeof TOKEN_HOLDS)[number];
export const BOX_TOKEN_PHASES = ['unconfigured', 'idle', 'staged', 'handed-out', 'promoting', 'grace', 'held', 'failed'] as const;
export type BoxTokenPhase = (typeof BOX_TOKEN_PHASES)[number];

/** The fixed comment line a fleet token file gets when none existed (both writers: the server's both-role writer and
 *  `ccrc token sync`). An existing file's own `#` and blank lines are kept instead. */
export const FLEET_TOKEN_FILE_COMMENT = '# ccrc box token: written by ccrc and rotated by the server; do not edit or copy it';

/** What the driver's run-time re-read of a server token file found (spec 4.2, §6 "A token file broken on re-read").
 *  The last good value in memory is kept in every case; an out-of-band edit is never adopted at run time.
 *  `missing`, not the read vocabulary's word: this is a finding about a file the server wrote, not a read outcome. */
export const TOKEN_FILE_PROBLEMS = ['missing', 'unusable', 'placeholder', 'unreadable', 'changed', 'retired'] as const;
export type TokenFileProblem = (typeof TOKEN_FILE_PROBLEMS)[number];

/** What a node-file read hands `readGenerationFile`: the inventory's `NodeFileRead`, restated structurally because L0
 *  imports no `server/src`. The failure words are `ReadFailure`'s, DERIVED, never re-spelled as a quoted pair
 *  (`single-definition.test.ts`'s "one absent/unreadable read vocabulary"). */
export type GenerationFileInput = { ok: true; content: string } | { ok: false; reason: ReadFailure | 'too-large' };
/** `~/.ccrc/box-token-generation`'s three outcomes, never folded: an id, proven absent, or unreadable. */
export type GenerationRead = { kind: 'id'; id: string } | { kind: 'absent' } | { kind: 'unreadable' };
/** The ONE reader. The file is exactly one line, `<16 lowercase hex>\n`; anything else (no newline, a second line,
 *  CRLF, upper case, a short or long id) is malformed and reads `unreadable`, as does an over-cap file. Only a
 *  proven absence reads `absent`. */
export function readGenerationFile(read: GenerationFileInput): GenerationRead {
  if (!read.ok) return read.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
  const { content } = read;
  if (!content.endsWith('\n')) return { kind: 'unreadable' };
  const id = content.slice(0, -1);
  return GENERATION_ID_RE.test(id) ? { kind: 'id', id } : { kind: 'unreadable' };
}

/** What the console and the rotate route show. Numbers are ms since the epoch unless named S. No value, code or hash. */
export interface BoxTokenView {
  phase: BoxTokenPhase;
  origin: TokenOrigin | null;
  currentSeq: number | null;          // display sequence number of the current generation
  currentSince: number | null;
  lastRotationAt: number | null;
  rotationOwed: boolean;
  owedWhy: OwedReason | null;
  hold: TokenHold | null;
  holdNode: string | null;            // the node a hold names (e.g. the one updating), else null
  failures: number;                   // consecutive
  lastFailure: string | null;         // a TokenSyncOpError, 'timeout', 'disconnected' or 'mint-failed'
  banner: boolean;                    // failures >= 3
  /** A failed mint, or a rotation owed and not completed for STALL_ALERT_MS (server/src/token/policy.ts), measured from
   *  when this server process first saw it owed. The console's alert for a stall that never counts as a failure. */
  stalled: { why: 'mint-failed' | 'owed'; since: number } | null;
  /** The last run-time re-read's finding about a server token file, or null when every file agreed with memory. */
  fileProblem: { at: number; file: 'current' | 'pending' | 'previous'; word: TokenFileProblem } | null;
  /** The fleet's generation read against the current one. Its two failure words are `ReadFailure`'s, derived, never
   *  re-spelled as a quoted pair (`single-definition.test.ts`'s "one absent/unreadable read vocabulary"). */
  fleetConfirmed: 'current' | 'behind' | ReadFailure | 'own-write' | 'unknown';
  fleetTransport: TokenTransport | 'unmeasured' | null;   // null: no sync yet
  lastSync: { at: number; word: string } | null;          // 'synced' or a refusal word
  previousPresented: number;
  retiredPresented: number;
  retiredRefused: boolean;            // the server's own proof at the last retirement
  lastBootRecovery: { at: number; source: 'pending' | 'previous' } | null;
  role: NodeRole;
}

export type RotateAnswer =
  | { ok: true; outcome: 'started' | 'joined'; view: BoxTokenView }       // 200
  | { ok: false; error: 'held'; hold: TokenHold; node: string | null; view: BoxTokenView }   // 409
  | { ok: false; error: 'rate-limited'; retryAfterS: number }             // 429
  | { ok: false; error: 'not-configured' };                               // 501
