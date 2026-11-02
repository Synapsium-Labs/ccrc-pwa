# CI: the merge queue skips the browser shards for a group that cannot reach them

**Why.** The browser suite is the merge queue's longest leg: two shards of about nine and a half minutes each since
D-7746. A group that changes only `docs/` cannot change anything the browser tests load, but the queue ran them anyway,
because the operator's ruling of 2026-10-25 made a merge-queue run the full run with no exceptions.

**The ruling.** The owner's ruling of 2026-11-02: in `merge_group`, the browser shards skip their tests when the group
cannot reach them, decided by `.github/ci/reach.mjs` with a browser-package rule. This reverses 2026-10-25's "the queue
runs every test" **for the browser shards only**. Every other leg still runs every test in the queue. The pwa unit
suite renders `docs/`, so `docs/` stays off the pwa suite's FOREIGN list.

**D-number: pending.** The ledger issues D-numbers, and its process belongs to another session. This note records the
ruling until the ledger gives it a number. The pull requests below cite it as "the owner's ruling of 2026-11-02".

## The change

- **`reach.mjs`.** `docs/` joins `FOREIGN.browser`. A new `QUEUE_SKIPPABLE` (`['browser']`) and `queueScope(pkg,
  changed)` answer `skip` for the browser leg when every file of the group's change is foreign to it (`skipsTests`,
  which reads the same FOREIGN and READS lists a pull request uses). Otherwise, and for every other package, they
  answer `all`. In a `merge_group` run the CLI diffs the group from `--base` (the queue's base sha) to HEAD, so a group
  of several entries is judged on all of them. A change list it cannot read runs the tests.
- **`ci.yml`.** `browser-pwa` gets a step of its own, "Can this merge-queue group reach the browser tests?", that runs
  only in `merge_group` and passes `github.event.merge_group.base_sha`. The steps after it are gated on both answers,
  the pull request's and the queue's. The skip is by STEP, like every leg's, so the job still runs and each shard
  reports success.
- **`test (pwa)`'s queue refusal is unchanged.** It passes only a browser result of `success`. A deliberate skip is a
  success, so it passes. A shard that failed or was cancelled still fails it, and so would a job skipped by `if:`,
  which browser-pwa never carries. `server/test/ci-pipeline.test.ts` evaluates both the refusal and the browser leg's
  step conditions on the workflow's own expressions.
- **The census.** `server/test/ci-reach-census.test.ts` scans the browser leg over what it actually loads: pwa/src,
  ui/src, pwa/browser, and the pwa/test modules the browser files import (followed transitively), not the whole pwa/test
  tree, whose docs reads are the pwa suite's. It also checks that the build config names no `docs/` path.

## Landing

Rules files (`.github/**`, `CLAUDE.md`) may change only in a rules-only pull request, so this lands in three:

1. These pins, the census and this note, while `ci.yml` and `reach.mjs` have no queue arm. The pins are
   TRANSITIONAL: each case accepts exactly one of the two whole shapes.
2. The rules-only pull request: `reach.mjs`, `ci.yml`, `CLAUDE.md`.
3. A pull request that deletes the pins' pre-skip arms, and updates the README's CI section.
