# Overlord W1a: the skill-size ratchet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One test that caps every shipped skill file in bytes, where a cap only falls, except by a pinned clause's
bytes in the pull request that adds the clause.

**Why:** Claude Code restores a skill after a compaction only within 5k tokens each and 25k in all, dropping the
oldest first. The coordinator skill has grown without bound: its `SKILL.md` is 55,305 bytes at `681cea9a1` and its
`references/wave-lifecycle.md` is 151,073. Nothing in the tree stops either from growing further. It lands in W1a,
before the recall clause, so the first clause the Overlord programme adds is the first one the ratchet prices.

**Architecture:** One test file and one JSON caps file, both under `server/test/`. Pure functions (`readCaps`,
`contractClauses`, `clauseAllowance`, `judge`) decide; thin tree rows measure the working tree and the merge-base
with `origin/main` through `server/test/mergeBase.ts`. The raise is read from the `SKILL.md` diff itself, so nothing
extra is recorded to claim it. Both files are test files: the ring table covers `server/src` and `pwa/src` only, so
they have no ring, and the test imports nothing from `server/src`. No runtime list is added; the corpus is derived
from the tree by one regular expression.

**Tech Stack:** TypeScript, vitest 5, `node:child_process` (`git ls-files`, `git show`), the existing
`server/test/mergeBase.ts` helpers.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md`: §3.3.3 ("The skill stays small", the ratchet
sentences only; the 5,000-token bound on `ccrc-overlord` belongs to W1's skill), §9.7 ("A budget, and a ratchet",
the same sentence), §11.3 ("Small enough to survive a compaction", which defines the corpus, a clause's bytes and
growth against the merge-base), §11.4 ("Its size grows only by its clauses"), §11.7 (Table 11.7b, the row "The
skill-size ratchet, with caps measured at its merge") and §14 (the W1a row).

## What exists today

- **Shipped skills.** `ccd/ccrc#_inst_skills` copies five directories to every rostered home:
  `coordinator-skill`, `worker-skill`, `reviewer-skill`, `history-skill`, `linear-skill`. The graphify skill is
  assembled from a package, not from this tree, and is out of scope.
- **Their Markdown files and sizes at `681cea9a1`** (bytes; for orientation only, the caps are measured at merge):

| File | Bytes |
|---|---|
| `ccd/coordinator-skill/SKILL.md` | 55,305 |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | 151,073 |
| `ccd/coordinator-skill/references/routing-matrix.md` | 14,554 |
| `ccd/coordinator-skill/references/mail-envelope.md` | 11,987 |
| `ccd/coordinator-skill/references/resume.md` | 10,081 |
| `ccd/coordinator-skill/references/peer-protocol.md` | 8,207 |
| `ccd/coordinator-skill/references/review-panel.md` | 7,916 |
| `ccd/coordinator-skill/references/delegated-worktrees.md` | 1,819 |
| `ccd/coordinator-skill/references/ledger-template.md` | 1,746 |
| `ccd/coordinator-skill/references/review-brief.md` | 1,415 |
| `ccd/worker-skill/SKILL.md` | 33,348 |
| `ccd/reviewer-skill/SKILL.md` | 14,273 |
| `ccd/history-skill/SKILL.md` | 10,677 |
| `ccd/linear-skill/SKILL.md` | 10,841 |

  The two other tracked files under those directories are `references/mutation-run.py` (a script the coordinator
  runs) and `history-skill/LICENSE.lossless-claw`. Neither is skill text a model loads.
- **Clause pins.** `server/test/coordinator-skill.test.ts` (`CONTRACT`, twenty clauses), `worker-skill.test.ts`
  (nineteen) and `reviewer-skill.test.ts` (ten) each hold a non-exported literal array and check the `SKILL.md`
  numbers exactly `1..N` with no gaps (`/^(\d+)\. /gm`). Each clause is one line `N. <text>` inside the
  `## The contract` section; the coordinator test scopes its harvest to that section because `## The wave lifecycle`
  numbers steps of its own, and the worker and reviewer tests harvest the whole file. Clause 20 of the coordinator
  skill is 1,226 bytes with its newline. Each suite also derives a count word from `CONTRACT.length` and checks
  every place prose states it (the coordinator's `SKILL.md` says "These twenty sentences"; its `WORDS` array ends at
  `'twenty'`). `history-skill.test.ts` pins sentences, not numbered clauses (its `## 1. When to recall` headings are
  not numbered lines), and `ccd/linear-skill/SKILL.md` has no contract section and no pin suite.
