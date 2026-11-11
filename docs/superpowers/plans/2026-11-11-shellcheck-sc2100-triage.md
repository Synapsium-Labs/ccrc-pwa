# The shellcheck ratchet, item 4: SC2100 triaged to zero

## Goal

SC2100 ("Use `$((..))` for arithmetics") is shellcheck's guess that an unquoted `name=a-b` assignment meant subtraction. The ratchet (D-7995) pinned 47 of them: 27 in `ccd/ccd` + `ccd/lib/`, 16 in `ccd/ccrc`, 2 in `ccd/ccrc-doctor-checks` and 2 in `ccd/ccrc-token-sync`. Each one is classified, the intended ones are marked so a real one stands out, and the pins come down to hold the new count.

## What was read first

- Every hit, measured with shellcheck 0.11.0 (`--norc --shell=bash -f gcc -S warning`, the ratchet's own arguments), with its line and the lines above it.
- The censuses that read these assignments as source text. `ccd-carry-link-route.test.ts` (`CARRY_ROUTE=([a-z][a-z-]*)`), `ccd-lifecycle-purge.test.ts` (`COMPACT_LOCK_WHY=…`), `doctor-box-token.test.ts` (`^\s+R_PROOF=([a-z-]+)$`) and `collect-readers.test.ts` (`REAP_VERDICT=…`) collect the reason words from unquoted assignments, and `KS_WHY`, `HARD_BLOCK_NO`, `CX_TIER_WHY` and others are read by tests too.
- `ccd/ccd-entry-install.py`, which renders the five digest pins by matching each whole line (`^__CCD_LIB_SHA256=stamp-at-install$` and its siblings). The deploy, entry and install tests match the same lines.

## Deviations found

- **D-8198 (2026-11-11)** — shellcheck-sc2100-triage: all 47 SC2100 hits are intended string words (a reason, verdict or label token such as `lock-path-occupied`, or the install-time placeholder `stamp-at-install`), not arithmetic that is missing `$(( ))`. None is a bug, so no behaviour changes and no regression test is owed. 44 carry `# shellcheck disable=SC2100  # <reason>` on the line above the command. Because the source keeps the same bytes, the censuses above and the installer's whole-line match still read them. The other three are quoted (`'branch-gone'`, `'lock-unwritable'`, `'roster-absent'`): two are case branches, where shellcheck refuses a directive (SC1124), and one is the third command on its line, which a directive on the line above does not reach. No test or census reads those three. The pins come down: `ccd/ccd + ccd/lib` 142 → 114 (27 SC2100, plus one SC2034 that was already under its pin on main), `ccd/ccrc` 178 → 162, `ccd/ccrc-doctor-checks` 113 → 111, `ccd/ccrc-token-sync` 7 → 5.

## Classification

Every hit is class **string** (intended concatenation of words, never arithmetic). The line numbers are those on `origin/main` before this change.

| File:line | Assignment | Fix |
| --- | --- | --- |
| ccd/ccd:3616 | `COMPACT_LOCK_WHY=lock-path-occupied` | directive |
| ccd/ccd:3635 | `COMPACT_LOCK_WHY=lock-source-refused` | directive (above the command's first line, 3634) |
| ccd/ccd:3671 | `COMPACT_LOCK_WHY=lock-path-occupied` | directive (above the `if`) |
| ccd/ccd:3672 | `COMPACT_LOCK_WHY=lock-publish-failed` | the same directive (its `else`) |
| ccd/ccd:5637 | `PR_LANDED_LABEL_DEFAULT=landed-in-train` | directive |
| ccd/ccd:11582 | `BIND_REFUSAL=branch-drift` | directive |
| ccd/ccd:13792 | `_WS_PROOF=patch-id` | directive |
| ccd/ccd:17233 | `GC_DIRTY_STATE=tree-unreadable` | directive |
| ccd/ccd:20488 | `HARD_BLOCK_NO=carried-in` | directive |
| ccd/ccd:20502 | `HARD_BLOCK_NO=carried-in` | directive |
| ccd/ccd:20522 | `HARD_BLOCK_NO=carried-in` | directive |
| ccd/ccd:20522 | `HARD_BLOCK_EV=carried-in` | the same directive |
| ccd/ccd:22328 | `KS_WHY=pane-unreadable` | directive |
| ccd/ccd:22329 | `KS_WHY=pane-blank` | directive |
| ccd/ccd:22357 | `KS_WHY=pane-narrow` | directive |
| ccd/ccd:22360 | `KS_WHY=mid-turn` | directive |
| ccd/ccd:22418 | `KS_WHY=quiet-unmeasured` | directive |
| ccd/ccd:29119 | `CARRY_ROUTE=root-failed` | directive |
| ccd/ccd:30631 | `STANDDOWN_EV=carried-in` | directive (above the one-line `case`) |
| ccd/ccd:43170 | `REAP_VERDICT=state-changed` | directive |
| ccd/ccd:47524 | `__CCD_LIB_SHA256=stamp-at-install` | directive (install-time placeholder) |
| ccd/ccd:47528 | `__CCD_LIB_TRAIN_SHA256=stamp-at-install` | directive (install-time placeholder) |
| ccd/ccd:47529 | `__CCD_LIB_LEASE_SHA256=stamp-at-install` | directive (install-time placeholder) |
| ccd/ccd:47533 | `__CCD_REDACT_SHA256=stamp-at-install` | directive (install-time placeholder) |
| ccd/ccd:47534 | `__CCD_REDACT_CLI_SHA256=stamp-at-install` | directive (install-time placeholder) |
| ccd/lib/delegation-lease.sh:606 | `DL_A_BTIP=branch-gone` | quoted (case branch) |
| ccd/lib/disk-retention.sh:90 | `_WS_ORPHAN_WORD=head-unreadable` | directive (above the command's first line, 89) |
| ccd/ccrc:1589 | `MODELS_LOCK_ERR=bad-account-id` | directive |
| ccd/ccrc:1601 | `MODELS_LOCK_ERR=lock-unwritable` | directive |
| ccd/ccrc:1645 | `MODELS_LOCK_ERR=lock-unwritable` | directive |
| ccd/ccrc:1666 | `MODELS_LOCK_ERR=lock-busy` | directive |
| ccd/ccrc:1742 | `word=lock-unwritable` | quoted (case branch) |
| ccd/ccrc:12109 | `MODELS_CODEX_UNTOLD=roster-absent` | quoted (third command on the line) |
| ccd/ccrc:12113 | `MODELS_CODEX_UNTOLD=roster-invalid` | directive |
| ccd/ccrc:12114 | `MODELS_CODEX_UNTOLD=missing-dependency` | directive |
| ccd/ccrc:12445 | `MODELS_CODEX_UNTOLD=roster-invalid` | directive |
| ccd/ccrc:14359 | `CX_TIER_WHY=unit-unproven` | directive |
| ccd/ccrc:14895 | `CX_FOREIGN_CODE=port-foreign` | directive |
| ccd/ccrc:14905 | `CX_FOREIGN_CODE=unit-foreign` | directive |
| ccd/ccrc:14918 | `CX_FOREIGN_CODE=unit-foreign` | directive |
| ccd/ccrc:14924 | `CX_FOREIGN_CODE=port-foreign` | directive |
| ccd/ccrc:14932 | `CX_FOREIGN_CODE=retired-tier-running` | directive |
| ccd/ccrc:28799 | `roster=missing-jq` | directive |
| ccd/ccrc-doctor-checks:9706 | `BT_TF=no-value` | directive |
| ccd/ccrc-doctor-checks:10256 | `writer_unit=ccd-update-sync.timer` | directive |
| ccd/ccrc-token-sync:456 | `R_PROOF=proof-failed` | directive |
| ccd/ccrc-token-sync:459 | `R_PROOF=proof-unmeasured` | directive |

## Tasks

- [x] T1. Measure and classify every hit (the table above).
- [x] T2. Mark the intended ones: a directive above the command, or quoting where a directive cannot reach.
- [x] T3. Re-measure: no SC2100 left and no parse stop. Every other finding is unchanged (same codes and texts, only line numbers moved).
- [x] T4. Lower the four entries in `server/test/shellcheck-baseline.json` to the counts the ratchet prints.

The growth check counts neither comment lines nor a quote change, so no growth waiver is needed.
