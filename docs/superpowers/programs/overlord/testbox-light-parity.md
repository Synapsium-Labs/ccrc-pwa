# The light parity check: notes

Builds `docs/superpowers/plans/2026-11-22-testbox-light-parity.md` (D-8945, D-8946, D-8947).

## Found while building

- **junit never reached stdout.** vitest 5 writes the junit reporter to `.vitest/junit/output.xml` unless a file is
  named, so neither leg printed a report and the old comparison compared no file. Every run read "every file agrees",
  whatever the legs did. The new rule that a sampled file neither side reported differs would have failed every real
  run, so the legs now use `--reporter=tap-flat`, which prints one line per test on stdout on both sides. The fixture
  test that runs a real vitest now also checks a real test file and its skip, so it fails if the report is lost again.
- **A re-run could eat the comparison.** The flaky re-run ran inside a loop that read the comparison from stdin, and a
  leg keeps the tool's stdin. The comparison is now read into a list before any re-run.
- **A re-run could read an earlier verdict.** A re-run reuses its tag, so a client that wrote no verdict would have
  left the previous one in place. `_tp_legs` now removes the verdict file first.
- **The fake gh ignored `--limit`.** Every `--recent 1` test ran five pull requests. The fake now honours the limit.

## Checked and left as written

- `_testbox_parity_armable` (jq) and `_tba_parity_rebind` keep any extra key, so `files` needs no change there.
- `server/src/testbox.ts` and `testboxAdmin.ts` read the record only through `parityArmable`.

## Fixed after review

- **No times was the heaviest mode.** It took every flake and 32 spread files by count, 844 s of CI time on today's
  tree, past the 420-s step. It now takes at most four changed tests and eight spread files, and no flake.
- **The ceiling and the budget dropped the flakes without a word.** One 30-s ceiling now holds for every group and the
  summary names what it left out; the changed tests may use half the budget; a file that would pass a limit is
  skipped and the fill goes on.
- **The queue wait counted against the local leg's bound.** `parity/queue` is added to that leg only, and a leg
  stopped while queued is logged as a busy fleet host.
- **`--recent 1` was not the newest on the default branch.** gh lists by creation and the list had no `--base`.
- **An older server refused a record with `files`.** The reader ships now; nothing writes the field yet.
- **The trust rule was a weaker copy.** The run is now looked up and checked as `main-artifact.mjs` checks it, and a
  test holds the copy's workflow path and events equal.
- **A tracked e2e test could be sampled.** The universe is now what the package's vitest lists.
- New tests go red for each guard the review found unpinned: the untimed rules, the 1 MiB cap, negative times, the
  symlinked flakes file and a re-used verdict.
