# W1a launch profiles, PR A: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-launch-profiles.md`'s "Deviations found" and the index plan.
Each departure is named by its plain-words slug; the plan file itself is left unedited, and no number is taken here.
PR A is Tasks 1 to 4. `ccd/ccd` grows by 37 net code lines (the growth check's measure, limit 40).

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
  own, naming the file. The `route-unmeasured` journal line keeps its words (it names only the roster projection):
  `_route_unmeasured_note` is frozen by the tick diet's legacy fixture, and the spawn's own warning names the profile.
- **env-values-are-words, an addition.** The composer's jq program checks the whole row before anything is applied.
  Every `env` key must match `^CLAUDE_CODE_[A-Z_]+$` and every value `^[A-Za-z0-9._-]+$`, `autoMemory` must be
  `off` or `switch`, and each of `env`, `settings` and `compactionSettings` must be an object. One bad entry refuses
  the row: nothing is composed and ccd warns (Review Focus 2). The value rule exists because the words go unquoted
  onto the pane's `env` line. `launch-profiles-file.test.ts` holds the checked-in file to the same rule.
- **no-cap-word-for-the-fields, for PR B to rule on.** PR A adds no `ccd caps` token. An older ccd refuses the three
  fields by name at `cmd_route` (`unknown routing field`): the write fails closed, and the failure is visible. When
  `browser` arrived, it got `browser-route-v1`, so that the server never sends the field to an older box. PR B's lane
  is the first writer of these fields, so PR B should decide whether it gates its writes on a token in the same way.
  Note also that `parseRouteFields` is the one ingress, so the operator's one-field route door and a dispatch's
  `route` body now accept the three fields as well. Nothing sends them in PR A. If the plan's "one writer per route
  field: the lane" is to hold at the doors too, PR B is the place to refuse them there.
- **monotonic-means-the-percent, a reading of Task 4.** "Monotonic in the window" is tested as: the percent never
  rises as the window grows, and the compact point in tokens stays above the hard cap. The token figure itself is
  not monotonic. Where the rounded-up percent steps down by one point, the token figure dips slightly: for example,
  a window of 520,833 gives 307,292 tokens, and a window of 520,834 gives 302,084.
- **no-source-pin-for-the-cap.** Task 4 asks that no second copy of the hard cap exist. That is left to
  `single-definition/`, as the plan says, and `compactThresholdFor` imports `hardCapTokens`. A source-text pin over
  the new `server/src/continuity/launchProfile.ts` would red ARCH-06's ratchet ("literal source pins over every
  other server/src file may only shrink"), so there is none.
- **characterization-as-a-fixture.** The branch-point recording that Review Focus 1 compares against is a fixture,
  `server/test/fixtures/launch-profile/branch-point.json`, recorded on `d24da2880` before the composer existed. HOME
  and the run's temp root (`CCRC_SESSION_TMPDIR`) are normalised in it, so it holds no path of the box it was taken on.
- **route-field-pins-moved.** Two existing pins name the route list's length or tail. `route-fields-parse.test.ts`'s
  "is exactly six fields" is now nine. `browser-mcp-wire.test.ts`'s "`browser` is last" now reads "`browser` is
  followed by the launch profile's three". `single-definition/update-stall.test.ts` (6 to 9) and
  `ccd-route-fields.test.ts`'s `ROUTE_FIELDS` pin grow as the plan says.

## Shared files (peer consent, second to land merges `main` once and keeps both)

`ccd/ccd`, `ccd/ccrc`, `deploy/deploy.sh`, `server/test/installTreeFixture.ts`, `ccd/contexts.tsv` and
`ccd/contexts-edges.tsv` are shared with session-continuity 6b-2. `shared/api.ts`'s route region is shared with
invited replies. The mutation registries (`server/test/sim/mutation-floors.test.ts` and `.json`) are shared with
context readings. Each edit is a separate line, so that the merges stay clean.
