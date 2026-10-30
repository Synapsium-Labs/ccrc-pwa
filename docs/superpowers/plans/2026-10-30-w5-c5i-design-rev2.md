# W5 Task C5i, design note revision 2: one bash log-line redactor on the three-row engine (D-7078, D-7289, D-7525; ARCH-67)

This revises the C5i design note, `docs/superpowers/plans/2026-10-27-w5-c5i-design.md` (called **the old note** below),
for the base it now builds on. That note is left as it is, because merged plans are append-only. **Where this file and the
old note differ, this file governs. Every difference is listed in §Differences from the old note.** Anything this file
does not list stands as the old note states it. The act the old note asked was ruled as option A (D-7289,
`docs/superpowers/plans/2026-10-28-w5-c5i-act-ruled.md`), and that ruling is unchanged.

## Deviations found

- **D-7525 (2026-10-30)** — C5i design rev 2: each `REGIONS` row names the file it is given in a new `file` field, and `source` keeps its meaning.

**D-7525.** A builder stopped at the old note's Step 0 item 2. #1866 (D-7321, D-7329) merged after the old note was
written. It added a third `REGIONS` row, `apicap`, and gave every row a `source` field. On `main`, `source` names the
text a row's `render` reads: `'ccd'` (the ccd file given to the engine) or `'hook'` (the `session-hook.sh` beside it).
`renderRegion`, `applyRegion` and `checkRegion` gained a fourth argument, `hookSrc`, and the CLI reads `session-hook.sh`
from beside its third argument. The old note used `source` for something else: a row's repository-relative source
path, with a basename identity check. It also expected two frozen rows plus `log-line`.

**The coordinator ruled:**

- `main`'s `source` field and its meaning stay unchanged.
- C5i's per-row file is a new field with a different name, `file`.
- Every check the old note put on `source` moves to `file`.
- The CLI and `cmd_restamp` contracts are restated for the three existing rows plus `log-line`, so that every existing
  caller of `hook`, `authdead` and `apicap` keeps working byte for byte.
- The `REGIONS` names pin becomes `['hook', 'authdead', 'apicap', 'log-line']`.

**What `file` is.** `file` is the repository-relative path of **the file the row is given**. That is the CLI's third
argument, and the engine's `ccdSrc` parameter. For a `source: 'ccd'` row, `render` reads that file's text. For the one
`source: 'hook'` row, `render` reads the `session-hook.sh` beside that file, as on `main`. Values:

| Row | `file` | `source` |
|---|---|---|
| `hook` | `ccd/ccd` | `ccd` |
| `authdead` | `ccd/ccd` | `ccd` |
| `apicap` | `ccd/ccd` | `hook` |
| `log-line` | `ccd/ccrc` | `ccd` |

`file` is not the target, the file that carries the region. `regionOf` still finds the target's row from its BEGIN
line, and no row stores a target path.

The ruling's example gloss was "the path the region lives in". For `apicap` that reading would give
`ccd/session-hook.sh`. That value would refuse today's `--check ccd/ccrc-api ccd/ccd` and change `cmd_restamp`'s
`apicap` refusal sentence. Only the given-file reading keeps those callers byte for byte, so this file uses it.

## Differences from the old note

Each item names the old note's section, what changed, and why. Items 1 to 9 come from the ruling (R) or from the new
base (B). Items 10 to 15 are clarifications (C) or follow this repository's test rules (T).

1. **(R) A new field, `file`, holds the per-row file. `source` is untouched.**
   - The old note gave each row `source: 'ccd/ccd'` and a log-line row `source: 'ccd/ccrc'`. This file adds `file`
     instead, with the values in the table above.
   - The three existing rows keep `main`'s `source` values: `'ccd'`, `'ccd'`, `'hook'`. The log-line row gets
     `source: 'ccd'`. `render` reads the given text, which `file` says is `ccd/ccrc`.
   - `sourceOf`, the CLI's `source === 'hook'` branch and `source`'s doc comment do not change.
   - A third `source` value, `'ccrc'`, is rejected. `sourceOf` and the CLI would then branch on each value, and the
     field would mean something new.
   - `sourceOf`'s message for a missing text ("renders from … ccd, which was not given") stays as it is. That message
     appears only on a direct module call that leaves the text out. The CLI always reads one.
   - The `.d.mts` gains `readonly file: string` on `GeneratedRegion` and `'log-line'` in its `name` union. Its `source`
     stays `'ccd' | 'hook'`.
2. **(R) The CLI identity check reads `file`, not `source`.** The old note's mismatch sentence named
   `whose source is <row.source>`. It now reads
   `hook-helpers: <target> carries the <label> region, whose file is <row.file>; <file> is not that file`, still exit 2,
   with nothing written. The `apicap` row's `file` is `ccd/ccd`, so every existing caller passes it unchanged: each
   gives a file named `ccd` (item 2 of §What was measured).
   - The check is still a behaviour change. A three-argument call whose given file has another basename works on
     `main` and is refused under C5i. On the base, `--check ccd/ccrc-api ccd/session-hook.sh` and
     `--check ccd/session-hook.sh ccd/ccrc` each print `hook-helpers: current` and exit 0 (item 11 of §What was
     measured). Under C5i both exit 2 with the refusal sentence.
   - So the check is not part of a move. It lands red-first in its own pair of commits, Steps 2e and 2f
     (item 15).
3. **(R, B) `--regions` stays byte for byte. The third column moves to a new mode, `--region-files`.**
   - The old note added a third column to `--regions`. On this base, an existing caller reads `--regions` with
     `read -r b l`: an installed `ccrc` whose `cmd_restamp` restamps a checkout's file. `cmd_restamp` takes the
     target tree's module first, so an installed `ccrc` from before C5i runs a newer checkout's module.
   - With a third column, that reader's label would gain a tab and the path, and its `restamp:` lines for `hook`,
     `authdead` and `apicap` would change.
   - So `--regions` keeps printing exactly `detect\tlabel\n` per row, and gains only the log-line row.
     `--region-files` prints `detect\tlabel\tfile\n`.
   - `_restamp_region_of` reads `--region-files`. When that prints nothing, it falls back to `--regions` with
     `file` set to `ccd/ccd`. A module from before C5i refuses an unknown mode with exit 2 and empty stdout.
   - This replaces the old note's "two-column module" default. A pre-C5i `ccrc` run against a C5i tree's
     `ccd-update-sync` passes `$dir/ccd`. The identity check refuses that with exit 2, so that `ccrc` dies on its
     existing "could not be read or written" sentence and writes nothing.
4. **(R) `cmd_restamp` resolves the file from the `file` column.** It uses the same `ccd/<name>` rule and the same
   refusal template as the old note. For `hook`, `authdead` and `apicap` the resolved file is `$dir/ccd`, so their
   refusal and verdict lines are byte-identical to `main`'s. That includes `apicap`'s refusal when `$dir/ccd` is
   missing.
5. **(R) The census switch reads `regionOf(programSrc).file`.** The old note read `.source`. For the three existing rows,
   `file` is `ccd/ccd`. That is C5a's rule (`ccdProgramBodies`, its library included), so no count moves for them.
