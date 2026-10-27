# Landing order wave 3b: notes for the ledger

This note lists every departure from the plan and every ruling the worker made while executing it (run 310, branch
`ws/clear-ridge`). The plan file and the programme ledger are untouched; the coordinator folds this note in on its
ledger pull request.

## Departures from the plan

| # | Plan text | What shipped | Why |
|---|---|---|---|
| R3 | "The tick" step 1: `exec python3 -I - <<'PY'` | `exec python3 -I /dev/fd/3 3<<'PY'`, and with `CCD_LAND_PROBE_SELFTEST=git_ro` the head skips the pause, the tool check, the mkdir and the lock | With `-` the program reads itself from stdin, so the self-test could never read a JSON line from it. |
| R6 | The plan does not say what a failed `gh pr list` does to main-health and the lineage | The probe reads `unmeasured`, `why: gh-failed`, with empty heads and pairs. The base is still fetched, and main-health and the lineage are measured against it | Neither needs the PR list. |
| R7 | The final review proposed a new probe why word, `error` | No new why word. The step-9 rewrite of `probe` runs unconditionally. Doctor treats a null store figure as "not measured this tick", and WARNs `land-probe-incomplete` when a finished tick wrote no main-health | The probe's why set (Design, "probe" format) is a settled format. |
| env | Child env per the plan | The child env adds `GIT_NO_LAZY_FETCH=1`, `GIT_NO_REPLACE_OBJECTS=1` and `GIT_CEILING_DIRECTORIES`, as ccd's own read env does | A lazy fetch or a replace ref could otherwise change what a read-only measurement reads. |
| doctor | `_check_land-probe` per the plan | Doctor also SKIPs a project whose per-project `paused` file stands | It mirrors the probe, which writes nothing for a paused project. |
| mutations | The brief names `mutation-run.py` | A sequential driver: save a copy (sha checked), apply the edit once, run the named vitest files under `timeout -k` and a measured `ulimit -u`, restore from the copy (sha checked) | `mutation-run.py` loads a Python module and Python test functions. The probe is a bash file run by vitest suites. |

## Acknowledged, no change

- **Parser differential (security hook, MEDIUM).** The repository slug is read from `remote.origin.url`, but the fetch
  uses `ls-remote --get-url`, after any `insteadOf` rewrite. The PR heads are measured by the `headRefOid` shas gh
  returns, so a re-pointed URL cannot substitute a head. Only the base sha follows the URL, and the box's own user
  writes that config.
- **`pending` in main-health** lists every name not yet proven: pending, app-unverifiable and app-conflict names. Read
  it as "not yet proven", not as `why == pending`.
- **Lineage cut by budget.** A walk cut by the budget before its first step is rewritten `unmeasured` with an empty
  chain, so a chain proven on an earlier tick is not shown until the next tick. Stage 4 reads that as
  `lineage-unmeasured`, which fails safe.
- **Freshness for wave 4.** Under a full tick budget, two writes of `enabled` can be about 18 minutes apart. A
  freshness bound of three intervals (15 minutes) is shorter than that.

## Residual minors after the fix wave's re-review

- If a project's first tick ever raises after its first `probe` write and before `main-health`, doctor reads
  `land-probe-unreadable`, and its remedy says to start the service, not to read the journal. A pinned test holds
  that word.
- The doctor contract test's case C5 waits 1.1 s to get a distinct `at` second.

## Deferred minors (left by the final review's triage)

- `cat-file --textconv`/`--filters` are allowed by the plan's tables.
- Long-option abbreviations pass the allowlists' `startswith` checks.
- Stray `.lp.*` temp files and a scratch made before its sentinel are never swept.
- The uid half of M21 cannot be pinned without a second uid.
- A child cut by the budget mid-call reports `timeout`, not `budget`.
- A branch with two registry rows gets `id: null`.
- The combined status is read as one page (`/status`, without `per_page`).
- `qualifying` prunes a row on rc 128. This fails closed.
