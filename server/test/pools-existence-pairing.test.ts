// D-1848 — a bare `-e` on a pools path is a defect, not a style choice, and
// this scan is the mechanism that refuses it rather than the ledger entry
// that merely says so.
//
// THE DISTINCTION THIS GUARDS. A project on the fleet box can carry a pool
// tag at `$POOLS_DIR/<project>` (`~/.cc-sessions/pools/<project>`), and that
// tag constrains which accounts may serve it. Two answers to "is this
// project tagged?" are NOT interchangeable:
//   - ABSENT (no tag file, no `pools/` directory at all) -> the project is
//     UNCONSTRAINED; work may be placed anywhere.
//   - PRESENT BUT UNRESOLVABLE (a dangling symlink, a symlink loop, an
//     unsearchable parent directory) -> NOBODY KNOWS, and placement must
//     REFUSE.
// In bash, `[ -e "$path" ]` is FALSE for both a dangling symlink and a
// symlink loop — it cannot tell "nothing here" from "something here that
// cannot be resolved". Reading "not -e" as absence silently LIFTS a
// placement constraint: the exact inversion of the safe default.
//
// THE THREE SITES. In one wave, three different authors made this identical
// mistake independently:
//   1. `ccd/ccd`'s reader `_project_pool_state` folded `unreadable` into
//      `untagged` (D-1744).
//   2. `ccd/ccd`'s writer `cmd_project_pool --clear` skipped its unlink and
//      reported `untagged` while the tag survived (D-1847).
//   3. `ccd/ccrc-doctor-checks`'s `_check_pools` dropped the entry before
//      every bucket, so a dangling `pools/` made the doctor print
//      `PASS pools: … every project is unconstrained` on a box where the
//      reader answered `unreadable` for EVERY project — the exact inverse of
//      the truth, in the tool an operator consults when nothing else works.
// Each fix paired the bare `-e` with `-L` (which IS true for a dangling
// symlink or a loop, `-e`'s blind spot exactly). `cmd_project_pool --clear`
// went one step further in a later round: rather than re-testing the
// filesystem at all, it now DECIDES from `_project_pool_state`'s own answer
// (the box's one authority on this question) and never runs a fresh `-e` on
// a pools path in that function. Both fixes are valid; a fresh, unpaired
// `-e` is not.
//
// THE RULE (D-1848): a bare `-e` may only be used where "absent" and
// "present but unresolvable" are handled IDENTICALLY. On a pools path they
// never are here, so every `-e` test whose subject is a pools path must
// either be paired with `-L` on the same subject (same line or the line
// immediately before/after, in either order), or sit inside a function that
// locally decides via a real call to `_project_pool_state` instead of
// trusting its own fresh test.
//
// WHAT "PAIRED WITH -L" MEANS HERE, MECHANICALLY. This scan does not parse
// bash; it looks for test EXPRESSIONS (`[[ … ]]` / `[ … ]`) and, inside
// them, `-e SUBJECT`. A SUBJECT qualifies as a "pools path" if it is
// `$POOLS_DIR` itself, a variable this scan can show (by a real assignment
// or a `for … in "$SUBJECT"/*` loop, discovered per enclosing function) was
// derived from `$POOLS_DIR` or from a literal `pools` path segment, or a
// literal argument that itself contains a `/pools/`-shaped segment. Once a
// subject qualifies, the scan requires either a `-L` test on the identical
// subject within one line, or a real (non-comment) call to
// `_project_pool_state` within a few lines of the same function — mirroring
// `cmd_project_pool --clear`'s "ask the one authority instead" escape hatch.
//
// IF THIS SCAN FIRES ON YOUR CHANGE: first check whether your new `-e` is
// actually testing a pools path at all — if it is some unrelated file (a
// `.project` registry row, a lock file, a log), the fix is to make the
// subject less pools-shaped in this scan's eyes only by NOT deriving it from
// `$POOLS_DIR`/a `pools` literal in a way this scan's textual heuristic
// picks up — but that should never be necessary for a genuinely unrelated
// path since the scan's own variable-discovery only adds a name when the
// file's own text ties it to `$POOLS_DIR` or a `pools` segment. If it IS a
// pools path, pair the `-e` with `-L` on the same subject, or route the
// decision through `_project_pool_state` (in `ccd/ccd`) the way
// `cmd_project_pool --clear` does, rather than re-testing the filesystem.
// `ccd/ccrc-doctor-checks` has no `_project_pool_state` to defer to (it is
// sourced standalone, under `set -u`, by things that are not `ccrc` — see
// `pool-name-parity.test.ts`'s header) — every existence test there must be
// paired with `-L` directly; there is no reader to defer to.
//
// SCOPE, DELIBERATELY: this scan is per top-level function (a function
// starting at column 0 as `name() {` and closing at a bare `}` line — the
// house style both files use throughout), not whole-file, so a variable
// named `f` or `dir` in one function can never be confused with a
// similarly-named, unrelated variable in another. The `-L`-pairing window is
// one line either side, matching every fixed site; the
// `_project_pool_state`-defers-here window is a few lines, not the whole
// function — `cmd_project_pool` legitimately calls `_project_pool_state`
// near its top and again near its bottom for reasons that have nothing to
// do with any OTHER existence test that function might grow, and a
// whole-function exemption would let one incidental call license an
// unrelated bare `-e` anywhere in a 200-line function. That would make the
// escape hatch swallow the very regression it exists to distinguish from a
// legitimate defer, so this scan requires the call to sit close to the test
// it is meant to excuse.
//
// GUARD THE GUARD. A regex that matches nothing passes everything, and this
// wave has already shipped several guards that measured no actual effect —
// see `docs/superpowers/plans/…tests-pin-shape-not-effect…`-style lessons
// elsewhere in this project's history. So this file asserts a FLOOR on how
// many qualifying pools-path existence tests it finds in each real file
// (today: exactly two per file, the two guards each of the three fixed
// sites left behind — `cmd_project_pool` itself now contributes none, having
// moved to the defer-to-reader shape), and carries its own synthetic-fixture
// tests proving the extraction logic actually flags an unpaired case, actually
// accepts a paired one, and actually returns zero hits on source that touches
// no pools path at all — so a floor of "at least 2" is a real measurement, not
// a number nothing could ever fail to clear.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const CCD_PATH = path.join(ccrcRoot, 'ccd', 'ccd');
const DOCTOR_PATH = path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks');

