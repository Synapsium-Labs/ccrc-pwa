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
- **D-7729 (2026-11-01)** — Q3l: `no-questions-door` refuses every current, well-formed cap file without
  `questions-v1`, an empty word list included, through one guarded call line that asks the generated reader twice.
  The plan's Files list says the client refuses a current file "that lists words and omits `questions-v1`". The
  generated `_api_server_cap` answers one status for every failure (absent, stale, torn, future, unlisted), so the
  client cannot tell "current and well-formed" from "absent" by asking for `questions-v1` alone. The one guarded line
  (`if [[ -n "$claimant" ]] && _api_server_cap "$want"; then`, inside a two-word loop) asks for `questions-v1` and then
  for the empty word, which the reader answers 0 for any current, well-formed file: its last test looks for
  `" $want "` in the caps line padded with a space at each end, and that padded line always holds two spaces. So a
  current file that lists other words is refused, as the plan says, and so is a current file that lists none.
  `ccd-update-sync` records a server whose `/health` has no `caps` (one older than the caps answer, so older than the
  family) as exactly that empty list, so refusing it is the same fact D-7328 names: the server cannot answer the
  family. The reader stays a byte copy of the hook's (D-7321); `capReaderCalls()` stays one guarded call, zero
  unguarded; the file is read only for the four claimant rows. The pin gains the state "current, lists no words"
  (refused), `ccrc-api.test.ts` a row for it, and the skew suite a row per verb against such a server.
- **D-7730 (2026-11-01)** — Q3l: the Files list amended at build, for the suites the client flip and the alias
  retirement reach that the plan's list does not name. Each edit is a re-point or an inventory row shrinking by exactly
  the routes removed (the W3 plan's exception 3); no assertion is dropped or loosened. `ccrc-api.test.ts`: the four
  claimant rows' paths and the arriving bodies (the kind spliced), and the named rows of Step 5's mutation table ("an
  absent cap file sends the family", "a server that lists words without questions-v1 is refused locally, nothing
  sent"). `claimantClientFixture.ts`: the family's named-difference table moved in from the pin (a move), so the skew
  suite reads it. `question-doors-posture.test.ts`: each retired alias moves to `RETIRED_DOORS` (the gate's posture
  for a route it no longer names) and its `CLAIMANT` posture is held on the family's door. `census-w3/questions.test.ts`:
  the FIXTURE tree's claimant door is the family's `/rule`, the REAL cited door is the family's `/rule`, and the
  by-principal count shrinks one per commit to 4 (2 claimant). `question-doors.test.ts`: the retired-row check reads
  the effects once before its snapshot, so a one-shot store mock a row arms for the door's own read is spent (a
  retired door reads nothing). `single-definition/ask-digest.test.ts` gains "the eight old answer doors are retired:
  none is registered" where its `ALIASES` table emptied, and `question-doors.test.ts` "no pair is left live" where
  `PAIRS` emptied. The route-count prose `box-token-census.test.ts` reads (`auth/gate.ts`, `README.md`, the
  auth-gate title) and `CLAUDE.md`'s approvals-lane list shrink one word per alias.
