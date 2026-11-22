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
  and exports it. A `HOME` the environment gives is kept when it is an absolute directory, and is held to the same rule
  when it is not (review 3223 F6). A home that the database does not name, that is not absolute, or that is not a
  directory fails the sync as `tool sync failed (home: …)` before anything is fetched. The fix sits in
  the script, not the unit file: a unit change reaches a box only through Apply release, and the script reaches it as
  soon as a sync switches the installed tree.
- **stale-tree-recovery-over-admin-lane.** There is a new short admin sub, `tools-home`, with no field and no step-up,
  recorded in the ledger as a `repair`. Under the lock and behind the admin lane's connection precheck, it makes one box
  call that writes a RUNTIME drop-in, `/run/systemd/system/ccrc-testbox-tools.service.d/60-ccrc-testbox-home.conf`
  (`[Service]` and `Environment=HOME=%h`; systemd documents the system manager's `%h` as `/root`, which is what
  `_tbt_home` reads wherever root's password-database row says `/root`), and runs `systemctl daemon-reload`. A drop-in
  that is already in place is kept, and the system manager is reloaded either way (review 3223 F1). The file is placed
  before the reload, so a reload that failed once left it in place and unloaded, and the next call must load it rather
  than call it done. A box call that fails, or that answers anything else, is `tools-home-failed`, a new code. `TestboxLane.toolsSync`, the call behind
  `POST /api/testbox/tools-sync`, asks it first when the pure `server/src/testbox.ts#toolsSyncNeedsHome` says so: the
  box's last sync failed at the release step with exactly that `HOME: unbound variable` detail, and the admin lane is
  connected. It records a repair row (outcome and code) by the caller (box-token-runs-fixed-repair, below), except for
  a `kept` answer, which changed nothing on the box and writes no row (review 3223 F3). It then sends the sync as before,
  whatever the sub answered. The act word is read from the sub's spec (`TESTBOX_ADMIN_SUBS['tools-home'].act`, F7). The
  route hands the lane its caller (`server/src/testboxAdmin.ts#toolsSyncCallerOf`): the session's device when there is
  one, else `box token` when the request carried it, else the unlabelled actor. That is two lines of
  `server/src/coord/routes.ts`, under run 1850's claim, by its coordinator's yes to an exact packet (item 486).
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
  call, the admin check, two weaker signatures, the refused row's outcome) all go red. Fix round 1 added tests, red
  first, each with a mutant restored from a saved copy:
  - F1: a reload that fails once and is retried by the next call. Its mutant (`kept` that skips the reload) turns 3 rows red.
  - F6: an environment `HOME` that is relative, or not a directory. Its two mutants are red.
  - F2: the row names the caller, and `toolsSyncCallerOf`'s three answers. Its two mutants (the server's actor in the row,
    no `box token` branch) are red.
  - F3: a `kept` answer writes no row. Its mutant is red.

## Departures

- **recovery-dropin-second-writer.** `install.sh` writes the units and their drop-ins under `/etc`. `tools-home` writes one
  more drop-in, so a unit drop-in now has two writers. This is legitimately different on three counts: another host's
  act, a runtime-only file under `/run` that a reboot removes, and a recovery for a tree whose own installer cannot write
  it. It never touches `/etc`.
- **tools-home-recorded-as-repair.** The sub's ledger act is the existing `repair`, not a new act word. No act vocabulary,
  PWA label or migration changes. A reader of the ledger sees "repair" by the caller.
- **box-token-runs-fixed-repair** (the coordinator's ruling on review 3223 F2). A box-token caller, or any caller while
  auth is off, may cause `tools-home`. Every other write sub stays behind the account gate. It is fixed-content and takes
  no input, and it runs only on the exact stale-HOME failure while the admin lane is connected. That is what makes the
  recovery unattended: the update lane's cookieless post-roll signal is the intended trigger, per the operator's ruling of
  2026-11-22 against manual chores. The gate's EXEMPT reason for `POST /api/testbox/tools-sync` and the `testboxAdmin`
  header say so. The row names the caller. While auth is off, `box token` is attribution only, because nothing checked
  the token.
- **the-unattended-client-is-thirty-seconds** (review 3223 F4, note only). The route now waits for `tools-home` before
  the sync. Outside a detached unit the verb's deadline is capped at 10 s, and ssh's connect timeout is 10 s, so an
  unreachable box costs about 20 s. Only an ssh session that hangs after it connects reaches the short sub's 60 s bound.
  This happens only on the recovery path. The update lane's post-roll signal uses a 30 s client, so on that slow path it
  can print `tools sync not sent — the server did not answer` and exit 0 while the server still sends the sync. The
  PWA's button is unaffected.
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

1. The test box ledger gains a `repair` row by the caller (`box token` for the coordinator's call), outcome `ok`, and the
   box now holds the runtime drop-in and has reloaded its system manager.
   The ledger is the card's history (`GET /api/testbox/admin`'s `events`), which is session-gated. A coordinator holding
   only the box token reads steps 2 and 3.
2. The answer is `{ok: true, outcome: "sent", …}`, as today.
3. Within a minute or two, `ccrc-api testbox status` shows the sync `syncing` and then the release cell moving from
   `v0.0.1350` to the host's release. The `tool sync failed (release: … HOME: unbound variable)` reason is gone. The
   service then hands over to the new tree (its takeover), and the box reads `ok`, or `degraded` for any other reason
   it still has.
4. A second `tools-sync` call sends the sync alone once a poll pass has read the new sync state. A call that lands before
   that pass still reads the old failure and runs `tools-home` again. The box answers `kept` and reloads, and the call
   writes no row (F3).

If the server reads the admin lane as not connected, the decider runs nothing and writes no row: the sync is sent alone
and fails as before. If the lane reads connected, a refused row names why (review 3223 F8):
- `tools-home-failed`: the box did not take the drop-in or its reload.
- `not-connected`: the status said connected, but the verb's precheck found no pinned host key or no connection.
- `no-access-key`: the access key is gone.
- `host-key-changed`: the box presented another host key.
- `busy`: a long act holds the lock.
- `unreachable` or `auth-refused`: ssh could not reach the box or was refused.
- `outcome-unknown`: the call timed out or its answer was lost.

In every case the sync is still sent, and it fails as before.
