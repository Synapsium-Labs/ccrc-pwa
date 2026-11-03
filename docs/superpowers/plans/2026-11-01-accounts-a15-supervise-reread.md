# Accounts connect A15: running supervisors pick up a new or removed lane

**Goal:** a lane that `ccrc account add` rosters joins swap rotation in every running `ccd supervise` within one loop, and a removed lane leaves it, with no unit restarted. This is plan Task A15 of `2026-10-18-accounts-connect.md` (G3, Q7), whose N7 decision is numbered and defined below.

**Before this change:** `accounts.sh` was sourced once, at `ccd`'s module top level. A supervisor lives for weeks, so a new lane was a rotation candidate only after each supervisor next restarted, and a removed lane stayed a candidate in every running one.

**Change (`ccd/ccd`):**
- At module top level, `_roster_fp_to` reads the file's bytes into `_CCD_ROSTER_FP` before the `source`, so a write that lands between the read and the `source` causes one extra re-read, never a missed one. The read uses builtins only.
- `_roster_reread_check`, called at the top of every `cmd_supervise` loop (before the probe and before any tick helper), compares the file's bytes with `_CCD_ROSTER_FP`. When they are unchanged it returns with no fork, so the tick budget is unchanged.
- On a change, the new bytes are evaluated in a subshell that first unsets every name the generator writes (`_CCD_ROSTER_VARS`, `_CCD_ROSTER_FNS`). They must evaluate with rc 0 and leave a non-empty indexed `CCRC_ACCOUNTS`, an indexed `CCRC_HOME_ABLE`, and the functions `_ccrc_cfg_dir`, `_ccrc_label` and `_ccrc_hue`. Only then are the same names unset in the supervisor's shell and the same bytes evaluated there. `_cfg_dir_to`'s memo is dropped.
- Validation and application both evaluate the fingerprint string, not the file, so the bytes that were validated are the bytes that are applied. Both run one function deep (`_roster_eval`), so a file whose `declare` makes a local fails validation instead of emptying the roster.
- A refused file (malformed, missing an array or a function, missing, empty, or not a regular file) keeps the old roster and warns once per distinct content. A later good file is applied as usual.
- Nothing calls `systemctl`, `launchctl` or `tmux`. No unit is restarted, no pane is touched, and no actor is added.

**Tests:** `server/test/ccd-supervise-roster-reread.test.ts` runs the real loop with its collaborators stubbed. Its cases: a new lane is placeable on the next loop, in the order validate, apply, probe; a removed lane is not placeable and its memoised config dir is gone; an unchanged file (even rewritten with the same bytes) is not re-sourced; a malformed file keeps the old roster, warns once, and a later good file is applied; a file with no `CCRC_ACCOUNTS`, or a function-local one, keeps the old roster; a missing file keeps it and warns once; a name the new file no longer defines does not survive; and no manager or tmux call is made. A parity case holds both name lists equal to what `shared/generate.mjs` writes.

**Mutation table (run):**

| Mutant | Red |
|---|---|
| re-source every loop | "an unchanged file is not re-sourced…", and two more |
| source a malformed file (validation result ignored) | "a malformed file keeps the old roster…", "…defines no CCRC_ACCOUNTS…", "…function-local `declare`…" |
| the validating subshell without its unset of `CCRC_ACCOUNTS` | "…defines no CCRC_ACCOUNTS…", "…function-local `declare`…" |
| re-source mid-loop (after `_auto_swap_check`) instead of at the boundary | "a changed accounts.sh is re-sourced on the next loop…", and four more |
| validate with `bash -n` only | "…defines no CCRC_ACCOUNTS…", "…function-local `declare`…" |
| `systemctl --user try-restart` on change | "the loop calls no systemctl, no launchctl and no tmux…" |
| `_cfg_dir_to`'s memo not dropped | "a removed lane is no longer placeable…", and four more |
| warn every loop (no refused-content memo) | "…warns once…" (both cases) |
| the supervisor's own unset skipped | "a name the new file no longer defines does not survive…" |

**Per width × skin × mode:** no UI, so "no UI" in all sixteen cells.

## Decisions

- **D-7717 (2026-11-01)** — `supervise-resource-at-loop-boundary` (the accounts-connect plan's N7, Task A15): `ccd/ccd`'s rule at `_wrapper_rostered_now` is "a subshell, never a re-source into this shell", with "unset first". `ccd supervise` departs from it once, in a bounded way. On a change to `accounts.sh`'s bytes, it validates them in a subshell that unsets every generated name first: they must evaluate cleanly and define a non-empty `CCRC_ACCOUNTS`, a `CCRC_HOME_ABLE` and the functions `_ccrc_cfg_dir`, `_ccrc_label` and `_ccrc_hue`. Only then, at the loop boundary, does it unset those names in its own shell and evaluate the same bytes there. A file that fails validation keeps the old roster and warns once. This widens the plan's wording in two places, and both keep the rule's reasons: every name the generator writes is unset, not only `CCRC_ACCOUNTS` and three functions, because a stale value of any of them would survive a projection that dropped it; and `CCRC_HOME_ABLE` is also required, because `_is_home_able` reads it bare under `set -u`.
