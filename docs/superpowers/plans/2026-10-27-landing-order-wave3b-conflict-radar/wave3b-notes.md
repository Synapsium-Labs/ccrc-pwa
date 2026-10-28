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
| R5 (fix round 1) | "The git door": layer 1 refuses a literal prefix list of caller options (`OPTION_PREFIXES`) | Layer 1 is an allowlist of option FORMS per `where` and subcommand (`OPTION_FORMS`): each subcommand admits only the exact spellings the probe's own call sites pass, compared whole, and an element outside the list answers `option <opt>`. The prefix list stays as the first rule, so the existing reasons are unchanged. After the fetch's `--` git reads operands only, so the check stops there | The prefix list let a file-writing option (`rev-list --output=<file>`), a long-option abbreviation (`--upload-pa=<cmd>`) and `cat-file --textconv`/`--filters` pass. None is reachable from a call site today; the rule is now as strong as its stated aim (review 1109, F2 and A9). |
| gh child (fix round 1) | The scrub "for every child" | The forge child's environment also drops every `GIT_*` variable and sets `GIT_TERMINAL_PROMPT=0`, besides dropping `GH_REPO` and `GH_HOST` | The plan's scrub is stated for every child, and gh is one (review 1109, A11). |
| enabled (fix round 1) | The tick, step 4.4.8: `enabled` is written or removed inside each project's measuring, and step 5 sweeps the directories with no conf | One pre-pass at the start of the tick, after the global pause check (the bash head) and the stale-scratch clearing, before any project is measured: over every conf and every directory under `$REG/landing/` it writes `enabled` (valid conf, `lineage=on`, unpaused, a real main checkout) or removes it in every other case, and it absorbs step 5's sweep. The measuring loop no longer writes or removes `enabled`. The tick's steps are now: 1 head, 2 signals and stale scratch, 3 the pre-pass, 4 each project (4.4.8 gone), 5 exit | The spacing of two writes of `enabled` is the spacing of tick starts, whatever the project order and budgets (review 1109 measured up to 1110 s with four projects). Wave 4 bounds freshness at three intervals (900 s) |
| rules read (fix round 1) | `GET repos/<slug>/rules/branches/<base>` read once | The read is `--paginate`, and its parse accepts several concatenated pages as the check-runs read does. The fixture stub pages this endpoint by two | A `required_status_checks` rule beyond page 1 was dropped, and a failing required check could read green (review 1109, F1). The siblings that read the same endpoint one page (`ccd/ccd`, `deploy/measure-landing.py`) are not this wave's and are carried to the ledger |
| exit paths (fix round 1) | SIGTERM runs the cleanup | The closing path (`finish_probe` and everything after the first write) catches `SystemExit` and `KeyboardInterrupt` too, kills the child in flight (the closing `count-objects` as well) and always reaches `remove_scratch`, with SIGTERM and SIGINT held for the removal; the exception is re-raised after it. SIGTERM and SIGINT are blocked from just before the fork until `CHILD` is set, and the child unblocks them before its exec. A `make_scratch` failure after `mkdtemp` removes the directory it made | A signal in the closing rewrite left the scratch and a live child, and a signal between the fork and the assignment left a child nobody killed (review 1109, F4, A1, A2) |
| failure records (fix round 1) | A failed or timed-out fetch rewrites every qualifying row's lineage unmeasured | Also when the project budget cut the fetch: a row whose local read the spent budget left undecided is rewritten unmeasured (`fetch-failed`, `tip: null`) when it has an old file, and no new file is invented. The probe and main-health say `why: budget` when the budget is the cause. An exception or refusal before the first write writes `probe`, `main-health` and every lineage unmeasured (`fetch-failed`). A conf `base` the key rule would refuse is `conf-invalid: bad-value` at parse. `repo-unreadable` writes main-health `why: fetch-failed`, not `gh-failed` | No old record may outlive a failed measurement as if it were this tick's; `budget` is the Design's word; `fetch-failed` is in the plan's set and `gh-failed` was not true when no gh call was made (review 1109, F6, A3, A5, A12) |
| lstat of `$REG/landing/` (fix round 1) | The Design: every directory deleted from is lstat-checked and owned | `remove_own` checks `$REG/landing/` itself as well as the project directory, and so does the pause read | A symlinked `landing` directory let an `enabled` file in its target be deleted (review 1109, A4) |
| env | Child env per the plan | The child env adds `GIT_NO_LAZY_FETCH=1`, `GIT_NO_REPLACE_OBJECTS=1` and `GIT_CEILING_DIRECTORIES`, as ccd's own read env does | A lazy fetch or a replace ref could otherwise change what a read-only measurement reads. |
| doctor | `_check_land-probe` per the plan | Doctor also SKIPs a project whose per-project `paused` file stands | It mirrors the probe, which writes nothing for a paused project. |
| mutations | The brief names `mutation-run.py` | A sequential driver: save a copy (sha checked), apply the edit once, run the named vitest files under `timeout -k` and a measured `ulimit -u`, restore from the copy (sha checked) | `mutation-run.py` loads a Python module and Python test functions. The probe is a bash file run by vitest suites. |