- **Ratchets to mirror.** `server/test/shellcheck-ratchet.test.ts`: a JSON baseline
  (`server/test/shellcheck-baseline.json`), a pure `judge(pins, files, found)` returning `{failures, lowered}`, unit
  cases on `judge`, then tree rows, and `tell` writing lowered entries straight to stderr (there a stale entry is
  only a lowered line; here it is a failure, R1). `server/test/citations.test.ts`:
  a `<=` ceiling that warns when it can be lowered, plus an added-lines rule against the merge-base, which skips with a
  notice when there is no `origin/main`. It chose `<=` over an exact count because exact counts raced between
  parallel pull requests.
- **Merge-base helpers.** `server/test/mergeBase.ts`: `mergeBaseFiles(cwd, dir)` answers `{base, files, entries}`,
  or null when there is no `origin/main`, no merge-base or no readable listing; `treeEntriesAt(cwd, rev, dir)` answers
  `TreeEntry[]` (`mode`, `type`, `oid`, `path`, repo-relative) or null. (`mergeBaseText` folds "no merge-base" and
  "absent there" into one null, so this piece does not use it.) CI checks out with `fetch-depth: 0`, so `origin/main`
  is present in every server shard.
- **Fast-run selection.** `.github/ci/fast-plan.mjs#TREE_READER` makes a test a guard suite, run on every fast pull
  request, when its own source calls `git ls-files`, `git diff` or `git merge-base` directly, unless it is listed in
  `HEAVY_TREE_READERS`. `server/test/ci-fast-plan.test.ts` pins named guards ("carries topology-clean, oss-metadata,
  gitignore-secrets and consolidation-path-guard", inside the describe that builds `guards` with `guardTests`).
- **Does not exist today:** any size bound on a skill file, `server/test/skill-size-ratchet.test.ts`,
  `server/test/skill-size-caps.json`.

## Global Constraints

- Test-first: every case is written and seen red before the code it tests.
- One commit per task, on the workspace branch. Absorb `main` only by `git merge` (worker clause 16), never a rebase.
- Touch only the files a task names.
- Run suites from inside `server/`, in the foreground, with a timeout of at least 600000 ms:
  `./node_modules/.bin/vitest run test/<file>`. Never bare `npx vitest`. Typecheck with
  `./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`.
- Cite code by symbol (`file.ts#name`) or `#@anchor`, never by line, in comments and commit messages.
- Public repository: no private project, host, account or person names, no home paths. Fixtures use `ccd/x-skill/`.
- No D-numbers invented. The `D-TBD-<slug>` names below are replaced by issued numbers before anything lands
  (`server/test/dtbd.test.ts` reds on a concrete placeholder).
- This piece runs no `ccd`, no tmux and nothing against a live `$HOME`.

## Review Focus

1. **No `origin/main`** (a fresh clone, a shallow or detached checkout). R1 and R2 still judge; R3 to R5 skip with a
   printed notice, never a false red. Tests: Task 1 "without a merge-base only R1 and R2 run"; Task 2's merge-base row.
2. **A `SKILL.md` that gains its first numbered contract on this branch**, with no pin suite behind it (the history
   or linear skill). It earns nothing, or a clause nobody pinned could grow the file. Test: Task 1 "a contract new to
   a SKILL.md earns nothing".
3. **A clause with non-ASCII text.** It is priced in UTF-8 bytes, not characters. Test: Task 1 "is the bytes of each
   clause appended ...".
4. **Procedures moved out of a `SKILL.md` into a new reference**, which is how a skill shrinks. The `SKILL.md`
   shrinking is never a failure, and the new file starts at its own size (R3). Test: Task 1 "a split passes: the
   SKILL.md shrinks and the new reference starts at its size".
5. **A hand-edited caps file** with a value that is not a whole number of bytes, or with no `files` object. It reds
   naming the entry and never compares against `NaN`. Test: Task 1 "a caps file that is not whole bytes is refused".

## The rules (one place, for the reviewer)

Sizes are UTF-8 bytes of the file. `caps` is the caps file at HEAD; `base` is the merge-base with `origin/main`.

| # | Rule | Runs |
|---|---|---|
| R1 | Every skill file has a cap, and every cap names a skill file | always |
| R2 | Each file is at or under its cap. Under it, the test passes and prints the entry to lower | always |
| R3 | A cap the base's caps file does not hold must equal its file's size at HEAD | with a base |
| R4 | A cap the base holds may rise by at most the file's allowance | with a base |
| R5 | A file the base holds may grow by at most the file's allowance | with a base |

A file with a cap and no size, or a size and no cap, gets its R1 failure and no other rule. R4 and R5 apply only to
a file the base holds; a file new on this branch is held by R3 alone.

The allowance is 0 for every file except a `SKILL.md` present at both ends whose base text already has at least one
clause; there it is the summed bytes of the lines of its `## The contract` section numbered past the base's highest
clause, each line counted whole, number and newline included. A file missing from the allowance map has 0. R5 is
§11.3's "growth is measured against the merge base with `main`": it is what makes §11.7's "no skill file grows" true
when a cap carries slack nobody lowered.

How a cap is lowered: edit its number in `skill-size-caps.json` down to the size R2 prints. Optional, never forced,
for the reason `citations.test.ts` gives. How the one raise is expressed: the pull request that appends clause N+1
raises that `SKILL.md`'s cap by at most the bytes of that clause's line; R4 and R5 read the allowance from the
`SKILL.md` diff, and each pin suite's `1..N` check is what makes a numbered contract line a pinned clause. Only the
three `SKILL.md` files that already carry clauses have such a suite, which is why a first contract earns nothing.

## Tasks

### Task 1: The rules, as pure functions with unit cases

**Files:**
- Create: `server/test/skill-size-ratchet.test.ts` (the four functions and the three describes below)

**Interfaces:**
- Consumes: nothing from the tree.
- Produces (file-local, not exported, as `shellcheck-ratchet.test.ts` keeps its own):

```ts
type Caps = Record<string, number>;               // bytes, by repo-relative path
type Sizes = Record<string, number>;
/** What the merge-base holds. `caps: 'absent'`: no caps file there, so every cap is new. */
type Base = { caps: Caps | 'absent'; sizes: Sizes };
/** The `files` object of a caps file's text. Throws, naming the entry, on a value that is not a whole number >= 0,
 *  and on a missing or non-object `files`. A JSON parse error throws as it is. */
function readCaps(text: string): Caps;
/** The numbered one-line clauses of `## The contract`, by number; empty when there is no such section. */
function contractClauses(text: string): Map<number, string>;
/** Bytes `file` may grow by: see "The rules". `baseText` null: the file is new on this branch. */
function clauseAllowance(file: string, baseText: string | null, headText: string): number;
/** `base` null: no origin/main or merge-base, so R3 to R5 do not run. */
function judge(caps: Caps, sizes: Sizes, base: Base | null, allowance: Record<string, number>):
  { failures: string[]; lowered: string[] };
```

- [ ] **Step 1: Write the failing tests.**

```ts
const F = 'ccd/x-skill/SKILL.md';
const R = 'ccd/x-skill/references/r.md';
const line = (n: number, text: string): string => `${n}. ${text}\n`;
const doc = (...clauses: string[]): string =>
  `---\nname: x\n---\n## The contract\n\n${clauses.join('')}\n## Steps\n\n1. a step, not a clause\n`;
const one = line(1, 'One.');
const two = line(2, 'Two.');

describe('the clause allowance', () => {
  it('is the bytes of each clause appended past the base\'s last, number and newline included', () => {
    const added = line(3, 'Three, with a ’ curly apostrophe.');
    const a = clauseAllowance(F, doc(one, two), doc(one, two, added));
    expect(a).toBe(Buffer.byteLength(added));
    expect(a).toBe(added.length + 2); // the curly apostrophe is three bytes: bytes, not characters
  });
  it('a reworded clause earns nothing', () => {
    expect(clauseAllowance(F, doc(one, two), doc(one, line(2, 'Two, now much longer.')))).toBe(0);
  });
  it('a clause removed and another added at the same count earn nothing', () => {
    expect(clauseAllowance(F, doc(one, two), doc(one, line(2, 'Another.')))).toBe(0);
  });
  it('a numbered line outside the contract section earns nothing', () => {
    expect(clauseAllowance(F, doc(one), `${doc(one)}2. another step\n`)).toBe(0);
  });
  it('a reference file, and a SKILL.md new on this branch, earn nothing', () => {
    expect(clauseAllowance(R, doc(one), doc(one, two))).toBe(0);
    expect(clauseAllowance(F, null, doc(one, two))).toBe(0);
  });
  it('a contract new to a SKILL.md earns nothing: no pin suite stands behind its clauses yet', () => {
    expect(clauseAllowance(F, '---\nname: x\n---\nprose\n', doc(one, two))).toBe(0);
    expect(clauseAllowance(F, doc(), doc(one, two))).toBe(0);
  });
});

describe('the caps file', () => {
  it('a caps file that is not whole bytes is refused', () => {
    expect(readCaps(`{ "files": { "${F}": 90 } }`)).toEqual({ [F]: 90 });
    for (const bad of ['"90"', '90.5', '-1', 'null']) {
      expect(() => readCaps(`{ "files": { "${F}": ${bad} } }`)).toThrow(F);
    }
    expect(() => readCaps('{}')).toThrow('files');
  });
});

describe('the ratchet rules', () => {
  const at = (caps: Caps, sizes: Sizes): Base => ({ caps, sizes });
  it('a file at its cap passes silently', () => {
    expect(judge({ [F]: 100 }, { [F]: 100 }, null, {})).toEqual({ failures: [], lowered: [] });
  });
  it('a file over its cap fails and names both numbers', () => {
    const { failures } = judge({ [F]: 100 }, { [F]: 101 }, null, {});
    expect(failures).toEqual([expect.stringContaining(`${F}: 101 bytes, capped at 100`)]);
  });
  it('a file under its cap passes and prints the entry to lower', () => {
    expect(judge({ [F]: 100 }, { [F]: 90 }, null, {}))
      .toEqual({ failures: [], lowered: [expect.stringContaining(`"${F}": 90`)] });
  });
  it('every skill file has a cap, and every cap names a skill file', () => {
    expect(judge({}, { [F]: 1 }, null, {}).failures).toEqual([expect.stringContaining(`"${F}": 1`)]);
    expect(judge({ [F]: 1 }, {}, null, {}).failures).toEqual([expect.stringContaining('no longer a skill file')]);
  });
  it('a cap new on this branch must equal its file\'s measured size', () => {
    for (const base of [at({}, {}), { caps: 'absent' as const, sizes: {} }]) {
      expect(judge({ [F]: 100 }, { [F]: 90 }, base, {}).failures)
        .toEqual([expect.stringContaining('a new cap must be its file\'s size, 90')]);
      expect(judge({ [F]: 90 }, { [F]: 90 }, base, {}).failures).toEqual([]);
    }
  });
  it('a cap and its file may rise by the bytes of the clauses this branch adds, and not one byte more', () => {
    const base = at({ [F]: 100 }, { [F]: 100 });
    expect(judge({ [F]: 150 }, { [F]: 150 }, base, { [F]: 50 }).failures).toEqual([]);
    const { failures } = judge({ [F]: 151 }, { [F]: 151 }, base, { [F]: 50 });
    expect(failures).toHaveLength(2);
    expect(failures.join('\n')).toContain(`${F}: cap 151 rose past 100`);
    expect(failures.join('\n')).toContain(`${F}: grew by 51`);
  });
  it('a cap raised with no clause added fails, though the file did not grow', () => {
    expect(judge({ [F]: 120 }, { [F]: 100 }, at({ [F]: 100 }, { [F]: 100 }), {}).failures)
      .toEqual([expect.stringContaining('rose past 100')]);
  });
  it('a file that grows into slack under its cap fails: growth is measured against main, not the cap', () => {
    expect(judge({ [F]: 100 }, { [F]: 90 }, at({ [F]: 100 }, { [F]: 80 }), {}).failures)
      .toEqual([expect.stringContaining(`${F}: grew by 10`)]);
  });
  it('a reference earns nothing from its SKILL.md\'s clause', () => {
    expect(judge({ [R]: 110 }, { [R]: 110 }, at({ [R]: 100 }, { [R]: 100 }), { [F]: 50 }).failures)
      .toHaveLength(2);
  });
  it('a split passes: the SKILL.md shrinks and the new reference starts at its size', () => {
    expect(judge({ [F]: 60, [R]: 40 }, { [F]: 60, [R]: 40 }, at({ [F]: 100 }, { [F]: 100 }), {}))
      .toEqual({ failures: [], lowered: [] });
  });
  it('without a merge-base only R1 and R2 run', () => {
    expect(judge({ [F]: 120 }, { [F]: 100 }, null, {}).failures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and expect a failure.**
  `cd server && ./node_modules/.bin/vitest run test/skill-size-ratchet.test.ts`. Expected: every case fails with
  `ReferenceError` (`readCaps`, `contractClauses`, `clauseAllowance` and `judge` are not defined).
- [ ] **Step 3: Implement.** In the same file, the four functions with the signatures above.
  - `readCaps`: `JSON.parse`, then `files` must be a plain object and every value `Number.isInteger(v) && v >= 0`;
    otherwise throw `<file>: <JSON of the value> is not a whole number of bytes`, or `no "files" object`.
  - `contractClauses`: slice from `## The contract` to the next `\n## `, then `/^(\d+)\. .*$/gm`, keyed by number,
    value the whole line without its newline. The coordinator test's own harvest is the model.
  - `clauseAllowance`: 0 unless `file` ends `/SKILL.md`, `baseText !== null` and `contractClauses(baseText)` is not
    empty. Otherwise take the base's highest number and, for each head clause numbered above it,
    `Buffer.byteLength(line + '\n')`, summed.
  - `judge`: R1 to R5 in that order, over the sorted union of `caps` and `sizes` keys. The failure strings are the
    ones the test names: `<file>: <size> bytes, capped at <cap>. ...`; `<file>: a skill file with no cap. Add
    "<file>": <size> to server/test/skill-size-caps.json`; `<file>: capped, but no longer a skill file. Delete its
    entry`; `<file>: a new cap must be its file's size, <size>; it is <cap>`; `<file>: cap <cap> rose past <baseCap>
    on main, more than the <allow> bytes of the clauses this branch adds`; `<file>: grew by <d> bytes against main,
    more than the <allow> bytes of the clauses this branch adds`. The lowered string ends
    `Lower its entry to "<file>": <size>`.
- [ ] **Step 4: Run it and expect a pass.** Same command, then the typecheck. Expected: every case green; tsc clean.
- [ ] **Step 5: Prove each guard.** Make each mutation, run the file, see the named case go red, revert.

| Mutation | Red |
|---|---|
| Delete R2's `size > cap` check | "a file over its cap fails and names both numbers" |
| Delete R1's missing-cap arm, then its stale-cap arm | "every skill file has a cap, and every cap names a skill file" |
| Make R3 `cap >= size` instead of `===` | "a cap new on this branch must equal its file's measured size" |
| Delete R4 | "a cap raised with no clause added fails, though the file did not grow" |
| Delete R5 | "a file that grows into slack under its cap fails ..." |
| Apply R5 to a file the base does not hold, as if its base size were 0 | "a split passes ..." |
| Return 0 from `clauseAllowance` always | "is the bytes of each clause appended ..." |
| Count `line.length` instead of `Buffer.byteLength` | "is the bytes of each clause appended ..." |
| Count every changed clause, not only those past the base's last | "a reworded clause earns nothing" |
| Drop the section scoping in `contractClauses` | "a numbered line outside the contract section earns nothing" |
| Drop the "base has at least one clause" check | "a contract new to a SKILL.md earns nothing ..." |
| Look up a file's allowance under its skill's `SKILL.md`, not under the file | "a reference earns nothing from its SKILL.md's clause" |
| Return `JSON.parse(text).files` unchecked from `readCaps` | "a caps file that is not whole bytes is refused" |

- [ ] **Step 6: Commit.**

```bash
git add server/test/skill-size-ratchet.test.ts
git commit -m "test(skills): the skill-size ratchet's rules, a cap that only falls and a clause's bytes as its one raise"
```

### Task 2: The caps, measured at merge, and the tree rows

**Files:**
- Create: `server/test/skill-size-caps.json`
- Modify: `server/test/skill-size-ratchet.test.ts` (a header comment, the corpus, `describe('the tree')`)
- Modify: `server/test/ci-fast-plan.test.ts` (one case beside "carries topology-clean, oss-metadata, ...")

**Interfaces:**
- Consumes: Task 1's `Caps`, `Base`, `readCaps`, `contractClauses`, `clauseAllowance`, `judge`; `mergeBaseFiles`,
  `treeEntriesAt` from `./mergeBase.js`; the `guards` list `ci-fast-plan.test.ts` already builds with `guardTests`.
- Produces: `server/test/skill-size-caps.json` of the shape `{ "files": { "<repo-relative path>": <bytes> } }`, keys
  sorted, one entry per line; in the test,
  `const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')` (as
  `shellcheck-ratchet.test.ts` has it), `const CAPS = 'server/test/skill-size-caps.json'`,
  `const SKILL_FILE = /^ccd\/[^/]+-skill\/.+\.md$/`, `skillFiles(): string[]`, `tell(line: string): void` and
  `baseView(): (Base & { texts: Record<string, string> }) | null` (texts for the base's `SKILL.md` files only).

- [ ] **Step 1: Write the failing tree rows**, with `skill-size-caps.json` created as `{ "files": {} }`.

```ts
describe('the tree', () => {
  const caps = readCaps(readFileSync(path.join(REPO, CAPS), 'utf8'));
  const sizes = Object.fromEntries(skillFiles().map((f) => [f, readFileSync(path.join(REPO, f)).length]));
  const COORD = 'ccd/coordinator-skill/SKILL.md';

  it('the corpus is every .md under a ccd/*-skill directory, and it is not blind', () => {
    const files = skillFiles();
    for (const f of [COORD, 'ccd/worker-skill/SKILL.md', 'ccd/reviewer-skill/SKILL.md',
      'ccd/coordinator-skill/references/wave-lifecycle.md']) expect(files).toContain(f);
    expect(files.every((f) => SKILL_FILE.test(f))).toBe(true);
  });

  it('every skill file has a cap and is at or under it', () => {
    const { failures, lowered } = judge(caps, sizes, null, {});
    for (const l of lowered) tell(l);
    expect(failures.join('\n')).toBe('');
  });

  it('against main, no cap rose and no file grew past the bytes of the clauses this branch adds', (ctx) => {
    const base = baseView();
    if (base === null) { tell('skipped the merge-base rules: no origin/main or merge-base'); ctx.skip(); return; }
    const allowance = Object.fromEntries(Object.keys(sizes).map((f) =>
      [f, clauseAllowance(f, base.texts[f] ?? null, readFileSync(path.join(REPO, f), 'utf8'))]));
    expect(judge(caps, sizes, base, allowance).failures.join('\n')).toBe('');
  });

  it('red: one byte past the real coordinator cap fails', () => {
    expect(judge(caps, { ...sizes, [COORD]: caps[COORD]! + 1 }, null, {}).failures)
      .toEqual([expect.stringContaining(`${COORD}: ${caps[COORD]! + 1} bytes, capped at ${caps[COORD]}`)]);
  });

  it('red: the real last clause, taken off the base, earns exactly its own bytes', () => {
    const head = readFileSync(path.join(REPO, COORD), 'utf8');
    const last = [...contractClauses(head).values()].at(-1)!;
    expect(clauseAllowance(COORD, head.replace(`${last}\n`, ''), head)).toBe(Buffer.byteLength(`${last}\n`));
  });
});
```

  In `ci-fast-plan.test.ts`, inside the describe that builds `guards`, after the "carries topology-clean, ..." case:

```ts
it('carries the skill-size ratchet: it lists the tree itself, so no change can be related to it', () => {
  expect(guards).toContain('server/test/skill-size-ratchet.test.ts');
});
```

- [ ] **Step 2: Run them and expect failures.**
  `cd server && ./node_modules/.bin/vitest run test/skill-size-ratchet.test.ts test/ci-fast-plan.test.ts`.
  Expected: the ratchet file fails to collect with `ReferenceError` (`skillFiles` is not defined), and the new
  `ci-fast-plan.test.ts` case fails because the ratchet's source does not call `git ls-files` yet. Once the helpers
  exist, "every skill file has a cap" fails with fourteen `a skill file with no cap. Add "<file>": <size>` lines.
- [ ] **Step 3: Implement.**
  - `skillFiles()`: `execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    'ccd'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })`, split on `\0`, kept when `SKILL_FILE`
    matches and `lstatSync(..., { throwIfNoEntry: false })?.isFile()`. The direct `git ls-files` call stays in this
    file: it is what makes `TREE_READER` match and the test a guard suite.
  - `baseView()`: `mergeBaseFiles(REPO, 'ccd')`, null when that is null. Sizes and `SKILL.md` texts from
    ``execFileSync('git', ['show', `${base}:${f}`], { cwd: REPO, maxBuffer })`` as a Buffer, for each base entry of
    type `blob`, mode not `120000`, whose path `SKILL_FILE` matches. Caps: `treeEntriesAt(REPO, base, 'server/test')`;
    a null listing throws (never a skip); no entry for `CAPS` gives `caps: 'absent'`; otherwise `readCaps` of its
    `git show`, which throws on a bad file.
  - `tell`: ``writeSync(2, `skill-size ratchet: ${line}\n`)``, as `shellcheck-ratchet.test.ts` has it, because the
    default reporter drops console output from a passing test.
  - The header comment: what is capped and why (§11.3, §11.4), R1 to R5, how to lower a cap, how the one raise works,
    and that a numbered contract line counts as a pinned clause because each pin suite checks `1..N`.
  - Fill `skill-size-caps.json` from the Step 2 failure lines, measured on this branch's tip. Since `main` holds no
    caps file, R3 holds every entry to its exact size against the tree each run checks, and the merge queue's run
    checks the merged tree: that is "caps measured at that merge". If a skill file changes on `main` first, that run
    reds on R3 with the size to use; absorb `main` by `git merge` (worker clause 16) and re-measure.
- [ ] **Step 4: Run them and expect a pass.** Same command, then the typecheck. Expected: green, tsc clean; the
  merge-base row runs (it skips only with no `origin/main`). The `ci-fast-plan.test.ts` case passes only because
  Task 1 committed the ratchet file: `liveTestFiles` lists HEAD's tree, then reads each source from the working tree.
- [ ] **Step 5: Prove the tree rows.**

| Mutation | Red |
|---|---|
| Append one byte to `ccd/worker-skill/SKILL.md` locally | "every skill file has a cap and is at or under it" |
| Raise one cap in `skill-size-caps.json` by 1 | "against main, no cap rose ..." |
| Delete an entry from `skill-size-caps.json` | "every skill file has a cap ..." |
| Change `SKILL_FILE` to `/^ccd\/[^/]+-skill\/SKILL\.md$/` | "the corpus is every .md ..." |
| Add the ratchet to `HEAVY_TREE_READERS` in `fast-plan.mjs` | "carries the skill-size ratchet ..." in `ci-fast-plan.test.ts` |

- [ ] **Step 6: Commit.**

```bash
git add server/test/skill-size-caps.json server/test/skill-size-ratchet.test.ts server/test/ci-fast-plan.test.ts
git commit -m "test(skills): every shipped skill file capped at its size at merge, ratcheted against main"
```

## Deviations found

The programme's run (1774) minted these numbers on 2026-11-11. They are defined in the programme's index plan,
`docs/superpowers/plans/2026-11-10-overlord.md`; each entry here gives the whole decision, after its number and old slug.
The corpus (every `.md` under `ccd/*-skill/`) and growth against the merge-base are §11.3's own words, so they
are not deviations.

- **D-8218, skill-ratchet-pinned-by-count** — "Pinned" is read from the `SKILL.md` text, not from the pin arrays, which
  are literals inside three test files. It leans on each pin suite's `1..N` check, so it counts only in a `SKILL.md`
  whose base already has clauses: a first contract, with no suite behind it yet, earns nothing.
- **D-8219, skill-ratchet-no-base** — Without `origin/main`, only R1 and R2 run, with a printed notice, as
  `citations.test.ts` does. CI always has `origin/main`, so the merge queue never skips R3 to R5.
- **D-8220, skill-ratchet-stale-cap** — A cap that names no skill file fails (R1), where the shellcheck ratchet only
  prints it, so a renamed or deleted file cannot leave a cap standing for a later file at its old path.

**Settled by the spec's later edition, so no longer deviations:** a clause's bytes are the UTF-8
bytes of its whole numbered line, newline included, for clauses numbered past the merge base's highest; a reworded
clause earns nothing; a `SKILL.md` earns the raise only once its contract has a pinned clause at the merge base; a
new skill file is capped at its size at that merge (§11.3).

## Where things stand

**Needs before it starts:** the spec on `main` at `docs/superpowers/specs/2026-11-09-overlord-design.md`, and the
programme's run open to mint the three numbers above. No code dependency.

**Depends on it:**
- The recall clause (spec clause 23; on today's tree it takes number 21). Its pull request is the first use of the
  raise: it may grow the coordinator `SKILL.md` and its cap by the clause line's bytes, and must offset the 4 bytes of
  "twenty" becoming "twenty-one". It also extends `WORDS` in `coordinator-skill.test.ts`, which ends at `'twenty'`.
- W1's `ccrc-overlord` skill: its contract must sit under a `## The contract` heading with its own `1..N` pin suite,
  or its clauses earn nothing. Its first cap is its size at that merge (R3).
- Every pull request in flight that grows a skill file without adding a clause reds once this lands. The coordinator
  tells their workers before it merges.

**Open questions for the operator, most important first:**
1. **Order inside W1a.** Recommendation: this lands before the recall clause, so that clause's pull request is the
   first real use of the raise (§11.4 says only that the recall clause lands first in W1a).
2. **An absolute bound for `ccrc-overlord`'s `SKILL.md`.** §11.3 says it stays under 5,000 tokens; a relative byte
   ratchet does not say that. Recommendation: W1's overlord-skill piece asserts an absolute byte ceiling in its own
   pin suite (about 4 bytes a token, so 20,000 bytes), and this ratchet caps it from the pull request that adds it.
3. **The count word.** Settled: the clause's pull request offsets the count word's bytes inside the same file
   (§11.4).
4. **M31's "coordinator skill bytes".** Settled: the measure reads the files, not the caps (§11.4).
5. **The scope: every skill file, or `SKILL.md` only.** Ruled by the operator on 2026-11-10: cap each `SKILL.md`,
   and hold each contract inside what a compaction keeps. So where this plan says every `.md` under a skill
   directory, read every `SKILL.md`: reference files are not capped. The test gained a sixth rule, R6: the
   contract is the file's first section, a notice stands before it, and it ends within 16,000 bytes. Each role
   skill's contract moved first in #2555. The coordinator's procedures then moved to reference files, with the wave
   lifecycle split into one file per step (#2559), so its `SKILL.md` is 23,583 bytes where this plan measured 55,305.
   The test is #2565, with caps measured on those files.
