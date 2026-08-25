import { LEDGER_SEED_GAP } from '../../../shared/api.js';

/**
 * L1: pure — the allocator's DECISION and the floor SCAN, with no clock, no
 * fs and no handle (`single-definition.test.ts`'s coord-ring scan). The CAS
 * around the decision — BEGIN IMMEDIATE, the log-first append, the PRIMARY
 * KEY (project, n) backstop, the 3x in-request retry — is part B's store
 * method and `ledgerlog.ts`; `ledger-race.test.ts` pins it there.
 */

/** The per-request block ceiling. A program pre-allocates its whole D-block
 *  at run-open (D13 / coordinator clause 10); 100 numbers is several
 *  programs' worth, and anything larger is likelier a caller bug than a
 *  plan. Not L0: no wire type carries it — the route answers bad-count. */
export const LEDGER_ALLOC_MAX = 100;

export type AllocationDecision =
  | { readonly ok: true; readonly numbers: readonly number[]; readonly floor: number }
  | { readonly refused: 'not-seeded' }
  | { readonly refused: 'bad-count' };

/**
 * D13: until seeded, allocation fails shut (`not-seeded` — openCoordDb's
 * "refuse to start rather than open empty", one level up). `maxLanded` is
 * the greatest n ever ISSUED for this project — MAX over ledger_alloc in
 * EVERY state and over ~/.ccrc/ledger-alloc.log, null when none. Every
 * state, because an allocated-but-unwritten number is invisible to the
 * plan scan, and re-issuing one IS the bb47c9e failure; the caller
 * measures, this function only compares.
 *
 * bad-count is checked before not-seeded, and the order MASKS, not
 * combines: a caller with both defects learns bad-count alone, then
 * not-seeded on the retry — one per round trip. That is the point. Shape
 * is the caller's own defect, fixable this instant with no data consulted;
 * not-seeded is a wait-for-the-sweep condition, so answering it first
 * would park a caller whose request could never have been served anyway.
 * `not-seeded` is only ever said about a request that was otherwise
 * servable.
 */
export function decideAllocation(
  floorRow: { readonly floor: number } | null,
  maxLanded: number | null,
  count: number,
): AllocationDecision {
  if (!Number.isInteger(count) || count < 1 || count > LEDGER_ALLOC_MAX) {
    return { refused: 'bad-count' };
  }
  if (floorRow === null) return { refused: 'not-seeded' };
  const start = Math.max(floorRow.floor, (maxLanded ?? 0) + 1);
  const numbers = Array.from({ length: count }, (_, i) => start + i);
  return { ok: true, numbers, floor: floorRow.floor };
}

export interface LedgerFloorScan {
  readonly floor: number;
  /** Names the file and the number the seed was measured from — written
   *  into ledger_floor.evidence verbatim (D13). */
  readonly evidence: string;
  /** Every distinct legacy D-B<k>-<m> token seen, sorted — the D14
   *  reconciliation wave's worklist, and the reader's proof that "no
   *  global refs" and "no refs at all" are two different scans. */
  readonly legacy: readonly string[];
}

// The two forms, and they CANNOT cross-match: after 'D-' the global form
// requires a digit, so 'D-B4-400' contributes nothing to GLOBAL_RE (the
// 'B' blocks it) and the plain global token — 'D-' + '400', spelled split
// here because deviation-refs.test.ts scans this repo's own tracked text
// with GLOBAL_RE — contains no 'B' for LEGACY_RE. Global is
// bounded at 5 digits WITH a trailing \b, so a 6-digit token matches at NO
// length (every prefix ends digit-before-digit) rather than truncating.
const GLOBAL_RE = /\bD-(\d{1,5})\b/g;
const LEGACY_RE = /\bD-B(\d{1,3})-(\d{1,4})\b/g;

/**
 * D13's seed, D14's transition. The floor derives from the GLOBAL form
 * alone: a legacy number lives in a different namespace, and D14
 * reconciles it by allocating a FRESH global number through the allocator
 * — so feeding a legacy tail into this max would burn numbers for a token
 * that is about to be renamed anyway. A scan finding only legacy refs (or
 * nothing) answers null: not seeded, fail shut, never guess.
 *
 * Files are scanned in the order given; on a tie the FIRST file naming the
 * max is the evidence — deterministic because the caller (sweepLedgerFloor,
 * part B) sorts its readdir.
 */
export function floorFromScan(
  files: readonly { readonly path: string; readonly text: string }[],
): LedgerFloorScan | null {
  let max = 0;
  let evidence = '';
  const legacy = new Set<string>();
  for (const f of files) {
    for (const m of f.text.matchAll(LEGACY_RE)) legacy.add(m[0]);
    for (const m of f.text.matchAll(GLOBAL_RE)) {
      const n = Number(m[1]);
      if (n > max) { max = n; evidence = `${f.path} names D-${n}`; }
    }
  }
  if (max === 0) return null;
  return { floor: max + LEDGER_SEED_GAP, evidence, legacy: [...legacy].sort() };
}