// ---------------------------------------------------------------------------
// Scanning machinery. Pure text/regex, no bash parser — matching this
// repo's `pool-name-parity.test.ts` precedent for extracting facts from
// shell source.
// ---------------------------------------------------------------------------

interface FuncBlock {
  name: string;
  /** 0-based index into the file's `lines` array of the `name() {` line. */
  startLine: number;
  /** 0-based index of the matching bare `}` line. */
  endLine: number;
  /** `lines[startLine..endLine]`, i.e. `lines[i]` here is file line `startLine + i`. */
  lines: string[];
}

const isCommentLine = (line: string): boolean => /^\s*#/.test(line);

/** Neutralise quoted-string contents and `${...}` parameter expansions on a
 *  fragment, so a brace-balance check afterwards sees only the shell's OWN
 *  structural braces — not a `}` that happens to close `"${1-}"` or to sit
 *  inside a quoted or backtick-free prose comment. Applied before the
 *  one-liner check below; without it, `_lc_intent() { local a="${1-}" … `
 *  (a genuine multi-line function) reads as closed by the `}` inside its own
 *  `${1-}`, and a header comment like `_gh_pr_checks() {   # … `[{number,
 *  statusCheckRollup}, …]` … ` reads as closed by the `}` in its own prose. */
function stripStringsAndExpansions(s: string): string {
  let r = s.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
  for (let k = 0; k < 3; k++) r = r.replace(/\$\{[^{}]*\}/g, '');
  return r;
}

