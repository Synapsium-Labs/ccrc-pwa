# Landing order wave 5o, Task 5: the gate and the notes (D-9159)

Run 4111 (wave 36). Plan: `docs/superpowers/plans/2026-11-27-landing-order-wave5o-held-head.md`, Task 5, for the files of
Tasks 1, 2 and 4. Task 3 (the coordinator and worker text, D-9160) is another run's pull request, so its files, pins and
mutation rows (M14 to M19, M21 to M24, M30 to M38) are not in this one. Built on `main`
`5576023f2553c43f53532a3445fdc48c25dda558`.

## The gate

- `tsc --noEmit -p tsconfig.json` (the server): clean.
- `tsc --noEmit -p test/tsconfig.tests.json` (every server test): not completed on this box. It was killed four times by
  the test slice's 6G memory cap, which other runs shared at the time (exit 137, `Killed`). In its place, a scratch project
  extending that config over the three changed test files (`landing-next-mail`, `landing-control`, `mail-routes`) and
  everything they import was clean. The pull request's run is the whole-tree check.
- Every file of Tasks 1, 2 and 4, one per process: the counts are in the three task notes. `landing-next-mail` 68,
  `landing-control` 65 and `mail-routes` 62 passed on the final tree.
- `session-hook`, run alone: 740 passed, 6 skipped (746).

## Mutation rows

This pull request's rows are M1 to M13, M20 and M25 to M29, by the coordinator's brief. M3 and M4 are in the Task 1
note; the rest are in the Task 2 note. Each was measured by hand, as the brief corrected Task 5 Step 2: the row's change
applied with the edit tool, the named cases run alone and recorded red, the file restored and compared by sha256 with the
built one, and the case run green again. The Python mutation helper was not used: it mutates Python modules only.

## Claims and packets

- Claim 7611 holds the five source and test files of this wave that no other run held, and the four notes.
- `server/test/mail-routes.test.ts` and `README.md` were other runs' claims. Each holder was sent a unified diff against
  the base, inline, with its size and sha256, before Task 1, and each answered yes; each diff was applied as sent.

## What moved since the plan's baseline

Nothing in the files this wave changes or the owners it cites.
