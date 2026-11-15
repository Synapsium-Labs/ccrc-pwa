# Task 1 note: the seven landed-pass decisions characterized, then moved to L1

Commits (in order): characterization rows (green on the unchanged lane); the pure move (`landed.ts` steps, lane switches on
returned actions); hardening (advancing-clock assertions, checked `refuseLand` mock, spelled hold words, due-at-once wording,
header value-import description).

## Commands (from `server/`, via `ccrc test --`, `--maxWorkers=2`)
- `vitest run test/landed-decide.test.ts test/landed-lane.test.ts test/landing-land-words.test.ts`: 74 passed, after the
  characterization commit (old lane), after the move, and after the hardening.
- `vitest run test/run-routes.test.ts -t 'mark that throws'`: 1 passed.
- `tsc --noEmit` (production): exit 0.
- `tsc --noEmit -p test/tsconfig.tests.json`: only errors under `../agent/src` (agent dependencies are not installed in
  this worktree); none in a server file or test.

## Mutation rows (each restored from a saved copy, then the selection re-run green)
| Row | Mutant | Selection | Actual failure |
|---|---|---|---|
| M1 | project read refusal returns `skip` instead of `stop` | landed-lane | `a store stop in the first project ends the pass`: expected { read: 1, ... } to match { read: 0, stopped: 'store' } |
| M2 | prune ignores `complete` | landed-lane | `an incomplete inventory retains memory: expected false to be true` |
| M3 | held mark's memory write removed | landed-lane | 3 failed: both `held at the write` rows (memory undefined) and `a mark held at the write is remembered at the pass start` (expected [] length 1) |
| M4 | mark `at` taken from the pass start | landed-lane, advancing clock | `the mark is stamped when it is written...: expected 1794398400000 to be 1794398401000` |
| M5 | `isLandable` ignores the projection | landing-land-words | `expected true to be false` (isLandable row) and the `kept` row of decideLandingLand |
| M6 | third literal in the hold gate union | production tsc | `landed.ts(98,7): TS2741 Property '"landing-hold-third"' is missing in type ... but required in type Record<...>` |
| M7 | `landOnClose`'s catch deleted | run-routes `mark that throws` | `expected 500 to be 200` |

## Departures
- departure: node-modules-install: the worktree had no `server/node_modules`; ran `npm ci` in `server/` (no manifest or
  lockfile change) to be able to run the suites.
- departure: gate-literal: the hold gate's false arm in `landingEntry.ts` now spells its two words literally instead of
  `Extract<LandingMutationCode, ...>`, so a new word cannot be dropped silently (Step 5).

## Findings
No characterization row failed against the old lane; no suspected defect.

## CI fix round
The fast CI reds were the runCcd not-ran census (`landedLane.ts` had no explicit `res.ran === false` after the call) and the
mail-routes kebab-token scan (the `'not-ran'` act word). The lane now narrows `res.ran === false` right after the call (same
retry memory, same `link` stop), `landedCallStep` takes the ran arm only and answers `parse` | `failed`, and the `'not-ran'`
act word is gone. Behaviour unchanged: landed-decide, landed-lane (link-stop rows included) and landing-entry-census 112
passed; `test/single-definition` 1331 passed; production tsc rc 0; the census test passes.
Part 2: the mail-routes kebab-token scan refused 17 wave 5i tokens (no-send, episode-changed, retained-fields, main-red,
opt-in-unknown, projection-unreadable, empty-or-blocked, health-unmeasured, base-mismatch, head-mismatch,
composition-not-clean, run-not-merging, episode-unreadable, recipient-missing, creation-unrecorded, landing-next,
main-health). Each got one `NOT_CODES` entry with a home-and-role comment, in one block after `'missing-field'`; no other row
or source changed. mail-routes 59 passed, consolidation-census 33 passed, single-definition 1331 passed.
