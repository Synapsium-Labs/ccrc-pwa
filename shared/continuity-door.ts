/** The door process's fence, on the wire (Overlord design spec §3.6 H1 "The door process (H9)" and §3.3.11 H12 "The
 *  fence"; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`, Task 1). Ring L0, context K: pure
 *  vocabulary, no import.
 *
 *  ccd's spawn step writes a one-time launch nonce into the door process's tool-server config, and puts only the nonce's
 *  sha256 on the start report (`doorNonceSha256`). The door process presents the nonce once, to the claim door
 *  (`POST /api/sessions/:id/act-key`), which binds it to the start carrying the nonce's hash that the generations lane
 *  minted from and, while no start the lane minted from was recorded after it and its generation has not ended, issues the
 *  act key once. The server keeps only the key's sha256 (`continuity_act_keys`). After the
 *  claim, every fenced call carries the key and a counter that only rises. There is NO term header (ruled, F6): the server
 *  compares the generation row's `term` with the designation's itself. The nonce and the key are secrets: they never ride an
 *  argv, a log line, a transcript or a pane (ruled, F1). */

/** The act key, presented on every fenced call. */
export const ACT_KEY_HEADER = 'x-ccrc-act-key';
/** The act counter: one above the last fenced call's, never reused (ruled, F7). */
export const ACT_COUNTER_HEADER = 'x-ccrc-act-counter';
/** The generation the key was issued for (`ActKeyClaimAnswer.generation`). */
export const ACT_GENERATION_HEADER = 'x-ccrc-act-generation';

/** A launch nonce's sha256, as the start report carries it and the claim door hashes the nonce: 64 lowercase hex. The nonce
 *  itself is the same shape (32 random bytes as hex), and the hash is taken over that 64-character hex TEXT as UTF-8, with
 *  no newline (`printf '%s' "$nonce" | sha256sum`), never over the 32 bytes it encodes. */
export const NONCE_SHA256_SHAPE = /^[0-9a-f]{64}$/;
/** An act key: 32 random bytes as 64 lowercase hex, from the server's `Entropy`. */
export const ACT_KEY_SHAPE = /^[0-9a-f]{64}$/;

/** The claim door's one success answer: the generation the key is bound to (its `n`) and the key, answered once. */
export interface ActKeyClaimAnswer {
  readonly ok: true;
  readonly generation: number;
  readonly key: string;
}

/** Why a claim refused, said in the refusal's `detail` and never as a refusal word of its own (the words are
 *  `stale-generation`, `renewing` and `unmeasured`). In `actKeyClaimVerdict`'s arm order. */
const CLAIM_WHY_MAP = {
  'store-unreadable': 'a read the claim needs could not be made: try again',
  'nonce-spent': 'this nonce already claimed a key: a door process restarted inside its generation serves reads only',
  'start-unreported': 'no recorded start carries this nonce yet: the start report has not landed, so keep the nonce and retry',
  superseded: "a start the generations lane minted from was recorded after this door process's own: a newer generation of this session exists",
  'not-minted': "this start's generation is not minted yet: keep the nonce and retry",
  'generation-ended': "this start's generation has ended",
} as const;
export type ClaimWhy = keyof typeof CLAIM_WHY_MAP;
export const CLAIM_WHYS = Object.keys(CLAIM_WHY_MAP) as ClaimWhy[];
export const claimWhyText = (w: ClaimWhy): string => CLAIM_WHY_MAP[w];
export function isClaimWhy(v: unknown): v is ClaimWhy {
  return typeof v === 'string' && (CLAIM_WHYS as readonly string[]).includes(v);
}

/** The door process's back-off between claims that answer `renewing`: from 1 s, doubling, to at most 30 s (plan question
 *  12; the spec-fixes run adds them to Table 11.5b). */
export const CLAIM_RETRY_MIN_MS = 1_000;
export const CLAIM_RETRY_MAX_MS = 30_000;

/** THE DELTA CACHE (C38, "a delta on every prompt"; plan Task 6, question 12): the door process refreshes the card door's
 *  `delta` form after each call it serves and every `DELTA_REFRESH_MS`, and writes `$REG/.door/<id>/delta` with a first line
 *  `v=1 at=<ms> until=<ms>`, `until` being `at` plus `DELTA_LEASE_MS`; the session hook prints the text while `until` is ahead
 *  of now, and the unknown line once it has passed. The text is one line of at most `DELTA_MAX_BYTES` UTF-8 bytes, as the
 *  anchor's ceilings are counted. ccd/door-process.mjs and ccd/session-hook.sh carry copies, held equal by their tests. */
export const DELTA_REFRESH_MS = 60_000;
export const DELTA_LEASE_MS = 180_000;
export const DELTA_MAX_BYTES = 300;
