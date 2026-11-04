# Wave 5, PR2: the read-only `ws-lease-audit` (task note)

This note is PR2's record for the wave's ledger pull request (Global Constraints, "Ledger edits"). The coordinator folds it into the
plan and the programme ledger. Apart from its four deviation entries (below), this PR edits no existing plan and not the programme
ledger.

## Deviations found

D-7974, D-7975, D-7976 and D-7977 are defined in the plan's "Deviations found" (the top-level wave 5 plan, by the coordinator's
placement rule in mail 14826, as D-7869 was), one each for review 1446's findings F1 to F4, ruled in mail 14894. D-7978 is
defined there too, for review 1461's F5 (ruled in mail 15035), because the plan's Task 5.1 step 12 names `symbolic-ref
--short`. D-7976's entry is reworded for review 1461's F4. The rest of this PR's block is unused.

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

## Review 1461: what each finding changed

- **F1:** the head commit's last paragraph carries `Ledger-Edit:` directly above `Co-Authored-By:`, with no blank line, so
  `git log -1 --format='%(trailers:key=Ledger-Edit,valueonly)'` prints it (the merge commit's trailer sat in a paragraph of
  its own, which git's parser does not read).
- **F2:** `_dl_audit_heads` asks `git show-ref --exists refs/heads/<branch>` in the same contained git: rc 2 is `branch-gone`,
  rc 0 reads the tip once with `for-each-ref` on the exact name, and any other answer is `unmeasured` (an unsearchable refs
  directory and a corrupt ref answer rc 1; an older git without `--exists` answers 129). Rows W5-AU13a (the refs directory
  unsearchable; skipped under uid 0), W5-AU13b (a corrupt ref) and W5-AU13c (a branch only in `packed-refs`, read normally).
- **F3:** the tip and the recorded branch's tip are read before the dirt and again after it. If either moved, or the
  second read fails, `changed` is `unmeasured`, rc 1, with a `detail` saying the tree moved during the audit, and no retry;
  the token binds `moved=`. The counts use the first read. Rows W5-AU15a (a stub, wrapping `_ws_gc_dirty`, that commits
  between the reads), W5-AU15b (one that runs `reset --mixed`) and W5-AU15c (the same wrapper doing nothing, a CONTROL). A moved tree is unmeasured even when a fact
  reads true: the facts then describe no one state.
- **F4:** a proven change wins (below, "Measured"). Row W5-AU14: the branch gone with `dirty: true` gives `changed: true`
  rc 0, and an unreadable dirt with `aheadOfBase: 1` gives `changed: true` rc 0, with the branch-gone CONTROL still
  `unmeasured` rc 1.
- **F5 (D-7978):** the mark records the branch as `git symbolic-ref -q HEAD` with `refs/heads/` stripped, not `--short`, which
  prints `heads/<name>` when a tag has the same name. Row W5-L31. Nothing composes `ws-lease-mark` yet, so no stored
  carrier holds the old spelling.
- **F6 (a stated blind spot):** `changed: false` does not cover a commit reachable only from the tree's HEAD reflog (a commit
  made on a detached HEAD, then left by a checkout), which no branch and no tip holds. The removal paths pin reflogs
  (`_ws_reclaim_keep_reflogs`). The library's header says so; the coordinator carries it to PR7's brief.
- **F7:** `_dl_tree_of_record`'s header says rc 3 is a tree PROVEN absent and an unproven absence answers rc 4 (D-7974).
- **F8:** `GIT_NO_LAZY_FETCH=1` is exported for the audit's own git calls only (`local -x` in `_dl_audit_ladder`, not in
  `_ws_reclaim_contained`, which every reclaim ladder shares), so a partial clone's missing object is an error and the
  fact reads `unmeasured`, never a fetch that writes a pack. Row W5-AU16, on a `--filter=blob:none` clone with a staged
  rename onto a missing blob (skipped where the clone cannot be made): no pack appears, and the blob is still missing. The
  root CLAUDE.md now names `git hash-object --path` beside `git status` as a runner of a clean filter; `agent/CLAUDE.md`
  and the grant comment in `agent/src/whitelist.ts` say "writes nothing to any durable path" and point at the residuals.
- **F9:** W5-AU7 now lists the whole fixture HOME as well, less the one file the harness rewrites on every `sh()` (its `gh`
  poison). The temp root is not under that HOME. The chmod-000 cases (W5-AU5, W5-AU6b, W5-AU13a, W5-AU14's last case,
  W5-L30) return early under uid 0, as the suite's older cases do, so a root run proves nothing for them.

## Measured, not departures

- **The fixture move (Task 5.2.1 Step 1), accepted as a superset (F7).** `server/test/leaseFixture.ts` exports the plan's names
  (`LEASE`, `OTHER`, `INC`, `hex`, `agentTree(h, name?)`, `mark(h, over?, pre?)`, `carrier(h, id?)`) and `STUBS`. It also
  exports what their bodies need, all taking the harness: `THIRD`, `BASE`, `Flags`, `Out`, `run`, `reg`, `leasesDir`, `main` and
  `carrierPath`. `agentTree` keeps two optional trailing parameters (`at`, `from`) for W5-L27's nested trees.
