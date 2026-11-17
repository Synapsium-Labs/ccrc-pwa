# Account organization, PR C: the builder's notes

**Run** 2315 (programme `overlord`, #2491) · **Plan** `docs/superpowers/plans/2026-11-16-account-organization.md`
(#2909), Tasks C1 and C2 · **Builds on** PR A (#2920)

These notes are for the coordinator's ledger. They name departures by slug. No D-number is used or invented.

## In short

A rescue now breaks a load tie toward the session's own organization. `_swap_target`'s candidate loop ranks by
`(score, not-same-org, roster position)` in both brackets. An equal-scored candidate that relates `same` to the
current account (`_org_rel`, as PR A shipped it) replaces an equal best that does not. Organization never beats a lower
score, a bracket or a gate, and the stay rules and the return home are unchanged. An unlabelled current account
relates `unknown` to every candidate, so its pick is exactly today's. The swap record carries `meas.org` and, when the
decision saw one, `meas.orgnear`. `cmd_swap`'s header says that the transcript file carries but that some models'
thinking inside it is bound to an organization.

## What was built

| Task | What | Where |
|---|---|---|
| C1 | `_org_cur`, `_org_tie`: the tie-break, reading the current account's label once, at the first tie | `ccd/ccd`, before `_swap_target` |
| C1 | The loop's comparison in both brackets | `_swap_target` |
| C1 | `_org_note`, `_org_near_say`: the near miss, measured only when asked (`CCD_ORGNEAR_ASK`) | `ccd/ccd` |
| C1 | `_orgnear_cut`, the rescue sites asking, and the dispatch carrying `CCD_SWAP_ORGNEAR` | `_auto_swap_check`, `_watchdog_one`, `_dispatch_swap` |
| C1 | `meas.org` and `meas.orgnear` on the `swap` record | `cmd_swap` |
| C1 | Five C1 rows | `ccd/contexts.tsv` |
| C1 | `org` and `orgnear` declared as `LifecycleMeas` keys, and read by `reviveMeas` (fix round 1) | `shared/api.ts`, `server/src/coord/journalparse.ts` |
| C1 | The placement parity fixture runs every row labelled (`LEAST_LOADED_ORGS`) | `server/test/fixtures/leastLoaded.ts`, `projected-home.test.ts` |
| C2 | The header | `cmd_swap` |

## Departures, by slug

- `orgnear-rides-a-second-line`: the plan puts `meas.orgnear` on the rescue's record, but `_swap_target` runs inside
  two command substitutions (`_rescue_target`, then the callers), so a variable set there is lost, and the exit code
  already carries the rc vocabulary. The near miss comes back as a second stdout line, `orgnear=<n>`, only when the
  caller asks (`CCD_ORGNEAR_ASK`). Only the rescue sites ask: `_auto_swap_check` on a hard block, and the limit
  watchdog. Each cuts the line off at once (`_orgnear_cut`). Every other caller, and every test that reads
  `_swap_target`'s stdout, still reads one line. It then rides `_dispatch_swap`'s env into the unit beside the
  decision's other values (D-5240's pattern), and `cmd_swap` writes it.
- `org-on-every-swap-record`: `meas.org` is written on every `swap` record, not only a rescue's. The landing's
  relation to the account it left is a fact of every move, and the one writer keeps it apart from `orgnear`, which
  only a rescue's decision can carry.
- `orgnear-absent-when-none`: the plan says `meas.orgnear` is "empty when there was none". `_lc_emit`, the one
  writer, drops an empty value, so a move with no near miss carries no `orgnear` key at all. Absent means none.
- `orgnear-omitted-from-dispatch-when-none`: a rescue with no near miss passes no tenth argument to `_dispatch_swap`,
  so every dispatch on an unlabelled fleet composes exactly the arguments it did on `main`
  (`ccd-limit-watchdog.test.ts` pins them).
- `org-tie-read-costs-one-fork`: the current account's label is read with one `$(_acct_org …)`, once per
  `_swap_target` call, and only at the first equal score in a bracket (or, on a rescue, at the first scored candidate).
  The two leaving fixtures of `ccd-tick-budget.test.ts` tie two lanes at 30, so their steady tick rises one fork, no
  exec: leaving 113/43 -> 114/43, fable-leaving 121/47 -> 122/47. No other fixture moves. A fork-free read would need
  the generated `accounts.sh` to carry the labels as data, which is PR A's file and was not worth one fork on a
  must-leave tick. The file's holder (ccd arms B) released it first.
- `placement-labels-in-the-fixture`: §3 says PR C gives the shared least-loaded fixture rows labels. They are one
  fixture-level map, `LEAST_LOADED_ORGS`, that the projected-home runner applies to every row in both rosters, rather
  than a field on each of the 57 rows. `gpt` is left unlabelled. `ccd-default-pool.test.ts`, the fixture's other
  reader, does not apply them.

## Tests and mutation

`ccd-swap-target-org.test.ts` (new, 27 cases) covers every case in Task C1's list, plus the near miss, the
dispatch's carry, and the record. CONTROL: `ccd-swap-target-class.test.ts` is green and unchanged, and the new
file's CONTROL describe runs with no labels and with an older `accounts.sh` that has no `_ccrc_org`.

Also green: `projected-home` (labelled), `ccd-contexts`, `ccd-split-pin`, `ccd-limit-no-keys`, `ccd-tick-budget`
(two rows raised, above), `ccd-crosspool`, `ccd-rescue-policy`, `ccd-rescue-unknown-rank`, `ccd-limit-watchdog`,
`ccd-wake-ceiling-move`, `ccd-rescue-classwindow-drop`, `ccd-tick-diet-seams`, `ccd-tick-diet-equivalence-static`,
`ccd-swap-guards`, `ccd-auto-swap-pool`, `ccd-limits`, `ccd-authdead`, `ccd-default-pool`, the `ccd-pool-a3` pair,
`ccd-affinity-stagger`, `ccd-swap-pin`, `ccd-standdown-notes`, `ccd-login-screen`, `ccd-limit-banner`,
`ccd-auto-swap-hold`, `ccd-account-ok`, `ccd-swap-refuse`, `ccd-session-pool-side`, `ccd-pool-answer`,
`single-definition/*`, `rings/*`, `sim/mutation-floors`, `growth-check` armed, `anchors`, `citations`,
`ccd-line-citations`, `deviation-refs`, and the server type check.

`mutation-run.py` mutates Python modules only, so the mutants were applied by a script to a saved copy of `ccd/ccd`,
each run against the new test file, and the file was restored and compared byte for byte. All 13 were killed:

| Mutant | Killed by |
|---|---|
| organization compared before score (the plan's) | a lower `other` beats a higher `same` |
| prefer `other` (the plan's) | the equal-score tie |
| `unknown` treated as `same` (the plan's) | an unlabelled candidate never wins over `same` |
| the tie broken in the home-able bracket only (the plan's) | the overflow bracket's tie |
| the near miss printed for a sentinel 999 | every near-miss-free answer |
| the near miss for any winner not `same` | an unlabelled winner is no near miss |
| a non-`same` loser noted | an unlabelled loser is no near miss |
| the highest `same` loser kept, not the lowest | several `same` losers |
| the rescue not asking | the tick's dispatch |
| the line not cut off | the tick's dispatch |
| the dispatch dropping `ORGNEAR` | the dispatch carries `CCD_SWAP_ORGNEAR` |
| the record dropping `meas.org` | the record cases |
| the record dropping `meas.orgnear` | the record with a near miss |

One redundant check went with the mutation pass: `_org_near_say` re-asked `CCD_ORGNEAR_ASK`, but an unasked call never
lowers the bracket's minimum from 999, so the check could not change an answer.

## Fix round 1: the two keys the server's reader did not know

The PR's first full CI run was red on one test, `ccd-lifecycle-contain.test.ts`: `meas.org` and `meas.orgnear` were
not on `LIFECYCLE_MEAS_KEYS`, the one list of keys the server's reader takes (`reviveMeas`). The reader drops any other
key at ingest, so the swap record's two keys would have reached only the raw line. The plan names no server file, and
the PR's local gate did not run that suite. Both keys are now declared on `LifecycleMeas` (`string | null`, the way
`_lc_emit` writes them) and read by `reviveMeas`, and the scan's measured count rises from 40 to 42. The
`shared/api.ts` edit is a co-edit its holder granted (desktop polish C39). The scan's fail was measured red before the
declaration and green after it, with `lifecycle-wire`, `journalparse`, the type checks, `single-definition/*`,
`rings/*`, `growth-check` armed and `deviation-refs`.

## Growth

`ccd/ccd` grows by 24 net code lines against the merge base, within the limit of 40, with no waiver. `shared/api.ts`
grows by 4 net code lines in fix round 1 (two members, two map keys). `growth-check`
runs green armed.

## Environment notes

- The fleet test slice's shared memory cap (6G) OOM-killed `shellcheck` on `ccd/ccrc` inside
  `shellcheck-ratchet.test.ts`, a file this PR does not touch. Measured by hand instead: `ccd/ccd` gives the same 32
  findings with the same codes before and after this change, so its pin holds.
