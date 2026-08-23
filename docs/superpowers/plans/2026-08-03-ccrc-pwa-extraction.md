# ccrc-pwa Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ccrc out of the `OpenClawHetzner` monorepo into a standalone
private repo `ccrc-pwa`, with git history preserved and **zero behaviour
change**.

**Architecture:** Three phases. First, two preparatory commits *in the
monorepo* — a re-runnable manifest script and the collapse of seven duplicate
`ccd`-path definitions into one guarded export — both verified against the full
existing suite in a known-good environment. Then a `git filter-repo` extraction
into a new repo. Then verification, in which exactly **one line** of the moved
tree is permitted to differ from its origin.

**Tech Stack:** bash, `git filter-repo`, `gh`, Node ≥22, vitest, tsc, GitHub
Actions.

**Spec:** `docs/superpowers/specs/2026-08-03-ccrc-pwa-extraction-design.md`

---

## Why the ordering matters

The spec permitted seven files to differ after the move: `ccdWsHelpers.ts` plus
the six test files whose `ccd` path literal becomes an import of it.

This plan does better, by collapsing the seven definitions **before** the
extraction rather than after. The collapse then lands in the monorepo where the
full suite already runs green, so it is verified in isolation; and the
extraction that follows becomes a literal file copy in which **exactly one
line** — the path inside `ccdWsHelpers.ts` — is allowed to change.

That is a materially stronger verification than the spec asked for: one
permitted difference instead of seven, and any other checksum mismatch is
unambiguously a defect rather than something a reviewer must adjudicate.

**This supersedes the spec's step 2.** Update the spec's "content identity"
paragraph when Task 2 lands, so the two documents do not disagree about how many
files may differ.

## Global Constraints

- **Zero behaviour change.** No de-personalisation, no account-model change, no
  auth, no installer, no `ccd` portability seams, no deletion from the monorepo,
  no deploy cutover. A reviewer must reject the work if any of it appears.
- **Nothing deploys.** `infra/ccrc/` remains the live deploy source throughout.
  The 11 running sessions must be untouched at the end.
- **Never run `ccd ws-gc --prune`, `ws-reap`, `ws-rm`, or any destructive ccd
  verb against the real host.** Fixtures under an isolated `$HOME` only.
- **`HOME` is the only test-isolation boundary.** `PROJECTS_ROOT` and
  `WORKTREES_ROOT` derive from it and must take **no** environment override.
- **No test may reach the real network, the real `gh`, or the real tmux server.**
  `agent/test/contain-path.setup.ts` must stay wired via `setupFiles`.
- **Run test binaries from inside each package**: `./node_modules/.bin/vitest`
  and `./node_modules/.bin/tsc`. Never `npx vitest` — it resolves to a global
  cache copy with no `jsdom` and falsely reports "no tests" alongside 39 errors.
- **`shared/` must remain a sibling of `server/` and `agent/`.**
  `server/tsconfig.json:4-7` and `agent/tsconfig.json:4-7` declare
  `"rootDir": ".."` with `"include": ["src/**/*.ts", "../shared/**/*.ts"]`.
- **`shared/package.json` must not be edited.** Its `"//"` field is
  load-bearing: without it tsc emits CommonJS into `dist/shared/` while
  `server/` and `agent/` are `"type": "module"`, and the built server dies at
  startup with "does not provide an export named".
- **Monorepo work happens on branch `ccrc-pwa-extraction`**, never on `main`.

## Operator parameters

Task 3 is the first irreversible step. These must be settled before it runs:

| Parameter | Value | Note |
| --- | --- | --- |
| `OWNER` | **confirm before Task 3** | `gh auth status` reports account `example-org`, a personal account. If the repo belongs to a company org, `gh` needs write access to that org first. Task 3 Step 1 verifies this and halts if it fails. |
| `REPO` | `ccrc-pwa` | |
| Visibility | `private` | Non-negotiable until spec 1 lands — the tree still contains the operator's tailnet name, box IPs, username, and home paths. |
| Local path | `/srv/projects/ccrc-pwa` | Sibling of the monorepo, inside the projects root. |

## File structure

**Created in the monorepo (Tasks 1–2):**

| File | Responsibility |
| --- | --- |
| `infra/ccrc/scripts/extraction-manifest.sh` | Emits a canonical `<path> <sha256>` manifest of the product tree. Runs in **both** repos and normalises paths so the two outputs are directly comparable. Moves to `scripts/` in the new repo. |

**Modified in the monorepo (Task 2):**

| File | Change |
| --- | --- |
| `infra/ccrc/server/test/ccdWsHelpers.ts` | Already exports `CCD` (line 10). Unchanged here; becomes the sole definition. |
| `infra/ccrc/server/test/ccd-clip.test.ts:12` | Local `CCD` const → import |
| `infra/ccrc/server/test/projected-home.test.ts:20` | Local `CCD` const → import |
| `infra/ccrc/server/test/ccd-limits.test.ts:13` | Local `CCD` const → import |
| `infra/ccrc/server/test/ccd-ws-reap.test.ts:128` | Inline `path.resolve(...)` → `CCD` |
| `infra/ccrc/server/test/ccd-ws-audit.test.ts:266` | Inline `path.resolve(...)` → `CCD` |
| `infra/ccrc/server/test/wsaudit.test.ts:8` | `CCD_PATH` (spelled with `path.join` parts) → import of `CCD` |
| `infra/ccrc/server/test/single-definition.test.ts` | New `describe` block guarding the one definition |

**Created in `ccrc-pwa` (Tasks 3–5):**

| File | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | Runs three suites + three typechecks on push and PR |
| `.gitignore` | Rewritten for the flat layout |

