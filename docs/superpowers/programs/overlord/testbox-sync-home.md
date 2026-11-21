# The test box's tool sync gets a HOME, and a stale box is recovered over the admin lane: task note

Programme `overlord` (#2491), run 3211, brief of 2026-11-21 and the coordinator's rulings of the same day (parts 1 to 3
built, part 4 ruled (a)). Departures are named by slug. The coordinator mints the numbers.

## What was measured

- **The fault is the tools unit's environment.** `ccrc-testbox-tools.service` runs
  `deploy/testbox/bin/tools-sync` as root with no `User=`. The system manager sets `HOME` only for a unit with
  `User=` (systemd.exec(5): "$HOME … only set for the units that have User= set"), so the script starts with no
  `HOME`. Its release step sources the installed tree's `ccd/ccrc` in a subshell, and that file reads `$HOME` at its top
  level under `set -u` (`_SVC_REG="$HOME/.cc-sessions"`). So every sync whose release tag differs from the installed one
  died at step 1: `release: <tools>/release/installed/ccd/ccrc: line 103: HOME: unbound variable`. A sync that only
  changes tools never sources `ccd/ccrc`, so the box looked healthy until a release had to move.
- **Why no test saw it.** `agent/test/testbox-tools.test.ts` ran the script with `HOME` set to the fixture's root home,
  which is not the environment the unit gives it.
- **A second reader was waiting behind the first.** The npmrc the sync writes says `cache=${HOME}/.npm`. With no `HOME`,
  npm keeps that text literally and makes a cache directory named `${HOME}` in its working directory. So a fix inside
  the release subshell alone would not have been enough.
- **The stale tree cannot heal itself.** The unit runs the installed tree's `tools-sync`. Only the installed tree's
  `install.sh` renders the unit file, and `tools-sync` is the only thing on the box that moves a release. The service
  sends nothing but the spec, which is data checked against its format. So a box whose installed tree is the broken one
  stays broken whatever the server sends it. `v0.0.1350`, the live box's release, is f95ac048a4 (#3131). No commit
  since has touched `tools-sync`, its unit or the driver, so that tree's script differs from this one only by the
  missing `HOME`.

## What shipped

- **testbox-sync-home** (`deploy/testbox/bin/tools-sync#@tbt-home`). Before the spec is read, a sync with no `HOME`
  takes the running user's home from the password database (`getent passwd $EUID`, field 6), as a login would set it,
  and exports it. A `HOME` the environment gives is kept. A home that the database does not name, that is not absolute,
  or that is not a directory fails the sync as `tool sync failed (home: …)` before anything is fetched. The fix sits in
  the script, not the unit file: a unit change reaches a box only through Apply release, and the script reaches it as
  soon as a sync switches the installed tree.
- **stale-tree-recovery-over-admin-lane.** There is a new short admin sub, `tools-home`, with no field and no step-up,
  recorded in the ledger as a `repair`. Under the lock and behind the admin lane's connection precheck, it makes one box
  call that writes a RUNTIME drop-in, `/run/systemd/system/ccrc-testbox-tools.service.d/60-ccrc-testbox-home.conf`
  (`[Service]` and `Environment=HOME=%h`, where the system manager's `%h` is root's home from the password database), and
  runs `systemctl daemon-reload`. A drop-in that is already in place is kept and nothing is reloaded. A box call that
  fails, or that answers anything else, is `tools-home-failed`, a new code. `TestboxLane.toolsSync`, the call behind
  `POST /api/testbox/tools-sync`, asks it first when the pure `server/src/testbox.ts#toolsSyncNeedsHome` says so: the
  box's last sync failed at the release step with exactly that `HOME: unbound variable` detail, and the admin lane is
  connected. It records the server's repair row (outcome and code) and sends the sync as before, whatever the sub
  answered. `server/src/coord/routes.ts` is unchanged: the route already calls the lane.
- **Why the installed script and not the incoming one.** The brief offered either. Running the incoming release's
  `tools-sync` would mean letting it run from outside `<tools>/release/installed`, which its own path check refuses, and
  letting the incoming tree's verifier verify that same tree, where today the installed tree's verifier verifies the
  incoming one. Both weaken the release lane, for a script that already differs from the incoming one only by the
  missing `HOME`. Giving the installed script a `HOME` is the smaller honest change. Once that sync lands the new release,
  its own `_tbt_home` takes over.
