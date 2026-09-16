# Review-run brief — template

The brief a coordinator dispatches to a REVIEW run (design 2026-09-14 §4, §6).
Dispatch prefixes it with the sentence that invokes the `ccrc-reviewer` skill;
the standing protocol lives there and is not repeated here. A brief carries
what only THIS review knows.

```markdown
Review run <review run id> reviews run <work run id> — programme `<slug>`, wave N/M.
Worker branch: `ws/<worker-slug>` (measure its tip ONCE before reading; report that sha).
Ledger: `<ledgerAbsPath>`.
Plan: `<path>`   — or, for a plan in another repository:
  homeRepoRoot: <abs path>   planRepoPath: <repo-relative>   planSha: <40-hex>
Tasks in this wave: <range or list>.
Lenses: <e.g. correctness, seams-and-interfaces, tests-pin-effect-not-shape, docs-match-code>.
Whole-branch pass: <what to hold the branch to as a whole>.
Suites: <exact commands, run in your worktree at the measured tip>.
Carried constraints from earlier waves: <the ledger's list, verbatim>.
Deviations already ledgered this wave: <D-numbers and one line each>.
Report to: an absolute path under YOUR worktree; mail `review-done` with the JSON first line.
```

Do not put the worker's fingerprint, the coordinator's rulings, or any
instruction to send work back in a review brief — the reviewer reports; you rule.
