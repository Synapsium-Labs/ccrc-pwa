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
| 1 | Every run row carries its review cap's state; a session-gated read of the ask; one confirm sheet; a "Waiting on you" band on the run board and a door on the cap's record in Mail. | #1524 | **FIX ROUND 1** 2026-10-25 20:54 UTC, mail 9796, ruled on review 951 at `d796ba10d`. Two CI legs were red on this wave's own lines: the new GET was neither masked nor exempt (F1, mask it), and the lines added to `shared/api.ts` moved four README citations (F2, re-ground them, with the README claim holder's consent). F3 fixes a comment that called a coord.db loss the safe direction, when it resets the rounds to 0. F4 ledgers the GET's `run-unreadable` 503 as deviation 6912. Six advisories are fixed in the same round, and three are carried. Run 946 is back at working, after a merge of main. Was **IN REVIEW** 2026-10-25 19:48 UTC, review run 951 (done 20:52 UTC, report accepted), with the held-out panel and one more lens on the new read's auth. **WAVE-DONE** 2026-10-25 19:45 UTC, mail 9764, at `d796ba10d`, PR #1524. The tip and the PR were re-measured, and the run moved to awaiting-review. The worker reports all ten corrections applied and recorded, deviation 6912 unused, growth store.ts +19, routes.ts +16 and pwa lib/api.ts +3, and main merged once. Was **MID-WAVE CORRECTIONS** 2026-10-25 17:58 UTC, mail 9657: the operator asked that the work follow the DDD/Clean/SOLID refactor in flight, and a verified four-lens check gave ten corrections. Among them: `refuseRoute` for the new GET (the inline-send ratchet); a `scan/parse.ts` census in place of a text grep (the single-definition ceilings); a total refusal-text table; a pure `capDoorRun` over the fleet store's live runs; C5 ring-context rows; the findings words beside the moved types; one round predicate; a typed lift answer; and the ring gates. The worker records them verbatim in the plan. Was **DISPATCHED** 2026-10-25 17:06 UTC as run 946, to its own child workspace. Was **PLANNED** 2026-10-25 17:05 UTC. |

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

## Next-wave brief

None. The programme closes when wave 1 lands. Before that, the run board on the next server build must show a waiting
cap's band for a run refused at the cap.
