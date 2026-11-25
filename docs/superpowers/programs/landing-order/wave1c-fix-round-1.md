# Landing order wave 1c, fix round 1

Run 3698, sent back to `working` by the coordinator's ruling on review run 3727 (round 1), which read
tip `052169a265d4f4a9e34d868a2b8af5c13b562892`. Findings are the review's; rulings are the
coordinator's.

## Fixed

- **F1, the base sha's source.** The run-care section told the sender to copy `base: <sha>` "from the
  command's output", but the one command it showed is the merge-tree probe, which prints a tree id and
  the conflicted paths, never a commit. A tree id in `base:` leaves the worker's own probe unmeasured, so
  the mail would license nothing. The measure step now runs `git rev-parse origin/main` in the same call
  as the probe, after the one fetch, says the probe prints a tree id and the rev-parse line the commit,
  and the mail's `base:` is "copied from the rev-parse output and never typed". The plan's snippet carries
  the old sentence; the coordinator corrects the plan on its ledger pull request. Departure, by slug
  `run-care-base-from-rev-parse` (unnumbered). `conflict-sync-text` now holds `git rev-parse origin/main`
  and the new source sentence (row F1 in the Task 4 table).
- **F2, the reference's own bound.** `conflict-sync-text`'s bound case checked the run-care reference by
  its lead-in only. It now also holds `absorbs exactly that commit, once, with \`git merge\`` and
  ``A newer `main` is not the named commit`` (row G1).
- **F3, the wave-done limit outside the clause.** A new case holds `before your wave-done only` in the
  worker skill and the hook, and `before the worker's wave-done only` in the README (rows G2, G3). The
  hook itself is not changed; only the test is.
- **F4, ruled: which wave-done.** A worker sent back to `working` for a fix round is before its
  wave-done. The run-care section gains one sentence saying so: the limit is the run's state, at
  `working` with this round's wave-done not yet sent, never at `awaiting-review` or `merging`, where the
  ejection that names a base is the only route. So that the paragraph does not contradict it, its two
  existing phrases `after a wave-done` and `has sent its wave-done` now say `this round's wave-done`.
  Clause 16, its pin, the hook's and the README's limit words are unchanged.

## Done because small

- **A1.** The run-care file's H1 and `wave-lifecycle.md`'s index row name the new section (`a conflict
  mid-round`). No test pins either line; nothing moved.
- **A2.** `conflict-sync-text`'s spelling case also holds the run-care example's subject, in prose
  (``subject `conflict-sync: #<pr>` ``) and in the mail JSON (`"subject":"conflict-sync: #<pr>"`).
- **A3, A4.** The Task 4 note now says three other skills sit under their caps on main (coordinator,
  history, linear); the Task 3 note says `git grep -l wave-lifecycle-run-care server/test` named one
  file at the time, and that `conflict-sync-text.test.ts` reads it since.

## A5, the hook packet's digest (left as it is)

The hook packet was cut as `diff -u a/ccd/session-hook.sh b/ccd/session-hook.sh` in a scratch
directory, the `a` side written by `git show 45329e5baf…:ccd/session-hook.sh` and the `b` side by a
script that made the three edits. Its `---` and `+++` header lines kept the two scratch files'
modification times, so its bytes, and the size and sha256 sent (2764,
`dc8296d0fb4d917cbf14f8af463754850d4b5605cd833e37b4bf580e981be63e`), depend on those times and cannot be
reproduced from the diff. The hunks below the headers can. The README packet's header times were
stripped before hashing, which is why that one reproduces. The holder answered on the hunk it read; the
applied hunk is what the tests expect.

## Measured

- `conflict-sync-text` after the edits: 4 of 4 green (4 cases: spelling, bound, wave-done limit, body
  entries). Before the run-care edit, the F1 assertion was red and the rest green.
- Rows G1, G2, G3 and F1 in `wave1c-task-4.md`: each new assertion red under its mutation, each file
  restored from a saved copy with its sha256 checked equal.
- The reader set after the round is in the wave-done.
