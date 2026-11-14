# W1a launch profiles, PR A: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-launch-profiles.md`'s "Deviations found" and the index plan.
Each departure is named by its plain-words slug; the plan file itself is left unedited, and no number is taken here.
PR A is Tasks 1 to 4. `ccd/ccd` grows by 38 net code lines (the growth check's measure, limit 40).
Fix round 1 (review 1945) changed the entries marked "fix round 1" below.

## Measured for the plan (Task 3, Step 1)

- **ccd-lib-reach.** `ccd/lib/launch-profiles.json` reaches a box the way `ccd/lib/roster-card.jq` and
  `ccd/lib/transcript.jq` do. It is installed by name, not by a directory copy, to `~/.cc-sessions/lib/launch-profiles.json`:
  `_inst_files` in `ccd/ccrc` (`_inst_atomic`, 0644) and deploy.sh's agent arm (`install_atomic`, 644). It is also in the
  update's backup set (`_upd_backup_copy`), the uninstall list (`_uninst_cc_sessions`), deploy.sh's backup chain and
  the install fixture's tree (`server/test/installTreeFixture.ts`). At run time ccd reads `LAUNCH_PROFILES_JSON`, which
  is the file beside the script when ccd runs from a tree (`<tree>/ccd/lib`: tests and a source checkout), and
  otherwise `$HOME/.cc-sessions/lib/launch-profiles.json`. An installed ccd's body runs from `~/.local/libexec/ccrc`,
  so on a box it always reads the installed copy. `launch-profiles-file.test.ts` pins each of these lines.
- **a-wake-is-a-resume.** Every spawn kind goes through `_spawn_start`: a first start and a fresh start are `new`,
  and a resume and a wake (`cmd_ensure`, a supervisor revival, a swap landing) are `resume`. The suite covers
  `new`, `resume` (both spawn lines: `--resume` and the `--session-id` retry) and a fresh start. A wake is the
  resume case.

## New departures

- **coordinator-case-carries-the-window, a reading of the plan.** Task 3 Step 2's first case
  ("`profile=coordinator`: the `--settings` value has `"idleCompaction":false`") contradicts its later case
  ("`profile=coordinator` with no `compactwindow`: no `idleCompaction` key from the profile") and Review Focus 5. The
  suite follows the ruling (`compaction-follows-continuity`). `idleCompaction: false` and
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` appear only when the route carries `compactwindow`. Without that field, a
  coordinator's `--settings` is the fleet pins exactly (`idleCompaction: true`).
- **one-settings-merge-shared, a consolidation.** The plan says the profile merges "after the fleet pins (the fleet
  merge's own code path and its quote refusal)". To give it that code path, the body of `_fleet_spawn_compose` became
  `_spawn_settings_last id flags json what`, and both composers call it. There is one merge and one quote refusal, and
  the fleet's warning text and bytes are unchanged (the characterization suite and `ccd-spawn-fleet-pins.test.ts`
  pin them). The helper returns 1 on a failed merge, so the profile composer can drop its environment too.
- **profile-vocabulary-is-the-file.** `_route_valid profile` accepts a word that is a key of `LAUNCH_PROFILES_JSON`.
  It checks the shape (`^[a-z]{1,16}$`), then asks `jq has`. ccd therefore holds no second list of role words: the
  file is the one projection of `FLEET_ROLES`. A file that cannot be read answers rc 2, ccd's existing "vocabulary
  unavailable", which is never "bad value". `cmd_route` and the `--route` argv check say this in a sentence of their
  own, naming the file.
  Fix round 1: `_route_unmeasured_note`'s words name only the roster projection, and they stay as they are, because E0c
  in `ccd-tick-diet-equivalence-static.test.ts` holds `_route_get`'s helper closure, that note included, to the
  branch point. So the spawn no longer reads `profile` through `_route_get`: `_profile_spawn_compose` reads the word
  raw (`_reg_get_to`), checks its shape, and looks the row up itself. When the profiles file cannot be read, it journals
  its own `route-unmeasured … field profile could not be checked — this box's launch profiles (<file>) cannot be read`
  line, floored by the same `routeunmeasprofile` marker. A side effect: a stored profile word that is not a row now
  gets the spawn's warning only, with no `route-reject` journal line, since `_route_get` is no longer asked about it.
- **env-values-are-words, an addition.** The composer's jq program checks the whole row before anything is applied.
  Every `env` key must match `\ACLAUDE_CODE_[A-Z_]+\z` and every value `\A[A-Za-z0-9._-]+\z` (fix round 1: anchored
  with `\A`/`\z`, since jq's `$` also matches before a final newline; a value `"1\n"` cut the env line after it, and a
  key `"CLAUDE_CODE_X\n"` ran as a program; both are now in the suite's wrong-shape list), `autoMemory` must be
  `off` or `switch`, and each of `env`, `settings` and `compactionSettings` must be an object. One bad entry refuses
  the row: nothing is composed and ccd warns (Review Focus 2). The value rule exists because the words go unquoted
  onto the pane's `env` line. `launch-profiles-file.test.ts` holds the checked-in file to the same rule.
- **no-cap-word-for-the-fields, for PR B to rule on (fix round 1: the doors are closed in PR A).** The three fields
  are `ROUTE_LANE_ONLY_FIELDS` (`shared/api.ts`, derived beside `ROUTE_WRITABLE_FIELDS`), and `parseRouteFields`, the
  one door parse, refuses each as `lane-only`. Every door answers 400 naming the field: the operator's
  `POST /api/sessions/:id/route`; the spawn, workspace and dispatch `route` bodies; and the coordinator's box-token
  `POST /api/runs/:id/route`, whose manual arm parses the field (worker or coordinator target alike) and whose `kind`
  and `demote` arms move only `class` and `effort`. Each door's 400 is pinned in its own suite, and removing the
  refusal reds every one. The lane's own write, `CCD_ARGV.routeSet`, passes no door and stays open
  (`launch-profile-route-wire.test.ts`). So PR B's cap-word question is only about its own lane against an older fleet
  ccd. That ccd refuses the fields by name, whole-call, in both `cmd_route` and `_route_argv_check` (the
  `ws-add`/`start --route` path): `unknown routing field` before any write, so every other field of that call is lost
  too. When `browser` arrived, it got `browser-route-v1` for this reason. PR A adds no `ccd caps` token.
- **the-oracle-compares-the-variable, carried to PR B (fix round 1, review F2).** "The compact point stays above the
  hard cap" compares the value of `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, not where Claude Code actually compacts. If Claude
  Code keeps its ~33k buffer below a lowered window, a 200k window's 120,000 fires near 87k, under its 100k hard cap.
  Before PR B writes `compactwindow`, it owes the measurement of where a lowered variable fires on a 200k window (or a
  ruled margin that covers the buffer), and then the oracle "firing point > hard cap". The oracle here is unchanged.
- **monotonic-means-the-percent, a reading of Task 4.** "Monotonic in the window" is tested as: the percent never
  rises as the window grows, and the compact point in tokens stays above the hard cap. The token figure itself is
  not monotonic. Where the rounded-up percent steps down by one point, the token figure dips slightly: for example,
  a window of 520,833 gives 307,292 tokens, and a window of 520,834 gives 302,084.
- **no-source-pin-for-the-cap.** Task 4 asks that no second copy of the hard cap exist, and `compactThresholdFor`
  imports `hardCapTokens`. Fix round 1: `server/src/continuity/launchProfile.ts` is now on `DECIDERS` in
  `single-definition/continuity-values.test.ts`, the list that reads each continuity decider for a spelled figure, so a
  respelled cap (`Math.min(250_000, windowTokens / 2)` in place of `hardCapTokens(windowTokens)`) goes red there,
  measured. The suite's own new source-text pin was dropped because ARCH-06's ratchet counts literal pins over a new
  `server/src` file; `DECIDERS` reads its files through `path.join` over a variable, as it does for `renewalDue.ts`.
- **characterization-as-a-fixture.** The branch-point recording that Review Focus 1 compares against is a fixture,
  `server/test/fixtures/launch-profile/branch-point.json`, recorded on `d24da2880` before the composer existed. HOME
  and the run's temp root (`CCRC_SESSION_TMPDIR`) are normalised in it, so it holds no path of the box it was taken on.
  Fix round 1 re-recorded it on `d24da2880`'s `ccd/ccd` (swapped into the tree for the run and restored from a saved
  copy), never the branch's. The four existing recordings came back byte for byte. Two things were added: a resume
  with a generation file, so `CCRC_SESSION_GENERATION` is pinned, and each case's stderr. The review asked for an empty
  stderr, but on the branch point a no-profile spawn already warns: no account deny file in the fixture HOME and, except
  in the generation case, no generation. So each case pins its stderr byte for byte to the branch point's and holds no
  `launch profile` line. The fresh case also asserts `.fresh` reads `used <uuid>` after the spawn.
- **route-field-pins-moved.** Two existing pins name the route list's length or tail. `route-fields-parse.test.ts`'s
  "is exactly six fields" is now nine. `browser-mcp-wire.test.ts`'s "`browser` is last" now reads "`browser` is
  followed by the launch profile's three". `single-definition/update-stall.test.ts` (6 to 9) and
  `ccd-route-fields.test.ts`'s `ROUTE_FIELDS` pin grow as the plan says.

## Shared files (peer consent, second to land merges `main` once and keeps both)

`ccd/ccd`, `ccd/ccrc`, `deploy/deploy.sh`, `server/test/installTreeFixture.ts`, `ccd/contexts.tsv` and
`ccd/contexts-edges.tsv` are shared with session-continuity 6b-2. `shared/api.ts`'s route region is shared with
invited replies. The mutation registries (`server/test/sim/mutation-floors.test.ts` and `.json`) are shared with
context readings. Each edit is a separate line, so that the merges stay clean.
