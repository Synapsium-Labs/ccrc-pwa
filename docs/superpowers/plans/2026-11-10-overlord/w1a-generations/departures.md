# Overlord W1a, generations: departures from the plan

Each departure from `w1a-generations.md` is named by a slug. No D-number is taken here: the coordinator folds these into
the programme's ledger. The plan's own decisions (its "Deviations found" list) stand unless a slug below changes one.

## The table and its store (Task 1)

- **walk-column-per-walk** (review 1902 F1, the coordinator's ruling) — the column a write moves is decided per walk,
  not per pass. A `walk` column records the mode a walk began in (`live` or `shadow`), set by the mint or by the first
  step out of `active` or `degraded`, and cleared when the walk ends (`active`, `degraded`, `ended`). A live walk
  finishes on `state` after `continuity` drops to shadow; a mint ending a row on a live walk mints the next row live, so
  a renewal a start completes goes on in `state`; a shadow mint never writes `state` past `active`. The plan's "the
  store's step and mint take `live` … nothing else chooses the column" is narrowed to: `live` chooses the column only for
  a walk that begins in this pass.
- **shadow-deadline-column** (review 1902 F1, "`deadlineAt` never leaks a carded deadline onto an active row") —
  `shadowState` has its own deadline column, `shadowDeadlineAt`, set and cleared by the same rule as `deadlineAt`. In
  shadow a mint writes `state` `active` with `deadlineAt` null, and the carded deadline in `shadowDeadlineAt`.
- **one-effective-state-accessor** (review 1902 F6) — `effectiveGeneration(row, live)` in `continuityStore.ts` answers the
  effective state, its deadline, the column the next step writes and whether a shadow walk's residue stands; `genViewOf`
  builds the machine's view from it. The card (part B) and the probes use these and read no column by hand.
- **nudge-point-derived** (review 1912 F3) — no nudge column: the carded nudge point is the carded deadline less the lane
  period (`CARDED_NUDGE_AT_MS`), derived from the stored deadline when the renewal act feeds `nudge-due`.
- **host-ended-column** (review 1912 F3) — `hostEnded` is a column, as the machine's view needs it; `probeRounds` counts
  failed rounds (0 or 1); `walkClass` holds the view's `cls`. Every view field is a column, so a restart resumes the walk.
- **proven-follows-the-view** (review 1920 R2) — `proven` is written from the machine's next view on every step, so it is
  cleared when the conversation ends (`hostEnded`), as the machine's `degrade` says. The plan's "set once, never cleared
  (A2)" is superseded.
- **cas-key-carries-both-columns** — every compare-and-set compares `(term, n, state, shadowState, walk)` as the caller
  read them, by row id: the plan's `(identity, term, n, state)` with the shadow column and the walk beside `state`, so a
  shadow step raced by another write changes nothing.
- **only-a-mint-ends** — `stepGeneration` refuses `ended`: a generation ends only in the mint that replaces it, with its
  outcome, in one transaction.
- **clear-shadow-walk-resets-the-view** — when `continuity` is live and a walk begun in shadow left its residue,
  `clearShadowWalk` removes it and resets the row to `GEN_ACTIVE` (proven, no counters), as a generation that was working
  when the machine began.
- **hold-off-absolute** (review 1902 F4) — `setHoldOff` stores `holdOffUntilObservedMs` absolute on the identity's
  accumulator (`observed.ms + HOLD_OFF_MS`), computed inside the compare-and-set; the gather (`softTimesOf`) subtracts
  `mintedObservedMs` to put it on the generation's own age, with a case at a nonzero `mintedObservedMs`.
- **start-reported-at-column** (reviews 1949 G3, 1975) — `startReportedAt`, the start's `reportedAt`, is stored on the row,
  so a start older than the live generation's is recognised as late without a join.
- **prev-model-column** — `prevModel`, the model of the generation a mint ends, is stored on the new row, so a resumed
  start's model class can be compared with the conversation it resumed (`resumed-other-class`).
- **starts-since-takes-a-limit** — `startsSince` takes an optional limit, so the pass reads at most 200 starts in SQL.
- **wave-boundary-read** — the wave boundary is read by `newestClaimedWorkRuns` (`continuityStore.ts`): the two newest work
  runs the coordinator claims, newest first.
