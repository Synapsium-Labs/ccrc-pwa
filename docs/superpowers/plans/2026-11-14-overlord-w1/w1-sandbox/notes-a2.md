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
  as a refused supervised respawn ends; it never starts a unit whose every spawn would be refused. Since fix round 1 it
  runs before the row, the journal and the banner are written, so they say the session is down and not restarted (F2).
- **`start-probe-before-any-write`**: `cmd_start`'s probe sits right after its "already running" return, so a refused
  start writes nothing (the stop marker, a hibernation's wake, the lifecycle line all stay as they were).
- **`workspace-refusal-checks-before-it-writes`**: `_profile_workspace` checks every entry's shape and ownership, the
  bounded `find` (10 s, `_plat_timeout`; one that cannot finish refuses) and the directories above before it makes a
  link or writes `info/exclude`, so a refused spawn leaves the workspace as it found it. A workspace that is not a git
  repository is refused. The journal line names the source it found (`a project source stands:
  <path>`) or the directory above.
- **`workspace-scan-refuses-links`** (from a security review of the build): the scan's `find` does not follow links, so a
  `.claude` that is a link, a linked `.claude/skills` or a linked subdirectory would have hidden what it points at. Any
  link in the workspace but ccd's own entries refuses the spawn (`find -H`, `-type l`), and the two directories ccd allows
  (`.claude`, `.claude/skills`) must not be links. Three cases pin it, red without the change.
- **`workspace-edges-recorded`**: five new cross-context lines in `ccd/contexts-edges.tsv`: `cmd_swap` and
  `_swap_refuse` (C1) call `_profile_launch_ok` (since fix round 1; `_profile_digest_ok` before it) and `_profile_refused`
  (C2), because the swap must ask the spawn's own test rather than keep a second one; and `_profile_workspace -> _reg_get`
  reads the row's workdir.
- **`doctor-reads-a-standing-pool-set-as-every-account`**, narrowed by fix round 1 (F6, see
  `doctor-asks-pool-answer-per-account` below): the designated set is the `wrapper` of each registry row with a
  `profiledigest`, and for a row with a `poolset`, the accounts ccd says serve it. Every rostered account is in the FAIL
  scope only while that cannot be decided: an answer that is not `serve` or `mismatch` (an unreadable or stale
  projection, an older ccd without `--account`), or a `wrapper` or the registry that cannot be read. Fail-closed, and only
  while an Overlord stands; an ordinary box with no `profiledigest` is a WARN at most, as ruled.
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

## Fix round 1 (review 2215, rulings in the coordinator's mail)

- **`probes-ask-the-workspace-check`** (F1, ruled): `_profile_workspace` is split by an argument into its read-only check
  and its writes (`make`: the links and the exclude lines). `_profile_launch_ok` asks the digest and, under a standing
  one, the read-only workspace check; the three probes (`cmd_swap`, `_swap_refuse`'s restart arm, `cmd_start`) ask it
  before any teardown, write or journal line, and the spawn asks it with `make`. A row without `profiledigest` returns at
  `_profile_digest_ok`'s first test, as before, with no fork. Pinned by a digest-equal `.mcp.json` case for each of the
  three moves, and a no-digest case that swaps as today with the same source planted. The swap's `--force` hint now names
  the digest or the workspace rather than the two builds.
- **`swap-refuse-says-down-not-restarted`** (F2): see `swap-refuse-restart-skipped-on-a-mismatch` above. The banner reads
  `cc swap BLOCKED: <id> is down, not restarted — …` and `swapblocked`'s reason ends `the session is down, not restarted:
  launch profile: <why>`; the restart case pins both.
- **`workspace-walk-through-a-linked-workdir`** (F3): a case whose `workdir` is a link to a workspace holding `.mcp.json`
  kills the `find -H` survivor (red with `find` in its place).
- **`workdir-absolute-and-slash-clean`** (F4): the check refuses a `workdir` that is not `/*` or ends in `/` before the walk
  above it; a relative and a trailing-slash case pin it.
- **`overlord-workdir-is-its-own-repository`** (F5, ruled): the workspace's `.git` must be a directory, not a link and not
  a linked worktree's `.git` file, whose `info/exclude` is the parent repository's, shared by every sibling worktree. The
  exclude written is `<workdir>/.git/info/exclude`, so `git rev-parse` is no longer asked. A linked-worktree case pins the
  refusal and that the parent's exclude file stays clean; a non-git workspace now reads `the workspace is not its own
  repository`.
- **`doctor-asks-pool-answer-per-account`** (F6, ruled): for a designated row with a `poolset`, doctor asks
  `ccd pool-answer --session <id> --account <a>` of each rostered account (bounded by `CCRC_DOCTOR_DOCS_TIMEOUT`) and
  FAILs only those that answer `serve`, so `_acct_pool_state` stays the projection's one reader. `pool-answer` gains the
  optional `--account <a>` (the account-id shape, else usage rc 2), which asks `_pool_ok` and `_crosspool_valid` of `a` in
  place of the session's `wrapper`. The exec whitelist is unchanged: it grants `pool-answer --session` as a prefix, so the
  agent would pass the new form too, which is read-only and writes nothing, like the form it extends; the server composes
  only `--session <id>` (`CCD_ARGV.poolAnswer`). Also from F6: an empty `settings.json` or `settings.local.json` reads "could not be read",
  and a flat hook entry with no `hooks` array is seen. Each has a case.
- **F7** accepted as ruled (the probe sits after the detach arm, as every pre-flight above it does).
- **`start-refusal-names-its-remedy`** (F8): `cmd_start`'s refusal ends `(the operator clears a stale digest: ccd route
  --session <id> --set profiledigest=)`.
- **`b2-merged-first-twin-added`**: pool set B2 (#2887) merged during this round, and `origin/main` then conflicted with
  this branch in `ccd/ccrc` (the floor table's header comment) and `ccrc-update-cap-floor.test.ts` (both PRs append a
  describe at the end). Clause 16's merge-tree trigger and the coordinator's ruling: one `git merge` of `origin/main`,
  keeping both sides (the comment now names B2's `--below-cap` and this row's remedy; this PR's describe, then B2's). The
  twin row `{ fact: 'profiledigest', word: LAUNCH_SURFACE_CAP }` is its own commit after the merge, in B2's
  `CAP_FLOOR_FACTS` (`server/src/poolSetLossLane.ts`), so `pool-set-loss-lane`'s pin holds the two tables equal. This
  row's refusals now carry B2's `pass --below-cap launch-surface-v1, or ` in front of the remedy.
- **`cap-floor-facts-exempt-from-the-route-field-scan`**: with its second row the twin names two route fields in one array
  literal, which `single-definition/update-stall`'s restatement scan reads as a second copy of `ROUTE_WRITABLE_FIELDS`.
  It is a different vocabulary (a floor's facts, each with its word, typed `RouteField`), so the scan exempts the
  `CAP_FLOOR_FACTS` literal by name, as it exempts `BUILTINS`, with a case that the exemption is live.

## Measured growth (against the merge base `43e5d366e`)

After fix round 1: `ccd/ccd` +29, `ccd/ccrc` +1, `ccd/ccrc-doctor-checks` +37, `ccd/lib/pool-set.sh` +2. Before it:
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
