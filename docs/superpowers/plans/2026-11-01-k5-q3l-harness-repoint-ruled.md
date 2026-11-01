# K5 Q3l: the claimant aliases retired, the coordinator's rulings and the build's departures

The plan is `docs/superpowers/plans/2026-10-29-consolidation-k5-claimant-doors.md`, Task Q3l (D-7324, D-7328). Its
Files list was written on 2026-10-29 and measured again at the task's Step 0 on `origin/main` `c49e0e583`. Step 0
found test suites outside that list that call the four old doors directly, and the coordinator ruled how they move
(2026-11-01, option (a)). Each entry below is a departure from the plan's Files list that the build keeps.

## Deviations found

- **D-7728 (2026-11-01)** — Q3l: test harnesses and direct old-door callers re-point to the question door family
  before alias deletion. Ruled by the coordinator, option (a). In ONE behaviour-neutral commit before the first alias
  is deleted, `server/test/approvalsHarness.ts`'s `rule()` and `release()` and the answer and release helpers of
  `server/test/asks-routes.test.ts` call `POST /api/questions/<ask|approval>-<n>/rule|release`, with `kind` spliced
  into the body ahead of the caller's fields. The direct old-door calls in `approvals-routes.test.ts`,
  `feed-writers-pin.test.ts`, `questions-instances.test.ts` and `single-read-bad-id.test.ts` move the same way. The
  `describe` and `it` titles that named an old route name the family route. `single-definition/ask-digest.test.ts`'s
  parent-side region scan (`readAskAnswer` and no respelled index check) reads the family's `POST
  /api/questions/:id/rule` handler, a named exception (the W3 plan's exception 3). Every expectation keeps its value:
  the family door runs the same core (`questions.rule` and `questions.release`) behind the same front ladder (box
  token, body, attribution, id parse by the same canonical parser), and the PR body carries the row-by-row mapping
  table. No assertion is dropped, loosened or skipped. The amended Files list names those seven suites and
  `approvalsHarness.ts`.
