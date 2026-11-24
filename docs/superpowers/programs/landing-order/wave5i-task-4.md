# Task 4 note: terminal repair of unknown rows without repairing authority (Amendment B, D-8626; recovery vocabulary, D-8627)

Implemented in `shared/landingLine.ts` (the failure union), `server/src/coord/landingEntry.ts` (the verdict fold, the two
decisions), `landingWrites.ts` (the `terminalRepairs` fact), `landed.ts` / `landedLane.ts` (the candidate and its
compare-and-set), `advance.ts` (the reject type) and `store.ts` (the one token builder, the land arm, `landingReadProjects`,
`readLanding`). No new file, endpoint, ccd verb, wire op or journal record.

## What it does
- `LandingInfrastructureFailure` is `LandingBoundaryFailure | LandingProjectionFailure`. The projection arm is
  `{error:'landing-projection-unreadable', recovery:'repair'}` and every producer of it says `repair` (the fold's refusal of
  a snapshot, the retreat refusal, the order refusal). The boundary arm keeps `replay | restart`, `mayApply` and `invalid`,
  and types the fence helpers (`landingGuard`, history, replay, the authority write's stop), so `'repair'` cannot enter
  `landingFence`. No HTTP status changed; `advance.ts` distributes the reject type over the two arms.
- `terminalRepairs` (one verdict per open row that does not read): `eligible` with a 64-hex token, or `blocked` with the
  first reason that stands: `identity` (a conflict listed in the project, a blank project, an invalid run id), `quarantine`
  (any marker), `retained-fields` (afterIds, fixesMain, counters, pin time, base, ejection kind unreadable; a value of a kind
  SQLite does not return; no token), `binding` (its own recovery subject listed, or the run cannot be read). Only pin sha,
  handoff, setter or the state word may be what does not read. Terminal-word rows and rows that read have no verdict. It is
  never used as readability: `projections` and `dependencies` are untouched.
- Token: `CoordStore.terminalRepairTokens`, the one builder; `["string"|"bigint"|"number"|"null"|"absent"|"bytes", …]` tags,
  a BLOB as every byte in lowercase hex. The land arm reads facts in its own transaction, so the verdict it decides on is the
  recomputed one: another token is `moved`, an ineligible repair is `kept`, a normal candidate or the close never gets the
  permission. Hold gate (own subject, identity conflict) answers before the token is looked at.
- The reader carries `repairToken` from the candidate into `expect` (`landedExpectOf`); cap 10, backoff and the single
  sweep are unchanged. Open, unmeasured and failed answers never reach the arm.
- Equal-head retreat: an owned, pinned entry that does not read is refused (`repair`) before the head is compared; the
  stale-head quarantine and the ordinary ejection are otherwise as before. A closed row re-pins only over a readable,
  unquarantined projection (the pin decider's closed branch); pinned and ejected rows re-pin as before.
- `landingReadProjects`: sorted union of projects with a non-terminal row (any unrecognised state included), projects any
  journal subject names, and projects with a persisted main-red hold. `readLanding` inside a caller's transaction runs the
  inner read outside the catch that owns the rollback proof.

## Red, then green (from `server/`, via `ccrc test --`, `--maxWorkers=2`)
- Step 4 group 1 red (`landing-journal-store`, `landing-entry-store`, `landing-advance-route`): 12 failed | 125 passed (137).
  The failures: both stale-head retreat rows (`recovery` expected `repair`), the four equal-head HTTP rows
  (`AssertionError` carrying the 200 success body), the decideLandingWrite rows, the ambient read
  (`expected [Function] to throw error including 'fixture select fault' but got 'database is not open'`) and the order
  refusal pin (`recovery` `repair`).
- Step 4 group 2 red: the first attempt waited 451 s for a test slot and `timeout 600s` ended it mid-run (rc=124): in the
  part that ran, `landing-land-words` 7 failed and `landed-decide` 3 failed. The two long files were re-run red on their
  own (`landing-land-store`, `landed-lane`): 51 failed | 55 passed (106), almost all `TypeError`/`undefined` reads of
  `terminalRepairs` and `expected … to deeply equal` for the missing verdicts. The source patch landed about 40 s after
  those workers started, after their modules were loaded.
- Green after implementation: group 1: 3 files, 137 passed. Group 2: 4 files, 163 passed (re-run after a fixture fix: the
  `dump` helper now reads bigints). `test/single-definition --maxWorkers=2`: 32 files, 1331 passed.
  `landed-decide landed-lane landing-control landing-line-order`: 4 files, 169 passed. Production
  `tsc --noEmit; echo rc=$?`: rc=0. Extra, because tests were touched: `landing-writes`, `landing-writes-route`,
  `landing-facts-scope`, `landing-entry-census`, `refusal-status`: 5 files, 152 passed.
- `GROWTH_CHECK=1 growth-check`: `server/src/coord/store.ts` delta +35 net code lines against the merge-base (limit 40;
  the first form of the builder measured +45 and was folded into expressions in a second commit). The one remaining red
  there, `the armed path, end to end`, was a 20 s test timeout under load; re-run alone it passes (73 of 73).

## Mutation rows (each restored from a saved copy, the selection re-run green)
| Row | Mutant | Selection | Actual failure |
|---|---|---|---|
| M16 | equal-head projection check removed (refuse only at a stale head) | advance-route `-t equal-head`: 4 failed | `expect(res.statusCode).toBe(503)` with the 200 success body (the run moved to `working`) in all four rows |
| M17 marker | quarantine exclusion removed | land-store `the exclusions`: 3 failed | `expected { kind: 'eligible', …(1) } to deeply equal { kind: 'blocked', …(1) }` (reason `quarantine`) for the stale-head and other-marker rows |
| M17 binding | binding exclusion removed | same: 3 failed | `expected { kind: 'eligible', …(1) } to deeply equal { kind: 'blocked', reason: 'binding' }` (the unreadable run, the disagreeing binding) |
| M17 token | token comparison removed | land-store `the token\|BLOB`: 4 failed | `expected { ok: true, landing: { …(2) } } to deeply equal { Object (ok, landing) }`: `kind: 'landed'` received where `moved` was expected |
| M18 | ambient read caught inside `readLanding` | journal-store `ambient`: 1 failed | `expected [Function] to throw error including 'fixture select fault' but got 'database is not open'` |
| M25 | closed-row readability gate removed | land-store `terminal to pin`: 2 failed | `expected { ok: true, …(3) } to match object { ok: true, to: 'merging', …(1) }`: `kind: 'pinned'` received where `kept`/`closed` was expected |
| M26 | bytes tagged as a string | land-store `BLOB`: 1 failed | `expected 2 to be 3 // Object.is equality` (bytes `00ff`, text `00ff`, text `0,255` collapse) |
| M26 | display coercion `String(v)` for bytes | same: 1 failed | `expected 2 to be 3 // Object.is equality` |
| M26 | bytes omitted from the tag | same: 1 failed | one-byte drift answered `landed` instead of `moved` |
M17, M18 and M25 ran on the first form of the builder; M26 was run again on the folded form with the same result.

## Departures
- departure: subjects-whole-union: `landingReadProjects` lists every project any journal subject names, not only the ones
  with an unresolved subject: SQL cannot tell resolved from unresolved, and an extra read costs no ccd call.
- departure: tests-beyond-the-list: `landing-facts-scope` (the pinned fact literals gain `terminalRepairs: []`),
  `landing-control` and `landing-writes` (their fact builders), `landing-writes-route` and the stale-head rows
  (`recovery` `repair`) were edited for the new vocabulary and fact.
- departure: no-verdict-for-terminal-rows: a row whose state word is already terminal has no verdict, damaged or not.

## Limitations
- A blocked row stays a visible hold (`recovery:'repair'`, or the project's recovery hold): nothing here repairs a missing
  projection, a corrupt identity, an unreadable counter or a lost association, and no manual repair endpoint exists.
- `typecheck-tests.test.ts` is killed by the test slice's 6 GiB cap on this box (5 OOM kills; the spawned `tsc` returns
  -1), so its three rows are environmental here. The server tests project (`tsc -p test/tsconfig.tests.json --noEmit`
  through `ccrc test --`) completed once and found one error, in this task's `it.each` table (fixed, `as [string, string,
  unknown[]][]`); its re-runs were then killed by the same cap (rc=137), so the fix is not re-measured by `tsc`.
