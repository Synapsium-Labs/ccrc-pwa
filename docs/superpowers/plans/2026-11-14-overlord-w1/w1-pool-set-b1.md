# The Overlord W1 pool set, PR B1 (Tasks 6 to 8): measurements and departures

This note belongs to `w1-pool-set.md` and sits beside `w1-pool-set-departures.md` (PR A1's), `w1-pool-set-a2.md` and
`w1-pool-set-a3.md`, which a feature pull request may not edit. The coordinator folds it into the ledger. A departure is
named by a slug; no D-number is invented.

## What PR B1 adds

- **Task 6.** `ccd pool-answer --session <id>` (`ccd/lib/pool-set.sh#cmd_pool_answer`), one read-only line:
  `pool-answer side=… verdict=… pool-side=… pool-state=… crossing=… account=…`, asking `_session_pool_side`, `_pool_ok`
  (bare, its globals snapshotted at once) and `_crosspool_valid`, and deciding nothing itself. Exit codes 0, 1 (no such
  session), 2 (usage, or an id `_reg_id_ok` refuses), 3 (the uuid, wrapper or project field could not be read, a missing
  wrapper included). The line's words are `shared/poolset.ts` (`POOL_ANSWER_VERDICTS`, `POOL_ANSWER_POOL_SIDES`,
  `POOL_ANSWER_CROSSINGS`, `POOL_ANSWER_KEYS`, `PoolAnswer`); its one reader is `server/src/poolrule.ts#parsePoolAnswer`,
  which reads `ran` before `code`. `CCD_ARGV.poolAnswer(id)` refuses an id `isRegistryId` refuses; `CCD_CAN.poolAnswer`
  is `capRow(POOL_SET_CAP)`. The agent grants `['pool-answer', '--session']`, enrolled in `REQUIRED_VERB_FLAG`; `g29` is
  the bypass fixture.
- **Task 7.** `ccd caps` prints `pool-answer` and `pool-set`; `POOL_SET_CAP` is spelled once in `server/src/ccdargv.ts`.
  `deploy/build-release.sh` stamps the built tree's whole `ccd caps` list as `build.json`'s `ccdCaps`, run in a scratch
  HOME seeded with the generated default roster, after its own bash floor (`br_bash_floor`, 4.4 or later); a non-zero
  exit, an empty list or a line off `^[a-z][a-z0-9-]*$` fails the build.
- **Task 8.** `ccd/ccrc#_box_build_fields` answers `ccdCaps` on a sixth, field-level line (`<absent>`, `<malformed>`,
  or the space-joined list), which never fails the stamp. The capability floor is a TABLE (the coordinator's ruling in
  the brief): `CAP_FLOOR_ROWS`, one row per word, `fact|word|remedy`, with the one row
  `poolset|pool-set|clear the set (retire or rebind the Overlord in Settings)`. `_cap_floor_standing` measures every row's
  fact (any `~/.cc-sessions/<id>.<fact>` entry, `-e` or `-L`); `_upd_cap_floor_check <stamp|-> <from>` refuses, remedy
  first, at call site (a) in `cmd_update` after its second floor check (the staged stamp) and call site (b) in
  `cmd_rollback`'s kept branch after `UPD_REPORTING=1` (the kept stamp copy). Restore arms 1 (previous's kept stamp) and
  3 (`-`) and the watchdog warn and proceed. The doctor's check `cap-floor` reads every row.

### The floor's later rows, and their owners

A later piece adds one data row to `CAP_FLOOR_ROWS` and no code; every reader (the update's check, the doctor's
`cap-floor`, PR B2's `--below-cap` and the server's push) reads every row. `ccrc-update-cap-floor.test.ts`'s table case
adds a second row to a copy of `ccd/ccrc`, changes no code, and shows it honoured (refused naming its word and remedy,
and proceeding with both words).

| Row | Word | Fact | Owner |
|---|---|---|---|
| shipped here | `pool-set` | any `$REG/<id>.poolset` entry | this PR |
| next | `launch-surface-v1` | any `$REG/*.profiledigest` standing | the sandbox piece, PR A2 |
| next | `keep-awake-v1` | the Overlord's stamped markers | the ccd arms piece, PR A |

## Step 6 of Task 7: the fail-open, measured once

