# Capacity, docs piece: notes (Overlord wave 185, run 2838)

This pull request adopts the draft design and plan for "waiting workers sleep and hold no slot" (#3068). It brings
in the draft's one commit unchanged, then edits it against today's `main`. It is docs only and builds no code.

## What changed against the draft

- **issued-numbers.** The five `D-TBD-<slug>` calls now carry the numbers the allocator issued to this run, and the
  plan's "Deviations found" defines each one, dated 2026-11-19: D-8789 (own-run-hold-passes), D-8790
  (working-idle-sleeps), D-8791 (coordinator-told-of-sleep), D-8792 (cap-counts-working) and D-8793
  (cap-governs-starts). The spec's status line now says it is adopted and that D-8793 stays the operator's to confirm.
  The plan's Task 2 and Task 3 headings name their numbers.
- **task-6-names-a5.** Task 6 (W1-5) now waits for "D-8126 A5 is on `main`", as the brief directs, and spec Part 5
  says the same. Tasks 4 and 5 are unchanged.
- **verdict-suite-name.** Task 1 named `server/test/stop-done.test.ts`, which does not exist. The verdict's suite on
  `main` is `server/test/stop-done-verdict.test.ts`.
- **deps-shed-calls-held-kind.** The draft said to modify `server/src/depsShedPass.ts` "only if it calls
  `heldKindOf`". It does. The deps-shed verdict (`server/src/depsShed.ts`) passes only `none`, `programme` and
  `run-terminal`, so a new `'run-own'` holds there with no change. The plan now says so and asks for a test that pins
  it: Task 1 widens nothing the deps shed removes.
- **stack-only-names.** Task 3's `workerReadingFor`, `caps-stale-runs.test.ts` and `worker-reading-for.test.ts` exist
  only in stack commit `48ef4ad0e`, not on `main`. The plan says so.
- **routes-held.** Task 3 edits `server/src/coord/routes.ts` (the caps view). Another programme's frozen run holds
  that file today. The plan now tells Task 3's worker to claim it and agree the edit with its holder first.

## Checked and left as written

- Every other file, symbol and constant the draft names exists on `main` today: `heldKindOf`, `StopDoneHeldKind`
  (`run-live`, `run-terminal`), `heldPasses`, `STOP_DONE_PARKED_IDLE_MS` (30 minutes), `capsMeasured`,
  `lastRunBySession`, `CoordCapsUsage`, `queueSystemMail`, `shared/lane-arm.ts`, `pwa/src/fleet/laneArmWords.ts`,
  `pwa/src/fleet/CapsControl.tsx`, and `hibernate-hold-ok` in `ccd/ccd`.
- The stack commits the plan cites (`81fc8422b`, `48ef4ad0e`, `45509bb6d` to `4c709ee94`, `d2d92cff8` to
  `31f37745e`, `70c53d9eb`, `c121218b4`) are all reachable from this repository's `handoff/d8126-autonomy-stack`.
- §1's measurements are the draft's. This piece did not measure them again.
