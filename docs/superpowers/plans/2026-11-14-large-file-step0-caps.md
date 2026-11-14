# Large-file programme step 0, part 1: growth caps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** give the growth check its third stage. A file is **listed** (40 net code lines per PR, waivers count),
**frozen** (10 per PR, no waivers, only the operator's named exemption passes), or **capped** (an absolute number of
code lines that may only fall). Step 0 sets the first caps.

**Architecture:** all of it lives in the growth check's measuring half, `server/test/growthCheck.ts`, beside the
listed stage. It reuses the counter that measures today's per-PR rows (`codeLines`), the merge-base read
(`fileAt`, `gitRead`) and the named exemption (`growth-exemptions.json`, read from `origin/main`). Caps and freezes are
directories of one JSON file per file, so two PRs never edit one line.

**Spec:** `docs/superpowers/specs/2026-11-13-large-file-programme-design.md` (D-8615), §4 "From budgets to caps" and
"Operator acts in the console", approved 2026-11-14 with every answer as recommended (§5: Q2 the one cap rule, Q5
`shared/api.ts` capped now, Q6 `history-replay.mjs` capped only, Q8 the freeze, Q10 ledger items with a console
control). The growth check it extends: D-5848, D-6211 (the named exemption), D-6223 (waivers), D-8563 (every large
file listed, waivers dated).

## Ledger

- **D-8635 (2026-11-14)** — `large-file-step0-caps`: the growth check's three stages (listed 40 per PR, frozen 10 per
  PR with no waivers, capped), caps in `server/test/growth-caps/` and freezes in `server/test/growth-frozen/`, one JSON
  file per file; the named exemption may raise a cap, once, for its PR; the first caps, each the code lines measured on
  this PR plus 40.

## The rules

**One cap file per capped file:** `server/test/growth-caps/<slug>.json`, the slug being the path with every run of
characters other than `a-z0-9` turned into `-`, lower case (`shared/api.ts` → `shared-api-ts.json`). Exactly
`{file, cap, d, since}`: `cap` a positive integer, `d` a D-number a plan defines, `since` a day not in the future.

**One freeze file per frozen file:** `server/test/growth-frozen/<slug>.json`, exactly `{file, d, since}`. The file must
be listed. This is what the coordinator writes when the operator taps "start" on a file's ledger item (the pin PR).

**The check, per file the growth check measures** (the listed files, the ccd libraries, and now every capped file at
the merge-base or HEAD):

1. **Capped** (a cap file at the merge-base or at HEAD names it). The per-PR limit and every waiver are dropped:
   ledger waivers, the new-file home waiver and another file's shrink. The row fails when
   - its code lines at HEAD exceed the cap at HEAD;
   - the cap is new on this PR and above the code lines at HEAD plus 40 (the one rule: measured plus 40);
   - the cap rose from the merge-base's, unless an exemption on `origin/main` names this PR and this file and covers
     the rise (`cap`, in the exemption, bounds the rise), with the growth check's own files untouched. An exemption
     names one PR, so it raises a cap once;
   - the cap file is gone at HEAD while the file still has code lines (a cap may only fall; a deleted file takes its
     cap with it);
   - the cap is new on this PR and the file grew past the per-PR limit of the stage it held at the merge-base: 10 if a
     freeze names it at either sha (no waiver counts), else 40 with the listed waivers (a file no list named is judged
     as listed in the PR that caps it), the named exemption passing either. Without this, a PR could grow a listed or
     frozen file by any amount by adding its cap file at the new code lines plus 40.
2. **Frozen** (a freeze file at the merge-base or at HEAD names it, and no cap does): the row fails when the file grew
   by more than `SPINE_LIMIT` (10) net code lines, unless an exemption on `origin/main` names this PR and file and
   covers the delta. No waiver of any kind counts. Reading the merge-base too means a PR cannot unfreeze itself.
3. **Listed:** unchanged (40 per PR, waivers, home waiver, shrink waiver, exemption).

A cap or freeze directory that is malformed at either sha is a failing row of its own: a malformed cap must never read
as no cap.

## What the coordinator writes after the operator's tap (Q10)

The console control is NOT in this PR (see "Open follow-up"). The files it leads to are:

