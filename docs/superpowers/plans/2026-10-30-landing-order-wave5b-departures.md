# Landing order wave 5b: three departures from its plan, recorded

- **D-7606 (2026-10-31)** — `worker-bullet-rewrap` (Task 3): the worker skill's `A fix-round mail arrives` bullet is
  rewrapped whole, not only the lines of the sentence that gains "usually".
- **D-7607 (2026-10-31)** — `clause-15-reading-new-head-only` (review 1302, F2): D-7590's reading of clause 15 is
  narrowed to the operator's ruling. A report-less fix round from `merging` takes one of two forms, a red the PR owns
  licenses no absorb, and a dequeue's other causes stay a stop.
- **D-7608 (2026-10-31)** — `main-own-evidence-first-parent-and-merge-queue` (review 1302, F1, F3 and F4): the
  new-head route's evidence reads `main`'s first parents and counts only a merge-queue run, and its round is sent only
  on a measured clean merge. This amends D-7589.

**D-7606.** The plan asked for only the lines of the changed sentence to be rewrapped. The added word pushed that
sentence past the bullet's width, so the bullet's other original sentences were reflowed too. Review 1302 measured it:
flattened, the only change to the original sentences is the added word "usually". The five old lines are six new ones,
all within 80 columns, and no other wording changed. This is a whitespace-only departure.

**D-7607.** The operator's answer of 2026-10-30 to D-7536's question covers the new-head route only. D-7590 read every
report-less round from `merging` as clause 15's ejection, the queue's dequeue included. Under that reading, a dequeue
for a red the PR owns, with no conflict measured, sent the worker an absorb of `base:` that clause 15's words do not
allow. Step 6 and the worker's fix-round bullet now name two forms, and the cause the coordinator measured decides
which is sent:
- **An ejection** keeps its three entries (`ejected: new-head:#<pr>` or `ejected: dequeued:#<pr>`, then `base:`, then
  `checks:` or `paths:`). It is sent for the new-head route, as clause 15's ejection on the operator's answer, and for
  a dequeue whose conflict was measured with `git merge-tree --write-tree --name-only --no-messages origin/main
  <handoffCommit>` (exit 1, with its paths), as the conflict-sync clause 15 already allows.
- **A red the PR owns** is two entries, `red: #<pr>` and `checks:`. It is sent for a queue dequeue on a required check
  with no conflict measured, and for the verdict's `RED` line on the PR's own red. It has no `base:` and licenses no
  absorb: the worker absorbs only on its clause 16's first two triggers.

A dequeue with any other cause, a requested change or a cause the coordinator could not read among them, stays a stop
for the operator. Clause 15 and worker clause 16 are unchanged.

**D-7608.** This amends D-7589 in three places:
- **First parents.** The red-on-`main` read is `git rev-list --first-parent --max-count=20
  <handoffCommit>..origin/main`. Without `--first-parent`, on a project that lands with merge commits, the read lists
  another PR's own branch commits, and a red during that PR's development would read as `main`'s own. Review 1302
  measured this in a scratch repository.
- **Merge-queue runs only.** A passing read on `main`'s tip counts only when a check run of that name concluded success
  in a merge-queue run. The check run's `check_suite.id` must equal the `check_suite_id` of a workflow run on that sha
  whose `event` reads `merge_group`. The full-run arm is dropped, because the fields these reads return cannot tell a
  scheduled or dispatched full run from a refresh run, and a refresh run runs no test legs yet reports the required
  summaries green. The old reason, a push to `main` that runs no test legs, is dropped too: the CI workflow has no
  `push` trigger. Any other run, a name that only a status reports, and a tip with no merge-queue run leave the stop
  standing.
- **A measured clean merge.** The new-head round is sent only when, after one fetch, `git merge-tree --write-tree
  --name-only --no-messages origin/main <handoffCommit>` exits 0. If the worker's merge of `base:` still does not apply
  cleanly, it aborts, pushes nothing and asks, because resolving a conflict is not that round's work.

The plan is not edited, because merged plans are append-only. This file is the record, and the programme ledger
folds it in.
