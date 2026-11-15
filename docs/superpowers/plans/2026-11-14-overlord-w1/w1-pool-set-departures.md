# The Overlord W1 pool set: departures and measurements, recorded

This note belongs to `w1-pool-set.md`. Each task of that plan adds a section for what it measured and where it left
the plan's text. A departure is named by a slug, here and in the pull request; no D-number is invented.

## Task 1: the set in L0, its spelling, and the fixture rows (PR A1)

### Characterization (Step 1), green before any edit

| Suite | Tests passed |
|---|---|
| `server/test/pool-rule-core.test.ts` | 45 |
| `server/test/ccd-pool-ok.test.ts` | 47 |

### After the task

| Suite | Result |
|---|---|
| `pool-rule-core.test.ts` | 87 passed |
| `pool-set-spelling.test.ts` (new) | 59 passed, 1 todo (the bash arm, Task 2) |
| `pools.test.ts` | 34 passed |
| `projected-home.test.ts` | 63 passed |
| `ccd-pool-ok.test.ts` | 48 passed (47 plus one test pinning its bounded skip of the set rows) |
| `sim/mutation-floors.test.ts` | 68 passed |
| `rings/shared-imports.test.ts`, `rings/totality.test.ts` | 6 and 11 passed |
| `server` tsc, `server` tests tsc, `pwa` tsc | clean |

The table now holds 20 project rows (all unchanged) and 27 set rows. The derived equivalence rows (a `tagged n` row
driven again with the set `{n}+untagged`) are generated in `pool-rule-core.test.ts` and in the `poolRule` mutation suite.

### Mutation floors (Step 6)

Registered in `server/test/sim/poolSetSets.ts` (`POOL_SET_MUTANT_SETS`), suite cases written once there and also run
against the real module by `pool-rule-core.test.ts` and `pool-set-spelling.test.ts`.

| Decider | Mutants | Killed | Floor set |
|---|---|---|---|
| `shared/poolrule.ts#poolRule` | 15 | 15 | 1 |
| `shared/poolset.ts#poolSetSpelling` | 10 | 10 | 1 |
| `shared/poolset.ts#parsePoolSet` | 10 | 10 | 1 |

Mutants named in the plan are among them: an untagged account serving a set that does not admit it (R1), `set-unreadable`
serving like an untagged project (R2), dropping the ascending check (P1) and the byte cap (P4). Two candidate mutants
were removed as equivalent, not as survivors: reading the suffix with `includes` instead of `endsWith` (the head slice
then fails the name pattern, so the answer is the same), and the "empty head without the suffix" branch of `parsePoolSet`,
which was unreachable and is now simply the suffix-only answer.

### By-hand mutations (Step 6), each restored from a saved copy

| Mutation of `shared/poolrule.ts` | Result |
|---|---|
| An untagged account serves a set that does not admit it (`return set.untagged` becomes `return true`) | red: 3 tests failed in `pool-rule-core.test.ts` (84 passed) |
| `set-unreadable` falls back to an untagged project (serves) | red: 6 tests failed in `pool-rule-core.test.ts` (81 passed) |
| Restored, byte-identical to the saved copy | green: 87 passed |

### Departures

- **`poolrule-imports-the-spelling`.** The plan said `shared/poolrule.ts` "imports the `PoolSet` type only". It also
  value-imports `poolSetSpelling` from `./poolset.js`, because the set mismatch arm carries `set` as the set's one
  spelling, and a second spelling inside the rule would be a second writer. `poolset.ts` imports only `POOL_NAME_RE`
  from `./roster.js` (a sibling import the rings suite allows; `roster.ts` imports neither file, so no cycle). The header
  of `poolrule.ts` and the import test in `pool-rule-core.test.ts` now say and pin exactly that one value import.
- **`pool-rule-overloads-keep-project-callers`.** `poolRule` has two overload signatures: a project side returns
  `ProjectPoolVerdict` (the arms a project side can produce), a `SessionPoolSide` returns the widened `PoolVerdict`. Every
  existing caller compiles unchanged and keeps narrowing on `v.accountPool`. `server/src/poolrule.ts`'s `RosterVerdict`
  is built from `ProjectPoolVerdict`; its single value import line, which `pools.test.ts` pins, is untouched.
