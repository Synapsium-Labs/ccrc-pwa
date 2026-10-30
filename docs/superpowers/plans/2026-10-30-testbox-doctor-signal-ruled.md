# The test box's doctor line, update-lane signal and durations timer: departures ruled as built

Task TB11 of the test box plan (`docs/superpowers/plans/2026-10-29-test-box.md`, D-7413) adds the doctor's `testbox`
line, the update lane's one tools sync call after a passed gate, the daily durations timer, the lifecycle rows and the
README. The build met three places where the plan names something the merged contract cannot give, and one count the
plan does not name. The number was issued by the ledger on 2026-10-30.

- **D-7567 (2026-10-30)** — `testbox-doctor-signal-departures`: TB11's doctor line, update-lane signal and durations timer, four departures ruled as built.

**D-7567.** The four, each as built:

1. **The durations timer's rows.** The plan has the timer fetch the `testtimes` artifact "of each repository row whose
   row names one". The repository table is the test box's own config (spec §2.6), its row (`TestboxRepoRow`) has no
   field naming a GitHub repository or an artifact, and the fleet host holds no row (D-7558, departure 2). So the timer
   reads its rows from a sources file beside the durations file: `CCRC_TESTBOX_TIMES` with `.sources` in place of a
   trailing `.json` (default `~/.ccrc/testbox-times.sources`), one `<repository> <owner>/<name>` row per line, the
   repository's name as the wrapper matches it (D-7558, departure 6). No new setting is added (`deploy/ccrc.env.example`
   is TB1's): the path follows the one setting. The written file nests each row's map under its repository's name, the
   form `agent/src/testbox/budget.ts#readDurations` reads. The trust rules are CI's own picker's
   (`.github/ci/main-artifact.mjs`), restated as jq filters because `.github/` is not in the release; the settings are
   read through `ccrc test --testbox-knobs host`, as the fleet agent's op reads them (D-7430). A failure keeps the
   previous file, logs one line and exits 0; with no `CCRC_TESTBOX_URL` the pass fetches nothing.
2. **The doctor line when the block cannot be read.** The plan names three arms: SKIP with no URL, WARN on `degraded`,
   `down` or `unreachable` with the switch on, PASS otherwise. It does not say what a check prints when the server's
   block cannot be read at all: no `ccrc-api` on the box, no answer, an answer that is not a block, or a server that has
   not polled yet. Each is a SKIP naming why, never a PASS that would claim a state nobody read, and never a WARN that
   would double the `build` and `fleet` checks' own finding about the server. A URL the server reads as unset (a value
   that is not a URL keeps its unset default in the printer) is the `off` SKIP too.
3. **Where the update lane signals.** The call sits after `cmd_update`'s gate PASSED (`gate_passed`), never on the
   restore child, and not on `--no-gate`, which measured nothing; on any role but `server`, since only a box that runs
   `ccrc test` has a test box to keep in step. It is made after the supervisor sweep and the backup prune, so the agent
   that measures the versions is the new build's. Its every outcome is one line and a return of 0, so `cmd_update`'s
   exit codes are unchanged.
4. **The healthy doctor box SKIPs one more check.** `healthy()` configures no test box, so the new line SKIPs there:
   `HEALTHY_SKIPS` rises by one, and the fleet install's class map gains `testbox: SKIP`. No other verdict moves.

The plan file is not edited, because merged plans are append-only. This note is the record.
