// Build 9b, wave 1 — the L0 slice (spec §2 `shared/`, D9-D14). The peers/
// claims/ledger vocabulary: every name the unshipped half of build 9 speaks
// over the wire, declared once, derived once, narrowed at exactly one door.
//
// WHAT THIS PINS AND WHY:
//  - CLAIM_STATES is a TABLE the type derives from (MAIL_REJECT_CODES's
//    as-const idiom, api.ts:3012) — order included, because wave 7's
//    migration generates the `claims` CHECK constraint from this array and a
//    silent reorder is a silent schema rewrite.
//  - isPeerDeliverable's empty-reason arm: 'no:' with no reason is an
//    unexplained refusal — the overloaded-value defect at the one seam whose
//    whole job is the reason (D9/D12).
//  - PEER_ETIQUETTE is five rules, one per primitive, and quotable in BOTH
//    skill quoting styles (D17, D-104): no double-quote anywhere, no
//    straight apostrophe anywhere.
//  - L0 purity: shared/api.ts imports exactly one thing, a TYPE. The PWA
//    bundles this file, so a `node:*` import is a broken browser bundle —
//    vitest runs under node and cannot feel that breakage, which is exactly
//    why the assertion exists here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAIM_STATES, isClaimState,
  isPeerDeliverable,
  PEER_ETIQUETTE,
  DEVIATION_ALLOC_STATES, isDeviationAllocState,
  CLAIM_LEASE_MS, CLAIM_HARD_CAP_MS, CLAIM_INTENT_MAX_BYTES,
  LEDGER_SEED_GAP, LEDGER_STALE_MS,
  PEER_MAIL_MAX_OUTSTANDING, PEER_MAIL_HOURLY,
  MAIL_REJECT_CODES,
} from '../../shared/api.js';
import type {
  ClaimState, PeerDeliverable,
  PeerSummary, ClaimSummary, ClaimConflict, DeviationAllocation,
} from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiPath = path.resolve(here, '../../shared/api.ts');

describe('claim states are a table the type derives from', () => {
  it('holds exactly the four states, in declaration order', () => {
    expect(CLAIM_STATES).toEqual(['live', 'released', 'lapsed', 'broken']);
  });

  it('is total in both directions at compile time', () => {
    // TS2741 here the day CLAIM_STATES gains a member this map lacks; TS2353
    // the day the map gains one the array does not have. typecheck-tests
    // compiles this file, so the guarantee is a gate, not a comment.
    const total: Record<ClaimState, true> = {
      live: true, released: true, lapsed: true, broken: true,
    };
    expect(Object.keys(total)).toEqual([...CLAIM_STATES]);
  });

  it('isClaimState is the only narrowing door, and it refuses the near-misses', () => {
    for (const s of CLAIM_STATES) expect(isClaimState(s), s).toBe(true);
    // 'expired' is the word a later edit reaches for; the state is 'lapsed'
    // (D12: lapse, do not delete — an ended claim is history, not garbage).
    expect(isClaimState('expired')).toBe(false);
    expect(isClaimState('')).toBe(false);
    expect(isClaimState(null)).toBe(false);
    expect(isClaimState(undefined)).toBe(false);
  });
});

describe('peer deliverability is three answers, not two', () => {
  it('accepts the two bare words and a reasoned no', () => {
    expect(isPeerDeliverable('yes')).toBe(true);
    // D9: registry-unmeasurable is 'unknown', and 'unknown' is NOT 'no' —
    // doubt about a peer is not evidence against it.
    expect(isPeerDeliverable('unknown')).toBe(true);
    const reasoned: PeerDeliverable = 'no:stopped';
    expect(isPeerDeliverable(reasoned)).toBe(true);
    expect(isPeerDeliverable('no:never-started')).toBe(true);
  });

  it('refuses no: with an empty reason — an unexplained no is the overloaded value, not a shorter one', () => {
    expect(isPeerDeliverable('no:')).toBe(false);
    expect(isPeerDeliverable('no')).toBe(false);
  });

  it('refuses non-strings and words outside the shape', () => {
    expect(isPeerDeliverable(null)).toBe(false);
    expect(isPeerDeliverable(true)).toBe(false);
    expect(isPeerDeliverable('maybe')).toBe(false);
    // Shape, not policy: the PRODUCER is held to sweepMail's structural
    // ladder by deliverability-parity.test.ts (wave 7), not by this guard.
  });
});

describe('the etiquette is five rules, one per primitive, quotable in both skill styles', () => {
  it('is exactly five rules — the tuple type pins it at compile time too', () => {
    const five: readonly [string, string, string, string, string] = PEER_ETIQUETTE;
    expect(five).toHaveLength(5);
  });

  it('each rule names its mechanism', () => {
    expect(PEER_ETIQUETTE[0]).toContain('409');            // claims
    expect(PEER_ETIQUETTE[1]).toContain('/api/peers');     // discovery
    expect(PEER_ETIQUETTE[2]).toContain('/api/lifecycle'); // history
    expect(PEER_ETIQUETTE[2]).toContain('archive stamp');
    expect(PEER_ETIQUETTE[3]).toContain('human-timescale');// mail
    expect(PEER_ETIQUETTE[4]).toContain('deviation');      // ledger
  });

  it('carries no double-quote and no straight apostrophe (D17/D-104: both skill quoting styles must quote a rule verbatim)', () => {
    for (const rule of PEER_ETIQUETTE) {
      expect(rule, rule).not.toContain('"');
      expect(rule, rule).not.toContain("'");
    }
  });

  it('stays a card, not an essay — it rides every /api/peers answer', () => {
    expect(PEER_ETIQUETTE.join('\n').length).toBeLessThanOrEqual(1200);
  });
});

