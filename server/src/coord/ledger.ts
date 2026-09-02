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
 * ways this repo actually opens an entry.
 *
 * Looser than `deviation-refs.test.ts`'s `ENTRY` in one direction and TIGHTER in
 * another, and both halves are load-bearing. Stated as DELTAS and as SHAPES, never
 * as totals: a total moves whenever any plan gains an entry, so a cardinal written
 * here is stale by its own commit. That is not a style preference — it is D-1302's
 * defect, D-1294's first attempt at this very sentence, and then D-1320, which
 * found two stale cardinals still standing in this paragraph one wave after it was
 * rewritten to stop carrying them.
 *
 * LOOSER, TWICE:
 *  - `ENTRY` demands `[^—\n]*—\s*(.+)$` — a subject after an em-dash ON THE SAME
 *    LINE — so it cannot see the colon form (`- **D-190** (Task 1): …`,
 *    `2026-08-23-stage5-oss-polish.md:430`, and D-189/191/192/193/194/195 beside
 *    it) or a subject that wraps onto the next line. This exemplar was
 *    `- **D-211** (Task 3): …` for two waves and D-211 IS NOT THE COLON FORM
 *    (D-1329) — `2026-08-24-build9b-peers-claims-allocator.md:72` writes it with
 *    an em-dash, which `ENTRY` sees perfectly well. `deviation-refs.test.ts`'s own
 *    corpus table had that line pinned as an em-dash definition the whole time,
 *    so the docstring was refuted by a test in the same change that wrote it.
 *    The WRAPPED subject is the other shape `ENTRY` cannot see, and D-1158 is one
 *    of those — the half of the first collision incident that would have stayed
 *    invisible even in a fully merged tree.
 *  - The BARE-BOLD entry — `**D-297 — subject**` with no list bullet — which build
 *    8, stage 2e, the worker-skill plan and upstream-launcher-locks all write, and
 *    which BOTH `ENTRY` and this regex's first draft were blind to (D-1322). A
 *    re-definition of any of those numbers was silently missed by a guard whose
 *    whole subject is not missing one.
 *
 * TIGHTER: a prefix alone is NOT enough. `- **D-149 sweep:** any task that…`,
 * `- **D-1039..D-1045** (seven).` and `- **D-172, D-173 and D-174 were re-used**
 * by this branch…` are line-initial bolded CITATIONS, not entries, and a
 * prefix-only rule calls all three definitions. That is the false-positive
 * direction and it is the dangerous one here: the last of those is the exact prose
 * a wave writes when it RECORDS a ledger collision, so a prefix-only guard reds on
 * the narrative describing the incident it exists to detect, and the only remedy
 * its own message offers is to renumber a deviation the branch merely cited.
 *
 * THE FIRST DRAFT OF THE LOOKAHEAD CAUGHT ONLY THE SPELLING THE CORPUS HAPPENED TO
 * HOLD (D-1322). It accepted a bare `**` after the number, so it read
 * `- **D-1231** and **D-1232** were re-used by this branch` — the individually
 * bolded form, which is how every collision record in this program is actually
 * written — as a DEFINITION of D-1231, while correctly rejecting the whole-phrase
 * bold. The `**` arm now requires what a real entry has AFTER the bold closes: an
 * em-dash, a `(`, or a `:`. The three bare arms (` —`, ` (`, `:`) are unchanged.
 *
 * Measured over the plans `plansAt` feeds this, at HEAD and at `origin/main`
 * alike: every prefix-shaped line the lookahead drops is a citation; no line the
 * previous shape called a definition stops being one; and the widened prefix adds
 * the bare-bold entries named above. NO COUNTS (D-1328) — the first version of
 * this paragraph gave two, both true the day they were written and neither
 * pinned, so appending one citation line to any plan would have made them false
 * with every suite still green. That is D-1320's own defect, one paragraph below
 * the sentence that states it; the counts live in the plan, where a snapshot is
 * what a document is for. What is asserted here is a PROPERTY, and
 * `ledger-crosstree.test.ts` and `deviation-refs.test.ts` between them hold a
 * fixture or a corpus row for each shape named.
 *
 * The guard's own output is unmoved where it counts — zero allocator-era
 * cross-tree collisions before and after, and no change at all below the era, so
 * `GRANDFATHERED` (which may only SHRINK) does not have to grow.
 *
 * The dotted-sub-entry lookahead is kept exactly as `ENTRY` has it: `D-310.1`
 * CITES `D-310`, it does not define it. The lettered form (`D-155-a`) falls out
 * for free — the lookahead sees `-a`, not an entry opening.
 */
