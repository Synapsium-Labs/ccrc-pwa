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
// requires a digit, so 'D-B4-' + '400' contributes nothing to GLOBAL_RE (the
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

/* ── F7: the cross-tree collision decision ─────────────────────────────────── */

/**
 * The first allocator-era number. Below it the pre-allocator era legitimately
 * minted the same number twice (parallel branches; three early plans numbered
 * per plan), and `deviation-refs.test.ts`'s `GRANDFATHERED` set — whose own rule
 * is that it may only SHRINK, and that nothing >= 211 may ever join it — is what
 * carries that history. Scoping the cross-tree rule here is what lets it be
 * subject-free without forcing that set to grow (D-1295).
 */
export const LEDGER_ALLOCATOR_ERA = 211;

/**
 * A line that DEFINES a number: an entry PREFIX, then the number, then one of the
 * four ways this repo actually opens an entry.
 *
 * Looser than `deviation-refs.test.ts`'s `ENTRY` in one direction and TIGHTER in
 * another, and both halves are load-bearing.
 *
 * LOOSER: `ENTRY` demands `[^—\n]*—\s*(.+)$` — a subject after an em-dash ON THE
 * SAME LINE — so it cannot see build 9b's colon form (`- **D-211** (Task 3): …`)
 * or a subject wrapped onto the next line. Measured as a DELTA rather than as two
 * totals, because the totals move whenever any plan gains an entry and a number
 * here would be stale by its own commit (D-1302's defect, and D-1294's first
 * attempt at this sentence made exactly that mistake): this shape sees 29
 * definition lines `ENTRY` cannot, D-1158 among them — one of the five numbers
 * this program lost, and the half of the first incident that would have stayed
 * invisible even in a fully merged tree.
 *
 * TIGHTER: a prefix alone is NOT enough, and the review that found this had two
 * live examples in the corpus. `- **D-149 sweep:** any task that…` and
 * `- **D-172, D-173 and D-174 were re-used** by this branch…` are line-initial
 * bolded CITATIONS, not entries, and a prefix-only rule calls both definitions.
 * That is the false-positive direction and it is the dangerous one here: the
 * second of those sentences is the exact prose a wave writes when it RECORDS a
 * ledger collision, so a prefix-only guard reds on the narrative describing the
 * incident it exists to detect, and the only remedy its own message offers is to
 * renumber a deviation the branch merely cited. The lookahead requires what every
 * real entry has after its number — `**` (the bold closing), ` —`, ` (` or a
 * bare `:` — and rejects `,`, `'s`, and a following word. Measured over the
 * scanned plans: 394 prefix matches, 388 entry-shaped, and all six dropped lines
 * are citations (D-149, D-171, D-172, D-291, D-292, D-1026). No real entry moves.
 *
 * The dotted-sub-entry lookahead is kept exactly as `ENTRY` has it: `D-310.1`
 * CITES `D-310`, it does not define it.
 */
const DEFINITION = /^(?:#{2,4} |- \*\*)D-(\d+)\b(?!\.\d)(?=\*\*|\s+—|\s+\(|:)/;

export interface Definition { readonly file: string; readonly n: number }
export interface CrossTreeCollision { readonly n: number; readonly files: readonly string[] }

/** Every definition in a set of already-read files. Pure: the caller does the
 *  reading, so the same function serves fixtures and two real git trees. */
export function definitionsIn(
  files: readonly { readonly path: string; readonly text: string }[],
): Definition[] {
  const out: Definition[] = [];
  for (const f of files) {
    for (const line of f.text.split('\n')) {
      const m = DEFINITION.exec(line);
      if (m) out.push({ file: f.path, n: Number(m[1]) });
    }
  }
  return out;
}

/**
 * Allocator-era numbers DEFINED in more than one plan file across two trees.
 *
 * SUBJECT-FREE by construction, and that is the point rather than a shortcut:
 * the allocator issues each number once, for one stated purpose, so a second
 * defining FILE is the defect however the two entries are worded. The
 * subject comparison in `deviation-refs.test.ts` exists to grandfather the
 * pre-allocator era, and this rule steps around that era instead of widening it.
 *
 * SAME FILE IN BOTH TREES IS NOT A COLLISION. Every unmerged plan on a branch is
 * also on the base; if that fired, the guard would be red on every branch forever
 * and would be switched off within a day.
 *
 * Pure, and both trees arrive as data — reading `origin/main` is the caller's
 * job, which is what keeps this side fixture-testable and this file L1.
 */
export function crossTreeCollisions(
  branch: readonly { readonly path: string; readonly text: string }[],
  base: readonly { readonly path: string; readonly text: string }[],
  era: number = LEDGER_ALLOCATOR_ERA,
): CrossTreeCollision[] {
  const byN = new Map<number, Set<string>>();
  for (const d of [...definitionsIn(branch), ...definitionsIn(base)]) {
    if (d.n < era) continue;
    const files = byN.get(d.n) ?? new Set<string>();
    files.add(d.file);
    byN.set(d.n, files);
  }
  return [...byN.entries()]
    .filter(([, files]) => files.size > 1)
    .map(([n, files]) => ({ n, files: [...files].sort() }))
    .sort((a, b) => a.n - b.n);
}

/**
 * A project's own allocator era: the FIRST number its allocator ever issued.
 * Anything a plan defines below it predates the allocator for that project and is
 * not reportable — nobody could have asked.
 *
 * DERIVED PER PROJECT, and that is the whole point. The first version of this
 * hardcoded `LEDGER_ALLOCATOR_ERA` (211, this repo's first allocator-era number)
 * plus a `LEDGER_BOOTSTRAP` set of 211..224 (build 9b's own hand-numbered plan) —
 * and `sweepLedgerReconcile` applies this to EVERY project that has ever issued a
 * number. The second project to adopt the allocator, carrying its own few hundred
 * hand-numbered deviations, would have had most of them named as "never
 * allocated" alongside a nonsensical 14-number hole grandfathered out of a
 * different repo's history (review finding).
 *
 * The allocator already knows the answer for each project and it costs one
 * `MIN(n)`. Measured on ccrc-pwa: the hardcoded pair and this derivation report
 * the SAME four orphans (D-1066..1069), because this project's first issued
 * number is 274 — so 211..273 were all hand-numbered, and the bootstrap set was
 * both too narrow and specific to one repo.
 *
 * `null` — a project with no allocations at all — reports nothing: there is no
 * era, so no definition can be below or above it.
 */
export function projectEra(allocated: ReadonlySet<number>): number | null {
  let min: number | null = null;
  for (const n of allocated) if (min === null || n < min) min = n;
  return min;
}

export function unallocatedDefinitions(
  definitions: readonly Definition[],
  allocated: ReadonlySet<number>,
): CrossTreeCollision[] {
  const era = projectEra(allocated);
  if (era === null) return [];
  const byN = new Map<number, Set<string>>();
  for (const d of definitions) {
    if (d.n < era || allocated.has(d.n)) continue;
    const files = byN.get(d.n) ?? new Set<string>();
    files.add(d.file);
    byN.set(d.n, files);
  }
  return [...byN.entries()]
    .map(([n, files]) => ({ n, files: [...files].sort() }))
    .sort((a, b) => a.n - b.n);
}
