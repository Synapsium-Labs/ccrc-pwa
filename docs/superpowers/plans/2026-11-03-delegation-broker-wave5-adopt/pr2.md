# Wave 5, PR2: the read-only `ws-lease-audit` (task note)

This note is PR2's record for the wave's ledger pull request (Global Constraints, "Ledger edits"). The coordinator folds it into the
plan and the programme ledger. Apart from its four deviation entries (below), this PR edits no existing plan and not the programme
ledger.

## Deviations found

D-7974, D-7975, D-7976 and D-7977 are defined in the plan's "Deviations found" (the top-level wave 5 plan, by the coordinator's
placement rule in mail 14826, as D-7869 was), one each for review 1446's findings F1 to F4, ruled in mail 14894. The rest of
this PR's block is unused.

- **D-7974 reaches `ws-lease-mark`.** The fix is in PR1's helper `_dl_tree_of_record`, which both verbs read: rc 3 (a gone tree)
  now needs a proven absence (`_ws_reclaim_absent`), and an unsearchable parent answers rc 4. In the mark, that refuses
  `unmeasured` where it used to proceed: a release of a tree it could not prove gone, or a holding mark's `no-tree`. Its
  direction is fail-shut. W5-L30 pins the release case.

## Review 1446: what each finding changed

- **F1 (D-7974):** above. Rows W5-AU6b (the audit) and W5-L30 (the mark).
- **F2 (D-7975):** `dirty` reads `_ws_gc_dirty` and `_ws_reclaim_hidden` (no second copy). It is true if either sees an edit,
  else `unmeasured` if either cannot read, else false. Row W5-AU11 (assume-unchanged and skip-worktree).
- **F3 (D-7976):** `branchAheadOfBase`, the count from the creation base to the carrier's recorded branch, is read once with
  `for-each-ref` on the exact `refs/heads/<branch>` name in the same contained git. Its values: `'no-branch'` (none recorded),
  `'branch-gone'` (recorded and missing, which makes `changed` unmeasured, because its commits can no longer be counted, never
  0), and `'unmeasured'`. Row W5-AU12 covers four cases: detached at the base, reset to an ancestor of the base, the branch
  deleted, and no branch recorded.
- **F4 (D-7977):** the token binds `holders=` (the sorted pids, `unmeasured` or `not-asked`), and `branchAhead=` and
  `branchTip=` too. Row W5-AU8b: four answers, four tokens.
- **F5:** W5-AU8 amends a commit, so the tip moves and neither count does; the token changes.
- **F6:** W5-AU4c rewrites the stored carrier's `claudeBase`, which makes both counts and `changed` unmeasured.
- **F7:** the superset is accepted (see "Measured" below). `STUBS` now carries the orphan verb's three stubs whole,
  `_ws_collect_idle` included. The audit never asks the collector's idle walk, so the stub is inert for its rows. PR4's orphan
  rung does ask it, so its copy must not differ.
- **F8:** the library's comment and CLAUDE.md's sentence say "writes nothing to any durable path" and name the two residuals:
  the dirt readers' scratch files under `$TMPDIR` (`_ws_gc_dirty`'s and `_ws_reclaim_hidden`'s, each made and removed in one
  call), and a gitattributes clean filter that `git status` and `git hash-object --path` still run. W5-AU7 now also lists the
  main checkout's whole common directory.
- **F9:** the library's header no longer says every verb in it is on the SAFETY list, and names the audit. README's
  description of the library is the coordinator's to carry: README.md is claimed by another run.
- **F10:** W5-G14 walks every `ccd/*-skill` directory, and holds that the five known ones are among them.
- **F11:** W5-AU10's scan ends at the end of `_dl_audit_ladder`.
- **F12:** one number grammar. `_dl_count_ok` is the library's ONE spelling of the ten-digit bound, used by the mark's
  `--generation` and `--journal-seq`, by the audit's `--generation`, by both commit counts (above 0) and by holder pids.
  `ccd-ws-add-child`'s census now sets that one line apart by its name (it set the mark's two usage lines apart before); the
  test says why.
