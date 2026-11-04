# A shellcheck count ratchet in CI (task note)

Issue #1570. This note records the rule, the measurements behind it and the departures from the triage; the
coordinator folds it into the ledger.

## Deviations found

- **D-7995 (2026-11-03)** — shellcheck count ratchet: pinned version, one group for ccd/ccd and ccd/lib, a parse stop
  is a failure, and the pass is left to the queue. `server/test/shellcheck-ratchet.test.ts` pins each tracked bash
  file's warning-level count in `server/test/shellcheck-baseline.json`. Counts may only go down, and a file with no pin
  must have 0 findings.

## Departures from the triage

- **A parse stop fails whatever the count.** The triage's rules had a hole: a file shellcheck cannot parse reports one
  or two findings and checks nothing after them, so breaking a file would read as lowering its count. SC1072 or SC1073
  on any file is now a failure, and that file is never offered as a lower pin.
- **Five directives, not three.** `ccd/ccrc-doctor-checks` had five ` -- reason` directives by the time this was built.
  All five are fixed, comment text only, and the file now parses: 113 findings, where it reported 2 before.
- **The red-first demonstration uses SC2034, not SC2086.** SC2086 is info level, so `-S warning` never counts it (0
  across the whole corpus). Adding one to a pinned file moves nothing. The ratchet's own red cases append an unused
  variable to a scratch copy instead, and SC2164 would not do either: shellcheck drops it under `set -e`.
- **The install is in server-deps, not ci.yml.** That action is the one definition of what a server job needs, and any
  Linux server job can receive this test. `.github/ci/shellcheck-install.sh` installs the release tarball, checked
  against the sha256 in the baseline, since the runner's own shellcheck is older than the version the counts were
  made with.
- **The macOS CI legs skip, though CI is set.** `ccd/ccd` alone peaks at 6.2 GB on a 7 GB runner, and the same tool over
  the same files adds nothing to the Linux legs. A skip there cannot hide a red, because the Linux legs of the same
  run judge the same counts. Every other CI run fails on a missing or different version.
- **The test is excluded from the guards by name.** It lists the tracked tree, so `TREE_READER` would run it on every
  fast pull request. `HEAVY_TREE_READERS` in `fast-plan.mjs` leaves it to the queue, the full suite and the map.

## Measured (shellcheck 0.11.0, local)

| File | Peak RSS | Time alone |
| -- | -- | -- |
| `ccd/ccd` | 6.2 GB | 25 s |
| `ccd/ccrc` | 4.1 GB | 13 s |
| `ccd/ccrc-doctor-checks` | 1.2 GB | 4 s |

The whole pass is about 30 s at two lanes. Two is the limit: both large files at once is about 10 GB on a 16 GB runner
that is also running the shard's vitest workers.

## Not in this change

Triage of the SC2100 hits and of the SC2178/SC2128 ones that are not intended reuse. One pull request per real bug,
and a directive with a reason for each intended one.
