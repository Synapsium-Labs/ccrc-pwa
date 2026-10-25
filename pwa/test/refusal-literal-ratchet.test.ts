// ARCH-13b (#557): the literal refusal-branch RATCHET. A branch that reads a refusal code off a failed call and
// compares it to a string literal (`err.message === 'stale-dialog'`, `body.error === 'draft-present'`) is a second
// spelling of a code that has a union and, now, a text table. The count may only SHRINK: a new branch is read through
// `refusalText` against a `Record<Union, string>`; a removed one lowers LITERAL_BRANCHES_PINNED in the same commit.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The count on the day this landed, every spelling counted (`.error`/`.message`/`.code`, a bare `code`, `!==`, any quote,
 * either operand order, a literal array's `.includes`, a `case`). Lower it when a branch goes; raising it needs the operator's ruling. */
const LITERAL_BRANCHES_PINNED = 32;

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const KEBAB = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
/** A kebab literal in any quote: single, double, or a backtick with no `${`. */
const LIT = `(?:'${KEBAB}'|"${KEBAB}"|\`${KEBAB}\`)`;
/** A refusal-code name: `.message`/`.error`/`.code` (any receiver) or a bare `code`. */
const CODE = `(?:[\\w$.?]*\\.(?:message|error|code)|\\bcode)(?![\\w$])`;
/** `CODE === LIT` or `!==`, either way round; or a literal array's `.includes(CODE)` (one branch per array). Two shapes
 * still go uncounted: an alias (`const m = err.message; if (m === 'x')`) and a `case` whose brace depth a `{`/`}` inside
 * a string shifts. Both are documented by the self-test below; the AST walker is the follow-up that closes them. */
const BRANCH = new RegExp(
  `${CODE}\\s*[!=]==\\s*${LIT}|${LIT}\\s*[!=]==\\s*${CODE}|\\[\\s*${LIT}(?:\\s*,\\s*${LIT})*\\s*,?\\s*\\]\\s*\\.includes\\(\\s*${CODE}\\s*\\)`,
  'g');
/** A `case '<kebab>':` counts only inside a `switch` on one of those names. */
const CASE = new RegExp(`^\\s*case\\s+(['"])${KEBAB}\\1\\s*:`);
const SWITCH_ON_CODE = /\bswitch\s*\(\s*(?:[\w$.?]*\.(?:message|error|code)|code)\s*\)/;
/** A type test (`typeof x === 'string'`) is not a refusal code: it comes off the line before the match. */
const TYPEOF = /typeof\s+[\w.$]+\s*[!=]==\s*(['"])[a-z]+\1/g;

/** How many `===`/`!==` literal branches one line holds (comments and `typeof` tests excluded). */
function branchesIn(line: string): number {
  return /^\s*(?:\/\/|\*|\/\*)/.test(line) ? 0 : (line.replace(TYPEOF, '').match(BRANCH) ?? []).length;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
}

/** Every literal branch in one file's lines: comparisons, plus `case`s of a switch on a refusal-code name. */
function branchesOf(lines: readonly string[]): number[] {
  const hits: number[] = [];
  let depth = 0;
  let switchDepth: number | null = null;
  lines.forEach((line, i) => {
    for (let n = branchesIn(line); n > 0; n--) hits.push(i + 1);
    if (switchDepth !== null && CASE.test(line)) hits.push(i + 1);
    if (switchDepth === null && SWITCH_ON_CODE.test(line)) switchDepth = depth;
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (switchDepth !== null && depth <= switchDepth) switchDepth = null; }
    }
  });
  return hits;
}

/** Every literal branch in non-test source, one entry per match (`file:line`). */
function literalBranches(files: readonly string[] = sources(SRC)): string[] {
  return files.flatMap((f) => branchesOf(readFileSync(f, 'utf8').split('\n')).map((n) => `${path.relative(SRC, f)}:${n}`));
}

describe('the literal refusal-branch ratchet (ARCH-13b)', () => {
  it('the matcher counts a literal branch and skips a comment, a typeof test and a non-kebab word', () => {
    expect(branchesIn("if (err.message === 'stale-dialog') return;")).toBe(1);
    expect(branchesIn("if (b.error === 'held') return;")).toBe(1);
    expect(branchesIn("if (code === 'brand-new-word') return;")).toBe(1);
    expect(branchesIn("if (code !== 'no-claimant') return;")).toBe(1);
    expect(branchesIn('if (b.error === "double-quoted") return;')).toBe(1);
    expect(branchesOf(['switch (e.message) {', "  case 'unknown-run':", "  case 'x-y': return 1;", '}'])).toEqual([2, 3]);
    expect(branchesOf(['switch (kind) {', "  case 'unknown-run':", '}'])).toEqual([]);
    expect(branchesIn("if (typeof code === 'string' && e.error === 'another-new-word') return;")).toBe(1);
    expect(branchesIn("a.error === 'one-x' || a.error === 'two-y'")).toBe(2);
    expect(branchesIn("if (typeof code === 'string') return;")).toBe(0);
    expect(branchesIn("// if (code === 'in-a-comment') return;")).toBe(0);
    expect(branchesIn("if (x.message === someConst) return;")).toBe(0);
    expect(branchesIn("if (x.message === 'Has Spaces') return;")).toBe(0);
    expect(branchesIn("if (err.message === `back-tick`) return;")).toBe(1);
    expect(branchesIn("if ('literal-first' === err.message) return;")).toBe(1);
    expect(branchesIn("if ('literal-first' !== code) return;")).toBe(1);
    expect(branchesIn("if (['one-x', \"two-y\"].includes(err.message)) return;")).toBe(1);
    expect(branchesIn("if (x.messageText === 'not-a-code') return;")).toBe(0);
    expect(branchesIn("if ('not-a-code' === x.messageText) return;")).toBe(0);
    expect(branchesIn("if (err.message === `has-${slot}`) return;")).toBe(0);
    expect(branchesIn("if ((KNOWN as readonly string[]).includes(code)) return;")).toBe(0);
    // Known escape, kept visible: an alias of the code is not followed (the AST walker would close it).
    expect(branchesOf(['const m = err.message;', "if (m === 'aliased-code') return;"])).toEqual([]);
  });

  it(`there are no more than ${LITERAL_BRANCHES_PINNED} of them, and the pin is the count`, () => {
    const found = literalBranches();
    expect(found.length, `a new literal refusal branch: read it through refusalText.\n${found.join('\n')}`)
      .toBeLessThanOrEqual(LITERAL_BRANCHES_PINNED);
    expect(found.length, 'a branch went: lower LITERAL_BRANCHES_PINNED to the new count').toBe(LITERAL_BRANCHES_PINNED);
  });
});
