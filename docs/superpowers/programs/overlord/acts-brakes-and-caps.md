# R22 and R23, acts, brakes, caps and autonomy: task note

Wave 166 of the Overlord programme (#2491), run 2677. A spec delta only: it amends
`docs/superpowers/specs/2026-11-09-overlord-design.md` and changes no code. The programme's coordinator folds what
the ledger should learn from this note into the ledger.

## What the delta records

- **R22**, the operator's ruling of 2026-11-19 in the Overlord's own chat: asked which of four kinds to add to the
  Overlord's acts, "pause, the brake", "lifting a review cap", "stopping or abandoning a run" and "dispatch-cap
  changes", the operator chose all four. A new row of Table 2a, beside R21, and a line under "Agreed".
- **Eight act kinds** in Table 7.1a, with the rest of their columns in a new Table 7.1b and their rules in a new
  §7.1.1: `pause-coordination`, `pause-programme-starts`, `lift-own-pause`, `lift-review-cap`, `interrupt-session`,
  `abandon-run`, `reclaim-run` and `propose-dispatch-cap`. Figure 12 draws how an R22 door decides.
- **Three author's calls**, C77 (the brakes), C78 (one more review round) and C79 (run acts on a measured reason), in
  §13, waiting on the operator's approval on the pull request.
- **`overlordMayAct`** takes the measured reason in `facts`, and answers `reason-unmeasured` and `reason-stale`.
  `reclaim-run`'s O4 is covered only by R22's relaxation.
- **The Log and Overturn** wording (§10.1 to §10.3), the extras E7 to E10 (Table 8.1a), §7.3, Table 7.4a, C7,
  Tables 11.1a, 11.1b, 11.1e, 11.5 and 11.5b, the gate order in §11.2, Table 14 and its bullets, "In short", "Where
  things stand" and Appendix B's Table B10.
- **Waves.** The brakes in W2, under `overlord-route-v1`. The review round, the run acts and the dispatch-cap
  proposal in W3: their proposals in the first step, their `full` cells, shadow until armed, in the second.

## R23, from the brief's addendum

The addendum (the same run, the same pull request) adds a second ruling of 2026-11-19, quoted in its own row of
Table 2a: "Can add to overlord ability to grant autonomy mode to coordinators and also ability to take it away and
ability for operator to put overlord into autonomy mode which enables [it] to make all but the most critical
decisions in 'needs you' on it's own". The delta records it in a new §7.5.1, Figure 13, C80 to C82, coordinator
clause 25 (§11.4), Tables 7.1a, 7.1b, 7.5a, 10.1a, 11.1a, 11.1d, 11.1e and 11.5, Table 14, "Where things stand" and
Appendix B's Table B11.

- **The ladder placement, the call the addendum asked for.** A fifth rung, `autonomous`, above `full`, rather than
  `full` with a standing armed set. The ladder is the one dial, so every step-down it already has reaches the mode,
  its record is the rung's authority record, and a restore reads it as the stricter value; an armed set beside
  `full` would be a second carrier of the same authority. The mode's own step-offs (an overturn, any latch, a missed
  drill, a generation entering `degraded`), keyed on the operator's rung, raise one latch, `autonomy-off`, cap
  `full`, which only the operator clears; other latches and conditions lower it as they always do.
- **The critical list** is one L0 list, `OVERLORD_CRITICAL`, as the coordinator ruled it, pinned against D-8126. It
  bounds the mode's standing cover and a coordinator's autonomy. The operator's own per-effect grants and commands are
  left as §7.2 has them, so `approve-dod` stays grantable by the operator while the mode never reaches it.
- **Coordinator autonomy** is a table of its own, `coordinator_autonomy`, journalled, with a recorded reason it is not
  a row of `overlord_grants`. A decided-alone record is a row of D-8126's call record with a new nullable grant
  column, so the call record keeps one writer.
- **Waves.** W2 ships the critical list, its pin, `change-goal`, the "Ask me" mark and the call record's column. W3's
  second step ships the rung, the latch, the two act kinds, the revocation lane and clause 25, under a capability word
  of its own, `overlord-autonomy-v1`.

## Departures

Five numbers were issued at allocation, one for each departure below, and are named in the wave-done mail. They are not written here,
because no plan on this tree defines them yet, and a mention above the defined high-water reds `deviation-refs`.