describe('the numbers are the spec numbers, and the lease sits under the cap', () => {
  it('claims: a 45-minute lease under an 8-hour hard cap', () => {
    expect(CLAIM_LEASE_MS).toBe(45 * 60_000);
    expect(CLAIM_HARD_CAP_MS).toBe(8 * 60 * 60_000);
    // The ordering is the invariant, not a restatement: renewal extends the
    // lease and NEVER the cap, so doubt cannot hold forever (D12). Swapping
    // the two constants would invert that silently.
    expect(CLAIM_LEASE_MS).toBeLessThan(CLAIM_HARD_CAP_MS);
  });

  it('intent is capped at 512 bytes', () => {
    expect(CLAIM_INTENT_MAX_BYTES).toBe(512);
  });

  it('ledger: a 50-number seed gap, staleness at 7 days', () => {
    expect(LEDGER_SEED_GAP).toBe(50);
    expect(LEDGER_STALE_MS).toBe(7 * 24 * 60 * 60_000);
  });

  it('peer mail: 3 outstanding per pair, 12 per sender-hour', () => {
    expect(PEER_MAIL_MAX_OUTSTANDING).toBe(3);
    expect(PEER_MAIL_HOURLY).toBe(12);
  });
});

describe('the mail table carries the two peer-lane codes (landed with wave 0)', () => {
  it('declares duplicate and peer-quota', () => {
    expect(MAIL_REJECT_CODES).toContain('duplicate');
    expect(MAIL_REJECT_CODES).toContain('peer-quota');
  });
});

describe('L0 stays import-free: the PWA bundles this file', () => {
  it('shared/api.ts has exactly one import line, and it is a type', () => {
    const lines = readFileSync(apiPath, 'utf8').split('\n');
    const imports = lines.filter((l) => /^import\s/.test(l));
    expect(imports).toEqual(["import type { Hue } from './roster.js';"]);
  });
});

describe('the wire shapes compile as declared (typecheck-tests carries the real teeth)', () => {
  it('a PeerSummary literal is total', () => {
    const peer: PeerSummary = {
      id: 'ccrc-pwa-quiet-river', uuid: null, project: 'ccrc-pwa',
      workspace: 'quiet-river', branch: 'feat/mirror-lens', wrapper: null,
      lifecycle: 'running', deliverable: 'yes',
      archivedAt: null, archivedReason: null, archivedStale: false,
      held: null, intent: null,
    };
    expect(peer.deliverable).toBe('yes');
  });

  it('a ClaimSummary literal is total, and a ClaimConflict carries the envelope', () => {
    const claim: ClaimSummary = {
      id: 7, project: 'ccrc-pwa', paths: ['server/src/coord/store.ts'],
      heldBy: 'ccrc-pwa-quiet-river', heldByUuid: null,
      intent: 'wave 2: store methods for the mirror', runId: null,
      state: 'live', createdAt: 1_756_000_000_000, renewedAt: 1_756_000_000_000,
      expiresAt: 1_756_000_000_000 + CLAIM_LEASE_MS,
      hardExpiresAt: 1_756_000_000_000 + CLAIM_HARD_CAP_MS,
      endedAt: null, endedBy: null,
    };
    const conflict: ClaimConflict = {
      path: 'server/src/coord/store.ts', claimedPath: 'server/src/coord',
      claimId: claim.id, heldBy: claim.heldBy, heldByUuid: null,
      intent: claim.intent, runId: null,
      expiresAt: claim.expiresAt, deliverable: 'yes',
      mailHint: { toId: claim.heldBy, subject: 'claim conflict: server/src/coord/store.ts' },
    };
    expect(conflict.claimId).toBe(7);
  });

  it('a DeviationAllocation literal is total, and stale is derived, never stored', () => {
    expect(DEVIATION_ALLOC_STATES).toEqual(['allocated', 'landed']);
    // D13 says landed rows are MARKED and stale rows are REPORTED — the D4
    // doctrine: a fact about a row and a clock is derived by the reader,
    // never stored, so it cannot disagree with its own inputs.
    expect(DEVIATION_ALLOC_STATES as readonly string[]).not.toContain('stale');
    for (const s of DEVIATION_ALLOC_STATES) expect(isDeviationAllocState(s), s).toBe(true);
    expect(isDeviationAllocState('stale')).toBe(false);
    const row: DeviationAllocation = {
      project: 'ccrc-pwa', n: 999, title: 'mirror cursor is an optimisation',
      allocatedTo: 'ccrc-pwa-quiet-river', runId: null,
      allocatedAt: 1_756_000_000_000, state: 'allocated',
      landedAt: null, landedIn: null, stale: false,
    };
    expect(row.n).toBe(999);
  });
});