/** True iff the `{` that opens a `name() {` line is closed on THAT SAME
 *  line — a one-liner function (`die() { echo "…" >&2; exit 1; }`, common in
 *  both files) rather than a multi-line one whose body starts on the next
 *  line. `afterIdx` is the index in `line` right after the matched
 *  `name() {`. A trailing `# comment` (found on the code with strings/`${}`
 *  already neutralised, so a quoted `#` never counts) is stripped before
 *  looking for the closing `}`, so a genuine multi-line function whose
 *  HEADER COMMENT happens to contain a `}` (`_ws_clip_manifest() {   # …
 *  JSON array of {name,bytes}… `) is never mistaken for a one-liner. */
function closesInline(line: string, afterIdx: number): boolean {
  let rest = stripStringsAndExpansions(line.slice(afterIdx));
  const cm = /(^|\s)#/.exec(rest);
  if (cm) rest = rest.slice(0, cm.index + (cm[1] ? cm[1].length : 0));
  return rest.includes('}');
}

/** Top-level functions only: `name() {` at column 0. A one-liner (see
 *  `closesInline`) is its own single-line block; anything else is closed by
 *  a bare `}` at column 0 — the shape every MULTI-LINE function in both
 *  files uses (measured). A multi-line function whose close cannot be found
 *  is skipped rather than guessed at.
 *
 *  GETTING THIS WRONG IS NOT COSMETIC: an early version of this scan treated
 *  every `name() { … }` line as a block START regardless of whether it
 *  closed inline, so `_lane_enabled() { … } # …` and `_pool_name_valid() {
 *  … } # …` (two one-liners sitting right before `_project_pool_state`) each
 *  searched forward for the next bare `}` and found `_project_pool_state`'s
 *  OWN closing brace — three overlapping "blocks" all containing that one
 *  function's body, and every real violation reported three times over. */
function findFunctionBlocks(lines: string[]): FuncBlock[] {
  const blocks: FuncBlock[] = [];
  const startRe = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/;
  for (let i = 0; i < lines.length; i++) {
    const m = startRe.exec(lines[i]!);
    if (!m) continue;
    if (closesInline(lines[i]!, m[0].length)) {
      blocks.push({ name: m[1]!, startLine: i, endLine: i, lines: [lines[i]!] });
      continue;
    }
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\}\s*$/.test(lines[j]!)) { end = j; break; }
    }
    if (end === -1) continue;
    blocks.push({ name: m[1]!, startLine: i, endLine: end, lines: lines.slice(i, end + 1) });
  }
  return blocks;
}

// A subject is "pools-shaped" either by name (a variable this scan can trace
// back to `$POOLS_DIR` or a literal `pools` path segment) or by content (a
// literal argument that itself contains a `/pools/`-shaped segment). Matched
// case-sensitively and segment-bounded so prose like "project pools" or a
// capability string like "pools-v1" does not count — only an actual path
// component does.
const POOLS_TOKEN_RE = /\bPOOLS_DIR\b/;
const POOLS_SEGMENT_RE = /(^|[/"'])pools(?=[/"']|$)/;

function isPoolsRelevantBlock(block: FuncBlock): boolean {
  return block.lines.some(
    (l) => !isCommentLine(l) && (POOLS_TOKEN_RE.test(l) || POOLS_SEGMENT_RE.test(l)),
  );
}

/** Variables, LOCAL TO ONE FUNCTION BLOCK, this scan can show are bound to a
 *  pools path: seeded with `POOLS_DIR` itself, then grown by two textual
 *  passes — direct assignment (`NAME=VALUE`, any number of such tokens on one
 *  `local`/`declare`/bare line) whose value mentions `POOLS_DIR` or a `pools`
 *  segment, and `for VAR in "$SUBJECT"/*` where SUBJECT is already known. */
function discoverPoolsVars(block: FuncBlock): Set<string> {
  const vars = new Set<string>(['POOLS_DIR']);
  const assignRe = /([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|'[^']*'|\S*)/g;
  for (const raw of block.lines) {
    if (isCommentLine(raw)) continue;
    assignRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = assignRe.exec(raw))) {
      const [, name, val] = m;
      if (POOLS_TOKEN_RE.test(val!) || POOLS_SEGMENT_RE.test(val!)) vars.add(name!);
    }
  }
  const forRe = /for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"\//g;
  for (const raw of block.lines) {
    if (isCommentLine(raw)) continue;
    forRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = forRe.exec(raw))) {
      const [, loopVar, subject] = m;
      if (vars.has(subject!)) vars.add(loopVar!);
    }
  }
  return vars;
}

