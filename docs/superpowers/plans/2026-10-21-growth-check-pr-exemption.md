# The growth check exempts a PR the operator names

**Size:** S. **Deploy class:** `server/test/` only (one new data file, two edited test modules, one edited test and one edited data file); no production byte, no `agent/`, `pwa/`, `ccd/` or wire change. One task.

## Problem

The god-file growth check (D-5848) was armed on 2026-10-21 (OA-C2, D-6178). A PR that grows a listed file by more than `GROWTH_LIMIT` (40) net code lines against the merge-base now fails that file's row in `test (server)`, unless one of two waivers holds: the same diff adds a new file under `L1_L2_NEW_FILE_DIRS`, or it shrinks another listed file by at least as much. Spec §5.2 (rev 2) foresaw a third answer, a PR "named exempt" by the operator, but nothing implements it. Path-identity W3 grows `ccd/ccd` by several hundred code lines, and its hard boundary rules out both waivers. The operator ruled on 2026-10-21 that W3 is named exempt, for `ccd/ccd` only, through a narrow mechanism that lands on its own, before W3. This plan builds that mechanism. It names no PR: the list ships empty, and W3's entry is a later one-line change landed just before W3, at W3's measured delta.

## Task 1: a named PR may grow one listed file up to a cap (D-6211)

**Files:** create `server/test/growth-exemptions.json`; modify `server/test/growthCheck.ts`, `server/test/growth-check.test.ts`, `server/test/rings/exemption-age.data.ts` and `server/test/rings/exemption-age.test.ts`.

**Design:**

- **The list** is `server/test/growth-exemptions.json`, `{"exemptions": [...]}`. Each entry is `{pr, file, cap, reason, ruling, since}`: `pr` a positive integer; `file` one of `GROWTH_FILES`; `cap` an integer above `GROWTH_LIMIT`; `reason` and `ruling` one non-empty line each (`ruling` names the operator's ruling the entry rests on); `since` a real `YYYY-MM-DD` day, not in the future. A key outside those six, a missing key, or two entries for the same `pr` and `file` is malformed. It is JSON rather than a `*.data.ts` module because the authority is a blob read with `git show`, and a JSON blob parses without running anything from that ref.
- **Authority is `origin/main`'s copy.** The armed rows read the list with `fileAt(GROWTH_EXEMPTIONS_FILE, 'origin/main', ROOT)`, never from the working tree. A PR's own edit to the list therefore never exempts that PR, and a CI re-run after an entry lands on `main` picks it up, because each server shard's checkout (`actions/checkout@v4`, `fetch-depth: 0`) fetches every branch afresh on a fresh runner. A list absent on `origin/main` holds no entries. A malformed copy on `origin/main` exempts nothing: the whole list is ignored, with a printed notice.
- **The PR number comes from `GITHUB_REF` only**, through the pure `prNumberFromEnv(env)`: `refs/pull/<n>/merge` for a pull request, and `refs/heads/gh-readonly-queue/<base>/pr-<n>-<sha>` for a merge-queue run. Anything else (a push, a schedule, a `workflow_dispatch`, no env) answers `null`, and then no entry applies.
- **An entry waives only its own file, only for its own PR, and only while the measured delta is at or below its cap.** `exemptOver(over, rows, entries, pr)` answers the files in `GROWTH_OVER` that an entry covers. A row fails when its file is over and not exempt. `GROWTH_LIMIT`, `growthOver` and today's two waivers are unchanged.
- **The HEAD copy is checked on every run**, in a row outside the CI-only describe: it must parse and be well formed. The list is stamped in `EXEMPTION_SET_STAMPS` as `server/test/growth-exemptions.json#exemptions` (size held exactly, the 60-day rule), so a forgotten entry turns red rather than living on. `exemption-age.test.ts`'s `sizeOf` gains a `.json` arm to measure it.
- **The report stays honest.** `GROWTH_OVER` still lists every file that grew over the limit and is not waived. An exempted file is annotated there, in the job summary and in the console table, with the PR number, the cap and the ruling. A file over its cap is named in its row's failure message with the cap it passed.

**Steps:**

1. Red: rows for `prNumberFromEnv` (a table), the list's well-formed check (one row per malformed shape), `exemptOver` (own PR at the cap, one over the cap, another PR, another file, no PR number), `exemptionsOnMain` in a fixture repository (an entry on HEAD only is not read; an entry on the fixture's `origin/main` is), the summary's annotation, the HEAD copy and its stamp, and `sizeOf`'s `.json` arm. Each is red against `origin/main` (no export, no file, no stamp).
2. Green: the functions in `growthCheck.ts`, the empty list, the stamp, the `sizeOf` arm, and the armed rows reading `origin/main`'s list.
3. Mutation proofs in a sandbox (a `git archive` committed as the base, with the sandbox's `origin/main` pointed at it), each measured before and after and recorded in the PR body: an entry for this PR at or under its cap passes; one line over the cap is red; a different PR number is red; an entry on HEAD only is red; an entry naming another file leaves the over file red; no PR number leaves it red; each malformed shape is red; and reading HEAD instead of `origin/main` turns the fixture row red, so the authority is pinned.

**Verify:** from `server/`: `growth-check`, `exemption-age`, `deviation-refs`, `dtbd`, `single-definition`, `topology-clean`, `typecheck-tests`, and `docs-grammar` for this plan. `git diff --name-only origin/main...HEAD -- server/src agent/src shared pwa ui ccd deploy` prints nothing.

**Routing:** native. **Needs:** nothing. **Gates:** none. **Not in this task:** any entry (W3's lands just before W3), and any edit to `GROWTH_ARMED`, `GROWTH_LIMIT`, `GROWTH_FILES` or `L1_L2_NEW_FILE_DIRS`.

## Deviations found

### Issued for this work and defined here

- **D-6211** — `growth-check-exempts-a-named-pr`: the armed growth check (D-5848, D-6178) gains a third waiver, an operator-named PR. `server/test/growth-exemptions.json` lists entries of `{pr, file, cap, reason, ruling, since}`, and the armed rows read it from `origin/main`'s copy only, so a PR cannot exempt itself and a re-run after the entry lands picks it up. The PR number comes from `GITHUB_REF` alone (a pull request's merge ref or a merge-queue branch); with none, nothing is exempt. An entry waives one file for one PR while the measured delta stays at or below its cap. The HEAD copy is checked for shape on every run, and the list is stamped under the 60-day rule (D-6045). The list ships empty.
