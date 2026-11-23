# The test box's parity check, end to end: plan

`2026-11-23-testbox-push-git-shell.md` let the first push reach a test box. Nothing had yet run end to end: every box
leg of `ccrc testbox-admin parity` still ended "box absent". This plan fixes what stood between a push and a box leg's
answer, each found on a real test box (systemd 259) and a real fleet box. Spec
`docs/superpowers/specs/2026-10-28-test-box-design.md` §2.2 and §2.3.

## Measured

- **The prepare and install units never started their first step.** Both name the directory their privileged first
  step (`ExecStartPre=+`) creates as their one `ReadWritePaths`. On systemd 259 the namespace is set up for that step
  too, so every start failed before the step ran:
  `ccrc-testbox-prepare@1.service: Failed to set up mount namespacing: <root>/runs/1/run: No such file or directory`,
  `status=226/NAMESPACE`; the install unit the same for `<root>/install/run`. With a runtime drop-in that made the path
  optional (`ReadWritePaths=-…`), the prepare started, its first step made the directory and its main step's `npm ci`
  completed there.
- **Every unit that passed read as a failure.** The service reads a unit's end with `systemctl start --wait`, then
  `systemctl show -p ExecMainCode -p ExecMainStatus -p Result`. The system manager unloads a unit as soon as it is
  inactive and unreferenced (`CollectMode=inactive`, the default), so `show` reads a freshly loaded unit:
  `ExecMainCode=0 ExecMainStatus=0 Result=success` (measured for a prepare, a run and two cleans that had passed). The
  reader took `ExecMainCode=0` as "the main never ran", so:
  - a prepare that passed (its journal: "Deactivated successfully") was summarised as
    `test box: prepare failed (git checkout: exit 255)`;
  - a clean that passed read as a failed clean, so its run user stayed held, and the sweep re-ran the clean every few
    minutes for good. Once both run users were held the queue admitted nothing: every later box leg was pushed,
    submitted and then waited until the parity tool stopped it ("did not end within 420s"), with no unit started on the
    box. That was the run that seemed never to reach the service. A service restart frees the pool, until the next two
    runs hold it again.
  - `systemctl start --wait` exits non-zero when the unit ends `failed` (systemd's `bus-wait-for-units.c`: only
    `ActiveState=failed` is a failure; `systemctl-start-unit.c` maps it to `EXIT_FAILURE`), and a failed unit is not
    collected, so its `show` still reads the real `ExecMain*`.
- **Every test that made a temporary directory failed on the box.** Once a run got through, 34 of 56 sampled files
  failed there with `ENOENT: no such file or directory, mkdtemp '/tmp/r/…'`. The run's `TMPDIR` is `/tmp/r` inside the
  unit's private `/tmp` (spec §2.2 "Temp"). The prepare script makes it, but in the prepare unit's own `/tmp`: each
  unit has its own (`PrivateTmp=yes`), and the runner never made it in the run unit's.
- **No pristine install was ever built.** The install unit is `Type=exec`, and its privileged last step is
  `ExecStartPost=+install-post`. Under `Type=exec` that step runs as soon as the main process is started, not when it
  exits, so `install-post` ran within the same second as `npm ci` began, said
  `the build left no node_modules: <root>/install/run/build/server/node_modules`, and failed the unit, which stopped
  `npm ci`. Runs fell back to `npm ci` in their own copy, so this cost time, not answers.
- **A parity run right after a merge ran nothing.** `--recent 1` names the newest merged pull request from `gh`, which
  can be newer than the fleet's clone: `testbox-parity: <rev>: cannot add a worktree`, and the run failed with no leg.

## The change

1. **`ReadWritePaths=-…` in the prepare and install units** (D-8961). The `-` makes the path optional for the
   namespace set-up only. The security intent is unchanged: the main step starts after the first step, which refuses a
   directory that already exists (in any form, a link included) and otherwise creates it, owned by the run user, 0700.
   So the main step still has exactly that one writable path, and a first step that refused fails the unit before the
   main step runs. If the directory were somehow gone when the main step starts, its namespace has no writable path at
   all, which fails closed. The run unit keeps the strict form: the prepare made `run` before it, and a run whose
   directory is gone should fail to start. Making the directories outside the units (in the service, before the start)
   was the other choice; it would have given the service user, or a second privileged writer, a create in the root's
   `runs/<k>` and `install/`, which today only the unit's own first step has.
2. **A collected pass is a pass** (D-8962). `unitEnd` (`agent/src/testbox/systemd.ts`) reads
   `ExecMainCode=0` with `start` exiting 0, not killed by its bound, and `Result=success` as exit 0. Every other
   reading is as before: a start that failed, a bound that killed it, a `Result` other than `success`, or no
   `ExecMainCode` field at all is never a pass. The one start that would also answer so is a `Condition…=` that skipped
   the unit; `testbox-box-package` now pins that no unit has one.