6. **(R) The names pin becomes `['hook', 'authdead', 'apicap', 'log-line']`.** The old note had
   `['hook', 'authdead', 'log-line']`. The log-line row is appended **last**. That keeps `REGIONS[0]` the hook row for
   `regionOf(hook)` in the pinned test and for `census-w3/claimant.test.ts`'s `const [REGION] = REGIONS`.
7. **(B) The engine's signatures are `main`'s four-argument ones.** The old note said `renderRegion`, `applyRegion` and
   `checkRegion` take three. They keep `main`'s signatures, `hookSrc` included. The log-line row never reads `hookSrc`.
   Their doc comments name the third parameter "the given text" in place of "ccd's".
8. **(B) The gate is met, and option A is ruled.**
   - #1578 merged as `25393a0d7`. Its `ccd-update-sync#redact` is byte-identical to the head the old note measured,
     `0546dad26`, and so is `ccd/ccrc#_upd_redact` (§What was measured, item 6).
   - Option A was ruled under D-7289. §Problem 1's outcomes (B) and (C), the option-B variant of Step 0, and every
     "under B / under C" clause are therefore dead and are not restated.
   - The standing rule (re-extract both functions at every rebase) stays, with this base's digests.
9. **(B) Another reader of `REGIONS` exists, `server/test/census-w3/claimant.ts`.** It reads each row's `begin` and `end`
   only, through `regionSpans`. With the log-line row added, `ccd-update-sync`'s region becomes one of those spans.
   The region holds `_upd_redact`, which is no cap reader, and `capReaderCalls` reads `ccd/ccrc-api` only. So none of
   that census's counts move. Step 0 re-runs it, and §Verify lists it.
10. **(C) The CLI reads both files first, then checks identity.** The old note said the check runs "before reading either
    file". The row is only known after the target is read, so that order cannot be built. The order is:
    1. Read the target, then `<file>`, as on `main`. An absent file is still the uncaught `ENOENT`, exit 1, naming
       the path. This is the old note's CONTROL row, unchanged.
    2. Find the row.
    3. Run the identity check: exit 2, nothing written.
    4. Read the hook, for a `source: 'hook'` row only.

    `--restamp` on a file that carries no region still prints `nothere`, with no check.
11. **(C) The usage line names `<file>`.** The old note renamed `<ccd>` to `<source>`, which is now a field with another
    meaning. The usage line reads
    `usage: node shared/hook-helpers.mjs --write|--check|--restamp <target> <file> | --regions | --region-files`.
    No test or caller reads it (grep, §What was measured, item 2).
12. **(T) No test builds a `bash -c` string.**
    - The old note ran each corpus call as `bash -c '<definitions>…<call>'`, and its Step 6 re-point kept the `redact:`
      test's `bash -c` call.
    - Every redactor call in C5i's tests instead goes through one fixed driver, the shape `W29-Y6` already uses.
    - The definitions are written to a temporary file and run as `bash --noprofile --norc -s -- <defs> <input>`. Stdin
      is the fixed script `. "$1"\ninput="$(cat -- "$2")"\n<call>\n`.
    - `<call>` is one of three literals in the test source: `_upd_redact "$input"`, `_upd_redact "$input" bare-host`
      and `say "$input"`.
    - No path or environment value reaches a script's text.
13. **(C) Step 0 is renumbered 1 to 12, in order.** The old note's list ran 1–7, 10, 8, 11.
14. **(B) Growth and placement are re-measured on this base.** The `_restamp_region_of` fallback adds about three lines,
    so `ccd/ccrc` grows by about +11 code lines, still under 40. `ccd/lib/` now exists (`train-proof.sh`). The census
    already reads it as part of `ccd/ccd`'s program, and C5i edits nothing there.
15. **(T) The identity check and the usage line leave the moves.** An earlier draft of this file put the identity check
    in Step 2a, called a move, while §Must not change forbade any output change in a Step 2 commit.
    The two identity rows exit 0 `current` on the base, so 2a would have changed them with no red first.
    - Steps 2a to 2d are moves only: no call's stdout, stderr, exit code or written bytes changes in them, mismatched
      basenames included.
    - Step 2e adds the two identity rows, red on the commit before it (each still exits 0 `current`).
    - Step 2f adds the identity check and the `<file>` usage line, and turns them green. It is the one Step 2 commit
      that changes output, and only for a call whose given file's basename differs from its row's `file`.

No bypass case of the old note is dropped. The corpus rows (R1 to R7, the blast-radius rows and the invalid-byte
control), the scope pin, every masking mutant and the "never masks less" rules all stand. They are restated in full
below wherever their section changed.

## What was measured, and on what

Base `origin/main` `789dfdad1`, re-checked on `e38a2d5f1`. #1920 merged in between, and it changes nothing under
`ccd/`, `shared/` or `README.md`, and no test file this note names. Nothing under `ccd/` or `shared/` differs from
`25393a0d7`, the commit where #1578 merged.
The engine was last changed by #1866 (`b8855f8d4`). Run under macOS bash 5.3.20, `LC_ALL=C`, `HOME=/home/u`, with the
engine's own `ccdFunctionDefinition`. Open PRs were read with `gh pr list --state open --json number,files` the same day.

1. **The engine is #1866's shape.** `shared/hook-helpers.mjs` exports:
   - `REGIONS`: three frozen rows `hook`, `authdead` and `apicap`, each `{ name, label, begin, end, detect, source,
     render }`, with `source` values `ccd`, `ccd` and `hook`.
   - `regionOf(src)`, `renderRegion(row, ccdSrc, hookSrc)`, `extractRegion(row, src)`,
     `applyRegion(row, src, ccdSrc, hookSrc)`, `checkRegion(row, src, ccdSrc, hookSrc)` and
     `ccdFunctionDefinition(ccdSrc, name)`.
   - The private `sourceOf(row, ccdSrc, hookSrc)`, which gives `hookSrc` to a `source: 'hook'` row and `ccdSrc` to any
     other row, and throws when that text is not a string.

   The CLI:
   - reads `[mode, targetPath, ccdPath]`, and refuses a missing third argument with exit 2 and the usage line;
   - reads the target and then the ccd with `readFileSync`;
   - dispatches on `regionOf(target)`;
   - for a `source: 'hook'` row only, reads `session-hook.sh` beside `ccdPath`;
   - falls back to the hook row for `--write` and `--check`;
   - for `--regions`, prints `detect\tlabel` per row (three rows, measured byte for byte).

   The module imports `node:fs`, `node:url` and `./mark.mjs` only.
2. **The readers and callers, by grep over `ccd/`, `shared/`, `server/`, `deploy/` and `.github/`:**
   - One reader of `--regions`: `ccd/ccrc#_restamp_region_of` (`IFS=$'\t' read -r b l`).
   - The callers of the three-argument modes:
     - `ccd/ccrc#_restamp_hook_region`, called by `cmd_restamp` with `$dir/ccd` for every region, `apicap` included;
     - `ccd/ccrc#_restamp_hook_note`, which runs `--check` on the hook with a file whose basename is `ccd`;
     - four `--check` spawns in `server/test/hook-helpers-generated.test.ts`, on `session-hook.sh`,
       `ccd-account-health`, `ccrc-api` and the hook/auth-dead loop, each with `ccd/ccd`.
   - Through `ccd/ccrc restamp` over planted trees: `server/test/ccrc-restamp.test.ts` and the restamp rows of
     `hook-helpers-generated.test.ts`.
   - Every caller passes a file named `ccd`.
   - Readers of `REGIONS` outside the engine: `hook-helpers-generated.test.ts` and `census-w3/claimant.ts` (begin and
     end only), plus `census-w3/claimant.test.ts`, which reads `REGIONS[0]`.
   - Nothing outside the engine reads `source`. No test reads `--regions` or the usage line.
