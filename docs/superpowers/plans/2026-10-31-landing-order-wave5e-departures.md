# Landing order wave 5e: six departures from its plan, recorded

The plan itself defines D-7610 to D-7627. These six were found while the wave was reviewed and fixed.

- **D-7628 (2026-10-31)** — `gate-per-file-route-count` (Task 3): `auth-gate.test.ts` also pins
  `scanRoutes('coord/routes.ts').length`, which moves from 57 to 58. The plan did not list it, but its route sum
  implies it.
- **D-7629 (2026-10-31)** — `closed-client-skill-verb-list` (Task 4): `ccrc-api-closed.test.ts`'s expected skill-verb
  list gains `landing.show` in Task 4's commit. That census harvests `ccrc-api` commands from the skill's indented
  blocks, and step 6 names `ccrc-api landing show`. The plan said Task 4 does not modify that file.
- **D-7630 (2026-10-31)** — `kept-arm-cases` (Task 1): three fail-closed arms of `decideLandingWrite` had no case that
  goes red on mutation. They are a pin onto an `unknown` row, a retreat onto another run's pinned entry of the same PR,
  and a retreat onto this run's own entry that is not pinned. Three store cases and rows 5E-DATA-24 to 26 were added.
- **D-7631 (2026-10-31)** — `purity-describe-on-scan-symbols` (Task 2): the plan's purity describe for `landingLine.ts`
  read the file as text, which the ARCH-06 literal-source-pin ratchet in `single-definition/advance-switches` forbids
  for a new file. It is keyed on `test/scan` instead, with every property and its CONTROL kept and no ceiling row
  raised.
- **D-7632 (2026-10-31)** — `census-suites-outside-the-gate` (round 1, item 1): `refusal-status`'s inline-send ratchet
  and the two L0 import-count pins (`peers-claims-l0`, `collect-lane-l0`) read files the wave changes, and the plan's
  gate did not list them. The two refusals are now sent through `refuseAdvance` and `refuseRoute`, the pins name
  twelve lines, and the wave-done follows the PR's fast run.
- **D-7633 (2026-10-31)** — `review-guards` (round 1, items 2 to 4): guards the plan's tables lacked, and their rows.
  They are the re-pin's `pinnedAt`, `runId` and `handoffCommit` (5E-DATA-27 to 29), the purity describe for
  `landingEntry.ts` (5E-DATA-30 and 31), and the whole-row pin of §4's `ejection-not-merging` row (5E-SKILLS-17).

**D-7628.** The route census in `auth-gate.test.ts` counts the routes of `coord/routes.ts` as well as the sum over the
files. `GET /api/landing` is the 58th. The plan's totals already implied the move, and no code changes for it.

**D-7629.** The closed-client census reads the skill's indented blocks for `ccrc-api` verbs. Step 6 now names
`landing show`, so the expected list gains `landing.show` in the commit that wrote the step.

**D-7630.** `decideLandingWrite` keeps three arms that leave a row untouched. Each one is a fail-closed answer, and none
had a case that went red when the arm was removed. The wave added the three cases and measured them.

**D-7631.** A literal source pin on a new file is a ratchet violation, so the purity guard for `landingLine.ts` reads
the scan library's parsed file and identifier references instead. Every property the plan listed is still checked.

**D-7632.** Three suites outside the plan's gate failed at the wave-done's tip. The fix sends both new refusals
through the file's helpers with the wire bytes unchanged, and the two L0 pins count the twelfth import line.

**D-7633.** The re-pin writes three columns that no suite pinned, and `landingEntry.ts` had a header that promised no
fs, no `node:sqlite` and no clock but nothing that checked it. The wave added a case and a purity describe, and the
whole `ejection-not-merging` row of §4 is now pinned, so a deleted sentence is red.

The plan is not edited, because merged plans are append-only. This file is the record, and the programme ledger folds
it in.
