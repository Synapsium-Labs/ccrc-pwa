// ARCH-13b (#557): the literal refusal-branch RATCHET. A branch that reads a refusal code off a failed call and
// compares it to a string literal (`err.message === 'stale-dialog'`, `body.error === 'draft-present'`) is a second
// spelling of a code that has a union and, now, a text table. The count may only SHRINK: a new branch is read through
// `refusalText` against a `Record<Union, string>`; a removed one lowers LITERAL_BRANCHES_PINNED in the same commit.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The count on the day this landed. Lower it when a branch goes; raising it needs the operator's ruling. */
const LITERAL_BRANCHES_PINNED = 14;

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const BRANCH = /\.(?:message|error)\s*===\s*'[a-z][a-z0-9]*(?:-[a-z0-9]+)*'/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
}

/** Every line of non-test source that compares a property named `message` or `error` to a kebab-case literal. */
function literalBranches(files: readonly string[] = sources(SRC)): string[] {
  return files.flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((line, i) =>
    !/^\s*(?:\/\/|\*|\/\*)/.test(line) && !line.includes('typeof') && BRANCH.test(line)
      ? [`${path.relative(SRC, f)}:${i + 1}`] : []));
}

describe('the literal refusal-branch ratchet (ARCH-13b)', () => {
  it('the matcher counts a literal branch and skips a comment, a typeof test and a non-kebab word', () => {
    expect(BRANCH.test("if (err.message === 'stale-dialog') return;")).toBe(true);
    expect(BRANCH.test("if (b.error === 'held') return;")).toBe(true);
    expect(BRANCH.test("if (x.message === someConst) return;")).toBe(false);
    expect(BRANCH.test("if (x.message === 'Has Spaces') return;")).toBe(false);
  });

  it(`there are no more than ${LITERAL_BRANCHES_PINNED} of them, and the pin is the count`, () => {
    const found = literalBranches();
    expect(found.length, `a new literal refusal branch: read it through refusalText.\n${found.join('\n')}`)
      .toBeLessThanOrEqual(LITERAL_BRANCHES_PINNED);
    expect(found.length, 'a branch went: lower LITERAL_BRANCHES_PINNED to the new count').toBe(LITERAL_BRANCHES_PINNED);
  });
});