3. **`ccdFunctionDefinition` reads any bash source.** Over `ccd/ccrc` it returns `_upd_redact`'s whole 63-line definition,
   with no column-0 `}` inside it. It keeps its name, and its doc comment is reworded, as the old note states.
4. **`ccd/ccd-update-sync` still exports `LC_ALL=C` at top level, before `redact()` and `say`.** `say` is still
   `redact`'s only caller, and the file still has 30 `say "…"` lines. The old note's R4 finding holds.
5. **The exit-6 line still ends its host at `)`.** These are R6 and R7, as the old note defines them.
6. **#1578 as merged.**
   - `ccd-update-sync#redact` has the scheme loop and one scheme-less loop, and is byte-identical to `0546dad26`'s.
   - Its digest, sha256 over the `ccdFunctionDefinition` text, is
     `75da33ab517d3e871c372634ccae5d0ea32204e95ccf4b224df93a0cf9a3e559`.
   - `ccd/ccrc#_upd_redact` is byte-identical to `0546dad26`'s, digest
     `6f73d0ea664f412504fc3488152de36a0d6b37b955de507b2507393d5e302dd7`.
   - The sentence above `_upd_redact` that names how `ccd-update-sync` redacts reads: "`ccd/ccd-update-sync`, another
     executable, redacts at its own `say` with its own copy of all three rules (wave 29, R45, D-6984; its header says
     how)."
   - The tests #1578 added are in `server/test/ccd-update-sync.test.ts`:
     - the `redact:` test, whose seven R5 rows plus #1578's six scheme and authority rows make thirteen, and its
       section-equality assertion;
     - the `W29` describe, with `W29-Y1`, `W29-Y2`, `W29-Y4` and `W29-Y5` at program level, `W29-Y6` (which extracts
       `^redact() {` and drives it through `bash -s`), and `W29-Y3` (which reads the header above `\nredact() {`).
7. **Rule 6.** Five open PRs touch a C5i file. Two touch `ccd/ccrc` and four touch `README.md` (#1611 touches both).
   All are disjoint from C5i's edits.
   - `ccd/ccrc`, disjoint by function:
     - #1611: `_inst_step`, `cmd_install`, `_inst_caps` (a new block, not its `_upd_redact` call line), `cmd_update`,
       `_ver_flip_back`, `_uninst_units` and `CCRC_INST_SPINE`;
     - #1867: the `CCRC_SETTINGS` array and a new function after `_test_knobs`.

     Neither touches `_upd_redact`, the comment above it, `_restamp_region_of` or `cmd_restamp`.
   - `README.md`, disjoint by section. C5i adds one sentence to the generated-regions paragraph of §Contributing, after
     the sentence ending `bash ccd/ccrc restamp ccd/ccd-account-health`. The four PRs' hunks lie in other sections:
     - #1611: §Requirements;
     - #1619: §What a row's lifecycle reads off the registry (two hunks);
     - #1872: §Fleet coordination;
     - #1923: §Conflict radar (ccd-land-probe).
   - None of the five touches any C5i test or `shared/` file.
   - Two files C5i leaves unedited are pinned green by this note: `server/test/ccrc-restamp.test.ts` and
     `server/test/census-w3/claimant.ts`. No open PR touches either. A later PR that edits one is a rebase point: C5i
     re-runs that file on the rebased tip.
8. **The census compares a generated copy with `ccd/ccd` only.** `server/test/census-w5/redactors.ts#isGeneratedCopy`
   compares against `ccdFunctionTexts`, which is `ccd/ccd` plus its library. `census-w5/redactors.test.ts` is green on
   the base, with `logLineRedactors()` 2 and `inlineUserinfoStrips()` 1. The FIXTURE BEGIN line used by C5d is still
   not a `REGIONS` row. The census switch must still land before the region is inserted.
9. **Placement.** These old-note facts hold:
   - `_upd_redact`, `_restamp_region_of` and `cmd_restamp` lie outside `ccd/ccrc`'s platform block.
   - `ccd/contexts.tsv` and `ccd/contexts-edges.tsv` map `ccd/ccd` only.
   - `ccd/ccrc` is a `growth-check.test.ts` file. `ccd/ccd-update-sync` and `shared/hook-helpers.mjs` are not.
   - The `.mjs` carve-out allows `node:crypto`, `node:fs` and `node:url` only.
10. **The spot re-measure of the union.** `_upd_redact`'s own loops plus #1578's scheme-less loop after them were run
    on this base. On these rows each function's output equals the old note's before/after table:
    - R6: `could not resolve host in u:hunter2@h.invalid:9)`, `curl: (6) user@host`, `mail a@b`, `x (a@b)`, `h@"`;
    - R7: `u:p@)h/r`, ` S@)<?`;
    - blast radius: `see claude-session@abc.service`, `sets CCRC_MAIL_FROM=ops@example.com`, `ssh root@box`,
      `git HEAD@{1}`;
    - R1 to R3: `user:s3cret@127.0.0.1:1/rel/x`, `"tok@h/r"`, `https://u:p@x@h/r`, `https://u@//v@h/r`,
      `x:///u@/home/u/f`.

    Both functions are byte-identical to what the old note measured. So its fuzz figures and suite runs stand for this
    base. Step 0 re-runs the corpus and the suites on the CI image.
11. **The two identity rows on the base.** `node shared/hook-helpers.mjs --check ccd/ccrc-api ccd/session-hook.sh` and
    `node shared/hook-helpers.mjs --check ccd/session-hook.sh ccd/ccrc` each print `hook-helpers: current` and exit 0
    on `e38a2d5f1`. The base reads whatever file it is given as the ccd, and these two given files render the same
    regions as `ccd/ccd` does. Under C5i both exit 2 with the identity sentence, so Step 2e is red on Step 2d's tree.

## The union's blast radius

This section stands as the old note states it: the caller table, the rewrite table and the suite runs. The caller set
was re-read by grep on this base: the same functions, and every call still passes one argument. The rewrite rows were
re-measured (§What was measured, item 10). Under D-7289 (option A), this section is the reason the scope pin exists. It
is no longer an open act.

## Problem 2: the engine's contract (revised; replaces the old note's §Problem 2)

**The entry reads the file it is given. It never resolves a repository-relative path.** The argv:

```
node shared/hook-helpers.mjs --write|--check|--restamp <target> <file> | --regions | --region-files
```

**`<file>`** is the file the target's row is given, chosen by the caller:
- `ccrc restamp` chooses it from `--region-files`' third column.
- A test chooses it by naming `ccd/ccd` or `ccd/ccrc`.

Nothing in the module resolves `file` against a root, so the module states none. The two places that resolve it state
their root:
- `cmd_restamp` resolves against the target's own tree (`$dir/..`).
- The census resolves against its `root` argument.

**Order and identity check:**
1. Read the target, then `<file>`, both with `readFileSync` as on `main`. An absent file is the uncaught `ENOENT`, exit 1,
   with stderr naming the path. The old note's CONTROL row, pinned, not changed.
2. `row = regionOf(target)`. `--write` and `--check` use the hook row when it is null. `--restamp` prints `nothere` and
   stops.
3. Compare the last `/`-separated segment of `<file>` with the last segment of `row.file`. A mismatch writes nothing and
   exits 2 with one stderr line,
   `hook-helpers: <target> carries the <label> region, whose file is <row.file>; <file> is not that file`.
   - The segment is cut with `lastIndexOf('/')`, never with `node:path` (the carve-out).
   - The check is by basename because `_restamp_hook_note` passes a file it only knows is named `ccd`.
   - `file` is `ccd/ccd` for `hook`, `authdead` and `apicap`, and every caller in §What was measured item 2 passes a
     file named `ccd`. So the check changes no existing caller's output or exit code.
   - It does change a call whose given file has another basename: such a call goes from exit 0 (`hook-helpers:
     current` on the base, §What was measured item 11) to exit 2 with the sentence. That is why it lands in Step 2f,
     after its red in Step 2e, and not in a move.
4. When `row.source === 'hook'`, read `session-hook.sh` beside `<file>`, exactly as on `main`. Nothing else changes.

**`row.file` has four readers, each with a row and a mutant:**
- `--region-files` (its row);
- the identity check (the CLI identity rows);
- `cmd_restamp`, through `_restamp_region_of` (the planted-tree rows);
- the census (its FIXTURE rows).

**`row.source` keeps its two readers on `main`:** `sourceOf` and the CLI's hook read. Neither changes.

**`--regions` is byte-identical for the existing rows.** It prints `detect\tlabel\n` per row: three rows today, four
once the log-line row exists. Its only consumer is `_restamp_region_of`'s fallback, plus any pre-C5i `ccrc` (item 3 of
§Differences).

