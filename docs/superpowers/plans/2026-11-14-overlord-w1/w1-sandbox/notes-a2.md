# W1 sandbox, PR A2: the builder's notes

What PR A2 (Tasks 6 and 7 of `w1-sandbox.md`) found and departed from, by slug, for the coordinator to fold into the
ledger. PR A's notes are in `notes.md` beside this file.

## Carried from PR A

- **`refused-spawn-characterization-not-in-pr-a`**, closed here. The characterization is its own commit, green on `main`
  before any change: `ccd-launch-surface-moves.test.ts` pinned what a digest that differs did under `cmd_supervise` and
  `cmd_ensure` (no pane, one journal line, a failing status: the ruled outcome, unchanged), under `cmd_start` of an
  existing row (the stop marker cleared, then the spawn died), and inside `cmd_swap`, the operator's and the auto-swap's
  (the pane ended, `wrapper` moved, a `swap` line journalled, then the respawn died), and at `_swap_refuse`'s restart (the
  unit started, its spawn died). The next commit changes the four moves and their cases; the supervised cases stand.

## The builder's departures

- **`swap-digest-refusal-rides-swap-refuse`**: the swap's probe journals the plan's `launch-profile-refused` line naming
  the move and the reason, and also refuses through `_swap_refuse` (restart 0), so the row carries `swapblocked` (the
  console shows why), the banner fires, `lastswap` is cleared, and the auto-swap backs off for `SWAPBLOCK_COOLDOWN`
  rather than re-dispatching the same refused move every tick. Its closing hint says `--force` does not move it.
- **`swap-probe-sits-with-the-carry-pre-flights`**: the probe runs after the transcript and background-job pre-flights and
  before the automatic act gates, so a refused auto-swap moves no degrade stamp. Like every refusal above the act gates,
  it leaves an auto dispatch's `.dispatching` claim to its own age-out (`SWAP_JITTER` + 60 s), which the back-off above
  outlasts.
- **`swap-refuse-restart-skipped-on-a-mismatch`**: `_swap_refuse`'s probe runs only on its restart arm (the pane is
  already gone there). On a mismatch it journals and skips the restart, so the unit stays stopped and the session down,
  as a refused supervised respawn ends; it never starts a unit whose every spawn would be refused.
- **`start-probe-before-any-write`**: `cmd_start`'s probe sits right after its "already running" return, so a refused
  start writes nothing (the stop marker, a hibernation's wake, the lifecycle line all stay as they were).
- **`workspace-refusal-checks-before-it-writes`**: `_profile_workspace` checks every entry's shape and ownership, the
  bounded `find` (10 s, `_plat_timeout`; one that cannot finish refuses) and the directories above before it makes a
  link or writes `info/exclude`, so a refused spawn leaves the workspace as it found it. A workspace that is not a git
  repository has no exclude file and is refused. The journal line names the source it found (`a project source stands:
  <path>`) or the directory above.
- **`workspace-edges-recorded`**: five new cross-context lines in `ccd/contexts-edges.tsv`: `cmd_swap` and
  `_swap_refuse` (C1) call `_profile_digest_ok` and `_profile_refused` (C2), because the swap must ask the spawn's own
  digest test rather than keep a second one; and `_profile_workspace -> _reg_get` reads the row's workdir.
- **`doctor-reads-a-standing-pool-set-as-every-account`**: the designated set is the `wrapper` of each registry row with a
  `profiledigest`; while such a row carries a `poolset`, or its `wrapper` or the registry cannot be read, the check reads
  every rostered account as able to serve the Overlord (FAIL scope), because doctor does not resolve pools (the central
  edges are the server's and ccd's). Wider than the ruled set, in the fail-closed direction, and only while an Overlord
  stands; an ordinary box with no `profiledigest` is a WARN at most, as ruled.
- **`doctor-mods-are-plugins-and-foreign-hooks`**: a mod is an `enabledPlugins` entry that is `true`, a plugin listed in
  `plugins/installed_plugins.json` (where a plugin's commands, skills and hooks come from), or a hook on any event that is
  not ccrc's, in `settings.json` or `settings.local.json`. The plan's "a plugin command or skill directory" is read as a
  plugin's; an account's own `commands/` or `skills/` are not mods (they cannot approve a call, and Task 1's M1 measured
  an account skill unlisted under the pinned source). "ccrc's hook" is one jq definition, `DR_OWN_HOOK_JQ`, which
  `_check_delegation-hooks` now reads too.

## Measured growth (against `origin/main`)

To be measured on the pushed tip.