A tree from before PR A1, `main` at `a6b87cf794f11303bcadbcfc418d152b3d23b8e6` (the parent of PR A1's merge),
extracted with `git archive a6b87cf79 ccd shared | tar -x -C <scratch>`, its `ccd/ccd` run in a fixture HOME
(`makeCcdHarness`, the roster `POOLED_TEST_ROSTER`, the epoch `POOL_BY_ID`), a row `claude-overlord` on `claude`
(`pool-a`) in an untagged project, every account's limits at 5%:

- its `ccd route --session claude-overlord --set poolset=pool-b` exits 1:
  `ccd: unknown routing field 'poolset' (want one of: class effort subagent workflow compact browser degraded inert profile automem compactwindow precompact)`;
- with `claude-overlord.poolset` reading `pool-b`, its `_swap_target` answers empty, rc 0: the row stays on `claude`,
  outside the set (this tree's ccd answers `claude-b`);
- with `claude` at 100%, its `_swap_target` answers `claude-a`, rc 0: it moves the row to another account outside the
  set (this tree's ccd answers `claude-b`).

That is why Task 8 refuses: an older ccd neither writes the set nor honours one that stands.

## Step 1 of Task 8: the measured places

- `cmd_update`: the staged `$UPD_TREE/build.json` is first on disk after `_upd_fetch`; `UPD_REPORTING=1` is set right after
  `_upd_lock`, well before it. The check sits after the second `_upd_floor_check` (so after the converged no-op, which
  moves nothing) and before `_upd_phase backing-up`.
- `cmd_rollback`'s kept branch: its lock is `_upd_lock`; the scope resets `UPD_REPORTING=0` before `--detach`; the kept
  branch sets `UPD_FROM`, `UPD_VERSION`, `UPD_REPORT_TARGET` and `UPD_REPORTING=1` together, and the check follows those
  four lines, before `_inst_migrate_resume` and `_upd_phase installing`.
- The restore arms: `_upd_restore` tries `_upd_restore_arm1` (its check sits just before `_ver_flip_back`, after
  `_ver_kept` has proved the kept tree complete), `_upd_restore_arm2` (a child update, `--from restore`, which meets call
  site (a)), then `_upd_restore_arm3` (its check is its first act after its locals).
- `_box_build_fields`' six callers read indexes 0 to 4 only and needed no edit.
- The doctor table: `pool-sync` sat alone on its line; `cap-floor` joins it.

## Tests and measurements

| Suite | Result |
|---|---|
| `ccd-pool-answer` (new) | 35 passed (27 of them red before the verb existed) |
| `ccrc-update-cap-floor` (new) | 29 passed |
| `ccrc-box-build-caps` (new) | 15 passed |
| `ccrc-doctor-cap-floor` (new) | 14 passed |
| `build-release` | 74 passed (with the fixture stubs, the `ccdCaps` cases and the bash floor) |
| `release-main` | 114 passed |
| `release-artifact` | 56 passed |
| `pools`, `ccd-can`, `id-argv-census`, `whitelist-subset` | 34, 8, 11, 187 |
| agent `whitelist`, `-structural`, `-prototype`, `-noghosts` | 42, 87, 10, 38 |
| `single-definition/roster-bash` | 59 passed |
| `ccrc-doctor-core` | 118 passed, 3 skipped |
| `ccrc-doctor-core-state`, `ccrc-doctor-fleet` | 73, 115 |
| `ccd-archive`, `verb-gate`, `ccd-verb-sets`, `ccd-pool-ok`, `ccd-contexts`, `ccd-lib-load`, `ccd-split-pin` | 96, 25, 7, 87, 15, 69, 17 |
| `ccd-pool-a3-characterization`, `ccd-pool-a3`, `ccd-pool-sync`, `ccd-session-pool-side`, `ccd-crosspool` | 98, 34, 41, 46, 125 |
| `pool-set-spelling`, `pool-rule-core` | 72, 98 |
| `ccrc-update-fetch`, `-flip-backups`, `-kept`, `-phases`, `-testbox-signal` | 129 (6 skipped), 351, 120, 256 (8 skipped), 7 |
| `ccrc-versions-warn-arms`, `update-watchdog-revert`, `update-killed-arms`, `ccd-version` | 5, 16, 35, 9 |
| `deviation-refs` (after `git fetch origin main`) | 31 passed |
| `growth-check` (`GROWTH_CHECK=1`) | 95 passed |
| `shellcheck-ratchet` | not measured on the box: shellcheck on `ccd/ccrc` and on the ccd program takes about 4.4 GB each, and the shared test slice (6 GB) killed it every time (OOM), with one lane as well as two. `ccd/ccrc-doctor-checks` measured alone: 34 findings, its pin, after the SKIP line stopped starting with a tilde (SC2088); `build-release.sh` and `release-artifact.sh` 0; the new functions linted alone, 0. The pull request's fast run is the arbiter. |

### Growth, net code lines against the merge-base (`growthCheck.ts#codeLines`)

| File | Delta |
|---|---|
| `ccd/ccrc` | +39 (measured +45 first; the stamp's `ccdCaps` arm went onto two jq lines, the unlistable branch onto one `\|\|`, and the row loop's reset onto its loop's line) |
| `ccd/ccrc-doctor-checks` | +19 |
| `ccd/ccd` | +2 |
| `ccd/lib/pool-set.sh` | +19 |
| `ccd (program)` | +21 |

No waiver.

### Mutations, each restored from a saved copy and compared byte for byte

| Mutation | Result |
|---|---|
| `REQUIRED_VERB_FLAG` without `pool-answer` | agent `whitelist-structural`: 3 failed (g29, the positive control, the audit case) |
| `<absent>` read as having the word | `ccrc-update-cap-floor`: 3 failed |
| the stamp's `type == "array"` guard dropped | `ccrc-box-build-caps`: 4 failed (the string, object and number rows went rc 6); measured again after the jq arm moved onto two lines, 4 failed |
| call site (b) dropped | `ccrc-update-cap-floor`: 4 failed |
| `--force` passes the floor | `ccrc-update-cap-floor`: 1 failed |
| call site (b) moved above `UPD_REPORTING=1` | `ccrc-update-cap-floor`: 1 failed (the `failed`-report row) |

`parsePoolAnswer` joins `POOL_SET_MUTANT_SETS` (`server/test/sim/poolSetSets.ts`) with 14 mutants, all killed, floor 1.
A1 is the plan's "read `code` before `ran`". One candidate was dropped as EQUIVALENT, not as a survivor: the
second-line check (a second line glues onto the last token, the account, whose pattern admits no newline). A14 (a key
read anywhere) survived the first suite and showed a missing case, a misspelled key of the same length, now pinned.

## Departures

- **`b1-notes-in-a-new-file`.** This PR's measurements are here, not in the A1, A2 or A3 notes.
- **`cap-floor-is-a-table`.** The coordinator's ruling in the brief: the floor is `CAP_FLOOR_ROWS` (fact, word, remedy),
  not a hard-coded `pool-set` check. The plan's `_upd_cap_floor_check` keeps its name and arguments.
- **`doctor-check-named-for-the-table`.** The plan names the doctor's check `pool-set`. It reads every row of the table,
  so it is `cap-floor`, on `pool-sync`'s line of `CCRC_DOCTOR_CHECKS` and appended at the end of the file as the plan
  places it. A check named for one row that FAILs for another would name the wrong word.
- **`floor-sentence-names-the-fact`.** The plan's refusal ends `sets stand on <ids>`; with a table it ends
  `a <fact> stands for <ids>` (`a poolset stands for claude-overlord`). The remedy still comes first, so the console's
  200-character cut keeps `Settings` with ten 40-character ids standing (pinned).
- **`release-artifact-shape-carries-ccdcaps`.** `deploy/release-artifact.sh`'s `record` holds `build.json` to the
  builder's exact one-line shape, which the plan's file list did not name. Its pattern gains the `ccdCaps` array
  (non-empty, each token on the grammar), and `release-artifact.test.ts` refuses a stamp without it, with an empty one,
  and with a capital.
- **`pool-answer-id-is-no-id-in-the-census`.** `id-argv-census.test.ts` classes `poolAnswer` as `no-id`, as it classes
  `leaseMark`: the builder refuses an id outside `isRegistryId` itself, so the census's dash-led probe id cannot pass it.
- **`pool-answer-reads-the-uuid-first`.** rc 1 is "no uuid field" read through `_reg_read_to`, so a registry that cannot
  be searched answers rc 3, never "no such session".
- **`tasks-6-and-7-in-one-commit`.** The plan commits Task 6 and Task 7 apart. They share hunks (`ccd caps` prints
  `pool-answer` and `pool-set` on one line, and `server/src/ccdargv.ts` gains `POOL_SET_CAP` beside `CCD_CAN.poolAnswer`,
  which reads it), so they landed as one commit. Task 8 was committed first and alone.
- **`cap-floor-trimmed-to-the-limit`.** `ccd/ccrc` measured +45 net code lines; the same code on fewer lines is +39 (the
  growth table above). `single-definition/roster-bash`'s pin on the stamp parse now says every `ccdCaps` read is inside
  `_box_build_fields`, not "three lines", so the next reflow does not move it.
- **`task7-fixtures-in-the-task-commit`.** The plan's Task 7 Step 1 commits the fixture stubs alone; they landed with the
  task's commit. Measured instead: with `origin/main`'s `build-release.sh` and `release-artifact.sh` swapped in (from
  saved copies, restored byte for byte), `release-main` ran 114 passed and `build-release` 68 passed and 6 failed, the
  six being exactly the new `ccdCaps` and bash-floor cases.
