# Test box TB8: the wrapper's remote arm, departures 7 to 11 ruled

- **D-7561 (2026-10-30)** — Test box TB8: departures 7 to 11 of the wrapper's remote arm ruled as built (the lost run after output, Chrome through `CCRC_CHROME`, the parity harness on junit, the fallback install for the cwd package only, and the two census files).

**D-7561.** Task TB8 of `docs/superpowers/plans/2026-10-29-test-box.md` (D-7410) builds the wrapper's remote arm: `ccd/ccrc-test`, `agent/src/testbox/client.ts`, `agent/src/testbox/budget.ts` and `ccd/testbox-parity`. Departures 1 to 6 are D-7558 (`2026-10-30-test-box-tb8-seams-ruled.md`). The build met five more places where it does not do what the plan's text says. The coordinator ruled on 2026-10-30 that all five stand as built:

7. **`CCRC_TESTBOX_LOST_RUN=fail` after output exits 1, not 75.** The plan reserves 75 for "refused, nothing ran", which holds only before anything ran. Once the run has written output it has started, so a lost run after output is a failed run (exit 1), logged `remote`.
8. **The fleet host's Chrome is read through `CCRC_CHROME`** in the session's environment. This is the same source the plan gives TB9's `testboxOp`. When it is unset the version reads `unknown` and the version row falls back.
9. **The parity harness reads junit on stdout, not JSON.** The box's runner sets its own JSON reporter with `--outputFile.json=` in the run's directory, and vitest writes every JSON reporter to that one file, so a session's JSON reporter never reaches stdout on the box. Junit on stdout carries per-test skips on both legs.
10. **The fallback install covers the cwd's package only.** The fleet host holds no repository row, so it cannot name the run's packages. Installing every `package.json` that has no `node_modules` would also install `pwa` and `ui`, which the run does not need.
11. **Two census files outside the task's list change, each by the count the task names.** The marker's single-definition pin goes from 0 to 1 shell holder (`ccd/ccrc-test`'s one read). The agent's import census goes from 2 to 3 entry points, plus a row checking that the fleet agent's entry point reaches neither the client nor the budget. No row of `ccrc-test-wrapper.test.ts` or the whitelist tests is deleted, skipped or loosened.

With D-7558 and this note, every departure TB8 reports is ruled. The plan file is not edited, because merged plans are append-only. This note is the record.