3. **The runner makes the spec's `TMPDIR`** (D-8963), as the prepare already does, before it `exec`s the command:
   the same three lines, in the one script each unit runs. Each script reads only its own spec by design (spec §2.3 "A
   fixed environment"), so the line is repeated rather than shared; it covers the install unit too, which also runs
   the runner.
4. **The install unit is `Type=oneshot`** (D-8964), so `install-post` runs only once `npm ci` has exited 0. A oneshot
   ignores `RuntimeMaxSec=`, so the installer's drop-in gives the install unit `TimeoutStartSec=` from
   `CCRC_TESTBOX_UNIT_MAX` instead; the service's own `start --wait` bound is unchanged. `testbox-box-package` pins that
   every unit with an `ExecStartPost=` is a oneshot.
5. **The parity tool fetches a revision its clone lacks** (D-8965). Before it adds a worktree, `ccd/testbox-parity`
   checks the commit is present, and otherwise runs `git fetch --no-write-fetch-head origin <rev>` under the step's
   bound, with no prompt: it adds the objects, and no ref and no `FETCH_HEAD`. A revision origin does not have either
   fails that revision by name.

## Tests

- `agent/test/testbox-service.test.ts`: a collected pass is a pass, for a run and a clean; a killed start or a
  `Result` other than `success` over the same defaults is still never a pass. Measured red against the old `unitEnd`.
- `server/test/testbox-box-package.test.ts`: the literal unit pins of spec §2.3 carry `-` for the prepare and the
  install unit, the run unit keeps the strict form, and no unit has a `Condition…=`. Measured red against the old units,
  and the condition pin red with a `ConditionPathExists=` added to a unit.
- `agent/test/testbox-service.test.ts`: the runner makes a `TMPDIR` that does not exist yet before the command runs.
  Measured red against the old runner.
- `server/test/testbox-box-package.test.ts`: the install unit is a oneshot, its drop-in carries `TimeoutStartSec=`, and
  every unit with an `ExecStartPost=` is a oneshot. Measured red against the old unit and installer.
- `server/test/testbox-config-file.test.ts` expects `TimeoutStartSec=` in the install unit's drop-in, and
  `server/test/fixtures/testbox-installer-golden.json` (`CCRC_TESTBOX_GOLDEN=write`) records the new bytes of the prepare
  unit, the install unit and its drop-in; nothing else in the record moved.
- `server/test/testbox-parity.test.ts`: a revision only origin holds is fetched and run, with the clone's refs unchanged
  and no `FETCH_HEAD`; a revision origin lacks fails by name. Measured red against the old tool.

## On the box

Changes 1 to 4 were tried first as runtime drop-ins under `/run/systemd/system/` on the test box (a reboot removes them):
the optional paths; ordering references from the always-active service unit to the run units, which keep them loaded
so `show` reads their real end (standing in for change 2 until it ships); a `mkdir -p /tmp/r` step in the run unit; and
`Type=oneshot` for the install unit. With them, `ccrc testbox-admin parity` passed three times, once on a named pull
request and twice on its default scope (the newest merge, the second after a service restart): every sampled file agreed
on both sides (56, 46 and 46 files), the three
fixtures were byte-identical, and the record read `pass`. Change 5 was found on the fleet box and is held by its test.

With the oneshot drop-in, the next pristine build ran `npm ci` to its end, and the post step waited for it. That
build then failed on its own: the package's `postinstall` runs a script under the package, and a pristine build lays out
only the row's install inputs (`package.json` and `package-lock.json` by default). That is row data, not code: the row's
install inputs (the connect card's inputs field) must name every file the package's install scripts read. Until they
do, runs install in their own copy, as they did before this plan.

## Deviations found

- **D-8961 (2026-11-23)** — testbox-rwpaths-optional. The prepare and install units name the directory their privileged
  first step creates as `ReadWritePaths=-…`, because systemd 259 sets up that step's namespace too and failed it with
  `226/NAMESPACE` before the directory existed. The main step still has that one writable path; the run unit keeps the
  strict form (spec §2.2, §2.3).
- **D-8962 (2026-11-23)** — testbox-collected-pass. A unit the system manager collected after it passed reads in `show`
  as `ExecMainCode=0`, `Result=success`; with `start --wait` exiting 0 that is now a pass. Before, every passing
  prepare read as `prepare failed (git checkout: exit 255)` and every passing clean as failed, so both run users stayed
  held and the queue admitted nothing (spec §2.3).
- **D-8963 (2026-11-23)** — testbox-run-tmpdir. The runner makes the spec's `TMPDIR` inside its unit's private `/tmp`,
  as the prepare does in its own; the run unit's `/tmp` is not the prepare's, so every `mkdtemp` of a run failed with
  `ENOENT` (spec §2.2 "Temp").
- **D-8964 (2026-11-23)** — testbox-install-oneshot. The install unit is `Type=oneshot`, so its `ExecStartPost=`
  install-post runs after `npm ci` exits 0; under `Type=exec` it ran at once, found no `node_modules` and failed every
  pristine build. Its bound is `TimeoutStartSec=` from `CCRC_TESTBOX_UNIT_MAX` in the installer's drop-in (spec §2.2).
- **D-8965 (2026-11-23)** — testbox-parity-fetch-rev. `ccd/testbox-parity` fetches a revision its clone does not hold
  from origin by its id, under the step's bound, writing no ref and no `FETCH_HEAD`, so a parity run right after a merge
  no longer fails with `cannot add a worktree`.
