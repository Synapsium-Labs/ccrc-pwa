# Program: review-cap-lift

Spec: GitHub issue #1410, and the review-round cap of #1331 in `docs/superpowers/plans/2026-10-24-build-spend-controls.md`.
Plan: `docs/superpowers/plans/2026-10-25-review-cap-lift-control.md`. The wave's worker commits it as its PR's first commit.
Workspace: the wave's child workspace, minted by its dispatch.

A one-wave programme. On 2026-10-25 the operator asked for the review-round cap's missing console control to be filed,
and #1410 was filed. Then the operator said "OK pick up and build the ticket". The cap's lift route is session-gated
with no box token, by design, but nothing in the console calls it, so an operator with sign-in armed cannot act on the
cap's notice.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | Every run row carries its review cap's state; a session-gated read of the ask; one confirm sheet; a "Waiting on you" band on the run board and a door on the cap's record in Mail. | #1524 | **IN THE MERGE QUEUE** 2026-10-26 02:42 UTC at `f50e90bdb` (queued, position 3), with run 946 at merging. The sync's wave-done (mail 9925) was re-measured. File by file, the wave's own added and removed lines are unchanged from the reviewed tip, except for route counts and comment wording in the two conflicted pins and the gate's docstring count, and the plan. One CI shard was red on a delegation-spool concurrency row this PR does not touch, and it passed on one rerun. The first enqueue had only armed auto-merge while checks were still running, so it was disarmed, the checks were awaited, and the PR was enqueued again. Was **ACCEPTED; CONFLICT-SYNC** 2026-10-26 01:51 UTC, mail 9911. Review 962 (done 01:48 UTC, accepted) found one finding and five minors, and the coordinator ruled none of them blocking; all are carried. Main then moved, and the PR conflicted in two test files' route pins. The worker merges main, keeping both sides, makes no other edit, and sends a wave-done. The PR then goes to the merge queue, which re-tests the combined code with the full suite, with no fourth review. Was **IN REVIEW, ROUND 3** (the last under the cap) 2026-10-26 01:08 UTC, review run 962, with the held-out panel over fix round 2 and the egress lens on every cut. **FIX ROUND 2 DONE** 2026-10-26 01:07 UTC, mail 9894, at `1bd054e00`: the four ruled items in 8 files, with no merge. It was re-measured, and the branch merges clean with main. Ask 118, answered 00:37 UTC: the cut adds no marker, since neither cut had one. Was **FIX ROUND 2** 2026-10-26 00:33 UTC, mail 9891, ruled on review 960 at `f907225ad`, the second of the cap's three rounds. F1, the egress finding: the summary and findings cuts, from #1331, fall before the answer hook, so a key split by a cut went out as an unmasked prefix (14 characters, measured through the new read). It is fixed here, with one pure cut that never leaves a partial token and serves all three egresses. F2: the read's docstring did not name the 503 that the plan said it named. Two minor pins go in too. The round is limited to those four items, and the worker merges main only on a conflict. Run 946 is back at working. Was **IN REVIEW, ROUND 2** 2026-10-25 23:46 UTC, review run 960 (done 00:32 UTC, report accepted; CI green at the tip), with the held-out panel over the fix round and an egress lens on the masked read. **FIX ROUND 1 DONE** 2026-10-25 23:44 UTC, mail 9873, at `f907225ad`. The tip and the PR were re-measured, the branch merges clean with main, and the run moved to awaiting-review. The worker reports every ruling applied and main merged three times, the last two on conflicts. One push, `f6fce7bfa`, went out before its merge probe answered. It was reported at once and superseded, and no wave-done named it. Was **FIX ROUND 1** 2026-10-25 20:54 UTC, mail 9796, ruled on review 951 at `d796ba10d`. Two CI legs were red on this wave's own lines: the new GET was neither masked nor exempt (F1, mask it), and the lines added to `shared/api.ts` moved four README citations (F2, re-ground them, with the README claim holder's consent). F3 fixes a comment that called a coord.db loss the safe direction, when it resets the rounds to 0. F4 ledgers the GET's `run-unreadable` 503 as deviation 6912. Six advisories are fixed in the same round, and three are carried. Run 946 is back at working, after a merge of main. Was **IN REVIEW** 2026-10-25 19:48 UTC, review run 951 (done 20:52 UTC, report accepted), with the held-out panel and one more lens on the new read's auth. **WAVE-DONE** 2026-10-25 19:45 UTC, mail 9764, at `d796ba10d`, PR #1524. The tip and the PR were re-measured, and the run moved to awaiting-review. The worker reports all ten corrections applied and recorded, deviation 6912 unused, growth store.ts +19, routes.ts +16 and pwa lib/api.ts +3, and main merged once. Was **MID-WAVE CORRECTIONS** 2026-10-25 17:58 UTC, mail 9657: the operator asked that the work follow the DDD/Clean/SOLID refactor in flight, and a verified four-lens check gave ten corrections. Among them: `refuseRoute` for the new GET (the inline-send ratchet); a `scan/parse.ts` census in place of a text grep (the single-definition ceilings); a total refusal-text table; a pure `capDoorRun` over the fleet store's live runs; C5 ring-context rows; the findings words beside the moved types; one round predicate; a typed lift answer; and the ring gates. The worker records them verbatim in the plan. Was **DISPATCHED** 2026-10-25 17:06 UTC as run 946, to its own child workspace. Was **PLANNED** 2026-10-25 17:05 UTC. |

