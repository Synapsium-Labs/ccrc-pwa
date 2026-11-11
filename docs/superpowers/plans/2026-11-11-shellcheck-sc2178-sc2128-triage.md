# The shellcheck ratchet, next item: SC2178 and SC2128 triaged to zero

## Goal

SC2178 ("Variable was used as an array but is now assigned a string") and SC2128 ("Expanding an array without an index only gives the first element") both fire when a name that is an array somewhere is used as a string somewhere else. The ratchet (D-7995) pinned 231 of them: 51 in `ccd/ccd` + `ccd/lib/` (23 SC2178, 28 SC2128), 100 in `ccd/ccrc` (57, 43), 77 in `ccd/ccrc-doctor-checks` (47, 30) and 3 in `ccd/ccd-scope-sweep` (1, 2). Each one is classified as a real bug (an array read as a scalar, so only element 0 is used, or a string clobbering an array) or an intended reuse of a name, the real ones are fixed with a regression test, the intended ones are marked, and the pins come down.

## What was read first

- Every hit, measured with shellcheck 0.11.0 (`--norc --shell=bash -f gcc -S warning`, the ratchet's own arguments), with the function that holds it.
- For each hit, the enclosing function: whether it declares the name (`local`), and whether it uses that name as an array anywhere (`name=(`, `name+=(`, `name[i]=`, `${name[`, `${#name[`, `local -a`/`-A`, `read -a`, `mapfile`/`readarray`).
- For each name, every function that uses it as an array, and whether that function declares it `local` (all of them do; none is a global array).
- The callers of the four `_ws_shed_*` helpers that read `$scan` without declaring it.

## Deviations found

- **D-8275 (2026-11-11)** — shellcheck-sc2178-sc2128-triage: all 231 SC2178 and SC2128 hits are intended reuse of a name, not array bugs. Shellcheck does not scope names by function: once any function makes `kept`, `keep`, `bad`, `words`, `f` or another name an array, it flags every other function that declares the same name as a `local` string. No hit's function uses the name as an array, and in each one apart from the exceptions below the first hit is that function's own `local name…` line, so the name is a string there from its first use. Every function that uses one of these names as an array declares it `local`, so no string assignment reaches an array through bash's dynamic scope. The exceptions to "a local string here" are still strings: four `_ws_shed_*` helpers in `ccd/lib/disk-retention.sh` read `$scan`, which is the string local of their only caller `_ws_shed_run` (the array named `scan` is `_ws_orphan_census`'s local, and that function calls none of them); `removed` in `_uninst_graphify_skills` and `seen` and `dirs` in `_check_transcript_work` live in a command-substitution subshell; and `a` in `ccd/ccd-scope-sweep`'s top-level DEAD-scope loop is a scalar age, while the arrays named `a` are locals of `_ss_sockets`, `_ss_peers` and `_ss_busy_judge`. None is a bug, so no behaviour changes and no regression test is owed. 49 directives mark them, one per function (or the one loop), `# shellcheck disable=<codes>  # <reason>` on the line above the definition, naming the variable and why it is a string there. A directive on the function covers every hit inside it, including lines with several commands, where a directive above the line reaches only the first. The pins come down: `ccd/ccd + ccd/lib` 142 → 90 (51, plus one SC2034 that was already under its pin on main), `ccd/ccrc` 178 → 78, `ccd/ccrc-doctor-checks` 113 → 36, `ccd/ccd-scope-sweep` 3 → 0.

## Classification

Class **local string**: the function declares the name `local` and uses it only as a string. **subshell string**: the name is assigned and read inside a `$( … )` in that function. **dynamic scope**: the helper reads its caller's local string. **top-level scalar**: assigned and read in the script's own top-level loop. The line numbers are those on `origin/main` before this change; each row is one name in one function, and every row's fix is the one directive above that function.

