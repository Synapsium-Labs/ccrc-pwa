# Wave 1f, Task 2: three comments say what was measured (wave 1e)

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave1f-known-limits.md`, Task 2. Comment lines only.

## What changed

- `.github/workflows/ci.yml`, job `browser-pwa`:
  - `FOUR SHARDS (D-9026)`: "in the six merge-queue runs of 2026-11-25 that ran the suite" became "in the ten
    merge-queue runs created from 00:17Z to 01:58Z on 2026-11-25 that ran the suite". Fix round 1 (R1) made it ten: the
    plan said six, and ten ran the suite in that window; the range 916 s to 1,211 s holds over the ten.
  - `THE LIMIT IS 30 (D-9055)`: "a third green shard was cancelled" became "another green shard was cancelled", and
    "and at 1.7 times a balanced shard of four would stand about three minutes under 20." became "and at 1.7 times the
    slowest shard of the four-shard run that landed this (743 s of tests and about 40 s of setup) stands at about 22
    minutes, over 20." (743 s plus 40 s, times 1.7, is about 1,331 s, about 22 minutes.)
  - Both paragraphs re-wrapped at their own width (77 columns).
- `server/test/ci-pipeline.test.ts`, the browser-leg case's comment: "in six merge-queue runs of 2026-11-25" became "in
  the ten merge-queue runs created from 00:17Z to 01:58Z on 2026-11-25" (ten since fix round 1, R1), re-wrapped at 120
  columns.
- `pwa/browser/add-project-sheet.browser.test.ts`, header: the helpers are "copied, trimmed, from
  `projectLinkingCardRig.ts`, which the two linking-card files share." Measured: `projectLinkingCardRig.ts` is
  imported by `project-linking-card.browser.test.ts` and `project-linking-card-wide.browser.test.ts` (and this file).

Every phrase the plan gave as "old" occurred once and was replaced as written. `git diff` on the three files shows
comment lines only (a filter of the diff for changed lines that do not start with `#` or `//` printed nothing).

## Suites (each through `ccrc test`, one file per process, on the test box)

From `server/`: `ci-pipeline` 132/132, `ci-merge-queue` 6/6, `oss-metadata` 29/29, `workflow-yaml-parses` 23/23.
From `pwa/`: `browser-leg` 22/22. No case reads these comments, so there is no mutation row for this task.