| Tap on the ledger item | The coordinator writes | Where it lands |
| --- | --- | --- |
| Start a file | `server/test/growth-frozen/<slug>.json`: `{file, d, since}` | the file's pin PR |
| Grant an exemption | one entry `{pr, file, cap, reason, ruling, since}` in `server/test/growth-exemptions.json` (D-6211's format, unchanged); `ruling` cites the ledger item's D-number; `cap` bounds the delta of a listed or frozen file, or the cap's rise for a capped one | `main`, before the PR's run reads it |
| Close a file | `server/test/growth-caps/<slug>.json`: `{file, cap, d, since}`, `cap` = code lines at HEAD + 40, and its freeze file removed | the file's closing (cap) PR |

## Step 0's caps

Measured by `codeLines` on 2026-11-14 at `391b5c65b`, over every tracked file that is not a test, fixture, doc, data or
lockfile (the large-file row's filter). Each cap is the code lines plus 40.

Files between 1,500 code lines and 3,000 lines:

| File | Lines | Code lines | Cap |
| --- | ---: | ---: | ---: |
| `ccd/ccrc-testbox-admin` | 2,362 | 1,845 | 1,885 |
| `server/src/collectLane.ts` | 2,822 | 1,793 | 1,833 |
| `ccd/ccgpt-auth.py` | 2,067 | 1,697 | 1,737 |
| `ccd/history/recall.mjs` | 2,468 | 1,652 | 1,692 |
| `server/src/coord/stall.ts` | 2,537 | 1,563 | 1,603 |
| `deploy/coordination-snapshot.mjs` | 1,918 | 1,515 | 1,555 |
| `deploy/history-gate.mjs` | 2,599 | 1,504 | 1,544 |

The cap-only files (§3; Q5, Q6):

| File | Lines | Code lines | Cap |
| --- | ---: | ---: | ---: |
| `deploy/history-replay.mjs` | 10,128 | 6,756 | 6,796 |
| `shared/api.ts` | 14,566 | 5,100 | 5,140 |
| `pwa/src/fleet/fleet.css` | 4,477 | 2,574 | 2,614 |
| `deploy/account-op.mjs` | 3,558 | 1,839 | 1,879 |

- [ ] **Task 1: failing tests.** `server/test/growth-caps.test.ts`: the parsers (names, keys, values), the
  per-stage decision table, the fixture-repo end to end (raise, exemption, new cap, removed cap, freeze, a frozen file
  unfrozen in its own PR), `growthFiles` holding capped files, and the tree's own directories well formed with every
  `d` defined in a plan.
- [ ] **Task 2: implement** in `growthCheck.ts`: `SPINE_LIMIT`, `GROWTH_CAPS_DIR`, `GROWTH_FROZEN_DIR`, `stageFileName`,
  `parseCapFiles`, `parseFrozenFiles`, `stagesAt`, `stagesInDiff`, a stage argument to `growthOver` and
  `growthVerdicts`, and `armedGrowth` reading both shas. The summary gains a caps line.
- [ ] **Task 3: the caps** above, one file each, measured again just before the commit.

## Deviations found

- **`fleet.css` does have a code-line measure.** The spec's table and its Known limits say it has none, but D-8563 added
  `stripCss` to `codeLines` (comments and blank lines go), and the per-PR row already measures it by that. The cap reads
  the same measure, so `fleet.css` is capped like any other file: 2,574 code lines, cap 2,614.
- **The named exemption is D-6211's list, not a new file.** The spec has the coordinator write "the cap or exemption
  file"; the exemption already has one reviewed, `origin/main`-only home with PR binding, a 60-day stamp and the
  machinery guard, so a new format would be a second definition. Its `cap` keeps its rule (an integer above 40).
- **`ccd/ccgpt-auth.py`** is Python, measured by the bash stripper as every non-TypeScript, non-CSS file is: `#` lines
  and blank lines go, docstrings count as code.
- **Just under the line, not capped:** `deploy/models-op.mjs` (1,499 code lines) and `ccd/lib/disk-retention.sh`
  (1,487; it is a ccd library, so already held at 40 per PR).
- **`SPINE_LIMIT` is defined here,** with the frozen stage, at 10. The ccd file-split plan's Task 8 names the same
  constant for `ccd/ccd`; when it lands it reuses this one.

## Known limits

- **A rename escapes a cap.** `git mv` of a capped file plus deleting its cap file reads as the old path gone (and its
  cap with it) and the new path neither listed nor capped. Listed files have the same hole today (a renamed listed file
  leaves the hand list behind). Closing it needs rename detection in the measured diff; a later follow-up.

## Open follow-up

- **The console control (Q10).** "Start a file" and "Grant an exemption" as ledger items under "Waiting on you", each
  with its own one-tap control; the coordinator then writes the file in the table above. Not in this PR.
- Step 0, part 2: `.github/ci/file-split.mjs` and its pure-move pin (§2.4).
