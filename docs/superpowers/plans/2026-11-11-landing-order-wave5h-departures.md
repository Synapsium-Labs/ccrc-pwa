# Landing order wave 5h: six departures from its plan, recorded

The plan, `2026-11-11-landing-order-wave5h-landed-reader.md`, defines D-8294 to D-8314. Wave 5h shipped in #2688 (merged
2026-11-12 as `58bd5591`). Its worker named departures by slug, and its three reviews (1840, 1846 and 1848) added to
them. The coordinator allocated D-8355 to D-8360 on 2026-11-12 at 06:15 UTC, at acceptance, and defines them here. One
of the worker's slugs was resolved in fix round 1 and takes no number: `landed-held-mark-retried-every-sweep`. Fix round
1 moved the hold decision into L1 (its R1), so a held entry costs no read and is due once its hold clears.

None of the six gives a wrong answer on the line: each is a cosmetic difference, a diagnostic cost, a decision left in
L4, or a test or comment weaker than it could be.

- **D-8355 (2026-11-12)** — `landed-record-title-no-project-suffix` (Task 4; review 1840 F8): the reader's `merged` feed
  record goes straight through the notice sink, so its title lacks the ` · <project>` suffix that `pushOne` adds when
  more than one project is active. The tag and the once-only key are the same, so the push still replaces and
  `hasNotice` is unaffected. Cosmetic.
- **D-8356 (2026-11-12)** — `sweep-failure-detail-masks-long-ids` (Task 6, fix round 1's R5; review 1846 F5): the
  sweep-failure line's first and last stderr lines go through `server/src/coord/redact.ts#redactCommand`, the egress
  profile `fleet.ts` uses, before the 160-character cut. That profile masks any `/`-separated run of 32 or more base64
  or hex characters that holds a digit and a letter, so a full commit sha, a 64-character digest or a UUID in a failed
  call's stderr reads `[REDACTED]`. Short shas, PR numbers and exit codes survive. Before 5h the stderr lines were not
  masked at all. The redactor runs over the whole line before the cut, and stderr is bounded only by the call's output
  cap.
- **D-8357 (2026-11-12)** — `landed-lane-l4-read-outcome-choice` (Task 4; review 1846's answer 4, review 1848 F5):
  `landedPass`, an L4 lane, still makes these choices itself rather than asking L1:
  - a `landingReadProjects` refusal stops the pass;
  - a `readLanding` refusal skips the project for `landing-projection-unreadable` and stops the pass for any other
    refusal;
  - memory is pruned only on a complete pass;
  - a refused mark is mapped: `landing-db-apply` or `landing-db-commit` to the fence warning, a hold word to `held`,
    anything else to a store stop;
  - a call that did not run becomes a `retry` memory without `landedAnswerOf`, and one that ran but failed becomes
    `call-failed` before L1 sees it;
  - a missing field warns at the second in a row;
  - a failed notice only warns, and never stops the pass.

  They predate the review rounds, and the plan prescribes most of them, so they are carried to 5i: an L1
  `landedReadStopOf`, and the rest beside it, would leave the lane only acting. `landedLane.ts`'s header names the
  second, third and fourth.
- **D-8358 (2026-11-12)** — `census-text-checks-are-bounded` (Tasks 2, 4 and 5; the worker's `census-lane-window-weak`,
  review 1848 F1 and F8): `landing-entry-census.test.ts` checks the three `advanceLanding` callers by text. Three of
  those checks are bounded:
  - the lane's check reads a fixed 400-character window from the call's start, which can only false-red on a
    reformatting;
  - the `advanceAct` negative check carries the same 400-character window, so a `kind: 'land'` moved past it would
    false-green;
  - the close's check pins the argument's name, `advanceLanding(land)`, and that `closeLandingOf(` appears, but not that
    `land` is the value bound from it. A rebinding with a cast stays green.

  `close.ts`'s `let mark: LandingLandResult` makes a run-arm call a type error too, so the realistic mutation fails
  twice.
- **D-8359 (2026-11-12)** — `landed-test-pins-loose` (reviews 1840 F7, 1846 F8, 1848 F2, F3 and F7; the plan's mutation
  table): four pins are looser than their rows, and one row moved:
  - 5H-LAND-11 (`isLandable` ignores the projection) cannot show red as the plan predicts: a quarantined row is state
    `unknown`, which `isLandable` refuses on state alone, so the guard is caught by another case;
  - the advancing-clock held-at-write case ("a mark held at the write is remembered at the pass start") mocks
    `advanceLanding` with an `as never` cast, which switches off the check of the mock's return;
  - the advancing-clock case asserts the mark's `detail.at` is later than the pass start, not that it equals the write's
    call;
  - 5H-HELD-WORD goes red only for a word that `LandingMutationCode` names: `Extract` drops any other word without a
    type error;
  - 5H-CLOSE-4 was redefined in fix round 1, from the plan's "a refused mark throws out of the close" (red: the fenced
    case is not 200) to removing `landOnClose`'s catch around the mark (red: "a mark that throws" is not 200). The PR
    body's table carries the rows as measured, and the plan's table stays as written.
- **D-8360 (2026-11-12)** — `landed-doc-wording` (Task 4; review 1848 F4 and F6): two comments overstate:
  - `landed.ts#landedCandidatesOf` and `landedLane.ts`'s header say a held entry "is read at once when the hold clears".
    It is due at once and sorts with the never-read entries, but it still competes for the sweep's ten reads, so "due at
    once" is exact;
  - `landed.ts`'s header says its value imports are "L0, the lane table and two L1 rules", which counts the lane table
    twice.

  The next edit to either file corrects them.