**Not moved:** `server/test/ccd-ccclip.test.ts` is excluded during the filter,
so it never exists in `ccrc-pwa`'s history. It tests `ccclip`, the Mac-side
producer, which stays in the monorepo.

---

## Task 1: The manifest script

A single script, run in two different repos, producing directly comparable
output. This is the instrument every later verification depends on, so it is
built and tested first.

**Files:**
- Create: `infra/ccrc/scripts/extraction-manifest.sh`
- Test: `infra/ccrc/server/test/extraction-manifest.test.ts`

**Interfaces:**
- Produces: `extraction-manifest.sh [--root <dir>]`, writing
  `<canonical-path> <sha256>` lines to stdout, sorted by path. Auto-detects
  monorepo vs standalone layout. Exit 0 on success, 1 if neither layout is
  recognised.

- [ ] **Step 1: Create the branch**

```bash
cd /srv/projects/OpenClawHetzner
git checkout -b ccrc-pwa-extraction
```

- [ ] **Step 2: Write the failing test**

Create `infra/ccrc/server/test/extraction-manifest.test.ts`:

```ts
// The manifest script is the instrument that proves the extraction moved the
// code intact. It runs in two DIFFERENT repo layouts and its whole value is
// that both runs produce the same keys for the same files — so that is what is
// tested here, against a synthetic tree of each shape.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, '../../scripts/extraction-manifest.sh');

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-manifest-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function write(rel: string, body: string): void {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function run(): string {
  return execFileSync('bash', [SCRIPT, '--root', tmp], { encoding: 'utf8' });
}

/** Parse `path  sha` lines into a map. */
function parse(out: string): Record<string, string> {
  const m: Record<string, string> = {};
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [p, sha] = line.split(/\s+/);
    m[p!] = sha!;
  }
  return m;
}

describe('monorepo layout', () => {
  it('strips infra/ccrc/ and maps the four <server-host>-portability files into ccd/', () => {
    write('infra/ccrc/server/src/a.ts', 'A');
    write('infra/ccrc/pwa/src/b.tsx', 'B');
    write('infra/ccrc/README.md', 'R');
    write('infra/<server-host>-portability/ccd', 'CCD');
    write('infra/<server-host>-portability/tmux.conf', 'T');
    write('infra/<server-host>-portability/statusline-command.sh', 'S');
    write('infra/<server-host>-portability/claude-session@.service', 'U');

    const m = parse(run());
    expect(Object.keys(m).sort()).toEqual([
      'README.md',
      'ccd/ccd',
      'ccd/claude-session@.service',
      'ccd/statusline-command.sh',
      'ccd/tmux.conf',
      'pwa/src/b.tsx',
      'server/src/a.ts',
    ]);
  });

  it('excludes the operator tooling that stays behind', () => {
    write('infra/ccrc/server/src/a.ts', 'A');
    write('infra/<server-host>-portability/ccclip', 'X');
    write('infra/<server-host>-portability/cc', 'X');
    write('infra/<server-host>-portability/hammerspoon-init.lua', 'X');
    write('infra/<server-host>-portability/docserver-server.py', 'X');
    write('infra/<server-host>-portability/hardening.sh', 'X');
    write('infra/mac-account-swap/ccswap', 'X');

    expect(Object.keys(parse(run()))).toEqual(['server/src/a.ts']);
  });

  it('excludes node_modules, dist, dist-pwa and ccd-ccclip.test.ts', () => {
    write('infra/ccrc/server/src/a.ts', 'A');
    write('infra/ccrc/server/node_modules/pkg/i.js', 'X');
    write('infra/ccrc/server/dist/o.js', 'X');
    write('infra/ccrc/server/dist-pwa/i.html', 'X');
    write('infra/ccrc/server/test/ccd-ccclip.test.ts', 'X');

    expect(Object.keys(parse(run()))).toEqual(['server/src/a.ts']);
  });
});

describe('standalone layout', () => {
  it('uses paths as-is', () => {
    write('server/src/a.ts', 'A');
    write('ccd/ccd', 'CCD');
    expect(Object.keys(parse(run())).sort()).toEqual(['ccd/ccd', 'server/src/a.ts']);
  });
});

describe('the two layouts agree', () => {
  it('produces identical output for the same content in either shape', () => {
    write('infra/ccrc/server/src/a.ts', 'hello');
    write('infra/<server-host>-portability/ccd', 'bash');
    const mono = run();

    fs.rmSync(path.join(tmp, 'infra'), { recursive: true, force: true });
    write('server/src/a.ts', 'hello');
    write('ccd/ccd', 'bash');
    const standalone = run();

    // Byte-identical, including the checksums. This is the property the whole
    // verification rests on: same content in either layout, same manifest.
    expect(standalone).toBe(mono);
  });
});

describe('refuses an unrecognised tree', () => {
  it('exits non-zero rather than emitting an empty manifest', () => {
    write('some/other/thing.txt', 'X');
    // An empty manifest compares equal to another empty manifest, which would
    // make the extraction "verified" while proving nothing.
    expect(() => run()).toThrow();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd /srv/projects/OpenClawHetzner/infra/ccrc/server
./node_modules/.bin/vitest run test/extraction-manifest.test.ts
```

Expected: FAIL — the script does not exist.

- [ ] **Step 4: Write the script**

Create `infra/ccrc/scripts/extraction-manifest.sh`:

```bash
#!/usr/bin/env bash
# extraction-manifest.sh — a canonical, comparable content manifest of the ccrc
# product tree.
#
# It runs in TWO repo layouts and normalises paths so both produce the same key
# for the same file. That is the entire point: the pre-extraction manifest taken
# in OpenClawHetzner and the post-extraction manifest taken in ccrc-pwa are
# diffed against each other, and any difference is a file that changed during
# the move.
#
#   monorepo:   infra/ccrc/server/src/a.ts        -> server/src/a.ts
#               infra/<server-host>-portability/ccd   -> ccd/ccd
#   standalone: server/src/a.ts                   -> server/src/a.ts
#
# No `set -e`: this file follows ccd's convention, because `local x=$(cmd)`
# returns local's status and silently swallows failures.
set -uo pipefail

ROOT="."
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$ROOT" || { echo "cannot enter $ROOT" >&2; exit 2; }

# The four files that move out of <server-host>-portability, and where they land.
# Everything else in that directory is operator tooling that stays behind, so
# this is an allowlist rather than a set of exclusions — a new file appearing
# there must be considered deliberately, not swept along.
PORTABILITY_FILES="ccd claude-session@.service statusline-command.sh tmux.conf"

# Excluded everywhere: build output, dependencies, and the one test that stays
# with the Mac-side tool it exercises.
is_excluded() {
  case "$1" in
    */node_modules/*|*/dist/*|*/dist-pwa/*|*/.git/*) return 0 ;;
    */server/test/ccd-ccclip.test.ts) return 0 ;;
    *) return 1 ;;
  esac
}

emit() {  # emit <file-on-disk> <canonical-path>
  is_excluded "/$2" && return 0
  printf '%s  %s\n' "$2" "$(sha256sum "$1" | cut -d' ' -f1)"
}

MODE=""
[ -d "infra/ccrc" ] && MODE="monorepo"
[ -z "$MODE" ] && [ -d "server" ] && MODE="standalone"

if [ -z "$MODE" ]; then
  # An unrecognised tree must fail loudly. An empty manifest compares equal to
  # another empty manifest, so a silent exit 0 here would report a verified
  # extraction while having examined nothing at all.
  echo "extraction-manifest: no ccrc tree found under $ROOT" >&2
  exit 1
fi

{
  if [ "$MODE" = "monorepo" ]; then
    find infra/ccrc -type f 2>/dev/null | while read -r f; do
      emit "$f" "${f#infra/ccrc/}"
    done
    for n in $PORTABILITY_FILES; do
      [ -f "infra/<server-host>-portability/$n" ] || continue
      emit "infra/<server-host>-portability/$n" "ccd/$n"
    done
  else
    find server agent pwa shared deploy ccd scripts .github -type f 2>/dev/null \
      | while read -r f; do emit "$f" "$f"; done
    [ -f README.md ] && emit README.md README.md
  fi
} | LC_ALL=C sort
```

Then:

```bash
chmod 755 infra/ccrc/scripts/extraction-manifest.sh
bash -n infra/ccrc/scripts/extraction-manifest.sh
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd /srv/projects/OpenClawHetzner/infra/ccrc/server
./node_modules/.bin/vitest run test/extraction-manifest.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Capture the real baseline**

```bash
cd /srv/projects/OpenClawHetzner
mkdir -p .extraction
bash infra/ccrc/scripts/extraction-manifest.sh > .extraction/manifest-before.txt
wc -l .extraction/manifest-before.txt
grep -c '^ccd/' .extraction/manifest-before.txt   # expect 4
grep '^ccd/ccd ' .extraction/manifest-before.txt  # expect sha 2bc6287b5e8a...
```

Expected: ~305 lines; exactly 4 `ccd/` entries; `ccd/ccd` matching
`2bc6287b5e8a882168118c6977e148547e4b2c18278011b616c8b9b23aa42f7d`.

If the `ccd/ccd` checksum differs, **stop** — `ccd` has changed since the spec
was written and the spec's anchor needs updating before proceeding.

> **This manifest goes stale, by design of the plan's own ordering.** Task 2
> edits seven test files after this snapshot, so by extraction time it no longer
> describes the tree being extracted. It remains the right companion to
> `suites-before.txt` for the suite baseline, and nothing here needs changing —
> but a **second** manifest must be taken at the commit actually extracted, and
> that one is what Task 6 Step 1 diffs against. Re-run this same command
> immediately after Task 2 commits, writing to
> `.extraction/manifest-at-extraction.txt`.

- [ ] **Step 7: Capture the suite baseline**

```bash
cd /srv/projects/OpenClawHetzner/infra/ccrc
{
  for p in server agent pwa; do
    echo "--- $p ---"
    (cd $p && ./node_modules/.bin/vitest run --reporter=dot 2>&1 | grep -E 'Test Files|Tests ')
    (cd $p && ./node_modules/.bin/tsc --noEmit >/dev/null 2>&1; echo "tsc exit=$?")
  done
} | tee ../../.extraction/suites-before.txt
```

Expected, matching the spec's appendix: server 55 files / 1099 tests, agent
13 / 204, pwa 40 / 903, all `tsc exit=0`. Record whatever it actually says —
these numbers move, and the recorded value is what Task 5 compares against.

- [ ] **Step 8: Record the ccclip test's case count**

The server suite legitimately loses this file. The subtraction must be checked,
not assumed.

```bash
cd /srv/projects/OpenClawHetzner/infra/ccrc/server
./node_modules/.bin/vitest run test/ccd-ccclip.test.ts --reporter=dot 2>&1 \
  | grep -E 'Test Files|Tests ' | tee -a ../../../.extraction/suites-before.txt
```

- [ ] **Step 9: Commit**

`.extraction/` is a working artifact of this migration, not product code. Add it
to the monorepo's `.gitignore` and keep it out of the commit.

```bash
cd /srv/projects/OpenClawHetzner
echo '.extraction/' >> .gitignore
git add .gitignore infra/ccrc/scripts/extraction-manifest.sh \
        infra/ccrc/server/test/extraction-manifest.test.ts
git commit -m "test(ccrc): a manifest script that compares the tree across both repo layouts