- **`fixture-table-is-a-union`.** `PoolRuleCase` is a discriminated union of project rows (`project`, `set?: undefined`)
  and set rows (`set`, `project?: undefined`), so a driver that reads `c.project` without narrowing does not compile. The
  set rows live in the one `POOL_RULE_CASES`; `isSetCase`, `POOL_RULE_PROJECT_CASES`, `POOL_RULE_SET_CASES` and
  `wireFor` are exported beside it. The bash driver and the server mirror's driver skip the set rows, each skip pinned
  (non-empty, exactly the rows that carry a `set`).
- **`parse-pool-set-has-no-ascii-loop`.** The brief asked `parsePoolSet` to reject any character above 0x7f first. The
  name pattern already refuses every such character, so the loop was dead code that no mutant could reach. It is not
  written; the header says why a string the grammar accepts has as many bytes as characters, so the cap is read off
  `length`.
- **`tests-written-with-the-code`.** Step 3 asks for the new tests to run red before the code. The set arm, the spelling
  module and the tests were written in one pass and first run together; the red evidence is the mutation work above (the
  suites kill every mutant, and two by-hand mutations turn them red) rather than a red run against an absent module.

## Task 2: the library, and the route fields `poolset` and `acctorder` (PR A1)

### Step 0: the fourth library, loaded and pinned like the other three

`ccd/lib/pool-set.sh` is wired at every site the third library's pull request (#2256) touched: `_ccd_lib_load`'s two
arrays, the `__CCD_LIB_POOLSET_SHA256=stamp-at-install` pin and the source-checkout test in `ccd/ccd`; the pin's render,
the staging (slot `.3`, so `STAGE_RE` admits it) and the rename right after the third library in
`ccd/ccd-entry-install.py`; `ccd/ccd-entry.py`'s header; `ccd/ccrc`'s update backup (`ccd-lib-pool-set.sh`) and uninstall
list; `deploy/deploy.sh`'s backup; and in the tests `ccdWsHelpers.ts` (`CCD_LIBS`, `installedCcdBody`),
`consolidationCensus.ts`, `installTreeFixture.ts`, `ownership`, `session-hook`'s `SCANNED`, `tmux-socket-census`,
`ccd-lib-load`, `ccd-entry-install`, `ccd-install-stamp`, `build-release`, `install-census`, `ccrc-uninstall`, and the
agent's `ccd-entry-exec` and `deploy-verify`. `single-definition/writers-map.test.ts` needed no row (the library writes
no fact), and `ccd-ws-add-child.test.ts` none (the library spells no run-id bound).

Measured red without it: with `"$dir/lib/pool-set.sh"` and its pin taken out of the loader's arrays, `ccd-lib-load`
went 12 failed and 57 passed; restored from a saved copy, 69 passed.

### Steps 1 to 5: the two route fields

| Suite | Result |
|---|---|
| `ccd-route-fields.test.ts` | green, with the fourteen-field record and the pool set's four new cases |
| `ccd-route-argv.test.ts` | 34 passed, with the argv refusals on `ws-add`, `start` and `enable` and the parity census at six argv-only lines |
| `pool-set-spelling.test.ts` | 62 passed: its bash arm drives `_poolset_parse` over every row but the one NUL row (argv cannot carry a NUL; the skip is pinned) |
| `pool-set-route-wire.test.ts` (new) | 3 passed: lane-only at every door parse, `CCD_ARGV.routeSet` composes both last, the registry reads both |
| `route-fields-parse`, `launch-profile-route-wire`, `single-definition/update-stall` | green, their counts moved from 10 to 12 fields |

No `Record<RouteField, …>` outside `route-fields-parse.test.ts` needed a row: the compiler named none.

| Mutation (Step 5), each restored from a saved copy | Result |
|---|---|
| `_poolset_parse` without its ascending-order test | red: `pool-set-spelling.test.ts` 1 failed, 61 passed |
| `_route_argv_check` refusing `acctorder` only, not `poolset` | red: `ccd-route-argv.test.ts` 3 failed, 31 passed |

### Departures

- **`acctorder-id-is-the-fleet-wrapper-shape`.** `_acctorder_valid` checks each id against `^[A-Za-z0-9._-]{1,64}$`,
  `shared/roster.ts#ACCOUNT_ID_RE`, the fleet-side wrapper shape `_acct_pool_state` already reads, since this box's own
  roster grammar is narrower than the ids the fleet carries. Shape only, as open question 9 rules.
- **`route-argv-refusal-is-argv-only`.** The refusal of both fields in `_route_argv_check` is a line `cmd_route` does not
  share (it is the set's one writer), so `ccd-route-argv.test.ts`'s census of argv-only lines grows from five to six,
  with an assertion that `cmd_route` makes no such refusal.
