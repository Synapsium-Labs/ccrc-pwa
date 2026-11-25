# Landing order wave 1c, Task 4: one spelling in four files, and the gate

Run 3698. Plan: `docs/superpowers/plans/2026-11-24-landing-order-wave1c-conflict-sync.md`, Task 4.

## What changed

`server/test/conflict-sync-text.test.ts` (new) reads `ccd/worker-skill/SKILL.md`, `ccd/session-hook.sh`,
`ccd/coordinator-skill/references/wave-lifecycle-run-care.md` and `README.md` from the repository root
and holds the plan's three cases: one spelling of `` `conflict-sync:` `` with no misspelling, the bound to
the named commit where it is stated, and the mail's two body entries in the run-care reference.

## Departures from the plan's snippet (for the coordinator to number or not)

- Departure, by slug `conflict-sync-text-flatten` (unnumbered): each file's whitespace is flattened to single spaces before
  matching. The README and the reference wrap their prose, and the README's bound
  (`one absorption of exactly the named commit per mail`) crosses a line break, so a raw match could
  never hold there.
- Departure, by slug `conflict-sync-text-hook-escape` (unnumbered): the hook writes the subject word inside a double-quoted bash
  string, as `` \`conflict-sync:\` ``, so the first case unescapes `` \` `` before it looks for the word.
  The printed advisory carries it bare, which `session-hook-sync-advisory.test.ts` holds.
- Departure, by slug `conflict-sync-text-no-diff` (unnumbered): the checks are boolean (`includes`, `match`) with a short message,
  never `toContain` or `toMatch` on the file. Measured: with the README still unchanged, a `toContain`
  miss made vitest diff the flattened README and the run went past ten minutes before it printed. The
  boolean form answers in milliseconds and names the file and the phrase it missed.

## The mutation table, measured

Each row: the file saved, its sha256 recorded, the mutation applied by a script, the predicted suites
run, the file restored from the saved copy and its sha256 checked equal.

| id | File, original sha256 | Red, measured | Restored |
|---|---|---|---|
| 1C-01 | `ccd/worker-skill/SKILL.md`, `0aa5e6e38d01c9b08a6dbea43d712c042590087ede1b83cb4905a9cbb00feb55` | `carries all twenty clauses verbatim` (`missing contract clause: Absorb …`); the new worker case (`SKILL.md clause 16: … to contain 'only on one of four triggers'`); `conflict-sync-text` case 1 (`SKILL.md lacks: \`conflict-sync:\``) and case 2 (`lacks: one absorption of exactly the named commit per mail`). 4 failed, 83 passed | sha matches |
| 1C-02 | same file, same sha | `carries all twenty clauses verbatim`; the new worker case at its third assertion (`… to contain '\`git merge-tree … HEAD <base>\`, exits 1 …'`). 2 failed, 85 passed | sha matches |
| 1C-03 | same file, same sha | the new worker case (`… to contain 'the fourth licenses one absorption …'`); `conflict-sync-text` case 2; and `carries all twenty clauses verbatim`. 3 failed, 84 passed | sha matches |
| 1C-04 | `ccd/session-hook.sh`, `15cdaaff663bcaae4115bf46d8158bbc1b0eff929f33aec6db6275d24cc3323d` | `session-hook-sync-advisory`'s 21 `advises on …` cases (`… to contain '(4) the coordinator'`); `conflict-sync-text` cases 1 and 2. 23 failed, 58 passed; the graph-gate case stays green (it reads `four triggers` only) | sha matches |
| 1C-05 | `README.md`, `bcbb0f81ae983f2aef543d165373fbf2165cb80ffae64bc19cff7561e114fa78` | `conflict-sync-text` case 1 (`README.md lacks: \`conflict-sync:\``). 1 failed, 2 passed | sha matches |

Every predicted red was red. Two rows red more than the table predicts, and both follow from the
mutation itself: 1C-01 removes the bound sentence too, so `conflict-sync-text` case 2 reds; 1C-03 changes
the clause, so the verbatim census reds. Green after each restore: the reader run below.

## The suites that read the changed files

- Touched and readers, one run: `worker-skill`, `session-hook-sync-advisory`, `conflict-sync-text`,
  `install-worker-skill`, `session-hook-mail-hold`, `session-hook-merge-deny`,
  `session-hook-role-skill-deny`, `hook-helpers-generated`, `update-branch-absent`, `skillstate`,
  `install-census` (the `session-hook*` suites `git grep -l "landing advisory" server/test` names are
  `session-hook-mail-hold` and `session-hook-sync-advisory`, both in the list): 11 files, 633 tests, green.
- Guards: `citations`, `anchors`, `docs-parity`, `topology-clean` and `single-definition/` whole: 48 files,
  1747 tests, green.
- `deviation-refs`, after `git fetch origin main`: on the test box it timed out at 20 s in `is looking at
  two real trees, each with a real ledger in it` (33 of 34 passed); alone with `ccrc test --local`, 34 of
  34 green.
- `typecheck-tests`: could not run. On the test box it fails before any test with `Cannot find module
  'typescript'` from `pwa/package.json` (the box's checkout has no pwa dependencies); this worktree has
  no `pwa` or `ui` dependencies either. The server's tests-inclusive typecheck
  (`tsc --noEmit -p test/tsconfig.tests.json`) was tried once instead, alone; the test slice killed it
  for memory, in the wrapper's words: `the test slice's memory cap killed a process during this run
  (MemoryMax=6G, CCRC_TEST_SLICE_MEMORY_MAX; 1 OOM kill(s) in ccrctests.slice); exit 137`. The pull
  request's own run is the arbiter for both.
- No full suite ran.

## The pull request's first run, and what it found

The first push (`e18c4b5516`) ran red in three server shards, for two causes, both this wave's own:

- `dtbd` (`git grep over every tracked file finds none`): the task notes named their departures as
  concrete placeholder tokens, which the guard refuses in any tracked file. The notes now name each
  departure by its bare slug; the coordinator numbers them from the wave-done. `ci-shards`' two `times`
  CLI cases were red only because their nested run includes `dtbd.test.ts`.
- `skill-size-ratchet` (three cases): clause 16's plan text grew `ccd/worker-skill/SKILL.md` by 469 bytes,
  to 36004, past its cap of 35559, and the ratchet lets a SKILL.md grow against main only by the bytes of
  a NEW pinned clause, which this wave does not add. The worker skill may not carry a `references/`
  directory, so the text could not move out. Departure, by slug `worker-skill-size-trim` (unnumbered): the
  clause 2 note under `## Notes on the contract` (it restates clause 2, and the coordinator's dispatch
  reference says the same) is removed, and the clause 5 note is cut to one sentence that keeps its reason.
  No test pinned either. The file is now 35535 bytes, main's size exactly; the caps file is not touched
  (an entry above its file's size is reported, never a failure, as four other skills' entries are on main).

After the fix: `skill-size-ratchet`, `dtbd`, `ci-shards`, `worker-skill`, `conflict-sync-text` and
`install-worker-skill`, 160 tests, green.

The judge's check reads red on `rules-mixed` alone (skill and reference text beside other changes); the
coordinator ruled before the wave that the pull request stays whole, because each pin moves with its text.