- **Tests, red first, on fixtures only.** `agent/test/testbox-tools.test.ts` runs the script in the unit's own environment
  (no `HOME`, a fixture `getent` on PATH, `CURL_HOME` holding curl on the fixture's `.curlrc`). That reproduced the live
  line exactly before the fix (`…/ccd/ccrc: line 103: HOME: unbound variable`, all four rows red). After the fix: the
  release is fetched, the installed tree switches, npm is given the home, and three bad password-database answers fail
  closed. Four mutants were measured and restored from a saved copy: the call removed, the absolute-path check, the
  directory check, the export. All four go red. `server/test/testbox-admin-acts.test.ts` covers the sub against the fake
  ssh: written, kept, two failure shapes, not connected, no pin, busy, and the box program run for real against a fixture
  path with a fake `systemctl`. Its six mutants (lock, precheck, answer words, `%h`, daemon-reload, the idempotence check)
  all go red. `server/test/testbox-tools-home.test.ts` covers the decider and the lane, and its five mutants (the lane's
  call, the admin check, two weaker signatures, the refused row's outcome) all go red.

## Departures

- **recovery-dropin-second-writer.** `install.sh` writes the units and their drop-ins under `/etc`. `tools-home` writes one
  more drop-in, so a unit drop-in now has two writers. This is legitimately different on three counts: another host's
  act, a runtime-only file under `/run` that a reboot removes, and a recovery for a tree whose own installer cannot write
  it. It never touches `/etc`.
- **tools-home-recorded-as-repair.** The sub's ledger act is the existing `repair`, not a new act word. No act vocabulary,
  PWA label or migration changes. A reader of the ledger sees "repair" by "ccrc server".
- **lane-red-run-lost-to-the-slice.** The first run of `testbox-tools-home.test.ts`, before the decider existed, was killed
  by the fleet test slice's memory cap (other runs' load). A baseline file died the same way. So its red is measured by
  the five mutants above, not by a run before the code.
- **capture-runner-missing** (part 4, the coordinator's ruling (a)). Capture does not wait on the test-run switch. It
  waits on a runner that was never built. `server/src/buildCaptureLane.ts#testboxCaptureTransport`, the production
  transport, never sends a job. It answers `no-test-box` while the block is `unreachable`, `down` or `off` (`off` means
  the box is unconfigured, not the switch), and `no-runner` while the box is `ok` or `degraded`. It never reads the
  switch. The capture plan names the runner and the replay suite as Open
  (`docs/superpowers/plans/2026-11-11-new-build-capture.md`, "Open"). So 2.1.328 to 2.1.330 stay `capture-queued`
  after this lands. The coordinator opens the runner as its own design run. Run 3213 takes those builds' prompts off the
  operator meanwhile.

## What the coordinator should see after it lands

Once the fleet host runs a release with this change (the server, the agent and the `ccrc testbox-admin` verb), one
`ccrc-api testbox tools-sync` against the live box, which is still on `v0.0.1350`, should do the following, in order:

1. The test box ledger gains a `repair` row by `ccrc server`, outcome `ok`, and the box now holds the runtime drop-in.
   The ledger is the card's history (`GET /api/testbox/admin`'s `events`), which is session-gated. A coordinator holding
   only the box token reads steps 2 and 3.
2. The answer is `{ok: true, outcome: "sent", …}`, as today.
3. Within a minute or two, `ccrc-api testbox status` shows the sync `syncing` and then the release cell moving from
   `v0.0.1350` to the host's release. The `tool sync failed (release: … HOME: unbound variable)` reason is gone. The
   service then hands over to the new tree (its takeover), and the box reads `ok`, or `degraded` for any other reason
   it still has.
4. A second `tools-sync` call finds no stale signature: no `tools-home` and no new repair row, only the sync.

If step 1 shows `refused` with `tools-home-failed`, the box did not take the drop-in. If it shows `not-connected`, the
admin lane is not connected. Either way the sync is still sent, and fails as before.
