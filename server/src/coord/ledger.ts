/**
 * L1: pure — reading `D-<n>` definitions out of plan text and deciding the two
 * collision checks, with no clock, no fs and no handle (`single-definition.test.ts`'s
 * coord-ring scan). The deviation allocator whose decision and floor scan lived here
 * retired (docs/superpowers/plans/2026-11-24-deviation-allocator-removal-pr2.md):
 * numbers are self-assigned with `npm run next-deviation`.
 */

/** The block ceiling: `nextDeviationNumbers`' count bound, kept from the
 *  retired allocator's per-request ceiling (D13). 100 numbers is several
 *  programs' worth, and anything larger is likelier a caller bug than a
 *  plan. Not L0: no wire type carries it. */
export const LEDGER_ALLOC_MAX = 100;

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

/** A fenced-code delimiter: up to three SPACES of indent, then a run of three or
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
 *  own recurring class.
 *
 *  SPACES, NOT `\s` (D-1430). The sentence at the top said "three
 *  spaces" while the pattern below said `\s{0,3}`, which admits a TAB (and \r,
 *  \f, \v, NBSP, U+2000-200A, U+3000, U+FEFF). CommonMark §2.2 expands a tab to
 *  the next 4-column tab stop, so a tab-indented run is four columns of
 *  indentation — an indented code block, not a fence. It failed in BOTH
 *  directions, each driven by a fixture in `ledger-crosstree.test.ts`: a
 *  tab-indented PAIR hid a real entry between two delimiters that do not exist,
 *  and a single tab-indented run CLOSED a real fence early, left an odd fence at
 *  EOF, and handed the whole-file arm a quotation to report as a definition —
 *  "renumber NOW" aimed at a quoted line. Zero lines in the plans this guard
 *  reads are affected today, so this is potential rather than live, which is the
 *  bar `opensFence` sets one docstring below. The >= 4-space direction needs no
 *  rule of its own: `DEFINITION` is anchored at column 0. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

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
  return definitionLines(files).map(({ file, n }) => ({ file, n }));
}

/**
 * `definitionsIn` with each definition's comparable subject, for the subject-aware rule. A subject
 * wrapped onto the next line (`- **D-N** —` then the text) is read from the next non-blank line, unless
 * that line is a definition, a heading or a fence; one still empty gets a key of its own (file and line), so an empty subject never makes two definitions equal.
 */
function definitionLines(
  files: readonly { readonly path: string; readonly text: string }[],
): (Definition & { readonly subject: string })[] {
  const out: (Definition & { readonly subject: string })[] = [];
  for (const f of files) {
    const lines = f.text.split('\n');
    const fenced = fencedLines(lines);
    for (let i = 0; i < lines.length; i++) {
      if (fenced !== null && fenced.has(i)) continue;
      const m = DEFINITION.exec(lines[i]!);
      if (!m) continue;
      let subject = definitionSubject(lines[i]!);
      if (subject === '') {
        // A definition, heading or fence on the next line is not this one's subject.
        const nx = lines.slice(i + 1).find((l) => l.trim() !== '') ?? '';
        subject = DEFINITION.test(nx) || /^\s*(?:#|```|~~~)/.test(nx) ? '' : tidySubject(nx);
      }
      out.push({ file: f.path, n: Number(m[1]), subject: subject === '' ? `\0${f.path}:${i}` : subject });
    }
  }
  return out;
}

const tidySubject = (s: string): string => s.replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '').trimEnd();

/**
 * The subject of a definition line: the text after its first em dash (or, with no em dash, after the
 * number), whitespace collapsed and trailing punctuation trimmed. The one subject extractor: the
 * self-assigned rule and the old subject scanner in `deviation-refs.test.ts` both read it. `exact`
 * keeps the old scanner's comparison, which is main's and stays so below the era: the text only trimmed.
 */
export function definitionSubject(line: string, exact = false): string {
  const dash = line.indexOf('\u2014');
  const rest = dash >= 0 ? line.slice(dash + 1) : line.replace(/^.*?D-\d+(?:\*\*)?/, '');
  return exact ? rest.trim() : tidySubject(rest);
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
    // From SELF_ASSIGNED_ERA up, selfAssignedCollisions alone judges: a renamed or mirrored entry is one deviation there.
    if (d.n < era || d.n >= SELF_ASSIGNED_ERA) continue;
    const files = byN.get(d.n) ?? new Set<string>();
    files.add(d.file);
    byN.set(d.n, files);
  }
  return [...byN.entries()]
    .filter(([, files]) => files.size > 1)
    .map(([n, files]) => ({ n, files: [...files].sort() }))
    .sort((a, b) => a.n - b.n);
}

/** Self-assigned numbers start here: every number below it is history (allocator or hand-numbered). */
export const SELF_ASSIGNED_ERA = 10000;

type Files = readonly { readonly path: string; readonly text: string }[];

/**
 * Self-assigned numbers (n >= SELF_ASSIGNED_ERA) defined with two different subjects. Identical
 * subjects in any number of paths or lines are one deviation: a spec mirroring its plan, a plan
 * repeating its own entry, a file renamed or moved on the branch. A branch copy is read only when the
 * branch changed that path since the merge base (`changed`), and a base copy only when it did not: so
 * rewording a merged entry, or fixing a collision the base carries, is not a collision, main's later
 * addition to a file the branch never touched still counts, and a file main moved or reworded after
 * the merge base is not read again from the branch's untouched, stale copy. A base path the branch
 * lacks counts when main added it after the merge base; one the branch deleted or renamed away is in
 * `changed` (the caller lists renames off) and is absent. Two branches adding
 * one number to the SAME file are seen only on the merged tree (the queue). `files` lists each
 * defining path once, sorted. Pure, like `crossTreeCollisions`; the caller measures `changed`.
 */
export function selfAssignedCollisions(branch: Files, base: Files, changed: ReadonlySet<string>): CrossTreeCollision[] {
  const defs = definitionLines([
    // A path the branch did not change holds the merge base's text, which the base's current copy supersedes
    // (main may since have moved, reworded or deleted it).
    ...branch.filter((f) => changed.has(f.path)),
    // A path the branch changed (deleted or renamed away included; the caller lists renames off) is the branch's view.
    ...base.filter((f) => !changed.has(f.path)),
  ]);
  const byN = new Map<number, { subjects: Set<string>; files: Set<string> }>();
  for (const d of defs) {
    if (d.n < SELF_ASSIGNED_ERA) continue;
    const e = byN.get(d.n) ?? { subjects: new Set<string>(), files: new Set<string>() };
    e.subjects.add(d.subject);
    e.files.add(d.file);
    byN.set(d.n, e);
  }
  return [...byN.entries()]
    .filter(([, e]) => e.subjects.size > 1)
    .map(([n, e]) => ({ n, files: [...e.files].sort() }))
    .sort((a, b) => a.n - b.n);
}

/**
 * The next `count` deviation numbers: one past the highest definition at or above the era, or the era
 * itself when there is none. Pure; the caller reads the tree (`scripts/next-deviation.ts`).
 */
export function nextDeviationNumbers(defs: readonly Definition[], count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > LEDGER_ALLOC_MAX) {
    throw new RangeError(`count must be an integer 1..${LEDGER_ALLOC_MAX}, got ${count}`);
  }
  const top = defs.reduce((m, d) => (d.n >= SELF_ASSIGNED_ERA && d.n > m ? d.n : m), SELF_ASSIGNED_ERA - 1);
  return Array.from({ length: count }, (_, i) => top + 1 + i);
}