The extraction's whole verification rests on being able to prove the moved
tree is byte-identical to its origin. That needs one instrument that runs in
both layouts and normalises paths to the same keys, so the before and after
manifests diff directly.

Refuses an unrecognised tree rather than emitting an empty manifest: two
empty manifests compare equal, which would report a verified extraction
having examined nothing."
```

---

## Task 2: Collapse the seven ccd-path definitions

Seven files each spell the path to the `ccd` script. After this task exactly one
does, and a guard keeps it that way — so the extraction only has to repoint a
single line.

**Files:**
- Modify: `infra/ccrc/server/test/single-definition.test.ts`
- Modify: `infra/ccrc/server/test/ccd-clip.test.ts:12`
- Modify: `infra/ccrc/server/test/projected-home.test.ts:20`
- Modify: `infra/ccrc/server/test/ccd-limits.test.ts:13`
- Modify: `infra/ccrc/server/test/ccd-ws-reap.test.ts:128`
- Modify: `infra/ccrc/server/test/ccd-ws-audit.test.ts:266`
- Modify: `infra/ccrc/server/test/wsaudit.test.ts:8`

**Interfaces:**
- Consumes: `export const CCD` from `./ccdWsHelpers.js` — already exists at
  `ccdWsHelpers.ts:10`, unchanged by this task.
- Produces: `CCD` as the sole definition of the path to the `ccd` script,
  enforced by a test.

- [ ] **Step 1: Write the failing guard**

Append to `infra/ccrc/server/test/single-definition.test.ts`. Note it needs a
new source root — the existing `ROOTS` covers `shared/`, `server/src`,
`pwa/src`, and `agent/src`, but **not** `server/test`, which is where all seven
copies live.

```ts
describe('extraction finding — one path to the ccd script', () => {
  // Seven files each spelled this path, and the extraction has to repoint it.
  // One definition means one line changes and every other file in the moved
  // tree must be byte-identical to its origin — which is what makes the
  // extraction verifiable by checksum instead of by review.
  //
  // Scans server/test, which the ROOTS above deliberately do not cover.
  const testDir = path.join(ccrcRoot, 'server', 'test');
  const testFiles = sources(testDir);

  // Matches any literal naming the script: the '../../../<server-host>-portability/ccd'
  // form, the path.join(..., '<server-host>-portability', 'ccd') form that
  // wsaudit.test.ts used, and the '../../ccd/ccd' form it becomes after the
  // move. All three must be caught, or the guard stops working the moment the
  // extraction lands.
  const NAMES_CCD = /<server-host>-portability|['"]\.\.\/\.\.\/ccd\/ccd['"]|['"]ccd['"]\s*\)/;

  it('found the test tree it is scanning', () => {
    // A scan over an empty list passes everything.
    expect(testFiles.length).toBeGreaterThan(40);
    expect(testFiles.map(rel)).toContain('server/test/ccdWsHelpers.ts');
  });

  it('is spelled in exactly one file, and that file is ccdWsHelpers.ts', () => {
    const holders = testFiles
      .filter((f) => NAMES_CCD.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(holders).toEqual(['server/test/ccdWsHelpers.ts']);
  });

  it('is what the six former copy sites now import', () => {
    // Not merely "the copies are gone" — deleting the tests would satisfy that.
    // Each site must still reach the shared constant.
    for (const f of ['ccd-clip.test.ts', 'projected-home.test.ts',
      'ccd-limits.test.ts', 'ccd-ws-reap.test.ts', 'ccd-ws-audit.test.ts',
      'wsaudit.test.ts']) {
      const src = readFileSync(path.join(testDir, f), 'utf8');
      expect(src, f).toMatch(/import\s*\{[^}]*\bCCD\b[^}]*\}\s*from\s*'\.\/ccdWsHelpers\.js'/);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /srv/projects/OpenClawHetzner/infra/ccrc/server
./node_modules/.bin/vitest run test/single-definition.test.ts
```

Expected: FAIL on "exactly one file" — `holders` lists seven paths.

- [ ] **Step 3: Collapse the six copies**

In each file, delete the local definition and import the shared one instead.

`ccd-clip.test.ts`, `projected-home.test.ts`, `ccd-limits.test.ts` each hold a
line of the form:

```ts
const CCD = path.resolve(__dirname, '../../../<server-host>-portability/ccd');
```

Delete it and add `CCD` to the file's existing import from `./ccdWsHelpers.js`,
or add the import if there is none:

```ts
import { CCD } from './ccdWsHelpers.js';
```

`ccd-ws-reap.test.ts:128` and `ccd-ws-audit.test.ts:266` use it inline:

```ts
const src = fs.readFileSync(path.resolve(__dirname, '../../../<server-host>-portability/ccd'), 'utf8');
```

becomes:

```ts
const src = fs.readFileSync(CCD, 'utf8');
```

`wsaudit.test.ts:8` spells it in parts under a different name:

```ts
const CCD_PATH = path.resolve(here, '..', '..', '..', '<server-host>-portability', 'ccd');
```

Delete it, import `CCD`, and update both mentions: the read at **line 57**
(`readFileSync(CCD_PATH, 'utf8')` → `readFileSync(CCD, 'utf8')`) and the comment
at **line 69**, which names `CCD_PATH` in prose and would otherwise point at a
symbol that no longer exists.

**On unused bindings after the deletions — measured, so nothing is guessed:**

- `path` stays imported in all six. Every file has other `path.` uses beyond the
  line being deleted (2, 7, 10, 168, 111, and 2 uses respectively).
- `__dirname` is a global, not an import. It becomes unused in five of the six
  and there is nothing to remove.
- `here` stays in `wsaudit.test.ts` (5 uses, one of which is the deleted line)
  and in `ccd-limits.test.ts`, `ccd-ws-reap.test.ts`, `ccd-ws-audit.test.ts`.

So no import should need removing. If one does, something else changed and it is
worth a second look rather than a silent deletion.

- [ ] **Step 4: Run the guard and the full server suite**

```bash
cd /srv/projects/OpenClawHetzner/infra/ccrc/server
./node_modules/.bin/vitest run test/single-definition.test.ts
./node_modules/.bin/vitest run --reporter=dot 2>&1 | grep -E 'Test Files|Tests '
./node_modules/.bin/tsc --noEmit && echo "tsc clean"
```

Expected: guard PASSES; full suite still **55 files / 1099 tests passed**,
identical to the Task 1 baseline; tsc clean.

A changed test count here means the collapse altered behaviour — stop and
investigate rather than proceeding.

- [ ] **Step 5: Prove the guard is load-bearing**

A guard that passes when the thing it guards is broken is worse than no guard.

```bash
cd /srv/projects/OpenClawHetzner/infra/ccrc/server
cp test/ccd-clip.test.ts /tmp/ccd-clip.bak
# Reintroduce a copy exactly as a future author would write it.
sed -i "s|import { CCD } from './ccdWsHelpers.js';|const CCD = path.resolve(__dirname, '../../../<server-host>-portability/ccd');|" test/ccd-clip.test.ts
./node_modules/.bin/vitest run test/single-definition.test.ts   # MUST FAIL
cp /tmp/ccd-clip.bak test/ccd-clip.test.ts && rm /tmp/ccd-clip.bak
sha256sum test/ccd-clip.test.ts    # confirm pristine restore
./node_modules/.bin/vitest run test/single-definition.test.ts   # MUST PASS
```

- [ ] **Step 6: Commit**

```bash
cd /srv/projects/OpenClawHetzner
git add infra/ccrc/server/test/
git commit -m "refactor(ccrc): one definition of the path to the ccd script

Seven test files each spelled '../../../<server-host>-portability/ccd', six of
them independently of the CCD that ccdWsHelpers.ts already exported.

Collapsed to that one export, guarded by single-definition.test.ts, which
already exists for exactly this class of finding. The guard matches all
three spellings — the relative literal, wsaudit's path.join parts, and the
'../../ccd/ccd' form it becomes after extraction — so it keeps working
across the move rather than quietly passing afterwards.

The payoff is the extraction's verification: with one definition, exactly
one line of the moved tree may differ from its origin, and every other file
must be byte-identical. Seven permitted differences would have needed a
reviewer's judgement; one needs a checksum."
```

### Deviations from this task's plan text

What shipped in `df403e9` differs from Step 1's text above in four ways. Each
is an improvement over the plan, not a defect in the code — recorded here
because this repo's convention is to log the divergence, not just fix it
silently.

1. **Two directories scanned, not one.** The plan's `testDir` covers only
   `server/test`. The shipped guard scans `server/test` **and**
   `server/test-e2e` (`testDirs`, `testFiles = testDirs.flatMap(sources)`).
   `server/test-e2e` is a real sibling TypeScript tree (`helpers.ts`,
   `session.e2e.test.ts`) that talks about `ccd` and held no copy on the day
   this landed — but an unscanned sibling directory is exactly the "clean and
   unchecked becomes dirty and unchecked with nothing saying so" shape this
   guard exists to close, so it is scanned rather than assumed clean.

2. **Four-alternative regex, not three — and this one was forced, not
   chosen.** The plan's `NAMES_CCD` opens with a bare, unanchored
   `<server-host>-portability` alternative. That substring appears in this same
   `server/test` tree for reasons that have nothing to do with the seven
   copies: `extraction-manifest.test.ts`'s own fixtures write it as a literal,
   and `ccd-ccclip.test.ts` names it while pointing at the *other* script,
   `ccclip`. A bare match makes both permanent extra "holders", so
   `expect(holders).toEqual(['server/test/ccdWsHelpers.ts'])` can never be
   satisfied — the plan's own Step 4 ("guard PASSES") is unreachable as
   written, collapse or no collapse. The shipped regex anchors each
   alternative to the exact literal or call shape (the pre-move relative
   path, `wsaudit.test.ts`'s `path.join` parts, the post-move
   `'../../ccd/ccd'` form, and the post-move parts form `'ccd', 'ccd'`), so it
   stops matching prose that merely mentions the directory name.

3. **Per-directory non-empty assertion, not a bare aggregate count.** The
   plan's "found the test tree" step is `expect(testFiles.length)
   .toBeGreaterThan(40)` over a single directory. With two directories
   flattened together, a bare aggregate count can stay healthy while one of
   the two silently contributes zero files (a moved or renamed sibling), with
   the other directory's count covering for it. The shipped test asserts
   `sources(d).length` is positive for **each** `d` in `testDirs`
   individually, before the aggregate check — the same design already used
   by the `ROOTS` scan earlier in this same file, for the same reason.

4. **A `server/test-e2e/helpers.ts` pin, in addition to the plan's
   `ccdWsHelpers.ts` pin.** Proves the second root actually contributed a
   real file to `testFiles`, not merely that `sources()` returned a positive
   count for it — the same kind of concrete-membership check the plan already
   specifies for `server/test`, extended to the directory the plan didn't
   name.

---

## Task 3: Create the repo and extract history

The first irreversible step. Nothing here touches the monorepo's working tree or
the live fleet.

**Files:**
- Create: the `ccrc-pwa` GitHub repository
- Create: `/srv/projects/ccrc-pwa`

**Interfaces:**
- Consumes: `.extraction/manifest-before.txt` from Task 1.
- Produces: a repo whose tree matches that manifest except for one line, and
  whose history reaches back through the pre-move paths.

- [ ] **Step 1: Confirm the target owner and verify write access**

**Halt and ask the operator for `OWNER` before running this.** `gh auth status`
reports account `example-org`; if the repo belongs to a company org, `gh` needs write
access there first.

```bash
OWNER=<confirmed-with-operator>
gh api "users/$OWNER" >/dev/null 2>&1 || gh api "orgs/$OWNER" >/dev/null 2>&1 \
  || { echo "cannot see $OWNER — fix gh auth before continuing"; exit 1; }
gh repo view "$OWNER/ccrc-pwa" >/dev/null 2>&1 \
  && { echo "$OWNER/ccrc-pwa already exists — stop"; exit 1; }
echo "ok: $OWNER is visible and ccrc-pwa does not exist"
```

- [ ] **Step 2: Install git-filter-repo**

> **Corrected during execution.** Both package-manager routes below fail on this
> box: there is no `pipx`, no `pip3`, and Python 3.12.3 is PEP 668
> externally-managed. Go straight to the single-file install. Verified viable —
> the URL returns HTTP 200, the file carries a plain `#!/usr/bin/env python3`
> shebang, `~/.local/bin` is on PATH, and git is 2.43.0 against filter-repo's
> 2.24 floor.

```bash
curl -fsSL https://raw.githubusercontent.com/newren/git-filter-repo/main/git-filter-repo \
  -o ~/.local/bin/git-filter-repo && chmod 755 ~/.local/bin/git-filter-repo
git filter-repo --version
```

Do **not** substitute `git subtree split`: it handles one prefix and this
extraction has two, with renames.

- [ ] **Step 3: Clone the monorepo to a scratch working copy**

`git filter-repo` rewrites history destructively and refuses to run on a
non-fresh clone. It must never point at the monorepo itself.

```bash
cd /srv/projects
rm -rf /tmp/ccrc-extract
git clone --no-local /srv/projects/OpenClawHetzner /tmp/ccrc-extract
cd /tmp/ccrc-extract
git checkout ccrc-pwa-extraction
git log --oneline -1   # expect Task 2's commit
```

- [ ] **Step 4: Filter to the product paths, renaming as we go**

```bash
cd /tmp/ccrc-extract
git filter-repo --force \
  --path infra/ccrc/ \
  --path infra/<server-host>-portability/ccd \
  --path infra/<server-host>-portability/claude-session@.service \
  --path infra/<server-host>-portability/statusline-command.sh \
  --path infra/<server-host>-portability/tmux.conf \
  --path-rename infra/ccrc/: \
  --path-rename infra/<server-host>-portability/:ccd/
```

Then remove the one test that does not come across, so it never exists in the
new repo's history:

```bash
git filter-repo --force --invert-paths --path server/test/ccd-ccclip.test.ts
```

- [ ] **Step 5: Verify the filter did what it claimed**

```bash
cd /tmp/ccrc-extract
ls -1                                        # server agent pwa shared deploy ccd scripts README.md
test -f ccd/ccd && echo "ccd present"
test ! -f server/test/ccd-ccclip.test.ts && echo "ccclip test correctly absent"
sha256sum ccd/ccd                            # MUST equal the Task 1 baseline
git log --oneline -- ccd/ccd | wc -l         # expect ~115
git log --oneline | wc -l                    # expect ~411, far below the monorepo's 609
git log --follow --oneline -- ccd/ccd | tail -3   # history reaches past the rename
```

If `ccd/ccd`'s checksum differs from the baseline, **stop**. The filter
corrupted the file and nothing downstream is trustworthy.

- [ ] **Step 6: Create the repo and push**

```bash
cd /tmp/ccrc-extract
gh repo create "$OWNER/ccrc-pwa" --private \
  --description "Self-hosted remote control for Claude Code sessions — installable PWA and its server side"
git remote add origin "https://github.com/$OWNER/ccrc-pwa.git"
git push -u origin HEAD:main
```

- [ ] **Step 7: Clone to its working location**

```bash
cd /srv/projects
git clone "https://github.com/$OWNER/ccrc-pwa.git" ccrc-pwa
cd ccrc-pwa && ls -1
```

---

## Task 4: Repoint the one line and get all three suites green

**Files:**
- Modify: `server/test/ccdWsHelpers.ts:10` (in `ccrc-pwa`)
- Modify: `.gitignore` (in `ccrc-pwa`)

**Interfaces:**
- Consumes: `CCD` from Task 2, now the sole definition.
- Produces: a repo whose three suites pass, matching the Task 1 baseline minus
  `ccd-ccclip.test.ts`'s cases.

- [ ] **Step 1: Repoint the path — the one permitted change**

In `/srv/projects/ccrc-pwa/server/test/ccdWsHelpers.ts`,
line 10:

```ts
export const CCD = path.resolve(__dirname, '../../../<server-host>-portability/ccd');
```

becomes:

```ts
export const CCD = path.resolve(__dirname, '../../ccd/ccd');
```

That is the entire code change in the extraction. Nothing else in the tree may
differ.

- [ ] **Step 2: Rewrite .gitignore for the flat layout**

The inherited file still names monorepo paths.

```
node_modules
.env
.env.local
.env.*.local

# ccrc build output
server/dist/
server/dist-pwa/
agent/dist/

# local, gitignored env files with real tokens
deploy/ccrc.env
deploy/ccrc-agent.env

# migration working artifacts
.extraction/
```

Keep `node_modules` bare, with no trailing slash. The monorepo's own comment
explains why: a bare pattern also catches a **symlink** named `node_modules`,
which `node_modules/` does not match — and worktrees use symlinks.

- [ ] **Step 3: Install dependencies**

```bash
cd /srv/projects/ccrc-pwa
for p in server agent pwa; do (cd $p && npm ci); done
```

`node-pty` is a native addon in `server/` and `agent/`; this needs a working
build toolchain. If it fails, that is a genuine finding for spec 3's prereq
list — record it, install the toolchain, and continue.

- [ ] **Step 4: Run all three suites and all three typechecks**

```bash
cd /srv/projects/ccrc-pwa
for p in server agent pwa; do
  echo "--- $p ---"
  (cd $p && ./node_modules/.bin/vitest run --reporter=dot 2>&1 | grep -E 'Test Files|Tests ')
  (cd $p && ./node_modules/.bin/tsc --noEmit >/dev/null 2>&1; echo "tsc exit=$?")
done
```

Expected against the Task 1 baseline:

| Package | Files | Tests |
| --- | --- | --- |
| `server/` | 54 (55 − `ccd-ccclip.test.ts`) | baseline − ccclip's cases, from Task 1 Step 8 |
| `agent/` | 13 | unchanged |
| `pwa/` | 40 | unchanged |

All three `tsc exit=0`.

`single-definition.test.ts` must pass unchanged: its `ccrcRoot` is
`path.resolve(here, '..', '..')`, which resolved to `infra/ccrc` in the monorepo
and resolves to the repo root here — same relative depth, so every path it
asserts still holds.

- [ ] **Step 5: Build the PWA**

Checked explicitly because `deploy.sh` never builds it, and a stale bundle is
invisible to every other signal in this list. That is exactly how a Jul 29
bundle shipped on Aug 2 behind a green deploy and a green `/health`.

```bash
cd /srv/projects/ccrc-pwa/pwa
npm run build
ls -la ../server/dist-pwa/index.html
ls -1 ../server/dist-pwa/assets/ | head
```

- [ ] **Step 6: Commit and push**

```bash
cd /srv/projects/ccrc-pwa
git add server/test/ccdWsHelpers.ts .gitignore
git commit -m "fix: resolve ccd inside the repo, and a .gitignore for the flat layout

The one line the extraction changes. CCD pointed out of the package tree at
a sibling directory in the monorepo; here the script it names lives at
ccd/ccd, inside the repo, which is the point of the move.

Every other file in the tree is byte-identical to its origin — see
scripts/extraction-manifest.sh and the verification in the plan."
git push
```

---

## Task 5: CI

**Files:**
- Create: `.github/workflows/ci.yml` (in `ccrc-pwa`)

**Interfaces:**
- Produces: a green Actions run over all three suites and all three typechecks.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
# The monorepo had no CI at all — these suites have only ever been run by hand,
# which is how an installed ccd sat 4,258 lines behind main without anyone
# noticing. This is the mechanism that keeps the extraction honest after the
# day it lands.
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        package: [server, agent, pwa]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: ${{ matrix.package }}/package-lock.json

      # tmux and git are real dependencies of the server suite: the ccd tests
      # execute the real bash script against fixture HOMEs. They are contained,
      # never reaching a real tmux server or a real remote, but the binaries
      # must exist.
      - name: Install system dependencies
        if: matrix.package == 'server'
        run: sudo apt-get update && sudo apt-get install -y tmux

      - name: Install
        working-directory: ${{ matrix.package }}
        run: npm ci

      # Local binary, never npx: `npx vitest` resolves to a global cache copy
      # with no jsdom and falsely reports "no tests" alongside 39 errors.
      - name: Test
        working-directory: ${{ matrix.package }}
        run: ./node_modules/.bin/vitest run

      - name: Typecheck
        working-directory: ${{ matrix.package }}
        run: ./node_modules/.bin/tsc --noEmit

  build-pwa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: pwa/package-lock.json
      - working-directory: pwa
        run: npm ci && npm run build
      # The build is only proven by its output existing. A green build step with
      # no artifact is the failure this repo has already shipped once.
      - run: test -f server/dist-pwa/index.html
```

- [ ] **Step 2: Push and watch it run**

```bash
cd /srv/projects/ccrc-pwa
git add .github/workflows/ci.yml
git commit -m "ci: run the three suites and three typechecks on every push

The monorepo had no CI. Green-at-extraction-time decays silently without
this, and the repo has already shipped one stale artifact behind a green
signal nobody measured.

The pwa build job asserts dist-pwa/index.html exists rather than trusting
the build step's exit code, for the same reason."
git push
gh run watch
```

Expected: four jobs green. If the server job fails on a missing binary, add it
to the `apt-get install` line and record it — it is a real finding for spec 3's
prereq list.

---

## Task 6: Final verification

Nothing new is built here. This task proves the five before it.

**Interfaces:**
- Consumes: `.extraction/manifest-before.txt` and `.extraction/suites-before.txt`
  from Task 1.

- [ ] **Step 1: Content identity — the central check**

> **Corrected during execution — read this before running the diff.** The plan
> originally compared against `.extraction/manifest-before.txt`, captured in
> Task 1 Step 6. That snapshot is taken **two commits too early**: Task 2 then
> edits seven test files, so the baseline is stale by exactly those seven
> (14 diff lines) before the extraction even happens. The correct baseline is a
> manifest of the tree **at the commit actually extracted**.
>
> Use `.extraction/manifest-at-extraction.txt`, and note both files live in the
> **worktree** — `/srv/ccrc-wt/extract/.extraction/` — not
> at the monorepo root. `manifest-before.txt` retains its value as the companion
> to `suites-before.txt`; it is simply not the content-identity baseline.

```bash
cd /srv/projects/ccrc-pwa
bash scripts/extraction-manifest.sh > /tmp/manifest-after.txt
diff /srv/ccrc-wt/extract/.extraction/manifest-at-extraction.txt \
     /tmp/manifest-after.txt
```

Expected: **exactly two lines of difference**, both naming the same file.

| Diff | Line | Why |
| --- | --- | --- |
| `<` and `>` | `server/test/ccdWsHelpers.ts` | The one permitted change — a changed file produces both a removed and an added line |

Three things that are *not* in the diff, stated so their absence is not mistaken
for a problem:

- **`.gitignore`** — the monorepo's lives at the repo root, not under
  `infra/ccrc/`, so the script picks it up in neither layout. Rewriting it in
  Task 4 is invisible here by design.
- **`server/test/ccd-ccclip.test.ts`** — excluded by the script in both
  layouts, so it appears in neither manifest and cannot mask its own removal.
- **`.github/workflows/ci.yml`** — Task 5 adds it, and standalone mode does scan
  `.github`. It is absent from this diff only because the baseline was taken at
  the extracted commit, which already predates it. If you run this check after
  Task 5 against a baseline that *did* include `.github`, expect one extra `>`
  line.

Any third line is a defect. Investigate before proceeding; do not adjudicate it
away.

**Measured on 2026-08-03:** run before Task 5, this diff returned exactly the
two expected lines and nothing else — 306 entries on both sides. Run *before*
Task 4, against the same baseline, it returned **nothing at all**: the
extraction itself was byte-for-byte identical across every one of the 306 files.
That empty diff is the strongest form of the check, because it isolates the move
from every subsequent edit, and it is worth reproducing in that order on any
future extraction.

- [ ] **Step 2: ccd byte-for-byte**

```bash
sha256sum /srv/projects/ccrc-pwa/ccd/ccd
sha256sum /srv/projects/OpenClawHetzner/infra/<server-host>-portability/ccd
wc -l /srv/projects/ccrc-pwa/ccd/ccd   # expect 5439
```

Both checksums must be
`2bc6287b5e8a882168118c6977e148547e4b2c18278011b616c8b9b23aa42f7d`. There is no
judgement call available: a 5,439-line bash program either moved intact or it
did not.

- [ ] **Step 3: Suite counts against the baseline**

```bash
cat /srv/projects/OpenClawHetzner/.extraction/suites-before.txt
cd /srv/projects/ccrc-pwa
for p in server agent pwa; do
  echo "--- $p ---"
  (cd $p && ./node_modules/.bin/vitest run --reporter=dot 2>&1 | grep -E 'Test Files|Tests ')
done
```

`server` files must be exactly baseline − 1, and `server` tests exactly
baseline − the ccclip count recorded in Task 1 Step 8. `agent` and `pwa` must
match exactly. Assert the subtraction; do not eyeball it.

- [ ] **Step 4: History continuity**

```bash
cd /srv/projects/ccrc-pwa
git log --follow --oneline -- ccd/ccd | wc -l              # ~115
git log --follow --oneline -- ccd/ccd | tail -3            # reaches past the rename
git log --oneline -- server/src/config.ts | wc -l          # non-trivial
```

- [ ] **Step 5: The live fleet is untouched**

The whole plan is supposed to have left the running system alone. Confirm it,
rather than assuming it.

```bash
ssh -p 2222 -i ~/.ssh/<your-key> you@<fleet-host> \
  'ls ~/.cc-sessions/*.uuid 2>/dev/null | wc -l; ~/.local/bin/ccd caps | head -3'
curl -fsS http://203.0.113.7:7788/health
```

Expected: 11 sessions, `ccd caps` reporting its verbs, `/health` green — all
identical to before the plan started. Nothing was deployed, so nothing should
have moved.

- [ ] **Step 6: Sync the spec**

Task 2 changed the contract: the spec permits seven differing files, the
implementation permits one. Plan and spec are one decision and must not
disagree.

Edit `docs/superpowers/specs/2026-08-03-ccrc-pwa-extraction-design.md`, in
"Verification protocol" → step 2, replacing the seven-file exception with the
one-line exception and noting that the collapse landed in the monorepo before
the move.

```bash
cd /srv/projects/OpenClawHetzner
git add docs/superpowers/specs/2026-08-03-ccrc-pwa-extraction-design.md
git commit -m "docs(ccrc): spec 0's content-identity check tightens to one line

Collapsing the seven ccd-path definitions BEFORE the move rather than after
makes the extraction a literal file copy: one line of ccdWsHelpers.ts may
differ, not seven files. Any other checksum mismatch is unambiguously a
defect rather than something a reviewer adjudicates."
```

- [ ] **Step 7: Merge the monorepo branch**

```bash
cd /srv/projects/OpenClawHetzner
git checkout main && git pull
git merge ccrc-pwa-extraction
cd infra/ccrc/server && ./node_modules/.bin/vitest run --reporter=dot 2>&1 | grep -E 'Test Files|Tests '
cd /srv/projects/OpenClawHetzner && git push
```

The monorepo keeps its copy of everything. Deleting it happens after spec 3,
once `ccrc-pwa`'s install path has been proven.

---

## Done when

- `ccrc-pwa` exists, private, with ~411 commits of preserved history
- Its manifest differs from the monorepo's in exactly the two expected lines
- `ccd/ccd` is byte-identical, sha256 `2bc6287b5e8a…`, 5,439 lines
- All three suites green, counts matching baseline minus the ccclip subtraction
- All three typechecks clean
- The PWA builds and `server/dist-pwa/index.html` exists
- CI green on `main`
- The monorepo's own suite still green, branch merged
- The live fleet is exactly as it was: 11 sessions, `ccd caps` responding,
  `/health` green

## Deliberately not done

No de-personalisation, no account-model change, no auth, no installer, no
portability seams, no deletion from the monorepo, no deploy cutover. **No
colleague is granted access to `ccrc-pwa`** — the tree still contains the
operator's tailnet name, box IPs, username, and home paths until spec 1 lands.
