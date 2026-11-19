# D-8126 wave A5: the coordinator skill (clause 21, the decision procedure, §7's dispositions)

Run 2786, programme `overlord`, issue #2491. Plan: `docs/superpowers/plans/2026-11-09-coordinator-autonomy-default.md`,
wave A5. Spec: `docs/superpowers/specs/2026-11-09-coordinator-autonomy-default-design.md` §7, §9.1. Draft source: the
stack branch `handoff/d8126-autonomy-stack`, commits `518b7c71c` to `1edff44d1` (unreviewed).

## What was ported, and what was rebuilt

| Piece | Ported or rebuilt | Why |
|---|---|---|
| Clause 21 | ported verbatim | The stack's line equals §9.1's quote byte for byte (1,331 bytes). |
| Clauses 4, 11, 19 and 20 | rebuilt, shorter | The stack's rewrites added 739 bytes to the contract; the restore budget leaves 265 for them. The new words add 174. |
| `references/decision-procedure.md` | ported, then re-grounded | API section now `references/api.md`; `coord-lift-off` is retired (D-8165); the review-rounds door's `not-found` is "not a work run" on main; sibling worktrees dropped from P2 (slug `p2-sibling-worktrees-a8`); an anti-goals list added. |
| "When something is wrong" | rebuilt | Main's SKILL.md is the slim one; the stack's 64 KB file does not apply. |
| Step 5's review cap | not ported | Main already decides the cap before the open (D-8125 as merged); only the refusals and "or wait" changed. |
| Clause 15's transient-merge split (row 7) | not ported | Slug `clause-15-row-7-deferred`: it needs 185 contract bytes and a pinned clause change; clause 15 keeps "a refused merge is a stop". |
| The references' §7 rows | ported and re-grounded into main's split files | The stack edited the old single `wave-lifecycle.md`. |
| The dead-dispatch pass's switch | rebuilt | Slug `dispatch-abandon-unnamed`: the stack named the switch's operator route, which the skill census forbids; the text now says a coordinator cannot read the switch and raises a non-blocking item. |
| Migrations, pins of other waves | not taken | This wave adds no migration. |

## Departures (slugs; the coordinator mints numbers)

- `budget-drift-8`: the contract ends at 13,668 bytes on main, 8 more than the ratchet header's 13,660, because #2986
  changed clause 15's task-note path. The rewrites' room is therefore 265 bytes, not 272.
- `clause-5-note-moved`: the "Clause 5, read against a brief" note moved from SKILL.md to `references/wave-steps.md`, so
  the file grows by no more than clause 21's own line (ratchet R5).
- `landing-stops-in-decision-procedure`: rows 42, 43, 56 and 57 (the landing verdict's stops) are written in
  `decision-procedure.md`'s "The landing verdict's stops", not in `wave-lifecycle-5b-landing.md`: that file and the test
  that pins its sentences are held by another programme's run, whose coordinator refused co-edits; the coordinator
  accepted this placement (mail 26408). 5b keeps how a landing is read and when it stops; the new section says who
  decides each stop. 5b's own text still says every stop goes to the operator and that `changes-requested` is asked
  with a dialog; the clean-up of those sentences waits for that file's holder.
- `row-57-no-new-attempt`: the spec's row 57 says to run the verdict again "as a new landing attempt" on a time wake.
  5b defines a landing attempt by two doors and forbids cycling states to make one, so the section keeps the landing
  stopped, records a P3 block with a time wake, and raises a non-blocking item after 4 hours. Row 57's re-run is left
  to the landing programme.
- `rows-14-16-41-held-pins`: step 6's ejection with no `pinned` entry, the dequeue with another cause, the advance with
  no recorded base (rows 14 to 16) and the `ejection-not-merging` row (row 41) keep today's "stop for the operator"
  words. Each sentence is pinned whole in the held test file, and a disposition written beside a pinned sentence would
  contradict it. They wait for that file's holder, with the exact OLD and NEW wording already drafted.
- `row-28-no-new-slug`: on `home-mismatch` with no matching pin, the spec's row 28 says to open under a new slug. The
  stack's own review fix (`f7fe3f8f4`) parks instead and raises an item, because starting a new programme is O3; this
  wave keeps that.
- `row-38-pinned-phrase`: a test in the held file still requires "report it to the operator before you treat the wave
  as briefed". The row now says the non-blocking item on a failed self-install is that report, and never a wait.
- `api-untyped-answers`: `api.md`'s untyped-answer paragraphs (rows 20 and 21) and `cross-project.md`'s no-project
  case (row 30) said "stop and report"; they now give the recovery. `not-configured` cannot be recorded as a block,
  because the call record needs the same coordination database, so the turn's text says it.
- `held-paths`: `server/test/coordinator-skill.test.ts` and `README.md` are held by the same run and pin the contract.
  The contract edit (clause 21 and the four rewrites) lands only with the holder's consent or the coordinator's ruling.

## Sentences that depend on waves building beside this one

- A6 (time and condition wakes, the coord-ball mail rung): "the server mails you at that time" (P3), and every
  `wakeOn` wake in `decision-procedure.md` and SKILL.md's unreachable-server entry.
- A7 (placement filter, self-install): rows 36 to 38 in `wave-lifecycle-2-dispatch.md` (placement skips a lane that
  cannot spawn; the dispatch answer's `skillInstall`).
- A7 (#3079), a carry for this wave's text: the run events `skill-install:<installed|converged|failed|unsupported>`
  go beside `skill-preflight:<state>` in `wave-lifecycle-2-dispatch.md`. They are added there only once #3079 is on
  main (P11). Until then they are not in this branch.
- This wave lands after both (the plan's P11).

## Agreement with the Overlord spec

Clause 21's operator-only list is D-8126's O1 to O6, which `decision-procedure.md` writes out unchanged. The Overlord
spec's R1 inherits that list unchanged as its critical list, and R23's later autonomy clause (§11.4, its clause 25)
sits on top of clause 21 without changing any class's meaning. Nothing in this wave changes a class: the two agree.

## Budget, measured on main `a9a529388`

- Contract end: 13,668 bytes now; 15,178 with this wave; budget 16,750; 1,572 left; the recall, Linear and Overlord
  clauses need 1,481 by the ratchet header's arithmetic, so 91 spare.
- SKILL.md file: 23,230 bytes on main; with this wave about 24,480 (clause 21's line allows 1,332 of growth).

## Red first, measured

Each guard was mutated in place in a scratch tree (the contract and the held-file hunks applied), restored from a saved
copy and checked by sha, one vitest run of `coordinator-skill.test.ts` and `coordinator-skill-autonomy.test.ts` per
mutant. All fifteen went red: the installer without `decision-procedure.md`; "stalls honestly" put back; `review-cap`,
the goals route or a SAFETY verb named in the procedure; "stop and report" back in a dispatch row; `skillInstall`
dropped; "ignore" given to the coordinator; the paused entry without its cause; the cap-concurrency entry rewritten
early; the split rule stated twice; the ledger template without its goals section; clause 21 softened; clause 4
relaxing the pause for dispatch; the debugging ceiling dropped.
