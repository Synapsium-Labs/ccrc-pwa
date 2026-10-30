# Test box TB8: the wrapper's remote arm, six seams ruled

- **D-7558 (2026-10-30)** — Test box TB8: six departures of the wrapper's remote arm ruled as built; the status answer's row fields are a named follow-up that lands before TB14's parity.

**D-7558.** Task TB8 of `docs/superpowers/plans/2026-10-29-test-box.md` (D-7410) builds the wrapper's remote arm: `ccd/ccrc-test`, `agent/src/testbox/client.ts` and `agent/src/testbox/budget.ts`. The build met six places where the plan or the spec (§2.4, §2.5) asks for something the merged contract cannot give. The coordinator ruled on 2026-10-30 that all six stand as built:

1. **The usage line stays TB0's.** `_tusage` prints today's usage line unchanged, because TB0's usage-error pin holds it byte for byte and TB8 may edit only `exitContract()` and `testboxReaders()`. The header's argv line (and so `--help`) names `[--local|--remote]`.
2. **The status answer carries no row detail.** `StatusAnswer.repositories` holds only `name` and `mirrorPath`, so the fleet host never sees a row's packages, command heads or build outputs. The command row and an unlisted package are read from the service's refusal of the submission (close 1008, D-7501), so they are decided after the push and the budget. The submission sends `outputs: []`, since declared outputs are a row field.
3. **No re-attach in proto 1.** No frame re-attaches a connection to a run, so a drop is a lost run even when the reconnect succeeds inside the deadline. The cancel goes on the reconnected link.
4. **The queue wait** runs from the submission to its first frame. Proto 1 has no start or position frame (D-7501), so the prepare counts as waiting.
5. **The budget's worker count** is the session's own (`--maxWorkers`, else `VITEST_MAX_WORKERS`), else 1, because the box's count is a box setting. The per-file default (15 s) lives in `budget.ts`, because `TestboxRepoRow` has no such field and the fleet host holds no row.
6. **The repository's name** is `origin`'s last path segment without `.git`, lower-cased (else the root's own name), matched against the status answer's names.

**The follow-up (named, required before TB14).** Departure 2 is temporary. Before TB14's parity runs (the spec's build-output row), the status answer gains the row fields: packages, command heads and declared outputs. The change touches `shared/testbox.ts`, `agent/src/testbox/status.ts` and `agent/src/testbox/service.ts`. After it lands, the client decides the command row and the package before the push, and the submission sends the row's declared outputs instead of `outputs: []`.

The plan file is not edited, because merged plans are append-only. This note is the record.