interface RawHit {
  blockLineIdx: number;
  fileLine: number; // 1-based
  text: string;
  subject: string;
  isLiteral: boolean;
}

function classifySubject(
  arg: string,
  poolsVars: Set<string>,
): { subject: string; isLiteral: boolean } | null {
  if (POOLS_SEGMENT_RE.test(arg)) return { subject: arg, isLiteral: true };
  const vm = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?(?:\/.*)?$/.exec(arg);
  if (vm) {
    const name = vm[1]!;
    if (name === 'POOLS_DIR' || poolsVars.has(name)) return { subject: name, isLiteral: false };
  }
  return null;
}

// Existence tests are only meaningful INSIDE a test expression — matching
// `-e` as a bare token anywhere on a line would also catch `echo -e`, an
// entirely different thing (an echo flag, not a file test). So this scans
// `[[ … ]]` / `[ … ]` regions first (no nesting support beyond what both
// files actually use — measured: every pools-path test in both files is a
// single-line, non-nested bracket) and only looks for `-e ARG` within them.
const BRACKET_RE = /\[\[.*?\]\]|\[[^[\]]*\]/g;
const E_ARG_RE = /-e\s+("[^"]*"|'[^']*'|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?(?:\/\S*)?)/g;

function findExistenceHits(block: FuncBlock, poolsVars: Set<string>): RawHit[] {
  const hits: RawHit[] = [];
  block.lines.forEach((raw, idx) => {
    if (isCommentLine(raw)) return;
    BRACKET_RE.lastIndex = 0;
    let bm: RegExpExecArray | null;
    while ((bm = BRACKET_RE.exec(raw))) {
      const bracketText = bm[0];
      E_ARG_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = E_ARG_RE.exec(bracketText))) {
        const arg = m[1]!.replace(/^["']|["']$/g, '');
        const cls = classifySubject(arg, poolsVars);
        if (!cls) continue;
        hits.push({
          blockLineIdx: idx,
          fileLine: block.startLine + idx + 1,
          text: raw.trim(),
          subject: cls.subject,
          isLiteral: cls.isLiteral,
        });
      }
    }
  });
  return hits;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `-L` on the IDENTICAL subject, same line or one line either side — the
 *  shape every one of the three fixed sites actually uses. */
function hasNearbyL(block: FuncBlock, hit: RawHit): boolean {
  const lRe = hit.isLiteral
    ? new RegExp(`-L\\s+["']?${escapeRe(hit.subject)}["']?`)
    : new RegExp(`-L\\s+"?\\$\\{?${escapeRe(hit.subject)}\\}?`);
  for (const idx of [hit.blockLineIdx - 1, hit.blockLineIdx, hit.blockLineIdx + 1]) {
    if (idx < 0 || idx >= block.lines.length) continue;
    const line = block.lines[idx]!;
    if (isCommentLine(line)) continue;
    if (lRe.test(line)) return true;
  }
  return false;
}

const READER_CALL_RE = /_project_pool_state\b/;
// A window, not the whole function: see the "SCOPE, DELIBERATELY" note in
// this file's header comment for why whole-function would make the escape
// hatch swallow the regression it exists to distinguish from a real defer.
const EXEMPTION_WINDOW = 5;

function isExemptViaReader(block: FuncBlock, hit: RawHit): boolean {
  const lo = Math.max(0, hit.blockLineIdx - EXEMPTION_WINDOW);
  const hi = Math.min(block.lines.length - 1, hit.blockLineIdx + EXEMPTION_WINDOW);
  for (let idx = lo; idx <= hi; idx++) {
    if (idx === 0) continue; // the function's own `name() {` declaration line
    const line = block.lines[idx]!;
    if (isCommentLine(line)) continue;
    if (READER_CALL_RE.test(line)) return true;
  }
  return false;
}

interface Violation {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function scanSource(src: string, fileLabel: string): { hits: RawHit[]; violations: Violation[] } {
  const lines = src.split('\n');
  const blocks = findFunctionBlocks(lines);
  const hits: RawHit[] = [];
  const violations: Violation[] = [];
  for (const block of blocks) {
    if (!isPoolsRelevantBlock(block)) continue;
    const poolsVars = discoverPoolsVars(block);
    for (const hit of findExistenceHits(block, poolsVars)) {
      hits.push(hit);
      if (hasNearbyL(block, hit)) continue;
      if (isExemptViaReader(block, hit)) continue;
      violations.push({
        file: fileLabel,
        line: hit.fileLine,
        text: hit.text,
        reason: `-e on pools subject '${hit.subject}' has no adjacent -L and no nearby _project_pool_state call to defer to (D-1848)`,
      });
    }
  }
  return { hits, violations };
}

function scanFile(filePath: string, fileLabel: string): { hits: RawHit[]; violations: Violation[] } {
  return scanSource(readFileSync(filePath, 'utf8'), fileLabel);
}

// ---------------------------------------------------------------------------
// The guard itself, against the real files.
// ---------------------------------------------------------------------------

describe('D-1848: a pools-path existence test must pair -e with -L, or defer to _project_pool_state', () => {
  const ccdResult = scanFile(CCD_PATH, 'ccd/ccd');
  const doctorResult = scanFile(DOCTOR_PATH, 'ccd/ccrc-doctor-checks');

  it('guards the guard: found at least 2 qualifying pools existence tests in ccd/ccd', () => {
    expect(
      ccdResult.hits.length,
      'the extraction matched zero pools-path existence tests in ccd/ccd — it is not measuring anything',
    ).toBeGreaterThanOrEqual(2);
  });

  it('guards the guard: found at least 2 qualifying pools existence tests in ccrc-doctor-checks', () => {
    expect(
      doctorResult.hits.length,
      'the extraction matched zero pools-path existence tests in ccrc-doctor-checks — it is not measuring anything',
    ).toBeGreaterThanOrEqual(2);
  });

  it('ccd/ccd: every pools-path -e is paired with -L or deferred to _project_pool_state', () => {
    const msg = ccdResult.violations
      .map((v) => `${v.file}:${v.line}: ${v.text}\n    -> ${v.reason}`)
      .join('\n');
    expect(ccdResult.violations, msg).toEqual([]);
  });

  it('ccrc-doctor-checks: every pools-path -e is paired with -L or deferred to _project_pool_state', () => {
    const msg = doctorResult.violations
      .map((v) => `${v.file}:${v.line}: ${v.text}\n    -> ${v.reason}`)
      .join('\n');
    expect(doctorResult.violations, msg).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Guard-the-guard: the extraction logic itself, on synthetic fixtures. No
// real account, pool, label, host or IP name — fixture names only. These
// prove the detector actually flags what it should, accepts what it should,
// and returns zero on source that never touches a pools path — so the floor
// assertions above are measuring something, not passing vacuously.
// ---------------------------------------------------------------------------

describe('D-1848 guard-the-guard: detector behaviour on synthetic fixtures', () => {
  it('flags a bare -e on a variable this scan can trace back to $POOLS_DIR', () => {
    const src = [
      '_fixture_reader() {',
      '  local f="$POOLS_DIR/$1"',
      '  if [[ ! -e "$f" ]]; then',
      '    echo untagged',
      '  fi',
      '}',
    ].join('\n');
    const { violations } = scanSource(src, 'fixture');
    expect(violations.length).toBe(1);
    expect(violations[0]!.text).toContain('-e "$f"');
  });

  it('accepts -e paired with -L on the same line', () => {
    const src = [
      '_fixture_reader() {',
      '  local f="$POOLS_DIR/$1"',
      '  [ -e "$f" ] || [ -L "$f" ] || continue',
      '}',
    ].join('\n');
    const { violations, hits } = scanSource(src, 'fixture');
    expect(hits.length).toBe(1);
    expect(violations).toEqual([]);
  });

  it('accepts -e paired with -L on the line immediately after', () => {
    const src = [
      '_fixture_reader() {',
      '  if [[ ! -e "$POOLS_DIR" ]]; then',
      '    [[ -L "$POOLS_DIR" ]] && { echo unreadable; return 0; }',
      '    echo untagged; return 0',
      '  fi',
      '}',
    ].join('\n');
    expect(scanSource(src, 'fixture').violations).toEqual([]);
  });

  it('accepts a bare -e that sits close to a real _project_pool_state call (deferred decision)', () => {
    const src = [
      'cmd_fixture_clear() {',
      '  local oldstate; oldstate=$(_project_pool_state "$1")',
      '  if [[ -e "$POOLS_DIR/$1" ]]; then',
      '    rm -f -- "$POOLS_DIR/$1"',
      '  fi',
      '}',
    ].join('\n');
    expect(scanSource(src, 'fixture').violations).toEqual([]);
  });

  it('still flags a bare -e far away (>5 lines) from the _project_pool_state call in the same function', () => {
    const filler = Array.from({ length: 20 }, (_, i) => `  : filler line ${i}`);
    const src = [
      'cmd_fixture_clear() {',
      '  local oldstate; oldstate=$(_project_pool_state "$1")',
      ...filler,
      '  if [[ -e "$POOLS_DIR/$1" ]]; then',
      '    rm -f -- "$POOLS_DIR/$1"',
      '  fi',
      '}',
    ].join('\n');
    const { violations } = scanSource(src, 'fixture');
    expect(violations.length).toBe(1);
  });

  it('never mistakes echo -e for a file-existence test', () => {
    const src = [
      '_fixture_message() {',
      '  local dir="$HOME/.cc-sessions/pools"',
      '  echo -e "no pools/ tag directory at $dir\\n"',
      '}',
    ].join('\n');
    const { hits, violations } = scanSource(src, 'fixture');
    expect(hits.length).toBe(0);
    expect(violations).toEqual([]);
  });

  it('does not flag -e on an unrelated variable even inside a pools-relevant function', () => {
    const src = [
      '_fixture_mixed() {',
      '  local dir="$HOME/.cc-sessions/pools" reg="$HOME/.cc-sessions"',
      '  for rf in "$reg"/*.project; do',
      '    [ -e "$rf" ] && [ -f "$rf" ] || continue',
      '  done',
      '}',
    ].join('\n');
    const { hits, violations } = scanSource(src, 'fixture');
    expect(hits.length).toBe(0);
    expect(violations).toEqual([]);
  });

  it('measures zero on source with no pools-relevant function at all', () => {
    const src = [
      '_fixture_unrelated() {',
      '  local x="$HOME/somewhere"',
      '  [ -e "$x" ] || return 1',
      '}',
    ].join('\n');
    expect(scanSource(src, 'fixture').hits.length).toBe(0);
  });
});
