# Landing order wave 5g: three departures from its plan, recorded

The plan itself defines D-8080 to D-8089. These three were found while the wave was built and reviewed (reviews 1654
and 1660). The coordinator allocated D-8117 on 2026-11-08 at 02:03 UTC, at acceptance, and D-8118 and D-8119 at
02:27 UTC, before this note was written. It defines all three here.

- **D-8117 (2026-11-08)** — `migration-slot-42` (Task 1): the `landing_intents` migration takes coord.db slot 42, not
  the plan's slot 41, because `main` reached 41 (#2404) before the wave was dispatched.
- **D-8118 (2026-11-08)** — `step6-state-from-the-answer` (Task 3, fix round 1): step 6's D-8089 sentence reports the
  state the advance's answer names. The plan dictated its words, and those words were wrong for some answers.
- **D-8119 (2026-11-08)** — `worker-starting-rerun-after-ensure` (Task 2, fix round 1): on the worker-starting re-run,
  an `intent-held` refusal can come after this request's first pass has acted on the fleet. D-8085 says the refusal
  comes before any listing or fleet act. That holds on every other path.

**D-8117.** The plan's literals read slot 41 and `user_version 40 -> 41`, measured when `main` ended at migration 40.
The plan's own rule was to take the actual next slot and report it, and `main` had 41 at dispatch, so the brief named
slot 42. The branch's migration is 42, and `coord-db.test.ts` pins it. Review 1654 found the plan's own literals
unmoved (its F5). Fix round 1 ruled that the plan stays as it is, a snapshot of its day, and that the move is recorded
here instead.

**D-8118.** The plan's Task 3 Step 4 gave exact copy for step 6, saying the run is still `merging` after a refusal.
Review 1654 found that false for some answers (its F1, held by 3 of 3 refuters, and its F4):
- `ejection-not-merging` and `bad-transition` are answered only when the run is no longer at `merging`, and both
  carry the run's state in `from`;
- the 503 `run-unreadable` and `unknown-run` can come after the move has committed, with the run already at `working`.

Fix round 1 reworded the sentence to keep D-8089's intent, "the run's state as the advance answered it":
- `working` after `ok`;
- after a refusal, the state the answer names (its `from`), still `merging` only when the refusal came before any move;
- `runs list` for the run's state when the answer names no state or was uncertain.

Every pin moved with the sentence, and 5G-SKILLS-3 still goes red when the old sentence is restored. Review 1660
checked the new sentence against every answer the advance route sends and found none it misdescribes.

**D-8119.** When a resumed worker's pane was only just started, the dispatch handler waits outside the coordination
mutex and then runs the request again. The second pass repeats the held check. The plan accepts that, since it is what
stops a key another programme takes during the wait. By then, though, the first pass may have run `ccd ensure` and
started or woken the bound worker's pane, so an `intent-held` from the second pass comes after that act. Nothing else
happens: the run stays `planned`, and neither a hold nor an intent row is written. The resume arm mints no workspace,
so none outlives the refusal. Review 1654 found the README sentence and `wave-lifecycle.md`'s `intent-held` row
claiming more than that (its F2 and F3). Fix round 1 made both name the edge. It also added a test that drives the
re-run with fake timers and has another programme take the key through the store during the wait. The test asserts
409 `intent-held`, one `ensure`, no `ws-hold`, the run `planned` and no row. Mutation row 5G-DISPATCH-10, the re-run
without `body.intents`, turns it red; review 1660 measured that itself. The plan's lines on D-8085 are left unchanged,
as a snapshot.
