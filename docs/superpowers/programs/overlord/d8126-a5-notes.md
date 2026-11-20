# D-8126 wave A5: the coordinator skill (clause 21, the decision procedure, §7's dispositions)

Run 2786, programme `overlord`, issue #2491. Plan: `docs/superpowers/plans/2026-11-09-coordinator-autonomy-default.md`,
wave A5. Spec: `docs/superpowers/specs/2026-11-09-coordinator-autonomy-default-design.md` §7, §9.1. Draft source: the
stack branch `handoff/d8126-autonomy-stack`, commits `518b7c71c` to `1edff44d1` (unreviewed).

## What was ported, and what was rebuilt

| Piece | Ported or rebuilt | Why |
|---|---|---|
| Clause 21 | ported verbatim | The stack's line equals §9.1's quote byte for byte (1,331 bytes). |
| Clauses 4, 11, 19 and 20 | rebuilt, then deferred | The stack's rewrites added 739 bytes to the contract; the restore budget leaves 265 for them, and the rebuilt words add 173. They are not in this PR: D-8807. |
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
- `no-review-rounds-door-lands-without-regressions`: on an older server without the lift door, spec rows 12 and 62
  say only "a 404 is P4, recorded with `wakeOn: update`". The procedure and the advance file add what happens to the
  PR: rule on the findings held, land with known limits only when no open finding is a regression, and otherwise wait
  for the update (the coordinator's ruling on review 2865 F4).
- `row-33-end-request`: a repeating `hookstate-unmeasurable` or `status-unmeasurable` ends in an end request for the
  run after the backoff, not in closing it as failed: the run is still `planned`, which that close does not take.
- `row-43-no-repin`: a landing pin that differs is re-measured (`decision-procedure.md`); the re-pin through the
  normal advance that row 43 adds is not written, so a stale server pin stays the landing programme's to settle.
- `row-58-no-disposition`: `not-dispatched` on close keeps today's text; row 58's end request is not added there.
  Review 2865 (F13 h) found rows 33, 43 and 58 sound as written.
- `held-paths`: `server/test/coordinator-skill.test.ts` and `README.md` are held by the same run and pin the contract.
  Under the operator's answer to item 486 (2026-11-19) that run's coordinator takes additive packets only: nothing
  existing removed or rewritten, a forced count word allowed. This wave's packet (v4, a unified diff on main
  `963286cc9`) appends clause 21 to the pinned CONTRACT, adds the count word `twenty-one` (README too), raises the
  length pin to 21 and makes the two count harvests hyphen-aware, which the count word forces.
- D-8807 (the coordinator's ruling (a), 2026-11-20; defined in the plan): the rewrites of clauses 4, 11, 19 and 20 rewrite existing pinned CONTRACT entries, so
  they wait for a second packet once that freeze ends, with the plan's A5-2 row pins. Until then three passages stay
  inside the clauses as they stand:
  - the paused entry (SKILL.md and the dispatch row) keeps its split by cause, but both causes are a report, never a
    retry (clause 4), where the rebuilt clause 4 would make the fault a backoff retry;
  - `decision-procedure.md` rules a child's question under clause 11, which still releases a NEW decision to the
    operator;
  - `wave-lifecycle-asks.md` keeps clause 11's own two sentences ("Decline anything that would be a NEW decision …"
    and "If answering would require guessing rather than reading, decline it."), restored in review 2865's fix round
    (F1, the coordinator's ruling).
  The coordinator accepted all three. Clause 21 reads consistently beside the old clauses 19 and 20: both already keep
  the dialog out while a child is active and raise operator questions as items. The deferred packet also carries:
  - 5b's lines 439 to 442 (`wave-lifecycle-5b-landing.md`, held), whose `changes-requested` dialog wording
    `decision-procedure.md` overrides on a pinned programme until then (F5);
  - the stale "twenty" in held test text: `coordinator-skill.test.ts` (the comment above `CONTRACT`, the
    escaped-quotes comment, the case title "carries all twenty clauses verbatim", and the two "These twenty
    sentences" comments) and `coordinator-approval-prompts.test.ts`'s comment on the clauses (F13 g).

## Sentences that depend on waves building beside this one

- A6 (time and condition wakes, the coord-ball mail rung): "the server mails you at that time" (P3), and every
  `wakeOn` wake in `decision-procedure.md` and SKILL.md's unreachable-server entry.
- A7 (#3079, on main as f4c786986): rows 36 to 38 in `wave-lifecycle-2-dispatch.md`, now written against what it
  shipped. Placement skips a lane whose newest spawn record reads `login` or `blocked` and is under six hours old.
  The self-install is a server lane outside the dispatch, one attempt per dispatch, that records its outcome as the
  run event `skill-install:<installed|converged|failed|unsupported>`, which the reference now names beside
  `skill-preflight:<state>` (A7's carry). The stack's draft had the dispatch answer carry a `skillInstall` field; A7
  never built one, so that sentence is gone and the pin now refuses it.
- This wave lands after both (the plan's P11).

## Agreement with the Overlord spec

Clause 21's operator-only list is D-8126's O1 to O6, which `decision-procedure.md` writes out unchanged. The Overlord
spec's R1 inherits that list unchanged as its critical list, and R23's later autonomy clause (§11.4, its clause 25)
sits on top of clause 21 without changing any class's meaning. Nothing in this wave changes a class: the two agree.

## Budget, measured on main `208afddca`

- Contract end: 13,668 bytes now; 15,004 with clause 21 alone (15,177 once the deferred rewrites land); budget 16,750;
  1,746 left now. The recall, Linear and Overlord clauses need 1,481 by the ratchet header's arithmetic.
- SKILL.md file: 23,230 bytes on main; 24,339 with this wave, which is the new cap (clause 21's line allows 1,332 of
  growth). Review 2865's fixes took 6 bytes out of SKILL.md, so the cap fell from 24,345 rather than rising.

## Red first, measured

Each guard was mutated in place in a scratch tree (the contract and the held-file hunks applied), restored from a saved
copy and checked by sha, one vitest run of `coordinator-skill.test.ts` and `coordinator-skill-autonomy.test.ts` per
mutant. All sixteen went red: the installer without `decision-procedure.md`; "stalls honestly" put back; `review-cap`,
the goals route or a SAFETY verb named in the procedure; "stop and report" back in a dispatch row; the `skill-install:` run event
dropped; "ignore" given to the coordinator; the paused entry without its cause; the paused entry or the paused row
turned back into a retry; a child's question taken outside clause 11; the cap-concurrency entry rewritten early; the
split rule stated twice; the ledger template without its goals section; clause 21 softened; the debugging ceiling
dropped. The last run was with packet v4 applied (clause 21 alone).

Review 2865's fix round added pins, mutated in place the same way, one run of `coordinator-skill-autonomy.test.ts`
per mutant. All ten went red: clause 21 with a sentence appended (F3's whole-line pin, taken from the spec's §9.1
quote); peer-protocol escalating to the operator again; resume without the id-preserving revive, or without the
Resume door; api retrying blindly, or recording on a server it cannot reach; cross-project reusing `sessionId`;
wave-steps letting the cap make a thread wait; the boundary file without its end request; and the stale-uuid entry's
"resend once" turned into "resend at once" (F6).