- **The move commit's wrappers.** In the move commit, `ccd-ws-lease-mark.test.ts` binds each helper to its own harness under its
  old name, one wrapper constant each, in place of the old bodies. No call site and no case changed, which is the reading of
  "changing only imports" taken here.
- **`changed`** (review 1461 F4) is `true` when any one of `dirty: true`, `aheadOfBase > 0` or `branchAheadOfBase > 0` is
  proven, whatever its companions read; `unmeasured` only when nothing is proven and something could not be read (a gone
  branch included); `false` only when all three are proven clean or zero; and `unmeasured` when the tree moved during the
  audit (F3). A consumer reads unmeasured as changed (a missing audit counts as changed), so nothing is lost.
- **The exit status** is 1 when `changed` or `holders` is unmeasured. A fact that did not read beside a proven change
  answers rc 0, with that fact still `unmeasured` in the document; the document is `ok: true` either way.
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
- **Rows the plan does not list:** W5-AU0 (the grammar), W5-AU10 (the refusal words), round 1's W5-AU4c, W5-AU6b,
  W5-AU8b, W5-AU11, W5-AU12 and W5-L30, and round 2's W5-AU13a-c, W5-AU14, W5-AU15a-c, W5-AU16 and W5-L31.
- **The first two full CI runs were red** on static pins outside the plan's tip list. On the first, `ccd-ws-add-child`'s run-id
  census (the audit re-spelled the ten-digit bound) and `single-definition/core-vocab`'s one path to ccd (W5-G15 spelled it).
  On the second, `ccd-lib-load`'s "no test file reads CCD as text". F12 replaced the first cure, a re-spelled bound, with the
  one helper.

## The mutation table, as measured

Each mutant was applied alone to the working tree from a saved copy, restored and checked by SHA-256. Each run was bounded by
`timeout -k 10 600` and `ulimit -u` at the measured thread count plus 1500. The coordinator skill's `mutation-run.py` mutates
Python modules only, so the bash and TypeScript mutants used the saved-copy driver PR1 used. The fix round's mutants were
re-measured at its tip. Round 2's table: every mutant below was re-measured at that round's code, the new ones (AUM18 to
AUM22) and the ones whose code moved (AUM11, AUM12 and AUM17 re-targeted to the new lines).

| Mutant | Edit | Went red |
|---|---|---|
| W5-AUM1 | `dirty` read with `--untracked-files=no` in place of `_ws_gc_dirty` | W5-AU2 (the untracked case); round 2 also W5-AU14, W5-AU15a and W5-AU15b, whose stubs wrap the reader it replaces |
| W5-AUM2 | an unmeasured `aheadOfBase` folded to 0 | W5-AU4b, W5-AU4c |
| W5-AUM2b | `base` dropped from the fingerprint's inputs | W5-AU4 (answers `ok`) |
| W5-AUM3 | the generation compare skipped | W5-AU3 |
| W5-AUM4 | the generation dropped from the token's inputs | W5-AU8 |
| W5-AUM5 | the lock file touched at the ladder's start | W5-AU7 |
| W5-AUM6 | `holders` unmeasured folded to `[]` | W5-AU9 |
| W5-AUM7 | `ws-lease-audit` added to `FORBIDDEN_CCD_VERBS` | W5-G14 |
| W5-AUM8 | the ladder run outside `_ws_reclaim_contained` | W5-AU7 (the admin record's directory changes: `git status` refreshes the index, a lock and a rename) |
| W5-AUM9 (F1) | `_dl_tree_of_record`'s bare `-e` leaf test restored | W5-AU6b (audit suite) and W5-L30 (mark suite), each run alone |
| W5-AUM10 (F2) | the hidden-edit read dropped | W5-AU11 |
| W5-AUM11 (F3) | the branch count dropped from `changed` (round 2: its `proven` arm) | W5-AU12, W5-AU13a-c |
| W5-AUM12 (F4) | `holders=` dropped from the token | W5-AU8b |
| W5-AUM13 (F5) | `tip=` dropped from the token | W5-AU8. It survived its first measurement in this round: an amend on the branch also moves `branchTip=`, which the token binds now. A detached amend, which moves HEAD alone, was added, and the mutant then went red. |
| W5-AUM14 (F6) | the `claudeBase` compare replaced by `true` | W5-AU4c |
| W5-AUM15 (F14) | the runner's `ws-lease-audit` row deleted | W5-G15 |
| W5-AUM16 (F10) | a mention of the verb added to `ccd/history-skill/SKILL.md` | W5-G14 |
| W5-AUM17 (F11) | a function with another refusal word added after `_dl_audit_ladder` | none, as meant: the CONTROL that the bounded scan ignores a later function (the unbounded one would have gone red) |
| W5-AUM18 (R2 F2) | the emptiness test restored: no `show-ref --exists`, and a recorded branch `for-each-ref` does not list reads `branch-gone` | W5-AU13a, W5-AU13b |
| W5-AUM19 (R2 F3) | the second read of the tips dropped | W5-AU15a, W5-AU15b |
| W5-AUM20 (R2 F4) | the old ordering: an unmeasured fact outranks a proven change | W5-AU14 |
| W5-AUM21 (R2 F5) | the mark's `symbolic-ref --short` restored | W5-L31 |
| W5-AUM22 (R2 F8) | the audit's `GIT_NO_LAZY_FETCH=1` dropped | W5-AU16 (a pack appeared in the clone's objects directory) |