**`--region-files`** (new) prints `detect\tlabel\tfile\n` per row, `file` being the row's repository-relative path.

**`ccd/ccrc#_restamp_region_of`:**
- For the row whose `detect` the target carries, it prints `label`, a tab, and `file`.
- It reads `node "$1" --region-files` with `IFS=$'\t' read -r detect label file`.
- If that prints nothing (a pre-C5i module refuses the mode with exit 2 and empty stdout), it reads `node "$1" --regions`
  with `IFS=$'\t' read -r detect label`, and `file` becomes `ccd/ccd`. Every region of such a module was given `ccd/ccd`.
- Its comment names both modes.

**`ccd/ccrc#cmd_restamp`:**
- It splits `_restamp_region_of`'s output at the first tab into `what` (the label, as today) and `file`.
- It sets `srcfile` to `$dir/${file#ccd/}` when `file` is `ccd/<name>`, with a non-empty `<name>`, no further `/`, and
  no `..`. Any other `file` leaves `srcfile` empty.
- It then refuses, writing nothing, when `$hooks` or `$srcfile` is missing, with today's sentence and the file it lacks:
  `restamp: $f carries generated $what, but its own tree lacks $hooks or ${srcfile:-$file}; restamp it from a full
  checkout (the tree holding both ccd/ and shared/). Nothing was written.`
- For `hook`, `authdead` and `apicap`, `srcfile` is `$dir/ccd`. Their refusal, verdict and "could not be read or
  written" lines are therefore byte-identical to today's.
  - `apicap` still needs `$dir/ccd`, and still reads `$dir/session-hook.sh` through the module.
  - A missing `session-hook.sh` is still the module's `ENOENT`, which surfaces as today's "could not be read or
    written" line.
- One template serves every row, with the label `log-line redactor`.
- `_restamp_hook_region "$hooks" "$f" "$srcfile"` replaces `… "$ccdsrc"`.
- The `ccd/ccd` stamp-at-install refusal and `_restamp_hook_note` are unchanged.

## Problem 1: the gate, and #1578 (met and ruled)

**The gate is met.** #1578 merged as `25393a0d7`, and C5d (#1677) merged before it. **The act is ruled: option A**
(D-7289). It stands exactly as the old note's option A states it:
- `_upd_redact <text> [bare-host]`.
- With one argument, it is today's function in output.
- With `bare-host`, it also runs #1578's scheme-less loop, after its own.
- Only `ccd-update-sync`'s `say` passes `bare-host`, and a scope pin holds that.
- No `ccd/ccrc`, `update.json` or `ccrc doctor` line changes on any row.
- `ccd-update-sync`'s lines change only on R7, where more is masked.

**The standing rule, at every rebase and before queueing**, with this base's digests:
- `ccd-update-sync#redact` is `75da33ab517d3e871c372634ccae5d0ea32204e95ccf4b224df93a0cf9a3e559`.
- `ccd/ccrc#_upd_redact` is `6f73d0ea664f412504fc3488152de36a0d6b37b955de507b2507393d5e302dd7`.
- Both are sha256 over the `ccdFunctionDefinition` text.

Before each rebase onto `origin/main`, after it, and once more right before the coordinator's
`gh pr merge --match-head-commit`, the builder re-extracts both from `origin/main` and compares.
- Any difference stops the task. Step 0 is re-run on the new base, and the corpus and the before/after table are
  re-measured. The coordinator then decides whether D-7289 still covers the new rules.
- **A rebase conflict in `ccd-update-sync#redact`, or in the lines above `_upd_redact`, is never resolved by taking C5i's
  side.** C5i's side deletes a `redact` that may mask more than the `_upd_redact` it lands. The conflict stops the task
  the same way.

## Files and functions (replaces the old note's §Files and functions where they differ)

### `shared/hook-helpers.mjs` and `shared/hook-helpers.d.mts`

- Each `REGIONS` row gains `file`: `'ccd/ccd'` for `hook`, `authdead` and `apicap`. `source` is unchanged.
- A fourth row is **appended after `apicap`**:

  ```
  { name: 'log-line', label: 'log-line redactor', begin: LOGLINE_REGION_BEGIN, end: LOGLINE_REGION_END,
    detect: '# ── BEGIN GENERATED LOG-LINE REDACTOR', source: 'ccd', file: 'ccd/ccrc', render: renderLogLineBody }
  ```

  - `LOGLINE_REGION_BEGIN` is
    `# ── BEGIN GENERATED LOG-LINE REDACTOR (shared/hook-helpers.mjs; edit it in ccd/ccrc, then regenerate) ──`.
  - `LOGLINE_REGION_END` is `# ── END GENERATED LOG-LINE REDACTOR ──`.
  - `renderLogLineBody(src)` returns `ccdFunctionDefinition(src, '_upd_redact')` plus a newline. It throws
    `ccd/ccrc has no _upd_redact to copy` when that function is absent.
- The `REGIONS` doc comment gains one clause for `file`: the repository-relative path of the file the row is given,
  for the CLI's `<file>` and the engine's `ccdSrc`. A `source: 'hook'` row reads the hook beside it. The `source`
  clause keeps its words.
- `renderRegion`, `extractRegion`, `applyRegion` and `checkRegion` keep `main`'s signatures. Only their doc comments
  change.
