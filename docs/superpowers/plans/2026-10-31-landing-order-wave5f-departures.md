# Landing order wave 5f: nine departures from its plan, recorded

The plan itself defines D-7652 to D-7663. These nine were found while the wave was built, reviewed and fixed (reviews
1413 and 1425). The coordinator allocated them on 2026-11-04 08:08 UTC, at acceptance, and defines them here in the
same act.

- **D-7941 (2026-11-04)** — `unreadable-pin-retreat` (Task 3): a stale-head retreat over a pinned row whose
  projection is unreadable is refused with `landing-projection-unreadable` before the run moves.
- **D-7942 (2026-11-04)** — `skill-step6-refused-retreat` (Task 4, not fixed): the coordinator skill's step 6 still
  says to report "with the run at `working`" when an advance records no base, but a refused or uncertain retreat can
  leave the run at `merging`.
- **D-7943 (2026-11-04)** — `store-growth`: `store.ts` grows 196 code lines and `routes.ts` 26 against the merge base,
  accepted under the existing new-file rule with no waiver.
- **D-7944 (2026-11-04)** — `claim-boundary-miss` (Tasks 1b and 1c): two edits came before their claim or consent.
- **D-7945 (2026-11-04)** — `gate-list-not-selection`: the wave's gate ran the plan's file list, not the PR's
  selection, so three guards outside it went red on the first fast run.
- **D-7946 (2026-11-04)** — `baseline-moved`: the migration slot is 39, not the plan's provisional 36, and the
  route and lane counts were taken from the source on the current base, not from the plan's older figures.
- **D-7947 (2026-11-04)** — `tests-after-implementation` (Tasks 1b and 1c): parts of these tasks wrote their tests
  after the code, not red-first.
- **D-7948 (2026-11-04)** — `readme-consent-no-holder` (fix round 1): the round was told to take consent for its
  `README.md` hunk from the file's holder, but no claim on the file stood, so the worker claimed it itself.
- **D-7949 (2026-11-04)** — `implementation-choices` (Tasks 2 and 3): four smaller choices the plan did not name.

**D-7941.** The coordinator ruled ask 299 from plan §6a and §6: refuse the retreat rather than rewrite an unreadable
row. The refusal is definite and comes before any run, event, episode, projection or counter effect. It sets no fence
and no `mayApply`, uses a code from the plan's §4 vocabulary, and goes red under mutation row T3-REFUSE-UNREADABLE.
Review 1413 confirmed all four limits. An equal-head retreat over the same unreadable row still ejects it. That is
5e's own retreat ejection and lies outside this departure; it is carried to 5i in the ledger.

**D-7942.** Step 6's action, to report to the operator and send no mail, is already right; only its wording about
the run's state is wrong for this case. The plan fixes Task 4's skill text as exact copy, so the wording is carried
to the next wave that edits the coordinator skill.

**D-7943.** The growth check waives an over-limit row when the diff adds a file under `server/src/coord/` or
`shared/`, and this wave adds four. `growthCheck.ts` is unchanged. `store.ts` was +200 at review 1413. Fix round 1's
A2 change removed the facts threading, which brought it to +196. The armed growth-check is green at the final tip
(49/49), measured by the worker and by review 1425.

**D-7944.** In Task 1b a subagent edited `landing-line-migration.test.ts` before the worker claimed it; the claim
(3347) was taken before the commit. In Task 1c the `store.ts` alias hunk and the `landingJournalPolicy` import came
before consent 14441, which covers that file going forward and not retroactively. No other programme's work was
touched.

**D-7945.** `run-session-census` (ARCH-62), `notify-push` (ARCH-59) and `delegation-watch` (R24) read files the wave
changes, and the plan's gate did not list them. All three were fixed in `89579e774`: a `NOT_BINDING_SITES` entry with its reason, the
act's port field renamed to `notice`, and the R24 anchor moved. From fix round 1 on, the gate also reads the PR's fast-run
selection on the exact tip and runs any selected file it lacked. Wave 5e's D-7632 was the same shape.

**D-7946.** The plan's source-derived baseline was measured when `main` ended at migration 35. Its own rule is to
append the actual next slot and report it, and `main` had reached 38 by execution, so this wave's migration is 39.
The census moved in the same way: on the current base, the machine lanes go from 58 to 60, the box-token
coordination routes from 34 to 36, all routes from 167 to 169, and the closed-client rows from 55 to 57. Each count is
read from the source, and its census test is green.

**D-7947.** Every guard the late tests cover is still proven by a measured mutation row that goes red when the guard
is deleted. At fix round 1's final tip, 185 rows were measured: 181 are killed, 2 survive and 2 are red on another
test. The survivors are 5F-WRITES-22, which is killed by two other tests, and C-QUARANTINE-BROAD, which is
equivalent.

**D-7948.** The claim is 3395. Two other programmes later edited the same file under consent from the coordinator,
each in hunks disjoint from this wave's.

**D-7949.** The four choices are these:
- Task 2 parses the request body before attribution, outside the mutex, through a new `landingCommandOf` helper.
- Task 3 counts a retreat at the ejection ceiling as an ejection, with the count clamped at `MAX_SAFE_INTEGER`.
- `LandingWrite` moved to `shared/landingLine.ts`, and `landingEntry.ts` keeps a type-only re-export.
- One comment line in `collect-lane-l0` that names a D-number is slightly stale and was left as it is.

The plan is not edited, because merged plans are append-only. This file is the record, and the programme ledger folds
it in.
