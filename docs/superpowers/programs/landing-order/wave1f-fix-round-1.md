# Wave 1f, fix round 1

Review run 3793 read the tip `d7daacef34`: nothing critical, nothing important, ten minor points and nits. The
coordinator ruled six of them in (R1 to R6) and left F6, F7, F9 and F10 out of this round. This note records each
ruling and what moved. The branch defines no deviation number. The one new departure is named by its slug.

## R1 (review F1): ten runs, not six

The window sentence says ten merge-queue runs created from 00:17Z to 01:58Z on 2026-11-25 ran the suite. Ten is the
coordinator's re-measure: the plan said six. Changed in three places, comment lines only in the two source files:

- the workflow's `FOUR SHARDS (D-9026)` comment ("in the ten merge-queue runs created …"), re-wrapped at its 77 columns;
- the browser-leg case's comment in `server/test/ci-pipeline.test.ts`, re-wrapped at 120 columns;
- `wave1f-task-2.md`, which now says the count was corrected here and that the range 916 s to 1,211 s holds over ten.

In both source files the diff is one line, and it is a comment line.

## R2 (review F2): Node documents 1 to 14

`.github/ci/queue-live.mjs`'s header now says 64 is none of the codes Node documents for its own exits (1 to 14), nor
128 plus a signal's number, nor 126 or 127. The conclusion is unchanged. `wave1f-task-3.md`'s "Why 64" says the same,
and says it read 1 to 13 before this round.

## R3 (review F3): one contradicting comment removed

In `server/test/conflict-sync-text.test.ts`, the old sentence "Flattened, the fence's close follows the rev-parse."
is deleted. The new comment beside it ("… follows the echo") stays.

## R4 (review F5): the budget comment and the note say the same things

The harness scan's budget comment now gives both measured loads: about 11 for the run that split the time by phase
(read right after it), and about 9 for the plain run before it, which took 16.6 s. It says 60 s is about 2.7 times the
slowest file time it cites (22.6 s), where it used to say "about three times". `wave1f-task-4.md` states the same two
loads and the same ratio. The comment was also re-wrapped so that no figure is split from its unit.

## R5 (review F4): the characterization no longer depends on the legacy list

The choice: freeze a copy of the exclusion set inside the case. To do that, the plan read takes its filter as an
argument. `readPlanBlobsAt(ref, keep)` lists and batch-reads the `.md` plans that `keep` admits, and `readPlansAt(ref)`
(which `plansAt` caches) calls it with `!LEGACY_PER_PLAN_LEDGERS.has(file)`. The characterization case calls
`readPlanBlobsAt` with a frozen `Set` of today's three names, so its recorded count (962) and sha256 (`ec50384b…2433`)
still describe exactly the bytes they described before. Because this changes the reader's shape, not only the case,
it is the departure `plans-read-filter-param` (D-9076).

Since this round the case no longer guards the wiring from `readPlansAt` to the legacy list. Review run 3809 measured
that another case does: with `readPlansAt`'s filter made to keep every file, the case that names the sub-211 collision
set goes red (1 failed of 35).

Measured, each through `ccrc test` on the test box, from `server/`, `test/deviation-refs.test.ts`:

| What | Result |
|---|---|
| the suite after R5 | 35/35 (the cross-tree case 2.3 s, the characterization 0.9 s) |
| `LEGACY_PER_PLAN_LEDGERS` loses its last entry, the case as R5 left it | 35/35: the characterization stays green; saved copy restored, sha256 `38c743e5…fac3` matched |
| the same list change, the case as it was at `d7daacef34` | red, 1 failed of 35: `expected 963 to be 962` (the review's F4, reproduced); restored, matched |
| row 1F-10 (the batch read drops the last plan of a tree) on the case as R5 left it | red, 3 failed of 35: the characterization `expected 961 to be 962`, and both incident cases; restored, sha256 `38c743e5…fac3` matched; green 35/35 |

## R6 (review F8): rows 1F-11 to 1F-14

The four text pins with no row are now measured, each red (1 failed of 5) then green. The rows are in `wave1f-task-5.md`:

- 1F-11: the README's wave-done sentence;
- 1F-12: the tip lookup line;
- 1F-13: the sentence that the probe's own exit status is the `probe exit` line;
- 1F-14: the sentence that the paths are for the reader.

## Not in this round (the coordinator's rulings)

F6 (numbers for the slugs, and the plan's text on the budget) goes on the coordinator's ledger pull request. F7 (the
fence prints exit 1 for a conflict and for an unresolvable tip, told apart by the tree id) stays as it is. F9 and F10
are unchanged.

## Gate

The suites of the files this round touches, each alone through `ccrc test` on the test box, from `server/`:
`conflict-sync-text` 5/5, `ccd-harness-integrity` 13/13, `ci-pipeline` 132/132, `deviation-refs` 35/35, `queue-live`
10/10, `ci-merge-queue` 7/7, `oss-metadata` 29/29, `workflow-yaml-parses` 23/23. No full suite ran locally. The push
changes the workflow file, so the pull request runs the whole suite again, browser shards included.