- The CLI is as §Problem 2 states: the usage line, the identity check, and the `--region-files` mode, which is the
  `--regions` branch's twin with a third column.
- The header's region table gains the `log-line` row (target `ccd/ccd-update-sync`, `_upd_redact` copied from
  `ccd/ccrc`), and the header's regenerate line names `ccd/ccd-update-sync`.
- The `.d.mts` declares:
  - `LOGLINE_REGION_BEGIN`, `LOGLINE_REGION_END` and `renderLogLineBody`;
  - `readonly file: string` on `GeneratedRegion`;
  - `'log-line'` in its `name` union.

### `ccd/ccrc`

- `_restamp_region_of` and `cmd_restamp` as §Problem 2 states, with their comments naming `--region-files` and the
  fallback.
- `_upd_redact`'s mode (Step 4) and the switch sentence (Step 6) stand **exactly as the old note states them**:
  - `local s="${1:-}" mode="${2:-}" LC_ALL=C`.
  - #1578's loop in a second local, inside `if [ "$mode" = bare-host ]; then … fi`.
  - The one-sentence comment, and the usage line `` `_upd_redact <text> [bare-host]` ``.
  - The quoted sentence (§What was measured, item 6) becomes "carries a generated copy of this function
    (`shared/hook-helpers.mjs`'s log-line region) and redacts at its own `say`, with `bare-host`".
- No caller of `_upd_redact` in `ccd/ccrc` or `ccd/ccrc-doctor-checks` is edited.

### `ccd/ccd-update-sync`

Stands as the old note states it:
- The region sits after `redact()`'s closing brace and before `say`'s definition, so after `set +x` and after
  `export LC_ALL=C`.
- It is inserted with hand-written BEGIN and END lines and then `bash ccd/ccrc restamp ccd/ccd-update-sync`. That
  restamp now goes through `--region-files`, `file` `ccd/ccrc`, and `$dir/ccrc`.
- `say() { printf 'ccd-update-sync: %s\n' "$(_upd_redact "$1" bare-host)" >&2; }` lands in Step 6, and `redact()` and
  its header go at the same time.
- The comment between END and `say() {` carries the words `` `_upd_redact <text> bare-host` `` and "every rule of
  ccd/ccrc's `_upd_redact`".
- The validator comment names `_upd_redact`.

### `server/test/fixtures/redact/log-line.json` (new)

Stands as the old note states it, row for row. Each row is `{ rule, input | inputHex, home, locale, ccrc, bareHost,
updateSync }`. The rows:
- every literal row the `redact:` test and the three `_upd_redact` tests in `ccrc-update-phases.test.ts` pin today;
- R1: `user:s3cret@127.0.0.1:1/rel/x`, `"tok@h/r"`;
- R2: `https://u:p@x@h/r`, `https://a@b@c@h/r`, `https://u@//v@h/r`;
- R3: `http:/u:s3cret@h/r`, `https:///u:s3cret@h/r`, `file:///u@/home/u/x`, `note:/x@y/z`, and `x:///u@/home/u/f`
  under `C` and `utf8`;
- R4: `https://a<U+2003>b@h/r` and `https://u<U+2003>:p@h/r` under `utf8` and `C`;
- R5: `/home/u/.ccrc/x`, `/srv/home/u/x`, `/home/user2/f`, `<é>/home/u/x`, `/home/u<é>`, `<0xFF>/home/u/x`,
  `/home/u<0xFF>` and `file:///home/u/x`, each under `C` and `utf8`;
- R6: `could not resolve host in u:hunter2@h.invalid:9)`, `curl: (6) user@host`, `mail a@b`, `x (a@b)`, `h@"`;
- R7: `u:p@)h/r`, ` S@)<?`;
- the blast-radius rows: the sweep die's `claude-session@demo-gone.service` sentence, `see claude-session@abc.service`,
  `sets CCRC_MAIL_FROM=ops@example.com`, `ssh root@box`, `git HEAD@{1}`;
- the invalid-byte password control `https://u:S3cr<0xFF>etTOKEN@h/r`.

### `server/test/log-line-redact-corpus.test.ts` (new)

It makes three calls per row: `ccrc`, `bareHost` and `updateSync`.
- The definitions are extracted with `ccdFunctionDefinition`, as the old note states.
- The `updateSync` call is `say`'s definition plus every function it calls. Its stderr is read, with the prefix and the
  trailing newline cut. A CONTROL row reds when `say` is absent or its line lacks the prefix.
- Every call goes through the fixed driver in item 12 of §Differences:
  - the definitions are written to a temporary file, and the input is written to another;
  - bash runs as `bash --noprofile --norc -s -- <defs> <input>`, with the fixed stdin script and one of the three
    literal calls;
  - `HOME` is the row's, `LC_ALL` is the row's locale (`utf8` resolved by the probe the old note names), the
    environment comes from `ghContainedEnv`, and stdout is compared as bytes.
- The static scope pin stands:
  - every `_upd_redact` call in `ccd/ccrc` and `ccd/ccrc-doctor-checks` passes exactly one argument;
  - any call in `ccd/ccd-update-sync` that passes `bare-host` lies in `say`.

### `server/test/hook-helpers-generated.test.ts`

- It gets the rows in §Commit order.
- One existing pin is re-pointed by name: `is a row of the one engine, beside the hook's, and the module names both`.
  Its `REGIONS.map((r) => r.name)` goes from `['hook', 'authdead', 'apicap']` to
  `['hook', 'authdead', 'apicap', 'log-line']`. The title and its other three assertions stay byte-identical.
- Every existing `apicap` row stays green unedited. That includes its `--check ccd/ccrc-api ccd/ccd` spawn and its
  `ccrc restamp ccd/ccrc-api` planted-tree row.

### Unedited test files

- **`server/test/ccrc-restamp.test.ts`**: unedited and green. Its trees copy the real module, and `--regions` keeps its
  bytes.
- **`server/test/census-w3/claimant.ts` and `claimant.test.ts`**: unedited and green (§Differences, item 9).

### `server/test/ccd-update-sync.test.ts`

The re-points in §Guards.

### `server/test/census-w5/redactors.ts` and `redactors.test.ts`

The census rule switches to the region row's `file`. For a program other than `ccd/ccd`, a `generated` body is
compared with the function of the same name in `regionOf(programSrc).file` under the census's `root`:
- `ccdProgramBodies` when that file is `ccd/ccd`, and `bashBodies` of the file otherwise;
- the row is found through the engine's `REGIONS`, imported;
- a region that matches no row compares with `ccd/ccd` (C5a's rule, which C5d's FIXTURE regions plant).

`logLineRedactors()` and `inlineUserinfoStrips()` both apply this rule through one helper. `census-w5/accountMarkers.ts`
keeps C5a's rule.

### `server/test/single-definition/docs-l0.test.ts`

The ratchet, a `describe` appended after the file's last line. It is the named rebase point with any later block.

### `README.md`

After the auth-dead sentence, one sentence: `ccd/ccd-update-sync` carries the module's log-line region, `_upd_redact`
copied from `ccd/ccrc`; after editing it, run `bash ccd/ccrc restamp ccd/ccd-update-sync`.

## Commit order (replaces the old note's; the one order, option A's)

Branch `refactor/arch-67-log-line-redactor`, from `origin/main`. Every commit runs the corpus test once it exists, and
states its result. "No output change" keeps the old note's meaning, with one addition: `ccrc restamp`'s lines for the
`hook`, `authdead` **and `apicap`** regions stay byte-identical. Steps 2a to 2d are moves, with no output change for
any call. Step 2f is the one Step 2 commit that changes output, after its red in Step 2e (§Differences, item 15).

1. **Step 1, characterization** (`test(redact): …`).
   - Add the corpus file and its test, with each row's expected output on the base. `updateSync` is `say` over
     #1578's `redact`.
   - Re-run unedited and record these files:
     - `ccd-update-sync.test.ts`, `ccrc-update-phases.test.ts`, `hook-helpers-generated.test.ts`,
       `ccrc-restamp.test.ts`;
     - `census-w5/redactors.test.ts`, `census-w3/claimant.test.ts`.
   - This commit's name is the PR body's characterization pin.
2. **Step 2a, each region names its file** (move).
   - The change: `file` on the three rows; the `.d.mts`; the census switch with its FIXTURE row. The CLI is not
     touched: no identity check, and the usage line keeps `<ccd>`.
   - New rows:
     - each existing row's `file` is `ccd/ccd`, and `REGIONS.map((r) => r.source)` is `['ccd', 'ccd', 'hook']`, so the
       pin holds `source`'s meaning;
     - the absent-file CONTROL: exit non-zero, stderr names the path.
   - Census FIXTURE. The log-line row does not exist yet, so 2a plants the auth-dead row's real BEGIN line:
     - `ccd/sibling` carries that BEGIN line, a stamp line and a byte copy of `fx_redact`;
     - it counts zero extra sites when the planted `ccd/ccd` holds `fx_redact`, and one (`ccd/sibling#fx_redact`) when
       it does not;
     - C5d's FIXTURE rows stay green unedited.
3. **Step 2b, restamp reads each region's file** (move).
   - The change: `--region-files`, `_restamp_region_of` with its fallback, and `cmd_restamp`.
   - New rows:
     - `--region-files` prints three tab-separated columns per row, `ccd/ccd` for all three;
     - `--regions` prints exactly `${r.detect}\t${r.label}\n` per row (the byte pin for the pre-C5i reader);
     - a planted tree whose module gives the auth-dead row `file: 'ccd/ccd-alt'`, with `ccd/ccd-alt` holding changed
       writers, regenerates `ccd-account-health` from `ccd-alt` and then answers `current`;
     - a planted module whose row names `shared/x` refuses, naming `shared/x`, and writes nothing;
     - a planted module with the `--region-files` branch removed still regenerates the hook region from `$dir/ccd`.
   - The existing `ccrc restamp ccd/ccrc-api` row stays green unedited.
4. **Step 2c, the log-line row** (move: no shipped file carries the region yet).
   - The change: the row (appended fourth), the constants, the renderer, the header table, the `.d.mts`, the doc
     comment of `ccdFunctionDefinition`, and the re-pointed names pin `['hook', 'authdead', 'apicap', 'log-line']`.
     The `source` pin becomes `['ccd', 'ccd', 'hook', 'ccd']`.
   - Engine rows:
     - `renderRegion(LOGLINE, ccrc)`'s body is `ccdFunctionDefinition(ccrc, '_upd_redact')` plus a newline, stamped
       and verifying;
     - `renderRegion(LOGLINE, ccrc, hook)` equals `renderRegion(LOGLINE, ccrc)`, so `hookSrc` is not read;
     - over a planted target carrying the region, a hand edit reads `edited`, `ccrc` with `_upd_redact` changed reads
       `stale`, and `applyRegion` brings it back to `current`;
     - `--region-files`' log-line row ends in `ccd/ccrc`, and `--regions` has a fourth two-column row.
   - Restamp rows:
     - `ccrc restamp` over a planted tree prints `log-line redactor regenerated`, and `--check` then answers `current`.
       The tree holds `ccd/ccd` with no `_upd_redact`, `ccd/ccrc` with it changed, and `ccd/ccd-update-sync` carrying
       the region;
     - the same over a tree without `ccd/ccrc` refuses with the sentence naming `$dir/ccrc`, and writes nothing.
   - Census FIXTURE, the log-line case:
     - a planted `ccd/ccrc` holds `fx_redact`, `ccd/ccd` does not, and `ccd/sibling` carries the log-line BEGIN line, a
       stamp line and a byte copy;
     - it counts `['ccd/ccrc#fx_redact']`;
     - with one byte of the copy changed, it counts `['ccd/ccrc#fx_redact', 'ccd/sibling#fx_redact']`.
   - `census-w3/claimant.test.ts` stays green unedited.
5. **Step 2d, the region in `ccd-update-sync`** (move). This stands as the old note states it:
   - the region, its comment and the README line;
   - the anchored section lookup in `ccd-update-sync.test.ts`, a named re-point;
   - the rows: the shipped region is `current` against `ccd/ccrc`; `--check ccd/ccd-update-sync ccd/ccrc` prints
     `hook-helpers: current`, exit 0; and the region's place;
   - census at this commit: `logLineRedactors()` 2, `inlineUserinfoStrips()` 1.
6. **Step 2e, red for the identity check** (`test(hook-helpers): red, …`).
   - The CLI identity rows: `--check ccd/session-hook.sh ccd/ccrc` and `--check ccd/ccrc-api ccd/session-hook.sh` each
     exit 2 with the sentence and write nothing. The second shows that `apicap` is given ccd, not the hook.
   - Both are red on this commit's tree: each prints `hook-helpers: current` and exits 0 (§What was measured,
     item 11). The commit states that result.
   - Rows the check must keep green are added in the same commit and are green here: `--check ccd/ccrc-api ccd/ccd`
     (existing, unedited) and `--check ccd/ccd-update-sync ccd/ccrc` (2d's row).
7. **Step 2f, the identity check** (`feat(hook-helpers): …`, behaviour).
   - The change: the CLI's identity check (§Problem 2, step 3) and the usage line naming `<file>`.
   - Step 2e's two rows turn green. No other row moves: every caller in §What was measured item 2 gives a file named
     `ccd`, and the log-line row is given `ccrc`.
   - The output change is exactly this: a call whose given file's basename differs from its row's `file` goes from
     exit 0 to exit 2 with the refusal sentence, and writes nothing. The usage line's `<ccd>` reads `<file>`.
8. **Step 3, red for the mode** (`test(redact): red, …`). Stands: the `bareHost` column and the scope pin. A `ccrc` value
   that would change stops the task.
9. **Step 4, the mode commit.** Stands, with the subject
   `feat(ccrc): _upd_redact's bare-host mode also masks a run whose host ends at ')' or the text's end (D-7078)`.
10. **Step 5, red for the switch.** Stands: `updateSync` moves on exactly the R7 rows.
11. **Step 6, the switch behaviour commit.** Stands, with the subject
    `fix(update-sync): one log-line redactor; journal lines also lose a run followed by ')' (OA-C12 (a), option A; D-7078)`.
    The re-points go through the fixed driver (§Guards).
12. **Step 7, the ratchet.** Stands:
    - `logLineRedactors()` equals `['ccd/ccrc#_upd_redact']`, and may only shrink;
    - `inlineUserinfoStrips()` equals `['ccd/ccrc-doctor-checks#_check_box-settings']`.

## Guards the work turns red, and their re-points

| Guard | Turns red in | Why | Re-point |
|---|---|---|---|
| `ccd-update-sync.test.ts`, the `redact:` test's section lookup | would, in 2d, if the region sat above `redact()` | `redact() {` is a substring of `_upd_redact() {` | anchored `\n${fn}() {` in 2d; a row pins the place |
| the same test: the `/^redact\(\) \{…\}$/m` extraction, its thirteen rows | Step 6 | `redact()` is deleted | all thirteen run against the region's `_upd_redact` (`ccdFunctionDefinition(sync, '_upd_redact')`), called through the fixed driver as `_upd_redact "$input" bare-host`, each value unchanged. The test's own `bash -c` call goes with it (§Differences, item 12) |
| the same test, the section-equality assertion | Step 6 | its `redact` side is gone | replaced by the 2d rows and the `stale`/`edited` rows |
| the same test's title | Step 6 | it names a deleted function | `the generated _upd_redact: a HOME that is the suffix of a longer path stays whole …, and the region is current against ccd/ccrc (review 167 F5)` |
| `W29-Y6` | Step 6 | it extracts `^redact() {` | it extracts the region's `_upd_redact`, and its stdin script calls `_upd_redact "$input" bare-host`; title, fixture and expected output unchanged |
| `W29-Y3` | Step 6 | the header above `\nredact() {` is deleted | it reads the comment lines between the region's END line and `\nsay() {`: `` `_upd_redact <text> bare-host` ``, `not.toContain('the same two rules')` kept, `/every rule of ccd\/ccrc's `_upd_redact`/`; the title reads `the comment above say() names the rules it applies, not "the same two rules"` |
| `W29-Y1`, `W29-Y2`, `W29-Y4`, `W29-Y5` | none | the union masks at least what `redact` does | none; re-run in Steps 4 and 6 |
| `ccrc-update-phases.test.ts`'s kept-list row, `ccrc-sweep-window.test.ts` `W5` and `W7` | none | no `ccd/ccrc` caller passes `bare-host` | none; re-run in Steps 4 and 6 |
| the corpus `bareHost` column and the scope pin | Step 3, green in Step 4 | `_upd_redact` ignores a second argument | the union's values |
| the corpus `updateSync` column on R7 | Step 5, green in Step 6 | the switch masks them | `)h/r`, ` )<?` |
| `hook-helpers-generated.test.ts`, the `REGIONS` names pin | 2c | a fourth row | `['hook', 'authdead', 'apicap', 'log-line']` |
| `census-w5/redactors.test.ts` REAL rows | would, in 2d, under C5d's rule | the copy is compared with `ccd/ccd` | the census switch to `file` lands in 2a |
| `census-w3/claimant.test.ts` | none | it reads `begin`/`end` only, and `REGIONS[0]` stays the hook row | none; re-run in 2c and 2d |
| `rings/mjs-node.test.ts` | would, on a `node:path` import | the `.mjs` carve-out | `lastIndexOf('/')` |
| `raw-spawn-census.test.ts` | would, on a spawn with the parent's env | the census's rule | every new spawn passes `ghContainedEnv` |

C5i does not edit any of these:
- `ccd/ccd`, `ccd/lib/`, `ccd/contexts.tsv` or `ccd/contexts-edges.tsv`;
- either platform block, or `census-w5/accountMarkers.ts`;
- `census-w3/claimant.ts`, `ccrc-restamp.test.ts`, `ccrc-update-phases.test.ts` or `ccrc-sweep-window.test.ts`;
- any doctor, install or fetch suite;
- any `_upd_redact` caller in `ccd/ccrc` or `ccd/ccrc-doctor-checks`.

## Counted exits

| Count | Base | Tip |
|---|---|---|
| `logLineRedactors()` | 2: `ccd/ccrc#_upd_redact`, `ccd/ccd-update-sync#redact` | 1: `ccd/ccrc#_upd_redact` (the copy counts zero), pinned, may only shrink |
| `inlineUserinfoStrips()` | 1: `ccd/ccrc-doctor-checks#_check_box-settings` | 1, the same |
| shipped bash functions named `redact` | 1 | 0 |
| `REGIONS` rows | 3 | 4 |
| `REGIONS` rows whose `source` is `hook` | 1 | 1 |
| `--regions` columns | 2 | 2 (byte-identical on the three existing rows) |
| readers of `--region-files` | — | 1 (`_restamp_region_of`) |
| readers of `--regions` | 1 | 1 (`_restamp_region_of`'s fallback) |
| `say "…"` call lines in `ccd-update-sync` | 30 | 30 |
| `ccd/ccrc` growth | — | about +11 code lines (Step 0 measures; under 40) |

The PR body prints the census at base and tip, by name and site. It also prints the old note's before/after table,
re-measured at Step 0. "Today" and "base" are now the same commit, because #1578 has merged. The table's "Base `redact`"
column is the shipped `redact`, and its "Today's `_upd_redact`" column is unchanged.

## Mutation table (Step 8, run on the tip, one at a time)

| Mutant | Reds |
|---|---|
| a hand edit inside the shipped region | the shipped region's `current` row (`edited`) |
| `_upd_redact` edited in `ccd/ccrc` without a restamp | the shipped region's `current` row (`stale`) |
| the log-line row's `file` set to `ccd/ccd` | the identity check refuses `--check ccd/ccd-update-sync ccd/ccrc` (the 2d CLI row), and the planted-tree log-line restamp row; with `cmd_restamp` then passing `$dir/ccd`, render throws (no `_upd_redact` in ccd) |
| the log-line row's `source` set to `hook` | the render rows and the shipped region's `current` row (the hook has no `_upd_redact`), and the `source` pin |
| the `apicap` row's `file` set to `ccd/session-hook.sh` | the existing `--check ccd/ccrc-api ccd/ccd` row (identity refusal), and the 2a `file` pin |
| `cmd_restamp` passes `$dir/ccd` for every region | the planted-tree log-line restamp row (identity refusal), and the `ccd/ccd-alt` row |
| the identity check removed | both Step 2e CLI identity rows |
| `--region-files` drops its third column | the `--region-files` row, and the planted-tree log-line restamp row (the fallback's `ccd/ccd` is wrong for it) |
| `--regions` gains a third column | the `--regions` byte pin |
| `_restamp_region_of` reads two names from `--region-files` | the planted-tree restamp rows (the label carries the file) |
| `_restamp_region_of`'s fallback to `--regions` removed | the module-without-`--region-files` row |
| `cmd_restamp`'s `ccd/<name>` check removed | the `shared/x` refusal row |
| the census compares with `ccd/ccd` again | the 2a/2c FIXTURE rows and the ratchet |
| the log-line row placed anywhere but last | the names pin (and, placed first, `regionOf(hook)`'s `REGIONS[0]` assertion) |
| the region moved above `set +x` | the first-line row |
| the region moved away from `say` | the region's-place row |
| `say` calls a reinstated local `redact` (the base's) | the ratchet, and Step 5's R7 corpus rows |
| `_upd_redact`'s home boundary check removed (both files, restamped) | the corpus R5 rows, both columns |
| its scheme loop cut to one pass | the R2 rows |
| its `:(/+)` cut to `://` | the R3 rows |
| its `LC_ALL=C` removed | the `utf8` R4 corpus rows |
| its first scheme-less loop removed (the mode keeps the second) | the R7 corpus rows, `bareHost` and `updateSync` |
| its second scheme-less loop removed (the mode reverted) | the R6 and blast-radius corpus rows, `bareHost` and `updateSync`, and `W29-Y4` |
| the mode's guard dropped (the second loop runs for every caller) | the corpus `ccrc` column on the R6 and blast-radius rows, `ccrc-update-phases.test.ts`'s kept-list row, and `ccrc-sweep-window.test.ts` `W5` and `W7` (Linux) |
| a `ccd/ccrc` or `ccd/ccrc-doctor-checks` caller passes `bare-host` | the scope pin |
| `say` drops `bare-host` | the R6 corpus rows' `updateSync` column, and `W29-Y4` |
| both scheme-less loops removed | the R1 corpus rows as well |

## Step 0 (measure before the first commit; report any value that differs first)

1. **The base.** `origin/main`, with #1578 merged (`25393a0d7`).
   - Record the digests of `ccd-update-sync#redact` and `ccd/ccrc#_upd_redact`. They must equal §Problem 1's, or the
     difference is reported first.
   - Quote the sentence above `_upd_redact` that names how `ccd-update-sync` redacts, as item 6 of §What was measured
     quotes it.
2. **The engine's shape**, as item 1 of §What was measured lists it: three rows, `source` values `ccd`, `ccd`, `hook`,
   the four-argument signatures, and `--regions`' two columns. Any other shape is reported first. A fourth row merged
   since this note is reported first too: the names pin, the append position and the `file` table are re-decided.
3. **The readers and callers**, as item 2 lists them, by grep over `ccd/`, `shared/`, `server/`, `deploy/` and
   `.github/`:
   - the `--regions` readers;
   - the three-argument callers, each passing a file named `ccd`;
   - the readers of `REGIONS` and of `source`.

   List them by name in the PR body. A caller that passes another basename is reported first, because the identity
   check would refuse it. Also re-run the two identity rows of §What was measured item 11 and record that each prints
   `hook-helpers: current` and exits 0 on the base; any other result is reported first.
4. `export LC_ALL=C` still comes before `say`. `say` is still the only caller of `redact`, with 30 `say "…"` lines. The
   `W29` rows and `redact:` rows read as §Guards names them.
5. `ccdFunctionDefinition(ccrc, '_upd_redact')` returns the whole definition.
6. `logLineRedactors()` is 2 and `inlineUserinfoStrips()` is 1. C5d's FIXTURE BEGIN line is still not a `REGIONS` row.
7. `census-w3/claimant.test.ts` is green on the base. Its census reads only `begin` and `end` from `REGIONS`.
8. **The corpus on the CI image.** Run it on glibc bash 5.2 with `C.UTF-8`, and on musl when available, against the old
   note's measured values and the before/after table.
9. **The suites on the CI image**, run once on the base and once with Step 4's mode applied in a scratch tree:
   - every suite that reaches `_upd_redact`:
     `git grep -l -e _upd_redact -e _upd_phase -e UPD_REDACT_ACTIVE -e box-settings -e _upd_sweep server/test`;
   - every test file naming `ccd/ccrc` or `ccrc-doctor-checks`;
   - every file importing the install, update or sweep fixtures.

   With the mode, **no** row may red that the base passes, and any red stops the task. The same run with the guard
   dropped must red exactly `W5`, `W7` and the `ccrc-update-phases.test.ts` kept-list row. A different set is reported
   first.
10. **Every `_upd_redact` caller**, by file and function, each passing one argument. A new caller is added to the PR
    body's table and to the scope pin's scan.
11. **Rule 6** against #1611, #1619, #1867, #1872, #1923 and any PR opened since that holds any of these, by function,
    section or line range:
    - `ccd/ccrc` or `ccd/ccd-update-sync`;
    - `README.md` (C5i's sentence in §Contributing's generated-regions paragraph);
    - `shared/hook-helpers.mjs` or `shared/hook-helpers.d.mts`;
    - `server/test/ccd-update-sync.test.ts` or `server/test/hook-helpers-generated.test.ts`;
    - `server/test/census-w5/redactors.ts` or `server/test/single-definition/docs-l0.test.ts`;
    - `server/test/ccrc-restamp.test.ts` or `server/test/census-w3/claimant.ts`, unedited by C5i but pinned green
      (a PR that edits one is a rebase point, and C5i re-runs that file).
12. **At every rebase and before queueing**, §Problem 1's standing rule applies.

## Verify (one at a time, from `server/`, `--maxWorkers=2`)

The old note's list, plus `census-w3/claimant`:
- `log-line-redact-corpus`, `ccd-update-sync`, `ccrc-update-phases`, `ccrc-sweep-window`, `ccrc-update-fetch`,
  `ccrc-update-kept`;
- `ccrc-doctor-codex`, `ccrc-install-role`, `ccrc-doctor-exposure`, `ccrc-rollout`, `update-watchdog-revert`,
  `update-killed-arms`;
- `hook-helpers-generated`, `ccrc-restamp`, `census-w5/redactors`, `census-w5/accountMarkers`, `census-w3/claimant`;
- `single-definition/docs-l0`, `single-definition/roster-bash`, `rings/mjs-node`, `raw-spawn-census`, `macos-platform`;
- `token-files`, `update-intent-cross-side`, `update-projection`, `module-format`, `growth-check`, `citations`,
  `deviation-refs`, `anchors`;
- both `tsc` runs.

The `itLinux` rows are judged on CI's Linux legs. The ccd bash suites run in the CI image, as a non-root user with
`--tmpfs /tmp:exec` and `CCD_DISK_FLOOR_GB=1`, on a real checkout with `origin/main` fetched.

## What does not apply to C5i

Stands as the old note states it: OA-C11 (a), the runner budgets, the growth waiver D-7081, and the platform block and
K rows. C5i still adds no node process to any ccd verb or timer. `--region-files` is read only by `ccrc restamp`, a
developer verb.

## Must not change

- `_upd_redact "$text"`'s output on every row, at every commit, with one argument, for every `ccd/ccrc` and
  `ccrc doctor` caller.
- Which lines `ccd-update-sync` prints, and where.
- `ccd-update-sync`'s output on every row outside R7 (and on R7 only in Step 6).
- Any output in Steps 2a to 2d, for any call, a given file of any basename included.
- In Step 2f, any output except the identity refusal of a call whose given file's basename differs from its row's
  `file` (exit 0 `current` on the base, exit 2 with the sentence after), and the usage line's `<file>`.
- Masking: no output on any row may mask less than the base's.
- **The engine's behaviour for the three existing rows**:
  - `--regions`' bytes;
  - every three-argument call's stdout, stderr, exit code and written bytes when it is given a file named `ccd`, `apicap`
    included. A call given a file of another basename is refused from Step 2f on; that is the one behaviour change to
    these rows, red first in Step 2e;
  - `source`'s values and its two readers.
- `ccrc restamp`'s lines for the `hook`, `authdead` and `apicap` regions.

**Rollback:** `ccrc rollback`, or `git revert` of the PR.
