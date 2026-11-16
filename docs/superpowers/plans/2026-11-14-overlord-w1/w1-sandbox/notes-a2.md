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
- **`workspace-scan-refuses-links`** (from a security review of the build): the scan's `find` does not follow links, so a
  `.claude` that is a link, a linked `.claude/skills` or a linked subdirectory would have hidden what it points at. Any
  link in the workspace but ccd's own entries refuses the spawn (`find -H`, `-type l`), and the two directories ccd allows
  (`.claude`, `.claude/skills`) must not be links. Three cases pin it, red without the change.
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

- **`cap-floor-facts-twin-lands-second`**: pool set B2 (in flight, run 2197) adds `CAP_FLOOR_FACTS` in
  `server/src/poolSetLossLane.ts`, a server twin of `CAP_FLOOR_ROWS` (fact and word) that its test holds equal row for
  row. That file is not on `main`, so this pull request cannot add the twin row. Whichever of the two lands second adds
  `{ fact: 'profiledigest', word: 'launch-surface-v1' }` after the `poolset` row there (B2 granted the line, mail 21063).
  B2 also puts "pass --below-cap <words>, or " in front of every remedy; this row's remedy leads with the remedy as asked.
- **`co-edit-by-peer-grant`**: B1's merged worker still held claims on `ccd/ccd`, `ccd/ccrc`, the doctor file and the floor
  suites; this build waited out their lease. B2 then held `ccd/ccrc` and `ccrc-update-cap-floor.test.ts` and granted the
  one data row, the table describe's switch to a fictional `tablefact` row, and a new describe at the end of that suite.

## Measured growth (against the merge base `43e5d366e`)

`ccd/ccd` +24 net code lines (the workspace step +20, the three probes +3, the word +1; the `ccd (program)` sum the same),
`ccd/ccrc` +1 (the row), `ccd/ccrc-doctor-checks` +32 (the check, the shared hook definition +1, the delegation-hooks edit
net 0). Every file is within 40, so the doctor check ships with its ruled FAIL scope here and no A3 is needed.

## Not measured locally

- The shellcheck ratchet: the test slice's 6 GiB cap OOM-killed shellcheck on `ccd/ccrc` (CI is the arbiter). Measured by
  hand: `ccd/ccrc-doctor-checks` stays at its pin (34), the new ccd function is clean, and `ccd/ccrc` gained one data line.
- `ccrc-install-codex`'s two box-token cases red on this box with and without this change: their WARN set gains
  `browser-mcp` from browser servers running on the box. `FLEET_BOX_CLASSES` gains `overlord-mods: PASS`.

## CI's first full run (fix round 1)

The first `full-ci` run on `d5078369c` was red on two guards this build had not run locally, both shallow:
`spawn-group-pin` (the new doctor suite spawned bash with a timeout outside `spawnSyncGroup`; it now uses it, as its
cap-floor sibling does) and `ccd-reg-get-census` (`_profile_workspace`'s `workdir` read is a 209th `_reg_get` call on a
177th line; the census sentence and its history now say so). CodeQL was green, and the shellcheck ratchet and
`ccrc-install-codex` passed in CI.
