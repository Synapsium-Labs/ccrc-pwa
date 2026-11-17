# Overlord W1 ccd arms, PR B: notes for the ledger

PR B builds Tasks 4 and 5 of [`w1-ccd-arms.md`](../w1-ccd-arms.md): the launch row's `longLived`, `_role_long_lived`, the
hold-down before a long-lived role's class returns, the `/model` skip, the affinity stand-down on an ordered account list,
and the end of a set-side crossing at a proven fresh start. These notes are what the programme ledger should learn from
it. Each departure carries a plain-words slug (cross-plan ruling X9); none has a D-number.

## In short

- The hold-down, the skip, the stand-down and the crossing end are built as the plan rules, in
  `ccd/lib/long-lived.sh`'s regions `holddown` and `freshpick`, with one-line calls in `ccd/ccd`.
- One behaviour change, for coordinators only: a route carrying `profile=coordinator` keeps its fallback class for an
  hour after its intended class is servable again, and its typed `/model` is not written to its route. While the
  launch-profile lane is shadow no coordinator carries `profile`, so nothing changes.
- Nothing writes `acctorder` or a set side yet, so the stand-down and the crossing end act on no row.

## 1. Growth, measured

Measured with `GROWTH_CHECK=1` `growth-check.test.ts` (`growthCheck.ts`'s own counting), against the merge base
`793d75a5f`.

| File | Net code lines | Plan's estimate |
|---|---|---|
| `ccd/lib/long-lived.sh` | +30 | +23 to +27 |
| `ccd/ccd` | +2 | +4 to +5 |
| `ccd (program)` | +32 | +27 to +32 |

*Table 1. Every row is at 40 or under, with no waiver.*

## 2. Departures, by slug

| Slug | What and why |
|---|---|
| `long-lived-library-is-30-lines` | The two regions are 30 code lines, above the estimate of 23 to 27 but inside the 40-line rows: `_role_long_lived`'s bounded read and the three answers each take a line of their own (slug `profile-read-is-bounded`). |
| `ccd-body-is-plus-2` | `ccd/ccd` grows by 2, not 4 or 5: the settle arm, the `ll` read and the say line are edits of existing lines (+0), and only the stand-down and the crossing call are new lines. |
| `model-skip-after-the-record-check` | The plan puts the skip in the first `model\|drift-model)` arm. It sits in the second case instead, after "the record wins when it is newer": `ll` is read lazily in the first arm, `model)` says the one line and skips, and `drift-model` skips with no line. So a `/model` older than the `class` field says nothing, as today, instead of a line at every keep. The mutant "drop `"$ll" == 1`" still reds the coordinator case. |
| `model-drift-skipped-for-long-lived` | A long-lived role's unacknowledged `/model` is not reported as drift: its `/model` is never adopted, so the drift says nothing it could act on. `/effort` drift is reported as today. |
| `long-lived-fails-safe-on-a-bad-launch-file` | `_role_long_lived` answers 2 (read as long-lived) for an absent, unreadable or non-JSON launch profiles file, a row with no `longLived` key and a key that is not a boolean, as question 5 rules; only an absent `profile` entry, or `longLived: false`, answers 1. |
| `profile-read-is-bounded` | `_role_long_lived` reads the `profile` entry as `_keep_awake_ours` reads a marker, through `_plat_timeout 2 head -c 17`, not `_reg_get_to`, whose read is not time-bounded; a FIFO swapped in after the `-f` test answers 2 within the bound (pinned). |
| `holddown-boundary-at-3600` | The boundary cases add 3,600 s (restores) to the plan's 3,599 and 3,601, so the `<` to `<=` mutant has a case that reds. |
| `holddown-restamp-has-no-route-row` | The settle's re-stamp writes one `holddown-restamp <id>:` line in `swap.log` and no route journal row: it moves the stamp's time, never its value, and the route journal records value changes. |
| `crossing-end-line-is-the-ticks` | `_fresh_crossing_end` writes `crosspool-ended <id>: renewal`, the tick's own line format, so `swap.log`'s readers see one shape. |
| `no-set-side-placement-fixture` | Carried from serviceability A (`pool-set-fixtures-record-continuity`): the crossing-end cases give the row a `poolset`, but nothing in PR B places it or asks `_class_gate`, so no fixture lane needs a continuity record. PR C1's and C2's fixtures will. |
| `launch-row-key-set-test-in-sim` | The six-key row check and a new "every row carries `FLEET_ROLES`'s `longLived`" case live in `server/test/sim/launchProfileSets.ts`, beside sandbox A's cases, so the mutation floor runs them; `launch-profiles-file.test.ts`'s key list gains `longLived`. No digest is pinned as a literal anywhere, so no fixture changed. |

*Table 2. Departures from the plan's text, each the builder's own call within the rulings.*

## 3. Verification

- New suites: `ccd-long-lived.test.ts` (25 cases) and `ccd-route-holddown.test.ts` (15 cases). New cases in
  `ccd-route-degrade`, `ccd-operator-choice`, `ccd-auto-swap-hold` and `ccd-hibernate-roll`, each after a characterization
  commit that is green on the tree before its feature.
- Mutation, one mutant at a time, restored from a saved copy: all 11 of the plan's mutants for Tasks 4 and 5, and one more
  (the settle arm restoring always), turn a case red.
- The plan's suites (`ccd-swap*`, `ccd-auto-swap*`, `ccd-route*`, `ccd-serviceable`, `ccd-pool*`, `ccd-tick-budget` with an
  unchanged count, the hibernate and roll suites, `ccd-keep-awake`, the launch-profile suites), `ccd-lib-load`,
  `ccd-split-pin`, `ccd-contexts`, `growth-check` armed, `single-definition/*`, `rings/*` and `deviation-refs` are green.
- `ccd/contexts-edges.tsv` gains three cross-context edges: `_spawn_start -> _route_holddown_settle` (C2 to C1, beside
  `_spawn_start -> _route_restore`), `_route_holddown_holds -> _role_long_lived` (C1 to C3: long-lived is a fact of the
  session's role) and `cmd_hibernate -> _fresh_crossing_end` (C4 to C1, the pool side's owner).
- Organization A (#2920) holds `ccd/ccd` and `ccd/contexts.tsv` and agreed to this PR co-editing both; its hunks and these
  are apart, so whichever lands second merges `main` once.
- Locally unmeasured, left to CI: the shellcheck ratchet and the tests typecheck (`test/tsconfig.tests.json`) are each
  killed by the local test slice's 6 GB memory cap, as PR A's were. `shellcheck` reports nothing on
  `ccd/lib/long-lived.sh`, and the server typecheck is clean. `sim/mutation-floors`' two `pwa/src/face/mood.ts` rows fail
  here only because this checkout has no `@ccrc/ui` installed; every other row, `launchRowOf`'s included, is green.