const DEFINITION = /^(?:#{2,4} |- \*\*|\*\*)D-(\d+)\b(?!\.\d)(?=\*\*\s*(?:—|\(|:)|\s+—|\s+\(|:)/;

/** A fenced-code delimiter: up to three spaces of indent, then a run of three or
 *  more backticks or tildes. Captured as the RUN, because a fence closes only on
 *  the same character at the same length or longer — which is how a four-backtick
 *  block can quote a three-backtick one.
 *
 *  THE EXEMPLAR THIS DOCSTRING FIRST GAVE WAS INVENTED (D-1326).
 *  `2026-08-28-program-leverage-wave1-f1.md:216` was named as a corpus instance
 *  "copied from the corpus, not invented"; measured, its four-backtick block
 *  (216–338) contains ZERO fence runs at all, and the file says why at :212 —
 *  "Indented code blocks, not fences". The shape IS in this repo —
 *  `2026-08-08-build7-surfaces.md:408`, inner fences at 429/432 and 460/465 — but
 *  that file is in `LEGACY_PER_PLAN_LEDGERS`, so `plansAt` never feeds it to this
 *  guard. The nesting fixture is therefore CONSTRUCTED, deliberately, and saying
 *  so is the point: the behaviour was always right and red-on-mutation, and only
 *  the provenance lied. A true guard sold with a false measurement is this wave's
 *  own recurring class. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Whether a fence-shaped line really OPENS a block.
 *
 *  A backtick fence's info string may not contain a backtick (CommonMark 4.5),
 *  because that spelling is a code SPAN, not a fence — and this repo's prose
 *  writes exactly that at the start of a line when it names a file:
 *  ``` ```coordinator-paused``` is a FILE, not a flag. ```
 *
 *  Without this the line opened a block, a later bare fence closed it, and every
 *  definition in between vanished with `open` back to null at EOF — so the
 *  whole-file arm below never fired and the guard went QUIET (D-1327). Driven end
 *  to end: two such prose lines in one file are enough, and both are real names in
 *  this project. Zero instances in `docs/` today, so this is potential rather than
 *  live; a silent miss in a collision guard is what the next paragraph's own
 *  invariant forbids, which is why potential is enough.
 *
 *  Tilde fences are unaffected — a `~~~` info string may contain backticks. */
function opensFence(line: string, run: string): boolean {
  if (run[0] !== '`') return true;
  return !line.slice(line.indexOf(run) + run.length).includes('`');
}

/** The lines of a file that sit INSIDE a fenced block, or `null` when the file
 *  ends with a fence still open — the ambiguous case, which the caller resolves
 *  by scanning the file whole. */
function fencedLines(lines: readonly string[]): Set<number> | null {
  const inside = new Set<number>();
  let open: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]!);
    if (open === null) {
      if (m && opensFence(lines[i]!, m[1]!)) { open = m[1]!; inside.add(i); }
      continue;
    }
    inside.add(i);
    // A closing fence is the same character, at least as long, and carries no
    // info string at all — a tilde run never closes a backtick block, and a
    // shorter run never closes a longer one.
    if (m && m[1]![0] === open[0] && m[1]!.length >= open.length &&
        lines[i]!.slice(lines[i]!.indexOf(m[1]!) + m[1]!.length).trim() === '') {
      open = null;
    }
  }
  return open === null ? inside : null;
}

export interface Definition { readonly file: string; readonly n: number }
export interface CrossTreeCollision { readonly n: number; readonly files: readonly string[] }

/**
 * Every definition in a set of already-read files. Pure: the caller does the
 * reading, so the same function serves fixtures and two real git trees.
 *
 * FENCED BLOCKS ARE SKIPPED (D-1323). A plan that QUOTES another plan's ledger
 * entry inside a code fence — a review report pasting the line it is arguing
 * about, a wave narrating the collision it just renumbered — is not defining that
 * number, and a guard whose printed remedy is "renumber NOW" must not fire on a
 * quotation. No line in the corpus is affected today; the shape is what plans are
 * about to write, and the same family as the citation false positive above.
 *
 * A FILE THAT ENDS WITH A FENCE STILL OPEN IS SCANNED WHOLE. The unclosed fence
 * would otherwise put everything after it "inside" a block, silently dropping
 * real definitions — a guard going quiet is a worse failure than a guard being
 * noisy, so the ambiguous file gets the loud answer. Every plan closes its fences
 * today, so the arm exists for the file that does not.
 */
export function definitionsIn(
  files: readonly { readonly path: string; readonly text: string }[],
): Definition[] {
  const out: Definition[] = [];
  for (const f of files) {
    const lines = f.text.split('\n');
    const fenced = fencedLines(lines);
    for (let i = 0; i < lines.length; i++) {
      if (fenced !== null && fenced.has(i)) continue;
      const m = DEFINITION.exec(lines[i]!);
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
 * the SAME orphans, because this project's first issued number is 274 — so
 * 211..273 were all hand-numbered, and the bootstrap set was both too narrow and
 * specific to one repo. 274 is safe to write down where a count is not: it is
 * `MIN(n)` over an append-only allocation table, so it can only change if the
 * allocator issues something lower, which it never does.
 *
 * THE COUNT THAT USED TO SIT IN THAT SENTENCE — "the SAME four orphans
 * (D-1066..1069)" — WAS FALSIFIED BY THIS WAVE'S OWN NEXT MEASUREMENT (D-1332).
 * It was true when written and there are six today, because two merged plans
 * defined numbers the allocator never issued (D-1325). The property is what the
 * sentence is for; the enumeration was decoration that went stale in nine days,
 * in the file whose subject is exactly that.
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