## Decisions & deviations

- **Deviation block:** four numbers, 6909 to 6912, issued 2026-10-25 to this programme.
  - 6909: the cap's state on the run row.
  - 6910: the read of the ask.
  - 6911: where the control lives.
  - 6912: a spare, which the worker spends only on a departure found while executing. Spent in fix round 1, on the read's third refusal, `run-unreadable` (503), when the store read fails.
- **The door is not on the run card.** #1410 asked for one there, but `RunRow.tsx` is under another wave's live claim.
  So the control goes on a band on the same board, and on the cap's record in Mail. A later wave may move it onto the
  card.
- **The optional CLI path is not built.** A `ccrc` verb on a box holds no operator session, and it must never use the
  box token. It stays on #1410.
- **Routing:** a worker executing a spec'd plan, as one dependent chain that fits one context. That is Opus at high
  effort, Sonnet high subagents, workflows off and compaction at 40 (the routing matrix's worker row). The review uses
  the held-out panel.

## Carried constraints

- No change to the cap's value, its rule, or the lift route's auth, body or answer. The box token never reaches either
  cap route.
- No role skill names the review-cap door.
- The three growth-checked files the wave touches stay within the growth limit.
- From review 951, for a later wave (minor, none blocks):
  - The sheet and the notice both decide "no review reported" from the summary. A `review-done` mail with an empty text can have a summary of null while still naming its review and report. Key on the review run instead, on both surfaces at once.
  - The notice census matches single-quoted values only. A writer using double quotes or a template literal is invisible to it.
  - coord-pause-route's "no SESSION_ONLY route is EXEMPT" scan looks for a string that cannot match the GET's EXEMPT key. Today auth-gate's arithmetic holds that route.
- From review 962, for a later wave (none blocks):
  - A text cut to empty is worded as absent. When every findings line is one token longer than the cut, the sheet and the notice say the report lists no open findings, and a summary cut to empty reads as "no review has reported". Word both as withheld, and tell a null summary apart from no review by the review run, together with review 951's carried item on the same predicate. It was not fixed in this wave because the trigger is pathological, the report's path is always shown, and a fix would have needed a fourth review.
  - The cut's docstring says a text with no whitespace before the limit comes out empty. The true rule is that a run the limit falls inside is dropped.
  - The findings cap of 8 is taken before the empty filter, so a dropped line costs a slot.
  - The cap notice's push body has no byte bound. This predates the wave, from #1331.
  - Fix round 2's As built miscounts its pure rows by one and records no gate or growth figures. The figures hold.

## Next-wave brief

None. The programme closes when wave 1 lands. Before that, the run board on the next server build must show a waiting
cap's band for a run refused at the cap.