- **F13:** the tip and the recorded branch are each read once; the counts are `<base>..<tip>` and `<base>..<branch tip>`, from
  those reads.
- **F14:** the runner row's comment says what it buys: 60 s instead of the flat 90 s. It gives the two walks' worst case under
  `_plat_timeout`'s TERM-to-KILL grace: about 26 s at the default 3 s grace, 36 s at the widest. W5-G15 holds the row below the
  flat default.

## Measured, not departures

- **The fixture move (Task 5.2.1 Step 1), accepted as a superset (F7).** `server/test/leaseFixture.ts` exports the plan's names
  (`LEASE`, `OTHER`, `INC`, `hex`, `agentTree(h, name?)`, `mark(h, over?, pre?)`, `carrier(h, id?)`) and `STUBS`. It also
  exports what their bodies need, all taking the harness: `THIRD`, `BASE`, `Flags`, `Out`, `run`, `reg`, `leasesDir`, `main` and
  `carrierPath`. `agentTree` keeps two optional trailing parameters (`at`, `from`) for W5-L27's nested trees.
- **The move commit's wrappers.** In the move commit, `ccd-ws-lease-mark.test.ts` binds each helper to its own harness under its
  old name, one wrapper constant each, in place of the old bodies. No call site and no case changed, which is the reading of
  "changing only imports" taken here.
- **`changed`** is unmeasured whenever `dirty`, `aheadOfBase` or `branchAheadOfBase` is unmeasured, or the branch is gone, even
  when another fact reads true, as the rule's text says. A consumer reads unmeasured as changed (a missing audit counts as
  changed).
- **The exit status** is 1 whenever any fact is unmeasured, `holders` included; the document is still `ok: true` there.
- **The main checkout.** A main checkout proven absent refuses `no-tree`. One that is a link, not a directory, or not directly
  under the physical projects root refuses `unmeasured`.
- **What a moved tree answers.** The fingerprint binds the tree's directory identity, not its path, so a tree moved by `git
  worktree move` on one filesystem keeps it, and the audit measures it where its admin record names it now.
- **A `released` carrier whose tree still stands audits `ok`** (review 1446's note). The audit never reads the carrier's
  `state`: the server owns the lease's state in its journal. A consumer must not read an `ok` audit as "the lease is live".
- **`holders`** asks `_ws_path_users_many` of the tree as git records it and of its physical spelling when they differ, then
  `_ws_cwd_users` of the physical one, and unions the pids. Without `--holders` neither probe is asked.
- **The direct-entry boundary.** As the plan says, the read-only verb starts protected, as its writer does. W5-G12 is measured
  by `agent/test/ccd-entry-exec.test.ts` and by shapes and a case variant in `server/test/ccd-ws-lease-mark-reach.test.ts`.
- **W5-G10** (the caps token) is measured by `ccd-archive.test.ts` against `server/test/ccdCapTokens.ts`, and by
  `ccd-verb-sets.test.ts`.
- **Rows the plan does not list:** W5-AU0 (the grammar), W5-AU10 (the refusal words), and the fix round's W5-AU4c, W5-AU6b,
  W5-AU8b, W5-AU11, W5-AU12 and W5-L30.
- **The first two full CI runs were red** on static pins outside the plan's tip list. On the first, `ccd-ws-add-child`'s run-id
  census (the audit re-spelled the ten-digit bound) and `single-definition/core-vocab`'s one path to ccd (W5-G15 spelled it).
  On the second, `ccd-lib-load`'s "no test file reads CCD as text". F12 replaced the first cure, a re-spelled bound, with the
  one helper.

## The mutation table, as measured

Each mutant was applied alone to the working tree from a saved copy, restored and checked by SHA-256. Each run was bounded by
`timeout -k 10 600` and `ulimit -u` at the measured thread count plus 1500. The coordinator skill's `mutation-run.py` mutates
Python modules only, so the bash and TypeScript mutants used the saved-copy driver PR1 used. The fix round's mutants were
re-measured at its tip.

MUTATION-TABLE