- `reclaim-is-o4`: a reclaim names a new holder for a programme, which D-8126 lists under O4 ("who may act on a
  programme: handing it to another session after a lost id"). The row keeps O4, and R22 relaxes the operator-only
  list for this kind alone, at `full` or `autonomous`, armed, on `claimant-gone`. The table test that checks rows against D-8126 names
  R22 as its one exception. `abandon-run` and `interrupt-session` stay class none: D-8126 keeps the abandon the
  operator's by decision (its rows 34 and 58), under no class, and its O1 "touching units or tmux" is a session's
  direct act, which the server's interrupt path is not.
- `pause-has-no-raiser`: the coordination pause is a marker file that records nothing about who raised it, so "lift
  only a pause it raised itself" cannot be measured from the tree today, and a record kept beside the marker cannot
  see a raise by hand or by `ccd` directly. Since fix round 1 the Overlord's raise stamps the marker with its act id
  through a new `--stamp` argument of `ccd coord-pause` (capability word `coord-pause-stamp-v1`), the operator's raise
  empties the stamp, and the Overlord's lift removes the marker only when the stamp matches. Every reader of the
  marker tests existence only. `coord_pause_events` stays as the record the Log reads. The same departure covers
  `pause-programme-starts`: no programme-scoped pause exists (the pause is fleet-wide, and `ProgramState`'s `paused`
  word has no writer but a seed row). The pause door gains an optional `programme` field, and where its scope lives
  is left to the plan.
- `review-round-not-three`: D-8125's coordinator lift grants three rounds at a time. The brief asks for one more round,
  so the Overlord's act adds one through D-8125's one writer, with its own `review_cap_lifts` row. (The first draft
  also refused it on a coordinator-lift switch; D-8165 retired that switch, so fix round 1 dropped the refusal and
  corrected Table 6.1a's stale row.)
- `ask-me-mark`: the critical list names "any item the operator marked 'ask me'", and no such mark exists. R21's two
  marks are facts that grant nothing. The delta adds "Ask me" as a third value of the same `answer_marks` table and
  door, the one mark that narrows authority. Since fix round 1 its untick takes the step-up and every change is an
  authority-journal record.
- `rung-word-rollback`: an older build reading the rung row or the authority journal meets a word it does not know.
  The first draft asked the plan to pin a reading; the review measured that shipped code already fails closed (an
  unknown rung word reads `unreadable`, only a brake to `off` is allowed, an unknown latch cause reads `unmeasured`,
  and the journal parser refuses the record, so the doors refuse `authority-rolled-back` until a Confirm). Table 11.5
  now cites that.

## Fix round 1 (review 2686)

- **Rulings applied.** F1: at `autonomous` every check a grant-backed answer meets still runs, so an O3 answer is
  staged while identity is `attributed`, and class-none answers act at once. F9: a granted coordinator never approves
  its own spec, `state-a-fact` is wholly critical under coordinator autonomy, the decided-alone route runs the
  Overlord's own checks through `overlordMayAct`, a grant made at `full` reaches class none only, and a record beyond
  the grant's cover is refused `beyond-autonomy-cover`. F12: R22 is the ruling that classes `pause-coordination`,
  `lift-own-pause`, `abandon-run` and `interrupt-session` none against O1, and the table test names the four.
- **For the ledger.** The W2 act catalogue plan's oracle row that maps "changing a spec's goals or scope" to
  `widen-scope` splits: the goal to `change-goal` (derived, never labelled: see fix round 2), scope within the goal
  to `widen-scope`. That plan row is the coordinator's to reconcile on the ledger pull request.

## Fix round 2 (review 2696)

- **Ruling applied, F2b.** Under the `autonomous` rung and under coordinator autonomy, a modification whose change is
  carried only in free text is derived `change-goal`, so it goes to the operator. Only a structured field that leaves
  the goal and the definition of done untouched may be `widen-scope`. A modification has no such field in version 1,
  so a structured scope field is a Later item, and a rung-covered or decided-alone `widen-scope` waits for it.
- **The rung's cover.** It holds only when the item's effect and its whole effective class are off the critical list
  (N1), never for an ask's answer (N2), and for `answer-approval` a deny only (N5). `goals modify`, C19, clause 22 and
  the act read take `autonomy:<id>` beside a grant (N4). The pin test gains the class-member case.
- **The residues.** A decided-alone `widen-scope` is stated dormant in version 1 (F9). The stall row stores its mail's
  id, and "sent" is defined per rung of the `quiet` arm (F14). A reclaim and Confirm's revoke block a re-grant, and a
  dead coordinator is the stall watch's live verdict measured again at the revoke (F4). The Overlord's raise creates
  the marker exclusively, one `flock` lock orders every arm of `coord-pause`, and the stamp has a grammar (F11). The
  stale lines S1 to S10 and the F8 nits are fixed.

## Choices made beyond the brief

- `lift-own-pause` is a kind of its own, so its rung cells (`full` only) can differ from the raise's.
- `end-requested`, an open end request the run's coordinator raised, is a reason for `abandon-run` beside the stall
  watch's dead verdict and the silence bound, because an end request is the coordinator asking (C79).
- The refusal words §7.1.1 names are not added to Table 11.6 in this delta. `refusal-table.test.ts` requires each row
  to be a route refusal already, or a W3-or-later word on its wave map, and no W2 word may wait there. So each word
  joins the table in the pull request that ships its code.
- `change-goal` is a new effect with Grant "no", because a goal is direction, which R16 keeps the operator's.
- Coordinator autonomy has no expiry of its own; "Later" names the trigger for one.
- The operator's R22 ruling is quoted as the brief gave it: the four options as asked, and that the operator chose all
  four. The brief carried no longer verbatim text.