| File:lines | Function | Name | Hits | Class |
| --- | --- | --- | --- | --- |
| ccd/ccd:13252–13258 | `_ws_child_op` | `op` | SC2128, SC2178 ×2 | local string |
| ccd/ccd:19007–19021 | `_ci_bgwait_open` | `w` | SC2128 ×6, SC2178 | local string |
| ccd/ccd:22776–22789 | `_route_apply_seed` | `words` | SC2128 ×6, SC2178 ×6 | local string |
| ccd/ccd:25224–25226 | `_end_cause` | `scope` | SC2128, SC2178 ×2 | local string |
| ccd/ccd:36951–36969 | `_ws_reclaim_tomb_fields` | `same` | SC2128, SC2178 | local string |
| ccd/ccd:36951–36969 | `_ws_reclaim_tomb_fields` | `kept` | SC2128, SC2178 ×2 | local string |
| ccd/ccd:37310–37315 | `_ws_reclaim_nested_record` | `m` | SC2178 ×3 | local string |
| ccd/ccd:42401–42421 | `_ws_collect_audit_doc` | `recs` | SC2128, SC2178 | local string |
| ccd/lib/disk-retention.sh:674–685 | `_ws_reclaim_stale_idle` | `seen` | SC2178 ×3 | local string |
| ccd/lib/disk-retention.sh:769 | `_ws_loose_census_records` | `seen` | SC2178 | local string |
| ccd/lib/disk-retention.sh:1487 | `_ws_shed_git_state` | `scan` | SC2128 | dynamic scope |
| ccd/lib/disk-retention.sh:1491 | `_ws_shed_listing` | `scan` | SC2128 | dynamic scope |
| ccd/lib/disk-retention.sh:1498 | `_ws_shed_repos` | `scan` | SC2128 | dynamic scope |
| ccd/lib/disk-retention.sh:1501 | `_ws_shed_size` | `scan` | SC2128 | dynamic scope |
| ccd/lib/disk-retention.sh:1521–1525 | `_ws_shed_spawn_held` | `m` | SC2128 ×7, SC2178 | local string |
| ccd/ccrc:9222 | `_acct_row_fields_on` | `f` | SC2178 | local string |
| ccd/ccrc:15648–15686 | `_codex_cmd_switch` | `said` | SC2128 ×5, SC2178 ×2 | local string |
| ccd/ccrc:19483–19521 | `_inst_codex_lanes` | `kept` | SC2128, SC2178 ×3 | local string |
| ccd/ccrc:19601–19795 | `_inst_codex_tiers` | `kept` | SC2128, SC2178 ×7 | local string |
| ccd/ccrc:20211–20306 | `_inst_graph_always_on_off` | `kept` | SC2128 ×2, SC2178 ×7 | local string |
| ccd/ccrc:20409–20437 | `_inst_graph_hooks_off` | `kept` | SC2128, SC2178 ×2 | local string |
| ccd/ccrc:20548–20586 | `_inst_lane_state` | `kept` | SC2128, SC2178 ×2 | local string |
| ccd/ccrc:21874–22060 | `cmd_rollback` | `kept` | SC2128 ×2, SC2178 ×3 | local string |
| ccd/ccrc:23167–23171 | `_upd_report_readable` | `f` | SC2128 ×6, SC2178 | local string |
| ccd/ccrc:23349–23383 | `_upd_intent_state` | `f` | SC2128 ×5, SC2178 | local string |
| ccd/ccrc:23349–23400 | `_upd_intent_state` | `rest` | SC2128 ×2, SC2178 ×3 | local string |
| ccd/ccrc:24043–24091 | `_upd_write_previous` | `kept` | SC2128, SC2178 ×7 | local string |
| ccd/ccrc:24235–24257 | `_upd_tree_untouched` | `pl` | SC2128 ×2, SC2178 | local string |
| ccd/ccrc:26363–26364 | `_rollout_exit3_detail` | `box` | SC2128, SC2178 | local string |
| ccd/ccrc:27377–27408 | `_bak_prune` | `keep` | SC2128, SC2178 ×2 | local string |
| ccd/ccrc:27628–27679 | `_bak_gc` | `keep` | SC2128, SC2178 ×2 | local string |
| ccd/ccrc:27876–27896 | `_ver_verdicts` | `keep` | SC2128 ×3, SC2178 | local string |
| ccd/ccrc:27963–28020 | `_ver_gc` | `keep` | SC2128 ×4, SC2178 ×2 | local string |
| ccd/ccrc:28068–28159 | `cmd_versions` | `keep` | SC2128 ×2, SC2178 ×3 | local string |
| ccd/ccrc:28405–28416 | `_uninst_codex_usage` | `failed` | SC2178 ×2 | local string |
| ccd/ccrc:28971–29026 | `_uninst_wrappers` | `removed` | SC2128, SC2178 ×2 | local string |
| ccd/ccrc:29104–29116 | `_uninst_graphify_skills` | `removed` | SC2128, SC2178 ×2 | subshell string |
| ccd/ccrc-doctor-checks:3923–4056 | `_check_pools` | `known` | SC2128, SC2178 ×3 | local string |
| ccd/ccrc-doctor-checks:4383–4579 | `_check_transcripts` | `stale` | SC2128 ×2, SC2178 ×2 | local string |
| ccd/ccrc-doctor-checks:5398–5458 | `_check_graphify-path` | `resolved` | SC2128, SC2178 ×3 | local string |
| ccd/ccrc-doctor-checks:6120–6184 | `_check_memory` | `unmeasured` | SC2128 ×2, SC2178 ×2 | local string |
| ccd/ccrc-doctor-checks:8791–8881 | `_check_scope-sweep` | `bad` | SC2128, SC2178 ×4 | local string |
| ccd/ccrc-doctor-checks:9885–9967 | `_bt_server_arm` | `bad` | SC2128, SC2178 ×11 | local string |
| ccd/ccrc-doctor-checks:9986–10014 | `_bt_fleet_arm` | `bad` | SC2128, SC2178 ×7 | local string |
| ccd/ccrc-doctor-checks:10046–10053 | `_bt_agent_env_marks_fleet` | `p` | SC2128 ×5, SC2178 | local string |
| ccd/ccrc-doctor-checks:10169–10228 | `_check_docs-sw` | `p` | SC2128 ×6, SC2178 | local string |
| ccd/ccrc-doctor-checks:10215–10223 | `_check_docs-sw` | `found` | SC2128, SC2178 | local string |
| ccd/ccrc-doctor-checks:10285–10337 | `_check_server-caps` | `words` | SC2128, SC2178 ×2 | local string |
| ccd/ccrc-doctor-checks:10959–10979 | `_check_approval-verifier-runnable` | `missing` | SC2128 ×3, SC2178 ×3 | local string |
| ccd/ccrc-doctor-checks:11216–11231 | `_check_snapshot-posture` | `seen` | SC2128 ×2, SC2178 ×2 | local string |
| ccd/ccrc-doctor-checks:11495–11556 | `_check_transcript_work` | `pairs` | SC2128, SC2178 ×2 | local string |
| ccd/ccrc-doctor-checks:11517–11530 | `_check_transcript_work` | `seen` | SC2128, SC2178 | subshell string |
| ccd/ccrc-doctor-checks:11517–11557 | `_check_transcript_work` | `dirs` | SC2128, SC2178 ×2 | subshell string |
| ccd/ccd-scope-sweep:581 | `(top-level loop)` | `a` | SC2128 ×2, SC2178 | top-level scalar |

## Tasks

- [x] T1. Measure and classify every hit (the table above).
- [x] T2. Look for real bugs: an array read without an index in the function that made it an array, or a string assigned to a name that is an array in the same function or in a caller reached by dynamic scope. None found.
- [x] T3. Mark the intended ones: one directive above each function (or the top-level loop), listing only the codes that fired there.
- [x] T4. Re-measure: no SC2178 or SC2128 left in the four pins and no parse stop. Every other finding is unchanged (same codes, only line numbers moved).
- [x] T5. Lower the four entries in `server/test/shellcheck-baseline.json` to the counts the ratchet prints.

The growth check counts no comment line, so no growth waiver is needed.
