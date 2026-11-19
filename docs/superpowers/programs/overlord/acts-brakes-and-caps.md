# R22 acts, brakes and caps: task note

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

## Departures

Three numbers were issued for these at allocation and are named in the wave-done mail. They are not written here,
because no plan on this tree defines them yet, and a mention above the defined high-water reds `deviation-refs`.

- `reclaim-is-o4`: a reclaim names a new holder for a programme, which D-8126 lists under O4 ("who may act on a
  programme: handing it to another session after a lost id"). The row keeps O4, and R22 relaxes the operator-only
  list for this kind alone, at `full`, armed, on `claimant-gone`. The table test that checks rows against D-8126 names
  R22 as its one exception. `abandon-run` and `interrupt-session` stay class none: D-8126 keeps the abandon the
  operator's by decision (its rows 34 and 58), under no class, and its O1 "touching units or tmux" is a session's
  direct act, which the server's interrupt path is not.
- `pause-has-no-raiser`: the coordination pause is a marker file that records nothing about who raised it, so "lift
  only a pause it raised itself" cannot be measured from the tree today. The delta adds one append-only record per
  call of the pause door's function (`coord_pause_events`), and a pause with no record of the Overlord's reads as the
  operator's. The same departure covers `pause-programme-starts`: no programme-scoped pause exists (the pause is
  fleet-wide, and `ProgramState`'s `paused` word has no writer but a seed row). The pause door gains an optional
  `programme` field, and where its scope lives is left to the plan.
- `review-round-not-three`: D-8125's coordinator lift grants three rounds at a time. The brief asks for one more round,
  so the Overlord's act adds one through D-8125's one writer, with its own `review_cap_lifts` row. Where the operator
  has switched coordinator lifts off, the Overlord's lift is refused `coord-lift-off` too, the author's reading of
  that switch.

## Choices made beyond the brief

- `lift-own-pause` is a kind of its own, so its rung cells (`full` only) can differ from the raise's.
- `end-requested`, an open end request the run's coordinator raised, is a reason for `abandon-run` beside the stall
  watch's dead verdict and the silence bound, because an end request is the coordinator asking (C79).
- The refusal words §7.1.1 names are not added to Table 11.6 in this delta. `refusal-table.test.ts` requires each row
  to be a route refusal already, or a W3-or-later word on its wave map, and no W2 word may wait there. So each word
  joins the table in the pull request that ships its code.
- The operator's ruling is quoted as the brief gave it: the four options as asked, and that the operator chose all
  four. The brief carried no longer verbatim text.
