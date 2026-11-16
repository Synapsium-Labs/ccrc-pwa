# The flake ledger

## Goal

Know which CI failures were not the code's. A flake is a job that failed and then passed on the same head sha (a re-run attempt of one run, or a second run of the same workflow on that sha). `.github/ci/flake-ledger.mjs` reads the repository's `merge_group` and `pull_request` runs over a window of days through `gh api` (read-only GETs) and writes one ledger row per such pair, as JSON lines, with a top-N summary by failure signature.

## What was read first

- The house style of `.github/ci/*.mjs`: a header that says what the script decides and how it is run, pure exported parts unit-tested under `server/test/ci-*.test.ts`, one function that talks to GitHub, and a `main` guarded by `import.meta.url` (`codex-wire-watch.mjs`, `main-artifact.mjs`, `verdict.mjs`).
- GitHub's job listing with `filter=all` returns the jobs of every attempt of a run, each with its own `run_attempt`, `conclusion` and `head_sha`, so one listing per run covers its re-runs. A filtered run listing returns at most 1000 runs, so the window is listed one UTC day at a time.
- `ci.yml` runs vitest with explicit reporters (`default` and the file-times reporter), so vitest's own GitHub annotations are not emitted and a failed job's annotations are mostly the generic exit-code line. The log's `FAIL` lines are where the failing test is named.

- A read-only run of the script against one day of this repository's runs, written outside the tree, checked the API assumptions: a 100-job page of a re-run run's `filter=all` listing came close to GitHub's own timeout (a 502, then a cancelled stream), so jobs are listed 50 a page and a server error is asked again twice; `gh api` refuses to print a job log's colour codes without `--allow-escape-sequences`; and a shard that fails with every test green fails on vitest's "Unhandled Errors" section, whose cause line is the signature (the test file it names is listed beside it). Nothing from that run is committed.

## Deviations found

- **D-8268 (2026-11-11)** — flake-ledger: a read-only script, not a workflow or a required check (either needs an operator ruling). A row is every failed (or timed-out) execution paired with the first later pass on the same workflow, job name and head sha; a failure no pass followed is no row. The signature comes from the cheapest source that answers: the failed job's log (vitest `FAIL` lines, an unhandled error, a specific `##[error]` line), then its annotations, then the failed step's name. The merge-queue keeper may call it on its own schedule; nothing in this repository does, and no live data is seeded.

## Tasks

- [x] T1. Tests first, red: `server/test/ci-flake-ledger.test.ts` over fixtures for the run pre-filter, the job mapping, the pairing (re-run, cross-run, fail-fail-pass, pass-then-fail, cancelled between, keys never crossed, exclude), the log and annotation signatures, the summary, the window and the arguments, the whole pass over an injected reader, and the CLI against a fake `gh` on PATH.
- [x] T2. Build `.github/ci/flake-ledger.mjs` to the tests, with the header documenting how to run it and that the keeper can call it.
- [x] T3. A read-only run against one day of live runs, its output kept outside the tree; three fixes from it, each test first: jobs 50 a page with server errors retried, the log asked for with `--allow-escape-sequences` (and without it on an older `gh`), and vitest's unhandled-error section read by its cause line.