## Accepted by ruling, no code change (review 1109)

- **F3, the alternate refreshes object mtimes.** Git freshens an object already in the project (its loose file's or
  pack's mtime) instead of writing a copy. No content, ref, config, hook or object set changes, and every object it
  touches is one the project already holds. The probe's header, README and the not-written test's comment say
  exactly this, and the alternate stays. The ruling's sentence said "reachable from the workspace branch". That holds
  for the lineage walk only: a merge-tree of the base against a head, or of a pair of heads, can freshen any object
  the project holds. So the wording is "one the project already holds" (fix round 1 review, N4).
- **Departure 3 (R7).** A null `store.after` and a null `scratch.sizeKiB`, for an interrupted tick or a failed count,
  are inside the `probe` grammar; a reader treats null as unmeasured.
- **A10.** Doctor PASSes a `main-health` that reads `pending` or `no-required-set` and names it on the line; every
  other unmeasured why WARNs.

## Absorbing main, and doctor's cadence

PR #1740's light run went red on `census-w8/cadence` and `single-definition/kernel-tail-cadence`. These run main's
D-7054 census, which landed after this branch's base: no doctor line restates a timer's period. Main passed both
files on a clean checkout, so the branch absorbed main once, by `git merge` (worker clause 16, trigger 2).

`_check_land-probe` now reads `ccd-land-probe.timer`'s period through `_dr_cycles_s`, as the scope-sweep and
pool-sync checks do:
- The stale default is four periods. `CCRC_LAND_PROBE_STALE_S` stays as the override.
- The not-yet window is two periods.
- The sentences name the period that was read.

A period that cannot be read drops the bound or clause that needed it. Doctor then warns, naming the unit, and never
falls back to a literal.

## Mutation outcomes that differ from the plan's prediction

- **M21** (the stale-scratch sweep without its uid and symlink checks) first measured green. `shutil.rmtree` refuses a
  symlink itself, and `ignore_errors` hides that refusal. The scratch case now pins that exactly one stale scratch is
  reported cleared, so the lstat check is what decides, and M21 measures red. The uid half still cannot be pinned with
  one uid.
- **M20**'s second layer alone (`write_json`'s `real_dir`) stays green, because `ensure_dir` refuses first. M20 as
  the plan wrote it, both layers together, is red.

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
- **Freshness for wave 4.** Since fix round 1 `enabled` is written by the pre-pass at the start of each tick, so two
  writes of it are one tick apart however the projects are ordered or spend their budgets. A tick that dies before its
  pre-pass writes nothing, and the file ages out.

## Residual minors after the fix wave's re-review

- If a project's first tick ever raises after its first `probe` write and before `main-health`, doctor reads
  `land-probe-unreadable`, and its remedy says to start the service, not to read the journal. A pinned test holds
  that word.
- The doctor contract test's case C5 waits 1.1 s to get a distinct `at` second.

## Deferred minors (left by the final review's triage)

- Stray `.lp.*` temp files, and a scratch of a tick that was SIGKILLed between `mkdtemp` and its sentinel, are never
  swept (a failure inside `make_scratch` now removes its own directory).
- The uid half of M21 cannot be pinned without a second uid.
- A child cut by the budget mid-call reports `timeout`, not `budget`.
- A branch with two registry rows gets `id: null`.
- The combined status is read as one page (`/status`, without `per_page`).
- `qualifying` prunes a row on rc 128. This fails closed.
